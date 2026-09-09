# agent-context-index:v1
generated=2026-09-08T08:23:37+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,host/db,Risks/gotchas,github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.3,claude/first-internal-import-findings,agent-context/_handoff,api/v1/webhooks/github,apps/web
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,refs/tags/,git/refs,10/11,CR/DEV,11/11,1/8,2/8
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,apps/web,refs/tags/,git/refs,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,lib/nav.ts,packages/domain/src/anchor.ts
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,host/db,6.72.4/6.72.5,agent-context/count-unresolved-reviews.py,89sooner/pr-search,repos/89sooner/pr-search/releases/tags/0.1.0-pilot.3,claude/first-internal-import-findings,company/main
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,/deploy/single-host/build-bundle.sh,/pr-search-,-offline/deploy/single-host,/prsctl,vendor/upstream,repos/89sooner/pr-search/releases/tags/,refs/tags/
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,deploy/single-host/prsctl,host/db,deploy/single-host/RUNBOOK.md,deploy/single-host/.env.example,deploy/single-host/bundle/pr-search-0.1.0-pilot.3-offline,docs/20_derived_ui_specs/pr_search_design_system_tokens.md,regression/runtime-reachability.test.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,apps/web,refs/tags/,usr/bin/env,origin/main,HOME/.nvm/versions/node/v22.23.2/bin,regression/runtime-reachability.test.ts,repos/89sooner/pr-search/pulls/

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=e31b3b195e176f9abc7b622c4ad85735e40222d0846c8267f6ba4a296e8e39f3
bytes=153707 compact_bytes=157307 lines=3067 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-08 (2차) 라운드에서 쓴 것 (발행) > 계보: git fetch <번들>/source/*.bundle HEAD:vendor/upstream 뒤 manifest의 upstream.commit과 대조 > ADMIN_DATABASE_URL 경계 7종: 비밀번호의 @·:, 퍼센트 인코딩, 대문자 롤, prs_admin, 스킴·비밀번호 부재 > 2026-09-08 라운드에서 쓴 것 > 살아남으면 등가 변이인지 시험 구멍인지 먼저 가른다 — 이번엔 둘 다 시험 구멍이었다
sig=agent-context/commands.md;/deploy/single-host/build-bundle.sh;/pr-search-;-offline/deploy/single-host;/prsctl;vendor/upstream;repos/89sooner/pr-search/releases/tags/;refs/tags/;tmp/sim;origin/main;prs/web;apps/web;/node_modules/.bin/playwright;e2e/flow-003.spec.ts;14/14;deploy/single-host/prsctl;OUT/.next/cache;OUT/e2e;OUT/a11y;OUT/test-results;/node_modules/.bin/next;dev/null;apps/web/.next/server/;apps/web/.next/server/app/page.js.nft.json

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=787127e3d1aeacae68d6798576c256319451410ccd779cb8a2c1191670130a06
bytes=185143 compact_bytes=162659 lines=1563 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-08 (2차) — 0.1.0-pilot.3 발행 (CR-068 · CR-069 / DEV-555~558) > 2026-09-08 — 첫 사내 반입 반영 (CR-066 / DEV-548~553) > 2026-09-03 2차 — 리뷰 부채 종결 (CR-037·CR-038 / CR-064 / DEV-035~041 / DEV-541~543) > 2026-09-03 애니메이션·폴리시 라운드 (DEV-028~034 / DEV-538~540) > CR-030 (WP-026 / W-005) — 2026-08-25 closed
sig=agent-context/decisions.md;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md;origin/main;packages/query/src/keys.ts;deploy/k8s/pipeline-worker-batch.yaml;prs/es;prs/db

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=add646e7e1e04d7c2ee4dcad2ad99bc057efbc91afb333504bce95cc26b8cd47
bytes=123439 compact_bytes=121312 lines=1457 priority=45
heads=중요 파일 경로와 역할 > 2026-09-08 (2차) 라운드가 만지거나 만든 것 (0.1.0-pilot.3 발행) > 배포 산출물 — 사내로 들어가는 것 > 문서·회귀 > 손대면 안 되는 것 (갱신) > 2026-09-08 라운드가 만지거나 만든 것 (첫 사내 반입 반영)
sig=agent-context/files.md;deploy/single-host/prsctl;host/db;deploy/single-host/RUNBOOK.md;deploy/single-host/.env.example;deploy/single-host/bundle/pr-search-0.1.0-pilot.3-offline;docs/20_derived_ui_specs/pr_search_design_system_tokens.md;regression/runtime-reachability.test.ts;apps/web;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;claude/first-internal-import-findings;packages/github/src/config.ts;packages/github/src/config.test.ts;apps/web/next.config.ts;scripts/materialize-turbopack-externals.mjs;docs/30_technical_architecture/pr_search_infrastructure_operations.md;scripts/lint-deps.mjs;apps/ingest-gateway/src/server.ts;deploy/single-host/build-bundle.sh;git/refs;refs/tags/;regression/release-tag-ownership.test.ts;regression/fixtures/release-tag/

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=81080789d103b72e178efc88341c445b54b7b836b0c8704fe68102e1bcaa96db
bytes=156941 compact_bytes=153643 lines=2148 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-08 (2차) 라운드가 새로 배운 함정 (발행 라운드) > 발행은 되돌릴 수 없으므로 리뷰가 도착할 시간을 벌어 둔다 — 가장 값비쌌던 것 > 주석은 강제하지 않는다 — 앞 라운드의 내 처방이 그랬다 > 내 시험이 틀린 계약을 굳힐 수 있다 — 두 번째다 > toContain은 부분 문자열로 통과한다
sig=agent-context/risks.md;apps/web;refs/tags/;usr/bin/env;origin/main;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;4/4;7/7;tmp/.../baseline-integration.log;prs/web;close/reopen;actions/runs;Docker/WSL;deploy/k8s/README.md;worker/link.test.ts

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=7ae042f90a0747c0e85d620653b6a19767e2196dded7917667eded19553cfe5e
bytes=147767 compact_bytes=146594 lines=2303 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-08 (2차) — 0.1.0-pilot.3 발행 > Goal > Current state > 이 라운드에서 가장 값이 컸던 것 — 발행을 마지막에 두었다 > DEV-556 — 내가 앞 라운드에 만든 구멍
sig=agent-context/session-notes.md;host/db;Risks/gotchas;github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.3;claude/first-internal-import-findings;agent-context/_handoff;api/v1/webhooks/github;apps/web;company/main;agent-context/count-unresolved-reviews.py;home/roqkf/design-system;origin/main;exports/202609032106.md;10/11;docs/00_governance/change_control.md;exports/202608260047.md;dailywork/2026-08-25_PR-Search-WP-028;exports/202608251453.md;exports/202608260113.md;11/11;exports/202608261008.md;1/8;2/8;exports/202608262010.md

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=83d89ff5a1019af7ddd780d67d608b76ebff2f182662c184e34f367610f3823f
bytes=94750 compact_bytes=94151 lines=1491 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-08 (2차) — 0.1.0-pilot.3 발행 > 이 세션의 목표 > 핵심 발견 넷 > 완료한 것 > 반복해서 나타난 패턴 — 고침이 다음 구멍을 연다
sig=agent-context/session-summary.md;refs/tags/;git/refs;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7;4/8;25/200;close/reopen;Docker/WSL;5/8;agent-context/_handoff/context-index.md;W-001/W-008;6/8

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=c732c29f8a5a0cc5e4c18b5ca9ea64b511d29f6706eb897217cb59e5c80c6b23
bytes=155099 compact_bytes=153353 lines=1900 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > A. 지금 당장 — 결정자 조치 > B. 사내에서 — upgrade 절차 > C. 열려 있는 것 > D. 이 라운드가 깔아 둔 자리 — 다시 만들지 말 것 > 시작하기 전에 — 이 인계의 값을 실측하라
sig=agent-context/todos.md;host/db;6.72.4/6.72.5;agent-context/count-unresolved-reviews.py;89sooner/pr-search;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.3;claude/first-internal-import-findings;company/main;docs/40_delivery/pr_search_implementation_traceability.md;home/roqkf/design-system;git/refs;refs/tags/;regression/release-tag-ownership.test.ts;conductor-by-89soone/css;2/4;deploy/single-host/;/deploy/single-host/build-bundle.sh;releases/tags/;deploy/single-host;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.2;vendor/upstream;24/24;deploy/single-host/RUNBOOK.md;deploy/single-host/bundle/pr-search-

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
