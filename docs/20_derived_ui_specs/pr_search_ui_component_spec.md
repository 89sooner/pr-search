# PR Search UI 컴포넌트 명세서

> 상태: review | 버전: v0.16 | 갱신일: 2026-09-15

CR-092 C-001 사용자 메뉴: 로그인 이름이 메뉴 트리거가 되고 항목은 신원 표시와 「로그아웃」이다. 「로그아웃」은 `POST /auth/logout` 폼 제출이며 결과는 공개 로그아웃 완료 화면이다(DEV-700).

CR-079 C-014 확장: mNumberState에 unavailable을 더하고 mNumberReason과 mNumberEpoch를 받는다. PR 공통 M 표시 모델이 API reason→한국어 문구를 매핑하며 null을 0/빈 문자열로 변환하지 않는다. 상태·번호·링크는 같은 epoch 모델에서 만들고 pending/unavailable에는 M 복사 링크 없음. Conductor Badge/기존 live region을 소비하며 새 토큰·CSS는 추가하지 않는다. [설계 9절](../30_technical_architecture/pr_search_wp074_design.md).

## 1. 문서 원칙

1. 동일 의미의 컴포넌트를 중복 구현하지 않는다. 각 컴포넌트는 책임, 입력, 상태, 이벤트, 접근성을 가진다.
2. 컴포넌트 이름과 prop 이름은 `../10_requirements/glossary.md`의 영문 표준명에서 파생한다. 축약하지 않는다(`sha` 단독 금지, `commitSha`).
3. **Conductor 우선 원칙**: 사내 `design-system`(`@conductor-by-89soone/react`)이 제공하는 프리미티브가 있으면 그것을 사용한다. 제품 컴포넌트는 Conductor 프리미티브를 조합할 뿐 스타일을 새로 정의하지 않는다. 새 UI 라이브러리를 도입하지 않는다.
4. Conductor에 없는 프리미티브가 필요하면, 먼저 조합으로 해결할 수 있는지 검토하고, 불가능하면 `DEV-###`로 기록해 design-system 저장소에 기여를 제안한다. PR Search 안에서 프리미티브를 자체 구현해 분기시키지 않는다.
5. 상태와 권한을 색상만으로 전달하지 않는다. 아이콘, 텍스트, 배지 라벨을 함께 사용한다.

## 2. Conductor 프리미티브 사용 맵

`@conductor-by-89soone/react`가 제공하는 컴포넌트와 이 제품에서의 용도다. 이 표에 있는 것은 재구현하지 않는다.

| Conductor 컴포넌트 | 이 제품에서의 용도 |
| --- | --- |
| `AppShell`, `TopBar`, `NavList` | 전역 셸, 상단 바, 좌측 내비게이션 |
| `Button`, `IconButton` | 모든 액션. `blockedReason`으로 권한 차단 사유를 표시 |
| `Card`, `CardGrid`, `Panel` | 요약 카드, 저장소 카드, 지표 그리드, 섹션 패널 |
| `Table` | 결과 테이블, 잡 테이블, 감사 로그, 실패 대기열 |
| `Badge`, `StatusBadge`, `SeverityTag` | 시퀀스 배지, PR 상태, 관계 신뢰도, 잡 상태 |
| `Timeline` | PR 타임라인, 릴리스 타임라인 |
| `CodeBlock` | 관계 근거 문자열, 커밋 메시지 전문, 질의 문자열 |
| `Kbd` | 단축키 안내(`⌘K`) |
| `TextField`, `TextArea`, `Select`, `Checkbox`, `Switch`, `Field` | 질의 입력, 앵커 입력, 필터, 폼 |
| `Dialog` | 파괴적·비가역 확인(재채번, 일괄 재처리, 저장소 해제) |
| `Drawer` | 보조 정보(필터 상세, 잡 로그, 관계 근거) |
| `DropdownMenu` | 행 액션, 정렬 선택, 컨텍스트 메뉴 |
| `Tooltip` | 시퀀스 공간 설명, 축약 SHA 전체 값, 지표 정의 |
| `Banner` | 화면 수준 경고(에폭 무효, 저하 모드, 재채번 중) |
| `EmptyState` | 모든 빈 상태 |
| `Spinner`, `ProgressRing`, `Meter` | 로딩, 잡 진행률, 사용량 |
| `cx`, `blockClassName` | 클래스 조합, Conductor 블록 클래스 참조 |

Conductor의 `Status` 타입(`queued` / `running` / `waiting` / `success` / `partial` / `danger` / `neutralEnd`)은 잡 상태와 파이프라인 단계 상태에 그대로 사용한다. 제품 고유 상태 어휘를 새로 만들지 않는다.

## 3. 컴포넌트 분류

- **Shell**: C-001 ~ C-003
- **Feedback**: C-004 ~ C-005
- **Search**: C-010 ~ C-017
- **Entity Surface**: C-018 ~ C-025
- **Sequence & Range**: C-026 ~ C-029
- **Analytics**: C-030, C-033 ~ C-036
- **Domain Lists**: C-031 ~ C-032, C-037 ~ C-039
- **Operations**: C-040 ~ C-047

## 4. 컴포넌트 명세

### C-001 AppTopBar

- 책임: 제품명, 옴니 검색, 시퀀스 공간 컨텍스트, 사용자 메뉴를 전역 상단에 제공
- 기반: Conductor `TopBar`
- 필수 props: `omniSearch: ReactNode`, `sequenceSpace?: SequenceSpaceRef`, `user: UserSummary`
- 상태: `default`, `loading`, `disabled_by_policy`
- 이벤트: `topbar.search_focus`, `topbar.space_change`, `topbar.user_menu_open`
- 접근성: `banner` landmark. 옴니 검색은 `⌘K`/`Ctrl+K`로 포커스하며 `Kbd`로 단축키를 시각 표시한다
- 사용 화면: 전 화면
- 사용자 메뉴 (CR-092, DEV-700): 트리거는 로그인 이름(아바타 두 글자와 이름)이며 접근 이름은 `사용자 메뉴: {login}`이다. Conductor `DropdownMenu`로 연다. 항목은 신원 표시(로그인·이메일, 선택 불가)와 「로그아웃」 하나다. **「로그아웃」은 `POST /auth/logout` 폼을 제출한다 — 링크(`GET`)로 만들지 않는다.** 메뉴 내용은 포털로 그려지므로 폼은 메뉴 밖에 두고 항목 선택이 그 폼을 제출한다. 인증을 끈 배포(`user = null`)에는 메뉴도 폼도 그리지 않는다. 이벤트 `topbar.user_menu_open`은 이 메뉴가 열릴 때다

### C-002 LeftNavPanel

- 책임: 주요 화면 이동. 역할에 따라 운영 그룹 노출을 제어
- 기반: Conductor `NavList`
- 필수 props: `items: NavItem[]`, `activeId: string`, `roles: Role[]`
- 상태: `default`, `collapsed`
- 이벤트: `nav.open`, `nav.select`
- 접근성: `navigation` landmark, 현재 항목에 `aria-current="page"`, 키보드 순회 지원
- 사용 규칙: 운영 항목은 **항목마다** 허용 역할을 본다 (CR-054, DEV-408). 그룹 단위로 열면 `operator`가 감사 화면을, `security_officer`가 저장소 등록을 보게 된다 — 권한 매트릭스가 둘 다 막는 자리다. **허용 역할에 없으면 렌더링하지 않는다. 비활성으로 보여 주지 않는다**(존재를 노출하지 않음). 새 항목이나 새 역할의 기본값은 **보이지 않음**이다

### C-003 InspectorPanel

- 책임: 선택 항목의 요약과 이동 액션
- 기반: Conductor `Panel`
- 상태: `empty_selection`, `loading`, `ready`, `error`
- 사용 화면: W-007

### C-004 EmptyState

- 책임: 빈 상태의 원인과 다음 액션 제공
- 기반: Conductor `EmptyState`
- 필수 props: `title`, `cause: 'no_query' | 'no_result' | 'not_indexed' | 'no_permission' | 'not_found'`, `actions: ReactNode`
- 사용 규칙: `cause`별로 문구와 액션이 다르다. 하나의 범용 "데이터가 없습니다"로 대체하지 않는다

### C-005 ErrorBanner

