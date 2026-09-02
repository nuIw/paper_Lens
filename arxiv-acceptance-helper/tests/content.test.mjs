import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  collectPageLinks,
  extractPaper,
  placePanelHosts,
  resolveAnalysisPaper,
  scanPdfLinks,
} from "../src/content.mjs";

function node(textContent = "", href = "") {
  return { textContent, href };
}

test("summary and details hosts use the title and bottom of Bookmark boundaries", () => {
  const placements = [];
  const title = { insertAdjacentElement: (position, host) => placements.push(["title", position, host]) };
  const bookmark = { insertAdjacentElement: (position, host) => placements.push(["bookmark", position, host]) };
  const summaryHost = { id: "summary" };
  const detailsHost = { id: "details" };
  const doc = {
    querySelector: (selector) => ({ "h1.title": title, ".bookmarks": bookmark })[selector] ?? null,
    querySelectorAll: () => [],
  };

  assert.equal(placePanelHosts(doc, summaryHost, detailsHost), true);
  assert.deepEqual(placements, [
    ["title", "afterend", summaryHost],
    ["bookmark", "afterend", detailsHost],
  ]);
});

test("extracts required metadata from the arXiv abstract page contract", () => {
  const rows = [
    { querySelectorAll: () => [node("Comments:"), node("Accepted at ExampleConf")] },
  ];
  const selectors = new Map([
    ["h1.title", node("Title: A Small Paper")],
    ["blockquote.abstract", node("Abstract: Short abstract")],
    [".download-pdf a, a[href*='/pdf/']", node("PDF", "https://arxiv.org/pdf/hep-th/9901001v2")],
    ["a[href^='https://doi.org/']", node("doi", "https://doi.org/10.1000/XYZ")],
    [".submission-history", node("Submission history [v1] Mon, 4 Jan 1999")],
  ]);
  const doc = {
    querySelector: (selector) => selectors.get(selector) ?? null,
    querySelectorAll: (selector) => {
      if (selector === ".authors a") return [node("Alice Kim"), node("Bob Lee")];
      if (selector === ".metatable tr") return rows;
      if (selector === "a[href^='https://doi.org/']") return [node("doi", "https://doi.org/10.1000/XYZ")];
      return [];
    },
  };
  const paper = extractPaper(doc, {
    pathname: "/abs/hep-th/9901001v2",
    href: "https://arxiv.org/abs/hep-th/9901001v2",
  });
  assert.deepEqual(paper, {
    arxivId: "hep-th/9901001",
    title: "A Small Paper",
    authors: ["Alice Kim", "Bob Lee"],
    arxivDoi: "",
    publicationDoi: "10.1000/XYZ",
    comment: "Accepted at ExampleConf",
    abstract: "Short abstract",
    year: 1999,
    viewedVersion: 2,
    latestVersion: 2,
    pageUrl: "https://arxiv.org/abs/hep-th/9901001v2",
    pdfUrl: "https://arxiv.org/pdf/hep-th/9901001v2",
  });
});

function versionedDoc({ title, authors, comment, pdfUrl, history }) {
  const rows = [{ querySelectorAll: () => [node("Comments:"), node(comment)] }];
  return {
    querySelector: (selector) => ({
      "h1.title": node(`Title: ${title}`),
      "blockquote.abstract": node("Abstract: Paper abstract"),
      ".download-pdf a, a[href*='/pdf/']": node("PDF", pdfUrl),
      ".submission-history": node(history),
    })[selector] ?? null,
    querySelectorAll: (selector) => {
      if (selector === ".authors a") return authors.map((author) => node(author));
      if (selector === ".metatable tr") return rows;
      return [];
    },
  };
}

