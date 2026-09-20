# PARITY_AND_ACCEPTANCE — 동등성, 이식 결정, 수용 테스트

> 분류: 인수인계 자료 · 기준 SHA `da0ed9b5bd8fac59c7fcf02c593f69962468be4d`

이 문서는 세 가지를 담는다. 첫째, 원본 기능과 PIPE 구현의 동등성 판정표. 둘째, 원본과 일부러 다르게 만드는 결정(`PD-###`)과 그 이유. 셋째, 구현이 끝났음을 확인하는 수용 테스트(`PS-T-###`)의 Given/When/Then이다.

분류 약속은 1차 지시서와 같다.

| 분류 | 뜻 |
|---|---|
| `SOURCE_VERIFIED` | 기준 SHA의 소스에서 직접 확인했다 |
| `PIPE_PROVIDED` | 사용자가 알려 준 PIPE 현황이며 이 세션이 확인하지 못했다 |
| `PORT_DECISION` | 이번 포팅에서 내린 구현·디자인 결정이다 |
| `TARGET_VERIFY` | PIPE 저장소나 실제 실행 환경에서만 확인할 수 있다 |

## 1. 이식 결정 (PORT_DECISION)

각 결정에는 근거와, 그 결정이 지켜졌는지 확인할 수용 테스트를 붙였다.

### PD-001 — M 링크의 종단 처리를 이번 범위에서 구현하지 않는다

**원본 상태**(`SOURCE_VERIFIED`): M 배지의 링크는 만들어지지만 기본 `/search` 화면이 `m_*` 네 파라미터를 읽지 않는다. `SOURCE_EVIDENCE.md` 6.4장 참조.

**결정**: 링크 **생성**은 그대로 옮긴다. 배지는 `assigned`일 때 `{routeBase}?m_repository=…&m_base_branch=…&m_seq_epoch=…&m_number=…`를 가리키고, 네 값을 빠짐없이 싣는다. 링크를 **해석**해 해당 PR로 데려가는 진입 처리는 이번 범위에 넣지 않는다.

**이유**: 원본에도 없는 기능이다. 없는 기능을 포팅에 몰래 넣으면 "원본과 동등하다"는 판정이 무의미해지고, M 진입은 별도의 서버 조회(`resolveMergeNumber`)를 필요로 하므로 API 연동 작업과 묶여야 한다.

**대신 해야 할 일**: 링크를 누르면 파라미터가 살아 있는 채로 같은 화면이 다시 열린다. 이 상태에서 화면이 **조용히 아무 일도 하지 않는 것은 금지한다.** `m_number`가 URL에 있는데 해석기가 없으면, 결과 영역 위에 `이 M 번호 링크를 해석하는 기능은 아직 연결되지 않았습니다. 저장소 {repo} · 브랜치 {branch} · epoch {n} · 번호 {m}` 형태의 안내를 띄운다. 안내는 네 값을 그대로 보여 주어 사용자가 수동으로 찾을 수 있게 한다.

**확인**: `PS-T-022`.

### PD-002 — 범위 유형 검증을 활성 판정과 같은 기준으로 맞춘다

**원본 상태**(`SOURCE_VERIFIED`): `DEV-729`. 반쪽만 채운 범위가 다른 유형의 온전한 제출을 막는다. `SOURCE_EVIDENCE.md` 6.2장 참조.

**결정**: 제출 직전 검사를 **현재 선택된 범위 유형에만** 적용한다. 선택되지 않은 유형의 반쪽짜리 값은 오류를 내지 않고, 제출 시점에 그 유형의 `from`/`to`를 함께 비운다(`buildRepositoryQuery`가 이미 반쪽 범위를 질의에서 빼므로 결과는 달라지지 않는다).

**이유**: 원본의 이 동작은 ledger에 "저자 판단이 필요한 설계 공백"으로 등재된 **미해결 결함**이지 사양이 아니다. 결함을 그대로 복제하면 PIPE 사용자가 "M 번호 범위를 제대로 채웠는데 PR 범위 오류가 난다"는 같은 혼란을 겪는다. 다만 이 결정은 원본과 동작이 달라지는 지점이므로 차이표에 남기고 전용 시험으로 고정한다.

**하지 않을 것**: 값을 몰래 지우고 아무 말도 하지 않는 것. 선택되지 않은 유형의 미완성 값을 정리했다면 활성 범위 요약에서 그 항목이 사라지는 것으로 사용자가 알 수 있어야 한다.

**확인**: `PS-T-013`, `PS-T-013b`.

### PD-003 — 저장소 선택기를 MUI `Autocomplete`로 옮긴다

**원본 상태**(`SOURCE_VERIFIED`): Radix `Select`. 항목을 고르면 팝오버가 닫히므로 `Load more repositories…`를 고를 때마다 다시 열어야 한다.

**결정**: MUI `Autocomplete`(`options`는 로드된 저장소, 하단에 `Load more` 행)로 옮긴다. `Load more`를 눌러도 목록은 열린 채로 남는다.

**이유**: 원본의 체감 저하가 포팅 과정에서 자연히 해소된다. 또한 저장소가 수백 개인 조직에서는 타이핑 필터가 필수인데, `Autocomplete`가 그것을 기본으로 준다.

**반드시 지킬 제약**: 타이핑 필터는 **이미 불러온 페이지에만** 걸린다. 따라서 입력이 비어 있지 않고 다음 cursor가 남아 있으면 목록 하단에 `불러온 {n}개 중에서 찾고 있습니다. 더 불러오기`를 반드시 보여 "전체 저장소 검색"으로 오해하지 않게 한다. 서버 측 저장소 이름 검색은 원본에 없으므로 만들지 않는다.

**확인**: `PS-T-003`.

### PD-004 — 날짜 표기를 UTC 고정 하나로 통일한다

**원본 상태**(`SOURCE_VERIFIED`): 결과 표는 UTC 고정, Commit history는 브라우저 시간대. `SOURCE_EVIDENCE.md` 6.5장 참조.

**결정**: 두 곳 모두 결과 표의 규칙(`YYYY-MM-DD HH:MM UTC`)을 쓴다. Commit history의 `Committed` 열은 날짜만 필요하므로 `YYYY-MM-DD UTC`로 줄여 쓰되 시간대는 UTC로 고정한다.

**이유**: 원본의 UTC 고정에는 명시된 근거가 있다(`format.ts:88-97`의 주석: 서버 렌더와 클라이언트 렌더가 달라지면 하이드레이션이 깨지고, 두 사람이 같은 화면에서 다른 시각을 읽으면 조사 도구로서 사고의 원인이 된다). Commit history 쪽은 그 근거를 적용받지 않은 누락으로 보인다. 조사 도구에서 같은 화면의 두 표가 다른 시간대를 쓰는 것은 그 자체로 결함이다.

