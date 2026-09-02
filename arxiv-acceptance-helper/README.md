<p align="center">
  <h1 align="center">arXivLens</h1>
  <h3 align="center">
    Conference Evidence, Code Discovery, and Smart PDF Downloads for arXiv
  </h3>
</p>


arXiv 논문 페이지에서 논문의 **학회 게재 정보**, **판정 근거**, **코드 및 프로젝트 링크**, **정리된 PDF 파일명**을 한곳에서 확인할 수 있는 Chrome Extension입니다.

별도의 백엔드 서버나 계정 없이 동작하며, 필요한 정보는 DBLP, Crossref,
Semantic Scholar, OpenReview, Official Proceedings와 같은 공개 출처를 통해 확인합니다.

개인정보 처리와 외부 서비스 전송 범위는 [개인정보처리방침](PRIVACY.md)을 참고하세요.

---

## Overview

arXiv에는 최신 연구가 빠르게 공개되지만, 논문 페이지 자체만으로는 다음 정보를 한눈에 확인하기 어렵습니다.

* 이 논문이 실제 학회에 채택되었는가?
* Main Conference인지 Workshop인지 어떻게 확인할 수 있는가?
* 이전에는 Reject되었지만 이후 다른 학회에 Accepted된 논문인가?
* 논문의 공식 코드나 프로젝트 페이지는 어디에 있는가?
* 다운로드한 PDF를 논문 제목이 포함된 파일명으로 바로 저장할 수 있는가?

**arXivLens**는 이러한 정보를 arXiv 페이지를 벗어나지 않고 확인할 수 있도록 구성되어 있습니다.
페이지에 들어온 직후에는 외부 출처를 조회하지 않으며, `Open arXivLens` 또는
`Code & evidence`를 눌렀을 때만 논문 분석을 시작합니다.

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

### Author-reported

DBLP, OpenReview, Crossref, Semantic Scholar, Official Proceedings에서 accepted 또는 다른 최종
Decision을 확인하지 못했지만 arXiv Comments에 `Accepted at`, `Published at`,
`To appear in`, `Camera-ready for` 같은 명시적인 문구가 있는 경우입니다. 또한
`The 11th International Conference ... (ICLR 2023)` 또는 `ICLR 2023`처럼
comment 전체가 venue와 연도를 명시하는 publication-style 표기인 경우도 포함합니다.

대표 영역에는 Accepted와 함께 `Author-reported`로 표시하지만 공식 검증으로
취급하지 않습니다. 이 fallback은 `All records & evidence`에 publication record를
추가하지 않으며, 외부 출처의 Accepted, Rejected, Withdrawn 결과를 덮어쓰지 않습니다.
`Submitted to`, `Under review`, `Rejected`, `Withdrawn` 문맥은 acceptance로 해석하지
않습니다. 본문 일부에 학회명이 우연히 들어간 경우도 허용하지 않고, comment가
venue 표기로 시작하는 제한된 형식만 fallback으로 사용합니다.

과거 `vN` abstract 페이지를 보고 있으면 최신 abstract metadata를 한 번 조회해
acceptance 검색과 comment fallback에 사용합니다. 최신 페이지에서도 제목 변경을
놓치지 않도록 v1과 최신 직전 버전의 제목·저자를 제한된 검색 alias로 보존합니다.
PDF 스캔·다운로드·파일명은 사용자가 보고 있는 버전을 그대로 사용합니다. 최신
metadata 조회에 실패하면 과거 버전 comment는 acceptance 근거로 사용하지 않으며,
과거 alias만 불러오지 못한 경우에는 최신 comment를 유지하되 검색 불완전 경고를 표시합니다.

### Candidate

검색 결과는 발견되었지만 동일 논문이라고 자동으로 판단하기에는 일치도가 부족한 경우입니다.
`All records & evidence`에서는 identity 기준을 통과한 publication evidence와 별도의
`Search candidates — identity not established` 그룹에 표시됩니다. 후보가 제공한
Decision은 현재 논문의 상태로 표시하지 않으며, 원본 metadata와 source 링크만
수동 확인용으로 유지합니다.

