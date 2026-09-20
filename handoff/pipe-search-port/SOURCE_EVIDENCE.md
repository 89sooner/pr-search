# SOURCE_EVIDENCE — 원본 근거표

> 분류: 인수인계 자료(pr-search 저장소의 governed 문서가 아니다) · 기준 SHA `da0ed9b5bd8fac59c7fcf02c593f69962468be4d`

이 문서는 PIPE 담당 세션이 pr-search 저장소를 열지 않고도 각 기능의 근거를 확인할 수 있도록, 실제 파일과 줄 번호를 기능 ID에 붙여 둔 표다. 모든 줄 번호는 위 기준 커밋에서 측정했다.

## 1. 기준선

| 항목 | 값 |
|---|---|
| 저장소 | `89sooner/pr-search` |
| 분석 기준 커밋 | `da0ed9b5bd8fac59c7fcf02c593f69962468be4d` |
| 커밋 시각 | 2026-09-21 00:56:40 +0900 |
| 커밋 제목 | `docs: record pilot.16 release in the ledger (#217)` |
| 브랜치 | `main` |
| 작업 트리 | 깨끗함. 추적되지 않는 `docs/40_delivery/pipe-search-handoff/`(이번 작업의 입력 지시서)만 존재하며 분석 근거에 포함하지 않았다 |

1차 지시서가 적어 둔 사전 조회 SHA `03b80d21bfa10603d709ba14da3cdf058ab69279`는 기준선이 아니다. 그 커밋 이후에 문서 전용 커밋 두 개(`5f0d7e0`, `da0ed9b`)가 더 올라왔으므로, 이 묶음은 최신 `main`인 `da0ed9b`를 기준으로 삼았다. 두 커밋이 `docs/`만 바꾸었다는 것은 실측했다: `git diff --stat 03b80d2 da0ed9b -- apps packages`의 출력이 비어 있다. 따라서 `apps/`와 `packages/`의 줄 번호는 `03b80d2`와 같다.

## 2. 현재 기본 `/search` 화면의 판정

`apps/web/app/search/page.tsx`는 세 화면 중 하나를 고른다. 분기 조건은 다음과 같다(`page.tsx:38`, `page.tsx:45`).

```text
GuardedPage reader={process.env.PRS_LEGACY_SEARCH !== '1'} legacyReader={legacy}
  legacy = (searchParams.legacy === '1' || searchParams.legacy === 'workspace')

  조건 A: process.env.PRS_LEGACY_SEARCH === '1'
       또는 (roles.includes('operator') && searchParams.legacy === '1')
    → <SearchView>  (구형 전문 검색 화면 + prs-page-heading 헤더)

  조건 B: legacy && roles.includes('operator')
    → <LegacyRepositoryWorkspace>

  그 외(운영 기본값)
    → <RepositoryWorkspace>          ← 이번 포팅의 대상
```

**포팅 대상은 `RepositoryWorkspace`다.** `SearchView`와 `LegacyRepositoryWorkspace`는 존재하지만 환경 변수나 operator 역할이 있어야 열리므로 이번 범위가 아니다. 이 구분이 중요한 이유는 4장에 적었다.

주요 파일과 크기는 다음과 같다.

| 경로 | 줄 수 | 역할 |
|---|---:|---|
| `apps/web/app/search/page.tsx` | 50 | 라우트 진입과 세 화면 분기 |
| `apps/web/components/RepositoryWorkspace.tsx` | 407 | 작업 공간 전체(사이드바·탭·필터·표·행 상세) |
| `apps/web/lib/repository-search.ts` | 70 | 질의 생성, 정렬 기본값, SHA 범위 판정 |
| `apps/web/lib/search-fetch.ts` | 115 | 조회 경로 선택과 URL 생성 |
| `apps/web/lib/merge-number.ts` | 483 | M 번호 표시 판정과 진입 링크 |
| `apps/web/components/MergeNumberBadge.tsx` | 129 | M 배지 렌더링 |
| `apps/web/components/source/SourceTree.tsx` | 46 | 파일 트리 |
| `apps/web/components/source/SourceHistory.tsx` | 37 | 경로 이력 |
| `apps/web/components/source/SourceDialogs.tsx` | 137 | Diff 모달과 Time-lapse 모달 |
| `apps/web/components/source/api.ts` | 29 | source 계열 조회 훅 |
| `apps/web/lib/source-analysis.ts` | 47 | 줄 diff, 단어 diff, 줄 추적 |
| `apps/web/components/reader/primitives.tsx` | 63 | Button·Table·Skeleton·FieldSelect·DatePicker |
| `apps/web/lib/format.ts` | 113 | 시각·SHA·시퀀스 표기 |
| `apps/web/lib/service-message.ts` | 5 | 서버 진단 문구 표시 규칙 |

`RepositoryWorkspace.tsx`는 407줄이지만 한 줄이 매우 길다(파일 크기 38.9KB). 줄 번호로 인용할 때 한 줄에 여러 기능이 들어 있는 경우가 있으므로, 아래 표는 줄 번호와 함께 그 줄이 하는 일을 문장으로 적었다.

## 3. 기능 추적표

각 행의 판정 열은 `유지`(원본 동작을 그대로 옮긴다), `재작성`(같은 동작을 PIPE 컴포넌트로 다시 만든다), `호스트제공`(PIPE 셸이 이미 주는 것을 쓴다), `제외`(이번 범위가 아니다) 중 하나다.

### 3.1 저장소와 파일 문맥

| ID | 화면·제어 | 사용자 동작 | 근거 위치 | 동작과 상태 | PIPE 대상 | 판정 |
|---|---|---|---|---|---|---|
| PS-F-001 | Find Repository 콤보박스 | 저장소를 고른다 | `RepositoryWorkspace.tsx:316-330` | `navigate({ repository, base: '', path: '', mnum_from: '', mnum_to: '' })`를 부른다. base·path·M 범위를 함께 비운다 | MUI `Autocomplete` 또는 `Select` | 재작성 |
| PS-F-002 | `Load more repositories…` 항목 | 목록 마지막 항목을 고른다 | `RepositoryWorkspace.tsx:321`, `:328` | 값이 `__more__`이면 `setRepoNext(repositoryCursor)`만 하고 저장소를 바꾸지 않는다. 다음 페이지를 이어 붙인다 | Autocomplete 하단 `Load more` 행 | 재작성 |
| PS-F-003 | 저장소 목록 조회 | 화면 진입, 재시도 | `RepositoryWorkspace.tsx:117-139` | `GET /api/repositories?limit=100[&cursor=…]`. 권한 필터 때문에 빈 페이지가 나올 수 있으므로 **최대 20페이지까지** 항목이 나올 때까지 이어서 읽는다. `repository_id`로 중복을 지운다. 401이면 `unauthorized` | React Query `useInfiniteQuery` | 재작성 |
| PS-F-004 | 저장소 오류 배너 | 실패 후 `Try again` | `RepositoryWorkspace.tsx:331` | `role="alert"` 문단과 ghost 버튼. `setRepoNonce`로 다시 읽는다 | MUI `Alert` | 재작성 |
| PS-F-005 | Base branch 콤보박스 | 브랜치를 고른다 | `RepositoryWorkspace.tsx:332` | 선택지는 `selected.sequence_spaces[].base_branch`와 `All branches`(빈 값). 고르면 draft와 URL 양쪽에서 `mnum_from`/`mnum_to`를 함께 지운다 | MUI `Select` | 재작성 |
| PS-F-006 | Files & folders 루트 | 저장소·브랜치가 정해지면 자동 | `SourceTree.tsx:27`, `:36-45` | `GET /api/source/{repo}/tree?ref={branch}`. 머리글에 `ref`(앞 35자)와 `revision`(앞 7자)을 보인다 | MUI `List` 기반 트리 또는 기존 antd `Tree` wrapper | 재작성 |
| PS-F-007 | `Filter root entries` 입력 | 문자열을 넣는다 | `SourceTree.tsx:39`, `:43` | **루트 항목의 `name`만** 소문자 부분 문자열로 거른다. 재귀 파일 검색이 아니고 코드 본문 검색도 아니다. 저장소·브랜치가 바뀌면 비운다(`:29`) | MUI `TextField` | 유지 |
| PS-F-008 | 폴더 펼침 | 폴더 행을 누르거나 `→` | `SourceTree.tsx:10-23` | 펼칠 때 `GET /api/source/{repo}/tree?revision={revision}&tree_sha={entry.sha}&path={entry.path}`. 선택 경로가 `entry.path + '/'`로 시작하면 자동으로 펼친다(`:11`) | lazy 로딩 트리 | 재작성 |
| PS-F-009 | 트리 키보드 | `↑ ↓ Home End`(목록), `→ ← Enter Space`(항목) | `SourceTree.tsx:16`, `:30-35` | `role="tree"`가 상하 이동을 소유하고 `role="treeitem"`이 펼침·선택을 소유한다. `Enter`/`Space`는 선택과 펼침을 함께 한다 | WAI-ARIA Tree 패턴 | 유지 |
| PS-F-010 | `/ All changes` 루트 버튼 | 누른다 | `SourceTree.tsx:41` | `onSelect({ path: '', kind: 'directory', revision })` | 버튼 | 유지 |
| PS-F-011 | 트리 새로고침·부분 목록 | `Refresh file tree`, truncated | `SourceTree.tsx:37`, `:44`, `:22` | 부분 목록이면 `Directory listing is partial.` 안내. 하위 폴더도 같은 안내를 가진다 | 아이콘 버튼 + 안내 문구 | 유지 |
| PS-F-012 | 트리 선택의 결과 | 파일·폴더를 고른다 | `RepositoryWorkspace.tsx:333` | `navigate({ path, path_kind, source_ref: revision, tab: 'history' })`. **탭이 Commit history로 자동 전환된다** | 라우터 query 갱신 | 유지 |
| PS-F-013 | submodule 항목 | 고를 수 없다 | `SourceTree.tsx:14`, `:15` | `selectable`은 directory·file·symlink만. submodule은 `aria-disabled` | 동일 | 유지 |

