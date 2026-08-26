-- 커밋 정본 스냅숏 (WP-067 / CR-038, DEV-208 / ADR-004).
--
-- ## 왜 필요한가
--
-- ADR-004는 "Elasticsearch는 PostgreSQL만으로 전량 재구성 가능하며 어떤 데이터도
-- 검색 인덱스에만 존재해서는 안 된다"고 정한다. 그런데 커밋 **자체의** 메타데이터
-- (메시지·작성자·부모·변경 경로·patch-id)는 이 스키마 어디에도 정규화된 자리가
-- 없다 — `merge_sequence`는 서수와 SHA만 알고, `raw_event`는 웹훅으로 들어온
-- 것만 담는다.
--
-- WP-067을 원래 계약대로 구현하면 그 값들이 **색인에만** 존재하게 되고, 색인을
-- 잃으면 되살릴 근거가 없다. CR-034가 PR 축에서 이미 겪은 결함과 같은 모양이다
-- (마이그레이션 010). 같은 실수를 커밋 축에서 반복하지 않는다.
--
-- ## 무엇을 담지 않는가
--
-- **소스 코드 본문과 patch 본문은 어떤 열에도 담지 않는다** (NFR-005). 변경 경로는
-- 파일 **이름**이고, `patch_id`는 diff의 해시이지 diff가 아니다. 커밋 메시지는
-- 검색 대상이라 담지만 그것은 코드가 아니다.
--
-- 이메일도 담지 않는다 — CR-038이 승인한 필드 목록에 없다.
--
-- ## 값은 불변이다
--
-- 여기 담긴 것은 전부 커밋 객체가 가진 값이라 같은 SHA면 언제 읽어도 같다.
-- 그래서 보강이 멱등하고, `document_version`을 올릴 이유가 없다 (DEV-209).

CREATE TABLE commit_snapshot (
  repository_id           BIGINT      NOT NULL,
  commit_sha              TEXT        NOT NULL,

  parent_shas             TEXT[]      NOT NULL DEFAULT '{}',
  message                 TEXT        NOT NULL DEFAULT '',
  author                  TEXT,
  committer               TEXT,
  authored_at             TIMESTAMPTZ NOT NULL,
  committed_at            TIMESTAMPTZ NOT NULL,

  -- 파일 이름만. 내용은 담지 않는다 (NFR-005).
  changed_paths           TEXT[]      NOT NULL DEFAULT '{}',
  changed_paths_truncated BOOLEAN     NOT NULL DEFAULT false,

  -- diff의 해시이지 diff가 아니다. 못 얻었으면 사유를 적는다 (FR-REL-005 AC-5).
  patch_id                TEXT,
  patch_id_unavailable    TEXT,

  -- 'mirror' | 'api'. 두 경로가 같은 값을 내야 한다는 DoD의 조사 근거다.
  metadata_source         TEXT        NOT NULL,
  fetched_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 색인 투영이 성공한 시점. NULL이면 정본은 있으나 **색인이 아직 없다**.
  --
  -- 정본을 색인보다 먼저 쓰므로, 색인 쓰기가 실패한 커밋은 스냅숏만 남는다.
  -- 스윕이 "스냅숏이 없는 커밋"만 찾으면 그 커밋은 **영원히 재시도되지 않는다** —
  -- 다시 투영할 다른 경로도 없다. 그래서 투영 상태를 따로 들고 있는다.
  projected_at            TIMESTAMPTZ,

  PRIMARY KEY (repository_id, commit_sha),
  CONSTRAINT commit_snapshot_source_chk CHECK (metadata_source IN ('mirror', 'api')),
  CONSTRAINT commit_snapshot_patch_chk CHECK (
    patch_id IS NULL OR patch_id_unavailable IS NULL
  )
);

-- 미보강 잔여분 스윕이 "정본이 아직 모르는 커밋"을 저장소별로 훑는다.
CREATE INDEX commit_snapshot_repo_idx ON commit_snapshot (repository_id, fetched_at);

-- 색인 투영이 밀린 커밋을 싸게 찾는다 (스윕의 두 번째 대상).
CREATE INDEX commit_snapshot_unprojected_idx
  ON commit_snapshot (repository_id)
  WHERE projected_at IS NULL;
