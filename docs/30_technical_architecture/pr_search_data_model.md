# PR Search 데이터 모델

> 상태: review | 버전: v0.23 | 갱신일: 2026-09-14

CR-079: 기존 merge_sequence의 M 값은 정본 속성으로 유지한다. 025의 최종 필드·check·unique·FK·초기화·role grant·checkpoint/epoch·retention/rollback은 [상세 설계](pr_search_wp074_design.md) 6~7·10절이 소유한다. 아래 CR-077 DDL은 기본 다섯 필드만 보여주는 부분 예시이며 단독 구현하지 않는다.

| 엔티티 ID | 이름 | 소유 / 저장 | 요구사항 |
| --- | --- | --- | --- |
| ENT-SEQ-005 | mnumber_evidence | PR/direct/unresolved 증거, PostgreSQL | FR-SEQ-008 AC-10 |
| ENT-SEQ-006 | sequence_work | 고정 kind의 durable intent/outbox, PostgreSQL | FR-SEQ-008 AC-11 |
| ENT-SEQ-007 | sequence_latency_sample | 단계별 읽기 전용 관측 자료의 원천, PostgreSQL | FR-SEQ-008 AC-14 |

## 1. 목적

핵심 엔티티, 관계, 소유권, 수명주기, 마이그레이션, 보존, 백업/복구 기준을 정의한다. 엔티티 네이밍은 `../10_requirements/glossary.md`를 따른다.

저장소 분담은 ADR-004를 따른다. **PostgreSQL이 시스템 오브 레코드이고, Elasticsearch는 PostgreSQL만으로 전량 재구성 가능한 파생 뷰다.** 인덱스 전략은 ADR-003을 따른다.

## 2. 엔티티 카탈로그

