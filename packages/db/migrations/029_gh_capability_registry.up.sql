-- 029 capability 레지스트리 — 검증 스냅숏과 검증 기록 (REL-007 / WP-078, ENT-GH-006 · ENT-GH-012,
-- FR-GH-001 AC-5 · FR-GH-011 AC-2, NFR-009, CR-088).
--
-- 데이터 모델 3.5장의 계획 번호 009는 쓰지 않는다 — 이 저장소의 실제 다음 번호는 029다.
-- additive이며 028을 건드리지 않는다.
--
-- 두 표의 뜻이 다르다.
--
-- | 표 | 뜻 |
-- | --- | --- |
-- | gh_capability_snapshot | 이 배포가 본 manifest의 신원 — 버전·내용 해시·인벤토리 해시·차원별 집계. manifest 해시마다 한 행이며 내용은 불변이다. **활성화(`activated_at`)는 NFR-009 게이트 통과 뒤에만** 가능하다(CHECK). 이 판은 어느 행도 활성화하지 않는다 |
-- | gh_capability_verification | 검증 한 회차의 기록 — 누가(실행기·CI·CLI) 언제 어떤 바이너리·규칙으로 무엇을 확인했고 결과가 무엇이었나. **append-only** — 갱신·삭제를 트리거가 막는다 |
--
-- 계획 DDL과 다른 자리 (DEV-672): `CHECK (unclassified_count = 0)`를
-- `CHECK (activated_at IS NULL OR unclassified_count = 0)`으로 바꿨다. 미분류가 남은 manifest도
-- **진단용으로 기록**할 수 있어야 A-006이 「무엇이 미완인가」를 보인다. 막는 것은 활성화뿐이다.
--
-- 검증 기록은 실행 허용을 바꾸지 않는다. 실행기는 기동마다 자기 바이너리·manifest를 스스로 대조한다.

