-- PR 제목 표기 정책 (WP-075 / CR-084, FR-SEQ-009 AC-6, ADR-022 결정 3).
--
-- ## 운영자의 정책과 실행 중 차단은 다른 사실이다
--
-- `annotate_enabled`는 **운영자가 적어 낸 값**이다. `THR-046`이 실제로 일어났을 때
-- (틀린 값이 계속 쓰일 때) 가장 먼저 끄는 스위치이며 이 제품은 그 값을 스스로
-- 바꾸지 않는다.
--
-- `annotate_blocked_at`은 **표기 잡이 GHE에서 권한 오류를 받아 스스로 멈춘 사실**이다.
-- 둘을 한 열에 담으면 권한 오류 한 번이 운영자의 설정을 조용히 뒤집고, 권한이
-- 복구된 뒤에도 운영자는 자기가 켜 둔 저장소가 왜 꺼져 있는지 알 수 없다.
-- `FR-SEQ-009`의 예외 처리("403·404면 그 저장소의 표기를 중단하고 사유를 남긴다")가
-- 요구하는 것은 **중단과 사유**이지 정책 변경이 아니다.
--
-- ## 기본값이 `true`인데 왜 이 마이그레이션만으로는 아무것도 쓰지 않는가
--
-- 전역 스위치 `MNUMBER_ANNOTATE_ENABLED`의 기본값이 `false`다. 저장소 기본값을
-- `false`로 두면 "개별 해제"가 아니라 "개별 허용"이 되어 `AC-6`의 문구와 어긋나고,
-- 운영자가 저장소를 하나씩 켜야 기능이 시작된다. 그래서 저장소는 기본 허용으로
-- 두되 **실제 쓰기는 전역 스위치가 연다** — `mirror_enabled`가 기본 `true`이면서도
-- 미러 역할을 세우지 않으면 아무것도 복제하지 않는 것과 같은 구조다.

ALTER TABLE repository
  -- FR-SEQ-009 AC-6. 꺼진 저장소는 채번은 계속하고 표기만 멈춘다.
  ADD COLUMN annotate_enabled       BOOLEAN NOT NULL DEFAULT true,
  -- 권한 오류로 표기 잡이 스스로 멈춘 시각. 운영자 정책과 섞지 않는다.
  ADD COLUMN annotate_blocked_at    TIMESTAMPTZ,
  ADD COLUMN annotate_blocked_reason TEXT;

ALTER TABLE repository
  -- 시각과 사유는 함께 있거나 함께 없다. 한쪽만 걸면 "멈췄는데 왜인지 모르는 행"이
  -- 통과한다 (020의 `resolved_at` 등가 제약과 같은 규율).
  ADD CONSTRAINT repository_annotate_blocked_chk
    CHECK ((annotate_blocked_at IS NULL) = (annotate_blocked_reason IS NULL)),
  -- 사유는 고정 enum이 아니라 짧은 문구다. 상한이 없으면 GHE 오류 본문이 그대로 들어온다.
  ADD CONSTRAINT repository_annotate_blocked_reason_len_chk
    CHECK (annotate_blocked_reason IS NULL OR char_length(annotate_blocked_reason) <= 200);

-- 잔여 스윕이 대상 저장소만 고른다. 차단된 저장소는 스윕이 쿨다운으로 다시 보므로
-- 색인에서 제외하지 않는다 — 제외하면 권한이 복구돼도 영영 재시도하지 않는다.
CREATE INDEX repository_annotate_enabled_idx
  ON repository (repository_id)
  WHERE annotate_enabled;
