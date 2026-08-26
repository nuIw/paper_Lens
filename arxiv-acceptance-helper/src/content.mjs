import { buildFilename, sanitizeFilename } from "./core.mjs";
import {
  cleanArxivLabel,
  dedupeProjectLinks,
  displayValue,
  formatVenueYear,
  panelViewModel,
  parseArxivId,
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
  return {
    arxivId,
    title,
    authors,
    arxivDoi: arxivDoiUrl.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    publicationDoi: publicationDoiUrl.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    comment: metadataValue(doc, "Comments:"),
    abstract: cleanArxivLabel(doc.querySelector("blockquote.abstract")?.textContent, "Abstract:"),
    year: Number(history.match(/\b(19|20)\d{2}\b/)?.[0]) || null,
    pageUrl: location.href,
    pdfUrl,
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
  return visibleUrls(chunks.join(" "));
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
  });
  const pdf = await loadingTask.promise;
  const links = [];
  try {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const annotations = await page.getAnnotations();
      for (const annotation of annotations) {
        if (annotation.subtype === "Link" && (annotation.url || annotation.unsafeUrl)) {
          links.push({ url: annotation.url ?? annotation.unsafeUrl, source: "pdf-annotation" });
        }
      }
      const text = await page.getTextContent();
      for (const url of visibleUrlsFromItems(text.items)) {
        links.push({ url, source: "pdf-text" });
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

export function collectPageLinks(doc) {
  const selector = ".metatable a[href], blockquote.abstract a[href], .submission-history a[href]";
  return dedupeProjectLinks([...doc.querySelectorAll(selector)].map((anchor) => ({
    url: anchor.href,
    source: "paper-html",
    text: `${anchor.textContent ?? ""} ${anchor.title ?? ""}`,
  })));
}

function sourceStatus(state, source) {
  if (!state) return null;
  const row = element("div", `ah-source ah-source--${state.status}`);
  const label = ({ openreview: "OpenReview", proceedings: "Official proceedings" })[source]
    ?? source.toUpperCase();
  if (state.status === "error") row.textContent = `⚠ ${label}: ${state.error}`;
  else if (state.status === "empty") row.textContent = `— ${label}: no record found`;
  else if (state.warning) row.textContent = `⚠ ${label}: ${state.count} record${state.count === 1 ? "" : "s"} — ${state.warning}`;
  else row.textContent = `✓ ${label}: ${state.count} record${state.count === 1 ? "" : "s"}`;
  if (source === "openreview" && state.manualUrl) {
    row.append(" · ", safeLink(
      state.manualUrl,
      "Verify manually on OpenReview ↗",
      "ah-link",
    ));
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
  const citation = findCitationControl(document);
  if (!citation) return;

  const host = element("div");
  host.id = "arxiv-acceptance-helper";
  const insertionPoint = citation.closest(".bib-cite") ?? citation.parentElement ?? citation;
  insertionPoint.insertAdjacentElement("afterend", host);
  const shadow = host.attachShadow({ mode: "open" });
  const stylesheet = element("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("src/panel.css");
  const app = element("div", "ah-app");
  shadow.append(stylesheet, app);

  let paper;
  try {
    paper = extractPaper(document, location);
  } catch (error) {
    const failure = element("div", "ah-extraction-error", `Acceptance Helper: ${error.message}`);
    app.append(failure);
    return;
  }

  let saved = { filenameMode: "alias", saveAs: true };
  try {
    saved = await chrome.storage.sync.get(saved);
  } catch {
    // The controls remain usable with their native defaults.
  }
  const state = {
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
    filename: buildFilename(paper, saved.filenameMode),
  };

  async function loadAnalysis(refresh = false) {
    state.analysisStatus = "loading";
    state.analysisError = "";
    render();
    const response = await safeRuntimeMessage((message) => chrome.runtime.sendMessage(message), {
      type: refresh ? "REFRESH_PAPER" : "ANALYZE_PAPER",
      paper,
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
      const links = await scanPdfLinks(paper.pdfUrl, pdfjs, (path) => chrome.runtime.getURL(path));
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
    const response = await safeRuntimeMessage(
      (message) => chrome.runtime.sendMessage(message),
      { type: "SEARCH_GITHUB", paper },
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
      pdfUrl: paper.pdfUrl,
      filename,
      saveAs: state.saveAs,
    });
    state.downloadStatus = response?.ok ? "Download started." : (response?.error ?? "Download failed.");
    render();
  }

  function renderLinks(section) {
    const heading = element("div", "ah-section-heading", "Code & project links");
    section.append(heading);
    if (state.links.length) {
      const list = element("ul", "ah-link-list");
      for (const link of state.links) {
        const item = element("li");
        item.append(safeLink(link.url, link.label, "ah-link"));
        item.append(element("span", "ah-evidence", ` · ${link.evidence}`));
        list.append(item);
      }
      section.append(list);
    } else {
      section.append(element("p", "ah-muted", "No direct code or project link found yet."));
    }
    if (state.pdfStatus === "loading") section.append(element("p", "ah-progress", "Scanning PDF links…"));
    if (state.pdfStatus === "error") section.append(element("p", "ah-error", `PDF scan: ${state.pdfError}`));

    const search = element("button", "ah-secondary", state.githubStatus === "loading" ? "Searching GitHub…" : "GitHub additional search");
    search.type = "button";
    search.dataset.focusKey = "github-search";
    search.setAttribute("aria-disabled", String(state.githubStatus === "loading"));
    search.addEventListener("click", () => {
      if (state.githubStatus !== "loading") searchGitHub();
    });
    section.append(search);

    if (state.githubStatus === "error") section.append(element("p", "ah-error", state.githubError));
    if (state.github?.candidates?.length) {
      const label = element("p", "ah-candidate-label", "Search candidates — not verified as official code");
      section.append(label);
      const list = element("ul", "ah-github-list");
      for (const candidate of state.github.candidates) {
        const item = element("li", "ah-github-item");
        item.append(safeLink(candidate.url, candidate.name, "ah-link"));
        const updated = candidate.updatedAt ? `updated ${candidate.updatedAt.slice(0, 10)}` : "";
        const detail = [candidate.description, `★ ${candidate.stars}`, updated].filter(Boolean).join(" · ");
        if (detail) item.append(element("span", "ah-evidence", detail));
        list.append(item);
      }
      section.append(list);
    }
    if (state.github?.manualUrl) {
      section.append(safeLink(state.github.manualUrl, "Open manual GitHub search ↗", "ah-manual-link"));
    }
  }

  function renderRecords(section, view) {
    const details = element("details", "ah-records");
    const summary = element("summary", "ah-record-summary", `All records & evidence (${view.records.length})`);
    details.append(summary);
    for (const record of view.records) {
      const item = element("article", `ah-record ah-record--${record.confidence}`);
      const venue = formatVenueYear(record.venueRaw || "Unknown venue", record.year);
      item.append(element("div", "ah-record-title", `${venue} · ${displayValue(record.decision)}`));
      const facts = [
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
      evidence.append(element("span", "", `${record.source ?? "metadata"} · ${matchKind} · match ${Math.round((record.matchScore ?? 1) * 100)}%`));
      if (record.sourceUrl) evidence.append(" · ", safeLink(record.sourceUrl, "source ↗", "ah-link"));
      item.append(evidence);
      details.append(item);
    }
    if (!view.records.length) details.append(element("p", "ah-muted", "No publication record found."));
    section.append(details);
  }

  function render() {
    const focusKey = shadow.activeElement?.dataset.focusKey ?? "";
    const fragment = document.createDocumentFragment();
    const trigger = element("button", "ah-trigger", "Acceptance · Code · Download");
    trigger.type = "button";
    trigger.dataset.focusKey = "trigger";
    trigger.setAttribute("aria-expanded", String(state.open));
    trigger.setAttribute("aria-controls", "ah-panel");
    trigger.append(element("span", "ah-chevron", state.open ? "▲" : "▼"));
    trigger.addEventListener("click", () => {
      state.open = !state.open;
      render();
      if (state.open && state.analysisStatus === "idle") {
        loadAnalysis();
        loadPdfLinks();
      }
    });
    fragment.append(trigger);

    if (state.open) {
      const panel = element("section", "ah-panel");
      panel.id = "ah-panel";
      panel.setAttribute("aria-label", "Paper acceptance, code, and download details");

      const header = element("header", "ah-header");
      if (state.analysisStatus === "loading") {
        header.append(element("div", "ah-headline", "Checking publication evidence…"));
      } else if (state.analysisStatus === "error") {
        header.append(element("div", "ah-headline", "Metadata lookup unavailable"));
        header.append(element("p", "ah-error", state.analysisError));
      } else {
        const view = panelViewModel(state.analysis ?? {});
        header.append(element("div", "ah-headline", view.headline));
        const badge = element("span", `ah-badge ah-badge--${view.verification}`, view.verificationLabel);
        header.append(badge);
        header.append(element("div", "ah-verification-axes", view.verificationAxesLabel));
        if (view.cacheLabel) header.append(element("span", "ah-cache", view.cacheLabel));
      }
      const refresh = element("button", "ah-icon-button", "Refresh evidence");
      refresh.type = "button";
      refresh.dataset.focusKey = "refresh";
      refresh.setAttribute("aria-disabled", String(state.analysisStatus === "loading"));
      refresh.addEventListener("click", () => {
        if (state.analysisStatus !== "loading") loadAnalysis(true);
      });
      header.append(refresh);
      panel.append(header);

      const download = element("section", "ah-section");
      download.append(element("div", "ah-section-heading", "PDF filename"));
      const controls = element("div", "ah-download-controls");
      const mode = element("select", "ah-select");
      mode.dataset.focusKey = "filename-mode";
      mode.setAttribute("aria-label", "Filename format");
      for (const [value, label] of [
        ["alias", "Short title + arXiv ID"],
        ["full", "Full title + arXiv ID"],
        ["id", "arXiv ID only"],
        ["custom", "Custom"],
      ]) {
        const option = element("option", "", label);
        option.value = value;
        option.selected = state.filenameMode === value;
        mode.append(option);
      }
      mode.addEventListener("change", () => {
        state.filenameMode = mode.value;
        if (mode.value !== "custom") state.filename = buildFilename(paper, mode.value);
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
      panel.append(download);

      const links = element("section", "ah-section");
      renderLinks(links);
      panel.append(links);

      const evidence = element("section", "ah-section");
      const view = panelViewModel(state.analysis ?? {});
      for (const [source, sourceStateValue] of Object.entries(state.analysis?.sources ?? {})) {
        const row = sourceStatus(sourceStateValue, source);
        if (row) evidence.append(row);
      }
      if (state.analysis?.cacheWarning) evidence.append(element("p", "ah-error", state.analysis.cacheWarning));
      renderRecords(evidence, view);
      panel.append(evidence);
      fragment.append(panel);
    }
    app.replaceChildren(fragment);
    if (focusKey) {
      const replacement = [...app.querySelectorAll("[data-focus-key]")]
        .find((item) => item.dataset.focusKey === focusKey);
      replacement?.focus();
    }
  }

  render();
}

if (globalThis.document && globalThis.chrome?.runtime) {
  mount().catch(() => {});
}
