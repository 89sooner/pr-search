-- 032 PR 스냅숏 문서의 state를 파생 값으로 바로잡는다 (CR-101 / DEV-718, ENT-CORE-002).
--
-- 투영은 GitHub이 준 원시 state(open|closed)를 그대로 썼고 병합을 `merged`로 파생하지 않았다.
-- 제품 계약(API 문서의 예시·`is:merged`·화면 배지·M 번호 조회의 not_merged 판정·늦은 PR 스냅숏의
-- 채번 재개 관문)은 전부 `state = merged`를 전제하므로, 병합된 PR이 어디에서도 병합으로 보이지 않았다
-- (사내 pilot.12: Merged 필터와 My merged PRs가 0건).
--
-- 새 문서는 투영이 파생한다(`packages/domain/src/pull-request-state.ts`, `apps/pipeline-worker/src/documents.ts`).
-- 이미 저장된 스냅숏은 여기서 같은 규칙으로 바로잡는다: 병합 시각이 있으면 병합이다.
--
-- 재색인(ADR-004)은 이 표의 문서를 그대로 색인하므로, 적용 뒤 운영 콘솔에서 `prs-pull-requests`를
-- 한 번 재색인해야 Elasticsearch가 같은 값을 갖는다 (RUNBOOK 「업그레이드」).
--
-- `document_version`은 올리지 않는다. 그 값은 원천(웹훅·백필)의 버전이며, 같은 버전의 문서가 다시
-- 와도 투영이 같은 파생 값을 만든다 — 조건부 업서트의 기준을 흔들 이유가 없다.

UPDATE pull_request_snapshot
   SET document = jsonb_set(document, '{state}', '"merged"'::jsonb, true)
 WHERE document->>'merged_at' IS NOT NULL
   AND document->>'state' IS DISTINCT FROM 'merged';
