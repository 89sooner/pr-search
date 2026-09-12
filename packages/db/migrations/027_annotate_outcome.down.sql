-- 027 회수 (WP-075 안전성 보강).
--
-- **되돌리기 전에 새 상태를 옛 어휘로 접는다.** `body_changed`와 `unknown`을 그대로
-- 두면 025의 제약이 돌아오는 순간 위반이 되어 회수 자체가 실패한다. 접는 방향은
-- `failed`다 — 둘 다 「이 행은 아직 끝나지 않았다」는 뜻이고, `done`으로 접으면
-- 확인하지 못한 것을 성공으로 굳힌다.
--
-- 접고 나면 「본문이 바뀌었다」와 「결과를 모른다」의 구분은 사라진다. 되돌린 뒤의
-- 코드는 그 구분을 읽지 않으므로 동작은 025 시절과 같아지지만, **잃은 사실은
-- 돌아오지 않는다.** 그래서 이 회수는 기능을 끄는 수단이 아니다 — 끄는 것은 전역
-- 스위치이며, 이미 GHE에 붙은 접두는 어느 쪽으로도 되돌아가지 않는다.

UPDATE merge_sequence
   SET annotate_state = 'failed'
 WHERE annotate_state IN ('body_changed', 'unknown');

ALTER TABLE merge_sequence
  DROP CONSTRAINT merge_sequence_annotate_reason_len_chk,
  DROP CONSTRAINT merge_sequence_annotate_digest_len_chk;

ALTER TABLE merge_sequence
  DROP COLUMN annotate_result_reason,
  DROP COLUMN annotate_expected_digest,
  DROP COLUMN annotate_attempt_id;

ALTER TABLE merge_sequence
  DROP CONSTRAINT merge_sequence_annotate_state_chk;

ALTER TABLE merge_sequence
  ADD CONSTRAINT merge_sequence_annotate_state_chk
    CHECK (annotate_state IS NULL OR annotate_state IN ('done', 'mismatch', 'failed', 'disabled'));
