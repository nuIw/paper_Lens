import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFilename,
  normalizeAuthors,
  normalizeDecision,
  normalizePresentation,
  normalizeText,
  normalizeTrack,
  resolveRecords,
  sanitizeFilename,
  scorePaperMatch,
} from "../src/core.mjs";

test("normalizes markup, punctuation, accents, and whitespace for matching", () => {
  assert.equal(normalizeText("  Méthode: <i>Fast</i> & Safe  "), "methode fast safe");
});

test("normalizes author strings and DBLP-style author objects", () => {
  assert.deepEqual(
    normalizeAuthors(["Alice Kim", { text: "Bob Lee" }, { value: " Carol Park " }, null]),
    ["Alice Kim", "Bob Lee", "Carol Park"],
  );
});

test("an exact DOI is a verified identity match", () => {
  assert.deepEqual(
    scorePaperMatch(
      { title: "Old title", authors: ["Alice Kim"], doi: "10.1000/XYZ" },
      { title: "New title", authors: ["A. Kim"], doi: "https://doi.org/10.1000/xyz" },
    ),
    { score: 1, kind: "identifier" },
  );
});

test("different DOI punctuation cannot collapse into an identifier match", () => {
  const match = scorePaperMatch(
    { title: "One", authors: ["Alice Kim"], doi: "10.1000/foo-bar" },
    { title: "Different", authors: ["Other Person"], doi: "10.1000/foo.bar" },
  );
  assert.notEqual(match.kind, "identifier");
  assert.notEqual(match.score, 1);
});

test("matching title and author creates a strong metadata match", () => {
  const match = scorePaperMatch(
    { title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017 },
    { title: "Attention is all you need.", authors: ["A. Vaswani", "Noam Shazeer"], year: "2017" },
  );
  assert.equal(match.kind, "title-authors");
  assert.ok(match.score >= 0.9);
});

test("a title-only weak candidate is not auto-merged", () => {
  const match = scorePaperMatch(
    { title: "A Common Paper Title", authors: ["Alice Kim"] },
    { title: "A Common Paper Title", authors: ["Different Person"] },
  );
  assert.ok(match.score < 0.82);
});

test("normalizes generic decisions without a venue allowlist", () => {
  assert.equal(normalizeDecision("Accept (Poster)"), "accepted");
  assert.equal(normalizeDecision("Desk Rejected"), "rejected");
  assert.equal(normalizeDecision("Withdrawn by authors"), "withdrawn");
  assert.equal(normalizeDecision("Under Review"), "under_review");
  assert.equal(normalizeDecision("Published"), "accepted");
  assert.equal(normalizeDecision("Not Accepted"), "rejected");
  assert.equal(normalizeDecision("Invite to demo track"), "unknown");
});

test("normalizes only explicit tracks and presentation values", () => {
  assert.equal(normalizeTrack("Main Conference"), "main");
  assert.equal(normalizeTrack("Findings of ACL"), "findings");
  assert.equal(normalizeTrack("Workshop on Tiny Models"), "workshop");
  assert.equal(normalizeTrack("Demo Track"), "other");
  assert.equal(normalizeTrack("Conference"), "other");
  assert.equal(normalizeTrack(""), "unknown");
  assert.equal(normalizePresentation("Accept (Spotlight)"), "spotlight");
  assert.equal(normalizePresentation("Oral presentation"), "oral");
  assert.equal(normalizePresentation("Poster"), "poster");
});

test("an accepted Main record outranks a newer rejected record", () => {
  const result = resolveRecords([
    { source: "openreview", venueRaw: "NeurIPS", year: 2026, decisionRaw: "Reject", trackRaw: "Main" },
    { source: "openreview", venueRaw: "NeurIPS", year: 2025, decisionRaw: "Accept (Poster)", trackRaw: "Main" },
  ]);
  assert.equal(result.representative.year, 2025);
  assert.equal(result.representative.decision, "accepted");
  assert.equal(result.representative.presentation, "poster");
});

