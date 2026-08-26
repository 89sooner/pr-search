-- 014 되돌리기 (CR-041). 인덱스만 만들었으므로 인덱스만 지운다.
DROP INDEX IF EXISTS pull_request_snapshot_base_branch_idx;
DROP INDEX IF EXISTS pull_request_snapshot_open_head_idx;
DROP INDEX IF EXISTS pull_request_snapshot_title_idx;
DROP INDEX IF EXISTS commit_snapshot_subject_idx;
DROP INDEX IF EXISTS commit_snapshot_patch_candidate_idx;
