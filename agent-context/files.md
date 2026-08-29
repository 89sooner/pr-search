# 중요 파일 경로와 역할

## 이 저장소를 읽는 순서 (문서)

1. `CLAUDE.md` — 충돌 해결 우선순위, 캐스케이드 순서, ID 규약
2. `docs/10_requirements/srs_final.md` — **baseline v2.10** (2026-08-28 기준). 변경은 CR 먼저
3. `docs/00_governance/change_control.md` — CR-001~**050**
4. `docs/40_delivery/pr_search_implementation_traceability.md` — **원장 review v4.6.**
   3장(WP 상태), 4장(FR↔코드 매핑), 5장(DEV-001~**358**), 6장(WP별 검증 기록 — 최신 **6.42**),
   7장(알려진 제한), 8장(다음 작업)
5. `docs/40_delivery/pr_search_work_packages.md` — **v1.8.** WP별 범위·제외·DoD

> **이 절의 버전 숫자는 갱신일 기준의 스냅숏이다.** 상태는 언제나 `HEAD`의 문서 헤더에서 읽는다 —
> CLAUDE.md가 같은 규율을 정한다.

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

---

# 2026-08-26 CR-043~047이 만든 것 (계약 경화 5연발)

**코드 변경은 셋뿐이다.** 나머지는 전부 문서다 — 이 세션은 감사와 계약이었지 구현이 아니었다.

## 읽는 순서가 바뀐 문서

| 경로 | 버전 | 이 세션이 바꾼 것 |
| --- | --- | --- |
| `docs/10_requirements/srs_final.md` | **baseline v2.8** | v2.7(CR-043): FR-SEQ-002 **AC-6·7·8** 신설, FR-SRCH-009 관련 화면에 **W-004**. v2.8(CR-044): **AC-7의 봉인 값을 "완결 서수"로 정정** |
| `docs/10_requirements/prd.md` | v1.3 | SCN-002 패싯 목록을 SRS와 맞춤 |
| `docs/10_requirements/requirements_screen_traceability_matrix.md` | v0.5 | FR-SRCH-009에 W-004 추가, **FR-SRCH-008에서 W-004 제거**(정본이 다른 두 순회를 갈랐다), FR-SEQ-002에 커서·패싯 소유 명시 |
| `docs/30_technical_architecture/pr_search_api_contracts.md` | **v0.7** | API-SRCH-004에 **「커서 계약」·「패싯 계약」·「전문 검색 계약」** 세 절, API-SEQ-001에 **「구간 커서와 패싯」**, **API-ADM-004 상세 절 신설** |
| `docs/30_technical_architecture/pr_search_async_events_jobs.md` | **v0.3** | **3.5장 신설** — JOB-ING-006. 불변식 아홉 · **이중 쓰기 대상 열일곱 전수** · 울타리 · 정본 재구축 · 전환 검증 일곱 · 실패/취소 다섯 · 보관 |
| `docs/30_technical_architecture/pr_search_architecture_decision_records.md` | v0.4 | **ADR-010 Amendment** — 이 결정이 덮는 범위(색인이 결과 집합을 소유하는 조회) · 봉투 무결성 · **모든 순회에 PIT** |
| `docs/30_technical_architecture/pr_search_infrastructure_operations.md` | **v0.4** | 배포 단위 표에 `mirror`·`reconcile` 등재, `batch` 상한을 **`1 / 1`**로, **표와 `deploy/k8s/`가 서로를 검사한다**는 규칙 |
| `docs/30_technical_architecture/pr_search_backend_architecture.md` | v0.3 | 깊은 페이징을 W-001·W-004로 갈랐고, 패싯을 **별도 요청 + 1.5초** |
| `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` | v0.4 | THR-003(패싯 집계도 `ScopedQuery`)·THR-014(PIT 자원)·**THR-018(강조의 raw HTML 금지)** |
| `docs/20_derived_ui_specs/*` 4종 | v0.4~v0.5 | C-012 `failed` 상태·C-016 커서 규칙 / W-001·W-004 패싯 축 / 커서 오류 상태 넷 / QA-W001-26~29·QA-W004-23~29 |
| `docs/40_delivery/pr_search_work_packages.md` | **v1.1** | **WP-032 전면 재작성**(선행에 WP-035), **WP-035 전면 재작성**, 3장 순서표를 **실행 순**으로 |
| `docs/40_delivery/pr_search_implementation_roadmap.md` | v0.4 | 의존성 지도에 WP-035 → WP-032, REL-004 실행 순서 |
| `docs/40_delivery/pr_search_implementation_traceability.md` | **v3.4** | DEV-266~312 등록, **6.37 · 6.37.1 · 6.38 · 6.38.1장 신설**, §7의 flow-001 항목 정정(**CI에서도 재현된다**) |
| `docs/00_governance/change_control.md` | — | CR-043~047 대장 + 5장 반영 내역 |

## 이 세션이 만든 소스 (셋뿐)

| 경로 | 역할 |
| --- | --- |
| **`deploy/k8s/pipeline-worker-batch.yaml`** | **신설.** `batch` 역할 배포 단위 — JOB-ING-006(재색인)·JOB-ING-007(아웃박스 재적재). replica 1 · `Recreate` · grace 300s. **인프라 3장이 승인한 단위를 실재시킨 것**이지 새 역할이 아니다 |
| `deploy/k8s/README.md` | 적용 순서에 `pipeline-worker-batch.yaml` 등재 + 그 파일이 없던 이유 설명 |
| **`regression/runtime-reachability.test.ts`** | **+5건 (146 → 151).** 배포 도달성을 **양방향**으로 검사한다 (아래) |

## 새 회귀 다섯의 정확한 책임

| 시험 | 무엇을 지키나 |
| --- | --- |
| `코드가 갈래를 만든 역할은 그것을 세우는 manifest를 갖는다` | `index.ts`의 `roles.includes('X')` → manifest. **구현했는데 배포되지 않았다**를 잡는다 (DEV-292) |
| `인프라 3장이 승인한 배포 단위는 manifest를 갖는다` | 인프라 표 → manifest. **승인했는데 만들지 않았다**를 잡는다. **예외를 적용하지 않는다** (DEV-310·312) |
| `배포 단위 표와 코드 갈래가 서로를 덮는다` | 표가 낡았거나 코드가 앞서 갔다를 잡는다 (DEV-307) |
| `미배포 예외 역할은 배포 단위 표에 오르지 않는다` | 인프라 3장의 규율("배포되지 않는 단위를 표에 먼저 적지 않는다")을 **강제**한다 (DEV-312) |
| `미배포 역할 예외는 목록에 사유와 DEV가 함께 있다` | 예외를 늘리는 것이 경계를 넓히는 일임을 시험이 강제한다 (사유 40자 미만이면 실패) |

