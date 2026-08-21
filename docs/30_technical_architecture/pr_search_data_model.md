# PR Search 데이터 모델

> 상태: review | 버전: v0.3 | 갱신일: 2026-08-20

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
| ENT-REL-001 | Release | 릴리스 앵커 | `release_id`, `repository_id`, `tag_name`, `commit_sha`, `base_branch`, `merge_seq`, `released_at` | Elasticsearch | projection | FR-SEQ-004, FR-REL-002 |
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
  status            TEXT        NOT NULL DEFAULT 'active', -- active | archived
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sequence_branches_limit CHECK (array_length(sequence_branches, 1) <= 10),
  UNIQUE (owner, name)
);

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

**신원의 세 가지 표현 (CR-015, DEV-043).** 세션은 OIDC `sub`로 만들어지고, 무효화 이벤트는 GHE 신원으로 도착한다. `user_id`(OIDC `sub`)가 기본 키이고, `login`과 `github_user_id`가 GHE 쪽 두 이름이다. 무효화는 **`github_user_id`를 우선 쓴다** — login은 개명될 수 있지만 숫자 id는 아니고, 개명 웹훅을 놓친 사이의 무효화가 조용히 아무도 맞히지 못하는 것이 이 시스템에서 가장 나쁜 실패다.

**`access_scope_version`은 울타리다 (CR-015, DEV-044).** 무효화마다 증가하고, 캐시 갱신은 시작 시점에 읽은 값이 그대로일 때만 기록한다. 회수 직전에 시작된 GHE 조회가 회수 뒤에 끝나면서 회수 이전 범위를 되살리는 것을 막는다. 보안 문서 5.4에 순서가 있다.

**`team_member`는 `team` 웹훅이 채운다 (CR-015, DEV-046).** authz 소비자가 이벤트를 받아 GHE에서 구성원을 다시 읽어 갱신한다. 표를 무효화의 유일한 근거로 삼지는 않는다 — 비어 있는 표가 "무효화할 사람이 없다"로 읽히면 회수가 반영되지 않는다.

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
                                      -- | sequence_integrity | link_rebuild | export
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

