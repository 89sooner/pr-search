# API_AND_ADAPTER_CONTRACT — 확인된 응답 계약과 UI 데이터 포트

> 분류: 인수인계 자료 · 기준 SHA `da0ed9b5bd8fac59c7fcf02c593f69962468be4d`

**이번 범위는 UI가 쓸 데이터 포트와 raw 응답 계약, 그리고 합성 fixture까지다.** 실제 API 접근 경로, 사용자별 인증, 검색 권한 연결은 별도 후속 작업이다. 이 문서가 BFF나 Integration Gateway가 이미 존재한다고 전제하지 않는다.

아래의 경로와 DTO는 pr-search가 **현재 쓰는 것**이다. PIPE에 같은 것이 있다는 뜻이 아니다. PIPE 담당 세션은 이 계약을 만족하는 transport를 나중에 붙이면 되고, 지금은 같은 계약을 만족하는 fixture client로 UI를 완성한다.

## 1. 경로 구조 — 브라우저 경로와 upstream 경로는 다르다

pr-search 브라우저는 `/api/*`를 부르고, Next.js 프록시가 그것을 `{SEARCH_API_BASE}/api/v1/*`로 바꾼다.

```text
브라우저:  GET /api/search?q=…
프록시:    apps/web/app/api/[...path]/route.ts
upstream:  GET {base}/api/v1/search?q=…
```

경로 변환 규칙은 `apps/web/lib/proxy.ts:180-188`이다.

```ts
function buildUpstreamUrl(baseUrl, segments, search) {
  const safe = segments
    .filter(s => s !== '' && s !== '.' && s !== '..')   // 경로 탈출 차단
    .map(s => encodeURIComponent(s));                   // 세그먼트마다 다시 인코딩
  return `${baseUrl.replace(/\/+$/, '')}/api/v1${safe.length ? '/' + safe.join('/') : ''}${search}`;
}
```

프록시가 하는 일은 넷이다(`route.ts:3-11`).

1. 세션 쿠키를 검증한다. 없거나 죽었으면 401과 재인증 힌트를 준다.
2. 상관 ID(`x-correlation-id`)를 만들어 전파한다.
3. `search-api`로 전달한다. **세션 쿠키만** 보낸다.
4. 응답을 그대로 통과시킨다. 오류 DTO를 변형하지 않는다.

**PIPE 포팅에서 중요한 점**은 두 가지다.

첫째, `X-User-Id`, `X-Forwarded-User`, `Authorization`, `X-Roles` 같은 **신원 주장 헤더를 만들지 않는다.** pr-search의 `search-api`는 그런 헤더를 읽지 않고 전부 401로 거절한다. 신원은 세션 쿠키가 나르고 서버가 같은 저장소에서 직접 해석한다(`proxy.ts:3-12`). PIPE에서 검색 transport를 붙일 때도 같은 원칙을 지킨다. 헤더를 믿기 시작하면 클러스터 안 무엇이든 신원을 위조할 수 있다.

둘째, 전달 헤더가 **허용 목록**이다(`proxy.ts:52-64`). `accept`, `accept-language`, `content-type`, `idempotency-key` 넷만 통과한다. 여기 없는 헤더는 전부 버려진다.

## 2. 저장소 이름과 경로의 인코딩

저장소는 `owner/name` 형태인데 **경로 세그먼트 하나**에 들어간다. 따라서 `/`를 반드시 인코딩한다.

| 값 | 인코딩 결과 | 근거 |
|---|---|---|
| `demo/modem` | `demo%2Fmodem` | `RepositoryWorkspace.tsx:46`, `source/api.ts:6` |
| `demo/모뎀 테스트` | `demo%2F%EB%AA%A8%EB%8E%80%20%ED%85%8C%EC%8A%A4%ED%8A%B8` | 같음 |

서버는 디코딩한 뒤 정규식으로 검사한다(`source/routes.ts:29-31`).

```text
/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
그리고 owner와 name 어느 쪽도 '.' 또는 '..'이면 안 된다
```

따라서 **source 계열 API는 ASCII 저장소 이름만 받는다.** 위의 한글 저장소 예시는 `400 INVALID_PARAMETER`가 된다. 이것은 GHE 저장소 이름 규칙과 일치한다.

파일 경로와 브랜치 이름은 **query 값**으로 간다. `URLSearchParams`가 알아서 인코딩한다(`source/api.ts:5-7`).

```ts
function sourceUrl(repository, operation, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return `/api/source/${encodeURIComponent(repository)}/${operation}?${params}`;
}
```

**빈 문자열과 `undefined`인 파라미터는 아예 보내지 않는다.** 이 규칙이 중요하다. `ref=`를 빈 값으로 보내는 것과 `ref`를 생략하는 것은 서버에서 다르게 처리될 수 있다.

브랜치 `release/2026-Q1`은 `ref=release%2F2026-Q1`이 되고, 경로 `src/phy/한글 파일.c`는 `path=src%2Fphy%2F%ED%95%9C%EA%B8%80+%ED%8C%8C%EC%9D%BC.c`가 된다(`URLSearchParams`는 공백을 `+`로 쓴다).

## 3. `GET /api/search` — 목록 조회