**확인**: `PS-T-039`.

### PD-005 — 셸이 주던 높이 계산을 콘텐츠 격자 계약으로 바꾼다

**원본 상태**(`SOURCE_VERIFIED`): `.repo-sidebar`는 `height: calc(100dvh - 48px)`, `.repo-results-scroll`은 `max-height: calc(100dvh - 460px); min-height: 320px`를 쓴다(`repository-workspace.css:32`, `:130`). 두 값 모두 pr-search App Shell의 헤더 높이와 페이지 여백을 전제한 상수다.

**결정**: `100dvh` 기반 계산을 전부 없애고, 호스트가 준 콘텐츠 상자 안에서 격자로 높이를 나눈다. 자세한 계약은 `DESIGN_AND_WIREFRAMES.md` 3장에 있다.

**이유**: PIPE의 App Shell 헤더 높이는 이 세션이 알 수 없고, 알더라도 상수로 박으면 셸이 바뀔 때마다 Search가 깨진다.

**확인**: `PS-T-001`, `PS-T-040`.

### PD-006 — 모달의 테마 토글을 제거한다

**원본 상태**(`SOURCE_VERIFIED`): `SourceDialogs.tsx:17`의 `ModalFrame` 머리글에 `ThemeToggle`이 있다.

**결정**: 제거한다. 모달은 호스트 테마를 상속한다.

**이유**: 1차 지시서 §6.7의 명시 지시이며, 전역 테마 토글은 App Shell의 소유물이다.

**확인**: `PS-T-001`.

### PD-007 — 모달 드래그를 제거하고 전체화면 전환만 남긴다

**원본 상태**(`SOURCE_VERIFIED`): `SourceDialogs.tsx:13-16`이 머리글 포인터 이벤트로 모달을 옮기고, `source-workspace.css:53`이 그 머리글에 `cursor: move; touch-action: none`을 준다.

**결정**: 드래그를 제거한다. 전체화면 전환(`Maximize2`/`Minimize2`)은 유지한다.

**이유**: 드래그는 `translate` CSS와 포인터 캡처를 쓰는 자체 구현이라 MUI `Dialog`의 focus trap·스크롤 잠금과 충돌할 위험이 있고, 원본에서도 보조 동작이다. 전체화면은 긴 diff를 읽는 실질 기능이므로 남긴다. 이 제거로 잃는 것은 "모달 뒤의 표를 곁눈질한다"는 용도인데, 전체화면 해제와 닫기로 대체된다.

**확인**: `PS-T-028`.

### PD-008 — 앱 내부 링크의 경로 하드코딩을 전부 호스트 경로로 바꾼다

**원본 상태**(`SOURCE_VERIFIED`): `SourceDialogs.tsx:77`의 rename 링크가 `/search?…`를, `:88`과 `:135`의 관련 PR 링크가 `/pr/{repo}/{n}`을 하드코딩한다.

**결정**: rename 링크는 주입받은 `routeBase`와 `navigation.buildUrl`로 만든다. 관련 PR 링크는 pr-search 전용 화면(`/pr/...`)을 가리키므로 **PIPE에는 대응 화면이 없다.** 따라서 앱 내부 링크로 만들지 않고, `externalSourceBase`(GHE)가 있으면 GHE의 PR 원문으로, 없으면 링크 없이 번호와 제목만 보인다.

**이유**: `/pr/...`은 pr-search의 독립 화면이며 이번 이식 범위(§3의 제외 목록)에 없다. 없는 화면으로 가는 링크를 남기면 PIPE에서 404가 된다.

**확인**: `PS-T-029`.

### PD-009 — `Ctrl/Cmd+K` 단축키를 콘텐츠가 소유한다

**원본 상태**(`SOURCE_VERIFIED`): 두 곳이 협력한다. `reader/ReaderShell.tsx:25`가 진입 시 `window.location.hash === '#omni-search-input'`이면 `[data-reader-search]`를 찾아 focus하고, `:29-35`가 `window`의 `keydown`에서 `Ctrl/Cmd+K`와 `Ctrl/Cmd+G`를 잡아 같은 입력에 focus한다. 한편 `RepositoryWorkspace.tsx:296-309`가 같은 키를 보고 접힌 Filters를 먼저 연 뒤 focus를 예약한다(`display:none` 요소에 대한 `focus()`는 조용한 무동작이기 때문이다).

**결정**: 셸 쪽 절반이 사라지므로 콘텐츠가 전부 소유한다. 리스너는 콘텐츠 루트 요소가 아니라 `window`에 붙이되(원본과 같다), unmount에서 반드시 제거한다.

**이유**: 셸을 빼면서 검색창 focus 기능까지 잃으면 안 된다는 1차 지시서 §5의 지시다.

**충돌 회피 의무**(`TARGET_VERIFY`): PIPE의 App Shell이 이미 `Ctrl/Cmd+K`를 전역 검색에 쓰고 있을 수 있다. 구현 전에 반드시 확인하고, 이미 쓰고 있으면 `preventDefault`를 하지 말고 콘텐츠 단축키를 다른 키로 바꾼 뒤 그 사실을 차이표에 적는다. 남의 단축키를 빼앗지 않는다.

**확인**: `PS-T-033`.

### PD-010 — SHA 범위를 URL에 넣지 않는 원본 동작을 유지한다

**원본 상태**(`SOURCE_VERIFIED`): `repository-search.ts:14-16`의 주석이 명시한다. SHA/merge-order 범위는 살아 있는 재해석이 필요하므로 URL에 남기지 않는다. `deriveInitialRangeType`도 `seq`를 복원하지 않는다.

**결정**: 그대로 둔다. URL 키를 새로 만들지 않는다.

**이유**: SHA를 URL에 넣으면 링크를 받은 사람의 epoch에서 다른 서수로 해석될 수 있다. 원본의 판단이 옳고, 바꾸려면 서버 계약 변경이 필요하다.

**반드시 문서화할 것**: 공유 URL과 새로고침으로 **복원되지 않는 유일한 조건**이 merge-order 범위라는 사실. 사용자에게도 알려야 하므로, `seq` 범위가 적용된 상태에서는 활성 요약에 `Merge order set (공유 주소에는 포함되지 않습니다)`를 붙인다.

**확인**: `PS-T-042`.

## 2. 동등성 판정표

`PS-F-###`는 `SOURCE_EVIDENCE.md` 3장의 기능 ID다.

