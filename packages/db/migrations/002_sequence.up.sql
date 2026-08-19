-- 머지 시퀀스 (데이터 모델 3.2). ENT-SEQ-001~004.
-- 시퀀스 값은 (repository_id, base_branch, seq_epoch) 공간 안에서만 의미가 있다 (ADR-007).

CREATE TABLE sequence_space (
  repository_id    BIGINT      NOT NULL,
  base_branch      TEXT        NOT NULL,
  seq_epoch        INT         NOT NULL DEFAULT 1,
  head_sha         TEXT,
  head_seq         BIGINT      NOT NULL DEFAULT 0,
  state            TEXT        NOT NULL DEFAULT 'ok',
  last_assigned_at TIMESTAMPTZ,
  last_error       TEXT,
  PRIMARY KEY (repository_id, base_branch),
  CONSTRAINT sequence_space_state_chk CHECK (state IN ('ok', 'stale', 'reassigning', 'unknown'))
);

CREATE TABLE merge_sequence (
  repository_id        BIGINT      NOT NULL,
  base_branch          TEXT        NOT NULL,
  seq_epoch            INT         NOT NULL,
  merge_seq            BIGINT      NOT NULL,
  commit_sha           TEXT        NOT NULL,
  pull_request_number  INT,
  committed_at         TIMESTAMPTZ NOT NULL,
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, base_branch, seq_epoch, merge_seq)
);

CREATE UNIQUE INDEX merge_sequence_commit_uk
  ON merge_sequence (repository_id, base_branch, seq_epoch, commit_sha);

CREATE INDEX merge_sequence_pr_idx
  ON merge_sequence (repository_id, pull_request_number)
  WHERE pull_request_number IS NOT NULL;

CREATE TABLE safe_marker (
  marker_id     BIGSERIAL   PRIMARY KEY,
  repository_id BIGINT      NOT NULL,
  base_branch   TEXT        NOT NULL,
  seq_epoch     INT         NOT NULL,
  merge_seq     BIGINT      NOT NULL,
  note          TEXT        CHECK (char_length(note) <= 500),
  created_by    TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ
);

-- 저장소·브랜치당 현재 표식은 하나뿐이다. 이전 표식은 superseded_at으로 이력만 남긴다.
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
