-- 관계 후보 조회 인덱스 (WP-030 / CR-041, DEV-240).
--
-- ## 왜 필요한가
--
-- ADR-004는 파생의 정본을 PostgreSQL로 정한다. WP-030의 세 계열은 전부 **다른
-- 엔티티를 후보로 찾아야** 간선을 만들 수 있다 — 되돌림은 제목이 같은 엔티티,
-- 체리픽은 `patch_id`가 같은 커밋, 스택은 분기가 맞물리는 열린 PR이다.
--
-- 그런데 두 정본 표에는 그 축의 인덱스가 없다. `pull_request_snapshot`은
-- `(repository_id, pr_number)` 하나뿐이고 본문이 `document JSONB`라 제목·분기·
-- 상태로 찾을 길이 없다. `commit_snapshot`은 `(repository_id, fetched_at)`과
-- 미투영 부분 인덱스뿐이라 `patch_id` 조회 인덱스가 없다.
--
-- 그대로 두면 방아쇠마다 저장소 전체 스캔이 되고, 그러면 **"색인에서 찾자"는
-- 유혹이 생겨 ADR-004가 이 축에서 깨진다.** 파생 근거를 파생 결과에서 읽는 것은
-- CR-027(DEV-130)이 시퀀스 범위에서 이미 막은 모양이다.
--
-- ## 무엇을 만들지 않는가
--
-- **새 엔티티 표를 만들지 않는다.** 간선은 여전히 재파생 가능한 파생 데이터이며
-- PostgreSQL 간선 표는 두지 않는다 (CR-039). 여기서 더하는 것은 **인덱스뿐**이고,
-- 기존 표의 열도 바꾸지 않는다.
--
-- ## CREATE INDEX CONCURRENTLY를 쓰지 않는 이유
--
-- 이 저장소의 마이그레이션 러너는 마이그레이션 하나를 **단일 트랜잭션** 안에서
-- 실행한다(`packages/db/src/migrate.ts`의 `withTransaction`). `CONCURRENTLY`는
-- 트랜잭션 블록 안에서 실행할 수 없다. 시스템이 아직 베타 미승인이고 실제
-- 클러스터에 적용된 적이 없으므로(원장 §7) 지금은 일반 `CREATE INDEX`가 맞다.
-- **운영 규모 무중단 적용은 검증되지 않았다** — 그것이 필요해지는 시점의 온라인
-- 마이그레이션 능력은 별도 작업이며 이 WP의 범위가 아니다.

-- 체리픽 `derived` 후보: 같은 저장소에서 같은 patch-id를 가진 커밋.
--
-- 정렬 열을 인덱스에 포함해 상위 5건 선택이 정렬 없이 끝난다 (FR-REL-005 AC-4).
-- 순서는 결정론이어야 한다 — `committed_at` 내림차순, 동률이면 `commit_sha`
-- 오름차순 (DEV-243). 값이 없는 행은 후보가 아니므로 부분 인덱스다.
CREATE INDEX commit_snapshot_patch_candidate_idx
  ON commit_snapshot (repository_id, patch_id, committed_at DESC, commit_sha)
  WHERE patch_id IS NOT NULL;

-- 되돌림 제목 대조 후보(커밋): 메시지 첫 줄이 제목이다.
--
-- `split_part`는 IMMUTABLE이라 식 인덱스에 쓸 수 있다. 질의도 **같은 식**을 써야
-- 인덱스가 잡힌다 — 한쪽만 바꾸면 인덱스가 조용히 무시된다.
CREATE INDEX commit_snapshot_subject_idx
  ON commit_snapshot (repository_id, split_part(message, E'\n', 1));

-- 되돌림 제목 대조 후보(PR).
CREATE INDEX pull_request_snapshot_title_idx
  ON pull_request_snapshot (repository_id, (document ->> 'title'));

-- 스택 상위 후보: 하위 PR의 base_branch와 맞물리는 **열린** PR의 head_branch.
--
-- 열린 PR만 후보이므로 부분 인덱스다 (FR-REL-006 요구사항 문장).
CREATE INDEX pull_request_snapshot_open_head_idx
  ON pull_request_snapshot (repository_id, (document ->> 'head_branch'))
  WHERE document ->> 'state' = 'open';

-- 스택 역방향: 이 PR의 head_branch를 base_branch로 삼는 하위 PR들.
--
-- 상위 PR이 머지·종료·retarget될 때 **하위 PR의 간선**을 다시 봐야 하는데
-- 하위 PR에는 그때 이벤트가 오지 않는다 (DEV-232). 이 인덱스가 그 역방향
-- 조회의 경계를 만든다 — 없으면 저장소 전량 스캔이다.
CREATE INDEX pull_request_snapshot_base_branch_idx
  ON pull_request_snapshot (repository_id, (document ->> 'base_branch'));
