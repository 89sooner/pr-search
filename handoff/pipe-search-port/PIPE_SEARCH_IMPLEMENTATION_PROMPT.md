# PIPE Search 구현 지시서

> 수신자: PIPE 저장소를 읽을 수 있는 Claude 세션 · 원본 기준 SHA `da0ed9b5bd8fac59c7fcf02c593f69962468be4d` · 작성일 2026-09-21

너는 PIPE 저장소에서 작업한다.

이 문서와 함께 온 계약·fixture·참조 로직을 기준으로, 기존 App Shell을 변경하지 않는 `PipePrSearchContent`를 구현하라. 이번 범위는 읽기 전용 Search 프런트엔드이며, API Gateway·인증 위임·검색 권한 연결은 구현하지 않는다. 먼저 실제 PIPE 설치 버전·theme·router를 확인하고, 이 문서의 확정된 화면·행동·데이터·테스트 계약을 그 환경에 맞춰 구현한다. pr-search 저장소 접근이 없어도 아래 명세로 작업을 진행할 수 있어야 한다.

## 0. 이 묶음의 파일

| 파일 | 언제 읽는가 |
|---|---|
| `PIPE_SEARCH_IMPLEMENTATION_PROMPT.md` | 이 문서. 처음부터 끝까지 읽고 순서대로 실행한다 |
| `SOURCE_EVIDENCE.md` | 특정 동작의 원본 근거와 줄 번호가 필요할 때. 기능 ID `PS-F-###`의 정의가 여기 있다 |
| `API_AND_ADAPTER_CONTRACT.md` | 요청·응답 계약을 구현할 때. 이 문서 5장의 요약본보다 자세하다 |
| `DESIGN_AND_WIREFRAMES.md` | 화면을 그릴 때. 와이어프레임, 치수, 토큰, 상태 전이표가 있다 |
| `PARITY_AND_ACCEPTANCE.md` | 이식 결정(`PD-###`)의 이유와 수용 테스트(`PS-T-###`)의 Given/When/Then |
| `reference/PURE_LOGIC_REFERENCE.md` | 순수 함수를 옮길 때. 알고리즘, 상수, golden 입출력 |
| `fixtures/SCENARIOS.md` | fixture client를 만들 때 |
| `fixtures/*.json` | 52개 합성 응답 |
| `fixtures/validate-fixtures.mjs` | fixture를 고친 뒤 반드시 돌린다 |

**중요한 규칙 하나.** 이 문서들에 "확인하지 못했다", `TARGET_VERIFY`, `NOT RUN`이라고 적힌 것은 **정말 확인되지 않은 것**이다. 1차 세션은 PIPE 저장소에 접근하지 못했고, 실행 중인 화면을 보지 못했으며, 대비비를 재지 못했다. 그 항목들을 확인된 사실처럼 다루지 마라.

반대로 `SOURCE_VERIFIED`라고 적힌 것은 기준 커밋의 소스에서 직접 읽은 것이다. 그것과 다르게 구현하려면 `PARITY_AND_ACCEPTANCE.md`의 차이표에 이유를 적는다.

## 1. 원본 기준선과 범위

### 1.1 기준선

| 항목 | 값 |
|---|---|
| 저장소 | `89sooner/pr-search`(내부 저장소. 너는 접근할 수 없다) |
| 커밋 | `da0ed9b5bd8fac59c7fcf02c593f69962468be4d` |
| 시각 | 2026-09-21 00:56:40 +0900 |

### 1.2 포팅 대상 화면

원본의 `/search` 경로는 환경 변수와 역할에 따라 **세 화면 중 하나**를 연다.

```text
PRS_LEGACY_SEARCH === '1'                     → SearchView            (대상 아님)
operator 역할 + ?legacy=1                      → LegacyRepositoryWorkspace (대상 아님)
그 외 = 운영 기본값                             → RepositoryWorkspace   ← 이것이 대상이다
```

**`RepositoryWorkspace`만 옮긴다.** 이 구분이 중요한 이유는 두 가지다. 첫째, 원본 저장소의 e2e 시험 전체가 `PRS_LEGACY_SEARCH=1`로 돌아 `SearchView`만 시험한다(`DEV-728`, 미해결). 따라서 "e2e가 통과한다"는 말이 이 화면의 동작 근거가 되지 못한다. 둘째, 세 화면이 같은 CSS 클래스와 같은 하위 컴포넌트를 공유하므로 근거를 섞기 쉽다.

### 1.3 포함과 제외

| 포함 | 제외 |
|---|---|
| 저장소 선택, Base branch 선택 | PIPE 로고, 전역 헤더, 전역 사이드 메뉴 |
| Files & folders 트리 | 새 App Shell, 공통 헤더·메뉴 재설계 |
| Search / Commit history / My open PRs / My merged PRs 네 탭 | 로그인·로그아웃 UI, 사용자 메뉴, 전역 테마 토글 |
| 필터와 네 종류의 범위 편집 | Regression, bisect, MDVP 화면 |
| 결과 표, 서버 정렬, cursor 추가 조회 | Job 생성·승인·재실행, PR 본문 수정 |
| 행 아래 PR·commit 상세 | 운영·관리 화면, 권한 관리 화면 |
| 경로 이력, 두 revision 비교 | 검색 데이터의 PIPE DB 재수집·동기화 |
| Diff와 파일 Time-lapse | API Gateway, BFF, JWT, 세션 발급, Redis 연결 |
| 검색 문맥 URL, 복사, GHE 원문 링크 | 새 검색 엔진, 새 M 번호 계산, 새 권한 판정 |

저장소·파일 사이드 패널은 **Search의 콘텐츠이므로 포함한다.** 제외 대상인 전역 navigation과 혼동하지 마라. Search 안의 지역 탭도 유지한다.

## 2. A단계 — PIPE 환경 점검 (구현 전에 반드시 먼저)

아래는 1차 세션이 사용자에게서 전달받은 현황이다. **1차 세션이 PIPE의 lockfile을 확인한 것이 아니다.** 네가 직접 확인한다.

| 항목 | 전달받은 현황 | 이식 원칙 |
|---|---|---|
| 프런트엔드 | React | 실제 React/React DOM 버전을 확인한다 |
| 주 UI | MUI 7.1 | 새 Search의 기본 컴포넌트 체계 |
| 보조 UI | Ant Design 4.20 | 기존 날짜·트리 wrapper 재사용에 **한정한다** |
| 기존 다른 UI | RSuite 4.10 | 이미 있어도 새 결과 표에 섞지 않는다 |
| API client | Axios, `frontend/src/apis/fetcher.js` | 이번에는 transport 경계만 정의하고 fixture에 연결한다 |
| 서버 상태 | React Query, `commons/hooks/query/client.js` | 설치된 major와 import 경로를 확인하고 쓴다 |
| 공통 상태 | Recoil, `services/global.js` | 기존 호스트 상태만 쓴다. **검색 응답을 중복 저장하지 않는다** |
| 라우팅 | 기존 React Router | 버전을 확인하고 route adapter에서만 연결한다 |
| 코드 스타일 | JS 파일 사용이 확인된 문서 | 실제 JS/TS 정책을 따른다. TS 전환을 강제하지 않는다 |
| 서버 | Django/DRF, MySQL, Redis | 이번 프런트엔드 이식에서 변경하지 않는다 |
| 인증 | PIPE JWT, 중앙 fetcher의 401 처리 | 실제 연결은 다음 작업. **이식 중 인증을 우회하지 않는다** |

### 2.1 반드시 확인하고 기록할 것

1. `frontend/package.json`과 lockfile의 실제 내용
2. React와 React DOM의 정확한 버전
3. MUI의 패키지 이름과 major(`@mui/material`의 버전), Emotion의 설치 여부와 버전
4. antd의 정확한 버전과 어떤 wrapper가 이미 있는지
5. React Query가 `react-query`인지 `@tanstack/react-query`인지, 그리고 major
6. React Router의 major(v5와 v6은 API가 다르다)
7. Axios의 버전과 중앙 `fetcher`의 인터셉터가 하는 일(특히 401 처리)
8. 기존 테마 provider의 위치와 theme 객체의 모양
9. 공통 form·table wrapper가 이미 있는지
10. 테스트 도구(무엇으로 무엇을 어떻게 돌리는지)와 실제 존재하는 명령 이름
11. 국제화·날짜 라이브러리
12. 폰트와 아이콘 계열
13. CSS 주입 순서(Emotion과 antd 중 어느 쪽이 뒤인가)
14. 모달·팝오버의 container 정책과 z-index 기준선
15. `@mui/icons-material`의 설치 여부
16. **`diff` npm 패키지의 설치 여부와 버전** (5.7장 참조)
17. **App Shell이 이미 `Ctrl/Cmd+K`를 쓰고 있는지** (`PD-009`)

### 2.2 하지 말아야 할 가정

