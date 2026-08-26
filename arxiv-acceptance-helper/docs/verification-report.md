# Verification Report

**Date:** 2026-08-26
**Project:** arXiv Acceptance Helper
**Overall:** READY FOR MANUAL CHROME VALIDATION

The design-review changes pass the available automated gates and a live
DBLP-to-NeurIPS proceedings smoke test. This environment has no Chrome or
Chromium executable, so unpacked-extension behavior remains a manual gate.

## Automated gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Manifest/resources | PASS | `scripts/validate-extension.mjs`; MV3 permissions and every declared resource validated |
| Syntax | PASS | `scripts/lint.mjs`; every `.js`/`.mjs` file passed `node --check` |
| Tests | PASS | 101 tests across six files, 0 failures |
| Coverage | PASS | all loaded files: lines 86.95%, branches 87.49%, functions 89.73% |
| Static security search | PASS | no `innerHTML`, string evaluation, secret-like literal, or `console.log` in runtime code/manifest |
| Git diff integrity | PASS | `git diff --check` produced no error |
| PDF.js packaged files | PASS | manifest validation found core, worker, and license; vendored core reports version 4.10.38 |
| PDF.js re-vendor build | BLOCKED | `node_modules/pdfjs-dist` is absent, so `scripts/vendor-pdfjs.mjs` cannot recopy the files |
| Dependency audit | NOT RUN | neither `npm` nor installed dependencies are available in this environment |

Production-module coverage is 100% lines for `core.mjs`, 99.33% for
`sources.mjs`, 98.60% for `page.mjs`, 94.83% for `service-logic.mjs`, and
90.68% for `service-worker.mjs`. `content.mjs` is 25.49% because Node tests
exercise its pure extraction/PDF/message helpers, not the full Shadow DOM and
Chrome API lifecycle.

## Review-specific regression coverage

- DBLP exact identity does not verify Decision or Track by itself.
- A strong DBLP record can trigger only a recognized official proceedings URL.
- Official proceedings verify Track only when the official metadata or
  collection URL explicitly identifies Main, Findings, or Workshop.
- Family-name-first proceedings authors match arXiv authors.
- arXiv DataCite DOI and publication DOI remain separate.
- Identity, Decision, and Track render as separate verification axes.
- The default filename uses the title before the first colon, one underscore,
  and the canonical arXiv ID.
- OpenReview JSON/HTML challenges and 429 responses stop v2-to-v1 retry and
  expose a fixed-origin forum/search link for manual verification.
- Only the two strongest OpenReview candidates receive forum expansion.
- Analysis cache entries include schema, identity fingerprints, `savedAt`, and
  `expiresAt`; partial failures use 10 minutes instead of 24 hours.
- GitHub remains click-only/search-candidate evidence and reuses successful
  results for one hour in `chrome.storage.session`.

## Live source smoke test

The public DBLP query for `Attention Is All You Need` returned HTTP 200 and a
strong NIPS record whose publication URL points to NeurIPS Proceedings. The
official page returned HTTP 200, matched at 1.0 after handling its
`Last, First` author metadata, and produced the explicit official collection
track `Main`.

## Repository and over-engineering review

The file inventory contains five root contract files, three build/check
scripts, eight extension implementation files, six test files, four current or
historical design/report documents, and three vendored PDF.js files. The vendor
files are the only embedded third-party code.

Ponytail diff review removed two concrete complexity findings: duplicate
timeout handling in JSON/HTML fetch paths and unused public exports. The
whole-repository audit found no justified file merge, new dependency, framework,
factory, interface, or additional adapter layer. Existing historical plan files
remain documentation and were not rewritten as runtime architecture.

## Remaining manual Chrome gates

- Load the directory unpacked and confirm panel placement on modern and legacy
  arXiv IDs.
- Inspect DevTools Network before opening, after analysis, after refresh, and
  after repeated GitHub clicks.
- Exercise DBLP-only, OpenReview Decision, official proceedings, no-result,
  challenge/rate-limit, and partial-failure states.
- Confirm Identity/Decision/Track labels and source links visually.
- Scan a live PDF using the packaged PDF.js worker.
- Verify the default filename, all filename modes, Save As, and download dialog.
- Check keyboard focus and light/dark rendering.