- 책임: 오류 원인, 영향, 복구 액션, 상관 ID 제공
- 기반: Conductor `Banner`
- 필수 props: `tone: 'warning' | 'danger' | 'info'`, `title`, `impact`, `action?`, `correlationId?`
- 사용 규칙: 복구 불가 오류는 `correlationId`를 반드시 표시한다
- **W-001의 시퀀스 인용 배너가 이것을 재사용한다** (CR-051). 새 컴포넌트를 만들지 않는다 — 전할 것이 "무엇이 사실이고, 그래서 무엇이 안 되며, 무엇을 누르면 되는가" 셋으로 같기 때문이다. `epoch_stale`은 `tone: 'warning'`이며 `impact`에 "히스토리가 재작성되어 같은 서수가 다른 커밋을 가리킬 수 있습니다"를, `action`에 「현재 에폭으로 다시 조회」 **하나만** 싣는다. **액션이 스스로 실행되지 않는다** — 이 컴포넌트는 자동 재시도·타이머를 갖지 않는다
- 시퀀스 공간·요청 에폭·현재 에폭 **세 값을 모두 문자로** 적는다. 색이나 아이콘만으로 낡음을 나타내지 않는다 (NFR-006)

### C-010 OmniSearchInput

- 책임: 식별자·질의 통합 입력. 클라이언트 사전 판정과 해석 트리거
- 기반: Conductor `TextField` + `DropdownMenu`(최근 검색)
- 필수 props: `value`, `onSubmit(value)`
- 선택 props: `recentQueries?: string[]` (기본 `[]`) — **저장 위치가 정해지지 않아 선택이다** (CR-019, DEV-079). 비면 최근 목록을 그리지 않는다. 서버에 보내면 사용자의 조사 이력이 서버 기록이 되는데 그것을 요구한 문서가 없다
- 상태: `idle`, `resolving`, `error_prefix_too_short`, `error_query_syntax`
- 이벤트: `search.submit`
- 접근성: `role="searchbox"`, 결과 후보는 `aria-live="polite"`로 건수를 알린다
- 구현 메모: 7자 미만 hex 입력은 서버 호출 없이 즉시 안내한다 (FR-SRCH-004 AC-2)
- 관련 FR: FR-SRCH-001, FR-SRCH-004

### C-011 QueryTokenBar

- 책임: 파싱된 구조화 질의 토큰을 칩으로 표시하고 개별 제거를 제공
- 기반: Conductor `Badge` + `IconButton`
- 필수 props: `tokens: QueryToken[]`, `onRemove(token)`, `errorRange?: { start: number; end: number }`
- 상태: `ready`, `error_query_syntax`
- 접근성: 각 칩은 제거 버튼에 `aria-label="<키>:<값> 필터 제거"`
- 관련 FR: FR-SRCH-005

### C-012 FacetRail

- 책임: 필드별 값 분포와 건수를 제공하고 필터 선택을 반영
- 기반: Conductor `Panel` + `Checkbox`
- 필수 props: `facets: Facet[]`, `selected: FilterSelection`, `onChange`, `omitted?: boolean`, `status?: FacetStatus`
- 상태: `loading`, `ready`, `not_computed`(아직 세지 않음), `omitted`(예산 초과로 생략), `failed`(계산 실패), `error`
- 사용 규칙: 세지 않았거나 생략했으면 **사유를 레일 상단에 표시한다. 조용히 비우지 않는다**
- **네 경우를 구분한다** (CR-019 DEV-076 / CR-043 DEV-277): 응답에 세 키가 모두 **없으면** `not_computed`, `facets_status: "ready"`면 `ready`, `"budget_omitted"`면 `omitted`, `"failed"`면 `failed`. **생략과 실패를 같은 문구로 그리지 않는다** — 예산 초과는 조건을 좁히면 풀리고 계산 실패는 그렇지 않다. 사용자가 할 수 있는 일이 다르다
- **패싯 실패가 목록을 가리지 않는다** (FR-SRCH-009 예외 처리). 레일만 실패 상태가 되고 결과 표는 그대로 선다
- **화면마다 축이 다르다** (SRS v2.7, CR-043): W-001은 저장소·작성자·팀·라벨·대상 브랜치·PR 상태 여섯, W-004는 작성자·팀·라벨·경로 넷이다. W-004에서 저장소·대상 브랜치를 그리지 않는 것은 시퀀스 공간이 이미 고정하기 때문이다
- **팀 표시값은 서버가 해석해 보낸다.** 레일이 팀 ID를 슬러그로 바꾸려 개별 조회를 걸지 않는다 (N+1 금지)
- 관련 FR: FR-SRCH-006, FR-SRCH-009, FR-SEQ-002

### C-013 ResultTable

- 책임: PR·커밋 결과 목록 표시, 정렬 제어, 행 이동
- 기반: Conductor `Table`
- 필수 props: `rows: ResultRow[]`, `sort: SortState`, `onSortChange`, `onRowOpen`
- 상태: `loading_initial`, `loading_more`, `ready`, `empty`
- 접근성: 정렬 가능한 헤더에 `aria-sort`, 행 이동은 링크 시맨틱으로 구현해 새 탭 열기를 지원
- 재사용: W-001, W-004, A-002, A-004
- 관련 FR: FR-SRCH-006, FR-SRCH-007

### C-014 SequenceBadge

- 책임: 머지 시퀀스 값과 시퀀스 공간을 함께 표시
- 기반: Conductor `Badge`
- 필수 props: `seq: number | null`, `space: SequenceSpaceRef | null`, `epoch: number | null`, `contextSpace?: SequenceSpaceRef | null`
- 선택 props: `mNumber: string | null`, `mNumberState: 'assigned' | 'pending' | 'epoch_stale' | 'not_applicable' | 'unavailable'`, `mNumberReason: string | null`, `mNumberEpoch: number | null` (CR-079). commit 행은 M 영역을 그리지 않고 PR의 pending/unavailable에는 M 링크를 만들지 않는다.
- `SequenceSpaceRef`는 투영이 주는 `owner/repo@branch` 문자열이다 (CR-019, DEV-077)
- 상태: `assigned`, `unassigned`(미머지), `not_computed`(**아직 계산하지 않음** — WP-021 전), `stale`, `reassigning`, `epoch_stale`
- **`unassigned`와 `not_computed`를 절대 같이 그리지 않는다** (CR-019, DEV-077): 전자는 "머지되지 않았다"는 **사실 주장**이고 후자는 "아직 모른다"이다. 미계산을 미머지로 그리면 화면이 거짓을 말한다
- **M 넘버는 `mNumberState`로 별도 판정한다** (CR-077, FR-SEQ-008 예외 처리): `pending`은 `merge_seq`가 아직 붙지 않았거나 앞선 항목의 PR 연결이 미확정이라 채번이 멈춘 경우이며, **잠정 번호를 지어내지 않는다.** `epoch_stale`은 `seq`의 `epoch_stale`과 같은 사건인 에폭 상승에서 함께 발생하며, 무효가 되는 값은 M 넘버 자신이다. **M 넘버는 선후관계 확인 전용이며 PR의 주 식별자를 대체하지 않는다**: 이 배지가 붙는 화면에서도 제목과 링크는 여전히 PR 번호를 기준으로 삼는다(FR-SEQ-008 AC-8)
- 사용 규칙: `contextSpace`와 `space`가 다르면 tone을 `neutral`로 낮추고 툴팁에 공간을 명시한다. 서로 다른 공간의 시퀀스가 비교 가능한 값으로 오인되면 안 된다
- 접근성: 툴팁 내용은 `aria-describedby`로 연결하고, 시각적 tone 차이에만 의존하지 않는다
- 관련 FR: FR-SEQ-001, FR-SEQ-005, FR-SEQ-008

### C-015 RelationBadgeGroup