- `react-query`와 `@tanstack/react-query`를 같은 것으로 취급하지 마라.
- Router v5와 v6을 같은 것으로 취급하지 마라.
- MUI Core와 MUI X를 같은 것으로 취급하지 마라. **MUI X DataGrid, Tree View, Date Pickers가 설치되어 있다고 가정하지 마라.**
- MUI 7.1.0과 7.x 최신 문서 사이의 minor 차이를 무시하지 마라. 실제 설치본의 타입으로 확인하라.
- Ant Design 4.x 최신 문서의 기능이 4.20에도 있다고 가정하지 마라. v5의 토큰 API를 쓰지 마라.

### 2.3 새로 설치하지 않을 것

Next.js, Radix, shadcn, Tailwind, Framer Motion, 새 전역 CSS reset을 이 포팅만을 위해 도입하지 않는다. 유료 패키지, 새 차트·코드에디터 의존성도 마찬가지다. 참조한 디자인 사이트의 미감을 위해 새 스택을 설치하라는 지시가 **아니다.**

`diff` 패키지가 없다면 그것만이 유일한 후보이며, 추가 전에 사람에게 확인받는다(5.7장).

### 2.4 A단계의 산출물

확인한 실제 값의 표. 각 항목에 파일 경로와 버전을 적는다. 확인하지 못한 항목은 그렇게 적는다.

## 3. B단계 — 호스트 경계

### 3.1 주요 export

```text
PipePrSearchContent
```

셸에 종속되지 않는 **콘텐츠 컴포넌트**다. 호스트가 theme, 라우터, 콘텐츠 높이·폭, 검색 client, 확인된 검색 사용자 문맥을 제공한다.

### 3.2 주입 계약

```ts
interface PipePrSearchContentProps {
  client: SearchDataPort;                 // 5.8장

  searchIdentity:
    | { kind: 'ready'; gheLogin: string; cacheKey: string }
    | { kind: 'unavailable' }
    | { kind: 'unconfigured' };

  navigation: {
    getQuery(): URLSearchParams;
    replace(next: URLSearchParams): void;   // 기본. 이력에 쌓지 않는다
    push(next: URLSearchParams): void;
    buildUrl(next: URLSearchParams): string;
    subscribe(listener: () => void): () => void;
  };

  routeBase: string;                      // 예: '/pr-search'. '/search'를 하드코딩하지 않는다
  externalSourceBase?: string;            // GHE 기준 URL. 없으면 외부 링크를 만들지 않는다

  layout?: {
    padding?: 'self' | 'host';            // 기본 'self'
    height?: 'bounded' | 'auto';
  };

  onConnectionRequired?: (reason: 'unauthenticated' | 'unconfigured') => void;
}
```

`searchIdentity`의 `cacheKey`는 **호스트가 만드는 불투명한 식별값**이다. 사용자 이름도 토큰도 아니다. React Query key에 이것만 넣고 credential은 절대 넣지 않는다.

### 3.3 route adapter

기존 `/pr-search` 같은 **이미 승인된 위치**에 콘텐츠를 연결하는 최소 범위만 만든다. 전역 메뉴 항목 추가, 메뉴 순서 변경, 기존 shell CSS 수정은 이번 범위가 아니다.

route adapter가 하는 일은 셋뿐이다.

1. 호스트 라우터의 query를 `navigation` 계약으로 감싼다.
2. 호스트의 검색 client(또는 fixture client)를 `client`로 넘긴다.
3. `routeBase`를 그 경로로 넘긴다.

### 3.4 B단계의 완료 조건

App Shell을 전혀 바꾸지 않은 채로, 최소 harness에서 `PipePrSearchContent`가 fixture client로 마운트된다. `PS-T-001`이 통과한다.

## 4. C단계 — 검색 골격

`DESIGN_AND_WIREFRAMES.md` 3~4장의 격자와 와이어프레임을 따른다. 여기에는 반드시 지켜야 할 것만 적는다.

### 4.1 레이아웃

```text
루트 격자    260px / minmax(0, 1fr),  gap 24px
좌측         문맥 제어(auto) / 트리(minmax(0, 1fr))
우측         탭(auto) / 필터(auto) / 결과 머리글(auto) / 결과(minmax(0, 1fr))
```

**`100vh`와 `100dvh`를 쓰지 않는다.** 원본은 `calc(100dvh - 48px)`와 `calc(100dvh - 460px)`를 쓰지만 그 값들은 pr-search App Shell의 121px 크롬을 전제로 손으로 맞춘 상수다. 다른 호스트에서는 아무 의미가 없다(`PD-005`).

격자와 flex의 스크롤 자식에 `min-height: 0`과 `min-width: 0`을 준다. 수직 스크롤 소유자는 좌측에 하나, 우측에 하나, 합쳐서 둘뿐이다. 중첩 이중 스크롤을 만들지 않는다.

부모 높이가 확정되지 않았는데 `height: 100%`만 넣는 상태를 만들지 않는다. 확인할 수 없으면 `document-flow` 모드를 기본으로 한다.

### 4.1.1 기본 Search 화면 (필터 닫힘)

`※`로 시작하는 줄은 배치 주석이며 **실제 화면에 렌더링하지 않는다.** 식별자와 제목은 합성 데이터다.

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ┌──────────────────────┐  ┌───────────────────────────────────────────────────┐ │
│ │ Find Repository      │  │ Search | Commit history | My open PRs | My merged │ │
│ │ [demo/modem       ▾] │  ├───────────────────────────────────────────────────┤ │
│ │ Base branch          │  │ REPOSITORY WORKSPACE                              │ │
│ │ [main             ▾] │  │ Pull requests                     ⌷ demo/modem    │ │
│ ├──────────────────────┤  │ [Filters (2) ▾]                                   │ │
│ │ Files & folders   ↻  │  │ [Search ↵]  [Reset]               ⌘ K Quick search│ │
│ │ ⌥ main  a91bc21      │  ├───────────────────────────────────────────────────┤ │
│ │ [Filter root entries]│  │ ⌸ Pull requests 123 items   PR Descending      ↻  │ │
│ │ [/ All changes     ] │  ├──────┬───────────┬────────────────────┬───────────┤ │
│ │ ▾ src                │  │ # ↓  │ M number  │ Title              │ …         │ │
│ │   ▸ phy              │  ├──────┼───────────┼────────────────────┼───────────┤ │
│ │   ▸ l1               │  │ #548 │ M-1900-42 │ RF calibration upd │ …      ▸  │ │
│ │   ▸ rrc              │  │ #547 │ Awaiting… │ NR measurement fix │ …      ▸  │ │
│ │ ▸ tests              │  │ #546 │           │ L1 scheduler tweak │ …      ▸  │ │
│ │   README.md          │  │ #545 │ M-1900-41 │ RRC timer cleanup  │ …      ▸  │ │
│ │                      │  │                                        50 shown   │ │
│ └──────────────────────┘  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
※ 좌측 260px, gap 24px, 우측이 남은 폭. 페이지 제목은 우측 패널 안에 한 번만 둔다.
※ 필터가 닫혀 있어도 검색어 입력을 밖에 다시 만들지 않는다.
※ #546처럼 M 키가 없는 행은 셀을 비운다. 배지 자체를 그리지 않는다.
```

결과 표의 여덟 열은 다음과 같다. ASCII에서 생략된 것을 포함해 전부다.

| 열 | 기준 폭 | 정렬 가능 | 내용 |
|---|---:|---|---|
| `#` | 64px | 예(`pr_number`) | PR이면 `#1842`, 커밋이면 SHA 앞 12자. GHE 새 탭 링크. monospace |
| `M number` | 132px | 예(`merge_seq`) | 서버가 준 문자열 또는 상태 라벨. `assigned`일 때만 링크 |
| `Title` | 남은 폭, 최소 220px | 아니오 | 최대 두 줄. 아래에 `sequence_space` 보조 메타. 누르면 상세가 펼쳐진다 |
| `Author` | 92px | 아니오 | 두 글자 아바타 + 이름. 없으면 `—` |
| `Status` | 84px | 아니오 | 아이콘 + 텍스트. `Merged` / `Open` / `Closed` / `—` |
| `Merged at` | 136px | 예(`merged_at`) | `YYYY-MM-DD HH:MM UTC`. `tabular-nums` |
| `Changes` | 92px | 아니오 | `+N`과 `−N`. **`null`과 `0`을 구별한다** |
| (상세) | 40px | 아니오 | `aria-label`을 가진 아이콘 버튼 |

최소 폭 합계는 860px이다. 결과 패널이 그보다 좁으면 **표 안에서만** 가로 스크롤한다. 열을 말없이 지우지 않는다.

필터를 펼치면 첫 줄이 `Status` / `Title · PR number · commit SHA` / `Author` / `Label`이고 격자는 `1fr 2.4fr 1.1fr 1.1fr`이다. 둘째 줄이 `Range filter` 선택기와 From/To 두 칸이며 격자는 `1fr 1fr 1fr`이다. 그 아래에 활성 범위 요약, 그 아래에 `Search` / `Reset`이 온다.

행 상세는 **행 아래 펼침**이다. 오른쪽 drawer로 바꾸지 않는다. 머리글에 `{head} → {base}`와 `View in GHE` / `View diff`, 그 아래 본문(평문), 그 아래 `Changed files`와 `Commit` 두 열(3:2, gap 20px)이 온다.

