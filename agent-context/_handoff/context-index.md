# agent-context-index:v1
generated=2026-09-26T14:00:01+00:00
source_dir=agent-context
output_dir=agent-context/_handoff
files=9
legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata

## read_order
- f98c94b p=18 src=agent-context/current-handoff.md compact=agent-context/_handoff/compact/f98c94b.current-handoff.ctx.md title=Current-Handoff-2026-09-26-PR-Search-19차-0.1.0-pilot.19-발행-격리-업그레이드-검증-완료-사내-적용-NOT-RUN sig=agent-context/current-handoff.md,docs/pilot19-release-record,github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.19,agent-context/upstream-feedback.md,origin/main,docs/00_governance/change_control.md,docs/40_delivery/pr_search_implementation_traceability.md,deploy/single-host/RUNBOOK.md
- f73e2b0 p=25 src=agent-context/session-notes.md compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md title=Session-2026-08-25-후반-CR-032-036-WP-028-WP-068-완료 sig=agent-context/session-notes.md,agent-context/upstream-feedback.md,origin/main,home/roqkf/pr-search,home/roqkf/design-system,Risks/gotchas,dailywork/2026-09-15_PR-Search-CR-092-pilot.7-,home/roqkf/pr-search/exports/pr-search-2026-09-15.md
- f3c6d32 p=25 src=agent-context/session-summary.md compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md title=세션-요약-PR-Search-구현-2026-08-25-후반 sig=agent-context/session-summary.md,2919/2920,1847/1847,506/506,2930/2930,8/1865,agent-context/session-notes.md,docs/00_governance/change_control.md
- f0b2764 p=28 src=agent-context/decisions.md compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md title=확정한-설계-결정과-이유 sig=agent-context/decisions.md,docs/00_governance/change_control.md,agent-context/session-notes.md,lib/redirect.ts,text/html,logout/route.ts,-qO/dev/null,HTTP/x.y
- f54408e p=30 src=agent-context/todos.md compact=agent-context/_handoff/compact/f54408e.todos.ctx.md title=다음-작업-미해결-항목-확인할-사항 sig=agent-context/todos.md,packages/es/src/query-builder.ts,Risks/gotchas,packages/query/src/keys.ts,CR/DEV/WP,packages/contracts/src/source.ts,feature/rel007-capability-registry,fix/main-ci-s0-flaky
- f3df0a8 p=40 src=agent-context/upstream-feedback.md compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md title=Upstream-Feedback sig=agent-context/upstream-feedback.md,handoff/pipe-search-integration/v1/CONTRACT_DIFF.md,/prsctl,owner/name,apps/pipeline-worker/src/enrich.ts,apps/pipeline-worker/src/documents.ts,pulls/983/commits,apps/pipeline-worker/src/reindex.ts
- f527103 p=45 src=agent-context/commands.md compact=agent-context/_handoff/compact/f527103.commands.ctx.md title=명령어-시험-결과-실패한-명령과-원인 sig=agent-context/commands.md,agent-context/session-notes.md,repos/89sooner/pr-search/commits/,HTTP/1.1,prs/search-api,3002/healthz,3000/gh,prs/web
- f5791b0 p=45 src=agent-context/files.md compact=agent-context/_handoff/compact/f5791b0.files.ctx.md title=중요-파일-경로와-역할 sig=agent-context/files.md,agent-context/session-notes.md,apps/search-api/integration/search/identifier-range.test.ts,apps/search-api/integration/source/history-pull-requests.test.ts,packages/authz/src/,apps/search-api/src/auth/,apps/web/lib/,app/auth/
- f7b39dc p=45 src=agent-context/risks.md compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md title=리스크-불확실한-가정-함정 sig=agent-context/risks.md,agent-context/session-notes.md,Risks/gotchas,/check-runs,home/roqkf/design-system,actions/runs,gh/policies,origin/main

