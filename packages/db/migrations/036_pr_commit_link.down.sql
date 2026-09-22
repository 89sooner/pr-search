-- 036 되돌리기 (CR-116).
--
-- 관계 정본 세 표와 복구 잡 종류를 회수한다. **Elasticsearch는 건드리지 않는다** —
-- 이 마이그레이션은 PostgreSQL 스키마만 다루며, 색인에 이미 쓰인
-- `pull_request_numbers`·`pr_links_generation`은 그대로 남는다.
--
-- 되돌린 뒤 구버전 워커가 다시 돌면 합집합 투영이 되살아나 오염이 재발한다.
-- 그 위험은 운영 절차(RB)에 적혀 있으며 스키마로 막을 수 있는 것이 아니다.

DELETE FROM job WHERE type = 'pr_link_repair';

ALTER TABLE job DROP CONSTRAINT job_type_chk;
ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_reassign',
  'sequence_integrity', 'link_rebuild', 'export', 'snapshot_bootstrap', 'sequence_reproject',
  'mnumber_tag_reconcile'
));

DROP TABLE IF EXISTS commit_link_state;
DROP TABLE IF EXISTS pull_request_link_observation;
DROP TABLE IF EXISTS pull_request_commit_link;
