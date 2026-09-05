import test from "node:test";
import assert from "node:assert/strict";

import { createService } from "../src/service-worker.mjs";

const paper = {
  arxivId: "1706.03762",
  title: "Attention Is All You Need",
  authors: ["Ashish Vaswani"],
  year: 2017,
  pageUrl: "https://arxiv.org/abs/1706.03762",
  pdfUrl: "https://arxiv.org/pdf/1706.03762",
};

function response(payload, status = 200, headers = {}, metadata = {}) {
  const result = {
    ok: status >= 200 && status < 300,
    status,
    redirected: metadata.redirected ?? false,
    url: metadata.url ?? "",
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      if (typeof payload === "string") throw new SyntaxError("Not JSON");
      return payload;
    },
    text: async () => typeof payload === "string" ? payload : JSON.stringify(payload),
  };
  result.clone = () => response(payload, status, headers, metadata);
  return result;
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    async get(key) {
      if (key == null) return Object.fromEntries(values);
      return { [key]: values.get(key) };
    },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
  };
}

test("analysis queries metadata sources but not GitHub, then reuses cache", async () => {
  const calls = [];
  const storage = memoryStorage();
  storage.values.set("analysis:v9:expired", { expiresAt: 999 });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [{ info: {
      title: paper.title,
      authors: { author: [{ text: "Ashish Vaswani" }] },
      venue: "NeurIPS",
      year: "2017",
      url: "https://dblp.org/rec/conf/nips/example",
    } }] } } });
    if (url.startsWith("https://api.crossref.org/")) return response({ message: { items: [] } });
    return response({ notes: [] });
  };
  const service = createService({ fetchImpl, storageLocal: storage, downloads: { download: async () => 1 }, now: () => 1000 });

  const first = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  const callCount = calls.length;
  const second = await service.handleMessage({ type: "ANALYZE_PAPER", paper });

  assert.equal(first.ok, true);
  assert.equal(first.data.representative.source, "dblp");
  assert.deepEqual(first.data.sources.dblp, {
    status: "success",
    count: 1,
    matchedCount: 1,
    candidateCount: 0,
  });
  const dblpUrl = new URL(calls.find((url) => url.startsWith("https://dblp.org/")));
  assert.equal(dblpUrl.searchParams.get("q"), paper.title);
  assert.equal(calls.filter((url) => url.startsWith("https://dblp.org/")).length, 1);
  assert.equal(calls.some((url) => url.startsWith("https://api.crossref.org/")), true);
  assert.equal(calls.some((url) => url.startsWith("https://api.github.com/")), false);
  assert.equal(storage.values.has("analysis:v9:expired"), false);
  assert.equal(second.data.fromCache, true);
  assert.equal(calls.length, callCount);
});

test("source summaries distinguish identity matches from retained search candidates", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [
      { info: {
        title: paper.title,
        authors: { author: [{ text: paper.authors[0] }] },
        venue: "NeurIPS",
        year: "2017",
      } },
      { info: {
        title: "A Different Paper",
        authors: { author: [{ text: "Different Author" }] },
        venue: "ICML",
        year: "2026",
      } },
    ] } } });
    if (url.startsWith("https://api.crossref.org/")) return response({ message: { items: [] } });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.sources.dblp, {
    status: "success",
    count: 2,
    matchedCount: 1,
    candidateCount: 1,
  });
  assert.equal(result.data.records.length, 2);
  assert.equal(result.data.records.filter((record) => record.confidence === "candidate").length, 1);
});

test("DBLP falls back to the arXiv ID after one transient title-query failure", async () => {
  const queries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") {
      queries.push(parsed.searchParams.get("q"));
      if (queries.length === 1) return response({ message: "temporary" }, 503);
      return response({ result: { hits: { hit: [{ info: {
        title: paper.title,
        authors: { author: { text: paper.authors[0] } },
        venue: "NeurIPS",
        year: "2017",
      } }] } } });
    }
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.data.sources.dblp.status, "partial");
  assert.match(result.data.sources.dblp.warning, /temporary/);
  assert.deepEqual(queries, [paper.title, paper.arxivId]);
});

test("DBLP adds an author-disambiguated query when title-only top results miss the paper", async () => {
  const diffusion = {
    ...paper,
    arxivId: "2006.11239",
    title: "Denoising Diffusion Probabilistic Models",
    authors: ["Jonathan Ho", "Ajay Jain", "Pieter Abbeel"],
    year: 2020,
  };
  const queries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") {
      const query = parsed.searchParams.get("q");
      queries.push(query);
      if (query === `${diffusion.title} ${diffusion.authors[0]}`) {
        return response({ result: { hits: { hit: [{ info: {
          title: diffusion.title,
          authors: { author: diffusion.authors.map((text) => ({ text })) },
          venue: "NeurIPS",
          year: "2020",
          key: "conf/nips/HoJA20",
        } }] } } });
      }
      return response({ result: { hits: { hit: Array.from({ length: 20 }, (_, index) => ({ info: {
        title: `Unrelated Diffusion Paper ${index}`,
        authors: { author: { text: `Other Author ${index}` } },
        venue: "Example",
        year: "2020",
      } })) } } });
    }
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper: diffusion });
  assert.equal(result.data.representative.venueRaw, "NeurIPS");
  assert.deepEqual(queries, [diffusion.title, `${diffusion.title} ${diffusion.authors[0]}`]);
});

