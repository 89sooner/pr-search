-- 되돌리기 전에 새 유형의 행이 남아 있으면 CHECK를 다시 걸 수 없다.
-- 남은 행을 조용히 지우지 않는다 — 되돌림이 잡 이력을 삼키면 안 된다.
-- 그런 행이 있으면 이 마이그레이션은 실패해야 한다.

ALTER TABLE job DROP CONSTRAINT job_type_chk;

ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign',
  'sequence_integrity', 'link_rebuild', 'export'
));
