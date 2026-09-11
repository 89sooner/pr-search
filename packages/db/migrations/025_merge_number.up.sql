-- M 번호 (WP-074 / CR-077 · CR-079, FR-SEQ-008, ADR-007 Clarification · ADR-023).
--
-- ## 새 표를 정본으로 만들지 않는다
--
-- M 번호는 `merge_seq`의 파생이고 **같은 행의 속성**이다. 별도 표로 떼면 두 값이
-- 다른 트랜잭션에서 갱신되어 언젠가 어긋난다 (데이터 모델 6장). 그래서 번호는
-- `merge_sequence`에 얹고, 진행 지점은 `sequence_space`에 얹는다.
--
-- 추가되는 세 표는 정본이 아니라 **근거·전달·관측**의 수명만 담당한다
-- (ENT-SEQ-005 · 006 · 007, 상세 설계 6절).
--
-- ## 과거 데이터를 채우지 않는다
--
-- 기존 행의 `merge_number`는 NULL로 시작한다. 기존 `pull_request_number`나 NULL을
-- 여기서 확정 근거로 승격하지 않는다 (AC-10, DEV-581). 원격 API·git 명령을
-- 마이그레이션에서 부르지 않는다.

-- ---------------------------------------------------------------- merge_sequence
ALTER TABLE merge_sequence
  ADD COLUMN merge_number        BIGINT,
  -- WP-075 예약. WP-074는 항상 NULL로 둔다.
  ADD COLUMN annotate_state      TEXT,
  ADD COLUMN annotated_at        TIMESTAMPTZ,
  -- 기존 `assigned_at`(서수 부여 시각)과 분리한다. DB 시계로 찍는다.
  ADD COLUMN mnumber_assigned_at TIMESTAMPTZ;

ALTER TABLE merge_sequence
  -- 1..2^53-1. JavaScript safe integer 상한이며 그 밖의 채번은 `number_capacity_exceeded`다.
  ADD CONSTRAINT merge_sequence_merge_number_range_chk
    CHECK (merge_number IS NULL OR (merge_number >= 1 AND merge_number <= 9007199254740991)),
  -- 직접 푸시 커밋은 번호를 받지 않는다 (AC-1).
  ADD CONSTRAINT merge_sequence_merge_number_pr_chk
    CHECK (merge_number IS NULL OR pull_request_number IS NOT NULL),
  ADD CONSTRAINT merge_sequence_annotate_state_chk
    CHECK (annotate_state IS NULL OR annotate_state IN ('done', 'mismatch', 'failed', 'disabled')),
  -- 번호 없는 표기 상태는 없다.
  ADD CONSTRAINT merge_sequence_annotate_requires_number_chk
    CHECK (annotate_state IS NULL OR merge_number IS NOT NULL);

-- 같은 공간·에폭에서 번호는 유일하고 (AC-2), 번호를 받은 PR도 유일하다 (PR당 하나).
CREATE UNIQUE INDEX merge_sequence_merge_number_uk
  ON merge_sequence (repository_id, base_branch, seq_epoch, merge_number)
  WHERE merge_number IS NOT NULL;

CREATE UNIQUE INDEX merge_sequence_numbered_pr_uk
  ON merge_sequence (repository_id, base_branch, seq_epoch, pull_request_number)
  WHERE merge_number IS NOT NULL;

-- ---------------------------------------------------------------- sequence_space
ALTER TABLE sequence_space
  -- 확인을 마친 마지막 `merge_seq`. 채번은 이 다음 행부터 이어 간다 (AC-3).
  ADD COLUMN mnumber_head_seq       BIGINT NOT NULL DEFAULT 0,
  -- 마지막으로 부여한 M 번호.
  ADD COLUMN mnumber_head           BIGINT NOT NULL DEFAULT 0,
  -- checkpoint 다음의 미확정·충돌 행. 없으면 셋 다 NULL이다.
  ADD COLUMN mnumber_blocked_seq    BIGINT,
  ADD COLUMN mnumber_blocked_reason TEXT,
  ADD COLUMN mnumber_blocked_since  TIMESTAMPTZ;

