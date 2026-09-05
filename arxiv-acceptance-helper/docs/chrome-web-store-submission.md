# Chrome Web Store 제출 문안

## Single purpose

arXivLens is an arXiv research companion that shows publication evidence and
relevant code links and helps users save the current paper with a meaningful
PDF filename.

## 설치 전 데이터 공개 문안

arXivLens는 지원되는 arXiv abstract 페이지에서 UI를 표시하기 위해 논문 ID, URL,
제목, 저자, Comments, DOI와 버전을 브라우저 안에서 읽습니다. 외부 조회는 사용자가
`Open arXivLens` 또는 `Code & evidence`를 누른 뒤에만 시작합니다. 논문 게재 근거와
코드 저장소를 찾기 위해 필요한 최소 논문 정보를 DBLP, Crossref, Semantic Scholar,
OpenReview, 공식 proceedings 및 사용자가 권한을 허용한 경우 GitHub API에 HTTPS로
전송합니다. PDF 링크·텍스트는 `Code & evidence`를 누른 경우에만 브라우저 메모리에서
처리합니다. 분석 결과는 반복 요청을 줄이기 위해 최대 24시간 로컬 캐시되며, 원격
분석·광고·판매에는 사용되지 않습니다.

## Privacy practices

- Website content: 사용함
- Web browsing activity: 현재 지원 arXiv 논문 페이지에 한해 사용함
- Authentication information: OpenReview 세션 재시도에서 브라우저가 기존 쿠키를
  OpenReview로 직접 보낼 수 있으므로 보수적으로 신고
- Remote code: 사용하지 않음. PDF.js를 확장 패키지 안에 포함하며 외부 응답은
  데이터로만 처리함
- Limited Use certification: 모두 확인
- Privacy policy URL:
  `https://github.com/nuIw/paper_Lens/blob/main/arxiv-acceptance-helper/PRIVACY.md`

## 권한 설명

- `storage`: PDF 파일명 설정, 짧은 분석 캐시와 세션 내 GitHub 요청 제한을 저장
- `arxiv.org`: 논문 페이지 UI, 최신 버전 metadata 및 사용자가 요청한 PDF 처리
- `dblp.org`, `api.crossref.org`, `api.semanticscholar.org`: publication metadata 조회
- `api.openreview.net`, `api2.openreview.net`: OpenReview submission과 decision 조회
- CVF, ACL Anthology, PMLR, NeurIPS Proceedings: 강한 metadata 후보의 공식 근거 확인
- 선택적 `api.github.com`: 사용자가 `Code & evidence`를 눌러 권한을 허용했을 때만
  관련 코드 후보 검색
- 선택적 `downloads`: 사용자가 `Download PDF`를 눌러 권한을 허용했을 때만 지정한
  파일명으로 arXiv PDF 저장

## 제출 패키지

```sh
npm run package:extension
```

생성된 `dist/arxiv-lens-<version>.zip`만 업로드합니다. ZIP 루트에는
`manifest.json`, `src/`, `vendor/`, `icons/`만 포함됩니다.
