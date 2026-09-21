# PURE_LOGIC_REFERENCE — 옮겨야 할 순수 로직

> 분류: 인수인계 자료 · 기준 SHA `da0ed9b5bd8fac59c7fcf02c593f69962468be4d`

이 문서는 pr-search 저장소 전체의 복사본이 아니다. PIPE에서 **다시 구현해야 하는 순수 함수**만 골라, 알고리즘·상수·입출력·검증 벡터를 완결된 단위로 담았다. PIPE 담당 세션은 `@prs/*` workspace 패키지를 import할 수 없으므로(다른 저장소에 있다), 아래 내용만으로 같은 동작을 만들어야 한다.

옮길 때 Next.js, Node 전용 API, `server-only`, Redis, 데이터베이스 의존이 따라 들어오지 않게 한다. 아래 함수는 전부 브라우저에서 도는 순수 함수다.

## 0. 이식 목록 요약

| 모듈 | 원본 위치 | 외부 의존 | PIPE에서 |
|---|---|---|---|
| 질의 생성기 | `apps/web/lib/repository-search.ts` | 없음 | 그대로 다시 구현 |
| SHA 범위 판정 | 같은 파일 | 없음 | 그대로 다시 구현 |
| 조회 경로 선택 | `apps/web/lib/search-fetch.ts` | `@prs/query` | 3장과 함께 다시 구현 |
| 식별자 판별·질의 파서 | `packages/query/src/` | 없음 | 3장 |
| M 번호 표시 판정 | `apps/web/lib/merge-number.ts` | 없음 | 그대로 다시 구현 |
| 표시 포맷 | `apps/web/lib/format.ts` | 없음 | 그대로 다시 구현 |
| 서버 문구 처리 | `apps/web/lib/service-message.ts` | 없음 | 그대로 다시 구현 |
| 줄·단어 diff, 줄 추적 | `apps/web/lib/source-analysis.ts` | **npm `diff`** | 5장 — 의존성 확인이 필요하다 |

## 1. 질의 생성기와 정렬

원본 전문과 다섯 가지 규칙은 `SOURCE_EVIDENCE.md` 4장에 있다. 여기에는 검증 벡터만 둔다.

### 1.1 `buildRepositoryQuery` golden 벡터

각 행의 `serialized`는 URL query string, 결과는 `/api/search`의 `q` 값이다.

| # | 입력 | 결과 |
|---|---|---|
| 1 | `repository='demo/modem'`, `tab='search'`, `serialized=''` | `kind:pull_request repo:"demo/modem"` |
| 2 | `tab='history'`, 나머지 같음 | `kind:commit repo:"demo/modem"` |
| 3 | `serialized='base=main&author=dev-a'` | `kind:pull_request repo:"demo/modem" base:"main" author:"dev-a"` |
| 4 | `serialized='state=merged'` | `kind:pull_request repo:"demo/modem" is:merged` |
| 5 | `tab='open'`, `login='dev-x'`, `serialized='author=dev-a&state=closed'` | `kind:pull_request repo:"demo/modem" author:"dev-x" is:open` — 사용자가 넣은 `author`와 `state`가 **버려진다** |
| 6 | `tab='merged'`, `login='dev-x'` | `kind:pull_request repo:"demo/modem" author:"dev-x" is:merged` |
| 7 | `serialized='from=2026-01-01&to=2026-02-01'` | `… merged:2026-01-01..2026-02-01` |
| 8 | `serialized='from=2026-01-01'` (한쪽만) | 범위가 **빠진다**: `kind:pull_request repo:"demo/modem"` |
| 9 | `serialized='pr_from=10&pr_to=20'` | `… pr_number:10..20` |
| 10 | `serialized='mnum_from=5&mnum_to=9'` | `… mnum:5..9` |
| 11 | `serialized='base=main'`, `seqRange={space:'demo/modem@main', range:'42..80'}` | `… base:"main" seq:42..80` |
| 12 | `serialized='base=develop'`, `seqRange={space:'demo/modem@main', …}` | `seq:`가 **빠진다** — 공간 불일치 |
| 13 | `serialized=''`, `seqRange={space:'demo/modem@', range:'1..5'}` | `… seq:1..5` — base가 빈 값이면 공간 문자열도 `demo/modem@`이므로 일치한다 |
| 14 | `serialized='q=NR%20measurement'` | `kind:pull_request repo:"demo/modem" NR measurement` — 자유 텍스트는 **인용하지 않고** 맨 뒤에 붙는다 |
| 15 | `serialized='q=%20%20'` (공백만) | 자유 텍스트가 **빠진다** — `trim()` 후 빈 문자열 |
| 16 | `repository='demo/mo"dem'` | `repo:"demo/mo\"dem"` — `JSON.stringify` 이스케이프 |
| 17 | `serialized='path=src/phy'` | `… path:"src/phy"` |
| 18 | `serialized='label=area%2Fphy'` | `… label:"area/phy"` |
| 19 | 모두 채움: `base=main&author=dev-a&label=phy&path=src&state=merged&from=A&to=B&pr_from=1&pr_to=2&mnum_from=3&mnum_to=4&q=txt` (+ 일치하는 `seqRange`) | `kind:pull_request repo:"demo/modem" base:"main" author:"dev-a" label:"phy" path:"src" is:merged merged:A..B pr_number:1..2 mnum:3..4 seq:42..80 txt` — **순서가 이것과 정확히 같아야 한다** |

