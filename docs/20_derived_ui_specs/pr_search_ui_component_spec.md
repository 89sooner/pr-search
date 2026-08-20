# PR Search UI 컴포넌트 명세서

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

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

### C-002 LeftNavPanel

- 책임: 주요 화면 이동. 역할에 따라 운영 그룹 노출을 제어
- 기반: Conductor `NavList`
- 필수 props: `items: NavItem[]`, `activeId: string`, `roles: Role[]`
- 상태: `default`, `collapsed`
- 이벤트: `nav.open`, `nav.select`
- 접근성: `navigation` landmark, 현재 항목에 `aria-current="page"`, 키보드 순회 지원
- 사용 규칙: `operator`·`security_officer`가 아니면 운영 그룹 항목을 렌더링하지 않는다. 비활성으로 보여 주지 않는다(존재를 노출하지 않음)

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

### C-010 OmniSearchInput

- 책임: 식별자·질의 통합 입력. 클라이언트 사전 판정과 해석 트리거
- 기반: Conductor `TextField` + `DropdownMenu`(최근 검색)
- 필수 props: `value`, `onSubmit(value)`, `recentQueries: string[]`
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
- 필수 props: `facets: Facet[]`, `selected: FilterSelection`, `onChange`, `omitted?: boolean`
- 상태: `loading`, `ready`, `omitted`(패싯 생략), `error`
- 사용 규칙: 패싯 생략 시 사유를 레일 상단에 표시한다. 조용히 비우지 않는다
- 관련 FR: FR-SRCH-006, FR-SRCH-009

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
- 필수 props: `seq: number | null`, `space: SequenceSpaceRef`, `epoch: number`, `contextSpace?: SequenceSpaceRef`
- 상태: `assigned`, `unassigned`(미머지), `stale`, `reassigning`, `epoch_stale`
- 사용 규칙: `contextSpace`와 `space`가 다르면 tone을 `neutral`로 낮추고 툴팁에 공간을 명시한다. 서로 다른 공간의 시퀀스가 비교 가능한 값으로 오인되면 안 된다
- 접근성: 툴팁 내용은 `aria-describedby`로 연결하고, 시각적 tone 차이에만 의존하지 않는다
- 관련 FR: FR-SEQ-001, FR-SEQ-005

### C-015 RelationBadgeGroup

- 책임: 개체가 보유한 관계 유형을 압축 배지로 표시(되돌림됨, 체리픽 있음 등)
- 기반: Conductor `Badge`
- 필수 props: `summary: LinkSummary`
- 사용 규칙: 배지에 관계 유형 라벨 텍스트를 항상 포함한다. 색상만으로 유형을 구분하지 않는다
- 관련 FR: FR-REL-004, FR-REL-005

### C-016 CursorPager

- 책임: 커서 기반 다음 페이지 로딩
- 기반: Conductor `Button` + `Spinner`
- 필수 props: `nextCursor: string | null`, `onLoadMore`, `loading: boolean`
- 사용 규칙: 페이지 번호를 표시하지 않는다. 오프셋 페이징을 시사하는 UI를 두지 않는다
- 관련 FR: FR-SRCH-008

### C-017 ResolutionCandidateList

- 책임: 옴니 해석 후보 2건 이상일 때 후보 카드 목록 제공
- 기반: Conductor `CardGrid` + `Card`
- 필수 props: `candidates: ResolutionCandidate[]`, `onSelect`
- 사용 규칙: 후보가 1건이어도 자동 이동은 상위 화면이 결정한다. 이 컴포넌트는 표시만 담당한다
- 관련 FR: FR-SRCH-001

### C-018 CommitList

- 책임: 머지 커밋과 원본 커밋 목록을 구분 표시
- 기반: Conductor `Table` + `Badge`
- 필수 props: `mergeCommit: CommitSummary | null`, `sourceCommits: CommitSummary[]`, `truncated: boolean`, `totalCount: number`
- 상태: `ready`, `enrichment_pending`, `truncated`
- 사용 규칙: 머지 커밋을 항상 첫 행에 두고 배지로 구분한다. 원본 커밋은 기본 접힘
- 관련 FR: FR-SRCH-003

### C-019 NeighborSequenceList

