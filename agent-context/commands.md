# 명령어 · 시험 결과 · 실패한 명령과 원인

## 필수 전제 — Node PATH

모든 `pnpm` 명령 앞에 이것이 필요하다. 셸 기본값(v20.12.0)으로는 `pnpm install`
자체가 거부된다.

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
```

`.nvmrc`가 22이므로 사용자가 `nvm use`를 쓰면 자동으로 잡힌다. 전역 기본값은
바꾸지 않았다.

## 검증 배터리 (전 계층, 마지막 실행 결과)

```bash
pnpm typecheck        # tsc --build + tests + web
pnpm lint             # eslint . — 마지막 파일까지 쓴 뒤 다시 돌릴 것
pnpm run lint:deps    # 패키지 13개, 위반 0건
pnpm run test                 # 단위 1161 통과 (1 skipped)
pnpm run test:a11y            # 186 통과 (axe 0건)
pnpm run test:integration     # 674 통과 — 실 PG·Redis·ES 필요
pnpm run test:regression      # 27 통과
pnpm run test:contrast        # 80쌍 통과
pnpm --filter @prs/web run build   # e2e 전에 필수 (아래 참조)
pnpm run test:e2e             # 65 통과
```

부분 실행:

```bash
pnpm run test web/lib/neighbors
pnpm run test:integration sequence/neighbors
pnpm run test:a11y pr-detail
cd apps/web && ./node_modules/.bin/playwright test e2e/flow-002.spec.ts
```

## 함정: e2e는 빌드를 하지 않는다

`pnpm run test:e2e`는 `next start`로 **기존 `.next`를 재사용한다.** 화면을
고쳤으면 `pnpm --filter @prs/web run build`를 **먼저** 돌려야 한다. 안 그러면
새 라우트가 404가 되고, 그 실패를 플레이크로 오해하기 쉽다(이전 세션이 실제로
겪었다). CI는 build 스텝이 선행한다.

## 실패했던 명령과 원인

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | `ERR_PNPM_UNSUPPORTED_ENGINE` | 기본 Node v20.12.0. `eslint-visitor-keys@5.0.1`이 `^20.19.0 \|\| ^22.13.0 \|\| >=24` 요구 → Node 22.23.2 설치 |
| `pnpm test:integration` (Node v20.12.0) | `TypeError [ERR_INVALID_ARG_VALUE]: styleText` | rolldown이 배열 format을 쓴다. Node 20.19+ 또는 22에서 정상 |
| `pnpm test:a11y` (Node v22.0.0) | `ERR_REQUIRE_ESM` (std-env) | `require(esm)`는 22.12+ — 22.0.0은 너무 이르다 |
| `pnpm test:integration` | `database "prs_test" does not exist` | `docker exec prs-postgres psql -U prs -d prs -c "CREATE DATABASE prs_test OWNER prs;"` |
| `playwright test` | `Executable doesn't exist ... chromium_headless_shell-1200` | `./node_modules/.bin/playwright install chromium` |
| `pnpm lint` (Node 22) | 미사용 import `vi` | **Node 문제가 아니었다.** 시험 파일을 lint 뒤에 썼기 때문 |

## 환경 준비 (새 머신이라면)

```bash
docker ps --format '{{.Names}}\t{{.Status}}'      # prs-postgres/redis/elasticsearch
docker exec prs-postgres psql -U prs -lqt | grep prs   # prs, prs_test
pnpm run db:migrate                                # 개발 DB prs (dist/cli.js 필요 → 빌드 선행)
curl -s "localhost:9200/_cat/indices?h=index"      # prs-{commits,pull-requests,links,releases}-v1
```

접속 기본값은 `.env.example`과 같다(`.env` 파일은 없다). 컨테이너 설정과 일치한다.

## 변이 시험 (이 저장소의 관행)

작은 헬퍼로 변이 → 시험 → 원복을 반복했다.

```python
# 파일, 옛 문자열, 새 문자열을 받아 정확히 1건일 때만 치환 (CRLF 보존)
python3 mutate.py <path> "<old>" "<new>"
```

**주의**: 신규(untracked) 파일은 `git checkout --`으로 원복되지 않는다. 역방향
치환으로 되돌리고, 마지막에 전 계층을 다시 돌려 원복을 확인할 것.

## Git · PR

