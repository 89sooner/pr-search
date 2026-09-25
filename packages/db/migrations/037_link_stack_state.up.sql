-- 스택 관계의 정본과 prs-links 재색인의 미처리 작업 (WP-104 / CR-121, FR-REL-006 AC-6, FR-ING-008 AC-11, OD-017).
--
-- ## 왜 스택에만 표가 필요한가
--
-- 간선(ENT-REL-002)은 Elasticsearch에만 있고, 재색인은 정본 엔티티(PR·커밋 스냅숏)에서
-- 다시 파생해 만든다 (ADR-004). `references`·`reverts`·`cherry_picks`는 source의 **현재**
-- 정본만 보면 답이 나오므로 그것으로 충분하다.
--
-- `stacks_on`은 다르다. 성립 조건이 「하위 PR의 base = 다른 **열린** PR의 head」라서,
-- 상위 PR이 병합되거나 하위 PR이 retarget되는 순간 현재 스냅숏에서는 그 관계가 보이지
-- 않는다. 그런데 FR-REL-006 AC-3은 그때 간선을 지우지 말고 **해제 상태로 표시**하라고
-- 요구한다(DEV-238 — 지우면 「그런 의존이 있었다」는 사실이 사라진다). 그 사실은 지금까지
-- 서비스 인덱스에만 있었고, 그래서 prs-links 재색인이 `completed`로 끝나도 해제 간선이
-- 새 인덱스에서 조용히 사라졌다(사내 pilot.18 재현). 사용자 결정 OD-017: 스택의 성립과
-- 해제를 PostgreSQL에 남기고, 간선은 이 표에서 파생한다.
--
-- ## 두 표가 맡는 것
--
-- 1. `pull_request_stack` — 한 번이라도 성립한 스택 관계. 행 하나가 「저장소 R의 PR C가
--    PR P 위에 쌓였(었)다」이다. **성립한 적 있는 관계만 행이 된다** — 한 번도 성립하지
--    않은 후보에 해제 상태를 미리 두지 않는다(DEV-238). 관계가 다시 성립하면 같은 행이
--    `detached = false`로 돌아온다. 행을 지우지 않는다.
-- 2. `reindex_link_pending` — prs-links 재색인이 아직 끝내지 못한 source 작업. 간선의
--    부분 갱신이 새 인덱스에서 그 간선을 찾지 못했거나(소유 source가 아직 재구축되지
--    않았다), source 파생이 불완전했다. 잡이 전환 전에 소유 source를 정본에서 다시
--    파생해 이 행을 비우고, 비우지 못하면 전환하지 않는다. **메모리에 두지 않는다** —
--    잡이 멈췄다 재개돼도 할 일이 여기 남는다.

CREATE TABLE pull_request_stack (
  repository_id    BIGINT      NOT NULL,
  child_pr_number  INT         NOT NULL,
  parent_pr_number INT         NOT NULL,
  -- 마지막으로 성립했을 때의 근거. 간선 문서의 `evidence`와 같은 문자열이다.
  evidence         TEXT        NOT NULL,
  /*
   * 간선 문서의 `created_at`과 같은 문자열 — **source(하위 PR)의 정본 시각**이다(CR-039).
   * 성립해 있는 동안은 파생할 때마다 하위 PR의 현재 정본 시각으로 갱신하고, 해제되면 그
   * 값에서 멈춘다. 그래서 같은 정본에서 재구축과 평시 파생이 같은 문서를 낸다.
   */
  edge_created_at  TEXT        NOT NULL,
  detached         BOOLEAN     NOT NULL DEFAULT false,
  -- `derived`: 파생이 만들었다. `imported`: 배포 전 서비스 인덱스의 간선을 일회성 명령이 옮겼다.
  origin           TEXT        NOT NULL,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (repository_id, child_pr_number, parent_pr_number),
  CONSTRAINT pull_request_stack_pr_chk
    CHECK (child_pr_number > 0 AND parent_pr_number > 0 AND child_pr_number <> parent_pr_number),
  CONSTRAINT pull_request_stack_origin_chk
    CHECK (origin IN ('derived', 'imported'))
);

-- 상위 PR이 바뀌면(병합·retarget) 그 위에 쌓였던 하위 PR을 찾는다 — 역방향 재평가.
CREATE INDEX pull_request_stack_parent_idx
  ON pull_request_stack (repository_id, parent_pr_number);

CREATE TABLE reindex_link_pending (
  job_id         BIGINT      NOT NULL,
  -- 소유 source의 저장소. 간선의 routing이다.
  repository_id  BIGINT      NOT NULL,
  source_kind    TEXT        NOT NULL,
  -- PR 번호(10진 문자열) 또는 소문자 40자 SHA.
  source_id      TEXT        NOT NULL,
  reason         TEXT        NOT NULL,
  /*
   * 같은 source의 미처리가 다시 기록될 때마다 오른다. 회수는 **읽은 세대의 행만** 지운다 —
   * 회수하는 동안 새로 생긴 미처리를 함께 지우지 않는다.
   */
  generation     INT         NOT NULL DEFAULT 1,
  -- 진단용 표본 하나(마지막으로 문서를 찾지 못한 간선).
  sample_link_id TEXT,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (job_id, repository_id, source_kind, source_id),
  CONSTRAINT reindex_link_pending_kind_chk
    CHECK (source_kind IN ('pull_request', 'commit')),
  CONSTRAINT reindex_link_pending_reason_chk
    CHECK (reason IN ('partial_update_document_missing', 'derive_incomplete'))
);
