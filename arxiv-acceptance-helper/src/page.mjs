const SOURCE_PRIORITY = { "paper-html": 4, "paper-text": 3, "pdf-annotation": 2, "pdf-text": 1 };
const SOURCE_EVIDENCE = {
  "paper-html": "arXiv page link",
  "paper-text": "arXiv page visible text",
  "pdf-annotation": "PDF link annotation",
  "pdf-text": "PDF visible text",
};
const CLASSIFICATION_PRIORITY = {
  paperProjectLink: 3,
  unknownGithubLink: 2,
  unknownProjectLink: 2,
  citationProjectLink: 1,
};

export function parseArxivId(pathname) {
  const match = String(pathname ?? "").match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i);
  if (!match) return "";
  const id = match[1].replace(/v\d+$/i, "");
  return /^(?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})$/.test(id) ? id : "";
}

export function parseArxivVersion(pathname) {
  return Number(String(pathname ?? "").match(/v(\d+)(?:\.pdf)?$/i)?.[1]) || null;
}

export function cleanArxivLabel(text, label) {
  const value = String(text ?? "").trim();
  return value.toLowerCase().startsWith(String(label).toLowerCase())
    ? value.slice(String(label).length).trim()
    : value;
}

function hostLabel(hostname) {
  if (hostname === "github.com" || hostname.endsWith(".github.com")) return "GitHub";
  if (hostname === "gitlab.com" || hostname.endsWith(".gitlab.com")) return "GitLab";
  if (hostname === "bitbucket.org" || hostname.endsWith(".bitbucket.org")) return "Bitbucket";
  if (hostname === "codeberg.org" || hostname.endsWith(".codeberg.org")) return "Codeberg";
  if (hostname === "huggingface.co" || hostname.endsWith(".huggingface.co")) return "Hugging Face";
  if (hostname === "github.io" || hostname.endsWith(".github.io")) return "Project page";
  if (hostname === "gitlab.io" || hostname.endsWith(".gitlab.io")) return "Project page";
  return null;
}

function isBlockedHost(hostname) {
  return ["arxiv.org", "doi.org", "dblp.org", "openreview.net"]
    .some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function normalizeProjectUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url;
  } catch {
    return null;
  }
}

export function classifyProjectUrl(value, context = {}) {
  const url = normalizeProjectUrl(value);
  if (!url || isBlockedHost(url.hostname)) return null;
  const knownLabel = hostLabel(url.hostname);
  const evidenceContext = String(context.context ?? context.text ?? "").replace(/\s+/g, " ").trim();
  const hasProjectLabel = /\b(code|project|demo|homepage|implementation|repository|software|website)\b/i
    .test(evidenceContext);
  if (!knownLabel && !hasProjectLabel) return null;
  const section = String(context.section ?? (String(context.source).startsWith("paper-") ? "metadata" : "unknown"));
  const classification = context.classification
    ?? (section === "references"
      ? "citationProjectLink"
      : String(context.source).startsWith("paper-") || hasProjectLabel
        ? "paperProjectLink"
        : knownLabel === "GitHub" ? "unknownGithubLink" : "unknownProjectLink");
  return {
    url: url.href,
    host: url.hostname,
    label: knownLabel ?? "Project page",
    source: context.source ?? "paper-html",
    evidence: SOURCE_EVIDENCE[context.source] ?? "Paper-provided link",
    page: Number.isInteger(context.page) ? context.page : null,
    section,
    context: evidenceContext.slice(0, 700),
    classification,
  };
}

export function dedupeProjectLinks(links = []) {
  const unique = new Map();
  for (const input of links) {
    const link = classifyProjectUrl(input.url, input);
    if (!link) continue;
    const existing = unique.get(link.url);
    const classificationWins = (CLASSIFICATION_PRIORITY[link.classification] ?? 0)
      > (CLASSIFICATION_PRIORITY[existing?.classification] ?? 0);
    const sourceWins = (CLASSIFICATION_PRIORITY[link.classification] ?? 0)
      === (CLASSIFICATION_PRIORITY[existing?.classification] ?? 0)
      && (SOURCE_PRIORITY[link.source] ?? 0) > (SOURCE_PRIORITY[existing?.source] ?? 0);
    if (!existing || classificationWins || sourceWins) {
      unique.set(link.url, link);
    }
  }
  return [...unique.values()];
}

