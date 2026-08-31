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

---

# 2026-08-26 CR-042 / WP-031 세션

## 검증 배터리 (main `5d287b1` 기준 실측)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                # 통과
pnpm lint                     # 통과
pnpm run lint:deps            # 통과 (패키지 13, 위반 0)
pnpm run test                 # 단위 1380 통과 (1 skipped)   [1342 → +38]
pnpm run test:integration     # 통합 931 통과                 [900 → +31]
pnpm run test:regression      # 회귀 146 통과                 [124 → +22]
pnpm run test:a11y            # 212 통과 (axe 0건)            [192 → +20]
pnpm run test:contrast        # 80쌍 통과
pnpm build
pnpm --filter @prs/web run build   # e2e 전에 필수
pnpm run test:e2e             # 78건 (flow-006 11건 신설). flow-001 간헐 — 아래 귀속 절차
```

## 이 세션에서 쓴 부분 실행

```bash
pnpm run test:integration relations/relations      # THR-034 매트릭스·cross-repo 15건
pnpm run test:integration relations/co-changes     # 정확 자카드·자격 12건
pnpm run test:integration relations/reachability   # 운영 조립으로 라우트 실재 4건
pnpm run test packages/es/src/relations-read       # 부분 결과·질의 모양 13건
pnpm run test packages/es/src/architecture         # ADR-008 가드레일 7건
pnpm run test web/lib/relations                    # 판정 24건
pnpm run test:a11y relations                       # 20건
cd apps/web && ./node_modules/.bin/playwright test e2e/flow-006.spec.ts --reporter=line
```

## e2e 귀속 절차 — **되돌려서 잰다** (화면을 바꾼 세션의 필수 절차)

이전 세션들의 `git diff --stat -- apps/web`가 비어 있다는 근거는 **화면을 바꾸면 쓸 수 없다.**

```bash
# 1) baseline을 코드 변경 전에 남긴다 — 실패 시험 이름을 잃지 않는다
set -o pipefail
pnpm run test:integration 2>&1 | tee /tmp/.../baseline-integration.log
pnpm --filter @prs/web run build && pnpm run test:e2e 2>&1 | tee /tmp/.../baseline-e2e.log

# 2) 변경을 되돌려 같은 횟수를 돌린다
git stash push -u -m "attribution-check"
git diff --stat <main-sha> -- apps/web      # 0줄이면 화면이 main과 같다
pnpm --filter @prs/web run build
for i in 1 2 3; do pnpm run test:e2e > /tmp/.../attrib-e2e-$i.log 2>&1; done
git stash pop

# 3) 단독 실행으로 부하 대 논리를 가른다
cd apps/web && for i in 1 2 3 4; do ./node_modules/.bin/playwright test e2e/flow-001.spec.ts --reporter=line; done

# 4) 실패 시험 이름을 ANSI 제거해서 뽑는다 (요약 줄만 남기지 마라)
sed 's/\x1b\[[0-9;]*[A-Za-z]//g' <log> | grep -E '^\s+\[chromium\] › '
```

**2026-08-26 실측**: 되돌린 상태 3회 중 1회 실패(같은 시험·단언·오류) / 변경 적용 8회 중 4회 / 단독 4/4 통과 / `flow-006` 7/7.

## 변이 하니스 — JSON 목록을 돌린다

```python
# /tmp/.../mut.py  — [{id, what, file, suite, old, new}, ...] 를 받아
#   1) 정확히 1건일 때만 치환(ANCHOR-FAIL로 멈춤) → 2) suite 실행
#   3) 역방향 치환으로 원복(실패하면 즉시 중단) → 4) KILLED/SURVIVED 출력
# CRLF를 보존하고, suite는 셸 문자열이라 `A && B`로 여러 스위트를 걸 수 있다
```

접근 통제 변이는 **넓은 scope로 바꾸는 형태**가 좋다 — 인자를 지우면 타입이 깨지고, 그것은 킬이 아니다.

```
applyMandatoryScopeFilter(q, input.scope)
→ applyMandatoryScopeFilter(q, { kind: 'org_team', orgIds: [1], teamIds: [], visibilities: [...] })
```

## 문서 편집 — 앵커 뒤 개행 함정

CRLF 보존 편집기에서 앵커의 끝 개행을 벗기고 새 내용이 개행으로 끝나면 **빈 줄이 하나 더 생긴다.** 표 안에 생기면 Markdown 표가 끊긴다. 편집 뒤 반드시 확인한다.

```bash
# 표 행 사이 빈 줄 탐지 (앞뒤가 모두 '|')
python3 - "$f" <<'PY'
import io, sys
lines = io.open(sys.argv[1], encoding='utf-8', newline='').read().replace('\r\n','\n').split('\n')
bad = [i+1 for i in range(1,len(lines)-1) if lines[i]=='' and lines[i-1].startswith('|') and lines[i+1].startswith('|')]
if bad: print(f'{sys.argv[1]}: {bad}')
PY
# main 대비 연속 빈 줄 수가 늘지 않았는지도 함께 본다
```

## 실패했던 명령과 원인 (이 세션)

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `pnpm typecheck` | `Type 'string' has no properties in common with 'ScoreSort'` | ES 타입은 `sort: [{ _score: { order: 'desc' } }]`를 요구한다. 문자열 축약형이 안 된다 |
| `pnpm run test:integration relations/relations` | 대상 간선이 결과에 없다 | **내 픽스처 결함.** 상한용 간선 101건을 같은 source에서 내 같은 질의에 섞였다. 전용 source로 갈랐다 |
| `pnpm run test:integration relations/co-changes` | `expected 500 to be 999` | 픽스처가 자카드 동점을 만들었고 `pr_number` 오름차순 규칙이 이겼다. **정렬이 옳고 단언이 틀렸다** |
| `pnpm run test:regression` | `not.toContain('created_at')` 실패 | 검사가 **주석까지** 셌다. `codeOf()`로 주석을 걷어 내고 걸었다 |
| `pnpm run test:a11y relations` | `getByTestId` 여럿 발견 | 대역이 고정 `link_type`을 돌려줘 네 그룹이 같은 testid를 냈다. 요청을 되돌려주는 대역으로 고쳤다 |
| `pnpm lint` | 미사용 `PendingSection` import | 골격을 실제 섹션으로 바꾸고 import를 남겼다. **마지막 파일을 쓴 뒤 다시 돌려라**(risks 3) |
| `python3 edit.py replace` | 문서 표가 끊김 | 앵커 개행 함정(위). 정규화 스크립트로 일괄 정리 |

## 문서 검증기 (변화 없음)

```bash
V=/home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py
python3 "$V" --root . --strict     # 종료 코드 1, ERROR 2건(9·5)이 정상
```

판정은 `exit 0`이 아니라 **main 대비 증감 0**이다. 그리고 **검사 낱말(`미정` 등)을 문서에 재생산하면 카운트가 늘어난다** — 이번에도 세 곳에서 밟았고 낱말을 바꿔 써서 되돌렸다.

## 리뷰 확인 — 전수로 센다 (범위를 좁히지 마라)

```bash
for n in $(seq 1 47); do
  c=$(gh api graphql -f query="{ repository(owner:\"89sooner\",name:\"pr-search\"){
    pullRequest(number:$n){ reviewThreads(first:100){ nodes{ isResolved isOutdated } } } } }" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false and .isOutdated==false)]|length' 2>/dev/null)
  [ -n "$c" ] && [ "$c" != "0" ] && printf 'PR #%s = %s\n' "$n" "$c"
done
```

**CI 대기는 커밋 SHA의 check-runs로 본다** — `gh pr checks`는 옛 실행 결과를 그대로 보여 줄 수 있다.

```bash
SHA=$(git rev-parse HEAD)
gh api "repos/89sooner/pr-search/commits/$SHA/check-runs" \
  --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion // "")"'
```

---

# 2026-08-26 CR-043~047 세션

## 검증 배터리 (main `99e2532` 기준 실측)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH   # 셸 기본값은 v20.12.0이다
pnpm typecheck                # 통과
pnpm lint                     # 통과
pnpm run lint:deps            # 통과 (패키지 13, 위반 0)
pnpm run test                 # 단위 1380 통과 (1 skipped)
pnpm run test:integration     # 통합 931 통과 (61 파일)
pnpm run test:regression      # 회귀 151 통과              [146 → +5]
pnpm run test:a11y            # 212 통과 (axe 0건)
pnpm run test:contrast        # 80쌍 전부 통과
pnpm build                    # 통과
pnpm --filter @prs/web run build   # e2e 전에 필수
pnpm run test:e2e             # 77 통과 / 1 실패 (flow-001 간헐)
```

**`test:contrast`의 출력 형식에 주의.** `Test Files`/`Tests` 줄이 없고 마지막이 `0 of 80 pairs checked failed contrast threshold`다 — `grep -E "Tests"`로 잡으면 **아무것도 안 나와 실패로 오해한다.**

## 실제 Elasticsearch로 계약 주장을 증명하기

문서만 읽고 "아마 안 될 것"이라고 적지 않았다. **probe 인덱스를 만들어 두 벽을 확인했다** (DEV-266·267).

```bash
# 벽 1 — edge_ngram은 비동적 설정이라 열린 인덱스에 못 넣는다
curl -s -X PUT "localhost:9200/edgengram-probe" -H 'Content-Type: application/json' -d '{
  "settings": { "analysis": { "analyzer": { "text_ko_en": {
    "type":"custom","tokenizer":"standard","filter":["lowercase","asciifolding"] } } } },
  "mappings": { "properties": { "title": { "type":"text","analyzer":"text_ko_en" } } } }'
curl -s -X POST "localhost:9200/edgengram-probe/_doc/1?refresh=true" -H 'Content-Type: application/json' \
  -d '{"title":"결제 게이트웨이 payment gateway"}'
curl -s -X PUT "localhost:9200/edgengram-probe/_settings" -H 'Content-Type: application/json' -d '{
  "analysis": { "filter": { "edge2_20": { "type":"edge_ngram","min_gram":2,"max_gram":20 } },
                "analyzer": { "text_ko_en_partial": { "type":"custom","tokenizer":"standard",
                  "filter":["lowercase","asciifolding","edge2_20"] } } } }'
#   → illegal_argument_exception: Can't update non dynamic settings ... for open indices

# 벽 2 — putMapping으로 더한 서브필드는 기존 문서에서 비어 있다
curl -s -X POST "localhost:9200/edgengram-probe/_close"
curl -s -X PUT  "localhost:9200/edgengram-probe/_settings" -H 'Content-Type: application/json' -d '{ ...위와 같음... }'
curl -s -X POST "localhost:9200/edgengram-probe/_open"
curl -s -X PUT  "localhost:9200/edgengram-probe/_mapping" -H 'Content-Type: application/json' -d '{
  "properties": { "title": { "type":"text","analyzer":"text_ko_en",
    "fields": { "partial": { "type":"text","analyzer":"text_ko_en_partial","search_analyzer":"text_ko_en" } } } } }'
curl -s "localhost:9200/edgengram-probe/_search" -H 'Content-Type: application/json' \
  -d '{"query":{"match":{"title.partial":"payme"}}}'          # → hits = 0
curl -s -X POST "localhost:9200/edgengram-probe/_update_by_query?refresh=true"
curl -s "localhost:9200/edgengram-probe/_search" -H 'Content-Type: application/json' \
  -d '{"query":{"match":{"title.partial":"payme"}}}'          # → hits = 1
curl -s -X DELETE "localhost:9200/edgengram-probe"            # 반드시 지운다
```

## 임시 통합 시험으로 결함을 재현하고 지우기

DEV-270을 이렇게 재현했다. **읽어서 의심하고 실물로 확인한다.**

```bash
# 1) apps/search-api/integration/sequence/_repro-w004.test.ts 를 쓴다
#    (range-es.test.ts를 틀로 삼는다 — 픽스처 색인에 routing 필수)
pnpm run test:integration sequence/_repro-w004
# 2) 로그를 보존하고 파일을 지운다
cp apps/search-api/integration/sequence/_repro-w004.test.ts /tmp/.../repro.test.ts.txt
rm apps/search-api/integration/sequence/_repro-w004.test.ts
git status --porcelain    # clean 확인
```

**함정 둘**
- `SessionStore`에 `save()`는 없다. `create({ sessionId, userId, login, email, roles, issuedAt, lastSeenAt, correlationId })`다
- `--reporter=verbose`를 붙이면 시험이 **skip된다**(vitest 인자 처리). 증거는 기본 실행의 `Tests N passed`로 남긴다

## 배포 도달성 조사 — 역할↔기동 사슬 전수

