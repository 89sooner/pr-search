# agent-context-index:v1
generated=2026-09-10T15:48:39+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,host/db,Risks/gotchas,github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.3,claude/first-internal-import-findings,agent-context/_handoff,api/v1/webhooks/github,apps/web
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,refs/tags/,git/refs,10/11,CR/DEV,11/11,1/8,2/8
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,commit/PR/,apps/web,refs/tags/,git/refs,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,lib/nav.ts
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,origin/main,docs/40_delivery/pr_search_work_packages.md,apps/pipeline-worker/src/mirror-runner.ts,apps/pipeline-worker/src/sequence-plan.ts,docs/cr077-m-number,host/db,6.72.4/6.72.5
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,docs/30_technical_architecture/pr_search_async_events_jobs.md,packages/github/src/mirror-graph.ts,docs/cr077-m-number,origin/main,claude/skills/obsidian-second-brain/scripts/worklog.py,/deploy/single-host/build-bundle.sh,/pr-search-
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,docs/00_governance/change_control.md,docs/10_requirements/srs_final.md,docs/40_delivery/pr_search_work_packages.md,docs/30_technical_architecture/pr_search_architecture_decision_records.md,docs/30_technical_architecture/pr_search_data_model.md,docs/30_technical_architecture/pr_search_async_events_jobs.md,docs/30_technical_architecture/pr_search_api_contracts.md
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,docs/20_derived_ui_specs/pr_search_product_ia.md,apps/web,refs/tags/,usr/bin/env,origin/main,HOME/.nvm/versions/node/v22.23.2/bin,regression/runtime-reachability.test.ts

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=8fc3d965576a296aa3275d824839f3d94d684d2d34322c5511d72104b468ee6c
bytes=156908 compact_bytes=160795 lines=3146 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-11 라운드에서 쓴 것 (CR-077 문서 캐스케이드) > ID 실측 — 새 ID를 잡기 전에 반드시 > 방금 편집한 파일을 제외해야 자기가 쓴 값이 걸리지 않는다 > 캐스케이드 검증 > 신규 ID가 전부 등록되어 상호 참조되는가
sig=agent-context/commands.md;docs/30_technical_architecture/pr_search_async_events_jobs.md;packages/github/src/mirror-graph.ts;docs/cr077-m-number;origin/main;claude/skills/obsidian-second-brain/scripts/worklog.py;/deploy/single-host/build-bundle.sh;/pr-search-;-offline/deploy/single-host;/prsctl;vendor/upstream;repos/89sooner/pr-search/releases/tags/;refs/tags/;tmp/sim;prs/web;apps/web;/node_modules/.bin/playwright;e2e/flow-003.spec.ts;14/14;deploy/single-host/prsctl;OUT/.next/cache;OUT/e2e;OUT/a11y;OUT/test-results

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=a023be4ce970bb7afb22785cf583d6a2fac8cffba20cb0fe11ab0fb0a981418f
bytes=189041 compact_bytes=166372 lines=1580 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-11 — CR-077 M 넘버 (설계 결정) > 2026-09-08 (2차) — 0.1.0-pilot.3 발행 (CR-068 · CR-069 / DEV-555~558) > 2026-09-08 — 첫 사내 반입 반영 (CR-066 / DEV-548~553) > 2026-09-03 2차 — 리뷰 부채 종결 (CR-037·CR-038 / CR-064 / DEV-035~041 / DEV-541~543) > 2026-09-03 애니메이션·폴리시 라운드 (DEV-028~034 / DEV-538~540)
sig=agent-context/decisions.md;commit/PR/;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md;origin/main;packages/query/src/keys.ts;deploy/k8s/pipeline-worker-batch.yaml;prs/es

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=a828bf06fcce189407a1812b557a521becb57268465cc20f7eb6acfdad8ba229
bytes=126660 compact_bytes=124596 lines=1497 priority=45
heads=중요 파일 경로와 역할 > 2026-09-11 라운드가 만진 것 (CR-077 M 넘버 — 문서 21개, 코드 0) > 정본 — 여기부터 읽는다 > 설계 > 나머지 > 구현할 때 읽어야 할 코드 (이번에 수정하지 않았다)
sig=agent-context/files.md;docs/00_governance/change_control.md;docs/10_requirements/srs_final.md;docs/40_delivery/pr_search_work_packages.md;docs/30_technical_architecture/pr_search_architecture_decision_records.md;docs/30_technical_architecture/pr_search_data_model.md;docs/30_technical_architecture/pr_search_async_events_jobs.md;docs/30_technical_architecture/pr_search_api_contracts.md;docs/30_technical_architecture/pr_search_security_privacy_architecture.md;docs/10_requirements/;docs/20_derived_ui_specs/;docs/40_delivery/;apps/pipeline-worker/src/mirror-runner.ts;apps/pipeline-worker/src/sequence.ts;apps/pipeline-worker/src/sequence-plan.ts;packages/github/src/commit-graph.ts;packages/github/src/mirror-graph.ts;packages/db/migrations/;apps/ingest-gateway/src/server.ts;deploy/single-host/prsctl;host/db;deploy/single-host/RUNBOOK.md;deploy/single-host/.env.example;deploy/single-host/bundle/pr-search-0.1.0-pilot.3-offline

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=49680237e8ca6158f7f9cedb1a37f4eaa8dd40c767ecdc742b84d0729e3e2215
bytes=159916 compact_bytes=156653 lines=2196 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-11 라운드가 배운 함정 (CR-077 M 넘버) > 승인된 문서가 존재하지 않는 ID를 가리킬 수 있다 — 가장 값비쌌던 것 > 같은 개념에 두 이름이 붙는다 > 새 ID를 잡기 전에 반드시 실측한다 (또 걸렸다) > 결정할 사람이 없는 질문을 오픈 결정으로 열지 마라
sig=agent-context/risks.md;docs/20_derived_ui_specs/pr_search_product_ia.md;apps/web;refs/tags/;usr/bin/env;origin/main;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;4/4;7/7;tmp/.../baseline-integration.log;prs/web;close/reopen;actions/runs;Docker/WSL;deploy/k8s/README.md

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
sha256=a1daf0ff2470a1540852ec2584f5b4a0e35b03ff5cf7c0779ccc5c49b6be274e
bytes=97175 compact_bytes=96525 lines=1529 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-11 — CR-077 M 넘버 도입 (문서 캐스케이드, 코드 변경 없음) > 이 세션의 목표 > 결과 > 이 세션이 뒤집은 판단 — 다시 논쟁하지 마라 > 작업 방식
sig=agent-context/session-summary.md;refs/tags/;git/refs;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7;4/8;25/200;close/reopen;Docker/WSL;5/8;agent-context/_handoff/context-index.md;W-001/W-008;6/8

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=fce7f513ab778de05cb3973c0a33c0be073be40e122f3ccbd24652942905e399
bytes=158171 compact_bytes=132907 lines=1946 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 시작하기 전에 실측할 것 > 다음 작업 — WP-074 (M 넘버 채번과 조회) > 그다음 — WP-075 (PR 제목 M 넘버 표기) > 확인이 필요한 것 > A. 지금 당장 — 결정자 조치
sig=agent-context/todos.md;origin/main;docs/40_delivery/pr_search_work_packages.md;apps/pipeline-worker/src/mirror-runner.ts;apps/pipeline-worker/src/sequence-plan.ts;docs/cr077-m-number;host/db;6.72.4/6.72.5;agent-context/count-unresolved-reviews.py;89sooner/pr-search;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.3;claude/first-internal-import-findings;company/main;docs/40_delivery/pr_search_implementation_traceability.md;home/roqkf/design-system;git/refs;refs/tags/;regression/release-tag-ownership.test.ts;conductor-by-89soone/css;2/4;deploy/single-host/;/deploy/single-host/build-bundle.sh;releases/tags/;deploy/single-host

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
