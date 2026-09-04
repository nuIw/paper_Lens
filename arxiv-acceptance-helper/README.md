<div align="center">
  <h1>arXivLens</h1>
  <p>Conference evidence, code discovery, and named PDF downloads for arXiv</p>
</div>

arXivLens는 arXiv 논문 페이지에서 학회 게재 정보와 근거를 확인하고, 관련 코드 링크를 찾고, 읽기 쉬운 파일명으로 PDF를 저장할 수 있게 해주는 Chrome 확장 프로그램입니다.

별도의 백엔드 서버나 arXivLens 계정 없이 동작합니다. 외부 출처 조회는 사용자가 기능을 열거나 요청했을 때만 시작합니다.

## 주요 기능

- 학회명, 연도, 게재 상태, 트랙 및 발표 유형 표시
- 논문 일치 여부와 게재 근거를 분리한 검증 상태 제공
- arXiv 페이지와 PDF에 포함된 코드·프로젝트 링크 탐색
- GitHub의 관련 저장소 후보 검색
- 논문 제목과 arXiv ID를 이용한 PDF 파일명 생성
- 현재 논문 URL이 자동 입력되는 오류 신고 양식 제공

## 설치

현재 저장소를 개발자 모드에서 직접 불러올 수 있습니다.

1. 저장소를 내려받거나 clone합니다.
2. Chrome에서 `chrome://extensions`를 엽니다.
3. 오른쪽 위의 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 선택합니다.
5. `arxiv-acceptance-helper` 폴더를 지정합니다.

소스 코드를 수정한 뒤에는 확장 프로그램 카드의 새로고침 버튼을 누르고, 이미 열려 있던 arXiv 탭도 새로고침해야 합니다. 그렇지 않으면 기존 탭에서 `Extension context invalidated` 오류가 발생할 수 있습니다.

## 사용 방법

1. `https://arxiv.org/abs/...` 형식의 논문 페이지를 엽니다.
2. 논문 제목 아래의 **Open arXivLens**를 누릅니다.
3. 학회 게재 정보와 검증 상태를 확인합니다.
4. 원하는 PDF 파일명을 선택하거나 직접 수정한 뒤 **Download PDF**를 누릅니다.
5. 코드 링크와 세부 근거가 필요하면 페이지 하단의 **Code & evidence**를 엽니다.

표시된 근거를 다시 조회하려면 **Refresh evidence**를 사용합니다. 잘못된 결과나 동작 문제는 **Report issue**를 눌러 신고할 수 있으며, 신고 양식에는 현재 arXiv URL이 자동으로 입력됩니다.

## 검증 상태

| 상태 | 의미 |
| --- | --- |
| `Verified` | 공식 proceedings 또는 공식 decision과 같은 직접 근거가 확인됨 |
| `Probable` | 제목·저자·식별자 등이 강하게 일치하지만 공식 최종 근거가 충분하지 않음 |
| `Metadata only` | publication metadata는 있으나 decision이나 track을 확정하기 어려움 |
| `Author-reported` | 외부 최종 근거 없이 arXiv Comments의 명시적인 저자 표기를 사용함 |
| `Candidate` | 검색 결과는 발견했지만 같은 논문으로 자동 확정하기에는 근거가 부족함 |
| `Conflicting` | 같은 학회와 연도에 서로 다른 최종 decision이 발견됨 |
| `Unverified` | 해당 항목을 확인할 충분한 근거가 없음 |

arXivLens는 다음 항목을 독립적으로 표시합니다.

- **Identity**: 발견된 기록이 현재 논문과 같은 논문인지
- **Decision**: Accepted, Rejected 등의 결정이 확인되었는지
- **Track**: Main, Findings, Workshop 등의 트랙이 확인되었는지

`heuristic score`는 내부 매칭 규칙의 상대 점수이며, 결과가 맞을 통계적 확률이 아닙니다. `Candidate` 결과가 현재 논문의 게재 상태로 자동 적용되지는 않습니다.

검증 방식에 관한 상세 내용은 [Verification Report](docs/verification-report.md)를 참고하세요.

## 데이터 출처

arXivLens는 다음 공개 출처를 조합해 논문과 publication record를 확인합니다.

- DBLP
- Crossref
- Semantic Scholar
- OpenReview
- CVF Open Access
- ACL Anthology
- PMLR
- NeurIPS Proceedings
- GitHub API — 사용자가 선택적 권한을 허용한 경우

출처에서 학회명이 발견되었다는 이유만으로 decision이나 Main Track을 자동 확정하지 않습니다. 공식 근거가 부족한 정보는 `Probable`, `Metadata only`, `Candidate` 또는 `Unverified`로 남깁니다.

## 코드 및 프로젝트 링크

**Code & evidence**를 열면 다음 위치에서 코드와 프로젝트 링크를 찾습니다.

- arXiv Comments와 Abstract의 링크 및 텍스트 URL
- PDF annotation에 포함된 링크
- PDF 본문에 표시된 URL
- GitHub repository 검색 결과

검색된 저장소는 공식 구현이라고 자동 확정하지 않습니다. 구현 문맥과 논문 식별 근거가 강한 후보를 먼저 보여주고, 나머지는 별도의 후보 그룹으로 구분합니다.

## 권한과 개인정보

- `storage`: 파일명 설정, 짧은 분석 캐시 및 요청 제한 정보 저장
- `downloads` — 선택 사항: 사용자가 PDF 다운로드를 요청할 때만 사용
- GitHub 접근 — 선택 사항: 사용자가 코드 검색을 요청하고 권한을 허용했을 때만 사용
- 출처별 host 권한: publication metadata와 공식 근거 조회에 사용

논문 분석 결과와 설정은 브라우저 저장소에 제한적으로 보관됩니다. 외부 서비스로 전달되는 정보와 보관 범위는 [개인정보처리방침](PRIVACY.md)을 확인하세요.

## 제한사항

- 모든 학회와 proceedings가 자동 검증되는 것은 아닙니다.
- 외부 API의 장애, rate limit 또는 metadata 누락으로 결과가 불완전할 수 있습니다.
- 논문 제목이나 저자 정보가 크게 변경되면 같은 논문을 찾지 못할 수 있습니다.
- `Probable`, `Metadata only`, `Candidate` 결과는 원본 출처 링크를 함께 확인하는 것이 좋습니다.
- OpenReview가 interactive challenge를 요구하면 사용자가 직접 확인해야 할 수 있습니다.

## 개발

필요 환경:

- Node.js
- npm
- Chrome 또는 Chromium 기반 브라우저

의존성 설치:

```sh
npm install
```

빌드, 문법 검사 및 전체 테스트:

```sh
npm run verify
```

Chrome Web Store용 ZIP 생성:

```sh
npm run package:extension
```

생성된 패키지는 `dist/arxiv-lens-<version>.zip`에 저장됩니다.

## 관련 문서

- [개인정보처리방침](PRIVACY.md)
- [검증 보고서](docs/verification-report.md)
- [Chrome Web Store 제출 문안](docs/chrome-web-store-submission.md)

## 오류 신고

arXiv 페이지의 **Report issue** 버튼을 이용하면 현재 논문 URL이 입력된 신고 양식이 열립니다. 오류 메시지, 기대한 결과, 실제 결과를 함께 작성하면 문제를 재현하는 데 도움이 됩니다. 비밀번호, API key 또는 민감한 개인정보는 입력하지 마세요.
