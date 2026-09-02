function integrateEvidence(result) {
  const evidence = [];
  const errors = [
    ["DBLP", result.dblpError],
    ["OpenReview", result.openReviewError],
    ["Crossref", result.crossrefError],
    ["OpenAlex", result.openAlexError],
    ["NeurIPS", result.neuripsError],
    ["CVF", result.cvfError],
  ]
    .filter(([, error]) => Boolean(error))
    .map(([source, message]) => ({ source, message }));

  if (result.match) {
    const dblpUrl = result.match.info?.url;
    const dblpKey = result.match.info?.key;

    evidence.push({
      source: "DBLP",
      venue: normalizePublicationVenue(result.match.info?.venue),
      year: result.match.info?.year ?? null,
      url: dblpUrl ?? (dblpKey ? `https://dblp.org/rec/${dblpKey}` : null),
      official: false,
      kind: normalizePublicationVenue(result.match.info?.venue)
        ? "publication"
        : "metadata",
      publicationType: /^conf\//i.test(dblpKey ?? "") ? "conference" : "journal",
    });
  }

  if (result.openReviewMatch) {
    const openReviewVenue =
      getOpenReviewValue(result.openReviewMatch.content?.venue) ??
      getOpenReviewValue(result.openReviewMatch.content?.venueid);
    const officialDecision = parseOfficialOpenReviewVenue(
      result.openReviewMatch,
      openReviewVenue,
    );

    evidence.push({
      source: "OpenReview",
      venue: officialDecision?.venue ?? openReviewVenue ?? null,
      year: officialDecision?.year ?? null,
      position: officialDecision?.position ?? null,
      url: `https://openreview.net/forum?id=${result.openReviewMatch.forum}`,
      official: Boolean(officialDecision),
      kind: officialDecision ? "official_decision" : "submission",
      publicationType: officialDecision ? "conference" : null,
    });
  }

  if (result.crossrefMatch) {
    const crossrefVenue = normalizePublicationVenue(
      result.crossrefMatch["container-title"]?.[0],
    );

    evidence.push({
      source: "Crossref",
      venue: crossrefVenue,
      year: result.crossrefMatch.published?.["date-parts"]?.[0]?.[0] ?? null,
      url: result.crossrefMatch.URL ?? null,
      official: false,
      kind: crossrefVenue ? "publication" : "metadata",
      publicationType:
        result.crossrefMatch.type === "proceedings-article" ||
        isConferencePublicationVenue(crossrefVenue)
          ? "conference"
          : "journal",
    });
  }

  if (result.openAlexMatch) {
    const openAlexVenue = [
      result.openAlexMatch.primary_location?.source?.display_name,
      ...(result.openAlexMatch.locations ?? []).map(
        (location) => location.source?.display_name,
      ),
    ]
      .map(normalizePublicationVenue)
      .find(Boolean) ?? null;

    evidence.push({
      source: "OpenAlex",
      venue: openAlexVenue,
      year: result.openAlexMatch.publication_year ?? null,
      url: result.openAlexMatch.id ?? null,
      official: false,
      kind: openAlexVenue ? "publication" : "metadata",
      publicationType:
        result.openAlexMatch.type === "proceedings-article" ||
        (result.openAlexMatch.locations ?? []).some(
          (location) => location.source?.type === "conference",
        ) || isConferencePublicationVenue(openAlexVenue)
          ? "conference"
          : "journal",
    });
  }

  for (const proceeding of result.proceedings ?? []) {
    evidence.push({
      ...proceeding,
      venue: proceeding.venue ?? proceeding.source,
      year: proceeding.year ?? null,
      official: true,
      kind: "official",
      publicationType: proceeding.publicationType ?? "conference",
    });
  }

  const successfulSourceCount = [
    result.dblpHitCount,
    result.openReviewHitCount,
    result.crossrefHitCount,
    result.openAlexHitCount,
  ].filter(Number.isInteger).length;
  const publicationEvidence = evidence.filter(
    (item) => item.official || item.kind === "publication",
  );
  const decision = decidePublicationStatus(
    publicationEvidence,
    errors,
    successfulSourceCount,
  );

  if (publicationEvidence.length === 0 && evidence.length > 0) {
    decision.summary =
      "논문 레코드는 찾았지만 학회 수록 정보는 확인하지 못했습니다.";
  } else {
    const alternativeVersionCount = publicationEvidence.length -
      decision.verificationEvidence.length;

    if (alternativeVersionCount > 0) {
      decision.summary +=
        ` 서로 다른 출판 버전 ${alternativeVersionCount}개는 판정에서 분리했습니다.`;
    }
  }

  const confidenceDetails = calculateConfidenceDetails(
    decision.verificationEvidence,
  );

  return {
    ...decision,
    confidence: confidenceDetails.level,
    confidenceScore: confidenceDetails.score,
    confidenceLabel: confidenceDetails.label,
    confidenceExplanation: confidenceDetails.explanation,
    evidence,
    errors,
  };
}