```bash
gh pr checks 33
gh pr view 33 --json state,isDraft,mergeStateStatus,reviews
gh api repos/89sooner/pr-search/pulls/33/comments --jq '.[] | "\(.path):\(.line)\n\(.body)"'
```

CI는 `verify`(약 2분 50초)와 `integration`(약 3분)이다. 감시할 때는
**`integration` 줄만** 겨냥할 것 — "아무 체크나 pass/fail"로 조건을 걸면
`verify`가 끝나는 순간 빠져나와 미완인 상태를 결과로 오해한다.

```bash
timeout 1800 bash -c 'until gh pr checks 33 2>/dev/null | grep "^integration" | grep -qE "\t(pass|fail)\t"; do sleep 20; done'
```

## 파일 편집 시 개행 주의

`docs/**`와 `apps/web`·`packages/**`의 대부분 소스가 **CRLF**다(`git
core.autocrlf=true`). Python으로 편집할 때 `newline=''`로 읽고 쓰며, 삽입하는
블록도 `\r\n`으로 맞춰야 앵커 매칭이 되고 diff가 깨끗하다.
`docs/00_governance/change_control.md`와 `pr_search_api_contracts.md`는 LF다.

---

# 2026-08-25 후반 세션 갱신

## 검증 배터리 (마지막 실행 결과 — main `5e18e00`)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                # 통과
pnpm lint                     # 통과 — 마지막 파일까지 쓴 뒤 다시 돌릴 것
pnpm run lint:deps            # 패키지 13개, 위반 0건
pnpm run test                 # 단위 1243 통과 (1 skipped)   [1161 → +82]
pnpm run test:a11y            # 192 통과 (axe 0건)            [186 → +6]
pnpm run test:integration     # 746 통과                      [674 → +72]
pnpm run test:regression      # 64 통과                       [27 → +37]
pnpm run test:contrast        # 80쌍 통과
pnpm --filter @prs/web run build   # e2e 전에 필수
pnpm run test:e2e             # 67 통과                       [65 → +2]
pnpm build                    # 통과
```

## 문서 검증기 (저장소에 없다 — 스킬 디렉터리에 있다)

```bash
V=/home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py
python3 $V --root . --strict
python3 $V --root . --report --code-root .
```

**`--strict`는 오류 2건으로 끝나는 것이 정상이다** — `change_control.md` 9건,
원장 5건의 "미정/TODO" 플레이스홀더가 **기존 문서 산문**이다. 깨끗한 `main`에서도
같은 수가 나온다. **작업 전후로 그 수가 늘지 않았는지**를 보면 된다.

## 이 세션에서 쓴 부분 실행

```bash
pnpm run test:integration ops/sequence-integrity
pnpm run test:integration pipeline-worker/integration/sequence/repair
pnpm run test:integration authz/team-scope        # team-scope + team-scope-es 둘 다
pnpm run test:integration pr-snapshot
pnpm run test packages/authz/src/team-scope
pnpm run test search-api/src/runtime
```

## 머지 후 리뷰 확인 (이 세션에서 다섯 번 필요했다)

```bash
gh api repos/89sooner/pr-search/pulls/<N>/comments --jq 'length'
gh api graphql -f query='{ repository(owner:"89sooner",name:"pr-search"){ pullRequest(number:<N>){
  reviewThreads(first:20){ nodes{ id isResolved isOutdated path line
    comments(first:2){ nodes{ author{login} body } } } } } } }'
```

reply / resolve:

```bash
gh api graphql -f query='mutation($tid: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $tid, body: $body}) { comment { url } } }' \
  -f tid="<PRRT_...>" -f body="$(cat reply.md)"
gh api graphql -f query='mutation($tid: ID!) {
  resolveReviewThread(input: {threadId: $tid}) { thread { isResolved } } }' -f tid="<PRRT_...>"
```

**코드를 고치고 CI가 초록이 된 뒤에만 reply → resolve 한다.**

## CI 대기 (verify와 integration 둘 다 봐야 한다)

```bash
for i in $(seq 1 30); do
  ok=$(gh pr checks <N> 2>/dev/null | grep -cE "^(verify|integration)\s+(pass|fail)" || echo 0)
  [ "$ok" = "2" ] && break
  sleep 20