test("an older abstract page resolves latest metadata while retaining one viewed-version alias", async () => {
  const history = "[v1] Sat, 18 Mar 2023 [v2] Wed, 20 Dec 2023";
  const viewed = extractPaper(versionedDoc({
    title: "Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
    authors: ["Qingru Zhang", "Minshuo Chen"],
    comment: "Submitted to ICLR",
    pdfUrl: "https://arxiv.org/pdf/2303.10512v1",
    history,
  }), {
    pathname: "/abs/2303.10512v1",
    href: "https://arxiv.org/abs/2303.10512v1",
  });
  const latestDoc = versionedDoc({
    title: "AdaLoRA: Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
    authors: ["Qingru Zhang", "Minshuo Chen", "Nikos Karampatziakis"],
    comment: "Accepted at ICLR 2023 as a poster",
    pdfUrl: "https://arxiv.org/pdf/2303.10512v2",
    history,
  });
  let requested = "";
  const result = await resolveAnalysisPaper(
    viewed,
    async (url, options) => {
      requested = url;
      assert.equal(options.cache, "no-store");
      return { ok: true, text: async () => "latest" };
    },
    () => latestDoc,
  );

  assert.equal(requested, "https://arxiv.org/abs/2303.10512");
  assert.equal(result.paper.title.startsWith("AdaLoRA:"), true);
  assert.equal(result.paper.comment, "Accepted at ICLR 2023 as a poster");
  assert.equal(result.paper.metadataVersion, 2);
  assert.equal(result.paper.metadataAliases[0].version, 1);
  assert.equal(result.paper.metadataAliases[0].title, viewed.title);
  assert.equal(result.warning, "");
});

test("a latest-metadata failure suppresses an older arXiv comment", async () => {
  const viewed = {
    arxivId: "2501.00001",
    title: "Paper",
    authors: ["Alice Kim"],
    comment: "Accepted at ICLR 2025",
    year: 2025,
    viewedVersion: 1,
    latestVersion: 2,
    pageUrl: "https://arxiv.org/abs/2501.00001v1",
    pdfUrl: "https://arxiv.org/pdf/2501.00001v1",
  };
  const result = await resolveAnalysisPaper(viewed, async () => ({ ok: false, status: 503 }));
  assert.equal(result.paper.comment, "");
  assert.equal(result.paper.metadataVersion, 1);
  assert.match(result.warning, /older comment was not used/);
});

test("the latest abstract page retains bounded historical metadata aliases", async () => {
  const history = "[v1] Sat, 18 Mar 2023 [v2] Wed, 20 Dec 2023";
  const viewed = extractPaper(versionedDoc({
    title: "AdaLoRA: Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
    authors: ["Qingru Zhang", "Nikos Karampatziakis"],
    comment: "The 11th International Conference on Learning Representations (ICLR 2023)",
    pdfUrl: "https://arxiv.org/pdf/2303.10512v2",
    history,
  }), {
    pathname: "/abs/2303.10512v2",
    href: "https://arxiv.org/abs/2303.10512v2",
  });
  const v1 = versionedDoc({
    title: "Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
    authors: ["Qingru Zhang"],
    comment: viewed.comment,
    pdfUrl: "https://arxiv.org/pdf/2303.10512v1",
    history,
  });
  const requested = [];
  const result = await resolveAnalysisPaper(
    viewed,
    async (url) => {
      requested.push(url);
      return { ok: true, text: async () => "v1" };
    },
    () => v1,
  );
  assert.deepEqual(requested, ["https://arxiv.org/abs/2303.10512v1"]);
  assert.equal(result.paper.metadataVersion, 2);
  assert.deepEqual(result.paper.metadataAliases, [{
    title: "Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
    authors: ["Qingru Zhang"],
    year: 2023,
    version: 1,
  }]);
});

test("historical alias failure is visible but does not suppress the latest comment", async () => {
  const history = "[v1] Sat, 18 Mar 2023 [v2] Wed, 20 Dec 2023";
  const viewed = extractPaper(versionedDoc({
    title: "AdaLoRA: Adaptive Budget Allocation for Parameter-Efficient Fine-Tuning",
    authors: ["Qingru Zhang", "Nikos Karampatziakis"],
    comment: "The 11th International Conference on Learning Representations (ICLR 2023)",
    pdfUrl: "https://arxiv.org/pdf/2303.10512v2",
    history,
  }), {
    pathname: "/abs/2303.10512v2",
    href: "https://arxiv.org/abs/2303.10512v2",
  });

  const result = await resolveAnalysisPaper(viewed, async () => ({ ok: false, status: 503 }));
  assert.equal(result.paper.comment, viewed.comment);
  assert.deepEqual(result.paper.metadataAliases, []);
  assert.match(result.warning, /v1.*title-alias search may be incomplete/);
});

