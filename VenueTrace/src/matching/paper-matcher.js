function getDblpAuthors(hit) {
  const authors = hit.info?.authors?.author ?? [];
  const authorList = Array.isArray(authors) ? authors : [authors];

  return authorList
    .map((author) => (typeof author === "string" ? author : author.text))
    .filter(Boolean);
}

function findMatchingPaper(paper, hits) {
  const normalizedTitle = normalizeText(paper.title ?? "");
  const normalizedAuthors = paper.authors.map(normalizeAuthorName);
  const matchingHits = hits.filter((hit) => {
    const titleMatches = normalizeText(hit.info?.title ?? "") === normalizedTitle;
    const dblpAuthors = getDblpAuthors(hit).map(normalizeAuthorName);
    const authorMatches = normalizedAuthors.some((author) =>
      dblpAuthors.includes(author),
    );

    return titleMatches && authorMatches;
  });
  const publishedMatches = matchingHits.filter(
    (hit) =>
      hit.info?.venue && !/^(corr|arxiv)$/i.test(hit.info.venue.trim()),
  );

  return pickPreferredPublication(paper, publishedMatches, (hit) => ({
    year: hit.info?.year,
    conference: /^conf\//i.test(hit.info?.key ?? "") ||
      /conference|proceedings/i.test(hit.info?.type ?? ""),
  })) ?? matchingHits[0] ?? null;
}

function findMatchingOpenReviewPaper(paper, notes) {
  const normalizedTitle = normalizeText(paper.title ?? "");
  const normalizedAuthors = paper.authors.map(normalizeAuthorName);

  return (
    notes.find((note) => {
      const title = getOpenReviewValue(note.content?.title) ?? "";
      const authors = getOpenReviewAuthors(note);
      const titleMatches = normalizeText(title) === normalizedTitle;
      const authorMatches = normalizedAuthors.some((author) =>
        authors.map(normalizeAuthorName).includes(author),
      );

      return titleMatches && authorMatches;
    }) ?? null
  );
}

function findMatchingCrossrefPaper(paper, works) {
  const normalizedTitle = normalizeText(paper.title ?? "");
  const normalizedAuthors = paper.authors.map(normalizeAuthorName);
  const matchingWorks = works.filter((work) => {
    const title = work.title?.[0] ?? "";
    const authors = (work.author ?? []).map((author) =>
      [author.given, author.family].filter(Boolean).join(" "),
    );
    const titleMatches = normalizeText(title) === normalizedTitle;
    const authorMatches = normalizedAuthors.some((author) =>
      authors.map(normalizeAuthorName).includes(author),
    );

    return titleMatches && authorMatches;
  });
  const publishedWorks = matchingWorks.filter(
    (work) => Boolean(work["container-title"]?.[0]),
  );

  return pickPreferredPublication(paper, publishedWorks, (work) => ({
    year: work.published?.["date-parts"]?.[0]?.[0],
    conference: work.type === "proceedings-article" ||
      isConferenceVenue(work["container-title"]?.[0]),
  })) ?? matchingWorks[0] ?? null;
}

function findMatchingOpenAlexPaper(paper, works) {
  const normalizedTitle = normalizeText(paper.title ?? "");
  const normalizedAuthors = paper.authors.map(normalizeAuthorName);
  const matchingWorks = works.filter((work) => {
    const titleMatches = normalizeText(work.title ?? "") === normalizedTitle;
    const authors = (work.authorships ?? [])
      .map((authorship) => authorship.author?.display_name)
      .filter(Boolean);
    const authorMatches = normalizedAuthors.some((author) =>
      authors.map(normalizeAuthorName).includes(author),
    );

    return titleMatches && authorMatches;
  });
  const publishedWorks = matchingWorks.filter((work) =>
    getOpenAlexSourceNames(work).some(isPublicationSource),
  );

  return pickPreferredPublication(paper, publishedWorks, (work) => ({
    year: work.publication_year,
    conference: work.type === "proceedings-article" ||
      (work.locations ?? []).some(
        (location) => location.source?.type === "conference",
      ) || getOpenAlexSourceNames(work).some(isConferenceVenue),
  })) ?? matchingWorks[0] ?? null;
}

function pickPreferredPublication(paper, records, describe) {
  return records
    .map((record, index) => {
      const description = describe(record);
      const year = Number.parseInt(description.year, 10);
      let score = description.conference ? 1000 : 0;

      if (Number.isInteger(year) && Number.isInteger(paper.submittedYear)) {
        const distance = year - paper.submittedYear;
        score += distance >= 0 ? 500 - Math.min(distance, 100) : distance;
      }

      return { record, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]
    ?.record ?? null;
}

function isConferenceVenue(venue) {
  return typeof venue === "string" &&
    /\b(conference|proceedings|cvpr|iccv|eccv|wacv|neurips|nips|icml|iclr|aaai|ijcai|acl|emnlp|naacl|kdd|siggraph|chi|uist)\b/i.test(
      venue,
    );
}

function getOpenAlexSourceNames(work) {
  return [
    work.primary_location?.source?.display_name,
    ...(work.locations ?? []).map(
      (location) => location.source?.display_name,
    ),
  ].filter((source) => typeof source === "string");
}

function isPublicationSource(source) {
  return !/^(arxiv|corr)$|cornell university/i.test(source.trim());
}
