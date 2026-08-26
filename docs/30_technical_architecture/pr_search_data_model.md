# PR Search 데이터 모델

> 상태: review | 버전: v0.4 | 갱신일: 2026-08-26

## 1. 목적

핵심 엔티티, 관계, 소유권, 수명주기, 마이그레이션, 보존, 백업/복구 기준을 정의한다. 엔티티 네이밍은 `../10_requirements/glossary.md`를 따른다.

저장소 분담은 ADR-004를 따른다. **PostgreSQL이 시스템 오브 레코드이고, Elasticsearch는 PostgreSQL만으로 전량 재구성 가능한 파생 뷰다.** 인덱스 전략은 ADR-003을 따른다.

## 2. 엔티티 카탈로그

| Entity ID | 엔티티 | 책임 | 주요 필드 | 소유 저장소 | 소유 모듈 | 관련 요구사항 |
| --- | --- | --- | --- | --- | --- | --- |
| ENT-CORE-001 | Repository | 수집 대상 저장소 등록과 정책 | `repository_id`, `owner`, `name`, `org_id`, `visibility`, `sequence_branches[]`, `mirror_enabled`, `status` | PostgreSQL | registry | FR-ING-009 |
| ENT-CORE-002 | PullRequest | PR 검색 문서 | `pr_number`, `title`, `body`, `author`, `state`, `merged_at`, `merge_commit_sha`, `merge_seq`, `link_summary` | Elasticsearch | projection | FR-SRCH-003, FR-SRCH-006 |
| ENT-CORE-003 | Commit | 커밋 검색 문서 | `commit_sha`, `message`, `author`, `role`, `merge_seq`, `patch_id`, `changed_paths[]` | Elasticsearch | projection | FR-SRCH-002, FR-SRCH-004 |
| ENT-CORE-004 | Team | 팀 정보와 집계 그룹 단위 | `team_id`, `slug`, `org_id`, `member_ids[]` | PostgreSQL | registry | FR-AUTH-002, FR-STAT-001 |
| ENT-CORE-005 | User | 사용자와 접근 범위 | `user_id`, `login`, `email`, `roles[]`, `access_scope_version` | PostgreSQL | auth | FR-AUTH-001, FR-AUTH-003 |
| ENT-CORE-006 | SavedSearch | 저장된 질의 | `saved_search_id`, `name`, `query`, `visibility`, `owner_user_id` | PostgreSQL | search | FR-SRCH-010 |
| ENT-CORE-007 | AuditRecord | 감사 기록 | `audit_id`, `user_id`, `action`, `target`, `query`, `result_code`, `correlation_id`, `occurred_at` | PostgreSQL | audit | FR-AUTH-004 |
| ENT-SEQ-001 | MergeSequence | 시퀀스 서수-커밋 대응 | `repository_id`, `base_branch`, `seq_epoch`, `merge_seq`, `commit_sha`, `pull_request_number` | PostgreSQL | sequence | FR-SEQ-001, FR-SEQ-002 |
| ENT-SEQ-002 | SequenceSpace | 시퀀스 공간 상태 | `repository_id`, `base_branch`, `seq_epoch`, `head_sha`, `head_seq`, `state`, `last_assigned_at` | PostgreSQL | sequence | FR-SEQ-001, FR-SEQ-005 |
| ENT-SEQ-003 | SafeMarker | 안전 구간 표식 | `marker_id`, `repository_id`, `base_branch`, `seq_epoch`, `merge_seq`, `note`, `created_by` | PostgreSQL | sequence | FR-SEQ-006 |
| ENT-SEQ-004 | BisectSession | 이분 탐색 상태 | `session_id`, `user_id`, `repository_id`, `base_branch`, `seq_epoch`, `good_seq`, `bad_seq` | PostgreSQL | sequence | FR-SEQ-007 |
| ENT-REL-001 | Release | 릴리스 앵커 | `release_id`, `repository_id`, `tag_name`, `commit_sha`, `base_branch`, `seq_epoch`, `merge_seq`, `released_at`, `source` | **PostgreSQL (정본) + Elasticsearch (투영)** (CR-028, DEV-142) | release | FR-SEQ-004, FR-REL-002, FR-SEQ-003 AC-1 |
| ENT-REL-002 | Link | 관계 간선 | `link_id`, `from_type`, `from_id`, `to_type`, `to_id`, `link_type`, `confidence`, `evidence`, `resolved` | Elasticsearch | link | FR-REL-003~008 |
| ENT-ING-001 | RawEvent | 원본 웹훅 이벤트 | `delivery_id`, `event_type`, `repository_id`, `received_at`, `payload`, `queued_at`, `processed_at` | PostgreSQL | ingestion | FR-ING-001, FR-ING-003 |
| ENT-ING-002 | DeadLetter | 실패 이벤트 격리 | `dead_letter_id`, `delivery_id`, `stage`, `error`, `retry_count`, `state` | PostgreSQL | ingestion | FR-ING-007 |
<!-- CR-010(DEV-013): 보강 결과 전용 테이블은 두지 않는다. EVT-ING-002가 투영에 필요한 것을 self-contained bounded 이벤트로 나른다. 원본이 필요하면 raw_event가 시스템 오브 레코드다 (ADR-004). -->
| ENT-ING-003 | RawEventArchive | 원본 아카이브 검색 문서 | `delivery_id`, `event_type`, `repository`, `received_at`, `payload` | Elasticsearch | filebeat | FR-ING-010 |
| ENT-ING-004 | Job | 잡 실행 상태 | `job_id`, `type`, `target`, `state`, `progress`, `cursor`, `started_at`, `finished_at` | PostgreSQL | jobs | FR-ADMIN-002, FR-ING-006 |
| ENT-GH-001 | GitHubIdentityConnection | 사용자별 Operations App 위임 연결 | `user_id`, `github_login`, `token_ref`, `scopes[]`, `connected_at`, `expires_at`, `revoked_at` | PostgreSQL | gh-identity | FR-GH-008 |
| ENT-GH-002 | GhExecution | gh 실행 요청과 결과 | `execution_id`, `user_id`, `capability_id`, `invocation`(ENT-GH-008 구조화 원본 — 재실행의 근거), `context_snapshot`, `redacted_argv[]`, `risk_level`, `state`, `gh_version`, `manifest_version`, `exit_code`, `output_hash`, `output_truncated`, `idempotency_key` | PostgreSQL | gh-exec | FR-GH-002, FR-GH-006, FR-GH-012 |
| ENT-GH-002-A | GhExecutionArtifact | 실행이 만든 파일 | `artifact_id`, `execution_id`, `name`, `size_bytes`, `content_type`, `storage_ref`, `expires_at` | PostgreSQL + 파일 저장 | gh-exec | FR-GH-007 |
| ENT-GH-003 | GhRecipe | 저장된 다단계 작업 | `recipe_id`, `owner_user_id`, `name`, `visibility`, `current_revision` | PostgreSQL | gh-recipe | FR-GH-005 |
| ENT-GH-004 | GhRecipeRevision | Recipe 개정 | `revision_id`, `recipe_id`, `revision`, `definition`, `created_by`, `created_at` | PostgreSQL | gh-recipe | FR-GH-005 |
| ENT-GH-005 | GhApproval | 승인 대기·처리 기록 | `approval_id`, `execution_id`, `required_role`, `state`, `decided_by`, `decided_at`, `reason` | PostgreSQL | gh-policy | FR-GH-009, FR-GH-013 |
| ENT-GH-006 | GhCapabilitySnapshot | 적용 중인 capability manifest | `snapshot_id`, `gh_version`, `manifest_version`, `manifest_hash`, `command_count`, `flag_count`, `unclassified_count`, `activated_at`, `alias_count`, `positional_count`, `inherited_flag_count`, `interaction_unclassified_count`, `extension_command_count` (CR-008) | PostgreSQL | gh-registry | FR-GH-001, FR-GH-011 |
| ENT-GH-007 | GhCapabilityConstraint | capability의 유효 조합 정의 (CR-008, ADR-017) | `capability_id`, `kind`(`requires`/`conflicts`/`oneOf`/`exactlyOne`/`atLeastOne`/`implies`/`repeatable`/`minItems`/`maxItems`/`enum`/`conditional`/`inputSource`/`context`), `subjects[]`, `condition`, `values[]`, `bounds` | manifest (PostgreSQL 스냅숏) | gh-registry | FR-GH-003 |
| ENT-GH-008 | GhInvocation | 사용자 의도의 구조화 표현 (CR-008, ADR-017) | `capability_id`, `context`(host/org/repo/ref/workspace), `positional_arguments[]`, `flags[]`, `stdin_source`, `file_bindings[]`, `output_options` | PostgreSQL (`gh_execution`에 내장) | gh-exec | FR-GH-002, FR-GH-012 |
| ENT-GH-009 | GhResultContract | capability의 결과 계약 (CR-009, ADR-020) | `capability_id`, `kind`(json/resource/resource_list/url/artifact/text/stream/exit_status), `schema`, `resource_type`, `bindable`, `sensitivity`(public/internal/sensitive/secret), `adapters[]`, `composability` | manifest (PostgreSQL 스냅숏) | gh-registry | FR-GH-001, FR-GH-005 |
| ENT-GH-010 | GhResourceRef | 명령 사이를 잇는 공통 자원 참조 (CR-009) | `host`, `kind`, `repository`, `id`, `number`, `ref` | 값 타입 (실행·Recipe에 내장) | gh-exec, gh-recipe | FR-GH-005 |
| ENT-GH-011 | GhBinding | Recipe 단계 사이의 구조화된 연결 (CR-009) | `source_step`, `source_port`, `target_step`, `target_slot`(input/positional/flag/context), `field_selector`(선언된 named field 또는 제한된 JSON Pointer) | PostgreSQL (`gh_recipe_revision.definition`) | gh-recipe | FR-GH-005 |

## 3. PostgreSQL 스키마

### 3.1 수집