- 책임: 개체가 보유한 관계 유형을 압축 배지로 표시(되돌림됨, 체리픽 있음 등)
- 기반: Conductor `Badge`
- 필수 props: `summary: LinkSummary | null`
- 사용 규칙: 배지에 관계 유형 라벨 텍스트를 항상 포함한다. 색상만으로 유형을 구분하지 않는다
- **"요약이 없다"와 "관계가 없다"를 같게 그리지 않는다** (CR-042, DEV-264). `summary`가 `null`이면 아직 요약값이 준비되지 않은 것이고, 값이 있는데 전부 `false`/`0`이면 **확인했고 현재 관계가 없다**이다. 전자를 "관계 없음"으로 그리면 없는 사실을 주장하게 된다 — C-014가 `unassigned`와 `not_computed`에 대해 세운 규율과 같다 (CR-019, DEV-077). 요약이 없으면 **배지 영역을 그리지 않는다**
- 표시 대상: `reference_count > 0`(참조) · `has_revert`(되돌림 있음) · `is_reverted`(되돌림됨) · `has_cherry_pick`(체리픽) · `has_stack`(스택). **`has_stack`은 PR 문서에만 있다** — 커밋에는 스택이라는 개념이 없다 (CR-041)
- **행마다 관계를 조회하지 않는다** (ADR-009). 목록 화면의 배지는 `API-SRCH-004`가 싣는 비정규화 `link_summary`로 그린다 — 그것이 그 필드가 존재하는 이유다
- 관련 FR: FR-REL-004, FR-REL-005

### C-016 CursorPager

- 책임: 커서 기반 다음 페이지 로딩
- 기반: Conductor `Button` + `Spinner`
- 필수 props: `nextCursor: string | null`, `onLoadMore`, `loading: boolean`
- 사용 규칙: 페이지 번호를 표시하지 않는다. 오프셋 페이징을 시사하는 UI를 두지 않는다
- **커서를 해석하지 않는다.** 서버가 준 문자열을 그대로 되돌려 보낸다 — 봉투는 서명돼 있고 화면이 그 안을 읽을 이유가 없다 (ADR-010 Amendment, CR-043)
- **이어 보기는 패싯을 다시 요청하지 않는다** (`facets=false`). 첫 페이지의 분포를 그대로 쓴다. `q`·필터·정렬이 바뀌면 커서와 패싯 상태를 **함께** 버리고 첫 페이지부터 다시 연다 (CR-043, DEV-280)
- **두 커서 오류를 같은 안내로 그리지 않는다** (CR-043, DEV-273): `CURSOR_QUERY_MISMATCH`는 "조건이 바뀌어 처음부터 다시 봅니다", `CURSOR_INVALID`는 "이 위치를 더 쓸 수 없어 처음부터 다시 봅니다"이다. 둘 다 현재 조건의 첫 페이지로 돌아가되 **자동 재시도 루프를 만들지 않는다**
- **W-004·W-008·W-009에서도 같은 컴포넌트를 쓴다.** 커서 문자열의 재료는 화면마다 다르지만(W-001은 검색 결과, W-004는 정본 서수, W-008과 W-009는 PostgreSQL 키셋) 이 컴포넌트에게는 전부 불투명 문자열이다. **패싯에 관한 위 규칙은 패싯이 있는 화면에만 해당한다** — W-008에는 패싯이 없다 (CR-049)
- **한 화면에 목록이 둘이면 페이저도 둘이다** (CR-049). W-008의 "내 검색"과 "팀 공유 검색"은 각자의 커서와 로딩 상태를 갖는다 — 한쪽의 더 보기가 다른 쪽을 건드리지 않는다
- 관련 FR: FR-SRCH-008, FR-SEQ-002, FR-SRCH-010, FR-ING-009

### C-017 ResolutionCandidateList

- 책임: 옴니 해석 후보 2건 이상일 때 후보 카드 목록 제공
- 기반: Conductor `CardGrid` + `Card`
- 필수 props: `candidates: ResolutionCandidate[]`, `onSelect`
- 사용 규칙: 후보가 1건이어도 자동 이동은 상위 화면이 결정한다. 이 컴포넌트는 표시만 담당한다
- 관련 FR: FR-SRCH-001

### C-018 CommitList

- 책임: 머지 커밋과 원본 커밋 목록을 구분 표시
- 기반: Conductor `Table` + `Badge`
- 필수 props: `mergeCommit: CommitSummary | null`, `sourceCommits: CommitSummary[]`, `truncated: boolean`, `totalCount: number | null`
- 상태: `ready`, `enrichment_pending`, `truncated`
- 사용 규칙: 머지 커밋을 항상 첫 행에 두고 배지로 구분한다. 원본 커밋은 기본 접힘
- **`totalCount: null`은 "250건 이상, 정확한 수를 모름"이다** (CR-020, DEV-083). 확정 총계와 **다른 문구로** 표시한다 — 절삭됐을 때 진짜 총계가 저장되어 있지 않다(CR-017 DEV-063). 가짜 숫자를 그리느니 모른다고 말한다
- 관련 FR: FR-SRCH-003

### C-019 NeighborSequenceList

- 책임: 시퀀스 기준 선행·후행 목록과 기준 개체 강조
- 기반: Conductor `Table`
- 필수 props: `neighbors: NeighborRow[]`, `anchorSeq: number`, `count: number`, `onCountChange`, `onExpand`
- 상태: `ready`, `collapsed`(**진입 기본** — 열 때 1회 조회, CR-031 DEV-162), `no_sequence`(비활성 + 사유), `not_sequenced`(같은 자리, 다른 문구), `boundary`(공간 경계)
- 사용 규칙: `no_sequence`·`not_sequenced`에서도 컴포넌트를 숨기지 않는다. 비활성 상태와 사유를 렌더링하며, **두 사유의 문구를 같게 쓰지 않는다** (C-014와 같은 구분, DEV-077)
- **직접 푸시 커밋 행을 빼지 않는다** (CR-031, DEV-161): 빼면 서수가 건너뛴 채 보여 누락으로 읽힌다. 그 행은 제목·작성자 자리를 비우고 축약 SHA로 표시하며, **소속 PR의 값으로 채우지 않는다** (DEV-090)
- **정렬은 서버 순서를 그대로 믿는다** — 서수 오름차순이며 클라이언트에서 재정렬하지 않는다 (C-020·`RangeResultTable`과 같은 규칙). `indexed: false` 행은 서수·SHA만 확정이고 나머지는 "색인 대기"다 (DEV-130)
- **조회는 대상 브랜치를 함께 보낸다** (CR-032, DEV-168): 서수는 `(저장소, 대상 브랜치)` 안에서만 의미가 있고 한 커밋이 여러 브랜치의 현재 체인에 함께 있을 수 있으므로, 공간을 서버가 고르게 두면 사용자가 묻지 않은 브랜치의 서수가 나온다. 컨테이너는 문서가 아는 `baseBranch`를 싣고, **모르면 조회하지 않는다** — 없는 브랜치를 `main`으로 지어내지 않고 사유를 밝힌다
- **"머지 시각" 칸은 `null`을 그린다** (CR-032, DEV-169): 색인에 없는 PR 행은 머지 시각을 알 수 없으므로 `—`로 비운다. **병합 커밋의 커밋 시각으로 채우지 않는다** — 그 자리에 확인되지 않은 값을 확정처럼 그리게 된다. 직접 푸시 커밋 행의 시각은 그 커밋의 시각이므로 그대로 그린다
- **실패 상태에는 복구 수단을 함께 낸다** (CR-032, DEV-170): `error`에서 "다시 시도"를 안내만 하고 수단을 두지 않으면 접기/펴기(`idle`일 때만 조회)와 건수 조절(결과가 있을 때만 렌더)이 모두 닫혀 있어 상세 화면을 다시 여는 것 말고는 길이 없다. 명시적 재시도 버튼을 둔다 — **화면이 따를 수 없는 지시를 하지 않는다**
- 관련 FR: FR-REL-001

### C-020 ReleaseContainmentList

- 책임: 개체를 포함하는 릴리스 목록과 미배포 상태 표시
- 기반: Conductor `Table` + `Badge`
- 필수 props: `state: ContainmentState` (판정은 `lib/containment.ts`가 끝낸 상태 유니언)
- 상태: `ready`, `unreleased`, `release_not_indexed`, **`not_sequenced`** (CR-028 — 대상에 서수가 없어 판정 기준 자체가 없는 상태. `unreleased`로 뭉치면 "판정했다"는 거짓이 된다)
- 사용 규칙: 목록은 서버가 보장한 시각 오름차순을 그대로 그린다(QA-W002-08) — 화면이 다시 정렬하면 규칙이 갈라졌을 때 그 사실이 숨는다
- 관련 FR: FR-REL-002

