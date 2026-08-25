# 중요 파일 경로와 역할

## 이 세션에서 만든/고친 소스

### WP-026 (PR #32, 머지됨)

| 경로 | 역할 |
| --- | --- |
| `packages/db/src/repositories/release.ts` | `listReleaseTimeline`(LATERAL로 현재 에폭 재조인 + `lag` 윈도우), `findLatestRelease`, **`findContainingReleases`·`findLatestReleaseSeq` 판정 통일(DEV-160)** |
| `apps/search-api/src/sequence/releases-list.ts` | API-REL-005 — 저장소 스코프 목록, `reason`·`truncated` |
| `apps/search-api/src/sequence/release-comparison.ts` | API-SEQ-003 — `planComparison`(서수 기준 정규화·`to=unreleased`), `comparisonFailureCode` |
| `apps/web/lib/release.ts` | W-005 판정. `judgeSelection`·`compareHref`·**`unreleasedHref`(`seq:` 접두)**·`hasStartAnchor` |
| `apps/web/components/ReleaseTimeline.tsx` | C-032 |
| `apps/web/components/ReleasesView.tsx` | W-005 오케스트레이션. 상세는 **행의 공간**으로 묻는다, 재조회 방아쇠 `reloadToken` |
| `apps/web/app/releases/page.tsx` | `/releases` 라우트 |

### WP-027 (PR #33, 열림)

| 경로 | 역할 |
| --- | --- |
| `packages/db/src/repositories/merge-sequence.ts` | `findNeighbors`(before/anchor/after CTE, 서수 오름차순) |
| `apps/search-api/src/sequence/neighbors.ts` | API-REL-001 로직. 앵커 두 갈래, 409 사유 분리, 표시값 색인 보강 |
| `apps/web/lib/neighbors.ts` | 판정. `judgeNeighbors`·`judgeNoSequence`·**`neighborRangeHref`**·`judgeNeighborEpoch` |
| `apps/web/components/NeighborSequenceList.tsx` | **C-019 + `NeighborUnavailable` + `NeighborSection`(컨테이너)** — 한 파일에 셋 |
| `apps/web/components/PrDetailView.tsx` | W-002 배선 (PendingSection → NeighborSection) |
| `apps/web/components/CommitDetailView.tsx` | W-003 배선 (커밋 앵커, 체인 밖/미채번은 무조회) |
| `apps/search-api/src/sequence/routes.ts` | 라우트 등록 — `SEQUENCE_NEIGHBORS_PATH`, `RELEASES_PATH`, `RELEASE_COMPARISON_PATH` |

### 시험

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/search-api/integration/release/timeline.test.ts` | API-REL-005·API-SEQ-003 (24건) |
| `apps/search-api/integration/release/containment.test.ts` | **DEV-160 회귀 시험 추가**, 기대 5건 정정, 픽스처에 서수 5 추가 |
| `apps/search-api/integration/sequence/neighbors.test.ts` | API-REL-001 (20건) |
| `apps/search-api/src/sequence/range.test.ts` | `size=0`이 항목 질의를 **정말** 건너뛰는지 질의 계수로 |
| `apps/web/lib/{release,neighbors}.test.ts` | 판정 단위 (26 / 15) |
| `apps/web/a11y/{releases,pr-detail,commit-detail}.test.tsx` | 상태 렌더 + **요청 계수** + axe |
| `apps/web/e2e/{flow-003-releases,flow-002}.spec.ts` | 실제 브라우저 왕복. **앵커 대역이 표현을 판정한다** |

## 이 저장소를 읽는 순서 (문서)

1. `CLAUDE.md` — 충돌 해결 우선순위, 캐스케이드 순서, ID 규약
2. `docs/10_requirements/srs_final.md` — **baseline v2.4.** 변경은 CR 먼저
3. `docs/00_governance/change_control.md` — CR-001~031
4. `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 v1.4.**
   3장(WP 상태), 4장(FR↔코드 매핑), 5장(DEV-001~167), 6장(WP별 검증 기록),
   7장(알려진 제한), 8장(다음 작업)
5. `docs/40_delivery/pr_search_work_packages.md` — WP별 범위·제외·DoD

## 재사용할 계층 (WP-028이 딛을 것)

| 경로 | 무엇 |
| --- | --- |
| `packages/db/src/repositories/job.ts` | `claimNextJob`(advisory lock, WP-019) |
| `apps/pipeline-worker/src/mirror-runner.ts` | `startMirrorSweeper` — 주기 스케줄러 선례 (깨울 수 있는 sleep) |
| `apps/pipeline-worker/src/release.ts` | `startReleaseSweeper` — 같은 형태 |
| `packages/db/src/repositories/audit.ts` | `recordAudit` (FR-ADMIN-003 AC-5) |
| `packages/metrics/src/index.ts` | `Counter` |
| `packages/github/src/commit-graph.ts` | `firstParentCommits` — 정합성 대조의 정답지 |
| `apps/search-api/src/sequence/space.ts` | `resolveRepository`·`resolveSpace` — **접근 통제의 유일한 관문** |

## 손대면 안 되는 것

- `docs/10_requirements/srs_final.md`는 baseline이다. CR을 먼저 등록하지 않고
  고치지 않는다.
- 하위 문서(파생 UI·기술 아키텍처·딜리버리)는 SRS 범위를 **넓힐 수 없다.**
  넓혀야 하면 CR-031처럼 SRS를 고친다.