| 영역 | 기능 ID | 동등성 | 비고 |
|---|---|---|---|
| 저장소·브랜치 선택 | PS-F-001, PS-F-004, PS-F-005 | 완전 동등 | 상태 초기화 규칙까지 같다 |
| 저장소 목록 페이지 | PS-F-002, PS-F-003 | 기능 동등 + `PD-003` | 조회 규칙(20페이지 한계, 중복 제거)은 같다 |
| 파일 트리 | PS-F-006 ~ PS-F-013 | 완전 동등 | 루트 필터의 의미를 바꾸지 않는다 |
| 네 탭 | PS-F-014 ~ PS-F-018 | 완전 동등 | 수동 활성화까지 같다 |
| 필터 필드 | PS-F-019 ~ PS-F-024 | 완전 동등 | |
| 범위 편집 | PS-F-025 ~ PS-F-031 | 동등 + `PD-002` | 검증 기준만 다르다 |
| 제출·초기화·단축키 | PS-F-032 ~ PS-F-035 | 동등 + `PD-009` | |
| 질의 생성 | PS-F-036 ~ PS-F-038 | 완전 동등 | 문자열이 한 글자도 달라지면 안 된다 |
| 조회 경로 분기 | PS-F-039 ~ PS-F-045 | 완전 동등 | |
| 결과 표 | PS-F-046 ~ PS-F-069 | 완전 동등 | 표현만 MUI로 바뀐다 |
| 행 상세 | PS-F-070 ~ PS-F-079 | 완전 동등 | |
| M 번호 표시 | PS-F-080 ~ PS-F-083, PS-F-086 | 완전 동등 | 판정 함수를 그대로 옮긴다 |
| M 링크 종단 | PS-F-084, PS-F-085 | 미구현 + `PD-001` | 원본에도 없다. 안내만 추가한다 |
| Commit history | PS-F-087 ~ PS-F-102 | 동등 + `PD-004` | 날짜 표기만 다르다 |
| Diff | PS-F-103 ~ PS-F-117 | 동등 + `PD-008` | 링크 경로만 다르다 |
| 모달 보조 동작 | PS-F-118, PS-F-119 | 축소 + `PD-006`, `PD-007` | 드래그와 테마 토글을 뺀다 |
| Time-lapse | PS-F-120 ~ PS-F-128 | 완전 동등 | 30개 창, 3개 묶음, 수동 시작까지 같다 |
| 모달 중첩 | PS-F-129 | 동등 + 규칙 명시 | `DESIGN_AND_WIREFRAMES.md` 7장이 소유권을 정한다 |
| 전역 단축키 | PS-F-130 ~ PS-F-132 | 완전 동등 | 가드 selector를 그대로 옮긴다 |
| App Shell | — | 제외 | 로고·전역 메뉴·로그인·전역 테마 토글 |

## 3. 수용 테스트

각 시험은 Given / When / Then으로 적었다. `fx:`로 시작하는 이름은 `fixtures/` 디렉터리의 시나리오 이름이다. 분류가 `PORT_DECISION`인 시험은 원본에 대응 시험이 없는 새 시험이다.

### 3.1 골격과 호스트 경계

**PS-T-001 · App Shell 없이 마운트** (`PORT_DECISION`)
- Given: 테스트용 최소 harness가 `PipePrSearchContent`에 `client = fixtureClient`, `searchIdentity = { kind: 'unavailable' }`, `routeBase = '/pr-search'`를 주고 높이 800px·폭 1280px 상자 안에 마운트한다.
- When: 렌더링이 끝난다.
- Then: 문서 어디에도 pr-search 로고, 전역 헤더, 전역 사이드 메뉴, 로그인·로그아웃 제어, 테마 토글이 없다. 컴포넌트가 만든 DOM은 전부 주어진 상자 안에 있고 `document.body`에 스타일이나 클래스를 추가하지 않는다. `100vh`/`100dvh`를 쓰는 인라인 스타일이 없다.

**PS-T-002 · 기본 진입** (`SOURCE_VERIFIED`)
- Given: `fx:default-search`. URL 파라미터가 없다.
- When: 화면이 처음 그려진다.
- Then: 탭이 `Search`, `Commit history`, `My open PRs`, `My merged PRs` 순서로 있고 `Search`가 선택되어 있다. Filters 영역은 접혀 있고 제목은 `Filters`(개수 없음)다. 저장소는 목록의 첫 항목이 선택된다. 정렬 표기는 `PR Descending`이다. 첫 조회의 요청 파라미터는 `q=kind:pull_request repo:"demo/modem"`, `sort=pr_number`, `order=desc`, `size=50`, `facets=true`다.

**PS-T-040 · 언마운트 후 잔류 없음** (`PORT_DECISION`)
- Given: `PS-T-001`의 harness에서 Diff 모달을 열고 Time-lapse를 연 상태.
- When: 두 모달을 닫지 않은 채로 컴포넌트를 언마운트하고 다른 화면을 마운트한다.
- Then: `window`의 `keydown` 리스너가 남아 있지 않다. `document.body`의 `overflow`와 `padding-right`가 마운트 전 값으로 돌아간다. portal로 붙었던 노드가 DOM에 남아 있지 않다. `IntersectionObserver`가 disconnect되어 있다.

**PS-T-041 · 실제 대상 경로 시험** (`PORT_DECISION`)
- Given: PIPE의 실제 route adapter가 연결된 경로.
- When: 그 경로를 연다.
- Then: 콘텐츠가 렌더링되고, 주요 흐름(`PS-T-002`, `PS-T-016`, `PS-T-019`)이 그 경로에서도 통과한다. harness만으로 끝내지 않는다.

### 3.2 저장소와 파일 문맥

**PS-T-003 · 저장소 목록 여러 페이지** (`SOURCE_VERIFIED` + `PD-003`)
- Given: `fx:repos-paged`. 1페이지가 저장소 100개와 `next_cursor: "c1"`, 2페이지가 **빈 배열**과 `next_cursor: "c2"`, 3페이지가 저장소 8개와 `next_cursor: null`을 준다.
- When: 화면이 처음 그려진다.
- Then: 빈 2페이지를 건너뛰고 3페이지까지 이어 읽어 108개가 목록에 있다. 요청은 정확히 3회다.
- When: 목록 하단 `Load more`를 누른다.
- Then: `next_cursor`가 `null`이므로 `Load more` 행 자체가 없다. 목록은 열린 채로 남는다.
- And: 입력에 문자를 넣으면 **불러온 108개 안에서만** 걸러지고, 아직 남은 cursor가 있을 때는 `불러온 N개 중에서 찾고 있습니다` 안내가 보인다.

