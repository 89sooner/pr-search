-- 표기 결과의 확실성을 구분한다 (WP-075 안전성 보강).
--
-- ## 왜 상태 넷으로는 부족한가
--
-- 025의 `annotate_state`는 `done`·`mismatch`·`failed`·`disabled` 넷이다. 이 넷은
-- **원격에서 무슨 일이 있었는지 모르는 경우**를 담지 못한다.
--
-- 1. **`body_changed`** — PATCH는 성공했는데 서버가 저장한 제목이 보낸 값과 다르다.
--    지금은 `failed`로 남는데, 그러면 다음 회차가 제목을 다시 읽고 **접두가 있다는
--    것만으로** `done`으로 덮는다. 「원래 제목의 나머지는 바꾸지 않는다」(`AC-1`)가
--    깨진 사실이 한 회차 만에 성공으로 사라진다. 이 상태는 **자동으로 풀리지 않고**
--    운영자가 확인한 뒤에만 다시 시도한다.
--
-- 2. **`unknown`** — 요청을 보냈는데 응답을 받지 못했다(시한 초과·연결 끊김·예산
--    만료·게이트웨이 5xx). 공식 API가 멱등성 키도 요청 조회도 제공하지 않으므로
--    **서버가 처리했는지 확정할 방법이 없다**. `failed`로 적으면 「실패했다」가
--    거짓일 수 있고, `done`으로 적으면 「했다」가 거짓일 수 있다. 모른다고 적고
--    다음 회차가 제목을 다시 읽어 확인한다.
--
-- ## 무엇을 남기고 무엇을 남기지 않는가
--
-- 제목 **원문을 이 표에 복제하지 않는다.** 남기는 것은 기대한 제목의 해시 앞 16자와
-- 짧은 사유 코드, 그리고 시도 식별자뿐이다. 해시가 새 노출을 만들지 않는 이유는
-- 제목 원문이 이미 `pull_request_snapshot`과 검색 색인에 있기 때문이며, 여기서
-- 필요한 것은 「그때 무엇을 쓰려 했는가」를 나중에 대조할 수 있는 지문뿐이다.
--
-- 보존 기간을 따로 두지 않는다. 이 세 열은 `merge_sequence` 행에 붙어 그 행의
-- 수명을 그대로 따르며, 행이 지워지면 함께 사라진다.

ALTER TABLE merge_sequence
  DROP CONSTRAINT merge_sequence_annotate_state_chk;

ALTER TABLE merge_sequence
  ADD CONSTRAINT merge_sequence_annotate_state_chk
    CHECK (annotate_state IS NULL OR annotate_state IN
      ('done', 'mismatch', 'failed', 'disabled', 'body_changed', 'unknown'));

ALTER TABLE merge_sequence
  -- 마지막 시도의 식별자. 감사 기록과 이 행을 나중에 맞춰 볼 유일한 끈이다.
  ADD COLUMN annotate_attempt_id     UUID,
  -- 그때 쓰려 한 제목의 지문. 원문이 아니라 해시 앞 16자다.
  ADD COLUMN annotate_expected_digest TEXT,
  -- 결과 사유 코드. 자유 문장이 아니라 짧은 식별자다.
  ADD COLUMN annotate_result_reason  TEXT;

ALTER TABLE merge_sequence
  ADD CONSTRAINT merge_sequence_annotate_digest_len_chk
    CHECK (annotate_expected_digest IS NULL OR char_length(annotate_expected_digest) <= 16),
  ADD CONSTRAINT merge_sequence_annotate_reason_len_chk
    CHECK (annotate_result_reason IS NULL OR char_length(annotate_result_reason) <= 64);

-- 인덱스를 만들지 않는다. 이 열들을 읽는 것은 저장소를 좁힌 사전 점검의 집계뿐이고,
-- 대상 질의는 기존 조건으로 이미 좁혀진다. 쓰이지 않는 인덱스는 쓰기 비용만 더한다.
