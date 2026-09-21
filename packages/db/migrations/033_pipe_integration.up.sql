-- PIPE 서버의 사용자 위임 검색 수신부 (CR-112 / ADR-025, FR-INT-001). ENT-INT-001~005.
--
-- **추가 전용이다.** 기존 표·열·제약을 바꾸지 않는다. `app_user`는 외래 키로만 가리킨다 —
-- 이 연동이 새 사용자를 만들지 않으므로(FR-INT-001 AC-3) 기존 행이 없으면 연결할 수 없다.
--
-- 정본을 PostgreSQL에 두는 이유(ADR-025): 로그인 문맥 회수(tombstone)가 저장소 재시작이나
-- 휘발로 사라지면 같은 옛 로그인 문맥이 다시 검색 grant를 받는다. 재생 방지(jti)만 Redis에
-- 두며, 그 값은 assertion 수명(최대 65초)이 지나면 뜻이 없다.

-- ENT-INT-001. 승인된 (PIPE issuer, 불변 subject) → 기존 pr-search 사용자.
--
-- 이름·이메일로 계정을 잇지 않는다. GHE 숫자 ID와 호스트를 함께 남겨 개명·재사용을
-- 대조한다. 상태가 바뀌면 binding_version이 오르고, 그 전에 발급된 grant는 다음
-- 요청에서 거절된다.
CREATE TABLE pipe_integration_identity_binding (
  binding_id             BIGSERIAL   PRIMARY KEY,
  issuer                 TEXT        NOT NULL,
  subject                TEXT        NOT NULL,
  prs_user_id            TEXT        NOT NULL REFERENCES app_user(user_id),
  ghe_host               TEXT        NOT NULL,
  ghe_user_id            BIGINT      NOT NULL,
  status                 TEXT        NOT NULL,
  binding_version        INTEGER     NOT NULL DEFAULT 1,
  verified_by            TEXT        NOT NULL,
  verified_at            TIMESTAMPTZ NOT NULL,
  verification_reference TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pipe_integration_binding_status_chk
    CHECK (status IN ('pending', 'active', 'disabled', 'conflict')),
  CONSTRAINT pipe_integration_binding_version_chk CHECK (binding_version >= 1),
  CONSTRAINT pipe_integration_binding_ghe_user_chk CHECK (ghe_user_id > 0),
  CONSTRAINT pipe_integration_binding_text_chk CHECK (
    char_length(issuer) BETWEEN 1 AND 256
    AND char_length(subject) BETWEEN 1 AND 256
    AND char_length(ghe_host) BETWEEN 1 AND 253
    AND char_length(verified_by) BETWEEN 1 AND 200
    AND char_length(verification_reference) BETWEEN 1 AND 500
  ),
  CONSTRAINT pipe_integration_binding_subject_uk UNIQUE (issuer, subject)
);

-- 역방향 충돌: 한 issuer 안에서 한 사용자·한 GHE 계정은 활성 binding을 하나만 갖는다.
-- 둘이면 두 PIPE 사용자가 같은 pr-search 사용자로 행동한다 — 계정 병합이다.
CREATE UNIQUE INDEX pipe_integration_binding_active_user_uk
  ON pipe_integration_identity_binding (issuer, prs_user_id) WHERE status = 'active';
CREATE UNIQUE INDEX pipe_integration_binding_active_ghe_uk
  ON pipe_integration_identity_binding (issuer, ghe_host, ghe_user_id) WHERE status = 'active';

-- ENT-INT-002. PIPE 로그인 문맥과 그 회수 표식(tombstone).
--
-- 발급과 회수가 **이 행 하나의 잠금으로 직렬화된다.** 발급은 `INSERT … ON CONFLICT DO UPDATE`로
-- 행을 잠근 뒤 `revoked_at`을 다시 읽고, 회수는 같은 행을 갱신한 뒤 그 문맥의 grant를 모두
-- 회수한다. 어느 쪽이 먼저 끝나도 회수 뒤에 살아 있는 grant가 남지 않는다.
--
-- `auth_expires_at`은 이 문맥에 대해 본 값 중 가장 늦은 것이다. 표식은 적어도 그때까지
-- 보존한다 (FR-INT-001 AC-7, 보존 기간은 운영 절차).
CREATE TABLE pipe_integration_auth_context (
  issuer                TEXT        NOT NULL,
  subject               TEXT        NOT NULL,
  auth_context_id       TEXT        NOT NULL,
  client_id             TEXT        NOT NULL,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  auth_expires_at       TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ,
  revoke_correlation_id UUID,
  PRIMARY KEY (issuer, subject, auth_context_id),
  CONSTRAINT pipe_integration_context_text_chk CHECK (
    char_length(issuer) BETWEEN 1 AND 256
    AND char_length(subject) BETWEEN 1 AND 256
    AND char_length(auth_context_id) BETWEEN 8 AND 256
    AND char_length(client_id) BETWEEN 1 AND 64
  )
);

CREATE INDEX pipe_integration_context_horizon_idx
  ON pipe_integration_auth_context (auth_expires_at);