test("DBLP and Crossref start in parallel before the DBLP-dependent OpenReview lookup", async () => {
  const started = new Set();
  let metadataReady = false;
  let openReviewStartedEarly = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (url) => {
    const hostname = new URL(url).hostname;
    if (["dblp.org", "api2.openreview.net", "api.crossref.org"].includes(hostname)) {
      started.add(hostname);
    }
    if (["dblp.org", "api.crossref.org"].includes(hostname)) {
      if (started.has("dblp.org") && started.has("api.crossref.org")) {
        metadataReady = true;
        release();
      }
      await gate;
    }
    if (hostname === "api2.openreview.net" && !metadataReady) openReviewStartedEarly = true;
    if (hostname === "dblp.org") return response({ result: { hits: { hit: [] } } });
    if (hostname === "api.crossref.org") return response({ message: { items: [] } });
    if (hostname === "api.semanticscholar.org") return response({ title: paper.title });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.ok, true);
  assert.equal(openReviewStartedEarly, false);
  assert.deepEqual([...started].sort(), ["api.crossref.org", "api2.openreview.net", "dblp.org"]);
});

test("Semantic Scholar supplies probable venue metadata during a DBLP outage", async () => {
  const lora = {
    ...paper,
    arxivId: "2106.09685",
    title: "LoRA: Low-Rank Adaptation of Large Language Models",
    authors: ["Edward J. Hu", "Yelong Shen", "Phillip Wallis"],
    year: 2021,
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") return response({ message: "unavailable" }, 503);
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    if (parsed.hostname === "api.semanticscholar.org") return response({
      paperId: "lora",
      title: lora.title,
      authors: lora.authors.map((name) => ({ name })),
      year: 2022,
      venue: "ICLR",
      externalIds: { ArXiv: lora.arxivId },
      url: "https://www.semanticscholar.org/paper/lora",
    });
    return response({ name: "ChallengeRequiredError", message: "Challenge verification required" }, 403);
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper: lora });
  assert.equal(result.data.sources.dblp.status, "error");
  assert.equal(result.data.sources.semanticscholar.status, "success");
  assert.equal(result.data.representative.source, "semanticscholar");
  assert.equal(result.data.representative.venueRaw, "ICLR");
  assert.equal(result.data.representative.decision, "accepted");
  assert.equal(result.data.representative.confidence, "probable");
  assert.equal(result.data.verificationAxes.decision, "metadata_only");
});

test("a strong Crossref candidate can discover but not replace official proceedings verification", async () => {
  const officialUrl = "https://aclanthology.org/2017.acl-main.1/";
  const fetchImpl = async (url) => {
    if (url === officialUrl) return response(`
      <meta name="citation_title" content="${paper.title}">
      <meta name="citation_author" content="${paper.authors[0]}">
      <meta name="citation_conference_title" content="ACL 2017 Main Conference">
    `);
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    if (url.startsWith("https://api.crossref.org/")) return response({ message: { items: [{
      title: [paper.title],
      author: [{ given: "Ashish", family: "Vaswani" }],
      type: "proceedings-article",
      "container-title": ["ACL"],
      published: { "date-parts": [[2017]] },
      DOI: "10.18653/v1/2017.acl-main.1",
      resource: { primary: { URL: officialUrl } },
    }] } });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.ok, true);
  assert.equal(result.data.sources.crossref.status, "success");
  assert.equal(result.data.sources.proceedings.status, "success");
  assert.equal(result.data.representative.source, "proceedings");
  assert.equal(result.data.verificationAxes.decision, "verified");
});

test("Crossref retains primary candidates when a historical-title follow-up fails", async () => {
  const renamed = {
    ...paper,
    metadataAliases: [{ title: "Older Title", authors: paper.authors, year: 2017, version: 1 }],
  };
  const storage = memoryStorage();
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") return response({ result: { hits: { hit: [] } } });
    if (parsed.hostname === "api.crossref.org") {
      if (parsed.searchParams.get("query.title") === "Older Title") throw new Error("alias lookup offline");
      return response({ message: { items: [{
        title: ["A Different Paper"],
        author: [{ given: "Different", family: "Author" }],
        "container-title": ["Example Venue"],
        published: { "date-parts": [[2017]] },
      }] } });
    }
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: storage,
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper: renamed });
  const [entry] = storage.values.values();
  assert.equal(result.data.sources.crossref.status, "partial");
  assert.equal(result.data.sources.crossref.count, 1);
  assert.match(result.data.sources.crossref.warning, /alias lookup offline/);
  assert.equal(entry.expiresAt - entry.savedAt, 5 * 60 * 1000);
});

test("OpenReview Decision remains available when DBLP fails", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) throw new Error("DBLP offline");
    if (url.includes("/notes/search")) return response({ notes: [{
      id: "forum",
      forum: "forum",
      invitations: ["ICLR.cc/2017/Conference/-/Submission"],
      content: {
        title: { value: paper.title },
        authors: { value: paper.authors },
        venue: { value: "ICLR 2017 Conference" },
        track: { value: "Main Conference" },
      },
    }] });
    if (url.includes("forum=forum")) return response({ notes: [{
      id: "decision",
      forum: "forum",
      invitations: ["ICLR.cc/2017/Conference/-/Decision"],
      content: { decision: { value: "Accept (Poster)" } },
    }] });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.ok, true);
  assert.equal(result.data.sources.dblp.status, "error");
  assert.equal(result.data.sources.openreview.status, "success");
  assert.equal(result.data.representative.decision, "accepted");
  assert.equal(result.data.verification, "verified");
});

