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

| CR-039 | 2026-08-26 | correction | WP-029 착수 전 참조 간선 계약 감사에서 확인된 DEV-215~229 | **지금 계약대로 구현하면 간선은 한 번 만들어지고 그 뒤로 영원히 어긋난다.** 열다섯 중 다섯이 같은 뿌리다 — 계약이 **"만든다"만 말하고 "다시 만든다"를 말하지 않는다.** 참조는 본문에서 파생되는데 본문은 수정되고, 대상은 나중에 색인되며, 과거 데이터는 이벤트를 남기지 않았다. 제품 범위를 넓히지 않고 이미 승인된 FR-REL-003을 실제로 성립시킨다. **SRS는 v2.5 유지.** (1) **직접 푸시 커밋은 참조 파생에 도달하지 않는다.** JOB-REL-001·JOB-REL-005의 방아쇠가 `EVT-ING-003` 하나인데, 그 이벤트는 `project` 워커가 색인한 문서마다 낸다. WP-067이 새로 만드는 직접 푸시 커밋 문서는 그 경로를 지나지 않고 `commit-enrich`가 만든다 — 그 파일에는 `bus.subscribe`가 하나 있고 **`bus.publish`가 하나도 없다.** CR-038이 DEV-206에서 잡은 것과 **정확히 같은 모양이 한 홉 아래에 남아 있었다.** `EVT-ING-005 commit.metadata_ready`를 신설해 정본·색인이 모두 성공한 뒤에만 낸다. payload는 bounded 식별자뿐이고 메시지 본문을 버스에 다시 싣지 않는다 — link 워커가 `commit_snapshot`에서 읽는다 (DEV-215). (2) **그 이벤트를 `prs:projected`에 실으면 되먹임이 생긴다.** `commit-enrich`가 그 토픽을 `link:commit-enrich` 그룹으로 읽고 있어 자기가 낸 이벤트를 자기가 받는다. 토픽을 새로 만들지 않고 **`event_name`으로 가른다** — 각 소비자가 자기 입력 이벤트만 처리하고, 보강은 metadata-ready를 받아 metadata-ready를 다시 내지 않는다. 되먹임 없음을 시험으로 건다 (DEV-216). (3) **`link_id`가 가변 `to_id`를 포함해 AC-3과 충돌한다.** 규칙은 세 곳에 같은 문장으로 적혀 있다 — 데이터 모델 4.3, `packages/es/src/mappings/links.ts`, `packages/domain/src/entities.ts`. `Refs: abc1234`가 미해결로 저장된 뒤 대상이 색인되면 `to_id`가 축약 SHA에서 40자 SHA로 바뀌고 **`link_id`가 함께 바뀐다.** 그러면 미해결 간선과 해결된 간선이 **둘 다 남는다** — AC-3(같은 간선을 갱신)·멱등·결정론적 ID 셋이 한 번에 깨진다. `references` 간선에 **해결 대상과 독립인 안정 식별자 `reference_key`**를 둔다. 원문 문자열이 아니라 **정규화된 locator**이며, 대상이 해결돼도 바뀌지 않는다. 안정 ID는 `link_type` + source identity + `reference_key`로 만든다 (DEV-217). (4) **커밋 매핑에 `links_pending`이 없다.** FR-REL-003의 예외 처리는 "추출 실패는 색인을 막지 않고 문서에 `links_pending: true`를 표시한다"인데, 요구사항이 PR **또는 커밋**을 대상으로 하면서 커밋 매핑에는 그 필드가 선언되어 있지 않다. 매핑이 `strict`라 표시 자체가 THR-010으로 거부된다 — 즉 커밋에 대해서는 승인된 예외 처리를 **표현할 수단이 없다** (DEV-218). (5) **커밋 매핑 `link_summary`에 `reference_count`가 없다.** PR 매핑에는 있다. 커밋 상세(W-003)가 참조 수를 간선 인덱스 조회 없이 그릴 수 없다 (DEV-219). (6) **본문에서 사라진 참조를 지울 계약이 없다.** 계약은 "추출하여 간선을 생성한다"까지다. PR 본문이 `Refs: #10`에서 `Refs: #20`으로 바뀌면 `#20`이 생기지만 **`#10`이 그대로 남는다.** 한 source의 references 간선은 **완전한 파생 집합**으로 취급한다 — 정본에서 완전한 집합을 다시 만들고, 없어진 것은 제거하는 reconcile이다. 단 **추출이 실패한 회차는 제거를 하지 않는다**: 부분 결과를 완전한 결과로 확정하면 멀쩡한 간선이 사라진다 (DEV-220). (7) **과거 엔티티에 간선을 만들 경로가 없다.** 새 `link` consumer group은 Redis stream을 `0`부터 읽을 수 있지만 **stream retention은 정본이 아니고**, 직접 푸시 커밋에는 애초에 `EVT-ING-003`이 없었다. 배포 뒤 "새 이벤트부터만 관계가 생김"이 운영 구멍으로 남는다 — CR-037이 DEV-194에서 PR 스냅숏 축에 대해 이미 겪은 자리다. 이미 카탈로그에 있는 **JOB-REL-006(관계 전량 재파생)**을 references subset에 대해 실제로 실행 가능하게 만든다. 두 번째 추출 알고리즘을 만들지 않는다 (DEV-221). (8) **`link_summary`의 필드별 소유자가 없고 부분 갱신 수단도 없다.** 매핑에는 다섯 leaf가 있고 그중 넷이 WP-030 것이다. 그런데 `bulkUpsert`의 조건부 스크립트는 `ctx._source[key] = value`로 **객체를 통째 대입**하므로, WP-029가 `link_summary`를 그대로 쓰면 WP-030이 써 둔 값을 지운다. leaf 단위로 대입하는 전용 경로를 둔다 — CR-038의 `COMMIT_METADATA_SCRIPT`가 같은 이유로 만든 선례다. WP-029가 소유하는 leaf는 **`reference_count` 하나**다 (DEV-222). (9) **`to_repository_id`·`detached`를 누가 채우는지 정의되어 있지 않다.** 매핑에는 선언되어 있다. `to_repository_id`는 WP-029(대상 저장소가 해석된 시점), `detached`는 WP-030으로 명시한다. WP-029가 `detached: false`를 기계적으로 채워 미래 필드를 선점하지 않는다 — `strict` 매핑에서 값을 두지 않는 것과 `false`를 두는 것은 다른 주장이다 (DEV-223). (10) **저장소를 건너뛰는 참조의 접근 통제 경계가 문서에 없다.** `acme/a`의 PR이 `acme/b#20`을 참조하면 간선은 a의 접근 범위로 저장된다 — 그것이 맞다(근거를 소유한 저장소가 a다). 그러나 그 간선이 `to_repository_id: b`를 들고 있으므로, **관계 조회 API(WP-031)가 대상의 제목·본문을 함께 반환하면 b를 볼 수 없는 사용자에게 b의 내용이 샌다.** WP-029는 조회 API를 만들지 않으므로 지금 유출은 없지만, **경계를 지금 적어 두지 않으면 WP-031이 그것을 모른 채 만든다** — CR-036이 WP-068에서 겪은 것과 같은 종류다. THR-034~036을 신설한다 (DEV-224). (11) **`@prs/domain`의 관계 타입 셋이 실제 매핑과 어긋난다.** `LinkSummary`는 `reverted_by_count`를 선언하는데 매핑에는 없고, 매핑의 `is_reverted`·`has_stack`은 타입에 없다. `CommitRole`은 `'merge' | 'original'`인데 실제 값은 `merge_commit`·`source_commit`·`direct_push`이며 — `documents.ts`가 **자기 `CommitRole`을 따로 정의해 쓰고 있어** 타입 검사가 그 드리프트를 잡지 못했다. `Link`에는 접근 통제 필드 넷과 `to_repository_id`·`detached`·`created_at`이 없다. 제품 의미에 필요한 만큼만 맞춘다 — ES 구현 detail을 전부 복사하지 않는다 (DEV-225). (12) **ADR-009 자신이 구현과 어긋난다.** Decision 블록의 간선 문서 구조에 `direction`이 있으나 매핑에 없고, 접근 통제 필드 넷과 `to_repository_id`·`detached`가 없다. `link_summary` 목록도 `reverted_by_count`를 적는다. 기존 결정을 뒤집는 것이 아니라 **적힌 것을 구현된 것에 맞추는 정정**이므로 새 ADR을 만들지 않고 ADR-009를 개정한다. `reference_key`는 ADR-009가 이미 결정한 "미해결 참조를 간선 1건 갱신으로 해결한다"를 **성립시키는 수단**이지 다른 결정이 아니다 (DEV-226). (13) **`link` 모듈이 API-REL-001~004 전체를 소유한다고 적혀 있으나 사실이 아니다.** API-REL-001(`/sequence-neighbors`)은 WP-027이 `sequence` 경로로, API-REL-002(`/containments`)는 WP-024가 릴리스 경로로 이미 구현했다. 문서가 초기 설계를 계속 사실처럼 말하면 다음 WP가 그것을 근거로 잘못된 자리에 코드를 넣는다 (DEV-227). (14) **`retry` 처분에 재시도 예산을 집행하는 주체가 없다.** 잡 카탈로그는 JOB-REL-001·005의 재시도를 3회로 적지만, Redis·in-memory 두 어댑터 모두 `retry`를 받으면 백오프만 늘리고 **횟수 상한을 보지 않는다.** 예산은 핸들러가 `delivery_count`로 집행하는 것이 이 저장소의 실제 관용구다(`authz.ts`가 그렇게 한다). 계약에 그 사실을 명시한다. **그리고 `release.ts`의 JOB-REL-007이 실제로 그 상태다** — 영구 실패가 무한 재시도되며 파티션을 막는다. PR #30의 P1 지적이 미해결로 남아 있었고 재실측으로 확인했다. 같은 함정을 link 핸들러에 다시 파지 않기 위해 계약과 기존 결함을 함께 고친다 (DEV-228). (15) **`pr_search_work_packages.md` 헤더가 `v0.3 / 2026-08-20`에 멈춰 있다.** 내용은 2026-08-26까지 갱신됐다. 상태표를 근거로 판단하는 후속 에이전트가 문서가 낡았다고 오판한다 (DEV-229). | DEV-215, DEV-216, DEV-217, DEV-218, DEV-219, DEV-220, DEV-221, DEV-222, DEV-223, DEV-224, DEV-225, DEV-226, DEV-227, DEV-228, DEV-229, FR-REL-003, JOB-REL-001, JOB-REL-005, JOB-REL-006, JOB-REL-007, EVT-ING-003, EVT-ING-005, ENT-REL-002, ENT-CORE-003, API-REL-001, API-REL-002, ADR-004, ADR-008, ADR-009, THR-034, THR-035, THR-036, WP-029 | 데이터 모델, 비동기·잡 카탈로그, ADR, 백엔드 아키텍처, 보안·프라이버시, 작업 패키지, 원장 | open |
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
| OD-005 nori 플러그인 | 오픈 결정 | 차단 없음 (대체 분석기). **기한 REL-004 착수 전 — 아직 오지 않았다** | Platform |
| OD-008 안전 구간 표식 권한 범위 | 오픈 결정 | REL-006 WP-041. **기한 REL-006 착수 전 — 아직 오지 않았다** | Release Eng |
