# agent-context-index:v1
generated=2026-09-07T16:58:47+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,claude/first-internal-import-findings,agent-context/_handoff,api/v1/webhooks/github,apps/web,company/main,Risks/gotchas,agent-context/count-unresolved-reviews.py
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,refs/tags/,git/refs,10/11,CR/DEV,11/11,1/8,2/8
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,apps/web,refs/tags/,git/refs,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,lib/nav.ts,packages/domain/src/anchor.ts
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,claude/first-internal-import-findings,agent-context/count-unresolved-reviews.py,company/main,docs/40_delivery/pr_search_implementation_traceability.md,home/roqkf/design-system,89sooner/pr-search,git/refs
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,prs/web,OUT/.next/cache,OUT/e2e,OUT/a11y,OUT/test-results,/node_modules/.bin/next,dev/null
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,claude/first-internal-import-findings,packages/github/src/config.ts,packages/github/src/config.test.ts,apps/web/next.config.ts,scripts/materialize-turbopack-externals.mjs,deploy/single-host/RUNBOOK.md,deploy/single-host/.env.example
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,apps/web,refs/tags/,usr/bin/env,origin/main,HOME/.nvm/versions/node/v22.23.2/bin,regression/runtime-reachability.test.ts,repos/89sooner/pr-search/pulls/

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=ae5c7c033281b5bd908566762580efaed082befeb40bc0b73bd2954981de1e95
bytes=149748 compact_bytes=153169 lines=2988 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-08 라운드에서 쓴 것 > 살아남으면 등가 변이인지 시험 구멍인지 먼저 가른다 — 이번엔 둘 다 시험 구멍이었다 > 2026-09-03 2차 라운드에서 쓴 것 > 미해결 스레드의 id·경로·본문을 전량 덤프 (scratchpad의 threads.py) > 라운드가 처리한 스레드를 두 저장소 전수로 센다 (resolved 포함).
sig=agent-context/commands.md;prs/web;OUT/.next/cache;OUT/e2e;OUT/a11y;OUT/test-results;/node_modules/.bin/next;dev/null;apps/web/.next/server/;apps/web/.next/server/app/page.js.nft.json;node_modules/.pnpm/pg;8.23.0/node_modules/pg/package.json;claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;tmp/before;dev/tcp/127.0.0.1/;/remote.git;refs/heads/main;refs/tags/v1;repos/89sooner/pr-search/git/refs;refs/tags/0.1.0-pilot.2;regression/release-tag-ownership.test.ts;actions/runs/;home/roqkf/design-system;conductor-by-89soone/tokens

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=a9c9c026014b81b396f53f47919320931351953531f70cba6803913ce3292f5d
bytes=181767 compact_bytes=159425 lines=1548 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-08 — 첫 사내 반입 반영 (CR-066 / DEV-548~553) > 2026-09-03 2차 — 리뷰 부채 종결 (CR-037·CR-038 / CR-064 / DEV-035~041 / DEV-541~543) > 2026-09-03 애니메이션·폴리시 라운드 (DEV-028~034 / DEV-538~540) > CR-030 (WP-026 / W-005) — 2026-08-25 closed > DEV-160 (구현 중 발견, CR 불필요) — 판정을 하나로 모았다
sig=agent-context/decisions.md;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md;origin/main;packages/query/src/keys.ts;deploy/k8s/pipeline-worker-batch.yaml;prs/es;prs/db

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=2d81a7575af0a42c82780509ae43762d2d6ff75896430abb44dd70ad18d2e15a
bytes=120593 compact_bytes=118578 lines=1429 priority=45
heads=중요 파일 경로와 역할 > 2026-09-08 라운드가 만지거나 만든 것 (첫 사내 반입 반영) > 2026-09-03 2차 라운드가 만지거나 만든 것 > 2026-09-03 라운드가 만지거나 만든 것 > 이 저장소를 읽는 순서 (문서) > 이 세션에서 만든 소스 (CR-032~036)
sig=agent-context/files.md;claude/first-internal-import-findings;packages/github/src/config.ts;packages/github/src/config.test.ts;apps/web/next.config.ts;scripts/materialize-turbopack-externals.mjs;deploy/single-host/RUNBOOK.md;deploy/single-host/.env.example;regression/runtime-reachability.test.ts;docs/40_delivery/pr_search_implementation_traceability.md;docs/00_governance/change_control.md;docs/30_technical_architecture/pr_search_infrastructure_operations.md;scripts/lint-deps.mjs;apps/ingest-gateway/src/server.ts;deploy/single-host/build-bundle.sh;git/refs;refs/tags/;regression/release-tag-ownership.test.ts;regression/fixtures/release-tag/;apps/web/package.json;docs/20_derived_ui_specs/pr_search_design_system_tokens.md;packages/css/src/components.css;packages/css/test/bundle.test.ts;scripts/check-release-tags.mjs

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=91af67e2f45d0db92e8e721e547679cf2d6efa9eed3b31bf242b4f1eb9c0297b
bytes=153448 compact_bytes=150196 lines=2098 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-08 라운드가 새로 배운 함정 (첫 사내 반입이 가르친 것) > 개발 트리와 배포 트리는 다른 것을 한다 — 가장 값비쌌던 것 > 설정으로 풀릴 것 같은 것이 설정으로 안 풀린다 — 넷을 재고 넷 다 버렸다 > 보고된 원인 진단이 틀릴 수 있다 — 증상이 같아도 모듈이 다르다 > YAML anchor는 얕게 합쳐진다 — 자기 키를 가진 서비스가 사각지대다
sig=agent-context/risks.md;apps/web;refs/tags/;usr/bin/env;origin/main;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;4/4;7/7;tmp/.../baseline-integration.log;prs/web;close/reopen;actions/runs;Docker/WSL;deploy/k8s/README.md;worker/link.test.ts

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=05b065ef07c42fa3a56ebf6a6df410f718b4ff018fe51dc1d2c6c03425868bd1
bytes=142319 compact_bytes=141269 lines=2222 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-08 — 첫 사내 반입의 결과를 저장소에 반영 > Goal > Current state > 인계 pack에 하루치 공백이 있었다 > 결정자의 보고를 그대로 믿지 않고 전부 실측했다
sig=agent-context/session-notes.md;claude/first-internal-import-findings;agent-context/_handoff;api/v1/webhooks/github;apps/web;company/main;Risks/gotchas;agent-context/count-unresolved-reviews.py;home/roqkf/design-system;origin/main;exports/202609032106.md;10/11;docs/00_governance/change_control.md;exports/202608260047.md;dailywork/2026-08-25_PR-Search-WP-028;exports/202608251453.md;exports/202608260113.md;11/11;exports/202608261008.md;1/8;2/8;exports/202608262010.md;dailywork/2026-08-26_PR-Search-OD-005-;W-002/W-003

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=9b9470ea59f5defb6d0aded58015dc2f9781395c97ff4c007b301dbdcb6540b9
bytes=91780 compact_bytes=91288 lines=1456 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-08 — 첫 사내 반입의 결과를 저장소에 반영 > 이 세션의 목표 > 핵심 발견 넷 > 완료한 것 > 반복해서 나타난 패턴 — 재기 전에는 고쳤다고 말할 수 없다
sig=agent-context/session-summary.md;refs/tags/;git/refs;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7;4/8;25/200;close/reopen;Docker/WSL;5/8;agent-context/_handoff/context-index.md;W-001/W-008;6/8

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=a78799b502cfb57bb1075fd3ad7dbf364d18dad0790375684c5e7108d0678226
bytes=151091 compact_bytes=149389 lines=1842 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > A. 지금 당장 — 이 라운드를 닫는다 > B. 사내에서 해야 할 것 — 다음 번들을 받을 때 > C. 아직 성립하지 않은 것 — 반입 성공과 게이트 통과는 다르다 > D. 미뤄 둔 것 — 이전과 같다 > E. 이 라운드가 깔아 둔 자리 — 다시 만들지 말 것
sig=agent-context/todos.md;claude/first-internal-import-findings;agent-context/count-unresolved-reviews.py;company/main;docs/40_delivery/pr_search_implementation_traceability.md;home/roqkf/design-system;89sooner/pr-search;git/refs;refs/tags/;regression/release-tag-ownership.test.ts;conductor-by-89soone/css;2/4;deploy/single-host/;/deploy/single-host/build-bundle.sh;releases/tags/;deploy/single-host;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.2;vendor/upstream;24/24;deploy/single-host/RUNBOOK.md;deploy/single-host/bundle/pr-search-;deploy/single-host/.env.example;/prsctl;deploy/single-host/prsctl

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
