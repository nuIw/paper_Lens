# Live Metadata Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove a verified DBLP false-negative and make OpenReview challenge verification visible and actionable without adding a backend or dependency.

**Architecture:** Keep the existing thin URL builders and service-worker orchestration. Add the first arXiv author to DBLP's title query, parse non-2xx OpenReview JSON errors at the fetch boundary, construct a fixed-origin `https://openreview.net/challenge` URL locally, and render that URL beside the affected OpenReview status.

**Tech Stack:** Chrome Manifest V3, native JavaScript ES modules and DOM APIs, Node 20 `node:test`; no new dependency.

## Global Constraints

- DBLP and OpenReview remain generic collectors without a conference allowlist.
- GitHub remains strictly click-triggered.
- Ignore API-supplied challenge URLs; locally construct the only challenge-verification link on `https://openreview.net/challenge`.
- A challenge is reported as incomplete verification, never as an automatic acceptance result.
- Existing cached analyses use a new schema key so a prior false-negative is not reused.
- The project is not a Git repository; commit steps are NOT APPLICABLE.

---

### Task 1: Author-aware DBLP query and cache schema

**Files:**
- Modify: `tests/sources.test.mjs`
- Modify: `tests/service-worker.test.mjs`
- Modify: `tests/service-logic.test.mjs`
- Modify: `src/sources.mjs`
- Modify: `src/service-worker.mjs`
- Modify: `src/service-logic.mjs`

**Interfaces:**
- Consumes: `paper.title` and `paper.authors[0]`.
- Produces: `buildDblpSearchUrl(title, firstAuthor = "")` and cache keys beginning with `analysis:v2:`.

- [x] **Step 1: Add failing query and service-contract tests**

```js
assert.equal(
  new URL(buildDblpSearchUrl("Attention Is All You Need", "Ashish Vaswani"))
    .searchParams.get("q"),
  "Attention Is All You Need Ashish Vaswani",
);
assert.equal(new URL(calls.find((url) => url.startsWith("https://dblp.org/")))
  .searchParams.get("q"), `${paper.title} ${paper.authors[0]}`);
assert.equal(cacheKey("1706.03762"), "analysis:v2:1706.03762");
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/sources.test.mjs tests/service-logic.test.mjs tests/service-worker.test.mjs`  
Expected: FAIL because the author is absent and the cache key is still `v1`.

- [x] **Step 3: Implement the minimum query and cache changes**

Join the trimmed title and optional first author with one space, pass the first
author from `collectDblp`, and change only the cache schema literal from `v1`
to `v2`.

- [x] **Step 4: Re-run the focused tests and verify GREEN**

Run: `node --test tests/sources.test.mjs tests/service-logic.test.mjs tests/service-worker.test.mjs`  
Expected: all focused tests PASS.

### Task 2: OpenReview challenge error and manual verification link

**Files:**
- Modify: `tests/service-worker.test.mjs`
- Modify: `tests/content.test.mjs`
- Modify: `src/service-worker.mjs`
- Modify: `src/content.mjs`

**Interfaces:**
- Consumes: non-2xx JSON shaped like `{ name: "ChallengeRequiredError", message }`.
- Produces: optional `sources.openreview.manualUrl` plus existing `error` or `warning` text.

- [x] **Step 1: Add failing service and UI-contract tests**

```js
assert.match(result.data.sources.openreview.warning, /Challenge verification required/);
assert.equal(
  result.data.sources.openreview.manualUrl,
  "https://openreview.net/challenge?redirect=%2Fforum%3Fid%3Dforum",
);
assert.equal(new URL(resultWithEvilUrl.data.sources.openreview.manualUrl).origin,
  "https://openreview.net");
```

The content-source contract must also assert that a `state.manualUrl` results
in a link labelled `Verify manually on OpenReview`.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/service-worker.test.mjs tests/content.test.mjs`  
Expected: FAIL because non-2xx JSON and its challenge state are discarded.

- [x] **Step 3: Implement the smallest error propagation**

Parse one JSON body before checking `response.ok`. For an error response, use
its string `message`, recognize a 403 `ChallengeRequiredError`, and construct a
fixed-origin manual URL from the known forum ID or paper-title search. Ignore
the API-supplied URL, retain the local URL on forum warnings or the combined
v2/v1 error, and copy it into the OpenReview source state.

- [x] **Step 4: Render the manual link without HTML injection**

Append a text separator and `safeLink(state.manualUrl,
"Verify manually on OpenReview ↗")` to the existing status row. Do not add
a component abstraction or dependency.

- [x] **Step 5: Re-run the focused tests and verify GREEN**

Run: `node --test tests/service-worker.test.mjs tests/content.test.mjs`  
Expected: all focused tests PASS.

### Task 3: Documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/verification-report.md`

**Interfaces:**
- Produces: an accurate limitation statement and current reproducible command evidence.

- [x] **Step 1: Document challenge behavior and author-aware DBLP search**

State that some OpenReview legacy/forum requests can require interactive
challenge completion and that the panel links to that step; do not claim full
automatic v1 verification.

- [x] **Step 2: Run deterministic verification**

Run: `npm test && npm run lint && npm run build && npm run test:coverage && npm audit --omit=dev`  
Expected: all commands exit 0; the test count and coverage are captured from
the actual output.

- [x] **Step 3: Run boundary scans and review the diff-equivalent file set**

Run syntax checks for all JavaScript, scan for `innerHTML`, secrets, and remote
executable imports, inspect the package contents, then run Ponytail's one-line
complexity review. Record Chrome UI execution as `SKIPPED` if Chrome/Chromium
remains unavailable.

- [x] **Step 4: Record commit status**

Expected: `NOT APPLICABLE — project root is not a Git repository`.
