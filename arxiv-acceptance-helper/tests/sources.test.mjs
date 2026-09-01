import test from "node:test";
import assert from "node:assert/strict";

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
} from "../src/sources.mjs";

const paper = { title: "Paper", authors: ["Alice Kim"], year: 2025 };

test("DBLP search URL uses the official publication endpoint", () => {
  const url = new URL(buildDblpSearchUrl("A paper: robust & small"));
  assert.equal(url.origin + url.pathname, "https://dblp.org/search/publ/api");
  assert.equal(url.searchParams.get("q"), "A paper: robust & small");
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.get("h"), "20");
});

test("DBLP search adds the first author to disambiguate title lookalikes", () => {
  const url = new URL(buildDblpSearchUrl(
    "Attention Is All You Need",
    "Ashish Vaswani",
  ));
  assert.equal(
    url.searchParams.get("q"),
    "Attention Is All You Need Ashish Vaswani",
  );
});

test("DBLP accepts both one-author objects and author arrays", () => {
  const records = parseDblp({ result: { hits: { hit: [
    { info: { title: "Paper", authors: { author: { text: "Alice Kim" } }, venue: "ICLR", year: "2025", url: "https://dblp.org/rec/conf/iclr/a" } },
    { info: { title: "Paper", authors: { author: [{ text: "Alice Kim" }, { text: "Bob Lee" }] }, venue: "NeurIPS", year: "2026", doi: "10.1/example" } },
  ] } } }, paper);
  assert.deepEqual(records.map((record) => record.authors.length), [1, 2]);
  assert.equal(records[0].decisionRaw, "Published");
  assert.equal(records[0].source, "dblp");
  assert.ok(records[0].matchScore >= 0.9);
  assert.equal(records[1].publicationDoi, "10.1/example");
});

test("DBLP CoRR entries remain preprints rather than accepted publications", () => {
  const [record] = parseDblp({ result: { hits: { hit: [{ info: {
    title: "Paper",
    authors: { author: { text: "Alice Kim" } },
    venue: "CoRR",
    type: "Informal and Other Publications",
    key: "journals/corr/abs-2501-00001",
    year: "2025",
    ee: "https://arxiv.org/abs/2501.00001",
  } }] } } }, paper);
  assert.equal(record.decisionRaw, "Preprint");
});

test("DBLP's live zero-result shape is an empty result rather than a malformed response", () => {
  const records = parseDblp({ result: { hits: { "@total": "0", "@sent": "0" } } }, paper);
  assert.deepEqual(records, []);
});

test("DBLP's single-object hit shape is normalized defensively", () => {
  const records = parseDblp({ result: { hits: { hit: { info: {
    title: "Paper",
    authors: { author: { text: "Alice Kim" } },
    venue: "ICLR",
    year: "2025",
  } } } } }, paper);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Paper");
});

test("DBLP recognizes AdaLoRA's arXiv DOI and removes DBLP author suffixes", () => {
  const adaLora = {
    arxivId: "2303.10512",
    title: "AdaLoRA: Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
    authors: [
      "Qingru Zhang", "Minshuo Chen", "Alexander Bukharin", "Nikos Karampatziakis",
      "Pengcheng He", "Yu Cheng", "Weizhu Chen", "Tuo Zhao",
    ],
    year: 2023,
  };
  const [record] = parseDblp({ result: { hits: { hit: [{ info: {
    title: "Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning.",
    authors: { author: [
      { text: "Qingru Zhang" }, { text: "Minshuo Chen" }, { text: "Alexander Bukharin" },
      { text: "Pengcheng He" }, { text: "Yu Cheng 0001" }, { text: "Weizhu Chen" },
      { text: "Tuo Zhao" },
    ] },
    venue: "CoRR",
    key: "journals/corr/abs-2303-10512",
    doi: "10.48550/arXiv.2303.10512",
    year: "2023",
  } }] } } }, adaLora);

  assert.equal(record.arxivId, "2303.10512");
  assert.equal(record.arxivDoi, "10.48550/arXiv.2303.10512");
  assert.equal(record.publicationDoi, "");
  assert.ok(record.authors.includes("Yu Cheng"));
  assert.equal(record.matchKind, "identifier");
  assert.equal(record.matchScore, 1);
});