-- ENT-INT-003. 검색 전용 opaque grant.
--
-- **원문 토큰은 어디에도 없다.** `token_sha256`로만 찾는다. 토큰은 256비트 난수라 해시로
-- 충분하다. 일반 세션(`prs:session:*`)과 이름공간이 다르고, 쿠키로 바뀌지 않는다.
--
-- 수명 상한 300초를 DB 제약으로도 건다 — 코드가 틀려도 5분을 넘는 grant는 저장되지 않는다.
CREATE TABLE pipe_integration_grant (
  grant_id              UUID        PRIMARY KEY,
  token_sha256          TEXT        NOT NULL,
  client_id             TEXT        NOT NULL,
  issuer                TEXT        NOT NULL,
  subject               TEXT        NOT NULL,
  auth_context_id       TEXT        NOT NULL,
  binding_id            BIGINT      NOT NULL REFERENCES pipe_integration_identity_binding(binding_id),
  binding_version       INTEGER     NOT NULL,
  prs_user_id           TEXT        NOT NULL,
  issued_kid            TEXT        NOT NULL,
  certificate_sha256    TEXT        NOT NULL,
  profile               TEXT        NOT NULL,
  client_policy_version INTEGER     NOT NULL,
  issued_at             TIMESTAMPTZ NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ,
  revoke_reason         TEXT,
  correlation_id        UUID        NOT NULL,
  CONSTRAINT pipe_integration_grant_token_uk UNIQUE (token_sha256),
  CONSTRAINT pipe_integration_grant_token_chk CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pipe_integration_grant_cert_chk CHECK (certificate_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pipe_integration_grant_lifetime_chk
    CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '300 seconds'),
  CONSTRAINT pipe_integration_grant_revoke_chk CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  ),
  CONSTRAINT pipe_integration_grant_context_fk FOREIGN KEY (issuer, subject, auth_context_id)
    REFERENCES pipe_integration_auth_context (issuer, subject, auth_context_id)
);

CREATE INDEX pipe_integration_grant_context_idx
  ON pipe_integration_grant (issuer, subject, auth_context_id);
CREATE INDEX pipe_integration_grant_binding_idx ON pipe_integration_grant (binding_id);
CREATE INDEX pipe_integration_grant_expiry_idx ON pipe_integration_grant (expires_at);

-- ENT-INT-004. 긴급 회수된 client·서명 키·인증서.
--
-- 설정 파일을 바꿔 재기동하기 전에도 **모든 복제본에서 즉시** 효력이 있어야 한다. 회수는
-- 되돌리지 않는다 — 새 키·새 인증서·새 client_id로 교체한다.
CREATE TABLE pipe_integration_credential_revocation (
  client_id       TEXT        NOT NULL,
  credential_kind TEXT        NOT NULL,
  credential_id   TEXT        NOT NULL,
  reason          TEXT        NOT NULL,
  revoked_by      TEXT        NOT NULL,
  revoked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, credential_kind, credential_id),
  CONSTRAINT pipe_integration_revocation_kind_chk
    CHECK (credential_kind IN ('client', 'signing_key', 'certificate')),
  CONSTRAINT pipe_integration_revocation_text_chk CHECK (
    char_length(reason) BETWEEN 1 AND 500 AND char_length(revoked_by) BETWEEN 1 AND 200
  )
);

-- ENT-INT-005. 연동 보안 이벤트 — 발급·거절·회수·조회의 행위 주체(service actor)를 남긴다.
--
-- `audit_record`를 고치지 않는다. 조회의 감사는 기존 기록기가 `user_id` = canonical 사용자로
-- 그대로 남기고, 여기에는 **같은 correlation_id로** client·grant를 남겨 둘을 잇는다.
-- 토큰·assertion·쿠키·검색어 전문·응답 본문은 담지 않는다 (FR-INT-001 AC-10).
-- 애플리케이션 롤에게는 INSERT·SELECT만 준다 — `audit_record`와 같은 추가 전용 규칙이다.
CREATE TABLE pipe_integration_event (
  event_id                BIGSERIAL   PRIMARY KEY,
  occurred_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type              TEXT        NOT NULL,
  result_code             TEXT        NOT NULL,
  http_status             SMALLINT,
  client_id               TEXT,
  issuer                  TEXT,
  subject                 TEXT,
  auth_context_id         TEXT,
  prs_user_id             TEXT,
  grant_id                UUID,
  operation               TEXT,
  target                  TEXT,
  binding_version         INTEGER,
  client_policy_version   INTEGER,
  correlation_id          UUID        NOT NULL,
  upstream_correlation_id UUID,
  actor                   TEXT,
  detail                  JSONB       NOT NULL DEFAULT '{}',
  CONSTRAINT pipe_integration_event_type_chk CHECK (event_type IN (
    'grant.issue', 'grant.reject', 'grant.revoke', 'context.revoke', 'context.reject',
    'context.view', 'read', 'read.reject',
    'binding.import', 'binding.disable', 'credential.revoke', 'maintenance.purge'
  )),
  CONSTRAINT pipe_integration_event_text_chk CHECK (
    char_length(result_code) BETWEEN 1 AND 64
    AND (target IS NULL OR char_length(target) <= 300)
    AND (operation IS NULL OR char_length(operation) <= 64)
  )
);

CREATE INDEX pipe_integration_event_time_idx ON pipe_integration_event (occurred_at DESC);
CREATE INDEX pipe_integration_event_grant_idx ON pipe_integration_event (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX pipe_integration_event_user_idx
  ON pipe_integration_event (prs_user_id, occurred_at DESC) WHERE prs_user_id IS NOT NULL;
CREATE INDEX pipe_integration_event_correlation_idx ON pipe_integration_event (correlation_id);

-- 애플리케이션 롤 권한 (CR-060의 규율: 표마다 명시한다. 기본 권한은 쓰지 않는다).
GRANT SELECT, INSERT, UPDATE ON pipe_integration_identity_binding TO prs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pipe_integration_auth_context TO prs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pipe_integration_grant TO prs_app;
GRANT SELECT, INSERT ON pipe_integration_credential_revocation TO prs_app;
GRANT SELECT, INSERT ON pipe_integration_event TO prs_app;
GRANT USAGE, SELECT ON SEQUENCE pipe_integration_identity_binding_binding_id_seq TO prs_app;
GRANT USAGE, SELECT ON SEQUENCE pipe_integration_event_event_id_seq TO prs_app;