upstream은 `/api/v1/search`다(`apps/search-api/src/search/routes.ts:51`).

### 3.1 요청 파라미터

| 이름 | 필수 | 타입 | 기본값 | 설명 |
|---|---|---|---|---|
| `q` | 아니오 | string | `''` | 검색 질의. 문법은 `PURE_LOGIC_REFERENCE.md` 4장과 아래 8장 |
| `sort` | 아니오 | string | `merge_seq` | 아래 목록의 값만. 다른 값이면 400 |
| `order` | 아니오 | `asc` \| `desc` | `desc` | |
| `size` | 아니오 | 정수 문자열 | `25` | 1 미만이거나 정수가 아니면 기본값. **200을 넘으면 오류가 아니라 200으로 절삭된다** |
| `cursor` | 아니오 | string | 없음 | 이어 보기. 서버가 서명한 불투명 문자열 |
| `facets` | 아니오 | `true` \| `false` | 없음 | `true`일 때만 facet 세 키가 응답에 붙는다 |
| `seq_epoch` | 아니오 | 정수 문자열 | 없음 | `seq:` 인용의 세대 고정 |

정렬 키는 아홉 개다(`packages/es/src/sort.ts:21-31`).

```text
pr_number, merge_seq, merged_at, created_at, updated_at,
changed_files_count, additions, lead_time_seconds, relevance
```

지원하지 않는 키는 **Elasticsearch를 부르기 전에** 400으로 거절되며, 응답의 `detail.supported_keys`에 위 목록이 실린다(`search/routes.ts:356-364`).

`RepositoryWorkspace`는 이 중 `pr_number`, `merge_seq`, `merged_at` 세 개만 쓴다. 나머지 여섯 개를 UI에 노출하지 않는다. 원본이 노출하지 않기 때문이다.

`RepositoryWorkspace`가 실제로 보내는 값은 고정되어 있다(`RepositoryWorkspace.tsx:164`).

```text
size=50
facets=true   (첫 페이지)
facets=false  (이어 보기)
```

`size`의 서버 기본값 25가 아니라 **항상 50을 명시한다.**

### 3.2 성공 응답

```ts
interface SearchResponse {
  query: string;                 // 서버가 받은 원문 질의
  parsed: QueryAst;              // 파싱 결과. UI가 쓰지 않는다
  total: { value: number; relation: 'eq' | 'gte' };
  sort: { field: SortKey; order: 'asc' | 'desc' };
  items: SearchItem[];
  next_cursor: string | null;    // 마지막 페이지에서 null. 키는 항상 있다
  correlation_id: string;

  // 조건부로 붙는 키 — 없으면 키 자체가 없다
  sequence_context?: {...};        // seq: 질의에서만
  epoch_stale?: boolean;           // 위와 함께. false로 실린다
  relaxation_hints?: unknown[];    // total.value === 0일 때만
  relaxation_hints_truncated?: boolean;
  unresolved_names?: unknown[];    // org/team 이름을 못 찾았을 때만
  facets?: Record<string, { value: string; count: number }[]>;  // facets=true일 때만
}
```

**`total`의 모양을 확정한다.** 1차 지시서가 짚은 모순에 대한 답이다.

- `/api/v1/search`는 `total: { value, relation }` **객체**를 반환한다. 근거: `apps/search-api/src/search/service.ts:152`가 `readonly total: { readonly value: number; readonly relation: string }`으로 선언하고, `:500`이 그 모양으로 조립하며, `search/routes.ts:490`이 `total: result.total`로 그대로 실어 보낸다.
- `packages/contracts/src/responses.ts:29`의 `CursorPage<T>`는 `total: number`이지만 **이 응답은 `CursorPage`를 쓰지 않는다.** `CursorPage`는 다른 목록 API(저장소 등록 요청 등)를 위한 별도 제네릭이다.
- 따라서 `RepositoryWorkspace.tsx:25`의 지역 선언이 실제와 맞다. 계약 패키지가 틀린 것이 아니라 **서로 다른 응답 유형**이다. 이 구분을 문서에 남긴다.

`relation`이 `gte`가 되는 조건은 명확하다. `track_total_hits`를 **10,000**으로 잡으므로 그보다 많으면 정확히 세지 않고 `gte`로 근사한다(`search/service.ts:63-70`). 수백만 건을 정확히 세는 비용이 "62건"과 "1만 건 이상"의 차이만큼 가치 있지 않다는 판단이다.

항목의 모양은 다음과 같다(`search/service.ts:114-149`).

```ts
interface SearchItem {
  kind: 'pull_request' | 'commit';
  repository: string | null;
  pr_number?: number;            // PR 항목에만
  commit_sha?: string;           // 커밋 항목에만
  title: string | null;
  author: string | null;
  state: string | null;
  merge_seq: number | null;
  seq_epoch: number | null;
  sequence_space: string | null; // "owner/repo@branch"
  merged_at: string | null;      // ISO 8601
  changed_files_count: number | null;
  additions: number | null;
  deletions: number | null;
  labels: string[];
  link_summary: Record<string, unknown> | null;
  url: string | null;
  highlight?: HighlightMap;      // 자유 텍스트 검색일 때만. 평문과 구간이며 마크업이 아니다

  // M 번호 네 키 — PR 항목에만 붙고, 기능이 꺼진 배포에서는 키 자체가 없다
  merge_number?: string | null;
  merge_number_state?: string;
  merge_number_reason?: string | null;
  merge_number_epoch?: number | null;
  merge_number_projection_state?: string;   // 운영 관측용. 화면이 읽지 않는다
}
```

