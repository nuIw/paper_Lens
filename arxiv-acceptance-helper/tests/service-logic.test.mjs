import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCacheEntry,
  CACHE_ERROR_TTL_MS,
  CACHE_PROBABLE_TTL_MS,
  CACHE_SCHEMA_VERSION,
  CACHE_TTL_MS,
  cacheKey,
  expiredCacheKeys,
  GITHUB_INCOMPLETE_CACHE_TTL_MS,
  githubCacheKey,
  isAllowedPdfUrl,
  isFreshCache,
  isTrustedSender,
  validateMessage,
} from "../src/service-logic.mjs";

const paper = {
  arxivId: "1706.03762",
  title: "Attention Is All You Need",
  authors: ["Ashish Vaswani"],
  publicationDoi: "10.5555/example",
  year: 2017,
  pageUrl: "https://arxiv.org/abs/1706.03762",
  pdfUrl: "https://arxiv.org/pdf/1706.03762",
};

test("message validation accepts only the five fixed message contracts", () => {
  assert.equal(validateMessage({ type: "ANALYZE_PAPER", paper }).ok, true);
  assert.equal(validateMessage({ type: "REFRESH_PAPER", paper }).ok, true);
  assert.equal(validateMessage({ type: "REFRESH_PAPER", paper, openReviewSession: true }).ok, true);
  assert.equal(validateMessage({ type: "REQUEST_GITHUB_ACCESS" }).ok, true);
  assert.equal(validateMessage({ type: "SEARCH_GITHUB", paper }).ok, true);
  assert.equal(validateMessage({
    type: "DOWNLOAD_PDF",
    pdfUrl: paper.pdfUrl,
    filename: "Attention_1706.03762.pdf",
    saveAs: true,
  }).ok, true);
});

test("OpenReview session use is accepted only for an explicit refresh", () => {
  assert.equal(validateMessage({ type: "ANALYZE_PAPER", paper, openReviewSession: true }).ok, false);
  assert.equal(validateMessage({ type: "REFRESH_PAPER", paper, openReviewSession: "yes" }).ok, false);
});