test("malformed DBLP payload is a source error rather than an empty result", () => {
  assert.throws(() => parseDblp({ nope: true }, paper), /Malformed DBLP response/);
  assert.throws(() => parseDblp({ result: { hits: {} } }, paper), /Malformed DBLP response/);
});

test("Crossref is a title-first candidate source with an author disambiguator", () => {
  const url = new URL(buildCrossrefSearchUrl("Attention Is All You Need", "Ashish Vaswani"));
  assert.equal(url.origin + url.pathname, "https://api.crossref.org/works");
  assert.equal(url.searchParams.get("query.title"), "Attention Is All You Need");
  assert.equal(url.searchParams.get("query.author"), "Ashish Vaswani");
  assert.equal(url.searchParams.get("rows"), "10");
});

test("Semantic Scholar uses a direct arXiv identifier endpoint", () => {
  const url = new URL(buildSemanticScholarUrl("2106.09685v2"));
  assert.equal(url.origin, "https://api.semanticscholar.org");
  assert.equal(decodeURIComponent(url.pathname), "/graph/v1/paper/ARXIV:2106.09685");
  assert.match(url.searchParams.get("fields"), /publicationVenue/);
});

test("Semantic Scholar venue metadata is exact-arXiv-ID probable evidence", () => {
  const lora = {
    arxivId: "2106.09685",
    title: "LoRA: Low-Rank Adaptation of Large Language Models",
    authors: ["Edward J. Hu", "Yelong Shen"],
    year: 2021,
  };
  const record = parseSemanticScholar({
    paperId: "example",
    title: lora.title,
    authors: [{ name: "Edward J. Hu" }, { name: "Yelong Shen" }],
    year: 2022,
    venue: "ICLR",
    publicationVenue: { name: "International Conference on Learning Representations" },
    publicationTypes: ["Conference"],
    externalIds: { ArXiv: "2106.09685" },
    url: "https://www.semanticscholar.org/paper/example",
  }, lora);
  assert.equal(record.source, "semanticscholar");
  assert.equal(record.venueRaw, "International Conference on Learning Representations");
  assert.equal(record.decisionRaw, "Published");
  assert.equal(record.matchKind, "identifier");
  assert.equal(record.matchScore, 1);
});

test("malformed Semantic Scholar payload is a source error", () => {
  assert.throws(() => parseSemanticScholar({ error: "not found" }, paper), /Malformed Semantic Scholar/);
});

test("Crossref records remain metadata candidates and can supply official links", () => {
  const officialUrl = "https://aclanthology.org/2025.acl-main.1/";
  const [record] = parseCrossref({ message: { items: [{
    title: ["Paper"],
    author: [{ given: "Alice", family: "Kim" }],
    type: "proceedings-article",
    "container-title": ["ACL"],
    published: { "date-parts": [[2025]] },
    DOI: "10.18653/v1/2025.acl-main.1",
    resource: { primary: { URL: officialUrl } },
  }] } }, paper);
  assert.equal(record.source, "crossref");
  assert.equal(record.evidenceType, "publication-metadata");
  assert.equal(record.decisionRaw, "Published");
  assert.ok(record.matchScore >= 0.9);
  assert.equal(officialProceedingsCandidates([record])[0].url, officialUrl);
});

test("Crossref ACL DOI and CVF metadata can derive revalidated proceedings candidates", () => {
  const records = parseCrossref({ message: { items: [
    {
      title: ["Paper"],
      author: [{ given: "Alice", family: "Kim" }],
      "container-title": ["ACL"],
      published: { "date-parts": [[2025]] },
      DOI: "10.18653/v1/2025.acl-main.1",
    },
    {
      title: ["Paper"],
      author: [{ given: "Alice", family: "Kim" }],
      "container-title": ["IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)"],
      published: { "date-parts": [[2025]] },
      DOI: "10.1/cvpr",
    },
  ] } }, paper);
  const urls = officialProceedingsCandidates(records).map((candidate) => candidate.url);
  assert.ok(urls.includes("https://aclanthology.org/2025.acl-main.1/"));
  assert.ok(urls.some((url) => url.startsWith("https://openaccess.thecvf.com/content_CVPR_2025/")));
});