### C-021 LinkGroupList

- 책임: 관계 간선을 유형별로 묶어 방향·신뢰도·근거와 함께 표시
- 기반: Conductor `Panel` + `Table` + `Badge` + `CodeBlock` + `Button`(재시도). **`SeverityTag`를 쓰지 않는다** (CR-042): 그 컴포넌트의 `severity`는 `read`/`write`/`destructive`/`blocked`, 즉 **실행 위험도** 어휘(C-061~067, GitHub Operations Plane)이고 관계 신뢰도와 다른 축이다. 위험도 어휘로 `heuristic`을 그리면 "차단됨"처럼 읽힌다 — 축이 다른 것을 같은 배지로 말하지 않는다
- 필수 props: `groups: LinkGroup[]`, `onOpenTarget`, `onExpandGroup`, `onRetryGroup`
- **상태는 두 축이다** (CR-042, DEV-257). 하나의 enum에 섞으면 "없는 것 · 모르는 것 · 실패한 것 · 해제된 것"이 같은 빈 화면이 된다.
  - **섹션 축**: `collapsed` / `loading` / `ready` / `error`(조회 실패 — **"다시 시도" 버튼을 함께 낸다**, C-019의 규칙과 같다)
  - **항목 축** (플래그, 서로 배타적이지 않다):
    - `unresolved` — 대상이 아직 색인되지 않았다 (FR-REL-003 AC-3). 원 참조 표현을 보이고 링크는 비활성
    - `content_available: false` — **대상 저장소가 접근 범위 밖이다** (THR-034). 간선·식별자·근거는 보이고 제목·작성자·이동 링크가 없다. **사유를 문구로 구분하지 않는다** — "권한이 없습니다"는 존재를 밝힌다. "대상 상세를 표시할 수 없습니다"처럼 일반 상태로 쓴다
    - `detached` — 스택 의존이 **해제되었다** (FR-REL-006 AC-3, CR-041 DEV-238). `stacks_on`에만 있다. **숨기지 않고, active로도 그리지 않는다** — "해제됨" 배지를 붙인다. 색상만으로 구분하지 않는다
    - `ambiguous` — 같은 근거를 공유하는 `heuristic` 되돌림 후보가 둘 이상이다 (FR-REL-004 예외 처리, DEV-261). **첫 후보를 확정된 대상처럼 그리지 않는다** — 저장 계층이 후보를 좁히지 않은 이유가 그것이다
  - **참조 그룹 전용**: `reference_pending` — `links_pending: true`. 문구는 **"참조 분석 중"**이다 (CR-041, CR-042 DEV-258). 그 필드는 FR-REL-003 **참조 추출**의 완결 상태이며, 되돌림·체리픽·스택은 그 상태에서도 **그대로 표시한다**
- 사용 규칙: 신뢰도 `heuristic` 항목은 근거 문자열을 `CodeBlock`으로 항상 함께 표시한다. 근거 없이 링크만 제시하면 사용자가 확실한 사실로 오인한다. 미해결 참조는 링크를 비활성으로 둔다
- **방향을 텍스트로 말한다** (CR-042). 화살표만으로 주체와 대상을 구분하지 않는다 — 되돌림 `outgoing`은 "이 PR이 되돌림 → 대상", `incoming`은 "이 PR을 되돌림 ← 주체"이고 스택도 같다. `aria-label`에 같은 문장을 싣는다
- **`evidence`는 평문으로만 렌더링한다** (THR-020). `CodeBlock`에 텍스트로 넣고 HTML로 해석하지 않는다
- 관련 FR: FR-REL-003, FR-REL-004, FR-REL-005, FR-REL-006, FR-REL-007

### C-022 PrTimeline

- 책임: 생성 → 첫 리뷰 → 승인 → 머지 → 릴리스 포함 단계와 소요 시간 표시
- 기반: Conductor `Timeline`
- 필수 props: `steps: TimelineStep[]`
- `TimelineStep.status`는 넷이다 (CR-020, DEV-084): `done`(일어났고 시각을 안다) / `done_at_unknown`(**일어났으나 시각을 모른다** — 승인이 그렇다: `approved_by`는 있고 `approved_at`은 매핑에 없다) / `pending`(아직 일어나지 않았다) / `out_of_scope`(이 릴리스 범위 밖 — 릴리스 포함은 WP-024)
- 상태: `ready`, `partial`(일부 단계 데이터 없음)
- **시각을 지어내지 않는다.** `done_at_unknown`을 `pending`으로 그리면 "승인되지 않았다"는 거짓이 되고, `done`으로 그리면 없는 시각을 채워야 한다
- 관련 FR: FR-STAT-003, FR-STAT-004

### C-023 EntityHeader

- 책임: PR·커밋·릴리스 상세의 공통 헤더(제목, 식별자, 상태 배지, 시퀀스 배지, 외부 링크)
- 기반: Conductor `Panel` + `Badge` + `Button`
- 필수 props: `kind: 'pull_request' | 'commit' | 'release'`, `title`, `identifier`, `badges`
- 선택 props: `externalUrl?: string` — GHE 링크는 `GHE_BASE_URL`로 만든다(형식은 FR-SRCH-001 AC-3이 정한 `https://<host>/<owner>/<repo>/pull/<N>`). **미구성 배포에서는 버튼을 그리지 않는다** (CR-020, DEV-086). 죽은 링크는 없는 것보다 나쁘다
- 재사용: W-002, W-003, W-005
- 접근성: 외부 링크는 `rel="noreferrer"`와 새 창 안내 라벨을 포함한다

### C-024 ShaChip

- 책임: 커밋 SHA를 12자 축약으로 표시하고 전체 40자 복사를 제공
- 기반: Conductor `Badge` + `IconButton` + `Tooltip`
- 필수 props: `commitSha: string`, `abbreviate?: number`
- 사용 규칙: 복사 버튼은 항상 전체 40자를 복사한다. 화면 표시값을 복사하지 않는다
- 접근성: 복사 **성공과 실패를 같은 `aria-live="polite"` 영역에** 알린다. 성공만 알리면 "성공했거나, 아무 일도 없었거나"가 구분되지 않는다 (CR-021, DEV-096)
- 실패 처리: `navigator.clipboard`는 **보안 컨텍스트에서만 존재한다** — 없거나 권한이 거부되면 실패를 알리고 **전체 40자를 선택 가능한 텍스트로 노출**해 손으로 복사할 길을 남긴다. 조용한 실패는 사용자가 복사됐다고 믿고 붙여넣게 만드는데, 조사 도구에서 잘못된 SHA는 조사 결과 전체를 틀리게 만든다 (CR-021, DEV-096)

### C-025 ChangedPathList

- 책임: 변경 경로와 추가/삭제 라인 수 표시
- 기반: Conductor `Table`
- 필수 props: `paths: ChangedPath[]`, `totalCount: number | null`, `truncated: boolean`
- `totalCount: null`은 **"세지 않았다"**이다 — `0`("바꾼 파일이 없다")과 다른 문구로 표시한다. 커밋 문서의 `changed_files_count`는 WP-020까지 채워지지 않으므로 `0`을 넣으면 *파일을 하나도 바꾸지 않은 커밋*과 구분되지 않는다 (CR-021, DEV-094; C-018의 DEV-083과 같은 규칙)
- 사용 규칙: 파일 내용은 표시하지 않는다. 경로 문자열과 라인 수만 다룬다 (SRS 4.3)
- 관련 FR: FR-ING-004

### C-026 AnchorInput

- 책임: 앵커 입력과 시퀀스 정규화 결과 표시
- 기반: Conductor `Field` + `TextField` + `Badge`
- 필수 props: `value`, `onChange`, `resolved?: ResolvedAnchor`, `boundary: 'exclusive' | 'inclusive'`
- 상태: `idle`, `resolving`, `resolved`, `error_anchor_not_on_branch`, `error_anchor_not_merged`, `error_unresolvable`
- 사용 규칙: `boundary`를 항상 라벨로 표시한다("제외" / "포함"). 반개구간 규칙이 화면에 보이지 않으면 사용자가 경계 1건을 오해한다
- 관련 FR: FR-SEQ-003

### C-027 SequenceSpaceSelector

