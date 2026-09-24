# Current Handoff — 2026-09-24 PR Search 17차 마감 (CR-117 병합 완료, 다음 세션은 새 CR)

## Start here

- **main은 `65acf83`이다.** CR-117 / WP-102(PR [#230](https://github.com/89sooner/pr-search/pull/230))가 사용자 지시(「origin/main에 병합해라」)로 squash 병합됐다. PR CI와 main CI(run 35993248300) 모두 success였다. 사용자 결정 `OD-016`: **원본 커밋은 그 PR이 새로 가져온 커밋이고, 추적 브랜치의 현재 체인에 이미 오른 커밋은 그 커밋을 체인에 올린 PR에만 속한다.**
- **병합 기록 PR [#231](https://github.com/89sooner/pr-search/pull/231)이 열려 있다**(브랜치 `docs/cr117-merge-record`). CR-117 `closed`·WP-102 `done`, 원장 4장에 「병합 전」으로 남아 있던 CR-113~116 행 11개 정정, 그리고 이 17차 마감 인계가 들어 있다. 병합은 사용자 결정이다 — 먼저 병합됐는지 실측한다.
- **다음 할 일: 같은 반입(pilot.18)의 나머지 두 보고를 새 CR로 연다**(사용자 지시 「새 CR을 열어서 진행해야 되는 건 다음 세션에서 하자」). prs-commits 재색인 verify 과대 계산과 prs-links 재색인 shadow 부분 갱신 실패다. **둘 다 사내 반입 없이 외부에서 재현·수정할 수 있다.** 권고 순서는 prs-commits 먼저이고(숨은 메타데이터 누락 가능성, 범위가 더 큼), 순서는 착수 때 사용자에게 확인한다. 원인·요청 평가·재현 방향은 `agent-context/todos.md` 「CR-117 뒤 남은 것」에 있다.

머리는 늘 실측한다: `git fetch && git log origin/main --oneline -5`, `gh pr list --state open`. 로컬 공유 checkout(`/home/roqkf/pr-search`)의 main은 17차 마감 때 `ea59bb6`에 머물러 있었다(당겨 오지 않았다).

17차는 두 세션이다. 전반은 context-full로 끊겼고 전사는 `exports/202609241738_ing.md`다. 후반 전사는 `exports/202609242133.md`로 **pending /export**다 — 있는지와 크기를 먼저 본다.

## Delivered (17차)

- **CR-117 / WP-102** — 유효 연결 술어 `EFFECTIVE_LINK_SQL`(`packages/db/src/repositories/pr-commit-link.ts`) 하나를 관계를 읽는 모든 질의(관계 투영 JOB-REL-008, 재색인 replay·전환 전 검증, 복구 대조, 미확정 계수)가 쓴다. 원시 관측은 지우지 않는다. 채번·강제 푸시 재채번·복구 재채번이 같은 트랜잭션에서 재투영 의도를 남기고, PR 투영·재색인은 체인 커밋의 역할을 덮지 않는다(DEV-755). PR 상세는 `source_commits_excluded`를 싣고 화면이 이유를 보여 준다(PSI D-22). 복구 `prsctl links plan|apply`가 체인 규칙 몫을 지우고 덮인 역할을 되돌린다.
- 검증: 전 계층 게이트 통과, 변이 17종 모두 죽음, 문서 검증기 기준선 동일, 독립 리뷰 상급 0건(지적 넷은 문서·DEV로 처리 — DEV-756·757 open). 기록은 원장 6.108장.
- 병합 기록 PR #231.
- 메모리: `upstream-feedback-sync-overwrites`(사용자가 그 파일을 main에서 통째로 덮는다), `cr117-pr230-state-2026-09-24`.

## Verify before changing code

1. **격리 인프라** — `prs-cr117-postgres`(55447)·`prs-cr117-es`(59213, `cluster.name=prs-cr117-isolated`)·`prs-cr117-redis`(56392)가 떠 있다. 환경은 `/tmp/claude-1000/-home-roqkf-pr-search/0d27507c-884e-4d77-8162-a5e8ed12b90a/scratchpad/env-cr117.sh`(Node 22 경로 포함 — 셸 기본 Node는 v20). 새 CR은 시험 DB를 따로 만든다(`prs_test_<이름>`). ES `cluster.name`에 `isolated|test|ci`가 없으면 파괴적 시험 5파일이 스스로 실행을 거부한다(DEV-737).
2. **사용자는 `agent-context/upstream-feedback.md`를 main에서 통째로 덮는다**(09-22 `aeb2b8e`, 09-24 `ea59bb6`). 기능 브랜치가 같은 파일을 고치면 rebase 때 충돌한다 — main 쪽을 채택하고 상류 반영 주석만 다시 얹는다. 커밋 메시지가 아니라 diff로 판단한다.
3. **문서 검증기**는 기준선을 `git archive <sha> | tar -x`로 **전체 트리**에서 만든다(`docs`만 풀면 `handoff/` 참조가 해석되지 않는 가짜 차이가 난다). 백틱 안의 경로 없는 파일 이름은 경고를 늘리므로 경로를 붙여 쓰고, `--strict` 요약 줄이 아니라 `check_path_refs` 전체 목록을 비교한다.
4. **변이 스크립트는 단독으로 돌린다** — 소스를 잠깐 바꾸므로 리뷰어나 다른 시험과 겹치면 둘 다 오염된다. 17차 스크립트는 죽은 시험의 이름까지 남긴다(`mutate-cr117.mjs`, 위 scratchpad).
5. 시험 중 소스를 고치면 그 실행은 증거가 아니다. 채번은 `docs/` grep과 `gh pr list --state open` 둘 다로 잰다. `git switch -c <br> origin/main`은 새 브랜치가 main을 추적하게 만드니 곧바로 `git branch --unset-upstream`하고, push는 브랜치 이름을 명시한다.

## Open boundary

- **PR #231 병합** — 사용자 결정.
- **나머지 두 보고의 새 CR** — 다음 세션 첫 일. 순서 확인부터.
- **사용자 답 대기 둘** — 사내 GHE dev 보호 설정(force-push·삭제 금지, 직접 push 금지, squash-only, `M-*` 태그 ruleset)이 켜져 있는지, M 번호 채번 정체 경보를 별도 CR로 더할지. 17차 전반에 설명했고 사용자는 「이해했다」고만 했다.
- `DEV-756`(추적 브랜치 목록 변경 시 재투영 없음 — 운영 조치는 `links apply` 한 번)·`DEV-757`(역할 판정 두 갈래) open, `DEV-752`는 체인 밖 커밋 몫만 남았다.
- 사내 적용 **NOT RUN**, 사내 배포 SHA **NOT VERIFIED**. **반입 뒤 저장소마다 `--pr` 없는 `links apply`가 꼭 필요하다**(RUNBOOK 7.G CR-117 절, 상류 주석). 사내에서 prs-commits를 v4로 손으로 전환했다면 세 가지를 확인한다: 실패~전환 사이 쓰기 누락, v4의 `role: source_commit` 문서에 메시지·작성자가 있는지, v3가 남아 있는지(자동 삭제되지 않는다). `ea59bb6`이 지운 CR-113~116 주석의 「반입 뒤 할 일」은 `git show 5c52aa2:agent-context/upstream-feedback.md`와 RUNBOOK 7.E~7.G에 남아 있다.
- 기존 worktree 정리(cr102/103/105/106/111/113/114/115/116 계열) — 계속 사용자 보류 중. `cr117-source-commits`는 지금 `docs/cr117-merge-record` 브랜치라 PR #231 병합 뒤에 합류한다. 격리 컨테이너 `prs-cr116-*`·`prs-cr117-*` 정리도 다른 세션이 쓰지 않는지 확인하고 한다.

## References

- 변경 대장 `docs/00_governance/change_control.md`의 `CR-117`(서사·표·5장 cascade와 병합 판정).
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 6.108장, 5장 DEV-754~DEV-757.
- 작업 꾸러미 `docs/40_delivery/pr_search_work_packages.md`의 `WP-102`.
- SRS `FR-SRCH-002` AC-7, `FR-SRCH-003` AC-5, `OD-016`. 용어집 「원본 커밋」.
- 운영 절차 `deploy/single-host/RUNBOOK.md` 7.G(CR-117 절), 관측성 RB-29.
- 상류 답변 `agent-context/upstream-feedback.md` 첫 항목. 나머지 두 보고의 원문은 같은 파일의 둘째·셋째 항목.
- 세션 노트 `agent-context/session-notes.md` 「17차」, 전사 `exports/202609241738_ing.md`(전반)·`exports/202609242133.md`(후반, pending /export).
