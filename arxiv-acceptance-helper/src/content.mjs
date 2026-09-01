import { buildFilename, sanitizeFilename } from "./core.mjs";
import {
  cleanArxivLabel,
  dedupeProjectLinks,
  displayValue,
  formatMatchEvidence,
  formatVenueYear,
  panelViewModel,
  parseArxivId,
  parseArxivVersion,
} from "./page.mjs";

function metadataValue(doc, label) {
  for (const row of doc.querySelectorAll(".metatable tr")) {
    const cells = row.querySelectorAll("td");
    if (cells.length >= 2 && cells[0].textContent.trim().toLowerCase() === label.toLowerCase()) {
      return cells[1].textContent.trim();
    }
  }
  return "";
}

export function extractPaper(doc, location) {
  const arxivId = parseArxivId(location.pathname);
  const pathVersion = parseArxivVersion(location.pathname);
  const title = cleanArxivLabel(doc.querySelector("h1.title")?.textContent, "Title:");
  const pdfUrl = doc.querySelector(".download-pdf a, a[href*='/pdf/']")?.href ?? "";
  const authors = [...doc.querySelectorAll(".authors a")]
    .map((author) => author.textContent.trim())
    .filter(Boolean);
  if (!arxivId || !title || !authors.length || !pdfUrl) {
    throw new Error("Could not read the arXiv paper metadata.");
  }
  const doiUrls = [...doc.querySelectorAll("a[href^='https://doi.org/']")]
    .map((anchor) => anchor.href);
  const arxivDoiUrl = doiUrls.find((href) => /^https?:\/\/doi\.org\/10\.48550\/arxiv\./i.test(href)) ?? "";
  const publicationDoiUrl = doiUrls.find((href) => !/^https?:\/\/doi\.org\/10\.48550\/arxiv\./i.test(href)) ?? "";
  const history = doc.querySelector(".submission-history")?.textContent ?? "";
  const historyVersions = [...history.matchAll(/\[v(\d+)\]/gi)].map((match) => Number(match[1]));
  const latestVersion = Math.max(pathVersion ?? 0, ...historyVersions) || null;
  const viewedVersion = pathVersion ?? latestVersion;
  return {
    arxivId,
    title,
    authors,
    arxivDoi: arxivDoiUrl.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    publicationDoi: publicationDoiUrl.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    comment: metadataValue(doc, "Comments:"),
    abstract: cleanArxivLabel(doc.querySelector("blockquote.abstract")?.textContent, "Abstract:"),
    year: Number(history.match(/\b(19|20)\d{2}\b/)?.[0]) || null,
    viewedVersion,
    latestVersion,
    pageUrl: location.href,
    pdfUrl,
  };
}

function metadataAlias(paper) {
  return {
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    version: paper.viewedVersion,
  };
}

function metadataFingerprint(paper) {
  return `${String(paper?.title ?? "").trim()}\u0000${(paper?.authors ?? []).join("\u0000")}`;
}

