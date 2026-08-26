# arXiv Acceptance Helper

백엔드 없이 Chrome 확장 프로그램만으로 arXiv 논문의 학회 기록, 근거,
코드 링크와 PDF 파일명을 한곳에서 확인합니다.

## 주요 동작

- `arxiv.org/abs/*`의 **Export BibTeX Citation** 바로 아래에
  `Acceptance · Code · Download` 버튼을 추가합니다.
- 버튼을 처음 열 때만 DBLP와 OpenReview를 조회하고, 완전한 결과는
  `chrome.storage.local`에 24시간 캐시합니다. 일부 출처가 실패한 결과는
  10분만 캐시합니다.
- DBLP는 제목과 첫 번째 저자를 함께 검색한 뒤 기존 제목·저자·식별자
  점수로 실제 논문 여부를 판정합니다.
- 학회 허용 목록 없이 원본 venue/decision/track을 보존하고 일반적인
  값만 정규화합니다.
- 강하게 일치한 DBLP 레코드가 CVF Open Access, ACL Anthology, PMLR,
  NeurIPS Proceedings의 논문 URL을 제공할 때만 해당 공식 페이지를 후속
  확인합니다. DBLP venue만으로 Main Track을 확정하지 않습니다.
- arXiv 페이지의 논문 전용 메타데이터 영역과 실제 PDF 링크를 읽고,
  PDF.js로 PDF 주석과 보이는 URL을 스캔해 코드/프로젝트 링크를 표시합니다.
- GitHub API는 **GitHub additional search** 버튼을 눌렀을 때만 호출하며,
  결과를 공식 코드가 아닌 검색 후보로 표시합니다. 같은 브라우저 세션의
  성공 결과는 한 시간 재사용하고 동일 논문의 동시 요청은 합칩니다.
- 첫 콜론 앞 제목(콜론이 없으면 전체 제목)과 arXiv ID를 단일 `_`로
  연결해 PDF 파일명을 미리 채우며 다운로드 전에 직접 편집할 수 있습니다.
- OpenReview가 대화형 challenge를 요구하면 해당 출처를 미완료 상태로
  표시하고, OpenReview의 논문 포럼이나 제목 검색으로 가는 안전한 수동
  확인 링크를 함께 제공합니다. challenge는 자동 요청 대신 사람이 웹에서
  접근하는지 확인하라는 OpenReview 응답이며, 확장은 이를 우회하지 않습니다.

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
- [ ] 첫 클릭 후 DBLP/OpenReview가 갱신되고, DBLP가 지원되는 공식 논문
      URL을 제공한 경우 Official proceedings 상태도 갱신된다.
- [ ] 한 출처가 실패해도 다른 출처, 링크, 다운로드가 유지된다.
- [ ] OpenReview challenge 또는 rate limit이 발생하면 API fallback을
      반복하지 않고 논문 forum/제목 검색 수동 링크가 새 탭에서 열린다.
- [ ] 새로고침 버튼이 캐시를 우회하고, 다시 열면 캐시가 사용된다.
- [ ] PDF 주석과 보이는 텍스트에서 코드 링크가 발견된다.
- [ ] GitHub 검색은 전용 버튼을 눌렀을 때만 실행된다.
- [ ] 같은 세션에서 GitHub 검색 버튼을 다시 눌러도 한 시간 동안 API
      요청이 반복되지 않는다.
- [ ] Identity / Decision / Track 검증 상태가 서로 구분되어 보이고,
      DBLP-only 결과의 Track이 Verified가 아니다.
- [ ] ACL/CVF/PMLR/NeurIPS 공식 페이지가 연결된 표본에서 명시된 Track만
      Verified로 표시된다.
- [ ] 기본 파일명이 `콜론 앞 제목_arXiv ID.pdf`이고 `_`가 하나만 들어간다.
- [ ] 파일명 형식 변경, 직접 편집, Save As 설정과 PDF 다운로드가 동작한다.
- [ ] 키보드만으로 열기, 설정, 링크, 상세 기록을 조작할 수 있다.
- [ ] 시스템의 밝은/어두운 테마에서 텍스트와 포커스가 보인다.

## 데이터와 개인정보

자동 분석 시 제목과 첫 저자가 DBLP로, 제목이 OpenReview로 전송됩니다.
DBLP가 지원되는 공식 proceedings URL을 반환하면 그 URL의 공개 HTML을
가져옵니다. GitHub에는 사용자가 추가 검색 버튼을 누를 때만 제목이
전송됩니다. PDF 바이트, 탐색 기록, API 토큰이나 텔레메트리는 저장하지
않습니다.

저장 항목:

- `chrome.storage.local`: schema version, arXiv ID, 제목/저자 fingerprint,
  논문별 분석 결과, `savedAt`, `expiresAt` (정상 24시간, 부분 실패 10분)
- `chrome.storage.session`: 클릭으로 얻은 GitHub 검색 후보 (1시간)
- `chrome.storage.sync`: 파일명 형식과 Save As 선택

## 결과 해석

- **Identity / Decision / Track:** 동일 논문인지, 최종 결정인지, Track인지
  각각 독립적으로 Verified/Probable/Unverified 상태를 표시합니다.
- **Verified:** 대표 레코드에 공식 OpenReview Decision 또는 공식 proceedings
  출판 근거가 있음. 세부적으로 무엇이 검증됐는지는 세 축을 확인해야 합니다.
- **Probable:** 제목·저자가 강하게 일치하는 권위 있는 단일 메타데이터
- **Metadata only:** 원문은 있으나 의미나 논문 동일성을 확정하기 어려움
- **Conflicting:** 같은 학회·같은 연도의 최종 결정이 서로 다름
- **Candidate:** 동일 논문으로 자동 병합하기에는 일치도가 낮음

연도가 다른 Reject와 Accept 기록은 충돌이 아니라 제출 이력으로 남습니다.
DBLP만으로 Main Track을 추정하지 않습니다.

일부 OpenReview API는 자동 요청에 대화형 challenge를 반환할 수 있습니다.
이는 브라우저에서 사람이 직접 확인해야 하는 상태입니다. 확장은 challenge를
우회하거나 반복 재시도하지 않고 forum 또는 제목 검색 링크만 제공합니다.
웹 페이지와 확장 service worker는 서로 다른 요청 문맥이므로, 웹에서 확인을
끝내도 API 요청이 곧바로 복구된다고 가정하지 않습니다.

## 개발 범위

Chrome MV3, 일반 JavaScript/CSS, Chrome Storage/Downloads API를 사용합니다.
런타임 의존성은 Apache-2.0의 `pdfjs-dist@4.10.38` 하나입니다. React,
번들러, 백엔드, 계정, 데이터베이스와 학회 allowlist는 없습니다.
