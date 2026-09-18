# PR Search Execution Brief for AI Agent

> 상태: review | 버전: v0.12 | 갱신일: 2026-09-18

CR-109 / WP-095: 사용자 후속 지시서 `../40_delivery/regression_workbench/UIUX/CLAUDE_REGRESSION_UI_BRIEF.md`와 B Atlas를 따른다. FR-REG-001의 첫 fixture UI 수직은 사용자가 구현을 지시한 범위다. 이전 CR-102의 전체 backend 계획을 선행 gate로 확대하지 않는다. actual MDVP/영속 history/통계 모델은 후속. 실행·시험·한계는 원장 WP-095를 읽는다. 기존 Search/ranges·개인 인가·M 의미를 유지하며 mock은 명시적으로 격리한다.


CR-102 Regression 후속: [구현 계획](../40_delivery/pr_search_regression_implementation_plan.md)의 현재 상태는 draft다. 연구 보고서만 읽고 SKIP/INCONCLUSIVE·artifact·MDVP·MTBF를 구현하지 않는다. R0의 OD-010·011 결정→SRS/traceability→UI/architecture→WP cascade와 handoff gate를 먼저 충족한다. 이후 배정된 WP의 선행·T01~T12를 읽고 기존 세션 잠금·epoch·소유권을 보존하며 구현 원장 3장과 FR→code/test 매핑을 갱신한다. 시험 실행은 외부 경계이며 M 번호 정의는 유지한다.

CR-079 WP-074 재개: [실행서](../40_delivery/pr_search_wp074_execution.md) → [상세 설계](../30_technical_architecture/pr_search_wp074_design.md) → [측정 가이드](../40_delivery/pr_search_wp074_measurement_guide.md) 전문. 실제 source와 계약을 대조한 뒤 S0~S6/T01~T06으로 구현한다. 이 설계 작성은 실행 허가가 아니다. DEV-581을 fixture 성공으로 닫지 않고 외부 실행·사내 NOT RUN·WP-075 비활성을 분리한다. source별 파일 소유·검증 기록과 Agent-Initiated Decisions를 남긴다.

## 1. 목적

이 문서는 AI Agent가 바로 구현 작업에 착수하기 위한 압축 실행 브리프다. 범위는 상위 문서가 결정하며, 이 브리프는 실행 순서와 계약만 요약한다.

## 0. 30초 요약

GitHub Enterprise의 PR·커밋을 웹훅으로 수집해 Elasticsearch에 색인하고, **커밋 SHA ↔ PR 양방향 검색**과 **Perforce Changelist를 대체하는 머지 시퀀스**를 제공하는 사내 읽기 전용 대시보드를 만든다.

가장 중요한 세 가지:

1. **머지 시퀀스는 이벤트가 아니라 git first-parent 히스토리에서 나온다.** `git rev-list --first-parent --reverse <branch>`의 서수가 시퀀스 값이다. 이 값은 언제든 git과 대조 검증 가능해야 한다 (ADR-007).
2. **권한 필터는 서버가 강제로 결합한다.** `applyMandatoryScopeFilter`를 거치지 않는 Elasticsearch 호출 경로를 만들지 않는다. 타입 시스템이 이를 강제한다 (ADR-008).
3. **PostgreSQL이 진실이고 Elasticsearch는 파생 뷰다.** ES 인덱스는 언제든 PostgreSQL만으로 전량 재구성 가능해야 한다 (ADR-004).

## 2. 읽기 순서

1. `../10_requirements/srs_final.md`
2. `../10_requirements/requirements_screen_traceability_matrix.md`
3. `../10_requirements/glossary.md`
4. `../10_requirements/prd.md`
5. `pr_search_product_ia.md`
6. `pr_search_wireframe_spec.md`
7. `pr_search_screen_flow_spec.md`
8. `pr_search_screen_state_matrix.md`
9. `pr_search_ui_component_spec.md`
10. `pr_search_design_system_tokens.md`
11. `pr_search_screen_qa_checklist.md`
12. `../30_technical_architecture/pr_search_system_architecture.md`
13. `../30_technical_architecture/pr_search_architecture_decision_records.md`
14. `../30_technical_architecture/pr_search_frontend_architecture.md`
15. `../30_technical_architecture/pr_search_backend_architecture.md`
16. `../30_technical_architecture/pr_search_api_contracts.md`
17. `../30_technical_architecture/pr_search_data_model.md`
18. `../30_technical_architecture/pr_search_async_events_jobs.md`
19. `../30_technical_architecture/pr_search_security_privacy_architecture.md`
20. `../30_technical_architecture/pr_search_infrastructure_operations.md`
21. `../30_technical_architecture/pr_search_observability_reliability.md`
22. `../40_delivery/pr_search_implementation_roadmap.md`
23. `../40_delivery/pr_search_work_packages.md`
24. `../40_delivery/pr_search_implementation_traceability.md`