`UNDEPLOYED_ROLE_ALLOWLIST`에 `backfill`(DEV-304) · `release`(DEV-305) · `authz`(DEV-306)가 사유와 함께 있다. **고칠 때는 manifest를 만들고 이 목록에서 지운 뒤 인프라 표에 올린다.**

## WP-035 구현이 손댈 자리 (아직 없는 것)

| 무엇 | 지금 상태 |
| --- | --- |
| 버전 인덱스 생성·별칭 전환 | `packages/es/src/bootstrap.ts`는 `ensureIndex`(생성 또는 `putMapping`) + `putAlias`뿐. `indices.ts`의 `ENTITY_INDICES[].index`가 상수 `'prs-*-v1'` |
| 이중 쓰기 seam | 없다. 별칭에 쓰는 함수 **열일곱**: `upsert.ts`(`bulkUpsert`·`upsertOne`) · `commit-metadata.ts`(`upsertCommitMetadata`) · `sequence.ts`(`applySequenceToDocuments`·`applyEpochBump`) · `registry.ts`(`markRepositoryArchived`·`applyRepositoryTeams`) · `releases.ts`(`pruneReleaseDocuments`·`applyReleaseTagsToDocuments`) · `links.ts`(8) |
| JOB-ING-006 러너 | 없다. `apps/pipeline-worker/src/index.ts`의 `roles.includes('batch')` 블록에는 `startOutboxRelay`뿐 |
| API-ADM-004 라우트 | 없다. `apps/search-api/src/ops/`에 `reindex` 없음 |
| CLI | `packages/es/src/cli.ts`가 `apply-mappings`만 받는다. `package.json`에 `es:reindex` 스크립트 없음 |
| `OPERATOR_JOB_TYPES` | `apps/search-api/src/ops/jobs.ts` — `['backfill', 'link_rebuild']`. `reindex`는 **러너와 같은 커밋에서** 더한다 |
| 정본 | 전부 있다 — `pull_request_snapshot`(010) · `commit_snapshot`(013) · `release`(008) · 간선은 JOB-REL-006 재파생 |
| advisory lock | `packages/db/src/advisory-lock.ts`에 세션·트랜잭션 범위 둘 다 있다 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.8**. CR 먼저
- 기존 마이그레이션을 수정하지 않는다. **CR-043~047은 새 마이그레이션을 만들지 않았다 — 다음은 015**
- 기본 consumer group 이름을 바꾸지 않는다
- **사용자 대면 조회를 `packages/es/src/links.ts`에 넣지 않는다** (ADR-008 가드레일 면제가 파일 단위, DEV-265)
- **새 조회 경로는 `assertNoShardFailures`를 지나야 한다**
- **새 역할을 추가하면 ① 코드 갈래 ② manifest ③ 인프라 3장 표 셋이 함께 간다** — 회귀가 양방향으로 검사한다
- `agent-context/`는 tracked. 전사는 **`exports/`**에 둔다

---

# 2026-08-27 WP-035 · CR-048이 만든 것

## 읽는 순서가 바뀐 문서

| 경로 | 버전 | 이 세션이 바꾼 것 |
| --- | --- | --- |
| `docs/10_requirements/srs_final.md` | **baseline v2.8** | **변경 없음** |
| `docs/40_delivery/pr_search_implementation_traceability.md` | **v3.7** | DEV-313~323 등재, **6.39·6.39.1장 신설**, 3장 WP-035 done · REL-004 **4/8** |
| `docs/40_delivery/pr_search_work_packages.md` | **v1.2** | WP-035 done, DoD 20항 중 19항 체크, WP-032 "차단 해제" 표시 |
| `docs/40_delivery/pr_search_implementation_roadmap.md` | **v0.5** | Platform 의존(WP-035 → WP-032) 해소 표시 |
| `docs/30_technical_architecture/pr_search_api_contracts.md` | **v0.8** | 6장 오류 모델 표에 `REINDEX_BUSY | 409` (DEV-313) |
| `docs/30_technical_architecture/pr_search_infrastructure_operations.md` | **v0.5** | 배포 단위 표에 `pipeline-worker:authz` (**1 / 4**), 표 아래 산문 정정 |
| `docs/00_governance/change_control.md` | — | **CR-048** 대장 + 5장 반영 내역 |

## WP-035가 만든 소스 (PR #52)

### `@prs/es` — 색인 원시체

| 경로 | 역할 |
| --- | --- |
| `packages/es/src/write-targets.ts` | **신규.** `WriteTargets`(`shadows`·`recordShadowFailure`) · `SERVING_ONLY` · `dualWrite` · `reportShadowFailure`. **`shadows`가 `Record<string,string>`이라 `@prs/db`의 값이 구조적으로 그대로 대입된다** — 어댑터도 역방향 의존도 없다 |
| `packages/es/src/versioned-index.ts` | **신규.** `concreteIndexName` · `parseIndexVersion`(엄격 `^<별칭>-v<양의 정수>$`) · `listIndexVersions` · `resolveServingIndex` · **`nextUnusedVersion`**(DEV-309) · `createVersionedIndex` · **`switchAlias`(`updateAliases` 한 번)** · `deleteRetiredIndex`(`deleted`/`serving`/`absent`) · `schemaOf` · `isEntityAlias` · **`reindexIndexPort`**(API·CLI 공유) |
| `packages/es/src/upsert.ts` | `bulkUpsert`·`upsertOne`이 대상을 받는다. **shadow 항목을 같은 벌크에** 싣고 실패는 `outcomes`에 섞지 않는다. `sendOne` 추출 |
| `packages/es/src/commit-metadata.ts` | `upsertCommitMetadata` + `sendMetadata` 추출. shadow의 404는 실패로 세지 않는다 |
| `packages/es/src/sequence.ts` | `applySequenceToDocuments`·`applyEpochBump`가 `dualWrite`를 지난다. **서비스 건수만 센다** |
| `packages/es/src/registry.ts` | `markRepositoryArchived`·`applyRepositoryTeams` |
| `packages/es/src/releases.ts` | `upsertReleaseDocuments`·`pruneReleaseDocuments`(**삭제도 이중으로**)·`applyReleaseTagsToDocuments` |
| `packages/es/src/links.ts` | 8경로 + **`sendLinkBulk` 공통 헬퍼**(서비스 N개 뒤에 shadow N개) + `sendSummary` 추출 |