test("many-version papers sample the first and penultimate metadata without scanning every version", async () => {
  const history = "[v1] 2021 [v2] 2022 [v3] 2023 [v4] 2024";
  const makeDoc = (version, title) => versionedDoc({
    title,
    authors: ["Alice Kim"],
    comment: "Accepted at ICLR 2024",
    pdfUrl: `https://arxiv.org/pdf/2501.00001v${version}`,
    history,
  });
  const viewed = extractPaper(makeDoc(4, "Final Title"), {
    pathname: "/abs/2501.00001v4",
    href: "https://arxiv.org/abs/2501.00001v4",
  });
  const docs = { v1: makeDoc(1, "Original Title"), v3: makeDoc(3, "Publication Title") };
  const requested = [];
  const result = await resolveAnalysisPaper(
    viewed,
    async (url) => {
      const version = url.match(/v\d+$/)?.[0];
      requested.push(url);
      return { ok: true, text: async () => version };
    },
    (version) => docs[version],
  );

  assert.deepEqual(requested, [
    "https://arxiv.org/abs/2501.00001v1",
    "https://arxiv.org/abs/2501.00001v3",
  ]);
  assert.deepEqual(result.paper.metadataAliases.map((alias) => [alias.version, alias.title]), [
    [1, "Original Title"],
    [3, "Publication Title"],
  ]);
});

test("arXiv DataCite DOI and publication DOI remain separate", () => {
  const doc = {
    querySelector: (selector) => ({
      "h1.title": node("Title: Paper"),
      ".download-pdf a, a[href*='/pdf/']": node("PDF", "https://arxiv.org/pdf/1706.03762"),
    })[selector] ?? null,
    querySelectorAll: (selector) => {
      if (selector === "a[href^='https://doi.org/']") return [
        node("arXiv DOI", "https://doi.org/10.48550/arXiv.1706.03762"),
        node("Related DOI", "https://doi.org/10.5555/publisher"),
      ];
      if (selector === ".authors a") return [node("Alice Kim")];
      return [];
    },
  };
  const extracted = extractPaper(doc, {
    pathname: "/abs/1706.03762",
    href: "https://arxiv.org/abs/1706.03762",
  });
  assert.equal(extracted.arxivDoi, "10.48550/arXiv.1706.03762");
  assert.equal(extracted.publicationDoi, "10.5555/publisher");
});

test("page-link collection stays inside paper-specific metadata regions", () => {
  let requestedSelector = "";
  const doc = {
    querySelectorAll: (selector) => {
      requestedSelector = selector;
      if (selector === "a[href]") return [node("Hugging Face", "https://huggingface.co/arxiv")];
      return [{
        href: "https://github.com/org/paper",
        textContent: "Code",
        title: "",
      }];
    },
  };
  const links = collectPageLinks(doc);
  assert.match(requestedSelector, /\.metatable/);
  assert.notEqual(requestedSelector, "a[href]");
  assert.deepEqual(links.map((link) => link.url), ["https://github.com/org/paper"]);
});

test("visible project URLs in Comments are collected even without anchor markup", () => {
  const doc = {
    querySelectorAll: (selector) => {
      if (selector.includes("a[href]")) return [];
      return [{ textContent: "Project page: https://authors.github.io/paper" }];
    },
  };
  const links = collectPageLinks(doc);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://authors.github.io/paper");
  assert.equal(links[0].source, "paper-text");
  assert.equal(links[0].evidence, "arXiv page visible text");
});

test("arXiv extraction refuses to query APIs when required metadata is missing", () => {
  const doc = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  assert.throws(
    () => extractPaper(doc, { pathname: "/abs/1706.03762", href: "https://arxiv.org/abs/1706.03762" }),
    /Could not read the arXiv paper metadata/,
  );
});