CREATE TABLE gh_capability_snapshot (
  snapshot_id                    BIGSERIAL   PRIMARY KEY,
  gh_version                     TEXT        NOT NULL,
  manifest_version               TEXT        NOT NULL,
  manifest_hash                  TEXT        NOT NULL,
  inventory_hash                 TEXT        NOT NULL,
  command_count                  INT         NOT NULL,
  leaf_command_count             INT         NOT NULL,
  group_command_count            INT         NOT NULL,
  alias_only_command_count       INT         NOT NULL,
  alias_count                    INT         NOT NULL,
  positional_count               INT         NOT NULL,
  flag_count                     INT         NOT NULL,
  inherited_flag_count           INT         NOT NULL,
  json_field_count               INT         NOT NULL,
  -- FR-GH-001 AC-2의 command 차원 미분류 수. 활성화 조건이다.
  unclassified_count             INT         NOT NULL,
  interaction_unclassified_count INT         NOT NULL,
  flag_unclassified_count        INT         NOT NULL,
  positional_unclassified_count  INT         NOT NULL,
  extension_command_count        INT         NOT NULL,
  executable_count               INT         NOT NULL,
  -- NFR-009 차원별 집계 원문 (GhManifestCoverage.dimensions).
  coverage                       JSONB       NOT NULL,
  first_seen_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at                   TIMESTAMPTZ,
  CONSTRAINT gh_capability_snapshot_uk UNIQUE (manifest_version, manifest_hash),
  CONSTRAINT gh_capability_snapshot_hash_chk
    CHECK (manifest_hash ~ '^[0-9a-f]{64}$' AND inventory_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT gh_capability_snapshot_counts_chk
    CHECK (command_count >= 0 AND leaf_command_count >= 0 AND unclassified_count >= 0 AND executable_count >= 0),
  -- 어느 차원이든 미분류가 하나라도 있으면 활성화하지 않는다 (NFR-009 — command·interaction·flag·positional). 기록은 된다.
  CONSTRAINT gh_capability_snapshot_activation_chk
    CHECK (
      activated_at IS NULL
      OR (unclassified_count = 0 AND interaction_unclassified_count = 0
          AND flag_unclassified_count = 0 AND positional_unclassified_count = 0)
    )
);

CREATE TABLE gh_capability_verification (
  verification_id          BIGSERIAL   PRIMARY KEY,
  snapshot_id              BIGINT      NOT NULL REFERENCES gh_capability_snapshot (snapshot_id),
  checked_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 누가 확인했는가. 실행기의 결과와 CI 검사 바이너리의 결과를 섞지 않는다.
  checked_by               TEXT        NOT NULL,
  trigger                  TEXT        NOT NULL,
  -- 실행기 ID·호스트명·바이너리 경로·Node 버전. 비밀은 없다.
  environment              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  gh_version_expected      TEXT        NOT NULL,
  gh_version_observed      TEXT,
  binary_sha256_expected   TEXT        NOT NULL,
  binary_sha256_observed   TEXT,
  manifest_hash_expected   TEXT        NOT NULL,
  manifest_hash_observed   TEXT,
  inventory_hash_expected  TEXT        NOT NULL,
  inventory_hash_observed  TEXT,
  validator_version        TEXT        NOT NULL,
  rules_version            TEXT        NOT NULL,
  status                   TEXT        NOT NULL,
  -- 드리프트 상세 (added·removed·changed command). 없으면 NULL.
  drift                    JSONB,
  -- 검증기 보고서 원문 (GhRegistryReport). 시각이 없어 같은 입력이면 같은 report_hash다.
  report                   JSONB       NOT NULL,
  report_hash              TEXT        NOT NULL,
  error                    TEXT,
  CONSTRAINT gh_capability_verification_by_chk CHECK (checked_by IN ('gh-executor', 'ci', 'cli')),
  CONSTRAINT gh_capability_verification_trigger_chk CHECK (trigger IN ('startup', 'periodic', 'manual')),
  CONSTRAINT gh_capability_verification_status_chk
    CHECK (status IN ('passed', 'incomplete', 'drift', 'failed', 'error')),
  CONSTRAINT gh_capability_verification_error_chk CHECK (error IS NULL OR char_length(error) <= 2000),
  CONSTRAINT gh_capability_verification_report_size_chk CHECK (pg_column_size(report) <= 1048576)
);

CREATE INDEX gh_capability_verification_recent_idx
  ON gh_capability_verification (checked_at DESC);
CREATE INDEX gh_capability_verification_by_idx
  ON gh_capability_verification (checked_by, checked_at DESC);

-- append-only: 어느 롤이든 갱신·삭제할 수 없다. 표를 통째로 지우는 것은 down 마이그레이션의 몫이다.
-- 행 트리거는 TRUNCATE에 걸리지 않는다 — prs_admin(소유자)의 TRUNCATE만이 이 보장의 밖이며 prs_app에는 그 권한이 없다.
CREATE FUNCTION gh_capability_verification_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gh_capability_verification is append-only (%)', TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER gh_capability_verification_immutable_trg
  BEFORE UPDATE OR DELETE ON gh_capability_verification
  FOR EACH ROW EXECUTE FUNCTION gh_capability_verification_immutable();

-- snapshot: 내용은 불변이고 활성화만 NULL → 시각으로 한 번 바뀔 수 있다. 삭제는 없다.
CREATE FUNCTION gh_capability_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'gh_capability_snapshot rows are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (row_to_json(NEW)::jsonb - 'activated_at') <> (row_to_json(OLD)::jsonb - 'activated_at') THEN
    RAISE EXCEPTION 'gh_capability_snapshot content is immutable — only activated_at may be set' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'gh_capability_snapshot activation cannot be changed once set' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER gh_capability_snapshot_guard_trg
  BEFORE UPDATE OR DELETE ON gh_capability_snapshot
  FOR EACH ROW EXECUTE FUNCTION gh_capability_snapshot_guard();

-- prs_app은 기록만 한다 — UPDATE·DELETE는 주지 않는다. 활성화(activated_at)는 운영자가 prs_admin으로 한다(다음 판).
GRANT SELECT, INSERT ON gh_capability_snapshot, gh_capability_verification TO prs_app;
GRANT USAGE, SELECT ON SEQUENCE gh_capability_snapshot_snapshot_id_seq, gh_capability_verification_verification_id_seq TO prs_app;
GRANT ALL ON gh_capability_snapshot, gh_capability_verification TO prs_admin;
GRANT USAGE, SELECT ON SEQUENCE gh_capability_snapshot_snapshot_id_seq, gh_capability_verification_verification_id_seq TO prs_admin;