async function fetchArxivPaper(url, fetchImpl, parseHtml) {
  const signal = globalThis.AbortSignal?.timeout?.(5_000);
  const response = await fetchImpl(url.href, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const paper = extractPaper(parseHtml(await response.text()), url);
  return paper;
}

function uniqueMetadataAliases(primary, papers) {
  const primaryFingerprint = metadataFingerprint(primary);
  const seen = new Set([primaryFingerprint]);
  const aliases = [];
  for (const paper of papers) {
    const fingerprint = metadataFingerprint(paper);
    if (!paper || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    aliases.push(metadataAlias(paper));
    if (aliases.length === 3) break;
  }
  return aliases;
}

export async function resolveAnalysisPaper(
  viewedPaper,
  fetchImpl = fetch,
  parseHtml = (html) => new DOMParser().parseFromString(html, "text/html"),
) {
  const needsLatest = viewedPaper.viewedVersion
    && viewedPaper.latestVersion
    && viewedPaper.viewedVersion < viewedPaper.latestVersion;
  let analysisPaper = viewedPaper;
  const aliasPapers = [];
  try {
    if (needsLatest) {
      const latestUrl = new URL(`/abs/${viewedPaper.arxivId}`, "https://arxiv.org");
      analysisPaper = await fetchArxivPaper(latestUrl, fetchImpl, parseHtml);
      if (analysisPaper.arxivId !== viewedPaper.arxivId) throw new Error("arXiv identifier changed");
      aliasPapers.push(viewedPaper);
    }
  } catch (error) {
    return {
      paper: {
        ...viewedPaper,
        comment: "",
        metadataVersion: viewedPaper.viewedVersion,
        metadataAliases: [],
      },
      warning: `Latest arXiv metadata (v${viewedPaper.latestVersion}) could not be loaded; the older comment was not used.`,
    };
  }

  const metadataVersion = analysisPaper.viewedVersion
    ?? analysisPaper.latestVersion
    ?? viewedPaper.latestVersion
    ?? viewedPaper.viewedVersion;
  const latestVersion = analysisPaper.latestVersion ?? viewedPaper.latestVersion ?? metadataVersion;
  const historicalVersions = [...new Set([1, Number(latestVersion) - 1])]
    .filter((version) => Number.isInteger(version)
      && version >= 1
      && version < Number(metadataVersion)
      && version !== viewedPaper.viewedVersion)
    .slice(0, 2);
  const failedHistoricalVersions = [];
  const historicalResults = await Promise.all(historicalVersions.map(async (version) => {
    const url = new URL(`/abs/${viewedPaper.arxivId}v${version}`, "https://arxiv.org");
    try {
      const historicalPaper = await fetchArxivPaper(url, fetchImpl, parseHtml);
      return historicalPaper.arxivId === viewedPaper.arxivId ? historicalPaper : null;
    } catch {
      failedHistoricalVersions.push(version);
      return null;
    }
  }));
  for (const historicalPaper of historicalResults) {
    if (historicalPaper) aliasPapers.push(historicalPaper);
  }

  return {
    paper: {
      ...analysisPaper,
      metadataVersion,
      latestVersion,
      metadataAliases: uniqueMetadataAliases(analysisPaper, aliasPapers),
    },
    warning: failedHistoricalVersions.length
      ? `Historical arXiv metadata (${failedHistoricalVersions.sort((left, right) => left - right).map((version) => `v${version}`).join(", ")}) could not be loaded; title-alias search may be incomplete.`
      : "",
  };
}

function visibleUrls(text) {
  return String(text).match(/https?:\/\/[^\s<>{}\[\]"']+/g)?.map((url) => url.replace(/[),.;:]+$/g, "")) ?? [];
}

function visibleUrlsFromItems(items) {
  const chunks = [];
  for (let index = 0; index < items.length; index += 1) {
    let current = String(items[index].str ?? "");
    const next = String(items[index + 1]?.str ?? "").trim();
    if (/https?:\/\/\S*[\/._?=&%#-]$/.test(current.trim()) && next && !/\s/.test(next)) {
      current = `${current.trim()}${next}`;
      index += 1;
    }
    chunks.push(current);
  }
  const text = chunks.join(" ");
  return visibleUrls(text).map((url) => {
    const index = text.indexOf(url);
    return {
      url,
      context: text.slice(Math.max(0, index - 300), index + url.length + 300).replace(/\s+/g, " ").trim(),
    };
  });
}

export async function scanPdfLinks(pdfUrl, pdfjs, runtimeUrl, fetchImpl = fetch, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let bytes;
  try {
    response = await fetchImpl(pdfUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`PDF download failed: HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
  pdfjs.GlobalWorkerOptions.workerSrc = runtimeUrl("vendor/pdf.worker.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    docBaseUrl: pdfUrl,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const links = [];
  let referencesStarted = false;
  try {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const annotations = await page.getAnnotations();
      const text = await page.getTextContent();
      const pageText = text.items.map((item) => `${item.str ?? ""}${item.hasEOL ? "\n" : " "}`).join("");
      // Page-level section detection is conservative; coordinates can refine mixed-section pages later.
      referencesStarted ||= /(?:^|\n)\s*(?:references|bibliography)\s*(?:\n|$)/im.test(pageText);
      const section = referencesStarted ? "references" : "body";
      for (const annotation of annotations) {
        if (annotation.subtype === "Link" && (annotation.url || annotation.unsafeUrl)) {
          const url = annotation.url ?? annotation.unsafeUrl;
          const index = pageText.indexOf(url);
          const context = index >= 0
            ? pageText.slice(Math.max(0, index - 300), index + url.length + 300).replace(/\s+/g, " ").trim()
            : "";
          links.push({ url, page: number, section, context, source: "pdf-annotation" });
        }
      }
      for (const link of visibleUrlsFromItems(text.items)) {
        links.push({ ...link, page: number, section, source: "pdf-text" });
      }
    }
    return dedupeProjectLinks(links);
  } finally {
    await pdf.destroy();
  }
}

function element(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function safeLink(url, label, className = "") {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Unsafe link");
    const anchor = element("a", className, label);
    anchor.href = parsed.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    return anchor;
  } catch {
    return element("span", className, label);
  }
}

function findCitationControl(doc) {
  const direct = doc.querySelector("#bib-cite-trigger");
  if (direct) return direct;
  return [...doc.querySelectorAll("button, a")]
    .find((candidate) => /export bibtex citation/i.test(candidate.textContent));
}

export function placePanelHosts(doc, summaryHost, detailsHost) {
  const title = doc.querySelector("h1.title");
  const bookmark = doc.querySelector(".bookmarks");
  const citation = findCitationControl(doc);
  const detailsAnchor = bookmark ?? citation?.closest?.(".extra-ref-cite") ?? citation?.parentElement ?? citation;
  if (!title || !detailsAnchor) return false;
  title.insertAdjacentElement("afterend", summaryHost);
  detailsAnchor.insertAdjacentElement(bookmark ? "beforebegin" : "afterend", detailsHost);
  return true;
}

export function collectPageLinks(doc) {
  const selector = ".metatable a[href], blockquote.abstract a[href], .submission-history a[href]";
  const links = [...doc.querySelectorAll(selector)].map((anchor) => ({
    url: anchor.href,
    source: "paper-html",
    text: `${anchor.textContent ?? ""} ${anchor.title ?? ""} ${anchor.closest?.("tr, blockquote, .submission-history")?.textContent ?? ""}`,
  }));
  const textRegions = doc.querySelectorAll(".metatable tr, blockquote.abstract, .submission-history");
  for (const region of textRegions) {
    for (const url of visibleUrls(region.textContent)) {
      links.push({ url, source: "paper-text", text: region.textContent ?? "" });
    }
  }
  return dedupeProjectLinks(links);
}

function sourceStatus(state, source, retryOpenReviewSession) {
  if (!state) return null;
  const row = element("div", `ah-source ah-source--${state.status}`);
  const label = ({
    openreview: "OpenReview",
    proceedings: "Official proceedings",
    semanticscholar: "Semantic Scholar",
  })[source]
    ?? source.toUpperCase();
  const count = Number(state.count) || 0;
  const matchedCount = Number(state.matchedCount) || 0;
  const candidateCount = Number(state.candidateCount) || 0;
  const counts = `${count} returned · ${matchedCount} identity match${matchedCount === 1 ? "" : "es"}`
    + ` · ${candidateCount} search candidate${candidateCount === 1 ? "" : "s"}`;
  if (state.status === "linked_blocked") {
    const discoveredBy = state.linkedForums?.[0]?.discoveredBy?.toUpperCase() ?? "bibliographic metadata";
    row.textContent = `⚠ ${label}: forum linked by ${discoveredBy} · API verification blocked`;
  } else if (state.status === "error") row.textContent = `⚠ ${label}: ${state.error}`;
  else if (state.status === "empty") row.textContent = `— ${label}: no record found`;
  else if (state.warning) row.textContent = `⚠ ${label}: ${counts} — ${state.warning}`;
  else row.textContent = `${matchedCount ? "✓" : "—"} ${label}: ${counts}`;
  if (source === "openreview" && state.manualUrl) {
    row.append(" · ", safeLink(
      state.manualUrl,
      "Verify manually on OpenReview ↗",
      "ah-link",
    ));
    const retry = element("button", "ah-link-button", "Retry with OpenReview session");
    retry.type = "button";
    retry.addEventListener("click", retryOpenReviewSession);
    row.append(" · ", retry);
  }
  return row;
}

export async function safeRuntimeMessage(send, message) {
  try {
    return await send(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function mount() {
  if (document.querySelector("#arxiv-acceptance-helper")) return;
  const summaryHost = element("div", "ah-summary-host");
  summaryHost.id = "arxiv-acceptance-helper";
  const detailsHost = element("div", "ah-details-host");
  detailsHost.id = "arxiv-acceptance-helper-details";
  if (!placePanelHosts(document, summaryHost, detailsHost)) return;

  const attachApp = (host) => {
    const shadow = host.attachShadow({ mode: "open" });
    const stylesheet = element("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("src/panel.css");
    const app = element("div", "ah-app");
    shadow.append(stylesheet, app);
    return { shadow, app };
  };
  const summary = attachApp(summaryHost);
  const details = attachApp(detailsHost);

  let viewedPaper;
  try {
    viewedPaper = extractPaper(document, location);
  } catch (error) {
    const failure = element("div", "ah-extraction-error", `arXivLens: ${error.message}`);
    summary.app.append(failure);
    return;
  }
  let paper = viewedPaper;
  let paperPromise = null;

  let saved = { filenameMode: "alias", saveAs: true };
  try {
    saved = await chrome.storage.sync.get(saved);
  } catch {
    // The controls remain usable with their native defaults.
  }
  if (saved.filenameMode === "id") saved.filenameMode = "alias";
  const state = {
    active: false,
    open: false,
    analysisStatus: "idle",
    analysis: null,
    analysisError: "",
    pdfStatus: "idle",
    pdfError: "",
    links: collectPageLinks(document),
    githubStatus: "idle",
    github: null,
    githubError: "",
    downloadStatus: "",
    filenameMode: saved.filenameMode,
    saveAs: saved.saveAs,
    filename: buildFilename(viewedPaper, saved.filenameMode),
    versionWarning: "",
    versionNotice: "",
  };

  async function ensurePaper() {
    if (!paperPromise) {
      paperPromise = resolveAnalysisPaper(viewedPaper).then((latest) => {
        paper = latest.paper;
        state.versionWarning = latest.warning;
        state.versionNotice = viewedPaper.viewedVersion && paper.metadataVersion
          && viewedPaper.viewedVersion !== paper.metadataVersion
          ? `Viewing arXiv v${viewedPaper.viewedVersion}; acceptance checked using latest v${paper.metadataVersion}.`
          : "";
        return paper;
      });
    }
    return paperPromise;
  }

  async function loadAnalysis(refresh = false, openReviewSession = false) {
    state.analysisStatus = "loading";
    state.analysisError = "";
    render();
    const analysisPaper = await ensurePaper();
    const response = await safeRuntimeMessage((message) => chrome.runtime.sendMessage(message), {
      type: refresh ? "REFRESH_PAPER" : "ANALYZE_PAPER",
      paper: analysisPaper,
      ...(openReviewSession ? { openReviewSession: true } : {}),
    });
    if (response?.ok) {
      state.analysis = response.data;
      state.analysisStatus = "success";
    } else {
      state.analysisStatus = "error";
      state.analysisError = response?.error ?? "Metadata lookup failed.";
    }
    render();
  }

  async function loadPdfLinks() {
    state.pdfStatus = "loading";
    render();
    try {
      const pdfjs = await import(chrome.runtime.getURL("vendor/pdf.mjs"));
      const links = await scanPdfLinks(viewedPaper.pdfUrl, pdfjs, (path) => chrome.runtime.getURL(path));
      state.links = dedupeProjectLinks([...state.links, ...links]);
      state.pdfStatus = "success";
    } catch (error) {
      state.pdfStatus = "error";
      state.pdfError = error instanceof Error ? error.message : String(error);
    }
    render();
  }

  async function searchGitHub() {
    state.githubStatus = "loading";
    state.githubError = "";
    render();
    const permissionRequest = safeRuntimeMessage(
      (message) => chrome.runtime.sendMessage(message),
      { type: "REQUEST_GITHUB_ACCESS" },
    );
    const paperRequest = ensurePaper();
    const permission = await permissionRequest;
    if (!permission?.ok) {
      state.githubStatus = "error";
      state.githubError = permission?.error ?? "GitHub access permission was not granted.";
      render();
      return;
    }
    const response = await safeRuntimeMessage(
      (message) => chrome.runtime.sendMessage(message),
      { type: "SEARCH_GITHUB", paper: await paperRequest },
    );
    if (response?.ok) {
      state.github = response.data;
      state.githubStatus = "success";
    } else {
      state.github = response?.data ?? null;
      state.githubStatus = "error";
      state.githubError = response?.error ?? "GitHub search failed.";
    }
    render();
  }

  async function downloadPdf() {
    const filename = sanitizeFilename(state.filename);
    state.filename = filename;
    state.downloadStatus = "Starting download…";
    render();
    const response = await safeRuntimeMessage((message) => chrome.runtime.sendMessage(message), {
      type: "DOWNLOAD_PDF",
      pdfUrl: viewedPaper.pdfUrl,
      filename,
      saveAs: state.saveAs,
    });
    state.downloadStatus = response?.ok ? "Download started." : (response?.error ?? "Download failed.");
    render();
  }

  function renderLinks(section) {
    const heading = element("div", "ah-section-heading", "Code & project links");
    section.append(heading);
    const appendLinks = (label, links) => {
      if (!links.length) return;
      if (label) section.append(element("p", "ah-candidate-label", label));
      const list = element("ul", "ah-link-list");
      for (const link of links) {
        const item = element("li");
        item.append(safeLink(link.url, link.label, "ah-link"));
        const page = link.page ? ` · page ${link.page}` : "";
        item.append(element("span", "ah-evidence", ` · ${link.evidence}${page}`));
        list.append(item);
      }
      section.append(list);
    };
    const paperLinks = state.links.filter((link) => link.classification === "paperProjectLink");
    const citationLinks = state.links.filter((link) => link.classification === "citationProjectLink");
    const unknownLinks = state.links.filter((link) => !["paperProjectLink", "citationProjectLink"]
      .includes(link.classification));
    if (paperLinks.length) {
      appendLinks("", paperLinks);
    } else {
      section.append(element("p", "ah-muted", "No direct code or project link found yet."));
    }
    appendLinks("Links found in citations", citationLinks);
    appendLinks("Unclassified paper links", unknownLinks);
    if (state.pdfStatus === "loading") section.append(element("p", "ah-progress", "Scanning PDF links…"));
    if (state.pdfStatus === "error") section.append(element("p", "ah-error", `PDF scan: ${state.pdfError}`));

    if (state.githubStatus === "loading") section.append(element("p", "ah-progress", "Searching GitHub…"));
    if (state.githubStatus === "error") section.append(element("p", "ah-error", state.githubError));
    if (state.github?.searchWarning) section.append(element("p", "ah-error", state.github.searchWarning));
    if (state.github?.readmeWarning) section.append(element("p", "ah-error", state.github.readmeWarning));
    if (state.github?.incompleteResults) {
      section.append(element("p", "ah-muted", "GitHub reported incomplete search results; this result uses a short cache."));
    }
    if (state.github?.readmeIncomplete) {
      section.append(element("p", "ah-muted", "Some README checks failed; ranking used the available metadata."));
    }
    const appendGitHubCandidates = (target, candidates) => {
      const list = element("ul", "ah-github-list");
      for (const candidate of candidates) {
        const item = element("li", "ah-github-item");
        item.append(safeLink(candidate.url, candidate.name, "ah-link"));
        const updated = candidate.updatedAt ? `updated ${candidate.updatedAt.slice(0, 10)}` : "";
        const detail = [candidate.description, `★ ${candidate.stars}`, updated].filter(Boolean).join(" · ");
        if (detail) item.append(element("span", "ah-evidence", detail));
        list.append(item);
      }
      target.append(list);
    };
    if (state.github?.candidates?.length) {
      const likely = state.github.candidates.filter((candidate) => candidate.classification === "likely_implementation");
      const possible = state.github.candidates.filter((candidate) => candidate.classification === "possible_match");
      const low = state.github.candidates.filter((candidate) => candidate.classification === "low_relevance");
      section.append(element("p", "ah-candidate-label", "Likely implementation"));
      if (likely.length) appendGitHubCandidates(section, likely.slice(0, 3));
      else section.append(element("p", "ah-muted", "No likely implementation found."));
      if (likely.length > 3) {
        const more = element("details", "ah-github-group");
        more.append(element("summary", "ah-candidate-label", `Show ${likely.length - 3} more`));
        appendGitHubCandidates(more, likely.slice(3));
        section.append(more);
      }
      for (const [label, candidates] of [
        ["Possible match", possible],
        ["Low relevance / reference-only", low],
      ]) {
        if (!candidates.length) continue;
        const group = element("details", "ah-github-group");
        group.append(element("summary", "ah-candidate-label", `${label} (${candidates.length})`));
        appendGitHubCandidates(group, candidates);
        section.append(group);
      }
    }
    if (state.github?.manualUrl) {
      section.append(safeLink(state.github.manualUrl, "Open manual GitHub search ↗", "ah-manual-link"));
    }
  }

  function renderRecords(section, view) {
    const details = element("details", "ah-records");
    const summary = element(
      "summary",
      "ah-record-summary",
      `All records & evidence (${view.matchedRecords.length} matched · ${view.candidateRecords.length} candidates)`,
    );
    details.append(summary);

    const renderRecord = (record, candidate) => {
      const item = element("article", `ah-record ah-record--${record.confidence}`);
      const venue = formatVenueYear(record.venueRaw || "Unknown venue", record.year);
      item.append(element(
        "div",
        "ah-record-title",
        candidate ? `${venue} · Candidate publication record` : `${venue} · ${displayValue(record.decision)}`,
      ));
      const facts = candidate
        ? "Identity not established · source state not applied to the paper"
        : [
            record.track !== "unknown" ? displayValue(record.track) : "",
            record.presentation !== "unknown" ? displayValue(record.presentation) : "",
            displayValue(record.confidence),
          ].filter(Boolean).join(" · ");
      item.append(element("div", "ah-record-facts", facts));
      if (record.verification) {
        item.append(element(
          "div",
          "ah-record-facts",
          `Identity ${displayValue(record.verification.identity)} · Decision ${displayValue(record.verification.decision)} · Track ${displayValue(record.verification.track)}`,
        ));
      }
      const raw = [
        record.decisionRaw ? `decision: ${record.decisionRaw}` : "",
        record.trackRaw ? `track: ${record.trackRaw}` : "",
        record.presentationRaw ? `presentation: ${record.presentationRaw}` : "",
      ].filter(Boolean).join(" · ");
      if (raw) item.append(element("div", "ah-record-raw", `Raw — ${raw}`));
      const evidence = element("div", "ah-record-evidence");
      const matchKind = ({
        identifier: "exact identifier",
        "title-authors": "title + authors",
        similarity: "title/author similarity",
      })[record.matchKind] ?? "metadata";
      evidence.append(element(
        "span",
        "",
        `${record.source ?? "metadata"} · ${matchKind} · heuristic score ${Math.round((record.matchScore ?? 1) * 100)}/100`,
      ));
      if (record.sourceUrl) evidence.append(" · ", safeLink(record.sourceUrl, "source ↗", "ah-link"));
      item.append(evidence);
      const matchEvidence = formatMatchEvidence(record);
      if (matchEvidence) item.append(element("div", "ah-record-raw", `Identity evidence — ${matchEvidence}`));
      return item;
    };

    if (view.matchedRecords.length) {
      const matched = element("section", "ah-record-group");
      matched.append(element(
        "div",
        "ah-record-group-title",
        `Matched publication evidence (${view.matchedRecords.length})`,
      ));
      for (const record of view.matchedRecords) matched.append(renderRecord(record, false));
      details.append(matched);
    } else if (view.candidateRecords.length) {
      details.append(element("p", "ah-muted", "No publication record passed the identity threshold."));
    }

    if (view.candidateRecords.length) {
      const candidates = element("section", "ah-record-group ah-record-group--candidates");
      candidates.append(element(
        "div",
        "ah-record-group-title ah-record-group-title--candidates",
        `Search candidates — identity not established (${view.candidateRecords.length})`,
      ));
      for (const record of view.candidateRecords) candidates.append(renderRecord(record, true));
      details.append(candidates);
    }
    if (!view.records.length) details.append(element("p", "ah-muted", "No publication record found."));
    section.append(details);
  }

  function renderHeader() {
    const header = element("header", "ah-header");
    if (state.analysisStatus === "loading") {
      header.append(element("div", "ah-headline", "Checking publication evidence…"));
    } else if (state.analysisStatus === "error") {
      header.append(element("div", "ah-headline", "Metadata lookup unavailable"));
      header.append(element("p", "ah-error", state.analysisError));
    } else {
      const view = panelViewModel(state.analysis ?? {});
      header.append(element("div", "ah-headline", view.headline));
      header.append(element(
        "span",
        `ah-badge ah-badge--${view.verification}`,
        view.verificationLabel,
      ));
      header.append(element("div", "ah-verification-axes", view.verificationAxesLabel));
      if (view.fallbackNotice) header.append(element("p", "ah-muted", view.fallbackNotice));
      if (state.analysis?.staleEvidenceWarning) {
        header.append(element("p", "ah-error", state.analysis.staleEvidenceWarning));
      }
      if (view.cacheLabel) header.append(element("span", "ah-cache", view.cacheLabel));
    }
    if (state.versionNotice) header.append(element("p", "ah-muted", state.versionNotice));
    if (state.versionWarning) header.append(element("p", "ah-error", state.versionWarning));
    const refresh = element("button", "ah-icon-button", "Refresh evidence");
    refresh.type = "button";
    refresh.dataset.focusKey = "refresh";
    refresh.setAttribute("aria-disabled", String(state.analysisStatus === "loading"));
    refresh.addEventListener("click", () => {
      if (state.analysisStatus !== "loading") loadAnalysis(true);
    });
    header.append(refresh);
    return header;
  }

  function renderDownload() {
    const download = element("section", "ah-section");
    download.append(element("div", "ah-section-heading", "PDF filename"));
    const controls = element("div", "ah-download-controls");
    const mode = element("select", "ah-select");
    mode.dataset.focusKey = "filename-mode";
    mode.setAttribute("aria-label", "Filename format");
    for (const [value, label] of [
      ["short", "Short title"],
      ["alias", "Short title + arXiv ID"],
      ["full", "Full title + arXiv ID"],
      ["custom", "Custom"],
    ]) {
      const option = element("option", "", label);
      option.value = value;
      option.selected = state.filenameMode === value;
      mode.append(option);
    }
    mode.addEventListener("change", () => {
      state.filenameMode = mode.value;
      if (mode.value !== "custom") state.filename = buildFilename(viewedPaper, mode.value);
      chrome.storage.sync.set({ filenameMode: mode.value });
      render();
    });
    const filename = element("input", "ah-filename");
    filename.type = "text";
    filename.dataset.focusKey = "filename";
    filename.value = state.filename;
    filename.setAttribute("aria-label", "PDF filename");
    filename.addEventListener("input", () => {
      state.filename = filename.value;
      state.filenameMode = "custom";
      mode.value = "custom";
    });
    const button = element("button", "ah-primary", "Download PDF");
    button.type = "button";
    button.dataset.focusKey = "download";
    button.addEventListener("click", downloadPdf);
    controls.append(mode, filename, button);
    download.append(controls);
    const saveLabel = element("label", "ah-checkbox");
    const saveAs = element("input");
    saveAs.type = "checkbox";
    saveAs.dataset.focusKey = "save-as";
    saveAs.checked = state.saveAs;
    saveAs.addEventListener("change", () => {
      state.saveAs = saveAs.checked;
      chrome.storage.sync.set({ saveAs: saveAs.checked });
    });
    saveLabel.append(saveAs, " Ask where to save");
    download.append(saveLabel);
    const downloadStatus = element("span", "ah-live", state.downloadStatus);
    downloadStatus.setAttribute("aria-live", "polite");
    download.append(downloadStatus);
    return download;
  }

  function render() {
    const summaryFocus = summary.shadow.activeElement?.dataset.focusKey ?? "";
    const detailsFocus = details.shadow.activeElement?.dataset.focusKey ?? "";

    const summaryPanel = element("section", "ah-panel ah-summary-panel");
    summaryPanel.setAttribute("aria-label", "Paper acceptance and PDF download");
    if (state.active) {
      summaryPanel.append(renderHeader(), renderDownload());
    } else {
      const open = element("button", "ah-primary", "Open arXivLens");
      open.type = "button";
      open.dataset.focusKey = "open-arxiv-lens";
      open.addEventListener("click", () => {
        state.active = true;
        render();
        if (state.analysisStatus === "idle") loadAnalysis();
      });
      summaryPanel.append(open);
    }
    summary.app.replaceChildren(summaryPanel);

    const fragment = document.createDocumentFragment();
    const trigger = element("button", "ah-trigger", "Code & evidence");
    trigger.type = "button";
    trigger.dataset.focusKey = "trigger";
    trigger.setAttribute("aria-expanded", String(state.open));
    trigger.setAttribute("aria-controls", "ah-details-panel");
    trigger.append(element("span", "ah-chevron", state.open ? "▲" : "▼"));
    trigger.addEventListener("click", () => {
      state.open = !state.open;
      if (state.open) state.active = true;
      render();
      if (state.open) {
        if (state.analysisStatus === "idle") loadAnalysis();
        if (state.pdfStatus === "idle") loadPdfLinks();
        if (["idle", "error"].includes(state.githubStatus)) searchGitHub();
      }
    });
    fragment.append(trigger);

    if (state.open) {
      const panel = element("section", "ah-panel ah-details-panel");
      panel.id = "ah-details-panel";
      panel.setAttribute("aria-label", "Paper code links and publication evidence");

      const links = element("section", "ah-section");
      renderLinks(links);
      panel.append(links);

      const evidence = element("section", "ah-section");
      const view = panelViewModel(state.analysis ?? {});
      for (const [source, sourceStateValue] of Object.entries(state.analysis?.sources ?? {})) {
        const row = sourceStatus(sourceStateValue, source, () => loadAnalysis(true, true));
        if (row) evidence.append(row);
      }
      if (state.analysis?.cacheWarning) evidence.append(element("p", "ah-error", state.analysis.cacheWarning));
      renderRecords(evidence, view);
      panel.append(evidence);
      fragment.append(panel);
    }
    details.app.replaceChildren(fragment);
    for (const [app, focusKey] of [[summary.app, summaryFocus], [details.app, detailsFocus]]) {
      if (!focusKey) continue;
      [...app.querySelectorAll("[data-focus-key]")]
        .find((item) => item.dataset.focusKey === focusKey)
        ?.focus();
    }
  }

  render();
}

if (globalThis.document && globalThis.chrome?.runtime) {
  mount().catch(() => {});
}
