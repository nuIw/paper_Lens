function calculateConfidence(evidence) {
  return calculateConfidenceDetails(evidence).level;
}

function calculateConfidenceDetails(evidence) {
  if (evidence.length === 0) {
    return {
      level: "none",
      score: 0,
      label: "산정 불가",
      explanation: "검증할 출판 근거가 없습니다.",
    };
  }

  const officialEvidence = evidence.filter((item) => item.official);
  const sourceCount = new Set(evidence.map((item) => item.source)).size;
  const venueKeys = new Set(
    evidence.map(getComparableVenueKey).filter(Boolean),
  );
  const yearKeys = new Set(
    evidence.map((item) => String(item.year ?? "")).filter(Boolean),
  );
  const venueConflict = venueKeys.size > 1;
  const yearConflict = yearKeys.size > 1;

  let score;

  if (officialEvidence.length > 0) {
    score = sourceCount >= 2 ? 98 : 95;
  } else if (sourceCount >= 3) {
    score = 90;
  } else if (sourceCount === 2) {
    score = 82;
  } else {
    score = 65;
  }

  if (venueConflict) {
    score -= officialEvidence.length > 0 ? 5 : 25;
  }

  if (yearConflict) {
    score -= officialEvidence.length > 0 ? 3 : 10;
  }

  score = Math.max(5, Math.min(99, score));
  const level = score >= 90 ? "high" : score >= 70 ? "medium" : "low";
  const label = level === "high" ? "높음" : level === "medium" ? "보통" : "낮음";
  const checks = [
    officialEvidence.length > 0
      ? `공식 근거 ${officialEvidence.length}개`
      : `독립 출처 ${sourceCount}개`,
    venueConflict ? "학회명 불일치" : "학회명 일치",
    yearConflict ? "연도 불일치" : "연도 충돌 없음",
  ];

  return {
    level,
    score,
    label,
    explanation: checks.join(" · "),
  };
}

function getComparableVenueKey(item) {
  if (typeof item.venue !== "string") {
    return null;
  }

  return item.venue
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(conference|proceedings|poster|oral|spotlight)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
