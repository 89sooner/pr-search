-- 저장소 팀 접근 범위 (WP-068 / CR-035, DEV-114 해소).
--
-- 네 색인 매핑이 모두 `allowed_team_ids`를 선언하고 강제 필터(`team:` 질의와
-- `org_team` 접근 범위)가 그 값을 읽는데, **그것을 만드는 자리가 없었다.**
-- 그 결과 `team:<slug>` 검색이 한 건도 맞히지 못하고, 500개를 넘어 `org_team`
-- 경로로 전환된 사용자는 **팀으로만 볼 수 있는 비공개 저장소를 잃는다.**
-- 실패 방향이 과소 허용이라 유출은 아니지만 승인된 기능이 죽어 있다.
--
-- 레지스트리가 소유한다 (CR-024). 이벤트(EVT-ING-002)에 싣지 않는 이유는
-- 팀 권한이 **PR 엔티티의 버전이 아니라 저장소 접근 상태**이기 때문이다 —
-- 같은 PR 문서가 권한 변경으로 새 버전을 받으면 안 된다.

ALTER TABLE repository
  ADD COLUMN allowed_team_ids BIGINT[] NOT NULL DEFAULT '{}';

-- `allowed_team_ids @> ARRAY[$1]` 형태의 포함 질의를 위한 색인.
CREATE INDEX repository_allowed_teams_idx
  ON repository USING GIN (allowed_team_ids);
