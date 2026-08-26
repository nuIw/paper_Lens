# arXiv Acceptance Helper Design

**Date:** 2026-08-24  
**Status:** Approved for implementation  
**Project root:** `/nas2/data/whalsdn03/paper_project/arxiv-acceptance-helper`

## Purpose

Build a backend-free Chrome Manifest V3 extension for daily use on
`https://arxiv.org/abs/*`. It places one compact button immediately below
arXiv's **Export BibTeX Citation** control. Opening the button reveals an
inline panel that:

- finds publication candidates in DBLP/OpenReview and verifies eligible records
  against official proceedings pages;
- retains every historical submission record instead of collapsing history;
- exposes the evidence and confidence behind the representative result;
- finds code and project links in the arXiv page and paper PDF;
- performs GitHub repository search only after an explicit button click; and
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

The extension injects this collapsed control below **Export BibTeX Citation**:

```text
[ Acceptance · Code · Download ▼ ]
```

No DBLP/OpenReview/GitHub request occurs before the first open. On the first
open, the panel immediately renders arXiv metadata and page links, then checks
the local cache. A valid cached analysis renders immediately. Otherwise DBLP
and OpenReview v2 run in parallel; OpenReview v1 runs only when v2 yields no
usable candidates. PDF link scanning starts in parallel in the page context.
Later opens reuse the mounted panel and cached results.

### Expanded panel

The compact expanded panel contains four regions:

1. **Representative result:** venue, year, normalized decision, presentation,
   confidence badge, cache age, refresh control.
2. **PDF download:** editable filename, native filename-template select,
   `Save As` checkbox, and download button.
3. **Code and project links:** direct paper HTML links first, PDF annotation and
   text links as they arrive, followed by a separate `GitHub additional search`
   action and candidate list.
4. **All records and evidence:** a collapsed chronological list showing raw and
   normalized values, match reason, and clickable source URL.

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

### DBLP

Query `https://dblp.org/search/publ/api` by title. Parse every returned hit and
normalize the single-author/object and multi-author/array shapes. DBLP proves a
publication record, but does not prove rejected or under-review history and
does not by itself establish `Main Track`.

Live-query hardening adds the first arXiv author to the title terms. DBLP's
prefix-token search can otherwise rank title lookalikes above the exact paper
within the ten-result window. The author is retrieval context only; the normal
title/author/identifier scorer still decides whether a hit is a match.

### Official proceedings

After a strong DBLP match, follow only publication URLs that DBLP already
provides on CVF Open Access, ACL Anthology, PMLR, or NeurIPS Proceedings. The
official page can verify publication and can verify Main/Findings/Workshop only
when its metadata or official collection URL makes the track explicit. A DBLP
venue string is never reused as official track evidence. Do not run a broad
proceedings search or maintain a conference allowlist.

### OpenReview

Search API v2 at `https://api2.openreview.net`, score submission candidates,
and retrieve forum replies for strong candidates so Decision notes are not
missed. Support both v2 `{ value }` content fields and v1 scalar content fields.
When v2 has no usable candidate, query `https://api.openreview.net` as the
legacy fallback. Preserve unknown Invitation-defined fields in the raw record.
Expand only the two strongest candidates to avoid redundant forum requests. If
an API response requires OpenReview's interactive challenge or is rate-limited,
preserve the source as incomplete and link directly to the known forum or a
title search for manual verification. Do not retry the legacy API after a v2
challenge/rate limit, bypass the challenge, trust an API-supplied URL, or turn
the failure into an acceptance claim.

### GitHub

Do not call GitHub during automatic analysis. The `GitHub additional search`
button queries the public repository search endpoint for a small title-based
candidate set. Results appear under a `Search candidates` heading with
repository owner, description, URL, stars, and update date. Rate-limit or
network errors retain a normal GitHub web-search link as the manual fallback.
No candidate is labeled official without a direct paper-provided link. Reuse a
successful result for one hour in `chrome.storage.session` and deduplicate an
in-flight request for the same paper.

### PDF links

Package the official `pdfjs-dist` core and worker locally; remote executable
code is forbidden. Scan link annotations first, then text content for visible
HTTP(S) URLs. Accept only `http:` and `https:` URLs and retain links from known
code/project hosts (`github.com`, `github.io`, `gitlab.com`,
`huggingface.co`). Deduplicate normalized URLs. Annotation links and text-only
links carry different evidence labels.

## Matching and Resolution

### Candidate identity

Identity evidence is evaluated in this order:

1. exact arXiv ID or DOI;
2. normalized title plus matching authors;
3. title token similarity, author overlap, and nearby year.

An exact identifier is an automatic match. Otherwise a high match threshold
is required before a record joins the paper history. Lower-scoring search
results remain visible as `Candidate` records and never affect the
representative result.

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

- short title plus arXiv ID (default);
- full title plus arXiv ID;
- arXiv ID only; and
- custom/manual editing.

Sanitize control characters, Windows-invalid characters, path separators,
reserved dot names, trailing spaces/dots, and excessive length. Chrome receives
a Downloads-relative filename only. The `Save As` checkbox controls
`chrome.downloads.download({ saveAs })`. Store the template choice and
checkbox in `chrome.storage.sync`.

## Cache, Privacy, and Security

- Cache normalized analysis results in `chrome.storage.local` with schema,
  arXiv ID, normalized title/author fingerprints, `savedAt`, and `expiresAt`.
  Complete results live for 24 hours and partial source failures for 10 minutes.
- A visible refresh control bypasses and replaces one paper's cache entry.
- Persist no PDF bytes, browsing history, API tokens, or telemetry. GitHub
  candidates use a one-hour, browser-session-only cache.
- Request only `storage` and `downloads` Chrome permissions.
- Restrict host permissions to arXiv, DBLP, OpenReview v2/v1, four official
  proceedings hosts, and GitHub API.
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