### `@prs/db` — 잡 상태와 울타리

| 경로 | 역할 |
| --- | --- |
| `packages/db/src/reindex-fence.ts` | **신규.** `withReindexWrite`(공유 락 → 대상 해석 → run → **shadow 실패 기록** → 해제) · `withReindexExclusive`(배타) · `ReindexFenceUnavailableError`. **울타리 구간이 DEV-308의 답이다** |
| `packages/db/src/repositories/reindex.ts` | **신규.** `REINDEX_JOB_TYPE` · `ReindexPhase` · `findDualWriteShadows`(running + 활성 단계 + 미전환) · `patchReindexProgress` · `recordShadowFailures`(CAS) · **`enqueueReindex`**(API·CLI 공유 seam) · `listRetiredIndices` · **`listUnrecordedSwitches`** · `markRetired` |
| `packages/db/src/advisory-lock.ts` | `reindexFenceKey()` · `acquireAdvisorySharedLock` · `releaseAdvisorySharedLock` 신설 |
| `packages/db/src/repositories/job.ts` | `enqueueJob`이 `progress`를 **같은 INSERT에** 받는다 (DEV-317) |

### 앱

| 경로 | 역할 |
| --- | --- |
| `apps/pipeline-worker/src/reindex.ts` | **신규·핵심.** `runReindexJob`(prepare→dual_write→backfill→verify→cutover→retention) · `rebuildAlias` 4종 · **`rebuildProjectedCommits`**(DEV-315) · `verifyBeforeCutover`(7항) · `startReindexRunner` · `runRetentionSweep` · **`reconcileSwitchedJobs`**(DEV-319) · `LinkRebuildPort` |
| `apps/pipeline-worker/src/reindex-cli.ts` | **신규.** `pnpm es:reindex --alias`. **직접 재색인하지 않는다** — 같은 enqueue seam으로 잡만 만든다 |
| `apps/pipeline-worker/src/documents.ts` | **`registryOwnedFields`**(레지스트리 소유 필드, DEV-314) · **`buildProjectedCommitDocument`**(PR 유래 커밋 문서, DEV-315). **투영과 재구축이 같은 함수를 쓴다** |
| `apps/pipeline-worker/src/commit-enrich.ts` | `CommitFactSource` · **`commitMetadataFields`** · **`commitCreateFields`** 추출. `scopeFields`는 `registryOwnedFields`에 위임 |
| `apps/pipeline-worker/src/release.ts` | `toDocInput` **export** — 재구축이 같은 빌더를 쓴다 |
| `apps/pipeline-worker/src/index.ts` | `batch` 역할에 `startReindexRunner`·`startRetentionSweeper` 기동 + shutdown |
| `apps/search-api/src/ops/reindex.ts` | **신규.** API-ADM-004 본체. `alias`만 받고 `invalid_alias`/`conflict`/`busy`를 가른다 |
| `apps/search-api/src/ops/jobs.ts` | `OPERATOR_JOB_TYPES`(+`reindex`)와 **`CREATABLE_GENERIC_JOB_TYPES`**를 분리 (DEV-301·302) |
| `apps/search-api/src/ops/routes.ts` | `REINDEX_PATH` · `registerReindexRoutes` |
| `apps/search-api/src/runtime.ts` | **`buildReindexDeps`** — 여기 한 줄이 빠지면 배포에서 사라진다 |
| `apps/search-api/src/ops/errors.ts` · `packages/contracts/src/error-codes.ts` | `REINDEX_BUSY` 등재 (DEV-313) |
| `package.json` | `es:reindex` 스크립트 |

## CR-048이 만든 것 (PR #53)

| 경로 | 역할 |
| --- | --- |
| `deploy/k8s/pipeline-worker-authz.yaml` | **신설.** `PIPELINE_WORKER_ROLES=authz` · replica 1 · grace 60s · **미러 볼륨 없음**. GHE 자격 증명이 선택인 이유와 **없을 때 색인 소급이 돌지 않는다는 결과**를 주석에 남겼다 |
| `deploy/k8s/README.md` | 적용 순서 등재 + 신설 사유 |

## 이 세션의 시험 (신규·확장)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/pipeline-worker/integration/jobs/reindex.test.ts` | **신규 17건. 실 PG·ES.** T1 정상 · T2 이중 쓰기 · T3·T4 shadow 항목 실패 · T5 전환 전 취소 · T6 next-unused-version · T7 보관(+현재 별칭 보호) · **T8 정본만으로 재구축**(옛 인덱스 표식이 안 온다) · **T9 무중단**(전환 포함 전 구간 조회 실패 0) · T10 늦은 취소 · **R1 레지스트리 소유 필드·PR 원본 커밋·본문에 버전 없는 스냅숏** · R2 원자 enqueue · R3 롤백 보관 · R4 전환 재대조 · **WP-032 선행 조건 증명** |
| `apps/search-api/integration/ops/reindex-reachability.test.ts` | **신규 2건.** `buildServerDeps`로 세운 서버에 실제 요청(401이면 있고 404면 없다) + **GHE 없이도 재색인은 선다** |
| `packages/es/src/dual-write.test.ts` | **신규 6건.** 열일곱 목록이 계약과 같은가 · 새 쓰기 원시체가 목록 밖에 생기면 · 운영 호출부가 울타리를 지나는가 · **`SERVING_ONLY`로 재색인을 지나치지 않는가** · **구체 인덱스 이름을 박지 않는가**(FR-ING-008 AC-1) |
| `packages/es/src/versioned-index.test.ts` | **신규 7건.** 접두가 같은 남의 인덱스를 세지 않는다 · 앞자리 0을 받지 않는다 · 별칭 판정 |
| `packages/es/src/architecture.test.ts` | ADR-008 예외에 `apps/pipeline-worker/src/reindex.ts` 등재 (전환 전 검증이 shadow를 구체 이름으로 읽는다) |
| `regression/runtime-reachability.test.ts` | **+43건 (151 → 194).** 재색인 도달성·계약 20 · JOB-AUTH-001 도달성 5 · 리뷰 정정 6 · **배포 단위 표 중복 행**·**표 아래 산문 모순** 2 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.8**. CR 먼저
- 기존 마이그레이션을 수정하지 않는다. **WP-035·CR-048은 만들지 않았다 — 다음은 015**
- 기본 consumer group 이름을 바꾸지 않는다
- **사용자 대면 조회를 `packages/es/src/links.ts`에 넣지 않는다** (ADR-008 면제가 파일 단위)
- **새 조회 경로는 `assertNoShardFailures`를 지나야 한다**
- **새 쓰기 원시체는 `WriteTargets`를 받고 `DUAL_WRITE_PATHS`에 등재한다** — 아키텍처 시험이 강제한다
- **새 운영 쓰기 호출부는 `withReindexWrite`를 지나고 `DUAL_WRITE_CALLERS`에 오른다**
- **애플리케이션에 `prs-*-vN` 구체 이름을 박지 않는다** — 허용은 `indices.ts`·`versioned-index.ts`·`reindex.ts` 셋뿐
- **새 역할은 ① 코드 갈래 ② manifest ③ 인프라 3장 표** 셋이 함께. 표에 **중복 행**을 만들지 않고 **표 아래 산문**도 함께 고친다 (DEV-321·322)
- **문서 본문을 고치면 같은 편집 안에서 상태 헤더를 만진다** (DEV-323)
- `agent-context/`는 tracked. **전사는 `exports/`에 둔다** — 이번 전사는 저장소 루트에 떨어졌고 무시되지 않는다

