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

---

# 2026-08-26 CR-039 / WP-029가 만든 것

## 읽는 순서가 바뀐 문서

- `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 v2.3**.
  이 세션의 장: **6.34**(WP-029 검증) · **6.34.1**(PR #44 리뷰 라운드)
- `docs/40_delivery/pr_search_work_packages.md` — **v0.4**. WP-029 범위·DoD 16항 재작성
- `docs/00_governance/change_control.md` — CR-001~039. 5장에 CR-039 반영 내역
- `docs/30_technical_architecture/pr_search_async_events_jobs.md` — **3.2·3.3장 신설**
  (참조 파생·`reference_key`·역방향 조회·해결 규칙·완전 파생 집합·전량 재파생),
  `EVT-ING-005` 행, **되먹임 금지 표**, §5.1 **재시도 예산 집행 주체**

## 참조 간선 (WP-029)

| 경로 | 역할 |
| --- | --- |
| `packages/domain/src/link/reference.ts` | **순수 파서 + 안정 식별자.** 패턴 6종·제외 구간·중복 제거·상한·`reference_key`·`parseReferenceKey`·역방향 후보 |
| `packages/es/src/links.ts` | 간선 쓰기·stale 제거·**페이지 넘기는** 역방향 조회·해결/되돌림·`link_summary` leaf 갱신·대상 해석(`msearch`) |
| `apps/pipeline-worker/src/link.ts` | **JOB-REL-001·005·006.** 파생 정본은 PostgreSQL. 방아쇠 둘. 재시도 예산 집행. 재개 가능한 재파생 러너 |
| `apps/pipeline-worker/src/commit-enrich.ts` | **`EVT-ING-005` 발행** (색인 뒤·완결 표식 **앞**) + 되먹임 가드 |
| `apps/search-api/src/ops/jobs.ts` | `OPERATOR_JOB_TYPES` — 집는 러너가 있는 유형만 |
| `deploy/k8s/pipeline-worker-link.yaml` | **신설.** `link` 역할 (미러 볼륨 불필요) |
| `packages/es/src/mappings/links.ts` | `reference_key` 추가 |
| `packages/es/src/mappings/commits.ts` | `links_pending`·`link_summary.reference_count` 추가 |
| `packages/db/src/repositories/{pr-snapshot,commit-snapshot}.ts` | `list*After` — 재개 가능한 오름차순 커서 열거 |

## 이 세션의 시험 (신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `packages/domain/src/link/reference.test.ts` | 파서 55건 — 패턴·제외·신뢰도·중복·상한·부호·역방향 후보 |
| `apps/pipeline-worker/integration/worker/link.test.ts` | **실 PG·ES.** 정본 파생·V1→V2→V3 조정·순서 역전·해결(같은 `_id`)·접두 3갈래·**해결 뒤 모호해지면 되돌림**·cross-repo·접근 통제·leaf 보존·부분 실패·페이지네이션·예산 |
| `apps/pipeline-worker/integration/worker/link-rebuild.test.ts` | **실 git·PG·ES·버스.** 직접 푸시 종단(실제 사슬)·되먹임 없음·발행 실패 시 미완결·과거 데이터·**PG-only 재구축**·결정론·운영자 잡 종단 |
| `apps/search-api/integration/admin/jobs.test.ts` | `link_rebuild` 생성 허용 + 러너 없는 유형 거절 유지 |
| `regression/runtime-reachability.test.ts` | JOB-REL-001·006 도달성 + 발행 순서 셋 + 잡 생성 경로 + 접두 재평가 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 baseline **v2.5**. CR 먼저
- **기존 마이그레이션을 수정하지 않는다.** CR-039는 새 마이그레이션을 **만들지 않았다**
- **기본 consumer group 이름을 바꾸지 않는다** — `link`와 `link:commit-enrich`
- **`link_summary`를 객체 통째로 대입하지 않는다** — leaf 소유가 WP-029/WP-030으로 갈린다
- **`detached`는 WP-030 소유다** — WP-029는 그 필드를 두지 않는다

---

# 2026-08-26 CR-040 · CR-041 / WP-030이 만든 것

## 읽는 순서가 바뀐 문서

- `docs/10_requirements/srs_final.md` — **baseline v2.6** (CR-040이 올렸다). 4.2 조건부 범위·14장 OD 표
- `docs/10_requirements/prd.md` — v1.2
- `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 v2.6.**
  이 세션의 장: **6.35**(WP-030 검증·감사 표·변이) · **6.35.1**(PR #46 리뷰 라운드)
- `docs/40_delivery/pr_search_work_packages.md` — **v0.6.** WP-030 범위·DoD **26항** 재작성, QA-W002-11·12를 WP-031로 이관
- `docs/00_governance/change_control.md` — CR-001~041. 5장에 CR-040·041 반영 내역
- `docs/30_technical_architecture/pr_search_async_events_jobs.md` — **3.4장 신설**(후보 변화 방아쇠·계열별 수명·요약 leaf 정의·실패 처분), JOB-REL-002·003·004 방아쇠 정정, 지표 2종
- `docs/30_technical_architecture/pr_search_data_model.md` — **v0.5.** `detached` 의미 확정, `link_summary` leaf **계산 규칙 표**
- `docs/30_technical_architecture/pr_search_api_contracts.md` — **v0.3.** `summary.reverted_pull_request_count` 등재
- `docs/10_requirements/requirements_screen_traceability_matrix.md` — v0.3 (SRS 버전이 오르면 같은 pass에서 대조한다는 규칙 추가)

## 마이그레이션 014 (CR-041, DEV-240)

`packages/db/migrations/014_relation_candidates.{up,down}.sql` — **인덱스 다섯, 새 표 없음.**

| 인덱스 | 지원 질의 |
| --- | --- |
| `commit_snapshot_patch_candidate_idx` | 체리픽 후보. `(repository_id, patch_id, committed_at DESC, commit_sha)` `WHERE patch_id IS NOT NULL` — **정렬까지 담아** 상위 5건이 정렬 없이 끝난다 |
| `commit_snapshot_subject_idx` | 되돌림 제목 대조(커밋). `split_part(message, E'\n', 1)` |
| `pull_request_snapshot_title_idx` | 되돌림 제목 대조(PR). `(document ->> 'title')` |
| `pull_request_snapshot_open_head_idx` | 스택 상위 후보. `WHERE document ->> 'state' = 'open'` |
| `pull_request_snapshot_base_branch_idx` | **스택 역방향(child)** — DEV-232의 경계 |

**`CREATE INDEX CONCURRENTLY`를 쓰지 않는다** — 러너가 단일 트랜잭션(`packages/db/src/migrate.ts`의 `withTransaction`). 운영 규모 무중단 적용은 **NOT RUN**.

## 관계 파생 (WP-030)

| 경로 | 역할 |
| --- | --- |
| `packages/domain/src/link/text.ts` | **신규.** 공유 텍스트 primitive — `maskExcluded`(코드 펜스·인라인·인용), `evidenceLine`, `commitSubject`, `EVIDENCE_LIMIT`. `reference.ts`가 이것을 가져다 쓴다(중복 primitive를 만들지 않는다) |
| `packages/domain/src/link/derived-id.ts` | **신규.** `derivedLinkId(link_type, from, to)` — 비참조 간선의 결정론 ID. `reference_key`를 일반화하지 않는 이유가 주석에 있다 |
| `packages/domain/src/link/revert.ts` | **신규.** `extractReverts`·`extractCommitReverts`. 트레일러(40자만, `exact`) · `Revert "<제목>"` · PR 제목 접두(`heuristic`) |
| `packages/domain/src/link/cherry.ts` | **신규.** `extractCherryPicks` — 트레일러만. `patch_id` 비교는 파서의 일이 아니다 |
| `packages/db/src/repositories/commit-snapshot.ts` | `findCommitsByPatchId`(방향 술어 `PatchCandidateBound`) · `findCommitsBySubject` · `findCommitsRevertingSha` |
| `packages/db/src/repositories/pr-snapshot.ts` | `findPullRequestsByTitle` · `findOpenPullRequestsByHeadBranch` · `findPullRequestsByBaseBranch` · `findPullRequestSnapshot` |
| `packages/es/src/links.ts` (+492줄) | `writeDerivedLinks` · `deleteStaleDerivedLinks` · `findLinksFrom`/`findLinksTo`(`search_after`로 끝까지) · `setLinkDetached` · `setLinkResolved` · **`summarizeRelations`**(한 왕복 filter 집계 넷) · `LINK_SUMMARY_SCRIPT`에 네 leaf 추가 |
| **`apps/pipeline-worker/src/relations.ts`** | **신규·핵심.** `deriveRelations`(파생→조정→양 끝점 요약) · `reevaluateAffectedRelations`(후보 변화) · `handleRelationsReady`(둘을 묶은 진입점) · `reconcileStackDetachment` · `walkChain`(깊이 10 추적) |
| `apps/pipeline-worker/src/link.ts` | `handleSourceReady`가 `handleRelationsReady`를 부른다 → **JOB-REL-006이 저절로 네 계열을 덮는다** |
| `apps/pipeline-worker/src/metrics.ts` | `linkRelationsTotal` · `linkStackCycleTotal` |
| `apps/search-api/src/sequence/range.ts` | `summary.reverted_pull_request_count` — `SUMMARY_AGGS`에 `filter` 집계 하나. **N+1 아님** |

## 이 세션의 시험 (신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `packages/domain/src/link/relations.test.ts` | 파서 22건 — 패턴·펜스 제외·중복·hex 상한·ID 결정론/방향/충돌 |
| `apps/pipeline-worker/integration/worker/relations.test.ts` | **실 PG·ES 38건.** 파생·**후보 나중 등장 수렴(source 이벤트 없이)**·stale·`detached` 수명·retarget·순환·깊이 12/13·양 끝점 요약·`links_pending` 보존·부분 실패 둘·**운영 사슬(`handleLinkEvent` + `EVT-ING-005`)**·PG-only 재구축 |
| `packages/db/integration/relation-candidates.test.ts` | 마이그레이션 014 11건 — 존재·부분 인덱스 술어·질의 결과·**EXPLAIN으로 식 일치**(`enable_seqscan=off` + `withTransaction`) |
| `regression/runtime-reachability.test.ts` (+20건) | JOB-REL-002·003·004 도달성 · 양 끝점 · 요약 전 refresh · 부분 실패 throw · `links_pending` 미간섭 · 방향 술어 위치 · retarget 역방향 · **새 역할/manifest가 없는지** |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.6**. CR 먼저
- 기존 마이그레이션을 수정하지 않는다. **014는 이 세션이 신설했다**
- 기본 consumer group 이름을 바꾸지 않는다 — `link`와 `link:commit-enrich`
- `link_summary`를 객체 통째로 대입하지 않는다. **`has_stack`은 PR 문서에만 있다** — 커밋에 쓰면 `dynamic: strict`가 거부하고, 거부하는 것이 옳다
- `links_pending`은 **참조 추출**의 완결 상태다. 관계 파생이 그 뜻을 빌려 쓰지 않는다
- `reference_key`는 `references` 전용. 세 계열은 양 끝점으로 ID를 만든다

---

# 2026-08-26 CR-042 / WP-031이 만든 것

## 읽는 순서가 바뀐 문서

- `docs/40_delivery/pr_search_implementation_traceability.md` — 원장 **v2.8**.
  이 세션의 장: **6.36**(WP-031 검증·감사 계열·e2e 귀속 표) · **6.36.1**(PR #47 리뷰 라운드).
  §7의 `flow-001` 항목에 **되돌려서 잰 관측값**을 갱신했다
- `docs/40_delivery/pr_search_work_packages.md` — **v0.8.** WP-031 범위·제외·DoD 재작성(8항 → **21항**), 관련 화면에 **W-001** 추가
- `docs/30_technical_architecture/pr_search_api_contracts.md` — **v0.4.** `### API-REL-006` 신설, `### API-REL-003` 신설(그전에는 카탈로그 한 줄뿐)
- `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` — **v0.3.** THR-034에 **구현 계약** 추가(필터 세 번·`mget` 금지·라우팅 포기)
- `docs/20_derived_ui_specs/*` 5종 — **v0.3.** C-021 두 축 상태 모델, C-015 "요약 없음 vs 관계 없음", W-001/W-002-LINKS/W-003-LINKS, FLOW-006 정정, 상태 매트릭스, QA 신설(W001-24·25 / W002-23~28 / W003-10·11)
- `docs/00_governance/change_control.md` — CR-001~**042**

## 관계 조회 (WP-031)

| 경로 | 역할 |
| --- | --- |
| `packages/es/src/relations-read.ts` | **신규.** 사용자 대면 간선 조회. **라우팅 없음** · `ScopedQuery` 강제 · `limit + 1`로 `truncated` · `assertNoShardFailures` · `link_id` 오름차순. **`links.ts` 밖에 있는 것이 설계다** (DEV-265) |
| `apps/search-api/src/relations/service.ts` | **신규.** API-REL-006 본체. 앵커 해석 → 간선 조회 → **대상 내용 batch**(종류별 1회) → 다중 후보 판정 → 신뢰도 순 정렬. `supportsAnchorKind`가 커밋+`stacks_on`을 거절 |
| `apps/search-api/src/relations/co-changes.ts` | **신규.** API-REL-003. 자격 상태 셋 · `script_score` 정확 자카드(`params.source`는 **맵**) · `_score` desc + `pr_number` asc · 겹침 사전순 10 · `PATH_IGNORE_ABOVE`로 양쪽 집합을 맞춘다 |
| `apps/search-api/src/relations/routes.ts` | **신규.** 파라미터 검증과 오류 매핑. 앵커 하나 · 끝점 조합 불가는 400 · 범위 밖은 404 |
| `apps/search-api/src/server.ts` | `registerRelationRoutes` 등록 — **여기 한 줄이 빠지면 배포에서 사라진다** |
| `apps/search-api/src/resolve/detail.ts` | 커밋 상세가 `links_pending`을 싣는다 (DEV-263) |
| `packages/es/src/architecture.test.ts` | ADR-008 가드레일에 **`mget`·`es.get`** 추가. `client.get`은 받지 않는다(Redis 핸들과 이름이 같다) |

## 화면 (WP-031)

| 경로 | 역할 |
| --- | --- |
| `apps/web/lib/relations.ts` | **신규.** 판정 순수 함수. 없는 것·모르는 것·볼 수 없는 것·해제된 것을 가른다. `LinkSummaryView`가 웹의 유일한 요약 타입이다 |
| `apps/web/components/LinkGroupList.tsx` | **신규.** C-021. `Badge`+`CodeBlock`+`Table`. `SeverityTag`를 **쓰지 않는다**(위험도 어휘라 축이 다르다) |
| `apps/web/components/RelationBadgeGroup.tsx` | **신규.** C-015. `summary === null`이면 **아무것도 그리지 않는다** |
| `apps/web/components/RelationSection.tsx` | **신규.** W-002·W-003 지연 섹션. 유형×방향마다 한 번, 펼칠 때만. 커밋은 `COMMIT_TYPES`(스택 없음) |
| `apps/web/components/CoChangeSection.tsx` | **신규.** W-002 전용. 관계 섹션과 **독립**이다 |
| `apps/web/components/ResultTable.tsx` | `ResultRow.link_summary` 배선 + 관계 열(colSpan 7 → 8) |
| `apps/web/components/{PrDetailView,CommitDetailView}.tsx` | `PendingSection` 골격 → 실제 섹션 |

## 이 세션의 시험 (신규)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/search-api/integration/relations/relations.test.ts` | 실 ES 15건. **THR-034 대적 매트릭스 넷** · cross-repo 역방향 · 상한 · **왕복 수로 센 N+1 부재** · detached·다중 후보·미해결 · **신뢰도 보고**(M5가 찾은 구멍) |
| `apps/search-api/integration/relations/co-changes.test.ts` | 실 ES 12건. **미끼 30건에 밀리지 않는 진짜 상위**(앱단 pre-limit이면 실패) · 자격 상태 셋 · 90일 **+1초** 경계 · 겹침 15개에서 상한 10 |
| `apps/search-api/integration/relations/reachability.test.ts` | `buildServerDeps`로 세운 서버에 실제 요청. **401이면 라우트가 있고 404면 없다** |
| `packages/es/src/relations-read.test.ts` | 부분 결과 처분 3 · 질의 모양 5(라우팅 부재·`limit+1`·정렬) · clamp 5 |
| `apps/web/lib/relations.test.ts` | 판정 24건 |
| `apps/web/a11y/relations.test.tsx` | 20건. 지연 조회 수 · 네 상태 · THR-020 평문 렌더 · 부분 실패 · W-001 세 상태 · axe 0 |
| `apps/web/e2e/flow-006.spec.ts` | 11건. 실제 브라우저에서 진입 0요청·펼칠 때 8요청·해제·다중 후보·대상 내용 부재·부분 실패·커밋 6요청 |
| `regression/runtime-reachability.test.ts` | +22. 라우트 등록 형태 · 라우팅 부재 · 상한 · `mget` 금지 · **면제 물려받기 금지** · 앱단 cap 부재 · 지연 조회 · **부분 결과 검사가 `hits` 앞에 있는지** |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.6**. CR 먼저
- 기존 마이그레이션을 수정하지 않는다. **CR-042는 새 마이그레이션을 만들지 않았다** — 다음은 015
- 기본 consumer group 이름을 바꾸지 않는다
- `link_summary`를 객체 통째로 대입하지 않는다. `has_stack`은 PR 문서에만 있다
- **사용자 대면 조회를 `packages/es/src/links.ts`에 넣지 않는다** — 그 파일은 ADR-008 가드레일에서 `no_requester`로 면제돼 있어 검사가 침묵한다 (DEV-265)
- **새 조회 경로는 `assertNoShardFailures`를 지나야 한다** — 다른 경로 일곱이 전부 지난다 (PR #47 리뷰 P1)
- `agent-context/`는 tracked. 전사는 `exports/`에 둔다
