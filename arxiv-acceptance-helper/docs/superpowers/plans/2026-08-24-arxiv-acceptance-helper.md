# arXiv Acceptance Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend-free Chrome MV3 extension that adds a collapsible acceptance, code-link, and named-PDF-download panel below arXiv's Export BibTeX Citation control.

**Architecture:** A classic content bootstrap dynamically imports a locally packaged content module, which extracts the arXiv page, owns the Shadow DOM UI, and scans the PDF with PDF.js. An ES-module service worker owns fixed cross-origin API collectors, evidence resolution, Chrome storage, GitHub search, and downloads; browser-independent functions stay in small ES modules tested by Node.

**Tech Stack:** Chrome Manifest V3, modern JavaScript ES modules, native HTML/CSS, `chrome.storage`, `chrome.downloads`, Node 20 `node:test`, and one pinned `pdfjs-dist` dependency.

## Global Constraints

- The extension must run without a backend, user account, telemetry, or API token.
- DBLP/OpenReview collection must not use a conference allowlist.
- Raw metadata and source URLs must survive normalization.
- GitHub API search occurs only after an explicit user click and never creates an official-code claim.
- All remote values render through DOM text nodes; no `innerHTML`.
- Runtime dependencies are limited to the official `pdfjs-dist` package.
- The two PDFs in the parent `paper_project/` directory are read-only research evidence.
- The workspace is not a Git repository; commit steps are NOT APPLICABLE.

---

### Task 1: Project Contract, Core Normalization, and Filename Rules

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `manifest.json`
- Create: `src/core.mjs`
- Create: `tests/core.test.mjs`

**Interfaces:**
- Produces: `normalizeText(value)`, `normalizeAuthors(authors)`,
  `scorePaperMatch(paper, record)`, `normalizeDecision(raw)`,
  `normalizeTrack(raw)`, `normalizePresentation(raw)`,
  `resolveRecords(records)`, `buildFilename(paper, mode, custom)`, and
  `sanitizeFilename(value)`.
- `paper` has `{ arxivId, title, authors, doi, year }`.
- `record` retains source/raw fields and gains `{ matchScore, matchKind,
  decision, track, presentation, confidence }`.

- [ ] **Step 1: Write failing core behavior tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFilename,
  normalizeDecision,
  resolveRecords,
  scorePaperMatch,
} from "../src/core.mjs";

test("alias filename uses text before the first colon and portable characters", () => {
  assert.equal(
    buildFilename({ title: "Attention: A/B?", arxivId: "1706.03762" }, "alias"),
    "Attention__1706.03762.pdf",
  );
});

test("an accepted Main record outranks a newer rejected record", () => {
  const result = resolveRecords([
    { year: 2026, decisionRaw: "Reject", trackRaw: "Main" },
    { year: 2025, decisionRaw: "Accept (Poster)", trackRaw: "Main" },
  ]);
  assert.equal(result.representative.year, 2025);
  assert.equal(result.representative.decision, "accepted");
});

test("different-year decisions are history rather than a conflict", () => {
  assert.equal(resolveRecords([
    { venueRaw: "ICLR", year: 2025, decisionRaw: "Reject" },
    { venueRaw: "ICLR", year: 2026, decisionRaw: "Accept" },
  ]).verification, "probable");
});
```

- [ ] **Step 2: Run the core test and verify RED**

Run: `node --test tests/core.test.mjs`  
Expected: FAIL because `src/core.mjs` or its named exports do not exist.

- [ ] **Step 3: Implement the smallest pure core functions**

Implement literal generic mappings for accept/reject/withdraw/under-review,
explicit-only track parsing, token/author overlap matching, deterministic
representative ranking, same-venue-and-year conflict detection, and portable
filename cleanup. Do not create classes, registries, factories, or configuration
objects with one consumer.

- [ ] **Step 4: Run the core tests and verify GREEN**

Run: `node --test tests/core.test.mjs`  
Expected: all core tests PASS with no warnings.

- [ ] **Step 5: Add minimal MV3/package configuration**

`manifest.json` declares `storage` and `downloads`, exact host permissions for
arXiv/DBLP/OpenReview/GitHub API, a module service worker, the arXiv content
bootstrap, and only required web-accessible module/PDF.js resources.

- [ ] **Step 6: Record commit status**

Expected: `NOT APPLICABLE — project root is not a Git repository`.

### Task 2: DBLP and OpenReview Source Adapters

**Files:**
- Create: `src/sources.mjs`
- Create: `tests/sources.test.mjs`

**Interfaces:**
- Consumes: `normalizeAuthors()` and `scorePaperMatch()` from `src/core.mjs`.
- Produces: `buildDblpSearchUrl(title)`, `parseDblp(payload, paper)`,
  `buildOpenReviewSearchUrl(title, version)`, `parseOpenReviewSearch(payload,
  paper, version)`, `parseOpenReviewForum(payload, submission, version)`,
  `buildGitHubSearch(title)`, and `parseGitHub(payload)`.

- [ ] **Step 1: Write failing source-contract tests with official payload shapes**

```js
test("DBLP accepts both one-author objects and author arrays", () => {
  const records = parseDblp({ result: { hits: { hit: [
    { info: { title: "Paper", authors: { author: { text: "A. Kim" } }, venue: "ICLR", year: "2025" } },
    { info: { title: "Paper", authors: { author: [{ text: "A. Kim" }, { text: "B. Lee" }] }, venue: "NeurIPS", year: "2026" } },
  ] } } }, { title: "Paper", authors: ["A. Kim"] });
  assert.deepEqual(records.map((record) => record.authors.length), [1, 2]);
});