test("GitHub is queried only by the explicit search message", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return response({ items: [{
      full_name: "org/repo",
      html_url: "https://github.com/org/repo",
      description: "Code",
      stargazers_count: 2,
      updated_at: "2026-08-01T00:00:00Z",
      owner: { login: "org" },
    }] }, 200, { "x-ratelimit-remaining": "59" });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "SEARCH_GITHUB", paper });
  assert.equal(result.ok, true);
  assert.equal(result.data.candidates[0].classification, "low_relevance");
  assert.equal(Number.isInteger(result.data.candidates[0].relevance.score), true);
  assert.equal(result.data.rateRemaining, 59);
  assert.equal(calls.filter((url) => url.includes("/search/repositories")).length, 2);
  assert.equal(calls.filter((url) => url.endsWith("/readme")).length, 1);
});

test("GitHub README validation combines the top title and identifier candidates", async () => {
  const readmes = [];
  let activeReadmes = 0;
  let maxActiveReadmes = 0;
  const repository = (prefix, index) => ({
    full_name: `org/${prefix}-${index}`,
    html_url: `https://github.com/org/${prefix}-${index}`,
    description: `${paper.title} implementation candidate ${index}`,
    stargazers_count: 10 - index,
    owner: { login: "org" },
  });
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/search/repositories") {
      const identifierSearch = parsed.searchParams.get("q").includes(paper.arxivId);
      const prefix = identifierSearch ? "identifier" : "title";
      return response({ items: Array.from({ length: 6 }, (_, index) => repository(prefix, index)) });
    }
    if (parsed.pathname.endsWith("/readme")) {
      activeReadmes += 1;
      maxActiveReadmes = Math.max(maxActiveReadmes, activeReadmes);
      await new Promise((resolve) => setImmediate(resolve));
      readmes.push(parsed.pathname);
      activeReadmes -= 1;
      return response(`Implementation of ${paper.title}. arXiv:${paper.arxivId}`);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "SEARCH_GITHUB", paper });
  assert.equal(result.ok, true);
  assert.equal(readmes.length, 8);
  assert.equal(readmes.filter((path) => path.includes("/title-")).length, 4);
  assert.equal(readmes.filter((path) => path.includes("/identifier-")).length, 4);
  assert.equal(maxActiveReadmes, 2);
});

test("GitHub and download permissions are requested only for their user actions", async () => {
  const requests = [];
  const permissions = {
    async request(request) { requests.push(request); return true; },
    async contains() { return true; },
  };
  const downloadCalls = [];
  const service = createService({
    fetchImpl: async () => response({ items: [] }),
    storageLocal: memoryStorage(),
    storageSession: memoryStorage(),
    permissions,
    downloads: { download: async (options) => { downloadCalls.push(options); return 7; } },
    now: () => 1000,
  });

  assert.deepEqual(await service.handleMessage({ type: "REQUEST_GITHUB_ACCESS" }), {
    ok: true,
    data: { granted: true },
  });
  const download = await service.handleMessage({
    type: "DOWNLOAD_PDF",
    pdfUrl: paper.pdfUrl,
    filename: "Attention_1706.03762.pdf",
    saveAs: true,
  });
  assert.equal(download.ok, true);
  assert.deepEqual(requests, [
    { origins: ["https://api.github.com/*"] },
    { permissions: ["downloads"] },
  ]);
  assert.equal(downloadCalls.length, 1);
});

test("download API is resolved after its optional permission is granted", async () => {
  let downloadApi;
  const service = createService({
    permissions: {
      async request() {
        downloadApi = { download: async () => 7 };
        return true;
      },
    },
    getDownloads: () => downloadApi,
  });

  const result = await service.handleMessage({
    type: "DOWNLOAD_PDF",
    pdfUrl: paper.pdfUrl,
    filename: "Attention_1706.03762.pdf",
    saveAs: true,
  });

  assert.deepEqual(result, { ok: true, data: { downloadId: 7 } });
});

test("a denied optional permission prevents its privileged action", async () => {
  const service = createService({
    fetchImpl: async () => { throw new Error("must not fetch"); },
    storageLocal: memoryStorage(),
    storageSession: memoryStorage(),
    permissions: {
      async request() { return false; },
      async contains() { return false; },
    },
    downloads: { download: async () => { throw new Error("must not download"); } },
    now: () => 1000,
  });

  const github = await service.handleMessage({ type: "REQUEST_GITHUB_ACCESS" });
  const download = await service.handleMessage({
    type: "DOWNLOAD_PDF",
    pdfUrl: paper.pdfUrl,
    filename: "Attention_1706.03762.pdf",
    saveAs: true,
  });
  assert.equal(github.ok, false);
  assert.match(github.error, /permission/i);
  assert.equal(download.ok, false);
  assert.match(download.error, /permission/i);
});