**`null`과 키 없음을 구별한다.** `merge_number_state` 키가 없는 것은 "기능이 꺼져 있거나 구버전 응답"이고, 값이 `null`인 것과 다르다. 화면은 키가 없으면 M 영역을 아예 그리지 않는다.

`highlight`도 같다. 일치가 없으면 **키 자체가 없다.** 빈 객체는 "강조가 없다"가 아니라 "계산했는데 아무것도 없었다"로 읽힌다.

facet 세 키는 함께 나타나거나 함께 빠진다(`search/routes.ts:508`).

### 3.3 `epoch_stale` 응답

`seq:` 인용의 에폭이 낡았으면 서버는 **조회를 실행하지 않고** 다음 모양을 200으로 돌려준다(`search/routes.ts:419-434`).

```json
{
  "query": "…",
  "parsed": { },
  "sequence_context": { },
  "requested_seq_epoch": 2,
  "epoch_stale": true,
  "next_cursor": null,
  "correlation_id": "…"
}
```

**`items`·`total`·`facets`·`relaxation_hints` 키를 넣지 않는다.** 계산하지 않은 것을 빈 값으로 채우면 "구간이 비었다"로 읽힌다.

화면은 `epoch_stale`을 보면 즉시 오류를 던진다(`RepositoryWorkspace.tsx:176`): `The sequence epoch changed. Check your filters and try again.`

### 3.4 오류

| 상태 | code | 언제 |
|---|---|---|
| 400 | `INVALID_PARAMETER` | 지원하지 않는 정렬 키. `detail.supported_keys` 포함 |
| 400 | 파서가 주는 코드 | 질의 문법·값 오류. `detail`에 오프셋과 `supported_keys` |
| 400 | 커서 오류 코드 | 커서를 쓸 수 없다. **서버 잘못이 아니므로 4xx다** |
| 401 | `UNAUTHENTICATED` | 세션 없음·만료. `detail.login_path` 포함 |
| 503 | `PERMISSION_UNAVAILABLE` | 접근 범위를 확인할 수 없다. **빈 목록이 아니라 명시적 실패다** |
| 504 | `SEARCH_TIMEOUT` | 한 인덱스가 통째로 빠진 부분 결과. 200으로 내보내지 않는다 |

오류 본문의 공통 모양은 다음과 같다(`packages/contracts/src/responses.ts:12-20`).

```ts
interface ErrorResponse {
  error: { code: string; message: string; detail?: Record<string, unknown> };
  correlation_id: string;
}
```

**주의**: `search-api`의 `message`는 **한국어**다(예: `지원하지 않는 정렬 키입니다: 'foo'`). pr-search 화면은 `serviceMessage`로 한글 메시지를 걸러 내고 영어 기본 문구로 바꾼다(`PURE_LOGIC_REFERENCE.md` 3.5장). PIPE가 한국어 UI를 쓴다면 이 판정을 뒤집어야 하며, 그 변경을 차이표에 남긴다.

## 4. `GET /api/resolve` — 식별자 해석

upstream은 `/api/v1/resolve`다(`resolve/routes.ts:27`).

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `q` | 사실상 필수 | `''` | 해석할 식별자 문자열 |
| `limit` | 아니오 | **10** | 1 미만이거나 정수가 아니면 기본값. 상한까지 절삭 |
| `repository` | 아니오 | 없음 | 저장소 힌트. `owner/name` 형식이 아니면 무시된다 |

**화면은 `limit=50`을 반드시 명시한다**(`search-fetch.ts:25-27`). 서버 기본값 10을 그대로 쓰면 11건에서 절삭 표시가 떠, 정해진 50 경계와 어긋난다.

```ts
function resolveUrl(input: string): string {
  return `/api/resolve?q=${encodeURIComponent(input)}&limit=50`;
}
```

성공 응답(`resolve/routes.ts:200-215`):

```ts
interface ResolveResponse {
  input: string;
  detected_kind: string;
  candidates: ResolutionCandidate[];
  truncated: boolean;
  // 0건일 때만 붙는다
  reason_code?: string;
  hint?: string;          // 한국어 문자열이다
  correlation_id: string;
}

interface ResolutionCandidate {
  kind: 'commit' | 'pull_request';
  repository: string | null;
  display_name: string | null;
  url: string | null;
  commit_sha?: string;
  pr_number?: number;
  state?: string;
  author?: string;
  merge_seq: number | null;
  seq_epoch: number | null;
  sequence_space: string | null;
}
```

**0건은 오류가 아니다.** HTTP 200에 빈 배열과 사유 코드를 싣는다. 404로 만들면 "없다"와 "못 본다"가 섞이고 화면이 저장소 등록 상태를 안내할 자리를 잃는다.