test("message validation rejects an arbitrary proxy message", () => {
  const result = validateMessage({ type: "FETCH", url: "https://evil.test" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported message/);
});

test("analysis validation rejects missing identity and oversized fields", () => {
  assert.equal(validateMessage({ type: "ANALYZE_PAPER", paper: { ...paper, title: "" } }).ok, false);
  assert.equal(validateMessage({ type: "ANALYZE_PAPER", paper: { ...paper, authors: [] } }).ok, false);
  assert.equal(validateMessage({
    type: "ANALYZE_PAPER",
    paper: { ...paper, authors: ["a".repeat(201)] },
  }).ok, false);
  assert.equal(validateMessage({
    type: "ANALYZE_PAPER",
    paper: { ...paper, arxivId: "../../etc/passwd" },
  }).ok, false);
  assert.equal(validateMessage({
    type: "ANALYZE_PAPER",
    paper: { ...paper, comment: "x".repeat(2_001) },
  }).ok, false);
  assert.equal(validateMessage({
    type: "ANALYZE_PAPER",
    paper: { ...paper, metadataAliases: [{ title: "Old", authors: [] }] },
  }).ok, false);
  assert.equal(validateMessage({
    type: "ANALYZE_PAPER",
    paper: { ...paper, metadataVersion: 0 },
  }).ok, false);
  const alias = { title: "Old", authors: paper.authors, version: 1 };
  assert.equal(validateMessage({
    type: "ANALYZE_PAPER",
    paper: { ...paper, metadataAliases: [alias, alias, alias] },
  }).ok, true);
  assert.equal(validateMessage({
    type: "ANALYZE_PAPER",
    paper: { ...paper, metadataAliases: [alias, alias, alias, alias] },
  }).ok, false);
});

test("PDF downloads accept only arXiv HTTPS PDF paths", () => {
  assert.equal(isAllowedPdfUrl("https://arxiv.org/pdf/1706.03762"), true);
  assert.equal(isAllowedPdfUrl("https://arxiv.org/pdf/hep-th/9901001v2"), true);
  assert.equal(isAllowedPdfUrl("http://arxiv.org/pdf/1706.03762"), false);
  assert.equal(isAllowedPdfUrl("https://example.com/pdf/1706.03762"), false);
  assert.equal(isAllowedPdfUrl("https://arxiv.org@evil.test/pdf/1706.03762"), false);
  assert.equal(isAllowedPdfUrl("https://arxiv.org/abs/1706.03762"), false);
});

test("download validation rejects empty or path-like filenames", () => {
  assert.equal(validateMessage({
    type: "DOWNLOAD_PDF",
    pdfUrl: paper.pdfUrl,
    filename: "",
    saveAs: false,
  }).ok, false);
  assert.equal(validateMessage({
    type: "DOWNLOAD_PDF",
    pdfUrl: paper.pdfUrl,
    filename: "../paper.pdf",
    saveAs: false,
  }).ok, false);
});

test("cache validates schema, paper fingerprints, and exact expiry", () => {
  const now = Date.parse("2026-08-24T00:00:00Z");
  const entry = buildCacheEntry(paper, { result: true }, now - CACHE_TTL_MS + 1);
  const boundary = buildCacheEntry(paper, {}, now - CACHE_TTL_MS);
  assert.equal(CACHE_SCHEMA_VERSION, 10);
  assert.equal(CACHE_TTL_MS, 86_400_000);
  assert.equal(CACHE_PROBABLE_TTL_MS, 3_600_000);
  assert.equal(CACHE_ERROR_TTL_MS, 300_000);
  assert.equal(GITHUB_INCOMPLETE_CACHE_TTL_MS, 300_000);
  assert.equal(isFreshCache(entry, paper, now), true);
  assert.equal(isFreshCache(boundary, paper, now), false);
  assert.equal(isFreshCache(entry, { ...paper, title: "Changed" }, now), false);
  assert.equal(isFreshCache(entry, { ...paper, comment: "Accepted at ICLR" }, now), false);
  assert.equal(isFreshCache(entry, { ...paper, metadataVersion: 2 }, now), false);
  assert.equal(isFreshCache(entry, {
    ...paper,
    metadataAliases: [{ title: "Old title", authors: paper.authors, version: 1 }],
  }, now), false);
  assert.equal(isFreshCache({ ...entry, schemaVersion: 2 }, paper, now), false);
});

test("cache keys canonicalize versions and separate analysis from GitHub", () => {
  assert.equal(cacheKey("1706.03762v5"), "analysis:v10:1706.03762");
  assert.equal(cacheKey("hep-th/9901001v2"), "analysis:v10:hep-th/9901001");
  assert.equal(githubCacheKey("1706.03762v5"), "github:v3:1706.03762");
});

test("expired cache cleanup removes stale and invalid entries only", () => {
  assert.deepEqual(expiredCacheKeys({
    "analysis:v9:old": { expiresAt: 999 },
    "analysis:v10:fresh": { expiresAt: 1_001 },
    "analysis:v10:invalid": {},
    "github:v3:old": { expiresAt: 1 },
  }, "analysis:", 1_000), ["analysis:v9:old", "analysis:v10:invalid"]);
});

test("service messages are accepted only from this extension on an arXiv abstract tab", () => {
  assert.equal(isTrustedSender({ id: "extension-id", url: "https://arxiv.org/abs/1706.03762" }, "extension-id"), true);
  assert.equal(isTrustedSender({ id: "other", url: "https://arxiv.org/abs/1706.03762" }, "extension-id"), false);
  assert.equal(isTrustedSender({ id: "extension-id", url: "https://evil.test/abs/1706.03762" }, "extension-id"), false);
});