나머지 화면(Commit history, Diff, Time-lapse)의 와이어프레임은 `DESIGN_AND_WIREFRAMES.md` 4.5~4.7장에 있다.

### 4.2 좌측 문맥 패널

| 제어 | 규칙 |
|---|---|
| Find Repository | MUI `Autocomplete`. 고르면 `base`, `path`, `mnum_from`, `mnum_to`를 **함께 비운다** |
| 목록 이어 읽기 | 하단 `Load more` 행. 누르면 목록이 **열린 채로** 다음 페이지를 붙인다(`PD-003`) |
| 타이핑 필터 | **불러온 페이지에만 걸린다.** cursor가 남아 있으면 `불러온 N개 중에서 찾고 있습니다` 안내를 반드시 보인다 |
| 아직 안 불러온 저장소 deep link | URL의 저장소가 목록에 없으면 그 값을 **임시 항목으로 추가**해 빈칸을 막는다 |
| Base branch | `All branches`(빈 값) + `sequence_spaces[].base_branch`. 고르면 `mnum_from`/`mnum_to`를 draft와 URL 양쪽에서 비운다 |
| Files & folders | 아래 4.3 |

### 4.3 파일 트리

| 항목 | 규칙 |
|---|---|
| 루트 조회 | `getSourceTree({ repository, ref: base })` |
| 머리글 | `ref`의 앞 35자와 `revision`의 앞 7자를 보인다 |
| `Filter root entries` | **루트 항목의 이름만** 소문자 부분 문자열로 거른다. 재귀 파일 검색이 아니고 코드 본문 검색이 아니다. 저장소·브랜치가 바뀌면 비운다 |
| 폴더 펼침 | `getSourceTree({ repository, revision, treeSha: entry.sha, path: entry.path })`. 선택 경로가 `entry.path + '/'`로 시작하면 자동으로 펼친다 |
| 선택 가능 | directory, file, symlink. **submodule은 `aria-disabled`이고 선택되지 않는다** |
| 키보드 | 목록이 `↑ ↓ Home End`를, 항목이 `→ ← Enter Space`를 소유한다. `Enter`/`Space`는 선택과 펼침을 함께 한다 |
| `/ All changes` | `{ path: '', kind: 'directory', revision }` |
| 부분 목록 | `truncated`면 `Directory listing is partial.`을 보인다. 하위 폴더도 같다 |
| 선택의 결과 | `{ path, path_kind, source_ref: revision, tab: 'history' }`로 이동한다. **탭이 Commit history로 자동 전환된다** |

### 4.4 네 탭

순서와 문구는 `Search` / `Commit history` / `My open PRs` / `My merged PRs`다. MUI `Tabs`를 쓰되 **수동 활성화**로 맞춘다. 화살표로 focus만 옮기고 `Enter`/`Space`를 눌러야 전환되어야 한다. 원본이 Radix의 `activationMode="manual"`을 쓰기 때문이다.

`Commit history` 탭에서는 결과 표 대신 경로 이력 패널을 그리고, **검색 필터 form 자체를 렌더링하지 않는다.**

My 탭은 확인된 검색 GHE login을 쓴다. **PIPE의 Knox ID 문자열을 임의로 치환하지 마라.** `searchIdentity`가 `ready`가 아니면 조회하지 않고 안내한다. 계정 문맥이 없다고 전체 PR 목록을 조회하면 안 된다.

### 4.5 필터

| 항목 | 규칙 |
|---|---|
| 기본 상태 | **닫힘** |
| 제목 | `Filters` 또는 `Filters (N)`. N은 `q` + (search 탭에서만) `author` + `label` + (search 탭에서만) `state`의 비어 있지 않은 개수 + 활성 범위 개수 |
| 닫혀 있을 때 | **검색어 입력을 밖에 다시 만들지 않는다.** 활성 개수와 범위 요약이 숨은 조건을 알린다 |
| 접힌 상태의 DOM | `q` 입력을 DOM에 남겨 둔다(CSS로 숨긴다). 단축키가 찾을 수 있어야 한다 |
| Status | `All states` / `Open` / `Merged` / `Closed`. My 탭에서는 비활성이고 값이 탭 이름으로 고정된다 |
| `Title · PR number · commit SHA` | 자리표시자 `Keywords, #1842, or commit SHA…` |
| Author | search·history 탭에서만 편집 가능. My 탭에서는 login을 읽기 전용으로 보인다 |
| Label | `All labels` + **현재 적용된 값** + 응답 facet의 값들. 중복 제거. 현재 값이 맨 앞 |
| 제출 | form의 submit이다. 필터 안 어느 입력에서든 `Enter`가 제출이 된다. 단 **IME 조합 중 `Enter`는 제외한다**(`PS-T-006`) |
| 버튼 문구 | `Search` → `Resolving…`(SHA 해석 중) → `Searching…` |
| Reset | 12개 필터 key와 SHA 두 칸과 `seqRange`를 비우고 범위 유형을 `PR number`로 되돌린다. **`repository`·`tab`·`sort`·`order`는 남긴다** |

### 4.6 Range filter

**한 번에 한 유형의 입력만 보인다.** 유형은 넷이다.

| 유형 | 입력 | 비활성 조건 |
|---|---|---|
| `PR number` | 숫자 두 칸, `min=1` | 없음 |
| `M number` | 숫자 두 칸, `min=1` | 저장소나 base branch가 없으면. 사유를 함께 말한다 |
| `Merged date` | 날짜 두 칸(`YYYY-MM-DD`) | 없음. `Clear`와 `Today` 제공 |
| `Merge order` | 텍스트 두 칸, 자리표시자 `7+ character SHA` | 저장소나 base branch가 없으면 |

초기 유형은 URL에서 되살린다: `pr_from`/`pr_to`가 있으면 `pr`, `mnum_*`이면 `mnum`, `from`/`to`면 `date`, 아무것도 없으면 `pr`. **`seq`는 URL에 남지 않으므로 복원되지 않는다**(`PD-010`).

활성 범위 요약은 선택되지 않은 유형의 조건까지 **전부** 보인다. `PR 1842–2044 · M 42–80` 형태로 ` · `로 잇는다. 양쪽 값이 모두 있어야 활성으로 센다.

`Merge order`가 적용된 상태에서는 요약에 `Merge order set (공유 주소에는 포함되지 않습니다)`를 붙인다.

**검증 규칙**(`PD-002`, 원본과 다르다): 제출 직전 검사는 **현재 선택된 범위 유형에만** 적용한다. 선택되지 않은 유형의 반쪽짜리 값은 오류를 내지 않고 제출 시점에 함께 비운다. 원본은 여기서 하드 오류를 내고 화면을 그 유형으로 되돌리는데, 그것은 `DEV-729`로 등재된 미해결 결함이며 사양이 아니다.

### 4.7 날짜 선택기

값은 **로컬 달력 기준 `YYYY-MM-DD` 문자열**이다. **시간대 변환을 하지 않는다.** antd `DatePicker` wrapper를 쓴다면 그 wrapper가 무엇을 반환하는지 확인하고(`dayjs` 객체일 가능성이 높다) 반드시 이 문자열로 정규화한다.

서버 쪽 의미는 확인했다(`API_AND_ADAPTER_CONTRACT.md` 8.1장).

```text
merged:2026-01-01..2026-02-01
  → merged_at >= 2026-01-01T00:00:00Z  AND  merged_at <= 2026-02-01T00:00:00Z
```

경계는 **양쪽 모두 포함**(`gte`/`lte`)이고, 질의에 `time_zone`이 없으므로 Elasticsearch가 **UTC로 해석한다.** 양쪽 값이 모두 있어야 하며 한쪽만 주면 서버가 거절한다. 날짜만 주는 형태와 시각까지 주는 형태를 둘 다 받고, 실재하지 않는 날짜(`2026-02-30`)는 따로 거절된다.

여기서 나오는 결과 하나를 알고 있어라. `to` 경계가 **그날의 시작**이므로 `2026-02-01`을 고르면 그날 0시 이후에 병합된 PR이 빠진다. 한국 시간대 사용자는 2월 1일 오전 9시 전까지만 받는다. **이것은 원본의 동작이며 바꾸지 않는다**(서버 계약을 바꾸는 일이다). 다만 `Merged before`에 "그날 0시 기준"이라는 helper text를 붙이는 것은 허용한다. 질의 값을 바꾸지 않기 때문이다.

## 5. D단계 — 질의와 데이터

### 5.1 질의 문자열 생성

이것이 이번 포팅에서 **한 글자도 달라지면 안 되는** 부분이다. 전체 알고리즘과 19개 golden 벡터는 `reference/PURE_LOGIC_REFERENCE.md` 1.1장에 있다. 요약하면 이렇다.