출처 상태에는 API가 반환한 전체 record 수와 identity match 수, search candidate
수를 구분해 표시합니다. 각 그룹 안에서는 heuristic match score가 높은 record를
먼저 보여주고, 점수가 같을 때 최신 연도를 우선합니다.

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

현재 전체 제목, 콜론 뒤 제목, 과거 arXiv 제목을 순서대로 조회합니다. DBLP 검색식에
저자를 강제로 넣지 않고 반환된 최대 20개 후보에 대해 제목·저자·연도·식별자를 로컬에서
검증합니다. 강한 publication record가 없으면 arXiv ID로 CoRR identity와 DBLP의
정규 제목을 찾고, 아직 조회하지 않은 정규 제목으로 한 번 더 조회합니다. 일시적인
네트워크 단절/timeout은 같은 검색을 한 번만 재시도하고, 5xx는 같은 넓은 검색을
반복하는 대신 한 번만 더 좁은 제목+저자 검색으로 전환합니다. 429는 추가 요청하지 않습니다.
DBLP record에 OpenReview forum 링크가 있으면 동일성 점수를 통과한 record에
한해 해당 forum을 직접 확인합니다. 일부 단계만 실패해 CoRR 등의 결과가 남은 경우에는
성공으로 숨기지 않고 `partial`로 표시합니다.

---

### Crossref

DBLP와 병렬로 publication candidate를 보완하는 공개 metadata 출처입니다.

다음 정보를 활용합니다.

* Title
* Authors
* Publication DOI
* Container title
* Publication type
* Publication URL
* Year

Crossref record는 동일 논문과 출판처를 찾는 후보 근거이며, 그 자체로 Decision이나 Track을 `Verified`로 만들지 않습니다.

강하게 일치하는 Crossref record가 공식 proceedings URL을 제공하거나 ACL DOI·CVF metadata로 공식 페이지 후보를 구성할 수 있는 경우에만 해당 페이지를 직접 조회하고, 공식 페이지의 제목·저자·DOI를 다시 비교합니다.

OpenAlex는 기본 자동 조회에 포함하지 않습니다. 프로덕션 API 사용에 계정별 API key가 필요하므로, 별도 계정 없이 동작한다는 확장 프로그램의 기본 원칙과 맞지 않기 때문입니다.

---

### Semantic Scholar

DBLP가 실패하거나 CoRR만 찾은 경우에만 venue metadata 보강을 위해 `ARXIV:{id}`
직접 조회를 한 번 수행합니다. 검색 결과를 고르는 방식이 아니라 arXiv ID endpoint를
사용하므로 제목 유사도만으로 다른 논문을 가져오지 않습니다.

Semantic Scholar의 venue/publication metadata는 `Probable` 근거일 뿐이며 Decision이나
Track을 `Verified`로 만들지 않습니다. API key 없이 공개 endpoint를 사용하고, 오류나
rate limit은 다른 출처와 마찬가지로 부분 실패로 표시합니다.

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
모든 자동 요청은 쿠키를 제외한 익명 요청으로 시작합니다. 브라우저에서 challenge를
직접 확인한 뒤 `Retry with OpenReview session`을 누른 경우에만 해당 재조회에 쿠키를
포함합니다.

v2는 exact-title 검색을 먼저 실행하고 필요한 경우에만 제한된 terms 검색을 추가합니다.
현재 제목뿐 아니라 제한된 과거 제목 alias도 사용하며, 강한 후보의 forum만 확인합니다.
v1 fallback이 실패하더라도 이미 받은 v2 검색 후보는 버리지 않으며,
`ICLR 2023 poster`처럼 venue에 명시된 presentation도 보존합니다.

완전한 분석 결과는 24시간 저장합니다. 일부 출처가 실패했지만 외부 publication/decision
근거가 남아 있으면 1시간, 외부 최종 근거 없이 comment fallback 또는 후보만 남으면
5분만 저장하여 일시적 장애가 장시간 `Venue not found`로 굳어지지 않게 합니다.

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

강하게 일치하는 DBLP, Crossref 또는 Semantic Scholar record가 지원되는 official
publication URL을 제공하는 경우에만 해당 페이지를 확인합니다. ACL publication DOI와
CVF venue metadata로 안전하게 공식 URL 후보를 구성할 수 있는 경우도 포함됩니다.