- `text_ko_en`은 OD-005 결정에 따라 `nori_tokenizer` 기반으로 교체할 수 있다. 분석기 이름은 유지해 매핑 참조가 변하지 않게 한다 (FR-SRCH-011 AC-4).
- `index.sort`는 시퀀스 범위 질의와 기본 정렬(시퀀스 내림차순)에서 조기 종료를 얻기 위한 것이다 (ADR-003).
- **`index.sort`는 `merge_seq`를 가진 인덱스에만 적용한다** (CR-007, DEV-007). `prs-links`에는 `merge_seq`가 없고, Elasticsearch는 매핑에 없는 필드로 `index.sort`를 걸면 인덱스 생성을 거부한다. 간선은 `from_id`/`to_id`로 조회하므로 시퀀스 축 정렬이 필요하지도 않다. 나머지 공통 설정(복제본·refresh·분석기)은 네 인덱스 모두에 적용한다.
- `refresh_interval: 1s`는 수집 반영 SLO(p95 10초, NFR-002)와 색인 처리량의 절충값이다. 백필 중에는 해당 인덱스만 `30s`로 낮췄다가 복원한다.

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
      "patch_id_unavailable": { "type": "boolean" },

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
          "has_cherry_pick": { "type": "boolean" }
        }
      },

      "release_tags":      { "type": "keyword" },
      "enrichment_pending":{ "type": "boolean" },
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
      "confidence":    { "type": "keyword" },
      "evidence":      { "type": "text", "index": false },
      "resolved":      { "type": "boolean" },
      "detached":      { "type": "boolean" },
      "created_at":    { "type": "date" }
    }
  }
}
```

- `link_id`는 `{link_type}:{from_type}:{from_id}:{to_type}:{to_id}`의 결정론적 해시다. 재파생이 중복 간선을 만들지 않는다.
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

**릴리스 포함 판정은 간선이 아니라 시퀀스 비교다.** 커밋 C가 릴리스 R에 포함되었다 ⟺ 같은 시퀀스 공간에서 `C.merge_seq <= R.merge_seq` (FR-REL-002 AC-5). 릴리스 하나당 수만 개 `contains` 간선을 만드는 대신 정수 비교 하나로 끝난다. `release_tags` 비정규화 필드는 상위 5개 릴리스만 담아 목록 표시에 쓴다.

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

**순서 역전 방지 (FR-ING-005 AC-1):** 모든 엔티티 문서에 `document_version`(**웹훅 수신 시각**의 밀리초 epoch)을 두고, 스크립트 조건부 업서트로 더 작은 버전의 갱신을 무시한다. 버전의 출처가 보강 시각이 아니라 수신 시각인 이유: 두 웹훅이 순서를 바꿔 보강되어도 **나중에 일어난 사실**이 이겨야 하고, 그 순서는 수신 시각만이 안다.

**누적 필드는 버전 비교에서 제외한다 (CR-011, DEV-019).** `commit.pull_request_numbers`는 N:M이라 단순 대입하면 나중 이벤트가 앞 PR 번호를 지운다 — 커밋 하나가 두 PR에 속하는 경우 FR-SRCH-002(SHA → PR)가 조용히 한쪽을 잃는다. 집합 소속은 단조 증가하고 순서에 무관하므로, `params.union`에 실린 필드는 **버전 비교와 무관하게 항상 합집합**한다. 상태 필드(`state`, `merged_at`, …)만 버전 비교의 대상이다.

**필드 소유권.** 투영 워커는 자기가 계산한 필드만 `params.doc`에 싣는다. 시퀀스 필드(`merge_seq`, `seq_epoch`)·관계 필드(`link_summary`, `links_pending`)·릴리스 필드(`release_tags`, `unreleased`)는 다른 워커가 소유하며, 투영은 그것들을 **생성 시점의 `upsert` 본문에만** 초깃값으로 둔다. `params.doc`에 넣으면 투영이 돌 때마다 다른 워커의 결과를 되돌린다.

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
| 시퀀스 범위 | `prs-pull-requests` | `range(merge_seq)` + `term(sequence_space)`, `index.sort` 조기 종료 | p95 400ms @ 5000건 | FR-SEQ-002 |
| 선행·후행 | `prs-pull-requests` | `range(merge_seq)` 양방향 각 N건 | p95 200ms | FR-REL-001 |
| 다차원 필터 목록 | `prs-pull-requests` | 복합 `bool.filter` + `search_after` | p95 500ms @ 1000만 | FR-SRCH-006 |
| 패싯 | `prs-pull-requests` | `terms` 집계 6종, size 20 | 목록과 동일 요청 | FR-SRCH-009 |
| 전문 검색 | `prs-pull-requests` | `multi_match` (title^3, body, message) + highlight | p95 500ms | FR-SRCH-011 |
| 그룹 집계 | `prs-pull-requests` | `terms` 집계, size 500 | p95 1500ms | FR-STAT-001 |
| 시계열 | `prs-pull-requests` | `date_histogram(merged_at)` + timezone | p95 1500ms | FR-STAT-002 |
| 백분위 | `prs-pull-requests` | `percentiles(lead_time_seconds)` | p95 1500ms | FR-STAT-003 |
| 관계 조회 (정방향) | `prs-links` | `term(from_type) + term(from_id)` | p95 150ms | FR-REL-003 |
| 관계 조회 (역방향) | `prs-links` | `term(to_type) + term(to_id)` | p95 150ms | FR-REL-004 |
| 릴리스 포함 | `prs-releases` | `term(sequence_space) + range(merge_seq >= C.merge_seq)` | p95 150ms | FR-REL-002 |
| 체리픽 후보 | `prs-commits` | `term(patch_id) + term(repository_id)` | p95 200ms | FR-REL-005 |
| 동시 변경 | `prs-pull-requests` | `terms(changed_paths.raw)` + 날짜 범위 90일 | p95 800ms | FR-REL-007 |

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
