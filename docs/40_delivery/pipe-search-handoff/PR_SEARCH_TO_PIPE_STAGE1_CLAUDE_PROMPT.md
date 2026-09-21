# pr-search 담당 Claude에게 전달할 지시서
## PIPE 네이티브 Search 이식을 위한 코드 분석·디자인 명세·실행 지시서 작성

문서 버전: 1.0 / 작성일: 2026-09-20
문서 수신자: pr-search 저장소를 읽을 수 있는 Claude 세션
최종 구현자: 별도 PIPE 저장소를 읽을 수 있는 다른 Claude 세션
이번 단계의 결과물: 구현 코드가 아니라, 다음 세션이 바로 구현할 수 있는 자체 완결형 포팅 명세 묶음

---

## 1. 이번 작업을 정확히 정의한다

너는 지금 pr-search 저장소에 연결되어 있다. 현재 Search 화면과 그 하위 코드·데이터 계약·테스트를 분석하여, PIPE 저장소에 연결된 다른 Claude가 PIPE의 기존 React 및 디자인 시스템으로 동일한 검색 기능을 구현할 수 있는 상세 실행 지시서를 작성하라.

이번 세션에서 pr-search의 Search 코드를 MUI로 바꾸지 않는다. PIPE 구현을 대신 시작하지도 않는다. 원본 pr-search의 운영 웹·검색 API·수집·인증 코드는 유지한다. 허용된 산출물 디렉터리에 문서, 계약에 맞는 합성 fixture, 필요한 참조 코드 발췌와 실제 확인한 화면 증거만 작성한다. commit, push, PR 생성, 배포는 수행하지 않는다.

최종 사용 흐름은 다음과 같다.

```text
현재 사용자 지시서
        ↓
pr-search 담당 Claude
  실제 코드와 테스트를 읽는다.
  원본 동작과 PIPE 포팅 방법을 구체화한다.
  PIPE 담당 Claude용 구현 지시서 + 근거/계약/fixture를 만든다.
        ↓ 사용자가 산출물을 전달
PIPE 담당 Claude
  PIPE 실제 버전·테마·라우터를 확인한다.
  기존 App Shell의 콘텐츠 위치에 Search 기능 모듈을 구현한다.
  fixture 기반으로 동작·시각 품질·접근성을 검증한다.
        ↓ 별도 후속 작업
API 접근 경로·인증 위임·검색 권한 연결
```

다음 Claude는 pr-search 저장소와 이번 대화 이력에 접근할 수 없다고 가정하라. “기존 코드를 참고하라”, “이전 설계대로”, “적절히 구현하라”로 끝내지 않는다. 핵심 규칙, 입력·출력, 기본값, 오류, 레이아웃, 테스트 기대값을 전달 문서에 직접 포함한다.

완성 기준은 “설명하기 좋은 보고서”가 아니라 “PIPE 담당 Claude가 다시 pr-search를 조사하지 않고 구현할 수 있는 인수인계 자료”다.

## 2. 우선순위와 변경 경계

판단 우선순위는 사용자 범위 → 실제 원본 계약과 검증 가능한 동작 → PIPE 설치 환경 → 이 문서의 제안 치수·미감 순이다. 코드와 문서가 충돌하면 어느 쪽이 현재 실행 경로인지 조사하고, 차이를 명시한다. 결함까지 무조건 복제하거나, 설계라는 이름으로 원본 동작을 조용히 고치지 않는다.

모든 핵심 기술 사항을 아래 네 가지로 구분한다.

| 분류 | 뜻 | 문서에 남길 내용 |
|---|---|---|
| SOURCE_VERIFIED | 현재 고정한 소스에서 확인 | commit SHA, 파일, 심벌, 실제 줄 범위, 동작 |
| PIPE_PROVIDED | 사용자가 제공한 PIPE 현황 | 문서상 사실과 아직 확인하지 못한 세부 버전 |
| PORT_DECISION | 이번 포팅의 구현·디자인 결정 | 원본과의 차이, 이유, 수용 테스트 |
| TARGET_VERIFY / BLOCKED | PIPE 또는 실제 운영 환경에서만 확인 가능 | 확인할 정확한 파일/설정, 결정 규칙, 그동안 가능한 작업 |

직접 확인하지 않은 스크린샷, 테스트 통과, 호환성 또는 운영 연동을 확인했다고 쓰지 않는다. 현재 문서에 적힌 파일명은 조사 시작점이다. 작업 시점의 실제 경로·심벌을 다시 검증한다.

### 원본 보호

저장소의 CLAUDE.md, AGENTS.md 등 적용 지침을 먼저 읽는다. `git status`와 HEAD를 기록한다. 다른 사람의 미커밋 변경을 덮어쓰거나 checkout/reset/stash/clean하지 않는다. 관련 없는 기존 결함을 고치지 않는다. 하위 에이전트를 쓰더라도 읽기·문서화 범위를 그대로 제한한다. 소스 조사 에이전트가 임의 구현·CR 등록·커밋을 시작하지 못하게 한다.

문서 저장 위치는 저장소 규칙이 허용하면 `handoff/pipe-search-port/`를 사용한다. 허용되지 않으면 저장소 밖 별도 출력 디렉터리를 사용하고 위치를 보고한다. 기존 배포 산출물, package.json, lockfile, 테스트 코드, 인증 설정을 산출물 생성을 위해 변경하지 않는다.

## 3. 제품 범위: App Shell 없이 Search 콘텐츠만

이번의 Search는 입력창 하나만 뜻하지 않는다. 현재 기본 `/search` 경로에서 제공하는 검색 작업 공간과, 그 안에서 이어지는 읽기 전용 탐색을 뜻한다.

| 포함 | 제외 |
|---|---|
| 저장소 선택, Base branch 선택 | pr-search 로고, 전역 헤더, 전역 사이드 메뉴 |
| Files & folders 트리 | PIPE의 새 App Shell, 공통 헤더·메뉴 재설계 |
| Search / Commit history / My open PRs / My merged PRs | 로그인·로그아웃 UI, 사용자 메뉴, 전역 테마 토글 |
| 검색 필터와 네 종류의 범위 편집 | Regression, bisect, MDVP 화면·실행 |
| 결과 표, 서버 정렬, cursor 추가 조회 | Job 생성, 승인, re-run, PR 본문 수정 |
| 행 아래 PR/commit 상세 | 운영·관리 화면, 권한 관리 화면 |
| 경로 이력, 두 revision 비교 | 검색 데이터의 PIPE DB 재수집·동기화 |
| Diff와 파일 Time-lapse | API Gateway/BFF, JWT, 세션 발급, Redis 연결 |
| 검색 문맥 URL, 복사, GHE 원문 링크 | 새 검색 엔진·새 M 번호 계산·새 권한 판정 |

저장소/파일 사이드 패널은 Search의 콘텐츠이므로 포함한다. 이것을 제외 대상인 전역 navigation과 혼동하지 않는다. Search 로컬 탭도 유지한다.

주요 export는 `PipePrSearchContent`와 같이 셸에 종속되지 않는 콘텐츠 컴포넌트로 설계한다. 호스트는 기존 theme, 라우터, 콘텐츠 높이·폭, 검색 client, 확인된 검색 사용자 문맥을 제공한다. 테스트용 최소 mount harness는 허용하되, 그것을 새로운 운영 App Shell로 만들지 않는다.

PIPE에서의 route adapter는 기존 `/pr-search` 등 승인된 위치에 콘텐츠를 연결하는 최소 범위만 제시한다. 전역 메뉴 항목 추가·메뉴 순서 변경·기존 shell CSS 수정은 이번 작업의 기본 범위에 넣지 않는다.

## 4. PIPE 대상 환경 — 이 내용은 인수인계 문서에 다시 포함한다

아래는 사용자 제공 현황이다. pr-search 담당 세션이 PIPE의 실제 lockfile을 확인했다고 표현하지 않는다.

| 항목 | 제공된 현황 | 이번 이식 원칙 |
|---|---|---|
| 프런트엔드 | React | 실제 React/React DOM 버전은 PIPE에서 확인 |
| 주 UI | MUI 7.1 | 새 Search의 기본 컴포넌트 체계 |
| 보조 UI | Ant Design 4.20 | 기존 날짜·트리 wrapper 재사용에 한정 |
| 기존 다른 UI | RSuite 4.10 | 이미 존재해도 새 결과 표를 추가 혼용하지 않음 |
| API client | Axios, `frontend/src/apis/fetcher.js` | 이번에는 검색 transport 경계를 정의하고 fixture 구현에 연결 |
| 서버 상태 | React Query, `commons/hooks/query/client.js` | 설치된 major와 import 경로 확인 후 사용 |
| 공통 상태 | Recoil, `services/global.js` | 기존 호스트 상태만 사용, 검색 응답 중복 저장 금지 |
| 라우팅 | 기존 React Router 구성 | 버전을 확인하고 route adapter에서만 연결 |
| 코드 스타일 | JS 파일 사용이 확인된 문서 | 실제 JS/TS 정책을 따름. TS 전환을 강제하지 않음 |
| 서버 | Django/DRF, MySQL, Redis | 이번 프런트엔드 이식에서는 변경하지 않음 |
| 인증 | PIPE JWT, 중앙 fetcher의 401 처리 | 실제 연결은 다음 작업. 이식 중 인증 우회 금지 |

PIPE 담당 Claude에게 다음 확인 절차를 명시하라: frontend package.json·lockfile, React/React DOM, MUI/Emotion, antd, React Query의 실제 패키지명과 major, Axios, React Router, 기존 테마 provider, 공통 form/table wrapper, 테스트 도구, 국제화·날짜 라이브러리, 폰트·아이콘, CSS 주입 순서, 모달/팝오버 container 정책.

`react-query`와 `@tanstack/react-query`, Router v5와 v6, MUI Core와 MUI X를 임의로 같은 것으로 취급하지 않는다. MUI 7.1.0과 7.x 최신 문서 사이의 minor 차이도 실제 설치 타입으로 확인한다. Ant Design 4.x 문서의 최신 기능이 4.20에도 있다고 가정하지 않는다.

