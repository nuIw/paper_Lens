import { AUTO_MATCH_THRESHOLD, resolveRecords } from "./core.mjs";
import {
  buildDblpSearchUrl,
  buildGitHubSearch,
  buildOpenReviewForumUrl,
  buildOpenReviewSearchUrl,
  parseDblp,
  parseGitHub,
  parseOpenReviewForum,
  parseOpenReviewSearch,
} from "./sources.mjs";
import {
  cacheKey,
  isFreshCache,
  isTrustedSender,
  validateMessage,
} from "./service-logic.mjs";

const REQUEST_TIMEOUT_MS = 12_000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function openReviewChallengeUrl(paper, forumId = "") {
  const target = new URL(forumId ? "/forum" : "/search", "https://openreview.net");
  if (forumId) {
    target.searchParams.set("id", forumId);
  } else {
    target.search = new URLSearchParams({
      term: paper.title,
      content: "title",
      group: "all",
      source: "forum",
    });
  }
  const challenge = new URL("/challenge", "https://openreview.net");
  challenge.searchParams.set("redirect", `${target.pathname}${target.search}`);
  return challenge.href;
}

export function createService({ fetchImpl, storageLocal, downloads, now = Date.now }) {
  async function fetchJson(url, headers = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (response.ok) throw error;
      }
      if (!response.ok) {
        const detail = typeof payload?.message === "string" && payload.message.trim()
          ? `${payload.message.trim()} (HTTP ${response.status})`
          : `HTTP ${response.status}`;
        const error = new Error(detail);
        error.status = response.status;
        error.rateRemaining = response.headers.get("x-ratelimit-remaining");
        error.challengeRequired = response.status === 403
          && payload?.name === "ChallengeRequiredError";
        throw error;
      }
      return { payload, response };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function collectDblp(paper) {
    const { payload } = await fetchJson(
      buildDblpSearchUrl(paper.title, paper.authors[0]),
      { Accept: "application/json" },
    );
    return parseDblp(payload, paper);
  }

  async function collectOpenReviewVersion(paper, version) {
    const { payload } = await fetchJson(buildOpenReviewSearchUrl(paper.title, version), { Accept: "application/json" });
    const candidates = parseOpenReviewSearch(payload, paper, version);
    const strong = candidates
      .filter((record) => record.matchScore >= AUTO_MATCH_THRESHOLD)
      .sort((left, right) => right.matchScore - left.matchScore);
    const expanded = await Promise.all(strong.map(async (record) => {
      try {
        const forum = await fetchJson(buildOpenReviewForumUrl(record.forumId, version), { Accept: "application/json" });
        return parseOpenReviewForum(forum.payload, record.raw, paper, version);
      } catch (error) {
        return [{
          ...record,
          collectionWarning: `Forum lookup failed: ${errorMessage(error)}`,
          ...(error.challengeRequired
            ? { collectionWarningUrl: openReviewChallengeUrl(paper, record.forumId) }
            : {}),
        }];
      }
    }));
    const strongIds = new Set(strong.map((record) => record.sourceId));
    return [...expanded.flat(), ...candidates.filter((record) => !strongIds.has(record.sourceId))];
  }

  async function collectOpenReview(paper) {
    let v2Error = null;
    let v2Records = [];
    try {
      v2Records = await collectOpenReviewVersion(paper, 2);
      if (v2Records.some((record) => record.matchScore >= AUTO_MATCH_THRESHOLD)) {
        return { records: v2Records, version: 2 };
      }
    } catch (error) {
      v2Error = error;
    }
    try {
      const v1Records = await collectOpenReviewVersion(paper, 1);
      const v1Forums = new Set(v1Records.map((record) => record.forumId).filter(Boolean));
      const result = {
        records: [...v1Records, ...v2Records.filter((record) => !v1Forums.has(record.forumId))],
        version: 1,
      };
      if (v2Error) result.warning = `OpenReview v2 search failed: ${errorMessage(v2Error)}`;
      if (v2Error?.challengeRequired) result.manualUrl = openReviewChallengeUrl(paper);
      return result;
    } catch (error) {
      const failure = new Error(
        `OpenReview v2: ${errorMessage(v2Error ?? "no usable candidates")}; v1: ${errorMessage(error)}`,
      );
      if (v2Error?.challengeRequired || error?.challengeRequired) {
        failure.manualUrl = openReviewChallengeUrl(paper);
      }
      throw failure;
    }
  }

  async function analyze(paper, refresh) {
    const key = cacheKey(paper.arxivId);
    if (!refresh) {
      const cached = (await storageLocal.get(key))[key];
      if (isFreshCache(cached, now())) return { ...cached.data, fromCache: true };
    }

    const [dblp, openreview] = await Promise.allSettled([
      collectDblp(paper),
      collectOpenReview(paper),
    ]);
    const dblpRecords = dblp.status === "fulfilled" ? dblp.value : [];
    const openreviewRecords = openreview.status === "fulfilled" ? openreview.value.records : [];
    const resolved = resolveRecords([...dblpRecords, ...openreviewRecords]);
    const savedAt = now();
    const data = {
      ...resolved,
      arxivId: paper.arxivId,
      savedAt,
      fromCache: false,
      sources: {
        dblp: dblp.status === "fulfilled"
          ? { status: dblpRecords.length ? "success" : "empty", count: dblpRecords.length }
          : { status: "error", count: 0, error: errorMessage(dblp.reason) },
        openreview: openreview.status === "fulfilled"
          ? {
              status: openreviewRecords.length ? "success" : "empty",
              count: openreviewRecords.length,
              version: openreview.value.version,
            }
          : {
              status: "error",
              count: 0,
              error: errorMessage(openreview.reason),
            },
      },
    };
    const warnings = [...new Set([
      ...openreviewRecords.map((record) => record.collectionWarning),
      openreview.status === "fulfilled" ? openreview.value.warning : "",
    ].filter(Boolean))];
    if (warnings.length) data.sources.openreview.warning = warnings.join("; ");
    const openReviewManualUrl = openreview.status === "fulfilled"
      ? openreview.value.manualUrl
        ?? openreviewRecords.find((record) => record.collectionWarningUrl)?.collectionWarningUrl
      : openreview.reason?.manualUrl;
    if (openReviewManualUrl) data.sources.openreview.manualUrl = openReviewManualUrl;
    if (dblp.status === "fulfilled" || openreview.status === "fulfilled") {
      try {
        await storageLocal.set({ [key]: { savedAt, data } });
      } catch (error) {
        data.cacheWarning = `Cache unavailable: ${errorMessage(error)}`;
      }
    }
    return data;
  }

  async function searchGitHub(paper) {
    const search = buildGitHubSearch(paper.title);
    try {
      const { payload, response } = await fetchJson(search.apiUrl, {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      });
      return {
        candidates: parseGitHub(payload),
        manualUrl: search.webUrl,
        rateRemaining: Number(response.headers.get("x-ratelimit-remaining")),
      };
    } catch (error) {
      const failure = new Error(`GitHub search failed: ${errorMessage(error)}`);
      failure.data = { manualUrl: search.webUrl, rateRemaining: Number(error.rateRemaining) };
      throw failure;
    }
  }

  async function handleMessage(message) {
    const validation = validateMessage(message);
    if (!validation.ok) return validation;
    try {
      if (message.type === "ANALYZE_PAPER") return { ok: true, data: await analyze(message.paper, false) };
      if (message.type === "REFRESH_PAPER") return { ok: true, data: await analyze(message.paper, true) };
      if (message.type === "SEARCH_GITHUB") return { ok: true, data: await searchGitHub(message.paper) };
      const downloadId = await downloads.download({
        url: message.pdfUrl,
        filename: message.filename,
        saveAs: message.saveAs,
        conflictAction: "uniquify",
      });
      return { ok: true, data: { downloadId } };
    } catch (error) {
      return { ok: false, error: errorMessage(error), data: error?.data };
    }
  }

  return { handleMessage };
}

if (globalThis.chrome?.runtime?.onMessage) {
  const service = createService({
    fetchImpl: globalThis.fetch.bind(globalThis),
    storageLocal: chrome.storage.local,
    downloads: chrome.downloads,
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isTrustedSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, error: "Untrusted message sender." });
      return false;
    }
    service.handleMessage(message).then(sendResponse);
    return true;
  });
}
