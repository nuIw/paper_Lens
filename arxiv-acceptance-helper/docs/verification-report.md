# Verification Report

**Date:** 2026-09-01
**Project:** arXivLens
**Overall:** READY FOR MANUAL CHROME VALIDATION

The version-drift, partial-source, DBLP retrieval, and author-comment changes
pass the available automated gates. A previous paced ten-paper run passed, and
a current degraded-source AdaLoRA run confirmed the new fallback. This
environment has no Chrome or Chromium executable, so unpacked-extension behavior
remains a manual gate.

## Automated gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Manifest/resources | PASS | `scripts/validate-extension.mjs`; MV3 permissions and every declared resource validated |
| Syntax | PASS | `scripts/lint.mjs`; every `.js`/`.mjs` file passed `node --check` |
| Tests | PASS | 163 tests across six files, 0 failures |
| Coverage | PASS | all loaded files: lines 81.14%, branches 84.22%, functions 92.91% |
| Static security search | PASS | no `innerHTML`, string evaluation, secret-like literal, or `console.log` in runtime code/manifest |
| Git diff integrity | PASS | `git diff --check` produced no error |
| PDF.js packaged files | PASS | manifest validation found core, worker, and license; vendored core reports version 4.10.38 |
| PDF.js re-vendor build | PASS | pinned `pdfjs-dist` 4.10.38 recopied successfully |
| Dependency audit | PASS | `npm install` reported 0 vulnerabilities |

Production-module line coverage is 100% for `core.mjs`, 99.06% for
`sources.mjs`, 99.08% for `page.mjs`, 96.08% for `service-logic.mjs`, and
94.07% for `service-worker.mjs`. `content.mjs` is lower because Node tests
exercise its pure extraction/PDF/message helpers, not the full Shadow DOM and
Chrome API lifecycle.

## Review-specific regression coverage

- The user-triggered arXivLens launcher is inserted after `h1.title`; acceptance
  and PDF download controls replace it only after activation, while
  code links, source states, and all records are inserted immediately before
  `.bookmarks`; fixed minimum grid widths cannot push the download button out
  of a narrow paper column.
- Historical arXiv abstract pages fetch canonical latest metadata, while latest
  pages sample v1 and the penultimate version as bounded title/author aliases.
  Downloads remain tied to the viewed PDF version.
- A latest-metadata failure suppresses the historical arXiv comment fallback;
  successful author-comment fallbacks record the metadata version used.
- DBLP exact identity does not verify Decision or Track by itself.
- Crossref runs alongside DBLP and OpenReview as candidate discovery, but its
  publication metadata does not verify Decision or Track by itself.
- Semantic Scholar uses one direct arXiv-ID lookup as a DBLP-outage metadata
  fallback; its venue state is at most Probable and never verifies Decision or
  Track.
- Crossref official links, ACL publication DOI candidates, and derived CVF
  candidates must still pass an official-page fetch and identity rematch.
- DBLP, OpenReview, and Crossref begin in parallel. Semantic Scholar runs only
  when DBLP has no strong publication; dependent official-page checks run after
  strong metadata candidates are available.
- A strong DBLP or Crossref record can trigger only a recognized or safely
  derived official proceedings URL.
- Official proceedings verify Track only when the official metadata or
  collection URL explicitly identifies Main, Findings, or Workshop.
- Family-name-first proceedings authors match arXiv authors.
- Author evidence distinguishes full-name, initial-compatible, surname-only,
  and conflicting-given-name cases; a shared surname alone is not treated as
  a full author match.
- Later publication years are weak evidence rather than a hard submission-year
  cutoff, and changed subtitles can remain strong metadata matches.
- DBLP tries the full title, post-colon title, and historical title aliases
  before arXiv ID/canonical-title fallback. Authors are local identity evidence,
  not token-AND retrieval terms.
- The live DBLP zero-result form (a `hits` object with no `hit` member) is parsed
  as an empty result; a single-object `hit` is normalized defensively.
- One transient network/timeout is retried; a 5xx can switch once to a narrower
  title+author query. Recovered/partial records keep the failure visible as a
  partial source state.
- DBLP CoRR keys and arXiv DataCite DOI values recover the arXiv identity while
  remaining separate from publication DOI evidence; DBLP numeric author suffixes
  are removed before author matching.
- Strongly matched DBLP OpenReview links are followed as bounded forum hints.
  A forum venue such as `ICLR 2023 poster` supplies both acceptance and poster
  presentation when the API response is available.
- arXiv Comments and Abstract visible-text project URLs are collected without
  requiring anchor markup.
- Explicit acceptance wording and formal venue-only citations such as
  `The 11th International Conference ... (ICLR 2023)` supply only an
  `Author-reported` representative fallback when external sources have no
  terminal Decision. The fallback stays outside `All records & evidence`,
  rejects submission/review/rejection/withdrawal and incidental venue prose,
  and cannot override an external Accepted, Rejected, or Withdrawn record.
- UI match values are labeled heuristic scores out of 100, not confidence
  percentages, and expose title, author, year, and identifier evidence.
- arXiv DataCite DOI and publication DOI remain separate.
- Identity, Decision, and Track render as separate verification axes.
- `All records & evidence` separates identity matches from retained search
  candidates, suppresses normalized Candidate decisions, and reports returned,
  matched, and candidate counts per source.
- The default filename uses the title before the first colon, one underscore,
  and the canonical arXiv ID.
- OpenReview JSON/HTML challenges and 429 responses expose a fixed-origin
  forum/search link for manual verification. A top-level v2 challenge does not
  trigger another legacy request, while a later v1 failure no longer discards
  already collected v2 candidates.
