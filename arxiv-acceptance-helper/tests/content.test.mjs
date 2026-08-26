import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { collectPageLinks, extractPaper, scanPdfLinks } from "../src/content.mjs";

function node(textContent = "", href = "") {
  return { textContent, href };
}

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
    pageUrl: "https://arxiv.org/abs/hep-th/9901001v2",
    pdfUrl: "https://arxiv.org/pdf/hep-th/9901001v2",
  });
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
    getDocument: ({ data, docBaseUrl }) => {
      assert.ok(data instanceof Uint8Array);
      assert.equal(docBaseUrl, "https://arxiv.org/pdf/1706.03762");
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
  assert.match(source, /search\.setAttribute\("aria-disabled"/);
  assert.match(source, /refresh\.setAttribute\("aria-disabled"/);
});

test("OpenReview source status renders its manual challenge verification link", async () => {
  const source = await readFile(new URL("../src/content.mjs", import.meta.url), "utf8");
  assert.match(source, /state\.manualUrl/);
  assert.match(source, /Verify manually on OpenReview/);
});