test("malformed Crossref payload is a source error rather than an empty result", () => {
  assert.throws(() => parseCrossref({ nope: true }, paper), /Malformed Crossref response/);
});

test("official proceedings follow-up uses only recognized URLs supplied by DBLP", () => {
  const records = parseDblp({ result: { hits: { hit: [{ info: {
    title: "Paper",
    authors: { author: { text: "Alice Kim" } },
    venue: "ACL",
    ee: [
      "https://doi.org/10.1/example",
      "https://aclanthology.org/2025.acl-main.1/",
      "https://example.org/untrusted",
    ],
  } }] } } }, paper);
  const candidates = officialProceedingsCandidates(records);
  assert.deepEqual(candidates.map(({ url, provider }) => ({ url, provider })), [{
    url: "https://aclanthology.org/2025.acl-main.1/",
    provider: "ACL Anthology",
  }]);
});

test("official proceedings metadata verifies only an explicit official track", () => {
  const candidate = {
    url: "https://aclanthology.org/2025.acl-main.1/",
    provider: "ACL Anthology",
    record: { venueRaw: "ACL", year: 2025, publicationDoi: "10.1/example" },
  };
  const record = parseOfficialProceedings(`
    <meta name="citation_title" content="Paper">
    <meta name="citation_author" content="Alice Kim">
    <meta name="citation_conference_title" content="ACL 2025 Main Conference">
    <meta name="citation_doi" content="10.2/official">
  `, candidate, paper);
  assert.equal(record.source, "proceedings");
  assert.equal(record.trackRaw, "Main");
  assert.equal(record.trackEvidence, "official");
  assert.equal(record.publicationDoi, "10.2/official");
  assert.ok(record.matchScore >= 0.9);
});

test("PMLR publication metadata does not invent a Main track", () => {
  const record = parseOfficialProceedings(
    '<meta name="citation_title" content="Paper"><meta name="citation_author" content="Alice Kim">',
    {
      url: "https://proceedings.mlr.press/v999/paper.html",
      provider: "PMLR",
      record: { venueRaw: "Example Conference", year: 2025 },
    },
    paper,
  );
  assert.equal(record.trackRaw, "");
  assert.equal(record.trackEvidence, "none");
});

test("official pages without author meta retain identity through the strong DBLP link", () => {
  const record = parseOfficialProceedings(
    '<meta name="citation_title" content="Paper">',
    {
      url: "https://proceedings.neurips.cc/paper/2025/hash/example-Abstract.html",
      provider: "NeurIPS Proceedings",
      record: { authors: ["Alice Kim"], venueRaw: "NeurIPS", year: 2025 },
    },
    paper,
  );
  assert.equal(record.identityEvidence, "dblp-publication-link");
  assert.ok(record.matchScore >= 0.9);
});

test("OpenReview search URLs cover v2 and legacy v1 without venue filters", () => {
  const v2 = new URL(buildOpenReviewSearchUrl("Paper", 2));
  assert.equal(v2.origin + v2.pathname, "https://api2.openreview.net/notes/search");
  assert.equal(v2.searchParams.get("term"), "Paper");
  assert.equal(v2.searchParams.get("content"), "title");
  assert.equal(v2.searchParams.has("venue"), false);

  const v1 = new URL(buildOpenReviewSearchUrl("Paper", 1));
  assert.equal(v1.origin + v1.pathname, "https://api.openreview.net/notes");
  assert.equal(v1.searchParams.get("content.title"), "Paper");
});

test("OpenReview v2 unwraps value fields and preserves raw metadata", () => {
  const [record] = parseOpenReviewSearch({ notes: [{
    id: "forum",
    forum: "forum",
    cdate: Date.UTC(2025, 0, 1),
    invitations: ["ICLR.cc/2025/Conference/-/Submission"],
    content: {
      title: { value: "Paper" },
      authors: { value: ["Alice Kim"] },
      venue: { value: "ICLR 2025 Conference" },
      venueid: { value: "ICLR.cc/2025/Conference/Submission" },
      track: { value: "Main Conference" },
    },
  }] }, paper, 2);
  assert.equal(record.title, "Paper");
  assert.deepEqual(record.authors, ["Alice Kim"]);
  assert.equal(record.venueRaw, "ICLR 2025 Conference");
  assert.equal(record.trackRaw, "Main Conference");
  assert.equal(record.raw.id, "forum");
});

