-- 인증과 권한 캐시 (CR-015: DEV-043, DEV-044, DEV-045). FR-AUTH-002, FR-AUTH-003.
--
-- 세 가지를 더한다.
--   1. GHE 숫자 사용자 id — 무효화 이벤트가 도착하는 유일하게 안정된 신원
--   2. permission_cache의 GIN 색인 — `repository` 웹훅의 "영향 사용자"를 찾는 길
--   3. permission_cache에 access_scope_version — 갱신·무효화 경합의 울타리

-- 1. 신원 (DEV-043).
--
-- `user_id`는 OIDC `sub`이고 `login`은 GHE login이다. 둘을 잇는 것만으로는
-- 부족하다 — login은 개명될 수 있고, 개명 웹훅을 놓친 사이의 무효화가 조용히
-- 아무도 맞히지 못하는 것이 이 시스템에서 가장 나쁜 실패다.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS github_user_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_github_user_id_key') THEN
    ALTER TABLE app_user ADD CONSTRAINT app_user_github_user_id_key UNIQUE (github_user_id);
  END IF;
END
$$;

-- 2. 영향 사용자 조회 (DEV-045).
--
-- 없으면 `repository` 웹훅 하나가 permission_cache 전량 스캔이 된다. org_team
-- 모드 사용자는 저장소를 나열하지 않으므로 org_ids로 따로 찾는다.
CREATE INDEX IF NOT EXISTS permission_cache_repos_idx ON permission_cache USING GIN (repository_ids);
CREATE INDEX IF NOT EXISTS permission_cache_orgs_idx  ON permission_cache USING GIN (org_ids);

-- 3. 울타리 (DEV-044).
--
-- 캐시 행이 "어느 버전으로 계산된 것인지"를 들고 있어야, 회수 직전에 시작된
-- 조회가 회수 뒤에 끝나면서 회수 이전 범위를 되살리는 것을 막을 수 있다.
ALTER TABLE permission_cache ADD COLUMN IF NOT EXISTS access_scope_version INT NOT NULL DEFAULT 0;

-- org_team 모드는 가시성 조건도 함께 쓴다 (보안 문서 5.2). 상수로 두지 않고
-- 저장하는 이유는 사용자마다 조직 기본 권한이 다를 수 있기 때문이다.
ALTER TABLE permission_cache ADD COLUMN IF NOT EXISTS visibilities TEXT[] NOT NULL DEFAULT '{}';

-- 팀 구성원 갱신 시각. GHE에서 다시 읽어야 하는지 판단한다 (DEV-046).
ALTER TABLE team ADD COLUMN IF NOT EXISTS members_refreshed_at TIMESTAMPTZ;