- 책임: 저장소와 대상 브랜치로 시퀀스 공간을 선택하고 현재 에폭을 표시
- 기반: Conductor `Select` + `Badge`
- 필수 props: `repositories`, `branches`, `value: SequenceSpaceRef`, `epoch: number`, `state: 'ok' | 'stale' | 'reassigning' | 'unknown'`
- 관련 FR: FR-SEQ-001, FR-SEQ-005

### C-028 RangeSummaryCard

- 책임: 구간 요약 통계 표시(PR 수, 커밋 수, 작성자 수, 변경 규모, 되돌림 보유 수)
- 기반: Conductor `CardGrid` + `Card`
- 필수 props: `summary: RangeSummary`
- 재사용: W-004, W-005
- 관련 FR: FR-SEQ-002, FR-SEQ-004

### C-029 BisectPanel

- 책임: 이분 탐색 상태 표시와 정상/이상/초기화 액션
- 기반: Conductor `Panel` + `Button`. 초기 후보 수를 저장하지 않으므로 분모를 추측하는 진행률 `Meter` 대신 실제 후보 수·예상 잔여 검사 횟수를 표시한다 (CR-071 / WP-042).
- 필수 props: `repository`, `baseBranch`, `range: { from, to, epoch } | null`. 개인 세션 조회·표시·초기화는 API-SEQ-005로 수행하며 `session.remaining`, `estimated_steps`, `next`가 표시값의 정본이다.
- 상태: `idle`, `loading`, `in_progress`, `converged`(후보 1건), `bisect_contradiction`, `epoch_stale`, 연결 오류
- 구간 조회가 완료되면 시작을 활성화한다. 재방문 시 저장된 세션은 구간을 다시 입력하지 않아도 복원한다. 공간 변경은 컴포넌트를 새로 마운트하고 이전 조회를 취소한다. 모순은 두 경계와 초기화 경로를 보이며 실패한 표시를 자동 재시도하지 않는다. 에폭 무효 또는 재채번 중에는 검사 지점을 제공하지 않고 초기화를 요구한다.
- 종료 결과는 PR 링크이며, 연결된 PR이 없는 직접 푸시는 실제 커밋 링크와 "연결된 PR 없음"을 표시한다.
- 접근성: 남은 후보 수 변화는 `aria-live="polite"`로 알린다
- 관련 FR: FR-SEQ-007

### C-030 AggregationPanel

- 책임: 현재 질의 위의 그룹 집계 결과 표시와 근거 목록 이동
- 기반: Conductor `Panel` + `Table` + `Badge`
- 필수 props: `groups: AggregationGroup[]`, `metric`, `onGroupSelect`, `approximate?: boolean`, `truncated?: boolean`
- 상태: `loading`, `ready`, `approximate`, `truncated`, `error_aggregation_timeout`
- 재사용: W-001 집계 탭, W-006
- 관련 FR: FR-STAT-001, FR-STAT-006

### C-031 SafeMarkerCard

- 책임: 안전 구간 표식 표시와 등록
- 기반: Conductor `Card` + `Button` + `TextArea`
- 필수 props: `marker: SafeMarker | null`, `canWrite: boolean`, `onSubmit`, **`targetSeq: number | null`**, **`currentEpoch: number`** (CR-057, DEV-462)
- 상태: `ready`, `marker_absent`, `marker_epoch_stale`, `marker_target_unresolved`, `marker_conflict`, `no_permission`, `submitting`, `submit_failed`
- 사용 규칙:
  - `canWrite`가 false면 Conductor `Button`의 `blockedReason`에 필요 역할명(`release_manager`)을 넣는다. **새 역할 이름을 만들지 않는다** — 보안 문서 5.1의 여섯 중 하나를 그대로 쓴다
  - **`targetSeq`는 조사 구간의 끝 앵커 서수다.** 이 카드는 등록할 서수를 스스로 고르지 않고 받는다 — 숫자 입력창을 두면 사용자가 조사하지 않은 구간을 표식할 수 있다 (와이어프레임 `W-004-MARKER`). `null`이면 `marker_target_unresolved`이며 등록 액션이 사유와 함께 비활성이다
  - **`marker.seq_epoch !== currentEpoch`이면 무효로 표시한다.** 카드를 감추지 않고, 현재 에폭의 같은 서수로 옮겨 읽지도 않는다 (ADR-007, FR-SEQ-006 AC-4). 무효 표식과 등록 액션은 함께 보인다 — 무효를 본 사용자의 다음 행동이 재등록이기 때문이다
  - `marker`가 `null`이면 카드를 **감추지 않고** "표식 없음"을 말한다. 감추면 이 공간에 그 기능이 없는 것으로 읽힌다
  - 메모는 500자 상한이며 남은 글자 수를 보인다 (FR-SEQ-006 AC-2). **서수를 옮기지 않고 메모만 고치는 것도 등록이다** — 그것은 변경이며 감사에 남는다 (CR-057, DEV-465). 메모 수정 경로를 따로 만들지 않는다
  - **`onSubmit`은 카드가 받은 `marker`의 서수를 `expected_marker_seq`로 함께 보낸다** (CR-057, DEV-464). 표식이 없었으면 `null`이다 — 카드가 이미 현재 표식을 알고 있으므로 새 조회가 필요 없다. 서버가 `SAFE_MARKER_CONFLICT`(409)로 거절하면 `marker_conflict`이며, 응답이 준 현재 표식을 보이고 **자동으로 다시 보내지 않는다**: 사용자가 그 값을 보고 다시 결정한다
- 접근성: 무효 상태를 색만으로 말하지 않는다 — 배지 문구와 `aria-describedby`로 등록 버튼에 사유를 연결한다. 비활성 버튼도 그 사유를 읽을 수 있어야 한다
- 관련 FR: FR-SEQ-006
- 사용 화면: W-004

### C-032 ReleaseTimeline

- 책임: **저장소 스코프** 릴리스 목록을 시각 내림차순으로 표시하고 비교 대상 2건 선택 제공. 행은 태그명·대상 브랜치·시각·서수·직전 대비 PR 수를 보인다
- 기반: Conductor `Timeline` + `Checkbox`
- 필수 props: `releases: ReleaseRow[]`, `selection: string[]` (태그명), `onSelectionChange`, `maxSelection: 2`, `selectedTag: string | null`, `onSelect`
- **비교 선택과 상세 선택은 다른 축이다**: `release.compare`는 체크박스 2건, `release.select`는 행 클릭이다 (와이어프레임 W-005 이벤트 정의). 체크박스가 상세 선택을 겸하면 2건을 고르는 순간 상세가 무엇인지 모호해진다
- 상태: `ready`, `release_not_indexed`, `error_space_mismatch`
- 사용 규칙: **서수 없는 릴리스도 렌더링한다** — 체인 밖 태그이거나 현재 에폭으로 아직 재해석되지 않은 릴리스(DEV-149)는 앵커가 될 수 없으므로 체크박스를 비활성하고 그 사유를 행에서 말한다. 숨기면 "그런 태그가 없다"로 오인된다. 선택 2건의 시퀀스 공간이 다르면 비교를 차단하고 사유를 표시한다 (FR-SEQ-004 AC-3). **정렬은 서버 순서를 그대로 믿고 클라이언트에서 재정렬하지 않는다** (C-020·`RangeResultTable`과 같은 규칙 — 부분 목록을 다시 정렬하면 거짓이 된다)
- 접근성: 체크박스 그룹에 이름을 준다. 선택 상한(2건)에 도달하면 미선택 행의 체크박스를 비활성하고 그 사유를 `aria-describedby`로 연결한다 — 눌러도 아무 일이 없는 컨트롤을 두지 않는다
- 관련 FR: FR-SEQ-004
- 사용 화면: W-005

### C-033 TimeSeriesChart

- 책임: 날짜 히스토그램 시계열 표시
- 필수 props: `series: Series[]`, `interval`, `timezone`, `onBucketSelect`
- 사용 규칙: 계열 최대 20개. 색은 계열 구분에만 사용하고 값 크기는 위치·길이로 표현한다. 색상 대비는 라이트·다크 두 테마 모두에서 검증한다. **계열 색 자체가 미결이다** — Conductor에 계열용 토큰이 없고 `status`·`severity`를 돌려 쓰는 것은 ADR-006이 금지한다 (`DEV-380`, WP-038 착수 전 결정)
- 접근성: 차트와 동일 데이터를 표 형태로 제공한다(`Table`, 시각적으로 접힘 가능)
- 관련 FR: FR-STAT-002