```text
filters = []
filters.push(`kind:${tab === 'history' ? 'commit' : 'pull_request'}`)
filters.push(`repo:${JSON.stringify(repository)}`)

['base', 'author', 'label', 'path', 'state'] 순서로:
    값이 없으면 건너뛴다
    My 탭에서는 'state'와 'author'를 건너뛴다
    'state'는 `is:${값}` (인용하지 않는다)
    나머지는 `${key}:${JSON.stringify(값)}`

My 탭이면: filters.push(`author:${JSON.stringify(login)}`, `is:${tab}`)

from과 to가 둘 다 있으면          filters.push(`merged:${from}..${to}`)
pr_from과 pr_to가 둘 다 있으면    filters.push(`pr_number:${prFrom}..${prTo}`)
mnum_from과 mnum_to가 둘 다 있으면 filters.push(`mnum:${mnumFrom}..${mnumTo}`)
seqRange가 있고 그 space === `${repository}@${base ?? ''}` 이면
                                   filters.push(`seq:${seqRange.range}`)
q를 trim한 값이 있으면             filters.push(그 값)   ← 인용하지 않는다

return filters.join(' ')
```

지켜야 할 다섯 가지.

1. 모든 조건은 공백으로 이어 붙은 **AND**다. 다른 결합 연산자가 없다.
2. 범위는 **양쪽이 모두 있어야** 나간다.
3. `seq:`는 공간이 정확히 일치할 때만 나간다. 저장소나 base가 바뀌면 상태가 남아 있어도 질의에서 빠진다.
4. 자유 텍스트는 **인용하지 않고 맨 뒤에** 붙는다.
5. 키 순회 순서가 고정되어 있다. 질의 문자열이 캐시 key의 일부이므로 순서가 바뀌면 같은 조건이 다른 key가 된다.

### 5.2 정렬

```text
sort  = URL의 sort ?? (tab === 'history' ? 'merge_seq' : 'pr_number')
order = URL의 order === 'asc' ? 'asc' : 'desc'
```

정렬 가능한 열은 **셋뿐이다**: `#`(`pr_number`), `M number`(`merge_seq`), `Merged at`(`merged_at`). 서버는 아홉 개를 지원하지만 원본 화면이 셋만 노출하므로 나머지를 새로 노출하지 않는다.

같은 열을 다시 누르면 `desc → asc`, 다른 열을 누르면 `desc`로 시작한다.

**받은 행을 클라이언트에서 다시 정렬하지 않는다.** 정렬은 서버가 전체 결과에 대해 하는 것이고, 클라이언트가 가진 것은 그중 일부 페이지다.

### 5.3 조회 경로 분기

```text
raw = URL의 q를 trim한 값
detection = detectIdentifier(raw, gheBaseUrl)

identifier = raw !== '' && detection.interpretations 중에
             kind가 'commit'이거나 'pull_request'인 것이 하나라도 있다

identifier 이면:
    input = raw.startsWith('#') ? `${repository}${raw}` : raw
    resolveIdentifier({ q: input, limit: 50 })
아니면:
    parseQuery(query)를 돌려 문법 오류를 화면 오류로 바꾼다
    searchChanges({ q: query, sort, order, size: 50, cursor, facets })
```

`limit: 50`을 **반드시 명시한다.** 서버 기본값은 10이라 그대로 부르면 11건에서 절삭 표시가 뜬다.

`detectIdentifier`의 전체 알고리즘은 5.9장에 있다.

### 5.4 페이지 크기와 facet

```text
size   = 50   (항상)
facets = true  (첫 페이지)
facets = false (이어 보기)
```

이어 보기 응답에는 facet이 없으므로 **첫 페이지의 facet을 보존한다.** Label 선택지가 2페이지에서 사라지면 안 된다.

### 5.5 무한 스크롤

`IntersectionObserver`, `rootMargin: '200px'`. 결과 영역을 root로 쓴다.

**관측자 콜백은 `error`가 있는 동안 아무 일도 하지 않는다.** 이것이 무자동재시도 규칙을 지키는 장치다. 거부된 cursor가 오류를 세우면 관측자는 스크롤할 때마다 계속 발화하지만 매번 무동작이므로 루프가 생기지 않는다. 복구 수단은 오류 배너의 `Reload first page` 버튼 하나뿐이다.

**무한 스크롤을 페이지 번호 UI로 바꾸지 마라.** 그리고 페이지 번호로 가짜 cursor를 만들지 마라. 서버가 준 `next_cursor`만 쓴다.

### 5.6 문맥 전환과 늦은 응답

```text
requestKey = `${query}|${sort}|${order}`

requestKey가 바뀌면: cursor와 펼친 상세를 비운다
loadedKey !== requestKey 인 동안: 행과 cursor를 빈 것으로 취급한다
```

이 마지막 줄이 핵심이다. **새 문맥을 요청하는 동안 이전 저장소의 결과가 새 머리글 아래 나타나면 안 된다.** 취소를 지원하지 않는 transport라면 요청 세대 번호를 비교해 늦은 응답을 버린다.

같은 조건의 새로고침은 기존 결과를 유지해도 되지만, 그것을 새 조회 완료로 오해하게 만들면 안 된다.

### 5.6.1 상태 초기화표

각 이벤트에서 **무엇을 보존하고 무엇을 지우는지**를 정한다. 이 표를 직관으로 다시 정의하지 마라. 원본에서 추출한 것이다.

| 이벤트 | 보존 | 초기화 | 요청 처리 |
|---|---|---|---|
| 저장소 변경 | `tab`, `sort`, `order`, `q`, `author`, `label`, `state`, 날짜·PR 범위 | `base`, `path`, `mnum_from`, `mnum_to`, `source_ref`, `path_kind`, cursor, 펼친 상세 | 이전 검색·트리 요청 취소. `seqRange`는 공간 불일치로 질의에서 자동으로 빠진다 |
| Base branch 변경 | 저장소, 탭, 정렬, 나머지 필터 | `mnum_from`, `mnum_to`(draft와 URL 양쪽), `source_ref`, `path_kind`, cursor, 펼친 상세 | 같다. 트리를 새 브랜치로 다시 읽는다 |
| 탭 변경 | 저장소, base, 경로, 모든 필터 값 | cursor, 펼친 상세 | history 탭은 검색 요청 자체를 하지 않는다 |
| 파일·폴더·루트 선택 | 모든 필터 | cursor, 펼친 상세 | `tab`을 `history`로 바꾸고 `path`, `path_kind`, `source_ref`를 넣는다 |
| 필터 draft 변경 | 적용된 조건 전부 | 없음 | **요청을 보내지 않는다. URL도 갱신하지 않는다** |
| Search 제출 | 저장소, 탭, 정렬, 경로 | SHA 두 칸이 비었으면 `seqRange` | SHA 범위가 있으면 먼저 두 번의 resolve를 기다린다. **실패하면 URL을 갱신하지 않는다** |
| Reset | `repository`, `tab`, `sort`, `order`, `source_ref`, `path_kind` | 12개 필터 key, SHA 두 칸, `seqRange`, 범위 유형(→`pr`) | 새 조회가 나간다 |
| 정렬 변경 | 모든 필터, 저장소, 탭 | cursor, 펼친 상세 | 서버에 `sort`·`order`를 보낸다. **받은 행을 다시 정렬하지 않는다** |
| 다음 페이지 요청 | 표시 중인 행 전부, 첫 페이지 facet | 없음 | cursor를 싣고 응답을 뒤에 붙인다. `facets=false` |
| 다음 페이지 실패 | 표시 중인 행 전부 | 없음 | 오류를 띄우고 **자동 재시도를 멈춘다** |
| 새로고침 | 모든 조건 | cursor | 첫 페이지부터 다시 읽는다 |
| 상세 펼침 | 표 상태 | 이전에 펼친 행(**하나만 열린다**) | 해당 행의 상세를 조회한다 |
| 상세 닫힘 | — | 펼친 행 | 진행 중인 상세 요청을 취소한다 |
| history 페이지 로드 | 고정 revision, 비교 선택 | 없음 | 2페이지부터 `sha` 중복을 지우고 뒤에 붙인다 |
| 두 revision 선택 | history 목록 | 없음 | **먼저 고른 것이 head다** |
| Diff 열림 | 아래 화면 전부 | — | base/head를 첫 응답으로 고정한다 |
| Diff 닫힘 | — | 선택 파일, 검색어, swap, 표시 범위 | 진행 중인 파일 조회를 취소한다 |
| Time-lapse 열림 | 아래 화면 전부 | — | History에서 열면 이미 읽은 목록을 쓰고 조회하지 않는다 |
| Time-lapse 닫힘 | — | 선택 줄, 분석 결과 | 진행 중인 분석을 취소한다 |
| URL 외부 변경 | 지역 상태(모달, 펼침) | — | draft를 새 URL 값으로 다시 맞춘다 |
| identity 변경 | 저장소·경로 문맥 | My 탭의 결과 캐시 | 새 identity로 key를 나눈다. **이전 사용자 데이터가 보이면 안 된다** |
| 언마운트 | — | 전부 | `window` 리스너 제거, 관측자 disconnect, 모든 요청 취소, body 잠금 해제 |