후보 URL을 발견했다는 사실만으로 검증을 완료하지 않습니다. 공식 페이지를 직접 조회한 뒤 제목, 저자, DOI, 연도를 다시 비교하고 identity 기준을 통과한 record만 Decision 또는 Track 검증에 사용할 수 있습니다.

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
Title similarity        가장 높은 가중치
Full author names       강한 저자 근거
Initial-compatible name 이니셜 표기 차이 허용
Surname-only match      약한 보조 근거
Publication year        범위를 제한하지 않는 약한 보조 근거
```

이를 통해 제목이 일부 변경된 publication record도 비교할 수 있도록 구성되어 있습니다.

저자 목록은 성만 일치하는지 여부로 결정하지 않습니다. 전체 이름 일치, 이니셜 호환, 성만 제공된 metadata를 구분하고, 이름이 다른데 성만 같은 경우는 저자 근거로 인정하지 않습니다.

Publication year는 arXiv 제출 후 수년 뒤에 채택되는 경우를 막는 hard filter가 아닙니다. 시간 차이를 근거에 표시하고 낮은 가중치만 부여합니다.

동일 논문이라고 판단하기에 충분하지 않은 결과는 자동 병합하지 않고 `Candidate`로 유지합니다.

UI의 `heuristic score N/100`은 매칭 규칙의 상대 점수이며, 결과가 맞을 통계적 확률이 아닙니다. 최종 판단은 이 숫자를 `신뢰도 %`로 표시하지 않고 다음 근거를 분리해 보여줍니다.

```text
Identity  Exact identifier / title / author / year evidence
Decision  Official decision / proceedings / metadata only
Track     Explicit official track / probable / unverified
```

---

## Code & Project Links

논문과 관련된 코드 및 프로젝트 링크를 arXiv 페이지와 PDF에서 탐색합니다.

지원하는 주요 도메인은 다음과 같습니다.

* GitHub
* GitLab
* Bitbucket
* Codeberg
* Hugging Face
* GitHub Pages / GitLab Pages / Project Page

arXiv Comments와 Abstract에서는 클릭 가능한 링크뿐 아니라 화면에 일반 텍스트로 적힌 URL도 확인합니다. 임의의 외부 도메인은 링크 문구나 주변 문맥에 `project`, `code`, `demo`, `repository` 등의 명시적 표지가 있을 때만 프로젝트 페이지 후보로 취급합니다.

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

## GitHub Code Search

`Code & evidence`를 열면 PDF 링크 분석과 GitHub repository 검색을 함께 시작합니다.

```text
Code & evidence
├─ PDF code/project link scan
└─ GitHub repository search
```

GitHub API는 논문 페이지를 여는 것만으로 호출되지 않습니다.

**사용자가 `Code & evidence`를 직접 눌렀을 때 GitHub host 권한을 요청하고, 허용된 경우에만 조회합니다.**

검색으로 발견된 repository는 논문의 공식 구현이라고 자동 판단하지 않습니다.
제목 기반 best-match 후보를 넓게 수집한 뒤 이름·설명·식별자·README 구현 문맥으로
재정렬하며, star는 동점 보조 기준으로만 사용합니다.

화면에는 구현 문맥과 논문 식별 근거를 모두 갖춘 `Likely implementation`을 최대
3개까지 먼저 표시합니다. `Possible match`와 `Low relevance / reference-only`는
접힌 별도 그룹에서 확인할 수 있으며 내부 점수 계산 근거는 UI에 노출하지 않습니다.

따라서 다음과 같이 명확하게 구분하여 표시합니다.

```text
Search candidates
Not verified as official code
```

완전한 결과는 동일 브라우저 세션에서 한 시간 재사용하며, GitHub가 불완전한
결과라고 표시한 응답은 5분만 재사용합니다. 새 논문 검색은 시간당 최대 5회로
제한하고, README는 제목 후보와 arXiv ID 후보를 합쳐 최대 8개만 동시에 2개씩
확인합니다. GitHub 응답의 rate-limit 헤더가 소진을 알리면 남은 확인을 중단합니다.

PDF 다운로드 권한은 설치 시점이 아니라 사용자가 `Download PDF`를 누를 때 요청합니다.

---