- OpenReview requests omit cookies by default. Only the explicit session-retry
  control sends `credentials: "include"`.
- Only the two strongest OpenReview candidates receive forum expansion.
- Analysis cache entries include schema, identity fingerprints, `savedAt`, and
  `expiresAt`; complete results use 24 hours, partial results with external
  terminal evidence use one hour, and no-terminal/comment fallbacks use five
  minutes.
- Opening `Code & evidence` starts PDF scanning and requests optional GitHub
  host access before search. GitHub ranks metadata before at most eight README
  checks with concurrency two, allows five uncached paper searches per rolling
  hour, obeys response rate-limit exhaustion, caches complete results for one
  hour, and caches incomplete results for five minutes in `chrome.storage.session`.
- The `downloads` permission is optional and requested only from a
  `Download PDF` click.

## Live source smoke tests

On 2026-09-01 the production service pipeline was run for AdaLoRA three times
against the public endpoints during a DBLP degradation window. DBLP returned a
mix of 429, network failure, and timeout; legacy OpenReview returned its browser
challenge; Crossref returned no identity match. All three runs still returned
`ICLR 2023 · Accepted · Author-reported`, never `Venue not found`, and kept the
source failures visible. The run also exposed DBLP's omitted-`hit` empty shape,
which is now a dedicated parser regression.

After that parser fix and a DBLP recovery interval, a fresh AdaLoRA run returned
two identity matches (CoRR and ICLR), selected `DBLP · ICLR 2023 · Accepted ·
Probable`, extracted exact forum ID `lq62uWRJjiY`, and kept OpenReview's 403 as a
partial/manual-verification state.

Independent current-page checks confirmed arXiv v2, the v1 link, the formal
ICLR 2023 comment, DBLP's ICLR 2023 publication record, and forum ID
`lq62uWRJjiY`. OpenReview currently redirects that forum to interactive browser
verification.

A later paced ten-paper run returned accepted representatives for seven papers;
intermittent DBLP 503 responses left Attention and DDPM as preprint/no-result and
LoRA without a representative. This exposed two further limits: title-only
DBLP top-20 can omit a well-known exact paper, and simultaneous public-source
outages cannot safely be converted into acceptance. The final code therefore
adds one title+first-author retrieval fallback after title-first retrieval and a
conditional direct-arXiv-ID Semantic Scholar metadata fallback. In a targeted
rerun LoRA recovered `DBLP · ICLR 2022`. On a final targeted run DBLP returned
503 for both broad and author-narrowed queries; Semantic Scholar recovered DDPM
as `Neural Information Processing Systems 2020 · Accepted · Probable`, while its
unauthenticated pool returned 429 for Attention. Attention therefore remained a
visible preprint/incomplete result rather than being assigned a false venue.

The previous paced baseline run used current arXiv metadata and the production
service pipeline on 2026-08-31. All ten papers returned an accepted
representative. Search-only results below the identity threshold remained
candidate records and did not influence the representative.

| arXiv | Paper | Representative result | Verification |
| --- | --- | --- | --- |
| 2303.10512 | AdaLoRA | DBLP · ICLR 2023 | probable metadata; OpenReview forum linked for manual verification |
| 1706.03762 | Attention Is All You Need | NeurIPS Proceedings · 2017 Main | verified |
| 1810.04805 | BERT | ACL Anthology · NAACL 2019 | verified |
| 2006.11239 | Denoising Diffusion Probabilistic Models | NeurIPS Proceedings · 2020 Main | verified |
| 2010.11929 | Vision Transformer | DBLP · ICLR 2021 | probable metadata |
| 2106.09685 | LoRA | DBLP · ICLR 2022 | probable metadata |
| 2205.14135 | FlashAttention | DBLP · NeurIPS 2022 | probable metadata |
| 2208.12242 | DreamBooth | CVF Open Access · CVPR 2023 Main | verified |
| 2305.14314 | QLoRA | DBLP · NeurIPS 2023 | probable metadata |
| 2312.00752 | Mamba | OpenReview · COLM 2024 | probable metadata |

AdaLoRA now exercises the shorter path first: the full v2 title can return no
DBLP hit, after which the post-colon/v1 title can return the ICLR 2023 record and
official OpenReview forum ID `lq62uWRJjiY`. arXiv ID and DBLP canonical title
remain bounded later fallbacks. If DBLP itself is unavailable, the formal arXiv
comment supplies the explicitly lower `Author-reported` result instead.

An initial unpaced ten-paper batch caused DBLP to temporarily stop responding.
The final implementation avoids the unconditional two-request burst: common
title matches finish after one DBLP request, while only mismatch cases use the
bounded fallback. The final paced ten-paper run completed with DBLP success for
all papers.

## Repository and over-engineering review

The file inventory contains five root contract files, three build/check
scripts, eight extension implementation files, six test files, four current or
historical design/report documents, and three vendored PDF.js files. The vendor
files are the only embedded third-party code.

The repository review found no justified new dependency, framework, factory,
interface, or additional adapter layer. Existing historical plan files remain
documentation and were not rewritten as runtime architecture.

## Remaining manual Chrome gates

- Load the directory unpacked and confirm panel placement on modern and legacy
  arXiv IDs.
- Inspect DevTools Network before opening, after `Open arXivLens`, after
  `Code & evidence`, after OpenReview session retry, and after repeated panel opens.
- Exercise DBLP-only, OpenReview Decision, official proceedings, no-result,
  challenge/rate-limit, and partial-failure states.
- Confirm Identity/Decision/Track labels and source links visually.
- Scan a live PDF using the packaged PDF.js worker.
- Verify the default filename, all filename modes, Save As, and download dialog.
- Check keyboard focus and light/dark rendering.
