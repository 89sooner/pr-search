# agent-context-index:v1
generated=2026-08-26T03:52:06+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=20 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,10/11,Risks/gotchas,docs/00_governance/change_control.md,exports/202608260047.md,dailywork/2026-08-25_PR-Search-WP-028,exports/202608251453.md,exports/202608260113.md
- f3c6d32 p=20 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,10/11,CR/DEV,11/11,1/8,Search,REL,handoff
- f54408e p=25 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,1/8,docs/40_delivery/pr_search_work_packages.md,docs/00_governance/change_control.md,4/4,apps/web,docs/40_delivery/pr_search_implementation_traceability.md,exports/202608261008.md
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,lib/nav.ts,packages/domain/src/anchor.ts,packages/db,prs/query,apps/search-api/src/runtime.ts
- f5791b0 p=40 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,docs/10_requirements/srs_final.md,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,docs/40_delivery/pr_search_work_packages.md,apps/search-api/src/runtime.ts,apps/search-api/src/runtime.test.ts,regression/runtime-reachability.test.ts
- f7b39dc p=40 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,HOME/.nvm/versions/node/v22.23.2/bin,regression/runtime-reachability.test.ts,repos/89sooner/pr-search/pulls/,exports/202608260047.md,try/catch,docs/40_delivery/pr_search_implementation_traceability.md,DISTINCT
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,prs/web,web/lib/neighbors,sequence/neighbors,apps/web,/node_modules/.bin/playwright,e2e/flow-002.spec.ts

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=2464076dccc5e03da9b7ce8cf2bfaf631242d557f37e1927f1ec729b9cc682f3
bytes=20184 compact_bytes=20909 lines=427 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 필수 전제 — Node PATH > 검증 배터리 (전 계층, 마지막 실행 결과) > 함정: e2e는 빌드를 하지 않는다 > 실패했던 명령과 원인 > 환경 준비 (새 머신이라면)
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;prs/web;web/lib/neighbors;sequence/neighbors;apps/web;/node_modules/.bin/playwright;e2e/flow-002.spec.ts;prs-postgres/redis/elasticsearch;dist/cli.js;9200/_cat/indices;repos/89sooner/pr-search/pulls/33/comments;pass/fail;dev/null;docs/00_governance/change_control.md;home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;ops/sequence-integrity;pipeline-worker/integration/sequence/repair;authz/team-scope;packages/authz/src/team-scope;search-api/src/runtime;repos/89sooner/pr-search/pulls/;acme/payments;acme/integrity-wp028

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=0269b15c06ed93cc80ce3e50eea4c12980e92148b255c178ed1f8cad6269c3b3
bytes=28898 compact_bytes=26389 lines=263 priority=28
heads=확정한 설계 결정과 이유 > CR-030 (WP-026 / W-005) — 2026-08-25 closed > DEV-160 (구현 중 발견, CR 불필요) — 판정을 하나로 모았다 > CR-031 (WP-027 / 선행·후행) — 2026-08-25 closed, SRS v2.4 > 서수를 URL 앵커로 넘길 때 — seq: 접두는 필수다 > 시험 방법에 관한 결정
sig=agent-context/decisions.md;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;change_control;pr_search_implementation_traceability;DEV;GET;releases;API;REL;containments;release;comparisons;SEQ

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=ddaf1bf5e5d77cd72d2de381a8bac08c5f7ad3a43653f566d154a8668a347382
bytes=15227 compact_bytes=16256 lines=207 priority=40
heads=중요 파일 경로와 역할 > 이 저장소를 읽는 순서 (문서) > 이 세션에서 만든 소스 (CR-032~036) > 운영 배선 · 도달성 > WP-028 (정합성 점검 · 조정 스캔) > WP-068 (팀 접근 범위)
sig=agent-context/files.md;docs/10_requirements/srs_final.md;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;docs/40_delivery/pr_search_work_packages.md;apps/search-api/src/runtime.ts;apps/search-api/src/runtime.test.ts;regression/runtime-reachability.test.ts;deploy/k8s/pipeline-worker-sequence.yaml;deploy/k8s/pipeline-worker-reconcile.yaml;packages/domain/src/integrity.ts;packages/db/src/repositories/integrity.ts;apps/search-api/src/ops/sequence-integrity.ts;apps/pipeline-worker/src/integrity.ts;apps/pipeline-worker/src/reconcile.ts;apps/pipeline-worker/src/consistency.ts;apps/pipeline-worker/src/snapshot.ts;apps/pipeline-worker/src/sequence-repair-runner.ts;apps/pipeline-worker/src/sequence.ts;packages/db/migrations/009_job_type_reassign;packages/db/migrations/010_pr_snapshot;packages/authz/src/team-scope.ts;packages/db/migrations/011_repository_teams;packages/github/src/client.ts

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=c748ccdb116b37c0e89f47ccca5307e3c7bfc6c4748944305acce7256cb24c41
bytes=20639 compact_bytes=20952 lines=360 priority=40
heads=리스크 · 불확실한 가정 · 함정 > 절차 함정 (이 세션에서 실제로 밟은 것들) > 등가 변이를 킬로 착각하지 마라 — 두 WP 연속으로 나왔다 > lint는 마지막 파일을 쓴 뒤에 다시 돌려라 > 대역(mock)이 실제보다 관대하면 그만큼이 사각지대다 > 임시 컨테이너에서는 슬라이스마다 커밋하라
sig=agent-context/risks.md;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;DISTINCT;pull_request_number;NOT;NULL;expected;Node;e2e;Codex;v20;install;visitor;engines;v22;a11y;require;ESM;PATH

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=a82a9e1616bcdde0128731f5ce62b222179565b8f4aee673916f9f757a92321a
bytes=11658 compact_bytes=12099 lines=243 priority=20
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Goal > Current state > Decisions > Changed files > Commands
sig=agent-context/session-notes.md;10/11;Risks/gotchas;docs/00_governance/change_control.md;exports/202608260047.md;dailywork/2026-08-25_PR-Search-WP-028;exports/202608251453.md;exports/202608260113.md;11/11;exports/202608261008.md;1/8;Session;Goal;correction;GitHub;production;Current;SRS;baseline;DEV;REL;Decisions;sequence_space;ADMIN

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=05de5eb045e1434471d645a1ce7687130b155a2f528177c2c17bca8d2e5ebd91
bytes=9318 compact_bytes=9783 lines=180 priority=20
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 이 세션의 목표 > 이 세션의 핵심 발견 > 완료한 것 (전부 main 병합) > 반복해서 나타난 패턴 — 머지 후 리뷰 > 현재 상태 한 줄
sig=agent-context/session-summary.md;10/11;CR/DEV;11/11;1/8;Search;REL;handoff;API;ADM;runtime;reachability;DEV;SRS;a620899;b55b275;ea2663d;manifest;Codex;baseline;bc0e931;SHA;exports;gitignore

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=586e260628301fe2916230d59eb0dd5934ec404a35490f8075fbb2d8e49d8275
bytes=11586 compact_bytes=12066 lines=167 priority=25
heads=다음 작업 · 미해결 항목 · 확인할 사항 > A. 지금 당장 — WP-030 착수 전 계약 감사 (REL-004) > B. 릴리스 게이트 4·5·6 (REL-003 미통과 사유) > C. 미뤄 둔 항목 (별도 CR) > D. 확인할 사항 > 이전 세션 기록 (보존)
sig=agent-context/todos.md;1/8;docs/40_delivery/pr_search_work_packages.md;docs/00_governance/change_control.md;4/4;apps/web;docs/40_delivery/pr_search_implementation_traceability.md;exports/202608261008.md;claude/cr-031-wp-027;claude/cr-037-post-merge-correctness;claude/cr-038-wp-067-commit-metadata;claude/rel-003-closure;10/11;apps/pipeline-worker/src/sequence.ts;apps/pipeline-worker/src/consistency.ts;packages/es/src/scoped-query.ts;apps/pipeline-worker/src/sequence-repair-runner.ts;exports/202608260047.md;exports/202608251453.md;ea917b8;SRS;baseline;DEV;REL

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
