# agent-context-index:v1
generated=2026-09-14T06:29:41+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=8
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,origin/main,home/roqkf/pr-search-wt/contracts,feature/rel007-result-contracts,docs/cr-089-merge-record,Risks/gotchas,exports/202609141338.md,exports/202609140756.md
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,exports/202609141338.md,claude/projects/-home-roqkf-pr-search/539c17f5-,196/196,32/32,80/80,origin/main,exports/202609140756.md
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,41/40,5/5,before/after,477/477,scratchpad/apply-agent-context.py,compact/f3df0a8.upstream-feedback.ctx.md,docs/cr088-post-merge
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,origin/main,feature/rel007-capability-registry,fix/main-ci-s0-flaky,feature/rel007-r0-pr-list,docs/cr-089-merge-record,home/roqkf/pr-search-wt/contracts,feature/rel007-result-contracts
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,tmp/prs-pinned-gh/2.97.0/gh,prs/gh-cli,packages/gh-cli/src,apps/web/lib,e2e/gh.spec.ts,SP/bak-gh.spec.ts
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,packages/gh-cli/src/,packages/gh-cli/src/classification/,packages/gh-cli/integration/result-contract.test.ts,apps/web/lib/gh-registry-fixtures.test.ts,manifest/gh-2.97.0.json,testing/mock-ghe-tls.ts,apps/gh-executor/src/runner.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,claude/projects/,regression/ledger-canonical-table.test.ts,packages/contracts/src/error-codes.test.ts,origin/main,home/roqkf/pr-search/202609140825.md,home/roqkf/pr-search/exports/,regression/range-vs-git.test.ts
- f3df0a8 p=50 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,certs/ghe-ca.crt,deploy/single-host/compose.yml,deploy/single-host/.env.example,deploy/single-host/RUNBOOK.md,docs/40_delivery/pr_search_implementation_traceability.md,auth/callback,OIDC/GHE

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=fe291eea84fb9886218928516af8daa5c8071d9a8c61484f1b0640db1f31c93f
bytes=214741 compact_bytes=218423 lines=4084 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-14 (5차) 라운드에서 쓴 것 (CR-089) > 환경 > 규칙·계약을 바꾼 뒤 > 이전 세션 jsonl에서 사용자 메시지 원문 복원 > e2e 부하 상관 실험 (명세 바꿔 끼우기 — 백업·trap·sha256 대조)
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;tmp/prs-pinned-gh/2.97.0/gh;prs/gh-cli;packages/gh-cli/src;apps/web/lib;e2e/gh.spec.ts;SP/bak-gh.spec.ts;e2e/gh;SP/bak-specs.sha;origin/main;apps/web/e2e/gh.spec.ts;/node_modules/.bin/playwright;feature/rel007-result-contracts;SP/draft-pr-body.md;repos/89sooner/pr-search/actions/runs;repos/89sooner/pr-search/actions/runs/;ID/jobs;apps/web;home/roqkf/pr-search;github/workflows/ci.yml;var/lib/postgresql/data;docker.elastic.co/elasticsearch/elasticsearch;usr/share/elasticsearch/data

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=d50f739dc06c5c130e437f65b9021ae3294a9b61b6cbd8ed8e9e425a8008678b
bytes=247154 compact_bytes=218975 lines=1973 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-14 (5차) — CR-089 REL-007 R1b 결과 계약·타입 연결 검증 (WP-079, PR #186) > A. 사용자 직접 결정 · B. 지시서 사전 승인 (다시 논의하지 않음) > C. 구현이 스스로 고른 것 (근거와 되돌리는 법) > 2026-09-14 (4차 마감): /clear 뒤 이어받은 구간 (PR #185) > 결정자가 정한 것 (A)
sig=agent-context/decisions.md;41/40;5/5;before/after;477/477;scratchpad/apply-agent-context.py;compact/f3df0a8.upstream-feedback.ctx.md;docs/cr088-post-merge;feature/rel007-capability-registry;fix/main-ci-s0-flaky;exports/pr-search-2026-09-14.md;exports/pr-search-2026-09-02.md;github/workflows/ci.yml;994/1000;YAML/JSON;deploy/k8s/README.md;prs/gh-cli;prs/gh-cli/node;HOST/OWNER/REPO;apps/gh-executor;pub/sub;api/v1/gh/identity/callback;GHE_OPS_CLIENT_ID/SECRET/REDIRECT_URI;regression/runtime-reachability.test.ts

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=2d2c85292a3b024a0d8145d3eaf3c3e130d0f5bb3443cba0369f08f615c195ca
bytes=174027 compact_bytes=169940 lines=2037 priority=45
heads=중요 파일 경로와 역할 > 2026-09-14 (5차) 라운드가 만들거나 만진 것 (CR-089, PR #186 — 70 파일) > 코드 (새 파일) > 코드 (고친 것) > 문서 (18개) > 저장소 밖 (세션 scratchpad /tmp/claude-1000/-home-roqkf-pr-search/3bd93f51-…/scratchpad, 무시 대상)
sig=agent-context/files.md;packages/gh-cli/src/;packages/gh-cli/src/classification/;packages/gh-cli/integration/result-contract.test.ts;apps/web/lib/gh-registry-fixtures.test.ts;manifest/gh-2.97.0.json;testing/mock-ghe-tls.ts;apps/gh-executor/src/runner.ts;apps/search-api/src/gh/;apps/web/components/;apps/web/lib/;lib/gh;a11y/gh;e2e/gh;e2e/flow-003.spec.ts;regression/runtime-reachability.test.ts;github/workflows/ci.yml;scripts/gh-capabilities.mjs;tmp/claude-1000/-home-roqkf-pr-search/3bd93f51-;gh-research/cli;tmp/prs-pinned-gh/2.97.0/gh;docs/40_delivery/pr_search_implementation_traceability.md;agent-context/_handoff/;packages/gh-cli/src/capabilities.ts

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=193256f17492cc466c0e36b059eb412523ac2b9a6137d51e0a83b1e5bad10e6c
bytes=204890 compact_bytes=200454 lines=2726 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-14 (5차) 라운드가 배운 함정 (CR-089) > 2026-09-14 (4차 마감) 구간이 배운 함정 > 경로 없는 /export는 저장소 루트에 떨어지고, 루트는 무시 대상이 아니다 > 격리 서비스 환경 변수 없이 돌린 회귀의 ECONNREFUSED는 결함이 아니다 > pack을 다시 만들면 내용이 같은 파일도 modified로 보인다
sig=agent-context/risks.md;claude/projects/;regression/ledger-canonical-table.test.ts;packages/contracts/src/error-codes.test.ts;origin/main;home/roqkf/pr-search/202609140825.md;home/roqkf/pr-search/exports/;regression/range-vs-git.test.ts;regression/releases-vs-git.test.ts;19/19;agent-context/_handoff/reader.py;compact/f3df0a8.upstream-feedback.ctx.md;tmp/claude-1000/-home-roqkf-pr-search/f864b845-;scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;packages/gh-cli/testing/pinned-gh.ts;prs-pinned-gh/2.97.0/gh;scripts/gh-capabilities.mjs;exports/202609140756.md;home/roqkf/pr-search;near/far;994/1000;3/3;home/roqkf/pr-search-wt/cap;1/2

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=e8484b9717e02a0a1874f6ac8718b7313bd513094ca2fb633c165e3d42daec9a
bytes=184594 compact_bytes=182903 lines=2805 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-14 (5차) — CR-089 REL-007 R1b 결과 계약·타입 연결 검증 (PR #186) > Goal > Current state > Decisions > Changed files
sig=agent-context/session-notes.md;origin/main;home/roqkf/pr-search-wt/contracts;feature/rel007-result-contracts;docs/cr-089-merge-record;Risks/gotchas;exports/202609141338.md;exports/202609140756.md;docs/40_delivery/pr_search_implementation_traceability.md;agent-context/_handoff/;github.com/89sooner/pr-search/pull/185;exports/pr-search-2026-09-14.md;perf/signature-timing.perf.test.ts;classification/commands.ts;ops/gh-registry;home/roqkf/pr-search-wt/;docs/cr088-post-merge;home/roqkf/pr-search-wt/post;packages/gh-cli/src/;packages/db/migrations/029_;packages/db/src/repositories/gh-registry.ts;apps/gh-executor/src/;apps/search-api/src/gh/;apps/web/

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=989ea5bf3d78428b6678691f80552e163c375510b1223e7b77c99db61fdbee51
bytes=142172 compact_bytes=140014 lines=2040 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-14 (5차) — CR-089 REL-007 R1b 결과 계약·타입 연결 검증: PR #186 병합(99d53d3) > 이 구간의 목표 > 이어받은 방식 > 결과 > 이 구간이 이전 세션 코드에서 찾아 고친 것
sig=agent-context/session-summary.md;exports/202609141338.md;claude/projects/-home-roqkf-pr-search/539c17f5-;196/196;32/32;80/80;origin/main;exports/202609140756.md;477/477;docs/cr088-post-merge;home/roqkf/pr-search;feature/rel007-capability-registry;fix/main-ci-s0-flaky;PASS/FAIL;gh/registry;034/1;312/312;164/164;707/707;1/196;0/0;11/11;14/14;190/191

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=0d8ce8e40faabd0654c72cead4b6f1ac086f1557d62a4b5425f1afbac0903d9e
bytes=202243 compact_bytes=175399 lines=2450 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 먼저 할 것 (결정자 확인이 필요하다) > 2026-09-14 (5차) — CR-089 뒤에 남은 것 > 후속 (병합 뒤) > REL-007 완료를 막는 것 (결정자가 순서를 정함) > WP-066의 남은 부분
sig=agent-context/todos.md;origin/main;feature/rel007-capability-registry;fix/main-ci-s0-flaky;feature/rel007-r0-pr-list;docs/cr-089-merge-record;home/roqkf/pr-search-wt/contracts;feature/rel007-result-contracts;477/477;docs/cr088-post-merge;1/196;0/0;3/3;docs/cr086-post-merge;tmp/pr-search-rel007;home/roqkf/pr-search;tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;scripts/gh-manifest.mjs;packages/gh-cli;apps/gh-executor;packages/db;packages/bus;packages/contracts;apps/search-api

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=cdf434494595549fafedb4317370272ed3ef9184c8456adbe281a4ca522d7410
bytes=7159 compact_bytes=7761 lines=105 priority=50
heads=Upstream Feedback > DEV-561 — git 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패 > 반영해야 할 파일 > FR-NEW — 사내 GHE OAuth2 직접 인증 지원 > 필요한 변경 > GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
sig=agent-context/upstream-feedback.md;certs/ghe-ca.crt;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;docs/40_delivery/pr_search_implementation_traceability.md;auth/callback;OIDC/GHE;login/oauth/authorize;login/oauth/access_token;user/teams;cpswdev-team/pipe-admins;cpswdev-team/pipe-users;Upstream;Feedback;DEV;compose;GIT_SSL_CAINFO;example;resolved;NOT;RUN;JOB;MIR

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
