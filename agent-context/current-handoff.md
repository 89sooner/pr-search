# Current Handoff — 2026-09-25 PR Search 18차 진행 중 (CR-118·CR-119·CR-120 병합, 작업 B 착수 전)

## Start here

- **main은 `e94cb4f`다.** 18차 착수 지시(사용자, 2026-09-24)의 P0와 작업 A가 끝났다.
  - P0 = **CR-118**(PR #232 → main `0dd7734`, 기록 PR #233 → `9dd2644`): main CI의 FLOW-002 뒤로가기 e2e 실패는 시험의 대기 문제였다(DEV-758).
  - **CR-120**(PR #234 → main `e181751`): CR-118 기록 PR의 CI에서 드러난 `link-rebuild.test.ts` 되먹임 시험의 정적 대기 경합이다(DEV-765).
  - 작업 A = **CR-119 / WP-103**(PR #235 → main `e94cb4f`): prs-commits 재색인의 기대 집합과 메타데이터 복원이다(FR-ING-008 AC-10, DEV-759~764). 병합 커밋의 main CI(run 36055350099)는 success다.
  - **병합 기록 PR**(CR-119·CR-120을 한 PR로, 브랜치 `docs/cr119-cr120-merge-record`)이 이 인계를 싣는다. 병합됐는지 먼저 실측한다.
- **다음 할 일은 작업 B다**(prs-links 재색인 — CR-121·WP-104·FR-ING-008 AC-11은 예정 번호라 등록 직전에 다시 잰다). 지시서 6~7장이 범위를 정했고, 사용자가 2026-09-25에 하나를 더 정했다: **해제된 `stacks_on` 이력을 PostgreSQL에 저장하고, 스택 간선은 PG 상태의 전체 쓰기로 바꾸며, 배포 전부터 서비스 인덱스에만 있는 해제 간선은 일회성 가져오기 명령으로 PG에 옮긴다.** 재현 시험 두 사례가 수정 전 코드에서 실패한다(아래 Delivered).
- **병합 승인은 세션마다 다시 받는다.** 이어가기 세션에서는 이전 세션 지시서의 병합 승인이 자동 모드에서 인정되지 않았다(`[Merge Without Review]`). 사용자는 이 세션에서 「병합해도 됩니다」로 PR #234와 이후 지시서 범위의 병합(리뷰·CI 통과 조건)을 승인했다. 새 세션이면 첫 병합 전에 다시 묻는다.

머리는 늘 실측한다: `git fetch && git log origin/main --oneline -5`, `gh pr list --state open`.

18차 전사는 둘이다. 첫 세션은 context-full로 끊겼고 전사는 `exports/202609250420_ing.md`다. 이어가기 세션의 전사는 마감 때 export한다 — 있는지와 크기를 먼저 본다.

## Delivered (18차, 지금까지)

- **CR-118** — 첫 `goBack()`이 커밋 상세를 새 문서로 다시 불러온 뒤 수화 전에 두 번째 `goBack()`을 부르면 App Router가 popstate를 놓친다. 두 번째 뒤로가기 전에 `data-screen-state="ready"`를 기다리고 세션 히스토리를 판정한다. 원장 6.109장.
- **CR-120** — 두 소비자가 받은 `commit.metadata_ready` 수가 같고 조용해질 때까지 `until`로 기다린다(시한은 `until` 경로의 표준 20초). 원장 6.110장.
- **CR-119** — 재구축 순서(체인 → PR 유래 → 원본 커밋 메타데이터 → 관계 replay), 대상 결과 판정, 보존된 `source` 연결의 커밋 복원, 전환 전 검증의 정본 기대 집합·필수 ID·메타데이터 값·대상 UUID 대조. 최종 트리 게이트 전부 통과, 변이 11종 모두 죽음, 코드·문서 독립 리뷰 상·중 0건. RUNBOOK 7.H(사내 수동 v4 전환 확인과 재구축). 원장 6.111장.
- **작업 B 준비** — 재현 시험 `apps/pipeline-worker/integration/jobs/links-reindex-completeness.test.ts`(워크트리 `links-reindex`, **미추적**)의 두 사례가 수정 전 코드에서 실패한다: (1) 간선 주인이 대상보다 뒤에 처리되면 `shadow_write_failed`(사내 보고와 같다), (2) 상위 PR 병합으로 해제된 스택 간선이 재색인 뒤 사라진다(잡은 `completed`로 끝나고 새 인덱스에 간선이 없다). 코드로 확인한 결함 경로와 설계 뼈대는 이 세션 scratchpad의 `b-design.md`에 있다.

## Verify before changing code

1. **격리 인프라** — `prs-s18-postgres`(127.0.0.1:55450)·`prs-s18-es`(127.0.0.1:59215, `cluster.name=prs-s18-isolated`)·`prs-s18-redis`(127.0.0.1:56394). 환경 파일은 `/tmp/claude-1000/-home-roqkf-pr-search/fb3dbfa9-f252-4a65-aa39-b7d31493105d/scratchpad/env-s18.sh`(Node 22 경로 포함 — 셸 기본 Node는 v20). 전량 시험 DB는 `prs_test_s18a`(게이트 스크립트가 매번 새로 만든다), 부분 확인은 `prs_test_s18c`를 쓴다. 옛 `prs-cr117-*`는 사용자 지시로 보존한다.
2. **B 워크트리** `/home/roqkf/pr-search-wt/links-reindex`는 A의 옛 head `d5da4be` 위다. A가 squash 병합됐으므로 rebase하지 말고 `git switch --detach origin/main && git switch -c <새 브랜치>`로 옮긴다(미추적 재현 시험은 그대로 남는다).
3. **재현 시험의 저장소 준비** — `upsertRepository`는 `allowed_team_ids`를 쓰지 않는다. `setAllowedTeams`를 따로 불러야 간선의 범위 필드가 실제 값이 된다.
4. **새 마이그레이션(037)** 을 더하면 파수꾼 6파일의 단계 수와 버전 배열을 함께 고친다.
5. **스크립트** — 게이트 `run-gates.sh`, 문서 검증 `docval.sh`, 변이 본보기 `mutate-a.mjs`는 첫 세션 scratchpad(`fb3dbfa9…`)에 있다. 변이는 단독으로 돌리고, 시험 중 소스를 고치면 그 실행은 증거가 아니다.
6. 사용자는 `agent-context/upstream-feedback.md`를 main에서 통째로 덮는다. diff로 판단하고 상류 반영 주석만 다시 얹는다.

## Open boundary

- 병합 기록 PR(CR-119·CR-120) 병합.
- 작업 B 전체 — 재현 → 설계 → 구현 → 검증 → 독립 리뷰 → PR → 병합 → 기록.
- 사내(NOT RUN): CR-119 RUNBOOK 7.H(수동 v4 전환 확인과 새 빌드의 재구축), CR-117의 저장소마다 `links apply`. 사내 배포 SHA는 NOT VERIFIED다.
- 사용자 보류: 사내 GHE dev 보호 설정(미확인), M 번호 채번 정체 경보 CR, DEV-756·DEV-757, 옛 worktree·컨테이너 정리.
- DEV-758 잔여: `linked-pr-link`를 클라이언트 `<Link>`로 바꾸면 첫 뒤로가기의 창이 사라지지만, 「진짜 링크」 설계를 바꾸는 제품 변경이라 CR 대상이다.

## References

- 변경 대장 `docs/00_governance/change_control.md`의 CR-118·CR-119·CR-120(서사·표·5장 cascade와 병합 판정).
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 6.109~6.111장, 5장 DEV-758~DEV-765.
- 작업 꾸러미 `docs/40_delivery/pr_search_work_packages.md`의 WP-103.
- SRS `FR-ING-008` AC-10, 운영 절차 `deploy/single-host/RUNBOOK.md` 7.H.
- 상류 답변 `agent-context/upstream-feedback.md` 둘째 항목(CR-119 주석). 셋째 항목(prs-links)은 B가 답한다.
- 세션 노트 `agent-context/session-notes.md` 「18차」, todos 「18차 뒤 남은 것」.
