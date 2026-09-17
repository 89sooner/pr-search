# Current Handoff — 2026-09-17 PR Search pilot.13 (9차)

## Start here

`0.1.0-pilot.13`이 발행됐다 — 불변 GitHub Release, 태그 `3ba1c4b`(CR-101 병합, 마지막 기능 커밋). main은 그 위에 병합 기록(`ac130e3`), 다른 세션의 이미지 파일(`936de9f`), 이 발행 기록 PR(`docs/pilot13-release-record`)이 얹힌 상태다 — 머리는 `git log origin/main --oneline -5`로 읽는다. 정정이 필요하면 자산·태그를 바꾸지 않고 새 버전(pilot.14)을 낸다.

## Delivered

- CR-100 / WP-088 (PR #207 → `08fbc3a`): M 번호 운영자 확인서(ENT-SEQ-008, 마이그레이션 031, `prsctl mnumber attest|revoke|list`, FR-SEQ-008 AC-15), 확정 근거 보존(DEV-715), 문서 검사기 회귀 정정(DEV-716), 열어 둔 한계 DEV-717.
- CR-101 / WP-089 (PR #208 → `3ba1c4b`): 병합된 PR을 `merged`로 파생(DEV-718), 마이그레이션 032로 기존 스냅숏 정정.
- `0.1.0-pilot.13`: 자산 `pr-search-0.1.0-pilot.13-offline.tar.gz` 1,154,497,950 bytes, SHA-256 `f94f022378dd04cb04965e3596c2fe31321460cb64ca5763d78a91629471f7d3`(GitHub digest와 일치), smoke 20건, 발행 전·후 이미지 확인(새 CLI·도메인 헬퍼·031·032). 기록은 원장 머리 절.

## Verify before changing code

1. `git status --short --branch`가 main에서 clean인지, 다른 세션이 main에 직접 커밋했는지(`git log origin/main --oneline -5`) 본다 — 9차에서 두 번 있었다.
2. 채번은 착수 직전에 다시 잰다: `grep -rohE 'CR-[0-9]{3}' docs/ | sort -u | tail -1` (CR-101 · DEV-718 · WP-089 · ENT-SEQ-008 다음).
3. 통합·회귀 시험은 워크트리별 격리 DB로 돌린다(`agent-context/commands.md` 9차 절).
4. 긴 발행·빌드는 분리 세션(`setsid nohup`) + Monitor로 돌린다 — 하네스 백그라운드는 메모리 압박에서 끊긴다.

## Open boundary

사내 반입은 NOT RUN이다. 사내 운영자에게 별도 채널로 버전·읽기 토큰·SHA-256을 전달한 뒤: `gh release download 0.1.0-pilot.13` → `sha256sum` 대조 → `./prsctl verify && ./prsctl load` → `./prsctl upgrade`(031·032) → 운영 콘솔 `prs-pull-requests` 재색인(Merged 필터·My merged PRs·Merged 배지) → `./prsctl mnumber attest …`(번들 RUNBOOK 7.D) → 저장소 119·399·1877 M 번호 완주. 결과는 `agent-context/upstream-feedback.md` 두 항목 아래에 적는다. DEV-717(확인서로 지나간 항목의 후발 PR 자동 발견 없음)과 기존 문서 검사기 오류 4·경고 2는 별도 CR 후보다.

## References

- https://github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.13
- https://github.com/89sooner/pr-search/pull/207 · https://github.com/89sooner/pr-search/pull/208 · https://github.com/89sooner/pr-search/pull/209
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 머리 절(pilot.13)·6.94·6.95장, DEV-715~718; 변경 대장 CR-100·CR-101.