한 세션에서 전부 읽지 않는다. 위 순서로 1~4번을 먼저 읽고, 담당 WP가 참조하는 문서만 추가로 읽는다 (6장 실행 루프 참조).

## 3. 절대 원칙

- `srs_final.md`와 `prd.md`가 범위를 결정한다.
- UI, architecture, delivery, agent brief는 범위를 새로 만들 수 없다.
- 구현 편의로 문서 범위를 조용히 바꾸지 않는다. 불일치는 `DEV-###` → `CR-###`로 처리한다.
- 도메인 명사는 `glossary.md`에서만 가져온다. 축약하지 않는다 (`sha` 아닌 `commitSha`).
- 시퀀스 값은 항상 `seq_epoch`, `sequence_space`와 함께 다룬다. 셋 중 하나만 저장·전달·표시하지 않는다.
- 소스 코드 본문을 저장하지 않는다. 매핑 `dynamic: strict`가 이를 강제하므로 우회하지 않는다.

## 4. 스택 결정 (ADR 확정 사항)

에이전트는 아래 결정을 **재결정하지 않는다.**

| 항목 | 결정 | 근거 ADR |
| --- | --- | --- |
| Language | TypeScript (전 계층), Node 20+, pnpm 10+ | ADR-001 |
| 모노레포 | pnpm 워크스페이스. `packages/{domain,query,contracts,es,db,github,bus}` + `apps/{ingest-gateway,pipeline-worker,search-api,web}` | ADR-001 |
| Frontend | Next.js App Router. 브라우저는 Next.js 라우트 핸들러만 호출하고, 핸들러가 `search-api`로 프록시 | ADR-011 |
| UI 프리미티브 | `@conductor-by-89soone/react` + `css` + `tokens`만. 다른 UI 라이브러리 금지. 리터럴 색상값 금지 | ADR-006 |
| Frontend 상태 | URL 질의 파라미터가 단일 진실. 전역 상태 라이브러리 미도입 | ADR-011 |
| HTTP 서버 | Fastify (`ingest-gateway`, `search-api`) | ADR-001 |
| 시스템 오브 레코드 | PostgreSQL 16 | ADR-004 |
| 검색 엔진 | Elasticsearch 8.x | ADR-003 |
| 인덱스 전략 | 엔티티는 고정 인덱스 + 별칭 + `repository_id` 라우팅. 원본 아카이브만 ILM 시계열 | ADR-003 |
| 이벤트 전달 | `EventBus` 포트 + Redis Streams 어댑터. Kafka는 임계 초과 시 어댑터 교체 | ADR-002 |
| 원본 아카이브 | Filebeat (NDJSON → ES). **엔티티 레인에는 쓰지 않는다** | ADR-002 |
| 커밋 그래프 | blobless bare 미러 우선, GitHub API 폴백 | ADR-005 |
| 시퀀스 | first-parent 서수 + 에폭. `(repository, base_branch)`마다 독립 | ADR-007 |
| 권한 | 서버 측 강제 필터 결합, 기본 거부, 접근 범위 밖은 404 | ADR-008 |
| 관계 | 별도 `prs-links` 간선 인덱스 + `link_summary` 핫패스 비정규화 | ADR-009 |
| 페이지네이션 | `search_after` 커서 전용. 오프셋 파라미터 미제공 | ADR-010 |
| 축약 SHA | `keyword` + `prefix` 질의, 최소 7자 | ADR-012 |
| 테스트 | Vitest (단위·통합), testcontainers (PG·ES), Playwright (E2E), axe (접근성) | 백엔드 11장 |