| Entity ID | 엔티티 | 책임 | 주요 필드 | 소유 저장소 | 소유 모듈 | 관련 요구사항 |
| --- | --- | --- | --- | --- | --- | --- |
| ENT-CORE-001 | Repository | 수집 대상 저장소 등록과 정책 | `repository_id`, `owner`, `name`, `org_id`, `visibility`, `sequence_branches[]`, `mirror_enabled`, `status`, **`annotate_enabled`** | PostgreSQL | registry | FR-ING-009, **FR-SEQ-009 AC-6** |
| ENT-CORE-002 | PullRequest | PR 검색 문서 | `pr_number`, `title`, `body`, `author`, `state`, `merged_at`, `merge_commit_sha`, `merge_seq`, `merge_number`, `link_summary` | Elasticsearch | projection | FR-SRCH-003, FR-SRCH-006, FR-SEQ-008 |
| ENT-CORE-003 | Commit | 커밋 검색 문서 | `commit_sha`, `message`, `author`, `role`, `merge_seq`, `patch_id`, `changed_paths[]` | Elasticsearch | projection | FR-SRCH-002, FR-SRCH-004 |
| ENT-CORE-004 | Team | 팀 정보와 집계 그룹 단위 | `team_id`, `slug`, `org_id`, `member_ids[]` | PostgreSQL | registry | FR-AUTH-002, FR-STAT-001 |
| ENT-CORE-005 | User | 사용자와 접근 범위 | `user_id`, `login`, `email`, `roles[]`, `access_scope_version` | PostgreSQL | auth | FR-AUTH-001, FR-AUTH-003 |
| ENT-CORE-006 | SavedSearch | 저장된 질의 | `saved_search_id`, `name`, `query`, `visibility`, `owner_user_id`, `team_id`(대상 팀, `visibility='team'`일 때만), `seq_epoch`(`seq:` 조건이 딛고 선 에폭, CR-051) | PostgreSQL | search | FR-SRCH-010 |
| ENT-CORE-007 | AuditRecord | 감사 기록 | `audit_id`, `user_id`, `action`, `target`, `query`, `result_code`, `correlation_id`, `occurred_at` | PostgreSQL | audit | FR-AUTH-004 |
| ENT-CORE-008 | RepositoryRegistrationRequest | 사용자가 남긴 저장소 등록 검토 요청과 운영자의 처리 결과 | `request_id`, `requested_by`, `repository_owner`, `repository_name`, `created_at`, `status`, `resolved_at`, `resolved_by`, `resolution_note` | PostgreSQL | registry | FR-ING-009 AC-8·AC-11 |
| ENT-SEQ-001 | MergeSequence | 시퀀스 서수-커밋 대응 | `repository_id`, `base_branch`, `seq_epoch`, `merge_seq`, `commit_sha`, `pull_request_number`, `merge_number`, `annotate_state` | PostgreSQL | sequence | FR-SEQ-001, FR-SEQ-002, **FR-SEQ-008, FR-SEQ-009** |
| ENT-SEQ-002 | SequenceSpace | 시퀀스 공간 상태 | `repository_id`, `base_branch`, `seq_epoch`, `head_sha`, `head_seq`, `state`, `last_assigned_at` | PostgreSQL | sequence | FR-SEQ-001, FR-SEQ-005 |
| ENT-SEQ-003 | SafeMarker | 안전 구간 표식 | `marker_id`, `repository_id`, `base_branch`, `seq_epoch`, `merge_seq`, `note`, `created_by` | PostgreSQL | sequence | FR-SEQ-006 |
| ENT-SEQ-004 | BisectSession | 이분 탐색 상태 | `session_id`, `user_id`, `repository_id`, `base_branch`, `seq_epoch`, `good_seq`, `bad_seq` | PostgreSQL | sequence | FR-SEQ-007 |
| ENT-REL-001 | Release | 릴리스 앵커 | `release_id`, `repository_id`, `tag_name`, `commit_sha`, `base_branch`, `seq_epoch`, `merge_seq`, `released_at`, `source` | **PostgreSQL (정본) + Elasticsearch (투영)** (CR-028, DEV-142) | release | FR-SEQ-004, FR-REL-002, FR-SEQ-003 AC-1 |
| ENT-REL-002 | Link | 관계 간선 | `link_id`, `from_type`, `from_id`, `to_type`, `to_id`, `link_type`, `confidence`, `evidence`, `resolved` | Elasticsearch | link | FR-REL-003~008 |
| ENT-ING-001 | RawEvent | 원본 웹훅 이벤트 | `delivery_id`, `event_type`, `repository_id`, `received_at`, `payload`, `queued_at`, `processed_at` | PostgreSQL | ingestion | FR-ING-001, FR-ING-003 |
| ENT-ING-002 | DeadLetter | 실패 이벤트 격리 | `dead_letter_id`, `delivery_id`, `stage`, `error`, `retry_count`, `state` | PostgreSQL | ingestion | FR-ING-007 |
<!-- CR-010(DEV-013): 보강 결과 전용 테이블은 두지 않는다. EVT-ING-002가 투영에 필요한 것을 self-contained bounded 이벤트로 나른다. 원본이 필요하면 raw_event가 시스템 오브 레코드다 (ADR-004). -->
| ENT-ING-003 | RawEventArchive | 원본 아카이브 검색 문서 | `delivery_id`, `event_type`, `action`, `repository`, `repository_id`, `received_at`, `correlation_id`, `payload` | Elasticsearch | filebeat | FR-ING-010 |
| ENT-ING-004 | Job | 잡 실행 상태 | `job_id`, `type`, `target`, `state`, `progress`, `cursor`, `started_at`, `finished_at` | PostgreSQL | jobs | FR-ADMIN-002, FR-ING-006 |
| ENT-GH-001 | GitHubIdentityConnection | 사용자별 Operations App 위임 연결 | `user_id`, `github_login`, `token_ref`, `scopes[]`, `connected_at`, `expires_at`, `revoked_at` | PostgreSQL | gh-identity | FR-GH-008 |
| ENT-GH-002 | GhExecution | gh 실행 요청과 결과 | `execution_id`, `user_id`, `capability_id`, `invocation`(ENT-GH-008 구조화 원본 — 재실행의 근거), `context_snapshot`, `redacted_argv[]`, `risk_level`, `state`, `gh_version`, `manifest_version`, `exit_code`, `output_hash`, `output_truncated`, `idempotency_key` | PostgreSQL | gh-exec | FR-GH-002, FR-GH-006, FR-GH-012 |
| ENT-GH-002-A | GhExecutionArtifact | 실행이 만든 파일 | `artifact_id`, `execution_id`, `name`, `size_bytes`, `content_type`, `storage_ref`, `expires_at` | PostgreSQL + 파일 저장 | gh-exec | FR-GH-007 |
| ENT-GH-003 | GhRecipe | 저장된 다단계 작업 | `recipe_id`, `owner_user_id`, `name`, `visibility`, `current_revision` | PostgreSQL | gh-recipe | FR-GH-005 |
| ENT-GH-004 | GhRecipeRevision | Recipe 개정 | `revision_id`, `recipe_id`, `revision`, `definition`, `created_by`, `created_at` | PostgreSQL | gh-recipe | FR-GH-005 |
| ENT-GH-005 | GhApproval | 승인 대기·처리 기록 | `approval_id`, `execution_id`, `required_role`, `state`, `decided_by`, `decided_at`, `reason` | PostgreSQL | gh-policy | FR-GH-009, FR-GH-013 |
| ENT-GH-006 | GhCapabilitySnapshot | 이 배포가 본 capability manifest의 신원 — manifest 해시마다 한 행, 내용 불변. `activated_at`은 NFR-009 게이트 통과 뒤에만 (CR-088: 기록과 활성화를 분리, `DEV-672`) | `snapshot_id`, `gh_version`, `manifest_version`, `manifest_hash`, `inventory_hash`, `command_count`, `leaf_command_count`, `group_command_count`, `alias_only_command_count`, `alias_count`, `positional_count`, `flag_count`, `inherited_flag_count`, `json_field_count`, `unclassified_count`, `interaction_unclassified_count`, `flag_unclassified_count`, `positional_unclassified_count`, `extension_command_count`, `executable_count`, `coverage`(차원별 집계 JSONB), `first_seen_at`, `activated_at`(NULL 허용) | PostgreSQL (029) | gh-registry | FR-GH-001, FR-GH-011 |
| ENT-GH-007 | GhCapabilityConstraint | capability의 유효 조합 정의 (CR-008, ADR-017) | `capability_id`, `kind`(`requires`/`conflicts`/`oneOf`/`exactlyOne`/`atLeastOne`/`implies`/`repeatable`/`minItems`/`maxItems`/`enum`/`conditional`/`inputSource`/`context`), `subjects[]`, `condition`, `values[]`, `bounds` | manifest (PostgreSQL 스냅숏) | gh-registry | FR-GH-003 |
| ENT-GH-008 | GhInvocation | 사용자 의도의 구조화 표현 (CR-008, ADR-017) | `capability_id`, `context`(host/org/repo/ref/workspace), `positional_arguments[]`, `flags[]`, `stdin_source`, `file_bindings[]`, `output_options` | PostgreSQL (`gh_execution`에 내장) | gh-exec | FR-GH-002, FR-GH-012 |
| ENT-GH-009 | GhResultContract | capability의 결과 계약 (CR-009, ADR-020). **실현 (CR-089): 분류가 소유한다** — manifest `r0.3`의 `commands[].classification.result`이며 leaf마다 하나다. 실행 정의는 계약을 복사하지 않고 구현 adapter(`resultAdapter`: 모드·adapter·스키마·출력 port 이름)로 계약의 출력 port를 가리키고, manifest 생성과 검증기가 둘의 일치를 건다 | `kind`(json/resource/resource_list/url/artifact/text/stream/exit_status), `sensitivity`(public/internal/sensitive/secret), `composability`(8종), `bindable`(composability에서 파생), `resourceKind`(SRS의 `resourceType` — 15종 또는 `null`), `resourceBasis`(종류의 근거 또는 자원 결과가 아닌 이유), `outputs[]`(출력 모드마다 `mode`·`kind`·`adapter`·`schema` 또는 `unstructuredReason`·`bindable`·`reason` — SRS의 `schema`·`adapters`를 모드별로 나눈 것), `inputPorts[]`·`outputPorts[]`(`GhPort`: `id`·`direction`·`type`·`cardinality`·`required`·`nullable`·`sensitivity`·`conditions[]`·`basis`, 출력은 `source`(native_json 스키마·포인터·식별 필드 / resource_url 문법), 입력은 `slot`(positional 대안 / flag)), `inputPortsNote`·`outputPortsNote`(port가 없는 이유), `basis` | manifest 파일(이미지에 포함). DB에는 manifest 해시(`gh_capability_snapshot`)와 검증 보고서의 분리 집계(`gh_capability_verification.report.contracts`)만 남는다 — 새 열·마이그레이션 없음(029 JSONB) | gh-registry | FR-GH-001, FR-GH-005 |
| ENT-GH-010 | GhResourceRef | 명령 사이를 잇는 공통 자원 참조 (CR-009). **실현 (CR-089)**: 식별 규칙(`resource-ref.ts`) — PR·issue·discussion은 양의 안전한 정수 `number`, workflow·workflow run은 `id`(선행 0 없는 10진 문자열), release·branch는 `ref`(이름), commit은 `ref`(SHA), codespace는 `id`(이름), repository는 `repository`만이다. 종류가 정한 자리만 채우고 나머지는 `null`이라 같은 번호의 issue·PR이 같은 참조로 읽히지 않는다. project·user·team·artifact·gist는 종류로 분류하되 참조를 만들지 않는다(식별 규칙 없음). **참조는 권한이 아니다** — `host`·`repository`는 검증된 실행 컨텍스트에서 오고 출력 URL이 덮지 않는다 | `host`, `kind`, `repository`, `id`, `number`, `ref` | 값 타입 (실행 결과 `pr_list_v2.references`에 내장. Recipe는 미개방) | gh-exec, gh-recipe | FR-GH-002, FR-GH-005 |
| ENT-GH-011 | GhBinding | Recipe 단계 사이의 구조화된 연결 (CR-009). **CR-089는 평가만 연다** — 순수 함수 `evaluateBinding`(출발·도착 port와 값의 개수 대조 → 타입 호환 → 값 유무 → 명시적 선택 → 포인터 → 참조 규칙 → 호스트·저장소)이며 저장·실행하지 않고, 성공해도 `executable: false`다. 선택은 제한 JSON Pointer다(RFC 6901 부분집합: 128자·토큰 8개 이하, 배열 인덱스 선행 0·`-` 거부, 자기 속성만, `__proto__`·`constructor`·`prototype` 거부, 기본값·첫 원소 보정 없음) | `source_step`, `source_port`, `target_step`, `target_slot`(input/positional/flag/context), `field_selector`(선언된 named field 또는 제한된 JSON Pointer) | PostgreSQL (`gh_recipe_revision.definition`) — 미구현 | gh-recipe | FR-GH-005 |
| ENT-GH-012 | GhCapabilityVerification | 레지스트리 검사 한 회차의 기록 (CR-088, JOB-GH-003) — **append-only**, 갱신·삭제는 DB 트리거가 거부한다. 누가(실행기·CI·CLI)·언제·어떤 바이너리(버전·SHA-256)·어떤 규칙(검증기·규칙 버전)으로 무엇(manifest 해시·인벤토리 해시)을 확인했고 결과(`passed`/`incomplete`/`drift`/`failed`/`error`)와 diff가 무엇이었나 | `verification_id`, `snapshot_id`(FK), `checked_at`, `checked_by`, `trigger`(startup/periodic/manual), `environment`(실행기 ID·호스트명·바이너리 경로), `gh_version_expected/observed`, `binary_sha256_expected/observed`, `manifest_hash_expected/observed`, `inventory_hash_expected/observed`, `validator_version`, `rules_version`, `status`, `drift`(added/removed/changed), `report`(검증기 보고서 원문), `report_hash`, `error` | PostgreSQL (029) | gh-registry | FR-GH-001 AC-5, FR-GH-011 AC-2·AC-3, NFR-009 |

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
  -- M 넘버 채번 진행 지점 (마이그레이션 025, FR-SEQ-008)
  mnumber_head_seq BIGINT      NOT NULL DEFAULT 0,  -- 여기까지의 merge_seq를 M 넘버 채번이 확인했다
  mnumber_head     BIGINT      NOT NULL DEFAULT 0,  -- 마지막으로 부여한 M 넘버
  PRIMARY KEY (repository_id, base_branch)
);

CREATE TABLE merge_sequence (
  repository_id        BIGINT      NOT NULL,
  base_branch          TEXT        NOT NULL,
  seq_epoch            INT         NOT NULL,
  merge_seq            BIGINT      NOT NULL,
  commit_sha           TEXT        NOT NULL,
  pull_request_number  INT,                       -- 직접 푸시 커밋은 NULL (FR-SEQ-001 AC-3)
  merge_number         BIGINT,                    -- M 넘버. PR 있는 항목만 (FR-SEQ-008 AC-1)
  annotate_state       TEXT,                      -- NULL(미시도) | done | mismatch | failed | disabled
                                                  --   | body_changed (응답 제목이 보낸 값과 다르다 — 자동 재시도 없음)
                                                  --   | unknown (응답을 받지 못해 결과를 확정할 수 없다)
  annotate_attempt_id      UUID,                  -- 마지막 시도의 식별자 (027, CR-085)
  annotate_expected_digest TEXT,                  -- 쓰려 한 제목의 해시 앞 16자. **원문이 아니다**
  annotate_result_reason   TEXT,                  -- 짧은 사유 코드. 자유 문장을 넣지 않는다
  annotated_at         TIMESTAMPTZ,
  committed_at         TIMESTAMPTZ NOT NULL,
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, base_branch, seq_epoch, merge_seq)
);

CREATE UNIQUE INDEX merge_sequence_commit_uk
  ON merge_sequence (repository_id, base_branch, seq_epoch, commit_sha);
CREATE INDEX merge_sequence_pr_idx
  ON merge_sequence (repository_id, pull_request_number)
  WHERE pull_request_number IS NOT NULL;