# 2026-08-27 (2차) WP-032가 만든 것

## 읽는 순서가 바뀐 문서

| 경로 | 버전 | 이 세션이 바꾼 것 |
| --- | --- | --- |
| `CLAUDE.md` · 루트 `AGENTS.md` · `docs/README.md` | — | **현재 상태 스냅숏을 없앴다** (DEV-324·325). 어디서 읽는지를 적는다 |
| `docs/40_delivery/pr_search_implementation_traceability.md` | **v4.1** | 1장·8장 정본 선언(DEV-326), DEV-324~332 등재, **6.40장 신설**, 3장 WP-032 done, 4장 FR 매핑 |
| `docs/40_delivery/pr_search_work_packages.md` | **v1.4** | WP-032 done, DoD 23항 체크, 배포 전제 |
| `docs/40_delivery/pr_search_implementation_roadmap.md` | **v0.6** | 매핑 이행 항목 해소 |
| `deploy/k8s/secret.example.yaml` | — | `SEARCH_CURSOR_HMAC_KEY` |

## `@prs/es` — 매핑·질의·강조

| 경로 | 역할 |
| --- | --- |
| `packages/es/src/settings.ts` | `TEXT_PARTIAL_ANALYZER`(edge_ngram 2~20) · `PARTIAL_TEXT_FIELD` · `SEARCHABLE_KEYWORD_FIELDS`. **`search_analyzer`가 `TEXT_ANALYZER`인 것이 핵심** — 질의까지 자르면 "결제"가 "결"로도 매치된다 |
| `packages/es/src/indices.ts` | **PR·커밋이 `-v2`.** links·releases는 v1 그대로 |
| `packages/es/src/bootstrap.ts` | `aliasHeldElsewhere` — 별칭이 옛 버전을 들면 **물러난다**(DEV-328). `dropEntityIndices`가 버전 전부를 지운다. `switchAliasesForTests`는 **시험 전용** |
| `packages/es/src/query-builder.ts` | `buildTextClause` · `FULL_TEXT_FIELDS` · `FIRST_PARENT_COMMIT_ROLES`. 자유 텍스트가 있을 때만 `source_commit`을 `must_not` |
| `packages/es/src/highlight.ts` | **신규.** 사설 사용 영역 표식 → 평문+구간. `buildHighlight` · `toPlainHighlight` · `containsHighlightMarker` |
| `packages/es/src/sort.ts` | `MISSING_SENTINEL` — **`_last`가 아니다**(DEV-329). `relevance`가 `order`를 존중한다 |
| `packages/es/src/search.ts` | `openPointInTime` · `closePointInTime`(던지지 않는다) · `searchWithPit`. **PIT은 `index`를 함께 주지 않는다** |

## `search-api` — 커서·패싯

| 경로 | 역할 |
| --- | --- |
| `apps/search-api/src/cursor/envelope.ts` | **신규.** HMAC 봉인·두 오류 타입·`ephemeralCursorKey`. **순회의 뜻은 여기 없다** |
| `apps/search-api/src/cursor/params.ts` | **신규.** `readCursor`·`readFacets` — 두 화면이 같은 해석을 쓴다 |
| `apps/search-api/src/search/cursor.ts` | **신규.** PIT + `search_after` 봉투. 지문 재료 다섯 |
| `apps/search-api/src/search/facets.ts` | **신규.** `computeFacets`(ScopedQuery만) · `SEARCH_FACET_AXES`(6) · `RANGE_FACET_AXES`(4) · `coalesceByValue`(DEV-331) |
| `apps/search-api/src/sequence/range-cursor.ts` | **신규.** 정본 서수 봉투. 공간·에폭·경계를 **그대로** 싣는다 |
| `apps/search-api/src/sequence/range.ts` | `scanPage` — chunk 순회(DEV-270)·완결 서수(DEV-287) |
| `apps/search-api/src/config.ts` | `resolveSearchCursorKey` — 운영에서 키 없으면 **던진다** |
| `apps/search-api/src/runtime.ts` | 커서 서명자·`resolveTeamSlugs`를 **여기서** 붙인다 |
| `packages/db/src/repositories/auth.ts` | `resolveTeamSlugs` 신규. `resolveTeamIds`가 **ID를 전부** 돌려준다 (DEV-331) |

## 화면

| 경로 | 역할 |
| --- | --- |
| `apps/web/components/CursorPager.tsx` | **신규.** C-016. 페이지 번호 없음. 두 커서 오류를 다르게 그린다 |
| `apps/web/components/HighlightedText.tsx` | **신규.** `<mark>` 조립. **`dangerouslySetInnerHTML` 없다** |
| `apps/web/lib/highlight.ts` | **신규.** `splitHighlight`(던지지 않는다) · `judgeHighlight` |
| `apps/web/lib/facets.ts` | 네 상태(+`failed`) · `SEARCH_FACET_FIELDS`/`RANGE_FACET_FIELDS`. **응답 키와 질의 키가 갈렸다** |
| `apps/web/components/SearchView.tsx` | `PageState`(carried·cursor·facets·failure·**nonce**). 커서 실패에 **재조회하지 않는다** |
| `apps/web/components/RangesView.tsx` | `q`가 URL에 실린다. 패싯 넷 + 커서 |