아래는 ADR이 아니라 사용자 결정(CR-004)으로 확정된 값이다. 역시 재결정하지 않는다.

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| ES 클러스터 | PR Search 전용 클러스터 3노드. 노드당 Docker 컨테이너 1개(총 3개), 복제본 1. 사내 공용 클러스터 미사용 | OD-006 / 인프라 4.1장 |
| 원본 보존 | `raw_event` 3년, 계획 용량 4TB. 월별 파티션 유지, 만료분은 파티션 드롭 | OD-003 / 데이터 모델 8장 |
| ES 아카이브 수명 | `prs-raw-events` ILM 창 약 97일. `raw_event` 보존과 **별개 값**이며 아카이브는 재구성 가능 | FR-ING-010 AC-1 / ADR-003 |
| 워크로드 기준선 | 1,000 PR/일 = 연 365,000건 = 5년 1,825,000건. NFR-003의 5년 500만 PR은 용량 설계 상한 | OD-007 / NFR-003 |
| 샤드 수 | ADR-003 초기값 그대로 (`prs-pull-requests` 6, `prs-commits` 12, `prs-links` 12, `prs-releases` 2) | OD-007 결정 후에도 불변 |

노드당 CPU·RAM·디스크와 Docker host 수는 확정되지 않았다. 이 값이 필요한 작업을 만나면 임의로 정하지 말고 `DEV-###`로 올린다 (인프라 4.1장).

## 5. 실행 명령

`../30_technical_architecture/pr_search_infrastructure_operations.md` 8장이 원본이다. 코드가 생기면 그 문서를 먼저 갱신한다.

```bash
pnpm install                      # 설치
pnpm dev                          # 전 앱 개발 서버 (docker compose로 PG/ES/Redis 포함)
pnpm typecheck                    # tsc --noEmit
pnpm lint                         # ESLint
pnpm lint:deps                    # 패키지 의존 방향 검사
pnpm test                         # 단위 + 계약
pnpm test:integration             # testcontainers
pnpm test:e2e                     # Playwright
pnpm test:a11y                    # axe
pnpm test:perf                    # 부하 시험
pnpm test:regression              # 도메인 정확성 회귀 (시퀀스 git 대조 등)
pnpm build                        # 빌드
pnpm db:migrate                   # 마이그레이션
pnpm db:seed                      # 합성 시드
pnpm es:apply-mappings            # 인덱스 생성 + 별칭
pnpm es:reindex --alias <별칭>    # 재색인 + 별칭 전환
```

## 6. 실행 루프 (WP 단위)

각 세션은 다음 루프를 따른다.

1. `../40_delivery/pr_search_work_packages.md`에서 선행 WP가 모두 `done`인 다음 WP를 고른다. 원장(`../40_delivery/pr_search_implementation_traceability.md`) 3장에서 상태를 확인한다.
2. **그 WP가 참조하는 문서만 다시 읽는다.** WP의 "관련 요구사항 / 관련 화면·플로우 / 관련 API·데이터·잡" 목록이 읽기 범위다. 전 문서를 다시 읽지 않는다.
3. WP의 "구현 범위" 안에서만 구현한다. "제외" 목록을 존중한다. 범위 밖 개선점은 코드가 아니라 메모로 남긴다.
4. WP의 DoD 전 항목과 "검증 방법"의 명령을 실행해 통과를 확인한다. DoD가 인용하는 QA 항목 ID(`QA-W001-03` 등)는 `pr_search_screen_qa_checklist.md`에서 확인한다.
5. 원장을 갱신한다: 3장 WP 상태·커밋/PR·검증 결과, 4장 요구사항-코드 매핑, 필요 시 7장 알려진 제한.
6. 문서와 현실이 어긋나면 원장 5장에 `DEV-###`를 등록하고 **중단하고 보고한다.** 코드로 우회하지 않는다.

WP 하나가 한 세션에 안 끝날 것 같으면, 쪼개지 말고 진행 상황을 원장에 `in_progress`로 기록하고 다음 세션에서 이어간다.

## 7. 금지 사항 (지름길 금지 목록)

