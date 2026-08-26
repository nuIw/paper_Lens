const SOURCE_PRIORITY = { "paper-html": 3, "pdf-annotation": 2, "pdf-text": 1 };
const SOURCE_EVIDENCE = {
  "paper-html": "arXiv page link",
  "pdf-annotation": "PDF link annotation",
  "pdf-text": "PDF visible text",
};

export function parseArxivId(pathname) {
  const match = String(pathname ?? "").match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i);
  if (!match) return "";
  const id = match[1].replace(/v\d+$/i, "");
  return /^(?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})$/.test(id) ? id : "";
}

export function cleanArxivLabel(text, label) {
  const value = String(text ?? "").trim();
  return value.toLowerCase().startsWith(String(label).toLowerCase())
    ? value.slice(String(label).length).trim()
    : value;
}

function hostLabel(hostname) {
  if (hostname === "github.com" || hostname.endsWith(".github.com")) return "GitHub";
  if (hostname === "gitlab.com") return "GitLab";
  if (hostname === "huggingface.co") return "Hugging Face";
  if (hostname === "github.io" || hostname.endsWith(".github.io")) return "Project page";
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
  const hasProjectLabel = /\b(code|project|demo|implementation|repository|github|gitlab)\b/i
    .test(String(context.text ?? ""));
  if (!knownLabel && !hasProjectLabel) return null;
  return {
    url: url.href,
    host: url.hostname,
    label: knownLabel ?? "Project page",
    source: context.source ?? "paper-html",
    evidence: SOURCE_EVIDENCE[context.source] ?? "Paper-provided link",
  };
}

export function dedupeProjectLinks(links = []) {
  const unique = new Map();
  for (const input of links) {
    const link = classifyProjectUrl(input.url, input);
    if (!link) continue;
    const existing = unique.get(link.url);
    if (!existing || (SOURCE_PRIORITY[link.source] ?? 0) > (SOURCE_PRIORITY[existing.source] ?? 0)) {
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
  unverified: "Unverified",
};

export function displayValue(value) {
  return DISPLAY[value] ?? String(value ?? "Unknown");
}

export function formatVenueYear(venueRaw, year) {
  const venue = String(venueRaw ?? "").trim() || "Venue not found";
  return year && !venue.includes(String(year)) ? `${venue} ${year}` : venue;
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

  return {
    verification: analysis.verification ?? "unverified",
    verificationLabel: displayValue(analysis.verification ?? "unverified"),
    headline: parts.join(" · "),
    records: [...(analysis.records ?? [])].sort((left, right) => Number(right.year ?? 0) - Number(left.year ?? 0)),
    cacheLabel,
  };
}
