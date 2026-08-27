-- 저장소 개요의 정본 (WP-034 / CR-050, DEV-351·352).
--
-- ## 왜 필요한가
--
-- W-009는 일반 사용자가 "왜 이 저장소 결과가 없는가"를 스스로 확인하는
-- 화면이다. 그 화면이 묻는 것 중 둘에 답할 정본이 없었다.
--
-- **등록 검토 요청** — 와이어프레임의 `repo.request_registration` 이벤트,
-- QA-W009-05, `A-002-REQUESTS` 섹션, 상태 매트릭스의 `empty_no_repository`
-- 복구 경로 넷이 모두 이 기능을 전제하는데 표도 API도 없었다 (DEV-351).
--
-- **최근 완료된 조정 스캔의 누락 건수** — `reconcile_missing_total`은
-- 프로세스 수명 동안 누적되는 counter라 "가장 최근 완료된 회차에서 몇 건"이
-- 아니고, 지표 저장소가 없는 배치에서는 조회 서비스가 읽지도 못한다
-- (DEV-352).
--
-- ## CREATE INDEX CONCURRENTLY를 쓰지 않는 이유
--
-- 마이그레이션 러너가 하나를 단일 트랜잭션에서 실행한다
-- (`packages/db/src/migrate.ts`의 `withTransaction`). `CONCURRENTLY`는
-- 트랜잭션 블록 안에서 실행할 수 없다. 014·015가 같은 판단을 했다.

-- ## 최근 **완료된** 조정 결과 (FR-ING-011 AC-6)
--
-- 완주한 회차만 이 두 열을 덮는다. 한도 소진으로 미룬 회차
-- (`ReconcileResult.deferred`)의 부분 집계는 **언제나 실제보다 작고**,
-- 그것을 "최근 결과"로 보이면 사용자는 "거의 다 수집됐다"로 읽는다 —
-- 이 화면의 목적이 정확히 그 오독을 막는 것이다.
--
-- 두 열이 함께 NULL이면 "완료된 조정 스캔 기록이 없다"이고, 0은 "확인했고
-- 누락이 없다"이다. 화면은 셋을 다른 문구로 그린다.
--
-- Prometheus counter를 대체하지 않는다 — 지표는 운영 추세를, 이 열은
-- 사용자 진단 시점의 상태를 나타내며 책임이 다르다.
ALTER TABLE repository ADD COLUMN last_reconciled_at TIMESTAMPTZ;
ALTER TABLE repository ADD COLUMN last_reconcile_missing_count INTEGER;

ALTER TABLE repository ADD CONSTRAINT repository_reconcile_missing_chk
  CHECK (last_reconcile_missing_count IS NULL OR last_reconcile_missing_count >= 0);

-- ## 등록 검토 요청 (ENT-CORE-008 / FR-ING-009 AC-8·9·10)
--
-- 행 하나가 뜻하는 것은 **"이 사용자가 이 식별자의 등록 검토를 요청했다"**
-- 뿐이다. 저장소가 실제로 존재한다는 뜻도, 요청자가 그것을 볼 수 있다는
-- 뜻도 아니다 — 기록 시점에 GitHub Enterprise에 묻지 않기 때문이다.
-- 그래서 `repository_id`도 `org_id`도 `visibility`도 여기 없다. 그 값들은
-- GHE에 물어야만 알 수 있고, 묻는 순간 이 경로가 비공개 저장소의 존재
-- 신탁이 된다 (AC-10, THR-004·THR-041).
--
-- **승인·반려 수명주기를 만들지 않는다.** 운영자가 이 요청을 처리하는
-- 경로는 A-002를 세우는 WP-040의 몫이고, 그 수명주기는 그 WP가 검증한다.
-- 지금 열을 미리 만들면 검증되지 않은 수명주기를 스키마가 선점하며,
-- 그것은 다시 "표는 있는데 뜻이 정해지지 않은 열"을 만든다 — CR-049가
-- `saved_search.team_id`에서 겪은 바로 그 상태다.
CREATE TABLE repository_registration_request (
  request_id        BIGSERIAL   PRIMARY KEY,
  -- 사용자를 지우면 그의 요청도 사라진다 (보존 표의 정책).
  -- `saved_search`가 이 정책을 스키마에 갖지 못해 표를 처음 채우는 순간
  -- 드러났던 자리(DEV-347)를 같은 방식으로 반복하지 않는다.
  requested_by      TEXT        NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  repository_owner  TEXT        NOT NULL,
  repository_name   TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 멱등의 근거다 (AC-9). 같은 사용자의 같은 식별자 반복 요청은 새 행을
  -- 만들지 않고 기존 행을 돌려준다. 다른 사용자의 같은 저장소 요청은
  -- 각자의 행이며, 그래야 운영자가 "몇 사람이 요청했는가"를 셀 수 있다.
  UNIQUE (requested_by, repository_owner, repository_name)
);

-- 운영자가 슬러그로 요청을 모아 보는 경로 (A-002, WP-040).
CREATE INDEX repository_registration_request_slug_idx
  ON repository_registration_request (repository_owner, repository_name, created_at DESC);
