-- 레지스트리와 권한 (데이터 모델 3.3). ENT-CORE-001, ENT-CORE-004, ENT-CORE-005.

CREATE TABLE repository (
  repository_id     BIGINT      PRIMARY KEY,
  owner             TEXT        NOT NULL,
  name              TEXT        NOT NULL,
  org_id            BIGINT      NOT NULL,
  visibility        TEXT        NOT NULL,
  sequence_branches TEXT[]      NOT NULL DEFAULT '{}',
  mirror_enabled    BOOLEAN     NOT NULL DEFAULT true,
  status            TEXT        NOT NULL DEFAULT 'active',
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sequence_branches_limit CHECK (COALESCE(array_length(sequence_branches, 1), 0) <= 10),
  CONSTRAINT repository_visibility_chk CHECK (visibility IN ('public', 'internal', 'private')),
  CONSTRAINT repository_status_chk CHECK (status IN ('active', 'archived')),
  UNIQUE (owner, name)
);

CREATE TABLE app_user (
  user_id               TEXT        PRIMARY KEY,
  login                 TEXT        NOT NULL UNIQUE,
  email                 TEXT,
  roles                 TEXT[]      NOT NULL DEFAULT '{developer}',
  access_scope_version  INT         NOT NULL DEFAULT 0,
  last_seen_at          TIMESTAMPTZ
);

CREATE TABLE team (
  team_id BIGINT PRIMARY KEY,
  slug    TEXT   NOT NULL,
  org_id  BIGINT NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE TABLE team_member (
  team_id BIGINT NOT NULL REFERENCES team(team_id),
  user_id TEXT   NOT NULL REFERENCES app_user(user_id),
  PRIMARY KEY (team_id, user_id)
);

-- Redis 미스 시 백업 (ADR-008). 접근 범위 500개 초과 시 scope_kind가 org_team으로 바뀐다.
CREATE TABLE permission_cache (
  user_id        TEXT        PRIMARY KEY REFERENCES app_user(user_id),
  scope_kind     TEXT        NOT NULL,
  repository_ids BIGINT[],
  org_ids        BIGINT[],
  team_ids       BIGINT[],
  refreshed_at   TIMESTAMPTZ NOT NULL,
  CONSTRAINT permission_cache_scope_kind_chk CHECK (scope_kind IN ('explicit', 'org_team'))
);
