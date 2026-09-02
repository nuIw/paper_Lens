# arXivLens Design

**Date:** 2026-08-24  
**Status:** Approved for implementation  
**Project root:** `/nas2/data/whalsdn03/paper_project/arxiv-acceptance-helper`

## Purpose

Build a backend-free Chrome Manifest V3 extension for daily use on
`https://arxiv.org/abs/*`. It places acceptance and PDF download controls
between the paper title and authors, with a separate code/evidence control
between **References & Citations** and **Bookmark**. These surfaces:

- finds publication candidates in DBLP/OpenReview and verifies eligible records
  against official proceedings pages;
- retains every historical submission record instead of collapsing history;
- exposes the evidence and confidence behind the representative result;
- finds code and project links in the arXiv page and paper PDF;
- performs PDF link analysis and GitHub repository search only after the user opens `Code & evidence`; and
- pre-fills an editable, portable PDF filename before downloading.

The two source PDFs in `paper_project/` are research evidence and remain
unchanged.

## Product Principles

1. **No conference allowlist.** Search DBLP and OpenReview generically. A venue
   rule registry may interpret known non-standard fields, but never decides
   whether a venue is supported or visible.
2. **Raw evidence survives normalization.** Preserve original venue, decision,
   track, presentation, source URL, and record identifier alongside normalized
   values.
3. **State and confidence are separate.** `Preprint` is a paper state;
   `Metadata only` is an evidence level.
4. **Do not overclaim identity or official code.** Weak paper matches remain
   candidates. GitHub search results remain search candidates even when their
   names match the paper.
5. **Native browser features first.** Use Chrome storage and downloads, native
   form controls, plain JavaScript, CSS, and HTML. PDF.js is the only runtime
   dependency because Chrome exposes no stable API for PDF annotations/text.
6. **Partial results beat total failure.** DBLP, OpenReview, PDF scanning, and
   GitHub search report errors independently.

## User Experience

### Placement and lifecycle

An `Open arXivLens` control renders directly below the paper title and above the
authors. Publication analysis and the acceptance/PDF controls remain inactive
until the user opens this surface or `Code & evidence`.

A separate collapsed control renders before **Bookmark** in arXiv's
**References & Citations** column:

```text
[ Code & evidence ▼ ]
```

The analysis first checks the local cache. A valid cached analysis renders
immediately. Otherwise DBLP, Crossref, and OpenReview v2 run in parallel;
Semantic Scholar runs only when DBLP has no strong publication, and OpenReview
v1 runs only when v2
yields no usable strong candidate. Opening the lower code/evidence control
starts PDF scanning, requests the optional GitHub host permission, and starts
GitHub search when permission is granted. There is no second GitHub-search button.

### Two UI surfaces

The upper surface contains:

1. **Representative result:** venue, year, normalized decision, presentation,
   confidence badge, cache age, refresh control.
2. **PDF download:** editable filename, native filename-template select,
   `Save As` checkbox, and download button.

The lower expandable surface contains:

3. **Code and project links:** direct paper HTML links first, PDF annotation and
   text links as they arrive, followed by the GitHub candidate list.
4. **All records and evidence:** a collapsed view that separates matched
   publication evidence from lower-scoring search candidates, orders each group
   by match score and year, and preserves raw values, match reason, and clickable
   source URL. Candidate decisions are not presented as the current paper's state.

The UI uses Shadow DOM so arXiv CSS cannot alter it. It supports system light
and dark themes, keyboard focus, `aria-expanded`, readable loading/error text,
and text/icon state cues that do not depend on color.

## Extension Architecture

```text
arXiv abstract page
  └─ content bootstrap
       └─ content module + Shadow DOM panel
            ├─ extracts arXiv metadata and direct page links
            ├─ scans PDF links with packaged PDF.js on first open
            └─ sends fixed message types to the service worker
                    └─ MV3 service worker
                         ├─ DBLP collector
                         ├─ Crossref collector
                         ├─ Semantic Scholar collector
                         ├─ OpenReview v2/v1 collector
                         ├─ official proceedings follow-up
                         ├─ evidence resolver
                         ├─ on-demand GitHub repository search
                         ├─ chrome.storage cache/settings
                         └─ chrome.downloads invocation
```

