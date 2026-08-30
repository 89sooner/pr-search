-- 등록 검토 요청의 처리 결과 (WP-040 / CR-055, DEV-428).
--
-- ## CR-050이 미뤄 둔 자리다
--
-- 마이그레이션 016은 이 표를 만들면서 "승인·반려 상태를 지금 만들지 않는다"고
-- 적었다 — 운영자가 요청을 처리하는 경로가 `A-002`를 세우는 `WP-040`의 몫이고,
-- 검증되지 않은 수명주기를 스키마가 선점하면 "표는 있는데 뜻이 정해지지 않은
-- 열"이 되기 때문이었다 (`CR-049`가 `saved_search.team_id`에서 겪은 상태).
-- `CR-055`가 그 수명주기를 확정했으므로 이제 담는다.
--
-- ## 상태는 셋뿐이며 그 사이에 승인을 두지 않는다
--
-- `pending` · `fulfilled` · `dismissed` (FR-ING-009 AC-11). 별도 `approved`가
-- 없는 이유는 **등록되지 않은 채 승인된 행이 아무것도 보장하지 못하기**
-- 때문이다 — 수집도 채번도 시작되지 않았고 요청자에게 보이는 것도 달라지지
-- 않는다. 승인은 성공한 등록 그 자체이며, `API-ADM-001`의 등록이 같은 정규화
-- 식별자의 `pending` 행 전부를 `fulfilled`로 옮긴다.
--
-- ## 기존 행을 소급하지 않는다
--
-- 같은 식별자의 저장소가 지금 `active`라는 사실은 **그 등록이 이 요청 때문에
-- 일어났다는 뜻이 아니다.** 요청보다 먼저 등록됐을 수도 있고, 그렇다면 이 행을
-- 닫는 것은 일어나지 않은 인과를 정본에 적는 일이다. 게다가 `resolved_at`·
-- `resolved_by`를 채울 진짜 값이 없어 아래 제약을 만족시키려면 시각과 처리자를
-- 지어내야 한다. 모르는 것을 지어내지 않고 `pending`으로 둔다 — 운영자가
-- 대기열에서 한 번에 정리하며 그 처리는 실제 시각과 실제 처리자를 갖는다.

ALTER TABLE repository_registration_request
  ADD COLUMN status          TEXT        NOT NULL DEFAULT 'pending',
  -- 처리한 운영자가 퇴사해도 요청 기록은 남아야 한다. `requested_by`의
  -- `CASCADE`와 다른 이유는 지우는 대상이 다르기 때문이다 — 요청자를 지우면
  -- 그의 요청도 사라지는 것이 보존 표의 정책이지만, 처리자를 지운다고 그가
  -- 처리한 기록까지 사라지면 "언제 닫혔는지"를 잃는다.
  ADD COLUMN resolved_at     TIMESTAMPTZ,
  ADD COLUMN resolved_by     TEXT        REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN resolution_note TEXT;

ALTER TABLE repository_registration_request
  ADD CONSTRAINT repository_registration_request_status_chk
    CHECK (status IN ('pending', 'fulfilled', 'dismissed'));

-- 종료된 요청은 종료 시각을 갖고 대기 중 요청은 갖지 않는다. **등가로 걸어야**
-- 두 방향이 함께 막힌다 — 한쪽만 걸면 "닫혔는데 언제 닫혔는지 모르는 행"이나
-- "열려 있는데 종료 시각이 있는 행" 중 하나가 통과한다.
ALTER TABLE repository_registration_request
  ADD CONSTRAINT repository_registration_request_resolution_chk
    CHECK ((status = 'pending') = (resolved_at IS NULL));

-- 처리 메모는 운영자가 손으로 적는 값이라 상한이 필요하다. 감사 기록의
-- `query` 칸으로도 함께 가므로 무한히 길면 그 표까지 오염된다.
ALTER TABLE repository_registration_request
  ADD CONSTRAINT repository_registration_request_note_chk
    CHECK (resolution_note IS NULL OR length(resolution_note) <= 500);

-- 운영자 대기열의 키셋 순회 (API-ADM-009). 정렬 키를 그대로 담는다 —
-- 목록의 기본 필터가 `status`이고 정렬이 `created_at DESC, request_id DESC`다.
CREATE INDEX repository_registration_request_queue_idx
  ON repository_registration_request (status, created_at DESC, request_id DESC);
