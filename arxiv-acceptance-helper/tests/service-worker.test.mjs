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
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
  };
}

test("analysis queries metadata sources but not GitHub, then reuses cache", async () => {
  const calls = [];
  const storage = memoryStorage();
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://dblp.org/")) return response({ result: { hits: { hit: [{ info: {
      title: paper.title,
      authors: { author: [{ text: "Ashish Vaswani" }] },
      venue: "NeurIPS",
      year: "2017",
      url: "https://dblp.org/rec/conf/nips/example",
    } }] } } });
    return response({ notes: [] });
  };
  const service = createService({ fetchImpl, storageLocal: storage, downloads: { download: async () => 1 }, now: () => 1000 });

  const first = await service.handleMessage({ type: "ANALYZE_PAPER", paper });
  const callCount = calls.length;
  const second = await service.handleMessage({ type: "ANALYZE_PAPER", paper });

  assert.equal(first.ok, true);
  assert.equal(first.data.representative.source, "dblp");
  const dblpUrl = new URL(calls.find((url) => url.startsWith("https://dblp.org/")));
  assert.equal(dblpUrl.searchParams.get("q"), `${paper.title} ${paper.authors[0]}`);
  assert.equal(calls.some((url) => url.startsWith("https://api.github.com/")), false);
  assert.equal(second.data.fromCache, true);
  assert.equal(calls.length, callCount);
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
  assert.equal(result.data.candidates[0].classification, "search_candidate");
  assert.equal(result.data.rateRemaining, 59);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/api\.github\.com\/search\/repositories/);
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
  assert.equal(calls, 1);
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
  assert.equal(calls, 1);
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
  assert.equal(result.data.sources.openreview.status, "success");
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
  assert.equal(entry.expiresAt - entry.savedAt, 10 * 60 * 1000);
});
