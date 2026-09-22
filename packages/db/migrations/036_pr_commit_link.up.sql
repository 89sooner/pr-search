-- PR↔커밋 관계 정본 (WP-101 / CR-116, FR-SRCH-002, FR-ING-004 AC-6, ADR-004).
--
-- ## 왜 새 표가 필요한가
--
-- 커밋 문서의 `pull_request_numbers`는 Elasticsearch 업서트에서 **합집합 필드**였다
-- (CR-011, DEV-019). 한 번 더해진 PR 번호는 영영 빠지지 않는다. PR이 rebase되어
-- 원본 커밋 목록이 줄어도 과거에 기록된 번호가 남고, 사내 pilot.17에서는 그렇게
-- 279개 PR이 3,481개 커밋에 잘못 남았다.
--
-- 합집합을 대입으로 바꾸는 것만으로는 부족하다. 커밋 하나가 여러 PR에 속하므로
-- (데이터 모델 5장의 N:M) 한 PR의 투영이 전체 배열을 쓰면 **다른 PR의 번호를
-- 지운다.** 그래서 필요한 것은 "이 커밋을 실제로 소유하는 PR 전부"를 말할 수 있는
-- 정본이고, 그 정본은 색인이 아니라 PostgreSQL에 있어야 한다 (ADR-004).
--
-- `pull_request_snapshot.document`로는 안 된다. 그 문서는 **최신 스냅숏 하나**이고
-- 갱신이 옛 `source_commit_shas`를 덮어쓴다 — 지워야 할 옛 SHA가 그 순간 사라진다.
--
-- ## 세 표가 나누어 맡는 것
--
-- 1. `pull_request_commit_link` — 관계 그 자체. 행 하나가 "저장소 R의 PR N이 커밋 C를
--    소유한다, 근거는 E"이다. 근거(`source`·`merge`)가 키에 있어 **원본 목록에서 빠져도
--    실제 병합 근거는 남는다.**
-- 2. `pull_request_link_observation` — 그 관계를 만든 관측의 신뢰도. 무엇을 보았고,
--    그것이 전부였는지, 조회가 실패했는지, 보는 동안 PR이 바뀌지 않았는지를 남긴다.
--    **삭제 권한은 이 표가 준다.**
-- 3. `commit_link_state` — 커밋 단위의 투영 의도와 진행. 관계가 바뀐 커밋마다
--    generation이 오르고, 투영기가 그 세대를 색인에 반영한 뒤 `projected_generation`을
--    올린다. ES 쓰기가 실패하거나 직후에 프로세스가 죽어도 **할 일이 여기 남는다.**
--
-- ## 왜 `sequence_work`를 쓰지 않나
--
-- 그 표의 키는 `(repository_id, base_branch, seq_epoch)`다. 관계의 정체성은 base
-- 브랜치에도 에폭에도 속하지 않는다 — PR이 base를 바꾸거나 force-push로 에폭이 올라도
-- **PR N이 커밋 C를 소유한다는 사실은 그대로다.** 더미 브랜치와 에폭을 넣어 M 작업처럼
-- 위장하면 에폭이 오르는 날 관계 작업이 통째로 obsolete가 된다.
--
-- ## 기존 자료를 소급해 완전하다고 적지 않는다
--
-- 아래 seed는 `pull_request_snapshot`에서 관계 **행만** 만들고 관측은
-- `verification_state = 'unverified'`로 둔다. 그 스냅숏들에는 완전성 근거가 없기
-- 때문이다 — 있는 관계를 색인에 더하는 것은 안전하지만, 없는 관계를 지우는 것은
-- 근거가 필요하다. 지울 후보는 복구 경로가 PR 상세를 다시 읽어 확정한다.
--
-- seed는 `commit_link_state` 행을 만들지 않는다. 마이그레이션이 저장소 전체의 재투영을
-- 예약하면 운영자가 모르는 사이에 색인 쓰기가 폭주한다. 투영 의도는 복구 명령이
-- dry-run으로 먼저 보여 준 뒤 apply에서 만든다.