The service worker owns cross-origin calls, caching, and downloads. It never
acts as an arbitrary URL proxy. The content module owns DOM extraction,
presentation, and on-demand PDF parsing so service-worker termination cannot
interrupt a long PDF scan. Pure matching, normalization, and parsing functions
remain browser-independent and are exercised with Node's built-in test runner.

## Source Collection

### arXiv

Extract title, authors, arXiv ID, comments, abstract, abstract-page URL, and the
actual PDF anchor URL from the live page. Keep arXiv's DataCite DOI
(`10.48550/arXiv...`) separate from a related publication DOI. Prefer page
anchors over URL reconstruction so old-style and versioned arXiv identifiers
work.

Treat an explicit author comment such as `Accepted at`, `Published at`, `To
appear in`, or `Camera-ready for` as a last-resort `Author-reported` acceptance
only when no identity-matched external record supplies Accepted, Rejected, or
Withdrawn. It may populate the representative header but never enters `All
records & evidence`, never becomes Verified or Probable, and never overrides an
external terminal Decision. A comment that consists of a formal venue citation
such as `The 11th International Conference ... (ICLR 2023)` or starts with
`ICLR 2023` is also an author-reported publication hint. `Submitted to`, `Under
review`, rejection/withdrawal wording, and incidental venue mentions elsewhere
in prose are not acceptance signals.

For a versioned historical abstract URL, fetch the canonical unversioned
abstract once and use its latest title, authors, DOI, and comment for work-level
acceptance analysis. Retain the viewed version's title and authors as one
matching alias. On a latest abstract page, sample v1 and the penultimate version
as bounded historical title/author aliases; do not fetch every revision. Keep
PDF scanning, download, and filename generation tied to the viewed version. If
latest metadata cannot be loaded, do not use the older comment as an acceptance
fallback. A historical-alias-only failure keeps current metadata usable and
surfaces a recall warning.

### DBLP

Query `https://dblp.org/search/publ/api` by title. Parse every returned hit and
normalize the single-author/object and multi-author/array shapes. DBLP proves a
publication record, but does not prove rejected or under-review history and
does not by itself establish `Main Track`.

Candidate generation queries the current full title, its post-colon suffix, and
bounded historical arXiv title aliases in order, requesting up to 20 hits. Do
not force an author into DBLP's token-AND query: authors, year, DOI, and arXiv ID
belong to local identity validation. If those title queries have no strong
publication record, query the arXiv ID to recover a CoRR identity and DBLP's
canonical title, then query each still-unseen canonical title within the same
bounded budget. A transient network/timeout failure receives one identical
retry; a 5xx can switch once to a narrower title+author plan instead of repeating
the broad query, while 429 stops. Any recovered or retained records plus a
failed request produce a partial source state
instead of a false success. Parse
CoRR keys and arXiv DataCite DOI values as arXiv identity rather than publication
DOI evidence, and remove DBLP's numeric author disambiguation suffix before
matching. The author and fallback values are retrieval context only; the normal
title/author/identifier scorer still decides whether a hit is a match.

### Official proceedings

After a strong DBLP match, follow only publication URLs that DBLP already
provides on CVF Open Access, ACL Anthology, PMLR, or NeurIPS Proceedings. The
official page can verify publication and can verify Main/Findings/Workshop only
when its metadata or official collection URL makes the track explicit. A DBLP
venue string is never reused as official track evidence. Do not run a broad
proceedings search or maintain a conference allowlist.

### OpenReview