```sql
CREATE TABLE raw_event (
  delivery_id     TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  action          TEXT,
  repository_id   BIGINT,
  received_at     TIMESTAMPTZ NOT NULL,
  payload         JSONB       NOT NULL,
  payload_hash    TEXT        NOT NULL,          -- delivery_id 부재 시 대체 멱등 키 (FR-ING-002 AC-4)
  queued_at       TIMESTAMPTZ,                   -- 아웃박스: enqueue 시각
  processed_at    TIMESTAMPTZ,                   -- 투영 완료 시각
  correlation_id  UUID        NOT NULL,
  PRIMARY KEY (delivery_id, received_at)         -- 파티션 키 포함
) PARTITION BY RANGE (received_at);              -- 월별 파티션, 보존 만료는 파티션 드롭

-- CR-006(DEV-004): 이전 판에는 raw_event_delivery_uk를 별도로 만들었으나
-- PRIMARY KEY (delivery_id, received_at)과 컬럼·순서가 완전히 같은 중복 인덱스였다.
-- 5억 행·초당 2000 이벤트(NFR-002) 규모에서 중복 인덱스는 삽입 비용을 그대로
-- 두 배로 만들기 때문에 제거했다.
--
-- CR-007(DEV-009): 다만 기본 키만으로는 재전송 중복을 막지 못한다. PostgreSQL은
-- 파티션 테이블의 유일 제약이 파티션 키를 포함하도록 요구하므로 기본 키가
-- (delivery_id, received_at)이고, 재전송은 received_at이 달라 충돌하지 않는다.
-- delivery_id 단독 유일 제약은 이 파티션 구성에서 만들 수 없다.
-- FR-ING-002 AC-1이 요구하는 "중복 저장 차단"은 게이트웨이가 강제한다 —
-- 같은 트랜잭션에서 delivery_id에 advisory lock을 잡고 존재 검사와 INSERT를
-- 한 문장으로 묶는다(아래 참조). 기본 키 충돌은 같은 시각에 두 번 도착한
-- 경우를 위한 마지막 방어선으로 남는다.
CREATE INDEX raw_event_outbox_idx  ON raw_event (queued_at) WHERE processed_at IS NULL;
CREATE INDEX raw_event_repo_idx    ON raw_event (repository_id, received_at DESC);
```

수집 게이트웨이의 멱등 저장 (CR-007, DEV-009):

```sql
-- 한 트랜잭션 안에서 순서대로 실행한다 (apps/ingest-gateway/src/store.ts).
SET LOCAL lock_timeout = 2000;
SELECT pg_advisory_xact_lock(hashtext('ingest:' || $delivery_id));  -- 같은 전달 식별자 직렬화

INSERT INTO raw_event (delivery_id, event_type, action, repository_id,
                       received_at, payload, payload_hash, correlation_id)
SELECT $1, $2, $3, $4, $5, $6, $7, $8
 WHERE NOT EXISTS (SELECT 1 FROM raw_event WHERE delivery_id = $1);
-- rowCount = 0 이면 중복이다. HTTP 202 + duplicate: true (FR-ING-002 AC-2).

CREATE TABLE dead_letter (
  dead_letter_id  BIGSERIAL   PRIMARY KEY,
  delivery_id     TEXT        NOT NULL,
  stage           TEXT        NOT NULL,          -- enrich | project | sequence | link
  repository_id   BIGINT,                        -- 저장소 필터용. 조직 단위 이벤트는 NULL
  error           TEXT        NOT NULL,
  retry_count     INT         NOT NULL DEFAULT 0,
  reprocess_count INT         NOT NULL DEFAULT 0,
  state           TEXT        NOT NULL,          -- pending | reprocessing | held | resolved
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dead_letter_delivery_stage_uk UNIQUE (delivery_id, stage)
);
CREATE INDEX dead_letter_state_idx ON dead_letter (state, created_at);
CREATE INDEX dead_letter_repo_idx  ON dead_letter (repository_id, created_at DESC);
```

**한 (전달, 단계)에 행 하나다 (CR-012, DEV-022).** `EVT-ING-004`가 멱등 키를 `(delivery_id, stage)`로 정한 것과 같은 기준이며, 유일 제약이 그것을 강제한다. 제약이 없으면 재처리가 실패할 때마다 `reprocess_count = 0`인 새 행이 생겨 **FR-ING-007의 "동일 이벤트가 3회 재처리 실패하면 보류"가 영원히 성립하지 않는다.** 100건 경보(AC-5)도 서로 다른 이벤트 수가 아니라 실패 횟수를 세게 된다.

기록은 그래서 삽입이 아니라 업서트다. 충돌 시 상태 전이는 하나의 문장으로 정해진다.

| 기존 상태 | 새 상태 | `reprocess_count` | 뜻 |
| --- | --- | --- | --- |
| (없음) | `pending` | 0 | 첫 실패 |
| `pending` | `pending` | 그대로 | 재처리를 거치지 않은 실패가 또 났다. 마지막 오류만 갱신한다 |
| `reprocessing` | `pending` / `held` | +1 | **재처리가 실패했다.** 누적이 3에 닿으면 `held` |
| `held` | `held` | 그대로 | 자동 재처리 대상에서 빠진 채로 남는다 |
| `resolved` | `pending` | 0 | 성공으로 닫혔던 이벤트가 새로 실패했다. 이전 주기의 누적을 물려받지 않는다 |

**`resolved`는 종료 상태다 (CR-012, DEV-023).** 재처리는 원본을 파이프라인에 다시 넣는 비동기 작업이라 API가 성공을 알 수 없다. 대신 투영이 `raw_event.processed_at`을 찍는 자리에서 그 전달의 열린 행을 닫는다 — 그 시점이 "이 이벤트가 끝까지 갔다"는 유일한 증거다. 닫지 않으면 성공한 행이 `reprocessing`으로 영영 남아 경보 임계를 잠식한다. 행을 지우지 않는 이유는 보존 정책(9장)이 이 표를 90일 보관 대상으로 두었기 때문이다 — 무엇이 왜 실패했다가 언제 풀렸는지가 운영 기록이다.

`raw_event`의 `queued_at`/`processed_at`이 아웃박스 역할을 한다. Redis 유실 시 `queued_at IS NOT NULL AND processed_at IS NULL`이면서 일정 시간이 지난 행을 재적재한다 (ADR-002 follow-up, `JOB-ING-007`).

#### `pull_request_snapshot` — 백필·조정의 정본 (CR-034, DEV-184)

```sql
CREATE TABLE pull_request_snapshot (
  repository_id    BIGINT      NOT NULL,
  pr_number        INT         NOT NULL,
  document_version BIGINT      NOT NULL,
  source           TEXT        NOT NULL,   -- 'webhook' | 'backfill' | 'reconcile'
  document         JSONB       NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, pr_number)
);
```

**`raw_event`만으로는 ADR-004가 성립하지 않는다.** 웹훅으로 들어온 PR은 그 표가 재구성 근거이지만, **백필(JOB-ING-004)과 조정 스캔(JOB-ING-005)은 GHE에서 직접 읽어 Elasticsearch에만 쓴다** — `raw_event` 행을 남기지 않는다. 그 PR들은 색인에만 존재했고, "어떤 데이터도 검색 인덱스에만 존재해서는 안 된다"가 그 경로에서 실제로 깨져 있었다.

- **두 투영 경로가 함께 남긴다.** 실시간과 백필·조정이 이미 같은 `buildUpsertRequests`를 쓰므로 그 결과를 한 자리에서 저장한다 — 한쪽만 남기면 그쪽만 재구성 가능한 반쪽 불변식이 된다.
- **색인보다 먼저 쓴다.** 정본이 먼저 있어야 색인 실패가 데이터 유실이 아니다.
- **`document_version`은 Elasticsearch 업서트와 같은 값이다.** 그래서 "오래된 백필이 최신 웹훅을 덮어쓰지 않는다"(DEV-099)가 이 표에서도 같은 규칙으로 성립하고, 같은 PR 재실행은 멱등이다.
- **합성 웹훅을 `raw_event`에 넣지 않는다.** 원본 레인은 실제로 받은 것만 담아야 감사 근거가 된다.
- 문서에는 변경 **경로 이름**만 있고 소스 코드·패치 본문은 애초에 들어 있지 않다.

`JOB-ING-008`의 정합성 대조가 이 표를 정본으로 읽는다 — 재구성 근거와 대조 근거가 같은 것이다.

#### `repository.allowed_team_ids` — 팀 접근 범위 (WP-068 / CR-035, DEV-114)

```sql
ALTER TABLE repository ADD COLUMN allowed_team_ids BIGINT[] NOT NULL DEFAULT '{}';
CREATE INDEX repository_allowed_teams_idx ON repository USING GIN (allowed_team_ids);
```

네 색인 매핑이 모두 이 필드를 선언하고 강제 필터의 `org_team` 경로와 `team:` 질의가 그것을 읽는데, **값을 만드는 자리가 없었다.**

- **레지스트리가 소유한다** (CR-024). 등록·갱신 시 GHE `GET /repos/{owner}/{repo}/teams`로 채운다.
- **`EVT-ING-002`에 싣지 않는다.** 팀 권한은 PR 엔티티의 버전이 아니라 **저장소 접근 상태**다 — 이벤트에 실으면 권한 변경이 문서 버전을 올려 수집 순서를 흔든다.
- 팀 변경은 `permission.invalidated`(EVT-AUTH-001) 소비자에서 **권한 캐시 무효화와 함께** `update_by_query`로 소급 적용하며, `document_version`은 건드리지 않는다.
- **소급 대상은 네 색인 전부다.** `repository_archived`를 갖는 둘(`ARCHIVABLE_ALIASES`)과 다르다 — 둘만 돌리면 관계·릴리스 문서가 옛 권한을 들고 남는다.

### 3.2 시퀀스 (핵심)