test("GitHub allows at most five uncached paper searches per hour", async () => {
  let calls = 0;
  const service = createService({
    fetchImpl: async () => {
      calls += 1;
      return response({ items: [] }, 200, {
        "x-ratelimit-remaining": "50",
        "x-ratelimit-resource": "search",
      });
    },
    storageLocal: memoryStorage(),
    storageSession: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  for (let index = 1; index <= 5; index += 1) {
    const result = await service.handleMessage({
      type: "SEARCH_GITHUB",
      paper: { ...paper, arxivId: `1706.0000${index}`, title: `Paper ${index}` },
    });
    assert.equal(result.ok, true);
  }
  const limited = await service.handleMessage({
    type: "SEARCH_GITHUB",
    paper: { ...paper, arxivId: "1706.00006", title: "Paper 6" },
  });
  assert.equal(limited.ok, false);
  assert.match(limited.error, /five GitHub searches per hour/i);
  assert.equal(calls, 10);
});

test("GitHub click-search reuses a one-hour session cache", async () => {
  let calls = 0;
  const storageSession = memoryStorage();
  const service = createService({
    fetchImpl: async () => {
      calls += 1;
      return response({ items: [] }, 200, { "x-ratelimit-remaining": "59" });
    },
    storageLocal: memoryStorage(),
    storageSession,
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const first = await service.handleMessage({ type: "SEARCH_GITHUB", paper });
  const second = await service.handleMessage({ type: "SEARCH_GITHUB", paper });
  assert.equal(first.data.fromCache, false);
  assert.equal(second.data.fromCache, true);
  assert.equal(calls, 2);
});

test("incomplete GitHub results use a five-minute cache", async () => {
  const storageSession = memoryStorage();
  const service = createService({
    fetchImpl: async () => response(
      { incomplete_results: true, items: [] },
      200,
      { "x-ratelimit-remaining": "59" },
    ),
    storageLocal: memoryStorage(),
    storageSession,
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "SEARCH_GITHUB", paper });
  const entry = [...storageSession.values.values()]
    .find((value) => value?.data?.incompleteResults === true);
  assert.equal(result.data.incompleteResults, true);
  assert.equal(entry.expiresAt - entry.savedAt, 5 * 60 * 1000);
});

test("concurrent GitHub clicks share one in-flight API request", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const service = createService({
    fetchImpl: async () => {
      calls += 1;
      await pending;
      return response({ items: [] }, 200, { "x-ratelimit-remaining": "59" });
    },
    storageLocal: memoryStorage(),
    storageSession: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const first = service.handleMessage({ type: "SEARCH_GITHUB", paper });
  const second = service.handleMessage({ type: "SEARCH_GITHUB", paper });
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(calls, 2);
});

test("download uses the validated filename and Save As setting", async () => {
  const downloadCalls = [];
  const service = createService({
    fetchImpl: async () => response({}),
    storageLocal: memoryStorage(),
    downloads: { download: async (options) => { downloadCalls.push(options); return 7; } },
    now: () => 1000,
  });
  const result = await service.handleMessage({
    type: "DOWNLOAD_PDF",
    pdfUrl: paper.pdfUrl,
    filename: "Attention_1706.03762.pdf",
    saveAs: true,
  });
  assert.deepEqual(downloadCalls, [{
    url: paper.pdfUrl,
    filename: "Attention_1706.03762.pdf",
    saveAs: true,
    conflictAction: "uniquify",
  }]);
  assert.deepEqual(result, { ok: true, data: { downloadId: 7 } });
});

test("invalid messages fail before any browser side effect", async () => {
  let fetched = false;
  let downloaded = false;
  const service = createService({
    fetchImpl: async () => { fetched = true; return response({}); },
    storageLocal: memoryStorage(),
    downloads: { download: async () => { downloaded = true; return 1; } },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "FETCH", url: "https://evil.test" });
  assert.equal(result.ok, false);
  assert.equal(fetched, false);
  assert.equal(downloaded, false);
});

test("a total metadata outage is not cached for 24 hours", async () => {
  let calls = 0;
  const storage = memoryStorage();
  const service = createService({
    fetchImpl: async () => { calls += 1; throw new Error("offline"); },
    storageLocal: storage,
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  const firstCalls = calls;
  await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.ok(calls > firstCalls);
  assert.equal(storage.values.size, 0);
});

test("weak OpenReview v2 matches stay visible as candidates after v1 fallback", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    if (url.includes("api2.openreview.net/notes/search")) return response({ notes: [{
      id: "weak",
      forum: "weak",
      content: {
        title: { value: paper.title },
        authors: { value: ["Different Person"] },
        venue: { value: "Example 2017 Conference" },
      },
    }] });
    if (url.startsWith("https://api.openreview.net/")) return response({
      name: "ChallengeRequiredError",
      message: "Challenge verification required",
    }, 403);
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.data.records.length, 1);
  assert.equal(result.data.records[0].confidence, "candidate");
  assert.equal(result.data.representative, null);
  assert.match(result.data.sources.openreview.warning, /v1: Challenge verification required/);
  assert.match(result.data.sources.openreview.manualUrl, /^https:\/\/openreview\.net\/search\?/);
});

test("an explicit arXiv comment supplies an author-reported fallback without entering records", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    if (url.startsWith("https://api.crossref.org/")) return response({ message: { items: [] } });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({
    type: "ANALYZE_PAPER",
    paper: { ...paper, comment: "Accepted at ICLR 2018 as a poster", metadataVersion: 2 },
  });

  assert.equal(result.data.representative.source, "arxiv-comment");
  assert.equal(result.data.representative.decision, "accepted");
  assert.equal(result.data.representative.confidence, "self_reported");
  assert.equal(result.data.representative.presentation, "poster");
  assert.equal(result.data.verification, "self_reported");
  assert.equal(result.data.representative.sourceVersion, 2);
  assert.equal(result.data.metadataVersion, 2);
  assert.deepEqual(result.data.records, []);
});

test("OpenReview discovery and identity scoring can use an older arXiv title alias", async () => {
  const renamed = {
    ...paper,
    title: "A Completely Renamed Paper",
    authors: ["Alice Kim", "Bob Lee"],
    metadataVersion: 2,
    metadataAliases: [{
      title: "Original Submission Title",
      authors: ["Alice Kim"],
      year: 2017,
      version: 1,
    }],
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") return response({ result: { hits: { hit: [] } } });
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    if (parsed.hostname === "api2.openreview.net" && parsed.pathname.endsWith("/notes/search")) {
      if (parsed.searchParams.get("term") !== "Original Submission Title") return response({ notes: [] });
      return response({ notes: [{
        id: "alias-forum",
        forum: "alias-forum",
        content: {
          title: { value: "Original Submission Title" },
          authors: { value: ["Alice Kim"] },
          venue: { value: "ICLR 2018 poster" },
        },
      }] });
    }
    if (parsed.hostname === "api2.openreview.net" && parsed.searchParams.get("forum") === "alias-forum") {
      return response({ notes: [{
        id: "decision",
        forum: "alias-forum",
        invitations: ["ICLR.cc/2018/Conference/-/Decision"],
        content: { decision: { value: "Accept (Poster)" } },
      }] });
    }
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper: renamed });
  assert.equal(result.ok, true);
  assert.equal(result.data.representative.source, "openreview");
  assert.equal(result.data.representative.decision, "accepted");
  assert.equal(result.data.representative.matchEvidence.metadataVersion, 1);
  assert.ok(calls.some((url) => new URL(url).searchParams.get("term") === "Original Submission Title"));
});

test("an external rejection is never overridden by an arXiv comment", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    if (url.startsWith("https://api.crossref.org/")) return response({ message: { items: [] } });
    if (url.includes("/notes/search")) return response({ notes: [{
      id: "rejected",
      forum: "rejected",
      content: {
        title: { value: paper.title },
        authors: { value: paper.authors },
        venue: { value: "ICLR 2018" },
        decision: { value: "Reject" },
      },
    }] });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({
    type: "ANALYZE_PAPER",
    paper: { ...paper, comment: "Accepted at ICLR 2018" },
  });

  assert.equal(result.data.representative.source, "openreview");
  assert.equal(result.data.representative.decision, "rejected");
});

test("AdaLoRA searches its shorter title and follows DBLP's exact OpenReview forum", async () => {
  const adaLora = {
    arxivId: "2303.10512",
    title: "AdaLoRA: Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
    authors: [
      "Qingru Zhang", "Minshuo Chen", "Alexander Bukharin", "Nikos Karampatziakis",
      "Pengcheng He", "Yu Cheng", "Weizhu Chen", "Tuo Zhao",
    ],
    year: 2023,
    comment: "The 11th International Conference on Learning Representations (ICLR 2023)",
    metadataVersion: 2,
    metadataAliases: [{
      title: "Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
      authors: [
        "Qingru Zhang", "Minshuo Chen", "Alexander Bukharin", "Pengcheng He",
        "Yu Cheng", "Weizhu Chen", "Tuo Zhao",
      ],
      year: 2023,
      version: 1,
    }],
    pageUrl: "https://arxiv.org/abs/2303.10512",
    pdfUrl: "https://arxiv.org/pdf/2303.10512",
  };
  const forumId = "lq62uWRJjiY";
  const calls = [];
  const corr = {
    title: "Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning.",
    authors: { author: adaLora.authors.filter((author) => author !== "Nikos Karampatziakis")
      .map((text) => ({ text: text === "Yu Cheng" ? "Yu Cheng 0001" : text })) },
    venue: "CoRR",
    key: "journals/corr/abs-2303-10512",
    doi: "10.48550/arXiv.2303.10512",
    year: "2023",
  };
  const published = {
    ...corr,
    venue: "ICLR",
    key: "conf/iclr/ZhangCBH0CZ23",
    doi: undefined,
    ee: `https://openreview.net/forum?id=${forumId}`,
    url: "https://dblp.org/rec/conf/iclr/ZhangCBH0CZ23",
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") {
      const query = parsed.searchParams.get("q");
      if (query === adaLora.arxivId) return response({ result: { hits: { hit: [{ info: corr }] } } });
      if (query === "Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning") {
        return response({ result: { hits: { hit: [
        { info: published }, { info: corr },
        ] } } });
      }
      return response({ result: { hits: { hit: [] } } });
    }
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    if (parsed.searchParams.get("forum") === forumId) return response({ notes: [
      {
        id: forumId,
        forum: forumId,
        content: {
          title: { value: adaLora.title },
          authors: { value: adaLora.authors },
          venue: { value: "ICLR 2023 poster" },
          venueid: { value: "ICLR.cc/2023/Conference" },
        },
      },
      {
        id: "decision",
        forum: forumId,
        invitations: ["ICLR.cc/2023/Conference/-/Decision"],
        content: { decision: { value: "Accept (Poster)" } },
      },
    ] });
    if (parsed.hostname === "api2.openreview.net") return response({ notes: [{
      id: "unrelated",
      forum: "unrelated",
      content: {
        title: { value: "An Unrelated Parameter Efficient Method" },
        authors: { value: ["Someone Else"] },
        venue: { value: "ICLR 2024" },
      },
    }] });
    if (parsed.hostname === "api.openreview.net") return response({
      name: "ChallengeRequiredError",
      message: "Challenge verification required",
    }, 403);
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper: adaLora });
  const dblpQueries = calls
    .filter((url) => new URL(url).hostname === "dblp.org")
    .map((url) => new URL(url).searchParams.get("q"));

  assert.equal(result.ok, true);
  assert.equal(result.data.sources.dblp.matchedCount, 2);
  assert.equal(result.data.representative.source, "openreview");
  assert.equal(result.data.representative.presentation, "poster");
  assert.equal(result.data.representative.sourceUrl, `https://openreview.net/forum?id=${forumId}`);
  assert.deepEqual(dblpQueries, [
    adaLora.title,
    "Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
  ]);
  const openReviewCalls = calls.filter((url) => new URL(url).hostname.endsWith("openreview.net"));
  assert.equal(openReviewCalls.some((url) => new URL(url).pathname.endsWith("/notes/search")), false);
  assert.equal(new URL(openReviewCalls[0]).hostname, "api.openreview.net");
  assert.ok(openReviewCalls.some((url) => new URL(url).searchParams.get("forum") === forumId));
});