ALTER TABLE sequence_space
  -- 번호 수 ≤ 확인한 행 수 ≤ 채번된 행 수. 에폭 상향은 셋을 함께 0으로 되돌린다.
  ADD CONSTRAINT sequence_space_mnumber_checkpoint_chk
    CHECK (mnumber_head >= 0 AND mnumber_head <= mnumber_head_seq AND mnumber_head_seq <= head_seq),
  ADD CONSTRAINT sequence_space_mnumber_blocked_chk
    CHECK (
      (mnumber_blocked_seq IS NULL AND mnumber_blocked_reason IS NULL AND mnumber_blocked_since IS NULL)
      OR (mnumber_blocked_seq IS NOT NULL AND mnumber_blocked_reason IS NOT NULL AND mnumber_blocked_since IS NOT NULL)
    ),
  ADD CONSTRAINT sequence_space_mnumber_blocked_reason_len_chk
    CHECK (mnumber_blocked_reason IS NULL OR char_length(mnumber_blocked_reason) <= 64);

-- ---------------------------------------------------------------- ENT-SEQ-005
-- PR 확정 · 직접 푸시 확정 · 미확정의 **근거**. 행이 없으면 미확정으로 해석한다.
CREATE TABLE mnumber_evidence (
  repository_id     BIGINT      NOT NULL,
  base_branch       TEXT        NOT NULL,
  seq_epoch         INT         NOT NULL,
  merge_seq         BIGINT      NOT NULL,
  -- 부모 행의 SHA와 트랜잭션에서 대조한다. 에폭이 바뀌어 다른 커밋이 같은 서수를 받으면 근거가 무효다.
  commit_sha        TEXT        NOT NULL,
  state             TEXT        NOT NULL,
  pr_number         INT,
  reason            TEXT,
  evidence_version  BIGINT      NOT NULL DEFAULT 1,
  source_kind       TEXT        NOT NULL,
  source_pr_version BIGINT,
  merged_at         TIMESTAMPTZ,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  first_pending_at  TIMESTAMPTZ,
  -- 허용 필드만 담는다 (상세 설계 6.2). 제목·본문·작성자·raw payload·URL·토큰은 금지다.
  proof             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (repository_id, base_branch, seq_epoch, merge_seq),
  FOREIGN KEY (repository_id, base_branch, seq_epoch, merge_seq)
    REFERENCES merge_sequence (repository_id, base_branch, seq_epoch, merge_seq)
    ON DELETE RESTRICT,
  CONSTRAINT mnumber_evidence_state_chk
    CHECK (state IN ('unresolved', 'pr_confirmed', 'direct_confirmed')),
  -- `authoritative_absence`는 2.2의 근거가 닫히기 전 production에서 만들지 않는다 (DEV-581).
  -- 격리 시험만 직접 주입한다.
  CONSTRAINT mnumber_evidence_source_chk
    CHECK (source_kind IN ('pr_detail', 'verified_snapshot', 'unresolved_lookup', 'authoritative_absence')),
  CONSTRAINT mnumber_evidence_pr_chk
    CHECK ((state = 'pr_confirmed') = (pr_number IS NOT NULL)),
  CONSTRAINT mnumber_evidence_reason_chk
    CHECK (state <> 'unresolved' OR reason IS NOT NULL),
  CONSTRAINT mnumber_evidence_merged_at_chk
    CHECK (state <> 'pr_confirmed' OR merged_at IS NOT NULL),
  CONSTRAINT mnumber_evidence_version_chk
    CHECK (evidence_version >= 1)
);

-- ---------------------------------------------------------------- ENT-SEQ-006
-- M 경로에 한정된 durable inbox/outbox. `raw_event.processed_at`을 겹쳐 쓰지 않는다.
CREATE TABLE sequence_work (
  work_key             TEXT        PRIMARY KEY,
  kind                 TEXT        NOT NULL,
  repository_id        BIGINT      NOT NULL,
  base_branch          TEXT        NOT NULL,
  -- `refresh`만 NULL을 허용한다. 나머지는 생성 시점의 에폭에 묶인다.
  seq_epoch            INT,
  requested_generation BIGINT      NOT NULL DEFAULT 1,
  completed_generation BIGINT      NOT NULL DEFAULT 0,
  payload              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  state                TEXT        NOT NULL DEFAULT 'ready',
  available_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until          TIMESTAMPTZ,
  lease_token          UUID,
  attempt_count        INT         NOT NULL DEFAULT 0,
  last_reason          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sequence_work_kind_chk
    CHECK (kind IN ('refresh', 'reconcile', 'materialize', 'announce')),
  CONSTRAINT sequence_work_state_chk
    CHECK (state IN ('ready', 'leased', 'retry', 'parked', 'done', 'obsolete')),
  CONSTRAINT sequence_work_generation_chk
    CHECK (requested_generation >= 0 AND completed_generation >= 0
           AND completed_generation <= requested_generation),
  -- `leased`일 때만 lease 필드 둘이 있고, 나머지 상태에서는 둘 다 NULL이다.
  CONSTRAINT sequence_work_lease_chk
    CHECK (
      (state = 'leased' AND lease_until IS NOT NULL AND lease_token IS NOT NULL)
      OR (state <> 'leased' AND lease_until IS NULL AND lease_token IS NULL)
    ),
  CONSTRAINT sequence_work_epoch_chk
    CHECK (kind = 'refresh' OR seq_epoch IS NOT NULL),
  CONSTRAINT sequence_work_attempt_chk
    CHECK (attempt_count >= 0),
  CONSTRAINT sequence_work_payload_size_chk
    CHECK (pg_column_size(payload) <= 65536)
);