done
gh pr checks <N>
```

`integration`만 보고 나가면 `verify`가 아직 도는 상태(`UNSTABLE`)에서 머지를
시도하게 된다 — 이 세션에서 실제로 한 번 겪었다.

## 변이 시험 헬퍼 (정확히 1건일 때만 치환, CRLF 보존)

```bash
python3 mutate.py <path> "<old>" "<new>"
```

**중복 매칭이 안전장치다.** WP-028에서 `findPointByPullRequest`와 똑같은 질의를
가진 기존 함수가 있어 2건이 잡혔고, 그 덕에 **내가 만들려던 함수가 이미 있다는
것을 발견**해 중복 구현을 지웠다.

## 실패했던 명령과 원인 (이 세션)

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `pnpm run test:integration ops/sequence-integrity` | `duplicate key ... repository_owner_name_key` | `acme/payments`를 다른 시험이 이미 쓴다 → 고유 픽스처 이름(`acme/integrity-wp028`) |
| 같은 시험 | `app_user_login_key` 중복 | 시험용 사용자 login도 고유해야 한다 |
| 같은 시험 | `new_epoch_expected`가 8 | `beforeEach`가 `seq_epoch`를 리셋하지 않았다 |
| `pnpm typecheck` | 통합 시험 타입 오류 | **통합 시험은 vitest만으로는 타입 검사가 안 된다.** `tsconfig.tests.json`이 잡는다 — 시험이 초록이어도 typecheck를 따로 돌릴 것 |
| `git stash pop` 후 실패 | 변이 원복 실패 | 여러 변이를 연달아 걸면 앞의 치환이 뒤의 앵커를 바꾼다. **한 번에 하나씩** |
| `kill %1` 포함 명령 | exit 144, 뒤 명령 미실행 | 같은 명령줄에서 백그라운드 작업을 죽이면 셸 자체가 죽는다 |

## 파일 편집 시 개행 주의 (변경 없음)

`docs/`와 `apps/web`·`packages/`의 대부분 소스가 **CRLF**다(git `core.autocrlf=true`).
Python으로 편집할 때 `newline=''`로 읽고 쓰며, 삽입 블록도 `\r\n`으로 맞춰야
앵커 매칭이 되고 diff가 깨끗하다. `agent-context/*.md`도 CRLF다.

---

# 인계 검증 명령 (2026-08-26 세션에서 실제로 쓴 것)

문서 버전과 ID 최댓값을 한 번에 확인한다 — 인계받자마자 이것부터.

```bash
sed -n '1,4p' docs/10_requirements/srs_final.md                         # baseline v2.5
sed -n '1,4p' docs/40_delivery/pr_search_implementation_traceability.md # review v1.8
grep -oE 'CR-[0-9]{3}' docs/00_governance/change_control.md | sort -u | tail -3
grep -oE 'DEV-[0-9]{3}' docs/40_delivery/pr_search_implementation_traceability.md | sort -u | tail -3
```

미해결 리뷰 스레드 **수만** 세는 짧은 형태 (위쪽의 전체 조회보다 빠르다):

```bash
for n in 36 37 38; do
  gh api graphql -f query="{ repository(owner:\"89sooner\",name:\"pr-search\"){
    pullRequest(number:$n){ reviewThreads(first:30){ nodes{ isResolved isOutdated path } } } } }" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length'
done
# 2026-08-26 결과: 1 / 7 / 1 = 9건. 전부 아직 열려 있다
```

문서 모순(원장 `done` vs 작업 패키지 `todo`) 확인:

```bash
sed -n '48p;50p' docs/40_delivery/pr_search_work_packages.md   # WP-028 · WP-068 → 아직 todo
grep -nE '^\| WP-(028|068) ' docs/40_delivery/pr_search_implementation_traceability.md
```

## handoff pack 재생성

```bash
python /home/roqkf/.claude/skills/agent-context-handoff/scripts/context_handoff.py \
  build --root . --source agent-context --output agent-context/_handoff
python agent-context/_handoff/reader.py list --output agent-context/_handoff
```

**입력에서 제외되는 것**: `agent-context/_handoff/` 자신, 그리고 `exports/`의 전사.
전사는 사람이 읽는 원본이며 compact 대상이 아니다.

---

# 2026-08-26 대형 세션

## 검증 배터리 (main `3e3009b` 기준 실측)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                # 통과
pnpm lint                     # 통과
pnpm run lint:deps            # 통과
pnpm run test                 # 단위 1264 통과 (1 skipped)   [1243 → +21]
pnpm run test:a11y            # 192 통과
pnpm run test:integration     # 통합 809 통과                 [746 → +63]
pnpm run test:regression      # 회귀 83 통과                  [64 → +19]
pnpm run test:contrast        # 80쌍 통과
pnpm build                    # 통과
pnpm --filter @prs/web run build   # e2e 전에 필수
pnpm run test:e2e             # CI 통과 / **로컬 5회 중 4회 실패** (flow-001, 아래)
```

## 이 세션에서 실제로 쓴 조사 명령

```bash
# 미해결 리뷰 전수 — **모든 PR을 훑는다** (이전 세션이 #40을 놓쳤다)
for n in 33 34 35 36 37 38 39 40 41 42 43; do
  c=$(gh api graphql -f query="{ repository(owner:\"89sooner\",name:\"pr-search\"){
    pullRequest(number:$n){ reviewThreads(first:40){ nodes{ isResolved isOutdated } } } } }" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false and .isOutdated==false)] | length')
  printf 'PR #%s = %s\n' "$n" "$c"
done

# next-free ID (추측하지 않는다)
grep -ohE 'CR-[0-9]{3}' docs/00_governance/change_control.md | sort -u | tail -2
grep -rohE 'DEV-[0-9]{3}' docs/ | sort -u | tail -2
# **새 JOB/EVT/API ID는 충돌부터 본다** — JOB-ING-009가 이미 쓰이고 있었다
grep -rohE 'JOB-[A-Z]+-[0-9]{3}' docs/ | sort -u

# 두 문서의 WP 상태 기계 대조 (22행 어긋남을 이렇게 찾았다)
# → python으로 두 표를 파싱해 set 차집합. 눈으로 세지 않는다
```

## e2e 귀속 절차 (§22가 요구하는 것)

```bash
# 1) 단독 실행 — 부하 없이도 깨지는가
cd apps/web && ./node_modules/.bin/playwright test e2e/flow-001.spec.ts --reporter=line
#    → 4/4 통과

# 2) 전체 실행 반복 — 실제 비율
for i in 1 2 3 4 5; do pnpm run test:e2e >/dev/null 2>&1 && echo PASS || echo FAIL; done
#    → PASS=1 FAIL=4

# 3) **비교 재현보다 강한 근거**: 그 코드가 이 세션에 바뀌었는가
git log --oneline 5e18e00..HEAD -- apps/web    # 비어 있다 = 화면 코드 동일
grep -n 'page.route' apps/web/e2e/flow-001.spec.ts   # 모든 /api/**를 가로챈다
#    → API 변경이 그 시험에 도달할 수 없다. 비교 대상이 구조적으로 같다
```

CI의 `verify` 잡이 같은 `pnpm test:e2e`를 돌린다 (`.github/workflows/*.yml`).
**PR #41·#42·#43 모두 통과** — 로컬 환경 문제라는 증거다.

## 변이 시험 — 이번에 쓴 형태

```bash
# 정확히 1건일 때만 치환. 앵커가 모호하면 **적용하지 않고 알린다**
python3 - "$file" "$old" "$new" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
with io.open(p, encoding='utf-8', newline='') as f: t = f.read().replace('\r\n','\n')
n = t.count(old)
if n != 1:
    print(f'ANCHOR match={n}'); sys.exit(1)
with io.open(p,'w',encoding='utf-8',newline='\r\n') as f: f.write(t.replace(old,new,1))
PY
```

**앵커가 2건 잡히는 것이 안전장치다** — 이 세션에서 `markReassigning`과
`publishSequenceReassigned`가 자동/수동 두 경로에 있어 2건이 잡혔고, 그 덕에
"수동 경로만" 지우는 정확한 변이를 만들 수 있었다.

## 실패했던 명령과 원인 (이 세션)

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `python3 - <<'PYEOF'` (인라인) | `SyntaxError: '{' was never closed` | 파이썬 문자열 안에 `'cancelled'` 같은 **작은따옴표**가 있으면 heredoc 안에서 깨진다 → 스크립트를 파일로 쓴다 |
| `Path.read_text(newline='')` | `TypeError: unexpected keyword 'newline'` | 이 파이썬 버전은 지원 안 함 → `io.open(..., newline='')` |
| `pnpm run test:integration` (전량) | `commit-enrich` 스윕 2건 실패 (단독은 통과) | 공유 `prs_test`의 다른 파일 행이 배치 상한 500을 채웠다 → `beforeEach`에서 남의 행을 **처리된 것으로 표시** |
| `es.deleteByQuery` 직후 조회 | 지운 문서가 남아 있다 | `delete_by_query`는 **검색으로 찾는다** → 앞에 `indices.refresh` |
| `tail -c 2000 \| grep $'\r'` | CRLF 파일이 LF로 보임 | `tail -c`가 멀티바이트를 자른다 → `grep -c $'\r' file`로 줄 수를 센다 |
| `StagedGraph implements CommitGraph` | `patchId`/`readCommit` 없음 | **통합 시험은 vitest만으로 타입 검사가 안 된다.** `pnpm typecheck`가 `tsconfig.tests.json`으로 잡는다 |

## 문서 검증기 (변화 없음)

```bash
V=/home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py
python3 $V --root . --strict     # 오류 2건(9+5)이 정상 — 기존 산문 플레이스홀더
python3 $V --root . --report --code-root .
```

---

# 2026-08-26 CR-039 / WP-029 세션

## 검증 배터리 (main `ea917b8` 기준 실측)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                # 통과
pnpm lint                     # 통과
pnpm run lint:deps            # 통과 (패키지 13, 위반 0)
pnpm run test                 # 단위 1320 통과 (1 skipped)   [1264 → +56]
pnpm run test:a11y            # 192 통과
pnpm run test:integration     # 통합 849 통과                 [809 → +40]
pnpm run test:regression      # 회귀 104 통과                 [83 → +21]
pnpm run test:contrast        # 80쌍 통과
pnpm build
pnpm --filter @prs/web run build   # e2e 전에 필수
pnpm run test:e2e             # 67 통과 (flow-001 간헐 — 전량 3회 중 1회)
```

## 이 세션에서 쓴 부분 실행

```bash
pnpm run test link/reference                      # 파서 단위 55건
pnpm run test:integration worker/link             # 두 파일 다
pnpm run test:integration worker/link.test        # 파생·조정·해결만
pnpm run test:integration worker/link-rebuild     # 종단·재파생만
pnpm run test:integration admin/jobs
pnpm run test:integration release/refresh         # DEV-228 예산
```

## 변이 시험 하니스 (이번에 쓴 형태)

정확히 1건일 때만 치환하고, **되돌리기는 역방향 치환**이다 — 신규 파일은
`git checkout --`으로 원복되지 않는다.

```bash
# mut.sh <id> <file> <old> <new> <suite> <filter>
#   1) 치환 → 2) 스위트 실행 → 3) 역방향 치환으로 원복 → 4) KILLED/SURVIVED 출력
# 앵커가 1건이 아니면 ANCHOR-FAIL로 멈춘다 (안전장치)
```

**구문을 깨뜨리는 변이를 킬로 세지 마라.** 처음 M3·M10을 그렇게 걸었다가
"컴파일 실패"를 킬로 읽을 뻔했다. 변이는 **의미가 바뀌되 컴파일되는** 형태여야 한다.

## 리뷰 확인 — 전수로 센다

```bash
for n in $(seq 1 44); do
  c=$(gh api graphql -f query="{ repository(owner:\"89sooner\",name:\"pr-search\"){
    pullRequest(number:$n){ reviewThreads(first:60){ nodes{ isResolved isOutdated } } } } }" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false and .isOutdated==false)]|length' 2>/dev/null)
  [ -n "$c" ] && [ "$c" != "0" ] && printf 'PR #%s = %s\n' "$n" "$c"
done
```

**`#33 이상`처럼 범위를 좁히지 마라.** 이번에 전수로 세어 PR #30의 P1과 PR #32의
P2 둘을 찾았다 — 앞선 두 세션이 각각 범위를 좁혀 놓쳤던 것이다.

## e2e 귀속 절차 (이번에도 썼다)

```bash
git diff --stat origin/main..HEAD -- apps/web        # 비어 있으면 화면 코드 동일
cd apps/web && ./node_modules/.bin/playwright test e2e/flow-001.spec.ts --reporter=line   # 4/4 통과
for i in 1 2 3; do pnpm run test:e2e >/dev/null 2>&1 && echo PASS || echo FAIL; done       # 1회 FAIL
```

## 실패했던 명령과 원인 (이 세션)

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `pnpm run test` (첫 실행) | `architecture.test.ts` 2건 실패 | **ADR-008 가드레일이 잡았다** — `@prs/es`에서 `client.search`·`msearch` 직접 호출. 편법 대신 허용 목록을 `no_requester`/`user_facing`으로 갈라, `search`는 전자만 열었다 |
| `pnpm run test:integration worker/link` | `client.msearch is not a function` | `{ ...es, bulk }` 스프레드 — `risks.md` 18번을 또 밟았다. 명시적 위임 헬퍼로 고침 |
| 같은 시험 | 접두 해결이 이미 `true` | ES 문서가 **같은 파일의 앞선 케이스**에서 남았다. `beforeEach`에서 내 저장소의 엔티티 문서까지 지운다 |
| `pnpm run test:regression` (리뷰 정정 후) | 발행 순서 단언 실패 | **내 회귀가 틀린 계약을 굳히고 있었다** — 리뷰가 지적한 순서였다. 새 계약으로 다시 걸었다 |
| `mut.sh M3`(첫 형태) | 즉시 KILLED | 앵커가 **구문을 깨뜨렸다.** 컴파일 실패는 킬이 아니다 — 의미만 바꾸는 형태로 다시 걸었다 |

---

# 2026-08-26 CR-040 · CR-041 세션

## 검증 배터리 (main `c4f8a39` 기준 실측)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                # 통과
pnpm lint                     # 통과
pnpm run lint:deps            # 통과 (패키지 13, 위반 0)
pnpm run test                 # 단위 1342 통과 (1 skipped)   [1320 → +22]
pnpm run test:integration     # 통합 900 통과                 [849 → +51]
pnpm run test:regression      # 회귀 124 통과                 [104 → +20]
pnpm run test:a11y            # 192 통과 (axe 0건)
pnpm run test:contrast        # 80쌍 통과
pnpm build
pnpm --filter @prs/web run build   # e2e 전에 필수
pnpm run test:e2e             # 66/67 (flow-001 간헐 — 전량 3회 중 1회)
```

## 이 세션에서 쓴 부분 실행

```bash
pnpm run test link/relations                      # 파서 단위 22건
pnpm run test packages/es/src/architecture        # ADR-008 가드레일
pnpm run test:integration worker/relations        # 파생·수렴·detached·재구축 38건
pnpm run test:integration relation-candidates     # 마이그레이션 014 11건
pnpm run test:integration sequence/range-es       # reverted_pull_request_count
```

## 문서 검증기 — **종료 코드가 1이다** (중요)

```bash
V=/home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py
python3 "$V" --root . --strict            # 종료 코드 1, ERROR 2건 (9·5)
echo "exit=$?"                            # 파이프에 물리면 tail의 코드가 잡힌다 — 주의
```

**`exit 0`이 될 수 없다.** `origin/main`에서도 같은 2건이 나온다. 판정은 **main 대비 증감**으로 한다:

```bash
git worktree add -q /tmp/mainwt origin/main
python3 "$V" --root /tmp/mainwt --strict | grep -oE 'placeholders \([0-9]+\)'
python3 "$V" --root .          --strict | grep -oE 'placeholders \([0-9]+\)'
# 두 출력이 같으면 신규 issue 0
git worktree remove /tmp/mainwt
```

**함정**: 그 오탐을 **설명하면 재현된다.** 검사 낱말 넷을 문서에 인용하면 카운트가 늘어난다(9→14 실측). 낱말을 재생산하지 않고 기술하라.

## 마이그레이션 014 실증 (up → down → up)

```bash
docker exec prs-postgres psql -U prs -d prs_test -q -v ON_ERROR_STOP=1 \
  -c "$(sed 's/\r$//' packages/db/migrations/014_relation_candidates.up.sql)"
docker exec prs-postgres psql -U prs -d prs_test -tAc \
  "select indexname from pg_indexes where tablename in ('pull_request_snapshot','commit_snapshot') order by 1"
# down 실증 후 prs_test는 되돌려 두고 러너가 다시 적용하게 한다
pnpm --filter @prs/db run build && pnpm run db:migrate    # 개발 DB prs에 적용 → "적용: 014"
```

CRLF 파일이라 `psql -c`에 넣기 전에 `sed 's/\r$//'`가 필요하다.

## EXPLAIN으로 인덱스 식 일치 확인

```sql
-- SET LOCAL은 트랜잭션 안에서만 뜻이 있다. 풀의 query는 문장마다 다른 커넥션일 수 있다.
BEGIN; SET LOCAL enable_seqscan = off;
EXPLAIN SELECT * FROM commit_snapshot
  WHERE repository_id = $1 AND split_part(message, E'\n', 1) = $2;
ROLLBACK;
```

시험에서는 `withTransaction(pool, ...)`으로 감싼다. **작은 데이터셋에서 planner가 seq scan을 고르는 것으로 실패 판정하지 않는다** — 확인할 것은 계획이 아니라 **식이 일치하는가**다.

## 변이 시험 하니스 (이번에 쓴 형태)

```python
# scratchpad/mut.py — (이름, 파일, old, new, 스위트) 목록을 돌린다
#   1) 정확히 1건일 때만 치환(ANCHOR-FAIL로 멈춤) → 2) 스위트 실행
#   3) 역방향 치환으로 원복 → 4) KILLED/SURVIVED 출력
# CRLF 파일이므로 치환 문자열을 \r\n으로 변환해 매칭한다
```

**1차 18종 → 17 킬 + M13 SURVIVED**(깊이 상한 = 실결함), **리뷰 정정 7종 → 6 킬 + R7 SURVIVED**(시험 부재).
살아남은 둘 다 실결함이었고 **등가로 판정해 세지 않은 변이는 없다.**

## e2e 귀속 절차 (이번에도 썼다)

```bash
git diff --stat origin/main..HEAD -- apps/web     # 비어 있으면 화면 코드 동일
grep -n 'page.route' apps/web/e2e/flow-001.spec.ts # **/api/** 를 가로채면 백엔드가 도달 불가
cd apps/web && for i in 1 2 3 4; do ./node_modules/.bin/playwright test e2e/flow-001.spec.ts --reporter=line; done  # 4/4
for i in 1 2 3; do pnpm run test:e2e >/dev/null 2>&1 && echo PASS || echo FAIL; done   # 2 PASS / 1 FAIL
```

## 리뷰 확인 — 전수로 센다

```bash
for n in $(seq 1 46); do
  c=$(gh api graphql -f query="{ repository(owner:\"89sooner\",name:\"pr-search\"){
    pullRequest(number:$n){ reviewThreads(first:60){ nodes{ isResolved isOutdated } } } } }" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false and .isOutdated==false)]|length' 2>/dev/null)
  [ -n "$c" ] && [ "$c" != "0" ] && printf 'PR #%s = %s\n' "$n" "$c"
done
```

## 실패했던 명령과 원인 (이 세션)

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `pnpm run test:integration worker/relations` | `strict_dynamic_mapping_exception: [has_stack]` | **실결함이었다.** 커밋 매핑에 그 leaf가 없다 — 스택은 PR↔PR이다. 종류별로 leaf를 갈랐다 |
| 같은 시험 | 상위 5건 `first[0]` 불일치 | 조회 헬퍼가 `link_id` 순 정렬이라 배열이 **선택 순서가 아니다.** 집합 비교로 바꿨다 |
| 같은 시험 | 되돌림 간선 0건 | 시험용 seed `sha('9x')`가 **hex가 아니었다.** 파서는 `[0-9a-f]{40}`을 요구한다. 헬퍼가 비-hex를 던지게 고쳤다 |
| `pnpm run test:integration` (전량) | `range.test.ts`·`timeline.test.ts` 실패 | **계약이 뒤집혔다.** 두 시험이 `reverted_pull_request_count`가 **없다**를 단언하고 있었다(CR-027 DEV-133). 지우지 않고 뒤집었다 |
| EXPLAIN 시험 | 인덱스가 계획에 안 나옴 | `SET LOCAL`이 트랜잭션 밖이라 무효. `withTransaction`으로 감쌌다 |
| `python3 "$V" --strict \| tail` 뒤 `echo $?` | `exit=0`으로 보임 | **파이프의 마지막 명령 코드다.** 파일로 받고 나서 `$?`를 읽어야 한다 — 이 착각으로 "검증기 통과"를 한 번 잘못 읽을 뻔했다 |
| 변이 스크립트 첫 형태 | `ANCHOR-FAIL match=2` | `sub1`이 실패 시 즉시 종료해 **파일이 안 바뀐 채 남는다**(원자적). 앵커를 좁혀 다시 걸었다 |
| `pnpm run test:integration` (전량, 1회) | 실패했으나 **어느 시험인지 기록 못 함** | 출력을 `grep '^ *Tests '`로 줄여 받았다. **전량 실행 결과를 요약 줄만 남기고 버리지 마라** |