### C-034 DistributionChart

- 책임: 구간별 분포 표시(변경 파일 수, 라인 수)
- 필수 props: `buckets: Bucket[]`, `onBucketSelect`
- 사용 규칙: **`unknown` 구간은 0과 다르게 그린다** — 값이 없는 것과 0인 것은 다른 사실이며, `unknown`에는 근거 목록으로 갈 길이 없다 (CR-053, FR-STAT-005 AC-5)
- 접근성: C-033과 동일한 표 대체 제공 규칙
- 관련 FR: FR-STAT-005

### C-035 PercentileCardRow

- 책임: 백분위 값 카드 나열(p50/p75/p90/p95/p99)
- 기반: Conductor `CardGrid` + `Card` + `Badge`
- 필수 props: `percentiles: Record<string, number>`, `unit: 'seconds'`, `lowSample?: boolean`, `excludedCount?: number`
- 사용 규칙: `lowSample`이면 백분위 대신 원값 목록을 표시한다. 제외 건수를 항상 함께 표시한다
- 관련 FR: FR-STAT-003, FR-STAT-004

### C-036 RelationGraphCanvas

- 책임: 관계 노드·간선 시각화와 노드 확장
- 필수 props: `nodes`, `edges`, `depth`, `linkTypes`, `onNodeSelect`, `onNodeExpand`, `truncated: boolean`
- 상태: `loading`, `ready`, `truncated`, `empty_no_link`, `error_graph_timeout`
- 접근성: 캔버스와 동등한 노드·간선 표를 함께 제공하고 `Tab` 순회를 지원한다. 그래프만으로 정보를 제공하지 않는다 (NFR-007)
- 관련 FR: FR-REL-008

### C-037 SavedSearchList

- 책임: 저장된 검색 목록과 실행·편집·삭제
- 기반: Conductor `Table` + `DropdownMenu` + `Badge` + `Dialog`(삭제 확인)
- 필수 props: `items: SavedSearch[]`, `onRun`, `onEdit`, `onDelete`
- 상태: `ready`, `empty_no_saved`, `empty_no_shared`, `error_query_syntax`(항목별)
- **행이 보이는 액션은 소유 여부가 정한다** (CR-049): 내가 소유한 항목은 실행·편집·삭제, 공유받은 항목은 실행만. **액션을 그리지 않는 것이 통제가 아니다** — 서버가 같은 규칙을 다시 강제하며 이 컴포넌트는 그 사실을 화면에 옮길 뿐이다
- **질의 유효성은 항목마다 다르다** (CR-049). 무효인 항목은 실행을 비활성화하고 사유를 보이되, 저장자에게는 편집 경로를, 공유받은 사람에게는 "소유자가 질의를 수정해야 합니다"를 보인다
- **공개 범위와 유효성을 색만으로 구분하지 않는다.** `private`·`team`·무효는 각각 문자 레이블을 갖는다 (NFR-006)
- **삭제는 되돌릴 수 없으므로 확인 대화상자를 거친다** (CR-049)
- **시퀀스 인용 상태도 항목마다 다르다** (CR-051): `current`·`epoch_stale`·`unbound`·`unavailable` 넷이며 각각 문자 레이블을 갖는다. `epoch_stale`은 저장된 값과 현재 값을 함께 적고, `unbound`는 실행을 막으며, **`unavailable`은 아무 수치도 적지 않는다** — 저장된 값이든 현재 값이든 볼 수 없는 저장소의 에폭을 적는 순간 그것이 유출이다 (THR-043)
- **「현재 에폭으로 다시 연결」은 저장자에게만 그린다.** 공유받은 사람에게는 "저장자가 다시 연결해야 합니다"를 보인다. 그리지 않는 것이 통제가 아니라는 규칙은 여기서도 같다 — 서버가 다시 강제한다
- **이 컴포넌트는 판정하지 않는다.** 네 상태는 뷰 모델이 정해서 넘긴다. 여기서 저장된 에폭과 현재 에폭을 비교하면 같은 규칙이 두 곳에 살고 한쪽만 고쳐진다
- 관련 FR: FR-SRCH-010, FR-SEQ-005

### C-038 RepositoryCardGrid

- 책임: 저장소별 수집 상태 카드 표시
- 기반: Conductor `CardGrid` + `Card` + `StatusBadge` + `Meter`
- 필수 props: `repositories: RepositoryStatus[]`, `onRetry`, `onOpenOps?`
- 상태: `ready`, `empty_no_repository`, `operation_pending`(백필 중), `partial_failure`
- **세 값을 같은 문구로 그리지 않는다** (CR-050): `null`은 "아직 기록 없음", `0`은 확인된 영,
  `unavailable`은 "조회 실패 — 모름"이다. 마지막 수집 시각·문서 수·백필·누락 현황 넷 모두에 적용된다.
  `unavailable`을 0으로 그리면 사용자는 "수집이 안 됐다"는 **틀린 진단**을 받는다
- **`archived` 저장소를 숨기지 않는다** (FR-ING-009 AC-7). 등록 상태 배지로 구분해 보여 준다 —
  해제됐다는 사실 자체가 사용자가 찾던 답이다
- **판정을 컴포넌트 안에서 하지 않는다.** 접근 범위·등록 상태·진단 값의 해석은 뷰 모델이 이미 끝낸
  것을 받아 그린다. 여기서 다시 판정하면 같은 규칙이 두 곳에 살고 한쪽만 고쳐진다
- **실행 액션을 두지 않는다.** 등록·해제·백필·재채번 버튼은 이 카드에 없다 (A-002·A-003 소관)
- **항목 단위 재시도**: 진단 항목 하나가 실패하면 그 카드만 다시 조회한다 (`onRetry`).
  자동 폴링하지 않는다
- 관련 FR: FR-ING-006, FR-ING-009, FR-ING-011, FR-AUTH-002

### C-039 SequenceSpaceStatusList

- 책임: 시퀀스 공간별 마지막 시퀀스 값, 에폭, 상태 표시
- 기반: Conductor `Table` + `StatusBadge`
- 필수 props: `spaces: SequenceSpaceStatus[]`
- **네 상태 전부에 텍스트 레이블을 둔다** — `ok`·`stale`·`reassigning`·`unknown`을 색으로만
  구분하지 않는다 (QA-COMMON 접근성 규칙)
- **`unknown`은 "등록된 브랜치인데 아직 채번된 적 없음"이다** (CR-029, DEV-152와 같은 판단).
  목록에서 빼면 사용자가 "등록이 안 됐다"로 오인하고, `0`으로 그리면 "0번까지 채번됐다"는 거짓이 된다
- **`stale`·`reassigning`에서도 마지막 확정 서수와 에폭을 함께 표시한다.** 경고와 함께 값을 보여
  주지 않으면 사용자에게 남는 정보가 없다
- 관련 FR: FR-SEQ-001, FR-SEQ-005

### C-040 PipelineMetricGrid

- 책임: 파이프라인 단계별 지표 카드 표시
- 기반: Conductor `CardGrid` + `Card` + `StatusBadge` + `Meter`
- 필수 props: `metrics: PipelineMetrics`, `updatedAt`, `stale: boolean`
- 사용 규칙: 사용자가 표를 조작 중이면 자동 갱신을 보류한다
- 관련 FR: FR-ADMIN-001

### C-041 DeadLetterTable

- 책임: 실패 대기열 목록과 개별·일괄 재처리
- 기반: Conductor `Table` + `Checkbox` + `Button` + `Dialog`
- 필수 props: `items: DeadLetterItem[]`, `onReprocess(ids)`, `onOpenPayload`
- 사용 규칙: 일괄 재처리는 대상 건수를 확인 다이얼로그에 명시하고, 100건 초과 시 재확인을 한 번 더 요구한다
- 관련 FR: FR-ING-007

### C-042 ScanResultCard

- 책임: 조정 스캔 결과와 발견 누락 건수 표시, 즉시 실행
- 기반: Conductor `Card` + `Button`
- 관련 FR: FR-ING-011

