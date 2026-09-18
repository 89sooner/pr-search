# Regression Investigation 구현 계획

> 상태: draft | 버전: v0.2 | 갱신일: 2026-09-18

CR-109 진행 분리: 사용자 후속 설계02·UI 지시서·B Atlas 구현 지시에 따라 **WP-095의 fixture UI 수직**을 먼저 구현한다. 이 문서의 영속 backend·MDVP·MTBF 후보 전체가 승인된 것은 아니다. 실제 실행/검증 상태는 구현 원장 WP-095를 따른다. 기존 R0a 계약 브랜치는 보존한다.


## 1. 목적과 승인 경계

CR-102 / F-REG-001~005. 사용자 제공 [연구 원문 01](regression_workbench/deep-research-report_01.md)을 HEAD `2a4f37e`의 문서·코드와 대조한 초기 구현 제안이다. 당시 분석·계획 작성은 신규 제품 범위의 baseline·앱 구현·배포 완료를 뜻하지 않았다. 원문은 [HTML](regression_workbench/deep-research-report_01.html)에서도 읽는다. 최신 UI 구현 범위는 위 CR-109 기록이 보완한다.

권고: `merge_seq`의 first-parent 순서를 재사용하고, 수동 관측 → 비확정 판정 → artifact 연결 → coarse/fine 탐색 순으로 확장한다. MDVP와 MTBF는 계약이 정해진 뒤 독립적으로 붙인다. 독립 CI counter, M 번호 재정의, 서버 git bisect 실행, 장비 제어, 자동 빌드 실행은 제외한다.

## 2. 현재 구현과 연구 주장 대조

| 항목 | 확인 근거 | 판단·계획 영향 |
| --- | --- | --- |
| 시퀀스 의미 | SRS FR-SEQ-001·005·008, glossary, ADR-007 | `(repository_id, base_branch, seq_epoch, merge_seq)`가 revision key. M은 PR 연결 항목의 별도 조밀 서수이며 현재 표기는 `M-1900-1` 형식. 연구의 `M-8123`은 설명용 약식이다 |
| 기존 bisect | `packages/db/src/repositories/bisect-session.ts` | 개인·저장소·브랜치별 세션, advisory lock, epoch/reassigning 차단, good=max/bad=min 축소를 재사용 |
| 현재 HTTP 계약 | `apps/search-api/src/sequence/routes.ts`, API-SEQ-005 | `/api/v1/bisect-sessions`의 mark는 good/bad만 허용. 원문의 짧은 JSON은 session/space/epoch가 빠진 설명용이며 완전한 요청 DTO가 아니다 |
| 후보 선택 | `bisect-session.ts`의 view SQL | 실제 커밋 중 `(good+bad)/2`에 가장 가까운 **서수 값**. 항목 수 기준 median이 아니다. sparse fixture 통과가 artifact-aware 선택을 이미 지원한다는 뜻은 아니다 |
| 검증 근거 | `apps/search-api/integration/sequence/bisect.test.ts` | sparse `[1,2,5,8,9]`, 세션 격리, 409, epoch, direct push, concurrent mark 시나리오 존재. 이번 문서 작업에서 앱 시험 재실행은 하지 않음 |
| UI 재사용 | `apps/web/components/BisectPanel.tsx`, `apps/web/app/ranges/page.tsx`, `apps/web/e2e/flow-004-bisect.spec.ts` | W-004/FLOW-004를 확장할 위치. 기존 reader/operator 진입 정책을 존중하며 operator 전용 역할을 새로 강제하지 않음 |
| 직접 커밋 결과 | SRS FR-SEQ-007 AC-3 대 코드 `pull_request_number: null` | DEV-719. SRS의 “그 PR”을 “해당 커밋과 존재하는 PR 연결”로 정정할 제안. 완료 코드의 동작을 바꾸기 전에 R0에서 요구사항 정정 |
| 출처 품질 | 원문의 `turn...` citation/filecite 토큰 | 원래 대화의 resolver가 없어 출처 링크로 사용할 수 없음. 원문은 보존하고 이 계획의 파일·공식 URL을 별도 근거로 제공 |

