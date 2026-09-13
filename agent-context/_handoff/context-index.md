# agent-context-index:v1
generated=2026-09-13T04:35:38+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=8
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,tmp/pr-search-rel007,feature/rel007-r0-pr-list,9/10,prs/gh-cli,allowed/not_implemented/policy_blocked,packages/gh-cli,apps/gh-executor
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,tmp/pr-search-rel007,feature/rel007-r0-pr-list,89sooner/pr-search,origin/main,1000002394/1000002395,github/workflows/ci.yml,repos/cli/cli/releases/tags/v2.97.0
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,prs/gh-cli,prs/gh-cli/node,HOST/OWNER/REPO,apps/gh-executor,pub/sub,api/v1/gh/identity/callback,GHE_OPS_CLIENT_ID/SECRET/REDIRECT_URI
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,tmp/pr-search-rel007,feature/rel007-r0-pr-list,origin/main,home/roqkf/pr-search,tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh,scripts/gh-manifest.mjs,packages/gh-cli
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,HOME/.nvm/versions/node/v22.23.2/bin,tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad,S/compose.rel007.yml,S/gh/gh_2.97.0_linux_amd64/bin/gh,55434/56380/59201,repos/89sooner/pr-search,89sooner/pr-search
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,tmp/pr-search-rel007,packages/gh-cli/,src/pin.ts,src/types.ts,src/help-parse.ts,src/inventory.ts,src/constraints.ts
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,apps/gh-executor/integration/executor.test.ts,/../search-api/src/gh/,gh/routes,9/10,prs-pinned-gh/2.97.0/gh,prs/gh-cli,fix/wp075-annotate-safety
- f3df0a8 p=50 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,certs/ghe-ca.crt,deploy/single-host/compose.yml,deploy/single-host/.env.example,deploy/single-host/RUNBOOK.md,docs/40_delivery/pr_search_implementation_traceability.md,auth/callback,OIDC/GHE

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=a4f0a16c46da2a0952faf7e209bbbdd6fd989dab9c460c1a9abf3bef3cc9c400
bytes=191575 compact_bytes=195488 lines=3782 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-13 (2차) 라운드에서 쓴 것 (REL-007 R0 · CI 확인) > 전제 — Node 22, 격리 서비스, 고정 gh > CI 재실행과 확인 (지시 3장) > verify success steps=18 · integration success steps=12 · runner "GitHub Actions 1000002394/1000002395" · labels ubuntu-latest > 고정 gh 확보와 자가 연구 (실측)
sig=agent-context/commands.md;HOME/.nvm/versions/node/v22.23.2/bin;tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad;S/compose.rel007.yml;S/gh/gh_2.97.0_linux_amd64/bin/gh;55434/56380/59201;repos/89sooner/pr-search;89sooner/pr-search;repos/89sooner/pr-search/actions/runs/34705991448;repos/89sooner/pr-search/actions/runs/34705991448/jobs;1000002394/1000002395;github.com/cli/cli/releases/download/v2.97.0/gh_2.97.0_linux_amd64.tar.gz;github.com/cli/cli/releases/download/v2.97.0/gh_2.97.0_checksums.txt;gh_2.97.0_linux_amd64/bin/gh;bin/gh;usr/local/bin/gh;tmp/ghcfg;S/mock-ghe.mjs;S/ghhome;S/ghcfg;S/tls/cert.pem;48443/acme/payments;api/graphql;prs/gh-cli

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=df3165b6e6c8d04001656e2b8e465a5303a4c247eaf11429a87f3d4105d52d58
bytes=224277 compact_bytes=197048 lines=1832 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-13 (2차) — REL-007 R0 (CR-086 예정 / WP-077 예정) > 결정자가 확정해 준 것 (A — 다시 열지 않는다) > 구현이 스스로 고른 것 (C — 최종 보고의 「Agent-Initiated Decisions」에 전부 적는다) > 아직 정하지 않은 것 (다음 세션이 정한다) > 2026-09-13 — WP-075 안전성 보강 (CR-085)
sig=agent-context/decisions.md;prs/gh-cli;prs/gh-cli/node;HOST/OWNER/REPO;apps/gh-executor;pub/sub;api/v1/gh/identity/callback;GHE_OPS_CLIENT_ID/SECRET/REDIRECT_URI;regression/runtime-reachability.test.ts;deploy/k8s/;apps/search-api/src/gh/;prs/github-annotate;prs/github;prs/db;healthz/route.test.ts;commit/PR/;apps/web;refs/tags/;git/refs;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;lib/nav.ts;packages/domain/src/anchor.ts;packages/db

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=c741143122af0f977f4c47be61f00f1a3ee543a1c7875fa527cf94a183893a9a
bytes=159132 compact_bytes=154898 lines=1892 priority=45
heads=중요 파일 경로와 역할 > 2026-09-13 (2차) 라운드가 만든 것 (REL-007 R0 / WP-077 예정 — 전부 미커밋, /tmp/pr-search-rel007) > 새 패키지 packages/gh-cli/ — capability 모델·argv·출력 경계 (브라우저 안전 진입점 + /node) > 새 앱 apps/gh-executor/ — gh를 띄우는 유일한 프로세스 > packages/db > packages/bus·packages/contracts
sig=agent-context/files.md;tmp/pr-search-rel007;packages/gh-cli/;src/pin.ts;src/types.ts;src/help-parse.ts;src/inventory.ts;src/constraints.ts;src/argv.ts;src/safe-output.ts;src/result.ts;src/env.ts;src/capabilities.ts;src/manifest.ts;src/sha256.ts;src/manifest-file.ts;src/vault.ts;src/index.ts;src/node.ts;/node;manifest/gh-2.97.0.json;testing/pinned-gh.ts;testing/mock-ghe-tls.ts;testing/https-json.ts

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=f3ceec660fe0506dfb9cb9356dc764fb12a41286e8a5c72afbddb70dbd4e20e1
bytes=190394 compact_bytes=186524 lines=2604 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-13 (2차) 라운드가 배운 함정 (REL-007 R0) > Write 도구가 리터럴 제어 문자를 지운다 — 시험 하나가 그것으로 깨졌다 > 파티션 표의 유니크 인덱스는 파티션 키를 포함해야 한다 — 문서의 DDL이 그래서 틀렸다 > --state closed는 GraphQL에서 [CLOSED, MERGED]다 > search-api가 만료 임박 연결의 요청을 거절한다 — 실행기 시험의 픽스처가 그것에 막혔다
sig=agent-context/risks.md;apps/gh-executor/integration/executor.test.ts;/../search-api/src/gh/;gh/routes;9/10;prs-pinned-gh/2.97.0/gh;prs/gh-cli;fix/wp075-annotate-safety;packages/es/src/config.ts;packages/bus/src/redis-streams.ts;acme/smp1900;repos/.../actions/runs;packages/authz/src/config.test.ts;apps/web/instrumentation.test.ts;deploy/single-host/smoke-images.sh;deploy/single-host/;origin/main;docs/20_derived_ui_specs/pr_search_product_ia.md;apps/web;refs/tags/;usr/bin/env;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=98bc4837f696f2e21d2de7fbe704c8b53fa8da59c2d7b3150dcd7760f85e2773
bytes=169436 compact_bytes=168152 lines=2653 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-13 (2차) — CI 확인 + REL-007 R0 첫 수직 구현 (세션 상한으로 중단, 미커밋) > Goal — 결정자의 말로 > Current state > Decisions — 이 세션이 고른 것 > Changed files
sig=agent-context/session-notes.md;tmp/pr-search-rel007;feature/rel007-r0-pr-list;9/10;prs/gh-cli;allowed/not_implemented/policy_blocked;packages/gh-cli;apps/gh-executor;apps/search-api/src/gh;apps/search-api/integration/gh;Risks/gotchas;github.com/89sooner/pr-search/actions/runs/34705991448;github.com/cli/cli/releases/tag/v2.97.0;packages/github-annotate/src/pacing.ts;apps/pipeline-worker/src/annotate-lock.ts;integration/sequence/annotate-safety.test.ts;github.com/89sooner/pr-search/pull/177;github.com/89sooner/pr-search/pull/178;github.com/89sooner/pr-search/pull/176;prs/github-annotate;prs/github;packages/github-annotate/src/title.ts;packages/github-annotate/src/client.ts;apps/pipeline-worker/src/annotate.ts

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=99f91a89045229db6afe562a9d3e4aac2544bf53f215a5431a9a20a3a9e96e81
bytes=123785 compact_bytes=122703 lines=1899 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-13 (2차) — CI 확인 + REL-007 R0 첫 수직(gh pr list) 구현 중 — 세션 상한으로 중단, 코드 미커밋 > 이 세션의 목표 (결정자의 말로) > 결과 한 줄 > CI — 공개 전환 뒤 기존 러너에서 실제로 돌았다 > 능동 자가 연구 — 공식 근거로 확인한 것 (원장·보고서의 「능동 자가 연구 결과」 장 재료)
sig=agent-context/session-summary.md;tmp/pr-search-rel007;feature/rel007-r0-pr-list;89sooner/pr-search;origin/main;1000002394/1000002395;github/workflows/ci.yml;repos/cli/cli/releases/tags/v2.97.0;bin/gh;cli.github.com/manual/gh_pr_list;OWNER/REPO;api/graphql;local/state/gh/device-id;packages/gh-cli;manifest/gh-2.97.0.json;apps/gh-executor;9/10;packages/db;packages/bus;apps/search-api/src/gh;apps/web;lib/nav.ts;gh/history;lib/gh.ts

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=c6ad2c7f45572071ce575257be8fa2c02663385931b34c0647d72bbc84c22eab
bytes=195520 compact_bytes=168939 lines=2370 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 시작하기 전에 실측할 것 > 가장 먼저 — 미커밋 코드를 브랜치에 커밋해 /tmp 휘발에서 구한다 > 남은 실패 하나를 고친다 (실행기 통합 시험 10건 중 1건) > 웹 화면을 끝낸다 (W-010 최소 + W-021 최소) — 컴포넌트는 있고 페이지가 없다 > 배포·회귀를 잇는다
sig=agent-context/todos.md;tmp/pr-search-rel007;feature/rel007-r0-pr-list;origin/main;home/roqkf/pr-search;tmp/claude-1000/-home-roqkf-pr-search/f864b845-0c6f-4ba6-9c0b-b1a332623dcf/scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;scripts/gh-manifest.mjs;packages/gh-cli;apps/gh-executor;packages/db;packages/bus;packages/contracts;apps/search-api;apps/web;deploy/single-host/compose.yml;docs/30_technical_architecture/pr_search_api_contracts.md;home/roqkf/pr-search/agent-context/;tmp/pr-search-rel007/agent-context/;apps/gh-executor/integration/executor.test.ts;packages/gh-cli/testing/mock-ghe-tls.ts;packages/gh-cli/src/safe-output.test.ts;src/result.test.ts;HOME/.nvm/versions/node/v22.23.2/bin;10/10

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=cdf434494595549fafedb4317370272ed3ef9184c8456adbe281a4ca522d7410
bytes=7159 compact_bytes=7761 lines=105 priority=50
heads=Upstream Feedback > DEV-561 — git 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패 > 반영해야 할 파일 > FR-NEW — 사내 GHE OAuth2 직접 인증 지원 > 필요한 변경 > GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
sig=agent-context/upstream-feedback.md;certs/ghe-ca.crt;deploy/single-host/compose.yml;deploy/single-host/.env.example;deploy/single-host/RUNBOOK.md;docs/40_delivery/pr_search_implementation_traceability.md;auth/callback;OIDC/GHE;login/oauth/authorize;login/oauth/access_token;user/teams;cpswdev-team/pipe-admins;cpswdev-team/pipe-users;Upstream;Feedback;DEV;compose;GIT_SSL_CAINFO;example;resolved;NOT;RUN;JOB;MIR

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