- 빈 라우트, 미구현 스텁만 있는 컴포넌트, 장식용 목업으로 WP를 완료 처리하는 것
- 상태 매트릭스의 비정상 상태(`enrichment_pending`, `no_sequence`, `epoch_stale`, `sequence_reassigning`, `not_indexed`)를 구현하지 않는 것
- 권한 실패를 조용히 빈 결과로 처리하는 것 (기본 거부 원칙 위반)
- `applyMandatoryScopeFilter`를 우회하는 Elasticsearch 호출 경로를 만드는 것
- 접근 범위 밖 리소스에 403을 반환하는 것 (404여야 한다)
- 시퀀스를 웹훅 도착 순서 카운터로 구현하는 것 (git 대조 불가)
- 시퀀스 값을 에폭 없이 저장·전달하는 것
- 반개구간 `(from, to]` 규칙을 화면에 표시하지 않는 것
- 관계 간선을 근거(`evidence`) 없이 저장하는 것
- `heuristic` 신뢰도 관계를 근거 없이 표시하는 것
- ADR-006 아이콘 자산 예외 이외의 UI 라이브러리를 추가하거나 리터럴 색상값을 쓰는 것
- 오프셋 페이지네이션 파라미터를 API에 추가하는 것
- 매핑 `dynamic: strict`를 완화하는 것
- 조사 화면에 자동 폴링을 넣는 것 (A-001·A-003 운영 콘솔만 예외)
- 문서 범위를 조용히 바꾸는 것 — **이것이 유일한 절대 금지다**

## 8. WP별 첫 세션 안내

첫 세션은 **WP-001**이다. 다른 WP를 먼저 시작하지 않는다.

WP-001은 코드를 거의 만들지 않는다. 워크스페이스와 CI가 서고, `pnpm lint:deps`가 역방향 의존을 실제로 잡아내는 것이 목표다. 이 검사가 없으면 나중에 `packages/domain`이 `apps/web`을 참조하는 사고가 조용히 생긴다.

WP-001 완료 후 WP-002·WP-003·WP-005·WP-006은 병렬 착수 가능하다.

## 9. 제출 형식

세션 종료 시 다음을 보고한다.

- **구현 범위**: 완료한 WP ID와 실제 구현 내용
- **미구현 범위**: WP의 "제외" 목록 중 후속 WP로 넘긴 것
- **기술 결정**: 새로 내린 결정과 ADR 영향 (새 ADR이 필요하면 명시)
- **연결 포인트**: 이 WP가 만든 API·데이터·잡·이벤트 계약
- **검증 결과**: 실행한 명령과 결과. DoD 항목별 통과 여부
- **알려진 제한**: 이 WP가 남긴 제한
- **원장 갱신 확인**: 3장·4장·(필요 시)5장·7장 갱신 완료

**원장 갱신 없는 완료 보고는 완료가 아니다.**

## 10. GitHub Operations Plane (CR-005)

REL-007부터 적용된다. REL-001~006을 먼저 닫는다.

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| Plane 분리 | Operations는 별도 런타임·App·감사. `search-api`·`pipeline-worker`는 `gh`를 실행하지 않는다 | ADR-013 |
| 신원 | Operations App + 사용자 위임 토큰. 유효 권한 = App 권한 ∩ 사용자 권한 | ADR-014 |
| capability | 버전 고정 manifest에서 UI 생성. help 자동 파싱 + 사람의 의미 오버라이드 | ADR-015 |
| 실행 | `apps/gh-executor`. 고정 바이너리 + argv 배열, shell 미경유, 실행별 workspace | ADR-016 |
| 패키지 | `packages/gh-cli` 신규. 기존 `@prs/github`(REST)를 gh 래퍼로 바꾸지 않는다 | ADR-013 |
| 위험도 | R0 즉시 / R1 미리보기 / R2 확인 + 대상 재조회 / R3 강한 확인 + 승인 | ADR-016 |
| UI | `GenericCommandForm` 하나가 전 capability를 커버. 업무 화면은 그 위의 편의 레이어 | ADR-015 |
| 마이그레이션 | 006부터 additive. 001~005는 수정하지 않는다 — 실제 번호는 `028`(실행)·`029`(레지스트리)·`030`(운영 정책)이며 기존 파일은 고치지 않는다 | 데이터 모델 3.5 |
| 운영 정책 (CR-090) | 실행 허용 = 기능 켜짐 ∧ 현재 적재 정의의 운영 승인 ∧ 코드·manifest 실행 목록 ∧ 운영자 차단 없음 ∧ 레지스트리 판정 ∧ 사용자 권한. 판정식은 `@prs/gh-cli`의 `decideExecution` 하나이고 API 수락·실행기 claim·화면 표시가 같은 식을 부른다. 정책 표 쓰기는 마이그레이션 030의 SECURITY DEFINER 함수 하나다 | FR-GH-011 AC-6~AC-10, FR-GH-009 AC-8 |

