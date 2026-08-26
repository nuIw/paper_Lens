import { normalizeAuthors, scorePaperMatch } from "./core.mjs";

function contentValue(note, key) {
  const value = note?.content?.[key];
  return value && typeof value === "object" && !Array.isArray(value) && "value" in value
    ? value.value
    : value;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function yearFrom(...values) {
  for (const value of values) {
    const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
    if (match) return Number(match[0]);
  }
  return null;
}

function matchFields(paper, record) {
  const match = scorePaperMatch(paper, record);
  return { ...record, matchScore: match.score, matchKind: match.kind };
}

export function buildDblpSearchUrl(title, firstAuthor = "") {
  const url = new URL("https://dblp.org/search/publ/api");
  const query = [title, firstAuthor].map((value) => String(value).trim()).filter(Boolean).join(" ");
  url.search = new URLSearchParams({ q: query, format: "json", h: "10" });
  return url.href;
}

export function parseDblp(payload, paper) {
  const hits = payload?.result?.hits?.hit;
  if (!Array.isArray(hits)) throw new TypeError("Malformed DBLP response.");
  return hits.map(({ info = {} }) => {
    const ee = first(info.ee);
    const arxiv = [ee, info.url].find((value) => /arxiv\.org\/(?:abs|pdf)\//i.test(String(value ?? "")));
    const preprint = String(info.venue ?? "").toLowerCase() === "corr"
      || /^journals\/corr\//i.test(String(info.key ?? ""))
      || /informal/i.test(String(info.type ?? ""));
    const record = {
      source: "dblp",
      sourceId: info.key ?? info.url ?? null,
      sourceUrl: info.url ?? ee ?? null,
      title: String(info.title ?? "").replace(/<[^>]*>/g, " ").trim(),
      authors: normalizeAuthors(info.authors?.author),
      venueRaw: info.venue ?? "",
      decisionRaw: preprint ? "Preprint" : "Published",
      trackRaw: "",
      presentationRaw: "",
      year: Number(info.year) || null,
      doi: info.doi ?? "",
      arxivId: arxiv ? String(arxiv).match(/(?:abs|pdf)\/([^?#]+)/i)?.[1] ?? "" : "",
      evidenceType: "publication",
      raw: info,
    };
    return matchFields(paper, record);
  });
}

function decisionFromVenue(submission) {
  const venueId = String(contentValue(submission, "venueid") ?? "");
  const venue = String(contentValue(submission, "venue") ?? "");
  const combined = `${venueId} ${venue}`;
  if (/desk[_\s-]*reject|reject(?:ed)?/i.test(combined)) return "Rejected";
  if (/withdrawn?/i.test(combined)) return "Withdrawn";
  if (/accepted?/i.test(combined) || /\/(?:conference|workshop|findings)$/i.test(venueId)) return "Accepted";
  if (/submission|under[_\s-]*review/i.test(combined)) return "Submitted";
  return null;
}

function trackFromVenue(...values) {
  const match = values.map(String).join(" ").match(/\b(main|workshop|findings)\b/i);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}` : "";
}

export function buildOpenReviewSearchUrl(title, version = 2) {
  const base = version === 1
    ? "https://api.openreview.net/notes"
    : "https://api2.openreview.net/notes/search";
  const url = new URL(base);
  url.search = version === 1
    ? new URLSearchParams({ "content.title": String(title), limit: "10" })
    : new URLSearchParams({ term: String(title), type: "terms", content: "title", source: "forum", limit: "10" });
  return url.href;
}

export function buildOpenReviewForumUrl(forumId, version = 2) {
  const url = new URL(version === 1
    ? "https://api.openreview.net/notes"
    : "https://api2.openreview.net/notes");
  url.search = new URLSearchParams({ forum: String(forumId), limit: "1000" });
  return url.href;
}

function openReviewRecord(submission, paper, version, decisionNote = null) {
  const note = decisionNote ?? submission;
  const forumId = submission.forum ?? submission.id;
  const venueRaw = contentValue(note, "venue")
    ?? contentValue(submission, "venue")
    ?? contentValue(submission, "venueid")
    ?? "";
  const decisionRaw = contentValue(note, "decision")
    ?? contentValue(submission, "decision")
    ?? decisionFromVenue(submission)
    ?? (decisionNote ? "" : "Submitted");
  const title = contentValue(submission, "title") ?? "";
  const record = {
    source: "openreview",
    sourceVersion: version,
    sourceId: note.id ?? submission.id ?? forumId,
    forumId,
    sourceUrl: forumId ? `https://openreview.net/forum?id=${encodeURIComponent(forumId)}` : null,
    title: String(title),
    authors: normalizeAuthors(contentValue(submission, "authors")),
    venueRaw: String(venueRaw),
    venueIdRaw: String(contentValue(submission, "venueid") ?? ""),
    decisionRaw: String(decisionRaw),
    trackRaw: String(
      contentValue(note, "track")
      ?? contentValue(submission, "track")
      ?? trackFromVenue(venueRaw, contentValue(submission, "venueid")),
    ),
    presentationRaw: String(
      contentValue(note, "presentation_type")
      ?? contentValue(note, "presentation")
      ?? contentValue(submission, "presentation_type")
      ?? "",
    ),
    year: yearFrom(venueRaw, contentValue(submission, "venueid"), submission.invitation, submission.invitations)
      ?? (submission.cdate ? new Date(submission.cdate).getUTCFullYear() : null),
    doi: String(contentValue(submission, "doi") ?? ""),
    arxivId: String(contentValue(submission, "arxiv_id") ?? contentValue(submission, "arxiv") ?? ""),
    evidenceType: decisionNote ? "decision" : "submission",
    raw: decisionNote ? { submission, decision: decisionNote } : submission,
  };
  return matchFields(paper, record);
}

export function parseOpenReviewSearch(payload, paper, version = 2) {
  if (!Array.isArray(payload?.notes)) throw new TypeError("Malformed OpenReview response.");
  const notes = payload.notes;
  return notes.map((submission) => openReviewRecord(submission, paper, version));
}

export function parseOpenReviewForum(payload, submission, paper, version = 2) {
  if (!Array.isArray(payload?.notes)) throw new TypeError("Malformed OpenReview forum response.");
  const notes = payload.notes;
  const decisions = notes.filter((note) => {
    const invitations = [note.invitation, ...(Array.isArray(note.invitations) ? note.invitations : [])]
      .filter(Boolean);
    return invitations.some((invitation) => /(?:^|\/)decision$/i.test(invitation))
      || contentValue(note, "decision") != null;
  });
  return decisions.length
    ? decisions.map((decision) => openReviewRecord(submission, paper, version, decision))
    : [openReviewRecord(submission, paper, version)];
}

export function buildGitHubSearch(title) {
  const shortened = String(title).replace(/"/g, " ").trim().slice(0, 200);
  const query = `"${shortened}" in:name,description,readme`;
  const api = new URL("https://api.github.com/search/repositories");
  api.search = new URLSearchParams({ q: query, per_page: "5", sort: "stars" });
  const web = new URL("https://github.com/search");
  web.search = new URLSearchParams({ q: String(title), type: "repositories" });
  return { apiUrl: api.href, webUrl: web.href };
}

export function parseGitHub(payload) {
  if (!Array.isArray(payload?.items)) throw new TypeError("Malformed GitHub response.");
  const items = payload.items;
  return items.slice(0, 5).map((item) => ({
    name: String(item.full_name ?? ""),
    owner: String(item.owner?.login ?? ""),
    url: String(item.html_url ?? ""),
    description: String(item.description ?? ""),
    stars: Number(item.stargazers_count) || 0,
    updatedAt: String(item.updated_at ?? ""),
    classification: "search_candidate",
  })).filter((item) => /^https:\/\/github\.com\//.test(item.url));
}
