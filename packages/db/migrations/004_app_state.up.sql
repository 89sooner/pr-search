-- 애플리케이션 상태 (데이터 모델 3.4). ENT-CORE-006, ENT-ING-004, ENT-CORE-007.

CREATE TABLE saved_search (
  saved_search_id BIGSERIAL   PRIMARY KEY,
  owner_user_id   TEXT        NOT NULL REFERENCES app_user(user_id),
  name            TEXT        NOT NULL,
  query           TEXT        NOT NULL,
  visibility      TEXT        NOT NULL DEFAULT 'private',
  team_id         BIGINT      REFERENCES team(team_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at     TIMESTAMPTZ,
  CONSTRAINT saved_search_visibility_chk CHECK (visibility IN ('private', 'team')),
  UNIQUE (owner_user_id, name)
);

CREATE TABLE job (
  job_id       BIGSERIAL   PRIMARY KEY,
  type         TEXT        NOT NULL,
  target       TEXT        NOT NULL,
  state        TEXT        NOT NULL,
  progress     JSONB       NOT NULL DEFAULT '{}',
  cursor       JSONB,
  requested_by TEXT        NOT NULL,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  error        TEXT,
  CONSTRAINT job_type_chk CHECK (type IN (
    'backfill', 'reconcile', 'reindex', 'sequence_assign',
    'sequence_integrity', 'link_rebuild', 'export'
  )),
  CONSTRAINT job_state_chk CHECK (state IN (
    'queued', 'running', 'paused', 'completed', 'failed', 'cancelled'
  ))
);

-- 같은 (type, target)에 활성 잡은 동시에 하나뿐이다 (FR-ADMIN-002 AC-4).
CREATE UNIQUE INDEX job_active_uk ON job (type, target)
  WHERE state IN ('queued', 'running', 'paused');

-- 월별 파티션, 1년 보존 (NFR-006). 만료는 관리 롤이 파티션 드롭으로 수행한다.
--
-- DEV-005: 데이터 모델 3.4는 PRIMARY KEY (audit_id)로 적혀 있으나 PostgreSQL은
-- 파티션 테이블의 유니크 제약이 파티션 키를 포함하도록 요구한다. 그대로 쓰면
-- 마이그레이션이 실행되지 않으므로 (audit_id, occurred_at)으로 둔다.
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
) PARTITION BY RANGE (occurred_at);

CREATE INDEX audit_user_idx   ON audit_record (user_id, occurred_at DESC);
CREATE INDEX audit_action_idx ON audit_record (action, occurred_at DESC);
