import { sanitizeFilename } from "./core.mjs";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const PAPER_MESSAGES = new Set(["ANALYZE_PAPER", "REFRESH_PAPER", "SEARCH_GITHUB"]);
const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})(?:v\d+)?$/;

export function canonicalArxivId(value) {
  return String(value ?? "").trim().replace(/v\d+$/i, "");
}

export function cacheKey(arxivId) {
  return `analysis:v2:${canonicalArxivId(arxivId)}`;
}

export function isFreshCache(entry, now = Date.now()) {
  const savedAt = Number(entry?.savedAt);
  return Number.isFinite(savedAt) && savedAt <= now && now - savedAt < CACHE_TTL_MS;
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
  if (paper.pdfUrl && !isAllowedPdfUrl(paper.pdfUrl)) return "Invalid arXiv PDF URL.";
  return null;
}

export function validateMessage(message) {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    return { ok: false, error: "Invalid message." };
  }

  if (PAPER_MESSAGES.has(message.type)) {
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
