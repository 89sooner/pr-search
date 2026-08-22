# PR Search 구현 추적 원장

> 상태: review | 버전: v0.6 | 갱신일: 2026-08-20

## 1. 목적

구현이 시작된 후 문서와 코드의 정합성을 유지하는 살아있는 원장이다. 코딩 에이전트는 WP를 완료할 때마다 이 문서를 갱신한다. 이 문서는 기록용이며 범위를 결정하지 않는다.

**현재 상태: WP-011까지 완료 — REL-001 구현 범위가 닫혔고 REL-002가 시작됐다.** 워크스페이스 골격, PostgreSQL 스키마·리포지터리 계층, Elasticsearch 매핑·부트스트랩, GHE 웹훅 수신 게이트웨이, `EventBus` 포트와 Redis Streams 어댑터, GHE REST 클라이언트, 보강 워커, 그리고 **투영 워커**가 서 있다. 단위 195건·통합 158건이 전부 통과한다. **수집 경로가 웹훅에서 검색 인덱스까지 닫혔다** — 서명 검증 → `raw_event` 저장 → `prs:ingest` 발행 → NDJSON 아카이브 → 202, 그 뒤를 `enrich`가 받아 원본 커밋·변경 파일·리뷰를 채워 `EVT-ING-002`로 넘기고, `project`가 그것만 읽어 PR·커밋 문서를 만들어 Elasticsearch에 조건부 업서트한 뒤 `raw_event.processed_at`을 찍고 `EVT-ING-003`을 낸다. 오래된 이벤트는 새 상태를 덮지 않고, 커밋의 PR 소속은 순서와 무관하게 합집합으로 쌓인다. 이 환경에서 처음으로 실제 Elasticsearch(`mirror.gcr.io` 경유 8.19.0)를 띄워 ES 통합 시험을 돌렸고, 그 과정에서 WP-003의 별칭 라우팅 결함(DEV-021)을 찾아 고쳤다. 실제 GitHub App 자격 증명이 없어 real-GHE smoke는 여전히 미실행이다(선택 시험으로 남겨 두었고 건너뛴 사실이 실행 로그에 남는다). 여기에 **저장소 등록 API**가 더해져 수집 대상을 정식으로 등록·해제할 수 있고, **파이프라인 상태 API**가 수신량·대기열·지연·실패 대기열을 한 번에 보여 준다. **실패 대기열 관리 API**도 있어 격리된 이벤트를 보고 다시 흘려보낼 수 있다 — 한 (전달, 단계)에 행 하나로 누적되고, 3회 재처리 실패면 `held`, 끝까지 성공하면 투영이 `resolved`로 닫는다. 여기에 **구조화 질의 파서**가 더해져 `key:value` 질의가 AST가 되고 다시 질의 문자열로 되돌아온다 — 아직 그 AST를 읽는 검색 API는 없다. 채번·관계 파생과 검색 API·화면은 아직 없다.

## 2. 기록 규칙

- 커밋/PR 본문에 관련 ID를 남긴다: `Refs: WP-021 FR-SEQ-001`
- 테스트 이름 또는 인접 주석에 검증하는 FR/AC를 남긴다: `test("FR-SEQ-001 AC-2: 채번 순서가 first-parent와 일치한다")`
- 요구사항 그룹 전체를 구현하는 모듈은 파일 상단 주석에 FR 범위를 적는다. 함수마다 태그를 붙이지 않는다.
- 문서와 코드가 어긋나면 아래 편차 로그에 `DEV-###`로 등록하고 `../00_governance/change_control.md`의 `CR-###`로 연결한다. **조용히 코드만 바꾸지 않는다.**
- WP 완료 시 3장 상태, 4장 매핑, 6장 검증 결과를 함께 갱신한다.

## 3. WP 진행 상태

상태: `todo` / `in_progress` / `done` / `blocked`

| WP ID | 이름 | REL | 상태 | 담당 | 커밋/PR | 검증 결과 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WP-001 | 워크스페이스와 공유 패키지 골격 | REL-001 | in_progress | 에이전트 | `f36ab06`, `44c1772` / PR #2 | 로컬 6종 통과, 헬스 4종 HTTP 200, GitHub Actions `verify` 성공 (6.1장) | **구현은 완료. DoD 4항 중 3항 검증 완료.** `docker compose up` 기동 확인만 환경 제약으로 보류 (DEV-001). 후속 WP 착수는 막지 않는다 |
| WP-002 | PostgreSQL 스키마와 마이그레이션 | REL-001 | done | 에이전트 | `96d4e2f` / PR #2 | DoD 6항 전부 통과. 통합 26건, CI `verify`·`integration` 모두 성공 (6.2장) | 로컬은 네이티브 PostgreSQL 16.13, CI는 서비스 컨테이너 (DEV-006) |
| WP-003 | Elasticsearch 매핑과 인덱스 부트스트랩 | REL-001 | done | 에이전트 | `2477c74` / PR #4 | DoD 5항 전부 통과. 로컬 단위 27건 + CI `verify`·`integration` 성공 (6.3장) | DoD 1·2·3·5는 CI의 ES 서비스 컨테이너에서 검증 (DEV-008) |
| WP-004 | 웹훅 수신 게이트웨이 | REL-001 | done | 에이전트 | `6478ebc` / PR #5 | DoD 8항 전부 통과. 단위 71건·통합 47건, 부하 1000건 p95 61.6ms (6.4장) | 재전송 멱등을 기본 키에 맡길 수 없어 advisory lock + 조건부 INSERT로 강제했다 (DEV-009 → CR-007) |
| WP-005 | EventBus 포트와 Redis Streams 어댑터 | REL-001 | done | 에이전트 | `ab7c0a3` / PR #6 | DoD 4항 전부 통과. 단위 86건·통합 93건 (6.5장) | Redis Streams에는 파티션이 없어 토픽을 물리 스트림 N개로 펴서 구현했다. `prs:sequence` 파티션 수만 문서에 없어 8을 기본값으로 두고 DEV-010에 남겼다 |
| WP-006 | GHE 클라이언트와 rate limit 관리 | REL-001 | done | 에이전트 | `c130cf1` / PR #7 | DoD 5항 전부 통과 (목 서버 기준, 문서가 정한 검증 방법). 단위 126건 (6.6장) | 실제 GHE 자격 증명이 없어 read-only smoke 미실행 — 선택 시험으로 포함했고 REL-001 운영 readiness 전 게이트로 남긴다 |
| WP-007 | 보강 워커 | REL-001 | done | 에이전트 | `fb6e5c3` / PR #8 | DoD 6항 전부 통과. 단위 150건·통합 24건(worker/enrich) (6.7장) | CR-010이 정한 `EventBus` 처분 계약을 함께 구현했다. `raw_event.processed_at`은 찍지 않는다 — 색인 시점 표식은 WP-008의 것이다. 문서의 검증 명령이 필터로 동작하지 않아 DEV-017로 등록하고 정정했다 |
| WP-008 | 투영 워커와 버전 조건부 업서트 | REL-001 | done | 에이전트 | `3f8e39e` / PR #9 | DoD 8항 전부 통과. 단위 195건·통합 158건 전량 (6.8장) | CR-011이 정한 `EVT-ING-002` PR 필드 확장과 누적 필드 합집합을 함께 구현했다. `raw_event.processed_at`을 여기서 찍는다 — 색인 성공 뒤에만. 실제 ES로 돌리는 과정에서 WP-003의 별칭 고정 라우팅 결함(DEV-021)이 드러나 함께 고쳤다 |
| WP-009 | 실패 대기열과 재처리 | REL-001 | done | 에이전트 | `6342073` / PR #10 | DoD 6항 전부 통과. 단위 195건·통합 191건 전량 (6.9장) | CR-012가 정한 `(delivery_id, stage)` 업서트와 `resolved` 종료 상태를 함께 구현했다. JOB-ING-009의 `batch` 워커는 WP-019가 세우므로 재처리를 `ops` 모듈이 요청 안에서 수행한다(DEV-024). `operator` 역할 판정이 WP-012에 있어 임시 공유 토큰으로 막았고, 미설정이면 경로를 등록하지 않는다(DEV-025) |
| WP-010 | 저장소 등록 API와 파이프라인 지표 | REL-001 | done | 에이전트 | (이 PR) | DoD 6항 전부 통과. 단위 214건·통합 230건 전량 (6.10장) | CR-013이 정한 커밋 문서 표식·지표 출처 분리·이름 붙은 토큰을 함께 구현했다. 세 앱의 지표 모듈을 `@prs/metrics`로 합쳤다. 단계별 지연은 지표 저장소가 설정된 경우에만 채운다(DEV-029). k8s 매니페스트는 작성했으나 **클러스터에 적용해 보지 못했다** — 이 환경에 Kubernetes가 없다 |
| WP-009 | 실패 대기열과 재처리 | REL-001 | todo | - | - | - | - |
| WP-010 | 저장소 등록 API와 파이프라인 지표 | REL-001 | todo | - | - | - | - |
| WP-011 | 구조화 질의 파서 | REL-002 | done | 에이전트 | (이 PR) | DoD 7항 전부 통과. 단위 88건 (6.11장) | CR-014가 메운 빈칸(부정된 범위·값 검증 경계·범위 키·오류 판정 주체)을 함께 구현했다. AST를 ES 질의로 옮기는 것은 WP-013이다 |
| WP-012 | 인증과 접근 범위 강제 | REL-002 | done | 에이전트 | (이 PR) | DoD 10항 중 9항 통과, 1항 부분 (6.12장). 단위 175건 + 통합 47건 | CR-015가 메운 빈칸(신원 표현·무효화 대상 산출·경합 순서·역할 합성)을 함께 구현했다. OIDC 라우트는 `web`이 소유하므로 WP-015가 붙인다 — 이 WP는 라이브러리와 `search-api` 강제를 세운다. 구현 중 DEV-050(해소)·DEV-051(미해소)을 등록했다 |
| WP-013 | 검색 API 목록 조회 | REL-002 | done | 에이전트 | (이 PR) | DoD 7항 중 6항 통과, 1항 **NOT RUN** (6.13장). 단위 66건 + 통합 46건 | CR-016이 메운 빈칸(키→필드 표·파생 상태·다중 인덱스 정렬·완화 힌트 산출·응답 키 유무)을 함께 구현했다. NFR-001의 p95 500ms는 1000만 문서 데이터셋과 부하 harness가 없어 **측정하지 않았다**(DEV-058) — REL-002 성능 게이트로 넘긴다. 구현 중 DEV-059(해소)를 등록했다. 패싯·커서·전문 검색은 WP-032 |
| WP-014 | 식별자 해석 API | REL-002 | done | 에이전트 | (이 PR) | DoD 6항 중 4항 통과, 1항 부분, 1항 **NOT RUN** (6.14장). 단위 61건 + 통합 53건 | CR-017이 메운 빈칸(채워지지 않는 필드 처리·호스트 비교·릴리스 태그·정수와 SHA 접두의 겹침)을 함께 구현했다. **QA-W003-03(`direct_push`)은 도달 불가**라 통과하지 못했다(DEV-061) — push 이벤트 라우팅이 서는 WP-021의 몫이다. NFR-001의 단건 p95는 데이터셋이 없어 **측정하지 않았다**(DEV-058) |
| WP-015 | 웹 앱 셸과 Conductor 통합 | REL-002 | done | 에이전트 | (이 PR) | DoD 6항 중 4항 통과, 2항 부분 (6.15장). 단위 32건 + a11y 24건 + e2e 15건, axe 위반 0건, `checkContrast` 80쌍 중 0건 실패 | CR-018이 메운 빈칸(프록시 신원 전달·클라이언트 import 경계·harness·단축키 슬롯·OIDC 왕복 상태)을 함께 구현했다. **DEV-032/DEV-069가 여기서 닫힌다** — `pnpm test:a11y`·`test:e2e`가 저장소에 생겼고 WP 20곳이 그 이름을 참조한다. 구현 중 **DEV-073(좁은 화면에서 내비게이션 도달 불가)**과 **DEV-074(프록시 세션 판정의 시험 공백)**을 스스로 발견해 등록·해소했다. 화면은 만들지 않는다(WP-016 이후) — QA-COMMON-01·09·14는 셸이 소유한 부분까지만 검증했다 |
| WP-016 | W-001 통합 검색 화면 | REL-002 | done | 에이전트 | (이 PR) | DoD 6항 중 5항 통과, 1항 부분 (6.16장). 단위 32건 + a11y 62건 + e2e 26건, axe 위반 0건 | CR-019가 메운 빈칸(QA 항목 이중 배정·패싯 세 상태·시퀀스 미채번·`from_q`·최근 검색 출처·해석 상한·관계 배지 소유권)을 함께 구현했다. **상태 매트릭스 13종 전부**가 렌더링되고 각각 시험이 있다. `QA-W001-14`는 CR-019 DEV-075대로 **절반만** — "페이지 번호 UI 없음"은 통과, "커서 기반 동작"은 WP-032다. 구현 중 결함 셋을 스스로 잡았다: 붙여넣은 GHE URL이 전문 검색으로 떨어지던 것, QA-COMMON-16 검사의 거짓 경보, Conductor 규칙 위반 2건 |
| WP-017 | W-002 PR 상세 화면 | REL-002 | done | 에이전트 | (이 PR) | DoD 6항 중 4항 통과, 2항 부분 (6.17장). 단위 42건 + a11y 34건 + e2e 13건, axe 위반 0건 | CR-020이 메운 빈칸(커밋 총계·타임라인 네 상태·리뷰 상태 둘·GHE 링크 널 허용·`epoch_stale` 미구현·확장 조회 절반)을 함께 구현했다. `QA-W002-03`·`QA-W002-17`은 CR-020 DEV-082·088대로 **절반만** — 절삭 표시와 "확장 전 조회 금지"는 통과, 전체 건수는 WP-020, 확장 조회는 WP-031이다. 구현 중 **DEV-089(보관·파일 절삭을 어느 화면도 표시하지 않는다)**를 스스로 발견해 등록·해소했다. 변이 시험 48종 전부가 잡혔고, 그 과정에서 **시험 구멍 6개**를 찾아 메웠다 |
| WP-018 | W-003 커밋 상세 화면 | REL-002 | todo | - | - | - | - |
| WP-019 | 저장소 백필 잡 | REL-002 | todo | - | - | - | - |
| WP-020 | 커밋 그래프 접근 계층 | REL-003 | todo | - | - | - | OD-001 결정 전이면 두 경로 모두 구현 |
| WP-021 | 시퀀스 증분 채번 | REL-003 | todo | - | - | - | 핵심 WP |
| WP-022 | 시퀀스 재채번과 에폭 | REL-003 | todo | - | - | - | - |
| WP-023 | 앵커 정규화와 범위 조회 API | REL-003 | todo | - | - | - | - |
| WP-024 | 릴리스 수집과 포함 관계 | REL-003 | todo | - | - | - | - |
| WP-025 | W-004 범위 조사 화면 | REL-003 | todo | - | - | - | - |
| WP-026 | W-005 릴리스 화면과 구간 비교 | REL-003 | todo | - | - | - | - |
| WP-027 | 선행·후행 조회와 상세 화면 통합 | REL-003 | todo | - | - | - | - |
| WP-028 | 정합성 점검과 조정 스캔 | REL-003 | todo | - | - | - | - |
| WP-029 | 관계 간선 인덱스와 참조 추출 | REL-004 | todo | - | - | - | - |
| WP-030 | 되돌림·체리픽·스택 관계 파생 | REL-004 | todo | - | - | - | - |
| WP-031 | 관계 조회 API와 상세 화면 관계 섹션 | REL-004 | todo | - | - | - | - |
| WP-032 | 패싯·커서 페이지네이션·전문 검색 | REL-004 | todo | - | - | - | - |
| WP-033 | 저장된 검색 | REL-004 | todo | - | - | - | - |
| WP-034 | W-009 저장소 개요 화면 | REL-004 | todo | - | - | - | - |
| WP-035 | 무중단 재색인 | REL-004 | todo | - | - | - | - |
| WP-036 | 원본 아카이브 레인(Filebeat) | REL-004 | todo | - | - | - | - |
| WP-037 | 집계 API | REL-005 | todo | - | - | - | - |
| WP-038 | W-006 통계 대시보드 | REL-005 | todo | - | - | - | - |
| WP-039 | 감사 기록과 A-004 | REL-005 | todo | - | - | - | - |
| WP-040 | A-002·A-003 운영 콘솔 | REL-005 | todo | - | - | - | - |
| WP-041 | 안전 구간 표식 | REL-006 | todo | - | - | - | - |
| WP-042 | 이분 탐색 보조 | REL-006 | todo | - | - | - | - |
| WP-043 | 관계 그래프 API와 W-007 | REL-006 | todo | - | - | - | 조건부 (REL-004 ACC-06) |
| WP-044 | 검색 결과 내보내기 | REL-006 | todo | - | - | - | - |
| WP-045 | gh capability 레지스트리와 parity 검증기 | REL-007 | todo | - | - | - | CR-005 신규 |
| WP-046 | 위임 GitHub 신원과 Operations App | REL-007 | todo | - | - | - | CR-005 신규 |
| WP-047 | 격리 gh 실행기와 실행 수명주기 | REL-007 | todo | - | - | - | CR-005 신규 |
| WP-048 | W-010 GitHub Command Center 수직 슬라이스 | REL-007 | todo | - | - | - | CR-005 신규 |
| WP-049 | PR 작업 (W-011) | REL-008 | todo | - | - | - | CR-005 신규 |
| WP-050 | Issue·Discussion 작업 (W-012) | REL-008 | todo | - | - | - | CR-005 신규 |
| WP-051 | 저장소 작업 (W-013) | REL-009 | todo | - | - | - | CR-005 신규 |
| WP-052 | Actions·워크플로·실행·캐시 (W-014) | REL-009 | todo | - | - | - | CR-005 신규 |
| WP-053 | 릴리스·프로젝트 작업 (W-015, W-016) | REL-009 | todo | - | - | - | CR-005 신규 |
| WP-054 | 시크릿·변수·레이블·룰셋·키 (W-018) | REL-010 | todo | - | - | - | CR-005 신규 |
| WP-055 | Codespace·Gist·Attestation·고급 도구 (W-017, W-019, W-022) | REL-010 | todo | - | - | - | CR-005 신규 |
| WP-056 | gh API 탐색기 (W-020) | REL-010 | todo | - | - | - | CR-005 신규 |
| WP-057 | 임시 workspace와 로컬 git 작업 | REL-009 | todo | - | - | - | CR-005 신규 |
| WP-058 | Recipe 빌더 (W-023) | REL-011 | todo | - | - | - | CR-005 신규 |
| WP-059 | capability 드리프트와 정책 관리 (A-005, A-006) | REL-011 | todo | - | - | - | CR-005 신규 |
| WP-060 | 전체 parity 검증 | REL-011 | todo | - | - | - | CR-005 신규 |

## 4. 요구사항-코드 매핑

상태: `not_started` / `partial` / `implemented` / `verified`

