import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCacheEntry,
  CACHE_ERROR_TTL_MS,
  CACHE_SCHEMA_VERSION,
  CACHE_TTL_MS,
  cacheKey,
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

test("message validation accepts only the four fixed message contracts", () => {
  assert.equal(validateMessage({ type: "ANALYZE_PAPER", paper }).ok, true);
  assert.equal(validateMessage({ type: "REFRESH_PAPER", paper }).ok, true);
  assert.equal(validateMessage({ type: "SEARCH_GITHUB", paper }).ok, true);
  assert.equal(validateMessage({
    type: "DOWNLOAD_PDF",
    pdfUrl: paper.pdfUrl,
    filename: "Attention_1706.03762.pdf",
    saveAs: true,
  }).ok, true);
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
  assert.equal(CACHE_SCHEMA_VERSION, 3);
  assert.equal(CACHE_TTL_MS, 86_400_000);
  assert.equal(CACHE_ERROR_TTL_MS, 600_000);
  assert.equal(isFreshCache(entry, paper, now), true);
  assert.equal(isFreshCache(boundary, paper, now), false);
  assert.equal(isFreshCache(entry, { ...paper, title: "Changed" }, now), false);
  assert.equal(isFreshCache({ ...entry, schemaVersion: 2 }, paper, now), false);
});

test("cache keys canonicalize versions and separate analysis from GitHub", () => {
  assert.equal(cacheKey("1706.03762v5"), "analysis:v3:1706.03762");
  assert.equal(cacheKey("hep-th/9901001v2"), "analysis:v3:hep-th/9901001");
  assert.equal(githubCacheKey("1706.03762v5"), "github:v1:1706.03762");
});

test("service messages are accepted only from this extension on an arXiv abstract tab", () => {
  assert.equal(isTrustedSender({ id: "extension-id", url: "https://arxiv.org/abs/1706.03762" }, "extension-id"), true);
  assert.equal(isTrustedSender({ id: "other", url: "https://arxiv.org/abs/1706.03762" }, "extension-id"), false);
  assert.equal(isTrustedSender({ id: "extension-id", url: "https://evil.test/abs/1706.03762" }, "extension-id"), false);
});