**PS-T-003b · 불러오지 않은 저장소 deep link** (`SOURCE_VERIFIED`)
- Given: `fx:repos-paged`. URL이 `repository=demo/late-repo`를 담고 있고 그 저장소는 3페이지에 있다.
- When: 1페이지만 로드된 시점에 선택기를 그린다.
- Then: 선택기가 빈칸이 아니라 `demo/late-repo`를 보여 준다(`RepositoryWorkspace.tsx:326`의 규칙). 해당 페이지가 도착하면 중복 항목이 생기지 않는다.

**PS-T-004 · 저장소 전환 중 늦게 도착한 이전 응답** (`SOURCE_VERIFIED`)
- Given: `fx:slow-previous`. `demo/modem` 검색 응답이 600ms 지연된다.
- When: 응답이 도착하기 전에 저장소를 `demo/rfic`으로 바꾼다.
- Then: 머리글은 즉시 `demo/rfic`을 보이고 표는 비어 있거나 골격이다. 600ms 뒤 `demo/modem`의 응답이 도착해도 **표에 들어가지 않는다**. cursor와 펼친 상세도 초기화되어 있다.

**PS-T-005 · base branch 변경** (`SOURCE_VERIFIED`)
- Given: `mnum_from=10`, `mnum_to=40`, 그리고 SHA 두 개로 확정한 `seqRange`가 있는 상태.
- When: Base branch를 다른 값으로 바꾼다.
- Then: `mnum_from`과 `mnum_to`가 draft와 URL 양쪽에서 비워진다. `seqRange`는 공간이 달라져 질의에서 빠지고 활성 범위 요약에도 나타나지 않는다. `source_ref`와 `path_kind`가 URL에서 제거된다.

**PS-T-023 · 루트 필터와 폴더 lazy 로딩** (`SOURCE_VERIFIED`)
- Given: `fx:source-tree`. 루트에 `src`(directory), `tests`(directory), `README.md`(file), `vendor/lib`(submodule)이 있다.
- When: `Filter root entries`에 `sr`을 넣는다.
- Then: `src`만 남는다. **하위 파일을 재귀로 찾지 않는다.** 결과 표는 영향을 받지 않는다.
- When: 필터를 비우고 `src`를 펼친다.
- Then: `tree` 조회가 `revision`, `tree_sha`, `path=src`를 실어 한 번만 나간다.
- And: `vendor/lib`는 `aria-disabled`이고 선택되지 않는다.

**PS-T-024 · 긴 경로·한글·공백·브랜치 슬래시** (`SOURCE_VERIFIED`)
- Given: `fx:encoding`. 저장소 `demo/모뎀 테스트`, 브랜치 `release/2026-Q1`, 경로 `src/phy/한글 파일 이름.c`.
- When: 그 파일을 고르고 history를 연다.
- Then: 저장소는 경로 세그먼트 하나로 `encodeURIComponent`되어 `demo%2F%EB%AA%A8%EB%8E%80%20...` 형태가 되고, 브랜치의 `/`와 경로의 공백·한글은 query 값으로 인코딩된다. 화면에서 이름이 잘리지 않고 가로 스크롤이 전체 페이지로 번지지 않는다.

### 3.3 필터와 범위

**PS-T-006 · 한글 IME 조합 중 Enter** (`PORT_DECISION`)
- Given: Filters가 열려 있고 `q` 입력에 focus가 있다.
- When: 한글을 입력해 조합 상태에서 `Enter`를 누른다(`isComposing === true`).
- Then: 검색이 실행되지 않는다. 조합만 확정된다.
- When: 조합이 끝난 뒤 다시 `Enter`를 누른다.
- Then: 검색이 실행되고 질의의 자유 텍스트에 확정된 한글이 들어간다.
- 비고: 원본은 `form`의 기본 제출에 의존하므로 이 보호가 없다. 브라우저·IME 조합에 따라 조합 확정 `Enter`가 제출로 새는 경우가 있어 명시적으로 막는다.

**PS-T-007 · draft가 조용히 적용되지 않는다** (`SOURCE_VERIFIED`)
- Given: `author=dev-a`가 적용된 상태에서 Filters를 연다.
- When: Author를 `dev-b`로 고치고 제출하지 않은 채 Filters를 접는다.
- Then: 적용된 조건은 여전히 `dev-a`다. 결과와 질의가 바뀌지 않는다. 활성 개수도 그대로다.
- When: Filters를 다시 편다.
- Then: 입력에는 `dev-b`가 남아 있다(draft 보존).

**PS-T-008 · 조회 경로 선택** (`SOURCE_VERIFIED`)
- Given: `fx:identifier-routes`. 저장소는 `demo/modem`.
- Then: 아래 표대로 목적지가 정해진다. 각 경우의 실제 요청 URL을 단언한다.

| `q` 입력 | 목적지 | 요청 |
|---|---|---|
| `#1842` | resolve | `/api/resolve?q=demo%2Fmodem%231842&limit=50` |
| `demo/modem#1842` | resolve | `/api/resolve?q=demo%2Fmodem%231842&limit=50` |
| `d71be10` (7자) | resolve | `/api/resolve?q=d71be10&limit=50` |
| 40자 전체 SHA | resolve | `/api/resolve?q={sha}&limit=50` |
| GHE PR URL | resolve | `/api/resolve?q={url}&limit=50` |
| `NR measurement` | search | `/api/search?q=kind%3Apull_request+repo%3A%22demo%2Fmodem%22+NR+measurement&…` |
| `repo:acme/a author:kim` | search | 구조화 질의가 이긴다. resolve로 가지 않는다 |
| `d71be1` (6자) | 조회 없음 | 판별기가 거절한다 |

**PS-T-009 · PR 번호 범위** (`SOURCE_VERIFIED`)
- Given: Range filter가 `PR number`, `from=1842`, `to=2044`.
- When: 제출한다.
- Then: 질의에 `pr_number:1842..2044`가 정확히 한 번 들어간다. 경계값 두 개가 결과에 포함되는지는 서버 계약을 따르며 클라이언트가 다시 거르지 않는다.

**PS-T-010 · M 범위인데 브랜치가 없다** (`SOURCE_VERIFIED`)
- Given: 저장소는 골랐지만 Base branch가 `All branches`(빈 값)다.
- When: Range filter를 `M number`로 고른다.
- Then: 두 입력이 `disabled`이고 `Select a repository and base branch to filter by M number.`가 설명으로 붙는다.
- When: 그 전에 다른 브랜치에서 채워 둔 `mnum_from`/`mnum_to`가 draft에 남아 있는 채로 제출한다.
- Then: 제출 직전에 두 값이 비워져 질의에 `mnum:`이 들어가지 않는다. 임의의 번호 공간을 고르지 않는다.

