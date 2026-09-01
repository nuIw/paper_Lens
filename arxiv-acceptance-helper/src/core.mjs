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
  const dice = (2 * shared) / (a.size + b.size);
  const containment = shared / Math.min(a.size, b.size);
  return Number((dice * 0.85 + containment * 0.15).toFixed(3));
}

const AUTHOR_SUFFIXES = new Set(["ii", "iii", "iv", "jr", "junior", "sr", "senior"]);

function authorParts(author) {
  const raw = String(author ?? "").trim();
  const comma = raw.indexOf(",");
  let surnameTokens;
  let givenTokens;

  if (comma >= 0) {
    surnameTokens = normalizeText(raw.slice(0, comma)).split(" ").filter(Boolean);
    givenTokens = normalizeText(raw.slice(comma + 1)).split(" ").filter(Boolean);
  } else {
    const tokens = normalizeText(raw).split(" ").filter(Boolean);
    while (tokens.length > 1 && AUTHOR_SUFFIXES.has(tokens.at(-1))) tokens.pop();
    surnameTokens = tokens.length ? [tokens.at(-1)] : [];
    givenTokens = tokens.slice(0, -1);
  }

  const surname = surnameTokens.join(" ");
  const given = givenTokens.join(" ");
  return {
    full: [given, surname].filter(Boolean).join(" "),
    surname,
    givenTokens,
  };
}

function initialsCompatible(left, right) {
  if (!left.length || !right.length || left[0][0] !== right[0][0]) return false;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) continue;
    if (left[index][0] !== right[index][0]) return false;
    if (left[index].length > 1 && right[index].length > 1) return false;
  }
  return true;
}

function compareAuthorNames(left, right) {
  if (!left.surname || left.surname !== right.surname) return { score: 0, kind: "none" };
  if (left.full && left.full === right.full) return { score: 1, kind: "exact" };
  if (!left.givenTokens.length || !right.givenTokens.length) return { score: 0.55, kind: "surname" };
  if (initialsCompatible(left.givenTokens, right.givenTokens)) return { score: 0.9, kind: "initials" };
  return { score: 0, kind: "surname-conflict" };
}

function authorEvidence(left, right) {
  const a = normalizeAuthors(left).map(authorParts).filter((author) => author.surname);
  const b = normalizeAuthors(right).map(authorParts).filter((author) => author.surname);
  const evidence = {
    score: 0,
    matched: 0,
    paperCount: a.length,
    recordCount: b.length,
    exact: 0,
    initials: 0,
    surnameOnly: 0,
  };
  if (!a.length || !b.length) return evidence;

  const candidates = [];
  for (let leftIndex = 0; leftIndex < a.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < b.length; rightIndex += 1) {
      const comparison = compareAuthorNames(a[leftIndex], b[rightIndex]);
      if (comparison.score > 0) candidates.push({ leftIndex, rightIndex, ...comparison });
    }
  }
  candidates.sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score);

  const usedLeft = new Set();
  const usedRight = new Set();
  let total = 0;
  for (const candidate of candidates) {
    if (usedLeft.has(candidate.leftIndex) || usedRight.has(candidate.rightIndex)) continue;
    usedLeft.add(candidate.leftIndex);
    usedRight.add(candidate.rightIndex);
    total += candidate.score;
    evidence.matched += 1;
    if (candidate.kind === "exact") evidence.exact += 1;
    if (candidate.kind === "initials") evidence.initials += 1;
    if (candidate.kind === "surname") evidence.surnameOnly += 1;
  }
  evidence.score = Number(((2 * total) / (a.length + b.length)).toFixed(3));
  return evidence;
}

function yearEvidence(paperYearValue, recordYearValue) {
  const paperYear = Number(paperYearValue);
  const recordYear = Number(recordYearValue);
  if (!Number.isInteger(paperYear) || !Number.isInteger(recordYear)) {
    return { paperYear: paperYear || null, recordYear: recordYear || null, distance: null, score: 0 };
  }
  const distance = recordYear - paperYear;
  let score;
  if (distance === 0 || distance === 1) score = 1;
  else if (distance === -1) score = 0.8;
  else if (distance === 2) score = 0.8;
  else if (distance === 3) score = 0.7;
  else if (distance === 4) score = 0.6;
  else if (distance === 5) score = 0.5;
  else if (distance > 5) score = 0.25;
  else score = 0;
  return { paperYear, recordYear, distance, score };
}

function scorePaperSnapshot(paper, record) {
  const paperDoi = normalizeDoi(paper?.publicationDoi || paper?.doi);
  const recordDoi = normalizeDoi(record?.publicationDoi || record?.doi);
  const paperArxiv = normalizeArxivId(paper?.arxivId);
  const recordArxiv = normalizeArxivId(record?.arxivId);
  const identifierConflict = (paperArxiv && recordArxiv && paperArxiv !== recordArxiv)
    ? "arxiv"
    : (paperDoi && recordDoi && paperDoi !== recordDoi) ? "doi" : "";

  if (paperArxiv && paperArxiv === recordArxiv) {
    return {
      score: 1,
      kind: "identifier",
      evidence: { identifier: "arXiv ID", identifierConflict: "", title: null, authors: null, year: null },
    };
  }
  if (paperDoi && paperDoi === recordDoi) {
    return {
      score: 1,
      kind: "identifier",
      evidence: { identifier: "publication DOI", identifierConflict: "", title: null, authors: null, year: null },
    };
  }

  const title = tokenSimilarity(paper?.title, record?.title);
  const authors = authorEvidence(paper?.authors, record?.authors);
  const year = yearEvidence(paper?.year, record?.year);
  let score = Number((title * 0.75 + authors.score * 0.2 + year.score * 0.05).toFixed(3));
  if (identifierConflict === "arxiv") score = Math.min(score, 0.49);
  if (identifierConflict === "doi" && title < 0.8) score = Math.min(score, 0.6);
  return {
    score,
    kind: title >= 0.93 && authors.score > 0 ? "title-authors" : "similarity",
    evidence: {
      identifier: "",
      identifierConflict,
      title,
      authors,
      year,
    },
  };
}

