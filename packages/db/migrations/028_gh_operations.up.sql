-- GitHub Operations Plane의 첫 정본 (REL-007 R0 / WP-077, CR-086).
--
-- 데이터 모델 3.5장이 「006 이후 additive」로 적어 둔 표 가운데 **첫 수직 판이 실제로
-- 쓰는 셋만** 만든다. 그 장의 006·007·009는 초기 계획 번호이며 이 저장소의 실제
-- 마이그레이션 공간에서는 028이 다음 빈 번호다 — 001~027은 건드리지 않는다.
--
-- | 표 | 계약 | 이 판 |
-- | --- | --- | --- |
-- | github_identity_connection | ENT-GH-001 | 만든다. 토큰 원문 없음 |
-- | gh_identity_secret | (신설) | 만든다 — Profile A의 「비밀 저장소」 최소 구현 |
-- | gh_execution | ENT-GH-002 | 만든다. 월별 파티션, 구조화 invocation·컨텍스트·결과 포함 |
-- | gh_execution_lock | ENT-GH-002 | **만들지 않는다** — R0 읽기에는 상충 작업이 없다. 쓰기 capability를 여는 판이 만든다 |
-- | gh_execution_artifact | ENT-GH-002-A | 만들지 않는다 — 파일 입출력을 열지 않았다 |
-- | gh_recipe·gh_recipe_revision | ENT-GH-003·004 | 만들지 않는다 (WP-058) |
-- | gh_approval | ENT-GH-005 | 만들지 않는다 — R0는 승인이 없다 |
-- | gh_capability_snapshot | ENT-GH-006 | **만들지 않는다** — 그 표의 CHECK(unclassified_count = 0)는 parity 게이트 통과를 뜻하는데 이 판은 leaf 196 중 1만 분류했다. 통과하지 않은 게이트를 표로 적을 수 없다 |
--
-- ## 왜 토큰 봉인 표가 따로 있는가
--
-- 계약은 「토큰은 비밀 저장소 참조(`token_ref`)로 보관한다」고 적는다(FR-GH-008 AC-5).
-- 단일 호스트 형상에는 비밀 저장소가 없다. 그래서 참조가 가리키는 자리를 이 DB 안에
-- 두되 **원문이 아니라 AES-256-GCM 봉인**만 넣는다. 봉인 키는 `.env`에 있고 이 DB에는
-- 없으므로, DB 덤프만으로는 토큰을 되살릴 수 없다. 이것은 비밀 저장소의 대체이지
-- 동등물이 아니며 그 대가는 원장(DEV)에 적었다.

-- ── 위임 신원 (ENT-GH-001) ───────────────────────────────────────────

CREATE TABLE github_identity_connection (
  user_id            TEXT        PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  github_login       TEXT        NOT NULL,
  github_user_id     BIGINT      NOT NULL,
  -- 어느 GHE에 대한 위임인가. `GHE_BASE_URL`의 host다. 호스트가 바뀌면 연결은 무효다.
  host               TEXT        NOT NULL,
  -- 봉인된 토큰의 참조. 값이 아니다.
  token_ref          TEXT        NOT NULL,
  scopes             TEXT[]      NOT NULL DEFAULT '{}',
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 액세스 토큰 만료. 만료 토큰을 켜지 않은 App이면 NULL이다.
  expires_at         TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  revoke_reason      TEXT,
  CONSTRAINT github_identity_connection_reason_len_chk
    CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 64)
);

CREATE TABLE gh_identity_secret (
  secret_ref     TEXT        PRIMARY KEY,
  user_id        TEXT        NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  -- 봉인 키 식별자. 회전 뒤 어느 키로 봉인됐는지 구분한다.
  key_id         TEXT        NOT NULL,
  access_sealed  BYTEA       NOT NULL,
  refresh_sealed BYTEA,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at     TIMESTAMPTZ
);

CREATE INDEX gh_identity_secret_user_idx ON gh_identity_secret (user_id);

-- ── 실행 기록 (ENT-GH-002) ───────────────────────────────────────────
--
-- 감사 축이다 (ADR-013). `audit_record`와 나뉘어 있어 「누가 무엇을 시켰나」가 자동
-- 파이프라인 기록과 섞이지 않는다. 월별 파티션이며 보존은 감사와 같은 1년이다
-- (NFR-012). 파티션 생성·만료 드롭은 `JOB-AUD-001`이 `raw_event`·`audit_record`와
-- 함께 한다 — 그래서 소유자를 `prs_admin`으로 옮긴다 (마이그레이션 019의 선례).

