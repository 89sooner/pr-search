# 중요 파일 경로와 역할
## 2026-09-18 (11차)가 만들거나 만진 것 (CR-106·CR-107)

전체 목록은 `agent-context/session-notes.md`의 "11차" 절 Changed files를 본다. 신규 파일만: `apps/search-api/integration/search/identifier-range.test.ts`(CR-106), `apps/search-api/integration/source/history-pull-requests.test.ts`(CR-107).

## 2026-09-15 (8차) 라운드가 만들거나 만진 것 (CR-092, PR #194)

### 코드

- `packages/authz/src/{scope-source,scope,index}.ts` — `AccessScopeLookupError`·`SCOPE_STAGE_PERMISSION`·`atStage`, `org_team` 범위에서만 조직·팀 조회, resolver `log`·`describeScopeFailure`.
- `apps/search-api/src/auth/{context,me}.ts` — resolver에 로그 전달, `/me` 요약의 `null`.
- `apps/web/lib/{redirect,auth-paths}.ts`, `app/auth/{callback,logout}/route.ts`, `app/auth/signed-out/page.tsx`, `app/gh/identity/callback/route.ts`, `components/{UserMenu,SignedOutView,AppTopBar}.tsx`, `app/workbench.css`.
- `deploy/single-host/prsctl`(`http_status`), `deploy/single-host/RUNBOOK.md`(2.C 권한 표·시퀀스 브랜치, 6장 프록시·로그아웃, 8장).

### 시험

- `packages/authz/src/scope-source.test.ts`(신규), `apps/search-api/integration/authz/scope-diagnostics.test.ts`(신규), `apps/search-api/src/auth/auth.test.ts`.
- `apps/web/lib/redirect.test.ts`(신규), `lib/architecture.test.ts`(라우트 핸들러의 출처 기반 리다이렉트 금지), `app/auth/{callback,logout}/route.test.ts`, `app/gh/identity/callback/route.test.ts`, `a11y/shell.test.tsx`(사용자 메뉴·완료 화면), `e2e/shell.spec.ts`(프록시 헤더·303·완료 화면).
- `regression/cr092-pilot7-feedback.test.ts`(신규 — 가짜 compose, `FAKE_BODY_IN_STREAM`).

### 문서

- change_control CR-092 행·cascade, 보안 v1.12(THR-054), API 계약 v0.32, 백엔드 v0.12, 프런트엔드 v0.9, 컴포넌트 명세 v0.16, 화면 흐름 v0.9, 작업 패키지 v2.35, 원장(DEV-697~700·4장·6.91장).
- `agent-context/upstream-feedback.md` 일곱 항목 회신(기록 PR).

### 저장소 밖 (세션 산출물)

- Obsidian worklog: `/mnt/c/Users/slrtt/Documents/Obsidian Vault/dailywork/2026-09-15_PR-Search-CR-092-pilot.7-반입-피드백-반영과-main-병합.md`(작업 개요·변경 표·검증 표·흐름도·요약), `dailywork-index.md` 재생성.
- 전사 대상: `/home/roqkf/pr-search/exports/pr-search-2026-09-15.md` — pending /export(`exports/`는 gitignore).
- 작업 트리 `/home/roqkf/pr-search-wt/cr092`(`fix/cr092-pilot7-feedback`)·`/home/roqkf/pr-search-wt/cr092-record`(`docs/cr-092-merge-record`) — 둘 다 병합됨, 정리는 사용자 결정.
- 이미지 `prs/{db,search-api,pipeline-worker,gh-executor,web}:cr092-final` — 릴리스 아님, 정리는 사용자 결정.

### 저장소 밖 (세션 2b5d8611 scratchpad, /tmp라 재부팅에 사라진다)

- DESIGN-cr092.md·PROGRESS-cr092.md, docpatch.mjs와 spec-*.txt(구분자 명세 개행 보존 편집), battery.sh·logs/battery-{1,2}/, mutation/{run,mutations}.mjs·results.log, logs/images/(빌드·smoke·fix-probe.txt), pr-body.md·merge-body.txt.

## 2026-09-15 (7차) 라운드가 만들거나 만진 것 (CR-091, PR #191)

### 코드

- `packages/authz/src/{config,roles,session,index}.ts` — `ALLOW_INSECURE_COOKIES`(`cookiePolicy`·`insecureCookiesAllowed`), `withAssignedRoles`, `sessionCookieName`·`INSECURE_SESSION_COOKIE_NAME`·`readSessionCookie(name)`.
- `packages/db/src/repositories/auth.ts` — `findAssignedRoles`·`findAssignableUsers`·`listAssignedRoleHolders`·`changeAssignedRole`. `packages/domain/src/audit.ts` — `user_role.grant`·`user_role.revoke`.
- `apps/search-api/src/auth/{registration,role-command}.ts`, `src/role-cli.ts`.
- `apps/web/lib/server/{effective-roles,config,page-guard}.ts(x)`, `lib/{proxy,oidc-state}.ts`, `instrumentation.ts`, `app/auth/{callback,logout}/route.ts`, `app/api/[...path]/route.ts`, `app/gh/identity/callback/route.ts`.
- `deploy/single-host/{prsctl,compose.yml,.env.example,RUNBOOK.md,smoke-images.sh}`.

### 시험

- `packages/authz/src/{config,roles,session}.test.ts`, `apps/search-api/src/auth/registration.test.ts`, `apps/search-api/integration/authz/{assigned-roles,role-command}.test.ts`(신규), `apps/web/lib/server/effective-roles.test.ts`(신규), `apps/web/app/auth/logout/route.test.ts`(신규), `apps/web/{instrumentation,lib/proxy,lib/oidc-state,lib/architecture,app/auth/callback/route}.test.ts`.
- `regression/cr091-auth-feedback.test.ts`(신규 — 실제 compose JSON 대조), `regression/runtime-reachability.test.ts`(DEV-664 함수 목록·anchor 절 기준), `regression/fixtures/release-tag/fake-docker`.

### 문서

SRS v2.29, 용어집 v0.11, 보안 v1.11(THR-052·053), API 계약 v0.31, 백엔드 v0.11, 프런트엔드 v0.8, 데이터 모델 v0.25, 인프라 v0.19, 작업 패키지 v2.34, 원장 v6.79(DEV-694~696·4장·6.89장), change_control(CR-091 행·cascade).

### 저장소 밖 (세션 aeef726c scratchpad, /tmp라 재부팅에 사라진다)