`source`의 URL 갱신은 **`replace`다.** 필터 변경이 브라우저 이력에 쌓이지 않는다. `push`로 바꾸지 마라.

### 5.6.2 대표 요청과 응답

전체 계약은 `API_AND_ADAPTER_CONTRACT.md`에 있다. 여기에는 모양을 눈으로 확인할 수 있을 만큼만 둔다.

**요청**(첫 페이지):

```text
GET /api/search
  ?q=kind%3Apull_request+repo%3A%22demo%2Fmodem%22+is%3Amerged+mnum%3A42..80
  &sort=pr_number
  &order=desc
  &size=50
  &facets=true
```

**성공 응답**(`fixtures/search-page1.json`에서 항목 두 개만 남기고 줄였다):

```json
{
  "query": "kind:pull_request repo:\"demo/modem\"",
  "parsed": { "kind": "and", "nodes": [] },
  "total": { "value": 123, "relation": "eq" },
  "sort": { "field": "pr_number", "order": "desc" },
  "items": [
    {
      "kind": "pull_request",
      "repository": "demo/modem",
      "pr_number": 2044,
      "title": "RF calibration update (123)",
      "author": "dev-b",
      "state": "merged",
      "merge_seq": 123,
      "seq_epoch": 3,
      "sequence_space": "demo/modem@main",
      "merged_at": "2026-04-06T03:32:07.000Z",
      "changed_files_count": 7,
      "additions": 112,
      "deletions": 43,
      "labels": ["area/phy"],
      "link_summary": null,
      "url": "https://ghe.example.internal/demo/modem/pull/2044",
      "merge_number": "M-1900-123",
      "merge_number_state": "assigned",
      "merge_number_reason": null,
      "merge_number_epoch": 3
    },
    {
      "kind": "pull_request",
      "repository": "demo/modem",
      "pr_number": 2042,
      "title": "NR measurement fix (122)",
      "author": "dev-a",
      "state": "merged",
      "merge_seq": 122,
      "seq_epoch": 3,
      "sequence_space": "demo/modem@main",
      "merged_at": "2026-04-05T02:32:07.000Z",
      "changed_files_count": 3,
      "additions": 0,
      "deletions": null,
      "labels": ["area/l1"],
      "link_summary": null,
      "url": "https://ghe.example.internal/demo/modem/pull/2042"
    }
  ],
  "facets": {
    "label": [{ "value": "area/phy", "count": 41 }, { "value": "area/l1", "count": 33 }],
    "state": [{ "value": "merged", "count": 123 }]
  },
  "next_cursor": "CURSOR_P2",
  "correlation_id": "00000000-0000-4000-8000-00000000f001"
}
```

둘째 항목이 중요하다. **M 번호 네 키가 아예 없고**(배지를 그리지 않는다), `additions`가 `0`인데 `deletions`가 `null`이다(`+0`과 `—`가 함께 나와야 한다).

**오류 응답**(다음 페이지 cursor 거부, HTTP **400**):

```json
{
  "error": {
    "code": "INVALID_CURSOR",
    "message": "커서를 사용할 수 없습니다",
    "detail": { "field": "cursor" }
  },
  "correlation_id": "00000000-0000-4000-8000-00000000e001"
}
```

`message`가 **한국어**다. 원본 화면은 서버 문구에 한글이 있으면 버리고 영어 기본 문구 + 코드(`Unable to load search results. (INVALID_CURSOR)`)를 쓴다. PIPE가 한국어 UI라면 이 판정을 뒤집되, **뒤집었다는 사실을 차이표에 적는다.** 서버 문구를 무조건 신뢰하는 형태로 만들지 마라.

**`epoch_stale` 응답**(HTTP 200이지만 조회가 실행되지 않았다):

```json
{
  "query": "kind:pull_request repo:\"demo/modem\" seq:42..80",
  "parsed": { "kind": "and", "nodes": [] },
  "sequence_context": { "repository": "demo/modem", "base_branch": "main", "seq_epoch": 4 },
  "requested_seq_epoch": 3,
  "epoch_stale": true,
  "next_cursor": null,
  "correlation_id": "00000000-0000-4000-8000-00000000f003"
}
```

**`items`·`total`·`facets` 키가 없다.** 계산하지 않은 것을 빈 값으로 채우면 "구간이 비었다"로 읽히기 때문이다. 이 응답을 0건으로 그리지 마라.

### 5.7 순수 로직 이식

`reference/PURE_LOGIC_REFERENCE.md`에 알고리즘·상수·golden 입출력이 전부 있다. 옮길 것은 여덟 가지다.

1. 질의 생성기(`buildRepositoryQuery`) — 19개 벡터
2. SHA 범위 판정(`buildShaRangeFilter`) — 9개 벡터
3. 초기 범위 유형 판정(`deriveInitialRangeType`) — 6개 벡터
4. Label 선택지(`repositoryLabelOptions`) — 4개 벡터
5. M 번호 표시 판정(`mergeNumberView`) — 17개 벡터 + 9개 사유 문구
6. 표시 포맷(`formatTimestamp`, `shortSha`, `formatSequence`, `formatDuration`) — 각각 벡터 있음
7. 서버 문구 처리(`serviceMessage`) — 5개 벡터
8. 줄·단어 diff와 줄 추적(`compareLines`, `wordChanges`, `traceLines`, `lines`) — 각각 벡터 있음

**8번만 외부 의존성이 있다.** npm `diff` 패키지의 `diffLines`와 `diffWordsWithSpace`를 쓰고, 원본은 `^9.0.0`을 선언한다. 순수 계산이고 Node 전용 API를 쓰지 않는다. 라이선스는 BSD-3-Clause로 공표되어 있으나 **실제 설치본의 `LICENSE`로 확인한다.**

```text
PIPE에 diff가 있으면       → 그 버전을 쓰고 timeout/maxEditLength 옵션 지원을 타입으로 확인한다
PIPE에 diff가 없으면       → 새 의존성이다. 추가 전에 사람에게 확인받는다
어느 경우에도              → Myers를 직접 구현하지 않는다
                            문자열 비교로 대체하지 않는다
                            "없으니 최신 버전을 설치한다"를 혼자 결정하지 않는다
```

계산 한계를 그대로 옮긴다. `compareLines`는 `{ timeout: 150, maxEditLength: 5000 }`, `wordChanges`는 `{ timeout: 8, maxEditLength: 200 }`에 더해 양쪽 길이 합이 4000자를 넘으면 단어 비교를 아예 건너뛴다. **한계를 임의로 늘려 브라우저를 멈추게 하지 마라.**

한계 초과는 **빈 diff가 아니라 명시적 미지원**이다. `null`을 받으면 `Text comparison unavailable`과 사유를 보인다.

### 5.8 데이터 포트

```ts
interface SearchDataPort {
  listRepositories({ limit, cursor? }, signal?): Promise<{ items, next_cursor }>;
  searchChanges({ q, sort, order, size, cursor?, facets, seqEpoch? }, signal?): Promise<SearchResponse>;
  resolveIdentifier({ q, limit, repository? }, signal?): Promise<ResolveResponse>;
  getPullRequest({ repository, prNumber }, signal?): Promise<DetailResponse>;
  getCommit({ repository, sha }, signal?): Promise<DetailResponse>;
  getSourceTree({ repository, ref?, path?, treeSha?, revision? }, signal?): Promise<SourceTree>;
  getPathHistory({ repository, path?, ref?, page? }, signal?): Promise<SourceHistory>;
  getSourceFile({ repository, path, revision }, signal?): Promise<SourceFile>;
  getDiffMetadata({ repository, pr?, commit?, page? }, signal?): Promise<SourceComparison>;
}
```

실패는 상태 코드와 서버 코드를 보존하는 오류로 던진다.

```ts
class SearchPortError extends Error {
  status: number;                          // HTTP 상태
  code: string | null;                     // 서버의 error.code
  detail: Record<string, unknown> | null;
  correlationId: string | null;
}
```

**미설정 client는 조용히 실패하지 않는다.** `baseUrl`이 없으면 모든 메서드가 즉시 `status: 0, code: 'NOT_CONFIGURED'`로 던진다. 인증을 끄지 않고, 공용 서비스 계정으로 조회하지 않고, 장애 시 fixture로 내려가지 않는다.

### 5.9 식별자 판별기

원본 `detectIdentifier`의 전체 알고리즘이다. 이것을 다시 구현한다.

