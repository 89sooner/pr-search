# agent-context-index:v1
generated=2026-09-13T23:52:21+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=8
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,exports/202609140756.md,docs/40_delivery/pr_search_implementation_traceability.md,agent-context/_handoff/,Risks/gotchas,github.com/89sooner/pr-search/pull/185,exports/pr-search-2026-09-14.md,perf/signature-timing.perf.test.ts
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,exports/202609140756.md,477/477,docs/cr088-post-merge,origin/main,home/roqkf/pr-search,feature/rel007-capability-registry,fix/main-ci-s0-flaky
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,477/477,scratchpad/apply-agent-context.py,compact/f3df0a8.upstream-feedback.ctx.md,docs/cr088-post-merge,feature/rel007-capability-registry,fix/main-ci-s0-flaky,exports/pr-search-2026-09-14.md
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,origin/main,home/roqkf/pr-search,feature/rel007-capability-registry,fix/main-ci-s0-flaky,477/477,docs/cr088-post-merge,1/196
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,home/roqkf/pr-search,origin/main,github/workflows/ci.yml,var/lib/postgresql/data,docker.elastic.co/elasticsearch/elasticsearch,usr/share/elasticsearch/data
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,docs/40_delivery/pr_search_implementation_traceability.md,agent-context/_handoff/,packages/gh-cli/src/capabilities.ts,packages/gh-cli/src/classification/commands.ts,packages/gh-cli/src/validate.ts,packages/gh-cli/src/pin.ts,testing/pinned-gh.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,home/roqkf/pr-search/202609140825.md,home/roqkf/pr-search/exports/,regression/range-vs-git.test.ts,regression/releases-vs-git.test.ts,19/19,agent-context/_handoff/reader.py,compact/f3df0a8.upstream-feedback.ctx.md
- f3df0a8 p=50 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,certs/ghe-ca.crt,deploy/single-host/compose.yml,deploy/single-host/.env.example,deploy/single-host/RUNBOOK.md,docs/40_delivery/pr_search_implementation_traceability.md,auth/callback,OIDC/GHE

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=98848a2d45f7edef0a9bd273b646301a697374fdb221f63d4235128da63afe77
bytes=212678 compact_bytes=216330 lines=4038 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-14 (4차 마감) 구간에서 쓴 것 (PR #185와 handoff) > 지금 상태에서 시작하는 법 > 격리 서비스를 다시 띄우는 법 (정의가 /tmp에만 있었다) > 끝나면: docker compose -p prs-rel007 -f <scratchpad>/compose.rel007.yml down -v > 고정 gh 2.97.0
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;home/roqkf/pr-search;origin/main;github/workflows/ci.yml;var/lib/postgresql/data;docker.elastic.co/elasticsearch/elasticsearch;usr/share/elasticsearch/data;9200/_cluster/health;packages/gh-cli/testing/pinned-gh.ts;prs-pinned-gh/2.97.0/gh;packages/gh-cli/src/pin.ts;exports/202609140756.md;actions/runs/34788054624/jobs;commits/2176636;pulls/184;scratchpad/compose.rel007.yml;home/roqkf/pr-search-wt/s0;scratchpad/apply-agent-context.py;claude/skills/agent-context-handoff/scripts/context_handoff.py;agent-context/_handoff;claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;home/roqkf/pr-search-wt/post;docs/cr088-post-merge

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=343d6e43f1c98abfc5e304bd0949cf027e1b401d72f9f620ca2c6447f9e46b3c
bytes=242717 compact_bytes=214742 lines=1944 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-14 (4차 마감): /clear 뒤 이어받은 구간 (PR #185) > 결정자가 정한 것 (A) > 구현이 스스로 고른 것 (C) > 아직 정하지 않은 것 > 2026-09-14 (4차) — CR-087 main CI 정정 · CR-088 REL-007 R1a (WP-078)
sig=agent-context/decisions.md;477/477;scratchpad/apply-agent-context.py;compact/f3df0a8.upstream-feedback.ctx.md;docs/cr088-post-merge;feature/rel007-capability-registry;fix/main-ci-s0-flaky;exports/pr-search-2026-09-14.md;exports/pr-search-2026-09-02.md;github/workflows/ci.yml;994/1000;YAML/JSON;deploy/k8s/README.md;prs/gh-cli;prs/gh-cli/node;HOST/OWNER/REPO;apps/gh-executor;pub/sub;api/v1/gh/identity/callback;GHE_OPS_CLIENT_ID/SECRET/REDIRECT_URI;regression/runtime-reachability.test.ts;deploy/k8s/;apps/search-api/src/gh/;prs/github-annotate

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=437bdf315afac8b9179dc5bfbf6615416a6cc2fc640667011e22cebaab36a690
bytes=171477 compact_bytes=167713 lines=2011 priority=45
heads=중요 파일 경로와 역할 > 2026-09-14 (4차 마감) 구간이 만지거나 남긴 것 > 저장소: PR #185 → 824eb57 > 저장소: 이번 handoff (미커밋) > 다음 판이 먼저 열 파일 (REL-007) > 저장소 밖
sig=agent-context/files.md;docs/40_delivery/pr_search_implementation_traceability.md;agent-context/_handoff/;packages/gh-cli/src/capabilities.ts;packages/gh-cli/src/classification/commands.ts;packages/gh-cli/src/validate.ts;packages/gh-cli/src/pin.ts;testing/pinned-gh.ts;packages/gh-cli/src/drift.ts;apps/gh-executor/src/registry-check.ts;apps/search-api/src/gh/executions.ts;apps/search-api/src/gh/;apps/web/components/GhRegistryView.tsx;scripts/gh-capabilities.mjs;scripts/gh-manifest.mjs;docs/40_delivery/pr_search_work_packages.md;docs/00_governance/change_control.md;home/roqkf/pr-search/202609140825.md;home/roqkf/pr-search/exports/202609140756.md;home/roqkf/.claude/projects/-home-roqkf-pr-search/memory/previous-session-scratchpad-survives-clear.md;mnt/c/Users/slrtt/Documents/Obsidian;Vault/dailywork/2026-09-14_CR-087-main-CI-;tmp/claude-1000/-home-roqkf-pr-search/717f9056-;tmp/claude-1000/-home-roqkf-pr-search/2c49681f-

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=19b0682dba7d0dba6d2ec8ce6e12afe63e06a85cc3b65213fc5c70b9874df521
bytes=202419 compact_bytes=197999 lines=2713 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-14 (4차 마감) 구간이 배운 함정 > 경로 없는 /export는 저장소 루트에 떨어지고, 루트는 무시 대상이 아니다 > 격리 서비스 환경 변수 없이 돌린 회귀의 ECONNREFUSED는 결함이 아니다 > pack을 다시 만들면 내용이 같은 파일도 modified로 보인다 > 삭제한 워크트리를 IDE 진단이 계속 가리킨다
sig=agent-context/risks.md;home/roqkf/pr-search/202609140825.md;home/roqkf/pr-search/exports/;regression/range-vs-git.test.ts;regression/releases-vs-git.test.ts;19/19;agent-context/_handoff/reader.py;compact/f3df0a8.upstream-feedback.ctx.md;tmp/claude-1000/-home-roqkf-pr-search/f864b845-;scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;packages/gh-cli/testing/pinned-gh.ts;prs-pinned-gh/2.97.0/gh;scripts/gh-capabilities.mjs;exports/202609140756.md;home/roqkf/pr-search;near/far;994/1000;3/3;home/roqkf/pr-search-wt/cap;1/2;apps/gh-executor/integration/executor.test.ts;/../search-api/src/gh/;gh/routes;9/10

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=3a0dd26961d66ac5af2bfa24c519ac4e6b42a192d6bb19a805c52493cc11bd8a
bytes=183065 compact_bytes=181345 lines=2769 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-14 (4차 마감): /clear 뒤 이어받아 CR-088 후속 기록을 마감 (PR #185) > Goal (결정자의 말로) > Current state > Decisions (이 구간이 고른 것) > Changed files
sig=agent-context/session-notes.md;exports/202609140756.md;docs/40_delivery/pr_search_implementation_traceability.md;agent-context/_handoff/;Risks/gotchas;github.com/89sooner/pr-search/pull/185;exports/pr-search-2026-09-14.md;perf/signature-timing.perf.test.ts;classification/commands.ts;ops/gh-registry;home/roqkf/pr-search-wt/;docs/cr088-post-merge;home/roqkf/pr-search-wt/post;packages/gh-cli/src/;packages/db/migrations/029_;packages/db/src/repositories/gh-registry.ts;apps/gh-executor/src/;apps/search-api/src/gh/;apps/web/;app/ops/gh-registry;components/GhRegistryView.tsx;lib/gh-registry;lib/nav.ts;scripts/gh-capabilities.mjs

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=6f7d7aa26918793585d257bd9f7dc944d10048e720c6e40088e0580925515aaa
bytes=138233 compact_bytes=136121 lines=1995 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-14 (4차 마감): CR-088 병합 뒤 후속 기록 마감, PR #185 병합(824eb57)과 정리 > 이 구간의 목표 > 결과 > 지금 저장소 상태 (2026-09-14 실측) > 2026-09-14 (4차) — CR-087 main CI 정정(병합) + CR-088 REL-007 R1a: PR #184 병합 완료
sig=agent-context/session-summary.md;exports/202609140756.md;477/477;docs/cr088-post-merge;origin/main;home/roqkf/pr-search;feature/rel007-capability-registry;fix/main-ci-s0-flaky;PASS/FAIL;gh/registry;196/196;034/1;312/312;164/164;707/707;1/196;0/0;11/11;14/14;190/191;s/ms;PostgreSQL/ES;tmp/pr-search-rel007;feature/rel007-r0-pr-list

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=c0da619d47488a7cc5992685a4e27e1ea751676066bd1e90040d60ff5dcfcff0
bytes=200667 compact_bytes=173861 lines=2425 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 먼저 할 것 (결정자 확인이 필요하다) > 후속 (병합 뒤): 4차에서 마감함 > REL-007 다음 판 후보 (결정자가 순서를 정한다) > 열어 둔 편차 (건드리지 않는다) > 사내가 나중에 할 것 (NOT RUN)
sig=agent-context/todos.md;origin/main;home/roqkf/pr-search;feature/rel007-capability-registry;fix/main-ci-s0-flaky;477/477;docs/cr088-post-merge;1/196;0/0;3/3;docs/cr086-post-merge;tmp/pr-search-rel007;feature/rel007-r0-pr-list;tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;scripts/gh-manifest.mjs;packages/gh-cli;apps/gh-executor;packages/db;packages/bus;packages/contracts;apps/search-api;apps/web;deploy/single-host/compose.yml;docs/30_technical_architecture/pr_search_api_contracts.md

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=cdf434494595549fafedb4317370272ed3ef9184c8456adbe281a4ca522d7410
bytes=7159 compact_bytes=7761 lines=105 priority=50
heads=Upstream Feedback > DEV-561 — git 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패 > 반영해야 할 파일 > FR-NEW — 사내 GHE OAuth2 직접 인증 지원 > 필요한 변경 > GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
sig=agent-context/upstream-feedback.md;certs/ghe-ca.crt;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;docs/40_delivery/pr_search_implementation_traceability.md;auth/callback;OIDC/GHE;login/oauth/authorize;login/oauth/access_token;user/teams;cpswdev-team/pipe-admins;cpswdev-team/pipe-users;Upstream;Feedback;DEV;compose;GIT_SSL_CAINFO;example;resolved;NOT;RUN;JOB;MIR

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
