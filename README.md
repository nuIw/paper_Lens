<p align="center">
  <h1 align="center">paper_Lens</h1>
  <h3 align="center">
    Conference Evidence, Code Discovery, and Smart PDF Downloads for arXiv
  </h3>
</p>


arXiv 논문 페이지에서 논문의 **학회 게재 정보**, **판정 근거**, **코드 및 프로젝트 링크**, **정리된 PDF 파일명**을 한곳에서 확인할 수 있는 Chrome Extension입니다.

별도의 백엔드 서버나 계정 없이 동작하며, 필요한 정보는 DBLP, OpenReview, Official Proceedings와 같은 공개 출처를 통해 확인합니다.

---

## Overview

arXiv에는 최신 연구가 빠르게 공개되지만, 논문 페이지 자체만으로는 다음 정보를 한눈에 확인하기 어렵습니다.

* 이 논문이 실제 학회에 채택되었는가?
* Main Conference인지 Workshop인지 어떻게 확인할 수 있는가?
* 이전에는 Reject되었지만 이후 다른 학회에 Accepted된 논문인가?
* 논문의 공식 코드나 프로젝트 페이지는 어디에 있는가?
* 다운로드한 PDF를 논문 제목이 포함된 파일명으로 바로 저장할 수 있는가?

**arXiv Acceptance Helper**는 이러한 정보를 arXiv 페이지를 벗어나지 않고 확인할 수 있도록 구성되어 있습니다.

```text
arXiv Paper
    │
    ├── Conference & Decision
    ├── Verification Evidence
    ├── Code & Project Links
    └── Named PDF Download
```

---

## Features

### Conference & Publication Status

논문의 publication 정보를 여러 출처에서 확인하고 하나의 결과로 정리합니다.

예를 들어 다음과 같이 표시할 수 있습니다.

```text
Advances in Neural Information Processing Systems 2017
Accepted · Main
Verified
```

지원하는 주요 상태는 다음과 같습니다.

* Accepted
* Under Review
* Preprint
* Rejected
* Withdrawn

Track 정보가 명확한 경우 다음과 같이 구분합니다.

* Main
* Findings
* Workshop
* Other

Presentation 정보가 제공되는 경우 다음 정보도 함께 표시할 수 있습니다.

* Oral
* Spotlight
* Poster

---

### Evidence-based Verification

단순히 학회 이름이 발견되었다는 이유만으로 결과를 확정하지 않습니다.

각 publication record에 대해 다음 세 가지를 독립적으로 확인합니다.

```text
Identity
└─ 발견된 기록이 실제 같은 논문인가?

Decision
└─ Accepted / Rejected 등의 결정이 공식적으로 확인되었는가?

Track
└─ Main / Findings / Workshop 정보가 실제 출처에서 확인되었는가?
```

예를 들어 DBLP에서 논문이 발견되었지만 Main Track 여부를 확인할 공식 근거가 없다면 다음과 같이 표현될 수 있습니다.

```text
Identity  Probable
Decision  Metadata only
Track     Unverified
```

반대로 Official Proceedings에서 직접 publication과 Track을 확인한 경우에는 해당 축이 `Verified`로 표시됩니다.

---

## Verification Levels

### Verified

공식적인 publication 또는 decision 근거를 확인한 경우입니다.

예:

* Official Proceedings에서 논문 직접 확인
* OpenReview의 공식 Decision 확인
* Official Proceedings에서 Track 정보 확인

### Probable

제목, 저자 등의 정보가 강하게 일치하지만 공식적인 최종 근거가 충분하지 않은 경우입니다.

### Metadata only

publication metadata는 존재하지만 해당 정보만으로 Decision 또는 Track의 의미를 확정할 수 없는 경우입니다.

### Candidate

검색 결과는 발견되었지만 동일 논문이라고 자동으로 판단하기에는 일치도가 부족한 경우입니다.

### Conflicting

같은 venue와 같은 연도에 서로 다른 최종 Decision이 발견되는 경우입니다.

연도가 다른 기록은 충돌로 간주하지 않고 publication history로 유지합니다.

예:

```text
ICLR 2025 · Rejected
CVPR 2026 · Accepted
```

---

