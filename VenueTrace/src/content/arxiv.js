const title = document.querySelector('meta[name="citation_title"]')?.content ?? null;
const authors = [
  ...document.querySelectorAll('meta[name="citation_author"]'),
].map((authorElement) => authorElement.content);
const doi = document.querySelector('meta[name="citation_doi"]')?.content ?? null;
const arxivId =
  document.querySelector('meta[name="citation_arxiv_id"]')?.content ?? null;
const submittedDate =
  document.querySelector('meta[name="citation_date"]')?.content ?? null;
const arxivYearMatch = arxivId?.match(/^(\d{2})\d{2}\./);
const submittedYear = submittedDate
  ? Number.parseInt(submittedDate.slice(0, 4), 10)
  : arxivYearMatch
    ? 2000 + Number.parseInt(arxivYearMatch[1], 10)
    : null;
const pdfUrl =
  document.querySelector('meta[name="citation_pdf_url"]')?.content ??
  (arxivId ? `https://arxiv.org/pdf/${arxivId}` : null);
const projectLinks = findProjectLinks();

const paper = { title, authors, doi, arxivId, submittedYear, projectLinks };
const resultElement = document.createElement("div");
resultElement.className = "venuetrace-result";
resultElement.textContent = "VenueTrace: DBLP에서 검색 중...";

document
  .querySelector("h1.title")
  ?.insertAdjacentElement("afterend", resultElement);

chrome.runtime
  .sendMessage({ type: "PAPER_METADATA", paper })
  .then((response) => {
    console.log("VenueTrace response:", response);

    renderEvidencePanel(
      resultElement,
      response.decision,
      response.repositories ?? [],
      response.repositoryError ?? null,
    );

    if (pdfUrl) {
      renderPdfDownloadButton(resultElement, () =>
        chrome.runtime.sendMessage({
          type: "DOWNLOAD_PDF",
          url: pdfUrl,
          title,
          arxivId,
        }),
      );
    }
  })
  .catch((error) => {
    resultElement.textContent = `VenueTrace: 메시지 오류 (${error.message})`;
  });
