# 중요 파일 경로와 역할

## 이 저장소를 읽는 순서 (문서)

1. `CLAUDE.md` — 충돌 해결 우선순위, 캐스케이드 순서, ID 규약
2. `docs/10_requirements/srs_final.md` — **baseline v2.5.** 변경은 CR 먼저
3. `docs/00_governance/change_control.md` — CR-001~036
4. `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 v1.8.**
   3장(WP 상태), 4장(FR↔코드 매핑), 5장(DEV-001~190), 6장(WP별 검증 기록),
   7장(알려진 제한), 8장(다음 작업)
5. `docs/40_delivery/pr_search_work_packages.md` — WP별 범위·제외·DoD
   (**주의: 순서표가 WP-028·068을 아직 `todo`로 표시한다 — `todos.md` 0번**)

원장의 이 세션 관련 장: **6.27.1**(WP-027 머지 후) · **6.28**(WP-028) ·
**6.28.1**(WP-028 머지 후 + 운영 도달성 표) · **6.30**(WP-068) ·
**6.30.1**(WP-068 머지 후). 릴리스 게이트는 **6.31**로 밀렸다.

## 이 세션에서 만든 소스 (CR-032~036)

### 운영 배선 · 도달성

| 경로 | 역할 |
| --- | --- |
| `apps/search-api/src/runtime.ts` | **운영 조립 이음매.** `buildServerDeps`·`buildIntegrityDeps`·`runtimeCapabilities`. `index.ts`와 시험이 **같은 함수**를 부른다 |
| `apps/search-api/src/runtime.test.ts` | 위의 단위 시험 (9건) |
| `regression/runtime-reachability.test.ts` | **"선언한 기능이 배포에서 실행되는가"만 묻는 계층.** 선언 → 기동 → 종료 → manifest. 호출 형태로 단언한다 |
| `deploy/k8s/pipeline-worker-sequence.yaml` | `sequence` 역할 배포 단위 (replica 1, `Recreate`) |
| `deploy/k8s/pipeline-worker-reconcile.yaml` | `reconcile` 역할 배포 단위 (replica 1) |

### WP-028 (정합성 점검 · 조정 스캔)

| 경로 | 역할 |
| --- | --- |
| `packages/domain/src/integrity.ts` | **대조 규칙 한 벌** — `firstSequenceMismatch`·`sampleFromSeq`. API와 잡이 함께 쓴다 |
| `packages/db/src/repositories/integrity.ts` | 점검이 읽는 것. **쓰기 질의가 없다**(DEV-171의 표현) |
| `apps/search-api/src/ops/sequence-integrity.ts` | API-ADM-007 로직 + 파서 기반 `affected_saved_search_count` |
| `apps/pipeline-worker/src/integrity.ts` | JOB-SEQ-003 스윕 |
| `apps/pipeline-worker/src/reconcile.ts` | JOB-ING-005. `updated desc` + 24h 컷오프, head 복구는 **버스 경로**, 팀 동기화 |
| `apps/pipeline-worker/src/consistency.ts` | JOB-ING-008. 정본은 **`pull_request_snapshot`**, 정규 필드 지문 대조 |
| `apps/pipeline-worker/src/snapshot.ts` | 두 투영 경로가 공유하는 정본 기록 |
| `apps/pipeline-worker/src/sequence-repair-runner.ts` | JOB-SEQ-002 수동 경로 러너 |
| `apps/pipeline-worker/src/sequence.ts` | **`repairSequence` 추가** — 검증 prefix + 최초 불일치부터 재계산 |
| `packages/db/migrations/009_job_type_reassign.*` | `sequence_reassign` 유형 (DEV-128 해소) |
| `packages/db/migrations/010_pr_snapshot.*` | `pull_request_snapshot` (ADR-004 근거) |

### WP-068 (팀 접근 범위)

| 경로 | 역할 |
| --- | --- |
| `packages/authz/src/team-scope.ts` | **공유 동기화** — `syncRepositoryTeamScope`·`refreshTeamScope`. 색인은 포트로 받는다 |
| `packages/db/migrations/011_repository_teams.*` | `repository.allowed_team_ids` + GIN |
| `packages/github/src/client.ts` | `listRepositoryTeams` 신설, `listPullRequestsPage`에 `direction`(기본 asc) |
| `packages/es/src/registry.ts` | **`TEAM_SCOPED_ALIASES`(네 색인)** + `applyRepositoryTeams` |
| `apps/pipeline-worker/src/documents.ts` | `repositoryScope()`가 `allowed_team_ids`를 싣는다 |
| `apps/pipeline-worker/src/authz.ts` | `permission.invalidated` 소비자에 소급 적용 |
| `apps/search-api/src/ops/repositories.ts` | `syncRepositoryTeams` — 공유 구현에 위임 |

### 시험 (이 세션 신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/pipeline-worker/integration/sequence/repair.test.ts` | **실제 git 저장소**로 same-head 중간 손상 복구. 자동 경로가 못 고친다는 사실 자체를 단언 |
| `apps/search-api/integration/ops/sequence-integrity.test.ts` | API-ADM-007 + **운영 조립으로 서버를 세워** 라우트 실재 확인 |
| `apps/search-api/integration/authz/team-scope-es.test.ts` | **실제 Elasticsearch** — `team:` 매칭, 회수 후 비가시화, `document_version` 불변 |
| `packages/db/integration/{job-type-reassign,pr-snapshot}.test.ts` | CHECK 제약·버전 순서·멱등 |
| `packages/authz/src/team-scope.test.ts` | 회수 반영, 색인 실패 시 되돌림, `repository_id` 사용 |