Search API v2 at `https://api2.openreview.net` using exact-title requests before
a smaller bounded set of terms requests. Use current, post-colon, and historical
title aliases, score submission candidates, and retrieve forum replies for at
most the two strongest candidates so Decision notes are not
missed. Support both v2 `{ value }` content fields and v1 scalar content fields.
When v2 has no usable candidate, query `https://api.openreview.net` as the
legacy fallback. Preserve unknown Invitation-defined fields in the raw record.
Expand only the two strongest candidates to avoid redundant forum requests. If
strong DBLP metadata contains an OpenReview forum or PDF URL, use its forum ID
as a bounded direct lookup hint; this covers legacy forums missing from the v2
search index. If an API response requires OpenReview's interactive challenge or is rate-limited,
preserve the source as incomplete and link directly to the known forum or a
title search for manual verification. Send anonymous requests with
`credentials: "omit"` by default; only an explicit `Retry with OpenReview session`
click may refresh with `credentials: "include"`. Do not retry the legacy API after a v2
challenge/rate limit, bypass the challenge, trust an API-supplied URL, or turn
the failure into an acceptance claim. If v2 search candidates were already
collected before a v1 failure, retain them as candidates rather than discarding
the source response.

### Semantic Scholar

Issue one keyless Academic Graph lookup by `ARXIV:{id}` only when DBLP fails or
returns no strong publication. This is an identifier-addressed metadata fallback
for DBLP outages, not a title search or a new Decision authority. Parse title, authors, year, venue,
publication venue/type, DOI, and the Semantic Scholar page URL. An arXiv-ID
identity can be verified, while publication/venue state remains metadata-only
and therefore at most Probable. API failure or throttling remains a visible
partial source state and never blocks stronger DBLP, OpenReview, or official
proceedings evidence.

### GitHub

Do not call GitHub before `Code & evidence` is opened. That user click requests
the optional GitHub host permission, then queries title metadata using GitHub's
best-match order and collects up to
30 candidates, and runs one arXiv-ID fallback only when results are incomplete
or weak. Rank candidates by title/name and title/description coverage, exact
identifiers, and at most eight README checks with concurrency two; aggregators and
reference-only mentions receive penalties, while stars only break close ties.
Results are grouped as likely, possible, or low relevance without exposing
internal ranking evidence. No
candidate is labeled official without a direct paper-provided link. Reuse a
complete result for one hour in `chrome.storage.session`, an incomplete result
for five minutes, and deduplicate an in-flight request for the same paper. Allow
at most five uncached paper searches per rolling hour and stop further work when
GitHub rate-limit response headers indicate exhaustion.

### PDF links

Package the official `pdfjs-dist` core and worker locally; remote executable
code is forbidden. Scan link annotations and visible HTTP(S) URLs with their
page, section, bounded context, and source. Page-level References detection
separates current-paper project links, citation links, and unknown links before
rendering. Deduplicate normalized URLs while preserving the strongest
classification and evidence source.

## Matching and Resolution

### Candidate identity

Identity evidence is evaluated in this order:

1. exact arXiv ID or DOI;
2. normalized title plus matching authors;
3. title token similarity, author overlap, and nearby year.

An exact identifier is an automatic match. Otherwise a high match threshold
is required before a record joins the paper history. Lower-scoring search
results remain visible as `Candidate` records and never affect the
representative result. The UI places them in a separate `Search candidates —
identity not established` group and reports returned, matched, and candidate
counts separately for each source.

### Normalized values

Common decisions map to `Accepted`, `Under review`, `Preprint`, `Rejected`, or
`Withdrawn`. Common presentation values map to `Oral`, `Spotlight`, or
`Poster`. Tracks map only when the metadata explicitly says `Main`,
`Findings`, or `Workshop`; all other values remain raw and normalize to
`Other` or `Unknown`.

### Representative ordering

Use this deterministic order:

```text
Main Accepted
> Findings Accepted
> Workshop Accepted
> Other Accepted
> Under review
> Preprint
> Rejected
> Withdrawn
```

If both Main and Workshop acceptances exist, Main is representative and the
Workshop record remains in history. Workshop-only papers remain Workshop.

### Verification labels