test("OpenReview v2 unwraps value fields and Decision replies", () => {
  const submission = { id: "forum", forum: "forum", content: {
    title: { value: "Paper" }, authors: { value: ["A. Kim"] }, venue: { value: "ICLR 2026" },
  } };
  const [record] = parseOpenReviewForum({ notes: [{ forum: "forum",
    invitations: ["ICLR.cc/2026/Conference/-/Decision"],
    content: { decision: { value: "Accept (Poster)" } },
  }] }, submission, 2);
  assert.equal(record.decisionRaw, "Accept (Poster)");
});
```

- [ ] **Step 2: Run the source test and verify RED**

Run: `node --test tests/sources.test.mjs`  
Expected: FAIL because the source adapter exports do not exist.

- [ ] **Step 3: Implement thin source functions**

Use `URL`/`URLSearchParams` and structural guards only. Preserve `raw` source
objects, but expose the stable normalized envelope needed by the resolver. v1
and v2 share one `contentValue()` helper instead of parallel adapter classes.

- [ ] **Step 4: Run source and core tests and verify GREEN**

Run: `node --test tests/core.test.mjs tests/sources.test.mjs`  
Expected: all tests PASS.

- [ ] **Step 5: Record commit status**

Expected: `NOT APPLICABLE — project root is not a Git repository`.

### Task 3: Service Worker Fetch, Cache, Search, and Download Boundary

**Files:**
- Create: `src/service-worker.mjs`
- Create: `src/service-logic.mjs`
- Create: `tests/service-logic.test.mjs`

**Interfaces:**
- Consumes: source builders/parsers and `resolveRecords()`.
- Produces: pure `validateMessage(message)`, `isFreshCache(entry, now)`,
  `cacheKey(arxivId)`, `isAllowedPdfUrl(url)`, and browser `handleMessage()`.
- Accepted message types: `ANALYZE_PAPER`, `REFRESH_PAPER`, `SEARCH_GITHUB`,
  and `DOWNLOAD_PDF` only.

- [ ] **Step 1: Write failing trust-boundary tests**

```js
test("message validation rejects an arbitrary proxy URL", () => {
  assert.equal(validateMessage({ type: "FETCH", url: "https://evil.test" }).ok, false);
});

test("PDF downloads accept only arXiv HTTPS PDF paths", () => {
  assert.equal(isAllowedPdfUrl("https://arxiv.org/pdf/1706.03762"), true);
  assert.equal(isAllowedPdfUrl("https://example.com/pdf/1706.03762"), false);
});

