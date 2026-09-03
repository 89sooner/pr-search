# agent-context-index:v1
generated=2026-09-03T05:17:01+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,agent-context/count-unresolved-reviews.py,Risks/gotchas,10/11,docs/00_governance/change_control.md,exports/202608260047.md,dailywork/2026-08-25_PR-Search-WP-028,exports/202608251453.md
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,10/11,CR/DEV,11/11,1/8,2/8,3/8,acme/b
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,lib/nav.ts,packages/domain/src/anchor.ts,packages/db,prs/query,apps/search-api/src/runtime.ts
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,home/roqkf/design-system,2/4,agent-context/count-unresolved-reviews.py,deploy/single-host/,/deploy/single-host/build-bundle.sh,releases/tags/,deploy/single-host
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,home/roqkf/design-system,conductor-by-89soone/tokens,tokens/dist,conductor-by-89soone/css,packages/tokens/bin/,home/roqkf/pr-search/apps/web/package.json,playwright/test
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,apps/web/app/layout.tsx,apps/web/e2e/shell.spec.ts,apps/web/components/,apps/web/package.json,packages/tokens/src/primitives.ts,packages/css/src/reset.css,packages/css/src/base.css
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,origin/main,HOME/.nvm/versions/node/v22.23.2/bin,regression/runtime-reachability.test.ts,repos/89sooner/pr-search/pulls/,exports/202608260047.md,try/catch,docs/40_delivery/pr_search_implementation_traceability.md

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=886a67f53079670b85aa0102dd197cb8fb5937e6dba0ff728d7d827c6dfc3fd9
bytes=141856 compact_bytes=144833 lines=2840 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-03 라운드에서 쓴 것 > 필수 전제 — Node PATH > 검증 배터리 (전 계층, 마지막 실행 결과) > 함정: e2e는 빌드를 하지 않는다 > 실패했던 명령과 원인
sig=agent-context/commands.md;home/roqkf/design-system;conductor-by-89soone/tokens;tokens/dist;conductor-by-89soone/css;packages/tokens/bin/;home/roqkf/pr-search/apps/web/package.json;playwright/test;node_modules/.pnpm;esbuild/linux-x64/bin/esbuild;/node_modules/.bin/next;origin/main;HOME/.nvm/versions/node/v22.23.2/bin;prs/web;web/lib/neighbors;sequence/neighbors;apps/web;/node_modules/.bin/playwright;e2e/flow-002.spec.ts;prs-postgres/redis/elasticsearch;dist/cli.js;9200/_cat/indices;repos/89sooner/pr-search/pulls/33/comments;pass/fail

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=35ce8f5861785a1bab4de67eef237a8b5767e6fa98449c8fb4bb98ea0e1df1ca
bytes=172088 compact_bytes=150590 lines=1514 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-03 애니메이션·폴리시 라운드 (DEV-028~034 / DEV-538~540) > CR-030 (WP-026 / W-005) — 2026-08-25 closed > DEV-160 (구현 중 발견, CR 불필요) — 판정을 하나로 모았다 > CR-031 (WP-027 / 선행·후행) — 2026-08-25 closed, SRS v2.4 > 서수를 URL 앵커로 넘길 때 — seq: 접두는 필수다
sig=agent-context/decisions.md;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md;origin/main;packages/query/src/keys.ts;deploy/k8s/pipeline-worker-batch.yaml;prs/es;prs/db;worker/link.test.ts;docs/README.md;3/8

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=c3c1a64522edb9c0c75e38e77f76e0b4da09a101208db827f96a40549c5d055f
bytes=114087 compact_bytes=112172 lines=1371 priority=45
heads=중요 파일 경로와 역할 > 2026-09-03 라운드가 만지거나 만든 것 > 이 저장소를 읽는 순서 (문서) > 이 세션에서 만든 소스 (CR-032~036) > 운영 배선 · 도달성 > WP-028 (정합성 점검 · 조정 스캔)
sig=agent-context/files.md;apps/web/app/layout.tsx;apps/web/e2e/shell.spec.ts;apps/web/components/;apps/web/package.json;packages/tokens/src/primitives.ts;packages/css/src/reset.css;packages/css/src/base.css;packages/css/src/components.css;packages/css/test/bundle.test.ts;packages/css/test/class-contract.test.ts;apps/docs/e2e/foundations.spec.ts;plans/README.md;docs/10_requirements/srs_final.md;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;docs/40_delivery/pr_search_work_packages.md;apps/search-api/src/runtime.ts;apps/search-api/src/runtime.test.ts;regression/runtime-reachability.test.ts;deploy/k8s/pipeline-worker-sequence.yaml;deploy/k8s/pipeline-worker-reconcile.yaml;packages/domain/src/integrity.ts;packages/db/src/repositories/integrity.ts

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=62b32be948cd88a8fc140e2147d500ac4e94fcab4963317f0632ca27b1bc9785
bytes=142598 compact_bytes=139536 lines=1984 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-03 라운드가 새로 배운 함정 > 스택 PR을 연달아 병합하면 main에 닿지 않는다 — 가장 값비쌌던 것 > 명시도로 겨루는 CSS 해결책은 나중에 조용히 무너진다 > 한 결함을 고치면 다음 결함이 드러난다 — 노출은 배치와 짝이다 > .cdt-mono는 색까지 강제한다 — 색을 가진 표면 안에 넣지 마라
sig=agent-context/risks.md;origin/main;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;apps/web;4/4;7/7;tmp/.../baseline-integration.log;prs/web;close/reopen;actions/runs;Docker/WSL;deploy/k8s/README.md;worker/link.test.ts;pr-search/202608271346.md;acme/payments

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=a88d855ad59d815acb0362c30250e0d03420dec0538300d614adc9253be532f5
bytes=127769 compact_bytes=127222 lines=2026 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-03 — 애니메이션 감사부터 Conductor 0.3.0 반영까지 > Goal > Current state > 무엇을 고쳤나 — 셋은 한 번도 동작한 적이 없었다 > Decisions
sig=agent-context/session-notes.md;agent-context/count-unresolved-reviews.py;Risks/gotchas;10/11;docs/00_governance/change_control.md;exports/202608260047.md;dailywork/2026-08-25_PR-Search-WP-028;exports/202608251453.md;exports/202608260113.md;11/11;exports/202608261008.md;1/8;2/8;exports/202608262010.md;dailywork/2026-08-26_PR-Search-OD-005-;W-002/W-003;3/8;exports/202608262224.md;4/8;apps/search-api/integration/sequence/_repro-w004.test.ts;exports/202608270742.md;dailywork/2026-08-27_PR-Search-WP-035-;pr-search/202608271346.md;5/8

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=b90dc718564ba3da21303ba4c7f735660644e7ecab0f9ae297cbd93266392d26
bytes=85863 compact_bytes=85442 lines=1384 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-03 — 애니메이션·컴포넌트 폴리시 라운드 > 이 세션의 목표 > 핵심 발견 > 완료한 것 > 반복해서 나타난 패턴
sig=agent-context/session-summary.md;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7;4/8;25/200;close/reopen;Docker/WSL;5/8;agent-context/_handoff/context-index.md;W-001/W-008;6/8;API-ADM-001/006;7/8

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=1ff3cc72efa66f264d614df79da54826411b173288a1638f2bdd376c669e6862
bytes=140191 compact_bytes=138675 lines=1719 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 이번 세션이 세운 것 — GitHub Release 운반 경로 > A. 지금 당장 — 실제 사내 반입 (0.1.0-pilot.2) > B. 결정 대기 — PR #125 머지 후 리뷰 (P1) > C. 원장에 아직 없는 것 > D. 배포에서 해야 할 것 — 어제와 같다
sig=agent-context/todos.md;home/roqkf/design-system;2/4;agent-context/count-unresolved-reviews.py;deploy/single-host/;/deploy/single-host/build-bundle.sh;releases/tags/;deploy/single-host;89sooner/pr-search;refs/tags/;docs/40_delivery/pr_search_implementation_traceability.md;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.2;vendor/upstream;company/main;24/24;deploy/single-host/RUNBOOK.md;deploy/single-host/bundle/pr-search-;deploy/single-host/.env.example;/prsctl;deploy/single-host/prsctl;GET/POST/DELETE;packages/contracts/src/error-codes.ts;perf/analytics.perf.test.ts;packages/db/src/repositories/team-membership.ts

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
