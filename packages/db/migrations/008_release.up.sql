-- 릴리스 앵커 (CR-028, DEV-142). ENT-REL-001.
-- ADR-004: Elasticsearch는 PostgreSQL만으로 재구축 가능해야 한다. 포함 판정과
-- 릴리스 앵커 해석은 이 표를 읽고, prs-releases는 이 표의 투영이다.

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

-- 포함 판정: repository + base_branch + merge_seq >= C.merge_seq (FR-REL-002 AC-5).
CREATE INDEX release_containment_idx
  ON release (repository_id, base_branch, merge_seq)
  WHERE merge_seq IS NOT NULL;

-- 005가 만든 애플리케이션 롤에 새 표의 권한을 잇는다. 잊으면 워커가
-- 마이그레이션은 통과하고 첫 upsert에서 permission denied로 죽는다.
GRANT SELECT, INSERT, UPDATE, DELETE ON release TO prs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prs_app;