키 순회 순서는 `['base', 'author', 'label', 'path', 'state']`로 고정되어 있다. 질의 문자열은 캐시 key의 일부이므로 순서가 바뀌면 같은 조건이 다른 key가 된다.

### 1.2 `repositorySort`

```text
repositorySort(tab, supplied) = supplied ?? (tab === 'history' ? 'merge_seq' : 'pr_number')
```

| tab | supplied | 결과 |
|---|---|---|
| `search` | `null` | `pr_number` |
| `history` | `null` | `merge_seq` |
| `open` | `null` | `pr_number` |
| `merged` | `null` | `pr_number` |
| 아무거나 | `'merged_at'` | `merged_at` |
| 아무거나 | `''` (빈 문자열) | `''` — **빈 문자열은 `??`를 통과한다.** URL에 `sort=`가 있으면 빈 값이 그대로 전달된다 |

### 1.3 `deriveInitialRangeType`

```text
deriveInitialRangeType(serialized):
  values = URLSearchParams(serialized)
  if values.get('pr_from') or values.get('pr_to')   -> 'pr'
  if values.get('mnum_from') or values.get('mnum_to') -> 'mnum'
  if values.get('from') or values.get('to')          -> 'date'
  return 'pr'
```

`seq`는 절대 반환되지 않는다. merge-order 범위가 URL에 남지 않기 때문이다(`PD-010`).

| 입력 | 결과 |
|---|---|
| `''` | `pr` |
| `'pr_from=1'` | `pr` |
| `'mnum_to=9'` | `mnum` |
| `'from=2026-01-01'` | `date` |
| `'mnum_from=5&from=2026-01-01'` | `mnum` — 검사 순서가 이긴다 |
| `'q=abc'` | `pr` |

### 1.4 `repositoryLabelOptions`

```text
repositoryLabelOptions(current, facets):
  values = [current, ...facets.map(f => f.value)].filter(Boolean)
  return [{ value: '', label: 'All labels' },
          ...new Set(values).map(v => ({ value: v, label: v }))]
```

현재 적용된 값이 **맨 앞**에 온다. facet에 없는 값이라도 선택 상태가 유지되도록 하기 위함이다.

| current | facets | 결과 |
|---|---|---|
| `''` | `[]` | `[All labels]` |
| `'phy'` | `[]` | `[All labels, phy]` |
| `'phy'` | `[{value:'phy'},{value:'l1'}]` | `[All labels, phy, l1]` — 중복이 제거된다 |
| `''` | `[{value:'l1'},{value:'phy'}]` | `[All labels, l1, phy]` |

### 1.5 `buildShaRangeFilter`

```text
singleCommit(candidates):
  commits = candidates.filter(c => c.kind === 'commit')
  return commits.length === 1 ? commits[0] : null

buildShaRangeFilter({ repository, base, fromCandidates, toCandidates }):
  from = singleCommit(fromCandidates)
  to   = singleCommit(toCandidates)

  if not from and not to:
    error "Both commit SHAs could not be resolved to a single commit."
  if not from or not to:
    error "One of the commit SHAs could not be resolved to a single commit."
  if from.merge_seq is null or to.merge_seq is null:
    error "One or both commits do not have a merge sequence number yet."

  space = repository + "@" + base
  if from.sequence_space !== space or to.sequence_space !== space:
    error "Both commits must belong to the selected repository and base branch."
  if from.merge_seq > to.merge_seq:
    error "The first commit merges after the second. Enter the commits in merge order."

  ok { space, range: from.merge_seq + ".." + to.merge_seq }
```

**바꾸면 안 되는 네 가지 규칙이다.**

1. 후보가 여러 개면 첫 후보를 고르지 않는다. 오류다.
2. SHA 문자열을 직접 비교하지 않는다. 항상 `merge_seq` 정수로 판정한다.
3. 역전된 입력을 자동으로 맞바꾸지 않는다. 오류다.
4. 공간(`repository@base`)이 정확히 일치해야 한다. 부분 일치를 허용하지 않는다.