test("24-hour cache expires at the boundary", () => {
  const now = Date.parse("2026-08-24T00:00:00Z");
  assert.equal(isFreshCache({ savedAt: now - 86_399_999 }, now), true);
  assert.equal(isFreshCache({ savedAt: now - 86_400_000 }, now), false);
});
```

- [ ] **Step 2: Run the service-logic test and verify RED**

Run: `node --test tests/service-logic.test.mjs`  
Expected: FAIL because the trust-boundary functions do not exist.

- [ ] **Step 3: Implement pure validation/cache helpers**

Validate exact message shape, title/author length ceilings, canonical arXiv ID,
HTTPS hosts, and sanitized filename. Keep the 24-hour TTL as one exported
constant used by cache reads and tests.

- [ ] **Step 4: Run the service-logic test and verify GREEN**

Run: `node --test tests/service-logic.test.mjs`  
Expected: all service-logic tests PASS.

- [ ] **Step 5: Implement service-worker orchestration**

Use an async message handler with fixed dispatch. Fetch DBLP and OpenReview v2
in parallel with per-request `AbortController`; use v1 only after no usable v2
candidate. Cache only paper analysis. Search GitHub only in
`SEARCH_GITHUB`. Download only a validated arXiv URL with
`chrome.downloads.download({ filename, saveAs })`.

- [ ] **Step 6: Run all tests and syntax-check the worker**

Run: `node --test && node --check src/service-worker.mjs`  
Expected: all tests PASS and syntax check exits 0.

- [ ] **Step 7: Record commit status**

Expected: `NOT APPLICABLE — project root is not a Git repository`.

### Task 4: arXiv Extraction, Link Filtering, and PDF Scan

**Files:**
- Create: `src/page.mjs`
- Create: `tests/page.test.mjs`
- Create: `src/content-bootstrap.js`
- Create: `src/content.mjs`
- Create: `scripts/vendor-pdfjs.mjs`

**Interfaces:**
- Produces: pure `parseArxivId(pathname)`, `cleanArxivLabel(text, label)`,
  `classifyProjectUrl(url, context)`, and `dedupeProjectLinks(links)`.
- The content module calls `extractPaper(document, location)`, dynamically
  imports packaged `vendor/pdf.mjs`, and sends only fixed service messages.

- [ ] **Step 1: Write failing arXiv/link tests**

```js
test("arXiv IDs preserve legacy slashes and drop version suffixes", () => {
  assert.equal(parseArxivId("/abs/hep-th/9901001v3"), "hep-th/9901001");
});

test("project link filtering rejects DOI links and deduplicates fragments", () => {
  assert.deepEqual(dedupeProjectLinks([
    { url: "https://github.com/org/repo#readme", source: "pdf-annotation" },
    { url: "https://github.com/org/repo", source: "paper-html" },
    { url: "https://doi.org/10.1/x", source: "paper-html" },
  ]).map((link) => link.url), ["https://github.com/org/repo"]);
});
```

- [ ] **Step 2: Run the page test and verify RED**

Run: `node --test tests/page.test.mjs`  
Expected: FAIL because page helpers do not exist.

- [ ] **Step 3: Implement pure page helpers and verify GREEN**

Run: `node --test tests/page.test.mjs`  
Expected: all page tests PASS.

- [ ] **Step 4: Add the minimal content bootstrap and page extractor**

The classic bootstrap imports `content.mjs` through `chrome.runtime.getURL`.
The content module locates the citation area, injects one host, attaches Shadow
DOM, extracts required metadata, collects direct known-host and keyword-labeled
project links, and waits for the first panel open before starting analysis.

- [ ] **Step 5: Add on-demand PDF scan**

Fetch the actual arXiv PDF anchor, call PDF.js `getAnnotations()` on every page,
then `getTextContent()` for non-clickable URLs. Accept HTTP(S) project hosts,
deduplicate, update per-source status, and release the PDF document after the
scan. No PDF bytes enter Chrome storage.

- [ ] **Step 6: Vendor only PDF.js runtime files**

`scripts/vendor-pdfjs.mjs` copies `pdf.mjs`, `pdf.worker.mjs`, and the Apache
license from the pinned npm dependency into `vendor/`. Run `npm install`, then
`npm run vendor` and confirm those three artifacts exist.

- [ ] **Step 7: Run tests and syntax checks**

Run: `node --test && npm run lint`  
Expected: all tests PASS and every JavaScript file parses.

- [ ] **Step 8: Record commit status**

Expected: `NOT APPLICABLE — project root is not a Git repository`.

### Task 5: Accessible Inline Panel and Partial-State Rendering

**Files:**
- Create: `src/panel.css`
- Modify: `src/content.mjs`
- Create: `README.md`

**Interfaces:**
- Consumes: normalized analysis response, project link envelopes, GitHub
  candidates, filename functions, and Chrome sync settings.
- Produces: collapsed trigger below Export BibTeX Citation and one reusable
  Shadow DOM panel with source-specific state.

- [ ] **Step 1: Add a failing renderer-state test to `tests/page.test.mjs`**

Extract a pure `panelViewModel(paper, analysis, sourceStates)` function. Assert
literal view data for preprint/no-record, accepted/history, partial error, and
conflict cases so a missing branch produces a clear failure.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/page.test.mjs`  
Expected: FAIL because `panelViewModel()` does not exist.

