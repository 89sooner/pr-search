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
유형: `scope`(범위 변경), `design`(설계 변경), `implementation`(구현 편차 DEV-### 처리), `correction`(문서 오류 수정)

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

**SRS는 건드리지 않았다.** FR-ING-007이 요구하는 결과(격리·재처리·보류·경보)는 그대로다. 달라지는 것은 그것을 강제하는 수단(유일 제약)과 실행 주체(WP-019 이전에는 `ops`), 그리고 성공을 판정하는 자리뿐이다. **CR-010·CR-011과 섞지 않았다** — 둘은 보강·투영의 전방 계약을 고쳤고 CR-012는 그 두 단계가 실패했을 때의 후방 계약을 고친다.

## 6. 미결 항목

CR-004 종료 시점의 미결 항목이다. 각각 별도 CR로 처리한다. 취소선 항목은 해소된 이력이다.

| 항목 | 유형 | 차단 대상 | 담당 |
| --- | --- | --- | --- |
| ~~`srs_final.md` `baseline` 승인~~ | ~~사용자 결정~~ | 해소 (2026-08-19, CR-003) | 사용자 |
| ~~OD-003 원본 이벤트 보존 기간~~ | ~~오픈 결정~~ | 해소 (2026-08-19, CR-004 — 3년 보존, `raw_event` 계획 용량 4TB) | 사용자 |
| ~~OD-006 ES 클러스터 형태~~ | ~~오픈 결정~~ | 해소 (2026-08-19, CR-004 — 전용 클러스터 3노드 / 컨테이너 3개 / 복제본 1) | 사용자 |
| ~~OD-007 저장소·PR 규모~~ | ~~오픈 결정~~ | 해소 (2026-08-19, CR-004 — 워크로드 기준선 1,000 PR/일) | 사용자 |
| OD-001 미러 클론 허용 | 오픈 결정 | 차단 없음 (두 경로 구현) | Security + Platform |
| OD-002 권한 판정 소스 | 오픈 결정 | 차단 없음 | Security |
| OD-004 릴리스 앵커 소스 | 오픈 결정 | 차단 없음 (Git 태그로 진행) | Release Eng |
| OD-005 nori 플러그인 | 오픈 결정 | 차단 없음 (대체 분석기) | Platform |
| OD-008 안전 구간 표식 권한 범위 | 오픈 결정 | REL-006 WP-041 | Release Eng |