test("a DBLP-linked OpenReview challenge stays distinct from zero search results", async () => {
  const forumId = "lq62uWRJjiY";
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") return response({ result: { hits: { hit: [{ info: {
      title: "AdaLoRA: Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
      authors: { author: { text: "Qingru Zhang" } },
      venue: "ICLR",
      year: "2023",
      key: "conf/iclr/ZhangCBH0CZ23",
      ee: `https://openreview.net/forum?id=${forumId}`,
    } }] } } });
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    return response({
      name: "ChallengeRequiredError",
      message: "Challenge verification required",
    }, 403);
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const adaLora = {
    ...paper,
    arxivId: "2303.10512",
    title: "AdaLoRA: Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
    authors: ["Qingru Zhang"],
    year: 2023,
    comment: "The 11th International Conference on Learning Representations (ICLR 2023)",
  };

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper: adaLora });
  const openReviewCalls = calls.filter(({ url }) => new URL(url).hostname.endsWith("openreview.net"));
  assert.equal(result.data.representative.source, "dblp");
  assert.equal(result.data.sources.openreview.status, "linked_blocked");
  assert.equal(result.data.sources.openreview.apiVerified, false);
  assert.deepEqual(result.data.sources.openreview.linkedForums, [{
    forumId,
    url: `https://openreview.net/forum?id=${forumId}`,
    discoveredBy: "dblp",
  }]);
  assert.equal(result.data.sources.openreview.manualUrl, `https://openreview.net/forum?id=${forumId}`);
  assert.equal(result.data.records.some((record) => record.source === "openreview"), false);
  assert.deepEqual(openReviewCalls.map(({ url }) => new URL(url).hostname), [
    "api.openreview.net",
    "api2.openreview.net",
  ]);
  assert.equal(openReviewCalls.every(({ options }) => options.credentials === "omit"), true);
  assert.equal(openReviewCalls.some(({ url }) => new URL(url).pathname.endsWith("/notes/search")), false);
});