Next.js, Radix, shadcn, Tailwind, Framer Motion, 새로운 전역 CSS reset을 이 포팅만을 위해 도입하지 않는다. MUI X DataGrid/Tree View/Date Pickers, 유료 패키지, 새 차트·코드에디터 의존성도 설치돼 있다고 가정하지 않는다. `@mui/icons-material` 역시 설치 여부를 확인한다.

JS 저장소라면 `.js/.jsx + JSDoc`로, TS가 해당 영역에서 이미 표준이면 `.ts/.tsx`로 옮길 수 있도록 계약을 기술한다. API/행/상태 모델은 어느 경우든 명시한다. 문서 속 interface는 계약 설명이지 PIPE 전체 TS 전환 지시가 아니다.

## 5. 소스 기준선과 실제 조사

사전 검토에서 확인된 main SHA는 `03b80d21bfa10603d709ba14da3cdf058ab69279`다. 이 SHA를 작업 시점의 최신이라고 가정하지 않는다. 실제 분석 기준 HEAD, 브랜치, 커밋 시각과 선택 이유를 기록하고, 모든 근거를 그 기준선에 고정한다. 미커밋 변경을 기준에 섞을 경우 별도 패치 증거가 필요하며, 기본은 승인된 커밋 기준이다.

사전 검토의 기본 화면은 `RepositoryWorkspace`다. `SearchView`와 `LegacyRepositoryWorkspace`는 존재하지만 현재 기본 경로와 혼동하면 안 된다. `/search`의 feature flag·role·query 분기를 직접 읽어 어떤 조건에서 어느 화면이 열리는지 증명한다.

### 조사 시작 파일

| 영역 | 확인할 경로/대상 | 뽑아낼 정보 |
|---|---|---|
| 기본 진입 | `apps/web/app/search/page.tsx` | 실제 reader/legacy 분기, shell 경계 |
| 주 작업 공간 | `apps/web/components/RepositoryWorkspace.tsx` | 탭, 조건, 조회, 표, 행 상세, 이벤트 |
| 질의/범위 | `apps/web/lib/repository-search.ts` | query builder, sort, range, SHA resolver 결과 처리 |
| 조회 분기 | `apps/web/lib/search-fetch.ts` | 식별자 resolve와 일반 search 분기, cursor |
| M 표시 | `apps/web/components/MergeNumberBadge.tsx`, `apps/web/lib/merge-number.ts` | 표시 상태·사유·링크 문맥·복사 |
| 경로 탐색 | `apps/web/components/source/SourceTree.tsx` | lazy loading, 루트 필터, 파일/폴더 선택 |
| 경로 이력 | `apps/web/components/source/SourceHistory.tsx` | revision pinning, 페이지, PR 연결, 비교 |
| 소스 분석 | `apps/web/components/source/SourceDialogs.tsx` | diff/time-lapse 상태, 키보드, base/head |
| 순수 분석 | `apps/web/lib/source-analysis.ts` 및 실제 의존성 | line diff, word diff, trace, 계산 제한 |
| source client | `apps/web/components/source/api.ts` | API operation, URL, 오류·취소 |
| 표현 helper | `apps/web/lib/format.ts`, `service-message.ts` 등 실제 import | 날짜·숫자·에러 표시 규칙 |
| 스타일 | `repository-workspace.css`, 실제 reader/source/token CSS | 최종 cascade와 밀도, 오버플로·스크롤 |
| query/contracts | `packages/query`, `packages/contracts`의 사용 심벌 | 문법, DTO, enum, null/optional, 계약 테스트 |
| API 확인 | `apps/search-api`의 대응 route/service | 실제 request/response·오류·정렬 계약 |
| 전송 경계만 | `apps/web/lib/proxy.ts`, `app/api/[...path]/route.ts` | web `/api/*`와 upstream `/api/v1/*` 구분 |
| 테스트/의존성 | 실제 unit/a11y/e2e, web/package.json, lockfile | 정상·예외 기대값, 재사용 가능한 pure logic |

파일명만 나열하지 말고 호출 경로를 추적한다. 최종 적용 CSS는 selector 이름만 보고 추정하지 않는다. shell에서 주입되는 폰트·색·padding·키보드 핸들러를 찾아서, Search가 독립적으로 가져야 할 부분과 호스트가 제공해야 할 부분을 나눈다.

특히 Ctrl/Cmd+K가 원본 전역 shell 핸들러에 의존하는지 확인한다. shell을 빼면서 검색창 focus 기능까지 사라지지 않게, 콘텐츠 쪽의 명시적 focus 동작으로 옮기는 방법을 제시한다.

### 기능 추적표 형식

각 기능에 `PS-F-001` 같은 ID를 부여하고 다음 열을 모두 채운다.

```text
기능 ID / 화면·제어 / 사용자 동작 / source SHA
파일:실제 줄 범위 / 심벌 / 입력 상태 / 호출 API
응답 해석 / 변경되는 상태 / 표시 결과
PIPE 컴포넌트 / 유지·재작성·호스트제공·제외 판정
대응 fixture / 대응 수용 테스트 / 알려진 차이
```

다음 세션이 파일 링크를 열 수 없을 때도 이해할 수 있도록 의미를 직접 적는다. 중요한 pure function은 필요한 전이적 의존성·상수와 함께 참조 코드로 발췌하거나, 완전한 의사코드와 golden input/output를 제공한다. 함수 이름만 인용하지 않는다.

## 6. 반드시 유지할 사용자 동작

아래는 사전 확인한 기준이다. 작업 기준선에서 다시 확인하고, 달라졌다면 변경표에 기록한다.

### 6.1 저장소와 파일 문맥

`Find Repository → Base branch → Files & folders` 순서를 유지한다. 검색어·날짜·작성자 입력을 왼쪽에 중복하지 않는다. 저장소/브랜치를 바꾸면 이전 cursor, stale source_ref, 잘못된 M/sequence 범위와 늦게 도착한 응답을 새 문맥에 섞지 않는다. 보존할 조건과 지울 조건은 원본 코드에서 추출해 전이표에 명시한다.

저장소 목록은 이미 받은 일부 목록인지 전체인지 구분한다. 로컬 Autocomplete가 로드한 페이지만 필터링하면서 “전체 저장소 검색”인 것처럼 보이지 않게 한다. 다음 페이지 로딩, 권한 필터 때문에 빈 페이지가 나오는 경우, 아직 로드하지 않은 저장소 deep link를 문서화한다.

`Filter root entries`는 원본의 루트 항목 필터다. 재귀 파일 검색이나 코드 본문 검색으로 바꾸지 않는다. 폴더 lazy loading, root 선택, file/directory/symlink/submodule, truncated 결과, 오류와 retry를 다룬다. 폴더 펼침과 이력 선택의 현재 동작을 확인하고 장식상 분리할 때는 동작 차이를 기록한다.

### 6.2 네 탭

탭 순서는 `Search / Commit history / My open PRs / My merged PRs`다. My 탭은 확인된 검색 GHE login을 사용한다. PIPE의 Knox ID 문자열을 임의 치환하지 않는다. 계정 문맥 미제공 시 My 탭을 무조건 전체 PR 목록으로 실행하지 말고 안내한다. fixture의 demo identity는 명시적으로 표시한다.

### 6.3 필터

Filters는 기본 닫힘이다. 원본의 검색 입력을 임의로 필터 밖에 하나 더 만들지 않는다. `Status`, `Title · PR number · commit SHA`, `Author`, `Label`과 하나의 `Range filter` 선택기를 유지한다.

저장소/브랜치는 문맥 변경 시 적용, 일반 조건은 draft 후 Search 또는 Enter로 적용한다. 한글 IME 조합 Enter, 조건 수정 중 기존 적용값, 패널 닫기/열기, shortcut focus, Reset, URL 복귀를 각각 명세한다.

범위는 `PR number`, `M number`, `Merged date`, `Merge order`다. From/To는 한 줄에서 편집한다. PR 숫자 순서, M display number, first-parent merge_seq, SHA, 날짜의 의미를 바꾸지 않는다. 날짜는 API 원본의 timezone·포함/배제 경계를 확인하고 문자열을 임의 UTC 변환하지 않는다.

SHA 범위는 resolver로 실제 sequence에 연결한다. SHA 문자열 비교·숫자 평균·역전 자동 교환을 하지 않는다. 여러 후보면 첫 후보를 추측하지 않는다. 동일 저장소·Base branch·epoch 조건, 미채번, 비모호성, stale 응답을 검증한다. 원본 계약에 epoch 검증이 없다면 있다고 쓰지 말고 gap으로 남긴다.

여러 적용 범위가 동시에 존재하면 원본 query의 결합 의미를 그대로 설명한다. 숨겨진 적용 범위는 요약에서 확인할 수 있어야 한다. 미완성 draft가 다른 범위 제출을 막는 등 알려진 결함은 정상 사양으로 포장하지 않는다.

### 6.4 검색 실행과 결과

실제 source의 식별자 판별기와 query builder를 함께 확인한다. 검색어가 PR/SHA/GHE URL일 때와 구조화 질의일 때 어떤 endpoint를 호출하는지 추출한다. 식별자 resolve 경로에서 필터가 적용되는지, repo 문맥이 어떻게 붙는지도 코드대로 명시한다. 검색 문법을 새 정규식 하나로 재창조하지 않는다.

표 열은 `# / M number / Title / Author / Status / Merged at / Changes / Details`를 기본으로 한다. Search 기본 PR 내림차순, 원본 M 헤더의 `merge_seq` 정렬 요청, 병합일 정렬을 검증한다. 서버에서 정렬한 전체 결과와 클라이언트에서 받은 페이지만 정렬한 결과를 혼동하지 않는다.

원본 검색 결과는 50개 cursor 추가 조회다. infinite scroll은 결과 영역을 root로 사용한다. query/sort/order/scope가 바뀌면 페이지 연속성을 끊고 중복 요청과 늦은 응답을 차단한다. `total.relation=gte`, 종료 cursor, 추가 조회 실패, 수동 복구를 다룬다. 무한 스크롤을 일반 페이지 번호 UI로 바꾸지 않는다.

### 6.5 PR 상세와 식별자

