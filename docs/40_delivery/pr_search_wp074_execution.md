# WP-074 후속 에이전트 구현 실행서

> 상태: review | 버전: v0.1 | 갱신일: 2026-09-11

## 1. 후속 세션의 입력과 실행 권한

이 실행서는 사용자가 **별도 구현 지시를 했을 때** 사용하는 인계 문서다. 작성 세션은 설계만 수행했다. 모델·에이전트 이름과 무관하게 아래 계약과 증거를 따른다. WP-074 상태는 todo다. PR·CI·병합·후보 번들도 실제 수행 결과가 생기기 전 완료로 기록하지 않는다.

필수 읽기 순서:

1. `../README.md`, 현재 HEAD의 `pr_search_implementation_traceability.md` 3장 및 `pr_search_work_packages.md` WP-074.
2. `../00_governance/change_control.md` CR-079와 DEV-576·DEV-580~583.
3. `../10_requirements/srs_final.md` FR-SEQ-008, FR-SEQ-001, NFR-002, FR-AUTH-001/002; glossary의 M 번호·확정 근거.
4. `../30_technical_architecture/pr_search_api_contracts.md` API-SEQ-007 및 기존 검색/상세/범위 응답.
5. `../30_technical_architecture/pr_search_wp074_design.md` **전문**. 특히 2.2 부재 확정 한계를 빠뜨리지 않는다.
6. 이 문서 전문과 `pr_search_wp074_measurement_guide.md`.
7. 화면 QA의 QA-W001-39·QA-W002-29·QA-W004-30 및 실제 아래 파일 경로.

현재 source의 앞선 설계와 모순을 발견하면 DEV→CR를 통해 좁게 정정한다. PR 번호·merge_seq·M 번호를 같은 값으로 구현하지 않는다. 사내 squash-only를 public upstream PR의 merge 옵션으로 적용하지 않는다. 재시험이 아직 없는 pilot.4와 새 후보의 상태를 분리한다.

## 2. 시작 검사

2026-09-11 기준 `origin/main=f53d28c4e3fc7e0a4b5ac189da571df05df1741f`; `pilot.4=a198e12915e6795dc44e1a947073b683e9e5e47b`. 다시 fetch·diff하고 변경이 있으면 읽는다. 별도 worktree를 만들고 새 ID·migration 번호를 재측정한다. agent-context 미커밋 변경이 있으면 실제 원장과 대조한 뒤 보존 커밋으로 분리한다. 경로별 stage만 허용한다.

환경은 `.nvmrc`(22), root `package.json`의 `pnpm@10.33.0`, lockfile 기준이다. 기존 shell이 Node 20이면 Node 22를 PATH 앞에 둔다. Corepack cache가 read-only이면 쓰기 가능한 임시 `COREPACK_HOME`을 사용한다. pnpm recursive command가 실행 파일을 찾을 수 있어야 하며 shell function만으로 대체하지 않는다. 라이브러리 upgrade는 이 작업의 해법이 아니다.

격리 DB/ES/Redis의 주소와 database/index/stream 접두를 출력해서 확인하되 자격 값은 출력하지 않는다. 사내 주소를 fixture에 넣지 않는다. tests 설정의 include를 읽고 integration tests를 unit config로 실행하지 않는다. 기존 .env를 출력하거나 production DB URL을 복사하지 않는다.

## 3. 작업 분할과 파일 소유

새 WP 번호를 만들지 않고 WP-074 내부 체크포인트 S0~S6으로 나눈다. 각 세션은 끝에 진행 상태·실제 시험·다음 체크포인트를 원장에 남긴다. 여러 에이전트에게 병렬 위임하면 파일 소유를 배타적으로 배정하고 shared index/type 파일은 통합 담당 한 명만 쓴다.