### 3.2 탭

| ID | 화면·제어 | 근거 위치 | 동작과 상태 | PIPE 대상 | 판정 |
|---|---|---|---|---|---|
| PS-F-014 | 네 탭 | `RepositoryWorkspace.tsx:27`, `:336-338` | 순서와 문구는 `Search` / `Commit history` / `My open PRs` / `My merged PRs`. Radix `Tabs.Root`에 `activationMode="manual"`이므로 화살표로 이동해도 `Enter`/`Space`를 눌러야 전환된다 | MUI `Tabs`(`Tab` 포커스 이동은 수동 활성화로 맞춘다) | 재작성 |
| PS-F-015 | 탭 전환 | `RepositoryWorkspace.tsx:336` | `navigate({ tab: value })`. URL의 `tab` key가 상태의 주인이다 | 라우터 query | 유지 |
| PS-F-016 | 탭 아이콘 | `RepositoryWorkspace.tsx:337` | `Search` / `History` / `GitPullRequest` / `GitMerge` (lucide, 16px) | PIPE의 단일 아이콘 계열 | 재작성 |
| PS-F-017 | Commit history 탭의 내용 | `RepositoryWorkspace.tsx:339` | `tab === 'history'`이면 표 대신 `SourceHistory`를 그린다. 검색 필터 form 자체가 렌더링되지 않는다 | 별도 패널 컴포넌트 | 유지 |
| PS-F-018 | My 탭과 login | `RepositoryWorkspace.tsx:149`, `repository-search.ts:28` | `login`이 빈 문자열이면 조회 자체를 하지 않고 로딩만 끈다. 질의에는 `author:"{login}"`과 `is:open`/`is:merged`가 붙는다 | 주입받은 identity | 유지 |

### 3.3 필터

| ID | 화면·제어 | 근거 위치 | 동작과 상태 | 판정 |
|---|---|---|---|---|
| PS-F-019 | Filters 접기·펼치기 | `RepositoryWorkspace.tsx:100`, `:342-348` | 기본은 **닫힘**(`useState(false)`). Radix `Collapsible`이고 내용은 `forceMount`라 닫혀 있어도 DOM에 남는다 — CSS `[data-state='closed']`가 숨긴다 | 재작성 |
| PS-F-020 | 활성 필터 개수 | `RepositoryWorkspace.tsx:232`, `:344` | `q`, (search 탭에서만) `author`, `label`, (search 탭에서만) `state`의 비어 있지 않은 개수 + 활성 범위 개수. `Filters (4)`처럼 표기 | 유지 |
| PS-F-021 | Status | `RepositoryWorkspace.tsx:350` | `All states`(빈 값) / `Open` / `Merged` / `Closed`. My 탭에서는 `disabled`이고 값이 탭 이름으로 고정된다 | 재작성 |
| PS-F-022 | `Title · PR number · commit SHA` | `RepositoryWorkspace.tsx:351`, `:235` | 자리표시자는 `Keywords, #1842, or commit SHA…`. `data-reader-search` 속성이 붙어 셸의 단축키가 찾는다 | 재작성 |
| PS-F-023 | Author | `RepositoryWorkspace.tsx:352` | search·history 탭에서는 입력 가능. My 탭에서는 `login` 값을 `readOnly`로 보인다 | 재작성 |
| PS-F-024 | Label | `RepositoryWorkspace.tsx:353`, `:215-217`, `repository-search.ts:47-50` | 선택지는 `All labels` + **현재 적용된 값** + 응답 facet `label`의 값들. 중복은 `Set`으로 지운다. facet이 없으면 현재 값만 남는다 | 재작성 |
| PS-F-025 | Range filter 유형 선택기 | `RepositoryWorkspace.tsx:30-35`, `:357` | 네 유형: `PR number`(`pr`) / `M number`(`mnum`) / `Merged date`(`date`) / `Merge order`(`seq`). **한 번에 한 유형의 입력만 보인다** | 재작성 |
| PS-F-026 | 초기 유형 판정 | `repository-search.ts:12-18` | URL에 `pr_from`/`pr_to`가 있으면 `pr`, `mnum_*`이면 `mnum`, `from`/`to`면 `date`, 아무것도 없으면 `pr`. **`seq`는 URL에 남지 않으므로 여기서 복원되지 않는다** | 유지 |
| PS-F-027 | PR number 범위 | `RepositoryWorkspace.tsx:358` | `type="number"`, `min="1"`, `step="1"`. 자리표시자 `e.g. 1842` / `e.g. 2044` | 재작성 |
| PS-F-028 | M number 범위 | `RepositoryWorkspace.tsx:359`, `:248` | 저장소나 base branch가 없으면 입력이 `disabled`이고 `title`로 사유를 말한다. 제출 직전 `commitFilters`가 base 없는 `mnum_*`을 한 번 더 지운다 | 재작성 |
| PS-F-029 | Merged date 범위 | `RepositoryWorkspace.tsx:360`, `primitives.tsx:47-62` | 자체 구현 달력 `Popover`. 값은 **로컬 달력 기준 `YYYY-MM-DD` 문자열**이며 시간대 변환을 하지 않는다. `Clear`와 `Today` 버튼이 있다 | 재작성(antd `DatePicker` wrapper) |
| PS-F-030 | Merge order 범위 | `RepositoryWorkspace.tsx:361-364` | 두 개의 SHA 입력. 자리표시자 `7+ character SHA`. 저장소나 base가 없으면 `disabled` | 재작성 |
| PS-F-031 | 활성 범위 요약 | `RepositoryWorkspace.tsx:219-231`, `:366` | `PR 42–80`, `M 42–80`, `Merged 2026-01-01–2026-02-01`, `Merge order set` 또는 `Merge order pending`을 ` · `로 잇는다. **양쪽 값이 모두 있어야 활성으로 센다** | 유지 |
| PS-F-032 | Search 제출 | `RepositoryWorkspace.tsx:340`, `:255-286`, `:370` | form의 `onSubmit`이다. 따라서 필터 안의 어느 입력에서든 `Enter`가 제출이 된다. 버튼 문구는 `Search` → `Resolving…` → `Searching…` | 재작성 |
| PS-F-033 | Reset | `RepositoryWorkspace.tsx:370` | `shaFrom`·`shaTo`·`seqRange`를 비우고 `rangeType`을 `pr`로 되돌린 뒤, URL에서 `q author label state from to path base pr_from pr_to mnum_from mnum_to`를 전부 지운다. **`repository`·`tab`·`sort`·`order`·`source_ref`·`path_kind`는 지우지 않는다** | 유지 |
| PS-F-034 | 빠른 검색 단축키 | `RepositoryWorkspace.tsx:296-309` | `Ctrl/Cmd+K`와 `Ctrl/Cmd+G`, 그리고 진입 시 `location.hash === '#omni-search-input'`이면 Filters를 열고 `q` 입력에 focus + select한다. 리스너는 `window`에 붙고 unmount에서 제거한다 | 재작성(§App Shell 없이도 살려야 한다) |
| PS-F-035 | 단축키 힌트 표시 | `RepositoryWorkspace.tsx:370` | 푸터 오른쪽에 `⌘ K Quick search` | 재작성 |

