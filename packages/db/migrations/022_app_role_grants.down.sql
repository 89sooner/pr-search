-- 022 되돌리기 (CR-060). 005가 열거하지 않았던 상태로 되돌린다.
REVOKE SELECT, INSERT, UPDATE, DELETE ON
  pull_request_snapshot, commit_snapshot,
  repository_registration_request,
  team_membership, org_team_sync
FROM prs_app;
