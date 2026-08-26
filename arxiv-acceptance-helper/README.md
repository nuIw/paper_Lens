# arXiv Acceptance Helper

백엔드 없이 Chrome 확장 프로그램만으로 arXiv 논문의 학회 기록, 근거,
코드 링크와 PDF 파일명을 한곳에서 확인합니다.

## 주요 동작

- `arxiv.org/abs/*`의 **Export BibTeX Citation** 바로 아래에
  `Acceptance · Code · Download` 버튼을 추가합니다.
- 버튼을 처음 열 때만 DBLP와 OpenReview를 조회하고 결과를 24시간
  캐시합니다. => !! 어디에 cache하는 건가요? !!
- DBLP는 제목과 첫 번째 저자를 함께 검색한 뒤 기존 제목·저자·식별자
  점수로 실제 논문 여부를 판정합니다.
- 학회 허용 목록 없이 원본 venue/decision/track을 보존하고 일반적인
  값만 정규화합니다.
- 논문 HTML 링크와 PDF 링크를 자동 표시합니다. => !! PDF 링크는 어디에 있는지 알고 자동 표시하는 거지? arXiv에 항상 똑같은 위치에 존재하기 때문에 그런 건가? !!
- GitHub API는 **GitHub additional search** 버튼을 눌렀을 때만 호출하며,
  결과를 공식 코드가 아닌 검색 후보로 표시합니다. => !! 이걸 호출할 때 잘 찾을 수 있을지 잘 모르겠고, cost가 너무 크지 않을까 걱정되네 !!
- 제목 별칭과 arXiv ID로 PDF 파일명을 미리 채우고 다운로드 전에 직접 편집할 수 있습니다. => !! 처음에 편집하기 전에 미리 설정되어있는 제목은 어떤 제목으로 표시되는지? 논문의 별칭으로 표기가 되는지? !!
- OpenReview가 대화형 challenge를 요구하면 해당 출처를 미완료 상태로
  표시하고, OpenReview의 논문 포럼이나 제목 검색으로 가는 안전한 수동
  확인 링크를 함께 제공합니다. => !! openreview가 대화형 challenge를 요구한다는 게 무슨 뜻인지 모르겠네 !!

## 설치

현재 만들어진 로컬 확장을 바로 불러오려면:

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위 **Developer mode**를 켭니다.
3. **Load unpacked**를 누릅니다.
4. 다음 디렉터리를 선택합니다.

   ```text
   /nas2/data/whalsdn03/paper_project/arxiv-acceptance-helper
   ```

5. `https://arxiv.org/abs/1706.03762` 같은 논문 페이지를 새로 엽니다.

소스에서 의존성을 다시 준비해야 할 때만 다음 명령을 실행합니다.

```bash
cd /nas2/data/whalsdn03/paper_project/arxiv-acceptance-helper
npm ci --omit=optional
npm run build
```

`npm run build`는 PDF.js 전체 패키지를 확장에 노출하지 않고 다음 세
파일만 `vendor/`에 복사합니다.

- `pdf.mjs`
- `pdf.worker.mjs`
- `LICENSE.pdfjs`

## 검증

```bash
npm run verify
npm run test:coverage
npm audit --omit=dev
```

### Chrome 수동 확인

- [ ] 버튼이 Export BibTeX Citation 바로 아래 나타난다.
- [ ] 버튼을 열기 전에는 DBLP/OpenReview/GitHub 요청이 발생하지 않는다.
- [ ] 첫 클릭 후 DBLP와 OpenReview 결과가 각각 갱신된다.
- [ ] 한 출처가 실패해도 다른 출처, 링크, 다운로드가 유지된다.
- [ ] OpenReview challenge가 발생하면 수동 확인 링크가 새 탭에서
      `openreview.net/challenge`로 열린다.
- [ ] 새로고침 버튼이 캐시를 우회하고, 다시 열면 캐시가 사용된다.
- [ ] PDF 주석과 보이는 텍스트에서 코드 링크가 발견된다.
- [ ] GitHub 검색은 전용 버튼을 눌렀을 때만 실행된다.
- [ ] 파일명 형식 변경, 직접 편집, Save As 설정과 PDF 다운로드가 동작한다.
- [ ] 키보드만으로 열기, 설정, 링크, 상세 기록을 조작할 수 있다.
- [ ] 시스템의 밝은/어두운 테마에서 텍스트와 포커스가 보인다.

## 데이터와 개인정보

자동 분석 시 논문 제목·저자·연도·DOI/arXiv ID가 DBLP와 OpenReview로
전송됩니다. GitHub에는 사용자가 추가 검색 버튼을 누를 때만 논문 제목이
전송됩니다. PDF 바이트, GitHub 결과, 탐색 기록, API 토큰이나 텔레메트리는
저장하지 않습니다.

저장 항목:

- `chrome.storage.local`: 논문별 분석 결과, 저장 시각, 24시간 TTL
- `chrome.storage.sync`: 파일명 형식과 Save As 선택

## 결과 해석

- **Verified:** 정확한 식별자 또는 강하게 일치한 OpenReview 공식 Decision
- **Probable:** 제목·저자가 강하게 일치하는 권위 있는 단일 메타데이터
- **Metadata only:** 원문은 있으나 의미나 논문 동일성을 확정하기 어려움
- **Conflicting:** 같은 학회·같은 연도의 최종 결정이 서로 다름
- **Candidate:** 동일 논문으로 자동 병합하기에는 일치도가 낮음

연도가 다른 Reject와 Accept 기록은 충돌이 아니라 제출 이력으로 남습니다.
DBLP만으로 Main Track을 추정하지 않습니다.

일부 OpenReview legacy API나 forum 조회는 대화형 challenge를 요구할 수
있습니다. 이 경우 확장은 자동 검증 완료를 주장하지 않고 수동 확인 링크를
표시합니다. 브라우저의 교차 출처 쿠키 정책 때문에 challenge를 완료해도
확장 프로그램의 API 재조회가 반드시 복구된다고 보장하지는 않습니다.
=> !! 대화형 challenge를 요구한다는 게 무슨 말인지, 브라우저의 교차 출처 쿠키 정책 때문에 challenge를 완료해도 API가 재조회되지 않는다는 게 무슨 말인지, 왜 이런 정책이 있는지 설명이 필요해 !!

## 개발 범위

Chrome MV3, 일반 JavaScript/CSS, Chrome Storage/Downloads API를 사용합니다.
런타임 의존성은 Apache-2.0의 `pdfjs-dist@4.10.38` 하나입니다. React,
번들러, 백엔드, 계정, 데이터베이스와 학회 allowlist는 없습니다.
