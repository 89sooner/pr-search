# agent-context-index:v1
generated=2026-09-11T23:57:20+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=8
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,github.com/89sooner/pr-search/pull/176,prs/github-annotate,prs/github,packages/github-annotate/src/title.ts,packages/github-annotate/src/client.ts,apps/pipeline-worker/src/annotate.ts,packages/db/src/repositories/merge-sequence.ts
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,prs/github-annotate,agent-context/upstream-feedback.md,feature/wp074-squash-mnumber,tmp/pr-search-wp074-implementation,packages/authz/src/config.ts,prs/web,apps/web/instrumentation.ts
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,prs/github-annotate,prs/github,prs/db,healthz/route.test.ts,commit/PR/,apps/web,refs/tags/
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,feature/wp075-pr-title-annotate,home/roqkf/pr-search,origin/main,fix/dev-561-git-ca-trust,feature/ghe-oauth-login,fix/smoke-gate-cr083,docs/pilot5-published
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,home/roqkf/pr-search,prs-postgres/redis/elasticsearch,dev/null,9200/_cluster/health,prs/web,home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,packages/github-annotate/,src/title.ts,src/config.ts,src/client.ts,src/index.ts,src/title.test.ts,testing/mock-annotate-ghe.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,packages/bus/src/redis-streams.ts,acme/smp1900,repos/.../actions/runs,packages/authz/src/config.test.ts,apps/web/instrumentation.test.ts,deploy/single-host/smoke-images.sh,deploy/single-host/
- f3df0a8 p=50 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,certs/ghe-ca.crt,deploy/single-host/compose.yml,deploy/single-host/.env.example,deploy/single-host/RUNBOOK.md,docs/40_delivery/pr_search_implementation_traceability.md,auth/callback,OIDC/GHE

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=7803643bcbcf95fabfd410b23af93371e56ac642c1acc489db4c7d395022a652
bytes=180214 compact_bytes=184439 lines=3608 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-12 라운드에서 쓴 것 (WP-075 · CR-084 · 병합) > 전제 — Node 22 (앞 라운드와 같다) > 백킹 서비스를 먼저 세운다 (통합 시험에 필요) > 검증 배터리 (전부 실행했고 이 수치가 원장 6.81장의 정본이다) > 변이 시험 — 27종 전부 kill
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;home/roqkf/pr-search;prs-postgres/redis/elasticsearch;dev/null;9200/_cluster/health;prs/web;home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;repos/89sooner/pr-search/actions/runs;acme/smp1900;tmp/pr-search-postmerge;origin/main;home/roqkf/pr-search/agent-context/count-unresolved-reviews.py;packages/authz/src/github-oauth.ts;tmp/pr-search-bundle-main;/deploy/single-host/build-bundle.sh;tmp/pr-search-bundle-release;repos/89sooner/pr-search/releases/tags/0.1.0-pilot.5;a11y/mnumber.test.tsx;scratchpad/mutate.py;prs/pipeline-worker;5432/prs_test;apps/pipeline-worker/dist/measure-cli.js;tmp/pr-search-bundle-out

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=96314a41f7e49d1e3a29c3ce59c479bcd56f6506d7b94f09fd8d5e94b4e5971e
bytes=210844 compact_bytes=184834 lines=1742 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-12 — WP-075 PR 제목 표기 (CR-084) > 결정자가 확정해 준 것 (다시 열지 않는다) > 구현이 스스로 고른 것 > 리뷰를 거치며 바꾼 판단 > 고치지 않기로 한 것 (근거)
sig=agent-context/decisions.md;prs/github-annotate;prs/github;prs/db;healthz/route.test.ts;commit/PR/;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=84ffbc1c3567b4b38f05eec25e64db5a01a1a162ee463e3c91f54248ce1762ed
bytes=144318 compact_bytes=141788 lines=1759 priority=45
heads=중요 파일 경로와 역할 > 2026-09-12 라운드가 만진 것 (WP-075 / CR-084 — 48개 파일) > 쓰기 경계 — 새 패키지 packages/github-annotate/ > 워커 > 정본과 질의 > API와 배포
sig=agent-context/files.md;packages/github-annotate/;src/title.ts;src/config.ts;src/client.ts;src/index.ts;src/title.test.ts;testing/mock-annotate-ghe.ts;testing/client.test.ts;prs/domain;prs/github;apps/pipeline-worker/src/annotate.ts;apps/pipeline-worker/src/annotate.test.ts;apps/pipeline-worker/src/index.ts;apps/pipeline-worker/src/metrics.ts;packages/db/migrations/026_annotate_policy;packages/db/src/repositories/merge-sequence.ts;packages/db/src/repositories/repository.ts;packages/domain/src/audit.ts;packages/bus/src/topics.ts;packages/github/src/config.ts;apps/search-api/src/ops/routes.ts;admin/repositories/;deploy/single-host/compose.yml

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=5ded21a9ae82906754fa8e639f0a975dffb781ff9847e76ac71cf40483c1998b
bytes=180436 compact_bytes=176949 lines=2505 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-12 라운드가 배운 함정 (WP-075 자동 GHE 쓰기) > 문서의 숫자가 무엇을 재는 값인지 확인하라 — 이 판에서 가장 값비쌌던 것 > 수정이 수정을 만든다 — 이 판에 셋 > 완화하려다 반대로 넓히는 자리 — 느슨한 성공 판정 > 검토자의 「미해소」를 그대로 믿지 마라
sig=agent-context/risks.md;packages/bus/src/redis-streams.ts;acme/smp1900;repos/.../actions/runs;packages/authz/src/config.test.ts;apps/web/instrumentation.test.ts;deploy/single-host/smoke-images.sh;deploy/single-host/;origin/main;docs/20_derived_ui_specs/pr_search_product_ia.md;apps/web;refs/tags/;usr/bin/env;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts;4/4

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=e0b201a5efc588bb1e7d3c3455e387051a2b548b3c63974ea482510436223d8e
bytes=162999 compact_bytes=161929 lines=2558 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-12 — WP-075 PR 제목 M 넘버 표기 수직 완주 (CR-084) > Goal — 결정자의 말로 > Current state > Decisions — 이 세션이 고른 것 > Changed files
sig=agent-context/session-notes.md;github.com/89sooner/pr-search/pull/176;prs/github-annotate;prs/github;packages/github-annotate/src/title.ts;packages/github-annotate/src/client.ts;apps/pipeline-worker/src/annotate.ts;packages/db/src/repositories/merge-sequence.ts;Risks/gotchas;docs/40_delivery/pr_search_implementation_traceability.md;docs/00_governance/change_control.md;exports/202609120849.md;agent-context/upstream-feedback.md;packages/authz/src/github-oauth.ts;packages/authz/src/config.ts;apps/web/app/auth/callback/route.ts;apps/search-api/src/auth/registration.ts;github.com/89sooner/pr-search/pull/172;github.com/89sooner/pr-search/pull/173;github.com/89sooner/pr-search/pull/174;github.com/89sooner/pr-search/pull/175;github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.5;dailywork/2026-09-11_;packages/domain/src/mnumber.ts

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=139999b91735e9f5b5afbca4c39154241ea323da746f978c5d05a17f63f90c7a
bytes=112919 compact_bytes=112382 lines=1795 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-12 — WP-075 PR 제목 M 넘버 표기 수직 완주 (CR-084) > 이 세션의 목표 > 결과 > 무엇을 만들었나 > 리뷰 네 판 — 이 세션의 중심
sig=agent-context/session-summary.md;prs/github-annotate;agent-context/upstream-feedback.md;feature/wp074-squash-mnumber;tmp/pr-search-wp074-implementation;packages/authz/src/config.ts;prs/web;apps/web/instrumentation.ts;deploy/single-host/smoke-images.sh;refs/tags/;git/refs;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4;7/7

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=49be872efe1207db764413b1828b45342fe8d48d37a9abe48f4d342fc21a8833
bytes=175468 compact_bytes=149994 lines=2191 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 시작하기 전에 실측할 것 > 가장 앞에 있는 것 — CI 결제 문제 > 사내가 표기를 켜려면 (런북 7.B가 정본) > 열린 편차 다섯 > 고치지 않기로 한 것 (근거는 원장 6.81장)
sig=agent-context/todos.md;feature/wp075-pr-title-annotate;home/roqkf/pr-search;origin/main;fix/dev-561-git-ca-trust;feature/ghe-oauth-login;fix/smoke-gate-cr083;docs/pilot5-published;auth/callback;user/teams;tmp/pr-search-bundle-out;deploy/single-host/;tmp/pr-search-bundle-main;/deploy/single-host/build-bundle.sh;tmp/pr-search-bundle-release;docs/40_delivery/pr_search_work_packages.md;apps/web/app/auth/callback/route.ts;apps/pipeline-worker/src/mirror-runner.ts;apps/pipeline-worker/src/sequence-plan.ts;docs/cr077-m-number;host/db;6.72.4/6.72.5;agent-context/count-unresolved-reviews.py;89sooner/pr-search

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=cdf434494595549fafedb4317370272ed3ef9184c8456adbe281a4ca522d7410
bytes=7159 compact_bytes=7761 lines=105 priority=50
heads=Upstream Feedback > DEV-561 — git 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패 > 반영해야 할 파일 > FR-NEW — 사내 GHE OAuth2 직접 인증 지원 > 필요한 변경 > GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
sig=agent-context/upstream-feedback.md;certs/ghe-ca.crt;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;docs/40_delivery/pr_search_implementation_traceability.md;auth/callback;OIDC/GHE;login/oauth/authorize;login/oauth/access_token;user/teams;cpswdev-team/pipe-admins;cpswdev-team/pipe-users;Upstream;Feedback;DEV;compose;GIT_SSL_CAINFO;example;resolved;NOT;RUN;JOB;MIR

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