DESIGN-cr091.md·PROGRESS-cr091.md·ledger-6.89-draft.md, docedit.mjs·docspec/*.mjs(개행 보존 편집기와 명세), mutation/{mutations,run}.mjs·results.log, battery.sh·logs/battery-{1,2,3}/, logs/images/(빌드·smoke·role-cli DB), compose.cr091.yml, pr-body.md·merge-body.txt, e2e-fail-1/.

## 2026-09-14 (6차) 라운드가 만들거나 만진 것 (CR-090, PR #188 — 81 파일)

### 코드 (새 파일)

- `packages/gh-cli/src/{registry-policy,registry-cadence}.ts`(+ `registry-policy.test.ts`) — 실행 판정 `decideExecution`, 승인 자격 `evaluateApprovalEligibility`, 보고서 판 해석기, 신선도 한도 계산.
- `packages/db/migrations/030_gh_operations_policy.{up,down}.sql` — 정책 표·이력 표·`gh_operations_policy_apply`·검증 기록 `scope`·`gh_execution.policy_revision`·가드 트리거. `packages/db/src/repositories/gh-policy.ts`(+ `integration/gh-policy.test.ts`).
- `apps/search-api/src/gh/policy.ts` — 조회·변경·수락 게이트. 시험 `integration/gh/policy-routes.test.ts`·`policy-fixtures.ts`.
- `apps/gh-executor/integration/{policy-flow.test.ts,policy-helpers.ts}` — 결정자 지시서 1장 흐름을 실제 gh로.
- web: `app/ops/gh-policy/page.tsx`, `components/{GhRegistryApprovalPanel,GhPolicyView,GhPolicyShared,GhExecutionGateBanner}.tsx`, `lib/{gh-policy,gh-policy-fixtures}.ts`(+ `lib/gh-policy.test.ts`, `a11y/gh-policy.test.tsx`, `e2e/gh-policy.spec.ts`).

### 코드 (고친 것)

- 실행기 `src/{runner,registry-check,index}.ts`(claim 트랜잭션·`lastPassedAt`·검사기 상태 배선), search-api `src/gh/{executions,registry,routes}.ts`, `packages/db/src/{advisory-lock,index}.ts`·`repositories/{gh-execution,gh-registry,index}.ts`, `packages/contracts/src/error-codes.ts`(오류 코드 넷), `packages/domain/src/audit.ts`(감사 액션 넷), `packages/gh-cli/src/{index,inventory}.ts`.
- web `lib/{gh,gh-registry,nav,proxy}.ts`(프록시 `idempotency-key` — `DEV-690`), `components/{GhCommandCenterView,GhExecutionPreview}.tsx`, `app/ops/gh-registry/page.tsx`.
- 시험: 실행기 `integration/{executor,registry-check}.test.ts`, search-api `integration/gh/{registry,routes}.test.ts`·`src/{runtime,gh/executions}.test.ts`, DB `integration/{gh-registry-schema,gh-schema,merge-number-schema}.test.ts`, web `lib/{nav,proxy}.test.ts`, `regression/runtime-reachability.test.ts`(CR-088 배선 이전·CR-090 셋).

### 문서 (24개 + 런북)

- SRS v2.28, PRD v1.12, 용어집 v0.10, 추적 매트릭스 v1.7, 파생 UI(브리프 v0.9·IA v0.6·흐름 v0.8·QA v0.18·상태 매트릭스 v0.18·와이어프레임 v0.19), 아키텍처(API 계약 v0.30·ADR v0.11·비동기 v0.14·백엔드 v0.10·데이터 모델 v0.24·프런트엔드 v0.7·인프라 v0.18·관측성 v0.6·보안 v1.10), delivery(로드맵 v0.21·원장 v6.76·검증 계획 v0.12·작업 패키지 v2.32), change_control(CR-090 행·cascade 절), `deploy/single-host/RUNBOOK.md`(업그레이드·7.C·증상 표). 후속 기록 PR이 원장·작업 패키지 판을 한 단계 더 올린다.

### 저장소 밖 (scratchpad, 무시 대상 — /tmp라 재부팅에 사라진다)

- `66c6e4d6` scratchpad: `DESIGN.md`·`PROGRESS.md`, `compose.approval.yml`(격리 서비스), `exp/db-experiments.{mjs,log}`(E1~E5), `validator-before.txt`.
- `acd5a0d8` scratchpad: `directive-cr090.md`(지시서 전문), `RESUME.md`, `edit.mjs`(개행 보존 편집기)·`docspec/*.mjs`, `mutation/{mutations,run}.mjs`·`run*.log`(변이 31), `oldapp/`(`git archive 26e2627` + 롤백 A·C 시험), `logs/battery/`(1회차), `cr089-cleanup/`(bundle·실측), 조사 결과 셋.
- `e0a2c7af` scratchpad: `restore/restore-smoke.sh`·로그 세 회차, `images-final.sh`·`logs/{images,smoke-images,web-ssr,rollback}-final.log`, `battery-final.sh`·`logs/battery-final/`, `docspec2/*.mjs`, `pr-body.md`·`merge-body.txt`, `ci/`(잡 로그), `RESUME.md`, `final-report-draft.md`.
- 고정 gh `/tmp/prs-pinned-gh/2.97.0/gh`(sha256 `141507c3…c409`). 격리 서비스 `prs-approval-{postgres 55438, redis 56383, elasticsearch 59204}`(볼륨 `prs-approval_approval-*`). 이미지 `prs/{db,search-api,pipeline-worker,gh-executor,web}:cr090-verify`(f2e9a00)·`:cr090-final`(9bb981d).

## 2026-09-14 (5차) 라운드가 만들거나 만진 것 (CR-089, PR #186 — 70 파일)

### 코드 (새 파일)

- `packages/gh-cli/src/{resource-ref,json-pointer,binding,graph}.ts`(+ 각 `.test.ts`) — 참조 식별·포인터·호환 판정과 바인딩 평가·그래프(순수 함수).
- `packages/gh-cli/src/classification/{results,ports,contract-checks}.ts`(+ `results.test.ts`) — 결과 계약·port 규칙·완전성 검사.
- `packages/gh-cli/integration/result-contract.test.ts` — 실제 gh `pr list` → 참조 → `pr view` 입력 호환.
- `apps/web/lib/gh-registry-fixtures.test.ts` — A-006 픽스처 드리프트 가드.

### 코드 (고친 것)

- `packages/gh-cli/src/{types,capabilities,result,validate,manifest,index}.ts`, `classification/{classify,commands,dimensions,rules}.ts`, `manifest/gh-2.97.0.json`(r0.3 재생성), `testing/mock-ghe-tls.ts`(`rawPullRequestNodes`).
- `apps/gh-executor/src/runner.ts`(참조 저장), `apps/search-api/src/gh/{registry,routes}.ts`(API-GH-001·013·014).
- `apps/web/components/{GhRegistryView,GhExecutionPanel}.tsx`, `apps/web/lib/{gh,gh-registry,gh-registry-fixtures,gh-test-fixtures}.ts`, 시험(`lib/gh*.test.ts`, `a11y/gh*.test.tsx`, `e2e/gh*.spec.ts`, `e2e/flow-003.spec.ts` DEV-689).
- `regression/runtime-reachability.test.ts`(CR-089 블록 4), `.github/workflows/ci.yml`(test:regression), `scripts/gh-capabilities.mjs`(분리 집계 출력).

### 문서 (18개)

- SRS v2.27, change_control(CR-089 행·cascade), 원장 v6.74(3·4·5장, 6.86장), WP v2.30(WP-079·WP-066·커버리지 71), 검증 계획 v0.11, 로드맵 v0.20, API 계약 v0.29, 데이터 모델 v0.23, 백엔드 v0.9, 프런트엔드 v0.6, 비동기 v0.13, 인프라 v0.17, 관측성 v0.5(머리글만), 보안 v1.9, ADR v0.10, 와이어프레임 v0.18, QA 체크리스트 v0.17(QA-GH-45·46), 에이전트 브리프 v0.8.

### 저장소 밖 (세션 scratchpad `/tmp/claude-1000/-home-roqkf-pr-search/3bd93f51-…/scratchpad`, 무시 대상)

- `mutate.mjs`·`mutation.log`(변이 22), `emit-fixtures.mjs`·`splice-fixtures.mjs`(픽스처 실측), `bump-header.mjs`(머리글), `battery/`(배터리 로그), `r10~r13*`(e2e 실험), `flow003-artifacts/`(실패 스냅숏), `draft-*.md`.
- 이전 세션 `539c17f5` scratchpad: `DESIGN-cr089.md`, `compose.contracts.yml`, `gh-research/cli`(gh v2.97.0 소스), `probe-pr-list.json`.
- 고정 gh: `/tmp/prs-pinned-gh/2.97.0/gh`(sha256 `141507c3…`). 격리 서비스 `prs-contracts-{postgres 55435, redis 56381, elasticsearch 59202}`(볼륨 `contracts-*`).

## 2026-09-14 (4차 마감) 구간이 만지거나 남긴 것

### 저장소: PR #185 → `824eb57`

| 경로 | 무엇 |
| --- | --- |
| `docs/40_delivery/pr_search_implementation_traceability.md` | 3장 `WP-045`·`WP-059`·`WP-078` 행의 커밋/PR 열을 `#184 · a996540`으로 채웠다. 6.85장 「병합 뒤 main CI」에 PR CI run 34787734188 · main CI run 34788054624 · 병합된 main 재검증을 적었다 |
| `agent-context/{session-summary,session-notes,decisions,todos,files,commands,risks}.md` | 4차 절 접합(이전 세션 초안 7개) |
| `agent-context/_handoff/{context-index.md,manifest.json,compact/*.ctx.md}` | pack 재생성(8파일, 경고 0) |

### 저장소: 이번 handoff (미커밋)

| 경로 | 무엇 |
| --- | --- |
| `agent-context/*.md` 7개 | 맨 위에 「4차 마감」 절을 더했고, 4차 절의 낡은 문장(`post` 워크트리를 「제거한다」, todos 머리와 4번 항목 등)을 실제 결과로 고쳤다 |
| `agent-context/_handoff/` | 재생성 |

### 다음 판이 먼저 열 파일 (REL-007)

| 경로 | 왜 |
| --- | --- |
| `packages/gh-cli/src/capabilities.ts` | 실행 허용 정의 표 `EXECUTABLE_CAPABILITIES`(지금 `PR_LIST_CAPABILITY` 하나)와 `findCapability()`가 있다. 실행을 넓히는 유일한 자리이며 회귀가 리터럴로 건다 |
| `packages/gh-cli/src/classification/commands.ts` · `rules.ts` | leaf 196 분류 표와 flag·positional 규칙(`RULES_VERSION`, `COMMAND_FLAG_OVERRIDES`)이다. `GATE-GH-01d`(bindability · 자원 타입 · port)를 채우려면 이 표나 정의를 넓힌다 |
| `packages/gh-cli/src/validate.ts` | 독립 검증기 `validateManifest()`·`inventoryHash()`·`reportHash()`. 분류를 바꾸면 `pnpm gh:manifest`로 재생성한 뒤 `pnpm gh:validate-capabilities`를 돌린다 |
| `packages/gh-cli/src/pin.ts` · `testing/pinned-gh.ts` | 고정 gh 2.97.0의 자산·바이너리 sha256(`binarySha256`)과 시험용 `ensurePinnedGh()` |
| `packages/gh-cli/src/drift.ts` | 실제 바이너리 대조. `checkDrift`는 CLI·시험용 동기 판, `checkDriftAsync`는 실행기용 비동기 판이다 |
| `apps/gh-executor/src/registry-check.ts` | JOB-GH-003의 `runRegistryCheck(deps, trigger, signal)`·`startRegistryChecker(deps, intervalMs)` |
| `apps/search-api/src/gh/executions.ts` | `prepare()`가 정의와 manifest 둘 다 `allowed`인지 본다. 실행 요청은 `requestExecution()` |
| `apps/search-api/src/gh/{registry,routes}.ts` · `apps/web/components/GhRegistryView.tsx` | API-GH-013·014와 A-006 화면 |
| `scripts/gh-capabilities.mjs` · `scripts/gh-manifest.mjs` | `gh:inventory`·`gh:validate-capabilities`·`gh:diff-capabilities`·`gh:manifest` |
| `docs/40_delivery/pr_search_work_packages.md` · `docs/40_delivery/pr_search_implementation_traceability.md`(3·5·6.85장) · `docs/00_governance/change_control.md` | 상태 · 편차 · CR의 정본이다. 새 판은 CR부터 연다 |

### 저장소 밖

| 경로 | 무엇 |
| --- | --- |
| `/home/roqkf/pr-search/202609140825.md` | 마감 뒤 전사(62,570바이트, untracked, 무시 대상 아님) |
| `/home/roqkf/pr-search/exports/202609140756.md` | 중단 시점 전사(745,804바이트, `exports/`는 무시 대상) |
| `/home/roqkf/.claude/projects/-home-roqkf-pr-search/memory/previous-session-scratchpad-survives-clear.md` | 메모리 1건(`MEMORY.md` 색인에 한 줄) |
| `/mnt/c/Users/slrtt/Documents/Obsidian Vault/dailywork/2026-09-14_CR-087-main-CI-정정과-CR-088-capability-레지스트리-병합-및-후속-기록-마감.md` | 라운드 전체 worklog. `dailywork-index.md`도 재생성했다 |
| `/tmp/claude-1000/-home-roqkf-pr-search/717f9056-…/scratchpad/` | 이 구간 scratchpad: `dryrun/`(4차 절 접합 사본), `validate-main.txt`·`validate-post.txt`(검사기 비교), `pr-post-body.md`, `handoff/`(이번 병합 스크립트 `merge_handoff.py`와 `blocks/`), `handoff-dryrun/` |
| `/tmp/claude-1000/-home-roqkf-pr-search/2c49681f-…/scratchpad/` | 4차 앞 구간 scratchpad: `agent-context-draft/`·`apply-agent-context.py`·`post-logs/`·`compose.rel007.yml`·`ci-evidence/`·`battery/` 등 |

## 2026-09-14 (4차) 라운드가 만들거나 만진 것 (CR-087 PR #183 · CR-088 PR #184)

### CR-087 (S0) — 고친 것

| 경로 | 무엇 |
| --- | --- |
| `apps/ingest-gateway/src/signature.test.ts` | 시간 측정 → `timingSafeEqual` 위임을 `vi.mock`으로 결정적 검증 5건 (DEV-669) |
| `perf/signature-timing.perf.test.ts` (신규) | 시간 측정 진단(5회 중앙값), 게이트 아님 |
| `apps/pipeline-worker/src/sequence-freshness.ts` | `withFreshness(…, hooks.beforeFetch)` — 미러 락 아래·fetch 직전 훅 |
| `apps/pipeline-worker/src/sequence.ts` | fetch 직전 `listCoverableRefreshWorkKeys`로 집합 고정 → 채번 뒤 `completeCoveredRefreshWorks(workKeys)` (DEV-670) |
| `packages/db/src/repositories/sequence-work.ts` | `listCoverableRefreshWorkKeys` 신설, `completeCoveredRefreshWorks`가 시각 대신 키 집합을 받음 |
| `apps/pipeline-worker/integration/sequence/freshness.test.ts` · `packages/db/integration/merge-number-schema.test.ts` | 수정 전 코드에서 결정적으로 실패하는 재현(`now` 고정 + `created_at` +500µs), 집합 경계 시험 |
| `docs/…/pr_search_security_privacy_architecture.md`(v1.8 12장) · change_control(CR-087) · 원장(4장 NFR-005·5장 DEV-669/670·6.84장) | cascade |

### CR-088 — 새로 만든 것

| 경로 | 역할 |
| --- | --- |
| `packages/gh-cli/src/classification/commands.ts` | leaf 196 분류 표 — support·interaction·risk·sideEffect·auth·result·sensitivity·stdin·contexts·**note(근거)** |
| `packages/gh-cli/src/classification/rules.ts` | flag·positional 규칙(`RULES_VERSION`), `COMMAND_FLAG_OVERRIDES`, `secretInput`, USAGE 자리 파서 |
| `packages/gh-cli/src/classification/classify.ts` · `dimensions.ts` | command 분류 조립(결정적) · NFR-009 차원별 커버리지(분모 note) |
| `packages/gh-cli/src/validate.ts` (+ `.test.ts`) | 독립 검증기 — 재계산 대조·해시·별칭·정의·실행 확장·파생·차원·게이트·결정적 보고서; 변이 10종 |
| `packages/gh-cli/src/drift.ts` · `integration/drift.test.ts` | 실제 바이너리 대조(동기 `checkDrift`, 비동기 `checkDriftAsync`); 실제 gh 2.97.0으로 CI integration에서 |
| `packages/db/migrations/029_gh_capability_registry.{up,down}.sql` · `src/repositories/gh-registry.ts` · `integration/gh-registry-schema.test.ts` | 스냅숏(활성화 CHECK 네 차원)·검증 기록(append-only 트리거)·리포지터리 |
| `apps/gh-executor/src/registry-check.ts` · `integration/registry-check.test.ts` | JOB-GH-003 — 기동·주기·재시도·abort·stale·기록 실패 분리·지표 |
| `apps/search-api/src/gh/registry.ts` · `integration/gh/registry.test.ts` | API-GH-013·014 모델(검사 안 함, 기록 읽음) |
| `apps/web/app/ops/gh-registry/page.tsx` · `components/GhRegistryView.tsx` · `lib/gh-registry.ts`(+`-fixtures`, `.test.ts`) · `a11y/gh-registry.test.tsx` · `e2e/gh-registry.spec.ts` | A-006 읽기 전용 |
| `scripts/gh-capabilities.mjs` | `gh:inventory`·`gh:validate-capabilities`·`gh:diff-capabilities` |

### CR-088 — 고친 것

| 경로 | 무엇 |
| --- | --- |
| `packages/gh-cli/src/{types,manifest,inventory,index,node}.ts` · `manifest/gh-2.97.0.json` | 분류 타입·`r0.2`·정책 차단 실행 차원·정의/표 불일치 거부·비동기 추출·코드 단위 정렬·재수출; manifest 재생성(hash `c381880e…`) |
| `apps/gh-executor/src/{index,runner,server,metrics,config}.ts` | 헬스 선개방 → 기동 검사 대기 → 구독; `registry.isStale()` → `registry_stale`; 헬스 `registry`; 지표 둘; `GH_EXECUTOR_REGISTRY_CHECK_MS` |
| `apps/search-api/src/gh/{routes,executions}.ts` | 라우트 둘(역할 둘) + API-GH-001 분류 요약; `prepare`가 정의·manifest 둘 다 allowed |
| `apps/web/lib/{gh,nav}.ts`(+`nav.test.ts`) | CommandView 분류 요약 필드; 내비 `ops-gh-registry` |
| `packages/db/src/index.ts` · `integration/{gh-schema,merge-number-schema}.test.ts` | `ghRegistryRepo` 재수출; 왕복 시험 단계 수 029 |
| `regression/runtime-reachability.test.ts` | CR-088 4건(실행 허용 1·JOB-GH-003 배선·요청 경로 무검사·A-006 역할/설정) — 공백 허용 정규식 |
| `deploy/single-host/{compose.yml,.env.example,RUNBOOK.md}` | `GH_EXECUTOR_REGISTRY_CHECK_MS`; RUNBOOK 7.C 증상 셋·CLI 절 |
| `docs/00_governance/change_control.md`(CR-088) · `docs/10`(무변경) · `docs/20`(와이어프레임 A-006 상태·QA-GH-44) · `docs/30`(데이터 모델·비동기·API·프런트엔드·백엔드·관측성·인프라) · `docs/40`(로드맵·WP·검증 계획·원장 3·4·5·6.85) | cascade |

### 저장소 밖 (휘발)

워크트리 `/home/roqkf/pr-search-wt/{s0,cap}`와 격리 서비스 `prs-rel007-*`(둘 다 후속 docs 커밋 직전에 정리함) · `/home/roqkf/pr-search-wt/post`(후속 docs 브랜치, PR #185 병합 뒤 제거함) · 고정 gh(2차 scratchpad) · 이 세션 scratchpad(`…/2c49681f-…/scratchpad`): `ci-evidence/`(실패 run·job JSON·로그), `s0-logs/`, `cap-logs/`, `post-logs/`(병합된 main 재검증), `battery/`(단계별 `.log`·`.exit`), `sig-ratio.mjs`, `mem-hog.mjs`, `help/`(37 command help 원문), `leaves.txt`, `pr-*-body.md`, `agent-context-draft/`·`apply-agent-context.py`(4차 절 접합 스크립트).

## 2026-09-13 (3차) 라운드가 만들거나 만진 것 (REL-007 R0 완주, PR #181)

### 새로 만든 것

| 경로 | 역할 |
| --- | --- |
| `apps/web/app/gh/page.tsx` · `app/gh/history/page.tsx` | W-010·W-021 라우트 (GuardedPage, Suspense) |
| `apps/web/app/gh/identity/callback/route.ts` (+ `route.test.ts` 8) | Operations App 인가 콜백 — 세션 확인 → search-api POST → return_to 정화. code·state 미기록 |
| `apps/web/components/GhCommandCenterView.tsx` | W-010 컨테이너: 적재 셋 병렬 → 신원 → 목록 → 폼(같은 판정) → 미리보기(debounce 300ms) → 실행(Idempotency-Key, 폼 변경 시 새 키) → EventSource+폴링 → 패널. 404 = 열리지 않음 |
| `apps/web/components/GhHistoryView.tsx` | W-021: 이력 표·상세 폴링·취소·`?prefill=` 재실행·security_officer만 전체 보기 |
| `apps/web/lib/gh-test-fixtures.ts` · `lib/gh.test.ts`(41) · `a11y/gh.test.tsx`(24) · `e2e/gh.spec.ts`(8) | 시험 |
| `apps/gh-executor/src/server.test.ts` | 헬스체크 4건 |

### 고친 것

| 경로 | 무엇 |
| --- | --- |
| `apps/web/lib/gh.ts` | `ExecutionListResponse`·`invocation`·`encodePrefill`/`parsePrefill`/`formFromInvocation`/`loginPathOf`(`//host` 거부)/`describeApiError` |
| `apps/web/lib/nav.ts`·`nav.test.ts`·`architecture.test.ts`·`components/LeftNavPanel.tsx`·`app/workbench.css` | github 그룹·아이콘·QA-GH-24 가드·스타일 |
| `apps/web/e2e/workbench.spec.ts` | Ctrl+K 대기 조건(DEV-662) |
| `apps/gh-executor/src/index.ts` · `runner.ts` | 꺼진 헬스체크는 DB 미확인 · 발췌 토큰 편집 · claim 0행 뒤 취소 확정 · 늦은 결과 로그·지표 라벨 · `beforeClaim` 훅 |
| `apps/gh-executor/integration/executor.test.ts` | ESC 이스케이프 · caret 표기 기대 · 토큰 편집 · 취소 경합 (11) |
| `packages/gh-cli/src/{argv,safe-output,result}.ts` + 시험 | 원시 제어 바이트 → 이스케이프 · 결과 문자열 토큰 편집 |
| `deploy/single-host/compose.yml` · `prsctl` · `build-bundle.sh` · `smoke-images.sh` · `.env.example` | 선택 프로파일 · 렌더 기반 켜짐 판정·health·restore · 번들 이미지 · 6절 · Operations Plane 절 |
| `regression/runtime-reachability.test.ts` · `regression/fixtures/release-tag/fake-docker` | REL-007 블록 10건 · 실행기 검사 흉내 |
| `docs/00_governance/change_control.md`(CR-086 행·cascade) · `docs/10`(무변경) · `docs/30` 7종 · `docs/40` 로드맵·WP·검증 계획·원장 · `deploy/single-host/RUNBOOK.md`(7.C) · `deploy/k8s/README.md` | cascade |

### 저장소 밖 (휘발)

워크트리 `/tmp/pr-search-rel007` · 격리 서비스 `prs-rel007-*` · 고정 gh(2차 scratchpad) · 이 세션 scratchpad(`/tmp/claude-1000/-home-roqkf-pr-search/0e72f0fc-…/scratchpad`): battery 로그·검토 보고 `review-a/a2/b/b2.md`·편집 스크립트.

## 2026-09-13 (2차) 라운드가 만든 것 (REL-007 R0 / WP-077 예정 — **전부 미커밋**, `/tmp/pr-search-rel007`)

`git status --short`가 44개 경로(디렉터리 포함)를 낸다. 커밋 명령은 todos.md 0번.

### 새 패키지 `packages/gh-cli/` — capability 모델·argv·출력 경계 (브라우저 안전 진입점 + `/node`)

| 경로 | 역할 |
| --- | --- |
| `src/pin.ts` | `GH_PINNED_VERSION='2.97.0'`, 자산·바이너리 SHA-256, `ghPinnedAssetUrl`, `parseGhVersionOutput`. **버전·해시의 유일한 정본**(Dockerfile의 리터럴과 회귀로 대조 예정) |
| `src/types.ts` | `GhCapabilityDefinition`·`GhInvocation`·`GhNormalizedInvocation`·`GhConstraint`(13종)·`GhResultContract`·`GhManifest*`·`GhSafeText`·`GhPrListRow`·실행 상태 유니온. `GhExecutionStatus = allowed \| not_implemented \| policy_blocked`(실행 차원) |
| `src/help-parse.ts` | `parseHelp`·`parseFlagLine`·`splitHelpSections` — cobra help 텍스트 파서(순수). 절 이름은 열 0 대문자 줄, flag 명세와 설명 사이 공백 3칸 |
| `src/inventory.ts` (node) | `extractInventory`(바이너리를 걸어 전 command `--help`), `readGhVersion`, `diffInventory`. exit 4는 `helpStatus:'auth_required'` |
| `src/constraints.ts` | `evaluateInvocation` — **폼·서버 공용 판정**. `parseRepositorySlug`, `evaluateRelations` |
| `src/argv.ts` | `buildArgv` — **유일한 argv 빌더**. `redactArgv`·`redactString`·`argvEquals`. 제어 문자 최종 방어선 |
| `src/safe-output.ts` | `SafeOutputStream`(청크 경계 ESC·UTF-8 꼬리 보존, 상한, 바이너리 탐지), `sanitizeOutput`·`sanitizeText`·`stripEscapes`·`looksBinary` |
| `src/result.ts` | `PR_LIST_JSON_FIELDS`(10)·기본 9, `parsePrListOutput`(허용 필드만, 값 무해화, `possiblyMore`), `safeHttpUrl` |
| `src/env.ts` | `GH_EXECUTION_ENV_KEYS`(14), `buildExecutionEnv`, `describeExecutionEnv`(비밀은 `<redacted>`) |
| `src/capabilities.ts` | `PR_LIST_CAPABILITY`(옵션 `--state`·`--limit`·`--json`, `timeoutMs` 30초, `requiredPermissions: ['pull_requests:read']`), `EXECUTABLE_CAPABILITIES`, `findCapability` |
| `src/manifest.ts` | `buildManifest`(오버라이드의 path·flag·JSON 필드가 인벤토리에 있어야 함), `manifestHash`(정규 JSON SHA-256), `verifyManifestHash`, `MANIFEST_VERSION='r0.1'` |
| `src/sha256.ts` | 순수 SHA-256 (브라우저·Node 동일) |
| `src/manifest-file.ts` (node) | `loadManifest`(버전·해시 검증, 어긋나면 던짐), `writeManifest`, `MANIFEST_DIR` |
| `src/vault.ts` (node) | `parseVaultKey`(64자 hex), `sealSecret`/`unsealSecret`(AES-256-GCM, AAD=user_id, 형식 `1\|iv\|tag\|ct`), `VaultUnsealError` |
| `src/index.ts` / `src/node.ts` | 진입점 둘. `package.json` exports `.`·`./node` |
| `manifest/gh-2.97.0.json` | 커밋되는 정본 manifest (518KB, hash `ad00027d84b9915e5127867a778df29b1d164bb88b8e5e15d6be2c9ab820dab2`) |
| `testing/pinned-gh.ts` | `ensurePinnedGh` — `GH_PINNED_BIN` → tmp 캐시 → 내려받기, 해시 3중 대조 |
| `testing/mock-ghe-tls.ts` | `startMockGhe` — **실제 HTTPS** 목(openssl 인증서 생성). GraphQL·토큰 교환·`/user`·revoke 기록, `expectedToken`, `graphqlDelayMs` |
| `testing/https-json.ts` | 시험용 `HttpJson`(자체 서명 CA 신뢰) |
| `testing/fixtures/help/*.txt` | root·pr·pr-list·co·repo-clone·api의 실제 help (파서 시험 픽스처) |
| `src/*.test.ts` | help-parse·constraints·argv·safe-output·result·env·manifest·vault (69건) |

### 새 앱 `apps/gh-executor/` — gh를 띄우는 유일한 프로세스

| 경로 | 역할 |
| --- | --- |
| `src/config.ts` | `resolveExecutorConfig`(`GH_OPERATIONS_ENABLED`·`GHE_BASE_URL`→host·`GH_IDENTITY_VAULT_KEY`·`GH_EXECUTOR_BIN`·`_WORKSPACE_ROOT`·`_MAX_CONCURRENT`(≤파티션 4)·상한·CA·하트비트·고아·스윕), `executorConfigFailure`, `hostOfBaseUrl` |
| `src/spawn.ts` | `runGhProcess` — **저장소 유일의 `spawn(`**, `shell:false`, `detached`, 그룹 SIGTERM→SIGKILL, 타임아웃, 취소 폴링, 하트비트, `SafeOutputStream` 둘, 원본 stdout 해시. 절대 던지지 않음 |
| `src/workspace.ts` | `createWorkspace`(0700, home/config/tmp)·`destroyWorkspace` |
| `src/runner.ts` | `runExecution` — `revalidate`(manifest 해시·gh 버전·capability·저장소·연결·호스트·만료·행위자·봉인 해제·**argv 재조립 대조**) → `claimExecution` → `buildExecutionEnv` → `runGhProcess` → `parsePrListOutput` → `finishExecution`. `RunnerDeps`에 시험 전용 `timeoutMsOverride`·`stdoutLimitOverride` |
| `src/sweeper.ts` | `startSweeper` — `reclaimOrphans`(하트비트 끊긴 running→failed `executor_lost`) + `listStaleQueued` 재실행. `runOnce` |
| `src/metrics.ts` | `gh_execution_total{result}`·`gh_execution_duration_seconds`·`gh_executor_active` |
| `src/server.ts` | `/healthz`(execution enabled/disabled·gh 버전·manifest 해시·PG 확인)·`/metrics`, 포트 3004 |
| `src/index.ts` | 기동: 설정 거부 → gh 버전·**바이너리 해시** 대조 → manifest 로드 → 파티션을 `maxConcurrent` 구독으로 분배 → 스윕. 종료 45초 유예 |
| `src/spawn.test.ts`·`src/config.test.ts` | 실제 자식 프로세스로 타임아웃·취소·그룹 종료·상한·shell 미경유·환경 미상속 |
| `integration/executor.test.ts` | 실제 gh + HTTPS 목: 요청→실행→결과, closed 상태, 잘못된 토큰, 재검증 5경로, 취소·타임아웃·상한, 스윕, spawn 실패. **`const ESC`를 `'\x1b'`로 고쳐야 10/10** |

### `packages/db`

| 경로 | 무엇 |
| --- | --- |
| `migrations/028_gh_operations.{up,down}.sql` | `github_identity_connection`(PK user_id, host, token_ref, 만료·철회), `gh_identity_secret`(봉인 바이트, key_id), `gh_execution`(월별 파티션, 소유자 `prs_admin`, 상태·위험 CHECK, 발췌 상한), `gh_execution_idempotency`(PK user_id+key). down은 넷을 DROP |
| `src/repositories/gh-identity.ts` | `connectIdentity`(트랜잭션, 옛 봉인 삭제), `findConnection`, `loadSecret`, `rotateSecret`, `revokeConnection`, `listConnections` |
| `src/repositories/gh-execution.ts` | `insertExecution`(**트랜잭션: 보조 표 선점 → 행 → ID 기록**, `DuplicateIdempotencyKeyError`), `findById`, `findByIdempotencyKey`, `listExecutions`(키셋 `beforeId`, 상한 100), `claimExecution`, `heartbeat`, `requestCancel`, `cancelQueued`, `isCancelRequested`, `finishExecution`(집은 실행기만), `failQueued`, `reclaimOrphans`, `listStaleQueued` |
| `src/repositories/index.ts` | `ghIdentityRepo`·`ghExecutionRepo`·타입 재수출 |
| `src/partitions.ts` | `PARTITIONED_TABLES`에 `gh_execution`, `RETENTION_MONTHS.gh_execution = 12` (`partitions.test.ts` 갱신) |
| `integration/gh-schema.test.ts` | 왕복·권한·파티션·CHECK·claim·finish·취소·멱등 경합·봉인 (13건) |
| `integration/merge-number-schema.test.ts` | 내려갈 목록을 `['028','027','026','025']`로 갱신 |

### `packages/bus`·`packages/contracts`

`bus/src/topics.ts`: `TOPICS.ghExecutions='prs:gh:executions'`, group `gh-executor`, 파티션 4, 키 `host:owner/name` (`partition.test.ts` 갱신, 「스트림 8종」). `contracts/src/error-codes.ts`: `GH_CAPABILITY_NOT_EXECUTABLE: 409` (+ `docs/30_technical_architecture/pr_search_api_contracts.md` 6장 행).

### `apps/search-api/src/gh/`

| 경로 | 무엇 |
| --- | --- |
| `config.ts` | `resolveGhOpsConfig`·`ghOpsConfigFailure`·`resolveOperationsEnabled` |
| `identity.ts` | `startAuthorization`(state+PKCE, Redis 10분) · `completeAuthorization`(교환→`/user`→봉인→upsert) · `statusOf`/`readStatus` · `ensureLiveConnection`(갱신) · `disconnect`(철회+best-effort revoke) · `IdentityError` |
| `context.ts` | `scopeAllowsRepository`(explicit/org_team 두 모드), `listVisibleRepositories`, `resolveRepositoryContext` |
| `executions.ts` | `parseInvocationBody`, `parseIdempotencyKey`(8~128 `[A-Za-z0-9_-]`), `prepare`(**미리보기·실행 공용**), `toPreview`, `requestExecution`(중복 키→준비→연결 확보→INSERT→발행), `toExecutionView`, `findVisibleExecution`, `listVisibleExecutions`, `canSeeAll`, `GhRejected` |
| `routes.ts` | 경로 상수 `GH_*_PATH`(`/api/v1/gh/…`), `registerGhRoutes` — capabilities·contexts/repositories·identity(GET/POST/DELETE)·identity/callback·executions/preview·executions(POST/GET)·executions/:id·:id/stream(SSE)·:id/cancel |
| `http.ts` | `fetchJson`(운영 `HttpJson`, 10초 상한) |
| `*.test.ts` | executions(본문 파싱·뷰)·context·identity(statusOf) |
| `../config.ts`·`server.ts`·`runtime.ts`·`index.ts` | `ghOps` 설정 필드, `ServerDeps.gh`, `buildGhDeps`(켜져 있고 세션 있을 때만; 자격 없으면 던짐; manifest 로드), `identityRedis` |
| `integration/gh/routes.test.ts` | 실제 PG·Redis·HTTPS 목으로 14건 (인가 왕복·봉인 원문 부재·미리보기=실행 argv·우회 요청 거절 10종·중복 키·연결 없음/철회·가시성·취소·SSE) |

### `apps/web`

`lib/nav.ts`(섹션 `github`, 항목 `gh-command-center`→`/gh`, `gh-history`→`/gh/history`, 역할 제한 없음) · `lib/gh.ts`(뷰 타입, `validateForm`=서버와 같은 `evaluateInvocation`, `toInvocation`, `defaultFormState`, `canExecute`, `newIdempotencyKey`, `formatArgv`, `resultKind`, `describeError`, 라벨) · `components/SafeGhOutputViewer.tsx`(C-063)·`GhExecutionPanel.tsx`(C-058, 결과 종류 가름)·`GhExecutionPreview.tsx`(C-062)·`GhPrListForm.tsx`(C-061 첫 판)·`GhCapabilityList.tsx`(미구현도 사유와 함께)·`GhIdentityBanner.tsx` · `package.json`(+`@prs/gh-cli`) · `next.config.ts`(`transpilePackages`+`@prs/gh-cli`) · `vitest.a11y.config.ts`(별칭). **없는 것**: `app/gh/page.tsx`·`app/gh/history/page.tsx`·`app/gh/identity/callback/route.ts`·`GhCommandCenterView`·`GhHistoryView`·시험 전부·`LeftNavPanel` ICONS.

### 배포·루트

`Dockerfile`(`deploy-gh-executor`·`gh-executor` 스테이지, `ARG GH_VERSION/GH_ASSET_SHA256/GH_BINARY_SHA256`, `USER node`, EXPOSE 3004) · `deploy/single-host/compose.yml`(search-api에 `GH_OPERATIONS_ENABLED`·`GHE_OPS_*`·`GH_IDENTITY_VAULT_KEY`; 서비스 `gh-executor` read_only+tmpfs, `*ghe-env`·`*annotate-env` 미수신) · 루트 `tsconfig.json`(참조 `packages/gh-cli`·`apps/gh-executor`)·`tsconfig.tests.json`(paths)·`vitest.{,integration,regression}.config.ts`(별칭 `@prs/gh-cli/node` 먼저)·`package.json`(`gh:manifest`)·`scripts/gh-manifest.mjs`·`pnpm-lock.yaml`.

### 저장소 밖 (휘발)

- 워크트리 `/tmp/pr-search-rel007` — **미커밋 코드 전부**.
- 고정 gh: `/tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh` (+ 같은 스크래치의 `compose.rel007.yml`, `mock-ghe.mjs`, `tls/`).
- 격리 서비스: 컨테이너 `prs-rel007-postgres`(55434)·`prs-rel007-redis`(56380)·`prs-rel007-elasticsearch`(59201), 프로젝트 `prs-rel007`, DB `prs_test` 생성됨.

### 손대면 안 되는 것

`.github/workflows/ci.yml` · 마이그레이션 001~027 · `packages/authz/src/config.ts` 보안 계약 · `packages/github/src/client.ts` 읽기 전용 경계 · `MNUMBER_ANNOTATE_ENABLED` 기본값 · 0.1.0-pilot.5 태그.

## 2026-09-13 라운드가 만진 것 (WP-075 안전성 보강 / CR-085 — 33개 파일)

main = `65caf0c`. 전체 목록은 `git show --stat 7e4fd63`과 `65caf0c`다.

### 새로 만든 것

| 경로 | 역할 |
| --- | --- |
| `packages/github-annotate/src/pacing.ts` | `PassDeadline`(예산·중단 신호)과 `WriteGate`(실행자 전체의 쓰기 간격·한도 유예). **만료 판정은 시각 비교가 정본이고 타이머는 진행 중인 왕복을 끊는 역할** |
| `apps/pipeline-worker/src/annotate-lock.ts` | `withAnnotateRunnerLock` — `annotate:runner` advisory 세션 락. 락이 준 커넥션을 `run`에 넘긴다 |
| `apps/pipeline-worker/src/annotate-preview-cli.ts` | 읽기 전용 사전 점검. `BEGIN READ ONLY` 안에서 돌고 GHE를 부르지 않으며 「확인하지 못한 것」을 함께 낸다 |
| `apps/pipeline-worker/src/annotate-safety.test.ts` | 16건. 재현 A~E와 결과 확실성·실행자 배제 |
| `apps/pipeline-worker/integration/sequence/annotate-safety.test.ts` | 12건. 실제 PostgreSQL과 **실제 자식 프로세스**로 세션 배제 |
| `packages/db/migrations/027_annotate_outcome.{up,down}.sql` | 상태 둘(`body_changed`·`unknown`)과 근거 세 열. **제목 원문을 담지 않는다** |

### 크게 바뀐 것

| 경로 | 무엇이 바뀌었나 |
| --- | --- |
| `apps/pipeline-worker/src/annotate.ts` | `attemptOnce`가 새로 생겼다 — **변경 요청 하나에 판단 전체가 붙는다.** `acquirePassSlot`이 줄 서기를 중단 신호와 경주시키고, 스윕이 종료 신호를 회차로 전달한다 |
| `packages/github-annotate/src/client.ts` | `RequestOptions.signal`을 받아 `AbortSignal.any`로 fetch에 건다. `aborted` 오류 종류와 `leavesOutcomeUnknown`을 더했다 |
| `packages/db/src/repositories/merge-sequence.ts` | 대상 질의가 `unknown`을 다시 보고 `body_changed`를 보지 않는다. `markAnnotateState`가 근거를 함께 남기고, `resumeAnnotateTargets`·`countAnnotateReadiness`가 생겼다 |
| `packages/db/src/advisory-lock.ts` | `annotateRunnerLockKey()` — 배제하려는 것이 저장소가 아니라 **실행자**라 키가 하나다 |
| `apps/search-api/src/ops/{repositories,routes}.ts` | `annotate_resume` 플래그. 감사는 기존 `repository.update` 한 줄에 담는다 |
| `packages/github-annotate/testing/mock-annotate-ghe.ts` | 수신 시각·요청 훅·제목 제어. **간격은 목이 기록한 시각으로만 잴 수 있다** |
| `regression/runtime-reachability.test.ts` | 「표기 안전성 계약」 블록 11건 — 호출 위치·순서·락·신호·상태 목록·감사 어휘를 **구조로** 고정 |

### 문서

`docs/00_governance/change_control.md`(CR-085) · `docs/10_requirements/srs_final.md` v2.26(AC-8~10) · 데이터 모델 v0.21 · 비동기 v0.11 · 인프라 v0.15 · API 계약 v0.27 · 보안 v1.6(**감사 어휘 표**) · 작업 패키지 v2.28 · 구현 원장 v6.71(6.82장) · 런북 7.B와 8장.

### 손대면 안 되는 것

`0.1.0-pilot.5` 태그·자산 · 사내 운영 DB · 실제 GHE PR 제목 · `packages/authz/src/config.ts`의 보안 계약 · `packages/github/src/client.ts`의 읽기 전용 경계 · 마이그레이션 025·026.

### 저장소 밖

- 후보 번들 `/tmp/pr-search-bundle-pilot6/` — **임시 경로라 재부팅에 사라진다.** 발행하려면 그때의 main에서 다시 만든다.
- 워크트리 `/tmp/pr-search-wp075-safety`·`/tmp/pr-search-postmerge-safety`와 검증 컨테이너는 정리했다.

## 2026-09-12 라운드가 만진 것 (WP-075 / CR-084 — 48개 파일)

`main = 918a37b`. 전체 목록은 `git show --stat 918a37b`다.

### 쓰기 경계 — 새 패키지 `packages/github-annotate/`

| 경로 | 역할 |
| --- | --- |
| `src/title.ts` | **순수 판정.** `resolveAnnotationTarget`(코드 확정)과 `decideTitleUpdate`(접두 판정). GHE를 부르기 전에 답이 나온다. `LEADING_BRACKET` 정규식이 이중 접두를 막는 자리 |
| `src/config.ts` | 표기 전용 자격과 전역 스위치. **조회 App의 `GHE_APP_*`를 한 번도 읽지 않는다.** `resolveAnnotateEnabled`·`annotateConfigFailure`·`EVENT_PASS_BUDGET_MS`·`MIN_WRITE_SPACING_MS` |
| `src/client.ts` | `AnnotateClient` — `readTitle`·`updateTitle`. 본문은 언제나 `{title}` 하나다. `classifyFailure`가 공식 문서의 대기 순서를 그대로 구현하고 `fromProviderError`가 발급기 오류를 이 모델로 옮긴다 |
| `src/index.ts` | 배럴 |
| `src/title.test.ts` | 21건. 접두·코드·유니코드·공백·경계값 |
| `testing/mock-annotate-ghe.ts` | **실제 `node:http` 목.** 메서드·경로·헤더·**본문 원문**을 기록한다. 조회용 목과 나눈 이유는 그쪽이 본문을 기록하지 않기 때문 |
| `testing/client.test.ts` | 19건. `PATCH` 메서드·경로·본문 키 집합·헤더·실패 분류 |
| `package.json` · `tsconfig.json` | 의존은 `@prs/domain`·`@prs/github` 둘 |

### 워커

| 경로 | 역할 |
| --- | --- |
| `apps/pipeline-worker/src/annotate.ts` | `JOB-SEQ-005` 전부. `annotateOne`(한 행) · `runAnnotationPass`(회차, 모듈 수준 `passChain`으로 직렬화) · `handleMergeNumberAssigned`(이벤트) · `startAnnotateSweeper`(잔여 스윕) · `withRetry` · `recordAnnotateAudit` |
| `apps/pipeline-worker/src/annotate.test.ts` | 41건. **진짜 client + 진짜 HTTP 목 + 기록용 Pool 대역** |
| `apps/pipeline-worker/src/index.ts` | `roles.includes('annotate')` 블록. 꺼져 있으면 구독조차 걸지 않고, 켜 놓고 자격이 없으면 **던진다** |
| `apps/pipeline-worker/src/metrics.ts` | `mnumberAnnotateTotal{result}` · `mnumberAnnotateMismatchTotal` |

### 정본과 질의

| 경로 | 역할 |
| --- | --- |
| `packages/db/migrations/026_annotate_policy.{up,down}.sql` | `repository`에 `annotate_enabled`(운영자) · `annotate_blocked_at`·`annotate_blocked_reason`(실행 중 차단). additive |
| `packages/db/src/repositories/merge-sequence.ts` | 파일 **끝에** 추가 — `listAnnotateTargets`(에폭 조인·공평한 정렬) · `isAnnotationCurrent`(**쓰기 직전 울타리**) · `markAnnotateState` · `markDisabledRepositoryTargets` |
| `packages/db/src/repositories/repository.ts` | `RepositoryRow`에 세 열, `RepositorySettings`에 `annotate_enabled`, `blockAnnotation`·`clearAnnotationBlock` |
| `packages/domain/src/audit.ts` | `pull_request.annotate`를 활성으로, `ANNOTATE_PRINCIPAL = 'system:annotate'` |
| `packages/bus/src/topics.ts` | `LOGICAL_CONSUMERS[prs:projected]`에 `annotate` — `mnumber`와 **다른 group** |
| `packages/github/src/config.ts` | `parseInstallations`가 변수 이름을 인자로 받는다(기본값 유지) |

### API와 배포

| 경로 | 무엇 |
| --- | --- |
| `apps/search-api/src/ops/routes.ts` | `PATCH /admin/repositories/{id}`에 `annotate_enabled`. 기존 `repository.update` 감사에 얹었다 |
| `deploy/single-host/compose.yml` | `x-annotate-env` 앵커와 `worker-annotate`. **`*ghe-env`를 merge하지 않는다** |
| `deploy/k8s/pipeline-worker-annotate.yaml` | 전용 시크릿만 `envFrom`, 공용 값은 `DATABASE_URL` 한 키만 |
| `deploy/k8s/annotate-secret.example.yaml` | `prs-annotate-secrets` 자리표시자 |
| `deploy/k8s/configmap.yaml` · `README.md` | 전역 스위치와 적용 순서 |
| `deploy/single-host/.env.example` | 표기 절 (스위치·자격 셋·스윕·쿨다운·쓰기 간격) |
| `deploy/single-host/RUNBOOK.md` | **7.B 「PR 제목에 M 넘버를 표기하기」**와 8장 증상 셋 |

### 회귀 — 이 판의 핵심 둘

| 경로 | 무엇을 묻는가 |
| --- | --- |
| `regression/runtime-reachability.test.ts` | `describe('표기 쓰기 자격이 조회 경로로 새지 않는다')` — 의존 그래프·전송 계층·**서비스별 최종 환경 키 집합**으로 자격 분리를 양방향으로 강제. `composeEnvByService`를 모듈 범위로 **추출**해 CR-082 블록과 공유한다 |
| `apps/pipeline-worker/integration/sequence/annotate.test.ts` | 28건. **실제 PostgreSQL** — 에폭 조인·상태 전이·해제 표시·차단 쿨다운·공평한 정렬·감사 행 |

### 문서

- `docs/00_governance/change_control.md` — `CR-084`와 cascade
- `docs/10_requirements/srs_final.md` — v2.25. 감사 표의 상태 칸 하나(미활성 → 활성)
- `docs/30_technical_architecture/pr_search_data_model.md` v0.20 · `_async_events_jobs.md` v0.10 ·
  `_infrastructure_operations.md` v0.15 · `_api_contracts.md`
- `docs/40_delivery/pr_search_work_packages.md` v2.27 · `_implementation_roadmap.md` v0.18 ·
  `_implementation_traceability.md` **v6.70 — 6.81장이 검증의 정본**

### 손대면 안 되는 것

`0.1.0-pilot.5` 태그·자산 · 사내 운영 DB · **실제 GHE PR 제목** · `packages/authz/src/config.ts`의
보안 계약 · `packages/github/src/client.ts`의 읽기 전용 경계.

### 저장소 밖

- `exports/202609120849.md` — 이 세션의 전사. `.gitignore` 대상이며 compact 입력이 아니다.
- 워크트리 `/tmp/pr-search-wp075`·`/tmp/pr-search-postmerge`는 **정리했다**.
- 개발 백킹 서비스(`prs-postgres`·`prs-redis`·`prs-elasticsearch`)는 **띄운 채로 두었다**.

## 2026-09-11 (4차) 라운드가 만진 것 (CR-082 · CR-083 — 48개 파일, 4,583줄)

`main = 523edae`. 전체 목록은 `git diff --stat e01bce1 523edae`다.

### 인증 — 새로 생긴 것

| 경로 | 역할 |
| --- | --- |
| `packages/authz/src/github-oauth.ts` | **GHE OAuth2 전부.** 인가 URL·토큰 교환·`/user`·`/user/teams` 조회. `joinUrl`이 이 파일의 **유일한 주소 조립 규칙**이다 |
| `packages/authz/src/github-oauth.test.ts` | 39건. 200-with-error, `id` 정수 검증, 페이지 상한, NFR-005 |
| `apps/search-api/src/auth/registration.ts` | **`RegisteringSessionStore`** — 세션을 읽을 때 `app_user`를 upsert (`DEV-613`) |
| `apps/search-api/src/auth/registration.test.ts` | 12건. 대역 `Pool`로 호출과 인자를 본다 |
| `apps/search-api/integration/authz/registration.test.ts` | 7건. **실제 PostgreSQL.** 행이 생기는가, 재로그인이 관리자 지정을 지우지 않는가, **조립이 배선하는가** |
| `apps/web/app/auth/login/route.test.ts` | 13건. 공급자별 리다이렉트 대상 |
| `apps/web/app/auth/callback/route.test.ts` | 13건. **`fetch`만 대역으로 두어 실제 경로가 전부 돈다.** 신원 키·역할 합성·쿠키·실패 로그 |

### 인증 — 고친 것

| 경로 | 무엇이 바뀌었나 |
| --- | --- |
| `packages/authz/src/config.ts` | `resolveAuthProvider`·`resolveGitHubAuthConfig`·`resolveTeamRoleMap`·`hasAuthCredentials`·`parseScopes`. 쿠키 면제는 **명시적 `AUTH_ENABLED=false`**에 걸린다 |
| `packages/authz/src/session.ts` · `session-store.ts` | `SessionRecord.githubUserId`(선택). `parseSession`은 모양이 틀리면 **그 값만** 버린다 |
| `apps/web/app/auth/login/route.ts` | `authorizationUrlFor` 한 함수가 분기의 전부 |
| `apps/web/app/auth/callback/route.ts` | `identifyViaOidc`/`identifyViaGitHub`. `logAuthFailure`. **쿠키 둘을 `headers.append`로 통일**(`DEV-614`) |
| `apps/web/lib/oidc-state.ts` | `serializeCookie` — 쿠키를 한 방법으로 달기 위해 |
| `apps/web/lib/server/config.ts` | `webConfigFailure`가 공급자별 필수 키와 `GHE_TEAM_ROLE_MAP`을 본다 |
| `apps/search-api/src/auth/context.ts` | `RegisteringSessionStore` 배선. `AuthContext.sessions`는 **기반 타입**으로 선언 |

### 배포 정의와 게이트

| 경로 | 무엇 |
| --- | --- |
| `deploy/single-host/compose.yml` | `x-app-env`에 `GIT_SSL_CAINFO`. `web`에 GHE OAuth 키 일곱 |
| `deploy/single-host/.env.example` | CA 항목, GHE 로그인 절, 그룹 매핑 안내 정정(`DEV-612`) |
| `deploy/single-host/RUNBOOK.md` | 6장 CA 4단계 · GHE 로그인 절차, 8장 증상 넷 |
| `deploy/single-host/smoke-images.sh` | **`expect_accepted` 추가.** 거부 기대 넷을 새 계약에 맞췄다 |
| `regression/fixtures/release-tag/fake-docker` | 값 하나가 아니라 **구성을 모아 계약대로 판정** |

### 회귀 — 두 대조가 이 판의 핵심이다

| 경로 | 무엇을 묻는가 |
| --- | --- |
| `regression/runtime-reachability.test.ts` | `describe('사설 CA가 git 서브프로세스에도 닿는다')` — **서비스마다 병합 앵커를 펼친 최종 환경 키 집합**을 만들어 `MIRROR_ROOT`를 선언한 서비스가 전부 받는지 |
| `apps/web/lib/server/config.test.ts` | `describe('DEV-615: 릴리스 게이트가 계약과 같은 말을 한다')` — **스모크의 기대 조합을 뽑아 `webConfigFailure`에 넣는다** |

### 문서

- `docs/10_requirements/srs_final.md` — `v2.24`. `FR-AUTH-001` 요구사항 문장과 `AC-1`·`AC-2`·`AC-6`~`AC-9`, 10장 인터페이스 표
- `docs/00_governance/change_control.md` — `CR-082`·`CR-083`과 각 cascade
- `docs/40_delivery/pr_search_implementation_traceability.md` — `v6.69`. 6.77(CA)·6.78(GHE)·6.79(게이트)·6.80(발행)장
- `docs/40_delivery/pr_search_work_packages.md` — `v2.26`. `WP-076` 신설·done
- `agent-context/upstream-feedback.md` — 두 요청에 처리 결과와 **제안과 다르게 한 자리**를 적었다

### 저장소 밖 (전부 정리했다)

앞 라운드가 남긴 워크트리 일곱과 `/tmp` 산출물 넷, 빌드 캐시 63GB, 오래된 `prs/*` 이미지 19개를 제거했다.
**남은 것**: `prs/*` 이미지는 `pilot.4`·`pilot.5`만, 파일럿 볼륨 여섯 개는 보존.

## 2026-09-11 (3차) 라운드가 만진 것 (WP-074 — 115개 파일, 13,168줄)

`main = e01bce1`. 신규 파일이 많아 **역할별로만** 적는다. 전체 목록은 `git diff --stat c1246c5 e01bce1`이다.

### 판정의 중심 (먼저 읽을 것)

| 경로 | 역할 |
| --- | --- |
| `packages/domain/src/mnumber.ts` | 표기·파싱·저장소 코드. **양쪽 앱이 공유하는 순수 판정** |
| `apps/pipeline-worker/src/mnumber-plan.ts` | 순수 planner. 순서·멈춤·충돌·`merged_at` 대조 |
| `apps/search-api/src/sequence/merge-number-view.ts` | DTO 판정. **결정 순서가 계약이다** (설계 9절) |
| `apps/web/lib/merge-number.ts` | 화면 표시 모델·URL 직렬화·재검증 정책 |

### 채번과 전달

| 경로 | 역할 |
| --- | --- |
| `apps/pipeline-worker/src/mnumber.ts` | `reconcile`·`materialize`·`announce`·관측 루프 |
| `apps/pipeline-worker/src/mnumber-evidence.ts` | 근거 수집. **production은 `direct_confirmed`를 만들지 않는다** (`DEV-581`) |
| `apps/pipeline-worker/src/mnumber-hint.ts` | `prs:projected`의 전용 논리 소비자 `mnumber` |
| `apps/pipeline-worker/src/sequence-freshness.ts` | 채번 전 미러 fetch (`DEV-576` 폐쇄) |
| `apps/pipeline-worker/src/sequence-work-runner.ts` | durable work 러너. **사유별 재시도 처분** (`DEV-598`) |
| `apps/ingest-gateway/src/store.ts` | 수신과 refresh 의도를 **한 트랜잭션**에 |

### 정본과 색인

| 경로 | 역할 |
| --- | --- |
| `packages/db/migrations/025_merge_number.{up,down}.sql` | 번호·checkpoint·blocker·신규 표 셋 |
| `packages/db/src/repositories/merge-sequence.ts` | `lookupMergeNumbers`가 공간·행·대상 브랜치를 함께 읽는다 |
| `packages/db/src/repositories/{mnumber-evidence,sequence-work,sequence-latency}.ts` | 신규 표 셋 |
| `packages/db/src/pool.ts` | `withReadSnapshot` — 읽기 전용 일관 스냅숏 (`DEV-592`) |
| `packages/es/src/merge-number.ts` | M 필드의 **전용 소유자**. 투영이 덮지 않는다 |

### API와 화면

| 경로 | 역할 |
| --- | --- |
| `apps/search-api/src/sequence/merge-numbers.ts` | `API-SEQ-007` 양방향 해석. **검사 순서가 보안 계약이다** |
| `apps/search-api/src/sequence/merge-number-batch.ts` | 페이지 단위 1회 정본 대조 |
| `apps/web/components/MergeNumberBadge.tsx` | 세 화면이 공유하는 배지 |
| `apps/web/components/MergeNumberEntry.tsx` | `/search`의 M 해석 진입. **화면을 늘리지 않는다** |
| `apps/web/components/usePendingRevalidation.ts` | 5초 간격 · 60초 마감 자동 재검증 |

### 측정

`apps/pipeline-worker/src/measure/{args,stats,db,output,index}.ts` · `measure-cli.ts` ·
`scripts/measure-sequence-latency.mjs`. **읽기 전용**이며 `BEGIN READ ONLY`로 DB가 쓰기를 막는다.

### 시험 (신규 16개)

단위는 `mnumber*.test.ts`·`merge-number*.test.ts`, 통합은
`integration/sequence/{mnumber,freshness}.test.ts`·`merge-number-schema.test.ts`·`refresh-intent.test.ts`,
회귀는 `regression/merge-number-vs-git.test.ts`(**git이 기대값을 만든다**)·`runtime-reachability.test.ts`,
화면은 `a11y/mnumber.test.tsx`·`e2e/mnumber.spec.ts`.

### 배포 정의 (셋이 같은 값을 받아야 한다)

`deploy/single-host/compose.yml`의 `search-api`·`worker-sequence`·`worker-batch`,
`deploy/k8s/pipeline-worker-{sequence,batch}.yaml`, `.env.example`, `RUNBOOK.md` 7.A.
**`web`에는 `MNUMBER_ENABLED`가 없다** (`DEV-589`).

### 문서

`docs/40_delivery/pr_search_implementation_traceability.md` **6.76장**이 검증의 정본이다.
`docs/00_governance/change_control.md`에 `CR-080`·`CR-081`과 각 cascade가 있다.

### 산출물 (저장소 밖 · 무시 대상)

- `/tmp/pr-search-bundle-out/` — `4466fa1` 기준 미발행 번들. **현재 main과 다르므로 다시 만들어야 한다**
- `/tmp/pr-search-load-test/` — 적재 검증용으로 푼 사본. `.env`는 더미 값이다
- `/tmp/pr-search-wp074-implementation/`, `/tmp/pr-search-bundle-main/` — 워크트리

### 손대면 안 되는 것

`0.1.0-pilot.4` 태그·자산 · 사내 운영 DB · 실제 GHE PR 제목 · `packages/authz/src/config.ts`의 보안 계약.


## 2026-09-11 (2차) 라운드가 만진 것 (CR-078 — 코드·배포·시험·문서 19개)

`main = a198e12`. 신규 파일 다섯을 포함한다.

### 이번 결함의 정본 — 여기부터 읽는다

| 경로 | 역할 |
| --- | --- |
| `apps/web/instrumentation.ts` | **신규.** Next의 `register()`에서 구성을 펴고 실패하면 종료한다. 왜 `throw`가 아닌지가 주석에 있다 |
| `apps/web/lib/server/config.ts` | `webConfigFailure(env)` — 기동 검증과 헬스체크가 함께 읽는 판정. `resolveOidcConfig`를 그대로 부른다 |
| `apps/web/app/healthz/route.ts` | 같은 판정을 읽어 503. 판정 문구는 `console.error`로만 |
| `packages/authz/src/config.ts` | **읽기만.** `resolveSessionReaderConfig`가 운영에서 던지는 자리. 이번에 바꾸지 않았다 |

### 배포 정의

| 경로 | 역할 |
| --- | --- |
| `deploy/single-host/smoke-images.sh` | **신규 215행.** 릴리스 산출물 게이트. tar 재적재 → SSR 10종 → 해시 외부 모듈 해석 → 손 조치 흔적 → 거부 계약 둘 → worker `git` |
| `deploy/single-host/build-bundle.sh` | 160행 근처에서 게이트를 부른다. `docker save` 뒤·`tar -czf` 앞 |
| `deploy/single-host/prsctl` | `cmd_smoke`에 「사람이 여는 화면」 블록. busybox `wget`에 `--max-redirect`가 없어 첫 상태 줄을 읽는다 |
| `deploy/single-host/compose.yml` | `web` 서비스 153행에 `OIDC_REDIRECT_URI`. `search-api`에는 넣지 않았다 |
| `deploy/single-host/.env.example` | 인증 절 전체를 다시 씀. `AUTH_ENABLED` 위 주의문, `OIDC_REDIRECT_URI` 신설 |
| `deploy/single-host/RUNBOOK.md` | 8장 증상 행 셋 추가(정상인데 화면만 500 · 재기동 반복 · 인증 켠 뒤 로그인 500), 로그인 루프 처방 정정 |

### 시험

| 경로 | 역할 |
| --- | --- |
| `apps/web/instrumentation.test.ts` | **신규 7건.** `register()`를 실제로 부르고 `process.exit` spy로 종료 요청을 잰다 |
| `apps/web/app/healthz/route.test.ts` | **신규 4건.** `GET()`을 불러 상태 코드를 잰다 |
| `apps/web/lib/server/config.test.ts` | **신규 8건.** 판정이 이유를 돌려주는가, 삼키지 않는가 |
| `packages/authz/src/config.test.ts` | **신규 8건.** 배포 문서에서 읽은 값을 실제 계약 함수에 넣는다 |
| `regression/runtime-reachability.test.ts` | 「초록이 거짓말하지 못한다 (CR-078)」 블록 11건. 게이트가 릴리스 경로에서 사라지지 않게 한다 |
| `regression/fixtures/release-tag/fake-docker` | 커진 이미지 단계를 흉내 낸다. 게이트 모양이 바뀌면 여기도 바뀌어야 한다 |
| `regression/release-tag-ownership.test.ts` | 워크스페이스가 `smoke-images.sh`도 복사한다 |
| `vitest.config.ts` | `apps/web/*.test.ts` 포함 (instrumentation은 프로젝트 루트에 있어야 한다) |

### 문서

| 경로 | 역할 |
| --- | --- |
| `docs/00_governance/change_control.md` | `CR-078` 행과 cascade 절 12항. **closed** |
| `docs/40_delivery/pr_search_implementation_traceability.md` | `DEV-577`·`DEV-579` resolved, `DEV-578` **open**. 6.72.10(원인 판정)·6.72.11(검증 결과) |

### 이 세션의 산출물 (저장소 밖)

| 경로 | 역할 |
| --- | --- |
| `exports/202609110158.md` | 이 세션의 host-visible transcript. **`/export`가 보고한 경로와 다르다** — 실제로는 `exports/` 아래에 생긴다 |

## 2026-09-11 라운드가 만진 것 (CR-077 M 넘버 — 문서 21개, 코드 0)

`main = 2cd7c1c`. **코드는 한 줄도 건드리지 않았다.** 아래는 전부 `docs/` 아래다.

### 정본 — 여기부터 읽는다

| 경로 | 역할 |
| --- | --- |
| `docs/00_governance/change_control.md` | `CR-077` 행(표)과 6장 직전의 cascade 절. **closed** |
| `docs/10_requirements/srs_final.md` | `FR-SEQ-008`(채번)·`FR-SEQ-009`(표기) 절, `v2.22` 요약, `OD-009` 행, 감사 액션 표의 `pull_request.annotate` |
| `docs/40_delivery/pr_search_work_packages.md` | `### WP-074`·`### WP-075` 절. **구현 범위와 DoD의 정본** |

### 설계

| 경로 | 역할 |
| --- | --- |
| `docs/30_technical_architecture/pr_search_architecture_decision_records.md` | ADR-007의 **CR-077 Clarification**(M 넘버는 파생이지 두 번째 시퀀스가 아니다)과 **`ADR-022`**(자동 GHE 쓰기 경로, 제약 다섯) |
| `docs/30_technical_architecture/pr_search_data_model.md` | 마이그레이션 025 설명, `merge_sequence`의 `merge_number`·`annotate_state`·`annotated_at`, `sequence_space`의 `mnumber_head_seq`·`mnumber_head`, 채번 멈춤 규칙 |
| `docs/30_technical_architecture/pr_search_async_events_jobs.md` | `JOB-SEQ-004`(채번)·`JOB-SEQ-005`(표기) 행, `EVT-SEQ-004`(`mnumber.assigned`), 스케줄 표 2행, 순서 보장 절 |
| `docs/30_technical_architecture/pr_search_api_contracts.md` | `API-SEQ-007`(M 넘버 ↔ PR 양방향 해석), PR 상세·검색 응답의 `merge_number`·`merge_number_state` |
| `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` | 13장(M 넘버 표기 쓰기 경로 보안), `THR-046`·`THR-047`, 세 번째 자격 증명 경계 |

### 나머지

- `docs/10_requirements/`: `glossary.md`(「M 넘버」, 정본 필드명 `merge_number`), `prd.md`, `requirements_screen_traceability_matrix.md`
- `docs/20_derived_ui_specs/` 7종: `product_ia`·`wireframe_spec`·`ui_component_spec`(`C-014` 확장)·`screen_state_matrix`(`merge_number_pending`)·`screen_qa_checklist`, 그리고 브리프 2종의 「WP-074·WP-075 M 넘버 실행 규칙」 절
- `docs/40_delivery/`: `pr_search_implementation_roadmap.md`(4.2장), `pr_search_release_validation_plan.md`, `pr_search_implementation_traceability.md`(WP 2행 + `DEV-576`)

### 구현할 때 읽어야 할 코드 (이번에 수정하지 않았다)

| 경로 | 왜 |
| --- | --- |
| `apps/pipeline-worker/src/mirror-runner.ts:126` | `syncByTarget` — **정의만 있고 호출부가 0건이다**(`DEV-576`) |
| `apps/pipeline-worker/src/sequence.ts` | `assignSequence`. 공간 advisory lock과 재작성 감지가 여기 있다 |
| `apps/pipeline-worker/src/sequence-plan.ts:30` | `numberCommits` — M 넘버 계산 함수를 그 옆에 둔다 |
| `packages/github/src/commit-graph.ts:145` | `selectCommitGraph`, `FallbackCommitGraph` — 읽기 실패 시에만 폴백한다 |
| `packages/github/src/mirror-graph.ts:192,232` | `resolveHead`(fetch하지 않는다), `firstParentRevList` |
| `packages/db/migrations/` | 마지막이 `024_export`. 다음은 `025_merge_number` |
| `apps/ingest-gateway/src/server.ts:170` | `createSequencePublisher` — push → `prs:sequence` |

## 2026-09-08 (2차) 라운드가 만지거나 만든 것 (0.1.0-pilot.3 발행)

main = `54ff0a0` (+ `PR #157` 인계 갱신). 발행 대상은 `139e818`이다.

### 배포 산출물 — 사내로 들어가는 것

- `deploy/single-host/prsctl` — **`provision_retention_role()` 신설** (`DEV-556`). `require_env`의 필수 키에 `ADMIN_DATABASE_URL`을 더했고, `install`·`upgrade`·`restore` **셋 모두**에서 `provision_app_role` 바로 뒤에 부른다. URL 파싱은 **마지막 `@` 앞까지를 자격**으로 본다(비밀번호의 `@`를 견딘다). 퍼센트 인코딩과 `prs_admin` 직접 접속은 거부한다.
  **미해결**: `prs_app`을 거부하지 않고 엔드포인트(host/db)를 검증하지 않는다 — 발행본에 그대로 있다
- `deploy/single-host/RUNBOOK.md` — 필수 값 목록에 추가 · 2.B 「파티션 수명 주체」 신설 · 8장 증상 둘 갱신 · 5장 형상 표에서 `prs_retention` 제외
- `deploy/single-host/.env.example` — "임시여도 된다"를 **"필수 값이다"** 로. 수동 롤 생성 안내 제거
- `deploy/single-host/bundle/pr-search-0.1.0-pilot.3-offline{,.tar.gz}` — **`.gitignore` 대상**. 발행본과 같은 산출물이며 지워도 된다

### 문서·회귀

- `docs/20_derived_ui_specs/pr_search_design_system_tokens.md` v0.6 — §9의 사라진 근거 현행화(`DEV-555`) · **번호 없던 절 둘에 번호 부여(13·14)**. 참조가 그 번호를 가리키므로 지우지 마라
- `regression/runtime-reachability.test.ts` — describe 둘 추가. 「제품 스타일시트가 모션을 만들지 않는다」는 **`apps/web` 전체를 재귀로** 훑는다(`DEV-558`). 「파티션 수명 주체가 강제 경로에 있다」는 `require_env`·호출 셋·마이그레이션 뒤 순서·퍼센트 인코딩 거부를 잰다
- `docs/00_governance/change_control.md` — `CR-068`·`CR-069`
- `docs/40_delivery/pr_search_implementation_traceability.md` v6.54 — `DEV-555`~`558` · **6.72장 계열이 이 라운드의 정본**(6.72.1~4 후보 감사 · 6.72.5 번들 생성 · 6.72.6 리뷰 라운드 · **6.72.7 발행 사실**) · 7장 제한 하나 해소
- `agent-context/*.md` + `_handoff/**` — 이 라운드 (`PR #157`)

### 손대면 안 되는 것 (갱신)

- `require_env`의 `ADMIN_DATABASE_URL` — 그것이 `DEV-556`의 강제다. 회귀가 잰다
- `provision_retention_role` 호출은 **셋**이며 **마이그레이션 뒤**여야 한다 (`prs_admin`은 마이그레이션이 만든다)
- 제품 CSS 검사는 **재귀**다. 직계 자식만 세는 형태로 되돌리지 마라
- 파생 토큰 문서의 절 번호 13·14
- 이전 라운드 것 그대로: `Dockerfile`의 실체화 호출 · 실체화 스크립트의 "못 찾으면 종료" · 런북 7장의 남은 `NOT RUN` · `build-bundle.sh`의 원자적 태그 생성

## 2026-09-08 라운드가 만지거나 만든 것 (첫 사내 반입 반영)

pr-search (브랜치 `claude/first-internal-import-findings`, main = 268efa9에서 갈라짐)

- `packages/github/src/config.ts` — `withBlankFallback` 헬퍼 하나로 `resolveGitHubConfig`·`resolveMirrorConfig`를 모았다. **빈 문자열과 공백뿐인 값을 기본값으로 되돌린다** (`DEV-548`). 옛 `?? `형태로 되돌리지 마라 — 회귀가 잡는다
- `packages/github/src/config.test.ts` — 「환경 값이 비어 있을 때 기본값으로 되돌린다」 다섯. 개별 키가 아니라 **불변식**을 잰다("어떤 조합에서도 절대 URL이 나온다")
- `apps/web/next.config.ts` — `serverExternalPackages`는 그대로다. **주석만 바뀌었다** — 이 목록으로는 `DEV-551`이 안 풀린다는 실측 결과와 실제 해법의 위치(`Dockerfile`)를 적었다. `pg`를 이 목록에 넣지 마라, 효과가 없다
- `scripts/materialize-turbopack-externals.mjs` — **신규.** `.next`의 `*.nft.json`에서 해시 이름을 읽어 배포 트리에 빈 스텁을 만든다. 이름을 박지 않으며 **하나도 못 찾으면 종료 코드 1**이다. 그 실패를 없애지 마라
- `Dockerfile` — `deploy-web` 단계가 `pnpm deploy` **뒤에** 그 스크립트를 부른다. 순서를 뒤집으면 지워질 트리에 만든다
- `deploy/single-host/RUNBOOK.md` — 2.C 웹훅 경로 정정 + 「GHE가 서버에 닿지 못할 때」 신설 · 5장 「첫 반입이 만든 것」 표 · 6장 「anchor는 얕게 합쳐진다」 + 확인 명령 · 7장 판정 갱신 · 8장 증상 일곱 추가 · 헤더에 첫 반입 날짜
- `deploy/single-host/.env.example` — `GHE_API_URL`(빈 값의 뜻) · `ADMIN_DATABASE_URL`(실제 대가와 롤 재생성) · `WEB_PORT`(포트 충돌)
- `regression/runtime-reachability.test.ts` — describe 「첫 사내 반입이 드러낸 계약 (CR-066)」 일곱. **코드에서 값을 읽어 문서와 대조하는 형태**다 — 문자열을 박은 곳은 옛 주소 금지 검사뿐이다
- `docs/40_delivery/pr_search_implementation_traceability.md` v6.48 — 5장 `DEV-548`~`553` · **6.70장이 반입 실행 기록의 정본** · 7장 제한 넷 · 8장 반입 사실
- `docs/00_governance/change_control.md` — `CR-066`
- `docs/30_technical_architecture/pr_search_infrastructure_operations.md` v0.13 — 11장 리스크 표: CA 성립 · 프록시는 open 유지 · **인바운드 차단 행 신설**
- `.gitattributes` — 새 스크립트를 LF로 고정했다. **이미지 안으로 들어가는 스크립트라서**이며, `scripts/lint-deps.mjs`(CI 전용)는 고정하지 않는 것이 선례다. CRLF에서도 `node <path>`로는 돈다(실측) — 고정은 셔뱅 실행으로 바뀔 때의 대가 때문이다
- `agent-context/*.md` — 이 라운드와 **인계에 빠져 있던 2026-09-04 라운드**

손대면 안 되는 것 (갱신)

- `Dockerfile`의 실체화 호출 — 지우면 배포 이미지의 모든 SSR이 500이다. 회귀가 잡는다
- 실체화 스크립트의 "못 찾으면 종료" — 조용히 넘기는 순간 이 결함이 그대로 돌아온다
- 런북 2.C의 웹훅 경로 — 정본은 `apps/ingest-gateway/src/server.ts`의 `WEBHOOK_PATH`다. 문서만 고치지 말고 코드에서 읽는 회귀를 함께 본다
- 런북 7장의 남은 `NOT RUN` — 반입이 성공했다고 통과로 바꾸지 마라. 회귀가 `/search`·OIDC·`ACC-06`이 `NOT RUN`인 것을 잰다
- 이전 라운드 것 그대로: 릴리스 워크플로의 스냅숏 단계 순서 · `build-bundle.sh`의 원자적 태그 생성 · 파생 토큰 문서 §9

## 2026-09-03 2차 라운드가 만지거나 만든 것

**pr-search** (`main` = `503cc64`)

- `deploy/single-host/build-bundle.sh` — 발행 직전 `gh api …/git/refs`로 태그를 원자적으로 만들고, 성공했을 때만 `TAG_CREATED_BY_THIS_RUN=1`. 되돌리기는 `--force-with-lease="refs/tags/<v>:<UPSTREAM_COMMIT>"`. **빈 기대값 lease로 되돌리지 마라** (`DEV-541`)
- `regression/release-tag-ownership.test.ts` — 스크립트를 실제로 돌리는 동시성 시험 넷. `git`은 진짜, 원격은 로컬 bare
- `regression/fixtures/release-tag/{fake-gh,fake-docker}` — 대역. `.gitattributes`가 LF로 고정한다(확장자가 없어 `*.sh`에 안 걸린다)
- `regression/runtime-reachability.test.ts` — WP-072 describe의 되돌리기 계약을 새 판정에 맞췄다
- `apps/web/package.json` — css·react 0.3.1, tokens 0.3.0. 셋을 각각 정확 고정한다
- `docs/20_derived_ui_specs/pr_search_design_system_tokens.md` v0.3 — §9를 "Conductor 컴포넌트가 쓰는 토큰"으로 한정하고 §9.1에 섹션 확장·탭 전환의 감사 결과 (`CR-064`)
- `.gitignore` — `plans/`. 되돌리면 번들 빌드가 막힌다 (`DEV-543`)
- 원장 6.66.6(0.1.0-pilot.2 발행 사실) · 6.67.1·6.67.2(`DEV-539`·`540`) · 6.67.1(`DEV-541`) · 6.68(`CR-064`) · 6.69(0.3.1 반영)

**design-system**

- `packages/css/src/components.css` — `.cdt-meter__fill:dir(rtl)`(원점 뒤집기) · `.cdt-drawer`의 `--cdt-drawer-shift`와 keyframe 넷 · `.cdt-badge__dismiss.cdt-btn::after`(34×34 투명 적중 영역) · `aria-sort` 값별 셀렉터
- `packages/css/test/bundle.test.ts` — describe 셋·시험 여덟 추가. 기존 `aria-sort` 시험도 새 계약에 맞췄다
- `scripts/check-release-tags.mjs` — `--snapshot`·`--published-before`. 소유를 **발행 전 레지스트리 상태**로 가른다 (`CR-038`)
- `scripts/check-release-tags.test.mjs` — 임시 git 저장소로 도는 시험 일곱
- `.github/workflows/release.yml` — `changeset publish` **앞**에 스냅숏 단계. 지우지 마라
- `vitest.config.ts` — `scripts` project 신설
- `docs/10_requirements/srs_final.md` v1.6 — FR-CMP-004·005에 AC-6 (`CR-037`)
- `docs/20_derived_ui_specs/conductor_ui_component_spec.md` v0.9 — "칩" 표현을 배지 범위로
- `docs/00_governance/change_control.md` — `CR-037`·`CR-038`
- `docs/40_delivery/conductor_implementation_traceability.md` v0.28 — `DEV-035`~`041`
- `.gitignore` — `plans/`

**손대면 안 되는 것 (갱신)**

- 릴리스 워크플로의 스냅숏 단계 순서 — 발행 뒤에는 건너뛴 패키지와 발행된 패키지를 구분할 수 없다
- `build-bundle.sh`의 원자적 태그 생성 — `gh api …/git/refs`를 `git push`로 되돌리지 마라
- 파생 토큰 문서 §9 — 섹션 확장·탭 전환을 다시 넣지 마라

## 2026-09-03 라운드가 만지거나 만든 것

**pr-search** (`main` = `08250a8`)

- `apps/web/app/layout.tsx` — 레이어 밖 `tokens.css` import를 지웠다. **다시 넣지 마라**: 그 한 줄이 축소 모션 전체를 무력화한다 (`DEV-538`).
- `apps/web/e2e/shell.spec.ts` — 축소 모션 e2e 둘. `durationMs`로 ms 정규화해 비교한다 (Next 빌드가 `140ms`를 `.14s`로 압축한다).
- `apps/web/components/*.tsx` 열둘 — 맨 `<button>` 11곳이 Conductor `Button`으로, 맨 `<code>` 15곳이 `className="cdt-mono"`로 바뀌었다. `Tabs.tsx`는 `data-active` 대신 `variant`로 선택 상태를 그린다. `ShaChip.tsx:86`만 `cdt-num`이다(배지 안이라 색을 덮으면 안 된다).
- `apps/web/package.json` — Conductor 셋이 `0.3.0` 정확 고정.
- `plans/` — 계획서 둘과 README. 추적되지 않는 디렉터리다.

**design-system** (`main` = `2549675`, npm `0.3.0`)

- `packages/tokens/src/primitives.ts` — `ease.linear` 추가. `scales.ts` — `motion.spin`(1000ms linear) 추가. 토큰을 더하면 `palette.dark.test.ts`의 "documented additions" 목록에도 키를 올려야 하고 `check:api --update`가 필요하다.
- `packages/css/src/reset.css` — `fieldset`·`legend`·`mark` 리셋. UA 기본이 새어 나오던 자리다.
- `packages/css/src/base.css` — 축소 모드 블록. 모션 토큰 넷을 `0s`로 만들고, `.cdt-spinner__label` 숨김 규칙과 오버레이 넷의 `display: none` 탈출구가 여기 있다. **숨김과 노출이 같은 레이어에 있어야 한다.**
- `packages/css/src/components.css` — 스피너 기하(svg가 크기를 갖는다)·오버레이 진입/퇴장 keyframes 여덟·Meter의 `scaleX`·`aria-sort` 글리프·`.cdt-badge__dismiss`·포커스 링 셀렉터.
- `packages/css/test/bundle.test.ts` — 이 라운드가 더한 시험 스물 남짓. **`specificityB` 헬퍼와 "링을 이기는 hover·press 규칙이 없다" 시험이 가장 값이 크다.**
- `packages/css/test/class-contract.test.ts` — `CONSUMER_CLASSES`에 `cdt-badge__dismiss`. 소비자가 붙이는 클래스는 여기 선언해야 한다.
- `apps/docs/e2e/foundations.spec.ts` — 감소 모드 비교가 hover를 잴 때 포커스를 뗀다.
- `plans/` 여섯 + README — 계획서와 실행 결과.

**읽는 순서(디자인 품질 작업)**: `plans/README.md`(양쪽) → 해당 계획서 → `packages/css/src/components.css` → `bundle.test.ts`의 대응 describe.

## 이 저장소를 읽는 순서 (문서)

1. `CLAUDE.md` — 충돌 해결 우선순위, 캐스케이드 순서, ID 규약
2. `docs/10_requirements/srs_final.md` — **baseline v2.10** (2026-08-28 기준). 변경은 CR 먼저
3. `docs/00_governance/change_control.md` — CR-001~**050**
4. `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 review v4.6.**
   3장(WP 상태), 4장(FR↔코드 매핑), 5장(DEV-001~**358**), 6장(WP별 검증 기록 — 최신 **6.42**),
   7장(알려진 제한), 8장(다음 작업)
5. `docs/40_delivery/pr_search_work_packages.md` — **v1.8.** WP별 범위·제외·DoD

> **이 절의 버전 숫자는 갱신일 기준의 스냅숏이다.** 상태는 언제나 `HEAD`의 문서 헤더에서 읽는다 —
> CLAUDE.md가 같은 규율을 정한다.

원장의 이 세션 관련 장: **6.27.1**(WP-027 머지 후) · **6.28**(WP-028) ·
**6.28.1**(WP-028 머지 후 + 운영 도달성 표) · **6.30**(WP-068) ·
**6.30.1**(WP-068 머지 후). 릴리스 게이트는 **6.31**로 밀렸다.

## 이 세션에서 만든 소스 (CR-032~036)

### 운영 배선 · 도달성

| 경로 | 역할 |
| --- | --- |
| `apps/search-api/src/runtime.ts` | **운영 조립 이음매.** `buildServerDeps`·`buildIntegrityDeps`·`runtimeCapabilities`. `index.ts`와 시험이 **같은 함수**를 부른다 |
| `apps/search-api/src/runtime.test.ts` | 위의 단위 시험 (9건) |
| `regression/runtime-reachability.test.ts` | **"선언한 기능이 배포에서 실행되는가"만 묻는 계층.** 선언 → 기동 → 종료 → manifest. 호출 형태로 단언한다 |
| `deploy/k8s/pipeline-worker-sequence.yaml` | `sequence` 역할 배포 단위 (replica 1, `Recreate`) |
| `deploy/k8s/pipeline-worker-reconcile.yaml` | `reconcile` 역할 배포 단위 (replica 1) |

### WP-028 (정합성 점검 · 조정 스캔)

| 경로 | 역할 |
| --- | --- |
| `packages/domain/src/integrity.ts` | **대조 규칙 한 벌** — `firstSequenceMismatch`·`sampleFromSeq`. API와 잡이 함께 쓴다 |
| `packages/db/src/repositories/integrity.ts` | 점검이 읽는 것. **쓰기 질의가 없다**(DEV-171의 표현) |
| `apps/search-api/src/ops/sequence-integrity.ts` | API-ADM-007 로직 + 파서 기반 `affected_saved_search_count` |
| `apps/pipeline-worker/src/integrity.ts` | JOB-SEQ-003 스윕 |
| `apps/pipeline-worker/src/reconcile.ts` | JOB-ING-005. `updated desc` + 24h 컷오프, head 복구는 **버스 경로**, 팀 동기화 |
| `apps/pipeline-worker/src/consistency.ts` | JOB-ING-008. 정본은 **`pull_request_snapshot`**, 정규 필드 지문 대조 |
| `apps/pipeline-worker/src/snapshot.ts` | 두 투영 경로가 공유하는 정본 기록 |
| `apps/pipeline-worker/src/sequence-repair-runner.ts` | JOB-SEQ-002 수동 경로 러너 |
| `apps/pipeline-worker/src/sequence.ts` | **`repairSequence` 추가** — 검증 prefix + 최초 불일치부터 재계산 |
| `packages/db/migrations/009_job_type_reassign.*` | `sequence_reassign` 유형 (DEV-128 해소) |
| `packages/db/migrations/010_pr_snapshot.*` | `pull_request_snapshot` (ADR-004 근거) |

### WP-068 (팀 접근 범위)

| 경로 | 역할 |
| --- | --- |
| `packages/authz/src/team-scope.ts` | **공유 동기화** — `syncRepositoryTeamScope`·`refreshTeamScope`. 색인은 포트로 받는다 |
| `packages/db/migrations/011_repository_teams.*` | `repository.allowed_team_ids` + GIN |
| `packages/github/src/client.ts` | `listRepositoryTeams` 신설, `listPullRequestsPage`에 `direction`(기본 asc) |
| `packages/es/src/registry.ts` | **`TEAM_SCOPED_ALIASES`(네 색인)** + `applyRepositoryTeams` |
| `apps/pipeline-worker/src/documents.ts` | `repositoryScope()`가 `allowed_team_ids`를 싣는다 |
| `apps/pipeline-worker/src/authz.ts` | `permission.invalidated` 소비자에 소급 적용 |
| `apps/search-api/src/ops/repositories.ts` | `syncRepositoryTeams` — 공유 구현에 위임 |

### 시험 (이 세션 신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/pipeline-worker/integration/sequence/repair.test.ts` | **실제 git 저장소**로 same-head 중간 손상 복구. 자동 경로가 못 고친다는 사실 자체를 단언 |
| `apps/search-api/integration/ops/sequence-integrity.test.ts` | API-ADM-007 + **운영 조립으로 서버를 세워** 라우트 실재 확인 |
| `apps/search-api/integration/authz/team-scope-es.test.ts` | **실제 Elasticsearch** — `team:` 매칭, 회수 후 비가시화, `document_version` 불변 |
| `packages/db/integration/{job-type-reassign,pr-snapshot}.test.ts` | CHECK 제약·버전 순서·멱등 |
| `packages/authz/src/team-scope.test.ts` | 회수 반영, 색인 실패 시 되돌림, `repository_id` 사용 |

## 이전 세션 파일 (WP-026·WP-027, 보존)

| 경로 | 역할 |
| --- | --- |
| `packages/db/src/repositories/release.ts` | `listReleaseTimeline`, `findContainingReleases` 판정 통일(DEV-160) |
| `apps/search-api/src/sequence/{releases-list,release-comparison}.ts` | API-REL-005 / API-SEQ-003 |
| `apps/search-api/src/sequence/neighbors.ts` | API-REL-001. **CR-032로 `base_branch` 필수화** |
| `apps/web/components/NeighborSequenceList.tsx` | C-019 + `NeighborSection`. **CR-032로 재시도 버튼** |
| `apps/web/components/{PrDetailView,CommitDetailView}.tsx` | W-002·W-003 배선 |
| `apps/web/lib/{release,neighbors}.ts` | 화면 판정 |

## 재사용 계층 (다음 WP가 딛을 것)

| 경로 | 무엇 |
| --- | --- |
| `packages/db/src/repositories/job.ts` | `claimNextJob`(advisory lock) — 새 큐 틀을 만들지 않는다 |
| `apps/pipeline-worker/src/release.ts` | `startReleaseSweeper` — **깨울 수 있는 sleep** 선례 |
| `apps/search-api/src/sequence/space.ts` | `resolveRepository`·`resolveSpace` — 접근 통제의 유일한 관문 |
| `packages/github/src/commit-graph.ts` | `firstParentCommits` — 정합성 대조의 정답지 |
| `apps/pipeline-worker/integration/sequence/fixture.ts` | **실제 git 저장소 픽스처** — `createSequenceFixture` 등 |
| `packages/es/src/registry.ts` | `markRepositoryArchived` — 소급 `update_by_query` 선례 |

## 손대면 안 되는 것

- `docs/10_requirements/srs_final.md`는 baseline이다. CR 먼저.
- 하위 문서는 SRS 범위를 넓힐 수 없다. 넓혀야 하면 SRS를 고친다(CR-031·033 선례).
- **기존 마이그레이션을 수정하지 않는다.** 넓히는 변경은 언제나 새 번호다.
- `agent-context/`는 tracked다. `.gitignore`에 넣지 않는다.
- **세션 전사는 `exports/`에 있다** (`202608251453.md` · `202608260047.md`).
  `.gitignore` 대상이고 **compact 하지 않는다** — 인계 pack의 입력이 아니다.
  `/export`가 떨어뜨리는 원본 대화 기록이며 소스가 아니다.

---

# 2026-08-26 대형 세션이 만든 것 (CR-037 · CR-038)

## 읽는 순서가 바뀐 문서

- `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 v2.2**.
  이 세션의 장: **6.32**(CR-037) · **6.33**(WP-067) · **6.31.1**(REL-003 마감 판정)
- `docs/00_governance/change_control.md` — CR-001~038. **4장 게이트 로그에
  REL-003 `fail` 행이 있다** (검증 계획이 지정한 기록 위치)
- `docs/40_delivery/pr_search_release_validation_plan.md` — **게이트 정의의 정본**.
  §3이 게이트 7종, §4가 REL별 필수 게이트(REL-003 = 2·3·4·5·6·7)

## CR-037 (동시성·권한 정정)

| 경로 | 역할 |
| --- | --- |
| `packages/db/src/advisory-lock.ts` | **세션 범위** advisory lock 신설 — `repositoryScopeLockKey`·`acquireAdvisorySessionLock`·`releaseAdvisorySessionLock`. 기존 것은 전부 트랜잭션 범위였다 |
| `packages/authz/src/team-scope.ts` | `syncRepositoryTeamScope`가 **GHE 조회~색인 반영**을 락으로 감싼다. 락을 쥔 커넥션이 정본 쓰기도 한다 |
| `apps/pipeline-worker/src/sequence.ts` | `repairSequence` 울타리 셋 + `publishSequenceReassigned`(두 경로 공유) + `markRepairStale` |
| `packages/db/src/repositories/sequence-space.ts` | `restoreSequenceState` — `state='reassigning'`일 때만 되돌린다 |
| `packages/db/src/repositories/job.ts` | `finishJobIfRunning`(CAS) · `findJobState` |
| `apps/pipeline-worker/src/consistency.ts` | `SCOPE_FIELDS`·`FINGERPRINT_FIELDS`·`repositoryScopeState`. `snapshot_bootstrap_pending` 관문 |
| `apps/pipeline-worker/src/snapshot-bootstrap.ts` | **JOB-ING-010**. 백필 러너를 잡 유형만 바꿔 재사용 |
| `packages/db/migrations/012_snapshot_bootstrap.*` | 잡 유형 + `repository.snapshot_bootstrapped_at` |

## CR-038 / WP-067 (커밋 메타데이터)

| 경로 | 역할 |
| --- | --- |
| `packages/bus/src/topics.ts` | **`LOGICAL_CONSUMERS`** — 토픽별 논리 소비자. `consumerGroup(topic, consumer?)` |
| `packages/github/src/commit-graph.ts` | `CommitMetadata`·`ChangedPaths`·`CHANGED_PATHS_LIMIT`. `FallbackCommitGraph.readCommit`이 **`null`도 폴백 사유**로 삼는다 |
| `packages/github/src/mirror-graph.ts` | `readCommit`(NUL 구분, `%B` 맨 뒤) · `changedPaths`(**첫 부모 명시**, 실패는 던진다) |
| `packages/github/src/api-graph.ts` | 같은 둘의 API 폴백. `getCommitDetail` 신설 (`patch` 필드는 타입에도 없다) |
| `packages/db/migrations/013_commit_snapshot.*` | **커밋 정본**. `projected_at`이 투영 상태 |
| `packages/db/src/repositories/commit-snapshot.ts` | `upsertCommitSnapshot`(patch_id COALESCE 보존) · `listCommitsMissingSnapshot` · `listCommitsMissingProjection` · `markCommitProjected` |
| `packages/es/src/commit-metadata.ts` | **버전을 올리지 않는 전용 업서트.** 없는 문서는 `createWith`가 있을 때만 만든다 |
| `apps/pipeline-worker/src/commit-enrich.ts` | **JOB-MIR-002**. 방아쇠 넷 + 스윕. 정본 → 색인 순서 |
| `apps/search-api/src/resolve/detail.ts` | 커밋 상세 메타데이터 + `loadSourceCommits`(batch) |
| `apps/search-api/src/sequence/neighbors.ts` | 직접 푸시 행의 커밋 문서 batch join |
| `deploy/k8s/pipeline-worker-mirror.yaml` | **신설**. PVC 포함. 없어서 JOB-MIR-001·002가 배포에 도달할 수 없었다 |
| `deploy/k8s/README.md` | 적용 순서에 mirror 추가 — **회귀가 이제 전부 있는지 본다** |

## 이 세션의 시험 (신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `packages/authz/integration/team-scope-race.test.ts` | **실 PG**. GHE 응답을 뒤집힌 순서로 끝내도 회수가 되살아나지 않는다 |
| `apps/pipeline-worker/integration/sequence/repair.test.ts` | **실 git**. walk 중 head 전진 → 커밋 안 함 → 재시도가 E까지. 취소 CAS. `reassigning` 관측 |
| `apps/pipeline-worker/integration/jobs/snapshot-bootstrap.test.ts` | 업그레이드 픽스처 6단계. 러너가 `created` 정렬을 실제로 넘기는지 |
| `apps/pipeline-worker/integration/jobs/commit-enrich.test.ts` | **실 git·PG·ES**. 직접 푸시 문서 생성·역할 교정·버전 불변·투영 재시도·폴백 |
| `packages/github/integration/graph.test.ts` | 미러 vs API 동일성, **병합 커밋 경로**, blob 0 |
| `packages/bus/integration/redis-streams.test.ts` | **실 Redis**. 두 논리 소비자가 같은 이벤트를 각각 전부 받는다 |
| `apps/search-api/src/resolve/detail.test.ts` | **호출 횟수를 직접 센다** — N+1 증명은 결과로 안 된다 |
| `regression/runtime-reachability.test.ts` | JOB-ING-010·JOB-MIR-002 추가 + **manifest가 적용 순서에 있는지** |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 baseline **v2.5**. CR 먼저
- **기존 마이그레이션을 수정하지 않는다.** 012·013은 이 세션이 신설했다
- **기본 consumer group 이름을 바꾸지 않는다** — Redis에서 읽던 자리를 잃는다
- `agent-context/`는 tracked. 전사는 `exports/`에 둔다 (`todos.md` D절)

---

# 2026-08-26 CR-039 / WP-029가 만든 것

## 읽는 순서가 바뀐 문서

- `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 v2.3**.
  이 세션의 장: **6.34**(WP-029 검증) · **6.34.1**(PR #44 리뷰 라운드)
- `docs/40_delivery/pr_search_work_packages.md` — **v0.4**. WP-029 범위·DoD 16항 재작성
- `docs/00_governance/change_control.md` — CR-001~039. 5장에 CR-039 반영 내역
- `docs/30_technical_architecture/pr_search_async_events_jobs.md` — **3.2·3.3장 신설**
  (참조 파생·`reference_key`·역방향 조회·해결 규칙·완전 파생 집합·전량 재파생),
  `EVT-ING-005` 행, **되먹임 금지 표**, §5.1 **재시도 예산 집행 주체**

## 참조 간선 (WP-029)

| 경로 | 역할 |
| --- | --- |
| `packages/domain/src/link/reference.ts` | **순수 파서 + 안정 식별자.** 패턴 6종·제외 구간·중복 제거·상한·`reference_key`·`parseReferenceKey`·역방향 후보 |
| `packages/es/src/links.ts` | 간선 쓰기·stale 제거·**페이지 넘기는** 역방향 조회·해결/되돌림·`link_summary` leaf 갱신·대상 해석(`msearch`) |
| `apps/pipeline-worker/src/link.ts` | **JOB-REL-001·005·006.** 파생 정본은 PostgreSQL. 방아쇠 둘. 재시도 예산 집행. 재개 가능한 재파생 러너 |
| `apps/pipeline-worker/src/commit-enrich.ts` | **`EVT-ING-005` 발행** (색인 뒤·완결 표식 **앞**) + 되먹임 가드 |
| `apps/search-api/src/ops/jobs.ts` | `OPERATOR_JOB_TYPES` — 집는 러너가 있는 유형만 |
| `deploy/k8s/pipeline-worker-link.yaml` | **신설.** `link` 역할 (미러 볼륨 불필요) |
| `packages/es/src/mappings/links.ts` | `reference_key` 추가 |
| `packages/es/src/mappings/commits.ts` | `links_pending`·`link_summary.reference_count` 추가 |
| `packages/db/src/repositories/{pr-snapshot,commit-snapshot}.ts` | `list*After` — 재개 가능한 오름차순 커서 열거 |

## 이 세션의 시험 (신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `packages/domain/src/link/reference.test.ts` | 파서 55건 — 패턴·제외·신뢰도·중복·상한·부호·역방향 후보 |
| `apps/pipeline-worker/integration/worker/link.test.ts` | **실 PG·ES.** 정본 파생·V1→V2→V3 조정·순서 역전·해결(같은 `_id`)·접두 3갈래·**해결 뒤 모호해지면 되돌림**·cross-repo·접근 통제·leaf 보존·부분 실패·페이지네이션·예산 |
| `apps/pipeline-worker/integration/worker/link-rebuild.test.ts` | **실 git·PG·ES·버스.** 직접 푸시 종단(실제 사슬)·되먹임 없음·발행 실패 시 미완결·과거 데이터·**PG-only 재구축**·결정론·운영자 잡 종단 |
| `apps/search-api/integration/admin/jobs.test.ts` | `link_rebuild` 생성 허용 + 러너 없는 유형 거절 유지 |
| `regression/runtime-reachability.test.ts` | JOB-REL-001·006 도달성 + 발행 순서 셋 + 잡 생성 경로 + 접두 재평가 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 baseline **v2.5**. CR 먼저
- **기존 마이그레이션을 수정하지 않는다.** CR-039는 새 마이그레이션을 **만들지 않았다**
- **기본 consumer group 이름을 바꾸지 않는다** — `link`와 `link:commit-enrich`
- **`link_summary`를 객체 통째로 대입하지 않는다** — leaf 소유가 WP-029/WP-030으로 갈린다
- **`detached`는 WP-030 소유다** — WP-029는 그 필드를 두지 않는다

---

# 2026-08-26 CR-040 · CR-041 / WP-030이 만든 것

## 읽는 순서가 바뀐 문서

- `docs/10_requirements/srs_final.md` — **baseline v2.6** (CR-040이 올렸다). 4.2 조건부 범위·14장 OD 표
- `docs/10_requirements/prd.md` — v1.2
- `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 v2.6.**
  이 세션의 장: **6.35**(WP-030 검증·감사 표·변이) · **6.35.1**(PR #46 리뷰 라운드)
- `docs/40_delivery/pr_search_work_packages.md` — **v0.6.** WP-030 범위·DoD **26항** 재작성, QA-W002-11·12를 WP-031로 이관
- `docs/00_governance/change_control.md` — CR-001~041. 5장에 CR-040·041 반영 내역
- `docs/30_technical_architecture/pr_search_async_events_jobs.md` — **3.4장 신설**(후보 변화 방아쇠·계열별 수명·요약 leaf 정의·실패 처분), JOB-REL-002·003·004 방아쇠 정정, 지표 2종
- `docs/30_technical_architecture/pr_search_data_model.md` — **v0.5.** `detached` 의미 확정, `link_summary` leaf **계산 규칙 표**
- `docs/30_technical_architecture/pr_search_api_contracts.md` — **v0.3.** `summary.reverted_pull_request_count` 등재
- `docs/10_requirements/requirements_screen_traceability_matrix.md` — v0.3 (SRS 버전이 오르면 같은 pass에서 대조한다는 규칙 추가)

## 마이그레이션 014 (CR-041, DEV-240)

`packages/db/migrations/014_relation_candidates.{up,down}.sql` — **인덱스 다섯, 새 표 없음.**

| 인덱스 | 지원 질의 |
| --- | --- |
| `commit_snapshot_patch_candidate_idx` | 체리픽 후보. `(repository_id, patch_id, committed_at DESC, commit_sha)` `WHERE patch_id IS NOT NULL` — **정렬까지 담아** 상위 5건이 정렬 없이 끝난다 |
| `commit_snapshot_subject_idx` | 되돌림 제목 대조(커밋). `split_part(message, E'\n', 1)` |
| `pull_request_snapshot_title_idx` | 되돌림 제목 대조(PR). `(document ->> 'title')` |
| `pull_request_snapshot_open_head_idx` | 스택 상위 후보. `WHERE document ->> 'state' = 'open'` |
| `pull_request_snapshot_base_branch_idx` | **스택 역방향(child)** — DEV-232의 경계 |

**`CREATE INDEX CONCURRENTLY`를 쓰지 않는다** — 러너가 단일 트랜잭션(`packages/db/src/migrate.ts`의 `withTransaction`). 운영 규모 무중단 적용은 **NOT RUN**.

## 관계 파생 (WP-030)

| 경로 | 역할 |
| --- | --- |
| `packages/domain/src/link/text.ts` | **신규.** 공유 텍스트 primitive — `maskExcluded`(코드 펜스·인라인·인용), `evidenceLine`, `commitSubject`, `EVIDENCE_LIMIT`. `reference.ts`가 이것을 가져다 쓴다(중복 primitive를 만들지 않는다) |
| `packages/domain/src/link/derived-id.ts` | **신규.** `derivedLinkId(link_type, from, to)` — 비참조 간선의 결정론 ID. `reference_key`를 일반화하지 않는 이유가 주석에 있다 |
| `packages/domain/src/link/revert.ts` | **신규.** `extractReverts`·`extractCommitReverts`. 트레일러(40자만, `exact`) · `Revert "<제목>"` · PR 제목 접두(`heuristic`) |
| `packages/domain/src/link/cherry.ts` | **신규.** `extractCherryPicks` — 트레일러만. `patch_id` 비교는 파서의 일이 아니다 |
| `packages/db/src/repositories/commit-snapshot.ts` | `findCommitsByPatchId`(방향 술어 `PatchCandidateBound`) · `findCommitsBySubject` · `findCommitsRevertingSha` |
| `packages/db/src/repositories/pr-snapshot.ts` | `findPullRequestsByTitle` · `findOpenPullRequestsByHeadBranch` · `findPullRequestsByBaseBranch` · `findPullRequestSnapshot` |
| `packages/es/src/links.ts` (+492줄) | `writeDerivedLinks` · `deleteStaleDerivedLinks` · `findLinksFrom`/`findLinksTo`(`search_after`로 끝까지) · `setLinkDetached` · `setLinkResolved` · **`summarizeRelations`**(한 왕복 filter 집계 넷) · `LINK_SUMMARY_SCRIPT`에 네 leaf 추가 |
| **`apps/pipeline-worker/src/relations.ts`** | **신규·핵심.** `deriveRelations`(파생→조정→양 끝점 요약) · `reevaluateAffectedRelations`(후보 변화) · `handleRelationsReady`(둘을 묶은 진입점) · `reconcileStackDetachment` · `walkChain`(깊이 10 추적) |
| `apps/pipeline-worker/src/link.ts` | `handleSourceReady`가 `handleRelationsReady`를 부른다 → **JOB-REL-006이 저절로 네 계열을 덮는다** |
| `apps/pipeline-worker/src/metrics.ts` | `linkRelationsTotal` · `linkStackCycleTotal` |
| `apps/search-api/src/sequence/range.ts` | `summary.reverted_pull_request_count` — `SUMMARY_AGGS`에 `filter` 집계 하나. **N+1 아님** |

## 이 세션의 시험 (신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `packages/domain/src/link/relations.test.ts` | 파서 22건 — 패턴·펜스 제외·중복·hex 상한·ID 결정론/방향/충돌 |
| `apps/pipeline-worker/integration/worker/relations.test.ts` | **실 PG·ES 38건.** 파생·**후보 나중 등장 수렴(source 이벤트 없이)**·stale·`detached` 수명·retarget·순환·깊이 12/13·양 끝점 요약·`links_pending` 보존·부분 실패 둘·**운영 사슬(`handleLinkEvent` + `EVT-ING-005`)**·PG-only 재구축 |
| `packages/db/integration/relation-candidates.test.ts` | 마이그레이션 014 11건 — 존재·부분 인덱스 술어·질의 결과·**EXPLAIN으로 식 일치**(`enable_seqscan=off` + `withTransaction`) |
| `regression/runtime-reachability.test.ts` (+20건) | JOB-REL-002·003·004 도달성 · 양 끝점 · 요약 전 refresh · 부분 실패 throw · `links_pending` 미간섭 · 방향 술어 위치 · retarget 역방향 · **새 역할/manifest가 없는지** |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.6**. CR 먼저
- 기존 마이그레이션을 수정하지 않는다. **014는 이 세션이 신설했다**
- 기본 consumer group 이름을 바꾸지 않는다 — `link`와 `link:commit-enrich`
- `link_summary`를 객체 통째로 대입하지 않는다. **`has_stack`은 PR 문서에만 있다** — 커밋에 쓰면 `dynamic: strict`가 거부하고, 거부하는 것이 옳다
- `links_pending`은 **참조 추출**의 완결 상태다. 관계 파생이 그 뜻을 빌려 쓰지 않는다
- `reference_key`는 `references` 전용. 세 계열은 양 끝점으로 ID를 만든다

---

# 2026-08-26 CR-042 / WP-031이 만든 것

## 읽는 순서가 바뀐 문서

- `docs/40_delivery/pr_search_implementation_traceability.md` — 원장 **v2.8**.
  이 세션의 장: **6.36**(WP-031 검증·감사 계열·e2e 귀속 표) · **6.36.1**(PR #47 리뷰 라운드).
  §7의 `flow-001` 항목에 **되돌려서 잰 관측값**을 갱신했다
- `docs/40_delivery/pr_search_work_packages.md` — **v0.8.** WP-031 범위·제외·DoD 재작성(8항 → **21항**), 관련 화면에 **W-001** 추가
- `docs/30_technical_architecture/pr_search_api_contracts.md` — **v0.4.** `### API-REL-006` 신설, `### API-REL-003` 신설(그전에는 카탈로그 한 줄뿐)
- `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` — **v0.3.** THR-034에 **구현 계약** 추가(필터 세 번·`mget` 금지·라우팅 포기)
- `docs/20_derived_ui_specs/*` 5종 — **v0.3.** C-021 두 축 상태 모델, C-015 "요약 없음 vs 관계 없음", W-001/W-002-LINKS/W-003-LINKS, FLOW-006 정정, 상태 매트릭스, QA 신설(W001-24·25 / W002-23~28 / W003-10·11)
- `docs/00_governance/change_control.md` — CR-001~**042**

## 관계 조회 (WP-031)

| 경로 | 역할 |
| --- | --- |
| `packages/es/src/relations-read.ts` | **신규.** 사용자 대면 간선 조회. **라우팅 없음** · `ScopedQuery` 강제 · `limit + 1`로 `truncated` · `assertNoShardFailures` · `link_id` 오름차순. **`links.ts` 밖에 있는 것이 설계다** (DEV-265) |
| `apps/search-api/src/relations/service.ts` | **신규.** API-REL-006 본체. 앵커 해석 → 간선 조회 → **대상 내용 batch**(종류별 1회) → 다중 후보 판정 → 신뢰도 순 정렬. `supportsAnchorKind`가 커밋+`stacks_on`을 거절 |
| `apps/search-api/src/relations/co-changes.ts` | **신규.** API-REL-003. 자격 상태 셋 · `script_score` 정확 자카드(`params.source`는 **맵**) · `_score` desc + `pr_number` asc · 겹침 사전순 10 · `PATH_IGNORE_ABOVE`로 양쪽 집합을 맞춘다 |
| `apps/search-api/src/relations/routes.ts` | **신규.** 파라미터 검증과 오류 매핑. 앵커 하나 · 끝점 조합 불가는 400 · 범위 밖은 404 |
| `apps/search-api/src/server.ts` | `registerRelationRoutes` 등록 — **여기 한 줄이 빠지면 배포에서 사라진다** |
| `apps/search-api/src/resolve/detail.ts` | 커밋 상세가 `links_pending`을 싣는다 (DEV-263) |
| `packages/es/src/architecture.test.ts` | ADR-008 가드레일에 **`mget`·`es.get`** 추가. `client.get`은 받지 않는다(Redis 핸들과 이름이 같다) |

## 화면 (WP-031)

| 경로 | 역할 |
| --- | --- |
| `apps/web/lib/relations.ts` | **신규.** 판정 순수 함수. 없는 것·모르는 것·볼 수 없는 것·해제된 것을 가른다. `LinkSummaryView`가 웹의 유일한 요약 타입이다 |
| `apps/web/components/LinkGroupList.tsx` | **신규.** C-021. `Badge`+`CodeBlock`+`Table`. `SeverityTag`를 **쓰지 않는다**(위험도 어휘라 축이 다르다) |
| `apps/web/components/RelationBadgeGroup.tsx` | **신규.** C-015. `summary === null`이면 **아무것도 그리지 않는다** |
| `apps/web/components/RelationSection.tsx` | **신규.** W-002·W-003 지연 섹션. 유형×방향마다 한 번, 펼칠 때만. 커밋은 `COMMIT_TYPES`(스택 없음) |
| `apps/web/components/CoChangeSection.tsx` | **신규.** W-002 전용. 관계 섹션과 **독립**이다 |
| `apps/web/components/ResultTable.tsx` | `ResultRow.link_summary` 배선 + 관계 열(colSpan 7 → 8) |
| `apps/web/components/{PrDetailView,CommitDetailView}.tsx` | `PendingSection` 골격 → 실제 섹션 |

## 이 세션의 시험 (신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/search-api/integration/relations/relations.test.ts` | 실 ES 15건. **THR-034 대적 매트릭스 넷** · cross-repo 역방향 · 상한 · **왕복 수로 센 N+1 부재** · detached·다중 후보·미해결 · **신뢰도 보고**(M5가 찾은 구멍) |
| `apps/search-api/integration/relations/co-changes.test.ts` | 실 ES 12건. **미끼 30건에 밀리지 않는 진짜 상위**(앱단 pre-limit이면 실패) · 자격 상태 셋 · 90일 **+1초** 경계 · 겹침 15개에서 상한 10 |
| `apps/search-api/integration/relations/reachability.test.ts` | `buildServerDeps`로 세운 서버에 실제 요청. **401이면 라우트가 있고 404면 없다** |
| `packages/es/src/relations-read.test.ts` | 부분 결과 처분 3 · 질의 모양 5(라우팅 부재·`limit+1`·정렬) · clamp 5 |
| `apps/web/lib/relations.test.ts` | 판정 24건 |
| `apps/web/a11y/relations.test.tsx` | 20건. 지연 조회 수 · 네 상태 · THR-020 평문 렌더 · 부분 실패 · W-001 세 상태 · axe 0 |
| `apps/web/e2e/flow-006.spec.ts` | 11건. 실제 브라우저에서 진입 0요청·펼칠 때 8요청·해제·다중 후보·대상 내용 부재·부분 실패·커밋 6요청 |
| `regression/runtime-reachability.test.ts` | +22. 라우트 등록 형태 · 라우팅 부재 · 상한 · `mget` 금지 · **면제 물려받기 금지** · 앱단 cap 부재 · 지연 조회 · **부분 결과 검사가 `hits` 앞에 있는지** |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.6**. CR 먼저
- 기존 마이그레이션을 수정하지 않는다. **CR-042는 새 마이그레이션을 만들지 않았다** — 다음은 015
- 기본 consumer group 이름을 바꾸지 않는다
- `link_summary`를 객체 통째로 대입하지 않는다. `has_stack`은 PR 문서에만 있다
- **사용자 대면 조회를 `packages/es/src/links.ts`에 넣지 않는다** — 그 파일은 ADR-008 가드레일에서 `no_requester`로 면제돼 있어 검사가 침묵한다 (DEV-265)
- **새 조회 경로는 `assertNoShardFailures`를 지나야 한다** — 다른 경로 일곱이 전부 지난다 (PR #47 리뷰 P1)
- `agent-context/`는 tracked. 전사는 `exports/`에 둔다

---

# 2026-08-26 CR-043~047이 만든 것 (계약 경화 5연발)

**코드 변경은 셋뿐이다.** 나머지는 전부 문서다 — 이 세션은 감사와 계약이었지 구현이 아니었다.

## 읽는 순서가 바뀐 문서

| 경로 | 버전 | 이 세션이 바꾼 것 |
| --- | --- | --- |
| `docs/10_requirements/srs_final.md` | **baseline v2.8** | v2.7(CR-043): FR-SEQ-002 **AC-6·7·8** 신설, FR-SRCH-009 관련 화면에 **W-004**. v2.8(CR-044): **AC-7의 봉인 값을 "완결 서수"로 정정** |
| `docs/10_requirements/prd.md` | v1.3 | SCN-002 패싯 목록을 SRS와 맞춤 |
| `docs/10_requirements/requirements_screen_traceability_matrix.md` | v0.5 | FR-SRCH-009에 W-004 추가, **FR-SRCH-008에서 W-004 제거**(정본이 다른 두 순회를 갈랐다), FR-SEQ-002에 커서·패싯 소유 명시 |
| `docs/30_technical_architecture/pr_search_api_contracts.md` | **v0.7** | API-SRCH-004에 **「커서 계약」·「패싯 계약」·「전문 검색 계약」** 세 절, API-SEQ-001에 **「구간 커서와 패싯」**, **API-ADM-004 상세 절 신설** |
| `docs/30_technical_architecture/pr_search_async_events_jobs.md` | **v0.3** | **3.5장 신설** — JOB-ING-006. 불변식 아홉 · **이중 쓰기 대상 열일곱 전수** · 울타리 · 정본 재구축 · 전환 검증 일곱 · 실패/취소 다섯 · 보관 |
| `docs/30_technical_architecture/pr_search_architecture_decision_records.md` | v0.4 | **ADR-010 Amendment** — 이 결정이 덮는 범위(색인이 결과 집합을 소유하는 조회) · 봉투 무결성 · **모든 순회에 PIT** |
| `docs/30_technical_architecture/pr_search_infrastructure_operations.md` | **v0.4** | 배포 단위 표에 `mirror`·`reconcile` 등재, `batch` 상한을 **`1 / 1`**로, **표와 `deploy/k8s/`가 서로를 검사한다**는 규칙 |
| `docs/30_technical_architecture/pr_search_backend_architecture.md` | v0.3 | 깊은 페이징을 W-001·W-004로 갈랐고, 패싯을 **별도 요청 + 1.5초** |
| `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` | v0.4 | THR-003(패싯 집계도 `ScopedQuery`)·THR-014(PIT 자원)·**THR-018(강조의 raw HTML 금지)** |
| `docs/20_derived_ui_specs/*` 4종 | v0.4~v0.5 | C-012 `failed` 상태·C-016 커서 규칙 / W-001·W-004 패싯 축 / 커서 오류 상태 넷 / QA-W001-26~29·QA-W004-23~29 |
| `docs/40_delivery/pr_search_work_packages.md` | **v1.1** | **WP-032 전면 재작성**(선행에 WP-035), **WP-035 전면 재작성**, 3장 순서표를 **실행 순**으로 |
| `docs/40_delivery/pr_search_implementation_roadmap.md` | v0.4 | 의존성 지도에 WP-035 → WP-032, REL-004 실행 순서 |
| `docs/40_delivery/pr_search_implementation_traceability.md` | **v3.4** | DEV-266~312 등록, **6.37 · 6.37.1 · 6.38 · 6.38.1장 신설**, §7의 flow-001 항목 정정(**CI에서도 재현된다**) |
| `docs/00_governance/change_control.md` | — | CR-043~047 대장 + 5장 반영 내역 |

## 이 세션이 만든 소스 (셋뿐)

| 경로 | 역할 |
| --- | --- |
| **`deploy/k8s/pipeline-worker-batch.yaml`** | **신설.** `batch` 역할 배포 단위 — JOB-ING-006(재색인)·JOB-ING-007(아웃박스 재적재). replica 1 · `Recreate` · grace 300s. **인프라 3장이 승인한 단위를 실재시킨 것**이지 새 역할이 아니다 |
| `deploy/k8s/README.md` | 적용 순서에 `pipeline-worker-batch.yaml` 등재 + 그 파일이 없던 이유 설명 |
| **`regression/runtime-reachability.test.ts`** | **+5건 (146 → 151).** 배포 도달성을 **양방향**으로 검사한다 (아래) |

## 새 회귀 다섯의 정확한 책임

| 시험 | 무엇을 지키나 |
| --- | --- |
| `코드가 갈래를 만든 역할은 그것을 세우는 manifest를 갖는다` | `index.ts`의 `roles.includes('X')` → manifest. **구현했는데 배포되지 않았다**를 잡는다 (DEV-292) |
| `인프라 3장이 승인한 배포 단위는 manifest를 갖는다` | 인프라 표 → manifest. **승인했는데 만들지 않았다**를 잡는다. **예외를 적용하지 않는다** (DEV-310·312) |
| `배포 단위 표와 코드 갈래가 서로를 덮는다` | 표가 낡았거나 코드가 앞서 갔다를 잡는다 (DEV-307) |
| `미배포 예외 역할은 배포 단위 표에 오르지 않는다` | 인프라 3장의 규율("배포되지 않는 단위를 표에 먼저 적지 않는다")을 **강제**한다 (DEV-312) |
| `미배포 역할 예외는 목록에 사유와 DEV가 함께 있다` | 예외를 늘리는 것이 경계를 넓히는 일임을 시험이 강제한다 (사유 40자 미만이면 실패) |

`UNDEPLOYED_ROLE_ALLOWLIST`에 `backfill`(DEV-304) · `release`(DEV-305) · `authz`(DEV-306)가 사유와 함께 있다. **고칠 때는 manifest를 만들고 이 목록에서 지운 뒤 인프라 표에 올린다.**

## WP-035 구현이 손댈 자리 (아직 없는 것)

| 무엇 | 지금 상태 |
| --- | --- |
| 버전 인덱스 생성·별칭 전환 | `packages/es/src/bootstrap.ts`는 `ensureIndex`(생성 또는 `putMapping`) + `putAlias`뿐. `indices.ts`의 `ENTITY_INDICES[].index`가 상수 `'prs-*-v1'` |
| 이중 쓰기 seam | 없다. 별칭에 쓰는 함수 **열일곱**: `upsert.ts`(`bulkUpsert`·`upsertOne`) · `commit-metadata.ts`(`upsertCommitMetadata`) · `sequence.ts`(`applySequenceToDocuments`·`applyEpochBump`) · `registry.ts`(`markRepositoryArchived`·`applyRepositoryTeams`) · `releases.ts`(`pruneReleaseDocuments`·`applyReleaseTagsToDocuments`) · `links.ts`(8) |
| JOB-ING-006 러너 | 없다. `apps/pipeline-worker/src/index.ts`의 `roles.includes('batch')` 블록에는 `startOutboxRelay`뿐 |
| API-ADM-004 라우트 | 없다. `apps/search-api/src/ops/`에 `reindex` 없음 |
| CLI | `packages/es/src/cli.ts`가 `apply-mappings`만 받는다. `package.json`에 `es:reindex` 스크립트 없음 |
| `OPERATOR_JOB_TYPES` | `apps/search-api/src/ops/jobs.ts` — `['backfill', 'link_rebuild']`. `reindex`는 **러너와 같은 커밋에서** 더한다 |
| 정본 | 전부 있다 — `pull_request_snapshot`(010) · `commit_snapshot`(013) · `release`(008) · 간선은 JOB-REL-006 재파생 |
| advisory lock | `packages/db/src/advisory-lock.ts`에 세션·트랜잭션 범위 둘 다 있다 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.8**. CR 먼저
- 기존 마이그레이션을 수정하지 않는다. **CR-043~047은 새 마이그레이션을 만들지 않았다 — 다음은 015**
- 기본 consumer group 이름을 바꾸지 않는다
- **사용자 대면 조회를 `packages/es/src/links.ts`에 넣지 않는다** (ADR-008 가드레일 면제가 파일 단위, DEV-265)
- **새 조회 경로는 `assertNoShardFailures`를 지나야 한다**
- **새 역할을 추가하면 ① 코드 갈래 ② manifest ③ 인프라 3장 표 셋이 함께 간다** — 회귀가 양방향으로 검사한다
- `agent-context/`는 tracked. 전사는 **`exports/`**에 둔다

---

# 2026-08-27 WP-035 · CR-048이 만든 것

## 읽는 순서가 바뀐 문서

| 경로 | 버전 | 이 세션이 바꾼 것 |
| --- | --- | --- |
| `docs/10_requirements/srs_final.md` | **baseline v2.8** | **변경 없음** |
| `docs/40_delivery/pr_search_implementation_traceability.md` | **v3.7** | DEV-313~323 등재, **6.39·6.39.1장 신설**, 3장 WP-035 done · REL-004 **4/8** |
| `docs/40_delivery/pr_search_work_packages.md` | **v1.2** | WP-035 done, DoD 20항 중 19항 체크, WP-032 "차단 해제" 표시 |
| `docs/40_delivery/pr_search_implementation_roadmap.md` | **v0.5** | Platform 의존(WP-035 → WP-032) 해소 표시 |
| `docs/30_technical_architecture/pr_search_api_contracts.md` | **v0.8** | 6장 오류 모델 표에 `REINDEX_BUSY | 409` (DEV-313) |
| `docs/30_technical_architecture/pr_search_infrastructure_operations.md` | **v0.5** | 배포 단위 표에 `pipeline-worker:authz` (**1 / 4**), 표 아래 산문 정정 |
| `docs/00_governance/change_control.md` | — | **CR-048** 대장 + 5장 반영 내역 |

## WP-035가 만든 소스 (PR #52)

### `@prs/es` — 색인 원시체

| 경로 | 역할 |
| --- | --- |
| `packages/es/src/write-targets.ts` | **신규.** `WriteTargets`(`shadows`·`recordShadowFailure`) · `SERVING_ONLY` · `dualWrite` · `reportShadowFailure`. **`shadows`가 `Record<string,string>`이라 `@prs/db`의 값이 구조적으로 그대로 대입된다** — 어댑터도 역방향 의존도 없다 |
| `packages/es/src/versioned-index.ts` | **신규.** `concreteIndexName` · `parseIndexVersion`(엄격 `^<별칭>-v<양의 정수>$`) · `listIndexVersions` · `resolveServingIndex` · **`nextUnusedVersion`**(DEV-309) · `createVersionedIndex` · **`switchAlias`(`updateAliases` 한 번)** · `deleteRetiredIndex`(`deleted`/`serving`/`absent`) · `schemaOf` · `isEntityAlias` · **`reindexIndexPort`**(API·CLI 공유) |
| `packages/es/src/upsert.ts` | `bulkUpsert`·`upsertOne`이 대상을 받는다. **shadow 항목을 같은 벌크에** 싣고 실패는 `outcomes`에 섞지 않는다. `sendOne` 추출 |
| `packages/es/src/commit-metadata.ts` | `upsertCommitMetadata` + `sendMetadata` 추출. shadow의 404는 실패로 세지 않는다 |
| `packages/es/src/sequence.ts` | `applySequenceToDocuments`·`applyEpochBump`가 `dualWrite`를 지난다. **서비스 건수만 센다** |
| `packages/es/src/registry.ts` | `markRepositoryArchived`·`applyRepositoryTeams` |
| `packages/es/src/releases.ts` | `upsertReleaseDocuments`·`pruneReleaseDocuments`(**삭제도 이중으로**)·`applyReleaseTagsToDocuments` |
| `packages/es/src/links.ts` | 8경로 + **`sendLinkBulk` 공통 헬퍼**(서비스 N개 뒤에 shadow N개) + `sendSummary` 추출 |

### `@prs/db` — 잡 상태와 울타리

| 경로 | 역할 |
| --- | --- |
| `packages/db/src/reindex-fence.ts` | **신규.** `withReindexWrite`(공유 락 → 대상 해석 → run → **shadow 실패 기록** → 해제) · `withReindexExclusive`(배타) · `ReindexFenceUnavailableError`. **울타리 구간이 DEV-308의 답이다** |
| `packages/db/src/repositories/reindex.ts` | **신규.** `REINDEX_JOB_TYPE` · `ReindexPhase` · `findDualWriteShadows`(running + 활성 단계 + 미전환) · `patchReindexProgress` · `recordShadowFailures`(CAS) · **`enqueueReindex`**(API·CLI 공유 seam) · `listRetiredIndices` · **`listUnrecordedSwitches`** · `markRetired` |
| `packages/db/src/advisory-lock.ts` | `reindexFenceKey()` · `acquireAdvisorySharedLock` · `releaseAdvisorySharedLock` 신설 |
| `packages/db/src/repositories/job.ts` | `enqueueJob`이 `progress`를 **같은 INSERT에** 받는다 (DEV-317) |

### 앱

| 경로 | 역할 |
| --- | --- |
| `apps/pipeline-worker/src/reindex.ts` | **신규·핵심.** `runReindexJob`(prepare→dual_write→backfill→verify→cutover→retention) · `rebuildAlias` 4종 · **`rebuildProjectedCommits`**(DEV-315) · `verifyBeforeCutover`(7항) · `startReindexRunner` · `runRetentionSweep` · **`reconcileSwitchedJobs`**(DEV-319) · `LinkRebuildPort` |
| `apps/pipeline-worker/src/reindex-cli.ts` | **신규.** `pnpm es:reindex --alias`. **직접 재색인하지 않는다** — 같은 enqueue seam으로 잡만 만든다 |
| `apps/pipeline-worker/src/documents.ts` | **`registryOwnedFields`**(레지스트리 소유 필드, DEV-314) · **`buildProjectedCommitDocument`**(PR 유래 커밋 문서, DEV-315). **투영과 재구축이 같은 함수를 쓴다** |
| `apps/pipeline-worker/src/commit-enrich.ts` | `CommitFactSource` · **`commitMetadataFields`** · **`commitCreateFields`** 추출. `scopeFields`는 `registryOwnedFields`에 위임 |
| `apps/pipeline-worker/src/release.ts` | `toDocInput` **export** — 재구축이 같은 빌더를 쓴다 |
| `apps/pipeline-worker/src/index.ts` | `batch` 역할에 `startReindexRunner`·`startRetentionSweeper` 기동 + shutdown |
| `apps/search-api/src/ops/reindex.ts` | **신규.** API-ADM-004 본체. `alias`만 받고 `invalid_alias`/`conflict`/`busy`를 가른다 |
| `apps/search-api/src/ops/jobs.ts` | `OPERATOR_JOB_TYPES`(+`reindex`)와 **`CREATABLE_GENERIC_JOB_TYPES`**를 분리 (DEV-301·302) |
| `apps/search-api/src/ops/routes.ts` | `REINDEX_PATH` · `registerReindexRoutes` |
| `apps/search-api/src/runtime.ts` | **`buildReindexDeps`** — 여기 한 줄이 빠지면 배포에서 사라진다 |
| `apps/search-api/src/ops/errors.ts` · `packages/contracts/src/error-codes.ts` | `REINDEX_BUSY` 등재 (DEV-313) |
| `package.json` | `es:reindex` 스크립트 |

## CR-048이 만든 것 (PR #53)

| 경로 | 역할 |
| --- | --- |
| `deploy/k8s/pipeline-worker-authz.yaml` | **신설.** `PIPELINE_WORKER_ROLES=authz` · replica 1 · grace 60s · **미러 볼륨 없음**. GHE 자격 증명이 선택인 이유와 **없을 때 색인 소급이 돌지 않는다는 결과**를 주석에 남겼다 |
| `deploy/k8s/README.md` | 적용 순서 등재 + 신설 사유 |

## 이 세션의 시험 (신규·확장)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/pipeline-worker/integration/jobs/reindex.test.ts` | **신규 17건. 실 PG·ES.** T1 정상 · T2 이중 쓰기 · T3·T4 shadow 항목 실패 · T5 전환 전 취소 · T6 next-unused-version · T7 보관(+현재 별칭 보호) · **T8 정본만으로 재구축**(옛 인덱스 표식이 안 온다) · **T9 무중단**(전환 포함 전 구간 조회 실패 0) · T10 늦은 취소 · **R1 레지스트리 소유 필드·PR 원본 커밋·본문에 버전 없는 스냅숏** · R2 원자 enqueue · R3 롤백 보관 · R4 전환 재대조 · **WP-032 선행 조건 증명** |
| `apps/search-api/integration/ops/reindex-reachability.test.ts` | **신규 2건.** `buildServerDeps`로 세운 서버에 실제 요청(401이면 있고 404면 없다) + **GHE 없이도 재색인은 선다** |
| `packages/es/src/dual-write.test.ts` | **신규 6건.** 열일곱 목록이 계약과 같은가 · 새 쓰기 원시체가 목록 밖에 생기면 · 운영 호출부가 울타리를 지나는가 · **`SERVING_ONLY`로 재색인을 지나치지 않는가** · **구체 인덱스 이름을 박지 않는가**(FR-ING-008 AC-1) |
| `packages/es/src/versioned-index.test.ts` | **신규 7건.** 접두가 같은 남의 인덱스를 세지 않는다 · 앞자리 0을 받지 않는다 · 별칭 판정 |
| `packages/es/src/architecture.test.ts` | ADR-008 예외에 `apps/pipeline-worker/src/reindex.ts` 등재 (전환 전 검증이 shadow를 구체 이름으로 읽는다) |
| `regression/runtime-reachability.test.ts` | **+43건 (151 → 194).** 재색인 도달성·계약 20 · JOB-AUTH-001 도달성 5 · 리뷰 정정 6 · **배포 단위 표 중복 행**·**표 아래 산문 모순** 2 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.8**. CR 먼저
- 기존 마이그레이션을 수정하지 않는다. **WP-035·CR-048은 만들지 않았다 — 다음은 015**
- 기본 consumer group 이름을 바꾸지 않는다
- **사용자 대면 조회를 `packages/es/src/links.ts`에 넣지 않는다** (ADR-008 면제가 파일 단위)
- **새 조회 경로는 `assertNoShardFailures`를 지나야 한다**
- **새 쓰기 원시체는 `WriteTargets`를 받고 `DUAL_WRITE_PATHS`에 등재한다** — 아키텍처 시험이 강제한다
- **새 운영 쓰기 호출부는 `withReindexWrite`를 지나고 `DUAL_WRITE_CALLERS`에 오른다**
- **애플리케이션에 `prs-*-vN` 구체 이름을 박지 않는다** — 허용은 `indices.ts`·`versioned-index.ts`·`reindex.ts` 셋뿐
- **새 역할은 ① 코드 갈래 ② manifest ③ 인프라 3장 표** 셋이 함께. 표에 **중복 행**을 만들지 않고 **표 아래 산문**도 함께 고친다 (DEV-321·322)
- **문서 본문을 고치면 같은 편집 안에서 상태 헤더를 만진다** (DEV-323)
- `agent-context/`는 tracked. **전사는 `exports/`에 둔다** — 이번 전사는 저장소 루트에 떨어졌고 무시되지 않는다

# 2026-08-27 (2차) WP-032가 만든 것

## 읽는 순서가 바뀐 문서

| 경로 | 버전 | 이 세션이 바꾼 것 |
| --- | --- | --- |
| `CLAUDE.md` · 루트 `AGENTS.md` · `docs/README.md` | — | **현재 상태 스냅숏을 없앴다** (DEV-324·325). 어디서 읽는지를 적는다 |
| `docs/40_delivery/pr_search_implementation_traceability.md` | **v4.1** | 1장·8장 정본 선언(DEV-326), DEV-324~332 등재, **6.40장 신설**, 3장 WP-032 done, 4장 FR 매핑 |
| `docs/40_delivery/pr_search_work_packages.md` | **v1.4** | WP-032 done, DoD 23항 체크, 배포 전제 |
| `docs/40_delivery/pr_search_implementation_roadmap.md` | **v0.6** | 매핑 이행 항목 해소 |
| `deploy/k8s/secret.example.yaml` | — | `SEARCH_CURSOR_HMAC_KEY` |

## `@prs/es` — 매핑·질의·강조

| 경로 | 역할 |
| --- | --- |
| `packages/es/src/settings.ts` | `TEXT_PARTIAL_ANALYZER`(edge_ngram 2~20) · `PARTIAL_TEXT_FIELD` · `SEARCHABLE_KEYWORD_FIELDS`. **`search_analyzer`가 `TEXT_ANALYZER`인 것이 핵심** — 질의까지 자르면 "결제"가 "결"로도 매치된다 |
| `packages/es/src/indices.ts` | **PR·커밋이 `-v2`.** links·releases는 v1 그대로 |
| `packages/es/src/bootstrap.ts` | `aliasHeldElsewhere` — 별칭이 옛 버전을 들면 **물러난다**(DEV-328). `dropEntityIndices`가 버전 전부를 지운다. `switchAliasesForTests`는 **시험 전용** |
| `packages/es/src/query-builder.ts` | `buildTextClause` · `FULL_TEXT_FIELDS` · `FIRST_PARENT_COMMIT_ROLES`. 자유 텍스트가 있을 때만 `source_commit`을 `must_not` |
| `packages/es/src/highlight.ts` | **신규.** 사설 사용 영역 표식 → 평문+구간. `buildHighlight` · `toPlainHighlight` · `containsHighlightMarker` |
| `packages/es/src/sort.ts` | `MISSING_SENTINEL` — **`_last`가 아니다**(DEV-329). `relevance`가 `order`를 존중한다 |
| `packages/es/src/search.ts` | `openPointInTime` · `closePointInTime`(던지지 않는다) · `searchWithPit`. **PIT은 `index`를 함께 주지 않는다** |

## `search-api` — 커서·패싯

| 경로 | 역할 |
| --- | --- |
| `apps/search-api/src/cursor/envelope.ts` | **신규.** HMAC 봉인·두 오류 타입·`ephemeralCursorKey`. **순회의 뜻은 여기 없다** |
| `apps/search-api/src/cursor/params.ts` | **신규.** `readCursor`·`readFacets` — 두 화면이 같은 해석을 쓴다 |
| `apps/search-api/src/search/cursor.ts` | **신규.** PIT + `search_after` 봉투. 지문 재료 다섯 |
| `apps/search-api/src/search/facets.ts` | **신규.** `computeFacets`(ScopedQuery만) · `SEARCH_FACET_AXES`(6) · `RANGE_FACET_AXES`(4) · `coalesceByValue`(DEV-331) |
| `apps/search-api/src/sequence/range-cursor.ts` | **신규.** 정본 서수 봉투. 공간·에폭·경계를 **그대로** 싣는다 |
| `apps/search-api/src/sequence/range.ts` | `scanPage` — chunk 순회(DEV-270)·완결 서수(DEV-287) |
| `apps/search-api/src/config.ts` | `resolveSearchCursorKey` — 운영에서 키 없으면 **던진다** |
| `apps/search-api/src/runtime.ts` | 커서 서명자·`resolveTeamSlugs`를 **여기서** 붙인다 |
| `packages/db/src/repositories/auth.ts` | `resolveTeamSlugs` 신규. `resolveTeamIds`가 **ID를 전부** 돌려준다 (DEV-331) |

## 화면

| 경로 | 역할 |
| --- | --- |
| `apps/web/components/CursorPager.tsx` | **신규.** C-016. 페이지 번호 없음. 두 커서 오류를 다르게 그린다 |
| `apps/web/components/HighlightedText.tsx` | **신규.** `<mark>` 조립. **`dangerouslySetInnerHTML` 없다** |
| `apps/web/lib/highlight.ts` | **신규.** `splitHighlight`(던지지 않는다) · `judgeHighlight` |
| `apps/web/lib/facets.ts` | 네 상태(+`failed`) · `SEARCH_FACET_FIELDS`/`RANGE_FACET_FIELDS`. **응답 키와 질의 키가 갈렸다** |
| `apps/web/components/SearchView.tsx` | `PageState`(carried·cursor·facets·failure·**nonce**). 커서 실패에 **재조회하지 않는다** |
| `apps/web/components/RangesView.tsx` | `q`가 URL에 실린다. 패싯 넷 + 커서 |

## 이 세션의 시험 (신규·확장)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/search-api/integration/search/facets.test.ts` | **신규 39건.** bucket 단위 검증 · THR-003 · 커서 전량 순회(여섯 정렬 키) · `size` 가변 · PIT 안정성 · 전문 검색 · 강조 · 패싯 실패 격리 · 동명 팀 합치기 |
| `apps/search-api/integration/sequence/range-paging.test.ts` | **신규 19건.** DEV-270·287 반례 둘 · 에폭/경계/`q` 무효화 · 구간 전체 패싯 |
| `apps/pipeline-worker/integration/jobs/reindex.test.ts` | **WP-032 매핑 이행 증명** — 옛 스키마가 조용히 0건을 답하고, 전환 뒤 과거 문서가 찾힌다 |
| `packages/es/integration/bootstrap.test.ts` | **+3건.** 별칭이 옛 버전을 든 상태에서 물러나는가·둘로 걸지 않는가·빈 인덱스를 만들지 않는가 |
| `apps/web/e2e/search-paging.spec.ts` | **신규 12건.** 요청 순서(커서 되돌리기·`facets` 한 번)·자동 재조회 없음·실제 DOM 이스케이프 |
| 단위 | 커서 봉투 11 · 검색 커서 13 · 구간 커서 13 · 강조 15+12 · 전문 검색 9 · 코드 포인트 4 · PIT 회전 2 |
| `apps/search-api/integration/_cursor-fixture.ts` | **신규.** 시험용 서명자 — 선택 필드로 만들면 "커서가 조용히 발급되지 않는" 배포를 시험이 통과시킨다 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.8**. CR 먼저
- **PR·커밋 인덱스는 `-v2`다.** 매핑을 또 바꾸면 버전을 올리고 **재색인으로** 배포한다
- `applyMappings`가 옛 버전을 든 별칭에 손대지 않는 방어를 지운다 → 별칭이 둘이 되거나 빈 인덱스가 남는다
- `MISSING_SENTINEL`을 `_last`로 되돌리지 않는다 — 커서가 깨진다
- **W-001·W-004 커서를 합치지 않는다**
- 새 조회 경로는 `assertNoShardFailures`를 지난다. 패싯도 `ScopedQuery`만 받는다
- 강조에 **API가 만든 마크업**을 실지 않는다. 화면은 `dangerouslySetInnerHTML`을 쓰지 않는다
- 새 쓰기 원시체는 `WriteTargets`를 받고 `DUAL_WRITE_PATHS`에 등재한다 (WP-035)
- `agent-context/`는 tracked. **전사는 `exports/`에 둔다**
- `agent-context/_handoff/`는 **생성물**이다 — 손으로 고치지 말고
  `context_handoff.py build`로 다시 만든다. 원본은 `agent-context/*.md` 일곱이다

---

# 2026-08-27 (3차) CR-049 · WP-033이 만든 것

## 읽는 순서가 바뀐 문서

| 경로 | 버전 | 이 세션이 바꾼 것 |
| --- | --- | --- |
| `docs/10_requirements/srs_final.md` | **baseline v2.9** | FR-SRCH-010의 AC-1·2·4 명확화, AC-5·6·7 신설. **기존 AC 번호 유지** |
| `docs/10_requirements/prd.md` | v1.4 | SCN-005에 저장·재실행·공유 흐름 (DEV-339) |
| `docs/10_requirements/glossary.md` | v0.3 | 「대상 팀」 신설. **「커서」 정의가 `search_after`에 묶여 있던 것을 정정** |
| `docs/10_requirements/requirements_screen_traceability_matrix.md` | v0.6 | FR-SRCH-010의 화면별 책임 (DEV-343) |
| `docs/20_derived_ui_specs/pr_search_wireframe_spec.md` | v0.5 | W-001 저장 대화상자, W-008 두 목록·커서·소유권 |
| `docs/20_derived_ui_specs/pr_search_screen_state_matrix.md` | v0.6 | W-001 저장 실패 셋, W-008 상태 다섯 추가 |
| `docs/20_derived_ui_specs/pr_search_ui_component_spec.md` | v0.5 | C-037 소유권별 액션, C-016 한 화면 두 페이저 |
| `docs/20_derived_ui_specs/pr_search_screen_qa_checklist.md` | v0.6 | QA-W008-06~12 신설 |
| `docs/30_technical_architecture/pr_search_api_contracts.md` | v0.9 | **API-SRCH-005 상세 절 신설** (일곱 경로·커서·오류 여덟) |
| `docs/30_technical_architecture/pr_search_data_model.md` | v0.6 | 불변식·인덱스·CASCADE·잠금 규율 |
| `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` | v0.5 | THR-012 완화를 셋으로 |
| `docs/40_delivery/pr_search_work_packages.md` | v1.6 | WP-033 done, DoD 17항 |
| `docs/40_delivery/pr_search_implementation_traceability.md` | v4.3 | 6.41·6.41.1장, DEV-333~349, 7장 등재 |

## 정본 계층

| 경로 | 역할 |
| --- | --- |
| `packages/db/migrations/015_saved_search_contract.up.sql` | 불변식·목록 인덱스 둘·보존 CASCADE. **새 표 없음** |
| `packages/db/src/repositories/saved-search.ts` | **접근 규칙이 질의 안에 있다.** `visibleTo()`가 조회·실행의 조건이고 라우트는 그 부재를 404로 옮길 뿐이다. 두 잠금(`FOR UPDATE`·`FOR SHARE`)이 여기 있다 |

## search-api

| 경로 | 역할 |
| --- | --- |
| `apps/search-api/src/saved-search/cursor.ts` | PostgreSQL 키셋. **PIT·`search_after` 없다.** 지문 = 사용자 + view + 팀 소속(정렬). 접근 범위 버전은 **넣지 않는다** |
| `apps/search-api/src/saved-search/service.ts` | 자원 표현·질의 판정·목록·실행 준비. **`@prs/es`를 가져오지 않는다** — 회귀가 건다 |
| `apps/search-api/src/saved-search/routes.ts` | 일곱 경로. **정적 `/share-targets`가 `/{id}`보다 먼저** |
| `apps/search-api/src/{runtime,server}.ts` | 배선. `buildServerDeps`가 만들고 `buildServer`가 세운다 |

## 화면

| 경로 | 역할 |
| --- | --- |
| `apps/web/lib/saved-search.ts` | **판정은 전부 여기.** 액션·상태·레이블·무효 구간 가르기·실패 안내 |
| `apps/web/components/SaveSearchDialog.tsx` | **`create`/`edit` 두 모드.** 편집에서만 질의를 고칠 수 있다. 열 때 팀 목록을 무효로 만든다 |
| `apps/web/components/SavedSearchList.tsx` | C-037. 소유 여부가 액션을 정하고 무효 구간을 `<mark>`로 짚는다 |
| `apps/web/components/SavedSearchesView.tsx` | W-008. 두 목록이 각자의 커서·세대(`nonce`)를 갖는다 |
| `apps/web/app/saved-searches/page.tsx` · `lib/nav.ts` | 라우트와 내비게이션 |

## 이 세션의 시험

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/search-api/integration/saved-search/saved-search.test.ts` | 65건. 격리·소유권·이탈 후 처분·동시 상한·**잠금 배타(`FOR KEY SHARE`)**·커서·무효 질의·실행·공유 대상·불변식 |
| `apps/search-api/integration/saved-search/executor-scope.test.ts` | 7건. **AC-3의 실물 증명** — 공유받은 사람이 실행하면 저장자만 보는 저장소가 0건 |
| `apps/search-api/src/saved-search/{cursor,service}.test.ts` | 37건. 봉투 거절 갈래·자원 표현 |
| `apps/web/lib/saved-search.test.ts` | 32건. 화면 판정·무효 구간 |
| `apps/web/a11y/saved-searches.test.tsx` | 23건. 액션 표시·프록시 경로·편집 `PATCH`·목록 갱신·axe |
| `apps/web/e2e/saved-search.spec.ts` | 11건. 두 커서·자동 재조회 없음·이동·삭제 확인·편집·무효 구간 |
| `regression/runtime-reachability.test.ts` | +19. 배선·경로 순서·잠금·범위 미저장·오프셋 금지·마이그레이션 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.9**. CR 먼저
- **기존 마이그레이션을 수정하지 않는다.** 다음은 016
- **두 잠금을 지우지 않는다** — 상한은 `FOR UPDATE`, 구성원 자격은 `FOR SHARE`
- `SavedSearchRow.created_at`을 `Date`로 바꾸지 않는다 — 키셋이 항목을 건너뛴다
- **`/run`이 검색을 대신하게 만들지 않는다** — AC-3이 구조로 지켜진다
- 커서 지문에서 팀 소속을 빼지 않는다. **접근 범위 버전을 넣지도 않는다**
- 웹은 `/api/saved-searches`를 부른다 — `/api/v1`을 적으면 `/api/v1/v1/...`이 된다
- 새 쓰기 원시체는 `WriteTargets`를 받고 `DUAL_WRITE_PATHS`에 등재한다 (WP-035)
- `agent-context/`는 tracked. 전사는 `exports/`에 둔다
- `agent-context/_handoff/`는 생성물이다 — 손으로 고치지 말고 `context_handoff.py build`로 다시 만든다

---

# WP-034 W-009 저장소 개요 (CR-050, 2026-08-28)

## 신규 소스

| 경로 | 역할 |
| --- | --- |
| `packages/db/migrations/016_repository_overview.{up,down}.sql` | 등록 요청 표 + `repository` 열 둘. **왜 그렇게 정했는지가 주석에 있다** |
| `packages/db/src/repositories/registration-request.ts` | `ENT-CORE-008`. `recordRequest`가 `ON CONFLICT DO UPDATE`로 자연 멱등을 만든다 — `DO NOTHING`은 동시 요청에서 아직 커밋 안 된 행을 못 본다 |
| `apps/search-api/src/repositories/overview.ts` | `API-ING-002` 서비스. **접근 범위 판정이 SQL이 아니라 여기 있다.** `collectVisible`이 스캔 상한에서도 커서를 남긴다(DEV-357) |
| `apps/search-api/src/repositories/cursor.ts` | PostgreSQL 키셋 커서. 지문에 접근 범위 **해시** |
| `apps/search-api/src/repositories/registration-requests.ts` | `API-ING-003`. **GitHub 클라이언트를 주입하지 않는다** |
| `apps/search-api/src/repositories/routes.ts` | 두 라우트. `/admin` 밖이고 세션 인증만 받는다 |
| `apps/web/lib/repository-overview.ts` | **화면 판정 전부.** `null`·`0`·`unavailable` 구분이 핵심 |
| `apps/web/components/RepositoryCardGrid.tsx` | C-038. 판정을 다시 하지 않고 그린다 |
| `apps/web/components/SequenceSpaceStatusList.tsx` | C-039. 네 상태에 텍스트 레이블 |
| `apps/web/components/RegisterRequestDialog.tsx` | `owner/name`만 받는다 |
| `apps/web/components/RepositoriesView.tsx` | 커서 순회 + 빈 페이지 자동 진행(상한 20) |
| `apps/web/app/repositories/page.tsx` | `/repositories`. `?repository=`로 진단 딥링크 |

## 고친 기존 소스

| 경로 | 무엇 |
| --- | --- |
| `packages/es/src/scoped-query.ts` | `isRepositoryInScope`의 `allowedTeamIds`를 **필수 인자로** (DEV-353) |
| `apps/search-api/src/sequence/{space,spaces-list}.ts` | 그 인자를 실제로 넘긴다 + stale 주석 제거 |
| `apps/pipeline-worker/src/reconcile.ts` | 완주한 회차만 `recordCompletedReconciliation` |
| `apps/search-api/src/ops/pipeline-status.ts` | `sequence_space_state` 전역 요약 (DEV-354) |
| `apps/search-api/src/{runtime,server}.ts` | `repositories` 의존 조립·등록. **세션 블록 안**이라 관리자 토큰으로 안 열린다 |
| `apps/web/components/{ReleasesView,SearchView,PrDetailView,CommitDetailView}.tsx` | W-009 진단 경로 (DEV-159·358) |
| `apps/web/lib/nav.ts` | `/repositories`를 `analysis` 그룹에 등재 |
| `packages/db/src/repositories/{repository,job,raw-event}.ts` | 배치 조회 셋 — N+1을 막는 자리 |

## 시험

| 경로 | 무엇을 거는가 |
| --- | --- |
| `apps/search-api/integration/repositories/scope-parity.test.ts` | **DEV-353의 정본.** 세 경로에 같은 범위 픽스처를 넣어 `explicit`/`org_team` 등식을 건다 |
| `apps/search-api/integration/repositories/overview.test.ts` | 접근 범위·진단 축·커서 순회·**스캔 상한**(DEV-357) |
| `apps/search-api/integration/repositories/registration-request.test.ts` | 멱등·존재 비노출·계약 밖 필드·CASCADE |
| `apps/search-api/integration/repositories/reachability.test.ts` | 운영 조립이 실제로 세우는가 (401 vs 404) |
| `apps/pipeline-worker/integration/reconcile/durability.test.ts` | 완주/미룸/예외 전이를 실 PostgreSQL로 |
| `apps/search-api/src/repositories/cursor.test.ts` | 봉투가 무엇을 거절하는가 |
| `apps/web/lib/repository-overview.test.ts` | 세 값 구분·화면 상태 |
| `apps/web/a11y/repositories.test.tsx` | 렌더·접근성·QA-W009-13 |
| `apps/web/e2e/repositories.spec.ts` | 실제 브라우저에서만 확인되는 넷 |

---

# CR-051 · DEV-349 시퀀스 인용 에폭 (2026-08-28)

## 신규 소스

| 경로 | 역할 |
| --- | --- |
| `packages/query/src/sequence-binding.ts` | **`seq:`가 어느 공간을 뜻하는지 판정하는 유일한 자리.** 순수 함수 — DB도 ES도 모른다(브라우저가 같은 코드를 쓴다). `analyzeSequenceBinding`이 `none`/`bound`/`invalid` 셋을 준다. `hasSequenceRangeFilter`는 "이 질의에 `seq:` **범위**가 있는가" |
| `packages/db/migrations/017_saved_search_seq_epoch.{up,down}.sql` | `saved_search.seq_epoch INT` + `>= 1` CHECK. **소급 채움을 하지 않는 이유가 주석에 있다** |
| `apps/search-api/src/search/sequence-context.ts` | 검색의 **4-1단계**. `resolveSequenceContext`가 바인딩·공간 해석·에폭 확정을 한 번에 하고 라우트가 그 결과로 분기한다. HTTP를 모른다 |
| `apps/search-api/src/saved-search/sequence-reference.ts` | 저장된 검색의 인용 상태. `resolveSequenceReferences`는 **페이지 단위 일괄**, `bindEpochForWrite`는 쓰기 경로(POST·PATCH 공용), `needsSequenceReference`는 접근 범위 산출을 아낄지 정한다 |

## 고친 기존 소스

| 경로 | 무엇 |
| --- | --- |
| `packages/es/src/query-builder.ts` | `buildQuery`에 `BuildQueryOptions.sequenceEpoch`. **`seq:` 범위가 있는데 없으면 `SequenceEpochRequiredError`를 던진다** |
| `apps/search-api/src/search/cursor.ts` | `FingerprintInput.sequenceEpoch` 추가. `seq:`가 없으면 재료가 **없다**(`0` 같은 대체값 금지) |
| `apps/search-api/src/search/service.ts` | `SearchRequest.sequenceEpoch`. `pool`은 여기 **없다** — 라우트 옵션에 있다 |
| `apps/search-api/src/search/routes.ts` | 4-1단계 삽입, `toSequenceFailure`, stale 응답(결과 키 없음), `SearchRouteOptions.pool` |
| `apps/search-api/src/search/relaxation.ts` | 완화 후보에서 `repo:`·`base:` 제외 + 같은 에폭으로 센다 |
| `apps/search-api/src/sequence/space.ts` | `readEpochParam` 신설(세 상태). **옛 `parseEpochParam`은 지웠다** |
| `apps/search-api/src/sequence/routes.ts` | W-004 세 경로가 엄격 파서를 쓴다 |
| `apps/search-api/src/sequence/range.ts` | `runRange`의 `q`에 `request.space.seqEpoch` 전달 (**빠뜨리면 500**) |
| `apps/search-api/src/saved-search/{routes,service}.ts` | POST·PATCH 에폭 계약, `sequence_reference`, `/run`의 `unbound` 차단, `navigationUrlFor(query, epoch)` |
| `packages/db/src/repositories/saved-search.ts` | `SavedSearchRow.seq_epoch`, Create/Update 입력. UPDATE는 **`COALESCE`가 아니라 플래그**(null이 "지움"이어야 한다) |
| `apps/search-api/src/{runtime,server}.ts` | `search`에 `pool` 연결. `ServerDeps.search`가 `SearchDeps & { pool }` |
| `apps/web/lib/query-url.ts` | `PARAM.seqEpoch`, `QueryState.seqEpoch`(**문자열 원문**), `withQuery` 신설, `withAst`가 `seq:` 상실 시 에폭 제거 |
| `apps/web/lib/search-fetch.ts` | `searchUrl`이 `seq_epoch`을 싣는다 (커서와 반대 — 에폭은 누가 열어도 같은 사실) |
| `apps/web/lib/search-state.ts` | `epoch_stale` 상태. **결과 판정보다 먼저 본다**(안 그러면 `loading_initial`에 멈춘다) |
| `apps/web/lib/saved-search.ts` | `describeSequenceReference`, `rowActions.canRebindEpoch`, `createPayload`의 `seqEpoch` |
| `apps/web/components/SearchView.tsx` | 시퀀스 배너, URL 완성(`replace`), `rebindEpoch`, **낡음 상태 저장 차단** |
| `apps/web/components/SaveSearchDialog.tsx` | `seqEpoch`·`edit.current_seq_epoch`. **질의가 실제로 바뀌었을 때만** 에폭을 싣는다 |
| `apps/web/components/{SavedSearchList,SavedSearchesView}.tsx` | 인용 상태 배지, 「현재 에폭으로 다시 연결」(저장자만) |

## 시험

| 경로 | 무엇을 거는가 |
| --- | --- |
| `packages/query/src/sequence-binding.test.ts` | 공간 지목 16종 — 다섯 실패 형태, 중복 값, 부정된 `-seq:`, 스칼라 제외 |
| `apps/search-api/integration/search/sequence-epoch.test.ts` | **계약 일곱 규칙의 정본.** 같은 서수에 두 세대를 색인한 픽스처가 핵심 — 없으면 `seq_epoch` 필터를 지워도 아무 시험이 안 깨진다 |
| `apps/search-api/integration/saved-search/sequence-reference.test.ts` | 저장·낡음·**미연결 보존**·PATCH 다섯 경우·THR-043 비노출·N+1 |
| `apps/web/e2e/sequence-epoch.spec.ts` | 브라우저에서만 드러나는 것 — URL `replace`, 자동 이동 없음, 저장 차단, `seq:` 상실 시 정리 |
| `packages/es/src/query-builder.test.ts` | 에폭 필터 결합 + fail-closed |
| `apps/search-api/src/search/cursor.test.ts` | 지문 재료와 에폭 불일치 거절 |
| `apps/web/a11y/saved-searches.test.tsx` | 인용 상태 넷의 문자 레이블, 재연결 권한, **편집이 에폭을 싣는 두 갈래** |
| `apps/search-api/integration/sequence/range-es.test.ts` | `/sequence-ranges?q=seq:…`가 500이 아니다 (PR #64 리뷰 P2 회귀) |

## 손대면 안 되는 것 (갱신)

- `sequence-binding.ts`의 **첫 검사를 지우지 마라** — 아래 타입 가드가 같은 답을 내지만
  `required`/`ambiguous` 구분을 잃는다(변이 M1이 등가로 살아남아 그 사실을 드러냈다)
- `buildQuery`의 fail-closed를 선택 인자로 되돌리지 않는다
- `toResource()` 안에서 DB를 부르지 않는다 — 그 자리에 한 번 왕복이 들어가면 항목 수만큼 늘어난다
- `QueryState.seqEpoch`을 숫자로 되돌리지 않는다 — 화면이 형식을 판정하면 서버가 거절할 기회를 잃는다
- 커서 계열 넷을 합치지 않는다 (W-001 PIT · W-004 정본 서수 · W-008·W-009 키셋)


---

# 2026-08-29 세션이 만든 소스 (CR-053 · WP-037 · DEV-364)

## 집계 API — `apps/search-api/src/analytics/`

| 파일 | 역할 |
| --- | --- |
| `types.ts` | 모집단(`ANALYTICS_TARGET`)·상한·그룹 키 대응표·분포 구간. **`team`이 `author_team_ids`를 가리키는 자리가 여기다** |
| `prepare.ts` | 질의 준비의 **유일한 자리**. 파싱 → 모집단 → 접근 범위 → 시퀀스 문맥 → 에폭. `CR-051`이 `/search`에 세운 순서와 같다 |
| `execute.ts` | 근사 판정과 실행. `_count`로 세고 `timed_out`·샤드 실패를 함께 본다 |
| `aggregations.ts` | 네 집계의 ES 질의와 응답 변환. **접근 통제가 없다** — `prepare`가 이미 `ScopedQuery`를 만들었다 |
| `routes.ts` | 네 엔드포인트. `runCommon`이 공통 앞단을 갖는다 |
| `aggregations.test.ts` | **경계를 겨냥한 단위 시험.** 통합이 경계를 비켜 가면 그 규칙은 시험에 없다 |

## 성능 harness — `perf/`

| 파일 | 역할 |
| --- | --- |
| `vitest.perf.config.ts` | `PERF_DATASET_SIZE`로 두 규모를 모두 돈다. Level A(알고리즘 회귀)와 Level B(Gate 5)를 **한 harness로** |
| `perf/analytics.perf.test.ts` | 왕복 수와 지연 분포. `search`·`count`·`msearch`를 모두 센다 |

## 이 세션이 고친 기존 파일

| 파일 | 무엇을 |
| --- | --- |
| `packages/query/src/keys.ts` | 질의 키 17종 (`kind`·`author_team` 신설), `RANGE_KEY_EXAMPLE` |
| `packages/query/src/parse.ts` | 범위 전용 키의 스칼라 거절 (DEV-364) |
| `packages/query/src/serialize.ts` | `addEquality`를 화면에서 올려 왔고 `replaceEquality`를 신설 |
| `packages/es/src/query-builder.ts` | `resolveSearchTarget`(대상과 걷어낸 AST를 함께), `RangeKeyEqualityError`, `KindFilterNotAppliedError`, `author_team` 필드 |
| `packages/es/src/search.ts` | `countDocuments` — **`ScopedQuery`만 받는다** |
| `packages/es/src/bootstrap.ts` | `backfillDerivedFields` — `changed_lines` 소급 |
| `packages/es/src/mappings/pull-requests.ts` | `changed_lines` |
| `packages/db/src/repositories/repository.ts` | `resolveOrgOwners`(`resolveOrgIds`의 역방향) |
| `apps/pipeline-worker/src/documents.ts` | `changed_lines` 계산, `firstReviewAt`가 작성자 본인 리뷰 제외 |
| `apps/pipeline-worker/src/reindex.ts` | `derivedFields` — 옛 스냅숏에 없는 파생 필드를 채운다 |
| `apps/search-api/src/search/service.ts` | `resolveSearchTarget` 배선 |
| `apps/search-api/src/search/routes.ts` | `toSequenceFailure`를 export (집계가 같은 판정을 쓴다) |
| `apps/search-api/src/server.ts` | `registerAnalyticsRoutes` 등록, `analyticsDisplay` |
| `apps/web/lib/tokens.ts` | `addEquality`를 `@prs/query`에서 재export |
| `regression/runtime-reachability.test.ts` | 집계 도달성 18건 |

# 2026-08-29 (2차) 세션이 만든 것 (CR-036 · WP-038)

## design-system (CR-036, 0.2.0 배포)
| 파일 | 무엇 |
| --- | --- |
| packages/tokens/src/palette.dark.ts | dataviz 배열 25(정본, nonText hex) |
| packages/tokens/src/palette.light.ts | dataviz 25 override(라이트 진한 값) |
| packages/tokens/src/schema.ts | FIXED_GROUP_SIZES.dataviz=25 |
| packages/tokens/src/contrast-pairs.ts | datavizPairs CP-043~117(25키×3표면) |
| packages/tokens/etc/tokens.api.md | check:api 스냅숏 갱신 |
| package.json | pnpm.overrides 9(audit high 해소) |

## PR Search (WP-038)
| 파일 | 역할 |
| --- | --- |
| apps/web/lib/analytics.ts | 순수 계층. URL 상태·요청·패널 상태 판정·드릴다운. 백분위 p 접두, seq_epoch은 seq: 있을 때만 |
| apps/web/components/AnalyticsView.tsx | 조율. 패널 6개 독립 조회(usePanel enabled), 차트 동적 import |
| apps/web/components/{AggregationPanel,TimeSeriesChart,DistributionChart,PercentileCardRow}.tsx | C-030·033·034·035 |
| apps/web/components/Tabs.tsx | WAI-ARIA 탭(DEV-397). roving tabindex, 화살표·Home·End |
| apps/web/components/SearchAggregationTab.tsx | W-001 집계 탭. 기본 그룹 author, 활성일 때만 조회 |
| apps/web/app/analytics/page.tsx | /analytics 라우트 |
| apps/web/lib/nav.ts | /stats → /analytics |
| apps/web/lib/analytics.test.ts, a11y/analytics.test.tsx, e2e/flow-005.spec.ts | 시험(변이 M1~M10 킬) |

## 손대면 안 되는 것 (갱신)
집계 서버(apps/search-api/src/analytics/*)는 WP-037이 세웠다 — WP-038은 화면만. 계약은 API-STAT-003(백분위 p 접두)이 정본.

---

# 2026-08-29 (3차) 세션이 만든 것 (CR-054 · WP-039)

## 공유 어휘

| 파일 | 역할 |
| --- | --- |
| `packages/domain/src/audit.ts` | **감사 액션의 정본 어휘.** 활성 19 · 미활성 2 · legacy 1을 가른다. `AUDIT_RETENTION_PRINCIPAL`도 여기. **개수를 세지 않는다** |
| `packages/domain/package.json` | `./audit` 서브패스 신설 — 브라우저가 진입점 전체를 끌어오지 않게 |

## 감사 서버 (search-api)

| 파일 | 역할 |
| --- | --- |
| `src/audit/recorder.ts` | **공용 실패 격리 경계 하나.** `auditFailedTotal`(라벨 `action` 하나)도 여기. 절대 던지지 않는다 |
| `src/audit/routes.ts` | `API-ADM-005`. `security_officer` 전용, **접근 범위 필터 없음**, `audit.view`를 응답 확정 뒤에 |
| `src/audit/cursor.ts` | PostgreSQL 키셋. 여섯 필터 지문, 접근 범위는 넣지 않는다 |

## 배선한 호출부 (전부 `recordAuditBestEffort`를 지난다)

`search/routes.ts`(`search.execute`) · `resolve/routes.ts`(`entity.view`) ·
`saved-search/routes.ts`(`saved_search.*`) · `ops/repositories.ts`(`repository.*`) ·
`ops/routes.ts`(`job.*`·`dead_letter.reprocess`·`reindex.start`·`sequence_integrity.check`·
`sequence.reassign`·`raw_event.view_payload`)

## 파티션 수명

| 파일 | 역할 |
| --- | --- |
| `packages/db/src/partitions.ts` | `runPartitionRetention` — **만들고 나서 지운다.** 경계는 카탈로그에서 읽는다(`::timestamptz` 캐스팅) |
| `packages/db/src/{config,pool}.ts` | `resolveAdminPoolConfig` · `createAdminPool`(연결마다 `SET ROLE prs_admin`) |
| `apps/pipeline-worker/src/retention.ts` | `JOB-AUD-001`. 기동 직후 한 번 돌고 일 1회 |
| `packages/db/migrations/018` | `audit_cursor_idx (occurred_at DESC, audit_id DESC)` |
| `packages/db/migrations/019` | 스키마 `CREATE` + **두 표와 기존 자식 파티션의 소유권 이전** |

## A-004 화면

| 파일 | 역할 |
| --- | --- |
| `apps/web/lib/audit.ts` | 순수 계층. URL 상태·요청·응답 변환·상태 판정. **`null`을 지어내지 않는다** |
| `apps/web/components/AuditView.tsx` | 조율. 필터 적용은 **명시적**(입력마다 조회하면 감사 로그가 자기 조사로 찬다) |
| `apps/web/components/AuditRecordTable.tsx` | `C-013`을 쓰지 않는다(DEV-419). 수정·삭제 컨트롤 0 |
| `apps/web/app/ops/audit/page.tsx` | `/ops/audit` |
| `apps/web/lib/nav.ts` | **항목마다 `allowedRoles`.** 새 항목의 기본값은 보이지 않음 |

## 시험

| 파일 | 무엇 |
| --- | --- |
| `search-api/integration/audit/audit-records.test.ts` | `API-ADM-005` 26건 — 역할·필터·커서·자기 기록 순서 |
| `search-api/integration/audit/failure-isolation.test.ts` | 7건 — **실제 DB에 CHECK 제약을 걸어** INSERT를 거절시킨다 |
| `search-api/integration/audit/action-coverage.test.ts` | 9건 — 실제 요청이 실제 기록을 만드는가. **`grep`으로 증명하지 않는다** |
| `pipeline-worker/integration/retention/partition-retention.test.ts` | 13건 — 경계 판정 |
| `pipeline-worker/integration/retention/retention-audit.test.ts` | 7건 — `retention.purge` |
| `pipeline-worker/integration/retention/retention-role.test.ts` | 7건 — **실제 `prs_admin` 권한으로** (DEV-421) |
| `apps/web/{lib/audit.test.ts, a11y/audit.test.tsx, e2e/audit.spec.ts}` | 23 · 9 · 9 |
| `regression/runtime-reachability.test.ts` | 감사 도달성 +36 |

## 손대면 안 되는 것 (갱신)

- **감사 대상의 정본은 `srs_final.md` FR-AUTH-004 AC-1의 표 하나다.** 하위 문서와 코드는
  그것을 인용하며 넓히지 않는다. 새 액션을 더하기 전에 **승인하는 FR을 먼저 찾는다.**
- `recordAuditBestEffort`를 우회해 `auditRepo.recordAudit`를 직접 부르지 않는다 — 회귀가 막는다.
- `API-ADM-005`의 `action` 필터를 정본 enum으로 좁히지 않는다 (AC-7).
- `prs_app`에 `UPDATE`·`DELETE`·`DROP`을 주지 않는다 — 감사 불변성의 마지막 방어선이다.

---

# 2026-08-30 세션이 만든 것 (CR-055 · WP-040)

## 읽는 순서가 바뀐 문서

1. `docs/10_requirements/srs_final.md` — **baseline v2.15**. `FR-ING-009` AC-11·AC-12, `FR-ADMIN-002` AC-6·AC-7, `FR-ING-008` AC-7, `FR-ING-011` AC-7이 신규
2. `docs/00_governance/change_control.md` — CR-001~**055**. CR-055 반영 내역 15항과 리뷰 라운드 기록
3. `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 review v6.1.** 5장에 `DEV-428`~`DEV-436`
4. `docs/40_delivery/pr_search_work_packages.md` — **v2.8.** WP-040을 다시 썼다
5. `docs/30_technical_architecture/pr_search_api_contracts.md` — **v0.17.** `API-ADM-009` 신설, `API-ADM-002` 유형 표, `API-ADM-004` `GET`

## 신규 소스 (구현 브랜치 `claude/wp-040-operations-console`)

| 경로 | 역할 |
| --- | --- |
| `packages/db/migrations/020_registration_request_lifecycle.{up,down}.sql` | 등록 검토 요청의 처리 결과 열. 종료 상태와 종료 시각의 **등가 제약**, 메모 길이 상한, 대기열 인덱스 |
| `apps/search-api/src/ops/registration-requests.ts` | `API-ADM-009`의 순수 로직. 목록·종료·필터 파싱. **`fulfilled`로 옮기는 경로가 여기 없다** |
| `apps/search-api/src/ops/registration-request-cursor.ts` | PostgreSQL 키셋 커서. 지문에 접근 범위를 넣지 않고, 불일치는 `CURSOR_QUERY_MISMATCH` |
| `apps/search-api/src/ops/index-status.ts` | `API-ADM-004` `GET`. 이력은 `job` 정본에서 도출하고 **새 표를 만들지 않는다** |
| `apps/pipeline-worker/src/sequence-assign-runner.ts` | `JOB-SEQ-001` 수동 채번 러너. 기존 `assignSequence`로 모인다 |
| `apps/web/lib/ops-jobs.ts` | A-003 화면 판정. `allowed_actions` 통과, 진행률, 인덱스 값 표시, 재채번 확인 |
| `apps/web/lib/ops-repositories.ts` | A-002 화면 판정. 요청 처리 가능 여부, 브랜치 입력, 해제 문구 |
| `apps/web/lib/ops-pipeline.ts` | A-001 화면 판정. **역할을 먼저 판정**해 `archive_only`가 `operator` 데이터를 요청조차 하지 않는다 |

## 확장한 소스

| 경로 | 무엇이 바뀌었나 |
| --- | --- |
| `packages/db/src/repositories/registration-request.ts` | 행 타입에 처리 결과 넷. `listRequestPage`·`findRequestById`·`dismissRequest`·`fulfillPendingForSlug` |
| `packages/db/src/repositories/job.ts` | `allowedActionsFor` — `ALLOWED_FROM`에서 파생. 표를 두 벌 만들지 않는다 |
| `packages/db/src/repositories/reindex.ts` | `findLastReindexFor` — 별칭의 가장 최근 종료 잡. `job_id`로 정렬한다 |
| `packages/domain/src/sequence.ts` | `parseSequenceSpaceLabel`·`SequenceSpaceParts`. **첫 `@`에서 자른다** |
| `packages/domain/src/audit.ts` | `repository_registration_request.dismiss`를 활성으로 |
| `packages/es/src/versioned-index.ts` | `indexStatsPort` — 별칭별 문서 수·크기. 읽지 못한 값은 `null` |
| `apps/search-api/src/ops/jobs.ts` | `RECONCILE_TARGET`·`resolveJobTarget`·`allowedActionsForJob`. `CreateJobOutcome`에서 `unknown_repository` 제거 |
| `apps/search-api/src/ops/repositories.ts` | `withTransaction`으로 등록+요청 종료, `enqueueSequenceAssign`·`newBranches` |
| `apps/search-api/src/ops/routes.ts` | `API-ADM-009` 라우트 둘, `API-ADM-004` `GET`, `resolveJobTarget` 배선, 커서 오류 두 갈래 |
| `apps/search-api/src/runtime.ts` · `server.ts` | `indexStatus`·`requestQueue` 배선. `hasCursorKey` 게이트 |
| `apps/pipeline-worker/src/reconcile.ts` | 주기와 수동이 **한 루프**. `RECONCILE_POLL_MS`·`RECONCILE_JOB_TYPE` |
| `apps/pipeline-worker/src/backfill.ts` | `finishBackfillIfRunning` — 무방비 `finishJob` 셋을 조건부 전이로 (`DEV-436`) |
| `apps/pipeline-worker/src/index.ts` | `assignRunner` 기동과 종료 |
| `apps/web/lib/nav.ts` | `ops-jobs` 항목 (`/ops/jobs`, `operator` 전용) |

## 이 세션의 시험 (신규)

- `apps/web/lib/ops-{jobs,repositories,pipeline}.test.ts` — 60건
- `regression/runtime-reachability.test.ts` — `JOB-SEQ-001-manual` 도달성 행, 「수동 실행이 실제로 러너에 닿는다」 절(`runReconcileSweep` 호출 지점 계수, 러너 여섯의 무방비 종료 금지)

## 손대면 안 되는 것 (갱신)

- **`apps/pipeline-worker/src/reconcile.ts`의 루프를 둘로 가르지 마라.** `runReconcileSweep` 호출 지점이 둘뿐임을 회귀가 센다
- **조정 스캔의 head 복구를 잡 행으로 바꾸지 마라** — `DEV-180`의 자물쇠가 그대로 돌아온다
- **`recordRequest`의 `ON CONFLICT ... DO UPDATE SET`에 다른 열을 더하지 마라** — 종료된 요청이 반복 호출로 다시 열린다
- **`toRequestView`를 행 펼치기로 바꾸지 마라** — 허용 목록이라서 열이 늘어도 처리 상태가 새지 않는다 (`THR-045`)
- `CREATABLE_GENERIC_JOB_TYPES`에 유형을 더할 때는 **러너와 같은 변경에서** 더한다 (`FR-ADMIN-002` AC-6)

## 아직 없는 것 (다음 에이전트가 만든다)

- `apps/web/app/ops/pipeline/page.tsx` · `repositories/page.tsx` · `jobs/page.tsx`
- `apps/web/components/` 의 `C-040`~`C-047`, `C-071`
- `apps/web/e2e/flow-007.spec.ts` · `flow-008.spec.ts`
- 통합 시험 — 등록 요청 수명주기, 러너 둘, 취소 경합

---

# 2026-08-30 (2차) 세션이 만든 것 (WP-040 완주)

## 읽는 순서가 바뀐 문서

- `docs/40_delivery/pr_search_implementation_traceability.md` — 원장 `review v6.2`. **3장 `WP-040` = done**, 6.52장(검증·변이 열넷·결함 둘), 5장에 `DEV-437`·`DEV-438`, `DEV-436` 종결

## 신규 시험 (백엔드 수직 증명)

| 경로 | 무엇을 증명하나 |
| --- | --- |
| `apps/search-api/integration/admin/registration-request-lifecycle.test.ts` | 등록 요청 수명주기 22건. **두 평면을 한 서버에서 세운다** — 처리 상태 비공개(THR-045)와 조용한 재개방 금지를 함께 재려면 그래야 한다. 정본 쓰기와 요청 종료의 트랜잭션 경계도 실 DB로 본다 |
| `apps/pipeline-worker/integration/reconcile/manual-run.test.ts` | 수동 조정 스캔 8건. 두 방아쇠를 함께 걸어 **동시 진입 최댓값이 1**임을 센다. 집힘은 스캔 횟수가 아니라 `started_at`으로 잰다 — 주기 스윕은 첫 순회에 곧바로 돌기 때문이다 |
| `apps/pipeline-worker/integration/sequence/assign-runner.test.ts` | 수동 채번 14건. **실제 git 픽스처**로 서수가 `git rev-list --first-parent --reverse`와 같음을 대조한다. 기본 이음매가 진짜 `assignSequence`임을 그 통과가 증명한다 |
| `apps/pipeline-worker/integration/jobs/cancel-race.test.ts` | 취소 경합 18건 (DEV-436). `OPERATOR_JOB_TYPES` **다섯 전부**에 성질을 걸고, 백필의 마지막 페이지 창을 실제로 재현한다 |

## 신규 화면 (A-001·A-002·A-003)

| 경로 | 역할 |
| --- | --- |
| `apps/web/components/JobTable.tsx` | `C-044`. **서버의 `allowed_actions`를 그대로 그린다** — 목록이 비면 버튼이 없다 |
| `apps/web/components/JobStatusBadge.tsx` | 잡 상태 여섯 → Conductor `Status` 일곱. **두 화면이 같은 매핑을 쓰는 유일한 자리** |
| `apps/web/components/JobRunForm.tsx` | `C-045`. 유형마다 재료가 다르고 경로도 다르다(`RUN_OPTIONS.path`) |
| `apps/web/components/IndexStatusPanel.tsx` | `C-046`. 읽지 못한 값을 `0`·`0B`로 대신하지 않는다 |
| `apps/web/components/IntegrityReportCard.tsx` | `C-047`. **확인이 끝난 뒤에만 `onReassign`을 부른다** |
| `apps/web/components/RepositoryRegistrationForm.tsx` | `C-043`. 해제 문구는 `ops-repositories.ts`가 소유한다 |
| `apps/web/components/RegistrationRequestQueue.tsx` | `C-071`. **"등록 폼 채우기"가 요청 상태를 바꾸지 않는다** |
| `apps/web/components/PipelineMetricGrid.tsx` | `C-040`. 축 전체와 값 하나의 미확인을 각각 그린다 |
| `apps/web/components/DeadLetterTable.tsx` | `C-041`. 100건 초과는 확인을 **두 번** 거친다 |
| `apps/web/components/ScanResultCard.tsx` | `C-042`. **버튼을 누른 사실은 스캔 완료가 아니다** — 잡으로 지켜본다 |
| `apps/web/components/Ops{Jobs,Repositories,Pipeline}View.tsx` | 세 화면의 조회·폴링·조작. 타이머는 하나이며 조작 중과 백그라운드 탭에서 회차를 건너뛴다 |
| `apps/web/app/ops/{pipeline,repositories,jobs}/page.tsx` | 라우트 셋. `/ops/audit`와 같은 구조(`GuardedPage` + 클라이언트 뷰 + `force-dynamic`) |

## 고친 기존 소스

| 경로 | 무엇이 바뀌었나 |
| --- | --- |
| `apps/search-api/src/ops/jobs.ts` | `resolveJobTarget` 일반 갈래에 슬러그 형식 검사 (DEV-437) |
| `apps/web/lib/server/page-guard.tsx` | `GuardedPageContext` — 관문이 역할과 인증 구성 여부를 본문에 넘긴다. `A-001`만 역할로 **무엇을 요청할지**가 갈린다 |
| `apps/web/lib/ops-pipeline.ts` | `pipelineAccess(roles, authEnabled)` — 인증 미구성 배포에서 빈 역할을 "자격 없음"으로 읽지 않는다 |
| `apps/web/a11y/setup.ts` | `ResizeObserver` 대역 (Radix `Switch`) |
| `apps/search-api/integration/admin/repositories.test.ts` | 채번 예약 시험 셋 — **차분으로 센다** (변이 M8이 드러낸 구멍) |
| `apps/search-api/integration/repositories/registration-request.test.ts` | 열 목록 전문 단언 → 성질 단언 (DEV-438) |
| `regression/runtime-reachability.test.ts` | `resolveJobTarget` 두 갈래의 대칭, `reconcile`의 대상 거절 |

## 신규 a11y·e2e

- `apps/web/a11y/ops-{jobs,repositories,pipeline}.test.tsx` — 63건, axe 위반 0
- `apps/web/e2e/flow-007.spec.ts` · `flow-008.spec.ts` — 16건. **확인 전 네트워크 호출 수가 0임을 실제 호출로 증명한다**

## 손대면 안 되는 것 (갱신)

- **파괴적 조작의 방어선은 핸들러 안의 조건이지 `disabled`가 아니다.** 네 곳이 같은 모양이며 e2e가 호출 수로 센다
- `apps/web/lib/{ops-jobs,ops-repositories,ops-pipeline}.ts`는 **화면 판정의 전부**다. 컴포넌트 안에 판정을 흩뿌리지 않는다
- 라우트가 세션을 직접 읽지 않는다 — `architecture.test.ts`가 `SESSION_COOKIE_NAME`·`sessionStore(`를 금지한다. 역할이 필요하면 관문에서 받는다
- `resolveJobTarget`의 두 갈래가 **모두** 슬러그 형식을 검사한다. 회귀가 그 수를 센다
- 채번 예약 시험을 절대값으로 바꾸지 마라 — 등록이 이미 예약한 것과 이 조작이 더한 것을 가른다
- `apps/pipeline-worker/src/reconcile.ts`의 루프를 둘로 가르지 마라. `runReconcileSweep` 호출 지점이 둘뿐임을 회귀가 센다

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

---

# 세션 종료 (2026-08-30 2차)

## 최종 상태

`main` = `1df0191` (PR `#89`·`#90`·`#91`·`#92` 병합) — **이 인계 커밋이 한 번 더 옮긴다.**

| 항목 | 값 |
| --- | --- |
| REL-005 | **4/4 DONE** |
| 릴리스 | **NOT APPROVED** — Gate 4·5·6 그대로 |
| 열린 PR | 0건 |
| 이번 세션 PR의 미해결 스레드 | 0건 |
| 전체 미해결 리뷰 | 22건 (pr-search) + 9건 (design-system) — `DEV-414` |
| open DEV | 14건 |
| 문서 | SRS `baseline v2.15` · 원장 `review v6.3` · API 계약 `v0.18` · 비동기 잡 `v0.6` |
| CI | **판정에 쓰지 못했다** — 계정 결제 문제 |

## 산출물

- 전사: `exports/202608302158.md` (`.gitignore:24`가 무시한다 — 실측 확인)
- worklog: Obsidian `dailywork/2026-08-30_PR-Search-WP-040-운영-콘솔-완주와-REL-005-마감.md`

## 이 세션이 남기는 한 문장

**돌리지 않은 계층이 남기는 것은 통과가 아니라 미실행이고, 병합이 남기는 것은 완료가 아니라 재확인해야 할 상태다.** 이 세션은 두 규율을 각각 한 번씩 실증했다 — 통합을 먼저 돌려 `DEV-437`을, 병합 후 재확인으로 리뷰 넷을 회수했다.

## 다음

`DEV-414` 미해결 리뷰 31건 대조. 그 다음이 `REL-006`(`WP-041` → `WP-042` → `WP-044`)이며 `WP-043`은 착수하지 않는다. **GitHub Actions 결제 문제가 풀리기 전까지 CI는 판정 근거가 되지 못한다.**

---

# 2026-08-31 세션이 만든 것 (CR-056 · DEV-414 청산)

## 읽는 순서가 바뀐 문서

- `docs/10_requirements/srs_final.md` — **`baseline v2.16`** (CR-056). `FR-STAT-005` AC-1·2·4·5와 `FR-SRCH-005` AC-1
- `docs/40_delivery/pr_search_implementation_traceability.md` — `review v6.7`. 6.52.5(PR #91 리뷰) · 6.53(CR-056) · 6.53.1(PR #95 리뷰) · **6.54(DEV-414 종결)**, `DEV-443`~`457`
- `docs/00_governance/change_control.md` — `CR-056` 행과 반영 내역
- `docs/40_delivery/pr_search_work_packages.md` — `v2.10`. **`WP-069` 신설**, `WP-040` done

## 고친 소스 (pr-search)

| 경로 | 무엇 |
| --- | --- |
| `apps/pipeline-worker/src/reconcile.ts` | 취소 확인 지점 셋 — 페이지 앞·되돌리기 앞·**후속 단계 앞** (DEV-443·448) |
| `apps/search-api/src/ops/jobs.ts` | `conflict.jobId: number` — `null` 제거, 승자 없으면 재시도 (DEV-444) |
| `packages/query/src/keys.ts` | `changed_files`·`changed_lines` 범위 키 (DEV-451) |
| `packages/query/src/serialize.ts` | `intersectNumericRange` — 갈아 끼우지 않고 **교차**한다 (DEV-455) |
| `packages/es/src/query-builder.ts` | 두 키의 필드 매핑 |
| `packages/es/src/upsert.ts` | `UpsertRequest.remove` — 부재를 실제로 만든다 (DEV-454) |
| `packages/es/src/bootstrap.ts` | `clearUnknownSizes` — 기존 색인 소급 (DEV-456) |
| `apps/search-api/src/analytics/types.ts` | `0` 구간, `DIMENSION_QUERY_KEYS`, `RANGE_UPPER_BOUND` (DEV-449) |
| `apps/search-api/src/analytics/aggregations.ts` | 구간별 드릴다운 (DEV-451·455) |
| `apps/pipeline-worker/src/documents.ts` | `filesUnknown` — 판정 재료는 `enrichment_errors`의 `files` (DEV-450·457) |

## 고친 소스 (design-system)

| 경로 | 무엇 |
| --- | --- |
| `packages/react/src/form.tsx` | `SelectRoot` 래퍼 — `FieldContext.required`를 Radix까지, 반환 `ReactElement` |
| `packages/react/src/action.tsx` | `IconButton`이 아이콘을 `iconStart`로 |
| `packages/tokens/src/contrast-pairs.ts` | `ForbiddenPair.usages`, `FP-002`를 `body`로 |
| `packages/tokens/src/contrast/check.ts` | `assertNotForbidden`이 `pair.usage`를 본다 |
| `packages/tokens/src/lint/rules.ts` | `rem`·`px`·`ms`가 선행 점 소수를 잡는다 |
| `scripts/check-release-tags.mjs` | 태그가 릴리스 HEAD를 가리켜야 한다 |
| `.github/workflows/release.yml` | 버전 커밋이 소비한 범위를 제외한다 |
| `docs/00_governance/change_control.md` | `CR-035`에 사용자 승인 기록 |
| `docs/20_derived_ui_specs/conductor_design_system_tokens.md` | `v0.10`. `neutralEnd` 산문 일곱 자리 |

## 손대면 안 되는 것 (갱신)

- `intersectNumericRange` — 드릴다운은 기준 범위와 **교차**한다. 갈아 끼우면 자기가 센 구간보다 넓어진다
- `filesUnknown` — 모름의 판정 재료는 `enrichment_errors`의 `files` 하나다
- `UpsertRequest.remove` — 부재로 판정하는 필드는 부재를 만들 수 있어야 한다
- `reconcile.ts`의 확인 지점 **셋** — 루프 안에만 두면 마지막 단위 뒤를 놓친다
- `CreateJobOutcome.conflict.jobId: number` — `null`을 되살리지 마라
- design-system `SelectRoot`의 반환 타입 `ReactElement`
- design-system `check-release-tags.mjs`의 **불변식** — 입력 목록으로 되돌리지 마라

---

# 2026-08-31 (2차)가 만든 것 (CR-057 · WP-041)

## 읽는 순서가 바뀐 문서

- `docs/10_requirements/srs_final.md` — **baseline v2.18.** `OD-008` resolved(v2.17), `safe_marker.set` 활성(v2.18). **오픈 결정 0건**
- `docs/30_technical_architecture/pr_search_api_contracts.md` — **v0.22.** `API-SEQ-004` 상세 절 신설, 오류 코드 셋, `result_code` 표
- `docs/40_delivery/pr_search_implementation_traceability.md` — **v6.11.** 6.55(CR-057 감사) · 6.56(WP-041) · DEV-458~474
- `docs/10_requirements/requirements_screen_traceability_matrix.md` — v1.2
- `docs/20_derived_ui_specs/pr_search_screen_flow_spec.md` — v0.5. `FLOW-003`에 표식 등록 단계

## 새 소스

| 경로 | 무엇 |
| --- | --- |
| `packages/db/src/repositories/safe-marker.ts` | 표식 리포지터리. **`FOR SHARE` 에폭 재검증 → 완전 일치(7) → `expected` 대조(8) → 이력 → 삽입**을 한 트랜잭션에서 |
| `apps/search-api/src/sequence/safe-marker.ts` | 판정과 응답 모양. `toMarkerView`가 `epoch_stale`을 비교로 만든다 |
| `apps/web/lib/safe-marker.ts` | 화면 판정 (순수). `mayWriteMarker`·`markerCardState`·`judgeMarkerSubmit` |
| `apps/web/components/SafeMarkerCard.tsx` | `C-031`. 서수를 고르지 않고 `targetSeq`로 받는다 |
| `apps/search-api/integration/sequence/safe-marker.test.ts` | 통합 33건 |
| `apps/web/lib/safe-marker.test.ts` | 단위 20건 |
| `apps/web/e2e/safe-marker.spec.ts` | e2e 8건 |
| `agent-context/count-unresolved-reviews.py` | **미해결 리뷰 계수 정본.** 창 둘을 다 순회한다 |

## 고친 소스

| 경로 | 무엇 |
| --- | --- |
| `packages/db/src/advisory-lock.ts` | `safeMarkerLockKey` — 채번 락과 **다른 키** |
| `apps/search-api/src/sequence/routes.ts` | `GET/PUT /safe-markers`, `parseSafeMarkerBody`, `recordMarkerRejection`. `enter`가 인증된 주체를 받는다 |
| `packages/domain/src/audit.ts` | `safe_marker.set`을 **활성으로** |
| `packages/contracts/src/error-codes.ts` | `SEQUENCE_NOT_FOUND`·`SEQUENCE_EPOCH_STALE`·`SAFE_MARKER_CONFLICT` |
| `apps/web/components/RangesView.tsx` | 표식 상태와 제출. **공간 변경 effect가 비운다** |
| `apps/web/app/ranges/page.tsx` | `GuardedPage` 함수 형태로 역할 전달 |
| `regression/runtime-reachability.test.ts` | 도달성 11건 + `expectOrder` 헬퍼 |
| `apps/web/lib/audit.test.ts` · `apps/web/e2e/audit.spec.ts` | 미활성 단언을 **정본 목록 대조로** |

## 손대면 안 되는 것 (갱신)

- `safe-marker.ts`의 **`FOR SHARE` 재검증** — 라우트의 검사만 믿으면 재채번이 그 사이에 커밋한다
- 같은 파일의 **검사 순서 7 → 8** — 뒤집으면 정직한 재시도가 409를 받는다
- **`safeMarkerLockKey`** — 채번 락을 함께 쓰면 사람이 누르는 요청이 파이프라인을 밀어낸다
- `RangesView`의 **공간 변경 effect** — `loadMarker` 안으로 옮기면 등록 결과가 사라진다
- `SafeMarkerCard`의 **제출 앞 `setResult(null)`** — 표식 변화를 보는 effect로 되돌리지 마라
- `expectOrder` — 순서 단언은 존재 확인을 먼저 한다
- `count-unresolved-reviews.py` — 창이 둘이다

---

# 2026-08-31 (3차)가 만든 것 (CR-058 · WP-069)

## 읽는 순서가 바뀐 문서

- `docs/10_requirements/srs_final.md` — baseline **v2.18, 변경 없음.** `CR-058`은 요구사항이 아니라 그것이 딛고 설 계약을 채웠다
- `docs/40_delivery/pr_search_implementation_traceability.md` — **v6.15.** 3장에 `WP-069` 행 신설, 4장 `FR-SRCH-005`·`FR-STAT-006` 매핑 갱신, `DEV-477`~`489`, **6.57장**(감사) · **6.58장**(검증) · **6.58.7장**(리뷰), 7장 제한 행 해소
- `docs/40_delivery/pr_search_work_packages.md` — **v2.13.** `WP-069` 구현 범위 여덟·제외 넷·DoD 열셋, 상태 `done`
- `docs/40_delivery/pr_search_implementation_roadmap.md` — **v0.9.** `REL-005`·`REL-006`의 author-team carryover, 오픈 결정 문장 정정
- `docs/30_technical_architecture/pr_search_api_contracts.md` — **v0.23.** 3장 검색 키 표와 4장 `API-STAT-001` 절이 **같은 사실을 말한다** (DEV-488)
- `docs/30_technical_architecture/pr_search_data_model.md` — **v0.15.** 마이그레이션 021 DDL, 6장에 `author_team_ids`의 출처·신선도·부재의 뜻
- `docs/30_technical_architecture/pr_search_backend_architecture.md` — **v0.6.** 6.3절 신설 — 조회 단위, 낡음 판정, 재색인이 GHE를 부르지 않는 이유
- `docs/00_governance/change_control.md` — `CR-058` 등록과 반영 내역

## 새 소스

| 경로 | 무엇 |
| --- | --- |
| `packages/db/migrations/021_author_team.{up,down}.sql` | `team_membership`(팀 ↔ **GHE login**) · `org_team_sync`(조직별 동기화 시각). `team_member`와 다른 이유를 DDL 주석이 설명한다 |
| `packages/db/src/repositories/team-membership.ts` | `replaceOrgTeamMembership`(조직 단위 교체) · `findOrgSyncedAt`(낡음 판정 재료) · `findAuthorTeamIds`(일괄 조회) |
| `apps/pipeline-worker/src/author-teams.ts` | `resolveAuthorTeams`·`resolveAuthorTeam`(PostgreSQL만) · `syncOrgTeamsIfStale`(GHE) · `startOrgTeamSweeper` |
| `packages/db/integration/team-membership.test.ts` | 리포지터리 통합 9건 |
| `apps/pipeline-worker/integration/worker/author-teams.test.ts` | 판정·동기화·투영·스윕 통합 22건 |

## 고친 소스

| 경로 | 무엇 |
| --- | --- |
| `apps/pipeline-worker/src/documents.ts` | `AuthorTeamResolution` 타입(**순수 계층이 소유**), `ProjectionSource.authorTeams`(필수), 필드 적재, `removed` 배열 |
| `apps/pipeline-worker/src/project.ts` | `resolveAuthorTeam`을 `buildUpsertRequests` **앞에서** 부른다. GHE 의존 없음 |
| `apps/pipeline-worker/src/backfill.ts` | `authorTeamDeps` 헬퍼, 잡 시작에 `syncOrgTeamsIfStale` → PR마다 `resolveAuthorTeam` |
| `apps/pipeline-worker/src/reindex.ts` | `authorTeamIdsFor` — 아는 값이면 덮고 모르면 `null`을 돌려 호출부가 **명시적으로 `delete`** 한다 |
| `apps/pipeline-worker/src/index.ts` | `authz` 역할에 `startOrgTeamSweeper` 기동, 종료 훅에 `orgTeamSweeper?.stop()` |
| `packages/db/src/advisory-lock.ts` | `orgTeamSyncLockKey` — 저장소 범위 락과 나눈다 |
| `packages/db/src/repositories/repository.ts` | `listRegisteredOrgs` — 스윕이 훑을 목록 |
| `packages/db/src/{index,repositories/index}.ts` | `teamMembershipRepo`·`OrgTeamSnapshot`·`orgTeamSyncLockKey` 내보내기 |
| `packages/db/integration/migrate.test.ts` | 기대 표 목록에 `team_membership`·`org_team_sync` |
| `apps/pipeline-worker/src/documents.test.ts` | 단위 8건 추가. 기존 규모 시험을 **`sizeRemovals`로 자기 몫만 거르게** 좁혔다 |
| `apps/pipeline-worker/integration/jobs/reindex.test.ts` | R2 절 신설 — 스냅숏의 옛 소속이 되살아나지 않음 등 4건 |
| `apps/pipeline-worker/integration/jobs/backfill.test.ts` | 작성자 팀 3건. 팀 API를 답하는 대역을 따로 만든다 |
| `apps/search-api/integration/analytics/analytics.test.ts` | 팀 그룹의 접근 범위 격리 1건 |
| `regression/runtime-reachability.test.ts` | 도달성·계약 16건. `expectOrder`를 이 절에서도 쓴다 |

## 손대면 안 되는 것 (갱신)

- **`team-membership.ts`의 `upsertTeam(pool, ...)`** — 트랜잭션 **밖**이다. 안으로 옮기면 23505 재시도가 25P02로 죽는다 (DEV-489)
- **같은 파일의 `org_team_sync` 갱신** — 교체와 **같은 트랜잭션 안**이다. 밖으로 빼면 실패한 조직이 신선해 보인다
- **`author-teams.ts`의 잠금 뒤 신선도 재확인** — 지우면 동시 요청이 조직 팀 전체를 두 번 훑는다 (M10)
- **같은 파일의 루프 순서 `sweep` → `sleep`** — 뒤집으면 냉시작 후 한 주기가 통째로 모름이다 (M19)
- **같은 파일의 `stop()`의 `await loop`** — 빼면 종료가 진행 중인 동기화 위로 풀을 닫는다 (M18)
- **`documents.ts`의 `pr?.author == null` 판정** — 호출부의 값보다 **먼저**다 (DEV-487)
- **같은 파일의 `removed` 배열** — 두 판정이 함께 쓴다. 규모 시험은 `sizeRemovals`로 자기 몫만 거른다
- **`reindex.ts`의 `delete doc['author_team_ids']`** — `undefined` 스프레드로 되돌리지 마라
- **`runtime-reachability.test.ts`의 계약 정합 시험** — 계약 두 자리가 같은 사실을 말하는지 본다 (DEV-488)
- 이전 세션 것 그대로: `safe-marker.ts`의 `FOR SHARE` 재검증과 검사 순서 7 → 8, `safeMarkerLockKey`, `RangesView`의 공간 변경 effect, `SafeMarkerCard`의 제출 앞 `setResult(null)`, `expectOrder`, `count-unresolved-reviews.py`

# 2026-09-01이 만든 것 (CR-059 · WP-070 · CR-060 · CR-061)

## 읽는 순서가 바뀐 문서

- `docs/10_requirements/srs_final.md` — **baseline v2.20.** 5.2 기술 제약 6번(배포 수단)과 `NFR-004`의 프로파일·`RPO 0` 조건. **이 CR들이 SRS를 건드린 자리는 그 둘뿐이다**
- `docs/30_technical_architecture/pr_search_architecture_decision_records.md` — **v0.6. `ADR-021` 신설**
- `docs/30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.10.** 2장 `pilot` 환경, **3.0장 배포 프로파일**, 3.1장 Profile A 열, 4.1장 `OD-006` 좁힘, 6·7·8·9장
- `docs/30_technical_architecture/pr_search_data_model.md` — **v0.17.** 마이그레이션 022·023 DDL
- `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` — **v1.2.** 프로파일별 시크릿 저장, **DB 접속 주체**
- `docs/40_delivery/pr_search_release_validation_plan.md` — **v0.6. 3.1장 프로파일별 게이트 판정**
- `docs/40_delivery/pr_search_implementation_roadmap.md` — **v0.11. 4.1장 첫 사내 반입 마일스톤**
- `docs/40_delivery/pr_search_work_packages.md` — **v2.17. `WP-070`**
- `docs/40_delivery/pr_search_implementation_traceability.md` — **v6.22.** `DEV-490`~`520`, 6.59~6.62장

## 새 소스

| 경로 | 무엇 |
| --- | --- |
| `Dockerfile` · `.dockerignore` | 타깃 여섯(web·search-api·ingest-gateway·pipeline-worker·migrate·es-bootstrap). **저장소에 이미지 정의가 하나도 없었다** |
| `.gitattributes` | 셸·YAML을 LF로 고정. CRLF면 리눅스에서 `bad interpreter` |
| `deploy/single-host/compose.yml` | Profile A — 서비스 18종, 역할당 1, 백킹 미노출 |
| `deploy/single-host/prsctl` | verify·load·install·upgrade·health·smoke·backup·restore·lineage |
| `deploy/single-host/build-bundle.sh` | 오프라인 번들 생성 (외부망 전용) |
| `deploy/single-host/.env.example` | 구성 표면 전수 (40값) |
| `deploy/single-host/filebeat.yml` | K8s ConfigMap과 같은 내용, 전달 방식만 다르다 |
| `deploy/single-host/RUNBOOK.md` | 반입 절차 + **영구 다운스트림 형상 승계**. 번들에 함께 들어간다 |
| `packages/db/migrations/022_app_role_grants.{up,down}.sql` | 005 이후 표의 `prs_app` 권한 |
| `packages/db/migrations/023_app_role_sequence.{up,down}.sql` | 그 시퀀스 권한 |

## 고친 소스

| 경로 | 무엇 |
| --- | --- |
| `apps/search-api/src/server.ts` · `runtime.ts` | `/healthz`가 PG·ES를 실제로 확인한다 (DEV-495) |
| `regression/runtime-reachability.test.ts` | 프로파일 인식 검사 여섯 (316 → 335) |
| `packages/db/integration/audit-grants.test.ts` | **표·시퀀스 전수** 권한 검사 |
| `packages/db/integration/partitions.test.ts` | 시간 비의존 회귀 + 자기 파티션 정리 |
| 통합 헬퍼 넷 | 롤링 과거 창 제거 · `fixtureMonths` |
| 통합 시험 여섯 | 자기 달 선언 |
| `apps/pipeline-worker/integration/retention/retention-role.test.ts` | `failed`를 자기 몫만 센다 |
| `apps/pipeline-worker/integration/reconcile/manual-run.test.ts` | 냉시작 스윕을 먼저 흘려보낸다 (DEV-502) |

## 손대면 안 되는 것 (갱신)

- **`prsctl`의 `provision_app_role` 위치** — 마이그레이션 **뒤**다 (DEV-510)
- **`prsctl`의 `|| true` 넷** — 빼면 `set -e`가 진단 앞에서 죽인다
- **`prsctl`의 재색인 직렬화** — 동시 실행 상한이 1이다 (DEV-519)
- **`build-bundle.sh`의 `git status --porcelain`** — `git diff --quiet`는 미추적을 못 본다 (DEV-512)
- **헬퍼의 `fixtureMonths`** — 롤링 과거 창으로 되돌리지 마라 (DEV-509)
- **`audit-grants.test.ts`의 전수 검사 둘** — 표와 **시퀀스** 양쪽 (DEV-517·518)
- **`compose.yml`의 `127.0.0.1` healthcheck** — `localhost`는 alpine에서 `::1`이다
- **`.gitattributes`** — 지우면 사내 반입 뒤에 드러난다

---

# 2026-09-02이 만든 것 (CR-062 · WP-071)

## 읽는 순서가 바뀐 문서

- `deploy/single-host/RUNBOOK.md` — **정본.** 2장이 A. 외부망 → 경계 → B. 사내망 설치 → C. 초기 데이터 → D. 소스 계보로 재구성됐다. 번들 트리·아카이브 세 종류의 표·`.env`의 소재·필수 키·LF 요건이 여기 있다. 8장에 CRLF 증상 행
- `docs/40_delivery/pr_search_work_packages.md` — v2.19. `WP-071` 절(DoD 16항, FR 집합 명시)
- `docs/40_delivery/pr_search_implementation_traceability.md` — v6.26. 3장 `WP-071` 행, 5장 `DEV-523`~`526`, 6.63·6.63.1·6.64장, 8장
- `docs/00_governance/change_control.md` — `CR-062` closed, 반영 내역
- `docs/30_technical_architecture/pr_search_infrastructure_operations.md` — v0.11. 8장 외부망 명령(`build-bundle.sh`), 9.1장 흐름에 운반 아카이브와 `.env → load`
- `docs/40_delivery/pr_search_implementation_roadmap.md` — v0.13. 4.1장 흐름도에 `WP-071` done

## 고친 소스

| 경로 | 무엇 |
| --- | --- |
| `deploy/single-host/build-bundle.sh` | `ARCHIVE` 정의 · 시작 시 이전 아카이브 제거 · 복사한 텍스트 LF 정규화(DEV-526) · `RELEASE_NOTES` 운반 절 · checksum·시크릿 검사 뒤 `tar -czf` + `tar -tzf` 재독 · 사람 중심 성공 출력 |
| `deploy/single-host/prsctl` | `cmd_load`의 첫 줄이 `require_env` (DEV-524). 그 밖에는 머리글 한 줄 |
| `deploy/single-host/RUNBOOK.md` | 2장 전면 재구성, 3장 업그레이드 순서(`PRS_VERSION` → `load`), 5장 첫 반입은 2.D를 가리킴, 7장 검증 표 셋, 8장 행 다섯. PR #118: 2.B 3단계에 GHE App 자격(`install` 전), 2.C 1번, 3장 표의 `.env` 변경 반영 행, 8장 행 (DEV-527) |
| `.gitattributes` | `deploy/single-host/.env.example`·`RUNBOOK.md` `text eol=lf` |
| `regression/runtime-reachability.test.ts` | `describe('사내 반입 절차가 실행 도구와 같은 말을 한다 (WP-071 / CR-062)')` — 시험 다섯 (335 → 340) |

## 손대면 안 되는 것 (갱신)

- `build-bundle.sh`의 `tar -czf "$ARCHIVE" -C "$OUT_ROOT" "$(basename "$BUNDLE")"` — checksum·시크릿 검사 뒤, 형제 위치. 앞으로 옮기거나 `-C`를 빼지 마라
- 같은 파일 복사 루프의 `sed -i 's/\r$//'` — 빼면 빌더가 `autocrlf`일 때 CRLF 번들이 나간다 (DEV-526)
- `prsctl` `cmd_load`의 첫 줄 `require_env` — 뒤로 옮기면 side effect 뒤 실패다 (DEV-524)
- 런북 2.A 표의 `prsctl load`(`./` 없음)와 2.B의 `./prsctl …` 순서 — 회귀가 2.B 안에서 순서를 잰다
- 런북 2.B 3단계의 GHE App 자격 — `install` 전이다. 2.C로 되돌리지 마라 (DEV-527)
- 이전 세션 것 그대로: `provision_app_role` 위치, `|| true` 넷, 재색인 직렬화, `git status --porcelain`, `fixtureMonths`, `audit-grants.test.ts`의 전수 검사 둘, `compose.yml`의 `127.0.0.1`

---

# 2026-09-02 (2차)가 만든 것 (CR-063 · WP-072 · 0.1.0-pilot.2)

## 읽는 순서가 바뀐 문서

- `deploy/single-host/RUNBOOK.md` — 정본. 1장 네트워크·디스크 행, 2장 경계(「경계 — 번들은 GitHub Release에서 받는다」: 토큰 종류·소재, curl 경로, digest 대조, immutable 권고, 닿지 않는 환경의 대체 경로), 2.A(`--release`, 전달할 것 셋), 2.B 1단계(받기 → digest 대조 → 풀기, 단계 번호 유지), 3장 업그레이드, 6장 github.com 접근, 7장 검증 표 셋, 8장 행 다섯
- `docs/00_governance/change_control.md` — CR-063 행(closed)과 반영 내역, 영향 ID DEV-528~537
- `docs/30_technical_architecture/pr_search_architecture_decision_records.md` — v0.7, ADR-021 「정정 — 사내 outbound 전제」
- `docs/30_technical_architecture/pr_search_infrastructure_operations.md` — v0.12, 8장 발행·다운로드 명령, 9.1장 경계
- `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` — v1.3, 6장 GitHub Release 읽기 토큰 행과 Profile A 규칙
- `docs/40_delivery/pr_search_work_packages.md` — v2.21, WP-072 절(구현 범위 14, 제외 10, DoD 16 전부 [x])
- `docs/40_delivery/pr_search_implementation_traceability.md` — v6.34. 3장 WP-072 행, 5장 DEV-528~537, 6.65(감사)·6.65.1(DEV-530)·6.66(검증)·6.66.1~6.66.5(머지 후 리뷰 정정), 8장
- `docs/40_delivery/pr_search_implementation_roadmap.md` — v0.14, 4.1장 WP-072 done
- `docs/README.md` — 첫 사내 반입 문단에 발행·취득 경로

## 고친 소스

| 경로 | 무엇 |
| --- | --- |
| `deploy/single-host/build-bundle.sh` | 인자 파싱 `<version> [출력 디렉터리] [--release]` · 발행 전제 검사 블록(`gh` 인증 → `REPO_SLUG` → 초안 잔재 `LEFTOVER_DRAFT` → `gh release view` → 태그 `TAG_TARGET`/`TAG_EXISTED` → `IMMUTABLE`) · RELEASE_NOTES 운반 절 · 발행 블록(`sha256_of`·`stat` → 본문 `NOTES` → `lookup_draft_id()` · `undo_release()` · `undo_note()` → `gh release create --draft` → id 조회 3회 → `PATCH draft=false` → `releases/tags/<v>` 재독으로 이름·크기·digest 대조) · 성공 출력(Release URL, SHA-256, immutable 상태, 별도 채널 전달 셋, 사내 명령 셋) |
| `regression/runtime-reachability.test.ts` | `describe('사내 반입 운반이 GitHub Release와 같은 말을 한다 (WP-072 / CR-063)')` — 시험 일곱: 재독 뒤 발행·`--target` · 초안 발행·발행 뒤 대조·`undo_release; die` · 같은 버전 검사가 빌드 앞 · 런북 2.B 1단계 순서와 단계 번호 · 토큰이 `.env.example`에 없음 · 별도 채널 SHA-256 · DEV-531~537 되돌리기 규칙(`lookup_draft_id`, `for attempt in 1 2 3`, `UNDONE=1`, `ls-remote` → `push`, `"$TAG_NOW" != "$UPSTREAM_COMMIT"`, `PUBLISHED` 부재, 옛 `grep` 부재) |

## 산출물 (저장소 밖 · 무시 대상)

- `deploy/single-host/bundle/pr-search-0.1.0-pilot.2-offline/`(2.6GB)와 `pr-search-0.1.0-pilot.2-offline.tar.gz`(1,132,734,876바이트) — 정식 발행분. 지우지 않았다. 옆의 `pr-search-0.1.0-pilot.1-offline`·`pr-search-import-procedure-test-offline{,.tar.gz}`는 이전 세션의 잔재(낡음, 지워도 된다)
- GitHub Release `0.1.0-pilot.2` — 태그 → `0a73065`
- 로컬 Docker 이미지 `prs/*:0.1.0-pilot.2` 6종
- worklog·메모리 노트는 session-notes.md 참조

## 손대면 안 되는 것 (갱신)

- `build-bundle.sh`의 전제 검사 순서: `LEFTOVER_DRAFT` → `gh release view` → 태그. 뒤집으면 초안 잔재에 "새 버전으로 만든다"는 틀린 처방이 나온다
- 같은 파일의 발행 순서: `tar -tzf` 재독 → `gh release create --draft` → id 조회 3회(실패 시 `undo_release`) → `PATCH draft=false` → 자산 재독 대조(실패 시 `undo_release` + `undo_note`). `--draft`를 빼면 immutable 저장소에서 자산을 붙이지 못한다
- `undo_release()`의 규칙: id를 모르면 `lookup_draft_id`로 재조회 · 태그는 `TAG_EXISTED=0`이고 `ls-remote`(peeled 포함)가 있고 대상 커밋이 `UPSTREAM_COMMIT`과 같을 때만 push로 지운다 · 결과는 `UNDONE`·`RELEASE_DELETED`·`TAG_LEFT`·`TAG_DELETED`·`TAG_FOREIGN` · `PUBLISHED` 플래그를 되살리지 마라(DEV-535)
- `undo_note()`가 모든 되돌리기 뒤의 `die`에 붙는다 — "되돌렸다"를 단정하는 문구를 `die`에 직접 쓰지 마라(회귀가 `die "[^"]*초안을 되돌렸다`를 금지한다)
- 런북 2.B 1단계의 순서(`gh release download` → `--jq '.assets[].digest'` → `sha256sum` → `tar -xzf`)와 단계 번호(`# 3) 구성 작성`, `# 5) 설치`) — 회귀가 잰다
- 런북 2.A의 "전달할 것은 셋이다"와 2.B의 "담당자가 별도 채널로 전달한 SHA-256" — 회귀가 잰다
- `.env.example`에 `GH_TOKEN`·`GITHUB_TOKEN`을 넣지 마라
- 런북 curl 경로의 `python3 -c 'import json,sys; …["assets"]…'` — 옛 `grep -E '"(id|name|digest)"'`로 되돌리지 마라
- 이전 세션 것 그대로: 아카이브 생성 위치(checksum·시크릿 검사 뒤)·`-C "$OUT_ROOT"`·`sed -i 's/\r$//'`·`.gitattributes`·`cmd_load`의 `require_env` 위치·런북 2.B 3단계의 GHE App 자격·`provision_app_role` 위치·`|| true` 넷·재색인 직렬화·`git status --porcelain`·`fixtureMonths`·`audit-grants.test.ts` 전수 검사·`compose.yml`의 `127.0.0.1`
# 2026-09-17 중요 파일 지도

| 경로 | 역할 / 다음 에이전트가 볼 지점 |
| --- | --- |
| `packages/authz/src/scope-source.ts` | `READABLE_PERMISSIONS`와 협업자 권한→검색 범위 판정. 대응 시험은 `scope-source.test.ts`. |
| `apps/web/components/reader/ReaderShell.tsx` | reader 상단 navigation과 operator 전용 Workspace/Legacy search 노출. |
| `apps/web/components/LeftNavPanel.tsx` | 좌측 reader navigation, Legacy/operator 링크 라벨. |
| `apps/web/components/RepositoryWorkspace.tsx` | 기본 통합 검색 UI: `facets=true`, filter state, `pr_number` 기본 정렬, PR/M number 표 렌더. |
| `apps/web/components/LegacyRepositoryWorkspace.tsx` | operator Legacy workspace; 삭제하지 말 것. |
| `apps/web/components/SearchView.tsx` | Legacy 통합 검색 view; 삭제하지 말 것. |
| `apps/web/components/reader/primitives.tsx` | `DatePicker`와 Radix Popover 달력. 접근성 시험은 `apps/web/a11y/reader-primitives.test.tsx`. |
| `apps/web/lib/repository-search.ts` | `buildRepositoryQuery`, `repositorySort`, `repositoryLabelOptions` 순수 검색 helper. |
| `packages/es/src/sort.ts` | search-api/Elasticsearch 정렬 키; `pr_number` integer mapping 포함. |
| `apps/search-api/integration/search/list.test.ts` | API가 9개 지원 정렬 키와 `pr_number`를 계약으로 확인. |
| `apps/web/app/reader-workspace.css`, `apps/web/app/ui.css` | DatePicker, PR link, M placeholder, semantic badge 시각 규칙. |
| `scripts/verify-source-workspace.mjs` | Chromium mock browser flow; facets, date, PR link, M number, canonical status query assertion. |
| `docs/00_governance/change_control.md` | CR-098/099의 승인 범위와 release 상태. |
| `docs/40_delivery/pr_search_implementation_traceability.md` | WP-086/087, DEV-704~714, pilot.11/12 증적의 canonical ledger. |

# 2026-09-17 (9차) 라운드가 만들거나 만진 것 (CR-100 PR #207 · CR-101 PR #208)

## 코드 (CR-100)

- `packages/db/migrations/031_mnumber_attestation.{up,down}.sql` — ENT-SEQ-008 표, `source_kind`에 `operator_attestation`.
- `packages/db/src/repositories/mnumber-attestation.ts` — create/revoke/findActive/list.
- `packages/db/src/repositories/mnumber-evidence.ts` — `operator_attestation`, proof 필드, upsert SQL 방어선(확정→미확정 거절, `EvidenceDowngradeError`), `lockEvidence`(FOR UPDATE).
- `packages/domain/src/audit.ts` — `mnumber_attestation.create`·`revoke`.
- `apps/pipeline-worker/src/mnumber-attestation.ts` — 순수 판정 `applyAttestation`(두 사유·범위·유예).
- `apps/pipeline-worker/src/mnumber.ts` — 확인서 적용, 트랜잭션 안 잠금 재검증(`retry evidence_moved`), `attested`·`retryAt`.
- `apps/pipeline-worker/src/sequence-work-runner.ts` — 유예 대기 `retry`(`attestation_grace_pending`).
- `apps/pipeline-worker/src/metrics.ts` — `mnumber_attested_total`.
- `apps/pipeline-worker/src/mnumber-attest-command.ts`·`mnumber-attest-cli.ts` — `attest|revoke|list`, 감사·work 요청 한 트랜잭션, 상관 ID 연결, `--through-seq` 경고.
- `deploy/single-host/prsctl` — `cmd_mnumber`(`worker-sequence` 이미지). `RUNBOOK.md` 7.D.

## 코드 (CR-101)

- `packages/domain/src/pull-request-state.ts` — `derivePullRequestState`(`entities.ts`의 `PullRequestState` 재사용).
- `apps/pipeline-worker/src/documents.ts` — `put(doc, 'state', derivePullRequestState(pr))`.
- `packages/db/migrations/032_pull_request_snapshot_merged_state.{up,down}.sql` — 기존 스냅숏 `state` 정정.
- `deploy/single-host/RUNBOOK.md` — 업그레이드 절(032 뒤 재색인), 문제 해결 행.

## 시험

- `apps/pipeline-worker/src/mnumber-attestation.test.ts`(단위 6), `apps/pipeline-worker/integration/sequence/mnumber-attestation.test.ts`(통합 13), `packages/db/integration/mnumber-attestation-schema.test.ts`(031 왕복, 확인서 행 있음), 파수꾼 4파일(031·032).
- `packages/domain/src/pull-request-state.test.ts`, `apps/pipeline-worker/src/documents.test.ts`(state 단언 2), `packages/db/integration/snapshot-merged-state.test.ts`(032 왕복), `regression/cr101-merged-state.test.ts`(투영 출력 ↔ 질의 번역 계약).

## 문서

- CR-100: SRS v2.35(AC-15·AC-10 예외·감사 표·상태 줄 복귀), PRD, 용어집, WP-074 설계(2.2·3·6.2·6.5·12 C7), ADR-023(accepted+Amendment), 데이터 모델 v0.26(ENT-SEQ-008), 비동기(JOB-SEQ-004), 보안, 인프라, 작업 패키지 WP-088(상태 줄 복귀), 원장 3장·DEV-715~717·6.94장, 변경 대장 CR-100(항목·표·cascade).
- CR-101: API 계약 v0.36(state 파생 규칙), 데이터 모델 v0.27, 작업 패키지 WP-089, 원장 DEV-718·6.95장, 변경 대장 CR-101.
- `agent-context/upstream-feedback.md` — M-번호 항목 회신, Merged 항목 신설·회신.

## 저장소 밖

- 격리 DB `prs_test_cr100`·`prs_test_cr100_reg`·`prs_test_cr101`(prs-cr091-postgres). 워크트리 `/home/roqkf/pr-search-wt/cr100`·`cr101`. 메모리 `integration-tests-isolated-db-per-worktree.md`.

## CR-111 코드 (12차)

- `apps/web/components/RepositoryWorkspace.tsx` — Search 화면 본체. 사이드바(`Find Repository`/`Base branch` 콤보박스 + `SourceTree`), 필터 폼(`Collapsible`로 감싼 `repo-filter-grid`+`repo-range-filter`), `rangeType`/`deriveInitialRangeType` 상태, ⌘K/타입어헤드 키보드 가드(`[role="combobox"],[role="listbox"]` 포함)가 전부 이 파일 안에 있다.
- `apps/web/components/source/SourceHistory.tsx` — Commit history 표. SHA/PR 복사가 `CopyText`(클릭 가능한 텍스트) 기반.
- `apps/web/components/ui/index.tsx` — `CopyButton`(불변, `ResultWorkbench.tsx` 전용)과 신설 `CopyText`(텍스트 자체가 버튼) 둘 다 여기.
- `apps/web/components/reader/primitives.tsx` — `FieldSelect`(Radix Select 래퍼, 옵션별 `disabled` 지원 추가).
- `apps/web/lib/repository-search.ts`/`.test.ts` — `RangeType`, `deriveInitialRangeType`(URL에서 어느 range가 활성인지로 초기 유형 결정) 순수 함수.
- `apps/web/app/repository-workspace.css` — 이 화면 전용 스타일. `.repo-results-scroll`의 `max-height` 상수(현재 460px)와 그 유도 공식이 이 파일 맨 위 주석에 있다 — 화면 구조를 또 바꾸면 반드시 재실측.
- `apps/web/app/reader-workspace.css` — 여러 reader 화면 공유 스타일. `.reader-ui .repo-filter-form`/`.repo-filter-grid`/`.repo-filter-footer`/`.reader-panel-heading`이 `repository-workspace.css`의 같은 이름 규칙보다 specificity가 높아 실제로 이긴다 — 이 화면만 다르게 하려면 `--compact` 같은 modifier 클래스로 specificity를 맞춰 scoped override한다(이미 있는 패턴).
- `apps/web/a11y/repository-workspace.test.tsx`, `apps/web/a11y/source-history.test.tsx` — 신설. 이 컴포넌트들을 직접 렌더링하는 유일한 자동화 시험(e2e는 `DEV-728`로 도달 못 함).
- `deploy/single-host/compose.yml` — `web:` `environment:`의 `REGRESSION_FIXTURE_ENABLED`(CR-109/CR-110 관련).

## CR-111 문서

- `docs/00_governance/change_control.md` CR-111(범위 12개 항목, 설계 결정, 독립 리뷰 결과, 진행 절), CR-110(compose.yml 후속 절).
- `docs/40_delivery/pr_search_work_packages.md` WP-096.
- `docs/40_delivery/pr_search_implementation_traceability.md` 6.102장(검증 기록+후속 조정 2회), DEV-728·DEV-729.
- `docs/20_derived_ui_specs/pr_search_{screen_qa_checklist,ui_component_spec,wireframe_spec}.md`.

## 저장소 밖 (CR-111)

- 워크트리 `/home/roqkf/pr-search-wt/cr111-search-simplify`(브랜치 `feature/cr111-search-simplify`, origin에 push됨, 병합 완료 — 정리 대기 목록에 추가).
- PR https://github.com/89sooner/pr-search/pull/216 (MERGED, squash `b6d9443`). CI run `35450458507`.
- Obsidian worklog `dailywork/2026-09-18_Search-화면-사이드바·필터-UI-간소화-(CR-111).md` — 이 세션의 가장 상세한 진행 기록.
- 메모리 `integration-test-shares-elasticsearch.md`(신설).