PR 번호는 GHE 원문 링크, 제목/펼침 버튼은 행 아래 상세다. 한 번에 하나의 상세를 펼치는 현재 방식과 요청 타이밍을 유지한다. 본문, base/head branch, changed paths, source commits, View diff, View in GHE를 매핑한다.

null, 누락, 실제 0, 미수집, 일부 제공을 구별한다. 실제 없는 merge number, PR 연결, changed file count, 날짜를 생성하지 않는다. `Merged`를 PIPE Job `SUCCESS`로 변환하지 않는다.

M 표시 상태 `assigned/pending/not_applicable/unavailable`와 필드 미제공을 원본 helper에서 추출한다. 번호 문자열은 서버 값을 표시한다. 링크에 필요한 `repository/base branch/epoch/number`를 유지한다. 원본이 만드는 M 링크가 현재 기본 `/search` 진입에서 끝까지 처리되는지 실제로 추적한다. 링크 생성 함수만 보고 기능 완료로 판단하지 않는다.

### 6.6 Commit history

파일 선택 시 history로 전환하고 pinned revision을 유지한다. 추가 페이지를 읽는 동안 branch head가 움직여도 다른 스냅샷을 섞지 않는다. History의 `Load older commits`는 검색 목록의 infinite scroll과 다르므로 유지한다.

SHA·Linked PR 텍스트의 클릭 복사, 복사 실패, PR 연결 pending/없음/조회 실패를 구분한다. 두 revision 비교는 파일에서 정확히 두 개를 선택할 때만 가능하다. 폴더·루트는 안내를 보여주고 비교를 비활성화한다. 정렬·시간·rename 이력의 실제 한계를 적는다.

### 6.7 Diff와 Time-lapse

Diff는 changed files, split/unified, before/after revision, find, 이전/다음 위치, swap, 전체 행, 전체화면과 Time-lapse 진입을 포함한다. base/head pinning, PR 변경 중 페이지 로딩, added/removed/renamed/binary/oversize/missing file, 파일 목록 일부 제공을 재현한다.

split diff는 좌우 줄 대응을 유지하는 하나의 수직 비교 스크롤을 기본으로 한다. long line, 탭, 한글, 줄바꿈과 들여쓰기를 보존한다. 크기 제한을 임의로 늘려 브라우저를 멈추게 하지 않는다. 데이터·권한 체크를 재구현하지 말고 원본 API 상태를 렌더링한다.

Time-lapse는 파일 revision 선택, 이전/다음 이동, 선택 revision 정보와 코드/강조를 포함한다. 의미가 단순 diff인지 line trace인지 source helper에서 확인하라. slider를 전체 이력을 이미 받은 것처럼 표현하지 않는다. 부분 history와 현재 로딩 구간을 구분한다.

모달의 원본 테마 토글은 제외한다. PIPE 테마를 상속한다. 모달 드래그 등 보조 동작을 제외·대체하려면 별도 차이표에 이유를 남긴다. Diff 위에서 Time-lapse를 열 경우 두 모달의 Escape·focus 복귀·스크롤 잠금 소유권을 명확히 정한다.

## 7. 시각 품질: 기능은 유지하고 표현은 PIPE에 맞춰 완성한다

목표는 장식적인 랜딩 페이지가 아니라, 오래 읽고 반복 조작해도 피로가 적은 정밀한 개발자 검색 도구다. 원본의 정보 구조와 동작은 보존하면서, 정렬·여백·표 밀도·표면 계층·상태 피드백의 완성도를 높인다. 기본 MUI 데모를 그대로 붙인 모양이나 서로 다른 세 UI 라이브러리를 이어 붙인 모양으로 끝내지 않는다.

### 7.1 레퍼런스 적용 지침

아래는 채택할 디자인 방향이지 각 사이트의 코드를 복제하라는 지시가 아니다. 확인한 페이지와 관찰한 요소를 명시한다. 페이지에 접근할 수 없거나 화면을 보지 못했으면 미확인으로 남기고, 이 문서의 수치와 규칙으로 작업을 이어간다. 이전 대화에서 해당 사이트의 상세 분석이 이미 완료되었다고 가정하지 않는다.

| 레퍼런스 | 이 화면에 적용할 방향 | 적용하지 않을 것 |
|---|---|---|
| shadcn/ui의 data table 등 | 촘촘한 정보 계층, 절제된 테두리·행 피드백을 MUI로 재표현 | shadcn/Radix/Tailwind 의존성 설치, 새로운 pagination 의미 |
| Dark Design | 다크 테마에서 표면·테두리·보조 글자의 대비를 검토 | 강제 dark-first, 네온·glow·낮은 대비 |
| Layers | 제품 UI의 타이포·간격·반복 컴포넌트 일관성 목표 | 확인 안 된 유료 템플릿·실제 없는 기능 복제 |
| Supahero | 제목·설명·주요 동작의 시선 우선순위만 참고 | hero, 홍보 카피, 큰 배너, KPI 카드 |
| BeUI / Transitions | 펼침·모달·선택 상태의 짧은 전환 | 행별 등장 연출, spring, shimmer 무한 반복, 차트 애니메이션 |
| MUI v7 공식 문서 | 실제 Core 컴포넌트와 테마·구조 구현 | 최신 major의 API를 7.1에 바로 적용 |
| Ant Design 4.x 공식 문서 | PIPE의 기존 DatePicker/Tree wrapper 동작 확인 | v5 토큰 API나 후속 minor 전용 props 사용 |
| WAI-ARIA APG | 모달·탭·트리의 키보드와 focus 설계 검증 | 시각을 위해 의미·키보드 동작 제거 |

검토 링크:

```text
https://ui.shadcn.com/docs/components/data-table
https://dark.design/
https://getlayers.ai/
https://supahero.io/
https://beui.dev/
https://transitions.dev/
https://v7.mui.com/material-ui/react-table/
https://v7.mui.com/material-ui/customization/theming/
https://4x.ant.design/components/date-picker/
https://4x.ant.design/components/tree/
https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
```

추가 후보는 Mac App Supply, Loadmore, Beautiful UI, Rare UI, Realtime Colors, Coolors, Paletton, Khroma, Color Hunt, Stanley, Oh My Design, Lazyweb이다. 전부 조사하느라 포팅 명세를 지연시키지 않는다. 이번 화면에서 해결할 구체적 시각 문제가 있을 때만 선택한다. 외부 색상 팔레트보다 기존 PIPE 브랜드·테마가 우선이다.

### 7.2 디자인 토큰 제안

아래 수치는 PORT_DECISION의 기본값이다. 실제 PIPE 테마와 충돌하면 호환 가능한 최소 조정만 하고 변경표에 남긴다. 제공되지 않은 PIPE의 hex 색상·브랜드 폰트가 실제 값이라고 확정하지 않는다.

| 항목 | 기본 제안 | 검수 기준 |
|---|---|---|
| 페이지 제목 | 20px / 28px, 600 | 콘텐츠 내부에 한 번만, 큰 hero 없음 |
| 주요 본문 | 14px / 20px | 편집 필드와 설명의 리듬 일치 |
| 표 데이터 | 13px / 20px | 주요 내용을 11px 이하로 축소하지 않음 |
| 필드 라벨·보조 메타 | 12px / 18px | 작은 크기를 낮은 대비로 다시 약화하지 않음 |
| 코드·SHA | 기존 호스트 monospace, 12–13px | 코드와 식별자에만 사용 |
| 숫자 | tabular-nums | PR/M·날짜·diff 수치가 흔들리지 않음 |
| 간격 단계 | 4 / 8 / 12 / 16 / 24 / 32px | 임의 margin 누적 방지 |
| 콘텐츠 내부 여백 | desktop 24px, compact 16px | 호스트 여백과 중복 적용 금지 |
| 패널 간격 | desktop 24px | 좌측 문맥/우측 결과의 분리 |
| 입력·버튼 높이 | 일반 제어 40px | Select/TextField/DatePicker 외관 높이 일치 |
| 아이콘 버튼 | 32–36px, touch 40px 이상 목표 | 시각 아이콘보다 클릭 영역 확보 |
| 표 header / row | 40px / 44–48px | 제목 두 줄이면 행이 자연 확장 |
| 패널 radius | 10px | 큰 영역은 일관된 곡률 |
| 제어 radius | 6px | 기본 MUI·antd 간 외형 차이 최소화 |
| 테두리 | 1px divider 계열 | 표·입력·패널의 역할별 강도 구분 |
| 그림자 | 패널 거의 없음, overlay만 사용 | 카드 위 카드가 겹친 모습 금지 |
| motion | hover 100–120ms, collapse/dialog 140–180ms | reduced-motion에서는 제거·단축 |

색 역할은 호스트 theme의 `background.default`, `background.paper`, `text.primary`, `text.secondary`, `divider`, `primary.main`, `action.hover`, `action.selected`, `error.main`, `warning.main`, `success.main`에 연결한다. Merged/Open/Closed 배지는 텍스트와 아이콘으로 구분하며, PIPE Job의 SUCCESS/FAIL 배지를 의미까지 재사용하지 않는다.

hover, keyboard focus, expanded/selected, disabled를 서로 구분한다. 선택된 행은 primary를 약하게 활용하고, 오류 행 전체를 과도하게 붉게 칠하지 않는다. 정렬되지 않은 열은 활성 정렬 열과 같은 강도의 화살표로 보이지 않게 한다.

### 7.3 한 화면에서의 일관성

한 개의 compact field wrapper로 라벨 간격·높이·helper text·오류 위치를 통일한다. MUI Select와 antd DatePicker가 섞이는 곳은 wrapper에서 시각 정렬을 맞춘다. 전역 theme를 덮어쓰거나 body에 reset을 다시 적용하지 않는다.

스타일은 `pipe-pr-search` root 또는 feature 전용 styled/sx에 제한한다. 포털로 렌더링되는 Menu, Popper, DatePicker popup, Dialog는 root 바깥으로 나갈 수 있으므로, root descendant selector만으로 스타일이 적용된다고 가정하지 않는다. 호스트의 portal/container 정책과 해당 라이브러리 버전에서 지원하는 속성으로 정확히 지정한다.