| # | from 후보 | to 후보 | 결과 |
|---|---|---|---|
| 1 | commit 1개, seq 42, space `demo/modem@main` | commit 1개, seq 80, 같은 space | `{ ok, space:'demo/modem@main', range:'42..80' }` |
| 2 | commit 1개, seq 42 | commit 1개, seq 42 | `{ ok, range:'42..42' }` — 같은 값은 허용된다 |
| 3 | commit **2개** | commit 1개 | `One of the commit SHAs could not be resolved to a single commit.` |
| 4 | commit 0개(pull_request만 1개) | commit 1개 | 같은 오류 — `kind` 필터가 먼저다 |
| 5 | commit 0개 | commit 0개 | `Both commit SHAs could not be resolved to a single commit.` |
| 6 | seq `null` | seq 80 | `One or both commits do not have a merge sequence number yet.` |
| 7 | space `demo/modem@develop` | space `demo/modem@main` | `Both commits must belong to the selected repository and base branch.` |
| 8 | seq 80 | seq 42 | `The first commit merges after the second. Enter the commits in merge order.` |
| 9 | space `null` | 정상 | 공간 불일치 오류 |

## 2. M 번호 표시 판정

판정 순서와 열한 가지 결과, 그리고 아홉 가지 `pending` 사유 문구는 `SOURCE_EVIDENCE.md` 5장에 표로 전부 옮겼다. 여기에는 자료 구조와 검증 벡터만 둔다.

### 2.1 입력 타입

```ts
/** 목록·상세·범위 응답의 PR DTO에 additive로 실린다. 전부 선택적이다. */
interface MergeNumberFields {
  merge_number?: string | null;
  merge_number_state?: string | null;
  merge_number_reason?: string | null;
  merge_number_epoch?: number | null;
}

interface MergeNumberContext {
  kind: 'pull_request' | 'commit';
  repository: string | null;    // owner/name. 모르면 링크를 만들지 않는다
  baseBranch: string | null;    // 모르면 링크를 만들지 않는다
}

type MergeNumberView =
  | { kind: 'hidden' }
  | {
      kind: 'shown';
      state: 'assigned' | 'pending' | 'not_applicable' | 'unavailable';
      reason: string | null;
      label: string;        // 배지에 보이는 문구
      description: string;  // aria-describedby로 잇는 설명
      tone: 'accent' | 'neutral' | 'warning';
      link: { repository, baseBranch, seqEpoch, number, href } | null;
    };
```

`merge_number_projection_state`라는 키가 응답에 실려 올 수 있으나 **화면은 읽지 않는다.** 운영 관측용이다.

### 2.2 `splitSequenceSpace`

```text
splitSequenceSpace(space):
  if space is null or undefined -> null
  at = space.indexOf('@')                   // 첫 '@'다. 마지막이 아니다
  if at <= 0 or at === space.length - 1 -> null
  return { repository: space.slice(0, at), baseBranch: space.slice(at + 1) }
```

저장소 이름에는 `@`가 올 수 없고 브랜치 이름에는 올 수 있으므로 **첫** `@`에서 자른다. 마지막 `@`로 자르면 브랜치가 잘린다.

| 입력 | 결과 |
|---|---|
| `'demo/modem@main'` | `{ repository:'demo/modem', baseBranch:'main' }` |
| `'demo/modem@release/2026@rc'` | `{ repository:'demo/modem', baseBranch:'release/2026@rc' }` |
| `'@main'` | `null` — `at === 0` |
| `'demo/modem@'` | `null` — `at === length - 1` |
| `'demo/modem'` | `null` — `@`가 없다 |
| `null` | `null` |

### 2.3 `mergeNumberEntryHref`

```text
mergeNumberEntryHref({ repository, baseBranch, seqEpoch, number }):
  params = new URLSearchParams()
  params.set('m_repository',  repository)
  params.set('m_base_branch', baseBranch)
  params.set('m_seq_epoch',   String(seqEpoch))
  params.set('m_number',      number)
  return '/search?' + params.toString()
```

**PIPE에서는 `/search`를 주입받은 `routeBase`로 바꾼다.** 네 key의 철자와 순서는 그대로 둔다.

| 입력 | 결과 |
|---|---|
| `{repository:'demo/modem', baseBranch:'main', seqEpoch:3, number:'M-1900-42'}` | `/search?m_repository=demo%2Fmodem&m_base_branch=main&m_seq_epoch=3&m_number=M-1900-42` |
| `baseBranch:'release/2026-Q1'` | `…&m_base_branch=release%2F2026-Q1&…` |

### 2.4 `mergeNumberView` 검증 벡터

