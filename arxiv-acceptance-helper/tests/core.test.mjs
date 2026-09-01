import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFilename,
  normalizeAuthors,
  normalizeDecision,
  normalizePresentation,
  normalizeText,
  normalizeTrack,
  parseArxivCommentAcceptance,
  parseArxivCommentVenueHint,
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

test("matches family-name-first proceedings authors", () => {
  const match = scorePaperMatch(
    { title: "Paper", authors: ["Ashish Vaswani"], year: 2025 },
    { title: "Paper", authors: ["Vaswani, Ashish"], year: 2025 },
  );
  assert.equal(match.kind, "title-authors");
  assert.equal(match.score, 1);
});

test("an exact DOI is a verified identity match", () => {
  const match = scorePaperMatch(
    { title: "Old title", authors: ["Alice Kim"], doi: "10.1000/XYZ" },
    { title: "New title", authors: ["A. Kim"], doi: "https://doi.org/10.1000/xyz" },
  );
  assert.equal(match.score, 1);
  assert.equal(match.kind, "identifier");
  assert.equal(match.evidence.identifier, "publication DOI");
});

test("different DOI punctuation cannot collapse into an identifier match", () => {
  const match = scorePaperMatch(
    { title: "One", authors: ["Alice Kim"], doi: "10.1000/foo-bar" },
    { title: "Different", authors: ["Other Person"], doi: "10.1000/foo.bar" },
  );
  assert.notEqual(match.kind, "identifier");
  assert.notEqual(match.score, 1);
});