```sql
CREATE TABLE sequence_space (
  repository_id    BIGINT      NOT NULL,
  base_branch      TEXT        NOT NULL,
  seq_epoch        INT         NOT NULL DEFAULT 1,
  head_sha         TEXT,                          -- 마지막 채번 시점의 브랜치 head
  head_seq         BIGINT      NOT NULL DEFAULT 0,
  state            TEXT        NOT NULL DEFAULT 'ok',  -- ok | stale | reassigning | unknown
  last_assigned_at TIMESTAMPTZ,
  last_error       TEXT,
  PRIMARY KEY (repository_id, base_branch)
);

CREATE TABLE merge_sequence (
  repository_id        BIGINT      NOT NULL,
  base_branch          TEXT        NOT NULL,
  seq_epoch            INT         NOT NULL,
  merge_seq            BIGINT      NOT NULL,
  commit_sha           TEXT        NOT NULL,
  pull_request_number  INT,                       -- 직접 푸시 커밋은 NULL (FR-SEQ-001 AC-3)
  committed_at         TIMESTAMPTZ NOT NULL,
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, base_branch, seq_epoch, merge_seq)
);

CREATE UNIQUE INDEX merge_sequence_commit_uk
  ON merge_sequence (repository_id, base_branch, seq_epoch, commit_sha);
CREATE INDEX merge_sequence_pr_idx
  ON merge_sequence (repository_id, pull_request_number)
  WHERE pull_request_number IS NOT NULL;
```

채번 동시성 제어는 PostgreSQL advisory lock을 사용한다 (FR-SEQ-001 AC-6).

```sql
SELECT pg_try_advisory_xact_lock(hashtext('seq:' || repository_id || ':' || base_branch));
```

락을 얻지 못하면 잡을 재큐에 넣고 종료한다. 대기하지 않는다.

```sql
CREATE TABLE safe_marker (
  marker_id     BIGSERIAL   PRIMARY KEY,
  repository_id BIGINT      NOT NULL,
  base_branch   TEXT        NOT NULL,
  seq_epoch     INT         NOT NULL,
  merge_seq     BIGINT      NOT NULL,
  note          TEXT        CHECK (char_length(note) <= 500),
  created_by    TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ                        -- 이력 보존: 대체 시 시각 기록 (FR-SEQ-006 AC-1)
);
CREATE UNIQUE INDEX safe_marker_current_uk
  ON safe_marker (repository_id, base_branch) WHERE superseded_at IS NULL;
-- 에폭 무효(FR-SEQ-005 AC-4)는 열이 아니다: 표식이 저장한 seq_epoch와 현재
-- 에폭의 비교로 조회가 epoch_stale을 계산한다 (CR-026, DEV-126). superseded_at은
-- "새 표식으로 대체됨"이지 에폭 무효가 아니다 — 둘을 섞지 않는다.

CREATE TABLE bisect_session (
  session_id    BIGSERIAL   PRIMARY KEY,
  user_id       TEXT        NOT NULL,
  repository_id BIGINT      NOT NULL,
  base_branch   TEXT        NOT NULL,
  seq_epoch     INT         NOT NULL,
  good_seq      BIGINT,
  bad_seq       BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, repository_id, base_branch)
);
```

`bisect_session`이 `seq_epoch`를 들고 있으므로, 에폭이 바뀌면 탐색 상태를 무효화할 수 있다 (FLOW-004 예외 흐름).

#### `release` (CR-028, DEV-142 — WP-024)

```sql
CREATE TABLE release (
  release_id    BIGSERIAL   PRIMARY KEY,
  repository_id BIGINT      NOT NULL,
  tag_name      TEXT        NOT NULL,
  commit_sha    TEXT        NOT NULL,
  -- 태그 커밋이 어느 시퀀스 브랜치의 first-parent 체인에도 없으면 셋 다 NULL이다.
  -- 그 릴리스는 표시는 되지만 앵커·포함 판정에는 쓰이지 않는다 (ADR-007).
  base_branch   TEXT,
  seq_epoch     INT,
  merge_seq     BIGINT,
  released_at   TIMESTAMPTZ NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'git_tag',
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, tag_name),
  CONSTRAINT release_source_chk CHECK (source IN ('git_tag', 'github_release', 'ci_deployment')),
  CONSTRAINT release_seq_chk CHECK (
    (base_branch IS NULL AND seq_epoch IS NULL AND merge_seq IS NULL)
    OR (base_branch IS NOT NULL AND seq_epoch IS NOT NULL AND merge_seq IS NOT NULL)
  )
);

CREATE INDEX release_containment_idx
  ON release (repository_id, base_branch, merge_seq)
  WHERE merge_seq IS NOT NULL;
```

**왜 PostgreSQL이 정본인가 (DEV-142).** ADR-004가 요구하고, DEV-130이 정한 원칙이 여기에도 그대로 적용된다 — 포함 판정과 릴리스 앵커는 범위 인용의 일부이며, ES에만 있는 데이터를 딛으면 색인 반영 실패가 **오류 없이 항목을 빠뜨린다.** `prs-releases`는 이 표의 투영이다.

**태그의 정본은 미러다 (DEV-143, 실측).** `--mirror` 클론의 refspec은 `--no-tags`와 무관하게 태그를 옮기고 prune이 삭제도 반영한다. 갱신 잡은 미러의 `for-each-ref refs/tags`로 태그 전량을 열거해 이 표와 diff한다 — 원격에서 지워진 태그는 여기서도 지운다. `released_at`은 git `creatordate`(주석 태그 = taggerdate, 경량 태그 = 커밋 시각)이고, GHE 자격 증명이 있으면 GitHub Release의 `published_at`이 그 태그의 값을 덮는다(`source: github_release`) (DEV-147).

**서수는 현재 에폭으로 전량 재해석한다 (DEV-149).** 태그 수는 작으므로 갱신 잡은 매번 저장소의 모든 태그를 현재 `seq_epoch` 기준으로 다시 해석한다 — 재채번(WP-022)이 에폭을 올려도 다음 갱신이 자가 치유하고, 조회는 릴리스의 `seq_epoch`가 공간의 현재 에폭과 일치할 때만 서수를 신뢰한다 (FR-SEQ-005 AC-4의 원칙).

### 3.3 레지스트리와 권한

```sql
CREATE TABLE repository (
  repository_id     BIGINT      PRIMARY KEY,       -- GHE 숫자 ID
  owner             TEXT        NOT NULL,
  name              TEXT        NOT NULL,
  org_id            BIGINT      NOT NULL,
  visibility        TEXT        NOT NULL,          -- public | internal | private
  sequence_branches TEXT[]      NOT NULL DEFAULT '{}',   -- 최대 10 (FR-ING-009 AC-2)
  mirror_enabled    BOOLEAN     NOT NULL DEFAULT true,
  allowed_team_ids  BIGINT[]    NOT NULL DEFAULT '{}',   -- 이 저장소에 접근할 수 있는 팀 (CR-024)
  snapshot_bootstrapped_at TIMESTAMPTZ,                  -- 정본 스냅숏이 완전하다고 확인된 시점 (CR-037, DEV-194)
  status            TEXT        NOT NULL DEFAULT 'active', -- active | archived
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sequence_branches_limit CHECK (array_length(sequence_branches, 1) <= 10),
  UNIQUE (owner, name)
);
CREATE INDEX repository_allowed_teams_idx ON repository USING GIN (allowed_team_ids);

#### `commit_snapshot` — 커밋 정본 (WP-067 / CR-038, DEV-208 / ADR-004)

```sql
-- 마이그레이션 013
CREATE TABLE commit_snapshot (
  repository_id           BIGINT      NOT NULL,
  commit_sha              TEXT        NOT NULL,
  parent_shas             TEXT[]      NOT NULL DEFAULT '{}',
  message                 TEXT        NOT NULL DEFAULT '',
  author                  TEXT,
  committer               TEXT,
  authored_at             TIMESTAMPTZ NOT NULL,
  committed_at            TIMESTAMPTZ NOT NULL,
  changed_paths           TEXT[]      NOT NULL DEFAULT '{}',
  changed_paths_truncated BOOLEAN     NOT NULL DEFAULT false,
  patch_id                TEXT,
  patch_id_unavailable    TEXT,
  metadata_source         TEXT        NOT NULL,   -- 'mirror' | 'api'
  fetched_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, commit_sha)
);
```

커밋 **자체의** 메타데이터에는 정규화된 자리가 없었다 — `merge_sequence`는 서수와 SHA만 알고 `raw_event`는 웹훅으로 들어온 것만 담는다. WP-067을 원래 계약대로 구현하면 메시지·작성자·부모·변경 경로가 **색인에만** 존재하게 되고, 색인을 잃으면 되살릴 근거가 없다 — **ADR-004가 커밋 축에서 깨진다.** CR-034가 PR 축에서 겪은 것(마이그레이션 010)과 같은 모양이며, 같은 실수를 반복하지 않는다.

**소스 코드 본문과 patch 본문은 어떤 열에도 담지 않는다** (NFR-005). 변경 경로는 파일 **이름**이고 `patch_id`는 diff의 해시이지 diff가 아니다. 이메일도 담지 않는다 — CR-038이 승인한 필드 목록에 없다.

값은 전부 커밋 객체가 가진 것이라 **불변**이다. 같은 SHA면 언제 읽어도 같으므로 조건부 버전 비교가 필요 없고, 그래서 보강이 멱등하며 `document_version`을 올릴 이유도 없다 (DEV-209). 다만 **미러가 얻은 `patch_id`를 API 폴백 회차가 `no_mirror`로 덮지 않는다** — 능력이 없는 쪽이 있는 쪽을 지우면 체리픽 파생(WP-030)이 근거를 잃는다.

#### `repository.snapshot_bootstrapped_at` — 정본 스냅숏 완결 표시 (CR-037, DEV-194·195)

```sql
-- 마이그레이션 012
ALTER TABLE repository ADD COLUMN snapshot_bootstrapped_at TIMESTAMPTZ;
CREATE INDEX repository_snapshot_bootstrap_idx
  ON repository (repository_id) WHERE snapshot_bootstrapped_at IS NULL;