판별기가 입력을 거절하면(7자 미만 hex 등) **조회하지 않고 400**이다. 응답의 `detail`에 `min_length`와 `actual_length`가 실린다(`resolve/routes.ts:176-188`). 화면도 같은 판별기를 쓰므로 정상 경로에서는 이 요청 자체가 나가지 않는다.

### 4.1 화면이 후보를 행으로 바꾸는 방법

`RepositoryWorkspace.tsx:177`은 후보를 결과 표의 행 모양으로 변환한다.

```ts
{
  ...candidate,
  title: candidate.display_name,
  author: candidate.author ?? null,
  state: candidate.state ?? null,
  merged_at: null,              // 후보에는 없다. null로 채운다
  changed_files_count: null,
  additions: null,
  deletions: null,
}
```

그리고 total을 직접 만든다.

```ts
total: { value: candidates.length, relation: truncated ? 'gte' : 'eq' }
```

**해석 경로에는 cursor가 없다.** `next_cursor` 키가 없으므로 무한 스크롤도 동작하지 않는다. 이것이 두 경로의 큰 차이다.

## 5. `GET /api/repositories` — 저장소 목록

upstream은 `/api/v1/repositories`다(`repositories/routes.ts:37`).

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `limit` | 아니오 | 서버 기본값 | **1~100의 정수.** 벗어나면 400 `INVALID_PARAMETER`, `detail.field = 'limit'` |
| `cursor` | 아니오 | 없음 | 서명된 불투명 문자열. 지문이 맞지 않으면 거절된다 |

화면은 `limit=100`을 쓴다(`RepositoryWorkspace.tsx:125`).

```ts
interface RepositoriesResponse {
  items: RepositoryOverview[];
  next_cursor: string | null;
}

interface RepositoryOverview {
  repository_id: number;
  repository: string;                 // "owner/name"
  registration_state: string;
  registered_at: string;
  last_ingested_at: string | null;
  document_counts: DocumentCountsView | null;
  backfill: BackfillView | null;
  sequence_spaces: SequenceSpaceView[];
  reconciliation: { last_completed_at: string | null; missing_count: number | null };
  unavailable: string[];
}

interface SequenceSpaceView {
  base_branch: string;
  last_sequence: number | null;
  seq_epoch: number | null;
  sequence_state: string;
  last_assigned_at: string | null;
}
```

**Search 화면이 실제로 쓰는 필드는 셋뿐이다**: `repository_id`(중복 제거용), `repository`(표시와 값), `sequence_spaces[].base_branch`(브랜치 선택지). 나머지는 다른 화면(W-009 저장소 개요)의 것이다. fixture는 나머지를 최소 모양으로만 채워도 된다.

### 5.1 빈 페이지 문제

접근 범위 필터 때문에 **항목이 하나도 없는 페이지가 나올 수 있다.** 화면은 이것을 이렇게 다룬다(`RepositoryWorkspace.tsx:122-134`).

```text
next = 현재 cursor
for page in 0..19:                                 # 최대 20페이지
    응답 = GET /api/repositories?limit=100[&cursor=next]
    401이면 -> unauthorized 상태로 전환하고 중단
    ok가 아니면 -> "Unable to load repositories." 오류
    항목을 repository_id 기준으로 중복 제거하며 이어 붙인다
    next = 응답.next_cursor ?? null
    if 응답.items가 비어 있지 않거나 next가 없으면 -> 중단
```

**20페이지라는 상한이 있다.** 그보다 더 많은 빈 페이지가 이어지면 목록이 비어 보인다. 이 한계를 PIPE에서도 유지한다. 무한 루프를 만들지 않는 장치다.

첫 조회인지 이어 보기인지는 `repoNext`로 가른다. `repoNext`가 있으면 기존 목록 뒤에 붙이고, 없으면 처음부터 다시 만든다(`:130`).

## 6. `GET /api/source/{repository}/{operation}` — 소스 탐색

upstream은 `/api/v1/source/:repository/{tree|history|file|diff}`다(`source/routes.ts:19`).

네 operation이 **같은 라우트 틀**을 공유하므로 검증도 공통이다.

### 6.1 공통 검증 (`source/routes.ts:29-40`)

```text
repository가 /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/ 에 맞지 않으면 400
owner나 name이 '.' 또는 '..'이면 400
저장소가 접근 범위에 없으면 404 NOT_FOUND   (미등록과 권한 밖을 같은 404로 만든다)
path, ref, revision, tree_sha, commit 중 문자열이 아닌 것이 있으면 400
path가 validPath를 통과하지 못하면 400
ref가 있는데 validRef를 통과하지 못하면 400
page가 정수가 아니거나 1 미만 또는 1000 초과면 400
revision이 있는데 40자 hex가 아니면 400
tree_sha가 있는데 40자 hex가 아니거나 revision이 함께 없으면 400
```

응답 헤더는 항상 `cache-control: private, no-store`, `pragma: no-cache`, `x-content-type-options: nosniff`다. **소스 내용은 캐시하지 않는다.**

### 6.2 `tree`

| 이름 | 필수 | 설명 |
|---|---|---|
| `ref` | 루트 조회에서 사실상 필수 | 브랜치 이름 |
| `path` | 하위 조회에서 | 펼칠 디렉터리 경로 |
| `tree_sha` | `path`가 있으면 **필수** | 그 디렉터리의 tree SHA(40자 hex) |
| `revision` | `tree_sha`가 있으면 **필수** | 40자 hex |