test("arXiv extraction refuses title-only matching when authors are missing", () => {
  const doc = {
    querySelector: (selector) => ({
      "h1.title": node("Title: Paper"),
      ".download-pdf a, a[href*='/pdf/']": node("PDF", "https://arxiv.org/pdf/1706.03762"),
    })[selector] ?? null,
    querySelectorAll: () => [],
  };
  assert.throws(
    () => extractPaper(doc, { pathname: "/abs/1706.03762", href: "https://arxiv.org/abs/1706.03762" }),
    /Could not read the arXiv paper metadata/,
  );
});

test("PDF scan reads annotations first and visible-text URLs as lower evidence", async () => {
  let destroyed = false;
  const pages = [
    {
      getAnnotations: async () => [{ subtype: "Link", url: "https://github.com/org/repo#readme" }],
      getTextContent: async () => ({ items: [{ str: "doi https://doi.org/10.1/nope" }] }),
    },
    {
      getAnnotations: async () => [],
      getTextContent: async () => ({ items: [
        { str: "Model: https://huggingface.co/org/" },
        { str: "model)." },
      ] }),
    },
  ];
  const pdf = {
    numPages: pages.length,
    getPage: async (number) => pages[number - 1],
    destroy: async () => { destroyed = true; },
  };
  const pdfjs = {
    GlobalWorkerOptions: {},
    getDocument: ({ data, docBaseUrl, disableFontFace, isEvalSupported }) => {
      assert.ok(data instanceof Uint8Array);
      assert.equal(docBaseUrl, "https://arxiv.org/pdf/1706.03762");
      assert.equal(disableFontFace, true);
      assert.equal(isEvalSupported, false);
      return { promise: Promise.resolve(pdf) };
    },
  };
  const links = await scanPdfLinks(
    "https://arxiv.org/pdf/1706.03762",
    pdfjs,
    (path) => `chrome-extension://id/${path}`,
    async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    },
  );
  assert.deepEqual(links.map(({ url, source }) => ({ url, source })), [
    { url: "https://github.com/org/repo", source: "pdf-annotation" },
    { url: "https://huggingface.co/org/model", source: "pdf-text" },
  ]);
  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "chrome-extension://id/vendor/pdf.worker.mjs");
  assert.equal(destroyed, true);
});

test("PDF scan separates implementation links from links after the References heading", async () => {
  const pages = [
    {
      getAnnotations: async () => [],
      getTextContent: async () => ({ items: [{ str: "Code repository: https://github.com/org/current" }] }),
    },
    {
      getAnnotations: async () => [{ subtype: "Link", url: "https://github.com/org/cited" }],
      getTextContent: async () => ({ items: [
        { str: "References", hasEOL: true },
        { str: "Related work" },
      ] }),
    },
  ];
  const pdfjs = {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (number) => pages[number - 1],
      destroy: async () => {},
    }) }),
  };
  const links = await scanPdfLinks(
    "https://arxiv.org/pdf/1706.03762",
    pdfjs,
    (path) => path,
    async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
  );
  assert.deepEqual(links.map(({ url, page, section, classification }) => ({
    url, page, section, classification,
  })), [
    {
      url: "https://github.com/org/current",
      page: 1,
      section: "body",
      classification: "paperProjectLink",
    },
    {
      url: "https://github.com/org/cited",
      page: 2,
      section: "references",
      classification: "citationProjectLink",
    },
  ]);
});

test("PDF scan reports fetch errors without constructing a document", async () => {
  let called = false;
  const pdfjs = { GlobalWorkerOptions: {}, getDocument: () => { called = true; } };
  await assert.rejects(
    scanPdfLinks("https://arxiv.org/pdf/1706.03762", pdfjs, (path) => path, async () => ({ ok: false, status: 503 })),
    /PDF download failed: HTTP 503/,
  );
  assert.equal(called, false);
});

test("PDF scan timeout remains active while the response body is read", async () => {
  const pdfjs = { GlobalWorkerOptions: {}, getDocument: () => { throw new Error("unexpected parse"); } };
  const scan = scanPdfLinks(
    "https://arxiv.org/pdf/1706.03762",
    pdfjs,
    (path) => path,
    async (_url, { signal }) => ({
      ok: true,
      arrayBuffer: () => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
      }),
    }),
    5,
  );
  await assert.rejects(
    Promise.race([
      scan,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("scan did not time out")), 100)),
    ]),
    /Timed out/,
  );
});