test("Main acceptance outranks Findings and Workshop while retaining history", () => {
  const result = resolveRecords([
    { venueRaw: "ACL", year: 2025, decisionRaw: "Accept", trackRaw: "Workshop" },
    { venueRaw: "ACL", year: 2025, decisionRaw: "Accept", trackRaw: "Findings" },
    { venueRaw: "ACL", year: 2025, decisionRaw: "Accept", trackRaw: "Main" },
  ]);
  assert.equal(result.representative.track, "main");
  assert.equal(result.records.length, 3);
});

test("different-year decisions are history rather than a conflict", () => {
  const result = resolveRecords([
    { venueRaw: "ICLR", year: 2025, decisionRaw: "Reject" },
    { venueRaw: "ICLR", year: 2026, decisionRaw: "Accept" },
  ]);
  assert.equal(result.verification, "probable");
});

test("same-venue same-year terminal disagreement is conflicting", () => {
  const result = resolveRecords([
    { venueRaw: "ICLR", year: 2026, decisionRaw: "Reject" },
    { venueRaw: "ICLR", year: 2026, decisionRaw: "Accept" },
  ]);
  assert.equal(result.verification, "conflicting");
});

test("generic conference suffixes do not hide a same-venue conflict", () => {
  const result = resolveRecords([
    { venueRaw: "ICLR", year: 2026, decisionRaw: "Published" },
    { venueRaw: "ICLR 2026 Conference", year: 2026, decisionRaw: "Reject" },
  ]);
  assert.equal(result.verification, "conflicting");
});

test("OpenReview state words and submitted-to prefixes do not become venue identity", () => {
  for (const venueRaw of [
    "ICLR 2026 Conference Rejected Submission",
    "Submitted to ICLR 2026 Conference",
    "ICLR.cc/2026/Conference/Rejected_Submission",
  ]) {
    const result = resolveRecords([
      { venueRaw: "ICLR", year: 2026, decisionRaw: "Published" },
      { venueRaw, year: 2026, decisionRaw: "Rejected" },
    ]);
    assert.equal(result.verification, "conflicting", venueRaw);
  }
});

test("low-identity candidates do not become the representative result", () => {
  const result = resolveRecords([
    { venueRaw: "Unknown", year: 2026, decisionRaw: "Accept", matchScore: 0.4 },
  ]);
  assert.equal(result.representative, null);
  assert.equal(result.records[0].confidence, "candidate");
});

test("title-only metadata below the auto-merge threshold remains a candidate", () => {
  const result = resolveRecords([
    { venueRaw: "Unknown", year: 2026, decisionRaw: "Accept", matchScore: 0.75 },
  ]);
  assert.equal(result.representative, null);
  assert.equal(result.records[0].confidence, "candidate");
});

test("strongly matched but uninterpretable metadata is labeled metadata-only", () => {
  const result = resolveRecords([
    { venueRaw: "ABC", year: 2026, decisionRaw: "Invite to demo track", matchScore: 0.95 },
  ]);
  assert.equal(result.records[0].confidence, "metadata_only");
});

test("alias filename uses text before the first colon and appends arXiv ID", () => {
  assert.equal(
    buildFilename({ title: "Attention: A/B?", arxivId: "1706.03762" }, "alias"),
    "Attention__1706.03762.pdf",
  );
});

test("filename modes remain editable and portable", () => {
  const paper = { title: "A/B: C?", arxivId: "hep-th/9901001" };
  assert.equal(buildFilename(paper, "full"), "A_B_ C___hep-th_9901001.pdf");
  assert.equal(buildFilename(paper, "id"), "hep-th_9901001.pdf");
  assert.equal(buildFilename(paper, "custom", " my result "), "my result.pdf");
});

test("sanitizer blocks paths, dot names, Windows device names, and overlong names", () => {
  assert.equal(sanitizeFilename("../CON.pdf"), "_CON.pdf");
  assert.equal(sanitizeFilename("CON.notes.pdf"), "_CON.notes.pdf");
  assert.equal(sanitizeFilename("..."), "paper.pdf");
  assert.ok(sanitizeFilename(`${"a".repeat(300)}.pdf`).length <= 180);
  assert.ok(new TextEncoder().encode(sanitizeFilename("논문".repeat(100))).length <= 180);
});