```

`NULL`은 **"아직 부트스트랩되지 않았다"**이며, 마이그레이션 012 이후 기존 행은 전부 `NULL`로 시작한다 — 그 저장소들의 스냅숏이 완전한지 우리는 실제로 모르고, **모르는 것을 "완료"로 적으면 정합성 감시가 그 위에서 거짓을 말한다.**

JOB-ING-010이 실패 0건으로 끝났을 때만 찍힌다. JOB-ING-008은 이 열이 `NULL`인 저장소를 `extra_in_es`가 아니라 **`snapshot_bootstrap_pending`**으로 보고한다 (DEV-195) — "Elasticsearch가 잘못됐다"와 "PostgreSQL 부트스트랩이 아직 안 끝났다"는 다른 사실이고 조치도 다르다.

CREATE TABLE app_user (
  user_id               TEXT        PRIMARY KEY,          -- OIDC sub (CR-015, DEV-043)
  login                 TEXT        NOT NULL UNIQUE,      -- GHE login
  github_user_id        BIGINT      UNIQUE,               -- GHE 숫자 id (CR-015, DEV-043)
  email                 TEXT,
  roles                 TEXT[]      NOT NULL DEFAULT '{developer}',
  access_scope_version  INT         NOT NULL DEFAULT 0,   -- 무효화 시 증가 (CR-015, DEV-044)
  last_seen_at          TIMESTAMPTZ
);

CREATE TABLE team (
  team_id BIGINT PRIMARY KEY,
  slug    TEXT   NOT NULL,
  org_id  BIGINT NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE TABLE team_member (
  team_id BIGINT NOT NULL REFERENCES team(team_id),
  user_id TEXT   NOT NULL REFERENCES app_user(user_id),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE permission_cache (            -- Redis 미스 시 백업 (ADR-008)
  user_id      TEXT        PRIMARY KEY REFERENCES app_user(user_id),
  scope_kind   TEXT        NOT NULL,       -- explicit | org_team  (500개 초과 시 org_team)
  repository_ids BIGINT[],
  org_ids      BIGINT[],
  team_ids     BIGINT[],
  refreshed_at TIMESTAMPTZ NOT NULL
);

-- `repository` 웹훅의 "영향 사용자"를 찾는 색인 (CR-015, DEV-045).
-- 없으면 전량 스캔이고, org_team 모드 사용자는 저장소를 나열하지 않아 아예 찾히지 않는다.
CREATE INDEX permission_cache_repos_idx ON permission_cache USING GIN (repository_ids);
CREATE INDEX permission_cache_orgs_idx  ON permission_cache USING GIN (org_ids);
```

**모든 검색 문서는 `doc_id`를 갖는다 (CR-016, DEV-059).** `_id`와 같은 값이다. Elasticsearch 8이 `_id` 정렬을 금지하므로 FR-SRCH-007 AC-4의 "문서 ID를 마지막 정렬 키로"를 성립시키려면 그 값이 정렬 가능한 필드로 문서 안에 있어야 한다. `@prs/es`의 `upsert`가 자동으로 채우므로 투영이 잊을 수 없다.

**`org`·`team` 질의는 레지스트리를 거친다 (CR-016, DEV-052).** 검색 문서는 `org_id`와 `allowed_team_ids`를 **숫자로만** 갖는다 — 조직 이름도 팀 slug도 없다. 사용자는 `org:acme`·`team:payments-core`처럼 이름으로 묻으므로, 질의 빌더가 `repository.owner` → `org_id`, `team.slug` → `team_id`로 먼저 해석한다. 문서에 이름을 더해 재색인하지 않는 이유는 그 이름의 주인이 레지스트리이고, 조직명·팀명이 바뀌면 문서 전량을 다시 써야 하기 때문이다.

**신원의 세 가지 표현 (CR-015, DEV-043).** 세션은 OIDC `sub`로 만들어지고, 무효화 이벤트는 GHE 신원으로 도착한다. `user_id`(OIDC `sub`)가 기본 키이고, `login`과 `github_user_id`가 GHE 쪽 두 이름이다. 무효화는 **`github_user_id`를 우선 쓴다** — login은 개명될 수 있지만 숫자 id는 아니고, 개명 웹훅을 놓친 사이의 무효화가 조용히 아무도 맞히지 못하는 것이 이 시스템에서 가장 나쁜 실패다.

**`access_scope_version`은 울타리다 (CR-015, DEV-044).** 무효화마다 증가하고, 캐시 갱신은 시작 시점에 읽은 값이 그대로일 때만 기록한다. 회수 직전에 시작된 GHE 조회가 회수 뒤에 끝나면서 회수 이전 범위를 되살리는 것을 막는다. 보안 문서 5.4에 순서가 있다.

**`team_member`는 `team` 웹훅이 채운다 (CR-015, DEV-046).** authz 소비자가 이벤트를 받아 GHE에서 구성원을 다시 읽어 갱신한다. 표를 무효화의 유일한 근거로 삼지는 않는다 — 비어 있는 표가 "무효화할 사람이 없다"로 읽히면 회수가 반영되지 않는다.

**`allowed_team_ids`의 주인은 이 표다 (CR-024).** 네 개의 Elasticsearch 매핑이 모두 `allowed_team_ids`를 선언하고, 강제 접근 범위 필터(`org_team` 경로)와 `team:` 질의 필터가 그 값을 **읽는다.** 그런데 그 값을 만들어 내는 자리가 어디에도 없었다 — 투영은 `org_id`와 `visibility`만 저장소 등록에서 복사한다. 그래서 이 열을 여기에 둔다.

**이벤트에 싣지 않는 이유가 있다.** 팀 권한은 PR·커밋 웹훅이 나르는 **엔티티 상태가 아니라 저장소의 운영 상태**다. `EVT-ING-002`에 실으면 이벤트마다 값이 달라지는데 `document_version`은 PR의 버전이지 저장소 권한의 버전이 아니므로 어느 쪽이 최신인지 판정할 방법이 없다. `repository_archived`가 이미 같은 이유로 이벤트가 아니라 레지스트리에서 온다 (CR-013, DEV-028).

**팀 구성이 바뀌면 소급 적용한다.** `repository.allowed_team_ids`를 갱신한 뒤 `update_by_query`로 기존 문서를 고친다 — `markRepositoryArchived`와 같은 형태다. 이 경로가 없으면 팀에서 빠진 사용자가 과거 문서를 계속 보게 된다. `document_version`은 건드리지 않는다.

**지금은 비어 있고, 비어 있는 것이 안전한 쪽으로 실패한다.** 열이 없던 동안 문서의 `allowed_team_ids`도 비어 있었으므로 `team:` 필터는 아무것도 맞히지 못했고, 500 저장소 초과 시의 `org_team` 경로는 팀을 통해서만 볼 수 있는 비공개 저장소를 **덜 보여 주었다**. 유출이 아니라 누락이다. 채우는 일은 WP-068이 한다 (DEV-114).

### 3.4 애플리케이션 상태

```sql
CREATE TABLE saved_search (
  saved_search_id BIGSERIAL   PRIMARY KEY,
  owner_user_id   TEXT        NOT NULL REFERENCES app_user(user_id),
  name            TEXT        NOT NULL,
  query           TEXT        NOT NULL,
  visibility      TEXT        NOT NULL DEFAULT 'private',  -- private | team
  team_id         BIGINT      REFERENCES team(team_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at     TIMESTAMPTZ,
  UNIQUE (owner_user_id, name)
);
-- 사용자당 100건 상한 (FR-SRCH-010 AC-4)은 애플리케이션 계층에서 검사한다.

CREATE TABLE job (
  job_id      BIGSERIAL   PRIMARY KEY,
  type        TEXT        NOT NULL,   -- backfill | reconcile | reindex | sequence_assign
                                      -- | sequence_reassign (마이그레이션 009, CR-033 DEV-172)
                                      -- | sequence_integrity | link_rebuild | export
                                      -- | snapshot_bootstrap (마이그레이션 012, CR-037 DEV-194)
  target      TEXT        NOT NULL,   -- repository_id 또는 인덱스명 등
  state       TEXT        NOT NULL,   -- queued | running | paused | completed | failed | cancelled
  progress    JSONB       NOT NULL DEFAULT '{}',
  cursor      JSONB,                  -- 중단 후 재개 지점 (FR-ING-006 AC-4)
  requested_by TEXT       NOT NULL,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error       TEXT
);
CREATE UNIQUE INDEX job_active_uk ON job (type, target)
  WHERE state IN ('queued', 'running', 'paused');   -- 동시 1개 (FR-ADMIN-002 AC-4)

-- CR-006(DEV-005): PostgreSQL은 파티션 테이블의 유니크 제약이 파티션 키를
-- 포함하도록 요구한다. 이전 판의 PRIMARY KEY (audit_id)는 실행되지 않는다.
CREATE TABLE audit_record (
  audit_id       BIGSERIAL   NOT NULL,
  user_id        TEXT        NOT NULL,
  action         TEXT        NOT NULL,
  target         TEXT,
  query          TEXT,
  result_code    TEXT        NOT NULL,
  correlation_id UUID        NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_id, occurred_at)
) PARTITION BY RANGE (occurred_at);      -- 월별 파티션, 1년 보존 (NFR-006)
CREATE INDEX audit_user_idx   ON audit_record (user_id, occurred_at DESC);
CREATE INDEX audit_action_idx ON audit_record (action, occurred_at DESC);
```

`audit_record`에는 UPDATE·DELETE 권한을 애플리케이션 롤에 부여하지 않는다 (FR-AUTH-004 AC-3). 보존 만료 삭제는 별도 관리 롤이 파티션 드롭으로 수행한다.

### 3.5 GitHub Operations (CR-005 신규)

기존 마이그레이션 001~005는 수정하지 않는다. 아래 스키마는 **006 이후 additive 마이그레이션**으로만 추가한다.

