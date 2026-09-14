# agent-context-index:v1
generated=2026-09-14T14:39:45+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=8
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,origin/main,feature/rel007-result-contracts,docs/cr-089-merge-record,Risks/gotchas,exports/202609141932.md,exports/202609142215.md,home/roqkf/pr-search-wt/contracts
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,exports/202609142215.md,origin/main,exports/202609141338.md,claude/projects/-home-roqkf-pr-search/539c17f5-,196/196,32/32,80/80
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,origin/main,gh/policies,gh/policies/changes,lib/gh-policy.ts,41/40,5/5,before/after
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,origin/main,feature/rel007-capability-registry,fix/main-ci-s0-flaky,feature/rel007-r0-pr-list,docs/cr-090-merge-record,home/roqkf/pr-search-wt/approval,home/roqkf/pr-search-wt/cr090-record
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,tmp/prs-pinned-gh/2.97.0/gh,deploy/single-host/RUNBOOK.md,ACD5/scratchpad/mutation/run.mjs,tmp/claude-1000/-home-roqkf-pr-search/acd5a0d8-,SP/oldapp,packages/db/integration/rollback-phase-a.test.ts
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,packages/gh-cli/src/,packages/db/migrations/030_gh_operations_policy,packages/db/src/repositories/gh-policy.ts,integration/gh-policy.test.ts,apps/search-api/src/gh/policy.ts,integration/gh/policy-routes.test.ts,apps/gh-executor/integration/
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,gh/policies,origin/main,claude/projects/,regression/ledger-canonical-table.test.ts,packages/contracts/src/error-codes.test.ts,home/roqkf/pr-search/202609140825.md,home/roqkf/pr-search/exports/
- f3df0a8 p=50 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,certs/ghe-ca.crt,deploy/single-host/compose.yml,deploy/single-host/.env.example,deploy/single-host/RUNBOOK.md,docs/40_delivery/pr_search_implementation_traceability.md,auth/callback,OIDC/GHE

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=c0bd86a73b443ea1aaa688fcf9d29f322a217bfe5b721bc38ee43b084a0aca2a
bytes=220285 compact_bytes=224403 lines=4168 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-14 (6차) 라운드에서 쓴 것 (CR-090) > 환경 > 통합 시험 전에 CI처럼 빈 DB·빈 Redis > 필수 배터리 (CI 순서, 단계마다 종료 코드·코드 트리 해시) > verify: typecheck → lint → lint:deps → test → build → test:a11y → test:contrast → test:e2e
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;tmp/prs-pinned-gh/2.97.0/gh;deploy/single-host/RUNBOOK.md;ACD5/scratchpad/mutation/run.mjs;tmp/claude-1000/-home-roqkf-pr-search/acd5a0d8-;SP/oldapp;packages/db/integration/rollback-phase-a.test.ts;prs/db;packages/db/integration/rollback-phase-c.test.ts;deploy/single-host;/smoke-images.sh;prs/web;ops/gh-policy;ops/gh-registry;packages/db/integration/gh-policy.test.ts;packages/db/dist/cli.js;SP/edit.mjs;claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;packages/contracts/src/error-codes.test.ts;feature/rel007-registry-approval;SP/pr-body.md;repos/89sooner/pr-search/pulls/188;repos/89sooner/pr-search/actions/runs

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=b2f2d80f011871c56ce51f63ec7b9565859a6a13c2fc6c4c35e00377c6302a0f
bytes=253762 compact_bytes=224599 lines=2005 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-14 (6차) — CR-090 REL-007 R2 운영 승인·R0 실행 정책 (WP-080, PR #188) > A. 사용자 직접 결정 · B. 지시서 사전 승인 (다시 논의하지 않음) > C. 구현이 스스로 고른 것 (근거와 되돌리는 법) > 2026-09-14 (5차) — CR-089 REL-007 R1b 결과 계약·타입 연결 검증 (WP-079, PR #186) > A. 사용자 직접 결정 · B. 지시서 사전 승인 (다시 논의하지 않음)
sig=agent-context/decisions.md;origin/main;gh/policies;gh/policies/changes;lib/gh-policy.ts;41/40;5/5;before/after;477/477;scratchpad/apply-agent-context.py;compact/f3df0a8.upstream-feedback.ctx.md;docs/cr088-post-merge;feature/rel007-capability-registry;fix/main-ci-s0-flaky;exports/pr-search-2026-09-14.md;exports/pr-search-2026-09-02.md;github/workflows/ci.yml;994/1000;YAML/JSON;deploy/k8s/README.md;prs/gh-cli;prs/gh-cli/node;HOST/OWNER/REPO;apps/gh-executor

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=682c80d94d087e8bc53c8f99d585e745fce287f826c8cb16f0130413535fad7f
bytes=177947 compact_bytes=173470 lines=2064 priority=45
heads=중요 파일 경로와 역할 > 2026-09-14 (6차) 라운드가 만들거나 만진 것 (CR-090, PR #188 — 81 파일) > 코드 (새 파일) > 코드 (고친 것) > 문서 (24개 + 런북) > 저장소 밖 (scratchpad, 무시 대상 — /tmp라 재부팅에 사라진다)
sig=agent-context/files.md;packages/gh-cli/src/;packages/db/migrations/030_gh_operations_policy;packages/db/src/repositories/gh-policy.ts;integration/gh-policy.test.ts;apps/search-api/src/gh/policy.ts;integration/gh/policy-routes.test.ts;apps/gh-executor/integration/;app/ops/gh-policy/page.tsx;lib/gh-policy.test.ts;a11y/gh-policy.test.tsx;e2e/gh-policy.spec.ts;src/gh/;packages/db/src/;packages/contracts/src/error-codes.ts;packages/domain/src/audit.ts;app/ops/gh-registry/page.tsx;integration/gh/;gh/executions;regression/runtime-reachability.test.ts;deploy/single-host/RUNBOOK.md;exp/db-experiments;logs/battery/;restore/restore-smoke.sh

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=3296dae0aadcfb017ad99e71ee70cdeaa063725487b41c7d187cfc142103102c
bytes=207614 compact_bytes=203136 lines=2740 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-14 (6차) 라운드가 배운 함정 (CR-090) > 2026-09-14 (5차) 라운드가 배운 함정 (CR-089) > 2026-09-14 (4차 마감) 구간이 배운 함정 > 경로 없는 /export는 저장소 루트에 떨어지고, 루트는 무시 대상이 아니다 > 격리 서비스 환경 변수 없이 돌린 회귀의 ECONNREFUSED는 결함이 아니다
sig=agent-context/risks.md;gh/policies;origin/main;claude/projects/;regression/ledger-canonical-table.test.ts;packages/contracts/src/error-codes.test.ts;home/roqkf/pr-search/202609140825.md;home/roqkf/pr-search/exports/;regression/range-vs-git.test.ts;regression/releases-vs-git.test.ts;19/19;agent-context/_handoff/reader.py;compact/f3df0a8.upstream-feedback.ctx.md;tmp/claude-1000/-home-roqkf-pr-search/f864b845-;scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;packages/gh-cli/testing/pinned-gh.ts;prs-pinned-gh/2.97.0/gh;scripts/gh-capabilities.mjs;exports/202609140756.md;home/roqkf/pr-search;near/far;994/1000;3/3;home/roqkf/pr-search-wt/cap

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=180722f42f6a2ab2e6632580c70b68c85a918b4df902e04b4c78c0bfd6fd99e3
bytes=186811 compact_bytes=185118 lines=2842 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-14 (6차) — CR-090 REL-007 R2 운영 승인·R0 실행 정책 (PR #188) > Goal > Current state > Decisions > Changed files
sig=agent-context/session-notes.md;origin/main;feature/rel007-result-contracts;docs/cr-089-merge-record;Risks/gotchas;exports/202609141932.md;exports/202609142215.md;home/roqkf/pr-search-wt/contracts;exports/202609141338.md;exports/202609140756.md;docs/40_delivery/pr_search_implementation_traceability.md;agent-context/_handoff/;github.com/89sooner/pr-search/pull/185;exports/pr-search-2026-09-14.md;perf/signature-timing.perf.test.ts;classification/commands.ts;ops/gh-registry;home/roqkf/pr-search-wt/;docs/cr088-post-merge;home/roqkf/pr-search-wt/post;packages/gh-cli/src/;packages/db/migrations/029_;packages/db/src/repositories/gh-registry.ts;apps/gh-executor/src/

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=3ac36d7f032bd683bfab7a76456f9cff674ce15a0f9f04eeee116eea28b5e300
bytes=146874 compact_bytes=144385 lines=2085 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-14 (6차) — CR-090 REL-007 R2 운영 승인·R0 실행 정책: PR #188 병합(9c8a781) > 이 구간의 목표 > 이어받은 방식 > 결과 > 이 구간이 찾아 고친 것
sig=agent-context/session-summary.md;exports/202609142215.md;origin/main;exports/202609141338.md;claude/projects/-home-roqkf-pr-search/539c17f5-;196/196;32/32;80/80;exports/202609140756.md;477/477;docs/cr088-post-merge;home/roqkf/pr-search;feature/rel007-capability-registry;fix/main-ci-s0-flaky;PASS/FAIL;gh/registry;034/1;312/312;164/164;707/707;1/196;0/0;11/11;14/14

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=6fcd16d7809ecc3c04880279400d48f7a05cd6d6d80818adcf70ce3bbfdffb06
bytes=206573 compact_bytes=179733 lines=2493 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 먼저 할 것 (결정자 확인이 필요하다) > 2026-09-14 (6차) — CR-090 뒤에 남은 것 > 후속 (병합 뒤) > 사내 반입 전 (사용자) > REL-007 완료를 막는 것 (결정자가 순서를 정함)
sig=agent-context/todos.md;origin/main;feature/rel007-capability-registry;fix/main-ci-s0-flaky;feature/rel007-r0-pr-list;docs/cr-090-merge-record;home/roqkf/pr-search-wt/approval;home/roqkf/pr-search-wt/cr090-record;feature/rel007-registry-approval;home/roqkf/pr-search-wt/contracts;feature/rel007-result-contracts;docs/cr-089-merge-record;/prsctl;477/477;docs/cr088-post-merge;1/196;0/0;3/3;docs/cr086-post-merge;tmp/pr-search-rel007;home/roqkf/pr-search;tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;scripts/gh-manifest.mjs;packages/gh-cli

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=cdf434494595549fafedb4317370272ed3ef9184c8456adbe281a4ca522d7410
bytes=7159 compact_bytes=7761 lines=105 priority=50
heads=Upstream Feedback > DEV-561 — git 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패 > 반영해야 할 파일 > FR-NEW — 사내 GHE OAuth2 직접 인증 지원 > 필요한 변경 > GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
sig=agent-context/upstream-feedback.md;certs/ghe-ca.crt;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;docs/40_delivery/pr_search_implementation_traceability.md;auth/callback;OIDC/GHE;login/oauth/authorize;login/oauth/access_token;user/teams;cpswdev-team/pipe-admins;cpswdev-team/pipe-users;Upstream;Feedback;DEV;compose;GIT_SSL_CAINFO;example;resolved;NOT;RUN;JOB;MIR

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