test("OpenReview v1 accepts scalar content fields", () => {
  const [record] = parseOpenReviewSearch({ notes: [{
    id: "legacy",
    forum: "legacy",
    invitation: "ICLR.cc/2023/Conference/-/Blind_Submission",
    content: { title: "Paper", authors: ["Alice Kim"], venue: "ICLR 2023", decision: "Reject" },
  }] }, paper, 1);
  assert.equal(record.title, "Paper");
  assert.equal(record.decisionRaw, "Reject");
  assert.equal(record.sourceVersion, 1);
});

test("OpenReview venueid supplies final state when no Decision reply exists", () => {
  const records = parseOpenReviewSearch({ notes: [
    {
      id: "accepted",
      forum: "accepted",
      content: {
        title: { value: "Paper" },
        authors: { value: ["Alice Kim"] },
        venue: { value: "ICLR 2025 Conference" },
        venueid: { value: "ICLR.cc/2025/Conference" },
      },
    },
    {
      id: "rejected",
      forum: "rejected",
      content: {
        title: { value: "Paper" },
        authors: { value: ["Alice Kim"] },
        venueid: { value: "ICLR.cc/2025/Conference/Rejected_Submission" },
      },
    },
  ] }, paper, 2);
  assert.deepEqual(records.map((record) => record.decisionRaw), ["Accepted", "Rejected"]);
});

test("OpenReview accepted-submission venueids are terminal acceptances", () => {
  const [record] = parseOpenReviewSearch({ notes: [{
    id: "accepted",
    forum: "accepted",
    content: {
      title: { value: "Paper" },
      authors: { value: ["Alice Kim"] },
      venueid: { value: "ICLR.cc/2025/Conference/Accepted_Submission" },
    },
  }] }, paper, 2);
  assert.equal(record.decisionRaw, "Accepted");
});

test("OpenReview reject-submission venueids are terminal rejections", () => {
  const [record] = parseOpenReviewSearch({ notes: [{
    id: "rejected",
    content: {
      title: { value: "Paper" },
      authors: { value: ["Alice Kim"] },
      venueid: { value: "ICLR.cc/2025/Conference/Reject_Submission" },
    },
  }] }, paper, 2);
  assert.equal(record.decisionRaw, "Rejected");
});

test("OpenReview venue metadata supplies explicit Main, Workshop, and Findings tracks", () => {
  const records = parseOpenReviewSearch({ notes: [
    {
      id: "main",
      content: {
        title: { value: "Paper" },
        authors: { value: ["Alice Kim"] },
        venue: { value: "ACL 2025 Main" },
      },
    },
    {
      id: "workshop",
      content: {
        title: { value: "Paper" },
        authors: { value: ["Alice Kim"] },
        venue: { value: "ICLR 2025 Workshop on Small Models" },
      },
    },
    {
      id: "findings",
      content: {
        title: { value: "Paper" },
        authors: { value: ["Alice Kim"] },
        venueid: { value: "ACL/2025/Findings" },
      },
    },
  ] }, paper, 2);
  assert.deepEqual(records.map((record) => record.trackRaw), ["Main", "Workshop", "Findings"]);
});

test("malformed OpenReview payload is a source error rather than an empty result", () => {
  assert.throws(() => parseOpenReviewSearch({ count: 1 }, paper, 2), /Malformed OpenReview response/);
});

test("OpenReview forum URL is restricted to the selected API version", () => {
  assert.equal(
    buildOpenReviewForumUrl("abc/123", 2),
    "https://api2.openreview.net/notes?forum=abc%2F123&limit=1000",
  );
});

test("OpenReview v2 can search exact titles before broader term candidates", () => {
  const exact = new URL(buildOpenReviewSearchUrl("Exact Paper Title", 2, "exact"));
  assert.equal(exact.searchParams.get("term"), "Exact Paper Title");
  assert.equal(exact.searchParams.get("type"), "exact");
  assert.equal(exact.searchParams.get("limit"), "20");
});

