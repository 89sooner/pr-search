# agent-context-index:v1
generated=2026-09-11T09:19:37+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=8
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,packages/domain/src/mnumber.ts,apps/pipeline-worker/src/mnumber-plan.ts,apps/search-api/src/sequence/merge-number-view.ts,apps/web/lib/merge-number.ts,Risks/gotchas,github.com/89sooner/pr-search/pull/168,github.com/89sooner/pr-search/pull/169
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,feature/wp074-squash-mnumber,tmp/pr-search-wp074-implementation,packages/authz/src/config.ts,prs/web,apps/web/instrumentation.ts,deploy/single-host/smoke-images.sh,refs/tags/
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,healthz/route.test.ts,commit/PR/,apps/web,refs/tags/,git/refs,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,home/roqkf/pr-search,origin/main,tmp/pr-search-bundle-out,deploy/single-host/,tmp/pr-search-bundle-main,/deploy/single-host/build-bundle.sh,tmp/pr-search-bundle-release
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,prs/web,a11y/mnumber.test.tsx,scratchpad/mutate.py,prs/pipeline-worker,5432/prs_test,apps/pipeline-worker/dist/measure-cli.js
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,packages/domain/src/mnumber.ts,apps/pipeline-worker/src/mnumber-plan.ts,apps/search-api/src/sequence/merge-number-view.ts,apps/web/lib/merge-number.ts,apps/pipeline-worker/src/mnumber.ts,apps/pipeline-worker/src/mnumber-evidence.ts,apps/pipeline-worker/src/mnumber-hint.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,deploy/single-host/,origin/main,docs/20_derived_ui_specs/pr_search_product_ia.md,apps/web,refs/tags/,usr/bin/env,HOME/.nvm/versions/node/v22.23.2/bin
- f3df0a8 p=50 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,certs/ghe-ca.crt,deploy/single-host/compose.yml,deploy/single-host/.env.example,deploy/single-host/RUNBOOK.md,docs/40_delivery/pr_search_implementation_traceability.md,OIDC/GHE,login/oauth/authorize

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=5880b29275b4ca211ec38887a0125cdb63334a7a5b86638f95984984b45f0bca
bytes=168358 compact_bytes=172303 lines=3376 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-11 (3차) 라운드에서 쓴 것 (WP-074 · CR-080·081) > 전제 — Node 22 > 검증 배터리 (전부 실행했고 이 수치가 원장 6.76장의 정본이다) > 범위를 좁혀 돌리기 (리뷰 회차마다 썼다) > 변이 시험
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;prs/web;a11y/mnumber.test.tsx;scratchpad/mutate.py;prs/pipeline-worker;5432/prs_test;apps/pipeline-worker/dist/measure-cli.js;tmp/pr-search-bundle-main;origin/main;/deploy/single-host/build-bundle.sh;tmp/pr-search-bundle-out;checksums/SHA256SUMS;deploy/single-host;/prsctl;home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;SP/bin/pnpm;usr/bin/env;home/roqkf/.nvm/versions/node/v22.23.2/bin/corepack;SP/bin;home/roqkf/.nvm/versions/node/v22.23.2/bin;manifest/release-manifest.json;app/node_modules;pg/package.json

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=ce7d56c29be570a6ce750c3567112365c2312a850e90d445b35183e112d0e2d6
bytes=197100 compact_bytes=173662 lines=1641 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-11 (3차) — WP-074 M 번호 (CR-080 · CR-081) > 결정자가 확정해 준 것 (다시 열지 않는다) > 구현이 스스로 고른 것 (ADR-023의 C1~C6을 잇는다) > 리뷰를 거치며 바꾼 판단 > 시험에 관한 결정
sig=agent-context/decisions.md;healthz/route.test.ts;commit/PR/;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md;origin/main;packages/query/src/keys.ts;deploy/k8s/pipeline-worker-batch.yaml

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=f4566adcf589cef997eba9e180345a87182a81a277bb76664f9d2cb26a2d81c7
bytes=134298 compact_bytes=132205 lines=1625 priority=45
heads=중요 파일 경로와 역할 > 2026-09-11 (3차) 라운드가 만진 것 (WP-074 — 115개 파일, 13,168줄) > 판정의 중심 (먼저 읽을 것) > 채번과 전달 > 정본과 색인 > API와 화면
sig=agent-context/files.md;packages/domain/src/mnumber.ts;apps/pipeline-worker/src/mnumber-plan.ts;apps/search-api/src/sequence/merge-number-view.ts;apps/web/lib/merge-number.ts;apps/pipeline-worker/src/mnumber.ts;apps/pipeline-worker/src/mnumber-evidence.ts;apps/pipeline-worker/src/mnumber-hint.ts;apps/pipeline-worker/src/sequence-freshness.ts;apps/pipeline-worker/src/sequence-work-runner.ts;apps/ingest-gateway/src/store.ts;packages/db/migrations/025_merge_number;packages/db/src/repositories/merge-sequence.ts;packages/db/src/repositories/;packages/db/src/pool.ts;packages/es/src/merge-number.ts;apps/search-api/src/sequence/merge-numbers.ts;apps/search-api/src/sequence/merge-number-batch.ts;apps/web/components/MergeNumberBadge.tsx;apps/web/components/MergeNumberEntry.tsx;apps/web/components/usePendingRevalidation.ts;apps/pipeline-worker/src/measure/;scripts/measure-sequence-latency.mjs;integration/sequence/

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=286465081f8459d9939f97a4fd8d765c8415ce9ba684ef59b6fa90d7015e5d1d
bytes=169116 compact_bytes=165682 lines=2331 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-11 (3차) 라운드가 배운 함정 (WP-074 M 번호) > 초록은 안전을 뜻하지 않는다 — 이 판에서 여섯 번 > 검증 도구 자체가 검증 대상이다 — 네 번 > 고친 것이 되살아나는 자리 — 규칙이 한 곳에만 적혀 있을 때 > 프로세스 안의 일관성이 배포의 일관성이 아니다
sig=agent-context/risks.md;deploy/single-host/;origin/main;docs/20_derived_ui_specs/pr_search_product_ia.md;apps/web;refs/tags/;usr/bin/env;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;4/4;7/7;tmp/.../baseline-integration.log;prs/web;close/reopen;actions/runs;Docker/WSL

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=b09bb1ec5edd5d9af239882710d4a91ac583a9f6f7407df580c0008f87979344
bytes=154958 compact_bytes=153999 lines=2424 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-11 (3차) — WP-074 M 번호 수직 구현 (CR-080 · CR-081) > Goal — 결정자의 말로 > Current state > Decisions — 이 세션이 고른 것 > Changed files
sig=agent-context/session-notes.md;packages/domain/src/mnumber.ts;apps/pipeline-worker/src/mnumber-plan.ts;apps/search-api/src/sequence/merge-number-view.ts;apps/web/lib/merge-number.ts;Risks/gotchas;github.com/89sooner/pr-search/pull/168;github.com/89sooner/pr-search/pull/169;github.com/89sooner/pr-search/pull/171;github.com/89sooner/pr-search/pull/170;docs/40_delivery/pr_search_implementation_traceability.md;docs/30_technical_architecture/pr_search_wp074_design.md;apps/web;agent-context/decisions.md;agent-context/files.md;apps/web/instrumentation.ts;deploy/single-host/smoke-images.sh;agent-context/commands.md;agent-context/todos.md;agent-context/risks.md;github.com/89sooner/pr-search/pull/165;github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.4;docs/00_governance/change_control.md;exports/202609110158.md

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=be16a038ebf0e9fdbd18a1a41674669101b0fd122f31ea48039208175285de01
bytes=104349 compact_bytes=103734 lines=1644 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-11 (3차) — WP-074 M 번호 수직 구현 (CR-080 · CR-081) > 이 세션의 목표 > 결과 > M 번호가 무엇인가 (다음 에이전트가 먼저 알아야 할 것) > 독립 리뷰 다섯 판 — 이 세션의 중심
sig=agent-context/session-summary.md;feature/wp074-squash-mnumber;tmp/pr-search-wp074-implementation;packages/authz/src/config.ts;prs/web;apps/web/instrumentation.ts;deploy/single-host/smoke-images.sh;refs/tags/;git/refs;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7;4/8;25/200

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=1f449a2f80b19b8e7cab4e63df8bafb820ad3f63934694cda80e3bacd21d4b2f
bytes=165245 compact_bytes=139910 lines=2046 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 시작하기 전에 실측할 것 > 0.1.0-pilot.5 발행 — 가장 앞에 있다 > 깨끗한 워크트리에서. 실행 중 deploy/single-host/* 를 편집하지 마라 (실행이 무효가 된다) > 열린 편차 셋 > 고치지 않기로 한 minor (근거는 원장 6.76장)
sig=agent-context/todos.md;home/roqkf/pr-search;origin/main;tmp/pr-search-bundle-out;deploy/single-host/;tmp/pr-search-bundle-main;/deploy/single-host/build-bundle.sh;tmp/pr-search-bundle-release;docs/40_delivery/pr_search_work_packages.md;apps/web/app/auth/callback/route.ts;apps/pipeline-worker/src/mirror-runner.ts;apps/pipeline-worker/src/sequence-plan.ts;docs/cr077-m-number;host/db;6.72.4/6.72.5;agent-context/count-unresolved-reviews.py;89sooner/pr-search;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.3;claude/first-internal-import-findings;company/main;docs/40_delivery/pr_search_implementation_traceability.md;home/roqkf/design-system;git/refs;refs/tags/

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=3bf000c8d0cc7477380b39b3fecbe323fb016e79bee19a06cf59bb23b90d3456
bytes=4413 compact_bytes=5099 lines=92 priority=50
heads=Upstream Feedback > DEV-561 — git 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패 > 반영해야 할 파일 > FR-NEW — 사내 GHE OAuth2 직접 인증 지원 > 필요한 변경 > GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
sig=agent-context/upstream-feedback.md;certs/ghe-ca.crt;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;docs/40_delivery/pr_search_implementation_traceability.md;OIDC/GHE;login/oauth/authorize;login/oauth/access_token;user/teams;cpswdev-team/pipe-admins;cpswdev-team/pipe-users;Upstream;Feedback;DEV;JOB;MIR;SSL;certificate;problem;NODE_EXTRA_CA_CERTS;Node;GIT_SSL_CAINFO;RUNBOOK

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