test("arXiv DataCite DOI is not used as a publication DOI match", () => {
  const match = scorePaperMatch(
    { title: "One", authors: ["Alice Kim"], arxivDoi: "10.48550/arXiv.2501.00001" },
    { title: "Different", authors: ["Other Person"], publicationDoi: "10.48550/arXiv.2501.00001" },
  );
  assert.notEqual(match.kind, "identifier");
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

test("a shared surname with conflicting given names is not author evidence", () => {
  const match = scorePaperMatch(
    { title: "A Common Paper Title", authors: ["Alice Kim"], year: 2025 },
    { title: "A Common Paper Title", authors: ["Andrew Kim"], year: 2025 },
  );
  assert.equal(match.evidence.authors.matched, 0);
  assert.ok(match.score < 0.82);
});

test("initial-compatible names are strong but explicitly labeled author evidence", () => {
  const match = scorePaperMatch(
    { title: "Paper", authors: ["Ashish Vaswani"], year: 2025 },
    { title: "Paper", authors: ["A. Vaswani"], year: 2025 },
  );
  assert.equal(match.evidence.authors.initials, 1);
  assert.equal(match.evidence.authors.exact, 0);
  assert.ok(match.score >= 0.9);
});

test("a changed subtitle and later publication year can remain a strong metadata match", () => {
  const match = scorePaperMatch(
    { title: "Learning Robust Representations", authors: ["Alice Kim"], year: 2021 },
    { title: "Learning Robust Representations for Vision", authors: ["Alice Kim"], year: 2024 },
  );
  assert.equal(match.evidence.year.distance, 3);
  assert.ok(match.score >= 0.82);
});

test("conflicting arXiv identifiers cannot be auto-matched by similar metadata", () => {
  const match = scorePaperMatch(
    { arxivId: "2501.00001", title: "Paper", authors: ["Alice Kim"], year: 2025 },
    { arxivId: "2501.00002", title: "Paper", authors: ["Alice Kim"], year: 2025 },
  );
  assert.equal(match.evidence.identifierConflict, "arxiv");
  assert.ok(match.score < 0.82);
});

test("paper matching can use the viewed arXiv version as a metadata alias", () => {
  const match = scorePaperMatch({
    title: "A Completely Renamed Paper",
    authors: ["Alice Kim", "Bob Lee"],
    year: 2025,
    metadataAliases: [{
      title: "Original Submission Title",
      authors: ["Alice Kim"],
      year: 2024,
      version: 1,
    }],
  }, {
    title: "Original Submission Title",
    authors: ["Alice Kim"],
    year: 2024,
  });
  assert.ok(match.score >= 0.82);
  assert.equal(match.evidence.metadataVersion, 1);
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

test("arXiv comments create only explicit author-reported acceptance hints", () => {
  assert.deepEqual(parseArxivCommentAcceptance("Accepted at ICLR 2026 as a poster. 12 pages"), {
    decision: "accepted",
    venueRaw: "ICLR 2026",
    year: 2026,
    track: "unknown",
    presentation: "poster",
    commentRaw: "Accepted at ICLR 2026 as a poster. 12 pages",
  });
  assert.equal(parseArxivCommentAcceptance("Submitted to ICLR 2026"), null);
  assert.equal(parseArxivCommentAcceptance("ICLR 2026 submission"), null);
  assert.equal(parseArxivCommentAcceptance("ICLR 2026 under review"), null);
  assert.equal(parseArxivCommentAcceptance("Extended NeurIPS submission"), null);
  assert.equal(
    parseArxivCommentAcceptance("Accepted at ICLR 2026; originally submitted in 2025").venueRaw,
    "ICLR 2026",
  );
  assert.deepEqual(
    parseArxivCommentAcceptance("The 14th International Conference on Learning Representations (ICLR 2026)"),
    {
      decision: "accepted",
      venueRaw: "ICLR 2026",
      year: 2026,
      track: "unknown",
      presentation: "unknown",
      commentRaw: "The 14th International Conference on Learning Representations (ICLR 2026)",
    },
  );
  assert.equal(parseArxivCommentAcceptance("This paper was not accepted at ICLR"), null);
});

test("arXiv comment venue hints remain usable without claiming submission acceptance", () => {
  assert.deepEqual(parseArxivCommentVenueHint("Submitted to ICLR 2026"), {
    acronym: "ICLR",
    venueRaw: "ICLR 2026",
    year: 2026,
  });
  assert.deepEqual(
    parseArxivCommentVenueHint("The 11th International Conference on Learning Representations (ICLR 2023)"),
    { acronym: "ICLR", venueRaw: "ICLR 2023", year: 2023 },
  );
  assert.deepEqual(parseArxivCommentVenueHint("ICLR2023"), {
    acronym: "ICLR",
    venueRaw: "ICLR 2023",
    year: 2023,
  });
  assert.equal(parseArxivCommentVenueHint("12 pages, 4 figures"), null);
  assert.equal(
    parseArxivCommentAcceptance("Code for the International Conference on Learning Representations (ICLR 2023)"),
    null,
  );
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

test("DBLP verifies identity without claiming verified decision or track", () => {
  const result = resolveRecords([{
    source: "dblp",
    venueRaw: "ACL",
    decisionRaw: "Published",
    trackRaw: "",
    matchScore: 1,
    matchKind: "identifier",
  }]);
  assert.deepEqual(result.verificationAxes, {
    identity: "verified",
    decision: "metadata_only",
    track: "unverified",
  });
  assert.equal(result.verification, "probable");
});

test("Crossref publication metadata cannot verify decision or track", () => {
  const result = resolveRecords([{
    source: "crossref",
    venueRaw: "ACL",
    decisionRaw: "Published",
    trackRaw: "",
    matchScore: 1,
    matchKind: "identifier",
  }]);
  assert.deepEqual(result.verificationAxes, {
    identity: "verified",
    decision: "metadata_only",
    track: "unverified",
  });
});

test("official proceedings can verify decision and an explicit track", () => {
  const result = resolveRecords([{
    source: "proceedings",
    venueRaw: "ACL 2025 Main Conference",
    decisionRaw: "Published",
    trackRaw: "Main",
    trackEvidence: "official",
    matchScore: 0.95,
    matchKind: "title-authors",
  }]);
  assert.deepEqual(result.verificationAxes, {
    identity: "probable",
    decision: "verified",
    track: "verified",
  });
  assert.equal(result.verification, "verified");
});

test("default filename uses text before the first colon and one separator before arXiv ID", () => {
  assert.equal(
    buildFilename({ title: "Attention: A/B?", arxivId: "1706.03762" }, "alias"),
    "Attention_1706.03762.pdf",
  );
});

test("filename modes remain editable and portable", () => {
  const paper = { title: "A/B: C?", arxivId: "hep-th/9901001" };
  assert.equal(buildFilename(paper, "short"), "A_B.pdf");
  assert.equal(buildFilename(paper, "full"), "A_B_ C_hep-th_9901001.pdf");
  assert.equal(buildFilename(paper, "custom", " my result "), "my result.pdf");
});

test("generated filenames keep one separator and retain the arXiv ID after truncation", () => {
  assert.equal(
    buildFilename({ title: "Why?", arxivId: "2501.00001" }),
    "Why_2501.00001.pdf",
  );
  const filename = buildFilename({ title: "논문".repeat(100), arxivId: "2501.00001" });
  assert.ok(new TextEncoder().encode(filename).length <= 180);
  assert.match(filename, /_2501\.00001\.pdf$/);
});

test("sanitizer blocks paths, dot names, Windows device names, and overlong names", () => {
  assert.equal(sanitizeFilename("../CON.pdf"), "_CON.pdf");
  assert.equal(sanitizeFilename("CON.notes.pdf"), "_CON.notes.pdf");
  assert.equal(sanitizeFilename("..."), "paper.pdf");
  assert.ok(sanitizeFilename(`${"a".repeat(300)}.pdf`).length <= 180);
  assert.ok(new TextEncoder().encode(sanitizeFilename("논문".repeat(100))).length <= 180);
});
