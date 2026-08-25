-- 기존 데이터의 PR 정본 스냅숏 부트스트랩 (CR-037, DEV-194·195 / ADR-004).
--
-- ## 왜 필요한가
--
-- 마이그레이션 010이 `pull_request_snapshot`을 세웠지만 **빈 표로 시작한다.**
-- 업그레이드 시점에 이미 색인된 PR은 투영이 다시 건드리지 않는 한 스냅숏을
-- 얻지 못하고(투영은 바뀐 PR만 쓴다), 조정 스캔은 이미 색인된 것을 건너뛴다.
-- 그 PR들은 색인에만 존재하며 **ADR-004의 "PostgreSQL만으로 재구축 가능"이 그
-- 데이터에 대해 성립하지 않는다.**
--
-- ## 왜 여기서 채우지 않는가
--
-- 스냅숏은 GHE가 답하는 PR 내용으로만 만들 수 있다. 마이그레이션 안에서
-- 네트워크를 부르지 않는다 — 마이그레이션은 스키마 전이여야 하고, 외부 호출을
-- 넣으면 되돌릴 수도 재개할 수도 없는 배포 단계가 된다.
--
-- 그래서 여기서는 **표시할 자리와 잡 유형만** 만들고, 실제 채우기는 재개 가능한
-- 잡(JOB-ING-009)이 한다.
--
-- ## 기존 마이그레이션은 고치지 않는다
--
-- 010·011은 이미 적용된 환경에서 다시 돌지 않는다. 넓히는 변경은 언제나 새 번호다
-- (DEV-172의 선례).

-- 정본 스냅숏이 **완전하다고 확인된 시점**. NULL이면 아직 부트스트랩되지 않았다.
--
-- 기존 행은 전부 NULL로 시작한다 — 그 저장소들의 스냅숏이 완전한지 우리는
-- 실제로 모르고, 모르는 것을 "완료"로 적으면 정합성 감시가 그 위에서 거짓을 말한다.
ALTER TABLE repository ADD COLUMN snapshot_bootstrapped_at TIMESTAMPTZ;

-- 아직 부트스트랩되지 않은 저장소를 싸게 찾는다 (조정 스캔이 매 주기 훑는다).
CREATE INDEX repository_snapshot_bootstrap_idx
  ON repository (repository_id)
  WHERE snapshot_bootstrapped_at IS NULL;

-- JOB-ING-009 `snapshot_bootstrap`. 재개 가능한 일회성 잡이다.
ALTER TABLE job DROP CONSTRAINT job_type_chk;

ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_reassign',
  'sequence_integrity', 'link_rebuild', 'export', 'snapshot_bootstrap'
));