작업 시작 전부터 `packages/es/src/query-builder.ts`에 사용자 변경이 존재했다. 이번 분석의 bisect 결론은 그 파일에 의존하지 않으며 이를 수정하지 않는다.

## 3. 채택할 불변식과 수용안

아래 P1~P7은 CR-102의 **요구사항 초안 입력**이다. 승인 FR ID가 아니다. R0에서 정식 EARS 블록과 AC로 SRS에 옮기고 화면·API·엔티티 ID를 배정한다.

| 초안 | 요구사항 문장 제안 | 수용 기준 제안·실패 처리 | 기반 |
| --- | --- | --- | --- |
| P1 식별 | 조사 revision을 표시하거나 전달하면 시스템은 저장소·브랜치·에폭·서수를 함께 제공하여야 한다 | I는 표시 접두만, 새 counter 0개. full SHA를 연결하고 다른 space/epoch 조합 거절. M·PR은 보조 연결; direct push 유지 | F-REG-001 / FR-SEQ-001·005·008 |
| P2 관측 | 인증된 세션 소유자가 시험 결과를 제출하면 시스템은 관측 이력과 적용 결과를 원자적으로 저장하여야 한다 | verdict, failure signature, scenario, HW/RF/network 환경, runtime, failure count, operator, artifact/digest, run ID, note/result URI 저장. 같은 event 재전송 1건, 다른 payload 충돌 409, 다른 소유자 거절. artifact 도입 전 null 허용 | F-REG-002 / FR-SEQ-007·FR-AUTH-002 |
| P3 비확정 | SKIP 또는 INCONCLUSIVE 관측을 받으면 시스템은 good/bad 경계를 보존하여야 한다 | SKIP은 현재 자동 추천에서 제외하되 culprit 집합에서 유지; INCONCLUSIVE는 같은 지점 재시험 가능. 시험 가능한 지점이 없으면 ambiguous/awaiting_evidence. 근거 없이 converged 금지 | F-REG-002 / FR-SEQ-007 |
| P4 artifact | 인가된 발행자가 manifest를 등록하면 시스템은 full SHA와 revision key의 일치를 확인하여 연결하여야 한다 | sequence→build 목록, digest→revision 목록, PR→연결 build 목록 조회. 다중 variant/rebuild 지원. 불일치 거절, 미채번은 pending, 만료 URI는 unavailable. 이름/짧은 SHA만으로 연결하지 않음 | F-REG-003 / FR-SEQ-001·FR-SRCH-001·002 |
| P5 탐색 | artifact 가용성 모드에서 후보를 요청하면 시스템은 미확정 원인 구간과 시험 가능한 다음 지점을 구분하여야 한다 | 전체 `(good,bad]`의 수와 testable 수 별도 반환. Stage A는 보관 binary, Stage B는 외부 재빌드 후 재개. 누락 revision을 제거해 단일 culprit로 만들지 않음 | F-REG-003 / FR-SEQ-007 |
| P6 외부 결과 | 승인된 adapter가 결과를 제출하면 시스템은 정규화된 관측 계약을 거쳐 저장하여야 한다 | producer/run/result revision 중복 억제, 늦은 결과의 stale 기록, 명시 위임 없는 개인 세션 수정 금지, 실패 이유 노출. 외부 실행 제어 제외 | F-REG-004 / FR-SEQ-007·FR-AUTH-002 |
| P7 통계 판정 | 승인된 시험 계획의 관측이 완성되면 시스템은 모델·입력·신뢰수준·판정 근거를 함께 기록하여야 한다 | 가정 불일치/부족 시간/미승인 중단 규칙이면 INCONCLUSIVE. zero-failure를 무조건 PASS로 변환하지 않음. 계산 버전을 보존 | F-REG-005 / FR-SEQ-007 |

