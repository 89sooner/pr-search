# agent-context-index:v1
generated=2026-09-11T14:17:32+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=8
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,agent-context/upstream-feedback.md,packages/authz/src/github-oauth.ts,packages/authz/src/config.ts,apps/web/app/auth/callback/route.ts,apps/search-api/src/auth/registration.ts,Risks/gotchas,github.com/89sooner/pr-search/pull/172
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,agent-context/upstream-feedback.md,feature/wp074-squash-mnumber,tmp/pr-search-wp074-implementation,packages/authz/src/config.ts,prs/web,apps/web/instrumentation.ts,deploy/single-host/smoke-images.sh
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,prs/db,healthz/route.test.ts,commit/PR/,apps/web,refs/tags/,git/refs,docs/00_governance/change_control.md
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,home/roqkf/pr-search,origin/main,auth/callback,user/teams,fix/dev-561-git-ca-trust,feature/ghe-oauth-login,fix/smoke-gate-cr083
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,prs/web,packages/authz/src/github-oauth.ts,home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py,tmp/pr-search-bundle-main,origin/main,/deploy/single-host/build-bundle.sh
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,packages/authz/src/github-oauth.ts,user/teams,packages/authz/src/github-oauth.test.ts,apps/search-api/src/auth/registration.ts,apps/search-api/src/auth/registration.test.ts,apps/search-api/integration/authz/registration.test.ts,apps/web/app/auth/login/route.test.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,packages/authz/src/config.test.ts,apps/web/instrumentation.test.ts,deploy/single-host/smoke-images.sh,deploy/single-host/,origin/main,docs/20_derived_ui_specs/pr_search_product_ia.md,apps/web
- f3df0a8 p=50 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,certs/ghe-ca.crt,deploy/single-host/compose.yml,deploy/single-host/.env.example,deploy/single-host/RUNBOOK.md,docs/40_delivery/pr_search_implementation_traceability.md,auth/callback,OIDC/GHE

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=2908ea0b6e5b03eb2c8e570caa5bd3dc5856bfe7f60a4b407cfa908d6380dc6a
bytes=173164 compact_bytes=177042 lines=3471 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-11 (4차) 라운드에서 쓴 것 (CR-082 · CR-083 · 발행) > 전제 — Node 22 (앞 라운드와 같다) > 검증 배터리 (전부 실행했고 이 수치가 원장 6.78장의 정본이다) > 변이 시험 — 여섯 곳, 23종 전부 kill > 문서 검사기 (CR을 닫기 전에 반드시)
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;prs/web;packages/authz/src/github-oauth.ts;home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;tmp/pr-search-bundle-main;origin/main;/deploy/single-host/build-bundle.sh;tmp/pr-search-bundle-release;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.5;a11y/mnumber.test.tsx;scratchpad/mutate.py;prs/pipeline-worker;5432/prs_test;apps/pipeline-worker/dist/measure-cli.js;tmp/pr-search-bundle-out;checksums/SHA256SUMS;deploy/single-host;/prsctl;SP/bin/pnpm;usr/bin/env;home/roqkf/.nvm/versions/node/v22.23.2/bin/corepack;SP/bin;home/roqkf/.nvm/versions/node/v22.23.2/bin

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=aca982455a1ec3beb5bb4325bf1d770d5ef46dfb643a0fda806e10be128b2d91
bytes=203013 compact_bytes=178602 lines=1688 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-11 (4차) — 사내 GHE 직접 로그인 (CR-082 · CR-083) > 결정자가 확정해 준 것 (다시 열지 않는다) > 사내 제안을 그대로 쓰지 않은 자리 둘 — 근거는 승인된 계약이다 > 구현이 스스로 고른 것 > 리뷰를 거치며 바꾼 판단
sig=agent-context/decisions.md;prs/db;healthz/route.test.ts;commit/PR/;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md;origin/main;packages/query/src/keys.ts

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=3dc0dc625952d6a7c1feb3ac4dfdd6faab6a98db680037b75badcae41fae225f
bytes=138614 compact_bytes=136360 lines=1683 priority=45
heads=중요 파일 경로와 역할 > 2026-09-11 (4차) 라운드가 만진 것 (CR-082 · CR-083 — 48개 파일, 4,583줄) > 인증 — 새로 생긴 것 > 인증 — 고친 것 > 배포 정의와 게이트 > 회귀 — 두 대조가 이 판의 핵심이다
sig=agent-context/files.md;packages/authz/src/github-oauth.ts;user/teams;packages/authz/src/github-oauth.test.ts;apps/search-api/src/auth/registration.ts;apps/search-api/src/auth/registration.test.ts;apps/search-api/integration/authz/registration.test.ts;apps/web/app/auth/login/route.test.ts;apps/web/app/auth/callback/route.test.ts;packages/authz/src/config.ts;packages/authz/src/session.ts;apps/web/app/auth/login/route.ts;apps/web/app/auth/callback/route.ts;apps/web/lib/oidc-state.ts;apps/web/lib/server/config.ts;apps/search-api/src/auth/context.ts;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;deploy/single-host/smoke-images.sh;regression/fixtures/release-tag/fake-docker;regression/runtime-reachability.test.ts;apps/web/lib/server/config.test.ts;docs/10_requirements/srs_final.md

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=c440f000e4a91b99f6905ff639b9b569cc9773b2ef3a30a7e9670c5c471fc7f1
bytes=174032 compact_bytes=170569 lines=2404 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-11 (4차) 라운드가 배운 함정 (사내 요청 · 발행) > 계약을 바꿀 때 강제하는 자리가 몇 곳인지 세라 — 이 판에서 가장 값비쌌던 것 > 검사의 「존재」를 세는 회귀는 「기대가 반대인」 상태를 못 본다 > 한 방향만 거는 게이트는 계약이 넓어질 때 반대로 거짓말한다 > 라우트 시험이 없으면 응답 조립 결함이 영원히 안 잡힌다
sig=agent-context/risks.md;packages/authz/src/config.test.ts;apps/web/instrumentation.test.ts;deploy/single-host/smoke-images.sh;deploy/single-host/;origin/main;docs/20_derived_ui_specs/pr_search_product_ia.md;apps/web;refs/tags/;usr/bin/env;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;4/4;7/7;tmp/.../baseline-integration.log;prs/web

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=a6ea3af9461944bd5b6ddb3ae603e170ca08b963e45c8de37e4ec8ead36fed9b
bytes=158679 compact_bytes=157732 lines=2484 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-11 (4차) — 사내 요청 두 건 반영과 0.1.0-pilot.5 발행 (CR-082 · CR-083) > Goal — 결정자의 말로 > Current state > Decisions — 이 세션이 고른 것 > Changed files
sig=agent-context/session-notes.md;agent-context/upstream-feedback.md;packages/authz/src/github-oauth.ts;packages/authz/src/config.ts;apps/web/app/auth/callback/route.ts;apps/search-api/src/auth/registration.ts;Risks/gotchas;github.com/89sooner/pr-search/pull/172;github.com/89sooner/pr-search/pull/173;github.com/89sooner/pr-search/pull/174;github.com/89sooner/pr-search/pull/175;github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.5;docs/40_delivery/pr_search_implementation_traceability.md;dailywork/2026-09-11_;packages/domain/src/mnumber.ts;apps/pipeline-worker/src/mnumber-plan.ts;apps/search-api/src/sequence/merge-number-view.ts;apps/web/lib/merge-number.ts;github.com/89sooner/pr-search/pull/168;github.com/89sooner/pr-search/pull/169;github.com/89sooner/pr-search/pull/171;github.com/89sooner/pr-search/pull/170;docs/30_technical_architecture/pr_search_wp074_design.md;apps/web

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=d1c5a04098090c0f5e9b05855ba14ce55ad8b69d53ff28a59d32b03a5df4b560
bytes=108816 compact_bytes=108198 lines=1717 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-11 (4차) — 사내 요청 두 건 반영과 0.1.0-pilot.5 발행 (CR-082 · CR-083) > 이 세션의 목표 > 결과 > 사내 요청 두 건이 무엇이었나 > 요청을 구현하다 드러난 기존 결함 넷 — 이 세션의 중심
sig=agent-context/session-summary.md;agent-context/upstream-feedback.md;feature/wp074-squash-mnumber;tmp/pr-search-wp074-implementation;packages/authz/src/config.ts;prs/web;apps/web/instrumentation.ts;deploy/single-host/smoke-images.sh;refs/tags/;git/refs;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7;4/8

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=b65b933721734967bc40a8e78f499ea48b79fe89872830ab498bda32b6a5c541
bytes=169733 compact_bytes=144339 lines=2109 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 시작하기 전에 실측할 것 > 가장 앞에 있는 것 — 사내 반입 결과를 기다린다 > 사내가 먼저 해야 하는 것 > 사내 반입에서 확인해야 할 것 (원장 6.80장) > 열린 편차 셋 (앞 라운드에서 이어진다)
sig=agent-context/todos.md;home/roqkf/pr-search;origin/main;auth/callback;user/teams;fix/dev-561-git-ca-trust;feature/ghe-oauth-login;fix/smoke-gate-cr083;docs/pilot5-published;tmp/pr-search-bundle-out;deploy/single-host/;tmp/pr-search-bundle-main;/deploy/single-host/build-bundle.sh;tmp/pr-search-bundle-release;docs/40_delivery/pr_search_work_packages.md;apps/web/app/auth/callback/route.ts;apps/pipeline-worker/src/mirror-runner.ts;apps/pipeline-worker/src/sequence-plan.ts;docs/cr077-m-number;host/db;6.72.4/6.72.5;agent-context/count-unresolved-reviews.py;89sooner/pr-search;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.3

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=cdf434494595549fafedb4317370272ed3ef9184c8456adbe281a4ca522d7410
bytes=7159 compact_bytes=7761 lines=105 priority=50
heads=Upstream Feedback > DEV-561 — git 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패 > 반영해야 할 파일 > FR-NEW — 사내 GHE OAuth2 직접 인증 지원 > 필요한 변경 > GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
sig=agent-context/upstream-feedback.md;certs/ghe-ca.crt;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;docs/40_delivery/pr_search_implementation_traceability.md;auth/callback;OIDC/GHE;login/oauth/authorize;login/oauth/access_token;user/teams;cpswdev-team/pipe-admins;cpswdev-team/pipe-users;Upstream;Feedback;DEV;compose;GIT_SSL_CAINFO;example;resolved;NOT;RUN;JOB;MIR

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