- 책임: 시퀀스 기준 선행·후행 목록과 기준 개체 강조
- 기반: Conductor `Table`
- 필수 props: `neighbors: NeighborRow[]`, `anchorSeq: number`, `count: number`, `onCountChange`
- 상태: `ready`, `no_sequence`(비활성 + 사유 표시), `boundary`(공간 경계)
- 사용 규칙: `no_sequence`에서도 컴포넌트를 숨기지 않는다. 비활성 상태와 사유를 렌더링한다
- 관련 FR: FR-REL-001

### C-020 ReleaseContainmentList

- 책임: 개체를 포함하는 릴리스 목록과 미배포 상태 표시
- 기반: Conductor `Table` + `Badge`
- 필수 props: `releases: ReleaseSummary[]`, `unreleased: boolean`, `pendingPrCount?: number`
- 상태: `ready`, `unreleased`, `release_not_indexed`
- 관련 FR: FR-REL-002

### C-021 LinkGroupList

- 책임: 관계 간선을 유형별로 묶어 방향·신뢰도·근거와 함께 표시
- 기반: Conductor `Panel` + `Table` + `SeverityTag` + `CodeBlock`
- 필수 props: `groups: LinkGroup[]`, `onOpenTarget`, `onExpandGroup`
- 상태: `collapsed`, `loading`, `ready`, `links_pending`, `unresolved`(대상 미색인)
- 사용 규칙: 신뢰도 `heuristic` 항목은 근거 문자열을 `CodeBlock`으로 항상 함께 표시한다. 근거 없이 링크만 제시하면 사용자가 확실한 사실로 오인한다. 미해결 참조는 링크를 비활성으로 둔다
- 관련 FR: FR-REL-003, FR-REL-004, FR-REL-005, FR-REL-006, FR-REL-007

### C-022 PrTimeline

- 책임: 생성 → 첫 리뷰 → 승인 → 머지 → 릴리스 포함 단계와 소요 시간 표시
- 기반: Conductor `Timeline`
- 필수 props: `steps: TimelineStep[]`
- 상태: `ready`, `partial`(일부 단계 데이터 없음)
- 관련 FR: FR-STAT-003, FR-STAT-004

### C-023 EntityHeader

- 책임: PR·커밋·릴리스 상세의 공통 헤더(제목, 식별자, 상태 배지, 시퀀스 배지, 외부 링크)
- 기반: Conductor `Panel` + `Badge` + `Button`
- 필수 props: `kind: 'pull_request' | 'commit' | 'release'`, `title`, `identifier`, `badges`, `externalUrl`
- 재사용: W-002, W-003, W-005
- 접근성: 외부 링크는 `rel="noreferrer"`와 새 창 안내 라벨을 포함한다

### C-024 ShaChip

- 책임: 커밋 SHA를 12자 축약으로 표시하고 전체 40자 복사를 제공
- 기반: Conductor `Badge` + `IconButton` + `Tooltip`
- 필수 props: `commitSha: string`, `abbreviate?: number`
- 사용 규칙: 복사 버튼은 항상 전체 40자를 복사한다. 화면 표시값을 복사하지 않는다
- 접근성: 복사 성공은 `aria-live="polite"`로 알린다

### C-025 ChangedPathList

- 책임: 변경 경로와 추가/삭제 라인 수 표시
- 기반: Conductor `Table`
- 필수 props: `paths: ChangedPath[]`, `totalCount: number`, `truncated: boolean`
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
- 기반: Conductor `Panel` + `Button` + `Meter`
- 필수 props: `remaining: number`, `estimatedSteps: number`, `nextSeq: number | null`, `onGood`, `onBad`, `onReset`
- 상태: `idle`, `in_progress`, `converged`(후보 1건), `bisect_contradiction`
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
- 필수 props: `marker: SafeMarker | null`, `canWrite: boolean`, `onSubmit`
- 사용 규칙: `canWrite`가 false면 Conductor `Button`의 `blockedReason`에 필요 역할명을 넣는다
- 관련 FR: FR-SEQ-006

### C-032 ReleaseTimeline

