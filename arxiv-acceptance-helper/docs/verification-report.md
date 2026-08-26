# Verification Report

**Date:** 2026-08-24  
**Project:** arXiv Acceptance Helper  
**Overall:** READY FOR MANUAL CHROME VALIDATION

The implementation has no known Critical or Important code defect. It is not
called fully production-validated because this environment has no Chrome or
Chromium executable, so the actual unpacked-extension, network/CORS, visual,
PDF-worker, and download-dialog flows remain unexecuted.

## Automated gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Build and manifest | PASS | `npm run build`, exit 0; local PDF.js copied and every declared resource found |
| Types | NOT APPLICABLE | Approved implementation is plain JavaScript, with no TypeScript project |
| Syntax/lint | PASS | `npm run lint`, exit 0 for all `.js` and `.mjs` files |
| Tests | PASS | 86/86 passed, 0 failed |
| Coverage | PASS | all loaded files: lines 84.88%, branches 88.08%, functions 90.07% |
| Static security search | PASS | no `innerHTML`, string evaluation, secret-like token, API-key literal, or `console.log` match in `src/` or `manifest.json` |
| Dependency audit | PASS | `npm audit --omit=dev`: 0 vulnerabilities |
| Package listing | PASS | `npm pack --dry-run`: intended extension, docs, scripts, tests, and vendored runtime files only |
| PDF.js provenance | PASS | all three vendored hashes match installed `pdfjs-dist@4.10.38` files |
| Git diff | NOT APPLICABLE | project directory is not a Git repository |

Production-module line coverage was 100% for `core.mjs` and `sources.mjs`,
98.51% for `page.mjs`, 92.68% for `service-logic.mjs`, and 91.09% for
`service-worker.mjs`. `content.mjs` was 25.66% because Node tests exercise its
pure extraction/PDF/message helpers but cannot execute the full Shadow DOM and
Chrome API lifecycle. This limitation is covered by the manual-check status
below rather than being represented as browser coverage.

## Correctness review

The review traced arXiv extraction through message validation, DBLP/OpenReview
parsing, identity matching, record resolution, rendering, GitHub opt-in search,
cache behavior, and download dispatch. Critical: none. Important: none.

Regression fixes applied during review include:

- adding the first arXiv author to DBLP's title query so exact publications are
  not pushed out of the ten-result window by title lookalikes;
- moving analysis caches to schema `v2` so a prior title-only false-negative is
  not reused;
- parsing non-2xx OpenReview JSON errors, preserving
  `ChallengeRequiredError` as incomplete verification, and rendering a local,
  fixed-origin OpenReview challenge link while ignoring API-supplied links;
- rejecting incomplete title-only metadata at extraction and service boundaries;
- treating DBLP CoRR records as preprints;
- handling OpenReview v1/v2, Decision replies, venue-only terminal states,
  `Accept(ed)_Submission`, `Reject(ed)_Submission`, and explicit Main,
  Findings, and Workshop tracks;
- retrieving forum replies for every strong OpenReview search candidate;
- retaining weak v2 candidates and surfacing malformed/forum failures;
- keeping GitHub calls behind the explicit button and rejecting malformed
  GitHub payloads;
- canonicalizing same-venue conflicts without mistaking submission-state words
  for venue identity;
- keeping the PDF timeout active through response-body consumption and avoiding
  false URL concatenation across PDF text items;
- preserving keyboard focus across async refresh/search renders;
- avoiding repeated venue years and limiting portable filenames by UTF-8 bytes;
- validating sender, fixed message types, arXiv PDF URL, and filename at the
  service-worker boundary.

## Ponytail review

Applied simplifications removed an unused source-message view model, unused
pass-through fields, a duplicate display-label map, and a one-call settings
wrapper. The live-metadata hardening review found no new deletion candidate:
it uses native `URL`, `URLSearchParams`, ordinary `Error` properties, and one
existing status row. Final outcome: `Lean already. Ship.` No framework,
bundler, backend, conference allowlist, speculative registry, or runtime
dependency beyond the pinned PDF.js package was added.

The invoked ECC `repo-scan` entry is only a bootstrap pointer and does not
perform a repository audit. It was not installed because its instructions
require a literal interactive `install` request. A local full-file inventory,
syntax scan, dependency audit, static security scan, package listing, and
correctness review were performed instead.

## Environmental checks

| Check | Result | Reason |
| --- | --- | --- |
| Load unpacked in Chrome | SKIPPED | no Chrome/Chromium executable is installed |
| Direct DBLP author-aware query | PASS | live HTTP 200; 2 hits; NIPS 2017 exact-title/author record selected |
| Direct OpenReview legacy error schema | PASS | live HTTP 403 returned `ChallengeRequiredError` and `Challenge verification required`, matching the regression fixture |
| Extension-origin API/CORS behavior | SKIPPED | requires the actual unpacked extension runtime |
| Shadow DOM placement and visual light/dark layout | SKIPPED | requires Chrome rendering |
| Keyboard traversal in the live page | SKIPPED | requires Chrome rendering |
| PDF.js worker against a live arXiv PDF | SKIPPED | requires the unpacked extension runtime |
| Chrome Downloads and Save As dialog | SKIPPED | requires Chrome Downloads UI |

## File inventory

- root contract: `README.md`, `manifest.json`, `package.json`,
  `package-lock.json`, `.gitignore`
- design and verification: `docs/superpowers/specs/`,
  `docs/superpowers/plans/`, `docs/verification-report.md`
- build checks: three files under `scripts/`
- extension implementation: eight files under `src/`
- regression suite: six files under `tests/`
- packaged PDF.js: `vendor/pdf.mjs`, `vendor/pdf.worker.mjs`, and
  `vendor/LICENSE.pdfjs`

The two PDFs in the parent `paper_project/` directory were not edited. Their
current SHA-256 values are:

- `e5cad7659ab0968b308ca98c0101d933e5bbdd4685e976415d271c75c9e4c91c`
- `9613b073a1ec78f17ac794a3170d466a2ecd9a5b601cda7cf0710abace2062ce`

## Manual acceptance checklist

After loading the project directory through `chrome://extensions`, execute the
ten-item checklist in `README.md`. Successful completion of that checklist is
the remaining gate for calling the extension production-validated.
