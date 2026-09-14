-- 030 GitHub Operations 운영 정책 — 운영 승인·capability 차단의 현재 상태와 revision 이력
-- (REL-007 / WP-080, CR-090, FR-GH-011 AC-6~AC-10 · FR-GH-009 AC-8 · FR-AUTH-004 AC-6 예외, ENT-GH-013 · ENT-GH-014).
--
-- additive이며 001~029를 건드리지 않는다. 기존 표에는 열·제약·트리거만 더하고 과거 행을 다시 쓰지 않는다.
--
-- ## 세 사실
--
-- | 사실 | 표 | 쓰는 주체 |
-- | --- | --- | --- |
-- | 검증 기록 | gh_capability_verification (029) | 실행기 (prs_app INSERT). 이 판은 배포 범위(scope) 열을 더한다 |
-- | 운영 승인·차단 | gh_operations_policy (현재 상태) · gh_operations_policy_revision (이력) | gh_operations_policy_apply 함수만 |
-- | 실행 허용 | 저장하지 않는다 | 요청 수락·claim이 `@prs/gh-cli`의 decideExecution으로 계산 |
--
-- ## 왜 함수인가
--
-- 운영자의 결정은 search-api(prs_app)를 거쳐 들어오지만 prs_app에 정책 표의 UPDATE를 주면 감사·revision 없이 상태를
-- 바꿀 수 있다. 그렇다고 search-api에 prs_admin 자격을 배포하지 않는다(보안 문서 — 관리 연결은 보존 잡 전용). 그래서
-- 대상·인자·권한·search_path를 고정한 SECURITY DEFINER 함수 하나만 prs_app에 EXECUTE로 준다. prs_app은 표를 읽기만 한다.
-- 이 경계가 막는 것은 **애플리케이션 롤의 우회**다. 소유자(prs_admin)·superuser의 직접 변경은 이 경계 밖이다.
--
-- ## 직렬화 지점 — advisory lock `gh:policy:<scope>`
--
-- | 누가 | 모드 | 왜 |
-- | --- | --- | --- |
-- | 정책 변경 (함수) | 배타 | 한 범위의 변경은 한 번에 하나 — 기대 revision 대조와 쓰기 사이에 끼어들 수 없다 |
-- | 실행기 검증 기록 INSERT (트리거) | 공유 | 승인이 「가장 최근 기록」을 읽는 동안 새 기록이 커밋되지 않는다 |
-- | 실행권 확정 queued→running (트리거) | 공유 | 차단이 커밋된 뒤에는 새 실행권이 나가지 않는다 |
--
-- advisory lock 함수는 표 권한이 필요 없고(행 잠금 FOR SHARE는 UPDATE 권한이 필요하다), 트랜잭션이 끝나면 풀린다.
-- 대기 중인 배타 요청 뒤에 새 공유 요청이 선다(격리 DB 실측). 키는 advisory-lock.ts의 관례대로 hashtext(문자열)다.

-- ── 검증 기록의 배포 범위 ─────────────────────────────────────────────

ALTER TABLE gh_capability_verification ADD COLUMN scope TEXT;

-- 실행기의 새 기록은 배포 범위를 반드시 적는다. 과거 행은 검사하지 않는다(NOT VALID) — 다시 쓰지 않기 위해서다.
-- 범위가 없는 과거 실행기 기록은 운영 승인의 근거가 될 수 없다(어느 배포의 기록인지 모른다).
ALTER TABLE gh_capability_verification ADD CONSTRAINT gh_capability_verification_scope_chk
  CHECK (checked_by <> 'gh-executor' OR (scope IS NOT NULL AND char_length(scope) BETWEEN 1 AND 260)) NOT VALID;

CREATE INDEX gh_capability_verification_scope_idx
  ON gh_capability_verification (scope, checked_at DESC, verification_id DESC)
  WHERE checked_by = 'gh-executor';

