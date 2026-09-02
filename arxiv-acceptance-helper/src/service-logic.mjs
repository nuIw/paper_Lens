import { normalizeAuthors, normalizeText, sanitizeFilename } from "./core.mjs";

export const CACHE_SCHEMA_VERSION = 10;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const CACHE_PROBABLE_TTL_MS = 60 * 60 * 1000;
export const CACHE_ERROR_TTL_MS = 5 * 60 * 1000;
export const GITHUB_CACHE_TTL_MS = 60 * 60 * 1000;
export const GITHUB_INCOMPLETE_CACHE_TTL_MS = 5 * 60 * 1000;

const PAPER_MESSAGES = new Set(["ANALYZE_PAPER", "REFRESH_PAPER", "SEARCH_GITHUB"]);
const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})(?:v\d+)?$/;

export function canonicalArxivId(value) {
  return String(value ?? "").trim().replace(/v\d+$/i, "");
}

export function cacheKey(arxivId) {
  return `analysis:v10:${canonicalArxivId(arxivId)}`;
}

export function githubCacheKey(arxivId) {
  return `github:v3:${canonicalArxivId(arxivId)}`;
}

function paperFingerprints(paper) {
  return {
    titleFingerprint: normalizeText(paper?.title),
    authorsFingerprint: normalizeAuthors(paper?.authors).map(normalizeText).join("|"),
    commentFingerprint: normalizeText(paper?.comment),
    metadataVersion: Number(paper?.metadataVersion) || null,
    aliasesFingerprint: (Array.isArray(paper?.metadataAliases) ? paper.metadataAliases : [])
      .map((alias) => [
        Number(alias?.version) || "",
        normalizeText(alias?.title),
        normalizeAuthors(alias?.authors).map(normalizeText).join("|"),
      ].join(":"))
      .join("||"),
  };
}

export function buildCacheEntry(paper, data, savedAt, ttlMs = CACHE_TTL_MS) {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    arxivId: canonicalArxivId(paper?.arxivId),
    ...paperFingerprints(paper),
    savedAt,
    expiresAt: savedAt + ttlMs,
    data,
  };
}

export function isFreshCache(entry, paper, now = Date.now()) {
  const expected = paperFingerprints(paper);
  const savedAt = Number(entry?.savedAt);
  const expiresAt = Number(entry?.expiresAt);
  return entry?.schemaVersion === CACHE_SCHEMA_VERSION
    && entry?.arxivId === canonicalArxivId(paper?.arxivId)
    && entry?.titleFingerprint === expected.titleFingerprint
    && entry?.authorsFingerprint === expected.authorsFingerprint
    && entry?.commentFingerprint === expected.commentFingerprint
    && entry?.metadataVersion === expected.metadataVersion
    && entry?.aliasesFingerprint === expected.aliasesFingerprint
    && Number.isFinite(savedAt)
    && Number.isFinite(expiresAt)
    && savedAt <= now
    && now < expiresAt;
}

export function expiredCacheKeys(entries, prefix, now = Date.now()) {
  return Object.entries(entries ?? {})
    .filter(([key, entry]) => key.startsWith(prefix)
      && (!Number.isFinite(Number(entry?.expiresAt)) || Number(entry.expiresAt) <= now))
    .map(([key]) => key);
}

export function isAllowedPdfUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "arxiv.org"
      && !url.username
      && !url.password
      && /^\/pdf\/(?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})(?:v\d+)?(?:\.pdf)?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isTrustedSender(sender, extensionId) {
  const senderUrl = sender?.url ?? sender?.tab?.url;
  if (sender?.id !== extensionId || typeof senderUrl !== "string") return false;
  try {
    const url = new URL(senderUrl);
    return url.protocol === "https:"
      && url.hostname === "arxiv.org"
      && url.pathname.startsWith("/abs/");
  } catch {
    return false;
  }
}

function validatePaper(paper) {
  if (!paper || typeof paper !== "object") return "Paper metadata is required.";
  if (!ARXIV_ID.test(String(paper.arxivId ?? ""))) return "Invalid arXiv identifier.";
  if (typeof paper.title !== "string" || !paper.title.trim() || paper.title.length > 500) {
    return "Invalid paper title.";
  }
  if (!Array.isArray(paper.authors) || !paper.authors.length || paper.authors.length > 200
    || paper.authors.some((author) => typeof author !== "string" || !author.trim() || author.length > 200)) {
    return "Invalid author list.";
  }
  if (paper.comment != null && (typeof paper.comment !== "string" || paper.comment.length > 2_000)) {
    return "Invalid arXiv comment.";
  }
  if (paper.metadataVersion != null && (!Number.isInteger(paper.metadataVersion) || paper.metadataVersion < 1)) {
    return "Invalid arXiv metadata version.";
  }
  if (paper.metadataAliases != null && (!Array.isArray(paper.metadataAliases)
    || paper.metadataAliases.length > 3
    || paper.metadataAliases.some((alias) => !alias || typeof alias !== "object"
      || typeof alias.title !== "string" || !alias.title.trim() || alias.title.length > 500
      || !Array.isArray(alias.authors) || !alias.authors.length || alias.authors.length > 200
      || alias.authors.some((author) => typeof author !== "string" || !author.trim() || author.length > 200)
      || (alias.version != null && (!Number.isInteger(alias.version) || alias.version < 1))))) {
    return "Invalid arXiv metadata alias.";
  }
  if (paper.pdfUrl && !isAllowedPdfUrl(paper.pdfUrl)) return "Invalid arXiv PDF URL.";
  return null;
}

export function validateMessage(message) {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    return { ok: false, error: "Invalid message." };
  }

  if (message.type === "REQUEST_GITHUB_ACCESS") {
    return { ok: true, value: message };
  }

  if (PAPER_MESSAGES.has(message.type)) {
    if (message.openReviewSession != null
      && (message.type !== "REFRESH_PAPER" || typeof message.openReviewSession !== "boolean")) {
      return { ok: false, error: "OpenReview session access requires an explicit refresh." };
    }
    const error = validatePaper(message.paper);
    return error ? { ok: false, error } : { ok: true, value: message };
  }

  if (message.type === "DOWNLOAD_PDF") {
    if (!isAllowedPdfUrl(message.pdfUrl)) return { ok: false, error: "Invalid arXiv PDF URL." };
    if (typeof message.filename !== "string" || !message.filename.trim()
      || sanitizeFilename(message.filename) !== message.filename) {
      return { ok: false, error: "Invalid download filename." };
    }
    if (typeof message.saveAs !== "boolean") return { ok: false, error: "Invalid Save As setting." };
    return { ok: true, value: message };
  }

  return { ok: false, error: `Unsupported message: ${message.type}` };
}