### C-043 RepositoryRegistrationForm

- 책임: 저장소 등록·편집 폼
- 기반: Conductor `Field` + `TextField` + `Select` + `Switch` + `Checkbox`
- 필수 props: `value`, `onSubmit`, `maxBranches: 10`
- 선택 props: `prefill` — `C-071`의 요청 목록이 넘긴 `owner/name`. **이 값이 들어와도 요청 상태를 바꾸지 않는다**: 폼을 채울 뿐이고, 요청은 등록이 성공해야 종료된다 (FR-ING-009 AC-11)
- 상태: `idle`, `submitting`, `error_no_access`, `error_branch_limit`
- 사용 규칙: 해제 시 **"신규 이벤트 수집은 중단되고 기존 검색 문서는 유지됩니다"**를 확인 다이얼로그에 명시한다. **"삭제"라는 낱말을 쓰지 않는다** — 사용자가 데이터 손실로 오해하면 해제를 회피한다
- 사용 규칙: 브랜치를 더해 제출하면 그 브랜치의 채번 잡이 생기며(FR-ING-009 AC-12), **예상 소요 시간을 지어내지 않고 생성된 잡과 진행률을 보인다** (CR-055, DEV-435)
- 관련 FR: FR-ING-009

### C-044 JobTable

- 책임: 잡 목록, 상태, 진행률, 중단
- 기반: Conductor `Table` + `StatusBadge` + `Meter` + `Button`
- 필수 props: `jobs: Job[]`, `onAction(jobId, action)`
- 사용 규칙: 잡 상태는 Conductor `Status` 어휘를 그대로 사용한다
- 사용 규칙: **각 행이 보이는 제어 버튼은 서버가 준 `allowed_actions`를 그대로 그린다** (FR-ADMIN-002 AC-7). 상태 문자열로 가능한 동작을 추론하지 않는다 — 추론하면 전이 규칙이 서버와 화면 두 곳에 살고, 잡 유형마다 러너가 실제로 지원하는 범위가 다를 때 화면이 없는 능력을 제시한다. 목록이 비면 그 잡은 제어할 수 없다는 뜻이며 버튼을 그리지 않는다
- 관련 FR: FR-ADMIN-002

### C-045 JobRunForm

- 책임: 잡 유형별 실행 폼
- 기반: Conductor `Field` + `Select` + `TextField` + `Button` + `Dialog`
- 상태: `idle`, `submitting`, `error_job_conflict`
- 관련 FR: FR-ING-006, FR-ING-008, FR-ADMIN-002

### C-046 IndexStatusPanel

- 책임: 별칭-실제 인덱스 매핑, 문서 수, 크기, 재색인 이력, 이중 쓰기 상태
- 기반: Conductor `Panel` + `Table` + `Badge`
- 상태: `ready`, `reindex_dual_write`, `index_status_unavailable`
- 사용 규칙: **읽지 못한 값은 미확인으로 적고 `0`이나 `0B`로 대체하지 않는다** (FR-ING-008 AC-7). 크기를 모르는 것과 인덱스가 빈 것은 다른 사실이며, 후자로 적으면 운영자가 재색인이 실패했다고 읽는다. 값 하나를 읽지 못해도 나머지 행은 정상 표시한다
- 관련 FR: FR-ING-008

### C-047 IntegrityReportCard

- 책임: 시퀀스 정합성 점검 결과와 재채번 실행
- 기반: Conductor `Card` + `CodeBlock` + `Button` + `Dialog` + `TextField`
- 필수 props: `report: IntegrityReport`, `onReassign`
- 사용 규칙: 재채번 다이얼로그는 영향 범위(무효화 표식 수, 영향 저장 검색 수, 대상 커밋 수)를 표시하고 저장소 이름 직접 입력으로 2단계 확인을 요구한다
- 관련 FR: FR-ADMIN-003, FR-SEQ-005

> **번호가 순서 밖인 이유.** `C-048`~`C-070`은 `CR-005`·`CR-008`이 GitHub Operations 축에 이미 배정했다. 안정 ID는 문서 전체가 인용하는 값이므로 재번호화하지 않고, 이 축의 신규 컴포넌트를 마지막 번호 뒤에 이어 붙인다 (CR-055).

### C-071 RegistrationRequestQueue

- 책임: 운영자 평면의 등록 검토 요청 목록과 그 처리 (`A-002-REQUESTS`)
- 기반: Conductor `Table` + `StatusBadge` + `Button` + `Dialog` + `TextField`
- 필수 props: `requests: RegistrationRequest[]`, `onPrefill(request)`, `onDismiss(requestId, reason)`
- 상태: `loading_initial`, `ready`, `requests_empty`, `submitting`
- 사용 규칙: **`C-013 ResultTable`을 쓰지 않는다** — `C-013`은 정렬 컨트롤을 갖고 행 타입이 `ResultRow`에 묶여 있다. 재사용의 뜻은 같은 시각 규칙이지 같은 컴포넌트가 아니다 (`C-035 AuditRecordTable`·`C-029 RangeResultTable` 선례, DEV-419)
- 사용 규칙: **"등록" 버튼은 `C-043`의 폼을 채우기만 한다.** 이 컴포넌트가 요청을 `fulfilled`로 바꾸지 않는다 — 승인은 성공한 등록 그 자체다 (FR-ING-009 AC-11)
- 사용 규칙: 종료는 사유 입력과 확인을 거친다. **처리 메모는 `operator` 평면에만 있다** — 요청자에게 돌려주지 않는다 (FR-ING-009 AC-10)
- 사용 규칙: 현재 페이지의 행 수를 전체 요청 수처럼 표시하지 않는다. 서버가 전체 수를 보장하지 않으면 화면도 그것을 전체라고 말하지 않는다
- 관련 FR: FR-ING-009 AC-8·AC-11

## 5. 중복 방지 규칙

| 하려는 일 | 사용할 컴포넌트 | 새로 만들지 말 것 |
| --- | --- | --- |
| 결과 목록 표시 | C-013 ResultTable | 화면별 전용 테이블 |
| 구간 요약 표시 | C-028 RangeSummaryCard | W-004·W-005 각각의 요약 카드 |
| 시퀀스 값 표시 | C-014 SequenceBadge | 인라인 텍스트 렌더링 |
| 관계 표시 | C-021 LinkGroupList | 유형별 개별 컴포넌트 |
| SHA 표시 | C-024 ShaChip | 각 화면의 `substring(0,7)` |
| 빈 상태 | C-004 EmptyState | 화면별 자체 문구 블록 |
| 오류 표시 | C-005 ErrorBanner | 화면별 자체 배너 |
| 진행률 | Conductor `Meter` / `ProgressRing` | 자체 프로그레스 바 |
| 확인 다이얼로그 | Conductor `Dialog` | 자체 모달 |
| 운영자의 등록 요청 처리 | C-071 RegistrationRequestQueue | `C-013`을 이 목록에 재사용하는 것 (행 타입이 `ResultRow`에 묶여 있다) |

## 6. 접근성 공통 책임

1. 모든 인터랙티브 요소는 키보드로 도달·조작 가능하다. 커스텀 캔버스(C-036)는 동등한 표 대체를 제공한다.
2. 상태를 색상만으로 전달하지 않는다. 배지는 라벨 텍스트를 포함하고, 차트는 표 대체를 제공한다.
3. 비활성 액션은 Conductor `Button`의 `blockedReason`으로 사유를 제공한다. 이유 없이 비활성화하지 않는다.
4. 동적으로 갱신되는 건수·상태는 `aria-live="polite"`로 알린다. 단, 30초 주기 자동 갱신 지표(C-040)는 `aria-live`를 쓰지 않는다. 반복 알림이 스크린 리더 사용을 방해한다.
5. 색상 대비는 Conductor `checkContrast` CLI로 라이트·다크 두 테마 모두에서 검증한다.
6. 오버레이(Dialog/Drawer)는 포커스 트랩과 닫힘 시 트리거 복귀를 보장한다. Conductor 프리미티브가 이를 제공하므로 자체 구현하지 않는다.

## GitHub Operations 컴포넌트 (CR-005 신규)