export function scorePaperMatch(paper, record) {
  const primary = scorePaperSnapshot(paper, record);
  if (primary.kind === "identifier" || !Array.isArray(paper?.metadataAliases)) return primary;

  let best = primary;
  for (const alias of paper.metadataAliases) {
    const candidate = scorePaperSnapshot({ ...paper, ...alias, metadataAliases: [] }, record);
    if (candidate.score > best.score) {
      best = {
        ...candidate,
        evidence: { ...candidate.evidence, metadataVersion: Number(alias.version) || null },
      };
    }
  }
  return best;
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

export function parseArxivCommentAcceptance(comment) {
  const raw = String(comment ?? "").replace(/\s+/g, " ").trim();
  if (!raw || /\b(?:not|never)\s+accepted\b|\bacceptance\s+(?:pending|unknown)\b|\bwithdrawn\b/i.test(raw)) return null;

  const patterns = [
    /\baccepted\s+to\s+appear\s+(?:at|in)\s+([^.;]+)/i,
    /\baccepted\s+(?:as|for)\s+(?:an?\s+)?(?:oral|poster|spotlight)(?:\s+presentation)?\s+at\s+([^.;]+)/i,
    /\baccepted\s+(?:at|in|to|by|for)\s+([^.;]+)/i,
    /\bto\s+appear\s+(?:at|in)\s+([^.;]+)/i,
    /\bpublished\s+(?:at|in)\s+([^.;]+)/i,
    /\bcamera[- ]ready(?:\s+version)?\s+(?:for|at)\s+([^.;]+)/i,
  ];
  const match = patterns.map((pattern) => raw.match(pattern)).find(Boolean);
  const nonAcceptanceState = /\b(?:submission|submitted|under review|in review|rejected|rejection)\b/i.test(raw);
  const standalone = /^(?:this\s+paper\s+(?:has\s+been\s+)?)?accepted(?:\s+with\s+(?:minor|major)\s+revisions?)?[.!]?$/i
    .test(raw);
  const venueHint = parseArxivCommentVenueHint(raw);
  const publicationStyleVenue = venueHint && (
    /^(?:the\s+)?(?:\d+(?:st|nd|rd|th)\s+)?(?:international|annual)?\s*(?:conference|symposium|workshop|proceedings|journal)\b/i.test(raw)
    || new RegExp(`^${escapeRegExp(venueHint.acronym)}\\s*${venueHint.year}(?:\\b|[,.;])`, "i").test(raw)
  );
  if (!match && (nonAcceptanceState || (!standalone && !publicationStyleVenue))) return null;

  const venueRaw = match
    ? String(match[1] ?? "")
        .replace(/\s*(?:\((?:oral|poster|spotlight)\)|,?\s+(?:as\s+)?(?:an?\s+)?(?:oral|poster|spotlight)(?:\s+presentation)?)\s*$/i, "")
        .trim()
    : venueHint?.venueRaw ?? "";
  const track = normalizeTrack(raw);
  return {
    decision: "accepted",
    venueRaw,
    year: Number(raw.match(/\b(19|20)\d{2}\b/)?.[0]) || null,
    track: ["main", "workshop", "findings"].includes(track) ? track : "unknown",
    presentation: normalizePresentation(raw),
    commentRaw: raw,
  };
}

const COMMENT_VENUE_ACRONYM_STOPWORDS = new Set(["ARXIV", "DOI", "HTTP", "HTTPS", "PDF"]);

export function parseArxivCommentVenueHint(comment) {
  const raw = String(comment ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const candidates = [
    ...raw.matchAll(/\(([A-Z][A-Z0-9.&-]{1,15})\s*[,/-]?\s*((?:19|20)\d{2})\)/g),
    ...raw.matchAll(/\b([A-Z][A-Z0-9.&-]{1,15})\s*[,/-]?\s*((?:19|20)\d{2})\b/g),
  ];
  for (const match of candidates) {
    const acronym = match[1].replace(/[.-]+$/g, "").toUpperCase();
    if (COMMENT_VENUE_ACRONYM_STOPWORDS.has(acronym)) continue;
    if ((acronym.match(/[A-Z]/g) ?? []).length < 2) continue;
    const year = Number(match[2]);
    return { acronym, venueRaw: `${acronym} ${year}`, year };
  }
  return null;
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const selectedTitle = mode === "full" ? title : (title.split(":", 1)[0].trim() || title);
  if (mode === "short") return sanitizeFilename(selectedTitle);
  const safeId = sanitizeFilename(id).slice(0, -4);
  let safeTitle = sanitizeFilename(selectedTitle).slice(0, -4).replace(/_+$/g, "") || "paper";
  const encoder = new TextEncoder();
  while (encoder.encode(`${safeTitle}_${safeId}.pdf`).length > 180) {
    safeTitle = Array.from(safeTitle).slice(0, -1).join("").replace(/[. _]+$/g, "");
  }
  return `${safeTitle}_${safeId}.pdf`;
}
