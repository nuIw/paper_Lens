async function findRepositoryEvidence(paper) {
  const directLinks = paper.projectLinks ?? [];

  if (directLinks.length > 0) {
    return directLinks.map(createDirectProjectEvidence);
  }

  return searchGitHubRepositories(paper.title);
}

function createDirectProjectEvidence(project) {
  return {
    url: project.url,
    classification: "official",
    classificationLabel: "공식",
    foundAt: project.foundAt,
    reason: `${project.foundAt}에 논문과 함께 직접 기재된 링크입니다.`,
  };
}

async function searchGitHubRepositories(title) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `\"${title}\" in:name,description`);
  url.searchParams.set("per_page", "3");

  const response = await fetch(url, { headers: getGitHubHeaders() });

  if (!response.ok) {
    throw new Error(`GitHub search failed: ${response.status}`);
  }

  const data = await response.json();

  return (data.items ?? []).map((repository) => ({
    url: repository.html_url,
    classification: "unofficial_candidate",
    classificationLabel: "비공식/미확인 후보",
    foundAt: "GitHub 저장소 검색",
    reason:
      "논문 제목으로 발견했지만 논문 저자의 공식 저장소인지는 확인하지 못했습니다.",
  }));
}

function getGitHubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
  };
}