-- 실행 대상 조회. `ready`·`retry`만 본다.
CREATE INDEX sequence_work_due_idx
  ON sequence_work (available_at, work_key)
  WHERE state IN ('ready', 'retry');

-- 만료 lease 회수.
CREATE INDEX sequence_work_lease_idx
  ON sequence_work (lease_until)
  WHERE state = 'leased';

-- 공간 단위의 covered refresh 완료·기존 work 조회.
CREATE INDEX sequence_work_space_idx
  ON sequence_work (repository_id, base_branch, kind, state);

-- ---------------------------------------------------------------- ENT-SEQ-007
-- 단계별 읽기 전용 관측 자료의 원천. 30일 보존이며 batch 역할의 bounded cleanup이 지운다.
CREATE TABLE sequence_latency_sample (
  sample_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_key                TEXT        NOT NULL,
  attempt                 INT         NOT NULL DEFAULT 1,
  repository_id           BIGINT      NOT NULL,
  base_branch             TEXT        NOT NULL,
  seq_epoch               INT         NOT NULL,
  pr_number               INT,
  delivery_id             TEXT,
  trigger_kind            TEXT        NOT NULL,
  outcome                 TEXT        NOT NULL,
  -- 수신 시각은 원본 `raw_event` 값이고, 나머지 stage 시각은 수행 사실 뒤 DB 시계다.
  -- 원인 push의 delivery 연결이 증명되지 않으면 `received_at`은 NULL로 남는다.
  received_at             TIMESTAMPTZ,
  attempt_started_at      TIMESTAMPTZ,
  mirror_completed_at     TIMESTAMPTZ,
  sequence_assigned_at    TIMESTAMPTZ,
  mnumber_assigned_at     TIMESTAMPTZ,
  search_observed_at      TIMESTAMPTZ,
  last_search_absent_at   TIMESTAMPTZ,
  observation_attempts    INT         NOT NULL DEFAULT 0,
  reason                  TEXT,
  search_poll_interval_ms INT,
  observed_index_uuid     TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sequence_latency_sample_trigger_chk
    CHECK (trigger_kind IN ('new_squash', 'backfill', 'retry', 'reassign', 'reconcile')),
  CONSTRAINT sequence_latency_sample_outcome_chk
    CHECK (outcome IN ('pending', 'failed', 'assigned', 'visible', 'skipped')),
  -- PostgreSQL 15+: NULL PR도 같은 attempt에서 중복 생성되지 않는다.
  CONSTRAINT sequence_latency_sample_attempt_uk
    UNIQUE NULLS NOT DISTINCT (work_key, attempt, seq_epoch, pr_number)
);

CREATE INDEX sequence_latency_sample_space_idx
  ON sequence_latency_sample (repository_id, base_branch, received_at);

CREATE INDEX sequence_latency_sample_outcome_idx
  ON sequence_latency_sample (outcome, attempt_started_at);

-- 관측 완료 대기 표본 조회 (observer 재시작 복구).
CREATE INDEX sequence_latency_sample_unobserved_idx
  ON sequence_latency_sample (created_at)
  WHERE outcome = 'assigned' AND search_observed_at IS NULL;

-- ---------------------------------------------------------------- PR 스냅숏 조회
-- 증거 수집이 머지 커밋 SHA로 스냅숏 후보를 찾는다 (상세 설계 5.1). 표현식 인덱스가
-- 없으면 저장소의 스냅숏 전체를 훑는다.
CREATE INDEX pull_request_snapshot_merge_commit_idx
  ON pull_request_snapshot (repository_id, (document ->> 'merge_commit_sha'));

-- ---------------------------------------------------------------- 권한
-- 022의 규율 그대로: 새 표는 자기 마이그레이션이 권한을 준다 (DEV-517).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  mnumber_evidence, sequence_work, sequence_latency_sample
TO prs_app;