`batch` 하나가 아니라 **넷**이 미배포였다. 이렇게 셌다.

```bash
# 코드가 분기하는 역할
grep -oE "roles\.includes\('[a-z-]+'\)" apps/pipeline-worker/src/index.ts | sort -u
# manifest가 세우는 역할 (파일 존재가 아니라 값을 본다)
for f in deploy/k8s/pipeline-worker-*.yaml; do
  grep -A2 "PIPELINE_WORKER_ROLES" "$f" | grep "value:" | sed 's/.*value: *//'
done | sort -u
# 인프라 3장이 승인한 단위
grep -oE '`pipeline-worker:[a-z-]+`' docs/30_technical_architecture/pr_search_infrastructure_operations.md | sort -u
```

**start 호출을 감싸는 역할까지 정확히 보려면** 중첩을 세야 한다(`backfill`이 `enrich` 안에 있다). 파이썬으로 중괄호 깊이를 추적해 `roles → start*` 표를 만들었다.

## 변이 시험 (이 세션에서 건 여섯, 전부 킬)

| ID | 변이 | 결과 |
| --- | --- | --- |
| R-M1 | `pipeline-worker-batch.yaml` 삭제 | KILLED |
| R-M2 | manifest의 `ROLES` 값을 `enrich`로 변조(파일은 남김) | KILLED — 파일 존재가 아니라 **값**을 본다는 증명 |
| R-M3 | 예외 목록의 사유를 짧게 | KILLED |
| R-M4 | 배포 단위 표에 만들지 않은 가짜 단위 추가 | KILLED (두 시험이 각각) |
| R-M5 | 표에서 `mirror` 행 제거(코드에는 남김) | KILLED |
| R-M6 | 예외 역할 `authz`를 승인 표에 올림 | KILLED (두 시험이 각각) |

**원복은 역방향 치환으로 한다.** `git checkout -- <file>`을 썼다가 **아직 커밋하지 않은 회귀 추가분까지 잃었다**(148 → 146).

## CI 조사 (러너가 76분간 안 잡혔다)

```bash
SHA=$(git rev-parse HEAD)
# run이 아예 없으면 트리거가 안 된 것이다
gh api "repos/89sooner/pr-search/actions/runs?head_sha=$SHA" --jq '.total_count'
gh api "repos/89sooner/pr-search/actions/runs?head_sha=$SHA" \
  --jq '.workflow_runs[] | "id=\(.id) attempt=\(.run_attempt) \(.status) \(.conclusion // "")"'
# queued + check-run 0 = 러너 배정 문제
gh api "repos/89sooner/pr-search/commits/$SHA/check-runs" --jq '.total_count'
# run 수준 startup_failure인데 job은 success인 경우가 있다 — 둘 다 본다
gh api "repos/89sooner/pr-search/actions/runs/<ID>/jobs" --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

재트리거 셋을 다 써 봤다: `git push`(새 commit) · `gh pr close/reopen` · `gh run rerun <id>`. **셋 다 실패했고** 다음 PR을 여는 순간 큐가 저절로 풀렸다.

**billing 확인은 `user` scope가 필요하다** — `gh api /users/<login>/settings/billing/actions`가 404 + "needs the user scope". 사용자가 `gh auth refresh -h github.com -s user`를 실행해야 한다.

## 문서 편집 — 이번에 밟은 함정 셋

```bash
# 1) `after` 모드를 제목에 걸면 그 제목 *뒤*에 들어간다 (두 번 밟았다)
#    → 새 절을 앞에 넣을 때는 다음 제목을 앵커로 `replace` 하고
#      치환 텍스트에 그 제목을 다시 포함한다
# 2) `replace`의 앵커에 제목을 넣고 치환 텍스트에서 빼면 그 제목과 본문이 사라진다
#    → 편집 뒤 반드시 확인
grep -n '^## ' docs/30_technical_architecture/pr_search_api_contracts.md
# 3) 표 중간에 문단을 넣으면 표가 끊긴다. 기존 "표 안 빈 줄" 검사로는 안 잡힌다
python3 - <<'PY'
import io
f='<file>'
l=io.open(f,encoding='utf-8',newline='').read().replace('\r\n','\n').split('\n')
print([i+1 for i in range(1,len(l)-1) if l[i]=='' and l[i-1].startswith('|') and l[i+1].startswith('|')])
PY
```

## 검증기 — 작업 중간에도 돌린다

```bash
V=/home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py
python3 "$V" --root . --strict > /tmp/.../v.log 2>&1
diff <(grep -E '^(ERROR|WARN)' /tmp/.../validator-main.log) <(grep -E '^(ERROR|WARN)' /tmp/.../v.log)
```

**판정은 exit 0이 아니라 main 대비 증감 0이다.** 이 세션에서 `CR referenced but not registered in change_control.md: CR-045`를 잡아 줬다 — 계약 문서에서 CR을 참조하기 전에 대장에 등록해야 한다.

## 리뷰 답변·해소 (GraphQL)

```bash
gh api graphql -f query='mutation($tid: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $tid, body: $body}) { comment { url } } }' \
  -f tid="PRRT_..." -f body="$(cat reply.md)"
gh api graphql -f query='mutation($tid: ID!) {
  resolveReviewThread(input: {threadId: $tid}) { thread { isResolved } } }' -f tid="PRRT_..."
```

**머지된 PR의 스레드도 답변·resolve 할 수 있다.** 이 세션은 PR #48의 다섯과 PR #50의 넷을 후속 CR로 고친 뒤 각각 답변하고 닫았다.

## 실패했던 명령과 원인 (이 세션)

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `pnpm run test:regression` | `ECONNREFUSED 127.0.0.1:5432` (2 파일) | **컨테이너가 죽었다.** `docker ps -a`로 `Exited (255)` 확인 → `docker start prs-postgres prs-redis prs-elasticsearch` |
| `pnpm run test:integration sequence/_repro-w004` | `TypeError: (intermediate value).save is not a function` | `SessionStore`에 `save()`가 없다. `create({...})`다 |
| 같은 시험 `--reporter=verbose` | `2 skipped` | vitest 인자 처리. 증거는 기본 실행의 `Tests N passed`로 |
| `git checkout -- regression/...` | 회귀 148 → 146 | **커밋 전 변경분이 통째로 날아갔다.** 변이는 역방향 치환으로 원복 |
| `python3 edit.py after <제목>` | 새 절이 제목 **뒤**로 | 다음 제목을 앵커로 `replace` 한다 |
| `python3 edit.py replace <제목>` | `## 5. DTO 표준`과 본문이 사라짐 | 치환 텍스트에 앵커 제목을 다시 포함해야 한다 |
| `grep -E "Tests"` on `test:contrast` | 아무것도 안 나옴 | 그 스크립트는 `N of 80 pairs ... failed` 형식이다 |
| `grep -cE '\| open'` on 원장 | 새 DEV 3건이 안 세어짐 | `| **open ...**`으로 썼다. **`| open ...` 형식으로 쓴다** |
| `gh run list --branch <name>` | `unknown flag` | 그 플래그가 없다. `--json headSha`로 걸러낸다 |
| `bc` | `command not found` | 이 환경에 없다. 합계는 파이썬으로 |

## 환경 (변경 없음, 재확인)

- Node **v22.23.2** 필수, **셸 기본값은 v20.12.0**
- 마이그레이션 **014까지**. 컨테이너 3종 healthy, `prs`·`prs_test` 존재
- 전사는 **`exports/`**에 있다 (`exports/202608270742.md`) — `.gitignore` 24행 대상

---

# 2026-08-27 WP-035 · CR-048 세션

## 검증 배터리 (main `df9f569` 기준 실측)

