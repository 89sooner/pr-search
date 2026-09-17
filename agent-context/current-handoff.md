# Current Handoff — 2026-09-17 PR Search CR-100 · CR-101 (9차)

## Start here

`main`은 `3ba1c4b`(CR-101 PR #208 병합) 위에 이 기록 PR(`docs/cr100-101-merge-record`)이 얹힌 상태다 — 병합 커밋은 `git log origin/main --oneline -3`으로 읽는다. 릴리스는 발행하지 않았다(사용자 지시 없음). `0.1.0-pilot.12`는 불변이며 다음 발행(pilot.13)은 사용자 결정이다.

## Delivered

- CR-100 / WP-088 (PR #207 → `08fbc3a`): M 번호 운영자 확인서(ENT-SEQ-008, 마이그레이션 031, `prsctl mnumber attest|revoke|list`, FR-SEQ-008 AC-15), 확정 근거 보존(DEV-715), 문서 검사기 회귀 정정(DEV-716), 열어 둔 한계 DEV-717. 독립 검토 minor 3 반영.
- CR-101 / WP-089 (PR #208 → `3ba1c4b`): 병합된 PR을 `merged`로 파생(DEV-718, `derivePullRequestState`), 마이그레이션 032로 기존 스냅숏 정정. **업그레이드 뒤 `prs-pull-requests` 재색인 필요.**
- 사내 피드백 회신은 `agent-context/upstream-feedback.md` 두 항목 아래에 있다.

## Verify before changing code

1. `git status --short --branch`가 main에서 clean인지, 다른 세션이 main에 직접 커밋했는지(`git log origin/main --oneline -5`) 본다 — 9차에서 실제로 있었다.
2. 채번은 착수 직전에 다시 잰다: `grep -rohE 'CR-[0-9]{3}' docs/ | sort -u | tail -1` (CR-101 · DEV-718 · WP-089 · ENT-SEQ-008 다음).
3. 통합·회귀 시험은 워크트리별 격리 DB로 돌린다(`agent-context/commands.md` 9차 절, 메모리 `integration-tests-isolated-db-per-worktree`).
4. 마이그레이션을 더하면 `packages/db/integration`의 파수꾼 5파일(버전 목록 단언)을 함께 갱신한다.

## Open boundary

사내 확인은 전부 NOT RUN이다: `./prsctl mnumber attest …`(RUNBOOK 7.D) 뒤 저장소 119·399·1877의 M 번호 완주, `./prsctl upgrade`(032) 뒤 재색인과 Status=Merged·My merged PRs·Merged 배지·M 번호 조회. 확인서로 지나간 항목의 후발 PR은 자동 발견되지 않는다(DEV-717). 기존 문서 검사기 오류 4·경고 2는 별도 CR 후보다.

## References

- https://github.com/89sooner/pr-search/pull/207 · https://github.com/89sooner/pr-search/pull/208
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 6.94·6.95장, DEV-715~718; 변경 대장 CR-100·CR-101.