ThemeProvider가 필요하면 기존 theme를 상속하는 좁은 범위로 제한하고 전역 provider를 새로 세우지 않는다. stylesheet 삽입 순서·z-index·font 상속·body scroll lock을 실제 PIPE에서 검증하게 한다. 컴포넌트를 unmount해도 global event listener나 스타일이 남아 다른 페이지를 바꾸면 실패다.

## 8. 콘텐츠 전용 레이아웃과 와이어프레임

모든 와이어프레임은 App Shell을 제외한다. `PIPE` 로고·상단 사용자 메뉴·전역 navigation을 그리지 않는다. 아래 예시 식별자·제목은 모두 합성 데이터다. 고정 UI 문구와 배치 주석은 구분하고, “스크롤 영역” 같은 설명 주석을 실제 운영 화면에 렌더링하지 않는다.

### 8.1 크기와 스크롤 계약

호스트가 제공하는 콘텐츠 폭을 W, 높이를 H로 둔다. 브라우저 화면 1440px를 콘텐츠 폭 1440px로 오해하지 않는다.

기본 desktop test frame은 W=1280, H=800이다. feature가 자체 여백을 소유하면 좌우 24px, 저장소 패널 260px, gap 24px, 결과 패널 948px가 된다. 호스트가 이미 여백을 제공하면 중복 padding을 제거하고 해당 모드를 명시한다.

```text
Root grid: 260px / minmax(0, 1fr)
좌측: 문맥 controls(auto) / tree(minmax(0, 1fr))
우측: tabs(auto) / filters(auto) / summary(auto) / results(minmax(0, 1fr))
```

부모 높이가 definite인지 확인한다. `height:100%`만 넣고 부모 높이가 없는 상태를 방치하지 않는다. grid/flex의 scroll 자식에는 필요한 `min-height:0`, `min-width:0`를 둔다. 원본의 shell 전용 viewport offset을 복사하지 않는다.

좌측 트리와 우측 결과는 서로 독립적으로 스크롤하되 외곽 패널 하단을 맞춘다. 우측 표의 수직 scroll owner는 하나다. 불필요한 중첩 scroll은 없애고, 긴 코드·표만 필요시 수평 스크롤한다. filters 확장은 남은 표 높이를 줄인다.

낮은 H나 확대 상태에서 조작부+최소 결과 높이가 들어가지 않으면 document-flow 모드로 전환한다. 무조건 overflow:hidden으로 입력·CTA를 잘라내지 않는다. 데스크톱 기준 좌우 하단 차이는 4px 이내를 목표로 검수하되, compact/document-flow에서는 이 기준을 강제하지 않는다.

### 8.2 기본 Search — 필터 닫힘

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PR Search                                                                       │
│                                                                                 │
│ ┌──────────────────────┐  ┌───────────────────────────────────────────────────┐ │
│ │ Find Repository      │  │ Search | Commit history | My open PRs | My merged │ │
│ │ [demo/modem       ▾] │  ├───────────────────────────────────────────────────┤ │
│ │ Base branch          │  │ Pull requests                          demo/modem │ │
│ │ [main             ▾] │  │ [Filters (2) ▾]                                    │ │
│ │                      │  │ Applied: Merged · Author dev-a                    │ │
│ ├──────────────────────┤  │ [Search ↵]  [Reset]                   Ctrl/Cmd + K │ │
│ │ Files & folders   ↻  │  ├───────────────────────────────────────────────────┤ │
│ │ main · a91bc21       │  │ 123 items                 PR descending       ↻   │ │
│ │ [Filter root entries]│  ├──────┬─────────────┬──────────────────┬────────────┤ │
│ │ / All changes        │  │ # ↓  │ M number    │ Title            │ …          │ │
│ │ ▾ src                │  ├──────┼─────────────┼──────────────────┼────────────┤ │
│ │   ▸ phy              │  │ #548 │ M-1900-42   │ RF update        │ …       ▸  │ │
│ │   ▸ l1               │  │ #547 │ Pending     │ NR fix           │ …       ▸  │ │
│ │   ▸ rrc              │  │ #546 │ —           │ L1 update        │ …       ▸  │ │
│ │ ▸ tests              │  │      │             │                  │            │ │
│ │                      │  │      결과 영역: 이 주석 대신 실제 결과 행 표시       │ │
│ │                      │  │                                           50 shown│ │
│ └──────────────────────┘  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

※ ASCII 폭 때문에 생략한 나머지 열은 별도 표로 빠짐없이 명시한다. 기본 Filters 닫힘에서 검색 입력을 새로 중복 노출하지 않는다. 활성 조건 요약은 숨겨진 필터를 인지시키는 용도이며, 기능에 없던 조건을 만들어내지 않는다.

### 8.3 Filters 펼침

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ Pull requests                                                   demo/modem     │
│ [Filters (4) ▴]                                                                │
│                                                                                │
│ Status       Title · PR number · commit SHA       Author          Label          │
│ [Merged  ▾]  [NR measurement                  ]  [dev-a       ]  [All labels ▾] │
│                                                                                │
│ Range filter                     From                    To                    │
│ [M number                    ▾]  [42                 ]  [80                 ] │
│ Applied: Status Merged · Author dev-a · M number 42–80                           │
│                                                                                │
│ [Search ↵] [Reset]                                                              │
└────────────────────────────────────────────────────────────────────────────────┘
```

검색어 필드에 가장 넓은 폭을 배정한다. 첫 줄은 예를 들어 `1fr 2.4fr 1.1fr 1.1fr`로 구성하고 범위 줄은 `1fr 1fr 1fr`로 맞춘다. 작은 폭에서는 두 줄·세로 배치로 변경한다. error/helper text 공간 변화로 옆 제어의 baseline이 어긋나지 않게 한다.

### 8.4 결과 표와 펼침 상세

| 열 | 기준 폭 | 정렬·표시 |
|---|---:|---|
| # | 64px | 왼쪽, PR 원문 링크 또는 commit 식별자 |
| M number | 132px | 서버 문자열·상태, 문맥 있는 경우만 링크 |
| Title | 남은 폭, 최소 220px | 최대 2줄 + 보조 scope, 상세 펼침 |
| Author | 92px | 긴 이름은 축약하되 전체 값 확인 가능 |
| Status | 84px | 아이콘+텍스트, 과도한 pill 장식 금지 |
| Merged at | 136px | 표기 시간대·정렬 계약 일치 |
| Changes | 92px | +/− 기호, 수치 정렬, null 보존 |
| Details | 40px | accessible button |

이 최소 폭 합계보다 결과 패널이 좁으면 표 내부 가로 스크롤을 허용한다. 주요 열을 아무 표시 없이 삭제하거나 글자를 줄여 억지로 맞추지 않는다.

```text
#548 | M-1900-42 | RF calibration update | dev-a | Merged | … | ▾
┌──────────────────────────────────────────────────────────────────────────────┐
│ feature/rf-fix → main                         [View in GHE ↗] [View diff]    │
│ PR description                                                               │
│ 합성 PR 본문. 실제 서비스에서는 원본 응답을 안전하게 표시한다.                 │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ Changed files                        │ Commit                                │
│ src/phy/rf_calibration.c              │ d71be10…                              │
│ src/phy/rf_config.h                   │ 클릭하면 full SHA 복사                │
└──────────────────────────────────────┴───────────────────────────────────────┘
```

기본안은 행 아래 상세다. 오른쪽 drawer 상세로 바꾸지 않는다. 목록 읽기 흐름과 펼침 위치를 보존한다. 본문을 Markdown/HTML로 렌더링할 때의 원본 처리와 보안 제약을 명시한다. 편의상 `dangerouslySetInnerHTML`로 신뢰하지 않은 내용을 넣지 않는다.

### 8.5 Commit history

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Search | Commit history | My open PRs | My merged PRs                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ src/phy/rf_calibration.c                                  main · a91bc21     │
│ Changes that touched this file                                              │
│ 50 loaded commits                  [Compare selected (2/2)] [Time-lapse]     │
├───┬───────────┬─────────────────────────┬────────────┬────────┬───────────────┤
│ □ │ Revision  │ Change                  │ Linked PRs │ Author │ Committed     │
│ ☑ │ d71be10…  │ RF update               │ #548       │ dev-a  │ Sep 19        │
│ ☑ │ c81fa22…  │ RF configuration        │ #527       │ dev-b  │ Sep 18        │
│ □ │ b12de43…  │ L1 update               │ Pending    │ dev-c  │ Sep 17        │
└───┴───────────┴─────────────────────────┴────────────┴────────┴───────────────┘
[Load older commits]
```

줄임표로 생략된 경우에도 실제 Inspect/Diff 등 원본 제어를 기능표와 최종 wireframe에서 빠뜨리지 않는다. 목록의 PR 링크와 history의 PR 복사라는 다른 동작을 tooltip/aria-label로 구분한다.

### 8.6 Diff와 Time-lapse

```text
┌─ DIFF · Pull request #548 ───────────────────────── [전체화면] [닫기] ┐
│ demo/modem · c81fa22 → d71be10                                       │
│ [Side by side | Unified] [Find in diff…] [↑] [↓] [Swap] [Time-lapse] │
├─────────────────────┬────────────────────────┬───────────────────────┤
│ Changed files       │ BEFORE                 │ AFTER                 │
│ [Filter files…]     │ 행 번호 / 코드         │ 행 번호 / 코드        │
│ rf_calibration.c    │                        │                       │
│ rf_config.h         │                        │                       │
└─────────────────────┴────────────────────────┴───────────────────────┘
```

```text
┌─ TIME-LAPSE · src/phy/rf_calibration.c ──────────────── [닫기] ┐
│ [이전] ──────────────●────────────────────── [다음]          │
│ Revision d71be10…   PR #548   dev-a   Sep 19                  │
├──────────────────────────────────────────────────────────────┤
│ 행 번호 │ 선택 revision의 코드와 원본 규칙에 따른 변경 강조 │
│         │                                                    │
└──────────────────────────────────────────────────────────────┘
```