**이 세션부터 정책이 바뀌었다** — 전 계층을 WP마다 기계적으로 반복하지 않는다.

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH   # 셸 기본값은 v20.12.0이다
pnpm typecheck                     # 통과
pnpm lint                          # 통과
pnpm run lint:deps                 # 통과 (패키지 13, 위반 0)
pnpm run test                      # 단위 1393 통과 (1 skipped)   [1380 → +13]
pnpm run test:integration          # 통합 952 통과 (63 파일)       [931 → +21]
pnpm run test:regression           # 회귀 194 통과                 [151 → +43]
pnpm build                         # 통과
```

**돌리지 않은 것**: `test:a11y` · `test:contrast` · `test:e2e` — 이번 작업이 `apps/web`을 한 파일도 바꾸지 않았다. `pnpm --filter @prs/web run build`도 필요 없었다.

**지시서의 기본 생략과 다르게 돌린 것**: **통합 전량.** 17개 공유 쓰기 원시체의 시그니처를 바꿨고 그 경로들의 실제 커버리지가 통합 계층에 있다 — 여기서 생략하면 바꾼 것의 대부분이 검증되지 않는다. 약 130초.

## 이 세션에서 쓴 부분 실행

```bash
pnpm run test:integration reindex             # 재색인 통합 + 도달성 (19건)
pnpm run test:integration jobs/reindex        # 재색인 통합만 (17건)
pnpm run test:integration ops/reindex-reachability
pnpm run test:integration authz               # 58건
pnpm run test packages/es/src/dual-write      # 이중 쓰기 아키텍처 6건
pnpm run test packages/es/src/versioned-index # 버전 이름 규칙 7건
pnpm run test authz                           # 154건
npx vitest run --config vitest.regression.config.ts -t "JOB-AUTH-001"   # 5건만
```

## next-free ID 실측 (추측하지 않는다)

```bash
grep -rohE 'CR-[0-9]{3}' docs/ | sort -u | tail -2
grep -rohE 'DEV-[0-9]{3}' docs/ | sort -u | tail -2
ls packages/db/migrations/*.up.sql | tail -1
grep -cE '^\| DEV-[0-9]{3} .*\| open' docs/40_delivery/pr_search_implementation_traceability.md
```

## 문서 검증기 — main 대비 증감으로 판정한다

```bash
V=/home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py
git worktree add -q /tmp/mainwt origin/main
python3 "$V" --root /tmp/mainwt --strict > /tmp/v-main.log 2>&1
python3 "$V" --root .          --strict > /tmp/v-head.log 2>&1
diff <(grep -E '^(ERROR|WARN)' /tmp/v-main.log) <(grep -E '^(ERROR|WARN)' /tmp/v-head.log) && echo "신규 0"
git worktree remove /tmp/mainwt
```

`exit 1` + ERROR 2건(9·5)이 정상이다. **`risks.md`를 백틱으로 인용하면 새 WARN이 생긴다** — 검증기가 그것을 문서 참조로 읽는다. 이번에 원장 6.39장에서 한 번 밟았고 "인계 리스크 노트"로 바꿔 되돌렸다.

## 변이 하니스 — **치환 건수 검증이 없으면 결과를 믿지 마라**

```python
# /tmp/.../mut.py — (id, file, old, new, suite) 목록을 돌린다
#   1) 정확히 1건일 때만 치환 (ANCHOR-FAIL로 멈춘다)
#   2) suite 실행 → 3) 역방향 치환으로 원복 → 4) KILLED/SURVIVED
# CRLF 보존. `git checkout`은 쓰지 않는다.
```

**인라인으로 급하게 쓴 치환에 건수 검증이 없어 "SURVIVED"를 오독했다.** CRLF 때문에 치환이 아예 안 걸린 것을 살아남은 것으로 읽을 뻔했고, 검증을 붙이자 즉시 `KILLED`였다.

이 세션의 변이 14종 (전부 킬):

| 묶음 | ID | 잡은 시험 |
| --- | --- | --- |
| 지시서 핵심 | M1 울타리 조기 해제 | 회귀 `울타리가 shadow 실패 기록까지 덮는다` |
| | M2 shadow 항목 실패 무시 | 통합 T3 |
| | M3 전환을 두 호출로 | 회귀 `updateAliases 한 번` |
| | M4 러너 기동 제거 | 회귀 `JOB-ING-006 entrypoint` |
| | M5 쓰기 경로를 울타리 밖으로 | 아키텍처 `운영 호출부는 모두 울타리를 지난다` |
| | M6 옛 인덱스 복사 | 통합 T8 |
| 무중단 실증 | M3b 전환 두 호출 + **150ms 창** | 통합 T9 |
| 리뷰 정정 | R1a 옛 접근 통제 값 사용 | 통합 R1 |
| | R1b PR 원본 커밋 재구축 생략 | 통합 R1 |
| | R2 잡 생성 뒤 진행 상태 기록 | 통합 R2 |
| | R3 롤백 인덱스도 처리 표시 | 통합 R3 |
| | R4 별칭 대조 없이 전환 기록 | 통합 R4 |
| CI 정정 | C1 본문의 버전을 믿는다 | 통합 R1 |
| CR-048 | A-M1 manifest 삭제 / A-M2 ROLES 변조 / A-M3 적용 순서 제거 / A-M4 표 중복 행 / A-M5 산문 미배포 | 회귀 |

## 시험 호출부 일괄 보정 (시그니처 17개를 바꾸면 88건이 깨진다)

```python
# 괄호 짝을 세어 호출 끝을 찾고 마지막 인자로 SERVING_ONLY 를 넣는다.
# 문자열 리터럴 안의 괄호를 건너뛰어야 하고, `before_last=True` 옵션으로
# 기본값 인자(sleep)가 있는 함수는 그 앞에 끼워 넣는다.
```

**함정**: 원본에 trailing comma가 있으면 `1_000,, SERVING_ONLY`가 된다. 정규식으로 한 번 더 정리했다.

## CI 확인 — 커밋 SHA의 check-runs로 본다

```bash
SHA=$(git rev-parse HEAD)
gh api "repos/89sooner/pr-search/commits/$SHA/check-runs" \
  --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion // "")"'

# 실패한 job의 로그
RUN=$(gh api "repos/89sooner/pr-search/actions/runs?head_sha=$SHA" --jq '.workflow_runs[0].id')
JOB=$(gh api "repos/89sooner/pr-search/actions/runs/$RUN/jobs" --jq '.jobs[] | select(.name=="integration") | .id')
gh api "repos/89sooner/pr-search/actions/jobs/$JOB/logs" | grep -E "FAIL|AssertionError|Tests " | head -20
```

이 세션은 CI가 **세 라운드 모두 정상 기동**했다(76분 큐 대기 재현 없음). 그리고 **한 번은 실결함을 잡았다** — 로컬 통합 전량이 통과한 것을 CI가 잡았다(DEV-320).

## 리뷰 답변·해소

```bash
gh api graphql -f query='mutation($tid: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $tid, body: $body}) { comment { url } } }' \
  -f tid="PRRT_..." -f body="$(cat reply.md)"
gh api graphql -f query='mutation($tid: ID!) {
  resolveReviewThread(input: {threadId: $tid}) { thread { isResolved } } }' -f tid="PRRT_..."
```

**코드를 고치고 CI가 초록이 된 뒤에만 reply → resolve 한다.** 이번엔 머지 **전에** 리뷰가 왔다(#52 다섯, #53 둘).

## `.gitignore` 실측 — 전사 위치는 반드시 확인한다

```bash
git check-ignore -v 202608271346.md     # 출력 없음 = 무시되지 않는다
git check-ignore -v exports/dummy.md    # .gitignore:24:exports/
```

`/export`에 **상대 경로**를 주면 저장소 루트에 떨어진다. `exports/`만 무시되므로 루트의 전사는 `git add -A`에 딸려 간다.

## 실패했던 명령과 원인 (이 세션)

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `io.open(p,'w',newline='\\r\\n')` (이스케이프 깨진 값) | `ValueError` 전에 **파일이 0바이트** | `open(...,'w')`는 인자 검증보다 먼저 truncate한다. 통합 시험 540줄을 다시 썼다 |
| `git checkout -- deploy/k8s/README.md` | 미커밋 CR 편집 유실 | risks 53번을 또 밟았다. 복구하려 같은 스크립트를 재실행했더니 **멱등이 아니라 표 행이 두 줄** (DEV-321) |
| 인라인 치환 변이 (건수 검증 없음) | `SURVIVED` 오독 | CRLF 때문에 치환이 안 걸렸다. **건수 검증 없는 변이는 증거가 아니다** |
| `pnpm run test:integration` (CI) | `expected 'prs-pull-requests-v1' to be '...-v2'` | 재구축이 스냅숏 **본문**의 `document_version`을 믿었다. 본문에 그 키가 없는 행이 CI에만 있었다 → **열에서 읽는다** (DEV-320) |
| `pnpm run test:integration reindex` (첫 실행) | 앞 케이스의 태그가 섞여 나옴 | `beforeEach`가 정본만 지웠다. **버전 인덱스 전부**에서 내 저장소 문서를 지우게 고쳤다(risks 30) |
| 같은 시험 | `1_000,, SERVING_ONLY` 구문 오류 | 원본의 trailing comma. 정규식으로 정리 |
| `pnpm run test` (첫 실행) | ADR-008 가드레일 2건 실패 | **가드레일이 옳았다** — 전환 전 검증의 `es.count`·`es.search`. 사유와 함께 예외에 등재 |
| `pnpm run test:regression` (시그니처 변경 뒤) | 6건 실패 | 호출 형태를 핀으로 박은 회귀. **사실은 그대로 두고 형태만** 갱신 |
| 회귀 `.reindex({` 금지 | 자기 머리 주석에 걸림 | risks 43번. `codeOf()`로 주석을 걷어 냈다 |
| `authz1.py` 재실행 | 인프라 표 행 두 줄 | 스크립트가 멱등이 아니었다 |

## 환경 (변경 없음, 재확인)

- Node **v22.23.2** 필수, **셸 기본값 v20.12.0**. 같은 명령줄에서 `export`한 뒤 재면 잘못 읽힌다
- 마이그레이션 **014까지**. 컨테이너 3종 healthy, `prs`·`prs_test` 존재
- ES 별칭 넷 정상. WP-035 통합이 별칭을 옮기지만 `afterAll`이 되돌린다
- **전사는 저장소 루트에 있다** — `202608271346.md`. `exports/`가 아니다

# 2026-08-27 (2차) WP-032 세션

## 검증 배터리 (main `3237b6c` = WP-032 병합 기준 실측)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                     # 통과
pnpm lint                          # 통과 — 마지막 파일을 쓴 뒤 다시
pnpm run lint:deps                 # 패키지 13, 위반 0
pnpm run test                      # 단위 1481 통과 (1 skipped)   [1394 → +87]
pnpm run test:integration          # 통합 1015 통과 (65 파일)     [952 → +63]
pnpm run test:regression           # 회귀 194
pnpm --filter @prs/web run build   # e2e 전에 필수 (화면을 바꿨다)
pnpm run test:a11y                 # 212 (axe 0건)
pnpm build
```

**targeted e2e** (전체 78+는 생략 — 2026-08-27 검증 정책):

```bash
cd apps/web && ./node_modules/.bin/playwright test \
  e2e/search-paging.spec.ts e2e/flow-001.spec.ts e2e/flow-003-range.spec.ts
# 27 통과
```

## 통합 결과가 이상하면 DB를 초기화하고 **한 번만** 돌린다

```bash
docker exec prs-postgres psql -U prs -d postgres -c "DROP DATABASE IF EXISTS prs_test;"
docker exec prs-postgres psql -U prs -d postgres -c "CREATE DATABASE prs_test OWNER prs;"
pnpm run test:integration
```

두 실행이 겹치면 duplicate key·partition 충돌로 **수십 건이 거짓 실패**한다 (risks 69).

## 실 Elasticsearch로 계약을 증명한다

```bash
# 매핑이 받아들여지는가
node --input-type=module -e "
import { ENTITY_INDICES } from './packages/es/dist/index.js';
const pr = ENTITY_INDICES.find(d => d.alias === 'prs-pull-requests');
console.log(JSON.stringify({ settings: { ...pr.settings, number_of_shards: pr.shards }, mappings: pr.mappings }));
" > /tmp/pr-index.json
curl -s -X PUT localhost:9200/probe -H 'Content-Type: application/json' -d @/tmp/pr-index.json

# 정렬 센티널이 되먹여지는가 (DEV-329를 찾은 방법)
node --input-type=module -e "... search_after: [센티널] ..."
```

**문서만 읽고 "아마 될 것"이라고 적지 않는다.** `format` 셋(`없음`·
`strict_date_optional_time`·`epoch_millis`)을 다 재서 셋 다 실패한다는 것을 확인했다.

## 변이 하니스 — 건수 검증 + `mutate_many`

```python
# scratchpad/mut.py
#   swap(path, old, new)   — 정확히 1건일 때만 (ANCHOR-FAIL로 멈춘다), CRLF 보존
#   mutate(...)            — 한 자리
#   mutate_many(...)       — 여러 자리를 함께 (한 자리만 바꾸면 등가가 되는 결함)
#   원복은 역방향 치환. `git checkout --`은 쓰지 않는다
```

## next-free ID 실측

```bash
grep -rohE 'CR-[0-9]{3}' docs/ | sort -u | tail -2   # → CR-048
grep -rohE 'DEV-[0-9]{3}' docs/ | sort -u | tail -2  # → DEV-332
ls packages/db/migrations/*.up.sql | tail -1         # → 014
grep -cE '^\| DEV-[0-9]{3} .*\| open' docs/40_delivery/pr_search_implementation_traceability.md
```

## CI는 **커밋 SHA의 check-runs**로 본다

`gh pr checks`는 옛 실행 결과를 그대로 보여 줄 수 있다.

```bash
SHA=$(git rev-parse HEAD)
gh api "repos/89sooner/pr-search/commits/$SHA/check-runs" \
  --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion // \"\")"'

# 실패한 job의 로그
RUN=$(gh api "repos/89sooner/pr-search/actions/runs?head_sha=$SHA" --jq '.workflow_runs[0].id')
JOB=$(gh api "repos/89sooner/pr-search/actions/runs/$RUN/jobs" --jq '.jobs[] | select(.name=="integration") | .id')
gh api "repos/89sooner/pr-search/actions/jobs/$JOB/logs" | grep -E 'FAIL|AssertionError|Tests ' | head -20
```

이 세션은 `verify` 약 3분 · `integration` 약 4분이었고, 큐 대기는 없었다.
main(`2d28074`)에서도 양쪽 통과를 확인했다.

## 리뷰 답변·해소 (GraphQL)

```bash
gh api graphql -f query='mutation($tid: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $tid, body: $body}) { comment { url } } }' \
  -f tid="PRRT_..." -f body="$(cat reply.md)"
gh api graphql -f query='mutation($tid: ID!) {
  resolveReviewThread(input: {threadId: $tid}) { thread { isResolved } } }' -f tid="PRRT_..."
```

**코드를 고치고 CI가 초록이 된 뒤에만 reply → resolve 한다.**

## 실패했던 명령과 원인 (이 세션)

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `pnpm run test:integration` (두 번 겹침) | 76건 실패 — duplicate key·partition 충돌 | `run_in_background`의 `nohup &`가 겹쳤다. DB drop/create 뒤 한 번만 |
| `indices.delete({index:'prs-*-v*'})` | `Wildcard expressions ... not allowed` | `action.destructive_requires_name`. 이름을 지목한다 |
| `applyMappings` (별칭이 v1) | `mapper_parsing_exception: analyzer [text_partial_index] has not been configured` | 매핑 버전을 올리고 재색인으로 배포한다 (DEV-328) |
| `search_after: [-9223372036854776000]` | `parse_exception: failed to parse date field` | `missing:'_last'` 센티널은 되먹일 수 없다 (DEV-329) |
| CI `integration` | `expected 'pr:3' to be 'pr:2'` | 시험이 BM25에 매달려 있었다 — 로컬은 유일, CI는 동률 |
| 시험 픽스처 | `duplicate key ... app_user_login_key` / `repository_owner_name_key` | 공유 `prs_test`. **스위트마다 다른 login·slug을 쓴다** |
| `2026-08-${10 + n}` | `invalid input syntax for type timestamp` | 분·일을 문자열로 더하면 60을 넘는다. `Date.UTC(...) + n * 60_000` |

## 환경 (변경 없음, 재확인)

- Node **v22.23.2** 필수, 셸 기본값 v20.12.0
- **ES 별칭 v2** — `prs-pull-requests-v2` · `prs-commits-v2`
- 마이그레이션 014까지. 컨테이너 3종 healthy

---

# 2026-08-27 (3차) CR-049 · WP-033 세션

## 검증 배터리 (main `700d825` = WP-033 병합 기준 실측)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                     # 통과
pnpm lint                          # 통과 — 마지막 파일을 쓴 뒤 다시
pnpm run lint:deps                 # 패키지 13, 위반 0
pnpm run test                      # 단위 1552 통과 (1 skipped)   [1481 → +71]
pnpm run test:integration          # 통합 1080 통과 (67 파일)     [1015 → +65]
pnpm run test:regression           # 회귀 213                     [194 → +19]
pnpm --filter @prs/web run build   # e2e 전에 필수 (화면을 바꿨다)
pnpm run test:a11y                 # 235 (axe 0건)                [212 → +23]
pnpm build
```

targeted e2e:

```bash
cd apps/web && ./node_modules/.bin/playwright test \
  e2e/saved-search.spec.ts e2e/flow-001.spec.ts
# 22 통과
```

## 새 표를 만들면 전 계층 통합을 돌려라

`saved_search`가 `app_user`·`team`을 참조하자 **전역 삭제를 하는 여덟 파일이 함께
죽었다.** 단일 파일 실행으로는 절대 나오지 않는다.

```bash
docker exec prs-postgres psql -U prs -d postgres -c "DROP DATABASE IF EXISTS prs_test;"
docker exec prs-postgres psql -U prs -d postgres -c "CREATE DATABASE prs_test OWNER prs;"
set -o pipefail
pnpm run test:integration 2>&1 | tee /tmp/pr-search-wp033/final-integration.log
```

**시험이 전부 통과해도 exit 1일 수 있다** — `afterAll`이 실패하면 "Failed Suites"로
잡히고 시험 수는 온전하다. `Test Files` 줄을 함께 본다.

## 잠금이 실제로 배타를 만드는지 재는 법

`FOR UPDATE`로 밖에서 잡으면 **외래 키의 `FOR KEY SHARE`와 충돌해** 잠금 없는 구현도
멈춘다. 구분하려면 외래 키가 잡는 것과 **같은 잠금**으로 잡아야 한다.

```sql
-- 시험 안에서: 이것으로 잡으면 우리 FOR UPDATE만 멈춘다
SELECT user_id FROM app_user WHERE user_id = $1 FOR KEY SHARE
```

## 경합을 실제로 만드는 법 (직접 실측)

`Promise.all`로 두 요청을 보내도 창이 짧으면 겹치지 않는다. 잠금 없는 구현을 직접
써서 창을 벌리면 재현된다.

```bash
node --input-type=module -e "
import { createPool, resolvePoolConfig, withTransaction } from './packages/db/dist/index.js';
// ... count → setTimeout(50) → INSERT 를 두 개 동시에
"
# 잠금 없음 → ["created","created"] 최종 개수: 101
```

## 변이 헬퍼 — 지우는 변이는 주석으로 치환한다

```python
# scratchpad/mut.py
#   mutate(path, old, new, cmd, label)  — 변이 → 시험 → 원복, 건수 검증
#   빈 문자열로 치환하지 마라: 원복 시 count가 문자 수 + 1이라 앵커 검증이 실패하고
#   변이가 적용된 채 남아 그 뒤의 모든 판정을 오염시킨다
```

변이 실행 뒤 `git diff --stat`으로 원복을 확인한다.

## Radix Select는 jsdom에서 열리지 않는다

a11y에서 `Select.Trigger` 클릭 후 `findByRole('option')`을 기다리면 **멈춘다**.
초기값을 주는 경로로 같은 사실을 걸고, 실제 열기는 e2e가 확인한다.

## 문서 검증기 — main 대비 증감으로 판정한다

```bash
V=/home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py
W=/tmp/.../main-baseline
git worktree add -q --detach "$W" origin/main
python3 $V --root "$W" --strict   # 기준
python3 $V --root . --strict      # 현재 — WARN 1 · ERROR 2로 같아야 한다
```

## 실패했던 명령과 원인 (이 세션)

| 명령 | 증상 | 원인·해결 |
| --- | --- | --- |
| `pnpm run test:integration` (전 계층) | 여덟 파일이 `violates foreign key constraint` | 새 표가 `app_user`·`team`을 참조한다. 015에 CASCADE, 시험에 `afterAll` 정리 |
| 같은 명령 | `permission_cache_user_id_fkey` | 접근 범위 해석기가 그 표를 채운다 — 사용자보다 먼저 지운다 |
| `pnpm run test:a11y saved-searches` | 5분 타임아웃 | Radix Select를 jsdom에서 열려 했다 |
| `mut.py` 원복 | `ANCHOR-FAIL expected 1, found 5948` | 빈 문자열 치환은 되돌릴 수 없다 |
| `pkill -f vitest && pnpm typecheck` | exit 144, 뒤 명령 미실행 | 같은 명령줄에서 프로세스를 죽이면 셸이 죽는다 (기록된 함정) |
| playwright `flow-001` | strict mode violation: «검색»에 2개 매칭 | 새 «검색 저장» 버튼이 접두를 공유한다 |

## 환경 (변경 없음, 재확인)

- Node **v22.23.2** 필수, 셸 기본값 v20.12.0
- **마이그레이션 015까지**. 컨테이너 3종 healthy, `prs`·`prs_test` 존재
- ES 별칭 v2 — `prs-pull-requests-v2` · `prs-commits-v2`

---

# 2026-08-28 CR-050 · WP-034 세션이 배운 명령

## 재부팅 뒤에는 컨테이너부터 확인한다

이 세션은 PC 재부팅으로 중단됐다. **작업 파일은 전부 살아 있었지만 컨테이너가 내려가 있었다** —
그 상태로 통합 시험을 돌리면 전부 실패한다.

```bash
docker ps -a --format '{{.Names}}\t{{.Status}}'          # Exited (255)로 보인다
docker start prs-postgres prs-redis prs-elasticsearch
# elasticsearch가 healthy가 될 때까지 기다린다 (약 30초)
docker inspect --format '{{.State.Health.Status}}' prs-elasticsearch
```

## CRLF 저장소에 `cat >>`로 덧붙이지 마라

`core.autocrlf=true`라 워킹 디렉터리 파일은 CRLF인데 `cat >>`로 덧붙인 부분은 LF로 남는다.
**한 파일 안에 둘이 섞이면 편집 앵커가 조용히 어긋난다** — 변이가 걸리지 않았는데 시험은
통과했고, 치환 건수 검증이 없었다면 그것을 SURVIVED로 읽었을 것이다.

```bash
# 혼합 여부 실측
for f in <paths>; do
  printf "%-50s CRLF=%s TOTAL=%s\n" "$f" "$(grep -c $'\r$' "$f")" "$(wc -l < "$f")"
done
```

정규화는 파이썬으로 한다(`data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')`).
**커밋 결과는 어차피 LF로 정규화되므로 산출물에는 영향이 없다** — 워킹 디렉터리의 일관성 문제다.

## `toAccessScope`는 500개 이하를 언제나 `explicit`으로 준다

```bash
grep -n 'export function shouldUseOrgTeamScope' -A 3 packages/es/src/scoped-query.ts
# return repositoryCount > EXPLICIT_SCOPE_LIMIT   (= 500)
```

HTTP 경로로 `org_team` 표현을 만들려면 픽스처에 저장소 **501개**가 필요하다. 그렇게 만든 시험은
무엇이 실패했는지 읽기 어려우므로, **parity는 함수 수준에서 `AccessScope`를 직접 만들어 건다**
(`repositories/scope-parity.test.ts`). 기존 `authz/team-scope-es.test.ts`도 같은 방식이다.

## 마이그레이션 up → down → up

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm --filter @prs/db run build          # dist/cli.js가 필요하다
pnpm run db:migrate                       # up
pnpm --filter @prs/db exec node dist/cli.js migrate --down --step 1
pnpm run db:migrate                       # 다시 up
docker exec prs-postgres psql -U prs -d prs -c "select to_regclass('<table>');"
```

## 부분 실행 selector (이 WP)

```bash
pnpm run test repositories/cursor
pnpm run test web/lib/repository-overview
pnpm run test:integration repositories/overview
pnpm run test:integration repositories/scope-parity
pnpm run test:integration repositories/registration-request
pnpm run test:integration repositories/reachability
pnpm run test:integration reconcile/durability
pnpm run test:integration ops/pipeline-status
pnpm run test:a11y repositories
cd apps/web && ./node_modules/.bin/playwright test e2e/repositories.spec.ts
```

## 실패했던 명령과 원인 (이 세션)

| 증상 | 원인·해결 |
| --- | --- |
| 통합 시험이 목록을 전부 빈 배열로 돌려줌 | `source.fetch`가 `repositoryIds: []`를 줬는데 `toAccessScope`가 그것을 **빈 `explicit`**으로 만든다. `org_team`을 받으려면 501개가 필요하다 |
| `deps.graphFor is not a function` | `reconcileRepository`는 `sequence_branches`가 비어도 `graphFor`를 부른다. 목을 넣어야 한다 |
| `GitHubApiError`가 안 잡힘 | 생성자가 `(kind, message, options)` 순서다. `('rate_limited', '한도 소진')` |
| 변이 `MISMATCH 0!=1` | CRLF 혼합 (위 참조). **이 통과를 SURVIVED로 읽지 않는다** |
| `no-unused-vars` on rest destructuring | `const { a: _a, ...rest }`는 lint가 잡는다. `Object.fromEntries(Object.entries(x).filter(...))`로 |
| `gheBaseUrl={null}` 타입 오류 | props가 `string | undefined`다. vitest는 통과하지만 `tsc --noEmit`이 잡는다 |

## 이번 세션 최종 배터리 결과

```text
typecheck · lint · lint:deps      통과 (패키지 13개, 위반 0건)
test                              1598 통과 (1 skipped)
test:integration                  72 파일 / 1142 통과
test:regression                   213 통과
test:a11y                         252 통과 (axe 0건)
test:contrast                     80쌍 통과
build                             통과 — /repositories가 동적 라우트로 섬
test:e2e                          108 통과
validate_srs_prd_env.py --strict  main 대비 증감 0 (WARN 1 · ERROR 2)
```

---

# 2026-08-28 CR-051 · DEV-349 세션이 배운 명령

## 이번 세션 최종 배터리 결과

```text
typecheck · lint · lint:deps      통과 (패키지 13개, 위반 0건)
test                              1644 통과 (1 skipped)   [1598 → +46]
test:integration                  74 파일 / 1194 통과      [72/1142 → +52]
test:regression                   213 통과                 [변화 없음]
test:a11y                         262 통과 (axe 0건)       [252 → +10]
test:contrast                     80쌍 통과
build                             통과
test:e2e                          113 통과                 [108 → +5]
validate_srs_prd_env.py --strict  main 대비 증감 0 (WARN 1 · ERROR 2)
```

## 마이그레이션 왕복 (실 PostgreSQL)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm --filter @prs/db run build            # dist/cli.js가 필요하다
pnpm run db:migrate                        # 적용: 017
pnpm --filter @prs/db exec node dist/cli.js migrate --down --step 1   # 회수: 017
pnpm run db:migrate                        # 다시 적용
docker exec prs-postgres psql -U prs -d prs -tAc \
  "select column_name, is_nullable, data_type from information_schema.columns \
   where table_name='saved_search' and column_name='seq_epoch';"
```

CHECK가 실제로 막는지도 확인한다 — `seq_epoch = 0` 삽입이 거절돼야 한다.

## 부분 실행 selector (이 작업)

```bash
pnpm run test sequence-binding
pnpm run test query-builder
pnpm run test search/cursor
pnpm run test web/lib/query-url
pnpm run test web/lib/saved-search
pnpm run test:integration search/sequence-epoch
pnpm run test:integration saved-search/sequence-reference
pnpm run test:integration sequence/range-es
pnpm run test:a11y saved-searches
cd apps/web && ./node_modules/.bin/playwright test e2e/sequence-epoch.spec.ts --reporter=line
```

## 호출부를 훑을 때 glob을 믿지 마라

```bash
# 틀렸다 — globstar가 꺼져 있으면 한 단계만 매칭한다
grep -rn 'buildQuery(' apps/search-api/src/**/*.ts

