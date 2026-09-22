-- M 번호 lightweight 태그 (WP-100 / CR-115, FR-SEQ-012, ADR-026).
--
-- ## 무엇을 더하나
--
-- 1. `merge_sequence`에 태그 결과 열을 얹는다. 표기(`annotate_*`, 025·027)와 같은 규율이다 —
--    태그는 번호의 **파생 쓰기**이고 그 결과는 번호 행의 속성이다. 별도 표로 떼면 번호와
--    태그 상태가 다른 트랜잭션에서 갱신되어 언젠가 어긋난다(데이터 모델 6장).
--    `tag_state`가 NULL이면 아직 시도하지 않은 행이다. `done`은 원격에 같은 SHA의 태그가
--    있음을 확인한 것이고, `conflict`는 같은 이름의 태그가 **다른 SHA**(또는 annotated 태그)를
--    가리켜 손대지 않은 것이며, `failed`·`disabled`·`unknown`은 표기와 같은 뜻이다.
-- 2. `repository`에 운영자의 저장소별 스위치 `tag_enabled`(기본 true — 「개별 해제」다,
--    026의 근거 그대로)와, 태그 잡이 403·404를 받아 스스로 멈춘 사실(`tag_blocked_*`)을 나눠
--    둔다. 전역 스위치 `MNUMBER_TAG_ENABLED`의 기본은 false라 이 마이그레이션만으로는 GHE에
--    아무것도 쓰지 않는다.
-- 3. `sequence_work.kind`에 `tag`를 더한다 — 채번 트랜잭션이 남기는 「이 PR의 번호를 원격
--    태그로 굳히라」는 durable 의도이며 PR당 한 행이다(`materialize`와 같은 키 규칙).
-- 4. `job.type`에 `mnumber_tag_reconcile`을 더한다 — 정본 ↔ 원격 태그 대조 잡이다.
--
-- ## 무엇을 바꾸지 않나
--
-- `merge_number`·`merge_seq`·에폭·head의 값과 제약은 그대로다. 기존 work·잡 행도 그대로다.
-- 새 GRANT는 없다 — 열 추가는 표 권한(022·025)을 그대로 따른다.

-- ---------------------------------------------------------------- merge_sequence
ALTER TABLE merge_sequence
  ADD COLUMN tag_state          TEXT,
  ADD COLUMN tagged_at          TIMESTAMPTZ,
  ADD COLUMN tag_attempt_id     UUID,
  ADD COLUMN tag_result_reason  TEXT,
  -- `conflict`의 근거: 원격 태그가 가리키던 SHA(annotated 태그면 태그 객체의 SHA).
  ADD COLUMN tag_found_sha      TEXT;

ALTER TABLE merge_sequence
  ADD CONSTRAINT merge_sequence_tag_state_chk
    CHECK (tag_state IS NULL OR tag_state IN ('done', 'conflict', 'failed', 'disabled', 'unknown')),
  -- 번호 없는 태그 상태는 없다 — 태그 이름이 번호에서 나온다.
  ADD CONSTRAINT merge_sequence_tag_requires_number_chk
    CHECK (tag_state IS NULL OR merge_number IS NOT NULL),
  ADD CONSTRAINT merge_sequence_tag_reason_len_chk
    CHECK (tag_result_reason IS NULL OR char_length(tag_result_reason) <= 200),
  ADD CONSTRAINT merge_sequence_tag_found_sha_chk
    CHECK (tag_found_sha IS NULL OR tag_found_sha ~ '^[0-9a-f]{40}$');

-- ---------------------------------------------------------------- repository
ALTER TABLE repository
  -- FR-SEQ-012 AC-9. 꺼진 저장소는 채번은 계속하고 태그만 만들지 않는다.
  ADD COLUMN tag_enabled        BOOLEAN NOT NULL DEFAULT true,
  -- 권한 오류(403·404)로 태그 잡이 스스로 멈춘 시각과 사유. 운영자 정책과 섞지 않는다.
  ADD COLUMN tag_blocked_at     TIMESTAMPTZ,
  ADD COLUMN tag_blocked_reason TEXT;

ALTER TABLE repository
  ADD CONSTRAINT repository_tag_blocked_chk
    CHECK ((tag_blocked_at IS NULL) = (tag_blocked_reason IS NULL)),
  ADD CONSTRAINT repository_tag_blocked_reason_len_chk
    CHECK (tag_blocked_reason IS NULL OR char_length(tag_blocked_reason) <= 200);

CREATE INDEX repository_tag_enabled_idx
  ON repository (repository_id)
  WHERE tag_enabled;

-- ---------------------------------------------------------------- durable work · 잡
ALTER TABLE sequence_work DROP CONSTRAINT sequence_work_kind_chk;
ALTER TABLE sequence_work ADD CONSTRAINT sequence_work_kind_chk
  CHECK (kind IN ('refresh', 'reconcile', 'materialize', 'announce', 'project', 'tag'));

ALTER TABLE job DROP CONSTRAINT job_type_chk;
ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_reassign',
  'sequence_integrity', 'link_rebuild', 'export', 'snapshot_bootstrap', 'sequence_reproject',
  'mnumber_tag_reconcile'
));