**PS-T-011 · 날짜 범위** (`SOURCE_VERIFIED`)
- Given: Range filter가 `Merged date`.
- When: `Merged after`만 고르고 제출한다.
- Then: `Enter both merge start and end dates.` 오류가 나고 화면이 `Merged date` 유형을 보인다. 조회가 나가지 않는다.
- When: 양쪽을 `2026-01-01`과 `2026-02-01`로 채우고 제출한다.
- Then: 질의에 `merged:2026-01-01..2026-02-01`이 들어간다. 값은 **로컬 달력 기준 문자열 그대로**이며 UTC로 변환하지 않는다.
- And: 달력의 `Clear`는 값을 빈 문자열로 만들고 `Today`는 오늘 날짜를 넣는다.

**PS-T-012 · SHA 범위의 다섯 경우** (`SOURCE_VERIFIED`)
- Given: `fx:sha-range`. 저장소 `demo/modem`, base `main`.

| 경우 | 입력 | 기대 |
|---|---|---|
| 정상 | 두 SHA가 각각 단일 commit으로 해석되고 같은 공간, `merge_seq` 42와 80 | 질의에 `seq:42..80`. 요약은 `Merge order set` |
| 다중 후보 | `from`이 commit 후보 2개로 해석된다 | `One of the commit SHAs could not be resolved to a single commit.` 첫 후보를 고르지 않는다 |
| 미채번 | `to`의 `merge_seq`가 `null` | `One or both commits do not have a merge sequence number yet.` |
| 다른 브랜치 | `to`의 `sequence_space`가 `demo/modem@develop` | `Both commits must belong to the selected repository and base branch.` |
| 역전 | `from.merge_seq = 80`, `to.merge_seq = 42` | `The first commit merges after the second. Enter the commits in merge order.` **자동으로 맞바꾸지 않는다** |

- And: 어느 실패에서도 `navigate`가 호출되지 않아 다른 필터가 덮어써지지 않는다.
- And: 두 SHA를 모두 비우고 다시 제출하면 이전에 확정한 `seqRange`가 지워진다.

**PS-T-013 · 여러 범위가 함께 있을 때** (`SOURCE_VERIFIED`)
- Given: `pr_from=10`, `pr_to=20`, `mnum_from=5`, `mnum_to=9`가 모두 채워져 있고 base branch가 있다.
- When: 제출한다.
- Then: 질의에 `pr_number:10..20`과 `mnum:5..9`가 **둘 다** 들어가고 공백으로 이어진 AND다. 활성 요약은 `PR 10–20 · M 5–9`를 보인다. 화면에는 선택된 한 유형의 입력만 보이지만 요약으로 숨은 조건을 알 수 있다.

**PS-T-013b · 다른 유형의 반쪽 값이 제출을 막지 않는다** (`PORT_DECISION` / `PD-002`)
- Given: Range filter가 `PR number`이고 `pr_from=10`만 채워져 있다(미완성).
- When: Range filter를 `M number`로 바꾸고 `mnum_from=5`, `mnum_to=9`를 채운 뒤 제출한다.
- Then: 검색이 **실행된다.** 질의에 `mnum:5..9`가 들어간다. `Enter both PR number range bounds.` 오류가 나지 않고 화면이 `PR number` 유형으로 되돌아가지 않는다.
- And: 미완성이던 `pr_from`은 제출 시점에 비워지고 활성 요약에 PR 항목이 없다.
- 비고: 원본은 여기서 오류를 낸다(`DEV-729`). 의도적 차이다.

**PS-T-014 · Reset** (`SOURCE_VERIFIED`)
- Given: 저장소·브랜치·경로·탭·정렬이 모두 정해져 있고 여러 필터가 적용되어 있으며 `seqRange`도 확정되어 있다.
- When: `Reset`을 누른다.
- Then: `q`, `author`, `label`, `state`, `from`, `to`, `path`, `base`, `pr_from`, `pr_to`, `mnum_from`, `mnum_to`가 비워진다. `shaFrom`·`shaTo`·`seqRange`도 비워지고 Range filter 유형이 `PR number`로 돌아간다.
- And: **`repository`, `tab`, `sort`, `order`는 그대로 남는다.** `base`가 비워지므로 파일 트리는 기본 브랜치로 다시 읽힌다.

**PS-T-033 · 단축키와 입력의 충돌** (`SOURCE_VERIFIED` + `PD-009`)
- Given: 화면이 마운트되어 있다.
- When: `q` 입력에 focus를 두고 `t`를 친다.
- Then: 글자가 입력되고 Time-lapse가 열리지 않는다.
- When: 저장소 선택기(`role="combobox"`)에 focus를 두고 `d`를 친다.
- Then: 선택기의 타자 검색만 동작하고 Diff가 열리지 않는다.
- When: 표의 한 행에 마우스를 올린 뒤 `Ctrl+D`를 누른다.
- Then: 그 행의 Diff가 열린다.
- When: Filters가 접힌 상태에서 `Ctrl/Cmd+K`를 누른다.
- Then: Filters가 열리고 `q` 입력에 focus가 가며 기존 값이 선택된다.
- And(`TARGET_VERIFY`): PIPE 셸이 같은 키를 쓰면 이 단축키를 다른 키로 바꾸고 차이표에 적는다.

### 3.4 결과 표

**PS-T-015 · 정렬 세 열** (`SOURCE_VERIFIED`)
- Given: `fx:default-search`.
- When: `M number` 머리글을 누른다.
- Then: 요청이 `sort=merge_seq&order=desc`로 나간다. 한 번 더 누르면 `order=asc`. `#`를 누르면 `sort=pr_number&order=desc`로 되돌아간다.
- And: **이미 받은 행을 클라이언트에서 다시 정렬하지 않는다.** 응답이 오기 전까지 표는 이전 상태이거나 골격이다.
- And: `aria-sort`가 활성 열에만 `ascending`/`descending`이고 나머지는 `none`이다.

**PS-T-016 · 50/50/23 cursor** (`SOURCE_VERIFIED`)
- Given: `fx:paging-123`. 1페이지 50행 + `next_cursor: "p2"` + `total: { value: 123, relation: "eq" }`, 2페이지 50행 + `next_cursor: "p3"`, 3페이지 23행 + `next_cursor: null`.
- When: 결과 영역을 끝까지 스크롤한다.
- Then: 요청이 정확히 3회 나가고 표에 123행이 있다. 2·3페이지 요청에는 `facets=false`가 붙고 1페이지의 facet이 Label 선택지에 그대로 남아 있다.
- And: `next_cursor`가 `null`이 된 뒤에는 더 이상 요청이 나가지 않고 `{n} shown` 영역이 사라진다.
- And: 머리글은 `123 items`를 보인다.