| # | fields | context | 결과 |
|---|---|---|---|
| 1 | `{state:'assigned', merge_number:'M-1900-42', merge_number_epoch:3}` | PR, `demo/modem`, `main` | `shown`, tone `accent`, label `M-1900-42`, link 있음 |
| 2 | 같음 | **commit**, 같음 | `hidden` |
| 3 | `{}` (키 없음) | PR, 같음 | `hidden` |
| 4 | `{state:'unknown_value'}` | PR, 같음 | `hidden` |
| 5 | `{state:'assigned', merge_number:'M-1', merge_number_epoch:null}` | PR, 같음 | `shown`, label `M-1`, **link `null`** |
| 6 | `{state:'assigned', merge_number:'M-1', merge_number_epoch:3}` | PR, `repository:null` | `shown`, label `M-1`, **link `null`** |
| 7 | `{state:'assigned', merge_number:null, merge_number_epoch:3}` | PR, 같음 | `shown`, state가 **`unavailable`로 낮아진다**, label `M number unavailable`, tone `warning` |
| 8 | `{state:'assigned', merge_number:''}` | PR, 같음 | 7번과 같다 |
| 9 | `{state:'pending', merge_number_reason:'not_sequenced'}` | PR, 같음 | label `Awaiting sequence numbering`, tone `neutral`, link `null` |
| 10 | `{state:'pending', merge_number_reason:'fetch_failed'}` | PR, 같음 | label `M number pending`, 설명에 `Merge evidence lookup temporarily failed. It will retry in the next cycle.` |
| 11 | `{state:'pending', merge_number_reason:'never_seen_code'}` | PR, 같음 | label `M number pending`, 설명에 `Reason code: never_seen_code.` |
| 12 | `{state:'pending'}` (사유 없음) | PR, 같음 | 설명에 `The reason is not available yet.` |
| 13 | `{state:'not_applicable', merge_number_reason:'branch_not_tracked'}` | PR, 같음 | label `Branch not numbered` |
| 14 | `{state:'not_applicable'}` | PR, 같음 | label `Not eligible for an M number`, 설명 `Unmerged PRs do not have M numbers.` |
| 15 | `{state:'unavailable', merge_number_reason:'repository_code_unavailable'}` | PR, 같음 | label `Repository code needs verification`, tone `warning` |
| 16 | `{state:'unavailable', merge_number_reason:'number_capacity_exceeded'}` | PR, 같음 | label `M number unavailable`, 설명 `The M number exceeds the supported display range.` |
| 17 | `{state:'unavailable'}` | PR, 같음 | label `M number unavailable`, 설명 `The M number could not be retrieved. Try again.` |

1번의 설명 문자열 전문은 다음과 같다. 문구를 바꾸지 않는다.

```text
demo/modem@main M number (epoch 3). Use it only to determine merge order; it does not replace the PR number. It becomes invalid when the sequence epoch changes.
```

`repository`나 `baseBranch`가 `null`이면 공간 부분이 `this sequence space`가 되고, `epoch`가 `null`이면 ` (epoch N)` 부분이 통째로 빠진다.

### 2.5 배지 렌더링 규칙

- `assigned`이고 링크가 있으면 배지를 **링크로 감싼다.** `onClick` 이동을 쓰지 않는다. 가운데 클릭, ⌘클릭, "새 탭에서 열기"가 죽는다.
- `link === null`이면 설명을 배지에 `aria-describedby`로 잇고, 링크가 있으면 **링크 쪽에** 잇는다. 상호작용 요소의 `describedby`가 더 널리 읽힌다.
- 설명은 화면에 보이지 않되 스크린 리더에는 읽히는 요소에 둔다. 색과 짧은 문구만으로는 "왜 번호가 없는가"가 전달되지 않는다.
- 복사 버튼은 **부모가 `onCopy`를 줄 때만** 그린다. 배지가 자기 live region을 만들면 행마다 status 영역이 생겨 스크린 리더가 같은 말을 여러 번 듣는다.
- 복사할 주소는 **절대 URL**로 만든다: `new URL(link.href, window.location.origin).toString()`. 상대 경로를 붙여넣으면 대화 도구에서 링크가 되지 않는다.

복사 결과 문구는 세 가지다.

| 결과 | 문구 |
|---|---|
| `copied` | `M-number link copied.` |
| `failed` | `Unable to copy the M-number link. Open the badge in a new tab and copy its address.` |
| `unsupported` | `Clipboard unavailable. Open the badge in a new tab and copy its address.` |

`navigator.clipboard`가 `undefined`이면 `unsupported`, `writeText`가 거부되면 `failed`다. 두 경우 모두 성공으로 표시하지 않는다.

## 3. 표시 포맷

### 3.1 `formatTimestamp`

```text
formatTimestamp(iso):
  if iso is null/undefined/''  -> '—'
  at = new Date(iso)
  if isNaN(at.getTime())       -> '—'
  return `${UTCFullYear}-${pad(UTCMonth+1)}-${pad(UTCDate)} ${pad(UTCHours)}:${pad(UTCMinutes)} UTC`
```

**UTC로 고정한다.** 사용자의 시간대로 그리면 서버 렌더와 클라이언트 렌더가 달라져 하이드레이션이 깨지고, 두 사람이 같은 화면을 보며 다른 시각을 읽는다. 조사 도구에서 그것은 사고의 원인이 된다.

| 입력 | 결과 |
|---|---|
| `'2026-09-19T14:32:07.123Z'` | `2026-09-19 14:32 UTC` |
| `'2026-09-19T23:32:00+09:00'` | `2026-09-19 14:32 UTC` |
| `null` / `undefined` / `''` | `—` |
| `'not-a-date'` | `—` |

### 3.2 `shortSha`

```text
SHORT_SHA_LENGTH = 12
FULL_SHA = /^[0-9a-fA-F]{40}$/

shortSha(sha):
  trimmed = sha.trim()
  if not FULL_SHA.test(trimmed) -> trimmed     // 손대지 않는다
  return trimmed.slice(0, 12).toLowerCase()
```