### 3.4 질의 생성과 조회 경로

| ID | 항목 | 근거 위치 | 규칙 | 판정 |
|---|---|---|---|---|
| PS-F-036 | 질의 문자열 | `repository-search.ts:20-40` | 4장에 전문을 옮겼다. `kind:` → `repo:` → `base/author/label/path/state` → My 탭의 `author`·`is:` → `merged:` → `pr_number:` → `mnum:` → `seq:` → 자유 텍스트 순으로 이어 붙이고 공백으로 합친다 | 유지 |
| PS-F-037 | 값 인용 | `repository-search.ts:2` | `JSON.stringify(value)`로 감싼다. 따라서 큰따옴표와 역슬래시가 이스케이프된다 | 유지 |
| PS-F-038 | 정렬 기본값 | `repository-search.ts:42-44` | URL `sort`가 있으면 그것. 없으면 history 탭은 `merge_seq`, 나머지는 `pr_number` | 유지 |
| PS-F-039 | 정렬 방향 | `RepositoryWorkspace.tsx:144`, `:237` | `order`는 `asc`가 아니면 전부 `desc`. 같은 열을 다시 누르면 `desc → asc`, 다른 열을 누르면 `desc` | 유지 |
| PS-F-040 | 식별자 분기 | `RepositoryWorkspace.tsx:166-170` | `q` 원문을 `detectIdentifier`에 넣어 `commit` 또는 `pull_request` 해석이 하나라도 있으면 `/api/resolve`로, 아니면 `/api/search`로 간다. **`#N` 형태면 앞에 현재 저장소를 붙여 `owner/repo#N`으로 보낸다** | 유지 |
| PS-F-041 | 질의 검증 | `RepositoryWorkspace.tsx:169` | 식별자가 아닐 때만 `parseQuery(query)`를 돌려 문법 오류를 화면 오류로 바꾼다 | 유지 |
| PS-F-042 | 페이지 크기·facet | `RepositoryWorkspace.tsx:164` | 항상 `size=50`. `facets`는 첫 페이지에서만 `true`, 이어 보기에서는 `false` | 유지 |
| PS-F-043 | 반쪽 범위 차단 | `RepositoryWorkspace.tsx:153-162` | 조회를 시작하기 전에 `from/to`, `pr_from/pr_to`, `mnum_from/mnum_to`를 이 순서로 검사한다. 한쪽만 있으면 `rangeType`을 그 유형으로 **강제 전환**하고 오류를 낸 뒤 조회를 중단한다 | 유지(결함 포함, 6장 참조) |
| PS-F-044 | 식별자 응답 변환 | `RepositoryWorkspace.tsx:177` | `/api/resolve`의 `candidates`를 행 모양으로 바꾼다. `title = display_name`, `merged_at`·`changed_files_count`·`additions`·`deletions`는 전부 `null`로 채운다. `total.relation`은 `truncated`이면 `gte` | 유지 |
| PS-F-045 | epoch 무효 | `RepositoryWorkspace.tsx:176` | 응답에 `epoch_stale`이 있으면 `The sequence epoch changed. Check your filters and try again.`을 던진다 | 유지 |

### 3.5 결과 표

| ID | 항목 | 근거 위치 | 규칙 | 판정 |
|---|---|---|---|---|
| PS-F-046 | 열 구성 | `RepositoryWorkspace.tsx:377-381` | `#` / `M number` / `Title` / `Author` / `Status` / `Merged at` / `Changes` / (이름 없는 Details 열). 여덟 개다 | 재작성 |
| PS-F-047 | 정렬 가능한 열 | `RepositoryWorkspace.tsx:377`, `:378`, `:380` | `#`(`pr_number`), `M number`(`merge_seq`), `Merged at`(`merged_at`) 세 개만. `aria-sort`를 함께 갱신한다 | 유지 |
| PS-F-048 | 행 식별자 | `RepositoryWorkspace.tsx:384` | `${kind}:${repository}:${pr_number ?? commit_sha}:${sequence_space}` | 유지 |
| PS-F-049 | `#` 열 | `RepositoryWorkspace.tsx:385`, `:388` | PR이면 `#1842`, 커밋이면 SHA 앞 12자. `gheBaseUrl`과 `repository`와 `pr_number`가 **모두** 있을 때만 새 탭 링크가 된다. 커밋에는 링크가 없다 | 유지 |
| PS-F-050 | `M number` 열 | `RepositoryWorkspace.tsx:389` | `MergeNumberBadge`에 행 전체를 `fields`로 넘기고, `context`의 저장소·브랜치는 `sequence_space`를 첫 `@`에서 쪼개 만든다 | 재작성 |
| PS-F-051 | `Title` 열 | `RepositoryWorkspace.tsx:390` | 제목은 버튼이고 누르면 상세가 펼쳐진다. 제목이 없으면 커밋은 SHA 축약, PR은 `Untitled pull request`. 아래 작은 글씨로 `sequence_space ?? repository` | 재작성 |
| PS-F-052 | `Author` 열 | `RepositoryWorkspace.tsx:391` | 앞 두 글자 대문자 아바타 + 이름. 없으면 `—` | 재작성 |
| PS-F-053 | `Status` 열 | `RepositoryWorkspace.tsx:391` | `merged`면 `GitMerge` + `Merged`, `open`이면 `GitPullRequest` + `Open`, `closed`면 `Closed`, 그 외에는 `—`. `data-state` 속성으로 색을 준다 | 재작성 |
| PS-F-054 | `Merged at` 열 | `RepositoryWorkspace.tsx:392`, `format.ts:98-111` | `formatTimestamp`. **UTC로 고정**해 `YYYY-MM-DD HH:MM UTC`로 그린다. 값이 없거나 파싱 실패면 `—` | 유지 |
| PS-F-055 | `Changes` 열 | `RepositoryWorkspace.tsx:392` | `additions`가 `null`이면 `—`, 아니면 `+{n}`. `deletions`가 `null`이면 **빈 문자열**, 아니면 `−{n}`(U+2212 빼기 기호) | 유지 |
| PS-F-056 | Details 버튼 | `RepositoryWorkspace.tsx:393` | `aria-expanded`와 `aria-label="#1842 Details"`를 가진 버튼 | 재작성 |
| PS-F-057 | 행 상세 펼침 | `RepositoryWorkspace.tsx:390`, `:393`, `:394` | `expanded`는 문자열 하나다. 따라서 **한 번에 한 행만** 펼쳐진다. 같은 행을 다시 누르면 닫힌다 | 유지 |
| PS-F-058 | 활성 행 추적 | `RepositoryWorkspace.tsx:387` | `onMouseEnter`와 `onFocusCapture`가 `activeRow`를 갱신한다. 이 값이 `Ctrl+D` 단축키의 대상이다 | 유지 |
| PS-F-059 | 결과 수 표기 | `RepositoryWorkspace.tsx:372` | `loadedKey === requestKey`이고 `data.total`이 있을 때만 그린다. `1,234 items` 또는 `relation === 'gte'`이면 `1,234+ items`. 로딩 중에는 `Loading…` | 유지 |
| PS-F-060 | 정렬 상태 표기 | `RepositoryWorkspace.tsx:372` | `PR` / `M number` / `Merged at` + `Descending` 또는 `Ascending` | 유지 |
| PS-F-061 | 새로고침 | `RepositoryWorkspace.tsx:372` | `Refresh search` 아이콘 버튼. `setCursor(null)` + `setNonce(n+1)`이므로 **첫 페이지부터 다시 읽는다** | 유지 |
| PS-F-062 | 로딩 골격 | `RepositoryWorkspace.tsx:383` | 행이 하나도 없을 때만 `colSpan={8}` 골격 행 **7개** | 재작성 |
| PS-F-063 | 빈 상태 | `RepositoryWorkspace.tsx:397` | 저장소가 있으면 `No matching changes`, 없으면 `No repositories to display`. 각각 다른 설명 문구 | 재작성 |
| PS-F-064 | 무한 스크롤 | `RepositoryWorkspace.tsx:190-214`, `:398` | `IntersectionObserver`에 `rootMargin: '200px'`. 관측자는 ref에 담긴 `{nextCursor, loading, error}`를 읽는다. **`error`가 있으면 콜백이 아무 일도 하지 않으므로 자동 재시도가 일어나지 않는다** | 재작성 |
| PS-F-065 | 이어 보기 표시 | `RepositoryWorkspace.tsx:398` | `next_cursor`가 있을 때만 영역이 있고, `aria-live="polite"`로 `{n} shown`을 알린다 | 유지 |
| PS-F-066 | 페이지 이어 붙이기 | `RepositoryWorkspace.tsx:181` | cursor가 있으면 이전 `items` 뒤에 붙인다. **facet은 첫 페이지 것을 보존한다.** 행 중복 제거는 하지 않는다 | 유지 |
| PS-F-067 | 문맥 전환 시 초기화 | `RepositoryWorkspace.tsx:145-147`, `:188-189` | `requestKey = query|sort|order`가 바뀌면 `cursor`와 `expanded`를 비운다. `loadedKey !== requestKey`인 동안 **행과 cursor를 빈 것으로 취급**하므로 이전 저장소 결과가 새 머리글 아래 남지 않는다 | 유지 |
| PS-F-068 | 401 만료 | `RepositoryWorkspace.tsx:173`, `:373` | 로그인 링크에 `return_to`로 현재 `/search?{serialized}`를 실어 준다 | 호스트제공 |
| PS-F-069 | 조회 실패 배너 | `RepositoryWorkspace.tsx:374` | `role="alert"` + `Reload first page` 버튼. 이것이 cursor 실패의 유일한 복구 수단이다 | 유지 |