**PS-T-017 · 다음 페이지 실패** (`SOURCE_VERIFIED`)
- Given: `fx:paging-cursor-fail`. 2페이지 요청이 400과 `error.code = "INVALID_CURSOR"`를 준다.
- When: 스크롤로 2페이지를 요청한다.
- Then: 이미 표시된 50행이 **그대로 남는다.** 오류 배너와 `Reload first page` 버튼이 나온다.
- And: 계속 스크롤해도 **자동 재요청이 일어나지 않는다.** 요청 횟수가 늘지 않는다.
- When: `Reload first page`를 누른다.
- Then: cursor가 비워지고 1페이지부터 다시 읽는다.

**PS-T-018 · total의 두 형태** (`SOURCE_VERIFIED`)
- Given: `fx:total-gte`가 `total: { value: 10000, relation: "gte" }`를 준다.
- Then: 머리글이 `10,000+ items`를 보인다. `relation: "eq"`이면 `10,000 items`다. 두 표기가 구별된다.

**PS-T-019 · PR 번호·제목·펼침 버튼의 역할 분리** (`SOURCE_VERIFIED`)
- Given: `gheBaseUrl`이 설정된 `fx:default-search`.
- When: `#` 열의 `#548`을 누른다.
- Then: 새 탭으로 `{ghe}/demo/modem/pull/548`이 열린다. 행 상세는 펼쳐지지 않는다.
- When: 제목을 누른다.
- Then: 상세가 펼쳐지고 외부 이동이 일어나지 않는다.
- When: 오른쪽 끝 버튼을 누른다.
- Then: 제목과 같은 동작이다. `aria-expanded`가 `true`가 된다.
- And: `gheBaseUrl`이 없으면 `#548`은 링크가 아닌 평문이다. 커밋 행은 어느 경우에도 링크가 아니다.

**PS-T-020 · 한 번에 한 상세** (`SOURCE_VERIFIED`)
- Given: `fx:detail-failure`. `#548`의 상세는 정상, `#547`의 상세는 500을 준다.
- When: `#548`을 펼치고 이어서 `#547`을 펼친다.
- Then: `#548`이 닫히고 `#547`만 열린다. 동시에 두 개가 열리지 않는다.
- Then: `#547` 영역 안에 `Unable to load details.`와 `Try again`이 있다. **표의 다른 행과 머리글은 정상이다.**
- When: `Try again`을 누른다.
- Then: 그 행의 상세만 다시 조회한다.

**PS-T-021 · M 배지 상태** (`SOURCE_VERIFIED`)
- Given: `fx:mnumber-states`가 한 페이지에 다음 행을 담는다.

| 행 | 필드 | 기대 |
|---|---|---|
| A | `state=assigned`, `merge_number="M-1900-42"`, `epoch=3` | 라벨이 `M-1900-42`. 링크가 있고 네 파라미터를 싣는다 |
| B | `state=pending`, `reason="not_sequenced"` | 라벨 `Awaiting sequence numbering`. **링크 없음** |
| C | `state=pending`, `reason="mapping_conflict"` | 라벨 `M number pending`. 설명에 `Numbering stopped because merge evidence is contradictory.` |
| D | `state=not_applicable`, `reason="branch_not_tracked"` | 라벨 `Branch not numbered` |
| E | `state=unavailable`, `reason="number_capacity_exceeded"` | 라벨 `M number unavailable`, tone warning |
| F | M 키가 전혀 없음 | 셀이 비어 있다. 배지를 그리지 않는다 |
| G | `state=assigned`인데 `merge_number`가 `null` | `M number unavailable`로 낮춘다. 링크 없음 |
| H | `kind=commit` (history 탭) | 배지를 그리지 않는다 |
| I | `state=assigned`, `epoch`이 `null` | 라벨은 번호지만 **링크가 없다** |

- And: 어떤 경우에도 화면이 번호를 지어내지 않는다.

**PS-T-022 · M 링크 진입** (`PORT_DECISION` / `PD-001`)
- Given: A행의 배지 링크.
- When: 새 탭으로 연다(또는 주소를 복사해 붙여 넣는다).
- Then: 주소에 `m_repository=demo%2Fmodem`, `m_base_branch=main`, `m_seq_epoch=3`, `m_number=M-1900-42`가 모두 있다. 경로는 하드코딩된 `/search`가 아니라 주입받은 `routeBase`다.
- Then: 열린 화면이 **조용히 무시하지 않고** 네 값을 보여 주는 안내를 띄운다.
- 비고: 원본은 기본 화면에서 이 네 값을 무시한다. 안내 추가가 의도적 차이다.

**PS-T-035 · 복사 실패** (`SOURCE_VERIFIED`)
- Given: `navigator.clipboard.writeText`가 거부되도록 만든 환경. 그리고 `navigator.clipboard` 자체가 없는 환경.
- When: 상세의 SHA 버튼을 누른다.
- Then: `Unable to copy. Select and copy the SHA manually.`가 live region에 나온다. **성공 문구가 나오지 않는다.**
- And: Commit history의 SHA·PR 복사도 같은 규칙을 따른다.

**PS-T-036 · identity 미설정과 변경** (`SOURCE_VERIFIED` + `PORT_DECISION`)
- Given: `searchIdentity = { kind: 'unavailable' }`.
- When: `My open PRs` 탭을 고른다.
- Then: 조회가 나가지 않는다. **전체 PR 목록이 나오지 않는다.** 계정 문맥이 필요하다는 안내가 나온다.
- When: identity가 `{ kind: 'ready', gheLogin: 'dev-a' }`로 바뀐다.
- Then: 질의에 `author:"dev-a" is:open`이 들어간다.
- When: identity가 `dev-b`로 바뀐다.
- Then: 캐시 key가 달라져 `dev-a`의 결과가 보이지 않는다.
- And: 캐시 key에 토큰·쿠키·개인 credential이 들어가지 않는다.

**PS-T-037 · 검색 계층만의 장애** (`PORT_DECISION`)
- Given: `client.searchChanges`가 503을 준다.
- Then: 오류가 Search 영역 안에만 나타난다. PIPE의 다른 화면이나 전역 로그인 상태가 영향을 받지 않는다. 자동 로그아웃이 일어나지 않는다.

