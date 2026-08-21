-- 실패 대기열 정합성 (CR-012, DEV-022·DEV-023).
--
-- 세 가지를 고친다.
--   1. (delivery_id, stage) 유일 제약 — EVT-ING-004가 정한 멱등 키를 저장
--      계층이 강제하게 한다. 제약이 없으면 재처리가 실패할 때마다
--      reprocess_count = 0 인 새 행이 생겨 "3회 실패 시 보류"가 성립하지 않는다.
--   2. resolved 상태 — 재처리 성공을 표현할 자리. 없으면 성공한 행이
--      reprocessing 으로 남아 100건 경보 임계를 영구히 잠식한다.
--   3. repository_id — A-001의 저장소 필터용. raw_event 는 received_at 파티션이라
--      delivery_id 조인이 전 파티션을 훑는다.

ALTER TABLE dead_letter ADD COLUMN repository_id BIGINT;

-- 제약을 걸기 전에 기존 중복을 접는다. 가장 최근 행을 남기고 재처리 횟수는
-- 합산한다 — 그 값이 "이 이벤트가 몇 번 되살리기에 실패했는가"라는 뜻이다.
WITH folded AS (
  SELECT delivery_id,
         stage,
         max(dead_letter_id)      AS keep_id,
         sum(reprocess_count)     AS total_reprocess
    FROM dead_letter
   GROUP BY delivery_id, stage
  HAVING count(*) > 1
)
UPDATE dead_letter d
   SET reprocess_count = f.total_reprocess
  FROM folded f
 WHERE d.dead_letter_id = f.keep_id;

DELETE FROM dead_letter d
 USING (
   SELECT delivery_id, stage, max(dead_letter_id) AS keep_id
     FROM dead_letter
    GROUP BY delivery_id, stage
 ) k
 WHERE d.delivery_id = k.delivery_id
   AND d.stage       = k.stage
   AND d.dead_letter_id <> k.keep_id;

ALTER TABLE dead_letter ADD CONSTRAINT dead_letter_delivery_stage_uk UNIQUE (delivery_id, stage);

ALTER TABLE dead_letter DROP CONSTRAINT dead_letter_state_chk;
ALTER TABLE dead_letter ADD  CONSTRAINT dead_letter_state_chk
  CHECK (state IN ('pending', 'reprocessing', 'held', 'resolved'));

CREATE INDEX dead_letter_repo_idx ON dead_letter (repository_id, created_at DESC);
