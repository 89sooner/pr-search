-- 작성자 소속 팀 (WP-069 / CR-058, DEV-482·485).
--
-- ## `team_member`와 무엇이 다른가
--
-- `team_member.user_id`는 `app_user(user_id)`를 참조한다. 그 뜻은 **"이 팀에
-- 속한 PR Search 사용자"**이고 `JOB-AUTH-001`의 무효화가 그 뜻으로 읽는다.
-- PR 작성자는 대부분 PR Search에 로그인한 적이 없어 `app_user`에 없으므로
-- 그 표에 들어갈 수 없다 — `replaceTeamMembers`가 외래 키에 걸리는 사람을
-- 버리는 것은 설계대로다.
--
-- 여기 담는 것은 **"이 팀에 속한 GHE 사용자"**다. 둘을 한 표에 담으면
-- `allowed_team_ids`와 `author_team_ids`를 한 필드로 합치는 것과 같은 오류가
-- 된다 — 접근 권한과 작성자 소속은 다른 사실이다 (CR-053, DEV-382).
--
-- ## 왜 PostgreSQL인가
--
-- `ADR-004`의 불변 조건은 "Elasticsearch의 모든 엔티티 문서는 PostgreSQL
-- 데이터만으로 재구성 가능해야 한다"이고 재색인 경로는 GHE를 한 번도 부르지
-- 않는다. `WP-069`의 DoD가 "소속 변경이 재색인으로 반영된다"를 요구하므로
-- 소속은 재색인이 읽을 수 있는 곳에 있어야 한다.
--
-- ## login으로 키를 잡는 이유
--
-- 문서의 `author`가 login이다. GHE 숫자 id가 개명에 강하지만 투영이 손에 쥐고
-- 있는 값은 login 하나이며, 없는 값을 지어내 맞추지 않는다. 개명은 다음 조직
-- 동기화가 교체로 흡수한다.
CREATE TABLE team_membership (
  team_id BIGINT NOT NULL REFERENCES team(team_id) ON DELETE CASCADE,
  login   TEXT   NOT NULL,
  PRIMARY KEY (team_id, login)
);

-- 작성자 하나로 팀을 찾는 조회가 이 색인을 탄다. 없으면 투영마다 전량 스캔이다.
CREATE INDEX team_membership_login_idx ON team_membership (login);

-- 조직별 동기화 시각 (WP-069 / CR-058, DEV-486).
--
-- **이 값이 아는 것과 모르는 것의 경계다.** 신선하면 그 조직에서 작성자가
-- 어느 팀에도 없다는 것이 **사실**이므로 `author_team_ids: []`를 쓴다. 낡았거나
-- 행이 없으면 **모름**이므로 필드를 쓰지 않고 이미 색인된 값을 지운다.
-- 그러므로 이 행을 지우는 것은 "팀이 없다"가 아니라 "다시 물어봐야 한다"이다.
CREATE TABLE org_team_sync (
  org_id    BIGINT      PRIMARY KEY,
  synced_at TIMESTAMPTZ NOT NULL
);