`path`는 있는데 `tree_sha`가 없으면 400 `Expanding a directory requires its tree SHA and revision.`

```ts
interface SourceTree {
  repository: string;
  ref: string;
  revision: string;      // 이 응답이 가리키는 실제 커밋. 고정에 쓴다
  path: string;
  entries: SourceEntry[];
  truncated: boolean;
}
interface SourceEntry {
  path: string;
  name: string;
  sha: string;           // 디렉터리면 tree SHA. 펼칠 때 이 값을 보낸다
  kind: 'directory' | 'file' | 'symlink' | 'submodule';
  size: number | null;
}
```

### 6.3 `history`

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `path` | 아니오 | `''` | 비우면 저장소 전체 이력 |
| `ref` | 아니오 | `''` | 브랜치 또는 **고정된 revision** |
| `page` | 아니오 | `1` | 1~1000 |

```ts
interface SourceHistory {
  repository: string;
  revision: string;                // 이 조회가 고정한 커밋
  path: string;
  commits: SourceHistoryCommit[];
  next_page: number | null;        // 없으면 마지막
  pull_requests_unavailable?: boolean;
}
interface SourceHistoryCommit {
  sha: string;
  parents: string[];
  message: string;
  author: string;
  date: string | null;
  /** 배열이면(빈 배열 포함) 확정, null이면 아직 미확정 */
  pull_request_numbers: number[] | null;
}
```

`pull_request_numbers`의 **세 상태를 반드시 구별한다.** 배열에 값이 있으면 연결된 PR, 빈 배열이면 "연결이 없음이 확정", `null`이면 "아직 모름"이다. `null`을 "연결 없음"으로 표시하면 거짓이 된다.

`pull_requests_unavailable`은 PR 연결 배치 조회 자체가 안 될 때 붙는다. 이력 표는 계속 쓸 수 있다.

### 6.4 `file`

| 이름 | 필수 | 설명 |
|---|---|---|
| `path` | **필수** | 없으면 400 |
| `revision` | **필수** | 40자 전체 SHA여야 한다. 축약 SHA는 400 |

```ts
interface SourceFile {
  repository: string;
  revision: string;
  path: string;
  status: 'text' | 'missing' | 'binary' | 'too_large' | 'unsupported';
  text: string | null;      // status가 'text'일 때만 내용이 있다
  size: number | null;
  sha: string | null;
  reason: string | null;    // text가 아닐 때 사람이 읽는 사유
}
```

화면은 `status !== 'text'`이면 코드를 그리지 않고 `reason`을 보인다. **빈 코드 영역을 실제 소스인 것처럼 보이지 않는다.**

### 6.5 `diff`

| 이름 | 필수 | 설명 |
|---|---|---|
| `pr` 또는 `commit` | **정확히 하나** | 둘 다 주거나 둘 다 없으면 400 |
| `pr` | | 1 이상 2147483647 이하의 정수 |
| `commit` | | 40자 전체 SHA |
| `page` | 아니오 | 1~**30**. 다른 operation의 1000보다 낮다 |

```ts
interface SourceComparison {
  repository: string;
  base: string | null;      // null이면 빈 트리(최초 커밋)
  head: string;
  commit: SourceCommit;
  files: SourceChange[];
  next_page: number | null;
  truncated: boolean;       // GitHub의 파일 수 상한에 걸렸다
  pull_requests: { number: number; title: string; body: string | null }[];
  pull_requests_unavailable?: boolean;
}
interface SourceChange {
  path: string;
  previous_path: string | null;   // rename일 때만
  status: string;                 // 'added' | 'removed' | 'modified' | 'renamed' 등
  additions: number;
  deletions: number;
}
interface SourceCommit {
  sha: string; parents: string[]; message: string; author: string; date: string | null;
}
```

### 6.6 source 계열의 오류

| 상태 | code | 언제 |
|---|---|---|
| 400 | `INVALID_PARAMETER` | 위의 공통 검증 위반 |
| 401 | `UNAUTHENTICATED` | 세션 없음·만료 |
| 404 | `NOT_FOUND` | 저장소가 접근 범위 밖이거나 미등록, 또는 GitHub 객체 없음 |
| 409 | `SOURCE_CHANGED` | 분석 중 PR이 바뀌었다 |
| 429 | `SOURCE_RATE_LIMITED` | GitHub 속도 제한. `retry-after` 헤더가 붙을 수 있다 |
| 503 | `PERMISSION_UNAVAILABLE` | 접근 권한을 확인할 수 없다 |
| 503 | `SOURCE_PERMISSION_REQUIRED` | GitHub App에 Contents read 권한이 없다 |
| 502 | `SOURCE_UNAVAILABLE` | 그 밖의 upstream 실패 |

**upstream 오류 문자열을 그대로 내보내지 않는다.** 응답 조각이 섞여 있을 수 있기 때문이다(`source/routes.ts:70`). PIPE에서도 같은 원칙을 지킨다.

화면 쪽 오류 문구 규칙은 `source/api.ts:10-14`다.

