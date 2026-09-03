# agent-context-index:v1
generated=2026-09-03T08:45:56+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=7
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,Risks/gotchas,agent-context/count-unresolved-reviews.py,10/11,docs/00_governance/change_control.md,exports/202608260047.md,dailywork/2026-08-25_PR-Search-WP-028,exports/202608251453.md
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,refs/tags/,git/refs,10/11,CR/DEV,11/11,1/8,2/8
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,refs/tags/,git/refs,apps/web,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,lib/nav.ts,packages/domain/src/anchor.ts
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,home/roqkf/design-system,agent-context/count-unresolved-reviews.py,89sooner/pr-search,git/refs,refs/tags/,regression/release-tag-ownership.test.ts,docs/40_delivery/pr_search_implementation_traceability.md
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,/remote.git,refs/heads/main,refs/tags/v1,repos/89sooner/pr-search/git/refs,refs/tags/0.1.0-pilot.2,regression/release-tag-ownership.test.ts,actions/runs/
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,deploy/single-host/build-bundle.sh,git/refs,refs/tags/,regression/release-tag-ownership.test.ts,regression/fixtures/release-tag/,regression/runtime-reachability.test.ts,apps/web/package.json
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,refs/tags/,usr/bin/env,origin/main,HOME/.nvm/versions/node/v22.23.2/bin,regression/runtime-reachability.test.ts,repos/89sooner/pr-search/pulls/,exports/202608260047.md

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=8ed521e2797b1936278b2fe372d250380c030ffa4af2434edc38a0010910d6ad
bytes=145483 compact_bytes=148672 lines=2903 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-03 2차 라운드에서 쓴 것 > 미해결 스레드의 id·경로·본문을 전량 덤프 (scratchpad의 threads.py) > 답변 + resolve (scratchpad의 reply.py) > 이미 있는 태그로 시도하면 422를 내고 아무것도 바꾸지 않는다 > 판정은 exit 0이 아니라 "이 변경이 새 issue를 만들지 않았는가"로 쓴다 — 이전 커밋을 worktree로 꺼내 비교한다
sig=agent-context/commands.md;/remote.git;refs/heads/main;refs/tags/v1;repos/89sooner/pr-search/git/refs;refs/tags/0.1.0-pilot.2;regression/release-tag-ownership.test.ts;actions/runs/;claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;tmp/before;home/roqkf/design-system;conductor-by-89soone/tokens;tokens/dist;conductor-by-89soone/css;packages/tokens/bin/;home/roqkf/pr-search/apps/web/package.json;playwright/test;node_modules/.pnpm;esbuild/linux-x64/bin/esbuild;/node_modules/.bin/next;origin/main;HOME/.nvm/versions/node/v22.23.2/bin;prs/web;web/lib/neighbors

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=d6344132ffc35ff1cb778bbfd87d8e0b2b23cfa7d907bb98a2b8343ffa964471
bytes=177582 compact_bytes=155848 lines=1532 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-03 2차 — 리뷰 부채 종결 (CR-037·CR-038 / CR-064 / DEV-035~041 / DEV-541~543) > 2026-09-03 애니메이션·폴리시 라운드 (DEV-028~034 / DEV-538~540) > CR-030 (WP-026 / W-005) — 2026-08-25 closed > DEV-160 (구현 중 발견, CR 불필요) — 판정을 하나로 모았다 > CR-031 (WP-027 / 선행·후행) — 2026-08-25 closed, SRS v2.4
sig=agent-context/decisions.md;refs/tags/;git/refs;apps/web;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md;origin/main;packages/query/src/keys.ts;deploy/k8s/pipeline-worker-batch.yaml;prs/es;prs/db

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=a55601bb513369facef04f4b8b8dcb2b0b005cc5245a58c472c138f66df75218
bytes=116934 compact_bytes=114942 lines=1403 priority=45
heads=중요 파일 경로와 역할 > 2026-09-03 2차 라운드가 만지거나 만든 것 > 2026-09-03 라운드가 만지거나 만든 것 > 이 저장소를 읽는 순서 (문서) > 이 세션에서 만든 소스 (CR-032~036) > 운영 배선 · 도달성
sig=agent-context/files.md;deploy/single-host/build-bundle.sh;git/refs;refs/tags/;regression/release-tag-ownership.test.ts;regression/fixtures/release-tag/;regression/runtime-reachability.test.ts;apps/web/package.json;docs/20_derived_ui_specs/pr_search_design_system_tokens.md;packages/css/src/components.css;packages/css/test/bundle.test.ts;scripts/check-release-tags.mjs;scripts/check-release-tags.test.mjs;github/workflows/release.yml;docs/10_requirements/srs_final.md;docs/20_derived_ui_specs/conductor_ui_component_spec.md;docs/00_governance/change_control.md;docs/40_delivery/conductor_implementation_traceability.md;apps/web/app/layout.tsx;apps/web/e2e/shell.spec.ts;apps/web/components/;packages/tokens/src/primitives.ts;packages/css/src/reset.css;packages/css/src/base.css

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=c855a9542f071687c9e2162493a43d8d48b696d360128fa4d56960f03dbfbd58
bytes=148105 compact_bytes=144951 lines=2038 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-03 2차 라운드가 새로 배운 함정 > 게이트의 위치가 실패의 대가를 정한다 — 가장 값비쌌던 것 > 지시받은 해법이 통하지 않을 수 있다 — 쓰기 전에 재라 > 한 정정이 다음 구멍을 연다 — 릴리스 게이트를 네 번 고쳤다 > 문서가 코드보다 넓게 말하면 그것도 결함이다
sig=agent-context/risks.md;refs/tags/;usr/bin/env;origin/main;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;apps/web;4/4;7/7;tmp/.../baseline-integration.log;prs/web;close/reopen;actions/runs;Docker/WSL;deploy/k8s/README.md;worker/link.test.ts

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=035a788389b19469cd8abdb23ea98667e3b8dee274bf77374b49026e60fc978a
bytes=132825 compact_bytes=132263 lines=2104 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-03 (2차) — 리뷰 부채 종결과 Conductor 0.3.1 > Goal > Current state > 리뷰는 아홉 건에서 끝나지 않았다 > 리뷰 아홉 건의 판정 (시작 시점)
sig=agent-context/session-notes.md;Risks/gotchas;agent-context/count-unresolved-reviews.py;10/11;docs/00_governance/change_control.md;exports/202608260047.md;dailywork/2026-08-25_PR-Search-WP-028;exports/202608251453.md;exports/202608260113.md;11/11;exports/202608261008.md;1/8;2/8;exports/202608262010.md;dailywork/2026-08-26_PR-Search-OD-005-;W-002/W-003;3/8;exports/202608262224.md;4/8;apps/search-api/integration/sequence/_repro-w004.test.ts;exports/202608270742.md;dailywork/2026-08-27_PR-Search-WP-035-;pr-search/202608271346.md;5/8

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=d0ef06c7957827d2a58b7b0912045c9e014ea7346f83956952ec81a832344e54
bytes=88579 compact_bytes=88163 lines=1418 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-03 (2차) — 리뷰 부채 종결 라운드 > 이 세션의 목표 > 핵심 발견 > 완료한 것 > 반복해서 나타난 패턴
sig=agent-context/session-summary.md;refs/tags/;git/refs;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7;4/8;25/200;close/reopen;Docker/WSL;5/8;agent-context/_handoff/context-index.md;W-001/W-008;6/8

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=e931657cb0dd36b78d57fc8d0de6eef9a86c86fbcd98d4b28e152e4d46cf9f14
bytes=146751 compact_bytes=145093 lines=1785 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > A. 지금 당장 — 실제 사내 반입 (0.1.0-pilot.2) > B. 미뤄 둔 것 — 이전과 같다 > C. 릴리스 게이트 4·5·6 — 릴리스는 승인되지 않았다 > D. 이 라운드가 깔아 둔 자리 — 다시 만들지 말 것 > 시작하기 전에 — 이 인계의 값을 실측하라
sig=agent-context/todos.md;home/roqkf/design-system;agent-context/count-unresolved-reviews.py;89sooner/pr-search;git/refs;refs/tags/;regression/release-tag-ownership.test.ts;docs/40_delivery/pr_search_implementation_traceability.md;conductor-by-89soone/css;2/4;deploy/single-host/;/deploy/single-host/build-bundle.sh;releases/tags/;deploy/single-host;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.2;vendor/upstream;company/main;24/24;deploy/single-host/RUNBOOK.md;deploy/single-host/bundle/pr-search-;deploy/single-host/.env.example;/prsctl;deploy/single-host/prsctl;GET/POST/DELETE

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