-- ---------------------------------------------------------------- ENT-CORE-009
CREATE TABLE pull_request_commit_link (
  repository_id    BIGINT      NOT NULL,
  pr_number        INT         NOT NULL,
  commit_sha       TEXT        NOT NULL,
  -- `source`  = PR의 원본 커밋 목록(`GET /pulls/{n}/commits`)에 있었다.
  -- `merge`   = 그 PR이 **실제로 병합되어** 만들어진 머지 커밋이다.
  --             미병합 PR의 시험용 `merge_commit_sha`는 여기 들어오지 않는다.
  evidence         TEXT        NOT NULL,
  -- 이 근거를 세운 관측의 문서 버전. 어느 관측이 이 행을 만들었는지의 흔적이다.
  observed_version BIGINT      NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- **소유자는 `(repository_id, pr_number)`다.** 같은 SHA·같은 PR 번호라도 저장소가
  -- 다르면 다른 관계이며, base 변경이나 seq_epoch 변경은 소유권을 바꾸지 않는다.
  PRIMARY KEY (repository_id, pr_number, commit_sha, evidence),
  CONSTRAINT pull_request_commit_link_sha_chk
    CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT pull_request_commit_link_evidence_chk
    CHECK (evidence IN ('source', 'merge')),
  CONSTRAINT pull_request_commit_link_pr_chk
    CHECK (pr_number > 0),
  CONSTRAINT pull_request_commit_link_version_chk
    CHECK (observed_version >= 0)
);

-- 투영기의 질의다: "이 커밋을 소유하는 PR 전부". 이것이 `pull_request_numbers`가 된다.
CREATE INDEX pull_request_commit_link_commit_idx
  ON pull_request_commit_link (repository_id, commit_sha, pr_number);

-- ---------------------------------------------------------------- ENT-CORE-010
CREATE TABLE pull_request_link_observation (
  repository_id            BIGINT      NOT NULL,
  pr_number                INT         NOT NULL,
  -- 채택 판정의 기준. 더 작은 버전의 관측은 관계를 바꾸지 못한다.
  observed_version         BIGINT      NOT NULL,
  -- 목록을 읽던 시점의 PR. 조회 도중 rebase를 가려내는 재료다.
  head_sha                 TEXT,
  base_sha                 TEXT,
  base_branch              TEXT,
  pr_state                 TEXT,
  /*
   * **삭제 권한.** 참이면 그때 읽은 원본 커밋 목록이 원격의 전부임을 증명한 것이다:
   * 커밋 조회가 성공했고, 우리 상한에 걸리지 않았고, 원격이 말한 커밋 수와 읽은 수가
   * 같고, 읽기 전후의 head/base가 같았다. 하나라도 무너지면 거짓이며, 거짓인 관측은
   * 관계를 **더할 수는 있어도 지울 수는 없다.**
   */
  commits_complete         BOOLEAN     NOT NULL,
  -- 커밋 조회가 실패했으면 그 종류. 리뷰만 실패한 것과 구분하려고 구성 요소별로 남긴다 —
  -- `enrichment_pending` 하나로는 "빈 목록"과 "못 읽은 목록"이 같아 보인다.
  commits_error_kind       TEXT,
  -- 원격이 말한 커밋 수. 모르면 NULL이고, 그때는 완전성을 주장하지 않는다.
  api_commit_count         INT,
  fetched_count            INT         NOT NULL,
  source_commits_truncated BOOLEAN     NOT NULL,
  /*
   * `verified`        — 완전한 관측으로 확정했다.
   * `unverified`      — 관계는 있으나 완전성 근거가 없다(옛 스냅숏에서 seed된 행 포함).
   * `conflict`        — 같은 버전인데 다른 집합이 왔다. 구버전 writer나 재처리가 의심된다.
   * `pending_refetch` — 불완전해서 다시 읽어야 한다. 새 webhook 없이 재시도된다.
   */
  verification_state       TEXT        NOT NULL,
  refetch_requested_at     TIMESTAMPTZ,
  refetch_attempts         INT         NOT NULL DEFAULT 0,
  last_verified_at         TIMESTAMPTZ,
  last_reason              TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (repository_id, pr_number),
  CONSTRAINT pull_request_link_observation_state_chk
    CHECK (verification_state IN ('verified', 'unverified', 'conflict', 'pending_refetch')),
  -- 완전한 관측은 확정이거나 충돌이다. 재수집 대기와 완전성은 함께 설 수 없다.
  CONSTRAINT pull_request_link_observation_complete_chk
    CHECK (NOT commits_complete OR verification_state IN ('verified', 'conflict')),
  CONSTRAINT pull_request_link_observation_counts_chk
    CHECK (fetched_count >= 0 AND (api_commit_count IS NULL OR api_commit_count >= 0)),
  CONSTRAINT pull_request_link_observation_sha_chk
    CHECK ((head_sha IS NULL OR head_sha ~ '^[0-9a-f]{40}$')
           AND (base_sha IS NULL OR base_sha ~ '^[0-9a-f]{40}$')),
  CONSTRAINT pull_request_link_observation_reason_len_chk
    CHECK (last_reason IS NULL OR char_length(last_reason) <= 200),
  CONSTRAINT pull_request_link_observation_attempts_chk
    CHECK (refetch_attempts >= 0)
);

