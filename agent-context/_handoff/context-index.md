# agent-context-index:v1
generated=2026-09-13T23:07:59+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=8
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,perf/signature-timing.perf.test.ts,classification/commands.ts,ops/gh-registry,home/roqkf/pr-search-wt/,docs/cr088-post-merge,home/roqkf/pr-search-wt/post,packages/gh-cli/src/
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,PASS/FAIL,gh/registry,196/196,034/1,312/312,164/164,707/707
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,994/1000,YAML/JSON,deploy/k8s/README.md,prs/gh-cli,prs/gh-cli/node,HOST/OWNER/REPO,apps/gh-executor
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,docs/cr088-post-merge,home/roqkf/pr-search-wt/post,477/477,1/196,0/0,3/3,docs/cr086-post-merge
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh,actions/runs,actions/jobs/,994/1000,apps/ingest-gateway/src/signature.test.ts,14/14
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,apps/ingest-gateway/src/signature.test.ts,perf/signature-timing.perf.test.ts,apps/pipeline-worker/src/sequence-freshness.ts,apps/pipeline-worker/src/sequence.ts,packages/db/src/repositories/sequence-work.ts,apps/pipeline-worker/integration/sequence/freshness.test.ts,packages/db/integration/merge-number-schema.test.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,near/far,994/1000,3/3,home/roqkf/pr-search,home/roqkf/pr-search-wt/cap,1/2,apps/gh-executor/integration/executor.test.ts
- f3df0a8 p=50 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,certs/ghe-ca.crt,deploy/single-host/compose.yml,deploy/single-host/.env.example,deploy/single-host/RUNBOOK.md,docs/40_delivery/pr_search_implementation_traceability.md,auth/callback,OIDC/GHE

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=6a0fada046fefae8932ddad7e9e4ac30d7156e2d2a9d0974addb4be61787685f
bytes=201964 compact_bytes=205685 lines=3893 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-14 (4차) 라운드에서 쓴 것 (CR-087 · CR-088) > 전제 — 3차와 같다 (격리 서비스 + 고정 gh). prs_test DB는 없으면 만든다 > 이 판에서 실제로 돌린 것 > 실패했던 명령과 원인 > 정리 (병합·push 뒤에만)
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;actions/runs;actions/jobs/;994/1000;apps/ingest-gateway/src/signature.test.ts;14/14;9/10;3/3;10/10;perf/signature-timing;1/1;packages/gh-cli/src;packages/gh-cli/integration/drift.test.ts;packages/db/integration/;apps/gh-executor/integration/;apps/search-api/integration/gh/;401/403/200;regression/runtime-reachability.test.ts;prs/web;a11y/gh-registry.test.tsx;e2e/gh-registry.spec.ts;190/191

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=117cc5a6626bc7b9e1589277e5702b275366b1e5481d1183a402a59aa90e1ce9
bytes=237737 compact_bytes=209901 lines=1911 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-14 (4차) — CR-087 main CI 정정 · CR-088 REL-007 R1a (WP-078) > 결정자가 확정해 준 것 (A — 다시 열지 않는다) > 구현이 스스로 고른 것 (C — 최종 보고의 「Agent-Initiated Decisions」) > 아직 정하지 않은 것 (다음 판) > 2026-09-13 (3차) — REL-007 R0 완주 (CR-086 closed / WP-077 done)
sig=agent-context/decisions.md;994/1000;YAML/JSON;deploy/k8s/README.md;prs/gh-cli;prs/gh-cli/node;HOST/OWNER/REPO;apps/gh-executor;pub/sub;api/v1/gh/identity/callback;GHE_OPS_CLIENT_ID/SECRET/REDIRECT_URI;regression/runtime-reachability.test.ts;deploy/k8s/;apps/search-api/src/gh/;prs/github-annotate;prs/github;prs/db;healthz/route.test.ts;commit/PR/;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=f78d81b409fce3f977cdd15d73c7ba9761d26642cd1ea2a51fef676f4290255d
bytes=167342 compact_bytes=163585 lines=1968 priority=45
heads=중요 파일 경로와 역할 > 2026-09-14 (4차) 라운드가 만들거나 만진 것 (CR-087 PR #183 · CR-088 PR #184) > CR-087 (S0) — 고친 것 > CR-088 — 새로 만든 것 > CR-088 — 고친 것 > 저장소 밖 (휘발)
sig=agent-context/files.md;apps/ingest-gateway/src/signature.test.ts;perf/signature-timing.perf.test.ts;apps/pipeline-worker/src/sequence-freshness.ts;apps/pipeline-worker/src/sequence.ts;packages/db/src/repositories/sequence-work.ts;apps/pipeline-worker/integration/sequence/freshness.test.ts;packages/db/integration/merge-number-schema.test.ts;DEV-669/670;packages/gh-cli/src/classification/commands.ts;packages/gh-cli/src/classification/rules.ts;packages/gh-cli/src/classification/classify.ts;packages/gh-cli/src/validate.ts;packages/gh-cli/src/drift.ts;integration/drift.test.ts;packages/db/migrations/029_gh_capability_registry;src/repositories/gh-registry.ts;integration/gh-registry-schema.test.ts;apps/gh-executor/src/registry-check.ts;integration/registry-check.test.ts;apps/search-api/src/gh/registry.ts;integration/gh/registry.test.ts;apps/web/app/ops/gh-registry/page.tsx;components/GhRegistryView.tsx

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=df85ddd7c44942ac19790cd65d1c10f5641602de5673e6ad33ce63a0c71f04c1
bytes=197931 compact_bytes=193730 lines=2679 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-14 (4차) 라운드가 배운 함정 (CR-087 · CR-088) > 시간을 재는 시험은 필수 CI에 두지 않는다 — 로컬 220회로 재현되지 않는 실패가 러너에서 난다 > 두 시계를 한 비교식에 넣지 않는다 — DB µs와 앱 ms > 판정과 기록을 한 함수에서 잇지 않는다 — 기록 실패가 판정을 버린다 > 동기 spawn 반복은 같은 프로세스의 다른 일을 멈춘다
sig=agent-context/risks.md;near/far;994/1000;3/3;home/roqkf/pr-search;home/roqkf/pr-search-wt/cap;1/2;apps/gh-executor/integration/executor.test.ts;/../search-api/src/gh/;gh/routes;9/10;prs-pinned-gh/2.97.0/gh;prs/gh-cli;fix/wp075-annotate-safety;packages/es/src/config.ts;packages/bus/src/redis-streams.ts;acme/smp1900;repos/.../actions/runs;packages/authz/src/config.test.ts;apps/web/instrumentation.test.ts;deploy/single-host/smoke-images.sh;deploy/single-host/;origin/main;docs/20_derived_ui_specs/pr_search_product_ia.md

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=1af5366cade24e5d66c8570d0f06956e41920d3b8d821b89a04ab38e5149d237
bytes=178528 compact_bytes=176963 lines=2727 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-14 (4차) — CR-087 main CI 정정 + CR-088 REL-007 R1a (PR #183·#184) > Goal — 결정자의 말로 > Current state > Decisions — 이 세션이 고른 것 > Changed files
sig=agent-context/session-notes.md;perf/signature-timing.perf.test.ts;classification/commands.ts;ops/gh-registry;home/roqkf/pr-search-wt/;docs/cr088-post-merge;home/roqkf/pr-search-wt/post;packages/gh-cli/src/;packages/db/migrations/029_;packages/db/src/repositories/gh-registry.ts;apps/gh-executor/src/;apps/search-api/src/gh/;apps/web/;app/ops/gh-registry;components/GhRegistryView.tsx;lib/gh-registry;lib/nav.ts;scripts/gh-capabilities.mjs;Risks/gotchas;github.com/89sooner/pr-search/pull/183;github.com/89sooner/pr-search/pull/184;origin/main;feature/rel007-r0-pr-list;docs/cr086-post-merge

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=9b34e03c417fa234cf859be08340abf797d39e7c95d54a75b81f12c357017988
bytes=135143 compact_bytes=133080 lines=1967 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-14 (4차) — CR-087 main CI 정정(병합) + CR-088 REL-007 R1a: PR #184 병합 완료 > 결과 한 줄 > 지시서 17장 앞머리 다섯 답 > 기술 근거 > 능동 자가 연구 결과 (이 판)
sig=agent-context/session-summary.md;PASS/FAIL;gh/registry;196/196;034/1;312/312;164/164;707/707;1/196;0/0;11/11;14/14;190/191;feature/rel007-capability-registry;477/477;s/ms;origin/main;PostgreSQL/ES;tmp/pr-search-rel007;feature/rel007-r0-pr-list;89sooner/pr-search;1000002394/1000002395;github/workflows/ci.yml;repos/cli/cli/releases/tags/v2.97.0

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=7b2b6db8dc03e4fc034a53ec009b488aa92c6a74827911d2f50dc33e742334f8
bytes=199236 compact_bytes=172467 lines=2416 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 후속 (병합 뒤) — 이 판에서 마감 > REL-007 다음 판 후보 (결정자가 순서를 정한다) > 열어 둔 편차 (건드리지 않는다) > 사내가 나중에 할 것 (NOT RUN) > 후속 (병합 뒤)
sig=agent-context/todos.md;docs/cr088-post-merge;home/roqkf/pr-search-wt/post;477/477;1/196;0/0;3/3;docs/cr086-post-merge;tmp/pr-search-rel007;feature/rel007-r0-pr-list;origin/main;home/roqkf/pr-search;tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;scripts/gh-manifest.mjs;packages/gh-cli;apps/gh-executor;packages/db;packages/bus;packages/contracts;apps/search-api;apps/web;deploy/single-host/compose.yml;docs/30_technical_architecture/pr_search_api_contracts.md;home/roqkf/pr-search/agent-context/

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=cdf434494595549fafedb4317370272ed3ef9184c8456adbe281a4ca522d7410
bytes=7159 compact_bytes=7761 lines=105 priority=50
heads=Upstream Feedback > DEV-561 — git 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패 > 반영해야 할 파일 > FR-NEW — 사내 GHE OAuth2 직접 인증 지원 > 필요한 변경 > GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
sig=agent-context/upstream-feedback.md;certs/ghe-ca.crt;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;docs/40_delivery/pr_search_implementation_traceability.md;auth/callback;OIDC/GHE;login/oauth/authorize;login/oauth/access_token;user/teams;cpswdev-team/pipe-admins;cpswdev-team/pipe-users;Upstream;Feedback;DEV;compose;GIT_SSL_CAINFO;example;resolved;NOT;RUN;JOB;MIR

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