CREATE FUNCTION gh_capability_verification_policy_lock() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.scope IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtext('gh:policy:' || NEW.scope));
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER gh_capability_verification_policy_lock_trg
  BEFORE INSERT ON gh_capability_verification
  FOR EACH ROW EXECUTE FUNCTION gh_capability_verification_policy_lock();

-- ── 현재 정책 (ENT-GH-013) ───────────────────────────────────────────

CREATE TABLE gh_operations_policy (
  -- 배포 범위 = 서버 설정 GHE_BASE_URL의 host. 클라이언트가 지정하지 않는다.
  scope                     TEXT        PRIMARY KEY,
  revision                  BIGINT      NOT NULL,
  approved_snapshot_id      BIGINT      REFERENCES gh_capability_snapshot (snapshot_id),
  approved_verification_id  BIGINT      REFERENCES gh_capability_verification (verification_id),
  approved_report_hash      TEXT,
  approved_manifest_version TEXT,
  approved_manifest_hash    TEXT,
  approved_gh_version       TEXT,
  approved_at               TIMESTAMPTZ,
  approved_by               TEXT,
  -- 운영자가 막은 capability. 코드의 실행 구현 목록을 줄이기만 한다 — 넓히는 열은 없다.
  blocked_capabilities      TEXT[]      NOT NULL DEFAULT '{}',
  updated_at                TIMESTAMPTZ NOT NULL,
  updated_by                TEXT        NOT NULL,
  CONSTRAINT gh_operations_policy_scope_chk CHECK (char_length(scope) BETWEEN 1 AND 260 AND scope !~ '[[:space:]/]'),
  CONSTRAINT gh_operations_policy_revision_chk CHECK (revision >= 0),
  CONSTRAINT gh_operations_policy_approval_chk CHECK (
    (approved_snapshot_id IS NULL AND approved_verification_id IS NULL AND approved_report_hash IS NULL
      AND approved_manifest_version IS NULL AND approved_manifest_hash IS NULL AND approved_gh_version IS NULL
      AND approved_at IS NULL AND approved_by IS NULL)
    OR (approved_snapshot_id IS NOT NULL AND approved_verification_id IS NOT NULL AND approved_report_hash ~ '^[0-9a-f]{64}$'
      AND approved_manifest_version IS NOT NULL AND approved_manifest_hash ~ '^[0-9a-f]{64}$' AND approved_gh_version IS NOT NULL
      AND approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT gh_operations_policy_blocked_chk CHECK (cardinality(blocked_capabilities) <= 64)
);

-- ── revision 이력 (ENT-GH-014) ───────────────────────────────────────

CREATE TABLE gh_operations_policy_revision (
  revision_id         BIGSERIAL   PRIMARY KEY,
  scope               TEXT        NOT NULL,
  revision            BIGINT      NOT NULL,
  previous_revision   BIGINT      NOT NULL,
  action              TEXT        NOT NULL,
  capability_id       TEXT,
  -- approve: 승인한 정의와 근거. revoke: 철회한 승인의 정의와 근거.
  snapshot_id         BIGINT      REFERENCES gh_capability_snapshot (snapshot_id),
  verification_id     BIGINT      REFERENCES gh_capability_verification (verification_id),
  report_hash         TEXT,
  manifest_version    TEXT,
  manifest_hash       TEXT,
  gh_version          TEXT,
  actor               TEXT        NOT NULL,
  reason              TEXT        NOT NULL,
  correlation_id      UUID        NOT NULL,
  idempotency_key     TEXT        NOT NULL,
  -- 같은 키의 재요청이 같은 내용인가를 가르는 요청 지문(sha256 hex). 비밀을 담지 않는다.
  request_fingerprint TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gh_operations_policy_revision_uk UNIQUE (scope, revision),
  CONSTRAINT gh_operations_policy_revision_idem_uk UNIQUE (scope, actor, idempotency_key),
  CONSTRAINT gh_operations_policy_revision_action_chk CHECK (action IN ('approve', 'revoke', 'block', 'resume')),
  CONSTRAINT gh_operations_policy_revision_sequence_chk CHECK (revision = previous_revision + 1),
  CONSTRAINT gh_operations_policy_revision_capability_chk CHECK ((action IN ('block', 'resume')) = (capability_id IS NOT NULL)),
  CONSTRAINT gh_operations_policy_revision_approval_chk CHECK (
    (action IN ('approve', 'revoke')) = (snapshot_id IS NOT NULL AND verification_id IS NOT NULL AND report_hash IS NOT NULL
      AND manifest_version IS NOT NULL AND manifest_hash IS NOT NULL AND gh_version IS NOT NULL)),
  CONSTRAINT gh_operations_policy_revision_reason_chk CHECK (char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT gh_operations_policy_revision_key_chk CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  CONSTRAINT gh_operations_policy_revision_fingerprint_chk CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX gh_operations_policy_revision_recent_idx ON gh_operations_policy_revision (scope, revision DESC);

-- append-only: 어느 롤이든 갱신·삭제할 수 없다 (029의 검증 기록과 같은 규율).
CREATE FUNCTION gh_operations_policy_revision_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'gh_operations_policy_revision is append-only (%)', TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER gh_operations_policy_revision_immutable_trg
  BEFORE UPDATE OR DELETE ON gh_operations_policy_revision
  FOR EACH ROW EXECUTE FUNCTION gh_operations_policy_revision_immutable();

-- ── 정책 변경 함수 ───────────────────────────────────────────────────
--
-- 오류 코드(SQLSTATE) — 호출자가 이 코드와 메시지(사유 코드)로 API 응답을 가른다:
--   PRS01 충돌 (revision_changed · evidence_not_latest · evidence_changed)   PRS02 중복 방지 키를 다른 내용으로 재사용
--   PRS03 승인 부적격 (사유 코드)                                           PRS04 바꿀 것이 없음 (already_* · not_*)
--   PRS05 인자 모양이 틀림
-- 성공하면 applied(새 revision), 같은 키·같은 지문의 재요청이면 replayed(기존 revision). replayed는 아무것도 쓰지 않는다.

CREATE FUNCTION gh_operations_policy_apply(
  p_scope               TEXT,
  p_action              TEXT,
  p_expected_revision   BIGINT,
  p_actor               TEXT,
  p_reason              TEXT,
  p_correlation_id      UUID,
  p_idempotency_key     TEXT,
  p_request_fingerprint TEXT,
  p_capability_id       TEXT,
  p_snapshot_id         BIGINT,
  p_verification_id     BIGINT,
  p_report_hash         TEXT,
  p_evidence_max_age_ms BIGINT
) RETURNS TABLE (outcome TEXT, revision BIGINT, revision_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_state       public.gh_operations_policy%ROWTYPE;
  v_has_state   BOOLEAN;
  v_current     BIGINT;
  v_next        BIGINT;
  v_existing    public.gh_operations_policy_revision%ROWTYPE;
  v_snapshot    public.gh_capability_snapshot%ROWTYPE;
  v_evidence    public.gh_capability_verification%ROWTYPE;
  v_latest_id   BIGINT;
  v_blocked     TEXT[];
  v_revision_id BIGINT;
  v_action      TEXT;
  v_target      TEXT;
BEGIN
  -- 인자 모양. 호출자(prs_app)를 믿지 않는다.
  IF p_scope IS NULL OR char_length(p_scope) NOT BETWEEN 1 AND 260 OR p_scope ~ '[[:space:]/]' THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = 'PRS05';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'revoke', 'block', 'resume') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = 'PRS05';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_expected_revision' USING ERRCODE = 'PRS05';
  END IF;
  IF p_actor IS NULL OR char_length(p_actor) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = 'PRS05';
  END IF;
  IF p_reason IS NULL OR char_length(p_reason) NOT BETWEEN 1 AND 500 OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'PRS05';
  END IF;
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_correlation_id' USING ERRCODE = 'PRS05';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' THEN
    RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE = 'PRS05';
  END IF;
  IF p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_request_fingerprint' USING ERRCODE = 'PRS05';
  END IF;
  IF p_action IN ('block', 'resume') AND (p_capability_id IS NULL OR p_capability_id !~ '^[a-z0-9][a-z0-9.-]{0,79}$') THEN
    RAISE EXCEPTION 'invalid_capability_id' USING ERRCODE = 'PRS05';
  END IF;
  IF p_action = 'approve' AND (p_snapshot_id IS NULL OR p_verification_id IS NULL OR p_report_hash IS NULL
      OR p_report_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid_approval_arguments' USING ERRCODE = 'PRS05';
  END IF;

  -- 직렬화 지점. 같은 범위의 다른 변경·검증 기록·실행권 확정이 이 키에서 줄을 선다.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gh:policy:' || p_scope));

  -- 멱등 — 같은 행위자·같은 키. 같은 지문이면 기존 결과, 다르면 거절. 어느 쪽도 새로 쓰지 않는다.
  SELECT r.* INTO v_existing
    FROM public.gh_operations_policy_revision r
   WHERE r.scope = p_scope AND r.actor = p_actor AND r.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint = p_request_fingerprint THEN
      RETURN QUERY SELECT 'replayed'::TEXT, v_existing.revision, v_existing.revision_id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = 'PRS02', DETAIL = v_existing.revision::TEXT;
  END IF;

  SELECT s.* INTO v_state FROM public.gh_operations_policy s WHERE s.scope = p_scope;
  v_has_state := FOUND;
  v_current := CASE WHEN v_has_state THEN v_state.revision ELSE 0 END;
  IF v_current <> p_expected_revision THEN
    RAISE EXCEPTION 'revision_changed' USING ERRCODE = 'PRS01', DETAIL = v_current::TEXT;
  END IF;
  v_next := v_current + 1;
  v_blocked := CASE WHEN v_has_state THEN v_state.blocked_capabilities ELSE '{}'::TEXT[] END;

  IF p_action = 'approve' THEN
    -- 신선도 한도는 적용할 때만 본다 — 같은 키의 재요청(replayed)은 위에서 이미 돌아갔다. 범위는 설정 가능한 검사 주기(1분~7일)에
    -- 한 회차 최악 소요를 더한 값을 덮는다. 호출자(prs_app)가 한도를 부풀려 오래된 근거로 승인하지 못하게 상한을 둔다.
    IF p_evidence_max_age_ms IS NULL OR p_evidence_max_age_ms NOT BETWEEN 60000 AND 691200000 THEN
      RAISE EXCEPTION 'invalid_evidence_max_age' USING ERRCODE = 'PRS05';
    END IF;
    -- 잠금 아래에서 DB 쪽 사실을 다시 확인한다. 보고서 해석·재현 해시는 호출자가 같은 잠금 안에서 먼저 했다.
    SELECT sn.* INTO v_snapshot FROM public.gh_capability_snapshot sn WHERE sn.snapshot_id = p_snapshot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'snapshot_missing' USING ERRCODE = 'PRS03';
    END IF;
    IF v_snapshot.unclassified_count <> 0 OR v_snapshot.interaction_unclassified_count <> 0
       OR v_snapshot.flag_unclassified_count <> 0 OR v_snapshot.positional_unclassified_count <> 0 THEN
      RAISE EXCEPTION 'snapshot_unclassified' USING ERRCODE = 'PRS03';
    END IF;
    SELECT v.* INTO v_evidence FROM public.gh_capability_verification v WHERE v.verification_id = p_verification_id;
    IF NOT FOUND OR v_evidence.checked_by <> 'gh-executor' OR v_evidence.scope IS DISTINCT FROM p_scope THEN
      RAISE EXCEPTION 'evidence_missing' USING ERRCODE = 'PRS03';
    END IF;
    SELECT v.verification_id INTO v_latest_id
      FROM public.gh_capability_verification v
     WHERE v.checked_by = 'gh-executor' AND v.scope = p_scope
     ORDER BY v.checked_at DESC, v.verification_id DESC
     LIMIT 1;
    IF v_latest_id IS DISTINCT FROM v_evidence.verification_id THEN
      RAISE EXCEPTION 'evidence_not_latest' USING ERRCODE = 'PRS01', DETAIL = COALESCE(v_latest_id::TEXT, '');
    END IF;
    IF v_evidence.report_hash <> p_report_hash THEN
      RAISE EXCEPTION 'evidence_changed' USING ERRCODE = 'PRS01';
    END IF;
    IF v_evidence.status <> 'passed' THEN
      RAISE EXCEPTION 'evidence_not_passed' USING ERRCODE = 'PRS03';
    END IF;
    IF v_evidence.snapshot_id <> v_snapshot.snapshot_id OR v_evidence.manifest_hash_expected <> v_snapshot.manifest_hash THEN
      RAISE EXCEPTION 'evidence_other_definition' USING ERRCODE = 'PRS03';
    END IF;
    IF v_evidence.manifest_hash_observed IS DISTINCT FROM v_evidence.manifest_hash_expected THEN
      RAISE EXCEPTION 'evidence_manifest_mismatch' USING ERRCODE = 'PRS03';
    END IF;
    IF v_evidence.binary_sha256_observed IS DISTINCT FROM v_evidence.binary_sha256_expected
       OR v_evidence.gh_version_observed IS DISTINCT FROM v_evidence.gh_version_expected
       OR v_evidence.gh_version_expected <> v_snapshot.gh_version THEN
      RAISE EXCEPTION 'evidence_binary_mismatch' USING ERRCODE = 'PRS03';
    END IF;
    IF v_evidence.inventory_hash_observed IS DISTINCT FROM v_evidence.inventory_hash_expected
       OR v_evidence.inventory_hash_expected <> v_snapshot.inventory_hash THEN
      RAISE EXCEPTION 'evidence_inventory_mismatch' USING ERRCODE = 'PRS03';
    END IF;
    IF v_evidence.checked_at > now() OR now() - v_evidence.checked_at > make_interval(secs => p_evidence_max_age_ms / 1000.0) THEN
      RAISE EXCEPTION 'evidence_stale' USING ERRCODE = 'PRS03';
    END IF;
    IF v_has_state AND v_state.approved_snapshot_id = v_snapshot.snapshot_id THEN
      RAISE EXCEPTION 'already_approved' USING ERRCODE = 'PRS04';
    END IF;
  ELSIF p_action = 'revoke' THEN
    IF NOT v_has_state OR v_state.approved_snapshot_id IS NULL THEN
      RAISE EXCEPTION 'not_approved' USING ERRCODE = 'PRS04';
    END IF;
  ELSIF p_action = 'block' THEN
    IF p_capability_id = ANY (v_blocked) THEN
      RAISE EXCEPTION 'already_blocked' USING ERRCODE = 'PRS04';
    END IF;
    v_blocked := ARRAY(SELECT DISTINCT unnest(v_blocked || p_capability_id) ORDER BY 1);
  ELSE
    IF NOT (p_capability_id = ANY (v_blocked)) THEN
      RAISE EXCEPTION 'not_blocked' USING ERRCODE = 'PRS04';
    END IF;
    v_blocked := ARRAY(SELECT unnest(v_blocked) EXCEPT SELECT p_capability_id ORDER BY 1);
  END IF;

  IF NOT v_has_state THEN
    INSERT INTO public.gh_operations_policy (scope, revision, updated_at, updated_by)
    VALUES (p_scope, 0, now(), p_actor);
  END IF;

  UPDATE public.gh_operations_policy s SET
    revision                  = v_next,
    approved_snapshot_id      = CASE p_action WHEN 'approve' THEN v_snapshot.snapshot_id WHEN 'revoke' THEN NULL ELSE s.approved_snapshot_id END,
    approved_verification_id  = CASE p_action WHEN 'approve' THEN v_evidence.verification_id WHEN 'revoke' THEN NULL ELSE s.approved_verification_id END,
    approved_report_hash      = CASE p_action WHEN 'approve' THEN v_evidence.report_hash WHEN 'revoke' THEN NULL ELSE s.approved_report_hash END,
    approved_manifest_version = CASE p_action WHEN 'approve' THEN v_snapshot.manifest_version WHEN 'revoke' THEN NULL ELSE s.approved_manifest_version END,
    approved_manifest_hash    = CASE p_action WHEN 'approve' THEN v_snapshot.manifest_hash WHEN 'revoke' THEN NULL ELSE s.approved_manifest_hash END,
    approved_gh_version       = CASE p_action WHEN 'approve' THEN v_snapshot.gh_version WHEN 'revoke' THEN NULL ELSE s.approved_gh_version END,
    approved_at               = CASE p_action WHEN 'approve' THEN now() WHEN 'revoke' THEN NULL ELSE s.approved_at END,
    approved_by               = CASE p_action WHEN 'approve' THEN p_actor WHEN 'revoke' THEN NULL ELSE s.approved_by END,
    blocked_capabilities      = v_blocked,
    updated_at                = now(),
    updated_by                = p_actor
  WHERE s.scope = p_scope AND s.revision = v_current;
  IF NOT FOUND THEN
    -- 잠금 아래라 도달하지 않는다. 그래도 조용히 넘어가지 않는다.
    RAISE EXCEPTION 'revision_changed' USING ERRCODE = 'PRS01', DETAIL = v_current::TEXT;
  END IF;

  INSERT INTO public.gh_operations_policy_revision (
    scope, revision, previous_revision, action, capability_id, snapshot_id, verification_id, report_hash,
    manifest_version, manifest_hash, gh_version, actor, reason, correlation_id, idempotency_key, request_fingerprint)
  VALUES (
    p_scope, v_next, v_current, p_action,
    CASE WHEN p_action IN ('block', 'resume') THEN p_capability_id END,
    CASE p_action WHEN 'approve' THEN v_snapshot.snapshot_id WHEN 'revoke' THEN v_state.approved_snapshot_id END,
    CASE p_action WHEN 'approve' THEN v_evidence.verification_id WHEN 'revoke' THEN v_state.approved_verification_id END,
    CASE p_action WHEN 'approve' THEN v_evidence.report_hash WHEN 'revoke' THEN v_state.approved_report_hash END,
    CASE p_action WHEN 'approve' THEN v_snapshot.manifest_version WHEN 'revoke' THEN v_state.approved_manifest_version END,
    CASE p_action WHEN 'approve' THEN v_snapshot.manifest_hash WHEN 'revoke' THEN v_state.approved_manifest_hash END,
    CASE p_action WHEN 'approve' THEN v_snapshot.gh_version WHEN 'revoke' THEN v_state.approved_gh_version END,
    p_actor, p_reason, p_correlation_id, p_idempotency_key, p_request_fingerprint)
  RETURNING gh_operations_policy_revision.revision_id INTO v_revision_id;

  -- 감사 — 변경과 같은 트랜잭션 (FR-AUTH-004 AC-6 예외). 이 INSERT가 실패하면 위의 변경도 커밋되지 않는다.
  v_action := CASE p_action WHEN 'approve' THEN 'gh_registry.approve' WHEN 'revoke' THEN 'gh_registry.revoke'
                            WHEN 'block' THEN 'gh_capability.block' ELSE 'gh_capability.resume' END;
  v_target := CASE WHEN p_action IN ('block', 'resume') THEN p_scope || '/' || p_capability_id ELSE p_scope END;
  INSERT INTO public.audit_record (user_id, action, target, query, result_code, correlation_id)
  VALUES (p_actor, v_action, v_target, p_reason, 'applied', p_correlation_id);

  -- 스냅숏의 activated_at은 「최초 승인 시각」 이력으로 한 번만 채운다. 철회해도 지우지 않는다(029 트리거).
  IF p_action = 'approve' AND v_snapshot.activated_at IS NULL THEN
    UPDATE public.gh_capability_snapshot SET activated_at = now()
     WHERE snapshot_id = v_snapshot.snapshot_id AND activated_at IS NULL;
  END IF;

  RETURN QUERY SELECT 'applied'::TEXT, v_next, v_revision_id;
END
$$;

ALTER FUNCTION gh_operations_policy_apply(TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, BIGINT) OWNER TO prs_admin;
REVOKE ALL ON FUNCTION gh_operations_policy_apply(TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gh_operations_policy_apply(TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, BIGINT) TO prs_app;

-- ── 실행권 확정 가드 ─────────────────────────────────────────────────
--
-- 새 실행은 수락 시점의 정책 revision을 반드시 적고 대기 상태로만 들어오며(INSERT), 그 값은 바뀌지 않는다(UPDATE). queued→running 전이는
-- 현재 revision이 같고, 승인 정의가 실행 행의 정의와 같고, capability가 차단되지 않았을 때만 된다.
-- **이전 앱 버전으로 되돌려도 이 가드는 남는다** — 옛 search-api는 policy_revision을 적지 않아 INSERT가 거절되고,
-- 옛 실행기의 claim UPDATE는 revision이 없어 거절된다. 실행이 조용히 다시 열리지 않는다(롤백 방어).
-- 판정식 전체(레지스트리 신선도·기능 스위치 등)는 `@prs/gh-cli`의 decideExecution이 하고, 여기는 DB가 아는 사실만 다시 본다.

CREATE FUNCTION gh_execution_policy_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_policy public.gh_operations_policy%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.policy_revision IS NULL THEN
      RAISE EXCEPTION 'gh_execution requires policy_revision (CR-090)' USING ERRCODE = 'PRS10';
    END IF;
    -- 새 실행 기록은 대기 상태로만 들어온다. running이나 종료 상태로 바로 넣어 아래 실행권 확정 대조를 건너뛰지 못한다.
    IF NEW.state IS DISTINCT FROM 'queued' THEN
      RAISE EXCEPTION 'gh_execution must be inserted as queued (CR-090)' USING ERRCODE = 'PRS10';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.policy_revision IS DISTINCT FROM OLD.policy_revision THEN
    RAISE EXCEPTION 'gh_execution.policy_revision cannot change (CR-090)' USING ERRCODE = 'PRS10';
  END IF;
  IF NEW.state = 'running' AND OLD.state IS DISTINCT FROM 'running' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtext('gh:policy:' || NEW.host));
    SELECT p.* INTO v_policy FROM public.gh_operations_policy p WHERE p.scope = NEW.host;
    IF NOT FOUND
       OR NEW.policy_revision IS NULL
       OR v_policy.revision <> NEW.policy_revision
       OR v_policy.approved_manifest_hash IS DISTINCT FROM NEW.manifest_hash
       OR v_policy.approved_manifest_version IS DISTINCT FROM NEW.manifest_version
       OR v_policy.approved_gh_version IS DISTINCT FROM NEW.gh_version
       OR NEW.capability_id = ANY (v_policy.blocked_capabilities) THEN
      RAISE EXCEPTION 'gh_execution claim rejected by operations policy guard (CR-090)' USING ERRCODE = 'PRS11';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE gh_execution ADD COLUMN policy_revision BIGINT;

CREATE TRIGGER gh_execution_policy_guard_trg
  BEFORE INSERT OR UPDATE ON gh_execution
  FOR EACH ROW EXECUTE FUNCTION gh_execution_policy_guard();

-- ── 권한 ────────────────────────────────────────────────────────────
-- prs_app은 정책 표를 읽기만 한다. 쓰기는 함수(EXECUTE)로만. 시퀀스 USAGE는 권한 전수 검사(DEV-518)의 규율이다.
GRANT SELECT ON gh_operations_policy, gh_operations_policy_revision TO prs_app;
GRANT USAGE, SELECT ON SEQUENCE gh_operations_policy_revision_revision_id_seq TO prs_app;
GRANT ALL ON gh_operations_policy, gh_operations_policy_revision TO prs_admin;
GRANT USAGE, SELECT ON SEQUENCE gh_operations_policy_revision_revision_id_seq TO prs_admin;
