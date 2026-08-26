import { AUTO_MATCH_THRESHOLD, resolveRecords } from "./core.mjs";
import {
  buildDblpSearchUrl,
  buildGitHubSearch,
  buildOpenReviewForumUrl,
  buildOpenReviewSearchUrl,
  officialProceedingsCandidates,
  parseDblp,
  parseGitHub,
  parseOfficialProceedings,
  parseOpenReviewForum,
  parseOpenReviewSearch,
} from "./sources.mjs";
import {
  buildCacheEntry,
  CACHE_ERROR_TTL_MS,
  cacheKey,
  GITHUB_CACHE_TTL_MS,
  githubCacheKey,
  isFreshCache,
  isTrustedSender,
  validateMessage,
} from "./service-logic.mjs";

const REQUEST_TIMEOUT_MS = 12_000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function openReviewManualUrl(paper, forumId = "") {
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
  return target.href;
}

export function createService({ fetchImpl, storageLocal, storageSession, downloads, now = Date.now }) {
  const githubRequests = new Map();

  async function fetchWithTimeout(url, headers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetchImpl(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchJson(url, headers = {}) {
    const response = await fetchWithTimeout(url, headers);
    const isOpenReview = new URL(url).hostname.endsWith("openreview.net");
    const challengeCopy = isOpenReview && typeof response.clone === "function" ? response.clone() : null;
    let payload;
    let challengeHtml = false;
    try {
      payload = await response.json();
    } catch (error) {
      const html = challengeCopy && typeof challengeCopy.text === "function"
        ? await challengeCopy.text()
        : "";
      challengeHtml = /<title[^>]*>[^<]*(?:challenge|verification)|captcha|challenge-platform/i.test(html);
      if (response.ok) {
        if (challengeHtml) {
          const challenge = new Error("OpenReview requires interactive verification.");
          challenge.challengeRequired = true;
          challenge.manualRequired = true;
          throw challenge;
        }
        throw error;
      }
    }
    const redirectedToChallenge = isOpenReview && response.redirected
      && /\/challenge(?:[/?#]|$)/i.test(String(response.url ?? ""));
    if (!response.ok) {
      const detail = typeof payload?.message === "string" && payload.message.trim()
        ? `${payload.message.trim()} (HTTP ${response.status})`
        : `HTTP ${response.status}`;
      const error = new Error(detail);
      error.status = response.status;
      error.rateRemaining = response.headers.get("x-ratelimit-remaining");
      error.challengeRequired = isOpenReview && (
        payload?.name === "ChallengeRequiredError"
        || redirectedToChallenge
        || challengeHtml
      );
      error.manualRequired = error.challengeRequired || (isOpenReview && response.status === 429);
      throw error;
    }
    if (redirectedToChallenge || (isOpenReview && payload?.name === "ChallengeRequiredError")) {
      const error = new Error("OpenReview requires interactive verification.");
      error.challengeRequired = true;
      error.manualRequired = true;
      throw error;
    }
    return { payload, response };
  }

  async function fetchText(url) {
    const response = await fetchWithTimeout(url, { Accept: "text/html,application/xhtml+xml" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
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
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, 2);
    const expanded = await Promise.all(strong.map(async (record) => {
      try {
        const forum = await fetchJson(buildOpenReviewForumUrl(record.forumId, version), { Accept: "application/json" });
        return parseOpenReviewForum(forum.payload, record.raw, paper, version);
      } catch (error) {
        return [{
          ...record,
          collectionWarning: `Forum lookup failed: ${errorMessage(error)}`,
          ...(error.manualRequired
            ? { collectionWarningUrl: openReviewManualUrl(paper, record.forumId) }
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
      if (error?.manualRequired) {
        error.manualUrl = openReviewManualUrl(paper);
        throw error;
      }
    }
    try {
      const v1Records = await collectOpenReviewVersion(paper, 1);
      const v1Forums = new Set(v1Records.map((record) => record.forumId).filter(Boolean));
      const result = {
        records: [...v1Records, ...v2Records.filter((record) => !v1Forums.has(record.forumId))],
        version: 1,
      };
      if (v2Error) result.warning = `OpenReview v2 search failed: ${errorMessage(v2Error)}`;
      if (v2Error?.manualRequired) result.manualUrl = openReviewManualUrl(paper);
      return result;
    } catch (error) {
      const failure = new Error(
        `OpenReview v2: ${errorMessage(v2Error ?? "no usable candidates")}; v1: ${errorMessage(error)}`,
      );
      if (v2Error?.manualRequired || error?.manualRequired) {
        failure.manualUrl = openReviewManualUrl(paper);
      }
      throw failure;
    }
  }

  async function collectProceedings(paper, dblpRecords) {
    const candidates = officialProceedingsCandidates(
      dblpRecords.filter((record) => record.matchScore >= AUTO_MATCH_THRESHOLD),
    );
    const results = await Promise.allSettled(candidates.map(async (candidate) => (
      parseOfficialProceedings(await fetchText(candidate.url), candidate, paper)
    )));
    return { candidates, results };
  }

  async function analyze(paper, refresh) {
    const key = cacheKey(paper.arxivId);
    if (!refresh) {
      const cached = (await storageLocal.get(key))[key];
      if (isFreshCache(cached, paper, now())) return { ...cached.data, fromCache: true };
    }

    const [dblp, openreview] = await Promise.allSettled([
      collectDblp(paper),
      collectOpenReview(paper),
    ]);
    const dblpRecords = dblp.status === "fulfilled" ? dblp.value : [];
    const openreviewRecords = openreview.status === "fulfilled" ? openreview.value.records : [];
    const proceedings = await collectProceedings(paper, dblpRecords);
    const proceedingsRecords = proceedings.results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const proceedingsErrors = proceedings.results
      .filter((result) => result.status === "rejected")
      .map((result) => errorMessage(result.reason));
    const resolved = resolveRecords([...dblpRecords, ...openreviewRecords, ...proceedingsRecords]);
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
        proceedings: proceedings.candidates.length
          ? {
              status: proceedingsRecords.length ? "success" : "error",
              count: proceedingsRecords.length,
              ...(proceedingsErrors.length ? { warning: proceedingsErrors.join("; ") } : {}),
              ...(!proceedingsRecords.length ? { error: proceedingsErrors.join("; ") } : {}),
            }
          : { status: "empty", count: 0 },
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
        const hasSourceError = Object.values(data.sources).some((source) => source.status === "error");
        const entry = buildCacheEntry(paper, data, savedAt, hasSourceError ? CACHE_ERROR_TTL_MS : undefined);
        data.expiresAt = entry.expiresAt;
        await storageLocal.set({ [key]: entry });
      } catch (error) {
        data.cacheWarning = `Cache unavailable: ${errorMessage(error)}`;
      }
    }
    return data;
  }

  async function searchGitHub(paper) {
    const key = githubCacheKey(paper.arxivId);
    if (storageSession) {
      try {
        const cached = (await storageSession.get(key))[key];
        if (isFreshCache(cached, paper, now())) return { ...cached.data, fromCache: true };
      } catch {
        // A session-cache failure must not block the explicit search.
      }
    }
    if (githubRequests.has(key)) return githubRequests.get(key);

    const search = buildGitHubSearch(paper.title);
    const request = (async () => {
      const { payload, response } = await fetchJson(search.apiUrl, {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      });
      const savedAt = now();
      const data = {
        candidates: parseGitHub(payload),
        manualUrl: search.webUrl,
        rateRemaining: Number(response.headers.get("x-ratelimit-remaining")),
        savedAt,
        fromCache: false,
      };
      if (storageSession) {
        const entry = buildCacheEntry(paper, data, savedAt, GITHUB_CACHE_TTL_MS);
        data.expiresAt = entry.expiresAt;
        try {
          await storageSession.set({ [key]: entry });
        } catch {
          // The network result remains usable without the optional cache.
        }
      }
      return data;
    })();
    githubRequests.set(key, request);
    try {
      return await request;
    } catch (error) {
      const failure = new Error(`GitHub search failed: ${errorMessage(error)}`);
      failure.data = { manualUrl: search.webUrl, rateRemaining: Number(error.rateRemaining) };
      throw failure;
    } finally {
      githubRequests.delete(key);
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
    storageSession: chrome.storage.session,
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
