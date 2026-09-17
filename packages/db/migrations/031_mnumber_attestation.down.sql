-- 031 회수 (CR-100 / WP-088).
--
-- 확인서가 만든 근거 행(`source_kind = 'operator_attestation'`)은 옛 CHECK 제약에 맞지 않으므로 함께 지운다.
-- 그 행은 전부 `direct_confirmed`라 번호를 갖지 않는다 — 지우면 그 서수가 다시 미확정이 되어 채번이 그 앞에서
-- 멈출 뿐, 이미 부여된 번호는 바뀌지 않는다(AC-3). 감사 기록(audit_record)은 남는다.

DELETE FROM mnumber_evidence WHERE source_kind = 'operator_attestation';

ALTER TABLE mnumber_evidence DROP CONSTRAINT mnumber_evidence_source_chk;
ALTER TABLE mnumber_evidence
  ADD CONSTRAINT mnumber_evidence_source_chk
    CHECK (source_kind IN ('pr_detail', 'verified_snapshot', 'unresolved_lookup', 'authoritative_absence'));

DROP TABLE mnumber_attestation;