```text
상수:
  FULL_SHA_LENGTH       = 40
  MIN_SHA_PREFIX_LENGTH = 7
  MAX_PR_NUMBER         = 2147483647
  HEX        = /^[0-9a-f]+$/
  OWNER_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
  HASH_NUMBER= /^(?:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+))?#(\d+)$/
  DIGITS     = /^\d+$/

detectIdentifier(raw, { gheBaseUrl }):
  input = raw.trim()
  if input === '' -> { interpretations: [{kind:'text'}], rejection: null }

  # 1. GHE URL (gheBaseUrl이 있을 때만)
  url 해석:
      gheBaseUrl이 없거나 빈 문자열이면 건너뛴다
      new URL()의 host를 소문자로 비교한다. 다르면 건너뛴다   ← 호스트 비교를 생략하지 마라
      pathname을 '/'로 쪼개 빈 조각을 버린다. 4개 미만이면 건너뛴다
      [owner, repo, resource, value]
      repository = `${owner}/${repo}` 가 OWNER_REPO에 맞지 않으면 건너뛴다
      resource가 'pull' 또는 'pulls' 이고 value가 숫자이고 1..MAX_PR_NUMBER 이면
          -> { kind:'pull_request', repository, number }  (이 해석 하나만 돌려준다)
      resource가 'commit' 또는 'commits' 이고 value가 40자 hex 이면
          -> { kind:'commit', match:'exact', sha: 소문자 }  (하나만)

  # 2. #N 또는 owner/repo#N
  HASH_NUMBER에 맞고 번호가 1..MAX_PR_NUMBER 이면
      interpretations.push({ kind:'pull_request', repository: 매치[1] ?? null, number })

  # 3. 순수 정수 (2번에 안 맞았을 때만)
  DIGITS에 맞고 1..MAX_PR_NUMBER 이면
      interpretations.push({ kind:'pull_request', repository: null, number })

  # 4. hex
  input을 소문자로 바꾼 값이 HEX에 맞으면:
      길이 40        -> push { kind:'commit', match:'exact',  sha }
      길이 7..39     -> push { kind:'commit', match:'prefix', sha }
  hex 해석이 안 나왔는데 소문자 input이 HEX에 맞고 interpretations가 비어 있으면:
      -> rejection {
           code: 'SHA_PREFIX_TOO_SHORT',
           message: 'A shortened SHA must contain at least 7 characters',
           min_length: 7,
           actual_length: input.length
         }
         이때 interpretations는 [{kind:'text'}] 하나다

  interpretations가 비어 있으면 -> [{kind:'text'}]
  돌려준다: { input, interpretations, rejection }
```

반드시 이해해야 할 두 가지가 있다.

**해석은 목록이다.** `1234567`은 PR 번호이면서 동시에 SHA 접두다. 순서를 문자 그대로 따르면 40자리 숫자까지 PR 번호가 되어 커밋 조회가 영영 일어나지 않는다. 그래서 겹치는 입력은 두 해석을 모두 담고, 호출 측이 두 경로를 다 조회해 후보를 합친다.

**`interpretations.length === 0` 조건이 필수다.** `123`처럼 짧은 숫자는 이미 PR 번호로 읽혔다. PR #123을 "7자 미만 SHA"라고 거절하면 안 된다.

릴리스 태그는 판별하지 않는다. 패턴이 정의되어 있지 않아 `v1`·`build-2` 같은 값이 잘못 분류되기 때문이다. 자유 텍스트로 둔다.

### 5.10 서버가 아는 질의 키

`parseQuery`가 인식하는 키는 열아홉 개다.

```text
repo, org, author, team, author_team, reviewer, label, base, head, state,
merged, created, seq, release, path, is, kind, changed_files, changed_lines,
pr_number, mnum
```

화면이 만드는 것은 이 중 `kind`, `repo`, `base`, `author`, `label`, `path`, `is`, `merged`, `pr_number`, `mnum`, `seq` 열한 개다. 나머지는 사용자가 자유 텍스트 칸에 직접 넣을 수 있다.

**새 정규식으로 검색 문법을 재창조하지 마라.** 파서를 옮기거나, 옮기지 않겠다면 서버가 문법 오류를 400으로 돌려주는 것을 그대로 표시한다. 다만 원본은 제출 전에 클라이언트에서 한 번 파싱해 왕복을 아끼므로, 가능하면 파서도 함께 옮긴다.

## 6. E단계 — 소스 탐색

### 6.1 Commit history

| 항목 | 규칙 |
|---|---|
| 문맥 재설정 | `repository|path|revision|branch`가 바뀌면 **내부 상태를 통째로 다시 만든다**(페이지, 고정 revision, 선택) |
| revision 고정 | 첫 응답의 `revision`을 기억하고 **이후 요청은 그 값으로 간다**. 브랜치 이름으로 가면 안 된다 |
| 이어 읽기 | `next_page`가 있을 때만 `Load older commits` 버튼. **무한 스크롤이 아니다** |
| 중복 제거 | 2페이지부터 `sha` 기준으로 지우고 뒤에 붙인다 |
| 표 | 선택 / `Revision` / `Change` / `Linked PRs` / `Author` / `Committed` / `Inspect` |
| SHA·PR 복사 | 누르면 복사한다. 결과 표의 "누르면 이동"과 다르므로 `aria-label`로 구분한다(`Copy full SHA …`, `Copy PR #…`) |
| Linked PRs | 배열에 값이 있으면 배지, **빈 배열이면 `—`, `null`이면 `Pending`** |
| PR 조회 불가 | `pull_requests_unavailable`이면 안내만 붙이고 **이력은 계속 쓴다** |
| 비교 선택 | 파일일 때만. 두 개를 고르면 나머지가 비활성. **먼저 고른 것이 head다** |
| 폴더·루트 | `Select a file to enable comparison` 안내. 비교와 Time-lapse 비활성 |
| 행 Diff | `Change` 열의 제목과 `Inspect` 열의 버튼이 **같은 동작**이다 |
| 단축키 | `Ctrl/Cmd+D`는 활성 커밋의 Diff, `T`는 Time-lapse. 바깥 핸들러로 전파하지 않는다 |
| 날짜 | `YYYY-MM-DD UTC`(`PD-004`, 원본은 브라우저 시간대를 쓴다) |

### 6.2 Diff

| 항목 | 규칙 |
|---|---|
| 메타데이터 | `getDiffMetadata({ repository, pr 또는 commit, page })`. 파일 대 파일 비교에서는 부르지 않는다 |
| base/head 고정 | 첫 응답의 값을 기억한다. 이후 페이지에서 달라지면 `This PR changed while loading files. Close and reopen the comparison.`을 띄우고 **더 읽지 않는다** |
| 파일 목록 이어 읽기 | `More files` 버튼. `path` 기준 중복 제거. `truncated`면 `GitHub file limit reached. This list is partial.` |
| 파일 내용 | before/after 각각 조회. `added`면 before를 부르지 않고 `removed`면 after를 부르지 않는다 |
| 빈 쪽 | **빈 텍스트 파일로 만든다.** 가짜 내용을 그리지 않는다 |
| 기본 모드 | `Side by side`. 좌우 줄 번호가 대응하고 **수직 스크롤은 하나다** |
| Find | 검색어가 있으면 일치하는 **줄**이, 없으면 변경 덩어리의 시작이 이동 대상. 표기도 `matching lines` / `change groups`로 달라진다 |
| 이전·다음 | 순환한다. `scrollIntoView({ block: 'center' })` |
| Swap | before/after를 맞바꾸고 머리글의 SHA 표기도 함께 바꾼다 |
| 문맥 접기 | 기본은 변경 줄 앞뒤 **3줄**. `Show all lines`로 전부 편다. 검색어가 있으면 접지 않는다 |
| 개행 안내 | 마지막 줄에 개행이 없으면 `Before: no newline at EOF.` / `After: no newline at EOF.` |
| 계산 불가 | `Text comparison unavailable` + 서버가 준 `reason` |
| rename 링크 | `Renamed from {previous_path}`. **`routeBase` 기반으로 만든다**(`PD-008`) |
| 관련 PR | `<details>`로 접는다. **PIPE에 `/pr/...` 화면이 없으므로 앱 내부 링크를 만들지 않는다.** GHE 원문으로 보내거나 링크 없이 번호와 제목만 보인다 |
| 테마 토글 | **제거한다**(`PD-006`) |
| 드래그 | **제거한다.** 전체화면 전환은 유지한다(`PD-007`) |

`split` 모드의 열 폭은 `44px / calc(50% - 44px)`를 두 번 반복해 좌우 줄 번호를 정렬한다. 긴 줄, 탭, 한글, 들여쓰기를 보존한다.

### 6.3 Time-lapse

| 항목 | 규칙 |
|---|---|
| 이력 확보 | History에서 열면 **이미 읽은 목록을 쓰고 조회하지 않는다.** Diff나 상세에서 열면 직접 조회한다 |
| 목록 순서 | 오래된 것이 앞이 되도록 뒤집는다 |
| 기본 선택 | 가장 최신 |
| 부분 이력 | 더 읽을 페이지가 있으면 `Showing the loaded path revisions. Load older commits in History before opening Time-lapse to extend the window.` **슬라이더를 전체 이력인 것처럼 보이지 않는다** |
| 파일 조회 | 선택 revision의 파일을 **180ms 지연 후** 조회한다. 슬라이더를 끌 때 요청이 쏟아지지 않게 하는 장치다 |
| 줄 추적 | `Analyze line history`를 **눌러야** 시작한다. 현재 위치에서 뒤로 **최대 30개** revision을 **3개씩 묶어** 읽는다 |
| 중단 | 어느 revision이든 `status`가 `text`도 `missing`도 아니면 즉시 중단하고 사유를 보인다 |
| 취소 | 진행 중 분석은 취소할 수 있고, 모달이 닫힐 때 취소한다 |
| 의미 | **Git blame이 아니다.** 인접 diff로 추정한 대응이다. `Line correspondence is inferred from adjacent diffs, not authoritative blame.` 고지를 항상 보인다 |
| 이벤트 종류 | `baseline` → `Present at window start`, `edited` → `Aligned replacement`, `added` → `Added` |
| 음영 | 다섯 단계. **범례를 반드시 붙인다.** 색만으로 의미를 전달하지 않는다 |