test("a legacy linked forum falls through to v2 when v1 is blocked", async () => {
  const forumId = "legacy-forum";
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") return response({ result: { hits: { hit: [{ info: {
      title: paper.title,
      authors: { author: { text: paper.authors[0] } },
      venue: "ICLR",
      year: "2023",
      ee: `https://openreview.net/forum?id=${forumId}`,
    } }] } } });
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    if (parsed.hostname === "api.openreview.net") return response({
      name: "ChallengeRequiredError",
      message: "Challenge verification required",
    }, 403);
    return response({ notes: [
      {
        id: forumId,
        forum: forumId,
        content: {
          title: { value: paper.title },
          authors: { value: paper.authors },
          venue: { value: "ICLR 2023 poster" },
          venueid: { value: "ICLR.cc/2023/Conference" },
        },
      },
      {
        id: "legacy-decision",
        forum: forumId,
        invitation: "ICLR.cc/2023/Conference/-/Decision",
        content: { decision: { value: "Accept (Poster)" } },
      },
    ] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper: { ...paper, year: 2023 } });
  assert.equal(result.data.sources.openreview.status, "success");
  assert.equal(result.data.sources.openreview.apiVerified, true);
  assert.equal(result.data.representative.source, "openreview");
  assert.deepEqual(calls
    .filter((url) => new URL(url).hostname.endsWith("openreview.net"))
    .map((url) => new URL(url).hostname), ["api.openreview.net", "api2.openreview.net"]);
});

test("OpenReview is anonymous by default and includes the session only after explicit retry", async () => {
  const forumId = "retry-forum";
  let verified = false;
  const openReviewCredentials = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") return response({ result: { hits: { hit: [{ info: {
      title: paper.title,
      authors: { author: { text: paper.authors[0] } },
      venue: "ICLR",
      year: "2017",
      ee: `https://openreview.net/forum?id=${forumId}`,
    } }] } } });
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    openReviewCredentials.push(options.credentials);
    if (!verified) return response({
      name: "ChallengeRequiredError",
      message: "Challenge verification required",
    }, 403);
    return response({ notes: [
      {
        id: forumId,
        forum: forumId,
        content: {
          title: paper.title,
          authors: paper.authors,
          venue: "ICLR 2017 Conference",
          venueid: "ICLR.cc/2017/conference",
        },
      },
      {
        id: "retry-decision",
        forum: forumId,
        invitation: "ICLR.cc/2017/conference/-/Decision",
        content: { decision: "Accept (Poster)" },
      },
    ] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const blocked = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  const anonymousCalls = openReviewCredentials.length;
  verified = true;
  const retried = await service.handleMessage({
    type: "REFRESH_PAPER",
    paper,
    openReviewSession: true,
  });
  assert.equal(blocked.data.sources.openreview.status, "linked_blocked");
  assert.equal(retried.data.sources.openreview.status, "success");
  assert.equal(retried.data.sources.openreview.apiVerified, true);
  assert.equal(retried.data.representative.source, "openreview");
  assert.equal(openReviewCredentials.slice(0, anonymousCalls).every((value) => value === "omit"), true);
  assert.equal(openReviewCredentials.slice(anonymousCalls).every((value) => value === "include"), true);
});