```sql
-- 006: 위임 신원. 토큰 원문을 저장하지 않는다 (FR-GH-008 AC-5).
CREATE TABLE github_identity_connection (
  user_id       TEXT        PRIMARY KEY REFERENCES app_user(user_id),
  github_login  TEXT        NOT NULL,
  github_user_id BIGINT     NOT NULL,
  token_ref     TEXT        NOT NULL,          -- 비밀 저장소 참조. 토큰 값이 아니다
  scopes        TEXT[]      NOT NULL DEFAULT '{}',
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

-- 007: 실행 기록. 월별 파티션 (감사와 같은 1년 보존).
CREATE TABLE gh_execution (
  execution_id      BIGSERIAL   NOT NULL,
  user_id           TEXT        NOT NULL,
  github_actor      TEXT        NOT NULL,
  host              TEXT        NOT NULL,
  repository        TEXT,
  target            TEXT,
  capability_id     TEXT        NOT NULL,
  redacted_argv     TEXT[]      NOT NULL,      -- 비밀은 <redacted>로 치환된 상태
  risk_level        TEXT        NOT NULL,
  state             TEXT        NOT NULL,
  gh_version        TEXT        NOT NULL,
  manifest_version  TEXT        NOT NULL,
  manifest_hash     TEXT        NOT NULL,
  idempotency_key   TEXT        NOT NULL,
  authorization_result TEXT     NOT NULL,
  confirmed_at      TIMESTAMPTZ,
  approval_id       BIGINT,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  exit_code         INT,
  output_hash       TEXT,
  error             TEXT,
  correlation_id    UUID        NOT NULL,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, requested_at),
  CONSTRAINT gh_execution_risk_chk CHECK (risk_level IN ('R0','R1','R2','R3')),
  CONSTRAINT gh_execution_state_chk CHECK (state IN (
    'queued','preflighting','awaiting_confirmation','awaiting_approval',
    'running','succeeded','failed','cancelled','timed_out','policy_blocked'))
) PARTITION BY RANGE (requested_at);

-- 같은 중복 방지 키의 재요청은 새 실행을 만들지 않는다 (FR-GH-012 AC-5).
CREATE UNIQUE INDEX gh_execution_idem_uk ON gh_execution (user_id, idempotency_key, requested_at);
CREATE INDEX gh_execution_user_idx ON gh_execution (user_id, requested_at DESC);
CREATE INDEX gh_execution_target_idx ON gh_execution (repository, target, requested_at DESC);

-- 같은 대상에 상충 작업이 동시에 진행되지 않도록 한다 (FR-GH-012 AC-6).
-- 활성 상태에만 걸리는 부분 유니크 인덱스다.
CREATE TABLE gh_execution_lock (
  lock_key     TEXT        PRIMARY KEY,        -- {host}:{repository}:{target}:{action_class}
  execution_id BIGINT      NOT NULL,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE gh_execution_artifact (
  artifact_id   BIGSERIAL   PRIMARY KEY,
  execution_id  BIGINT      NOT NULL,
  name          TEXT        NOT NULL,
  size_bytes    BIGINT      NOT NULL,
  content_type  TEXT,
  storage_ref   TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

-- 008: Recipe
CREATE TABLE gh_recipe (
  recipe_id        BIGSERIAL   PRIMARY KEY,
  owner_user_id    TEXT        NOT NULL REFERENCES app_user(user_id),
  name             TEXT        NOT NULL,
  visibility       TEXT        NOT NULL DEFAULT 'private',
  current_revision INT         NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gh_recipe_visibility_chk CHECK (visibility IN ('private','team','org')),
  UNIQUE (owner_user_id, name)
);

CREATE TABLE gh_recipe_revision (
  revision_id  BIGSERIAL   PRIMARY KEY,
  recipe_id    BIGINT      NOT NULL REFERENCES gh_recipe(recipe_id),
  revision     INT         NOT NULL,
  definition   JSONB       NOT NULL,          -- 등록된 capability만 참조 (FR-GH-005 AC-2)
  created_by   TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, revision)
);

-- 009: 승인과 capability 스냅샷
CREATE TABLE gh_approval (
  approval_id   BIGSERIAL   PRIMARY KEY,
  execution_id  BIGINT      NOT NULL,
  required_role TEXT        NOT NULL,
  state         TEXT        NOT NULL DEFAULT 'pending',
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  reason        TEXT,
  CONSTRAINT gh_approval_state_chk CHECK (state IN ('pending','approved','rejected','expired'))
);

CREATE TABLE gh_capability_snapshot (
  snapshot_id        BIGSERIAL   PRIMARY KEY,
  gh_version         TEXT        NOT NULL,
  manifest_version   TEXT        NOT NULL,
  manifest_hash      TEXT        NOT NULL,
  command_count      INT         NOT NULL,
  flag_count         INT         NOT NULL,
  unclassified_count INT         NOT NULL,
  activated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (manifest_version, manifest_hash)
);

-- 미분류가 하나라도 있으면 활성화하지 않는다 (NFR-009).
ALTER TABLE gh_capability_snapshot
  ADD CONSTRAINT gh_capability_no_unclassified CHECK (unclassified_count = 0);
```

**저장하지 않는 것.** GitHub 액세스 토큰, 사용자가 입력한 비밀 값, 비밀이 포함된 argv 원문. `redacted_argv`는 이미 마스킹된 배열이며 원문을 복원할 수 없다.

## 4. Elasticsearch 매핑

공통 설정 (모든 엔티티 인덱스):

```json
{
  "settings": {
    "index.number_of_replicas": 1,
    "index.refresh_interval": "1s",
    "index.sort.field": ["repository_id", "merge_seq"],
    "index.sort.order": ["asc", "desc"],
    "index.sort.missing": ["_last", "_last"],
    "analysis": {
      "normalizer": {
        "lowercase_normalizer": { "type": "custom", "filter": ["lowercase"] }
      },
      "analyzer": {
        "text_ko_en": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        },
        "path_analyzer": { "type": "custom", "tokenizer": "path_hierarchy" }
      }
    }
  }
}
```

- `text_ko_en`은 **`standard` 토크나이저 기반이 본 구현이다** (OD-005 resolved, CR-040 — `nori` 플러그인을 초기 REL-004 의존성으로 채택하지 않는다). WP-032가 여기에 `edge_ngram` 부분 일치 필드를 더해 FR-SRCH-011 AC-4를 만족시킨다. **분석기 이름은 어떤 경우에도 유지한다** — 매핑 4종이 이 이름을 참조하므로, 재검토 조건이 충족되어 나중에 `nori_tokenizer`로 교체하더라도 매핑은 바뀌지 않는다 (FR-SRCH-011 AC-4).
- `index.sort`는 **기본 정렬(시퀀스 내림차순)** 에서 조기 종료를 얻기 위한 것이다 (ADR-003). **시퀀스 범위 조회는 여기 해당하지 않는다** (CR-027, DEV-131) — 색인 정렬은 `merge_seq` 내림차순인데 FR-SEQ-002는 오름차순 결과를 요구하므로 방향이 어긋나 조기 종료 조건이 서지 않는다. 범위 조회는 애초에 Elasticsearch를 범위 스캔에 쓰지 않는다(DEV-130).
- **`index.sort`는 `merge_seq`를 가진 인덱스에만 적용한다** (CR-007, DEV-007). `prs-links`에는 `merge_seq`가 없고, Elasticsearch는 매핑에 없는 필드로 `index.sort`를 걸면 인덱스 생성을 거부한다. 간선은 `from_id`/`to_id`로 조회하므로 시퀀스 축 정렬이 필요하지도 않다. 나머지 공통 설정(복제본·refresh·분석기)은 네 인덱스 모두에 적용한다.
- `refresh_interval: 1s`는 수집 반영 SLO(p95 10초, NFR-002)와 색인 처리량의 절충값이다. 백필 중에는 해당 인덱스만 `30s`로 낮췄다가 복원한다(값이 커질수록 갱신이 뜸해져 처리량이 는다).
- **복원은 `finally`만으로 보장되지 않는다 (CR-022, DEV-105).** 프로세스가 죽으면 `finally`가 돌지 않아 인덱스가 `30s`에 남고 NFR-002를 영구히 어긴다. 그래서 **백필은 시작할 때 무조건 기본값으로 되돌린 뒤 올린다** — 앞선 잡이 남긴 것을 다음 잡이 치운다. 설정 변경 실패는 **잡을 중단시키지 않는다**: 색인은 느려질 뿐 계속되고, 백필을 통째로 멈추는 편이 더 나쁘다.

