-- 잡 유형 `sequence_reassign` 추가 (CR-033, DEV-172 / DEV-128 해소).
--
-- API-ADM-007의 202 응답은 `type: "sequence_reassign"`을 안정 계약으로 낸다.
-- 그런데 004의 `job_type_chk`는 `sequence_assign`까지만 허용해, 수동 재채번이
-- 잡 행을 만드는 순간 CHECK 위반이었다. 계약이 먼저 그 이름을 쓰고 있으므로
-- 계약을 코드에 맞추지 않고 **스키마를 넓힌다**.
--
-- 기존 마이그레이션(004)은 고치지 않는다. 이미 적용된 환경에서 004를 고쳐도
-- 다시 돌지 않으므로, 넓히는 변경은 언제나 새 마이그레이션이어야 한다.

ALTER TABLE job DROP CONSTRAINT job_type_chk;

ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_reassign',
  'sequence_integrity', 'link_rebuild', 'export'
));
