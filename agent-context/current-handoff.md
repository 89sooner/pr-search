# Current Handoff — 2026-09-18 PR Search 11차 (CR-106·CR-107 완료)

## Start here

`origin/main`의 최신 커밋은 `c14b9a9`(CR-107 병합 기록)다 — 머리는 `git log origin/main --oneline -5`로 읽는다. 10차가 컨텍스트 한도로 넘긴 두 항목(범위 검색·M번호 필터 = CR-106, Commit history PR 번호 병기 = CR-107) 모두 main에 반영 완료됐다. 다음 세션에 남은 새 작업 지시는 없다 — 아래 "Open boundary"와 `agent-context/todos.md`의 "11차 뒤에 남은 것"이 전부다.

## Delivered

- CR-106 / WP-092 (PR #211 → `03da17c`, 기록 PR #212 → `69a01eb`): Search 필터에 `pr_number:`(PR 번호 범위)·`mnum:`(M 번호 범위, 세대 게이트는 `merge_number_epoch`) 범위 검색과 SHA 두 개의 클라이언트 `seq:` 변환을 추가. `/search`·`/exports`·집계·W-004 범위 조사 네 API 소비처 정합성 확보. DEV-723(cursor.ts NUL 바이트) 정정, DEV-724·725(미반영, 후속 CR 후보) 등재.
- CR-107 / WP-093 (PR #213 → `95674b8`, 기록 PR #214 → `c14b9a9`): Source History 각 행에 연결 PR 번호(`pull_request_numbers: number[] | null`, 행 단위 확정/미확정) + `pull_requests_unavailable`(응답 단위 조회 실패) 추가. `prs-commits.pull_request_numbers`(기존 필드) 페이지 단위 배치 조회(N+1 금지, ADR-008 필수 범위 필터). DEV-726·727(미반영, 후속 CR 후보) 등재.
- 두 CR 모두 독립 코드 리뷰(code-review 스킬, high)를 거쳤다. 상세 설계 결정과 발견은 `docs/00_governance/change_control.md`의 `CR-106`·`CR-107` 항목이 정본이다.

## Verify before changing code

1. `git status --short --branch`가 main에서 clean인지, 다른 세션이 main에 직접 커밋했는지(`git log origin/main --oneline -5`) 본다.
2. 채번은 착수 직전에 다시 잰다: `for p in 'CR-[0-9]{3}' 'WP-[0-9]{3}' 'DEV-[0-9]{3}'; do grep -rohE "$p" docs/ | sort -u | tail -2; done` **그리고** `gh pr list --state open`(main grep만으로는 머지 대기 PR의 선점을 못 본다).
3. 통합·회귀 시험은 워크트리별 격리 DB로 돌린다(`agent-context/commands.md` 참고).
4. **`gh pr merge`는 Claude Code auto mode의 [Merge Without Review] 가드로 막힐 수 있다** — GitHub 쪽 필수 리뷰가 없어도 걸린다. 우회하지 말고 사용자에게 직접 병합을 요청한다(11차에서 실제로 두 번 겪음).
5. `gh pr checks --json name,bucket`이 이 gh 버전에서 조용히 실패할 수 있다 — CI 폴링은 `gh api repos/89sooner/pr-search/commits/<sha>/check-runs`를 쓴다.

## Open boundary

- worktree 5개(`cr102-frontend-fixes`·`cr103-infinite-scroll`·`cr105-search-fix`·`cr106-range-search`·`cr106-record`) 정리 — 사용자가 "나중에"로 보류(2026-09-18). 정리 전 스쿼시 병합 diff/patch 동등성 확인 필요.
- 0.1.0-pilot.13 사내 반입 확인 — 여전히 NOT RUN(사내 운영자 작업, 독립 트랙).
- 디자인 시스템 개선 트랙 착수 방식 — 8차 이후 계속 미결.
- REL-007 다음 판 순서 — 결정자 지시 대기.
- 후속 CR 후보(미반영 발견): DEV-724~727 — 사유는 각각 `change_control.md`의 `CR-106`·`CR-107` 항목.

## References

- https://github.com/89sooner/pr-search/pull/211 · /212 · /213 · /214
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 6.99장(CR-106)·6.100장(CR-107); 변경 대장 CR-106·CR-107.
- 이전 세션 export: `exports/202609180720.md`(context-full로 중단된 11차 전반 — 이 handoff는 그걸 이어받아 마감한 결과다).
