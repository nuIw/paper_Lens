<div align="center">
  <h1>arXivLens</h1>
  <p>Conference evidence, code discovery, and named PDF downloads for arXiv</p>
</div>

arXivLens는 arXiv 논문 페이지에서 학회 게재 정보와 근거를 확인하고, 관련 코드 링크를 찾고, 읽기 쉬운 파일명으로 PDF를 저장할 수 있게 해주는 Chrome 확장 프로그램입니다.

별도의 백엔드 서버나 arXivLens 계정 없이 동작하며, 외부 출처 조회는 사용자가 기능을 열거나 요청했을 때만 시작합니다.

## 주요 기능

- 학회명, 연도, 게재 상태, 트랙 및 발표 유형 표시
- 논문 일치 여부와 게재 근거를 분리한 검증 상태 제공
- arXiv 페이지와 PDF에서 코드·프로젝트 링크 탐색
- GitHub 관련 저장소 후보 검색
- 논문 제목과 arXiv ID를 이용한 PDF 파일명 생성
- 현재 논문 URL이 자동 입력되는 오류 신고 양식 제공

## 설치

1. 이 저장소를 내려받거나 clone합니다.
2. Chrome에서 `chrome://extensions`를 엽니다.
3. 오른쪽 위의 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 선택합니다.
5. 저장소 안의 `arxiv-acceptance-helper` 폴더를 지정합니다.

소스 코드를 수정한 뒤에는 확장 프로그램 카드와 이미 열려 있던 arXiv 탭을 모두 새로고침해야 합니다.

## 사용 방법

1. `https://arxiv.org/abs/...` 형식의 논문 페이지를 엽니다.
2. 논문 제목 아래의 **Open arXivLens**를 누릅니다.
3. 학회 게재 정보와 검증 상태를 확인합니다.
4. 원하는 파일명을 선택하거나 수정한 뒤 **Download PDF**를 누릅니다.
5. 코드 링크와 세부 근거가 필요하면 페이지 하단의 **Code & evidence**를 엽니다.

근거를 다시 조회하려면 **Refresh evidence**를 사용합니다. 잘못된 결과나 동작 문제는 **Report issue**를 눌러 신고할 수 있으며, 현재 arXiv URL이 신고 양식에 자동 입력됩니다.

## 검증 상태

| 상태 | 의미 |
| --- | --- |
| `Verified` | 공식 proceedings 또는 공식 decision과 같은 직접 근거가 확인됨 |
| `Probable` | 논문 정보가 강하게 일치하지만 공식 최종 근거가 충분하지 않음 |
| `Metadata only` | publication metadata만으로 decision이나 track을 확정하기 어려움 |
| `Author-reported` | arXiv Comments의 명시적인 저자 표기를 근거로 사용함 |
| `Candidate` | 검색 결과는 있으나 같은 논문으로 자동 확정하기에는 근거가 부족함 |
| `Conflicting` | 같은 학회와 연도에 서로 다른 최종 decision이 발견됨 |
| `Unverified` | 해당 항목을 확인할 충분한 근거가 없음 |

arXivLens는 `Identity`, `Decision`, `Track`을 독립적으로 표시합니다. 검색 후보가 발견됐다는 이유만으로 현재 논문의 게재 상태를 자동 확정하지 않습니다.

## 데이터 출처

- DBLP
- Crossref
- Semantic Scholar
- OpenReview
- CVF Open Access
- ACL Anthology
- PMLR
- NeurIPS Proceedings
- GitHub API — 사용자가 선택적 권한을 허용한 경우

외부 API 장애, rate limit 또는 metadata 누락으로 결과가 불완전할 수 있습니다. `Probable`, `Metadata only`, `Candidate` 결과는 표시된 원본 출처도 함께 확인하는 것이 좋습니다.

## 권한과 개인정보

PDF 다운로드와 GitHub 검색 권한은 해당 기능을 사용하는 시점에 별도로 요청합니다. 논문 분석에 필요한 정보와 로컬 저장 범위는 [개인정보처리방침](arxiv-acceptance-helper/PRIVACY.md)을 확인하세요.

## 개발

```sh
cd arxiv-acceptance-helper
npm install
npm run verify
```

Chrome Web Store용 패키지 생성:

```sh
npm run package:extension
```

## 문서

- [상세 사용 및 개발 안내](arxiv-acceptance-helper/README.md)
- [개인정보처리방침](arxiv-acceptance-helper/PRIVACY.md)
- [검증 보고서](arxiv-acceptance-helper/docs/verification-report.md)
- [Chrome Web Store 제출 문안](arxiv-acceptance-helper/docs/chrome-web-store-submission.md)

## 오류 신고

arXiv 페이지의 **Report issue** 버튼을 이용하면 현재 논문 URL이 입력된 신고 양식이 열립니다. 오류 메시지, 기대한 결과, 실제 결과를 함께 작성하면 문제를 재현하는 데 도움이 됩니다. 비밀번호, API key 또는 민감한 개인정보는 입력하지 마세요.