**PS-T-038 · 미연결 표시** (`PORT_DECISION`)
- Given: fixture client로 실행한다.
- Then: 화면 상단에 `Demo data · 실제 API 미연결` 표시가 항상 보인다.
- Given: 실제 client가 설정되지 않은 상태(`baseUrl`이 없다).
- When: 검색을 시도한다.
- Then: `검색 연결이 설정되지 않았습니다` 오류가 난다. **fixture로 자동 전환되지 않는다.**

**PS-T-039 · 섞인 데이터의 표시** (`SOURCE_VERIFIED` + `PD-004`)
- Given: `fx:messy-rows`가 다음을 담는다: 100자가 넘는 한글 제목, `title: null`인 PR, `author: null`, `state: null`, `additions: 0`과 `deletions: 0`, `additions: null`과 `deletions: null`, `merged_at: null`.
- Then: 제목이 없는 PR은 `Untitled pull request`, author가 없으면 `—`, state가 없으면 `—`를 보인다.
- Then: `+0 −0`과 `—`가 **구별된다.** 0을 없음으로 표시하지 않는다.
- Then: `merged_at`이 `null`이면 `—`, 값이 있으면 `YYYY-MM-DD HH:MM UTC`.
- Then: Commit history의 `Committed`도 UTC 기준으로 그린다(`PD-004`).
- Then: 긴 제목 때문에 표 전체가 가로로 밀리지 않고, 제목은 최대 두 줄로 줄인 뒤 전체 값을 확인할 수 있다.

### 3.5 Commit history

**PS-T-025 · 추가 페이지 중 브랜치 머리 이동** (`SOURCE_VERIFIED`)
- Given: `fx:history-pinned`. 1페이지 응답의 `revision`이 `a91bc21`이고 `next_page: 2`다. 2페이지 응답의 `revision`은 `f00dcaf`(브랜치가 움직였다)다.
- When: `Load older commits`를 누른다.
- Then: 2페이지 요청의 `ref`는 **`a91bc21`**이다. 브랜치 이름이 아니다.
- Then: 두 응답의 커밋이 섞이지 않고 같은 스냅숏으로 이어진다. `sha` 중복이 있으면 제거된다.

**PS-T-026 · Linked PRs의 세 상태** (`SOURCE_VERIFIED`)
- Given: `fx:history-pr-states`. 커밋 A는 `pull_request_numbers: [548]`, B는 `[]`, C는 `null`, 응답 전체에 `pull_requests_unavailable: true`.
- Then: A는 `#548` 배지, B는 `—`, C는 `Pending`을 보인다. 세 상태가 구별된다.
- Then: `PR link lookup is temporarily unavailable. Commit history remains available.` 안내가 나오고 **이력 표는 계속 쓸 수 있다.**
- And: `Pending`을 "연결된 PR이 없음"으로 표시하지 않는다.

**PS-T-027 · 비교 선택 조건** (`SOURCE_VERIFIED`)
- Given: 파일을 고른 상태의 history.
- When: 아무것도 고르지 않는다 / 하나를 고른다.
- Then: `Compare selected` 버튼이 각각 `(비활성)`, `(1/2)`이며 비활성이다.
- When: 두 개를 고른다.
- Then: `(2/2)`로 활성이 되고, 나머지 체크박스가 `disabled`가 된다.
- When: 누른다.
- Then: **먼저 고른 것이 head, 나중에 고른 것이 base**가 되어 Diff가 열린다.
- Given: 폴더나 루트를 고른 상태.
- Then: `Select a file to enable comparison` 안내가 나오고 Compare와 Time-lapse가 모두 비활성이다.

### 3.6 Diff와 Time-lapse

**PS-T-028 · Diff의 기본 조작** (`SOURCE_VERIFIED` + `PD-007`)
- Given: `fx:diff-basic`. 파일 두 개, before/after 텍스트가 주어진다.
- Then: 기본 모드가 `Side by side`다. 좌우 줄 번호가 대응하고 스크롤 컨테이너가 **하나**다.
- When: `Unified`로 바꾼다.
- Then: 같은 데이터로 한 열 표시가 된다. 줄 대응이 유지된다.
- When: `Find in diff`에 문자열을 넣는다.
- Then: 일치하는 줄 수가 `N matching lines`로 표기되고 `↑`/`↓`가 순환 이동한다. 검색어가 없으면 `N change groups`로 바뀌어 변경 덩어리를 옮겨 다닌다.
- When: `Swap`을 누른다.
- Then: before/after가 맞바뀌고 머리글의 SHA 표기도 함께 바뀐다.
- When: `Show all lines`를 켠다.
- Then: 접혀 있던 변경 없는 줄이 전부 보인다. 기본은 변경 줄 앞뒤 3줄이다.
- And(`PD-007`): 모달 머리글을 끌어도 모달이 움직이지 않는다. 전체화면 버튼은 동작한다.

**PS-T-029 · 파일 상태별 표현** (`SOURCE_VERIFIED` + `PD-008`)
- Given: `fx:diff-file-states`. `added`, `removed`, `renamed`(`previous_path` 있음), `binary`, `too_large`, `missing` 파일이 각각 있다.
- Then: `added`는 before 조회를 하지 않고 왼쪽이 빈 파일로 그려진다. `removed`는 그 반대다.
- Then: `renamed`는 `Renamed from {previous_path}` 링크를 보이고, 링크 주소가 **`routeBase` 기반**이다. `/search`가 하드코딩되어 있지 않다.
- Then: `binary`·`too_large`·`missing`은 `Text comparison unavailable`과 서버가 준 `reason`을 보인다. **빈 코드 영역을 실제 소스인 것처럼 보이지 않는다.**
- Then: 관련 PR 목록의 링크가 존재하지 않는 `/pr/...` 내부 경로를 가리키지 않는다.

**PS-T-030 · 로딩 중 PR base/head 변경** (`SOURCE_VERIFIED`)
- Given: `fx:diff-moved`. 1페이지 응답의 `head`가 `d71be10`, 2페이지 응답의 `head`가 `e82cf21`.
- When: `More files`를 누른다.
- Then: `This PR changed while loading files. Close and reopen the comparison.`이 나오고 파일 목록이 더 늘지 않는다. **서로 다른 스냅숏을 비교하지 않는다.**