git 기본은 7자이지만 화면에는 12자를 쓴다. 7자는 검색 **입력**의 하한이고, 표시에서는 두 SHA를 눈으로 구분할 수 있어야 한다. 40자가 아니면 자르지 않는다. 이미 축약된 값을 다시 자르면 7자 입력이 화면에서 더 짧아져 무엇을 검색했는지 알 수 없게 된다.

| 입력 | 결과 |
|---|---|
| 40자 hex | 앞 12자 소문자 |
| `'d71be10'` (7자) | `'d71be10'` — 그대로 |
| `'  <40자>  '` | 앞뒤 공백을 지운 뒤 12자 |

### 3.3 `formatSequence` / `formatSequenceRef`

```text
formatSequence(value):
  if value is null/undefined or not finite -> '—'
  return String(Math.trunc(value))            // 자릿수 구분 기호를 넣지 않는다

formatSequenceRef(value, epoch):
  seq = formatSequence(value)
  if seq === '—'                       -> '—'
  if epoch is null/undefined/not finite -> seq
  return `${seq}@e${Math.trunc(epoch)}`
```

`1,342`로 쓰면 그대로 복사해 검색창에 넣었을 때 숫자로 읽히지 않는다. 시퀀스는 세는 수가 아니라 **식별자**다.

에폭이 다르면 같은 시퀀스 값이라도 다른 커밋을 가리킨다. 강제 푸시가 에폭을 올리므로 에폭 없이 시퀀스만 인용하면 그 인용이 조용히 다른 것을 가리키게 된다.

| value | epoch | 결과 |
|---|---|---|
| `1342` | `3` | `1342@e3` |
| `1342` | `null` | `1342` |
| `null` | `3` | `—` |
| `1342.7` | `3` | `1342@e3` |

### 3.4 `formatDuration`

```text
DURATION_UNITS = [[86400,'d'], [3600,'h'], [60,'m']]

formatDuration(seconds):
  if null/undefined/not finite or < 0 -> '—'     // 음수는 데이터 오류다. 0으로 보이면 '즉시 머지'와 구분되지 않는다
  total = trunc(seconds)
  if total < 60 -> `${total}s`
  큰 단위부터 세어 최대 두 단위까지만 쓰고 ' '로 잇는다
```

| 입력 | 결과 |
|---|---|
| `45` | `45s` |
| `90` | `1m` |
| `3700` | `1h 1m` |
| `90061` | `1d 1h` |
| `-1` | `—` |

### 3.5 `serviceMessage`

```text
serviceMessage(message, fallback, code):
  if typeof message === 'string' and message.trim() !== ''
     and message에 한글(Hangul)이 없으면 -> message
  if typeof code === 'string' and /^[A-Za-z][A-Za-z0-9_:-]*$/.test(code) -> `${fallback} (${code})`
  return fallback
```

서버가 주는 진단 문구에 한글이 섞여 있으면 화면에 그대로 띄우지 않고 영어 기본 문구로 바꾼다. 화면 문구가 한 언어로 통일되게 하는 장치다.

**이 함수를 PR 본문, 커밋 메시지, 감사 증거에 적용하지 않는다.** 서비스 진단에만 쓴다.

| message | fallback | code | 결과 |
|---|---|---|---|
| `'Cursor expired.'` | `'Unable to load…'` | `'INVALID_CURSOR'` | `Cursor expired.` |
| `'커서가 만료되었습니다.'` | `'Unable to load…'` | `'INVALID_CURSOR'` | `Unable to load… (INVALID_CURSOR)` |
| `undefined` | `'Unable to load…'` | `'INVALID_CURSOR'` | `Unable to load… (INVALID_CURSOR)` |
| `undefined` | `'Unable to load…'` | `undefined` | `Unable to load…` |
| `''` | `'Unable to load…'` | `'a b'` (공백 포함) | `Unable to load…` — code 형식 검사에 걸린다 |

PIPE가 화면 문구를 한국어로 쓰기로 한다면 이 함수의 판정 방향을 뒤집어야 한다. 그때는 **판정 기준을 바꾸었다는 사실을 차이표에 적는다.** 서버 문구를 무조건 신뢰하는 형태로 만들지 않는다.

## 4. 조회 경로 선택

```text
chooseRoute(state, gheBaseUrl):
  raw = state.q.trim()
  if raw === ''  -> { kind: 'none' }

  detection = detectIdentifier(raw, gheBaseUrl ? { gheBaseUrl } : {})
  if detection.rejection !== null -> { kind: 'none' }

  kinds = new Set(detection.interpretations.map(i => i.kind))
  if kinds has 'commit' or 'pull_request' -> { kind: 'resolve', input: raw }
  return { kind: 'search' }
```

