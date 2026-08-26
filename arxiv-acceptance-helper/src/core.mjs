const TERMINAL_DECISIONS = new Set(["accepted", "rejected", "withdrawn"]);
const NON_VENUE_TOKENS = new Set([
  "accepted", "cc", "conf", "conference", "desk", "main", "proceedings",
  "rejected", "review", "submission", "submitted", "to", "under", "withdrawn",
]);
const DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const AUTO_MATCH_THRESHOLD = 0.82;

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeAuthors(authors) {
  const list = Array.isArray(authors) ? authors : authors ? [authors] : [];
  return list
    .map((author) => {
      if (typeof author === "string") return author.trim();
      return String(author?.text ?? author?.value ?? "").trim();
    })
    .filter(Boolean);
}

function normalizeDoi(value) {
  return String(value ?? "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
}

function normalizeArxivId(value) {
  return String(value ?? "")
    .trim()
    .replace(/^arxiv:/i, "")
    .replace(/v\d+$/i, "")
    .toLowerCase();
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizeText(left).split(" ").filter(Boolean));
  const b = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / (a.size + b.size - shared);
}

function authorKeys(authors) {
  return new Set(normalizeAuthors(authors).map((author) => {
    const parts = normalizeText(author.includes(",") ? author.split(",", 1)[0] : author)
      .split(" ")
      .filter(Boolean);
    return parts.at(-1) ?? "";
  }).filter(Boolean));
}