Desktop dialog는 기본 `min(1280px, 가용 폭 - 48px)`, 높이 최대 `가용 높이 - 48px`를 제안한다. 전체화면 전환과 좁은 콘텐츠 폭에서는 host viewport에 맞춘다. 이는 원본 동작이 아니라 PORT_DECISION 치수다. 변경 파일 패널은 240–280px, 나머지는 코드에 배정한다. 툴바가 좁아지면 줄바꿈하되 닫기·찾기·현재 revision 정보에 항상 접근할 수 있어야 한다.

### 8.7 반응형 기준

| Search에 실제 주어진 콘텐츠 폭 | 구성 |
|---|---|
| 1120px 이상 | 260px scope 패널 + gap 24px + 결과 |
| 768–1119px | scope 패널을 로컬 ‘Repository & files’ 버튼으로 열기, 결과 폭 우선 |
| 768px 미만 | 한 열, 탭 가로 스크롤, 필터 세로, 소스 modal 전체화면 |

이 Drawer는 Search의 저장소 패널이며 전역 App Shell이 아니다. 결과 열을 영구 삭제하지 않는다. 200% 확대·가로 긴 파일명·짧은 viewport에서 key controls가 가려지는지 검증한다.

## 9. 상태 전이와 비동기 동작을 구현 가능한 수준으로 명세한다

이름만 있는 컴포넌트 트리로 끝내지 않는다. 누가 상태를 소유하고 어떤 이벤트로 무엇을 초기화하는지까지 기록한다.

| 상태 종류 | 소유자 | 기본 원칙 |
|---|---|---|
| 적용된 저장소·브랜치·탭·필터·정렬·경로 | URL codec + host route adapter | 공유·새로고침 가능, 원본 기본값 보존 |
| 입력 중인 조건 | filter draft state | 입력할 때마다 검색·URL 갱신하지 않음 |
| 결과 페이지·상세·트리·소스 응답 | PIPE의 기존 React Query client | 계정·문맥별 key, 중복 Recoil 저장 없음 |
| Filters 펼침·상세 펼침·모달 | feature local state | 검색 조건과 혼합하지 않음 |
| 비교할 두 revision | history local state | 같은 파일·revision 문맥에만 유효 |
| PIPE 로그인·공통 theme | host 제공 | Search가 재정의하지 않음 |
| 검색 identity/접속 상태 | 주입받은 문맥 | 실제 판정·발급은 다음 연동 작업 |

다음 이벤트 전이표를 실제 변수와 필드로 채운다.

```text
repository changed
base branch changed
tab changed
file/folder/root selected
filter draft changed
Search submitted
Reset clicked
sort changed
next page requested / failed
refresh requested
PR detail opened / closed
history page loaded
two revisions selected
Diff opened / closed
Time-lapse opened / closed
URL externally changed
search identity changed
component unmounted
```

각 전이마다 보존/초기화할 query, draft, cursor, selected row, source_ref, pinned revision, scroll position, comparison selection, modal, request cancellation을 명시한다. source의 replace navigation을 push로 바꾸거나, reset 범위를 직관에 따라 새로 정의하지 않는다. 필요한 변경은 PORT_DECISION으로 승인 범위를 표시한다.

특히 새 문맥을 요청한 동안 이전 저장소 결과를 새 저장소 헤더 아래 표시하지 않는다. 동일 조건 refresh는 기존 결과를 유지해도 되지만 이를 새 조회 완료로 오해시키지 않는다. 요청 취소를 지원하지 않는 transport라면 request generation/key 비교로 늦은 응답을 폐기하는 대안도 정의한다.

Infinite query는 원본 cursor만 사용한다. 페이지 번호로 가짜 cursor를 만들지 않는다. 첫 페이지 facet과 후속 페이지 facet 처리, 중복 ID 제거 여부, error retry 범위는 source대로 기술한다. React Query의 기본 자동 refetch/retry가 조사 중인 pinned source나 원본 no-auto-retry 규칙을 바꾸지 않도록 query별 정책을 명시한다.

### 예외 상태 매트릭스

| 상태 | 표시 위치 | 가능한 동작 | 해서는 안 되는 일 |
|---|---|---|---|
| 최초 로딩 | 각 패널 skeleton | 다른 PIPE 기능 사용 | 전역 loading으로 앱 잠금 |
| 검색어/범위 오류 | 해당 필드 + 요약 | 수정 후 재검색 | 보이지 않는 필드만 오류로 지목 |
| 0건 | 결과 empty state | 조건 수정·Reset | 통신 실패를 0건으로 표시 |
| 접근 가능한 저장소 없음 | scope panel | 안내 | 권한 밖 저장소 이름 노출 |
| 목록 API 실패 | 결과 영역 | 명시적 retry | 무한 자동 재요청 |
| 다음 페이지 실패 | 기존 행 + 하단 notice | 원본에 맞는 첫 페이지 복구 | 이미 표시한 행 삭제·중복 append |
| 트리만 실패 | 트리 영역 | 트리 retry | PR 검색까지 중단 |
| 상세만 실패 | 펼친 행 | 해당 상세 retry | 전체 화면 실패로 확대 |
| history의 PR lookup 실패 | history notice | 이력 조회 계속 | 연결 없음을 사실로 확정 |
| source 일부/비텍스트/너무 큼 | 모달 해당 영역 | 허용된 원문 열기·설명 | 빈 코드가 실제 소스인 것처럼 표시 |
| M pending/미제공 | 배지/열 | 사유 확인 | 번호·링크 생성 |
| epoch stale | 검색/번호 진입 | 다시 해석하도록 안내 | 옛 번호로 진행 |
| 검색 identity 미제공 | My 탭/접속 상태 | 외부 callback 또는 안내 | Knox 문자열로 사용자 추정 |
| 검색 연결 미설정 | Search notice | fixture 경로에서만 demo 가능 | 자동으로 production→mock 전환 |
| 검색 권한/접속 장애 | Search 영역 | 재시도·외부 연결 안내 | PIPE 전체 로그아웃 |
| 복사 실패 | 페이지 live region | 수동 선택·복사 안내 | 성공 toast 표시 |

## 10. API는 호출 계약까지만 분석한다 — 인증 구현은 다음 작업이다

이번 범위는 API 접근 경로·사용자별 인증·검색 권한 연결이 아니다. 이전 논의의 BFF/Integration Gateway는 별도 후보 설계이며 이번에 이미 존재하는 시스템으로 가정하지 않는다. 해당 구현을 시작하거나 포팅 완료 조건에 섞지 않는다.

대신 UI가 나중에 실제 transport만 교체하면 되도록 경계를 명확히 한다. fixture client와 실제 client는 동일한 호출 계약을 만족해야 한다. 미설정 실제 client는 명시적 ‘연결 미설정’ 오류를 반환하고, 인증을 끄거나 공용 서비스 계정으로 데이터를 조회하지 않는다.

### 10.1 추출할 계약

아래는 source 조사 시작점인 기존 pr-search web 경로다. PIPE에 이미 있다는 뜻이 아니며, `/api/v1` upstream과 구별한다.

| UI 기능 | 기존 web 경로 조사 시작점 |
|---|---|
| 저장소·sequence space | `GET /api/repositories` |
| 검색·facet·cursor·sort | `GET /api/search` |
| PR/SHA 해석 | `GET /api/resolve` |
| M 번호 진입 해석 | 실제 M-entry 사용 경로를 추적하여 기입 |
| PR 상세 | `GET /api/pull-requests/{encodedRepository}/{pr}` |
| commit 상세 | `GET /api/commits/{encodedRepository}/{sha}` |
| tree/history/file/diff | `GET /api/source/{encodedRepository}/{operation}` |

각 operation은 method, 실제 경로, query key, 필수/선택, 기본값, type, encoding, pagination, error code, response의 null/optional 의미를 추출한다. 실제 route/service 또는 계약 타입과 대조한다. 프런트엔드의 느슨한 local interface만 보고 API 전체가 그 모양이라고 확정하지 않는다.

`owner/repo`를 한 경로 세그먼트로 인코딩하는 규칙과 파일 path를 query로 인코딩하는 규칙을 명시한다. 브랜치 `/`, 공백·한글 path, URL query escaping을 fixture로 검증한다. 프록시 재설계나 임의 path 허용은 포함하지 않는다.

### 10.2 제안하는 UI 데이터 포트

아래 이름은 PORT_DECISION이다. 구현 시 사용할 메서드와 source 대응표를 네가 확정하되, 기존 서버 endpoint라고 표현하지 않는다.

```text
SearchDataPort
  listRepositories
  searchChanges
  resolveIdentifier
  resolveMergeNumber      실제 필요와 원본 계약 확인 후 확정
  getPullRequest
  getCommit
  getSourceTree
  getPathHistory
  getDiffMetadata
  getSourceFile
```

각 메서드의 arguments, response DTO, cancellation 방식, 실패 모양을 문서에 완전히 적는다. raw API DTO → UI model 변환에서 누락/null을 어떻게 보존하는지도 적는다. 새 status enum을 raw API에 끼워 넣지 않는다.

호스트 주입 계약은 다음을 포함한다.

```text
client                  위 데이터 포트
searchIdentity          확인된 identity 또는 unavailable/unconfigured 상태
navigation              현재 query 읽기·갱신·URL 생성·복귀
routeBase               고정 /search 대신 호스트 경로
externalSourceBase      GHE 원문 링크를 만들 때 필요한 설정
layout                  호스트 높이·폭·padding 소유권
onConnectionRequired    필요한 경우 호스트로 요청하는 callback, 인증 자체는 구현하지 않음
```

cache key에는 인증 사용자와 검색 문맥을 분리할 수 있는 식별값을 포함하되 토큰·쿠키·개인 credential을 넣지 않는다. identity 변경 시 cache clear/cancel을 어떻게 요청할지 정의한다. 실제 신원 확인은 UI가 수행하지 않는다.

### 10.3 URL과 링크

원본에서 다음 key를 확인하고 기본값·초기화 규칙을 기록한다.

```text
repository, base, tab, q, author, label, state
from, to, pr_from, pr_to, mnum_from, mnum_to
sort, order, path, path_kind, source_ref
m_repository, m_base_branch, m_seq_epoch, m_number
```

