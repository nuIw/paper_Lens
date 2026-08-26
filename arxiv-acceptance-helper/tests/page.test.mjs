import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyProjectUrl,
  cleanArxivLabel,
  dedupeProjectLinks,
  formatVenueYear,
  panelViewModel,
  parseArxivId,
} from "../src/page.mjs";

test("arXiv IDs preserve legacy categories and drop version suffixes", () => {
  assert.equal(parseArxivId("/abs/hep-th/9901001v3"), "hep-th/9901001");
  assert.equal(parseArxivId("/abs/1706.03762v7"), "1706.03762");
  assert.equal(parseArxivId("/pdf/1706.03762.pdf"), "1706.03762");
  assert.equal(parseArxivId("/list/cs.AI/recent"), "");
});

test("arXiv labels are removed only from the beginning", () => {
  assert.equal(cleanArxivLabel("Title: A Title", "Title:"), "A Title");
  assert.equal(cleanArxivLabel("Abstract: Title: remains", "Abstract:"), "Title: remains");
});

test("known project hosts are accepted as direct evidence", () => {
  const github = classifyProjectUrl("https://github.com/org/repo#readme", {
    source: "pdf-annotation",
    text: "repository",
  });
  assert.deepEqual(github, {
    url: "https://github.com/org/repo",
    host: "github.com",
    label: "GitHub",
    source: "pdf-annotation",
    evidence: "PDF link annotation",
  });
  assert.equal(classifyProjectUrl("https://huggingface.co/org/model", { source: "pdf-text" }).label, "Hugging Face");
  assert.equal(classifyProjectUrl("https://org.github.io/project/", { source: "paper-html" }).label, "Project page");
  assert.equal(classifyProjectUrl("https://www.github.com/org/repo", { source: "paper-html" }).label, "GitHub");
});

test("keyword-labeled external links can be project pages", () => {
  const link = classifyProjectUrl("https://example.org/paper", {
    source: "paper-html",
    text: "Official project page",
  });
  assert.equal(link.label, "Project page");
  assert.equal(classifyProjectUrl("https://example.org/paper", { source: "paper-html", text: "DOI" }), null);
});

test("unsafe and bibliography hosts are rejected", () => {
  assert.equal(classifyProjectUrl("javascript:alert(1)", { source: "paper-html", text: "code" }), null);
  assert.equal(classifyProjectUrl("https://doi.org/10.1/x", { source: "paper-html", text: "code" }), null);
  assert.equal(classifyProjectUrl("https://dblp.org/rec/conf/x", { source: "paper-html", text: "project" }), null);
  assert.equal(classifyProjectUrl("https://arxiv.org/pdf/1", { source: "paper-html", text: "code" }), null);
});

test("project links deduplicate fragments and prefer paper HTML evidence", () => {
  const links = dedupeProjectLinks([
    { url: "https://github.com/org/repo#readme", source: "pdf-annotation", text: "code" },
    { url: "https://github.com/org/repo", source: "paper-html", text: "GitHub" },
    { url: "https://doi.org/10.1/x", source: "paper-html", text: "DOI" },
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://github.com/org/repo");
  assert.equal(links[0].source, "paper-html");
});

test("tracking parameters do not create duplicate project links", () => {
  const links = dedupeProjectLinks([
    { url: "https://github.com/org/repo?utm_source=paper", source: "pdf-text" },
    { url: "https://github.com/org/repo", source: "pdf-annotation" },
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].source, "pdf-annotation");
});

test("a trailing slash does not create a duplicate repository link", () => {
  const links = dedupeProjectLinks([
    { url: "https://github.com/org/repo/", source: "pdf-text" },
    { url: "https://github.com/org/repo", source: "paper-html" },
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].source, "paper-html");
});

test("panel view model keeps publication state separate from verification", () => {
  const view = panelViewModel({
    representative: null,
    records: [],
    verification: "unverified",
    sources: {
      dblp: { status: "empty", count: 0 },
      openreview: { status: "empty", count: 0, version: 2 },
    },
  });
  assert.deepEqual(
    { headline: view.headline, verification: view.verificationLabel },
    { headline: "Venue not found · Preprint", verification: "Unverified" },
  );
});

test("panel view model exposes accepted venue, explicit track, and presentation", () => {
  const record = {
    venueRaw: "NeurIPS 2025",
    year: 2025,
    decision: "accepted",
    track: "main",
    presentation: "poster",
    confidence: "verified",
  };
  const view = panelViewModel({
    representative: record,
    records: [record],
    verification: "verified",
    sources: { dblp: { status: "error", error: "offline", count: 0 } },
  });
  assert.equal(view.headline, "NeurIPS 2025 · Accepted · Main · Poster");
  assert.equal(view.verificationLabel, "Verified");
});

test("venue formatting does not repeat an existing year", () => {
  assert.equal(formatVenueYear("ICLR 2025 Conference", 2025), "ICLR 2025 Conference");
  assert.equal(formatVenueYear("ICLR", 2025), "ICLR 2025");
});

test("panel view model labels conflicts without discarding chronological records", () => {
  const view = panelViewModel({
    representative: { venueRaw: "ICLR", year: 2026, decision: "accepted", track: "unknown", presentation: "unknown" },
    records: [{ year: 2025 }, { year: 2026 }],
    verification: "conflicting",
    sources: {},
  });
  assert.equal(view.verificationLabel, "Conflicting");
  assert.deepEqual(view.records.map((record) => record.year), [2026, 2025]);
});

test("cached panel results expose a human-readable cache age", () => {
  const now = Date.parse("2026-08-24T02:00:00Z");
  const view = panelViewModel({
    representative: null,
    records: [],
    verification: "unverified",
    sources: {},
    fromCache: true,
    savedAt: now - 2 * 60 * 60 * 1000,
  }, now);
  assert.equal(view.cacheLabel, "cached 2h ago");
});
