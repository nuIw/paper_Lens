importScripts("../config.local.js");
importScripts("../sources/dblp.js");
importScripts("../sources/openreview.js");
importScripts("../sources/crossref.js");
importScripts("../sources/openalex.js");
importScripts("../matching/normalize.js");
importScripts("../matching/paper-matcher.js");
importScripts("../sources/proceedings/pmlr.js");
importScripts("../sources/proceedings/neurips.js");
importScripts("../sources/proceedings/cvf.js");
importScripts("../sources/proceedings/acl.js");
importScripts("../decision/confidence.js");
importScripts("../decision/classify.js");
importScripts("../download/filename.js");
importScripts("../code-links/github.js");

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PAPER_METADATA") {
    return collectSourceResults(message.paper);
  }

  if (message.type === "DOWNLOAD_PDF") {
    return downloadArxivPdf(message);
  }
});

async function downloadArxivPdf({ url, title, arxivId }) {
  const pdfUrl = new URL(url);
  const isArxivPdf =
    pdfUrl.protocol === "https:" &&
    pdfUrl.hostname === "arxiv.org" &&
    pdfUrl.pathname.startsWith("/pdf/");

  if (!isArxivPdf) {
    throw new Error("Only arXiv PDF URLs are allowed.");
  }

  const downloadId = await chrome.downloads.download({
    url: pdfUrl.href,
    filename: createPdfFilename(title, arxivId),
    saveAs: true,
  });

  return { downloadStarted: true, downloadId };
}

async function collectSourceResults(paper) {
  const result = { received: true };
  console.log("VenueTrace received:", paper);

  try {
    const data = await searchDblp(paper.title);
    const hits = getDblpHits(data);
    result.dblpHitCount = hits.length;
    result.match = findMatchingPaper(paper, hits);
    console.log("DBLP result:", { hits, match: result.match });
  } catch (error) {
    result.dblpError = error.message;
    console.error("DBLP request error:", error);
  }

  try {
    const data = await searchOpenReview(paper.title);
    const notes = getOpenReviewNotes(data);
    result.openReviewHitCount = notes.length;
    result.openReviewMatch = findMatchingOpenReviewPaper(paper, notes);
    console.log("OpenReview result:", {
      notes,
      match: result.openReviewMatch,
    });
  } catch (error) {
    result.openReviewError = error.message;
    console.error("OpenReview request error:", error);
  }

  try {
    const data = await searchCrossref(paper.title);
    const works = getCrossrefWorks(data);
    result.crossrefHitCount = works.length;
    result.crossrefMatch = findMatchingCrossrefPaper(paper, works);
    console.log("Crossref result:", { works, match: result.crossrefMatch });
  } catch (error) {
    result.crossrefError = error.message;
    console.error("Crossref request error:", error);
  }

  const openAlexApiKey = globalThis.VENUETRACE_CONFIG.openAlexApiKey;

  if (!openAlexApiKey) {
    result.openAlexError = "OpenAlex API key is not configured.";
    console.warn(result.openAlexError);
  } else {
    try {
      const data = await searchOpenAlex(paper.title, openAlexApiKey);
      const works = getOpenAlexWorks(data);
      result.openAlexHitCount = works.length;
      result.openAlexMatch = findMatchingOpenAlexPaper(paper, works);
      console.log("OpenAlex result:", { works, match: result.openAlexMatch });
    } catch (error) {
      result.openAlexError = error.message;
      console.error("OpenAlex request error:", error);
    }
  }

  const matchedRecords = {
    dblp: result.match,
    crossref: result.crossrefMatch,
    openAlex: result.openAlexMatch,
  };

  let officialNeuripsPaper = null;
  let officialCvfPaper = null;

  try {
    officialNeuripsPaper = await searchOfficialNeuripsPaper(paper);
    console.log("Official NeurIPS result:", officialNeuripsPaper);
  } catch (error) {
    result.neuripsError = error.message;
    console.error("NeurIPS request error:", error);
  }

  try {
    officialCvfPaper = await searchOfficialCvfPaper(paper, matchedRecords);
    console.log("Official CVF result:", officialCvfPaper);
  } catch (error) {
    result.cvfError = error.message;
    console.error("CVF request error:", error);
  }

  result.proceedings = [
    findPmlrEvidence(matchedRecords),
    officialNeuripsPaper ?? findNeuripsEvidence(matchedRecords),
    officialCvfPaper,
    findAclEvidence(matchedRecords),
  ].filter(Boolean);

  console.log("Proceedings evidence:", result.proceedings);

  result.decision = integrateEvidence(result);
  console.log("Integrated evidence:", result.decision);

  try {
    result.repositories = await findRepositoryEvidence(paper);
    console.log("Repository evidence:", result.repositories);
  } catch (error) {
    result.repositoryError = error.message;
    console.error("Repository lookup error:", error);
  }
  return result;
}