test("OpenReview forum parsing extracts Decision replies", () => {
  const submission = {
    id: "forum",
    forum: "forum",
    content: {
      title: { value: "Paper" },
      authors: { value: ["Alice Kim"] },
      venue: { value: "ICLR 2026" },
    },
  };
  const [record] = parseOpenReviewForum({ notes: [{
    forum: "forum",
    invitations: ["ICLR.cc/2026/Conference/-/Decision"],
    content: {
      decision: { value: "Accept (Poster)" },
      presentation_type: { value: "Poster" },
    },
  }] }, submission, paper, 2);
  assert.equal(record.decisionRaw, "Accept (Poster)");
  assert.equal(record.presentationRaw, "Poster");
  assert.equal(record.evidenceType, "decision");
});

test("a DBLP-linked OpenReview forum can be parsed directly and recognizes poster acceptance", () => {
  const forumId = "lq62uWRJjiY";
  const [record] = parseOpenReviewForumById({ notes: [
    {
      id: forumId,
      forum: forumId,
      content: {
        title: { value: "Paper" },
        authors: { value: ["Alice Kim"] },
        venue: { value: "ICLR 2023 poster" },
      },
    },
  ] }, forumId, paper, 2);

  assert.equal(record.decisionRaw, "Accepted");
  assert.equal(record.presentationRaw, "ICLR 2023 poster");
  assert.equal(record.sourceUrl, `https://openreview.net/forum?id=${forumId}`);
});

test("OpenReview forum without a Decision reply keeps submission metadata", () => {
  const [record] = parseOpenReviewForum({ notes: [] }, {
    id: "forum",
    forum: "forum",
    content: { title: "Paper", authors: ["Alice Kim"], venue: "Submitted to ABC" },
  }, paper, 1);
  assert.equal(record.evidenceType, "submission");
  assert.equal(record.venueRaw, "Submitted to ABC");
});

test("malformed OpenReview forum payload is reported instead of hiding missing evidence", () => {
  assert.throws(
    () => parseOpenReviewForum({ count: 1 }, {
      id: "forum",
      content: { title: "Paper", authors: ["Alice Kim"] },
    }, paper, 2),
    /Malformed OpenReview forum response/,
  );
});

test("GitHub primary search uses best-match metadata candidates instead of README stars", () => {
  const query = buildGitHubSearch({ title: "Attention Is All You Need", arxivId: "1706.03762" });
  assert.equal(new URL(query.apiUrl).origin, "https://api.github.com");
  assert.equal(new URL(query.apiUrl).searchParams.get("q"), '"Attention Is All You Need" in:name,description');
  assert.equal(new URL(query.apiUrl).searchParams.get("per_page"), "30");
  assert.equal(new URL(query.apiUrl).searchParams.has("sort"), false);
  assert.match(query.webUrl, /^https:\/\/github\.com\/search\?/);
  const [candidate] = parseGitHub({ items: [{
    full_name: "org/repo",
    html_url: "https://github.com/org/repo",
    description: "Implementation",
    stargazers_count: 42,
    updated_at: "2026-08-20T00:00:00Z",
    owner: { login: "org" },
  }] });
  assert.deepEqual(candidate, {
    name: "org/repo",
    owner: "org",
    url: "https://github.com/org/repo",
    description: "Implementation",
    stars: 42,
    updatedAt: "2026-08-20T00:00:00Z",
    provenance: ["title-search"],
  });
});

test("GitHub query stays within the public search query length limit", () => {
  const search = buildGitHubSearch({ title: "x".repeat(500), arxivId: "2501.00001" });
  assert.ok(new URL(search.apiUrl).searchParams.get("q").length <= 256);
});

test("GitHub identifier fallback and README URLs stay narrowly scoped", () => {
  const search = buildGitHubSearch({ title: "Paper", arxivId: "1706.03762" }, "identifier");
  assert.equal(new URL(search.apiUrl).searchParams.get("q"), '"1706.03762" in:description,readme');
  assert.equal(new URL(search.apiUrl).searchParams.get("per_page"), "20");
  assert.equal(buildGitHubReadmeUrl("org/repo"), "https://api.github.com/repos/org/repo/readme");
  assert.equal(buildGitHubReadmeUrl("org/repo/extra"), "");
});