```text
401              -> "Your session expired. Sign in again to continue."
404              -> serviceMessage(본문 메시지, "Source browsing is unavailable for this repository or revision.", 코드)
그 외 실패       -> serviceMessage(본문 메시지, "Unable to load source. Try again.", 코드)
```

## 7. `GET /api/pull-requests/{repository}/{pr}` 와 `GET /api/commits/{repository}/{sha}`

upstream은 `/api/v1/pull-requests/:repository/:pr_number`와 `/api/v1/commits/:repository/:commit_sha`다(`resolve/routes.ts:28-29`).

행 상세가 읽는 필드는 다음과 같다(`RepositoryWorkspace.tsx:26`과 `resolve/detail.ts`의 조립부).

```ts
interface DetailResponse {
  // PR
  body?: string;
  base_branch?: string;
  head_branch?: string;
  merge_commit_sha?: string | null;
  source_commits?: { commit_sha: string; /* 표시용 메타가 더 붙는다 */ }[];
  source_commits_truncated?: boolean;
  source_commits_total?: number;        // truncated가 아닐 때만
  changed_paths?: string[];
  files_truncated?: boolean;

  // 커밋
  message?: string;
  changed_paths_truncated?: boolean;
}
```

**세 가지 상태를 구별한다.**

| 상태 | 응답 | 화면 |
|---|---|---|
| 아직 수집하지 않았다 | `changed_paths` 키 자체가 없다 | `The file list has not been collected yet.` |
| 정말 변경이 없다 | `changed_paths: []` | `No changed files.` |
| 일부만 있다 | `files_truncated: true` 또는 `changed_paths_truncated: true` | `Only some files are shown. View all changes in GHE.` |

`source_commits`는 최대 **250개**다(`resolve/detail.ts:291`, `:379`). 그보다 많으면 `source_commits_truncated: true`가 붙고, 그때는 `source_commits_total`을 넣지 않는다. "더 있다"만 말하고 정확히 몇 개인지는 말하지 않는다.

화면은 `merge_commit_sha`를 **목록 맨 앞**에 놓고 `source_commits`를 뒤에 잇는다(`RepositoryWorkspace.tsx:66`).

## 8. 질의 문법 — 화면이 실제로 만드는 것

`buildRepositoryQuery`가 만드는 토큰은 여덟 가지다. 전체 알고리즘과 검증 벡터는 `PURE_LOGIC_REFERENCE.md` 1장에 있다.

| 토큰 | 예 | 의미 |
|---|---|---|
| `kind:` | `kind:pull_request`, `kind:commit` | 문서 유형. 탭이 정한다 |
| `repo:` | `repo:"demo/modem"` | 저장소. 항상 인용된다 |
| `base:` | `base:"main"` | base 브랜치 |
| `author:` | `author:"dev-a"` | 작성자 |
| `label:` | `label:"area/phy"` | 라벨 |
| `path:` | `path:"src/phy"` | 경로 |
| `is:` | `is:merged`, `is:open`, `is:closed` | 상태. **인용하지 않는다** |
| `merged:` | `merged:2026-01-01..2026-02-01` | 병합일 범위 |
| `pr_number:` | `pr_number:1842..2044` | PR 번호 범위 |
| `mnum:` | `mnum:42..80` | M 번호 범위. `base:`가 있어야 뜻이 있다 |
| `seq:` | `seq:42..80` | first-parent 머지 서수 범위 |
| (자유 텍스트) | `NR measurement` | 인용하지 않고 맨 뒤에 붙는다 |

### 8.1 날짜 범위의 형식·경계·시간대 (확인 완료)

전부 소스에서 확인했다.

**받는 형식**(`packages/query/src/parse.ts:47-49`, `:62-84`):

```text
RANGE_SEPARATOR = '..'
DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/
```

날짜만 주는 형태와 시각까지 주는 형태를 **둘 다** 받는다. 둘 중 어느 쪽에도 맞지 않으면 `Invalid date format: '…' (for example: 2026-08-10 or 2026-08-10T05:02:11Z)`로 거절한다.

형식이 맞아도 **실재하지 않는 날짜는 다시 거절한다.** `Date.parse('2026-02-30')`은 3월 2일로 넘어가 `NaN` 검사에 걸리지 않으므로, 파서는 `Date.UTC`로 만든 값을 되읽어 년·월·일이 그대로인지 확인한다. 어긋나면 `Invalid calendar date: '…'`다.

**양쪽 경계가 모두 필수다**(`parse.ts:96-104`). 열린 범위(`merged:2026-01-01..`)는 지어내지 않고 `Both range bounds are required: '…' (for example: 1200..1350)`로 거절한다. 이것이 화면이 한쪽만 채운 범위를 질의에 싣지 않는 이유다.

**경계 포함 여부**(`packages/es/src/query-builder.ts:388-394`):

```ts
function rangeClause(filter) {
  const field = RANGE_FIELDS[filter.key];
  if (field === undefined) return null;
  // 양끝을 모두 포함한다 -- `seq:1280..1342`는 1280과 1342를 포함한다.
  return { range: { [field]: { gte: filter.from, lte: filter.to } } };
}
```

**`gte`와 `lte`이므로 양쪽 경계를 모두 포함한다.** 이 규칙은 `merged:`, `created:`, `seq:`, `pr_number:`, `mnum:` 등 모든 범위 키에 똑같이 적용된다.