| 순서 | 산출물 / 핵심 구현 경로 | 완료 증거 |
| --- | --- | --- |
| S0 계약 확인 | CR-079·API-SEQ-007·상세 설계·DEV-581 조건 | source와 API 계약 비교, negative 증거 가용성 판단 기록 |
| S1 영속 토대 | `packages/db/migrations/025_merge_number.up.sql`, `.down.sql` (신규 예상), `repositories/{merge-sequence,sequence-space,pr-snapshot}.ts`, 신규 `mnumber-evidence.ts`·`sequence-work.ts`·`sequence-latency.ts`, index exports | T06 migration 왕복, schema·제약·lease CAS tests |
| S2 freshness | gateway `store.ts`·`ingest.ts`·`server.ts`, worker `mirror-runner.ts`·`sequence.ts`·`index.ts`, `release.ts`, 신규 `sequence-work-runner.ts`, bus topics | T03 before/after stale mirror; 마지막 push 복구 |
| S3 증거→번호 | 신규 worker `mnumber-evidence.ts`·`mnumber-plan.ts`·`mnumber.ts`; github `client.ts`·필요 transport 응답 metadata; snapshot.ts; DB repos | T01·T02·T04 planner와 late snapshot 복구 |
| S4 ES/API | 신규 `packages/es/src/merge-number.ts`; mappings/pull-requests.ts·upsert.ts·index.ts; worker project.ts·reindex.ts; 신규 API `sequence/merge-numbers.ts`, routes.ts·space.ts, search/service.ts·resolve/detail.ts·sequence/range.ts | T04 DB→ES convergence, T05 contract/access/epoch |
| S5 UI | 신규 `apps/web/lib/merge-number.ts`; SearchView·ResultWorkbench·ResultTable·PrDetailView·RangesView·RangeResultTable, lib/pr-detail·lib/range, app/search의 query 처리, 기존 BFF proxy | W-001/002/004 인증 fixture, UI 네트워크 호출 수 |
| S6 계측·배포·마감 | 신규 `scripts/measure-sequence-latency.mjs`, package script; compose/.env.example·K8s sequence 설정·RUNBOOK·Dockerfile 검증; 본 문서와 원장 | 측정 CLI fixture·T06 실제 이미지·전체 checks·독립 리뷰·미발행 후보 |

표의 신규 경로는 계획 경로다. 현재 파일 존재 여부는 `rg --files`로 확인한다. `packages/es/src/mappings/pull-requests.ts` 등 실제 이름이 달라졌다면 소유 기능을 유지하여 실행서의 경로를 먼저 정정한다. S2~S5 변경을 한꺼번에 활성화하기 전 migration이 선행되어야 한다. 전체 WP 완료는 S6과 DEV-581 게이트를 함께 충족해야 한다.

## 4. 독립 fixture와 실패 재현 계약

bare remote + 작업 clone + 별도 mirror의 실제 git fixture를 만든다. 커밋 메시지의 PR 번호를 구현에 읽히게 하지 않는다. fixture manifest는 test 작성자가 수동 선언한 `seq/SHA/PR/expectedM` 매핑이며 실제 git rev-list 결과와 별도로 대조한다. 구현 planner나 classifier가 만든 값을 기대값으로 가져오지 않는다.

핵심 graph: root R → squash A(PR21, 원본 commit 3개) → direct D → squash B(PR25) → squash C(PR27, snapshot 지연) → squash E(PR29). root/direct의 확정 증거는 integration fixture가 통제된 이력 제작 사실로 직접 주입한다. 이것은 운영 증거 생산자의 모사가 아니며 별도 `fixture_seeded` 표시를 시험 결과에 남긴다. root/D 증거를 제거한 production-mode fixture에서는 그 지점에서 unresolved가 되어야 한다.

번호 기대값은 A=1, D=없음, B=2, C=3, E=4. C 미확정일 때 E=없음; C 정보 주입 후 **추가 git push 없이** C=3/E=4. 다른 base 브랜치와 다른 repo에는 독립 번호를 만든다. force push fixture는 이전 epoch 행을 보존하고 새 epoch의 prefix까지 다시 증거를 확인한다.

수정 전 DEV-576 재현은 테스트 대상 `f53d28c`를 별도 임시 worktree에서 실행한다. 먼저 old mirror의 head를 A까지 fetch → remote에 D/B 추가 → push ingress 202 → sequence handler 처리 → old head가 읽혀 새 seq 없음 확인. 수정 후 같은 fixture와 동일 push를 주고 freshness 완료 이후에만 새 seq/M 판정이 시작됨을 기록한다. 전/후 모두 raw_event 수신·work 상태·remote/mirror/head SHA·호출 순서를 증거로 남긴다. 이번 설계 세션에서 재현했다고 쓰지 않는다.

## 5. 수용 시험 매트릭스

모든 test 이름/파일 머리글에 `WP-074 FR-SEQ-008`와 Txx 번호를 표기한다. 테스트 파일명은 아래 계획이다. 단위 함수 검증만으로 운영 연결을 통과시키지 않는다.