**판별기 하나로 정한다.** 구조화 질의를 미리 걸러 내는 지름길을 두지 않는다. 원본 주석이 그 이유를 기록해 두었다. 처음에는 `[a-z_]+:` 패턴으로 질의 키를 먼저 찾았는데, 그것이 `https://…`의 **스킴에 걸려** 붙여넣은 GHE URL이 전문 검색으로 떨어졌다. 파서의 `QUERY_KEYS`로 고쳤더니 변이 시험에서 그 검사를 통째로 없애도 아무 시험이 깨지지 않았다. 확인해 보니 겹칠 수가 없다. 식별자 패턴(40자 hex, `#N`, `owner/repo#N`, GHE URL)은 어느 것도 `<질의키>:` 접두를 가질 수 없다. 키 15종 × 값 9종 × 형태 4종을 전부 판별기에 넣어 겹치는 입력이 0건임을 실측했다.

`RepositoryWorkspace`는 `chooseRoute`를 직접 쓰지 않고 같은 판정을 인라인으로 한다(`RepositoryWorkspace.tsx:167-168`). 두 곳의 판정 결과는 같다.

### 4.1 URL 생성

```text
RESOLVE_LIMIT = 50

resolveUrl(input) = `/api/resolve?q=${encodeURIComponent(input)}&limit=50`
```

**`limit=50`을 명시한다.** `/api/resolve`의 기본값은 10이라 그대로 부르면 11건에서 절삭 표시가 떠 정해진 50 경계와 어긋난다.

`RepositoryWorkspace`는 여기에 한 가지를 더 한다. 입력이 `#`로 시작하면 **앞에 현재 저장소를 붙인다**(`RepositoryWorkspace.tsx:170`).

```text
target = identifier
  ? resolveUrl(raw.startsWith('#') ? `${repository}${raw}` : raw)
  : `/api/search?${searchParams}`
```

따라서 `#1842`는 `/api/resolve?q=demo%2Fmodem%231842&limit=50`이 된다.

### 4.2 검색 URL

```text
searchUrl(state, options):
  params.set('q', state.q.trim())
  if state.sort !== null      params.set('sort', state.sort)
  if state.order !== null     params.set('order', state.order)
  if state.size !== null      params.set('size', String(state.size))
  if state.seqEpoch !== null  params.set('seq_epoch', String(state.seqEpoch))
  if options.cursor           params.set('cursor', options.cursor)
  if options.facets === true  params.set('facets', 'true')
  return `/api/search?${params}`
```

두 가지 규칙이 중요하다.

**커서를 브라우저 주소에 넣지 않는다.** 이것은 `fetch` 대상 주소이지 주소 표시줄이 아니다. 커서가 주소에 실리면 붙여넣은 링크가 남의 페이징 위치를 나르게 되고, 그 위치는 발급자의 접근 범위로 봉인돼 있어 뜻이 없다.

**`seq_epoch`은 커서와 반대다.** 커서는 발급자의 접근 범위로 봉인돼 있어 남에게 뜻이 없지만, 에폭은 "이 서수가 어느 세대를 뜻했는가"라 누가 열어도 같은 사실이다. 그래서 브라우저 주소에도 남고 요청에도 실린다.

`RepositoryWorkspace`의 실제 호출은 `facets`를 첫 페이지에서 `'true'`, 이어 보기에서 `'false'`로 **명시적으로 보낸다**(`RepositoryWorkspace.tsx:164`). `searchUrl`과 달리 `false`도 보낸다.

## 5. 줄 diff와 줄 추적 — 외부 의존성이 있다

`apps/web/lib/source-analysis.ts`는 npm 패키지 **`diff`**에 의존한다.

| 항목 | 값 |
|---|---|
| 패키지 이름 | `diff` |
| 원본이 선언한 범위 | `"diff": "^9.0.0"` (`apps/web/package.json:33`) |
| 쓰는 심벌 | `diffLines`, `diffWordsWithSpace` |
| 라이선스 | BSD-3-Clause (패키지 공표값. PIPE에서 실제 설치본의 `LICENSE`로 확인한다) |
| 성격 | 순수 계산. Node 전용 API를 쓰지 않는다 |

**PIPE에서 반드시 할 일**(`TARGET_VERIFY`)이 세 가지다.

1. PIPE에 `diff`가 이미 설치되어 있는지 확인한다. 있으면 그 버전을 쓴다.
2. 설치되어 있지 않으면 새 의존성 추가가 필요하다. **임의로 최신 버전을 설치하지 않는다.** 추가 여부를 사람에게 확인받고, 승인되면 `^9.0.0` 범위를 쓴다.
3. 버전이 9 미만이면 `timeout`과 `maxEditLength` 옵션의 지원 여부가 다를 수 있다. 실제 타입 정의로 확인한다. `maxEditLength`를 넘겼을 때 `undefined`를 반환하는 동작이 이 코드의 전제다.

**원본 diff 계산을 문자열 비교로 대체하지 않는다.** Myers 알고리즘을 직접 구현하지도 않는다. 둘 다 결과가 달라지고, 계산량 한계 처리가 사라진다.

### 5.1 `lines`