## 이전 세션 파일 (WP-026·WP-027, 보존)

| 경로 | 역할 |
| --- | --- |
| `packages/db/src/repositories/release.ts` | `listReleaseTimeline`, `findContainingReleases` 판정 통일(DEV-160) |
| `apps/search-api/src/sequence/{releases-list,release-comparison}.ts` | API-REL-005 / API-SEQ-003 |
| `apps/search-api/src/sequence/neighbors.ts` | API-REL-001. **CR-032로 `base_branch` 필수화** |
| `apps/web/components/NeighborSequenceList.tsx` | C-019 + `NeighborSection`. **CR-032로 재시도 버튼** |
| `apps/web/components/{PrDetailView,CommitDetailView}.tsx` | W-002·W-003 배선 |
| `apps/web/lib/{release,neighbors}.ts` | 화면 판정 |

## 재사용 계층 (다음 WP가 딛을 것)

| 경로 | 무엇 |
| --- | --- |
| `packages/db/src/repositories/job.ts` | `claimNextJob`(advisory lock) — 새 큐 틀을 만들지 않는다 |
| `apps/pipeline-worker/src/release.ts` | `startReleaseSweeper` — **깨울 수 있는 sleep** 선례 |
| `apps/search-api/src/sequence/space.ts` | `resolveRepository`·`resolveSpace` — 접근 통제의 유일한 관문 |
| `packages/github/src/commit-graph.ts` | `firstParentCommits` — 정합성 대조의 정답지 |
| `apps/pipeline-worker/integration/sequence/fixture.ts` | **실제 git 저장소 픽스처** — `createSequenceFixture` 등 |
| `packages/es/src/registry.ts` | `markRepositoryArchived` — 소급 `update_by_query` 선례 |

## 손대면 안 되는 것

- `docs/10_requirements/srs_final.md`는 baseline이다. CR 먼저.
- 하위 문서는 SRS 범위를 넓힐 수 없다. 넓혀야 하면 SRS를 고친다(CR-031·033 선례).
- **기존 마이그레이션을 수정하지 않는다.** 넓히는 변경은 언제나 새 번호다.
- `agent-context/`는 tracked다. `.gitignore`에 넣지 않는다.
- **세션 전사는 `exports/`에 있다** (`202608251453.md` · `202608260047.md`).
  `.gitignore` 대상이고 **compact 하지 않는다** — 인계 pack의 입력이 아니다.
  `/export`가 떨어뜨리는 원본 대화 기록이며 소스가 아니다.