- [ ] **Step 3: Implement the minimal view model and verify GREEN**

Run: `node --test tests/page.test.mjs`  
Expected: all page tests PASS.

- [ ] **Step 4: Render the approved panel with safe DOM calls**

Create elements with `document.createElement`, set remote text with
`textContent`, and attach click/change handlers once. Render representative
status, confidence, cache age, filename controls, direct/PDF links, GitHub
button/candidates, chronological evidence, refresh, and independent errors.

- [ ] **Step 5: Add compact responsive styling and accessibility**

Style only inside Shadow DOM. Support `prefers-color-scheme`, visible keyboard
focus, native buttons/input/select/details, state text plus icons, narrow-page
wrapping, and `aria-expanded`/`aria-live`.

- [ ] **Step 6: Document installation and deterministic manual checks**

README commands: `npm ci`, `npm run vendor`, `npm test`, `npm run verify`, then
load the project directory as an unpacked extension. Manual checklist covers
placement, lazy network start, cache/refresh, partial errors, GitHub button,
filename editing, Save As, dark mode, and evidence expansion.

- [ ] **Step 7: Run the complete automated suite**

Run: `npm run verify`  
Expected: manifest/build validation, syntax checks, and every test PASS.

- [ ] **Step 8: Record commit status**

Expected: `NOT APPLICABLE — project root is not a Git repository`.

### Task 6: Verification Loop, Correctness Review, and Ponytail Review

**Files:**
- Review: every file under the project root
- Create: `docs/verification-report.md`

**Interfaces:**
- Consumes: completed implementation and the approved design spec.
- Produces: reproducible PASS/FAIL/SKIPPED report and applied review fixes.

- [ ] **Step 1: Run build/package verification**

Run: `npm run build`  
Expected: required local PDF.js artifacts and manifest resources exist; exit 0.

- [ ] **Step 2: Run syntax/type/lint verification**

Run: `npm run lint`  
Expected: every `.js`/`.mjs` file parses. Type check is `NOT APPLICABLE` because
the approved stack is plain JavaScript without TypeScript.

- [ ] **Step 3: Run tests with coverage**

Run: `npm run test:coverage`  
Expected: zero failures and at least 80% line coverage for loaded pure modules.

- [ ] **Step 4: Run security/static searches**

Run: `rg -n 'innerHTML|eval\\(|new Function|sk-|api[_-]?key|console\\.log' src manifest.json`  
Expected: no unsafe renderer, executable-string, secret, or debug-log findings.

- [ ] **Step 5: Review dependency and package contents**

Run: `npm audit --omit=dev` and `npm pack --dry-run`  
Expected: no known production vulnerability and only intended extension,
documentation, test, script, and PDF.js runtime files in the package listing.

- [ ] **Step 6: Run a normal correctness review**

Trace arXiv extraction → message validation → source parsing → matching →
resolution → rendering/download. Fix every Critical or Important issue with
a failing regression test before code changes.

- [ ] **Step 7: Run Ponytail over-engineering review**

Report one line per removable complexity finding in the requested
`file:Lx: tag:` format, apply justified deletions, and rerun `npm run verify`.
If nothing can be cut, record `Lean already. Ship.`

- [ ] **Step 8: Record environmental checks honestly**

If no Chrome/Chromium executable is present, mark unpacked-extension runtime,
real API CORS, visual browser, and download-dialog checks `SKIPPED` with the
exact reason. Do not infer them from Node tests.

- [ ] **Step 9: Write the final verification report**

Include Build, Types, Lint, Tests, Coverage, Security, Dependency Audit, Diff or
File Inventory, Ponytail Review, manual checks, overall readiness, and every
remaining issue. Rerun the full verification command immediately before any
completion claim.
