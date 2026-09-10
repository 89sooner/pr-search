# agent-context-index:v1
generated=2026-09-10T17:04:16+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,apps/web,agent-context/decisions.md,agent-context/files.md,apps/web/instrumentation.ts,deploy/single-host/smoke-images.sh,agent-context/commands.md,agent-context/todos.md
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,packages/authz/src/config.ts,prs/web,apps/web/instrumentation.ts,deploy/single-host/smoke-images.sh,refs/tags/,git/refs,10/11
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,healthz/route.test.ts,commit/PR/,apps/web,refs/tags/,git/refs,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,origin/main,docs/40_delivery/pr_search_work_packages.md,apps/web/app/auth/callback/route.ts,apps/pipeline-worker/src/mirror-runner.ts,apps/pipeline-worker/src/sequence-plan.ts,docs/cr077-m-number,host/db
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,SP/bin/pnpm,usr/bin/env,home/roqkf/.nvm/versions/node/v22.23.2/bin/corepack,SP/bin,home/roqkf/.nvm/versions/node/v22.23.2/bin,prs/web,manifest/release-manifest.json
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,apps/web/instrumentation.ts,apps/web/lib/server/config.ts,apps/web/app/healthz/route.ts,packages/authz/src/config.ts,deploy/single-host/smoke-images.sh,deploy/single-host/build-bundle.sh,deploy/single-host/prsctl
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,origin/main,docs/20_derived_ui_specs/pr_search_product_ia.md,apps/web,refs/tags/,usr/bin/env,HOME/.nvm/versions/node/v22.23.2/bin,regression/runtime-reachability.test.ts

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=44f49f1061da0ffb2c97d05aaf5b9af87244a699e6fbc8a1c263058257a658ee
bytes=163502 compact_bytes=167589 lines=3276 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-11 (2차) 라운드에서 쓴 것 (CR-078 · pilot.4 발행) > 전제 — Node 22와 pnpm > 스크래치패드에 pnpm 실행 파일을 만든다 > 원인 재현 — 릴리스 이미지를 직접 잰다 > 사내가 받은 이미지인지 먼저 확인한다
sig=agent-context/commands.md;SP/bin/pnpm;usr/bin/env;home/roqkf/.nvm/versions/node/v22.23.2/bin/corepack;SP/bin;home/roqkf/.nvm/versions/node/v22.23.2/bin;prs/web;manifest/release-manifest.json;app/node_modules;pg/package.json;app/node_modules/.pnpm/pg;app/node_modules/pg-;apps/web;/node_modules/.bin/next;deploy/single-host/smoke-images.sh;home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;/deploy/single-host/build-bundle.sh;SP/release;usr/bin;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.4;repos/89sooner/pr-search/commits/;repos/89sooner/pr-search/pulls/165;docs/30_technical_architecture/pr_search_async_events_jobs.md;packages/github/src/mirror-graph.ts

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=f4be0d654aa547e7caa06470f5df555e306b10b79bf92948f99ecc3013881e2d
bytes=193308 compact_bytes=169956 lines=1598 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-11 (2차) — CR-078 기동 실패-빠름 (설계 결정) > 2026-09-11 — CR-077 M 넘버 (설계 결정) > 2026-09-08 (2차) — 0.1.0-pilot.3 발행 (CR-068 · CR-069 / DEV-555~558) > 2026-09-08 — 첫 사내 반입 반영 (CR-066 / DEV-548~553) > 2026-09-03 2차 — 리뷰 부채 종결 (CR-037·CR-038 / CR-064 / DEV-035~041 / DEV-541~543)
sig=agent-context/decisions.md;healthz/route.test.ts;commit/PR/;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md;origin/main;packages/query/src/keys.ts;deploy/k8s/pipeline-worker-batch.yaml

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=eab2ccb46c577b8427f1b37d41ee8f6889f6a6d52683c64fe6d83b92a6d86762
bytes=130091 compact_bytes=127886 lines=1547 priority=45
heads=중요 파일 경로와 역할 > 2026-09-11 (2차) 라운드가 만진 것 (CR-078 — 코드·배포·시험·문서 19개) > 이번 결함의 정본 — 여기부터 읽는다 > 배포 정의 > 시험 > 문서
sig=agent-context/files.md;apps/web/instrumentation.ts;apps/web/lib/server/config.ts;apps/web/app/healthz/route.ts;packages/authz/src/config.ts;deploy/single-host/smoke-images.sh;deploy/single-host/build-bundle.sh;deploy/single-host/prsctl;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;apps/web/instrumentation.test.ts;apps/web/app/healthz/route.test.ts;apps/web/lib/server/config.test.ts;packages/authz/src/config.test.ts;regression/runtime-reachability.test.ts;regression/fixtures/release-tag/fake-docker;regression/release-tag-ownership.test.ts;apps/web/;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;exports/202609110158.md;docs/10_requirements/srs_final.md;docs/40_delivery/pr_search_work_packages.md

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=585fc64445a91d00b4ba5fc72554dca1de2401edd604ae49a441cac32c97fe67
bytes=165372 compact_bytes=162007 lines=2278 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-11 (2차) 라운드가 배운 함정 (CR-078 기동 실패-빠름) > 적힌 의도와 실제 동작이 다를 수 있다 — 가장 값비쌌던 것 > throw가 기동을 막을 것이라고 가정하지 마라 (Next.js production) > 「healthz 200」과 「화면이 열린다」는 다른 명제다 > 같은 외형의 500이 둘 이상 있을 수 있다
sig=agent-context/risks.md;origin/main;docs/20_derived_ui_specs/pr_search_product_ia.md;apps/web;refs/tags/;usr/bin/env;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;4/4;7/7;tmp/.../baseline-integration.log;prs/web;close/reopen;actions/runs;Docker/WSL;deploy/k8s/README.md

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=5e5433b150c06ea2d397dd8bb1f4796d0d7f9de750cde70fa3a46cf275aa31e4
bytes=151495 compact_bytes=150511 lines=2366 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-11 (2차) — CR-078 사내 pilot.3 웹 500 폐쇄와 0.1.0-pilot.4 발행 > Goal > Current state > Decisions > Changed files
sig=agent-context/session-notes.md;apps/web;agent-context/decisions.md;agent-context/files.md;apps/web/instrumentation.ts;deploy/single-host/smoke-images.sh;agent-context/commands.md;agent-context/todos.md;Risks/gotchas;agent-context/risks.md;github.com/89sooner/pr-search/pull/165;github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.4;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;exports/202609110158.md;dailywork/2026-09-11_PR-Search-pilot.3-;host/db;github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.3;claude/first-internal-import-findings;agent-context/_handoff;api/v1/webhooks/github;company/main;agent-context/count-unresolved-reviews.py;home/roqkf/design-system

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=eb6568fde394d565cccabc68bc1e2bfaa515bc0a8e1ee50f97a14db8dd5bfbcc
bytes=100157 compact_bytes=99539 lines=1575 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-11 (2차) — CR-078 운영 구성 위반이 기동을 막게 한다 · 0.1.0-pilot.4 발행 > 이 세션의 목표 > 결과 > 어떻게 판정했는가 (이 세션의 방법론) > 이 세션이 남긴 방어
sig=agent-context/session-summary.md;packages/authz/src/config.ts;prs/web;apps/web/instrumentation.ts;deploy/single-host/smoke-images.sh;refs/tags/;git/refs;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7;4/8;25/200;close/reopen;Docker/WSL

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=255cbcfbb681cd046c15b0fc71ccac4819f6580ebe0499197f0905e8b4bfca84
bytes=161389 compact_bytes=136056 lines=1984 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 시작하기 전에 실측할 것 > 2026-09-11 (2차) — CR-078 이후 남은 것 > 사내 재시험에서 확인해야 할 것 > 다음 작업 — WP-074 (M 넘버 채번과 조회) > 그다음 — WP-075 (PR 제목 M 넘버 표기)
sig=agent-context/todos.md;origin/main;docs/40_delivery/pr_search_work_packages.md;apps/web/app/auth/callback/route.ts;apps/pipeline-worker/src/mirror-runner.ts;apps/pipeline-worker/src/sequence-plan.ts;docs/cr077-m-number;host/db;6.72.4/6.72.5;agent-context/count-unresolved-reviews.py;89sooner/pr-search;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.3;claude/first-internal-import-findings;company/main;docs/40_delivery/pr_search_implementation_traceability.md;home/roqkf/design-system;git/refs;refs/tags/;regression/release-tag-ownership.test.ts;conductor-by-89soone/css;2/4;deploy/single-host/;/deploy/single-host/build-bundle.sh;releases/tags/

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
