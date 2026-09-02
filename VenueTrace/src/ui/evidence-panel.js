function renderEvidencePanel(
  container,
  decision,
  repositories = [],
  repositoryError = null,
) {
  container.replaceChildren();
  container.dataset.confidence = decision.confidence;

  const heading = document.createElement("header");
  const title = document.createElement("strong");
  const status = document.createElement("span");
  const description = document.createElement("p");

  heading.className = "venuetrace-header";
  title.className = "venuetrace-brand";
  title.textContent = "VenueTrace";
  status.className = "venuetrace-status";
  status.textContent = decision.statusLabel;
  description.className = "venuetrace-summary";
  description.textContent = decision.summary;
  heading.append(title, status, description);
  container.append(heading);

  if (Number.isFinite(decision.confidenceScore)) {
    const confidence = document.createElement("p");
    const confidenceName = document.createElement("strong");

    confidence.className = "venuetrace-confidence";
    confidenceName.textContent = `검증 신뢰도 ${decision.confidenceScore}%`;
    confidence.append(confidenceName);

    if (decision.confidenceExplanation) {
      confidence.append(` · ${decision.confidenceExplanation}`);
    }

    confidence.title =
      "실측 정확도가 아니라 출처의 공식성, 독립 출처 수, 학회명·연도 일치도를 반영한 신뢰도입니다.";
    container.append(confidence);
  }

  if (decision.venue || decision.position) {
    const verdict = document.createElement("div");

    verdict.className = "venuetrace-verdict";

    if (decision.venue) {
      const venue = document.createElement("div");
      const label = document.createElement("span");
      const value = document.createElement("strong");
      const venueLabel =
        decision.publicationType === "conference"
          ? decision.status === "confirmed" ? "확인된 학회" : "후보 학회"
          : decision.status === "confirmed" ? "확인된 출판처" : "후보 출판처";
      const year = decision.year ? ` (${decision.year})` : "";

      venue.className = "venuetrace-verdict-item";
      label.textContent = venueLabel;
      value.textContent = `${decision.venue}${year}`;
      venue.append(label, value);
      verdict.append(venue);
    }

    if (decision.position) {
      const position = document.createElement("div");
      const label = document.createElement("span");
      const value = document.createElement("strong");

      position.className = "venuetrace-verdict-item";
      label.textContent = "발표 형태";
      value.textContent = decision.position;
      position.append(label, value);
      verdict.append(position);
    }

    container.append(verdict);
  }

  if (decision.evidence.length > 0) {
    const evidenceSection = document.createElement("details");
    const evidenceTitle = document.createElement("summary");
    const list = document.createElement("ul");

    evidenceSection.className = "venuetrace-details";
    const publicationCount = decision.evidence.filter(
      (item) => item.official || item.kind === "publication",
    ).length;
    const metadataCount = decision.evidence.length - publicationCount;
    evidenceTitle.textContent =
      `출판 근거 ${publicationCount}개 · 기타 metadata ${metadataCount}개`;
    evidenceSection.append(evidenceTitle);

    for (const evidence of decision.evidence) {
      const item = document.createElement("li");
      const details = [evidence.venue, evidence.year, evidence.position]
        .filter(Boolean)
        .join(" · ");
      const text = details ? `${evidence.source}: ${details}` : evidence.source;
      const url = getSafeHttpUrl(evidence.url);
      const evidenceType = evidence.kind === "official_decision"
        ? "공식 채택 결정"
        : evidence.official
          ? "공식 proceedings"
        : evidence.kind === "publication"
          ? evidence.publicationType === "conference"
            ? "학회 출판 근거"
            : "저널 출판 근거"
          : evidence.kind === "submission"
            ? "submission 레코드"
            : "metadata 레코드";

      item.append(text);

      if (url) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `${new URL(url).hostname} 열기`;
        item.append(" · ");
        item.append(link);
      }

      item.append(` (${evidenceType})`);

      list.append(item);
    }

    evidenceSection.append(list);
    container.append(evidenceSection);
  }

  if (decision.errors.length > 0) {
    const errors = document.createElement("small");
    errors.className = "venuetrace-errors";
    errors.textContent = `조회하지 못한 출처: ${decision.errors
      .map((error) => error.source)
      .join(", ")}`;
    container.append(errors);
  }

  {
    const projectSection = document.createElement("details");
    const projectTitle = document.createElement("summary");

    projectSection.className = "venuetrace-projects";
    const projectLabel = repositories.some(
      (repository) => repository.classification !== "official",
    )
      ? "저장소 검색 후보"
      : "저장소 정보";
    projectTitle.textContent = `${projectLabel} ${repositories.length}개`;
    projectSection.append(projectTitle);

    for (const repository of repositories) {
      const card = document.createElement("dl");
      const link = document.createElement("a");
      const url = getSafeHttpUrl(repository.url);

      if (!url) {
        continue;
      }

      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = url;
      card.className = "venuetrace-repository";
      appendRepositoryField(card, "저장소 URL", link);
      appendRepositoryField(card, "공식성 분류", repository.classificationLabel);
      appendRepositoryField(card, "발견 위치", repository.foundAt);
      appendRepositoryField(card, "판단 근거", repository.reason);
      projectSection.append(card);
    }

    if (repositories.length === 0 && !repositoryError) {
      const emptyCard = document.createElement("dl");
      emptyCard.className = "venuetrace-repository";
      appendRepositoryField(emptyCard, "저장소 URL", "찾지 못함");
      appendRepositoryField(emptyCard, "공식성 분류", "판단 불가");
      appendRepositoryField(
        emptyCard,
        "발견 위치",
        "arXiv Comments/Abstract 및 GitHub 저장소 검색",
      );
      appendRepositoryField(
        emptyCard,
        "판단 근거",
        "직접 링크와 제목 검색에서 저장소 후보가 발견되지 않았습니다.",
      );
      projectSection.append(emptyCard);
    }

    if (repositoryError) {
      const error = document.createElement("small");
      error.className = "venuetrace-errors";
      error.textContent = `저장소 확인 실패: ${repositoryError}`;
      projectSection.append(error);
    }

    container.append(projectSection);
  }
}

function appendRepositoryField(container, label, value) {
  const term = document.createElement("dt");
  const description = document.createElement("dd");

  term.textContent = label;
  description.append(value);
  container.append(term, description);
}

function renderPdfDownloadButton(container, onDownload) {
  const button = document.createElement("button");
  button.className = "venuetrace-download";
  button.type = "button";
  button.textContent = "PDF 다운로드";

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "다운로드 준비 중...";

    try {
      const response = await onDownload();

      if (!response.downloadStarted) {
        throw new Error("Download did not start.");
      }

      button.textContent = "다운로드 시작됨";
    } catch (error) {
      button.disabled = false;
      button.textContent = `다운로드 실패: ${error.message}`;
    }
  });

  container.append(button);
}

function getSafeHttpUrl(value) {
  const urlValue = Array.isArray(value) ? value[0] : value;

  try {
    const url = new URL(urlValue);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
