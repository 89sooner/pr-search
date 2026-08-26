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

---

# 2026-08-26 대형 세션이 만든 것 (CR-037 · CR-038)

## 읽는 순서가 바뀐 문서

- `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 v2.2**.
  이 세션의 장: **6.32**(CR-037) · **6.33**(WP-067) · **6.31.1**(REL-003 마감 판정)
- `docs/00_governance/change_control.md` — CR-001~038. **4장 게이트 로그에
  REL-003 `fail` 행이 있다** (검증 계획이 지정한 기록 위치)
- `docs/40_delivery/pr_search_release_validation_plan.md` — **게이트 정의의 정본**.
  §3이 게이트 7종, §4가 REL별 필수 게이트(REL-003 = 2·3·4·5·6·7)

## CR-037 (동시성·권한 정정)

| 경로 | 역할 |
| --- | --- |
| `packages/db/src/advisory-lock.ts` | **세션 범위** advisory lock 신설 — `repositoryScopeLockKey`·`acquireAdvisorySessionLock`·`releaseAdvisorySessionLock`. 기존 것은 전부 트랜잭션 범위였다 |
| `packages/authz/src/team-scope.ts` | `syncRepositoryTeamScope`가 **GHE 조회~색인 반영**을 락으로 감싼다. 락을 쥔 커넥션이 정본 쓰기도 한다 |
| `apps/pipeline-worker/src/sequence.ts` | `repairSequence` 울타리 셋 + `publishSequenceReassigned`(두 경로 공유) + `markRepairStale` |
| `packages/db/src/repositories/sequence-space.ts` | `restoreSequenceState` — `state='reassigning'`일 때만 되돌린다 |
| `packages/db/src/repositories/job.ts` | `finishJobIfRunning`(CAS) · `findJobState` |
| `apps/pipeline-worker/src/consistency.ts` | `SCOPE_FIELDS`·`FINGERPRINT_FIELDS`·`repositoryScopeState`. `snapshot_bootstrap_pending` 관문 |
| `apps/pipeline-worker/src/snapshot-bootstrap.ts` | **JOB-ING-010**. 백필 러너를 잡 유형만 바꿔 재사용 |
| `packages/db/migrations/012_snapshot_bootstrap.*` | 잡 유형 + `repository.snapshot_bootstrapped_at` |

## CR-038 / WP-067 (커밋 메타데이터)

| 경로 | 역할 |
| --- | --- |
| `packages/bus/src/topics.ts` | **`LOGICAL_CONSUMERS`** — 토픽별 논리 소비자. `consumerGroup(topic, consumer?)` |
| `packages/github/src/commit-graph.ts` | `CommitMetadata`·`ChangedPaths`·`CHANGED_PATHS_LIMIT`. `FallbackCommitGraph.readCommit`이 **`null`도 폴백 사유**로 삼는다 |
| `packages/github/src/mirror-graph.ts` | `readCommit`(NUL 구분, `%B` 맨 뒤) · `changedPaths`(**첫 부모 명시**, 실패는 던진다) |
| `packages/github/src/api-graph.ts` | 같은 둘의 API 폴백. `getCommitDetail` 신설 (`patch` 필드는 타입에도 없다) |
| `packages/db/migrations/013_commit_snapshot.*` | **커밋 정본**. `projected_at`이 투영 상태 |
| `packages/db/src/repositories/commit-snapshot.ts` | `upsertCommitSnapshot`(patch_id COALESCE 보존) · `listCommitsMissingSnapshot` · `listCommitsMissingProjection` · `markCommitProjected` |
| `packages/es/src/commit-metadata.ts` | **버전을 올리지 않는 전용 업서트.** 없는 문서는 `createWith`가 있을 때만 만든다 |
| `apps/pipeline-worker/src/commit-enrich.ts` | **JOB-MIR-002**. 방아쇠 넷 + 스윕. 정본 → 색인 순서 |
| `apps/search-api/src/resolve/detail.ts` | 커밋 상세 메타데이터 + `loadSourceCommits`(batch) |
| `apps/search-api/src/sequence/neighbors.ts` | 직접 푸시 행의 커밋 문서 batch join |
| `deploy/k8s/pipeline-worker-mirror.yaml` | **신설**. PVC 포함. 없어서 JOB-MIR-001·002가 배포에 도달할 수 없었다 |
| `deploy/k8s/README.md` | 적용 순서에 mirror 추가 — **회귀가 이제 전부 있는지 본다** |

## 이 세션의 시험 (신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `packages/authz/integration/team-scope-race.test.ts` | **실 PG**. GHE 응답을 뒤집힌 순서로 끝내도 회수가 되살아나지 않는다 |
| `apps/pipeline-worker/integration/sequence/repair.test.ts` | **실 git**. walk 중 head 전진 → 커밋 안 함 → 재시도가 E까지. 취소 CAS. `reassigning` 관측 |
| `apps/pipeline-worker/integration/jobs/snapshot-bootstrap.test.ts` | 업그레이드 픽스처 6단계. 러너가 `created` 정렬을 실제로 넘기는지 |
| `apps/pipeline-worker/integration/jobs/commit-enrich.test.ts` | **실 git·PG·ES**. 직접 푸시 문서 생성·역할 교정·버전 불변·투영 재시도·폴백 |
| `packages/github/integration/graph.test.ts` | 미러 vs API 동일성, **병합 커밋 경로**, blob 0 |
| `packages/bus/integration/redis-streams.test.ts` | **실 Redis**. 두 논리 소비자가 같은 이벤트를 각각 전부 받는다 |
| `apps/search-api/src/resolve/detail.test.ts` | **호출 횟수를 직접 센다** — N+1 증명은 결과로 안 된다 |
| `regression/runtime-reachability.test.ts` | JOB-ING-010·JOB-MIR-002 추가 + **manifest가 적용 순서에 있는지** |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 baseline **v2.5**. CR 먼저
- **기존 마이그레이션을 수정하지 않는다.** 012·013은 이 세션이 신설했다
- **기본 consumer group 이름을 바꾸지 않는다** — Redis에서 읽던 자리를 잃는다
- `agent-context/`는 tracked. 전사는 `exports/`에 둔다 (`todos.md` D절)
