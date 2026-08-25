-- PR 정본 스냅숏 (CR-034, DEV-184 / ADR-004).
--
-- ## 왜 필요한가
--
-- ADR-004는 "Elasticsearch는 PostgreSQL만으로 전량 재구성 가능하며 어떤 데이터도
-- 검색 인덱스에만 존재해서는 안 된다"고 정한다. 웹훅으로 들어온 PR은 `raw_event`가
-- 그 근거이지만, **백필·조정 스캔은 GHE에서 직접 읽어 Elasticsearch에만 쓴다** —
-- `raw_event` 행을 남기지 않는다. 그 PR들은 색인에만 존재하며, 색인을 잃으면
-- 되살릴 근거가 PostgreSQL에 없다.
--
-- 그 공백을 메우는 가장 작은 정본이다. 투영이 만든 **문서 그대로**를 담아
-- 재구성과 정합성 대조가 같은 근거를 읽게 한다.
--
-- ## 왜 raw_event 를 흉내 내지 않는가
--
-- 합성 웹훅을 만들어 `raw_event`에 넣으면 "받은 적 없는 전달"이 원본 아카이브에
-- 섞인다. 원본 레인은 받은 것만 담아야 감사 근거로 쓸 수 있다.
--
-- ## 버전 순서
--
-- `document_version`은 Elasticsearch 업서트와 **같은 값**이다. 백필은 엔티티의
-- `updated_at`을, 실시간은 웹훅 수신 시각을 쓴다 (DEV-099). 그래서 오래된 백필이
-- 최신 웹훅을 덮어쓰지 않는 규칙이 이 표에서도 그대로 성립한다.

CREATE TABLE pull_request_snapshot (
  repository_id    BIGINT      NOT NULL,
  pr_number        INT         NOT NULL,
  -- Elasticsearch 문서와 같은 버전. 조건부 업서트의 기준이다.
  document_version BIGINT      NOT NULL,
  -- 이 스냅숏을 남긴 경로. 'webhook' | 'backfill' | 'reconcile'.
  source           TEXT        NOT NULL,
  -- 투영이 만든 문서 그대로. 소스 코드·패치 본문은 애초에 들어 있지 않다
  -- (문서는 변경 경로 이름만 담는다).
  document         JSONB       NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, pr_number),
  CONSTRAINT pull_request_snapshot_source_chk CHECK (source IN ('webhook', 'backfill', 'reconcile'))
);

-- 저장소별 최신순 조회 (정합성 대조의 표본 추출).
CREATE INDEX pull_request_snapshot_repo_idx
  ON pull_request_snapshot (repository_id, pr_number DESC);