### 3.6 행 상세

| ID | 항목 | 근거 위치 | 규칙 | 판정 |
|---|---|---|---|---|
| PS-F-070 | 상세 조회 | `RepositoryWorkspace.tsx:42-51` | PR이면 `GET /api/pull-requests/{encodeURIComponent(repository)}/{pr_number}`, 커밋이면 `GET /api/commits/{encodeURIComponent(repository)}/{commit_sha}`. 행이 바뀌면 이전 요청을 `abort`한다 | 재작성 |
| PS-F-071 | 상세 머리글 | `RepositoryWorkspace.tsx:56` | `head_branch`가 있으면 `{head} → {base}`, 없으면 `Change details` | 재작성 |
| PS-F-072 | GHE 원문 링크 | `RepositoryWorkspace.tsx:52-53`, `:57` | PR이면 `{ghe}/{repo}/pull/{n}`, 커밋이면 `{ghe}/{repo}/commit/{sha}`. `gheBaseUrl`이 없으면 링크 자체가 없다 | 재작성 |
| PS-F-073 | View diff 버튼 | `RepositoryWorkspace.tsx:58`, `SourceDialogs.tsx:22-27` | `SourceActions`가 `path`를 받지 않으므로 `View diff`를 그린다. 누르면 `DiffModal`이 열린다 | 재작성 |
| PS-F-074 | 본문 | `RepositoryWorkspace.tsx:60` | `body ?? message`를 **평문 문단으로** 그린다. Markdown 렌더링도 HTML 삽입도 없다 | 유지 |
| PS-F-075 | Changed files | `RepositoryWorkspace.tsx:62-64` | `changed_paths`가 `undefined`면 `The file list has not been collected yet.`, 빈 배열이면 `No changed files.`. 각 경로는 버튼이고 누르면 history로 이동한다 | 재작성 |
| PS-F-076 | 부분 파일 목록 | `RepositoryWorkspace.tsx:64` | `files_truncated` 또는 `changed_paths_truncated`이면 `Only some files are shown. View all changes in GHE.` | 유지 |
| PS-F-077 | Commit 목록과 SHA 복사 | `RepositoryWorkspace.tsx:65-68` | `merge_commit_sha`를 맨 앞에 두고 `source_commits`를 잇는다. 각 SHA는 버튼이고 `navigator.clipboard.writeText`. 성공은 `SHA copied.`, 실패는 `Unable to copy. Select and copy the SHA manually.`를 `role="status"`로 알린다 | 재작성 |
| PS-F-078 | 상세 실패 | `RepositoryWorkspace.tsx:55` | `Unable to load details.` + `Try again`. **펼친 행 안에만** 머문다 | 유지 |
| PS-F-079 | 경로 클릭 이동 | `RepositoryWorkspace.tsx:394` | `navigate({ path, tab: 'history', path_kind: 'file', source_ref: commit_sha ?? merge_commit_sha ?? '' })` | 유지 |

### 3.7 M 번호

| ID | 항목 | 근거 위치 | 규칙 | 판정 |
|---|---|---|---|---|
| PS-F-080 | 판정 순서 | `merge-number.ts:140-226` | 커밋이면 그리지 않는다 → 상태 키가 없거나 모르는 값이면 그리지 않는다 → `not_applicable` → `unavailable` → `pending` → `assigned` | 유지 |
| PS-F-081 | 네 상태의 문구 | `merge-number.ts:150-224` | 5장에 전문을 옮겼다 | 유지 |
| PS-F-082 | 링크 조건 | `merge-number.ts:194-209` | `assigned`이고 `merge_number_epoch`가 숫자이고 저장소·브랜치를 모두 알 때만 링크가 생긴다. `pending`·`unavailable`에는 링크가 없다 | 유지 |
| PS-F-083 | 링크 주소 | `merge-number.ts:106-118` | `/search?m_repository=…&m_base_branch=…&m_seq_epoch=…&m_number=…`. 네 값을 전부 싣는다 | 재작성(경로는 호스트의 routeBase로) |
| PS-F-084 | 링크 종단 처리 | `SearchView.tsx:55`, `:165`, `:558` | **결함이다.** `m_*` key를 읽어 해석하는 `MergeNumberEntry`는 `SearchView`만 그린다. 기본 `/search`가 여는 `RepositoryWorkspace`는 이 네 key를 읽지 않는다. 6장 참조 | 6장 결정 필요 |
| PS-F-085 | M 링크 복사 | `MergeNumberBadge.tsx:105-119`, `RepositoryWorkspace.tsx:389` | 배지는 `onCopy`를 받을 때만 복사 버튼을 그리는데, `RepositoryWorkspace`는 `onCopy`를 **넘기지 않는다**. 따라서 기본 화면에는 `Copy M link` 버튼이 없다 | 6장 결정 필요 |
| PS-F-086 | 공간 문자열 분해 | `merge-number.ts:96-103` | `owner/repo@branch`를 **첫 `@`**에서 자른다. 브랜치 이름에 `@`가 들어갈 수 있기 때문이다 | 유지 |

### 3.8 Commit history