공통 전제: 동일 failure signature·시험 조건에서 단조로운 good→bad 경계를 조사한다. 상충하는 결과나 중간 수정·재발을 발견하면 모순 상태로 멈추고 구간을 나눠 조사한다. 과거 관측을 덮어 정답처럼 보이게 하지 않는다. 개인 bisect verdict가 공유 안전 표식(FR-SEQ-006)을 자동 갱신하지 않는다.

## 4. 상태·알고리즘 설계안

| 입력/조건 | 경계 | 다음 행동 | 결과 상태 |
| --- | --- | --- | --- |
| PASS / API good | good를 증가, bad 보존 | 남은 시험 가능 지점 추천 | in_progress 또는 증명된 converged |
| FAIL / API bad | bad를 감소, good 보존 | 남은 시험 가능 지점 추천 | in_progress 또는 증명된 converged |
| SKIP | 보존 | 해당 지점 자동 추천 제외, 사유 필수; 명시 재활성 가능 | 다른 후보 또는 ambiguous |
| INCONCLUSIVE | 보존 | 해당 지점을 재시험 대상으로 유지; 사용자가 대안 선택 가능 | awaiting_evidence |
| 모든 내부 후보가 skip/미보관 | 보존 | unresolved interval과 외부 재빌드용 SHA 목록 | ambiguous, result=null |
| epoch 변경/reassigning | 보존 | mutation 차단, 새 세션 경로; 옛 관측 보존 | epoch_stale |
| 상충 관측·오래된 session revision | 보존 | 409, 서버 최신 상태 재조회 | contradiction/conflict |

`remaining`의 기존 의미 `(good,bad]` 실제 커밋 수를 유지하고 `testable_remaining`을 별도 필드로 제안한다. `estimated_steps=ceil(log2(remaining))`는 현재 API의 이상적 추정이며 SKIP·MTBF 소요 시간의 보장이 아니다. sparse/skip 모드에서는 추정 불가 여부를 별도로 표시한다.

기존 기본 선택 규칙은 FR-SEQ-007 AC-2를 따른다. artifact 모드에만 **시험 가능한 후보 목록의 순위 중앙값**을 도입하는 안을 R0에서 승인받는다. 정렬은 merge_seq, 동률은 작은 서수로 결정해 재현 가능하게 한다. artifact 가용성은 추천 대상을 바꾸지만 culprit 판정의 전체 first-parent 집합을 바꾸지 않는다.

## 5. 데이터·API·운영 설계안

### 5.1 정본과 생명주기

- PostgreSQL에 관측과 manifest metadata를 둔다. binary·장비 raw log는 외부 저장소 소유이며 Elasticsearch 색인은 첫 확장에 필요하지 않다.
- `regression_observation` 후보: observation_id, session_id, revision key/full SHA, artifact_id nullable, verdict, reason, failure_signature, scenario/environment snapshot, duration_seconds, failure_count, producer/run/event ID, actor, recorded_at, result_uri, applied 상태, supersedes_id. 관측은 append-only이고 정정은 새 행으로 연결한다.
- `artifact_build` 후보: build_id, producer, revision key/full SHA, product, variant, build_config/toolchain version, artifact_sha256, URI, created_at, retention_state. 한 revision에 여러 build/variant 허용; digest도 전역 유일 revision 키로 가정하지 않는다.
- 현재 reset은 bisect_session 행을 삭제한다. 관측을 cascade delete로 잃지 않도록 세션 archive/tombstone과 새 active session을 분리하는 migration을 먼저 설계한다. 기존 세션에는 boundary만 보존하며 실제로 없었던 시험 이력을 합성하지 않는다.
- 보존·삭제 기간은 OD-011에서 확정한다. 기존 raw_event 3년 정책을 시험 관측에 자동 적용하지 않는다. 인덱스는 session/time, space/epoch/seq, producer/event 유일성, digest 조회를 중심으로 한다.