```text
lines(text):
  if not text -> []
  result = text.split('\n')
  if result.at(-1) === '' -> result.pop()        // 끝 개행이 만든 빈 줄을 버린다
  return result.map(line => line.replace(/\r$/, ''))   // CRLF를 LF로 본다
```

| 입력 | 결과 |
|---|---|
| `''` | `[]` |
| `'a\nb\n'` | `['a','b']` |
| `'a\nb'` | `['a','b']` — 끝 개행이 없어도 같다 |
| `'a\r\nb\r\n'` | `['a','b']` |
| `'a\n\nb'` | `['a','','b']` — 중간 빈 줄은 남는다 |
| `'\n'` | `['']` — split이 `['','']`, pop 후 `['']` |
| `'한글\n テスト'` | `['한글',' テスト']` |

끝 개행의 유무는 `lines`의 결과로는 구별되지 않는다. 화면 안내(`no newline at EOF`)는 **원문 문자열을 직접 검사해서** 만든다: `text && !text.endsWith('\n')`.

### 5.2 `compareLines`

```text
compareLines(before, after) -> DiffRow[] | null

  changes = diffLines(before, after, { timeout: 150, maxEditLength: 5000 })
  if not changes -> null                 // 계산 한계 초과. 빈 diff가 아니라 명시적 미지원이다

  left = 1; right = 1; result = []
  for i in 0..changes.length-1:
    change = changes[i]; chunk = lines(change.value)

    if not change.added and not change.removed:
      각 줄마다 push { kind:'equal', before:{number:left++, text}, after:{number:right++, text} }
      continue

    removed = change.removed ? chunk : []
    added   = change.added   ? chunk : []
    if change.removed and changes[i+1]?.added:
      added = lines(changes[++i].value)   // 삭제 바로 뒤의 추가를 같은 변경 덩어리로 짝짓는다

    for j in 0..max(removed.length, added.length)-1:
      push { kind:'change',
             before: j < removed.length ? {number:left++,  text:removed[j]} : null,
             after:  j < added.length   ? {number:right++, text:added[j]}   : null }
  return result
```

```ts
interface DiffLine { number: number; text: string }
interface DiffRow  { kind: 'equal' | 'change'; before: DiffLine | null; after: DiffLine | null }
```

**한계 초과는 빈 diff가 아니라 `null`이다.** 화면은 `null`을 받으면 `Text comparison unavailable`을 보인다. 이 구분을 없애면 "차이가 없다"와 "계산하지 못했다"가 같아 보인다.

| # | before | after | 기대 |
|---|---|---|---|
| 1 | `'a\nb\nc\n'` | `'a\nb\nc\n'` | 세 행 모두 `equal`. 번호는 1,2,3 / 1,2,3 |
| 2 | `'a\nb\n'` | `'a\nB\n'` | 1행 `equal`, 2행 `change`(before `b` 2 / after `B` 2) |
| 3 | `'a\n'` | `'a\nb\n'` | 1행 `equal`, 2행 `change`(before `null` / after `b` 2) |
| 4 | `'a\nb\n'` | `'a\n'` | 1행 `equal`, 2행 `change`(before `b` 2 / after `null`) |
| 5 | `''` | `'a\n'` | 1행 `change`(before `null` / after `a` 1) |
| 6 | `'a\nb\nc\n'` | `'a\nX\nY\nc\n'` | 1 `equal`, 2 `change`(b/X), 3 `change`(null/Y), 4 `equal`(c 3 / c 4) |
| 7 | `'a\r\nb\r\n'` | `'a\nb\n'` | **전부 `equal`.** `lines`가 `\r`을 지우기 때문이다 |
| 8 | 5000줄이 넘게 다른 두 텍스트 | | `null` |

7번은 반드시 시험해야 한다. CRLF 차이만으로 파일 전체가 변경으로 보이면 쓸모가 없다.

### 5.3 `wordChanges`

```text
wordChanges(before, after, side) -> { text, changed }[]

  if before.length + after.length > 4000:
    return [{ text: side === 'before' ? before : after, changed: true }]   // 줄 전체를 변경으로 본다

  chunks = diffWordsWithSpace(before, after, { timeout: 8, maxEditLength: 200 })
  if not chunks:
    return [{ text: …, changed: true }]

  return chunks
    .filter(c => side === 'before' ? !c.added : !c.removed)
    .map(c => ({ text: c.value, changed: Boolean(c.added || c.removed) }))
```

`diffWordsWithSpace`는 공백을 토큰의 일부로 남기므로 들여쓰기가 보존된다. `diffWords`를 쓰면 안 된다. 들여쓰기가 사라진다.

| before | after | side | 기대 |
|---|---|---|---|
| `'int x = 1;'` | `'int x = 2;'` | `after` | `1;`이 아니라 `2;`만 `changed: true`인 조각이 나온다 |
| `'  a'` | `'    a'` | `after` | 앞 공백 차이가 조각으로 잡힌다 |
| 2500자 | 2500자 | 아무거나 | 합이 4000을 넘으므로 한 조각, `changed: true` |