SHA 범위가 원본에서 URL에 영속되지 않는다면, 공유·refresh가 된다고 쓰지 않는다. 이 보완은 별도 변경으로 표시한다. 공유 주소에 cursor·토큰을 넣지 않는다. 앱 내부 링크와 GHE 외부 링크를 구분하고 routeBase를 사용한다. `/search`를 함수·모달·rename 링크 안에 하드코딩해서 PIPE 밖으로 이동시키지 않는다.

### 10.4 fixture 규칙

합성 데이터만 사용하고 실제 회사 코드·사용자·비공개 PR 본문·토큰을 복사하지 않는다. 모든 fixture는 추출한 실제 DTO와 맞아야 한다. 필요하면 TypeScript type-check 또는 현재 계약 validator로 확인하되 검증하지 못한 경우 명시한다.

기본 시나리오는 50/50/23개를 순차 조회하는 총 123건처럼 pagination이 실제 동작하는 형태로 만든다. 이 숫자는 demo 데이터이며 실제 시스템 지표가 아니다. 필터·정렬·resolver·source paging·예외 상태를 test별 명시 응답으로 정의한다. 간단한 fixture를 production 전체 검색 엔진처럼 구현하려고 하지 않는다.

M 번호/merge_seq/PR 번호의 의미는 source대로 유지하고 일부 PR 번호는 반영 순서와 다르게 배치한다. default PR 검색의 응답과 commit identifier resolve의 응답을 구분한다. PR 없는 direct push를 보여주려면 원본이 실제 commit을 반환하는 경로의 fixture에 넣고, `kind:pull_request` 결과에 임의 삽입하지 않는다.

fixture를 쓰는 preview에는 ‘Demo data · 실제 API 미연결’을 표시한다. 장애가 나면 몰래 fixture로 내려가는 fallback은 금지한다. 실제 연동과 fixture 검증의 완료 상태를 분리한다.

## 11. 프레임워크 포팅 설계

| 원본 | PIPE 대상 | 옮길 때 명세할 점 |
|---|---|---|
| Next `page.tsx`, GuardedPage, ReaderShell | 기존 호스트 route/권한 경계 | Search 콘텐츠만 export, shell·인증 이식 금지 |
| `next/navigation` | 설치된 React Router + adapter | replace/push·query·scroll 의미 보존 |
| `next/link` | Router Link 또는 실제 anchor | 새 탭·중간 클릭·링크 복사 유지 |
| Radix Tabs | MUI Tabs/Tab | 선택 상태·manual activation·focus 규칙 |
| Radix Collapsible | MUI Collapse | 닫힌 input 접근성·shortcut focus 해결 |
| reader FieldSelect | MUI Autocomplete/Select | source의 서버/로컬 필터와 pagination 유지 |
| 원본 DatePicker | 기존 PIPE antd DatePicker wrapper | 값 type·locale·timezone·clear/validation |
| 원본 Tree | 기존 wrapper 또는 antd Tree | lazy load, selected/expanded, keyboard, partial |
| 원본 Table | MUI Table 계열 | sticky head, sort label, single expandable detail |
| 원본 Badge | MUI Chip/Tooltip 또는 feature badge | 문자열·이유·linkability를 helper에서 분리 |
| 원본 Dialog/Slider | MUI Dialog/Slider | modal focus·scroll·overlay 중첩·revision 상태 |
| `useEffect` 기반 fetch | 기존 React Query 기반 hook | key·abort·retry·pinning·pagination semantics |
| original CSS tokens | PIPE theme + feature-scoped tokens | 전역 reset 없이 local density 맞추기 |
| Lucide 등의 아이콘 | PIPE에서 설치된 한 아이콘 계열 | 장식/의미 아이콘·aria-label 구분 |
| `@prs/query`, 표시 helper, source-analysis | 검증된 pure logic 이식/adapter | workspace alias 유입 없이 dependency closure |

`@prs/*` workspace dependency를 PIPE에 그대로 import하라는 지시로 끝내지 않는다. 재사용할 순수 함수를 식별하고, 알고리즘·필요한 상수·입출력·소규모 golden test를 제공한다. Next/Node/server-only/Redis/DB 종속이 따라 들어오지 않게 한다.

외부 순수 계산 라이브러리가 꼭 필요하면 이름·원본 버전·허용 범위·사용 심벌·라이선스·호스트 번들 호환성 확인 지점을 기록한다. PIPE 기존 의존성으로 해결 가능하면 우선 재사용한다. 누락 의존성을 발견했다고 임의 최신 버전으로 설치하거나 원본 diff를 가짜 문자열 비교로 대체하지 않는다.

특히 source helper를 이식할 때 newline, CRLF, no final newline, 한글, 빈 파일, rename, 파일 없음, 최대 계산량 같은 규칙을 golden test로 고정한다. 결과 계산을 바꾸는 개선은 시각 포팅과 분리한다.

### 컴포넌트 분해 제안

다음은 새 PIPE 파일 경로의 사실이 아니라 논리 구조 제안이다. PIPE 담당 Claude가 실제 저장소 convention에 맞춰 최종 경로를 정하도록 한다.

```text
PipePrSearchContent
├─ SearchConnectionNotice
├─ RepositoryScopePanel
│  ├─ RepositoryPicker
│  ├─ BaseBranchPicker
│  └─ SourceTreePanel
└─ SearchWorkspace
   ├─ SearchTabs
   ├─ SearchFilterPanel
   │  ├─ CommonFilterFields
   │  ├─ RangeFilterEditor
   │  └─ AppliedFilterSummary
   ├─ SearchResultsToolbar
   ├─ SearchResultsTable
   │  ├─ MergeNumberCell
   │  └─ ExpandedChangeDetail
   └─ CommitHistoryPanel
      ├─ RevisionSelectionToolbar
      └─ HistoryTable

Feature dialogs
  SourceDiffDialog
  FileTimeLapseDialog

Non-visual modules
  queryCodec / queryBuilder / identifierResolverAdapter
  mergeNumberPresentation / sourceAnalysis
  SearchDataPort / fixtureClient
  useRepositories / useSearchResults / useSourceHistory / useSourceFile
  navigationAdapter / featureTokens
```

각 컴포넌트에 input props, callback, local state, query dependency, skeleton/error/empty 처리, mount/unmount의 cleanup, 수용 테스트 ID를 붙인다. 컴포넌트가 전역 인증 토큰을 직접 읽는 구조는 피한다.

## 12. 최종적으로 만들어야 할 인수인계 묶음

중심 문서는 `PIPE_SEARCH_IMPLEMENTATION_PROMPT.md`다. 이 파일은 PIPE 담당 Claude에게 그대로 붙여넣는 실행 지시서여야 한다. 단순 링크 모음이나 “다음 문서를 읽고 알아서 설계하라”가 아니다.

다음 파일 구조를 기본으로 사용한다. 중복되는 원본 규칙은 기준 ID를 두되, 중심 문서에서 핵심 내용을 이해하는 데 외부 저장소 열람이 필요해서는 안 된다.

```text
pipe-search-port/
├─ README.md
├─ PIPE_SEARCH_IMPLEMENTATION_PROMPT.md
├─ SOURCE_EVIDENCE.md
├─ DESIGN_AND_WIREFRAMES.md
├─ API_AND_ADAPTER_CONTRACT.md
├─ PARITY_AND_ACCEPTANCE.md
├─ reference/
│  └─ PURE_LOGIC_REFERENCE.md
├─ fixtures/
│  ├─ SCENARIOS.md
│  └─ 각 시나리오에 필요한 합성 JSON 응답
└─ assets/
   └─ 실제 확보한 원본 화면 증거만, 없으면 생략
```

| 파일 | 반드시 들어갈 내용 |
|---|---|
| README | 받는 사람·실행 순서·기준 SHA·파일 목록·이번 범위·연동 미완료 표시 |
| PIPE_SEARCH_IMPLEMENTATION_PROMPT | PIPE 사전 점검 → 파일 구성 → 화면별 구현 → 검증 → 최종 보고까지의 직접 명령 |
| SOURCE_EVIDENCE | 기능 ID별 source SHA/path/symbol/lines, 실제 코드/문서/테스트 차이 |
| DESIGN_AND_WIREFRAMES | 콘텐츠 전용 wireframe, 치수, 토큰, column, interaction, state, responsive, portal |
| API_AND_ADAPTER_CONTRACT | 확인된 raw DTO, 요청/응답 예시, URL/query, client port, error, mock/live 경계 |
| PARITY_AND_ACCEPTANCE | 기능 동등성 표, 이식 차이·결함 처리, Given/When/Then, 시각 체크리스트 |
| PURE_LOGIC_REFERENCE | 필요한 원본 로직·상수·의존성·함수별 golden I/O·원본 위치 |
| fixtures | 정상·경계·오류·페이지·source 데이터를 동일 계약으로 재현하는 응답과 연결 규칙 |

`PURE_LOGIC_REFERENCE`는 전체 저장소 복사본이 아니다. 필요한 규칙만 완결된 단위로 전달한다. 런타임 소스 파일을 새로 구현하는 대신 문서의 코드 발췌/의사코드와 테스트 벡터로 전달할 수 있다. 타 저장소에서 접근할 수 없는 `@prs` 패키지를 “그대로 import”하라는 미해결 지시를 남기지 않는다.

중심 구현 지시서에는 핵심 DTO와 정상·오류의 대표 request/response, 네 범위의 query 생성·검증 규칙, 각 탭·클릭·modal 동작, 상태 초기화표, 주요 visual token과 wireframe, 기본 테스트를 직접 포함한다. 상세 fixture와 긴 참조 로직은 같은 묶음에 둔다. 산출물이 길어지는 이유는 실제 계약과 테스트여야 하며, 같은 목표 문장을 반복해서 분량을 늘리지 않는다.

파일 출력 기능이 없다면 파일명별 명확한 구분으로 문서 전체를 출력한다. 존재하지 않는 경로나 생성하지 않은 ZIP을 만들었다고 보고하지 않는다. 파일을 생성했다면 manifest에 크기·해시를 기록하는 것을 권장한다.