| ID | 항목 | 근거 위치 | 규칙 | 판정 |
|---|---|---|---|---|
| PS-F-087 | 문맥 재설정 | `SourceHistory.tsx:55-58` | 바깥 컴포넌트가 `key={repository|path|revision|branch}`로 내부를 통째로 다시 만든다. 문맥이 바뀌면 페이지·고정 revision·선택이 모두 초기화된다 | 재작성 |
| PS-F-088 | revision 고정 | `SourceHistory.tsx:60-64` | 첫 응답의 `revision`을 `pinned`에 넣고 이후 요청은 그 값으로 간다. 따라서 페이지를 더 읽는 동안 브랜치 머리가 움직여도 같은 스냅숏을 본다 | 유지 |
| PS-F-089 | 조회 | `SourceHistory.tsx:61` | `GET /api/source/{repo}/history?path={path}&ref={pinned || branch}&page={n}` | 유지 |
| PS-F-090 | 중복 제거 | `SourceHistory.tsx:64` | 2페이지부터는 `sha` 기준으로 중복을 지우고 뒤에 붙인다 | 유지 |
| PS-F-091 | 표 구성 | `SourceHistory.tsx:77` | 선택 체크박스 / `Revision` / `Change` / `Linked PRs` / `Author` / `Committed` / `Inspect` | 재작성 |
| PS-F-092 | 날짜 표기 | `SourceHistory.tsx:77` | `toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })`. **결과 표의 UTC 고정과 다르다** — 이쪽은 브라우저 시간대를 탄다 | 6장 결정 필요 |
| PS-F-093 | SHA 복사 | `SourceHistory.tsx:77` | `CopyText`로 감싼 앞 9자. `aria-label`은 `Copy full SHA {full}` | 재작성 |
| PS-F-094 | Linked PRs 3상태 | `SourceHistory.tsx:77`, `@prs/contracts` | `null`이면 `Pending`, 빈 배열이면 `—`, 값이 있으면 `#N` 배지들. 각 배지는 **번호만 복사**한다(`Copy PR #{n}`) | 유지 |
| PS-F-095 | PR 조회 불가 | `SourceHistory.tsx:76` | 응답에 `pull_requests_unavailable`이 있으면 `PR link lookup is temporarily unavailable. Commit history remains available.` 안내만 붙이고 이력은 계속 쓴다 | 유지 |
| PS-F-096 | 비교 선택 | `SourceHistory.tsx:62`, `:77` | 파일일 때만 활성. 이미 두 개를 골랐으면 나머지 체크박스는 `disabled` | 유지 |
| PS-F-097 | 두 revision 비교 | `SourceHistory.tsx:72` | `Compare selected (n/2)`. 누르면 `base = selected[1]`, `head = selected[0]`로 `DiffModal`을 연다. **선택 순서가 곧 방향이다** | 유지 |
| PS-F-098 | 폴더·루트 안내 | `SourceHistory.tsx:73` | 파일이 아니면 `Select a file to enable comparison` 안내를 띄우고 비교와 Time-lapse를 비활성한다 | 유지 |
| PS-F-099 | 행 Diff | `SourceHistory.tsx:77` | `Change` 열의 제목 버튼과 `Inspect` 열의 `Diff` 버튼이 **같은 동작**이다(`setDiff({ repository, commit })`) | 유지 |
| PS-F-100 | 더 읽기 | `SourceHistory.tsx:79` | `next_page`가 있을 때만 `Load older commits` 버튼. 무한 스크롤이 아니다 | 유지 |
| PS-F-101 | 이력 단축키 | `SourceHistory.tsx:66-70` | `Ctrl/Cmd+D`는 `active` 커밋의 Diff, `T`는 Time-lapse. 입력·dialog 안에서는 동작하지 않고 `stopPropagation`으로 바깥 핸들러를 막는다 | 재작성 |
| PS-F-102 | rename 안내 | `SourceHistory.tsx:73` | `History is path-based; renamed files can be followed from their previous path in Diff.` | 유지 |

### 3.9 Diff 모달

| ID | 항목 | 근거 위치 | 규칙 | 판정 |
|---|---|---|---|---|
| PS-F-103 | 변경 메타데이터 | `SourceDialogs.tsx:42` | `GET /api/source/{repo}/diff?pr={n}&commit={sha}&page={p}`. 파일 대 파일 비교(`target.file`)일 때는 이 조회를 하지 않는다 | 재작성 |
| PS-F-104 | base/head 고정 | `SourceDialogs.tsx:44-48` | 첫 응답의 `base`/`head`를 `pinned`에 넣는다. 이후 페이지에서 값이 달라지면 `This PR changed while loading files. Close and reopen the comparison.`을 띄우고 더 읽지 않는다 | 유지 |
| PS-F-105 | 파일 목록 이어 읽기 | `SourceDialogs.tsx:49`, `:75` | `More files` 버튼으로 `next_page`를 읽고 `path` 기준 중복을 지운다. `truncated`면 `GitHub file limit reached. This list is partial.` | 유지 |
| PS-F-106 | 파일 내용 조회 | `SourceDialogs.tsx:57-58` | `GET /api/source/{repo}/file?path={p}&revision={rev}`를 before/after 각각. `status === 'added'`면 before를 부르지 않고, `'removed'`면 after를 부르지 않는다 | 유지 |
| PS-F-107 | 빈 쪽의 표현 | `SourceDialogs.tsx:39`, `:59-60` | 추가·삭제된 파일의 반대쪽은 **빈 텍스트 파일**로 만든다. 가짜 내용을 그리지 않는다 | 유지 |
| PS-F-108 | split / unified | `SourceDialogs.tsx:73`, `:81-84` | 기본은 `split`. split은 `colgroup`으로 `44px / calc(50% - 44px)`를 두 번 반복해 좌우 줄을 정렬한다. **스크롤 컨테이너는 하나다** | 재작성 |
| PS-F-109 | Find in diff | `SourceDialogs.tsx:67`, `:73` | 검색어가 있으면 일치하는 **줄**의 인덱스가, 없으면 변경 덩어리의 시작 인덱스가 이동 대상이 된다. 표기도 `matching lines` / `change groups`로 달라진다 | 유지 |
| PS-F-110 | 이전·다음 이동 | `SourceDialogs.tsx:68` | 순환한다(모듈러). `scrollIntoView({ block: 'center' })` | 유지 |
| PS-F-111 | Swap | `SourceDialogs.tsx:61`, `:73` | before/after를 맞바꾼다. 머리글의 SHA 표기도 함께 바뀐다 | 유지 |
| PS-F-112 | 문맥 접기 | `SourceDialogs.tsx:69`, `:76`, `:82` | 기본은 변경 줄 앞뒤 **3줄**만 보인다. `Show unchanged lines` 또는 `Show all lines` 체크박스로 전부 편다. 검색어가 있으면 접지 않는다 | 유지 |
| PS-F-113 | 단어 단위 강조 | `SourceDialogs.tsx:28-32`, `source-analysis.ts:24-30` | 변경 행의 before/after 양쪽 길이 합이 **4000자를 넘으면** 단어 비교를 포기하고 줄 전체를 변경으로 칠한다 | 유지 |
| PS-F-114 | rename 링크 | `SourceDialogs.tsx:77` | `Renamed from {previous_path}` 링크가 `/search?…`를 **하드코딩**한다. 포팅 시 반드시 호스트 경로로 바꿔야 한다 | 재작성 |
| PS-F-115 | 계산 불가 | `SourceDialogs.tsx:63`, `:80` | `compareLines`가 `null`을 주면 `Text comparison unavailable`과 사유를 보인다. 빈 diff로 속이지 않는다 | 유지 |
| PS-F-116 | 줄바꿈 안내 | `SourceDialogs.tsx:85` | 마지막 줄에 개행이 없으면 `Before: no newline at EOF.` / `After: no newline at EOF.`를 덧붙인다 | 유지 |
| PS-F-117 | 관련 PR | `SourceDialogs.tsx:88` | `<details>`로 접어 둔다. 링크는 `/pr/{repo}/{n}`을 **하드코딩**한다 | 재작성 |
| PS-F-118 | 전체화면·드래그 | `SourceDialogs.tsx:13-17` | 머리글을 끌어 모달을 옮길 수 있고, 전체화면 전환 시 위치를 0으로 되돌린다 | 7장 결정 |
| PS-F-119 | 모달 테마 토글 | `SourceDialogs.tsx:17` | 머리글에 `ThemeToggle`이 있다. **이번 포팅에서는 제외한다**(호스트 테마 상속) | 제외 |

### 3.10 Time-lapse 모달

