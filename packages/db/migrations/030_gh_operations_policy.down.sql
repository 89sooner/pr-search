-- 030 되돌리기. **운영 승인·차단 이력과 실행권 확정 가드가 사라진다.**
--
-- 되돌리기 전에 GH_OPERATIONS_ENABLED=false로 실행을 끈다(런북 7.C). 가드가 사라지면 이전 앱 버전의 실행이 다시
-- 열리기 때문이다. 이 파일은 외부 상태를 복구하지 않는다 — 이미 수행한 GHE 조회는 되돌려지지 않는다.
-- 스냅숏의 activated_at(최초 승인 시각)은 029 트리거가 지우지 못하게 하므로 남는다. 다시 올려도 승인으로 승계하지 않는다.
-- audit_record의 행은 남는다(추가 전용).

DROP TRIGGER IF EXISTS gh_execution_policy_guard_trg ON gh_execution;
DROP FUNCTION IF EXISTS gh_execution_policy_guard();
ALTER TABLE gh_execution DROP COLUMN IF EXISTS policy_revision;

DROP FUNCTION IF EXISTS gh_operations_policy_apply(TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, BIGINT);

DROP TABLE IF EXISTS gh_operations_policy_revision;
DROP FUNCTION IF EXISTS gh_operations_policy_revision_immutable();
DROP TABLE IF EXISTS gh_operations_policy;

DROP TRIGGER IF EXISTS gh_capability_verification_policy_lock_trg ON gh_capability_verification;
DROP FUNCTION IF EXISTS gh_capability_verification_policy_lock();
DROP INDEX IF EXISTS gh_capability_verification_scope_idx;
ALTER TABLE gh_capability_verification DROP CONSTRAINT IF EXISTS gh_capability_verification_scope_chk;
ALTER TABLE gh_capability_verification DROP COLUMN IF EXISTS scope;