function authorOverlap(left, right) {
  const a = authorKeys(left);
  const b = authorKeys(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((name) => b.has(name)).length / Math.min(a.size, b.size);
}

export function scorePaperMatch(paper, record) {
  const paperDoi = normalizeDoi(paper?.publicationDoi ?? paper?.doi);
  const recordDoi = normalizeDoi(record?.publicationDoi ?? record?.doi);
  const paperArxiv = normalizeArxivId(paper?.arxivId);
  const recordArxiv = normalizeArxivId(record?.arxivId);

  if ((paperDoi && paperDoi === recordDoi) || (paperArxiv && paperArxiv === recordArxiv)) {
    return { score: 1, kind: "identifier" };
  }

  const title = tokenSimilarity(paper?.title, record?.title);
  const authors = authorOverlap(paper?.authors, record?.authors);
  const paperYear = Number(paper?.year);
  const recordYear = Number(record?.year);
  const year = paperYear && recordYear && Math.abs(paperYear - recordYear) <= 1 ? 1 : 0;
  const score = Number((title * 0.75 + authors * 0.2 + year * 0.05).toFixed(3));
  return { score, kind: title >= 0.95 && authors > 0 ? "title-authors" : "similarity" };
}

export function normalizeDecision(raw) {
  const value = normalizeText(raw);
  if (!value) return "preprint";
  if (/withdraw|withdrawn/.test(value)) return "withdrawn";
  if (/not accept|desk reject|reject|declin/.test(value)) return "rejected";
  if (/under review|in review|submitted|submission/.test(value)) return "under_review";
  if (/\baccept|accepted|publish|proceedings/.test(value)) return "accepted";
  if (/preprint|arxiv/.test(value)) return "preprint";
  return "unknown";
}

export function normalizeTrack(raw) {
  const value = normalizeText(raw);
  if (!value) return "unknown";
  if (/\bfindings\b/.test(value)) return "findings";
  if (/\bworkshop\b/.test(value)) return "workshop";
  if (/\bmain\b/.test(value)) return "main";
  return "other";
}

export function normalizePresentation(raw) {
  const value = normalizeText(raw);
  if (/\boral\b/.test(value)) return "oral";
  if (/\bspotlight\b/.test(value)) return "spotlight";
  if (/\bposter\b/.test(value)) return "poster";
  return "unknown";
}

function verificationAxesFor(record) {
  const score = Number(record.matchScore ?? 1);
  const identity = score < AUTO_MATCH_THRESHOLD
    ? "candidate"
    : record.matchKind === "identifier" ? "verified" : "probable";
  const decision = identity === "candidate"
    ? "unverified"
    : record.source === "proceedings" || (record.source === "openreview" && record.evidenceType === "decision")
      ? "verified"
      : record.decision === "unknown" ? "unverified" : "metadata_only";
  const track = identity === "candidate" || ["unknown", "other"].includes(record.track)
    ? "unverified"
    : record.source === "proceedings" && record.trackEvidence === "official"
      ? "verified"
      : record.source === "openreview" && record.trackRaw ? "probable" : "metadata_only";
  return { identity, decision, track };
}

function confidenceFor(record) {
  const axes = verificationAxesFor(record);
  if (axes.identity === "candidate") return "candidate";
  if (axes.decision === "verified") return "verified";
  if (record.decision === "unknown") return "metadata_only";
  return "probable";
}

function recordRank(record) {
  if (record.confidence === "candidate") return -1;
  if (record.decision === "accepted") {
    const sourceBonus = record.source === "proceedings"
      ? 20
      : record.source === "openreview" && record.evidenceType === "decision" ? 10 : 0;
    return { main: 800, findings: 700, workshop: 600, other: 500, unknown: 500 }[record.track] + sourceBonus;
  }
  return { under_review: 400, preprint: 300, unknown: 250, rejected: 200, withdrawn: 100 }[record.decision];
}

function hasConflict(records) {
  const groups = new Map();
  for (const record of records) {
    if (record.confidence === "candidate" || !TERMINAL_DECISIONS.has(record.decision)) continue;
    const venue = normalizeText(record.venueRaw)
      .split(" ")
      .filter((token) => !/^(?:19|20)\d{2}$/.test(token) && !NON_VENUE_TOKENS.has(token))
      .join(" ");
    if (!venue || !record.year) continue;
    const key = `${venue}:${record.year}`;
    const decisions = groups.get(key) ?? new Set();
    decisions.add(record.decision);
    groups.set(key, decisions);
  }
  return [...groups.values()].some((decisions) => decisions.size > 1);
}

export function resolveRecords(records = []) {
  const normalized = records.map((record) => {
    const decision = normalizeDecision(record.decisionRaw ?? record.venueRaw);
    const track = normalizeTrack(record.trackRaw);
    const presentation = normalizePresentation(record.presentationRaw ?? record.decisionRaw);
    const resolved = { ...record, decision, track, presentation };
    resolved.verification = verificationAxesFor(resolved);
    resolved.confidence = confidenceFor(resolved);
    return resolved;
  });

  const representative = normalized
    .filter((record) => record.confidence !== "candidate")
    .sort((left, right) => recordRank(right) - recordRank(left) || Number(right.year ?? 0) - Number(left.year ?? 0))[0] ?? null;
  const verification = hasConflict(normalized)
    ? "conflicting"
    : representative?.confidence ?? (normalized.length ? "metadata_only" : "unverified");

  return {
    representative,
    records: normalized,
    verification,
    verificationAxes: representative?.verification ?? {
      identity: normalized.length ? "candidate" : "unverified",
      decision: verification === "conflicting" ? "conflicting" : "unverified",
      track: "unverified",
    },
  };
}

export function sanitizeFilename(value) {
  let name = String(value ?? "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!name || /^\.+$/.test(name)) name = "paper.pdf";
  if (!/\.pdf$/i.test(name)) name += ".pdf";

  const base = name.slice(0, -4);
  if (DEVICE_NAMES.test(base.split(".", 1)[0])) name = `_${name}`;
  const encoder = new TextEncoder();
  if (encoder.encode(name).length > 180) {
    let shortened = "";
    for (const character of Array.from(name.slice(0, -4)).slice(0, 176)) {
      if (encoder.encode(`${shortened}${character}.pdf`).length > 180) break;
      shortened += character;
    }
    name = `${shortened.replace(/[. ]+$/g, "")}.pdf`;
  }
  return name;
}

export function buildFilename(paper, mode = "alias", custom = "") {
  const id = String(paper?.arxivId ?? "paper").replace(/[\\/]/g, "_");
  const title = String(paper?.title ?? "paper").trim() || "paper";
  if (mode === "custom" && String(custom).trim()) return sanitizeFilename(custom);
  if (mode === "id") return sanitizeFilename(id);
  const selectedTitle = mode === "full" ? title : (title.split(":", 1)[0].trim() || title);
  const safeId = sanitizeFilename(id).slice(0, -4);
  let safeTitle = sanitizeFilename(selectedTitle).slice(0, -4).replace(/_+$/g, "") || "paper";
  const encoder = new TextEncoder();
  while (encoder.encode(`${safeTitle}_${safeId}.pdf`).length > 180) {
    safeTitle = Array.from(safeTitle).slice(0, -1).join("").replace(/[. _]+$/g, "");
  }
  return `${safeTitle}_${safeId}.pdf`;
}