- 책임: 릴리스 목록을 시간 순으로 표시하고 비교 대상 2건 선택 제공
- 기반: Conductor `Timeline` + `Checkbox`
- 필수 props: `releases: ReleaseRow[]`, `selection: string[]`, `onSelectionChange`, `maxSelection: 2`
- 상태: `ready`, `empty_no_release`, `error_space_mismatch`
- 관련 FR: FR-SEQ-004

### C-033 TimeSeriesChart

- 책임: 날짜 히스토그램 시계열 표시
- 필수 props: `series: Series[]`, `interval`, `timezone`, `onBucketSelect`
- 사용 규칙: 계열 최대 20개. 색은 계열 구분에만 사용하고 값 크기는 위치·길이로 표현한다. 색상 대비는 라이트·다크 두 테마 모두에서 검증한다
- 접근성: 차트와 동일 데이터를 표 형태로 제공한다(`Table`, 시각적으로 접힘 가능)
- 관련 FR: FR-STAT-002

### C-034 DistributionChart

- 책임: 구간별 분포 표시(변경 파일 수, 라인 수)
- 필수 props: `buckets: Bucket[]`, `onBucketSelect`
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
- 기반: Conductor `Table` + `DropdownMenu` + `Badge`
- 필수 props: `items: SavedSearch[]`, `onRun`, `onEdit`, `onDelete`
- 상태: `ready`, `empty_no_saved`, `error_query_syntax`(항목별)
- 관련 FR: FR-SRCH-010

### C-038 RepositoryCardGrid

- 책임: 저장소별 수집 상태 카드 표시
- 기반: Conductor `CardGrid` + `Card` + `StatusBadge` + `Meter`
- 필수 props: `repositories: RepositoryStatus[]`, `onOpenOps?`
- 상태: `ready`, `empty_no_repository`, `operation_pending`(백필 중), `partial_failure`
- 관련 FR: FR-ING-006, FR-ING-009

### C-039 SequenceSpaceStatusList

- 책임: 시퀀스 공간별 마지막 시퀀스 값, 에폭, 상태 표시
- 기반: Conductor `Table` + `StatusBadge`
- 필수 props: `spaces: SequenceSpaceStatus[]`
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
- 상태: `idle`, `submitting`, `error_no_access`, `error_branch_limit`
- 사용 규칙: 해제 시 "문서는 유지됩니다"를 확인 다이얼로그에 명시한다
- 관련 FR: FR-ING-009

### C-044 JobTable

- 책임: 잡 목록, 상태, 진행률, 중단
- 기반: Conductor `Table` + `StatusBadge` + `Meter` + `Button`
- 필수 props: `jobs: Job[]`, `onCancel`
- 사용 규칙: 잡 상태는 Conductor `Status` 어휘를 그대로 사용한다
- 관련 FR: FR-ADMIN-002

### C-045 JobRunForm

- 책임: 잡 유형별 실행 폼
- 기반: Conductor `Field` + `Select` + `TextField` + `Button` + `Dialog`
- 상태: `idle`, `submitting`, `error_job_conflict`
- 관련 FR: FR-ING-006, FR-ING-008, FR-ADMIN-002

### C-046 IndexStatusPanel

- 책임: 별칭-실제 인덱스 매핑, 문서 수, 크기, 재색인 이력, 이중 쓰기 상태
- 기반: Conductor `Panel` + `Table` + `Badge`
- 상태: `ready`, `reindex_dual_write`
- 관련 FR: FR-ING-008

### C-047 IntegrityReportCard

- 책임: 시퀀스 정합성 점검 결과와 재채번 실행
- 기반: Conductor `Card` + `CodeBlock` + `Button` + `Dialog` + `TextField`
- 필수 props: `report: IntegrityReport`, `onReassign`
- 사용 규칙: 재채번 다이얼로그는 영향 범위(무효화 표식 수, 영향 저장 검색 수, 대상 커밋 수)를 표시하고 저장소 이름 직접 입력으로 2단계 확인을 요구한다
- 관련 FR: FR-ADMIN-003, FR-SEQ-005

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

**`GenericCommandForm`이 하나여야 하는 이유.** 명령이 196개다. 폼을 명령마다 만들면 gh가 올라갈 때마다 화면을 추가해야 하고, 빠뜨린 것을 아무도 모른다. 폼이 하나면 manifest에 command가 추가되는 순간 UI가 따라온다 (ADR-015).
