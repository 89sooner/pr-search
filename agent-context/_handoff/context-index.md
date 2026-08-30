# agent-context-index:v1
generated=2026-08-30T16:07:19+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,10/11,Risks/gotchas,docs/00_governance/change_control.md,exports/202608260047.md,dailywork/2026-08-25_PR-Search-WP-028,exports/202608251453.md,exports/202608260113.md
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,10/11,CR/DEV,11/11,1/8,2/8,3/8,acme/b
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,lib/nav.ts,packages/domain/src/anchor.ts,packages/db,prs/query,apps/search-api/src/runtime.ts
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,4/4,docs/40_delivery/pr_search_implementation_traceability.md,packages/query/src/serialize.ts,apps/pipeline-worker/src/documents.ts,packages/es/src/upsert.ts,apps/pipeline-worker/src/reconcile.ts,apps/search-api/src/ops/jobs.ts
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,prs/web,web/lib/neighbors,sequence/neighbors,apps/web,/node_modules/.bin/playwright,e2e/flow-002.spec.ts
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,docs/10_requirements/srs_final.md,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,docs/40_delivery/pr_search_work_packages.md,apps/search-api/src/runtime.ts,apps/search-api/src/runtime.test.ts,regression/runtime-reachability.test.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,HOME/.nvm/versions/node/v22.23.2/bin,regression/runtime-reachability.test.ts,repos/89sooner/pr-search/pulls/,exports/202608260047.md,try/catch,docs/40_delivery/pr_search_implementation_traceability.md,origin/main

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=5aac1dd653a375218a4a6e6ae36b8101f49761f3ba93d7b40178407af48a5271
bytes=107024 compact_bytes=108504 lines=2194 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 필수 전제 — Node PATH > 검증 배터리 (전 계층, 마지막 실행 결과) > 함정: e2e는 빌드를 하지 않는다 > 실패했던 명령과 원인 > 환경 준비 (새 머신이라면)
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;prs/web;web/lib/neighbors;sequence/neighbors;apps/web;/node_modules/.bin/playwright;e2e/flow-002.spec.ts;prs-postgres/redis/elasticsearch;dist/cli.js;9200/_cat/indices;repos/89sooner/pr-search/pulls/33/comments;pass/fail;dev/null;docs/00_governance/change_control.md;home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;ops/sequence-integrity;pipeline-worker/integration/sequence/repair;authz/team-scope;packages/authz/src/team-scope;search-api/src/runtime;repos/89sooner/pr-search/pulls/;acme/payments;acme/integrity-wp028

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=b2c0c912499f6cd02f687cbe02a2c71c828e9ac2b020a46998b4c167ea0a915b
bytes=133077 compact_bytes=117589 lines=1225 priority=28
heads=확정한 설계 결정과 이유 > CR-030 (WP-026 / W-005) — 2026-08-25 closed > DEV-160 (구현 중 발견, CR 불필요) — 판정을 하나로 모았다 > CR-031 (WP-027 / 선행·후행) — 2026-08-25 closed, SRS v2.4 > 서수를 URL 앵커로 넘길 때 — seq: 접두는 필수다 > 시험 방법에 관한 결정
sig=agent-context/decisions.md;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md;origin/main;packages/query/src/keys.ts;deploy/k8s/pipeline-worker-batch.yaml;prs/es;prs/db;worker/link.test.ts;docs/README.md;3/8

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=f676ea934e34db88793487d51caad223ede4c71b8a7fa7e05d7da415e2391b6f
bytes=90657 compact_bytes=89691 lines=1115 priority=45
heads=중요 파일 경로와 역할 > 이 저장소를 읽는 순서 (문서) > 이 세션에서 만든 소스 (CR-032~036) > 운영 배선 · 도달성 > WP-028 (정합성 점검 · 조정 스캔) > WP-068 (팀 접근 범위)
sig=agent-context/files.md;docs/10_requirements/srs_final.md;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;docs/40_delivery/pr_search_work_packages.md;apps/search-api/src/runtime.ts;apps/search-api/src/runtime.test.ts;regression/runtime-reachability.test.ts;deploy/k8s/pipeline-worker-sequence.yaml;deploy/k8s/pipeline-worker-reconcile.yaml;packages/domain/src/integrity.ts;packages/db/src/repositories/integrity.ts;apps/search-api/src/ops/sequence-integrity.ts;apps/pipeline-worker/src/integrity.ts;apps/pipeline-worker/src/reconcile.ts;apps/pipeline-worker/src/consistency.ts;apps/pipeline-worker/src/snapshot.ts;apps/pipeline-worker/src/sequence-repair-runner.ts;apps/pipeline-worker/src/sequence.ts;packages/db/migrations/009_job_type_reassign;packages/db/migrations/010_pr_snapshot;packages/authz/src/team-scope.ts;packages/db/migrations/011_repository_teams;packages/github/src/client.ts

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=bb18fd6be368ef1c648030ead421c623c8d35b43ae9c1426a35c5dc5514ae533
bytes=109393 compact_bytes=107131 lines=1628 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 절차 함정 (이 세션에서 실제로 밟은 것들) > 등가 변이를 킬로 착각하지 마라 — 두 WP 연속으로 나왔다 > lint는 마지막 파일을 쓴 뒤에 다시 돌려라 > 대역(mock)이 실제보다 관대하면 그만큼이 사각지대다 > 임시 컨테이너에서는 슬라이스마다 커밋하라
sig=agent-context/risks.md;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;origin/main;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;apps/web;4/4;7/7;tmp/.../baseline-integration.log;prs/web;close/reopen;actions/runs;Docker/WSL;deploy/k8s/README.md;worker/link.test.ts;pr-search/202608271346.md;acme/payments

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=6b51ac9bb841e8a2b4176668157ee927d1ff334e249fcb323d64a6e369f1f045
bytes=88203 compact_bytes=87935 lines=1456 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Goal > Current state > Decisions > Changed files > Commands
sig=agent-context/session-notes.md;10/11;Risks/gotchas;docs/00_governance/change_control.md;exports/202608260047.md;dailywork/2026-08-25_PR-Search-WP-028;exports/202608251453.md;exports/202608260113.md;11/11;exports/202608261008.md;1/8;2/8;exports/202608262010.md;dailywork/2026-08-26_PR-Search-OD-005-;W-002/W-003;3/8;exports/202608262224.md;4/8;apps/search-api/integration/sequence/_repro-w004.test.ts;exports/202608270742.md;dailywork/2026-08-27_PR-Search-WP-035-;pr-search/202608271346.md;5/8;docs/README.md

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=9e409c200865d8a5b16781bafe022b66042d966f7ace23cbaff3f8b82d9ebadf
bytes=62897 compact_bytes=62639 lines=1093 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 이 세션의 목표 > 이 세션의 핵심 발견 > 완료한 것 (전부 main 병합) > 반복해서 나타난 패턴 — 머지 후 리뷰 > 현재 상태 한 줄
sig=agent-context/session-summary.md;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7;4/8;25/200;close/reopen;Docker/WSL;5/8;agent-context/_handoff/context-index.md;W-001/W-008;6/8;API-ADM-001/006;7/8

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=a2b52fd0bac7b64b916406b44ea48cab21fcbcfc73053626a0d7844756c000d8
bytes=102533 compact_bytes=101879 lines=1306 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 시작하기 전에 — 이 인계의 값을 실측하라 > A. 지금 당장 — REL-006 (WP-041 → WP-042 → WP-044) > B. 새로 열린 WP — WP-069 작성자 소속 팀 채우기 > C. 배포에서 해야 할 것 > D. GitHub Actions — pr-search만 결제 차단이다
sig=agent-context/todos.md;4/4;docs/40_delivery/pr_search_implementation_traceability.md;packages/query/src/serialize.ts;apps/pipeline-worker/src/documents.ts;packages/es/src/upsert.ts;apps/pipeline-worker/src/reconcile.ts;apps/search-api/src/ops/jobs.ts;packages/react/src/form.tsx;scripts/check-release-tags.mjs;89sooner/pr-search;89sooner/design-system;apps/web/lib/;apps/web/components/JobStatusBadge.tsx;apps/search-api/integration/admin/repositories.test.ts;apps/web/a11y/setup.ts;claude/wp-040-operations-console;3/4;apps/web/app/ops/;apps/web/app/ops/audit/page.tsx;up/down/up;packages/db/src/repositories/job.ts;packages/domain/src/sequence.ts;apps/search-api/src/ops/registration-request-cursor.ts

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
