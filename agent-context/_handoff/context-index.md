# agent-context-index:v1
generated=2026-08-25T05:44:18+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=20 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-WP-026-완료-WP-027-완료-WP-028-감사 sig=agent-context/session-notes.md,SRS/CR/,claude/cr-031-wp-027,8/11,A/B,Risks/gotchas,docs/00_governance/change_control.md,Session
- f3c6d32 p=30 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25 sig=agent-context/session-summary.md,agent-context/todos.md,claude/cr-031-wp-027,Search,Claude,REL,DEV,API
- f0b2764 p=33 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,lib/nav.ts,packages/domain/src/anchor.ts,change_control,pr_search_implementation_traceability,DEV
- f54408e p=35 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,claude/cr-031-wp-027,API-SEQ-006/CR-029,GET/POST,admin/sequence-integrity,3/3,Codex,checkout
- f527103 p=50 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,prs/web,web/lib/neighbors,sequence/neighbors,apps/web,/node_modules/.bin/playwright,e2e/flow-002.spec.ts
- f5791b0 p=50 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,packages/db/src/repositories/release.ts,apps/search-api/src/sequence/releases-list.ts,apps/search-api/src/sequence/release-comparison.ts,apps/web/lib/release.ts,apps/web/components/ReleaseTimeline.tsx,apps/web/components/ReleasesView.tsx,apps/web/app/releases/page.tsx
- f7b39dc p=50 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,HOME/.nvm/versions/node/v22.23.2/bin,DISTINCT,pull_request_number,NOT,NULL,expected,Node

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=e5145ac2cea76482174bc99114c30e078c55b490222d327c22ca6afd01e8d63d
bytes=4584 compact_bytes=5158 lines=101 priority=50
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 필수 전제 — Node PATH > 검증 배터리 (전 계층, 마지막 실행 결과) > 함정: e2e는 빌드를 하지 않는다 > 실패했던 명령과 원인 > 환경 준비 (새 머신이라면)
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;prs/web;web/lib/neighbors;sequence/neighbors;apps/web;/node_modules/.bin/playwright;e2e/flow-002.spec.ts;prs-postgres/redis/elasticsearch;dist/cli.js;9200/_cat/indices;repos/89sooner/pr-search/pulls/33/comments;pass/fail;dev/null;docs/00_governance/change_control.md;Node;PATH;v20;install;HOME;versions;v22;typecheck;skipped

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=e90a4a31097fec7bb36e82311edcfde577af1b80ef0b95e05bb2cd2bc7b13a8e
bytes=6127 compact_bytes=6700 lines=67 priority=33
heads=확정한 설계 결정과 이유 > CR-030 (WP-026 / W-005) — 2026-08-25 closed > DEV-160 (구현 중 발견, CR 불필요) — 판정을 하나로 모았다 > CR-031 (WP-027 / 선행·후행) — 2026-08-25 closed, SRS v2.4 > 서수를 URL 앵커로 넘길 때 — seq: 접두는 필수다 > 시험 방법에 관한 결정
sig=agent-context/decisions.md;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;change_control;pr_search_implementation_traceability;DEV;GET;releases;API;REL;containments;release;comparisons;SEQ;runRange;unreleased;W005;empty_no_release;not_indexed;repository;findContainingReleases;findLatestReleaseSeq

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=70a8fef8955d21862808c577a5da70fdb9678ad2c7ea3a023b125d01f451c807
bytes=4377 compact_bytes=5449 lines=68 priority=50
heads=중요 파일 경로와 역할 > 이 세션에서 만든/고친 소스 > WP-026 (PR #32, 머지됨) > WP-027 (PR #33, 열림) > 시험 > 이 저장소를 읽는 순서 (문서)
sig=agent-context/files.md;packages/db/src/repositories/release.ts;apps/search-api/src/sequence/releases-list.ts;apps/search-api/src/sequence/release-comparison.ts;apps/web/lib/release.ts;apps/web/components/ReleaseTimeline.tsx;apps/web/components/ReleasesView.tsx;apps/web/app/releases/page.tsx;packages/db/src/repositories/merge-sequence.ts;before/anchor/after;apps/search-api/src/sequence/neighbors.ts;apps/web/lib/neighbors.ts;apps/web/components/NeighborSequenceList.tsx;apps/web/components/PrDetailView.tsx;apps/web/components/CommitDetailView.tsx;apps/search-api/src/sequence/routes.ts;apps/search-api/integration/release/timeline.test.ts;apps/search-api/integration/release/containment.test.ts;apps/search-api/integration/sequence/neighbors.test.ts;apps/search-api/src/sequence/range.test.ts;apps/web/lib/;apps/web/a11y/;apps/web/e2e/;docs/10_requirements/srs_final.md

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=9d6c26fabdc4f2fa7c942e54b1427003b01c63bf035af0b06f4bb15c486d9c11
bytes=4500 compact_bytes=4734 lines=82 priority=50
heads=리스크 · 불확실한 가정 · 함정 > 절차 함정 (이 세션에서 실제로 밟은 것들) > 등가 변이를 킬로 착각하지 마라 — 두 WP 연속으로 나왔다 > lint는 마지막 파일을 쓴 뒤에 다시 돌려라 > 대역(mock)이 실제보다 관대하면 그만큼이 사각지대다 > 임시 컨테이너에서는 슬라이스마다 커밋하라
sig=agent-context/risks.md;HOME/.nvm/versions/node/v22.23.2/bin;DISTINCT;pull_request_number;NOT;NULL;expected;Node;e2e;Codex;v20;install;visitor;engines;v22;a11y;require;ESM;PATH;HOME;versions;prs_test;chromium;unknown

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=eada545088508ab61a599e6c9db184ac543330126d082db0855114e321ce1401
bytes=2635 compact_bytes=3130 lines=66 priority=20
heads=Session: 2026-08-25 — WP-026 완료 · WP-027 완료 · WP-028 감사 > Goal > Current state > Decisions > Changed files > Commands
sig=agent-context/session-notes.md;SRS/CR/;claude/cr-031-wp-027;8/11;A/B;Risks/gotchas;docs/00_governance/change_control.md;Session;Goal;REL;SRS;Current;Decisions;DEV;API;ADR;Changed;ad12649;SEQ;f81ba44;ef3040a;Codex;GET;sequence

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=0d73d44655421a3c597f7070042ac1634342218f2775baf00e967dc952654032
bytes=3030 compact_bytes=3517 lines=62 priority=30
heads=세션 요약 — PR Search 구현 (2026-08-25) > 이 세션의 목표 > 시작 지점에서 발견한 것 (중요) > 완료한 것 > WP-026 W-005 릴리스 화면 (PR #32, 머지됨 — main 7c7b180) > WP-027 선행·후행 (PR #33, 열림 · CI 초록 · draft)
sig=agent-context/session-summary.md;agent-context/todos.md;claude/cr-031-wp-027;Search;Claude;REL;DEV;API;GET;releases;release;comparisons;SEQ;runRange;ReleaseTimeline;Codex;srs_final;NFR;sequence;neighbors;NeighborSequenceList;W002;Node;v20

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=f6b9251d1006bb7c07d38ca4b7a64ea8106c785356892f0ab2127b6260098153
bytes=4890 compact_bytes=5332 lines=69 priority=35
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 지금 당장 (블로킹) > PR #33 머지 대기 > WP-028 ②번 결정 — 사용자 답변 대기 중 > WP-028 착수 감사 결과 (CR-032로 등록할 것) > WP-028 구현 순서 (CR-032 캐스케이드 후)
sig=agent-context/todos.md;claude/cr-031-wp-027;API-SEQ-006/CR-029;GET/POST;admin/sequence-integrity;3/3;Codex;checkout;unknown;srs_final;ADMIN;SRS;check_failed;sequence_space_state_chk;DEV;job_type_chk;sequence_reassign;API;ADM;CHECK;SEQ;affected_saved_search_count;saved_search;JOB

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