function decidePublicationStatus(evidence, errors, successfulSourceCount) {
  const officialEvidence = evidence.find(
    (item) => item.official && item.publicationType === "conference",
  ) ?? evidence.find((item) => item.official);
  const conferenceEvidence = evidence.filter(
    (item) => item.publicationType === "conference",
  );
  const selectableEvidence = conferenceEvidence.length > 0
    ? conferenceEvidence
    : evidence;
  const preferredSources = ["DBLP", "Crossref", "OpenAlex", "OpenReview"];
  const metadataEvidence =
    preferredSources
      .map((source) => selectableEvidence.find((item) => item.source === source))
      .find((item) => item?.venue) ?? null;
  const primaryEvidence = officialEvidence ?? metadataEvidence ?? null;
  const verificationEvidence = primaryEvidence
    ? evidence.filter((item) => isSamePublicationVersion(item, primaryEvidence))
    : [];
  const generalEvidence = verificationEvidence.filter((item) => !item.official);

  let status;

  if (officialEvidence) {
    status = "confirmed";
  } else if (generalEvidence.length >= 2) {
    status = "supported";
  } else if (generalEvidence.length === 1) {
    status = "candidate";
  } else if (successfulSourceCount === 0 && errors.length > 0) {
    status = "inconclusive";
  } else {
    status = "not_found";
  }

  const labels = {
    confirmed: "공식 수록 확인",
    supported: "출판 정보 확인",
    candidate: "출판 후보",
    not_found: "정보 미확인",
    inconclusive: "판단 보류",
  };
  const summaries = {
    confirmed: "공식 학회 수록 또는 채택 근거를 확인했습니다.",
    supported: "여러 출처에서 일치하는 출판 정보를 확인했습니다.",
    candidate: "출판 후보를 찾았지만 추가 확인이 필요합니다.",
    not_found: "현재 연결된 출처에서 출판 정보를 확인하지 못했습니다.",
    inconclusive: "출처 조회에 실패하여 출판 여부를 판단할 수 없습니다.",
  };

  return {
    status,
    statusLabel: labels[status],
    summary: summaries[status],
    venue: normalizeVenueName(primaryEvidence?.venue),
    year: primaryEvidence?.year ?? null,
    position: primaryEvidence?.position ?? officialEvidence?.position ?? null,
    publicationType: primaryEvidence?.publicationType ?? null,
    verificationEvidence,
  };
}

function isSamePublicationVersion(left, right) {
  if (left.publicationType !== right.publicationType) {
    return false;
  }

  if (left.year && right.year && String(left.year) !== String(right.year)) {
    return false;
  }

  const leftKeys = getVenueKeys(left.venue);
  const rightKeys = getVenueKeys(right.venue);
  return leftKeys.some((key) => rightKeys.includes(key));
}

function getVenueKeys(venue) {
  if (typeof venue !== "string") {
    return [];
  }

  const normalized = venue.toLowerCase();
  const parenthetical = [...normalized.matchAll(/\(([^)]+)\)/g)]
    .map((match) => normalizeVenueToken(match[1]));
  const full = normalizeVenueToken(normalized);
  const significantWords = normalized
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !["the", "of", "on", "and", "ieee", "acm"].includes(word));
  const acronym = significantWords.map((word) => word[0]).join("");

  return [...new Set([full, ...parenthetical, acronym].filter(Boolean))];
}

function isConferencePublicationVenue(venue) {
  return typeof venue === "string" &&
    /\b(conference|proceedings|cvpr|iccv|eccv|wacv|neurips|nips|icml|iclr|aaai|ijcai|acl|emnlp|naacl|kdd|siggraph|chi|uist)\b/i.test(
      venue,
    );
}

function normalizeVenueName(venue) {
  if (typeof venue !== "string") {
    return null;
  }

  return /^(nips|neural information processing systems)$/i.test(venue.trim())
    ? "NeurIPS"
    : venue;
}

function normalizePublicationVenue(venue) {
  if (typeof venue !== "string") {
    return null;
  }

  const preprintSources = /^(arxiv|corr)$|cornell university/i;
  return preprintSources.test(venue.trim()) ? null : venue;
}

function parseOfficialOpenReviewVenue(note, venueText) {
  if (typeof venueText !== "string" || typeof note.domain !== "string") {
    return null;
  }

  const normalizedVenue = venueText.trim();

  if (
    /\b(submission|submitted|withdrawn|rejected|desk rejected|under review)\b/i.test(
      normalizedVenue,
    )
  ) {
    return null;
  }

  const match = normalizedVenue.match(/^(.+?)\s+(20\d{2})(?:\s+(.+))?$/i);

  if (!match) {
    return null;
  }

  const venue = match[1].trim();
  const year = Number.parseInt(match[2], 10);
  const domainMatch = note.domain.match(/^([^/]+)\/(20\d{2})\/Conference$/i);

  if (!domainMatch || Number.parseInt(domainMatch[2], 10) !== year) {
    return null;
  }

  const domainVenue = domainMatch[1].replace(/\.cc$/i, "");

  if (normalizeVenueToken(domainVenue) !== normalizeVenueToken(venue)) {
    return null;
  }

  const presentation = match[3]?.match(/\b(poster|oral|spotlight)\b/i)?.[1];
  const position = presentation
    ? presentation[0].toUpperCase() + presentation.slice(1).toLowerCase()
    : null;

  return { venue: normalizeVenueName(domainVenue), year, position };
}

function normalizeVenueToken(venue) {
  return venue
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