기존 C-001~C-047은 번호를 유지한다. 신규는 C-048부터 이어 붙인다. 모두 Conductor 프리미티브로 구현하며 자체 UI 프리미티브나 리터럴 색상값을 만들지 않는다 (ADR-006).

| ID | 컴포넌트 | 책임 | 사용 화면 | 중복 방지 |
| --- | --- | --- | --- | --- |
| C-048 | `GhContextHeader` | 호스트·조직·저장소·브랜치·인증된 GitHub 신원 표시 | W-010~W-023 | 기존 `C-002 TopBar`와 구분 — 이쪽은 GitHub 대상 컨텍스트다 |
| C-049 | `CapabilityBrowser` | capability 검색·필터·목록. 미지원·차단 항목의 사유 배지 | W-010, A-006 | |
| C-050 | `GenericCommandForm` | capability에서 폼 전체 생성. 제약 검증 포함 | W-010, W-023 | 명령별 폼을 따로 만들지 않는다 |
| C-051 | `FlagControl` | flag 타입 → 컨트롤 디스패치 (boolean/enum/string/number/repeatable/선택자/file/secret/date) | C-050 내부 | |
| C-052 | `RepositoryPicker` / `BranchPicker` / `UserTeamPicker` | GitHub 자원 선택자 | C-051, 업무 화면 | 기존 검색 화면의 저장소 필터와 별개 — 이쪽은 작업 대상 선택 |
| C-053 | `SecretInput` | 비밀 값 입력. 재표시 없음, 미리보기에서 마스킹 | W-018, C-051 | |
| C-054 | `ArgvPreview` | 실행될 argv를 비밀이 가려진 형태로 표시 | W-010, 업무 화면 | 실제 실행 argv와 같은 모델에서 파생 |
| C-055 | `RiskBadge` | R0~R3 위험도 표시 | C-049, C-054, W-021 | Conductor `Tone` 매핑. `Severity`는 관계 신뢰도가 쓰므로 재사용하지 않는다 |
| C-056 | `PermissionPreview` | 필요 GitHub 권한과 사용자 보유 여부 | W-010, 업무 화면 | |
| C-057 | `ConfirmationDialog` | R2 확인 / R3 강한 확인 (대상 이름 입력) | 전 Operations 화면 | 기존 `C-030 2단계 확인`을 확장 사용 |
| C-058 | `ExecutionPanel` | 실행 상태·스트리밍 출력·JSON·아티팩트·취소 | W-010, 업무 화면, W-021 | |
| C-059 | `ExecutionHistoryTable` | 실행 이력 목록·필터·재실행 | W-021, A-007 | 기존 결과 테이블과 별개 |
| C-060 | `RecipeStepEditor` | Recipe 단계 편집. capability 선택과 출력 바인딩 | W-023 | |
| C-061 | `CapabilityConstraintForm` | 의미 제약 모델에서 파생된 입력 폼. `requires`/`conflicts`/`oneOf`/`exactlyOne`/`atLeastOne`/`implies`/반복/최소·최대/열거/조건부/입력원/컨텍스트 제약을 즉시 검증하고 위반 이유를 보여준다 | W-010, W-023 | CR-008. `GenericCommandForm`(C-050)이 이 폼을 감싼다. 검증 규칙은 UI 소유가 아니라 manifest 소유다 (ADR-017) |
| C-062 | `EffectiveExecutionContext` | 실행 직전 유효 컨텍스트 패널 — 호스트, GitHub 신원, 조직, 저장소, 브랜치/ref, workspace, gh 버전, manifest 버전, 위험도, 필요한 권한, 실제 권한 판정, 정책 판정 | W-010, W-020, W-023 | CR-008. 비밀 값은 표시하지 않는다. 미리보기와 실제 실행 대상이 갈리지 않음을 사용자가 눈으로 확인하는 자리 |
| C-063 | `SafeGhOutputViewer` | 무해화 경계를 통과한 실행 출력 표시. ANSI CSI·OSC·제어 문자가 제거된 텍스트, 절단 표시, 바이너리 표시 | W-010, W-021, 업무 화면 | CR-008. gh 출력에 `dangerouslySetInnerHTML`을 쓰지 않는다 (ADR-018). `ExecutionPanel`(C-058)이 출력 영역에 이 뷰어를 쓴다 |
| C-064 | `GhArtifactPanel` | 실행이 만든 아티팩트 목록·내려받기. 아티팩트 ID 기반 | W-010, W-021 | CR-008. 실행기 파일시스템 경로를 노출하지 않는다 |
| C-065 | `WebEquivalentNotice` | 터미널 기능이 웹 등가로 대체되었음을 알리는 안내 — 무엇이 어떻게 바뀌었는지와 사유 | W-010, W-022 | CR-008. `--web`·`gh browse`는 URL 링크로, editor는 웹 편집기로 대체됨을 알린다 (ADR-019) |
| C-066 | `ExtensionTrustBadge` | extension의 신뢰 상태 — 승인 여부, 버전 pin, 출처 저장소, provenance, 차단 사유 | W-022, A-005 | CR-008. 차단된 extension도 숨기지 않고 사유와 함께 보여준다 |
| C-067 | `ParityCoverageMatrix` | 차원별 커버리지 매트릭스 — command path, alias, positional, command 고유 flag, inherited flag, short alias, 반복 가능 flag, interaction 모드, 입출력 모드, `--json` 필드. core/extension 분리, 드리프트 diff | A-006 | CR-008. `CapabilityBrowser`(C-049)가 개별 capability를 보여준다면 이쪽은 차원별 집계를 보여준다 |
| C-068 | `CapabilityGraph` | Recipe를 비순환 typed DAG로 편집. 단계 노드, 입출력 port, 간선, 호환 가능한 다음 단계 제안, 순환·비호환 연결 거부 사유 | W-023 | CR-009. `RecipeStepEditor`(C-060)가 단계 하나를 편집한다면 이쪽은 단계 사이의 연결을 편집한다 (ADR-020) |
| C-069 | `TypedBindingEditor` | 출발 단계·출력 port → 도착 입력·positional·flag·컨텍스트 연결 편집. 선언된 named field 또는 제한된 JSON Pointer만 선택 | W-023 | CR-009. **자유 표현식 입력창을 두지 않는다** — 표현식 해석기가 없다는 것이 이 컴포넌트의 요점이다 |
| C-070 | `ResultContractBadge` | capability의 결과 계약 표시 — `kind`, sensitivity, bindable 여부, result adapter, composability 상태. `secret` 결과는 바인딩 불가 사유를 함께 | W-010, W-021, W-023, A-006 | CR-009. `RiskBadge`(C-055)가 실행 위험을 말한다면 이쪽은 결과를 어디까지 이을 수 있는지를 말한다 |

**`GenericCommandForm`이 하나여야 하는 이유.** 명령이 196개다. 폼을 명령마다 만들면 gh가 올라갈 때마다 화면을 추가해야 하고, 빠뜨린 것을 아무도 모른다. 폼이 하나면 manifest에 command가 추가되는 순간 UI가 따라온다 (ADR-015).


## C-001·C-002·C-010·C-012·C-013 작업대 조합 (CR-067 / WP-073)

- C-001: 현재 화면 맥락, 빠른 검색 링크, 로그인 사용자. 표시한 단축키를 실제 C-010에 연결하고 SSR/첫 클라이언트 렌더의 플랫폼 표기를 일치시킨다.
- C-002: Conductor NavList·기존 역할 필터를 유지하고 작은 inline SVG와 제품 진입점을 조합한다.
- C-010: 검색 입력/제출을 한 줄로 배치한다. 예시는 편집 가능한 초안이며 자동 요청하지 않는다.
- C-012: 여섯 패싯·건수·checkbox 이름·생략/실패 구분을 유지한다. 좁은 화면에서는 위쪽으로 이동한다.
- C-013: `ResultWorkbench`가 현재 목록의 선택만 소유한다. Conductor Table과 실제 제목 링크, 미리보기 선택 버튼의 roving tabindex를 사용한다. 요약에 API를 추가하지 않는다. 각 행에서 저장소/브랜치를 식별할 수 있고 시퀀스 공간/에폭을 상세에서도 읽을 수 있어야 한다.
- 상세 섹션 내비게이션은 기존 W-002/W-003 heading의 앵커다. 자동 확장·자동 폴링은 없다.
