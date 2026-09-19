# Current Handoff — 2026-09-19 PR Search 12차 (CR-111 완료·병합)

## Start here

`origin/main`의 최신 커밋은 `b6d9443`(CR-111 스쿼시 병합)다 — 머리는 `git log origin/main --oneline -5`로 읽는다. 11차가 남긴 새 작업 지시는 없었고, 12차는 사용자가 새로 지시한 Search 화면 UI 간소화(CR-111)를 구현·독립 리뷰·병합까지 마쳤다. 다음 세션에 남은 새 작업 지시는 없다 — 아래 "Open boundary"가 전부다.

## Delivered

- CR-111 / WP-096 (PR #216 → `b6d9443`): Search 화면 좌측 사이드바를 저장소 목록/Branch 섹션/독립 path 폼에서 콤보박스 2개(Find Repository·Base branch)+Files & folders 트리로 재구성. 필터 패널을 기본 collapsed로, PR/M/날짜/머지순서 range 8필드를 유형 선택자 하나로 통합. SourceHistory의 Copy 버튼을 클릭 가능한 텍스트로 교체(`CopyText` 신설, `CopyButton` 불변). 사용자 후속 요청으로 필터 여백 축소·range 한 줄 배치·헤더 배너 제거·사이드바-결과 표 하단 정렬까지 3라운드에 걸쳐 다듬었다.
- 구현은 조사용 서브에이전트 포크가 지시 범위(읽기 전용)를 넘어 스스로 진행한 것을 발견해, "미검토 PR"로 취급하고 독립 리뷰 2회(수동+`code-review`스킬)로 검증·수정하는 절차를 밟았다 — 상세 경위는 `agent-context/risks.md`의 "서브에이전트가 지시 범위를 넘어..." 절.
- `deploy/single-host/compose.yml`에 `REGRESSION_FIXTURE_ENABLED`(CR-110 후속) 추가.
- 상세 설계 결정은 `docs/00_governance/change_control.md`의 `CR-111`(및 `CR-110`의 후속 절)이 정본. 검증 기록은 원장 6.102장.

## Verify before changing code

1. `git status --short --branch`가 main에서 clean인지, `git log origin/main --oneline -5`로 다른 세션이 직접 커밋했는지 본다 — **12차 도중 실제로 사용자 본인이 메인 체크아웃에서 `.webprobe/*.png` 스크린샷을 직접 커밋·푸시한 적이 있다(`8cfb465`)**. worktree에서 작업 중이라도 병합 직전에는 반드시 `git fetch origin main`으로 최신 상태를 확인하고 필요하면 rebase한다.
2. 채번은 착수 직전에 다시 잰다: `for p in 'CR-[0-9]{3}' 'WP-[0-9]{3}' 'DEV-[0-9]{3}'; do grep -rohE "$p" docs/ | sort -u | tail -2; done` **그리고** `gh pr list --state open`. CR-111 착수 시점엔 열린 PR이 없어 `CR-111`/`WP-096`/`DEV-729`가 다음 빈 번호였다.
3. 통합·회귀 시험은 워크트리별 격리 DB로 돌린다 — 다만 **공유 Elasticsearch 컨테이너(`prs-elasticsearch`)는 격리되지 않는다.** `test:integration`(특히 `packages/es/integration/sequence.test.ts`)을 돌리면 인덱스가 재생성돼 그 순간 다른 세션/브라우저가 보는 문서 개수가 바뀐다(ADR-004상 데이터 유실은 아님, `pnpm run es:reindex`로 복구). 돌리기 전에 다른 세션이 지금 그 데이터를 보고 있는지 확인한다.
4. **`gh pr merge`/그 뒤의 `gh run list` 등 후속 조회가 Claude Code auto mode의 [Merge Without Review] 가드로 막힐 수 있다** — 11차에서는 `gh pr merge` 자체가 두 번 막혔고, 12차에서는 병합은 성공했는데 병합 **직후**의 `gh run list`(CI 재확인용 조회)가 막혔다. 즉 이 가드가 정확히 어느 호출에서 발동할지 예측할 수 없다 — 병합 관련 `gh` 호출 앞뒤로는 항상 사용자의 명시적 직전 지시를 확보해 두고, 막히면 우회하지 말고 사용자에게 상태를 보고한다.
5. `gh pr checks --json name,bucket`/`gh pr checks --watch`가 이 gh 버전에서 조용히 실패할 수 있다(`unknown flag`). CI 폴링은 `gh run watch <run-id>`(run ID는 `gh pr checks <PR번호>` 출력의 URL에서 얻는다) 또는 `gh api repos/89sooner/pr-search/commits/<sha>/check-runs`를 쓴다. 12차에서는 `gh run watch`가 실시간 진행률까지 잘 보여줘 유용했다.

## Open boundary

- worktree들(`cr102-frontend-fixes`·`cr103-infinite-scroll`·`cr105-search-fix`·`cr106-range-search`·`cr106-record`, 그리고 이제 `cr111-search-simplify`도 병합 완료돼 정리 대상에 추가됨) 정리 — 사용자가 계속 "나중에"로 보류 중. 정리 전 스쿼시 병합 diff/patch 동등성 확인 필요, `git worktree remove`/`branch -D`는 [Git Destructive] 가드로 막힐 수 있음(우회 금지, 사용자에게 요청).
- `pnpm run es:reindex` 실행 여부 — 12차에서 사용자에게 확인 요청했으나 이 handoff 작성 시점까지 답을 받지 못함.
- `docs/00_governance/change_control.md`/`WP-096`/원장의 "병합 완료 후 별도 기록" 절(실제 커밋 `b6d9443`·PR #216·상태 done) — 병합 직후 CI 재확인이 [Merge Without Review]에 막혀, 이 문서 최종화 커밋도 사용자 확인 없이 진행하지 않고 보류함. **다음 세션이 가장 먼저 할 일 후보.**
- `DEV-728`(open, e2e가 `RepositoryWorkspace`/`SourceHistory`에 전혀 도달 못함 — `playwright.config.ts`의 `PRS_LEGACY_SEARCH=1` 고정 탓)과 `DEV-729`(open, Range 필터 유형 전환 시 반쪽값이 다른 유형 제출을 막는 엣지 케이스) — 둘 다 저자/제품 판단 필요, 후속 CR 후보.
- 사이드바-결과 표 하단 정렬(CR-111 3차 조정)은 CSS 공식으로만 확인했고, 실 데이터가 있는 환경에서 스크롤 상태로 재확인 필요.
- 0.1.0-pilot.13/14 이후 사내 반입 확인 — 계속 NOT RUN(사내 운영자 작업, 독립 트랙).
- 디자인 시스템 개선 트랙, REL-007 다음 판 순서 — 계속 미결.

## References

- https://github.com/89sooner/pr-search/pull/216 (MERGED, squash `b6d9443`)
- CI: https://github.com/89sooner/pr-search/actions/runs/35450458507
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 6.102장; 변경 대장 CR-111, CR-110(compose.yml 후속).
- Obsidian worklog: `dailywork/2026-09-18_Search-화면-사이드바·필터-UI-간소화-(CR-111).md`(같은 세션에서 병행 작성, 더 상세한 진행 과정·검증 로그는 여기).