**시간대**: 이 절에는 `time_zone` 파라미터가 **없다.** Elasticsearch의 `range` 질의는 `time_zone`이 없으면 날짜 문자열을 **UTC로 해석한다.** 따라서 실제 의미는 이렇다.

```text
merged:2026-01-01..2026-02-01
  → merged_at >= 2026-01-01T00:00:00Z  AND  merged_at <= 2026-02-01T00:00:00Z
```

**여기서 주의할 결과가 하나 나온다.** `to` 경계가 그 날의 **시작**이므로, 2026-02-01 00:00:00Z 이후에 병합된 PR은 **결과에서 빠진다.** "2월 1일까지"라고 읽히는 입력이 실제로는 "2월 1일 0시까지"다. 한국 시간대 사용자에게는 더 어긋나 보인다. 달력에서 `2026-02-01`을 고른 사람은 한국 시간 2월 1일 오전 9시 전까지만 받게 된다.

**이것은 원본의 동작이며 이번 포팅에서 바꾸지 않는다.** 서버 계약을 바꾸는 일이기 때문이다. 대신 다음 두 가지를 지킨다.

1. **클라이언트가 날짜 문자열을 변환하지 않는다.** 선택기가 만든 로컬 달력 `YYYY-MM-DD`를 그대로 싣는다(`primitives.tsx:44-46`, `repository-search.ts:30`). UTC로 옮기면 하루씩 밀린다.
2. **클라이언트가 결과를 다시 거르지 않는다.** 경계 판정은 서버의 것이다.

날짜 범위 필드에 `Merged after`(포함) / `Merged before`(포함, 그날 0시 기준)라는 사실을 helper text로 알리는 것은 화면 문구의 개선이므로 허용한다. 질의 값을 바꾸는 것이 아니기 때문이다.

## 9. UI 데이터 포트

아래 이름은 `PORT_DECISION`이다. **기존 서버 endpoint 이름이 아니다.** fixture client와 실제 client는 같은 인터페이스를 만족해야 한다.

```ts
interface SearchDataPort {
  listRepositories(
    args: { limit: number; cursor?: string | null },
    signal?: AbortSignal,
  ): Promise<{ items: RepositoryOverview[]; next_cursor: string | null }>;

  searchChanges(
    args: {
      q: string;
      sort: SortKey;
      order: 'asc' | 'desc';
      size: number;
      cursor?: string | null;
      facets: boolean;
      seqEpoch?: number | null;
    },
    signal?: AbortSignal,
  ): Promise<SearchResponse>;

  resolveIdentifier(
    args: { q: string; limit: number; repository?: string },
    signal?: AbortSignal,
  ): Promise<ResolveResponse>;

  getPullRequest(
    args: { repository: string; prNumber: number },
    signal?: AbortSignal,
  ): Promise<DetailResponse>;

  getCommit(
    args: { repository: string; sha: string },
    signal?: AbortSignal,
  ): Promise<DetailResponse>;

  getSourceTree(
    args: { repository: string; ref?: string; path?: string; treeSha?: string; revision?: string },
    signal?: AbortSignal,
  ): Promise<SourceTree>;

  getPathHistory(
    args: { repository: string; path?: string; ref?: string; page?: number },
    signal?: AbortSignal,
  ): Promise<SourceHistory>;

  getSourceFile(
    args: { repository: string; path: string; revision: string },
    signal?: AbortSignal,
  ): Promise<SourceFile>;

  getDiffMetadata(
    args: { repository: string; pr?: number; commit?: string; page?: number },
    signal?: AbortSignal,
  ): Promise<SourceComparison>;
}
```

**`resolveMergeNumber`를 넣지 않는다.** 1차 지시서가 "실제 필요와 원본 계약 확인 후 확정"하라고 한 메서드인데, 확인 결과 기본 `/search` 화면은 M 진입을 처리하지 않으므로(`PD-001`) 이번 범위에 필요한 호출이 없다. 나중에 진입 처리를 구현할 때 추가한다.

### 9.1 실패의 모양

모든 메서드는 실패 시 다음 오류를 던진다. 상태 코드와 서버 코드를 보존한다.

```ts
class SearchPortError extends Error {
  readonly status: number;          // HTTP 상태
  readonly code: string | null;     // 서버의 error.code
  readonly detail: Record<string, unknown> | null;
  readonly correlationId: string | null;
}
```

화면이 상태별로 다르게 반응해야 하기 때문에 이 정보를 잃으면 안 된다. 401은 세션 안내, 400 커서 오류는 첫 페이지 복구, 503은 권한 확인 실패 안내로 각각 갈린다.

**미설정 client의 동작을 명시한다.** 실제 client가 아직 설정되지 않았으면(`baseUrl`이 없다) 모든 메서드가 즉시 다음을 던진다.

```ts
new SearchPortError('검색 연결이 설정되지 않았습니다.', { status: 0, code: 'NOT_CONFIGURED' })
```

**인증을 끄거나 공용 서비스 계정으로 조회하지 않는다.** 장애가 났을 때 fixture로 조용히 내려가지도 않는다. 그 전환은 사용자가 거짓 데이터를 진짜로 믿게 만든다.