| ID | 입력과 실패 주입 | 독립 기대 / 필수 관찰 | 예상 suite |
| --- | --- | --- | --- |
| T01 | squash 원본 3 commits, 결과 SHA 1개, 다른 branch·repo | A=1, B=2; PR당 번호 1개; git first-parent 순서와 일치; 기존 merge_seq 지원 유지 | worker `src/mnumber-plan.test.ts`, `integration/sequence/mnumber.test.ts` |
| T02a | NULL·ES 빈 결과·parent1·빈 API 반복·partial·404·429·invalid response | direct 확정 0건, blocked 이유, 뒤 번호 0건; 관련 scope 없는 PR/HEAD SHA는 증거 아님 | `integration/sequence/mnumber-evidence.test.ts` |
| T02b | late snapshot DB commit; 이벤트 발행 전에 kill; no new push | poll/lease 복구로 C=3,E=4, snapshot 버전 일치; old same-generation ack가 새 요청을 지우지 않음 | `integration/sequence/mnumber-resume.test.ts` |
| T02c | 확정 PR 변경·direct에 PR 후발·동일 PR 다른 SHA·merge/rebase 이력 | conflict/profile reason; 이미 부여된 M 보존, 새 채번 정지 | evidence + DB integration |
| T03a | stale-readable mirror, fetch 실패, remote 이동, branch 삭제 | old head 정상 취급 금지; 실패 work 잔존; freshness→seq 순서; no_branch 별도 | `integration/sequence/freshness.test.ts` |
| T03b | 중복/역순 push, mirror/release/sequence 동시 fetch, lock 획득 실패, worker kill | repo 단위 fetch 최대 동시 1; 다른 repo 진행; stale lease ack 0행; last push 복구 | 실제 git+PG+Redis |
| T03c | ingress 저장 직후 Redis 불능, duplicate delivery 재수신 | raw_event와 refresh intent 원자성, work는 1건; PG 실패면 500, PG 성공이면 202 유지 | gateway integration |
| T04a | M transaction exception·process kill commit 뒤 | 번호/checkpoint/work 전부 rollback 또는 전부 존재; 같은 번호 재시도 | PG integration |
| T04b | announce 실패·ES 장애·부분 bulk·missing PR doc·newer 일반 투영 | 번호 유지; work retry; 문서 생성 뒤 no new push로 수렴; document_version 보존 | ES+worker integration |
| T04c | epoch bump/prefix copy/old event, reindex shadow·alias swap 경주 | old epoch 번호 노출 0; new checkpoint=0; 두 target 일치; suffix 아닌 동일 identity 대조 | reindex integration |
| T04d | merged_at 동률·역전·batch 경계 이전 PR | 역전 pair만 mismatch, 번호 순서는 git 기준, metric 실패가 transaction 실패 안 함 | planner + integration |
| T05a | 코드 mismatch, branch/epoch 누락, 두 anchor·없음, 중복 key, 0/-1/1.5/1e3/과대값 | 계약의 400/404/409/503·reason·JSON key presence 일치 | API `integration/sequence/merge-numbers.test.ts` |
| T05b | 권한 밖 repo·미등록·epoch stale·재채번 중 read 경주 | 미등록/권한 밖 동일 404; epoch stale 결과 키 없음; 일관 snapshot | API integration |
| T05c | 세 화면, pending/unavailable/미머지/비대상/commit 행 | PR 번호 주 식별자, M0/임시값 없음; from_q/new tab/keyboard/cursor 보존 | web a11y + `e2e/mnumber.spec.ts` |
| T05d | N개 목록·M 복사 링크·epoch 누락 링크 | 행별 resolve 0회; DB batch 1회; 직접 M entry는 resolve 1회; 네 문맥 보존 | API query counter + Playwright network |
| T06a | 기존 데이터 024→025→024→025; 새 표 값·권한·앱 rollback | old rows/seq/SHA/PR/epoch/export 그대로; 새 번호 초기화와 복구 위험 확인; app-role 통과 | DB integration |
| T06b | 실제 worker boot/stop, 실제 이미지 git/failfast/SSR/M 흐름 | 기존 pilot.4 게이트 보존; runtime 실제 subscription/lease cleanup; tar 재적재 이미지 | container integration |
| T06c | 계측 missing/negative/mixed cohorts·read-only DB, secret fixture | percentile 분모/누락/음수 표기, DB 쓰기 0, payload/credential 출력 0 | measurement CLI tests |

### 5.1 변이 시험

필수 kill 변이: unresolved NULL을 direct로 처리, 코드 구간 무시, M epoch 누락을 현재로 채움, freshness await 제거, fetch failure→ready, 일반 PR upsert에 M NULL 추가, old generation finish의 CAS 제거, commit 뒤 outbox 생략, late snapshot의 reconcile enqueue 제거, 두 logical consumer를 같은 그룹으로 변경. baseline test 통과 → 한 변이 적용 → 대상 test 실패 → 변경 원복 → baseline 재통과 순서를 각각 기록한다. mutation으로 작업 중인 타 에이전트 파일을 바꾸지 않는다.