## Data Sources

### DBLP

논문의 publication candidate와 identity 정보를 찾는 주요 출처입니다.

다음 정보를 활용합니다.

* Title
* Authors
* DOI
* arXiv ID
* Venue
* Publication URL
* Year

DBLP에서 학회 이름이 발견되었다는 이유만으로 Main Conference로 판단하지 않습니다.

DBLP가 Official Proceedings URL을 제공하는 경우 해당 페이지를 추가 검증에 사용합니다.

---

### OpenReview

다음 정보를 확인하는 데 사용합니다.

* Submission
* Decision
* Venue
* Track
* Presentation
* Submission history

OpenReview API가 interactive challenge 또는 rate limit을 반환하는 경우 자동으로 이를 우회하지 않습니다.

대신 사용자가 직접 확인할 수 있도록 OpenReview forum 또는 검색 페이지 링크를 제공합니다.

---

### Official Proceedings

Track 및 실제 publication 여부를 검증하는 가장 강한 근거 중 하나입니다.

현재 지원하는 출처는 다음과 같습니다.

| Provider            | Examples                |
| ------------------- | ----------------------- |
| CVF Open Access     | CVPR, ICCV, WACV        |
| ACL Anthology       | ACL, EMNLP, NAACL 등     |
| PMLR                | ICML 및 PMLR publication |
| NeurIPS Proceedings | NeurIPS                 |

Official Proceedings는 모든 학회를 무작정 검색하지 않습니다.

강하게 일치하는 DBLP record가 지원되는 official publication URL을 제공하는 경우에만 해당 페이지를 확인합니다.

공식적인 근거가 충분하지 않은 경우 이를 임의로 추론하지 않고 `Probable`, `Metadata only`, `Candidate`, `Unverified` 등의 상태로 남깁니다.

---

## Paper Identity Matching

출처마다 논문 제목이나 metadata 형식이 조금씩 다를 수 있기 때문에 제목 문자열만 비교하지 않습니다.

가능한 경우 다음 identifier를 우선 사용합니다.

```text
Publication DOI
arXiv ID
```

identifier가 없는 경우 다음 정보를 함께 비교합니다.

```text
Title similarity
Authors
Publication year
```

이를 통해 제목이 일부 변경된 publication record도 비교할 수 있도록 구성되어 있습니다.

동일 논문이라고 판단하기에 충분하지 않은 결과는 자동 병합하지 않고 `Candidate`로 유지합니다.

---

## Code & Project Links

논문과 관련된 코드 및 프로젝트 링크를 arXiv 페이지와 PDF에서 탐색합니다.

지원하는 주요 도메인은 다음과 같습니다.

* GitHub
* GitLab
* Hugging Face
* GitHub Pages / Project Page

링크가 어디에서 발견되었는지도 함께 표시합니다.

```text
GitHub
https://github.com/...

Evidence: arXiv page link
```

또는

```text
Project Page
https://example.github.io/project

Evidence: PDF link annotation
```

---

### PDF Link Detection

PDF.js를 이용해 실제 논문 PDF도 확인합니다.

두 종류의 정보를 탐색합니다.

```text
PDF annotation
└─ PDF 내부의 클릭 가능한 hyperlink

PDF visible text
└─ 본문에 문자열 형태로 작성된 URL
```

이를 통해 arXiv HTML에는 나타나지 않지만 논문 첫 페이지나 본문에 포함된 repository 링크도 찾을 수 있습니다.

---

## GitHub Additional Search

논문에서 직접 코드 링크를 찾지 못했거나 추가 repository를 확인하고 싶다면 별도의 GitHub 검색을 실행할 수 있습니다.

```text
GitHub additional search
```

GitHub API는 논문 페이지를 여는 것만으로 호출되지 않습니다.

**사용자가 해당 버튼을 직접 눌렀을 때만 요청됩니다.**

검색으로 발견된 repository는 논문의 공식 구현이라고 자동 판단하지 않습니다.

따라서 다음과 같이 명확하게 구분하여 표시합니다.

```text
Search candidates
Not verified as official code
```

동일 브라우저 세션에서 같은 논문의 GitHub 검색 결과는 일정 시간 재사용됩니다.

---