### 9.2 취소

모든 메서드가 `AbortSignal`을 받는다. transport가 취소를 지원하지 않으면 **요청 세대 번호**로 같은 보호를 만든다.

```text
generation = 0

요청 시작:  const my = ++generation
응답 도착:  if (my !== generation) return;   // 늦게 온 응답을 버린다
```

원본이 `AbortController`로 하는 일과 결과가 같다. 어느 쪽이든, 새 문맥을 요청한 동안 이전 저장소의 결과가 새 머리글 아래 나타나면 안 된다.

## 10. 호스트 주입 계약

```ts
interface PipePrSearchContentProps {
  /** 9장의 데이터 포트. fixture client도 실제 client도 이 모양이다 */
  client: SearchDataPort;

  /** 확인된 identity, 또는 미설정·불가 상태 */
  searchIdentity:
    | { kind: 'ready'; gheLogin: string; cacheKey: string }
    | { kind: 'unavailable' }      // 확인할 수 없다
    | { kind: 'unconfigured' };    // 아직 연결하지 않았다

  /** 현재 query 읽기, 갱신, URL 만들기, 되돌아가기 */
  navigation: {
    getQuery(): URLSearchParams;
    replace(next: URLSearchParams): void;   // 기본. 이력에 쌓지 않는다
    push(next: URLSearchParams): void;
    buildUrl(next: URLSearchParams): string;
    subscribe(listener: () => void): () => void;
  };

  /** 고정된 '/search' 대신 호스트가 정한 경로. 예: '/pr-search' */
  routeBase: string;

  /** GHE 원문 링크를 만들 때 쓴다. 없으면 외부 링크를 만들지 않는다 */
  externalSourceBase?: string;

  /** 높이·폭·여백의 소유권 */
  layout?: {
    padding?: 'self' | 'host';   // 기본 'self'
    height?: 'bounded' | 'auto'; // 기본은 부모를 보고 정한다
  };

  /** 연결이 필요할 때 호스트에 알린다. 인증 자체를 구현하지 않는다 */
  onConnectionRequired?: (reason: 'unauthenticated' | 'unconfigured') => void;
}
```

### 10.1 캐시 key 규칙

React Query의 key에 **토큰·쿠키·개인 credential을 넣지 않는다.** identity를 구별할 필요는 있으므로 `searchIdentity.cacheKey`를 쓴다. 이 값은 호스트가 만드는 **불투명하고 되돌릴 수 없는 식별값**이며 사용자 이름이나 토큰이 아니다.

```text
['pr-search', identityCacheKey, 'search',      q, sort, order, size, facets, seqEpoch]
['pr-search', identityCacheKey, 'repositories', limit]
['pr-search', identityCacheKey, 'detail',      kind, repository, id]
['pr-search', identityCacheKey, 'source-tree', repository, ref, path, treeSha, revision]
['pr-search', identityCacheKey, 'history',     repository, path, ref, page]
['pr-search', identityCacheKey, 'file',        repository, path, revision]
['pr-search', identityCacheKey, 'diff',        repository, pr, commit, page]
```

identity가 바뀌면 호스트가 `cacheKey`를 바꾸고, 그것만으로 이전 사용자의 캐시가 조회되지 않는다. 추가로 진행 중인 요청을 취소하도록 요청한다. **실제 신원 확인은 UI가 하지 않는다.**

### 10.2 query별 정책

React Query의 기본 자동 동작이 원본의 규칙을 깨뜨릴 수 있으므로 query마다 명시한다.

| query | `retry` | `refetchOnWindowFocus` | 비고 |
|---|---|---|---|
| 검색 첫 페이지 | `false` | `false` | 원본은 자동 재시도를 하지 않는다 |
| 검색 이어 보기 | `false` | `false` | **특히 중요하다.** 켜면 CR-043의 무자동재시도 규칙이 깨진다 |
| 저장소 목록 | `false` | `false` | 실패는 명시적 `Try again` |
| 행 상세 | `false` | `false` | 실패는 그 행 안의 `Try again` |
| source tree | `false` | `false` | 실패는 노드별 `Retry` |
| history | `false` | `false` | 고정 revision이 조용히 바뀌면 안 된다 |
| file / diff | `false` | `false` | 조사 중 스냅숏이 바뀌면 안 된다 |

`staleTime`은 길게 잡는다. 조사 도구에서 사용자가 창을 다시 볼 때마다 결과가 바뀌면 방금 본 것과 지금 보는 것이 달라진다.

## 11. fixture와 실제 연결의 경계

| 항목 | 규칙 |
|---|---|
| fixture 표시 | fixture client로 도는 화면에는 항상 `Demo data · 실제 API 미연결` 표시를 보인다 |
| 자동 전환 | **금지한다.** 실제 client가 실패해도 fixture로 내려가지 않는다 |
| 인증 우회 | **금지한다.** 인증을 끄거나 서비스 계정으로 조회하지 않는다 |
| 완료 판정 | fixture 기반 UI 검증과 실제 연동을 **별개의 완료 상태**로 관리한다 |
| 데이터 | 실제 회사 코드, 사용자 이름, 비공개 PR 본문, 토큰을 복사하지 않는다 |