### 5.2 요청·동시성 경계

기존 API-SEQ-005의 good/bad 요청은 호환 유지. 별도 관측 제출·조회 계약을 추가하는 안이며 아래 경로와 새 필드는 **제안**이다. R0에서 API 카탈로그에 안정 ID·응답·권한을 확정한다.

```json
{
  "repository": "modem/sw",
  "base_branch": "main",
  "seq_epoch": 1,
  "session_id": "00000000-0000-4000-8000-000000000001",
  "expected_revision": 7,
  "event_id": "lab-a/run-42/result-1",
  "merge_seq": 10550,
  "commit_sha": "91c7aae00000000000000000000000000000000000",
  "artifact_id": null,
  "verdict": "inconclusive",
  "reason": "insufficient_exposure",
  "failure_signature": "NR-L1-RLF",
  "runtime_seconds": 21600,
  "failure_count": 0
}
```

JSON은 식별·판정 부분 예시다. P2의 scenario/environment 필수성·길이·단위는 R0에서 완전 DTO로 확정한다. 예시를 현행 endpoint에 보낼 수 있다고 안내하지 않는다.

처리 순서: 인증/저장소 접근 → 세션 소유·space/epoch 검증 → event 중복 확인 → 기존 세션 잠금과 revision 확인 → SHA/artifact 일치 확인 → 관측+경계+감사 트랜잭션 → 서버 계산 view. 동일 event/payload 재전송은 현재 revision이 바뀌어도 원래 결과를 돌려주고, 다른 payload는 409다. 400 입력 오류, 403 권한, 409 모순/경쟁, epoch stale은 기존 오류 계약과 정합화한다. 오래된 외부 결과는 역사 관측으로 보존 가능하되 현재 boundary에는 적용하지 않는다.

### 5.3 빌드 도착 순서와 보안

CI는 full SHA로 manifest를 먼저 발행할 수 있다. 미채번 시 pending 상태로 저장하고 동일 producer/build 재시도 및 주기적 reconciliation으로 연결한다. sequence 발급을 기다리느라 빌드를 막거나 CI run number를 새 sequence로 사용하지 않는다. epoch가 바뀐 과거 manifest는 자동으로 새 서수에 연결하지 않는다.

수동 경로는 개인 소유권과 기존 GHE 접근 범위를 적용한다. adapter용 credential은 사내 계약 이후 별도로 정의하며 사용자 ID를 payload에서 신뢰하지 않는다. URI는 승인된 scheme/host만 링크하고 서버 임의 fetch를 하지 않는다. 로그·감사·HTML에 token 또는 서명 URL을 남기지 않는다. build/run ID·reason으로 감사하되 장비 개인정보 최소화는 OD-011에서 정한다.

새 queue/runtime는 1차 필수가 아니다. 재시도/reconciliation이 필요해지면 기존 worker 프레임워크를 사용하고 job/event ID·backoff·DLQ를 async 문서에 확정한다. 지표는 manifest pending/불일치, observation 중복/충돌, stale reject, ambiguous 종료, 후보 선택 지연을 기록한다. 적용 NFR은 기존 baseline을 유지하고 pilot 측정치 없이 성능 달성을 선언하지 않는다.

## 6. MTBF 적용 조건

NIST의 HPP/exponential 모델은 일정 failure rate 가정을 둔다. 서로 다른 HW/RF/network/scenario나 failure signature를 합산하지 않는다. 독립·동질 장비만 exposure를 누적하고 재시도된 결과가 같은 runtime을 두 번 더하지 않게 한다.

`T/r`은 r>0에서의 추정치다. r=0이면 유한 추정치로 PASS를 만들지 않는다. 단측 90% zero-failure 하한은 `T / -ln(0.1)`이므로 목표 200시간에는 약 460.52 device-hours가 필요하다. 이는 원문의 약 460시간 예시를 해석한 값이며 양측 90% interval과 같은 조건이 아니다.