## 이 세션의 시험 (신규·확장)

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/search-api/integration/search/facets.test.ts` | **신규 39건.** bucket 단위 검증 · THR-003 · 커서 전량 순회(여섯 정렬 키) · `size` 가변 · PIT 안정성 · 전문 검색 · 강조 · 패싯 실패 격리 · 동명 팀 합치기 |
| `apps/search-api/integration/sequence/range-paging.test.ts` | **신규 19건.** DEV-270·287 반례 둘 · 에폭/경계/`q` 무효화 · 구간 전체 패싯 |
| `apps/pipeline-worker/integration/jobs/reindex.test.ts` | **WP-032 매핑 이행 증명** — 옛 스키마가 조용히 0건을 답하고, 전환 뒤 과거 문서가 찾힌다 |
| `packages/es/integration/bootstrap.test.ts` | **+3건.** 별칭이 옛 버전을 든 상태에서 물러나는가·둘로 걸지 않는가·빈 인덱스를 만들지 않는가 |
| `apps/web/e2e/search-paging.spec.ts` | **신규 12건.** 요청 순서(커서 되돌리기·`facets` 한 번)·자동 재조회 없음·실제 DOM 이스케이프 |
| 단위 | 커서 봉투 11 · 검색 커서 13 · 구간 커서 13 · 강조 15+12 · 전문 검색 9 · 코드 포인트 4 · PIT 회전 2 |
| `apps/search-api/integration/_cursor-fixture.ts` | **신규.** 시험용 서명자 — 선택 필드로 만들면 "커서가 조용히 발급되지 않는" 배포를 시험이 통과시킨다 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.8**. CR 먼저
- **PR·커밋 인덱스는 `-v2`다.** 매핑을 또 바꾸면 버전을 올리고 **재색인으로** 배포한다
- `applyMappings`가 옛 버전을 든 별칭에 손대지 않는 방어를 지운다 → 별칭이 둘이 되거나 빈 인덱스가 남는다
- `MISSING_SENTINEL`을 `_last`로 되돌리지 않는다 — 커서가 깨진다
- **W-001·W-004 커서를 합치지 않는다**
- 새 조회 경로는 `assertNoShardFailures`를 지난다. 패싯도 `ScopedQuery`만 받는다
- 강조에 **API가 만든 마크업**을 실지 않는다. 화면은 `dangerouslySetInnerHTML`을 쓰지 않는다
- 새 쓰기 원시체는 `WriteTargets`를 받고 `DUAL_WRITE_PATHS`에 등재한다 (WP-035)
- `agent-context/`는 tracked. **전사는 `exports/`에 둔다**
- `agent-context/_handoff/`는 **생성물**이다 — 손으로 고치지 말고
  `context_handoff.py build`로 다시 만든다. 원본은 `agent-context/*.md` 일곱이다

---

# 2026-08-27 (3차) CR-049 · WP-033이 만든 것

## 읽는 순서가 바뀐 문서

| 경로 | 버전 | 이 세션이 바꾼 것 |
| --- | --- | --- |
| `docs/10_requirements/srs_final.md` | **baseline v2.9** | FR-SRCH-010의 AC-1·2·4 명확화, AC-5·6·7 신설. **기존 AC 번호 유지** |
| `docs/10_requirements/prd.md` | v1.4 | SCN-005에 저장·재실행·공유 흐름 (DEV-339) |
| `docs/10_requirements/glossary.md` | v0.3 | 「대상 팀」 신설. **「커서」 정의가 `search_after`에 묶여 있던 것을 정정** |
| `docs/10_requirements/requirements_screen_traceability_matrix.md` | v0.6 | FR-SRCH-010의 화면별 책임 (DEV-343) |
| `docs/20_derived_ui_specs/pr_search_wireframe_spec.md` | v0.5 | W-001 저장 대화상자, W-008 두 목록·커서·소유권 |
| `docs/20_derived_ui_specs/pr_search_screen_state_matrix.md` | v0.6 | W-001 저장 실패 셋, W-008 상태 다섯 추가 |
| `docs/20_derived_ui_specs/pr_search_ui_component_spec.md` | v0.5 | C-037 소유권별 액션, C-016 한 화면 두 페이저 |
| `docs/20_derived_ui_specs/pr_search_screen_qa_checklist.md` | v0.6 | QA-W008-06~12 신설 |
| `docs/30_technical_architecture/pr_search_api_contracts.md` | v0.9 | **API-SRCH-005 상세 절 신설** (일곱 경로·커서·오류 여덟) |
| `docs/30_technical_architecture/pr_search_data_model.md` | v0.6 | 불변식·인덱스·CASCADE·잠금 규율 |
| `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` | v0.5 | THR-012 완화를 셋으로 |
| `docs/40_delivery/pr_search_work_packages.md` | v1.6 | WP-033 done, DoD 17항 |
| `docs/40_delivery/pr_search_implementation_traceability.md` | v4.3 | 6.41·6.41.1장, DEV-333~349, 7장 등재 |

## 정본 계층

| 경로 | 역할 |
| --- | --- |
| `packages/db/migrations/015_saved_search_contract.up.sql` | 불변식·목록 인덱스 둘·보존 CASCADE. **새 표 없음** |
| `packages/db/src/repositories/saved-search.ts` | **접근 규칙이 질의 안에 있다.** `visibleTo()`가 조회·실행의 조건이고 라우트는 그 부재를 404로 옮길 뿐이다. 두 잠금(`FOR UPDATE`·`FOR SHARE`)이 여기 있다 |

## search-api

| 경로 | 역할 |
| --- | --- |
| `apps/search-api/src/saved-search/cursor.ts` | PostgreSQL 키셋. **PIT·`search_after` 없다.** 지문 = 사용자 + view + 팀 소속(정렬). 접근 범위 버전은 **넣지 않는다** |
| `apps/search-api/src/saved-search/service.ts` | 자원 표현·질의 판정·목록·실행 준비. **`@prs/es`를 가져오지 않는다** — 회귀가 건다 |
| `apps/search-api/src/saved-search/routes.ts` | 일곱 경로. **정적 `/share-targets`가 `/{id}`보다 먼저** |
| `apps/search-api/src/{runtime,server}.ts` | 배선. `buildServerDeps`가 만들고 `buildServer`가 세운다 |

## 화면

| 경로 | 역할 |
| --- | --- |
| `apps/web/lib/saved-search.ts` | **판정은 전부 여기.** 액션·상태·레이블·무효 구간 가르기·실패 안내 |
| `apps/web/components/SaveSearchDialog.tsx` | **`create`/`edit` 두 모드.** 편집에서만 질의를 고칠 수 있다. 열 때 팀 목록을 무효로 만든다 |
| `apps/web/components/SavedSearchList.tsx` | C-037. 소유 여부가 액션을 정하고 무효 구간을 `<mark>`로 짚는다 |
| `apps/web/components/SavedSearchesView.tsx` | W-008. 두 목록이 각자의 커서·세대(`nonce`)를 갖는다 |
| `apps/web/app/saved-searches/page.tsx` · `lib/nav.ts` | 라우트와 내비게이션 |

## 이 세션의 시험

| 경로 | 무엇을 지키나 |
| --- | --- |
| `apps/search-api/integration/saved-search/saved-search.test.ts` | 65건. 격리·소유권·이탈 후 처분·동시 상한·**잠금 배타(`FOR KEY SHARE`)**·커서·무효 질의·실행·공유 대상·불변식 |
| `apps/search-api/integration/saved-search/executor-scope.test.ts` | 7건. **AC-3의 실물 증명** — 공유받은 사람이 실행하면 저장자만 보는 저장소가 0건 |
| `apps/search-api/src/saved-search/{cursor,service}.test.ts` | 37건. 봉투 거절 갈래·자원 표현 |
| `apps/web/lib/saved-search.test.ts` | 32건. 화면 판정·무효 구간 |
| `apps/web/a11y/saved-searches.test.tsx` | 23건. 액션 표시·프록시 경로·편집 `PATCH`·목록 갱신·axe |
| `apps/web/e2e/saved-search.spec.ts` | 11건. 두 커서·자동 재조회 없음·이동·삭제 확인·편집·무효 구간 |
| `regression/runtime-reachability.test.ts` | +19. 배선·경로 순서·잠금·범위 미저장·오프셋 금지·마이그레이션 |

## 손대면 안 되는 것 (갱신)

- `docs/10_requirements/srs_final.md`는 **baseline v2.9**. CR 먼저
- **기존 마이그레이션을 수정하지 않는다.** 다음은 016
- **두 잠금을 지우지 않는다** — 상한은 `FOR UPDATE`, 구성원 자격은 `FOR SHARE`
- `SavedSearchRow.created_at`을 `Date`로 바꾸지 않는다 — 키셋이 항목을 건너뛴다
- **`/run`이 검색을 대신하게 만들지 않는다** — AC-3이 구조로 지켜진다
- 커서 지문에서 팀 소속을 빼지 않는다. **접근 범위 버전을 넣지도 않는다**
- 웹은 `/api/saved-searches`를 부른다 — `/api/v1`을 적으면 `/api/v1/v1/...`이 된다
- 새 쓰기 원시체는 `WriteTargets`를 받고 `DUAL_WRITE_PATHS`에 등재한다 (WP-035)
- `agent-context/`는 tracked. 전사는 `exports/`에 둔다
- `agent-context/_handoff/`는 생성물이다 — 손으로 고치지 말고 `context_handoff.py build`로 다시 만든다

---

# WP-034 W-009 저장소 개요 (CR-050, 2026-08-28)

## 신규 소스

| 경로 | 역할 |
| --- | --- |
| `packages/db/migrations/016_repository_overview.{up,down}.sql` | 등록 요청 표 + `repository` 열 둘. **왜 그렇게 정했는지가 주석에 있다** |
| `packages/db/src/repositories/registration-request.ts` | `ENT-CORE-008`. `recordRequest`가 `ON CONFLICT DO UPDATE`로 자연 멱등을 만든다 — `DO NOTHING`은 동시 요청에서 아직 커밋 안 된 행을 못 본다 |
| `apps/search-api/src/repositories/overview.ts` | `API-ING-002` 서비스. **접근 범위 판정이 SQL이 아니라 여기 있다.** `collectVisible`이 스캔 상한에서도 커서를 남긴다(DEV-357) |
| `apps/search-api/src/repositories/cursor.ts` | PostgreSQL 키셋 커서. 지문에 접근 범위 **해시** |
| `apps/search-api/src/repositories/registration-requests.ts` | `API-ING-003`. **GitHub 클라이언트를 주입하지 않는다** |
| `apps/search-api/src/repositories/routes.ts` | 두 라우트. `/admin` 밖이고 세션 인증만 받는다 |
| `apps/web/lib/repository-overview.ts` | **화면 판정 전부.** `null`·`0`·`unavailable` 구분이 핵심 |
| `apps/web/components/RepositoryCardGrid.tsx` | C-038. 판정을 다시 하지 않고 그린다 |
| `apps/web/components/SequenceSpaceStatusList.tsx` | C-039. 네 상태에 텍스트 레이블 |
| `apps/web/components/RegisterRequestDialog.tsx` | `owner/name`만 받는다 |
| `apps/web/components/RepositoriesView.tsx` | 커서 순회 + 빈 페이지 자동 진행(상한 20) |
| `apps/web/app/repositories/page.tsx` | `/repositories`. `?repository=`로 진단 딥링크 |

## 고친 기존 소스

| 경로 | 무엇 |
| --- | --- |
| `packages/es/src/scoped-query.ts` | `isRepositoryInScope`의 `allowedTeamIds`를 **필수 인자로** (DEV-353) |
| `apps/search-api/src/sequence/{space,spaces-list}.ts` | 그 인자를 실제로 넘긴다 + stale 주석 제거 |
| `apps/pipeline-worker/src/reconcile.ts` | 완주한 회차만 `recordCompletedReconciliation` |
| `apps/search-api/src/ops/pipeline-status.ts` | `sequence_space_state` 전역 요약 (DEV-354) |
| `apps/search-api/src/{runtime,server}.ts` | `repositories` 의존 조립·등록. **세션 블록 안**이라 관리자 토큰으로 안 열린다 |
| `apps/web/components/{ReleasesView,SearchView,PrDetailView,CommitDetailView}.tsx` | W-009 진단 경로 (DEV-159·358) |
| `apps/web/lib/nav.ts` | `/repositories`를 `analysis` 그룹에 등재 |
| `packages/db/src/repositories/{repository,job,raw-event}.ts` | 배치 조회 셋 — N+1을 막는 자리 |

## 시험

| 경로 | 무엇을 거는가 |
| --- | --- |
| `apps/search-api/integration/repositories/scope-parity.test.ts` | **DEV-353의 정본.** 세 경로에 같은 범위 픽스처를 넣어 `explicit`/`org_team` 등식을 건다 |
| `apps/search-api/integration/repositories/overview.test.ts` | 접근 범위·진단 축·커서 순회·**스캔 상한**(DEV-357) |
| `apps/search-api/integration/repositories/registration-request.test.ts` | 멱등·존재 비노출·계약 밖 필드·CASCADE |
| `apps/search-api/integration/repositories/reachability.test.ts` | 운영 조립이 실제로 세우는가 (401 vs 404) |
| `apps/pipeline-worker/integration/reconcile/durability.test.ts` | 완주/미룸/예외 전이를 실 PostgreSQL로 |
| `apps/search-api/src/repositories/cursor.test.ts` | 봉투가 무엇을 거절하는가 |
| `apps/web/lib/repository-overview.test.ts` | 세 값 구분·화면 상태 |
| `apps/web/a11y/repositories.test.tsx` | 렌더·접근성·QA-W009-13 |
| `apps/web/e2e/repositories.spec.ts` | 실제 브라우저에서만 확인되는 넷 |

---

# CR-051 · DEV-349 시퀀스 인용 에폭 (2026-08-28)

## 신규 소스

| 경로 | 역할 |
| --- | --- |
| `packages/query/src/sequence-binding.ts` | **`seq:`가 어느 공간을 뜻하는지 판정하는 유일한 자리.** 순수 함수 — DB도 ES도 모른다(브라우저가 같은 코드를 쓴다). `analyzeSequenceBinding`이 `none`/`bound`/`invalid` 셋을 준다. `hasSequenceRangeFilter`는 "이 질의에 `seq:` **범위**가 있는가" |
| `packages/db/migrations/017_saved_search_seq_epoch.{up,down}.sql` | `saved_search.seq_epoch INT` + `>= 1` CHECK. **소급 채움을 하지 않는 이유가 주석에 있다** |
| `apps/search-api/src/search/sequence-context.ts` | 검색의 **4-1단계**. `resolveSequenceContext`가 바인딩·공간 해석·에폭 확정을 한 번에 하고 라우트가 그 결과로 분기한다. HTTP를 모른다 |
| `apps/search-api/src/saved-search/sequence-reference.ts` | 저장된 검색의 인용 상태. `resolveSequenceReferences`는 **페이지 단위 일괄**, `bindEpochForWrite`는 쓰기 경로(POST·PATCH 공용), `needsSequenceReference`는 접근 범위 산출을 아낄지 정한다 |

## 고친 기존 소스

| 경로 | 무엇 |
| --- | --- |
| `packages/es/src/query-builder.ts` | `buildQuery`에 `BuildQueryOptions.sequenceEpoch`. **`seq:` 범위가 있는데 없으면 `SequenceEpochRequiredError`를 던진다** |
| `apps/search-api/src/search/cursor.ts` | `FingerprintInput.sequenceEpoch` 추가. `seq:`가 없으면 재료가 **없다**(`0` 같은 대체값 금지) |
| `apps/search-api/src/search/service.ts` | `SearchRequest.sequenceEpoch`. `pool`은 여기 **없다** — 라우트 옵션에 있다 |
| `apps/search-api/src/search/routes.ts` | 4-1단계 삽입, `toSequenceFailure`, stale 응답(결과 키 없음), `SearchRouteOptions.pool` |
| `apps/search-api/src/search/relaxation.ts` | 완화 후보에서 `repo:`·`base:` 제외 + 같은 에폭으로 센다 |
| `apps/search-api/src/sequence/space.ts` | `readEpochParam` 신설(세 상태). **옛 `parseEpochParam`은 지웠다** |
| `apps/search-api/src/sequence/routes.ts` | W-004 세 경로가 엄격 파서를 쓴다 |
| `apps/search-api/src/sequence/range.ts` | `runRange`의 `q`에 `request.space.seqEpoch` 전달 (**빠뜨리면 500**) |
| `apps/search-api/src/saved-search/{routes,service}.ts` | POST·PATCH 에폭 계약, `sequence_reference`, `/run`의 `unbound` 차단, `navigationUrlFor(query, epoch)` |
| `packages/db/src/repositories/saved-search.ts` | `SavedSearchRow.seq_epoch`, Create/Update 입력. UPDATE는 **`COALESCE`가 아니라 플래그**(null이 "지움"이어야 한다) |
| `apps/search-api/src/{runtime,server}.ts` | `search`에 `pool` 연결. `ServerDeps.search`가 `SearchDeps & { pool }` |
| `apps/web/lib/query-url.ts` | `PARAM.seqEpoch`, `QueryState.seqEpoch`(**문자열 원문**), `withQuery` 신설, `withAst`가 `seq:` 상실 시 에폭 제거 |
| `apps/web/lib/search-fetch.ts` | `searchUrl`이 `seq_epoch`을 싣는다 (커서와 반대 — 에폭은 누가 열어도 같은 사실) |
| `apps/web/lib/search-state.ts` | `epoch_stale` 상태. **결과 판정보다 먼저 본다**(안 그러면 `loading_initial`에 멈춘다) |
| `apps/web/lib/saved-search.ts` | `describeSequenceReference`, `rowActions.canRebindEpoch`, `createPayload`의 `seqEpoch` |
| `apps/web/components/SearchView.tsx` | 시퀀스 배너, URL 완성(`replace`), `rebindEpoch`, **낡음 상태 저장 차단** |
| `apps/web/components/SaveSearchDialog.tsx` | `seqEpoch`·`edit.current_seq_epoch`. **질의가 실제로 바뀌었을 때만** 에폭을 싣는다 |
| `apps/web/components/{SavedSearchList,SavedSearchesView}.tsx` | 인용 상태 배지, 「현재 에폭으로 다시 연결」(저장자만) |

## 시험

| 경로 | 무엇을 거는가 |
| --- | --- |
| `packages/query/src/sequence-binding.test.ts` | 공간 지목 16종 — 다섯 실패 형태, 중복 값, 부정된 `-seq:`, 스칼라 제외 |
| `apps/search-api/integration/search/sequence-epoch.test.ts` | **계약 일곱 규칙의 정본.** 같은 서수에 두 세대를 색인한 픽스처가 핵심 — 없으면 `seq_epoch` 필터를 지워도 아무 시험이 안 깨진다 |
| `apps/search-api/integration/saved-search/sequence-reference.test.ts` | 저장·낡음·**미연결 보존**·PATCH 다섯 경우·THR-043 비노출·N+1 |
| `apps/web/e2e/sequence-epoch.spec.ts` | 브라우저에서만 드러나는 것 — URL `replace`, 자동 이동 없음, 저장 차단, `seq:` 상실 시 정리 |
| `packages/es/src/query-builder.test.ts` | 에폭 필터 결합 + fail-closed |
| `apps/search-api/src/search/cursor.test.ts` | 지문 재료와 에폭 불일치 거절 |
| `apps/web/a11y/saved-searches.test.tsx` | 인용 상태 넷의 문자 레이블, 재연결 권한, **편집이 에폭을 싣는 두 갈래** |
| `apps/search-api/integration/sequence/range-es.test.ts` | `/sequence-ranges?q=seq:…`가 500이 아니다 (PR #64 리뷰 P2 회귀) |

## 손대면 안 되는 것 (갱신)

- `sequence-binding.ts`의 **첫 검사를 지우지 마라** — 아래 타입 가드가 같은 답을 내지만
  `required`/`ambiguous` 구분을 잃는다(변이 M1이 등가로 살아남아 그 사실을 드러냈다)
- `buildQuery`의 fail-closed를 선택 인자로 되돌리지 않는다
- `toResource()` 안에서 DB를 부르지 않는다 — 그 자리에 한 번 왕복이 들어가면 항목 수만큼 늘어난다
- `QueryState.seqEpoch`을 숫자로 되돌리지 않는다 — 화면이 형식을 판정하면 서버가 거절할 기회를 잃는다
- 커서 계열 넷을 합치지 않는다 (W-001 PIT · W-004 정본 서수 · W-008·W-009 키셋)


---

# 2026-08-29 세션이 만든 소스 (CR-053 · WP-037 · DEV-364)

## 집계 API — `apps/search-api/src/analytics/`

| 파일 | 역할 |
| --- | --- |
| `types.ts` | 모집단(`ANALYTICS_TARGET`)·상한·그룹 키 대응표·분포 구간. **`team`이 `author_team_ids`를 가리키는 자리가 여기다** |
| `prepare.ts` | 질의 준비의 **유일한 자리**. 파싱 → 모집단 → 접근 범위 → 시퀀스 문맥 → 에폭. `CR-051`이 `/search`에 세운 순서와 같다 |
| `execute.ts` | 근사 판정과 실행. `_count`로 세고 `timed_out`·샤드 실패를 함께 본다 |
| `aggregations.ts` | 네 집계의 ES 질의와 응답 변환. **접근 통제가 없다** — `prepare`가 이미 `ScopedQuery`를 만들었다 |
| `routes.ts` | 네 엔드포인트. `runCommon`이 공통 앞단을 갖는다 |
| `aggregations.test.ts` | **경계를 겨냥한 단위 시험.** 통합이 경계를 비켜 가면 그 규칙은 시험에 없다 |

## 성능 harness — `perf/`

| 파일 | 역할 |
| --- | --- |
| `vitest.perf.config.ts` | `PERF_DATASET_SIZE`로 두 규모를 모두 돈다. Level A(알고리즘 회귀)와 Level B(Gate 5)를 **한 harness로** |
| `perf/analytics.perf.test.ts` | 왕복 수와 지연 분포. `search`·`count`·`msearch`를 모두 센다 |

## 이 세션이 고친 기존 파일

| 파일 | 무엇을 |
| --- | --- |
| `packages/query/src/keys.ts` | 질의 키 17종 (`kind`·`author_team` 신설), `RANGE_KEY_EXAMPLE` |
| `packages/query/src/parse.ts` | 범위 전용 키의 스칼라 거절 (DEV-364) |
| `packages/query/src/serialize.ts` | `addEquality`를 화면에서 올려 왔고 `replaceEquality`를 신설 |
| `packages/es/src/query-builder.ts` | `resolveSearchTarget`(대상과 걷어낸 AST를 함께), `RangeKeyEqualityError`, `KindFilterNotAppliedError`, `author_team` 필드 |
| `packages/es/src/search.ts` | `countDocuments` — **`ScopedQuery`만 받는다** |
| `packages/es/src/bootstrap.ts` | `backfillDerivedFields` — `changed_lines` 소급 |
| `packages/es/src/mappings/pull-requests.ts` | `changed_lines` |
| `packages/db/src/repositories/repository.ts` | `resolveOrgOwners`(`resolveOrgIds`의 역방향) |
| `apps/pipeline-worker/src/documents.ts` | `changed_lines` 계산, `firstReviewAt`가 작성자 본인 리뷰 제외 |
| `apps/pipeline-worker/src/reindex.ts` | `derivedFields` — 옛 스냅숏에 없는 파생 필드를 채운다 |
| `apps/search-api/src/search/service.ts` | `resolveSearchTarget` 배선 |
| `apps/search-api/src/search/routes.ts` | `toSequenceFailure`를 export (집계가 같은 판정을 쓴다) |
| `apps/search-api/src/server.ts` | `registerAnalyticsRoutes` 등록, `analyticsDisplay` |
| `apps/web/lib/tokens.ts` | `addEquality`를 `@prs/query`에서 재export |
| `regression/runtime-reachability.test.ts` | 집계 도달성 18건 |

# 2026-08-29 (2차) 세션이 만든 것 (CR-036 · WP-038)

## design-system (CR-036, 0.2.0 배포)
| 파일 | 무엇 |
| --- | --- |
| packages/tokens/src/palette.dark.ts | dataviz 배열 25(정본, nonText hex) |
| packages/tokens/src/palette.light.ts | dataviz 25 override(라이트 진한 값) |
| packages/tokens/src/schema.ts | FIXED_GROUP_SIZES.dataviz=25 |
| packages/tokens/src/contrast-pairs.ts | datavizPairs CP-043~117(25키×3표면) |
| packages/tokens/etc/tokens.api.md | check:api 스냅숏 갱신 |
| package.json | pnpm.overrides 9(audit high 해소) |

## PR Search (WP-038)
| 파일 | 역할 |
| --- | --- |
| apps/web/lib/analytics.ts | 순수 계층. URL 상태·요청·패널 상태 판정·드릴다운. 백분위 p 접두, seq_epoch은 seq: 있을 때만 |
| apps/web/components/AnalyticsView.tsx | 조율. 패널 6개 독립 조회(usePanel enabled), 차트 동적 import |
| apps/web/components/{AggregationPanel,TimeSeriesChart,DistributionChart,PercentileCardRow}.tsx | C-030·033·034·035 |
| apps/web/components/Tabs.tsx | WAI-ARIA 탭(DEV-397). roving tabindex, 화살표·Home·End |
| apps/web/components/SearchAggregationTab.tsx | W-001 집계 탭. 기본 그룹 author, 활성일 때만 조회 |
| apps/web/app/analytics/page.tsx | /analytics 라우트 |
| apps/web/lib/nav.ts | /stats → /analytics |
| apps/web/lib/analytics.test.ts, a11y/analytics.test.tsx, e2e/flow-005.spec.ts | 시험(변이 M1~M10 킬) |

## 손대면 안 되는 것 (갱신)
집계 서버(apps/search-api/src/analytics/*)는 WP-037이 세웠다 — WP-038은 화면만. 계약은 API-STAT-003(백분위 p 접두)이 정본.