-- M 넘버는 시퀀스 공간 안에서 유일하다 (FR-SEQ-008 AC-2, 마이그레이션 025)
CREATE UNIQUE INDEX merge_sequence_mnumber_uk
  ON merge_sequence (repository_id, base_branch, seq_epoch, merge_number)
  WHERE merge_number IS NOT NULL;

-- 표기 잡이 아직 쓰지 못한 항목을 고른다 (FR-SEQ-009)
CREATE INDEX merge_sequence_annotate_idx
  ON merge_sequence (repository_id, base_branch, seq_epoch, merge_seq)
  WHERE merge_number IS NOT NULL AND annotate_state IS DISTINCT FROM 'done';

-- **`body_changed`와 `unknown`의 뜻이 다르다** (027 / CR-085).
--
-- `unknown`은 「보냈는지도 모른다」이므로 다음 회차가 제목을 다시 읽어 확인한다 —
-- 확인이 곧 조회이고 이미 붙어 있으면 호출 없이 끝난다. `body_changed`는 「보냈고
-- 서버가 다르게 저장했다」이므로 자동으로 다시 쓰지 않는다: 다시 쓰면 `AC-1`이
-- 지키려는 원래 제목의 나머지를 덮는다. 근거 세 열은 **제목 원문을 담지 않는다** —
-- 해시 앞 16자와 사유 코드이며 길이 제약이 원문 유입을 막는다. 보존 기간을 새로
-- 두지 않고 행의 수명을 따른다.
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

WP-042 / CR-071 정밀화: 기존 migration 002 테이블을 그대로 사용한다. API가 생성한 행의 `good_seq`, `bad_seq`는 항상 채워지며 `0 <= good_seq < bad_seq`를 만족한다. 첫 생성 전에는 행이 없다. 후보·다음 지점·종료 여부는 해당 에폭 `merge_sequence`의 `(good_seq, bad_seq]`에서 계산하고 중복 저장하지 않는다. 사용자·저장소·브랜치 advisory transaction lock이 첫 생성과 초기화까지 직렬화하며, `sequence_space FOR SHARE`가 같은 트랜잭션 안의 에폭 판정을 보호한다. 에폭 불일치 또는 재채번 중에는 조회가 무효 상태를 계산하며 과거 행은 사용자의 초기화까지 보존한다. 문자열로 전달한 `session_id`를 표시·삭제 시 대조하여 삭제 후 재생성된 세션에 늦은 요청이 닿지 않게 한다. 개인 상태이므로 다른 사용자에게 공유하지 않는다. 데이터·인덱스 추가 migration은 필요 없다.

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
  -- PR 제목 M 넘버 표기 (FR-SEQ-009 AC-6, 마이그레이션 026)
  annotate_enabled  BOOLEAN     NOT NULL DEFAULT true,      -- 운영자가 적어 낸 정책
  annotate_blocked_at     TIMESTAMPTZ,                      -- 표기 잡이 권한 오류로 스스로 멈춘 시각
  annotate_blocked_reason TEXT,
  CONSTRAINT sequence_branches_limit CHECK (array_length(sequence_branches, 1) <= 10),
  CONSTRAINT repository_annotate_blocked_chk
    CHECK ((annotate_blocked_at IS NULL) = (annotate_blocked_reason IS NULL)),
  CONSTRAINT repository_annotate_blocked_reason_len_chk
    CHECK (annotate_blocked_reason IS NULL OR char_length(annotate_blocked_reason) <= 200),
  UNIQUE (owner, name)
);
CREATE INDEX repository_allowed_teams_idx ON repository USING GIN (allowed_team_ids);
-- 잔여 스윕이 대상 저장소만 고른다 (JOB-SEQ-005).
CREATE INDEX repository_annotate_enabled_idx ON repository (repository_id) WHERE annotate_enabled;
```

**운영자의 정책과 실행 중 차단은 다른 열이다** (WP-075 / CR-084). `annotate_enabled`는 사람이 적어 낸 값이고 이 제품은 오류를 만났다고 그 값을 바꾸지 않는다. `annotate_blocked_at`은 표기 잡이 GHE에서 `403`·`404`를 받아 **스스로** 멈춘 사실이며, 프로세스가 다시 떠도 유지되어야 하므로 메모리가 아니라 여기 남는다 — 재시작마다 권한 없는 저장소에 다시 요청하면 `FR-SEQ-009`가 막으려던 한도 소모가 그대로 일어난다. 둘을 한 열에 담으면 권한 오류 한 번이 운영자의 설정을 조용히 뒤집고, 권한이 복구된 뒤에도 운영자는 자기가 켜 둔 저장소가 왜 꺼져 있는지 알 수 없다.

```sql

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

#### `repository`의 최근 완료 조정 결과 — W-009-GAPS의 정본 (WP-034 / CR-050, DEV-352)

```sql
-- 마이그레이션 016
ALTER TABLE repository ADD COLUMN last_reconciled_at TIMESTAMPTZ;
ALTER TABLE repository ADD COLUMN last_reconcile_missing_count INTEGER;
ALTER TABLE repository ADD CONSTRAINT repository_reconcile_missing_chk
  CHECK (last_reconcile_missing_count IS NULL OR last_reconcile_missing_count >= 0);
```

**`reconcile_missing_total` 지표로는 이 물음에 답할 수 없다** (FR-ING-011 AC-6). 그것은 프로세스 수명 동안 **누적되는** Prometheus counter이고, W-009-GAPS가 묻는 것은 "가장 최근 **완료된** 회차에서 몇 건이 빠졌는가"다. 두 값은 단조 증가와 시점 스냅숏이라는 서로 다른 성질을 가지며, 게다가 지표 저장소(`METRICS_QUERY_URL`)가 설정되지 않은 배치에서는 `search-api`가 그 counter를 **읽을 방법 자체가 없다** — `API-ADM-006`의 `stage_latency_seconds`가 `"unavailable"`로 남는 것과 같은 이유다.

**완주한 회차만 이 값을 덮는다.** 조정 스캔은 GitHub API 한도가 소진되면 창을 끝까지 읽지 못하고 다음 주기로 미룬다(FR-ING-011 예외 처리, `ReconcileResult.deferred`). 그 회차의 부분 집계를 최근 결과로 쓰면 **그 숫자는 언제나 실제보다 작고**, 사용자는 그것을 "거의 다 수집됐다"로 읽는다 — 이 화면의 목적이 정확히 그 오독을 막는 것이다. 스캔이 예외로 끝난 회차도 마찬가지로 덮지 않는다. 미룬 회차가 반복되는 것은 별개의 관측 대상이며 `reconcile_incomplete_cycles` 지표와 3주기 경보가 이미 담당한다.

**두 값이 함께 `NULL`이면 "완료된 조정 스캔 기록이 없다"이고, `0`은 "확인했고 누락이 없다"이다.** 셋 중 어느 것도 서로를 대신하지 않으므로 화면은 세 경우를 다른 문구로 그린다.

**Prometheus counter를 제거하지 않는다.** 지표는 운영 추세를, 이 열은 사용자 진단 시점의 상태를 나타내며 책임이 다르다.

#### `repository_registration_request` — 등록 검토 요청 (WP-034 / CR-050, DEV-351)

```sql
-- 마이그레이션 016
CREATE TABLE repository_registration_request (
  request_id        BIGSERIAL   PRIMARY KEY,
  requested_by      TEXT        NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  repository_owner  TEXT        NOT NULL,
  repository_name   TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requested_by, repository_owner, repository_name)
);
CREATE INDEX repository_registration_request_slug_idx
  ON repository_registration_request (repository_owner, repository_name, created_at DESC);
```

**행 하나가 뜻하는 것은 "이 사용자가 이 식별자의 등록 검토를 요청했다"뿐이다** (FR-ING-009 AC-8). 저장소가 실제로 존재한다는 뜻도, 요청자가 그것을 볼 수 있다는 뜻도 아니다 — 기록 시점에 GitHub Enterprise에 묻지 않기 때문이다. 그래서 `repository_id`도 `org_id`도 `visibility`도 이 표에 없다. 그 값들은 GHE에 물어야만 알 수 있고, 묻는 순간 이 경로가 비공개 저장소의 존재 신탁이 된다 (AC-10, THR-004).

**UNIQUE가 멱등의 근거다** (AC-9). 같은 사용자의 같은 식별자 반복 요청은 새 행을 만들지 않고 기존 행을 돌려준다. 다른 사용자의 같은 저장소 요청은 각자의 행이며, 그래야 운영자가 "몇 사람이 요청했는가"를 셀 수 있다.

**`ON DELETE CASCADE`는 보존 표의 정책이다** — 사용자를 지우면 그가 남긴 요청도 사라진다. `saved_search`가 이 정책을 스키마에 갖지 못해 표를 처음 채우는 순간 드러났던 자리(DEV-347)를 같은 방식으로 반복하지 않는다.