Identity, Decision, and Track have separate verification states. Exact arXiv
ID/publication DOI can verify identity; an official OpenReview Decision or
official proceedings page can verify a decision; only explicit official track
evidence can verify Track. DBLP publication metadata alone cannot verify
Decision or Track.

- **Verified:** at least one decision-verifying official record represents the
  paper; inspect the three axes to see what that record actually verifies.
- **Probable:** one authoritative metadata source with strong title/author
  identity but no exact identifier.
- **Metadata only:** a source exposes venue/decision text that cannot be
  interpreted or strongly linked.
- **Conflicting:** records for the same venue and year disagree on terminal
  decisions. Different-year submission history is not a conflict.
- **Candidate:** identity is below the automatic-merge threshold.

## Filename and Download

Default filename format:

```text
<title text before the first colon, or the full title>_<arXiv ID>.pdf
```

The filename is editable. A native select offers exactly four modes:

- short title only;
- short title plus arXiv ID (default);
- full title plus arXiv ID;
- custom/manual editing.

Sanitize control characters, Windows-invalid characters, path separators,
reserved dot names, trailing spaces/dots, and excessive length. Chrome receives
a Downloads-relative filename only. The `Save As` checkbox controls
`chrome.downloads.download({ saveAs })`. Store the template choice and
checkbox in `chrome.storage.sync`.

## Cache, Privacy, and Security

- Cache normalized analysis results in `chrome.storage.local` with schema,
  arXiv ID, normalized title/author fingerprints, `savedAt`, and `expiresAt`.
  Complete results live for 24 hours. Partial results with a strong external
  terminal record live for one hour; partial/no-terminal and author-comment
  fallback results live for five minutes.
- A visible refresh control bypasses and replaces one paper's cache entry.
- Persist no PDF bytes, browsing history, API tokens, or telemetry. GitHub
  candidates use a one-hour, browser-session-only cache.
- Request `storage` at install time. Request `downloads` only from a
  `Download PDF` click.
- Restrict host permissions to arXiv, DBLP, Crossref, Semantic Scholar,
  OpenReview v2/v1, and four official proceedings hosts. GitHub API access is an
  optional host permission requested from `Code & evidence`.
- Validate all incoming messages, paper metadata, arXiv download URLs, and
  filename strings at the service-worker boundary.
- Render remote strings with DOM `textContent`, never `innerHTML`.
- Bundle all executable JavaScript locally under the Manifest V3 CSP.

## Error Handling

Each source has `idle`, `loading`, `success`, `empty`, or `error` state. A
source failure renders beside that source and does not remove successful
results. Timeouts use `AbortController`. Malformed API payloads become a source
error rather than an uncaught exception. Rate-limit messages include a manual
source link. If the arXiv page structure changes, the injected control shows a
small extraction error instead of issuing queries with incomplete metadata.

## Test and Verification Strategy

Use Node's built-in `node:test` and literal fixtures. Follow red-green-refactor
for every non-trivial pure function. Cover:

- title/author normalization and candidate scoring;
- v1/v2 OpenReview field shapes and Decision replies;
- DBLP author object/array parsing;
- decision, track, presentation, confidence, conflict, and representative
  selection rules;
- filename modes and cross-platform sanitization;
- URL validation/deduplication and API query creation;
- cache expiry and message validation through injected browser-API fakes.

Verification consists of manifest validation, JavaScript syntax checks, tests
with coverage, dependency/license inspection, secret and unsafe-rendering
searches, an over-engineering-only Ponytail review, and a normal correctness
review. Loading the unpacked extension and exercising real Chrome APIs is a
separate manual check if no Chrome/Chromium executable exists in the workspace.

## Explicit Non-goals

- no backend, account system, database, telemetry, or hosted service;
- no React/Vue/Svelte, component library, bundler, TypeScript, or CSS framework;
- no supported-conference allowlist;
- no official-code claim based only on GitHub search;
- no PDF viewer, reference manager, notification system, or bulk library;
- no options page while the four inline filename controls cover the need; and
- no modification of the two source PDFs or unrelated research repositories.
