DROP INDEX IF EXISTS repository_allowed_teams_idx;
ALTER TABLE repository DROP COLUMN IF EXISTS allowed_team_ids;