**PS-T-031 · Time-lapse의 revision 창** (`SOURCE_VERIFIED`)
- Given: `fx:timelapse`. History에서 50개를 읽은 뒤 `next_page`가 남아 있는 상태로 Time-lapse를 연다.
- Then: 추가 조회를 하지 않고 이미 읽은 50개를 쓴다. 슬라이더 범위가 `0..49`이고 기본 선택이 가장 최신이다. 표기는 `50 / 50`이다.
- Then: `Showing the loaded path revisions.…` 안내가 보인다. **슬라이더를 전체 이력인 것처럼 보이지 않는다.**
- When: `Analyze line history`를 누른다.
- Then: 현재 위치에서 뒤로 최대 30개 revision의 파일을 3개씩 묶어 읽는다. 분석이 끝나면 `{n} revisions analyzed.`가 표기된다.
- Then: 자동으로 시작하지 않는다. 누르기 전에는 `Analyze line history, then select a line to follow its changes.`가 보인다.
- When: 줄을 고른다.
- Then: 그 줄의 이력 항목이 나오고 각 항목의 종류가 `Present at window start` / `Aligned replacement` / `Added` 중 하나로 표기된다.
- And: `Line correspondence is inferred from adjacent diffs, not authoritative blame.` 고지가 항상 보인다.

**PS-T-032 · 모달 중첩과 focus 복귀** (`PORT_DECISION`)
- Given: 결과 표의 한 행에서 `View diff`를 눌러 Diff를 연다.
- When: Diff 안에서 `Time-lapse`를 누른다.
- Then: Time-lapse가 Diff 위에 열린다. `Escape`는 **가장 위의 모달만** 닫는다.
- When: `Escape`를 한 번 누른다.
- Then: Time-lapse가 닫히고 Diff가 남는다. focus가 Diff의 `Time-lapse` 버튼으로 돌아간다.
- When: `Escape`를 한 번 더 누른다.
- Then: Diff가 닫히고 focus가 `View diff` 버튼으로 돌아간다. `document.body`의 스크롤 잠금이 해제된다.
- And: 두 모달이 열려 있는 동안 body 스크롤 잠금이 **한 번만** 적용되고, 안쪽 모달을 닫아도 풀리지 않는다.

**PS-T-034 · 키보드 전 과정** (`SOURCE_VERIFIED`)
- Given: 마우스를 쓰지 않는다.
- Then: `Tab`만으로 저장소 선택기 → 브랜치 선택기 → 트리 → 탭 목록 → Filters 토글 → (열면) 각 필드 → Search/Reset → 표 순으로 갈 수 있다.
- Then: 트리에서 `↑ ↓ Home End`로 항목을 옮기고 `→ ←`로 펼치고 접으며 `Enter`로 고른다. 각 항목의 이름이 읽히고 펼침 상태가 `aria-expanded`로 전달된다.
- Then: 탭은 화살표로 이동만 하고 `Enter`/`Space`로 전환된다(수동 활성화).
- Then: 표 머리글의 정렬 버튼에 focus가 가고 `aria-sort`가 읽힌다.
- Then: 모달을 열면 focus가 모달 안으로 가고 `Tab`이 모달 밖으로 새지 않으며, 닫으면 열었던 제어로 돌아온다.

### 3.7 URL과 복원

**PS-T-042 · 공유·새로고침·뒤로 가기** (`SOURCE_VERIFIED` + `PD-010`)
- Given: 저장소, base, 탭, `q`, `author`, `label`, `state`, `pr_from`/`pr_to`, `sort`, `order`, `path`, `path_kind`, `source_ref`가 모두 설정된 상태.
- When: 주소를 복사해 새 창에서 연다.
- Then: 위 조건이 전부 복원된다. **cursor는 주소에 없다.**
- Given: merge-order(SHA) 범위가 적용된 상태.
- When: 새로고침한다.
- Then: 그 범위는 **복원되지 않는다.** Range filter 유형이 `PR number`로 돌아간다. 이 사실이 화면의 활성 요약에 미리 고지되어 있었다.
- When: 조건을 몇 번 바꾼 뒤 브라우저 뒤로 가기를 누른다.
- Then: 원본은 `router.replace`를 쓰므로 필터 변경이 이력에 쌓이지 않는다. 같은 의미를 유지한다(`navigation.replace`).
- And: URL이 외부에서 바뀌면(뒤로 가기 포함) draft가 그 값으로 다시 맞춰진다.

## 4. 시각 검수 체크리스트

이 표는 PIPE 담당 세션이 **실제로 화면을 렌더링한 뒤** 확인한다. 이 세션은 렌더링을 하지 못했으므로 모든 항목이 미확인이다.

| 항목 | 합격 기준 | 확인 방법 |
|---|---|---|
| 정보 우선순위 | 저장소·브랜치, 결과 수, 제목, 상태, 보조 메타가 한눈에 구별된다 | 1280×800 스크린숏 |
| 제어 정렬 | 같은 줄의 MUI Select와 antd DatePicker의 외곽 높이가 같고 라벨 baseline이 어긋나지 않는다 | bounding box 측정 |
| 결과 가시성 | W1280×H800, 필터 닫힘, 상세 미펼침에서 결과 행이 8행 이상 보인다 | 실측하고 실제 값을 보고한다 |
| 하단 정렬 | desktop bounded 모드에서 좌우 패널 하단 차이가 4px 이내 | `getBoundingClientRect` |
| 넘침 | 긴 한글 제목·긴 파일명·긴 URL에서 페이지 전체가 가로로 밀리지 않는다 | `document.documentElement.scrollWidth` 비교 |
| 상태 구별 | hover / focus-visible / expanded / disabled / error가 서로 다르고 색에만 의존하지 않는다 | 각 상태 스크린숏 |
| 스크롤 | 표 머리글이 고정되고 중첩 이중 스크롤이 없다 | 스크롤 중 스크린숏 |
| 모달 | 머리글·닫기·툴바에 항상 접근할 수 있고 팝오버가 잘리지 않는다 | 960px 폭에서 확인 |
| 코드 가독성 | split diff의 좌우 줄 대응, 들여쓰기, 긴 줄, 탭, 한글이 보존된다 | `fx:diff-unicode`로 확인 |
| 테마 | PIPE가 지원하는 모든 테마에서 대비가 유지되고 별도 테마 토글이 없다 | 테마별 스크린숏 |
| 전환 | 레이아웃 점프가 없고 `prefers-reduced-motion`에서 전환이 제거되거나 짧아진다 | 설정 변경 후 확인 |

검수 화면은 최소 다음을 포함한다: 기본 검색, 필터 펼침, M/SHA 범위 오류, 행 상세 펼침, history 비교 선택, Diff split, Diff unified, Time-lapse, 로딩, 빈 결과, 오류, 좁은 콘텐츠 폭.

검수 프레임은 콘텐츠 상자 기준 1280×800, 1120×680, 960×680, 720×800, 390×844다. 실제 PIPE 경로에서는 브라우저 창 1440×900과 1366×768도 확인하고, 200% 확대에서 주요 제어가 가려지지 않는지 본다. 측정하지 못한 항목은 `NOT RUN`으로 남기고 수치를 지어내지 않는다.