| 요구사항 ID | 담당 WP | 구현 위치(모듈/경로) | 테스트 | 상태 |
| --- | --- | --- | --- | --- |
| FR-SRCH-001 | WP-014 | `packages/query/src/identifier.ts`, `packages/es/src/resolve-query.ts`, `apps/search-api/src/resolve/{service,routes}.ts` | `packages/query/src/identifier.test.ts`, `apps/search-api/integration/resolve/resolve.test.ts` | done (AC-1~AC-6. 릴리스 태그 판별만 제외 — 패턴이 정의되어 있지 않아 WP-024로 넘겼다, DEV-065) |
| FR-SRCH-002 | WP-014, WP-018 | `apps/search-api/src/resolve/detail.ts`, `packages/es/src/resolve-query.ts` | `apps/search-api/integration/resolve/resolve.test.ts`, `packages/es/src/resolve-query.test.ts` | partial (AC-1·AC-2·AC-4·AC-5 충족. **AC-3 `direct_push`는 도달 불가** — 커밋 문서가 PR 이벤트에서만 만들어진다, DEV-061 / WP-021) |
| FR-SRCH-003 | WP-014, WP-017 | `apps/search-api/src/resolve/detail.ts`, `apps/web/lib/pr-detail.ts`, `apps/web/components/{CommitList,EntityHeader,PrDetailView}.tsx`, `apps/web/app/pr/[owner]/[repo]/[number]/page.tsx` | `apps/search-api/integration/resolve/resolve.test.ts`, `apps/web/lib/pr-detail.test.ts`, `apps/web/a11y/pr-detail.test.tsx`, `apps/web/e2e/flow-002.spec.ts` | partial (AC-1·AC-2·AC-4 충족, **화면 결합은 WP-017에서 done** — 머지 커밋이 항상 첫 행이고 미머지면 사유를 그 행에 표시한다. **AC-3의 메시지 첫 줄·작성자·작성 시각은 커밋 문서에 없다** — 배열 모양만 객체로 두고 `commit_sha`만 채웠다, DEV-062 / WP-020. AC-4의 **전체 건수**도 절삭 시 없어 `null`로 두고 "250건 이상"으로 표시한다, DEV-082·083 / WP-020) |
| FR-SRCH-004 | WP-014, WP-016 | `packages/query/src/identifier.ts` (7자 하한), `packages/es/src/resolve-query.ts` (`prefix`), `apps/search-api/src/resolve/{service,routes}.ts`, `apps/web/lib/search-state.ts` (클라이언트 사전 판정), `apps/web/components/OmniSearchInput.tsx` | `packages/query/src/identifier.test.ts`, `packages/es/src/resolve-query.test.ts`, `apps/search-api/integration/resolve/resolve.test.ts`, `apps/web/lib/search-state.test.ts`, `apps/web/a11y/search.test.tsx`, `apps/web/e2e/flow-001.spec.ts` | done (AC-1~AC-4. 판별이 브라우저에서도 도는 순수 코드라 AC-2의 "검색을 수행하지 않는다"가 화면에서도 성립한다) |
| FR-SRCH-005 | WP-011, WP-016 | `packages/query/src/{keys,errors,ast,tokenizer,parse,serialize}.ts`, `apps/web/lib/tokens.ts`, `apps/web/components/QueryTokenBar.tsx` | `packages/query/src/{parse,serialize}.test.ts`, `apps/web/lib/tokens.test.ts`, `apps/web/a11y/search.test.tsx` | verified (AC-1~AC-6 전부. 화면의 오류 구간 강조는 WP-016) |
| FR-SRCH-006 | WP-013, WP-016 | `packages/es/src/query-builder.ts`, `apps/search-api/src/search/{routes,service,relaxation}.ts`, `packages/db/src/repositories/{repository,auth}.ts`, `apps/web/lib/facets.ts`, `apps/web/components/FacetRail.tsx` | `packages/es/src/query-builder.test.ts`, `apps/search-api/integration/search/list.test.ts`, `apps/web/lib/facets.test.ts`, `apps/web/a11y/search.test.tsx` | done (AC-1~AC-3, AC-6. 화면 쪽 결합은 WP-016) |
| FR-SRCH-007 | WP-013, WP-016 | `packages/es/src/sort.ts`, `packages/es/src/upsert.ts` (`doc_id`), `packages/es/src/mappings/*.ts`, `apps/search-api/src/search/{routes,service}.ts`, `apps/web/components/ResultTable.tsx` (`aria-sort`, 정렬 헤더) | `packages/es/src/sort.test.ts`, `packages/es/src/upsert.test.ts`, `apps/search-api/integration/search/list.test.ts`, `apps/web/a11y/search.test.tsx`, `apps/web/e2e/flow-001.spec.ts` | done (AC-1~AC-4. AC-4의 "문서 ID"는 `_id`가 아니라 같은 값의 `doc_id` 필드다 — DEV-059) |
| FR-SRCH-008 | WP-032 | - | - | not_started |
| FR-SRCH-009 | WP-032 | - | - | not_started |
| FR-SRCH-010 | WP-033 | - | - | not_started |
| FR-SRCH-011 | WP-032 | - | - | not_started |
| FR-SRCH-012 | WP-044 | - | - | not_started |
| FR-SEQ-001 | WP-002, WP-020, WP-021 | `packages/db/migrations/002_sequence.up.sql`, `packages/db/src/advisory-lock.ts`, `packages/db/src/repositories/merge-sequence.ts`, `packages/db/src/repositories/sequence-space.ts` | `packages/db/integration/advisory-lock.test.ts` (AC-6), `packages/db/integration/seed.test.ts` (AC-3) | partial (스키마·채번 동시성 제어. 실제 채번 로직은 WP-020) |
| FR-SEQ-002 | WP-023, WP-025 | - | - | not_started |
| FR-SEQ-003 | WP-023, WP-025 | - | - | not_started |
| FR-SEQ-004 | WP-024, WP-026 | - | - | not_started |
| FR-SEQ-005 | WP-022 | - | - | not_started |
| FR-SEQ-006 | WP-002, WP-041 | `packages/db/migrations/002_sequence.up.sql` (`safe_marker_current_uk`) | `packages/db/integration/constraints.test.ts` (AC-1) | partial (스키마만. 화면·API는 WP-041) |
| FR-SEQ-007 | WP-042 | - | - | not_started |
| FR-REL-001 | WP-027 | - | - | not_started |
| FR-REL-002 | WP-024 | - | - | not_started |
| FR-REL-003 | WP-029, WP-031 | - | - | not_started |
| FR-REL-004 | WP-030, WP-031 | - | - | not_started |
| FR-REL-005 | WP-030, WP-031 | - | - | not_started |
| FR-REL-006 | WP-030, WP-031 | - | - | not_started |
| FR-REL-007 | WP-031 | - | - | not_started |
| FR-REL-008 | WP-043 | - | - | not_started |
| FR-ING-001 | WP-004 | `apps/ingest-gateway/src/{signature,ingest,store,payload,events,archive,metrics,server,config}.ts`, `apps/pipeline-worker/src/outbox-relay.ts` | `apps/ingest-gateway/src/{signature,payload,ingest,server}.test.ts`, `apps/ingest-gateway/integration/{webhook,idempotency,load,enqueue}.test.ts`, `apps/pipeline-worker/integration/outbox-relay.test.ts` | verified (AC-1~AC-6 전부. AC-4는 발행 포함 부하 1000건 p95 35.6ms) |
| FR-ING-002 | WP-002, WP-004, WP-008 | `packages/db/migrations/001_ingestion.up.sql`, `packages/db/src/repositories/raw-event.ts`, `packages/db/src/advisory-lock.ts`, `apps/ingest-gateway/src/{store,payload}.ts`, `packages/domain/src/events.ts` | `packages/db/integration/constraints.test.ts`, `apps/ingest-gateway/integration/{webhook,idempotency}.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | verified (AC-1~AC-4에 더해 AC-5 결정론적 문서 ID — 같은 이벤트를 두 번 투영해도 문서가 하나다) |
| FR-ING-003 | WP-002, WP-004 | `packages/db/migrations/001_ingestion.up.sql`, `packages/db/src/partitions.ts`, `packages/db/src/repositories/raw-event.ts`, `apps/ingest-gateway/src/archive.ts` | `packages/db/integration/{partitions,constraints}.test.ts`, `apps/ingest-gateway/integration/webhook.test.ts` | partial (AC-1·AC-2·AC-4 충족. AC-3 원본만으로 재색인은 WP-008·WP-033) |
| FR-ING-004 | WP-006, WP-007 | `packages/github/src/{config,redact,errors,jwt,rate-limit,token-provider,token-pool,scheduler,transport,client}.ts`, `apps/pipeline-worker/src/{enrich,webhook-target,metrics}.ts`, `packages/bus/src/{types,backoff,redis-streams,in-memory}.ts`, `packages/domain/src/{events,event-id}.ts` | `packages/github/src/{redact,rate-limit,scheduler,jwt,config}.test.ts`, `packages/github/testing/{mock-ghe,client,smoke-real-ghe}.test.ts`, `apps/pipeline-worker/src/webhook-target.test.ts`, `apps/pipeline-worker/integration/worker/enrich.test.ts`, `packages/bus/integration/contract.ts` | verified (AC-1~AC-4 전부. AC-5 미러 우선 커밋 조회는 WP-020 — 지금은 ADR-005의 API 폴백 경로만) |
| FR-ING-005 | WP-005, WP-008 | `packages/bus/src/{types,topics,partition,config,redis-streams,in-memory}.ts`, `packages/es/src/{upsert,bootstrap,indices}.ts`, `apps/pipeline-worker/src/{project,documents,enriched-payload,metrics}.ts`, `packages/domain/src/events.ts` | `packages/es/src/upsert.test.ts`, `packages/es/integration/bootstrap.test.ts`, `apps/pipeline-worker/src/{documents,enriched-payload}.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | verified (AC-1~AC-5 전부. AC-5는 개발 데이터셋 20건 기준 전량 10초 버킷 이내) |
| FR-ING-006 | WP-019 | - | - | not_started |
| FR-ING-007 | WP-002, WP-007, WP-008, WP-009 | `packages/db/migrations/{001_ingestion,006_dead_letter}.up.sql`, `packages/db/src/repositories/dead-letter.ts`, `packages/bus/src/{backoff,ingest}.ts`, `apps/pipeline-worker/src/{enrich,project}.ts`, `apps/search-api/src/ops/{dead-letters,routes}.ts`, `apps/search-api/src/{config,metrics}.ts` | `packages/db/integration/dead-letter.test.ts`, `apps/search-api/integration/ops/dead-letter.test.ts`, `apps/pipeline-worker/integration/worker/{enrich,project}.test.ts`, `packages/bus/integration/contract.ts` | verified (AC-1~AC-5 전부. AC-4 재처리 멱등은 재투입 payload의 `delivery_id` 보존으로, 문서 수준은 WP-008의 결정론적 ID 시험으로 각각 검증) |
| FR-ING-008 | WP-035 | - | - | not_started |
| FR-ING-009 | WP-008, WP-010, WP-040 | `apps/search-api/src/ops/{repositories,ghe-lookup,routes}.ts`, `packages/db/src/repositories/{repository,audit,job}.ts`, `packages/es/src/registry.ts`, `packages/es/src/mappings/commits.ts`, `apps/pipeline-worker/src/{project,documents}.ts` | `apps/search-api/integration/admin/repositories.test.ts`, `packages/es/integration/registry.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | verified (AC-1~AC-5 전부. AC-5 감사 주체는 관리 토큰 이름이며 WP-012의 OIDC 신원이 대체한다) |
| FR-ING-010 | WP-036 | - | - | not_started |
| FR-ING-011 | WP-028 | - | - | not_started |
| FR-STAT-001 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-002 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-003 | WP-017, WP-037, WP-038 | `apps/web/lib/pr-detail.ts` (`timelineSteps`, `reviewerStates`), `apps/web/components/{PrTimeline,PrDetailView}.tsx` | `apps/web/lib/pr-detail.test.ts`, `apps/web/a11y/pr-detail.test.tsx` | partial (**PR 1건의 리드타임·첫 리뷰 대기·타임라인은 WP-017에서 done.** 승인 단계는 `done_at_unknown`이다 — `approved_at`이 매핑에 없어 **시각을 모른다**, DEV-084. 집계 지표(분포·추세)는 WP-037·WP-038) |
| FR-STAT-004 | WP-017, WP-037, WP-038 | `apps/web/lib/pr-detail.ts` (`ReviewStatus`), `apps/web/components/PrDetailView.tsx` | `apps/web/lib/pr-detail.test.ts`, `apps/web/a11y/pr-detail.test.tsx` | partial (**리뷰어별 상태는 "승인함 / 아직 아님" 둘뿐이다** — 투영이 리뷰어별 상태를 저장하지 않아 "변경 요청"을 만들지 않는다, DEV-085. 집계는 WP-037·WP-038) |
| FR-STAT-005 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-006 | WP-037, WP-038 | - | - | not_started |
| FR-AUTH-001 | WP-012, WP-015 | `packages/authz/src/{oidc,pkce,id-token,jwks,session,session-store,roles,config}.ts`, `apps/search-api/src/auth/*`, `apps/web/app/auth/{login,callback,logout}/route.ts`, `apps/web/app/api/[...path]/route.ts`, `apps/web/lib/{oidc-state,proxy}.ts` | `packages/authz/src/{id-token,oidc,session,session-store,roles}.test.ts`, `apps/search-api/integration/authz/enforcement.test.ts`, `apps/web/lib/{oidc-state,proxy}.test.ts`, `apps/web/e2e/shell.spec.ts` | done (AC-1~AC-5. WP-015가 브라우저 왕복을 채웠다 — 인가 리다이렉트·PKCE·`state`/`nonce` 검증·세션 발급·원래 경로 복귀·로그아웃. 왕복 상태는 짧은 수명 HttpOnly 쿠키로 나른다(DEV-071). **실제 IdP 왕복은 자격 증명이 없어 NOT RUN** — e2e는 OIDC 미구성 배포의 503과 라우트 계약까지 건다) |
| FR-AUTH-002 | WP-012 | `packages/authz/src/{scope,scope-source,scope-database}.ts`, `packages/es/src/scoped-query.ts`, `apps/search-api/src/auth/{principal,errors,me}.ts` | `packages/es/integration/scope-enforcement.test.ts`, `packages/es/src/architecture.test.ts`, `packages/authz/integration/scope.test.ts`, `apps/search-api/integration/authz/enforcement.test.ts` | done (AC-1~AC-6. 단, 검색·집계 API 자체는 WP-013·WP-014가 세운다 — 여기서는 필터와 강제 지점을 세우고 ES에 직접 물어 결과 집합을 검증했다) |
| FR-AUTH-003 | WP-012 | `packages/authz/src/{scope,invalidation}.ts`, `packages/db/src/repositories/auth.ts`, `packages/db/migrations/007_auth.up.sql`, `apps/ingest-gateway/src/{ingest,server}.ts`, `apps/pipeline-worker/src/authz.ts` | `packages/authz/{src/invalidation.test.ts,integration/scope.test.ts}`, `apps/pipeline-worker/src/authz.test.ts`, `apps/ingest-gateway/src/ingest.test.ts` | done (AC-1~AC-5. 적중률은 `access_scope_lookup_total{outcome}`) |
| FR-AUTH-004 | WP-002, WP-039 | `packages/db/migrations/004_app_state.up.sql`, `packages/db/migrations/005_roles.up.sql` | `packages/db/integration/audit-grants.test.ts` (AC-3) | partial (감사 테이블과 롤 권한. 기록·조회는 WP-039) |
| FR-ADMIN-001 | WP-010, WP-040 | `apps/search-api/src/ops/pipeline-status.ts`, `packages/db/src/repositories/pipeline.ts`, `packages/bus/src/{types,redis-streams,in-memory}.ts`, `packages/metrics/src/index.ts` | `apps/search-api/integration/ops/pipeline-status.test.ts`, `packages/bus/integration/contract.ts` | partial (AC-1의 단계별 지연을 뺀 전 항목과 AC-2·AC-3 충족. 단계별 지연은 지표 저장소가 설정된 경우에만(DEV-029), 시퀀스 공간 요약은 WP-021 이후. AC-4 `operator` 역할 판정은 WP-012) |
| FR-ADMIN-002 | WP-002, WP-019, WP-040 | `packages/db/migrations/004_app_state.up.sql` (`job_active_uk`), `packages/db/src/repositories/job.ts` | `packages/db/integration/constraints.test.ts` (AC-4) | partial (동시 실행 제약. 콘솔은 WP-040) |
| FR-ADMIN-003 | WP-028, WP-040 | - | - | not_started |
| NFR-001 | WP-013, WP-014, WP-023, WP-037 | `apps/search-api/src/search/{service,relaxation,routes}.ts` (`track_total_hits: 10000`, 완화 힌트 `msearch` 1회·상한 8, ES 마감 3초) | `apps/search-api/integration/search/list.test.ts` (왕복 수가 필터 수에 비례하지 않음) | **NOT RUN** (p95 실측 없음 — 1000만 문서 데이터셋과 부하 harness 부재, DEV-058. 예산을 지키는 **구조**만 시험으로 고정했다) |
| NFR-002 | WP-004, WP-005, WP-008 | `apps/ingest-gateway/src/{server,metrics}.ts`, `packages/bus/src/{types,topics,partition,config,redis-streams,in-memory}.ts`, `apps/pipeline-worker/src/{project,metrics}.ts` | `apps/ingest-gateway/integration/{load,enqueue}.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | partial (발행까지 포함한 수신 응답 p95 38.3ms / 예산 300ms. 수신→색인 지연은 `ingestion_lag_seconds`로 계측하며 개발 데이터셋에서 전량 10초 이내. 운영 규모 측정은 REL-001 성능 게이트) |
| NFR-003 | WP-002, WP-003 | `packages/db/migrations/*`, `packages/db/src/partitions.ts`, `packages/es/src/indices.ts` | `packages/db/integration/partitions.test.ts`, `packages/es/integration/bootstrap.test.ts` | partial (PostgreSQL 파티션 + ES 샤드 수. 용량 실측은 REL-001 이후) |
| NFR-004 | WP-010 (인프라) | - | - | not_started |
| NFR-005 | WP-003, WP-004, WP-012 | `packages/es/src/mappings/*` (`dynamic: strict`), `apps/ingest-gateway/src/signature.ts` | `packages/es/integration/behavior.test.ts`, `apps/ingest-gateway/src/signature.test.ts` | partial (매핑 수준 차단 + 웹훅 서명 검증·로그 금지 항목. 세션 인증은 WP-012) |
| NFR-006 | WP-039 | - | - | not_started |
| NFR-007 | WP-015 ~ WP-018, WP-025, WP-038 | `apps/web/components/*.tsx`, `apps/web/lib/nav.ts` | `apps/web/a11y/{shell,search,pr-detail}.test.tsx` (axe wcag2a/2aa/21a/21aa, 위반 0건), `apps/web/lib/architecture.test.ts` (QA-COMMON-16·17 정적 검사 + 화면 라우트 세션 확인), `pnpm test:contrast` (라이트·다크 80쌍, 실패 0건), `apps/web/e2e/{shell,flow-001,flow-002}.spec.ts` | partial (**셸·W-001·W-002는 done** — 랜드마크·스킵 링크·`aria-current`·라우트 전환 알림·좁은 화면 내비게이션·포커스 복귀에 더해, 두 화면의 모든 DoD 상태에 axe를 돌려 위반 0건. 상태를 **색이 아니라 글자로도** 구분한다(타임라인 네 상태, 시퀀스 배지). 나머지 화면은 WP-018 이후다. `color-contrast` axe 규칙은 jsdom에 레이아웃·canvas가 없어 끄고 `checkContrast`로 대신 건다 — 켜 두면 조용히 아무것도 검사하지 않으면서 통과로 보인다) |
| NFR-008 | WP-001, WP-035, WP-040 | `package.json` 스크립트, `scripts/lint-deps.mjs`, `.github/workflows/ci.yml`, `docker-compose.yml`, 각 앱 `src/server.ts`의 `GET /healthz` | `scripts/lint-deps.test.ts`, `apps/*/src/server.test.ts` | partial (WP-001분: 재현 가능한 검증 파이프라인과 헬스 엔드포인트. 롤백 절차·재색인 소요는 WP-035·WP-040) |
| FR-GH-001 | WP-045, WP-060 | - | - | not_started |
| FR-GH-002 | WP-047, WP-048 | - | - | not_started |
| FR-GH-003 | WP-048 | - | - | not_started |
| FR-GH-004 | WP-049 ~ WP-055 | - | - | not_started |
| FR-GH-005 | WP-058 | - | - | not_started |
| FR-GH-006 | WP-047, WP-052 | - | - | not_started |
| FR-GH-007 | WP-053, WP-057 | - | - | not_started |
| FR-GH-008 | WP-046 | - | - | not_started |
| FR-GH-009 | WP-048, WP-054, WP-059 | - | - | not_started |
| FR-GH-010 | WP-056 | - | - | not_started |
| FR-GH-011 | WP-045, WP-059 | - | - | not_started |
| FR-GH-012 | WP-048 | - | - | not_started |
| FR-GH-013 | WP-055, WP-059 | - | - | not_started |
| NFR-009 | WP-045, WP-060 | - | - | not_started |
| NFR-010 | WP-047, WP-054 | - | - | not_started |
| NFR-011 | WP-047 | - | - | not_started |
| NFR-012 | WP-048 | - | - | not_started |

## 5. 편차 로그 (DEV)

문서와 코드가 어긋났을 때 등록한다. 유형: `문서 오류` / `범위 공백` / `기술 제약`.

| DEV ID | 발견일 | 발견 내용 | 관련 FR/WP | 유형 | 연결 CR | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| DEV-001 | 2026-08-19 | `docker compose up -d`를 WP-001 환경에서 실행 검증하지 못했다. 컨테이너 레지스트리 블롭 호스트(`production.cloudfront.docker.com`)와 `docker.elastic.co`가 실행 환경의 이그레스 정책에서 403으로 차단된다. `docker compose config`는 통과하고 compose 정의 자체는 인프라 4장·8장과 일치한다. 우회하지 않았고 이미지 태그도 바꾸지 않았다 | WP-001 | 기술 제약 | 불필요 (설계 변경 없음) | open — 레지스트리 접근이 되는 환경에서 재검증 필요 |
| DEV-002 | 2026-08-19 | 인프라 3장은 `pipeline-worker`의 health check를 "하트비트"로 적었으나 WP-001 DoD는 "각 앱 헬스체크가 200을 반환한다"를 요구한다. 워커에 `node:http` 기반 `GET /healthz`를 두어 둘을 모두 만족시켰다. ADR-001의 "워커는 순수 Node 프로세스" 결정을 지키려고 Fastify를 넣지 않았다 | WP-001 | 문서 오류 | 불필요 (인프라 8장에 표기 반영) | resolved |
| DEV-004 | 2026-08-19 | 데이터 모델 3.1의 `raw_event_delivery_uk`는 `PRIMARY KEY (delivery_id, received_at)`와 컬럼·순서가 같은 중복 인덱스다. 5억 행·초당 2000 이벤트(NFR-002) 규모에서 중복 인덱스는 삽입 비용을 그대로 두 배로 만든다. 마이그레이션 001에서 생성하지 않았다 — 조용히 뺀 것이 아니라 여기 기록해 CR 판단에 올린다 | WP-002 / FR-ING-002 | 문서 오류 | **CR-006** | **resolved (2026-08-20)** — 데이터 모델 3.1에서 중복 인덱스를 제거하고 사유를 주석으로 남겼다. 코드는 이미 생성하지 않고 있었다 |
| DEV-005 | 2026-08-19 | 데이터 모델 3.4의 `audit_record`는 `PRIMARY KEY (audit_id)` + `PARTITION BY RANGE (occurred_at)`인데, PostgreSQL은 파티션 테이블의 유니크 제약이 파티션 키를 포함하도록 요구한다. 그대로 쓰면 마이그레이션이 실행되지 않는다. `PRIMARY KEY (audit_id, occurred_at)`으로 구현했다 | WP-002 / FR-AUTH-004 | 문서 오류 | **CR-006** | **resolved (2026-08-20)** — 데이터 모델 3.4의 PK를 `(audit_id, occurred_at)`으로 정정했다. 코드는 이미 그렇게 구현되어 있었다 |
| DEV-006 | 2026-08-19 | WP-002의 검증 방법은 testcontainers PostgreSQL이지만 이 환경은 컨테이너 이미지를 받을 수 없다(DEV-001). 통합 테스트가 접속 정보를 환경 변수(`DATABASE_URL` 또는 `POSTGRES_*`)에서 읽도록 만들고 네이티브 PostgreSQL 16.13으로 검증했다. CI는 서비스 컨테이너로 같은 테스트를 돌린다. testcontainers 래퍼 자체는 아직 도입하지 않았다 | WP-002 | 기술 제약 | 불필요 (검증 수단만 다름) | open — testcontainers 도입은 ES가 함께 필요한 WP-003에서 재검토 |
| DEV-007 | 2026-08-20 | 데이터 모델 4장은 공통 설정을 "모든 엔티티 인덱스"에 적용한다고 적었으나, 그 설정의 `index.sort.field`에 `merge_seq`가 들어 있고 `prs-links` 매핑에는 `merge_seq`가 없다. Elasticsearch는 매핑에 없는 필드로 `index.sort`를 걸면 인덱스 생성을 거부하므로 문서 그대로는 실행되지 않는다. `prs-links`에만 `index.sort` 없는 설정을 적용했다. 간선은 시퀀스 축으로 정렬할 이유도 없다 — 조회는 `from_id`/`to_id` 기준이다 | WP-003 / FR-ING-005 | 문서 오류 | **CR-007** | **resolved (2026-08-20)** — 데이터 모델 4장에 `index.sort` 적용 범위를 `merge_seq` 보유 인덱스로 명시했다. 코드는 이미 그렇게 구현되어 있었다 |
| DEV-008 | 2026-08-20 | WP-003의 검증 방법은 실제 Elasticsearch 대상 통합 테스트지만, 이 실행 환경은 `docker.elastic.co`와 `artifacts.elastic.co`가 이그레스 정책에서 403으로 차단되고 네이티브 설치본도 없어 ES를 띄울 수 없다. DoD 4항(컴파일 타임 가드)만 로컬에서 검증했고 나머지 4항은 CI의 Elasticsearch 서비스 컨테이너에서 검증한다. 우회하거나 목으로 대체하지 않았다 | WP-003 | 기술 제약 | 불필요 (검증 수단만 다름) | **resolved (2026-08-20)** — WP-008 작업 중 `mirror.gcr.io/library/elasticsearch:8.19.0`이 이그레스 정책을 통과하는 것을 확인했다. `docker.elastic.co`와 Docker Hub 블롭 호스트는 여전히 403이지만 gcr 미러 경로가 열려 있다. 실제 ES 8.19.0을 띄워 `packages/es` 통합 스위트 19건을 전부 돌렸고, 그 과정에서 DEV-021(별칭 고정 라우팅)이 드러났다 — 목으로 대체했다면 발견하지 못했을 결함이다 |
| DEV-009 | 2026-08-20 | 데이터 모델 3.1은 `raw_event`의 멱등 제약을 "기본 키가 그대로 강제한다"고 적었으나 이 파티션 구성에서는 성립하지 않는다. PostgreSQL은 파티션 테이블의 유일 제약이 파티션 키를 포함하도록 요구해 기본 키가 `(delivery_id, received_at)`이고, GHE 재전송은 수신 시각이 달라 충돌하지 않는다 — 문서대로 "INSERT 충돌을 잡아 중복 처리"만 구현하면 같은 `delivery_id`가 두 행이 되어 FR-ING-002 AC-2와 WP-004 DoD 3이 깨진다. 실제로 조건부 INSERT를 빼고 돌려 확인했다(동시 8건 → 8행). 게이트웨이가 같은 트랜잭션에서 `delivery_id` advisory lock을 잡고 존재 검사와 INSERT를 한 문장으로 묶어 강제한다. 기본 키 충돌은 마지막 방어선으로 남겼다. **마이그레이션 001~005는 건드리지 않았다** | WP-004 / FR-ING-002 | 문서 오류 | **CR-007** | **resolved (2026-08-20)** — 데이터 모델 3.1에 파티션 유일 제약의 한계와 게이트웨이 멱등 저장 SQL을 명시했다. SRS FR-ING-002 AC-1이 요구하는 결과(중복 저장 차단)는 그대로 충족되므로 요구사항은 변경하지 않았다 |
| DEV-010 | 2026-08-20 | 비동기 문서 2장의 스트림 표는 동시성을 다섯 스트림에 숫자로 적었지만 `prs:sequence`만 "시퀀스 공간당 1 (advisory lock)"이라고만 적혀 있어 전체 파티션 수를 알 수 없다. Redis Streams 어댑터는 토픽을 물리 스트림 N개로 펴므로 이 숫자가 반드시 필요하다. 순서 보장은 advisory lock이 이미 하므로 이 값은 처리량 조절값이며, 관계 파생과 같은 8을 코드 기본값으로 두고 `PRS_PARTITIONS_prs:sequence` 환경 변수로 덮어쓸 수 있게 했다. **확정한 것이 아니라 기본값을 둔 것이다** — 운영 실측 뒤 사용자가 정하면 코드 변경 없이 반영된다 | WP-005 / FR-SEQ-001 | 문서 공백 | 미등록 — 사용자 결정 후 비동기 문서 2장에 반영할 CR 필요 | open |
| DEV-011 | 2026-08-20 | CR-005의 gh 인벤토리 수치 중 positional placeholder만 실측과 달랐다. 문서는 261개로 적었으나 gh 2.97.0을 다시 설치해 재실측한 값은 230개다. `gh help reference`의 명령 헤딩 기준과 command node 228개 각각에 `gh <path> --help`를 실행한 USAGE 기준이 모두 230으로 일치한다. 나머지 수치(command node 228, leaf 196, 그룹 32, command 고유 flag 1,034, `--json` 지원 41)는 CR-005와 **정확히 일치**했다. 261이 어떻게 나왔는지는 당시 스크립트가 저장소에 없어 재현할 수 없다 — 추정하지 않고 실측값으로 정정했다 | CR-008 / FR-GH-001, NFR-009 | 문서 오류 | **CR-008** | **resolved (2026-08-20)** — SRS §9.8 실측 표와 NFR-009 게이트를 230으로 정정하고, 새로 측정한 차원(inherited flag 312, short alias 625, 반복 가능 37, `--json` 필드 707, alias 보유 command 44)을 함께 기록했다 |
| DEV-012 | 2026-08-20 | 재시도 횟수가 문서 간에 어긋난다. FR-ING-007 AC-1은 "최대 5회 + 1/2/4/8/16초", 비동기 5.1도 5회, WP-007 DoD도 "5회 소진 시 DLQ"인데 **FR-ING-004의 예외/실패 처리만 "재시도 3회"**로 적혀 있다. 승인된 표준 재시도 정책은 하나여야 한다 | WP-007 / FR-ING-004, FR-ING-007 | 문서 오류 | **CR-010** | **resolved (2026-08-20)** — FR-ING-004 표기를 5회로 정정. 제품 동작 변경이 아니라 이미 승인된 표준 정책과의 정합성 수정이다 |
| DEV-013 | 2026-08-20 | `EVT-ING-002`가 `{delivery_id, repository_id, entity_kind, entity_id, enrichment_pending, correlation_id}`만 나른다. 그런데 WP-008 투영은 `changed_files_count`·`additions`·`deletions`·`first_review_wait_seconds`·커밋 SHA 목록을 필요로 한다. 마이그레이션 001~005에 보강 결과 저장 테이블이 없고, 그 값을 담을 곳이 어디에도 없다 — 이대로면 WP-008이 GitHub API를 다시 호출해야 하고 그것은 FR-ING-004의 rate limit 설계를 무의미하게 만든다 | WP-007 / FR-ING-004, FR-ING-005 | 범위 공백 | **CR-010** | **resolved (2026-08-20)** — `EVT-ING-002`를 self-contained bounded 이벤트로 확정하고 `@prs/domain`에 타입을 뒀다. 원본 웹훅 전량·patch/diff·소스 코드·토큰은 싣지 않으며 커밋 250건·파일 3000건 상한을 유지한다 |
| DEV-014 | 2026-08-20 | `EventBus` 핸들러 계약이 "정상 반환=ack, 던짐=재전달" 둘뿐이다. 재전달 간격은 어댑터 설정값 `claimIdleMs`(기본 30초) 고정이고 `delivery_count`는 재전달을 무조건 센다. 그래서 (a) 1/2/4/8/16초 백오프를 표현할 수 없고 (b) GitHub이 알려 준 `retryAt`(예: 10분 뒤)까지 미룰 수 없으며 (c) rate limit 대기 중 30초마다 재전달되어 **10분이 되기 전에 재시도 5회를 소진하고 DLQ로 간다**. rate limit은 실패가 아닌데 실패로 집계되는 셈이다 | WP-007 / FR-ING-004 AC-2, FR-ING-007 AC-1 | 범위 공백 | **CR-010** | **resolved (2026-08-20)** — 핸들러가 처분(`HandlerDisposition`)을 돌려줄 수 있게 작은 확장을 더했다. `retry`(표준 백오프), `defer`(지정 시각까지 미루며 재시도 예산을 소비하지 않음), `dead_letter`(종료 후 ack). 새 큐 프레임워크를 만들지 않았고 Redis·인메모리 두 어댑터가 같은 계약을 통과한다 |
| DEV-015 | 2026-08-20 | WP-006의 `TokenPool`은 `org → installationId` binding을 요구하는데, `pipeline-worker`가 기동할 때 그 binding을 **어디서 얻는지가 문서에도 코드에도 없다**. 임의의 고정 installation ID를 코드에 넣거나 특정 개발 환경 값에 묶으면 다른 조직 저장소가 조용히 처리되지 않는다 | WP-007 / FR-ING-004 | 범위 공백 | **CR-010** | **resolved (2026-08-20)** — 환경 변수 `GHE_INSTALLATIONS`(`org:installationId` 쉼표 구분)를 1차 출처로 정하고 파싱·검증을 `@prs/github`에 뒀다. 등록되지 않은 조직의 이벤트는 조용히 넘기지 않고 non-retryable 실패로 분류해 DLQ에 사유를 남긴다. 장래 저장소 등록(FR-ING-009) 기반 조회로 대체할 수 있게 출처를 한 곳으로 모았다 |
| DEV-016 | 2026-08-20 | `prs:ingest`에는 지원 이벤트 9종이 모두 들어오는데 소비자는 `enrich` 그룹 하나다. 시스템 아키텍처 6.1은 "`push` 이벤트면 `sequence` 워커가 채번한다"고 적었지만 `push` 이벤트가 `prs:ingest`에서 `prs:sequence`로 어떻게 넘어가는지는 어디에도 없다. `EVT-AUTH-001`의 발행자는 게이트웨이로 되어 있어 `member`/`team`/`repository`도 이 경로가 아니다 | WP-007 / FR-SEQ-001, FR-AUTH-003 | 범위 공백 | 미등록 — 라우팅을 소유한 WP-021(시퀀스)·권한 WP에서 결정할 CR 필요 | open — WP-007은 PR 이외 이벤트를 처리하지 않고 ack한다. **원본은 `raw_event`에 남아 있으므로 유실이 아니다**(ADR-004: PostgreSQL이 시스템 오브 레코드). 다만 소비자가 생기기 전까지 그 이벤트들은 진행되지 않는다 |
| DEV-017 | 2026-08-20 | WP 검증 방법이 모두 `pnpm <스크립트> -- <필터>` 형태인데 **이 형태는 필터로 동작하지 않는다**. vitest 4의 CLI 파서(cac)는 `--` 뒤 인자를 위치 인자가 아니라 `argv['--']`에 담으므로 필터가 비어 스위트 전량이 돈다. `pnpm test:integration -- worker/enrich`는 통합 스위트 18개 파일을 전부 돌리며, 그것을 "해당 시험이 통과했다"고 읽으면 실제로 무엇이 검증됐는지와 어긋난다. WP-004·WP-005·WP-006 검증 기록이 같은 현상을 세 번 적어 두고도 출처 문서를 고치지 않았다 | WP-004, WP-005, WP-006, WP-007 / 전 WP 검증 방법 | 문서 오류 | 미등록 — 문서 표기 정정이라 CR 불요(작업 패키지·검증 계획 모두 `review` 상태) | **resolved (2026-08-20)** — `../40_delivery/pr_search_work_packages.md` 63줄과 `pr_search_release_validation_plan.md` 3줄에서 `--`를 제거해 실제로 필터가 걸리는 형태로 고쳤다. WP-007 통합 시험은 `apps/pipeline-worker/integration/worker/enrich.test.ts`에 두어 문서가 적은 `worker/enrich` 필터가 실제로 그 파일을 고르게 했다 (`pnpm test:integration worker/enrich` → 파일 1개, 24건) |
| DEV-018 | 2026-08-20 | `EVT-ING-002`의 `pull_request`가 `number, title, state, merged, merged_at, merge_commit_sha, author, head_ref, head_sha, base_ref, base_sha` 11개만 나른다. 그런데 **WP-008 DoD가 요구하는 사전 계산 필드 `lead_time_seconds`(= `merged_at` − `created_at`)와 `first_review_wait_seconds`(= 최초 리뷰 − `created_at`)는 `created_at` 없이 계산할 수 없다.** PR 매핑(ENT-CORE-002)이 선언한 `body`·`draft`·`labels`·`updated_at`·`closed_at`도 출처가 없다. CR-010이 `EVT-ING-002`를 self-contained로 만든 목적이 "투영이 GitHub API를 다시 부르지 않는 것"인데, 이 상태로는 투영이 `raw_event.payload`를 다시 파싱하거나 PR API를 다시 불러야 한다 | WP-008 / FR-ING-005, FR-ING-004 | 범위 공백 | **CR-011** | **resolved (2026-08-20)** — 경계를 "이번 WP가 쓰는 필드"가 아니라 **"PR 문서 매핑이 선언한 PR 고유 필드 전부"**로 정하고 `created_at`, `updated_at`, `closed_at`, `body`, `draft`, `labels`를 `PullRequestSummary`·`EnrichedPullRequest`에 더했다. 웹훅 payload와 PR API 응답에 모두 이미 있어 API 호출이 늘지 않는다. patch/diff 본문·소스 코드·토큰은 여전히 싣지 않는다 |
| DEV-019 | 2026-08-20 | 데이터 모델 5장의 조건부 업서트 스크립트가 `params.doc`의 모든 키를 단순 대입한다. `commit.pull_request_numbers`는 데이터 모델 5장 자신이 **N:M**이라고 적은 관계인데, 커밋 하나가 두 PR에 속하면 나중 이벤트가 앞 PR 번호를 지운다. 게다가 버전 비교가 앞서므로 **오래된 이벤트는 noop이 되어 자기 소속을 아예 추가하지 못한다** — 어느 순서로 와도 한쪽을 잃는다. FR-SRCH-002(SHA → PR)의 핵심 기능이 조용히 깨지는 자리다 | WP-008 / FR-SRCH-002, FR-ING-005 AC-1 | 문서 오류 | **CR-011** | **resolved (2026-08-20)** — 스크립트를 상태 필드(`params.doc`, 버전 비교 대상)와 누적 필드(`params.union`, 버전과 무관하게 항상 합집합)로 나눴다. 집합 소속은 단조 증가하고 순서에 무관하므로 버전 비교의 대상이 아니다. 데이터 모델 5장 스크립트를 실제 구현과 일치시켰다 |
| DEV-020 | 2026-08-20 | FR-ING-009 AC-4는 "미등록 저장소의 웹훅 이벤트는 원본 보관은 하되 투영 처리는 하지 않는다"고 정했으나 **FR-ING-005에는 그 규칙이 없다.** 투영은 `org_id`·`visibility`·`repository`를 `repository` 테이블에서만 얻으므로 미등록 저장소로 문서를 만들면 그 필드들이 비고, 그런 문서는 ADR-008의 필수 접근 범위 필터(`terms org_id` / `terms repository_id`)에 걸리지 않는다 — 검색되지 않는 문서가 인덱스에 남는다. 투영 워커가 이 경우를 어떻게 처분하는지(ack인지 DLQ인지)도 어디에도 없었다 | WP-008 / FR-ING-005, FR-ING-009 AC-4, FR-AUTH-002 | 범위 공백 | **CR-011** | **resolved (2026-08-20)** — FR-ING-005 예외/실패 처리에 미등록 저장소 규칙을 명시했다. 투영은 문서를 만들지 않고 ack하며, **실패가 아니므로 실패 대기열로 보내지 않는다**. 원본은 `raw_event`에 남아 있어 등록 후 백필(FR-ING-006)로 채울 수 있다 |
| DEV-021 | 2026-08-20 | WP-003의 부트스트랩이 별칭에 `routing: 'repository_id'`를 걸었다. **Elasticsearch 별칭의 `routing`은 필드 이름이 아니라 고정 라우팅 값이다.** 그래서 (a) 이 별칭으로 색인된 모든 문서가 문자열 `"repository_id"` 하나가 가리키는 **단일 샤드**로 몰려 ADR-003의 샤딩 설계가 정반대로 뒤집히고, (b) 문서별 `_routing`을 준 요청은 `illegal_argument_exception`(`Alias [prs-commits] has index routing associated with it`)으로 **거부된다**. WP-008 투영은 문서마다 `repository_id` 값을 라우팅으로 주므로 색인이 통째로 실패했다. WP-003의 DoD 시험이 `index_routing: 'repository_id'`를 **기대값으로 못 박아** 결함을 그대로 굳혀 두었다 — 별칭 메타데이터만 보고 문서를 실제로 색인해 보지 않았기 때문이다 | WP-003, WP-008 / FR-ING-005, ADR-003 | 구현 결함 | 불필요 (문서가 옳고 코드가 틀렸다) | **resolved (2026-08-20)** — `putAlias`에서 `routing`을 제거했다. `_routing`은 색인·조회 요청마다 `repository_id` **값**으로 준다. WP-003 시험을 "별칭에 고정 라우팅이 없다" + "문서별 라우팅으로 색인하고 같은 라우팅으로 되찾는다"로 바꿨다. 배포된 클러스터가 없어 기존 별칭 마이그레이션은 필요 없다 |
| DEV-022 | 2026-08-20 | `dead_letter`에 `(delivery_id, stage)` 유일 제약이 없고 `recordDeadLetter`가 항상 INSERT한다. 그래서 재처리가 다시 실패할 때마다 `reprocess_count = 0`인 **새 행**이 생긴다. FR-ING-007 예외 처리의 "동일 이벤트가 3회 재처리 실패하면 보류 상태로 전환"은 한 행에 누적돼야 성립하므로 **이 상태로는 `held`에 영원히 닿지 않는다**. AC-5의 100건 경보도 서로 다른 이벤트 수가 아니라 실패 횟수를 세어 같은 이벤트 하나가 임계를 넘길 수 있다. `EVT-ING-004`는 이미 멱등 키를 `(delivery_id, stage)`로 정해 두었는데 저장 계층이 그것을 강제하지 않았다 | WP-009 / FR-ING-007 AC-2·AC-5, EVT-ING-004 | 범위 공백 | **CR-012** | **resolved (2026-08-20)** — 유일 제약을 걸고 기록을 업서트로 바꿨다. 충돌 시 상태 전이를 한 문장으로 정의했다 — `reprocessing`에서 온 충돌만 `reprocess_count`를 올린다(재처리가 실패했다는 뜻), `resolved`에서 온 충돌은 0으로 되돌린다(이전 주기를 물려받지 않는다) |
| DEV-023 | 2026-08-20 | `dead_letter.state`가 `pending`/`reprocessing`/`held` 셋뿐이라 **재처리 성공을 표현할 자리가 없다.** 재투입은 비동기라 API가 응답할 시점에 파이프라인은 아직 돌지도 않았고, 성공한 행을 `reprocessing`으로 두면 경보 임계(100건)를 영구히 잠식한다. 행을 지우면 데이터 모델 9장이 이 표를 90일 보존 대상으로 둔 것과 어긋나고 "무엇이 왜 실패했다가 언제 풀렸는지"라는 운영 기록이 사라진다 | WP-009 / FR-ING-007 AC-3·AC-5 | 범위 공백 | **CR-012** | **resolved (2026-08-20)** — 종료 상태 `resolved`를 더했다. 판정 지점은 투영이 `raw_event.processed_at`을 찍는 자리다 — 이벤트가 끝까지 갔다는 증거가 그곳 말고 없다. 조회 API가 기본적으로 `resolved`를 빼고 보여 준다 |
| DEV-024 | 2026-08-20 | JOB-ING-009(실패 대기열 재처리)의 워커가 `batch`로 지정돼 있는데 **`batch` 역할과 `prs:batch` 스트림은 WP-019가 세운다.** WP-009의 선행은 WP-007·WP-008뿐이라 문서를 그대로 따르면 착수 자체가 불가능하다. 진행률 이벤트 `EVT-JOB-001`도 같은 이유로 소비자가 없다 | WP-009, WP-019 / FR-ING-007 AC-3, JOB-ING-009 | 범위 공백 | **CR-012** | **resolved (2026-08-20)** — 재처리는 "행을 읽어 스트림에 다시 넣는" I/O 가벼운 작업이라 `ops` 모듈이 요청 안에서 직접 수행한다(1회 최대 500건). 새 워커 역할을 앞당겨 만들지 않았다. `EVT-JOB-001` 진행률과 10분 타임아웃은 `batch`가 생기는 WP-019부터 적용한다 |
| DEV-025 | 2026-08-20 | API-ADM-003의 권한은 `operator`인데 **역할 판정은 WP-012(REL-002)가 세운다.** WP-009는 REL-001이므로 그 사이에 재처리를 실행할 수 있는 변경 API가 인증 없이 열린다. REL-001의 보안 범위는 "웹훅 HMAC 검증, 시크릿 배치"뿐이라 사용자 신원 자체가 아직 없다 | WP-009, WP-012 / FR-ING-007 AC-3, API-ADM-003, FR-AUTH-001 | 범위 공백 | **CR-012** | **resolved (2026-08-20)** — 임시 통제로 공유 토큰(`ADMIN_API_TOKEN`, `Authorization: Bearer`)을 요구하고 **토큰이 설정되지 않으면 경로를 등록하지 않는다** — 인증 수단 없이 열린 변경 API를 두는 것보다 없는 편이 낫다. OIDC 세션과 역할 판정이 서는 WP-012가 이 통제를 대체한다. 감사 기록은 WP-009 범위 밖이며(WP-010 DoD가 소유) 신원이 없는 상태에서 `audit_record.user_id`를 지어내지 않았다 — 7장에 한계로 남겼다 |
| DEV-026 | 2026-08-20 | `EVT-ING-004 ingestion.failed`가 카탈로그에 있으나 **토픽도 발행자도 소비자도 없다.** 지정된 소비자 `ops`는 스트림 소비자가 아니라 `dead_letter` 테이블을 읽는 조회 모듈이고, AC-5의 경보 경로는 WP-009 범위가 정한 `dead_letter_total{state}` 지표가 맡는다. 지금 토픽을 만들면 소비자 없는 스트림이 하나 생길 뿐이다 | WP-009 / FR-ING-007, EVT-ING-004 | 범위 공백 | 미등록 — 알림 소비자를 소유한 REL-005 운영 고도화에서 결정할 CR 필요 | open — 워커가 `dead_letter` 행을 **동기적으로** 남기므로 이벤트가 없다고 기록이 유실되지는 않는다. 발행이 필요해지는 시점은 테이블 폴링이 아닌 실시간 알림 소비자가 생길 때다 |
| DEV-027 | 2026-08-20 | `DeadLetterRow.dead_letter_id`와 `JobRow.job_id`가 `string`으로 선언돼 있으나 **런타임 값은 숫자다.** 두 컬럼 모두 `BIGSERIAL`(int8)이고 `@prs/db`의 타입 파서가 int8을 숫자로 바꾸기 때문이다. WP-005가 `repository_id`에서 같은 문제를 잡고 파서를 넣었는데 이 두 리포지터리의 선언은 그대로 남았다. `dead_letter_id`는 API-ADM-003의 응답 본문과 재처리 요청 본문에 그대로 나가는 값이라 **타입이 `string`이면 JSON에 `"812"`가 나갈 것처럼 읽히지만 실제로는 `812`가 나가고**, 클라이언트의 `===` 비교와 서버의 파싱이 어긋난다 | WP-009 / ENT-ING-002, API-ADM-003 | 구현 결함 | 불필요 (문서가 옳고 코드가 틀렸다) | **부분 resolved (2026-08-20)** — `dead_letter_id`를 `number`로 정정하고 통합 시험이 `typeof === 'number'`를 고정한다. `JobRow.job_id`는 **WP-010에서 함께 해소했다 (2026-08-21)** — 등록 API가 `backfill_job_id`를 응답 본문에 내보내면서 소비자가 생겼고, 통합 시험이 `Any<String>` 기대에서 실패해 그 자리를 정확히 짚었다. `enqueueJob`의 반환 타입까지 `number`로 맞췄다 |
| DEV-028 | 2026-08-21 | `prs-commits` 매핑에 `repository_archived`가 없다. PR 매핑에만 있고 데이터 모델 4.2도 선언하지 않는다. 그런데 소프트 삭제 원칙(데이터 모델 9장)은 "ES 문서에 `repository_archived: true`를 세팅한다"고 일반적으로 적혀 있다. **매핑이 `dynamic: strict`라 없는 필드를 쓰려는 시도는 거부되므로**, 해제한 저장소의 커밋 문서에 표식을 붙일 방법이 아예 없었다. FR-SRCH-002(SHA → PR)가 커밋 문서를 직접 결과로 내놓기 때문에, 표식 없는 커밋 문서는 해제된 저장소를 살아 있는 것처럼 보여 준다 | WP-010, WP-003 / FR-ING-009 AC-3, FR-SRCH-002 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — 커밋 매핑과 데이터 모델 4.2에 필드를 더하고, 투영이 PR 문서와 같은 값을 쓴다. 해제 시 이미 색인된 문서는 `update_by_query`로 소급 표시하며 `document_version`은 건드리지 않는다 — 등록 상태는 웹훅이 나르는 엔티티 상태가 아니라 이 시스템이 소유한 운영 상태라 버전 비교의 대상이 아니다 |
| DEV-029 | 2026-08-21 | FR-ADMIN-001 AC-1이 요구하는 **단계별 처리 지연 p50/p95를 `search-api`가 읽을 수 없다.** 그 값의 유일한 생산자는 워커 프로세스 메모리의 `stage_latency_seconds` 히스토그램이고, FR의 예외 처리가 전제하는 "지표 저장소"는 인프라 4장이 "사내 Prometheus 호환"이라고 적은 **외부 의존**이라 개발·CI에 주소가 없다. 워커 복제본 하나의 `/metrics`를 긁는 방법은 그 복제본의 히스토그램일 뿐 클러스터 전체가 아니다 | WP-010 / FR-ADMIN-001 AC-1·AC-2, API-ADM-006 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — 항목별로 출처를 나눴다. 수신량·수집 반영 지연 p50/p95·저장소별 상위 10은 PostgreSQL `raw_event`에서 정확히 계산하고(표본이 곧 사실이다), 대기열은 Redis, 실패 대기열은 PostgreSQL, 보강 대기는 ES에서 읽는다. 단계별 지연만 `METRICS_QUERY_URL`이 설정된 경우 질의하고 아니면 `unavailable`로 남긴다. **틀린 답을 자신 있게 내놓지 않는 쪽을 골랐다** |
| DEV-030 | 2026-08-21 | FR-ING-009 AC-5는 "등록·해제는 감사 기록 대상"인데 `audit_record.user_id`는 NOT NULL이고 **넣을 실제 신원이 WP-012(OIDC)까지 없다.** CR-012는 WP-009에서 이 문제를 만나 감사를 WP-010으로 미뤘는데, WP-010의 DoD가 바로 그 감사를 요구한다 — 더 미룰 자리가 없다 | WP-010, WP-012 / FR-ING-009 AC-5, FR-AUTH-004 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — 사용자 결정에 따라 CR-012의 공유 토큰을 **이름 붙은 토큰**으로 넓혔다(`ADMIN_API_TOKENS="alice:tok1,bob:tok2"`). 어느 운영자 자격 증명이 실행했는지가 감사 기록에 실제로 남는다. 단일 `ADMIN_API_TOKEN`은 이름 없는 주체로 계속 동작한다. WP-012의 OIDC 신원이 이 통제를 대체한다 |
| DEV-031 | 2026-08-21 | FR-ING-009 AC-1의 "백필 여부"를 받아도 **실행할 워커가 없다.** JOB-ING-004의 워커는 `batch`이고 그 역할과 `prs:batch` 스트림은 WP-019가 세운다. DEV-024와 같은 형태의 시점 문제다 | WP-010, WP-019 / FR-ING-009 AC-1, JOB-ING-004 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — 등록 시 `backfill: true`면 `job` 행을 `type: 'backfill'`, `state: 'queued'`로 넣는다. 요청을 조용히 버리지 않으며 `job_active_uk`가 중복 큐잉을 막는다. 실행은 WP-019부터다 |
| DEV-032 | 2026-08-21 | `pnpm test:e2e`와 `pnpm test:a11y` 스크립트가 **저장소에 없는데 작업 패키지 21곳이 검증 방법으로 참조한다.** WP-010이 그 첫 자리다(`pnpm test:e2e ops-minimal`). DEV-017이 `--` 필터 표기를 고쳤을 때 존재하지 않는 스크립트까지는 보지 않았다 | WP-010 및 화면을 다루는 WP 전반 / 전 WP 검증 방법 | 문서 오류 | **CR-013** (WP-010분만) | **부분 resolved (2026-08-21)** — WP-010은 화면을 만들지 않기로 결정되어(사용자 판단) 검증 방법을 `pnpm test:integration ops/pipeline-status`로 바꿨다. **나머지 20곳은 open** — E2E·접근성 harness는 그것을 처음 필요로 하는 화면 WP(WP-015 이후)가 세우는 것이 맞고, 여기서 harness만 먼저 만들면 쓰는 곳 없는 골격이 된다 |
| DEV-033 | 2026-08-21 | `RepositorySummary`가 `id`·`full_name`·`private`·`default_branch` 넷만 선언한다. 그런데 `repository` 테이블은 `org_id`를 NOT NULL로, `visibility`를 `public|internal|private` CHECK로 요구한다 — 그리고 **ADR-008의 필수 접근 범위 필터가 바로 그 두 필드 위에 서 있다.** 더 나쁜 것은 `private: boolean`으로는 `internal`을 구분할 수 없다는 점이다. 이 제품은 사내 GitHub Enterprise를 대상으로 하므로 저장소 대부분이 `internal`이고, 그것을 `private`로 적으면 접근 범위 판정이 조직 전체에서 어긋난다 | WP-010, WP-006 / FR-ING-009 AC-1, FR-AUTH-002, ADR-008 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — `RepositorySummary`에 `owner.id`와 `visibility`를 더하고 목 GHES 서버도 함께 넓혀 시험이 실제 응답 모양을 고정하게 했다. 등록은 클라이언트가 보낸 값을 믿지 않고 GHE에 물어서 채운다 |
| DEV-034 | 2026-08-21 | `applyMappings`가 **이미 있는 인덱스를 전혀 건드리지 않는다.** WP-003이 "매핑 변경은 새 버전 인덱스 + 재색인 + 별칭 전환"이라는 규칙을 그렇게 구현했는데, 그 규칙이 **필드 추가까지 묶어 버린다**. Elasticsearch에서 매핑에 새 필드를 더하는 것은 하위 호환 변경이라 재색인이 필요 없고, 재색인이 필요한 것은 기존 필드의 타입·분석기를 바꿀 때다. DEV-028을 고치려고 `repository_archived`를 커밋 매핑에 더했더니 **이미 떠 있는 `prs-commits-v1`이 그것을 모르는 채로 남아** `dynamic: strict`가 색인을 거부했다. 이대로면 `dynamic: strict` 인덱스에 필드 하나를 더할 때마다 전량 재색인을 해야 하고, 그 재색인 기계(WP-035, FR-ING-008)는 아직 없다 | WP-010, WP-003 / FR-ING-005, FR-ING-008 | 구현 결함 | **CR-013** | **resolved (2026-08-21)** — 인덱스가 이미 있으면 `put_mapping`으로 제자리 갱신한다. 하위 호환이 아닌 변경은 `put_mapping`이 `illegal_argument_exception`으로 **거부하므로 조용히 넘어가지 않는다** — 거부되는 그때가 새 버전 인덱스와 재색인이 필요한 자리다. 실제 Elasticsearch 8.19.0에서 확인했다: 필드 추가는 통과하고 WP-003의 기존 DoD 시험 24건도 그대로 통과한다 |
| DEV-035 | 2026-08-21 | API-SRCH-004의 `parsed.filters`가 `eq`·`not_eq`·`range` 셋만 보여 준다. **부정된 범위를 담을 이름이 없다.** FR-SRCH-005 AC-6의 `-` 접두는 문법 수준에서 `key:value` 앞에 붙는 것이라 `-merged:2026-01-01..2026-02-01`도 자연히 파싱된다. 범위에만 `-`를 금지하면 토크나이저에 특례가 생기고, 사용자는 왜 이 조합만 안 되는지 알 수 없다 | WP-011 / FR-SRCH-005 AC-6, API-SRCH-004 | 범위 공백 | **CR-014** | **resolved (2026-08-21)** — `op`에 `not_range`를 더했다. 부정은 문법의 성질이지 특정 연산자의 성질이 아니다 |
| DEV-036 | 2026-08-21 | FR-SRCH-005 AC-1이 `is`의 값을 `merged`/`open`/`closed`/`reverted`로 **열거했는데, 그 밖의 값이 왔을 때 어떻게 되는지가 없다.** AC-4는 지원하지 않는 *키*만 다룬다. `is:draft`를 조용히 통과시키면 아무 문서와도 맞지 않는 필터가 되어 사용자는 "결과 없음"의 이유를 알 수 없고, 이는 "파싱 실패 시 검색을 실행하지 않고 오류 위치를 반환한다"는 예외 처리의 취지와 어긋난다 | WP-011 / FR-SRCH-005 AC-1·AC-4 | 범위 공백 | **CR-014** | **resolved (2026-08-21)** — **SRS가 값을 열거한 키에만** 값 검증을 한다. 지금은 `is` 하나뿐이며 오프셋과 허용 값 목록을 담아 거절한다. `state`는 SRS가 값을 열거하지 않았으므로 검증하지 않는다 — 없는 제약을 지어내는 것이 조용히 통과시키는 것보다 낫지 않다 |
| DEV-037 | 2026-08-21 | **어느 키가 범위 문법 `a..b`를 받는지가 어디에도 없다.** AC-2가 `seq`를, AC-3이 `merged`를 예로 들 뿐이고 WP-011은 "숫자, 날짜, 날짜시각"이라고만 적었다. 전부 허용하면 `label:a..b` 같은 무의미한 조건이 생기고, 반대로 `path:src/a..b`처럼 값에 점 두 개가 정당하게 들어가는 경우를 범위로 오해한다 | WP-011 / FR-SRCH-005 AC-2·AC-3 | 범위 공백 | **CR-014** | **resolved (2026-08-21)** — `seq`(숫자)·`merged`·`created`(시각) 셋으로 못 박았다. 그 밖의 키에서 `..`는 리터럴이다. 양끝이 모두 있어야 하며 한쪽이 비면 문법 오류다 — 열린 범위는 요구되지 않았고 지어내지 않는다 |
| DEV-038 | 2026-08-21 | `QUERY_TOO_SHORT`(검색어 1자)가 오류 표에는 있으나 **파서와 API 중 누가 판정하는지가 없다.** 질의에서 무엇이 전문 검색어이고 무엇이 필터인지 아는 곳은 파서뿐인데, WP-011의 DoD에는 이 코드가 없고 WP-013(검색 API)의 범위에도 명시되지 않았다 | WP-011, WP-013 / FR-SRCH-005, API-SRCH-004 | 범위 공백 | **CR-014** | **resolved (2026-08-21)** — 파서가 판정해 오류 코드와 문자 오프셋을 함께 돌려주고 API는 그대로 싣는다. 파서가 HTTP를 모르도록 `@prs/contracts`의 `ErrorCode`만 쓰고 상태 코드는 만들지 않는다 |
| DEV-039 | 2026-08-21 | `@prs/query`의 `IMPLEMENTED_BY`가 `'WP-025'`로 적혀 있다. **WP-025는 W-004 범위 조사 화면**이고 이 패키지를 채우는 것은 WP-011이다. WP-001이 골격을 세울 때 잘못 적었다 | WP-011, WP-001 | 문서 오류 | **CR-014** | **resolved (2026-08-21)** — 표식을 지웠다. 패키지가 실제로 구현되었으므로 "누가 채울 예정인가"를 적어 둘 이유가 사라졌다 |
| DEV-040 | 2026-08-21 | API-AUTH-001 `/me`가 카탈로그 한 줄로만 있고 **4장에 상세 규격이 없다.** WP-012의 DoD가 이 엔드포인트를 요구하는데 응답 모양이 정해져 있지 않다. 저장소 ID 목록을 그대로 실으면 500개 초과 사용자에서 응답이 수십 KB가 되고, 조직의 저장소 인벤토리를 그대로 내주는 것이기도 하다 | WP-012 / FR-AUTH-001, FR-AUTH-002, API-AUTH-001 | 범위 공백 | **CR-015** | **resolved (2026-08-21)** — API 계약 4장에 상세 규격을 더했다. 접근 범위는 **요약**이다: `scope_kind`, `repository_count`, `org_count`, `team_count`, `refreshed_at`. 목록은 내지 않는다 |
| DEV-041 | 2026-08-21 | `EVT-AUTH-001` payload가 **두 문서에서 다르다.** 비동기 문서 4장은 `{ user_ids[], team_id, repository_id, reason }`, API 계약 7장은 `team_id`가 없다. 팀 전원 무효화가 `team_id` 없이는 표현되지 않는다 | WP-012 / EVT-AUTH-001 | 문서 간 모순 | **CR-015** | **resolved (2026-08-21)** — 비동기 문서 쪽으로 맞췄다. 게이트웨이가 수신 경로 안에서 팀을 구성원으로 펼치려면 GHE 동기 호출이 필요하고 그것은 NFR-002의 수신 p95 300ms를 무너뜨린다. `team_id`를 싣고 소비자가 펼친다 |
| DEV-042 | 2026-08-21 | `EVT-AUTH-001`의 producer가 `ingest-gateway`인데 **게이트웨이는 `prs:ingest`에만 발행한다.** `member`/`team`/`repository` 이벤트는 보강 워커까지 흘러가 `skip`으로 끝나므로(DEV-016) FR-AUTH-003 AC-2의 "즉시 무효화"에 경로가 아예 없다 | WP-012 / FR-AUTH-003, EVT-AUTH-001 | 구현 공백 | **CR-015** | **resolved (2026-08-21)** — 게이트웨이가 이 세 유형에 대해 `prs:permission`에도 발행한다. `raw_event` 보관과 `prs:ingest` 발행은 그대로다 — 원본 재구성 가능성(ADR-004)을 줄이지 않는다 |
| DEV-043 | 2026-08-21 | `app_user.user_id`가 **무엇인지 정의되어 있지 않다.** 세션은 OIDC `sub`로 만들어지는데 무효화 이벤트는 GHE 신원(login·숫자 id)으로 도착하고, 둘을 잇는 것이 없다. 잇지 못하면 `member` 웹훅이 아무 캐시도 무효화하지 못한다 | WP-012 / ENT-CORE-005, FR-AUTH-003 | 범위 공백 | **CR-015** | **resolved (2026-08-21)** — `user_id`는 OIDC `sub`, `login`은 GHE login으로 못 박고 `app_user.github_user_id BIGINT UNIQUE`를 더했다(마이그레이션 007). login은 개명될 수 있으나 숫자 id는 아니므로 무효화는 숫자 id를 우선 쓴다 |
| DEV-044 | 2026-08-21 | `access_scope_version`이 ENT-CORE-005와 `app_user`에 있으나 **의미가 어디에도 없다.** 울타리가 없으면 회수 직전에 시작된 GHE 조회가 회수 뒤에 끝나면서 회수 이전 범위를 캐시에 다시 써 넣는다. 그 사용자는 계속 조회할 수 있고 이는 FR-AUTH-003 AC-4를 정면으로 어긴다 | WP-012 / ENT-CORE-005, FR-AUTH-003 AC-4 | 범위 공백 | **CR-015** | **resolved (2026-08-21)** — 무효화마다 증가시키고, 갱신은 시작 시점에 읽은 값이 그대로일 때만 기록한다. 값이 달라졌으면 결과를 버린다 — 다음 요청이 다시 조회한다 |
| DEV-045 | 2026-08-21 | `repository` 웹훅의 대상이 "영향 사용자"로만 적혀 있고 **그들을 찾을 방법이 없다.** `permission_cache.repository_ids`에 색인이 없어 전량 스캔이고, `org_team` 모드 사용자는 저장소를 아예 나열하지 않아 배열 검색으로는 찾히지 않는다 | WP-012 / FR-AUTH-003 AC-2 | 범위 공백 | **CR-015** | **resolved (2026-08-21)** — `repository_ids`·`org_ids`에 GIN 색인을 더하고(마이그레이션 007) 영향 집합을 (그 저장소를 명시적으로 담은 캐시) ∪ (그 저장소의 조직을 담은 `org_team` 캐시)로 정의했다 |
| DEV-046 | 2026-08-21 | `team_member`를 **아무것도 채우지 않는다.** ENT-CORE-004는 `member_ids[]`를 선언하고 DEV-041의 `team_id` 펼치기가 이 표에 의존하는데, 표를 쓰는 코드도 채우는 코드도 없다 | WP-012 / ENT-CORE-004, FR-AUTH-003 AC-2 | 구현 공백 | **CR-015** | **resolved (2026-08-21)** — `team` 이벤트를 받은 authz 소비자가 GHE에서 구성원을 다시 읽어 `team_member`를 갱신하고, 같은 응답으로 무효화 대상을 만든다. 표가 비어 있어도 무효화가 성립하도록 GHE 조회 결과를 우선 쓴다 |
| DEV-047 | 2026-08-21 | `web` → `search-api`의 **신원 전달 방법이 없다.** ADR-011은 `web`이 세션을 검증하고 클라이언트 헤더를 전달하지 않는다고만 하고, 인프라 문서는 IdP 아웃바운드를 `web`에만 허용한다. 그런데 강제 필터를 거는 곳은 `search-api`다. `X-User-Id` 같은 헤더를 믿으면 클러스터 안 무엇이든 신원을 위조할 수 있다 | WP-012, WP-015 / ADR-011, FR-AUTH-002 AC-2 | 범위 공백 | **CR-015** | **resolved (2026-08-21)** — 세션 쿠키만 허용 목록으로 전달하고 `search-api`가 같은 Redis 세션 저장소에서 직접 해석한다. 세션이 서버 측에 있으므로 위조한 쿠키 값은 아무것도 열지 못한다. `search-api`는 신원 주장을 담은 어떤 헤더도 읽지 않는다 |
| DEV-048 | 2026-08-21 | CR-012·CR-013이 세운 임시 공유 토큰 통제(`ADMIN_API_TOKENS`)의 **인계 방법이 정해져 있지 않다.** "WP-012가 대체한다"고만 적혀 있어, 세션이 서고 난 뒤에도 토큰 경로가 그대로 남으면 역할 검사를 우회하는 문이 열린 채로 배포된다 | WP-012 / API-ADM-001, API-ADM-003, API-ADM-006, DEV-025, DEV-030 | 범위 공백 | **CR-015** | **resolved (2026-08-21)** — OIDC 세션이 구성되면 `/admin/*`의 통제는 세션 + `operator`이고, 이름 붙은 토큰 경로는 OIDC가 **구성되지 않은** 경우에만 등록된다. 둘은 배타다 — 구성이 겹치면 기동에서 거부한다 |
| DEV-049 | 2026-08-21 | 역할이 `developer` 기본값·IdP 그룹 매핑·관리자 지정 셋으로 부여되는데 **로그인 시 어떻게 합쳐지는지가 없다.** IdP 클레임으로 덮어쓰면 관리자가 지정한 `operator`가 다음 로그인에 조용히 사라지고, 반대로 IdP 그룹을 `operator`까지 믿으면 그룹 관리자가 운영 권한을 발급할 수 있게 된다 | WP-012 / NFR-005, 보안 문서 5.1 | 범위 공백 | **CR-015** | **resolved (2026-08-21)** — IdP 그룹은 `manager`·`qa`에만 매핑한다(보안 문서 5.1의 부여 방식 그대로). `operator`·`release_manager`·`security_officer`는 DB 지정값만 쓰고, 최종 역할은 두 집합의 합집합에 `developer`를 더한 것이다 |
| DEV-050 | 2026-08-21 | `installTypeParsers`가 **스칼라 `int8`만 등록하고 `BIGINT[]`(`_int8`, OID 1016)은 두었다.** WP-012의 `permission_cache.repository_ids`가 이 저장소의 첫 `BIGINT[]` 열이라 여기서 드러났다 — 접근 범위가 `["101"]`로 나오면 필수 접근 범위 필터의 `terms` 절이 문자열을 싣고 `/me` 요약도 문자열을 내보낸다. DEV-027이 스칼라만 고쳤던 것의 남은 절반이다 | WP-012, WP-005 / FR-AUTH-002, ADR-008 | 구현 결함 | **CR-015** | **resolved (2026-08-21)** — `_int8` 파서를 더했다. 배열 리터럴 해석은 pg 기본 파서에 맡기고 원소만 안전 정수로 바꾼다. 통합 테스트가 숫자 원소·빈 배열·NULL 원소를 건다 |
| DEV-051 | 2026-08-21 | WP-012의 아키텍처 테스트가 **접근 범위를 거치지 않는 운영 집계 두 곳**을 드러냈다. API-ADM-006이 `enrichment_pending`을 `es.count`로 전 저장소에서 세고(FR-ADMIN-001 AC-1), `slowest_repositories`가 저장소 **이름**을 담는다(AC-3). 그런데 THR-003은 "집계 건수·패싯으로 접근 범위 밖 저장소의 활동량 추론"을 막으라 하고, THR-016은 "`operator`도 권한 없는 저장소 데이터는 볼 수 없다"고 한다. **두 승인된 문서가 같은 API에 대해 반대 방향을 가리킨다** | WP-012, WP-010 / FR-ADMIN-001 AC-1·AC-3, FR-AUTH-002 AC-5, THR-003, THR-016 | 문서 간 모순 | **CR-015** | **open** — 동작을 바꾸지 않았다. FR-ADMIN-001이 더 구체적인 요구이고 API-ADM-006은 이미 `operator` 역할 뒤에 있으므로 현재 동작을 유지하되, 아키텍처 테스트의 **사유 붙은 허용 목록**에 등록해 다음 전역 집계가 조용히 들어오지 못하게 했다. 해소하려면 CR이 필요하다 — 선택지는 (가) 운영 집계를 접근 범위 예외로 SRS에 명시, (나) `slowest_repositories`를 저장소 ID 없는 형태로 축소, (다) 운영 콘솔 조회에도 강제 필터 결합. **사용자 결정 사항이다** |
| DEV-052 | 2026-08-21 | **질의 키 15종이 어느 ES 필드로 가는지가 어디에도 없다.** 대부분은 이름이 같지만 둘은 문서만으로 풀리지 않는다 — `org:acme`는 문서에 `org_id`(숫자)만 있고 조직 이름이 없으며, `team:payments-core`도 `allowed_team_ids`(숫자)만 있고 slug이 없다. FR-SRCH-006 AC-1이 조직·팀 필터를 명시적으로 요구한다 | WP-013 / FR-SRCH-005 AC-1, FR-SRCH-006 AC-1, API-SRCH-004 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — 키→필드 표를 API 계약에 넣었다. `org`·`team`은 레지스트리에서 이름→ID로 해석한다(재색인 없이 풀리고 등록 정보의 주인이 레지스트리다). **`team`은 이 WP에서 결과를 내지 못한다** — 문서의 팀 ID 배열이 비어 있다(WP-012 제한). 조용히 0건을 내지 않고 응답에 남긴다 |
| DEV-053 | 2026-08-21 | **`is`의 뜻이 정의되어 있지 않다.** 값 넷 중 `merged`·`open`·`closed`는 `state`와 겹치고 `reverted`만 `link_summary.is_reverted`다. 둘이 같은 뜻이면 키가 둘일 이유가 없고, 다르면 무엇이 다른지가 있어야 한다 | WP-013 / FR-SRCH-005 AC-1, FR-SRCH-006 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — `is`는 **파생 상태**다. `state`가 GitHub이 준 값을 그대로 보는 반면 `is`는 이 시스템이 계산한 것까지 본다 — `is:merged`는 `state:merged`와 같지만 `is:reverted`는 `link_summary.is_reverted`를 본다. 겹치는 셋을 지우지 않은 것은 사용자가 `is:` 하나로 상태를 물을 수 있어야 하기 때문이다 |
| DEV-054 | 2026-08-21 | **`/search`가 어느 인덱스를 도는지가 정해져 있지 않다.** API-SRCH-004의 목적은 "PR·커밋 목록"이고 W-001-RESULTS도 유형 열에 PR/커밋을 적었는데, 응답 예시에는 `kind: pull_request`만 있고 `search` 파사드는 별칭 하나만 받는다. 커밋 문서에는 `labels`·`reviewers`·`state`·`merged_at`·`title`이 아예 없다 | WP-013, WP-032 / API-SRCH-004, W-001, FR-SRCH-006 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — PR·커밋 두 별칭을 함께 돈다. **실측으로 확인**: 한쪽에만 있는 필드로 **필터**하면 조용히 무매치지만(정상 — 커밋에 라벨이 없는 것은 사실이다), 같은 필드로 **정렬**하면 HTTP 200에 `_shards.failed: 12/18`이 붙은 **부분 실패**가 되어 한 인덱스가 통째로 빠진 결과가 정상처럼 돌아온다. 모든 정렬 키에 `unmapped_type`을 붙이고 `_shards.failed`를 검사해 0이 아니면 부분 결과를 내지 않는다 |
| DEV-055 | 2026-08-21 | **`relaxation_hints` 산출 방법이 없다.** FR-SRCH-006 AC-3이 "어떤 필터를 제거하면 결과가 생기는지"를 요구하지만 몇 번 질의하는지, 후보를 몇 개까지 내는지, 어떤 순서인지가 없다. 필터 N개마다 질의를 한 번씩 더 던지면 NFR-001의 p95 500ms 예산을 N배로 쓴다 | WP-013 / FR-SRCH-006 AC-3, NFR-001 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — `msearch` 한 번으로 묶어 왕복을 1회로 고정하고, 후보를 **상한 8개**로 자른다. 상한을 넘으면 잘랐다는 사실을 응답에 남긴다 — 조용한 절삭은 "이것이 전부"로 읽힌다. 0건일 때만 계산하므로 정상 경로의 지연에 영향이 없다 |
| DEV-056 | 2026-08-21 | **`relevance` 정렬이 전문 검색 없이는 뜻이 없다.** FR-SRCH-007 AC-1이 정렬 키로 요구하지만 WP-013은 전문 검색을 제외하고(WP-032), 접근 범위 필터는 `filter` 절이라 점수를 만들지 않는다. 모든 문서의 점수가 같아진다 | WP-013, WP-032 / FR-SRCH-007 AC-1 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — 키를 받되(AC-3의 400을 내지 않는다) 이 WP에서는 문서 ID 순으로 떨어진다고 계약에 적었다. AC-4의 결정론은 그대로 성립한다. 전문 검색이 서는 WP-032에서 실제 점수가 붙는다 — **동작하는 척하지 않고 지금 무엇인지 적는다** |
| DEV-057 | 2026-08-21 | **`facets`·`next_cursor`가 WP-013 범위 밖인데 API 계약의 응답 예시에는 늘 있다.** 화면이 "키가 없다"와 "`null`이다"를 구분하지 못하면 페이저가 마지막 페이지를 오해하고 패싯 레일이 빈 목록을 그린다 | WP-013, WP-032 / API-SRCH-004, W-001-PAGER, W-001-FACETS | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — `next_cursor`는 **항상 `null`로 실어 보낸다**(키가 있고 값이 없다 = 다음 페이지가 없다). `facets`는 **키 자체를 넣지 않는다** — 빈 객체는 "패싯을 셌는데 아무것도 없다"로 읽힌다. WP-032가 둘을 채운다 |
| DEV-058 | 2026-08-21 | **`pnpm test:perf` 스크립트가 저장소에 없다** (DEV-032와 같은 형태). WP-013의 DoD가 NFR-001의 p95 500ms를 1000만 문서 합성 데이터셋으로 요구하는데, 스크립트도 데이터셋도 이 실행 환경에 없다 | WP-013 / NFR-001, DEV-032 | 실행 환경 제약 | **CR-016** | **open** — 질의 **모양**이 필터 수에 비례해 커지지 않음을 시험으로 고정했다(상수 왕복 수). 그러나 **실측 p95는 NOT RUN이다.** 1000만 문서 데이터셋과 부하 시험 harness는 **REL-002 성능 게이트**에서 세운다. 측정하지 않은 것을 통과로 적지 않는다 |
| DEV-059 | 2026-08-21 | FR-SRCH-007 AC-4가 "동점 처리를 위해 **문서 ID를 마지막 정렬 키로** 사용해 결정론적 순서를 보장한다"고 요구하는데, **Elasticsearch 8은 `_id`로 정렬하는 것을 금지한다** — `Fielddata access on the _id field is disallowed`. 켜려면 `indices.id_field_data.enabled` 클러스터 전역 설정이 필요하고 그것은 모든 문서 ID를 힙에 올린다. AC를 문자 그대로 구현할 수 없다 | WP-013 / FR-SRCH-007 AC-4 | 도구 제약 | **CR-016** | **resolved (2026-08-21)** — `_id`와 **같은 값**을 `doc_id` keyword 필드로 문서에 함께 넣고 그 필드로 정렬한다. `upsert`가 `request.id`에서 자동으로 채우므로 투영 자리가 잊을 수 없다. AC-4의 뜻("문서 ID로 동점을 가른다")은 그대로 성립한다. `_doc`은 쓰지 않았다 — 세그먼트 내부 순서라 머지·재색인에 값이 달라져 결정론이 깨진다. **이미 색인된 문서는 다음 이벤트에서 채워진다**(스크립트 `params.doc`에도 넣었다). 그때까지는 `missing: _last`로 뒤에 선다 |
| DEV-060 | 2026-08-21 | **API-SRCH-002의 커밋 상세가 커밋 문서에 채워지지 않는 필드 11종을 약속한다** — `message`, `author`, `committer`, `authored_at`, `committed_at`, `parent_shas`, `patch_id`, `changed_paths`, `changed_files_count`, `additions`, `deletions`. 매핑에는 자리가 있으나 투영이 채우지 않는다: `EVT-ING-002`가 커밋에 대해 SHA만 나른다(WP-008이 남긴 기존 한계). WP-014는 조회 계층이라 투영을 고칠 수 없다 | WP-014, WP-020 / FR-SRCH-002, API-SRCH-002, ENT-CORE-003 | 문서와 구현 불일치 | **CR-017** | **resolved (2026-08-21)** — 응답에서 **없는 키는 넣지 않는다**(CR-016 DEV-057이 `facets`에 세운 규칙과 같다: 키 없음 = 만들지 않았다, `null` = 만들었는데 비었다). 0이나 빈 문자열로 채우면 "파일을 하나도 안 바꾼 커밋"과 구분되지 않는다. 계약 예시를 실제 채워지는 필드만 남기도록 고치고 나머지는 WP-020(미러 기반 커밋 보강)으로 표시했다 |
| DEV-061 | 2026-08-21 | **`role: 'direct_push'`에 도달할 수 없다.** FR-SRCH-002 AC-3과 QA-W003-03이 요구하지만 커밋 문서는 **PR 이벤트에서만** 만들어지고 투영의 `CommitRole` 타입에 값이 둘(`merge_commit`·`source_commit`)뿐이다. `push` 이벤트는 ack 후 버려진다(DEV-016). 직접 푸시 커밋은 **문서 자체가 없어** 조회가 404가 된다 | WP-014, WP-021 / FR-SRCH-002 AC-3, QA-W003-03 | 구현 공백 | **CR-017** | **open** — API 계약과 타입은 `direct_push`를 표현할 수 있게 그대로 둔다(값이 생겼을 때 계약을 다시 고치지 않기 위해). 그러나 **그 값이 실제로 나오려면 push 이벤트 라우팅(WP-021)이 필요하다.** 동작을 지어내지 않았고 **QA-W003-03을 NOT SATISFIED로 기록한다** |
| DEV-062 | 2026-08-21 | **`source_commits`가 객체 배열(SHA·메시지 첫 줄·작성자·작성 시각)인데 PR 문서는 `source_commit_shas`(문자열 배열)만 갖는다.** 커밋 문서를 조인해도 메시지·작성자가 없다(DEV-060). FR-SRCH-003 AC-3이 각 항목에 넷을 요구한다 | WP-014, WP-020 / FR-SRCH-003 AC-3, API-SRCH-003 | 문서와 구현 불일치 | **CR-017** | **resolved (2026-08-21)** — 배열 **모양은 계약대로 객체**로 내되 `commit_sha`만 채우고 나머지 키는 넣지 않는다(DEV-060과 같은 규칙). 화면이 SHA만으로도 목록을 그릴 수 있고, WP-020이 커밋을 보강하면 키가 저절로 붙는다 — 계약을 다시 고치지 않는다 |
| DEV-063 | 2026-08-21 | **`source_commits_total`이 저장되지 않는다.** PR 매핑에 `source_commits_truncated`(boolean)만 있고 보강 payload도 총계를 나르지 않는다. FR-SRCH-003 AC-4는 250건 절삭 시 "앞의 250건과 **전체 건수**"를 요구한다 | WP-014 / FR-SRCH-003 AC-4, EVT-ING-002, ENT-CORE-002 | 범위 공백 | **CR-017** | **부분 해소 (2026-08-21)** — 절삭되지 않았을 때는 배열 길이가 곧 총계이므로 그대로 싣는다. **절삭됐을 때는 총계를 모른다** — 250을 총계로 내보내면 거짓이므로 **키를 빼고** `source_commits_truncated: true`만 남긴다. 진짜 총계를 실으려면 보강이 그 수를 함께 보내야 하므로 `EVT-ING-002` 확장은 별도 CR로 남긴다 |
| DEV-064 | 2026-08-21 | **`search-api`에 GHE 호스트 설정이 없다.** 해석 순서 1단계가 "GHE URL 패턴(호스트+경로)"인데 무엇이 우리 호스트인지 알 방법이 없고, **호스트가 다른 URL을 어떻게 처리할지도 정해져 있지 않다.** 호스트를 보지 않고 경로만 파싱하면 `https://other.example/acme/payments/pull/1`이 우리 PR로 해석된다 | WP-014 / FR-SRCH-001 AC-3, API-SRCH-001 | 범위 공백 | **CR-017** | **resolved (2026-08-21)** — `GHE_BASE_URL`을 `search-api` 설정에 더했다(`@prs/github`가 이미 같은 이름을 쓴다). 호스트가 맞지 않는 URL은 `text`로 떨어진다 — 접근 범위가 데이터를 막아 주더라도 **엉뚱한 저장소로 해석하는 것 자체가 오답**이다 |
| DEV-065 | 2026-08-21 | **릴리스 태그의 패턴이 어디에도 정의되어 있지 않다.** 백엔드 아키텍처 4.5의 해석 7단계가 "태그 패턴 → release"를 말하고 FR-SRCH-001의 요구사항 문장도 "릴리스 태그"를 유형으로 열거하지만, **무엇이 태그 패턴인지는 SRS에도 아키텍처에도 없다.** 게다가 `prs-releases`는 아직 아무것도 채우지 않는다(WP-024) | WP-014, WP-024 / FR-SRCH-001, API-SRCH-001 | 범위 공백 | **CR-017** | **resolved (2026-08-21)** — **정규식을 지어내지 않는다.** 릴리스를 색인하는 WP-024가 패턴을 정의할 때까지 태그처럼 보이는 문자열은 FR-SRCH-001 AC-4대로 `text`다. 없는 패턴을 추측해 넣으면 `v1`·`build-2`가 릴리스로 오분류되어 전문 검색으로 가야 할 질의가 0건이 된다 |
| DEV-066 | 2026-08-21 | **순수 정수와 SHA 접두가 겹치는데 해석 순서가 이를 가르지 않는다.** 해석 3단계는 "`#N` 또는 순수 정수 → pull_request", 5단계는 "7~39자 hex → commit(prefix)"인데 `1234567`은 **둘 다**다. 3단계가 먼저이므로 문자 그대로 따르면 40자리 숫자도 PR 번호가 되어 커밋 조회가 영영 일어나지 않는다 | WP-014 / FR-SRCH-001 AC-5, FR-SRCH-004 | 범위 공백 | **CR-017** | **resolved (2026-08-21)** — 해석을 **하나가 아니라 우선순위 있는 목록**으로 본다. 겹치는 입력은 PR 경로와 커밋 접두 경로를 **둘 다** 조회하고 후보를 합쳐 낸다. FR-SRCH-001 **AC-5가 이미 이 상황을 정의한다** — "후보가 2건 이상이면 후보 배열을 반환하고 자동 이동하지 않는다". `detected_kind`는 후보를 만들어 낸 첫 해석의 유형이며, 아무것도 못 찾으면 우선순위 1위의 유형이다. 순서를 문자 그대로 읽어 커밋 조회를 막지 않는다 |
| DEV-067 | 2026-08-21 | **프런트엔드 문서 §10이 CR-015의 결정과 정면으로 어긋난다.** 프록시 3단계가 "search-api로 전달(**사용자 식별 헤더 부착**)"인데, DEV-047이 정하고 WP-012가 구현·시험한 것은 그 반대다 — `search-api`는 신원을 주장하는 **어떤 헤더도 읽지 않고**(`X-User-Id`·`X-Forwarded-User`·`Authorization`·`X-Roles` 전부 401) 세션 쿠키를 Redis에서 직접 해석한다. 문서대로 만들면 프록시가 붙인 헤더는 무시되고 모든 요청이 401이 된다 | WP-015, WP-012 / ADR-011, FR-AUTH-002 AC-2, DEV-047 | 문서 간 모순 | **CR-018** | **resolved (2026-08-21)** — **문서 쪽이 틀렸다.** 구현이 옳고 프런트엔드 문서가 낡았으므로 코드를 문서에 맞추지 않고 문서를 고쳤다. 프록시는 **세션 쿠키만 허용 목록으로 전달**한다. `search-api`가 헤더를 믿기 시작하면 클러스터 안 무엇이든 신원을 위조할 수 있다 |
| DEV-068 | 2026-08-21 | **`Role` 타입이 클라이언트에 닿지 않는다.** C-002가 `roles: Role[]`을 요구하는데 `@prs/authz`의 진입점이 `@prs/es`(`applyMandatoryScopeFilter`)를 재수출한다. 클라이언트 컴포넌트에서 import하면 Node 전용 `@elastic/elasticsearch`가 브라우저 번들로 끌려와 빌드가 깨진다 | WP-015 / C-002, NFR-005 | 범위 공백 | **CR-018** | **resolved (2026-08-21)** — **구현 중에 이 문제가 클라이언트만의 것이 아님이 드러났다** (DEV-072 참조): 서버 컴포넌트도 `@prs/authz` 진입점을 번들하지 못한다. 클라이언트 쪽은 다음과 같이 막는다 — `roles.ts`는 import가 **0개**라 그 자체로 클라이언트 안전하다. **서브패스 export `@prs/authz/roles`**를 열어 그것만 가져간다. web에 역할 목록을 복제하지 않는다 — 역할이 늘면 두 곳이 갈라지고, 갈라진 쪽이 운영 내비게이션을 잘못 거른다 |
| DEV-069 | 2026-08-21 | **`test:a11y`·`test:e2e` 스크립트가 저장소에 없다** (DEV-032와 같은 것). WP-015의 검증 방법이 `pnpm test:a11y shell`과 `pnpm test:e2e auth`를 부르는데 둘 다 없다. WP 20곳이 이 이름을 참조한다 | WP-015 / DEV-032, NFR-007 | 실행 환경 제약 | **CR-018** | **resolved (2026-08-21)** — **화면을 처음 세우는 WP이므로 여기서 harness를 세운다.** a11y는 vitest + `axe-core`(jsdom), e2e는 Playwright(이 환경에 Chromium이 사전 설치되어 있다). DEV-032가 여기서 닫힌다 |
| DEV-070 | 2026-08-21 | **`⌘K`가 포커스할 대상이 이 WP 범위에 없다.** C-001이 `omniSearch: ReactNode`를 필수 prop으로 요구하고 WP-015 DoD가 "`⌘K`/`Ctrl+K`로 옴니 검색에 포커스"를 요구하는데, C-010 `OmniSearchInput`은 W-001의 컴포넌트라 WP-016 소관이다 | WP-015, WP-016 / C-001, C-010 | 범위 공백 | **CR-018** | **resolved (2026-08-21)** — **셸이 단축키와 슬롯 계약을 소유한다.** `AppTopBar`는 `omniSearch` 슬롯을 받고, 단축키는 슬롯 안의 첫 포커스 가능 요소를 잡는다. WP-016이 C-010을 슬롯에 넣으면 단축키가 저절로 그것을 가리킨다 — 셸을 다시 고치지 않는다 |
| DEV-071 | 2026-08-21 | **OIDC 콜백이 세션을 발급할 경로가 네트워크 정책에 없다.** 인프라 문서의 아웃바운드 허용 목록은 `web` → OIDC IdP만 열고 **`web` → Redis는 어디에도 없다.** 정책이 허용 목록 방식이라("목록에 없는 목적지로의 연결을 차단한다") 세션을 쓸 수 없다. 게다가 `AuthorizationRequest`의 `state`·`nonce`·`codeVerifier`·`returnTo` 넷을 인가 리다이렉트와 콜백 **사이에 어디에 보관하는지**가 정해져 있지 않다 | WP-015 / FR-AUTH-001, FLOW-000, 인프라 6장 | 범위 공백 | **CR-018** | **resolved (2026-08-21)** — 허용 목록에 `web` → Redis를 더했다. 왕복 상태 넷은 **짧은 수명(10분)의 HttpOnly·SameSite=Lax 쿠키**로 나른다 — 서버 저장소에 두면 콜백 전에 이탈한 사용자의 흔적이 쌓이고, URL에 두면 `codeVerifier`가 노출되어 PKCE가 막으려던 것을 그대로 연다 |
| DEV-072 | 2026-08-21 | **`@prs/db`의 진입점이 마이그레이션 실행기를 재수출해 `web` 빌드가 깨졌다.** `MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))`은 **디렉터리**를 가리키므로 어떤 번들러도 해석하지 못한다. 그런데 진입점에 있으면 `@prs/authz` → `@prs/db`를 거쳐 **서버 컴포넌트의 번들 그래프에까지** 끌려 들어간다. DEV-068은 이 문제를 클라이언트 경계로만 보았으나 실제로는 **서버 컴포넌트도 막혔다** — `next.config.ts`의 `serverExternalPackages`로도 워크스페이스 심링크에는 듣지 않았다 | WP-015, WP-002 / ADR-011 | 구현 공백 | **CR-018** | **resolved (2026-08-21)** — 마이그레이션 실행기를 **`@prs/db/migrate` 서브패스로 옮겼다.** 마이그레이션은 **운영 도구이지 조회 경로가 아니므로** 경계가 거기 있는 것이 옳다. 진입점에서 재수출을 빼자 두 번들러(webpack·Turbopack) 모두 통과했다. 쓰는 곳은 통합 헬퍼 셋과 `@prs/db` CLI뿐이라 변경이 좁다 |
| DEV-073 | 2026-08-21 | **좁은 화면(≤800px)에서 내비게이션에 닿을 방법이 없었다.** Conductor CSS는 그 폭에서 사이드바(`.cdt-app-shell__nav:not([data-mobile])`)를 `display: none`으로 감추고 내비게이션을 서랍(Radix Dialog)으로만 연다. 그런데 `AppShell`은 `navOpen`/`onNavOpenChange`만 넘겨 주고 **여는 버튼은 앱이 낸다** — 초기 구현이 그것을 빠뜨려 800px 이하에서 마우스로도 키보드로도 내비게이션에 도달할 수 없었다. QA-COMMON-06(모든 인터랙티브 요소에 키보드로 도달)과 NFR-007 위반이다 | WP-015 / QA-COMMON-06, QA-COMMON-07, NFR-007, C-001 | **구현 결함(자체)** | **CR-018** | **resolved (2026-08-21)** — 구현 중 접근성 조사에서 발견했다(문서·계약 문제가 아니라 **내 누락**이다). Conductor `TopBar`가 이미 `menuButton` 슬롯을 갖고 있고 `.cdt-topbar__menu-button`을 기본 `display: none` / 800px 이하 `inline-flex`로 두므로 **앱이 중단점을 다시 적을 필요가 없다** — 슬롯을 채우는 것으로 끝났다. 추가 CSS도 아이콘 라이브러리도 넣지 않았다(QA-COMMON-16·17 유지). 함께 드러난 것: 비모달 Radix Dialog는 포커스를 가두지도 닫을 때 트리거로 되돌리지도 않아 `Escape` 시 포커스가 `<body>`로 떨어졌다(QA-COMMON-07). `Dialog.Trigger`를 쓰려면 `@radix-ui`를 직접 의존해야 해 QA-COMMON-17에 걸리므로, **포커스가 버려졌을 때만** 버튼으로 되돌리도록 앱 쪽에서 처리했다 — 라우트 전환으로 닫힐 때는 `main`이 이겨야 하기 때문이다 |
| DEV-074 | 2026-08-21 | **프록시의 "그런 세션이 없다" 갈래가 검증되지 않은 채 초록이었다.** e2e 환경에는 Redis가 없어 `SessionStore.load`가 늘 던지고, 그러면 503(확인할 수 없다)이 401(그런 세션이 없다)을 **가린다.** `위조한 세션 쿠키로도 통과하지 못한다` 시험이 옳은 이유가 아닌 이유로 통과하고 있었다 — 세션 검사를 통째로 없애도 시험이 잡지 못한다(변이 E11로 확인) | WP-015 / FR-AUTH-001, DEV-047 | **시험 공백(자체)** | **CR-018** | **resolved (2026-08-21)** — 판정을 라우트에서 떼어 `lib/proxy.ts`의 순수 함수 `resolveProxyAuth(sessionId, load)`로 옮겼다. 적재를 인자로 받으므로 **저장소 없이 세 갈래(인증됨·미인증·확인 불가) 전부를 직접 건다.** `lib/proxy.ts`가 스스로 밝힌 원칙("보안 판정은 Next.js 런타임 없이 시험할 수 있어야 한다")을 인증 판정에도 적용한 것이다. e2e의 `[401, 503]` 단언은 그대로 두되(양쪽 환경에서 회귀를 잡는다) 무엇을 덮지 못하는지를 주석에 적었다 |
| DEV-075 | 2026-08-21 | **`QA-W001-14`가 WP-016과 WP-032 양쪽 DoD에 있다.** WP-016의 제외 목록은 "커서 페이징 (WP-032)"를 명시하는데 완료 기준은 `QA-W001-01 ~ QA-W001-14`를 인용한다. WP-032의 DoD도 `QA-W001-14 ~ QA-W001-19`를 인용한다. `next_cursor`는 WP-032까지 늘 `null`이므로(CR-016) WP-016이 그 항목을 통째로 통과시킬 방법이 없다 | WP-016, WP-032 / QA-W001-14, FR-SRCH-008 | 문서 간 모순 | **CR-019** | **resolved (2026-08-21)** — **항목을 둘로 가른다.** "페이지 번호 UI가 없다"는 **금지 규칙**이라 데이터 없이도 검증되고 지금 세우는 것이 옳다 — 나중에 검사하면 이미 잘못 만든 뒤다. "커서 기반으로 동작한다"는 WP-032. WP-016 DoD에 부분 통과로 명시했다 |
| DEV-076 | 2026-08-21 | **`facets`·`facets_omitted`를 API 계약은 항상 싣는다고 적었으나 구현은 둘 다 넣지 않는다.** 계약 예시에 `"facets": {...}`와 `"facets_omitted": false`가 있으나 WP-013은 CR-016 DEV-057의 규칙(키 없음 = 만들지 않았다)에 따라 키를 뺀다. 게다가 실제 상태는 셋(계산 안 함 / 계산했고 생략 없음 / 예산 초과 생략)인데 계약은 `false`·`true` 둘만 표현한다 — C-012는 `omitted` 상태에서 사유를 표시해야 하는데 무엇을 표시할지 구분할 수 없다 | WP-016, WP-032 / C-012, FR-SRCH-009 AC-4, API-SRCH-004 | 문서와 구현 불일치 | **CR-019** | **resolved (2026-08-21)** — 키 부재를 **`not_computed`**로 읽고 레일이 그 사유를 표시한다. `facets_omitted: true`(예산 초과)와 다른 문구다 — 전자는 "아직 만들지 않는다", 후자는 "이번엔 못 셌다"이고 사용자가 할 수 있는 일이 다르다. 계약 예시를 세 경우 전부로 고쳤다 |
| DEV-077 | 2026-08-21 | **C-014 SequenceBadge의 필수 prop이 지금 데이터로 만족될 수 없다.** 명세는 `space: SequenceSpaceRef`·`epoch: number`를 널 불허로 요구하는데 `/search`·`/resolve`의 `merge_seq`·`seq_epoch`·`sequence_space`는 **WP-021까지 전부 `null`이다**. `SequenceSpaceRef` 타입은 문서 3곳이 언급하지만 정의가 어디에도 없다(코드 0곳). 상태 목록의 `unassigned`는 **미머지**를 뜻하므로 "아직 계산하지 않았다"를 표현하지 못한다 | WP-016, WP-021 / C-014, FR-SEQ-001 | 범위 공백 | **CR-019** | **resolved (2026-08-21)** — `space`·`epoch`를 **널 허용**으로 고치고 **`not_computed` 상태를 더했다**. 미머지와 미계산을 가르는 것은 CR-016 DEV-057이 응답에 세운 규칙의 화면판이다 — 둘을 같은 배지로 그리면 "이 PR은 머지되지 않았다"는 **거짓을 말하게 된다**. `SequenceSpaceRef`는 투영이 실제로 주는 모양(`owner/repo@branch` 문자열) 그대로 정의했다 |
| DEV-078 | 2026-08-21 | **FLOW-001 4단계의 "이동 전 원본 입력을 URL 쿼리에 남긴다"에 파라미터 이름이 없다.** 후보 1건이면 상세로 이동하는데, 뒤로가기로 돌아왔을 때 입력이 살아 있어야 한다는 요구만 있고 무엇으로 나르는지가 정해져 있지 않다. `query-url.ts`의 `PARAM`에도 자리가 없다 | WP-016 / FLOW-001, FR-SRCH-001 | 범위 공백 | **CR-019** | **resolved (2026-08-21)** — **`from_q`**로 정했다. `q`를 재사용하지 않는 이유는 상세 화면의 URL에 `q`가 있으면 그 화면이 검색 결과인 것처럼 읽히고, 공유된 링크가 의도와 다르게 해석되기 때문이다 |
| DEV-079 | 2026-08-21 | **C-010의 필수 prop `recentQueries: string[]`의 출처가 정해져 있지 않다.** 저장 API도 저장 위치 결정도 없다. `saved_search`(WP-033)는 사용자가 **명시적으로 저장한** 검색이라 "최근 검색"과 다른 것이다 | WP-016, WP-033 / C-010 | 범위 공백 | **CR-019** | **resolved (2026-08-21)** — **저장 위치를 지어내지 않는다.** prop을 **선택(기본 `[]`)으로 낮추고** 비면 최근 목록을 그리지 않는다. 서버에 보내는 설계를 임의로 넣으면 사용자의 **조사 이력이 서버 기록**이 되는데 그것을 요구한 문서가 없다 — 보안 문서의 감사 대상에도 없다 |
| DEV-080 | 2026-08-21 | **`QA-W001-06`의 "접두 결과 50건 초과"와 `/resolve`의 기본 `limit=10`이 어긋난다.** `truncated`는 `hits.length > limit`이므로 기본값으로 부르면 **11건에서 이미 참**이 된다. FR-SRCH-004 AC-3이 정한 경계는 50이다 | WP-016, WP-014 / QA-W001-06, FR-SRCH-004 AC-3, API-SRCH-001 | 문서와 구현 불일치 | **CR-019** | **resolved (2026-08-21)** — **API를 고치지 않고 화면이 `limit=50`을 명시해 부른다.** AC-3의 상한은 `MAX_PREFIX_CANDIDATES = 50`이 이미 강제하고, 기본 10은 옴니 입력의 드롭다운 같은 다른 소비자에게 합리적인 크기다. AC-3의 화면이 W-001이므로 **그 화면이 50을 요구하는 것**이 맞다 |
| DEV-081 | 2026-08-21 | **W-001-RESULTS가 "관계 배지"를 결과 열로 요구하지만 이 WP가 그릴 수 없다.** `C-015 RelationBadgeGroup`은 **WP-031 소관**이고(작업 패키지 문서가 그렇게 배정한다), `link_summary`는 `links_pending`이 영영 `true`라 **WP-029까지 비어 있다** | WP-016, WP-029, WP-031 / W-001-RESULTS, C-015, FR-REL-004 | 문서 간 모순 | **CR-019** | **resolved (2026-08-21)** — **관계 열을 만들지 않는다.** 빈 열을 미리 두면 사용자가 "이 PR에는 관계가 없다"로 읽는데, 실제로는 아직 파생하지 않은 것이다 — DEV-077과 같은 종류의 거짓말이다. WP-031이 C-015와 함께 열을 붙인다 |
| DEV-082 | 2026-08-21 | **`QA-W002-03`이 통과할 수 없다.** WP-017의 DoD가 인용하는데, FR-SRCH-003 AC-4는 절삭 시 "앞의 250건과 **전체 건수**"를 요구하고 `source_commits_total`은 **절삭됐을 때 정확히 그때** 빠진다. CR-017 DEV-063이 그렇게 정했다 — 보강 payload가 진짜 총계를 나르지 않으므로 250을 총계로 내보내면 거짓이다 | WP-017, WP-020 / QA-W002-03, FR-SRCH-003 AC-4 | 문서 간 모순 | **CR-020** | **resolved (2026-08-21)** — **항목을 둘로 가른다** (DEV-075와 같은 처리). "절삭 표시"는 지금 세운다 — 사용자가 "이게 전부"로 오해하는 것을 막는 것이 그 표시의 목적이고, 총계 없이도 성립한다. "전체 건수"는 `EVT-ING-002` 확장 CR 뒤다. WP-017 DoD에 부분으로 명시했다 |
| DEV-083 | 2026-08-21 | **C-018 CommitList의 `totalCount: number`가 널을 허용하지 않는데 절삭 시 값이 없다.** DEV-082와 같은 뿌리다. 타입대로 만들려면 없는 수를 채워야 한다 | WP-017 / C-018, FR-SRCH-003 AC-4 | 범위 공백 | **CR-020** | **resolved (2026-08-21)** — `totalCount: number \| null`로 고쳤다. **`null`은 "250건 이상, 정확한 수 모름"으로 다르게 표시한다** — 확정 총계와 같은 문구로 그리면 화면이 모르는 것을 아는 척한다. DEV-077(미머지 vs 미채번)과 같은 종류의 구분이다 |
| DEV-084 | 2026-08-21 | **C-022 PrTimeline의 5단계 중 2단계에 데이터가 없다.** "승인"은 `approved_by`(로그인 목록)만 있고 **`approved_at`이 ES 매핑에 없다** — 승인이 일어났는지는 알아도 **언제인지는 모른다**. "릴리스 포함"은 WP-024 소관이라 조회할 것이 없다. 명세는 `steps: TimelineStep[]`만 요구하고 이 구분을 표현하지 않는다 | WP-017, WP-024 / C-022, FR-STAT-003, FR-STAT-004 | 범위 공백 | **CR-020** | **resolved (2026-08-21)** — 단계 상태를 **넷으로** 정의했다: `done`(시각 있음) / `done_at_unknown`(일어났으나 시각 모름 — 승인) / `pending`(아직) / `out_of_scope`(이 WP 밖 — 릴리스). **시각을 지어내지 않는다.** `approved_by`가 비어 있지 않은데 시각이 없는 것은 데이터 공백이지 "승인 안 됨"이 아니다 |
| DEV-085 | 2026-08-21 | **W-002-OVERVIEW가 "리뷰어와 리뷰 상태"를 요구하지만 리뷰 상태가 저장되지 않는다.** 투영에는 `reviewers`·`approved_by` **로그인 목록만** 있고(둘 다 `keyword`) 리뷰어별 상태(대기·변경 요청·승인)가 없다 | WP-017, WP-020 / W-002-OVERVIEW, ENT-CORE-002 | 범위 공백 | **CR-020** | **resolved (2026-08-21)** — 두 목록에서 파생할 수 있는 것까지만 표시한다: **승인함 / 아직 승인 안 함.** "변경 요청"은 데이터가 없으므로 **만들지 않는다** — 없는 상태를 UI에 두면 영영 비어 있고, 사용자는 그것을 "변경 요청한 사람이 없다"로 읽는다 |
| DEV-086 | 2026-08-21 | **C-023의 필수 prop `externalUrl`을 만들 재료가 응답에 없다.** API가 주는 `url`은 **내부 경로**(`/pr/{repo}/{number}`)이고 GHE 링크가 아니다. 게다가 `GHE_BASE_URL`이 구성되지 않은 배포에서 무엇을 그릴지가 정해져 있지 않다 | WP-017 / C-023, W-002-HEADER | 범위 공백 | **CR-020** | **resolved (2026-08-21)** — 형식은 **SRS FR-SRCH-001 AC-3이 이미 정했다**(`https://<host>/<owner>/<repo>/pull/<N>`) — 판별기가 파싱하는 것과 같은 모양이라 새로 정할 것이 없다. `GHE_BASE_URL`로 만들고 **미구성이면 버튼 자체를 그리지 않는다.** 죽은 링크는 없는 것보다 나쁘다 |
| DEV-087 | 2026-08-21 | **`epoch_stale` 상태에 도달할 방법이 없다.** 상태 매트릭스와 와이어프레임이 동작을 정의하지만, 시퀀스가 WP-021까지 전부 `null`이고 **에폭 변경을 감지할 경로**(URL이 에폭을 나르는지, 주기적 재조회로 비교하는지)가 어느 문서에도 없다 | WP-017, WP-021 / W-002 상태 매트릭스, FR-SEQ-005 | 범위 공백 | **CR-020** | **resolved (2026-08-21)** — **만들지 않는다.** WP-017의 DoD도 이 상태를 요구하지 않는다(`loading_initial`·`ready`·`enrichment_pending`·`truncated`·`not_found`만 인용). 도달할 수 없는 코드는 검증할 수 없고, 검증되지 않은 방어 코드는 나중에 조용히 틀린다 — CR-018에서 같은 이유로 `activeNavId`의 죽은 분기를 시험 가능하게 바꿨고, CR-019에서는 도달 불가능한 지름길을 지웠다. 감지 경로는 **WP-021이 시퀀스를 채울 때 함께 정한다** |
| DEV-088 | 2026-08-21 | **`QA-W002-17`도 절반만 검증된다.** "관계·동시 변경 섹션이 확장 시에만 조회된다"인데 관계 데이터가 **WP-031 소관**이라 확장해도 조회할 것이 없다 | WP-017, WP-031 / QA-W002-17, IA 원칙 4 | 문서 간 모순 | **CR-020** | **resolved (2026-08-21)** — DEV-075·DEV-082와 같은 처리. **"확장 전에 조회하지 않는다"는 금지 규칙이라 지금 세운다** — 진입 시 관계를 함께 부르지 않는 구조를 지금 잡아야 WP-031이 조회를 붙일 때 고칠 것이 없다. "확장하면 조회한다"는 WP-031 |
| DEV-089 | 2026-08-22 | **`repository_archived`와 `files_truncated`를 어느 화면도 표시하지 않는다.** 둘 다 SRS가 요구해 파이프라인이 실제로 채우는 플래그다 — FR-ING-009 AC-3("문서에 `repository_archived: true`를 표시한다")과 FR-ING-007 AC-4("상위 3000개만 저장하고 `files_truncated: true`"). 그런데 `W-002-HEADER`·`W-002-OVERVIEW`의 섹션 정의에 표시 요구가 없어, **투영이 채운 값이 사용자에게 한 번도 닿지 않는다.** 보관된 저장소의 PR은 갱신되지 않는데 그 이유가 화면 어디에도 없고, 파일 3000개에서 잘린 PR은 "파일 3000개"라고만 보인다 | WP-017, WP-016 / W-002-HEADER, W-002-OVERVIEW, FR-ING-007 AC-4, FR-ING-009 AC-3 | 범위 공백 | **CR-020** | **resolved (2026-08-22)** — **W-002가 둘 다 표시한다.** 커밋 절삭(DEV-082·083)에 세운 것과 같은 규칙을 파일 절삭에도 쓴다 — 절삭을 밝히지 않은 건수는 거짓이다. 보관은 `Banner tone="warning"`으로 알린다. **W-001 결과 표는 이번에 건드리지 않았다** — 행마다 배지를 더하면 목록의 밀도 설계를 다시 해야 하고 그것은 WP-016의 완료된 범위다. 후속으로 남긴다(7장) |
| DEV-003 | 2026-08-19 | `../00_governance/change_control.md` 4장 아키텍처 게이트 기록이 "오류 코드 30종"으로 적혀 있으나 API 계약 6장의 실제 코드는 29종이었다 | WP-001 | 문서 오류 | **CR-006** | **resolved (2026-08-20)** — 게이트 기록을 29종으로 정정하고 CR-005로 GH 코드 16종이 추가되어 현재 45종임을 함께 표기 |

**등록이 필요한 대표 상황** (사전에 예상되는 것):

| 예상 상황 | 유형 | 처리 |
| --- | --- | --- |
| Squash & Merge가 아닌 정책(merge commit, rebase)을 쓰는 저장소 발견 | 범위 공백 | SRS 5.1 가정 1 위반. CR로 SRS 가정과 시퀀스 채번 규칙을 갱신 |
| Conductor에 필요한 프리미티브(차트·그래프)가 없음 | 기술 제약 | ADR 기록 + design-system 기여 제안. 토큰 문서 12장에 이미 기록됨 |
| 7자 접두 검색 p95가 200ms를 넘음 | 기술 제약 | ADR-012 follow-up 경로(`index_prefixes`) 검토 후 새 ADR |
| GHE API가 문서와 다른 응답을 반환 | 문서 오류 | API 계약 문서 수정 후 cascade |
| 접근 범위가 500개를 훨씬 넘는 사용자가 다수 | 기술 제약 | ADR-008의 `org_team` 모드 임계 재검토 |
| 미러 디스크가 산정치를 크게 초과 | 기술 제약 | 인프라 5장 용량 재산정 CR |

## 6. 검증 결과 기록

### 6.1 WP별 검증 실행 기록

실제로 실행한 명령과 결과만 적는다. 실행하지 않은 검증은 실행하지 않았다고 적는다.

**WP-001** (2026-08-19, Node v22.22.2 / pnpm 10.33.0, 커밋 `f36ab06`, PR #2)

| 명령 | 결과 |
| --- | --- |
| `pnpm install` | 성공 — 217 패키지 |
| `pnpm typecheck` | 성공 (종료 코드 0) — `tsc --build` 10개 프로젝트 + `@prs/web` `tsc --noEmit` |
| `pnpm lint` | 성공 (종료 코드 0) — 경고 0 |
| `pnpm lint:deps` | 성공 (종료 코드 0) — 패키지 11개, 위반 0건 |
| `pnpm test` | 성공 (종료 코드 0) — 테스트 파일 7개, 테스트 20건 통과 |
| `pnpm build` | 성공 (종료 코드 0) — 패키지 7개 + 앱 4개(`next build` 포함) |
| `docker compose config` | 성공 (종료 코드 0) — compose 정의 유효 |
| `docker compose up -d` | **실패** — 이미지 pull이 이그레스 정책에 막힘 (DEV-001) |
| `docker compose ps` | 컨테이너 0개 (위 실패의 결과) |
| GitHub Actions `verify` | 성공 — 커밋 `44c1772`, run 32313150545. typecheck → lint → lint:deps → test → build 전 단계 통과 |

`lint:deps` 실패 동작 검증 (DoD 2번):

| 단계 | 조작 | 결과 |
| --- | --- | --- |
| 1 | 정상 상태 | 종료 코드 0 |
| 2 | `@prs/domain`에 `@prs/contracts` 의존 추가 (layer 0 → 1) | 종료 코드 1. 위반 2건 (역방향 + 순환) 보고 |
| 3 | `@prs/es`에 `@prs/search-api` 의존 추가 (layer 1 → 2) | 종료 코드 1. 위반 1건 보고 |
| 4 | 두 변경 원복 | 백업과 바이트 동일 확인 |
| 5 | 최종 상태 재확인 | 종료 코드 0, 위반 0건 |

헬스 엔드포인트 실제 HTTP 확인 (DoD 3번의 앱 부분):

| 앱 | 요청 | 결과 |
| --- | --- | --- |
| `web` | `GET http://127.0.0.1:3000/healthz` | 200 `{"status":"ok","service":"web","version":"0.1.0"}` |
| `ingest-gateway` | `GET http://127.0.0.1:3001/healthz` | 200 `{"status":"ok","service":"ingest-gateway",...}` |
| `search-api` | `GET http://127.0.0.1:3002/healthz` | 200 `{"status":"ok","service":"search-api",...}` |
| `pipeline-worker` | `GET http://127.0.0.1:3003/healthz` | 200 `{"status":"ok","service":"pipeline-worker",...}` |

CI 첫 실행은 `pnpm/action-setup`의 `version` 입력과 `package.json`의 `packageManager`가 중복 지정되어 실패했다. `packageManager`를 단일 출처로 두고 워크플로의 `version` 입력을 제거해 해결했다 (`44c1772`).

WP-001의 헬스체크는 프로세스 기동만 확인한다. 백킹 서비스 연결 확인은 각 연결을 실제로 여는 WP가 더한다.

### 6.2 WP-002 검증 실행 기록

2026-08-19, PostgreSQL 16.13 (네이티브 설치본. 레지스트리 차단으로 컨테이너를 쓸 수 없어 같은 메이저 버전의 로컬 인스턴스를 사용했다 — DEV-001).

| DoD | 명령 / 확인 | 결과 |
| --- | --- | --- |
| 1 | `pnpm db:migrate` | 성공 — 001~005 적용, 테이블 14종 생성 |
| 1 | `pnpm db:migrate --down` | 성공 — 005~001 회수, `schema_migration` 외 잔여 테이블 0 |
| 2 | `pnpm db:seed` | 성공 — 저장소 3, PR 200, 커밋 500, 릴리스 10, 원본 이벤트 510 |
| 3 | 같은 `delivery_id` 재삽입 (같은 `received_at`) | SQLSTATE 23505 유니크 위반 (FR-ING-002 AC-1) |
| 4 | 같은 `(type, target)` 활성 잡 2건 | SQLSTATE 23505 유니크 위반 (FR-ADMIN-002 AC-4) |
| 5 | 동시 `pg_try_advisory_xact_lock` | 하나만 `true`, 다른 하나는 대기 없이 `false`. 커밋 후 재시도 성공 (FR-SEQ-001 AC-6) |
| 6 | `has_table_privilege('prs_app','audit_record', …)` | INSERT/SELECT `true`, UPDATE/DELETE `false` (FR-AUTH-004 AC-3) |

| 명령 | 결과 |
| --- | --- |
| `pnpm test:integration` | 성공 — 테스트 파일 6개, 테스트 26건 |
| `pnpm typecheck` / `lint` / `lint:deps` / `test` / `build` | 전부 종료 코드 0 (단위 테스트 20건) |
| GitHub Actions `verify` | 성공 — 커밋 `96d4e2f`, run 32314753316 |
| GitHub Actions `integration` | 성공 — 같은 run. `postgres:16-alpine` **서비스 컨테이너**에서 통합 테스트 26건 통과 |

CI의 `integration` 잡이 컨테이너 PostgreSQL에서 같은 테스트를 통과했다는 점이
DEV-006의 근거다. 로컬 검증이 네이티브 인스턴스였던 것은 이 실행 환경의 제약이지
테스트가 컨테이너에서 못 도는 것이 아니다.

테스트가 실제로 제약을 검증하는지 역으로 확인했다. 제약을 일부러 제거하면 해당 테스트만 실패하고, 원복하면 다시 통과한다.

| 조작 | 결과 |
| --- | --- |
| `GRANT UPDATE ON audit_record TO prs_app` | 감사 권한 테스트 1건 실패 → 원복 후 통과 |
| `DROP INDEX job_active_uk` | 활성 잡 유니크 테스트 1건 실패 → 원복 후 통과 |

### 6.3 WP-003 검증 실행 기록

2026-08-20. **이 환경에는 Elasticsearch를 띄울 수 없다** — `docker.elastic.co`와 `artifacts.elastic.co`가 모두 403으로 차단되고 네이티브 설치본도 없다 (DEV-008). WP-002 때의 PostgreSQL 같은 우회로가 없다.

| DoD | 확인 | 로컬 | CI |
| --- | --- | --- | --- |
| 1 | `pnpm es:apply-mappings`가 인덱스 4종과 별칭 생성 | 불가 | `bootstrap.test.ts` |
| 2 | 매핑 일치 검증 테스트 통과 | 불가 | `mappings.test.ts` |
| 3 | 매핑에 없는 필드 색인 거부 (`dynamic: strict`) | 불가 | `behavior.test.ts` |
| 4 | `search()`가 `ScopedQuery` 아닌 인자에 컴파일 실패 | **통과** | `pnpm typecheck` |
| 5 | `commit_sha` 대소문자 무관 매칭 | 불가 | `behavior.test.ts` |

**CI 검증 결과 — 커밋 `2477c74`, run 32340561385. `verify`·`integration` 모두 성공.**

`integration` 잡은 `docker.elastic.co/elasticsearch/elasticsearch:8.19.0` 서비스 컨테이너를 띄우고 통합 테스트를 돌렸다. Elasticsearch 서버 로그가 DoD를 직접 증명한다.

| DoD | ES 서버 로그 증거 |
| --- | --- |
| 1 | `[prs-pull-requests-v1] creating index, cause [api], shards [6]/[1]`, `[prs-commits-v1] ... shards [12]/[1]`, `[prs-links-v1] ... shards [12]/[1]`, `[prs-releases-v1] ... shards [2]/[1]` — ADR-003이 정한 샤드 수 그대로 |
| 2 | `mappings.test.ts`가 4종 전부에 대해 `dynamic: strict`와 정의한 속성의 `type`·`analyzer`·`normalizer`·`index`·`ignore_above`를 대조하고 통과 |
| 3 | `StrictDynamicMappingException: [1:44] mapping set to strict, dynamic introduction of [source_code_body] within [_doc] is not allowed` — 매핑에 없는 필드가 실제로 거부되었다 |
| 5 | `behavior.test.ts`의 대소문자 교차 조회와 접두 검색이 같은 문서를 반환 |

멱등성도 확인되었다. 인덱스 삭제 후 재생성 로그가 한 번씩만 나타난다.

DoD 4는 역으로도 확인했다. `search()`의 `ScopedQuery` 제약을 일부러 `QueryDslQueryContainer`로 완화하면 `pnpm typecheck`가 `error TS2578: Unused '@ts-expect-error' directive`로 실패하고, 원복하면 통과한다. 접근 범위 필터 우회가 런타임 버그가 아니라 빌드 실패라는 뜻이다 (ADR-008).

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 (테스트 파일 포함) |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 |
| `pnpm test` | 종료 코드 0 — 테스트 파일 8개, 27건 |
| `pnpm build` | 종료 코드 0 |
| `vitest run --config vitest.integration.config.ts packages/db` | 종료 코드 0 — 26건 (WP-002 회귀 없음) |
| `pnpm test:integration` (전체) | 로컬에서는 ES 부재로 실패. CI에서 성공 |

### 6.4 WP-004 검증 실행 기록

2026-08-20. PostgreSQL 16.13(네이티브)과 실제 HTTP로 검증했다. `app.inject()`는 네트워크 계층을 건너뛰므로 수신 응답 시간과 본문 크기 상한 측정에는 쓰지 않았다.

| DoD | 확인 | 결과 |
| --- | --- | --- |
| 1 | 유효 서명 → 202 + `raw_event` 저장 | **통과** — `event_type`·`action`·`repository_id`·payload 전문·`payload_hash`·`correlation_id`가 그대로 남는다 |
| 2 | 무효·변조 서명 → 401, 미저장 | **통과** — 다른 시크릿·본문 1바이트 변조·헤더 부재 세 경우 모두 401이고 행 0 |
| 3 | 재전송 → 202 `duplicate: true`, 행 증가 없음 | **통과** — 순차 3회, 동시 8회 모두 행 1개 |
| 4 | 25MB 초과 → 413 | **통과** — 초과분 413 + 미저장, 상한 바로 아래(25MB−1KB) 202 |
| 5 | INSERT 실패 → 500 | **통과** — 파티션 없는 수신 시각으로 실제 PostgreSQL 오류를 내 확인. 목을 쓰지 않았다 |
| 6 | 수신 응답 p95 300ms 이하 (1000 요청) | **통과** — p50 33.5ms / **p95 61.6ms** / p99 133.9ms (동시 20). 1000건 전부 202이고 `raw_event` 1000행 |
| 7 | 서명 검증이 JSON 파싱보다 먼저임을 테스트로 확인 | **통과** — 호출 순서 단언 + "서명 틀린 깨진 JSON이 400이 아니라 401" 두 갈래 |
| 8 | QA-A001-01 수신 지표 노출 | **통과** — `GET /metrics`가 `ingest_received_total`·`ingest_rejected_total`·`ingest_duplicate_total`·`ingest_response_seconds`를 Prometheus 형식으로 낸다 |

**테스트가 실제로 제약을 검증하는지 역으로 확인했다.** 제약을 일부러 깨면 해당 테스트만 실패하고, 원복하면 다시 통과한다.

| 조작 | 결과 |
| --- | --- |
| 조건부 INSERT를 빼고 기본 키 충돌에만 의존 (문서가 가정한 구현) | 통합 5건 실패 — 동시 8건이 8행이 된다. **DEV-009의 근거** |
| `store.ts`에서 advisory lock 제거 | `idempotency.test.ts` 2건 실패 (락 대기 없음 / `lock_timeout` 예외 없음) |
| 원문 바이트 content-type 파서 제거 (Fastify 기본 JSON 파서 복원) | `server.test.ts` 4건 실패 — 파싱이 서명 검증보다 앞서면 잡힌다 |
| `constantTimeEquals`를 `expected === actual`로 교체 | 타이밍 테스트 실패 (비율 50.7 / 임계 2) |

타이밍 테스트는 비교 함수를 직접 재도록 다시 썼다. 서명 길이(71자)에서 재면 HMAC 계산 비용이 비교 비용을 덮어서, `===`로 바꿔도 통과해 버린다 — 즉 그 형태로는 아무것도 검증하지 못한다. 64KB 입력에서 비교만 재면 `===`는 세 자릿수 배로 갈리고 `timingSafeEqual`은 0.9배 언저리에 머문다. 두 값을 전부 버퍼로 복사한 뒤 `===`로 비교하는 변형은 이 측정에 걸리지 않는다는 점도 테스트 주석에 적어 두었다.

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | 종료 코드 0 (테스트 파일 포함) |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 테스트 파일 11개, **71건** |
| `pnpm build` | 종료 코드 0 |
| `vitest run --config vitest.integration.config.ts packages/db apps/ingest-gateway` | 종료 코드 0 — 파일 9개, **47건** (WP-002 회귀 없음) |

WP가 적은 검증 명령은 `pnpm test:integration -- gateway`와 `pnpm test -- gateway/signature`다. 앞의 것은 vitest가 `--` 뒤 인자를 필터로 받지 않아 전체 통합 스위트를 돌린다. 뒤의 것은 `gateway/signature`와 이어지는 경로가 없어 0건이 잡힌다(실제 경로는 `apps/ingest-gateway/src/signature.test.ts`). 위 표의 명령이 같은 대상을 실제로 돌린 것이다.

**CI 검증 결과 — 커밋 `e0bf745`, run 32351007528. `verify`·`integration` 모두 성공.**

`integration` 잡은 PostgreSQL 16과 Elasticsearch 8.19.0 서비스 컨테이너를 띄우고 통합 스위트 전량(WP-002·WP-003·WP-004)을 돌렸다. 부하 시험의 p95 단언(≤ 300ms)도 CI 러너에서 통과했다 — 로컬 네이티브 PostgreSQL보다 느린 환경에서도 예산 안이라는 뜻이다.

**환경 제약.** Elasticsearch 통합 테스트는 로컬에서 여전히 돌지 않는다(DEV-008). WP-004는 Elasticsearch를 쓰지 않으므로 이 WP의 DoD에는 영향이 없고, CI에서는 WP-003 스위트와 함께 돈다.

### 6.5 WP-005 검증 실행 기록

2026-08-20. PostgreSQL 16.13과 Redis 7(둘 다 네이티브 설치본)으로 검증했다. Redis는 이 환경에 설치되어 있어 **DoD 4를 시늉이 아니라 실제 프로세스 정지·복구로 확인했다**.

| DoD | 확인 | 결과 |
| --- | --- | --- |
| 1 | 같은 파티션 키의 메시지가 같은 소비자에게 순서대로 전달된다 | **통과** — 25건 순서 일치. 파티션을 둘로 갈라 소비자 둘에게 맡겼을 때 키 5종이 각각 한쪽에만 전량 도착 |
| 2 | 소비자 장애 시 미ack 메시지가 재전달된다 | **통과** — 핸들러가 던지면 전달 횟수가 올라가며 재전달. 소비자가 ack 전에 죽으면 후임이 회수 |
| 3 | 계약 테스트가 통과한다 | **통과** — 계약 12건을 **두 어댑터**(Redis Streams, 인메모리)가 같은 파일로 통과 |
| 4 | Redis 정지 뒤 수신하면 202, 복구 후 `JOB-ING-007`이 재적재한다 | **통과** — 아래 실제 정지·복구 기록 참조 |

**DoD 4 — 실제 Redis 프로세스를 정지시키고 확인한 순서.**

| 단계 | 관측값 |
| --- | --- |
| 1 | `service redis-server stop` — 정지 |
| 2 | 웹훅 수신 → `202 {"accepted":true,"delivery_id":"real-outage-1","duplicate":false}` |
| 3 | 저장된 행 → `queued_at=2026-08-20T10:24:18.286Z`, `processed_at=null` |
| 4 | `service redis-server start` → `redis-cli ping` = `PONG` |
| 5 | `JOB-ING-007` 한 회차 → `{"found":1,"relayed":1,"failed":0}` |
| 6 | 소비자 수신 → `{"delivery_id":"real-outage-1","event_type":"pull_request","action":"closed","repository_id":4021,...}` |

이 검증에 쓴 일회성 테스트는 시스템 서비스를 정지시키므로 저장소에 남기지 않았다. 같은 시나리오의 결정론적 버전(응답하지 않는 가짜 서버, 닿지 않는 엔드포인트)은 `enqueue.test.ts`와 `outbox-relay.test.ts`로 남아 CI에서 돈다.

**설계 결정 하나를 기록해 둔다.** Redis Streams에는 파티션이 없다 — 소비자 그룹은 먼저 읽는 소비자에게 아무 메시지나 준다. 그대로 쓰면 같은 저장소의 이벤트가 여러 워커로 흩어져 DoD 1이 성립하지 않는다. 그래서 토픽 하나를 물리 스트림 N개(`prs:ingest:0` … `prs:ingest:15`)로 펴고 파티션 키 해시로 스트림을 고른다. 파티션 수는 비동기 문서 2장의 "동시성" 열에서 그대로 가져왔다 — 한 파티션을 한 소비자만 맡으므로 동시성 상한이 곧 파티션 수다. `prs:sequence`만 그 숫자가 문서에 없어 DEV-010으로 남겼다.

**구현 중 발견해 고친 결함: BIGINT가 문자열로 돌아오고 있었다.**

node-postgres는 `int8`을 기본으로 문자열로 준다(2^53 정밀도 문제 때문이다). 그런데 WP-002의 리포지터리 타입은 `repository_id: number`로 선언되어 있었다 — 선언과 런타임 값이 어긋나 있었고, 타입 검사로는 드러나지 않는다. WP-005에서 이 값이 이벤트 payload와 파티션 키로 나가면서 `"4021"`이 실려 잡혔다. 그대로 뒀다면 소비자 쪽 `repository_id === 4021` 비교가 전부 조용히 어긋났을 것이다.

`@prs/db`에 int8 파서를 넣어 숫자로 받되, 안전 정수 범위를 넘으면 **던지도록** 했다. 조용히 잘린 ID로 엉뚱한 저장소를 가리키는 것보다 즉시 실패하는 편이 낫다. 회귀 테스트는 `packages/db/integration/type-parsers.test.ts`다.

**테스트가 실제로 제약을 검증하는지 역으로 확인했다.**

| 조작 | 결과 |
| --- | --- |
| `partitionFor`가 파티션 키를 무시하게 만듦 | 계약 4건 실패 (순서·소비자 귀속·PEL) |
| 미ack가 남은 파티션에서도 새 이벤트를 읽게 만듦 | "실패한 이벤트를 건너뛰지 않는다" 실패 |
| 게이트웨이가 `queued_at`을 찍지 않게 되돌림 (WP-004 상태) | "발행 실패에도 아웃박스 표식이 남는다" 실패 |
| 발행 마감(150ms) 제거 | "발행이 매달려도 예산을 지킨다" 실패 — 응답이 30초까지 늘어난다 |
| BIGINT 파서 제거 | 5건 실패 (재적재 payload 2건 + 파서 회귀 3건) |

발행 마감 테스트는 한 번 다시 썼다. 처음에는 닿지 않는 포트를 썼는데, 그러면 ioredis가 곧바로 연결 거부로 실패해 **마감을 없애도 테스트가 통과한다** — 아무것도 검증하지 못하는 테스트였다. 연결은 받아 주고 한 마디도 대답하지 않는 가짜 서버로 바꾸니 마감 없이는 30초가 걸리는 것이 드러났다.

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | 종료 코드 0 (테스트 파일 포함) |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 테스트 파일 12개, **86건** |
| `pnpm build` | 종료 코드 0 |
| `vitest run --config vitest.integration.config.ts packages/db packages/bus apps/ingest-gateway apps/pipeline-worker` | 종료 코드 0 — 파일 14개, **93건** |

WP가 적은 검증 명령은 `pnpm test:integration -- bus`다. WP-004 때와 같은 이유로 vitest가 `--` 뒤 인자를 필터로 받지 않아 전체 스위트를 돌린다. 위 표의 명령이 같은 대상을 실제로 돌린 것이다.

**CI 검증 결과 — 커밋 `e7b0bd9`, run 32359072673. `verify`·`integration` 모두 성공.**

`integration` 잡에 Redis 7 서비스 컨테이너를 더했다. PostgreSQL·Elasticsearch·Redis 셋을 띄우고 통합 스위트 전량(WP-002~WP-005)을 돌린다. 계약 테스트는 두 어댑터 모두, 아웃박스 재적재는 실제 Redis 대상으로 CI에서도 통과했다.

**환경 제약.** Elasticsearch만 여전히 로컬에서 띄울 수 없다(DEV-008). WP-005는 Elasticsearch를 쓰지 않으므로 이 WP의 DoD에는 영향이 없다.

### 6.6 WP-006 검증 실행 기록

2026-08-20. 문서가 정한 검증 방법이 "목 서버 기반"이라 실제 `node:http` 서버를 띄워 검증했다. fetch를 목으로 바꾸지 않았다 — 이 WP가 확인해야 할 것 대부분이 **HTTP 헤더와 상태 코드에 대한 반응**(rate limit 헤더 파싱, 429 + `retry-after`, 401 후 토큰 재발급)이라, fetch를 가로채면 그 경로를 통째로 건너뛰고 아무것도 증명하지 못한다.

| DoD | 확인 | 결과 |
| --- | --- | --- |
| 1 | 토큰이 만료되면 자동 갱신된다 | **통과** — 수명 2분·갱신 여유 1분에서 30초 뒤에는 재사용, 70초 뒤에는 재발급. 401 수신 시 캐시를 버려 다음 요청이 새 토큰을 받는다. 동시 요청 4건이 토큰을 중복 발급하지 않는다 |
| 2 | 잔여 10% 미만 토큰이 회복 시각까지 풀에서 제외된다 | **통과** — 임계 아래 응답 후 다음 요청이 회복 시각을 담아 거부되고, 서버로 요청 자체가 나가지 않는다. 회복 시각이 지나면 다시 쓴다 |
| 3 | 429 + `retry-after` 수신 시 해당 토큰이 지정 시간 격리된다 | **통과** — 45초 지정 시 44초에는 막히고 46초에는 풀린다. 헤더가 없으면 보수적으로 60초 격리 |
| 4 | 실시간 요청이 백필 요청보다 먼저 토큰을 배분받는다 | **통과** — 백필 둘이 먼저 줄을 섰어도 나중에 온 실시간이 앞선다. 같은 우선순위 안에서는 선입선출 |
| 5 | 토큰 값이 로그에 남지 않는다 (THR-009) | **통과** — 오류 메시지·스택·전송 이벤트 어디에도 발급된 토큰이 없다. 토큰은 Authorization 헤더로만 가고 URL·질의 문자열에 실리지 않는다 |

**테스트가 실제로 제약을 검증하는지 역으로 확인했다.**

| 조작 | 결과 |
| --- | --- |
| 10% 격리 조건 제거 | 4건 실패 (단위 2 + 전 계층 2) |
| `retry-after` 초 단위 파싱 제거 | 2건 실패 |
| 실시간 우선순위 뒤집기 | "백필이 먼저 줄을 섰어도 실시간이 앞선다" 실패 |
| `redact()` 무력화 | 9건 실패 (단위 8 + 전 계층 1) |
| 만료 판정 제거 | "만료가 가까워지면 새로 받는다" 실패 |

**leak 시험을 한 번 다시 썼다.** 처음에는 401 응답만으로 "토큰이 오류에 남지 않는가"를 보려 했는데, 그 응답 본문(`{"message":"Bad credentials"}`)에는 애초에 토큰이 없어서 **redaction을 무력화해도 통과했다** — 아무것도 검증하지 못하는 시험이었다. 목 서버가 받은 Authorization 헤더를 오류 본문에 되비추도록 바꾸니(잘못 구성된 프록시에서 실제로 일어나는 일이다) redaction 제거가 그 시험을 실패시킨다.

**구현 중 발견해 고친 결함 둘.**

1. `redact()`의 치환 콜백이 캡처 그룹 없는 정규식에서 `offset`(숫자)을 캡처 그룹으로 오해했다. 그 결과 토큰을 가리는 대신 원문 앞에 숫자를 붙여 되돌려 주고 있었다 — 즉 **토큰이 그대로 남았다**. 캡처 그룹 있는 패턴과 없는 패턴을 분리해 고쳤다.
2. `parseRateLimitHeaders`가 헤더 없는 응답을 "잔여 0"으로 읽었다. `Number(null)`이 `0`이고 `Number.isFinite(0)`이 참이기 때문이다. 그대로 두면 rate limit 헤더를 주지 않는 엔드포인트 응답 하나가 멀쩡한 토큰을 통째로 격리시킨다. `null` 검사를 먼저 하도록 고쳤다.

**실제 GHE 검증은 하지 않았다.** 이 환경에 GitHub App 자격 증명이 없다. read-only smoke 시험(`smoke-real-ghe.test.ts`)을 넣어 두었고 자격 증명이 있으면 자동으로 돈다 — 없으면 건너뛰되 그 사실을 실행 로그에 남긴다. 조용히 통과한 것처럼 보이지 않게 하려는 것이다. WP-006의 문서상 DoD와 검증 방법(`pnpm test -- github`, 목 서버 기반)은 real-GHE smoke를 요구하지 않으므로 DoD 판정에는 영향이 없다. 다만 **REL-001 운영 readiness 전에 반드시 남은 게이트**로 아래 8장에 남긴다.

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 파일 17개, **126건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |
| `vitest run --config vitest.integration.config.ts packages/db packages/bus apps/ingest-gateway apps/pipeline-worker` | 종료 코드 0 — **93건** (WP-002~005 회귀 없음) |
| `vitest run packages/github` | 종료 코드 0 — 40건 통과 + 1건 건너뜀 |

WP가 적은 검증 명령은 `pnpm test -- github`다. WP-004·WP-005 때와 같은 이유로 vitest가 `--` 뒤 인자를 필터로 받지 않아 전체 단위 스위트(126건)를 돌린다. `github`만 돌린 것은 위 표의 마지막 명령이다.

**CI 검증 결과 — 커밋 `82a432a`, run 32366126973. `verify`·`integration` 모두 성공.**

`verify` 잡이 단위 126건을 돌렸고 real-GHE smoke는 CI에도 자격 증명이 없어 건너뛰었다. `integration` 잡은 PostgreSQL·Elasticsearch·Redis 서비스 컨테이너로 WP-002~005 스위트를 돌려 회귀가 없음을 확인했다.

### 6.7 WP-007 검증 실행 기록

DoD 6항 전부 통과. 검증 방법은 `pnpm test:integration worker/enrich`다 (DEV-017로 정정한 형태).

| DoD | 결과 | 근거 |
| --- | --- | --- |
| PR 이벤트 처리 후 커밋·파일·리뷰가 병합된 결과가 `EVT-ING-002`로 발행된다 (FR-ING-004 AC-1) | 통과 | 목 GHE에서 커밋·파일·리뷰를 실제 HTTP로 받아 `prs:enriched`에 발행. 투영이 API를 다시 부르지 않아도 되는지를 별도 시험으로 고정했다 |
| rate limit 소진 시 보강이 지연되고 회복 시각에 재시도된다 (AC-2) | 통과 | 429 + `retry-after: 600`과 주 한도 소진(403 + `x-ratelimit-remaining: 0`) 둘 다 `defer`로 떨어진다. 전달 횟수가 5여도 실패 대기열로 가지 않는다 |
| 보강 실패 시에도 부분 결과가 `enrichment_pending: true`로 진행된다 (AC-3) | 통과 | 파일 조회만 403인 경우와 넷 다 403인 경우 모두 발행된다. 후자는 웹훅 payload로 만든 PR이 남는다 |
| 변경 파일 3000개 초과 시 절삭되고 플래그가 설정된다 (AC-4) | 통과 | 3001개 → 3000개 + `files_truncated: true`. **정확히 3000개는 절삭이 아니다**를 같은 스위트에서 고정했다 |
| 재시도 5회 소진 시 DLQ로 이동한다 (FR-ING-007 AC-1) | 통과 | 500이 계속되면 예산 안에서는 `retry`, 소진 후에는 부분 문서를 발행하고 `dead_letter`(`retry_count = 5`) |
| 404(삭제된 PR)는 재시도 없이 즉시 DLQ로 간다 (async 5.2) | 통과 | 첫 전달에서 곧바로 `dead_letter`. 같은 파티션의 다음 이벤트가 막히지 않는 것도 버스 왕복 시험으로 확인했다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 파일 20개, **150건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |
| `pnpm test:integration worker/enrich` | 종료 코드 0 — 파일 1개, **24건** |
| `vitest run --config vitest.integration.config.ts packages/bus` | 종료 코드 0 — 36건 (두 어댑터가 같은 계약 통과) |
| `pnpm test:integration` (전량) | **파일 15개 통과 / 3개 실패** — 실패 3개는 모두 `packages/es`이며 원인은 이 환경에 Elasticsearch가 없어서다(`ECONNREFUSED 127.0.0.1:9200`). 통과 125건, 건너뜀 18건 |

**Elasticsearch 통합 시험 3종은 실행하지 못했다.** 이 컨테이너에는 Docker 데몬이 없어 `docker compose up`으로 ES를 띄울 수 없다. WP-003 범위이고 WP-007이 건드리지 않는 코드지만, "통합 스위트 전량 통과"라고 적을 수는 없으므로 있는 그대로 남긴다. CI의 `integration` 잡은 ES 서비스 컨테이너를 띄우므로 거기서 돈다.

**실제 GHE 대상 검증은 하지 않았다 — NOT RUN.** 이 환경에 GitHub App 자격 증명이 없다. `smoke-real-ghe.test.ts`는 자격 증명이 있으면 자동으로 돌고 없으면 건너뛰되 그 사실을 실행 로그에 남긴다. WP-007의 검증 방법은 목 서버 기반 통합 시험이라 DoD 판정에는 영향이 없지만, **REL-001 운영 readiness 전 게이트**로 8장에 그대로 둔다.

**구현 중 발견해 고친 결함 하나 (Redis 어댑터).**

`RedisStreamsEventBus`가 재시도·유예 상태를 **스트림 엔트리 ID만으로** 식별하고 있었다. Redis 스트림 ID는 `<밀리초>-<일련번호>`라 스트림 안에서만 유일하고, 같은 밀리초에 서로 다른 파티션 스트림에 하나씩 들어가면 둘 다 `…-0`이 된다. 그래서 한 파티션에서 `defer`한 이벤트가 다른 파티션의 무관한 이벤트를 함께 묶어 **그 파티션을 통째로 멈췄다**. CR-010 계약 시험("유예 중인 파티션이 다른 파티션을 막지 않는다")이 잡았고, 상태 열쇠를 `(스트림, 메시지 ID)`로 바꿔 고쳤다. 파티션 16개로 도는 운영에서는 드문 일이 아니다.

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 일부러 망가뜨려 보고 해당 시험이 실패하는지 봤다 — (1) rate limit을 `defer` 대신 `retry`로 처리 → 3건 실패, (2) 절삭 판정을 배열 길이로 추측 → 1건 실패, (3) 404를 즉시 종료로 보지 않음 → 2건 실패. 세 변형 모두 되돌린 뒤 전량 통과를 다시 확인했다.

### 6.8 WP-008 검증 실행 기록

DoD 8항 전부 통과. 검증 방법은 `pnpm test:integration worker/project`다 (파일 1개, 14건).

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 오래된 `document_version` 갱신이 새 상태를 덮어쓰지 않는다 (AC-1) | 통과 | 나중 웹훅(12:00)을 먼저 색인하고 이전 웹훅(11:00)을 뒤에 넣어도 문서는 나중 상태로 남고 `document_version`도 12:00이다. 아무것도 바뀌지 않았으므로 `EVT-ING-003`도 나가지 않는다 |
| 같은 이벤트를 두 번 처리해도 문서가 하나다 (FR-ING-002 AC-5) | 통과 | 같은 `delivery_id`를 두 번 처리한 뒤 `pr_number` 질의 결과가 1건. 결정론적 ID `{repository_id}:{pr_number}`가 근거다 |
| 여러 인덱스 갱신이 벌크 1건으로 전송된다 (AC-2) | 통과 | `client.bulk` 호출을 프록시로 세어 1회. 그 한 번으로 `prs-pull-requests`와 `prs-commits`가 함께 갱신됐다 |
| 벌크 부분 실패 항목이 개별 재시도된다 (AC-3) | 통과 | 마지막 문서를 **실제로 보내지 않고** 429로 보고하게 만든 뒤, `client.update`가 정확히 1회 불리고 그 문서가 색인된다. 응답만 조작하면 이미 색인돼 있어 재시도가 무엇을 고쳤는지 알 수 없어 그렇게 짰다 |
| 수신부터 검색 반영까지 p95 10초 이하다 (AC-5) | 통과 (개발 데이터셋) | 수신 시각을 현재로 둔 이벤트 20건을 처리해 `ingestion_lag_seconds`의 10초 버킷에 20건 전부가 들어갔다. **운영 규모 측정이 아니다** — REL-001 성능 게이트가 따로 본다 |
| 매핑에 없는 필드를 넣으려 하면 색인이 거부되고 DLQ로 간다 (THR-010) | 통과 | 화이트리스트가 뚫린 상황을 프록시로 만들어(`source_patch` 주입) 실제 클러스터가 `strict_dynamic_mapping_exception`으로 막는 것을 확인했다. 워커는 재시도 없이 `dead_letter`로 가고 `processed_at`도 찍지 않는다 |
| 커밋이 두 PR에 속해도 `pull_request_numbers`가 합집합으로 남는다 (CR-011) | 통과 | 두 PR이 같은 원본 커밋을 참조하면 `[1234, 5678]`. 오래된 이벤트가 나중에 도착한 경우에도 합집합이 유지된다 — 소속은 버전 비교의 대상이 아니기 때문이다 |
| 미등록 저장소 이벤트는 문서를 만들지 않고 실패로도 세지 않는다 (FR-ING-009 AC-4) | 통과 | `repository` 행이 없으면 ack하고 `repository_unregistered`를 남긴다. 실패 대기열은 비어 있고 인덱스에도 문서가 없다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 파일 23개, **195건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |
| `pnpm test:integration worker/project` | 종료 코드 0 — 파일 1개, **14건** |
| `pnpm test:integration` (전량) | 종료 코드 0 — 파일 **19개 전부 통과, 158건**. Elasticsearch 계열 포함 |

**Elasticsearch 통합 시험을 이 환경에서 처음으로 실제로 돌렸다 (DEV-008 해소).** `docker.elastic.co`와 Docker Hub 블롭 호스트는 여전히 403이지만 `mirror.gcr.io/library/elasticsearch:8.19.0`이 이그레스 정책을 통과한다. CI와 같은 8.19.0을 띄워 `packages/es` 19건과 투영 14건을 모두 실행했다. 이미지 태그나 compose 정의는 바꾸지 않았다 — 로컬 검증 경로일 뿐이다.

**그 덕에 결함 하나가 드러났다 (DEV-021).** WP-003 부트스트랩이 별칭에 `routing: 'repository_id'`를 걸고 있었다. 별칭의 `routing`은 필드 이름이 아니라 **고정 라우팅 값**이라, 전 문서가 문자열 하나의 샤드로 몰리고 문서별 `_routing`을 준 요청은 `illegal_argument_exception`으로 거부된다 — ADR-003의 샤딩 설계가 정반대로 뒤집혀 있었다. 투영의 첫 색인이 통째로 실패하면서 잡혔다. WP-003의 DoD 시험이 그 잘못된 값을 **기대값으로 못 박고** 있었던 것이 더 문제였다: 별칭 메타데이터만 확인하고 문서를 실제로 색인해 보지 않았다. 시험을 "고정 라우팅이 없다" + "문서별 라우팅으로 색인하고 되찾는다"로 바꿨다.

**실제 GHE 대상 검증은 여전히 하지 않았다 — NOT RUN.** WP-008은 GitHub API를 부르지 않으므로(`EVT-ING-002`가 self-contained, CR-010 DEV-013) 이 WP의 DoD와는 무관하다. **REL-001 운영 readiness 전 게이트**로 8장에 그대로 둔다.

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 하나씩 망가뜨려 보고 해당 시험이 실패하는지 봤다 — (1) 버전 가드 제거(항상 대입) → 통합 1건 실패, (2) 합집합을 단순 대입으로 → 통합 3건 실패, (3) 부분 실패를 벌크 전체 재시도로 → 통합 1건 실패, (4) 미등록 저장소도 투영 → 통합 1건 실패, (5) 매핑 거부를 재시도 가능으로 → **통합은 전량 통과, 단위 1건 실패**. (5)는 통합 스위트가 못 잡는다 — ES가 그 오류를 400으로 주고 400은 유형과 무관하게 이미 `rejected`이기 때문이다. 5xx로 오는 경우를 단위 시험이 따로 고정하고 있어 그것이 잡았다. 다섯 변형 모두 되돌린 뒤 전량 통과를 다시 확인했다.

### 6.9 WP-009 검증 실행 기록

DoD 6항 전부 통과. 검증 방법은 `pnpm test:integration ops/dead-letter`다 (파일 1개, 20건).

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 재시도 5회 소진 이벤트가 사유와 함께 DLQ에 저장된다 (AC-2) | 통과 | 목록 응답이 `delivery_id`·`stage`·`error`·`retry_count`·`reprocess_count`·`state`·`repository_id`를 그대로 돌려준다. 기록 자체는 WP-007·WP-008의 워커 시험이 만든다 |
| 개별·일괄 재처리가 동작한다 (AC-3) | 통과 | 개별 1건과 일괄 3건 모두 `prs:ingest` 스트림에 실제로 들어간다. 봉투를 목이 아니라 Redis에서 `xrange`로 직접 읽어 확인했다 |
| 재처리가 중복 문서를 만들지 않는다 (AC-4) | 통과 | 같은 항목을 두 번 재처리하면 봉투 `event_id`는 둘이지만 payload의 `delivery_id`는 같다. 소비자의 멱등 기준이 그것이며(EVT-ING-001), 문서가 하나로 남는다는 것은 WP-008의 결정론적 ID 시험이 증명한다 |
| 3회 재처리 실패 이벤트가 `held`로 전환된다 (예외 처리) | 통과 | `reprocess_count`가 1·2·3으로 오르고 세 번째에 `held`가 된다. **행은 내내 하나다** — 그것이 성립해야 누적이 뜻을 갖는다 |
| 100건 초과 시 경보 메트릭이 임계를 넘는다 (AC-5) | 통과 | 101건을 넣고 `GET /metrics`가 `dead_letter_total{state="pending"} 101`과 `dead_letter_open_total 101`을 낸다. `resolved`는 임계를 잠식하지 않는다 |
| 일괄 재처리 100건 초과 시 재확인이 요구된다 (QA-A001-05) | 통과 | 101건 대상에서 확인 없음·틀린 값 모두 400 `CONFIRMATION_MISMATCH`, 정확한 값에서만 202. 경계는 정확히 100이며 100건은 확인 없이 지나간다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 파일 23개, **195건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |
| `pnpm test:integration ops/dead-letter` | 종료 코드 0 — 파일 1개, **20건** |
| `pnpm test:integration` (전량) | 종료 코드 0 — 파일 **21개 전부 통과, 191건** |

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 하나씩 망가뜨려 보고 해당 시험이 실패하는지 봤다 — (1) 업서트를 단순 INSERT로 → 통합 12건 실패, (2) 충돌마다 `reprocess_count` 증가 → 3건 실패, (3) 필터 선택에 `held` 포함 → 1건 실패, (4) 확인 임계를 `>=`로(경계 오차) → 1건 실패, (5) 발행 실패해도 표시를 되돌리지 않음 → 1건 실패, (6) 경보 게이지에 `resolved` 포함 → 1건 실패. **여섯 변형 모두 잡혔다.** 되돌린 뒤 전량 통과를 다시 확인했다.

**한 가지는 시험으로 고정하지 못했다.** "표시가 발행보다 먼저"라는 순서는 프로세스가 그 사이에 죽었을 때만 차이가 드러난다. 순서를 바꿔도 통합 스위트는 전량 통과한다 — 관측 가능한 차이가 없기 때문이다. 코드 주석으로 이유를 남겼고, 크래시 주입 시험은 이 WP의 범위 밖으로 두었다.

**실제 GHE 대상 검증은 여전히 하지 않았다 — NOT RUN.** WP-009는 GitHub API를 부르지 않으므로 이 WP의 DoD와는 무관하다. **REL-001 운영 readiness 전 게이트**로 8장에 그대로 둔다.

### 6.10 WP-010 검증 실행 기록

DoD 6항 전부 통과. 검증 방법은 `pnpm test:integration admin/repositories`(19건)와 `pnpm test:integration ops/pipeline-status`(11건)다 (CR-013, DEV-032 — `test:e2e` 스크립트가 없고 이 WP는 화면을 만들지 않기로 결정되어 API 수준으로 대체했다).

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 대상 브랜치 11개 등록 시 400 `BRANCH_LIMIT_EXCEEDED` (FR-ING-009 AC-2) | 통과 | 11개는 거절되고 행도 생기지 않는다. **중복을 접은 뒤에** 세므로 `main`을 두 번 적어도 2개로 세지 않는다 |
| 해제 후에도 기존 문서가 조회된다 (AC-3) | 통과 | 행도 문서도 남고 `repository_archived: true`만 붙는다. 재등록하면 풀린다 |
| 미등록 저장소 이벤트가 `raw_event`에는 있고 ES에는 없다 (AC-4) | 통과 | WP-008이 이미 구현했고(DEV-020) 투영 시험이 지킨다. 이 WP는 그 저장소를 **등록할 길**을 열었다 |
| 접근 권한 없는 저장소 등록이 403으로 거부된다 (예외 처리) | 통과 | 403과 `detail.required_permissions`. 404와 403을 구분하지 않는다 — GitHub이 권한 없는 저장소를 404로 감추므로 구분하려는 시도가 추측이 된다 |
| 파이프라인 상태 응답의 데이터 신선도가 30초 이내다 (FR-ADMIN-001 AC-2) | 통과 | 캐시하지 않는다. 행을 넣고 곧바로 다시 물으면 값이 따라 움직인다 — 30초가 아니라 요청 시점이다 |
| 등록·해제가 감사 기록에 남는다 (AC-5) | 통과 | 등록·변경·해제 셋 다 남고 주체는 `admin:alice`다. **거절된 등록도 남는다.** 인증 실패는 남기지 않는다 — 그것은 관리자의 행위가 아니다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 12개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — **214건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |
| `pnpm test:integration admin/repositories` | 종료 코드 0 — 파일 1개, **19건** |
| `pnpm test:integration ops/pipeline-status` | 종료 코드 0 — 파일 1개, **11건** |
| `pnpm test:integration` (전량) | 종료 코드 0 — 파일 **24개 전부 통과, 230건** |

**시험이 실제로 무엇을 잡는지 확인했다.** 등록 로직을 하나씩 망가뜨려 봤다 — (1) 클라이언트가 보낸 `org_id`를 믿는다 → 1건 실패, (2) 중복을 접기 전에 브랜치를 센다 → 1건, (3) 재등록해도 문서 표식을 풀지 않는다 → 1건, (4) 해제할 때 행을 지운다 → 3건, (5) PATCH가 가시성도 바꾼다 → 1건. **다섯 변형 모두 잡혔다.**

**DEV-028은 실제 Elasticsearch가 아니었으면 못 찾았다.** 커밋 매핑에 `repository_archived`가 없는 상태로 표식을 붙이려 하면 `strict_dynamic_mapping_exception`이 난다. 그 과정에서 두 번째 결함(DEV-034)도 드러났다 — 부트스트랩이 이미 있는 인덱스를 전혀 건드리지 않아, 매핑에 필드를 더해도 떠 있는 인덱스는 모르는 채로 남았다.

**`JobRow.job_id` 타입 거짓말(DEV-027 나머지 절반)을 통합 시험이 짚었다.** 등록 응답이 `backfill_job_id`를 내보내면서 소비자가 생겼고, `Any<String>` 기대가 실패해 정확한 자리를 알려 줬다.

**k8s 매니페스트는 검증되지 않았다.** 이 실행 환경에 Kubernetes도 `kubectl`도 없다. YAML 파싱만 확인했고 클러스터 적용은 **REL-001 프로비저닝 때 해야 한다** — 7장에 한계로 남겼다.

**실제 GHE 대상 검증은 여전히 하지 않았다 — NOT RUN.** 저장소 등록은 GHE를 부르지만(`getRepository`) 이 환경에 App 자격 증명이 없다. 통합 시험은 조회를 좁은 포트로 대체했고, 그 포트 뒤의 실제 클라이언트는 `@prs/github`의 목 GHES 계약 시험이 덮는다. **REL-001 운영 readiness 전 게이트**로 8장에 그대로 둔다.

### 6.11 WP-011 검증 실행 기록

DoD 7항 전부 통과. 검증 방법은 `pnpm test query`다.

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 지원 키 15종이 모두 파싱된다 (AC-1) | 통과 | 목록을 SRS와 대조하고 15종 각각을 파싱한다. 목록이 늘거나 줄면 시험이 먼저 깨진다 |
| `seq:1200..1350`이 범위 필터가 된다 (AC-2) | 통과 | `{ key: 'seq', op: 'range', from: 1200, to: 1350 }` |
| `merged:2026-08-10..2026-08-19`가 시각 범위가 된다 (AC-3) | 통과 | 입력 문자열을 그대로 둔다. 자정으로 펴는 것은 시간대 해석이라 WP-013의 몫이다 |
| 미지원 키가 오프셋과 지원 키 목록을 포함한 오류를 낸다 (AC-4) | 통과 | `input.slice(offset_start, offset_end)`가 문제 토큰과 정확히 같다. 앞에 공백이 있든 `-`가 붙든 그렇다 |
| 같은 키 반복이 OR, 다른 키가 AND로 결합된다 (AC-5) | 통과 | 같은 (키, op)가 한 노드의 `values`로 모인다. **긍정과 부정은 서로 다른 노드다** — 한 노드에 모으면 OR과 AND가 섞여 뜻이 무너진다 |
| `-author:kim`이 부정 조건이 된다 (AC-6) | 통과 | `not_eq`. 범위에도 붙어 `not_range`가 된다 (CR-014, DEV-035) |
| 파싱 → 직렬화 → 재파싱 왕복이 동일 AST를 만든다 | 통과 | 질의 17종 전부에 걸었다. 문자열도 두 번째 직렬화부터 고정된다 — URL이 이유 없이 바뀌지 않는다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 12개, 위반 0건 |
| `pnpm test query` | 종료 코드 0 — 파일 3개, **95건**. `@prs/query` 88건에 더해 이름이 겹치는 `packages/es/src/scoped-query.test.ts` 7건이 함께 걸린다 |
| `pnpm test` (전량) | 종료 코드 0 — **302건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 하나씩 망가뜨려 봤다 — (1) 긍정과 부정을 한 노드로 → 1건 실패, (2) 아무 키에나 범위 허용 → 4건, (3) `is` 값 검증 생략 → 5건, (4) `state` 값도 검증 → 5건, (5) `-`로 시작하는 값을 묶지 않음 → 6건, (6) 직렬화가 필터를 정렬 → 9건. **여섯 변형 모두 잡혔다.**

**시험이 결함 둘을 먼저 잡았다.** `Date.parse('2026-02-30')`이 3월 2일로 넘어가 유효한 날짜로 통과했고, 그 뒤 범위 비교가 "뒤집혔다"는 엉뚱한 이유로 거절했다 — 사용자는 왜 거절당했는지 알 수 없다. 달력 검사를 따로 넣어 고쳤다. 또 하나는 시험 쪽 오해였다: `foo bar:baz`를 통째로 검색어로 볼 것이라 가정했는데, 토큰은 공백으로 먼저 갈리므로 `bar:baz`는 키로 읽히고 AC-4대로 거절되는 것이 맞다. `fix: 결제 오류`처럼 콜론이 든 검색어는 따옴표로 묶어야 한다는 사실을 시험으로 못 박았다.

**통합 시험이 없다.** 이 패키지는 백킹 서비스에 붙지 않는다 — 순수 함수뿐이라 단위 시험이 곧 계약 시험이다.

### 6.12 WP-012 검증 실행 기록

DoD 10항 중 9항 통과, 1항 부분. 검증 방법은 `pnpm test:integration authz`와 `pnpm test authz/architecture`다.

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 미인증 요청이 OIDC로 리다이렉트된다 (AC-1) | **부분** | API 계층까지다 — 401 + `detail.login_path`를 돌려주고 `enforcement.test.ts`가 확인한다. **브라우저 302는 `web` 라우트라 WP-015가 세운다** (인프라 문서의 아웃바운드 허용 목록이 IdP를 `web`에만 연다). 인가 URL 생성·PKCE·토큰 교환·ID 토큰 검증은 이 WP가 라이브러리로 세웠고 시험도 있다 |
| 세션 쿠키가 HttpOnly·Secure·SameSite=Lax다 (AC-2) | 통과 | `serializeSessionCookie`가 셋을 모두 달고 `__Host-` 접두의 조건(`Path=/`, `Domain` 없음)도 맞춘다. 운영에서 `SESSION_COOKIE_SECURE=false`면 **기동을 거부한다** |
| 유휴 8시간·절대 12시간 만료가 동작한다 (AC-3) | 통과 | 1시간 간격으로 11번 활동해도 12시간에서 끊긴다. 저장소 TTL을 인위적으로 늘려도 읽는 즉시 지운다 — 판정을 Redis TTL에만 맡기지 않는다 |
| 접근 범위 밖 문서가 목록·건수·집계 어디에도 없다 (AC-5) | 통과 | 실제 Elasticsearch에 fixture 4건을 넣고 확인했다. 사용자 질의를 `should`로 넓히려 해도 `must` 안에 갇힌다 |
| 접근 범위 밖 문서 직접 조회가 404다 (AC-4) | 통과 | ID를 알아도 0건이고, API 계층이 그 0건을 404로 옮긴다. 403이면 존재가 샌다 (THR-004) |
| 접근 범위 조회 실패 시 부분 결과 없이 503이다 (AC-3) | 통과 | `/me`가 503 `PERMISSION_UNAVAILABLE`. 낡은 캐시가 남아 있어도 쓰지 않는다 — 행이 남아 있음을 확인하는 시험을 따로 두었다 |
| 500개 초과 시 `org_team`으로 전환되고 두 모드의 결과 집합이 같다 (AC-6) | 통과 | 500개는 `explicit`, 501개부터 `org_team`. 실제 ES에서 두 모드의 문서 집합이 같음을 확인했다 — 넓지도 좁지도 않다 |
| 권한 회수 이벤트 후 첫 요청부터 차단된다 (AC-4) | 통과 | `/me`의 저장소 수가 무효화 직후 줄어든다. **갱신 중에 회수가 끼어들어도 회수 이전 범위가 되살아나지 않는다** — `access_scope_version` 울타리가 SQL 조건절에 있다 (DEV-044) |
| `applyMandatoryScopeFilter`를 우회하는 코드가 컴파일되지 않는다 | 통과 | 타입이 막고, 아키텍처 테스트가 타입이 못 막는 둘(`client.search` 직접 호출, `as ScopedQuery` 캐스팅)을 소스에서 찾는다. 검사기 자신이 동작하는지도 함께 건다 |
| 권한 매트릭스 테스트의 API 계층 부분이 통과한다 (NFR-005) | 통과 | 역할 6종 × (`operator` 필요 경로, `security_officer` 필요 경로). 화면 13종은 WP-015 이후다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 13개, 위반 0건 |
| `pnpm test` (전량) | 종료 코드 0 — **484건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm test:integration` (전량) | 종료 코드 0 — **279건** |
| WP-012 몫만: 단위 175건 (파일 10개), 통합 47건 (파일 3개) | 종료 코드 0 |
| `pnpm build` | 종료 코드 0 |

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 17가지로 망가뜨렸다 — (1) `nonce` 검증 제거, (2) `aud` 검증 제거, (3) 만료 캐시 사용 허용, (4) `access_scope_version` 울타리 제거, (5) 범위 필터를 `must` 대신 `should`로 결합, (6) IdP 그룹으로 `operator` 부여 허용, (7) `search-api`가 `X-User-Id` 헤더 신뢰, (8) 접근 범위 밖을 403으로, (9) 절대 만료 무시, (10) `team` 이벤트 발행 생략, (11) `BIGINT[]` 파서 제거, (12) `org_team` 임계를 5000으로, (13) 동시 갱신 상한 제거, (14) 아키텍처 테스트를 우회하는 직접 조회 추가, (15) 무효화 순서 뒤집기, (16) `scope_kind`를 늘 `explicit`으로, (17) `/me`에 저장소 ID 목록 싣기. **열일곱 전부 잡혔다.**

**시험이 결함 하나를 먼저 잡았다 (DEV-050).** 통합 시험이 접근 범위를 `["101"]`로 돌려받았다 — `BIGINT[]`은 스칼라와 다른 OID(`_int8` = 1016)라 DEV-027의 파서가 닿지 않았다. `permission_cache.repository_ids`가 이 저장소의 첫 `BIGINT[]` 열이라 여기서 드러났다. 그대로 두면 필수 접근 범위 필터의 `terms` 절이 문자열을 싣는다.

**아키텍처 테스트가 미해소 항목 하나를 드러냈다 (DEV-051).** API-ADM-006의 운영 집계 두 곳이 접근 범위를 거치지 않는다. **동작을 바꾸지 않았다** — FR-ADMIN-001 AC-1·AC-3이 그 값을 요구하고 THR-003·THR-016이 반대를 요구하는, 승인된 문서 사이의 모순이기 때문이다. 사유 붙은 허용 목록에 등록해 다음 전역 집계가 조용히 들어오지 못하게 했고, 해소는 별도 CR과 사용자 결정으로 남긴다.

**시험이 확인하지 못한 것.** 실제 사내 IdP와의 OIDC 왕복은 **NOT RUN**이다 — IdP 자격 증명이 없다. ID 토큰 검증은 테스트가 생성한 RSA 키쌍으로 다섯 검사를 각각 무너뜨려 확인했으나, 실제 IdP의 클레임 이름(특히 그룹 클레임)과 JWKS 회전 동작은 REL-002 게이트에서 확인해야 한다.

### 6.13 WP-013 검증 실행 기록

DoD 7항 중 6항 통과, 1항 **NOT RUN**. 검증 방법은 `pnpm test:integration search`와 `pnpm test es`다.

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 필터 12종이 AND로 결합된다 (FR-SRCH-006 AC-1) | 통과 | 12종이 `filter` 배열에 나란히 놓인다. 실제 인덱스에서 조건을 더할수록 결과가 좁아지는 것까지 확인했다 — 모양이 맞아도 필드 이름이 어긋나면 아무것도 거르지 못한다 |
| 같은 필드 다중 값이 OR로 결합된다 (AC-2) | 통과 | 같은 키의 값들이 `terms` 하나로 묶인다. 긍정과 부정이 섞이면 `filter`와 `must_not`으로 갈라진다 (AC-6) |
| 0건일 때 완화 후보가 반환된다 (AC-3) | 통과 | `msearch` **1회**, 후보 상한 8개, 절삭 시 `relaxation_hints_truncated`. 많이 나오는 후보가 먼저 온다. 빼도 0건인 필터는 후보가 아니다. 필터가 하나뿐이면 계산하지 않는다 |
| 정렬 키 8종이 동작하고 미지원 키는 400이다 (FR-SRCH-007 AC-1, AC-3) | 통과 | 8종 모두 정렬 절을 만든다. 목록 밖 키는 **ES를 부르기 전에** 400 `INVALID_PARAMETER`이고 응답에 지원 키 목록을 싣는다 |
| 동일 조건 두 번 조회 시 순서가 동일하다 (AC-4) | 통과 | 모든 정렬이 문서 ID로 끝난다. 같은 질의를 3회 던져 항목 순서가 동일함을 실제 인덱스에서 확인했다 |
| 목록 조회 p95가 500ms 이하다 (NFR-001) — 1000만 문서 합성 데이터셋 | **NOT RUN** | 데이터셋도 `pnpm test:perf` 스크립트도 이 환경에 없다 (DEV-058, DEV-032와 같은 형태). **측정하지 않은 것을 통과로 적지 않는다.** 예산을 지키는 구조(완화 힌트 왕복 1회 고정, `track_total_hits` 상한, ES 마감 3초)만 시험으로 고정했다 |
| API 계약의 `/search` 응답 예시와 실제 응답 스키마가 일치한다 | 통과 | 최상위 키 7종을 확인했다. `next_cursor`는 **항상 `null`로 실린다**(키가 있고 값이 없다 = 다음 페이지 없음), `facets`는 **키 자체를 넣지 않는다**(빈 객체는 "세었는데 없다"로 읽힌다) — CR-016 DEV-057 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 13개, 위반 0건 |
| `pnpm test` (전량) | 종료 코드 0 — **550건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm test:integration` (전량) | 종료 코드 0 — **325건** |
| WP-013 몫만: 단위 66건 (파일 3개 + `upsert.test.ts` 3건), 통합 46건 | 종료 코드 0 |
| `pnpm build` | 종료 코드 0 |

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 26가지로 망가뜨렸다 — (1) 다른 키를 AND 대신 OR로, (2) 같은 키에서 첫 값만 사용, (3) 부정을 긍정으로, (4) 못 찾은 이름의 필터를 조용히 버림, (5) 미해석 이름을 응답에서 생략, (6) 경로 접두를 `match`+`operator:and`로, (7) 경로 접두를 `.raw` `prefix`로, (8) `is:reverted`를 엉뚱한 필드로, (9) 정렬에서 동점 처리 키 제거, (10) 동점 처리를 `_doc`으로, (11) 기본 정렬의 둘째 단 제거, (12) `missing`을 `_first`로, (13) `unmapped_type` 제거, (14) 샤드 부분 실패 검사 무력화, (15) 서비스가 샤드 검사를 호출하지 않음, (16) `upsert`가 `doc_id`를 넣지 않음, (16b) 생성 본문에만 넣고 스크립트에는 넣지 않음, (17) 검색이 강제 범위 필터를 건너뜀, (18) **완화 힌트가 강제 범위 필터를 건너뜀**, (19) 잘못된 정렬 키를 조용히 기본값으로, (20) `size` 상한 제거, (21) `size` 하한 검사 제거. **처음 20가지 중 16가지가 잡혔고 4가지가 살아남았다.** 살아남은 넷((15)·(16)·(18)·(20))은 그대로 **시험의 구멍**이므로 시험을 더해 막았고, 다시 돌려 26가지 전부가 잡히는 것을 확인했다.

**살아남은 변이 중 하나는 접근 범위 누출이었다 (18).** 완화 힌트 계산은 건수만 돌려주지만 그 건수도 정보다 — 범위 밖 문서를 세면 "이 조건을 빼면 1건이 나옵니다"가 볼 수 없는 문서의 **존재**를 알려 준다 (THR-004와 같은 형태). 구현은 처음부터 옳았으나 **그것을 확인하는 시험이 없었다.** 범위 밖 저장소 fixture로 힌트가 그 문서를 세지 않음을 확인하는 통합 시험을 더했다.

**타입 시스템이 막지 못하는 우회가 하나 더 있다.** (17)·(18)의 변이는 `as unknown as ReturnType<typeof applyMandatoryScopeFilter>`로 브랜드를 위조했고, 아키텍처 테스트의 `as ScopedQuery` 탐지에 걸리지 않았다. 둘 다 **동작 시험**이 잡았다(범위 밖 문서가 결과·힌트에 나타난다). 캐스팅 표기를 모두 열거하는 대신 결과 집합을 보는 시험을 방어선으로 삼는다 — 표기는 무한하고 결과는 하나다.

**시험이 결함 하나를 먼저 잡았다.** 경로 접두 필터를 처음에 `match`로, 다음에 `match`+`operator: 'and'`로 썼는데 **둘 다 형제 디렉터리를 걸러내지 못했다.** ES `_analyze`로 확인하니 `path_hierarchy`가 `src`와 `src/pay`를 **같은 position 0**에 쌓는다 — 같은 위치의 토큰은 동의어로 취급되어 `operator: and`가 OR로 무너진다. 세 후보(`match`+and, `.raw` `prefix`, `term`)를 실제 문서 셋에 재어 `term`만이 옳음을 확인하고, `src/payments/list.ts`를 영구 회귀 fixture로 남겼다.

**통합 시험 사이의 오염을 하나 고쳤다.** `packages/authz/integration/scope.test.ts`가 `team` 테이블을 비우지 않아, `team`에 쓰는 두 번째 파일이 생기자 `UNIQUE (org_id, slug)`에 걸렸다. 통합 파일은 한 데이터베이스를 나눠 쓰므로 각자 자기 전제를 세우도록 고쳤다 — 남의 파일이 치우고 갔기를 기대하지 않는다.

**시험이 확인하지 못한 것.** NFR-001의 p95는 **NOT RUN**이다(위 DoD 표). 전문 검색이 없어 `relevance` 정렬은 실질적으로 문서 ID 순이며(DEV-056), 그것이 지금의 계약이다 — 동작하는 척하지 않았다. `allowed_team_ids`가 투영에서 비어 있으므로 `team:` 필터는 통합 시험이 fixture로 넣은 값에 대해서만 검증됐다(7장 한계 참조).

### 6.14 WP-014 검증 실행 기록

DoD 6항 중 4항 통과, 1항 부분, 1항 **NOT RUN**. 검증 방법은 `pnpm test:integration resolve`다.

| DoD | 결과 | 근거 |
| --- | --- | --- |
| QA-W001-01 ~ QA-W001-06이 API 계층에서 통과한다 | 통과 | 40자 SHA·`#N`·`owner/repo#N`·GHE URL·7자 접두가 모두 옳은 문서를 집어 온다. 6자는 **조회 없이** 400이고, 후보 2건이면 자동 이동하지 않고 배열로 낸다. `limit`을 넘으면 절삭 표식이 붙는다 |
| QA-W003-01 ~ QA-W003-05가 통과한다 | **부분 (4/5)** | QA-W003-01·02·04·05는 통과한다 — 역할 판정, AC-4의 PR 필드 전량, 같은 SHA가 PR 둘에 속하는 경우. **QA-W003-03(`direct_push`)은 통과하지 못한다** (DEV-061): 커밋 문서가 PR 이벤트에서만 만들어지고 `push`는 ack 후 버려지므로 직접 푸시 커밋은 **문서 자체가 없어** 404가 된다. 없는 동작을 시험으로 꾸며 통과시키지 않았다 |
| QA-W002-01 ~ QA-W002-03이 통과한다 | 통과 | 머지 커밋과 원본 커밋이 갈라져 나오고, 미머지 PR은 `merge_commit_sha`가 `null`이며, 260건 fixture가 250건으로 잘리고 절삭 표식이 붙는다 |
| 단건 해석 p95가 200ms 이하다 (NFR-001) — 커밋 1000만 건 데이터셋 | **NOT RUN** | 데이터셋도 `pnpm test:perf` 스크립트도 이 환경에 없다 (DEV-058, WP-013과 같은 형태). **측정하지 않은 것을 통과로 적지 않는다.** 예산을 지키는 구조(40자는 `term`, 접두는 `prefix`, 폴백은 커밋을 못 찾았을 때만, ES 마감 3초)만 시험으로 고정했다 |
| 7자 접두 질의가 통상 후보 1건으로 좁혀진다 (ADR-012 근거 검증) | 통과 (규모 미달) | 접두가 겹치는 fixture 둘을 일부러 넣어 **접두가 겹치면 후보가 여럿 나온다**는 것과, 겹치지 않으면 1건이라는 것을 함께 확인했다. 다만 ADR-012의 근거는 *5000만 커밋에서도 통상 1건*이며 그 규모는 이 환경에서 재현하지 못했다 — 성능 게이트에서 함께 본다 |
| API 계약의 응답 예시 3종과 실제 응답이 일치한다 | 통과 | 세 응답의 최상위 키를 확인했다. CR-017이 계약의 예시를 **실제 채워지는 필드로 줄인 뒤**의 일치다 — 계약을 고치지 않았다면 이 항목은 실패했을 것이다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 13개, 위반 0건 |
| `pnpm test` (전량) | 종료 코드 0 — **611건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm test:integration` (전량) | 종료 코드 0 — **378건** |
| WP-014 몫만: 단위 61건 (판별 48 + 질의 모양 11 + 설정 2), 통합 53건 | 종료 코드 0 |
| `pnpm build` | 종료 코드 0 |

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 35가지로 망가뜨렸다 — 판별(길이 경계, 대소문자, 호스트 비교, 우선순위 목록, PR 번호 상한, 릴리스 태그 추측), 질의(40자를 `prefix`로, 접두를 `term`으로, 저장소 조건 제거, 폴백 필드 축소), 접근 범위(해석·상세·조인 각각의 강제 필터 우회), 절삭(접두 상한, 250건 상한, 총계 표기), 라우트(400 생략, 404를 403으로, 인증 생략), 채워지지 않은 키 채우기.

**처음 28가지 중 22가지가 잡혔고 6가지가 살아남았다.** 살아남은 여섯을 하나씩 확인한 결과 **넷은 진짜 시험 구멍이었고 하나는 동치 변이, 하나는 결과가 같고 비용만 다른 변이**였다.

| 생존 | 판정 | 조치 |
| --- | --- | --- |
| PR 번호 상한 제거 | **시험 구멍** — 40자리 숫자는 `MAX_SAFE_INTEGER`도 넘어 어느 상한을 써도 걸린다. 경계를 실제로 거는 것은 32비트를 넘고 `MAX_SAFE_INTEGER`는 넘지 않는 10~15자리다 | 10·14자리와 상한 ±1을 거는 시험을 더했다 |
| 커밋 상세에서 저장소 조건 제거 | **시험 구멍** — SHA가 한 저장소에만 있으면 조건을 빼도 통과한다 | **같은 SHA를 범위 안 저장소 둘에 넣는 fixture**를 더해 경로의 저장소가 어느 문서를 고르는지 갈랐다 |
| 커밋 → PR 조인의 범위 필터 제거 | **시험 구멍** — `explicit` 범위는 `repository_id` 하나만 보므로 같은 저장소 안에서는 필터를 빼도 차이가 없다 | 이 스위트를 **`org_team` 범위(저장소 500개 초과)로 전환**하고, 범위 필드가 어긋난 PR fixture를 더했다. `explicit` 경로는 `search/list.test.ts`가 계속 덮는다 — 두 모드를 갈라 모두 실제 조회로 확인한다 |
| 없는 값을 `null`로 채우기 | **시험 구멍** — 값이 없는 선택 필드가 실제로 빠지는지 아무도 확인하지 않았다 | 커밋의 `link_summary`, PR의 `labels`·`reviewers`·`merged_at`이 **키째 없음**을 걸었다. `merge_commit_sha`만은 키를 두고 `null`이어야 함도 함께 걸었다 (AC-2) |
| 기준 URL 가드 제거 | **동치 변이** — `hostOf(undefined)`와 `hostOf('')`가 모두 `null`이라 뒤따르는 `expected === null` 검사가 가드를 대신한다. 실측으로 확인했다 | 조치 없음. 가드는 읽기 위해 남긴다 |
| 40자를 `prefix`로 조회 | **결과는 같고 비용만 다르다** — 40자 전체가 접두면 일치하는 term이 하나뿐이다. 그러나 데이터 모델 6장이 그 조회에 잡은 예산은 `term`의 p95 100ms다 | 질의 **모양**을 거는 단위 시험을 더했다. 실측 시험이 없는 지금 그 결정을 지키는 것은 모양 시험뿐이다 |

고친 뒤 다시 돌려 **35가지 전부**(28 + 변이 7)가 잡히는 것을 확인했다. 동치 변이 하나는 잡히지 않는 것이 옳다.

**시험이 결함 하나를 먼저 잡았다.** 접근 범위 누출을 확인하려고 만든 fixture가 **통과해 버렸다** — 범위 필드가 어긋난 PR이 그대로 나왔다. 원인은 구현이 아니라 시험 설계였다: `explicit` 범위는 `repository_id`만 보므로 같은 저장소 안의 문서는 범위 필드가 무엇이든 통과한다. 이것을 "구현이 틀렸다"로 읽지 않고 **`org_team` 범위에서만 관찰 가능한 불변식**임을 확인한 뒤 스위트를 그쪽으로 옮겼다.

**CI가 결함 하나를 더 잡았다 — 이 WP의 코드가 아니라 시험의 것이다.** `enforcement.test.ts`의 DEV-040 시험이 `expect(body).not.toContain('101')`로 **응답 본문 전체를 부분 문자열 검사**하고 있었다. 그런데 응답에는 `correlation_id`(임의 UUID)가 들어 있어 그 16진수 안에 `101`이 우연히 들어가면 코드가 옳아도 깨진다 — CI에서 `…784d1011edac`가 나와 실제로 깨졌다. UUID의 창 22개 × (1/16)^3 ≈ **0.5%**다.

로컬에서 378건이 전부 통과했는데 CI만 깨진 것이 단서였다. "flake"로 넘기지 않고 실제 응답 본문을 로그에서 꺼내 `101`이 어디에 있는지 찾았다 — 예상했던 `refreshed_at` 타임스탬프가 아니라 UUID였다. **WP-012가 남긴 결함이며 이 WP의 변경이 만든 것이 아니다.** 다만 우연에 흔들리는 시험을 그대로 두면 누구의 PR에서든 0.5%로 계속 깨지므로 여기서 고쳤다.

고친 방향은 약화가 아니라 강화다. 부분 문자열 대신 **허용된 키 집합 자체를 고정**하고(`scope_kind`·`repository_count`·`org_count`·`team_count`·`refreshed_at`) 요약 값에 배열이 없음을 건다. DEV-040이 정한 것은 "요약만 싣는다"이지 "어떤 숫자도 나타나지 않는다"가 아니다. `/me`가 `repository_ids`를 싣도록 망가뜨려 새 어설션이 실제로 잡는 것을 확인했다.

**시험이 확인하지 못한 것.** NFR-001의 단건 p95는 **NOT RUN**이다(위 DoD 표). ADR-012의 "5000만 커밋에서도 7자 접두는 통상 1건" 근거도 그 규모를 재현하지 못해 **확인하지 못했다** — 접두가 겹칠 때 후보가 여럿 나온다는 동작만 확인했다. 둘 다 REL-002 성능 게이트의 몫이다.

### 6.15 WP-015 검증 실행 기록

DoD 6항 중 4항 통과, 2항 부분. 검증 방법은 `pnpm test web/lib`, `pnpm test:a11y shell`, `pnpm test:e2e auth`다 — **세 스크립트가 이 WP에서 처음 존재하게 됐다** (DEV-032 / DEV-069).

| DoD | 결과 | 근거 |
| --- | --- | --- |
| QA-COMMON 10항이 통과한다 (01·06·07·09·11·12·14·16·17·18) | **부분 (7/10)** | **통과**: 06(키보드 도달 — 스킵 링크가 첫 탭, `⌘K`, 좁은 화면 내비 버튼), 07(서랍이 `Escape`로 닫히고 **포커스가 트리거로 복귀**), 11(axe 위반 0건), 12(`checkContrast` 라이트·다크 80쌍 실패 0건), 16(리터럴 색상 0건 — 정적 시험이 강제), 17(Conductor 외 UI 의존성 0건 — 정적 시험이 강제), 18(`return_to` 왕복과 콜백의 재무해화). **부분**: 01·09·14는 **셸이 소유한 부분까지만**이다 — 화면이 없으므로 IA 진입 경로표 전체(01), 화면 상태 URL 재현 전체(09), 식별자 고정폭 표시(14)는 WP-016 이후에 완성된다. 없는 화면을 통과로 적지 않았다 |
| `operator`가 아닌 역할에게 운영 내비게이션이 렌더링되지 않는다 (QA-A001-10) | 통과 | 판정을 렌더링에서 떼어 `lib/nav.ts`에 두고 역할 6종 전부를 단위로 건다. DOM에도 **비활성으로조차 나타나지 않음**을 a11y 시험이 확인한다 — 비활성 항목은 "여기에 운영 콘솔이 있다"를 알려 준다 |
| `⌘K`/`Ctrl+K`로 옴니 검색에 포커스한다 | 통과 | 셸이 단축키와 슬롯 계약을 소유한다 (DEV-070). `Ctrl`·`Meta` 양쪽, 수식 키 없는 `k`는 가로채지 않음, 슬롯이 비어 있어도 던지지 않음을 건다 — 마지막 것이 WP-016 전까지의 실제 상태다 |
| 세션 만료 후 재인증 시 원래 경로로 복귀한다 (FLOW-000) | **부분** | 왕복 상태(`state`·`nonce`·`codeVerifier`·`returnTo`)의 인코딩·되읽기·쿠키 속성과 `sanitizeReturnPath`의 오픈 리다이렉트 차단은 단위로 건다. 라우트도 서 있다 — `/auth/login?return_to=`, 콜백의 재무해화, 만료 세션의 로그인 리다이렉트. **실제 IdP 왕복은 자격 증명이 없어 NOT RUN이다** (WP-006의 real-GHE smoke와 같은 형태). 지금 경로 보존을 실제로 도는 것은 `/` 하나뿐이다 — 나머지 경로는 그 화면이 생기는 WP에서 붙는다 |
| `query-url` 왕복 테스트가 통과한다 | 통과 | `@prs/query`의 파서를 그대로 쓴다 (ADR-001) — 질의 문자열 → URL → 질의 문자열이 같은 값으로 돌아온다 |
| axe 위반 0건, `checkContrast` 위반 0건 | 통과 | axe: wcag2a/2aa/21a/21aa로 좁혀 셸·EmptyState 5종·ErrorBanner 3종·서랍 열린 상태까지 **위반 0건**. `checkContrast --theme all`: **80쌍 중 0건 실패**. **`color-contrast` axe 규칙은 껐다** — jsdom에는 레이아웃도 canvas도 없어 axe가 실제 색을 계산할 수 없고, 켜 두면 규칙이 조용히 아무것도 검사하지 않으면서 "통과"로 보인다. 대비의 계측기는 `checkContrast`다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 13개, 위반 0건 |
| `pnpm test` (전량) | 종료 코드 0 — **724건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm test:a11y` | 종료 코드 0 — **24건**, axe 위반 0건 |
| `pnpm test:e2e` | 종료 코드 0 — **15건** (실제 Chromium) |
| `pnpm test:contrast` | 종료 코드 0 — 80쌍 중 실패 0건 |
| `pnpm build` | 종료 코드 0 |
| `pnpm test:integration` | **NOT RUN (로컬)** — 이 환경에 Docker가 없어 Postgres·ES·Redis가 서지 않는다. CI의 `integration` 잡이 실제 서비스로 돈다 |

**CI가 셋을 함께 돌게 배선했다.** harness를 만들어 두고 CI가 부르지 않으면 곧 썩는다 — 이 저장소의 다른 시험 계층(`test`·`test:integration`)은 전부 CI에 있다. `verify` 잡의 `build` 뒤에 `test:a11y` → `test:contrast` → `test:e2e` 순으로 붙였다. 브라우저가 필요 없는 둘을 먼저 두어, 거기서 깨지면 Chromium을 받지 않는다.

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 47가지로 망가뜨렸다 — 내비게이션 역할 필터와 경로 판정, 프록시 헤더 허용 목록·세션 쿠키 재조립·경로 이탈·응답 헤더, 세션 판정 네 갈래, OIDC 왕복 쿠키 속성과 되읽기, 라우트의 상태 코드와 재인증 힌트, 로그아웃 메서드와 쿠키 만료, 셸의 포커스 이동·알림·`aria-live`, 단축키의 수식 키 판정, 서랍 버튼과 포커스 복귀, 정적 검사 자체의 무력화.

**43가지가 잡혔고 4가지가 살아남았다.** 넷을 하나씩 확인한 결과 **셋은 진짜 구멍이었고 하나는 동치 변이**였다.

| 생존 | 판정 | 조치 |
| --- | --- | --- |
| `activeNavId`의 최장 일치 폐기 | **검증 불가능한 방어 코드** — `NAV_ENTRIES`에는 서로 접두가 되는 항목이 하나도 없어 그 분기가 **한 번도 실행되지 않는다**. 지금 목록으로는 어떤 단언을 더해도 잡을 수 없다 | 목록을 인자로 받는 `matchNavEntry(pathname, entries)`를 떼어 내고 겹치는 목록으로 직접 걸었다. 나중에 `/ops` 같은 그룹 랜딩 항목이 들어와도 하위 화면 표시가 그룹으로 밀리지 않는다 |
| **세션 저장소가 `null`을 줘도 통과시킨다** | **시험 구멍이자 보안 경계** — e2e 환경에 Redis가 없어 `load`가 늘 던지고, 503(확인할 수 없다)이 401(그런 세션이 없다)을 **가린다.** `위조한 세션 쿠키로도 통과하지 못한다`가 옳은 이유가 아닌 이유로 통과하고 있었다 (DEV-074) | 판정을 순수 함수 `resolveProxyAuth(sessionId, load)`로 떼어 **저장소 없이 네 갈래 전부**를 건다. 다시 돌려 잡히는 것을 확인했다 |
| 적재기가 `undefined`를 줘도 통과시킨다 | **시험 구멍** — 지금 `SessionStore.load`는 `LoadedSession \| null`이라 `undefined`를 주지 않지만, 이 함수의 서명은 `Promise<unknown>`이라 적재기를 갈면 들어올 수 있다 | `undefined`를 주는 적재기를 거는 시험을 더했다 |
| 서랍 닫힘 시 포커스를 **무조건** 되돌린다 | **시험 구멍** — "버려진 포커스일 때만"이라는 조건이 왜 필요한지 아무도 확인하지 않았다 | 서랍을 연 채로 라우트를 바꾸는 시험을 더했다. 그때는 `main`이 이겨야 한다 — 아니면 화면이 바뀌어도 포커스가 상단 버튼에 남는다 |
| 글리프의 `aria-hidden` 제거 | **동치 변이** — `IconButton`에 명시적 `aria-label`이 있어 접근 가능 이름이 내용으로 계산되지 않는다. 변이를 넣은 채로도 `toHaveAccessibleName`이 그대로 통과하는 것을 실측했다 | 조치 없음. `aria-hidden`은 관례상 남긴다 |
| 라우트 전환 시 `setNavOpen(false)` 제거 | **동치 변이** — 바로 뒤에서 `main`에 포커스를 주는 순간 Radix의 비모달 Dialog가 "바깥으로 포커스가 나갔다"로 보고 스스로 닫는다. 실측으로 확인했다 | 조치 없음. 다만 **의도를 라이브러리의 부수 효과에 맡기지 않기 위해** 그 줄은 남기고 왜 남기는지를 주석에 적었다 |

고친 뒤 다시 돌려 **47가지 중 45가지가 잡히는 것**을 확인했다. 동치 변이 둘은 잡히지 않는 것이 옳다.

**시험이 결함 둘을 잡았고, 둘 다 내 것이다.**

첫째, **좁은 화면에서 내비게이션에 닿을 방법이 없었다** (DEV-073). Conductor는 800px 이하에서 사이드바를 감추고 내비게이션을 서랍으로만 여는데, `AppShell`은 `navOpen` 상태만 넘겨 주고 **여는 버튼은 앱이 낸다.** 그것을 빠뜨려 마우스로도 키보드로도 도달할 수 없었다. 접근성 조사 중에 "서랍을 여는 트리거가 어디 있나"를 실제로 렌더링해 확인하다가 드러났다 — 넓은 화면만 보고 있었으면 끝까지 몰랐을 것이다. Conductor의 `TopBar`가 이미 `menuButton` 슬롯을 갖고 있고 `.cdt-topbar__menu-button`이 사이드바가 사라지는 지점과 **같은 중단점**에서 나타나므로, 앱이 CSS를 새로 쓰지 않고 슬롯을 채우는 것으로 끝났다.

함께 드러난 것: 비모달 Radix Dialog는 포커스를 가두지도 닫을 때 트리거로 되돌리지도 않아 `Escape` 시 포커스가 `<body>`로 떨어졌다 (QA-COMMON-07). `Dialog.Trigger`를 쓰면 Radix가 알아서 하지만 그러려면 `@radix-ui`를 직접 의존해야 하고 그것은 QA-COMMON-17 위반이다 — 그래서 앱 쪽에서 되돌린다. **한 번 틀렸다**: 이펙트에서 곧바로 확인했더니 Radix가 아직 포커스를 풀기 전이라 놓쳤다. 다음 프레임에 보도록 고쳤다.

둘째, **e2e가 프록시의 세션 판정을 검증하지 못하고 있었다** (DEV-074, 위 변이 표). 이쪽은 "시험이 초록이니 됐다"로 넘어갔으면 그대로 남았을 것이다 — 변이 시험이 아니었으면 찾지 못했다.

**e2e가 실제 결함 하나를 더 잡았다.** Redis가 없는 상태로 프록시를 부르면 `sessionStore().load()`가 던져 **500**이 나갔다. 401은 "다시 로그인하라"는 뜻인데 Redis 장애는 사용자가 고칠 수 있는 일이 아니고, 500은 원인을 말해 주지 않는다. `search-api`가 접근 범위를 못 구했을 때 503을 내는 것과 같은 판단으로 **503 `PERMISSION_UNAVAILABLE`**로 고쳤다 (FR-AUTH-002 AC-3).

**시험을 약하게 만들어 초록을 얻지 않았다.** e2e를 세우다 `next start`가 기동을 거부하는 것을 만났다 — `NODE_ENV=production`에서 `SESSION_COOKIE_SECURE=false`를 주면 `resolveSessionReaderConfig`가 거절한다. 그것은 WP-012 FR-AUTH-001 AC-2가 정한 **옳은 동작**이므로 시험을 위해 끄지 않고 그 환경 변수를 걷어냈다. 끄는 순간 e2e가 운영과 다른 앱을 시험하게 된다.

**스킵 링크 시험은 내 단언이 틀렸다.** `#main-content`로 URL이 바뀌는 것을 기대했는데 Conductor의 스킵 링크는 `preventDefault()` 후 `main`에 직접 `focus()`를 부른다. 그쪽이 옳다 — 여러 브라우저에서 `href="#id"` 이동은 스크롤만 옮기고 키보드 포커스는 옮기지 않아 스킵 링크가 존재하는 이유를 잃는다. 구현이 아니라 시험을 고쳤고, **포커스가 실제로 `main`에 있는지**를 걸도록 바꿨다.

**정적 규칙을 시험으로 못박았다.** ADR-006이 "리터럴 색상값을 두지 않는다. **정적 검사로 강제한다**"고 적었으나 그 검사가 없었다. 화면을 처음 세우는 WP가 그물을 쳐 두어야 WP-016 이후가 그 위에서 큰다 — `lib/architecture.test.ts`가 QA-COMMON-16·17을 건다. 검사 자체를 무력화하는 변이(대상 디렉터리 비우기)까지 잡히는지 확인했다.

**시험이 확인하지 못한 것.** 실제 IdP를 상대로 한 OIDC 왕복 전체는 **NOT RUN**이다 — 자격 증명이 없다. `pnpm test:integration`도 이 환경에 Docker가 없어 **NOT RUN**이다(WP-015는 백킹 서비스를 쓰는 코드를 바꾸지 않았다). 실제 뷰포트에서 800px 이하 CSS가 버튼을 드러내는지는 **jsdom으로 걸 수 없어** Conductor의 규칙을 읽어 확인했을 뿐이다 — 뷰포트를 좁히는 e2e는 화면이 생기는 WP에서 함께 세우는 것이 낫다. 화면 13종의 권한 매트릭스와 QA-COMMON-01·09·14의 나머지도 WP-016 이후다.

### 6.16 WP-016 검증 실행 기록

DoD 6항 중 5항 통과, 1항 부분. 검증 방법은 `pnpm test web/search`, `pnpm test:e2e flow-001`, `pnpm test:a11y search`다.

| DoD | 결과 | 근거 |
| --- | --- | --- |
| QA-W001-01 ~ QA-W001-13, QA-W001-22, QA-W001-23 | **부분** | **화면 계층에서 통과**: 01·02·03(식별자가 해석 경로로 간다), 04(**서버 왕복 0건** — 실제 브라우저에서 네트워크 계층으로 셌다), 05(후보 2건이면 자동 이동하지 않는다), 06(절삭 표시), 07(오류 구간 강조 + 지원 키), 11(완화 후보), 12(기본 정렬 `merge_seq` 내림차순), 22(다른 시퀀스 공간은 tone을 낮추고 **글자로도 밝힌다**). 08·09·10·13은 **서버가 판정하고 WP-013이 통합 시험으로 이미 걸었다** — 화면은 질의를 그대로 실어 보낸다. **23(접근 범위)은 화면에서 확인할 수 없다** — 서버가 강제하고 WP-012·WP-013이 실제 ES 조회로 검증했다. 없는 검증을 통과로 적지 않았다 |
| **QA-W001-14는 절반만** (CR-019, DEV-075) | 통과 (절반) | "페이지 번호 UI가 없다"를 a11y와 e2e 양쪽에서 건다. **금지 규칙이라 데이터 없이 성립하고, 지금 세우는 것이 옳다** — 나중에 검사하면 이미 잘못 만든 뒤다. "커서 기반으로 동작한다"는 `next_cursor`가 늘 `null`이라 WP-032다 |
| 상태 매트릭스 W-001의 모든 상태에 대응하는 컴포넌트 테스트가 있다 | 통과 | **13종 전부.** `empty_no_query`·`error_prefix_too_short`·`error_query_syntax`·`loading_initial`·`ambiguous`(절삭 포함)·`ready`·`empty_no_result`·`error_search_timeout`·`no_permission`·`auth_expired`·`offline`·`error_other`. 판정은 `lib/search-state.test.ts`가 29건으로 따로 걸고, 렌더링은 a11y가 건다 — 같은 것을 두 번 걸지 않는다 |
| 필터를 5회 조작한 뒤 뒤로가기 1회로 이전 화면에 돌아간다 | 통과 | **실제 브라우저에서 확인했다.** 패싯 3회 + 정렬 2회를 만진 뒤 `goBack()` 한 번으로 `/`로 돌아온다. 조건이 실제로 URL에 쌓였는지(`author%3Akim`, `sort=changed_files_count`)를 먼저 확인해 시험이 무의미해지지 않게 했다 |
| URL을 복사해 새 탭에 붙여넣으면 동일 화면이 재현된다 (QA-COMMON-09) | 통과 | `?q=…&sort=…&order=…`로 진입하면 입력창·칩·결과가 그대로 선다. 조회 요청에도 같은 조건이 실린다 |
| axe 위반 0건 | 통과 | 13종 상태 각각에 axe를 돌려 **위반 0건**. `checkContrast`는 80쌍 중 실패 0건 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 13개, 위반 0건 |
| `pnpm test` (전량) | 종료 코드 0 — **833건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm test:a11y` | 종료 코드 0 — **62건**, axe 위반 0건 |
| `pnpm test:e2e` | 종료 코드 0 — **26건** (실제 Chromium) |
| `pnpm test:contrast` | 종료 코드 0 — 80쌍 중 실패 0건 |
| `pnpm build` | 종료 코드 0 — `/search` 라우트가 선다 |
| `pnpm test:integration` | **NOT RUN** — 이 환경에 Docker가 없다. WP-016은 백킹 서비스를 쓰는 코드를 바꾸지 않았다 |

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 52가지로 망가뜨렸다 — 상태 우선순위, 시퀀스 판정, 패싯 세 갈래, 토큰 편집과 왕복, 경로 선택, 정렬·`aria-sort`, 링크 시맨틱, 히스토리 규율, 경합 처리, 정적 검사 자체의 무력화.

**50가지가 잡혔고 2가지가 살아남았다. 둘 다 동치 변이임을 실측으로 확인했다.**

| 생존 | 판정 | 조치 |
| --- | --- | --- |
| 구조화 질의를 미리 걸러 내는 지름길 제거 | **도달 불가능한 코드** — 식별자 패턴(40자 hex, `#N`, `owner/repo#N`, GHE URL)은 어느 것도 `<질의키>:` 접두를 가질 수 없다. 키 15종 × 값 9종 × 형태 4종 = **540개 입력을 판별기에 넣어 겹치는 것이 0건**임을 확인했다 | **지웠다.** 결과를 바꾸지 않으면서 매 호출마다 정규식 15개를 돌리고, **틀리게 쓰면 버그를 만드는** 코드였다(아래 참조). 어느 문자열이 식별자인지는 판별기가 아는 것이다 |
| 제출 핸들러의 조기 반환 제거 | **버튼 잠금에 가려진다** — `blockedReason`이 버튼을 실제로 `disabled`로 만들므로 클릭도 Enter도 submit 이벤트를 내지 않는다. jsdom에서 Enter까지 확인했다 | 남겼다. 잠금은 **보이는 것**이고 이 줄은 **실제로 막는 것**이라, 누가 잠금을 풀면 이것만 남는다. 왜 관찰되지 않는지를 주석에 적었다 |

**시험이 결함 셋을 잡았고 전부 내 것이다.**

첫째, **붙여넣은 GHE URL이 전문 검색으로 떨어졌다.** 질의 키를 `[a-z_]+:` 패턴으로 찾았는데 그것이 `https://…`의 **스킴에 걸렸다.** QA-W001-02를 거는 시험이 잡았다. 파서의 `QUERY_KEYS`를 쓰도록 고쳤고, 그 뒤 변이 시험이 **그 검사 자체가 불필요함**을 드러내 통째로 지웠다 — 고친 것보다 지운 것이 나은 경우였다.

둘째, **WP-015에서 내가 만든 QA-COMMON-16 검사가 거짓 경보를 냈다.** `#1234`(PR 번호)를 색상 리터럴로 신고했는데, 이 제품 UI는 `#1234`로 가득하고 4자리 RGBA 축약과 문자열로 구별되지 않는다. **요구사항이 문자 그대로 적은 `#rrggbb`**까지만 걸도록 좁혔다 — 늘 거짓 경보를 내는 검사는 곧 꺼진다. 좁힌 뒤 변이 4종(6자리·8자리·`rgb()`·`hsla()`)으로 여전히 무는 것을 확인했다.

셋째, **Conductor가 두 규칙을 경고했다.** `TextField`의 이름을 시각적으로 숨긴 `<label for>`로 줬는데 이 디자인 시스템은 `Field`·`aria-label`·`aria-labelledby`만 인정한다(axe는 통과했다). `danger` 배너에 복구 액션이 없다는 것도 걸렸다. 둘 다 고쳤고, **후자는 C-005가 스스로 잡도록 개발용 검사를 더했다** — 런타임 경고는 콘솔에만 남고 아무도 보지 않는다.

**시험이 확인하지 못한 것.** `QA-W001-23`(접근 범위 밖 결과가 목록·패싯·건수 어디에도 없다)은 **화면에서 확인할 수 없다** — 서버가 강제하는 것이고 WP-012·WP-013이 실제 ES 조회로 걸었다. 화면은 서버가 준 것을 그릴 뿐이므로 여기서 통과로 적는 것은 거짓이다. `QA-W001-08·09·10·13`도 같은 이유로 서버 계층의 몫이다. `pnpm test:integration`은 Docker가 없어 **NOT RUN**이다.

### 6.17 WP-017 검증 실행 기록

DoD 6항 중 4항 통과, 2항 부분. 검증 방법은 `pnpm test web/pr`, `pnpm test:e2e flow-002`, `pnpm test:a11y pr`다.

| DoD | 결과 | 근거 |
| --- | --- | --- |
| QA-W002-01, QA-W002-02, QA-W002-15, QA-W002-18 | 통과 | 01(머지 커밋이 **실제로 첫 행**이고 배지로 구분된다 — 순서를 DOM에서 잰다), 02(미머지면 **행을 빼지 않고** 그 행에 "아직 머지되지 않았습니다"를 쓴다 — 빼면 "커밋이 없다"로 읽힌다), 15(보강 미완료 시 머지 커밋은 그대로 보이고 원본만 "수집 중"), 18(404를 `not_found`로 그리고 **화면에 "권한"이 한 번도 나오지 않는다** — 나오면 "있긴 있다"가 새어 나간다) |
| **QA-W002-03은 절반만** (CR-020, DEV-082) | 통과 (절반) | "절삭 표시"는 통과: 총계 키가 없으면 `totalCount: null`이 되고 **"250건 이상 (앞 250건만 표시, 전체 건수는 수집하지 않습니다)"**로 확정 총계와 다른 문구를 쓴다. 배열 길이를 총계로 쓰면 "정확히 250건"이라는 거짓이 된다. "전체 건수"는 `EVT-ING-002`가 나르지 않아 WP-020이다 |
| **QA-W002-17도 절반만** (CR-020, DEV-088) | 통과 (절반) | "확장 전에 조회하지 않는다"는 a11y·e2e 양쪽에서 건다 — 진입 시 요청은 **PR 문서 하나뿐**임을 실제 네트워크 계층에서 셌다. `onExpand` 계약도 지금 고정했다(펼칠 때만 1회, **접을 때는 부르지 않는다**) — 화면이 아직 넘기지 않아 컴포넌트를 직접 세워서 쟀다. "확장하면 조회한다"는 WP-031 |
| 상태 매트릭스 W-002의 5종이 렌더링된다 | 통과 | `loading_initial`·`ready`·`enrichment_pending`·`truncated`·`not_found` 전부. 여기에 DoD가 요구하지 않은 `no_permission`·`auth_expired`·`offline`·`error_other`까지 판정이 있다 — 다만 **`no_permission`은 PR 상세에서 도달하지 않는다**(서버가 404를 준다). `epoch_stale`은 CR-020 DEV-087대로 **만들지 않았다** |
| 미머지 PR에서 선행·후행이 숨겨지지 않고 비활성 + 사유로 표시된다 (QA-W002-07) | 통과 | 세 골격 섹션 모두 숨기지 않는다. 사유는 **미머지와 머지가 다르다** — 전자는 "머지 후 시퀀스가 부여됩니다", 후자는 "채번이 서면". 같은 문구로 두면 미머지 PR의 사용자가 왜 비었는지 알 수 없다 |
| axe 위반 0건 | 통과 | DoD 5종 상태 각각과 보관 배너에 axe(wcag2a/2aa/21a/21aa)를 돌려 **위반 0건**. `checkContrast`는 80쌍 중 실패 0건 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | 종료 코드 0 |
| `pnpm test` (전량) | 종료 코드 0 — **875건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm test:a11y` | 종료 코드 0 — **96건**, axe 위반 0건 |
| `pnpm test:e2e` | 종료 코드 0 — **39건** (실제 Chromium) |
| `pnpm test:contrast` | 종료 코드 0 — 80쌍 중 실패 0건 |
| `pnpm build` | 종료 코드 0 — `/pr/[owner]/[repo]/[number]` 라우트가 선다 |
| `pnpm test:integration` | **NOT RUN** — 이 환경에 Docker가 없다. WP-017은 백킹 서비스를 쓰는 코드를 바꾸지 않았다 |

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 48가지로 망가뜨렸다 — 판정 모듈 18종(P01~P18), 컴포넌트 25종(W01~W25), 라우트 5종(R01~R05).

**첫 통과에서 42가지가 잡혔고 6가지가 살아남았다. 여섯 전부 시험 구멍이었고, 전부 메운 뒤 다시 돌려 48/48이 잡혔다.** 동치 변이는 하나도 없었다 — 이번에는 살아남은 것이 전부 진짜 구멍이었다.

| 생존 | 무엇이 새어 나갔나 | 메운 방법 |
| --- | --- | --- |
| 머지 커밋을 마지막 행으로 옮김 | 시험 **이름**은 "첫 행"인데 **순서를 재지 않았다.** 배지 존재와 원본 행 개수만 봤다 | DOM에서 행 순서를 실제로 잰다. 머지 커밋이 착지한 것이고 원본은 재료다 — 뒤집히면 무엇이 브랜치에 남았는지 읽을 수 없다 |
| 릴리스 단계를 "대기"로 표시 | `data-status="out_of_scope"`(모델)만 보고 **사용자가 읽는 글자를 보지 않았다.** "대기"로 쓰면 기다리면 채워진다는 거짓말이 된다 | `pending`과 같은 화면에 세워 글자가 다름을 확인한다 |
| 접을 때도 `onExpand` 호출 | 화면이 아직 `onExpand`를 넘기지 않아 **화면을 통해서는 잴 수 없는 규칙**이었다 | 컴포넌트를 직접 세워 spy로 잰다. 규칙을 지금 고정해야 WP-031이 조회를 붙일 때 고칠 것이 없다 |
| 헤더에서 시퀀스 배지 제거 | `W-002-HEADER`가 명시적으로 요구하는데 **어느 시험도 확인하지 않았다** | 배지가 서고, 머지됐지만 채번 전이면 **"미채번"**(미머지가 아니라)임을 건다 |
| 보관 저장소 경고 제거 | 표시하는 코드는 있는데 시험이 없었다 — **DEV-089를 여기서 찾았다** | 보관 시 알리고 아닐 때 그리지 않음을 양쪽으로 건다 |
| 파일 절삭 표시 제거 | 위와 같다 | 절삭 시 밝히고 아닐 때 문구가 없음을 양쪽으로 건다 |

**변이 시험이 문서 공백 하나를 찾아냈다 (DEV-089).** `repository_archived`와 `files_truncated`는 SRS가 요구해 파이프라인이 실제로 채우는데(FR-ING-009 AC-3, FR-ING-007 AC-4) **어느 화면의 섹션 정의에도 표시 요구가 없었다.** 표시 코드를 내가 넣어 두고 시험을 안 걸었던 것이 변이로 드러났고, 그 자리를 파 보니 값이 사용자에게 한 번도 닿지 않는 구조였다. CR-020에 더해 와이어프레임을 고쳤다.

**결함 둘을 스스로 잡았다.**

첫째, **번호 모양이 틀린 딥링크가 막다른 골목이었다.** `/pr/acme/payments/abc`는 조회 없이 `not_found`를 보이는데 **되돌아갈 링크가 없어** 브라우저 뒤로가기 말고 길이 없었다. `PrDetailView`의 `not_found`에는 있는데 라우트 쪽에만 없었다 — 같은 화면을 두 군데서 만들어서 생긴 차이다. `searchBackHref`를 `lib/pr-detail.ts`로 빼서 **두 곳이 같은 것을 쓰게** 했다.

둘째, **번호 검사가 `0`과 앞자리 0을 막는지 확인하지 않았다.** `007`을 받아 주면 `Number('007') === 7`이라 **URL과 다른 PR을 그린다.** 조사 결과를 URL로 인용하는 제품에서 치명적이다. 정규식은 처음부터 옳았지만(`^[1-9][0-9]{0,9}$`) 시험이 없어 누구든 `^[0-9]+$`로 "고칠" 수 있었다 — 변이 R02가 그것을 그대로 재현했다. e2e에 다섯 모양(`0`, `007`, `-1`, `1.5`, 11자리)을 걸었다.

**정적 검사를 하나 더 쳤다.** 화면 라우트 셋(`/`, `/search`, `/pr/...`)이 **같은 다섯 줄의 세션 확인을 각자 갖고 있다.** 네 번째 화면(WP-018)이 그것을 빠뜨리면 인증 구멍이 된다. 지금 공통 함수로 묶는 것은 WP-015가 세운 라우트를 건드리는 일이라 범위 밖이므로, 대신 **빠뜨릴 수 없게** 했다 — `architecture.test.ts`가 화면 라우트를 모두 찾아 `SESSION_COOKIE_NAME`·`sessionStore()`·`redirect(`가 있는지 건다. 묶는 것은 WP-018이 네 번째 화면과 함께 한다.

**시험이 확인하지 못한 것.** `QA-W002-18`의 서버 쪽 절반(접근 범위 밖 PR에 대해 **서버가** 404를 준다)은 WP-012·WP-014가 실제 ES 조회로 걸었다 — 화면은 404를 받았을 때의 행동만 건다. 라우트의 인증 분기는 **e2e에서 도달하지 않는다**(`AUTH_ENABLED=false`로 띄운다, WP-015와 같은 이유) — 정적 검사로 존재를 강제하고 실제 동작은 `@prs/authz` 단위 시험이 건다. `no_permission` 화면 상태는 **PR 상세에서 도달하지 않는다**(서버가 404를 준다) — 판정은 걸었고 도달하지 않음을 기록한다. `pnpm test:integration`은 Docker가 없어 **NOT RUN**이다.

### 6.18 릴리스 게이트

릴리스별로 갱신한다.

| REL | 게이트 통과일 | 성능 (QA-PERF-01~10) | 권한 매트릭스 (78셀) | 도메인 정확성 (ACC-01~08) | 미해결 항목 |
| --- | --- | --- | --- | --- | --- |
| REL-001 | - | - | - | - | - |
| REL-002 | - | - | - | - | - |
| REL-003 | - | - | - | - | - |
| REL-004 | - | - | - | - | - |
| REL-005 | - | - | - | - | - |
| REL-006 | - | - | - | - | - |

## 7. 알려진 제한 (구현 반영 기준)

착수 시점의 계획상 제한이다. 구현이 진행되면 실제 반영된 내용으로 갱신한다.

| 제한 | 근거 문서 | 현재 상태 | 후속 |
| --- | --- | --- | --- |
| 시퀀스는 REL-003부터 제공 | 로드맵 4장 | 계획 | REL-003 |
| 관계 정보는 REL-004부터 제공 | 로드맵 4장 | 계획 | REL-004 |
| 원본 커밋 250건 초과 PR은 절삭 | FR-SRCH-003 AC-4 | 계획 | 없음 (GHE 링크 대체) |
| 변경 파일 3000개 초과 PR은 절삭 | FR-ING-004 AC-4 | 계획 | 없음 |
| 6자 이하 축약 SHA 미지원 | ADR-012 | 계획 | 없음 |
| 저장소 간 patch-id 비교 미지원 (포크 체리픽 미탐지) | FR-REL-005 AC-3 | 계획 | CR 필요 |
| `co_changes`·`precedes` 간선 미저장 (조회 시점 계산) | ADR-009 | 계획 | 없음 |
| W-007 관계 그래프는 조건부 | REL-004 ACC-06 | 계획 | REL-006 판단 |
| 실시간 알림·구독 없음 | SRS 4.3 | 범위 밖 | 없음 |
| 단일 리전 배포 | 인프라 11장 | 계획 | 없음 |
| 개인 단위 순위표 없음 | SRS 4.3 | 범위 밖 (정책) | 없음 |
| `docker compose up`이 이 실행 환경에서 검증되지 않음 | 인프라 8장 / DEV-001 | 실제 제약 (레지스트리 이그레스 차단) | 레지스트리 접근 가능한 환경에서 재검증 |
| 워크스페이스 패키지 5종(`query`·`es`·`db`·`github`·`bus`)이 식별 정보만 내보냄 | WP-001 구현 범위 | 실제 상태 (의도된 골격) | WP-002·WP-003·WP-005·WP-006·WP-025 |
| ~~`web`이 Conductor 디자인 시스템을 아직 쓰지 않음~~ | WP-001 제외 목록 (화면 제외) | 해소 (2026-08-21) — WP-015가 `AppShell`·`TopBar`·`NavList`·`EmptyState`·`Banner` 위에 셸을 세웠다. CSS는 루트 레이아웃에서 1회 import한다 (ADR-006) | 없음 |
| 각 앱 헬스체크가 백킹 서비스 연결을 확인하지 않음 | WP-001 구현 범위 (프로세스 기동만) | `ingest-gateway`는 해소 — `GET /healthz`가 PostgreSQL을 확인하고 실패 시 503 (인프라 3장). **`search-api`는 WP-013에서도 해소하지 못했다** — 검색 경로는 열렸으나 `/healthz`는 여전히 프로세스 기동만 본다. 서버가 ES 핸들만 받고 PostgreSQL 핸들은 받지 않아(`resolveNames` 클로저 안에 있다) ES만 확인하면 PG가 죽어도 `ok`가 나간다 — 반만 확인하는 헬스체크가 없는 것보다 나쁘다 | `search-api`는 서버에 PG 핸들을 넘기는 별도 변경 (WP-013 구현 범위·DoD 밖), `web`·`pipeline-worker`는 기존대로 |
| 통합 테스트가 testcontainers가 아니라 외부 PostgreSQL에 붙음 | WP-002 검증 방법 / DEV-006 | 실제 상태 (환경 변수로 접속 정보 주입) | WP-003에서 ES와 함께 재검토 |
| `saved_search`·`bisect_session`에 리포지터리 계층이 없음 | WP-002 구현 범위 (6종만 명시) | 실제 상태 (스키마는 존재). **`permission_cache`·`app_user`·`team`·`team_member`는 해소** (2026-08-21) — `authRepo`가 세웠다 | WP-024·WP-042 |
| ~~큐에 들어간 이벤트를 아무도 소비하지 않음 (`processed_at`이 영영 NULL)~~ | WP-005 제외 목록 | 해소 (2026-08-20) — WP-008 투영 워커가 색인 성공 뒤 `markProcessed`를 부른다. 투영되지 않는 이벤트(미등록 저장소, PR 이외 이벤트)는 여전히 NULL로 남아 `JOB-ING-007`이 계속 재적재한다 | 라우팅을 소유한 WP와 WP-010 저장소 등록 |
| `prs:sequence` 파티션 수가 문서에 없어 코드 기본값 8을 씀 | 비동기 문서 2장 / DEV-010 | 실제 상태 (환경 변수로 덮어쓸 수 있음) | 사용자 결정 후 CR |
| Kafka 어댑터 없음 | WP-005 제외 목록 (ADR-002 전환 임계 조건부) | 실제 상태 — 계약 테스트가 교체 가능성을 강제한다 | 전환 임계 충족 시 |
| 실제 GitHub Enterprise 대상 검증 미실행 | WP-006 / 이 실행 환경에 App 자격 증명 없음 | 실제 상태 — 목 서버 계약 시험만 통과. read-only smoke는 자격 증명이 있으면 자동 실행되도록 넣어 두었다 | **REL-001 운영 readiness 전 필수 게이트** |
| ~~GHE 클라이언트를 아무도 호출하지 않음~~ | WP-006 제외 목록 | 해소 (2026-08-20) — WP-007 `enrich` 워커가 호출한다 | 없음 |
| PR 이외 이벤트 중 `push`·`release`·`create`·`delete`를 아무도 진행시키지 않음 | WP-007 범위 (PR 보강만) / DEV-016 | 실제 상태 — `enrich`가 ack만 하고 넘긴다. 원본은 `raw_event`에 남아 유실이 아니다. **`member`·`team`·`repository`는 해소** (2026-08-21) — 게이트웨이가 `prs:permission`에도 발행하고 `authz` 워커가 소비한다 (CR-015, DEV-042) | 라우팅을 소유한 WP-021(시퀀스) |
| ~~`enrichment_pending` 문서가 아직 색인되지 않음~~ | WP-007 제외 목록 | 해소 (2026-08-20) — WP-008이 `enrichment_pending`을 문서에 그대로 옮겨 색인한다 | 없음 |
| ~~실패 대기열에 쌓인 이벤트를 재처리할 길이 없음~~ | WP-007 범위 밖 (재처리는 WP-009) | 해소 (2026-08-20) — API-ADM-003이 조회·재처리를 연다 | 없음 |
| 재처리 실행이 감사 기록에 남지 않음 | WP-009 범위 밖 | 실제 상태 — WP-010이 감사 적재(`auditRepo`)와 이름 붙은 토큰을 세웠으나 실패 대기열 재처리 경로에는 아직 붙이지 않았다. 저장소 등록·변경·해제만 남는다 | 재처리에도 같은 방식으로 붙이면 된다 (다음 WP에서 함께) |
| ~~관리 API가 `operator` 역할이 아니라 이름 붙은 토큰으로 보호됨~~ | CR-012 DEV-025 / CR-013 DEV-030 / CR-015 DEV-048 | 해소 (2026-08-21) — OIDC 세션이 구성되면 통제는 `operator` 역할이다. 이름 붙은 토큰은 OIDC **미구성** 배포에만 남고, 둘을 함께 구성하면 기동을 거부한다 | 없음 |
| 재처리 진행률(`EVT-JOB-001`)이 보고되지 않음 | JOB-ING-009의 `batch` 워커가 WP-019 소관 / DEV-024 | 실제 상태 — 1회 500건 상한 안에서 요청이 끝나고 결과는 응답 본문이 알려 준다 | WP-019가 `batch`를 세운 뒤 |
| `EVT-ING-004 ingestion.failed`가 발행되지 않음 | 카탈로그의 소비자 `ops`가 스트림이 아니라 테이블을 읽음 / DEV-026 | 실제 상태 — 워커가 `dead_letter` 행을 동기적으로 남기므로 기록 유실은 없다 | 실시간 알림 소비자가 생기는 REL-005 |
| 재처리가 실패 단계와 무관하게 `prs:ingest`부터 다시 돎 | `EVT-ING-002`·`EVT-ING-003`이 보존되지 않음 | 실제 상태 — 투영 단계 실패도 보강부터 다시 한다. GHE 왕복이 한 번 더 든다 | 없음 (중간 이벤트를 보존하려면 별도 CR) |
| 경보 규칙 파일이 저장소에 없음 | WP-010이 k8s 매니페스트와 스크레이프 배선을 소유 | 실제 상태 — 지표(`dead_letter_open_total`)와 규칙 정의(관측성 문서 4장)는 있고 배포된 규칙만 없다 | WP-010 |
| 워커 재기동 시 논리 재시도 횟수가 초기화됨 | CR-010 `EventBus` 확장의 알려진 한계 | 실제 상태 — 재시도 상태가 프로세스 메모리에 있다. Redis의 물리 전달 횟수를 하한으로 삼아 완화했으나 at-least-once 범위 안에서 5회보다 많이 재시도될 수 있다. 실패 대기열은 정확성 경계가 아니라 운영 분류 도구다 | 필요해지면 별도 CR |
| 지표가 프로세스 메모리에만 존재 (재기동 시 초기화) | WP-010 범위는 노출까지 | 실제 상태 — 세 앱이 `@prs/metrics` 한 구현을 공유하고 스크레이프 애노테이션도 매니페스트에 있다. 보관·집계는 사내 지표 저장소의 몫이다 | REL-001 프로비저닝 |
| ~~Elasticsearch 통합 시험 3종을 이 환경에서 실행하지 못함~~ | WP-003 범위 / DEV-008 | 해소 (2026-08-20) — `mirror.gcr.io/library/elasticsearch:8.19.0`이 이그레스 정책을 통과한다. CI와 같은 8.19.0으로 19건 전량 실행 | 없음 (compose 정의는 그대로이므로 DEV-001은 유효) |
| git 미러 경로 없음 — 커밋 목록은 API 폴백만 | WP-006 제외 목록 (미러는 WP-020) | 실제 상태 (ADR-005의 폴백 경로만 구현) | WP-020 |
| NDJSON 아카이브 파일을 아무도 읽지 않음 | WP-004 구현 범위 (파일 append까지) | 실제 상태 | WP-036 Filebeat 소비 |
| ~~게이트웨이·워커·search-api가 지표 모듈을 각자 복제~~ | WP-004·WP-007 구현 범위 / WP-010 | 해소 (2026-08-21) — `@prs/metrics` 한 곳으로 합쳤다 | 없음 |
| ~~`queue_depth{stream}` 지표 미노출~~ | 비동기 문서 10장 / WP-010 | 해소 (2026-08-21) — `EventBus.depth`를 포트에 더했고 API-ADM-006이 토픽별로 돌려준다. `XLEN`이 아니라 `lag + pending`이다 | 없음 |
| 미등록 저장소 이벤트도 그대로 저장됨 | FR-ING-009 AC-4는 "투영하지 않음"이지 "저장하지 않음"이 아님 | 실제 상태 (의도된 동작) — 투영이 걸러 ack하고(DEV-020), 이제 API-ADM-001로 등록하면 백필(WP-019)이 원본에서 채운다 | 없음 |
| 서명이 맞는데 JSON이 깨진 요청은 500 (GHE 재전송 유도) | API-ING-001 오류 코드가 401·413·500으로 한정 | 실제 상태 | 없음 (서명 유효 시 발생하지 않는 경로) |
| 커밋 문서에 메시지·작성자·부모 SHA가 없음 | WP-008 입력이 `EVT-ING-002`이고 그 이벤트는 커밋 SHA만 나른다 | 실제 상태 — SHA → PR 해석(FR-SRCH-002)에 필요한 만큼만 채운다. 조건부 업서트가 키 단위로 대입하므로 나중에 채워도 덮이지 않는다 | WP-020 미러 기반 커밋 보강 |
| `allowed_team_ids`·`author_team_ids`가 비어 있음 | WP-008 범위 밖 (투영이 채워야 함) | **실제 상태 — WP-012가 해소하지 못했다.** 접근 범위 쪽(`org_team` 조건 생성, 팀 소속 조회, 무효화)은 세웠으나 **문서에 팀 ID를 쓰는 것은 투영의 일**이고 `EVT-ING-002`가 팀 정보를 나르지 않는다. `explicit` 범위는 `repository_id`만으로 동작하므로 조회는 성립한다. 통합 시험은 fixture로 팀 ID를 직접 넣어 `org_team` 조건을 검증했다 | 투영이 저장소 등록에서 팀 ID를 읽도록 하는 별도 CR. **WP-013 착수 전 권장이었으나 열린 채로 남았다** — `team:` 필터는 구현·시험됐지만 실제 투영이 팀 ID를 쓰지 않는 한 운영 데이터에서 0건이 된다 |
| `links_pending`이 영영 `true` | 관계 파생이 WP-029 | 실제 상태 — 투영이 생성 시점에만 `true`로 두고 이후 건드리지 않는다. 화면은 이 표식으로 "관계 미확정"을 표시한다 | WP-029 |
| k8s 매니페스트가 클러스터에 적용된 적 없음 | WP-010 구현 범위 / 이 환경에 Kubernetes·`kubectl` 없음 | 실제 제약 — YAML 파싱만 확인했다. 이미지 이름(`prs/*:latest`)과 백킹 서비스 호스트는 자리표시자다 | **REL-001 프로비저닝 때 실제 클러스터에서 검증** |
| 단계별 지연 p50/p95가 기본적으로 `unavailable` | CR-013 / DEV-029 | 실제 상태 — 지표 저장소(사내 Prometheus 호환)가 `METRICS_QUERY_URL`로 설정된 경우에만 채운다. 워커 복제본 하나를 긁어 클러스터 전체인 양 내놓지 않는다 | REL-001 프로비저닝에서 주소 주입 |
| ~~`test:e2e`·`test:a11y` 스크립트가 없음~~ | DEV-032 / DEV-069 | 해소 (2026-08-21) — WP-015가 harness를 세웠다. `pnpm test:a11y`(vitest + axe, jsdom), `pnpm test:e2e`(Playwright, 실제 Chromium), `pnpm test:contrast`(Conductor `checkContrast`)가 저장소 루트에서 돈다 | 없음 |
| A-001 운영 콘솔 화면 없음 | 사용자 결정 (WP-010은 API까지) | 실제 상태 — **셸은 섰고 경로도 있다**(`/ops/pipeline`·`/ops/repositories`·`/ops/audit`, `operator`·`security_officer`에게만 렌더링). 그 경로의 **화면 내용이 아직 없어 404다** | WP-017 이후 (셸이 경로 구조를 소유하고 각 화면은 자기 WP에서 붙는다) |
| 저장소 등록이 GHE 자격 증명 없이는 열리지 않음 | FR-ING-009 예외 처리 (접근 권한 확인이 필수) | 실제 상태 — `GHE_APP_ID`/`GHE_INSTALLATIONS`가 없으면 등록 경로를 달지 않고 기동 로그에 남긴다. 확인 없이 등록을 받으면 수집이 영영 비어 있는 저장소가 "등록됨"으로 남는다 | 없음 (의도된 동작) |
| ~~OIDC 로그인·콜백·로그아웃 라우트가 없음~~ | WP-012 제외 목록 (화면은 WP-015) | 해소 (2026-08-21) — WP-015가 `/auth/login`·`/auth/callback`·`/auth/logout`을 붙였다. 왕복 상태 넷은 짧은 수명 HttpOnly 쿠키로 나르고(DEV-071), 로그아웃은 `POST`만 받는다(`<img src>` 하나로 로그아웃되지 않게). OIDC 미구성 배포에서는 IdP 대신 503을 낸다 | 없음 |
| 실제 사내 IdP 대상 OIDC 왕복 미실행 | 이 실행 환경에 IdP 자격 증명 없음 | **NOT RUN** — 테스트가 생성한 RSA 키쌍으로 다섯 검사를 각각 무너뜨려 확인했다. 실제 IdP의 그룹 클레임 이름과 JWKS 회전 동작은 확인하지 못했다 | **REL-002 게이트 전 필수** |
| **게이트웨이 p95 시험이 CI 러너 속도에 흔들린다** | `apps/ingest-gateway/integration/load.test.ts` / FR-ING-001 AC-4 (p95 ≤ 300ms) | 실제 상태 — WP-015 CI에서 **한 번 314.8ms로 실패**했다. 같은 커밋을 다시 돌리자 227.4ms로 통과했으나 그것도 예산의 76%다. main의 과거 세 실행은 66.6·74.2·93.2ms였다. **이 PR의 것이 아니다**: 통합 잡의 시험 파일 수가 main과 같은 29개로 동일하고(부하를 더하지 않았다), 게이트웨이 요청 경로를 건드리지 않았으며(`helpers.ts`의 `migrateUp` import 경로만 바뀌었고 그것은 `beforeAll` 1회다), **p50은 오히려 빨라졌다**(36.2·46.6 vs main 41.6~51.9). 계통적 저하라면 p50도 함께 올라간다 — 꼬리만 3배인 것은 러너 실속(stall)의 모양이다. **측정 도구의 문제다**: 컨테이너화된 Postgres·Redis에 붙는 공유 CI 러너에서 p95 SLO를 재는 것은 요구사항을 검증할 수 있는 계측기가 아니다 | **제안**(별도 CR, 이 PR에서 바꾸지 않았다): CI의 단언은 "파국적으로 느리지 않다"는 느슨한 상한으로 두고 측정값은 계속 출력하되, **FR-ING-001 AC-4의 실제 300ms 검증은 대표 하드웨어의 REL-001 성능 게이트**로 옮긴다. 예산을 올리는 것이 아니라 **잴 수 있는 곳에서 재는 것**이다 |
| 화면 대부분이 아직 없다 | 각 화면이 자기 WP 소관 | 실제 상태 (의도) — **`/`·`/search`·`/pr/:owner/:repo/:number`가 선다.** `/ranges`·`/releases`·`/stats`·`/ops/*`는 이동은 되지만 404다 | WP-018 이후 각 화면 WP |
| `⌘K`가 셸 슬롯이 아니라 화면 안의 입력을 잡는다 | DEV-070 / WP-016 구현 | 실제 상태 — WP-016은 C-010을 **W-001 화면 안**에 두었다(질의가 URL 단일 진실이라 화면이 소유해야 한다). 셸의 `omniSearch` 슬롯은 비어 있어 `⌘K`가 아무것도 잡지 않는다 — 셸 단축키가 화면의 입력에 닿으려면 슬롯에 넣어야 한다 | 전 화면 공통 옴니 입력을 셸에 올리는 별도 변경 (WP-017 이후 화면이 늘 때 판단) |
| 좁은 화면(≤800px) 동작을 실제 뷰포트에서 확인하지 못함 | jsdom에 뷰포트·CSS가 없음 / DEV-073 | 실제 상태 — 서랍 버튼의 **존재·키보드 도달·여닫기·포커스 복귀**는 a11y 시험이 건다. 그 버튼이 800px 이하에서만 보인다는 것은 Conductor의 `.cdt-topbar__menu-button` 규칙을 읽어 확인했을 뿐 **실행으로 확인하지 않았다** | 뷰포트를 좁히는 e2e를 화면 WP에서 함께 세운다 |
| 세션 만료 후 경로 복귀가 `/` 하나에서만 실증됨 | WP-015 범위 (화면 없음) | 실제 상태 — `return_to` 생성·무해화·왕복·재무해화는 전부 시험이 걸지만, 실제로 그 경로를 만드는 화면이 `/`뿐이다 | **`/search`가 더해져 둘이 됐다.** 화면이 늘수록 넓어진다 |
| W-001의 패싯이 늘 `not_computed` | WP-016 제외 목록 (패싯 데이터는 WP-032) / CR-019 DEV-076 | 실제 상태 (의도) — `/search`가 `facets`·`facets_omitted` 키를 넣지 않으므로 레일이 **사유를 표시하고** 선택 UI를 그리지 않는다. 조용히 비우지 않는다 | WP-032 |
| 결과 목록의 시퀀스가 늘 `not_computed` | WP-021 전까지 투영이 시퀀스를 쓰지 않음 / CR-019 DEV-077 | 실제 상태 — 미머지(`unassigned`)와 **다른 배지**로 그린다. 섞으면 머지된 PR을 "미머지"로 표시하게 된다 | WP-021 |
| 결과 행에 관계 배지 열이 없음 | CR-019 DEV-081 (`C-015`는 WP-031 소관, `link_summary`는 WP-029까지 빈다) | 실제 상태 (의도) — **빈 열을 미리 두지 않는다.** 사용자가 "관계 없음"으로 읽는다 | WP-031 |
| ~~`/search` 결과 행이 가리키는 상세 화면이 없음~~ | W-002·W-003이 WP-017·WP-018 | **절반 해소 (2026-08-22)** — WP-017이 `/pr/[owner]/[repo]/[number]`를 세웠다. `from_q`도 실제로 살아 돌아온다(실제 브라우저에서 왕복 확인). **커밋 상세(`/commit/...`)는 아직 404다** | WP-018 |
| 최근 검색 목록이 비어 있음 | CR-019 DEV-079 (저장 위치 미정) | 실제 상태 — prop을 선택으로 낮추고 비면 그리지 않는다. **저장 설계를 지어내지 않았다** — 서버에 보내면 조사 이력이 서버 기록이 되는데 요구한 문서가 없다 | 사용자 결정 후 |
| 접근 범위 산출이 등록 저장소마다 GHE를 한 번씩 부름 | FR-AUTH-002 AC-1이 "read 이상 권한을 가진 저장소"를 요구 / OD-002 미결 | 실제 상태 — 협업자 권한 API가 조직 기본 권한·팀·직접 협업자를 모두 반영한 실효 권한을 주므로 정확하다. 대신 캐시 미스마다 등록 저장소 수만큼 호출이 나간다(동시 8, 캐시 5분, 사용자별 요청 병합). **저장소 수가 커지면 재검토가 필요하다** | OD-002 결정 후 (IdP 그룹이면 호출이 사라진다) |
| 운영 집계 두 곳이 접근 범위를 거치지 않음 | CR-015 DEV-051 (미해소) | 실제 상태 — API-ADM-006의 `enrichment_pending`(전 저장소 `es.count`)과 `slowest_repositories`(저장소 이름 포함). FR-ADMIN-001 AC-1·AC-3이 요구하고 THR-003·THR-016이 반대한다. **동작을 바꾸지 않고** 아키텍처 테스트의 사유 붙은 허용 목록에 등록했다 | **사용자 결정 + CR** |
| 권한 매트릭스가 API 계층까지만 검증됨 | NFR-005는 역할 6종 × 화면 13종 | 실제 상태 — 역할 6종 × 역할 요구 경로는 통과한다. 화면이 없어 13종 축을 걸 수 없다 | WP-015 이후 |
| 세션이 Redis에만 있어 Redis 유실 시 전원 재로그인 | 보안 문서 4장 (의도된 결정) | 실제 상태 — PostgreSQL 백업을 두지 않는다. 세션을 두 곳에 두면 로그아웃이 두 곳 모두에서 성립해야 하고, AC-5를 어길 자리가 하나 더 생긴다 | 없음 (의도된 동작) |
| `search-api`가 GHE 자격 증명 없이는 세션 인증을 세우지 않음 | FR-AUTH-002 AC-1 (접근 범위 산출에 GHE가 필요) | 실제 상태 — 자격 증명이 없으면 모든 조회가 503이 되므로, 인증이 구성되지 않았다고 기동 로그에 남기고 토큰 통제로 돌아간다 | 없음 (의도된 동작) |
| 목록 조회 p95(NFR-001)가 측정되지 않음 | WP-013 DoD / DEV-058 | **NOT RUN** — 1000만 문서 합성 데이터셋도 `pnpm test:perf` 스크립트도 이 환경에 없다. 예산을 지키는 구조(완화 힌트 왕복 1회, `track_total_hits` 상한 1만, ES 마감 3초)만 시험으로 고정했다 | **REL-002 성능 게이트 전 필수** |
| `relevance` 정렬이 실질적으로 문서 ID 순 | CR-016 DEV-056 / 전문 검색이 WP-032 | 실제 상태 (의도된 계약) — 접근 범위 필터도 사용자 필터도 전부 `filter` 문맥이라 모든 문서의 점수가 같다. 키를 400으로 거절하지 않고 받되, 지금 무엇인지 계약에 적었다 | WP-032가 점수 절을 더한다 |
| `/search` 응답에 `facets`가 없고 `next_cursor`가 항상 `null` | WP-013 제외 목록 (패싯·커서는 WP-032) / CR-016 DEV-057 | 실제 상태 (의도된 구분) — `next_cursor`는 키를 두고 `null`을 실어 "다음 페이지 없음"을 말하고, `facets`는 키 자체를 넣지 않아 "세지 않았다"와 "세었는데 없다"를 구분한다 | WP-032 |
| 전문 검색어(`q`의 자유 문자열)가 조회에 쓰이지 않음 | WP-013 제외 목록 (전문 검색은 WP-032) | 실제 상태 — 파서가 `parsed.text`로 응답에 실어 사용자가 무시된 것을 볼 수 있다. 조용히 버리지 않는다 | WP-032 |
| 이미 색인된 문서에 `doc_id`가 없어 정렬 뒤로 밀림 | CR-016 DEV-059 | 실제 상태 — `upsert`가 생성 본문과 스크립트 `params.doc` 양쪽에 넣으므로 **다음 이벤트에서 채워진다.** 그때까지는 `missing: _last`로 뒤에 선다. 이 저장소에는 아직 운영 데이터가 없어 실질 영향이 없다 | 백필(WP-019) 또는 재색인(WP-035)이 지나면 사라진다 |
| 완화 힌트 후보가 8개로 잘림 | CR-016 DEV-055 | 실제 상태 (의도된 상한) — 넘으면 `relaxation_hints_truncated: true`를 실어 조용한 절삭이 "이것이 전부"로 읽히지 않게 한다 | 없음 |
| 직접 푸시 커밋을 조회할 수 없음 (`direct_push` 역할 도달 불가) | CR-017 DEV-061 / FR-SRCH-002 AC-3, QA-W003-03 | **실제 상태** — 커밋 문서가 PR 이벤트에서만 만들어지고 `push`는 ack 후 버려진다(DEV-016). 직접 푸시 커밋은 문서 자체가 없어 조회가 404다. API 계약과 타입은 그 값을 표현할 수 있게 두어, 값이 생겼을 때 계약을 다시 고치지 않게 했다 | **WP-021** (push 이벤트 라우팅) |
| 커밋 상세에 메시지·작성자·부모 SHA·파일 목록이 없음 | CR-017 DEV-060 / WP-008이 남긴 한계 | 실제 상태 — `EVT-ING-002`가 커밋에 대해 SHA만 나른다. 채워지지 않은 필드는 **키를 넣지 않아** "만들지 않았다"와 "만들었는데 비었다"를 구분한다. 커밋의 표시명은 SHA 축약이다 | WP-020 (미러 기반 커밋 보강) |
| PR 상세의 원본 커밋에 제목·작성자·작성 시각이 없음 | CR-017 DEV-062 / FR-SRCH-003 AC-3 | 실제 상태 — PR 문서는 SHA 배열만 갖고 커밋 문서를 조인해도 메시지가 없다. 배열 **모양은 객체**로 두어 WP-020이 키를 더할 때 계약을 고치지 않아도 되게 했다 | WP-020 |
| 250건 초과 원본 커밋의 **진짜 총계를 모름** | CR-017 DEV-063 / FR-SRCH-003 AC-4 | 실제 상태 — 보강 payload가 총계를 나르지 않는다. 250을 총계로 내보내면 거짓이므로 **키를 빼고** `source_commits_truncated: true`만 남긴다 | `EVT-ING-002` 확장 CR |
| 릴리스 태그를 식별자로 판별하지 않음 | CR-017 DEV-065 / 해석 순서 7단계 | 실제 상태 — **태그 패턴이 어디에도 정의되어 있지 않고** `prs-releases`도 비어 있다. 추측해 넣으면 `v1`·`build-2`가 오분류되어 전문 검색으로 가야 할 질의가 0건이 된다 | WP-024 (릴리스 수집)가 패턴을 정의한다 |
| 단건 해석 p95(NFR-001)와 ADR-012의 선택도 근거가 측정되지 않음 | WP-014 DoD / DEV-058 | **NOT RUN** — 커밋 1000만 건 데이터셋이 없다. 접두가 겹칠 때 후보가 여럿 나온다는 **동작**만 확인했고, "5000만 커밋에서도 통상 1건"이라는 ADR-012의 **근거**는 확인하지 못했다 | **REL-002 성능 게이트 전 필수** |
| `/resolve`가 자유 텍스트를 전문 검색으로 위임하지 않음 | WP-014 범위 (전문 검색은 WP-032) | 실제 상태 — `detected_kind: 'text'`로 판별만 하고 후보는 빈 배열이다. 화면이 그 신호를 받아 `/search`를 부른다 | WP-016 (화면 결합), WP-032 (전문 검색) |
| 문서당 `EVT-ING-003`이 하나씩 발행됨 (PR 1 + 커밋 N) | 비동기 문서 4장의 payload가 엔티티 단위 | 실제 상태 — 커밋 250건 PR이면 251건이 나간다. `noop`은 내지 않아 재처리 시에는 줄어든다 | 관계 워커(WP-029) 실측 후 필요하면 CR |
| PR 상세의 선행·후행·릴리스·관계가 **골격뿐** | WP-017 제외 목록 (데이터는 WP-024·WP-027·WP-031) | 실제 상태 (의도) — **셋 다 숨기지 않고 사유를 적는다.** 숨기면 사용자가 기능 부재로 오인한다. 미머지 PR의 선행·후행 사유는 머지된 PR과 **다른 문구**다 | WP-024, WP-027, WP-031 |
| PR 상세 타임라인의 **승인 시각을 모름** | CR-020 DEV-084 / `approved_at`이 ES 매핑에 없음 | 실제 상태 — `approved_by`로 **일어난 것은 알고 시각만 모른다.** `done_at_unknown`으로 그리고 사유를 함께 적는다. `pending`으로 그리면 승인된 PR이 "승인 대기"가 된다 | 매핑에 `approved_at`을 더하는 별도 CR (투영과 `EVT-ING-002` 함께) |
| 리뷰어별 상태가 "승인함 / 아직 아님" 둘뿐 | CR-020 DEV-085 / 투영이 리뷰어별 상태를 저장하지 않음 | 실제 상태 — "변경 요청"을 **지어내지 않는다.** `reviewers`·`approved_by` 두 로그인 목록만으로 파생할 수 있는 것이 이 둘이다 | 투영이 리뷰 상태를 저장하도록 하는 별도 CR |
| `epoch_stale` 화면 상태가 없음 | CR-020 DEV-087 / 시퀀스가 WP-021까지 전부 `null` | 실제 상태 (의도) — **도달할 수 없는 코드를 만들지 않았다.** 에폭 변경을 감지할 경로도 정해져 있지 않다 | **WP-021**이 시퀀스와 함께 감지 경로를 정한다 |
| W-001 결과 표가 `repository_archived`·`files_truncated`를 표시하지 않음 | CR-020 DEV-089 (W-002만 열었다) | 실제 상태 — **W-002는 둘 다 표시한다.** 목록 쪽은 행마다 배지를 더하면 밀도 설계를 다시 해야 하고 그것은 WP-016의 완료된 범위라 이번에 건드리지 않았다 | 목록 표시가 필요하다고 판단되면 별도 CR |
| 화면 라우트 셋이 세션 확인 다섯 줄을 각자 복제 | WP-015가 세운 라우트 구조 | 실제 상태 — 지금 묶는 것은 WP-017 범위 밖이라, 대신 **빠뜨릴 수 없게** 했다. `architecture.test.ts`가 화면 라우트를 모두 찾아 세션 확인과 `redirect`를 강제한다 | **WP-018**이 네 번째 화면과 함께 공통 함수로 묶는다 |

## 8. 다음 작업

현재 이 저장소는 **REL-001 구현 단계**이며, CR-005로 제품 범위가 확장되어 REL-007~011이 추가되었다.

완료:

1. ~~`srs_final.md` baseline 전환~~ → 완료 (2026-08-19, v1.0, CR-003)
2. ~~`validate_srs_prd_env.py --strict` 통과 확인~~ → 완료
3. ~~OD-003·OD-006·OD-007 결정~~ → 완료 (2026-08-19, CR-004)
4. WP-001 워크스페이스 골격 → 구현 완료, `docker compose up` 검증만 보류 (DEV-001)
5. ~~WP-002 PostgreSQL 스키마와 마이그레이션~~ → 완료 (2026-08-19). 검증 결과는 6.2장
6. ~~CR-005 제품 범위 확장 (GitHub Operations Plane)~~ → 완료 (2026-08-20, SRS baseline v2.0)
7. ~~CR-006 DEV-003·DEV-004·DEV-005 문서 정정~~ → 완료 (2026-08-20)
8. ~~WP-003 Elasticsearch 매핑과 인덱스 부트스트랩~~ → 완료 (2026-08-20). 검증 결과는 6.3장
9. ~~WP-004 웹훅 수신 게이트웨이~~ → 완료 (2026-08-20). 검증 결과는 6.4장
10. ~~CR-007 DEV-007·DEV-009 데이터 모델 정정~~ → 완료 (2026-08-20)
11. ~~WP-005 EventBus 포트와 Redis Streams 어댑터~~ → 완료 (2026-08-20). 검증 결과는 6.5장
12. ~~CR-008 gh capability parity 요구사항 강화~~ → 완료 (2026-08-20, SRS baseline v2.1). gh 2.97.0 재실측, ADR-017~019, WP-061~065, C-061~067 추가
13. ~~WP-006 GHE 클라이언트와 rate limit 관리~~ → 완료 (2026-08-20). 검증 결과는 6.6장. 실제 GHE smoke만 자격 증명 부재로 미실행
14. ~~CR-009 typed gh 결과 계약과 조합 parity~~ → 완료 (2026-08-20, SRS baseline v2.2). ADR-020, WP-066 추가, 기존 안정 ID 재번호화 0건
15. ~~CR-010 WP-007 파이프라인 계약 정정~~ → 완료 (2026-08-20). DEV-012~015 해소, DEV-016은 라우팅 소유 WP로 이월
16. ~~WP-007 보강 워커~~ → 완료 (2026-08-20). 검증 결과는 6.7장. 실제 GHE smoke와 ES 통합 시험은 미실행
17. ~~CR-011 WP-008 투영 계약 정정~~ → 완료 (2026-08-20). DEV-018~020 해소. SRS 버전은 v2.2 유지(정합성 수정)
18. ~~WP-008 투영 워커와 버전 조건부 업서트~~ → 완료 (2026-08-20). 검증 결과는 6.8장. 통합 스위트 전량(158건)이 처음으로 통과했다
19. ~~CR-012 WP-009 실패 대기열 계약 정정~~ → 완료 (2026-08-20). DEV-022~025·DEV-027 해소, DEV-026은 알림 소비자를 소유한 REL-005로 이월. SRS 버전은 v2.2 유지(정합성 수정)
20. ~~WP-009 실패 대기열과 재처리~~ → 완료 (2026-08-20). 검증 결과는 6.9장. 통합 191건 전량 통과
21. ~~CR-013 WP-010 저장소 등록·파이프라인 상태 계약 정정~~ → 완료 (2026-08-21). DEV-028~031·033·034 해소, DEV-032는 화면 WP로 이월. SRS 버전은 v2.2 유지(정합성 수정)
22. ~~WP-010 저장소 등록 API와 파이프라인 지표~~ → 완료 (2026-08-21). 검증 결과는 6.10장. **REL-001 구현 범위가 닫혔다**
23. ~~CR-014 WP-011 질의 문법 계약 정정~~ → 완료 (2026-08-21). DEV-035~039 해소. SRS 버전은 v2.2 유지(빈칸 메우기)
24. ~~WP-011 구조화 질의 파서~~ → 완료 (2026-08-21). 검증 결과는 6.11장
25. ~~CR-015 WP-012 인증·접근 범위 계약 정정~~ → 완료 (2026-08-21). DEV-040~050 해소, DEV-051은 사용자 결정이 필요해 미해소. SRS 버전은 v2.2 유지(빈칸 메우기)
26. ~~WP-012 인증과 접근 범위 강제~~ → 완료 (2026-08-21). 검증 결과는 6.12장. **DoD 10항 중 9항 통과, AC-1의 브라우저 리다이렉트만 WP-015로 이월**
27. ~~CR-016 WP-013 검색 계약 정정~~ → 완료 (2026-08-21). DEV-052~057·DEV-059 해소, DEV-058은 성능 harness 부재로 미해소. SRS 버전은 v2.2 유지(빈칸 메우기)
28. ~~WP-013 검색 API 목록 조회~~ → 완료 (2026-08-21). 검증 결과는 6.13장. **DoD 7항 중 6항 통과, NFR-001의 p95 실측만 NOT RUN**
29. ~~CR-017 WP-014 식별자 해석 계약 정정~~ → 완료 (2026-08-21). DEV-060·062~066 해소, DEV-061은 push 이벤트 라우팅이 없어 미해소. SRS 버전은 v2.2 유지(빈칸 메우기)
30. ~~WP-014 식별자 해석 API~~ → 완료 (2026-08-21). 검증 결과는 6.14장. **DoD 6항 중 4항 통과, QA-W003-03 도달 불가, NFR-001 실측 NOT RUN**
31. ~~CR-018 WP-015 웹 셸 계약 정정~~ → 완료 (2026-08-21). DEV-067~072 해소. 구현 중 DEV-073·074를 추가 등록·해소했다. SRS 버전은 v2.2 유지(빈칸 메우기와 문서 간 모순 해소)
32. ~~WP-015 웹 앱 셸과 Conductor 통합~~ → 완료 (2026-08-21). 검증 결과는 6.15장. **DoD 6항 중 4항 통과, QA-COMMON 3항과 FLOW-000 경로 복귀가 화면 부재로 부분**

33. ~~CR-019 WP-016 W-001 계약 정정~~ → 완료 (2026-08-21). DEV-075~081 해소. SRS 버전은 v2.2 유지(빈칸 메우기와 문서 정합)
34. ~~WP-016 W-001 통합 검색 화면~~ → 완료 (2026-08-21). 검증 결과는 6.16장. **DoD 6항 중 5항 통과, `QA-W001-14`만 절반**(커서는 WP-032)
35. ~~CR-020 WP-017 W-002 계약 정정~~ → 완료 (2026-08-22). DEV-082~088 해소. 구현 중 DEV-089를 추가 등록·해소했다. SRS 버전은 v2.2 유지(빈칸 메우기)
36. ~~WP-017 W-002 PR 상세 화면~~ → 완료 (2026-08-22). 검증 결과는 6.17장. **DoD 6항 중 4항 통과, `QA-W002-03`·`QA-W002-17`이 절반**(전체 건수는 WP-020, 확장 조회는 WP-031)

**다음 WP: WP-018 W-003 커밋 상세 화면** (선행 WP-015·WP-016 충족).

**WP-017이 딛고 설 자리를 만들어 두었다.** `EntityHeader`(C-023)는 `kind`와 `badges`로 받도록 만들어 커밋 상세가 그대로 쓴다 — PR에만 있는 것을 헤더에 넣지 않은 이유가 그것이다. `PendingSection`도 `W-003-SEQPOS` 골격에 그대로 쓰인다. `GET /commits/{sha}`는 WP-014가 세웠다.

**WP-018이 함께 할 것 하나.** 화면 라우트가 넷이 되면서 세션 확인 다섯 줄의 복제도 넷이 된다. 지금은 `architecture.test.ts`가 빠뜨림을 막고 있을 뿐이므로, **네 번째 화면과 함께 공통 함수로 묶는다** — 세 개일 때 묶는 것은 WP-015가 세운 라우트를 건드리는 범위 밖 작업이었지만, 네 번째를 새로 쓰면서 묶는 것은 그 화면의 일이다.

**WP-018이 마주칠 것.** `direct_push` 역할이 **도달 불가**다(DEV-061) — 커밋 문서가 PR 이벤트에서만 만들어져 직접 푸시 커밋은 문서 자체가 없다. `QA-W003-03`은 WP-021 전까지 통과할 수 없으므로, WP-016·WP-017이 `QA-W001-14`·`QA-W002-03`에 한 것과 같이 **착수 전 감사에서 항목을 가르는 CR**이 필요하다.

**WP-015가 열어 준 것.** 세 가지가 여기서 닫혔다 — WP-012가 남긴 OIDC 브라우저 왕복(로그인·콜백·로그아웃 라우트), `test:e2e`·`test:a11y`·`test:contrast` harness(DEV-032, WP 20곳이 참조하던 이름), 그리고 셸이 소유하는 경로 구조와 역할 필터링. 이제 각 화면 WP는 **자기 화면만** 만들면 된다.

~~**다음 WP: WP-016 W-001 통합 검색 화면** (선행 WP-011·WP-013·WP-015 충족).~~ (완료, 위 34번)

딛고 설 것이 갖춰졌다 — 파서(`@prs/query`), 목록 조회(`GET /search`), 식별자 해석(`GET /resolve`), 셸과 프록시. WP-016이 처음으로 할 일 중 하나는 **C-010 `OmniSearchInput`을 셸의 `omniSearch` 슬롯에 넣는 것**이다(DEV-070). 그러면 `⌘K`가 셸을 고치지 않고 그것을 가리킨다.

화면이 생기면서 함께 넓어지는 것들: NFR-005 권한 매트릭스의 화면 13종 축, QA-COMMON-01(IA 진입 경로표)·09(URL 상태 재현)·14(식별자 고정폭), FLOW-000의 경로 복귀(**W-002가 더해져 셋이 됐다**), 그리고 뷰포트를 좁히는 e2e(DEV-073의 미검증 부분 — **WP-017까지도 세우지 못했다**).

**사용자 결정이 필요한 것 — REL-002 진행 전:**

1. **OD-002 권한 원천** — 마감이 "REL-002 착수 전"이었고 지금이 그 시점이다. 현재는 GHE 협업자 권한 API를 원천으로 쓰되 `AccessScopeSource` 포트 뒤에 두었으므로, IdP 그룹으로 결정되면 어댑터 교체다. 결정이 늦어질수록 캐시 미스마다 등록 저장소 수만큼 GHE 호출이 나가는 상태가 길어진다
2. **DEV-051 운영 집계의 접근 범위** — API-ADM-006의 `enrichment_pending`과 `slowest_repositories`. FR-ADMIN-001 AC-1·AC-3이 전역 값을 요구하고 THR-003·THR-016이 반대한다. **동작을 바꾸지 않고** 사유 붙은 허용 목록에 등록해 둔 상태다
3. **`allowed_team_ids` 투영 CR** — `team:` 필터는 WP-013이 구현·시험했으나, 투영이 문서에 팀 ID를 쓰지 않는 한 운영 데이터에서 0건이 된다. `explicit` 범위(등록 저장소 500개 이하)는 이것 없이도 동작한다

CR-008은 문서만 강화했다. GitHub Operations Plane(REL-007~011) 구현 순서는 바뀌지 않는다 — Search/Data Plane을 end-to-end로 닫은 뒤다. `@prs/github`은 Data Plane의 GitHub REST 클라이언트이며 `gh` CLI를 실행하지 않는다 (ADR-013).

**REL-001의 WP는 전부 끝났다.** 웹훅 수신부터 검색 인덱스까지, 실패 격리와 재처리, 저장소 등록과 파이프라인 관측이 모두 선다. 남은 것은 **코드가 아니라 게이트**다 — 실제 GHE 대상 read-only smoke, k8s 매니페스트의 클러스터 적용, 운영 규모 성능 측정(QA-PERF), `docker compose up` 검증(DEV-001). 넷 다 이 실행 환경에 없는 것을 요구하며 7장과 6.12장에 그대로 남아 있다.

~~**WP-014가 다음이다.**~~ (완료, 위 30번) WP-013이 질의→ES 경로를 세웠으므로 식별자 해석 API가 같은 파사드 위에 선다 — SHA→PR과 PR→커밋 모두 `applyMandatoryScopeFilter`를 거친 `search`를 쓴다.

**WP-012가 남긴 것 셋은 WP-013을 막지 않았고, 셋 다 아직 열려 있다.**

1. **DEV-051 (사용자 결정 필요).** API-ADM-006의 운영 집계 두 곳이 접근 범위를 거치지 않는다. FR-ADMIN-001 AC-1·AC-3이 그 값을 요구하고 THR-003·THR-016이 반대한다. 동작을 바꾸지 않고 아키텍처 테스트의 사유 붙은 허용 목록에 등록했다. **WP-013이 첫 사용자 대면 검색 API로 열렸는데도 이 경계는 정해지지 않았다** — 운영 콘솔(WP-040)이 서기 전에는 실사용자에게 노출되지 않으므로 아직 시급하지 않다.
2. **`allowed_team_ids`가 여전히 비어 있다.** 접근 범위 쪽은 세웠으나 **문서에 팀 ID를 쓰는 것은 투영의 일**이고 `EVT-ING-002`가 팀 정보를 나르지 않는다. WP-013이 `team:` 필터를 구현·시험했으므로 이제 **사용자가 쓸 수 있는 필터가 운영 데이터에서 0건을 내는 상태**다 — 다만 미해석 이름과 달리 이것은 "이름은 찾았는데 문서에 값이 없는" 경우라 응답에 표식이 남지 않는다. `explicit` 범위(저장소 500개 이하)는 영향이 없다.
3. **OD-002가 열려 있다** (권한 판정 소스, 기한 REL-002 착수 전 — **지금이 그 시점이다**). `resolveAccessScope`를 포트로 두고 GHE 어댑터를 구현했으므로 IdP 그룹으로 결정되어도 어댑터 교체다. 다만 GHE 어댑터는 캐시 미스마다 등록 저장소 수만큼 호출한다 — 저장소가 많은 조직이면 이 결정이 성능에 직접 걸리고, NFR-001 실측(DEV-058)도 이 결정 뒤에 하는 편이 뜻이 있다.

**WP-015(웹 셸)가 WP-012의 나머지 절반을 쥐고 있다.** OIDC 인가 URL 생성·토큰 교환·ID 토큰 검증·세션 발급은 `@prs/authz`가 라이브러리로 제공하지만 그것을 부르는 라우트가 없다. 인프라 문서의 아웃바운드 허용 목록이 IdP를 `web`에만 열기 때문이다. 권한 매트릭스의 화면 13종 축도 그때 걸린다.

CR-005는 문서 범위만 확장했다. 구현 순서는 바뀌지 않는다 — Search/Data Plane(REL-001~006)을 end-to-end로 닫은 뒤에 Operations Plane(REL-007~011)을 시작한다. GitHub Operations 기능을 REL-001 WP 안에 섞지 않는다.

수집 경로는 웹훅에서 검색 인덱스까지 닫혔다. 남은 것은 **검색하는 쪽**과 **실패한 것을 되살리는 쪽**이다. 문서는 색인되지만 아직 그것을 질의하는 API(WP-013~018)도, 실패 대기열을 다루는 관리 경로(WP-009)도 없다.

권장 순서:

```text
~~WP-003 Elasticsearch~~ 완료
~~WP-004 웹훅 게이트웨이~~ 완료
~~WP-005 Redis EventBus~~ 완료
~~WP-006 GitHub REST 클라이언트~~ 완료
~~WP-007 보강 워커~~ 완료
~~WP-008 투영 워커~~ 완료
→ WP-009 DLQ
→ WP-010 저장소 등록·파이프라인 지표
   ... REL-002~006 ...
→ WP-045 gh capability 레지스트리   (REL-007 시작)
```

남은 착수 조건:

| 항목 | 필요 시점 |
| --- | --- |
| GitHub App 발급(읽기 전용), 웹훅 엔드포인트 등록, OIDC 클라이언트 등록 | **WP-006~WP-008 구현은 자격 증명 없이 끝냈다**(목 서버 계약 시험 + 실제 PostgreSQL·Redis·Elasticsearch). 실제 GHE smoke와 end-to-end 실동작 검증에 필요하다 |
| `prs:sequence` 파티션 수 결정 (DEV-010) | WP-021 시퀀스 채번 전까지 |
| ES 컨테이너 3개의 Docker host 배치 확정 | REL-001 프로비저닝 |
| 컨테이너 레지스트리 접근 환경에서 `docker compose up -d` 재검증 | DEV-001 |
| GitHub Operations App 발급과 권한 승인 | REL-007 |
| 비밀 저장소 연동 | REL-007 |
| `gh-executor` 런타임 프로비저닝과 gh 버전 고정 | REL-007 |

`srs_final.md`가 baseline이므로 그 문서의 변경은 CR을 먼저 등록해야 한다. 구현 중 문서와 현실이 어긋나면 5장에 `DEV-###`를 등록하고 CR로 연결한다. 조용한 범위 변경은 금지다.

착수 후 매 WP 완료 시 이 문서의 3·4·6장을 갱신한다. 갱신 없는 완료 보고는 완료가 아니다.
