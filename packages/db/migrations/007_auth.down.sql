ALTER TABLE team DROP COLUMN IF EXISTS members_refreshed_at;
ALTER TABLE permission_cache DROP COLUMN IF EXISTS visibilities;
ALTER TABLE permission_cache DROP COLUMN IF EXISTS access_scope_version;
DROP INDEX IF EXISTS permission_cache_orgs_idx;
DROP INDEX IF EXISTS permission_cache_repos_idx;
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_github_user_id_key;
ALTER TABLE app_user DROP COLUMN IF EXISTS github_user_id;