test("a refresh keeps fresh external evidence when DBLP becomes temporarily unavailable", async () => {
  const storageLocal = memoryStorage();
  let dblpAvailable = true;
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") {
      if (!dblpAvailable) return response({ message: "temporary outage" }, 503);
      return response({ result: { hits: { hit: [{ info: {
        title: paper.title,
        authors: { author: { text: paper.authors[0] } },
        venue: "NeurIPS",
        year: "2017",
        key: "conf/nips/VaswaniSPUJGKP17",
      } }] } } });
    }
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    return response({
      name: "ChallengeRequiredError",
      message: "Challenge verification required",
    }, 403);
  };
  const service = createService({
    fetchImpl,
    storageLocal,
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const commentedPaper = { ...paper, comment: "Accepted at NeurIPS 2017" };

  const first = await service.handleMessage({ type: "ANALYZE_PAPER", paper: commentedPaper });
  dblpAvailable = false;
  const refreshed = await service.handleMessage({
    type: "REFRESH_PAPER",
    paper: commentedPaper,
  });

  assert.equal(first.data.representative.source, "dblp");
  assert.equal(refreshed.data.representative.source, "dblp");
  assert.equal(refreshed.data.representative.evidenceFreshness, "previous");
  assert.equal(refreshed.data.sources.dblp.status, "error");
  assert.equal(refreshed.data.usingPreviousEvidence, true);
  assert.match(refreshed.data.staleEvidenceWarning, /previously verified external evidence/);
});

test("DBLP discovery can use a substantially renamed historical arXiv title", async () => {
  const renamed = {
    ...paper,
    title: "A Completely Renamed Final Paper",
    authors: ["Alice Kim", "Bob Lee"],
    metadataVersion: 3,
    metadataAliases: [{
      title: "Original Submission Title",
      authors: ["Alice Kim"],
      year: 2017,
      version: 1,
    }],
  };
  const queries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") {
      const query = parsed.searchParams.get("q");
      queries.push(query);
      if (query === "Original Submission Title") return response({ result: { hits: { hit: [{ info: {
        title: "Original Submission Title",
        authors: { author: { text: "Alice Kim" } },
        venue: "ICLR",
        year: "2017",
        key: "conf/iclr/example",
      } }] } } });
      return response({ result: { hits: { hit: [] } } });
    }
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper: renamed });
  assert.equal(result.data.representative.source, "dblp");
  assert.equal(result.data.representative.matchEvidence.metadataVersion, 1);
  assert.deepEqual(queries, [renamed.title, `${renamed.title} ${renamed.authors[0]}`, "Original Submission Title"]);
});

test("a partial DBLP recovery stays visible and a formal arXiv venue comment supplies the fallback", async () => {
  const storage = memoryStorage();
  const versioned = {
    ...paper,
    title: "Version Two Title",
    comment: "The 11th International Conference on Learning Representations (ICLR 2023)",
    metadataVersion: 2,
  };
  const corr = {
    title: "Canonical DBLP Title",
    authors: { author: { text: paper.authors[0] } },
    venue: "CoRR",
    key: "journals/corr/abs-1706-03762",
    doi: "10.48550/arXiv.1706.03762",
    year: "2017",
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "dblp.org") {
      const query = parsed.searchParams.get("q");
      if (query === versioned.arxivId) return response({ result: { hits: { hit: [{ info: corr }] } } });
      if (query === corr.title) throw new Error("canonical lookup offline");
      return response({ result: { hits: { hit: [] } } });
    }
    if (parsed.hostname === "api.crossref.org") return response({ message: { items: [] } });
    return response({ name: "ChallengeRequiredError", message: "Challenge verification required" }, 403);
  };
  const service = createService({
    fetchImpl,
    storageLocal: storage,
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper: versioned });
  const [entry] = storage.values.values();
  assert.equal(result.data.sources.dblp.status, "partial");
  assert.match(result.data.sources.dblp.warning, /canonical lookup offline/);
  assert.equal(result.data.sources.openreview.status, "error");
  assert.equal(result.data.records.length, 1);
  assert.equal(result.data.records[0].decision, "preprint");
  assert.equal(result.data.representative.source, "arxiv-comment");
  assert.equal(result.data.representative.venueRaw, "ICLR 2023");
  assert.equal(entry.expiresAt - entry.savedAt, 5 * 60 * 1000);
});

test("partial verification with a strong external publication uses a one-hour cache", async () => {
  const storage = memoryStorage();
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [{ info: {
      title: paper.title,
      authors: { author: { text: paper.authors[0] } },
      venue: "NeurIPS",
      year: "2017",
    } }] } } });
    if (url.startsWith("https://api.crossref.org/")) return response({ message: { items: [] } });
    return response({ name: "ChallengeRequiredError", message: "Challenge verification required" }, 403);
  };
  const service = createService({
    fetchImpl,
    storageLocal: storage,
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  const [entry] = storage.values.values();
  assert.equal(result.data.representative.source, "dblp");
  assert.equal(result.data.sources.openreview.status, "error");
  assert.equal(entry.expiresAt - entry.savedAt, 60 * 60 * 1000);
});

test("forum lookup failures remain visible as an OpenReview warning", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    if (url.includes("/notes/search")) return response({ notes: [{
      id: "forum",
      forum: "forum",
      content: {
        title: { value: paper.title },
        authors: { value: paper.authors },
        venue: { value: "ICLR 2017 Conference" },
      },
    }] });
    if (url.includes("forum=forum")) throw new Error("forum offline");
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.ok, true);
  assert.match(result.data.sources.openreview.warning, /forum offline/);
});

