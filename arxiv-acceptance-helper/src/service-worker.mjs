import { AUTO_MATCH_THRESHOLD, parseArxivCommentAcceptance, resolveRecords } from "./core.mjs";
import {
  buildCrossrefSearchUrl,
  buildDblpSearchUrl,
  buildGitHubReadmeUrl,
  buildGitHubSearch,
  buildOpenReviewForumUrl,
  buildOpenReviewSearchUrl,
  buildSemanticScholarUrl,
  officialProceedingsCandidates,
  parseCrossref,
  parseDblp,
  parseGitHub,
  parseOfficialProceedings,
  parseOpenReviewForum,
  parseOpenReviewForumById,
  parseOpenReviewSearch,
  parseSemanticScholar,
  rankGitHubCandidates,
} from "./sources.mjs";
import {
  buildCacheEntry,
  CACHE_ERROR_TTL_MS,
  CACHE_PROBABLE_TTL_MS,
  cacheKey,
  expiredCacheKeys,
  GITHUB_CACHE_TTL_MS,
  GITHUB_INCOMPLETE_CACHE_TTL_MS,
  githubCacheKey,
  isFreshCache,
  isTrustedSender,
  validateMessage,
} from "./service-logic.mjs";

const REQUEST_TIMEOUT_MS = 12_000;
const GITHUB_ORIGIN = "https://api.github.com/*";
const GITHUB_SEARCH_BUDGET_KEY = "github:search-budget:v1";
const GITHUB_SEARCH_WINDOW_MS = 60 * 60 * 1000;
const GITHUB_SEARCH_LIMIT = 5;

