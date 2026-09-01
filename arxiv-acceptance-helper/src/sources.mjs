import { normalizeAuthors, normalizeText, scorePaperMatch } from "./core.mjs";

function contentValue(note, key) {
  const value = note?.content?.[key];
  return value && typeof value === "object" && !Array.isArray(value) && "value" in value
    ? value.value
    : value;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function list(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).map(String);
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
  return {
    ...record,
    matchScore: match.score,
    matchKind: match.kind,
    matchEvidence: match.evidence,
  };
}

export function buildDblpSearchUrl(title, firstAuthor = "") {
  const url = new URL("https://dblp.org/search/publ/api");
  const query = [title, firstAuthor].map((value) => String(value).trim()).filter(Boolean).join(" ");
  url.search = new URLSearchParams({ q: query, format: "json", h: "20" });
  return url.href;
}

function arxivIdFromDblp(info, publicationUrls) {
  const values = [...publicationUrls, info.url, info.doi].map(String);
  for (const value of values) {
    const urlMatch = value.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?(?:[?#]|$)/i);
    if (urlMatch) return urlMatch[1].replace(/v\d+$/i, "");
    const doiMatch = value.match(/10\.48550\/arxiv\.([^?#\s]+)/i);
    if (doiMatch) return doiMatch[1].replace(/v\d+$/i, "");
  }

  const corrKey = String(info.key ?? "").match(/^journals\/corr\/abs-(\d{4})-(\d{4,5})(?:v\d+)?$/i);
  return corrKey ? `${corrKey[1]}.${corrKey[2]}` : "";
}

function dblpAuthors(value) {
  return normalizeAuthors(value).map((author) => author.replace(/\s+\d{4}$/u, "").trim());
}

export function parseDblp(payload, paper) {
  const hitContainer = payload?.result?.hits;
  if (!hitContainer || typeof hitContainer !== "object") {
    throw new TypeError("Malformed DBLP response.");
  }
  const rawHits = hitContainer.hit;
  if (rawHits == null && Number(hitContainer["@total"] ?? hitContainer.total) !== 0) {
    throw new TypeError("Malformed DBLP response.");
  }
  const hits = rawHits == null
    ? []
    : Array.isArray(rawHits) ? rawHits : typeof rawHits === "object" ? [rawHits] : null;
  if (!hits) throw new TypeError("Malformed DBLP response.");
  return hits.map(({ info = {} }) => {
    const publicationUrls = list(info.ee);
    const ee = first(publicationUrls);
    const arxivId = arxivIdFromDblp(info, publicationUrls);
    const doi = String(info.doi ?? "");
    const arxivDoi = /^10\.48550\/arxiv\./i.test(doi) ? doi : "";
    const preprint = String(info.venue ?? "").toLowerCase() === "corr"
      || /^journals\/corr\//i.test(String(info.key ?? ""))
      || /informal/i.test(String(info.type ?? ""));
    const record = {
      source: "dblp",
      sourceId: info.key ?? info.url ?? null,
      sourceUrl: info.url ?? ee ?? null,
      title: String(info.title ?? "").replace(/<[^>]*>/g, " ").trim(),
      authors: dblpAuthors(info.authors?.author),
      venueRaw: info.venue ?? "",
      decisionRaw: preprint ? "Preprint" : "Published",
      trackRaw: "",
      presentationRaw: "",
      year: Number(info.year) || null,
      publicationDoi: arxivDoi ? "" : doi,
      arxivDoi,
      publicationUrls,
      arxivId,
      evidenceType: "publication",
      raw: info,
    };
    return matchFields(paper, record);
  });
}

export function buildCrossrefSearchUrl(title, firstAuthor = "") {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.title", String(title));
  if (String(firstAuthor).trim()) url.searchParams.set("query.author", String(firstAuthor).trim());
  url.searchParams.set("rows", "10");
  return url.href;
}

export function buildSemanticScholarUrl(arxivId) {
  const identifier = `ARXIV:${String(arxivId ?? "").trim().replace(/v\d+$/i, "")}`;
  const url = new URL(`/graph/v1/paper/${encodeURIComponent(identifier)}`, "https://api.semanticscholar.org");
  url.searchParams.set("fields", "title,authors,year,venue,publicationVenue,publicationTypes,externalIds,url");
  return url.href;
}

export function parseSemanticScholar(payload, paper) {
  if (!payload || typeof payload !== "object" || !String(payload.title ?? "").trim()) {
    throw new TypeError("Malformed Semantic Scholar response.");
  }
  const externalIds = payload.externalIds && typeof payload.externalIds === "object"
    ? payload.externalIds
    : {};
  const arxivId = String(externalIds.ArXiv ?? paper?.arxivId ?? "").replace(/v\d+$/i, "");
  const publicationDoi = String(externalIds.DOI ?? "");
  const venueRaw = String(payload.publicationVenue?.name ?? payload.venue ?? "").trim();
  const preprint = !venueRaw || /^(?:arxiv(?:\.org)?|corr)$/i.test(venueRaw);
  const sourceUrl = String(payload.url ?? "") || null;
  const publicationUrls = [
    sourceUrl,
    publicationDoi ? `https://doi.org/${publicationDoi}` : "",
  ].filter(Boolean);
  return matchFields(paper, {
    source: "semanticscholar",
    sourceId: payload.paperId ?? sourceUrl,
    sourceUrl,
    title: String(payload.title),
    authors: normalizeAuthors((Array.isArray(payload.authors) ? payload.authors : []).map((author) => author?.name)),
    venueRaw,
    decisionRaw: preprint ? "Preprint" : "Published",
    trackRaw: "",
    presentationRaw: "",
    year: Number(payload.year) || null,
    publicationDoi,
    publicationUrls,
    arxivId,
    evidenceType: "publication-metadata",
    publicationType: (Array.isArray(payload.publicationTypes) ? payload.publicationTypes : []).join(", "),
    raw: payload,
  });
}

function crossrefYear(item) {
  for (const field of ["published-print", "published-online", "published", "issued", "created"]) {
    const year = Number(item?.[field]?.["date-parts"]?.[0]?.[0]);
    if (Number.isInteger(year)) return year;
  }
  return null;
}

function crossrefAuthors(item) {
  return normalizeAuthors((Array.isArray(item?.author) ? item.author : []).map((author) => (
    [author?.given, author?.family].filter(Boolean).join(" ")
  )));
}

export function parseCrossref(payload, paper) {
  const items = payload?.message?.items;
  if (!Array.isArray(items)) throw new TypeError("Malformed Crossref response.");
  return items.map((item) => {
    const publicationUrls = [
      item.URL,
      item.resource?.primary?.URL,
      ...(Array.isArray(item.link) ? item.link : []).map((link) => link?.URL),
      item.DOI ? `https://doi.org/${item.DOI}` : "",
    ].filter(Boolean).map(String);
    const venueRaw = String(first(item["container-title"]) ?? "");
    const preprint = item.type === "posted-content" || /^(?:arxiv|corr)$/i.test(venueRaw.trim());
    const arxivUrl = publicationUrls.find((value) => /arxiv\.org\/(?:abs|pdf)\//i.test(value));
    const record = {
      source: "crossref",
      sourceId: item.DOI ?? item.URL ?? null,
      sourceUrl: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : null),
      title: String(first(item.title) ?? ""),
      authors: crossrefAuthors(item),
      venueRaw,
      decisionRaw: preprint ? "Preprint" : venueRaw ? "Published" : "",
      trackRaw: "",
      presentationRaw: "",
      year: crossrefYear(item),
      publicationDoi: String(item.DOI ?? ""),
      publicationUrls,
      arxivId: arxivUrl ? arxivUrl.match(/(?:abs|pdf)\/([^?#]+)/i)?.[1] ?? "" : "",
      evidenceType: "publication-metadata",
      publicationType: String(item.type ?? ""),
      raw: item,
    };
    return matchFields(paper, record);
  });
}

const PROCEEDINGS_HOSTS = new Map([
  ["openaccess.thecvf.com", "CVF Open Access"],
  ["aclanthology.org", "ACL Anthology"],
  ["proceedings.mlr.press", "PMLR"],
  ["proceedings.neurips.cc", "NeurIPS Proceedings"],
]);

function proceedingsUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./, "");
    const provider = PROCEEDINGS_HOSTS.get(hostname);
    if (!provider || !/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.protocol = "https:";
    url.hostname = hostname;
    url.hash = "";
    return { url: url.href, provider };
  } catch {
    return null;
  }
}

function cvfSlug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function derivedProceedingsCandidates(record) {
  const candidates = [];
  const doi = String(record.publicationDoi ?? "");
  if (/^10\.18653\/v1\//i.test(doi)) {
    candidates.push({
      url: `https://aclanthology.org/${doi.slice("10.18653/v1/".length)}/`,
      provider: "ACL Anthology",
      record,
      discovery: "publication DOI",
      discoveryGroup: `acl:${doi.toLowerCase()}`,
    });
  }

  const venue = String(record.venueRaw ?? "").match(/\b(CVPR|ICCV|WACV)\b/i)?.[1]?.toUpperCase();
  const year = Number(record.year);
  const firstAuthor = record.raw?.author?.[0]?.family
    ?? normalizeAuthors(record.authors)[0]?.trim().split(/\s+/).at(-1);
  if (venue && Number.isInteger(year) && firstAuthor && record.title) {
    const filename = `${cvfSlug(firstAuthor)}_${cvfSlug(record.title)}_${venue}_${year}_paper.html`;
    for (const url of [
      `https://openaccess.thecvf.com/content_${venue}_${year}/html/${filename}`,
      `https://openaccess.thecvf.com/content/${venue}${year}/html/${filename}`,
    ]) {
      candidates.push({
        url,
        provider: "CVF Open Access",
        record,
        discovery: "bibliographic metadata",
        discoveryGroup: `cvf:${venue}:${year}:${filename}`,
      });
    }
  }
  return candidates;
}

export function officialProceedingsCandidates(records = []) {
  const candidates = new Map();
  const directlyLinkedProviders = new Set();
  const derivedGroups = new Set();
  for (const record of records) {
    for (const value of record.publicationUrls ?? []) {
      const candidate = proceedingsUrl(value);
      if (candidate) {
        directlyLinkedProviders.add(candidate.provider);
        if (!candidates.has(candidate.url)) candidates.set(candidate.url, { ...candidate, record });
      }
    }
  }
  for (const record of records) {
    const derived = derivedProceedingsCandidates(record)
      .filter((candidate) => !directlyLinkedProviders.has(candidate.provider));
    for (const group of new Set(derived.map((candidate) => candidate.discoveryGroup))) {
      if (derivedGroups.has(group)) continue;
      derivedGroups.add(group);
      for (const candidate of derived.filter((item) => item.discoveryGroup === group)) {
        if (!candidates.has(candidate.url)) candidates.set(candidate.url, candidate);
      }
    }
  }
  return [...candidates.values()];
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function metaValues(html, key) {
  const values = [];
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if ((attribute(tag, "name") || attribute(tag, "property")).toLowerCase() === key.toLowerCase()) {
      const value = attribute(tag, "content").trim();
      if (value) values.push(value);
    }
  }
  return values;
}

function proceedingsTrack(provider, url, venueRaw) {
  const evidence = `${url} ${venueRaw}`;
  if (/\bfindings\b/i.test(evidence)) return "Findings";
  if (/\bworkshops?\b|\bsrw\b/i.test(evidence)
    || (provider === "CVF Open Access" && /\d{4}w(?:\/|$)/i.test(new URL(url).pathname))) return "Workshop";
  if (/\bmain(?:\s+conference)?\b/i.test(evidence)
    || /\.(?:acl|emnlp|naacl|eacl|aacl)-main\./i.test(url)
    || provider === "CVF Open Access"
    || provider === "NeurIPS Proceedings") return "Main";
  return "";
}

export function parseOfficialProceedings(html, candidate, paper) {
  if (typeof html !== "string") throw new TypeError("Malformed official proceedings response.");
  const title = first(metaValues(html, "citation_title"))
    ?? first(metaValues(html, "dc.title"))
    ?? first(metaValues(html, "og:title"));
  if (!title) throw new TypeError("Official proceedings page has no publication metadata.");
  const pageAuthors = metaValues(html, "citation_author");
  const authors = pageAuthors.length ? pageAuthors : candidate.record.authors;
  const officialVenueRaw = first(metaValues(html, "citation_conference_title"))
    ?? first(metaValues(html, "citation_journal_title"))
    ?? "";
  const venueRaw = officialVenueRaw || candidate.record.venueRaw || "";
  const publicationDate = first(metaValues(html, "citation_publication_date"))
    ?? first(metaValues(html, "citation_date"));
  const trackRaw = proceedingsTrack(candidate.provider, candidate.url, officialVenueRaw);
  return matchFields(paper, {
    source: "proceedings",
    provider: candidate.provider,
    sourceId: candidate.url,
    sourceUrl: candidate.url,
    title,
    authors,
    venueRaw,
    decisionRaw: "Published",
    trackRaw,
    trackEvidence: trackRaw ? "official" : "none",
    presentationRaw: "",
    year: yearFrom(publicationDate, venueRaw, candidate.record.year),
    publicationDoi: first(metaValues(html, "citation_doi")) ?? candidate.record.publicationDoi ?? "",
    arxivId: "",
    evidenceType: "official-proceedings",
    identityEvidence: pageAuthors.length
      ? "official-metadata"
      : candidate.discovery
        ? `${candidate.record.source ?? "metadata"}-derived-candidate`
        : `${candidate.record.source ?? "dblp"}-publication-link`,
    raw: { provider: candidate.provider, publicationUrl: candidate.url, discovery: candidate.discovery ?? "publication link" },
  });
}

function decisionFromVenue(submission) {
  const venueId = String(contentValue(submission, "venueid") ?? "");
  const venue = String(contentValue(submission, "venue") ?? "");
  const combined = `${venueId} ${venue}`;
  if (/desk[_\s-]*reject|reject(?:ed)?/i.test(combined)) return "Rejected";
  if (/withdrawn?/i.test(combined)) return "Withdrawn";
  if (/accepted?|\b(?:poster|oral|spotlight)\b/i.test(combined)
    || /\/(?:conference|workshop|findings)$/i.test(venueId)) return "Accepted";
  if (/submission|under[_\s-]*review/i.test(combined)) return "Submitted";
  return null;
}

function trackFromVenue(...values) {
  const match = values.map(String).join(" ").match(/\b(main|workshop|findings)\b/i);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}` : "";
}

export function buildOpenReviewSearchUrl(title, version = 2, matchType = "terms") {
  const base = version === 1
    ? "https://api.openreview.net/notes"
    : "https://api2.openreview.net/notes/search";
  const url = new URL(base);
  url.search = version === 1
    ? new URLSearchParams({ "content.title": String(title), limit: "20" })
    : new URLSearchParams({
        term: String(title),
        type: matchType === "exact" ? "exact" : "terms",
        content: "title",
        source: "forum",
        limit: "20",
      });
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
      ?? venueRaw,
    ),
    year: yearFrom(venueRaw, contentValue(submission, "venueid"), submission.invitation, submission.invitations)
      ?? (submission.cdate ? new Date(submission.cdate).getUTCFullYear() : null),
    publicationDoi: String(contentValue(submission, "doi") ?? ""),
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

export function parseOpenReviewForumById(payload, forumId, paper, version = 2) {
  if (!Array.isArray(payload?.notes)) throw new TypeError("Malformed OpenReview forum response.");
  const submission = payload.notes.find((note) => (
    String(note?.id ?? "") === String(forumId)
    && contentValue(note, "title") != null
  )) ?? payload.notes.find((note) => (
    String(note?.forum ?? note?.id ?? "") === String(forumId)
    && contentValue(note, "title") != null
    && !note?.replyto
  ));
  if (!submission) throw new TypeError("OpenReview forum response has no submission note.");
  return parseOpenReviewForum(payload, submission, paper, version);
}

export function buildGitHubSearch(paper, kind = "title") {
  const title = String(paper?.title ?? paper).replace(/"/g, " ").trim().slice(0, 200);
  const identifier = String(paper?.arxivId ?? "").replace(/"/g, " ").trim().slice(0, 100);
  const query = kind === "identifier" && identifier
    ? `"${identifier}" in:description,readme`
    : `"${title}" in:name,description`;
  const api = new URL("https://api.github.com/search/repositories");
  api.search = new URLSearchParams({ q: query, per_page: kind === "identifier" ? "20" : "30" });
  const web = new URL("https://github.com/search");
  web.search = new URLSearchParams({ q: title, type: "repositories" });
  return { apiUrl: api.href, webUrl: web.href, provenance: `${kind}-search` };
}

export function buildGitHubReadmeUrl(fullName) {
  const parts = String(fullName).split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[\w.-]+$/.test(part))) return "";
  return `https://api.github.com/repos/${parts.map(encodeURIComponent).join("/")}/readme`;
}

export function parseGitHub(payload, provenance = "title-search") {
  if (!Array.isArray(payload?.items)) throw new TypeError("Malformed GitHub response.");
  return payload.items.map((item) => ({
    name: String(item.full_name ?? ""),
    owner: String(item.owner?.login ?? ""),
    url: String(item.html_url ?? ""),
    description: String(item.description ?? ""),
    stars: Number(item.stargazers_count) || 0,
    updatedAt: String(item.updated_at ?? ""),
    provenance: [provenance],
  })).filter((item) => /^https:\/\/github\.com\//.test(item.url));
}

const IMPLEMENTATION_TERMS = /\b(?:official\s+implementation|implementation|reimplementation|code\s+for|source\s+code)\b/i;
const AGGREGATOR_TERMS = /\b(?:awesome|papers?\s+list|reading\s+list|survey|state\s+of\s+the\s+art|sota|bibliography|literature\s+review)\b/i;
const REFERENCE_TERMS = /\b(?:references|bibliography|bibtex|biburl|bibsource|related\s+papers|papers?\s+we\s+read)\b/i;
const GENERIC_PAPER_TOOL_TERMS = /\b(?:paper2code|paper[- ]to[- ]code|any\s+(?:arxiv\s+)?paper|turn(?:s|ing)?\s+any\s+(?:arxiv\s+)?paper)\b/i;

function tokenCoverage(reference, candidate) {
  const expected = new Set(normalizeText(reference).split(" ").filter(Boolean));
  const actual = new Set(normalizeText(candidate).split(" ").filter(Boolean));
  if (!expected.size || !actual.size) return 0;
  return Number(([...expected].filter((token) => actual.has(token)).length / expected.size).toFixed(3));
}

function mentionContexts(paper, readme) {
  const text = normalizeText(String(readme).slice(0, 100_000));
  const needles = [paper?.title, paper?.arxivId, paper?.arxivDoi, paper?.publicationDoi]
    .map(normalizeText)
    .filter(Boolean);
  const contexts = [];
  for (const needle of needles) {
    let index = text.indexOf(needle);
    while (index >= 0 && contexts.length < 10) {
      contexts.push(text.slice(Math.max(0, index - 300), index + needle.length + 300));
      index = text.indexOf(needle, index + needle.length);
    }
  }
  return contexts;
}

export function rankGitHubCandidates(paper, candidates, readmes = {}) {
  const unique = new Map();
  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase();
    if (!key) continue;
    const existing = unique.get(key);
    if (existing) {
      existing.provenance = [...new Set([...existing.provenance, ...candidate.provenance])];
    } else {
      unique.set(key, { ...candidate, provenance: [...candidate.provenance] });
    }
  }

  return [...unique.values()].map((candidate) => {
    const repositoryName = candidate.name.split("/").at(-1);
    const nameSimilarity = tokenCoverage(paper?.title, repositoryName);
    const descriptionSimilarity = tokenCoverage(paper?.title, candidate.description);
    const readme = String(readmes[candidate.name] ?? "");
    const contexts = mentionContexts(paper, readme);
    const metadata = `${repositoryName} ${candidate.description}`;
    const strongTitleMatch = nameSimilarity >= 0.6 || descriptionSimilarity >= 0.6;
    const metadataImplementation = strongTitleMatch && IMPLEMENTATION_TERMS.test(candidate.description);
    const contextualImplementation = contexts.some((context) => (
      IMPLEMENTATION_TERMS.test(context) && !REFERENCE_TERMS.test(context)
    ));
    const implementationEvidence = metadataImplementation || contextualImplementation;
    const aggregatorRepository = AGGREGATOR_TERMS.test(metadata);
    const referenceOnlyMention = contexts.length > 0
      && !metadataImplementation
      && contexts.every((context) => REFERENCE_TERMS.test(context) || AGGREGATOR_TERMS.test(context));
    const genericPaperTool = GENERIC_PAPER_TOOL_TERMS.test(`${metadata}\n${readme.slice(0, 2_000)}`);
    const identifierValues = [paper?.arxivId, paper?.arxivDoi, paper?.publicationDoi]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean);
    const searchable = `${candidate.description}\n${readme}`.toLowerCase();
    const identifier = identifierValues.find((value) => searchable.includes(value)) ?? "";
    const starBoost = Math.min(3, Math.log10(candidate.stars + 1));
    const rawScore = 45 * nameSimilarity
      + 20 * descriptionSimilarity
      + (identifier ? 25 : 0)
      + (implementationEvidence ? 20 : 0)
      - (aggregatorRepository ? 40 : 0)
      - (referenceOnlyMention ? 50 : 0)
      - (genericPaperTool ? 40 : 0)
      + starBoost;
    const score = Math.round(Math.max(0, Math.min(100, rawScore)));
    const reasons = [
      nameSimilarity >= 0.6 ? "title-name" : "",
      descriptionSimilarity >= 0.6 ? "title-description" : "",
      identifier ? "identifier" : "",
      implementationEvidence ? "implementation-context" : "",
    ].filter(Boolean);
    const penalties = [
      aggregatorRepository ? "aggregator" : "",
      referenceOnlyMention ? "reference-only" : "",
      genericPaperTool ? "generic-paper-tool" : "",
    ].filter(Boolean);
    const identityEvidence = Boolean(identifier) || strongTitleMatch;
    const negativeEvidence = aggregatorRepository || referenceOnlyMention || genericPaperTool;
    const classification = !negativeEvidence && identityEvidence && implementationEvidence
      ? "likely_implementation"
      : !negativeEvidence && identityEvidence
        ? "possible_match"
        : "low_relevance";
    return {
      ...candidate,
      classification,
      provenance: readme ? [...new Set([...candidate.provenance, "readme-validation"])] : candidate.provenance,
      relevance: {
        score,
        nameSimilarity,
        descriptionSimilarity,
        identifier,
        implementationEvidence,
        reasons,
        penalties,
      },
    };
  }).sort((left, right) => right.relevance.score - left.relevance.score
    || right.stars - left.stars);
}