## 13. 수용 테스트: 숫자보다 중요한 것은 구체적 기대값이다

아래 테스트는 최종 구현 지시서의 최소 검증 범위다. 원본 테스트에서 확인한 동작은 해당 source test를 연결한다. 새 디자인·접근성 보완 테스트는 PORT_DECISION으로 표시한다. source에 없는 테스트를 이미 통과했다고 적지 않는다.

| ID | 상황/동작 | 핵심 기대값 |
|---|---|---|
| PS-T-001 | App Shell 없는 fixture mount | 콘텐츠만 렌더링, 로고/전역 메뉴/로그인 없음 |
| PS-T-002 | 기본 진입 | 네 탭 순서, Filters 닫힘, 원본 초기 repository·sort |
| PS-T-003 | 저장소 목록 여러 페이지 | 목록 추가 로딩·중복·미로드 deep link를 정확히 처리 |
| PS-T-004 | repository 변경 중 이전 요청 늦게 도착 | 새 문맥에 이전 결과·트리·cursor가 섞이지 않음 |
| PS-T-005 | base 변경 | scope-bound M/sequence/source 상태 정리 규칙 일치 |
| PS-T-006 | 한글 검색어 입력 후 조합 Enter | IME 확정만, 별도 Enter에서 검색 |
| PS-T-007 | 검색 입력 draft 수정/Filters 닫기 | submit 전 적용 조건이 조용히 바뀌지 않음 |
| PS-T-008 | PR 단일 식별자, SHA, GHE URL, 구조화 query | 실제 source대로 resolve/search 경로 선택 |
| PS-T-009 | 정상 PR 범위 | source와 동일한 query·경계·서버 결과 |
| PS-T-010 | M 범위, branch 미선택 | 필요한 문맥 안내, 임의 번호 공간 선택 없음 |
| PS-T-011 | 날짜 양쪽/한쪽/역전/경계 시각 | 계약의 validation·날짜 포함 의미 유지 |
| PS-T-012 | SHA 정상·다중 후보·미채번·다른 branch·역전 | 단일 유효 범위만 제출, 임의 후보/교환 없음 |
| PS-T-013 | 여러 적용 범위와 편집 유형 변경 | AND 의미 보존·활성 범위 요약·draft 분리 |
| PS-T-014 | Reset | source로 확정한 보존/초기화 규칙 일치 |
| PS-T-015 | 정렬 헤더 3종 | 서버 sort/order 요청, 로드한 행만 재정렬하지 않음 |
| PS-T-016 | 50/50/23 cursor 데이터 | 총 123개, 중복/유령 요청 없이 cursor 종료 |
| PS-T-017 | 다음 페이지 실패·cursor 무효 | 기존 행 유지, 자동 반복 중단, 명시적 복구 |
| PS-T-018 | total eq/gte | 정확한 개수와 하한 표기가 구분됨 |
| PS-T-019 | PR 번호·제목·펼침 버튼 | 외부 이동과 행 상세 동작이 섞이지 않음 |
| PS-T-020 | 한 행 펼친 뒤 다른 행 선택·상세 실패 | 원본 한 행 정책, 실패는 상세 안에 한정 |
| PS-T-021 | M 상태 4종·필드 미제공·commit 결과 | source helper대로 표시, 가짜 번호·링크 없음 |
| PS-T-022 | M 링크를 새 탭/주소 복사로 진입 | repo/base/epoch/number 보존, 실제 진입 처리가 동작 |
| PS-T-023 | Files root filter/lazy directory/root 선택 | 원본 탐색 범위·파일/폴더 의미 유지 |
| PS-T-024 | 긴 경로·한글·공백·branch slash | DTO/URL encoding과 레이아웃 유지 |
| PS-T-025 | history 추가 페이지 중 branch head 변경 | pinned revision 기준이 섞이지 않음 |
| PS-T-026 | history PR pending/없음/조회 실패 | 서로 다른 상태 표시, history는 필요시 계속 사용 |
| PS-T-027 | 파일 0/1/2개 revision 선택·폴더·루트 | Compare 활성 조건과 제한 정확 |
| PS-T-028 | Diff split/unified·find·swap·전체행 | 같은 source 데이터로 의미 보존 |
| PS-T-029 | rename/add/remove/binary/oversize/missing | 잘못된 빈 소스·가짜 텍스트 비교 금지 |
| PS-T-030 | Diff 페이지 로딩 중 PR base/head 변경 | 서로 다른 스냅샷 비교 중단·안내 |
| PS-T-031 | Time-lapse revision 이동·부분 history | 실제 로드 범위와 선택 revision 일치 |
| PS-T-032 | Diff → Time-lapse → 닫기 | topmost Escape, focus·scroll 문맥 복구 |
| PS-T-033 | Ctrl/Cmd+K, T, Ctrl+D와 입력/combobox | 검색 활성 영역만 반응, 기본 입력과 충돌 없음 |
| PS-T-034 | 키보드 tree/tabs/table/dialog 전 과정 | 이름·정렬·펼침 상태·focus 복구 확인 |
| PS-T-035 | clipboard 실패·미지원 | 성공으로 표시하지 않고 수동 복사 대안 |
| PS-T-036 | identity 미설정·변경 | My 탭 안내, 다른 사용자 캐시·데이터 누출 없음 |
| PS-T-037 | 검색 transport 장애/권한 오류 | Search에만 오류, PIPE 로그인 전역 동작 침범 없음 |
| PS-T-038 | preview와 실제 연결 미설정 | demo 명시, production 오류의 자동 mock 전환 없음 |
| PS-T-039 | 긴 제목·한글·unknown·+0/null 혼합 | 정렬과 정보 위계 유지, 누락과 0 구분 |
| PS-T-040 | component unmount 후 다른 PIPE 화면 | 이벤트·스타일·body lock·portal 잔류 없음 |
| PS-T-041 | 실제 대상 route 테스트 | legacy SearchView fixture만 테스트하고 완료하지 않음 |
| PS-T-042 | 공유 URL·새로고침·back/forward | 지원하는 조건 복원, 지원하지 않는 SHA 범위 명시 |

최종 Given/When/Then에는 합성 fixture 이름, 행/식별자, 실제 예상 query 또는 상태를 포함한다. “정상 동작한다”만 적지 않는다. 모든 필터 조합을 무작정 나열하기보다 source의 경계와 최근 결함을 우선한다.

## 14. 시각 품질 검수: ‘예쁘다’ 대신 확인 가능한 기준

PIPE 담당 Claude가 실제 화면을 렌더링한 후 확인할 항목을 별도 체크리스트로 만든다. pr-search 담당 Claude는 현재 단계에서 PIPE 렌더링을 했다고 주장하지 않는다.

| 시각 항목 | 합격 기준 |
|---|---|
| 정보 우선순위 | 저장소/브랜치, 결과 수, 제목, 상태, 보조 메타가 즉시 구별됨 |
| 컨트롤 정렬 | 같은 행의 MUI/antd 제어 높이와 라벨 baseline 일치 |
| 밀도 | 기본 desktop frame에서 불필요한 홍보/빈 영역 없이 결과 행을 충분히 표시 |
| 결과 가시성 | W1280×H800, 닫힌 필터·미펼침 상태에서 최소 8행을 목표로 하되 실제 source 헤더/호스트 공간 기준으로 보고 |
| 하단 정렬 | desktop bounded mode의 좌우 패널 하단 차이 4px 이내 목표 |
| 넘침 | 제목·파일명·한글·긴 URL 때문에 전체 화면이 수평으로 밀리지 않음 |
| 상태 분리 | hover/focus/expanded/disabled/error가 구별되고 색만 의존하지 않음 |
| 스크롤 | 필터와 table header가 안정적, nested double scroll로 작업 문맥을 잃지 않음 |
| 모달 | header/닫기/toolbar 접근 가능, overlay/popup이 clipping되지 않음 |
| 코드 가독성 | split diff 줄 대응·indent·long line 보존 |
| theme | PIPE 지원 theme에서 일관성 유지, 별도 전역 theme 토글 없음 |
| 전환 | 레이아웃 점프 최소화, reduced-motion 지원, 반복 장식 없음 |

검수 화면은 기본 검색, 필터 펼침, M/SHA 범위 오류, 행 상세, history 비교 선택, Diff split/unified, Time-lapse, 로딩/empty/error, 좁은 콘텐츠 폭을 포함한다. 예쁜 정상 데이터 한 장만 보고 완료하지 않는다.

검수 크기는 browser viewport뿐 아니라 실제 component bounding box를 함께 기록한다. 예시 콘텐츠 frame은 1280×800, 1120×680, 960×680, 720×800, 390×844다. 실제 PIPE route에서도 1440×900과 1366×768 브라우저 화면을 확인한다. 200% 확대도 검증한다.

자동 접근성 검사 외에 키보드와 Dialog focus 복귀를 직접 확인한다. 중요한 텍스트·control 대비를 theme별로 측정한다. 도구가 없으면 NOT RUN으로 남기며, 측정하지 않은 대비·프레임률·성능 수치를 작성하지 않는다.

성능은 pagination 증가에 따른 scroll·행 펼침·diff 작업을 측정한다. 가상화 라이브러리는 설치 여부와 실제 성능 필요가 확인될 때만 도입한다. 임의로 데이터 행을 삭제하거나 API 페이지 크기를 바꿔 성능을 맞추지 않는다.

## 15. 알려진 차이와 미확인 사항의 처리

첫째, 원본의 shell-specific 높이 계산은 콘텐츠 grid/flex 계약으로 바꾼다. 둘째, 원본 앱 전역 theme switch와 auth UI는 제거하고 host가 제공한다. 셋째, 원본에서 shell이 처리하던 shortcut focus 등은 기능을 잃지 않도록 콘텐츠 adapter로 연결한다. 이 세 가지는 예정된 포팅 차이다.

사전 검토에서 `DEV-728`은 실제 기본 Search가 아닌 legacy fixture 위주의 e2e 문제, `DEV-729`는 숨겨진 부분 범위 입력과 제출 문제로 언급되었다. 이 설명이 현재 저장소에도 맞는지 관련 코드·이슈 문서를 확인한다. 이미 해결됐다면 미해결이라고 복사하지 않는다. 해결되지 않았다면 동등성 대상 결함인지 포팅 보완인지 별도 결정표에 남긴다.