절대 하지 않는 것:

```text
shell 경유 실행 (shell: true, bash -c, sh -c, eval)
사용자 입력 문자열을 명령 문자열로 연결
임의 shell 실행기 / gh alias --shell 등가 기능
설치 토큰으로 사용자 권한 우회
감사 없는 쓰기 실행
확인 없는 R2 이상 실행
capability를 조용히 숨기기
gh api로 정책 우회
토큰·비밀을 argv·로그·이력·감사에 기록
쓰기 작업 자동 재시도
운영 승인 없이 실행하거나 대기 요청에 과거 승인을 승계
운영 정책으로 실행 구현 목록을 넓히기
정책 표를 애플리케이션 롤(prs_app)로 직접 쓰기 — UPDATE 권한 부여 포함
```

측정 기준값 (gh 2.97.0): command node 228개(실행 가능 leaf 196, 그룹 32), command 고유 flag 1,034개, positional placeholder 230개, `--json` 출력 지원 40개(`--json` flag를 가진 41개 중 `workflow run`은 입력 flag). 정본은 SRS 9.8절 실측 기준 표다(CR-089가 옛 값 261·41을 그 표에 맞췄다). 이 수치는 고정된 버전에서 측정한 값이며 버전이 바뀌면 manifest와 함께 갱신한다.


## WP-073 작업대 실행 규칙 (CR-067)

기존 FR-SRCH-001·006~011, FR-SEQ-005, NFR-007 범위의 UI 품질 작업이다. 구현 상태는 WP 표/원장 3장·검증은 6.71장을 읽는다. Conductor·인가·URL/커서/에폭 계약을 보존하며 작업대 선택 요약에 새 API나 영구 저장을 더하지 않는다. 검증은 프로덕션 빌드로 실행하고 로컬 UI fixture와 사내 통합 검증을 구분한다.

## WP-074·WP-075 M 넘버 실행 규칙 (CR-077)

2026-09-10 P4 회고 회의가 결정한 M 넘버를 구현한다. 착수 전에 `srs_final.md`의 `FR-SEQ-008`·`FR-SEQ-009`와 ADR-007의 CR-077 Clarification, `ADR-022`를 먼저 읽는다. 지켜야 할 것 넷이다.

1. **M 넘버는 새 시퀀스가 아니다.** `merge_seq`에서 PR 연결이 있는 항목만 골라 1부터 센 값이며, 별도 채번기를 만들면 두 값이 갈라진다. 회의 문구의 "merged_at 순서"는 정본이 아니라 대조 대상이다 — `merge_seq` 순서가 정본이고 불일치는 지표로만 남긴다.
2. **WP-074는 `DEV-576`을 먼저 닫는다.** push 웹훅이 미러 fetch를 부르지 않아 `merge_seq`가 최대 6시간 늦게 붙는 상태이며, 그 위에서는 회의가 요구한 "거의 실시간"이 성립하지 않는다. 미러 fetch와 채번의 순서 보장이 이 WP의 실질적 난제다.
3. **WP-075는 이 제품이 GHE에 쓰는 최초의 자동 경로다.** 쓰기 반경은 PR 제목 한 필드이며 본문·레이블·상태로 넓히지 않는다(본문 표기는 별도 애플리케이션 몫이다). 조회용 Data App 자격 증명으로는 쓰지 않으며, 그 분리를 시험이 단언해야 한다.
4. **번호를 밀지 않는다.** 한 번 부여한 M 넘버는 어떤 경로로도 다른 항목으로 옮겨 가지 않는다. 앞선 항목의 PR 연결이 미확정이면 그 앞에서 멈추고 다음 회차가 이어받는다.

## CR-093 / WP-081 실행 정정

최신 Conductor의 Shell·W-001 적용 계약은 컴포넌트·토큰 명세와 ADR-006을 따른다. ResultTable 유지·아이콘 예외·선택/요청 보존을 원장 6.92장과 대조한다. WP-081 완료·발행을 선행 주장하지 말고 실제 검증·PR/main CI·릴리스 증거로 갱신한다. Recipe/R1/REL-007 확장은 이 작업에 포함하지 않는다.