| ID | 항목 | 근거 위치 | 규칙 | 판정 |
|---|---|---|---|---|
| PS-F-120 | 이력 확보 | `SourceDialogs.tsx:94-95` | History에서 열면 이미 읽은 `initialCommits`를 쓰고 조회하지 않는다. Diff나 상세에서 열면 `history`를 직접 조회한다. 목록은 **오래된 것이 앞**이 되도록 뒤집는다 | 유지 |
| PS-F-121 | revision 이동 | `SourceDialogs.tsx:126` | 이전·다음 버튼과 Radix `Slider`. 기본 선택은 **가장 최신**(`commits.length - 1`) | 재작성 |
| PS-F-122 | 부분 이력 안내 | `SourceDialogs.tsx:127` | 더 읽을 페이지가 있으면 `Showing the loaded path revisions. Load older commits in History before opening Time-lapse to extend the window.` | 유지 |
| PS-F-123 | 파일 내용 | `SourceDialogs.tsx:97` | 선택 revision의 `file`을 **180ms 지연 후** 조회한다(슬라이더를 끌 때 요청이 쏟아지지 않게) | 유지 |
| PS-F-124 | 줄 추적 | `SourceDialogs.tsx:104-121`, `source-analysis.ts:33-47` | `Analyze line history`를 눌러야 시작한다. 현재 위치에서 **뒤로 최대 30개** revision을 3개씩 묶어 읽고 `traceLines`를 돌린다. 자동 실행이 아니다 | 재작성 |
| PS-F-125 | 추적의 의미 | `source-analysis.ts:32`, `SourceDialogs.tsx:133` | 인접 diff로 **추정한 대응**이지 Git blame이 아니다. 화면에도 그렇게 적는다 | 유지 |
| PS-F-126 | 줄 선택과 이력 | `SourceDialogs.tsx:131-132` | 줄 번호 버튼으로 선택하고 `↑ ↓`로 옮긴다. 이력 항목을 누르면 그 revision으로 이동하며 해당 줄을 고른다 | 재작성 |
| PS-F-127 | 편집 빈도 음영 | `SourceDialogs.tsx:131`, `:133` | `source-heat-0`부터 `source-heat-4`까지 다섯 단계. 범례가 함께 있다 | 재작성 |
| PS-F-128 | 텍스트가 아닐 때 | `SourceDialogs.tsx:112`, `:131` | `text`도 `missing`도 아니면 분석을 중단하고 사유를 보인다 | 유지 |
| PS-F-129 | 모달 중첩 | `SourceDialogs.tsx:89`, `SourceHistory.tsx:81` | Diff 위에서 Time-lapse를 열 수 있다. 두 개의 Radix `Dialog.Root`가 겹친다 | 7장 결정 |

### 3.11 전역 단축키

| ID | 항목 | 근거 위치 | 규칙 | 판정 |
|---|---|---|---|---|
| PS-F-130 | 단축키 가드 | `RepositoryWorkspace.tsx:311` | `input, textarea, select, [contenteditable="true"], [role="dialog"], [role="combobox"], [role="listbox"]` 안에서 시작한 키 이벤트는 무시한다. **`role="combobox"`가 빠지면 Radix `Select` 타자 검색이 새어 나가 모달이 열린다**(CR-111 검토에서 실제로 고친 결함) | 유지 |
| PS-F-131 | `Ctrl/Cmd+D` | `RepositoryWorkspace.tsx:312` | `activeRow`가 있고 history 탭이 아닐 때 Diff를 연다 | 재작성 |
| PS-F-132 | `T` | `RepositoryWorkspace.tsx:313` | 수식 키가 없고 `path`가 있으며 `path_kind !== 'directory'`일 때 Time-lapse를 연다 | 재작성 |

### 3.12 기능 → fixture → 수용 테스트 연결

기능 추적표의 각 행에 fixture와 시험 열을 따로 두면 132행이 지나치게 넓어지므로, 묶음 단위로 연결했다. `fx:` 이름은 `fixtures/SCENARIOS.md` 2장, `PS-T-` 이름은 `PARITY_AND_ACCEPTANCE.md` 3장에 정의되어 있다.

| 기능 범위 | 다루는 것 | fixture 시나리오 | 수용 테스트 | 알려진 차이 |
|---|---|---|---|---|
| PS-F-001 | 저장소 선택과 문맥 초기화 | `fx:default-search` | PS-T-002, PS-T-004 | — |
| PS-F-002 ~ PS-F-004 | 목록 페이지 추가 로딩, 빈 페이지, 실패 | `fx:repos-paged` | PS-T-003, PS-T-003b | `PD-003`(Autocomplete 전환) |
| PS-F-005 | Base branch 선택 | `fx:default-search` | PS-T-005, PS-T-010 | — |
| PS-F-006 ~ PS-F-013 | 파일 트리 전체 | `fx:source-tree`, `fx:encoding` | PS-T-023, PS-T-024, PS-T-034 | — |
| PS-F-014 ~ PS-F-018 | 네 탭과 My 탭의 identity | `fx:default-search` | PS-T-002, PS-T-036 | — |
| PS-F-019 ~ PS-F-024 | Filters 접힘, 활성 개수, 네 필드 | `fx:default-search` | PS-T-002, PS-T-007, PS-T-020 | — |
| PS-F-025 ~ PS-F-027 | 범위 유형 선택기, 초기 유형, PR 범위 | `fx:default-search` | PS-T-009, PS-T-013, PS-T-042 | — |
| PS-F-028 | M 범위와 base 의존 | `fx:default-search` | PS-T-010 | — |
| PS-F-029 | 날짜 범위 | `fx:default-search` | PS-T-011 | — |
| PS-F-030 | Merge order(SHA) 범위 | `fx:sha-range` | PS-T-012 | `PD-010`(URL 미영속) |
| PS-F-031 | 활성 범위 요약 | `fx:default-search` | PS-T-013, PS-T-013b | — |
| PS-F-032 ~ PS-F-033 | 제출과 Reset | `fx:default-search` | PS-T-006, PS-T-014 | PS-T-006은 IME 보호 추가 |
| PS-F-034 ~ PS-F-035 | 빠른 검색 단축키 | `fx:default-search` | PS-T-033 | `PD-009`(콘텐츠가 전부 소유) |
| PS-F-036 ~ PS-F-038 | 질의 문자열, 인용, 정렬 기본값 | (순수 함수) | PS-T-002, PS-T-009, PS-T-015 | — |
| PS-F-039 | 정렬 방향 토글 | `fx:default-search` | PS-T-015 | — |
| PS-F-040 ~ PS-F-041 | 식별자 분기와 질의 검증 | `fx:identifier-routes` | PS-T-008 | — |
| PS-F-042 | 페이지 크기와 facet | `fx:paging-123` | PS-T-016 | — |
| PS-F-043 | 반쪽 범위 차단 | `fx:default-search` | PS-T-011, PS-T-013b | **`PD-002`(원본과 다르다)** |
| PS-F-044 | 해석 응답의 행 변환 | `fx:identifier-routes` | PS-T-008 | — |
| PS-F-045 | epoch 무효 | `search-epoch-stale.json` | PS-T-008 | — |
| PS-F-046 ~ PS-F-048 | 표의 열과 정렬 가능 열 | `fx:default-search` | PS-T-015, PS-T-039 | — |
| PS-F-049 ~ PS-F-056 | 각 열의 표시 규칙 | `fx:messy-rows` | PS-T-019, PS-T-039 | `PD-004`(날짜 표기 통일) |
| PS-F-057 ~ PS-F-058 | 한 행 상세, 활성 행 추적 | `fx:detail-failure` | PS-T-019, PS-T-020, PS-T-033 | — |
| PS-F-059 ~ PS-F-060 | 결과 수와 정렬 상태 표기 | `fx:total-gte` | PS-T-018 | — |
| PS-F-061 ~ PS-F-063 | 새로고침, 골격, 빈 상태 | `search-empty.json` | PS-T-002 | — |
| PS-F-064 ~ PS-F-067 | 무한 스크롤과 문맥 전환 | `fx:paging-123`, `fx:slow-previous` | PS-T-004, PS-T-016, PS-T-017 | — |
| PS-F-068 ~ PS-F-069 | 401과 조회 실패 배너 | `error-unauthenticated.json` | PS-T-017, PS-T-037 | — |
| PS-F-070 ~ PS-F-079 | 행 상세 전체 | `fx:detail-failure` | PS-T-019, PS-T-020, PS-T-035 | — |
| PS-F-080 ~ PS-F-083, PS-F-086 | M 배지 판정과 링크 생성 | `fx:mnumber-states` | PS-T-021 | — |
| PS-F-084 ~ PS-F-085 | M 링크 종단과 복사 버튼 | `fx:mnumber-states` | PS-T-022 | **`PD-001`(원본에 없다)** |
| PS-F-087 ~ PS-F-090 | history 문맥, 고정, 페이징 | `fx:history-pinned` | PS-T-025 | — |
| PS-F-091 ~ PS-F-095 | history 표와 PR 세 상태 | `fx:history-pr-states` | PS-T-026 | `PD-004`(날짜 표기) |
| PS-F-096 ~ PS-F-099, PS-F-102 | 비교 선택과 행 Diff | `fx:history-pinned` | PS-T-027 | — |
| PS-F-100 ~ PS-F-101 | 더 읽기와 이력 단축키 | `fx:history-pinned` | PS-T-025, PS-T-033 | — |
| PS-F-103 ~ PS-F-105 | Diff 메타데이터와 고정 | `fx:diff-basic`, `fx:diff-moved` | PS-T-030 | — |
| PS-F-106 ~ PS-F-107 | 파일 조회와 빈 쪽 | `fx:diff-file-states` | PS-T-029 | — |
| PS-F-108 ~ PS-F-113 | split/unified, find, swap, 접기, 단어 강조 | `fx:diff-basic`, `fx:diff-unicode` | PS-T-028 | — |
| PS-F-114, PS-F-117 | rename 링크와 관련 PR 링크 | `fx:diff-file-states` | PS-T-029 | **`PD-008`(경로를 바꾼다)** |
| PS-F-115 ~ PS-F-116 | 계산 불가와 개행 안내 | `fx:diff-file-states`, `fx:diff-unicode` | PS-T-029 | — |
| PS-F-118 ~ PS-F-119 | 모달 드래그와 테마 토글 | `fx:diff-basic` | PS-T-001, PS-T-028 | **`PD-006`, `PD-007`(제거한다)** |
| PS-F-120 ~ PS-F-128 | Time-lapse 전체 | `fx:timelapse` | PS-T-031 | — |
| PS-F-129 | 모달 중첩 | `fx:diff-basic` | PS-T-032 | 소유권 규칙을 명시했다 |
| PS-F-130 ~ PS-F-132 | 전역 단축키와 가드 | `fx:default-search` | PS-T-033 | — |
| (전 범위) | 언마운트 정리 | `fx:diff-basic` | PS-T-040 | — |
| (전 범위) | 실제 대상 경로 확인 | — | PS-T-041 | — |
| (전 범위) | URL 복원 | `fx:default-search` | PS-T-042 | `PD-010`(SHA 범위는 복원 안 됨) |
| (전 범위) | fixture 표시와 미연결 | — | PS-T-038 | — |