### 5.4 `traceLines`

```text
traceLines(versions) -> Map<sha, TracedLine[]> | null
  versions는 오래된 것이 앞이어야 한다

  result = new Map(); previous = []; previousText = ''
  for index, version in versions:
    if index === 0:
      previous = lines(version.text).map((text, i) => ({
        text, events: [{ sha: version.sha, line: i+1, text, kind: 'baseline' }]
      }))
    else:
      rows = compareLines(previousText, version.text)
      if not rows -> return null
      previous = rows.flatMap(row => {
        if not row.after -> []                                   // 삭제된 줄은 사라진다
        earlier = row.before ? previous[row.before.number - 1] : undefined
        if row.kind === 'equal' and earlier:
          return [{ text: row.after.text, events: earlier.events }]   // 이력을 그대로 물려받는다
        return [{ text: row.after.text, events: [
          ...(earlier?.events ?? []),
          { sha: version.sha, line: row.after.number, text: row.after.text,
            kind: earlier ? 'edited' : 'added' }
        ]}]
      })
    previousText = version.text
    result.set(version.sha, previous)
  return result
```

```ts
interface LineEvent  { sha: string; line: number; text: string; kind: 'baseline' | 'added' | 'edited' }
interface TracedLine { text: string; events: LineEvent[] }
```

**이것은 Git blame이 아니다.** 인접한 두 revision의 diff에서 "같은 위치의 교체"를 같은 줄로 **추정**한 것이다. 화면은 이 사실을 항상 고지한다. `edited`는 `Aligned replacement`, `added`는 `Added`, `baseline`은 `Present at window start`로 표기한다.

호출 측의 계산량 제한도 함께 옮긴다(`SourceDialogs.tsx:104-121`).

- 분석 창은 현재 위치에서 **뒤로 최대 30개** revision이다: `commits.slice(max(0, currentIndex - 29), currentIndex + 1)`.
- 파일 내용은 **3개씩 묶어** 순차로 읽는다. 30개를 동시에 요청하지 않는다.
- 어느 revision이든 `status`가 `text`도 `missing`도 아니면 즉시 중단하고 사유를 보인다.
- 사용자가 `Analyze line history`를 눌러야 시작한다. 자동으로 돌지 않는다.
- 진행 중 분석은 `AbortController`로 취소할 수 있고, 모달이 닫힐 때 취소한다.

| # | versions | 기대 |
|---|---|---|
| 1 | 한 개, `'a\nb\n'` | 두 줄. 각각 `baseline` 이벤트 하나 |
| 2 | `'a\nb\n'` → `'a\nB\n'` | 1행 이벤트 1개(`baseline`), 2행 이벤트 2개(`baseline`, `edited`) |
| 3 | `'a\n'` → `'a\nb\n'` | 2행의 이벤트가 1개이고 `kind`가 **`added`**(이전 줄이 없다) |
| 4 | `'a\nb\n'` → `'a\n'` | 결과에 `b` 줄이 없다 |
| 5 | 중간에 `compareLines`가 `null`을 주는 쌍이 있다 | 전체가 `null` |
| 6 | 세 개를 거쳐 한 줄이 두 번 바뀐다 | 그 줄의 이벤트가 3개(`baseline`, `edited`, `edited`) |

### 5.5 강조 렌더링

검색어 강조(`SourceDialogs.tsx:33-38`)는 대소문자를 구별하지 않는 부분 문자열 검색이다.

```text
highlight(text, needle):
  if not needle -> text || ' '            // 빈 줄도 높이를 차지하도록 공백 하나를 준다
  대소문자 무시 indexOf로 모든 일치를 찾아 <mark>로 감싼다
```

정규식을 쓰지 않으므로 사용자 입력의 특수문자를 이스케이프할 필요가 없다. 정규식으로 바꾸면 `(`나 `[` 입력에서 예외가 난다.

## 6. 옮기지 않는 것

아래는 원본에 있지만 이번 포팅 범위가 아니다. PIPE에서 찾지 말고 만들지도 마라.

| 모듈 | 이유 |
|---|---|
| `readMergeNumberEntry`, `hasPendingMergeNumber`, `MergeNumberEntry` | M 링크 진입 해석. 기본 화면이 쓰지 않는다(`PD-001`) |
| `lib/query-url.ts`의 전체 codec | `SearchView` 전용이다. `RepositoryWorkspace`는 `URLSearchParams`를 직접 쓴다 |
| `lib/facets.ts`, `lib/relations.ts`, `lib/neighbors.ts` 등 | 다른 화면(W-002, W-004)의 로직이다 |
| `packages/query`의 `serialize`, `sequence-binding` | `RepositoryWorkspace`가 쓰지 않는다. `detectIdentifier`와 `parseQuery`만 쓴다 |
| `lib/proxy.ts`, `app/api/[...path]/route.ts` | Next.js 서버 경계다. PIPE는 자체 transport를 쓴다 |
| `lib/server/*` | `server-only` 경계다. 절대 옮기지 않는다 |
