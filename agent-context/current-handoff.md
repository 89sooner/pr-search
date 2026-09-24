# Current Handoff — 2026-09-24 PR Search 17차 (CR-117 구현·검증·독립 리뷰 완료, PR 병합 대기)

## Start here

`origin/main`의 최신 커밋은 `ea59bb6`(사용자가 사내 `agent-context/upstream-feedback.md` 사본으로 그 파일을 통째로 덮은 커밋 — 코드 변경 없음, 사내 `0.1.0-pilot.18` 보고 세 건만 남았다)이고, 17차는 그 위에서 **CR-117 / WP-102**를 구현했다. 피처 브랜치가 `git merge dev`로 받아 온 dev 체인 커밋에 그 PR 번호가 붙던 결함이다(사내 `ebc781d` = [983, 1671, 1855]). 사용자 결정 `OD-016`: **원본 커밋은 그 PR이 새로 가져온 커밋이고, 추적 브랜치의 현재 체인에 이미 오른 커밋은 그 커밋을 체인에 올린 PR에만 속한다.** 브랜치는 `feature/cr117-source-commits`, worktree는 `/home/roqkf/pr-search-wt/cr117-source-commits`. PR [#230](https://github.com/89sooner/pr-search/pull/230)을 열었고 **병합은 사용자 결정 대기다** — CR-116과 달리 이번 지시에는 병합 승인이 없다. CI 결과는 원장 6.108장 「PR과 병합」에 있다.

17차는 두 세션이다. 전반은 context-full로 끊겼고 전사는 `exports/202609241738_ing.md`(git 무시 대상)다. 후반이 그 전사와 전반의 scratchpad(`/tmp/claude-1000/-home-roqkf-pr-search/52ab5fdd-7f09-4287-ad4c-995bfb0cf58c/scratchpad` — 계획서, 변이 스크립트)를 읽고 이어서 rebase·게이트·독립 리뷰·기록·PR까지 했다.

머리는 늘 실측한다: `git log origin/main --oneline -5`, `gh pr list --state open`.

## Delivered

- **CR-117 / WP-102** — 유효 연결 술어 `EFFECTIVE_LINK_SQL`(`packages/db/src/repositories/pr-commit-link.ts`) 하나를 관계를 읽는 모든 질의(관계 투영 JOB-REL-008, 재색인 replay·전환 전 검증, 복구 대조, 미확정 계수)가 쓴다. **원시 관측은 지우지 않는다** — 체인이 움직이면(강제 푸시) GHE를 다시 읽지 않고 재투영만으로 연결이 되살아나야 하기 때문이다.
- 채번·강제 푸시 재채번·복구 재채번(`sequence.ts`)이 같은 트랜잭션에서 `requeueChainChangedCommitLinks`로 관계 재투영 의도를 남긴다.
- PR 투영(실시간·백필이 `chainShasOf`로 같은 재료)과 재색인은 체인 SHA에 `role: source_commit` 문서를 쓰지 않는다 — 조건부 업서트가 체인 커밋의 `merge_commit`을 덮던 결함(DEV-755).
- PR 상세 `source_commits_excluded`와 화면 안내(`ExcludedCommitsNote`), PSI 계약 D-22(`handoff/pipe-search-integration/v1/`).
- 복구 `prsctl links plan|apply`: 체인 규칙 몫은 관측 확정과 무관하게 지우고(`refetch` 불필요), `--pr` 없는 `apply`가 덮인 역할을 `restoreChainCommitRole`(단방향·멱등)로 되돌린다.
- 상세 결정은 `docs/00_governance/change_control.md`의 `CR-117`(서사·표·5장 cascade)이 정본. 검증은 원장 6.108장 — 전 계층 통과, 변이 17종 모두 죽음, 문서 검증기 기준선 동일, 독립 리뷰 상급 0건.

## Verify before changing code

1. **격리 인프라** — `prs-cr117-postgres`(55447)·`prs-cr117-es`(59213, `cluster.name=prs-cr117-isolated`)·`prs-cr117-redis`(56392), 시험 DB `prs_test_cr117`. 환경은 `/tmp/claude-1000/-home-roqkf-pr-search/0d27507c-884e-4d77-8162-a5e8ed12b90a/scratchpad/env-cr117.sh`(Node 22 경로 포함 — 셸 기본 Node는 v20이다). ES `cluster.name`에 `isolated|test|ci`가 없으면 파괴적 시험 5파일이 스스로 실행을 거부한다(DEV-737).
2. **사용자는 `agent-context/upstream-feedback.md`를 main에서 통째로 덮는다**(09-22 `aeb2b8e`, 09-24 `ea59bb6`). 기능 브랜치가 같은 파일을 고치면 rebase 때 충돌한다 — main 쪽을 채택하고 상류 반영 주석만 다시 얹는다. 커밋 메시지가 아니라 diff로 판단한다(`ea59bb6`의 메시지는 코드 수정처럼 쓰였다).
3. **문서 검증기**는 백틱 안의 경로 없는 파일 이름(예: `` `CONTRACT_DIFF.md` ``)을 `docs/`에서 찾지 못하면 경고를 하나 늘린다 — 경로를 붙여 쓴다. `--strict`의 요약 줄(「N more」)만 비교하면 놓치므로 `check_path_refs` 전체 목록을 기준선과 비교한다(6.108장).
4. **변이 스크립트는 단독으로 돌린다** — 소스를 잠깐 바꾸므로 리뷰어가 읽는 중이거나 다른 시험이 도는 중이면 둘 다 오염된다. 17차 스크립트는 죽은 시험의 이름까지 남긴다(`mutate-cr117.mjs`, 위 scratchpad).
5. 시험 중 소스를 고치면 그 실행은 증거가 아니다. 통합 시험을 중간에 죽이면 시험 DB에 찌꺼기가 남는다. 채번은 `docs/` grep과 `gh pr list --state open` 둘 다로 잰다.

## Open boundary

- **PR 병합** — 사용자 결정 대기. 병합 뒤 기록(CR-117 `closed`·WP-102 `done`, 원장 3·4장 상태)은 묻고 만든다.
- **같은 반입의 나머지 두 보고는 미착수다** — prs-commits 재색인 verify 과대 계산, prs-links 재색인 shadow 부분 갱신 실패. 원인 분석과 요청 평가는 `agent-context/todos.md` 「CR-117 뒤 남은 것」에 있다. 사내가 prs-commits를 v4로 손으로 전환했다면 그 인덱스의 상태부터 확인해야 한다.
- **사용자에게 받지 못한 답 둘** — 사내 GHE의 dev 보호 설정(force-push·삭제 금지, 직접 push 금지, squash-only, `M-*` 태그 ruleset)이 켜져 있는지, M 번호 채번 정체 경보(`mnumber_blocked_since` 기반 「N시간 이상 멈춤」)를 별도 CR로 더할지. 사용자는 17차 전반에 설명을 듣고 「이해했다」고만 했다.
- `DEV-756`(open) — 추적 브랜치 목록을 바꾸면 체인 소속이 바뀌는데 재투영 의도가 남지 않는다. 운영 조치는 `links apply` 한 번. `DEV-757`(open) — 역할 판정 규칙이 두 갈래다(보강·재구축은 체인 행의 PR 대응만, 복구는 병합 근거도). `DEV-752`는 체인 밖 커밋 몫만 남았다.
- 사내 적용은 **NOT RUN**, 사내 배포 SHA는 **NOT VERIFIED**. 반입 뒤 할 일은 RUNBOOK 7.G의 CR-117 절과 `agent-context/upstream-feedback.md` 첫 항목의 상류 반영 주석에 있다. **`ea59bb6`이 CR-113~116 주석(각 CR의 「반입 뒤 할 일」)을 지웠다** — 그 내용은 `git show 5c52aa2:agent-context/upstream-feedback.md`와 RUNBOOK 7.E·7.F·7.G에 남아 있다.
- 기존 worktree 정리(cr102/103/105/106/111/113/114/115/116 계열) — 계속 사용자 보류 중. `cr117-source-commits`도 병합 뒤 합류한다. 격리 컨테이너 `prs-cr116-*`·`prs-cr117-*` 정리도 병합 뒤, 다른 세션이 쓰지 않는지 확인하고 한다.

## References

- 변경 대장 `docs/00_governance/change_control.md`의 `CR-117`(서사·표·5장 cascade).
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 6.108장, 5장 DEV-754~DEV-757.
- 작업 꾸러미 `docs/40_delivery/pr_search_work_packages.md`의 `WP-102`.
- SRS `FR-SRCH-002` AC-7, `FR-SRCH-003` AC-5, `OD-016`. 용어집 「원본 커밋」.
- 운영 절차 `deploy/single-host/RUNBOOK.md` 7.G(CR-117 절), 관측성 RB-29.
- 상류 답변 `agent-context/upstream-feedback.md` 첫 항목.
- 17차 전반 전사 `exports/202609241738_ing.md`.
