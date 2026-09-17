-- 031 M 번호 운영자 확인서 (CR-100 / WP-088, FR-SEQ-008 AC-15, ADR-023 보완, DEV-581 후속).
--
-- ## 무엇을 더하는가
--
-- | 대상 | 변경 |
-- | --- | --- |
-- | mnumber_evidence.source_kind | `operator_attestation`을 허용한다 — 운영자 확인서가 만든 direct_confirmed의 출처 |
-- | mnumber_attestation (ENT-SEQ-008) | (저장소, 브랜치, 에폭)마다 하나의 활성 확인서. 범위(through_seq)·유예(grace_seconds)·행위자·사유·철회 |
--
-- ## 왜 표 하나가 더 필요한가
--
-- 공식 GHE 읽기 계약에는 「이 커밋은 PR 머지가 아니다」를 확정하는 부재 증서가 없다(DEV-581).
-- 그래서 production은 빈 조회를 `negative_evidence_unavailable`로 남기고 그 앞에서 멈췄다. 사내
-- squash-only 저장소에서는 직접 푸시 초기 커밋 하나가 이후 채번 전체를 막았고, 운영자가 SQL로
-- 근거를 손으로 넣어야 했다. 확인서는 그 판단을 **행위자·사유·범위·시각과 함께** 남기는 정식 경로다.
-- 설계 2.2가 열어 둔 「사내 승인된 증거 소스」가 이것이다.
--
-- ## 확인서가 바꾸지 않는 것
--
-- 이미 부여된 번호는 옮기지 않는다(AC-3). 확인서는 에폭에 묶이므로 force-push로 에폭이 오르면 효력이
-- 없다(ADR-007). 일시 실패(`fetch_failed`)·부분 열거(`partial_lookup`)·조회 전(`pr_evidence_pending`)은
-- 확인서가 덮지 않는다 — 그것은 「모른다」이지 「없다」가 아니다.

ALTER TABLE mnumber_evidence DROP CONSTRAINT mnumber_evidence_source_chk;
ALTER TABLE mnumber_evidence
  ADD CONSTRAINT mnumber_evidence_source_chk
    CHECK (source_kind IN ('pr_detail', 'verified_snapshot', 'unresolved_lookup', 'authoritative_absence', 'operator_attestation'));

-- ---------------------------------------------------------------- ENT-SEQ-008
CREATE TABLE mnumber_attestation (
  attestation_id BIGSERIAL   PRIMARY KEY,
  repository_id  BIGINT      NOT NULL,
  base_branch    TEXT        NOT NULL,
  -- 확인서는 에폭에 묶인다. 에폭이 오르면 새 확인서가 필요하다.
  seq_epoch      INT         NOT NULL,
  -- NULL이면 이 에폭의 모든 서수. 값이 있으면 그 서수까지만(포함) 덮는다.
  through_seq    BIGINT,
  -- 커밋이 브랜치에 오른 시각(committed_at)부터 이 시간이 지난 항목에만 적용한다.
  -- 시간 경과 자체는 근거가 아니다(AC-10) — 늦게 도착하는 PR 정보가 먼저 확정될 기회를 주는 안전 여유다.
  grace_seconds  INT         NOT NULL,
  actor          TEXT        NOT NULL,
  reason         TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at     TIMESTAMPTZ,
  revoked_by     TEXT,
  revoke_reason  TEXT,
  FOREIGN KEY (repository_id, base_branch)
    REFERENCES sequence_space (repository_id, base_branch)
    ON DELETE CASCADE,
  CONSTRAINT mnumber_attestation_epoch_chk
    CHECK (seq_epoch >= 1),
  CONSTRAINT mnumber_attestation_through_chk
    CHECK (through_seq IS NULL OR through_seq >= 1),
  -- 0초(즉시)부터 30일까지.
  CONSTRAINT mnumber_attestation_grace_chk
    CHECK (grace_seconds >= 0 AND grace_seconds <= 2592000),
  CONSTRAINT mnumber_attestation_actor_chk
    CHECK (char_length(actor) BETWEEN 1 AND 128),
  CONSTRAINT mnumber_attestation_reason_chk
    CHECK (char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT mnumber_attestation_revoke_chk
    CHECK (
      (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL)
    ),
  CONSTRAINT mnumber_attestation_revoked_by_chk
    CHECK (revoked_by IS NULL OR char_length(revoked_by) BETWEEN 1 AND 128),
  CONSTRAINT mnumber_attestation_revoke_reason_chk
    CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 1 AND 500)
);

-- 공간·에폭마다 활성 확인서는 하나다. 범위나 유예를 바꾸려면 철회하고 다시 만든다 — 이력이 남는다.
CREATE UNIQUE INDEX mnumber_attestation_active_uk
  ON mnumber_attestation (repository_id, base_branch, seq_epoch)
  WHERE revoked_at IS NULL;

-- prs_app은 만들고 철회만 한다. 철회는 세 열의 UPDATE뿐이며 본문(범위·유예·사유)은 바꾸지 못한다.
GRANT SELECT, INSERT ON mnumber_attestation TO prs_app;
GRANT UPDATE (revoked_at, revoked_by, revoke_reason) ON mnumber_attestation TO prs_app;
GRANT USAGE, SELECT ON SEQUENCE mnumber_attestation_attestation_id_seq TO prs_app;
GRANT ALL ON mnumber_attestation TO prs_admin;
GRANT USAGE, SELECT ON SEQUENCE mnumber_attestation_attestation_id_seq TO prs_admin;
