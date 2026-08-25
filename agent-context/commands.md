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