권장 판정은 다음과 같다.

| 상황 | 대응 |
|---|---|
| 문서와 코드가 다름 | 둘을 병기하고 실제 실행·테스트 근거로 현재 동작 설명 |
| 원본에 알려진 UX 결함 | 기존 production은 그대로, PIPE 보완을 별도 PORT_DECISION과 테스트로 명시 |
| PIPE 버전 미확인 | target preflight 항목·분기 규칙 작성, UI 명세 작성은 계속 |
| 인증/API 운영 계약 미확정 | transport interface와 fixture로 UI 구현 가능, 운영 연결은 별도 BLOCKED |
| source 필수 계약을 못 찾음 | 조사 경로·이유·영향을 명시하고 해당 항목만 BLOCKED, 나머지 계속 |
| 브라우저 실행 도구 없음 | 소스 기반 구조를 확정하고 runtime visual 검수는 NOT RUN |
| 새 기능 요구가 필요해 보임 | 선택 제안으로 분리, 기본 포팅 scope에 몰래 넣지 않음 |

“원본과 100% 같다”와 “숨겨진 결함을 개선했다”를 동시에 쓰지 않는다. 기능별 동등성, 의도적 차이, 환경 미검증을 구분한다.

## 16. PIPE 담당 Claude의 실제 작업 순서까지 작성한다

최종 구현 지시서의 수신자에게 다음 순서를 직접 지시한다.

| 단계 | PIPE에서 수행할 작업 | 검증 결과 |
|---|---|---|
| A. Target preflight | 버전·theme·router·API interceptor·test convention 확인 | 실제 값과 경로, 새 의존성 불필요 여부 |
| B. 호스트 경계 | content export·route adapter·layout·navigation·client·identity 주입 | App Shell 변경 없이 최소 fixture mount |
| C. 검색 골격 | 좌측 scope, 네 탭, compact Filters, 결과 table/상세 | 원본 기능 ID와 연결된 component test |
| D. 질의/데이터 | codec, pure helper, server sort/cursor, errors, 합성 client | golden query/DTO/pagination tests |
| E. Source 탐색 | tree/history/compare/diff/time-lapse | pinned revision·예외 파일·복사·focus tests |
| F. 시각 정제 | tokens, overflow, scroll, 팝오버, responsive, keyboard | 실제 route screenshot·bounding box·접근성 |
| G. 마무리 | lint/typecheck/build/대상 unit/e2e, 기존 화면 회귀 | PASS/FAIL/NOT RUN과 근거, API 미연결 명시 |

설치된 프로젝트 명령을 먼저 확인하게 하고 존재하지 않는 `npm run ...`을 만들어내지 않는다. 실패가 기존 실패인지 새 코드 회귀인지 분리한다. 테스트를 쉽게 통과시키려고 source assertion을 느슨하게 하거나 fixture의 문제가 있는 행을 지우지 않는다.

기능을 구현한 뒤 시각 검수를 생략하지 않는다. 반대로 고정 HTML screenshot만 만들고 검색·상세·pagination·revision 비교가 동작한다고 보고하지 않는다. 인증은 아직 연결하지 않아도 명시적 fixture로 모든 UI 상태를 동작 검증할 수 있어야 한다.

## 17. PIPE용 최종 구현 지시서의 시작과 필수 구성

네가 출력할 `PIPE_SEARCH_IMPLEMENTATION_PROMPT.md`는 아래 취지로 시작하라. 이것은 다시 검토 보고서를 써달라는 요청이 아니라 실제 구현 명령이어야 한다.

```text
너는 PIPE 저장소에서 작업한다.
이 문서와 첨부 계약/fixture/참조 로직을 기준으로,
기존 App Shell을 변경하지 않는 PipePrSearchContent를 구현하라.
이번 범위는 읽기 전용 Search 프런트엔드이며,
API Gateway·인증 위임·검색 권한 연결은 구현하지 않는다.
먼저 실제 PIPE 설치 버전·theme·router를 확인하고,
이 문서의 확정된 화면·행동·데이터·테스트 계약을 그 환경에 맞춰 구현한다.
pr-search 저장소 접근이 없어도 아래 명세로 작업을 진행할 수 있어야 한다.
```

이 시작문 뒤에 반드시 다음을 구체화하여 붙인다.

- source 기준선과 확인한 기능 범위, 포함/제외, 현재 primary route.
- PIPE 제공 스택과 실제 대상에서 검증할 지점·정해진 분기 규칙.
- App Shell 없는 component/host contract와 route adapter, 실제 파일 분해 제안.
- 화면별 wireframe, 토큰, 컬럼, 제어와 이벤트, 오류·empty·loading.
- DTO·API 요청·응답·query·cursor·M-link·history/diff의 완전한 핵심 계약.
- 옮길 pure logic과 참조 파일, source/target dependency 차이.
- fixture 모드 실행 경로, 실제 transport 미연결 표시, 계정 문맥 분리.
- 단계별 구현 순서와 테스트, 시각 검수, 완료 보고 형식.

빈 ‘추후 작성’, ‘원본을 참고’ 같은 자리는 남기지 않는다. 정말 미확인인 항목은 정확한 unknown과 별도 확인 방법을 적는다. 특히 PIPE의 실제 버전·경로는 알 수 없는 값이므로 검증할 수 있는 이름/파일/결정 규칙을 제시하고, 없는 사실로 채우지 않는다.

## 18. 작성 후 스스로 점검할 인수인계 품질

최종화 전에 다음 세 관점으로 문서를 검토하고 결함을 수정하라. 별도 에이전트가 없으면 네가 각각의 관점으로 검토하되 외부 독립 검토를 했다고 쓰지 않는다.

기능 검토: 모든 사용자-visible 제어가 source 근거와 목표 component에 연결되어 있는가? Search만 포팅한다며 history/diff를 빠뜨렸거나, shell을 제외하면서 필요한 shortcut까지 사라지지 않았는가? M-number와 merge_seq가 뒤바뀌지 않았는가?

이식 검토: PIPE에 없는 framework/package/API를 요구하지 않는가? raw DTO, null/optional, 오류, encoded path, cursor가 충분히 명시됐는가? 다음 세션이 pr-search 소스를 다시 찾지 않아도 되는가? 내부 URL/secret/비공개 data가 fixture에 섞이지 않았는가?

디자인 검토: ‘고품질’이 구체적인 spacing·font·table density·scroll·theme·modal·state·수용 기준으로 바뀌었는가? 기본 MUI 샘플 수준에서 끝나지 않도록 local tokens와 control 일관성 규칙이 있는가? 대시보드·hero·Regression 등 다른 제품으로 변질되지 않았는가?

### 원본 화면을 실제로 볼 수 있는 경우

기존 저장소의 안전한 dev/fixture 경로가 이미 제공돼 있으면 현재 기본 `/search`를 열어 DOM·computed style·실제 상태를 확인한다. 인증을 무력화하거나 production에 가짜 데이터를 넣지 않는다. 실제 화면 증거에는 기준 SHA, 실행 모드, viewport, 확인한 상태, source fixture ID를 기록한다. 이전 이미지나 legacy route screenshot을 현재 화면 증거로 재사용하지 않는다.

### 이번 세션의 최종 보고

최종 답변에는 분석 기준 SHA, 생성한 파일과 위치, 핵심 유지 기능, 명시적 포팅 차이, PIPE에서만 확인할 항목, 검증 결과를 짧게 제시한다. 운영 코드 변경 없음과 실제 API 미연결 상태를 분명하게 구분한다. 전체 인수인계 묶음을 사용자에게 전달 가능한 형태로 제공한다.

## 19. 사전 확인 근거와 참고 자료

아래는 이 지시서를 준비하면서 사용한 근거다. 다음 세션은 자신의 작업 기준선에서 실제 줄 범위·심벌을 다시 확정해야 한다. 아래 목록이 전체 구현 검증이나 PIPE 런타임 검증을 의미하지 않는다.

| 근거 | 확인된 내용 |
|---|---|
| `89sooner/pr-search` main 조회 | 사전 조회 SHA `03b80d21bfa10603d709ba14da3cdf058ab69279` |
| `apps/web/app/search/page.tsx` | 현재 기본 RepositoryWorkspace와 legacy 경로 분기 |
| `apps/web/components/RepositoryWorkspace.tsx` | 결과 열·행 아래 상세·M badge·외부 링크·source modal 진입 |
| `apps/web/lib/repository-search.ts` | 네 탭, 네 범위, query 생성, sort 기본값, SHA→sequence 검증 |
| 사용자 제공 `PIPE_PR_SEARCH_UI_UX_SPEC.md` | 기존 Search 이식 범위·layout·상태·target component 제안 |
| 사용자 제공 PIPE `system-overview.kr.md` | MUI 7.1, antd 4.20, RSuite 4.10, React/Axios/Recoil/React Query 현황 |

소스 permalink의 기준:

```text
https://github.com/89sooner/pr-search/blob/03b80d21bfa10603d709ba14da3cdf058ab69279/apps/web/app/search/page.tsx
https://github.com/89sooner/pr-search/blob/03b80d21bfa10603d709ba14da3cdf058ab69279/apps/web/components/RepositoryWorkspace.tsx
https://github.com/89sooner/pr-search/blob/03b80d21bfa10603d709ba14da3cdf058ab69279/apps/web/lib/repository-search.ts
```

외부 디자인/컴포넌트 문서는 §7의 링크를 사용한다. MUI v7 문서도 7.1과 정확히 같은 minor는 아닐 수 있으므로 코드 사용법은 PIPE 설치본의 타입·소스로 최종 확인한다. 레퍼런스는 표현 품질의 참고이고, 실제 source 계약과 PIPE 버전 제약보다 우선하지 않는다.

---

이제 저장소를 읽고 위 형식의 인수인계 묶음을 작성하라. pr-search 운영 구현을 변경하지 말고, PIPE 담당 Claude가 즉시 구현을 시작할 수 있도록 계약과 화면·테스트 지시를 구체화하라.