### 4.1 `prs-pull-requests`

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "document_version":    { "type": "long" },
      "repository_id":       { "type": "long" },
      "repository":          { "type": "keyword" },
      "org_id":              { "type": "long" },
      "visibility":          { "type": "keyword" },
      "allowed_team_ids":    { "type": "long" },

      "pr_number":           { "type": "integer" },
      "title":               { "type": "text", "analyzer": "text_ko_en",
                               "fields": { "raw": { "type": "keyword", "ignore_above": 512 } } },
      "body":                { "type": "text", "analyzer": "text_ko_en" },
      "state":               { "type": "keyword" },
      "draft":               { "type": "boolean" },

      "author":              { "type": "keyword" },
      "author_team_ids":     { "type": "long" },
      "reviewers":           { "type": "keyword" },
      "approved_by":         { "type": "keyword" },
      "labels":              { "type": "keyword" },

      "base_branch":         { "type": "keyword" },
      "head_branch":         { "type": "keyword" },
      "base_sha":            { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "head_sha":            { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "merge_commit_sha":    { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "source_commit_shas":  { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "source_commits_truncated": { "type": "boolean" },

      "merge_seq":           { "type": "long" },
      "seq_epoch":           { "type": "integer" },
      "sequence_space":      { "type": "keyword" },

      "created_at":          { "type": "date" },
      "updated_at":          { "type": "date" },
      "merged_at":           { "type": "date" },
      "closed_at":           { "type": "date" },
      "first_review_at":     { "type": "date" },

      "lead_time_seconds":        { "type": "long" },
      "first_review_wait_seconds":{ "type": "long" },

      "changed_files_count": { "type": "integer" },
      "additions":           { "type": "integer" },
      "deletions":           { "type": "integer" },
      "changed_paths":       { "type": "text", "analyzer": "path_analyzer",
                               "fields": { "raw": { "type": "keyword", "ignore_above": 1024 } } },
      "files_truncated":     { "type": "boolean" },

      "link_summary": {
        "properties": {
          "has_revert":        { "type": "boolean" },
          "is_reverted":       { "type": "boolean" },
          "has_cherry_pick":   { "type": "boolean" },
          "has_stack":         { "type": "boolean" },
          "reference_count":   { "type": "integer" }
        }
      },

      "release_tags":        { "type": "keyword" },
      "unreleased":          { "type": "boolean" },

      "enrichment_pending":  { "type": "boolean" },
      "links_pending":       { "type": "boolean" },
      "repository_archived": { "type": "boolean" },
      "last_delivery_id":    { "type": "keyword", "index": false },
      "indexed_at":          { "type": "date" }
    }
  }
}
```

`dynamic: "strict"`가 중요하다. 웹훅 payload에서 예기치 않은 필드가 흘러들어 소스 코드나 개인정보가 색인되는 것을 매핑 수준에서 차단한다 (NFR-005, SRS 11장 7항).

### 4.2 `prs-commits`

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "document_version":  { "type": "long" },
      "repository_id":     { "type": "long" },
      "repository":        { "type": "keyword" },
      "org_id":            { "type": "long" },
      "visibility":        { "type": "keyword" },
      "allowed_team_ids":  { "type": "long" },
      "repository_archived": { "type": "boolean" },

      "commit_sha":        { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "parent_shas":       { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "patch_id":          { "type": "keyword" },
      "patch_id_unavailable": { "type": "keyword" },   // no_mirror | blob_fetch_disabled | compute_failed (CR-024)

      "message":           { "type": "text", "analyzer": "text_ko_en",
                             "fields": { "subject": { "type": "keyword", "ignore_above": 512 } } },
      "author":            { "type": "keyword" },
      "committer":         { "type": "keyword" },
      "authored_at":       { "type": "date" },
      "committed_at":      { "type": "date" },

      "role":              { "type": "keyword" },
      "pull_request_numbers": { "type": "integer" },

      "base_branch":       { "type": "keyword" },
      "merge_seq":         { "type": "long" },
      "seq_epoch":         { "type": "integer" },
      "sequence_space":    { "type": "keyword" },

      "changed_paths":     { "type": "text", "analyzer": "path_analyzer",
                             "fields": { "raw": { "type": "keyword", "ignore_above": 1024 } } },
      "additions":         { "type": "integer" },
      "deletions":         { "type": "integer" },

      "link_summary": {
        "properties": {
          "has_revert":      { "type": "boolean" },
          "is_reverted":     { "type": "boolean" },
          "has_cherry_pick": { "type": "boolean" },
          "reference_count": { "type": "integer" }
        }
      },

      "release_tags":      { "type": "keyword" },
      "enrichment_pending":{ "type": "boolean" },
      "links_pending":     { "type": "boolean" },
      "last_delivery_id":  { "type": "keyword", "index": false },
      "indexed_at":        { "type": "date" }
    }
  }
}
```

`role`은 `merge_commit` / `source_commit` / `direct_push` 중 하나다 (FR-SRCH-002 AC-1~AC-3).

### 4.3 `prs-links`

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "link_id":       { "type": "keyword" },
      "repository_id": { "type": "long" },
      "org_id":        { "type": "long" },
      "visibility":    { "type": "keyword" },
      "allowed_team_ids": { "type": "long" },

      "from_type":     { "type": "keyword" },
      "from_id":       { "type": "keyword" },
      "to_type":       { "type": "keyword" },
      "to_id":         { "type": "keyword" },
      "to_repository_id": { "type": "long" },

      "link_type":     { "type": "keyword" },
      "reference_key": { "type": "keyword" },
      "confidence":    { "type": "keyword" },
      "evidence":      { "type": "text", "index": false },
      "resolved":      { "type": "boolean" },
      "detached":      { "type": "boolean" },
      "created_at":    { "type": "date" }
    }
  }
}
```

- `link_id`는 결정론적 해시다. 재파생이 중복 간선을 만들지 않는다. **재료는 간선 유형에 따라 다르다 (CR-039, DEV-217).**
  - `references`: `{link_type}:{from_type}:{from_id}:{reference_key}`. **대상이 아니라 참조 표현이 재료다.**
  - 그 밖(`reverts`·`cherry_picks`·`stacks_on`·`contains`): `{link_type}:{from_type}:{from_id}:{to_type}:{to_id}`. 이들은 대상 SHA/ID를 **알아낸 뒤에** 만들어지므로 대상이 나중에 바뀌지 않는다.
- **왜 `references`만 다른가.** FR-REL-003 AC-3은 "대상이 아직 색인되지 않았으면 미해결로 저장하고, 대상 색인 시 해결 상태로 **갱신**한다"를 요구한다. 그런데 `to_id`를 ID 재료에 넣으면 `Refs: abc1234`가 해결되는 순간 대상이 축약 SHA에서 40자 SHA로 바뀌어 **`link_id`가 함께 바뀐다.** 그러면 갱신이 아니라 새 문서가 되고 미해결 간선이 그대로 남는다 — AC-3·멱등·결정론적 ID가 한 번에 깨진다.
- `reference_key`는 **해결 대상과 독립인 정규화 locator**다. 원문 문자열이 아니고, 저장소 등록 상태에 의존하지 않으며, 대상이 해결돼도 바뀌지 않는다. 형식은 비동기·잡 카탈로그 3.2장에 있다. `references`가 아닌 간선에는 이 필드를 두지 않는다.
- `to_id`·`to_repository_id`는 **해결된 뒤에만** 채운다. 미해결 `references` 간선에는 없다.
- `link_type`: `contains` | `precedes` | `references` | `reverts` | `cherry_picks` | `stacks_on` | `co_changes`
- `confidence`: `exact` | `derived` | `heuristic`
- `precedes` 간선은 저장하지 않는다. 시퀀스 값 비교로 계산 가능하므로 간선으로 만들면 커밋 수만큼의 간선이 생겨 낭비다. `link_type` 어휘에는 남겨 두되, FR-REL-001은 `merge_sequence` 범위 질의로 구현한다.
- `co_changes` 간선도 저장하지 않는다. 조회 시점에 `changed_paths` 교집합으로 계산한다 (FR-REL-007). 미리 계산하면 PR 하나 추가에 O(N) 간선이 생긴다.

즉 **실제 저장되는 간선은 `references`, `reverts`, `cherry_picks`, `stacks_on`, `contains`(릴리스↔커밋) 다섯 종류다.**

### 4.4 `prs-releases`

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "release_id":     { "type": "keyword" },
      "repository_id":  { "type": "long" },
      "org_id":         { "type": "long" },
      "visibility":     { "type": "keyword" },
      "allowed_team_ids": { "type": "long" },

      "tag_name":       { "type": "keyword" },
      "display_name":   { "type": "keyword" },
      "commit_sha":     { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "base_branch":    { "type": "keyword" },
      "merge_seq":      { "type": "long" },
      "seq_epoch":      { "type": "integer" },
      "sequence_space": { "type": "keyword" },
      "released_at":    { "type": "date" },
      "source":         { "type": "keyword" },
      "indexed_at":     { "type": "date" }
    }
  }
}
```

`source`는 `git_tag` | `github_release` | `ci_deployment` (OD-004).

**릴리스 포함 판정은 간선이 아니라 시퀀스 비교다.** 커밋 C가 릴리스 R에 포함되었다 ⟺ 같은 시퀀스 공간에서 `C.merge_seq <= R.merge_seq` (FR-REL-002 AC-5). 릴리스 하나당 수만 개 `contains` 간선을 만드는 대신 정수 비교 하나로 끝난다. `release_tags` 비정규화 필드는 **가장 이른 5개**(그 항목을 처음 실은 릴리스들, DEV-148)만 담아 목록 표시에 쓴다 — 조사 질문 "이 변경이 언제 처음 나갔나"에 답하는 값이다. 이 필드는 표시 전용이며, 포함 판정의 정본은 PostgreSQL `release` 표다 (DEV-142).

### 4.5 `prs-raw-events` (아카이브, ILM)

```json
{
  "mappings": {
    "dynamic": "false",
    "properties": {
      "delivery_id":  { "type": "keyword" },
      "event_type":   { "type": "keyword" },
      "action":       { "type": "keyword" },
      "repository":   { "type": "keyword" },
      "received_at":  { "type": "date" },
      "correlation_id": { "type": "keyword" },
      "payload":      { "type": "object", "enabled": false }
    }
  }
}
```

`payload`는 `enabled: false`로 저장만 하고 색인하지 않는다. 원본 보존과 `delivery_id` 대조가 목적이며 payload 내부 검색은 요구되지 않는다. 색인하면 5억 건의 임의 JSON이 매핑 폭발을 일으킨다.

## 5. 관계 및 일관성

| 관계 | 카디널리티 | 일관성 | 강제 지점 |
| --- | --- | --- | --- |
| Repository → SequenceSpace | 1:N (최대 10) | 강함 | PostgreSQL FK + CHECK |
| SequenceSpace → MergeSequence | 1:N | 강함 | PostgreSQL PK |
| MergeSequence → PullRequest | 1:0..1 | 최종적 | 투영 워커 |
| PullRequest → Commit | 1:N (머지 커밋 1 + 원본 N) | 최종적 | 보강 워커 |
| Commit → PullRequest | N:M (통상 N:1) | 최종적 | 보강 워커, `pull_request_numbers` 배열 |
| Release → Commit | 시퀀스 비교로 계산 | 계산 | 조회 시점 |
| Link.from / Link.to | N:M | 최종적, `resolved` 플래그 | 링크 워커 |
| PostgreSQL merge_sequence → ES merge_seq | 1:1 | 최종적 | 정합성 감시 잡 |

**최종적 일관성의 사용자 노출:** 보강·관계 파생이 끝나지 않은 문서는 `enrichment_pending` / `links_pending`을 `true`로 두고 화면이 이를 표시한다 (상태 매트릭스). 불완전한 데이터를 완전한 것처럼 보여주지 않는다.

**순서 역전 방지 (FR-ING-005 AC-1):** 모든 엔티티 문서에 `document_version`(**사실이 일어난 시각**의 밀리초 epoch)을 두고, 스크립트 조건부 업서트로 더 작은 버전의 갱신을 무시한다.

출처는 경로에 따라 다르다.

| 경로 | 버전 | 왜 |
| --- | --- | --- |
| 실시간 (웹훅) | **웹훅 수신 시각** | 보강 시각이 아니다 — 두 웹훅이 순서를 바꿔 보강되어도 나중에 일어난 사실이 이겨야 하고, 그 순서는 수신 시각만이 안다 |
| 백필 (CR-022, DEV-099) | **엔티티의 `updated_at`** | 지금 시각을 쓰면 백필이 언제나 최신이 되어 **실시간 문서를 덮어쓴다**(FR-ING-006 AC-5 위반). 웹훅 수신은 언제나 그 엔티티가 갱신된 뒤이므로, `updated_at`을 쓰면 같은 사실에 대해 **실시간이 항상 이긴다** |

