-- 수집 레인 (데이터 모델 3.1). ENT-ING-001 RawEvent, ENT-ING-002 DeadLetter.
-- raw_event는 월별 파티션이며 보존 만료는 파티션 드롭으로 처리한다 (OD-003: 3년).

CREATE TABLE raw_event (
  delivery_id     TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  action          TEXT,
  repository_id   BIGINT,
  received_at     TIMESTAMPTZ NOT NULL,
  payload         JSONB       NOT NULL,
  payload_hash    TEXT        NOT NULL,
  queued_at       TIMESTAMPTZ,
  processed_at    TIMESTAMPTZ,
  correlation_id  UUID        NOT NULL,
  PRIMARY KEY (delivery_id, received_at)
) PARTITION BY RANGE (received_at);

CREATE INDEX raw_event_outbox_idx ON raw_event (queued_at) WHERE processed_at IS NULL;
CREATE INDEX raw_event_repo_idx   ON raw_event (repository_id, received_at DESC);

CREATE TABLE dead_letter (
  dead_letter_id  BIGSERIAL   PRIMARY KEY,
  delivery_id     TEXT        NOT NULL,
  stage           TEXT        NOT NULL,
  error           TEXT        NOT NULL,
  retry_count     INT         NOT NULL DEFAULT 0,
  reprocess_count INT         NOT NULL DEFAULT 0,
  state           TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dead_letter_stage_chk CHECK (stage IN ('enrich', 'project', 'sequence', 'link')),
  CONSTRAINT dead_letter_state_chk CHECK (state IN ('pending', 'reprocessing', 'held'))
);

CREATE INDEX dead_letter_state_idx ON dead_letter (state, created_at);
