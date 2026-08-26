import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDblpSearchUrl,
  buildGitHubSearch,
  buildOpenReviewForumUrl,
  buildOpenReviewSearchUrl,
  parseDblp,
  parseGitHub,
  parseOpenReviewForum,
  parseOpenReviewSearch,
} from "../src/sources.mjs";

const paper = { title: "Paper", authors: ["Alice Kim"], year: 2025 };

test("DBLP search URL uses the official publication endpoint", () => {
  const url = new URL(buildDblpSearchUrl("A paper: robust & small"));
  assert.equal(url.origin + url.pathname, "https://dblp.org/search/publ/api");
  assert.equal(url.searchParams.get("q"), "A paper: robust & small");
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.get("h"), "10");
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

test("malformed DBLP payload is a source error rather than an empty result", () => {
  assert.throws(() => parseDblp({ nope: true }, paper), /Malformed DBLP response/);
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

test("GitHub search is title-based and parser returns display-only candidates", () => {
  const query = buildGitHubSearch("Attention Is All You Need");
  assert.equal(new URL(query.apiUrl).origin, "https://api.github.com");
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
    classification: "search_candidate",
  });
});

test("GitHub query stays within the public search query length limit", () => {
  const search = buildGitHubSearch("x".repeat(500));
  assert.ok(new URL(search.apiUrl).searchParams.get("q").length <= 256);
});

test("malformed GitHub payload is an error rather than an empty result", () => {
  assert.throws(() => parseGitHub({ total_count: 1 }), /Malformed GitHub response/);
});