## 4. 질의 생성기 전문

`apps/web/lib/repository-search.ts:20-40`. 이 함수의 출력이 `/api/search`의 `q` 파라미터가 된다.

```ts
const quote = (value: string): string => JSON.stringify(value);

export function buildRepositoryQuery(input: {
  serialized: string;                       // 현재 URL의 query string
  repository: string;
  tab: 'search' | 'history' | 'open' | 'merged';
  login: string;
  seqRange?: { space: string; range: string };
}): string {
  const values = new URLSearchParams(input.serialized);
  const filters = [
    `kind:${input.tab === 'history' ? 'commit' : 'pull_request'}`,
    `repo:${quote(input.repository)}`,
  ];
  for (const key of ['base', 'author', 'label', 'path', 'state']) {
    const value = values.get(key);
    if (!value) continue;
    if (key === 'state' && (input.tab === 'open' || input.tab === 'merged')) continue;
    if (key === 'author' && (input.tab === 'open' || input.tab === 'merged')) continue;
    filters.push(key === 'state' ? `is:${value}` : `${key}:${quote(value)}`);
  }
  if (input.tab === 'open' || input.tab === 'merged') {
    filters.push(`author:${quote(input.login)}`, `is:${input.tab}`);
  }
  const from = values.get('from'), to = values.get('to');
  if (from && to) filters.push(`merged:${from}..${to}`);
  const prFrom = values.get('pr_from'), prTo = values.get('pr_to');
  if (prFrom && prTo) filters.push(`pr_number:${prFrom}..${prTo}`);
  const mnumFrom = values.get('mnum_from'), mnumTo = values.get('mnum_to');
  if (mnumFrom && mnumTo) filters.push(`mnum:${mnumFrom}..${mnumTo}`);
  if (input.seqRange && input.seqRange.space === `${input.repository}@${values.get('base') ?? ''}`) {
    filters.push(`seq:${input.seqRange.range}`);
  }
  const text = values.get('q')?.trim();
  if (text) filters.push(text);
  return filters.join(' ');
}
```

읽어야 할 규칙은 다섯 가지다.

1. **모든 조건은 공백으로 이어 붙은 AND다.** 다른 결합 연산자가 없다.
2. **범위는 양쪽이 모두 있어야 나간다.** 한쪽만 채우면 여기서는 조용히 빠지고, 대신 제출 직전 검사(PS-F-043)가 하드 오류로 막는다. 이 두 판정의 기준이 다른 것이 `DEV-729`다.
3. **`seq:`는 공간이 일치할 때만 나간다.** 저장소나 base branch가 바뀌면 `seqRange` 상태가 남아 있어도 질의에서 빠진다.
4. **자유 텍스트는 맨 뒤에 붙는다.** 인용하지 않으므로 사용자가 넣은 `repo:` 같은 키도 그대로 문법의 일부가 된다.
5. **My 탭은 `author`와 `state`를 사용자 입력에서 무시하고** `login`과 탭 이름으로 덮어쓴다.

## 5. M 번호 표시 판정 전문

`apps/web/lib/merge-number.ts:140-226`의 분기와 문구를 그대로 옮겼다.

| 순서 | 조건 | 결과 |
|---|---|---|
| 1 | `context.kind === 'commit'` | `hidden` — 영역 자체를 그리지 않는다 |
| 2 | `merge_number_state`가 네 값 중 하나가 아니다(키 없음 포함) | `hidden` |
| 3 | `not_applicable` + `reason === 'branch_not_tracked'` | 라벨 `Branch not numbered`, 설명 `There is no M number because the base branch is not eligible for numbering.`, tone `neutral` |
| 4 | `not_applicable` (그 외) | 라벨 `Not eligible for an M number`, 설명 `Unmerged PRs do not have M numbers.`, tone `neutral` |
| 5 | `unavailable` + `repository_code_unavailable` | 라벨 `Repository code needs verification`, 설명 `The M number cannot be displayed because a code could not be derived from the repository name. A number may already be assigned.`, tone `warning` |
| 6 | `unavailable` + `number_capacity_exceeded` | 라벨 `M number unavailable`, 설명 `The M number exceeds the supported display range.`, tone `warning` |
| 7 | `unavailable` (그 외) | 라벨 `M number unavailable`, 설명 `The M number could not be retrieved. Try again.`, tone `warning` |
| 8 | `pending` + `not_sequenced` | 라벨 `Awaiting sequence numbering`, 설명 `The M number has not been calculated because the merge sequence is not assigned yet. No provisional number is available.`, tone `neutral` |
| 9 | `pending` (그 외) | 라벨 `M number pending`, 설명 `An M number has not been assigned yet. {사유문} No provisional number is available.`, tone `neutral` |
| 10 | `assigned`인데 `merge_number`가 문자열이 아니거나 비었다 | 상태를 `unavailable`로 낮춘다. 라벨 `M number unavailable`, 설명 `The M number display value was not received. Try again.`, tone `warning` |
| 11 | `assigned` | 라벨은 **서버가 준 `merge_number` 문자열 그대로**. 설명 `{repo}@{branch} M number (epoch {n}). Use it only to determine merge order; it does not replace the PR number. It becomes invalid when the sequence epoch changes.`, tone `accent`, 링크 있음 |

9행의 사유 문구표(`merge-number.ts:121-131`)는 다음과 같다. 표에 없는 사유 코드는 `Reason code: {code}.`로, 사유가 `null`이면 `The reason is not available yet.`으로 그린다.

| reason | 문구 |
|---|---|
| `pr_evidence_pending` | `Merge evidence for this PR is still being checked.` |
| `predecessor_pending` | `Numbering stopped at an earlier entry whose PR association is not confirmed.` |
| `negative_evidence_unavailable` | `There is not enough evidence to confirm whether an earlier entry was applied without a PR.` |
| `partial_lookup` | `Candidate lookup has not finished yet.` |
| `profile_unverified` | `The historical merge method has not been confirmed.` |
| `unsupported_merge_profile` | `Numbering is unavailable because the history includes non-squash merges.` |
| `mapping_conflict` | `Numbering stopped because merge evidence is contradictory.` |
| `fetch_failed` | `Merge evidence lookup temporarily failed. It will retry in the next cycle.` |
| `canonical_mismatch` | `Numbering stopped because verification against the source of truth found a mismatch.` |

## 6. 문서와 코드가 어긋나는 지점, 그리고 원본의 알려진 결함

이 장은 "원본과 같게 만든다"와 "원본의 결함까지 복제한다"를 가르는 자리다. PIPE 담당 세션은 각 항목에 대해 결정을 내리고 그 결정을 `PARITY_AND_ACCEPTANCE.md`의 차이표에 적어야 한다.