-- 재수집 대기 목록. 새 webhook을 기다리지 않고 이 인덱스로 집어 간다.
CREATE INDEX pull_request_link_observation_refetch_idx
  ON pull_request_link_observation (refetch_requested_at, repository_id, pr_number)
  WHERE verification_state = 'pending_refetch';

-- 복구 경로가 "완전성 근거 없는 PR"을 좁히는 데 쓴다.
CREATE INDEX pull_request_link_observation_unverified_idx
  ON pull_request_link_observation (repository_id, pr_number)
  WHERE verification_state <> 'verified';

-- ---------------------------------------------------------------- ENT-CORE-011
CREATE TABLE commit_link_state (
  repository_id        BIGINT      NOT NULL,
  commit_sha           TEXT        NOT NULL,
  /*
   * **관계 전용 세대다.** 커밋 메타데이터의 `document_version`과 분리한 이유는,
   * 그 값이 *웹훅 수신 시각*이라 **다른 PR의 이벤트 시각으로 이 커밋의 관계 수정
   * 권한이 판정되기** 때문이다. 관계가 바뀐 커밋만 여기서 세대가 오른다.
   */
  generation           BIGINT      NOT NULL DEFAULT 1,
  -- 색인에 실제로 반영된 세대. `projected_generation < generation`이면 할 일이 있다.
  projected_generation BIGINT      NOT NULL DEFAULT 0,
  -- 마지막으로 색인에 쓴 집합. 멱등 판정과 운영 조회에 쓴다.
  projected_numbers    INT[],
  state                TEXT        NOT NULL DEFAULT 'ready',
  available_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until          TIMESTAMPTZ,
  lease_token          UUID,
  attempt_count        INT         NOT NULL DEFAULT 0,
  last_reason          TEXT,
  -- 같은 세대에 다른 집합이 색인에 있었다. 구버전 union writer의 조기 경보다.
  conflict_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  /*
   * **행을 지우지 않는다.** 마지막 연결이 사라져도 세대와 빈 집합이 남아야, 늦게
   * 도착한 옛 이벤트가 그 커밋을 되살리지 못한다 (tombstone).
   */
  PRIMARY KEY (repository_id, commit_sha),
  CONSTRAINT commit_link_state_sha_chk
    CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT commit_link_state_state_chk
    CHECK (state IN ('ready', 'leased', 'retry', 'parked', 'done')),
  CONSTRAINT commit_link_state_generation_chk
    CHECK (generation >= 1 AND projected_generation >= 0 AND projected_generation <= generation),
  CONSTRAINT commit_link_state_lease_chk
    CHECK (
      (state = 'leased' AND lease_until IS NOT NULL AND lease_token IS NOT NULL)
      OR (state <> 'leased' AND lease_until IS NULL AND lease_token IS NULL)
    ),
  CONSTRAINT commit_link_state_attempt_chk
    CHECK (attempt_count >= 0),
  CONSTRAINT commit_link_state_reason_len_chk
    CHECK (last_reason IS NULL OR char_length(last_reason) <= 200)
);

-- 실행 대상. `done`은 세대가 다시 오르기 전까지 여기 걸리지 않는다.
CREATE INDEX commit_link_state_due_idx
  ON commit_link_state (available_at, repository_id, commit_sha)
  WHERE state IN ('ready', 'retry');

-- 만료 lease 회수.
CREATE INDEX commit_link_state_lease_idx
  ON commit_link_state (lease_until)
  WHERE state = 'leased';

-- 저장소 단위 진행·정체 조회. 운영 화면과 복구 명령이 함께 쓴다.
CREATE INDEX commit_link_state_repo_idx
  ON commit_link_state (repository_id, state, commit_sha);

-- ---------------------------------------------------------------- 잡 종류
-- 저장소 단위 전체 대조·복구. **재색인이 아니다** — 인덱스를 만들지도 전환하지도 않고,
-- 서수·M 번호·에폭·head·태그를 건드리지 않는다.
ALTER TABLE job DROP CONSTRAINT job_type_chk;
ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_reassign',
  'sequence_integrity', 'link_rebuild', 'export', 'snapshot_bootstrap', 'sequence_reproject',
  'mnumber_tag_reconcile', 'pr_link_repair'
));

-- ---------------------------------------------------------------- 기존 자료 seed
/*
 * 최신 스냅숏이 아는 관계를 관계 표로 옮긴다. **추가만 한다.**
 *
 * `source` 근거는 `source_commit_shas` 전부다. `merge` 근거는 **`state = 'merged'`일
 * 때만** 만든다 — 미병합 PR의 `merge_commit_sha`는 GitHub이 시험 병합으로 만든
 * 임시 커밋이고 실제 병합 근거가 아니다.
 *
 * 40자 소문자 16진수가 아닌 값은 버린다. 제약에 걸려 마이그레이션 전체가 실패하는
 * 것보다, 모양이 깨진 옛 값 하나를 들이지 않는 편이 낫다.
 */