function sourceRecordCounts(records) {
  const matchedCount = records.filter((record) => record.matchScore >= AUTO_MATCH_THRESHOLD).length;
  return {
    count: records.length,
    matchedCount,
    candidateCount: records.length - matchedCount,
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function numericHeader(response, name) {
  const value = response?.headers?.get(name);
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function recordKey(record) {
  return [record.source, record.sourceId ?? record.forumId, record.title, record.venueRaw, record.year]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("|");
}

function dedupeRecords(records) {
  return [...new Map(records.map((record) => [recordKey(record), record])).values()];
}

function titleVariants(title) {
  const full = String(title ?? "").trim();
  const suffix = full.includes(":") ? full.slice(full.indexOf(":") + 1).trim() : "";
  return [...new Set([full, suffix].filter(Boolean))].slice(0, 2);
}

function paperTitleVariants(paper) {
  const titles = [paper.title, ...(paper.metadataAliases ?? []).map((alias) => alias.title)];
  return [...new Set(titles.flatMap(titleVariants).filter(Boolean))].slice(0, 4);
}

function isStrongPublication(record) {
  return record.matchScore >= AUTO_MATCH_THRESHOLD && record.decisionRaw !== "Preprint";
}

function isRetryableSourceError(error) {
  return error?.name === "AbortError"
    || error instanceof TypeError;
}

function openReviewForumHints(records) {
  const hints = new Map();
  for (const record of records) {
    if (record.matchScore < AUTO_MATCH_THRESHOLD) continue;
    for (const value of record.publicationUrls ?? []) {
      try {
        const url = new URL(value);
        if (url.hostname.replace(/^www\./, "") !== "openreview.net") continue;
        if (!/^\/(?:forum|pdf)$/.test(url.pathname)) continue;
        const forumId = url.searchParams.get("id")?.trim();
        if (forumId && !hints.has(forumId)) hints.set(forumId, { forumId, record });
      } catch {
        // Ignore malformed bibliographic links.
      }
    }
  }
  return [...hints.values()].slice(0, 2);
}

function openReviewVersionOrder(record, paper) {
  const year = Number(record?.year ?? paper?.year);
  return year && year <= 2023 ? [1, 2] : [2, 1];
}

export function createService({
  fetchImpl,
  storageLocal,
  storageSession,
  downloads,
  permissions,
  now = Date.now,
}) {
  const githubRequests = new Map();
  let githubSearchTimestamps = [];
  let githubQueue = Promise.resolve();

  async function fetchWithTimeout(url, headers, credentials = "omit") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetchImpl(url, {
        headers,
        signal: controller.signal,
        credentials,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchJson(url, headers = {}, credentials = "omit") {
    const response = await fetchWithTimeout(url, headers, credentials);
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
      error.rateReset = response.headers.get("x-ratelimit-reset");
      error.retryAfter = response.headers.get("retry-after");
      error.rateResource = response.headers.get("x-ratelimit-resource");
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

  async function fetchTextWithResponse(
    url,
    headers = { Accept: "text/html,application/xhtml+xml" },
    credentials = "omit",
  ) {
    const response = await fetchWithTimeout(url, headers, credentials);
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.rateRemaining = response.headers.get("x-ratelimit-remaining");
      error.rateReset = response.headers.get("x-ratelimit-reset");
      error.retryAfter = response.headers.get("retry-after");
      error.rateResource = response.headers.get("x-ratelimit-resource");
      throw error;
    }
    return { text: await response.text(), response };
  }

  async function fetchText(url, headers = { Accept: "text/html,application/xhtml+xml" }) {
    return (await fetchTextWithResponse(url, headers)).text;
  }

  async function requireOptionalPermission(request, label) {
    if (!permissions) return;
    if (!(await permissions.request(request))) {
      throw new Error(`${label} permission was not granted.`);
    }
  }

  async function hasGitHubPermission() {
    return !permissions || permissions.contains({ origins: [GITHUB_ORIGIN] });
  }

  async function consumeGitHubSearchBudget() {
    const cutoff = now() - GITHUB_SEARCH_WINDOW_MS;
    if (storageSession) {
      try {
        const stored = (await storageSession.get(GITHUB_SEARCH_BUDGET_KEY))[GITHUB_SEARCH_BUDGET_KEY];
        if (Array.isArray(stored)) githubSearchTimestamps = stored;
      } catch {
        // Keep the in-memory budget when session storage is unavailable.
      }
    }
    githubSearchTimestamps = githubSearchTimestamps
      .map(Number)
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > cutoff);
    if (githubSearchTimestamps.length >= GITHUB_SEARCH_LIMIT) {
      throw new Error("This extension allows five GitHub searches per hour. Please try again later.");
    }
    githubSearchTimestamps.push(now());
    if (storageSession) {
      try {
        await storageSession.set({ [GITHUB_SEARCH_BUDGET_KEY]: githubSearchTimestamps });
      } catch {
        // The in-memory limit still protects this service-worker lifetime.
      }
    }
  }

  async function collectDblp(paper) {
    async function search(title, author = "") {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const { payload } = await fetchJson(
            buildDblpSearchUrl(title, author),
            { Accept: "application/json" },
          );
          return parseDblp(payload, paper);
        } catch (error) {
          lastError = error;
          if (attempt > 0 || !isRetryableSourceError(error) || error?.status === 429) throw error;
        }
      }
      throw lastError;
    }

    const records = [];
    const errors = [];
    const searched = new Set();
    const runSearch = async (query, author = "") => {
      const normalized = `${String(query ?? "").trim()}\u0000${String(author ?? "").trim()}`.toLocaleLowerCase();
      if (!String(query ?? "").trim() || searched.has(normalized)) return { ok: true };
      searched.add(normalized);
      try {
        records.push(...await search(query, author));
        return { ok: true };
      } catch (error) {
        errors.push(`${query}${author ? ` + ${author}` : ""}: ${errorMessage(error)}`);
        return { ok: false, error };
      }
    };

    // DBLP title queries behave like token AND searches. Try the title and its
    // suffix first, then one author-disambiguated query and historical aliases.
    const variants = paperTitleVariants(paper);
    const currentVariants = titleVariants(paper.title);
    const retrievalPlan = [
      { title: currentVariants[0], author: "" },
      ...(currentVariants[1] ? [{ title: currentVariants[1], author: "" }] : []),
      { title: currentVariants[0], author: paper.authors[0] },
      ...variants
        .filter((title) => !currentVariants.includes(title))
        .map((title) => ({ title, author: "" })),
    ];
    let rateLimited = false;
    for (const { title, author } of retrievalPlan) {
      const result = await runSearch(title, author);
      if (!result.ok) {
        const status = Number(result.error?.status);
        rateLimited = status === 429;
        break;
      }
      if (records.some(isStrongPublication)) break;
    }

    if (!records.some(isStrongPublication) && !rateLimited) {
      const result = await runSearch(paper.arxivId);
      rateLimited = !result.ok && Number(result.error?.status) === 429;
    }

    if (!records.some(isStrongPublication) && !rateLimited) {
      const canonicalTitles = records
        .filter((record) => record.matchScore >= AUTO_MATCH_THRESHOLD && record.title)
        .map((record) => record.title);
      for (const title of canonicalTitles) {
        if (!(await runSearch(title)).ok) break;
        if (!records.some(isStrongPublication) && !(await runSearch(title, paper.authors[0])).ok) break;
        if (records.some(isStrongPublication)) break;
      }
    }

    if (!records.length && errors.length) throw new Error(`DBLP search failed: ${errors.join("; ")}`);
    return {
      records: dedupeRecords(records),
      complete: errors.length === 0,
      ...(errors.length ? { warning: `Some DBLP queries failed: ${errors.join("; ")}` } : {}),
    };
  }

  async function collectCrossref(paper) {
    async function search(metadata) {
      const { payload } = await fetchJson(
        buildCrossrefSearchUrl(metadata.title, metadata.authors[0]),
        { Accept: "application/json" },
      );
      return parseCrossref(payload, paper);
    }
    const records = [];
    const errors = [];
    try {
      records.push(...await search(paper));
    } catch (error) {
      throw error;
    }
    if (records.some(isStrongPublication)) return { records, complete: true };
    for (const alias of (paper.metadataAliases ?? []).slice(0, 2)) {
      try {
        records.push(...await search(alias));
      } catch (error) {
        errors.push(`${alias.title}: ${errorMessage(error)}`);
        break;
      }
      if (records.some(isStrongPublication)) break;
    }
    return {
      records: dedupeRecords(records),
      complete: errors.length === 0,
      ...(errors.length ? { warning: `Some Crossref queries failed: ${errors.join("; ")}` } : {}),
    };
  }

  async function collectSemanticScholar(paper) {
    const { payload } = await fetchJson(
      buildSemanticScholarUrl(paper.arxivId),
      { Accept: "application/json" },
    );
    return [parseSemanticScholar(payload, paper)];
  }

  async function collectOpenReviewVersion(paper, version, useSession = false) {
    const candidates = [];
    const errors = [];
    const titles = paperTitleVariants(paper);
    const searches = version === 2
      ? [
          ...titles.map((title) => ({ title, mode: "exact" })),
          ...titles.slice(0, 2).map((title) => ({ title, mode: "terms" })),
        ]
      : titles.map((title) => ({ title, mode: "terms" }));
    for (const { title, mode } of searches) {
      try {
        const { payload } = await fetchJson(
          buildOpenReviewSearchUrl(title, version, mode),
          { Accept: "application/json" },
          useSession ? "include" : "omit",
        );
        candidates.push(...parseOpenReviewSearch(payload, paper, version));
      } catch (error) {
        if (error?.manualRequired) throw error;
        errors.push(`${title} (${mode}): ${errorMessage(error)}`);
        continue;
      }
      if (candidates.some((record) => record.matchScore >= AUTO_MATCH_THRESHOLD)) {
        break;
      }
    }
    const dedupedCandidates = dedupeRecords(candidates);
    if (!dedupedCandidates.length && errors.length) {
      throw new Error(`OpenReview v${version} search failed: ${errors.join("; ")}`);
    }
    const strong = dedupedCandidates
      .filter((record) => record.matchScore >= AUTO_MATCH_THRESHOLD)
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, 2);
    const expanded = await Promise.all(strong.map(async (record) => {
      try {
        const forum = await fetchJson(
          buildOpenReviewForumUrl(record.forumId, version),
          { Accept: "application/json" },
          useSession ? "include" : "omit",
        );
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
    return {
      records: [...expanded.flat(), ...dedupedCandidates.filter((record) => !strongIds.has(record.sourceId))],
      ...(errors.length ? { warning: `Some OpenReview v${version} queries failed: ${errors.join("; ")}` } : {}),
    };
  }

  async function collectOpenReview(paper, useSession = false) {
    let v2Error = null;
    let v2Records = [];
    let v2Warning = "";
    try {
      const v2 = await collectOpenReviewVersion(paper, 2, useSession);
      v2Records = v2.records;
      v2Warning = v2.warning ?? "";
      if (v2Records.some((record) => record.matchScore >= AUTO_MATCH_THRESHOLD)) {
        return { records: v2Records, version: 2, ...(v2Warning ? { warning: v2Warning } : {}) };
      }
    } catch (error) {
      v2Error = error;
      if (error?.manualRequired) {
        error.manualUrl = openReviewManualUrl(paper);
        throw error;
      }
    }
    try {
      const v1 = await collectOpenReviewVersion(paper, 1, useSession);
      const v1Records = v1.records;
      const v1Forums = new Set(v1Records.map((record) => record.forumId).filter(Boolean));
      const result = {
        records: [...v1Records, ...v2Records.filter((record) => !v1Forums.has(record.forumId))],
        version: 1,
      };
      const warnings = [
        v2Warning,
        v2Error ? `OpenReview v2 search failed: ${errorMessage(v2Error)}` : "",
        v1.warning,
      ].filter(Boolean);
      if (warnings.length) result.warning = warnings.join("; ");
      if (v2Error?.manualRequired) result.manualUrl = openReviewManualUrl(paper);
      return result;
    } catch (error) {
      const failure = new Error(
        `OpenReview v2: ${errorMessage(v2Error ?? "no usable candidates")}; v1: ${errorMessage(error)}`,
      );
      if (v2Error?.manualRequired || error?.manualRequired) {
        failure.manualUrl = openReviewManualUrl(paper);
      }
      if (v2Records.length) {
        return {
          records: v2Records,
          version: 2,
          warning: failure.message,
          ...(failure.manualUrl ? { manualUrl: failure.manualUrl } : {}),
        };
      }
      throw failure;
    }
  }

  async function collectLinkedOpenReview(paper, metadataRecords, existingRecords, useSession = false) {
    const knownForums = new Set(existingRecords.map((record) => record.forumId).filter(Boolean));
    const hints = openReviewForumHints(metadataRecords).filter(({ forumId }) => !knownForums.has(forumId));
    const records = [];
    const warnings = [];
    const blockedForums = [];
    let manualUrl = "";
    let version = null;
    for (const { forumId, record } of hints) {
      const errors = [];
      for (const candidateVersion of openReviewVersionOrder(record, paper)) {
        try {
          const { payload } = await fetchJson(
            buildOpenReviewForumUrl(forumId, candidateVersion),
            { Accept: "application/json" },
            useSession ? "include" : "omit",
          );
          records.push(...parseOpenReviewForumById(payload, forumId, paper, candidateVersion));
          version = candidateVersion;
          errors.length = 0;
          break;
        } catch (error) {
          errors.push({ version: candidateVersion, error });
        }
      }
      if (errors.length) {
        warnings.push(`Linked forum lookup failed (${forumId}): ${errors
          .map(({ version: failedVersion, error }) => `v${failedVersion}: ${errorMessage(error)}`)
          .join("; ")}`);
        if (errors.some(({ error }) => error?.manualRequired)) {
          blockedForums.push(forumId);
          manualUrl ||= openReviewManualUrl(paper, forumId);
        }
      }
    }
    return {
      records: dedupeRecords(records),
      warnings,
      manualUrl,
      version,
      blockedForums,
      linkedForums: hints.map(({ forumId, record }) => ({
        forumId,
        url: openReviewManualUrl(paper, forumId),
        discoveredBy: record.source,
      })),
    };
  }

  async function collectProceedings(paper, metadataRecords) {
    const candidates = officialProceedingsCandidates(
      metadataRecords.filter((record) => record.matchScore >= AUTO_MATCH_THRESHOLD),
    );
    const results = await Promise.allSettled(candidates.map(async (candidate) => {
      try {
        return parseOfficialProceedings(await fetchText(candidate.url), candidate, paper);
      } catch (error) {
        if (candidate.discovery && error?.status === 404) return null;
        throw error;
      }
    }));
    return { candidates, results };
  }

  async function analyze(paper, refresh, useOpenReviewSession = false) {
    const key = cacheKey(paper.arxivId);
    let cached;
    try {
      const stored = await storageLocal.get(null);
      cached = stored[key];
      const expired = expiredCacheKeys(stored, "analysis:", now());
      if (expired.length) await storageLocal.remove(expired);
    } catch {
      // A cache read failure must not block live verification.
    }
    if (!refresh && isFreshCache(cached, paper, now())) return { ...cached.data, fromCache: true };

    const dblpPromise = Promise.allSettled([collectDblp(paper)]).then(([result]) => result);
    const crossrefPromise = Promise.allSettled([collectCrossref(paper)]).then(([result]) => result);
    const dblp = await dblpPromise;
    const dblpRecords = dblp.status === "fulfilled" ? dblp.value.records : [];
    const hasDblpForumHint = openReviewForumHints(dblpRecords).length > 0;
    let openreview = null;
    let linkedOpenReview = {
      records: [], warnings: [], manualUrl: "", version: null, blockedForums: [], linkedForums: [],
    };
    if (hasDblpForumHint) {
      linkedOpenReview = await collectLinkedOpenReview(paper, dblpRecords, [], useOpenReviewSession);
    } else {
      [openreview] = await Promise.allSettled([collectOpenReview(paper, useOpenReviewSession)]);
    }
    const crossref = await crossrefPromise;
    const needsSemanticScholar = !dblpRecords.some(isStrongPublication);
    const semanticscholar = needsSemanticScholar
      ? (await Promise.allSettled([collectSemanticScholar(paper)]))[0]
      : null;
    const initialOpenReviewRecords = openreview?.status === "fulfilled" ? openreview.value.records : [];
    const crossrefRecords = crossref.status === "fulfilled" ? crossref.value.records : [];
    const semanticScholarRecords = semanticscholar?.status === "fulfilled" ? semanticscholar.value : [];
    if (!hasDblpForumHint) {
      linkedOpenReview = await collectLinkedOpenReview(
        paper,
        [...dblpRecords, ...crossrefRecords],
        initialOpenReviewRecords,
        useOpenReviewSession,
      );
    }
    const openreviewRecords = dedupeRecords([...initialOpenReviewRecords, ...linkedOpenReview.records]);
    const proceedings = await collectProceedings(
      paper,
      [...dblpRecords, ...crossrefRecords, ...semanticScholarRecords],
    );
    const proceedingsRecords = proceedings.results
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    const proceedingsErrors = proceedings.results
      .filter((result) => result.status === "rejected")
      .map((result) => errorMessage(result.reason));
    const dblpCounts = sourceRecordCounts(dblpRecords);
    const openreviewCounts = sourceRecordCounts(openreviewRecords);
    const crossrefCounts = sourceRecordCounts(crossrefRecords);
    const semanticScholarCounts = sourceRecordCounts(semanticScholarRecords);
    const proceedingsCounts = sourceRecordCounts(proceedingsRecords);
    const resolved = resolveRecords([
      ...dblpRecords,
      ...openreviewRecords,
      ...crossrefRecords,
      ...semanticScholarRecords,
      ...proceedingsRecords,
    ]);
    const commentAcceptance = parseArxivCommentAcceptance(paper.comment);
    const hasExternalTerminalDecision = resolved.records.some((record) => (
      record.confidence !== "candidate" && ["accepted", "rejected", "withdrawn"].includes(record.decision)
    ));
    if (commentAcceptance && !hasExternalTerminalDecision) {
      const trackReported = commentAcceptance.track !== "unknown";
      resolved.representative = {
        source: "arxiv-comment",
        sourceId: paper.arxivId,
        sourceUrl: paper.pageUrl,
        title: paper.title,
        authors: paper.authors,
        venueRaw: commentAcceptance.venueRaw,
        decisionRaw: commentAcceptance.commentRaw,
        decision: "accepted",
        trackRaw: trackReported ? commentAcceptance.track : "",
        track: commentAcceptance.track,
        presentationRaw: commentAcceptance.commentRaw,
        presentation: commentAcceptance.presentation,
        year: commentAcceptance.year,
        confidence: "self_reported",
        evidenceType: "author-comment",
        sourceVersion: Number(paper.metadataVersion) || null,
        verification: {
          identity: "verified",
          decision: "self_reported",
          track: trackReported ? "self_reported" : "unverified",
        },
      };
      resolved.verification = "self_reported";
      resolved.verificationAxes = resolved.representative.verification;
    }
    const currentLookupFailed = dblp.status === "rejected"
      || openreview?.status === "rejected"
      || linkedOpenReview.blockedForums.length > 0
      || crossref.status === "rejected"
      || semanticscholar?.status === "rejected";
    const previous = refresh && isFreshCache(cached, paper, now()) ? cached.data : null;
    const previousRepresentative = previous?.representative;
    if (currentLookupFailed
      && previousRepresentative
      && previousRepresentative.source !== "arxiv-comment"
      && (!resolved.representative || resolved.representative.source === "arxiv-comment")) {
      resolved.records = dedupeRecords([...resolved.records, ...(previous.records ?? [])]);
      resolved.representative = { ...previousRepresentative, evidenceFreshness: "previous" };
      resolved.verification = previous.verification;
      resolved.verificationAxes = previous.verificationAxes;
      resolved.usingPreviousEvidence = true;
      resolved.staleEvidenceWarning = "Live verification failed; showing previously verified external evidence while retry remains available.";
    }
    const savedAt = now();
    const data = {
      ...resolved,
      arxivId: paper.arxivId,
      metadataVersion: Number(paper.metadataVersion) || null,
      savedAt,
      fromCache: false,
      sources: {
        dblp: dblp.status === "fulfilled"
          ? {
              status: dblp.value.warning ? "partial" : dblpRecords.length ? "success" : "empty",
              ...dblpCounts,
              ...(dblp.value.warning ? { warning: dblp.value.warning } : {}),
            }
          : { status: "error", ...sourceRecordCounts([]), error: errorMessage(dblp.reason) },
        openreview: openreview?.status === "fulfilled" || openreviewRecords.length
          ? {
              status: openreviewRecords.length ? "success" : "empty",
              ...openreviewCounts,
              version: linkedOpenReview.version ?? openreview?.value?.version,
            }
          : linkedOpenReview.blockedForums.length
            ? {
                status: "linked_blocked",
                ...openreviewCounts,
                apiVerified: false,
                linkedForums: linkedOpenReview.linkedForums,
                error: "OpenReview API verification was blocked by interactive verification.",
              }
          : {
              status: "error",
              ...sourceRecordCounts([]),
              error: linkedOpenReview.warnings[0] ?? errorMessage(openreview?.reason ?? "OpenReview lookup failed"),
            },
        crossref: crossref.status === "fulfilled"
          ? {
              status: crossref.value.warning ? "partial" : crossrefRecords.length ? "success" : "empty",
              ...crossrefCounts,
              ...(crossref.value.warning ? { warning: crossref.value.warning } : {}),
            }
          : { status: "error", ...sourceRecordCounts([]), error: errorMessage(crossref.reason) },
        ...(semanticscholar ? {
          semanticscholar: semanticscholar.status === "fulfilled"
            ? {
                status: semanticScholarRecords.length ? "success" : "empty",
                ...semanticScholarCounts,
              }
            : { status: "error", ...sourceRecordCounts([]), error: errorMessage(semanticscholar.reason) },
        } : {}),
        proceedings: proceedings.candidates.length
          ? {
              status: proceedingsRecords.length
                ? proceedingsErrors.length ? "partial" : "success"
                : proceedingsErrors.length ? "error" : "empty",
              ...proceedingsCounts,
              ...(proceedingsErrors.length ? { warning: proceedingsErrors.join("; ") } : {}),
              ...(!proceedingsRecords.length && proceedingsErrors.length
                ? { error: proceedingsErrors.join("; ") }
                : {}),
            }
          : { status: "empty", ...sourceRecordCounts([]) },
      },
    };
    const warnings = [...new Set([
      ...openreviewRecords.map((record) => record.collectionWarning),
      openreview?.status === "fulfilled" ? openreview.value.warning : "",
      openreview?.status === "rejected" && openreviewRecords.length
        ? `OpenReview title search failed: ${errorMessage(openreview.reason)}`
        : "",
      ...linkedOpenReview.warnings,
    ].filter(Boolean))];
    if (warnings.length) data.sources.openreview.warning = warnings.join("; ");
    if (warnings.length && !["error", "linked_blocked"].includes(data.sources.openreview.status)) {
      data.sources.openreview.status = "partial";
    }
    if (linkedOpenReview.linkedForums.length) {
      data.sources.openreview.linkedForums = linkedOpenReview.linkedForums;
      data.sources.openreview.apiVerified = linkedOpenReview.records.length > 0;
    }
    const openReviewManualUrl = linkedOpenReview.manualUrl
      || openreviewRecords.find((record) => record.collectionWarningUrl)?.collectionWarningUrl
      || (openreview?.status === "fulfilled" ? openreview.value.manualUrl : openreview?.reason?.manualUrl);
    if (openReviewManualUrl) data.sources.openreview.manualUrl = openReviewManualUrl;
    if (dblp.status === "fulfilled" || openreview?.status === "fulfilled" || linkedOpenReview.linkedForums.length
      || crossref.status === "fulfilled" || semanticscholar?.status === "fulfilled") {
      try {
        const hasIncompleteSource = Object.values(data.sources).some((source) => (
          source.status === "error" || source.status === "partial" || source.warning
        ));
        const ttlMs = hasIncompleteSource
          ? hasExternalTerminalDecision ? CACHE_PROBABLE_TTL_MS : CACHE_ERROR_TTL_MS
          : undefined;
        const entry = buildCacheEntry(paper, data, savedAt, ttlMs);
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

    const search = buildGitHubSearch(paper);
    const request = (async () => {
      await consumeGitHubSearchBudget();
      const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      const primary = await fetchJson(search.apiUrl, headers);
      const groups = [parseGitHub(primary.payload, search.provenance)];
      const responses = [primary.response];
      let incompleteResults = primary.payload.incomplete_results === true;
      let searchWarning = "";
      const identifierSearch = buildGitHubSearch(paper, "identifier");
      if (numericHeader(primary.response, "x-ratelimit-remaining") === 0) {
        incompleteResults = true;
        searchWarning = "GitHub search limit reached before the identifier fallback.";
      } else {
        try {
          const result = await fetchJson(identifierSearch.apiUrl, headers);
          groups.push(parseGitHub(result.payload, identifierSearch.provenance));
          responses.push(result.response);
          incompleteResults ||= result.payload.incomplete_results === true;
        } catch (error) {
          searchWarning = `Identifier fallback failed: ${errorMessage(error)}`;
        }
      }

      const readmeCandidates = [...new Map(groups.flatMap((group) => (
        rankGitHubCandidates(paper, group).slice(0, 4)
      )).map((candidate) => [candidate.name.toLowerCase(), candidate])).values()].slice(0, 8);
      const readmes = {};
      let readmeIncomplete = false;
      const readmeWarnings = [];
      for (let index = 0; index < readmeCandidates.length; index += 2) {
        const batch = readmeCandidates.slice(index, index + 2);
        const readmeResults = await Promise.allSettled(batch.map(async (candidate) => {
          const url = buildGitHubReadmeUrl(candidate.name);
          if (!url) throw new Error("Invalid GitHub repository name.");
          const result = await fetchTextWithResponse(url, {
            Accept: "application/vnd.github.raw+json",
            "X-GitHub-Api-Version": "2022-11-28",
          });
          return [candidate.name, result.text.slice(0, 100_000), result.response];
        }));
        let rateLimited = false;
        for (const result of readmeResults) {
          if (result.status === "fulfilled") {
            const [name, readme, response] = result.value;
            readmes[name] = readme;
            responses.push(response);
            rateLimited ||= numericHeader(response, "x-ratelimit-remaining") === 0;
          } else {
            readmeIncomplete = true;
            readmeWarnings.push(errorMessage(result.reason));
            rateLimited ||= [403, 429].includes(Number(result.reason?.status));
          }
        }
        if (rateLimited && index + batch.length < readmeCandidates.length) {
          readmeIncomplete = true;
          break;
        }
      }
      const rateRemainingValues = responses
        .map((response) => numericHeader(response, "x-ratelimit-remaining"))
        .filter((value) => value != null);
      const rateResetValues = responses
        .map((response) => numericHeader(response, "x-ratelimit-reset"))
        .filter((value) => value != null);
      const savedAt = now();
      const data = {
        candidates: rankGitHubCandidates(paper, groups.flat(), readmes),
        manualUrl: search.webUrl,
        rateRemaining: rateRemainingValues.length ? Math.min(...rateRemainingValues) : null,
        rateReset: rateResetValues.length ? Math.max(...rateResetValues) : null,
        incompleteResults,
        readmeIncomplete,
        ...(searchWarning ? { searchWarning } : {}),
        ...(readmeWarnings.length ? { readmeWarning: [...new Set(readmeWarnings)].join("; ") } : {}),
        savedAt,
        fromCache: false,
      };
      if (storageSession) {
        const partial = incompleteResults || readmeIncomplete || Boolean(searchWarning);
        const ttl = partial ? GITHUB_INCOMPLETE_CACHE_TTL_MS : GITHUB_CACHE_TTL_MS;
        const entry = buildCacheEntry(paper, data, savedAt, ttl);
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
      failure.data = {
        manualUrl: search.webUrl,
        rateRemaining: error.rateRemaining == null ? null : Number(error.rateRemaining),
        rateReset: error.rateReset == null ? null : Number(error.rateReset),
        retryAfter: error.retryAfter ?? null,
      };
      throw failure;
    } finally {
      githubRequests.delete(key);
    }
  }

  function queueGitHubSearch(paper) {
    const next = githubQueue.then(
      () => searchGitHub(paper),
      () => searchGitHub(paper),
    );
    githubQueue = next.catch(() => {});
    return next;
  }

  async function handleMessage(message) {
    const validation = validateMessage(message);
    if (!validation.ok) return validation;
    try {
      if (message.type === "ANALYZE_PAPER") return { ok: true, data: await analyze(message.paper, false) };
      if (message.type === "REFRESH_PAPER") {
        return {
          ok: true,
          data: await analyze(message.paper, true, message.openReviewSession === true),
        };
      }
      if (message.type === "REQUEST_GITHUB_ACCESS") {
        await requireOptionalPermission({ origins: [GITHUB_ORIGIN] }, "GitHub access");
        return { ok: true, data: { granted: true } };
      }
      if (message.type === "SEARCH_GITHUB") {
        if (!(await hasGitHubPermission())) throw new Error("GitHub access permission is required.");
        return { ok: true, data: await queueGitHubSearch(message.paper) };
      }
      await requireOptionalPermission({ permissions: ["downloads"] }, "Download");
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
  Promise.resolve(chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })).catch(() => {});
  const service = createService({
    fetchImpl: globalThis.fetch.bind(globalThis),
    storageLocal: chrome.storage.local,
    storageSession: chrome.storage.session,
    downloads: chrome.downloads,
    permissions: chrome.permissions,
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
