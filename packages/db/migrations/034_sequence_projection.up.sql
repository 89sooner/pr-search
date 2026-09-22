-- 머지 시퀀스의 Elasticsearch 투영을 durable work로 만든다 (CR-113 / WP-098, FR-SEQ-001 AC-7·AC-8, ADR-004 Amendment).
--
-- ## 무엇을 바꾸나
--
-- 1. `sequence_work.kind`에 `project`를 더한다. 채번·재채번·복구·늦은 PR 스냅숏·커밋 문서
--    생성·재색인·수동 재투영이 남기는 "정본을 색인에 다시 비추라"는 의도다. 공간 단위
--    (`tail`·`full`)와 문서 단위(`doc`)를 같은 kind로 두고 payload의 `scope`로 가른다.
-- 2. `sequence_work.progress`를 더한다. 공간 단위 work가 페이지 커서·generation·건수를
--    남겨 중단 뒤 이어 가고, 완료 시점의 요약을 보존한다. `payload`는 `requestWork`가
--    요청마다 덮어쓰므로 진행 상태를 거기 둘 수 없다 — 이 열은 lease 보유자만 갱신한다.
-- 3. `job.type`에 `sequence_reproject`를 더한다. 운영자의 수동 재투영(API-ADM-002 ·
--    `prsctl sequence reproject`)이며 **재채번이 아니다** — 에폭·서수·head를 바꾸지 않는다.
--
-- ## 무엇을 바꾸지 않나
--
-- `merge_sequence`·`sequence_space`의 값과 제약은 그대로다. 기존 work 행의 kind·상태도
-- 그대로다. 새 GRANT는 없다 — 열 추가는 표 권한(025)을 그대로 따른다.

ALTER TABLE sequence_work DROP CONSTRAINT sequence_work_kind_chk;
ALTER TABLE sequence_work ADD CONSTRAINT sequence_work_kind_chk
  CHECK (kind IN ('refresh', 'reconcile', 'materialize', 'announce', 'project'));

ALTER TABLE sequence_work ADD COLUMN progress JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sequence_work ADD CONSTRAINT sequence_work_progress_size_chk
  CHECK (pg_column_size(progress) <= 65536);

ALTER TABLE job DROP CONSTRAINT job_type_chk;
ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_reassign',
  'sequence_integrity', 'link_rebuild', 'export', 'snapshot_bootstrap', 'sequence_reproject'
));
