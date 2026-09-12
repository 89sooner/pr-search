# agent-context-index:v1
generated=2026-09-12T16:40:19+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=8
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,packages/github-annotate/src/pacing.ts,apps/pipeline-worker/src/annotate-lock.ts,integration/sequence/annotate-safety.test.ts,Risks/gotchas,github.com/89sooner/pr-search/pull/177,github.com/89sooner/pr-search/pull/178,github.com/89sooner/pr-search/pull/176
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,up/down/up,prs/github-annotate,agent-context/upstream-feedback.md,feature/wp074-squash-mnumber,tmp/pr-search-wp074-implementation,packages/authz/src/config.ts,prs/web
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,prs/github-annotate,prs/github,prs/db,healthz/route.test.ts,commit/PR/,apps/web,refs/tags/
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,fix/wp075-annotate-safety,docs/cr085-pilot6-candidate,home/roqkf/pr-search,origin/main,tmp/pr-search-bundle-pilot6/,dist/annotate-preview-cli.js,prs/github
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,55433/prs_mig027,packages/db/dist/cli.js,packages/db/migrations/027_annotate_outcome.down.sql,/deploy/single-host/build-bundle.sh,tmp/pr-search-bundle-pilot6,/pr-search-0.1.0-pilot.6-offline.tar.gz
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,packages/github-annotate/src/pacing.ts,apps/pipeline-worker/src/annotate-lock.ts,apps/pipeline-worker/src/annotate-preview-cli.ts,apps/pipeline-worker/src/annotate-safety.test.ts,apps/pipeline-worker/integration/sequence/annotate-safety.test.ts,packages/db/migrations/027_annotate_outcome,apps/pipeline-worker/src/annotate.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,packages/es/src/config.ts,packages/bus/src/redis-streams.ts,acme/smp1900,repos/.../actions/runs,packages/authz/src/config.test.ts,apps/web/instrumentation.test.ts,deploy/single-host/smoke-images.sh
- f3df0a8 p=50 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,certs/ghe-ca.crt,deploy/single-host/compose.yml,deploy/single-host/.env.example,deploy/single-host/RUNBOOK.md,docs/40_delivery/pr_search_implementation_traceability.md,auth/callback,OIDC/GHE

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=62e177e768ccccda1639784bc6f0caa09bbb6bbc51ef61682ecb847a2c3599ae
bytes=184774 compact_bytes=188925 lines=3698 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-13 라운드에서 쓴 것 (WP-075 안전성 보강 · CR-085) > 전제 — Node 22 > 격리 백킹 서비스 — 이름·포트·볼륨을 모두 나눈다 > postgres 55433 · redis 56379 · elasticsearch 59200, 볼륨도 별도 > 검증 배터리 — 순차로 돈다
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;55433/prs_mig027;packages/db/dist/cli.js;packages/db/migrations/027_annotate_outcome.down.sql;/deploy/single-host/build-bundle.sh;tmp/pr-search-bundle-pilot6;/pr-search-0.1.0-pilot.6-offline.tar.gz;checksums/SHA256SUMS;images/pr-search-app.tar;prs/db;prs/pipeline-worker;packages/db/node_modules;home/roqkf/pr-search;prs-postgres/redis/elasticsearch;dev/null;9200/_cluster/health;prs/web;home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py;repos/89sooner/pr-search/actions/runs;acme/smp1900;tmp/pr-search-postmerge;origin/main;home/roqkf/pr-search/agent-context/count-unresolved-reviews.py

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=be4a2669a79d8765a1725ce0241968e956c765da965186ade781ab5ebecf481b
bytes=215507 compact_bytes=188466 lines=1784 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-13 — WP-075 안전성 보강 (CR-085) > 결정자가 확정해 준 것 (다시 열지 않는다) > 구현이 스스로 고른 것 > 리뷰를 거치며 바꾼 판단 > 고치지 않기로 한 것 (근거)
sig=agent-context/decisions.md;prs/github-annotate;prs/github;prs/db;healthz/route.test.ts;commit/PR/;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db;prs/query;apps/search-api/src/runtime.ts;prs/authz;regression/runtime-reachability.test.ts;11/11;acme/a;owner/repo;00_governance/AGENTS.md;10_requirements/AGENTS.md;docs/AGENTS.md

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=a1ed83e2d34f4831bbde8130364723fa34be999d757a0e2c15797ccd1709e80f
bytes=147847 compact_bytes=145494 lines=1799 priority=45
heads=중요 파일 경로와 역할 > 2026-09-13 라운드가 만진 것 (WP-075 안전성 보강 / CR-085 — 33개 파일) > 새로 만든 것 > 크게 바뀐 것 > 문서 > 손대면 안 되는 것
sig=agent-context/files.md;packages/github-annotate/src/pacing.ts;apps/pipeline-worker/src/annotate-lock.ts;apps/pipeline-worker/src/annotate-preview-cli.ts;apps/pipeline-worker/src/annotate-safety.test.ts;apps/pipeline-worker/integration/sequence/annotate-safety.test.ts;packages/db/migrations/027_annotate_outcome;apps/pipeline-worker/src/annotate.ts;packages/github-annotate/src/client.ts;packages/db/src/repositories/merge-sequence.ts;packages/db/src/advisory-lock.ts;apps/search-api/src/ops/;packages/github-annotate/testing/mock-annotate-ghe.ts;regression/runtime-reachability.test.ts;docs/00_governance/change_control.md;docs/10_requirements/srs_final.md;packages/authz/src/config.ts;packages/github/src/client.ts;tmp/pr-search-bundle-pilot6/;tmp/pr-search-wp075-safety;tmp/pr-search-postmerge-safety;packages/github-annotate/;src/title.ts;src/config.ts

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=8fdf762bb7f863ee462fa73996577e47d1a813e8964aac981868b4ed6b26e39d
bytes=184846 compact_bytes=181311 lines=2552 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-13 라운드가 배운 함정 (WP-075 안전성 보강) > 변이가 「살아남았다」고 하면 먼저 그 시험이 돌았는지 물어라 > 환경 변수 이름 하나가 36개 파일을 죽였다 > 앞선 판이 심어 둔 시험이 이 판을 잡는다 — 좋은 신호다 > 수정이 만든 자리를 다시 본다 — 이번에는 검토가 먼저 잡았다
sig=agent-context/risks.md;packages/es/src/config.ts;packages/bus/src/redis-streams.ts;acme/smp1900;repos/.../actions/runs;packages/authz/src/config.test.ts;apps/web/instrumentation.test.ts;deploy/single-host/smoke-images.sh;deploy/single-host/;origin/main;docs/20_derived_ui_specs/pr_search_product_ia.md;apps/web;refs/tags/;usr/bin/env;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;try/catch;docs/40_delivery/pr_search_implementation_traceability.md;900/900;exports/202608262010.md;packages/es/src/links.ts;apps/search-api/src/index.ts

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=2b4f2fffc5e63d256be8c7f78253caa186f1fb2a2267048cd92ac67be0bf75cf
bytes=166508 compact_bytes=165409 lines=2610 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-13 — WP-075 안전성 보강 (CR-085) > Goal — 결정자의 말로 > Current state > Decisions — 이 세션이 고른 것 > Changed files
sig=agent-context/session-notes.md;packages/github-annotate/src/pacing.ts;apps/pipeline-worker/src/annotate-lock.ts;integration/sequence/annotate-safety.test.ts;Risks/gotchas;github.com/89sooner/pr-search/pull/177;github.com/89sooner/pr-search/pull/178;github.com/89sooner/pr-search/pull/176;prs/github-annotate;prs/github;packages/github-annotate/src/title.ts;packages/github-annotate/src/client.ts;apps/pipeline-worker/src/annotate.ts;packages/db/src/repositories/merge-sequence.ts;docs/40_delivery/pr_search_implementation_traceability.md;docs/00_governance/change_control.md;exports/202609120849.md;agent-context/upstream-feedback.md;packages/authz/src/github-oauth.ts;packages/authz/src/config.ts;apps/web/app/auth/callback/route.ts;apps/search-api/src/auth/registration.ts;github.com/89sooner/pr-search/pull/172;github.com/89sooner/pr-search/pull/173

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=7f05e28cdbde628851bcabf4881872172da3a509d230f48886fae34ea5dc1a2c
bytes=115366 compact_bytes=114726 lines=1835 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-13 — WP-075 안전성 보강 (CR-085) > 이 세션의 목표 > 결과 > 이 세션의 중심 — 먼저 재현하고 그다음 고쳤다 > 무엇을 만들었나
sig=agent-context/session-summary.md;up/down/up;prs/github-annotate;agent-context/upstream-feedback.md;feature/wp074-squash-mnumber;tmp/pr-search-wp074-implementation;packages/authz/src/config.ts;prs/web;apps/web/instrumentation.ts;deploy/single-host/smoke-images.sh;refs/tags/;git/refs;10/11;CR/DEV;11/11;1/8;2/8;3/8;acme/b;acme/a;900/900;66/67;apps/web;4/4

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=a98cffa068335f248458c25e2b46bf0b15fa32444574df607515e7d6a5bee4b1
bytes=180953 compact_bytes=155327 lines=2271 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 시작하기 전에 실측할 것 > 가장 앞에 있는 것 — CI가 코드를 실행하지 못한다 (원인은 둘이다) > 사내가 표기를 켜려면 (런북 7.B가 정본 — 0단계가 새로 생겼다) > 열린 편차 (표기 관련) > 확인할 사항
sig=agent-context/todos.md;fix/wp075-annotate-safety;docs/cr085-pilot6-candidate;home/roqkf/pr-search;origin/main;tmp/pr-search-bundle-pilot6/;dist/annotate-preview-cli.js;prs/github;feature/wp075-pr-title-annotate;fix/dev-561-git-ca-trust;feature/ghe-oauth-login;fix/smoke-gate-cr083;docs/pilot5-published;auth/callback;user/teams;tmp/pr-search-bundle-out;deploy/single-host/;tmp/pr-search-bundle-main;/deploy/single-host/build-bundle.sh;tmp/pr-search-bundle-release;docs/40_delivery/pr_search_work_packages.md;apps/web/app/auth/callback/route.ts;apps/pipeline-worker/src/mirror-runner.ts;apps/pipeline-worker/src/sequence-plan.ts

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=cdf434494595549fafedb4317370272ed3ef9184c8456adbe281a4ca522d7410
bytes=7159 compact_bytes=7761 lines=105 priority=50
heads=Upstream Feedback > DEV-561 — git 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패 > 반영해야 할 파일 > FR-NEW — 사내 GHE OAuth2 직접 인증 지원 > 필요한 변경 > GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
sig=agent-context/upstream-feedback.md;certs/ghe-ca.crt;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;docs/40_delivery/pr_search_implementation_traceability.md;auth/callback;OIDC/GHE;login/oauth/authorize;login/oauth/access_token;user/teams;cpswdev-team/pipe-admins;cpswdev-team/pipe-users;Upstream;Feedback;DEV;compose;GIT_SSL_CAINFO;example;resolved;NOT;RUN;JOB;MIR

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