CREATE TABLE gh_execution (
  execution_id         BIGSERIAL   NOT NULL,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id              TEXT        NOT NULL,
  github_actor         TEXT        NOT NULL,
  host                 TEXT        NOT NULL,
  repository           TEXT,
  repository_id        BIGINT,
  target               TEXT,
  capability_id        TEXT        NOT NULL,
  -- 구조화 원본 (ENT-GH-008). 비밀이 없다 — 이 판의 capability는 비밀 입력을 받지 않는다.
  invocation           JSONB       NOT NULL,
  -- 실행 직전 확정된 컨텍스트 스냅숏 (C-062). 호스트·저장소·행위자·버전.
  context              JSONB       NOT NULL,
  -- 비밀은 <redacted>로 치환된 상태 (FR-GH-002 AC-3).
  redacted_argv        TEXT[]      NOT NULL,
  -- 실행기가 자식에게 준 환경 변수의 **이름**. 값은 남기지 않는다.
  env_keys             TEXT[]      NOT NULL DEFAULT '{}',
  risk_level           TEXT        NOT NULL,
  state                TEXT        NOT NULL,
  gh_version           TEXT        NOT NULL,
  manifest_version     TEXT        NOT NULL,
  manifest_hash        TEXT        NOT NULL,
  idempotency_key      TEXT        NOT NULL,
  authorization_result TEXT        NOT NULL,
  confirmed_at         TIMESTAMPTZ,
  approval_id          BIGINT,
  executor_id          TEXT,
  claimed_at           TIMESTAMPTZ,
  heartbeat_at         TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  finished_at          TIMESTAMPTZ,
  cancel_requested_at  TIMESTAMPTZ,
  cancel_requested_by  TEXT,
  exit_code            INT,
  -- 무해화 전 원본 출력의 SHA-256. 원문은 저장하지 않는다.
  output_hash          TEXT,
  error                TEXT,
  -- typed 결과 (GhResultEnvelope). 결과 계약의 sensitivity가 secret이면 NULL이어야 한다.
  result               JSONB,
  -- 무해화·절단된 발췌. 원문이 아니다.
  stdout_excerpt       TEXT,
  stderr_excerpt       TEXT,
  stdout_truncated     BOOLEAN     NOT NULL DEFAULT false,
  stderr_truncated     BOOLEAN     NOT NULL DEFAULT false,
  output_binary        BOOLEAN     NOT NULL DEFAULT false,
  correlation_id       UUID        NOT NULL,
  PRIMARY KEY (execution_id, requested_at),
  CONSTRAINT gh_execution_risk_chk CHECK (risk_level IN ('R0','R1','R2','R3')),
  CONSTRAINT gh_execution_state_chk CHECK (state IN (
    'queued','preflighting','awaiting_confirmation','awaiting_approval',
    'running','succeeded','failed','cancelled','timed_out','policy_blocked')),
  CONSTRAINT gh_execution_error_len_chk CHECK (error IS NULL OR char_length(error) <= 1000),
  CONSTRAINT gh_execution_excerpt_len_chk CHECK (
    (stdout_excerpt IS NULL OR octet_length(stdout_excerpt) <= 262144) AND
    (stderr_excerpt IS NULL OR octet_length(stderr_excerpt) <= 65536))
) PARTITION BY RANGE (requested_at);

-- 같은 중복 방지 키의 재요청은 새 실행을 만들지 않는다 (FR-GH-012 AC-5).
--
-- **데이터 모델 3.5장의 `gh_execution_idem_uk (user_id, idempotency_key, requested_at)`는
-- 유일성을 강제하지 못한다.** 파티션 표의 유니크 인덱스는 파티션 키를 포함해야 하는데,
-- 두 요청의 `requested_at`은 마이크로초 단위로 다르므로 같은 키가 그대로 두 행이 된다 —
-- 통합 시험이 실제로 그것을 보였다 (DEV 등록). 그래서 유일성은 **파티션되지 않은 보조 표**가
-- 강제한다: 실행을 만드는 트랜잭션이 먼저 이 표에 키를 넣고, 충돌하면 실행을 만들지 않는다.
-- 행은 작고(키 하나에 한 줄) 실행 기록과 같은 수명을 갖는다.
CREATE TABLE gh_execution_idempotency (
  user_id         TEXT        NOT NULL,
  idempotency_key TEXT        NOT NULL,
  execution_id    BIGINT      NOT NULL,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);
CREATE INDEX gh_execution_idempotency_requested_idx ON gh_execution_idempotency (requested_at);

CREATE INDEX gh_execution_idem_idx ON gh_execution (user_id, idempotency_key, requested_at DESC);
CREATE INDEX gh_execution_user_idx ON gh_execution (user_id, requested_at DESC);
CREATE INDEX gh_execution_state_idx ON gh_execution (state, requested_at DESC);
CREATE INDEX gh_execution_target_idx ON gh_execution (repository, target, requested_at DESC);

-- ── 권한 ────────────────────────────────────────────────────────────
--
-- 애플리케이션 롤은 세 표를 읽고 쓴다. 실행 기록은 UPDATE가 필요하다 — 상태 전이가
-- 곧 이 표의 쓰기이며, `audit_record`처럼 추가 전용이 아니다. 갱신은 실행기와
-- API가 상태 기계를 따라서만 한다 (코드가 지킨다). DELETE는 주지 않는다.
GRANT SELECT, INSERT, UPDATE, DELETE ON github_identity_connection, gh_identity_secret TO prs_app;
GRANT SELECT, INSERT, UPDATE ON gh_execution TO prs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON gh_execution_idempotency TO prs_app;
GRANT USAGE, SELECT ON SEQUENCE gh_execution_execution_id_seq TO prs_app;
GRANT ALL ON github_identity_connection, gh_identity_secret, gh_execution, gh_execution_idempotency TO prs_admin;
GRANT USAGE, SELECT ON SEQUENCE gh_execution_execution_id_seq TO prs_admin;

-- 파티션 수명 잡이 자식 파티션을 만들고 지운다 (마이그레이션 019의 규율).
ALTER TABLE gh_execution OWNER TO prs_admin;