권고 판정은 승인된 interval의 L≥목표면 GOOD, U<목표면 BAD, 나머지는 INCONCLUSIVE다. 다만 **매 결과마다 같은 고정시점 confidence interval을 확인하고 유리할 때 중단하면 명목 confidence가 보장되지 않는다**. OD-013에서 고정 시험 계획 또는 검증된 순차 추론 방법과 후보 간 반복 비교 정책을 선택하기 전에는 통계값만 보여 주고 경계를 자동 축소하지 않는다. 수학 패키지·반올림·무한 상한 표현·model version과 golden fixture를 R8에서 고정한다.

먼저 짧은 deterministic screening으로 구간을 줄이고, 남은 2~4개 후보에 조건을 맞춘 시험을 수행한 뒤 최종 qualification을 외부에서 진행한다. 2~4는 권고 workflow이며 제품 보장 수치가 아니다.

## 7. 세션 크기의 구현 후보 분해

R0~R8은 **이 문서 안의 후보 식별자**이며 실행 가능한 WP가 아니다. R0 종료 후 승인 FR/REL을 연결하고 다음 사용 가능한 WP ID를 부여한다. 현재 구현 완료를 주장하지 않는다. 기본 선행은 WP-042·WP-025·WP-012; 기존 M 기능 WP-074·WP-088의 성공 여부는 regression의 신규 gate로 삼지 않는다.

| 후보 | 선행 | 구현 책임·파일 | 완료 기준과 검증 | 제외 |
| --- | --- | --- | --- | --- |
| R0 계약 정합화 | 없음 | 제품/문서 담당; SRS→PRD→glossary→matrix→UI→architecture→delivery→brief | OD-010·011 결정, DEV-719 정정, P1~P5 full FR/AC, API/ENT ID·JSON·권한·보존 확정, traceability와 strict gate 해소 | 앱 변경 |
| R1 수동 관측 수직 | R0 | DB/API/Web 담당; `packages/db/migrations/`, `bisect-session.ts`, 새 observation repo, `sequence/routes.ts`, `BisectPanel.tsx` | good/bad+시험 metadata 저장·이력 읽기, idempotency·소유권·동시성, reset 후 이력 보존 통합/브라우저 시험 | skip, artifact registry |
| R2 SKIP/INCONCLUSIVE | R1 | 동일 경로+도메인 후보 선택; `bisect.test.ts`, `flow-004-bisect.spec.ts` | 두 결과가 경계 불변, skip 재추천 차단, 불확실 재시험, 전부 skip 시 ambiguous, 기존 good/bad 호환 | artifact 기반 추천 |
| R3 manifest 등록·역조회 | R0 | DB/API·Build 담당; 새 artifact repo/등록·조회 route, sequence 연결 | full SHA 일치·다중 variant·digest 양방향, 중복·충돌, 미채번 pending→연결, epoch stale, 만료 metadata 시험 | binary 호스팅·자동 빌드 |
| R4 후보와 binary 연결 | R2,R3 | API/Web; bisect view·BisectPanel·ranges | Stage A 가용 binary 추천, 전체/testable 수 분리, 누락 culprit 유지, 외부 재빌드 등록 후 Stage B 재개 e2e | 장비 실행 |
| R5 Workbench 통합 | R4 | Web/QA; W-004·기존 workspace 진입·FLOW-004·a11y | repo/branch/epoch/I·PR·현재 M 표기, full SHA·build variant·4판정·이력, reader 진입·키보드·375px·light/dark·stale/403/409 검증 | 새 권한 역할·공유 세션 |
| R6 수동 pilot·운영 | R5 | Release/QA; release validation·RUNBOOK·측정 기록 | 아래 T01~T12, migration/rollback 복구, 사내 실제 binary로 후보→시험→기록 1회 이상, 이전 workflow와 시간 비교 | 실제 측정 없이 성공 선언 |
| R7 외부 result adapter | R4, OD-012 해소 | API/worker·MDVP 담당; 사내 경계 adapter | 계약 fixture·서명/인가·재전송·순서 역전·누적/증분·다른 사용자 세션 거절; 사내 end-to-end 별도 증거 | MDVP 내부 workflow·dispatch |
| R8 MTBF verdict | R1, OD-013 해소 | domain/API/Web·시험 책임자 | golden 계산·zero-failure·경계값·단위·동질군·누적 중복·중단 규칙, model version 감사; 승인 전 자동 적용 차단 | full qualification 실행 |