독립 판단: 기대 fixture는 Git 이력과 수동 PR 매핑을 따로 비교한다. direct 분기 fixture의 성공은 DEV-581 production 게이트를 kill한 것이 아니다. production adapter에서 반복 빈 응답을 pending으로 유지하는 반대 방향 테스트가 반드시 있다.

## 6. 명령 계약

아래는 현재 존재하는 package script 후보다. Node/pnpm/backing service를 맞춘 뒤 사용하며 root에서 실행한다. 아직 없는 test 경로는 S1~S6에서 추가한 후 실행한다.

```bash
pnpm typecheck
pnpm lint
pnpm run lint:deps
pnpm test
pnpm run test:regression
pnpm run test:integration
pnpm build
pnpm run test:a11y
pnpm run test:contrast
pnpm run test:e2e
```

integration 부분 실행 예: `pnpm exec vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence`. 실행 결과의 파일 수·test 수가 0이면 실패다. E2E는 build 선행. 대규모 DB/ES tests와 image build를 무조건 병렬 실행하지 않는다. 마이그레이션 CLI down 지원은 `packages/db/src/cli.ts`와 migrate 모듈을 읽어 확인하고 존재하지 않는 `pnpm db:down`을 만들었다고 가정하지 않는다.

후속 릴리스 작업은 별도 구현 지시의 승인 범위를 확인한 뒤 진행한다. draft PR → 필수 CI → 독립 리뷰 → 관련 결함 수정 → public 규칙에 맞는 merge → 최종 HEAD로 **새 버전의 미발행** 후보 bundle 생성 → manifest/head/digest·tar 재적재 시험. `build-bundle.sh`의 `--release`는 금지한다. pilot.4 태그·자산을 덮지 않는다. 구현·merge가 끝나도 DEV-581이 해결되지 않았으면 WP-074 전체 done이나 배포 준비 완료로 승격하지 않는다.

## 7. 설계 세션 검증 기록

시작: main/origin/main=f53d28c, 설계 브랜치 `docs/wp074-squash-design`. 제품 코드·schema·tests·배포 파일 변경 없음. 원격 fetch와 source 읽기, 공식 API 문서 확인 수행. application tests/build/fixture 실행은 NOT RUN이며 이번 설계 작업의 통과 근거에 포함하지 않는다.

문서 검사기: `/home/roqkf/.codex/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py`. 자체 버전 옵션 대신 SHA-256 `1004095624fed9bae7a8ada7a2bbe0f4c6586dbcdf20db61b07b3b8045ca7cb2`로 식별한다. 시작 `--report`는 Phase 6, 오류 2·경고 1. 시작 `--strict`는 오류 4·경고 1, exit 1. 기존 unknown FR-CSS-005 / 옛 D-002 정정 이력 / 원장 risks.md 링크 / 두 원장 placeholder 검출. 전체 문서 재작성을 하지 않고 차이를 비교한다. 최종 결과는 CR-079 cascade에 기록한다.

판정: 설계 작성과 계약 정정 검토는 진행 가능. 전체 strict 통과와 직접 푸시 확정 증거가 확보되기 전 무조건적인 구현 준비 완료 선언은 하지 않는다. 이는 `build-srs-prd-env`의 handoff gate와 실제 미확보 증거를 구분해서 기록한 것이다. 사용자의 후속 구현 지시가 오면 영향 없는 S1~S6과 미확보 증거 조사는 진행할 수 있으나, 실패 조건을 통과로 바꾸지 않는다.

## 8. 후속 완료 보고 양식

첫 문단: 실제 구현, M 표시 화면, 미구현 사항, 사내 실행 명령, GitHub 제목 변경 여부를 쉬운 말로 답한다. 다음에 시작/종료 SHA, PR/CI URL, 변경 경로, T01~T06 결과, migration와 이미지 결과, 외부/사내 구분을 기록한다. 계측 도구가 아직 없으면 실행법만 있다고 구현 완료로 적지 않는다.

`Agent-Initiated Decisions`는 상세 설계 12장의 A/B/C를 이어받는다. C에 추가/변경/비구현 판단·근거·영향·비용·rollback·DEV/CR/test를 모두 적는다. 별도 C가 없으면 `추가 C: NONE`을 적는다. 측정 도구와 검증은 B이며 C로 포장하지 않는다.

완료 표는 다섯 행: 계약 정정 / WP-074 구현 / 외부 실제 실행 / 사내 운영 검증 / WP-075 자동 쓰기. 마지막 두 행은 실제 사내 결과와 사용자 별도 WP-075 지시가 없으면 각각 NOT RUN, 미구현·비활성이다. CR-079 문서 완료와 DEV-576 코드 완료는 별개다.