# 옳다 — 디렉터리를 통째로 준다
grep -rn 'buildQuery(' --include='*.ts' apps packages | grep -v '/dist/'
```

첫 형태를 써서 `sequence/range.ts`를 놓쳤고 그 경로가 500이 됐다. 리뷰가 잡았다.

## 변이 헬퍼에 CRLF 처리가 필요하다

저장소가 CRLF라 `\n`을 담은 앵커가 걸리지 않는다. 헬퍼가 파일의 개행을 보고 앵커를 맞춰야 한다.

```python
crlf = b'\r\n' in data
ob = old.replace('\n', '\r\n').encode() if crlf else old.encode()
```

이것이 없으면 **변이가 안 걸렸는데 시험은 통과**하고, 치환 건수 검증이 없으면 그것을 SURVIVED로
읽는다 (risks 84의 재확인 — 이번에는 M1·M2가 그렇게 나왔다).

## 변이 판정을 세는 법

```text
KILLED       시험이 죽는다
SURVIVED     경로를 읽어라 — 등가인가, 시험 구멍인가, 둘 다 틀린가
무효 변이     동작을 바꾸지 않았다 (같은 값 / 주석만). 킬로 세지 않고 다시 설계한다
```

이번 15종 중 M4(같은 값 표현 교체)와 M8(주석만 삽입)이 무효였다. **킬로 세면 커버리지를
과대평가한다.**

## 공유 prs_test — 픽스처 이름은 유일해야 한다

```bash
# app_user.login과 repository(owner, name)이 유니크다
docker exec prs-postgres psql -U prs -d prs_test -tAc \
  "select conname from pg_constraint where conname like '%_key';"
