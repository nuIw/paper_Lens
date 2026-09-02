# arXivLens 개인정보처리방침

최종 업데이트: 2026년 9월 1일

arXivLens는 arXiv 논문 페이지에서 학회 게재 근거, 코드 및 프로젝트 링크,
사용자 지정 PDF 파일명을 제공하는 Chrome 확장 프로그램입니다. 별도의 백엔드,
사용자 계정, 광고, 분석 도구 또는 원격 로그 수집 시스템을 운영하지 않습니다.

## 처리하는 정보

지원되는 arXiv abstract 페이지를 방문하면 확장 프로그램은 버튼과 파일명 UI를
표시하기 위해 현재 페이지의 논문 식별자, URL, 제목, 저자, Comments, DOI, 버전과
페이지 링크를 브라우저 안에서 읽습니다. 외부 출처 조회는 사용자가 기능 버튼을
누르기 전에는 시작하지 않습니다. PDF 텍스트·링크는 사용자가 `Code & evidence`를
누른 경우에만 처리합니다. PDF 원본 바이트는 arXiv에서 받아 메모리에서만 처리하며,
저장하거나 다른 외부 서비스로 전송하지 않습니다.

PDF 파일명 형식과 저장 위치 확인 설정은 `chrome.storage.sync`에 저장됩니다.
논문 분석 결과는 불필요한 반복 요청을 줄이기 위해 `chrome.storage.local`에
5분, 1시간 또는 최대 24시간 동안 유효한 캐시로 저장됩니다. 만료된 분석 캐시는
다음 분석 시 삭제됩니다. GitHub 검색 결과와 요청 제한 정보는 브라우저 세션
동안만 `chrome.storage.session`에 보관됩니다. 시크릿 모드에서는 확장 프로그램을
실행하지 않습니다.

## 외부 서비스 전송

사용자가 `Open arXivLens` 또는 `Code & evidence`를 누르면 논문 제목, 일부 저자
정보, arXiv ID, DOI 또는 관련 publication URL 중 조회에 필요한 최소 정보가 다음
서비스에 전송될 수 있습니다.

- arXiv
- DBLP
- Crossref
- Semantic Scholar
- OpenReview
- CVF Open Access, ACL Anthology, PMLR, NeurIPS Proceedings
- GitHub API: 사용자가 선택적 GitHub 호스트 권한을 허용한 경우에만 사용

모든 요청은 HTTPS를 사용합니다. OpenReview 요청은 기본적으로 쿠키를 제외합니다.
OpenReview가 대화형 확인을 요구하고 사용자가 `Retry with OpenReview session`을
명시적으로 누른 경우에만 브라우저가 기존 OpenReview 세션 쿠키를 OpenReview로
직접 전송할 수 있습니다. arXivLens는 쿠키 값을 읽거나 저장하지 않습니다.

각 외부 서비스의 응답 및 서버 로그에는 해당 서비스의 개인정보처리방침이
적용됩니다.

## 제한된 사용

처리한 정보는 위에서 설명한 단일 사용자 기능을 제공하고 안정성을 유지하는 데만
사용합니다. 정보를 판매하거나 광고, 신용평가, 사용자 프로파일링에 사용하지 않고,
데이터 브로커 또는 광고 플랫폼에 제공하지 않으며, 개발자가 원격으로 열람할 수
있는 서버에 저장하지 않습니다.

arXivLens의 정보 사용은 Chrome Web Store 사용자 데이터 정책과 Limited Use
요구사항을 준수합니다.

## 삭제 및 문의

만료된 분석 캐시는 다음 분석 시 자동으로 삭제되고 세션 캐시는 브라우저 세션이
종료되면 삭제됩니다. 확장 프로그램을 제거하면 Chrome이 확장 프로그램 저장소를
정리합니다.

개인정보 관련 문의는
[paper_Lens GitHub Issues](https://github.com/nuIw/paper_Lens/issues)를 이용해 주세요.