test("GitHub ranking promotes implementations over popular aggregators and reference mentions", () => {
  const attention = {
    title: "Attention Is All You Need",
    arxivId: "1706.03762",
  };
  const candidates = parseGitHub({ items: [
    {
      full_name: "jadore801120/attention-is-all-you-need-pytorch",
      html_url: "https://github.com/jadore801120/attention-is-all-you-need-pytorch",
      description: 'A PyTorch implementation of "Attention Is All You Need".',
      stargazers_count: 9783,
      owner: { login: "jadore801120" },
    },
    {
      full_name: "org/awesome-transformer-papers",
      html_url: "https://github.com/org/awesome-transformer-papers",
      description: "Awesome state of the art paper list",
      stargazers_count: 20_000,
      owner: { login: "org" },
    },
    {
      full_name: "org/unrelated-tool",
      html_url: "https://github.com/org/unrelated-tool",
      description: "Popular documentation tool",
      stargazers_count: 30_000,
      owner: { login: "org" },
    },
  ] });
  const ranked = rankGitHubCandidates(attention, candidates, {
    "jadore801120/attention-is-all-you-need-pytorch": "Implementation of Attention Is All You Need. arXiv:1706.03762",
    "org/awesome-transformer-papers": "References: Attention Is All You Need",
    "org/unrelated-tool": "Bibliography: Attention Is All You Need",
  });
  assert.equal(ranked[0].name, "jadore801120/attention-is-all-you-need-pytorch");
  assert.equal(ranked[0].classification, "likely_implementation");
  assert.ok(ranked[0].relevance.score > ranked[1].relevance.score);
  assert.equal(ranked.find((candidate) => candidate.name === "org/awesome-transformer-papers").classification, "low_relevance");
  assert.equal(ranked.find((candidate) => candidate.name === "org/unrelated-tool").classification, "low_relevance");
});

test("GitHub classification requires both paper identity and implementation context", () => {
  const attention = { title: "Attention Is All You Need", arxivId: "1706.03762" };
  const candidates = parseGitHub({ items: [
    {
      full_name: "org/attention-is-all-you-need",
      html_url: "https://github.com/org/attention-is-all-you-need",
      description: "Paper notes and discussion",
      stargazers_count: 500,
      owner: { login: "org" },
    },
    {
      full_name: "org/transformer-code",
      html_url: "https://github.com/org/transformer-code",
      description: "Implementation of the Transformer paper",
      stargazers_count: 50,
      owner: { login: "org" },
    },
    {
      full_name: "org/awesome-attention",
      html_url: "https://github.com/org/awesome-attention",
      description: "Awesome paper list and implementation collection",
      stargazers_count: 5_000,
      owner: { login: "org" },
    },
    {
      full_name: "org/paper2code",
      html_url: "https://github.com/org/paper2code",
      description: "Turn any arXiv paper into a working implementation",
      stargazers_count: 10_000,
      owner: { login: "org" },
    },
  ] });
  const ranked = rankGitHubCandidates(attention, candidates, {
    "org/transformer-code": "Implementation of Attention Is All You Need. arXiv:1706.03762",
    "org/awesome-attention": "Implementation collection. Attention Is All You Need. arXiv:1706.03762",
    "org/paper2code": "arXiv:1706.03762 in, citation-anchored implementation out",
  });

  assert.equal(ranked.find((candidate) => candidate.name === "org/attention-is-all-you-need").classification, "possible_match");
  assert.equal(ranked.find((candidate) => candidate.name === "org/transformer-code").classification, "likely_implementation");
  assert.equal(ranked.find((candidate) => candidate.name === "org/awesome-attention").classification, "low_relevance");
  assert.equal(ranked.find((candidate) => candidate.name === "org/paper2code").classification, "low_relevance");
});

test("malformed GitHub payload is an error rather than an empty result", () => {
  assert.throws(() => parseGitHub({ total_count: 1 }), /Malformed GitHub response/);
});