### 6.4 모달 중첩

Diff 위에서 Time-lapse를 열 수 있다. 소유권을 명확히 정한다.

| 항목 | 규칙 |
|---|---|
| `Escape` | **가장 위의 모달만** 닫는다 |
| focus trap | 가장 위의 모달만 활성 |
| focus 복귀 | 각 모달이 자신을 연 제어로 돌려준다 |
| body 스크롤 잠금 | 첫 모달이 걸고 **마지막 모달이 닫힐 때** 푼다 |
| 배경 클릭 | 가장 위의 모달만 반응한다 |

MUI `Dialog`가 이것을 기본으로 해 준다고 가정하지 말고 **실제로 확인한다**(`PS-T-032`).

### 6.5 전역 단축키

```text
가드: input, textarea, select, [contenteditable="true"],
      [role="dialog"], [role="combobox"], [role="listbox"]
      안에서 시작한 키 이벤트는 무시한다

Ctrl/Cmd+D : activeRow가 있고 history 탭이 아니면 Diff를 연다
T          : 수식 키가 없고 path가 있으며 path_kind !== 'directory'이면 Time-lapse를 연다
Ctrl/Cmd+K : Filters를 열고 q 입력에 focus + select
Ctrl/Cmd+G : 위와 같다
```

**`role="combobox"`를 가드에서 빼지 마라.** MUI `Select`와 `Autocomplete`의 타자 검색 입력이 새어 나가 모달이 열린다. 원본에서 실제로 났던 결함이며 CR-111 검토가 고쳤다.

`Ctrl/Cmd+K`는 원본에서 셸과 콘텐츠가 나누어 처리했다. 셸이 사라지므로 콘텐츠가 전부 소유한다. 접힌 필터를 먼저 열고 나서 focus해야 한다. 숨겨진 요소에 `focus()`를 부르면 조용한 무동작이 되기 때문이다.

**PIPE 셸이 이미 `Ctrl/Cmd+K`를 쓰고 있으면** `preventDefault`를 하지 말고 다른 키로 바꾼 뒤 그 사실을 차이표에 적는다. 남의 단축키를 빼앗지 않는다.

## 7. F단계 — 시각 정제

목표는 장식적인 랜딩 페이지가 아니라, **오래 읽고 반복 조작해도 피로가 적은 정밀한 개발자 검색 도구**다. 정보 구조와 동작은 보존하면서 정렬·여백·표 밀도·표면 계층·상태 피드백의 완성도를 높인다.

기본 MUI 데모를 그대로 붙인 모양이나, 서로 다른 세 UI 라이브러리를 이어 붙인 모양으로 끝내지 않는다.

### 7.1 토큰

전체 표는 `DESIGN_AND_WIREFRAMES.md` 7장에 있다. 핵심만 옮긴다.

| 항목 | 값 |
|---|---|
| 페이지 제목 | 20px / 28px, 600. 콘텐츠 안에 **한 번만**. hero 없음 |
| 주요 본문 | 14px / 20px |
| 표 데이터 | 13px / 20px. **11px 이하로 줄이지 않는다** |
| 표 머리글 | 12px / 16px, 600 |
| 라벨·보조 메타 | 12px / 18px. 작은 크기를 낮은 대비로 다시 약화하지 않는다 |
| 코드·SHA | 호스트 monospace, 12–13px. 코드와 식별자에만 |
| 숫자 | `tabular-nums`. PR/M 번호, 날짜, diff 수치 전부 |
| 간격 단계 | 4 / 8 / 12 / 16 / 24 / 32px |
| 콘텐츠 여백 | desktop 24px, compact 16px. **호스트 여백과 중복 적용 금지** |
| 제어 높이 | 40px. Select·TextField·DatePicker의 외곽 높이를 맞춘다 |
| 아이콘 버튼 | 32–36px, 터치 목표 40px 이상 |
| 표 머리글 / 행 | 40px / 44–48px. 제목이 두 줄이면 자연히 늘어난다 |
| 패널 radius | 10px |
| 제어 radius | 6px |
| 테두리 | 1px divider 계열 |
| 그림자 | 패널에는 거의 없고 overlay에만. **카드 위 카드 금지** |
| motion | hover 100–120ms, collapse/dialog 140–180ms |

색은 hex를 쓰지 않고 호스트 theme의 역할에 연결한다: `background.default`, `background.paper`, `text.primary`, `text.secondary`, `divider`, `primary.main`, `action.hover`, `action.selected`, `error.main`, `warning.main`, `success.main`.

`Merged` / `Open` / `Closed` 배지는 **아이콘과 텍스트로** 구분한다. **PIPE Job의 `SUCCESS`/`FAIL` 배지를 의미까지 재사용하지 마라.** PR의 `Merged`는 Job의 성공이 아니다.

M 배지의 tone 셋: `accent`(assigned) → primary 계열, `neutral`(pending·not_applicable) → divider + text.secondary, `warning`(unavailable) → warning 계열.

### 7.2 한 화면의 일관성

MUI `Select`와 antd `DatePicker`가 같은 줄에 섞인다. **하나의 compact field wrapper**로 라벨 간격, 제어 높이, helper text 위치, 오류 위치를 통일한다.

전역 theme를 덮어쓰지 않는다. `body`에 reset을 다시 적용하지 않는다. 스타일은 `pipe-pr-search` 루트 또는 각 컴포넌트의 `sx`에 가둔다. `ThemeProvider`가 필요하면 **기존 theme를 상속하는 좁은 범위**로만 쓴다.

**포털을 조심한다.** MUI `Menu`, `Popper`, `Select` 목록, antd 달력, `Dialog`는 콘텐츠 루트 **바깥**으로 렌더링될 수 있다. 자손 선택자만으로 스타일이 닿는다고 가정하지 마라. 컴포넌트 자신의 `sx`나 `slotProps`로 준다. z-index는 호스트 theme의 척도를 쓰고 숫자를 직접 적지 않는다.

**언마운트 뒤에 전역 이벤트 리스너나 스타일이 남아 다른 화면을 바꾸면 실패다**(`PS-T-040`).

### 7.3 반응형

기준은 브라우저 창이 아니라 **Search에게 실제로 주어진 콘텐츠 폭**이다. 1440px 브라우저가 1440px 콘텐츠가 아니다.

| 콘텐츠 폭 | 구성 |
|---|---|
| 1120px 이상 | 260px 문맥 패널 + gap 24px + 결과 |
| 768–1119px | 문맥 패널을 `Repository & files` 버튼으로 여는 **로컬 drawer**로 바꾼다 |
| 768px 미만 | 한 열. 탭 가로 스크롤. 필터 세로. 소스 모달 전체화면 |

이 drawer는 Search의 저장소 패널이지 전역 App Shell이 아니다. 결과 열을 영구히 지우지 않는다.

### 7.4 참조 디자인의 위치

아래는 표현 품질의 **방향**이지 코드를 복제하라는 지시가 아니다. 실제 계약과 PIPE 버전 제약보다 우선하지 않는다.

| 참조 | 가져올 것 | 가져오지 않을 것 |
|---|---|---|
| shadcn/ui data table | 촘촘한 정보 계층, 절제된 테두리와 행 피드백을 **MUI로 재표현** | 의존성 설치, 새 pagination 의미 |
| Dark Design | 다크 테마에서 표면·테두리·보조 글자의 대비 검토 | 강제 dark-first, 네온, glow, 낮은 대비 |
| Layers | 제품 UI의 타이포·간격·반복 컴포넌트 일관성 | 실제 없는 기능의 복제 |
| Supahero | 제목·설명·주요 동작의 시선 우선순위만 | hero, 홍보 카피, 큰 배너, KPI 카드 |
| BeUI / Transitions | 펼침·모달·선택 상태의 **짧은** 전환 | 행별 등장 연출, spring, shimmer 반복 |
| MUI v7 공식 문서 | 실제 Core 컴포넌트와 테마 구현 | 최신 major의 API를 7.1에 그대로 적용 |
| Ant Design 4.x 문서 | 기존 DatePicker·Tree wrapper 동작 확인 | v5 토큰 API, 후속 minor 전용 props |
| WAI-ARIA APG | 모달·탭·트리의 키보드와 focus 설계 | 시각을 위해 의미·키보드 동작 제거 |

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

전부 조사하느라 구현을 지연시키지 마라. 이 화면에서 해결할 구체적 시각 문제가 있을 때만 연다. **외부 색상 팔레트보다 기존 PIPE 브랜드·테마가 우선이다.**

## 8. 예외 상태