```

새 시험이 `acme/payments`나 `login: 'kim'`을 쓰면 다른 파일과 충돌한다. **파일 전용 접두**를 쓴다
(`seqepoch/payments`, `sub-cr051-owner`).

그리고 `afterAll`에서 **자기 픽스처를 치우고 나간다** — 남기면 다른 파일의 전역
`DELETE FROM app_user`가 외래 키로 막힌다(이번에 43건이 그렇게 죽었다).

## 실패했던 명령과 원인 (이 세션)

| 증상 | 원인·해결 |
| --- | --- |
| `ANCHOR-FAIL expected 1, found 0` (변이) | CRLF 저장소에 LF 앵커. 헬퍼가 개행을 맞추게 고쳤다 |
| `duplicate key ... app_user_login_key` | 새 시험이 `login: 'kim'`을 썼다. 파일 전용 접두로 |
| `duplicate key ... repository_owner_name_key` | 같은 이유. `acme/payments` → `seqepoch/payments` |
| `violates foreign key ... team_member_user_id_fkey` | 내 픽스처를 안 치우고 나갔다. `afterAll` 추가 |
| 통합 76건 실패 (전 계층) | 기존 시험의 `seq:` 질의가 AC-7에 걸렸다. **의도된 계약 변경**이라 시험을 갱신 |
| `Cannot read properties of undefined (reading 'map')` | 위와 같음 — 400이라 `items`가 없다 |
| a11y `import() type annotations are forbidden` | `type X = import('...')` 대신 `import type`을 쓴다 |
| `AccessScopeSource.fetch`가 문자열을 안 받는다 | `{ userId, login }` 객체다. 시그니처를 확인하고 넘긴다 |

## CI 확인 (변화 없음)

```bash
# 커밋 SHA의 check-runs로 본다 — `gh pr checks`는 옛 실행을 보여 줄 수 있다
gh api repos/89sooner/pr-search/commits/$(git rev-parse HEAD)/check-runs \
  --jq '.check_runs[] | "\(.name)=\(.conclusion)"'
```

## 환경 (재확인)

- Node **v22.23.2** 필수, 셸 기본값 v20.12.0
- 마이그레이션 **017까지**. 컨테이너 3종 healthy, `prs`·`prs_test` 존재
- ES 별칭 v2 (`prs-pull-requests-v2` · `prs-commits-v2`)


---

# 2026-08-29 세션 갱신

## 검증 배터리 (마지막 실행 결과 — main `d3b2590`)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                # 통과
pnpm lint                     # 통과 — 마지막 파일까지 쓴 뒤 다시 돌릴 것
pnpm run lint:deps            # 패키지 13개, 위반 0건
pnpm run test                 # 단위 1710 통과 (1 skipped)   [1665 → +45]
pnpm run test:integration     # 78 파일 / 1254 통과           [76/1210 → +2/+44]
pnpm run test:regression      # 231 통과                      [213 → +18]
pnpm run test:perf analytics  # 5 통과 — 요청/회 2.0, 총 104회
pnpm build                    # 통과
```

## `pnpm test:perf` — 이 세션이 만들었다 (DEV-058)

```bash
pnpm run test:perf analytics
PERF_DATASET_SIZE=50000 pnpm run test:perf analytics   # 큰 규모
PERF_WARMUP=5 PERF_MEASURE=20 pnpm run test:perf analytics
```

**요청 수가 핵심이다.** 지연은 데이터 크기를 따라가지만 "그룹마다 다시 묻는가"는 크기와
무관하게 참이거나 거짓이다. 클러스터를 부르는 모든 길(`search`·`count`·`msearch`)을 센다 —
`search`만 세다가 `_count` 왕복을 놓친 적이 있다.

**여기 수치를 `NFR-001` 통과로 적지 않는다.** 릴리스 규모(PR 1,000,000)는 Gate 5의 몫이다.

## 통합 시험을 새로 쓸 때 — 공유 자원 규율

```bash
# 단독으로 통과해도 전량에서 깨질 수 있다. 둘 다 돌린다.
pnpm run test:integration analytics       # 단독
pnpm run test:integration apps/search-api # 이웃과 함께
pnpm run test:integration                 # 전량 (약 2분 40초)
```

- 질의를 **자기 저장소로 한정**한다. `query: ''`(전역)는 남의 문서를 센다
- 삭제도 **자기 행만** — `match_all`이나 `DELETE FROM x`는 남의 픽스처를 지운다
- 유니크 값(`slug`·`login`·`github_user_id`)을 **파일마다 고유하게**. `github_user_id`는
  로컬에 없어도 CI에서 충돌한 적이 있다

## 변이 시험 — 스코프를 맞춰야 죽는다

같은 변이가 스코프에 따라 살거나 죽는다. `analytics` 통합만 돌려 `M12`(투영)·`M13`(회귀)이
살아남았고, 올바른 스코프에서 둘 다 죽었다.

```bash
pnpm run test <경로>                  # 투영·순수 함수
pnpm run test:regression              # 도달성·계약 문자열
pnpm run test:integration <범위>      # 실제 인덱스 위의 수
```

## ES 동작 실측 (근사 설계에 필요했다)

```bash
# `track_total_hits`는 상한까지만 센다 — 문서 5건에 3을 걸면 { value: 3, relation: 'gte' }
curl -s -X POST "localhost:9200/prs-pull-requests/_search?size=0" -H 'Content-Type: application/json' \
  -d '{"track_total_hits": 3, "query": {"match_all": {}}}'

# `_count`는 정확하다
curl -s -X POST "localhost:9200/prs-pull-requests/_count" -H 'Content-Type: application/json' \
  -d '{"query": {"match_all": {}}}'

# `random_sampler`가 이 클러스터(8.19)에서 도는가
curl -s -X POST "localhost:9200/prs-pull-requests/_search?size=0" -H 'Content-Type: application/json' \
  -d '{"aggs":{"s":{"random_sampler":{"probability":0.5},"aggs":{"c":{"value_count":{"field":"pr_number"}}}}}}'
```

## `gh` 사용 시 주의 (이 환경의 버전)

```bash
gh pr checks 76 --json name,bucket        # ✗ unknown flag: --json
gh pr view 76 --json statusCheckRollup    # ✓
gh run list --branch <name>               # ✗ unknown flag: --branch
gh api "repos/OWNER/REPO/commits/$SHA/check-runs"  # ✓ 커밋 SHA로 확인
```

CI 실패 로그:

```bash
SHA=$(git rev-parse <branch>)
RUN=$(gh api "repos/89sooner/pr-search/commits/$SHA/check-runs" \
  --jq '.check_runs[] | select(.conclusion=="failure") | .details_url' | head -1)
gh api "repos/89sooner/pr-search/actions/jobs/${RUN##*/}/logs" | grep -E 'FAIL|Error'
```

# 2026-08-29 (2차) 세션 — design-system 배포 · WP-038

## design-system 토큰 추가 배터리 (전부 돌려야 CI와 맞는다)
```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
cd /home/roqkf/design-system
pnpm --filter @conductor-by-89soone/tokens run build   # 검증+생성물+대비 한 번에
pnpm typecheck && pnpm test && pnpm lint && pnpm lint:tokens
pnpm check:api            # ★ 놓치기 쉽다. 드리프트면 --update
pnpm check:contrast       # 새 쌍 자동 포함
pnpm size && pnpm check:changesets
pnpm audit --audit-level high   # ★ 릴리스 전제. 실패하면 pnpm.overrides
```

## Conductor 릴리스 (changesets)
```bash
# CR PR 병합 → version PR(#N) 자동 생성 → squash 병합(봇 저자 유지) →
gh workflow run release.yml --ref main          # publish 잡 수동 실행(승인 게이트)
gh api "repos/89sooner/design-system/actions/runs/<RID>/jobs" --jq '.jobs[]|"\(.name):\(.status)/\(.conclusion)"'
npm view @conductor-by-89soone/tokens version   # 0.2.0 확인
```

## WP-038 검증
```bash
cd /home/roqkf/pr-search
pnpm --filter @prs/web run typecheck && pnpm lint
pnpm run test web/lib/analytics && pnpm run test:a11y analytics
pnpm run test:contrast          # dataviz 포함 232/232
pnpm --filter @prs/web run build   # e2e 전 필수
cd apps/web && ./node_modules/.bin/playwright test e2e/flow-005.spec.ts --reporter=line
```
gh 주의: `gh run view --json jobs`는 이 버전에서 실패 → `gh api .../runs/<id>/jobs`.

---

# 2026-08-29 (3차) 세션 — CR-054 · WP-039

