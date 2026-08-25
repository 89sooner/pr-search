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