R1~R5가 한 세션의 범위를 넘으면 FR/DoD가 독립인 후속 WP로 나눈다. 특히 R3의 CI adapter와 pending reconciliation은 수동 registry 수직과 분리할 수 있다. R7·R8은 첫 수동 pilot의 선행이 아니다.

## 8. 검증 시나리오와 실행 명령

| 검증 ID | 수용 시나리오 | 통과 조건·담당 후보 |
| --- | --- | --- |
| T01 | dense 10000 good / 10255 bad | 항상 열린 내부에서 next 선택, monotone 축소. 이상적 약 8회는 설명값이며 hard SLA 아님 / R2 |
| T02 | sparse `[1,2,5,8,9]` | 기존 선택·직접 commit 결과 유지 / R1,R2 |
| T03 | SKIP·INCONCLUSIVE 반복 | boundary 불변, skip 추천 제외, 재시험 가능, 관측 이력 보존 / R2 |
| T04 | 내부 후보 전부 binary 없음·skip | result=null, unresolved interval과 ambiguous; 잘못된 converged 0건 / R4 |
| T05 | epoch 변경·재채번·다른 브랜치 | 오래된 mutation 거절, 과거 manifest/관측 자동 재해석 0건 / R1,R3 |
| T06 | 같은 event 재전송·다른 payload·동시 mark | 저장 1건·409·구간 확대 0건; 세션 reset 경쟁 포함 / R1 |
| T07 | 다른 사용자·무권한 저장소 | 조회/쓰기 거절, artifact URI·관측 유출 0건 / R1,R3,R7 |
| T08 | SHA 불일치·같은 revision 다중 build·만료 | 불일치 거절, variant 선택 가능, unavailable 명시 / R3,R4 |
| T09 | CI 먼저 도착·중복 reconciliation | pending 후 동일 SHA에 1회 연결, 새 counter 0개 / R3 |
| T10 | binary 누락 구간 → 외부 재빌드 등록 | coarse 구간 보존 뒤 fine 탐색 재개, 원인 direct push 허용 / R4 |
| T11 | zero failure·단위 오류·혼합 조건·중간 통계 조회 | 승인 모델 외 INCONCLUSIVE, 중복 exposure 0, 고정 confidence를 순차 보장으로 표시하지 않음 / R8 |
| T12 | migration·구버전 rollback·UI·pilot | 관측 백업/복구, feature off 시 기존 good/bad 동작, 영어·테마·키보드, 실측 원자료와 한계 기록 / R5,R6 |

현행 회귀 명령(구현 단계에 실행):

```bash
pnpm exec vitest run --config vitest.integration.config.ts apps/search-api/integration/sequence/bisect.test.ts
pnpm --filter @prs/web exec playwright test e2e/flow-004-bisect.spec.ts
pnpm --filter @prs/web run test:a11y
pnpm typecheck
pnpm lint
```

통합 시험의 DB/Redis 등 환경과 브라우저 baseURL은 저장소 기존 시험 설정을 따른다. 새 시험은 승인 FR/WP를 이름에 태그한다. 배포는 additive migration→flag off→API/Web 호환→pilot 활성 순서, rollback은 flag off와 이전 앱 복귀를 먼저 한다. append-only 관측 삭제를 rollback이라고 부르지 않는다. 백업·복원 검증 전 destructive down migration을 실행하지 않는다.