**AC-5가 코드가 아니라 수의 대소로 성립한다.** 백필에 별도의 "덮어쓰지 않기" 분기를 두지 않는다 — 낮은 버전을 들고 오면 이미 있는 조건부 업서트가 저절로 거절한다. 분기를 두면 그 분기가 틀렸을 때 조용히 덮어쓴다.

**누적 필드는 버전 비교에서 제외한다 (CR-011, DEV-019).** `commit.pull_request_numbers`는 N:M이라 단순 대입하면 나중 이벤트가 앞 PR 번호를 지운다 — 커밋 하나가 두 PR에 속하는 경우 FR-SRCH-002(SHA → PR)가 조용히 한쪽을 잃는다. 집합 소속은 단조 증가하고 순서에 무관하므로, `params.union`에 실린 필드는 **버전 비교와 무관하게 항상 합집합**한다. 상태 필드(`state`, `merged_at`, …)만 버전 비교의 대상이다.

**필드 소유권.** 투영 워커는 자기가 계산한 필드만 `params.doc`에 싣는다. 시퀀스 필드(`merge_seq`, `seq_epoch`)·관계 필드(`link_summary`, `links_pending`)·릴리스 필드(`release_tags`, `unreleased`)는 다른 워커가 소유하며, 투영은 그것들을 **생성 시점의 `upsert` 본문에만** 초깃값으로 둔다. `params.doc`에 넣으면 투영이 돌 때마다 다른 워커의 결과를 되돌린다.

**`link_summary`는 leaf 단위로 소유가 갈린다 (CR-039, DEV-222).** 관계 워커가 하나가 아니기 때문이다.

| leaf | 소유 WP | 근거 |
| --- | --- | --- |
| `reference_count` | **WP-029** | FR-REL-003 참조 간선 |
| `has_revert` · `is_reverted` | WP-030 | FR-REL-004 되돌림 |
| `has_cherry_pick` | WP-030 | FR-REL-005 체리픽 |
| `has_stack` | WP-030 | FR-REL-006 스택 |

**조건부 업서트 스크립트로는 이 분업을 표현할 수 없다.** 그 스크립트는 `ctx._source[key] = value`로 대입하므로
`link_summary`를 넘기면 **객체를 통째로 바꾼다** — WP-029가 참조 수만 고치려 해도 WP-030이 써 둔 네 값이 사라진다.
그래서 관계 요약은 **leaf 단위로 대입하는 전용 경로**를 쓴다. CR-038이 커밋 메타데이터에서 같은 이유로 만든
`COMMIT_METADATA_SCRIPT`가 선례다.

**`to_repository_id`·`detached`의 소유 (CR-039, DEV-223).** `to_repository_id`는 **WP-029**가 대상 저장소를 해석한
시점에 채운다. `detached`는 **WP-030**이 소유한다 — WP-029는 이 필드를 두지 않는다. `strict` 매핑에서 값을 두지
않는 것과 `false`를 두는 것은 다른 주장이며, 아직 계산하지 않은 것을 `false`로 적으면 "확인했고 아니었다"가 된다.

```painless
boolean fresh = ctx._source.document_version == null
             || ctx._source.document_version < params.doc.document_version;
boolean changed = fresh;
if (fresh) {
  for (e in params.doc.entrySet()) { ctx._source[e.getKey()] = e.getValue(); }
}
// 누적 필드는 버전과 무관하게 합집합한다. 오래된 이벤트도 자기 소속은 더한다.
for (e in params.union.entrySet()) {
  def current = ctx._source[e.getKey()];
  def merged = new HashSet();
  if (current instanceof List) { merged.addAll(current); }
  else if (current != null) { merged.add(current); }
  if (merged.addAll(e.getValue())) { changed = true; }
  ctx._source[e.getKey()] = new ArrayList(merged);
}
if (!changed) { ctx.op = 'noop'; }
```

```json
{
  "script": { "source": "...", "params": { "doc": { "...": "..." }, "union": { "pull_request_numbers": [1234] } } },
  "upsert": { "...": "..." }
}
```

## 6. 인덱스 및 조회 패턴

| 조회 패턴 | 대상 | 사용 필드/인덱스 | 성능 목표 | 관련 FR |
| --- | --- | --- | --- | --- |
| 40자 SHA → 커밋 | `prs-commits` | `term(commit_sha)` | p95 100ms | FR-SRCH-001 |
| 7~39자 접두 → 커밋 | `prs-commits` | `prefix(commit_sha)` (ADR-012) | p95 200ms | FR-SRCH-004 |
| SHA → PR | `prs-commits` → `pull_request_numbers` → `prs-pull-requests` (ID 조회) | 문서 ID `{repo}:{number}` | p95 200ms | FR-SRCH-002 |
| PR → 커밋 | `prs-pull-requests.source_commit_shas` + `merge_commit_sha` | 문서 내 배열 | p95 100ms | FR-SRCH-003 |
| 시퀀스 범위 (멤버십·건수) | **PostgreSQL `merge_sequence`** | PK 범위 스캔 `(repository_id, base_branch, seq_epoch, merge_seq)` | p95 100ms @ 5000건 | FR-SEQ-002 |
| 시퀀스 범위 (표시 필드·요약) | `prs-pull-requests` | `terms(pr_number)` + `term(repository_id)`, `routing=repository_id` | p95 300ms @ 5000건 | FR-SEQ-002 |
| 선행·후행 (멤버십) | **PostgreSQL `merge_sequence`** | 기준 서수 앞뒤 각 N건, PK 범위 스캔 | p95 100ms | FR-REL-001 |
| 선행·후행 (표시 필드) | `prs-pull-requests` + `prs-commits` | `terms(pr_number)`·`terms(commit_sha)`, `routing=repository_id` | p95 200ms | FR-REL-001 |

**선행·후행도 멤버십은 PostgreSQL이다** (CR-031, DEV-166 — 범위 조회와 같은 이유, DEV-130). 색인에서 `range(merge_seq)`로 이웃을 고르면 **색인 반영이 늦은 이웃이 오류 없이 빠지고**, 그 자리에 더 먼 항목이 올라와 "인접"이 거짓이 된다. 정본에서 앞뒤를 고른 뒤 표시값만 색인에서 채우며, 채워지지 않은 항목은 `indexed: false`로 밝힌다. 직접 푸시 커밋은 커밋 메타데이터 보강(WP-067) 전까지 언제나 그 상태다.

| 다차원 필터 목록 | `prs-pull-requests` | 복합 `bool.filter` + `search_after` | p95 500ms @ 1000만 | FR-SRCH-006 |
| 패싯 | `prs-pull-requests` | `terms` 집계 6종, size 20 | 목록과 동일 요청 | FR-SRCH-009 |
| 전문 검색 | `prs-pull-requests` | `multi_match` (title^3, body, message) + highlight | p95 500ms | FR-SRCH-011 |
| 그룹 집계 | `prs-pull-requests` | `terms` 집계, size 500 | p95 1500ms | FR-STAT-001 |
| 시계열 | `prs-pull-requests` | `date_histogram(merged_at)` + timezone | p95 1500ms | FR-STAT-002 |
| 백분위 | `prs-pull-requests` | `percentiles(lead_time_seconds)` | p95 1500ms | FR-STAT-003 |
| 관계 조회 (정방향) | `prs-links` | `term(from_type) + term(from_id)` | p95 150ms | FR-REL-003 |
| 관계 조회 (역방향) | `prs-links` | `term(to_type) + term(to_id)` | p95 150ms | FR-REL-004 |
| 릴리스 포함 | `prs-releases` | **`term(repository_id) + term(base_branch)`** + `range(merge_seq >= C.merge_seq)` | p95 150ms | FR-REL-002 |
| 체리픽 후보 | `prs-commits` | `term(patch_id) + term(repository_id)` | p95 200ms | FR-REL-005 |
| 동시 변경 | `prs-pull-requests` | `terms(changed_paths.raw)` + 날짜 범위 90일 | p95 800ms | FR-REL-007 |

**시퀀스 범위의 정답지는 PostgreSQL이다 (CR-027, DEV-130).** 이 표의 다른 행과 달리 범위 조회만 두 줄인 이유가 그것이다. `merge_sequence`는 first-parent walk가 직접 쓴 표이고 서수의 정본이다 (ADR-004: Elasticsearch는 PostgreSQL만으로 재구축 가능한 파생 뷰다). 채번은 **PostgreSQL을 먼저 커밋하고 그 뒤에 Elasticsearch로 비춘다** — 비추기가 실패하면(`sequence_index_failed`) 서수를 가진 문서가 그만큼 줄어들고, 그 상태에서 `range(merge_seq)`로 읽은 구간은 **아무 오류 없이 항목이 빠진 채** 돌아온다. 범위 인용이 조용히 틀리는 것은 이 제품이 막으려는 실패 그 자체다.

그래서 **구간에 무엇이 속하는가와 그것이 몇 건인가는 `merge_sequence`가 답하고**, 제목·작성자·변경 경로 같은 표시 필드와 요약 집계만 Elasticsearch가 채운다. 정본에는 있는데 색인에 없는 항목은 **버리지 않고 응답에 드러낸다** — 없는 것을 없다고 말하는 것과 모른다고 말하는 것은 다르다.

이 결정이 `index.sort` 조기 종료 논의도 함께 끝낸다. Elasticsearch가 범위를 스캔하지 않으므로 정렬 방향이 어긋나는 문제(DEV-131)가 성능 경로에 남지 않는다.

**범위 질의를 `sequence_space`로 거르지 않는다 (CR-025, DEV-119).** 그 값은 `acme/payments@main` 같은 **사람이 읽는 문자열**이고 `SequencePosition`이 화면에 그대로 출력한다. 저장소 소유자·이름이 바뀌면 같은 시퀀스 공간의 문서가 **두 문자열로 갈라지고**, `term(sequence_space)`로 거른 범위 조회는 그때 **오류 없이 절반만** 돌려준다 — 이 제품의 핵심 산출물이 조용히 틀리는 자리다.

