-- 031 회수 (CR-100 / WP-088).
--
-- 확인서가 만든 근거 행(`source_kind = 'operator_attestation'`)은 옛 CHECK 제약에 맞지 않으므로 함께 지운다.
-- 그 행은 전부 `direct_confirmed`라 번호를 갖지 않고, 확인서로 지나간 서수는 이미 checkpoint 뒤라 회차가 다시 보지
-- 않는다 — 지워도 번호·checkpoint는 그대로이고 근거 행만 사라진다(AC-3). 그 서수를 다시 판정하게 하려면 에폭
-- 재채번이 필요하다. 감사 기록(audit_record)은 남는다.

DELETE FROM mnumber_evidence WHERE source_kind = 'operator_attestation';

ALTER TABLE mnumber_evidence DROP CONSTRAINT mnumber_evidence_source_chk;
ALTER TABLE mnumber_evidence
  ADD CONSTRAINT mnumber_evidence_source_chk
    CHECK (source_kind IN ('pr_detail', 'verified_snapshot', 'unresolved_lookup', 'authoritative_absence'));

DROP TABLE mnumber_attestation;