**처리 결과 열은 CR-055가 더한다.** CR-050이 "운영자가 이 요청을 처리하는 경로는 WP-040의 몫"이라며 미뤄 둔 자리이며, 그 WP의 계약을 여는 이 CR이 수명주기를 확정했으므로 이제 스키마가 그것을 담는다.

```sql
-- 마이그레이션 020 (CR-055, DEV-428)
ALTER TABLE repository_registration_request
  ADD COLUMN status          TEXT        NOT NULL DEFAULT 'pending',
  ADD COLUMN resolved_at     TIMESTAMPTZ,
  ADD COLUMN resolved_by     TEXT        REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN resolution_note TEXT;

ALTER TABLE repository_registration_request
  ADD CONSTRAINT repository_registration_request_status_chk
    CHECK (status IN ('pending', 'fulfilled', 'dismissed'));

-- 종료된 요청은 종료 시각을 갖고 대기 중 요청은 갖지 않는다. 둘을 함께 걸어야
-- "닫혔는데 언제 닫혔는지 모르는 행"과 "열려 있는데 종료 시각이 있는 행"이 둘 다 막힌다.
ALTER TABLE repository_registration_request
  ADD CONSTRAINT repository_registration_request_resolution_chk
    CHECK ((status = 'pending') = (resolved_at IS NULL));

ALTER TABLE repository_registration_request
  ADD CONSTRAINT repository_registration_request_note_chk
    CHECK (resolution_note IS NULL OR length(resolution_note) <= 500);

-- 운영자 대기열의 키셋 순회 (API-ADM-009). 정렬 키를 그대로 담는다.
CREATE INDEX repository_registration_request_queue_idx
  ON repository_registration_request (status, created_at DESC, request_id DESC);
```

**세 상태뿐이며 그 사이에 승인 상태를 두지 않는다** (FR-ING-009 AC-11). 등록되지 않은 채 승인된 행은 아무것도 보장하지 못한다 — 수집도 채번도 시작되지 않았고 요청자에게 보이는 것도 달라지지 않는다. 승인은 성공한 등록 그 자체이며, `API-ADM-001`의 등록이 같은 정규화 식별자의 `pending` 행 전부를 `fulfilled`로 옮긴다.

**기존 행을 `fulfilled`로 소급하지 않는다.** 같은 식별자의 저장소가 지금 `active`라는 사실은 **그 등록이 이 요청 때문에 일어났다는 뜻이 아니다** — 요청보다 먼저 등록됐을 수도 있고, 그렇다면 이 행을 닫는 것은 일어나지 않은 인과를 정본에 적는 일이다. 게다가 `resolved_at`·`resolved_by`를 채울 진짜 값이 없으므로 위 제약을 만족시키려면 시각과 처리자를 지어내야 한다. **모르는 것을 지어내지 않고 `pending`으로 둔다** — 운영자가 대기열에서 한 번에 정리하며, 그 처리는 실제 시각과 실제 처리자를 갖는다.

**`resolved_by`는 `ON DELETE SET NULL`이다.** `requested_by`의 `CASCADE`와 다른 이유는 지우는 대상이 다르기 때문이다 — 요청자를 지우면 그의 요청도 사라지는 것이 보존 표의 정책이지만, **처리한 운영자가 퇴사했다고 그가 처리한 요청 기록까지 사라지면 안 된다.** 그래서 처리자만 비우고 행은 남긴다. 상태와 종료 시각은 그대로이므로 "언제 닫혔는지"는 여전히 알 수 있다.

**`resolution_note`는 운영자 평면에만 있다.** `API-ING-003`의 어느 응답에도 실리지 않는다 — 실리면 그 문장이 곧 비공개 저장소의 존재·정책 신탁이 된다 (AC-10).

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

-- 마이그레이션 021 (CR-058, DEV-482·485) — 작성자 소속 팀.
--
-- ## `team_member`와 무엇이 다른가
--
-- `team_member.user_id`는 `app_user(user_id)`를 참조한다. 그 뜻은 **"이 팀에
-- 속한 PR Search 사용자"**이고 `JOB-AUTH-001`의 무효화가 그 뜻으로 읽는다.
-- PR 작성자는 대부분 PR Search에 로그인한 적이 없어 `app_user`에 없고,
-- 그러므로 그 표에 들어갈 수 없다 — `replaceTeamMembers`가 외래 키에 걸리는
-- 사람을 조용히 버리는 것이 설계대로다.
--
-- 여기 담는 것은 **"이 팀에 속한 GHE 사용자"**다. 둘을 한 표에 담으면
-- `allowed_team_ids`와 `author_team_ids`를 한 필드로 합치는 것과 같은 오류가
-- 된다 — 접근 권한과 작성자 소속은 다른 사실이다 (CR-053, DEV-382).
--
-- ## 왜 PostgreSQL인가
--
-- `ADR-004`의 불변 조건은 "모든 엔티티 문서는 PostgreSQL 데이터만으로 재구성
-- 가능해야 한다"이고 재색인 경로는 GHE를 한 번도 부르지 않는다. `WP-069`의
-- DoD가 "소속 변경이 재색인으로 반영된다"를 요구하므로, 소속은 재색인이 읽을
-- 수 있는 곳에 있어야 한다.
--
-- ## login으로 키를 잡는 이유
--
-- 문서의 `author`가 login이다. GHE 숫자 id가 개명에 강하지만 투영이 손에 쥐고
-- 있는 값은 login 하나이며, 없는 값을 지어내 맞추지 않는다. 개명은 다음 조직
-- 동기화가 교체로 흡수한다.
CREATE TABLE team_membership (
  team_id BIGINT NOT NULL REFERENCES team(team_id) ON DELETE CASCADE,
  login   TEXT   NOT NULL,
  PRIMARY KEY (team_id, login)
);

-- 작성자 하나로 팀을 찾는 조회가 이 색인을 탄다. 없으면 투영마다 전량 스캔이다.
CREATE INDEX team_membership_login_idx ON team_membership (login);

-- 조직별 동기화 시각 (CR-058, DEV-486).
--
-- **이 값이 아는 것과 모르는 것의 경계다.** 신선하면 그 조직에서 작성자가
-- 어느 팀에도 없다는 것이 **사실**이므로 `author_team_ids: []`를 쓴다. 낡았거나
-- 행이 없으면 **모름**이므로 필드를 쓰지 않고 이미 있던 값을 지운다.
-- 그러므로 이 표를 지우는 것은 "팀이 없다"가 아니라 "다시 물어봐야 한다"이다.
CREATE TABLE org_team_sync (
  org_id    BIGINT      PRIMARY KEY,
  synced_at TIMESTAMPTZ NOT NULL
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

-- 마이그레이션 022 (CR-060, DEV-517) — 005 이후 만들어진 표의 애플리케이션 롤 권한.
--
-- **005는 표 이름을 열거해 권한을 준다.** 그 뒤 만들어진 표는 자기 마이그레이션이
-- `GRANT`를 함께 적지 않으면 아무 권한도 갖지 못했고, 실제로 다섯이 `SELECT`조차
-- 없었다. **통합 시험이 소유자 롤로 돌아** 그 사각지대를 한 번도 묻지 않았으며
-- (`019`가 `prs_admin`에서 겪은 것과 같다), `prs_app`으로 실제 접속하는 배포가
-- 생기자 재색인이 `permission denied`로 죽었다.
--
-- **`ALTER DEFAULT PRIVILEGES`는 쓰지 않는다** — 앞으로 만들어지는 모든 표에
-- `UPDATE`·`DELETE`가 자동으로 붙어, 감사 성격의 표가 하나 더 생기면
-- `FR-AUTH-004` AC-3의 방어선이 조용히 사라진다. 자동 부여는 그 예외를 표현할 수 없다.
-- 대신 권한 시험이 **모든 표를 훑고** 제외는 사유와 함께 선언한다.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  pull_request_snapshot, commit_snapshot,
  repository_registration_request,
  team_membership, org_team_sync
TO prs_app;

-- 마이그레이션 023 (CR-061, DEV-518) — 시퀀스도 같은 사각지대에 있었다.
--
-- 005의 `ON ALL SEQUENCES`도 **그 시점에 존재하는 것**만 뜻한다. 022가 표에
-- 대해 같은 공백을 메우면서 시퀀스를 세지 않아, `repository_registration_request`의
-- `INSERT`가 **표 권한을 통과한 뒤 `nextval`에서** `permission denied for sequence`로
-- 막혔다. 전수 검사를 만들 때 **"무엇의 전수인가"를 먼저 물어야 한다.**
GRANT USAGE, SELECT ON SEQUENCE repository_registration_request_request_id_seq TO prs_app;
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
  -- 사용자 삭제 시 함께 사라진다 (보존 표의 정책. 마이그레이션 015, DEV-347)
  owner_user_id   TEXT        NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  query           TEXT        NOT NULL,
  visibility      TEXT        NOT NULL DEFAULT 'private',  -- private | team
  team_id         BIGINT      REFERENCES team(team_id),    -- 대상 팀. team일 때만 값이 있다
  -- `seq:` 조건이 딛고 선 시퀀스 에폭 (마이그레이션 017, CR-051, ADR-007 규칙 5).
  -- 질의에 `seq:` 범위가 없으면 NULL이고, CR-051 이전에 저장된 행도 NULL이다(legacy unbound).
  -- 저장소·브랜치를 여기 복사하지 않는다 — 공간의 정체성은 질의의 `repo:`·`base:`가 갖는다.
  seq_epoch       INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at     TIMESTAMPTZ,
  UNIQUE (owner_user_id, name),
  CONSTRAINT saved_search_visibility_chk CHECK (visibility IN ('private', 'team')),
  -- 마이그레이션 015 (CR-049, DEV-335). 공개 범위와 대상 팀은 함께 성립하거나 함께 없다.
  CONSTRAINT saved_search_team_target_chk CHECK (
    (visibility = 'private' AND team_id IS NULL)
    OR (visibility = 'team' AND team_id IS NOT NULL)
  ),
  -- 마이그레이션 017 (CR-051). 에폭은 1부터다. "질의에 `seq:`가 있으면 값이 있어야 한다"는
  -- **`CHECK`로 강제할 수 없다** — 그 판정은 질의 파서를 실행해야 하고 SQL은 그것을 모른다.
  -- 그 불변식은 애플리케이션 계약이며 시험이 지킨다.
  CONSTRAINT saved_search_seq_epoch_chk CHECK (seq_epoch IS NULL OR seq_epoch >= 1)
);