## files
### f527103
src=agent-context/commands.md
compact=agent-context/_handoff/compact/f527103.commands.ctx.md
sha256=a9523de018f67c32fc6541baef96c8c4dbe2dfbaa59e7c8ec6ae3db661ebad19
bytes=235502 compact_bytes=239909 lines=4390 priority=45
heads=명령어 · 시험 결과 · 실패한 명령과 원인 > 2026-09-18 (11차)에서 쓴 것 (CR-106·CR-107) > 2026-09-15 (8차) 라운드에서 쓴 것 (CR-092) > 환경 > 재현·실측 > smoke 뒤섞임: 한 컨테이너에 docker exec로 20회 → 200 12 · HTTP/1.1 8
sig=agent-context/commands.md;agent-context/session-notes.md;repos/89sooner/pr-search/commits/;HTTP/1.1;prs/search-api;3002/healthz;3000/gh;prs/web;dev/null;53999/gh/identity/callback;SP/battery.sh;SP/logs/battery-2;SP/mutation/run.mjs;deploy/single-host;/smoke-images.sh;SP/docpatch.mjs;FILE/FROM/TO/END;repos/89sooner/pr-search/actions/jobs/;lib/auth-paths.ts;repos/89sooner/pr-search/actions/runs/;home/roqkf/pr-search;origin/main;repos/89sooner/pr-search/actions/runs;deploy/single-host/prsctl

### f98c94b
src=agent-context/current-handoff.md
compact=agent-context/_handoff/compact/f98c94b.current-handoff.ctx.md
sha256=736a1bce567743d4878350ae8f5cc5d6c0c655a154975cf82e4b82650710ee7a
bytes=7378 compact_bytes=7300 lines=40 priority=18
heads=Current Handoff — 2026-09-26 PR Search 19차 (0.1.0-pilot.19 발행 · 격리 업그레이드 검증 완료 · 사내 적용 NOT RUN) > Start here > Delivered (19차) > Verify before changing code > Open boundary > References
sig=agent-context/current-handoff.md;docs/pilot19-release-record;github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.19;agent-context/upstream-feedback.md;origin/main;docs/00_governance/change_control.md;docs/40_delivery/pr_search_implementation_traceability.md;deploy/single-host/RUNBOOK.md;agent-context/session-notes.md;Current;Handoff;Search;NOT;RUN;Start;pilot19;release;GitHub;refetch;CLI;DEV;commits;releases;KST