Pilot은 동일 조사 구간·시험 조건에서 후보 선택 시간, binary 찾기 시간, 오연결 수, ambiguous 수를 전후 비교한다. 목표 개선율·표본 수는 OD-013에서 측정 전에 확정하며 보고서의 “감소”를 이미 달성한 수치로 바꾸지 않는다. 장시간 시험 소요와 도구 조작 시간을 분리한다.

## 9. 승인 이후 cascade와 현재 gate

| 문서군 | R0 이후 실제 반영할 계약 |
| --- | --- |
| SRS·PRD·glossary·matrix | FR-SEQ-007의 AC-2/3/4/5 영향, 신규 관측/artifact/adapter/통계 FR, Integration 표시·관측·시험 가능 집합 용어, W-004/비UI 발행자 연결 |
| IA→wireframe→flow→state→component→tokens→QA | W-004 진입 보존, awaiting_evidence/ambiguous·이력·variant 선택, 영어 라벨·기존 Radix 토큰·접근성, T01~T12 매핑 |
| system→FE→BE→API→data→async→security→infra→observability→ADR | 외부 시험 경계, DTO·owner/idempotency·transaction·migration·보존·pending 재시도·서비스 인증·rollback·측정; 새 저장소/queue 도입 시 별도 ADR |
| roadmap→release validation→WP→ledger→brief | 승인 release와 한 세션 WP 확정, 선행/DoD/검증 연결, 영향 WP 재검증 상태와 기록 위치, 실측/fixture 구분 |

초기 `--report`는 Phase 2, 오류 2·경고 2. `--strict`는 오류 4·경고 2다. 기존 역사 ID 참조와 경로·placeholder 때문에 전체 handoff gate는 통과하지 못했다. 이번 문서는 그 gate를 건너뛰는 실행서가 아니다. 다음 작업은 R0의 범위·보존 계약 결정과 문서 정합화이며 CR-102·DEV-719·OD-010~013은 open이다.

## 10. 출처

변경 파일 목록: 신규 `pr_search_regression_implementation_plan.md`, `deep-research-report.html`; 갱신 `docs/README.md`, `00_governance/document_definitions.md`, `00_governance/change_control.md`, `10_requirements/feature.md`, `10_requirements/prd.md`, `40_delivery/pr_search_implementation_roadmap.md`, `40_delivery/pr_search_release_validation_plan.md`, `40_delivery/pr_search_work_packages.md`, `40_delivery/pr_search_implementation_traceability.md`, `20_derived_ui_specs/pr_search_ai_agent_implementation_request.md`, `20_derived_ui_specs/pr_search_ai_agent_execution_brief.md`. 연구 원문은 보존했다. 검증 결과는 CR-102 검증 기록이 소유한다.

- 사용자 연구: [deep-research-report_01.md](regression_workbench/deep-research-report_01.md), 분석일 2026-09-17. 원문의 모든 주장·예시는 참고 의견이며 현행 API 사용법과 구분한다.
- 프로젝트 정본: [SRS](../10_requirements/srs_final.md), [PRD 결정 목록](../10_requirements/prd.md), [작업 패키지](pr_search_work_packages.md), [원장](pr_search_implementation_traceability.md).
- Git 공식: https://git-scm.com/docs/git-bisect — first-parent·수동 판정·skip 후 단일 원인 특정 한계, 2026-09-17 확인.
- GitHub 공식: https://docs.github.com/en/actions/reference/workflows-and-actions/variables — GITHUB_RUN_NUMBER는 특정 workflow의 실행 번호, 2026-09-17 확인.
- NIST: https://www.itl.nist.gov/div898/handbook/apr/section4/apr451.htm — HPP/exponential 추정과 confidence bound·zero-failure, 2026-09-17 확인. 반복 관측 중단 정책의 별도 승인은 이 계획의 설계 제안이다.