INSERT INTO pull_request_commit_link (repository_id, pr_number, commit_sha, evidence, observed_version)
SELECT s.repository_id, s.pr_number, lower(sha.value), 'source', s.document_version
  FROM pull_request_snapshot s
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(s.document -> 'source_commit_shas') = 'array'
         THEN s.document -> 'source_commit_shas'
         ELSE '[]'::jsonb END
  ) AS sha(value)
 WHERE lower(sha.value) ~ '^[0-9a-f]{40}$'
ON CONFLICT DO NOTHING;

INSERT INTO pull_request_commit_link (repository_id, pr_number, commit_sha, evidence, observed_version)
SELECT s.repository_id, s.pr_number, lower(s.document ->> 'merge_commit_sha'), 'merge', s.document_version
  FROM pull_request_snapshot s
 WHERE s.document ->> 'state' = 'merged'
   AND lower(s.document ->> 'merge_commit_sha') ~ '^[0-9a-f]{40}$'
ON CONFLICT DO NOTHING;

/*
 * 관측은 **전부 `unverified`**다. 옛 스냅숏에는 완전성 근거가 없다 — `enrichment_pending`은
 * 네 구성 요소 중 하나라도 실패하면 참이라 커밋 조회 실패와 리뷰 조회 실패를 가르지
 * 못한다. 소급해서 `verified`로 만들면 그 근거 없는 목록으로 **정상 관계가 지워진다.**
 */
INSERT INTO pull_request_link_observation (
  repository_id, pr_number, observed_version, head_sha, base_sha, base_branch, pr_state,
  commits_complete, fetched_count, source_commits_truncated, verification_state, last_reason
)
SELECT s.repository_id,
       s.pr_number,
       s.document_version,
       CASE WHEN lower(s.document ->> 'head_sha') ~ '^[0-9a-f]{40}$' THEN lower(s.document ->> 'head_sha') END,
       CASE WHEN lower(s.document ->> 'base_sha') ~ '^[0-9a-f]{40}$' THEN lower(s.document ->> 'base_sha') END,
       s.document ->> 'base_branch',
       s.document ->> 'state',
       false,
       (SELECT count(*) FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(s.document -> 'source_commit_shas') = 'array'
               THEN s.document -> 'source_commit_shas' ELSE '[]'::jsonb END) AS ignored),
       coalesce((s.document ->> 'source_commits_truncated')::boolean, false),
       'unverified',
       'seeded_from_snapshot_036'
  FROM pull_request_snapshot s
ON CONFLICT DO NOTHING;

/*
 * 관계가 있는 커밋마다 투영 상태 행을 만든다. **세대를 이미 반영된 것으로 둔다**
 * (`projected_generation = generation = 1`, `state = 'done'`).
 *
 * 왜 만드는가: 재색인의 관계 replay와 전환 전 검증이 이 표를 훑는다. 행이 없으면
 * **새 인덱스가 PR 연결 0건으로 전환된다** — 정본이 PostgreSQL에 있는데도 복원되지
 * 않는 상태이고, 그것이 이 CR이 고치려던 결함의 반대편이다.
 *
 * 왜 '아직 안 함'이 아니라 '이미 반영됨'인가: 마이그레이션이 저장소 전체의 재투영을
 * 예약하면 운영자가 모르는 사이에 색인 쓰기가 폭주한다. 지금 색인에 있는 값이
 * 정본과 다른지는 복구 명령이 dry-run으로 먼저 보여 주고, 다를 때만 세대를 올린다
 * (`requeueCommitLinks`).
 *
 * 연결이 0개인 커밋(tombstone)은 여기서 만들지 않는다 — 036 이전에는 "지웠다"는
 * 사실 자체가 정본에 없었으므로 지어내지 않는다.
 */
INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
SELECT DISTINCT repository_id, commit_sha, 1, 1, 'done'
  FROM pull_request_commit_link
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- 권한
GRANT SELECT, INSERT, UPDATE, DELETE ON pull_request_commit_link TO prs_app;
GRANT SELECT, INSERT, UPDATE ON pull_request_link_observation TO prs_app;
GRANT SELECT, INSERT, UPDATE ON commit_link_state TO prs_app;
GRANT ALL ON pull_request_commit_link, pull_request_link_observation, commit_link_state TO prs_admin;
