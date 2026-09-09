-- WP-044 / CR-072: only complete files are published, tied to job retention.
CREATE TABLE search_export (
  job_id BIGINT PRIMARY KEY REFERENCES job(job_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  scope_version BIGINT NOT NULL,
  repository_ids BIGINT[] NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'json')),
  plan JSONB NOT NULL,
  content TEXT,
  row_count INTEGER CHECK (row_count BETWEEN 0 AND 100000)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON search_export TO prs_app;
