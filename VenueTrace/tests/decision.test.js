const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console });

for (const file of [
  "src/sources/openreview.js",
  "src/decision/confidence.js",
  "src/decision/classify.js",
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {
    filename: file,
  });
}

function makeResult(overrides = {}) {
  return {
    dblpHitCount: 0,
    openReviewHitCount: 0,
    crossrefHitCount: 0,
    proceedings: [],
    ...overrides,
  };
}

test("OpenReview Conference venue is verified as an official publication", () => {
  const decision = context.integrateEvidence(
    makeResult({
      openReviewHitCount: 1,
      openReviewMatch: {
        forum: "paper-id",
        domain: "ICLR.cc/2025/Conference",
        content: { venue: { value: "ICLR 2025 Conference" } },
      },
    }),
  );

  assert.equal(decision.status, "confirmed");
  assert.equal(decision.venue, "ICLR");
  assert.equal(decision.year, 2025);
  assert.equal(decision.confidenceScore, 95);
});

test("OpenReview rejected and submission records are not publication evidence", () => {
  const decision = context.integrateEvidence(
    makeResult({
      openReviewHitCount: 1,
      openReviewMatch: {
        forum: "paper-id",
        domain: "ICLR.cc/2025/Conference",
        content: { venue: { value: "ICLR 2025 Rejected Submission" } },
      },
    }),
  );

  assert.equal(decision.status, "not_found");
  assert.equal(decision.confidenceScore, 0);
  assert.equal(decision.evidence[0].kind, "submission");
});

test("one bibliographic publication record is surfaced with a score", () => {
  const decision = context.integrateEvidence(
    makeResult({
      dblpHitCount: 1,
      match: {
        info: {
          venue: "ICML",
          year: "2024",
          key: "conf/icml/example",
        },
      },
    }),
  );

  assert.equal(decision.status, "candidate");
  assert.equal(decision.statusLabel, "출판 후보");
  assert.equal(decision.confidenceScore, 65);
});

test("an official conference version wins over a later journal version", () => {
  const decision = context.integrateEvidence(
    makeResult({
      dblpHitCount: 1,
      crossrefHitCount: 1,
      openAlexHitCount: 1,
      match: {
        info: {
          venue: "IEEE Trans. Pattern Anal. Mach. Intell.",
          year: "2021",
          key: "journals/pami/example",
        },
      },
      crossrefMatch: {
        type: "proceedings-article",
        "container-title": [
          "2019 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)",
        ],
        published: { "date-parts": [[2019]] },
      },
      openAlexMatch: {
        publication_year: 2021,
        primary_location: {
          source: {
            display_name: "IEEE Transactions on Pattern Analysis and Machine Intelligence",
            type: "journal",
          },
        },
      },
      proceedings: [
        {
          source: "CVF",
          venue: "CVPR",
          year: 2019,
          url: "https://openaccess.thecvf.com/example",
        },
      ],
    }),
  );

  assert.equal(decision.status, "confirmed");
  assert.equal(decision.venue, "CVPR");
  assert.equal(decision.year, 2019);
  assert.equal(decision.publicationType, "conference");
  assert.deepEqual(
    Array.from(decision.verificationEvidence, (item) => item.source),
    ["Crossref", "CVF"],
  );
});