### f0b2764
src=agent-context/decisions.md
compact=agent-context/_handoff/compact/f0b2764.decisions.ctx.md
sha256=4a486c951fda11cddb71b9fdba318d5bd2e2dd62120e6893a21e6f081efddd03
bytes=269788 compact_bytes=238115 lines=2111 priority=28
heads=확정한 설계 결정과 이유 > 2026-09-18 (11차) — CR-106·CR-107 > 2026-09-15 (8차) — CR-092 사내 pilot.7 반입 피드백 (PR #194) > A. 사용자 직접 결정 (다시 논의하지 않음) > C. 구현이 스스로 고른 것 (근거와 되돌리는 법) > 2026-09-15 (7차) — CR-091 사내 pilot.6 반입 피드백 (PR #191)
sig=agent-context/decisions.md;docs/00_governance/change_control.md;agent-context/session-notes.md;lib/redirect.ts;text/html;logout/route.ts;-qO/dev/null;HTTP/x.y;first/last;head/tail;origin/main;dist/role-cli.js;prs/authz;prs/db;true/false/;gh/policies;gh/policies/changes;lib/gh-policy.ts;41/40;5/5;before/after;477/477;scratchpad/apply-agent-context.py;compact/f3df0a8.upstream-feedback.ctx.md

### f5791b0
src=agent-context/files.md
compact=agent-context/_handoff/compact/f5791b0.files.ctx.md
sha256=bd7015299b888b7002285a9bc9b0ac17281f77772967056d71ab4aa8af4101f9
bytes=191224 compact_bytes=186717 lines=2203 priority=45
heads=중요 파일 경로와 역할 > 2026-09-18 (11차)가 만들거나 만진 것 (CR-106·CR-107) > 2026-09-15 (8차) 라운드가 만들거나 만진 것 (CR-092, PR #194) > 코드 > 시험 > 문서
sig=agent-context/files.md;agent-context/session-notes.md;apps/search-api/integration/search/identifier-range.test.ts;apps/search-api/integration/source/history-pull-requests.test.ts;packages/authz/src/;apps/search-api/src/auth/;apps/web/lib/;app/auth/;app/auth/signed-out/page.tsx;app/gh/identity/callback/route.ts;app/workbench.css;deploy/single-host/prsctl;deploy/single-host/RUNBOOK.md;packages/authz/src/scope-source.test.ts;apps/search-api/integration/authz/scope-diagnostics.test.ts;apps/search-api/src/auth/auth.test.ts;apps/web/lib/redirect.test.ts;lib/architecture.test.ts;app/gh/identity/callback/route.test.ts;a11y/shell.test.tsx;e2e/shell.spec.ts;regression/cr092-pilot7-feedback.test.ts;agent-context/upstream-feedback.md;mnt/c/Users/slrtt/Documents/Obsidian

### f7b39dc
src=agent-context/risks.md
compact=agent-context/_handoff/compact/f7b39dc.risks.ctx.md
sha256=6f425bf21e0eef5d737b033e7f4197130393ebbf00fca0c073fc813f46507f44
bytes=219576 compact_bytes=214691 lines=2806 priority=45
heads=리스크 · 불확실한 가정 · 함정 > 2026-09-18 (11차)가 배운 함정 (CR-106·CR-107) > 2026-09-15 (8차) 라운드가 배운 함정 (CR-092) > 2026-09-15 (7차) 라운드가 배운 함정 (CR-091) > 2026-09-14 (6차) 라운드가 배운 함정 (CR-090) > 2026-09-14 (5차) 라운드가 배운 함정 (CR-089)
sig=agent-context/risks.md;agent-context/session-notes.md;Risks/gotchas;/check-runs;home/roqkf/design-system;actions/runs;gh/policies;origin/main;claude/projects/;regression/ledger-canonical-table.test.ts;packages/contracts/src/error-codes.test.ts;home/roqkf/pr-search/202609140825.md;home/roqkf/pr-search/exports/;regression/range-vs-git.test.ts;regression/releases-vs-git.test.ts;19/19;agent-context/_handoff/reader.py;compact/f3df0a8.upstream-feedback.ctx.md;tmp/claude-1000/-home-roqkf-pr-search/f864b845-;scratchpad/gh/gh_2.97.0_linux_amd64/bin/gh;packages/gh-cli/testing/pinned-gh.ts;prs-pinned-gh/2.97.0/gh;scripts/gh-capabilities.mjs;exports/202609140756.md

### f73e2b0
src=agent-context/session-notes.md
compact=agent-context/_handoff/compact/f73e2b0.session-notes.ctx.md
sha256=7c409240d9c1162472b355cc6e03675e1d743cd5d0bfbbba8a17198cf22149f0
bytes=255354 compact_bytes=250360 lines=3402 priority=25
heads=Session: 2026-08-25 (후반) — CR-032~036, WP-028·WP-068 완료 > Session: 2026-09-15 (8차) — CR-092 사내 pilot.7 반입 피드백 일곱 건 (PR #194) > Goal > Current state > Decisions > Changed files
sig=agent-context/session-notes.md;agent-context/upstream-feedback.md;origin/main;home/roqkf/pr-search;home/roqkf/design-system;Risks/gotchas;dailywork/2026-09-15_PR-Search-CR-092-pilot.7-;home/roqkf/pr-search/exports/pr-search-2026-09-15.md;home/roqkf/pr-search/exports/;logs/battery-;logs/images/;feature/rel007-result-contracts;docs/cr-089-merge-record;exports/202609141932.md;exports/202609142215.md;home/roqkf/pr-search-wt/contracts;exports/202609141338.md;exports/202609140756.md;docs/40_delivery/pr_search_implementation_traceability.md;agent-context/_handoff/;github.com/89sooner/pr-search/pull/185;exports/pr-search-2026-09-14.md;perf/signature-timing.perf.test.ts;classification/commands.ts

### f3c6d32
src=agent-context/session-summary.md
compact=agent-context/_handoff/compact/f3c6d32.session-summary.ctx.md
sha256=2c0218c9b994f47896f1f579f1b4fe1f02b155bd1c92ecc3be3ce492ddf1f8b3
bytes=162144 compact_bytes=159240 lines=2241 priority=25
heads=세션 요약 — PR Search 구현 (2026-08-25 후반) > 2026-09-18 (11차) — CR-106 식별자 범위 검색·CR-107 Source History PR 번호 병기: PR #211/#212(CR-106), #213/#214(CR-107) 병합 > 이 구간의 목표 > 결과 > 2026-09-15 (8차) — CR-092 사내 0.1.0-pilot.7 반입 피드백 일곱 건: PR #194 병합(ae9bf27) > 이 구간의 목표
sig=agent-context/session-summary.md;2919/2920;1847/1847;506/506;2930/2930;8/1865;agent-context/session-notes.md;docs/00_governance/change_control.md;origin/main;dailywork/2026-09-15_PR-Search-CR-092-pilot.7-;exports/202609142215.md;exports/202609141338.md;claude/projects/-home-roqkf-pr-search/539c17f5-;196/196;32/32;80/80;exports/202609140756.md;477/477;docs/cr088-post-merge;home/roqkf/pr-search;feature/rel007-capability-registry;fix/main-ci-s0-flaky;PASS/FAIL;gh/registry

### f54408e
src=agent-context/todos.md
compact=agent-context/_handoff/compact/f54408e.todos.ctx.md
sha256=17a8da70fce0c6278ec8226b5e84775e19b53816e68546588a4841267447fe38
bytes=232135 compact_bytes=186270 lines=2685 priority=30
heads=다음 작업 · 미해결 항목 · 확인할 사항 > 먼저 할 것 — 2026-09-17 10차에서 이어받을 것 (사용자 방향은 이미 확정, 다시 안 물어도 됨) > 이전 (8차 이하, 아래는 2026-09-15 시점 기준 — 이후 진행 여부 미확인, 착수 전 실제 상태 재확인) > 2026-09-15 (8차) — CR-092 뒤에 남은 것 > 이 세션이 이어서 할 것 > 피드백 반영 범위 (사용자에게 확인해 준 기준)
sig=agent-context/todos.md;packages/es/src/query-builder.ts;Risks/gotchas;packages/query/src/keys.ts;CR/DEV/WP;packages/contracts/src/source.ts;feature/rel007-capability-registry;fix/main-ci-s0-flaky;feature/rel007-r0-pr-list;docs/cr-092-merge-record;ops/repositories;home/roqkf/design-system;api/v1/me;/prsctl;agent-context/upstream-feedback.md;home/roqkf/pr-search-wt/cr092;home/roqkf/pr-search-wt/cr092-record;fix/cr092-pilot7-feedback;docs/cr-091-merge-record;docs/pilot7-published;home/roqkf/pr-search-wt/cr091-auth;home/roqkf/pr-search-wt/cr091-record;fix/cr091-pilot6-auth-feedback;docs/cr-090-merge-record

### f3df0a8
src=agent-context/upstream-feedback.md
compact=agent-context/_handoff/compact/f3df0a8.upstream-feedback.ctx.md
sha256=d5127d57bf2c35da59dceb7784b3a1ff1d45bc04e0e11f8e83842e94128af860
bytes=15362 compact_bytes=15696 lines=88 priority=40
heads=Upstream Feedback > git merge dev로 인해 source_commit_shas가 dev 체인 커밋으로 오염된다 (설계 갭, 미해결) > 현상 > 근본 원인: git merge dev가 source_commit_shas에 dev 체인 커밋을 통째로 넣는다 > CR-116으로 해결되지 않는 이유 > 요청
sig=agent-context/upstream-feedback.md;handoff/pipe-search-integration/v1/CONTRACT_DIFF.md;/prsctl;owner/name;apps/pipeline-worker/src/enrich.ts;apps/pipeline-worker/src/documents.ts;pulls/983/commits;apps/pipeline-worker/src/reindex.ts;packages/es/src/links.ts;Upstream;Feedback;source_commit_shas;SRCH;PostgreSQL;pull_request_commit_link;merge_sequence;merge_commit_sha;commit_sha;JOB;REL;SQL;EFFECTIVE_LINK_SQL;source_commit;DEV

## continuation_protocol
read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.