`repository_id`와 `base_branch`는 네 매핑에 모두 있으므로 새로 저장할 것이 없다. **사람이 읽으라고 만든 값은 사람이 읽기 좋게 바뀐다. 바뀌는 값 위에 정확성을 세울 수 없다.** `sequence_space`는 표시 전용으로 남는다.

**라우팅**: 모든 엔티티 문서를 `repository_id`로 라우팅한다. 저장소가 지정된 질의는 단일 샤드에서 끝난다. 저장소 미지정 전역 질의는 전 샤드 팬아웃이며 이는 의도된 동작이다.

**사전 계산 필드**: `lead_time_seconds`, `first_review_wait_seconds`, `changed_files_count`, `additions`, `deletions`, `link_summary.*`, `unreleased`는 모두 색인 시점에 계산해 저장한다. 조회 시점 `script` 필드나 runtime field를 집계에 사용하지 않는다 (NFR-001).

## 7. 마이그레이션 정책

### PostgreSQL

- 마이그레이션 도구를 워크스페이스에 두고 버전 순차 적용한다. 롤백 스크립트를 함께 작성한다.
- **backward compatible**: 컬럼 추가(NULL 허용), 인덱스 추가(`CONCURRENTLY`), 새 테이블. 무중단.
- **destructive**: 컬럼 삭제·타입 변경. 2단계로 나눈다 — (1) 새 컬럼 추가 + 이중 쓰기 + 백필, (2) 다음 릴리스에서 구 컬럼 삭제.
- **rollback**: 각 마이그레이션에 down 스크립트 필수. destructive의 1단계는 롤백 가능해야 한다.
- **seed/fixture**: 개발 환경용 시드는 실제 GHE 데이터를 쓰지 않는다. 합성 저장소 3개, PR 200건, 커밋 500건, 릴리스 10건, 관계 50건으로 구성해 모든 화면 상태를 재현할 수 있게 한다.

### Elasticsearch

- 매핑 변경은 **항상** 새 버전 인덱스 + 재색인 + 별칭 전환이다 (FR-ING-008). 기존 인덱스를 in-place 변경하지 않는다.
- 재색인 소스는 PostgreSQL이다 (ADR-004). Elasticsearch → Elasticsearch reindex는 매핑 호환 시에만 최적화 수단으로 사용한다.
- 재색인 중에는 새 이벤트를 구·신 인덱스 양쪽에 쓴다 (AC-2). 이중 쓰기 상태를 A-003에 표시한다.
- 전환은 alias 액션 1회로 원자적으로 수행한다 (AC-3).
- 이전 인덱스는 7일 보관 후 삭제한다 (AC-4).
- 매핑 정의는 `@prs/es` 패키지에 코드로 두고, 실제 클러스터 매핑과의 일치를 통합 테스트로 검증한다.

## 8. 보존/삭제/백업

| 데이터 | 보존 | 삭제 방식 | 백업 |
| --- | --- | --- | --- |
| `raw_event` | 3년 (OD-003 결정값, CR-004) | 월별 파티션 드롭 | 일 1회 전체 + WAL 연속 아카이브 |
| `prs-raw-events` (ES 아카이브) | ILM: hot 7일 → warm 90일 → delete (창 약 97일). `raw_event` 보존과 **별개 값** | ILM 자동 | 백업 안 함. `raw_event`에서 재구성 |
| `merge_sequence`, `sequence_space` | 영구 | 저장소 폐기 시에만 | PostgreSQL 백업에 포함 |
| `audit_record` | 1년 (NFR-006) | 월별 파티션 드롭 (관리 롤만) | PostgreSQL 백업에 포함 |
| 엔티티 ES 인덱스 | 영구 | 저장소 폐기 시 문서 삭제 | 백업 안 함. PostgreSQL에서 재구성 |
| `saved_search`, `safe_marker`, `bisect_session` | 영구 (사용자 삭제 시 제거) | 하드 삭제 | PostgreSQL 백업에 포함 |
| `gh_execution` | 1년 (NFR-012, 감사와 동일) | 월별 파티션 드롭 (관리 롤만) | PostgreSQL 백업에 포함 |
| `gh_execution_artifact` | 실행 기록보다 짧게 — 기본 30일 | `expires_at` 경과분 정리 잡 | 백업 안 함. 재실행으로 재생성 |
| `github_identity_connection` | 연결 해제 또는 만료까지 | 하드 삭제 | 참조만 백업. 토큰은 비밀 저장소 소관 |
| `gh_recipe`, `gh_recipe_revision` | 영구 (사용자 삭제 시 제거) | 하드 삭제 | PostgreSQL 백업에 포함 |
| `gh_approval` | 1년 (연결된 실행과 동일) | 연결 실행 파티션 드롭 시 함께 | PostgreSQL 백업에 포함 |
| `gh_capability_snapshot` | 영구 | 삭제하지 않음 | 과거 실행의 argv 해석에 필요하다 |

원본 이벤트의 3년 보존 보증은 `raw_event`(PostgreSQL)가 진다. ES 아카이브 인덱스의 ILM 창은 FR-ING-010 AC-1이 요구하는 대로 분리된 값이며, 아카이브는 백업 대상이 아니라 `raw_event`에서 재구성한다. 두 값을 같게 맞출 의무는 없다 — ILM 창을 줄여도 보존 보증은 영향받지 않는다.
| `job`, `dead_letter` | 90일 | 배치 삭제 | PostgreSQL 백업에 포함 |
| git 미러 | 캐시 | 재클론 가능 | 백업 안 함 |

**소프트 삭제 원칙**: 저장소 등록 해제는 문서를 삭제하지 않는다. `repository.status = 'archived'`, ES 문서에 `repository_archived: true`를 세팅한다 (FR-ING-009 AC-3). 조사 이력의 보존이 이 제품의 목적이므로, 데이터 삭제는 저장소 폐기라는 명시적 결정에서만 일어난다.

**표식은 PR 문서와 커밋 문서 양쪽에 붙는다 (CR-013, DEV-028).** 4.2의 `prs-commits` 매핑에 `repository_archived`가 없었다. 매핑이 `dynamic: strict`라 없는 필드를 쓰려는 시도는 **거부되므로**, 그대로는 해제한 저장소의 커밋 문서에 표식을 붙일 방법이 없었다. FR-SRCH-002(SHA → PR)는 커밋 문서를 직접 결과로 내놓기 때문에, 표식 없는 커밋 문서는 해제된 저장소를 살아 있는 것처럼 보여 준다.

**필드 추가에는 재색인이 필요 없다 (CR-013, DEV-034).** 부트스트랩이 이미 있는 인덱스에 `put_mapping`으로 제자리 갱신한다. Elasticsearch에서 매핑에 새 필드를 더하는 것은 하위 호환 변경이기 때문이다. 재색인(FR-ING-008)이 필요한 것은 기존 필드의 **타입이나 분석기**를 바꿀 때이며, 그런 변경은 `put_mapping`이 거부하므로 조용히 통과하지 않는다.

**표식은 기존 문서에도 소급된다.** 해제 시점에 이미 색인된 문서를 `update_by_query`로 갱신한다. 이때 `document_version`은 건드리지 않는다 — 등록 상태는 웹훅이 나르는 엔티티 상태가 아니라 이 시스템이 소유한 운영 상태라, 버전 비교의 대상이 아니다 (CR-011의 상태 필드 / 누적 필드 구분과 같은 원리다).

**복구 목표**: RPO 0(원본 이벤트 기준), RTO 30분 (NFR-004). PostgreSQL이 복구되면 Elasticsearch는 재색인으로 복구한다. 재색인이 4시간 걸리므로(NFR-008), 검색 서비스의 RTO 30분은 Elasticsearch 스냅샷 복원으로 달성하고 재색인은 최종 수단이다.

## 9. 데이터 분류

| 분류 | 데이터 | 취급 |
| --- | --- | --- |
| 소스 코드 | 저장하지 않음 | 매핑 `dynamic: strict`로 구조적 차단 (NFR-005) |
| 코드 메타데이터 | 변경 경로, 라인 수, 커밋 메시지, PR 본문 | 접근 범위 필터 적용 |
| 개인 식별 정보 | GHE 로그인, 이메일 | 사내 구성원 정보. 감사 기록에 포함. 외부 반출 금지 |
| 인증 정보 | GitHub 토큰, 웹훅 시크릿, OIDC 클라이언트 시크릿 | 클러스터 시크릿 저장소에만. 로그·응답·문서에 남기지 않음 |
| 운영 데이터 | 잡 상태, 큐 길이, 지표 | 운영자 역할만 |

## 10. 알려진 데이터 모델 제한

| 제한 | 영향 | 대응 |
| --- | --- | --- |
| 원본 커밋 250건 초과 PR은 절삭 저장 | 초대형 PR의 일부 커밋이 SHA 검색에 잡히지 않음 | `source_commits_truncated: true` 표시, GHE 링크 제공 (FR-SRCH-003 AC-4) |
| 변경 파일 3000개 초과 PR은 절삭 저장 | 경로 필터에서 누락 가능 | `files_truncated: true` 표시 (FR-ING-004 AC-4) |
| `co_changes` 간선을 저장하지 않음 | 조회 시점 계산이므로 대형 PR에서 느림 | 변경 파일 200개 초과 PR 제외 (FR-REL-007 AC-4) |
| `precedes` 간선을 저장하지 않음 | 관계 그래프에서 선행·후행이 간선으로 보이지 않음 | W-007은 시퀀스 인접 노드를 조회 시점에 합성 |
| 저장소 간 patch-id 비교를 하지 않음 | 포크 간 체리픽 미탐지 | FR-REL-005 AC-3에 명시. 필요 시 CR |
| 접근 범위 500 저장소 초과 시 조직·팀 조건으로 치환 | 예외적으로 접근 범위가 넓은 사용자의 필터 정밀도가 낮아질 수 있음 | `visibility`와 `allowed_team_ids`로 정확도 유지, 권한 매트릭스 테스트로 검증 (ADR-008) |