-- 목록 인덱스 (마이그레이션 015, CR-049). 정렬 키와 같은 쌍을 담아 키셋 순회가 정렬 없이 끝난다.
CREATE INDEX saved_search_owner_idx ON saved_search (owner_user_id, created_at DESC, saved_search_id DESC);
CREATE INDEX saved_search_team_idx   ON saved_search (team_id, created_at DESC, saved_search_id DESC)
  WHERE visibility = 'team';
-- 사용자당 100건 상한 (FR-SRCH-010 AC-4)은 애플리케이션 계층에서 검사한다.
--
-- **`CHECK`로 강제하지 않는다** (CR-049, DEV-336). PostgreSQL의 `CHECK`는 다른 행을 볼 수 없어
-- "이 사용자의 행이 몇 개인가"를 물을 수 없다. 그래서 상한은 트랜잭션 안에서 소유자 행을
-- `SELECT ... FOR UPDATE`로 잠그고 세고 넣는 순서로 지킨다 — 잠그지 않으면 99건 상태의
-- 동시 요청 둘이 각각 "99 < 100"을 읽고 101건을 만든다.
--
-- **대상 팀은 `team_id`로만 식별한다** (CR-049). `slug`은 `(org_id, slug)`에서만 유일하므로
-- 여기에 비정규화하면 같은 이름의 다른 조직 팀으로 공유가 새고, 팀 개명이 이 표를 낡게 만든다.
--
-- **저장자가 대상 팀에서 이탈해도 행을 자동으로 지우거나 바꾸지 않는다** (AC-7). 외래 키는
-- 팀의 존재만 보증하며 구성원 자격은 조회·수정 시점에 `team_member`로 판정한다.
--
-- **그 판정은 쓰기와 원자적이어야 한다** (CR-049 PR #59 리뷰). `READ COMMITTED`에서 문장마다
-- 스냅숏이 새로 잡히므로, 멤버십을 읽고 나중에 쓰면 그 사이에 커밋된 탈퇴를 보지 못한다.
-- `team_member` 행을 `SELECT ... FOR SHARE`로 잠근 뒤 쓴다 — 100건 상한이 소유자 행을
-- `FOR UPDATE`로 잠그는 것과 같은 이유이며, 둘 다 "검사와 쓰기 사이에 창을 남기지 않는다"이다.

**마이그레이션 017 — `seq_epoch` (CR-051, DEV-362).**

ADR-007 규칙 5는 "시퀀스를 인용하는 모든 저장물은 에폭을 함께 저장한다"를 정하고 세 저장물을
열거한다. 그중 `safe_marker`만 실제로 그렇게 하고 있었다.

| 저장물 | 공간 정체성 | 에폭 |
| --- | --- | --- |
| `safe_marker` | `repository_id` + `base_branch` **열** | `seq_epoch` 열 |
| `saved_search` | 질의의 `repo:`·`base:` | **마이그레이션 017이 더한다** |
| 공유 URL | 질의의 `repo:`·`base:` | URL의 `seq_epoch` 파라미터 |

**`safe_marker`와 달리 저장소·브랜치를 열로 두지 않는다.** 저장된 검색의 정체성은 질의 문자열이고,
`seq:` 조건이 어느 공간을 뜻하는지는 그 문자열의 `repo:`·`base:`가 이미 말한다 (FR-SRCH-005 AC-7).
열로 복사하면 사용자가 질의를 고쳤을 때 사본이 낡고, **어느 쪽이 정본인지 아무도 모르게 된다.**
`safe_marker`가 열을 갖는 것은 그 자원에 질의가 없기 때문이다.

**만들지 않는 것.** 여러 공간의 에폭을 담는 지도, 에폭 집합의 지문, 전역 시퀀스 리비전, 서버 측
시퀀스 맥락 스냅숏 표, 저장자의 접근 범위 사본, 에폭 이력 표를 만들지 않는다. `seq:`가 하나의
공간만 지목하므로 **하나의 정수면 충분하다.**

**기존 행을 소급해 채우지 않는다** (DEV-362). 마이그레이션이 `seq:`를 담은 기존 행을 찾아
현재 에폭을 넣는 길이 있지만 택하지 않는다 — **저장 당시의 에폭은 어디에도 남아 있지 않으므로
현재 값을 넣는 것은 복구가 아니라 추측이고**, 그 추측을 스키마 변경으로 못 박으면 조용한 오답을
영구히 승인하게 된다. 그런 행은 `NULL`로 남아 `unbound` 상태가 되며, 저장자가 명시적으로
다시 연결할 때에만 값이 생긴다.

**애플리케이션이 지키는 불변식.** `CHECK`는 질의 파서를 실행할 수 없으므로 아래는 계약이고
시험이 지킨다.

| 상태 | 질의의 `seq:` | `seq_epoch` | 판정 |
| --- | --- | --- | --- |
| A | 없음 | `NULL` | 정상 |
| B | 있음 | 값 | 정상 (CR-051 이후 생성·수정) |
| C | 있음 | `NULL` | **legacy unbound** — 실행을 막는다 |
| D | 없음 | 값 | **만들지 않는다** — 생성·수정에서 거절한다 |

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

-- CR-054(DEV-412): 필터 없는 전역 목록의 정렬 키를 그대로 덮는다.
-- 위 둘은 앞 컬럼이 필터라 `user_id`·`action` 조건이 있을 때만 쓰인다.
-- A-004의 기본 조회는 조건이 없고 `API-ADM-005`의 커서가 이 순서를 봉인한다.
CREATE INDEX audit_cursor_idx ON audit_record (occurred_at DESC, audit_id DESC);
```

`audit_record`에는 UPDATE·DELETE 권한을 애플리케이션 롤에 부여하지 않는다 (FR-AUTH-004 AC-3). 보존 만료 삭제는 별도 관리 롤이 파티션 드롭으로 수행한다.

**관리 롤로 접속할 경로를 함께 연다 (CR-054, DEV-411).** `prs_admin`은 마이그레이션 005부터 있었으나 **그 롤로 접속하는 코드 경로가 없었다** — `createPool()`은 `DATABASE_URL` 하나만 읽는다. `JOB-AUD-001`이 파티션을 드롭하려면 그 권한이 필요한데, `prs_app`에 `DROP`을 주는 길은 **감사 불변성의 마지막 방어선을 없앤다.** 그래서 관리 연결을 **별도 설정값**(`ADMIN_DATABASE_URL`)으로 열고, 없으면 보존 잡이 **기동하지 않되 나머지 배치 역할은 정상 동작한다** — 설정 하나가 없어서 워커 전체가 뜨지 않으면 실시간 경로까지 함께 죽는다. 이 연결은 보존 잡만 쓰며 일반 조회·쓰기 경로에 노출하지 않는다.

**`prs_admin`은 `NOLOGIN`이므로 그 이름으로 접속할 수 없다 (PR #83 리뷰).** 마이그레이션 005가 두 롤을 `NOLOGIN` 그룹 롤로 만든 것은 의도한 설계다 — 권한의 묶음이지 접속 주체가 아니다. 따라서 관리 연결은 **로그인 가능한 주체가 `prs_admin` 멤버십을 갖고 접속한 뒤 `SET ROLE prs_admin`으로 그 권한을 집는다.**

```sql
-- 배포가 만드는 로그인 주체 (마이그레이션이 아니라 운영 프로비저닝의 몫이다 —
-- 비밀번호는 시크릿이고 스키마에 담지 않는다)
CREATE ROLE prs_retention LOGIN PASSWORD :secret;
GRANT prs_admin TO prs_retention;
```

보존 잡은 연결 직후 `SET ROLE prs_admin`을 실행한다. **소유자 계정(`prs`)을 그대로 쓰지 않는다** — 그 계정은 모든 표에 대한 전권을 갖고 있어 잡 하나의 실수가 어디에나 닿는다. `SET ROLE`은 **필요한 권한만 집는 경계**이며, 트랜잭션이 끝나면 원래 주체로 돌아온다.

**`target`·`query`는 nullable이다** (FR-AUTH-004 AC-2). 의미상 대상이 없는 액션이 있고, 빈 문자열로 채우면 "없다"와 "빈 값으로 기록됐다"가 구분되지 않는다.

### 3.5 GitHub Operations (CR-005 신규)

기존 마이그레이션은 수정하지 않는다. 아래 스키마는 additive 마이그레이션으로만 추가한다. **이 장의 `006`·`007`·`009`는 초기 계획 번호다** — 이 저장소의 실제 마이그레이션 공간에서 GitHub Operations의 첫 마이그레이션은 **`028_gh_operations`**이며(001~027은 Search Plane이 썼다), 첫 수직 판(`CR-086` / `WP-077`)이 실제로 쓰는 것만 만들었다. 실현 상태는 아래 표가 정본이다.

**028이 만든 것과 만들지 않은 것 (CR-086).**

| 표 | 028 | 이유 |
| --- | --- | --- |
| `github_identity_connection` | 만듦 (PK `user_id`, `host`, `token_ref`, 만료·철회 열) | 위임 신원의 정본 |
| `gh_identity_secret` | **신설** (`user_id` FK, `key_id`, `access_sealed`·`refresh_sealed` BYTEA) | 단일 호스트에는 비밀 저장소가 없다. `token_ref`가 가리키는 자리를 이 DB에 두되 **원문이 아니라 AES-256-GCM 봉인**만 넣는다. 봉인 키는 `.env`에 있고 DB에는 없으므로 덤프만으로는 토큰을 되살릴 수 없다. 비밀 저장소의 대체이지 동등물이 아니다 (`DEV-652`, 보안 문서 10.2) |
| `gh_execution` | 만듦 (월별 파티션, 소유자 `prs_admin`, `PARTITIONED_TABLES` 등재, 보존 12개월) | 실행 기록이자 `FR-GH-012` AC-1의 감사 항목 전부를 담는 **실행 감사의 정본**. `audit_record`에는 별도 행을 남기지 않는다 |
| `gh_execution_idempotency` | **신설** (비파티션, PK `(user_id, idempotency_key)`, `execution_id`) | 아래 `gh_execution_idem_uk`는 파티션 표에서 **유일성을 강제하지 못한다** — 파티션 키 `requested_at`이 인덱스에 들어가야 하고 두 요청의 그 값은 늘 다르다. 통합 시험이 같은 키로 두 행이 생기는 것을 실제로 보였다. 그래서 요청 수락이 이 보조 표에 먼저 `INSERT … ON CONFLICT DO NOTHING`을 하고 실행 행을 만든다. 경합 3건 동시 삽입에서 1건만 성립한다 (`DEV-650`). 보존 정책은 아직 없다 (`DEV-656`) |
| `gh_execution_lock` | 만들지 않음 | R0 읽기에는 상충 작업이 없다 |
| `gh_execution_artifact` | 만들지 않음 | 파일 입출력을 열지 않았다 |
| `gh_recipe` · `gh_recipe_revision` | 만들지 않음 | WP-058 |
| `gh_approval` | 만들지 않음 | R0는 승인이 없다 |
| `gh_capability_snapshot` | 028에서는 만들지 않음 → **029가 만듦** (아래) | 028 시점의 이유: `CHECK (unclassified_count = 0)`는 parity 게이트(`NFR-009`)를 통과한 뒤에만 참이 될 수 있었다(`DEV-657`). 029는 기록과 활성화를 분리해 그 CHECK를 활성화에만 건다 |

**029가 만든 것 (CR-088 / WP-078, `DEV-672`).** additive이며 028을 건드리지 않는다. 계획 번호 009는 쓰지 않는다.

| 표 | 029 | 이유 |
| --- | --- | --- |
| `gh_capability_snapshot` | 만듦 — manifest 해시마다 한 행(`UNIQUE (manifest_version, manifest_hash)`), 인벤토리 해시·차원별 카운트·`coverage` JSONB·`first_seen_at`·`activated_at`(NULL 허용). **CHECK `activated_at IS NULL OR (command·interaction·flag·positional 미분류 전부 0)`**. 트리거: 내용 불변(활성화만 한 번 NULL → 시각), 삭제 없음 | 미분류가 남은 manifest도 **진단용으로 기록**해야 A-006이 「무엇이 미완인가」를 보인다. 막는 것은 활성화뿐이고 그 조건은 NFR-009처럼 네 차원 전부다. 과거 실행이 가리키는 해시를 새 내용으로 덮지 않는다 |
| `gh_capability_verification` | **신설** (`ENT-GH-012`) — 검사 회차마다 한 행. 출처·계기·환경·기대/관측(gh 버전·바이너리 SHA-256·manifest 해시·인벤토리 해시)·검증기/규칙 버전·상태·diff·보고서 원문(1 MiB CHECK — 실측 9.6KB, 합성 최악 431KB)·보고서 해시·오류. **append-only**: `UPDATE`·`DELETE`를 트리거가 `restrict_violation`으로 거부한다. 행 트리거는 `TRUNCATE`에 걸리지 않으므로 소유자 `prs_admin`의 TRUNCATE만이 이 보장의 밖이다(`prs_app`에는 그 권한이 없다) | 「마지막 검증은 언제 어떤 해시의 자료로 수행됐는가」와 「이전과 무엇이 달라졌는가」에 답하려면 회차가 남아야 한다. 실패 기록이 정상 기록을 덮지 않는다 |
| 권한 | `prs_app`: 두 표 SELECT·INSERT만(UPDATE·DELETE 없음). `prs_admin`: ALL | 실행기는 기록만 한다. 활성화(`activated_at`)는 운영자가 `prs_admin`으로 — 이 판은 어느 행도 활성화하지 않았다 |
| 기록 주체 | `gh-executor`의 `JOB-GH-003`(기동 시·주기). CI·CLI는 보고서만 내고 DB에 쓰지 않는다 | 실행기의 기록이 실행 거절(`registry_stale`)의 근거다. CI 검사 바이너리의 결과와 섞지 않는다(`checked_by`) |

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
-- **아래 유니크 인덱스는 설계 의도일 뿐 파티션 표에서는 같은 키를 막지 못한다** (DEV-650, CR-086).
-- 028은 이것을 일반 인덱스(gh_execution_idem_idx)로 깔고, 유일성은 보조 표
-- gh_execution_idempotency(user_id, idempotency_key)의 PK가 강제한다 — 위 실현 상태 표 참고.
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

-- 009: 승인과 capability 스냅샷 (초기 계획. gh_capability_snapshot의 **실제 DDL은 029**다 — 위 표와 DEV-672.
--      아래 CHECK (unclassified_count = 0)는 활성화 조건으로 옮겨졌다.)
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

### 3. 검색 내보내기 산출물 (`search_export`, WP-044 / CR-072)

`migration 024_export`는 `job(type=export)`에 딸린 산출물 표를 만든다. `job_id`가 PK이자 job FK이고 삭제는 cascade다. `user_id`는 실행자 FK이며 사용자 삭제 시에도 산출물을 지운다. `scope_version`, `repository_ids`, `format(csv|json)`, `plan(JSONB)`는 요청 시 같은 트랜잭션에 저장한다. plan에는 검증된 ES 질의·대상·정렬·scope·원문 q와 해당하는 시퀀스 바인딩을 담는다. 클라이언트가 plan을 직접 지정하지 않는다.

`migration 025_merge_number`는 M 번호를 기존 merge_sequence 행에 얹는다(CR-077 / CR-079). **번호 정본을 별도 표로 분리하지 않는다.** 추가되는 evidence/work/sample 표는 확정 근거·영속 전달·관측의 보조 자료다. CR-077 기본 다섯 필드에 M 부여 시각·blocker와 세 보조 표를 추가하며 최종 타입·제약·초기값·권한은 `pr_search_wp074_design.md` 6절이 정본이다. 기존 M 값은 NULL, checkpoint는 0이며 migration에서 GHE 조회나 과거 채번을 수행하지 않는다.

**M 번호는 mnumber_head_seq에서 이어 간다(CR-079).** PR 확정은 번호와 위치를, 증서 있는 direct 확정은 위치만 증가시키고 unresolved에서는 멈춘다. 기존 NULL 또는 DEV-207의 direct_push 역할로 영구 skip하지 않는다. 현재 production 부재 증거는 DEV-581로 남아 있으며 상세 설계 2.2·3·5절을 따른다. 이미 발급한 번호를 다른 행으로 옮기지 않는다.

**`merge_number`는 `merge_seq`를 대신하지 않는다.** 범위 조회(`FR-SEQ-002`)와 릴리스 포함 판정(`FR-REL-002`)은 계속 `merge_seq`를 쓴다 — M 넘버는 직접 푸시 커밋을 세지 않으므로 브랜치 히스토리와 1:1 대응하지 않고, 그 위에서 구간을 인용하면 실제 히스토리 구간과 어긋난다. 색인의 `merge_number`는 **표시와 해석 전용**이며 구간 스캔의 근거가 아니다.

`content(TEXT)`, `row_count(0~100000)`는 완성 전 null이다. 파일 생성 후 실행 중 job 행과 실행자 버전을 확인하고 **산출물 적재와 completed 전이를 같은 트랜잭션**으로 처리한다. 실패·취소·중단은 완성 파일을 공개하지 않는다. 새로운 영구 보존 기한을 만들지 않고 기존 job 수명을 따른다. application role `prs_app`에 이 표의 명시적 CRUD 권한을 부여한다. 대용량 원본 본문·경로 대신 API-SRCH-006에 열거한 검색 요약 projection을 사용한다.

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
      "merge_number":        { "type": "long" },
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
      "changed_lines":       { "type": "integer" },
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
      "repository_id": { "type": "long" },
      "received_at":  { "type": "date" },
      "correlation_id": { "type": "keyword" },
      "payload":      { "type": "object", "enabled": false }
    }
  }
}
```

`payload`는 `enabled: false`로 저장만 하고 색인하지 않는다. 원본 보존과 `delivery_id` 대조가 목적이며 payload 내부 검색은 요구되지 않는다. 색인하면 5억 건의 임의 JSON이 매핑 폭발을 일으킨다.

**`repository_id`와 `repository`를 둘 다 담는다 (CR-052, DEV-366).** 전자는 `ADR-008`의 필수 접근 범위 필터가 결합하는 재료이고 후자는 조사자가 읽는 값이다. 이전 판은 `repository`만 두었는데 게이트웨이가 실제로 기록하는 것은 `repository_id`였고, 매핑이 `dynamic: false`라 그 값은 **색인되지 않은 채 `_source`에만 남았다** — 아카이브를 저장소로 좁히는 조회도, 접근 범위 필터를 거는 것도 성립하지 않는 상태였다. **하나만 담는 길은 없다**: `repository_id`가 없으면 필터를 걸 수 없고, `repository`가 없으면 조사자가 저장소를 알아볼 수 없다.

**접근 범위는 이 필드 하나로 건다** (PR #65 리뷰). 엔티티 인덱스가 500개 초과 범위에서 쓰는 `org_id`·`visibility`·`allowed_team_ids` 갈래는 여기에 두지 않는다 — 웹훅 수신 시점에 알 수 없고, 담아 두면 저장소의 가시성이 바뀌는 순간 낡으며 **낡은 접근 통제 재료는 그 자체가 유출 경로다.** `API-ADM-008`은 같은 저장소 집합을 `explicit` 표현으로 고정해서 결합한다.

**미등록 저장소 이벤트는 `repository_id`가 비어 있다.** `WP-010`이 정한 대로 미등록 저장소의 웹훅도 원본 보관 대상이기 때문이다. 그 문서는 어떤 접근 범위에도 속하지 않으므로 `API-ADM-008`이 내주지 않는다 — 내주면 그 응답이 곧 "이 저장소에서 웹훅이 오고 있다"는 존재 신탁이 된다 (`FR-AUTH-002` AC-4와 같은 규칙).

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

**leaf boolean은 간선 하나의 결과가 아니다 (CR-041, DEV-241).** "간선 하나를 지웠으니 `false`"는 틀렸다 — 같은
종류의 다른 간선이 남아 있을 수 있다. 조정이 끝난 뒤 **현재 active 간선 집합에서 다시 계산한다.**

| leaf | 정의 |
| --- | --- |
| `has_revert` | 이 엔티티를 `from`으로 하는 active `reverts` 간선이 1건 이상 |
| `is_reverted` | 이 엔티티를 `to`로 하는 active `reverts` 간선이 1건 이상 |
| `has_cherry_pick` | 이 엔티티가 걸린 active `cherry_picks` 간선이 1건 이상 (방향 무관 — 목록 배지의 뜻이다) |
| `has_stack` | 이 PR이 걸린 `stacks_on` 간선 중 **`detached`가 아닌 것**이 1건 이상 |

`false`는 **"확인했고 현재 없다"**일 때만 쓴다. 계산하지 못한 회차는 값을 건드리지 않는다 — WP-029가
`reference_count`에 세운 규율과 같다.

**조건부 업서트 스크립트로는 이 분업을 표현할 수 없다.** 그 스크립트는 `ctx._source[key] = value`로 대입하므로
`link_summary`를 넘기면 **객체를 통째로 바꾼다** — WP-029가 참조 수만 고치려 해도 WP-030이 써 둔 네 값이 사라진다.
그래서 관계 요약은 **leaf 단위로 대입하는 전용 경로**를 쓴다. CR-038이 커밋 메타데이터에서 같은 이유로 만든
`COMMIT_METADATA_SCRIPT`가 선례다.

**`to_repository_id`·`detached`의 소유 (CR-039, DEV-223).** `to_repository_id`는 **WP-029**가 대상 저장소를 해석한
시점에 채운다. `detached`는 **WP-030**이 소유한다 — WP-029는 이 필드를 두지 않는다. `strict` 매핑에서 값을 두지
않는 것과 `false`를 두는 것은 다른 주장이며, 아직 계산하지 않은 것을 `false`로 적으면 "확인했고 아니었다"가 된다.

**`detached`는 `stacks_on` 전용이며 "지우지 않는 제거"다 (CR-041, DEV-238).** FR-REL-006 AC-3은 상위 PR이 머지되어
조건이 깨지면 간선을 "해제 상태로 **표시**한다"고 요구한다 — 지우라고 하지 않는다. 지우면 *그런 의존이 있었다*는
사실이 사라져 사후 조사가 불가능해진다. 조건이 다시 성립하면 `false`로 되돌린다. **한 번도 성립한 적 없는 후보에는
간선 자체를 만들지 않는다** — `detached: true`를 미리 두면 없었던 관계를 주장하게 된다.

`references`·`reverts`·`cherry_picks`는 이 필드를 두지 않는다. 그 셋은 근거가 사라지면 **간선을 제거**한다 —
본문에서 사라진 참조·되돌림 표현, 후보 집합에서 빠진 체리픽은 "해제된 관계"가 아니라 **없는 관계**다.

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

| 다차원 필터 목록 | `prs-pull-requests` **+ `prs-commits`** | 복합 `bool.filter` + `search_after` | p95 500ms @ 1000만 | FR-SRCH-006 |
| 패싯 | `prs-pull-requests` | `terms` 집계 6종, size 20 | 목록과 동일 요청 | FR-SRCH-009 |
| 전문 검색 | `prs-pull-requests` | `multi_match` (title^3, body, message) + highlight | p95 500ms | FR-SRCH-011 |
| 그룹 집계 | `prs-pull-requests` | `terms` 집계, size 500 | p95 1500ms | FR-STAT-001 |
| 시계열 | `prs-pull-requests` | `date_histogram(merged_at)` + timezone | p95 1500ms | FR-STAT-002 |
| 백분위 | `prs-pull-requests` | `percentiles(lead_time_seconds)` | p95 1500ms | FR-STAT-003 |
| 분포 | `prs-pull-requests` | `range` 집계 (`changed_files_count`, `changed_lines`) | p95 1500ms | FR-STAT-005 |
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

**사전 계산 필드**: `lead_time_seconds`, `first_review_wait_seconds`, `changed_files_count`, `additions`, `deletions`, **`changed_lines`**, `link_summary.*`, `unreleased`는 모두 색인 시점에 계산해 저장한다. 조회 시점 `script` 필드나 runtime field를 집계에 사용하지 않는다 (NFR-001).

**`changed_lines`는 `additions + deletions`다** (CR-053, DEV-386). 변경 규모 분포(`FR-STAT-005` AC-2)가
그 합을 구간으로 나누는데, 두 필드를 조회 시점에 더하면 `script`가 필요하고 그것은 위 규율이
금지한다. **집계가 읽을 값은 집계가 계산하지 않는다.**

**`author_team_ids`의 정본은 `team_membership`이고 그 신선도는 `org_team_sync`가 말한다** (CR-058,
DEV-481·486). 투영은 **그 PR 저장소의 조직**에서 작성자의 팀을 읽는다 — 등록된 모든 조직으로
넓히면 한 조직의 동기화 실패가 모든 문서를 모름으로 만들고, `team.slug`이 `UNIQUE (org_id, slug)`라
조직을 정하지 않으면 같은 이름이 조직마다 다른 팀을 가리킨다.

**세 값이 서로 다른 사실이다.** 그 조직의 동기화가 신선하고 작성자가 팀 여럿에 있으면 그 ID들을
싣고, 신선한데 어느 팀에도 없으면 **`[]`가 사실의 진술**이며, 동기화가 낡았거나 없거나 문서에
`author` 자체가 없으면 **부재**다. 부재는 `UpsertRequest.remove`로 실제 부재를 만든다 — 이미 색인된
옛 소속이 남으면 그 작성자가 떠난 팀의 버킷에 계속 세어진다 (DEV-484, `DEV-454`와 같은 규율).

**재색인은 이 표에서 다시 계산한다** (DEV-485). `pull_request_snapshot`은 투영 시점의 사본이라
소속이 박제되어 있고, 그것을 그대로 재생하면 재색인이 **옛 팀을 되살린다** — `allowed_team_ids`가
`registryOwnedFields`로 덮이는 것과 같은 이유다. **GHE를 부르지 않는다**: `ADR-004`의 불변 조건이
"PostgreSQL 데이터만으로 재구성 가능"이므로 재구축이 외부 API에 기대면 그 조건이 깨진다.

**변경 규모를 모르는 문서에는 그 넷을 쓰지 않는다** (CR-056, DEV-450). `changed_files_count`·
`additions`·`deletions`·`changed_lines`는 보강이 끝나지 않았고 **파일 목록도 비어 있는** 문서에서
**부재로 남는다.** 빈 목록을 세어 0을 쓰면 그 값이 사실의 진술이 되고, `FR-STAT-005` AC-5가
가르라고 한 **모름과 0이 같은 구간에 들어간다.** 판정 재료는 `enrichment_errors`의 `files`
항목이며 `enrichment_pending`이 아니다 — 그 플래그는 네 구성 요소 중 하나만 실패해도 참이라
**리뷰 조회만 실패한 PR의 진짜 빈 목록까지 버린다** (DEV-457).

**이미 색인된 값은 지운다** (DEV-454). 조건부 업서트는 실린 키만 대입하므로 필드를 빼는 것만으로는
옛 수가 남는다. `UpsertRequest.remove`가 그 이름을 담고 스크립트가 `ctx._source.remove(k)`를
돌린다 — 제거도 갱신이라 `document_version` 비교 아래 둔다. 집계의 `unknown`은 이 부재를 세므로 판정 재료가 한 곳에만 있다 — 자리를
0으로 채운 뒤 `enrichment_pending`을 다시 읽어 되돌리는 방식은 같은 판정을 두 곳에 두는 일이고,
그 둘이 어긋나는 날 화면이 조용히 거짓을 말한다.

부재는 **정렬과 검색에도 그대로 나타난다** — `changed_files` 범위 조건에 걸리지 않고 `sort`에서
뒤로 간다. 그것이 옳다: 모르는 값을 크기 비교에 넣으면 그 순위가 사실을 주장한다.

**집계 셋의 대상이 `prs-pull-requests` 단독인 것은 계약이다** (CR-053, `FR-STAT-001` AC-6). 목록은
PR과 커밋을 함께 보지만(`W-001-RESULTS`의 유형 열) 집계는 PR만 센다 — 그룹 키 일곱 중 팀·라벨·PR
상태와 지표 넷 중 변경 파일 수·리드타임이 **커밋 매핑에 없기 때문**이며, 커밋을 넣으면 그 다섯이
조용히 0이나 `unknown`이 된다. 두 총계가 다른 것은 오류가 아니라 **다른 것을 세는 것**이다.

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
| `repository_registration_request` | 영구 (사용자 삭제 시 제거) | 하드 삭제 | PostgreSQL 백업에 포함 |
| `gh_execution` | 1년 (NFR-012, 감사와 동일) | 월별 파티션 드롭 (관리 롤만) | PostgreSQL 백업에 포함 |
| `gh_execution_artifact` | 실행 기록보다 짧게 — 기본 30일 | `expires_at` 경과분 정리 잡 | 백업 안 함. 재실행으로 재생성 |
| `github_identity_connection` | 연결 해제 또는 만료까지 | 하드 삭제 | 참조만 백업. 토큰은 비밀 저장소 소관 |
| `gh_identity_secret` | 연결과 함께 (재연결·갱신 시 봉인 교체, 철회 시 삭제·행은 유지) | 하드 삭제 | 봉인만 있다. 키(`GH_IDENTITY_VAULT_KEY`)는 `.env`에만 — 백업에 키가 없으면 복원해도 되살릴 수 없으며 그것이 의도다 (CR-086) |
| `gh_execution_idempotency` | **정하지 않았다 — 지금은 영구** (`DEV-656`) | 없음 | 실행 기록의 12개월과 짝을 맞출 정리 잡은 다음 판이다 |
| `gh_recipe`, `gh_recipe_revision` | 영구 (사용자 삭제 시 제거) | 하드 삭제 | PostgreSQL 백업에 포함 |
| `gh_approval` | 1년 (연결된 실행과 동일) | 연결 실행 파티션 드롭 시 함께 | PostgreSQL 백업에 포함 |
| `gh_capability_snapshot` | 영구 | 삭제하지 않음 (029 트리거가 DELETE를 거부) | 과거 실행의 argv 해석에 필요하다 |
| `gh_capability_verification` | 영구 (CR-088) | 삭제하지 않음 (append-only 트리거) | 하루 한 번 + 기동마다 한 행이라 연 수백 행 규모다. 「언제 어떤 자료로 확인했는가」의 이력이므로 지우지 않는다 |

원본 이벤트의 3년 보존 보증은 `raw_event`(PostgreSQL)가 진다. ES 아카이브 인덱스의 ILM 창은 FR-ING-010 AC-1이 요구하는 대로 분리된 값이며, 아카이브는 백업 대상이 아니라 `raw_event`에서 재구성한다. 두 값을 같게 맞출 의무는 없다 — ILM 창을 줄여도 보존 보증은 영향받지 않는다.
| `job`, `dead_letter` | 90일 | 배치 삭제 | PostgreSQL 백업에 포함 |
| git 미러 | 캐시 | 재클론 가능 | 백업 안 함 |
| NDJSON 아카이브 파일 | 크기 상한 × 보관 개수 (기본 64MiB × 5) | 한도 초과 시 가장 오래된 조각부터 삭제 | 백업 안 함. `raw_event`가 정본이다 |

**소프트 삭제 원칙**: 저장소 등록 해제는 문서를 삭제하지 않는다. `repository.status = 'archived'`, ES 문서에 `repository_archived: true`를 세팅한다 (FR-ING-009 AC-3). 조사 이력의 보존이 이 제품의 목적이므로, 데이터 삭제는 저장소 폐기라는 명시적 결정에서만 일어난다.

**표식은 PR 문서와 커밋 문서 양쪽에 붙는다 (CR-013, DEV-028).** 4.2의 `prs-commits` 매핑에 `repository_archived`가 없었다. 매핑이 `dynamic: strict`라 없는 필드를 쓰려는 시도는 **거부되므로**, 그대로는 해제한 저장소의 커밋 문서에 표식을 붙일 방법이 없었다. FR-SRCH-002(SHA → PR)는 커밋 문서를 직접 결과로 내놓기 때문에, 표식 없는 커밋 문서는 해제된 저장소를 살아 있는 것처럼 보여 준다.

**필드 추가에는 재색인이 필요 없다 (CR-013, DEV-034).** 부트스트랩이 이미 있는 인덱스에 `put_mapping`으로 제자리 갱신한다. Elasticsearch에서 매핑에 새 필드를 더하는 것은 하위 호환 변경이기 때문이다. 재색인(FR-ING-008)이 필요한 것은 기존 필드의 **타입이나 분석기**를 바꿀 때이며, 그런 변경은 `put_mapping`이 거부하므로 조용히 통과하지 않는다.

**`changed_lines`도 같은 길로 더한다 (CR-053, DEV-386).** 매핑은 `put_mapping`으로 더하고, **이미
색인된 문서는 `update_by_query`로 소급한다.** 이것은 **색인 시점 계산**이므로 "조회 시점
`script`를 집계에 쓰지 않는다"는 6장 규율과 어긋나지 않는다. 소급하지 않으면 과거 PR이 전부
`unknown` 구간에 들어가는데, 그것은 "보강이 끝나지 않았다"는 `FR-STAT-005` AC-5의 뜻과 다른
사실이라 **화면이 거짓을 말하게 된다.** `WP-032`가 `put_mapping`으로 더한 서브필드가 과거
문서에서 비어 있어 검색이 조용히 적게 답한 것과 같은 자리다.

**기존 값은 `ctx._source`로 읽는다 (CR-056, DEV-452).** Painless에서 `additions`·`deletions`는
선언되지 않은 변수라 그대로 쓰면 소급 자체가 실패한다.

```painless
if (ctx._source.additions != null && ctx._source.deletions != null) {
  ctx._source.changed_lines = ctx._source.additions + ctx._source.deletions;
}
```

**두 값이 모두 있을 때만 쓴다.** 없는 문서는 보강이 끝나지 않은 것이고, 거기에 0을 채우면
`AC-5`가 가르라고 한 **모름과 0을 다시 합치게 된다** — `DEV-450`이 고친 것을 이 소급이
되돌리는 일이다. `_update_by_query`의 `query`에도 같은 조건을 걸어 대상을 좁힌다.

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
