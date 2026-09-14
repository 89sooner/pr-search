# 변경 관리 대장

## 1. 목적

이 문서는 PR Search 문서 세트의 변경 요청(CR), 게이트 통과 기록, cascade 수행 기록을 남긴다. 기준선(`baseline`) 이후의 모든 범위·설계 변경은 여기서 시작한다.

## 2. 변경 절차

1. CR 등록(아래 표): 유형, 트리거, 영향 ID/문서를 적는다.
2. 영향 분석: 요구사항, 화면, API, 데이터, WP 중 어디까지 번지는지 확인한다.
3. cascade 갱신: `srs_final.md`부터 `docs/README.md`의 순서대로 갱신한다.
4. validator 실행 결과를 기록한다.
5. CR을 종료한다. 영향받은 WP는 원장에서 상태를 재설정한다.

## 3. 변경 요청(CR) 대장

| CR ID | 날짜 | 유형 | 트리거 | 요약 | 영향 ID | 영향 문서 | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CR-001 | 2026-08-19 | correction | 초기 scaffold | 문서 세트 생성 | - | 전체 | closed |
| CR-002 | 2026-08-19 | scope | 제품 정의 인터뷰 (Perforce → GitHub Enterprise 전환 문제) | Phase 0~5 문서 전량 작성. 기능 후보 45종 수집, FR 51종·NFR 8종 승인, 화면 13종 정의, ADR 12종 확정, REL 6종·WP 44종 분해 | F-*, FR-*, NFR-*, OD-001~008, W-001~009, A-001~004, C-001~047, FLOW-000~008, API-*, ENT-*, JOB-*, EVT-*, ADR-001~012, REL-001~006, WP-001~044 | 전체 | closed |
| CR-003 | 2026-08-19 | correction | 사용자 baseline 승인 | `srs_final.md`를 `review` → `baseline`(v1.0)으로 전환하고 기준선 잠금 문구 추가. 핸드오프 게이트 통과 기록. 내용 변경 없음 — 상태 전환만 | FR-* 전체 (범위 변경 없음) | `srs_final.md`, `change_control.md`, `pr_search_implementation_traceability.md`, `pr_search_ai_agent_implementation_request.md` | closed |
| CR-004 | 2026-08-19 | design | 사용자 OD 결정 승인 (OD-003·OD-006·OD-007) | 원본 이벤트 보존 3년 + PostgreSQL `raw_event` 계획 용량 4TB(월별 파티션 유지, 만료분은 파티션 드롭으로 정리) 확정. Elasticsearch 전용 클러스터 3노드 확정(노드당 Docker 컨테이너 1개, 총 3개 컨테이너, 복제본 1 유지, 사내 공용 클러스터 미사용). 워크로드 기준선 1,000 PR/일(연 365,000건, 5년 1,825,000건) 확정하고 NFR-003의 5년 500만 PR은 용량 설계 상한으로 유지. ADR-003 초기 샤드 수 불변. 부수 정정 2건: Kafka 전환 조건이 OD-006을 인용하던 참조 오류를 ADR-002 전환 임계로 교체, W-007 활성화 조건이 OD-007을 인용하던 참조 오류를 REL-004 관계 간선 정확도(ACC-06)로 교체. ES 용량 표에서 엔티티 인덱스 합계와 `prs-raw-events` 아카이브를 분리 표기 | OD-003, OD-006, OD-007, NFR-003, ADR-002, ADR-003, W-007, FR-REL-008, WP-043, REL-001, REL-004 | `srs_final.md`, `prd.md`, `requirements_screen_traceability_matrix.md`, 파생 UI 6종, 아키텍처 5종, 딜리버리 4종, `change_control.md` | closed |
| CR-005 | 2026-08-20 | scope | 2026-08-20 사용자 승인: gh CLI가 지원하는 GitHub 작업을 웹 UI에서 최대한 완전하게 제공하는 GitHub Operations Platform으로 제품 범위 확장 | 제품을 **Search/Data Plane**과 **GitHub Operations Plane** 두 축으로 분리하고 후자를 신규 범위로 편입한다. 기존 Out of Scope였던 GHE 쓰기 행위·Issue·Discussion·Project·Actions·Release·Repository·Codespace·설정/보안 운영을 In Scope 또는 Conditional Scope로 재분류한다. 버전 고정된 gh capability manifest, 생성형 command UI, 격리 executor, 위임 사용자 신원, risk/승인/감사 모델을 추가한다. FR-GH-001~013, NFR-009~012, W-010~W-023, A-005~A-007, ADR-013~016, REL-007~011, WP-045~060 신설. 기존 안정 ID는 변경하지 않는다 | FR-GH-001~013, NFR-009~012, W-010~W-023, A-005~A-007, ADR-013~016, REL-007~011, WP-045~060, API-GH-*, ENT-GH-*, JOB-GH-*, EVT-GH-* | 요구사항 4종, 파생 UI 7종, 아키텍처 10종, 딜리버리 4종, 브리프 2종, `README.md`, `change_control.md` | closed |
| CR-006 | 2026-08-20 | correction | WP-002 구현 중 등록된 문서 편차 DEV-003·DEV-004·DEV-005 | 문서 오류 3건을 현실에 맞춘다. 게이트 기록의 오류 코드 수 표기를 실제와 일치시키고(DEV-003), `raw_event_delivery_uk`가 기본 키와 완전히 중복인 인덱스임을 데이터 모델에 반영해 삭제하며(DEV-004), 파티션 테이블 `audit_record`의 기본 키에 파티션 키를 포함시킨다(DEV-005). CR-005의 범위 변경과 섞지 않는다. 코드는 이미 올바른 방향으로 구현되어 있어 문서를 코드에 맞춘다 | DEV-003, DEV-004, DEV-005, FR-ING-002, FR-AUTH-004 | `pr_search_data_model.md`, `pr_search_api_contracts.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |

| CR-007 | 2026-08-20 | correction | WP-003·WP-004 구현 중 등록된 문서 편차 DEV-007·DEV-009 | 데이터 모델 문서 오류 2건을 현실에 맞춘다. 4장 공통 설정의 `index.sort`가 `merge_seq` 없는 `prs-links`에도 적용되는 것처럼 읽혀 그대로는 인덱스 생성이 거부되는 문제를 적용 범위 명시로 정정하고(DEV-007), 3.1의 "멱등 제약은 기본 키가 그대로 강제한다"가 파티션 테이블에서 성립하지 않음을 정정해 게이트웨이의 advisory lock + 조건부 INSERT를 멱등 강제 수단으로 명시한다(DEV-009). **SRS는 건드리지 않는다** — FR-ING-002 AC-1이 요구하는 결과(중복 저장 차단)는 그대로 충족되고, 달라지는 것은 그것을 강제하는 수단뿐이다. 코드가 이미 올바른 방향으로 구현되어 있어 문서를 코드에 맞춘다 | DEV-007, DEV-009, FR-ING-002, FR-ING-005 | `pr_search_data_model.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-008 | 2026-08-20 | scope | 사용자 요구: "gh가 지원하는 모든 기능과 유효한 조합을 웹 UI에서 표현한다"의 parity 정의와 검증 범위를 더 엄격하게 만든다 | **CR-005가 세운 GitHub Operations Plane을 다시 만들지 않는다.** parity의 *정의*를 강화한다. (1) parity 차원을 command path·flag 중심에서 28개 차원(alias, inherited/global flag, short alias, repeatable, stdin/file 입출력, 저장소·호스트·브랜치·workspace 컨텍스트, gh config, TTY/editor/browser 요구, 출력 형식, `--json` 필드, `--jq`/`--template`, 페이지네이션, REST/GraphQL 모드, GHES 버전, 사용자·App 권한, 정책, 위험도)으로 확장한다. (2) `GhCapability`에 의미 제약 모델(`requires`/`conflicts`/`oneOf`/`exactlyOne`/`atLeastOne`/`implies`/`repeatable`/`minItems`/`maxItems`/enum/조건부/입력원/컨텍스트 의존)을 추가하고 UI·서버·argv 빌더·테스트 생성기가 **같은 모델**을 공유하도록 못 박는다 (ADR-017). (3) 문자열 명령이 아니라 `GhInvocation` 구조를 단일 진실로 삼는다. (4) 실행 직전 유효 컨텍스트를 W-010에 표시한다. (5) interactive 명령을 `web_native`/`web_equivalent`/`sandbox_terminal`/`terminal_only`/`policy_blocked`/`unsupported_by_host` 중 하나로 분류하고 `unknown`을 금지한다. (6) extension을 신뢰 경계가 있는 별도 plane으로 정의한다 (ADR-019). (7) `gh api`를 스키마 인지 폼으로 강화한다. (8) **gh stdout/stderr와 GitHub 텍스트를 신뢰할 수 없는 입력으로 취급하는 `SafeGhOutput` 경계를 신설한다** — gh 2.97.0 자신도 외부 입력이 섞인 터미널 escape 처리 문제를 보안 수정한 이력이 있어 gh 출력을 안전하다고 가정하지 않는다 (ADR-018). (9) 파일 입출력을 실행 workspace 안으로 가둔다. (10) 재실행을 argv 재실행이 아니라 구조화 invocation의 재검증으로 정의한다. (11) NFR-009 게이트를 전 차원 100%·`unknown` 0으로 강화한다. 신규 ADR-017~019, WP-061~065, C-061~067. **기존 FR-GH-001~013·NFR-009~012·W-010~023·A-005~007·ADR-013~016·WP-045~060 ID를 그대로 재사용하며 재번호화하지 않는다.** gh 2.97.0 인벤토리를 재실측해 문서 수치를 검증했다 (DEV-011) | FR-GH-001, FR-GH-002, FR-GH-003, FR-GH-007, FR-GH-010, FR-GH-012, FR-GH-013, NFR-009, NFR-010, ADR-017, ADR-018, ADR-019, WP-061~065, C-061~067, W-010, W-020, W-021, W-022, A-006 | `srs_final.md`(v2.0 → v2.1), `prd.md`, `glossary.md`, `requirements_screen_traceability_matrix.md`, 파생 UI 4종, 아키텍처 6종, 딜리버리 3종, `change_control.md` | closed |
| CR-009 | 2026-08-20 | scope | 사용자 요구: gh로 가능한 기능과 **그 조합**을 웹 UI에서 최대한 완전하게 제공한다. CR-008이 닫은 "한 command의 모든 유효 조합"에서 "여러 capability를 이어 만드는 유효한 작업"으로 한 단계 넓힌다 | **CR-005·CR-008을 다시 만들지 않는다.** 조합 parity를 일반화한다. (1) capability에 입력 계약뿐 아니라 **결과 계약**(`GhResultContract`: kind·schema·resourceType·bindable·sensitivity·adapters)을 둔다. (2) 결과 sensitivity를 `public`/`internal`/`sensitive`/`secret`으로 분류하고 **secret 결과는 화면 표시·이력 저장·Recipe 바인딩·감사 본문 저장·다음 명령 stdin 자동 전달을 전부 금지**한다 — capability가 UI에 존재하는 것과 비밀 값을 노출하는 것은 다른 문제다. (3) command 사이를 `owner/repo#123` 문자열 재파싱이 아니라 공통 typed 참조 `GhResourceRef`로 잇는다. (4) capability에 typed 입출력 port를 두어 어떤 명령 뒤에 어떤 명령을 붙일 수 있는지 **타입으로 계산**한다 — 이름 문자열 일치로 잇지 않는다. (5) 단계 연결은 자유 표현식이 아니라 구조화된 `GhBinding`이다(선언된 named field 또는 스키마가 허용한 제한된 JSON Pointer만. eval·JS·shell·템플릿 실행 금지). 단일 명령의 `--jq` parity 자체는 유지한다. (6) manifest에서 `GhCapabilityGraph`(node=capability, edge=출력 port→호환 입력 port)를 자동 계산해 W-023이 호환 가능한 다음 단계를 제안한다. (7) `--json`이 없는 명령도 result adapter로 분류한다(`native_json`/`gh_api_structured`/`resource_url`/`artifact`/`opaque_text`/`stream`/`exit_status`/`secret_non_bindable`) — 깨지기 쉬운 정규식 파싱을 강요하지 않고, `opaque_text`는 실행·표시는 되지만 typed 바인딩 source가 될 수 없다고 분류한다. 숨기지 않는다. (8) 모든 capability에 composability 상태를 부여하고 `unknown`을 금지한다. (9) Recipe를 순차+팬아웃에서 **비순환 typed DAG**로 넓히되 무한 루프·재귀·임의 표현식·임의 shell은 계속 금지하고 cycle은 저장 시 거부한다. (10) 모든 fan-out에 상한·동시성·위험도 집계·rate limit preflight를 강제하고 상한이 없으면 저장·실행을 거부한다. (11) 동적으로 산출된 R2/R3 대상 집합은 preflight → target set 확정 → plan hash → 확인 → 실행 순서를 따르며, 확인 이후 plan이 바뀌면 기존 확인은 무효다. (12) 실행 결과를 `GhResultEnvelope`로 통일하되 SafeGhOutput 경계를 우회하지 않는다. (13) 파일 바인딩은 실행기 경로가 아니라 아티팩트 ID이며 다음 단계가 자기 workspace에 materialize한다. (14) NFR-009 게이트에 결과 계약·bindability·입출력 port·secret 분류 커버리지를 더한다. 신규 ADR-020, WP-066, C-068~070. **기존 안정 ID 재번호화 0건** | FR-GH-001, FR-GH-002, FR-GH-003, FR-GH-005, FR-GH-006, FR-GH-007, FR-GH-012, NFR-009, NFR-010, ADR-020, WP-066, WP-058, WP-060, WP-065, C-068, C-069, C-070, W-010, W-021, W-023, A-006, ENT-GH-009~011 | `srs_final.md`(v2.1 → v2.2), `prd.md`, `glossary.md`, `requirements_screen_traceability_matrix.md`, 파생 UI 3종, 아키텍처 5종, 딜리버리 4종, `change_control.md` | closed |
| CR-010 | 2026-08-20 | correction | WP-007 착수 전 파이프라인 계약 감사에서 확인된 DEV-012~015 | **CR-009와 섞지 않는다.** WP-007이 딛고 설 계약을 정합하게 만든다. (1) DEV-012 — FR-ING-004의 "재시도 3회" 표기를 FR-ING-007 AC-1·비동기 5.1·WP-007과 같은 **5회**로 정정한다. 제품 동작 변경이 아니라 이미 승인된 표준 재시도 정책과의 정합성 수정이다. (2) DEV-013 — `EVT-ING-002`를 **self-contained bounded 이벤트**로 확정한다. 지금 payload는 식별자만 나르는데 보강 결과를 담을 저장소가 없어, 그대로 두면 WP-008이 GitHub API를 다시 호출해야 하고 그것은 FR-ING-004의 rate limit 설계를 무의미하게 만든다. 정규화된 PR·커밋 SHA 목록·변경 파일·리뷰를 실어 보내되 **원본 웹훅 전량·patch/diff 본문·소스 코드·토큰은 싣지 않고** 커밋 250건·파일 3000건 상한을 유지한다. `@prs/domain`에 명시적 타입을 둔다. (3) DEV-014 — `EventBus` 핸들러가 처분을 돌려줄 수 있게 작은 확장을 더한다. 지금은 "반환=ack / 던짐=재전달" 둘뿐이고 재전달 간격이 `claimIdleMs` 고정이라, GitHub이 알려 준 `retryAt`까지 미루는 것을 표현할 수 없고 **rate limit 대기 중 30초마다 재전달되어 회복 전에 재시도 5회를 소진해 DLQ로 간다**. `retry`(표준 백오프)·`defer`(지정 시각까지, 재시도 예산 미소비)·`dead_letter`(종료 후 ack) 세 처분을 두되 새 큐 프레임워크는 만들지 않고 Redis·인메모리 두 어댑터가 같은 계약을 통과하게 한다. 장래 Kafka 어댑터도 같은 의미 계약을 구현할 수 있어야 한다. (4) DEV-015 — `org → installationId` binding 출처를 환경 변수 `GHE_INSTALLATIONS`로 확정한다. 임의 고정값을 코드에 넣지 않는다. 미등록 조직 이벤트는 조용히 넘기지 않고 non-retryable 실패로 DLQ에 사유를 남긴다. DEV-016(비-PR 이벤트 라우팅)은 라우팅을 소유한 WP에서 결정할 사안이라 `open`으로 남긴다 | DEV-012, DEV-013, DEV-014, DEV-015, FR-ING-004, FR-ING-007, EVT-ING-002, ADR-002 | `srs_final.md`, `pr_search_api_contracts.md`, `pr_search_async_events_jobs.md`, `pr_search_backend_architecture.md`, `pr_search_data_model.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-011 | 2026-08-20 | correction | WP-008 착수 전 투영 계약 감사에서 확인된 DEV-018~020 | **CR-009·CR-010을 다시 만들지 않는다.** WP-008 투영이 딛고 설 계약을 정합하게 만든다. (1) DEV-018 — `EVT-ING-002`의 `pull_request`가 PR 문서 매핑이 선언한 필드 중 `created_at`을 나르지 않아 **WP-008 DoD가 요구하는 `lead_time_seconds`·`first_review_wait_seconds`를 계산할 수 없다**. CR-010이 세운 "투영은 GitHub API를 다시 부르지 않는다"를 지키려면 그 값이 이벤트 안에 있어야 한다. 경계를 "이번 WP가 당장 쓰는 필드"가 아니라 **"PR 문서 매핑이 선언한 PR 고유 필드 전부"**로 정한다 — `created_at`, `updated_at`, `closed_at`, `body`, `draft`, `labels`. 모두 웹훅 payload와 PR API 응답에 이미 있고 크기 상한이 있으며, **patch/diff 본문·소스 코드·토큰은 여전히 싣지 않는다**. 필드를 WP마다 하나씩 흘려 넣으면 `EVT-ING-002`를 매번 다시 열게 된다. (2) DEV-019 — 데이터 모델 5장의 조건부 업서트 스크립트가 모든 필드를 단순 대입하는데 `pull_request_numbers`는 N:M이다. 커밋 하나가 두 PR에 속하면 나중 이벤트가 앞 PR 번호를 지워 **FR-SRCH-002(SHA → PR)의 핵심이 조용히 깨진다**. 스크립트에 집합 합집합 절을 더한다. (3) DEV-020 — FR-ING-009 AC-4는 "미등록 저장소의 웹훅 이벤트는 원본 보관은 하되 투영 처리는 하지 않는다"고 정했는데 FR-ING-005에는 그 규칙이 없다. 투영은 `org_id`·`visibility`·`repository`를 저장소 등록에서만 얻으므로 미등록이면 애초에 접근 범위 필터가 걸리는 문서를 만들 수 없다 — 억지로 만들면 ADR-008의 필수 필터에 잡히지 않는 문서가 생긴다. FR-ING-005 예외 처리에 명시한다. **제품 범위 변경이 아니라 이미 승인된 요구사항 사이의 정합성 수정이므로 SRS 버전은 v2.2를 유지한다** (CR-006·CR-007·CR-010과 같은 처리) | DEV-018, DEV-019, DEV-020, FR-ING-005, FR-ING-009, FR-SRCH-002, EVT-ING-002, ENT-CORE-002, ENT-CORE-003 | `srs_final.md`, `pr_search_async_events_jobs.md`, `pr_search_data_model.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-012 | 2026-08-20 | correction | WP-009 착수 전 실패 대기열 계약 감사에서 확인된 DEV-022~026 | **CR-009·CR-010·CR-011을 다시 만들지 않는다.** WP-009 실패 대기열이 딛고 설 계약을 정합하게 만든다. (1) DEV-022 — `dead_letter`에 `(delivery_id, stage)` 유일 제약이 없어 재처리가 실패할 때마다 `reprocess_count = 0`인 새 행이 생긴다. 그래서 **FR-ING-007의 "동일 이벤트가 3회 재처리 실패하면 보류"가 영원히 성립하지 않고**, 100건 경보(AC-5)도 서로 다른 이벤트 수가 아니라 실패 횟수를 센다. `EVT-ING-004`가 이미 멱등 키를 `(delivery_id, stage)`로 정해 두었으므로 그 키를 제약으로 강제하고 기록을 삽입에서 업서트로 바꾼다. (2) DEV-023 — 상태가 `pending`/`reprocessing`/`held` 셋뿐이라 **재처리 성공을 표현할 자리가 없다.** 성공한 행이 `reprocessing`으로 남아 경보 임계를 잠식하고, 지우면 90일 보존 정책(데이터 모델 9장)과 어긋난다. 종료 상태 `resolved`를 더하고, 판정 지점을 투영이 `raw_event.processed_at`을 찍는 자리로 정한다 — 재투입은 비동기라 API가 성공을 알 수 없다. (3) DEV-024 — JOB-ING-009의 워커가 `batch`인데 `batch` 역할과 `prs:batch` 스트림은 **WP-019가 세운다.** WP-009의 선행은 WP-007·WP-008뿐이라 그대로면 착수할 수 없다. 재처리는 "행을 읽어 스트림에 다시 넣는" I/O 가벼운 작업이므로 `ops` 모듈이 요청 안에서 직접 수행하고(1회 최대 500건), `EVT-JOB-001` 진행률과 10분 타임아웃은 WP-019부터 적용한다. (4) DEV-025 — API-ADM-003의 권한은 `operator`인데 역할 판정은 **WP-012(REL-002)**가 세운다. WP-009는 REL-001이라 그 사이에 변경 API가 인증 없이 열린다. 임시 통제로 공유 토큰(`ADMIN_API_TOKEN`)을 요구하고 **토큰이 없으면 경로를 등록하지 않는다**. WP-012가 역할 판정을 세우면 대체된다. (5) DEV-026 — `EVT-ING-004`의 소비자 `ops`는 스트림 소비자가 아니라 테이블을 읽는 조회 모듈이고 경보 경로는 지표가 맡는다. 지금 발행하면 소비자 없는 토픽이 하나 생긴다. 워커가 `dead_letter` 행을 동기적으로 남기므로 기록 유실이 아니며, 발행 여부는 알림 소비자가 생기는 REL-005에서 정한다 — `open`으로 남긴다. 저장소 필터를 위해 `dead_letter.repository_id`를 더한다(`raw_event`는 `received_at` 파티션이라 `delivery_id` 조인이 전 파티션을 훑는다). **제품 범위 변경이 아니라 이미 승인된 요구사항 사이의 정합성 수정이므로 SRS 버전은 v2.2를 유지한다** (CR-006·CR-007·CR-010·CR-011과 같은 처리) | DEV-022, DEV-023, DEV-024, DEV-025, DEV-026, DEV-027, FR-ING-007, ENT-ING-002, API-ADM-003, JOB-ING-009, EVT-ING-004 | `pr_search_data_model.md`, `pr_search_async_events_jobs.md`, `pr_search_api_contracts.md`, `pr_search_backend_architecture.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-013 | 2026-08-21 | correction | WP-010 착수 전 저장소 등록·파이프라인 상태 계약 감사에서 확인된 DEV-028~033 | **CR-012를 다시 만들지 않는다.** WP-010이 딛고 설 계약을 정합하게 만든다. (1) DEV-028 — `prs-commits` 매핑에 `repository_archived`가 없다. 매핑이 `dynamic: strict`라 없는 필드는 **거부되므로** 해제한 저장소의 커밋 문서에 표식을 붙일 방법이 아예 없었다. FR-SRCH-002(SHA → PR)가 커밋 문서를 직접 결과로 내놓으므로 표식 없는 커밋은 해제된 저장소를 살아 있는 것처럼 보여 준다. 매핑에 더하고, 해제 시 기존 문서에도 `update_by_query`로 소급한다. `document_version`은 건드리지 않는다 — 등록 상태는 웹훅이 나르는 엔티티 상태가 아니라 이 시스템이 소유한 운영 상태다. (2) DEV-029 — FR-ADMIN-001 AC-1의 **단계별 지연 p50/p95를 `search-api`가 읽을 수 없다.** `stage_latency_seconds`는 워커 프로세스 메모리의 히스토그램이고, "지표 저장소"는 사내 Prometheus 호환 외부 의존이라 개발·CI에 주소가 없다. 항목별로 출처를 정한다 — 수신량·수집 반영 지연·저장소별 상위 10은 PostgreSQL에서 정확히 계산하고, 대기열은 Redis, 실패 대기열은 PostgreSQL, 보강 대기는 ES에서 읽는다. 단계별 지연만 `METRICS_QUERY_URL`이 설정된 경우 질의하고 아니면 `unavailable`로 둔다. **워커 복제본 하나를 긁어 클러스터 전체인 양 내놓지 않는다.** (3) DEV-030 — FR-ING-009 AC-5의 감사 기록에 넣을 신원이 WP-012(OIDC)까지 없다. CR-012가 세운 공유 토큰을 **이름 붙은 토큰**(`ADMIN_API_TOKENS="alice:tok1,bob:tok2"`)으로 넓혀 어느 운영자 자격 증명이 실행했는지가 감사 기록에 실제로 남게 한다. 단일 `ADMIN_API_TOKEN`도 계속 동작한다. WP-012가 OIDC 신원으로 대체한다. (4) DEV-031 — 백필의 실행 주체 `batch`는 WP-019가 세운다(DEV-024와 같은 형태). 등록 시 `backfill: true`면 `job` 행만 `queued`로 넣고 실행은 WP-019부터다. 요청을 조용히 버리지 않는다. (5) DEV-032 — `pnpm test:e2e`·`pnpm test:a11y` 스크립트가 저장소에 없는데 WP 21곳이 검증 방법으로 참조한다. WP-010이 그 첫 자리다. 이 WP는 화면을 만들지 않으므로(사용자 결정: API까지) API 수준 end-to-end로 대체하고, 나머지 참조는 화면을 소유한 WP가 harness와 함께 세운다. (6) DEV-033 — `RepositorySummary`가 `owner.id`와 `visibility`를 선언하지 않는다. `repository` 테이블은 `org_id`를 NOT NULL로, `visibility`를 `public|internal|private` CHECK로 요구하며 **ADR-008의 필수 접근 범위 필터가 바로 그 두 필드 위에 서 있다.** `private: boolean`로는 `internal`을 구분할 수 없는데, 이 조직의 저장소 대부분이 internal이다. 타입과 목 서버를 함께 넓힌다. **제품 범위 변경이 아니라 이미 승인된 요구사항 사이의 정합성 수정이므로 SRS 버전은 v2.2를 유지한다** | DEV-028, DEV-029, DEV-030, DEV-031, DEV-032, DEV-033, DEV-034, FR-ING-009, FR-ADMIN-001, API-ADM-001, API-ADM-006, ENT-CORE-001, ENT-CORE-003 | `pr_search_data_model.md`, `pr_search_api_contracts.md`, `pr_search_observability_reliability.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-014 | 2026-08-21 | correction | WP-011 착수 전 질의 문법 계약 감사에서 확인된 DEV-035~039 | **CR-013을 다시 만들지 않는다.** WP-011 파서가 딛고 설 문법 계약을 정합하게 만든다. (1) DEV-035 — API-SRCH-004의 `parsed.filters`에 **부정된 범위를 담을 `op`이 없다.** FR-SRCH-005 AC-6의 `-`는 문법 수준에서 모든 키에 붙으므로 범위에만 붙일 수 없게 하면 사용자가 이해할 수 없는 특례가 된다. `not_range`를 더한다. (2) DEV-036 — AC-1이 `is`의 값을 `merged`/`open`/`closed`/`reverted`로 **열거했는데 그 밖의 값이 왔을 때의 처리가 없다.** 조용히 통과시키면 아무것도 맞지 않는 필터가 되어 "파싱 실패 시 검색을 실행하지 않고 오류 위치를 반환한다"는 예외 처리의 취지와 어긋난다. **값을 열거한 키에만** 값 검증을 하고 `state`처럼 열거되지 않은 키에는 하지 않는다 — 없는 제약을 지어내지 않는다. (3) DEV-037 — **어느 키가 `a..b`를 받는지가 어디에도 없다.** AC-2가 `seq`, AC-3이 `merged`를 예로 들 뿐이다. `seq`·`merged`·`created` 셋으로 못 박고, 그 밖의 키에서 `..`는 리터럴로 둔다 — `path:src/a..b`는 범위가 아니라 그 문자열이다. (4) DEV-038 — `QUERY_TOO_SHORT`(전문 검색어 1자)를 **파서와 API 중 누가 판정하는지가 없다.** 무엇이 전문 검색어인지 아는 곳은 파서뿐이므로 파서가 코드와 오프셋을 함께 돌려주고 API는 그대로 싣는다. (5) DEV-039 — `@prs/query`의 `IMPLEMENTED_BY`가 **WP-025를 가리킨다.** WP-025는 W-004 범위 조사 화면이고 이 패키지를 채우는 것은 WP-011이다. **제품 범위 변경이 아니라 승인된 요구사항이 남긴 빈칸을 메우는 것이므로 SRS 버전은 v2.2를 유지한다** | DEV-035, DEV-036, DEV-037, DEV-038, DEV-039, FR-SRCH-005, API-SRCH-004 | `pr_search_api_contracts.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
유형: `scope`(범위 변경), `design`(설계 변경), `implementation`(구현 편차 DEV-### 처리), `correction`(문서 오류 수정)

| CR-015 | 2026-08-21 | correction | WP-012 착수 전 인증·접근 범위 계약 감사에서 확인된 DEV-040~049 | **CR-014를 다시 만들지 않는다.** WP-012가 딛고 설 인증·권한 계약을 정합하게 만든다. (1) DEV-040 — API-AUTH-001 `/me`가 카탈로그 한 줄뿐이고 **4장에 상세 규격이 없다.** WP-012의 DoD가 이 엔드포인트를 요구하는데 응답 모양이 정해져 있지 않다. 접근 범위 **요약**을 돌려준다 — 저장소 ID 목록을 그대로 실으면 500개 초과 사용자에서 응답이 수십 KB가 되고, 조직의 저장소 인벤토리를 그대로 내주는 것이기도 하다. (2) DEV-041 — `EVT-AUTH-001` payload가 **두 문서에서 다르다.** 비동기 문서는 `{ user_ids[], team_id, repository_id, reason }`, API 계약 7장은 `team_id`가 없다. `team` 웹훅은 팀 전원에 영향을 주는데 게이트웨이가 수신 경로 안에서 팀을 구성원으로 펼치려면 GHE 동기 호출이 필요하고, 그것은 NFR-002의 수신 p95 300ms를 그대로 무너뜨린다. `team_id`를 실어 보내고 소비자가 펼친다. (3) DEV-042 — `EVT-AUTH-001`의 producer가 `ingest-gateway`로 적혀 있으나 **게이트웨이는 `prs:ingest`에만 발행한다.** `member`/`team`/`repository` 이벤트는 보강 워커까지 흘러가 `skip`으로 끝나므로(DEV-016) FR-AUTH-003 AC-2의 "즉시 무효화"에 경로가 아예 없다. `prs:permission` 발행을 더한다 — 원본 보관은 그대로다. (4) DEV-043 — `app_user.user_id`가 **무엇인지 정의되어 있지 않다.** 세션은 OIDC `sub`로 만들어지는데 무효화 이벤트는 GHE 신원(login·숫자 id)으로 도착하고, 둘을 잇는 것이 없다. `user_id`를 OIDC `sub`로, `login`을 GHE login으로 못 박고 `github_user_id`를 더한다 — login은 개명될 수 있으나 숫자 id는 아니다. (5) DEV-044 — `access_scope_version`이 ENT-CORE-005와 테이블에 있으나 **의미가 어디에도 없다.** 울타리가 없으면 회수 직전에 시작된 GHE 조회가 회수 뒤에 끝나면서 회수 이전 범위를 캐시에 다시 써 넣는다. 그 사용자는 계속 조회할 수 있고, 이는 FR-AUTH-003 AC-4를 정면으로 어긴다. 무효화마다 증가시키고, 갱신은 시작 시점 값이 그대로일 때만 기록한다. (6) DEV-045 — `repository` 웹훅의 대상이 "영향 사용자"로만 적혀 있고 **그들을 찾을 방법이 없다.** `permission_cache.repository_ids`에 색인이 없고, `org_team` 모드 사용자는 저장소를 아예 나열하지 않는다. GIN 색인을 더하고 영향 집합을 (그 저장소를 명시적으로 담은 캐시) ∪ (그 저장소의 조직을 담은 `org_team` 캐시)로 정의한다. (7) DEV-046 — `team_member`를 **아무것도 채우지 않는다.** ENT-CORE-004는 `member_ids[]`를 선언하고 DEV-041의 `team_id` 펼치기가 이 표에 의존한다. `team` 이벤트를 받은 소비자가 GHE에서 구성원을 다시 읽어 표를 갱신하고, 같은 응답으로 무효화 대상을 만든다. (8) DEV-047 — `web` → `search-api`의 **신원 전달 방법이 없다.** ADR-011은 `web`이 세션을 검증하고 클라이언트 헤더를 전달하지 않는다고만 하고, 인프라 문서는 IdP 아웃바운드를 `web`에만 허용한다. `X-User-Id` 같은 헤더를 믿으면 클러스터 안 무엇이든 신원을 위조할 수 있다. **세션 쿠키만 허용 목록으로 전달하고 `search-api`가 같은 Redis 세션 저장소에서 직접 해석한다** — 세션이 서버 측에 있으므로 위조한 쿠키 값은 아무것도 열지 못한다. (9) DEV-048 — CR-012·CR-013이 세운 임시 공유 토큰 통제의 **인계 방법이 정해져 있지 않다.** OIDC가 구성되면 `/admin/*`의 통제는 세션 + `operator` 역할이고, 이름 붙은 토큰 경로는 OIDC가 **구성되지 않은** 경우에만 남는다. 둘을 배타로 두어 실제 세션 옆에 토큰 우회가 열려 있는 배포가 생기지 않게 한다. (10) DEV-049 — 역할이 `developer` 기본값·IdP 그룹 매핑·관리자 지정 셋으로 부여되는데 **로그인 시 어떻게 합쳐지는지가 없다.** IdP 클레임으로 덮어쓰면 관리자가 지정한 `operator`가 다음 로그인에 조용히 사라지고, 반대로 IdP 그룹을 `operator`까지 믿으면 그룹 관리자가 운영 권한을 발급할 수 있게 된다. IdP 그룹은 `manager`·`qa`에만 매핑하고 나머지는 DB 지정값을 쓰며, 합집합으로 합친다. **제품 범위 변경이 아니라 이미 승인된 요구사항 사이의 정합성 수정과 빈칸 메우기이므로 SRS 버전은 v2.2를 유지한다** | DEV-040, DEV-041, DEV-042, DEV-043, DEV-044, DEV-045, DEV-046, DEV-047, DEV-048, DEV-049, DEV-050, DEV-051, FR-AUTH-001, FR-AUTH-002, FR-AUTH-003, API-AUTH-001, EVT-AUTH-001, JOB-AUTH-001, ENT-CORE-004, ENT-CORE-005 | `pr_search_api_contracts.md`, `pr_search_async_events_jobs.md`, `pr_search_security_privacy_architecture.md`, `pr_search_data_model.md`, `pr_search_backend_architecture.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |

| CR-016 | 2026-08-21 | correction | WP-013 착수 전 검색 계약 감사에서 확인된 DEV-052~058 | **CR-015를 다시 만들지 않는다.** WP-013 목록 조회가 딛고 설 계약을 정합하게 만든다. (1) DEV-052 — **질의 키 15종이 어느 ES 필드로 가는지가 어디에도 없다.** 대부분은 이름이 같지만 둘은 문서만으로 풀리지 않는다: `org:acme`는 문서에 `org_id`(숫자)만 있고 조직 **이름**이 없으며, `team:payments-core`도 `allowed_team_ids`(숫자)만 있고 slug이 없다. 레지스트리에서 이름→ID로 해석한다 — 재색인 없이 풀리고, 등록 정보의 주인이 레지스트리이기 때문이다. (2) DEV-053 — **`is`의 뜻이 정의되어 있지 않다.** 값 넷 중 `merged`·`open`·`closed`는 `state`와 겹치고 `reverted`만 `link_summary.is_reverted`다. 둘이 같은 뜻이면 키가 둘일 이유가 없고, 다르면 무엇이 다른지가 있어야 한다. `is`를 **파생 상태**로 정의한다 — `state`는 GitHub이 준 값을 그대로 보고, `is`는 이 시스템이 계산한 것까지 본다. (3) DEV-054 — **`/search`가 어느 인덱스를 도는지가 정해져 있지 않다.** API-SRCH-004의 목적은 "PR·커밋 목록"이고 W-001-RESULTS도 유형 열에 PR/커밋을 적었는데, 응답 예시에는 `kind: pull_request`만 있고 `search` 파사드는 별칭 하나만 받는다. **실측으로 확인한 것**: 여러 인덱스를 함께 조회할 때 한쪽에만 있는 필드로 **필터**하면 조용히 무매치지만(정상), 같은 필드로 **정렬**하면 HTTP 200에 `_shards.failed`가 붙은 **부분 실패**가 된다 — 한 인덱스가 통째로 빠진 결과가 정상처럼 돌아온다. 모든 정렬 키에 `unmapped_type`을 붙이고 `_shards.failed`를 검사한다. (4) DEV-055 — **`relaxation_hints` 산출 방법이 없다.** 필터 N개마다 질의를 한 번씩 더 던지면 NFR-001의 p95 500ms 예산을 N배로 쓴다. `msearch` 한 번으로 묶고 후보를 **상한 8개**로 자르며, 상한을 넘으면 잘랐다는 사실을 응답에 남긴다. (5) DEV-056 — **`relevance` 정렬이 전문 검색 없이는 뜻이 없다.** WP-013은 전문 검색을 제외하고(WP-032), 접근 범위 필터는 `filter` 절이라 점수를 만들지 않는다. 이 WP에서는 받되 **문서 ID 순으로 떨어진다**고 적고, 전문 검색이 서는 WP-032에서 실제 점수가 붙는다. (6) DEV-057 — **`facets`·`next_cursor`가 WP-013 범위 밖인데 응답 예시에는 늘 있다.** 화면이 없는 키와 `null`을 구분하지 못하면 페이저가 마지막 페이지를 오해한다. `next_cursor`는 **항상 `null`로 실어 보내고**, `facets`는 **키 자체를 넣지 않는다** — 빈 객체는 "패싯이 없다"로 읽힌다. (7) DEV-058 — **`pnpm test:perf` 스크립트가 저장소에 없다** (DEV-032와 같은 형태). NFR-001의 p95 500ms는 1000만 문서 합성 데이터셋을 요구하는데 이 실행 환경에 없다. 질의 **모양**이 상수 시간임을 시험으로 고정하고, 실측은 REL-002 성능 게이트로 넘긴다 — **측정하지 않은 것을 통과로 적지 않는다**. **제품 범위 변경이 아니라 이미 승인된 요구사항이 남긴 빈칸을 메우는 것이므로 SRS 버전은 v2.2를 유지한다** | DEV-052, DEV-053, DEV-054, DEV-055, DEV-056, DEV-057, DEV-058, DEV-059, FR-SRCH-005, FR-SRCH-006, FR-SRCH-007, NFR-001, API-SRCH-004, ENT-CORE-002 | `pr_search_api_contracts.md`, `pr_search_data_model.md`, `pr_search_backend_architecture.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |

| CR-017 | 2026-08-21 | correction | WP-014 착수 전 식별자 해석 계약 감사에서 확인된 DEV-060~066 | **CR-016을 다시 만들지 않는다.** WP-014 식별자 해석이 딛고 설 계약을 정합하게 만든다. 감사의 결론 하나가 나머지를 지배한다: **커밋 문서는 SHA와 역할과 소속 PR 번호만 갖는다.** 매핑에는 `message`·`author`·`authored_at`·`parent_shas` 자리가 있으나 투영이 채우지 않는다 — `EVT-ING-002`가 커밋에 대해 SHA만 나르기 때문이다. WP-014는 조회 계층이므로 이것을 고칠 수 없고, 고치는 척해서도 안 된다. (1) DEV-060 — **API-SRCH-002의 커밋 상세가 채워지지 않는 필드 11종을 약속한다.** 응답에서 **없는 키는 넣지 않는다** — CR-016 DEV-057이 `facets`에 세운 규칙과 같다(키 없음 = 만들지 않았다, `null` = 만들었는데 비었다). 0이나 빈 문자열로 채우면 "파일을 하나도 안 바꾼 커밋"과 구분되지 않는다. (2) DEV-061 — **`role: direct_push`에 도달할 수 없다.** 커밋 문서는 PR 이벤트에서만 만들어지고 `push`는 ack 후 버려진다(DEV-016). 직접 푸시 커밋은 문서 자체가 없어 404가 된다. **동작을 지어내지 않고 QA-W003-03을 NOT SATISFIED로 기록한다.** (3) DEV-062 — **`source_commits`가 객체 배열인데 PR 문서는 SHA 배열만 갖는다.** 모양은 계약대로 객체로 내되 `commit_sha`만 채운다. (4) DEV-063 — **`source_commits_total`이 저장되지 않는다.** 절삭되지 않았을 때만 배열 길이가 곧 총계다. 절삭됐을 때 250을 총계로 내보내면 거짓이므로 **키를 빼고** `source_commits_truncated: true`만 남긴다. (5) DEV-064 — **`search-api`에 GHE 호스트 설정이 없다.** 해석 1단계가 호스트+경로인데 무엇이 우리 호스트인지 알 방법이 없다. 호스트를 안 보면 아무 URL의 경로나 우리 저장소로 해석된다. `GHE_BASE_URL`을 더하고 호스트가 다르면 `text`로 떨어뜨린다. (6) DEV-066 — **순수 정수와 SHA 접두가 겹치는데 해석 순서가 이를 가르지 않는다.** `1234567`은 PR 번호이자 유효한 SHA 접두다. 순서를 문자 그대로 읽으면 40자리 숫자도 PR이 되어 커밋 조회가 영영 일어나지 않는다. 해석을 **우선순위 있는 목록**으로 보고 겹치는 입력은 두 경로를 다 조회해 후보를 합친다 — FR-SRCH-001 AC-5가 이미 "후보 2건 이상이면 배열로 반환하고 자동 이동하지 않는다"로 이 상황을 정의한다. (7) DEV-065 — **릴리스 태그의 패턴이 어디에도 정의되어 있지 않다.** 해석 순서 7단계가 "태그 패턴"을 말하지만 그 패턴이 무엇인지는 SRS에도 아키텍처에도 없다. **정규식을 지어내지 않는다** — 릴리스를 색인하는 WP-024가 패턴을 정의할 때까지 태그처럼 보이는 문자열은 `text`다. **제품 범위 변경이 아니라 이미 승인된 요구사항이 남긴 빈칸을 메우고 채울 수 없는 약속을 걷어내는 것이므로 SRS 버전은 v2.2를 유지한다** | DEV-060, DEV-061, DEV-062, DEV-063, DEV-064, DEV-065, DEV-066, FR-SRCH-001, FR-SRCH-002, FR-SRCH-003, FR-SRCH-004, API-SRCH-001, API-SRCH-002, API-SRCH-003, ENT-CORE-002, ENT-CORE-003, QA-W003-03 | `pr_search_api_contracts.md`, `pr_search_backend_architecture.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |

| CR-018 | 2026-08-21 | correction | WP-015 착수 전 웹 셸 계약 감사에서 확인된 DEV-067~071 (구현 중 DEV-072 추가) | **CR-017을 다시 만들지 않는다.** 첫 화면 WP가 딛고 설 계약을 정합하게 만든다. Conductor 패키지 셋(`react` 0.1.1 / `css` 0.1.0 / `tokens` 0.1.0)은 실제로 설치 가능하며 `AppShell`·`NavList`·`TopBar`·`EmptyState`·`Banner`·`checkContrast`를 모두 제공한다 — 실측으로 확인했다. 막힌 것은 디자인 시스템이 아니라 그 주변의 다섯이다. (1) DEV-067 — **프런트엔드 문서 §10이 CR-015의 결정과 정면으로 어긋난다.** 프록시가 "사용자 식별 헤더를 부착"하라고 적혀 있는데, DEV-047이 정하고 WP-012가 구현·시험한 것은 그 반대다: `search-api`는 신원을 주장하는 **어떤 헤더도 읽지 않고** 세션 쿠키를 Redis에서 직접 해석한다. 문서대로 만들면 프록시가 붙인 헤더는 무시되고 모든 요청이 401이 된다. **세션 쿠키만 허용 목록으로 전달한다.** (2) DEV-068 — **`Role` 타입이 클라이언트에 닿지 않는다.** C-002가 `roles: Role[]`을 요구하는데 `@prs/authz`의 진입점이 `@prs/es`를 재수출한다. 클라이언트 컴포넌트에서 import하면 Node 전용 `@elastic/elasticsearch`가 브라우저 번들로 끌려온다. `roles.ts`는 import가 **0개**라 그 자체로 클라이언트 안전하므로 **서브패스 export `@prs/authz/roles`**를 연다. web에 목록을 복제하지 않는다 — 역할이 늘면 갈라진다. (3) DEV-069 — **`test:a11y`·`test:e2e` 스크립트가 없다** (DEV-032). WP-015의 검증 방법이 그 둘을 부르는데 저장소에 없다. 화면을 처음 세우는 WP이므로 **여기서 harness를 세운다** — a11y는 vitest + axe, e2e는 Playwright(Chromium 사전 설치). (4) DEV-070 — **`⌘K`가 포커스할 대상이 이 WP 범위에 없다.** C-001이 `omniSearch: ReactNode`를 요구하고 DoD가 단축키를 요구하는데 C-010 `OmniSearchInput`은 W-001(WP-016)의 컴포넌트다. **셸이 단축키와 슬롯 계약을 소유하고** WP-016이 C-010을 슬롯에 넣는다. (5) DEV-071 — **OIDC 콜백이 세션을 발급할 경로가 네트워크 정책에 없다.** 인프라 문서의 아웃바운드 허용 목록은 `web` → OIDC IdP만 열고 `web` → Redis는 어디에도 없는데, 정책이 허용 목록 방식이라 목록에 없으면 차단된다. 게다가 `state`·`nonce`·`codeVerifier`·`returnTo` 넷을 인가 리다이렉트와 콜백 **사이에 어디에 보관하는지**가 없다. 허용 목록에 `web` → Redis를 더하고, 넷은 **짧은 수명의 HttpOnly 쿠키**로 나른다. **제품 범위 변경이 아니라 이미 승인된 요구사항이 남긴 빈칸을 메우고 서로 어긋난 두 문서를 맞추는 것이므로 SRS 버전은 v2.2를 유지한다** | DEV-067, DEV-068, DEV-069, DEV-070, DEV-071, DEV-072, DEV-073, DEV-074, FR-AUTH-001, NFR-007, API-AUTH-001, C-001, C-002, C-004, C-005, FLOW-000 | `pr_search_frontend_architecture.md`, `pr_search_infrastructure_operations.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-019 | 2026-08-21 | correction | WP-016 착수 전 W-001 계약 감사에서 확인된 DEV-075~081 | **첫 화면이 소비할 계약을 정합하게 만든다.** 조회 API 셋(WP-013·WP-014)과 셸(WP-015)은 이미 서 있고, 막힌 것은 그 사이를 잇는 일곱이다. (1) DEV-075 — **QA-W001-14가 WP-016과 WP-032 양쪽 DoD에 있다.** WP-016은 커서 페이징을 명시적으로 제외하는데 그 항목을 통과 기준으로 인용한다. `next_cursor`는 WP-032까지 항상 `null`이다. 항목을 둘로 가른다: **"페이지 번호 UI가 없다"는 지금 검증한다**(오프셋 페이징을 시사하는 UI를 두지 않는다는 **금지** 규칙이라 데이터 없이도 성립하고, 나중에 세우면 이미 잘못 만든 뒤다). "커서 기반으로 동작한다"는 WP-032. (2) DEV-076 — **`facets`·`facets_omitted`를 계약은 항상 싣는다고 적었으나 구현은 둘 다 넣지 않는다**(CR-016 DEV-057: 키 없음 = 만들지 않았다). 게다가 상태가 셋(계산 안 함 / 계산했고 생략 없음 / 예산 초과로 생략)인데 계약은 둘만 정의한다. 키 부재를 **`not_computed`로 렌더링**하고 사유를 표시한다 — C-012의 "조용히 비우지 않는다"를 지킨다. (3) DEV-077 — **C-014의 필수 prop `space: SequenceSpaceRef`·`epoch: number`가 널을 허용하지 않는데 데이터는 WP-021까지 전부 `null`이다.** `SequenceSpaceRef` 타입은 어디에도 정의가 없다. 상태 목록의 `unassigned`(미머지)와 **"아직 계산하지 않았다"는 다른 것**이므로 `not_computed`를 더하고 `space`·`epoch`를 널 허용으로 고친다. (4) DEV-078 — FLOW-001 4단계가 요구하는 **"이동 전 원본 입력을 URL에 남긴다"의 파라미터 이름이 없다.** `from_q`로 정한다. (5) DEV-079 — **C-010의 필수 prop `recentQueries`의 출처가 정해져 있지 않다.** 저장 위치를 지어내지 않고 **선택 prop으로 낮춘다**. (6) DEV-080 — **QA-W001-06의 "50건 초과"와 `/resolve`의 기본 `limit=10`이 어긋난다.** API를 고치지 않고 **화면이 `limit=50`을 명시해 부른다** — FR-SRCH-004 AC-3의 경계는 상한(`MAX_PREFIX_CANDIDATES=50`)이 이미 지키고, 기본 10은 다른 소비자에게 합리적이다. (7) DEV-081 — **W-001-RESULTS가 "관계 배지" 열을 요구하지만 `C-015`는 WP-031 소관이고 `link_summary`는 WP-029까지 비어 있다.** 열을 미리 만들지 않는다 — 빈 열은 "관계 없음"으로 읽힌다. **제품 범위 변경이 아니라 이미 승인된 요구사항이 남긴 빈칸을 메우고 서로 어긋난 문서를 맞추는 것이므로 SRS 버전은 v2.2를 유지한다** | DEV-075, DEV-076, DEV-077, DEV-078, DEV-079, DEV-080, DEV-081, FR-SRCH-001, FR-SRCH-004, FR-SRCH-005, FR-SRCH-006, FR-SRCH-007, FR-SRCH-008, C-010, C-011, C-012, C-013, C-014, C-017, W-001, FLOW-001 | `pr_search_ui_component_spec.md`, `pr_search_wireframe_spec.md`, `pr_search_api_contracts.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-020 | 2026-08-21 | correction | WP-017 착수 전 W-002 계약 감사에서 확인된 DEV-082~088 | **상세 화면이 없는 값을 지어내지 않게 만든다.** 감사에서 나온 일곱 중 다섯이 같은 모양이다 — 명세가 요구하는 필드의 **데이터가 아직(또는 영영) 없는데 타입이 그것을 표현하지 못한다.** (1) DEV-082 — **`QA-W002-03`이 통과할 수 없다.** FR-SRCH-003 AC-4는 절삭 시 "앞의 250건과 **전체 건수**"를 요구하는데, `source_commits_total`은 **절삭됐을 때 정확히 그때** 빠진다(CR-017 DEV-063: 진짜 총계를 모르므로 250을 총계로 내보내면 거짓이다). DEV-075와 같이 **항목을 가른다** — "절삭 표시"는 지금, "전체 건수"는 `EVT-ING-002` 확장 뒤. (2) DEV-083 — **C-018의 `totalCount: number`가 널을 허용하지 않는다.** 위와 같은 이유로 절삭 시 값이 없다. 널 허용으로 고치고 **"250건 이상(정확한 수 모름)"과 확정 총계를 다른 문구로** 표시한다. 가짜 숫자를 그리지 않는다. (3) DEV-084 — **C-022 타임라인의 5단계 중 2단계에 데이터가 없다.** "승인"은 `approved_by`(로그인 목록)만 있고 **`approved_at`이 매핑에 없다** — 시각을 모른다. "릴리스 포함"은 WP-024다. 단계 모양에 **"일어났고 시각을 안다" / "일어났지만 시각을 모른다" / "아직 일어나지 않았다" / "이 WP 범위 밖"** 넷을 구분해 넣는다. 시각을 지어내지 않는다. (4) DEV-085 — **W-002-OVERVIEW가 "리뷰어와 리뷰 상태"를 요구하지만 리뷰 상태가 저장되지 않는다.** 투영에는 `reviewers`·`approved_by` 로그인 목록뿐이고 리뷰어별 상태(대기/변경 요청)가 없다. **승인함/아직 아님**까지만 파생한다 — "변경 요청"을 지어내지 않는다. (5) DEV-086 — **C-023의 `externalUrl`을 만들 재료가 응답에 없다.** API의 `url`은 **내부 경로**(`/pr/...`)다. GHE URL 형식은 SRS AC-3이 `https://<host>/<owner>/<repo>/pull/<N>`으로 정하므로 `GHE_BASE_URL`로 만들되, **미구성이면 버튼을 그리지 않는다** — 죽은 링크보다 없는 편이 낫다. (6) DEV-087 — **`epoch_stale` 상태에 도달할 방법이 없다.** 시퀀스가 WP-021까지 전부 `null`이고, 에폭 변경을 감지할 경로(URL이 에폭을 나르는지, 재조회로 비교하는지)가 정해져 있지 않다. **만들지 않는다** — 도달 불가능한 코드는 검증할 수 없다(CR-018 DEV-073에서 얻은 교훈). WP-021이 시퀀스를 채울 때 함께 정한다. (7) DEV-088 — **`QA-W002-17`도 절반만 검증된다.** "관계·동시 변경 섹션이 확장 시에만 조회된다"인데 관계 데이터가 WP-031이라 **조회할 것이 없다**. "확장 전에 조회하지 않는다"(구조)는 지금 세우고 "확장하면 조회한다"는 WP-031. (8) DEV-089 — **구현 중 추가로 확인**: `repository_archived`(FR-ING-009 AC-3)와 `files_truncated`(FR-ING-007 AC-4)는 파이프라인이 실제로 채우는데 **어느 화면의 섹션 정의에도 표시 요구가 없다.** 보관된 저장소의 PR이 왜 갱신되지 않는지, 파일 목록이 잘렸는지를 사용자가 알 방법이 없다 — 커밋 절삭(DEV-082)과 같은 종류의 거짓이다. W-002가 둘 다 표시한다. **제품 범위 변경이 아니라 이미 승인된 요구사항이 남긴 빈칸을 메우는 것이므로 SRS 버전은 v2.2를 유지한다** | DEV-082, DEV-083, DEV-084, DEV-085, DEV-086, DEV-087, DEV-088, DEV-089, FR-SRCH-003, FR-STAT-003, FR-STAT-004, FR-ING-007, FR-ING-009, C-018, C-022, C-023, W-002, FLOW-002 | `pr_search_ui_component_spec.md`, `pr_search_wireframe_spec.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-021 | 2026-08-22 | correction | WP-018 착수 전 W-003 계약 감사에서 확인된 DEV-090~096 | **커밋 상세가 커밋에 대해 아는 것이 SHA와 역할뿐인데 명세는 여섯 가지를 요구한다.** 일곱 중 넷이 같은 뿌리다 — `EVT-ING-002`가 커밋에 대해 **SHA만 나른다**(CR-017, DEV-060). (1) DEV-090 — `W-003-HEADER`의 **메시지 첫 줄·작성자·시각**이 커밋 문서에 없다. **소속 PR에서 빌려오지 않는다** — 커밋 메시지 자리에 PR 제목을 넣으면 원본 커밋 N건이 전부 같은 제목이 되고, 체리픽·되돌림 조사가 정확히 반대의 결론에 이른다. 표시명은 축약 SHA이고 없는 것은 "수집 전"이라고 밝힌다. (2) DEV-091 — **`no_sequence` 안내의 머지 커밋 링크를 만들 재료가 응답에 없다.** 상태 매트릭스가 정한 복구 경로("머지 커밋 이동")가 성립하지 않는다. 값은 이미 PR 문서에 있고 `PullRequestSource`가 선언하고 있으므로 **`linkedPullRequest`가 `merge_commit_sha`를 싣게 한다** — 없는 데이터를 만드는 것이 아니라 있는 것을 내보내는 정합성 수정이다. (3) DEV-092 — **`no_sequence`와 미채번을 시퀀스 값으로 가를 수 없다.** `merge_seq`가 WP-021까지 모든 커밋에서 `null`이라 값만 보면 머지 커밋까지 "체인 밖"이 된다. **역할로 판정한다** — `source_commit`은 정의상 first-parent 체인 밖이고, 이는 시퀀스 없이 지금 말할 수 있는 사실이다. DEV-077의 커밋판. (4) DEV-093 — **`QA-W003-03`과 상태 `no_pr`이 요구하는 `direct_push`가 도달 불가다**(DEV-061). 한편 서버는 PR이 비면 `reason_code: 'no_pull_request'`를 싣는데 그것은 "투영이 아직 PR 번호를 잇지 못했다"이지 직접 푸시가 아니다. **항목을 가르고**, 화면은 그것을 "직접 푸시"라고 **부르지 않는다.** 역할 배지 매핑에는 세 값을 모두 두되 셋째가 도달하지 않음을 기록한다 — `epoch_stale`(DEV-087)과 달리 화면 상태 전체가 아니라 전량 매핑의 한 값이라 만든다. (5) DEV-094 — **`C-025`의 `totalCount: number`가 널을 허용하지 않는데 채울 데이터가 없다.** `0`을 넣으면 *파일을 하나도 바꾸지 않은 커밋*과 구분되지 않는다(DEV-083과 같은 모양). 널 허용으로 넓히고 섹션은 골격 + 사유. **`QA-W003-08`(파일 내용 미표시)은 금지 규칙이라 데이터 없이 성립하므로 지금 세운다.** (6) DEV-095 — **커밋의 `enrichment_pending`이 상태 이름("PR 연결 미완료")과 다른 것을 뜻한다.** 투영은 PR 이벤트의 보강 상태를 그대로 복사한다. 하나로 읽으면 보강 중인 PR의 머지 커밋이 "PR 연결 없음"으로 표시된다. 둘을 따로 다룬다 — 사용자가 할 일이 다르다. (7) DEV-096 — **`C-024`의 복사 실패 경로가 명세에 없다.** `navigator.clipboard`는 보안 컨텍스트에서만 있고, 실패가 조용하면 사용자는 복사됐다고 믿고 붙여넣는다 — 조사 도구에서 잘못된 SHA는 조사 결과 전체를 틀리게 만든다. 실패도 알리고 전체 SHA를 선택 가능한 텍스트로 남긴다. (8) DEV-097 — **구현 중 추가로 확인**: FLOW-001 4단계("후보 1건이면 상세로 이동")가 **구현되어 있지 않아 W-001이 후보 1건에서 영원히 멈춘다.** CR-019 DEV-078이 그 이동을 위해 `from_q`까지 정해 두었는데 이동 자체가 없었다. 40자 SHA 붙여넣기는 이 제품에서 가장 흔한 입력이고 FLOW-001은 명세가 "가장 중요한 흐름"이라 부르는 것이다. WP-018의 DoD(FLOW-002 전 경로 E2E)를 쓰다가 드러났다. **이동은 제출에 대한 응답으로만 일어나게 한다** — 해석 결과에만 걸면 뒤로가기가 튕겨 나가 사용자가 검색 화면에 닿지 못한다. **제품 범위 변경이 아니라 이미 승인된 요구사항이 남긴 빈칸을 메우는 것이므로 SRS 버전은 v2.2를 유지한다** | DEV-090, DEV-091, DEV-092, DEV-093, DEV-094, DEV-095, DEV-096, DEV-097, FR-SRCH-002, FR-SRCH-001, FR-SEQ-001, FR-ING-004, C-024, C-025, W-001, W-003, FLOW-001, API-SRCH-002 | `pr_search_ui_component_spec.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_api_contracts.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-022 | 2026-08-22 | correction | WP-019 착수 전 저장소 백필 계약 감사에서 확인된 DEV-098~105 | **백필이 딛고 설 것 중 절반이 없다.** 여덟 중 넷은 수단이 아예 없는 자리이고, 셋은 실시간 수집과 부딪히는 자리다. (1) DEV-098 — **`GitHubClient`에 저장소의 PR 목록을 나열하는 메서드가 없다.** 백필의 첫 줄을 쓸 수단이 없다. `listPullRequestsPaged`를 더하되 **정렬을 `updated asc`로 고정한다** — 기본값 `created desc`면 백필 도중 갱신된 PR이 페이지를 밀어 항목이 조용히 건너뛰어지고, "수집됐다고 믿었는데 없는 PR"은 조사 결과를 통째로 틀리게 만든다. (2) DEV-099 — **백필 문서의 `document_version`이 정해져 있지 않다.** 지금 시각을 쓰면 백필이 언제나 이겨 **실시간 문서를 덮어쓴다**(AC-5 정면 위반). **엔티티의 `updated_at`**을 쓴다 — 웹훅 수신은 언제나 갱신보다 뒤이므로 같은 사실에 대해 실시간이 항상 이기고, **AC-5가 코드가 아니라 수의 대소로** 성립한다. (3) DEV-100 — **백필에 `delivery_id`가 없는데 파이프라인이 그것을 요구한다.** `backfill:{repository_id}:{pr_number}`로 만든다. **결정론적**이라야 재시도가 실패 대기열에 중복을 쌓지 않고(`(delivery_id, stage)` 유니크가 그것을 전제한다), **접두**가 있어야 운영자가 UUID 사이에서 출처를 안다. `job_id`는 넣지 않는다 — 넣으면 재실행이 같은 PR에 다른 키를 준다. (4) DEV-101 — **백필 실행을 나르는 이벤트가 없다.** 이벤트로 나르지 않고 **워커가 `job` 행을 원자적으로 claim한다** — 상한(AC-6)을 어차피 DB에서 강제해야 하고, 이벤트를 함께 쓰면 진실이 둘이 되어 상한이 새어 나간다. (5) DEV-102 — **동시 실행 상한 3을 강제할 자리가 없다.** `job_active_uk`는 같은 대상 하나만 막는다. 세는 것과 잡는 것을 **한 트랜잭션에** 둔다 — 따로 하면 넷이 동시에 "둘뿐이네"를 읽는다. (6) DEV-103 — **`/admin/jobs`가 `GET`조차 없고 API 계약에 상세 절이 없다.** 세 메서드를 세우고 계약을 함께 쓴다. `PATCH`는 `cancel`·`pause`·`resume`만 받는다 — 임의 필드를 받으면 운영자가 커서를 손으로 고칠 수 있고, 그러면 재개가 무엇을 이어받는지 아무도 보장하지 못한다. (7) DEV-104 — **한도 대기를 표현할 상태가 없다.** `paused` 하나로 운영자 중단과 한도 대기를 섞으면 **자동 재개가 운영자의 중단까지 되살린다.** 상태를 늘리지 않고 한도 대기는 `running` + `progress.waiting_until`로 둔다 — 구분이 이름이 아니라 **구조에서** 나온다. (8) DEV-105 — **`refresh_interval` 조정의 값이 문서마다 다르고 복원 책임이 없다.** 잡이 죽으면 인덱스가 `30s`에 남아 NFR-002를 영구히 어긴다. 값은 데이터 모델의 `30s`를 따르고, 복원은 `finally`에 더해 **잡 시작 시 무조건 되돌린 뒤 올린다** — 앞선 잡이 남긴 것을 다음 잡이 치운다. **제품 범위 변경이 아니라 이미 승인된 요구사항이 남긴 빈칸을 메우는 것이므로 SRS 버전은 v2.2를 유지한다** | DEV-098, DEV-099, DEV-100, DEV-101, DEV-102, DEV-103, DEV-104, DEV-105, FR-ING-006, FR-ING-005, FR-ADMIN-002, NFR-002, API-ADM-002, JOB-ING-004, EVT-JOB-001, ENT-ING-004 | `pr_search_api_contracts.md`, `pr_search_async_events_jobs.md`, `pr_search_data_model.md`, `pr_search_backend_architecture.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-023 | 2026-08-22 | correction | WP-020 착수 전 커밋 그래프 계약 감사에서 확인된 DEV-108~113 | **미러가 딛고 설 것 셋이 없고, ADR-005의 핵심 이점 하나가 실측에서 다른 대가를 요구했다.** 그래프 연산의 저장소 컨텍스트·미러 루트 경로·git 자격 증명이 어디에도 정의되어 있지 않다. 그리고 **blobless 미러에서 `git patch-id`는 blob을 지연 인출해야 계산된다**(실측 확인) — 그 인출이 소스 파일 내용을 미러 볼륨에 남겨 THR-015의 완화 수단("blobless라 파일 내용이 없음")을 무너뜨리고 인프라 5장의 용량 산정(blob 제외 저장소당 50MB)도 어긋나게 만든다. 요구사항(FR-REL-005 AC-5)이 이미 `patch_id_unavailable` 경로를 정의하므로 **지연 인출을 기본 차단**하고 그 사실을 문서에 명시했다 — ADR-005의 이점을 살릴지는 사용자 결정으로 남긴다 | DEV-108~113, ADR-005, THR-015, JOB-MIR-001, FR-REL-005, FR-SEQ-001 | ADR 문서, 보안 문서 위협 표, 비동기·잡 카탈로그, 인프라 5장, API 계약, 작업 패키지, 원장 | closed |
| CR-024 | 2026-08-22 | decision | 기한이 지났거나 도래한 오픈 결정 전부에 대한 결정 요청 | **미룰 수 없게 된 결정 일곱을 한 번에 닫는다.** OD-001·OD-002는 기한(REL-002 착수 전)이 지났고 OD-004는 기한(REL-003 착수 전)이 도래했다. 여기에 구현이 드러낸 미결 넷(DEV-051 운영 집계 접근 범위, DEV-111 patch-id 기본값, DEV-112 커밋 메타데이터 잡, `allowed_team_ids` 투영)을 함께 정한다. **결정의 근거를 전부 문서 안에서 찾았다** — 새 제약을 지어내지 않았고, 근거가 문서에 없는 곳(재검토 임계 등)은 판단임을 명시했다. 결정 요지: (1) blobless 미러 **허용**, 단 blob 지연 인출은 기본 차단 (2) 권한 원천은 **GHE 협업자/팀 API** (3) 릴리스 앵커는 **Git 태그만** (4) 파이프라인 건강 **집계 수치만** 접근 범위 예외, 저장소 **식별자는 범위 안에서만** 노출 (5) patch-id는 기본 `blob_fetch_disabled`, FR-REL-005 AC-2를 조건부로 정정 (6) 커밋 메타데이터는 **JOB-MIR-002**를 새로 정의해 WP-067이 맡는다 (7) `allowed_team_ids`는 **레지스트리가 소유하고 투영이 읽는다** — 이벤트에 싣지 않는다 | OD-001, OD-002, OD-004, DEV-051, DEV-111, DEV-112, FR-AUTH-002, FR-ADMIN-001, FR-REL-005, ADR-005, ADR-008, THR-003, THR-015, THR-016, JOB-MIR-002, WP-067 | SRS, PRD, ADR 문서, 보안 문서, 비동기·잡 카탈로그, 데이터 모델, API 계약, 작업 패키지, 원장 | closed |
| CR-043 | 2026-08-26 | scope | WP-032 착수 전 패싯·커서·전문 검색 계약 감사에서 확인된 DEV-266~285 | **이 매핑을 어떻게 배포하는가를 아무도 묻지 않았다. 그리고 대형 구간을 끝까지 훑을 방법이 없었다.** 스물 중 **둘이 WP-032를 배포 불가로 만들고**, **셋은 이미 코드에 있는 결함**이며 그중 하나는 재현했다. (1) **`edge_ngram` 분석기를 살아 있는 인덱스에 추가할 수 없다.** CR-040이 `nori` 대신 고른 경로가 `standard` + `edge_ngram`인데, `edge_ngram` 필터·분석기는 `index.analysis` 아래의 **비동적 설정**이라 열린 인덱스에 추가하면 `illegal_argument_exception: Can't update non dynamic settings ... for open indices`로 거절된다 — 실제 Elasticsearch 8로 확인했다. `bootstrap.ts`의 기존 인덱스 경로는 `putMapping`만 부르므로 settings를 갱신하지도 않고, `close` → `open`은 그 구간 검색이 멈춰 FR-ING-008·NFR-008이 막는다(DEV-266). (2) **분석기가 있더라도 새 서브필드는 기존 문서에서 비어 있다.** `putMapping`은 `acknowledged: true`를 주지만 Elasticsearch가 기존 문서를 다시 색인하지는 않는다 — 실측에서 서브필드 추가 직후 조회가 **0건**, `_update_by_query` 뒤에 **1건**이었다. 매핑만 올려 배포하면 전문 검색이 **과거 데이터에 대해 조용히 적게** 답한다(DEV-267). **두 벽은 서로 독립이고 둘 다 WP-035를 가리킨다** — WP-032의 선행 WP에 WP-035를 넣고 REL-004의 실행 순서를 WP-029 → WP-030 → WP-031 → **WP-035** → WP-032로 정정한다. **WP ID를 재번호화하지 않는다**: 순서를 정하는 것은 번호가 아니라 의존이다. (3) **하위 문서가 이 문서보다 넓다.** 와이어프레임 `W-004-FACETS`와 WP-032가 **W-004에도 패싯**을 요구하는데 FR-SRCH-009의 관련 화면은 W-001뿐이었다. PRD의 SCN-002 기본 흐름은 이미 그 동작을 서술하고 있었다 — 뒤처진 것은 SRS다. **기능을 지우지 않고 SRS를 v2.7로 올린다**(DEV-268). (4) **FR-SEQ-002에 페이지네이션 계약이 없다.** 구간은 5만 건까지 허용되는데 `size` 상한이 200이고 `next_cursor`는 늘 `null`이라 **끝까지 훑을 방법 자체가 없었다** — 그리고 그것이 이 제품의 핵심 사용이다. AC-6·7·8을 더한다(DEV-269). (5) **범위 조회가 요약과 목록을 어긋나게 낸다 — 재현했다.** `runRange`가 정본 페이지를 **먼저 자르고** 그 안에서만 `q`를 판정하는데 요약은 구간 전체를 센다. 실제 PostgreSQL·Elasticsearch에서 구간 1~60·`size=10`·일치가 서수 51 하나뿐인 `q`가 `summary.pull_request_count: 1` + `items: []` + `next_cursor: null`을 냈다. 같은 질의를 `size=60`으로 하면 서수 51이 나온다 — 데이터가 아니라 **절삭**이 원인이고 커서가 없으므로 사용자는 그 항목에 **도달할 수 없다.** 커서가 가리키는 것을 "마지막으로 반환한 항목"이 아니라 **"마지막으로 검사한 서수"**로 정한다(DEV-270). (6) **커서 계약의 아래층이 없다.** ADR-010은 재료·지문·동률을 이미 정했고 동률(`doc_id`)은 구현까지 돼 있었다 — 없는 것은 그 아래다: 봉인 방식(base64 JSON은 사용자가 정렬 키 값을 고쳐 정상 커서처럼 만들 수 있다), 지문의 정규화와 `access_scope_version`, `cursor_invalid`와 `cursor_query_mismatch`의 경계, 그리고 **점수 정렬의 Point In Time** — 살아 있는 인덱스에서는 BM25 term statistics가 바뀌어 `_score`가 페이지 사이에 달라지고 항목이 중복·누락된다(DEV-271~274). (7) **패싯 계약이 검증 불가능하고 상태가 모자라며 예산이 어긋난다.** QA-W001-16의 "건수 일치"를 `sum(buckets) == total`로 구현할 수 없다 — 상위 20 절삭·다중 값 필드·`track_total_hits` 근사 셋 때문이다. FR-SRCH-009 예외 처리가 요구하는 **실패 상태**를 그릴 수단이 없어 "예산 초과 생략"과 "계산 실패"가 같은 안내로 그려진다. 그리고 백엔드 아키텍처가 `패싯 | 목록 요청과 동일 질의에 집계 첨부 | 왕복 1회`라고 **요구사항이 금지하는 구조를 처방**하고 있었다(DEV-276~281). (8) **전문 검색의 안전 경계와 대상.** 강조 응답 예시가 `<em>`을 그대로 실어 THR-018의 완화 근거를 무너뜨리고, `SEARCH_TARGET`이 커밋 문서 전체를 도는데 AC-1이 정한 것은 **머지 커밋 메시지**다. `QUERY_TOO_SHORT`는 UTF-16 코드 단위를 세어 `𠮷`·이모지 한 글자가 통과한다(DEV-282~284). (9) **반대 방향의 같은 모양이 하나 더 있었다** — `W-001-FACETS`가 SRS의 여섯보다 넓은 여덟(기간·시퀀스 포함)을 적는다. 이번엔 상위를 넓히지 않고 하위를 좁혔다: 어느 상위 문서도 요구한 적이 없고 연속 값에 "상위 20개 값과 건수"라는 형태가 맞지 않으며, 기간·시퀀스는 `merged:`·`seq:` 질의 키로 **이미 필터할 수 있다**(DEV-285). **제품 범위를 넓히는 변경이 하나 있다 — SRS v2.6 → v2.7.** FR-SEQ-002에 AC-6·7·8을 더하고 FR-SRCH-009의 관련 화면에 W-004를 넣는다. 기존 AC는 한 글자도 바뀌지 않았고 **신규 FR·NFR은 없으며 안정 ID 재번호화도 0건**이다. **새 ADR 없음** — ADR-010에 Amendment를 붙여 이 결정이 덮는 범위(색인이 결과 집합을 소유하는 조회)와 봉투의 아래층을 명시했다. **새 마이그레이션 없음** — 이 CR은 코드를 바꾸지 않는다. **이 CR은 WP를 완료시키지 않는다** — REL-004 진행률은 그대로 3/8이다 | DEV-266~285, FR-SEQ-002, FR-SRCH-007, FR-SRCH-008, FR-SRCH-009, FR-SRCH-011, FR-ING-008, FR-AUTH-003, API-SRCH-004, API-SEQ-001, ADR-004, ADR-007, ADR-008, ADR-010, NFR-001, NFR-008, THR-003, THR-014, THR-018, C-012, C-016, W-001, W-004, QA-W001-14~19, QA-W004-23~27, WP-032, WP-035 | `srs_final.md`, `prd.md`, `requirements_screen_traceability_matrix.md`, `pr_search_api_contracts.md`, `pr_search_architecture_decision_records.md`, `pr_search_backend_architecture.md`, `pr_search_security_privacy_architecture.md`, `pr_search_ui_component_spec.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_screen_qa_checklist.md`, `pr_search_work_packages.md`, `pr_search_implementation_roadmap.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-044 | 2026-08-26 | correction | PR #48(CR-043) 머지 후 리뷰 다섯 + PR #49 리뷰 하나 — DEV-286~291 | **두 P1이 같은 것을 말한다: 내가 세운 규칙의 예외를 내가 틀리게 셌다.** (1) **PIT을 `relevance`에만 걸면 나머지 정렬 키에서 항목이 중복·누락된다.** CR-043의 ADR-010 Amendment가 "다른 정렬 키는 값이 불변이거나 **문서 자신의 필드**라 이 문제가 없다"고 적었는데 그 추론이 틀렸다 — 문서 자신의 필드라는 것은 불변이라는 뜻이 아니다. `search_after`는 "정렬 값이 이 커서보다 뒤"라는 조건이므로 값이 페이지 사이에 움직이면 그 문서는 두 번 나오거나 영영 나오지 않는다. 정렬 키 여덟 중 움직이지 않는 것은 `created_at` 하나뿐이다 — `updated_at`은 리뷰·댓글·라벨 웹훅이, `changed_files_count`·`additions`는 보강 완료와 새 커밋이, `lead_time_seconds`는 머지 시각 확정이, `merged_at`은 미머지 PR의 머지가, `merge_seq`는 에폭 상향이 움직인다. **PIT을 정렬 키와 무관하게 모든 순회에 연다** — 키별로 가르는 안은 기각했다. 가르면 "이 키는 불변인가"를 매번 판정해야 하는데 **그 판정의 첫 시도가 이미 틀렸다**(DEV-286). (2) **구간 커서를 chunk 끝까지 밀면 같은 chunk의 남은 일치가 사라진다.** CR-043의 4단계가 `last_scanned_merge_seq`를 무조건 "검사한 마지막 서수"로 갱신하는데, chunk 100 · `size` 10 · 그 chunk에 일치 20건이면 앞의 10건만 실어 보내고 커서를 100으로 봉인해 **나머지 10건이 영영 사라진다.** 갱신 지점을 갈랐다 — 페이지가 찼으면 **실제로 실은 마지막 일치**까지만, chunk를 다 보고도 차지 않았으면 chunk 끝까지. **이것은 CR-043이 고치려던 DEV-270과 같은 모양이다** — 결함의 모양을 이해하고 재현까지 한 뒤에 그것을 고치는 계약에서 같은 계열을 새로 만들었다(DEV-287). (3)(4) **산문이 예시를 이기지 못한다.** 새 계약을 산문으로 적고 위쪽 **정본 JSON 예시**를 그대로 두었다 — 강조는 여전히 `<em>`을 싣고 있었고, 패싯 정본 응답에는 `facets_status`가 없으며 옛 3분기 표가 예산 생략을 `facets` **키 없음**으로 적어 새 네 상태 표와 충돌했다. 이 문서 1장이 "구현 에이전트는 이 예시를 그대로 fixture와 테스트에 사용한다"고 적으므로 **예시가 계약이고 산문은 주석이다.** 예시 자체를 바꾸고 중복된 표를 지웠으며 정본 표가 어디인지 명시했다(DEV-288·289). (5) **W-004에 `CURSOR_INVALID` 상태가 없다.** W-001은 mismatch·invalid 둘을 세웠는데 W-004는 하나뿐이고 그 조건이 mismatch만이다 — FR-SEQ-002 AC-7이 두 코드를 정하고 C-016이 문구를 가르라고 요구하므로 훼손된 구간 커서에 정의된 화면 동작도 QA 경로도 없었다(DEV-290). (6) **그리고 이 정정 자체가 baseline과 어긋났다** (PR #49 리뷰 P1). 2번을 하위 문서에서만 고쳤는데 **SRS v2.7의 AC-7이 "마지막으로 반환한 항목이 아니라 검사한 지점"이라고 명시**하고 있었다 — WP-032가 서로 배타적인 지시 둘을 받는 상태가 됐고, 하위 문서가 상위를 어길 수 없다는 규율의 위반이기도 하다. **SRS를 v2.8로 올려 AC-7 자체를 정정했다**: 봉인 값은 **완결 서수**, 즉 *그 서수 이하의 일치를 모두 반환했음이 보장되는 지점*이다. 페이지가 차서 멈추면 마지막으로 반환한 일치, 판정할 것이 남지 않을 때까지 보고도 차지 않으면 마지막으로 검사한 서수 — **두 경우가 하나의 규칙에서 나온다.** v2.7의 문장은 한쪽 실패(DEV-270)만 보고 쓴 것이었고 반대쪽(DEV-287)이 곧 드러났다(DEV-291). **SRS v2.7 → v2.8.** 한 수용 기준의 한 항목이 정정되었으며 판정 재료와 두 오류 코드는 그대로다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건, 새 ADR 없음(ADR-010 Amendment 정정), 새 마이그레이션 없음, 코드 변경 0건** | DEV-286~291, FR-SRCH-008, FR-SRCH-009, FR-SRCH-011, FR-SEQ-002, ADR-010, THR-014, THR-018, C-016, W-001, W-004, QA-W001-29, QA-W004-28·29, WP-032 | `srs_final.md`, `requirements_screen_traceability_matrix.md`, `pr_search_api_contracts.md`, `pr_search_architecture_decision_records.md`, `pr_search_screen_state_matrix.md`, `pr_search_screen_qa_checklist.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-045 | 2026-08-26 | correction | WP-035 착수 전 무중단 재색인 계약 감사에서 확인된 DEV-292~303 | **승인된 배포 단위 하나가 저장소에 없었고, 그래서 이미 구현된 잡 하나가 지금 배포되지 않고 있다.** (1) **`batch` 역할 manifest가 없다.** 인프라 3장의 배포 단위 표가 `pipeline-worker:batch | 배치 잡 | 1/3`을 승인하는데 `deploy/k8s/`에 그 파일이 없다 — 여섯 manifest는 enrich·link·mirror·project·reconcile·sequence만 세운다. WP-035의 JOB-ING-006이 그 역할이므로 **구현해도 배포에 도달할 수 없고**, 더 무거운 것은 **이미 구현된 JOB-ING-007(아웃박스 재적재)도 그래서 배포되지 않는다**는 사실이다. 그 파일의 주석이 *"이 잡이 없으면 Redis가 잠깐만 내려가도 그 사이 이벤트가 영영 처리되지 않는다"*고 적는다. CR-034가 세운 운영 도달성 계층이 정확히 이런 것을 잡으려고 만들어졌는데 이것을 놓쳤다(DEV-292). (2) **회귀의 방향이 반대였다.** 그 시험은 "존재하는 manifest가 README 적용 순서에 있는가"를 묻는다 — **없는 파일은 물음의 대상이 아니다.** 배포 단위 표를 정본으로 삼는 역방향 검사를 더한다(DEV-293). (3) **API-ADM-004의 상세 절이 없다.** 카탈로그 한 줄뿐이라 요청 형태·허용 대상·충돌 처분이 정해져 있지 않다. 클라이언트가 구체 인덱스를 지목할 수 있으면 서비스 중인 인덱스를 대상으로 덮어쓰는 요청이 성립한다(DEV-294). (4) **이중 쓰기의 대상 목록이 없다.** 계약은 "재색인 중 신규 이벤트 이중 쓰기" 한 줄인데 별칭에 쓰는 함수를 세어 보니 **열일곱**이다 — 투영·커밋 메타데이터·시퀀스·에폭·아카이브·팀 범위·릴리스·간선 여덟. 하나만 놓쳐도 새 인덱스가 조용히 뒤처지고 그 사실은 전환 뒤에 드러난다. **삭제도 이중으로 해야 한다**(DEV-295). (5) **활성화와 전환의 울타리가 없다.** 막아야 할 경주가 둘이고 방향이 반대다 — 활성화 직전 쓰기의 유실과, 전환 직후 불완전한 인덱스로의 서비스(DEV-296). (6) **전환 검증 기준이 없다.** "완전해지기 전 전환 금지"만 있고 완전의 정의가 없어 `source_count == target_count` 하나로 판정하는 구현이 통과한다 — **같은 수의 다른 문서**가 가능하다(DEV-297). (7) **실패·취소 처분의 경계가 없다.** shadow 실패가 서비스를 끊는지, bulk 응답의 item 단위 실패를 어떻게 세는지, 늦은 취소가 완료를 덮는지(DEV-298). (8) 보관 7일의 정본 위치(DEV-299), 동시 재색인 상한(DEV-300), `OPERATOR_JOB_TYPES` 등재(DEV-301), CLI가 두 번째 알고리즘을 만들지 않는다는 규칙(DEV-302), 버전 인덱스 생성·별칭 전환 기계 부재(DEV-303)가 나머지다. **SRS 변경 없음(v2.8 유지)** — FR-ING-008이 이미 새 인덱스·이중 쓰기·원자 전환·7일 보관·실패 시 미전환을 승인한다. 이 CR이 채우는 것은 **어디에 이중으로 쓰는지, 전환을 언제 해도 되는지, 실패했을 때 무엇이 남는지**라는 하위 계약이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건, 새 ADR 없음**(ADR-004가 정한 재구축 가능성을 이 축에서 성립시킨다), **새 마이그레이션 없음** — `job.progress`·`job.cursor`가 이미 JSONB이고 보관 정본도 거기 둔다. **새 워커 역할·새 consumer group 없음** | DEV-292~303, FR-ING-008, NFR-008, ADR-002, ADR-003, ADR-004, API-ADM-002, API-ADM-004, JOB-ING-006, JOB-ING-007, ENT-ING-004, QA-A003-07·08, WP-035, WP-032 | `pr_search_api_contracts.md`, `pr_search_async_events_jobs.md`, `pr_search_infrastructure_operations.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-046 | 2026-08-26 | correction | PR #50(CR-045) 머지 후 리뷰 넷 — DEV-308~311 | **계약이 자기가 적어 둔 위험보다 짧게 울타리를 쳤고, 검사가 자기가 선언한 정본의 절반만 읽었다.** (1) **울타리가 내가 적어 둔 경주보다 짧다.** CR-045의 3.5장이 막아야 할 경주 둘을 표로 적어 놓고, 울타리는 "논리 쓰기는 시작 시점에 구체 대상을 확정하고 활성화·전환이 그 확정 구간과 겹치지 않는다"로 정했다. **확정 구간만 감싸면 두 번째 경주가 그대로 남는다** — writer가 `[old, new]`를 확정하고 락을 놓은 뒤 전환이 별칭을 옮기고, 그 다음에 shadow 쓰기가 실패하면 이미 서비스 중인 새 인덱스가 불완전하다. 울타리 구간을 **"대상 확정 → 두 인덱스 쓰기 완료 → shadow 실패 기록"**까지로 늘렸다(DEV-308). (2) **실패한 재색인이 다음 재색인을 막는다.** "버전을 하나 올린다"와 "실패한 shadow는 유계 정리 대상으로 남긴다"가 서로를 막는다 — `v2`를 만들고 실패하면 재시도가 `v2`를 또 계산해 인덱스 생성에서 실패한다. 대상을 **아직 쓰이지 않은 다음 버전**으로 고친다(DEV-309). (3) **역방향 회귀가 한쪽 정본만 읽는다.** WP-035 계약은 "인프라 3장의 배포 단위 표를 정본으로 삼는다"고 적었는데 구현은 코드 갈래만 읽었다 — **구현 자체가 없는 승인 단위**는 검사를 그냥 통과한다. **하위 문서와 구현이 어긋난 자리이며 DEV-291과 같은 계열이다.** 정본을 둘로 읽고 서로를 덮는지까지 건다(DEV-310). (4) **아키텍처가 배포 계약이 경고하는 형상을 허가한다.** 배포 단위 표가 `batch`를 `1 / 3`으로 적는데 manifest는 replica 1을 요구한다 — JOB-ING-007이 리더 선출 없는 주기 스윕이라 파드마다 같은 아웃박스 행을 다시 발행한다. 표를 **`1 / 1`**로 정정했다(DEV-311). **SRS 변경 없음(v2.8 유지)** — 넷 다 CR-045가 만든 하위 계약과 그 구현의 결함이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건, 새 ADR·마이그레이션 없음** | DEV-308~311, FR-ING-008, JOB-ING-006, JOB-ING-007, API-ADM-004, ADR-002, WP-035 | `pr_search_api_contracts.md`, `pr_search_async_events_jobs.md`, `pr_search_infrastructure_operations.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-048 | 2026-08-27 | correction | DEV-306 — `authz` 역할이 배포되지 않는다 | **접근 통제 기능이 배포에서 죽어 있었다.** `startAuthzWorker`도, Redis 캐시 무효화도, 팀 변경의 색인 소급 적용도 WP-012·WP-068에서 이미 구현됐고 `index.ts`에 `authz` 갈래도 있다. **없던 것은 manifest 하나**였고, 그래서 `EVT-AUTH-001 permission.invalidated`를 **아무도 소비하지 않았다** — 팀에서 제거되거나 접근이 회수된 사용자가 **캐시 TTL 만료까지 그 범위로 계속 조회한다** (FR-AUTH-003 AC-2가 성립하지 않는다). CR-045가 `batch`에서 고친 것과 **같은 모양이 접근 통제 축에서 한 번 더** 있었고, 그때 만든 역방향 회귀가 이것을 잡아 예외 목록에 사유·DEV와 함께 올려 두었다(CR-047이 그 예외의 적용 범위를 좁혔다). 이 CR이 정상 경로를 그대로 밟는다 — **manifest를 만들고 → 예외 목록에서 지우고 → 인프라 3장 배포 단위 표에 올린다.** `replicas: 1`로 시작한다(`prs:permission` 파티션 4가 상한): 권한 이벤트 유량을 아직 재지 않았고, **먼저 올려 두고 근거를 나중에 만들지 않는다.** GHE 자격 증명은 선택이지만 없으면 색인 소급이 돌지 않는다는 사실을 manifest 주석에 남겼다(CR-015 DEV-046, CR-036 DEV-188). **행위는 한 줄도 바꾸지 않았다 — 배포 도달성 정정이다.** **SRS 변경 없음(v2.8 유지). 신규 FR·NFR 없음, 안정 ID 재번호화 0건, 새 ADR·마이그레이션·워커 역할·consumer group 없음** | DEV-306, WP-012, JOB-AUTH-001, FR-AUTH-003, EVT-AUTH-001 | `deploy/k8s/pipeline-worker-authz.yaml`, `deploy/k8s/README.md`, `pr_search_infrastructure_operations.md`, `regression/runtime-reachability.test.ts`, `pr_search_implementation_traceability.md` | closed |
| CR-047 | 2026-08-26 | correction | PR #51(CR-046) 리뷰 하나 — DEV-312 | **예외 목록이 검사 하나를 통째로 침묵시킨다.** CR-046이 만든 `승인 표 → manifest` 검사가 `UNDEPLOYED_ROLE_ALLOWLIST`를 예외로 적용해, `authz`·`release`·`backfill` 중 하나가 배포 단위 표에 오르면 **그 검사가 건너뛴다** — 그리고 그것이 이 시험이 잡으려던 "승인했는데 만들지 않았다" 그 자체다. 다른 방향도 함께 침묵한다: 세 역할은 이미 코드에 갈래가 있어 `승인 → 코드`가 성립하고 `코드 → 승인`은 같은 예외로 건너뛴다. **예외를 두 방향에 다 걸면 예외가 검사를 삼킨다.** **승인 표 → manifest 방향에서 예외를 없앴다** — 표에 오른 것은 예외 없이 manifest를 가져야 한다. 그리고 인프라 3장이 적어 둔 규율("배포되지 않는 단위를 이 표에 먼저 적지 않는다")을 **시험으로 강제**했다. 예외를 지우고 manifest를 만드는 것이 정상 경로다. 리뷰가 지적한 시나리오를 변이로 재현해 두 시험이 모두 잡는 것을 확인했다. **SRS 변경 없음(v2.8 유지). 신규 FR·NFR 없음, 안정 ID 재번호화 0건, 새 ADR·마이그레이션 없음** | DEV-312, WP-035, JOB-AUTH-001, JOB-REL-007, JOB-ING-004 | `regression/runtime-reachability.test.ts`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-049 | 2026-08-27 | scope | WP-033 착수 전 저장된 검색 계약 감사에서 확인된 DEV-333~342 | **승인된 기능 하나가 "누구에게 공유하는가"를 말한 적이 없다.** 열 중 넷이 같은 뿌리다 — FR-SRCH-010이 `team` 공개 범위를 승인했지만 **어느 팀인지**를 정하지 않았고, 그래서 소유권·편집 권한·탈퇴 후 처분이 함께 빈칸으로 남았다(DEV-334·335·341·342). 여러 팀에 속한 사용자가 저장하면 시스템이 무엇을 고를지 정본이 없고, `saved_search.team_id`는 nullable이면서 `visibility`와의 불변식이 없어 **`private`인데 팀을 가리키는 행**과 **`team`인데 대상이 없는 행**을 스키마가 함께 허용한다. (2) **API-SRCH-005는 카탈로그 한 줄뿐이다**(DEV-333) — 요청·응답·오류 갈래가 4장에 없어 구현이 계약 없이 시작된다. (3) **100건 상한의 동시성 강제 방식이 없다**(DEV-336) — `count` 뒤 `INSERT`는 99건 상태에서 동시 요청 둘을 101건으로 만든다. (4) **공유 대상을 고를 API가 없다**(DEV-337) — W-001의 저장 대화상자가 `team_id`를 받아야 하는데 사용자의 현재 팀을 알려 주는 경로가 없다. (5) **저장된 질의가 문법 변경으로 무효가 됐을 때의 동작이 없다**(DEV-338) — 예외 처리 문장은 "실행하지 않고 오류 위치를 제시한다"고 정하지만 그것을 **누가 언제 판정하는지**가 없다. (6) **목록 순회 방식이 없다**(DEV-340) — ADR-010은 오프셋을 금지하는데 SavedSearch의 정본은 PostgreSQL이라 W-001의 PIT 커서를 그대로 쓸 수 없다. (7) **SCN-005가 저장·공유를 다루지 않는다**(DEV-339) — FR-SRCH-010의 출처로 적혀 있지만 본문은 통계 대시보드 흐름뿐이다. **SRS baseline v2.8 → v2.9. 신규 FR·NFR 없음, 안정 ID 재번호화 0건, 새 API ID 없음(전부 API-SRCH-005 하위), 새 ADR 없음. 마이그레이션 015는 불변식과 목록 인덱스만 더한다 — 새 표 없음** | DEV-333~345, FR-SRCH-010, API-SRCH-005, ENT-CORE-006, THR-012, W-001, W-008, C-037, WP-033 | `srs_final.md`, `prd.md`, `glossary.md`, `requirements_screen_traceability_matrix.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_ui_component_spec.md`, `pr_search_screen_qa_checklist.md`, `pr_search_api_contracts.md`, `pr_search_data_model.md`, `pr_search_security_privacy_architecture.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md`, `packages/contracts/src/error-codes.ts` | closed |
| CR-050 | 2026-08-28 | scope | WP-034 착수 전 저장소 개요 계약 감사에서 확인된 DEV-350~356 | **일반 사용자 화면 하나가 운영자 전용 API만 지목하고 있었다.** 일곱 중 셋이 같은 뿌리다 — W-009는 "왜 이 저장소 결과가 없는가"를 일반 사용자가 스스로 확인하는 화면인데, WP-034가 지목한 `API-ADM-001`·`API-ADM-006`이 둘 다 `operator` 전용이고 **FR-ADMIN-001 AC-4가 그 제한을 직접 승인**하고 있다. 권한을 완화하는 길은 승인된 보안 계약을 뒤집으므로 택하지 않았고, 대신 이 화면이 읽을 일반 사용자 조회 경로 `API-ING-002`를 신설한다. 같은 감사에서 **downstream 문서 넷이 SRS에 없는 기능을 이미 서술하고 있다는 것**이 드러났다 — 와이어프레임의 `repo.request_registration` 이벤트, QA-W009-05, `A-002-REQUESTS` 섹션, 상태 매트릭스의 `empty_no_repository` 복구 경로가 모두 "일반 사용자가 등록 요청을 남긴다"를 전제하는데 그 요청의 표도 API도 수명주기 계약도 없다. FR-ING-009에 그 경계를 명시하고 `ENT-CORE-008`·`API-ING-003`을 신설한다. **세 번째 뿌리는 판정의 재료다** — W-009-GAPS가 요구하는 "최근 조정 스캔이 발견한 누락 건수"의 정본이 Prometheus 누적 counter뿐이라 "최근 완료된 회차에서 몇 건"이라는 물음에 답할 수 없고, 지표 저장소가 없으면 `search-api`가 읽지도 못한다. 마이그레이션 016이 `repository`에 최근 **완주한** 조정 결과를 보존한다. 함께 기존 결함 셋을 닫는다 — `resolveRepository`·`listSequenceSpaces`가 `allowed_team_ids`를 넘기지 않아 `org_team` 범위에서 팀 소속으로만 허용되는 비공개 저장소가 조용히 누락되던 WP-068 이월(DEV-353), FR-ADMIN-001 AC-1이 `Must`로 요구하는 시퀀스 공간 상태 요약이 "WP-021 이후에 더한다"로 남아 있던 만기 이월(DEV-354), W-005의 `release_not_indexed`가 갈 곳이 없어 절반으로 남았던 DEV-159. **신규 FR·NFR 없음, 안정 ID 재번호화 0건, 새 ADR 없음** | DEV-159, DEV-350~356, FR-ING-006, FR-ING-009, FR-ING-011, FR-SEQ-001, FR-SEQ-005, FR-AUTH-002, FR-ADMIN-001, API-ING-002, API-ING-003, API-ADM-006, ENT-CORE-001, ENT-CORE-008, W-009, C-038, C-039, WP-034 | `srs_final.md`, `prd.md`, `requirements_screen_traceability_matrix.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_ui_component_spec.md`, `pr_search_screen_qa_checklist.md`, `pr_search_api_contracts.md`, `pr_search_data_model.md`, `pr_search_security_privacy_architecture.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md` | closed |
| CR-051 | 2026-08-28 | scope | DEV-349 좁은 계약 종결 감사에서 확인된 DEV-359~365 | **승인된 질의 조건 하나가 자기가 어느 시퀀스 공간에 속하는지 말하지 않는다.** FR-SRCH-005 AC-2는 `seq:1200..1350`을 예시로 들지만, ADR-007 규칙 1은 "시퀀스는 (저장소, 브랜치)마다 독립이며 저장소 간 비교는 무의미"라고 정한다. 두 문장이 같은 저장소 안에 나란히 서 있는데 **질의 문법이 그 독립성을 강제하지 않는다** — 접근 범위에 저장소가 여럿이면 같은 서수가 공간마다 다른 커밋을 가리키고 그 결과가 한 목록에 섞인다. DEV-349가 물은 "어느 공간의 에폭인가"는 답이 없어서 답하지 못한 것이 아니라 **질의가 그 물음에 답할 수 있는 모양이 아니었다**(DEV-359). 그래서 이 CR은 `seq:` 범위 조건이 **정확히 하나의 positive `repo:`와 하나의 positive `base:`**를 요구하도록 정한다 — 그러면 "공간이 여럿이면 하나만 낡아도 전체를 무효로 보는가"라는 물음 자체가 사라진다. **두 번째 뿌리는 ADR-007 규칙 5가 이미 답을 적어 두었다는 것이다** — "시퀀스를 인용하는 모든 저장물(안전 구간 표식, 저장된 검색의 `seq:` 조건, **공유 URL**)은 에폭을 함께 저장한다". 셋 중 실제로 저장하는 것은 `safe_marker` 하나뿐이었고, 저장된 검색(DEV-362)과 공유 URL(DEV-360) 둘은 규칙이 승인된 채로 구현되지 않았다. **새 아키텍처 결정이 필요한 것이 아니라 이미 선 결정이 세 저장물 중 둘에 닿지 않은 것이다.** 함께 인접 결함 셋을 닫는다 — 검색 커서 지문이 에폭을 담지 않아 재채번 뒤에도 옛 커서가 유효하고(DEV-361), `seq_epoch=abc`가 오류가 아니라 "지정 안 함"으로 읽혀 조용히 현재 에폭으로 조회되며(DEV-363), 공유된 저장 검색의 시퀀스 상태가 **볼 수 없는 저장소의 활동**을 누설할 수 있다(DEV-365, THR-043). `seq:1234` 스칼라 형태는 파서를 통과하지만 ES에서 `MATCH_NONE`이 되어 조용히 0건을 내는데, **SRS가 승인한 것은 범위뿐이므로 이 CR을 핑계로 스칼라 기능을 만들지 않고 사실만 등재한다**(DEV-364). **신규 FR·NFR 없음, 신규 API ID 없음, 신규 엔티티 ID 없음, 안정 ID 재번호화 0건, 새 ADR 없음** | DEV-349, DEV-359~365, FR-SRCH-005, FR-SRCH-008, FR-SRCH-010, FR-SEQ-005, ADR-007, ADR-010, API-SRCH-004, API-SRCH-005, ENT-CORE-006, W-001, W-008, THR-043, WP-033 | `srs_final.md`, `prd.md`, `glossary.md`, `requirements_screen_traceability_matrix.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_screen_qa_checklist.md`, `pr_search_api_contracts.md`, `pr_search_data_model.md`, `pr_search_security_privacy_architecture.md`, `pr_search_architecture_decision_records.md`, `pr_search_backend_architecture.md`, `pr_search_implementation_traceability.md` | closed |
| CR-052 | 2026-08-28 | scope | WP-036 착수 전 원본 아카이브 레인 감사에서 확인된 DEV-366~375 | **승인된 레인 하나가 어디에도 연결되어 있지 않았다.** `ADR-002`가 레인 B(NDJSON → Filebeat → ES 아카이브)를 정하고 `ADR-003`이 `prs-raw-events-{yyyy.MM}`와 ILM 창을, 인프라 3장이 `filebeat` 배포 단위를 올려 둔 것이 2026-08-19다. 그런데 그 레인의 이음매가 **셋 다 비어 있다.** ① 게이트웨이가 쓰는 파일이 파드 밖으로 나갈 볼륨이 없다 — `configmap.yaml`은 `/var/lib/prs/archive/raw-events.ndjson`을 지정하는데 `ingest-gateway.yaml`에 `volume`도 `volumeMount`도 없어 파일이 컨테이너 레이어에 쓰이고 재시작과 함께 사라진다(DEV-368). ② 파일에 담기는 저장소 식별자가 계약이 기대하는 것과 다르다 — 코드는 `repository_id`(숫자)를 싣는데 데이터 모델 4.5의 매핑과 `ENT-ING-003`은 `repository`(keyword)를 받고, 매핑이 `dynamic: false`라 그 필드는 색인되지 않는다(DEV-366). ③ 그 인덱스를 읽을 API가 없다 — `FR-ING-010` AC-5가 조회를 `operator`·`security_officer`로 제한하라고 요구하는데 API 계약의 어느 행도 아카이브를 지목하지 않는다(DEV-370). **`WP-004`는 "파일까지가 범위"라고 정확히 적고 나머지를 `WP-036`에 맡겼는데, 그 나머지를 성립시킬 계약이 없다.** **함께 드러난 것은 완료 기준이 자기 범위 밖을 요구한다는 사실이다** — `WP-036`의 DoD 첫 줄 `QA-A001-08`은 A-001 화면 항목인데 A-001을 완성하는 것은 `WP-040`이고 그 DoD도 `QA-A001-01~10`으로 같은 항목을 담는다. `WP-010`이 똑같은 자리에서 **"이 WP는 API까지다"**라고 명시적으로 제외했는데 `WP-036`에는 그 제외가 없다(DEV-371). **같은 모양이 화면 배치에도 있다** — 추적 매트릭스는 아카이브 조회 진입을 `A-004`로 배치하는데 `WP-039`의 구현 범위에도 `QA-A004-01~05`에도 아카이브가 없어, 두 화면 중 **어느 쪽도 그 기능을 소유하지 않는다**(DEV-374). `A-004`는 `FR-AUTH-004` 감사 기록 전용이고 원본 웹훅 이벤트는 **조사 대상이지 조회 이력이 아니므로**, 조회를 `A-001`로 일원화하고 매트릭스에서 `A-004`를 뺀다. **그러면 역할이 걸린다** — `A-001`은 `operator` 전용 화면인데(`QA-A001-10`) AC-5는 `security_officer`도 조회하게 요구한다. 그래서 `A-001-ARCHIVE` **섹션만** 그 역할에 열고, `security_officer`가 진입하면 그 섹션만 렌더링한다(DEV-375). 권한을 화면 단위로 넓히지 않는 것은 `CR-050`이 `API-ADM-001`·`API-ADM-006`에서 내린 판단과 같다 — 승인된 보안 계약을 뒤집는 대신 경계를 정확히 그린다. **결정 넷.** (1) **레인 B는 파드 단위로 완결된다** — Filebeat를 사이드카로 붙이고 `emptyDir`을 공유한다. 여러 replica가 한 파일에 덧붙이는 길은 배제한다: 평균 8KB인 payload는 `PIPE_BUF`(4KB)를 넘어 `O_APPEND`의 원자성이 보장되지 않고, 섞인 줄은 두 이벤트의 조각을 하나로 읽히게 한다(DEV-369). 인프라 3장의 `DaemonSet`을 정정한다 — 시스템 아키텍처는 이미 "DaemonSet/사이드카" 둘을 열어 두어 두 문서가 어긋나 있었다(DEV-373). (2) **아카이브 조회도 필수 접근 범위 필터를 지난다**(`ADR-008`) — AC-5의 역할 제한은 필터에 **더해지는** 조건이지 대체물이 아니다. 그래서 아카이브 문서에 필터의 재료인 `repository_id`와 사람이 읽는 `repository`를 함께 싣고, 아키텍처 시험의 `user_facing` 예외 목록에는 넣지 않는다. 미등록 저장소 문서는 어떤 접근 범위에도 속하지 않아 조회되지 않으며 그것이 `FR-AUTH-002` AC-4가 지키는 규율과 같다. (3) **`API-ADM-008 GET /admin/raw-events`를 신설한다** — `payload`는 기본으로 싣지 않는다. 5억 건 규모의 임의 JSON을 목록 응답의 기본값으로 두지 않으며 원본 열람은 명시적 요청일 때만이다(THR-044). (4) **파일 수명은 크기 기반 회전으로 정한다** — Filebeat가 멈춰도 디스크가 차지 않도록 오래된 조각부터 버린다. **아카이브를 잃는 쪽을 택하는 것이 AC-3을 지키는 길이다**: 보존 보증은 PostgreSQL이 지고(`ADR-003`) ES 아카이브는 재구성 가능한 파생 사본이며, 디스크가 차면 레인 B의 정체가 레인 A까지 멈춘다(DEV-367). **새 ADR 없음, 신규 FR·NFR 없음, 안정 ID 재번호화 0건.** 새 ID는 `API-ADM-008`과 `THR-044` 둘뿐이며 둘 다 정본이 실제로 없어 신설한다 | DEV-366~375, FR-ING-010, FR-ADMIN-001, API-ADM-006, API-ADM-008, ENT-ING-003, ADR-002, ADR-003, ADR-008, THR-044, A-001, QA-A001-08, WP-004, WP-036, WP-040 | `srs_final.md`, `requirements_screen_traceability_matrix.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_screen_qa_checklist.md`, `pr_search_api_contracts.md`, `pr_search_data_model.md`, `pr_search_security_privacy_architecture.md`, `pr_search_system_architecture.md`, `pr_search_infrastructure_operations.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md` | closed |
| CR-053 | 2026-08-29 | scope | WP-037 착수 전 집계 계약 감사에서 확인된 DEV-381~390 | **집계가 무엇을 세는지가 두 문서에 서로 다르게 적혀 있고, `FR-STAT-006` AC-2가 그 둘이 같기를 요구한다.** 데이터 모델 6장의 접근 경로 표는 그룹 집계·시계열·백분위 셋을 모두 `prs-pull-requests` 단독으로 적었다. 같은 표가 "다차원 필터 목록"도 `prs-pull-requests`라고 적었지만 **와이어프레임은 `W-001-RESULTS`에 "유형(PR/커밋)" 열을 두었고 구현도 `SEARCH_TARGET = [prs-pull-requests, prs-commits]`다.** 그러면 AC-2의 "집계 결과와 목록 결과의 총 건수가 일치한다"는 **어떤 구현으로도 만족할 수 없다** — 목록이 세는 것과 집계가 세는 것이 다르기 때문이다(DEV-381). `CR-052`가 배운 것과 같은 모양이다. 각 문서는 자기 몫을 옳게 적었고 **그 둘을 잇는 자리가 아무의 소관도 아니었다.** 결정은 **집계 대상을 Pull Request로 확정**하는 것이다 — `SCN-005`가 "팀별 머지 PR 수"라 적고, `FR-STAT-003` AC-2가 "집계 대상은 머지된 PR로 한정한다"고 이미 명시하며, `FR-STAT-001` AC-2의 지표 넷 중 둘(변경 파일 수 합계·리드타임 중앙값)과 그룹 키 일곱 중 셋(팀·라벨·PR 상태)이 **커밋 매핑에 아예 없다.** 커밋을 모집단에 넣으면 그 다섯이 조용히 0이나 `unknown`이 된다. 그래서 AC-2를 **"같은 질의와 같은 접근 범위를 PR 문서 모집단에 적용했을 때의 건수"**로 정의한다. **두 번째 뿌리는 `team`이 두 가지를 뜻한다는 것이다**(DEV-382). 검색의 `team:`은 `CR-016` 이래 `allowed_team_ids`를 보며 그것은 **저장소 접근 권한**이다. 통계가 묻는 "팀별 머지 PR"은 **작성자의 소속 팀**이고 PR 매핑에 `author_team_ids`가 따로 있다. 둘을 섞으면 **접근 권한 팀을 성과 팀으로 집계하게 된다.** 그런데 실측하니 `author_team_ids`는 **매핑 선언 한 줄뿐이고 투영이 채우지 않는다** — 원장 7장이 이미 알려진 제한으로 등재해 둔 자리다. 채우는 일은 GHE에서 사용자의 팀을 읽는 별도 작업이므로 이 CR의 범위가 아니며, **계약은 `author_team_ids`를 지목하고 그 필드가 비어 있는 동안 결과가 비는 것을 명시한다.** 없는 값을 다른 필드로 대신 채우지 않는다. **세 번째 뿌리는 근거 목록으로 가는 길이다**(DEV-383). `FR-STAT-001` AC-5가 "동일 조건이 적용된 검색 결과로 이동할 질의 문자열"을 요구하는데, 질의 문법 15종에 **PR만 고르는 판별자가 없다.** 집계는 PR만 세고 그 질의를 `W-001`에 넣으면 커밋이 함께 나오므로 **버킷 수와 근거 목록의 모집단이 어긋난다.** `kind:` 키를 신설해 `FR-SRCH-005` AC-1의 지원 키를 16종으로 넓힌다. `is:merged`가 우연히 PR만 남기는 것에 기대지 않는다 — 그 뜻은 "머지된 것"이지 "PR"이 아니고, `group_by=state`는 머지되지 않은 PR도 세어야 한다. **함께 인접 결함 일곱을 닫는다.** 집계 요청이 `seq:` 범위를 받을 수 있는데 `seq_epoch`을 실을 자리가 없어 `CR-051`이 세운 `buildQuery`가 던진다(DEV-384). `team`·`label`은 다중값이라 버킷 합이 총계를 넘을 수 있는데 계약이 그것을 말하지 않는다(DEV-385). `API-STAT-004`는 **상세 규격 자체가 없고** `FR-STAT-005` AC-2의 "변경 라인 수"가 `additions + deletions`인지 각각인지 정해지지 않았으며 그 합은 사전 계산 필드에도 없다(DEV-386). `FR-STAT-004` AC-3(작성자 본인 리뷰 제외)은 **재료가 다 있는데 구현되지 않았다** — `firstReviewAt`가 제출된 리뷰 중 가장 이른 것만 고른다(DEV-387). `WP-037`의 DoD가 `QA-W006-01~15`를 요구하지만 실제 항목은 **18개**이고 그중 여덟은 배지·표시·이동처럼 화면이 소유하는 것이다 — `WP-036`이 `QA-A001-08`에서 겪은 것과 같은 자리다(DEV-388). 그룹 정렬의 tie-break가 없어 같은 데이터에 같은 요청이 다른 순서를 낼 수 있고 근사 집계의 방법도 정해지지 않았다(DEV-389). `API-STAT-001`의 `lead_time_median`과 `API-STAT-003`의 `p50`이 같은 값을 다른 이름으로 낸다(DEV-390). **새 ADR 없음, 신규 FR·NFR 없음, 신규 API ID 없음, 신규 엔티티 ID 없음, 안정 ID 재번호화 0건.** 새로 생긴 것은 질의 키 둘(`kind`·`author_team`), ES 사전 계산 필드 하나(`changed_lines`), 그리고 `API-STAT-004`의 상세 규격이다 — API ID 자체는 이미 있었고 상세만 없었다 | DEV-381~390, FR-STAT-001, FR-STAT-002, FR-STAT-003, FR-STAT-004, FR-STAT-005, FR-STAT-006, FR-SRCH-005, FR-SRCH-006, API-STAT-001, API-STAT-002, API-STAT-003, API-STAT-004, API-SRCH-004, ENT-CORE-002, W-001, W-006, C-030, C-033, C-034, QA-W006, WP-037, WP-038 | `srs_final.md`, `prd.md`, `glossary.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_screen_qa_checklist.md`, `pr_search_ui_component_spec.md`, `pr_search_api_contracts.md`, `pr_search_data_model.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md` | closed |
| CR-054 | 2026-08-29 | scope | WP-039 착수 전 감사 기록 계약 감사에서 확인된 DEV-400~413과 PR #83 리뷰가 더한 DEV-415~417 | **감사 대상이 무엇인지 말하는 정본이 없고, 그 자리를 개수가 대신하고 있었다.** `WP-039`는 구현 범위와 DoD 양쪽에 "감사 대상 액션 13종"이라 적는데, 보안 문서 7장의 표는 **14행**이고 그 행들이 담은 `action` 문자열은 **18개**다(`saved_search.{create,update,delete}`·`repository.{register,unregister}`·`job.{run,cancel}`이 한 행에 여럿을 담는다). 셋 중 어느 것도 틀리지 않았고 **셋이 서로 다른 것을 세고 있었다** — `CR-052`가 `raw_event.view_payload`를 표에 더할 때 `WP-039`의 문구는 함께 가지 않았다(DEV-400). **개수는 액션을 하나 더하는 순간 낡는다.** 그래서 `FR-AUTH-004` AC-1을 **개수가 아니라 목록**으로 다시 쓰고, 그 목록에 **소유 WP와 활성화 상태**를 함께 실어 정본을 하나로 만든다. DoD도 "N종이 기록된다"가 아니라 **"활성 액션이 모두 실제 도달 가능한 경로에서 기록된다"**로 바꾼다. **두 번째 뿌리는 파생 문서가 승인 범위를 넘은 것이다**(DEV-401). 보안 문서 7장이 정하는 액션 중 넷이 SRS에 근거가 없다 — `saved_search.*`, `raw_event.view_payload`, `audit.view`, `secret.rotate`다. 나머지 열은 근거가 있고 **그 근거가 `FR-AUTH-004` 하나가 아니다**: 잡 제어는 `FR-ADMIN-002` AC-5, 정합성 점검은 `FR-ADMIN-003` AC-5, 재채번은 `FR-SEQ-005` AC-5, 내보내기는 `FR-SRCH-012` AC-4, 표식은 `FR-SEQ-006` AC-5, 보존 만료 삭제는 `FR-ING-003` AC-5, 저장소 등록·해제는 `FR-ING-009` AC-5가 각각 승인한다. **넷 중 셋은 승인한다** — 저장된 검색은 팀이 공유하는 질의를 바꾸는 보안 관련 영속 동작이고, 원본 payload 열람은 엔티티 문서보다 넓은 사실을 여는 자리이며(`THR-044`), 감사 화면 진입은 `QA-A004-05`와 보안 문서가 이미 요구한다. **`secret.rotate`는 제거한다**(DEV-409) — 시크릿 회전을 소유하는 승인된 제품 기능이 SRS에 없고, "보안 문서에 있으니 그 기능도 만든다"는 파생 문서가 범위를 넓히는 바로 그 경로다. 장래에 그 기능을 승인할 때 별도 CR로 다시 넣는다. **세 번째 뿌리는 어휘가 코드와 문서에서 갈라진 것이다.** 실제 API가 받는 잡 제어는 `cancel`·`pause`·`resume` 셋인데(`API-ADM-002`) 보안 문서는 `job.{run,cancel}`만 적어 **두 동작이 감사에서 사라진다**(DEV-404). 코드가 쓰는 `sequence_integrity.check`는 표에 아예 없고(근거는 `FR-ADMIN-003` AC-5에 있다), 재채번은 자동 경로가 `sequence.reassign`을 수동 경로가 `sequence_integrity.reassign`을 써 **같은 사실이 두 이름으로 남는다**(DEV-405). 신규 쓰기의 정본을 `sequence.reassign`으로 통일하되 **이미 저장된 행은 절대 고치지 않는다** — `AuditRecord`는 불변이고(AC-3) 그것을 다시 쓰는 순간 감사의 뜻이 사라진다. 옛 값은 **읽기 전용 legacy 어휘**로 문서화하고, `API-ADM-005`의 `action` 필터는 현재 enum이 아닌 값도 받는다. 쓰기 어휘와 읽기 이력 어휘는 다르다. `repository.update`도 registry에 넣는다(DEV-402) — `API-ADM-003`의 `PATCH`는 이미 있는 운영 동작이고, 문서를 코드에서 좁히는 대신 `FR-ING-009` AC-5를 **등록·변경·해제**로 정밀화한다. **네 번째는 완료 기준이 자기 범위 밖을 요구하는 것이다**(DEV-403). `export.create`는 `WP-044`, `safe_marker.set`은 `WP-041` 소관이고 둘 다 `REL-006` `todo`다. 기능이 없으므로 `WP-039`가 기록할 대상이 없고, 그 상태로는 "모두 기록된다"가 어떤 구현으로도 참이 되지 않는다. `CR-052`가 `WP-036`에서 닫은 자리와 같은 모양이다(DEV-371). 둘을 **`NOT ACTIVATED`**로 registry에 남기고 소유 WP를 명시한다 — 합성 엔드포인트를 만들어 감사만 기록하는 길은 **없는 기능을 있다고 말하는 것**이라 택하지 않는다. **다섯째는 실패 격리가 한 자리에만 있는 것이다**(DEV-406). 보안 문서 7장과 `FR-AUTH-004` 예외 처리가 "감사 저장 실패가 조회를 막지 않는다"를 정하는데, `try`/`catch`와 `audit_record_failed_total`을 쓰는 것은 `raw_event.view_payload` 하나뿐이고 `repository.*`·`sequence_integrity.*` 넷은 `await`가 그대로 요청을 실패시킨다. 공용 경계 하나로 모은다. **"비동기"의 뜻도 함께 닫는다** — 요구는 *감사 쓰기가 주 트랜잭션 밖에 있고 그 실패가 주 동작의 결과를 바꾸지 않는 것*이지, 관측되지 않는 Promise나 새 큐가 아니다. 관측성의 "감사 저장 실패 5분 지속 → P2 → RB-18"도 실제 지표 이름에 연결한다(DEV-410). **여섯째는 잡 하나가 문서마다 다른 범위를 갖는 것이다**(DEV-407). 잡 카탈로그의 `JOB-AUD-001`은 "감사·원본 보존 만료 파티션 드롭"이고 관련 FR도 `FR-ING-003`·`FR-AUTH-004` 둘인데, 인프라 9.6은 같은 잡 아래에 **"완료 잡·해소된 DLQ 정리(90일)"**를 함께 적는다. 그 정리를 승인한 FR이 없으므로 **잘못된 귀속을 제거한다** — `WP-039`의 범위를 넓히지 않는다. 남는 둘은 **함께 구현한다**: `raw_event` 3년, `audit_record` 1년. 인계 기록이 감사 쪽만 적은 것은 불완전했다. **일곱째는 권한 계약이 세 문서에서 다른 것이다**(DEV-408). 권한 매트릭스는 `security_officer`가 `A-001~A-003`에서 `no_permission`이라 적고, `QA-A001-10`은 `CR-052` 뒤 "`security_officer`에게는 A-001 진입만 열린다"고 적어 **`A-004`를 빠뜨렸으며**, 구현의 `nav.ts`는 `ops` 섹션을 통째로 두 역할에 열어 **`operator`에게 `A-004`가, `security_officer`에게 `A-002`가 보인다.** 셋을 하나로 맞춘다: `operator`는 `A-001`(전체)·`A-002`·`A-003`, `security_officer`는 `A-004`(전체)·`A-001`(`A-001-ARCHIVE` 섹션만). 이것은 새 범위가 아니라 **이미 승인된 계약의 구현 정정**이므로 `WP-039`에서 함께 해소한다. **여덟째와 아홉째는 구현 seam이다.** `prs_admin` 롤은 마이그레이션 005에 있으나 그 롤로 접속할 경로가 없다 — `createPool()`은 `DATABASE_URL` 하나만 읽는다(DEV-411). `prs_app`에 `DROP`을 주는 길은 감사 불변성의 마지막 방어선을 없애므로 택하지 않고, **관리 연결을 별도 설정으로 연다.** 그리고 `audit_record`의 인덱스 셋 중 어느 것도 필터 없는 전역 목록의 정렬(`occurred_at DESC, audit_id DESC`)을 덮지 않는다(DEV-412) — 커서 순회의 정렬 키를 그대로 덮는 인덱스를 더한다. **신규 FR·NFR 없음, 새 ADR 없음, 안정 ID 재번호화 0건.** 새로 생긴 것은 `AuditAction` 정본 registry(용어집 항목 하나)와 `API-ADM-005`의 상세 규격이다 — API ID 자체는 이미 있었고 상세만 없었다 | DEV-400~412, FR-AUTH-004, FR-ING-003, FR-ING-009, FR-ING-010, FR-SRCH-010, FR-SRCH-012, FR-SEQ-005, FR-SEQ-006, FR-ADMIN-002, FR-ADMIN-003, NFR-006, API-ADM-002, API-ADM-005, ENT-CORE-007, JOB-AUD-001, A-001, A-004, C-002, QA-A001-10, QA-A004, WP-039, WP-041, WP-044 | `srs_final.md`, `glossary.md`, `requirements_screen_traceability_matrix.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_screen_qa_checklist.md`, `pr_search_api_contracts.md`, `pr_search_data_model.md`, `pr_search_async_events_jobs.md`, `pr_search_infrastructure_operations.md`, `pr_search_observability_reliability.md`, `pr_search_security_privacy_architecture.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md` | closed |
| CR-055 | 2026-08-30 | scope | WP-040 착수 전 운영 콘솔 계약 감사에서 확인된 DEV-428~434 | **화면이 누르라고 정한 운영 동작 넷이 정본에서 도달할 곳을 갖고 있지 않았다.** (1) DEV-428 — **등록 검토 요청에 처리 결과가 없다.** `A-002-REQUESTS`는 운영자가 요청 목록을 처리하는 자리인데 `FR-ING-009` AC-8~AC-10은 요청을 남기는 데까지만 정하고 `ENT-CORE-008`에도 처리 결과 열이 없다. 요청은 쌓이기만 하고 운영자가 무엇을 끝냈는지 적을 자리가 없으며, 같은 저장소를 여러 사람이 요청했을 때 등록 하나가 그 전부를 충족했다는 사실을 기록하지 못한다. `pending`·`fulfilled`·`dismissed` 셋을 승인한다. **승인과 실제 등록 사이의 중간 상태를 만들지 않는다** — 등록되지 않았는데 승인됐다는 상태는 아무것도 보장하지 못하므로 승인은 곧 성공한 등록이다. 세 상태 어느 것도 요청자에게 노출하지 않는다(AC-10의 비공개 경계는 그대로다). (2) DEV-429 — **조정 스캔에 수동 실행 경로가 없다.** `A-001`의 `ops.scan_run`이 즉시 실행을 요구하고 `JOB-ING-005`가 `schedule`·`manual` 둘을 승인하는데, `runReconcileSweep`에 도달하는 길은 주기 스위퍼 하나뿐이다. 새 조정 알고리즘을 만들지 않고 기존 실행에 도달하는 수동 진입점을 세운다. (3) DEV-430 — **`FR-ADMIN-002` AC-1의 제어 대상 다섯 중 둘을 만들 수 없다.** 생성 가능한 유형은 `backfill`·`link_rebuild` 둘이고 재색인은 `API-ADM-004`가 따로 소유하므로, 조정 스캔과 시퀀스 채번은 `job_type_chk`에 이름만 있고 그 유형을 집는 러너가 없다. **잡 유형이 있다는 것과 실행 가능한 잡이라는 것은 다르다** — `CR-034`가 `DEV-180`에서 바로 그 함정을 밟아 `sequence_assign` 잡 행을 거절했고, 그 판단은 "그 유형을 집는 러너가 없다"는 전제 위에 섰다. 이 CR은 러너를 세워 그 전제를 없앤다. 채번 알고리즘은 하나뿐이며 두 진입점이 같은 `assignSequence`에 모인다. (4) DEV-431 — **시퀀스 대상 브랜치를 더해도 조작 시점에 채번이 보장되지 않는다.** `PATCH`는 설정만 바꾸고 새 브랜치는 다음 조정 주기나 다음 push 웹훅을 기다린다. 조정 스캔이 결국 복구하므로 공백은 아니지만, 운영자가 브랜치를 더한 직후 그 공간이 비어 있는 이유를 화면이 설명하지 못한다. (5) DEV-432 — **`API-ADM-004`에 읽기 경로가 없다.** `A-003-INDEX`는 별칭과 실제 인덱스의 대응, 문서 수, 크기, 재색인 이력을 요구하는데 계약은 `POST` 하나뿐이다. 새 API ID를 만들지 않고 같은 자원의 `GET`으로 연다. (6) DEV-433 — **`API-ADM-001` 목록 계약이 `offset`을 명시해 공통 원칙 7·ADR-010과 어긋난다.** 기존 두 목록의 오프셋은 이 CR이 걷어 내지 않고 등재만 하되, **이 CR이 신설하는 목록에는 처음부터 오프셋을 두지 않는다.** (7) DEV-434 — **`WP-040`의 관련 요구사항이 A-001의 근거를 싣지 않는다.** `CR-052`가 A-001 완성을 이 WP로 옮겼는데 `FR-ADMIN-001`·`FR-ING-007`·`FR-ING-010`·`FR-ING-011`이 목록에 없다. 기능 추가가 아니라 추적 정정이다. **신규 FR을 만들지 않는다** — 일곱 결함 모두 이미 승인된 요구사항이 남긴 빈칸이므로 기존 FR을 정밀화하고 SRS는 `v2.15`가 된다. `API-ADM-009`는 실제로 새 자원(운영자 평면의 등록 검토 요청 큐)이므로 신설한다 | DEV-428, DEV-429, DEV-430, DEV-431, DEV-432, DEV-433, DEV-434, FR-ING-009, FR-ADMIN-001, FR-ADMIN-002, FR-ADMIN-003, FR-ING-006, FR-ING-007, FR-ING-008, FR-ING-010, FR-ING-011, FR-AUTH-004, API-ADM-001, API-ADM-002, API-ADM-004, API-ADM-009, ENT-CORE-008, JOB-ING-005, JOB-SEQ-001, A-001, A-002, A-003, C-043, C-044, C-045, C-046, W-009, WP-040 | `srs_final.md`, `glossary.md`, `requirements_screen_traceability_matrix.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_ui_component_spec.md`, `pr_search_screen_qa_checklist.md`, `pr_search_screen_flow_spec.md`, `pr_search_api_contracts.md`, `pr_search_data_model.md`, `pr_search_async_events_jobs.md`, `pr_search_security_privacy_architecture.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md`, `change_control.md` | closed |
| CR-056 | 2026-08-30 | scope | PR #75 머지 후 리뷰 다섯에서 확인된 DEV-449~453 | **변경 규모 분포가 0을 세지 않고, 모름을 0이라 말한다.** (1) DEV-449 — **0이 갈 구간이 없다.** `FR-STAT-005` AC-1·AC-2의 구간이 모두 1부터 시작하는데 AC-5는 "값이 없는 것과 0인 것을 같은 구간에 넣지 않는다"고 정한다. 그래서 파일을 하나도 바꾸지 않은 PR은 **어느 구간에도 속하지 않고 집계에서 사라지며** 비율의 합이 `total`을 덮지 않는다. 두 축 모두 `0` 구간을 신설한다 — 첫 구간을 0부터로 넓히지 않는 이유는 0이 사실의 진술이고 "하나도 바꾸지 않음"과 "하나 바꿈"이 조사에서 다른 것을 뜻하기 때문이다. (2) DEV-450 — **모름이 0으로 저장된다.** 투영이 `enrichment_pending`이어도 두 필드를 언제나 쓰므로 빈 파일 목록이 0이 되고, 집계의 `unknown`은 `missing`으로 판정해 그 문서를 잡지 못한다. AC-5가 요구하는 구간이 실제로는 언제나 비어 있고 **화면이 모름을 "0줄 바꿨다"는 사실 주장으로 바꿔 말한다.** 보강이 끝나지 않은 문서는 두 필드를 쓰지 않게 하고 판정 재료를 `enrichment_pending` 하나로 고정한다. (3) DEV-451 — **구간별 드릴다운이 그 구간을 가리키지 않는다.** AC-4가 요구하는 질의를 만들 재료가 문법에 없어 모든 구간이 같은 문자열을 받고, 실행하면 전체가 나온다. `FR-SRCH-005` AC-1에 `changed_files`·`changed_lines` 범위 키를 더해 그 조건을 표현할 수 있게 한다. **신규 FR·NFR 없음, 새 ADR 없음, 안정 ID 재번호화 0건** — 승인된 수용 기준이 남긴 빈칸 셋을 메운다 | DEV-449, DEV-450, DEV-451, DEV-452, DEV-453, FR-STAT-005, FR-SRCH-005, API-STAT-004, WP-037 | `srs_final.md`, `pr_search_api_contracts.md`, `pr_search_data_model.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md` | closed |
| CR-057 | 2026-08-31 | scope | WP-041 착수 전 안전 구간 표식 계약 감사에서 확인된 DEV-458~463과 OD-008 기한 도래 | **승인된 기능 하나가 카탈로그의 한 행으로만 존재했다.** 여섯 중 넷이 같은 뿌리다 — `API-SEQ-004`는 4장에 상세 절이 없어 요청도 응답도 오류도 정의된 적이 없다. (1) DEV-458 — **계약이 카탈로그 행 하나뿐이다.** 4장은 `API-SEQ-001`·`002`·`003`·`006`에 요청·응답·오류를 적는데 `API-SEQ-004`는 22행 표의 한 줄이 전부다. **구현이 딛을 계약이 없으면 구현이 계약이 된다** — `WP-041`이 무엇을 만들든 그것과 어긋날 문서가 없다. (2) DEV-459 — **에폭 불일치 쓰기가 무엇을 반환하는지 아무도 말하지 않는다.** 백엔드 아키텍처 6.2가 "에폭 일치"를 정책 검사로 요구하지만 그것을 어긴 `PUT`의 상태 코드도 기계 판독 코드도 없다. 읽기 경로는 200에 `epoch_stale`를 실어 답하는 어휘가 있고 저장된 검색 쓰기는 409를 내는데, 표식 쓰기만 비어 있다. (3) DEV-460 — **`FR-SEQ-006` 예외 처리가 지목한 사유 코드가 오류 모델에 없다.** `sequence_not_found`를 적었는데 6장 표에 그 코드가 없다 — `BISECT_CONTRADICTION`·`ANCHOR_NOT_ON_BRANCH`를 비롯한 다른 FR의 사유 코드는 전부 등재돼 있다. (4) DEV-461 — **카탈로그의 권한 칸이 읽기와 쓰기를 가르지 않는다.** `인증 / release_manager`는 조회까지 그 역할을 요구하는 것으로 읽히는데, `AC-3`이 403으로 정한 것은 **쓰기 요청**이다. 그대로 구현하면 승인된 적 없는 조회 제한이 생긴다. (5) DEV-462 — **표식 대상 서수의 출처가 정의되지 않았다.** `W-004-MARKER`는 "현재 표식과 등록 액션"만 적고 무엇을 등록하는지 말하지 않는다. 화면 목적이 "검증 완료 지점을 기록한다"이고 조사 구간이 반개구간 `(from, to]`이므로 그 지점은 **끝 앵커**인데, 그것이 어느 문서에도 없어 구현이 임의의 입력창을 발명하게 된다. (6) DEV-463 — **멱등 키가 값으로만 있고 뜻이 없다.** 6.2 표가 `(repo, branch, seq, epoch)`를 적었으나 재시도가 이력을 하나 더 만드는지, 감사 행을 중복으로 남기는지 정의되지 않았다. `safe_marker_current_uk`는 "현재 표식은 하나"만 강제하고 같은 값의 재등록을 막지 않는다. **`OD-008`을 `(a) release_manager 전용`으로 닫는다** — `FR-SEQ-006` AC-3과 카탈로그의 권한, 백엔드 6.2의 actor가 이미 셋 다 그 역할을 지목하며, `(b) 저장소 관리자 포함`은 승인된 계약의 권한 범위를 넓히는 변경이다. **신규 FR·NFR 없음, 새 ADR 없음, 새 화면·API·엔티티·컴포넌트 ID 없음, 안정 ID 재번호화 0건, 신규 마이그레이션 없음** — 승인된 기능이 남긴 계약 빈칸 여섯을 메우고 마지막 오픈 결정을 닫는다. **PR #101 리뷰 넷이 새로 쓴 계약에서 결함 넷을 더 찾았고 전부 실결함이었다** (DEV-464~467) — 멱등이 시간을 건너 성립하지 않는 것, 메모 변경이 재시도로 접히는 것, 파생 UI 캐스케이드의 flow 단계를 건너뛴 것, SRS를 올리며 매트릭스를 갱신하지 않은 것 | OD-008, DEV-458, DEV-459, DEV-460, DEV-461, DEV-462, DEV-463, DEV-464, DEV-465, DEV-466, DEV-467, FR-SEQ-006, API-SEQ-004, ENT-SEQ-003, C-031, FLOW-003, WP-041 | `srs_final.md`, `prd.md`, `requirements_screen_traceability_matrix.md`, `pr_search_api_contracts.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_flow_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_ui_component_spec.md`, `pr_search_screen_qa_checklist.md`, `pr_search_backend_architecture.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md` | closed |
| CR-058 | 2026-08-31 | scope | WP-069 착수 전 작성자 소속 팀 계약·릴리스 회계 감사에서 확인된 DEV-477~487 | **승인된 `Must` 요구사항 둘이 데이터 없이 서 있고, 그 사실을 회계가 말하지 않는다.** 열하나 중 넷이 회계이고 일곱이 계약이다. (1) DEV-477 — **원장 3장 진행 표에 `WP-069` 행이 없다.** 작업 패키지 문서는 두 곳(요약 표·`REL-006` 커버리지 5)에 담고 있는데 `CLAUDE.md`가 정본으로 지목한 진행 표에만 빠져 있어 `REL-006`이 4개짜리 슬라이스로 읽힌다. (2) DEV-478 — **`DEV-453`의 상태 칸이 소유 WP를 `WP-046`으로 적는다.** 같은 원장의 6.53장 요약 표와 `CR-056` 반영 내역과 작업 패키지 문서는 셋 다 `WP-069`를 지목한다. `WP-046`은 `REL-007`의 위임 GitHub 신원이므로 그대로 읽으면 작성자 팀이 `REL-007`까지 밀리는데, **조직 팀 조회는 수집용 앱 자격으로 이미 성립한다** — `WP-068`이 같은 클라이언트로 저장소 팀을 읽는다. (3) DEV-479 — **로드맵에 `WP-069`도 author-team carryover도 없다.** `REL-006`의 포함 요구사항은 `FR-SEQ-006`·`FR-SEQ-007`·`FR-REL-008`·`FR-SRCH-012`뿐이고 5장 슬라이스 표도 같다. `REL-005`가 `FR-STAT-006`을 포함하고 그 exit criteria가 "그룹 집계가 동작한다"인데 `group_by=team`은 데이터가 없어 언제나 빈 버킷이며, **그 둘이 어떻게 병립하는지 어느 문서도 말하지 않는다.** (4) DEV-480 — **로드맵의 "남은 오픈 결정은 OD-008 하나다"가 거짓이 됐다.** `CR-057`이 `OD-008`을 닫았고 오픈 결정은 하나도 남지 않았다. (5) DEV-481 — **작성자 팀이 어느 조직의 팀인지 정의되지 않았다.** `WP-069`는 "조회 단위는 사용자이며 저장소가 아니다"까지만 적는다. `team.slug`은 `UNIQUE (org_id, slug)`라 조직 밖에서는 유일하지 않으므로, 범위를 정하지 않으면 같은 이름이 조직마다 다른 팀을 가리킨다. (6) DEV-482 — **`author` → teams 조회 경로가 정의되지 않았고 로컬 미러가 그 질문에 답하지 못한다.** GHE REST에 임의 사용자의 팀 목록 API가 없고 이 저장소는 GraphQL을 쓰지 않는다. `team_member`는 `user_id TEXT REFERENCES app_user(user_id)`라 **PR Search에 로그인한 적 없는 작성자를 담을 수 없으며**, `packages/authz/integration/scope.test.ts`가 그 사실을 이미 시험으로 고정하고 있다. (7) DEV-483 — **`team` 레지스트리가 저장소 접근 팀만 담는다.** 그 표를 채우는 유일한 경로가 `team-scope.ts`의 `listRepositoryTeams` 순회다. 작성자 소속 팀이 그 집합 밖이면 `resolveTeamIds`가 slug를 못 옮겨 **`author_team:` 질의가 조용히 비고**, `resolveTeamSlugs`가 못 옮겨 **`group_by=team` 버킷이 숫자로 남는다.** (8) DEV-484 — **옛 `author_team_ids`를 지우는 규칙이 없다.** DoD는 "소속을 읽지 못한 작성자의 문서에 필드가 없다"만 말하는데 조건부 업서트는 **실린 키만 대입한다.** `DEV-450`이 변경 규모 넷에서 겪은 것과 같은 모양이며 `UpsertRequest.remove`가 그 자리다. (9) DEV-485 — **재색인이 옛 소속을 재생한다.** DoD가 "소속 변경이 재색인·백필로 반영된다"를 요구하는데 재색인은 `pull_request_snapshot`을 읽고 `registryOwnedFields`만 덮는다 — `author_team_ids`는 그 함수에 없으므로 **투영 시점에 박제된 값이 그대로 돌아온다.** `WP-068`이 `allowed_team_ids`에서 겪은 것과 같은 종류다. (10) DEV-486 — **소속 캐시의 신선도와 무효화가 정의되지 않았다.** `WP-069`가 "캐시하되"라고만 적어 무엇을 키로 삼는지, 언제 낡은 것으로 보는지, 조회 실패를 캐시하는지가 없다. **낡음의 판정이 곧 아는 것과 모르는 것의 경계**이므로 이것이 정해지지 않으면 `[]`와 부재를 가르는 규칙도 성립하지 않는다. (11) DEV-487 — **작성자를 모르는 문서와 조직 밖 작성자의 처리가 정의되지 않았다.** 보강이 PR을 못 가져오면 `author` 자체가 문서에 없는데 그것은 "소속을 읽지 못한" 것과 다른 사실이다. **결정 셋을 확정한다.** ① 작성자 팀의 범위는 **그 PR 저장소의 조직**이다 — 등록된 모든 조직으로 넓히면 판정이 전 조직의 동기화 상태에 묶여 한 조직의 실패가 모든 문서를 모름으로 만든다. ② 조회는 **조직 단위로 모아** 한다 — `listOrgTeams` + 팀별 `listTeamMembers`로 `login → team_ids`를 만들며, 비용이 조직당 팀 수이고 **작성자 수와 무관하다.** 작성자마다 팀 수만큼 `isTeamMember`를 부르는 방식은 `작성자 × 팀`이라 채택하지 않는다. ③ 아는 것과 모르는 것의 경계는 **그 조직의 동기화 시각**이다 — 신선하면 `[]`도 사실이고, 낡았거나 없으면 필드를 쓰지 않고 옛 값을 지운다. **신규 마이그레이션 021을 연다 — 스키마 공백이 증명됐다.** `ADR-004`의 불변 조건은 "모든 엔티티 문서는 PostgreSQL 데이터만으로 재구성 가능해야 한다"이고 `reindex.ts`는 GHE를 한 번도 부르지 않는다. 그러므로 재색인이 현재 소속으로 다시 쓰려면 **소속이 PostgreSQL에 있어야 하고**, `team_member`는 `app_user` 외래 키 때문에 그것을 담을 수 없다(DEV-482). **`team_member`의 외래 키를 푸는 대안은 택하지 않았다** — 그 표의 뜻은 "이 팀에 속한 PR Search 사용자"이고 무효화가 그 뜻으로 읽는다. 두 뜻을 한 표에 담는 것이 `allowed_team_ids`와 `author_team_ids`를 섞는 것과 같은 오류다. **신규 FR·NFR 없음, 새 ADR 없음, 새 화면·API·엔티티·컴포넌트 ID 없음, 안정 ID 재번호화 0건, SRS 변경 없음** — 승인된 `Must` 둘이 딛고 설 계약을 채우고 릴리스 회계를 현실과 맞춘다 | DEV-477, DEV-478, DEV-479, DEV-480, DEV-481, DEV-482, DEV-483, DEV-484, DEV-485, DEV-486, DEV-487, DEV-453, FR-SRCH-005, FR-STAT-006, ENT-CORE-002, REL-005, REL-006, WP-069 | `pr_search_implementation_roadmap.md`, `pr_search_work_packages.md`, `pr_search_data_model.md`, `pr_search_backend_architecture.md`, `pr_search_implementation_traceability.md` | closed |
| CR-059 | 2026-09-01 | scope | 첫 사내 반입 착수 전 배포·반입 모델 감사에서 확인된 DEV-490~499 | **첫 사내 반입의 배포 수단과 형상 승계 경로가 문서에 없다.** 승인된 첫 파일럿 조건은 Linux 호스트 1대·Docker Compose·오프라인 반입·단방향 다운스트림인데, 현재 문서 체계는 그 넷 중 어느 것에도 자리를 주지 않는다. 열 중 넷이 배포 수단이고 셋이 반입 경로이며 셋이 구성 표면이다. (1) DEV-490 — **컨테이너 이미지를 만드는 경로가 저장소에 없다.** `deploy/k8s/`의 매니페스트가 `prs/pipeline-worker:latest`·`prs/search-api:latest`·`prs/ingest-gateway:latest`·`prs/db:latest`를 참조하는데 `Dockerfile`이 저장소 전체에 **한 개도 없다**(전수 확인). 그 매니페스트는 적용할 수 없는 상태이며 어떤 시험도 그 사실을 묻지 않는다 — 운영 도달성 회귀는 매니페스트 **파일의 존재**와 그것이 역할을 켜는지만 본다. `CR-034`가 세운 규율("역할에 manifest가 없으면 그 기능은 배포되지 않는다")이 한 칸 아래에서 같은 모양으로 뚫려 있다: **이미지가 없으면 manifest가 있어도 배포되지 않는다.** (2) DEV-491 — **배포 매니페스트의 이미지 태그가 전부 `latest`다.** digest도 없다. 인프라 9.3장이 롤백을 "이전 이미지 재배포" 5분으로 약속하는데 **어느 것이 이전 이미지인지 가리킬 식별자가 없다.** 오프라인 반입에서는 더 무겁다 — 반입된 형상이 어느 외부 커밋에서 나왔는지 답할 수 없다. (3) DEV-492 — **`web`이 배포 단위 표에 있는데 매니페스트가 없다.** 인프라 3장 표의 첫 행이 `web`(2/6, `GET /healthz`)인데 `deploy/k8s/`에 `web.yaml`이 없다. 역방향 회귀는 `pipeline-worker:*` 역할만 대조하므로 이 공백을 묻지 않는다. `DEV-292`(`batch`)·`DEV-306`(`authz`)과 같은 모양이며 이번에는 **워커가 아니라 사용자 접점**이다. (4) DEV-493 — **`.env.example`이 실제 구성 표면의 일부만 드러낸다.** 코드가 소비하는 환경 변수 마흔넷 중 열여섯만 있다. 빠진 것에 `DATABASE_URL`(소비 지점 16곳으로 최다), OIDC 아홉, `GHE_API_URL`, `ADMIN_API_TOKENS`, `ADMIN_DATABASE_URL`, `SEARCH_CURSOR_HMAC_KEY`, `MIRROR_ROOT`, `AUTH_ENABLED`가 있다. 사내에서 이 파일을 보고 구성하는 운영자는 **기동하지 않는 형상을 만든다.** (5) DEV-494 — **사내 프록시와 사설 CA를 받을 자리가 코드에 없다.** `HTTPS_PROXY`·`NO_PROXY`·`NODE_EXTRA_CA_CERTS`를 읽거나 커스텀 `Agent`를 세우는 코드가 전수 검색으로 0건이다. GHE REST·GHE Git·OIDC 셋이 전부 Node 기본 동작으로 나간다. 사내망이 프록시를 강제하거나 사설 CA를 쓰면 **고칠 자리가 core code가 되고 그 수정은 외부로 되돌아올 수 없다** — 영구 다운스트림에서 그것이 곧 유지비다. (6) DEV-495 — **`search-api`의 `/healthz`가 문서가 약속한 확인을 하지 않는다.** 인프라 3장 표는 `GET /healthz` (ES·PG 연결 확인)로 적는데 구현은 `{status:'ok'}`를 무조건 반환한다(소스 주석이 "각 연결을 실제로 여는 WP에서 더한다"고 남겨 두었다). `ingest-gateway`는 실제로 PostgreSQL을 확인한다 — **같은 표의 두 행이 다른 수준을 뜻하고 있었다.** 단일 호스트에서는 이 차이가 더 크다: 오케스트레이터가 없으므로 health가 유일한 기동 판정 수단이다. (7) DEV-496 — **SRS 5.2-6이 배포 수단을 Kubernetes로 못박는다.** "배포 대상은 사내 Kubernetes 클러스터이며 인터넷에 노출하지 않는다"가 `baseline` 기술 제약이다. 승인된 첫 파일럿은 Compose이므로 **이 문장을 고치지 않으면 파일럿 자체가 승인 범위 밖이다.** (8) DEV-497 — **인프라 2장 환경 표에 첫 사내 파일럿이 들어갈 자리가 없다.** `local`·`dev`·`staging`·`production` 넷뿐이다. 파일럿은 그 넷 중 어느 것도 아니다 — 실데이터를 쓰지만 `production`의 HA 구성을 갖지 않고, Compose를 쓰지만 `local`의 합성 픽스처가 아니다. (9) DEV-498 — **운영 도달성 회귀가 K8s 매니페스트를 유일한 배포 정본으로 고정한다.** `CAPABILITIES`의 `manifest` 필드가 전부 `deploy/k8s/` 경로 하나이며, 새 배포 프로파일이 같은 역할을 켜지 않아도 아무 시험도 죽지 않는다. **`CR-034`가 찾은 결함이 프로파일 축에서 그대로 재현될 자리다.** (10) DEV-499 — **보안 문서 6장이 시크릿 저장 수단을 Kubernetes Secret으로만 정의한다.** 아홉 종 전부가 그 칸인데 단일 호스트에는 그 수단이 없다. 저장 수단이 정의되지 않으면 운영자가 임의로 정하고, 그 임의값이 번들에 섞여 나갈 위험이 곧 `NFR-005`의 "시크릿 노출 0건"이 막으려던 것이다. **결정 다섯을 확정한다.** ① **배포 프로파일을 둘로 가른다.** Profile A(단일 호스트 Compose)가 첫 사내 파일럿의 **현재 기본**이고, Profile B(다중 호스트 Kubernetes)는 다중 서버·HA가 필요해질 때 쓰는 **선택 프로파일**이다. **기존 K8s 산출물은 삭제하지 않는다** — 그것은 Profile B의 자산이며 삭제하면 그 프로파일로 갈 때 다시 만들어야 한다. ② **`OD-006`의 3노드 Elasticsearch 결정을 다시 쓰지 않는다.** 그 결정은 `production` 환경의 결정이고 당시 범위에서 옳았다. 대신 **파일럿 환경에서는 이 CR의 Profile A가 우선한다**는 좁힘 기록을 덧붙인다 — 3노드를 "잘못이었다"고 적는 것은 역사를 다시 쓰는 것이다. ③ **SRS 5.2-6을 정정한다.** "사내 Kubernetes 클러스터"를 배포 프로파일 둘을 담는 표현으로 넓히되 **"인터넷에 노출하지 않는다"는 유지한다.** 이것이 이 CR에서 SRS를 건드리는 **유일한 자리**이며, 사용자 기능은 하나도 바뀌지 않으므로 FR·화면·API는 손대지 않는다. ④ **첫 반입은 오프라인 번들 하나로 한다.** 사내에서 `git clone`도 `pnpm install`도 컨테이너 레지스트리 접근도 요구하지 않는다. 번들은 애플리케이션 이미지와 백킹 이미지를 함께 담고, 어느 외부 커밋에서 나왔는지를 `release-manifest.json`이 기계가 읽는 형태로 증명하며, 모든 파일에 checksum이 붙는다. **시크릿은 어떤 번들에도 들어가지 않는다.** ⑤ **형상 승계는 단방향이다.** 외부 저장소는 upstream 릴리스 생산자이고 내부 저장소는 영구 다운스트림 제품 라인이다. 내부 수정을 외부로 되돌리는 절차는 **설계하지 않는다** — 그것이 성립하지 않는 것이 이 반입의 전제다. 내부는 `vendor/upstream`(반입 baseline, 내부 수정 금지)과 `company/main`(운영 형상)을 나누고 통합은 merge를 우선한다 — 매번 내부 이력을 upstream 위로 재작성하면 다운스트림 추적성과 내부 감사가 불리해진다. **새 ADR을 만든다 — `ADR-021`.** 배포 오케스트레이션을 정한 ADR이 지금까지 **하나도 없었다**(ADR-001~020 전수 확인). K8s는 SRS 기술 제약과 인프라 문서에만 있었고 그 선택의 근거는 어디에도 기록되지 않았다. 이 CR이 정하는 것은 그 공백을 메우는 결정이며 운영 리스크(SPOF를 승인된 trade-off로 받는다)·확장성(Profile B 승격 경로)·구현 비용(오프라인 번들 빌드)에 걸치므로 ADR 1장의 정의에 부합한다. **신규 FR·NFR 없음, 새 화면·API·엔티티 ID 없음, 안정 ID 재번호화 0건, 신규 마이그레이션 없음** — 스키마 공백이 증명되지 않았다. 다음 빈 번호가 022라는 것은 마이그레이션을 여는 이유가 아니다(`CR-058`이 021에서 세운 규율) | DEV-490, DEV-491, DEV-492, DEV-493, DEV-494, DEV-495, DEV-496, DEV-497, DEV-498, DEV-499, DEV-503, DEV-001, DEV-304, DEV-305, ADR-021, OD-006, NFR-004, NFR-005, NFR-008, WP-070 | `srs_final.md`, `pr_search_architecture_decision_records.md`, `pr_search_infrastructure_operations.md`, `pr_search_security_privacy_architecture.md`, `pr_search_system_architecture.md`, `pr_search_implementation_roadmap.md`, `pr_search_release_validation_plan.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md`, `docs/README.md` | closed |
| CR-060 | 2026-09-01 | correction | `CR-059`·`WP-070`·`DEV-500` 머지 후 리뷰 12건 (PR #107·#108·#109) | **머지된 세 PR이 남긴 미해결 리뷰 열둘을 소스로 검증했고 전부 실결함이었다.** 넷이 계약 모순, 넷이 배포 절차의 실행 불가, 둘이 시험의 시간 의존, 둘이 거짓 완료 주장이다. (1) DEV-504 — **주기 백업만으로 `RPO 0`을 주장했다.** `CR-059`가 `NFR-004`에 "`RPO 0`은 프로파일과 무관하게 유지된다"고 쓰면서 근거로 든 "원본 저장 후 202 응답" 규칙은 **프로세스 실패**만 덮는다 — 호스트나 볼륨을 잃으면 마지막 `pg_dump` 이후 수신분이 사라지고 그것은 GHE가 성공으로 간주한 이벤트다. 같은 CR이 인프라 9.4장에 적은 Profile A 백업 전략과 **서로 모순이었다.** (2) DEV-505 — **`NFR-004`의 예외로 `NFR-008`을 면제했다.** 릴리스 검증 계획이 Gate 6의 "롤백 10분"을 "무중단 롤링 업데이트를 전제한다"며 판정 대상에서 뺐는데, `NFR-008`의 그 지표는 무중단을 요구한 적이 없고 **비고 칸이 이미 "이전 이미지 재배포"라고 적는다** — 그것이 정확히 Profile A가 하는 일이다. **파생 문서가 승인 범위를 좁히는 것도 넓히는 것과 같은 위반이다.** (3) DEV-506 — **SRS를 고치고 추적 매트릭스를 따라가지 않았다.** `10_requirements/AGENTS.md`가 "When the SRS changes, update the traceability matrix in the same pass"를 정하는데 v1.2 그대로였다. (4) DEV-507 — **`WP-070`이 FR을 하나도 참조하지 않는다.** `40_delivery/AGENTS.md`가 "every WP must reference at least one FR"을 정하는데 NFR과 기술 제약만 적었고, 그러면 그 배포가 **어떤 승인된 행위를 보존해야 하는지** 인계가 판정할 수 없다. (5) DEV-508 — **번들 DoD가 소스 계보를 요구하지 않는다.** 구현은 git bundle을 담고 있었으나 DoD 문구로는 이미지와 checksum만으로 통과할 수 있었고, 그러면 `vendor/upstream`을 만들 수 없어 **첫 내부 수정 이후 `ADR-021`의 병합 절차가 성립하지 않는다.** (6) DEV-509 — **`DEV-500`의 정정이 시한폭탄을 옮겼을 뿐이다.** 롤링 과거 3개월 창은 2026-12-01이 되면 `2026-08` 픽스처를 다시 놓치고, **그때도 새 회귀는 초록이다** — 직전 3개월만 확인하기 때문이다. 고정 날짜를 쓰는 파일이 여섯이고 전부 같은 달이다. (7) DEV-510 — **런북의 접속 주체 생성 단계가 실행 불가능하다.** `prs_app`은 마이그레이션 005가 만드는데 그 마이그레이션은 뒤 단계인 `prsctl install`이 돌리며, 표시된 SQL도 주석일 뿐 실행 수단이 없다. 절차를 따르면 **모든 서비스가 인증에 실패한 채 기동한다.** (8) DEV-511 — **복구가 낡은 색인을 그대로 서비스한다.** `es-bootstrap`은 매핑만 다시 적용하고 기존 인덱스를 남기므로, 복원한 정본보다 새로운 문서가 **정본에 없는데도 검색으로 답해진다** — 되돌린 데이터가 조회로 되살아나며 "색인은 비어 있다"는 안내가 거짓이다. (9) DEV-512 — **계보 검사가 미추적 파일을 보지 못한다.** `git diff --quiet HEAD`는 미추적을 보고하지 않는데 `COPY . .`은 그것을 이미지에 넣는다 — manifest가 주장하는 커밋과 **이미지 내용이 다를 수 있다.** (10) DEV-513 — **업그레이드 절차의 첫 명령이 실패한다.** 번들은 값이 채워진 `.env`를 담지 않는데(시크릿이다) `prsctl load`가 `require_env`를 먼저 부른다. (11) DEV-514 — **복구가 마이그레이션을 다시 적용하지 않는다.** 설치·업그레이드는 하는 일을 복구만 빠뜨려, 백업이 이전 릴리스면 현재 코드가 없는 열을 읽다 죽는다. (12) DEV-515 — **"read-only 검색 스모크 통과"가 거짓 주장이었다.** 스모크는 `/healthz` 둘과 별칭 존재만 봤고 **검색 요청을 한 번도 보내지 않았다** — 라우팅·인증 배선·질의 구성·결과 디코딩이 통째로 깨져도 통과한다. 그런데 `WP-070`의 DoD에 그 항목을 체크했다. (13) DEV-516 — **자체 발견.** `DEV-493`을 닫으며 "소비 지점과 대조한 값 전수"라고 적었으나 `ADMIN_API_TOKENS`가 빠져 있었다. **정정 다섯을 확정한다.** ① `RPO 0`은 **연속 WAL 아카이빙을 독립 저장소로 보낼 때만** 성립한다고 SRS에 적고, 없으면 실효 RPO가 마지막 백업 이후 경과 시간임을 명시한다 — **지표를 낮추지 않았다.** ② Gate 6의 롤백 10분을 Profile A에도 **그대로 적용**한다. ③ 통합 헬퍼의 **롤링 과거 창을 없애고** 고정 날짜를 쓰는 시험이 `migratedPool({ fixtureMonths })`로 자기 달을 선언한다 — 빠뜨리면 **즉시** 실패하므로 시한폭탄이 생기지 않는다. ④ `prsctl install`·`upgrade`·`restore`가 마이그레이션 **뒤에** 접속 주체를 프로비저닝하고, `restore`는 마이그레이션 재적용과 파생 색인 삭제·재색인 예약까지 한다. ⑤ 스모크가 관리 토큰으로 **실제 조회 왕복**(PostgreSQL·Elasticsearch)을 걸고, `/search`는 사내 OIDC를 요구하므로 `NOT RUN`으로 남긴다. (14) DEV-517 — **자체 발견, 그리고 이 CR에서 가장 무거운 것이다.** `DEV-511`을 고쳐 복구가 실제로 재색인을 예약하게 하자 세 잡이 전부 `permission denied for table pull_request_snapshot`으로 죽었다. 마이그레이션 005가 `prs_app`에게 **표 이름을 열거해** 권한을 주므로 그 뒤 만들어진 표 다섯이 **`SELECT`조차 없다.** 통합 시험이 소유자 롤로 돌아 이 사각지대를 한 번도 묻지 않았고, `prs_app`으로 실제 접속하는 배포가 이번이 처음이다. **Profile A만의 문제가 아니다.** **신규 마이그레이션 022를 연다 — 스키마 공백이 실행으로 증명됐다** (DEV-517). `ALTER DEFAULT PRIVILEGES`는 쓰지 않는다: 앞으로 만들어지는 모든 표에 `UPDATE`·`DELETE`가 자동으로 붙어 감사 불변성의 예외를 표현할 수 없게 된다. 대신 권한 시험이 **모든 표를 훑는다.** **신규 FR·NFR 없음, 새 ADR 없음, 새 화면·API·엔티티 ID 없음, 안정 ID 재번호화 0건** | DEV-504, DEV-505, DEV-506, DEV-507, DEV-508, DEV-509, DEV-510, DEV-511, DEV-512, DEV-513, DEV-514, DEV-515, DEV-516, DEV-517, DEV-502, NFR-004, NFR-008, WP-070, CR-059 | `srs_final.md`, `requirements_screen_traceability_matrix.md`, `pr_search_infrastructure_operations.md`, `pr_search_release_validation_plan.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md`, `pr_search_data_model.md`, `pr_search_implementation_roadmap.md` | closed |
| CR-061 | 2026-09-01 | correction | `CR-060` 머지 후 리뷰 2건 (PR #110) | **`CR-060`의 정정이 각각 한 겹 아래에 같은 결함을 남겼다.** (1) DEV-518 — **`022`가 표만 보고 시퀀스를 세지 않았다.** 005의 `ON ALL SEQUENCES`도 그 시점의 것만 뜻하는데 `DEV-517`을 고치며 표에만 메웠고, `repository_registration_request_request_id_seq` 하나가 남아 등록 요청 `INSERT`가 `permission denied for sequence`로 막힌다 — **`022`가 표를 열어 준 덕에 `INSERT`가 시퀀스까지 가서 거기서 막히는 것이다.** (2) DEV-519 — **복구가 색인 넷을 지우고 하나만 다시 만든다.** `enqueueReindex`의 전역 동시 실행 상한이 1이라 연달아 예약하면 셋이 `busy`로 거절되는데, 바로 위에서 넷을 모두 지웠으므로 **셋이 빈 채로 서비스되고** `restore`는 그 실패를 출력만 하고 **종료 코드 0으로 끝났다.** 검증 실행의 "재색인 예약 2/4"가 그 증상이었고, 둘이나 선 것은 첫 잡이 `DEV-517`로 빨리 죽어 자리를 비웠기 때문이다 — **정상 시스템이라면 하나만 섰다.** **정정 둘.** ① **마이그레이션 023**으로 그 시퀀스에 권한을 주고, 권한 시험이 **모든 시퀀스도 훑는다.** ② 복구가 별칭을 **하나씩 끝까지** 돌리고, 끝나지 않은 것이 있으면 **이름을 말하고 종료 코드 1을 낸다** — 절반만 선 상태를 완료로 보고하지 않는다. **신규 FR·NFR 없음, 새 ADR 없음, 안정 ID 재번호화 0건** | DEV-518, DEV-519, DEV-517, DEV-511, WP-070, CR-060 | `pr_search_infrastructure_operations.md`, `pr_search_data_model.md`, `pr_search_implementation_traceability.md` | closed |
| CR-062 | 2026-09-02 | correction | 첫 사내 반입 운반·반입 절차 감사에서 확인된 DEV-523·DEV-524 | **`WP-070`이 세운 "반입 가능성"과 사람이 실제로 수행할 "반입 절차" 사이가 비어 있다.** 첫 사내 반입 가능선은 섰으나, 담당자가 외부망에서 **파일 하나**를 만들어 사내망으로 옮기고 런북을 위에서 아래로 그대로 실행하는 절차가 정본화되지 않았다. (1) DEV-523 — **사내로 가져갈 파일이 정의되어 있지 않다.** `build-bundle.sh`는 디렉터리(`pr-search-<version>-offline/`, 파일 10개·2.6GB)를 만들고 끝나며 그것을 하나로 묶는 단계가 없다. 그런데 런북 2장 0단계는 "번들을 호스트에 옮긴 뒤 **풀어 놓는다**"고 적어 압축된 무언가를 전제하고 인프라 9.1장은 "번들 **하나**가 건너간다"고 적는다 — 운반 단위는 어느 문서에도 없고 운영자가 `tar`를 직접 조립해야 한다. 같은 뿌리에서 셋이 더 나왔다: 인프라 8장이 외부망 명령을 `pnpm release:bundle`로 적는데 **그 스크립트는 `package.json`에 없다**(실측 0건); 번들 안의 아카이브 세 종류(`images/*.tar`는 `docker load` 대상, `source/*.bundle`은 `git fetch` 대상)와 운반 아카이브의 구분이 런북에 없어 `.tar`를 보고 `tar -xf`를 치는 운영자를 막는 문장이 없다; 런북이 번들 트리를 보여 주지 않아 무엇이 도착해야 정상인지 알 수 없다. (2) DEV-524 — **최초 설치 절차를 그대로 따르면 두 번째 명령에서 멈춘다.** 런북 2장이 `verify → load → .env 작성 → install`인데 `cmd_load`가 `require_env`를 부른다(`prsctl` 125행) — `.env`가 아직 없는 최초 설치에서 `load`는 반드시 실패한다. `DEV-513`이 **업그레이드 절에서 같은 결함을 닫았는데** 같은 문서의 최초 설치 절은 그대로였다 — 정정한 자리 옆에 같은 결함이다. 검사 위치도 틀렸다: `docker load`(123행)가 먼저 돌고 `require_env`(125행)가 뒤에 오므로 **이미지 저장소를 바꾼 뒤에** 필수 구성 부재를 말한다. 머리글이 "fail-fast"라고 적은 도구가 필수 검사를 side effect 뒤에 두고 있다. 인접 발견 하나: 업그레이드 절은 `PRS_VERSION`을 **`load` 뒤에** 고치라고 적어, `load`의 적재 후 검증이 이전 버전 태그를 보고 통과한다 — 새 이미지가 tar에 없어도 잡지 못한다. **결정 넷.** ① **운반 단위를 단일 아카이브 `pr-search-<version>-offline.tar.gz`로 정식화한다.** `build-bundle.sh`가 checksum 생성과 시크릿 검사가 끝난 **뒤** 그것을 만들며, 아카이브는 번들 디렉터리의 형제 위치에 놓여 자기 자신을 담지 않는다. 바깥 checksum sidecar는 만들지 않는다 — 번들 안 `checksums/SHA256SUMS`가 정본이고 `prsctl verify`가 그것을 검증하며, 아카이브 자체가 손상되면 `tar`가 실패한다. 사내 반입 정책이 바깥 checksum을 요구한다는 증거가 나올 때만 더한다. ② **최초 설치 순서를 `extract → verify → .env → load → install → smoke → lineage`로 통일한다.** ③ **`cmd_load`의 `require_env`를 `docker load`보다 앞으로 옮긴다** — 이 정정은 검사 위치 하나에 한정하며 `require_env`의 의미·필수 키 집합·`provision_app_role`·`|| true` 넷·재색인 직렬화는 건드리지 않는다. ④ **런북을 외부망/사내망 경계로 나눠 다시 쓴다** — 외부망 절차·번들 트리·아카이브 세 종류의 뜻·`.env`의 소재·`require_env`가 요구하는 키·최초 반입의 사내 Git 계보 생성까지 한 흐름으로 잇고, 저장소에 접근할 수 없는 사내 운영자가 번들 안의 런북 하나로 수행 가능해야 한다. **`WP-071`을 신설한다** — `WP-070` 다음의 배포 마일스톤 후속이며 새 `REL`을 만들지 않고 `REL-006` 완료율에도 넣지 않는다. **SRS·PRD·화면·API·스키마 변경 없음** — SRS는 운반 아카이브 형식을 규정하지 않으며(5.2-6은 프로파일만 정한다) 새 요구사항이 없다. **신규 마이그레이션 없음**, 새 ADR 없음(`ADR-021`의 결정은 그대로이며 이것은 그 번들의 포장 형태다), 안정 ID 재번호화 0건 | DEV-523, DEV-524, DEV-525, DEV-526, DEV-527, DEV-513, WP-070, WP-071, ADR-021, NFR-005 | `pr_search_infrastructure_operations.md`, `pr_search_implementation_roadmap.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md`, `deploy/single-host/RUNBOOK.md` | closed |
| CR-063 | 2026-09-02 | correction | 결정자 확인(2026-09-02): 사내 호스트나 사내 어느 위치에서든 github.com에 닿는다 → 문서의 오프라인 전제와 불일치(DEV-528), 인접 발견 DEV-529 | **운반 파일이 경계를 건너는 방법이 어느 문서에도 없었고, 그 빈칸을 만든 전제가 실측되지 않은 가정이었다.** `WP-071`이 운반 단위를 파일 하나(1,073MB)로 정했지만 런북 2장의 경계는 "조직의 반입 절차 / 물리적 이동", 인프라 9.1장은 "물리적 반입 (네트워크 없음)"이라는 문장뿐이었고, `ADR-021` Context 표·런북 1장·`docs/README.md`가 "사내에서 인터넷에 닿지 않는다"를 전제로 적으면서 어느 것도 사내에서 확인한 기록이 없었다 (DEV-528). 결정자가 사내 어느 위치에서든 github.com에 닿는다고 확인했다. 인접 발견 하나: 런북 1장 디스크 요건이 "이미지 약 2GB + 데이터"인데 절차대로 하면 아카이브 1,073MB·풀린 번들 2,629MB·이미지 저장소가 함께 놓이고 롤백을 위해 번들을 지우지 말라고 하므로 실제 소요는 6GB를 넘는다 (DEV-529). **결정 여덟.** ① **번들과 설치 절차는 그대로다** — `ADR-021` 결정 3~6 유지, 설치는 여전히 레지스트리·`git clone` 없이 번들에서만. 사내가 github.com에 닿는다고 직접 pull·clone으로 가지 않는 이유는 ADR-021 정정 절에 넷으로 적었다. ② **운반 경로를 GitHub Release 자산으로 정식화한다.** 태그 = 버전, `--target` = manifest의 `upstream.commit`, 자산은 운반 아카이브 하나, 본문은 번들의 `pr-search-<version>-offline/RELEASE_NOTES.md`에 아카이브의 파일명·크기·SHA-256을 덧붙인 것. 발행은 `build-bundle.sh --release`가 하며 진입점은 하나다(`CR-062`의 규율). ③ **발행한 자산을 다시 읽어 대조한다** — API의 이름·크기·`digest`가 로컬과 다르면 종료 코드 1 (`DEV-519`의 규율). ④ **사내 취득은 이 저장소 한정 읽기 토큰(fine-grained PAT, Contents: Read-only)으로 `gh release download`** — 받은 파일의 `sha256sum`을 자산 digest와 대조한 뒤 푼다. 토큰은 `.env`·번들·저장소 어디에도 넣지 않는다. `gh`가 없는 위치를 위한 curl 경로를 함께 적는다. ⑤ **바깥 checksum 파일은 여전히 만들지 않는다** — GitHub의 자산 digest와 릴리스 본문이 같은 실행에서 같은 값으로 생긴다. ⑥ **릴리스는 불변이다** — 같은 버전을 다시 발행하지 않고, 다시 만들려면 새 버전. ⑦ **github.com에 닿지 않는 환경이면 같은 파일을 조직의 반입 채널로 옮긴다** — 검증은 같다. ⑧ **`WP-072`를 신설한다** — `WP-071` 다음의 배포 마일스톤 후속이며 새 `REL`을 만들지 않고 `REL-006` 완료율에도 넣지 않는다. **SRS·PRD·화면·API·스키마 변경 없음** — 5.2 기술 제약 6번의 "인터넷에 노출하지 않는다"는 인바운드 노출 금지이며 사내에서 github.com으로 나가는 것은 그 제약을 건드리지 않는다. **`ADR-021`의 결정은 그대로이며 전제 정정 절만 더한다.** 압축 방식 변경·백킹 이미지를 뺀 업그레이드 번들·사내 미러 레지스트리는 채널 상한이 없어졌으므로 열지 않는다(실측값은 원장 6.65장). **신규 마이그레이션 없음, 안정 ID 재번호화 0건** | DEV-528, DEV-529, DEV-530, DEV-531, DEV-532, DEV-533, DEV-534, DEV-535, DEV-536, DEV-537, WP-071, WP-072, ADR-021, NFR-005, CR-062 | `pr_search_architecture_decision_records.md`, `pr_search_infrastructure_operations.md`, `pr_search_security_privacy_architecture.md`, `pr_search_implementation_roadmap.md`, `pr_search_work_packages.md`, `pr_search_implementation_traceability.md`, `docs/README.md`, `deploy/single-host/RUNBOOK.md` | closed |
| CR-064 | 2026-09-03 | correction | 2026-09-03 애니메이션 라운드의 미해결 항목 — 파생 토큰 문서 §9가 "섹션 확장·탭 전환 → `motion.standard`"를 배정하는데 구현은 `hidden` 즉시 토글이다 | **파생 문서 안의 모순을 표 쪽으로 정정한다.** §9는 같은 절에서 "제품에서 별도 애니메이션을 추가하지 않는다"를 규칙으로 두는데, 섹션 확장과 탭 전환은 Conductor 프리미티브가 아니라 제품이 직접 만드는 동작이라 그 배정을 지키려면 규칙을 어겨야 했다 — 실측: `apps/web`에 CSS 파일 0건, 루트 레이아웃이 Conductor CSS만 가져온다. 두 동작을 따로 감사해 각각 즉시로 확정했다: 탭 전환은 고빈도 조작이라 즉시가 옳고 선택 피드백은 `Button`의 `motion.fast`가 이미 준다, 섹션 확장은 `hidden`(`display: none`)이라 높이 전환이 성립하지 않으며 넣으려면 제품 CSS가 필요하다. 표를 "Conductor 컴포넌트가 쓰는 토큰"으로 한정하고 §9.1에 두 동작의 판단을 적었다 | 파생 토큰 문서 §9·§9.1 | `pr_search_design_system_tokens.md` | closed |
| CR-065 | 2026-09-04 | correction | `PR #148`·`PR #149` 머지 후 리뷰 — 회복 안내가 코드의 지시와 어긋나고(DEV-546), `undo_note()`가 옮겨진 태그에 기대값 없는 삭제를 지시한다(DEV-547) | **문서와 코드가 같은 말을 하게 한다.** `DEV-544`가 발행 뒤 되돌리기를 없애면서 사람에게 넘긴 판단이 넷 생겼는데, 그 안내가 남의 태그와 자기 태그를 한 행에 합치고 계보를 판정하지 않았다. 더 깊은 자리는 코드였다 — `TAG_LEFT`는 "남았다"와 "옮겨졌다"를 함께 담는데 `undo_note()`가 후자에도 기대값 없는 삭제를 지시해 `DEV-541`이 막은 남의 태그 삭제를 사람 손으로 하게 했다. 대상을 먼저 보고 기대값 lease로만 지우게 고쳤다 | DEV-546 · DEV-547 · WP-072 | `pr_search_implementation_traceability.md` (배포 산출물 `deploy/single-host/`의 스크립트와 런북은 아래 반영 내역에 적는다) | closed |
| CR-066 | 2026-09-08 | correction | **첫 사내 반입(2026-09-07)이 결함 여섯을 드러냈다** — 배포 트리에서만 나는 SSR 500(DEV-551), 빈 문자열 환경 값이 URL이 되는 것(DEV-548), 런북의 웹훅 경로 오류(DEV-549), GHE→서버 인바운드 차단이라는 미문서화 조건(DEV-550), compose anchor의 얕은 병합으로 워커 셋에 CA가 닿지 않는 것(DEV-552), `ADMIN_DATABASE_URL` 부재가 수신 전면 거부로 이어지는 것(DEV-553) | **실행이 아니면 드러나지 않는 것들이 있다.** 여섯 전부 외부 검증에서는 초록이었다 — 단위·통합·회귀·스모크가 모두 통과했고, 런북 7장은 그 자리들을 정직하게 `NOT RUN`으로 두고 있었다. 실행이 그 표의 값을 채우자 여섯이 한꺼번에 나왔다. **공통 형태는 둘이다**: 개발 트리와 배포 트리가 다르게 동작하는 자리(DEV-551), 그리고 문서가 코드와 다른 값을 적은 자리(DEV-548·549·552·553). 코드 결함 셋은 upstream에서 고쳐 다운스트림 패치를 늘리지 않았고, 문서 결함 셋은 코드에서 값을 읽어 대조하는 회귀로 고정했다. **요구사항 변경은 없다** — 승인된 운반·연동 계약을 구현과 문서가 지키지 못한 것이다 | DEV-548 · DEV-549 · DEV-550 · DEV-551 · DEV-552 · DEV-553 · WP-072 · WP-070 | `pr_search_implementation_traceability.md` (배포 산출물 `deploy/single-host/`의 런북·`.env.example`, 이미지 정의 `Dockerfile`, `packages/github/src/config.ts`, `regression/runtime-reachability.test.ts`는 원장 6.70장에 적는다) | closed |
| CR-067 | 2026-09-08 | correction | 사용자 요청: 최신 main 기반 P4 데스크톱 방식의 사내 웹 UI/UX 개선 | 기존 검색·상세·공통 셸을 탐색/결과/선택 요약 작업대로 정돈한다. SRS·인가·API 범위 유지. DEV-554, WP-073 | FR-SRCH-001·006~011, FR-SEQ-001·005, NFR-007 | 파생 UI·FE 아키텍처·전달/검증 원장 | closed — WP-073 완료, 원장 6.71장 |
| CR-068 | 2026-09-08 | correction | `0.1.0-pilot.3` 반입 준비 감사 — 파생 토큰 문서가 스스로와 어긋난다(DEV-555). §9는 제품이 스타일시트를 두지 않는다는 사실을 모션 금지의 근거로 들고 있는데, 같은 문서 §14가 `CR-067`로 들어온 `workbench.css`를 제품 배치의 정본으로 선언한다 | **근거가 사라져도 결론은 남되, 문서가 스스로와 어긋난 채로 반입되지 않게 한다.** `CR-064`가 §9를 좁힐 때 쓴 근거는 그 시점의 사실이었고 `CR-067`이 그것을 깼다. 실측하니 그 스타일시트에 전환·애니메이션 선언은 0건이라 **규칙 자체는 지켜지고 있었다** — 그래서 규칙을 완화하지 않고 근거만 현행화했다. 개별 문장이 아니라 불변식을 회귀로 고정한다: 제품 CSS가 몇 개든 그 안에 전환·애니메이션 선언이 없어야 하며, 파일이 실재하는 동안 §9가 사라진 근거를 다시 주장하지 않아야 한다. 변이 넷으로 실효를 확인했다. **SRS·요구사항 변경 없음** | DEV-555 · WP-073 · CR-064 · CR-067 | `pr_search_design_system_tokens.md` v0.5 · `pr_search_implementation_traceability.md` · `regression/runtime-reachability.test.ts` | closed |
| CR-069 | 2026-09-08 | correction | `PR #151`·`PR #152` 머지 후 리뷰 셋 — `ADMIN_DATABASE_URL`이 강제 경로에 없어 새 설치가 수신 전면 거부로 간다(P1, DEV-556), 파생 토큰 문서의 절 참조가 틀렸다(P2, DEV-557), 제품 CSS 검사가 직계 자식만 훑는다(P2, DEV-558) | **주석은 강제하지 않는다.** `DEV-553`의 처방을 `.env.example`의 주석으로 두었더니 새 설치에서 그 값이 빈 채로 모든 관문을 통과한다 — 파티션이 소진되는 순간 모든 웹훅이 저장에서 거부되고, 그것이 첫 반입에서 실제로 일어난 일이다. **게이트의 존재가 아니라 위치가 실패의 대가를 정한다**는 것을 이 저장소가 세 번째로 겪었다(`DEV-524` → `DEV-544` → 여기). `require_env`가 그 값을 요구하게 하고, `install`·`upgrade`·`restore`가 접속 주체와 **같은 자리에서** 롤을 만들게 했다 — 복구 뒤 수동 재생성이라는 알려진 제한이 함께 없어진다. 나머지 둘은 내가 만든 정정과 시험 자신의 결함이며, 시험이 "파일이 늘어나도 따라간다"고 주장하면서 직계 자식만 훑고 있었다. **SRS·요구사항 변경 없음** | DEV-556 · DEV-557 · DEV-558 · DEV-553 · DEV-555 · WP-072 · WP-073 | 배포 산출물 `deploy/single-host/`(`prsctl`·런북·환경 표본) · `pr_search_design_system_tokens.md` v0.6 · `pr_search_implementation_traceability.md` · `regression/runtime-reachability.test.ts` | closed |
| CR-070 | 2026-09-08 | correction | PR #150 미해결 P1 리뷰 | 삭제 lease 실패 뒤 SHA 일치로 소유를 추정하는 복구 안내를 제거한다. 모호한 태그를 보존하고 새 버전을 사용한다 | DEV-559 · WP-072 | 배포 스크립트·런북·회귀·구현 원장 | closed |
| CR-071 | 2026-09-08 | design | 사용자 WP-042 구현 지시와 착수 전 계약 감사 | FR-SEQ-007의 저장·재개·표시·초기화 API 및 에폭·동시성 계약을 정밀화하고 이분 탐색을 구현한다 | DEV-560 · WP-042 · FR-SEQ-007 · API-SEQ-005 | API·데이터·UI·작업 패키지·구현 원장 | closed |
| CR-072 | 2026-09-08 | design | 사용자 WP-044 구현 지시와 착수 전 계약 감사 | FR-SRCH-012의 동기 파일·비동기 잡·다운로드 및 실행자 접근 범위 계약을 정밀화하고 내보내기를 구현한다 | DEV-570 · WP-044 · FR-SRCH-012 · API-SRCH-006 · JOB-SRCH-001 | API·데이터·비동기·UI·작업 패키지·구현 원장 | closed |
| CR-073 | 2026-09-09 | correction | `0.1.0-pilot.3` 사내 업그레이드 Upstream Feedback | `prsctl load` 전 compose 수정이 checksum 검증에 막히는 순서를 런북에 명시하고(DEV-571), `pipeline-worker` 이미지에 `git`을 포함해 미러·릴리스 색인 실패를 해소한다(DEV-572). 내부 코드는 반출하지 않고 민감정보를 제거한 운영 발견만 수동 전달하는 Upstream Feedback 경로를 ADR-021에 명시한다 | DEV-571 · DEV-572 · WP-072 · ADR-021 · JOB-MIR-001 · JOB-MIR-002 | `pr_search_architecture_decision_records.md`, `pr_search_implementation_traceability.md`, `deploy/single-host/RUNBOOK.md`, `Dockerfile`, 회귀 | closed |
| CR-074 | 2026-09-10 | correction | PR #159 머지 후 P1 리뷰 | CR-073이 신설한 회귀 두 건의 시험 이름에 소유 WP가 없어 테스트→작업 패키지 추적이 끊겼다. 두 이름에 WP-072를 명시하고 DEV-573으로 기록한다 | DEV-573 · DEV-571 · DEV-572 · WP-072 | 회귀·구현 원장 | closed |
| CR-075 | 2026-09-10 | correction | PR #160 머지 후 P2 리뷰 | CR-074 cascade가 검증 결과를 원장 6.72.9장에 기록했다고 했으나 그 절에 명령·통과 수가 없었다. 실제 로컬·CI 결과를 원장에 추가한다 | DEV-574 · DEV-573 · CR-074 | 구현 원장 | closed |
| CR-076 | 2026-09-10 | correction | PR #161 머지 후 P1 리뷰 | CR-075를 닫으면서 strict document validator 결과를 cascade에 기록하지 않았다. 변경 전 main과 같은 기존 오류 3건·경고 1건, 신규 issue 0건임을 명시한다 | DEV-575 · DEV-574 · CR-075 | 변경 관리·구현 원장 | closed |
| CR-077 | 2026-09-10 | scope | 2026-09-10 P4 회고 회의 결정 (불편사항 1·3·5 묶음) | **회의가 결정한 M 넘버를 승인 범위로 편입한다.** 회의는 불편사항 1(바이너리에 변경이 반영됐는지 확인)·3(PR 번호 순서와 base 브랜치 반영 순서 불일치)·5(히스토리 흐름 파악)를 하나로 묶고, merged_at 순서로 1부터 부여하는 M 넘버, PR 제목·본문 표기, PR 아닌 직접 푸시 제외, 저장소별 번호(`M-1900-1`), 선후관계 확인 전용(주 식별자는 여전히 PR 번호)을 정했다. **이 CR은 M 넘버를 `merge_seq` 파생으로 정의한다** — 회의가 말한 merged_at 순서는 통상 first-parent 순서와 일치하고, 어긋나는 경우(release 브랜치 경유 머지·base 강제 푸시)에 실제 반영 순서를 말하는 쪽은 first-parent이며 회의 목적이 바로 그 순서이기 때문이다. 파생으로 정의하면 ADR-007의 검증 가능성(`git log --first-parent` 대조)과 에폭 무효화가 M 넘버에도 그대로 상속되고, 늦게 도착한 웹훅이 이미 부여된 번호 사이에 끼어드는 문제와 merged_at 초 단위 동률 문제가 애초에 생기지 않는다. **두 순서의 불일치는 감시 지표로 남긴다** (사용자 결정). **제품 정의가 바뀐다**: PR 제목·본문 갱신은 GHE 쓰기이므로 Search/Data Plane의 read-only 원칙을 처음으로 연다 — CR-005가 연 Operations Plane의 쓰기는 사용자가 지시한 실행이지만 이것은 시스템이 자동으로 수행하는 쓰기라 성격이 다르다. FR-SEQ-008(M 넘버 채번)·FR-SEQ-009(PR 표기), JOB-SEQ-004·JOB-SEQ-005, EVT-SEQ-004, API-SEQ-007, ADR-007 Clarification, ADR-022, WP-074·WP-075 신설. OD-009(저장소 코드 출처)를 열었다가 2026-09-11 사용자 결정으로 같은 판에서 닫았다 — **저장소 이름의 숫자 부분**이다. PIPE DB 반영과 PR 본문 표기는 사용자 결정으로 **이번 범위에서 제외**했으며 오픈 결정으로 열지 않는다. **선행 조건**: DEV-576(push 웹훅이 미러 fetch를 부르지 않아 `merge_seq`가 최대 6시간 늦게 붙는다)을 먼저 닫아야 회의가 요구한 '거의 실시간'이 성립한다. 기존 안정 ID 재번호화 0건 | FR-SEQ-008 · FR-SEQ-009 · JOB-SEQ-004 · JOB-SEQ-005 · EVT-SEQ-004 · API-SEQ-007 · ENT-SEQ-001 · ADR-007 · ADR-022 · THR-046 · THR-047 · OD-009 · WP-074 · WP-075 · DEV-576 | **실측 21종** — 요구사항 4종, 파생 UI 7종, 아키텍처 5종, 딜리버리 4종, `change_control.md` | closed |
| CR-078 | 2026-09-11 | correction | `0.1.0-pilot.3` 사내 반입 Upstream Feedback (ADR-021) | **운영 구성 계약이 기동을 막는다고 적혀 있었으나 실제로는 요청마다 막았다.** 사내가 평문 HTTP 때문에 `SESSION_COOKIE_SECURE=false`로 올렸고, `web`은 정상 기동해 `/healthz`에 200을 냈으며 Docker는 전 서비스를 `healthy`로 보고했는데 사람이 여는 화면은 전부 500이었다. `compose.yml`이 이 변수를 `web`에만 넘겨 `search-api`는 영향을 받지 않았고, 그 비대칭이 원인을 웹 런타임의 모듈 문제로 오진하게 했다. `.env.example`과 런북이 「HTTP면 false여야 한다」고 적어 운영자를 그 값으로 보낸 것이 문서 쪽 원인이다. **보안 계약은 그대로 두고**(운영에서 insecure 세션 쿠키 금지, FR-AUTH-001 AC-2) 그 계약이 적힌 대로 기동을 막게 한다. 릴리스 산출물에 실제 이미지 런타임 게이트를 더해 「빌드·헬스체크는 통과하는데 화면은 500」이 다시 반입되지 않게 한다 | DEV-577 · DEV-578 · DEV-579 · DEV-551 · DEV-572 · FR-AUTH-001 · NFR-005 · WP-072 · WP-015 · ADR-021 | 배포 정의·런북·web 앱·회귀·구현 원장 | closed |
| CR-081 | 2026-09-11 | implementation | PR #168 병합 후 자동 리뷰 | **병합 뒤 남은 리뷰 지적 둘을 닫는다.** 자동 리뷰가 P2 다섯을 남겼고 셋은 `CR-080`이 이미 고친 것이었다(재색인 M 복구, 단일 read 스냅숏, 비대상 브랜치 판정). 남은 둘이 실결함이다 — 대기가 끝나도 소진 배너가 남아 화면이 두 가지를 동시에 말하고 다음 재검증이 막히는 것(`DEV-609`), 관측 루프가 표본마다 정본을 물어 기본 한도에서 왕복이 100번이 되는 것(`DEV-610`)이다. **계약 변경 없음** — SRS·파생 UI·아키텍처 문서를 바꾸지 않는다 | FR-SEQ-008 · WP-074 · DEV-609 · DEV-610 · DEV-611 | 코드·구현 원장 | closed — cascade와 검사기 결과를 기록한 뒤 닫는다 (2026-09-11). PR #169·#170과 후속 하나로 병합 |
| CR-080 | 2026-09-11 | implementation | 사용자 WP-074 수직 구현 지시 | **CR-079가 쓴 설계를 실제 코드로 옮긴다.** 마이그레이션 025, 채번 전 미러 fetch(`DEV-576` 폐쇄), PR 확정 근거와 durable work, 순수 planner와 원자 트랜잭션, ES 소유 필드와 materialize, `API-SEQ-007`과 페이지 단위 정본 대조, 세 화면 병기, 읽기 전용 측정 CLI, 배포 설정과 런북. **직접 푸시의 영구 부재 확정은 여전히 열려 있다**(`DEV-581`) — production 판정기는 반복 빈 조회를 확정으로 승격하지 않으며 그 앞에서 채번이 멈춘다. 구현 중 판단이 필요했던 자리와 검증·독립 리뷰가 드러낸 것을 `DEV-584`~`DEV-598`로 기록하며, 설계가 정하지 않은 자리에서 고른 넷을 `C7`~`C10`으로 남긴다. 독립 검토를 둘로 나눠 돌렸다 — 하나는 구조와 계약을, 하나는 순수 판정 네 파일의 경계값과 결정성을 보았다. **다섯 판에 걸쳐 blocker 1건·major 6건을 찾았고 여섯은 시험이 전부 초록인 채로 존재했다.** 세 판은 내 수정이 만든 부작용이었으며, 고친 것을 다시 보게 하지 않았다면 그중 하나는 "고쳤다"는 기록이 사실과 다른 상태였다. `DEV-603` 하나만 열어 두고 전부 고쳤고, 리뷰어가 블로킹 결함 없음으로 종료했다. 기존 `merge_seq`·범위 조회·릴리스 판정은 그대로이고 `pilot.4` 방어(기동 실패-빠름·SSR 스모크·워커 git)는 회귀로 보존된다. 새 릴리스는 발행하지 않는다 | FR-SEQ-008 · API-SEQ-007 · JOB-SEQ-004 · EVT-SEQ-004 · ENT-SEQ-005 · ENT-SEQ-006 · ENT-SEQ-007 · ADR-023 · WP-074 · DEV-576 · DEV-581 · DEV-584 · DEV-585 · DEV-586 · DEV-587 · DEV-588 · DEV-589 · DEV-590 · DEV-591 · DEV-592 · DEV-593 · DEV-594 · DEV-595 · DEV-596 · DEV-597 · DEV-598 · DEV-599 · DEV-600 · DEV-601 · DEV-602 · DEV-603 · DEV-604 · DEV-605 · DEV-606 · DEV-607 · DEV-608 | 코드·배포 정의·런북·구현 원장 | closed — PR #168로 병합 (2026-09-11). `DEV-581`·`DEV-603`은 계약 판단이 필요해 열어 둔다 |
| CR-079 | 2026-09-11 | correction / design | 사용자 WP-074 squash-only 지시서 및 이번 세션 설계 전용 지시 | FR-SEQ-008의 확정 근거·인용 안전성·W-004·복구·계측 계약을 정정하고 구현 에이전트용 상세 설계를 작성한다. 구현·시험 실행·PR·병합·발행은 이번 세션의 완료에 포함하지 않는다. 기존 지원 범위와 pilot.4 방어를 보존한다 | FR-SEQ-008 · API-SEQ-007 · JOB-SEQ-004 · EVT-SEQ-004 · WP-074 · DEV-576 · DEV-580 · DEV-581 · DEV-582 · DEV-583 · ADR-023 | SRS → 파생 문서 → 상세 설계 → 실행 패키지 → 원장 | closed — 계약 정정·설계 작성 완료 (2026-09-11). 구현은 `CR-080`이 잇고 `DEV-581`은 그쪽에서 계속 열려 있다 |
| CR-082 | 2026-09-11 | correction | `0.1.0-pilot.4` 사내 반입 Upstream Feedback (ADR-021) | **사설 CA가 `git` 서브프로세스에 닿지 않아 미러 초기화가 실패했다.** 사내가 CA를 걸고 올렸을 때 Node로 나가는 호출은 전부 성립했고 컨테이너도 전부 `healthy`였는데 `JOB-MIR-001`만 `SSL certificate problem`으로 끝나고 미러 볼륨이 빈 채로 남았다. `NODE_EXTRA_CA_CERTS`는 Node 런타임만 읽으며 `git` 서브프로세스는 `GIT_SSL_CAINFO`를 따로 받는다. **런북 6장은 그 사실을 이미 적고 있었으나 배포 정의에 그 변수를 넘기는 자리가 없었다** — 문서가 존재하지 않는 경로를 안내한 것이 원인의 절반이다. `x-app-env` 앵커에 변수를 더해 `git`을 부르는 세 서비스에 한 자리로 닿게 하고, 회귀가 **서비스마다 병합을 펼친 최종 환경 키 집합**으로 그것을 강제한다. `MIRROR_ROOT`를 신호로 삼아 대상 목록을 손으로 적지 않는다. **계약 변경 없음** — SRS·PRD·파생 UI·아키텍처 문서를 바꾸지 않는다 | DEV-561 · JOB-MIR-001 · WP-070 · FR-SEQ-001 | 배포 정의·런북·회귀·구현 원장 | closed — cascade와 검사기 결과를 기록한 뒤 닫는다 (2026-09-11) |
| CR-083 | 2026-09-11 | scope | `0.1.0-pilot.4` 사내 반입 Upstream Feedback (ADR-021) | **사내 GHE 계정으로 직접 로그인하는 경로를 연다.** 사내망에 별도 OIDC IdP가 없고 사내 GHE는 OIDC 디스커버리 엔드포인트를 제공하지 않아 현재 코드로는 붙지 않는다. Dex 같은 미들웨어를 세우는 것은 운영 부담이 크다는 것이 사내 판단이다. `AUTH_PROVIDER`(`oidc` 기본 | `github`)가 공급자를 고르고, GHE OAuth2 Authorization Code + PKCE 흐름을 두 번째 경로로 둔다. **기존 OIDC 흐름과 배포는 바뀌지 않는다** — 값을 주지 않은 배포는 `oidc`다. 역할은 `/user/teams` 멤버십에서 합성하되 **형식과 제약을 IdP 그룹 매핑과 공유한다**: 부여 가능한 역할은 `manager`·`qa` 둘뿐이며(`CR-015`·`DEV-049`) 사내가 제안한 `admin`·`viewer`는 이 제품의 역할이 아니어서 그대로 쓸 수 없다. **둘째로 쿠키 계약에 면제를 하나 연다** — `AUTH_ENABLED=false`를 **명시한** 배포는 운영에서 `SESSION_COOKIE_SECURE=false`를 허용한다(사용자 결정). 면제를 계산값이 아니라 명시적 선언에 건 것은 `CR-078`이 적은 우려(「열어 두면 열린 채로 켜진다」)를 구조로 막기 위해서다: 그 값을 남긴 채 인증만 켜면 `web`이 기동하지 않는다. 셋째로 **로그인이 `app_user` 행을 만들지 않던 기존 결함**(`DEV-613`)을 닫는다 — 그것 없이는 로그인 직후 첫 조회가 503이라 이 CR이 여는 경로가 성립하지 않는다 | FR-AUTH-001 · FR-AUTH-002 · NFR-005 · ADR-011 · WP-076 · DEV-612 · DEV-613 · DEV-614 · DEV-615 · DEV-577 | 요구사항 · 보안 아키텍처 · 배포 정의 · 런북 · 코드 · 구현 원장 | closed — cascade와 검사기 결과를 기록한 뒤 닫는다 (2026-09-11) |
| CR-084 | 2026-09-12 | scope | `WP-075` 착수 (결정자 지시) | **PR 제목에 M 넘버를 표기하는 경로를 연다 — 이 제품이 사람의 지시 없이 GHE를 고치는 최초의 쓰기다.** `CR-077`이 `FR-SEQ-009`와 `ADR-022`로 이미 승인한 범위를 구현한다. 신규 FR을 만들지 않는다. 이 CR이 승인 범위 위에 **더하는** 것은 셋이다. (1) **전역 기본 꺼짐 스위치** `MNUMBER_ANNOTATE_ENABLED` — `FR-SEQ-009`는 저장소별 해제만 요구하지만, 이 코드를 받는 것만으로 남의 PR 제목이 바뀌어서는 안 되므로 전체를 한 자리에서 멈출 수 있게 한다(결정자 사전 승인). (2) **저장소별 해제의 정본** `repository.annotate_enabled`(기본 `true`) — `AC-6`의 「설정으로 개별 해제」를 운영 가능한 형태로 옮긴 것이며 기존 `repository.update` 경로에 얹는다. (3) **실행 중 권한 차단** `repository.annotate_blocked_at`·`annotate_blocked_reason` — `FR-SEQ-009` 예외 처리가 요구하는 「403·404면 그 저장소의 표기를 중단하고 사유를 남긴다」를 **프로세스 재시작 뒤에도 유지되게** 한다. **운영자 정책과 다른 열이다** — 권한 오류는 운영자의 결정이 아니므로 운영자가 적어 낸 값을 뒤집지 않는다. 자격은 전용 App(`GHE_ANNOTATE_*`)으로 분리하고 조회용 Data App의 값을 한 자리도 읽지 않는다. 쓰기 반경은 PR 제목 한 필드이며 요청 본문은 언제나 `{title}` 하나다 | FR-SEQ-009 · FR-SEQ-008 · FR-AUTH-004 · ADR-022 · JOB-SEQ-005 · EVT-SEQ-004 · ENT-SEQ-001 · ENT-CORE-002 · WP-075 · DEV-616 ~ DEV-631 | 요구사항 · 아키텍처(ADR·데이터 모델·인프라·비동기) · 배포 정의 · 런북 · 코드 · 구현 원장 | closed — cascade와 검사기 결과를 기록한 뒤 닫는다 (2026-09-12) |
| CR-085 | 2026-09-13 | correction | `WP-075` 안전성 보강 (결정자 지시) | **이미 구현된 PR 제목 표기가 실패·재시작·설정 변경 상황에서 오래된 제목을 다시 보내지 않게 한다.** 요구사항 문장을 바꾸지 않고 `FR-SEQ-009`의 수용 기준 셋(`AC-8`~`AC-10`)을 더해 이미 승인된 `AC-1`(원래 제목 보존)과 `AC-3`(재시도)이 실패 경로에서도 성립하게 한다. 현재 코드에서 **다섯 가지 실패 경로를 시험으로 재현한 뒤** 고쳤다: 변경 요청 재시도가 첫 시도의 문자열을 그대로 다시 보내 사람이 그 사이 고친 제목과 다른 M 접두를 덮었고(`DEV-632`), 서버가 본문을 바꿔 저장한 것을 확인하고도 다음 회차가 접두만 보고 `done`으로 덮었으며(`DEV-633`), 줄을 기다리는 시간과 한 행의 처리 시간이 회차 예산 밖이었고(`DEV-634`·`DEV-635`), 실패한 변경 요청 사이에는 공식 문서가 권고하는 간격이 없었다(`DEV-636`). 추가로 조회 성공만으로 권한 차단을 푸는 `DEV-626`의 처방을 뒤집고(`DEV-637`), 종료가 상한 없는 스윕을 기다리던 자리(`DEV-638`), 결과를 모르는 요청을 실패로 적던 자리(`DEV-639`), 한도 유예가 한 이벤트에만 걸리던 자리(`DEV-640`)를 닫는다. `DEV-629`(실행자 배제)는 advisory 세션 락으로 **해결**한다. 마이그레이션 027은 additive이며 상태 둘(`body_changed`·`unknown`)과 근거 세 열을 더한다 — **제목 원문은 담지 않는다.** 켜는 순서를 위한 읽기 전용 사전 점검 CLI와, 스스로 풀리지 않는 상태를 운영자가 여는 `annotate_resume` 플래그를 더한다. **전역 기본값은 그대로 꺼짐이다** | FR-SEQ-009 · FR-AUTH-004 · ADR-022 · JOB-SEQ-005 · ENT-SEQ-001 · ENT-CORE-002 · API-ADM-002 · WP-075 · DEV-616 · DEV-626 · DEV-629 · DEV-632 ~ DEV-649 | 요구사항 · 아키텍처(데이터 모델·비동기·인프라·API 계약) · 배포 정의 · 런북 · 코드 · 구현 원장 | closed — cascade와 검사기 결과를 기록한 뒤 닫는다 (2026-09-13) |
| CR-086 | 2026-09-13 | scope | `REL-007` 착수 (결정자 승인 2026-09-13) | **REL-007 GitHub Operations Plane을 공식 착수하고 첫 읽기 전용 수직(`gh pr list`)을 연다.** 사용자가 웹에서 저장소를 고르고 상태·건수·JSON 필드를 넣어 실행될 argv를 확인한 뒤, 자신의 위임 권한으로 격리된 gh를 실행하고 결과와 자기 이력을 본다. R0 하나(`pr.list`)만 열고 R1~R3·`gh api`·extension·Recipe·파일 입출력은 열지 않는다. **요구사항 문장과 수용 기준은 바꾸지 않는다** — 실행 감사의 정본은 `gh_execution`(`ENT-GH-002`, `FR-GH-012` AC-1의 항목 전부)이며 `FR-AUTH-004`의 `audit_record` action 표에는 행을 더하지 않는다. 구현이 확정한 것: 새 패키지 `@prs/gh-cli`(고정 gh 2.97.0·help 파서·인벤토리·manifest·의미 제약 평가기·유일한 argv 빌더·`SafeGhOutput`·typed 결과·봉인), 새 프로세스 `gh-executor`(shell 없는 spawn·큐 재검증·argv 재조립 대조·취소·상한·고아 회수·잔여 스윕), 마이그레이션 028(표 넷), `search-api`의 `/api/v1/gh/*` 라우트 열 개, W-010·W-021 화면과 Operations App 인가 콜백, compose 선택 프로파일 `github-operations`. 문서와 어긋난 자리는 편차로 적었다: 파티션 표 유니크로는 멱등을 강제할 수 없어 보조 표로 강제(`DEV-650`), SSE는 상태만 흘림(`DEV-651`), 봉인 키가 비밀 저장소의 대체(`DEV-652`), 분류 미완 195건으로 `NFR-009` 게이트 미통과(`DEV-657`), `gh-executor`의 Profile A 배치 충돌을 선택 프로파일로 해소(`DEV-661`). **기본값은 꺼짐**(`GH_OPERATIONS_ENABLED=false`)이며 릴리스는 발행하지 않는다 | FR-GH-001 · FR-GH-002 · FR-GH-003 · FR-GH-006 · FR-GH-008 · FR-GH-011 · FR-GH-012 · NFR-009 · NFR-010 · NFR-011 · NFR-012 · ADR-016 · ADR-017 · ADR-018 · API-GH-001 · API-GH-002 · API-GH-003 · API-GH-005 · API-GH-007 · API-GH-010 · API-GH-011 · ENT-GH-001 · ENT-GH-002 · JOB-GH-001 · JOB-GH-007 · REL-007 · WP-045 · WP-046 · WP-047 · WP-048 · WP-061 · WP-062 · WP-066 · WP-077 · DEV-650 ~ DEV-668 | 아키텍처(데이터 모델·비동기·백엔드·인프라·보안·API 계약·프런트엔드) · 로드맵 · 작업 패키지 · 배포 정의 · 런북 · 코드 · 구현 원장 | closed — cascade와 검사기 결과를 기록한 뒤 닫는다 (2026-09-13) |
| CR-087 | 2026-09-14 | correction | main CI 실패 두 건 — 병합 커밋 `c5c8aea`·`5369772`의 run `34752161210`·`34752531241` | **병합 뒤 main에서 실패한 시험 둘의 원인을 고친다 — 요구사항 문장은 바꾸지 않는다.** (1) `apps/ingest-gateway/src/signature.test.ts`의 상수 시간 비교 시험은 **시간을 재는** 시험이라 호스팅 러너 부하에서 near/far 비율이 0.4617로 하한 0.5에 미달했고, 구현(`timingSafeEqual`)은 그대로였다(`DEV-669`). 필수 CI에는 판정이 원시 함수에 **위임되는지**를 호출로 보는 결정적 시험을 두고(조기 종료 `===`·길이 검사 제거·첫 일치에서 중단, 세 변이가 각각 잡힌다), 시간 측정은 `perf/signature-timing.perf.test.ts`로 옮겨 한계를 적었다. 비율 범위를 넓히거나 시험을 지우지 않았다. (2) `apps/pipeline-worker/integration/sequence/freshness.test.ts` T03b는 fetch가 덮는 refresh 의도의 경계가 `created_at <= startedAt`이었고, `created_at`은 DB의 `clock_timestamp()`(µs)·`startedAt`은 애플리케이션의 `Date`(ms)라 같은 밀리초에 들어온 마지막 의도가 경계 뒤로 읽혀 남았다(`DEV-670`, **제품 결함**). 경계를 시각이 아니라 **fetch 직전(미러 락 아래)에 고정한 집합**으로 바꿨다 — 커밋 가시성이 경계다. 수정 전 코드에서 결정적으로 실패하는 재현 시험을 두었다. 마이그레이션·SRS 변경 없음 | NFR-005 · FR-ING-001 · FR-SEQ-008 · ENT-SEQ-006 · WP-003 · WP-074 · DEV-669 · DEV-670 | 아키텍처(보안 12장) · 코드 · 구현 원장 | closed — cascade와 검사기 결과를 기록한 뒤 닫는다 (2026-09-14) |
| CR-088 | 2026-09-14 | scope | `REL-007` 다음 수직 (결정자 지시 2026-09-14) | **capability 분류·검증·드리프트 검출·검증 기록 저장·A-006 읽기 전용 조회를 연다 — 실행 허용은 `pr.list` 하나 그대로다.** 고정 gh 2.97.0의 leaf 196개 전부를 사람이 적은 표(`classification/commands.ts`, 행마다 help 원문 근거)로 지원 상태·interaction·위험·부작용·인증·입출력·결과 종류·민감도까지 분류하고, flag 1,034·inherited 312·positional 164·`--json` 필드 707을 문서화된 규칙(`rules.ts`, 판정마다 근거)으로 분류해 `NFR-009` 본표 차원(`GATE-GH-01`) 전부를 100%로 만들었다. 미분류 command 0. **분류가 실행을 넓히지 않는다**: 실행 허용은 코드 표(`EXECUTABLE_CAPABILITIES`)와 manifest가 함께 정하고, 독립 검증기(`validateManifest`)가 분류를 인벤토리에서 다시 만들어 대조하며 `execution_widened`·실행 차원 파생(`policy_blocked`↔`not_implemented` 뒤바꿈)·해시 변조·중복 ID·별칭 충돌·정의 드리프트·미분류를 각각의 코드로 잡는다(변이 10종 시험). 드리프트는 실제 바이너리의 인벤토리 해시와 command·flag·JSON 필드 diff로 검출한다(CI integration 잡의 시험 = `GATE-GH-02`). 마이그레이션 029(additive)가 `gh_capability_snapshot`(해시마다 한 행, 활성화는 게이트 통과 뒤에만 — CHECK 완화 `DEV-672`)과 `gh_capability_verification`(append-only, 트리거로 갱신·삭제 금지)을 만들고, 실행기가 `JOB-GH-003`으로 기동 시 한 번(구독 전에 기다림)과 하루 한 번 검사해 기록한다 — 드리프트·구조 실패면 다음 통과까지 실행을 `registry_stale`로 거절하고(`FR-GH-011` AC-3의 `execution_disabled`), DB 기록이 실패해도 판정은 유지한다(`DEV-679`). 검사는 이벤트 루프를 막지 않는 비동기 판이다(`DEV-680`). `API-GH-013`(상태)·`API-GH-014`(command 상세)와 web `/ops/gh-registry`(A-006 읽기 전용, `operator`·`security_officer`)가 같은 검증기 모델을 읽는다. **하지 않은 것**: 실행 허용 확대(0건), A-005 정책 편집, 스냅숏 활성화, `unsupported_by_host` 판정(사내 GHES 미확인 — 전부 `unverified`, `DEV-674`), 결과 계약의 bindability·port·자원 타입(`GATE-GH-01d` 미달, `DEV-675`), `EVT-GH-006` 버스 발행(`DEV-673`), 릴리스 발행. SRS 문장 변경 없음 — `NFR-009` 실측 기준 열의 수치 하나(`--json` 지원 command 41 vs 실측 40)는 `DEV-676`으로 적고 정정 여부는 다음 CR이 정한다 | FR-GH-001 · FR-GH-011 · FR-GH-013 · NFR-009 · ADR-015 · ADR-019 · ADR-020 · API-GH-001 · API-GH-013 · API-GH-014 · ENT-GH-006 · ENT-GH-012 · JOB-GH-003 · EVT-GH-006 · REL-007 · WP-045 · WP-059 · WP-061 · WP-066 · WP-078 · DEV-657 · DEV-671 ~ DEV-681 | 아키텍처(데이터 모델·비동기·백엔드·인프라·API 계약·프런트엔드·관측성) · 파생 UI(와이어프레임 A-006·QA 체크리스트) · 로드맵 · 작업 패키지 · 검증 계획 · 배포 정의 · 런북 · 코드 · 구현 원장 | closed — cascade와 검사기 결과를 기록한 뒤 닫는다 (2026-09-14) |
| CR-089 | 2026-09-14 | scope | `REL-007` 결과 계약·타입 연결 검증 수직 (결정자 지시 2026-09-14) | **각 명령의 결과가 무엇이고 어디에 안전하게 연결될 수 있는지를 코드와 A-006에서 검증할 수 있게 한다 — 그 정의만으로 새 명령이나 Recipe가 실행되지 않는다.** 고정 gh 2.97.0의 leaf 196개 전부에 결과 계약(주 결과 종류·출력 모드별 adapter와 스키마 또는 구조화 불가 사유·자원 종류 또는 비적용 이유·composability·민감도·typed 입출력 port와 조건)을 manifest `r0.3`의 분류에 싣고, 실행 정의는 계약을 복사하지 않고 구현한 adapter(`pr_list_v2`)로 계약의 출력 port를 가리킨다. 공통 자원 참조(`GhResourceRef`)의 식별 규칙, 제한 JSON Pointer, 순수 호환 판정·바인딩 평가, 판정기의 답에서 계산한 타입 그래프를 두고, `GATE-GH-01d`를 여섯 차원(결과 계약·bindability·자원 타입·secret 출력·출력 port·입력 port — port 차원은 capability 수가 분모이고 0이면 미달)의 실제 완전성 검증으로 바꾼다(검증기 보고서 판 `r2`, 옛 `r1` 기록은 「결과 계약 미검증」으로 읽는다). `pr list` 결과를 `pr_list_v2`로 올려 식별 필드를 고르지 않은 정상 조회를 살리고(`DEV-682`) PR 참조를 검증된 실행 컨텍스트로 만든다. 분류 표의 주 결과 종류 63건·출력 모드 29건을 비TTY 실측으로 정정한다(`DEV-683`). 도메인 회귀를 CI integration 잡에 잇는다(`DEV-686`). SRS 사실 정정 셋(`--json` 41 → 40 `DEV-676`, 9.8 4항 예시 `DEV-684`, `NFR-009` port 분모 `DEV-688`)과 CR-087·088 머리글 누락 정정(`DEV-687`). **하지 않은 것**: `pr.view`를 포함한 새 명령의 실행, Recipe 저장·실행·그래프 편집기, R1~R3 개방, 스냅숏 활성화(`DEV-685`)·A-005 정책 편집, 마이그레이션 추가, 사내 GHES 지원 판정(`DEV-674`), 릴리스 발행 | FR-GH-001 · FR-GH-002 · FR-GH-005 · FR-GH-011 · NFR-009 · NFR-010 · ADR-020 · API-GH-001 · API-GH-013 · API-GH-014 · ENT-GH-009 · ENT-GH-010 · ENT-GH-011 · JOB-GH-003 · REL-007 · WP-045 · WP-059 · WP-066 · WP-079 · DEV-674 ~ DEV-676 · DEV-682 ~ DEV-689 | 요구사항(SRS v2.27) · 아키텍처(데이터 모델·비동기·백엔드·인프라·API 계약·프런트엔드·관측성·보안·ADR) · 파생 UI(와이어프레임 A-006·QA 체크리스트·에이전트 브리프) · 로드맵 · 작업 패키지 · 검증 계획 · CI · 코드 · 구현 원장 | closed — cascade·검사기 결과·병합 뒤 main CI를 기록하고 닫는다 (2026-09-14) |
| CR-090 | 2026-09-14 | scope | `REL-007` 검증된 레지스트리 운영 승인·R0 실행 정책 수직 (결정자 지시 2026-09-14) | **관리자의 명시적 승인과 차단 결정이 실제 실행을 통제하고, 그 근거와 변경 이력이 보존되게 한다 — 새로 실행 가능한 명령은 없다.** 운영자가 A-006에서 현재 적재된 gh capability 정의와 실행기 검증 근거를 미리 보고 운영 승인·철회하며, A-005(최소)에서 `pr.list`를 사유와 함께 차단·재개한다. 결정은 배포 범위(`GHE_BASE_URL`의 호스트)마다 하나인 정책 revision으로 남는다 — 기대 revision 충돌 검출, 중복 방지 키, append-only 이력, 같은 트랜잭션의 감사(`FR-AUTH-004 AC-6` 예외). API의 요청 수락과 실행기의 claim이 같은 판정 함수로 확인한다: 승인이 없으면 `admin_action_required`, 운영자 차단이면 `policy_blocked`, 수락 뒤 revision이 바뀐 대기 요청은 과거 승인을 승계하지 않고 닫힌다. DB 변경은 `SECURITY DEFINER` 함수(소유자 `prs_admin`, 고정 `search_path`, `prs_app`에는 EXECUTE만)와 advisory lock 직렬화로 하고, claim 가드 트리거가 이전 앱 버전으로 되돌린 뒤에도 승인 없는 실행권 확정을 막는다. 스냅숏 활성화 조건에 결과 계약 차원(보고서 판 해석기·재현 해시·게이트)을 반영하고(`DEV-685`), 현재 WP-045 상태 문구를 정정한다. 운영 승인은 196개 명령의 실행 허용·사내 GHES 확인·`GATE-GH-01e`·`06`·`08`의 증거·`REL-007` 완료가 아니다 | FR-GH-009 · FR-GH-011 · FR-AUTH-004 · API-GH-001 · API-GH-002 · API-GH-008 · API-GH-013 · ENT-GH-006 · ENT-GH-012 · ENT-GH-013 · ENT-GH-014 · JOB-GH-001 · JOB-GH-003 · A-005 · A-006 · W-010 · REL-007 · WP-045 · WP-059 · WP-080 · DEV-685 | 요구사항(SRS v2.28 · 용어집 · 추적 매트릭스) · 파생 UI(와이어프레임 A-005·A-006·W-010 · 상태 매트릭스 · 흐름 · QA 체크리스트 · IA · 에이전트 브리프) · 아키텍처(API 계약 · 데이터 모델 · 보안 · 비동기 · 백엔드 · 프런트엔드 · 인프라 · 관측성 · ADR) · 로드맵 · 작업 패키지 · 검증 계획 · 런북 · 코드 · 구현 원장 | in_progress |

## 4. 게이트 통과 기록

| 게이트 | 날짜 | 결과 | 근거 |
| --- | --- | --- | --- |
| Intake 게이트 | 2026-08-19 | pass | 출처 SRC-01~05 기록, 대상 사용자 6종·핵심 시나리오 7종 도출, OD-001~008 등록, glossary 6개 영역 초기 용어 확정 |
| SRS 게이트 | 2026-08-19 | pass | FR 51종이 전체 블록(EARS 문장·출처·AC·검증 방법·관련 ID·예외 처리)을 갖춤. NFR 8종 정량화. 모호어 lint 경고 0. FR/NFR ID 중복 0. In/Conditional/Out of Scope 명시. Must FR을 차단하는 open OD 0 |
| **기준선 승인** | 2026-08-19 | pass | 사용자가 `srs_final.md` baseline을 승인. 상태 `review` → `baseline`, 버전 v1.0. 내용 변경 없이 상태만 전환 (CR-003). 이후 이 문서 변경은 CR 선행 필수 |
| 추적성 게이트 | 2026-08-19 | pass | 승인 FR 51종 + NFR 8종 전부 매트릭스에 매핑. 직접 화면 43, 간접 노출 16. 매트릭스의 모든 화면 ID가 IA에 선언됨 |
| 파생 UI 게이트 | 2026-08-19 | pass | IA가 화면 13종 선언 후 하위 문서가 참조. 와이어프레임에 목적·진입·레이아웃·섹션·컴포넌트·상태·이벤트·권한 포함. 플로우 9종에 성공·실패·딥링크·오버레이·예외 경로 정의. 상태 매트릭스에 공통 상태 25종 + 화면별 매트릭스. 컴포넌트 47종 정의와 중복 방지 규칙. 토큰은 Conductor 매핑. QA 체크리스트가 릴리스 게이트로 사용 가능 |
| 아키텍처 게이트 | 2026-08-19 | pass | 시스템 경계 8종과 배포 단위 9종 정의. 고위험 FR이 FE/BE/API/data/infra에 매핑됨. 안정 API 12종에 요청/응답 JSON 예시 포함. 데이터 모델에 PostgreSQL 스키마와 ES 매핑 5종 명시. 비동기 잡 21종·이벤트 9종 정의. 보안에 신뢰 경계 9종·위협 20종·오남용 5종. 인프라에 환경 4종·용량 산정·DR 시나리오 7종. 관측성에 SLO 12종·알림 24종·런북 19종. ADR 12종 확정 |
| 딜리버리 게이트 | 2026-08-19 | pass | REL 6종이 FE/BE/API/data/infra/security/QA를 관통하는 수직 슬라이스로 정의됨. 의존성 지도에 선행 조건과 차단 대상 명시. 릴리스 검증에 게이트 7종·성능 10종·보안 12종·정확성 8종. WP 44종이 전 REL을 커버하고 각 WP가 FR 참조·선행 관계·체크 가능한 DoD·검증 명령을 가짐. 순환 의존 0 |
| 핸드오프 게이트 | 2026-08-19 | pass | `srs_final.md` 상태 `baseline`. `validate_srs_prd_env.py --root . --strict` → `OK: no structural or traceability issues found.` (오류 0, 경고 0). 브리프 2종이 스택 결정 20종·실행 명령·WP 실행 루프·금지 지름길 15종·제출 형식을 포함하고 상태가 `review`로 SRS baseline과 정합. WP-001은 브리프와 그것이 지정한 문서만으로 실행 가능. OD-003·OD-006·OD-007은 REL-001 선행 조건으로 남아 있었고 2026-08-19 사용자 결정(CR-004)으로 해소되었다 |
| **범위 확장 승인 (CR-005)** | 2026-08-20 | pass | 사용자가 GitHub Operations Platform으로의 범위 확장을 승인. `srs_final.md` v1.1 → v2.0 (`baseline` 유지). FR-GH-001~013·NFR-009~012 추가, 기존 Out of Scope 2항 재분류. gh 2.97.0 실측 인벤토리(command node 228, flag 1,034)를 근거로 parity 요구를 정량화. `validate_srs_prd_env.py --root . --strict` → 오류 0, 경고 0. FR 64종의 매트릭스·아키텍처·WP 참조 커버리지 각각 100%. 안정 ID 재번호화 0 |
| **REL-003 릴리스 게이트** | 2026-08-26 | **fail (조건부 승인 아님)** | 필수 게이트 여섯(2·3·4·5·6·7) 중 **통과는 둘**이다. **Gate 2 통과** — REL-003이 만든 결정은 전부 기존 ADR 안에서 CR로 처리됐다(CR-029~038). **Gate 3 통과** — WP-020~028·067·068의 DoD 전항 통과, CI `verify`·`integration` 녹색(PR #41·#42·#43), 단위 1264·통합 809·회귀 83·a11y 192·contrast 80쌍. **Gate 4 미통과** — 권한 매트릭스 78셀 중 역할 6종 × API 경로만 검증됐고 화면 13종 축은 화면이 다 서지 않아 걸 수 없다. 위협 모델 재검토와 시크릿 스캔은 실행 기록이 없다. **Gate 5 미통과** — axe 0·대비 0은 통과했으나 성능 목표 7종이 **NOT RUN**이다(합성 데이터셋·`test:perf` 부재, DEV-058). **Gate 6 미통과** — 런북 실행·롤백 10분 실측·대시보드·알림 구성 모두 실행 기록이 없다. 배포 manifest는 정적 검증까지이며 실제 Kubernetes가 없다. **Gate 7 부분** — 시퀀스 정확성(git 대조)은 회귀 계층이 매 실행 판정하나 나머지 검수는 대상 기능이 REL-004 이후라 아직 판정할 수 없다. **WP는 11/11 완료**(WP-020~028·067·068)이며 미해결 리뷰 지적 0건이지만, **WP 완료와 게이트 통과는 다른 판정이다.** 베타 공개는 승인되지 않는다. 근거는 원장 6.31·6.31.1장 |

## 5. Cascade 기록

CR별로 실제 갱신한 문서 체크리스트를 남긴다.

### CR-001 cascade

- [x] 초기 생성이므로 해당 없음

### CR-002 cascade

Phase 0 (Intake)

- [x] `10_requirements/feature.md` — 출처 SRC-01~05, 기능 후보 45종(승인 40 / 제외 4 / 보류 1)
- [x] `10_requirements/workflow.md` — 템플릿 유지 (절차 변경 없음)

Phase 1 (Requirements)

- [x] `10_requirements/prd.md` — 목표·비목표·사용자 6종·성공 지표 6종·범위·시나리오 7종·리스크 8종·OD 8종
- [x] `10_requirements/glossary.md` — 6개 영역 용어 표, 네이밍 규칙, 운영 원칙 5종
- [x] `10_requirements/srs_final.md` — FR 51종 전체 블록, NFR 8종 정량화, 범위 3분류, 외부 인터페이스 7종, 데이터·추적성 요구 7종

Phase 2 (Traceability)

- [x] `10_requirements/requirements_screen_traceability_matrix.md` — FR 51 + NFR 8 전량 매핑, 커버리지 요약

Phase 3 (Derived UI)

- [x] `20_derived_ui_specs/pr_search_product_ia.md` — 화면 13종 선언, 셸 구조, 진입 경로 18종
- [x] `20_derived_ui_specs/pr_search_wireframe_spec.md` — 화면 13종 상세
- [x] `20_derived_ui_specs/pr_search_screen_flow_spec.md` — FLOW-000~008, 딥링크 15종, 공통 예외 13종
- [x] `20_derived_ui_specs/pr_search_screen_state_matrix.md` — 공통 상태 25종, 화면별 매트릭스, 전이 규칙
- [x] `20_derived_ui_specs/pr_search_ui_component_spec.md` — C-001~047, Conductor 사용 맵, 중복 방지 규칙
- [x] `20_derived_ui_specs/pr_search_design_system_tokens.md` — Conductor 토큰 매핑
- [x] `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — 공통 18종 + 화면별 + 권한 매트릭스 + 성능 + 회귀

Phase 4 (Architecture)

- [x] `30_technical_architecture/pr_search_system_architecture.md` — 런타임 구조, 두 수집 레인, 데이터 흐름 3종
- [x] `30_technical_architecture/pr_search_architecture_decision_records.md` — ADR-001~012
- [x] `30_technical_architecture/pr_search_frontend_architecture.md` — 라우트 매핑, 상태 경계, 페칭 전략
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 모듈 12종, 핵심 처리 경로 5종, 실패 처리
- [x] `30_technical_architecture/pr_search_api_contracts.md` — API 28종 카탈로그, 안정 API 12종 JSON 예시, 오류 코드 29종 (CR-006/DEV-003 정정: 이전 판 표기는 30종이었으나 API 계약 6장의 실제 코드는 29종이었다. CR-005로 GH 코드 16종이 추가되어 45종이 되었고, CR-012가 `INVALID_PARAMETER`를 더해 현재는 46종이다)
- [x] `30_technical_architecture/pr_search_data_model.md` — 엔티티 17종, PostgreSQL 스키마, ES 매핑 5종, 조회 패턴 16종
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — 큐 6종, 잡 21종, 이벤트 9종, 지표 20종
- [x] `30_technical_architecture/pr_search_security_privacy_architecture.md` — 신뢰 경계 9종, 위협 20종, 오남용 5종
- [x] `30_technical_architecture/pr_search_infrastructure_operations.md` — 환경 4종, 배포 단위 9종, 용량 산정, DR 7종
- [x] `30_technical_architecture/pr_search_observability_reliability.md` — SLO 12종, 알림 24종, 런북 19종

Phase 5 (Delivery)

- [x] `40_delivery/pr_search_implementation_roadmap.md` — REL-001~006, 슬라이스 정의, 의존성 지도, 마이그레이션 5단계
- [x] `40_delivery/pr_search_release_validation_plan.md` — 게이트 7종, 성능 10종, 보안 12종, 정확성 8종
- [x] `40_delivery/pr_search_work_packages.md` — WP-001~044
- [x] `40_delivery/pr_search_implementation_traceability.md` — WP 상태 44행, FR→코드 매핑 59행, 편차 로그 초기화

Phase 6 (Handoff 준비)

- [x] `20_derived_ui_specs/pr_search_ai_agent_implementation_request.md` — 필수 입력 28종, 구현 원칙 7영역, 금지 지름길 15종
- [x] `20_derived_ui_specs/pr_search_ai_agent_execution_brief.md` — 30초 요약, 스택 결정 20종, 실행 루프, 제출 형식

거버넌스

- [x] `00_governance/change_control.md` — CR-002 등록, 게이트 기록 6종
- [x] `docs/README.md` — 문서 인덱스 갱신
- [x] `AGENTS.md`, `CLAUDE.md` — 제품 맥락과 작업 규칙 갱신

validator 결과: `python3 validate_srs_prd_env.py --root . --report` → 구조·추적성 문제 없음. 모호어 경고 0.

### CR-004 cascade

Phase 1 (Requirements)

- [x] `10_requirements/srs_final.md` — v1.0 → v1.1 (`baseline` 유지). 14장 OD-003·OD-006·OD-007 `resolved`, 4.2장 조건부 범위 표의 참조 2건 정정, NFR-003에 워크로드 기준선과 용량 설계 상한 구분 추가
- [x] `10_requirements/prd.md` — v0.2 → v0.3. 12장 OD 3종 `resolved`, 5.2장 조건부 범위 표 참조 정정

Phase 2 (Traceability)

- [x] `10_requirements/requirements_screen_traceability_matrix.md` — FR-REL-008 비고의 조건부 근거를 REL-004 ACC-06으로 정정

Phase 3 (Derived UI)

- [x] `20_derived_ui_specs/pr_search_product_ia.md` — W-007 조건부 근거 2곳 정정
- [x] `20_derived_ui_specs/pr_search_wireframe_spec.md` — W-007 조건부 범위 문구 정정
- [x] `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — W-007 섹션 제목 정정
- [x] `20_derived_ui_specs/pr_search_design_system_tokens.md` — 그래프 캔버스 제한 항목의 조건부 근거 정정

Phase 4 (Architecture)

- [x] `30_technical_architecture/pr_search_architecture_decision_records.md` — ADR-002 Kafka 전환 임계에서 OD-006 인용 제거, ADR-003 아카이브 ILM 창과 `raw_event` 보존의 분리 명시, 전용 클러스터 확정 반영, 샤드 수 불변 Follow-up 재작성
- [x] `30_technical_architecture/pr_search_infrastructure_operations.md` — 2장 환경 표와 4장 backing service 표 갱신, **4.1장 Elasticsearch 토폴로지 신설**(결정값 / 미확정 항목 / 장애 도메인 주의), 5장 산정 기준 재작성, ES 용량을 엔티티·아카이브·총계로 분리, `raw_event` 4TB 확정 문구, 10장 스케일 표, 11장 제한 3행
- [x] `30_technical_architecture/pr_search_data_model.md` — 8장 보존 표에서 `raw_event` 3년 확정과 ES 아카이브 ILM 창 분리 명시
- [x] `30_technical_architecture/pr_search_system_architecture.md` — 객체 스토리지 제외 사유를 확정값 기준으로 재작성
- [x] `30_technical_architecture/pr_search_observability_reliability.md` — RB-15 런북, 8장 용량 계획의 ES 디스크 3행 분리와 `raw_event` 확정값

Phase 5 (Delivery)

- [x] `40_delivery/pr_search_implementation_roadmap.md` — REL-004/REL-006 exit criteria, 6장 의존성 지도(OD 3행 해소 + ES 호스트 배치 행 추가), 7장 리스크, 9장 알려진 제한
- [x] `40_delivery/pr_search_work_packages.md` — WP-005 제외 항목, WP-043 조건부 근거
- [x] `40_delivery/pr_search_release_validation_plan.md` — ACC-06의 판정 결과 해석 명시
- [x] `40_delivery/pr_search_implementation_traceability.md` — WP-043 비고, 알려진 제한, 8장 다음 작업(OD 3종 완료 처리 + ES 호스트 배치 확인 항목 추가)

Phase 6 (Handoff)

- [x] `20_derived_ui_specs/pr_search_ai_agent_implementation_request.md` — 착수 전 확인 표의 OD 3행을 완료로 전환하고 ES 호스트 배치 행 추가
- [x] `20_derived_ui_specs/pr_search_ai_agent_execution_brief.md` — v0.2 → v0.3. 4장에 사용자 결정 확정값 표와 미확정 인프라 사양 처리 규칙 추가

거버넌스

- [x] `00_governance/change_control.md` — CR-004 등록, 핸드오프 게이트 주석 갱신, 6장 미결 항목 3건 해소 처리

validator 결과:

- `python3 validate_srs_prd_env.py --root . --strict` → `OK: no structural or traceability issues found.` (오류 0, 경고 0, 종료 코드 0)
- `python3 validate_srs_prd_env.py --root . --report` → FR 51종의 매트릭스·아키텍처·WP 참조 커버리지 각각 100%. 전 문서 미결 표식 0. CR 4, DEV 0

범위 확인: FR·NFR의 요구 문장과 수용 기준은 변경하지 않았다. 안정 ID(FR/NFR/OD/W/C/FLOW/API/ENT/JOB/EVT/ADR/REL/WP)는 추가·변경·재번호화하지 않았다. ADR-003 샤드 수도 변경하지 않았다.

이 CR이 확정하지 않은 것: Elasticsearch 노드당 CPU·RAM·디스크 용량, Docker host 수, 컨테이너 호스트 배치. 사용자가 결정하지 않은 인프라 사양이므로 문서에 임의 값을 채우지 않았고, REL-001 프로비저닝 항목으로 남겼다.

### CR-005 cascade (제품 범위 확장)

거버넌스

- [x] `00_governance/change_control.md` — CR-005 등록, cascade 기록, 게이트 기록

Phase 1 (Requirements)

- [x] `10_requirements/srs_final.md` — **v1.1 → v2.0 (`baseline` 유지)**. 3.2장 두 Plane 정의 신설, 4.1장 In Scope 9항 추가, 4.2장 조건부 3항 추가, 4.3장 Out of Scope 재분류, 9.8장 FR-GH-001~013 신설, 10장 외부 인터페이스 3종 추가, 11장 데이터 요구 4항 추가, 12장 NFR-009~012 신설, 13장 우선순위 재구성
- [x] `10_requirements/prd.md` — v0.3 → v1.0. 5.3장 Operations Plane 신설, Out of Scope 2항 재분류 표기
- [x] `10_requirements/glossary.md` — GitHub Operations 용어 15종 추가
- [x] `10_requirements/requirements_screen_traceability_matrix.md` — 4.8장 FR-GH 매핑 13행, NFR-009~012 매핑, 커버리지 요약 갱신

Phase 3 (Derived UI)

- [x] `20_derived_ui_specs/pr_search_product_ia.md` — 표면 트리에 GitHub Operations 영역 추가, 4.1장 W-010~W-023·A-005~A-007 선언
- [x] `20_derived_ui_specs/pr_search_wireframe_spec.md` — W-010 상세, W-011~W-023 공통 규칙, A-005~A-007
- [x] `20_derived_ui_specs/pr_search_screen_flow_spec.md` — FLOW-009 실행, FLOW-010 신원 연결
- [x] `20_derived_ui_specs/pr_search_screen_state_matrix.md` — Operations 전용 상태 13종
- [x] `20_derived_ui_specs/pr_search_ui_component_spec.md` — C-048~C-060
- [x] `20_derived_ui_specs/pr_search_design_system_tokens.md` — 위험도·실행 상태 토큰 매핑, 제한 2건
- [x] `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — QA-GH-01~20

Phase 4 (Architecture)

- [x] `30_technical_architecture/pr_search_architecture_decision_records.md` — ADR-013~016
- [x] `30_technical_architecture/pr_search_system_architecture.md` — 11장 Operations Plane 런타임과 공유·비공유 경계
- [x] `30_technical_architecture/pr_search_frontend_architecture.md` — 9장 라우트, GenericCommandForm, 실행 상태 표현
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 12장 모듈 7종, 실행 처리 경로 14단계
- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-GH-001~012, 오류 코드 16종 추가 (29 → 45)
- [x] `30_technical_architecture/pr_search_data_model.md` — ENT-GH-001~006, 3.5장 additive 스키마(006~009), 보존 표 6행
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — 9장 큐 2종, JOB-GH-001~008, EVT-GH-001~007
- [x] `30_technical_architecture/pr_search_security_privacy_architecture.md` — 10장 자격 증명 경계, 토큰 수명주기, 명령 주입 차단, 비밀 취급, 위협 7종
- [x] `30_technical_architecture/pr_search_infrastructure_operations.md` — `gh-executor` 배포 단위, 네트워크 정책, 12장 실행기 런타임
- [x] `30_technical_architecture/pr_search_observability_reliability.md` — 10장 SLO 6종, 알림 7종, RB-20~24

Phase 5 (Delivery)

- [x] `40_delivery/pr_search_implementation_roadmap.md` — REL-007~011, 의존성 6행, 위험 5행
- [x] `40_delivery/pr_search_release_validation_plan.md` — 10장 GATE-GH-01~08, ACC-09~14, 보안 시험, 조합 시험 원칙
- [x] `40_delivery/pr_search_work_packages.md` — WP-045~060 (색인 + 상세 블록), REL별 요약 갱신
- [x] `40_delivery/pr_search_implementation_traceability.md` — WP 16행, FR-GH·NFR 매핑 17행, 다음 작업 재작성

Phase 6 (Handoff)

- [x] `20_derived_ui_specs/pr_search_ai_agent_implementation_request.md` — REL-007 착수 조건, 금지 지름길 16~25
- [x] `20_derived_ui_specs/pr_search_ai_agent_execution_brief.md` — v0.3 → v0.4. 10장 Operations 스택 결정과 금지 목록

기타

- [x] `README.md` — 제품 정의를 두 축으로 갱신, 저장소 구조에 `gh-cli`·`gh-executor` 추가

gh capability 실측 근거: 이 CR의 수치는 실제로 설치한 gh 2.97.0(2026-07-31)을 걸어 측정했다. 문서나 기억의 command 목록을 쓰지 않았다.

| 측정 항목 | 값 |
| --- | --- |
| command node (root 제외) | 228 |
| 실행 가능 leaf command | 196 |
| 그룹 command | 32 |
| command 고유 flag (상속 제외) | 1,034 |
| positional placeholder | 261 |
| `--json` 지원 command | 41 |
| top-level 영역 | 33 |

**안정 ID 확인.** 기존 FR·NFR·W·A·C·FLOW·API·ENT·JOB·EVT·ADR·REL·WP ID를 변경·재번호화·삭제하지 않았다. 신규 ID는 모두 기존 번호 뒤에 이어 붙였다.

### CR-006 cascade (문서 편차 정정)

- [x] `30_technical_architecture/pr_search_data_model.md` — DEV-004: `raw_event_delivery_uk` 제거와 사유 주석. DEV-005: `audit_record` PK를 `(audit_id, occurred_at)`으로 정정
- [x] `00_governance/change_control.md` — DEV-003: 아키텍처 게이트 기록의 오류 코드 수 정정
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-003·004·005를 `resolved`로 전환하고 CR-006 연결
- [x] `packages/contracts/src/error-codes.ts` — API 계약 6장과 재동기화 (45종). 문서를 파싱해 대조하는 기존 테스트가 이 동기화를 강제한다

DEV-001(컨테이너 레지스트리 차단)과 DEV-006(testcontainers 대신 환경 변수 접속)은 환경·검증 제약이며 문서 오류가 아니다. 근거 없이 resolved 처리하지 않고 `open`으로 유지한다.

### CR-007 cascade (데이터 모델 편차 정정)

- [x] `30_technical_architecture/pr_search_data_model.md` — DEV-007: 4장 공통 설정의 `index.sort` 적용 범위를 `merge_seq` 보유 인덱스로 한정. DEV-009: 3.1에 파티션 테이블의 유일 제약 한계와 게이트웨이 멱등 저장 SQL 추가. 버전 v0.2 → v0.3
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-007·DEV-009를 `resolved`로 전환하고 CR-007 연결
- [x] `00_governance/change_control.md` — 본 CR 등록과 cascade 기록

요구사항 계층(`srs_final.md`, `prd.md`)은 변경하지 않았다. 두 편차 모두 승인된 요구사항이 아니라 그것을 구현하는 수단에 대한 서술 오류이며, FR-ING-002 AC-1(중복 저장 차단)과 FR-ING-005(색인 구성)의 수용 기준은 그대로 충족된다. 파생 UI·API 계약·딜리버리 문서에는 인용 지점이 없어 cascade가 여기서 끝난다.

DEV-001(컨테이너 레지스트리 차단), DEV-006(testcontainers 대신 환경 변수 접속), DEV-008(로컬 ES 부재)은 환경·검증 제약이며 문서 오류가 아니다. `open`으로 유지한다.

### CR-008 cascade (gh capability parity 강화)

- [x] `10_requirements/srs_final.md` — v2.0 → v2.1. §9.8 도입부의 실측 기준값 갱신, FR-GH-001(28개 parity 차원·interaction 분류), FR-GH-002(구조화 invocation 단일 진실), FR-GH-003(의미 제약 모델), FR-GH-007(파일 경계), FR-GH-010(스키마 인지 api 탐색기), FR-GH-012(재검증형 재실행), FR-GH-013(web equivalence·extension 신뢰 경계), NFR-009(전 차원 게이트), NFR-010(SafeGhOutput·파일 경계) 강화
- [x] `10_requirements/prd.md` — parity 정의 강화 반영
- [x] `10_requirements/glossary.md` — 구조화 invocation·제약 모델·SafeGhOutput·web equivalence 용어 추가
- [x] `10_requirements/requirements_screen_traceability_matrix.md` — 신규 컴포넌트·WP 참조 반영
- [x] `20_derived_ui_specs/` — 컴포넌트 스펙(C-061~067), 와이어프레임(W-010·W-020·W-021·W-022·A-006), 상태 매트릭스, QA 체크리스트
- [x] `30_technical_architecture/` — ADR-017·018·019 추가, 데이터 모델(GhCapabilityConstraint·GhInvocation), API 계약(API-GH-002·009 요청 스키마), 보안 문서(SafeGhOutput 경계·THR 추가), 프런트엔드(출력 렌더링 금지 규칙), 시스템(경계 표기)
- [x] `40_delivery/` — WP-061~065 추가, WP-060 선행 의존 갱신, 로드맵 배치, 원장 기록

**기존 ID를 하나도 재번호화하지 않았다.** CR-005가 만든 FR-GH-001~013, NFR-009~012, W-010~W-023, A-005~A-007, C-048~C-060, ADR-013~016, API-GH-*, ENT-GH-*, JOB-GH-*, EVT-GH-*, REL-007~011, WP-045~060은 그대로 두고 내용만 강화했다. 새 ID는 전부 마지막 번호 뒤에 덧붙였다 (ADR-017~019, C-061~067, WP-061~065).

**gh 인벤토리 재실측 (2026-08-20).** 이 환경에 gh 2.97.0을 다시 설치해 command node 228개 전부에 `gh <path> --help`를 실행했다. command node 228(그룹 32, leaf 196), command 고유 flag 1,034, `--json` 지원 41은 CR-005 수치와 **정확히 일치**했다. positional placeholder만 문서의 261과 달랐고 실측은 230이다 — `gh help reference` 헤딩 기준과 각 명령 `--help`의 USAGE 기준이 모두 230으로 일치한다. DEV-011로 등록하고 이 CR에서 정정했다. 새로 측정한 차원: inherited/global flag 출현 312회(고유 4종: `--codespace`, `--help`, `--repo`, `--repo-owner`), short alias 보유 flag 625개, 반복 가능 flag 37개, `--json` 필드 707개, alias 보유 command 44개, alias 전용 노드 1개(`gh co`).

### CR-009 cascade (typed capability graph와 조합 parity)

- [x] `10_requirements/srs_final.md` — v2.1 → v2.2. §9.8에 결과 계약·resource 참조·port·바인딩·그래프 절 신설, FR-GH-001(결과 계약 분류), FR-GH-002(결과 envelope), FR-GH-005(typed DAG·bounded fan-out·동적 R2/R3 preflight), FR-GH-007(아티팩트 ID 바인딩), FR-GH-012(plan hash), NFR-009(조합 게이트), NFR-010(secret 결과 금지 항목) 강화
- [x] `10_requirements/prd.md` — 조합 parity로 넓힌 목표 반영
- [x] `10_requirements/glossary.md` — 결과 계약·resource 참조·port·바인딩·그래프·composability 용어
- [x] `10_requirements/requirements_screen_traceability_matrix.md` — FR-GH-005·001·002 행 갱신
- [x] `20_derived_ui_specs/` — C-068~070 추가, W-023 typed graph builder 강화, A-006 조합 커버리지, QA-GH-34~43
- [x] `30_technical_architecture/` — ADR-020 추가, 데이터 모델(ENT-GH-009~011), API 계약(API-GH-004 그래프·바인딩 스키마), 보안(THR-030~033), 프런트엔드(그래프 편집 규칙)
- [x] `40_delivery/` — WP-066 추가, WP-058·WP-060·WP-065 선행 갱신, 로드맵·검증 계획·원장

**기존 ID를 하나도 재번호화하지 않았다.** CR-005·CR-008이 만든 FR-GH-001~013, NFR-009~012, W-010~023, A-005~007, C-048~067, ADR-013~019, WP-045~065를 그대로 두고 내용만 넓혔다. 새 ID는 마지막 번호 뒤에 덧붙였다 (ADR-020, C-068~070, WP-066, ENT-GH-009~011).

**왜 Recipe만으로는 부족했나.** 기존 FR-GH-005는 순차 단계·typed 입력·이전 단계 JSON 출력 바인딩·조건·fan-out·동시성·실패 정책을 지원한다. 그런데 gh 명령의 출력이 전부 JSON은 아니다 — 어떤 것은 URL을, 어떤 것은 아티팩트 파일을, 어떤 것은 종료 코드만 낸다. `gh release download`가 만든 파일을 다음 명령의 파일 입력으로 넘기는 일이나, `gh search prs`의 결과 집합에서 하나를 골라 `gh pr checks`에 넘기는 일은 "JSON 필드 바인딩"으로 표현되지 않는다. 명령마다 특수 코드를 넣지 않고 이것을 일반화하려면 출력에도 계약이 있어야 한다.

### CR-010 cascade (WP-007 파이프라인 계약 정정)

- [x] `10_requirements/srs_final.md` — FR-ING-004 예외/실패 처리의 재시도 횟수를 3회 → 5회 (DEV-012). rate limit 대기가 재시도 예산을 소비하지 않는다는 규칙 명시
- [x] `30_technical_architecture/pr_search_api_contracts.md`, `pr_search_async_events_jobs.md` — `EVT-ING-002` payload를 self-contained bounded로 확정 (DEV-013), 재시도와 rate limit defer 구분 (DEV-014)
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — enrich 처리 순서와 처분 계약
- [x] `30_technical_architecture/pr_search_data_model.md` — 보강 결과를 별도 테이블에 두지 않는 이유 명시
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-012~016 등록, 012~015는 resolved
- [x] `packages/bus` — 핸들러 처분 확장 (구현은 WP-007 커밋)
- [x] `packages/domain` — `IngestionEnriched` 타입
- [x] `packages/github` — `GHE_INSTALLATIONS` 파싱

**CR-009와 섞지 않았다.** CR-009는 GitHub Operations Plane의 조합 parity를 넓히는 범위 변경이고, CR-010은 Search/Data Plane 파이프라인의 계약 정합성 수정이다. 두 CR이 건드리는 문서 집합도 겹치지 않는다.

### CR-011 cascade (WP-008 투영 계약 정정)

- [x] `10_requirements/srs_final.md` — FR-ING-005 예외/실패 처리에 미등록 저장소 규칙과 벌크 부분 실패 분류를 명시 (DEV-020). AC는 건드리지 않았다 — 요구되는 결과는 그대로고 그 결과를 얻는 조건만 적었다
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — `EVT-ING-002`의 `pull_request` 필드 목록을 PR 문서 매핑 기준으로 확정 (DEV-018)
- [x] `30_technical_architecture/pr_search_data_model.md` — 5장 조건부 업서트 스크립트에 배열 합집합 절 추가 (DEV-019), 투영이 소유하는 필드와 다른 워커가 소유하는 필드 구분
- [x] `40_delivery/pr_search_work_packages.md` — WP-008 구현 범위에 미등록 저장소 처리와 소유 필드 경계 명시
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-018~020 등록, 전부 resolved
- [x] `packages/github`, `packages/domain` — `PullRequestSummary`·`EnrichedPullRequest` 필드 확장 (구현은 WP-008 커밋)
- [x] `packages/es` — 조건부 업서트 스크립트와 벌크 경계

**CR-010과 섞지 않았다.** CR-010은 보강(WP-007)이 딛고 설 계약을 고쳤고, CR-011은 투영(WP-008)이 딛고 설 계약을 고친다. 둘 다 Search/Data Plane이지만 건드리는 FR과 단계가 다르다. **CR-009(Operations Plane)와는 문서 집합이 겹치지 않는다.**

### CR-012 cascade (WP-009 실패 대기열 계약 정정)

- [x] `30_technical_architecture/pr_search_data_model.md` — `dead_letter`에 `(delivery_id, stage)` 유일 제약·`repository_id`·`resolved` 상태 추가, 업서트 상태 전이표 (DEV-022, DEV-023)
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — 5.3에 재투입 지점·JOB-ING-009 실행 주체·`EVT-ING-004` 미발행 사유 명시 (DEV-024, DEV-026). 경보 대상을 `pending`+`reprocessing`으로 한정
- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-ADM-003 상세 규격 신설. 100건 초과 확인, 500건 상한, `held` 자동 제외, 임시 토큰 인증 (DEV-025)
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 4.2.1 실패 격리와 재처리 경로. 성공 판정을 투영의 `processed_at` 자리에 두는 이유
- [x] `40_delivery/pr_search_work_packages.md` — WP-009 구현 범위에 `resolved` 전환과 인증 임시 통제 명시
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-022~027 등록. 022~025 resolved, 026 open, 027 부분 resolved(`job_id` 절반은 WP-019·WP-010 몫)
- [x] `packages/db` — 마이그레이션 006, `dead_letter` 리포지터리 업서트·필터 조회 (구현은 WP-009 커밋)
- [x] `apps/search-api` — `ops` 모듈 (구현은 WP-009 커밋)
- [x] `pr_search_api_contracts.md` 6장 + `packages/contracts` — 범용 400 코드 `INVALID_PARAMETER` 추가 (45 → 46종). 요청 형식 오류에 맞는 코드가 없어 뜻이 다른 코드를 빌려 쓸 뻔했다
- [x] `30_technical_architecture/pr_search_observability_reliability.md` — 실패 대기열 경보 조건을 `dead_letter_total{state="pending"}`에서 `dead_letter_open_total`로. `pending`만 세면 일괄 재처리 직후 경보가 사라진다

**SRS는 건드리지 않았다.** FR-ING-007이 요구하는 결과(격리·재처리·보류·경보)는 그대로다. 달라지는 것은 그것을 강제하는 수단(유일 제약)과 실행 주체(WP-019 이전에는 `ops`), 그리고 성공을 판정하는 자리뿐이다. **CR-010·CR-011과 섞지 않았다** — 둘은 보강·투영의 전방 계약을 고쳤고 CR-012는 그 두 단계가 실패했을 때의 후방 계약을 고친다.

### CR-013 cascade (WP-010 저장소 등록·파이프라인 상태 계약 정정)

- [x] `30_technical_architecture/pr_search_data_model.md` — `prs-commits` 매핑에 `repository_archived` 추가, 소프트 삭제 원칙에 소급 갱신과 버전 비교 제외 명시 (DEV-028)
- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-ADM-001·API-ADM-006 상세 규격 신설. 등록 시 GHE가 소유한 값을 물어서 채운다, 단계별 지연의 조건부 반환 (DEV-029, DEV-033)
- [x] `30_technical_architecture/pr_search_observability_reliability.md` — 3.4 "지표를 누가 읽는가". 항목별 출처 표와 워커 단일 복제본을 긁지 않는 이유 (DEV-029)
- [x] `40_delivery/pr_search_work_packages.md` — WP-010 구현 범위·제외·검증 방법. A-001 화면은 WP-015 이후로 명시(사용자 결정), 백필 실행은 WP-019 (DEV-031, DEV-032)
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-028~034 등록
- [x] `packages/es`, `packages/github`, `packages/db`, `apps/search-api` — 구현은 WP-010 커밋

**SRS는 건드리지 않았다.** FR-ING-009와 FR-ADMIN-001이 요구하는 결과는 그대로다. 달라지는 것은 표식이 붙는 인덱스 범위, 각 지표 항목의 출처, 감사 주체를 무엇으로 삼을지, 그리고 백필의 실행 시점뿐이다. **CR-012와 섞지 않았다** — CR-012는 실패 대기열의 후방 계약이고 CR-013은 등록·관측의 계약이다.

### CR-014 cascade (WP-011 질의 문법 계약 정정)

- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-SRCH-004에 질의 문법 표, `not_range` op, 값 검증 범위, 오류 판정 주체 (DEV-035~038)
- [x] `40_delivery/pr_search_work_packages.md` — WP-011 구현 범위에 범위 키 셋·`not_range`·`is` 값 검증·`QUERY_TOO_SHORT` 명시
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-035~039 등록
- [x] `packages/query` — 구현은 WP-011 커밋 (DEV-039의 `IMPLEMENTED_BY` 정정 포함)

**SRS는 건드리지 않았다.** FR-SRCH-005의 AC 여섯은 그대로다. 달라지는 것은 AC들이 말하지 않은 빈칸 — 부정된 범위의 이름, 값 검증의 범위, `..`를 받는 키, 오류 판정의 주체 — 을 정한 것뿐이다.

### CR-015 cascade (WP-012 인증·접근 범위 계약 정정)

- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-AUTH-001 `/me` 상세 규격, 7장 `EVT-AUTH-001` payload에 `team_id`, `/admin/*` 인증 인계 (DEV-040, DEV-041, DEV-048)
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — `EVT-AUTH-001` producer 경로와 JOB-AUTH-001 펼치기 규칙 (DEV-042, DEV-046)
- [x] `30_technical_architecture/pr_search_security_privacy_architecture.md` — 신원 전달 seam, 역할 합성 규칙, `access_scope_version` 울타리 (DEV-044, DEV-047, DEV-049)
- [x] `30_technical_architecture/pr_search_data_model.md` — `app_user.github_user_id`, `access_scope_version` 의미, `permission_cache` GIN 색인 (DEV-043, DEV-044, DEV-045)
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 조회 경로 1단계의 세션 해석 주체
- [x] `40_delivery/pr_search_work_packages.md` — WP-012 구현 범위에 신원 seam·역할 합성·무효화 대상 산출 명시
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-040~049 등록
- [x] `packages/authz`, `apps/search-api`, `apps/ingest-gateway`, `packages/db` — 구현은 WP-012 커밋 (구현 중 발견한 DEV-050 `BIGINT[]` 타입 파서 누락 포함)

**SRS는 건드리지 않았다.** FR-AUTH-001~003의 AC는 그대로다. 달라지는 것은 AC들이 말하지 않은 빈칸 — 신원의 표현, 무효화 대상을 찾는 방법, 갱신과 무효화가 겹칠 때의 순서, 역할을 합치는 규칙 — 을 정한 것뿐이다.

**DEV-051은 열려 있다.** 아키텍처 테스트가 API-ADM-006의 운영 집계 두 곳이 접근 범위를 거치지 않음을 드러냈고, FR-ADMIN-001 AC-1·AC-3과 THR-003·THR-016이 서로 반대 방향을 가리킨다. **동작을 바꾸지 않았다** — 사유 붙은 허용 목록에 등록해 다음 전역 집계가 조용히 들어오지 못하게 했을 뿐이다. 해소는 별도 CR과 사용자 결정을 요한다.

**OD-002는 열려 있다** (권한 판정 소스: GHE 협업자·팀 API 대 사내 IdP 그룹, 기한 REL-002 착수 전). SRS가 "두 소스 모두에서 동일 수용 기준을 만족한다"고 적었으므로 `resolveAccessScope`를 포트로 두고 GHE 어댑터를 구현한다. 결정이 IdP 그룹으로 나면 어댑터 교체이며 재작성이 아니다. 이 CR은 OD-002를 닫지 않는다.

### CR-016 cascade (WP-013 검색 계약 정정)

- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-SRCH-004에 질의 키→ES 필드 표, `is`의 뜻, 대상 인덱스, `relaxation_hints` 산출 규칙, `relevance`의 현재 동작, `facets`·`next_cursor`의 WP-013 형태 (DEV-052~057)
- [x] `30_technical_architecture/pr_search_data_model.md` — `org`·`team`이 레지스트리 해석을 거치는 이유 (DEV-052)
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 조회 경로에 다중 인덱스 정렬 규칙 추가 (DEV-054)
- [x] `40_delivery/pr_search_work_packages.md` — WP-013 구현 범위에 키 해석·`unmapped_type`·완화 후보 상한 명시
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-052~058 등록
- [x] `packages/es`, `packages/db`, `apps/search-api` — 구현은 WP-013 커밋 (구현 중 발견한 DEV-059 `_id` 정렬 불가 포함. 네 매핑에 `doc_id` 추가)

**SRS는 건드리지 않았다.** FR-SRCH-006의 AC 넷과 FR-SRCH-007의 AC 넷은 그대로다. 달라지는 것은 AC들이 말하지 않은 빈칸 — 질의 키가 가 닿는 자리, `is`와 `state`의 차이, 조회 대상 인덱스, 완화 후보를 세는 방법 — 을 정한 것뿐이다.

**DEV-052의 `team` 필터는 이 WP에서 결과를 내지 못한다.** 이름→ID 해석은 서지만 문서의 `allowed_team_ids`·`author_team_ids`가 비어 있다 (WP-012가 남긴 제한). 투영이 그 값을 채우는 것은 별도 CR이며, 그때 이 필터가 저절로 동작한다. **레지스트리에 없는 이름은 조용히 0건을 내지 않고 `unresolved_names`로 남긴다** — 다만 이름은 찾았는데 문서에 값이 없는 경우는 이 표식으로 구분되지 않는다.

**종료 기록 (2026-08-21).** WP-013 구현이 끝났고 검증 결과는 원장 6.13장이다.

| 검증 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 13개, 위반 0건 |
| `pnpm test` (전량) | 550건 통과 + 1건 건너뜀 (real-GHE smoke) |
| `pnpm test:integration` (전량) | 325건 통과 |
| `pnpm build` | 종료 코드 0 |
| `rg "TODO\|TBD\|미정\|결정 필요" docs/` | 3건 — 전부 서술문이고 자리표시자가 아니다. DEV-051은 CR-024로 해소되어 그 문장은 이력으로 남았고, 나머지 둘은 DEV-079(최근 검색 저장 위치 미정)를 가리킨다 |
| 적대적 변이 시험 | 26가지 전부 시험이 잡음 (처음 20가지 중 4가지가 살아남아 시험을 보강했다) |

**DEV-058은 열린 채로 남는다.** NFR-001의 p95 실측은 1000만 문서 데이터셋과 부하 harness가 없어 **NOT RUN**이며 REL-002 성능 게이트로 넘긴다. 나머지 DEV-052~057·DEV-059는 해소했다.

### CR-017 cascade (WP-014 식별자 해석 계약 정정)

- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-SRCH-001에 호스트 비교·릴리스 태그 규칙(DEV-064·065), API-SRCH-002 응답 예시를 실제 채워지는 필드로 축소하고 `direct_push`에 도달 불가 표시(DEV-060·061), API-SRCH-003의 `source_commits`·`source_commits_total` 규칙(DEV-062·063)
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 해석 순서 4.5에 호스트 비교 필수, 7단계 범위 밖, 커밋 상세의 PR 조인 경로 명시
- [x] `40_delivery/pr_search_work_packages.md` — WP-014 구현 범위·제외 목록에 CR-017 결과 반영, DoD의 QA-W003-03을 도달 불가로 표시
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-060~066 등록
- [x] `apps/search-api`, `packages/es` — 구현은 WP-014 커밋

**SRS는 건드리지 않았다.** FR-SRCH-001~004의 AC는 그대로다. 달라지는 것은 **AC가 요구하는 것을 지금 데이터로 어디까지 채울 수 있는지**를 계약에 정직하게 적은 것뿐이다. 채울 수 없는 필드를 0이나 빈 문자열로 채우는 대신 키를 빼고, 그것이 언제 채워지는지(WP-020·WP-021·WP-024)를 함께 적었다.

**종료 기록 (2026-08-21).** WP-014 구현이 끝났고 검증 결과는 원장 6.14장이다.

| 검증 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 13개, 위반 0건 |
| `pnpm test` (전량) | 611건 통과 + 1건 건너뜀 (real-GHE smoke) |
| `pnpm test:integration` (전량) | 378건 통과 |
| `pnpm build` | 종료 코드 0 |
| 적대적 변이 시험 | 35가지 중 34가지를 시험이 잡음. 나머지 하나는 **동치 변이**(중복 가드 제거)라 잡히지 않는 것이 옳다. 처음 28가지 중 넷이 살아남아 시험을 보강했다 |

**DEV-058(NFR-001 실측)과 DEV-061(`direct_push`)은 열린 채로 남는다.** 전자는 데이터셋이, 후자는 push 이벤트 라우팅(WP-021)이 없다. 나머지 DEV-060·062~066은 해소했다.

**DEV-061은 열린 채로 남는다.** `direct_push`는 커밋 문서를 만드는 경로가 PR 이벤트뿐이라 도달하지 않는다. FR-SRCH-002 AC-3과 QA-W003-03은 **WP-021이 push 이벤트를 라우팅한 뒤에야** 충족된다. 계약과 타입은 그 값을 표현할 수 있게 지금 두어, 값이 생겼을 때 계약을 다시 고치지 않게 했다.

### CR-018 cascade (WP-015 웹 셸 계약 정정)

- [x] `30_technical_architecture/pr_search_frontend_architecture.md` — §10 프록시에서 "사용자 식별 헤더 부착"을 걷어내고 세션 쿠키 전달로 고쳤다 (DEV-067). 클라이언트 안전 import 규칙(DEV-068)과 OIDC 왕복 상태 보관(DEV-071)을 더했다
- [x] `30_technical_architecture/pr_search_infrastructure_operations.md` — 아웃바운드 허용 목록에 `web` → Redis 추가 (DEV-071)
- [x] `40_delivery/pr_search_work_packages.md` — WP-015 구현 범위에 harness 수립과 슬롯 계약 명시 (DEV-069·070)
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-067~072 등록
- [x] `apps/web`, `packages/authz`, `packages/db` — 구현은 WP-015 커밋. `@prs/db`의 마이그레이션 실행기를 `@prs/db/migrate` 서브패스로 옮겼다 (DEV-072)
- [x] `package.json` (루트) — `test:a11y`·`test:e2e`·`test:contrast` 스크립트를 열었다. WP 20곳이 참조하던 이름이 저장소에 처음 존재한다 (DEV-069 / DEV-032)
- [x] `40_delivery/pr_search_implementation_traceability.md` — 구현 중 발견한 **DEV-073·DEV-074**를 추가 등록했다 (아래)

**구현 중에 둘이 더 나왔고, 둘 다 계약 문제가 아니라 내 결함이다.**

- **DEV-073 — 좁은 화면에서 내비게이션에 닿을 수 없었다.** Conductor는 800px 이하에서 사이드바를 감추고 내비게이션을 서랍으로만 여는데, `AppShell`은 여는 상태만 넘겨 주고 **버튼은 앱이 낸다.** 그것을 빠뜨려 마우스로도 키보드로도 도달 불가였다(QA-COMMON-06, NFR-007). Conductor `TopBar`의 `menuButton` 슬롯이 이미 그 자리이고 중단점도 사이드바와 같으므로, CSS도 아이콘 라이브러리도 더하지 않고 슬롯을 채워 해소했다. 함께 나온 포커스 복귀 문제(비모달 Radix Dialog는 트리거로 되돌리지 않는다)는 `@radix-ui`를 직접 의존하지 않기 위해(QA-COMMON-17) 앱 쪽에서 처리했다.
- **DEV-074 — 프록시의 세션 판정이 검증되지 않은 채 초록이었다.** e2e 환경에 Redis가 없어 503이 401을 가렸고, 세션 검사를 통째로 없애도 시험이 잡지 못했다. 판정을 순수 함수로 떼어 저장소 없이 네 갈래를 전부 걸도록 고쳤다. **변이 시험이 아니었으면 찾지 못했다.**

**SRS는 건드리지 않았다.** FR-AUTH-001과 NFR-007은 그대로다. 달라지는 것은 **두 문서가 서로 다른 말을 하던 자리**(프록시의 신원 전달)와 **아무도 정하지 않은 자리**(클라이언트 import 경계, 왕복 상태 보관, 네트워크 허용 목록, 단축키 대상)를 정한 것뿐이다.

**DEV-067은 문서 쪽이 틀렸다.** 구현(WP-012)이 옳고 프런트엔드 문서가 낡았다. 코드를 문서에 맞추지 않고 문서를 고쳤다 — `search-api`가 헤더를 믿기 시작하면 클러스터 안 무엇이든 신원을 위조할 수 있기 때문이다.

### CR-019 cascade (WP-016 W-001 계약 정정)

- [x] `20_derived_ui_specs/pr_search_ui_component_spec.md` — C-010 `recentQueries`를 선택으로(DEV-079), C-012에 `not_computed` 상태와 세 경우 구분 추가(DEV-076), C-014의 `space`·`epoch`를 널 허용으로 바꾸고 `not_computed` 추가(DEV-077)
- [x] `20_derived_ui_specs/pr_search_wireframe_spec.md` — 관계 배지 열의 소유권 명시(DEV-081), 패싯 세 경우 구분(DEV-076), 시퀀스 미채번(DEV-077), `from_q` 진입 경로(DEV-078)
- [x] `30_technical_architecture/pr_search_api_contracts.md` — `facets`·`facets_omitted`의 세 경우를 표로 명시(DEV-076). JSON 예시는 건드리지 않았다 — 주석을 넣으면 유효하지 않은 JSON이 된다
- [x] `40_delivery/pr_search_work_packages.md` — WP-016 DoD에서 `QA-W001-14`를 절반으로 가르고(DEV-075) WP-032에 나머지 절반 명시, `limit=50`(DEV-080)과 관계 배지 제외(DEV-081) 추가
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-075~081 등록
- [x] `apps/web` — 구현은 WP-016 커밋

**SRS는 건드리지 않았다.** FR-SRCH-001·004·005·006·007은 그대로다. 달라지는 것은 **한 QA 항목이 두 WP에 배정된 자리**(DEV-075), **계약과 구현이 다른 자리**(DEV-076·080), **아무도 정하지 않은 자리**(DEV-077·078·079·081)뿐이다.

**DEV-075는 문서끼리 어긋난 것이다.** WP-016은 커서 페이징을 제외한다고 적어 놓고 커서를 요구하는 QA 항목을 완료 기준으로 인용했다. 항목을 통째로 미루지 않고 **절반만 지금 세운 이유**는, "페이지 번호 UI를 두지 않는다"가 **금지 규칙**이기 때문이다 — 나중에 검사하면 이미 잘못 만든 뒤다.

**DEV-077은 화면이 거짓을 말할 뻔한 것이다.** 시퀀스가 `null`인 것을 명세의 `unassigned`(미머지)로 그리면 **머지된 PR이 "머지되지 않았다"로 표시된다.** 조사 도구에서 가장 나쁜 종류의 오류라 상태를 하나 더 만들었다.

### CR-020 cascade (WP-017 W-002 계약 정정)

- [x] `20_derived_ui_specs/pr_search_ui_component_spec.md` — C-018 `totalCount`를 널 허용으로(DEV-083), C-022 `TimelineStep`에 네 상태 추가(DEV-084), C-023 `externalUrl`을 널 허용으로(DEV-086)
- [x] `20_derived_ui_specs/pr_search_wireframe_spec.md` — `W-002-COMMITS` 절삭 표기(DEV-082), `W-002-OVERVIEW` 리뷰 상태를 둘로(DEV-085), `W-002-TIMELINE` 네 상태(DEV-084), `epoch_stale`을 만들지 않음을 구현 메모에 명시(DEV-087), `W-002-HEADER`·`W-002-OVERVIEW`에 보관·파일 절삭 표시 추가(DEV-089)
- [x] `40_delivery/pr_search_work_packages.md` — WP-017 DoD에서 `QA-W002-03`을 절반으로 가르고(DEV-082) `QA-W002-17`도 절반으로(DEV-088), `epoch_stale` 제외 명시(DEV-087)
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-082~089 등록, 6.17장 검증 기록
- [x] `apps/web` — 구현은 WP-017 커밋

**SRS는 건드리지 않았다.** FR-SRCH-003·FR-STAT-003·FR-STAT-004·FR-ING-007·FR-ING-009는 그대로다. 달라지는 것은 **명세가 요구하는 필드의 데이터가 아직(또는 영영) 없는데 타입이 그것을 표현하지 못하던 자리**(DEV-083·084·085·086)와 **아무도 표시하라고 적지 않은 자리**(DEV-089)뿐이다.

**여덟 중 여섯이 같은 한 문장으로 모인다 — 화면이 모르는 것을 아는 척하지 않는다.** 절삭된 커밋 수를 배열 길이로 쓰면 "정확히 250건"이라는 거짓이고(DEV-082·083), 승인 시각을 모른다고 `pending`으로 그리면 승인된 PR이 "승인 대기"가 되며(DEV-084), 저장하지 않은 리뷰 상태를 "변경 요청"으로 지어내고(DEV-085), 구성되지 않은 GHE 링크를 눌러도 아무 데도 가지 않는 버튼으로 두고(DEV-086), 잘린 파일 목록을 온전한 것처럼 세는 것(DEV-089)이 전부 같은 결함이다. **조사 도구에서 이것은 기능 부재보다 나쁘다** — 사용자가 그 값을 근거로 결론을 내린다.

**DEV-087은 만들지 않기로 한 것이다.** `epoch_stale`은 도달 경로가 없어 검증할 수 없다. CR-018 DEV-073에서 도달 불가능한 분기를 시험 가능하게 바꾸고, CR-019에서 도달 불가능한 지름길을 지운 것과 같은 판단이다.

### CR-021 cascade (WP-018 W-003 계약 정정)

- [x] `20_derived_ui_specs/pr_search_ui_component_spec.md` — C-024에 복사 실패 경로와 실패 알림 추가(DEV-096), C-025의 `totalCount`를 널 허용으로(DEV-094)
- [x] `20_derived_ui_specs/pr_search_wireframe_spec.md` — `W-003-HEADER`에서 메시지·작성자·시각을 빼고 **PR에서 빌려오지 않음**을 명시(DEV-090), `W-003-PATHS` 골격화와 파일 내용 미표시(DEV-094), `no_sequence` 판정을 역할 기준으로(DEV-092), 머지 커밋 링크의 출처(DEV-091), `reason_code`를 직접 푸시로 부르지 않음(DEV-093)
- [x] `20_derived_ui_specs/pr_search_screen_state_matrix.md` — `enrichment_pending`의 뜻 정정(DEV-095), `no_pr`의 두 갈래 구분(DEV-093), `no_sequence` 판정 근거(DEV-092)
- [x] `30_technical_architecture/pr_search_api_contracts.md` — `API-SRCH-002`의 `pull_requests[]`에 `merge_commit_sha` 추가와 그 이유(DEV-091)
- [x] `40_delivery/pr_search_work_packages.md` — WP-018 구현 범위에 DEV-090·091·092·093·094와 관문 통합 추가, DoD에서 `QA-W003-03`을 절반으로 가름
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-090~097 등록, 6.18장 검증 기록
- [x] `apps/web`, `apps/search-api` — 구현은 WP-018 커밋

**SRS는 건드리지 않았다.** FR-SRCH-002·FR-SEQ-001·FR-ING-004·FR-SRCH-001은 그대로다. 달라지는 것은 **명세가 요구하는 필드의 데이터가 없는데 타입이 그것을 표현하지 못하던 자리**(DEV-090·091·094)와 **판정 근거가 사라진 자리**(DEV-092·093·095), **실패 경로가 비어 있던 자리**(DEV-096), 그리고 **아예 만들지 않은 자리**(DEV-097)다.

**여덟 중 다섯이 같은 한 문장으로 모인다 — 화면이 모르는 것을 아는 척하지 않는다.** 커밋 메시지 자리에 PR 제목을 넣으면 원본 커밋 N건이 전부 같은 제목이 되어 체리픽 조사가 반대 결론에 이르고(DEV-090), 시퀀스가 `null`이라고 머지 커밋까지 "체인 밖"으로 그리면 거짓이며(DEV-092), "아직 못 이었다"를 "직접 푸시"로 쓰면 **PR 리뷰를 거치지 않은 커밋**이라는 없는 사실을 주장하고(DEV-093), 세지 않은 파일 수를 `0`으로 그리면 *빈 커밋*과 구분되지 않으며(DEV-094), 복사 실패를 조용히 넘기면 사용자가 **잘못된 SHA를 붙여넣는다**(DEV-096).

**DEV-097은 운영 중인 결함이었다.** 흐름 명세가 "가장 중요한 흐름"이라 부르는 FLOW-001의 4단계가 구현되어 있지 않아, **40자 SHA를 붙여넣으면 화면이 영원히 멈췄다.** CR-019 DEV-078이 그 이동을 위해 `from_q`까지 정해 두었는데 이동 자체가 없었다는 것이, 계약을 갖추는 것과 그것을 쓰는 것이 다른 일임을 보여 준다. WP-018의 DoD("FLOW-002 전 경로 E2E")를 쓰지 않았으면 드러나지 않았다.

### CR-022 cascade (WP-019 저장소 백필 계약 정정)

- [x] `30_technical_architecture/pr_search_api_contracts.md` — **`API-ADM-002` 상세 절을 새로 썼다**(없었다, DEV-103). `GET`/`POST`/`PATCH`, `cursor` 미노출, 한도 대기의 표현, 상한을 넘겨도 `POST`를 거절하지 않는 이유
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — `JOB-ING-004`의 실행이 이벤트가 아니라 `job` 행임을 명시(DEV-101), 합성 델리버리 ID의 모양과 이유(DEV-100)
- [x] `30_technical_architecture/pr_search_data_model.md` — `document_version`의 출처를 경로별 표로 갈랐다(DEV-099), `refresh_interval` 복원 책임(DEV-105)
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 백필 중 색인 설정의 구체값과 복원 규칙(DEV-105)
- [x] `40_delivery/pr_search_work_packages.md` — WP-019 구현 범위에 DEV-098~105를 반영
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-098~105 등록, 6.19장 검증 기록
- [x] `packages/github`, `packages/db`, `apps/pipeline-worker`, `apps/search-api` — 구현은 WP-019 커밋

**SRS는 건드리지 않았다.** FR-ING-006·FR-ING-005·FR-ADMIN-002·NFR-002는 그대로다. 달라지는 것은 **수단이 아예 없던 자리**(DEV-098·101·102·103)와 **실시간 수집과 부딪히는 자리**(DEV-099·100·104·105)뿐이다.

**여덟 중 넷이 "백필이 실시간을 이기면 안 된다"는 한 문장으로 모인다.** 문서 버전을 지금 시각으로 두면 백필이 언제나 덮어쓰고(DEV-099), 델리버리 ID가 무작위면 실패 대기열이 같은 실패로 가득 차며(DEV-100), 한도 대기를 `paused`로 표현하면 자동 재개가 운영자의 중단을 되살리고(DEV-104), `refresh_interval`을 복원하지 않으면 인덱스가 영구히 느려진다(DEV-105). 넷 다 **백필이 조용히 이기는** 모양이다.

**DEV-099의 해법이 이 CR에서 가장 값싸다.** AC-5("백필이 실시간을 덮어쓰지 않는다")를 지키는 코드를 따로 쓰지 않았다 — 백필의 버전을 엔티티 `updated_at`으로 두니 **이미 있는 조건부 업서트가 저절로 거절한다.** 규칙을 강제하는 분기는 그 분기가 틀렸을 때 조용히 어긋나지만, 산술은 틀릴 자리가 없다.

| CR-025 | 2026-08-23 | correction | WP-021 착수 전 시퀀스 채번 계약 감사에서 확인된 DEV-115~120 | **이 제품의 핵심 값을 쓰려는데, 그 값을 만들 재료 하나와 그것을 부를 사람이 없다.** `merge_sequence.committed_at`은 `NOT NULL`인데 WP-020이 낸 그래프 계층은 SHA만 주고 커밋 시각을 주는 잡(JOB-MIR-002)은 아직 todo다(DEV-115). 그리고 JOB-SEQ-001의 트리거인 `push` 이벤트는 게이트웨이가 `prs:ingest`에 싣고 `enrich`가 "PR 이벤트가 아니다"로 버린다 — **`prs:sequence`에 무언가를 싣는 코드가 어디에도 없다**(DEV-116). 여기에 `pull_request_number`의 출처 미정의(DEV-118)와 `bus.requeueLater()`라는 없는 포트(DEV-117)가 겹친다. **가장 조용한 것은 DEV-119다** — 데이터 모델 질의 표가 범위 조회를 `term(sequence_space)`로 거르는데 그 값은 `acme/payments@main` 같은 표시용 문자열이라, 저장소 이름이 바뀌면 같은 공간이 두 문자열로 갈라져 **범위 조회가 조용히 절반만 돌려준다.** 이 제품의 핵심 산출물이 틀리는데 아무 오류도 나지 않는다 | DEV-115~120, FR-SEQ-001, FR-SEQ-002, ADR-005, ADR-007, JOB-SEQ-001, EVT-SEQ-001, ENT-SEQ-001 | ADR 문서, 백엔드 아키텍처, 데이터 모델, 비동기·잡 카탈로그, API 계약, 릴리스 검증 계획, 작업 패키지, 원장 | closed |
| CR-026 | 2026-08-23 | correction | WP-022 착수 전 재채번 계약 감사에서 확인된 DEV-124~129 | **재채번이 딛고 설 함수 둘이 없고, 의사코드가 성공을 가정한 자리 둘이 실제로는 실패할 수 있다.** 백엔드 4.3의 `copySequencesUpTo`·`getSeqByCommit`은 리포지터리에 없다(DEV-124). `mergeBase`가 first-parent 체인 **밖**의 커밋을 줄 수 있는데 의사코드는 그 SHA로 서수를 찾는 데 무조건 성공한다고 가정한다(DEV-125) — 못 찾으면 **처음부터 전체 재채번**으로 폴백한다: first-parent walk가 결정론이라 히스토리가 같은 구간은 같은 서수가 재현된다. `invalidateSafeMarkers`는 쓸 수단이 스키마에 없다(DEV-126) — AC-4 후반부가 이미 답을 정의한다: 표식·세션·인용은 `seq_epoch`를 저장하므로 **현재 에폭과 비교해 계산**하면 되고 저장 시점 쓰기가 필요 없다. 저장된 검색 `seq:` 무효화는 `saved_search` 테이블 자체가 없어(REL-004) 도달 불가. 알림 어댑터도 없어(DEV-127, DEV-026과 같은 사정) EVT-SEQ-002 발행 + 감사 기록으로 AC-5를 성립시킨다. 잡 스키마의 `sequence_assign`과 API 계약의 `sequence_reassign`이 불일치한다(DEV-128, WP-028 몫). ES에 에폭 전환을 비출 수단이 없다(DEV-129) — SHA 목록 기반 `applySequenceToDocuments`로는 저장소 전체의 `seq_epoch`를 못 올린다 | DEV-124~129, FR-SEQ-005, ADR-007, JOB-SEQ-002, EVT-SEQ-002, API-ADM-007, ENT-SEQ-001·002 | 백엔드 아키텍처, 데이터 모델, 작업 패키지, 원장 | closed |

| CR-027 | 2026-08-23 | correction | WP-023 착수 전 앵커·범위 조회 계약 감사에서 확인된 DEV-130~140 | **범위 조회의 정답지를 파생 뷰에서 읽으려 한다.** 데이터 모델 8장 성능표는 시퀀스 범위 조회를 `prs-pull-requests`의 `range(merge_seq)`로 적었으나 서수의 정본은 PostgreSQL `merge_sequence`이고 (ADR-004) WP-021의 채번은 PostgreSQL 커밋 뒤 ES에 비춘다 — 비추기가 실패하면 ES `range`는 **아무 오류 없이 적게 돌려준다**(DEV-130). 그것이 이 제품이 존재하는 이유인 "범위 인용"이 조용히 틀리는 모양이다. 같은 표가 인용한 `index.sort` 조기 종료도 성립하지 않는다 — 색인 정렬은 `merge_seq` **내림차순**인데 FR-SEQ-002는 오름차순을 요구한다(DEV-131). **릴리스 태그 앵커는 지금 해석할 수 없다** — `prs-releases`에 쓰는 경로가 없고(WP-024), 미러도 근거가 못 된다: `clone --mirror`는 태그를 가져오지만 이후 `fetch --prune --no-tags`가 갱신하지 않아 오래된 저장소에서만 우연히 맞는다(DEV-132). `reverted_pull_request_count`는 되돌림 파생(WP-030) 이전에는 언제나 0이 나오고 그 0은 "되돌림이 없다"와 구분되지 않는다(DEV-133). `top_changed_paths`의 값 단위(DEV-134), 절삭된 파일 목록의 합계(DEV-135), `q`와 요약의 관계(DEV-136), 공간이 없는 저장소(DEV-137), `next_cursor`(DEV-138), `commit_count`의 뜻(DEV-139), "사전 추정"이 실은 정확히 셀 수 있다는 것(DEV-140)이 나머지다 | DEV-130~140, FR-SEQ-002, FR-SEQ-003, ADR-004, ADR-007, API-SEQ-001·002, ENT-SEQ-001·002 | API 계약, 데이터 모델, 백엔드 아키텍처, 작업 패키지, 원장 | closed |

### CR-024 반영 내역 (2026-08-22)

- [x] `10_requirements/srs_final.md` — **v2.3.** OD-001·OD-002·OD-004를 `resolved`로, 4.2장 조건부 범위 표 정리. FR-REL-005 AC-2·AC-5 정정(DEV-111), FR-ADMIN-001 AC-1·AC-3 정정, FR-AUTH-002 AC-5에 예외 명시(DEV-051)
- [x] `10_requirements/prd.md` — **v1.1.** 12장 OD 표 셋을 `resolved`로, 5.2장 조건부 범위 표 정리, 남은 open 둘의 기한 상태 명시
- [x] `30_technical_architecture/pr_search_architecture_decision_records.md` — ADR-005(운영 기본값 확정, 사유 3종, 폴백은 영구 경로), ADR-008(`allowed_team_ids` 소유권, 파이프라인 건강 집계 예외)
- [x] `30_technical_architecture/pr_search_security_privacy_architecture.md` — THR-003·THR-015·THR-016
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — **`JOB-MIR-002` 신설**과 3.1장 상세, 9장 스케줄
- [x] `30_technical_architecture/pr_search_data_model.md` — `repository.allowed_team_ids` + GIN 색인, 3.3장 소유권 문단, `patch_id_unavailable` 타입 정정
- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-ADM-006에 `slowest_repositories_out_of_scope`, 커밋 상세 §의 DEV-112 문단을 WP-067로 갱신
- [x] `40_delivery/pr_search_implementation_roadmap.md` — 선행 조건 표의 OD 셋, REL-003 슬라이스 행
- [x] `40_delivery/pr_search_work_packages.md` — **WP-067·WP-068 신설**, WP-020 제외 항목 갱신, REL→WP 커버리지 (66 → 68)
- [x] `40_delivery/pr_search_implementation_traceability.md` — **v0.7.** DEV-051·DEV-112 해소, DEV-111 확정 추가, **DEV-114 신규**, WP-067·068 행, 7장·8장
- [x] `packages/es/src/mappings/commits.ts` — `patch_id_unavailable`을 `boolean` → `keyword`. **아직 아무도 쓰지 않는 필드라 데이터 이관이 없다**

**결정의 근거를 전부 문서 안에서 찾았다.** OD-002는 FR-AUTH-002 AC-1 자신이 접근 범위를 "GHE에서 read 이상 권한을 가진 저장소 집합"으로 정의하므로 GHE 권한이 정의 그 자체다. OD-004는 "시퀀스는 `git log --first-parent`로 검증 가능해야 한다"(ADR-007)는 불변식이 그래프 밖 앵커를 배제한다. OD-001은 WP-020의 실측(blob 0건)이 THR-015의 우려를 직접 반증한다. **근거가 문서에 없는 값은 하나뿐이고 그것을 명시했다** — OD-002 재검토 임계 1,000 저장소는 파생값이 아니라 이 결정이 고른 값이다.

**결정 넷은 무언가를 넓히는 대신 좁혔다.** FR-REL-005 AC-2는 조건부가 되었고, FR-ADMIN-001 AC-3은 접근 범위 안으로 줄었으며, OD-004는 앵커 소스 하나를 제외했고, `MIRROR_ALLOW_BLOB_FETCH` 기본값은 기능을 끈 쪽이다. **구현이 못 하는 것을 명세가 요구하는 상태로 두지 않는 것이 이 CR의 목적이다** — 특히 FR-REL-005 AC-2는 "구현했는데 안 돈다"가 아니라 "조건부로만 돈다"가 되었다.

**두 갈래를 구분한 것이 DEV-051의 핵심이다.** "운영 집계는 예외"로 뭉뚱그리면 다음에 들어올 저장소별 집계가 조용히 따라 들어온다. 예외의 경계를 **저장소 식별자의 유무**에 두었으므로 아키텍처 테스트가 그 경계를 검사할 수 있다.

**DEV-114는 이 CR이 찾아낸 것이다.** `allowed_team_ids`의 소유권을 정하려고 코드를 확인하다가, 매핑 넷이 선언하고 강제 필터가 읽는 그 필드를 **아무도 쓰지 않는다**는 사실이 드러났다. 통합 시험이 문서를 손으로 심으면서 그 필드를 직접 넣기 때문에 초록이 나온다 — **초록이 곧 검증은 아니다**의 또 한 사례다.

| CR-042 | 2026-08-26 | correction | WP-031 착수 전 관계 조회·상세 화면 계약 감사에서 확인된 DEV-248~265 | **파생은 섰는데 그것을 읽을 경로가 없다. 그리고 읽는 순간 접근 통제의 축이 바뀐다.** 열여덟 중 **아홉이 같은 뿌리**다 — 계약이 *파생*의 규칙만 정하고 *조회*가 다른 질문이라는 것을 보지 않았다. 파생은 요청자가 없어 source 저장소 안에서 끝나지만, 조회는 **요청자가 있고 대상 쪽을 본다.** (1) **저장된 간선을 사용자에게 줄 API가 하나도 없다.** API-REL-001(`/sequence-neighbors`)·002(`/containments`)·005(`/releases`)는 `prs-links`를 읽지 않고, 003은 `/co-changes`(조회 시점 계산), 004는 그래프(WP-043)다. WP-031 구현 범위 첫 줄이 "관계 조회(정방향·역방향)"인데 그것을 줄 ID가 없다 — CR-030 DEV-155와 같은 모양이다. `GET /relations`(**API-REL-006**)를 신설한다(DEV-248). (2) **역방향 조회가 source 저장소 라우팅에 묶여 있다.** `findLinksTo`는 `repositoryId`로 라우팅하고 `repository_id`를 term으로 건다. 그런데 **간선은 근거를 소유한 저장소(source)에 산다** — `acme/a`의 PR이 `acme/b#20`을 참조하면 그 간선의 `repository_id`는 a다. b에서 "나를 가리키는 참조"를 물으면 a·c의 간선을 **구조적으로 찾을 수 없다.** 되돌림·체리픽·스택은 동일 저장소 관계라 그 경로에서 둘이 같았고, 그래서 결함이 드러나지 않았다. 조회는 라우팅 없이 `to_type`·`to_id`로 치고 **범위 필터가 경계를 만든다**(DEV-250). (3) **THR-034의 구현 계약이 없고 WP-031 DoD에도 없다.** CR-039가 "WP-031의 필수 수용 기준"이라고 적었으나 선행 조건 문단에만 있고 완료 기준 여덟 항목에는 없다 — 체크되지 않는 수용 기준은 수용 기준이 아니다. 간선과 대상 **식별자**는 source 범위로 충분하지만 대상의 **제목·본문·작성자**를 실으려면 대상 저장소를 다시 교집합해야 한다. 그리고 그 실패는 "권한 없음"이 아니라 **대상 상세를 표시할 수 없음**이라는 일반 상태여야 한다 — 다르게 말하면 존재 여부가 샌다(DEV-253). (4) **worker의 조회 형태를 그대로 HTTP에 쓸 수 없다.** `scrollLinks`는 `search_after`로 **끝까지** 읽어 메모리에 모으고(조정에는 옳다 — 한 페이지만 읽으면 나머지가 영영 조정되지 않는다), `StoredLink`에는 `confidence`·`evidence`·`to_repository_id`·`created_at`이 없다. C-021은 그 셋을 필수로 요구한다. 한 대상을 수천 source가 가리킬 수 있으므로 **응답은 상한을 가져야 한다**(DEV-251·252). (5) **API-REL-003은 카탈로그 한 줄뿐이다.** 상세 절이 없어 자격 판정·후보 선정·순서를 어디에도 적어 두지 않았다. 미머지 PR은 `merged_at`이 없어 ±90일 기준점 자체가 없는데 계약은 그 상태를 말하지 않는다 — `created_at`으로 몰래 대체하면 AC-2가 정한 창이 아닌 다른 창을 계산하게 된다. 후보를 앱에서 자른 뒤 자카드를 계산하면 **진짜 상위 20이 잘린 밖에 남는다.** 겹치는 경로 상위 10의 순서도 정해져 있지 않아 같은 정본이 다른 응답을 낸다(DEV-249·254·255·256). (6) **UI가 WP-030이 만든 사실을 표현할 수단을 갖고 있지 않다.** `detached`는 UI 문서 전체에 **0회** 등장하고 C-021 상태 목록에도 없다 — 해제된 의존을 "관계 없음"으로 그리면 FR-REL-006 AC-3이 보존하려는 사실이 화면에서 사라진다. FR-REL-004 예외가 요구하는 "다중 후보임을 표시"도 어느 문서에도 없어, 첫 후보 하나를 확정처럼 그리는 구현이 계약을 통과한다(DEV-257·261). (7) **`links_pending`의 뜻이 UI 문서에서 드리프트했다.** CR-041이 "참조 추출의 완결 상태"로 확정했는데 FLOW-006·상태 매트릭스·`PrDetailView`는 여전히 "관계 파생 미완료"라고 적고 관계 섹션 **전체**를 가린다. 그러면 이미 계산된 되돌림·체리픽·스택이 참조 실패 하나 때문에 숨는다(DEV-258). (8) **FLOW-006이 승인되지 않은 제품 판단을 적는다.** "체리픽 후보 없음 → **백포트 누락 후보**"는 FR-REL-005 어디에도 근거가 없고, 운영 기본이 `blob_fetch_disabled`라 후보 없음이 **정상**이다(CR-024, DEV-111). 화면이 없는 기능을 지어내지 않는다. 관련 요구사항에서 FR-REL-006·007도 빠져 있다(DEV-259·260). (9) **W-001이 WP-031 범위에서 빠진 채 이월돼 있다.** 와이어프레임과 `ResultTable.tsx` 주석이 둘 다 "관계 배지 열은 WP-031이 붙인다"고 적는데 WP-031 관련 화면은 W-002·W-003뿐이고, 검색 API가 이미 싣는 `link_summary`를 웹 `ResultRow`가 **버린다.** 이월 계약의 누락 정정이지 범위 확장이 아니다(DEV-262·264). 나머지는 W-003에 관계 상태·QA 항목이 없는 것(DEV-263)과, ADR-008 가드레일의 면제가 **파일 단위**라 `links.ts`에 사용자 대면 조회를 넣으면 워커용으로 쓴 면제를 그대로 물려받는다는 것(DEV-265)이다. **제품 범위를 넓히지 않는다 — SRS는 v2.6 유지.** FR-REL-003~007은 이미 조회·표시 동작을 승인하고 있고, 이 CR이 채우는 것은 **조회 경로·접근 통제 축·응답 상한·자격 판정·후보 선정·표시 상태**라는 하위 계약이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건. 새 ADR 없음** — ADR-008이 정한 강제 필터와 ADR-009가 정한 간선 구조를 그대로 쓴다. **새 마이그레이션 없음** — 필요한 데이터는 `prs-links`·`changed_paths.raw`·`changed_files_count`·`merged_at`에 전부 있다 | DEV-248~265, FR-REL-003, FR-REL-004, FR-REL-005, FR-REL-006, FR-REL-007, FR-AUTH-002, API-REL-003, **API-REL-006(신설)**, ENT-REL-002, ADR-008, ADR-009, ADR-010, THR-020, THR-034, C-015, C-021, W-001, W-002, W-003, FLOW-006, QA-W002-10~14·17 | `pr_search_api_contracts.md`, `pr_search_backend_architecture.md`, `pr_search_frontend_architecture.md`, `pr_search_security_privacy_architecture.md`, `pr_search_ui_component_spec.md`, `pr_search_wireframe_spec.md`, `pr_search_screen_flow_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_screen_qa_checklist.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-041 | 2026-08-26 | correction | WP-030 착수 전 되돌림·체리픽·스택 파생 계약 감사에서 확인된 DEV-230~247 | **계약이 source 본문만 보고 후보의 변화를 보지 않는다.** 열여덟 중 **열둘이 같은 뿌리**다 — WP-029가 참조 축에서 만난 "만든다만 있고 다시 만든다가 없다"의 한 겹 아래 형태다. 참조는 source 본문만 보면 되지만 **되돌림 제목 대조·체리픽 patch-id·스택은 다른 엔티티의 상태에 달려 있다**: 같은 제목의 PR이 나중에 하나 더 들어오고, 같은 `patch_id` 커밋이 나중에 나타나며, 상위 PR이 머지된다 — **셋 다 source에는 새 이벤트가 없다**(DEV-242). (1) **방아쇠가 직접 푸시 커밋을 놓친다** — JOB-REL-002·003이 `EVT-ING-003`만 구독하는데 그 이벤트는 `project`가 색인한 문서마다 나고 직접 푸시 커밋 문서는 `project`가 만들지 않는다(DEV-230). 체리픽은 이유가 하나 더 있다: `patch_id`는 커밋 보강이 채우므로 투영 시점에는 아직 없어 `derived` 경로가 언제나 "값 없음"으로 끝난다(DEV-231). (2) **스택 해제의 방아쇠가 반대 방향이다** — 간선은 하위 PR이 소유하는데 해제 조건은 상위 PR이 머지될 때 발생한다(DEV-232). (3) **결정론이 두 곳에서 깨진다** — 체리픽 상위 5건의 순서가 정의되지 않아 같은 정본에서 다른 색인이 나오고(DEV-243), 되돌림 제목 후보가 여럿일 때 하나를 고르면 조사 도구가 **자신 있게 틀린 답**을 낸다(DEV-237·244). (4) **요약 boolean이 간선 하나의 결과로 계산될 위험** — 하나를 지웠다고 `false`를 쓰면 남은 간선을 부정한다(DEV-241). (5) **재구축이 참조 축에서만 성립한다** — JOB-REL-006이 references만 돈다(DEV-234). (6) **후보 탐색이 전체 스캔이다** — 정본에 제목·분기·`patch_id` 인덱스가 없다(DEV-240). 나머지는 문서가 낡았거나(patch-id 세 사유, DEV-235) 소유가 잘못됐거나(QA-W002-11·12는 W-002 화면이므로 WP-031, DEV-236) 완료 기준이 빠진 것(DEV-238·239)이다. **제품 범위를 넓히지 않는다 — SRS는 v2.6 유지.** FR-REL-004~006은 이미 원하는 동작을 승인하고 있고, 이 CR이 채우는 것은 **방아쇠·정체성·후보 순서·조정·조회 경로·완료 기준**이라는 하위 계약이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건. 새 ADR 없음** — 데이터 모델 4.3장이 비참조 간선의 ID 재료를 이미 정해 두었고(CR-039), 이 CR은 그것을 구현 가능하게 만든다. **마이그레이션 014를 만든다** — 새 엔티티 표가 아니라 **후보 조회 인덱스만**이다 | DEV-230~247, FR-REL-004, FR-REL-005, FR-REL-006, FR-SEQ-002 AC-2, FR-SEQ-004 AC-2, JOB-REL-002·003·004·006, EVT-ING-005, ENT-REL-002, ADR-004, ADR-009, THR-034, THR-035, QA-W002-11·12 | `pr_search_async_events_jobs.md`, `pr_search_data_model.md`, `pr_search_api_contracts.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-040 | 2026-08-26 | decision | OD-005의 기한(REL-004 착수 전)이 도래했다 — WP-029 완료로 REL-004가 이미 시작됐다 | **`nori`를 초기 REL-004 의존성으로 채택하지 않는다.** 기한이 도래한 오픈 결정 하나를 닫는다. WP-032 전문 검색은 SRS 4.2가 **이미 승인한 대체 경로**(`standard` 분석기 + `edge_ngram` 부분 일치 필드)로 구현한다. **근거 넷.** (1) **FR-SRCH-011은 `nori`를 요구하지 않는다** — AC-4는 "한글과 영문이 섞인 질의에서 두 언어 토큰이 모두 매칭 대상이 된다"이고, 이는 분석기 구현을 지정하지 않는 행위 기준이다. 대체 구성으로도 검증 가능하다는 것이 OD-005 자신의 "차단하는 FR: 차단 없음" 항목이다. (2) **대체 경로는 이미 승인돼 있다** — 4.2 조건부 범위가 조건 미충족 시 대체 구현을 명시했으므로 이 결정은 승인된 두 갈래 중 하나를 고르는 것이지 범위를 바꾸는 것이 아니다. (3) **운영 게이트가 먼저다** — REL-003 릴리스 게이트 4·5·6이 미통과이고 성능 목표 7종은 `NOT RUN`이다(DEV-058). 플러그인은 클러스터 수준 설정이라 3노드 전체의 설치·업그레이드·재기동 절차를 요구하는데(인프라 8장, OD-006), **아직 검증되지 않은 운영 기반 위에 외부 의존성을 먼저 얹지 않는다.** (4) **되돌릴 수 있는 결정이다** — `TEXT_ANALYZER` 안정 이름(`text_ko_en`)을 유지하므로 매핑 4종은 토크나이저 교체에 영향받지 않는다. **재검토 조건 셋을 함께 확정한다(AND).** ① Platform이 운영 ES 3노드에 대한 플러그인 설치·업그레이드·재기동 운영을 승인한다 ② 한국어 relevance 벤치마크에서 현재 대체 경로 대비 유의미한 개선이 **실측**된다 ③ 재색인·롤백 절차가 검증된다. 셋이 모두 충족되면 별도 CR로 연다. **`edge_ngram` 부분 일치 필드의 구현은 WP-032 소관이며 이 CR은 코드를 만들지 않는다.** **신규 FR·NFR 없음, 안정 ID 재번호화 0건.** PRD의 "n-gram" 표기를 SRS의 `edge_ngram`으로 정밀화했다 — 두 문서가 같은 대체 경로를 다르게 부르고 있었다 | OD-005, FR-SRCH-011, NFR-003, WP-032, ADR-003 | `srs_final.md`, `prd.md`, `pr_search_data_model.md`, `pr_search_infrastructure_operations.md`, `pr_search_implementation_roadmap.md`, `pr_search_ai_agent_implementation_request.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |
| CR-039 | 2026-08-26 | correction | WP-029 착수 전 참조 간선 계약 감사에서 확인된 DEV-215~229 | **지금 계약대로 구현하면 간선은 한 번 만들어지고 그 뒤로 영원히 어긋난다.** 열다섯 중 다섯이 같은 뿌리다 — 계약이 **"만든다"만 말하고 "다시 만든다"를 말하지 않는다.** 참조는 본문에서 파생되는데 본문은 수정되고, 대상은 나중에 색인되며, 과거 데이터는 이벤트를 남기지 않았다. 제품 범위를 넓히지 않고 이미 승인된 FR-REL-003을 실제로 성립시킨다. **SRS는 v2.5 유지.** (1) **직접 푸시 커밋은 참조 파생에 도달하지 않는다.** JOB-REL-001·JOB-REL-005의 방아쇠가 `EVT-ING-003` 하나인데, 그 이벤트는 `project` 워커가 색인한 문서마다 낸다. WP-067이 새로 만드는 직접 푸시 커밋 문서는 그 경로를 지나지 않고 `commit-enrich`가 만든다 — 그 파일에는 `bus.subscribe`가 하나 있고 **`bus.publish`가 하나도 없다.** CR-038이 DEV-206에서 잡은 것과 **정확히 같은 모양이 한 홉 아래에 남아 있었다.** `EVT-ING-005 commit.metadata_ready`를 신설해 정본·색인이 모두 성공한 뒤에만 낸다. payload는 bounded 식별자뿐이고 메시지 본문을 버스에 다시 싣지 않는다 — link 워커가 `commit_snapshot`에서 읽는다 (DEV-215). (2) **그 이벤트를 `prs:projected`에 실으면 되먹임이 생긴다.** `commit-enrich`가 그 토픽을 `link:commit-enrich` 그룹으로 읽고 있어 자기가 낸 이벤트를 자기가 받는다. 토픽을 새로 만들지 않고 **`event_name`으로 가른다** — 각 소비자가 자기 입력 이벤트만 처리하고, 보강은 metadata-ready를 받아 metadata-ready를 다시 내지 않는다. 되먹임 없음을 시험으로 건다 (DEV-216). (3) **`link_id`가 가변 `to_id`를 포함해 AC-3과 충돌한다.** 규칙은 세 곳에 같은 문장으로 적혀 있다 — 데이터 모델 4.3, `packages/es/src/mappings/links.ts`, `packages/domain/src/entities.ts`. `Refs: abc1234`가 미해결로 저장된 뒤 대상이 색인되면 `to_id`가 축약 SHA에서 40자 SHA로 바뀌고 **`link_id`가 함께 바뀐다.** 그러면 미해결 간선과 해결된 간선이 **둘 다 남는다** — AC-3(같은 간선을 갱신)·멱등·결정론적 ID 셋이 한 번에 깨진다. `references` 간선에 **해결 대상과 독립인 안정 식별자 `reference_key`**를 둔다. 원문 문자열이 아니라 **정규화된 locator**이며, 대상이 해결돼도 바뀌지 않는다. 안정 ID는 `link_type` + source identity + `reference_key`로 만든다 (DEV-217). (4) **커밋 매핑에 `links_pending`이 없다.** FR-REL-003의 예외 처리는 "추출 실패는 색인을 막지 않고 문서에 `links_pending: true`를 표시한다"인데, 요구사항이 PR **또는 커밋**을 대상으로 하면서 커밋 매핑에는 그 필드가 선언되어 있지 않다. 매핑이 `strict`라 표시 자체가 THR-010으로 거부된다 — 즉 커밋에 대해서는 승인된 예외 처리를 **표현할 수단이 없다** (DEV-218). (5) **커밋 매핑 `link_summary`에 `reference_count`가 없다.** PR 매핑에는 있다. 커밋 상세(W-003)가 참조 수를 간선 인덱스 조회 없이 그릴 수 없다 (DEV-219). (6) **본문에서 사라진 참조를 지울 계약이 없다.** 계약은 "추출하여 간선을 생성한다"까지다. PR 본문이 `Refs: #10`에서 `Refs: #20`으로 바뀌면 `#20`이 생기지만 **`#10`이 그대로 남는다.** 한 source의 references 간선은 **완전한 파생 집합**으로 취급한다 — 정본에서 완전한 집합을 다시 만들고, 없어진 것은 제거하는 reconcile이다. 단 **추출이 실패한 회차는 제거를 하지 않는다**: 부분 결과를 완전한 결과로 확정하면 멀쩡한 간선이 사라진다 (DEV-220). (7) **과거 엔티티에 간선을 만들 경로가 없다.** 새 `link` consumer group은 Redis stream을 `0`부터 읽을 수 있지만 **stream retention은 정본이 아니고**, 직접 푸시 커밋에는 애초에 `EVT-ING-003`이 없었다. 배포 뒤 "새 이벤트부터만 관계가 생김"이 운영 구멍으로 남는다 — CR-037이 DEV-194에서 PR 스냅숏 축에 대해 이미 겪은 자리다. 이미 카탈로그에 있는 **JOB-REL-006(관계 전량 재파생)**을 references subset에 대해 실제로 실행 가능하게 만든다. 두 번째 추출 알고리즘을 만들지 않는다 (DEV-221). (8) **`link_summary`의 필드별 소유자가 없고 부분 갱신 수단도 없다.** 매핑에는 다섯 leaf가 있고 그중 넷이 WP-030 것이다. 그런데 `bulkUpsert`의 조건부 스크립트는 `ctx._source[key] = value`로 **객체를 통째 대입**하므로, WP-029가 `link_summary`를 그대로 쓰면 WP-030이 써 둔 값을 지운다. leaf 단위로 대입하는 전용 경로를 둔다 — CR-038의 `COMMIT_METADATA_SCRIPT`가 같은 이유로 만든 선례다. WP-029가 소유하는 leaf는 **`reference_count` 하나**다 (DEV-222). (9) **`to_repository_id`·`detached`를 누가 채우는지 정의되어 있지 않다.** 매핑에는 선언되어 있다. `to_repository_id`는 WP-029(대상 저장소가 해석된 시점), `detached`는 WP-030으로 명시한다. WP-029가 `detached: false`를 기계적으로 채워 미래 필드를 선점하지 않는다 — `strict` 매핑에서 값을 두지 않는 것과 `false`를 두는 것은 다른 주장이다 (DEV-223). (10) **저장소를 건너뛰는 참조의 접근 통제 경계가 문서에 없다.** `acme/a`의 PR이 `acme/b#20`을 참조하면 간선은 a의 접근 범위로 저장된다 — 그것이 맞다(근거를 소유한 저장소가 a다). 그러나 그 간선이 `to_repository_id: b`를 들고 있으므로, **관계 조회 API(WP-031)가 대상의 제목·본문을 함께 반환하면 b를 볼 수 없는 사용자에게 b의 내용이 샌다.** WP-029는 조회 API를 만들지 않으므로 지금 유출은 없지만, **경계를 지금 적어 두지 않으면 WP-031이 그것을 모른 채 만든다** — CR-036이 WP-068에서 겪은 것과 같은 종류다. THR-034~036을 신설한다 (DEV-224). (11) **`@prs/domain`의 관계 타입 셋이 실제 매핑과 어긋난다.** `LinkSummary`는 `reverted_by_count`를 선언하는데 매핑에는 없고, 매핑의 `is_reverted`·`has_stack`은 타입에 없다. `CommitRole`은 `'merge' | 'original'`인데 실제 값은 `merge_commit`·`source_commit`·`direct_push`이며 — `documents.ts`가 **자기 `CommitRole`을 따로 정의해 쓰고 있어** 타입 검사가 그 드리프트를 잡지 못했다. `Link`에는 접근 통제 필드 넷과 `to_repository_id`·`detached`·`created_at`이 없다. 제품 의미에 필요한 만큼만 맞춘다 — ES 구현 detail을 전부 복사하지 않는다 (DEV-225). (12) **ADR-009 자신이 구현과 어긋난다.** Decision 블록의 간선 문서 구조에 `direction`이 있으나 매핑에 없고, 접근 통제 필드 넷과 `to_repository_id`·`detached`가 없다. `link_summary` 목록도 `reverted_by_count`를 적는다. 기존 결정을 뒤집는 것이 아니라 **적힌 것을 구현된 것에 맞추는 정정**이므로 새 ADR을 만들지 않고 ADR-009를 개정한다. `reference_key`는 ADR-009가 이미 결정한 "미해결 참조를 간선 1건 갱신으로 해결한다"를 **성립시키는 수단**이지 다른 결정이 아니다 (DEV-226). (13) **`link` 모듈이 API-REL-001~004 전체를 소유한다고 적혀 있으나 사실이 아니다.** API-REL-001(`/sequence-neighbors`)은 WP-027이 `sequence` 경로로, API-REL-002(`/containments`)는 WP-024가 릴리스 경로로 이미 구현했다. 문서가 초기 설계를 계속 사실처럼 말하면 다음 WP가 그것을 근거로 잘못된 자리에 코드를 넣는다 (DEV-227). (14) **`retry` 처분에 재시도 예산을 집행하는 주체가 없다.** 잡 카탈로그는 JOB-REL-001·005의 재시도를 3회로 적지만, Redis·in-memory 두 어댑터 모두 `retry`를 받으면 백오프만 늘리고 **횟수 상한을 보지 않는다.** 예산은 핸들러가 `delivery_count`로 집행하는 것이 이 저장소의 실제 관용구다(`authz.ts`가 그렇게 한다). 계약에 그 사실을 명시한다. **그리고 `release.ts`의 JOB-REL-007이 실제로 그 상태다** — 영구 실패가 무한 재시도되며 파티션을 막는다. PR #30의 P1 지적이 미해결로 남아 있었고 재실측으로 확인했다. 같은 함정을 link 핸들러에 다시 파지 않기 위해 계약과 기존 결함을 함께 고친다 (DEV-228). (15) **`pr_search_work_packages.md` 헤더가 `v0.3 / 2026-08-20`에 멈춰 있다.** 내용은 2026-08-26까지 갱신됐다. 상태표를 근거로 판단하는 후속 에이전트가 문서가 낡았다고 오판한다 (DEV-229). | DEV-215, DEV-216, DEV-217, DEV-218, DEV-219, DEV-220, DEV-221, DEV-222, DEV-223, DEV-224, DEV-225, DEV-226, DEV-227, DEV-228, DEV-229, FR-REL-003, JOB-REL-001, JOB-REL-005, JOB-REL-006, JOB-REL-007, EVT-ING-003, EVT-ING-005, ENT-REL-002, ENT-CORE-003, API-REL-001, API-REL-002, ADR-004, ADR-008, ADR-009, THR-034, THR-035, THR-036, WP-029 | 데이터 모델, 비동기·잡 카탈로그, ADR, 백엔드 아키텍처, 보안·프라이버시, API 계약, 작업 패키지, 원장 | closed (2026-08-26) |
| CR-038 | 2026-08-26 | correction | WP-067 착수 전 커밋 메타데이터 보강 계약 감사에서 확인된 DEV-205~214 | **현재 WP-067 계약을 그대로 구현하면 사용자에게 보이는 것이 하나도 달라지지 않는다.** 계약이 요구하는 것은 "기존 커밋 문서를 부분 갱신한다"인데, 정작 조사 품질을 떨어뜨리는 커밋들에는 **문서 자체가 없고** 채운 값을 읽어 주는 화면 경로도 없다. 제품 범위를 넓히지 않고 이미 승인된 FR-SRCH-002·FR-SRCH-004·FR-REL-005와 JOB-MIR-002를 실제 직접 푸시 커밋과 API/UI까지 잇는다. **SRS는 v2.5 유지.** (1) **소비자 그룹이 토픽당 하나다.** `consumerGroup(topic)`이 `prs:projected` → `'link'` 하나를 돌려주므로, 커밋 보강이 같은 그룹으로 구독하면 **broadcast가 아니라 work sharing**이 되어 링크 파생과 커밋 보강이 같은 이벤트를 나눠 갖는다 — 둘 다 절반씩 놓친다. 버스 카탈로그가 토픽별 **복수 논리 소비자 그룹**을 표현할 수 있어야 한다 (DEV-205). (2) **직접 푸시 커밋은 문서가 아예 없다.** `buildCommitDocuments`는 `EVT-ING-002`의 `source_commit_shas`와 머지 커밋만으로 문서를 만든다 — PR 없이 들어온 first-parent 커밋은 그 목록에 없다. "부분 갱신만 한다"는 규칙은 **없는 문서를 만들지 않으므로** 그 커밋을 영원히 검색 불가로 둔다. `EVT-ING-003`만 방아쇠로 삼아도 안 된다 — 그 이벤트 자체가 커밋 문서 투영 **뒤에** 나온다. 방아쇠를 넓힌다: `sequence.assigned`(EVT-SEQ-001)가 실어 오는 `from_seq..to_seq`가 곧 **새로 채번된 first-parent 구간**이고 `merge_sequence`가 그 SHA를 정본으로 갖고 있다 (DEV-206). (3) **`direct_push`를 PR 연결 하나로 확정하지 않는다.** push와 PR 투영 사이에는 경주가 있고 `merge_sequence.pull_request_number`는 나중에 채워질 수 있다. 최소 근거를 못 박는다 — first-parent 커밋이고, 현재 알려진 PR 머지 매핑이 없으며, **이후 매핑이 생기면 `merge_commit`으로 교정 가능하다.** "한 번 `direct_push`면 영원히"라는 규칙을 만들지 않는다 (DEV-207). (4) **커밋 메타데이터의 PostgreSQL 정본이 없다.** 코드를 감사한 결과 커밋 엔티티에 대응하는 정규화 표가 저장소 어디에도 없다. 지금 계약대로 색인에만 쓰면 **ADR-004가 커밋 축에서 깨진다** — CR-034가 PR 축에서 이미 겪은 것과 같은 결함이다. `commit_snapshot`을 additive 마이그레이션으로 세우고 **PostgreSQL 정본 → Elasticsearch 투영** 방향을 유지한다. 소스 코드 본문·patch 본문은 어떤 경로로도 저장하지 않는다 (DEV-208). (5) **`document_version`의 갱신 경계가 정의되어 있지 않다.** 커밋 문서의 버전은 지금 **PR 웹훅의 버전**이다 — 엔티티가 다른데 버전을 공유한다. 메타데이터 보강은 불변 git 사실을 채우는 일이므로 **버전을 건드리지 않는다.** 새로 만드는 직접 푸시 문서의 초기 버전은 `Date.now()`가 아니라 **커밋 시각**으로 둔다 — 지금 시각을 쓰면 이후의 정상 웹훅 투영이 "오래된 이벤트"로 밀려난다 (DEV-209). (6) **커밋 상세 API가 저장된 메타데이터를 반환하지 않는다.** 채우기만 하고 끝내면 `/commit/...` 화면은 그대로 SHA만 보인다. 계약이 이미 선언한 키를 실제 응답에 잇는다 (DEV-210). (7) **PR 상세의 `source_commits`가 SHA 객체만 만든다.** `shas.map((sha) => ({ commit_sha: sha }))`이라 메타데이터를 채워도 화면에는 계속 SHA만 나온다. 최대 250개를 **한 번에 batch 조회**해 잇는다 — N+1 금지 (DEV-211). (8) **선행·후행의 직접 푸시 행이 PR 문서만 표시 소스로 읽는다.** `toItem`이 `pull_request_number`가 `null`이면 `title`·`author`를 무조건 `null`로 낸다. WP-027이 그 행을 실제로 노출하기 시작했으므로 **이것이 이 WP의 사용자-visible 동기**다. 커밋 메타데이터와 batch join한다 (DEV-212). (9) **권한 필드 없는 커밋 문서를 만들지 않는다.** WP-068이 이제 저장소 접근 범위의 소스를 갖는다. 직접 푸시 문서를 새로 만들 때 `repositoryScope()`가 주는 접근 통제 material을 **문서 생성 시점에 함께** 싣는다 — 먼저 만들고 나중에 채우는 순서는 그 사이 문서를 강제 필터가 거를 수 없게 만든다. fail closed를 유지한다 (DEV-213). (10) **JOB-MIR-002의 운영 도달성.** CR-034의 교훈을 그대로 적용한다 — 선언 → 소비자 그룹 → 워커 역할 → 운영 entrypoint → 핸들러 → PG 정본 → ES 투영 → API/UI → 종료 → 배포 manifest가 한 줄로 이어지는 것을 회귀로 증명한다. 기존 `mirror` 역할을 재사용하되, 역할이 실제로 기동하지 않는데 "코드가 있다"고 완료 처리하지 않는다 (DEV-214) | DEV-205, DEV-206, DEV-207, DEV-208, DEV-209, DEV-210, DEV-211, DEV-212, DEV-213, DEV-214, FR-SRCH-002, FR-SRCH-004, FR-REL-005 AC-5, JOB-MIR-002, EVT-ING-003, EVT-SEQ-001, ENT-CORE-003, API-SRCH-003, API-REL-001, ADR-004, ADR-005, ADR-008 | 데이터 모델, 비동기·잡 카탈로그, API 계약, 배포·운영, 작업 패키지, 원장 | closed (2026-08-26) |
| CR-037 | 2026-08-26 | correction | WP-028(PR #37)·WP-068(PR #40) 머지 **뒤** 도착한 Codex 리뷰 10건 (PR #37 7건 · #40 1건 · #36 1건 · #38 1건) | **선언한 계약을 운영 동작이 실제로 만족하게 만든다. 제품 범위는 넓히지 않으며 SRS는 v2.5 유지.** (1) **팀 접근 범위 동기화가 저장소 단위로 직렬화되지 않는다 — 회수된 접근이 되살아난다.** `syncRepositoryTeamScope`는 GHE 조회 → 정본 쓰기 → 색인 쓰기를 아무 잠금 없이 한다. 같은 저장소에 등록·팀 웹훅·조정 스캔이 겹치면 각 호출이 **서로 다른 GHE 스냅숏**을 읽고 무조건 덮어쓴다. 늦게 끝난 옛 호출이 회수를 되돌려 **이미 제거된 팀 ID가 색인에 복원**되고, 다음 동기화가 올 때까지 옛 구성원이 문서를 본다. 권한 스트림은 팀 ID로만 직렬화하므로 다른 진입점은 서로를 모른다. 저장소 단위 **세션 advisory lock**으로 GHE 조회부터 캐시 무효화까지를 한 줄로 묶는다 — 프로세스 내부 mutex는 워커 복제본이 여럿이면 정확성 경계가 아니고, GHE 왕복 동안 DB 트랜잭션을 여는 것도 금지한다 (DEV-191). (2) **수동 복구가 움직인 head를 되돌린다.** `repairSequence`는 락 획득 뒤 `seq_epoch`만 확인한다. 그래프 walk 중 정상 채번이 head를 D→E로 전진시켜도 에폭은 그대로이므로 검사를 통과하고, 옛 head D로 `advanceHead`를 불러 **저장된 head를 뒤로 되돌리고 이미 채번된 E를 누락**한다. 락 아래에서 저장 head와 **실제 Git head를 커밋 직전에 다시 확인**하는 울타리를 세운다 (DEV-192). (3) **정합성 지문이 접근 통제 필드를 보지 않는다.** `CANONICAL_FIELDS`에 `org_id`·`visibility`·`allowed_team_ids`가 없다. 그 셋은 `scoped-query.ts`의 `org_team` 경로와 `team:` 필터가 **실제로 읽는** 필드다. 저장소 이전·공개 범위 변경·색인 손상으로 두 쪽이 어긋나도 이 잡은 `consistent`로 보고한다 — 검색 데이터 drift가 아니라 **authorization material drift**다. 기대값은 스냅숏 엔티티 상태에 **`repository` 표의 현재 범위 상태를 합성**해 만든다 (스냅숏에 권한을 중복 저장하지 않는다) (DEV-193). (4) **마이그레이션 010이 기존 운영 데이터를 부트스트랩하지 않는다.** 업그레이드 시 기존 PR 문서는 ES에만 남고, 투영은 바뀐 PR만 쓰며 조정 스캔은 이미 색인된 것을 건너뛴다 — 손대지 않은 데이터는 스냅숏을 영영 못 얻고 ADR-004의 재구축 근거가 없다. **기존 마이그레이션은 고치지 않고** 재개 가능한 일회성 부트스트랩 경로를 만든다. **마이그레이션 안에서 GHE·ES를 부르지 않는다** (DEV-194). (5) **부트스트랩 이전 상태를 손상으로 확정한다.** 스냅숏이 없는 저장소는 개수 대조에서 `count`, 식별자 대조에서 `extra_in_es`로 보고된다 — "ES가 잘못됐다"와 "PG 정본 부트스트랩이 아직 안 끝났다"는 다른 사실이고, 뭉치면 운영자가 멀쩡한 색인을 의심한다. 명시적 `snapshot_bootstrap_pending` 상태로 가른다. 자동 ES 삭제는 여전히 금지 (DEV-195). (6) **취소된 잡을 완료로 덮는다.** 러너의 `finishJob`이 무조건 UPDATE라, 운영자가 실행 중 잡을 `cancelled`로 바꿔도 `completed`/`failed`가 그것을 덮어쓴다. `state = 'running'` 조건부 전이(CAS)로 바꾼다 — check-then-write는 동시 취소에 같은 경주가 남는다 (DEV-196). (7) **수동 복구가 `EVT-SEQ-002`를 발행하지 않는다.** 에폭이 올라 이전 범위 인용이 무효가 됐는데도 알림·투영 소비자가 그 사실을 못 받는다. 자동 경로와 같은 커밋 후 확정 절차를 쓴다 (DEV-197). (8) **`reassigning`이 다른 연결에서 관측되지 않는다.** 수동 경로는 `bumpEpoch`가 트랜잭션 안에서 설정하고 같은 트랜잭션의 `advanceHead`가 즉시 `ok`로 되돌린다 — 긴 재구축 내내 조회는 옛 에폭을 "정상"으로 낸다. 자동 경로처럼 `markReassigning`을 **먼저 따로 커밋**한다 (DEV-198). (9) **그래프를 못 읽은 실패가 `stale`로 남지 않는다.** `repairSequence`가 `stale` outcome을 반환만 하고 `markStale`을 부르지 않아, 잠재적으로 손상된 공간이 `ok`로 광고된다. 롤백 **이후 별도 커밋**으로 기록한다 (DEV-199). (10) **문서 둘이 서로 다른 사실을 말한다.** WP-027 원장 행에 `화면 커밋 / PR #33` 플레이스홀더가 남아 실제 화면 커밋과 CR-032 정정을 추적할 수 없고, `work_packages.md` 순서표는 WP-028·WP-068을 아직 `todo`로 표시해 원장의 `done`과 충돌한다 (DEV-200). **이 CR의 PR(#41)에도 P1 셋이 도착했고 전부 실결함이었다** — 표시를 락보다 먼저 커밋해 남의 재채번 상태를 되돌릴 수 있었고(DEV-202), 부분 보강 문서가 같은 버전으로 완전한 스냅숏을 덮으면서도 성공으로 세어졌으며(DEV-203), `updated` 정렬 페이지네이션이 항목을 건너뛴 채 완결 표시를 찍을 수 있었다(DEV-204). 셋의 공통점은 **실패해도 성공으로 세는 자리**다. 부수로 `upsertTeam`의 동시 삽입 결함도 찾았다(DEV-201) | DEV-191, DEV-192, DEV-193, DEV-194, DEV-195, DEV-196, DEV-197, DEV-198, DEV-199, DEV-200, DEV-201, DEV-202, DEV-203, DEV-204, FR-AUTH-002 AC-6, FR-SEQ-005, FR-ADMIN-003, FR-ING-011, JOB-SEQ-002, JOB-ING-005, JOB-ING-008, EVT-SEQ-002, ADR-004, ADR-007, ADR-008 | 데이터 모델, 비동기·잡 카탈로그, 작업 패키지, 원장 | closed (2026-08-26) |
| CR-036 | 2026-08-25 | correction | WP-068(PR #39) 머지 **뒤** 도착한 Codex 리뷰 3건 | **팀 회수가 색인에 반영되지 않아 옛 구성원이 문서를 계속 볼 수 있었다 — 접근 범위의 유출이다.** (1) **소급 적용이 정본의 옛 값을 되썼다.** 워커의 `refreshRepositoryTeams`가 `findRepositoriesForTeam`으로 저장소를 찾은 뒤 **그 행의 `allowed_team_ids`를 그대로** 색인에 썼다. 회수 사건에서 그 값은 **아직 제거된 팀을 담고 있으므로** 회수가 반영되지 않는다. 반대로 추가 사건에서는 저장소가 아직 그 팀을 갖고 있지 않아 **역조회로 대상을 찾지도 못했다** — 추가가 영영 전파되지 않는다. 방아쇠가 무엇이든 **GHE가 지금 무엇이라고 답하는지**를 다시 읽고, 웹훅의 `repository_id`를 함께 쓴다. 판정과 쓰기는 `@prs/authz`의 공유 구현으로 옮겨 등록 경로와 웹훅 경로가 같은 것을 쓰게 했다 — 각자 구현하면 한쪽만 고쳐지는 날이 오고 접근 범위에서 그것은 유출이다 (DEV-188). (2) **색인 실패 뒤 재시도 경로가 없었다.** `setAllowedTeams`가 정본을 바꾼 뒤 `applyRepositoryTeams`가 실패하면 catch가 삼켰고, **다음 동기화는 "바뀐 것 없음"으로 판단해 건너뛴다** — 회수된 팀이 색인에 영원히 남는다. 색인 반영이 실패하면 **정본을 이전 값으로 되돌려** 다음 회차가 같은 차이를 다시 보게 한다 (DEV-189). (3) **마이그레이션 이전 저장소가 영영 빈 채로 남는다.** 011은 기존 행에 빈 배열을 주는데 그것을 채우는 경로가 **명시적 재등록뿐**이고, 팀 웹훅의 역조회도 빈 배열이라 그 저장소를 찾지 못한다. 수동으로 전부 다시 등록하지 않는 한 팀 전용 비공개 저장소가 `team:`과 `org_team`에서 계속 보이지 않는다. 조정 스캔(JOB-ING-005)이 주기적으로 메운다 — 이미 저장소를 한 바퀴 도는 정기 정비이므로 새 잡을 만들지 않는다 (DEV-190). **SRS는 고치지 않는다 — v2.5 유지** | DEV-188, DEV-189, DEV-190, FR-AUTH-002 AC-6, EVT-AUTH-001, JOB-ING-005 | 비동기·잡 카탈로그, 데이터 모델, 작업 패키지, 원장 | closed (2026-08-25) |
| CR-035 | 2026-08-25 | correction | WP-068 착수 전 팀 접근 범위 계약 감사에서 확인된 DEV-185~187 | **`allowed_team_ids`를 채우려는데 그 값을 GHE에 물을 방법이 없다.** (1) **GHE 클라이언트에 "이 저장소에 접근 가능한 팀" 조회가 없다.** 있는 것은 `listOrgTeams(org)`(조직의 전체 팀), `isTeamMember(org, slug, user)`(사용자가 그 팀인가), `collaboratorPermission(ref, user)`(사용자의 저장소 권한)뿐이다 — 셋 다 **사용자 축**이고 `allowed_team_ids`가 필요로 하는 것은 **저장소 축**이다. 조직 전체 팀을 훑어 각각 확인하면 팀 수만큼 호출이 들어가 등록 한 번이 수십~수백 요청이 된다. GitHub은 `GET /repos/{owner}/{repo}/teams`를 제공하므로 그것을 쓴다 (DEV-185). (2) **`team` 표에 조직의 팀이 채워지는 자리가 없다.** `resolveTeamIds`(WP-013)가 slug → ID를 그 표에서 읽고 강제 필터가 그 ID로 문서를 거르는데, 저장소 등록 경로가 표를 채우지 않아 **`team:` 질의가 이름을 ID로 옮기지 못한다.** 저장소의 팀을 읽는 김에 그 팀들을 `team` 표에 upsert한다 — 조회한 것만 넣으므로 별도 동기화 잡을 만들지 않는다 (DEV-186). (3) **소급 적용의 방아쇠가 정의되어 있지 않다.** WP-068은 "`team` 웹훅 시 `update_by_query` 소급 적용"을 요구하지만, 그 웹훅이 오는 곳은 게이트웨이이고 소급 적용은 색인을 만지는 작업이라 소유 프로세스가 다르다. 이미 `permission.invalidated`(EVT-AUTH-001)가 같은 방아쇠로 authz 워커까지 가고 있으므로 **그 소비자에 얹는다** — 새 이벤트·새 역할을 만들지 않고, 권한 캐시 무효화와 색인 소급 적용이 **같은 사건에서 함께** 일어난다 (DEV-187). **SRS는 고치지 않는다 — FR-AUTH-002 AC-6은 이미 팀 기반 접근을 승인했고, 이 CR은 그것을 채울 수단을 세우는 것이다. v2.5 유지** | DEV-185, DEV-186, DEV-187, DEV-114(해소 예정), FR-AUTH-002 AC-6, FR-AUTH-003, FR-SRCH-005, API-ADM-001, ENT-CORE-001~004 | API 계약, 데이터 모델, 백엔드 아키텍처, 작업 패키지, 원장 | closed (2026-08-25) |
| CR-034 | 2026-08-25 | correction | WP-028(PR #35) 머지 **뒤** 도착한 Codex 리뷰 5건 + 그 감사에서 추가로 확인한 결함 3건 | **선언한 기능이 운영에서 하나도 실행되지 않았다.** 다섯 지적이 전부 같은 모양이다 — 함수도 있고 라우트·러너 코드도 있고 시험도 초록인데 **운영 프로세스가 그것을 부르지 않는다.** WP-028의 "완료"는 함수 존재를 증명했지 배포 도달성을 증명하지 않았다. (1) **API-ADM-007이 배포에 없다.** 라우트는 `deps.integrity`가 있을 때만 등록되는데 운영 `index.ts`의 `buildServer` 호출이 그 의존을 넘기지 않는다 — 통합 시험은 목을 직접 꽂아 그 사실을 가렸다. 조립을 `runtime.ts`의 함수로 꺼내 **운영과 시험이 같은 것을 부르게** 했다 (DEV-177). (2) **`sequence_reassign` 잡을 집는 러너가 없다.** 운영자가 재채번을 요청하면 행만 `queued`로 남고, `job_active_uk` 때문에 **같은 공간의 다음 요청이 전부 `JOB_CONFLICT`로 거절된다** — 고치라고 만든 버튼이 고칠 수 없게 만든다. `claimNextJob`을 재사용한 러너를 세웠다 (DEV-178). (3) **조정 스캔이 어디서도 기동하지 않는다.** `startReconcileSweeper`를 부르는 곳이 없어 JOB-ING-005가 죽은 함수였다. 확장 축이 실시간 소비자와 달라 **전용 `reconcile` 역할**을 두었다 — `enrich`에 붙이면 실시간을 늘릴 때마다 주기 스윕이 중복 실행된다 (DEV-179). (4) **head 복구가 소비자 없는 잡을 만든다.** `sequence_assign` 행을 넣는데 그 유형도 집는 러너가 없고, 게다가 `findActiveJob`이 그 행을 보고 **이후의 모든 복구 시도를 막는다.** 두 번째 채번 실행 구조를 만들지 않고 이미 살아 있는 `prs:sequence` → `sequence.requested` 경로로 보낸다 (DEV-180). (5) **내용 대조가 내용을 보지 않는다.** 양쪽에서 `pr_number`만 꺼내 집합을 비교해, 같은 번호가 양쪽에 있으면서 제목·상태·브랜치가 어긋난 상태를 한 건도 잡지 못했고 `content` 종류는 도달 불가였다. 정규 필드 지문 대조로 바꿨다 (DEV-181). **추가로 확인한 셋.** (6) **수동 복구가 head 그대로인 중간 손상을 못 고친다.** `reassignSequence`는 `mergeBase(storedHead, newHead)`까지를 검증된 것으로 보고 복사하는데, 손상이 중간에 있고 head가 같으면 `mergeBase(D, D) = D`라 **손상 구간을 통째로 복사하고 다시 계산할 커밋이 0건**이 된다 — 복구가 아무것도 고치지 않고 에폭만 올린다. 수동 경로에 "검증된 prefix + 최초 불일치부터 재계산" 전략을 세웠다 (DEV-182). (7) **완료된 역할들에 배포 manifest가 없다.** `deploy/k8s`에 enrich·project만 있어 `sequence`·`reconcile`이 배포될 경로가 없었다 (DEV-183). (8) **백필이 PostgreSQL에 재구성 근거를 남기지 않는다.** 백필·조정 스캔은 GHE에서 직접 읽어 **Elasticsearch에만** 쓴다 — `raw_event` 행이 없다. 그래서 ADR-004("어떤 데이터도 검색 인덱스에만 존재해서는 안 된다")가 그 경로에서 실제로 깨져 있었고, JOB-ING-008은 정상 백필 문서를 전부 `extra_in_es`로 오판했다. 마이그레이션 010이 두 투영 경로가 함께 남기는 `pull_request_snapshot`을 세웠다 (DEV-184). **SRS는 고치지 않는다 — FR-ADMIN-003·FR-ING-011·API-ADM-007의 승인된 의미는 그대로이고, 구현이 그 계약에 도달하지 못한 것을 고치는 작업이다. `srs_final.md`는 v2.5를 유지한다** | DEV-177~184, FR-ADMIN-003, FR-ING-011, API-ADM-007, JOB-SEQ-002, JOB-SEQ-003, JOB-ING-005, JOB-ING-008, ADR-004, ADR-007 | API 계약, 비동기·잡 카탈로그, 백엔드 아키텍처, 데이터 모델, 인프라·운영, 작업 패키지, 원장, `deploy/k8s` | closed (2026-08-25) |
| CR-033 | 2026-08-25 | correction | WP-028 착수 전 정합성 점검·조정 스캔 계약 감사에서 확인된 DEV-171~176 | **점검이 딛고 설 계약 일곱 곳이 비어 있거나 어긋났고, 그중 하나는 SRS 문장 자체다.** (1) **점검 실패가 정본 상태를 오염시킨다.** FR-ADMIN-003의 예외 처리는 "커밋 그래프에 접근할 수 없으면 점검을 중단하고 시퀀스 공간 상태를 `unknown`으로 표시"인데, `unknown`은 이미 **"채번된 적 없는 브랜치"**를 뜻하고 API-SEQ-006·C-027·W-004가 그 뜻으로 표시하고 있다(CR-029). 여기에 "점검 실패"를 얹으면 한 번의 일시적 그래프 접근 실패가 이미 선 화면들을 거짓말하게 만든다. 더 근본적으로 **점검은 읽기(관찰)이지 쓰기가 아니다** — 진단 실행의 실패는 진단 결과에 담기지 진단 대상의 상태가 되지 않는다. 사용자 결정으로 예외 처리를 정정한다: 점검을 실패로 종료하고 사유·상관 ID를 보고하되 **기존 상태를 보존**한다. **이 CR은 `srs_final.md`를 직접 고친다 — v2.5**. 새 상태값 `check_failed`는 **만들지 않는다** — 시퀀스 상태와 진단 실행 상태는 다른 개념이고, 상태 enum을 늘리면 마이그레이션·C-027·W-004가 모두 그 오염을 물려받는다 (DEV-171). (2) **`sequence_reassign`이 잡 유형에 없다** (DEV-128의 해소). `job_type_chk`는 `sequence_assign`까지만 허용하는데 API-ADM-007의 202 예시는 `type: "sequence_reassign"`을 낸다 — 잡 행을 만드는 순간 CHECK 위반이다. API-ADM-007이 이미 안정 계약으로 그 이름을 쓰므로 **계약을 코드에 맞추지 않고 스키마를 넓힌다**: 마이그레이션 009로 유형을 추가한다. 기존 마이그레이션은 고치지 않는다 (DEV-172). (3) **`affected_saved_search_count`의 판정 규칙이 없다.** `saved_search`에는 저장소 열이 없고 질의 문자열뿐이다. 문자열에 `seq:`가 들어 있는지로 세면 인용 안의 문자열·부정 필터·주석을 전부 오답으로 만든다 — **`@prs/query` 파서를 쓴다.** 영향 정의를 "재채번으로 **의미가 바뀔 가능성이 있는** 저장 검색"으로 못 박고(정확히 대상만 가리키는 검색 수가 아니다), `repo:`·`base:`가 **없는** 질의는 대상을 포함할 수 있으므로 **보수적으로 후보에 넣는다**. `seq` 술어가 없으면 재채번이 의미를 바꾸지 않으므로 제외한다 (DEV-173). (4) **JOB-ING-008(PG↔ES 정합성 감시)이 구현 범위에는 있고 DoD에는 없다.** 범위에서 빼지 않는다 — ADR-004("Elasticsearch는 PostgreSQL만으로 재구축 가능하다")를 실제로 검증하는 유일한 잡이다. 명시적 DoD를 세우고 **개수 대조와 표본 내용 대조 두 층**을 나눈다. 표본 크기는 기존 문서에 값이 없어 FR-ADMIN-003 AC-2와 같은 1000으로 정한다. **ES에만 있는 잉여 문서는 자동 삭제하지 않는다** — 삭제는 별도로 승인된 계약 없이 수행하지 않으며, 투영 지연과 잉여를 서버가 가릴 수 없다. 불일치로 보고·경보만 한다 (DEV-174). (5) **GHE 클라이언트가 "최근 24시간 갱신 PR"을 낼 수 없다.** `listPullRequestsPage`가 `direction: 'asc'`로 고정돼 있고(백필용 — DEV-098이 건너뜀 방지를 위해 그렇게 고정했다) `/pulls`에는 `since`가 없다. **백필 의미를 바꾸지 않고** 선택적 `direction` 옵션을 더해 기본값을 `asc`로 둔다. 조정 스캔만 `desc`로 읽고 24시간 컷오프에서 멈춘다 — 없는 `since`를 있는 것처럼 만들지 않는다 (DEV-175). (6) **FLOW-008 7단계 "알림 발송"이 성립하지 않는다.** 알림 어댑터는 REL-005 소유다(DEV-026·DEV-127 이월). 가짜 구현을 만들지 않고 WP-028의 DoD를 **감사 기록·지표·잡 상태**로 좁히고 알림 이월을 명시한다 (DEV-176). (7) **FR-ING-011 AC-1·AC-5에 대응하는 DoD가 없다.** 주기 설정값(기본 1시간)과 "head 시퀀스가 없으면 채번 예약"이 어느 DoD에도 없다 — 후자는 원장 §7의 "채번은 push 웹훅이 온 저장소만 따라간다"를 메우는 항목이다. DoD에 더한다 (DEV-176) | DEV-171~176, DEV-128(해소), FR-ADMIN-003, FR-ING-011, FR-SEQ-005, API-ADM-007, JOB-SEQ-003, JOB-ING-005, JOB-ING-008, FLOW-008, ADR-004 | **SRS(v2.5)**, API 계약, 비동기·잡 카탈로그, 데이터 모델, 관측성, 작업 패키지, 원장 | closed (2026-08-25) |
| CR-032 | 2026-08-25 | correction | WP-027(PR #33) 머지 **뒤** 도착한 Codex 리뷰 3건 — 셋 다 머지된 `main`에서 재현되는 실결함 | **선행·후행이 "어느 브랜치의 서수인가"를 정하지 않은 채 답하고 있었고, 확인되지 않은 시각을 확정처럼 그렸으며, 실패에서 빠져나갈 길이 없었다.** (1) **앵커의 시퀀스 공간을 서버가 임의로 골랐다.** `findNeighbors`가 `findByPullRequest`/`findByCommitSha`로 **저장소 전체**를 훑고 현재 에폭인 **첫 행**에서 멈췄다. 그런데 `merge_sequence`의 유일 색인은 `(repository_id, base_branch, seq_epoch, commit_sha)`이므로 **한 커밋이 `main`과 `release/*`의 현재 체인에 함께 있는 것은 정상이고**, 두 행이 모두 에폭 검사를 통과하면 어느 공간의 서수를 낼지 **PostgreSQL의 반환 순서가 정한다** — 서수는 `(저장소, 대상 브랜치)` 안에서만 의미가 있다는 ADR-007이 응답에서 무너진다. 더구나 화면은 "범위로 확장" 링크를 **문서의 `base_branch`**로 만들고 있어, 서버가 다른 공간을 고르면 목록의 서수와 링크가 **서로 다른 공간을 가리킨 채** 조용히 어긋난다(WP-026 P2가 잡았던 것과 같은 모양인데 그때는 서버가 거절해서 드러났다). 결정론적 정렬은 답이라기보다 **결정론적 오답**이다 — 사용자가 묻지 않은 브랜치를 항상 같게 고를 뿐이다. W-002·W-003이 이미 `base_branch`를 갖고 있으므로 **API-REL-001에 `base_branch`를 필수로 더하고**, 앵커 해석을 API-SEQ-002가 쓰는 `findPointByPullRequest`/`findPointByCommit`(공간·에폭 한정)으로 통일한다. 응답의 `sequence_space`는 **구조적으로 요청한 공간**이다 (DEV-168). (2) **색인 안 된 PR 행이 커밋 시각을 머지 시각으로 표시했다.** `merged_at: source?.merged_at ?? row.committed_at`은 PR 문서가 색인에 아직 없을 때 **병합 커밋의 `committed_at`**을 실었고, 화면은 그것을 "머지 시각" 칸에 그렸다 — 커밋 시각과 GitHub의 PR 머지 시각은 다른 값이므로 **확인되지 않은 값을 확정처럼** 보여 준 것이다. 행의 종류가 규칙을 정한다: 직접 푸시 커밋 행은 커밋 시각(계약의 기존 예시대로), PR 행은 색인이 아는 값이거나 `null`. 세지 않은 것을 0으로 채우지 않는 DEV-133과 같은 규율이다 (DEV-169). (3) **실패에서 빠져나갈 수단이 없었다.** 조회가 `error`가 되면 화면은 "잠시 뒤 다시 시도해 주세요"라고 안내하는데, 접기/펴기는 `phase === 'idle'`일 때만 조회하고 건수 조절 UI는 결과가 있을 때만 그려진다 — **상세 화면 전체를 다시 여는 것 말고는 복구 경로가 없었다.** 화면이 따를 수 없는 지시를 하지 않도록 명시적 "다시 시도" 버튼을 둔다 (DEV-170). **SRS는 고치지 않는다 — FR-REL-001은 이미 `(저장소, 대상 브랜치)` 시퀀스 공간을 전제하고 있고, 이 CR은 API와 화면이 그 전제를 정확히 지정하게 만드는 하위 계약 정정이다. `srs_final.md`는 v2.4를 유지한다** | DEV-168, DEV-169, DEV-170, FR-REL-001, ADR-007, API-REL-001, C-019, W-002, W-003, QA-W002-19 | `pr_search_api_contracts.md`, `pr_search_ui_component_spec.md`, `pr_search_screen_state_matrix.md`, `pr_search_screen_qa_checklist.md`, `pr_search_work_packages.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed (2026-08-25) |
| CR-031 | 2026-08-25 | correction | WP-027 착수 전 선행·후행 계약 감사에서 확인된 DEV-161~167 | **선행·후행이 딛고 설 계약 일곱 곳이 어긋나거나 비어 있고, 그중 하나는 SRS 문장 자체다.** (1) **이웃의 단위가 SRS와 API 계약에서 다르다.** FR-REL-001의 요구사항 문장은 "시퀀스 값이 인접한 **PR**"이고 AC-2도 PR 번호를 요구하는데, API-REL-001 응답 예시에는 `kind: "commit"`·`pr_number: null`(직접 푸시)이 섞여 있다. PR만 내면 목록의 서수가 건너뛴 채 보이고(1339 → 1341) 사용자는 그것을 **누락으로 읽는다** — "서수는 `git log --first-parent`와 대조 가능해야 한다"(ADR-007)는 이 제품의 불변식과 정면으로 어긋난다. 사용자 결정으로 **커밋을 포함**하고 FR-REL-001의 문장·AC-2·예외 처리·관련 화면을 정정한다. 하위 문서는 SRS 범위를 넓힐 수 없으므로 **이 CR은 `srs_final.md`를 직접 고친다 — v2.4**(DEV-161). (2) **진입 조회 규율과 충돌한다.** WP-017이 "진입 시 요청은 PR 문서 하나뿐"을 a11y·e2e 다섯 곳에 걸었고(WP-024가 CI에서 한 번 깨고 되돌렸다), 와이어프레임은 선행·후행을 진입 레이아웃에 그린다. C-020 선례대로 **확장 시 1회 조회**로 통일하고 와이어프레임·IA를 정정한다(DEV-162). (3) **W-003의 앵커가 없다.** WP-027 범위는 "W-003 시퀀스 위치 섹션 연결"인데 API-REL-001은 `pr_number`만 받는다 — 직접 푸시 커밋은 PR이 없어 앵커를 만들 수 없고, 프론트 아키텍처의 `/commit/...` 행에는 API-REL-001이 아예 없다. `commit_sha` 앵커를 신설한다(DEV-163). (4) **미머지와 미채번을 API가 가르지 않는다.** 계약은 409 `NO_SEQUENCE` 하나뿐인데 C-014는 `unassigned`(미머지)와 `not_computed`(미채번)를 **절대 같이 그리지 말라**고 못 박는다(DEV-077). 머지됐으나 아직 채번되지 않은 PR은 어느 쪽도 아니다. 사유를 가르고, 화면은 PR 문서의 `state`로 미머지를 알 수 있으므로 **요청 자체를 하지 않는다**(DEV-164). (5) **QA-W002-16(에폭 경고)의 소유자가 없다.** WP-017이 DEV-087로 "도달 불가라 만들지 않는다 — WP-021이 시퀀스를 채울 때 정한다"며 이월했고 WP-021·022가 섰다. 지금 W-002는 실제 서수를 그리므로 도달 가능해졌는데 어느 WP의 DoD에도 없다 — W-004(QA-W004-21)의 선례대로 WP-027이 갖는다(DEV-165). (6) **이웃 항목에 `indexed`·`url`이 없다.** 범위 결과는 DEV-130대로 색인 미반영 항목을 서수·SHA만으로 그리고 "색인 대기"를 밝히는데, 같은 두 소스를 쓰는 이웃 목록에는 그 자리가 없어 색인이 늦은 이웃이 조용히 빠지거나 빈 제목이 된다(DEV-166). (7) **"범위로 확장"의 앵커가 정의되어 있지 않다.** W-002·W-003 모두 링크만 적혀 있다 — 현재 표시 중인 이웃 창(첫 이웃 exclusive, 마지막 이웃 inclusive)으로 정해 화면이 본 것과 W-004가 조회할 것을 같게 한다(DEV-167) | DEV-161~167, FR-REL-001, FR-SEQ-005 AC-4, QA-W002-04~07·16, QA-W003-06, W-002, W-003, C-014, C-019, API-REL-001 | **SRS(v2.4)**, API 계약, 제품 IA, 와이어프레임, 화면 흐름, 프론트 아키텍처, 컴포넌트 명세, 작업 패키지, 원장 | closed (2026-08-25) |
| CR-030 | 2026-08-25 | correction | WP-026 착수 전 W-005 릴리스 화면 계약 감사에서 확인된 DEV-155~159 | **릴리스 화면이 딛고 설 계약 다섯 곳이 비어 있거나 실측과 어긋난다.** (1) **C-032 ReleaseTimeline이 읽을 릴리스 목록 API가 없다** — API 표에 저장소 단위 릴리스 목록이 없고 프론트 아키텍처는 W-005가 API-SEQ-003만 쓴다고 적는다. `/containments`(API-REL-002)는 **대상을 지정해** 묻는 조회이고 API-SEQ-003은 **구간 비교**라, "이 저장소의 릴리스들"을 줄 경로가 어디에도 없다 — DEV-152와 같은 모양의 공백이다. 접근 범위 필터를 지나는 `GET /releases`(API-REL-005)를 신설한다. 목록의 "직전 릴리스 대비 PR 수"(QA-W005-06)는 서수 차가 아니라 실제 PR 문서 수여야 하는데 `countRange`는 커밋을 세고 `countPullRequestsAbove`는 한쪽만 센다. "직전"의 기준도 정해져 있지 않다 — 정렬은 시각 내림차순(와이어프레임)인데 구간은 서수로 잘리므로 **직전은 같은 공간에서 서수가 바로 아래인 릴리스**로 정하고 그 대상을 행에 명시한다(DEV-155). (2) **API-SEQ-003의 응답 예시가 실측 요약과 어긋난다** — CR-027(DEV-133)이 API-SEQ-001 요약에서 뺀 `reverted_pull_request_count`가 이 절에는 남아 있고, 같은 `RangeSummary`가 내는 `commit_count`·`files_truncated_pull_request_count`·`top_changed_paths`와 봉투의 `sequence_state`·`epoch_stale`·`requested_seq_epoch`·`items_missing_in_index`·`unresolved`(WP-022·023)는 없다. 요청 파라미터(`size`·`seq_epoch`)와 `to=unreleased`일 때 `from`의 기본값도 미정이다(DEV-156). (3) **W-005의 경로가 셸이 소유한 것과 다르다** — 셸 내비게이션(`lib/nav.ts`, WP-015 구현·병합)은 `/releases`를 항목으로 갖는데 와이어프레임·프론트 아키텍처는 `/releases/[owner]/[repo]`다. 지금 "릴리스"를 누르면 404다. DEV-153과 같은 사정이며 같은 원칙으로 구현된 셸 쪽(`/releases?repo=&branch=`)으로 통일한다 — C-027 셀렉터를 쓰는 화면(W-004 `/ranges?repo=&branch=`)의 공통 형태다. 렌더링도 "서버"에서 **서버 셸 + 클라이언트 조회**로 정정한다(DEV-157). (4) **QA-W005-03이 브랜치 고정 목록에서는 도달 불가다** — "다른 대상 브랜치 릴리스 2건 선택 시 차단"을 검증하려면 목록에 두 브랜치의 릴리스가 함께 있어야 하는데 딥링크가 `?branch=`로 공간을 고정하면 그 상황을 만들 수 없다. `release` 표는 저장소 단위이고 `base_branch`가 nullable이므로(체인 밖 태그) 목록을 저장소 스코프로 두고 브랜치는 행의 표기·필터로 둔다. 그러면 QA-W005-03이 도달 가능해지고 `base_branch IS NULL` 행도 자리를 얻는다 — 표시하되 비교 앵커로는 선택 불가다(DEV-158). (5) **`empty_no_release`와 `not_indexed`를 판별할 근거가 없고 `not_indexed`의 복구 경로가 아직 없다** — `repository` 표에 릴리스 동기화 마커가 없어 "태그가 0개인 저장소"와 "아직 한 번도 받지 않은 저장소"가 같은 관측(`hasAnyRelease` = false)이다. 판별할 수 없는 두 상태를 화면에 두면 둘 중 하나는 반드시 거짓이 된다. 복구 경로 W-009(`/repositories`)는 P1(REL-004~005)이라 링크 대상 자체가 없다 — 상태를 하나로 합쳐 두 원인을 함께 안내하고 저장소 개요 링크는 W-009가 서는 WP로 이월한다(DEV-159) | DEV-155, DEV-156, DEV-157, DEV-158, DEV-159, FR-SEQ-004, FR-REL-002, QA-W005-01~06, W-005, C-032, C-027, API-SEQ-003, API-REL-005 | API 계약, 제품 IA, 와이어프레임, 화면 흐름, 프론트 아키텍처, 컴포넌트 명세, 작업 패키지, 원장 | closed (2026-08-25) |
| CR-029 | 2026-08-24 | correction | WP-025 착수 전 W-004 계약 감사에서 확인된 DEV-150~153 | **W-004 범위 조사 화면의 계약 네 곳이 실측과 어긋난다.** (1) QA-W004-10이 요구하는 요약 다섯 값 중 "되돌림 관계 보유 PR 수"는 관계 파생(WP-030) 전에는 데이터가 없다 — DEV-133이 이미 API에서 키 자체를 빼기로 정했으므로 화면 항목도 갈라야 한다(DEV-150). (2) WP-025 DoD "상태 매트릭스 W-004의 전 상태 렌더링"이 제외 범위의 상태까지 포함한다 — 안전 구간 표식(WP-041)·이분 탐색(WP-042)의 `bisect_contradiction` 등은 도달 불가하고, 도달 불가 상태는 만들지 않는다(DEV-087의 교훈, DEV-151). (3) C-027 SequenceSpaceSelector가 요구하는 저장소·브랜치 목록을 줄 **일반 사용자용 API가 없다** — 목록은 관리자 게이트(`/admin/repositories`)뿐이다. 접근 범위 필터를 지나는 `GET /sequence-spaces`(API-SEQ-006)를 신설한다(DEV-152). (4) 딥링크 경로가 문서 간 모순이다: 셸 내비게이션(WP-015 구현, main 병합)은 `/ranges`를 소유하는데 IA·와이어프레임·화면 흐름·프론트 아키텍처는 `/range`이고, IA의 파라미터는 `space=`인데 화면 흐름은 `repo`·`branch`다 — 구현된 코드 쪽(`/ranges`, `repo`·`branch` 분리)으로 통일한다(DEV-153). `q` 파라미터는 패싯 데이터가 서는 WP-032에서 붙는다 | DEV-150, DEV-151, DEV-152, DEV-153, DEV-154, FR-SEQ-002, FR-SEQ-003, QA-W004-10, QA-W004-11, W-004, C-013, C-027, API-SEQ-006 | API 계약, 제품 IA, 와이어프레임, 화면 흐름, 프론트 아키텍처, 작업 패키지, 원장 | closed (2026-08-24) |
| CR-028 | 2026-08-24 | correction | WP-024 착수 전 릴리스 수집 계약 감사에서 확인된 DEV-142~149 | **릴리스 엔티티가 검색 인덱스에만 존재하도록 설계되어 있다.** 데이터 모델 3장의 ENT-REL-001은 저장 위치를 Elasticsearch로, 갱신 주체를 projection으로 적는다 — "어떤 데이터도 검색 인덱스에만 존재해서는 안 된다"는 ADR-004 위반이고, 범위 인용의 정본을 PostgreSQL로 정한 CR-027(DEV-130)과도 정면 충돌한다. 포함 판정과 릴리스 앵커가 ES에만 있는 데이터를 딛으면 색인 반영 실패가 **오류 없이 항목을 빠뜨리는** 같은 실패가 재현된다(DEV-142) → PostgreSQL `release` 테이블을 신설하고 ES는 투영으로 둔다. **DEV-132의 기록된 사유가 실측으로 반증됐다**(DEV-143): `--mirror` 클론의 refspec `+refs/*:refs/*`는 `--no-tags`와 무관하게 태그를 가져오고 prune이 삭제도 반영하며 `^{commit}` peel로 주석 태그도 커밋 SHA가 나온다 — 이월 결정 자체는 옳았으나(쓰는 경로 부재) 이유가 틀렸고, 이 사실이 WP-024의 태그 소스를 정한다: GHE API가 아니라 **미러**다 (ADR-007 대조 가능, 자격 증명 불요, 백필·실시간 동일 경로). 릴리스 수집의 잡·이벤트·스트림이 카탈로그에 없고(DEV-144, DEV-116과 같은 모양), 태그 push·release·create의 실시간 신호 추출이 게이트웨이에 없다(DEV-145). `RELEASE_NOT_INDEXED`가 계약 표에서 404인데 FR-REL-002 예외는 "빈 배열과 사유 코드를 함께"(=200)다(DEV-146). `released_at`의 뜻(DEV-147), `release_tags` "상위 5"의 뜻(DEV-148), 에폭 전환 시 릴리스 서수 무효 처리(DEV-149)가 미정이다 | DEV-142~149, FR-REL-002, FR-SEQ-003 AC-1, FR-SEQ-004, ADR-004, ADR-005, ADR-007, API-REL-002, ENT-REL-001 | 데이터 모델, 비동기·잡 카탈로그, API 계약, 작업 패키지, 원장 | closed (2026-08-24) |

### CR-065 반영 내역 (2026-09-04)

**문서와 코드가 같은 말을 하게 하는 CR이다.** `DEV-544`가 발행 뒤 되돌리기를 없애면서 스크립트가 사람에게
판단을 넘기는 자리가 넷 생겼고, `PR #148`이 그 안내를 런북에 적었다. 그 안내가 두 번 연달아 틀렸다.

| 무엇이 틀렸나 | 왜 값비싼가 |
| --- | --- |
| 남의 태그와 자기 태그를 한 행에 합쳤다 (`DEV-546`) | `undo_note()`는 전자에 "새 버전으로", 후자에 "지운 뒤 같은 버전으로"라 말한다. 정반대인데 후자만 적어 **남의 태그를 지우게** 했다 |
| 계보를 판정하지 않았다 (`DEV-546`) | `target_commitish`는 GitHub 문서가 "태그가 이미 존재하면 사용되지 않는다"고 정한 값이다. 이 스크립트는 태그를 먼저 만든 뒤 발행하므로 **애초에 무시된 값**이며, 그것으로 판정하면 태그가 옮겨진 릴리스를 통과시킨다 |
| `undo_note()`가 옮겨진 태그에 기대값 없는 삭제를 지시했다 (`DEV-547`) | `TAG_LEFT`는 "그대로 남았다"와 "다른 커밋으로 옮겨졌다"를 **함께** 담는다. 후자에 `git push origin :refs/tags/<v>`를 지시하면 `DEV-541`이 코드에서 막은 것을 사람 손으로 하게 된다 |

**가장 깊은 자리는 코드였다.** 앞의 둘은 문서가 코드를 잘못 옮긴 것이지만, 셋째는 코드 자신의 안내가
어긋난 것이다. 같은 함수 안에서 경고는 "옮겨졌거나 거부됐다 — 확인한 뒤 판단한다"고 말하고 최종 메시지는
"지운 뒤 다시 실행한다"고 단정했다. **문서는 그 단정을 그대로 옮겼을 뿐이다.**

1. `deploy/single-host/build-bundle.sh` — `undo_note()`의 `TAG_LEFT` 분기가 대상을 먼저 보게 하고,
   이 실행의 커밋일 때만 **기대값을 건 lease**로 지우도록 지시한다. 다른 커밋이면 지우지 않고 새 버전이다.
2. `deploy/single-host/RUNBOOK.md` — 2.A 「발행이 중간에 멈췄다면」의 판정표에서 남의 태그를 분리하고,
   「남은 태그를 지우기 전에」를 신설해 대상별 처방을 적었다. 회복 절차에 `refs/tags/<v>^{}` 역참조와
   manifest 커밋 대조를 넣어 **온전 판정의 조건**으로 삼았다.
3. **SRS·PRD·화면·API·데이터·잡은 바뀌지 않는다.** 승인된 운반 계약(`CR-063`)의 회복 절차를 그 계약이
   이미 정한 방향(`DEV-541`의 소유 증명)에 맞추는 정정이다.
4. 회귀 넷이 고정한다 — 남의 태그 행에 삭제 명령이나 "같은 버전으로"가 들어가면 실패하고, 회복 절차에서
   역참조나 manifest 대조가 빠지면 실패한다.

### CR-064 반영 내역 (2026-09-03)

**상위 요구사항을 낮추는 CR이 아니다.** SRS·PRD 어디에도 섹션 확장·탭 전환의 모션 요구가 없다 — 파생 문서인 토큰 문서 §9가 상위 근거 없이 배정했고, 같은 절의 마지막 규칙("`prefers-reduced-motion`은 Conductor CSS가 처리하므로 **제품에서 별도 애니메이션을 추가하지 않는다**")과 어긋난 채 남아 있었다. 정정 방향은 표 쪽이다.

**모순의 뿌리.** 섹션 확장과 탭 전환은 Conductor 프리미티브가 아니다. Conductor에 `Tabs`도 `Accordion`도 없고(`Tabs.tsx`가 `Button` 조합으로 WAI-ARIA 탭을 직접 구현한다), 그 둘에 모션을 주려면 제품이 자체 CSS를 두어야 한다. **실측**: `apps/web`에 CSS 파일이 0건이고 `layout.tsx`가 `@conductor-by-89soone/css` 하나만 가져온다. 즉 표의 그 행은 적용 대상이 존재하지 않는 배정이었다.

**두 동작을 따로 감사했다.**

| 동작 | 실측 | 판단 |
| --- | --- | --- |
| 탭 전환 | `Tabs.tsx`가 선택 탭을 `variant="secondary"`, 나머지를 `ghost`로 그리고 패널을 즉시 교체한다 | 즉시 유지. 분석 화면의 탭은 고빈도 조작이고 전환을 넣으면 연속 조작에서 지연이 누적된다. 선택 피드백은 `Button`의 `motion.fast`가 이미 준다 |
| 섹션 확장 | `hidden={!expanded}` 다섯 곳 — `NeighborSequenceList`·`ReleaseContainmentList`·`CoChangeSection`·`PendingSection`·`RelationSection` | 즉시 유지. `hidden`은 `display: none`이라 높이 전환이 성립하지 않고, 넣으려면 제품 CSS가 필요한데 §9의 규칙이 금지한다. 상위 요구사항도 이 모션을 요구하지 않는다 |

1. `20_derived_ui_specs/pr_search_design_system_tokens.md` — **v0.2 → v0.3.** §9 표를 "Conductor 컴포넌트가 쓰는 토큰"으로 한정하고 "일반 전환(섹션 확장, 탭 전환)" 행을 뺐다. 오버레이 행에 퇴장과 Tooltip의 팝오버 예산을, 새 행으로 `motion.spin`(Spinner)을 적었다 — 0.3.0이 실제로 쓰는 것이다. §9.1을 신설해 두 동작의 감사 결과와 "상위 요구사항을 낮춘 것이 아니다"를 남겼다.
2. **SRS·PRD·화면·API·데이터·잡은 바뀌지 않는다.** 이 CR은 파생 문서 하나의 내부 모순을 정정한다.
3. **코드는 바뀌지 않는다.** 구현이 이미 스펙의 규칙 쪽을 지키고 있었고, 정정된 것은 그 규칙과 어긋나던 표다.

### CR-063 반영 내역 (2026-09-02)

**운반 경계를 정하는 CR이다.** `WP-071`이 "사내로 가져갈 파일 하나"를 정본화했으나 그 파일이 경계를 건너는 방법은 어느 문서도 정하지 않았고, 그 빈칸은 `CR-059`가 실측 없이 둔 "사내에서 인터넷에 닿지 않는다"는 전제 위에 있었다. 결정자가 사내 어느 위치에서든 github.com에 닿는다고 확인하면서 전제와 현실이 갈렸다(DEV-528). 새 제품 기능이 아니라 운반 절차의 정정이며, 이 저장소의 관행대로 착수 전 감사가 먼저 갔다(원장 6.65장).

**실측으로 판정했다.** 운반 파일은 1,073MB 하나이고(앞선 보고의 "3.7GB"는 검사용 사본까지 합친 값이었다), GitHub의 제한은 공식 문서로 확인했다 — 저장소 커밋은 100MiB 차단으로 불가, Git LFS는 가능하나 부적합, Release 자산은 파일당 2GiB 미만에 총량·대역폭 제한이 없고 API가 자산마다 SHA-256 digest를 준다. 이 저장소는 비공개·개인 계정이며 릴리스와 원격 태그가 없다.

1. `30_technical_architecture/pr_search_architecture_decision_records.md` — **v0.6 → v0.7.** `ADR-021`에 정정 절 — Context 표의 오프라인 전제가 가정이었음을 적고, 결정 3~6은 그대로이며 운반 경로 하나만 바뀐다는 것과 직접 pull·clone으로 가지 않는 이유 넷을 적었다.
2. `30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.11 → v0.12.** 8장에 `--release` 발행과 사내 다운로드 명령, 9.1장 흐름의 경계를 "물리적 반입 (네트워크 없음)"에서 "github.com (HTTPS · 읽기 토큰) — 닿지 않는 환경이면 조직의 반입 채널"로.
3. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **v1.2 → v1.3.** 6장 시크릿 표에 **GitHub Release 읽기 토큰** 행(반입 담당자의 자격 저장소, `.env`·번들·저장소에 두지 않음), Profile A 규칙에 그 토큰의 소재.
4. `40_delivery/pr_search_implementation_roadmap.md` — **v0.13 → v0.14.** 4.1장 흐름도에 `WP-072`.
5. `40_delivery/pr_search_work_packages.md` — **v2.19 → v2.20.** **`WP-072` 신설** — 요약 표 행과 상세 절. 배포 마일스톤 후속이며 `REL` 없음. 여섯 질문·구현 범위 열둘·제외 아홉·DoD 열다섯.
6. `40_delivery/pr_search_implementation_traceability.md` — **v6.27 → v6.28.** `DEV-528`·`DEV-529` 등록, 3장에 `WP-072` 행, 6.65장 감사 기록, 8장.
7. `docs/README.md` — 첫 사내 반입 문단에 발행·취득 경로 한 문장.
8. **구현은 `WP-072`가 했다 (PR #120, 2026-09-02)** — `build-bundle.sh`(`--release`: 초안 → 자산 → 발행, 발행 뒤 자산 대조, 전제 검사 셋, immutable releases 상태 출력), `deploy/single-host/RUNBOOK.md`(1장·2장·3장·6장·7장·8장), 회귀 시험 여섯. `DEV-528`·`DEV-529`를 닫았다. 시험 릴리스 둘을 실제로 발행해 토큰만 있는 환경에서 받아 digest를 대조하고 풀어 관통한 뒤 지웠다 — 원장 6.66장. **PR #119 머지 후 리뷰 하나가 실결함이었다** (`DEV-530`, 원장 6.65.1장): "릴리스는 불변이다"는 스크립트의 중복 검사를 뜻할 뿐 GitHub의 성질이 아니었다 — 이 저장소의 immutable releases 설정은 꺼져 있고, 켜져도 제목·본문은 편집 가능하다. 정본을 **담당자가 릴리스와 별도 채널로 전달하는 자산 SHA-256**으로 정하고 사내가 그 값·자산 digest·`sha256sum` 셋을 대조하게 했다. 같은 PR에서 닫았다.

**PR #120 머지 후 리뷰 셋 (2026-09-02).** 하나는 PR 중간 커밋 기준의 지적이라 병합된 main에서 근거만 답했다. 둘은 실결함이었다 — `DEV-531`(초안 id 조회 실패 시 초안 잔재)·`DEV-532`(curl 경로가 자산 id를 뽑지 못함). PR #121에서 닫았고 둘 다 실제로 돌려 확인했다 (원장 6.66.1장). PR #121 머지 후 리뷰 하나가 다시 실결함이었다 — `DEV-533`(되돌리기에 실패해도 "되돌렸다"고 보고). PR #122에서 닫았고 실패·성공 두 시나리오를 실행으로 확인했다 (원장 6.66.2장). PR #122 머지 후 리뷰 하나가 또 실결함이었다 — `DEV-534`(발행 뒤 되돌리기가 태그 삭제 실패를 숨김). PR #123에서 닫았고 태그 삭제 실패·성공 두 시나리오를 실행으로 확인했다 (원장 6.66.3장). PR #123 머지 후 리뷰 하나가 또 실결함이었다 — `DEV-535`(발행 응답만 잃으면 태그를 건너뜀). PR #124에서 닫았고 원격 태그 있음·없음 두 시나리오를 실행으로 확인했다 (원장 6.66.4장). PR #124 머지 후 리뷰 하나가 실결함이었다 — `DEV-537`(되돌리기가 남의 태그를 지울 수 있음). PR #125에서 닫았고 다른 커밋·같은 커밋 두 시나리오를 실행으로 확인했다 (원장 6.66.5장).

**릴리스는 저절로 불변이 아니다 (`DEV-530`).** 위 결정 ⑥의 "릴리스는 불변이다"는 이 스크립트가 같은 버전을 다시 발행하지 않는다는 뜻으로 한정한다. 발행 뒤의 변경을 막는 것은 저장소의 immutable releases 설정이며 그것을 켜는 것은 결정자의 몫이다 — 스크립트가 상태를 출력하고 런북이 권한다. 설정과 무관하게 정본은 별도 채널의 SHA-256이다.

**SRS를 건드리지 않았다.** 5.2 기술 제약 6번의 "인터넷에 노출하지 않는다"는 배포를 인터넷에 노출하지 않는다는 인바운드 제약이고, 사내에서 github.com으로 나가 파일을 받는 것은 그 제약과 무관하다. `NFR-005`는 읽기 토큰이 `.env`·번들·저장소 어디에도 들어가지 않으므로 새 노출 경로를 열지 않는다. PRD·화면·API·엔티티·잡도 바뀌지 않는다.

**번들을 버리지 않는 판단.** 사내가 github.com에 닿는다면 사내에서 직접 `docker pull`·`git clone`할 수도 있다. 그러나 번들 경로는 checksum·manifest로 출처가 증명되고 설치·복구·롤백까지 실제로 관통 검증됐으며, 직접 pull은 설치와 롤백을 외부 가용성에 묶고, Docker 데몬의 프록시·CA 경로는 미검증이며, "github.com에 닿는다"가 레지스트리 pull까지 뜻하는지도 확인되지 않았다. 첫 반입에서는 취득 단계만 바꾼다.

**바깥 checksum sidecar를 여전히 만들지 않는 판단.** `CR-062`는 "정책이 요구한다는 증거가 나올 때만"이라고 미뤘다. 그 증거 대신 GitHub가 자산마다 계산하는 digest가 있고, 릴리스 본문의 SHA-256은 같은 실행이 같은 값으로 만든다 — 관리할 파일이 생기지 않는다.

**크기를 줄이지 않는 판단.** zstd로 바꾸면 약 30%(745MB), 백킹 이미지를 뺀 업그레이드 번들은 약 180MB가 되지만, 둘 다 채널의 파일 상한이 있을 때만 의미가 있는 변경이다. Release 자산에는 그 상한이 없다. 실측값만 원장에 남기고 필요가 실증되면 별도 CR로 연다.

**신규 마이그레이션 없음.** 포장의 운반 경로이며 데이터 모델을 건드리지 않는다.

### CR-062 반영 내역 (2026-09-02)

**`WP-070`이 세운 반입 가능선과 사람이 실제로 수행할 반입 절차 사이의 빈칸을 닫는 CR이다.** 새 제품 기능이 아니라 배포 절차의 정정이며, 이 저장소의 관행대로 착수 전 감사가 먼저 갔다.

**세 주장을 나눠 실측했다** (DEV-524). "런북과 실행 도구가 다른 순서를 말한다", "`.env` 없는 최초 실행에서 `load`가 side effect 뒤에 실패한다", "fail-fast라고 적은 도구가 필수 검사를 side effect 뒤에 둔다"는 서로 다른 주장이고 하나가 참이라고 나머지가 따라오지 않는다. 셋 다 `prsctl` 118~135행과 런북 2장에서 각각 확인했다(원장 6.63장). 추측으로 DEV를 만들지 않았다.

1. `30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.10 → v0.11.** 8장의 외부망 명령을 실재하는 것(`./deploy/single-host/build-bundle.sh <version>`)으로 고쳤다 — `pnpm release:bundle`은 `package.json`에 없다. 9.1장 반입 흐름에 운반 아카이브를 넣고 `.env` 작성을 `load` 앞으로 옮겼다.
2. `40_delivery/pr_search_implementation_roadmap.md` — **v0.11 → v0.12.** 4.1장 흐름도에 `WP-071`을 `WP-070`과 반입 가능선 다음에 넣었다.
3. `40_delivery/pr_search_work_packages.md` — **v2.17 → v2.18.** **`WP-071` 신설** — 요약 표 행과 상세 절. 배포 마일스톤 후속이며 `REL` 없음.
4. `40_delivery/pr_search_implementation_traceability.md` — **v6.24 → v6.25.** `DEV-523`·`DEV-524` 등록, 3장에 `WP-071` 행, 6.63장 감사 기록, 8장.
5. **구현은 `WP-071`이 했다 (PR #117, 2026-09-02)** — `build-bundle.sh`(운반 아카이브 · 복사한 텍스트의 LF 정규화), `prsctl`(`load`의 검사 위치), `deploy/single-host/RUNBOOK.md`(외부망/사내망 경계로 재구성), `.gitattributes`, 회귀 시험 다섯. `DEV-523`·`DEV-524`를 닫았고, 구현 중 둘이 더 나와 같은 PR에서 닫았다 — `DEV-525`(PR #116 머지 후 리뷰: `WP-071`에 `FR-*` 참조 부재)·`DEV-526`(번들 텍스트가 빌더의 checkout 상태에 따라 CRLF — **실제로 풀어 보다 나왔다**). 원장 6.64장. PR #117 머지 후 리뷰 하나가 `DEV-527`(런북이 GHE App 자격을 `install` 뒤에 넣게 했다)이었고 PR #118에서 런북만 고쳐 닫았다 — 원장 6.64.1장.

**SRS를 건드리지 않았다.** 5.2 기술 제약 6번은 배포 프로파일을 정할 뿐 운반 아카이브의 형식을 규정하지 않고, `NFR-005`(시크릿 노출 0건)는 운반 아카이브가 기존 시크릿 검사 **뒤에** 만들어지므로 새 노출 경로를 열지 않는다. PRD·화면·API·엔티티·잡도 바뀌지 않는다. `glossary.md`도 손대지 않았다 — `CR-059`가 번들·반입을 용어집에 올리지 않은 선례를 따랐다.

**바깥 checksum sidecar를 만들지 않는 판단.** 정본이 둘이 되면 다음 변경에서 하나가 낡는다. 번들 안 `checksums/SHA256SUMS`가 이미 모든 파일을 덮고 `prsctl verify`가 그것을 검증한다. 운반 아카이브가 손상되면 `tar`가 풀지 못하고, 풀리는데 내용이 변조됐으면 `verify`가 잡는다. 사내 반입 정책이 바깥 checksum을 별도로 요구한다는 증거가 나오면 그때 더한다.

**`DEV-513`의 옆자리였다.** `CR-060`이 업그레이드 절에서 "`load`가 `.env`를 요구하는데 번들은 그것을 담지 않는다"를 닫으면서 같은 문서의 최초 설치 절을 보지 않았다. 그때 `require_env`의 **위치**를 물었다면 최초 설치 절도 함께 드러났을 것이다 — 정정한 자리 옆에 같은 결함이 있는지 묻는 것이 이 저장소가 반복해서 배운 것이다.

**신규 마이그레이션 없음.** 이 변경은 포장과 절차이며 데이터 모델을 건드리지 않는다. 다음 빈 번호가 024라는 것은 이유가 아니다.

### CR-061 반영 내역 (2026-09-01)

**`CR-060` 머지 후 리뷰 정정이다.** 둘 다 **`CR-060`의 정정이 한 겹 아래에 같은 결함을 남긴** 모양이었다.

1. `30_technical_architecture/pr_search_data_model.md` — **v0.16 → v0.17.** 마이그레이션 023 DDL과 "전수 검사를 만들 때 **무엇의 전수인가**를 먼저 물어야 한다"(DEV-518).
2. `30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.9 → v0.10.** 9.4장 복구 절차에 **별칭마다 순차 완료**와 그 이유(DEV-519).
3. `40_delivery/pr_search_implementation_traceability.md` — **v6.20 → v6.21.** `DEV-518`·`DEV-519` 등록, 6.62장.
4. **구현** — `packages/db/migrations/023_*`, `audit-grants.test.ts`(시퀀스 전수), `deploy/single-host/prsctl`(재색인 직렬화), `deploy/single-host/RUNBOOK.md`.

**`DEV-519`의 증상은 `CR-060`의 검증에서 이미 보고 있었다.** "재색인 예약 2/4"를 "예약 실패 둘"로만 적고 **왜 실패했는지 쫓지 않았다.** 쫓았다면 동시 실행 상한이 나왔고, 넷을 지운 뒤 하나만 세운 상태가 성공으로 보고되고 있다는 것도 나왔을 것이다.

**마이그레이션 023을 여는 근거는 실측이다.** 권한을 뺏으면 `permission denied for sequence`, 돌려주면 외래 키 검사까지 진행하는 것을 실제 배포에서 확인했다.

### CR-060 반영 내역 (2026-09-01)

**머지 후 리뷰 정정이다.** `CR-059`(PR #107)·`DEV-500` 정정(PR #108)·`WP-070`(PR #109)이 남긴 미해결 리뷰 열둘을 소스로 검증했고 **전부 실결함이었다.** 고치는 과정에서 자체 발견 둘이 더 나왔다(`DEV-516`·`DEV-517`).

1. **`10_requirements/srs_final.md` — baseline v2.19 → v2.20.** `NFR-004`의 `RPO 0`이 성립하는 조건을 명시했다(DEV-504). **지표를 낮추지 않았다** — 주기 백업만으로는 호스트 손실에서 그것이 성립하지 않는다는 사실을 적었다.
2. `10_requirements/requirements_screen_traceability_matrix.md` — **v1.2 → v1.3** (DEV-506). `NFR-004`·`NFR-008` 두 행에 프로파일 판정이 어디에서 이루어지는지 적었다. **화면 매핑은 바뀌지 않았고 그 사실도 함께 적는다** — `CR-057`이 `DEV-467`에서 세운 형식이다.
3. `30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.8 → v0.9.** 9.4장에 WAL 조건(DEV-504)·복구 순서 정정(DEV-511·514), 9.5장에 호스트 손실의 실효 RPO.
4. `30_technical_architecture/pr_search_data_model.md` — **v0.15 → v0.16.** **마이그레이션 022 DDL**과 `ALTER DEFAULT PRIVILEGES`를 쓰지 않는 이유(DEV-517).
5. `40_delivery/pr_search_release_validation_plan.md` — **v0.5 → v0.6.** Gate 6의 롤백 10분을 Profile A에도 **그대로 적용**한다(DEV-505). **파생 문서가 승인 범위를 좁히는 것도 넓히는 것과 같은 위반이다.**
6. `40_delivery/pr_search_implementation_roadmap.md` — **v0.10 → v0.11.** `REL-006` 슬라이스에 마이그레이션 022.
7. `40_delivery/pr_search_work_packages.md` — **v2.14 → v2.17.** `WP-070`에 보존해야 하는 FR 열둘(DEV-507), 소스 계보 DoD(DEV-508), 스모크 DoD를 **사실에 맞게** 정정(DEV-515).
8. `40_delivery/pr_search_implementation_traceability.md` — **v6.18 → v6.20.** `DEV-504`~`517` 등록, 6.61장.
9. **구현** — `deploy/single-host/prsctl`(프로비저닝·복구·스모크), `build-bundle.sh`(계보 검사), `compose.yml`(reindex 서비스·관리 토큰), `.env.example`, `deploy/single-host/RUNBOOK.md`, 통합 헬퍼 넷과 시험 여섯, `packages/db/migrations/022_*`, `audit-grants.test.ts`.

**`DEV-509`가 보여 준 것 — 정정이 시한폭탄을 옮길 수 있다.** `DEV-500`의 롤링 과거 3개월 창은 2026-12-01에 같은 실패를 되살리고 **그때도 새 회귀는 초록이다.** 방향을 바꿔 **롤링 과거 창을 없애고** 고정 날짜를 쓰는 시험이 자기 달을 선언하게 했다 — 실패가 미래로 미뤄지지 않고 **즉시** 온다.

**신규 마이그레이션 022를 연다 — 스키마 공백이 실행으로 증명됐다** (DEV-517). `CR-058`이 021에서 세운 규율("다음 빈 번호가 있다는 것은 이유가 아니다")을 그대로 따랐다: 여는 이유는 **재색인 세 잡이 `permission denied`로 죽은 실측**이다.

**리뷰가 지적한 자리를 고치는 것으로 끝내지 않았다.** `DEV-511`을 고쳐 복구가 실제로 재색인을 예약하게 만들자 `DEV-517`이 드러났고, 그것이 이 CR에서 가장 무거운 발견이다.

**`DEV-502`도 이 CR에서 닫는다.** 처음에는 소유 WP의 판단으로 미뤘으나 **CI 7회 중 2회를 막아 병합이 진행되지 않았다** — 현재 흐름을 막는 인접 결함은 절차대로 처리한다. 시험 쪽을 고쳤다: 첫 회차 즉시 실행과 주기 스윕에 취소 콜백이 없는 것은 **둘 다 옳은 성질**이므로 운영 코드를 건드리지 않고, 시험이 냉시작 스윕을 먼저 흘려보낸 뒤 계수를 되돌린다. `DEV-447`은 그대로 열려 있다.

### CR-059 반영 내역 (2026-09-01)

**`srs_final.md`을 두 자리만 고쳤다.** 이 변경은 배포·운영 아키텍처의 것이고 **사용자 기능을 하나도 만들지 않으므로** FR·화면·API·수용 기준·엔티티는 손대지 않았고 파생 UI 문서도 갱신 대상이 아니다 — 화면 행위가 바뀌지 않기 때문이다. 그럼에도 SRS를 건드린 이유는 5.2 기술 제약 6번이 **배포 수단 자체를 Kubernetes로 못박고 있어서**(DEV-496) 그것을 고치지 않으면 승인된 파일럿이 범위 밖이 되기 때문이다.

1. **`10_requirements/srs_final.md` — baseline v2.18 → v2.19.** 5.2 기술 제약 6번을 "사내 컨테이너 런타임"으로 넓히고 **Profile A/B**를 명시했다(DEV-496). "인터넷에 노출하지 않는다"는 유지된다. `NFR-004` 가용성 표 아래에 **어느 프로파일을 전제하는지**를 적었다 — **지표값은 하나도 바꾸지 않았고** 적용 조건이 없던 자리를 채웠다. `RPO 0`은 프로파일과 무관하게 유지된다(근거가 인프라 구성이 아니라 "원본 저장 후 202 응답" 규칙이다).
2. `30_technical_architecture/pr_search_architecture_decision_records.md` — **v0.5 → v0.6.** **`ADR-021` 신설.** 배포 오케스트레이션을 정한 ADR이 **지금까지 하나도 없었다** — Kubernetes는 SRS 제약과 인프라 문서에만 있었고 그 선택의 근거는 기록된 적이 없다. 결정 여섯: 프로파일 둘, 프로세스 경계 유지, 오프라인 번들, 계보 증명, 단방향 다운스트림, configuration 우선.
3. `30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.7 → v0.8.** 2장에 **`pilot` 환경 행**과 프로파일 열(DEV-497), **3.0장 배포 프로파일 절 신설**, 3.1장 배포 단위 표에 **Profile A 열**, 4.1장 `OD-006`에 **좁힘 기록**, 6장에 Profile A 노출 규칙, 7장에 Profile A 저장 수단, 8장에 단일 호스트 명령, 9.1장에 반입 흐름, 9.4장에 **정본별 백업 전략**, 9.5장에 Profile A 재해 복구, 11장에 제한 넷.
4. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **v1.1 → v1.2.** 6장 시크릿 표에 **프로파일별 저장 위치** 열을 더하고(DEV-499), **데이터베이스 접속 주체**를 명시했다(DEV-503) — `prs_app`도 `NOLOGIN` 그룹 롤이라 `DATABASE_URL`의 주체가 정의된 적이 없었다. `DEV-416`이 관리 연결에 쓴 것과 같은 형태로 닫되, 애플리케이션 쪽은 **세션 기본 역할**로 집는다(코드 변경 없음). Profile A의 시크릿 파일 규칙 넷도 명시했다 — 특히 **어떤 번들에도 담지 않는다**와 **Compose 매니페스트에 리터럴을 쓰지 않는다**.
5. `30_technical_architecture/pr_search_system_architecture.md` — **v0.3 → v0.4.** 4.1 배포 단위 표의 "관리형"·"PVC"가 Profile B의 표현임을 밝히고, **배포 단위의 집합과 상태성은 프로파일이 바꾸지 않는다**를 적었다.
6. `40_delivery/pr_search_implementation_roadmap.md` — **v0.9 → v0.10.** **4.1장 첫 사내 반입 마일스톤 신설** — 새 `REL`을 만들지 않은 이유(새 요구사항이 없다)와 `REL-006` 잔여 WP보다 앞서는 이유를 적었다. 9장 Known Limitations에 셋(SPOF·미실측 항목·단방향 반출 불가).
7. `40_delivery/pr_search_release_validation_plan.md` — **v0.4 → v0.5.** **3.1장 프로파일별 게이트 판정 신설.** `VERIFIED (external)` / `NOT RUN — internal environment required` / `NOT APPLICABLE (Profile A)` 셋을 정의하고, **외부에서 통과시키면 안 되는 항목 목록**을 명시했다 — `ACC-06`을 합성 데이터로 만들어 내는 것을 금지한다.
8. `40_delivery/pr_search_work_packages.md` — **v2.13 → v2.14.** **`WP-070` 신설** — 요약 표 행과 상세 절. 구현 범위 열넷, 제외 일곱, DoD 열일곱이며 **하나의 사용자 여정으로 정의**했다.
9. `40_delivery/pr_search_implementation_traceability.md` — **v6.16 → v6.17.** `DEV-490`~`499` 등록, **3장에 `WP-070` 행 신설**(`CR-058`이 `DEV-477`에서 배운 것을 지킨 자리다), 6.59장 감사 기록, 7장 제한 셋.
10. `docs/README.md` — 배포 프로파일과 반입 모델을 문서 인덱스에 반영.

**새 ADR을 만드는 판단은 기존 ADR 계약을 조사한 뒤에 내렸다.** ADR 1장은 "구현 비용, 운영 리스크, 확장성, 보안, 개발 속도에 영향을 주는 아키텍처 결정"을 담는다고 정하며, `ADR-001`~`020` 전수 확인에서 **배포 오케스트레이션을 정한 결정이 하나도 없었다.** 이 CR이 정하는 것은 운영 리스크(SPOF를 승인된 trade-off로 받는다)·확장성(Profile B 승격 경로)·구현 비용(오프라인 번들 빌드)에 걸치므로 그 정의에 부합한다. **번호가 비었다는 것은 이유가 아니다.**

**신규 마이그레이션을 만들지 않았다.** 이 변경은 배포 형상과 반입 경로를 정할 뿐 데이터 모델을 건드리지 않는다. `CR-058`이 마이그레이션 021을 열 때 세운 규율("다음 빈 번호가 있다는 것은 이유가 아니다")을 반대 방향으로 적용한 것이다 — **스키마 공백이 증명되지 않으면 열지 않는다.**

**역사를 지우지 않는 방식을 썼다.** `OD-006`의 전용 3노드 결정은 그대로 두고 4.1장에 **좁힘 기록**을 덧붙였고, `deploy/k8s/`는 삭제하지 않고 Profile B의 자산으로 남겼다. `CR-058`이 `REL-005`의 "WP 4/4 done"을 그대로 둔 것과 같은 판단이다 — **당시의 결정은 당시 범위에서 옳았고, 새 범위가 그것을 거짓으로 만들지 않는다.**

**`DEV-503`은 실제로 세워 보다 나왔다.** `WP-070`이 단일 호스트에서 실제 기동을 시도하자 `ingest-gateway`의 `/healthz`가 503을 답했고, **그 엔드포인트만 실제로 PostgreSQL 연결을 확인한다**(다른 둘은 무조건 `ok`를 답한다 — 그것이 `DEV-495`다). `DEV-416`이 같은 사실(`prs_app`·`prs_admin` 둘 다 `NOLOGIN`)을 2026-08-29에 이미 적었는데 **닫은 것은 `prs_admin` 쪽뿐이었다** — 문장의 앞부분이 뒷부분과 함께 닫히지 않은 자리이며, 매니페스트를 적용해 본 적이 없어 여섯 달 가까이 드러나지 않았다.

**이 CR이 답하지 않은 것 둘을 남긴다.** ① **프록시 지원**(DEV-494) — 사내망이 프록시를 강제하는지 실증되지 않았으므로 설정 표면을 추측으로 만들지 않는다. ② **Profile B의 `web` 매니페스트**(DEV-492) — 클러스터가 없어 검증할 수 없는 매니페스트를 지금 하나 더 만드는 것은 `DEV-001`이 이미 겪은 "적용해 본 적 없는 매니페스트"를 늘리는 일이다.

### CR-058 반영 내역 (2026-08-31)

**`srs_final.md`을 고치지 않았다.** `FR-SRCH-005` AC-1은 이미 `author_team` 키를 지원 목록에 담고 있고 `FR-STAT-006`은 이미 approved다 — 이 CR이 찾은 것은 **승인된 행위가 딛고 설 계약과 그 진행 상태를 적는 회계**의 공백이지 요구사항의 공백이 아니다. 파생 UI도 API 계약도 손대지 않았다: 새 화면 요소도 새 API surface도 생기지 않는다.

1. `40_delivery/pr_search_implementation_roadmap.md` — **v0.7 → v0.8.** `REL-005` 행의 exit criteria에 **author-team 축이 `CR-056`에서 후발 발견된 carryover**임을 적고, `REL-006` 행의 포함 요구사항에 `FR-SRCH-005`·`FR-STAT-006`(carryover)을, 주요 산출물에 `WP-069`를 더했다(DEV-479). 5장 슬라이스 표의 `REL-006` 행에 `team`·`team_membership` 표와 작성자 팀 동기화를 더했다. 6장의 "남은 오픈 결정은 OD-008 하나다"를 **"오픈 결정은 하나도 남지 않았다"**로 고쳤다(DEV-480). **`FR-STAT-006`·`FR-SRCH-005`를 `REL-005`·`REL-002`에서 지우지 않았다** — 요구사항의 역사적 소유 릴리스는 그대로이고, 이 CR이 적는 것은 **어느 WP가 그 축을 종결하는가**다
2. `40_delivery/pr_search_work_packages.md` — **v2.11 → v2.12.** `WP-069`을 다시 썼다 — 계약 선행 문단, 구현 범위 여덟, 제외 넷, DoD 열둘. 결정 셋(조직 범위·조회 단위·낡음의 판정)과 그 이유를 담았다
3. `30_technical_architecture/pr_search_data_model.md` — **v0.14 → v0.15.** 4장에 **마이그레이션 021 DDL**(`team_membership`, `org_team_sync`)과 그 둘이 `team_member`와 무엇이 다른지를, 6장에 `author_team_ids`의 **출처·신선도·부재의 뜻**을 적었다
4. `30_technical_architecture/pr_search_backend_architecture.md` — **v0.5 → v0.6.** 6.3절 신설 — 작성자 팀 해석의 조회 단위, 낡음의 판정, 재색인이 GHE를 부르지 않는 이유(`ADR-004`)
5. `40_delivery/pr_search_implementation_traceability.md` — **v6.12 → v6.13.** `DEV-477`~`487` 등록(전부 resolved), **3장에 `WP-069` 행 신설**(DEV-477), `DEV-453`의 소유 WP 정정(DEV-478), 7장 제한 행 갱신, 6.57장 감사 기록

**신규 마이그레이션을 여는 판단은 스키마를 먼저 대조한 뒤에 내렸다.** `CR-057`이 `safe_marker`에서 그렇게 했고 그때는 열지 않았다. 여기서는 반대 결론이 나왔고 근거가 둘이다. ① `ADR-004`의 불변 조건이 "모든 엔티티 문서는 PostgreSQL 데이터만으로 재구성 가능해야 한다"이고 `reindex.ts`는 실제로 GHE를 한 번도 부르지 않는다 — 그러므로 `WP-069`의 DoD("소속 변경이 재색인으로 반영된다")를 만족하려면 소속이 PostgreSQL에 있어야 한다. ② 그것을 담을 표가 없다: `team_member.user_id`가 `app_user(user_id)`를 참조하므로 **로그인한 적 없는 GHE 사용자는 들어갈 수 없고**, 그것이 바로 PR 작성자의 대부분이다. **다음 빈 번호가 021이라는 것이 021을 만드는 이유는 아니다** — 위 둘이 이유다.

**`allowed_team_ids`의 구현을 복사하지 않는다.** `WP-068`의 값은 **저장소를 볼 수 있는 팀**이고 이 CR의 값은 **작성자가 속한 팀**이다. 둘을 한 필드로 합치거나 한 표에 담으면 **접근 권한을 성과로 읽게 된다**(`CR-053`, `DEV-382`). 다만 **한 가지는 그대로 가져온다**: 조직 팀을 조회한 김에 `team` 레지스트리에 등재하는 일이다(`team-scope.ts`가 `team:` 질의를 위해 하는 것과 같은 이유이며, 하지 않으면 `author_team:`이 조용히 빈 결과를 낸다 — DEV-483).

**감사에서 탈락한 후보 넷 (가짜 발견을 남기지 않으려 기록한다).** ① **`[]`와 부재의 구분** — `WP-069`가 이미 "빈 배열과 미조회를 같은 값으로 두지 않는다"를 정한다. 이 CR은 그 경계가 **무엇으로 판정되는지**만 더했다(DEV-486). ② **팀 ID 체계** — `CR-053`/`DEV-382`가 `team.team_id`를 이미 정했고 `query-builder.ts`가 같은 레지스트리를 쓰며 다른 필드를 본다. 새 ID 체계를 만들 자리가 아니다. ③ **ES 매핑** — `author_team_ids: { type: 'long' }`이 이미 있다. 타입이 바뀌지 않으므로 **새 인덱스 버전을 만들지 않는다.** ④ **팀 계층 전개** — `WP-069`의 제외에 이미 있고 승인된 요구사항이 없다.

**이 CR이 답하지 않은 것 하나를 남긴다.** 소속 변경이 **실시간으로** 문서에 반영되는 경로는 만들지 않았다. `WP-069`의 DoD가 요구하는 것은 재색인·백필이며, `JOB-AUTH-001`이 이미 `member`·`team` 웹훅으로 권한 캐시를 무효화하고 있으므로 같은 사건에서 문서를 소급하는 것은 **가능하지만 승인되지 않았다.** 그것을 여기서 만들면 검증하지 않을 경로를 계약에 쓰게 된다 — 원장 7장에 제한으로 남긴다.


### CR-057 반영 내역 (2026-08-31)

1. **`srs_final.md` — baseline v2.16 → v2.17.** `OD-008`을 `(a) release_manager 전용`으로 `resolved` 전환하고 그 근거를 행에 담았다. 14장 말미의 "OD-008만 Could 우선순위 FR을 차단한다"와 "기한이 아직 오지 않았다"를 사실과 맞췄고, `OD-008` 기한 도래 문단을 더했다 — **open 오픈 결정은 하나도 남지 않았다.** `FR-SEQ-006`의 AC 다섯과 예외 처리는 **그대로다**: 이 CR은 그 AC들이 딛고 설 계약을 아래 문서에 적을 뿐이다
2. `10_requirements/prd.md` — **v1.9.** 14장 `OD-008` 행을 `(a) 릴리스 매니저만 — 채택`으로 닫고, 기한 도래 문단을 더했다
2-1. `10_requirements/requirements_screen_traceability_matrix.md` — **v1.2** (DEV-467). `FR-SEQ-006` 행에 이 CR로 매핑이 바뀌지 않았다는 사실과 흐름 소유(`FLOW-003`)를 적었다. **매핑이 그대로여도 적어야 한다** — 그러지 않으면 닫힌 캐스케이드가 요구된 추적 증거를 갖지 못한다
3. `30_technical_architecture/pr_search_api_contracts.md` — **v0.21.** **`API-SEQ-004` 상세 절 신설**(DEV-458) — `API-SEQ-002`의 작성 관행대로 목적·요청·응답 JSON·검사 순서 표·오류 목록을 적고, 「멱등과 동시성」·「감사」 하위 절을 두었다. 3장 카탈로그의 권한 칸을 `GET 인증 + 접근 범위 / PUT release_manager`로 갈랐다(DEV-461). 6장 오류 모델에 `SEQUENCE_NOT_FOUND`(400, DEV-460)와 `SEQUENCE_EPOCH_STALE`(409, DEV-459)을 등재했다
4. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.14.** `W-004-MARKER`에 **등록 대상 서수는 끝 앵커**임을 적고(DEV-462) 임의 입력창을 두지 않는 이유를 함께 남겼다. 권한 절에 읽기·쓰기 경계와 "화면의 비활성은 보안 경계가 아니다"를 더했다
4-1. `20_derived_ui_specs/pr_search_screen_flow_spec.md` — **v0.5** (DEV-466). `FLOW-003`에 7단계(표식 등록)와 예외 다섯을 더하고 흐름-요구사항 표에 `FR-SEQ-006`을 실었다. **파생 UI 캐스케이드의 `flow/state` 단계를 건너뛰고 컴포넌트·QA로 간 것**이 이 공백을 남겼다
5. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.14.** W-004에 `marker_absent`·`marker_epoch_stale`·`marker_target_unresolved` 셋을 더했다. 무효 표식은 **감추지도 옮겨 읽지도 않는다**
6. `20_derived_ui_specs/pr_search_ui_component_spec.md` — **v0.11.** `C-031`에 `targetSeq`·`currentEpoch` prop, 상태 일곱, 사용 규칙 다섯, 접근성 규칙을 더했다 — 카드가 서수를 **고르지 않고 받는다**
7. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.13.** `QA-W004-12`~`14`를 정밀화했다 — 막히는 것은 쓰기뿐이라는 것, 등록자·시각을 서버가 만든다는 것, 무효 표식을 감추지도 옮겨 읽지도 않는다는 것. **새 QA ID를 만들지 않았다**: 확인할 성질이 늘어난 것이 아니라 기존 셋이 무엇을 확인하는지가 정밀해졌다
8. `30_technical_architecture/pr_search_backend_architecture.md` — **v0.5.** 6.2 표 아래에 "멱등 키는 값이지 뜻이 아니다"(DEV-463). partial unique index가 멱등을 대신 보장하지 못하는 이유와, 유일 제약을 직렬화 수단으로 쓰지 않는 이유를 적었다
9. `40_delivery/pr_search_work_packages.md` — **v2.11.** `WP-041`에 계약 선행 문단, 구현 범위 정밀화, **제외 둘 신설**(표식 이력 조회 API, `API-SEQ-005`), DoD 넷 추가
10. `40_delivery/pr_search_implementation_traceability.md` — **v6.8.** `DEV-458`~`463` 등록(전부 resolved), 6.55장 감사 기록

**신규 마이그레이션을 만들지 않았다.** 기존 `safe_marker`(마이그레이션 002)가 승인 계약을 충족하는지 먼저 검증했다 — `note`의 500자 `CHECK`, `superseded_at IS NULL`인 partial unique index, `seq_epoch` 열, `superseded_at`이 AC-1·AC-2를 이미 갖는다. 실 PostgreSQL로도 대조했다. **다음 ID가 021이라는 것은 021을 만들 이유가 아니다.**

**PR #101 리뷰 넷이 전부 실결함이었다 (DEV-464~467).** 계약을 채우는 PR이 **자기가 새로 쓴 자리**에서 넷을 지적받았다. ① **P1 — 멱등이 시간을 건너 성립하지 않는다.** "현재 표식과 같은가"는 한 시점의 비교이며, 응답을 잃은 요청이 재시도되기 전에 다른 사람이 표식을 옮기면 그 비교가 "다르다"를 답해 **더 새로운 안전 경계를 조용히 되돌린다.** `expected_marker_seq` 조건부 갱신과 `SAFE_MARKER_CONFLICT`(409)로 고쳤다. **재시도의 중복 방지와 잃어버린 갱신의 차단은 다른 문제이며**, 요청 멱등 키를 저장하는 흔한 해법은 앞엣것만 푼다 — 표식을 뒤로 옮기는 것 자체가 정당한 동작이라 이 자원에서는 뒤엣것이 더 위험하다. ② **P2 — 메모 변경이 재시도로 접혀 사라진다.** 6.2의 멱등 키에 `note`가 없다는 사실에서 "메모는 변경이 아니다"를 끌어낸 것이 오류였다: 그 키는 **같은 요청을 알아보는 재료**이고 무엇이 변경인지는 AC-2가 정하며 AC-5가 "등록·**변경**"을 감사 대상으로 요구한다. ③·④ **P1 둘은 절차다** — 파생 UI 캐스케이드에서 `flow/state`를 건너뛰었고(DEV-466), SRS를 올리면서 같은 패스에서 매트릭스를 갱신하지 않았다(DEV-467). 셋째의 공백에는 실질이 있었다: **화면 흐름 명세만 따라 `FLOW-003`을 완주한 구현은 `FR-SEQ-006`을 하나도 만들지 않고 끝낼 수 있었다.**

**검사 순서가 그 다음 함정이었다.** `expected_marker_seq`를 도입하면 정직한 재시도가 **자기가 만든 상태 때문에** 409를 받는다 — 재시도의 `expected`는 이미 낡았다. 완전 일치 검사를 조건부 검사보다 **먼저** 두어야 재시도의 멱등과 잃어버린 갱신의 차단이 함께 성립한다. 하나만 두면 각각 다른 결함이 남는다.

**문서만 바꾸는 CR이 아니게 됐다.** `packages/contracts/src/error-codes.test.ts`가 계약 6장을 직접 파싱해 `ERROR_CODES`와 1:1로 대조하므로, 오류 코드 둘을 문서에 더하는 순간 그 시험이 깨진다 — 그 파일 주석이 "문서에 코드가 추가되면 이 테스트가 먼저 깨진다"고 적어 둔 그대로다. enum과 상태 매핑에 두 줄을 함께 넣었다. **DEV를 발급하지 않는다**: 결함이 아니라 `WP-001`이 세운 장치가 설계대로 동작한 것이다. 다만 다음 계약 감사는 이 사실을 전제해야 한다 — 계약 6장에 코드를 더하는 CR은 언제나 `@prs/contracts`를 함께 바꾼다.

**`API-SEQ-005`를 함께 채우지 않았다.** 같은 모양의 공백이 있다는 것은 확인했으나 그것은 `WP-042` 착수 전 감사의 대상이다 — "SEQ API 전부 정리"로 만들면 이 슬라이스가 검증하지 않을 계약을 함께 쓰게 된다.

**`safe_marker.set`을 활성으로 옮겼다 (SRS baseline v2.17 → v2.18, 2026-08-31).** `WP-041`이 그 기능을 실제로 세우면서 `FR-AUTH-004` AC-1 정본 표의 그 행이 **미활성 → 활성**이 됐다. **요구사항의 변경이 아니라 사실의 반영이다** — 그 표의 상태 칸은 "계약이 승인했으나 기능이 아직 없다"를 뜻하므로 기능이 서는 순간 이전 값이 거짓이 된다. 근거가 이 CR이므로 baseline을 고칠 수 있다는 규율이 지켜졌고, 남은 미활성은 `export.create`(`WP-044`) 하나다.

**`API-SEQ-004` v0.22 — 감사 절이 리뷰로 늘어난 검사를 따라가지 않았다** (DEV-470). 이 CR의 리뷰 정정이 검사 8(`SAFE_MARKER_CONFLICT`)을 더하면서 "3~6의 거절을 기록한다"는 문장을 함께 고치지 않았고, `result_code`의 어휘도 어디에도 없어 **감사 로그를 읽는 사람이 사유를 복원할 수 없었다.** 둘 다 계약에 적었다 — 여섯 코드와 각각의 `target` 형식, 그리고 `target`이 `null`인 두 자리가 왜 `null`인지.

### CR-056 반영 내역 (2026-08-30)

1. **`srs_final.md` — baseline v2.15 → v2.16.** 신규 FR 없이 기존 수용 기준을 정밀화했다. `FR-STAT-005` **AC-1·AC-2**에 `0` 구간을 신설하고(첫 구간에 흡수하지 않는 이유를 함께 적었다), **AC-4**에 "선택한 구간의 문서만 가리켜야 한다"와 `unknown`의 예외를, **AC-5**에 "모름은 값을 쓰지 않는 것으로 표현한다"와 **일부만 아는 것은 모름이 아니라는 경계**를 더했다. `FR-SRCH-005` **AC-1**에 `changed_files`·`changed_lines` 수치 범위 키를 더했다 — AC-4를 성립시키는 재료이며, `seq`와 달리 시퀀스 공간 지목을 요구하지 않는다
2. `30_technical_architecture/pr_search_api_contracts.md` — **v0.20.** 지원 키 목록과 범위 문법 표에 두 키 등재, 필드 매핑 표에 두 행 추가. `API-STAT-004` 예시 응답을 **구간마다 다른 `drill_down_query`**로 다시 쓰고 `0` 구간을 넣었다. 상한 없는 구간이 `2147483647`을 끝으로 쓰는 이유(열린 범위 문법을 만들면 `seq`를 포함한 모든 범위 키의 의미가 넓어진다)를 적었다
3. `30_technical_architecture/pr_search_data_model.md` — **v0.14.** 6장에 "변경 규모를 모르는 문서에는 그 넷을 쓰지 않는다"와 부재가 정렬·검색에 나타나는 방식을. 8장의 `changed_lines` 소급 스크립트를 **`ctx._source`로 읽고 두 값이 있을 때만 쓰도록** 다시 적었다(DEV-452) — 기존 문구는 Painless에서 선언되지 않은 변수를 참조해 **그대로 돌리면 실패한다**
4. `40_delivery/pr_search_work_packages.md` — **v2.10.** **`WP-069` 작성자 소속 팀 채우기 신설**(REL-006, DEV-453). `WP-037`의 제외 항목이 소유를 정하지 않아 승인된 팀 집계가 구현 가능한 상태가 아니었다 — 그 제외를 `WP-069` 참조로 다시 쓰고 "빈 결과는 누락이 아니라 미구현"임을 명시했다. `REL-006` 커버리지 4 → 5
5. `40_delivery/pr_search_implementation_traceability.md` — **v6.5.** `DEV-449`~`453` 등록(전부 resolved), 6.53장 검증 기록

**구현.** 질의 파서에 두 범위 키(`packages/query/src/keys.ts`)와 `replaceNumericRange`(`serialize.ts`)를, ES 빌더에 필드 매핑을, 집계에 `0` 구간과 **구간별 드릴다운**을, 투영에 **모름의 표현**을 넣었다.

**개수 단언 하나를 목록 단언으로 바꿨다.** `parse.test.ts`가 지원 키를 "17종"으로 세고 있어 키가 늘자 깨졌다 — `CR-054`가 감사 대상에서 내린 판단과 같은 자리다. 개수는 *무엇이* 늘었는지 말하지 않아 다음 사람이 숫자만 고치고, 목록은 어긋난 키를 실패 메시지가 그대로 보여 준다.

**시험이 판정을 좁혔다.** 처음 구현은 `enrichment_pending`이면 규모 필드를 무조건 뺐는데, 기존 시험 하나가 **보강이 일부만 실패한 문서에서 실제로 받은 파일 둘을 버리는 것**을 잡았다. 보강은 항목마다 따로 시도하므로 파일 목록을 받았다면 그 수는 사실이고, 모름은 **보강이 끝나지 않았고 그 목록도 비어 있을 때**다. 계약 문구도 그 경계로 다시 썼다.

**검증.** `typecheck` · `lint` · `lint:deps` 통과. 단위 1880(+13) · 회귀 288. 적대적 변이 넷(0 구간 제거 · 드릴다운 범위 제거 · 투영 조건 제거 · 범위를 갈아 끼우지 않고 덧붙이기)을 걸어 **넷 모두 킬**했다. 문서 검증기는 `main` 대비 새 경고 0건. **CI는 판정에 쓰지 못했다** — 계정 결제 문제로 잡이 시작조차 하지 않는다.

### CR-055 반영 내역 (2026-08-30)

1. **`srs_final.md` — baseline v2.14 → v2.15.** 신규 FR 없이 기존 요구사항을 정밀화했다. `FR-ING-009`에 **AC-11**(등록 검토 요청의 처리 결과 `pending`·`fulfilled`·`dismissed`, 승인 중간 상태 금지, AC-10 비공개 경계 유지, 재요청이 종료를 되돌리지 않음)과 **AC-12**(브랜치 추가 시 채번 요청, 백필과 별개)를, `FR-ADMIN-002`에 **AC-6**(러너 도달성 — 잡 유형 존재는 실행 가능의 뜻이 아니다)과 **AC-7**(실행 가능 동작을 서버가 산출)을, `FR-ING-008`에 **AC-7**(별칭별 인덱스 상태 조회, 미확인과 0의 구분)을, `FR-ING-011`에 **AC-7**(즉시 실행, 주기 실행과 같은 구현·비동시)을 더했다. `FR-AUTH-004` AC-1 정본 표에 `repository_registration_request.dismiss`를 **활성**으로 등재
2. `10_requirements/prd.md` — **v1.8.** SCN-006 대체 흐름에 요청 종료의 두 갈래와 **요청자가 통보받지 않는다**는 사실을 명시
3. `10_requirements/glossary.md` — **v0.7.** `등록 검토 요청` 신설, `조정 스캔`을 주기·수동 두 진입점으로 다시 씀
4. `10_requirements/requirements_screen_traceability_matrix.md` — **v1.1.** `FR-ING-009`·`FR-ING-008`·`FR-ING-011`·`FR-ADMIN-002` 네 행 갱신. **AC-11의 처리 상태는 A-002에만 나타난다**를 못박음
5. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.13.** `A-002-REQUESTS`를 처리 경로까지 정의하고 `request.prefill`·`request.dismiss` 이벤트 신설. **예상 소요 표시를 실측 진행률로 교체**(DEV-435). A-003에 `job.pause`·`job.resume` 이벤트와 `allowed_actions`·미확인 값·수동 스캔 세 규칙
6. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.13.** A-002에 `requests_empty`, A-003에 `index_status_unavailable` 신설. A-002 `operation_pending`의 조건을 요청 처리까지 넓힘
7. `20_derived_ui_specs/pr_search_ui_component_spec.md` — **v0.10.** **`C-071 RegistrationRequestQueue` 신설** — 번호는 `C-048`~`C-070`이 GitHub Operations 축에 배정되어 있어 마지막 뒤에 붙였다(재번호화하지 않는다). `C-043`에 `prefill`과 채번 잡 표시, `C-044`에 `allowed_actions`, `C-046`에 미확인 규칙. 중복 방지 규칙에 한 행 추가
8. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.12.** `QA-A002-06~11`, `QA-A003-12~16` 신설
9. `20_derived_ui_specs/pr_search_screen_flow_spec.md` — **v0.4.** FLOW-007에 수동 스캔 단계와 예외 둘(중복 실행 409, `archive_only`가 데이터를 요청조차 하지 않음), FLOW-008에 예외 둘(확인이 잡 생성보다 먼저, 실패 시 자동 재요청 금지)
10. `30_technical_architecture/pr_search_api_contracts.md` — **v0.17.** **`API-ADM-009` 신설** — 커서 키셋, 오프셋 없음, `dismiss` 하나만 받는 `PATCH`, 승인은 성공한 등록. `API-ADM-002`에 받는 유형과 `target` 형식 표(`reconcile`은 서버가 `all`, `sequence_assign`은 서버가 `owner/repo@브랜치`를 조립)와 `allowed_actions`. **`API-ADM-004`에 `GET` 신설** — 이력은 `job` 정본에서 도출하고 새 표를 만들지 않는다. `API-ADM-001`의 오프셋 부채를 등재(DEV-433)
11. `30_technical_architecture/pr_search_data_model.md` — **v0.13.** `ENT-CORE-008`에 마이그레이션 `020` DDL — 상태 CHECK, **종료 상태와 종료 시각의 쌍방 제약**, 메모 길이 상한, 대기열 인덱스. **기존 행을 소급하지 않는 이유**와 `resolved_by`가 `SET NULL`인 이유를 함께 적었다
12. `30_technical_architecture/pr_search_async_events_jobs.md` — **v0.5.** `JOB-ING-005`·`JOB-SEQ-001`의 방아쇠에 수동 경로 등재. **7.1절 신설** — 두 경로가 만나는 자리, 배포 불변식을 락 대신 쓰는 이유, **조정 스캔의 head 복구는 계속 이벤트로 보낸다**(DEV-180의 자물쇠를 되살리지 않는다)
13. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **v1.1.** `THR-045` 신설(처리 결과가 요청자에게 돌아가면 존재·정책 신탁이 된다). 7.1에 **감사 `detail`이 어느 평면의 값인지 함께 판정한다**는 규칙
14. `40_delivery/pr_search_work_packages.md` — **v2.8.** `WP-040`을 다시 썼다 — 백엔드 구현 범위 여덟, 관련 요구사항 트레이스 정정(DEV-434), **DoD의 QA 개수 열거를 정본 참조로 교체**(CR-054 교훈), 제외 셋 신설, 네트워크 호출 수로 확인을 증명하라는 조항
15. `40_delivery/pr_search_implementation_traceability.md` — **v6.1.** `DEV-428~435` 신규 등록(428~432·434·435 resolved, **433 open**), `WP-040` 행에 계약 선행 기록

**PR #88 리뷰가 넷을 더 찾았고 넷 다 실결함이었다.** ① **P1 — 감사 메모를 저장할 수 없는 필드에 배정했다.** `API-ADM-009` 절이 종료 사유를 `detail`에 쓰라고 했는데 `audit_record`의 자유 칸은 `target`과 `query` 둘뿐이고, **같은 CR이 만든 `FR-AUTH-004` 정본 표는 그 메모를 `query` 칸에 넣어 두었다** — 한 CR 안에서 두 문서가 어긋났고, 그대로 구현하면 사유가 그냥 빠진다. ② **P2 — 단일 복제본 배치를 직렬화 근거로 삼았다.** 복제본 1개는 프로세스 수를 제한할 뿐 **한 프로세스 안의 독립적인 비동기 루프 둘을 직렬화하지 못한다** — 주기 스윕이 GHE 응답을 기다리는 `await` 지점에서 잡 러너가 깨어나면 같은 전량 스캔이 겹친다. 락을 더하는 대신 **루프를 하나로 만들어** 호출 지점 자체를 하나로 줄였다. `JOB-SEQ-001`은 advisory lock이 이미 있어 같은 문제가 없으며, **두 잡의 근거가 다르다는 것을 문서에 명시했다.** ③ **P2 — 지문 불일치에 틀린 오류 코드를 배정했다.** 오류 모델이 `CURSOR_INVALID`(훼손·만료·서명)와 `CURSOR_QUERY_MISMATCH`(커서는 멀쩡한데 조건이 다름)를 이미 가르는데 전자를 적었다. ④ **P2 — 와이어프레임의 주요 컴포넌트 목록이 따라오지 않았다.** 컴포넌트 명세에 `C-071`을 만들고 `C-013` 재사용을 금지해 놓고, A-002 와이어프레임은 여전히 `C-013`만 이름 부르고 있었다.

**둘째가 이 리뷰의 값이다.** "배포가 복제본을 하나로 두었으니 직렬"이라는 논증은 **프로세스 경계와 실행 경계를 같은 것으로 본 오류**다. 같은 문서에서 `JOB-SEQ-001`의 advisory lock을 안전 근거로 들면서 `JOB-ING-005`에는 배치를 근거로 든 것이 그 자리를 드러낸다 — 근거의 종류가 다르면 보장하는 것도 다르다.

**감사가 계약 밖의 결함도 하나 찾았다 (DEV-436).** 백필 러너만 종료를 무방비 `finishJob`으로 기록해 **운영자의 취소를 `completed`로 덮을 수 있다.** `FR-ADMIN-002` 예외/실패 처리가 이미 `cancelled` 기록을 요구하므로 **계약은 옳고 코드가 틀렸다 — 이 CR은 그것을 고치지 않고 등재만 하며, `WP-040` 구현이 고친다.** `DEV-196`이 `finishJobIfRunning`을 만들었을 때 다른 러너 셋은 전부 옮겨 갔는데 백필만 남았다는 것이 이 결함의 모양이다.

**이 CR이 되돌리지 않은 결정 하나.** `CR-034`(DEV-180)는 조정 스캔이 누락 시퀀스 공간을 복구할 때 `sequence_assign` **잡 행이 아니라 버스 이벤트**로 보내기로 했고, 그 근거는 "그 유형을 집는 러너가 없다"와 "영원히 `queued`인 행이 `findActiveJob`에 걸려 이후의 모든 복구를 막는다" 둘이었다. `CR-055`가 러너를 세워 **첫 번째 근거는 없앴지만 두 번째는 그대로다** — 복구 경로는 공간마다 멱등해야 하고 활성 잡 제약에 걸리면 안 된다. 그래서 수동 실행만 잡 행을 쓰고 자동 복구는 계속 이벤트로 간다. **전제가 사라졌다고 결론까지 자동으로 뒤집지 않는다.**

**개수를 계약에 적지 않는 규율을 이 CR도 지켰다.** `WP-040`의 DoD가 `QA-A001-01 ~ QA-A001-14` 같은 범위 열거를 갖고 있었는데, 이 CR이 QA 항목 열하나를 더하면서 그 범위가 그 자리에서 낡았다. 범위를 갱신하는 대신 **정본을 지목하는 문장으로 바꿨다** — `CR-054`가 감사 대상에서 내린 판단과 같다.

### CR-054 반영 내역 (2026-08-29)

1. **`srs_final.md` — baseline v2.13 → v2.14.** `FR-AUTH-004` AC-1을 **개수에서 목록으로** 다시 쓰고 「감사 대상 액션 정본」 표(`action`·소유 WP·활성화 상태·승인 근거)를 신설했다. **AC-6**(실패 격리와 "비동기"의 뜻), **AC-7**(쓰기 어휘와 읽기 이력 어휘의 분리), **AC-8**(감사 조회 자체가 감사 대상이며 응답 확정 뒤에 기록) 신설. `FR-SRCH-010`에 **AC-9**(저장된 검색 생성·수정·삭제가 감사 대상, 실행은 아님), `FR-ING-010`에 **AC-8**(payload 명시적 열람이 감사 대상, 목록 조회는 아님) 신설. `FR-ING-009` AC-5를 **등록·변경·해제**로 정밀화. `secret.rotate` 제거. **v2.13 요약 문단을 사후에 채웠다**(DEV-413). 기존 AC 번호 유지, 신규 FR·NFR 0, 안정 ID 재번호화 0
2. `10_requirements/glossary.md` — **v0.6.** `AuditAction`·`활성`·`미활성`·`legacy 감사 어휘` 넷 신설. **정본이 SRS의 표 하나임을 용어 정의에 못박았다**
3. `10_requirements/requirements_screen_traceability_matrix.md` — **v1.0.** `FR-AUTH-004`의 간접 노출을 여덟 화면으로 넓혔다 — 감사 조회 화면은 A-004 하나이고, 넓은 것은 **감사 대상 액션이 여러 화면에서 발생**하기 때문이다
4. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.12.** A-004 진입 경로에 `operator` 미노출을 명시. 구현 메모에 자기 기록의 순서, 일괄 삭제·보존 만료 버튼 부재, `null` 정직성, legacy `action` 자유 입력을 더했다
5. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.12.** A-004의 `no_permission` 문구가 `security_officer`를 그대로 적도록 하고 `cursor_invalid` 상태 신설
6. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.11.** 권한 매트릭스의 `operator`·`security_officer` 두 행을 다시 쓰고 **역할별 운영 내비게이션 표**를 신설. `QA-A001-10`을 항목 단위 판정으로 정정. `QA-A004-06~10` 신설
7. `20_derived_ui_specs/pr_search_ui_component_spec.md` — **v0.9.** `C-002`의 사용 규칙을 그룹 단위에서 **항목 단위**로. 새 항목·새 역할의 기본은 보이지 않음
8. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **v1.0.** 7장을 재작성했다 — **자기 표를 버리고 SRS의 정본 표를 인용한다.** 7.1 기록 규칙, 7.2 실패 격리(공용 경계 하나), 7.3 어휘(쓰기·읽기 이력·legacy)로 나눴다. **개수를 적지 않는다**
9. `30_technical_architecture/pr_search_api_contracts.md` — **v0.16.** `API-ADM-005` 상세 규격 신설 — 필터 6종, PostgreSQL 키셋 커서, **접근 범위 필터를 걸지 않는 이유**, `null` 정직성, 자기 기록의 순서, 갱신·삭제 엔드포인트 부재
10. `30_technical_architecture/pr_search_data_model.md` — **v0.12.** `audit_cursor_idx` 신설(DEV-412), **관리 롤 연결 seam**(`ADMIN_DATABASE_URL`, DEV-411), `target`·`query` nullable 명시
11. `30_technical_architecture/pr_search_async_events_jobs.md` — **v0.4.** `JOB-AUD-001`의 대상을 `raw_event`(3년)·`audit_record`(1년) 둘로 명시하고 90일 정리의 잘못된 귀속을 배제
12. `30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.7.** 9.6에서 "완료 잡·해소된 DLQ 정리(90일)"의 `JOB-AUD-001` 귀속을 제거하고 **미승인**으로 표시(DEV-407)
13. `30_technical_architecture/pr_search_observability_reliability.md` — **v0.3.** 경보 조건을 `audit_record_failed_total`로 연결하고 지표 목록에 **라벨 규칙과 함께** 등록. `RB-18`에 파티션 부재 원인과 "주 동작은 계속 처리된다"를 더했다
14. `40_delivery/pr_search_work_packages.md` — **v2.6.** `WP-039`를 다시 썼다 — **개수 계약 제거**, 제외 다섯 신설(`WP-041`·`WP-044` 액션, 시크릿 회전, 90일 정리, A-001~003 본체, legacy 재기록), DoD를 "도달 가능한 경로에서 기록된다"로
15. `40_delivery/pr_search_implementation_traceability.md` — **v5.9.** `DEV-400~417` 신규 등록(400~413·415~417 resolved, 414 open), 6.50장 감사 기록

**PR #83 리뷰가 셋을 더 찾았고 셋 다 실결함이었다 (DEV-415~417).** ① 정본 표가 `target`과 `query` 두 컬럼을 구분하지 않아 **같은 CR이 만든 API 예시와 어긋났다** — 표에 `query` 열을 분리했다. ② `prs_admin`이 `NOLOGIN`이라 `ADMIN_DATABASE_URL`만으로는 그 권한에 닿을 수 없다(실측: `rolcanlogin = f`, 멤버십 0행) — 로그인 주체 + 멤버십 + `SET ROLE`로 경로를 명시했다. ③ `RB-18`이 파티션 부재 대응으로 지목한 `JOB-ING-006`은 **Elasticsearch 재색인 잡이었고**, 그것을 확인하다 **파티션 생성이 정기 잡으로 배선돼 있지 않다**는 더 큰 사실이 드러났다 — 기본 3개월치이므로 배포 후 세 달이면 감사와 원본의 INSERT가 전부 거부된다. `JOB-AUD-001`이 **드롭 전에 다가올 파티션을 보장**하도록 범위를 명시했다.

**세 번째가 이 리뷰의 값이다.** 지적 자체는 런북 한 줄의 잘못된 참조였는데, **그 참조를 실측하러 가니 잡 자체가 없었다.** 문서가 가리키는 곳을 실제로 열어 보는 일이 왜 필요한지를 그대로 보여 준다.

**SRS를 넓힌 자리는 셋뿐이다** — 저장된 검색, payload 열람, 감사 조회. 셋 다 **보안 문서가 이미 요구하고 있었고 승인만 없었다.** `secret.rotate`는 반대로 **좁혔다**: 그것을 소유하는 제품 기능이 없다.

**이 CR이 찾은 것의 모양.** `CR-052`는 "A에서 B로 가는 길이 있는가"였고 `CR-053`은 "같은 것을 말하는 두 문서가 같은 것을 말하는가"였다. 이번은 **"계약이 자기 대상을 무엇으로 말하는가"**다 — 개수로 말하면 그 수는 대상이 늘 때마다 낡고, **누가 언제 낡게 했는지 아무도 모른다.** 목록으로 말하면 행을 더하는 사람이 근거와 주인을 함께 적는다.

**같은 뿌리에서 아홉이 함께 닫혔다.** 어휘가 코드와 갈라진 셋(402·404·405), 실패 격리(406), 잡 범위(407), 권한 계약(408), 주인 없는 액션(409), 지표 연결(410), 그리고 구현 seam 둘(411·412). **전부 "감사 대상의 정본이 어디인가"라는 한 물음에서 나왔다** — 정본이 없으면 각 문서가 자기 몫을 옳게 적고도 서로 어긋난다.

### CR-053 반영 내역 (2026-08-29)

1. **`srs_final.md` — baseline v2.12 → v2.13.** `FR-STAT-001`에 **AC-6**(집계 대상은 PR 문서로 한정)·**AC-7**(그룹 키 `팀`은 작성자 소속 팀이며 다중 소속이면 버킷 합이 총계를 넘는다)·**AC-8**(정렬은 건수 내림차순, 동률이면 키 오름차순으로 결정적)을 더하고 AC-5에 "질의는 집계와 같은 모집단을 가리키는 문서 유형 조건을 포함한다"를 붙였다. `FR-STAT-002`에 **AC-6**(대상은 PR, 버킷 기준 시각은 `merged_at`, 경계는 지정 시간대에서 계산). `FR-STAT-003`에 **AC-6**(`lead_time_median`은 `p50`과 같은 값). `FR-STAT-005`는 AC-2에 "변경 라인 수는 `additions + deletions`"를 명시하고 **AC-6**(대상은 PR)·**AC-7**(그 합은 색인 시점 계산)을 더했으며 AC-5에 "값이 없는 것과 0인 것을 같은 구간에 넣지 않는다"를 붙였다. `FR-STAT-006`은 AC-1에 "검색과 같은 파서"를, AC-2에 **모집단 정의**를, AC-3에 근사 방법 명시 요구를, AC-5에 "어느 숫자에도 예외가 없다"를 더하고 **AC-6**(`seq:` 범위가 있으면 에폭을 함께 받고 낡으면 계산하지 않는다)을 신설했다. `FR-SRCH-005` AC-1은 지원 키를 **17종**으로 넓혔고(`kind`·`author_team`) `FR-SRCH-006` AC-1의 필터 목록에 작성자 팀과 문서 유형을 더했다.
2. `10_requirements/prd.md` — **v1.7.** `SCN-005`에 "집계가 세는 것은 PR이다"와 "여기서 팀은 작성자 소속 팀"을 적었다.
3. `10_requirements/glossary.md` — **v0.5.** **팀 하나가 두 뜻을 갖던 것을 갈랐다** — "권한 판정과 집계 그룹의 단위"라는 한 줄이 이 결함의 문서상 뿌리였다. **접근 권한 팀**(`allowed_team_ids`)과 **작성자 팀**(`author_team_ids`)을 별도 항목으로 세웠다 (DEV-382).
4. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.11.** 차트 원칙에 계열 색 미결(`DEV-380`)과 "집계가 세는 것은 PR"을 적었다.
5. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.11.** `W-006`에 **`epoch_stale`** 상태를 더했다 — 빈 결과나 0으로 그리지 않는다 (DEV-384).
6. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.10.** `QA-W006` 열여덟의 **소유 계층 표**를 만들었다: API만으로 판정(여섯), API 몫과 화면 몫이 나뉨(일곱), 화면 판정(넷), **투영 판정**(`11`) (DEV-388).
7. `20_derived_ui_specs/pr_search_ui_component_spec.md` — **v0.8.** `C-033`에 계열 색 미결을, `C-034`에 "`unknown`은 0과 다르게 그린다"를 적었다.
8. `30_technical_architecture/pr_search_api_contracts.md` — **v0.15.** **`API-STAT-004` 상세를 신설**하고(`dimension` 둘, 구간, `unknown`, `ratio`) **`API-STAT 공통 규칙` 절**을 새로 만들었다(모집단·질의 해석·접근 범위·시퀀스 에폭·근사·타임아웃). `API-STAT-001`에 `group_by`↔ES 필드 대응표(다중값 열 포함)와 정렬 규칙을, `002`에 기준 시각과 시간대 규칙을, `003`에 제외 사유 구분과 이름 통일을 더했다. 질의 키 목록을 17종으로, `supported_keys` 예시와 키 매핑 표를 함께 갱신했다.
9. `30_technical_architecture/pr_search_data_model.md` — **v0.11.** 접근 경로 표의 **"다차원 필터 목록"을 `prs-pull-requests` + `prs-commits`로 정정**하고 **분포 행을 신설**했다. `prs-pull-requests` 매핑에 **`changed_lines`**를 더하고 사전 계산 필드 목록에 넣었으며, **기존 문서 소급을 `put_mapping` + `update_by_query`로** 적었다 — `repository_archived`가 같은 길을 이미 갔다.
10. `40_delivery/pr_search_work_packages.md` — **v2.3.** `WP-037`의 구현 범위에 질의 키 둘·`changed_lines`·에폭 바인딩·`FR-STAT-004` AC-3 정정·**`test:perf` harness 신설**을 더하고, 제외에 **"이 WP는 API까지다"**를 명시했다. DoD를 소유 계층에 맞춰 다시 적었다. `WP-038`에 착수 전 결정(`DEV-380`)과 `epoch_stale` 그리기를 더했다.
11. `40_delivery/pr_search_implementation_traceability.md` — **v5.3.** `DEV-381~390` 등재, 4장 매핑 갱신, 6.47장 감사 기록.
12. 검증기: `python3 validate_srs_prd_env.py --root . --strict` — `main` 대비 **증감 0** (WARN 1 · ERROR 2).

**등재한 열 중 아홉이 닫혔고 `DEV-387` 하나가 열린 채 `WP-037`로 간다.** 재료가 다 있는데
구현되지 않은 것이라 계약이 아니라 코드가 할 일이며, 그 값을 집계하는 WP가 함께 고친다.
이 CR을 닫은 시점의 open DEV는 **12건**이다.

**이 CR이 찾은 것의 모양.** `CR-052`는 옳게 적힌 계약 다섯이 **서로에게 닿지 않은** 것이었다.
이번에는 **두 문서가 같은 것을 각각 다르게 정했고, 세 번째 문서가 그 둘이 같기를 요구했다** —
데이터 모델은 집계를 PR로, 와이어프레임은 목록을 PR+커밋으로 정했으며 `FR-STAT-006` AC-2가
"총 건수 일치"를 요구한다. 어느 문서도 틀리지 않았고 **어떤 구현으로도 셋을 함께 만족할 수
없었다.**

→ **문서 하나를 읽고 "이것이 맞는가"를 묻는 것으로는 이 종류를 찾지 못한다.** `CR-052`가
"A에서 B로 가는 길이 있는가"를 물어야 한다고 배웠다면, 이번에 물어야 할 것은 **"같은 것을
말하는 두 문서가 같은 것을 말하는가"**다. 세는 대상, 낱말의 뜻(`team`), 값의 정의(변경 라인 수),
같은 값의 이름(`lead_time_median`↔`p50`) — 넷 다 그 물음에서 나왔다.

**용어집 한 줄이 뿌리였다.** "팀 = 권한 판정과 집계 그룹의 단위"는 두 쓰임을 한 낱말에 담았고,
그 뒤로 검색은 권한 쪽을, 통계는 성과 쪽을 각자 옳게 구현했다. **낱말이 갈라지지 않으면 코드가
갈라진다.**

### CR-052 반영 내역 (2026-08-28)

1. **`srs_final.md` — baseline v2.11 → v2.12.** `FR-ING-010`에 **AC-6**(조회는 역할 제한에 더해 접근 범위 필터를 지난다)과 **AC-7**(파일에 크기 상한과 보관 개수를 둔다)을 더했고, 「관련 API/데이터」에 `API-ADM-008`을, 예외 처리에 보관 한도 초과 시의 동작을 더했다. **기존 AC 다섯의 번호와 문구는 그대로다**
2. `10_requirements/requirements_screen_traceability_matrix.md` — **v0.9.** `FR-ING-010` 행에서 보조 화면 `A-004`를 뺐다 (DEV-374). `WP-039`의 구현 범위에도 `QA-A004-01~05`에도 아카이브가 없어 **두 화면 중 어느 쪽도 소유하지 않는 상태**였다
3. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.9.** `A-001-ARCHIVE` 섹션의 내용을 적재 상태·조회·`payload` 접힘·역할 예외로 구체화하고 `ops.archive_query` 이벤트를 더했다
4. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.10.** A-001에 `archive_unavailable`·`archive_scope_empty`·`archive_only` 셋을 더하고 `no_permission`의 조건을 두 역할로 고쳤다
5. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.9.** `QA-A001-11~14` 신설, `QA-A001-10`에 `security_officer` 예외를 명시했다. **기존 번호는 전부 유지했다**
6. `30_technical_architecture/pr_search_api_contracts.md` — **v0.13.** `API-ADM-008 GET /admin/raw-events` 신설 — 역할 제한 + 필수 접근 범위 필터, `payload` 기본 미포함, `index_available`, `search_after` 키셋
7. `30_technical_architecture/pr_search_data_model.md` — **v0.9.** 4.5 매핑에 `repository_id`를 더하고 두 필드가 각각 무엇을 위한 것인지 적었다. `ENT-ING-003` 속성을 실제 레코드에 맞췄고, 보존 표에 NDJSON 아카이브 파일 행을 더했다
8. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **v0.8.** `THR-044` 등재
9. `30_technical_architecture/pr_search_system_architecture.md` — **v0.3.** `filebeat` 배포 형태를 사이드카로 확정했다 (DEV-373)
10. `30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.6.** 배포 단위 표의 `DaemonSet`을 사이드카로 정정하고 그 근거를 산문으로 남겼다. 환경별 볼륨 표와 영속 볼륨 표에 아카이브 볼륨 행을 더했다
11. `40_delivery/pr_search_work_packages.md` — **v1.9.** `WP-036`을 **API까지로 좁히고** 제외에 A-001 화면을 넣었으며 DoD를 AC 단위 검증으로 다시 썼다. `WP-040`의 범위에 `A-001-ARCHIVE`를, DoD의 QA 범위를 `QA-A001-14`까지로 넓혔다
12. `40_delivery/pr_search_implementation_traceability.md` — **v4.9.** `DEV-366~375` 등록, 4장 `FR-ING-010` 행과 8장 갱신

**검증기 결과.** `validate_srs_prd_env.py --root . --strict`를 계약 PR과 구현 PR 양쪽에서 돌렸고 **`main` 대비 증감 0**이다 (WARN 1 · ERROR 2 — 둘 다 기존 자기참조 오탐이며 placeholder 개수까지 동일하다). 기존 오탐을 이 CR에서 정리하지 않는다 — 문서를 고쳐 게이트를 통과시키는 것은 게이트를 없애는 것과 같다.

**머지 후 리뷰 여덟과 그 정정 (PR #65 다섯 · PR #66 셋).** 일곱이 실결함이었고 하나는 시점 차이였다.

| 무엇 | 판정 |
| --- | --- |
| 동시 `append`가 회전을 겹쳐 실행해 **한 번의 경계 통과가 여러 조각을 버린다** | 실결함 — append를 직렬화했다. 오류를 내지 않는 실패라 지표로도 구분되지 않았다 |
| `include_payload=true`가 감사에 남지 않는다 | 실결함 — **계약이 "명시적 열람은 감사에 남는다"라고 정했는데 구현이 따르지 않았다.** `raw_event.view_payload`를 보안 문서 7장에 등재하고 라우트가 기록한다 |
| `security_officer`가 A-001에 도달할 수 없다 | 실결함 — `archive_only` 상태만 정의하고 **진입 규칙을 고치지 않았다.** 와이어프레임의 내비게이션·권한 절과 `WP-040`의 역할 제한을 함께 고쳤다 |
| 커서에 타이브레이커가 없다 | **계약 누락** — 구현은 `received_at` + `delivery_id` 두 키를 쓰는데 계약이 첫 키만 적었다. 동시 웹훅이 같은 밀리초를 만들면 페이지 경계에서 문서가 빠지거나 겹친다 |
| `org_team` 범위에서 아카이브가 빈 결과가 된다 | **계약 누락** — 구현은 `applyArchiveScopeFilter`로 저장소 목록을 직접 걸어 그 실패가 없다. 그러나 계약이 "어떻게 거는가"를 적지 않아 독자가 기본 필터를 가정한다. API 계약과 데이터 모델에 명시했다 |
| AC-7의 지표를 `WP-036`이 검증하지 않는다 | 실결함 — 구현은 `ingest_archive_segments_dropped`를 내지만 범위·DoD에 없었다. 둘을 더하고 `/metrics` 노출 시험을 추가했다 |
| CR-052를 닫기 전에 검증기 결과를 기록해야 한다 | 유효 — 위에 적었다 |
| 원장이 `WP-036`을 `todo`로 둔 채 낡았다 | **시점 차이** — 리뷰가 구현 커밋 `a483839`를 봤고 그 다음 커밋 `304fc5a`가 3·4·5·7·8장과 6.44장을 갱신했다. 실측으로 확인했다 |

**둘이 같은 것을 말한다.** 동시성 결함과 감사 누락은 **내가 적은 계약을 내 구현이 따르지 않은 자리**이고, `security_officer` 도달성은 **상태를 정의하면서 그 상태에 이르는 길을 정의하지 않은 자리**다. risks 「계약을 대체하는 결정을 적었으면 그 대체가 성립하는지 물어라」의 세 번째 얼굴이다.

**이 CR은 계약만 닫는다 — 구현은 `WP-036`이 한다.** 그래서 `DEV-366~370` 다섯은 `open (계약 확정 · 구현 대기)`로 남고, 문서만으로 완결되는 `DEV-371~375` 다섯은 `resolved`다. **REL-004 구현 수는 그대로 7/8이다.**

**이 CR의 핵심 발견은 승인된 레인 하나가 어디에도 연결되어 있지 않았다는 것이다.** `ADR-002`가 레인 B를 정하고 `ADR-003`이 인덱스와 ILM을, 인프라 3장이 배포 단위를 올려 둔 것이 2026-08-19다. 계약은 **다섯 문서에 걸쳐 충실히 적혀 있었다.** 그런데 그 사이의 이음매 — 파일이 파드 밖으로 나가는 길, 파일의 필드가 매핑과 맞는지, 인덱스를 읽을 API가 있는지 — 는 **어느 문서도 맡지 않았다.** `WP-004`는 "파일까지가 범위"라고 정확히 적고 나머지를 `WP-036`에 맡겼는데, 그 나머지를 성립시킬 재료가 없었다.

**`CR-051`이 배운 것의 다른 얼굴이다.** 그때는 옳게 적힌 결정(`ADR-007` 규칙 5)이 세 저장물 중 하나에만 닿아 있었다. 이번에는 옳게 적힌 계약 다섯이 **서로에게 닿지 않았다** — 각 문서는 자기 몫을 적었고 어느 것도 틀리지 않았는데, 그것들을 잇는 자리가 아무의 소관도 아니었다. **감사할 때 문서를 하나씩 읽어 "이 문서가 맞는가"를 묻는 것으로는 이 종류를 찾지 못한다.** 물어야 할 것은 **"A에서 B로 가는 길이 실제로 있는가"**이며, 이번에는 파일에서 ES까지와 ES에서 사람까지 두 구간이 비어 있었다.

**두 번째로 반복된 것은 완료 기준이 자기 범위 밖을 요구하는 모양이다.** `WP-036`의 DoD가 `WP-040`의 화면을 요구했고(DEV-371), 추적 매트릭스가 지목한 `A-004`를 `WP-039`가 맡지 않았으며(DEV-374), `A-001`의 역할 제한이 AC-5와 어긋났다(DEV-375). 셋 다 **"누가 소유하는가"를 적지 않아 생긴 공백**이고, `WP-010`이 같은 자리에서 "이 WP는 API까지다"라고 적어 둔 것이 유일한 선례였다.

### CR-051 반영 내역 (2026-08-28)

1. **`srs_final.md` — baseline v2.10 → v2.11.** FR-SRCH-005에 AC-7(시퀀스 공간 지목), FR-SRCH-010에 AC-8(에폭 보존)을 더했고, FR-SEQ-005 AC-4의 무효 대상에 **공유 URL**을 명시했으며, FR-SRCH-008 AC-3의 지문 재료에 에폭을 더했다. FR-SEQ-005의 「관련 화면」이 W-004만 적고 있던 것을 정정했다. **기존 AC 번호를 전부 유지했고 신규 FR·NFR 없음, 신규 API·엔티티 ID 없음, 안정 ID 재번호화 0건, 새 ADR 없음**
2. `10_requirements/prd.md` — **v1.6.** SCN-002에 질의로 구간을 보는 대체 흐름과 재작성 뒤의 오류 흐름을 더했다. **트레이스 링크를 갈아 끼우지 않고 시나리오가 그 흐름을 담게 했다**(CR-049 DEV-339가 배운 것)
3. `10_requirements/glossary.md` — **v0.4.** 「시퀀스 인용」과 「미연결 인용」 신설, 「시퀀스 에폭」의 무효 대상을 셋으로 명확히 했다. **세 저장물을 묶는 안정 용어가 없어서 문서마다 다르게 부르고 있었다**
4. `10_requirements/requirements_screen_traceability_matrix.md` — **v0.8.** FR-SEQ-005 행에 W-001·W-008을 더하고 **그 행이 W-004만 적고 있던 것이 DEV-349가 다섯 WP 동안 보이지 않은 이유임**을 남겼다. FR-SRCH-005·008·010 행도 갱신했다
5. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.7.** W-001에 `W-001-SEQCTX` 섹션·`seq_epoch` 딥링크·`search.rebind_epoch` 이벤트·URL 완성 규율을, W-008에 인용 상태 넷·`saved.rebind_epoch`·비노출 규칙을 더했다
6. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.8.** W-001에 `epoch_stale`·`error_sequence_space_required`, W-008에 `sequence_epoch_stale`·`sequence_unbound`·`sequence_unavailable`을 더했다
7. `20_derived_ui_specs/pr_search_ui_component_spec.md` — **v0.7.** C-005가 시퀀스 인용 배너를 겸하고 C-037이 인용 상태를 그린다. **새 컴포넌트 ID를 만들지 않았다** — 전할 것이 "무엇이 사실이고 무엇이 안 되며 무엇을 누르면 되는가" 셋으로 같다
8. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.8.** QA-W001-30~38, QA-W008-13~19 신설. **기존 번호는 전부 유지했다**
9. `30_technical_architecture/pr_search_api_contracts.md` — **v0.11.** API-SRCH-004에 「시퀀스 인용 계약」 일곱 규칙을 신설하고 커서 지문 재료에 에폭을 더했다. API-SRCH-005에 `sequence_reference`·POST의 `seq_epoch`·PATCH 다섯 경우·`/run`의 주소 규칙을 더했다. **새 오류 코드를 만들지 않았다** — `INVALID_PARAMETER`·`NOT_FOUND`·`SAVED_SEARCH_QUERY_INVALID` 셋으로 충분하고 `detail.reason`이 사유를 가른다
10. `30_technical_architecture/pr_search_data_model.md` — **v0.8.** `saved_search.seq_epoch`과 CHECK, 마이그레이션 017 절, 소급 채움을 하지 않는 이유, 애플리케이션 불변식 넷
11. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **v0.7.** THR-043 등재
12. `30_technical_architecture/pr_search_architecture_decision_records.md` — **v0.5.** ADR-007에 Clarification을 더했다. **새 ADR을 만들지 않았다** — 규칙 1과 규칙 5가 어디까지 닿는지를 적은 것이며 새 결정이 아니다
13. `30_technical_architecture/pr_search_backend_architecture.md` — **v0.4.** 조회 순서에 4-1단계(시퀀스 인용 바인딩)와 계층 경계를 더했다
14. `40_delivery/pr_search_implementation_traceability.md` — **v4.7.** DEV-359~365 등록, DEV-349·4장·7장 갱신, 8장에 감사가 물은 셋과 그 답

**이 CR은 계약만 닫는다 — 구현은 별도 PR이다.** 그래서 `DEV-359~363`·`DEV-365`는 `open (계약 확정 · 구현 대기)`로 남는다. 닫힌 계약을 `resolved`로 적으면 원장이 "이 결함은 고쳐졌다"고 말하는데 코드는 그대로인 상태가 되고, **같은 문서가 아래에서 "구현 PR이 들어와야 DEV-349가 닫힌다"고 적으므로 스스로와 어긋난다** (PR #63 리뷰 P1이 잡았다). 계약이 닫혔다는 사실은 CR의 `closed`가 말하고, 결함이 고쳐졌다는 사실은 DEV의 상태가 말한다 — **둘은 다른 사실이며 한쪽으로 다른 쪽을 표현하지 않는다.**

**이 CR의 핵심 발견은 답이 없던 것이 아니라 질문이 잘못돼 있었다는 것이다.** DEV-349는 "어느 시퀀스
공간의 에폭을 기록하는가"에 답할 수 없어 열려 있었다. 그런데 그것은 정본이 없어서가 아니라 **`seq:`
질의가 그 물음에 답할 수 있는 모양이 아니었기 때문이다** — 공간을 지목하지 않는 조건은 접근 범위의
모든 공간에 걸치고, 그때 "그 에폭"이라는 것이 애초에 존재하지 않는다. 질의가 하나의 공간을 지목하게
하자 첫 물음에 답이 생겼고 **두 번째 물음("여럿이면 하나만 낡아도 전체를 무효로 보는가")은 사라졌다.**

**세 번째 물음의 답은 이미 저장소 안에 있었다.** `API-SEQ-001`이 `epoch_stale`·`requested_seq_epoch`를
싣고 결과 키를 빼는 형태를 CR-027부터 쓰고 있다. 그 모양을 그대로 옮겼고, 새 응답 형식을 발명하지
않았다. 마찬가지로 공간 지목 규칙도 `API-SEQ-004`가 이미 내린 판단이다 — **"`base_branch`는 필수다,
서버가 시퀀스 공간을 고르지 않는다"**(CR-032, DEV-168). 검색의 `seq:`는 그 판단이 닿지 않은 자리였을
뿐이다.

**가장 무거운 사실은 ADR-007 규칙 5가 처음부터 답을 적어 두었다는 것이다**(DEV-360, DEV-362).
"시퀀스를 인용하는 모든 저장물(안전 구간 표식, 저장된 검색의 `seq:` 조건, **공유 URL**)은 에폭을 함께
저장한다"가 2026-08-19부터 서 있었는데, 셋 중 실제로 그렇게 하는 것은 `safe_marker` 하나뿐이었다.
**결정은 승인돼 있었고 구현이 그것을 몰랐으며, 다섯 WP가 그 위를 지나갔다.** risks 77이 "계약을
대체하는 결정을 적었으면 그 대체가 성립하는지 물어라"였다면 이번은 그 반대 얼굴이다 — **옳게 적힌
결정이 어디까지 닿는지 아무도 확인하지 않았다.** 그래서 이 CR은 새 ADR을 만들지 않고 ADR-007에
Clarification을 붙였다. 같은 규칙을 두 번 적으면 다음 사람이 어느 쪽이 정본인지 묻게 된다.

**소급 채움을 거절한 것이 이 계약에서 가장 중요한 한 줄이다.** 마이그레이션이 `seq:`를 담은 기존 행에
현재 에폭을 넣으면 모든 저장 검색이 즉시 "정상"이 되고 화면에 경고가 사라진다. 그러나 **저장 당시의
에폭은 어디에도 남아 있지 않으므로 그 값은 사실이 아니라 추측이며**, 추측을 스키마 변경으로 못 박으면
조용한 오답을 영구히 승인하게 된다. 그런 행은 `unbound`로 남기고 사람이 다시 연결한다 — 겉으로는
더 나쁜 상태를 택한 것이고, 실제로는 **모르는 것을 모른다고 말하는 유일한 방법**이다.

**찾은 것을 전부 고치지 않았다**(DEV-364). 감사가 스칼라 `seq:1234`의 조용한 0건을 발견했지만 SRS가
승인한 것은 범위뿐이고, 이 CR을 핑계로 새 조회 기능을 만들지 않았다. 공간 지목 규칙도 범위 조건에만
적용해 동작 변경을 최소로 두었다. **참조가 있다는 사실이 구현 지시가 아니라는 CR-050의 규율과 같으며,
판정 자체를 원장 5장에 남겼다.**

### CR-050 반영 내역 (2026-08-28)

1. **`srs_final.md` — baseline v2.9 → v2.10.** FR-ING-009에 AC-6~AC-10을, FR-ING-011에 AC-6을 더했다. 관련 화면·API 셀도 갱신했다. **기존 AC 번호를 전부 유지했고 신규 FR·NFR 없음, 안정 ID 재번호화 0건, 새 ADR 없음**
2. `10_requirements/prd.md` — **v1.5.** SCN-006에 사용자 자가 진단·미등록 저장소·부분 실패 세 흐름을 더했다. **트레이스 링크를 갈아 끼우지 않고 시나리오가 그 흐름을 담게 했다**(CR-049 DEV-339가 배운 것)
3. `10_requirements/requirements_screen_traceability_matrix.md` — **v0.7.** W-009를 지목하는 FR을 역방향으로 전수 확인해 여섯 행을 정정했다 (DEV-355)
4. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.6.** W-009의 진입 경로(DEV-356), 섹션 넷, 이벤트 다섯, 권한·정책. W-005의 `release_not_indexed` 링크를 열었다 (DEV-159 만기)
5. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.7.** W-009에 `loading_more`·`error_cursor`를 더하고 `null`/`0`/`unavailable` 세 값 구분을 명시했다
6. `20_derived_ui_specs/pr_search_ui_component_spec.md` — **v0.6.** C-038·C-039의 규칙을 확정하고 C-016에 W-009를 등재했다
7. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.7.** QA-W009-06~13 신설. **기존 01~05는 번호를 유지했고 03·04·05의 문장만 정확해졌다**
8. `30_technical_architecture/pr_search_api_contracts.md` — **v0.10.** API-ING-002·003 상세 절 신설, API-ADM-006의 만기된 "WP-021 이후" 이월을 실제 계약으로 교체 (DEV-354). **새 오류 코드를 만들지 않았다** — `INVALID_PARAMETER`와 기존 커서 코드 둘로 충분하다
9. `30_technical_architecture/pr_search_data_model.md` — **v0.7.** ENT-CORE-008 등재, 마이그레이션 016 두 절(등록 요청 표 · 조정 결과 보존), 보존 표에 새 표 등재
10. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **v0.6.** 5.3에 PostgreSQL 경로의 판정 재료 규율을 더하고 THR-041·042를 등재했다
11. `40_delivery/pr_search_work_packages.md` — **v1.7.** WP-034의 구현 범위·제외·DoD를 확정된 계약에 맞춰 다시 썼다 (DoD 4항 → 19항)
12. `40_delivery/pr_search_implementation_traceability.md` — **v4.4.** DEV-350~356 등록, DEV-159 만기 기록, 8장에 감사가 물은 넷과 그 답

**가장 무거운 발견은 화면과 API의 권한 축이 어긋나 있었다는 것이다**(DEV-350). W-009는 P1 일반 사용자 화면으로 IA에 등재돼 있었고 WP-034의 목표 문장도 "사용자가 스스로 확인한다"였다. 그런데 그 화면이 읽을 것으로 지목된 API 둘이 `operator` 전용이었고, 한쪽은 그 제한이 **요구사항 본문에 승인**돼 있었다(FR-ADMIN-001 AC-4). **화면의 권한 축과 API의 권한 축이 다른데 아무 문서도 그 모순을 적지 않았다** — 각자는 옳았고 둘을 나란히 읽는 사람만 그것을 본다.

여기서 쉬운 길은 `API-ADM-006`을 여는 것이었다. 그렇게 하지 않은 이유는 그 API가 담는 것이 **저장소를 식별하지 않는 조직 전체 수치**이고, 그 성질 때문에 FR-AUTH-002 AC-5의 예외로 승인됐기 때문이다(CR-024, DEV-051). W-009가 필요로 하는 것은 정반대로 **저장소별** 정보다 — 같은 API에 두 성질을 섞으면 그 예외의 근거가 무너진다. 그래서 새 경로를 세우고 기존 권한은 한 글자도 건드리지 않았다.

**downstream이 SRS를 확장하고 있던 자리를 찾았다**(DEV-351). 등록 요청은 와이어프레임 이벤트·QA 항목·A-002 섹션·상태 매트릭스 복구 경로 **넷**에 걸쳐 서술돼 있었는데 FR-ING-009는 그것을 말한 적이 없다. 넷 다 각자는 자연스러운 서술이라 어느 하나만 읽어서는 이상하지 않다 — **여러 파생 문서가 같은 전제를 공유하는데 상위 문서에 그 전제가 없을 때**가 이 종류의 공백이 사는 자리다.

그 요청을 계약으로 만들면서 **하지 않을 일을 먼저 정했다.** 요청은 등록이 아니고, GHE에 묻지 않으며, 실재 여부를 응답으로 구분하지 않는다. 마지막 것이 가장 중요하다 — 묻는 순간 이 경로가 **비공개 저장소의 존재 신탁**이 되고, 그것은 THR-004가 404로 통일해 막아 둔 것과 정확히 같은 유출이다. 확인하지 않으므로 응답은 "기록했다"만 말할 수 있고, 그 이상을 말하는 문구는 전부 거짓이 된다.

**판정의 재료가 그 판정이 뜻하는 것과 같은가**를 또 물었다(DEV-352). WP-035가 "처리한 source 수는 문서 수가 아니다"에서 배운 것과 같은 모양이다. 여기서는 **누적 counter가 최근 회차의 값이 아니었다.** 게다가 그 counter는 지표 저장소가 없으면 조회 서비스가 읽지도 못한다 — `API-ADM-006`의 `stage_latency_seconds`가 이미 그 이유로 `"unavailable"`인데, 같은 제약이 다른 축에서 반복되는 것을 보지 못하고 있었다.

**미룬 회차가 완료 회차를 덮지 않게 한 것이 이 계약의 핵심이다.** 조정 스캔은 API 한도가 소진되면 창을 끝까지 읽지 못하고 미루는데, 그 회차의 부분 집계는 **언제나 실제보다 작다.** 그것을 "최근 결과"로 보이면 사용자는 "거의 다 수집됐다"로 읽고, 이 화면의 목적이 정확히 그 오독을 막는 것이다. 덮지 않는다는 규칙 하나가 그 실패 모드 전체를 없앤다.

**기존 결함 하나가 이 감사에서 함께 드러났다**(DEV-353). `allowed_team_ids`를 넘기지 않는 두 경로는 **오류를 내지 않는다** — 선택 인자가 빠지면 빈 배열로 읽혀 조용히 좁게 답할 뿐이다. fail-closed라 접근 통제 시험은 전부 통과했고, 그래서 WP-068 이후 다섯 WP 동안 아무도 보지 못했다. **결과를 재는 시험은 이것을 잡을 수 없다** — 넘어간 재료를 재야 잡힌다. 그래서 `explicit`와 `org_team`이 같은 권한 집합에서 같은 결과를 내는 parity 회귀를 세웠다.

**역방향 grep이 감사 절차가 됐다.** CR-049가 FR-SRCH-010만 읽고 FR-SEQ-005를 놓쳐 DEV-349를 만들었다(risks 76). 이번에는 `W-009`·`not_indexed`·`등록 요청`·컴포넌트 이름을 문서 전체에서 역방향으로 찾았고, **그렇게 해서만 보이는 셋**을 찾았다(DEV-354·355·356). 다만 찾은 것을 전부 구현하지는 않았다 — 넷을 "직접 구현 / 간접 의미 / 미래 WP / stale trace"로 분류했고 그 판정 자체를 문서에 남겼다. **참조가 있다는 사실은 구현 지시가 아니다.**

### CR-049 반영 내역 (2026-08-27)

1. **`srs_final.md` — baseline v2.8 → v2.9.** FR-SRCH-010의 AC-1·2·4를 명확히 하고 AC-5·6·7을 더했다. **기존 AC 번호를 유지했고 신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `10_requirements/prd.md` — **v1.4.** SCN-005에 저장·재실행·공유 대체 흐름과 무효 질의 오류 흐름을 더하고 관련 요구사항에 FR-SRCH-010을 등재했다. **트레이스 링크를 갈아 끼우지 않고 시나리오가 그 흐름을 담게 했다**(DEV-339)
3. `10_requirements/glossary.md` — **v0.3.** 「대상 팀」 신설, 「저장된 검색」에 소유권·공유 의미 반영. **「커서」의 정의가 Elasticsearch `search_after`에 묶여 있던 것을 정정했다** — 순회하는 정본에 따라 봉인 재료가 다르다
3-1. `10_requirements/requirements_screen_traceability_matrix.md` — **v0.6.** FR-SRCH-010 행에 화면별 책임을, W-008 요약에 두 논리 목록을 반영했다 (PR #59 리뷰 P1, DEV-343)
4. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.5.** W-001 저장 대화상자(정본 질의 문자열·대상 팀 선택기·저장 실패 상태 셋)와 W-008(두 논리 목록·커서 페이저·소유권 규칙·`NOT_FOUND` 단일 응답)
5. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.6.** W-001에 저장 실패 상태 셋, W-008에 `loading_more`·`empty_no_shared`·`error_name_conflict`·`error_team_invalid`·`error_cursor` 추가
6. `20_derived_ui_specs/pr_search_ui_component_spec.md` — **v0.5.** C-037에 소유권별 액션·항목 단위 유효성·삭제 확인, C-016에 W-008 재사용과 **한 화면 두 페이저** 규칙
7. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.6.** QA-W008-06~12 신설. **기존 01~05는 번호와 뜻을 유지했다**
8. `30_technical_architecture/pr_search_api_contracts.md` — **v0.9.** API-SRCH-005 상세 절 신설(자원 표현·일곱 경로·PostgreSQL 키셋 커서·오류 여덟), 6장에 `SAVED_SEARCH_NAME_CONFLICT`·`SAVED_SEARCH_QUERY_INVALID` 등재. **새 `API-SRCH-###`를 만들지 않았다**
9. `30_technical_architecture/pr_search_data_model.md` — **v0.6.** `saved_search`에 `visibility`↔`team_id` 불변식과 목록 인덱스 둘(마이그레이션 015), 상한을 `CHECK`로 강제하지 않는 이유
10. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **v0.5.** THR-012의 완화를 셋으로 나눠 명시했다 — 공유되는 것은 자산이지 권한이 아니고, 저장자의 접근 범위를 어디에도 남기지 않으며, 대상 팀은 `team_id`로 식별한다
11. `40_delivery/pr_search_work_packages.md` — **v1.5.** WP-033의 구현 범위·제외·DoD를 확정된 계약에 맞춰 다시 썼다(DoD 5항 → 18항)
12. `40_delivery/pr_search_implementation_traceability.md` — **v4.2.** DEV-333~342 등록, 8장에 감사가 물은 넷과 그 답
13. `packages/contracts/src/error-codes.ts` — 오류 코드 둘 추가. **문서와 enum을 대조하는 시험이 있으므로 같은 편집에서 함께 간다**

**검증기 결과: `main` 대비 증감 0.** `validate_srs_prd_env.py --strict`가 `origin/main`(`66024ce`)과 이 변경 후 상태에서 똑같이 WARN 1 · ERROR 2(`change_control.md` 9건, 원장 5건)를 낸다. 그 셋은 두 문서가 담고 있는 미결 표식 검색 명령과 역사 서술이며 원장 §7에 기술 부채로 등록돼 있다 — **문서를 고쳐 게이트를 통과시키지 않는다**(risks 35의 자리).

**가장 무거운 발견은 승인된 기능이 "누구에게 공유하는가"를 말한 적이 없다는 것이다**(DEV-334). `team` 공개 범위는 v2.2부터 승인돼 있었고 `saved_search.team_id` 열도 마이그레이션 004부터 있었다. 그런데 AC-2의 문장은 "저장자와 같은 팀 구성원"이었고, 이 제품의 사용자는 여러 팀에 속할 수 있다. **열이 있다는 것과 그 열이 무엇을 뜻하는지 정해져 있다는 것은 다른 사실이다** — 열은 구현자가 채우겠지만 뜻은 제품이 정해야 한다.

**같은 뿌리에서 셋이 함께 닫혔다.** 대상 팀이 정해지자 소유권(DEV-342 — 공유는 읽기·실행 권한이지 소유권 이전이 아니다), 이탈 후 처분(DEV-341 — 시스템이 대신 지우지 않되 이탈한 사람이 그 팀의 자산을 계속 고치게 두지도 않는다), 스키마 불변식(DEV-335 — 공개 범위와 대상 팀은 함께 성립하거나 함께 없다)이 모두 답을 얻었다. **하나의 빈칸이 넷을 비워 두고 있었다.**

**`CHECK`로 막을 수 없는 불변식을 계약이 다뤄야 했다**(DEV-336). 100건 상한은 여러 행에 걸친 개수이고 PostgreSQL의 `CHECK`는 다른 행을 볼 수 없다. 그래서 이 상한은 스키마가 아니라 **트랜잭션 설계**로만 지킬 수 있으며, 그 사실이 계약에 없으면 구현이 `count` 뒤 `INSERT`를 쓰고 99건 상태에서 101건이 된다. 데이터 모델에 그 이유를 남겼다.

**`/run`이 검색을 대신 수행하지 않는 것이 AC-3을 구조적으로 지키는 방법이다.** 이 경로가 결과를 계산하면 "누구의 범위로 계산했는가"가 핸들러의 판단이 되고, 언젠가 저장자의 범위를 캐시하는 최적화가 들어올 자리가 생긴다. 화면을 W-001로 보내면 저장된 검색은 접근 통제 경로에 **아예 참여하지 않는다** — 지킬 규칙을 없애는 편이 규칙을 지키는 것보다 안전하다. CR-044가 PIT에서 배운 것과 같은 모양이다(판정이 필요한 규칙은 판정하는 사람이 틀릴 때마다 조용히 깨진다).

**커서를 합치지 않는다.** WP-032가 W-001과 W-004의 커서를 합치지 않은 것과 같은 이유이며, 여기서는 한 겹 더 명확하다 — 저장된 검색의 정본은 PostgreSQL이라 PIT도 `search_after`도 뜻이 없다. 공유하는 것은 봉인 방식과 두 오류 코드뿐이다. 대신 **팀 구성원 자격을 지문에 담는다**: `view=team` 목록의 내용은 "내가 어느 팀에 속해 있는가"가 정하므로, 지문 없이 이어 보면 회수된 팀의 항목을 계속 내주게 된다.

#### CR-049 머지 전 리뷰 라운드 (PR #59, 2026-08-27)

자동 리뷰가 셋(P1 하나·P2 둘)을 냈고 **전부 실결함이었다** — DEV-343·344·345로 등록하고 같은 PR에서 고쳤다.

| # | 지적 | 실체 |
| --- | --- | --- |
| P1 | 추적 매트릭스를 같은 pass에서 갱신하지 않았다 | **캐스케이드 5단계를 건너뛰었다.** 화면 매핑(W-001·W-008)은 그대로였지만 그 매핑이 **무엇을 뜻하는지**가 바뀌었고, "바뀐 것이 없다"는 판단이 그 차이를 못 봤다 (DEV-343) |
| P2 | 팀 구성원 판정과 쓰기 사이에 창이 남는다 | **`READ COMMITTED`에서 문장마다 스냅숏이 새로 잡힌다.** 한 트랜잭션 안이라도 읽은 뒤의 탈퇴를 `INSERT`가 보지 못한다. `FOR SHARE` 잠금으로 닫았다 (DEV-344) |
| P2 | 같은 CR이 한 오류 코드를 두 곳에서 다르게 적었다 | 계약은 지문 불일치를 `CURSOR_QUERY_MISMATCH`로 분류하는데 WP DoD는 남의 커서를 `CURSOR_INVALID`로 적었다. **구현이 어느 한쪽을 위반할 수밖에 없었다** (DEV-345) |

**CI가 이 CR과 무관한 결함 하나를 함께 드러냈다** (DEV-346). 문서만 바꾼 커밋에서 통합 시험 하나가 실패했다 — `link-rebuild.test.ts`의 `settle`이 "이벤트가 멎었다"를 "처리가 끝났다"로 읽고 있었고, 느린 실행기에서 사슬 도중의 조용한 구간에 걸렸다. **재시도로 넘기지 않고 원인을 고쳤다** — 대기 시간을 늘리면 더 느린 실행기에서 같은 실패가 다시 나므로, 기대하는 상태를 직접 묻게 했다. 이 CR의 계약 변경이 아니라 CI 차단 해소이며 그 사실을 커밋에 적었다.

**P2 하나가 이 CR 안의 모순이었다는 것이 무겁다.** 같은 문서에서 `/run`에 대해 "갱신 문장 자체가 권한 조건을 다시 건다"고 TOCTOU 방어를 적어 놓고, **쓰기 경로에는 그 규율을 적용하지 않았다.** CR-046이 배운 것과 같은 자리다 — 적어 둔 위험을 내가 막지 못했다. 이번에는 그 규율을 API 계약과 데이터 모델 **두 곳**에 남겼다.

### CR-048 반영 내역 (2026-08-27)

1. **`srs_final.md` — 변경 없음(v2.8 유지).** 승인된 기능(FR-AUTH-003)이 배포되지 않은 것을 고쳤을 뿐이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `deploy/k8s/pipeline-worker-authz.yaml` — **신설.** `PIPELINE_WORKER_ROLES=authz` · `replicas: 1` · grace 60s · 미러 볼륨 없음. GHE 자격 증명이 선택인 이유와 **없을 때 색인 소급이 돌지 않는다는 결과**를 주석에 남겼다
3. `deploy/k8s/README.md` — 적용 순서에 등재
4. `30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.5.** 배포 단위 표에 `pipeline-worker:authz`(적체 축 `prs:permission`, 상한 **1 / 4**) 등재
5. `regression/runtime-reachability.test.ts` — 미배포 예외에서 `authz` **제거**, 도달성 표에 JOB-AUTH-001 등재(기동·종료·역할·manifest·ROLES 값), `배포된 역할이 예외에 남아 있지 않다`에 `authz` 추가. 회귀 187 → **192**
6. `40_delivery/pr_search_implementation_traceability.md` — **v3.6.** DEV-306 resolved, 리뷰 정정 둘(DEV-321·322)

**PR #53 리뷰 둘 — 문서가 스스로와 어긋난 자리.** 표에 같은 단위가 두 줄 올랐고(DEV-321), 표 아래 산문이 그 역할을 여전히 미배포로 적고 있었다(DEV-322). 둘 다 회귀가 잡지 못했다 — 앞의 것은 검사가 역할을 `Set`으로 다뤄서, 뒤의 것은 표만 보고 산문을 보지 않아서다. 검사 둘을 신설하고 변이(A-M4·A-M5)로 킬을 확인했다. 회귀 192 → **194**.

**중복의 직접 원인은 스크립트가 멱등이 아니었던 것이다.** `git checkout --`로 잃은 편집을 복구하려 같은 편집 스크립트를 다시 돌렸고, 앵커가 여전히 맞아 한 번 더 삽입됐다.

**정상 경로가 시험이 지목한 그대로였다.** CR-047이 "예외를 지우고 manifest를 만드는 것이 정상 경로"라고 적으며 그 길을 시험으로 강제했고, 이 CR이 처음으로 그 길을 걸었다 — 예외를 지우자 세 검사(코드 → manifest, 승인 표 → manifest, 서로 덮기)가 모두 다시 말을 하기 시작했다.

**행위는 바꾸지 않았다.** 무효화 핸들러·캐시 삭제·소급 적용은 전부 그대로다. 그래서 이 CR의 증거는 새 동작 시험이 아니라 **도달성**이다 — manifest 삭제·`ROLES` 값 변조·적용 순서에서 제거, 셋 다 회귀가 잡는 것을 확인했다.

**남은 미배포 둘.** `release`(DEV-305, 미러 PVC 배치가 함께 필요 — WP-024 소관)와 `backfill`(DEV-304, `enrich` 파드의 역할 구성 판단이 필요 — WP-019 소관)은 각자의 WP에서 다룬다. 예외 목록에 사유와 함께 남아 있다.

### CR-047 반영 내역 (2026-08-26)

1. **`srs_final.md` — 변경 없음(v2.8 유지).** 시험 하나의 예외 적용 범위를 좁힌 것이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `regression/runtime-reachability.test.ts` — `승인 표 → manifest` 방향에서 **예외 적용을 제거**하고, `미배포 예외 역할은 배포 단위 표에 오르지 않는다`를 신설했다. 회귀 150 → **151**
3. `40_delivery/pr_search_implementation_traceability.md` — **v3.4.** DEV-312 등록

**예외를 두 방향에 다 걸면 예외가 검사를 삼킨다.** CR-046이 검사가 덮는 면을 넓히면서 예외도 함께 넓혔고, 그 결과 예외 역할에 대해서는 **세 검사가 모두 침묵하는** 상태가 됐다. 예외는 *알려진 미배포*를 뜻하지 *검사 면제*를 뜻하지 않는다 — 두 방향 중 **한쪽에만** 걸어야 한다.

**정상 경로를 시험이 지목한다.** 예외 역할을 배포하고 싶으면 manifest를 만들고 예외 목록에서 지운다. 표에 먼저 올리는 것은 표를 사실과 어긋나게 만드는 일이며, 이제 그것이 실패한다.

### CR-046 반영 내역 (2026-08-26)

1. **`srs_final.md` — 변경 없음(v2.8 유지).** 넷 다 CR-045가 만든 **하위 계약과 그 구현의 결함**이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `30_technical_architecture/pr_search_async_events_jobs.md` — 울타리 구간을 **대상 확정 → 두 인덱스 쓰기 완료 → shadow 실패 기록**까지로 늘렸다. 전환은 **진행 중인 논리 쓰기가 하나도 없을 때만** 별칭을 옮긴다
3. `30_technical_architecture/pr_search_api_contracts.md` — 대상 버전을 **아직 쓰이지 않은 다음 번호**로 고쳤다. 고아 shadow는 명시적으로 제거·인수한 뒤 큐에 넣는다
4. `30_technical_architecture/pr_search_infrastructure_operations.md` — `pipeline-worker:batch`의 상한을 **1 / 1**로 정정하고 사유를 적었다
5. `regression/runtime-reachability.test.ts` — **정본을 둘로 읽는다**: 코드 갈래 → manifest, 인프라 표 → manifest, 그리고 둘이 서로를 덮는지. 회귀 148 → **150**
6. `40_delivery/pr_search_work_packages.md` — **v1.1.** WP-035의 회귀 항목을 "역방향"에서 **"양방향"**으로 정정하고 DoD 셋을 더했다
7. `40_delivery/pr_search_implementation_traceability.md` — **v3.3.** DEV-308~311 등록, 6.38.1장 신설

**두 결함이 같은 것을 말한다 — 내가 쓴 위험을 내가 막지 못했다.** (1)은 막아야 할 경주를 **표로 적어 놓고** 울타리를 그것보다 짧게 잡았고, (3)은 정본이 무엇인지 **WP 문서에 적어 놓고** 구현에서 그 절반만 읽었다. 둘 다 "적은 것"과 "한 것"이 어긋난 자리다.

**DEV-291과 같은 계열이 다시 나왔다.** 그때는 하위 문서만 고쳐 baseline과 어긋났고, 이번은 계약을 적어 놓고 구현이 그것을 따르지 않았다. **적는 것과 지키는 것은 다른 일이며, 그 차이를 잡는 것은 시험뿐이다** — 그래서 이번 정정의 핵심도 시험이다.

### CR-045 반영 내역 (2026-08-26)

1. **`srs_final.md` — 변경 없음(v2.8 유지).** FR-ING-008이 이미 새 인덱스·이중 쓰기·원자 전환·7일 보관·실패 시 미전환을 승인한다. 이 CR이 채우는 것은 **어디에 이중으로 쓰는지, 전환을 언제 해도 되는지, 실패했을 때 무엇이 남는지**라는 하위 계약이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `30_technical_architecture/pr_search_api_contracts.md` — **v0.7.** **API-ADM-004 상세 절 신설**: `alias`만 받고 다음 버전은 서버가 정한다, `operator` 전용, 동시 실행 상한 1(`409 REINDEX_BUSY`), `progress.phase` 여섯, 보관 정본이 `job.progress`임을 명시. API-ADM-002의 일반 잡 생성 목록에는 넣지 않는다
3. `30_technical_architecture/pr_search_async_events_jobs.md` — **v0.3.** **3.5장 신설**: 불변식 아홉 · **이중 쓰기 대상 열일곱 전수** · 활성화·전환 울타리 · 정본 재구축(별칭별 원본) · 전환 전 검증 일곱 · 실패·취소 처분 다섯 · 보관 · 배포
4. `30_technical_architecture/pr_search_infrastructure_operations.md` — **v0.4.** 배포 단위 표에 `mirror`·`reconcile` 등재(manifest는 있었는데 표에 없었다), `batch` 설명 보강, **표와 `deploy/k8s/`가 서로를 검사한다**는 규칙 명시
5. `deploy/k8s/pipeline-worker-batch.yaml` — **신설.** 승인된 배포 단위를 실재시킨다. `deploy/k8s/README.md` 적용 순서에 등재
6. `regression/runtime-reachability.test.ts` — **역방향 도달성 검사 신설.** 코드가 갈래를 만든 역할은 그것을 세우는 manifest를 가져야 한다. 예외는 사유와 DEV 번호를 함께 요구한다
7. `40_delivery/pr_search_work_packages.md` — **v1.0.** WP-035 전면 재작성(선행 이유·구현 범위 18항·제외 4항·DoD 18항)
8. `40_delivery/pr_search_implementation_traceability.md` — **v3.2.** DEV-292~307 등록, **6.38장 신설**

**감사가 재색인보다 먼저 다른 것을 드러냈다.** JOB-ING-006의 워커는 `batch` 역할인데 그 역할을 세우는 manifest가 저장소에 없었고, 그래서 **이미 구현된 JOB-ING-007(아웃박스 재적재)이 배포되지 않고 있었다.** CR-034가 세운 운영 도달성 계층이 이것을 놓친 이유는 **방향**이다 — "존재하는 manifest가 적용 순서에 있는가"만 물어 **없는 파일은 물음의 대상이 아니었다.**

**역방향 검사가 세 개를 더 드러냈다** — `backfill`(DEV-304) · `release`(DEV-305) · `authz`(DEV-306). 셋 다 각자 다른 WP가 만든 기능이 배포에서 죽어 있는 것이며 **이 CR에서 고치지 않고 예외 목록에 사유와 DEV를 붙여 등재했다.** `authz`는 권한 캐시 무효화라 **접근 통제 축이며 위협 모델과 함께 별도 CR로 다루는 것이 옳다.**

**WP-035의 본체는 구현하지 않았다.** REL-004는 이 CR 시점 기준 3/8이었다 (현재 값은 원장 3장 표에서 읽는다 — DEV-324).

### CR-044 반영 내역 (2026-08-26)

1. **`srs_final.md` — v2.7 → v2.8.** FR-SEQ-002 **AC-7의 봉인 값을 정정**했다 — "마지막으로 검사한 서수"에서 **완결 서수**(그 서수 이하의 일치를 모두 반환했음이 보장되는 지점)로. 다섯 중 넷은 하위 계약의 결함이었으나 **2번(DEV-287)은 baseline 자신이 틀렸다** — 하위 문서만 고치면 WP-032가 배타적인 지시 둘을 받는다(DEV-291, PR #49 리뷰 P1). **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
1-1. `10_requirements/requirements_screen_traceability_matrix.md` — **v0.5.** SRS 버전이 올랐으므로 같은 pass에서 대조했다. **매핑 변경 0건** — AC-7의 정의가 바뀌었을 뿐 노출 화면과 소유는 그대로다
2. `30_technical_architecture/pr_search_architecture_decision_records.md` — **v0.4.** ADR-010 Amendment 3번을 **"모든 커서 순회에 PIT"**으로 정정하고, 정렬 키 여섯이 무엇 때문에 움직이는지를 표로 남겼다. 키별로 가르는 안을 기각한 이유도 적었다
3. `30_technical_architecture/pr_search_api_contracts.md` — **v0.6.** 「커서 계약」의 PIT 문단 정정, 구간 페이지 구성 4단계를 **두 갈래**로 정정(페이지가 찼으면 실은 마지막 일치까지만), **정본 응답 예시의 `highlight`를 구조화 형태로 교체**, 정본 응답에 `facets_status` 추가, 옛 3분기 패싯 표를 네 상태로 교체하고 정본 표가 어디인지 명시
4. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.5.** W-004의 `cursor_rejected`를 `cursor_rejected_mismatch`·`cursor_rejected_invalid` 둘로 분리(W-001과 같은 모양)
5. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.5.** QA-W001-29(정렬 값이 움직여도 중복·누락 없음), QA-W004-28(구간 커서 invalid), QA-W004-29(chunk 안 일치가 `size`보다 많아도 사라지지 않음) 신설
6. `40_delivery/pr_search_work_packages.md` — **v1.0.** WP-032 구현 범위 둘과 DoD 둘을 정정
7. `40_delivery/pr_search_implementation_traceability.md` — **v3.1.** DEV-286~**291** 등록, **6.37.1장 신설**(머지 후 리뷰 라운드 + PR #49 리뷰)

**리뷰가 머지 뒤에 온 것이 여섯 번째다.** 이번에는 CI 초록 뒤 6분을 기다렸는데도 0건이었고, 병합 직후 전수 재확인에서 다섯이 도착해 있었다. **머지 전 대기로는 이 패턴을 이길 수 없다** — 머지 직후 재확인이 규율인 이유가 그것이다.

**정정이 다시 리뷰를 받았고 그것이 옳았다.** 2번을 하위 문서에서만 고친 것이 baseline과 어긋났다 — 규율을 지키려다 규율을 어겼다. **완결 서수**로 다시 정의하니 두 실패(DEV-270의 "전진하지 못한다"와 DEV-287의 "너무 멀리 간다")가 **하나의 물음**으로 합쳐졌다: *이 지점 이하에 아직 내주지 않은 일치가 있는가.* **한쪽 실패만 보고 쓴 규칙은 반대쪽에서 깨진다** — AC-7의 첫 문장이 그랬고 그것을 고친 첫 시도도 그랬다.

**두 P1이 이 라운드의 소득이다.** 하나는 "내가 세운 예외 규칙을 내가 틀리게 셌다"(불변으로 센 `updated_at`), 다른 하나는 **"결함의 모양을 이해하고 재현까지 한 뒤에 그것을 고치는 계약에서 같은 계열을 새로 만들었다"**(DEV-270 → DEV-287)이다. 후자가 더 무겁다 — 모양을 아는 것과 다시 만들지 않는 것은 다른 일이다.

### CR-043 반영 내역 (2026-08-26)

1. **`srs_final.md` — v2.6 → v2.7.** FR-SEQ-002에 **AC-6·7·8**을 더했다(구간 커서 순회와 오프셋 부재 · 커서 봉인 재료 · 패싯 계산 대상). 예외 처리에 에폭 변경 시 옛 커서의 처분을 적었다. FR-SRCH-009는 관련 화면에 **W-004**를, 관련 API에 **API-SEQ-001**을 더했고 AC-1을 화면별 패싯 축으로, AC-3에 "선택된 패싯 값도 조건에 포함한다"를 명시했으며 예외 처리에 생략·실패 구분을 더했다. **기존 AC는 한 글자도 바뀌지 않았다. 신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `10_requirements/prd.md` — **v1.3.** SCN-002 기본 흐름의 패싯 목록을 SRS와 맞췄다(작성자·팀·라벨·경로)
3. `10_requirements/requirements_screen_traceability_matrix.md` — **v0.4.** SRS 버전이 올랐으므로 같은 pass에서 대조했다. **매핑 3건 변경**: FR-SRCH-009에 W-004 추가, FR-SEQ-002에 커서·패싯 소유 명시, **FR-SRCH-008에서 W-004 제거**. 셋째가 이 pass의 소득이다 — 매트릭스가 W-004의 커서를 FR-SRCH-008에 걸고 있었으나 그 요구사항의 SRS 관련 화면은 W-001뿐이었고, 무엇보다 두 화면은 순회하는 정본이 다르다. 기능은 그대로 남고 소유가 FR-SEQ-002(Must)로 옮겨졌다
4. `30_technical_architecture/pr_search_api_contracts.md` — **v0.5.** API-SRCH-004에 「커서 계약」·「패싯 계약」·「전문 검색 계약」 세 절 신설(봉투·지문·오류 갈래·PIT·`relevance` 방향·상태 넷·bucket 단위 검증·self-filter·예산 격리·`team` 필드·페이지 2 이후·강조 구조·대상 한정·코드 포인트). API-SEQ-001에 「구간 커서와 패싯」 절 신설과 오류 코드 둘 추가
5. `30_technical_architecture/pr_search_architecture_decision_records.md` — **v0.3.** **ADR-010에 Amendment**를 붙였다. 결정을 바꾸지 않고 셋을 명시한다: ① 이 결정은 **색인이 결과 집합을 소유하는 조회**에 적용되며 W-004의 커서 재료는 정본을 따라간다 ② 봉투는 버전·무결성·만료를 갖는다 ③ 점수 정렬에는 PIT이 필요하다
6. `30_technical_architecture/pr_search_backend_architecture.md` — **v0.3.** 성능 표의 `깊은 페이징`을 W-001·W-004로 갈랐고, `패싯`을 **별도 요청 + 1.5초 상한**으로 고쳤다(왕복 하나를 아끼는 것보다 실패 도메인을 가르는 것이 먼저다). 실패 처리 표의 `집계 타임아웃 (5초)`가 통계 API의 예산이며 검색 패싯의 것이 아님을 명시
7. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **v0.4.** THR-003에 패싯 구현 계약(집계도 `ScopedQuery`, `team` 패싯의 접근 통제 불변식), THR-014에 PIT 자원 상한, THR-018에 **강조의 raw HTML 금지**를 더했다
8. `20_derived_ui_specs/pr_search_ui_component_spec.md` — **v0.4.** C-012에 `failed` 상태와 화면별 축, C-016에 커서 불투명성·패싯 재요청 금지·오류 갈래 둘·W-004 재사용
9. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.4.** `W-001-FACETS`의 축을 여섯으로 확정(기간·시퀀스는 필터 입력이지 패싯이 아니다 — DEV-285), `W-001-PAGER`에 오류 처분, `W-004-FACETS`에 SRS v2.7 근거와 구간 전체 계산, `W-004-RESULTS`에 커서 순회, W-004 컴포넌트에 `C-016` 추가
10. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.4.** W-001에 `facets_omitted`·`facets_not_computed`·`cursor_rejected_mismatch`·`cursor_rejected_invalid` 신설, W-004에 `loading_more`·`cursor_rejected`·패싯 실패 신설
11. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.4.** QA-W001-15·16·17 경화, QA-W001-26(강조 평문)·27(패싯 재계산 금지)·28(코드 포인트) 신설, QA-W004-23~27 신설
12. `40_delivery/pr_search_work_packages.md` — **v0.9.** WP-032 전면 재작성(선행 WP에 **WP-035**, 구현 범위 15항, 제외 3항, DoD 9항 → **22항**), 3장 순서표를 **실행 순**으로 정렬하고 그 사실을 명시
13. `40_delivery/pr_search_implementation_roadmap.md` — **v0.4.** 의존성 지도에 WP-035 → WP-032 행 추가, REL-004 마일스톤에 실행 순서 명시
14. `40_delivery/pr_search_implementation_traceability.md` — **v2.9.** DEV-266~285 등록, **6.37장 신설**(감사 결과·두 벽의 실측·재현한 결함·탈락한 후보 다섯), §8의 REL-004 표를 실행 순으로 바꾸고 감사 물음 넷에 답을 붙였다

**제품 범위를 넓히는 변경이 하나 있다.** 이 저장소의 CR 여덟 중 일곱은 "이미 승인된 요구사항이 남긴 빈칸을 메우는" correction이었으나 이번은 다르다 — W-004의 패싯과 커서는 SRS가 승인한 적이 없다. **기능을 지우는 선택도 있었다**(와이어프레임과 WP-032에서 W-004 패싯을 삭제). 그러지 않은 이유는 셋이다: PRD의 SCN-002가 이미 그 동작을 서술하고, 5만 건 구간에 페이지 크기 200이면 **끝까지 훑을 방법이 없어** 이 제품의 핵심 사용이 성립하지 않으며, 그 자리를 파다가 **실제 결함**(DEV-270)이 나왔다. 넓히는 쪽이 옳다는 근거가 문서 안에 이미 있었다.

**감사가 물었던 것 중 하나는 답이 "이미 되어 있다"였다.** ADR-010은 커서의 재료·지문·동률을 정하고 있었고 동률은 `sort.ts`의 `doc_id`로 **구현까지** 되어 있었다. 인계 문서는 그것을 "어디에도 없다"고 적었다. **실측하지 않은 공백 주장은 그 자체가 공백이다** — 없는 것을 만들려다 이미 있는 것을 두 번 만들 뻔했다. 진짜 공백은 한 겹 아래(봉인·정규화·실패 갈래·PIT)에 있었고, 그것은 읽어야만 보였다.

**"실패하면 누가 다시 하는가"가 이 축에서는 다른 모양이었다.** WP-029·030·031이 세 번 연속 만난 물음인데, 검색은 조회 시점 계산이라 "깨우는" 축이 없다. 대신 같은 자리에 **"이 매핑이 인덱스에 어떻게 도달하는가"**가 있었다 — 그리고 답은 "도달하지 못한다"였다. 배포가 터지는 벽(DEV-266)은 반드시 발견되지만, **배포가 성공하고 결과만 조용히 줄어드는 벽**(DEV-267)은 그렇지 않다. 후자가 이 감사의 소득이다.

### CR-042 반영 내역 (2026-08-26)

1. **`srs_final.md` — 변경 없음(v2.6 유지).** FR-REL-003~007은 이미 관계의 조회·방향·신뢰도·근거·표시를 승인하고 있고 FR-AUTH-002는 접근 범위 강제를 승인한다. 이 CR이 하는 일은 그 승인된 의미를 **읽는 쪽에서 성립시키는 하위 계약을 채우는 것**이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `30_technical_architecture/pr_search_api_contracts.md` — **v0.4.** **API-REL-006 `GET /relations` 신설**(카탈로그 + 상세 절): 앵커 하나(`pr_number` 또는 `commit_sha`), `link_type` 하나, `direction` 하나, `limit` 기본 50·최대 100, `truncated` 봉투. **오프셋을 만들지 않는다**(공통 원칙 7, ADR-010) — 커서를 세울 요구사항이 아직 없으므로 상한과 절삭 표시로 답한다. **API-REL-003 상세 절 신설**: 자격 상태 셋(`not_merged`·`enrichment_pending`·`too_many_changed_files`), 정확 자카드, 상위 20 결정론 정렬, 겹치는 경로 상위 10의 사전순
3. `30_technical_architecture/pr_search_backend_architecture.md` — `link` 모듈 API 소유권을 **API-REL-003·004·006**으로 갱신
4. `30_technical_architecture/pr_search_frontend_architecture.md` — W-001 행에 `link_summary` 기반 관계 배지, W-002·W-003 행에 API-REL-006 추가
5. `30_technical_architecture/pr_search_security_privacy_architecture.md` — THR-034 완화 항목에 **구현 계약**을 적는다: 간선 조회와 대상 내용 조회가 **두 번의 독립한 강제 필터**를 지나며, 대상이 범위 밖이면 간선은 남기고 내용 필드를 **두지 않는다**(키 부재). 사유를 화면 문구로 구분하지 않는다
6. `20_derived_ui_specs/pr_search_ui_component_spec.md` — **v0.3.** C-021 상태 모델 재정의(항목 축과 섹션 축 분리: `detached`·`content_unavailable`·`ambiguous`·`error`), C-015에 **"요약이 없다"와 "관계가 없다"의 구분** 명시
7. `20_derived_ui_specs/pr_search_wireframe_spec.md` — **v0.3.** W-001 관계 배지 열을 WP-031이 붙인다는 것을 확정, W-002-LINKS·W-003-LINKS에 지연 조회·상한·해제·다중 후보·대상 내용 부재 표기 규칙
8. `20_derived_ui_specs/pr_search_screen_flow_spec.md` — **v0.3.** FLOW-006 관련 요구사항에 **FR-REL-006·FR-REL-007 추가**, `links_pending` 예외를 **"참조 분석 중"**으로 정정, **"백포트 누락 후보" 문장 삭제**
9. `20_derived_ui_specs/pr_search_screen_state_matrix.md` — **v0.3.** W-002의 `links_pending` 의미 정정, W-003에 관계 섹션 상태 신설
10. `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — **v0.3.** QA-W001-24(관계 배지의 세 상태 구분), QA-W002-20(해제된 스택 표시), QA-W002-21(다중 후보 표시), QA-W002-22(대상 내용 부재), QA-W003-10(커밋 관계 섹션 지연 조회) 신설
11. `40_delivery/pr_search_work_packages.md` — **v0.8.** WP-031 관련 화면에 **W-001 추가**, 관련 API에 **API-REL-006 추가**, 구현 범위·제외·DoD 재작성(DoD 8항 → **21항**)
12. `40_delivery/pr_search_implementation_traceability.md` — **v2.8.** DEV-248~265 등록, 6.36·6.36.1장 신설, FR-REL-003~007 코드·시험 매핑, §7의 e2e 관측값 갱신, WP-031 `done` · REL-004 **3/8**

**새 ADR을 만들지 않았다.** 접근 범위 강제는 ADR-008이, 간선 구조와 역방향 조회는 ADR-009가, 커서 전용 페이지네이션은 ADR-010이 이미 정했다. 이 CR은 그 셋을 **조회 축에서 실제로 성립시킨다.** 특히 "간선 하나만 저장하고 역방향은 `to_id`로 조회한다"(ADR-009)는 결정이 **저장소를 건너뛰는 참조에서는 라우팅을 포기해야 성립한다**는 것을 명시한 것이 이 CR의 정정이며, 결정을 바꾸는 것이 아니라 그 결정이 요구하는 대가를 적는 것이다.

**새 마이그레이션을 만들지 않는다.** CR-041이 마이그레이션 014를 만든 이유는 파생 정본이 PostgreSQL이어야 하는데 후보 탐색 인덱스가 없었기 때문이다. 조회는 사정이 다르다 — 읽는 것이 전부 Elasticsearch(`prs-links`·`prs-pull-requests`·`prs-commits`)이고 필요한 필드가 이미 매핑에 있다. **다음 번호가 015라는 이유로 빈 마이그레이션을 만들지 않는다** (CR-039가 세운 규율).

**열여덟 중 아홉이 같은 뿌리다.** DEV-248(조회 경로 부재)·250(역방향 라우팅)·251(read shape)·252(상한)·253(대상 교집합)·254·255·256(자격·후보·순서)·265(가드레일 면제 범위)는 전부 **"계약이 파생의 규칙만 정하고 조회가 다른 질문이라는 것을 보지 않았다"**는 하나의 공백에서 나왔다. 파생에는 요청자가 없어 저장소 안에서 끝나지만, 조회에는 요청자가 있고 **대상 쪽을 본다.** WP-029가 참조 축에서, WP-030이 후보 축에서 만난 것과 같은 계열의 세 번째 형태다.

### CR-041 반영 내역 (2026-08-26)

1. **`srs_final.md` — 변경 없음(v2.6 유지).** FR-REL-004~006은 이미 되돌림·체리픽·스택의 탐지 패턴·신뢰도·방향·해제·순환·깊이를 승인하고 있다. 이 CR이 하는 일은 그 승인된 의미를 **실제로 성립시키는 하위 계약을 채우는 것**이다. 요구 의미를 넓히거나 좁히지 않았다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `30_technical_architecture/pr_search_async_events_jobs.md` — JOB-REL-002·003·004 방아쇠 정정(`EVT-ING-005` 추가, 스택은 source 재파생 + child 재평가 둘 다), JOB-REL-006을 네 계열로, **3.4장 신설**(후보 변화 방아쇠·파생 정본·되돌림·체리픽·스택·계열별 수명·요약 leaf 정의·실패 처분), 3.3장에 네 계열 확장 확정, 운영 지표 `link_relations_total`·`link_stack_cycle_total` 신설
3. `30_technical_architecture/pr_search_data_model.md` — **v0.5.** `detached`가 `stacks_on` 전용이며 "지우지 않는 제거"임을 확정(복구 방향 포함), `link_summary` 네 leaf의 **계산 규칙 표** 신설(active 간선 집합에서 재계산, `has_stack`은 `detached` 제외)
4. `30_technical_architecture/pr_search_api_contracts.md` — **v0.3.** API-SEQ-001·003 요약에 `summary.reverted_pull_request_count` 등재. **요약 집계 왕복 안의 `filter` 집계**로 계산하며 간선 인덱스를 PR마다 다시 묻지 않는다는 것을 함께 못 박았다
5. `40_delivery/pr_search_work_packages.md` — **v0.6.** WP-030 구현 범위·제외·DoD 재작성(DoD 8항 → **26항**), 선행 WP에 WP-067 추가, **QA-W002-11·12를 WP-031로 이관**, WP-031에 THR-034 필수 수용 기준 명시
6. `40_delivery/pr_search_implementation_traceability.md` — **v2.5.** DEV-230~247 등록, WP-030 `in_progress`, §7의 `reverted_pull_request_count` 제한 해소 처리

**새 ADR을 만들지 않았다.** 비참조 간선의 `link_id` 재료(`{link_type}:{from_type}:{from_id}:{to_type}:{to_id}`)는 **데이터 모델 4.3장이 CR-039에서 이미 정해 두었다.** 이 CR은 그 결정을 구현 가능하게 만드는 것이며(DEV-245의 헬퍼 부재), 결정을 바꾸지 않는다. `reference_key`를 세 계열로 일반화하지도 않는다 — 그것은 **대상이 나중에 밝혀지는** 참조의 문제를 푸는 수단이고, 되돌림·체리픽·스택은 대상을 **알아낸 뒤에** 간선을 만들므로 같은 문제가 없다.

**마이그레이션 014를 만든다 — 이것이 CR-039와 다른 점이다.** CR-039는 "다음 번호가 014라는 이유로 빈 마이그레이션을 만들지 않는다"고 적었고 그것은 옳았다. 이번에는 만들 이유가 있다: **파생 정본이 PostgreSQL이어야 하는데(ADR-004) 후보 탐색에 쓸 인덱스가 없다.** 제목 대조·분기 대조·`patch_id` 대조가 모두 저장소 전체 스캔이 되면 방아쇠마다 그것을 돌 수 없고, 그러면 "ES에서 찾자"는 유혹이 생겨 ADR-004가 이 축에서 깨진다. **새 엔티티 표는 만들지 않는다** — 간선은 여전히 재파생 가능한 파생 데이터다.

**열여덟 중 열둘이 같은 뿌리다.** DEV-230·231(방아쇠가 직접 푸시를 놓친다)·232(해제 방아쇠가 반대 방향)·233(사라진 근거)·234(과거 데이터)·237·241·242·243·244(후보 다중성과 순서)·245(정체성 수단)·246(실패 처분)은 전부 **"계약이 source 본문만 보고 후보의 변화를 보지 않는다"**는 하나의 공백에서 나왔다. WP-029가 참조 축에서 만난 것의 한 겹 아래 형태다 — 참조는 source 본문만 보면 되지만, **이 세 계열은 다른 엔티티의 현재 상태가 답을 바꾼다.**

**감사가 SRS를 읽어 되찾은 것 둘.** DEV-237(다중 제목 후보 전부 저장)과 DEV-235(patch-id 세 사유)는 **SRS에 이미 있는데 WP 계약이 빠뜨린 것**이다. 하위 문서가 상위 문서보다 좁으면 구현은 하위를 따르고, 그러면 승인된 동작이 조용히 사라진다.

### CR-040 반영 내역 (2026-08-26)

1. **`srs_final.md` — v2.6.** 4.2 조건부 범위의 `nori` 행과 14장 OD-005 행을 `resolved`로 전환하고, 14장 말미의 "OD-005·OD-008 둘 다 기한이 아직 오지 않았다"는 문장을 사실과 맞췄다 — **OD-005의 기한은 REL-004 착수와 함께 도래했다**(WP-029가 REL-004의 첫 WP다). **신규 FR·NFR 없음, 안정 ID 재번호화 0건.** FR-SRCH-011의 수용 기준은 한 글자도 바뀌지 않았다
2. `10_requirements/prd.md` — **v1.2.** 5.2 조건부 범위의 한국어 형태소 검색 행과 12장 OD-005 행을 같은 결정으로 갱신. **"표준 분석기 + n-gram"을 SRS와 같은 `standard` 분석기 + `edge_ngram` 부분 일치 필드로 정밀화했다** — 같은 대체 경로를 두 문서가 다르게 부르고 있었고, WP-032가 어느 쪽을 구현해야 하는지가 그 차이에 걸려 있다
3. `30_technical_architecture/pr_search_data_model.md` — `text_ko_en` 주석을 결정 이후 상태로 정정. 분석기 **이름은 계속 유지**하며 교체는 재검토 조건 충족 시 별도 CR
4. `30_technical_architecture/pr_search_infrastructure_operations.md` — 전용 클러스터 근거에서 `nori`를 **현재 의존성이 아니라 재검토 시 필요해지는 것**으로 정정. 전용 클러스터 결정 자체(OD-006)는 변하지 않는다 — ADR-008의 필수 접근 범위 필터와 `dynamic: strict` 매핑만으로도 근거가 선다
5. `40_delivery/pr_search_implementation_roadmap.md` — Design 게이트의 오픈 결정 목록에서 OD-005 제거, 차단 없는 오픈 결정 문단 갱신
6. `20_derived_ui_specs/pr_search_ai_agent_implementation_request.md` — OD-005를 해소된 것으로 옮기고 "두 경로를 유지하는 비용" 문구에서 제외
7. `40_delivery/pr_search_work_packages.md` — **v0.5.** WP-032에 **초기 구현은 대체 분석기**라는 결정을 명시. `nori` 경로를 준비하는 코드를 만들지 않는다
8. `40_delivery/pr_search_implementation_traceability.md` — **v2.4.** OD 현황 문단을 갱신하고(남은 open은 OD-008 하나), 6.34.1장의 "사용자 결정 항목으로 열려 있다" 기록을 CR-040으로 종결 처리
9. `10_requirements/requirements_screen_traceability_matrix.md` — **v0.3.** SRS 버전이 오르면 같은 pass에서 다시 본다(`10_requirements/AGENTS.md`). **매핑 변경 0건** — OD-005는 FR-SRCH-011의 구현 경로를 고른 것이고 수용 기준·노출 화면은 바뀌지 않았다. 대조했다는 사실을 헤더와 검증 메모로 남겼다 (PR #45 리뷰 P1)
10. `30_technical_architecture/pr_search_data_model.md` — **v0.4**, `pr_search_infrastructure_operations.md` — **v0.3.** 내용이 실질적으로 바뀐 문서의 상태 헤더를 갱신했다(`docs/AGENTS.md`) — 다른 일곱 문서는 올렸는데 이 둘만 빠져 있었다 (PR #45 리뷰 P1)
11. `00_governance/change_control.md` — 3장 대장에 CR-040, 6장 미결 항목에서 OD-005를 해소 처리

**validator 결과 (변경 절차 2장 4항, `00_governance/AGENTS.md`).**

```
python3 validate_srs_prd_env.py --root . --strict
  → 종료 코드 1. ERROR 2건:
      unresolved placeholders (9) in docs/00_governance/change_control.md
      unresolved placeholders (5) in docs/40_delivery/pr_search_implementation_traceability.md
python3 validate_srs_prd_env.py --root <origin/main worktree> --strict
  → 종료 코드 1. ERROR 2건: **같은 파일, 같은 수(9, 5).**
```

**이 CR이 만든 신규 issue는 0이다** — 두 수가 `origin/main`과 정확히 같다.

**남은 2건은 이 게이트의 자기참조 오탐이다 (실측).** 이 게이트는 네 낱말(영문 약어 둘·한글 표현 둘)을 문서 전문에서 세는데, `change_control.md`의 9건 중 **5건이 395행 한 줄**에서 나온다 — 그 줄은 이 저장소가 기록해 둔 **미결 표식 검색 명령 자체**이며, 검사기가 **자기 검색어를 미해결 표식으로 센다.** 나머지 넷과 원장의 다섯은 전부 "…는 아직 정해지지 않았다"류의 **과거 상태를 서술하는 산문**이고 채워야 할 빈칸이 아니다 — 395행 자신이 "전부 서술문이고 자리표시자가 아니다"라고 이미 적고 있다.

**이 오탐은 설명하는 것만으로 재생산된다.** 이 CR을 쓰면서 그 네 낱말을 인용해 설명했더니 두 파일의 수가 각각 다섯씩 늘었다(9→14, 5→10). 검사가 코드 펜스·인용 안을 가리지 않기 때문이다. 그래서 위 문단은 **낱말을 재생산하지 않고** 같은 사실을 적었다 — 게이트를 통과시키려고 사실을 흐린 것이 아니라, 검사 대상이 되는 표현을 쓰지 않고 기술한 것이다.

**그래서 CR-040을 `closed`로 둔다.** `AGENTS.md`가 요구하는 것은 캐스케이드와 validator 결과의 **기록**이고 위가 그것이다. 이 게이트를 `exit 0`으로 만들려면 **OD-005와 무관한 역사 서술을 고쳐야 하고, 그중 하나는 검증 명령 문자열 자체다** — 결정 CR 하나를 그 정리에 묶으면 어떤 CR도 닫을 수 없다. 판정 기준은 **"이 변경이 새 issue를 만들었는가"**이며 답은 0이다. 이 오탐 자체는 원장 §7에 기술 부채로 등록했다 — 도구가 자기 검색어를 세는 문제이므로 별도 작업이다.

**이 CR은 코드를 만들지 않는다.** `edge_ngram` 부분 일치 필드는 WP-032의 구현 범위이고, 지금 만들면 그 WP의 매핑 결정(필드 이름·`min_gram`/`max_gram`·`search_analyzer` 분리)을 검증 없이 선점하게 된다. **결정을 문서에 확정하는 것과 그 결정을 구현하는 것은 다른 작업이다.**

**`packages/es/src/settings.ts`의 주석은 그대로 둔다.** 그 주석이 말하는 것은 "OD-005 결정에 따라 내부 토크나이저를 교체할 수 있으며 **이름은 바꾸지 않는다**"이고, 이 결정은 정확히 그 성질을 유지하기로 한 것이다 — 재검토 경로가 열려 있으므로 문장은 여전히 참이다.

**왜 지금 닫는가.** 이전 세 문서(SRS 14장·PRD 12장·원장)가 모두 "기한이 아직 오지 않았다"고 적고 있었으나 **REL-004는 WP-029로 이미 시작됐다.** 기한이 지난 결정을 열어 두면 두 갈래를 유지하는 비용이 계속 들고(에이전트 브리프가 그 비용을 명시한다), 무엇보다 **문서가 사실과 다른 상태로 남는다.** CR-024가 OD-001·002·004에 대해 한 것과 같은 처리다.

### CR-039 반영 내역 (2026-08-26)

1. **`srs_final.md` — 변경 없음(v2.5 유지).** FR-REL-003이 이미 미해결 저장·대상 등장 시 해결·결정론적 멱등·PR과 커밋 양쪽을 요구한다. 이 CR이 하는 일은 그 승인된 의미를 **실제로 성립시키는 하위 계약을 채우는 것**이다. 요구 의미를 넓히거나 좁히지 않았다.
2. `30_technical_architecture/pr_search_async_events_jobs.md` — JOB-REL-001·005 방아쇠에 `EVT-ING-005` 추가, JOB-REL-006의 `job.type`(`link_rebuild`) 명시, **3.2장 신설**(참조 파생·`reference_key`·역방향 조회·해결 규칙·완전한 파생 집합·중복 제거·실패 분류), **3.3장 신설**(전량 재파생), `EVT-ING-005` 이벤트 행 신설, **되먹임 금지 표**, §5.1에 **재시도 예산 집행 주체**.
3. `30_technical_architecture/pr_search_data_model.md` — `prs-links`에 `reference_key`, **`link_id` 재료를 간선 유형별로 분리**, `to_id`·`to_repository_id`는 해결 뒤에만, `prs-commits`에 `links_pending`·`link_summary.reference_count`, 필드 소유권 절에 **`link_summary` leaf 소유 표**와 `to_repository_id`·`detached` 소유.
4. `30_technical_architecture/pr_search_architecture_decision_records.md` — **ADR-009 개정.** 결정을 뒤집지 않고 적힌 것을 구현에 맞춘다(`direction` 제거, 접근 통제 필드 넷·`to_repository_id`·`detached` 추가, `link_summary` 목록 정정, `reference_key` 추가). Consequences에 leaf 소유 분할과 대상 접근 범위 재강제, Follow-up에 PostgreSQL-only 재구축.
5. `30_technical_architecture/pr_search_backend_architecture.md` — `link` 모듈의 API 소유권을 **API-REL-003·004**로 정정하고 사유를 문단으로 남겼다.
6. `30_technical_architecture/pr_search_security_privacy_architecture.md` — **THR-034·035·036 신설** (대상 저장소 내용 유출, 접근 통제 없는 간선 생성, 외부 호스트 URL 오인).
7. `40_delivery/pr_search_work_packages.md` — **v0.4.** WP-029 구현 범위·제외·DoD 재작성, 선행 WP에 WP-067 추가, 상태 `in_progress`, **헤더 버전·갱신일 정정**(DEV-229).
8. `40_delivery/pr_search_implementation_traceability.md` — **v2.3.** DEV-215~229 등록, WP-029 행 `in_progress`.

**새 ADR을 만들지 않았다.** `reference_key`는 ADR-009가 **이미 결정한** "미해결 참조를 간선 1건 갱신으로 해결한다"를 성립시키는 수단이다. 그 결정은 `link_id`가 해결 전후로 같아야만 참인데, 문서에 적힌 ID 재료가 그것을 불가능하게 만들고 있었다. 결정을 바꾸는 것이 아니라 결정과 모순되던 세부를 고치는 것이므로 개정이 맞다.

**마이그레이션을 만들지 않았다.** JOB-REL-006이 쓸 `job.type = 'link_rebuild'`는 **마이그레이션 001의 `job_type_chk`에 이미 있다**(실측 확인). 다음 번호가 014라는 이유로 빈 마이그레이션을 만들지 않는다. 간선은 재파생 가능한 파생 데이터이므로 PostgreSQL 간선 표도 두지 않는다 — 대신 `pull_request_snapshot`·`commit_snapshot`만으로 `prs-links` 전량을 다시 만들 수 있어야 ADR-004가 이 축에서 성립하고, 그것을 JOB-REL-006과 시험이 증명한다.

**열다섯 중 다섯이 같은 뿌리다.** DEV-215(직접 푸시가 방아쇠에 없다)·DEV-217(해결이 ID를 바꾼다)·DEV-220(사라진 참조가 남는다)·DEV-221(과거 데이터가 비어 있다)·DEV-228(실패가 영원히 재시도된다)은 전부 **"한 번 만드는 것"만 계약에 있고 "다시 만드는 것"이 없다**는 하나의 공백에서 나왔다. 참조는 본문에서 파생되는데 본문은 수정되고, 대상은 나중에 색인되며, 과거 데이터는 이벤트를 남기지 않았고, 실패한 것은 누군가 다시 해야 한다.

**DEV-228은 이 CR이 감사 중에 되찾은 것이다.** 지시서가 요구한 "재시도 계약을 실제 어댑터와 대조"를 하다가 두 어댑터 모두 예산을 집행하지 않는다는 것을 확인했고, 그 사실을 확인하는 과정에서 `release.ts`가 실제로 그 함정에 빠져 있는 것을 찾았다. **PR #30의 P1 지적이 미해결로 남아 있었다** — 이전 인계가 PR #33 이상만 셌기 때문이다. 같은 함정을 link 핸들러에 다시 파지 않으려면 계약을 적는 것만으로 부족하고, 이미 빠진 곳을 함께 꺼내야 한다.

### CR-035 반영 내역 (2026-08-25)

1. **`srs_final.md` — 변경 없음(v2.5 유지).** FR-AUTH-002 AC-6이 이미 팀 기반 접근을 승인했다. 이 CR은 그것을 **채울 수단**을 세운다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `pr_search_api_contracts.md` — API-ADM-001 등록·갱신이 팀 접근 범위를 채운다는 것을 명시 (DEV-185)
3. `pr_search_data_model.md` — `repository.allowed_team_ids`(+GIN) 신설과 소유권(레지스트리, 이벤트에 싣지 않는다) (DEV-114)
4. `pr_search_async_events_jobs.md` — `permission.invalidated` 소비자가 색인 소급 적용을 함께 수행함을 기입 (DEV-187)
5. `pr_search_work_packages.md` — WP-068 DoD를 실제 색인 왕복 기준으로 명확화
6. 원장 — DEV-185~187 등록·해소, **DEV-114 해소**, WP-068 `todo` → `done`, 검증 기록 6.30장 신설(릴리스 게이트는 6.31로), 원장 v1.7
7. 구현 — 마이그레이션 `011_repository_teams`, `packages/github`의 `listRepositoryTeams`, `packages/db`의 `setAllowedTeams`·`findRepositoriesForTeam`, `packages/es`의 `TEAM_SCOPED_ALIASES`·`applyRepositoryTeams`, `apps/search-api/src/ops/repositories.ts`의 `syncRepositoryTeams`, 워커 authz 소비자의 `refreshRepositoryTeams`
8. 검증 — 타입·lint·lint:deps, 단위 1235(1 skipped), a11y 192, e2e 67, 통합 746, 회귀 61, contrast 80쌍 전량 통과. **변이 3종 전부 킬**
9. **NOT RUN** — 실제 GHE `listRepositoryTeams` 호출(사내망 전제), 팀 웹훅 수신부터 소급까지의 전 구간(클러스터 부재 — 각 구간은 따로 검증했다)

### CR-034 반영 내역 (2026-08-25)

1. **`srs_final.md` — 변경 없음(v2.5 유지).** FR-ADMIN-003·FR-ING-011·API-ADM-007의 승인된 의미는 그대로다. 구현이 그 계약에 **도달하지 못한** 것을 고치는 작업이다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `pr_search_api_contracts.md` — API-ADM-007에 운영 가용 조건(GHE 자격 증명)과 수동 복구 전략을 명시 (DEV-177·182)
3. `pr_search_async_events_jobs.md` — JOB-SEQ-002·SEQ-003·ING-005·ING-008의 **소유 역할**을 `batch`에서 실제 역할로 정정하고, head 복구가 `sequence.requested`를 내는 것을 소비 이벤트에 기입 (DEV-178·179·180)
4. `pr_search_data_model.md` — `pull_request_snapshot` 표 신설과 그 근거(ADR-004가 백필 경로에서 깨져 있었다) (DEV-184)
5. `deploy/k8s/README.md` + `pipeline-worker-sequence.yaml` + `pipeline-worker-reconcile.yaml` — REL-003 두 역할의 배포 단위 신설. **주기 스윕이 있는 역할은 replica 1**이며 수평 확장 전에 claim 규칙을 세운다고 명시 (DEV-183)
6. `pr_search_work_packages.md` — WP-028 DoD에 **운영 도달성** 항목 신설 (기동·종료·배포 manifest·정본 기록)
7. 원장 — DEV-177~184 등록·해소, WP-028 `done` → `in_progress` → (CR-034 병합 후) `done`, FR-ADMIN-003·FR-ING-011 매핑 갱신, **6.28.1장(리뷰 라운드 + 운영 도달성 표)** 신설, 원장 v1.6
8. 구현 — `223e84d`(계약)·`e363b97`(구현)·`97d0637`(원장) / PR #37, `main` 병합 `a620899`. `apps/search-api/src/runtime.ts`(조립 이음매), `apps/pipeline-worker/src/sequence-repair-runner.ts`, `sequence.ts`의 `repairSequence`, `reconcile.ts`(버스 경로), `consistency.ts`(지문 대조), `snapshot.ts`, 마이그레이션 `010_pr_snapshot`, `reconcile` 역할
9. 시험 — `regression/runtime-reachability.test.ts` **신설**: "선언한 기능이 배포에서 실제로 실행되는가"만 묻는 계층이다. 실제 git으로 검증하는 `integration/sequence/repair.test.ts`도 함께
10. 검증 — 타입·lint·lint:deps, 단위 1235(1 skipped), a11y 192, e2e 67, 통합 727, 회귀 57, contrast 80쌍 전량 통과. **결함 재적용 12종 전부 킬 확인**
11. **NOT RUN** — 실제 Kubernetes 적용(클러스터 부재, manifest는 정적 검증만), 실제 GHE smoke, 배포된 워커의 큐 소진

### CR-033 반영 내역 (2026-08-25)

1. **`srs_final.md` — v2.5.** FR-ADMIN-003의 예외 처리를 정정했다: 커밋 그래프를 읽을 수 없으면 점검을 **실패로 종료**하고 사유·상관 ID를 보고하되 **시퀀스 공간의 기존 상태는 보존**한다. 실패를 정상 점검 결과로 표현하지 않는다 (DEV-171). **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `pr_search_api_contracts.md` — API-ADM-007 확장: `mode`·권한·`new_epoch_expected` 계산, **점검 실패 응답 형식**(`check_state: "failed"`), `first_mismatch`가 최초 지점이라는 규칙, `impact_estimate` 세 항목의 계산 근거, **`affected_saved_search_count` 판정 규칙 표**(파서 기반·보수적 포함) (DEV-171·172·173)
3. `pr_search_async_events_jobs.md` — JOB-SEQ-003·JOB-ING-008 스케줄 주석에 결정 반영, 운영 지표 5종 추가(`sequence_integrity_mismatch_total`, `sequence_integrity_check_failed_total`, `projection_consistency_mismatch_total`, `reconcile_incomplete_cycles`, `reconcile_missing_total` 라벨 명시) (DEV-171·174·176)
4. `pr_search_work_packages.md` — WP-028 DoD를 7항 → **18항**으로 확장하고, 제외에 **실제 알림 발송 이월**을 명시 (DEV-176)
5. 원장 — DEV-171~176 등록·해소, **DEV-128 해소**(마이그레이션 009), WP-028 상태 `todo` → `done`, FR-ADMIN-003·FR-ING-011 매핑, 검증 기록 6.28장 신설(기존 릴리스 게이트는 6.29로), 원장 v1.5
6. 구현 — `b9d3b1c`(계약)·`4d192b2`(구현)·`f9df507`(원장) / PR #35, `main` 병합 `4b954d1`. 마이그레이션 `009_job_type_reassign`(up/down), `packages/domain/src/integrity.ts`(대조 규칙 한 벌), `packages/db/src/repositories/integrity.ts`, `apps/search-api/src/ops/sequence-integrity.ts`(API-ADM-007), `apps/pipeline-worker/src/{integrity,reconcile,consistency}.ts`(JOB-SEQ-003·JOB-ING-005·JOB-ING-008), `packages/github/src/client.ts`(`direction` 옵션), 지표 5종
7. 검증 — 타입·lint·lint:deps, 단위 1218(1 skipped), a11y 192, e2e 67, 통합 709, 회귀 27, contrast 80쌍 전량 통과. **결함 재적용 9종 전부 킬 확인**
8. 기각한 갈래 — `sequence_space.state`에 `check_failed`를 더하는 안(갈래 B). 시퀀스 상태와 진단 실행 상태는 다른 개념이며, 한 번의 일시적 그래프 실패가 정본 상태를 오염시키고 마이그레이션·C-027·W-004가 그것을 물려받는다

### CR-032 반영 내역 (2026-08-25)

1. **`srs_final.md` — 변경 없음(v2.4 유지).** FR-REL-001은 이미 `(저장소, 대상 브랜치)` 시퀀스 공간을 전제한다. 이 CR은 그 전제를 API·화면이 **정확히 지정**하게 만드는 하위 계약 정정이므로 baseline을 건드리지 않는다. **신규 FR·NFR 없음, 안정 ID 재번호화 0건**
2. `pr_search_api_contracts.md` — API-REL-001에 **`base_branch` 필수 파라미터** 추가, 다중 공간 앵커 규칙과 `sequence_space` 불변식 명시, `merged_at`의 행 종류별 규칙 명시, 404 사유에 "채번된 적 없는 공간" 추가 (DEV-168·169)
3. `pr_search_ui_component_spec.md` — C-019 "머지 시각" 칸의 `null` 표기와 실패 상태의 재시도 수단을 명세에 넣는다 (DEV-169·170)
4. `pr_search_screen_state_matrix.md` — W-002·W-003 선행·후행의 `error` 상태에 복구 경로(재시도)를 기록 (DEV-170)
5. `pr_search_screen_qa_checklist.md` — QA-W002-20(공간 지정)·QA-W002-21(실패 복구)·QA-W002-22(머지 시각 경계)·QA-W003-09(커밋 화면 공간 지정) 신설
6. `pr_search_work_packages.md` — WP-027 DoD에 공간 지정·시각 경계·실패 복구 3항 추가 (머지 후 정정이므로 WP는 신설하지 않는다)
7. 원장 — DEV-168~170 등록·해소, 6.27장에 **리뷰 라운드 표**(머지 후) 추가, FR-REL-001 매핑을 `base_branch` 판별자까지 갱신
8. 구현 — `e514bfe`(문서)·`394854a`(코드) / PR #34, `main` 병합 `1d0dee2`. `apps/search-api/src/sequence/{neighbors,routes}.ts`, `apps/web/components/NeighborSequenceList.tsx`. **`packages/db`는 변경 없음** — 공간 한정 앵커 조회는 API-SEQ-002가 쓰던 `findPointByPullRequest`/`findPointByCommit`을 그대로 재사용했다(같은 질의를 두 벌 두지 않는다)
9. 검증 — 타입·lint·lint:deps, 단위 1161, a11y 192, e2e 67, 통합 684, 회귀 27, contrast 80쌍 전량 통과. 결함 재적용 4종 전부 킬 확인

### CR-031 반영 내역 (2026-08-25)

1. **`srs_final.md` — v2.4.** FR-REL-001의 요구사항 문장을 "인접한 **항목**(PR 머지 커밋과 직접 푸시 커밋)"으로, AC-2를 유형·SHA 중심으로 정정하고 "그 항목을 빼서 서수를 건너뛰어 표시하지 않는다"를 명시. 예외 처리에 사유 분리(`not_merged`/`not_sequenced`), 관련 화면에 W-003 추가 (DEV-161·163·164). **신규 FR·NFR 없음**
2. `pr_search_api_contracts.md` — API-REL-001 재작성: 앵커 두 갈래, 커밋 행 포함, `indexed`·`url`, 에폭 봉투, 409 사유 분리, `count`가 한쪽당임을 명시
3. `pr_search_data_model.md` — 선행·후행 질의를 **멤버십(PostgreSQL) / 표시값(색인)** 으로 분리 (DEV-166)
4. `glossary.md` — "선행 PR/후행 PR" → "선행 항목/후행 항목"
5. `pr_search_product_ia.md`(원칙 4)·와이어프레임·QA 체크리스트(QA-W002-17 대상 확대, QA-W002-19 신설)·상태 매트릭스(`not_sequenced` 추가)·`pr_search_ui_component_spec.md`(C-019)·프론트 아키텍처·추적 매트릭스 (DEV-162·165·167)
6. `pr_search_work_packages.md` — WP-027 구현 범위·제외·DoD 재작성 (DoD 10항)
7. 원장 — DEV-161~167 등록·해소, WP-027 검증 기록(6.27장), FR-REL-001 매핑, 알려진 제한 두 줄 해소, 원장 v1.4
8. 구현 — `9aef48e`(API)·화면 커밋 / PR #33
9. 검증 — 타입·lint·lint:deps, 단위 1161, a11y 186, e2e 65, 통합 674, 회귀 27, contrast 80쌍 전량 통과. 변이 8종 처리

### CR-030 반영 내역 (2026-08-25)

1. `pr_search_api_contracts.md` — **API-REL-005 `GET /releases` 신설**(표 행·상세 절·stable 등재): 저장소 스코프, 현재 에폭 재조인(DEV-149), 직전은 서수 기준 + 대상 태그명 동봉, 릴리스 0건은 200 + `reason`, `limit`·`truncated`. **API-SEQ-003 재작성**: `runRange` 재사용을 명시하고 이 API가 소유하는 것을 셋(`to=unreleased`·서수 기준 방향 정규화·`size=0`)으로 좁혔다. 옛 예시의 `reverted_pull_request_count`를 걷어내고 에폭 봉투를 실었다 (DEV-155·156)
2. `pr_search_wireframe_spec.md`·`pr_search_product_ia.md`·`pr_search_screen_flow_spec.md`·`pr_search_frontend_architecture.md` — 딥링크 `/releases/[owner]/[repo]`→`/releases?repo=&branch=`, 렌더링을 "서버 셸 + 클라이언트 조회"로, W-005-LIST를 저장소 스코프로, 상태 정의·구현 메모 정정, 미배포 진입의 끝 앵커를 **서수**로 명시(새 앵커 유형을 만들지 않는다) (DEV-157·158)
3. `pr_search_screen_state_matrix.md` — `empty_no_release`와 `not_indexed`를 `release_not_indexed` 하나로 합치고 복구 경로의 이월을 적었다 (DEV-159)
4. `pr_search_ui_component_spec.md` — C-032에 저장소 스코프·서수 없는 행 렌더 규칙·서버 순서 신뢰·선택 상한 접근성, 비교 선택과 상세 선택이 다른 축임을 명시
5. `pr_search_work_packages.md` — WP-026 구현 범위·제외·DoD 재작성(QA-W005-05 절반, 도달 가능 상태 7종, 저장소 스코프 DoD 추가)
6. 원장 — DEV-155~159 등록·해소, **구현 중 DEV-160 추가 등록·해소**, WP-026 검증 기록(6.26장), FR-SEQ-004 매핑 갱신, 원장 v1.3
7. 구현 — `6461e05`(API 두 개)·`4aa2d93`(화면과 원장) / PR #32
8. 검증 — 타입·lint·lint:deps, 단위 1143, a11y 174, e2e 61, 통합 654, 회귀 27, contrast 80쌍 전량 통과. 변이 9종 전부 킬. **SRS·PRD는 건드리지 않았다** (FR-SEQ-004·FR-REL-002가 이미 부여한 범위의 계약 정정이다)

### CR-029 반영 내역 (2026-08-24)

1. `pr_search_api_contracts.md` — API-SEQ-006 `GET /sequence-spaces` 신설 (표 행·상세 절·stable 등재). 접근 범위 필터 통과, unknown 브랜치 노출 규칙 명시 (DEV-152)
2. `pr_search_product_ia.md`·`pr_search_wireframe_spec.md`·`pr_search_screen_flow_spec.md`·`pr_search_frontend_architecture.md` — 딥링크 `/range`→`/ranges`, 파라미터 `repo`·`branch`·`from`·`to`·`epoch` 통일, `space=` 제거 (DEV-153)
3. `pr_search_work_packages.md` — WP-025 구현 범위에 API-SEQ-006·전용 결과 표(DEV-154) 반영, DoD를 되돌림 분할(DEV-150)·도달 가능 상태 13종(DEV-151)으로 정정
4. 원장 — DEV-150~154 등록·해소, WP-025 검증 기록(6.25장)
5. 검증 — WP-025 시험 전 계층 통과(원장 6.25장). SRS·PRD는 건드리지 않았다 (FR-SEQ-001~003이 이미 부여한 범위의 계약 정정)

### CR-028 반영 내역 (2026-08-24)

1. `pr_search_data_model.md` — ENT-REL-001 저장 위치를 "PostgreSQL (정본) + Elasticsearch (투영)"으로 정정, 3.2에 `release` DDL(스냅숏 표·`release_seq_chk` 셋 동반 제약·부분 인덱스) 추가, 5장 `release_tags`를 **가장 이른 5개**로 명시(DEV-148)
2. `pr_search_async_events_jobs.md` — `prs:release` 스트림(그룹 `release`, 전체 기본 4), JOB-REL-007(신호·6시간 스윕·재채번 후), EVT-REL-001(**태그 이름을 싣지 않는 신호** — 순서 역전이 스냅숏을 되돌리지 못하게) 등록 (DEV-144·145)
3. `pr_search_api_contracts.md` — API-REL-002에 판정·실패 근거(정본 PostgreSQL, 200+`release_not_indexed`, DEV-146), API-SEQ-002 release 앵커 행 갱신, DEV-132 문단을 실측 결과로 정정(DEV-143·147)
4. `pr_search_work_packages.md` — WP-024 구현 범위·제외·DoD 재작성 (자가 치유 DoD, 앵커 동치 DoD, C-022 제외)
5. `pr_search_ui_component_spec.md` — C-020에 `not_sequenced` 상태와 서버 정렬 신뢰 규칙 추가
6. 원장 — DEV-142~149 등록·해소, WP-024 검증 기록(6.24장), 알려진 제한 갱신
7. 검증 — `rg` 식별자 검사 통과, WP-024 시험 전 계층 통과(6.24장). SRS·PRD는 건드리지 않았다 (범위 확장 없음 — FR-REL-002·FR-SEQ-003이 이미 부여한 범위의 계약 정정이다)

### CR-027 반영 내역 (2026-08-23)

- [x] `30_technical_architecture/pr_search_data_model.md` — 8장 질의 표의 "시퀀스 범위" 한 줄을 **두 줄로 분리**(멤버십은 PostgreSQL, 표시·요약은 Elasticsearch, DEV-130), `index.sort` 적용 범위에서 범위 조회 제외(DEV-131), 근거 문단 신설
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 10장 성능 표: 범위 질의 행을 멤버십·표시로 나누고 `index.sort`를 기본 정렬 전용으로 한정
- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-SEQ-001에 `seq_epoch` 요청 파라미터·`epoch_stale`·`items_missing_in_index`·`files_truncated_pull_request_count` 추가, `reverted_pull_request_count` 제거, `top_changed_paths` 예시를 파일 경로로 정정, **필드 근거 표 신설**. API-SEQ-002에 **앵커 유형과 판정 순서 표 신설**, 릴리스 앵커 미해석 사유 명시
- [x] `40_delivery/pr_search_work_packages.md` — WP-023 구현 범위·제외·DoD 정정, **WP-024·WP-030에 이월 항목 명시**
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-130~140 등록
- [x] `packages/db`, `packages/domain`, `packages/es`, `apps/search-api` — 구현은 WP-023 커밋 (PR #28)

**SRS는 건드리지 않았다.** FR-SEQ-002·FR-SEQ-003의 AC는 그대로다. 달라진 것은 **그것을 어디서 읽을 것인가**(DEV-130), **지금 무엇을 낼 수 없는가**(DEV-132·133), 그리고 **문서가 정하지 않고 넘어간 자리**(DEV-134~140)뿐이다. AC 하나도 축소하지 않았고, 대신 지금 충족하지 못하는 AC-1(릴리스 태그)을 WP-024로 **이월했다고 적었다** — 충족한 척하지 않는 것이 이 CR의 요점이다.

**열하나 중 하나가 나머지를 결정한다.** DEV-130을 "정본은 PostgreSQL"로 정하면 DEV-131(`index.sort` 방향)은 성능 경로에서 사라지고, DEV-140("사전 추정")은 정확한 count가 되며, DEV-139(`commit_count`의 뜻)는 `merge_sequence` 행 수라는 답이 저절로 나온다. **어디서 읽을지를 정하지 않은 채 어떻게 읽을지를 정한 것이 원래 문서의 문제였다.**

**DEV-130이 가장 조용하다.** ES `range(merge_seq)`로 읽어도 오류는 나지 않는다. 색인 반영이 실패한 만큼 항목이 빠질 뿐이고, 빠진 줄은 화면에도 응답에도 나타나지 않는다. **범위 인용이 틀렸다는 사실 자체가 관측되지 않는 것**이 이 결함의 성질이며, "Perforce Changelist를 대체한다"는 이 제품의 약속이 정확히 그 지점에서 깨진다. 그래서 정본에는 있고 색인에 없는 항목을 버리지 않고 `items_missing_in_index`로 드러낸다 — 덜 채워진 결과와 완전한 결과를 응답만 보고 가를 수 있어야 한다.

**DEV-132는 "지금 만들 수 있다"와 "지금 만들면 안 된다"가 갈리는 자리다.** 미러에 태그가 있는 저장소가 실제로 있다 — `clone --mirror`가 가져오기 때문이다. 그래서 태그 해석을 지금 구현하면 **시험도 통과하고 일부 저장소에서는 실제로 동작한다.** 그러나 이후 동기화가 `--no-tags`라 새 태그는 영영 들어오지 않으므로, 오래된 저장소에서만 맞고 새 저장소에서는 조용히 틀린다. 언제 맞는지 모르는 기능은 없는 기능보다 나쁘다.

### CR-026 반영 내역 (2026-08-23)

- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 4.3장 `reassign` 의사코드 전면 정정: 없는 함수(`invalidateSafeMarkers`) 제거, merge-base 폴백(DEV-125), 사전 `reassigning` 표시, COMMIT 뒤 후처리 분리, 표식 무효는 에폭 비교(DEV-126)
- [x] `30_technical_architecture/pr_search_data_model.md` — `safe_marker` 주석: 에폭 무효는 열이 아니라 비교다. `superseded_at`과 섞지 않는다
- [x] `40_delivery/pr_search_work_packages.md` — WP-022 DoD 7항 체크, 제외 목록(수동 API는 WP-028)
- [x] `40_delivery/pr_search_implementation_traceability.md` — **v0.9.** DEV-124~129 등록(128은 WP-028로 이월), 6.22장 검증 기록, §7 재작성 제한 해소
- [x] `packages/db`, `packages/es`, `packages/domain`, `apps/pipeline-worker` — 구현은 WP-022 커밋

**SRS는 건드리지 않았다.** FR-SEQ-005의 AC-1~AC-5는 그대로다. 여섯 중 셋이 "의사코드가 성공을 가정한 자리"였다 — 없는 함수 둘(DEV-124), 체인 밖 merge-base(DEV-125), 쓸 수단 없는 무효 표시(DEV-126). **의사코드는 실패 경로를 적지 않아서 짧다. 구현이 길어지는 자리가 바로 그 안 적힌 실패 경로다.**

**DEV-126의 결정이 이 CR에서 가장 값싸다.** "무효 표시"를 쓰기로 구현하면 표식·세션·저장된 검색 세 곳에 소급 쓰기 경로가 생기고, 그중 하나(저장된 검색)는 테이블조차 없다. 비교로 구현하면 **쓰기가 0곳**이고, 각자 저장한 에폭이 곧 판정 근거다 — AC-4 후반부가 이미 그렇게 적혀 있었다. 요구사항이 답을 품고 있는데 의사코드가 다른 길을 가리키던 경우다.

### CR-025 반영 내역 (2026-08-23)

- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 4.3장 `assignSequence`: `requeueLater` → `deferUntil`(DEV-117), `COALESCE` upsert(DEV-118), 범위 하나짜리 접근 범위(DEV-123), `markStale` upsert(DEV-122), 재작성은 감지만
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — **이벤트 카탈로그에 전송 스트림 열 신설**(DEV-121), JOB-SEQ-001 트리거 정정(DEV-116)
- [x] `30_technical_architecture/pr_search_data_model.md` — **7장 질의 표에서 `term(sequence_space)` 제거**(DEV-119). 범위는 `repository_id` + `base_branch`로 건다
- [x] `40_delivery/pr_search_release_validation_plan.md` — ACC 표에 자동화 열 신설, ACC-02를 자동화 완료로
- [x] `40_delivery/pr_search_work_packages.md` — WP-021 DoD 8항 체크, 제외 목록 신설, 검증 명령 정정
- [x] `40_delivery/pr_search_implementation_traceability.md` — **v0.8.** DEV-115~120 해소, **DEV-121~123 신규**, DEV-061 해소, §3·§4·§6.21·§7·§8
- [x] `packages/github`, `packages/domain`, `packages/es`, `packages/db`, `apps/ingest-gateway`, `apps/pipeline-worker` — 구현은 WP-021 커밋
- [x] `vitest.regression.config.ts`, `regression/`, `package.json` — 회귀 계층 신설(DEV-120)

**SRS는 건드리지 않았다.** FR-SEQ-001의 AC-1~AC-6은 그대로다. 달라진 것은 **그것을 성립시킬 수단이 없던 자리**(DEV-115 커밋 시각, DEV-116 트리거, DEV-118 PR 번호, DEV-120 회귀 명령)와 **문서끼리 어긋난 자리**(DEV-117 없는 포트, DEV-119 표시 문자열을 필터로 씀, DEV-121 전송 스트림 미정)뿐이다.

**여섯 중 둘이 "이름은 있는데 물건이 없다"였다.** `bus.requeueLater()`는 포트에 없는 메서드였고 `pnpm test:regression`은 없는 스크립트였다. 둘 다 문서가 그것을 **당연한 듯 인용**해서, 읽는 사람은 있다고 믿는다. 없는 것을 인용하는 문서는 빈칸보다 나쁘다 — 빈칸은 눈에 띄지만 이건 안 띈다.

**DEV-119가 가장 조용했다.** 데이터 모델이 범위 조회를 `term(sequence_space)`로 거르는데, 그 값은 화면에 그대로 출력되는 사람이 읽는 문자열이다. 저장소 이름이 바뀌면 같은 공간이 두 문자열로 갈라져 **범위 조회가 오류 없이 절반만** 돌려준다. 이 제품의 핵심 산출물이 틀리는데 아무 신호도 나지 않는다. 사람이 읽으라고 만든 값은 사람이 읽기 좋게 바뀌므로, 그 위에 정확성을 세울 수 없다.

**구현 중 내 결함 둘을 시험이 잡았다 (DEV-122·123).** 첫 채번 실패가 아무 신호도 남기지 않던 것과, 접근 범위 우회를 만들 뻔한 것. 후자는 허용 목록에 넣는 대신 **이 잡이 볼 수 있는 것이 저장소 하나뿐이라는 사실을 그대로 접근 범위로 적어** 예외 없이 풀었다 — 불변식에 구멍을 내지 않는 쪽이 더 짧기도 했다.

### CR-070 cascade — 삭제 실패 뒤 태그 소유를 추측하지 않는다

- [x] SRS·제품 기능·API 변경 없음. 승인된 태그 보존 규칙의 복구 안내 정정이다.
- [x] `deploy/single-host/build-bundle.sh` → `deploy/single-host/RUNBOOK.md` → 회귀 → 원장 DEV-559·6.73 갱신.
- [x] 실제 Git A→B→A 재현: 수정 전 신규 회귀 실패, 수정 후 관련 349건 통과.
- [x] strict 문서 검증은 HEAD 임시 worktree와 같은 오류 3건·경고 1건이다. 신규 issue 0건이며 기존 오류를 통과로 세지 않는다.

### CR-071 cascade — WP-042 이분 탐색 보조

- [x] 승인된 FR-SEQ-007 범위와 QA-W004-15~20을 확인하고 SRS 범위를 바꾸지 않았다.
- [x] API-SEQ-005 상세 → ENT-SEQ-004 저장 규칙 → C-029 → WP/원장 순서로 정밀화했다.
- [x] 실제 PG·Redis 통합 10, a11y 2, Chromium E2E 3과 build/type/lint를 통과했다.
- [x] migration 002의 기존 표를 재사용해 신규 migration과 안정 ID 추가가 없다.

### CR-072 cascade — WP-044 검색 결과 내보내기

- [x] FR-SRCH-012의 AC-1~5와 실패 처리를 API·데이터·비동기·W-001에 연결했다.
- [x] SRS의 `export.create` 상태와 감사 정본을 활성으로 갱신하고 추적 매트릭스·WP·원장을 맞췄다.
- [x] migration 024, API-SRCH-006, JOB-SRCH-001, 동기/비동기 UI와 접근 범위·에폭 fence를 구현했다.
- [x] ES 단위 11, 실 PG·ES·Redis 통합 6, a11y 1, Chromium E2E 3과 build/type/lint를 통과했다.
- [x] strict 문서 검증 결과는 변경 전 HEAD와 비교해 신규 issue 0건으로 판정한다.

### CR-073 cascade — 0.1.0-pilot.3 사내 업그레이드 Upstream Feedback

- [x] 사용자 전달문을 현재 정본과 대조하고 이미 사용된 DEV-559·560 대신 DEV-571·572를 배정했다.
- [x] 사내 서버 주소와 자격 값은 public origin에 기록하지 않았다.
- [x] ADR-021에 `Upstream Feedback`을 코드 역병합과 구분되는 운영 발견 전달 경로로 명시했다.
- [x] `Dockerfile` → 런북 3·5·6·7·8장 → 원장 5·6.72.8·7장 → 회귀 순서로 반영했다.
- [x] `pipeline-worker` 이미지를 실제로 빌드해 `git --version`이 `2.54.0`을 반환함을 확인하고 관련 회귀·정적 검사를 통과시켰다.
- [x] strict 문서 검증은 변경 전 `main`과 같은 기존 오류 3건·경고 1건이며 신규 issue 0건이다.

### CR-074 cascade — CR-073 회귀의 WP 추적 태그

- [x] PR #159 머지 후 리뷰를 재현 가능한 메타데이터 결함으로 판정하고 DEV-573을 등록했다.
- [x] DEV-571·572 회귀 이름에 소유 WP-072를 추가했다. 시험 행위와 제품 계약은 바꾸지 않았다.
- [x] 관련 회귀와 타입·린트를 다시 실행하고 원장 6.72.9장에 결과를 기록했다.

### CR-075 cascade — CR-074 검증 결과 원장 누락

- [x] PR #160 머지 후 리뷰를 원장 기록 누락으로 판정하고 DEV-574를 등록했다.
- [x] 원장 6.72.9장에 로컬 회귀 346건, typecheck·lint와 PR #160 verify·integration 성공을 기록했다.
- [x] 기능·시험 동작·요구사항은 바꾸지 않았다.
- [x] strict document validator는 변경 전 `main`과 같은 기존 오류 3건·경고 1건이며 신규 issue 0건이다.

### CR-076 cascade — CR-075 validator 결과 기록 누락

- [x] PR #161 머지 후 리뷰를 변경 관리 근거 누락으로 판정하고 DEV-575를 등록했다.
- [x] CR-075 cascade에 실제 strict validator 비교 결과를 추가했다.
- [x] 문서 이외의 구현·시험·요구사항은 바꾸지 않았다.
- [x] **이 CR-076 cascade 문구까지 포함한 최종 working tree**에서 strict validator를 다시 실행했다. 변경 전 `main`과 같은 기존 오류 3건·경고 1건, 신규 issue 0건이다. 결과 기록 자체가 만드는 재귀를 피하기 위해 새 CR을 만들지 않고 CR-076의 종료 근거를 이 행으로 완성한다.

### CR-077 cascade — M 넘버

- [x] 2026-09-10 P4 회고 회의 결정을 분석하고 기존 설계와 대조했다. 회의가 요구한 네 성질(직접 푸시 제외·저장소별 번호·1부터 조밀·commit/PR/번호 묶음)이 `merge_sequence` 표에서 그대로 파생됨을 확인했다.
- [x] CR-077을 등록했다. M 넘버의 정본을 `merge_seq` 파생으로 정하고, `merged_at` 순서와의 불일치를 감시 지표로 남기기로 했다.
- [x] `srs_final.md` **v2.22** — `FR-SEQ-008`(채번)·`FR-SEQ-009`(표기) 신설, 2장 통합 결론과 Plane 표의 읽기 전용 서술 정정, `OD-009` 등록과 종료, 감사 액션 정본 표에 `pull_request.annotate` 추가.
- [x] `prd.md` v1.10 · `glossary.md` v0.8 · `requirements_screen_traceability_matrix.md` v1.5 — 「M 넘버」 용어 신설(정본 필드명 `merge_number`), 읽기 전용 예외 반영, FR 2종 매핑과 커버리지 갱신.
- [x] 파생 UI 7종 — `product_ia`·`wireframe_spec`·`ui_component_spec`(C-014 확장, 새 컴포넌트 ID 없음)·`screen_state_matrix`(`merge_number_pending` 추가, 에폭 무효는 기존 `epoch_stale` 공유)·`screen_qa_checklist`, 그리고 에이전트 브리프 2종에 M 넘버 실행 규칙 절을 추가했다.
- [x] 아키텍처 5종 — ADR-007에 **Clarification**(M 넘버는 이 서수의 파생이지 두 번째 시퀀스가 아니다), **ADR-022**(자동 GHE 쓰기 경로와 제약 다섯), 데이터 모델(마이그레이션 025, `merge_number`·`annotate_state`, 채번 멈춤 규칙), 잡·이벤트(`JOB-SEQ-004`·`JOB-SEQ-005`·`EVT-SEQ-004`), API 계약(`API-SEQ-007`), 보안(13장 신설, `THR-046`·`THR-047`).
- [x] 딜리버리 4종 — 작업 패키지에 **`WP-074`(다음 착수)·`WP-075`**, 로드맵 4.2장(`DEV-576` 해소 → WP-074 → WP-075), 검증 계획에 M 넘버 검증 4항목, 구현 원장에 두 WP 행과 **`DEV-576`** 등록.
- [x] **검증 (문서 링크 기반, CLAUDE.md 6장).** 신규 ID 15종이 전부 등록되어 상호 참조된다. 새 서술에 `TODO`·`TBD`·`결정 필요` 0건이며, 신규 표 행의 칸 수가 기존 행과 일치한다. 안정 ID 재번호화 0건.
- [x] **캐스케이드 중 잡은 오류 3건.** ① `FR-SEQ-008`의 관련 화면에 적힌 `D-002`가 존재하지 않는 ID였다 — `product_ia.md`가 `D-###` 접두를 쓰지 않는다고 명시하며 PR 상세는 `W-002`다. 추적 매트릭스의 "모든 화면 ID는 IA 또는 wireframe에 존재해야 한다"는 검증 규칙이 잡아냈다. ② 용어집과 API 계약이 필드명을 `m_number`로 쓰기 시작했으나 데이터 모델의 `merge_number`로 통일했다. ③ 작업 패키지의 REL 귀속 표기가 로드맵·원장과 어긋나 `REL-003 (CR-077)`로 맞췄다.
- [x] **오픈 결정 정리 (2026-09-11, 사용자 결정).** 캐스케이드가 연 결정 셋 중 하나만 남기고 둘을 범위에서 뺐다. **`OD-009`(저장소 코드 출처)는 닫았다** — `M-1900-1`의 `1900`은 저장소 이름의 숫자 부분이고 뒤의 정수는 그 공간에서의 머지 순서다. **PIPE DB 반영은 이번에 고려하지 않는다**(대상 시스템의 계약이 없고, 필요해지면 그때 CR로 연다). **PR 본문 표기는 별도 애플리케이션에서 다룬다.** 둘은 오픈 결정으로 남기지 않고 각 문서의 제외 항목으로 적었다 — 결정할 사람이 없는 질문을 대장에 두면 그것이 미결로 세어진다.
- [x] **머지 방식 판정 규칙을 `WP-074`에 명시했다.** rebase merge는 base에 커밋 N개를 넣고 PR의 `merge_commit_sha`는 그중 하나만 가리키므로, 나머지가 직접 푸시로 오판되면 AC-3의 멈춤 규칙이 잘못된 자리에서 작동한다. 구현 범위와 DoD에 세 방식(merge commit·squash·rebase) 전부를 요구했다.
- [x] **CR 종료.** 문서 캐스케이드와 오픈 결정 정리를 마쳤다. 구현은 `WP-074`·`WP-075`가 가져가며, 착수를 막는 유일한 조건은 `DEV-576`이다.

**선행 조건.** `DEV-576`(push 웹훅이 미러 fetch를 부르지 않는다)이 미해결이며, 그 상태에서는 회의가 요구한 "거의 실시간"이 성립하지 않는다. 이 판정은 **코드 경로 확인에 근거하며 운영 환경 실측은 아직 하지 않았다.**
### CR-078 cascade — 운영 구성이 기동을 막지 못했다

- [x] 사내 Upstream Feedback을 비식별 사실로 옮기고 `0.1.0-pilot.3` 릴리스 산출물(로컬 이미지 ID가 릴리스 manifest와 일치)에서 증상을 재현했다. `SESSION_COOKIE_SECURE=false`에서 `/healthz`만 200이고 SSR 전부 500임을 요청 단위로 확인했다.
- [x] 경쟁 가설 넷(실제 `pg` 부재 · `pg-<해시>` 재발 · stale 이미지 · 쿠키 구성)을 실험으로 각각 판정했다. 실제 `pg`를 배포 트리에서 지워도 SSR은 200이고, `pg-<해시>` 스텁은 그대로 있으며 필요했고, 사내가 제시한 `npm install pg`는 그 이미지에서 실행 자체가 불가능하다.
- [x] DEV-577(기동을 막는다고 적힌 계약이 요청마다 막았다)과 DEV-578(`IDP_GROUP_ROLE_MAP` 이름 불일치, 관측만)을 등록했다.
- [x] `apps/web/instrumentation.ts`를 세워 기동 시점에 구성을 편다. 실패하면 이유를 적고 프로세스를 종료한다 — `throw`로는 막히지 않음을 Next 16.3.1에서 실측했다.
- [x] `/healthz`가 같은 판정을 읽어 실패를 503으로 낸다. 판정 문구는 로그로만 보낸다 (NFR-005).
- [x] `deploy/single-host/.env.example`과 `deploy/single-host/RUNBOOK.md`가 코드 계약과 같은 말을 하게 고쳤다. 운영자를 거부당하는 값으로 보내던 두 자리를 정정하고 증상 행 둘을 더했다.
- [x] 사내 `prsctl smoke`가 `web`의 진입 화면을 실제로 요청하게 했다. 그 명령은 `web`에 대해 `/healthz`만 보고 있었고, 사내가 쓴 구성에서 그것은 200이었다 — 화면은 500인데.
- [x] `deploy/single-host/smoke-images.sh`를 세우고 `build-bundle.sh`가 `docker save` 뒤·운반 아카이브 앞에서 부르게 했다. tar에서 다시 적재한 이미지로 SSR 10종·해시 외부 모듈 해석·거부 계약·worker `git`을 실제로 검사한다.
- [x] 회귀 11건과 단위 27건을 더했다. 판정 자체는 실행으로 잰다 — 적대적 검토가 문자열 검사를 통과하는 변이 다섯을 찾아 그 시험들을 고쳤다. 변이 28종이 전부 죽는다.
- [x] **보안 계약(`packages/authz/src/config.ts`)은 바꾸지 않았다.** 운영에서 insecure 세션 쿠키를 금지하는 판정은 그대로다.
- [x] 고친 이미지로 구성 행렬을 다시 재다가 같은 유형의 결함을 하나 더 찾아 DEV-579로 등록하고 함께 닫았다 — `OIDC_REDIRECT_URI`가 계약에만 있고 배포 정의에 없어, `AUTH_ENABLED=true`로 올리면 모든 로그인이 500이 될 상태였다. 키를 `compose.yml`·`.env.example`에 더하고 기동 검증이 로그인 라우트와 같은 함수로 인증 구성을 편다.
- [x] 전체 검사와 strict document validator 결과를 원장 6.72.11장에 기록했다. validator는 변경 전 `main`과 같은 기존 오류 4건·경고 1건이며 신규 issue 0건이다.


### CR-079 cascade — WP-074 squash-only 설계 전용

첨부 구현 지시서보다 이번 세션의 **설계만 작성** 지시를 우선 적용했다. 시작/원격 재확인 HEAD는 f53d28c4e3fc7e0a4b5ac189da571df05df1741f, pilot.4는 a198e12915e6795dc44e1a947073b683e9e5e47b다. 별도 브랜치 docs/wp074-squash-design에 문서만 변경했다.

- SRS v2.23: 사용자 승인 보완 AC-9~14. squash-only, 영속 근거, 지연 재개, 인용 code/epoch, W-004, 읽기 전용 측정.
- PRD·glossary·traceability: M 의미와 확정 분류, API 인용, 세 화면 및 비UI 측정 연결. OD-009의 개명 설명은 임의 코드 허용으로 해석하지 않도록 정정.
- UI 8종: 기존 렌더 경로·상태·제한 재검증·링크 문맥·QA와 후속 브리프. tokens는 시각 정책 변경이 없어 무변경으로 검토.
- 아키텍처 10종 + 신규 상세 설계: API-SEQ-007 배포 전 정정, 증거/work/sample ENT-SEQ-005~007, ADR-023(proposed), freshness 락·원자성·복구·숫자 경계·rollback·계측. 기존 SERVICE_UNAVAILABLE 코드가 있다는 잘못된 가정은 실제 error-codes.ts와 대조하여 제거했다.
- 전달 문서 4종 + 신규 실행서·측정 가이드: WP-074 todo 유지, S0~S6/T01~T06, 독립 fixture/변이/실제 이미지/사내 측정 구분. WP-075 실행과 immutable 발행은 제외.
- DEV-580·582·583은 문서/설계 공백 정정으로 resolved이며 구현 완료를 의미하지 않는다. DEV-576은 open. DEV-581은 production 직접 부재 확정 근거 미확보로 open이다. 반복 빈 응답으로 가용성을 보장하지 않고 pending으로 남기는 설계가 뒤 PR 전체를 막을 수 있음을 명시했다.
- 공개 GitHub REST 공식 문서 3종과 실제 source를 검토했다. 사내 GHES·IdP·DB에는 접속하지 않았다. source 조사와 실제 실행 시험을 구분해 기록했다.

검사기: `/home/roqkf/.codex/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py`, SHA-256 `1004095624fed9bae7a8ada7a2bbe0f4c6586dbcdf20db61b07b3b8045ca7cb2`. 별도 version 옵션을 추정하지 않고 파일 hash로 식별한다. 시작과 변경 후 `--report`는 Phase 6·오류 2/경고 1, `--strict`는 exit 1·오류 4/경고 1이며 **새 issue 0**이다. 기존 FR-CSS-005 외부 요구사항 인용, D-002 과거 정정 이력, 원장 risks.md 상대 참조와 두 원장의 placeholder 검출이다. 무관한 역사 문서를 덮어써 strict를 초록으로 만들지 않았다.

수동/구조 검사: 신규 설계 3문서, WP-074 연결 28개, JSON 예제 5개, 신규 표 행 118개 확인. 임시 문서 검사 스크립트(`/tmp/wp074-document-check.mjs`)의 오류 0; 검사 범위는 링크·fence·table·JSON·API epoch 키·old unsafe rule 잔존·WP todo·DEV 등록이다. 실제 동작 검증이나 독립 에이전트 리뷰가 아니다. 최종 문서 기록 후 같은 검사기를 다시 실행한다.

판정: **계약 정정과 설계 문서 작성은 완료**, 전체 strict handoff 게이트는 미통과, 직접 부재 증거의 구현 가용성 조건은 잔존한다. 그래서 CR은 review, ADR-023은 proposed이며 완료된 개발/출시 승인으로 읽지 않는다. 앱 코드·SQL migration·측정 도구 구현·애플리케이션 시험·build·PR/CI/병합·후보 번들·새 릴리스 발행은 이번 세션에서 전부 NOT RUN이다. Agent-Initiated Decisions는 상세 설계 12절이 정본이다.

### CR-081 cascade — 병합 후 리뷰 결함

시작 `main`은 `4466fa1`(CR-080 병합)이고 브랜치는 `fix/wp074-review-followup`·`docs/wp074-bundle-record`·`fix/wp074-numbered-row-and-cascade`다. **SRS·PRD·용어집·추적 매트릭스·파생 UI·아키텍처 문서는 바꾸지 않았다** — 계약 변경이 없고 `CR-080`이 세운 것의 결함을 고쳤을 뿐이다. 따라서 갱신 연쇄의 2~7단계는 해당 사항이 없다.

- 8단계(delivery): 구현 원장에 `DEV-609`~`DEV-611`을 등록하고 6.76장에 병합 후 리뷰와 번들 기록을 더했다. 작업 패키지 표의 `WP-074` 행은 이미 `done`이라 바뀌지 않는다.
- 9단계(에이전트 브리핑): 해당 없음 — 새 지시서를 만들지 않았다.
- 코드: `usePendingRevalidation`(소진 표시), `mnumber.ts`의 관측 루프(배치 조회·번호 있는 행 우선), 그 셋을 거는 시험.

**무엇을 고쳤는가.** 병합 후 자동 리뷰가 P2 다섯을 남겼고 셋은 `CR-080`이 이미 닫은 것이었다. 남은 둘이 실결함이고(`DEV-609`·`DEV-610`), 그 중 하나를 고치며 새로 만든 것이 하나 더 있다(`DEV-611`) — 관측 루프의 배치 조회가 같은 PR의 두 행 중 나중 것으로 덮어, `DEV-601`에서 API 쪽에 세운 규칙을 워커 쪽에 다시 어겼다. **같은 정본을 읽는 두 곳이 다른 행을 고르면 안 된다.**

**문서 검사기 결과.** `python3 <skill-dir>/scripts/validate_srs_prd_env.py --root <tree> --strict`를 이 브랜치와 `CR-080` 병합 시점(`4466fa1`)에서 각각 실행해 대조했다. 검사기 SHA-256은 `1004095624fed9bae7a8ada7a2bbe0f4c6586dbcdf20db61b07b3b8045ca7cb2`다. **양쪽 모두 오류 4건·경고 1건으로 같으며 신규 issue 0건이다** — 정의되지 않은 요구사항 ID `FR-CSS-005` 참조, 정의되지 않은 화면 ID `D-002` 참조, `risks.md` 경로 미해소, 그리고 변경 관리·구현 원장의 placeholder 집계 둘이며 전부 이 CR 이전부터 있다.

**검증.** 타입·린트·의존 방향 통과, 단위 2099 · 회귀 422 · 통합 1601 이상 · 접근성 379 통과. 세 결함 모두 되돌리는 변이를 적용해 새 시험이 잡는 것을 확인했다.

### CR-080 cascade — WP-074 구현

시작 `origin/main`은 `c1246c5c8989b128efba16c153bc6d29b9722b21`, 브랜치는 `feature/wp074-squash-mnumber`다. **SRS·파생 UI·아키텍처 문서는 바꾸지 않았다** — CR-079가 이미 계약을 확정했고 이 판은 그것을 구현했다. 구현이 계약과 어긋난 자리는 하나였고(`DEV-589`) 그것은 구성을 코드에 맞춰 닫았다. 판단이 필요했던 나머지는 `DEV-584`~`DEV-588`·`DEV-590`으로 원장에 있다.

- 마이그레이션 025: `merge_sequence`에 번호·표기 예약·M 부여 시각, `sequence_space`에 checkpoint·blocker, 신규 표 셋(`mnumber_evidence`·`sequence_work`·`sequence_latency_sample`). additive이며 기존 행은 `NULL`로 시작한다. 권한은 022의 규율대로 같은 마이그레이션이 준다.
- 채번 전 미러 fetch (`DEV-576` 폐쇄): 수신이 원본과 **같은 트랜잭션**에 refresh 의도를 남기고, `prepareAndAssignSequence`가 미러 세션 락 아래에서 fetch → 채번 순서를 보장한다. 버스·수동·durable 세 경로가 같은 문을 쓴다. **수정 전 재현**(옛 head를 읽고 "새 커밋 없음"으로 정상 종료)을 시험이 먼저 만든 뒤 수정 후를 대조한다.
- 근거·채번: production은 `direct_confirmed`를 만들지 않는다(`DEV-581`). 번호·checkpoint·전달 의도는 한 트랜잭션이고 외부 I/O는 그 밖이다. 순수 planner가 순서·멈춤·충돌·`merged_at` 대조를 판정한다.
- 색인·API·화면: M 필드는 전용 소유자만 쓰고 투영이 덮지 않는다. 목록·상세·범위는 페이지의 PR 튜플을 **1회 batch**로 정본과 대조하며 행별 조회가 없다. `MNUMBER_ENABLED`가 꺼진 배포에서는 M 키가 생기지 않아 기존 응답 모양 그대로다.
- 측정: `node dist/measure-cli.js`가 읽기 전용으로 돌고 비밀을 출력하지 않는다. 런북 7.A가 사내 절차다.
- 문서 검사기는 `/home/roqkf/.claude/skills/build-srs-prd-env/scripts/validate_srs_prd_env.py` (SHA-256 `1004095624fed9bae7a8ada7a2bbe0f4c6586dbcdf20db61b07b3b8045ca7cb2`)다. 결과는 원장 6.76장에 기록한다.

**자발적 결정 (ADR-023의 `C1`~`C6`을 잇는다).** 설계가 정하지 않은 자리에서 구현이 고른 것이며, 뒤집으려면 그 근거를 먼저 읽는다.

| 결정 | 왜 그렇게 했는가 | 무엇을 포기했는가 | 뒤집는 조건 |
| --- | --- | --- | --- |
| C7: GHE 자격이 없는 배포에서는 **검증된 스냅숏만** 근거로 쓴다 | 자격 없이도 채번이 서야 하는 형상(`AUTH_ENABLED=false` 반입)이 실재한다. 스냅숏의 state·머지 SHA·base·저장소가 **전부** 정본과 일치할 때만 확정한다 | 스냅숏이 낡았으면 확정이 늦어진다 — 그 경우 `pr_evidence_pending`으로 남는다 | 사내에 GitHub App 자격이 서면 `pr_detail`이 우선이며 이 경로는 대비책으로 남는다 |
| C8: `SearchApiConfig.mergeNumberEnabled`를 **선택 속성**으로 둔다 (`DEV-586`) | 키의 부재가 곧 "꺼짐"이고 그것이 기존 응답 계약과 같다. 필수로 만들면 M과 무관한 시험 34개가 값을 적어야 한다 | `searchCursorKey`처럼 빠졌을 때 기동을 막는 방식을 쓰지 않는다 | 꺼진 상태가 안전하지 않은 기능이 생기면 그 기능은 필수 키로 간다 |
| C9: 화면은 기능 플래그를 **읽지 않는다** (`DEV-589`) | 켜고 끄는 자리가 둘이면 한쪽만 바꾼 형상이 "켰는데 안 보인다"로 나타나고, 화면 로그로는 그것을 구분할 수 없다. 응답에 M 키가 있는지가 곧 답이다 | 설계 9절이 화면에도 공개 boolean을 주라고 적은 것과 다르다. 구성·런북을 코드에 맞췄다 | 응답과 무관하게 화면이 먼저 알아야 할 것이 생기면 그때 다시 본다 |
| C10: 실행서가 지정한 시험 파일 이름 둘을 **한 파일로 모은다** | `mnumber-evidence`·`mnumber-resume`이 같은 squash 픽스처를 쓴다. 파일이 갈리면 픽스처를 두 번 만들어 실행이 두 배로 느려진다 | 파일 이름만 보고 어느 T 항목인지 알 수 없다 — 원장 6.76장의 표가 그 대응을 적는다 | 한 파일이 너무 커져 읽기 어려워지면 픽스처를 공유하는 방식으로 나눈다 |

- 변이 시험 10종을 실행서 5.1의 목록대로 돌렸고 **전부 kill됐다**. 셋은 처음에 대상 시험이 없었거나(M6·M10) 실제로 살아남아(M9) 시험을 먼저 채운 뒤 닫았다 — 그 과정과 근거는 원장 6.76장에 있다.
- **CI가 외부 전량 실행이 놓친 것을 잡았다**(`DEV-590`). 새 증거 표의 `ON DELETE RESTRICT`가 기존 통합 시험의 정리를 막는다. 제약은 풀지 않고 지우는 순서를 공유 헬퍼로 모았다.
- **독립 리뷰가 blocker 1건과 major 4건을 찾았고 전부 고쳤다**(`DEV-591`~`DEV-598`). 재채번 중 공간에서 러너가 지연 0으로 무한 재시도한 것(실행으로 재현), 해석·목록이 단일 read 스냅숏이 아니어서 한 응답이 두 세대를 섞을 수 있던 것, `branch_not_tracked`를 DTO가 한 번도 만들지 않은 것, 표본이 두 행으로 갈려 정상 채번에서도 영구 대기가 쌓인 것, 재색인 뒤 M 복구 경로가 없던 것이다. 넷은 **시험이 전부 초록인 채로** 존재했다.
- 리뷰가 `DEV-590`의 재현 조건 기술 오류도 잡았다 — 통합 시험은 순차 실행이므로 병렬 경합이 아니라 앞선 파일의 잔여 상태다. 원장 문구를 고쳤다.
- `T04a`(번호·checkpoint·전달 의도의 원자성)에 시험이 없어 커밋 직전 예외 주입으로 채웠다. `T04b`는 부분이고 **`T06b`(실제 이미지)는 `NOT RUN`**이며, 그 대응은 원장 6.76장의 표에 있다.
- 검증 중 인접 시험 하나가 전량 실행 3회 중 1회에서 깨졌다. 이 판의 변경과 무관한 경합이며 `DEV-588`로 등록하고 고치지 않았다 — `FR-ADMIN-002`를 소유한 WP의 판단이다.

**사내 재시험과 새 릴리스는 이 판의 완료에 포함하지 않는다.** `0.1.0-pilot.4` 태그·자산은 건드리지 않았고 `--release`를 쓰지 않았다.

## 6. 미결 항목

CR-004 종료 시점의 미결 항목이다. 각각 별도 CR로 처리한다. 취소선 항목은 해소된 이력이다.

| 항목 | 유형 | 차단 대상 | 담당 |
| --- | --- | --- | --- |
| ~~`srs_final.md` `baseline` 승인~~ | ~~사용자 결정~~ | 해소 (2026-08-19, CR-003) | 사용자 |
| ~~OD-003 원본 이벤트 보존 기간~~ | ~~오픈 결정~~ | 해소 (2026-08-19, CR-004 — 3년 보존, `raw_event` 계획 용량 4TB) | 사용자 |
| ~~OD-006 ES 클러스터 형태~~ | ~~오픈 결정~~ | 해소 (2026-08-19, CR-004 — 전용 클러스터 3노드 / 컨테이너 3개 / 복제본 1) | 사용자 |
| ~~OD-007 저장소·PR 규모~~ | ~~오픈 결정~~ | 해소 (2026-08-19, CR-004 — 워크로드 기준선 1,000 PR/일) | 사용자 |
| ~~OD-001 미러 클론 허용~~ | ~~오픈 결정~~ | 해소 (2026-08-22, CR-024 — 허용. blob 지연 인출은 기본 차단) | 사용자 위임 |
| ~~OD-002 권한 판정 소스~~ | ~~오픈 결정~~ | 해소 (2026-08-22, CR-024 — GHE 협업자/팀 API. 1,000 저장소 초과 시 재검토 CR) | 사용자 위임 |
| ~~OD-004 릴리스 앵커 소스~~ | ~~오픈 결정~~ | 해소 (2026-08-22, CR-024 — Git 태그와 GitHub Release만) | 사용자 위임 |
| ~~OD-005 nori 플러그인~~ | ~~오픈 결정~~ | 해소 (2026-08-26, CR-040 — **초기 REL-004 의존성으로 채택하지 않는다.** WP-032는 `standard` + `edge_ngram` 대체 경로로 구현. 재검토 조건 셋을 충족하면 별도 CR) | 사용자 위임 |
| ~~OD-008 안전 구간 표식 권한 범위~~ | ~~오픈 결정~~ | 해소 (2026-08-31, CR-057 — **`release_manager` 전용.** 쓰기만 그 역할을 요구하며 읽기는 접근 범위 안의 인증 사용자 전부다). **이로써 open 오픈 결정은 하나도 남지 않았다** | 사용자 위임 |

### CR-067 cascade — P4 방식 웹 조사 작업대

- [x] 기존 승인 FR-SRCH-001·006~011, FR-SEQ-001·005, NFR-007의 표현 개선임을 확인. SRS baseline·요구사항·인가·API/데이터 계약 변경 없음.
- [x] 파생 UI: IA → wireframe → flow/state → component → tokens → QA 순서로 작업대 배치/선택/키보드/반응형/대비를 정밀화.
- [x] FE 아키텍처: URL/요청 상태와 선택 요약 상태 경계 기록. 다른 기술 계층 변경 없음.
- [x] 전달: WP-073 네 slice/DoD, 릴리스 검증 계획, 구현 원장 3장·DEV-554·6.71장 갱신.
- [x] 실행 브리프 둘: Conductor/인가/커서/에폭 보존과 검증 범위 반영.
- [x] 최종 프로덕션 e2e 169, a11y 358, 대비 232쌍, 타입/린트/의존 경계/build 통과. 기존 DEV-377은 main에서도 재현했고 열림 상태 유지.
- [x] strict 문서 검증의 기존 오류 3·경고 1은 main과 동일. 신규 issue 0을 종료 근거로 기록하며 기존 오류를 숨기지 않는다.

### CR-082 cascade — 사내 CA가 git에도 닿게 한다

시작 `origin/main`은 `e01bce115a84ccf4df535a76b79799254b72390e`, 브랜치는 `fix/dev-561-git-ca-trust`다. **`srs_final.md`를 바꾸지 않는다** — 이 판은 승인된 계약이 배포에서 이행되지 않던 것을 고치며 계약 자체는 그대로다. 그래서 캐스케이드가 요구사항·파생 UI·아키텍처에 닿지 않는다.

- [x] 배포 정의: `deploy/single-host/compose.yml`의 `x-app-env` 앵커에 `GIT_SSL_CAINFO`를 더했다. 그 앵커를 `reindex`·`web`·`search-api`·`ingest-gateway`와 워커 아홉이 병합하므로 `git`을 부르는 `worker-mirror`·`worker-sequence`·`worker-release` 셋에 한 자리로 닿는다.
- [x] `deploy/single-host/.env.example`: `NODE_EXTRA_CA_CERTS` 바로 아래에 항목을 두고 **같은 값**을 적으라고 명시했다. 비웠을 때의 증상(미러만 실패하고 나머지는 정상으로 보임)을 함께 적었다. 바로 아래 프록시 절이 **방향이 반대인 같은 종류의 비대칭**이라는 것도 연결해 두었다 — 프록시는 `git`이 받고 Node가 못 받는다.
- [x] 런북 6장: 사설 CA 절차를 3단계에서 4단계로 늘리고, 두 변수에 다른 값을 주지 않는다는 규칙을 적었다. 8장 문제 해결 표에 「`JOB-MIR-001`이 SSL 오류로 실패하고 미러 볼륨이 비어 있다」 증상 행을 더했다.
- [x] 회귀: `regression/runtime-reachability.test.ts`에 `describe('사설 CA가 git 서브프로세스에도 닿는다')`. 문자열 존재가 아니라 **서비스별 최종 환경 키 집합**을 계산해 묻는다. 앵커에 키를 넣는 것과 그 키가 서비스에 닿는 것은 다른 명제이고, `DEV-552`가 볼륨에서 이미 그것을 가르쳤다.
- [x] 구현 원장: `DEV-561`을 5장에 `resolved`로 등록하고 검증 결과를 6.77장에 적었다. 버전 `v6.65`.

**변이로 확인했다.** 네 변이가 전부 시험을 죽였다 — 앵커에서 변수 제거(2건 실패), 앵커에서 빼고 `worker-mirror` 한 곳에만 두기(2건 실패), `.env.example` 항목 제거(1건), 런북 증상 행 제거(1건). 두 번째가 이 시험의 값이다: 파일 어딘가에 문자열이 있는지 묻는 검사라면 그 변이를 통과시킨다.

**파서를 먼저 검증 대상으로 두었고 그것이 값을 했다.** 첫 구현의 파서가 앵커 블록을 닫으면서 `services:` 줄을 함께 버려 서비스를 하나도 읽지 못했는데, 파서 검증 시험이 그것을 잡았다. 그 상태로 두었다면 나머지 단언이 빈 집합 위에서 전부 통과했을 것이다 — 앞 라운드가 「검증 도구 자체가 검증 대상이다」로 네 번 겪은 모양이다.

**사내 적용은 `NOT RUN`이다.** 배포 정의와 문서를 고쳤을 뿐이고, 실제 사내 호스트에서 미러 초기화가 성립하는지는 다음 반입이 확인한다.

### CR-083 cascade — 사내 GHE 직접 로그인

시작 `origin/main`은 `a3cb046`, 브랜치는 `feature/ghe-oauth-login`이다. **`srs_final.md`가 baseline이므로 이 CR을 먼저 등록하고 요구사항을 고쳤다.**

- [x] 요구사항: `FR-AUTH-001`의 요구사항 문장을 「사내 OIDC 제공자」에서 「구성된 인증 공급자」로 넓히고 `AC-6`~`AC-9`를 더했다. `AC-2`에 면제 조건을 명시했다. 10장 외부 인터페이스 표에 GHE OAuth2 행을 더했다. **신규 FR을 만들지 않았다** — 요구사항 문장("인증 위임 후에만 세션 발급")이 그대로이고 공급자만 늘어난다. 새 FR로 쪼개면 같은 AC가 두 벌이 되고 둘이 갈린다.
- [x] 코드: `packages/authz/src/github-oauth.ts`(신규)가 인가 URL·코드 교환·신원 조회를 맡고 `pkce.ts`를 공유한다. GHE는 `code_challenge_method=S256`을 받으므로 PKCE를 공급자마다 새로 쓰지 않았다(공식 문서 확인).
- [x] 라우트: `login`·`callback`이 `AUTH_PROVIDER`로 갈린다. **갈리는 자리는 신원을 얻는 단계뿐이고** 왕복 상태·`state` 비교·경로 정화·세션 발급·쿠키는 공유한다 — 갈래마다 따로 쓰면 한쪽에만 고쳐지는 보안 처리가 생긴다.
- [x] 기동 검증: `webConfigFailure`가 공급자별 필수 키를 본다. 키 목록을 옮겨 적지 않고 **로그인 라우트가 실제로 부르는 함수를 그대로 부른다**는 `CR-078`의 규칙을 이어받았다.
- [x] `DEV-613`: `RegisteringSessionStore`가 세션을 읽을 때 `app_user`를 upsert한다. `web`은 `@prs/db`에 의존하지 않으므로 콜백에서 직접 만들 수 없고, 그 경계를 여는 대가가 이 결함을 고치는 값보다 크다. `authenticateSession` 호출부가 서른 곳이 넘어 거기에 끼우면 빠뜨린 경로만 503이 되므로 **저장소를 감쌌다**.
- [x] `DEV-612`: `.env.example`의 그룹 매핑 안내가 파서와 어긋났다(`그룹=역할`로 적혀 있으나 실제는 `group:role`, 「여섯 중 하나」로 적혀 있으나 실제 부여 가능은 둘). 문서가 운영자를 거부당하는 값으로 보내던 자리다.
- [x] 배포 정의: `compose.yml`의 `web`에 `AUTH_PROVIDER`·`GHE_BASE_URL`·`GHE_API_URL`·OAuth 자격 셋·`GHE_OAUTH_SCOPES`·`GHE_TEAM_ROLE_MAP`을 더했다. **회귀가 이것을 자동으로 요구했다** — `CR-078`이 만든 검사가 `config.ts`의 `required()` 호출을 소스로 읽어 `web` 블록과 `.env.example`에 그 키가 있는지 본다.
- [x] 런북 6장에 설정 절차와 역할 매핑·스코프·TLS 제약을, 8장에 증상 셋을 더했다.
- [x] 구현 원장: `DEV-612`·`DEV-613`을 5장에, 검증 결과를 6.78장에 적었다.

**사내 제안을 그대로 구현하지 않은 자리 둘.** 둘 다 승인된 계약을 지키기 위해서다.

| 사내 제안 | 실제 | 왜 |
| --- | --- | --- |
| `GHE_TEAM_ROLE_MAP=<org>/<team>=admin` | `<org>/<team>:manager` | `admin`·`viewer`는 이 제품의 역할이 아니다. 역할 여섯은 `developer`·`release_manager`·`manager`·`qa`·`operator`·`security_officer`이고 팀으로 부여할 수 있는 것은 `manager`·`qa` 둘이다. 구분자도 IdP 그룹 매핑과 같은 콜론을 쓴다 — 같은 개념에 두 형식을 두지 않는다 |
| `SESSION_COOKIE_SECURE=false`를 파일럿에서 허용 | `AUTH_ENABLED=false`를 명시한 배포만 면제 | 사용자 결정. **이 완화는 사내 요청의 절반이다** — GHE 로그인을 실제로 시험하려면 인증을 켜야 하고 켜면 TLS가 필요하다. 런북이 그 사실을 적는다 |

**후속(`DEV-615`): 계약을 강제하는 자리 하나를 놓쳤다.** 릴리스 산출물 게이트(`smoke-images.sh`)가 옛 기대를 들고 있어 번들 빌드가 「이 번들을 반입하지 않는다」로 멈췄고 `0.1.0-pilot.5`가 나가지 못했다. 게이트가 옳았고 계약이 바뀐 것을 게이트가 몰랐을 뿐이다. 그 시점에 회귀는 초록이었다 — 검사의 **존재**를 문자열로만 보았기 때문이다. 게이트의 기대를 실제 계약 함수에 넣어 대조하는 시험을 세우고, **허용해야 할 형상이 실제로 서는지**도 게이트가 묻게 했다. 한 방향만 거는 게이트는 계약이 넓어질 때 반대 방향으로 거짓말한다. 판정은 6.79장이다.

**독립 검토 두 판에서 blocker 1건과 major 3건을 닫았다.** blocker는 `DEV-614` — 세션 쿠키가 응답에서 유실되어 **로그인에 성공해도 브라우저가 세션을 받지 못했다.** `CR-083` 이전부터 있었고 OIDC 경로도 같았으며, 콜백에 라우트 시험이 없어 드러나지 않았다. 검토가 그 공백을 지적해 시험을 세우자 첫 실행에서 잡혔다. 판정과 근거는 6.78장에 있다.

**검증.** 타입·린트·의존 방향 통과. 단위·회귀·통합·접근성·e2e 수치는 6.78장이 정본이다. 변이 시험을 여섯 곳에 돌렸다 — 스물하나가 전부 kill됐다. 문서 검사기는 `main` 대비 신규 issue 0건이다.

**사내 적용은 `NOT RUN`이다.** 실제 GHE OAuth App으로 로그인이 성립하는지는 다음 반입이 확인한다. 외부에서는 실제 GHE 없이 대역으로만 검증했으며, 그 사실을 6.78장이 표로 가른다.

### CR-084 cascade — PR 제목 M 넘버 표기 (WP-075)

시작 `origin/main`은 `8237ff5`, 브랜치는 `feature/wp075-pr-title-annotate`다. **`srs_final.md`가 baseline이지만 이 판은 요구사항 문장을 바꾸지 않는다** — `CR-077`이 `FR-SEQ-009`를 이미 승인했고 이 CR은 그것을 구현한다. SRS에서 바뀌는 것은 감사 액션 표의 **상태 칸 하나**(미활성 → 활성)뿐이다.

- [x] 요구사항: `srs_final.md` 10.2절 감사 대상 액션 표에서 `pull_request.annotate`를 **활성**으로 옮겼다. 신규 FR·NFR 없음, 안정 ID 재번호화 0건. `prd.md`·`feature.md`·`glossary.md`·요구사항-화면 매트릭스는 `CR-077`이 이미 이 기능을 반영했으므로 바꿀 것이 없다 — **바꿀 것이 없다는 사실을 확인한 뒤 적는다.**
- [x] 도메인 어휘: `ACTIVE_AUDIT_ACTIONS`에 `pull_request.annotate`를 더하고 시스템 주체 `ANNOTATE_PRINCIPAL`(`system:annotate`)을 뒀다. `system:` 접두는 `system:sequence`·`system:audit-retention`이 이미 쓰는 관례다.
- [x] 쓰기 경계: **새 패키지 `@prs/github-annotate`** 다. 조회용 `@prs/github`에 `PATCH`를 더하지 않았다 — `search-api`가 그 패키지를 의존하므로, 같은 패키지에 두면 조회 서비스의 의존 그래프가 쓰기 코드를 포함하게 되고 보안 문서 13장이 말하는 「세 번째 경계」가 이름만 남는다. 이 패키지를 의존하는 앱은 `pipeline-worker` 하나이며 회귀가 그것을 강제한다.
- [x] 재사용한 것과 재사용하지 않은 것: 가림(`safeMessage`)·헤더 해석(`parseRateLimitHeaders`·`parseRetryAfter`)·토큰 발급기(`InstallationTokenProvider`)는 **신원을 모르는 순수 기계**라 같은 클래스를 다른 자격으로 한 번 더 세웠다. `GitHubTransport`·`GitHubClient`·`TokenPool`은 조회 App의 자격에 묶여 있어 쓰지 않았다. `parseInstallations`는 변수 이름을 인자로 받게 넓혔다 — 같은 형식에 검사기를 둘 두지 않기 위해서다.
- [x] 판정: `title.ts`의 두 순수 함수가 GHE를 부르기 전에 답을 낸다. 저장소 코드는 `@prs/domain`의 `repositoryCodeOf`·`formatMergeNumber`가 정본이며 **이 WP는 M 번호를 다시 계산하지 않는다** — 이미 확정된 `merge_number`를 소비하기만 한다.
- [x] 순서: 코드 확정 → **지금 제목 조회** → 순수 판정 → 제목 한 필드 PATCH → 정본 → 감사. 저장된 제목을 쓰지 않는 것이 사용자의 그 사이 편집을 보존하는 유일한 방법이고, 조회를 먼저 두는 것이 at-least-once 실행에서 접두가 두 번 붙지 않게 하는 성질을 만든다.
- [x] 데이터: 마이그레이션 026이 `repository`에 `annotate_enabled`·`annotate_blocked_at`·`annotate_blocked_reason`을 더한다. additive이며 기존 저장소는 허용이 기본이다 — 전역 스위치가 꺼짐이라 **마이그레이션 적용만으로는 아무 제목도 바뀌지 않는다.**
- [x] 전달: `prs:projected`의 논리 소비자 `annotate`를 카탈로그에 등록했다. `mnumber`(WP-074)와 **다른 group**이다 — 같으면 채번 힌트와 표기가 이벤트를 나눠 먹어 각자 절반만 본다(DEV-205의 규율).
- [x] 배포: Profile A에 `worker-annotate`, Profile B에 `pipeline-worker-annotate.yaml`과 전용 시크릿 `prs-annotate-secrets`를 뒀다. 회귀가 **서비스별 최종 환경 키 집합**으로 자격 분리를 양방향으로 강제한다.
- [x] 런북 7.B에 설정 절차와 끄는 방법을, 8장에 증상 셋을 더했다.
- [x] 구현 원장: `DEV-616`·`DEV-617`을 5장에, 검증 결과를 6.81장에 적었다.

**승인 범위를 넘지 않은 자리 둘.** 둘 다 `ADR-022`가 이미 금지하거나 범위 밖으로 적어 둔 것이다.

| 유혹 | 하지 않은 것 | 근거 |
| --- | --- | --- |
| 에폭이 오른 뒤 옛 접두를 고치기 | 불일치로 남기고 사람이 판단한다 | `ADR-022` 결정 5와 Follow-up. 자동으로 수백 건의 제목을 고치면 그만큼 알림이 나가므로 별도 CR이다 |
| 제목이 길어 거부되면 잘라서 성공시키기 | 잘라내지 않고 `422`를 사유로 남긴다 | 「원래 제목의 나머지 부분은 바꾸지 않는다」(`AC-1`)가 성공률보다 앞선다 |

**자가 연구가 바꾼 판단 하나 (`DEV-616`).** `FR-SEQ-009`의 예외 처리는 「403·404면 그 저장소의 표기를 중단한다」고 적는다. 그런데 공식 문서는 **주 한도와 부 한도 모두 `403` 또는 `429`로 온다**고 적으며, 403의 두 원인을 구분하는 방법은 보장하지 않는다. 상태 코드만 보고 전부 권한 거부로 다루면 한도 소진 한 번이 그 저장소의 표기를 영구히 멈춘다 — FR이 적은 사유("권한이 없는데 재시도를 반복하면 rate limit만 소모한다")와 반대 방향의 사고다. 그래서 **문서가 보장하는 것만** 쓴다: 대기 신호(`retry-after` 또는 `x-ratelimit-remaining=0`)가 있으면 한도이고, 없으면 기다릴 근거가 없으니 권한으로 다룬다. 공식 문서의 재시도 순서를 그대로 구현했다.

**리뷰가 찾은 것 여섯 — 그중 둘은 외부 쓰기의 안전에 직접 걸렸다.**

| 편차 | 무엇 | 처분 |
| --- | --- | --- |
| `DEV-621` | 에폭 울타리가 **목록 질의 시점에만** 있었다. 목록을 처리하는 동안 재채번이 들어오면 무효가 된 번호가 GHE로 나간다 | 외부 쓰기 바로 앞에서 정본을 다시 묻고, 재채번 중 공간을 목록에서 제외했다 |
| `DEV-619` | 토큰 발급의 일시 장애가 **영구 실패로 기록**되고 회복이 스윕까지 밀렸다 | 발급기 오류를 표기 오류 모델로 정규화했다 |
| `DEV-620` | 이벤트 회차와 스윕이 겹쳐 같은 행에 요청과 감사가 두 벌 생길 수 있었다 | 프로세스 안에서 회차를 직렬화했다 |
| `DEV-622` | 변경 요청 사이에 최소 1초를 두라는 **공식 지침을 따르지 않았다** | 실제로 쓴 뒤에만 쉬며 하한을 설정으로도 내릴 수 없게 했다 |
| `DEV-623` | 성공 판정이 **문서가 보장하지 않는** 응답 일치를 전제했다 | 같은 순수 판정기에 응답을 넣어 접두의 존재를 묻는다 |
| `DEV-624` | API 계약 문서가 `annotate_enabled`를 적지 않아 **비상 스위치를 발견할 수 없었다** | 계약을 갱신했다 |
| `DEV-625` | **영원히 실패하는 행이 잔여 스윕을 굶길 수 있었다** — 코드를 정할 수 없는 저장소가 상한을 차지하면 다른 저장소에 스윕이 닿지 않는다 | 한 번도 시도하지 않은 행을 먼저, 그다음은 가장 오래전에 손댄 것부터 본다. 저장소 코드 규칙을 SQL에 다시 쓰지 않았다 |
| `DEV-626` | 권한 차단이 **쓰기 성공에서만** 풀려, 남은 대상이 모두 이미 표기된 저장소는 권한이 복구돼도 하루를 기다렸다 | 조회가 성공하면 푼다 — 그 시점이 접근이 증명된 시점이다 |
| `DEV-627` | **`DEV-622`의 수정이 만든 결함.** 1초 간격 때문에 회차가 200초까지 늘어났는데 버스의 회수 시한이 30초였다 | 이벤트 경로에 25초 예산을 두고 남은 것은 `defer`로 이어받는다. 스윕에는 예산을 두지 않는다 |
| `DEV-628` | **`DEV-627`의 수정도 틀렸다.** 예산을 락을 잡은 뒤부터 재어 줄에서 기다리는 시간이 예산 밖이었다 | 줄을 서기 전부터 잰다. 대기만으로 다하면 정본을 읽지도 않는다 |
| `DEV-630` | **`DEV-623`의 수정이 성공 판정을 지나치게 느슨하게 만들었다.** 접두만 보면 서버가 본문을 잘라도 성공으로 기록된다 | 뒤 공백만 걷어 내고 나머지는 글자 그대로 대조한다 |
| `DEV-631` | 토큰 발급의 인증 실패를 재시도 가능으로 분류해, 자격이 틀린 배포가 행마다 다섯 번씩 두드렸다 | 발급 경로의 `auth`만 권한 계열로 옮긴다. 요청 경로의 `401`은 그대로다 |
| `DEV-629` | 회차 겹침을 막는 장치가 프로세스 안에만 있다 — 인스턴스를 늘리면 `DEV-620`이 다시 열린다 | **open.** 분산 claim을 이 판에서 만들지 않고, 두 배포 정의에 replica 1이 정확성 조건임을 적었다 |

**수정이 수정을 만든 자리가 셋이었다** (`DEV-622`→`DEV-627`→`DEV-628`, `DEV-623`→`DEV-630`, `DEV-619`→`DEV-631`). 전부 **고친 것을 다시 보게 한 검토**가 잡았다 — 한 판으로 끝냈으면 셋 다 남았을 것이고, 그중 `DEV-630`은 「원래 제목을 보존한다」는 이 기능의 핵심 계약이 무너지는 자리였다.

**독립 검토가 미해소로 적은 두 건은 그 사이 이미 닫혀 있었다.** 두 검토 모두 첫 수정 라운드까지만 본 상태였고, 그들이 지목한 major(스윕 굶주림)와 minor(차단 해제 범위)는 `DEV-625`·`DEV-626`이 앞서 닫았다. **그 사실을 검토자의 말이 아니라 코드로 확인한 뒤에 판단했다.**

**독립 검토 두 판을 따로 돌렸다.** 한 판은 자격 분리와 쓰기 반경과 비밀값 유출을, 한 판은 판정의 경계값과 상태 기계와 **시험 자체의 품질**을 보았다. 둘 다 blocker를 찾지 못했고 `DEV-625`·`DEV-626`이 그 산물이다. 후자가 「아무것도 증명하지 못하는 시험」 둘과 **살아남는 변이 하나**(백오프를 상수로 바꿔도 전부 통과)를 지목했고, 그 셋을 메웠다 — 지표를 라벨 존재가 아니라 **개수**로 세고, 운영자 정책을 쓰는 문장을 정규식으로 막고, 재시도 대기의 **수열 자체**를 단언한다.

**막을 수 없는 것 하나 (`DEV-618`).** 제목을 읽은 뒤 쓰기까지의 사이에 사용자가 제목을 고치면 그 편집이 덮인다. 조건부 쓰기로 막으려 했으나 공식 문서가 「비안전 메서드의 조건부 요청은 특정 엔드포인트에서 따로 명시하지 않는 한 지원하지 않는다」고 적고 PR 갱신 엔드포인트에는 그 명시가 없다. **없는 완화를 지어내지 않는다** — 창을 좁히고 피해 반경을 적었다. 쓰기는 제목 한 필드이고 한 PR에 평생 한 번뿐이므로 노출은 PR당 한 번의 수백 밀리초다.

**검증.** 타입·린트·의존 방향 통과. 단위·회귀·통합 수치는 6.81장이 정본이다. 변이 시험을 안전 규칙마다 돌렸다. 문서 검사기는 `main` 대비 신규 issue 0건이다.

**사내 적용은 `NOT RUN`이다.** 실제 GHE PR 제목을 바꾼 적이 없다 — 외부에 GHE가 없고, public 저장소의 PR 제목도 건드리지 않았다. 쓰기 흐름은 전부 로컬 HTTP 목으로 검증했으며 그 사실을 6.81장이 표로 가른다.

### CR-085 cascade — WP-075 안전성 보강 (재시도·예산·실행자·복구 근거)

시작 `origin/main`은 `28d3ccf`, 브랜치는 `fix/wp075-annotate-safety`다. **이 판은 기능을 새로 만들지 않는다** — `CR-084`가 구현한 경로가 실패·재시작·설정 변경 상황에서도 `AC-1`을 지키게 하는 것이 전부다.

**먼저 재현하고 그다음 고쳤다.** 다섯 가지 실패 경로를 현재 코드에 대한 시험으로 세워 **일곱 건 전부 실패하는 것을 보고** 시작했다(`annotate-safety.test.ts`, 재현 기록은 원장 6.82장). 고친 뒤 같은 시험이 통과한다. 가설이 코드에서 반증된 자리는 없었다 — 다섯 전부 실재했다.

- [x] 요구사항: `srs_final.md` `FR-SEQ-009`에 `AC-8`~`AC-10`을 더했다. **요구사항 문장과 기존 AC 일곱은 한 글자도 바꾸지 않는다.** `AC-8`은 변경 요청을 다시 보낼 때 현재 제목·정본·정책을 다시 확인하도록 하고, `AC-9`는 서버가 저장한 제목이 보낸 값과 다르면 자동으로 다시 쓰지 않게 하며, `AC-10`은 결과를 확정할 수 없는 요청을 실패가 아니라 불명으로 적게 한다. **`AC-9`는 `AC-3`(「재시도 대상이며」)의 예외를 만들므로 명시가 필요했다** — 그 자리를 적지 않으면 구현이 승인 없이 재시도를 멈춘 것이 된다. `prd.md`·`glossary.md`·요구사항-화면 매트릭스는 바꿀 것이 없다(신규 용어·화면 없음). **바꿀 것이 없다는 사실을 확인한 뒤 적는다.**
- [x] 재시도의 단위: `updateTitle` 호출을 `attemptOnce` 안으로 넣어 **변경 요청 하나에 판단 전체가 붙게** 했다. 다시 보낼 때마다 정본 확인 → 제목 조회 → 순수 판정 → 간격 대기 → 울타리 재확인 → PATCH를 다시 지난다. 회귀가 그 호출이 하나뿐이고 조회·울타리보다 뒤에 있음을 구조로 고정한다.
- [x] 시간: `PassDeadline`이 줄 서기 전부터 재고, **중단 신호를 HTTP 왕복까지 전달한다**(`AbortSignal.any`). 만료 판정은 타이머가 아니라 **시각 비교**가 정본이다 — 타이머만 믿으면 해상도만큼 늦고, 시계를 미는 시험에서는 영영 알아채지 못한다. 예산이 다하면 **새 원격 요청을 시작하지 않고** 남은 것은 다음 전달이 이어받는다.
- [x] 간격: `WriteGate`가 **실행자 전체**에 간격을 적용한다. 성공한 행 뒤가 아니라 **모든 변경 요청 앞**에서 차례를 기다리며, 보낸 시각은 보내기 전에 기록해 실패한 요청도 간격에 든다. 한도 신호를 받으면 게이트 전체가 그 시각까지 멈춘다(`DEV-640`). 재시작하면 마지막 쓰기 시각을 잊으므로 첫 쓰기를 한 간격 늦춘다 — 영속화하지 않은 이유는 한도의 단위가 저장소가 아니라 App 설치라 정본에 둘 자리가 마땅치 않기 때문이다.
- [x] 신선도: 차례를 기다린 시간이 쓰기 간격보다 길면 **처음부터 다시 한다**(제목을 다시 읽는다). 짧은 대기는 그대로 간다 — 그만한 창은 `DEV-618`이 이미 인정한 크기이고, 한도 유예는 분 단위라 질이 다르다.
- [x] 실행자: `annotate:runner` advisory **세션** 락을 쥔 프로세스만 쓴다(`DEV-629` resolved). 락이 준 커넥션으로 정본을 묻기 때문에 「락을 아직 쥐고 있는가」를 따로 묻지 않아도 된다 — 질의가 성공했다는 것이 세션이 살아 있다는 증거다. **보장 범위는 같은 정본 DB를 보는 프로세스들뿐이다**: 다른 DB를 쓰는 두 배포나 네트워크 분할의 exactly-once는 막지 못하며, 락을 잃기 전에 이미 보낸 요청은 서버에 닿는다. 통합 시험이 **실제 자식 프로세스**를 띄워 그 경계를 지난다.
- [x] 결과의 확실성: 마이그레이션 027이 상태 둘을 더한다. `body_changed`는 서버가 저장한 제목이 보낸 값과 다른 경우이며 **자동 재시도에서 빠진다**, `unknown`은 응답을 받지 못해 확정할 수 없는 경우이며 다음 회차가 제목을 다시 읽어 확인한다. 근거 세 열(`annotate_attempt_id`·`annotate_expected_digest`·`annotate_result_reason`)은 **제목 원문을 담지 않는다** — 해시 앞 16자와 짧은 사유 코드뿐이고, 길이 제약이 원문 유입을 막는다. 보존 기간을 새로 두지 않는다(행의 수명을 따른다).
- [x] 감사: 실제로 쓴 경우는 `annotated`, 결과 불명에서 복구하며 접두를 관측한 경우는 `annotated_observed`로 **결과 코드를 가른다**. 후자를 `annotated`로 적으면 「우리가 썼다」가 거짓일 수 있다 — 다른 주체가 같은 접두를 붙였을 가능성을 공식 API가 가려 주지 않는다. 감사와 정본 표시 사이의 crash 창은 **여전히 남으며**, 이 판도 그것을 없애지 못했다.
- [x] 권한 차단(`DEV-637`, `DEV-626`의 처방 변경): **조회 성공으로는 풀지 않는다.** 공식 문서가 읽기와 쓰기를 다른 권한으로 나누므로 `GET` 200은 쓸 수 있다는 증거가 아니고, 그 200으로 풀면 다음 회차가 다시 막는 순환이 생긴다. 푸는 것은 **실제 쓰기 성공**이거나 운영자의 명시적 재개다. **대가를 적는다**: `DEV-626`이 지적한 문제(남은 대상이 모두 이미 표기된 저장소는 권한이 복구돼도 쿨다운만큼 기다린다)가 일부 돌아온다. 새 PR이 생기면 그때 쓰기가 성공해 풀리므로 영구적이지 않다.
- [x] 재개: `PATCH /admin/repositories/{id}`에 `annotate_resume`을 더했다(API-ADM-002). 권한 차단과 `body_changed` 행을 함께 열며 **감사는 기존 `repository.update` 한 줄에 담는다**(`CR-054`의 규율). 이미 붙은 제목을 되돌리지 않는다 — 여는 것은 다음 시도의 자격뿐이다.
- [x] 사전 점검: `annotate-preview-cli`가 켜기 전에 무엇이 몇 건 바뀌는지 읽기 전용으로 보여 준다. `BEGIN READ ONLY` 안에서 돌고 쓰기 함수를 아예 import하지 않으며, 회귀가 그것을 고정한다. **잡이 쓰는 바로 그 질의로 센다** — 비슷한 질의를 새로 쓰면 조건이 갈린다. **확인하지 못한 것을 함께 출력한다**(쓰기 권한·병합된 PR의 수정 가부 등). 워커에 둔 이유는 전역 스위치와 자격이 그 환경에만 있기 때문이다.
- [x] 종료(`DEV-638`): 스윕이 종료 신호를 회차로 전달해 **진행 중인 HTTP까지 끊는다.** 이전에는 상한 200건짜리 회차가 끝나야 프로세스가 죽었다.
- [x] 데이터·비동기·인프라·API 계약 문서와 런북 7.B를 함께 갱신했다.
- [x] 구현 원장: `DEV-632`~`DEV-640`을 5장에, `DEV-629`를 resolved로, 재현과 검증을 6.82장에 적었다.

**`0.1.0-pilot.6` 후보 번들을 만들었고 발행하지 않았다.** 병합된 `main`에서 `--release` 없이 만들어, 적재한 이미지로 **표기 OFF의 무요청·표기 ON의 실제 `PATCH`·다른 M 접두 미덮어씀·감사 기록·마이그레이션 027 적용**을 전부 실행해 확인했다. CI가 코드를 실행하지 못한 상태이므로 immutable 릴리스는 만들지 않았다 — **구현 완료 · 후보 검증 완료 · 발행 보류**다. 상세는 원장 6.82장이다.

**독립 검토 두 판 — blocker·major 없음.** 한 판은 외부 부작용·자격·정책·감사를, 다른 판은 시간 제한·재시도·락·복구를 보았다. 나온 것은 note 넷과 minor 둘이며 넷을 닫고(`DEV-643`~`DEV-646`, `DEV-648`) 둘을 근거와 함께 열어 뒀다(`DEV-647`·`DEV-649`). **열어 둔 둘은 고치려면 다른 계약을 건드려야 하는 것들이다** — 유예 횟수 상한은 「정상 동작을 실패로 세지 않는다」는 `DEV-627`의 판단을 뒤집고, 토큰 발급의 중단 신호는 조회 경로와 공유하는 클래스의 계약을 넓힌다.

**앞선 판이 심어 둔 시험이 이 판의 마이그레이션을 잡았다.** `merge-number-schema.test.ts`가 「다음에 027이 생기면 여기서 즉시 깨진다」고 주석에 적어 둔 그대로 깨졌다. 결함이 아니라 시험이 설계대로 동작한 것이며, 내려갈 목록을 갱신했다.

**승인 범위를 넘지 않은 자리 셋.**

| 유혹 | 하지 않은 것 | 근거 |
| --- | --- | --- |
| 조건부 쓰기로 경합을 없애기 | 창을 좁히는 데서 멈췄다 | 공식 문서가 비안전 메서드의 조건부 요청을 지원하지 않는다고 명시한다 (`DEV-618`). 없는 완화를 지어내지 않는다 |
| 다중 활성 워커로 처리량 늘리기 | 실행자를 하나로 못 박았다 | 분산 claim은 이 판의 범위가 아니다. 락은 늘리기 위한 것이 아니라 **실수로 둘이 뜨는 것**을 막기 위한 것이다 |
| `body_changed` 행의 제목을 자동 복원하기 | 멈추고 운영자에게 넘긴다 | 복원도 쓰기다. 무엇이 옳은 제목인지 이 잡은 모른다 |

**자가 연구가 확인한 것 — 공식 문서를 직접 읽었다.** 이 판의 판단 넷이 문서에 근거한다.

| 질문 | 공식 문서가 말하는 것 | 이 판의 처분 |
| --- | --- | --- |
| 비안전 메서드에 조건부 요청을 쓸 수 있는가 | **명시적으로 아니다.** 「Conditional requests for unsafe methods, such as `POST`, `PUT`, `PATCH`, and `DELETE` are not supported unless otherwise noted in the documentation for a specific endpoint.」 PR 갱신 엔드포인트에는 그 예외 표기가 없다 | `DEV-618`을 열어 둔 채 창을 좁히는 데서 멈춘다. 없는 완화를 지어내지 않는다 |
| 변경 요청 간격은 성공한 요청만의 것인가 | **아니다.** 「If you are making a large number of `POST`, `PATCH`, `PUT`, or `DELETE` requests, wait at least one second between each request.」 성공 여부를 가르는 문구가 없다. 별도 절이 「you should make requests serially instead of concurrently」를 더한다 | 간격을 **모든 변경 요청 앞**으로 옮겼다(`DEV-636`). 직렬 권고는 실행자 하나 제약과 같은 방향이다 |
| 403의 두 원인을 구분할 수 있는가 | **공식적인 방법이 없다.** 주·부 한도 모두 「a `403` or `429` response」로 오고, 부 한도는 「There is not a way to check the status of your secondary rate limit」까지 적힌다 | `DEV-616`의 판단을 유지한다 — 대기 신호가 있으면 한도, 없으면 권한이다 |
| 응답을 받지 못했을 때 적용 여부를 확인할 수 있는가 | **수단이 없다.** 멱등성 키도, 요청 ID 조회도, 재시도 안전성에 대한 서술도 두 문서 어디에도 없다 | `unknown` 상태를 만들었다(`DEV-639`). 다음 회차가 제목을 다시 읽는 것이 유일한 확인 수단이다 |

**자가 연구가 찾은 공백 하나를 이 판에서 메웠다 (`DEV-641`).** `pull_request.annotate`의 감사 `result_code` 어휘가 **어느 계약에도 없었다.** 이 저장소의 관례는 액션마다 자신의 어휘를 계약 문서가 소유하는 것이고(`safe_marker.set`이 API 계약에 여섯 값을 표로 못박아 둔 선례), `audit_record.result_code`는 DB에 제약이 없는 `TEXT`다. `CR-084`가 값을 코드에만 두어 감사 로그를 읽는 사람이 목록 없이 사유를 복원할 수 없었고, 이 판이 `annotated_observed`를 더하면서 그 공백이 실제 문제가 됐다. 보안 문서 13.2절에 두 값과 각각이 남는 조건을 표로 적고 회귀가 **양방향으로** 대조한다.

**사내 GHES의 한도 수치를 Cloud 문서로 가정하지 않는다 (`DEV-642`).** 공식 GHES 문서는 「Rate limits are disabled by default for GitHub Enterprise Server」라고 적고, 관리자가 켜더라도 설정 단위가 Cloud 문서의 installation 단위와 같다는 보장이 없다. 이 판의 설계는 그 사실에 영향을 받지 않는다 — 간격과 유예는 **문서가 보장하는 수치가 아니라 우리가 정한 하한**을 지키고, 한도 신호가 오면 그때 그 값을 따르기 때문이다. 다만 「한도가 얼마이니 이 정도면 안전하다」는 계산을 어디에도 적지 않는다.

**`DEV-616`에 근거를 보탰으나 코드는 바꾸지 않았다.** 공식 문서의 Troubleshooting 절이 권한 부족 `403`에 「Resource not accessible by integration」 메시지와 `X-Accepted-GitHub-Permissions` 헤더라는 적극적 식별 신호를 부여한다는 것을 확인했다. 지금의 소거법은 그대로 유효하고 그 신호를 더하면 판정이 더 강해지지만, 문서가 세 신호의 상호 배타성까지 보장하지는 않으므로 그 조합은 별도 판단이 필요하다 — **이 판의 범위를 넓히지 않고 근거만 원장에 남겼다.**

**부 한도의 적용 단위는 문서가 밝히지 않는다.** 주 한도는 「per repository」·「per OAuth app」·「the installation's minimum rate limit」처럼 단위가 적혀 있지만, 부 한도는 유발 조건만 열거하고 카운터의 주체를 말하지 않으며 「subject to change without notice」라고 덧붙인다. 그래서 한도 유예를 **실행자 전체**에 건다 — 단위를 모를 때 가장 좁게 거는 것은 틀릴 수 있지만 가장 넓게 거는 것은 느릴 뿐이다. 같은 문서가 「Continuing to make requests while you are rate limited may result in the banning of your integration」이라고 경고하므로 느린 쪽을 골랐다.

**공식 문서가 보장하지 않는 것을 계약으로 쓰지 않았다.** 5xx를 「거절됨」이 아니라 「결과 불명」으로 다루는 것이 그 예다 — 게이트웨이가 답한 5xx 뒤에서 원본 요청이 처리됐을 수 있고, 문서는 그것을 가릴 수단을 주지 않는다. 확정할 수 없는 것을 확정했다고 적지 않는 쪽을 골랐다.

### CR-086 cascade — REL-007 R0 착수와 첫 수직 (`gh pr list`)

시작 `origin/main`은 `5128c1c`(착수 시), PR의 대상은 `b35e4ee`(그 사이 agent-context만 바뀌었다). 브랜치는 `feature/rel007-r0-pr-list`, PR은 #181이다. **이 판은 결정자가 승인한 착수를 실행한 것이다** — REL-007의 첫 읽기 전용 수직 하나를 인가 → 미리보기 → 실행 → 결과·이력까지 열되, R1~R3·`gh api`·extension·Recipe·파일 입출력·승인 흐름은 열지 않는다. 릴리스는 발행하지 않았고 기본값은 꺼짐이다.

**먼저 CI를 실제로 돌렸다.** 착수 시 `main`(`5128c1c`)의 run `34705991448`을 기존 hosted 러너에서 다시 돌려 attempt 2가 두 잡(`verify` 18단계·`integration` 12단계) success였다 — 코드 변경 0건, `runs-on` 불변. 그 뒤 `b35e4ee`의 run `34738457122`는 04:40Z부터 러너 배정 없이 `queued`로 남았다(결제 문제 재발로 보인다). PR #181의 check(hosted 러너, `runs-on` 불변): `8981c91` 두 잡 success(verify 4m04s·integration 4m01s) → `9eeff48`·`9da8f55`는 **같은 자리에서 failure**(`workbench.spec.ts:59` Ctrl+K flaky, `DEV-662`; integration은 success) → 그 시험의 대기 조건을 고친 `35369f9`에서 두 잡 success(verify 4m01s·integration 4m26s). 병합은 **최종 커밋의 두 check가 green인 것을 실측한 뒤**에만 한다 — 예외 병합 승인은 없다.

- [x] 요구사항: **`srs_final.md`를 바꾸지 않았다.** `FR-GH-012` AC-1이 요구하는 감사 항목은 `gh_execution` 행(`ENT-GH-002`)이 전부 담으므로 실행 감사의 정본은 그 표이며, `FR-AUTH-004`의 `audit_record` action 표에는 행을 더할 것이 없다. FR 문장·AC·안정 ID 변경 0건.
- [x] 데이터 모델 3.5장: `028_gh_operations`의 실현 상태 표를 두었다 — 만든 넷(`github_identity_connection`·`gh_identity_secret`·`gh_execution`·`gh_execution_idempotency`)과 만들지 않은 다섯의 이유. `gh_execution_idem_uk`가 파티션 표에서 유일성을 강제하지 못한다는 사실(`DEV-650`)과 마이그레이션 번호 정정. 7장 보존 표에 봉인·멱등 표.
- [x] 비동기 9.1·9.4: `prs:gh:executions` 파티션 4·소비자 그룹·구독 분배, JOB-GH-001·007 구현, JOB-GH-004는 요청 시점 갱신, EVT-GH-003 미구현(`DEV-651`).
- [x] 백엔드 12.1: R0 배치 표(모듈 → 실제 파일), 14단계 중 R0가 지나는 단계.
- [x] 인프라 3.1·12장: `gh-executor`를 **선택 프로파일**로 (CR-059의 파일럿 기본 형상 유지, `DEV-661`), tmpfs·동시 실행·시간·출력 상한·취소·환경 허용 목록·사설 CA를 확정.
- [x] 보안 6장·10.1·10.2: Operations App client secret과 봉인 키의 행, Profile A의 봉인이 비밀 저장소의 대체이지 동등물이 아니라는 것과 그 대가(`DEV-652`).
- [x] API 계약: API-GH-002 미리보기와 `Idempotency-Key`, API-GH-003의 R0 경로, API-GH-005 상태만, API-GH-007 콜백, API-GH-010 상세·`before` 키셋, R0 구현 계약 요약, `GH_CAPABILITY_NOT_EXECUTABLE`.
- [x] 프런트엔드 9.1: `/gh`·`/gh/history`·`/gh/identity/callback`만 실재, R0 화면 규율(같은 판정 함수·서버 값만 그림·텍스트 노드·Idempotency-Key·EventSource+폴링·404 = 열리지 않음).
- [x] 로드맵 4.3 REL-007 착수, 작업 패키지 WP-077 신설(done, 사내 실검증 NOT RUN)과 상위 WP 일곱의 부분 `in_progress`, 4장 커버리지 8·69, 검증 계획 REL-007 행과 R0 게이트 판정.
- [x] 구현 원장: 3장(누락 행 넷 보강 `DEV-663`), 4장 FR-GH·NFR partial, 5장 `DEV-650`~`DEV-663`, 6.83장 검증 기록(외부/사내 표, 배터리, 변이, CI, 자가 연구).
- [x] 배포·런북: compose 선택 프로파일, `prsctl`(프로파일·이미지 목록·health·restore), 번들 `APP_TARGETS`, `smoke-images.sh` 6절, `.env.example` 절, RUNBOOK 7.C(켜기·끄기·증상)와 6장 CA 표·8장 행, k8s README 한 줄.
- [x] 문서 검사기 `--strict`: main 기준선과 **같은 6건**(오류 4 — `FR-CSS-005`·`D-002` 미정의, placeholder 12+8 · 경고 2 — `risks.md` 경로), **신규 0건.** strict 전체 통과가 아니다.

**구현이 스스로 고른 것(Agent-Initiated Decisions)은 최종 보고의 별도 장과 agent-context/decisions.md에 전부 적었다.** 무거운 것: 브라우저 안전 `@prs/gh-cli` + `/node` 서브패스 · 실행 차원 `allowed | not_implemented | policy_blocked`과 `GH_CAPABILITY_NOT_EXECUTABLE` · manifest unknown 195건을 그대로 셈(`DEV-657`) · `pr.list` 옵션 셋만 · 봉인(AES-GCM, `.env` 키) · 멱등 보조 표 · 큐 재검증과 argv 재조립 대조 · 취소는 DB 폴링 · SSE는 상태만 · 출력 상한과 절삭은 실패 · 이력은 본인만 · 선택 프로파일 · 꺼진 실행기의 헬스체크는 DB를 묻지 않음.

**승인 범위를 넘지 않은 자리.**

| 유혹 | 하지 않은 것 | 근거 |
| --- | --- | --- |
| K8s manifest를 함께 만들기 | 만들지 않았다 | 지시가 K8s를 주력으로 만들지 말라고 했다. `deploy/k8s/README.md`가 없음을 적는다 |
| `--search`·`--author`·`--label`·`--jq`·`--web` 열기 | `--state`·`--limit`·`--json`만 | 자유 문자열·임의 표현식·브라우저는 다음 판의 제약 설계가 필요하다 (ADR-019) |
| 분류 195건을 supported로 찍기 | unknown 그대로 | 분류하지 않은 것을 분류했다고 적지 않는다. NFR-009 게이트는 미통과로 남는다 |
| 출력 청크 스트리밍 | 상태만 | R0 `pr list`에 실익이 없고 EVT-GH-003 미영속 규칙과 함께 설계해야 한다 (`DEV-651`) |
| flaky e2e 고치기 | 적기만 했다 | 이번 흐름을 막지 않는 기존 결함이며 관련 파일을 손대지 않았다 (`DEV-662`) |

**독립 검토 두 판.** (가) 권한·자격·입력·출력·공개 CI 경계 — blocker·major·minor 0, note 3(둘 고침, 하나는 계약대로). 재검토(가-2) note 1(수용). (나) 실행 수명주기·취소·중복·결과·회귀·배포 배선 — **major 1**: prsctl의 켜짐 판정이 compose의 dotenv 규칙과 갈려 `"true"`에서 search-api만 켜지는 형상이 조용히 생겼다(실측). 1차 처방 뒤 재검토(나-2)가 키 쪽 변형(`export`·공백)에서 같은 갈림을 다시 실측했고, 최종 처방은 **prsctl이 `.env`를 파싱하지 않고 compose가 렌더한 값을 단일 근거로 읽는 것**이다(`DEV-664`). 회귀가 실제 `docker compose config`로 키·값 변형 16종을 대조한다. minor 2(`DEV-665` 고침, `DEV-666` 설계 유지·로그), note 3(`DEV-667` 고침, `DEV-668` 기존 설계, 나머지 변경 없음). 검토자의 주장은 전부 코드와 재현으로 확인했다 — 원장 6.83장.

**병합 판정.** 구현·로컬 검증은 완료됐다(원장 6.83장). 병합 가능 판정은 PR #181의 필수 check가 최종 커밋에서 green일 때 성립하며, squash 병합 뒤 `origin/main`을 실측해 원장 3장 `WP-077` 행의 커밋/PR 열을 병합 SHA로 갱신한다. 릴리스는 발행하지 않는다.

### CR-087 cascade — main CI 실패 두 건의 원인 정정

시작 `origin/main`은 `5369772`. PR #181(`c5c8aea`)과 #182(`5369772`)의 head check는 green이었지만 **병합 커밋의 main CI는 둘 다 실패했다** — run `34752161210`은 `integration` 잡의 `test:integration`(freshness T03b), run `34752531241`은 `verify` 잡의 `test`(signature 타이밍). 잡 대기는 2~38초, 러너는 GitHub 호스팅이었으므로 결제·큐 문제가 아니라 **실제 시험 실패**다. 로그와 잡 메타데이터를 보존한 뒤 원인을 따로 조사했고, 기능 확장과 섞지 않으려고 이 CR 하나로 닫는다(REL-007의 다음 수직은 별도 CR로 연다).

- [x] 요구사항: **`srs_final.md`를 바꾸지 않았다.** `FR-ING-001` AC-1(상수 시간 비교)과 `FR-SEQ-008` AC-11(fetch 뒤 채번, 덮인 의도 완료)의 문장은 그대로이며, 시험 방법과 경계의 **구현**만 바뀐다.
- [x] 보안 12장 검증 표: 「웹훅 서명 | 단위 테스트 (유효·무효·변조·타이밍) | CI」를 결정적 위임 검증으로 고치고, 시간 측정은 진단(게이트 아님) 행으로 분리했다. 상세 근거는 원장 6.84장.
- [x] 구현 원장: 4장 `NFR-005` 시험 열, 5장 `DEV-669`·`DEV-670`, 6.84장 검증 기록(CI 증거·재현·수정 전 재현·변이·배터리).
- [x] 코드: `signature.test.ts`(결정적 위임 5건), `perf/signature-timing.perf.test.ts`(진단), `sequence-freshness.ts`(`beforeFetch` 훅), `sequence.ts`(fetch 직전 집합 고정), `sequence-work.ts`(`listCoverableRefreshWorkKeys`·집합 기반 `completeCoveredRefreshWorks`), 통합 시험 둘(재현 포함). 마이그레이션 변경 없음.
- [x] 문서 검사기 `--strict`: 결과는 원장 6.84장에 적는다 — 기준선(main 6건) 대비 신규 0건이 목표이며 strict 전체 통과라고 적지 않는다.

**승인 범위를 넘지 않은 자리.**

| 유혹 | 하지 않은 것 | 근거 |
| --- | --- | --- |
| 비율 하한을 0.5에서 내려 통과시키기 | 범위 그대로 두고 진단으로 옮겼다 | 범위를 넓히면 시험이 아무것도 말하지 않는다 — 필수 CI에는 결정적 검증을 둔다 |
| `timingSafeEqual` 문자열이 소스에 있는지만 보기 | 호출·인자·답·횟수를 본다 | 문자열 검사는 호출되지 않는 import도 통과시킨다 |
| T03b에 `sleep`을 넣기 | 경계를 집합으로 바꿨다 | sleep은 창을 좁힐 뿐 없애지 못하고, 다른 호스트의 시계 차이는 sleep으로 못 막는다 |
| `created_at <= startedAt + 여유` | 하지 않았다 | 여유를 더하면 fetch **뒤** 의도까지 덮는다 — 반대 방향의 오류다 |
| 재실행 green으로 실패를 지우기 | 실패 로그·잡 메타데이터를 보존했다 | 한 번의 성공은 앞선 실패를 삭제하지 않는다 |

**병합 판정.** 이 CR의 PR은 필수 check(`verify`·`integration`) green 뒤 squash 병합하고, **병합 커밋의 main CI**를 다시 실측해 원장 6.84장에 적는다. PR head의 성공으로 대체하지 않는다.

### CR-088 cascade — capability 분류·검증·드리프트·스냅숏·A-006 (REL-007 다음 수직)

시작 `origin/main`은 `ce5a4b0`(CR-087 병합 뒤). 브랜치 `feature/rel007-capability-registry`. **이 판은 결정자가 지시한 REL-007의 다음 수직이다** — 관리자가 「어떤 gh 버전·명령 정의를 쓰는가, 어디까지 분류했고 무엇이 미확인인가, 정의와 실제 바이너리가 달라졌는가, 분류됐지만 실행은 열지 않은 명령은 무엇이며 이유는 무엇인가, 마지막 검증은 언제 어떤 해시의 자료로 수행됐는가」를 CLI 보고서·저장·API·A-006 화면에서 확인할 수 있게 한다. 실행 허용은 `pr.list` 하나 그대로이며 릴리스는 발행하지 않는다.

**첫 계약 표 (S1).** 분류의 대상과 분모는 커밋된 manifest의 인벤토리다 — leaf 196(그룹 32·별칭 전용 1은 실행 대상이 아님), flag 1,034(실행 가능한 그룹의 flag 포함, SRS와 같은 분모), inherited 출현 312, short alias 625(고유 542 + inherited 83), 반복 가능 37, positional 164(USAGE의 최상위 괄호 묶음), `--json` 필드 707. 「분류 완료」= 그 차원의 값이 `unknown`이 아니고 근거(`basis`)가 있음. 「실행 허용」= 코드 표 `EXECUTABLE_CAPABILITIES`에 정의가 있고 manifest command도 `allowed`인 것 — 분류와 다른 축이다. 「실제 GHES 지원 확인」= 대상 GHES에서 돌려 본 것 — 이 판은 0건이며 `unsupported_by_host`도 0건이다(확인하지 않은 것을 미지원으로 적지 않는다). `unknown`(모름)과 `not_implemented`(열지 않음)와 `policy_blocked`(열지 않기로 함)는 다른 사실이다. 스냅숏 **기록**은 실행 정의 **활성화**가 아니다 — `activated_at`은 게이트 통과 뒤에만 가능하고 이 판은 어느 행도 활성화하지 않는다. 이번 완료 기준은 `GATE-GH-01`·`01b`·`02`이고, REL-007 전체 완료는 `01d`(bindability·port·자원 타입)·`06`·`08`이 남아 열리지 않는다.

- [x] 요구사항: **`srs_final.md`를 바꾸지 않았다.** FR-GH-001 AC-2·AC-3의 열거를 그대로 썼고(`support`·`GhControlClass`), NFR-009 본표의 차원 ID를 검증기의 차원 ID로 옮겼다. 실측 기준 열의 `--json` 지원 command 41은 이 판의 40과 다르며(`DEV-676`) 정정은 다음 CR이 정한다.
- [x] 데이터 모델 3.5장: 029 실현 표 — `gh_capability_snapshot`(계획 DDL의 CHECK를 `activated_at IS NULL OR unclassified_count = 0`으로, 인벤토리 해시·차원별 카운트·coverage JSONB 추가)과 신설 `gh_capability_verification`(`ENT-GH-012`, append-only). 1장 엔티티 표에 ENT-GH-012, 7장 보존 표.
- [x] 비동기 9.1·9.4: `JOB-GH-003` 구현(실행기, 기동 시 대기 + 주기 `GH_EXECUTOR_REGISTRY_CHECK_MS` 기본 1일, 동시 1, 재시도 3회 5·15·45초), `EVT-GH-006`은 버스 이벤트가 아니라 검증 기록·로그·지표 `gh_registry_stale`(`DEV-673`).
- [x] 백엔드 12.1: gh-registry 모듈 표(분류 표·규칙·검증기·드리프트·CLI 셋·실행기 검사·API 둘).
- [x] 인프라 12장: `GH_EXECUTOR_REGISTRY_CHECK_MS`, 기동 검사 시간(20~30초)과 헬스 `registry.stale`.
- [x] API 계약: `API-GH-001`에 분류 요약 셋(`interaction`·`side_effect`·`host_support`), `API-GH-013`(`GET /gh/registry`)·`API-GH-014`(`GET /gh/registry/commands/{id}`) — `operator`·`security_officer`, 검사를 돌리지 않고 기록을 읽음. 정책 차단 command의 `execution`이 `policy_blocked`로 적힌다(r0.1은 `not_implemented`였다).
- [x] 프런트엔드 9.1: `/ops/gh-registry`(A-006 읽기 전용). 내비 `ops` 항목 `ops-gh-registry`.
- [x] 관측성 10.2·10.3: 드리프트 알림의 근거(지표·검증 기록·헬스), RB-20에 A-006·CLI.
- [x] 파생 UI: 와이어프레임 A-006 행에 이번 구현 범위(들어온 요소·남은 요소), QA 체크리스트 `QA-GH-44`(없음·미완·지남·드리프트·오류를 가르고 0개 정상으로 그리지 않음).
- [x] 로드맵 4.3, 작업 패키지 `WP-078` 신설(done)과 `WP-045`·`WP-059`·`WP-061`·`WP-066` 부분 갱신, 검증 계획 게이트 판정(`GATE-GH-01`·`01b`·`02` 통과, `01d` 미달).
- [x] 구현 원장: 3장(WP-078·WP-045·WP-059), 4장(FR-GH-001·FR-GH-011·NFR-009), 5장(`DEV-657` resolved, `DEV-671`~`DEV-681`), 6.85장 검증 기록(독립 검토 두 판과 반영).
- [x] 배포·런북: compose·`.env.example`의 `GH_EXECUTOR_REGISTRY_CHECK_MS`, RUNBOOK 7.C(A-006·CLI·`registry_stale`의 두 원인·「검증 기록이 없습니다」).
- [x] 문서 검사기 `--strict`: 결과는 원장 6.85장에 적는다 — 기준선(main) 대비 신규 0건이 목표이며 strict 전체 통과라고 적지 않는다.

**승인 범위를 넘지 않은 자리.**

| 유혹 | 하지 않은 것 | 근거 |
| --- | --- | --- |
| 분류가 `supported`인 144개를 실행 가능으로 열기 | `pr.list` 하나 그대로 | 지시: 분류를 늘렸다는 이유로 실행 허용을 넓히지 않는다. 검증기가 `execution_widened`로 잡고 회귀가 정의 수 1을 건다 |
| `unknown`을 generic으로 뭉개 100%를 만들기 | 규칙이 없으면 `unknown` | 미분류 0은 규칙·표가 근거를 채운 결과다. 표에 행이 없는 leaf는 `unknown`으로 남는 시험이 있다 |
| 사내 GHES 미확인을 `unsupported_by_host`로 적기 | 전부 `unverified`, `unsupported_by_host` 0건 | 확인하지 않은 것을 미지원으로 적지 않는다 (FR-GH-011 AC-5) |
| 스냅숏 활성화·A-005 정책 편집·재검사 버튼 | 두지 않았다 | 활성화는 게이트 통과 뒤 운영자의 일이고, 정책 편집은 WP-059의 다른 절반이며, 검사는 실행기가 정해진 주기로만 한다 |
| 드리프트 시 프로세스 종료 | 실행만 `registry_stale`로 거절 | 종료하면 헬스가 없어 「왜」가 사라진다. 거절은 실행마다 사유가 남고 헬스·지표·A-006이 같은 사실을 말한다 |
| 요청마다 `gh --help` 순회 | 저장된 기록만 읽음 | 회귀가 search-api·web에 `checkDrift`·`extractInventory` 호출이 없음을 건다 |
| 결과 계약 차원을 「정의됨」으로 세기 | `GATE-GH-01d` 미달 그대로 | bindability·port·자원 타입은 정의(1건)에만 있다 — 그것이 WP-066의 남은 일이다 |

**구현이 스스로 고른 것(Agent-Initiated Decisions)은 최종 보고의 별도 장과 agent-context/decisions.md에 전부 적었다.** 무거운 것: 분류 표를 JSON이 아니라 TypeScript 표로(행마다 근거, 검증기가 재계산 대조) · `sideEffect: 'arbitrary'`를 확인된 값으로(`gh api`·`codespace ssh`·`extension exec`·`copilot`, 넷 다 R3) · 정책 차단 command의 실행 차원 `policy_blocked` · flag 차원 분모에 실행 가능한 그룹 포함(SRS 1,034와 일치) · command별 flag 판정(`COMMAND_FLAG_OVERRIDES`)과 비밀 값 표지 `secretInput` · 스냅숏 CHECK 완화(활성화 조건은 네 차원)와 append-only 트리거 · JOB-GH-003을 실행기에 두고 기동 시 기다림, 헬스는 먼저 열림 · 드리프트는 거절, 일시 오류는 stale 유지, 기록 실패는 판정을 바꾸지 않음 · 검사는 비동기 판(동시 4) · A-006 역할 둘 · API-GH-001은 가볍게 두고 상세는 API-GH-014 · CI 게이트는 기존 진입점(단위 시험이 커밋된 manifest를 검증, integration 잡의 시험이 실제 바이너리와 대조) · manifest 판 `r0.2`, 규칙 판 `rules-2026-09-14.2`.

**병합 판정.** 이 CR의 PR은 필수 check green 뒤 squash 병합하고, **병합 커밋의 main CI**를 다시 실측해 원장 6.85장에 적는다. 릴리스는 발행하지 않는다.

### CR-089 cascade — 결과 계약·typed port·순수 연결 판정·타입 그래프·A-006 조회 (REL-007 R1b)

시작 `origin/main`은 `f3cd00f`(CR-088 병합과 handoff 기록 뒤, main CI run `34791175999` success). 브랜치 `feature/rel007-result-contracts`. **이 판은 결정자가 지시한 REL-007의 결과 계약·타입 연결 검증 수직이다** — 관리자가 「각 명령이 어떤 형태의 결과를 내는가, 그 결과가 어떤 GitHub 자원을 가리키는가, 다른 명령의 입력으로 쓸 수 있는가, 연결하려면 어떤 필드·선택·컨텍스트가 필요한가, 연결할 수 없다면 타입·민감도·출력 형식 중 무엇 때문인가, 타입상 연결할 수 있어도 실행은 왜 막혀 있는가」를 A-006에서 확인하고 코드가 같은 사실을 검증한다. **그 정의만으로 새 명령이나 Recipe가 실행되지 않는다** — 실행 허용은 `pr.list` 하나이고 릴리스는 발행하지 않는다.

**첫 계약 표 (S1).**

| 낱말 | 이 판의 뜻 | 분모·수 |
| --- | --- | --- |
| 결과 계약 | 「이 command의 결과를 어떻게 해석할 수 있는가」의 의미 정본. manifest 분류(`classification.result`)가 소유하며 출력 모드마다 결과·adapter·스키마 또는 구조화 불가 사유를 따로 적는다 | leaf 196 |
| 출력 port | 결과에서 참조를 만드는 방법 — `--json` 식별 필드(native_json) 또는 gh 자신이 인자로 읽는 문법의 URL(resource_url). 이름이나 `--json` 존재만으로 만들지 않는다 | capability 32 · port 36 |
| 입력 port | 대상 자원을 받는 자리(positional의 번호·ID 대안, codespace `--codespace`). URL·이름·브랜치 대안과 필터 flag는 port가 아니다 | capability 80 · port 81 |
| bindable | composability가 `fully_bindable`·`partially_bindable`인가 — 결과 계약의 성질이다. 실행기가 그 결과를 실제로 구조화하는가(구현 adapter)와 다르다 | 32 (fully 0) |
| 구현 adapter | 실행 정의(`capabilities.ts`)가 실제로 만드는 결과 스키마. 계약을 복사하지 않고 계약의 출력 port를 이름으로 가리킨다 | 1 (`pr.list:pr_list_v2`) |
| 호환 | 판정기가 출력 port → 입력 port를 타입·개수·민감도·조건으로 이어도 된다고 답한 것. **실행 승인이 아니다** | 간선 398 (직접 0 · 조건부 398) |
| 실행 허용 | 코드 표 `EXECUTABLE_CAPABILITIES`와 manifest `allowed`가 둘 다인 것 | 1 (`pr.list`) |
| 실행 가능한 다단계 흐름 | 저장·실행되는 Recipe | 0 |
| 대상 GHES 확인 | 사내 GHES에서 실제로 돌려 본 것 | 0 (`DEV-674`) |

「분류됨」은 결과 계약 완전성 검사(`contract-checks.ts`)에서 그 차원의 문제가 0건이라는 뜻이다. port 차원은 분모가 0이면 통과가 아니다 — 모두를 비바인딩으로 적어 분모를 없애는 것은 분류가 아니다. `GATE-GH-01d` 통과는 REL-007 완료가 아니다(`01e`·`06`·`08`·대상 GHES 확인이 남는다).

- [x] 요구사항: **SRS v2.27 — 요구사항 문장과 수용 기준은 바꾸지 않았다.** 사실 셋만 고정 gh 2.97.0 실측으로 정정했다: 실측 기준 표와 `NFR-009`의 `--json` 출력 지원 command 41 → 40(`DEV-676` 종결), 9.8 4항 예시의 `gh pr checks` 출력 `CheckRunRef[]` → 실제로 성립하는 연결(`DEV-684`), `NFR-009`의 입력·출력 port 분류율 기준 열의 분모(`DEV-688`). 결정자 지시(14장)가 뒷받침된 사실 정정을 이 CR에서 승인했다. PRD·용어집·추적 매트릭스는 바꿀 것이 없었다(용어 `GhResultContract`·`GhResourceRef`·입출력 port·`GhBinding`·그래프·composability가 이미 있다).
- [x] 데이터 모델 1장: `ENT-GH-009`(분류가 소유하는 결과 계약의 실현 필드 — SRS의 `schema`·`adapters`를 출력 모드별로 나눔, 새 열·마이그레이션 없음), `ENT-GH-010`(식별 규칙, 참조는 권한이 아님), `ENT-GH-011`(평가만 연다, 제한 JSON Pointer).
- [x] 비동기 9.4: `JOB-GH-003` 보고서 판 `r2`와 옛 `r1` 기록의 읽기, 검사가 `passed`여도 스냅숏을 활성화하지 않음.
- [x] 백엔드 12.1: gh-registry 모듈에 `results`·`ports`·`contract-checks`·`resource-ref`·`json-pointer`·`binding`·`graph`, manifest `r0.3`, 순수 함수이며 실행 경로가 읽지 않음.
- [x] 인프라: 명령 목록에 `pnpm test:regression`, CI 통합 잡의 순차 회귀 단계.
- [x] API 계약: `API-GH-001`(`composability`·`result_adapter`·`result_contract` 요약), `API-GH-013`(`contracts`·`gate_scope`·보고서 판·`contract_dimensions`), `API-GH-014`(`result_contract`·`graph`), R1b 절(`pr_list_v2`·`invalid_identifier`·옛 기록·결과 계약이 있는 `pr.view`도 실행 불가). 6장 오류 코드는 바뀌지 않았다.
- [x] 프런트엔드 9.1: `/ops/gh-registry`의 결과 계약·port·연결 후보 표시(실행·Recipe 버튼 없음).
- [x] 보안: `THR-030`·`THR-031`의 부분 실현.
- [x] ADR-020: 구현 판 한 줄(출력 모드별 계약, `fully_bindable` 0, 목록 규칙, 그래프, `gh_api_structured` 미사용).
- [x] 관측성: 내용 변경 없음 — CR-088이 바꾼 내용에 맞춰 머리글만 올렸다(`DEV-687`).
- [x] 파생 UI: 와이어프레임 A-006 결과 계약 표시, QA 체크리스트 `QA-GH-45`(A-006 결과 계약·연결·옛 판)·`QA-GH-46`(W-010 참조 문구), 에이전트 브리프의 옛 측정값(placeholder 261 → 230, `--json` 41 → 40).
- [x] 로드맵 4.3(세 번째 수직·남은 완료 조건), 작업 패키지 `WP-079` 신설과 `WP-066` 부분 갱신(완료 기준 체크·연쇄 예시 정정)·3장 표·4장 커버리지(`WP-078` 누락 보강, 합계 71), 검증 계획(`GATE-GH-01d` 분모 명시, R1b 판정, 도메인 회귀 주기).
- [x] 구현 원장: 3장(`WP-079` 신설, `WP-066`·`WP-059`), 4장(`FR-GH-001` done·`FR-GH-002`·`FR-GH-005` partial·`NFR-009`), 5장(`DEV-682`~`DEV-689` 신설, `DEV-675`·`DEV-676` 종결), 6.86장 검증 기록.
- [x] CI: `.github/workflows/ci.yml` integration 잡의 `test:integration` 다음 `test:regression` 한 단계(러너·트리거·잡 구조·서비스 포트 불변, `DEV-686`).
- [x] 머리글: 이 CR이 바꾼 문서와, CR-087·CR-088이 내용을 바꾸고도 머리글을 올리지 않은 문서의 판을 한 번씩 올렸다(`DEV-687`) — 과거 커밋의 판을 소급해 만들지 않았다. `change_control.md`는 원래 상태 머리글이 없다.
- [x] 문서 검사기 `--strict`: 편집 전(main과 같은 문서) 종료 1 · ERROR 4(정의되지 않은 ID `FR-CSS-005`·`D-002`, 자리표시어 13+8) · WARN 2(`risks.md` 경로), 편집 후(머리글·원장까지 최종 수정) 같은 6건 — **신규 0건.** strict 전체 통과가 아니다. 원장 6.86장에도 적었다.

**승인 범위를 넘지 않은 자리.**

| 유혹 | 하지 않은 것 | 근거 |
| --- | --- | --- |
| 호환 판정이 나온 `pr.view`를 실행 가능으로 열기 | 실행 허용 `pr.list` 하나 그대로 | 지시: 결과 계약이 생겼다는 이유로 실행 가능하다고 판단하는 경로를 만들지 않는다. 통합 시험이 `pr.view`를 `allowed`로 위조해도 `GH_CAPABILITY_NOT_EXECUTABLE`임을 건다 |
| `--json`이 있는 command를 전부 `fully_bindable`로 | `fully_bindable` 0, 식별 필드가 있는 결과만 port | 필드 선택·출력 모드 조건이 늘 있고, 식별 필드가 없는 JSON(`pr checks` 등)은 참조를 만들 수 없다 |
| 모르는 결과를 `opaque_text`·`policy_blocked`로 일괄 치환해 미분류 0 만들기 | 행마다 비TTY 관측 근거 — 주 종류 63건 정정 | 검증기가 인벤토리에서 계약을 다시 만들어 대조한다(`classification_recompute_mismatch`) |
| SRS 예시(`pr checks` → `run rerun`)에 맞춰 link URL로 간선 만들기 | 간선을 만들지 않고 예시를 정정 | `pr checks` 결과에 식별자가 없다(`DEV-684`) |
| port가 없는 command에 의미 없는 port를 하나씩 붙이기 | 이유가 있는 비적용(`inputPortsNote`·`outputPortsNote`) | 분모는 capability 수이고, 이유가 없으면 미분류다 |
| 목록 → 목록을 조건부로 열기 | 불가(`list_to_list`) | 상한 있는 fan-out 규칙(FR-GH-005 AC-9)이 먼저다 |
| Recipe 저장·그래프 편집기·실행 버튼 | 두지 않았다 | 지시의 제외. 바인딩 평가는 순수 함수이고 제품 코드가 부르지 않는다(회귀) |
| 검사가 `passed`가 됐으니 스냅숏 활성화 | 활성화하지 않았다 | 활성화 절차는 WP-059이며 CHECK가 결과 계약 차원을 보지 않는다(`DEV-685`) |
| 마이그레이션 030 추가 | 추가하지 않았다 | 029의 JSONB(보고서·coverage)로 충분하다 |
| 사내 GHES 미확인을 `unsupported_by_host`로 | 0건 그대로 | 검증기가 `unsupported_without_host_evidence`로 잡는다 |

**구현이 스스로 고른 것(Agent-Initiated Decisions)은 최종 보고의 별도 장에 적었다.** 무거운 것: 계약을 출력 모드마다 둠 · `pr_list_v2`(v1 재해석 없음, 번호 미선택은 참조 `unavailable`, 잘못된 번호는 결과 전체 거절) · port 분모를 capability 수로(출력 = 바인딩 가능, 입력 = 대상 자원 자리) · URL·이름·브랜치 대안을 입력 port에서 제외 · project·gist·artifact·user·team은 종류만(참조 없음) · JSON Pointer 제한(128자·토큰 8·자기 속성·prototype 토큰 거부) · 목록 → 목록 불가·목록 → 단일 명시 선택 · 보고서 판 `r2`와 `r1` 기록의 「미검증」 표시 · A-006 상세에 간선·불가 짝을 싣고 목록 API는 composability 하나만 · 픽스처를 manifest 실측으로 두고 드리프트 가드 · 바인딩 평가의 값 개수 검사 · 근거 문장의 출처를 무리마다 확인한 곳에만.

**독립 검토 두 관점과 재검토.** 원장 6.86장.

**병합 판정.** 이 CR의 PR은 필수 check green 뒤 squash 병합하고, **PR head와 병합 커밋의 main CI**에서 integration 잡의 `test:regression` 단계가 실제로 돈 것을 실측해 후속 원장 PR에서 6.86장에 적는다. 릴리스는 발행하지 않는다.

### CR-090 cascade — 검증된 레지스트리 운영 승인·R0 실행 정책 (REL-007 R2)

시작 `origin/main`은 `26e2627`(CR-089 병합 기록 뒤, main CI run `34816040697` success — verify·integration, integration 안의 `test:regression`도 실제 실행). 브랜치 `feature/rel007-registry-approval`. **이 판은 결정자가 지시한 `DEV-685` 중심의 수직이다** — 관리자가 검증된 현재 배포 정의를 승인하고, 기존 `pr.list` 실행을 차단·재개하며, 그 결정이 API와 실행기에서 실제로 지켜지는 흐름. PR Search 내부 운영 정책의 변경이며 GHE를 고치는 R1 작업을 여는 것이 아니다. **새로 실행 가능한 명령은 없다.**

**첫 계약 표 (S0·S1).**

| 낱말 | 이 판의 뜻 | 수 |
| --- | --- | --- |
| 검증 기록 | 실행기(`JOB-GH-003`)가 남긴 「어떤 바이너리·manifest를 검사했고 결과가 무엇이었나」. append-only. 이 판부터 배포 범위를 적는다 | 범위의 가장 최근 실행기 기록 하나가 승인 근거 |
| 운영 승인 | 운영자가 이 배포 범위에서 현재 적재된 정의(gh 버전·manifest 판·해시)를 R0 범위에서 쓰기로 한 DB 결정. 근거 기록·보고서 해시에 묶인다. 196개 명령의 실행 허용·사내 GHES 확인·`REL-007` 완료가 아니다 | 범위마다 0 또는 1 |
| 운영자 차단 | 실행이 열린 capability의 새 실행권을 막는 정책. manifest 분류의 `policy_blocked`와 `detail`로 가른다 | 대상 `pr.list` 1 |
| 운영 정책 revision | 범위 하나의 승인·차단 상태 번호. 변경마다 기대 revision을 대조하고 1씩 올리며 이력 한 행과 감사 한 행을 같은 트랜잭션에 남긴다 | — |
| 배포 범위 | 서버 설정 `GHE_BASE_URL`의 호스트. 클라이언트가 지정하지 않는다 | 1 (단일 호스트 형상) |
| 실행 허용 | 저장하지 않는다 — 요청마다 `decideExecution`: 기능 켜짐 ∧ 코드·manifest 실행 목록 ∧ 정책 읽기 ∧ 현재 정의의 운영 승인 ∧ 운영자 차단 없음 ∧ (대기 요청이면) 수락 revision = 현재 ∧ 레지스트리 판정 | 1 (`pr.list`) |
| 운영 승인 필요 | `admin_action_required` — 승인 없음·철회·정의 변경. HTTP 409 `GH_ADMIN_ACTION_REQUIRED` | — |
| 근거 신선도 한도 | 검사 주기 + 한 회차 최악 소요. 설정에서 계산하며 숨은 상수를 두지 않는다 | 기본 91,225,000ms |
| 실행권 확정 | 실행기의 claim(`queued` → `running`). 정책 공유 잠금을 쥔 트랜잭션에서 같은 판정을 한 뒤 하고, DB 가드 트리거가 한 번 더 본다 | — |

**구현 전에 정리한 계약 충돌 (S0 — 문서 조사 8건 외).**

| 충돌 | 정리 |
| --- | --- |
| 스냅숏은 스키마상 철회할 수 없다(`activated_at` 한 번·삭제 금지·해시당 한 행) | `activated_at`을 최초 승인 이력으로 두고, 현재 승인·철회는 별도 revision 상태(`ENT-GH-013`·`ENT-GH-014`)로 표현했다 |
| 감사 대상 정본 표에 gh 관리 액션이 없다 | SRS v2.28 FR-AUTH-004 표에 네 행(`gh_registry.approve`·`revoke`, `gh_capability.block`·`resume`) |
| 감사 실패 규칙이 best-effort(AC-6)와 선기록(FR-GH-012) 사이에서 정해지지 않았다 | 적용은 변경과 같은 트랜잭션(AC-6 예외를 SRS에 명시), 거절은 AC-6 원칙대로. `WP-075`의 원격 쓰기 규칙은 복사하지 않았다 |
| `admin_action_required`는 낱말만 있었다 | FR-GH-011 AC-6, 오류 코드 `GH_ADMIN_ACTION_REQUIRED`, W-010 상태, 용어집 |
| 역할 표에 A-005·A-006 권한이 없고 문서의 「관리자」가 역할이 아니었다 | SRS 6장: 변경은 `operator`, `security_officer`만 가진 사용자는 조회만, 두 역할이면 변경 가능. 새 역할을 만들지 않았다 |
| 릴리스 귀속이 셋으로 갈렸다(WP-059 REL-011, A-005 REL-010, 스냅숏 활성화가 REL-007을 막음) | 최소 부분만 REL-007로 당기고 나머지는 원래 릴리스에 남겼다(로드맵 4.3) |
| 「차단」이 409 `GH_CAPABILITY_NOT_EXECUTABLE`(manifest)과 403 `GH_POLICY_BLOCKED` 둘이었다 | 운영자 차단은 403 `GH_POLICY_BLOCKED`·`detail.detail = operator_blocked`, manifest 차단은 기존 409 그대로 |
| `API-GH-008`은 `PUT /gh/policies`(정책 전체 교체)에 멱등·충돌 규칙이 없었다 | 조회 `GET /gh/policies`와 행위 단위 변경 `POST /gh/policies/changes`(기대 revision·중복 방지 키·JSON 전용). 4장 상세 규격 절이 없는 기존 공백은 그대로다 |
| 활성화 주체가 「운영자가 `prs_admin`으로」였다(관리 연결은 보존 잡 전용) | `SECURITY DEFINER` 함수 하나 — `prs_app`에 EXECUTE만, search-api에 `prs_admin` 자격을 배포하지 않는다 |
| 결정 전파 수단과 대기·진행 중 실행의 처분이 없었다 | 실행기가 claim마다 DB를 다시 읽는다. 대기 요청은 과거 승인을 승계하지 않고 닫히며, 실행권을 받은 실행은 기존 수명주기로 끝난다(취소는 기존 취소 기능) |
| 운영자 재개가 `registry_stale`을 덮을 수 있었다 | 판정 순서에서 레지스트리가 차단 뒤에 여전히 본다 — 재개는 레지스트리 불일치를 풀지 않는다 |

- [x] 요구사항: **SRS v2.28** — FR-GH-011 AC-6~AC-10, FR-GH-009 AC-8, FR-AUTH-004 감사 대상 표 네 행과 AC-6 예외, 6장 역할 표와 권한 판정 규칙. PRD 5.3 안전 원칙 한 구절(운영 승인 전 실행 없음·차단·정책은 줄이기만). 용어집 여섯 행(운영 승인·운영 승인 필요·운영자 차단·운영 정책 revision·배포 범위·근거 신선도 한도). 추적 매트릭스(FR-AUTH-004·FR-GH-009·FR-GH-011).
- [x] 파생 UI: 와이어프레임(W-010 실행 판정 배너·상태, A-006 운영 승인 절, A-005 최소), 상태 매트릭스(W-010 상태 셋 + A-005·A-006 운영 정책 상태 표), QA 체크리스트 `QA-GH-47`~`QA-GH-49`, IA(A-005·A-006), 흐름(FLOW-009 판정 순서와 대기 요청 비승계), 에이전트 브리프(운영 정책 행·금지 셋·마이그레이션 번호).
- [x] API 계약: `API-GH-001`(`execution_gate`)·`API-GH-002`(미리보기 `gate`·수락 거절)·`API-GH-008`(행 교체와 운영 정책 계약 문단)·`API-GH-013`(`unsupported_report_version`)·머리 문장(운영 화면은 위임 신원 불요), 6장 오류 코드 넷 신설과 `GH_POLICY_BLOCKED`·`GH_REGISTRY_STALE`·`GH_DUPLICATE_REQUEST` 뜻 보강.
- [x] 데이터 모델: `ENT-GH-013`·`ENT-GH-014` 신설, `ENT-GH-006`(`activated_at` = 최초 운영 승인 시각, `DEV-685` 종결)·`ENT-GH-012`(`scope`·`registry_check_ms`), 3.5장 「030이 만든 것」 표, 보존 표 두 행.
- [x] 보안: 5.1 역할, DB 접속 주체 문단, 7.2 감사 실패 격리의 예외, `THR-019` 실제 상태(`DEV-691`), `THR-048`~`THR-051` 신설, 10.6 운영 정책 결정의 경계.
- [x] 비동기 9.4(`JOB-GH-001` claim 트랜잭션·닫힘 규칙, `JOB-GH-003` 범위·`lastPassedAt`·신선도), 백엔드 12.1(gh-policy 실체와 실제 수락 순서), 프런트엔드(라우트 `/ops/gh-policy`·운영 승인 절, 프록시 중복 방지 키, 9.1 옛 경로 정정 `DEV-692`), 인프라(실행기 켜기와 운영 승인, 신선도 한도·030 미적용 증상), 관측성(알림 둘, `RB-20` ⑤ 정정, `RB-25`·`RB-26` 신설), ADR-016 구현 판 한 줄.
- [x] 로드맵(REL-007·REL-010 행, 4.3 네 번째 수직과 잔여 게이트의 선행 관계 — `GATE-GH-06` 이름을 검증 계획과 같게 「쓰기 실행의 감사」로), 검증 계획(REL-007 R2 행, 10.1 R2 판정 — 통과로 바뀐 게이트 없음), 작업 패키지(`WP-080` 신설, 3장 `WP-045` 정정(`DEV-693`)·`WP-047`·`WP-048`·`WP-059`, `WP-059` 완료 기준 둘은 이 판 범위로 체크, 4장 커버리지 72), 런북(업그레이드의 최초 운영 승인, 7.C 4단계 운영 승인·차단·재개·재승인·철회와 장애 대응·롤백, 증상 표와 8장).
- [x] 구현 원장: 3장(`WP-080` 신설, `WP-045`·`WP-047`·`WP-048`·`WP-059`), 4장(`FR-AUTH-004`·`FR-GH-009` partial·`FR-GH-011`·`FR-GH-012`), 5장(`DEV-690`~`DEV-693` 신설, `DEV-685` 종결), 6.87장 검증 기록.
- [x] 독립 검토 반영(`9bb981d`)의 문서: API 계약(변경 경로의 503·500과 거절 감사 범위, 6장 `GH_POLICY_UNAVAILABLE`), 보안(7.2 예외·`THR-051`·10.6 — `queued` 새 행 가드와 `public` CREATE 전제), 데이터 모델 3.5 가드 행(파티션 복제·백업 복원), 비동기 9.4 `JOB-GH-001`(잠금 대기 초과), 관측성(알림 행·`RB-26` ⑤⑥), 런북(7.C 4단계의 권한 확인, 증상 표 두 행), 작업 패키지 `WP-080` 완료 기준, 원장 3장 행·6.87장(배터리·검토·변이 31·이미지 재검증·복원 실측).
- [x] 코드: 판정 모듈·마이그레이션 030·DB 저장소·실행기·search-api·contracts·domain·web — 목록은 작업 패키지 `WP-080` 구현 범위. CI workflow는 바꾸지 않았다(러너·트리거·잡 구조 불변).
- [x] 머리글: 이 CR이 내용을 바꾼 문서의 판을 한 번씩 올렸다. `change_control.md`와 런북은 원래 상태 머리글이 없다.
- [x] 문서 검사기 `--strict`: 편집 전(`26e2627`과 같은 문서) 종료 1 · ERROR 4(정의되지 않은 ID `FR-CSS-005`·`D-002`, 자리표시어 13+8) · WARN 2(`risks.md` 경로), 편집 후 같은 6건 — **신규 0건.** 검토 반영 편집(`bc41f2e`)과 검토 기록을 넣은 뒤에도 같다. strict 전체 통과가 아니다. 원장 6.87장에도 적는다.

**승인 범위를 넘지 않은 자리.**

| 유혹 | 하지 않은 것 | 근거 |
| --- | --- | --- |
| 운영 승인이 됐으니 `pr.view` 등 결과 계약이 있는 명령도 열기 | 실행 허용 `pr.list` 하나 그대로. 정책은 줄이기만 한다 | 지시 2장. 판정의 상한 단계와 회귀(`CR-088`·`CR-090`)가 건다 |
| 승인 버튼 하나로 끝내기 | API 수락·실행기 claim·DB 가드가 같은 결정을 지키고 실제 gh로 흐름 1~9를 보였다 | 지시 1장 |
| 기존 `activated_at`이나 이전 판의 자동 실행을 승인으로 이어받기 | 마이그레이션이 정책 행을 만들지 않는다 — 업그레이드 뒤 최초 운영 승인이 필요하다(런북) | 지시 8·14장 |
| 승인 요청 안에서 인벤토리를 추출해 근거를 새로 만들기 | 저장된 실행기 기록만 읽고, 없거나 오래됐으면 사유로 낸다 | 지시 7장 |
| 다른 배포·CI·CLI의 최신 성공을 근거로 쓰기 | 이 범위의 실행기 기록만. 과거 통과로 최신 실패를 덮지 않는다 | 지시 7장 |
| 판 번호 비교(`r2` 이상)로 해석 가능 판 정하기 | 등록된 해석기만. `r999`는 해석 불가 | 지시 7장 |
| `prs_app`에 UPDATE를 주거나 search-api에 `prs_admin`을 배포 | `SECURITY DEFINER` 함수 하나 | 지시 9장 |
| 정책 차단을 누르면 실행 중인 원격 요청까지 취소된다고 적기 | 새 실행권만 막는다고 적고 취소는 기존 기능으로 안내한다 | 지시 10장 |
| 대상이 없는 게이트(`01e`)나 내부 감사 시험으로 `06`을 통과로 적기 | 통과로 바뀐 게이트 없음, 선행 관계를 적었다 | 지시 12장 |
| 정책 검사를 대역으로 바꿔 시험을 빠르게 | 실제 검사기 기록 → 조회 → 변경 함수 → DB 함수로만 승인을 만든다 | 지시 13장 |
| 기존 flaky·열린 편차 정리 | 이번에 실제로 실패한 여섯만 고쳤다(원장 6.87장). `DEV-691`은 등록만 했다 | 지시 3·16장 |
| 정리 거절 우회 | CR-089 자원 정리는 권한 시스템의 판단을 따른다 | 지시 15장 |

**구현이 스스로 고른 것(Agent-Initiated Decisions)은 최종 보고의 별도 장에 적는다.** 무거운 것: 배포 범위를 `GHE_BASE_URL` 호스트로 · 신선도 한도를 설정에서 계산(DB 함수 인자 상한 8일) · 행 잠금 대신 advisory lock · 기대 revision 충돌과 미리보기 묶음(`evidence_changed`) · `API-GH-008`의 행위 단위 POST와 JSON 전용 · 오류 코드 넷과 키 재사용의 기존 코드 재사용 · 감사 어휘 넷과 거절 결과 코드 다섯 · 대기 요청의 닫힘 규칙(정책 사유는 `policy_blocked`, 레지스트리 사유는 `failed`, 정책 읽기 실패는 남김) · claim 가드 트리거와 그로 인한 옛 앱 Operations 경로 비호환 · 검증 기록 `scope`의 NOT VALID CHECK · `activated_at`을 최초 승인 시각으로 · 같은 스냅숏 재승인 거절 · API 수락의 레지스트리 판정은 신선도를 보지 않고 실행기 claim이 본다 · 인증 없는 배포의 버튼 표시 · 프록시 헤더 정정 · CSRF 토큰 미도입과 JSON 전용 보완 · 새 통합 시험의 DB 정리 · 검토 반영의 처분(새 실행 기록은 `queued`만, 잠금 대기 초과는 실행기에서 남기고 변경에서는 503·감사 없음, 적용 뒤 재조회 실패는 500 유지, 알 수 없는 행위의 거절은 감사하지 않고 문서를 좁힘, SQL에 pin 상수를 두지 않음, 운영 DB의 `public` CREATE 확인을 런북에 둠).

**독립 검토 두 관점과 재검토, 문서 cascade 독립 검토.** 원장 6.87장 — 두 관점은 1차 blocker·major 0(minor 넷은 반영하거나 근거와 함께 문서로 정리), 재검토 새 blocker·major·minor 0. 문서 cascade 검토는 blocker·major·minor 0, nit 1 반영.

**병합 판정.** 이 CR의 PR은 필수 check green과 독립 검토의 blocker·major 해소 뒤 squash 병합하고, **PR head와 병합 커밋의 main CI**를 실측해 후속 원장 PR에서 6.87장에 적는다. 릴리스·태그는 발행하지 않는다. 사내 반입과 실제 GHES 시험은 `NOT RUN`이다.