test("OpenReview challenge failures expose an actionable verification link", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    if (url.includes("/notes/search")) return response({ notes: [{
      id: "forum",
      forum: "forum",
      content: {
        title: { value: paper.title },
        authors: { value: paper.authors },
        venue: { value: "ICLR 2017 Conference" },
      },
    }] });
    if (url.includes("forum=forum")) return response({
      name: "ChallengeRequiredError",
      message: "Challenge verification required",
      details: { challengeUrl: "https://openreview.net.evil.test/challenge" },
    }, 403);
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.ok, true);
  assert.equal(result.data.sources.openreview.status, "partial");
  assert.match(result.data.sources.openreview.warning, /Challenge verification required/);
  assert.equal(result.data.sources.openreview.manualUrl, "https://openreview.net/forum?id=forum");
});

test("OpenReview HTML challenge is a manual-verification state", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    return response("<html><title>Challenge verification</title></html>");
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.data.sources.openreview.status, "error");
  assert.match(result.data.sources.openreview.error, /interactive verification/);
  assert.match(result.data.sources.openreview.manualUrl, /^https:\/\/openreview\.net\/search\?/);
});

test("official proceedings verify track only after a strong DBLP candidate", async () => {
  const officialUrl = "https://aclanthology.org/2025.acl-main.1/";
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [{ info: {
      title: paper.title,
      authors: { author: { text: paper.authors[0] } },
      venue: "ACL",
      year: "2025",
      doi: "10.1/example",
      ee: ["https://doi.org/10.1/example", officialUrl],
    } }] } } });
    if (url === officialUrl) return response(`
      <meta name="citation_title" content="${paper.title}">
      <meta name="citation_author" content="${paper.authors[0]}">
      <meta name="citation_conference_title" content="ACL 2025 Main Conference">
      <meta name="citation_doi" content="10.1/example">
    `);
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.data.sources.proceedings.status, "success");
  assert.equal(result.data.representative.source, "proceedings");
  assert.deepEqual(result.data.verificationAxes, {
    identity: "probable",
    decision: "verified",
    track: "verified",
  });
  assert.equal(calls.filter((url) => url === officialUrl).length, 1);
});

test("OpenReview top-level challenge stops before the v1 fallback", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    if (url.includes("api2.openreview.net/notes/search")) return response({
      name: "ChallengeRequiredError",
      message: "Challenge verification required",
      details: { challengeUrl: "https://api.openreview.net/untrusted-value" },
    }, 403);
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.ok, true);
  assert.equal(result.data.sources.openreview.status, "error");
  assert.match(result.data.sources.openreview.error, /Challenge verification required/);
  const manualUrl = new URL(result.data.sources.openreview.manualUrl);
  assert.equal(manualUrl.origin + manualUrl.pathname, "https://openreview.net/search");
  assert.equal(manualUrl.searchParams.get("term"), paper.title);
  assert.equal(calls.some((url) => url.startsWith("https://api.openreview.net/")), false);
});

test("OpenReview rate limiting does not trigger an extra legacy request", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    return response({ message: "Too many requests" }, 429);
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.match(result.data.sources.openreview.error, /Too many requests.*429/);
  assert.match(result.data.sources.openreview.manualUrl, /^https:\/\/openreview\.net\/search\?/);
  assert.equal(calls.some((url) => url.startsWith("https://api.openreview.net/")), false);
});

test("OpenReview ignores an API-supplied challenge URL and builds its own", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    if (url.includes("/notes/search")) return response({ notes: [{
      id: "forum",
      forum: "forum",
      content: {
        title: { value: paper.title },
        authors: { value: paper.authors },
        venue: { value: "ICLR 2017 Conference" },
      },
    }] });
    if (url.includes("forum=forum")) return response({
      name: "ChallengeRequiredError",
      message: "Challenge verification required",
      details: { challengeUrl: "https://openreview.net.evil.test/challenge" },
    }, 403);
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });

  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.match(result.data.sources.openreview.warning, /Challenge verification required/);
  assert.equal(
    result.data.sources.openreview.manualUrl,
    "https://openreview.net/forum?id=forum",
  );
});

test("only the two strongest OpenReview search results receive forum lookups", async () => {
  const forums = new Set();
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [] } } });
    if (url.includes("/notes/search")) return response({ notes: Array.from({ length: 4 }, (_, index) => ({
      id: `forum-${index}`,
      forum: `forum-${index}`,
      content: {
        title: { value: paper.title },
        authors: { value: paper.authors },
        venue: { value: `Conference ${2017 + index}` },
      },
    })) });
    const forum = new URL(url).searchParams.get("forum");
    if (forum) forums.add(forum);
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: memoryStorage(),
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.ok, true);
  assert.deepEqual([...forums].sort(), ["forum-0", "forum-1"]);
});

test("cache write failure does not discard successful network analysis", async () => {
  const storage = {
    async get() { return {}; },
    async set() { throw new Error("storage unavailable"); },
  };
  const fetchImpl = async (url) => {
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [{ info: {
      title: paper.title,
      authors: { author: { text: paper.authors[0] } },
      venue: "NeurIPS",
      year: "2017",
    } }] } } });
    return response({ notes: [] });
  };
  const service = createService({
    fetchImpl,
    storageLocal: storage,
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  assert.equal(result.ok, true);
  assert.equal(result.data.representative.source, "dblp");
  assert.match(result.data.cacheWarning, /storage unavailable/);
});

test("partial source failures use the short cache expiry", async () => {
  const storage = memoryStorage();
  const service = createService({
    fetchImpl: async (url) => {
      if (url.startsWith("https://dblp.org/")) throw new Error("offline");
      return response({ notes: [] });
    },
    storageLocal: storage,
    downloads: { download: async () => 1 },
    now: () => 1000,
  });
  const result = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  const [entry] = storage.values.values();
  assert.equal(result.ok, true);
  assert.equal(entry.expiresAt - entry.savedAt, 5 * 60 * 1000);
});
