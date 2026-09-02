function createPdfFilename(title, arxivId) {
  const safeTitle = (title || "paper")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  const idSuffix = arxivId ? ` [arXiv ${arxivId}]` : "";

  return `${safeTitle || "paper"}${idSuffix}.pdf`;
}
