# agent-context-index:v1
generated=2026-08-25T16:13:35+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=20 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,10/11,Risks/gotchas,docs/00_governance/change_control.md,exports/202608260047.md,dailywork/2026-08-25_PR-Search-WP-028,exports/202608251453.md,exports/202608260113.md
- f3c6d32 p=20 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,10/11,CR/DEV,Search,REL,handoff,API,ADM
- f0b2764 p=23 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,lib/nav.ts,packages/domain/src/anchor.ts,packages/db,prs/query,apps/search-api/src/runtime.ts
- f54408e p=25 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,10/11,apps/pipeline-worker/src/sequence.ts,apps/pipeline-worker/src/consistency.ts,packages/es/src/scoped-query.ts,apps/pipeline-worker/src/sequence-repair-runner.ts,docs/40_delivery/pr_search_work_packages.md,exports/202608260047.md
- f527103 p=40 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,prs/web,web/lib/neighbors,sequence/neighbors,apps/web,/node_modules/.bin/playwright,e2e/flow-002.spec.ts
- f5791b0 p=40 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,docs/10_requirements/srs_final.md,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,docs/40_delivery/pr_search_work_packages.md,apps/search-api/src/runtime.ts,apps/search-api/src/runtime.test.ts,regression/runtime-reachability.test.ts
- f7b39dc p=40 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,HOME/.nvm/versions/node/v22.23.2/bin,regression/runtime-reachability.test.ts,repos/89sooner/pr-search/pulls/,exports/202608260047.md,DISTINCT,pull_request_number,NOT

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=d2266836bd71a6a2544a6ab791425f9c10e538bf3a1dd47b721a95247da6623f
bytes=11164 compact_bytes=12016 lines=249 priority=40
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 필수 전제 — Node PATH > 검증 배터리 (전 계층, 마지막 실행 결과) > 함정: e2e는 빌드를 하지 않는다 > 실패했던 명령과 원인 > 환경 준비 (새 머신이라면)
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;prs/web;web/lib/neighbors;sequence/neighbors;apps/web;/node_modules/.bin/playwright;e2e/flow-002.spec.ts;prs-postgres/redis/elasticsearch;dist/cli.js;9200/_cat/indices;repos/89sooner/pr-search/pulls/33/comments;pass/fail;dev/null;docs/00_governance/change_control.md;home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;ops/sequence-integrity;pipeline-worker/integration/sequence/repair;authz/team-scope;packages/authz/src/team-scope;search-api/src/runtime;repos/89sooner/pr-search/pulls/;acme/payments;acme/integrity-wp028

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=43481f230d8ad997ca5de3f8fc93f9a85509b8010eb99aa00081b4541108a8a8
bytes=16429 compact_bytes=15679 lines=165 priority=23
heads=확정한 설계 결정과 이유 > CR-030 (WP-026 / W-005) — 2026-08-25 closed > DEV-160 (구현 중 발견, CR 불필요) — 판정을 하나로 모았다 > CR-031 (WP-027 / 선행·후행) — 2026-08-25 closed, SRS v2.4 > 서수를 URL 앵커로 넘길 때 — seq: 접두는 필수다 > 시험 방법에 관한 결정
sig=agent-context/decisions.md;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;change_control;pr_search_implementation_traceability;DEV;GET;releases;API;REL;containments;release;comparisons;SEQ;runRange;unreleased;W005

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=459dbc413f145a0dd417138f65bd0b792d031b0683a062bba50665cc3865160d
bytes=6639 compact_bytes=7751 lines=98 priority=40
heads=중요 파일 경로와 역할 > 이 저장소를 읽는 순서 (문서) > 이 세션에서 만든 소스 (CR-032~036) > 운영 배선 · 도달성 > WP-028 (정합성 점검 · 조정 스캔) > WP-068 (팀 접근 범위)
sig=agent-context/files.md;docs/10_requirements/srs_final.md;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;docs/40_delivery/pr_search_work_packages.md;apps/search-api/src/runtime.ts;apps/search-api/src/runtime.test.ts;regression/runtime-reachability.test.ts;deploy/k8s/pipeline-worker-sequence.yaml;deploy/k8s/pipeline-worker-reconcile.yaml;packages/domain/src/integrity.ts;packages/db/src/repositories/integrity.ts;apps/search-api/src/ops/sequence-integrity.ts;apps/pipeline-worker/src/integrity.ts;apps/pipeline-worker/src/reconcile.ts;apps/pipeline-worker/src/consistency.ts;apps/pipeline-worker/src/snapshot.ts;apps/pipeline-worker/src/sequence-repair-runner.ts;apps/pipeline-worker/src/sequence.ts;packages/db/migrations/009_job_type_reassign;packages/db/migrations/010_pr_snapshot;packages/authz/src/team-scope.ts;packages/db/migrations/011_repository_teams;packages/github/src/client.ts

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=fbfba7ae18be0330d398a7f85dfa87aa3d531ad5f5a55eab4f5eec95baa29b1c
bytes=9933 compact_bytes=10151 lines=181 priority=40
heads=리스크 · 불확실한 가정 · 함정 > 절차 함정 (이 세션에서 실제로 밟은 것들) > 등가 변이를 킬로 착각하지 마라 — 두 WP 연속으로 나왔다 > lint는 마지막 파일을 쓴 뒤에 다시 돌려라 > 대역(mock)이 실제보다 관대하면 그만큼이 사각지대다 > 임시 컨테이너에서는 슬라이스마다 커밋하라
sig=agent-context/risks.md;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;DISTINCT;pull_request_number;NOT;NULL;expected;Node;e2e;Codex;v20;install;visitor;engines;v22;a11y;require;ESM;PATH;HOME;versions

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=534e34f4f66deff9be5e14e8b274169a8411fa154c895db37fb78b6f7e2051c6
bytes=5330 compact_bytes=5826 lines=110 priority=20
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Goal > Current state > Decisions > Changed files > Commands
sig=agent-context/session-notes.md;10/11;Risks/gotchas;docs/00_governance/change_control.md;exports/202608260047.md;dailywork/2026-08-25_PR-Search-WP-028;exports/202608251453.md;exports/202608260113.md;Session;Goal;correction;GitHub;production;Current;SRS;baseline;DEV;REL;Decisions;sequence_space;ADMIN;check_failed;runtime;buildServerDeps

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=d74ec64a69a4894ff682e366450927b6bd0a00808440a883f19029b83debfc05
bytes=3469 compact_bytes=3900 lines=70 priority=20
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 이 세션의 목표 > 이 세션의 핵심 발견 > 완료한 것 (전부 main 병합) > 반복해서 나타난 패턴 — 머지 후 리뷰 > 현재 상태 한 줄
sig=agent-context/session-summary.md;10/11;CR/DEV;Search;REL;handoff;API;ADM;runtime;reachability;DEV;SRS;a620899;b55b275;ea2663d;manifest;Codex;baseline;bc0e931;SHA;exports;gitignore;context

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=87e056a4a806f9f2aa834cefe0d77b7a88de2463a48de5b523429bc8d02aff69
bytes=5295 compact_bytes=5756 lines=76 priority=25
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 지금 당장 — CR-037로 미해결 리뷰 9건 정정 (블로킹) > PR #37 (CR-034) — P1 4건 > PR #37 — P2 3건 > PR #36 · #38 — P2 2건 > WP-067 — 착수 전 계약 감사 필요 (CR 먼저)
sig=agent-context/todos.md;10/11;apps/pipeline-worker/src/sequence.ts;apps/pipeline-worker/src/consistency.ts;packages/es/src/scoped-query.ts;apps/pipeline-worker/src/sequence-repair-runner.ts;docs/40_delivery/pr_search_work_packages.md;exports/202608260047.md;exports/202608251453.md;SRS;baseline;DEV;REL;repairSequence;head_sha;seq_epoch;pipeline;sequence;extra_in_es;org_id;visibility;consistency;CANONICAL_FIELDS;packages

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
