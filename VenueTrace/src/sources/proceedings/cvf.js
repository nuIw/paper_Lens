function findCvfEvidence(records) {
  const url = findOfficialProceedingsUrl(records, ["openaccess.thecvf.com"]);
  return url ? { source: "CVF", url, ...getCvfVenueDetails(url) } : null;
}

async function searchOfficialCvfPaper(paper, records) {
  const linkedEvidence = findCvfEvidence(records);

  if (linkedEvidence) {
    return linkedEvidence;
  }

  const crossref = records.crossref;
  const containerTitle = crossref?.["container-title"]?.[0] ?? "";
  const venue = containerTitle.match(/\b(CVPR|ICCV|WACV)\b/i)?.[1]?.toUpperCase();
  const year = crossref?.published?.["date-parts"]?.[0]?.[0];

  if (!venue || !Number.isInteger(year)) {
    return null;
  }

  for (const url of buildCvfCandidateUrls(paper, crossref, venue, year)) {
    const response = await fetch(url);

    if (!response.ok) {
      continue;
    }

    const pageText = htmlToText(await response.text());
    const titleMatches = normalizeText(pageText).includes(
      normalizeText(paper.title),
    );
    const authorMatches = paper.authors.some((author) =>
      normalizeText(pageText).includes(normalizeAuthorName(author)),
    );

    if (titleMatches && authorMatches) {
      return { source: "CVF", venue, year, url };
    }
  }

  return null;
}

function buildCvfCandidateUrls(paper, crossref, venue, year) {
  const firstAuthor = crossref.author?.[0]?.family ??
    paper.authors?.[0]?.trim().split(/\s+/).at(-1);

  if (!firstAuthor || !paper.title) {
    return [];
  }

  const authorSlug = toCvfSlug(firstAuthor);
  const titleSlug = toCvfSlug(paper.title);
  const filename = `${authorSlug}_${titleSlug}_${venue}_${year}_paper.html`;

  return [
    `https://openaccess.thecvf.com/content_${venue}_${year}/html/${filename}`,
    `https://openaccess.thecvf.com/content/${venue}${year}/html/${filename}`,
  ];
}

function toCvfSlug(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function getCvfVenueDetails(url) {
  const match = new URL(url).pathname.match(
    /(?:content_|content\/)(CVPR|ICCV|WACV)_?(20\d{2})/i,
  );

  return match
    ? { venue: match[1].toUpperCase(), year: Number.parseInt(match[2], 10) }
    : {};
}
