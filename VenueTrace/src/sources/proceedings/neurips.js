function findNeuripsEvidence(records) {
  const url = findOfficialProceedingsUrl(records, [
    "papers.nips.cc",
    "proceedings.neurips.cc",
  ]);
  return url ? { source: "NeurIPS", url } : null;
}

async function searchOfficialNeuripsPaper(paper) {
  if (!Number.isInteger(paper.submittedYear)) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const years = [paper.submittedYear, paper.submittedYear + 1].filter(
    (year) => year <= currentYear,
  );

  for (const year of years) {
    const listUrl = `https://neurips.cc/virtual/${year}/papers.html`;
    const listResponse = await fetch(listUrl);

    if (listResponse.status === 404) {
      continue;
    }

    if (!listResponse.ok) {
      throw new Error(`NeurIPS request failed: ${listResponse.status}`);
    }

    const links = getNeuripsPaperLinks(await listResponse.text(), year);
    const titleMatches = links.filter(
      (link) => normalizeText(link.title) === normalizeText(paper.title),
    );

    for (const match of titleMatches) {
      const pageResponse = await fetch(match.url);

      if (!pageResponse.ok) {
        continue;
      }

      const pageHtml = await pageResponse.text();
      const pageText = htmlToText(pageHtml);
      const authorMatches = paper.authors.some((author) =>
        normalizeText(pageText).includes(normalizeAuthorName(author)),
      );

      if (!authorMatches) {
        continue;
      }

      return {
        source: "NeurIPS",
        venue: "NeurIPS",
        year,
        position: getNeuripsPosition(pageHtml, match.url),
        url: match.url,
      };
    }
  }

  return null;
}

function getNeuripsPaperLinks(html, year) {
  const links = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchor;

  while ((anchor = anchorPattern.exec(html))) {
    const url = new URL(anchor[1], `https://neurips.cc/virtual/${year}/`);

    if (
      url.hostname === "neurips.cc" &&
      url.pathname.startsWith(`/virtual/${year}/`)
    ) {
      links.push({ url: url.href, title: htmlToText(anchor[2]) });
    }
  }

  return links;
}

function htmlToText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNeuripsPosition(pageHtml, pageUrl) {
  const sessionHtml = pageHtml.match(
    /<div\b[^>]*class=["'][^"']*\bsession-info\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  )?.[1];
  const sessionText = sessionHtml ? htmlToText(sessionHtml) : "";

  if (/\bspotlight\b/i.test(sessionText)) {
    return "Spotlight";
  }

  if (/\boral\b/i.test(sessionText)) {
    return "Oral";
  }

  if (/\bposter\b/i.test(sessionText)) {
    return "Poster";
  }

  const pathname = new URL(pageUrl).pathname;

  if (pathname.includes("/oral/")) {
    return "Oral";
  }

  if (pathname.includes("/poster/")) {
    return "Poster";
  }

  return null;
}