### 6.1 `DEV-728` — 기본 Search 화면에 도달하는 e2e가 없다

`docs/40_delivery/pr_search_implementation_traceability.md:424`에 기록되어 있고 기준 커밋에서도 **`open` 상태**다. `apps/web/playwright.config.ts`의 `webServer.env`가 `PRS_LEGACY_SEARCH: '1'`을 고정하므로, e2e 전체가 `SearchView`만 렌더링하고 `RepositoryWorkspace`에는 닿지 않는다.

PIPE 담당 세션에게 이것이 뜻하는 바는 명확하다. **`apps/web/e2e/`의 어떤 spec도 이번 포팅 대상의 동작 근거가 아니다.** 특히 `mnumber.spec.ts`는 `SearchView`의 M 진입을 시험하는 것이므로, 그 통과 사실을 기본 화면의 동등성 근거로 삼으면 안 된다. 이번 포팅의 동작 근거는 `apps/web/a11y/repository-workspace.test.tsx`와 순수 함수 단위 시험이다.

### 6.2 `DEV-729` — 범위 유형을 바꿔 제출하면 방금 채운 값이 막힌다

`docs/40_delivery/pr_search_implementation_traceability.md:425`에 기록되어 있고 기준 커밋에서도 **`open` 상태**다. 저자 판단을 기다리는 설계 공백으로 등재되어 있다.

재현 경로는 이렇다. `PR number` 유형에서 `pr_from`만 채우고 완성하지 않은 채로, Range filter를 `M number`로 바꿔 `mnum_from`과 `mnum_to`를 온전히 채우고 제출한다. 그러면 `RepositoryWorkspace.tsx:157-159`의 검사가 먼저 걸린 `pr` 항목에서 멈춰 `Enter both PR number range bounds.` 오류를 내고 화면을 `PR number` 유형으로 되돌린다. 방금 완성한 `mnum` 조건은 값 자체는 URL과 draft에 남지만 화면에서 사라지고 검색은 실행되지 않는다.

원인은 두 판정이 서로 다른 기준을 쓰기 때문이다. `rangeActive`(`:219-225`)는 양쪽이 다 있어야 활성으로 세고, 제출 전 검사(`:153-162`)는 한쪽만 있으면 하드 오류로 막는다.

**이것은 원본의 결함이며 동등성 복제 대상이 아니다.** 대응 방안은 `PARITY_AND_ACCEPTANCE.md`의 `PD-002`에 적었다.

### 6.3 저장소 목록 sentinel 선택 시 드롭다운이 닫힌다

같은 `DEV-729` 항목의 부수 관찰로 등재되어 있다. Radix `Select.Item`은 고르면 팝오버를 닫으므로, `Load more repositories…`를 고를 때마다 목록이 닫혀 다시 열어야 한다. 기능은 정상이고 체감만 나빠진다. MUI `Autocomplete`로 옮기면 목록을 열어 둔 채 항목을 덧붙일 수 있으므로 이 문제는 **포팅 과정에서 자연히 해소된다**(`PD-003`).

### 6.4 M 링크가 기본 화면에서 끝까지 처리되지 않는다

1차 지시서 §6.5가 "링크 생성 함수만 보고 기능 완료로 판단하지 말라"고 지시한 항목이다. 실제로 추적한 결과는 다음과 같다.

- 링크를 **만드는** 쪽은 `merge-number.ts:106-118`과 `MergeNumberBadge.tsx:101`이며 기본 화면에서도 정상 동작한다. 배지를 누르면 `/search?m_repository=…&m_base_branch=…&m_seq_epoch=…&m_number=…`로 이동한다.
- 링크를 **해석하는** 쪽은 `readMergeNumberEntry`와 `MergeNumberEntry`인데, 이 둘을 그리는 화면은 `SearchView.tsx:165`, `:558` 하나뿐이다.
- `RepositoryWorkspace.tsx` 전체에서 `m_repository`·`m_base_branch`·`m_seq_epoch`·`m_number`를 읽는 코드는 없다.

따라서 운영 기본값(`PRS_LEGACY_SEARCH`가 `1`이 아님)에서 M 배지를 누르면 같은 화면이 다시 열리고 네 파라미터는 **무시된다**. `apps/web/a11y/mnumber.test.tsx`와 `apps/web/e2e/mnumber.spec.ts`가 이 흐름을 통과시키는 것은 둘 다 `SearchView`를 대상으로 하기 때문이다(6.1 참조).

또 하나, `RepositoryWorkspace.tsx:389`는 `MergeNumberBadge`에 `onCopy`를 넘기지 않으므로 기본 화면에는 `Copy M link` 버튼 자체가 없다.

**이 두 가지를 확인된 사실로 전달한다.** 결정은 `PD-001`에 적었다.

### 6.5 날짜 표기가 화면마다 다르다

결과 표의 `Merged at`은 `formatTimestamp`로 **UTC 고정**이다(`format.ts:98-111`, 그 근거는 `:88-97`의 주석). 반면 Commit history의 `Committed`는 `toLocaleDateString('en-US', …)`로 **브라우저 시간대**를 탄다(`SourceHistory.tsx:77`). 같은 화면 안에서 두 규칙이 섞여 있다. 의도된 설계인지 누락인지는 문서에서 찾지 못했다. `PD-004`에 적었다.

### 6.6 필터 격자의 열 수와 실제 필드 수가 다르다

`repository-workspace.css:79`는 `.repo-filter-grid`에 `repeat(5, minmax(0, 1fr))`를 준다. 그런데 `RepositoryWorkspace.tsx:349-354`가 그 안에 넣는 필드는 네 개다. CR-111 검토가 이 불일치를 지적했고, 실제 렌더 폭을 재어 보니 더 구체적인 기존 규칙이 이겨서 `1fr 2fr 1.15fr 1fr`로 그려진다는 것이 확인되어 반증되었다(ledger `8340`행). 그 이긴 규칙을 이번에 직접 확인했다: `apps/web/app/reader-workspace.css:100`의 `.reader-ui .repo-filter-grid { display: grid; grid-template-columns: 1fr 2fr 1.15fr 1fr; gap: 10px; }`이다. 선택자에 `.reader-ui`가 하나 더 붙어 구체성이 높다. **최종 cascade 승자를 selector 이름만으로 판단하면 안 된다는 실례이므로** 포팅 시에는 CSS를 흉내 내지 말고 `DESIGN_AND_WIREFRAMES.md`가 정한 명시적 격자를 쓴다.

### 6.7 ledger의 WP-096 상태가 코드보다 늦다

`docs/40_delivery/pr_search_implementation_traceability.md:219`은 WP-096을 `in_progress`로 적고 "브랜치 `feature/cr111-search-simplify` (push·PR·병합 전)"이라고 설명한다. 그러나 기준 커밋의 이력에는 `b6d9443 feat(CR-111): simplify Search screen sidebar and filter UI (WP-096)`가 이미 `main`에 들어 있다. **문서가 코드보다 늦은 상태다.** 이번 작업은 pr-search 문서를 고치지 않으므로 기록만 남긴다. 포팅 근거는 코드가 우선이다.

## 7. 직접 확인하지 못한 것

| 항목 | 상태 | 이유 |
|---|---|---|
| 실행 중인 화면의 스크린숏 | NOT RUN | 백엔드(PostgreSQL·Elasticsearch·Redis)와 `search-api`를 띄우지 않았고, 이번 범위가 문서 작성이므로 기동하지 않았다. `assets/` 디렉터리를 만들지 않았다 |
| 실제 브라우저에서 잰 computed style | NOT RUN | 위와 같다. 치수는 CSS 선언값과 `DESIGN_AND_WIREFRAMES.md`의 이식 결정값으로만 제시한다 |
| 대비비(contrast ratio) 측정 | NOT RUN | 측정 도구를 돌리지 않았다. PIPE 테마의 실제 색이 정해지지 않았으므로 목표값만 제시한다 |
| PIPE 저장소의 실제 패키지 버전 | 확인 불가 | 이 세션은 PIPE 저장소에 접근하지 못한다. `PIPE_SEARCH_IMPLEMENTATION_PROMPT.md`의 A단계 점검표로 넘긴다 |
| GHE 실데이터 동작 | NOT RUN | 사내 환경에 접근하지 않았다 |