const DISPLAY = {
  accepted: "Accepted",
  under_review: "Under review",
  preprint: "Preprint",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  unknown: "Unknown",
  main: "Main",
  findings: "Findings",
  workshop: "Workshop",
  other: "Other",
  oral: "Oral",
  spotlight: "Spotlight",
  poster: "Poster",
  verified: "Verified",
  probable: "Probable",
  metadata_only: "Metadata only",
  conflicting: "Conflicting",
  candidate: "Candidate",
  self_reported: "Author-reported",
  unverified: "Unverified",
};

export function displayValue(value) {
  return DISPLAY[value] ?? String(value ?? "Unknown");
}

export function formatVenueYear(venueRaw, year) {
  const venue = String(venueRaw ?? "").trim() || "Venue not found";
  return year && !venue.includes(String(year)) ? `${venue} ${year}` : venue;
}

export function formatMatchEvidence(record = {}) {
  const evidence = record.matchEvidence;
  if (!evidence) return "";
  if (evidence.identifier) return `identifier ${evidence.identifier}`;

  const facts = [];
  if (Number.isFinite(evidence.title)) facts.push(`title ${Math.round(evidence.title * 100)}/100`);
  if (evidence.authors) {
    const authors = evidence.authors;
    const methods = [
      authors.exact ? `full-name ${authors.exact}` : "",
      authors.initials ? `initial-compatible ${authors.initials}` : "",
      authors.surnameOnly ? `surname-only ${authors.surnameOnly}` : "",
    ].filter(Boolean).join(", ");
    const counts = `${authors.matched} matched from ${authors.paperCount}/${authors.recordCount}`;
    facts.push(`authors ${counts}${methods ? ` (${methods})` : ""}`);
  }
  if (evidence.year?.distance != null) {
    const distance = evidence.year.distance;
    facts.push(distance === 0 ? "same year" : `publication year ${distance > 0 ? "+" : ""}${distance}`);
  }
  if (evidence.identifierConflict) facts.push(`${evidence.identifierConflict} identifier conflict`);
  if (evidence.metadataVersion) facts.push(`matched using arXiv v${evidence.metadataVersion} metadata`);
  return facts.join(" · ");
}

export function panelViewModel(analysis = {}, now = Date.now()) {
  const representative = analysis.representative ?? null;
  const venueWithYear = formatVenueYear(representative?.venueRaw, representative?.year);
  const decisionKey = representative?.decision ?? "preprint";
  const parts = [venueWithYear, displayValue(decisionKey)];
  if (representative?.track && !["unknown", "other"].includes(representative.track)) {
    parts.push(displayValue(representative.track));
  }
  if (representative?.presentation && representative.presentation !== "unknown") {
    parts.push(displayValue(representative.presentation));
  }

  const age = Math.max(0, now - Number(analysis.savedAt));
  const cacheLabel = analysis.fromCache && Number.isFinite(age)
    ? `cached ${age < 60_000 ? "just now" : age < 3_600_000 ? `${Math.floor(age / 60_000)}m ago` : `${Math.floor(age / 3_600_000)}h ago`}`
    : "";
  const verificationAxes = analysis.verificationAxes ?? {
    identity: analysis.verification ?? "unverified",
    decision: "unverified",
    track: "unverified",
  };

  const byIdentityStrength = (left, right) => {
    const scoreDifference = Number(right.matchScore ?? 0) - Number(left.matchScore ?? 0);
    return scoreDifference || Number(right.year ?? 0) - Number(left.year ?? 0);
  };
  const matchedRecords = (analysis.records ?? [])
    .filter((record) => record.confidence !== "candidate")
    .sort(byIdentityStrength);
  const candidateRecords = (analysis.records ?? [])
    .filter((record) => record.confidence === "candidate")
    .sort(byIdentityStrength);

  return {
    verification: analysis.verification ?? "unverified",
    verificationLabel: displayValue(analysis.verification ?? "unverified"),
    headline: parts.join(" · "),
    records: [...matchedRecords, ...candidateRecords],
    matchedRecords,
    candidateRecords,
    cacheLabel,
    verificationAxes,
    verificationAxesLabel: ["identity", "decision", "track"]
      .map((axis) => `${axis[0].toUpperCase()}${axis.slice(1)} ${displayValue(verificationAxes[axis])}`)
      .join(" · "),
    fallbackNotice: representative?.source === "arxiv-comment"
      ? "Based only on the author-provided arXiv comment; no external acceptance record was found."
      : "",
  };
}