| 상태 | 표시 위치 | 가능한 동작 | 해서는 안 되는 일 |
|---|---|---|---|
| 최초 로딩 | 각 패널 골격(표는 7행) | 다른 PIPE 기능을 계속 쓴다 | 전역 로딩으로 앱을 잠근다 |
| 질의·범위 오류 | 해당 필드 + 요약 | 고쳐서 다시 검색 | 보이지 않는 필드만 오류로 지목 |
| 0건 | 결과 빈 상태 | 조건 수정, Reset | 통신 실패를 0건으로 표시 |
| 저장소 없음 | 문맥 패널 | 안내 | 권한 밖 저장소 이름 노출 |
| 목록 실패 | 결과 영역 | 명시적 재시도 | 무한 자동 재요청 |
| 다음 페이지 실패 | 기존 행 + 하단 안내 | `Reload first page` | 표시한 행을 지우거나 중복 추가 |
| 트리만 실패 | 트리 영역 | 트리 재시도 | PR 검색까지 중단 |
| 상세만 실패 | 펼친 행 안 | 그 상세만 재시도 | 전체 화면 실패로 확대 |
| history의 PR 조회 실패 | history 안내 | 이력은 계속 | 연결 없음을 사실로 확정 |
| source 일부·비텍스트·초과 | 모달 해당 영역 | 사유 설명 | 빈 코드를 실제 소스처럼 표시 |
| M pending·키 없음 | 배지 또는 빈 셀 | 사유 확인 | 번호나 링크 생성 |
| epoch 무효 | 검색 영역 | 다시 해석하도록 안내 | 옛 번호로 진행 |
| identity 미제공 | My 탭 | 외부 callback 또는 안내 | Knox 문자열로 사용자 추정 |
| 연결 미설정 | Search 안내 | fixture 경로에서만 demo | 자동으로 production→mock 전환 |
| 검색 권한·접속 장애 | Search 영역 | 재시도 안내 | PIPE 전체 로그아웃 |
| 복사 실패 | live region | 수동 복사 안내 | 성공 알림 |

## 9. 컴포넌트 분해 제안

아래는 **논리 구조 제안**이지 PIPE의 실제 파일 경로가 아니다. 최종 경로는 PIPE 저장소의 관례에 맞춰 네가 정한다.

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
  queryCodec / queryBuilder / identifierDetector
  mergeNumberPresentation / sourceAnalysis
  SearchDataPort / fixtureClient
  useRepositories / useSearchResults / useSourceHistory / useSourceFile
  navigationAdapter / featureTokens
```

각 컴포넌트에 입력 props, callback, 지역 상태, query 의존, 골격·오류·빈 상태 처리, 마운트·언마운트 정리, 수용 테스트 ID를 붙인다. **컴포넌트가 전역 인증 토큰을 직접 읽는 구조를 피한다.**

## 10. G단계 — 검증과 완료 보고

### 10.1 수용 테스트

`PARITY_AND_ACCEPTANCE.md` 3장의 `PS-T-001`부터 `PS-T-042`까지가 최소 검증 범위다. 각 시험에 Given/When/Then과 구체적 기대값이 적혀 있다. **"정상 동작한다"로 끝내지 마라.**

fixture client는 `fixtures/SCENARIOS.md` 3장의 여섯 규칙을 지켜야 한다. 특히 요청 파라미터를 실제로 읽어야 하고(`cursor`, `page`, `ref`, `path`, `revision`, `q`), 지연을 흉내 낼 수 있어야 하며, 호출 횟수를 셀 수 있어야 한다.

### 10.2 명령

**설치된 프로젝트 명령을 먼저 확인한다.** 존재하지 않는 `npm run ...`을 만들어 내지 마라. A단계 10번 항목에서 확인한 실제 명령 이름을 쓴다.

참고로 원본 저장소의 명령은 다음과 같았다(PIPE와 다를 것이다).

```text
pnpm typecheck / pnpm lint / pnpm run test / pnpm --filter @prs/web run test:a11y
```

### 10.3 회귀 구분

실패가 **기존 실패인지 새 코드의 회귀인지 반드시 가른다.** 구현 전에 기준선에서 한 번 돌려 두면 이 구분이 쉬워진다.

테스트를 쉽게 통과시키려고 다음을 하지 마라.

- 원본 근거가 있는 단언을 느슨하게 고치는 것
- fixture의 문제 있는 행(`title: null`, `additions: null`, `pull_request_numbers: null`)을 지우는 것
- 성능을 맞추려고 123건을 줄이거나 API 페이지 크기를 바꾸는 것

### 10.4 시각 검수

기능을 구현한 뒤 시각 검수를 생략하지 않는다. 반대로 고정 HTML 스크린숏만 만들고 검색·상세·페이징·revision 비교가 동작한다고 보고하지도 않는다.

검수 표는 `PARITY_AND_ACCEPTANCE.md` 4장에 있다. 검수 화면은 최소 열두 가지(기본 검색, 필터 펼침, 범위 오류, 행 상세, history 비교 선택, Diff split, Diff unified, Time-lapse, 로딩, 빈 결과, 오류, 좁은 폭)다.

검수 크기는 브라우저 viewport뿐 아니라 **실제 component bounding box를 함께 기록한다.** 콘텐츠 프레임 1280×800, 1120×680, 960×680, 720×800, 390×844. 실제 route에서는 브라우저 1440×900과 1366×768도 확인한다. 200% 확대도 본다.

자동 접근성 검사 외에 **키보드와 Dialog focus 복귀를 직접 확인한다.** 중요한 텍스트와 제어의 대비를 theme별로 측정한다. 도구가 없으면 `NOT RUN`으로 남기고 **측정하지 않은 수치를 쓰지 마라.**

성능은 페이지가 늘어날 때의 스크롤, 행 펼침, diff 작업을 잰다. 가상화 라이브러리는 설치 여부와 실제 성능 필요가 **둘 다** 확인될 때만 도입한다.

### 10.5 완료 보고 형식

최종 답변에 다음을 포함한다.

1. **A단계에서 확인한 PIPE 실제 값** — 버전, 경로, theme, router, 명령. 확인하지 못한 항목은 그렇게 적는다.
2. **구현한 파일 목록과 위치**
3. **`PS-T-001`~`PS-T-042`의 결과** — PASS / FAIL / NOT RUN을 각각 세고, FAIL과 NOT RUN에는 이유를 적는다.
4. **명령별 결과** — typecheck, lint, build, 단위, e2e 각각 PASS/FAIL/NOT RUN과 근거
5. **기존 화면 회귀 확인 결과**
6. **원본과 의도적으로 다르게 만든 점** — `PD-001`~`PD-010` 중 적용한 것과, 새로 추가한 결정
7. **App Shell을 바꾸지 않았다는 확인**
8. **실제 API 미연결 상태의 명시** — fixture로 검증했고 운영 연동은 별도 작업이라는 사실

**확인하지 않은 스크린숏, 테스트 통과, 호환성, 운영 연동을 확인했다고 쓰지 마라.** "원본과 100% 같다"와 "숨겨진 결함을 개선했다"를 동시에 쓰지 마라. 기능별 동등성, 의도적 차이, 환경 미검증을 구분해서 적는다.

## 11. 반드시 지킬 금지 사항 요약

1. App Shell을 바꾸지 않는다. 전역 메뉴, 헤더, 로그인, 전역 테마 토글에 손대지 않는다.
2. 인증을 우회하거나 끄지 않는다. 공용 서비스 계정으로 조회하지 않는다.
3. 장애 시 fixture로 자동 전환하지 않는다.
4. 없는 데이터를 지어내지 않는다. 없는 M 번호, PR 연결, 변경 파일 수, 날짜를 만들지 않는다.
5. `null`과 `0`과 "아직 모름"을 같게 표시하지 않는다.
6. `Merged`를 PIPE Job의 `SUCCESS`로 변환하지 않는다.
7. 서버가 정렬한 전체 결과와 받은 페이지만 정렬한 결과를 혼동하지 않는다.
8. 무한 스크롤을 페이지 번호로 바꾸지 않는다. 가짜 cursor를 만들지 않는다.
9. 날짜 문자열을 임의로 UTC 변환하지 않는다.
10. SHA 범위를 문자열 비교, 숫자 평균, 자동 교환으로 처리하지 않는다. 여러 후보면 첫 후보를 고르지 않는다.
11. `Filter root entries`를 재귀 파일 검색이나 코드 본문 검색으로 바꾸지 않는다.
12. 신뢰하지 않는 PR 본문을 `dangerouslySetInnerHTML`로 넣지 않는다.
13. 새 스택(Next.js, Radix, shadcn, Tailwind, Framer Motion)을 설치하지 않는다.
14. `/search`나 `/pr/...` 같은 pr-search 경로를 하드코딩하지 않는다.
15. 계산 한계를 임의로 늘려 브라우저를 멈추게 하지 않는다.
16. 캐시 key에 토큰·쿠키·개인 credential을 넣지 않는다.
17. 확인하지 않은 것을 확인했다고 보고하지 않는다.