test("PDF text items do not invent a longer URL from the following word", async () => {
  const pdf = {
    numPages: 1,
    getPage: async () => ({
      getAnnotations: async () => [],
      getTextContent: async () => ({ items: [
        { str: "https://github.com/org/repo" },
        { str: "Next" },
      ] }),
    }),
    destroy: async () => {},
  };
  const pdfjs = {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve(pdf) }),
  };
  const links = await scanPdfLinks(
    "https://arxiv.org/pdf/1706.03762",
    pdfjs,
    (path) => path,
    async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
  );
  assert.deepEqual(links.map((link) => link.url), ["https://github.com/org/repo"]);
});

test("runtime message failures become ordinary error responses", async () => {
  const { safeRuntimeMessage } = await import("../src/content.mjs");
  assert.deepEqual(
    await safeRuntimeMessage(async (message) => ({ ok: true, data: message.type }), { type: "ANALYZE_PAPER" }),
    { ok: true, data: "ANALYZE_PAPER" },
  );
  assert.deepEqual(
    await safeRuntimeMessage(async () => { throw new Error("worker stopped"); }, { type: "ANALYZE_PAPER" }),
    { ok: false, error: "worker stopped" },
  );
});

test("async action controls stay focusable while marked busy", async () => {
  const source = await readFile(new URL("../src/content.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:search|refresh)\.disabled\s*=/);
  assert.match(source, /refresh\.setAttribute\("aria-disabled"/);
});

test("OpenReview source status renders its manual challenge verification link", async () => {
  const source = await readFile(new URL("../src/content.mjs", import.meta.url), "utf8");
  assert.match(source, /state\.manualUrl/);
  assert.match(source, /Verify manually on OpenReview/);
  assert.match(source, /forum linked by/);
  assert.match(source, /API verification blocked/);
  assert.match(source, /Retry with OpenReview session/);
  assert.match(source, /openReviewSession: true/);
  assert.match(source, /staleEvidenceWarning/);
});

test("GitHub candidates render as abstract groups without ranking evidence", async () => {
  const source = await readFile(new URL("../src/content.mjs", import.meta.url), "utf8");
  assert.match(source, /Likely implementation/);
  assert.match(source, /Possible match/);
  assert.match(source, /Low relevance \/ reference-only/);
  assert.match(source, /likely\.slice\(0, 3\)/);
  assert.doesNotMatch(source, /candidate\.relevance/);
});

test("record UI keeps low-identity results visible but separate from matched evidence", async () => {
  const source = await readFile(new URL("../src/content.mjs", import.meta.url), "utf8");
  assert.match(source, /Matched publication evidence/);
  assert.match(source, /Search candidates — identity not established/);
  assert.match(source, /Candidate publication record/);
  assert.match(source, /source state not applied to the paper/);
  assert.match(source, /identity match/);
  assert.match(source, /search candidate/);
  assert.match(source, /fallbackNotice/);
});

test("arXivLens stays idle until its controls are opened", async () => {
  const source = await readFile(new URL("../src/content.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/panel.css", import.meta.url), "utf8");
  assert.match(source, /Open arXivLens/);
  assert.match(source, /summaryPanel\.append\(renderHeader\(\), renderDownload\(\)\)/);
  assert.match(source, /Code & evidence/);
  assert.match(source, /REQUEST_GITHUB_ACCESS/);
  assert.match(source, /loadPdfLinks\(\)/);
  assert.match(source, /searchGitHub\(\)/);
  assert.doesNotMatch(source, /GitHub additional search/);
  assert.doesNotMatch(source, /render\(\);\s*loadAnalysis\(\);\s*\}/);
  assert.match(source, /\.bookmarks/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 0\.8fr\) minmax\(0, 2fr\) auto/);
  assert.match(css, /:host\(\.ah-details-host\) \.ah-trigger/);
  assert.match(source, /const titleRow = element\("div", "ah-title-row"\)/);
  assert.match(css, /\.ah-title-row\s*\{[^}]*display:\s*flex/s);
});