## 검증 배터리 (마지막 실행 결과 — main `6bdf395`)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                # 통과
pnpm lint                     # 통과 — 마지막 파일까지 쓴 뒤 다시 돌릴 것
pnpm run lint:deps            # 패키지 13개, 위반 0건
pnpm run test                 # 단위 1790 통과 (1 skipped)   [1736 → +54]
pnpm run test:integration     # 84 파일 / 1324 통과           [83/1254 → +1/+70]
pnpm run test:regression      # 267 통과                      [231 → +36]
pnpm run test:a11y            # 283 통과 (audit 9, axe 0)     [272 → +11]
pnpm run test:contrast        # 232/232
pnpm --filter @prs/web run build   # e2e 전 필수
pnpm run test:e2e             # 131 통과 (audit 9)
pnpm build                    # 통과
```

## 미해결 리뷰를 세는 법 (이 세션이 배운 것)

**잘림을 드러내지 않는 계수는 "0건"을 다시 만든다.** 처음 쓴 명령이 `last:25`였고
그것으로 22건이 나왔는데, `last:100`으로 다시 세니 **26건**이었다 — `PR #32`·`#49`가
조용히 빠져 있었다(PR #86 리뷰 P2가 예측한 그대로다).

```bash
gh api graphql -f query='
{ repository(owner: "89sooner", name: "pr-search") {
    pullRequests(last: 100, states: [OPEN, MERGED]) {
      pageInfo { hasPreviousPage }
      nodes { number state
        reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { isResolved } } } } } }' \
  > /tmp/t.json
```

그 뒤 두 `pageInfo`를 읽어 **잘렸는지 먼저 판정한다.**

```python
import json
d = json.load(open('/tmp/t.json'))
prs = d['data']['repository']['pullRequests']
total, truncated = 0, []
for pr in prs['nodes']:
    rt = pr['reviewThreads']
    un = [t for t in rt['nodes'] if not t['isResolved']]
    if rt['pageInfo']['hasNextPage']:
        truncated.append(pr['number'])
    if un:
        print(f"PR #{pr['number']} ({pr['state']}): {len(un)}")
        total += len(un)
print('총 미해결:', total)
print('PR 목록이 잘렸나:', prs['pageInfo']['hasPreviousPage'])
print('스레드가 잘린 PR:', truncated or '없음')
```

**두 `pageInfo`를 반드시 읽는다.** 하나라도 참이면 그 수는 **하한**이며 그 사실을 함께
말한다.

**`--paginate`를 쓰지 마라 — 느린 것이 아니라 틀린 답을 낸다.** 이 저장소에서 실제로
돌려 보니 4분을 넘겨 타임아웃했고, 백그라운드에서 끝까지 돌린 결과는 **PR 다섯
(`#49`·`#65`·`#66`·`#67`·`#68`)을 두 번 세고 `#32`를 아예 빼먹었으며
`cannot iterate over: null`로 끝났다.** 중첩 연결(`reviewThreads`)에도 `pageInfo`가 있으면
`gh`가 어느 커서를 따라갈지 정하지 못한다.

**중복은 과다 계수를, 누락은 과소 계수를 만든다 — 둘이 섞이면 어느 쪽으로 틀렸는지도
알 수 없다.** 상한을 100으로 올리고 **잘렸는지를 검사하는** 쪽이 정직하다: 잘리지 않았으면
그 수가 정확하고, 잘렸으면 그 사실이 드러난다.

**"고쳤다"와 "스레드가 닫혔다"는 다른 사실이다.** 머지 후 이것으로 센다.

## 리뷰 답변·해소 (GraphQL)

```bash
gh api graphql -f query='mutation { addPullRequestReviewThreadReply(input: {
  pullRequestReviewThreadId: "PRRT_...", body: "..." }) { comment { id } } }'
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_..."}) {
  thread { isResolved } } }'
```

병합된 PR의 스레드도 resolve된다 — `PR #81`에서 실제로 확인했다.

## 관리 롤 실측 (DEV-421)

```bash
# prs_admin은 NOLOGIN 그룹 롤이다. 로그인 주체 + 멤버십 + SET ROLE.
# `<PW>`는 이 실측에서만 쓰고 바로 지우는 값이다 — 문서에 리터럴로 남기지 않는다.
PW=$(openssl rand -hex 8)
docker exec prs-postgres psql -U prs -d prs_test -c \
  "CREATE ROLE prs_ret LOGIN PASSWORD '$PW'; GRANT prs_admin TO prs_ret;"
docker exec -e PGPASSWORD="$PW" prs-postgres psql -U prs_ret -h localhost -d prs_test -c "
  SET ROLE prs_admin;
  CREATE TABLE t PARTITION OF audit_record FOR VALUES FROM ('2019-01-01') TO ('2019-02-01');"
# GRANT ALL만으로는: ERROR: permission denied for schema public
docker exec prs-postgres psql -U prs -d prs_test -c "DROP ROLE IF EXISTS prs_ret;"
```

## 변이 시험 — 치환 건수를 반드시 확인한다

```bash
python3 mutate.py <path> "<old>" "<new>"   # 정확히 1건일 때만 치환, CRLF 보존
```

`APPLIED (1)`이 아니면 그 변이는 **걸리지 않은 것**이며 "SURVIVED"가 오독이 된다.

## 통합 전량은 출력을 파일로 남긴다

```bash
pnpm run test:integration > /tmp/integration-$(date +%s).log 2>&1
grep -E "^ FAIL" /tmp/integration-*.log
```

`DEV-420`이 그 규율이 없어 세 세션을 떠돌았다. 파일 순서가 바뀔 때만 드러나는 오염은
**실패한 회차의 로그가 없으면 귀속할 수 없다.**

## 문서 검증기 — 판정은 언제나 main 대비 diff

```bash
python3 ~/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py --strict \
  2>&1 | grep -E "^(WARN|ERROR)" | sort > /tmp/branch.txt
git stash -q && python3 ...같은 명령... > /tmp/main.txt && git stash pop -q
comm -13 /tmp/main.txt /tmp/branch.txt   # 새로 생긴 것만
```

**주의: `미정정`처럼 `미정`을 포함하는 낱말이 placeholder 검사에 걸린다.**
"아직 고쳐지지 않은"으로 바꿔 쓴다.

---

# 2026-08-30 세션 — CR-055 · WP-040

## 검증 배터리 (마지막 실행 결과 — 브랜치 `35b9ff0`)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                # 통과
pnpm lint                     # 통과 — 마지막 파일까지 쓴 뒤 다시 돌릴 것
pnpm run lint:deps            # 패키지 13개, 위반 0건
pnpm run test                 # 단위 1850 통과 (1 skipped)   [1790 → +60]
pnpm run test:regression      # 282 통과                      [267 → +15]
```

**돌리지 않은 것**: `test:integration` · `test:e2e` · `test:a11y` · `test:contrast` ·
`pnpm build`. 화면이 서지 않아 그 계층의 검증이 성립하지 않는다 — **통과가 아니라
미실행이다.** 다음 에이전트가 화면을 세운 뒤 전량을 돌린다.

## 인계 팩 신선도 판정 — LF로 정규화한 뒤 비교한다

원시 바이트 해시로 비교하면 **일곱 파일 전부 STALE로 오판**된다. 저장소가 CRLF이고
`core.autocrlf=true`이기 때문이다.

```python
import json, hashlib
m = json.load(open('agent-context/_handoff/manifest.json'))
for f in m['files']:
    raw = open(f['source_path'], 'rb').read()
    lf = raw.replace(b'\r\n', b'\n')
    state = ('FRESH(raw)' if hashlib.sha256(raw).hexdigest() == f['sha256']
             else 'FRESH(lf)' if hashlib.sha256(lf).hexdigest() == f['sha256']
             else 'STALE')
    print(state, f['source_path'])
```

manifest의 키는 `source_path`이지 `src`가 아니다.

## CRLF를 보존하는 편집 헬퍼

파일이 CRLF면 **인자의 개행도 CRLF로 맞춘 뒤** 찾아야 한다. 그러지 않으면 멀티라인
검색이 조용히 0건이 되고 "고쳤다"가 거짓이 된다.

```python
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(path, 'rb').read()
crlf = b'\r\n' in raw
enc = lambda s: s.encode('utf-8').replace(b'\n', b'\r\n') if crlf else s.encode('utf-8')
ob, nb = enc(old), enc(new)
n = raw.count(ob)
if n != 1:
    print(f'SKIPPED ({n}) {path}'); sys.exit(1)
open(path, 'wb').write(raw.replace(ob, nb, 1))
print(f'APPLIED (1) {path}')
```

`APPLIED (1)`이 아니면 그 편집은 **일어나지 않은 것**이다.

## 새 파일을 만든 뒤에는 개행을 정규화한다

`Write` 도구가 만든 파일은 LF다. 저장소 작업 트리는 CRLF이므로 맞춰 둔다.

```python
import re
raw = open(path, 'rb').read()
open(path, 'wb').write(re.sub(rb'(?<!\r)\n', b'\r\n', raw))
```

## 셸 heredoc과 인용의 함정 둘 — 이번에 둘 다 밟았다

**1. SQL의 작은따옴표가 사라진다.** 셸의 작은따옴표 문자열로 SQL을 넘기면
`DEFAULT 'pending'`이 `DEFAULT pending`이 된다. bash에서 `'...''...'`는 두 문자열의
연결이라 따옴표가 소실된다. 파이썬 heredoc 안의 문자열로 쓰고 **넣은 뒤 눈으로
확인한다.**

**2. 본문에 구분자와 같은 낱말이 있으면 heredoc이 일찍 끝난다.** 이 파일에 넣을
내용 안에 heredoc 구분자와 같은 문자열이 있어 스크립트가 잘렸고, 셸이 입력을
기다리다 2분 타임아웃으로 죽었다. **긴 문서를 넣을 때는 heredoc 대신 파일로 쓴 뒤
읽어 붙인다.**

```bash
# 안전한 형태: 내용을 파일로 먼저 쓰고 짧은 스크립트로 붙인다
python3 -c "
import re
add = open('/tmp/.../append.md','rb').read()
raw = open('agent-context/commands.md','rb').read()
open('agent-context/commands.md','wb').write(
    raw.rstrip(b'\r\n') + b'\r\n' + re.sub(rb'(?<!\r)\n', b'\r\n', add))
"
```

## ID는 실측한다 — 연속의 다음이 비어 있다고 가정하지 마라

```bash
grep -rohE 'CR-[0-9]{3}' docs/ | sort -u | tail -1
grep -rohE 'DEV-[0-9]{3}' docs/ | sort -u | tail -1
grep -rohE '\bC-0[0-9]{2}\b' docs/ | sort -u | tail -1
ls packages/db/migrations/*.up.sql | tail -1
```

`C-047` 다음이 `C-048`이라고 가정했다가 그것이 이미 `GhContextHeader`임을 발견했다.
실측한 next-free는 `C-071`이었다 — 다른 축(GitHub Operations)이 중간 대역을 배정해
두었다.

## open DEV 계수 — 상태를 굵게 쓰면 안 잡힌다

```bash
grep -cE '^\| DEV-[0-9]{3} .*\| open' docs/40_delivery/pr_search_implementation_traceability.md
grep -E '^\| DEV-[0-9]{3} .*\| open' docs/40_delivery/pr_search_implementation_traceability.md \
  | sed -E 's/^\| (DEV-[0-9]{3}) .*/\1/' | tr '\n' ' '
```

두 번째 명령은 **행의 첫 칸만** 뽑는다. `grep -oE 'DEV-[0-9]{3}'`로 뽑으면 행 본문의
참조까지 딸려 나와 목록이 부풀어 오른다.

## 문서 검증기 — 판정은 언제나 main 대비 diff

```bash
python3 ~/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py --strict \
  2>&1 | grep -E "^(WARN|ERROR)" | sort > /tmp/branch.txt
git stash -q && python3 ...같은 명령... > /tmp/main.txt && git stash pop -q
comm -13 /tmp/main.txt /tmp/branch.txt   # 새로 생긴 것만
```

이번 결과: **새 ERROR 0건 · 새 WARN 0건.** 기존 경고 3건은 그대로 두었다.

## 추가한 표 행의 칸 수를 센다 (DEV-399가 남긴 결함 유형)

```python
import re, subprocess
diff = subprocess.run(['git','diff','-U0'], capture_output=True, text=True).stdout
for line in diff.splitlines():
    if not line.startswith('+') or line.startswith('+++'): continue
    s = line[1:]
    if not (s.startswith('| ') and s.rstrip().endswith('|')): continue
    cols = re.sub(r'`[^`]*`', '`X`', s).count('|') - 1
    print(cols, s[:70])
```

코드 스팬 안의 파이프를 먼저 지워야 오탐이 없다.

## CI 확인 — 커밋 SHA의 check-runs로 본다

```bash
SHA=$(git rev-parse HEAD)
gh api "repos/89sooner/pr-search/commits/$SHA/check-runs" \
  --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion // "-")"'
```

PR #88은 `verify`·`integration` 둘 다 success였다.

## 리뷰 스레드 읽기·답변·해소

```bash
gh api graphql -f query='
{ repository(owner: "89sooner", name: "pr-search") {
    pullRequest(number: 88) {
      reviewThreads(first: 100) {
        nodes { id isResolved path line
          comments(first:1){ nodes { author{login} body } } } } } } }'
```

답변과 해소는 `addPullRequestReviewThreadReply`·`resolveReviewThread` 뮤테이션이다
(전문은 위 「리뷰 답변·해소」 절). PR #88의 네 스레드를 그렇게 처리했다.

## 실패했던 명령과 원인 (이 세션)

| 명령 | 실패 | 원인 |
| --- | --- | --- |
| 신선도 판정 스크립트 | `MISSING None` 일곱 | manifest 키가 `src`가 아니라 `source_path`다 |
| 멀티라인 치환 | `SKIPPED (0)` | 헬퍼가 CRLF를 몰랐다. 인자의 개행을 맞춰 고쳤다 |
| 마이그레이션 020 DDL 삽입 | 작은따옴표 소실 | 셸의 작은따옴표 문자열 안에서 연결로 해석됐다 |
| 인계 문서 append | 2분 타임아웃 | 본문에 heredoc 구분자와 같은 낱말이 있었다 |
| `pnpm run test` | `runtime.test.ts` 넷 실패 | `requestQueue`를 조건 없이 만들어 `createCursorSigner`가 기동 중에 던졌다 |
| `pnpm run test:regression` | 둘 실패 | 기존 시험이 잡 유형 목록의 리터럴 전문을 단언하고 있었다 |
| open DEV 계수 | 13에서 늘지 않음 | `DEV-433`의 상태를 굵게 썼다 |

일곱 모두 **명령의 문제가 아니라 내가 만든 문제**였고, 셋은 기존 시험이 잡았다.

---

# 2026-08-30 (2차) 세션 — WP-040 완주

## 검증 배터리 (마지막 실행 결과 — main `7e462e9`)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                     # 통과
pnpm lint                          # 통과 — 마지막 파일까지 쓴 뒤 다시 돌릴 것
pnpm run lint:deps                 # 패키지 13개, 위반 0건
pnpm run test                      # 단위 1856 통과 (1 skipped)   [1850 → +6]
pnpm run test:integration          # 1389 통과 (88 파일)          [1324 → +65]
pnpm run test:regression           # 284 통과                     [282 → +2]
pnpm run test:a11y                 # 346 통과 (axe 0)             [283 → +63]
pnpm run test:contrast             # 232/232
pnpm --filter @prs/web run build   # e2e 전에 필수
pnpm run test:e2e                  # 147 통과 (플레이크 0)         [131 → +16]
pnpm build                         # 통과
```

## 마이그레이션 왕복 + 제약 실증 (실 PostgreSQL)

`up → down → up`만으로는 부족하다. **제약이 실제로 막는지**와 **기존 행을 소급하지 않는지**를 함께 본다.

```bash
pnpm --filter @prs/db run build              # dist/cli.js가 필요하다
pnpm run db:migrate                          # up
docker exec prs-postgres psql -U prs -d prs -tAc \
  "select conname, pg_get_constraintdef(oid) from pg_constraint
    where conrelid='repository_registration_request'::regclass order by conname;"
pnpm --filter @prs/db exec node dist/cli.js migrate --down --step 1
# down 상태에서 기존 행을 하나 넣고
pnpm run db:migrate                          # 다시 up — 그 행이 기본값을 갖는지 본다
```

제약 검증은 `BEGIN … SAVEPOINT … ROLLBACK`으로 감싼 `DO $$ … EXCEPTION WHEN check_violation`을 쓴다. 데이터를 남기지 않고 "정말 거절하는가"를 잰다.

## 변이가 살아남으면 등가인지 먼저 묻는다

```text
살아남음 → "이 변이가 실제로 무엇을 바꾸는가"
         ├─ 성질을 안 바꾼다 → 등가. 그 성질을 정말 깨는 변이를 따로 만들어 시험이 잡는지 확인
         └─ 성질을 바꾼다   → 시험 구멍. 시험을 더한 뒤 같은 변이로 킬 확인
```

이번 세션의 `M6`이 전자, `M8`이 후자였다. **둘을 가르지 않으면 하나는 반드시 잘못 처리된다.**

## 미해결 리뷰를 세는 법 (두 저장소)

**상한을 30으로 두면 안 된다** (DEV-446). `DEV-425`가 이미 고친 결함이 이 문서에서
되살아났다 — 병합 PR이 90개를 넘은 지금 `last: 30`은 `PR #32`·`#49`를 조용히 빼고
**24건을 22건이라 답한다.** 두 `pageInfo`를 함께 읽어 **잘렸는지 먼저 판정한다.**

```bash
for repo in pr-search design-system; do
  echo "=== $repo ==="
  gh api graphql -f query="
  { repository(owner: \"89sooner\", name: \"$repo\") {
      pullRequests(last: 100, states: MERGED) {
        totalCount
        pageInfo { hasPreviousPage }
        nodes { number reviewThreads(first: 100) {
          pageInfo { hasNextPage } nodes { isResolved } } } } } }" \
    --jq '.data.repository.pullRequests as $prs
      | "조회 \($prs.totalCount)개 · 앞쪽 잘림=\($prs.pageInfo.hasPreviousPage) · 스레드 잘림=\([$prs.nodes[]|select(.reviewThreads.pageInfo.hasNextPage)]|length)건",
        ([$prs.nodes[] | {n: .number, u: ([.reviewThreads.nodes[]|select(.isResolved|not)]|length)} | select(.u > 0)]
         | "총 \([.[].u]|add // 0)건: " + ([.[] | "#\(.n)(\(.u))"] | join(" ")))'
done
```

`앞쪽 잘림=true`이거나 `스레드 잘림`이 0이 아니면 **그 수는 하한이며 그 사실을 함께
말한다.** `--paginate`는 이 저장소 규모에서 4분을 넘겨 쓰지 못한다.

2026-08-30 3차 실측(잘림 없음): pr-search 26건 · design-system 9건.

## CI가 "실패"인데 코드 문제가 아닐 때

```bash
gh run view <RID> | grep -A 3 ANNOTATIONS
gh api "repos/89sooner/pr-search/actions/runs/<RID>/jobs" --jq '.jobs[] | {name, conclusion, steps: [.steps[]|.name]}'
```

`steps`가 **비어 있고** 주석이 `The job was not started because recent account payments have failed`를 말하면 **잡이 뜨지도 않은 것**이다. 재시도 1회(`gh run rerun <RID>`)로 확인한 뒤 로컬 배터리로 판정하고 그 사실을 적는다. **실제 시험 실패를 이것으로 부르지 않는다.**

## Playwright 목은 한 핸들러로 합친다

라우트는 **나중에 등록한 것이 먼저** 매칭된다. `**/jobs**`를 `**/jobs/*`보다 뒤에 두면 그것이 `/jobs/11`의 `PATCH`까지 삼킨다.

```ts
await page.route('**/api/admin/jobs**', async (route) => {
  const jobId = /\/jobs\/(\d+)$/.exec(new URL(route.request().url()).pathname)?.[1];
  if (jobId !== undefined) { /* 제어 */ }
  return /* 목록 */;
});
```

## Conductor 계약은 `.d.ts`를 열어 본다

```bash
cat apps/web/node_modules/@conductor-by-89soone/react/dist/{status,feedback,form,overlay,surface,data,action,types}.d.ts
```

이번에 틀렸던 것: `StatusBadge`는 `children` 대신 `status`·`icon`·`label`, `Meter`는 `valueText` 필수, `Table`은 `caption` prop, `Button.size`는 `sm`·`md`뿐이고 `danger`는 `variant`가 아니라 `tone`이다.

## 부분 실행 selector (이 WP)

```bash
pnpm run test web/lib/ops-jobs
pnpm run test:integration admin/registration-request-lifecycle
pnpm run test:integration reconcile/manual-run
pnpm run test:integration sequence/assign-runner
pnpm run test:integration jobs/cancel-race
pnpm run test:integration admin/repositories
pnpm run test:a11y ops-
cd apps/web && ./node_modules/.bin/playwright test e2e/flow-007.spec.ts e2e/flow-008.spec.ts --reporter=line
```

## 실패했던 명령과 원인 (이 세션)

| 증상 | 원인·해결 |
| --- | --- |
| 멀티라인 치환 `SKIPPED (0)` | 파일이 CRLF인데 파이썬 문자열이 LF였다. 개행을 맞춘 뒤 재실행 |
| `enqueueJob`이 `null value in column "target"` | 시그니처를 객체로 가정했다. 실제는 `(db, type, target, requestedBy, progress?)` |
| 시험이 `probe.entries === 0`을 기대했는데 4 | 주기 스윕은 첫 순회에 곧바로 돈다(`lastScheduledAt === null` 갈래). 집힘은 `started_at`으로 잰다 |
| 채번 예약 시험이 "잡 하나"를 기대했는데 둘 | 등록 자체가 이미 하나를 예약했다. 차분으로 세도록 고침 |
| `ResizeObserver is not defined` | Radix `Switch`가 `use-size`를 지난다. `a11y/setup.ts`에 대역 추가 |
| e2e 제어 요청이 목록 응답을 받음 | Playwright 라우트가 나중 등록 우선이다. 한 핸들러로 합침 |
| `gh pr merge --admin`이 차단됨 | `--admin` 없이 실행하면 통과한다 |

---

# 2026-08-30 (2차 후속) — PR #89 머지 후 리뷰 넷

**병합 직전 스레드 0건 → 병합 뒤 넷 도착.** 전부 실결함이었고 `DEV-439`~`442`로 등재·해소했다.

| 등급 | 지적 | 고친 방법 |
| --- | --- | --- |
| P1 | 취소된 조정 스캔이 계속 돈다 | `runReconcileSweep`에 취소 신호를 넘긴다. **저장소 사이에서만** 본다 — 조정 중간에 끊으면 되돌리기가 부분으로 남는다 |
| P2 | `PATCH`가 좁힌 동작을 강제하지 않는다 | `applyJobAction`이 전이보다 **먼저** 유형별 목록을 확인하고 `unsupported_action`을 낸다 |
| P2 | 409에 실행 중 잡 ID가 없다 | `CreateJobOutcome.conflict`가 `jobId`를 담는다. **경합에서 진 요청도 이긴 행을 다시 읽는다** |
| P2 | 요청 큐 기본 필터가 `pending`이 아니다 | 계약대로 기본값을 두고, 이력은 `status`를 명시해 본다 |

## 이 리뷰가 되돌려 물은 것

**"취소가 완료로 덮이지 않는다"를 다섯 유형 전부에 걸었는데 그것으로 충분하지 않았다.** 그 성질은 **잡 행의 라벨**에 관한 것이었고, **일이 실제로 멈추는가**는 묻지 않았다. `DEV-436`과 `DEV-439`는 같은 조작의 서로 다른 절반이다.

**화면과 서버를 같은 세션에서 만들면 어긋남이 시험에 나타나지 않는다.** 화면이 `detail.job_id`를 읽도록 썼고 서버는 싣지 않았는데, e2e 목이 **계약이 아니라 내 가정**을 흉내 내 초록이었다. 목은 계약 문서의 필드 이름을 보고 만든다.

## 문서 갱신

- `pr_search_api_contracts.md` `v0.18` — 409의 `detail.job_id`, `PATCH`의 유형별 제한
- `pr_search_async_events_jobs.md` `v0.6` — "중단은 상태 보존이 아니라 실행 정지다"
- 원장 `v6.3` — 6.52.4장, `DEV-439`~`442`

## 세션 종료 절차 (2026-08-30 2차에 실제로 쓴 순서)

```bash
# 1. 병합 후 재확인 — 병합으로 끝내지 않는다
git rev-parse --short HEAD
gh pr list --state open --json number --jq 'length'
for n in <이번 세션 PR들>; do
  gh api graphql -f query="{ repository(owner:\"89sooner\",name:\"pr-search\"){
    pullRequest(number:$n){ reviewThreads(first:100){ totalCount nodes{isResolved} } } } }" \
    --jq "\"#$n: total=\(.data.repository.pullRequest.reviewThreads.totalCount) unresolved=\([.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved|not)]|length)\""
done

# 2. worklog (Obsidian)
python3 ~/.claude/skills/obsidian-second-brain/scripts/worklog.py path --title "<제목>" --json
python3 ~/.claude/skills/obsidian-second-brain/scripts/worklog.py check "<경로>"
python3 ~/.claude/skills/obsidian-second-brain/scripts/worklog.py index

# 3. 인계 팩
python3 ~/.claude/skills/agent-context-handoff/scripts/context_handoff.py \
  build --root . --source agent-context --output agent-context/_handoff

# 4. 전사 — exports/ 아래에 두고 **무시 규칙을 실측한다**
#    /export exports/YYYYMMDDhhmm.md   (클라이언트 슬래시 명령)
git check-ignore -v exports/<파일>.md      # .gitignore:24의 exports/가 잡아야 한다
```

## 리뷰 스레드 답변·해소 (이번 세션이 넷에 썼다)

```bash
gh api graphql -f query='
  mutation($t: ID!, $b: String!) {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $t, body: $b}) { comment { id } } }' \
  -f t="$THREAD_ID" -f b="$BODY"

gh api graphql -f query='
  mutation($t: ID!) { resolveReviewThread(input: {threadId: $t}) { thread { isResolved } } }' \
  -f t="$THREAD_ID"
```

스레드 ID는 `reviewThreads(first: 100) { nodes { id path } }`로 얻는다. **일괄 resolve하지 않는다** — 답변에 근거를 적고 하나씩 닫는다.

## `.gitignore`를 자를 때 규칙을 놓친다

`head -20`으로 읽었더니 24행의 `exports/`를 못 봤다. 무시 여부는 **파일을 읽어 추측하지 말고** `git check-ignore -v <경로>`로 판정한다.

---

# 2026-08-31 세션 — DEV-414 청산

## 미해결 리뷰를 세는 법 (정본 — 스크립트가 대신한다, DEV-468)

**상한을 키우는 방식은 언젠가 반드시 그 상한에 닿는다.** `DEV-425`가 창을 30에서 100으로 넓혔고 `DEV-446`이 그것이 되돌아간 것을 잡았는데, `CR-057` 병합으로 병합 PR이 **101개**가 되자 `last: 100`이 앞쪽 하나를 조용히 잘랐다. 그래서 아래 스크립트가 정본이며 **커서로 끝까지 순회하고 순회한 수가 `totalCount`와 같은지 스스로 확인한다.**

**창은 둘이다** (DEV-469). 병합 PR 목록과 **각 PR의 리뷰 스레드 목록**이며 둘 다 순회해야 한다. 안쪽을 "잘렸다"고 보고만 하고 판정에 넣지 않으면 그 PR의 두 번째 페이지에 있는 미해결 리뷰가 0건으로 보고된다 — `DEV-468`이 바깥만 고치고 안쪽을 그대로 둔 것이 그 자리였고, 옛 한 줄 명령의 `스레드 잘림=N건`도 출력만 하는 값이었다.

```bash
python3 agent-context/count-unresolved-reviews.py              # 두 저장소
python3 agent-context/count-unresolved-reviews.py pr-search    # 하나만
```

"전량 순회=아니다"가 나오면 **그 답을 쓰지 마라** — 종료 코드도 1이다. 그 판정은 두 창을 함께 본다: 순회한 PR 수가 `totalCount`와 같은지, 그리고 **PR마다** 순회한 스레드 수가 그 PR의 `totalCount`와 같은지.

**변이 둘로 확인했다.** 안쪽 창을 `first: 1`로 줄여도 답과 종료 코드가 같다 — 페이지네이션이 실제로 돌기 때문이며, 이 변이가 살아남는 것이 옳은 동작이다. 순회 자체를 제거하면 41개 PR을 "스레드를 다 세지 못했다"로 잡고 종료 코드 1을 낸다.

아래는 그 스크립트가 대신하기 전의 한 줄 형태다. **지금은 쓰지 않는다** (병합 PR 100개를 이미 넘었다). 어떤 결함을 거쳐 왔는지 남겨 두기 위해 보존한다 — `DEV-446`이 정정한 형태이며, 상한 100과 두 `pageInfo`가 함께 있어야 한다는 것이 그때의 교훈이었다.

```bash
for repo in pr-search design-system; do
  echo "=== $repo ==="
  gh api graphql -f query="
  { repository(owner: \"89sooner\", name: \"$repo\") {
      pullRequests(last: 100, states: MERGED) {
        totalCount
        pageInfo { hasPreviousPage }
        nodes { number reviewThreads(first: 100) {
          pageInfo { hasNextPage } nodes { isResolved } } } } } }" \
    --jq '.data.repository.pullRequests as $prs
      | "조회 \($prs.totalCount)개 · 앞쪽 잘림=\($prs.pageInfo.hasPreviousPage) · 스레드 잘림=\([$prs.nodes[]|select(.reviewThreads.pageInfo.hasNextPage)]|length)건",
        ([$prs.nodes[] | {n: .number, u: ([.reviewThreads.nodes[]|select(.isResolved|not)]|length)} | select(.u > 0)]
         | "총 \([.[].u]|add // 0)건: " + ([.[] | "#\(.n)(\(.u))"] | join(" ")))'
done
```

2026-08-31 실측(CR-057 병합 전): **양쪽 0건** (pr-search 95개 · design-system 11개, 잘림 없음).

**CR-057 병합 후 실측**(스크립트): pr-search 101개 전량 순회 · design-system 12개 전량 순회 · **양쪽 미해결 0건.** 이때 옛 한 줄 형태는 `앞쪽 잘림=true`를 답했다 — 잘린 PR에도 미해결이 없어 답 자체는 같았으나, **틀릴 수 있는 상태로 돌고 있었다는 것**이 결함이다.

## 스레드 본문을 한 번에 모아 판정한다

전수 대조는 스레드마다 GitHub을 여는 것보다 한 번에 받아 파일로 두는 편이 빠르다.

```bash
gh api graphql -f query='
{ repository(owner:"89sooner",name:"pr-search"){
    pullRequests(last: 100, states: MERGED) {
      nodes { number reviewThreads(first: 100) {
        nodes { id isResolved path line
          comments(first: 1) { nodes { author{login} createdAt body } } } } } } } }' > threads.json
```

`id`가 곧 답변·해소의 인자다. 판정 결과를 같은 JSON에 적어 두면 그것이 매트릭스가 된다.

## 답변·해소를 일괄로 돌릴 때

**한 스레드씩 `inspect → reply → resolve`를 끝내고 다음으로 간다.** 실패해도 같은 mutation을 반복하지 않는다 (secondary rate limit).

```bash
for f in replies/*.md; do
  tid=$(basename "$f" .md)
  gh api graphql -f query='mutation($t: ID!, $b: String!) {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $t, body: $b}) { comment { id } } }' \
    -f t="$tid" -f b="$(cat "$f")" > /dev/null \
  && gh api graphql -f query='mutation($t: ID!) {
    resolveReviewThread(input: {threadId: $t}) { thread { isResolved } } }' \
    -f t="$tid" --jq '.data.resolveReviewThread.thread.isResolved'
done
```

이 세션이 33건을 이 방식으로 처리했고 rate limit에 걸리지 않았다.

## design-system 검증 배터리

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
cd ~/design-system
pnpm typecheck && pnpm lint && pnpm lint:deps && pnpm lint:tokens
pnpm test                 # 530
pnpm test:a11y            # 165 (1 skipped)
pnpm check:contrast       # 232/232
pnpm build                # tokens → css → react → docs
pnpm check:api            # 빌드 뒤에 돌린다
pnpm check:changesets
```

**`check:api`는 빌드 뒤에 돌린다** — `.d.ts`를 읽으므로 빌드 전에는 옛 결과를 본다. 공개 API를 넓혔으면 `pnpm check:api --update`로 기준을 갱신하고 그 파일을 함께 커밋한다.

**`check:release-tags`는 릴리스 잡에서만 돈다.** 개발 브랜치에서 돌리면 마지막 릴리스와의 거리를 보고하며 그것이 정상이다.

## CI 상태는 저장소마다 다르다

```bash
gh run list --repo 89sooner/<repo> --limit 5 --json databaseId,headSha,conclusion
gh api "repos/89sooner/<repo>/actions/runs/<RID>/jobs" --jq '.jobs[] | "\(.name) \(.conclusion) steps=\(.steps|length)"'
```

`steps=0`이면 잡이 뜨지도 않은 것이다. **pr-search는 결제 차단, design-system은 정상**이며 그 둘을 같이 묶어 말하지 않는다.

## 원장 표 행을 넣을 때 칸 수를 먼저 센다

```python
for line in rows.split('\n'):
    if len(line.split('|')) != 9:   # 7칸 + 양끝
        print('칸 수 이상'); sys.exit(1)
```

`DEV-399`가 남긴 결함 유형이며, 이 세션이 DEV 행 열셋을 넣으면서 매번 확인했다.

---

# 2026-08-31 (2차) — CR-057 · WP-041

## 검증 배터리 (마지막 실행 결과 — main `5dab7f0`)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm typecheck                     # 통과
pnpm lint                          # 통과 — 마지막 파일까지 쓴 뒤 다시 돌릴 것
pnpm run lint:deps                 # 패키지 13개, 위반 0건
pnpm run test                      # 단위 1903 통과 (1 skipped)   [1883 → +20]
pnpm run test:integration          # 1432 통과 (89 파일)          [1399 → +33]
pnpm run test:regression           # 299 통과                     [288 → +11]
pnpm run test:a11y                 # 358 통과 (axe 0)             [346 → +12]
pnpm run test:contrast             # 232/232
pnpm --filter @prs/web run build   # e2e 전에 필수
pnpm run test:e2e                  # 155 통과                     [147 → +8]
pnpm build                         # 통과
```

targeted: `pnpm run test:integration safe-marker` 33 · `pnpm run test:e2e safe-marker` 8.

## 통합은 한 번에 하나만 돌린다

두 실행이 겹치면 공유 PostgreSQL·Elasticsearch가 오염되어 **103건·30건이 실패하는 로그**가 나온다. 그것은 코드의 사실이 아니다.

```bash
ps aux | grep "[v]itest" | wc -l    # 0이어야 한다
pkill -9 -f vitest                  # 겹쳤으면 전부 정리하고 다시
```

**실패를 조사할 때는 전문 로그를 파일로 남겨라.** 요약만 남기면 어느 시험이 실패했는지 확인할 수 없다 — 이 세션이 실제로 그렇게 됐고 통합 2건의 원인을 특정하지 못했다.

```bash
pnpm run test:integration > /tmp/int.log 2>&1; echo "exit=$?"
grep -A20 "Failed Tests" /tmp/int.log | head -40
```

## 변이 시험 헬퍼 (정확히 1건일 때만 치환, CRLF 보존)

```bash
# mutate.sh <파일> <옛 문자열> <새 문자열> <라벨>
#   → 치환 → 대상 스위트 실행 → 원복 → 결과 한 줄
```

**살아남으면 등가인지 먼저 물어라.** 이 세션에서 `FOR SHARE`만 빼는 변이가 통합 32건을 전부 통과했는데 **등가가 아니라 실제 구멍**이었다 — 잠그지 않은 읽기는 읽은 직후 커밋한 갱신을 놓친다. 그 창은 타이밍 제어가 필요해 재현이 어려우므로 **전제(통합)와 사용(회귀)을 나눠** 걸었다.

## 문서 편집 — 개행은 **강제하지 말고 감지한다**

**저장소에 커밋된 파일은 전부 LF다.** `.gitattributes`가 없고, 작업 트리가 CRLF로 보이는 것은 **`core.autocrlf`가 전역(`~/.gitconfig`)에 `true`로 잡혀 있기 때문**이다. 그 설정이 없거나 `false`인 클론에서는 작업 트리도 LF다.

```bash
git config core.autocrlf                              # 이 환경의 값
git show HEAD:docs/10_requirements/srs_final.md | \
  python3 -c "import sys;b=sys.stdin.buffer.read();print('blob CRLF' if b'\\r\\n' in b else 'blob LF')"
```

그러므로 **"CRLF다"를 전제로 편집하지 마라.** 파일을 `newline=''`로 읽어 `'\r\n' in raw`를 보고, 삽입 블록의 개행을 **그 파일에 맞춘다**. 강제로 `\r\n`을 넣으면 LF 클론에서 혼재 개행이나 전체 파일 diff가 된다.

```python
raw = io.open(path, 'r', encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in raw else '\n'
block = block.replace('\n', nl)      # 파일을 따라간다
```

**`APPLIED (1)`을 확인하라** — `SKIPPED (0)`이면 앵커가 안 맞은 것이고, `SKIPPED (N)`이면 여러 곳에 있다.

앵커가 여러 번 나오는 경우가 실제로 있다 — 원장의 DEV 표 행과 6.x장 요약 표가 같은 ID로 시작할 수 있으므로 **줄 번호로 겨냥**한다.

```bash
LINE=$(grep -n '^| DEV-467 | 2026' docs/40_delivery/pr_search_implementation_traceability.md | head -1 | cut -d: -f1)
sed -n "${LINE}p" <파일> > old.txt
```

## 표 행을 넣을 때 칸 수를 먼저 센다

```bash
awk -F'|' '/^\| DEV-47[1-4] \| 2026/ {print $2, NF}' docs/40_delivery/pr_search_implementation_traceability.md
# DEV 표는 9 (7칸 + 양끝), CR 표는 10, WP 진행 표는 10, 매트릭스는 6
```

## 미해결 리뷰 — 스크립트가 정본이다 (DEV-468·469)

```bash
python3 agent-context/count-unresolved-reviews.py              # 두 저장소
python3 agent-context/count-unresolved-reviews.py pr-search    # 하나만
```

한 줄 명령으로 되돌아가지 마라. **창이 둘이고 둘 다 넘칠 수 있다.**

## 리뷰 답변·해소

```bash
for f in replies/*.md; do
  tid=$(basename "$f" .md)
  gh api graphql -f query='mutation($t: ID!, $b: String!) {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $t, body: $b}) { comment { id } } }' \
    -f t="$tid" -f b="$(cat "$f")" > /dev/null \
  && gh api graphql -f query='mutation($t: ID!) {
    resolveReviewThread(input: {threadId: $t}) { thread { isResolved } } }' \
    -f t="$tid" --jq '.data.resolveReviewThread.thread.isResolved'
done
```

## PR 본문 수정 — `gh pr edit`이 실패할 수 있다

Projects classic 사용 중단 경고로 `gh pr edit`이 조용히 실패한다. REST로 직접 건다.

```bash
gh api -X PATCH repos/89sooner/pr-search/pulls/103 -F body=@body.md --jq '.number'
```

## 리뷰 대기

리뷰는 푸시 후 **약 12분**에 도착한다. 백그라운드 폴링이 중단될 수 있으므로 Monitor로 거는 편이 낫다.

```bash
PR=103
prev=0
end=$(( $(date +%s) + 1500 ))
while [ "$(date +%s)" -lt "$end" ]; do
  n=$(gh api graphql -F pr="$PR" -f query='
    query($pr: Int!) {
      repository(owner: "89sooner", name: "pr-search") {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) { nodes { isResolved } }
        }
      }
    }' --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved|not)]|length' 2>/dev/null) || n="$prev"
  [ -z "$n" ] && n="$prev"
  if [ "$n" != "$prev" ]; then
    echo "미해결 $n건"
    prev="$n"
    [ "$n" != "0" ] && break
  fi
  sleep 60
done
```

**질의를 자리표시자로 줄이지 마라.** `gh api graphql`은 `query` 값을 그대로 API에 보내므로 축약형은 실패하고, **그 실패를 걸러 내지 않으면 `n`이 빈 문자열이 되어 `"" != "0"`이 참이 되고 리뷰가 도착한 것처럼 루프를 빠져나온다.** 위 두 줄(`|| n="$prev"`와 빈 값 폴백)이 그 자리다.
