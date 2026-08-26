# PR Search 구현 추적 원장

> 상태: review | 버전: v2.9 | 갱신일: 2026-08-26

## 1. 목적

구현이 시작된 후 문서와 코드의 정합성을 유지하는 살아있는 원장이다. 코딩 에이전트는 WP를 완료할 때마다 이 문서를 갱신한다. 이 문서는 기록용이며 범위를 결정하지 않는다.

**현재 상태: WP-020까지 완료 — REL-001과 REL-002가 닫혔고 REL-003의 첫 WP(커밋 그래프 접근 계층)가 들어갔다.** 워크스페이스 골격, PostgreSQL 스키마·리포지터리 계층, Elasticsearch 매핑·부트스트랩, GHE 웹훅 수신 게이트웨이, `EventBus` 포트와 Redis Streams 어댑터, GHE REST 클라이언트, 보강 워커, 그리고 **투영 워커**가 서 있다. 단위 953건·통합 419건이 전부 통과한다(CI 기준). **수집 경로가 웹훅에서 검색 인덱스까지 닫혔다** — 서명 검증 → `raw_event` 저장 → `prs:ingest` 발행 → NDJSON 아카이브 → 202, 그 뒤를 `enrich`가 받아 원본 커밋·변경 파일·리뷰를 채워 `EVT-ING-002`로 넘기고, `project`가 그것만 읽어 PR·커밋 문서를 만들어 Elasticsearch에 조건부 업서트한 뒤 `raw_event.processed_at`을 찍고 `EVT-ING-003`을 낸다. 오래된 이벤트는 새 상태를 덮지 않고, 커밋의 PR 소속은 순서와 무관하게 합집합으로 쌓인다. 이 환경에서 처음으로 실제 Elasticsearch(`mirror.gcr.io` 경유 8.19.0)를 띄워 ES 통합 시험을 돌렸고, 그 과정에서 WP-003의 별칭 라우팅 결함(DEV-021)을 찾아 고쳤다. 실제 GitHub App 자격 증명이 없어 real-GHE smoke는 여전히 미실행이다(선택 시험으로 남겨 두었고 건너뛴 사실이 실행 로그에 남는다). 여기에 **저장소 등록 API**가 더해져 수집 대상을 정식으로 등록·해제할 수 있고, **파이프라인 상태 API**가 수신량·대기열·지연·실패 대기열을 한 번에 보여 준다. **실패 대기열 관리 API**도 있어 격리된 이벤트를 보고 다시 흘려보낼 수 있다 — 한 (전달, 단계)에 행 하나로 누적되고, 3회 재처리 실패면 `held`, 끝까지 성공하면 투영이 `resolved`로 닫는다. 여기에 **구조화 질의 파서**가 더해져 `key:value` 질의가 AST가 되고, **검색 API**가 그 AST를 읽어 접근 범위 필터를 강제한 채 조회하며, **식별자 해석 API**가 SHA·PR 번호를 양방향으로 잇는다. **웹 셸과 화면 넷**(`/`·`/search`·`/pr/...`·`/commit/...`)이 서서 FLOW-002 전 경로가 실제 브라우저에서 이어지고, **저장소 백필 잡**이 과거 PR·커밋을 채운다. **커밋 그래프 접근 계층**(WP-020)이 first-parent 체인을 미러 또는 API로 내주므로 채번이 딛고 설 바닥은 생겼다. 그러나 **채번(WP-021) 자체와 관계 파생(WP-029)은 아직 없다** — 그래서 시퀀스와 관계 배지가 화면에서 `not_computed`로 남는다. 이 제품의 핵심인 머지 시퀀스는 **WP-021에서 실재하게 되었다** — 채번이 `git rev-list --first-parent --reverse`가 낸 순서를 그대로 옮기고, 회귀 계층(`pnpm test:regression`)이 매 실행마다 그것을 git과 대조한다. 병합 커밋은 하나로 세고 직접 푸시도 서수를 받으며, 히스토리 재작성은 **감지 즉시 에폭을 올려 재채번되고**(WP-022), 이전 에폭 인용은 조회의 에폭 비교로 `epoch_stale`이 된다. **여기에 CR-024가 기한이 지난 결정 셋(OD-001·OD-002·OD-004)과 구현이 드러낸 미결 넷을 닫았다** — 미러는 허용하되 blob 지연 인출은 기본 차단, 권한 원천은 GHE 협업자/팀 API, 릴리스 앵커는 Git 태그만이다. 그 과정에서 **`allowed_team_ids`를 읽는 곳은 넷인데 쓰는 곳이 없다는 사실**을 찾아 DEV-114로 등록했다 — 통합 시험이 그 필드를 손으로 심어 초록을 내고 있었다.

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
| WP-010 | 저장소 등록 API와 파이프라인 지표 | REL-001 | done | 에이전트 | `c99cff6` / PR #11 | DoD 6항 전부 통과. 단위 214건·통합 230건 전량 (6.10장) | CR-013이 정한 커밋 문서 표식·지표 출처 분리·이름 붙은 토큰을 함께 구현했다. 세 앱의 지표 모듈을 `@prs/metrics`로 합쳤다. 단계별 지연은 지표 저장소가 설정된 경우에만 채운다(DEV-029). k8s 매니페스트는 작성했으나 **클러스터에 적용해 보지 못했다** — 이 환경에 Kubernetes가 없다 |
| WP-011 | 구조화 질의 파서 | REL-002 | done | 에이전트 | `8183bf5` / PR #13 | DoD 7항 전부 통과. 단위 88건 (6.11장) | CR-014가 메운 빈칸(부정된 범위·값 검증 경계·범위 키·오류 판정 주체)을 함께 구현했다. AST를 ES 질의로 옮기는 것은 WP-013이다 |
| WP-012 | 인증과 접근 범위 강제 | REL-002 | done | 에이전트 | `e9b2e38` / PR #14 | DoD 10항 중 9항 통과, 1항 부분 (6.12장). 단위 175건 + 통합 47건 | CR-015가 메운 빈칸(신원 표현·무효화 대상 산출·경합 순서·역할 합성)을 함께 구현했다. OIDC 라우트는 `web`이 소유하므로 WP-015가 붙인다 — 이 WP는 라이브러리와 `search-api` 강제를 세운다. 구현 중 DEV-050(해소)·DEV-051(미해소)을 등록했다 |
| WP-013 | 검색 API 목록 조회 | REL-002 | done | 에이전트 | `a68a2db` / PR #15 | DoD 7항 중 6항 통과, 1항 **NOT RUN** (6.13장). 단위 66건 + 통합 46건 | CR-016이 메운 빈칸(키→필드 표·파생 상태·다중 인덱스 정렬·완화 힌트 산출·응답 키 유무)을 함께 구현했다. NFR-001의 p95 500ms는 1000만 문서 데이터셋과 부하 harness가 없어 **측정하지 않았다**(DEV-058) — REL-002 성능 게이트로 넘긴다. 구현 중 DEV-059(해소)를 등록했다. 패싯·커서·전문 검색은 WP-032 |
| WP-014 | 식별자 해석 API | REL-002 | done | 에이전트 | `7b2c960` / PR #16 | DoD 6항 중 4항 통과, 1항 부분, 1항 **NOT RUN** (6.14장). 단위 61건 + 통합 53건 | CR-017이 메운 빈칸(채워지지 않는 필드 처리·호스트 비교·릴리스 태그·정수와 SHA 접두의 겹침)을 함께 구현했다. **QA-W003-03(`direct_push`)은 도달 불가**라 통과하지 못했다(DEV-061) — push 이벤트 라우팅이 서는 WP-021의 몫이다. NFR-001의 단건 p95는 데이터셋이 없어 **측정하지 않았다**(DEV-058) |
| WP-015 | 웹 앱 셸과 Conductor 통합 | REL-002 | done | 에이전트 | `d74cfde` / PR #17 | DoD 6항 중 4항 통과, 2항 부분 (6.15장). 단위 32건 + a11y 24건 + e2e 15건, axe 위반 0건, `checkContrast` 80쌍 중 0건 실패 | CR-018이 메운 빈칸(프록시 신원 전달·클라이언트 import 경계·harness·단축키 슬롯·OIDC 왕복 상태)을 함께 구현했다. **DEV-032/DEV-069가 여기서 닫힌다** — `pnpm test:a11y`·`test:e2e`가 저장소에 생겼고 WP 20곳이 그 이름을 참조한다. 구현 중 **DEV-073(좁은 화면에서 내비게이션 도달 불가)**과 **DEV-074(프록시 세션 판정의 시험 공백)**을 스스로 발견해 등록·해소했다. 화면은 만들지 않는다(WP-016 이후) — QA-COMMON-01·09·14는 셸이 소유한 부분까지만 검증했다 |
| WP-016 | W-001 통합 검색 화면 | REL-002 | done | 에이전트 | `8335ea5` / PR #18 | DoD 6항 중 5항 통과, 1항 부분 (6.16장). 단위 32건 + a11y 62건 + e2e 26건, axe 위반 0건 | CR-019가 메운 빈칸(QA 항목 이중 배정·패싯 세 상태·시퀀스 미채번·`from_q`·최근 검색 출처·해석 상한·관계 배지 소유권)을 함께 구현했다. **상태 매트릭스 13종 전부**가 렌더링되고 각각 시험이 있다. `QA-W001-14`는 CR-019 DEV-075대로 **절반만** — "페이지 번호 UI 없음"은 통과, "커서 기반 동작"은 WP-032다. 구현 중 결함 셋을 스스로 잡았다: 붙여넣은 GHE URL이 전문 검색으로 떨어지던 것, QA-COMMON-16 검사의 거짓 경보, Conductor 규칙 위반 2건 |
| WP-017 | W-002 PR 상세 화면 | REL-002 | done | 에이전트 | `fe3e9f6` / PR #19 | DoD 6항 중 4항 통과, 2항 부분 (6.17장). 단위 42건 + a11y 34건 + e2e 13건, axe 위반 0건 | CR-020이 메운 빈칸(커밋 총계·타임라인 네 상태·리뷰 상태 둘·GHE 링크 널 허용·`epoch_stale` 미구현·확장 조회 절반)을 함께 구현했다. `QA-W002-03`·`QA-W002-17`은 CR-020 DEV-082·088대로 **절반만** — 절삭 표시와 "확장 전 조회 금지"는 통과, 전체 건수는 WP-020, 확장 조회는 WP-031이다. 구현 중 **DEV-089(보관·파일 절삭을 어느 화면도 표시하지 않는다)**를 스스로 발견해 등록·해소했다. 변이 시험 48종 전부가 잡혔고, 그 과정에서 **시험 구멍 6개**를 찾아 메웠다 |
| WP-018 | W-003 커밋 상세 화면 | REL-002 | done | 에이전트 | `c5a9ae0` / PR #20 | DoD 4항 중 3항 통과, 1항 부분 (6.18장). 단위 47건 + a11y 34건 + e2e 14건, axe 위반 0건 | CR-021이 메운 빈칸(헤더 메타데이터·머지 커밋 링크 재료·체인 밖 판정·직접 푸시 도달 불가·경로 총계 널 허용·보강 의미·복사 실패)을 함께 구현했다. `QA-W003-03`은 CR-021 DEV-093대로 **절반만** — "PR 없을 때 사유 표시"는 통과, "직접 푸시로 표시"는 WP-021이다. **WP-017이 넘긴 세션 관문 통합을 여기서 했다** — 라우트 넷이 `GuardedPage` 하나를 지난다. 구현 중 **DEV-097(FLOW-001 4단계 미구현 — W-001이 후보 1건에서 영원히 멈춘다)**을 발견해 등록·해소했다 |
| WP-019 | 저장소 백필 잡 | REL-002 | done | 에이전트 | `07f1cfe` / PR #21 | DoD 6항 중 4항 통과, 1항 부분, 1항 **NOT RUN** (6.19장). 단위 31건 + 통합 39건 (CI 32파일 419건 전부 통과) | CR-022가 메운 빈칸(PR 목록 메서드 부재·문서 버전·합성 델리버리 ID·실행 경로·동시 실행 상한·`/admin/jobs` 부재·한도 대기 상태·설정 복원 책임)을 함께 구현했다. **AC-5가 분기가 아니라 수의 대소로 성립한다** — 백필의 버전이 엔티티 `updated_at`이라 조건부 업서트가 저절로 거절한다. **이 환경에 Docker가 없어 통합 시험을 로컬에서 돌리지 못했다** — DoD 6항 중 5항이 그 시험에 걸려 있어 **CI가 처음 판정한다** |
| WP-020 | 커밋 그래프 접근 계층 | REL-003 | done | 에이전트 | `61b9a98` / PR #23 | DoD 5항 전부 통과 (6.20장). 단위 36건 + 통합 24건, **실제 git 픽스처로 `git rev-list --first-parent --reverse`와 직접 대조** | CR-023이 메운 빈칸(저장소 컨텍스트·미러 루트·git 자격 증명·워커 역할)과 **실측으로 드러난 ADR-005의 대가**(DEV-111). OD-001 결정 전이라 두 경로 모두 구현했다. 커밋 메타데이터 채우기는 뺐다(DEV-112) |
| WP-021 | 시퀀스 증분 채번 | REL-003 | done | 에이전트 | `60c0aa1` / PR #25 | DoD 8항 전부 통과 (6.21장). 단위 44건 + 통합 24건 + 회귀 5건 + ES 통합 10건(CI). **실제 git 픽스처로 `git rev-list --first-parent --reverse`와 직접 대조** | **이 제품의 핵심 주장이 여기서 실재한다.** CR-025가 메운 빈칸 여섯(커밋 시각 출처·push 트리거 부재·`requeueLater`·PR 번호 출처·`sequence_space` 오용·회귀 계층 부재)과, 시험이 잡아낸 내 결함 둘(DEV-122 첫 실패가 조용함, DEV-123 접근 범위 우회). 재채번은 감지만 하고 WP-022로 넘긴다 |
| WP-067 | 커밋 메타데이터 보강 (JOB-MIR-002) | REL-003 | done | 에이전트 | PR #42 | DoD 15항 전부 통과 (6.33장). 통합 37건(실 git·PG·ES·Redis) + 단위 6건 + 회귀 6건. 변이 9종 전부 킬 | **CR-024 신설, CR-038 구현.** WP-020이 남긴 빈칸(DEV-112)의 주인 — **DEV-112 해소.** 착수 전 감사가 계약의 구조적 공백 다섯을 찾아 이 WP의 성격을 바꿨다(DEV-205~214): 원래 계약대로 "기존 문서 부분 갱신만" 하면 코드는 늘고 사용자에게 보이는 것은 하나도 달라지지 않는다. 논리 소비자 그룹 신설(DEV-205), 방아쇠를 `sequence.assigned`까지 넓혀 **직접 푸시 커밋 문서를 만들고**(DEV-206), 마이그레이션 013 `commit_snapshot`으로 ADR-004를 커밋 축에서 지키며(DEV-208), 커밋 상세·`source_commits`·선행·후행을 실제 메타데이터와 연결했다(DEV-210~212). 미러 역할 배포 manifest를 신설했다 — 없어서 이 잡이 배포에 도달할 수 없었다(DEV-214). 실제 GHE·Kubernetes는 NOT RUN |
| WP-068 | 저장소 팀 접근 범위 채우기 | REL-003 | done | 에이전트 | PR #39 (병합 `b55b275`) + CR-036 | DoD 5항 전부 통과 (6.30장). 통합 19건(정본·동기화 10 + **실제 ES** 9) + 회귀 4건. 변이 3종 처리 | **CR-024 신설, CR-035 구현.** 네 매핑이 `allowed_team_ids`를 선언하고 강제 필터가 읽는데 그 값을 만드는 자리가 없었다 — **DEV-114 해소.** 마이그레이션 011, GHE `listRepositoryTeams` 신설(DEV-185), `team` 표 채움(DEV-186), 소급 적용을 `permission.invalidated` 소비자에 얹음(DEV-187). **소급 대상이 네 색인 전부**임을 구현 중 확인했다. **머지 후 Codex 리뷰 3건(P1 둘·P2 하나)이 전부 실결함이었고 그중 하나는 접근 범위 유출이었다** — CR-036으로 정정했다(DEV-188~190, 6.30.1장) |
| WP-022 | 시퀀스 재채번과 에폭 | REL-003 | done | 에이전트 | `2adc9dd` / PR #27 | DoD 7항 전부 통과 (6.22장). 통합 12건 + ES 통합 3건(CI) + 회귀 3건. 변이 6종 전부 잡힘 | CR-026이 메운 빈칸 여섯(복사·서수 조회 함수 부재, 체인 밖 merge-base, 표식 무효화 수단 부재, 알림 어댑터 부재, 잡 유형 불일치, ES 에폭 반영). **AC-4는 저장 시점 쓰기가 아니라 에폭 비교다.** 수동 재채번 API는 WP-028 몫 |
| WP-023 | 앵커 정규화와 범위 조회 API | REL-003 | done | 에이전트 | PR #28 | DoD 8항 중 7항 통과, p95는 PostgreSQL 구간만 실측 (6.23장). 단위 41건 + 통합 62건 + 실ES 13건(CI) + git 대조 회귀 14건. 변이 30종 전부 잡힘 | CR-027이 정본을 PostgreSQL로 정정(DEV-130) — 멤버십·건수는 `merge_sequence`, 표시·요약은 ES. 색인에 없는 항목은 `items_missing_in_index`로 드러낸다. 릴리스 태그 앵커는 WP-024로, `reverted_pull_request_count`는 WP-030으로 이월 |
| WP-024 | 릴리스 수집과 포함 관계 | REL-003 | done | 에이전트 | `3dc572e` / PR #29 | DoD 7항 전부 통과 (6.24장). 단위 54건 + 통합 39건 + git 대조 회귀 5건 + 실ES 10건(CI). 변이 12종: 로컬 킬 11, 실-ES 전용 킬 1(M11, CI가 판정) | CR-028이 정본을 PostgreSQL `release` 표로 정정(DEV-142)하고 미러가 태그를 갱신함을 실측(DEV-143). 갱신은 이벤트 payload 없는 신호 + 전량 diff(EVT-REL-001) — 순서 역전이 스냅숏을 되돌릴 수 없다. 매핑 결함 둘(릴리스 `document_version`·커밋 `unreleased` 부재)을 실-ES 계층 작성 중 발견해 고쳤다. WP-023 이월분(릴리스 앵커, DEV-132)을 해석으로 교체했다 |
| WP-025 | W-004 범위 조사 화면 | REL-003 | done | 에이전트 | `df3e899` / PR #31 | DoD 6항 전부 통과 (6.25장). 단위 25건 + a11y 18건 + e2e 4건 + API 통합 4건. 변이 7종 전부 킬 | CR-029가 계약 다섯을 정정(DEV-150~154): 시퀀스 공간 목록 API-SEQ-006 신설, 경로 `/ranges` 통일, 되돌림 수·상태 매트릭스·C-013 재사용의 분할. 에폭 불일치는 경고+수동 재조회(QA-W004-21), 5만 사전 판정은 앵커 서수 차 계산(QA-W004-08). 표식(WP-041)·이분(WP-042)·패싯 데이터(WP-032)는 골격만 |
| WP-026 | W-005 릴리스 화면과 구간 비교 | REL-003 | done | 에이전트 | `6461e05`(API)·`4aa2d93`(화면) / PR #32 | DoD 9항 중 8항 통과, QA-W005-05는 절반 (6.26장). 단위 25건 + a11y 21건 + e2e 4건 + API 통합 24건. 변이 9종 처리 | CR-030이 계약 다섯을 정정(DEV-155~159): 릴리스 목록 API-REL-005 신설, API-SEQ-003 재작성, 경로 `/releases` 통일, 목록을 저장소 스코프로, 빈 상태 병합. 구현 중 **DEV-160**(포함 판정이 저장 서수를 읽어 배포된 PR이 미배포로 보이던 결함)을 등록·해소했다. W-009 링크는 REL-004~005로 이월 |
| WP-027 | 선행·후행 조회와 상세 화면 통합 | REL-003 | done | 에이전트 | `29d29d6`(CR-031)·`9aef48e`(API)·`594fa94`(화면) / PR #33 (병합 `bc0e931`) + `e514bfe`·`394854a` / PR #34 (병합 `1d0dee2`, CR-032) | DoD 10항 전부 통과 (6.27장). 단위 15건 + a11y 12건 + e2e 4건 + API 통합 20건. 변이 8종 처리 | CR-031이 계약 일곱을 정정(DEV-161~167)했고 그중 하나는 **SRS 문장 자체**였다(v2.4 — 직접 푸시 커밋 포함). 커밋 앵커 신설, 확장 조회 통일, 409 사유 분리, `indexed`·`url` 추가, 범위 확장 앵커 확정, QA-W002-16(에폭 경고)의 DEV-087 이월 종결. **머지 후 Codex 리뷰 3건이 실결함으로 확인돼 CR-032로 정정했다**(DEV-168~170: 공간 판별자 `base_branch` 필수화, `merged_at` 경계, 실패 재시도) — 검증 기록은 6.27.1장 |
| WP-028 | 정합성 점검과 조정 스캔 | REL-003 | done | 에이전트 | `b9d3b1c`·`4d192b2`·`f9df507` / PR #35 (병합 `4b954d1`) + `223e84d`·`e363b97`·`97d0637` / PR #37 (병합 `a620899`) | DoD 18항 전부 통과 (6.28장). 단위 57건 + API 통합 20건 + 마이그레이션 통합 5건. 결함 재적용 9종 처리 | CR-033이 계약 여섯을 정정(DEV-171~176)했고 그중 하나는 **SRS 문장 자체**였다(v2.5 — 점검 실패가 시퀀스 공간 상태를 바꾸지 않는다). DEV-128을 마이그레이션 009로 해소. `affected_saved_search_count`를 파서 기반으로 확정, JOB-ING-008 유지·DoD 신설, GHE 클라이언트 `direction` 옵션 신설. **실제 알림 발송은 REL-005로 이월**(DEV-176). **머지 후 Codex 리뷰 5건 + 추가 감사 3건이 전부 실결함이었고, 그중 넷은 선언한 기능이 배포에서 아예 실행되지 않는 것이었다** — CR-034로 정정 중이다(DEV-177~184). CR-034(PR #37, 병합 `a620899`)가 그 여덟을 정정하고 **운영 도달성 표의 일곱 기능이 모두 선언 → 기동 → 종료 → 배포로 이어지는 것을 확인해** `done`으로 복귀했다 (6.28.1장). 배포 manifest는 정적 검증까지이며 실제 Kubernetes 적용은 NOT RUN이다 |
| WP-029 | 관계 간선 인덱스와 참조 추출 | REL-004 | done | 에이전트 | PR #44 | DoD 16항 전부 통과 (6.34장). 통합 37건(실 PG·ES·git·버스) + 단위 55건 + 회귀 12건. 변이 29종 + 리뷰 정정 8종 킬, 등가 2종 | **CR-039 신설·구현.** 착수 전 감사가 열다섯을 찾았고 **다섯이 같은 뿌리**다 — 계약이 "만든다"만 말하고 "다시 만든다"를 말하지 않는다(DEV-215~229). `reference_key`로 참조 간선의 정체성을 대상에서 떼어 AC-3을 성립시켰고(DEV-217), `EVT-ING-005`로 직접 푸시 커밋을 파생에 잇고(DEV-215), JOB-REL-006으로 과거 데이터와 PG-only 재구축 경로를 세웠다(DEV-221). **머지 후가 아니라 머지 전에 Codex 리뷰 6건(P1 셋)이 도착했고 전부 실결함이었다** — 잡 생성 경로 부재·발행 순서·접두 재평가·부분 실패·페이지네이션·URL 부호(6.34.1장). 실제 GHE·Kubernetes는 NOT RUN |
| WP-030 | 되돌림·체리픽·스택 관계 파생 | REL-004 | done | 에이전트 | PR #46 | DoD 26항 전부 통과 (6.35장). 통합 49건(실 PG·ES) + 단위 22건 + 회귀 20건. 변이 18종 중 **하나가 살아남았고 그것이 결함이었다**(M13 깊이 상한) + 리뷰 정정 7종 킬 | **CR-041 신설·구현.** 착수 전 감사가 열여덟을 찾았고 **열둘이 같은 뿌리**다 — 계약이 source 본문만 보고 **후보(candidate)의 변화**를 보지 않는다(DEV-230~247). `EVT-ING-005`로 직접 푸시 커밋을 잇고(DEV-230·231), **상위 PR 변화가 하위 PR 간선을 바꾸는 역방향 경로**를 세웠으며(DEV-232), 체리픽 방향·상위 5건을 결정론으로 고정했다(DEV-243). 마이그레이션 014는 **인덱스만** — 새 표 없음(DEV-240). `JOB-REL-006`이 `handleSourceReady`를 거치므로 **재파생이 저절로 네 계열을 덮는다**(DEV-234). **머지 전에 Codex 리뷰 6건(P1 셋)이 도착했고 전부 실결함** — 양 끝점 요약·`links_pending` 보존·부분 실패·검색 가시성·retarget·후보 상한(6.35.1장). 실제 GHE·Kubernetes는 NOT RUN |
| WP-031 | 관계 조회 API와 상세 화면 관계 섹션 | REL-004 | done | 에이전트 | PR #47 (병합 `9084033`) | DoD 21항 전부 통과 (6.36장). 단위 38건 + 통합 31건(실 Elasticsearch) + 회귀 22건 + a11y 20건 + e2e 11건. 변이 22종 + 리뷰 정정 1종 전부 킬, **하나가 시험 구멍을 찾아 줬다**(M5) | **CR-042 신설.** 착수 전 감사가 열여덟을 찾았고 **아홉이 같은 뿌리**다 — 계약이 파생의 규칙만 정하고 **조회가 다른 질문**이라는 것을 보지 않았다(DEV-248~265). `API-REL-006` 신설, 역방향 조회의 저장소 라우팅 포기(DEV-250), THR-034 대상 내용 교집합(DEV-253), `API-REL-003` 상세 계약(DEV-249·254·255·256), `detached`·다중 후보·`links_pending` 표시 정정(DEV-257·258·261), W-001 이월 정정(DEV-262·264) |
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
| FR-SRCH-002 | WP-014, WP-018 | `apps/search-api/src/resolve/detail.ts` (`merge_commit_sha` 포함), `packages/es/src/resolve-query.ts`, `apps/web/lib/commit-detail.ts`, `apps/web/components/{ShaChip,ChangedPathList,LinkedPrList,SequencePosition,CommitDetailView}.tsx`, `apps/web/app/commit/[owner]/[repo]/[sha]/page.tsx` | `apps/search-api/integration/resolve/resolve.test.ts`, `packages/es/src/resolve-query.test.ts`, `apps/web/lib/commit-detail.test.ts`, `apps/web/a11y/commit-detail.test.tsx`, `apps/web/e2e/flow-003.spec.ts` | partial (AC-1·AC-2·AC-4·AC-5 충족, **화면 결합은 WP-018에서 done** — 역할 배지 셋, 소속 PR 전량 필드, `multi_pr` 목록, 체인 밖 안내와 머지 커밋 링크. **AC-3 `direct_push`는 여전히 도달 불가** — 커밋 문서가 PR 이벤트에서만 만들어진다, DEV-061 / WP-021. 화면은 매핑을 갖추고 도달하지 않음을 기록했으며, **`reason_code`를 "직접 푸시"로 부르지 않는다**, DEV-093) |
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
| FR-SEQ-001 | WP-002, WP-018, WP-020, WP-021 | `packages/db/migrations/002_sequence.up.sql`, `packages/db/src/advisory-lock.ts`, `packages/db/src/repositories/{merge-sequence,sequence-space}.ts`, `packages/github/src/{graph-plan,commit-graph,mirror-graph,api-graph,mirror-sync}.ts`, `apps/pipeline-worker/src/mirror-runner.ts`, `apps/web/lib/commit-detail.ts` (`sequencePositionState`), `apps/web/components/SequencePosition.tsx`, `apps/pipeline-worker/src/{sequence,sequence-plan}.ts`, `packages/domain/src/sequence.ts`, `packages/es/src/sequence.ts`, `apps/ingest-gateway/src/{ingest,server}.ts` (push → `prs:sequence`) | `packages/github/src/graph-plan.test.ts`, `packages/github/integration/graph.test.ts` (AC-2 대조), `packages/db/integration/advisory-lock.test.ts` (AC-6), `packages/db/integration/seed.test.ts` (AC-3), `apps/web/lib/commit-detail.test.ts`, `apps/web/a11y/commit-detail.test.tsx`, `apps/pipeline-worker/src/sequence-plan.test.ts`, `packages/domain/src/sequence.test.ts`, **`apps/pipeline-worker/integration/sequence/assign.test.ts`** (AC-1~AC-6 전부, 실제 git 픽스처 대조), **`regression/sequence.test.ts`** (ACC-02), `packages/es/integration/sequence.test.ts` | **완료 (WP-021)** — AC-1~AC-6과 예외 처리가 전부 실제 PostgreSQL·git으로 판정된다. 채번은 `git rev-list --first-parent --reverse`가 낸 순서를 그대로 옮기고, 그것을 회귀 계층이 매 실행마다 git과 대조한다. **재작성 감지 후의 재채번만 WP-022로 남는다** — 여기서는 감지해서 `stale`로 두고 기존 값을 보존한다 |
| FR-SEQ-002 | WP-023, WP-025 | `apps/search-api/src/sequence/{range,routes,space}.ts`, `packages/db/src/repositories/merge-sequence.ts` (`countRange`·`findRangePage`·`listPullRequestNumbersInRange`) | `apps/search-api/integration/sequence/range.test.ts`·`range-es.test.ts`, `regression/range-vs-git.test.ts` | api_done (화면은 WP-025). **W-004 화면 완료** (WP-025, 6.25장) — 반개구간 상시 표기·역전 교환·5만 사전 안내·에폭 경고까지 |
| FR-SEQ-003 | WP-023, WP-025 | `packages/domain/src/anchor.ts` (`classifyAnchor`·`boundaryOf`), `apps/search-api/src/sequence/anchors.ts`, `packages/db` `findPointBy{Seq,PullRequest,Commit}`·`findPointsByCommitPrefix`·`findPointAtOrBefore` | `packages/domain/src/anchor.test.ts`, `apps/search-api/integration/sequence/anchors.test.ts`, `apps/search-api/integration/release/containment.test.ts` (릴리스 앵커) | api_done — **AC-1 릴리스 태그 해석 완료** (WP-024, CR-028). 정본은 PostgreSQL `release` 표, 서수는 현재 에폭에서 재확인(DEV-149), `occurred_at`은 릴리스 시각. 미수집(`release_not_indexed`)·미존재(`tag_not_found`)·공간 불일치·체인 밖을 가른다. **W-004 앵커 입력(C-026) 완료** (WP-025) — 5종 정규화 표시·AC-5 넷·오류 갈래 |
| FR-SEQ-004 | WP-024, WP-026 | `apps/search-api/src/sequence/{release-comparison,releases-list}.ts`, `packages/db/src/repositories/release.ts` (`listReleaseTimeline`·`findLatestRelease`), `apps/web/lib/release.ts`, `apps/web/components/{ReleaseTimeline,ReleasesView}.tsx`, `apps/web/app/releases/page.tsx` | `apps/search-api/integration/release/timeline.test.ts`, `apps/web/lib/release.test.ts`, `apps/web/a11y/releases.test.tsx`, `apps/web/e2e/flow-003-releases.spec.ts` | done (WP-026) — AC-1~AC-5 전부. 비교는 WP-023의 `runRange`를 그대로 딛고(같은 요약 계층), API-SEQ-003이 따로 소유하는 것은 `to=unreleased`·서수 기준 방향 정규화·`size=0`뿐이다. 화면은 저장소 스코프 목록으로 AC-3을 도달 가능하게 만든다 |
| FR-SEQ-005 | WP-021, WP-022, WP-028 | `apps/pipeline-worker/src/sequence.ts` (`reassignSequence`), `packages/db/src/repositories/merge-sequence.ts` (`findSeqByCommit`·`copySequencesUpTo`·`countAbove`), `packages/db/src/repositories/sequence-space.ts` (`markReassigning`·`bumpEpoch`), `packages/es/src/sequence.ts` (`applyEpochBump`) | `apps/pipeline-worker/integration/sequence/reassign.test.ts` (AC-1~AC-5 전부, 실제 git 픽스처), `packages/es/integration/sequence.test.ts` (에폭 반영), `regression/sequence-rewrite.test.ts` (재작성 walk=git, 공통 접두 결정론) | **부분 (WP-022)** — 자동 감지 경로의 AC-1~AC-5가 실제 PostgreSQL·git으로 판정된다. AC-4의 저장된 검색 `seq:` 절반은 `saved_search`가 없어(WP-033) 도달 불가, 수동 재채번(API-ADM-007 POST)과 잡 유형 정정(DEV-128)은 WP-028, `epoch_stale` 화면 표시는 W-004(WP-025) 몫이다 |
| FR-SEQ-006 | WP-002, WP-041 | `packages/db/migrations/002_sequence.up.sql` (`safe_marker_current_uk`) | `packages/db/integration/constraints.test.ts` (AC-1) | partial (스키마만. 화면·API는 WP-041) |
| FR-SEQ-007 | WP-042 | - | - | not_started |
| FR-REL-001 | WP-027 | `apps/search-api/src/sequence/neighbors.ts`, `packages/db/src/repositories/merge-sequence.ts` (`findNeighbors`), `apps/web/lib/neighbors.ts`, `apps/web/components/NeighborSequenceList.tsx` (C-019 + 컨테이너), `apps/web/components/{PrDetailView,CommitDetailView}.tsx` | `apps/search-api/integration/sequence/neighbors.test.ts`, `apps/web/lib/neighbors.test.ts`, `apps/web/a11y/{pr-detail,commit-detail}.test.tsx`, `apps/web/e2e/flow-002.spec.ts` | done — AC-1~AC-5 전부. 이웃은 PostgreSQL이 고르고 색인은 표시값만 채운다(DEV-166). 직접 푸시 커밋을 포함해 서수가 건너뛰지 않는다(SRS v2.4). 앵커는 PR·커밋 둘 다이며 **`base_branch` 판별자로 시퀀스 공간을 요청이 지정한다** — 응답의 `sequence_space`는 언제나 요청한 공간이고 앵커 해석은 `findPointByPullRequest`/`findPointByCommit`(공간·에폭 한정)을 재사용한다 (CR-032, DEV-168). 색인 안 된 PR 행의 `merged_at`은 `null`이다 (DEV-169). 실패 상태에는 재시도 수단이 있다 (DEV-170) |
| FR-REL-002 | WP-024 | `packages/db/migrations/008_release.up.sql`, `packages/db/src/repositories/release.ts`, `packages/github/src/mirror-graph.ts` (`listTags`), `packages/domain/src/release.ts`, `apps/ingest-gateway/src/ingest.ts` (5d), `apps/pipeline-worker/src/release.ts` (JOB-REL-007), `packages/es/src/releases.ts`, `apps/search-api/src/sequence/containments.ts`·`routes.ts` (`GET /containments`), `apps/web/lib/containment.ts`, `apps/web/components/ReleaseContainmentList.tsx` (C-020) | `packages/domain/src/release.test.ts`, `apps/ingest-gateway/src/ingest.test.ts` (EVT-REL-001), `apps/pipeline-worker/integration/release/refresh.test.ts`, `apps/search-api/integration/release/containment.test.ts`, `packages/es/integration/releases.test.ts` (실ES, CI), `apps/web/lib/containment.test.ts`, `regression/releases-vs-git.test.ts` | done (AC-1~AC-5 + 예외 처리. 판정 정본은 PostgreSQL, `release_tags`/`unreleased`는 표시 전용 비정규화. CI 배포 소스는 OD-004 조건부로 제외 — 스키마·삭제 면제만 준비) |
| FR-REL-003 | WP-029, WP-031 | `packages/domain/src/link/{reference,text}.ts`, `packages/es/src/links.ts` (`writeReferenceLinks`·`resolveReferenceLinks`·`findReferencesTo`), `apps/pipeline-worker/src/link.ts`, **`packages/es/src/relations-read.ts`**, **`apps/search-api/src/relations/{service,routes}.ts`**, **`apps/web/{lib/relations.ts,components/LinkGroupList.tsx,components/RelationSection.tsx}`** | `packages/domain/src/link/reference.test.ts`, `apps/pipeline-worker/integration/worker/link*.test.ts`, `apps/search-api/integration/relations/relations.test.ts`, `apps/web/a11y/relations.test.tsx`, `apps/web/e2e/flow-006.spec.ts` | done (CR-039 파생 + CR-042 조회·표시) |
| FR-REL-004 | WP-030, WP-031 | `packages/domain/src/link/revert.ts`, `apps/pipeline-worker/src/relations.ts` (`planReverts`), `packages/query/src/keys.ts`+`packages/es/src/query-builder.ts` (`is:reverted`), **`apps/search-api/src/relations/service.ts`** (다중 후보 판정), **`apps/web/components/{LinkGroupList,RelationBadgeGroup}.tsx`** | `packages/domain/src/link/relations.test.ts`, `apps/pipeline-worker/integration/worker/relations.test.ts`, `apps/search-api/integration/relations/relations.test.ts`, `apps/web/a11y/relations.test.tsx` | done (CR-041 파생 + CR-042 조회·다중 후보 표시) |
| FR-REL-005 | WP-020, WP-030, WP-031 | `packages/github/src/{commit-graph,mirror-graph,api-graph}.ts` (patch-id 계산과 `patch_id_unavailable` 사유) | `packages/github/src/graph-plan.test.ts`, `packages/github/integration/graph.test.ts` | **부분** — AC-5(미러 없을 때 `patch_id_unavailable`)의 계산 계층만 섰다. 간선 생성(AC-1~AC-4)은 WP-030. **AC-2는 CR-024로 조건부가 되었다** — blob 인출이 허용된 미러에서만 수행하며, 기본 설정에서 수행하지 않는 것이 이제 명세다 (DEV-111). `patch_id_unavailable`은 사유 3종을 담는 `keyword`다 |
| FR-REL-006 | WP-030, WP-031 | `apps/pipeline-worker/src/relations.ts` (`planStacks`·`walkChain`·`reconcileStackDetachment`), `packages/es/src/links.ts` (`setLinkDetached`), **`apps/search-api/src/relations/service.ts`** (`supportsAnchorKind`), **`apps/web/components/LinkGroupList.tsx`** (해제 표시) | `apps/pipeline-worker/integration/worker/relations.test.ts` (깊이 12/13·순환·detached 수명), `apps/search-api/integration/relations/relations.test.ts`, `apps/web/a11y/relations.test.tsx`, `apps/web/e2e/flow-006.spec.ts` | done (CR-041 파생 + CR-042 표시) |
| FR-REL-007 | WP-031 | **`apps/search-api/src/relations/co-changes.ts`** (자격 상태 셋 · `script_score` 정확 자카드 · 상위 20 · 겹침 상위 10), **`apps/search-api/src/relations/routes.ts`**, **`apps/web/components/CoChangeSection.tsx`** | `apps/search-api/integration/relations/co-changes.test.ts` (12건 · 실 Elasticsearch), `apps/web/a11y/relations.test.tsx`, `apps/web/e2e/flow-006.spec.ts` | done (CR-042) |
| FR-REL-008 | WP-043 | - | - | not_started |
| FR-ING-001 | WP-004 | `apps/ingest-gateway/src/{signature,ingest,store,payload,events,archive,metrics,server,config}.ts`, `apps/pipeline-worker/src/outbox-relay.ts` | `apps/ingest-gateway/src/{signature,payload,ingest,server}.test.ts`, `apps/ingest-gateway/integration/{webhook,idempotency,load,enqueue}.test.ts`, `apps/pipeline-worker/integration/outbox-relay.test.ts` | verified (AC-1~AC-6 전부. AC-4는 발행 포함 부하 1000건 p95 35.6ms) |
| FR-ING-002 | WP-002, WP-004, WP-008 | `packages/db/migrations/001_ingestion.up.sql`, `packages/db/src/repositories/raw-event.ts`, `packages/db/src/advisory-lock.ts`, `apps/ingest-gateway/src/{store,payload}.ts`, `packages/domain/src/events.ts` | `packages/db/integration/constraints.test.ts`, `apps/ingest-gateway/integration/{webhook,idempotency}.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | verified (AC-1~AC-4에 더해 AC-5 결정론적 문서 ID — 같은 이벤트를 두 번 투영해도 문서가 하나다) |
| FR-ING-003 | WP-002, WP-004 | `packages/db/migrations/001_ingestion.up.sql`, `packages/db/src/partitions.ts`, `packages/db/src/repositories/raw-event.ts`, `apps/ingest-gateway/src/archive.ts` | `packages/db/integration/{partitions,constraints}.test.ts`, `apps/ingest-gateway/integration/webhook.test.ts` | partial (AC-1·AC-2·AC-4 충족. AC-3 원본만으로 재색인은 WP-008·WP-033) |
| FR-ING-004 | WP-006, WP-007 | `packages/github/src/{config,redact,errors,jwt,rate-limit,token-provider,token-pool,scheduler,transport,client}.ts`, `apps/pipeline-worker/src/{enrich,webhook-target,metrics}.ts`, `packages/bus/src/{types,backoff,redis-streams,in-memory}.ts`, `packages/domain/src/{events,event-id}.ts` | `packages/github/src/{redact,rate-limit,scheduler,jwt,config}.test.ts`, `packages/github/testing/{mock-ghe,client,smoke-real-ghe}.test.ts`, `apps/pipeline-worker/src/webhook-target.test.ts`, `apps/pipeline-worker/integration/worker/enrich.test.ts`, `packages/bus/integration/contract.ts` | verified (AC-1~AC-4 전부. AC-5 미러 우선 커밋 조회는 WP-020 — 지금은 ADR-005의 API 폴백 경로만) |
| FR-ING-005 | WP-005, WP-008 | `packages/bus/src/{types,topics,partition,config,redis-streams,in-memory}.ts`, `packages/es/src/{upsert,bootstrap,indices}.ts`, `apps/pipeline-worker/src/{project,documents,enriched-payload,index-retry,metrics}.ts`, `packages/domain/src/events.ts` | `packages/es/src/upsert.test.ts`, `packages/es/integration/bootstrap.test.ts`, `apps/pipeline-worker/src/{documents,enriched-payload,index-retry}.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | verified (AC-1~AC-5 전부. AC-5는 개발 데이터셋 20건 기준 전량 10초 버킷 이내) |
| FR-ING-006 | WP-019 | `packages/github/src/client.ts` (`listPullRequestsPage`), `packages/db/src/repositories/job.ts` (`claimNextJob`·`transitionJob`), `packages/db/src/advisory-lock.ts` (`jobClaimLockKey`), `apps/pipeline-worker/src/{backfill-plan,backfill,index-retry}.ts`, `apps/search-api/src/ops/jobs.ts` | `apps/pipeline-worker/src/backfill-plan.test.ts`, `packages/db/integration/job-claim.test.ts`, `apps/pipeline-worker/integration/jobs/backfill.test.ts`, `apps/search-api/integration/admin/jobs.test.ts` | partial (AC-1·AC-2·AC-4·AC-5·AC-6 구현하고 통합 시험을 썼으나 **로컬 실행은 NOT RUN**(Docker 부재) — CI가 판정한다. **AC-3(실시간 지연 미영향)은 구조로만 세웠다**: 모든 백필 호출이 `priority: 'backfill'`이고 역할 분리로 워커 풀을 나눌 수 있다. 실제 지연 p95는 운영 규모 측정이 필요해 **측정하지 않았다**, DEV-058과 같은 형태) |
| FR-ING-007 | WP-002, WP-007, WP-008, WP-009 | `packages/db/migrations/{001_ingestion,006_dead_letter}.up.sql`, `packages/db/src/repositories/dead-letter.ts`, `packages/bus/src/{backoff,ingest}.ts`, `apps/pipeline-worker/src/{enrich,project}.ts`, `apps/search-api/src/ops/{dead-letters,routes}.ts`, `apps/search-api/src/{config,metrics}.ts` | `packages/db/integration/dead-letter.test.ts`, `apps/search-api/integration/ops/dead-letter.test.ts`, `apps/pipeline-worker/integration/worker/{enrich,project}.test.ts`, `packages/bus/integration/contract.ts` | verified (AC-1~AC-5 전부. AC-4 재처리 멱등은 재투입 payload의 `delivery_id` 보존으로, 문서 수준은 WP-008의 결정론적 ID 시험으로 각각 검증) |
| FR-ING-008 | WP-035 | - | - | not_started |
| FR-ING-009 | WP-008, WP-010, WP-040 | `apps/search-api/src/ops/{repositories,ghe-lookup,routes}.ts`, `packages/db/src/repositories/{repository,audit,job}.ts`, `packages/es/src/registry.ts`, `packages/es/src/mappings/commits.ts`, `apps/pipeline-worker/src/{project,documents}.ts` | `apps/search-api/integration/admin/repositories.test.ts`, `packages/es/integration/registry.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | verified (AC-1~AC-5 전부. AC-5 감사 주체는 관리 토큰 이름이며 WP-012의 OIDC 신원이 대체한다) |
| FR-ING-010 | WP-036 | - | - | not_started |
| FR-ING-011 | WP-028 | `apps/pipeline-worker/src/reconcile.ts` (JOB-ING-005), `packages/github/src/client.ts` (`listPullRequestsPage` `direction`), `apps/pipeline-worker/src/metrics.ts` | `apps/pipeline-worker/src/reconcile.test.ts` | done — AC-1~AC-5 전부. 주기는 설정값(기본 1시간), 창은 `updated desc` + 24시간 컷오프(`/pulls`에 `since`가 없다, DEV-175), 누락은 백필의 `projectOne`으로 되돌린다(두 번째 경로를 만들지 않는다). **head 서수가 없으면 `prs:sequence`의 `sequence.requested`로 요청한다** — 집는 러너가 없는 잡 행을 만들지 않는다 (CR-034, DEV-180). 한도 소진은 미룸이며 3주기 연속이면 경보 지표가 뜬다. **운영 기동은 전용 `reconcile` 역할이 한다** (DEV-179, `deploy/k8s/pipeline-worker-reconcile.yaml`) |
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
| FR-ADMIN-003 | WP-028, WP-040 | `apps/search-api/src/ops/sequence-integrity.ts` (API-ADM-007), `apps/search-api/src/ops/routes.ts`, `apps/pipeline-worker/src/integrity.ts` (JOB-SEQ-003), `packages/domain/src/integrity.ts` (대조 규칙), `packages/db/src/repositories/integrity.ts`, `packages/db/migrations/009_job_type_reassign.up.sql` | `apps/search-api/integration/ops/sequence-integrity.test.ts`, `apps/search-api/src/ops/sequence-integrity.test.ts`, `packages/domain/src/integrity.test.ts`, `apps/pipeline-worker/src/integrity.test.ts`, `packages/db/integration/job-type-reassign.test.ts` | done — AC-1~AC-5 전부. **점검은 관찰이며 시퀀스 공간 상태를 바꾸지 않는다** (SRS v2.5, CR-033 DEV-171). 비교 규칙은 `firstSequenceMismatch` 하나를 API와 잡이 함께 쓴다. **운영 배선은 CR-034가 세웠다**: `apps/search-api/src/runtime.ts`(조립 이음매, DEV-177), `apps/pipeline-worker/src/sequence-repair-runner.ts`(JOB-SEQ-002 러너, DEV-178), `repairSequence`(검증 prefix + 최초 불일치 재계산, DEV-182), `deploy/k8s/pipeline-worker-sequence.yaml`(DEV-183). A-003 화면은 WP-040 몫이다 |
| NFR-001 | WP-013, WP-014, WP-023, WP-037 | `apps/search-api/src/search/{service,relaxation,routes}.ts` (`track_total_hits: 10000`, 완화 힌트 `msearch` 1회·상한 8, ES 마감 3초) | `apps/search-api/integration/search/list.test.ts` (왕복 수가 필터 수에 비례하지 않음) | **NOT RUN** (p95 실측 없음 — 1000만 문서 데이터셋과 부하 harness 부재, DEV-058. 예산을 지키는 **구조**만 시험으로 고정했다) |
| NFR-002 | WP-004, WP-005, WP-008 | `apps/ingest-gateway/src/{server,metrics}.ts`, `packages/bus/src/{types,topics,partition,config,redis-streams,in-memory}.ts`, `apps/pipeline-worker/src/{project,metrics}.ts` | `apps/ingest-gateway/integration/{load,enqueue}.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | partial (발행까지 포함한 수신 응답 p95 38.3ms / 예산 300ms. 수신→색인 지연은 `ingestion_lag_seconds`로 계측하며 개발 데이터셋에서 전량 10초 이내. 운영 규모 측정은 REL-001 성능 게이트) |
| NFR-003 | WP-002, WP-003 | `packages/db/migrations/*`, `packages/db/src/partitions.ts`, `packages/es/src/indices.ts` | `packages/db/integration/partitions.test.ts`, `packages/es/integration/bootstrap.test.ts` | partial (PostgreSQL 파티션 + ES 샤드 수. 용량 실측은 REL-001 이후) |
| NFR-004 | WP-010 (인프라) | - | - | not_started |
| NFR-005 | WP-003, WP-004, WP-012 | `packages/es/src/mappings/*` (`dynamic: strict`), `apps/ingest-gateway/src/signature.ts` | `packages/es/integration/behavior.test.ts`, `apps/ingest-gateway/src/signature.test.ts` | partial (매핑 수준 차단 + 웹훅 서명 검증·로그 금지 항목. 세션 인증은 WP-012) |
| NFR-006 | WP-039 | - | - | not_started |
| NFR-007 | WP-015 ~ WP-018, WP-025, WP-038 | `apps/web/components/*.tsx`, `apps/web/lib/nav.ts` | `apps/web/a11y/{shell,search,pr-detail,commit-detail}.test.tsx` (axe wcag2a/2aa/21a/21aa, 위반 0건), `apps/web/lib/architecture.test.ts` (QA-COMMON-16·17 정적 검사 + 화면 라우트가 공통 관문을 지나는지), `pnpm test:contrast` (라이트·다크 80쌍, 실패 0건), `apps/web/e2e/{shell,flow-001,flow-002,flow-003}.spec.ts` | partial (**셸·W-001·W-002·W-003은 done** — 랜드마크·스킵 링크·`aria-current`·라우트 전환 알림·좁은 화면 내비게이션·포커스 복귀에 더해, 두 화면의 모든 DoD 상태에 axe를 돌려 위반 0건. 상태를 **색이 아니라 글자로도** 구분한다(타임라인 네 상태, 시퀀스 배지). 복사 결과는 성공·실패 **양쪽을** 라이브 리전으로 알린다(DEV-096). 나머지 화면은 WP-025 이후다. `color-contrast` axe 규칙은 jsdom에 레이아웃·canvas가 없어 끄고 `checkContrast`로 대신 건다 — 켜 두면 조용히 아무것도 검사하지 않으면서 통과로 보인다) |
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
| DEV-051 | 2026-08-21 | WP-012의 아키텍처 테스트가 **접근 범위를 거치지 않는 운영 집계 두 곳**을 드러냈다. API-ADM-006이 `enrichment_pending`을 `es.count`로 전 저장소에서 세고(FR-ADMIN-001 AC-1), `slowest_repositories`가 저장소 **이름**을 담는다(AC-3). 그런데 THR-003은 "집계 건수·패싯으로 접근 범위 밖 저장소의 활동량 추론"을 막으라 하고, THR-016은 "`operator`도 권한 없는 저장소 데이터는 볼 수 없다"고 한다. **두 승인된 문서가 같은 API에 대해 반대 방향을 가리킨다** | WP-012, WP-010 / FR-ADMIN-001 AC-1·AC-3, FR-AUTH-002 AC-5, THR-003, THR-016 | 문서 간 모순 | **CR-015** | **resolved (2026-08-22, CR-024)** — **(가)+(나) 결합.** 저장소를 **식별하지 않는** 전역 수치(`enrichment_pending` 포함)는 FR-AUTH-002 AC-5의 명시적 예외로 SRS에 적었다 — "조직 전체 보강 대기 1,204건"에서 특정 저장소의 활동량을 끌어낼 수 없으므로 THR-003의 위협이 성립하지 않는다. 반대로 저장소를 **식별하는** `slowest_repositories`는 `operator`에게도 접근 범위 안으로 한정했고, 걷어 낸 개수를 `slowest_repositories_out_of_scope`로 함께 내보낸다 — **목록이 잘렸다는 사실까지 감추면 운영자가 "느린 저장소가 없다"로 잘못 읽는다.** 아키텍처 테스트의 허용 목록은 두 갈래를 구분해 유지한다. **코드 반영은 후속 작업이다** — 이 CR은 계약만 정했다. 아래는 결정 이전 기록이다: 동작을 바꾸지 않았다. FR-ADMIN-001이 더 구체적인 요구이고 API-ADM-006은 이미 `operator` 역할 뒤에 있으므로 현재 동작을 유지하되, 아키텍처 테스트의 **사유 붙은 허용 목록**에 등록해 다음 전역 집계가 조용히 들어오지 못하게 했다. 해소하려면 CR이 필요하다 — 선택지는 (가) 운영 집계를 접근 범위 예외로 SRS에 명시, (나) `slowest_repositories`를 저장소 ID 없는 형태로 축소, (다) 운영 콘솔 조회에도 강제 필터 결합. **사용자 결정 사항이다** |
| DEV-052 | 2026-08-21 | **질의 키 15종이 어느 ES 필드로 가는지가 어디에도 없다.** 대부분은 이름이 같지만 둘은 문서만으로 풀리지 않는다 — `org:acme`는 문서에 `org_id`(숫자)만 있고 조직 이름이 없으며, `team:payments-core`도 `allowed_team_ids`(숫자)만 있고 slug이 없다. FR-SRCH-006 AC-1이 조직·팀 필터를 명시적으로 요구한다 | WP-013 / FR-SRCH-005 AC-1, FR-SRCH-006 AC-1, API-SRCH-004 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — 키→필드 표를 API 계약에 넣었다. `org`·`team`은 레지스트리에서 이름→ID로 해석한다(재색인 없이 풀리고 등록 정보의 주인이 레지스트리다). **`team`은 이 WP에서 결과를 내지 못한다** — 문서의 팀 ID 배열이 비어 있다(WP-012 제한). 조용히 0건을 내지 않고 응답에 남긴다 |
| DEV-053 | 2026-08-21 | **`is`의 뜻이 정의되어 있지 않다.** 값 넷 중 `merged`·`open`·`closed`는 `state`와 겹치고 `reverted`만 `link_summary.is_reverted`다. 둘이 같은 뜻이면 키가 둘일 이유가 없고, 다르면 무엇이 다른지가 있어야 한다 | WP-013 / FR-SRCH-005 AC-1, FR-SRCH-006 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — `is`는 **파생 상태**다. `state`가 GitHub이 준 값을 그대로 보는 반면 `is`는 이 시스템이 계산한 것까지 본다 — `is:merged`는 `state:merged`와 같지만 `is:reverted`는 `link_summary.is_reverted`를 본다. 겹치는 셋을 지우지 않은 것은 사용자가 `is:` 하나로 상태를 물을 수 있어야 하기 때문이다 |
| DEV-054 | 2026-08-21 | **`/search`가 어느 인덱스를 도는지가 정해져 있지 않다.** API-SRCH-004의 목적은 "PR·커밋 목록"이고 W-001-RESULTS도 유형 열에 PR/커밋을 적었는데, 응답 예시에는 `kind: pull_request`만 있고 `search` 파사드는 별칭 하나만 받는다. 커밋 문서에는 `labels`·`reviewers`·`state`·`merged_at`·`title`이 아예 없다 | WP-013, WP-032 / API-SRCH-004, W-001, FR-SRCH-006 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — PR·커밋 두 별칭을 함께 돈다. **실측으로 확인**: 한쪽에만 있는 필드로 **필터**하면 조용히 무매치지만(정상 — 커밋에 라벨이 없는 것은 사실이다), 같은 필드로 **정렬**하면 HTTP 200에 `_shards.failed: 12/18`이 붙은 **부분 실패**가 되어 한 인덱스가 통째로 빠진 결과가 정상처럼 돌아온다. 모든 정렬 키에 `unmapped_type`을 붙이고 `_shards.failed`를 검사해 0이 아니면 부분 결과를 내지 않는다 |
| DEV-055 | 2026-08-21 | **`relaxation_hints` 산출 방법이 없다.** FR-SRCH-006 AC-3이 "어떤 필터를 제거하면 결과가 생기는지"를 요구하지만 몇 번 질의하는지, 후보를 몇 개까지 내는지, 어떤 순서인지가 없다. 필터 N개마다 질의를 한 번씩 더 던지면 NFR-001의 p95 500ms 예산을 N배로 쓴다 | WP-013 / FR-SRCH-006 AC-3, NFR-001 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — `msearch` 한 번으로 묶어 왕복을 1회로 고정하고, 후보를 **상한 8개**로 자른다. 상한을 넘으면 잘랐다는 사실을 응답에 남긴다 — 조용한 절삭은 "이것이 전부"로 읽힌다. 0건일 때만 계산하므로 정상 경로의 지연에 영향이 없다 |
| DEV-056 | 2026-08-21 | **`relevance` 정렬이 전문 검색 없이는 뜻이 없다.** FR-SRCH-007 AC-1이 정렬 키로 요구하지만 WP-013은 전문 검색을 제외하고(WP-032), 접근 범위 필터는 `filter` 절이라 점수를 만들지 않는다. 모든 문서의 점수가 같아진다 | WP-013, WP-032 / FR-SRCH-007 AC-1 | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — 키를 받되(AC-3의 400을 내지 않는다) 이 WP에서는 문서 ID 순으로 떨어진다고 계약에 적었다. AC-4의 결정론은 그대로 성립한다. 전문 검색이 서는 WP-032에서 실제 점수가 붙는다 — **동작하는 척하지 않고 지금 무엇인지 적는다** |
| DEV-057 | 2026-08-21 | **`facets`·`next_cursor`가 WP-013 범위 밖인데 API 계약의 응답 예시에는 늘 있다.** 화면이 "키가 없다"와 "`null`이다"를 구분하지 못하면 페이저가 마지막 페이지를 오해하고 패싯 레일이 빈 목록을 그린다 | WP-013, WP-032 / API-SRCH-004, W-001-PAGER, W-001-FACETS | 범위 공백 | **CR-016** | **resolved (2026-08-21)** — `next_cursor`는 **항상 `null`로 실어 보낸다**(키가 있고 값이 없다 = 다음 페이지가 없다). `facets`는 **키 자체를 넣지 않는다** — 빈 객체는 "패싯을 셌는데 아무것도 없다"로 읽힌다. WP-032가 둘을 채운다 |
| DEV-058 | 2026-08-21 | **`pnpm test:perf` 스크립트가 저장소에 없다** (DEV-032와 같은 형태). WP-013의 DoD가 NFR-001의 p95 500ms를 1000만 문서 합성 데이터셋으로 요구하는데, 스크립트도 데이터셋도 이 실행 환경에 없다 | WP-013 / NFR-001, DEV-032 | 실행 환경 제약 | **CR-016** | **open** — 질의 **모양**이 필터 수에 비례해 커지지 않음을 시험으로 고정했다(상수 왕복 수). 그러나 **실측 p95는 NOT RUN이다.** 1000만 문서 데이터셋과 부하 시험 harness는 **REL-002 성능 게이트**에서 세운다. 측정하지 않은 것을 통과로 적지 않는다 |
| DEV-059 | 2026-08-21 | FR-SRCH-007 AC-4가 "동점 처리를 위해 **문서 ID를 마지막 정렬 키로** 사용해 결정론적 순서를 보장한다"고 요구하는데, **Elasticsearch 8은 `_id`로 정렬하는 것을 금지한다** — `Fielddata access on the _id field is disallowed`. 켜려면 `indices.id_field_data.enabled` 클러스터 전역 설정이 필요하고 그것은 모든 문서 ID를 힙에 올린다. AC를 문자 그대로 구현할 수 없다 | WP-013 / FR-SRCH-007 AC-4 | 도구 제약 | **CR-016** | **resolved (2026-08-21)** — `_id`와 **같은 값**을 `doc_id` keyword 필드로 문서에 함께 넣고 그 필드로 정렬한다. `upsert`가 `request.id`에서 자동으로 채우므로 투영 자리가 잊을 수 없다. AC-4의 뜻("문서 ID로 동점을 가른다")은 그대로 성립한다. `_doc`은 쓰지 않았다 — 세그먼트 내부 순서라 머지·재색인에 값이 달라져 결정론이 깨진다. **이미 색인된 문서는 다음 이벤트에서 채워진다**(스크립트 `params.doc`에도 넣었다). 그때까지는 `missing: _last`로 뒤에 선다 |
| DEV-060 | 2026-08-21 | **API-SRCH-002의 커밋 상세가 커밋 문서에 채워지지 않는 필드 11종을 약속한다** — `message`, `author`, `committer`, `authored_at`, `committed_at`, `parent_shas`, `patch_id`, `changed_paths`, `changed_files_count`, `additions`, `deletions`. 매핑에는 자리가 있으나 투영이 채우지 않는다: `EVT-ING-002`가 커밋에 대해 SHA만 나른다(WP-008이 남긴 기존 한계). WP-014는 조회 계층이라 투영을 고칠 수 없다 | WP-014, WP-020 / FR-SRCH-002, API-SRCH-002, ENT-CORE-003 | 문서와 구현 불일치 | **CR-017** | **resolved (2026-08-21)** — 응답에서 **없는 키는 넣지 않는다**(CR-016 DEV-057이 `facets`에 세운 규칙과 같다: 키 없음 = 만들지 않았다, `null` = 만들었는데 비었다). 0이나 빈 문자열로 채우면 "파일을 하나도 안 바꾼 커밋"과 구분되지 않는다. 계약 예시를 실제 채워지는 필드만 남기도록 고치고 나머지는 WP-020(미러 기반 커밋 보강)으로 표시했다 |
| DEV-061 | 2026-08-21 | **`role: 'direct_push'`에 도달할 수 없다.** FR-SRCH-002 AC-3과 QA-W003-03이 요구하지만 커밋 문서는 **PR 이벤트에서만** 만들어지고 투영의 `CommitRole` 타입에 값이 둘(`merge_commit`·`source_commit`)뿐이다. `push` 이벤트는 ack 후 버려진다(DEV-016). 직접 푸시 커밋은 **문서 자체가 없어** 조회가 404가 된다 | WP-014, WP-021 / FR-SRCH-002 AC-3, QA-W003-03 | 구현 공백 | **CR-017** | **open** — API 계약과 타입은 `direct_push`를 표현할 수 있게 그대로 둔다(값이 생겼을 때 계약을 다시 고치지 않기 위해). 그러나 **그 값이 실제로 나오려면 push 이벤트 라우팅(WP-021)이 필요하다.** 동작을 지어내지 않았고 **QA-W003-03을 NOT SATISFIED로 기록한다**. **해소 (2026-08-23, WP-021)** — 게이트웨이가 push를 `prs:sequence`에 싣고(DEV-116) 채번이 직접 푸시 커밋에도 서수를 붙이며 `pull_request_number`를 `null`로 둔다. 그 구분이 실제로 성립하는 것을 머지 커밋과 같은 히스토리에서 대조해 확인했다. 다만 **화면의 `direct_push` 표시는 커밋 문서의 `role`을 보는데 그 값을 채우는 것은 투영이므로**, W-003이 그것을 그리려면 커밋 메타데이터 보강(WP-067)이 필요하다 — 도달 불가는 풀렸고 표시는 아직이다 |
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
| DEV-090 | 2026-08-22 | **`W-003-HEADER`가 요구하는 여섯 중 셋을 만들 재료가 없다.** 헤더 정의는 "축약 SHA, **메시지 첫 줄**, 역할 배지, 시퀀스 배지, **작성자**, **시각**"인데 커밋 문서에는 `message`·`author`·`authored_at`이 **없다** (CR-017, DEV-060 — `EVT-ING-002`가 커밋에 대해 SHA만 나른다). 와이어프레임 레이아웃의 `a3f9c21… · feat: 결제 재시도 로직`도 `kim · 2026-08-19 14:02`도 그릴 수 없다 | WP-018, WP-020 / W-003-HEADER, FR-SRCH-002 | 범위 공백 | **CR-021** | **resolved (2026-08-22)** — **소속 PR에서 빌려오지 않는다.** 커밋 메시지 자리에 PR 제목을 넣으면 원본 커밋 N건이 **전부 같은 제목**으로 보이는데, 체리픽·되돌림 조사에서 그것은 정확히 반대의 결론을 부른다. 헤더의 표시명은 **축약 SHA**이고, 없는 것은 "커밋 메타데이터는 아직 수집 전"이라고 밝힌다. W-002가 DEV-082~086에 세운 것과 같은 규칙이다 |
| DEV-091 | 2026-08-22 | **`no_sequence` 안내가 요구하는 머지 커밋 링크를 만들 재료가 응답에 없다.** 와이어프레임 구현 메모는 "'이 커밋은 대상 브랜치에 직접 존재하지 않고 **머지 커밋 X로 반영되었습니다**'라는 설명과 **머지 커밋 링크**를 제공한다"고 정하는데, `API-SRCH-002`의 `pull_requests[]`는 `pr_number`·`title`·`author`·`reviewers`·`approved_by`·`state`·`merged_at`·`url`뿐이고 **`merge_commit_sha`가 없다.** 커밋 문서에도 없다 — 원본 커밋에서 머지 커밋으로 가는 길이 화면에 없다 | WP-018, WP-014 / W-003 상태 매트릭스 `no_sequence`, API-SRCH-002 | 범위 공백 | **CR-021** | **resolved (2026-08-22)** — **응답에 `merge_commit_sha`를 더한다.** 값은 이미 PR 문서에 있고 `PullRequestSource`가 선언하고 있다 — `linkedPullRequest`가 싣지 않았을 뿐이다. 없는 데이터를 만드는 것이 아니라 **있는 것을 내보내는** 정합성 수정이다. 이것 없이는 상태 매트릭스가 정한 복구 경로("머지 커밋 이동")가 성립하지 않는다. 머지되지 않은 PR이면 키를 넣지 않는다(`null`로 채우지 않는다) |
| DEV-092 | 2026-08-22 | **`no_sequence`와 "미채번"을 시퀀스 값으로 가를 수 없다.** 상태 매트릭스는 `no_sequence`를 "first-parent 체인 밖(원본 커밋)"이라는 **사실 주장**으로 정의하는데, `merge_seq`는 WP-021까지 **모든 커밋에서 `null`**이다. 값만 보고 판정하면 머지 커밋까지 "체인 밖"으로 표시된다 | WP-018, WP-021 / W-003 상태 매트릭스 `no_sequence`, FR-SEQ-001 | 범위 공백 | **CR-021** | **resolved (2026-08-22)** — **역할로 판정한다.** `role === 'source_commit'`은 **정의상** 대상 브랜치 first-parent 체인 밖이다 — squash merge에서 원본 커밋은 브랜치에 직접 착지하지 않는다. 시퀀스 값 없이도 지금 말할 수 있는 사실이다. `merge_commit`인데 `merge_seq`가 `null`인 것은 **미채번**이고 다른 문구를 쓴다. DEV-077(미머지 vs 미채번)이 W-001에 세운 구분의 커밋판이다 |
| DEV-093 | 2026-08-22 | **`QA-W003-03`과 상태 `no_pr`이 `direct_push`를 요구하는데 도달할 수 없다.** DEV-061이 그대로 남아 있다 — 커밋 문서는 PR 이벤트에서만 만들어지고 `push`는 ack 후 버려져(DEV-016) 직접 푸시 커밋은 문서 자체가 404다. 한편 서버는 PR이 비면 `reason_code: 'no_pull_request'`를 **실제로 싣는데**, 그것은 "투영이 아직 PR 번호를 잇지 못했다"이지 직접 푸시가 아니다 (`detail.ts` 주석이 명시한다) | WP-018, WP-021 / QA-W003-03, W-003 상태 매트릭스 `no_pr`, FR-SRCH-002 AC-3 | 문서 간 모순 | **CR-021** | **resolved (2026-08-22)** — **항목을 가른다** (DEV-075·082·088과 같은 처리). "PR이 없을 때 사유를 표시한다"는 지금 세운다. 다만 화면은 **`reason_code`를 "직접 푸시"라고 부르지 않는다** — "아직 PR 연결을 찾지 못했습니다"로 쓴다. `role: 'direct_push'`가 실제로 오면 그때 "직접 푸시"이고, 역할 배지 매핑에 세 값을 모두 두되 **셋째는 도달하지 않음을 기록한다.** `epoch_stale`(DEV-087)과 달리 화면 상태 전체가 아니라 **전량 매핑의 한 값**이라 만든다 — 값이 오면 배지가 저절로 옳아진다 |
| DEV-094 | 2026-08-22 | **`C-025 ChangedPathList`를 채울 데이터가 없고 타입이 그것을 표현하지 못한다.** `changed_paths`·`changed_files_count`·`additions`·`deletions`는 커밋 문서에 자리만 있고 투영이 채우지 않는다(DEV-060). 그런데 C-025의 필수 props는 `paths`·`totalCount: number`·`truncated: boolean`으로 **널을 허용하지 않는다** — 타입대로 만들려면 `0`을 채워야 하고, 그러면 *파일을 하나도 바꾸지 않은 커밋*과 구분되지 않는다 | WP-018, WP-020 / C-025, W-003-PATHS, FR-ING-004 | 범위 공백 | **CR-021** | **resolved (2026-08-22)** — `totalCount: number \| null`로 넓히고(DEV-083이 C-018에 한 것과 같다) 섹션은 **골격 + 사유**로 세운다. **`QA-W003-08`("변경 경로 목록에 파일 내용이 표시되지 않는다")은 금지 규칙이라 데이터 없이 성립하고 지금 세운다** — 나중에 검사하면 이미 잘못 만든 뒤다 (SRS 4.3, NFR-005의 소스 코드 미저장) |
| DEV-095 | 2026-08-22 | **커밋의 `enrichment_pending`이 상태 이름과 다른 것을 뜻한다.** 상태 매트릭스는 `enrichment_pending`을 "PR 연결 미완료"로 정의하는데, 투영은 커밋 문서의 그 필드에 **PR 이벤트의 보강 상태를 그대로 복사한다**(`enriched.enrichment_pending`). 그것은 "이 PR의 보강이 안 끝났다"이고, PR 연결이 실제로 비는 경우는 `pull_requests: []` + `reason_code`로 **따로** 온다. 하나로 읽으면 보강 중인 PR의 머지 커밋이 "PR 연결 없음"으로 표시된다 | WP-018, WP-008 / W-003 상태 매트릭스 `enrichment_pending`, FR-SRCH-002 예외 처리 | 문서와 구현 불일치 | **CR-021** | **resolved (2026-08-22)** — **둘을 따로 다룬다.** `enrichment_pending: true`는 "수집 중 — 목록이 나중에 늘 수 있습니다"(이미 있는 PR은 그대로 보인다), `pull_requests: []`는 "아직 PR 연결을 찾지 못했습니다"다. 사용자가 할 일이 다르다 — 전자는 기다리는 것이고 후자는 재조회해도 같을 수 있다. 상태 매트릭스의 설명을 고쳤다 |
| DEV-096 | 2026-08-22 | **`C-024 ShaChip`의 복사 실패 경로가 명세에 없다.** "복사 성공은 `aria-live=\"polite\"`로 알린다"만 있는데, `navigator.clipboard`는 **보안 컨텍스트에서만 존재하고** 권한 거부·구형 브라우저·HTTP 배포에서 던지거나 없다. 실패가 조용하면 사용자는 복사됐다고 믿고 붙여넣는다 — **조사 도구에서 잘못된 SHA를 붙여넣는 것은 조사 결과 전체를 틀리게 만든다** | WP-018 / C-024, QA-W003-07 | 범위 공백 | **CR-021** | **resolved (2026-08-22)** — 실패도 **같은 `aria-live` 영역에 알리고**, 전체 40자를 선택 가능한 텍스트로 함께 노출해 손으로 복사할 길을 남긴다. 성공만 알리는 것은 "성공했거나, 아무 일도 없었거나"를 구분해 주지 않는다 |
| DEV-097 | 2026-08-22 | **FLOW-001 4단계가 구현되어 있지 않다 — W-001이 후보 1건에서 영원히 멈춘다.** 흐름 명세는 "후보가 1건이면 해당 상세 화면으로 이동한다"고 정하고 CR-019 DEV-078이 그 이동을 위해 `from_q`까지 정했는데, **이동 자체가 없다.** `resolveScreenState`는 후보 2건 이상만 `ambiguous`로 다루고 1건은 그냥 통과시키는데, 해석 응답에는 `items`가 없어 `itemCount === null`이 되므로 화면이 `loading_initial`로 떨어진다. **40자 SHA 붙여넣기는 이 제품에서 가장 흔한 입력이고 FLOW-001은 "가장 중요한 흐름"이다** — 그것이 화면을 정지시킨다. WP-018의 DoD(FLOW-002 전 경로 E2E)를 쓰다가 드러났다 | WP-016, WP-018 / FLOW-001 4단계, FR-SRCH-001, FR-SRCH-004 | 구현 결함 | **CR-021** | **resolved (2026-08-22)** — `resolved_single` 상태를 더하고 화면이 `router.push`로 이동한다. **이동은 제출에 대한 응답으로만 일어난다** — 해석 결과에만 걸면 뒤로가기로 `/search?q=<SHA>`에 돌아오는 순간 다시 튕겨 나가 **사용자가 검색 화면에 영영 닿지 못한다**(e2e가 그것을 잡았다). 제출을 **세어서** 매단다 — 불리언이면 같은 질의를 다시 제출했을 때 URL도 의존값도 그대로라 아무 일도 일어나지 않고, 사용자는 Enter를 눌렀는데 화면이 가만히 있는 것을 고장으로 읽는다. 이동 중에도 후보 카드를 남겨 이동이 막히면 손으로 누를 수 있게 했다. `?from_q=` 부착은 세 군데(결과 행·후보 카드·자동 이동)에 있었으므로 `withFromQuery` 하나로 묶었다 — 한 곳만 인코딩을 빠뜨려도 되살아난 질의가 원본과 달라진다 |
| DEV-098 | 2026-08-22 | **`GitHubClient`에 저장소의 PR 목록을 나열하는 메서드가 없다.** WP-019의 핵심 루프가 "저장소 단위 백필: **PR 목록 페이지네이션** → 보강 → 투영"인데, 클라이언트에는 `getPullRequest(ref, number)`(단건)와 `listCommits`(커밋)뿐이다. **백필을 시작할 수단 자체가 없다** | WP-019, WP-006 / FR-ING-006 AC-1, JOB-ING-004 | 범위 공백 | **CR-022** | **resolved (2026-08-22)** — `listPullRequestsPaged`를 더한다. **정렬을 `updated asc`로 고정하는 것이 핵심이다** — 커서가 `updated_at`이어야 재개가 성립하고(AC-4), GitHub 기본값 `created desc`로 두면 **백필 도중 갱신된 PR이 페이지를 밀어** 항목이 조용히 건너뛰어진다. 이 제품에서 "수집됐다고 믿었는데 없는 PR"은 조사 결과를 통째로 틀리게 만든다 |
| DEV-099 | 2026-08-22 | **백필 문서의 `document_version`을 무엇으로 할지 정해져 있지 않다.** 투영은 `row.received_at.getTime()`(웹훅 수신 시각)을 쓰고 `ProjectionSource`의 주석이 그것을 못박는데, **백필에는 원본 이벤트 행이 없다.** 지금 시각을 쓰면 백필이 언제나 최신이 되어 **실시간 문서를 덮어쓴다** — FR-ING-006 AC-5를 정면으로 위반한다 | WP-019, WP-008 / FR-ING-006 AC-5, FR-ING-005 AC-1, ENT-CORE-002 | 범위 공백 | **CR-022** | **resolved (2026-08-22)** — **엔티티 자신의 `updated_at`**을 버전으로 쓴다. 웹훅 수신 시각은 언제나 그 엔티티가 갱신된 뒤이므로, 같은 사실에 대해 **실시간이 항상 이긴다.** 조건부 업서트가 그 비교를 이미 하고 있으니 백필이 낮은 값을 들고 오면 저절로 거절된다 — AC-5가 코드가 아니라 **수의 대소로** 성립한다. `ProjectionSource.documentVersion`의 계약을 "웹훅 수신 시각"에서 "**사실이 일어난 시각**"으로 넓혔다 |
| DEV-100 | 2026-08-22 | **백필에 `delivery_id`가 없는데 파이프라인 전체가 그것을 요구한다.** `IngestionEnriched`의 필수 필드이고, 실패 대기열이 `(delivery_id, stage)` 유니크로 색인되며, 투영이 `last_delivery_id`를 문서에 쓴다. 웹훅이 아닌 백필에는 델리버리가 없다 | WP-019, WP-007, WP-009 / EVT-ING-002, ENT-ING-003 | 범위 공백 | **CR-022** | **resolved (2026-08-22)** — **결정론적 합성 ID**를 만든다 — `backfill:{repository_id}:{pr_number}`. 두 성질이 필요해서다. (1) **결정론적**이라야 재개·재시도에서 같은 PR이 같은 키를 갖고 실패 대기열이 중복으로 쌓이지 않는다(`(delivery_id, stage)` 유니크가 그것을 전제한다). (2) **접두가 붙어야** 운영자가 실패 대기열에서 출처를 안다 — UUID 사이에 섞이면 웹훅 실패와 백필 실패를 구분할 수 없다. **`job_id`를 넣지 않는다**: 잡을 다시 실행하면 같은 PR이 다른 키를 갖게 되어 (1)이 깨진다 |
| DEV-101 | 2026-08-22 | **`prs:batch` 스트림은 있으나 백필 실행을 나르는 이벤트가 정의되어 있지 않다.** `TOPICS.batch`·소비자 그룹·파티션 3이 이미 서 있고 `EVT-JOB-001`도 있으나 그것은 진행률 **보고**(워커 → ops)이지 실행 지시가 아니다. 잡을 워커에 어떻게 전달하는지가 어느 문서에도 없다 | WP-019 / JOB-ING-004, EVT-JOB-001, 비동기 문서 3장 | 범위 공백 | **CR-022** | **resolved (2026-08-22)** — **이벤트로 나르지 않는다. 워커가 `job` 테이블을 폴링해 원자적으로 claim한다.** 이유 둘. (1) 동시 실행 상한(AC-6)을 강제하려면 어차피 DB의 원자적 검사가 필요한데, 이벤트를 함께 쓰면 **진실이 둘이 되어** 상한이 새어 나간다. (2) 중단·재개(AC-1·AC-4)는 행의 상태 전이라 이벤트로 표현하면 중단 지시와 실행 지시가 스트림에서 경합한다. `prs:batch`는 진행률(`EVT-JOB-001`)에 쓴다 |
| DEV-102 | 2026-08-22 | **동시 실행 상한 3(AC-6)을 강제할 자리가 없다.** `job_active_uk`는 같은 `(type, target)`에 활성 잡 하나를 보장할 뿐이고, **서로 다른 저장소 백필 4개가 동시에 도는 것을 막지 않는다.** 상한을 담을 설정값도 없다 | WP-019, WP-002 / FR-ING-006 AC-6, ENT-ING-004 | 범위 공백 | **CR-022** | **resolved (2026-08-22)** — claim이 `running` 개수를 세어 상한을 넘으면 잡지 않는다. `BACKFILL_MAX_CONCURRENCY`(기본 3)로 둔다. **여기 처음 적었던 기전("한 트랜잭션에 넣으면 된다")은 틀렸다** — READ COMMITTED에서는 동시에 시작한 트랜잭션들이 서로의 미커밋 갱신을 보지 못해 상한이 전혀 서지 않았다. 실제 기전은 유형 단위 advisory lock이다(**DEV-107**) |
| DEV-103 | 2026-08-22 | **`POST/PATCH /admin/jobs`가 없다. `GET`도 없다.** API 계약 표에 `API-ADM-002`가 있으나 **상세 절이 없고**, `ops/routes.ts`에는 실패 대기열·재처리·파이프라인 상태·저장소만 있다. 저장소 등록의 `backfill: true`는 `job` 행만 `queued`로 넣고 끝난다(CR-013, DEV-031) | WP-019, WP-010 / API-ADM-002, FR-ADMIN-002 | 범위 공백 | **CR-022** | **resolved (2026-08-22)** — `GET /admin/jobs[/{id}]`·`POST /admin/jobs`·`PATCH /admin/jobs/{id}`를 세우고 **API 계약에 상세 절을 함께 쓴다**. `PATCH`는 `cancel`·`pause`·`resume`만 받는다 — 임의 필드를 받으면 운영자가 진행률이나 커서를 손으로 고칠 수 있게 되고, 그러면 재개가 무엇을 이어받는지 아무도 보장하지 못한다 |
| DEV-104 | 2026-08-22 | **API 한도 소진 시 "대기 후 자동 재개"를 표현할 상태가 없다.** WP-019 DoD가 요구하는데 `job_state_chk`의 `paused`는 **운영자가 멈춘 것**과 **한도로 멈춘 것**을 구분하지 못한다. 하나로 쓰면 운영자가 목록에서 사유를 알 수 없고, 자동 재개가 **운영자의 중단까지 되살린다** | WP-019, WP-006 / FR-ING-006 예외 처리, ENT-ING-004 | 범위 공백 | **CR-022** | **resolved (2026-08-22)** — **상태를 늘리지 않는다.** `paused`는 **운영자 의도로만** 쓰고, 한도 대기는 `running`을 유지한 채 `progress.waiting_until`에 회복 시각을 남긴다. 잡은 죽지 않았고 스케줄러가 기다리는 중이므로 `running`이 사실에 가깝다. 이렇게 두면 자동 재개가 운영자 중단을 건드릴 수 없다 — **구분이 상태 이름이 아니라 구조에서** 나온다 |
| DEV-105 | 2026-08-22 | **`refresh_interval` 조정의 값과 복원 책임이 문서마다 다르다.** 작업 패키지는 "일시 **상향**", 데이터 모델은 "`30s`로 **낮췄다가** 복원"이라 적는다(같은 변경의 반대 표현이고 구체값은 데이터 모델에만 있다). 더 중요한 것은 **잡이 죽었을 때 누가 복원하는가**가 어디에도 없다는 점이다 — 그대로 남으면 인덱스가 계속 `30s`라 NFR-002(수집 반영 p95 10초)를 영구히 어긴다 | WP-019, WP-003 / FR-ING-006, NFR-002, 데이터 모델 4.4 | 문서 간 모순 | **CR-022** | **resolved (2026-08-22)** — 값은 데이터 모델의 **`30s`**를 따르고 문구를 정합화했다. 복원은 `finally`로 보장하되, **프로세스가 죽는 경우는 `finally`가 돌지 않으므로** 잡 시작 시 무조건 기본값으로 되돌린 뒤 올린다 — 앞선 잡이 남긴 설정을 다음 잡이 치운다. 설정 변경 실패는 **잡을 중단시키지 않는다**: 색인은 느려질 뿐 계속되고, 백필을 통째로 멈추는 편이 더 나쁘다 |
| DEV-106 | 2026-08-22 | **백필이 색인 실패를 성공으로 셌다.** `bulkUpsert`는 항목 단위 실패를 던지지 않고 분류해서 돌려주는데(벌크 요청 자체는 200이다), 백필의 `projectOne`이 그 결과를 **읽지 않고** 무조건 성공으로 처리했다. 매핑 거부(THR-010)나 쓰기 거부(429)로 문서가 하나도 생기지 않은 PR이 완료 보고의 실패 0건에 섞여, 운영자는 색인되지 않은 PR을 색인됐다고 읽는다 — 검색에서 그것은 "그런 PR은 없다"로 나온다. CI 통합 시험이 드러냈다(PR #21) | WP-019, WP-008 / FR-ING-005 AC-3, FR-ING-006 | 구현 결함 | 불필요 — 문서가 이미 말한 규칙(개별 실패는 모아서 보고)을 코드가 지키지 않은 것이다 | **resolved (2026-08-22)** — 재시도 사다리를 `index-retry.ts`로 뽑아 **실시간 투영과 백필이 같은 것을 쓰게** 했다. 백필은 끝내 실패한 항목이 있으면 그 PR을 `failed[]`에 넣고 잡은 계속 간다. 단위 시험 9건과 실제 거부를 만드는 통합 시험 1건을 붙였다 |
| DEV-107 | 2026-08-22 | **동시 실행 상한이 실제로는 하나도 강제되지 않았다.** DEV-102의 해소책은 "세는 것과 잡는 것을 한 트랜잭션에 넣으면 된다"였는데, PostgreSQL 기본 격리 수준(READ COMMITTED)에서 각 문장은 그때까지 **커밋된** 것만 본다. 동시에 시작한 다섯 워커는 모두 `running = 0`을 읽고 서로 다른 행을 잡아 **다섯 모두** 시작한다. `FOR UPDATE SKIP LOCKED`가 막는 것은 같은 행을 둘이 잡는 것뿐이라 아무것도 직렬화하지 않는다. CI가 잡았고(PR #21, `expected [...] to have a length of 3 but got 5`), 실제 PostgreSQL 16.13에 붙는 프로브로 재현했다 — **5회 중 4회가 5개, 1회가 4개**(상한 3) | WP-019, WP-002 / FR-ING-006 AC-6 | 구현 결함 | 불필요 — SRS가 요구한 상한을 코드가 지키지 못한 것이다 | **resolved (2026-08-22)** — claim이 세기 **전에** 유형 단위 advisory lock(`job:claim:{type}`)을 잡는다. 저장소에 이미 있는 관용구다(수집 멱등의 `ingest:{delivery_id}`, 채번의 `seq:{repo}:{branch}`). 임계 구역은 짧은 질의 둘이고 백필은 분 단위 작업이라 줄서기 비용은 무시할 수 있다. **기다리는** 락을 쓴다 — `try` 버전이면 상한에 여유가 있어도 락을 놓친 워커가 빈손으로 돌아가 큐가 느리게 빈다. 같은 프로브가 수정 뒤 5회 모두 정확히 3을 냈고, ES 없이 도는 회귀 시험 6건을 `packages/db/integration/job-claim.test.ts`에 남겼다 |
| DEV-108 | 2026-08-22 | **그래프 연산에 저장소 컨텍스트가 없다.** 백엔드 아키텍처 4.3의 `graph.isAncestor(headSha, newHead)`·`graph.mergeBase(...)`는 SHA만 받는데, git 명령은 **특정 미러 디렉터리에서** 돌아야 한다. `firstParentRevList`만 `repositoryId`를 받는다 — 같은 인터페이스 안에서 어떤 것은 저장소를 알고 어떤 것은 모른다 | WP-020 / FR-SEQ-001, ADR-005 | 문서 오류 | **CR-023** | **resolved (2026-08-22)** — 모든 그래프 연산이 첫 인자로 `RepoRef`를 받는다. API 폴백도 저장소를 알아야 호출할 수 있으므로 미러 전용 문제가 아니다 |
| DEV-109 | 2026-08-22 | **미러 루트 경로를 설정할 수단이 없다.** ADR-005의 예시에 `/mirrors/<repository_id>.git` 문자열이 있을 뿐 환경 변수도 기본값 규약도 어디에도 없다. 그대로 두면 경로가 코드에 박혀 로컬·CI에서 시험할 수 없다 | WP-020 / ADR-005, 인프라 3장 | 범위 공백 | **CR-023** | **resolved (2026-08-22)** — `MIRROR_ROOT`(기본 `/mirrors`)로 읽는다. 저장소 디렉터리 이름은 `<repository_id>.git`을 유지한다 — 소유자·이름이 바뀌어도 경로가 따라 바뀌지 않아야 미러를 다시 클론하지 않는다 |
| DEV-110 | 2026-08-22 | **미러 클론의 git 자격 증명이 정의되어 있지 않다.** ADR-005는 `git clone --mirror --filter=blob:none <repo-url>`만 적는다. 사설 저장소에는 자격 증명이 필요한데, 토큰을 remote URL에 넣으면 **`.git/config`에 평문으로 남아** 볼륨 수명 내내 존재한다 — NFR-005(로그·응답에 토큰 0건)의 취지와 THR-015(볼륨 노출)를 정면으로 거스른다 | WP-020, WP-006 / ADR-005, NFR-005, THR-015 | 범위 공백 | **CR-023** | **resolved (2026-08-22)** — **remote URL에 토큰을 넣지 않는다.** `TokenPool`이 내준 설치 토큰을 `http.extraHeader`로 **호출마다** 넘기고(`-c` 인자라 디스크에 남지 않음), 원격 URL은 자격 증명 없는 순수 URL로 저장한다. 오류 문자열은 기존 `safeMessage`를 거친다 |
| DEV-111 | 2026-08-22 | **blobless 미러에서 `patch-id`는 공짜가 아니다.** ADR-005는 "미러면 patch-id 체리픽 탐지가 가능하다"고 적지만, `git patch-id`는 diff를 요구하고 diff는 blob을 요구한다. 실측: blobless 클론(커밋 3·트리 3·**blob 0**)에서 `diff-tree -p`를 돌리자 promisor 원격에서 **blob 2개를 지연 인출해 볼륨에 남겼다.** `GIT_NO_LAZY_FETCH=1`이면 `could not fetch ... from promisor remote`로 깨끗이 실패하고 blob은 그대로 0이다. 즉 patch-id를 쓰면 **THR-015의 완화 수단("blobless라 파일 내용이 없음")이 성립하지 않고**, 인프라 5장의 용량 산정(blob 제외 저장소당 50MB)도 시간이 지나며 어긋난다 | WP-020 / ADR-005, THR-015, FR-REL-005 AC-2·AC-5, 인프라 5장 | **문서 간 모순 (실측으로 확인)** | **CR-023** | **resolved (2026-08-22)** — **요구사항을 먼저 지킨다.** THR-015와 용량 산정은 명세이고 patch-id 이점은 ADR의 `Positive` 항목이며, FR-REL-005 AC-5가 이미 `patch_id_unavailable` 경로를 정의한다. 그래서 **지연 인출을 기본으로 차단**(`GIT_NO_LAZY_FETCH=1`)하고 `patchId`는 `null` + 사유를 돌려준다. 켜는 스위치(`MIRROR_ALLOW_BLOB_FETCH`)는 두되 기본은 꺼짐이고, 켜면 무엇을 잃는지 문서에 적었다. **확정 (2026-08-22, CR-024): 꺼짐이 운영 기본값이다.** OD-001이 미러를 허용한 근거가 바로 이 실측(blob 0건)이므로 기본을 켜면 그 근거를 스스로 무너뜨린다. 함께 **FR-REL-005 AC-2를 조건부로 좁혔고**(blob 인출이 허용된 미러에 한해 수행), AC-5의 표식을 boolean에서 사유 3종(`no_mirror`/`blob_fetch_disabled`/`compute_failed`)으로 바꿔 `prs-commits` 매핑도 `keyword`로 고쳤다 — `true` 하나로는 운영자가 할 일을 고를 수 없다 |
| DEV-112 | 2026-08-22 | **커밋 메타데이터를 채우는 잡이 카탈로그에 없다.** API 계약 §커밋 상세는 "WP-020 이후 붙는 키: `parent_shas`·`message`·`author`·`committer`·`authored_at`·`committed_at`·`patch_id`·`changed_paths`…"라 적고 원장의 알려진 제한 셋도 WP-020이 닫는다고 적었으나, **WP-020의 구현 범위·DoD에는 그 항목이 없고** 잡 카탈로그에도 그것을 수행하는 잡이 없다(JOB-MIR-001은 미러 fetch 동기화뿐이다) | WP-020, WP-008 / ENT-CORE-003, API 계약 | 범위 공백 | **CR-023** | **resolved (2026-08-22, CR-024)** — 잡을 정의했다: **`JOB-MIR-002` 커밋 메타데이터 보강**, 소유 WP는 **WP-067**이다. 미러는 `git cat-file`과 `git diff-tree --name-only`로 읽고 폴백은 커밋 API로 읽으며, 둘 다 **부분 업서트만** 하고 `document_version`은 건드리지 않는다 — 이 값들은 웹훅이 나르는 상태가 아니라 Git 히스토리의 불변 사실이다. `changed_paths`는 트리만 비교하므로 blob 없이 얻어져 THR-015를 깨지 않고, **`patch_id`만 조건부다.** 아래는 WP-020 시점의 기록이다: 이 WP에서 하지 않는다. WP-020은 DoD가 검사하는 **그래프 접근 계층**을 낸다. 메타데이터 보강은 새 잡이 필요하고 그 잡은 어디에도 정의되어 있지 않다 — 없는 잡을 지어내는 대신 빈칸으로 남긴다. 그래프 계층이 서면 그 위에 잡 하나를 얹는 일이므로 **후속 CR로 정의할 것을 제안한다**. **resolved (2026-08-26, CR-038 / WP-067).** JOB-MIR-002가 섰다 — `readCommit`·`changedPaths`를 그래프에 더하고, `commit_snapshot`을 정본으로 두며, 커밋 상세·PR 상세·선행·후행이 그 값을 실제로 읽는다. 착수 전 감사가 계약의 구조적 공백 다섯을 먼저 정정했다(DEV-205~214) |
| DEV-113 | 2026-08-22 | **JOB-MIR-001의 워커 그룹이 `sequence`인데 그 역할이 아직 없다.** 잡 카탈로그가 `sequence` 그룹을 지정하지만 `sequence` 역할은 WP-021이 세운다. WP-020이 미러 동기화를 내려면 그 전에 실행 자리가 있어야 한다 | WP-020, WP-021 / JOB-MIR-001 | 범위 공백 | **CR-023** | **resolved (2026-08-22)** — `pipeline-worker`에 `mirror` 역할을 세워 그 안에서 돌린다. WP-021이 `sequence` 역할을 세우면 같은 프로세스에 합치거나 그대로 두면 된다 — **어느 쪽이든 미러 동기화의 호출 지점은 바뀌지 않는다.** 카탈로그의 그룹 표기를 `mirror`로 정정했다 |
| DEV-114 | 2026-08-22 | **`allowed_team_ids`를 읽는 곳은 넷인데 쓰는 곳이 없다.** `prs-pull-requests`·`prs-commits`·`prs-links`·`prs-releases` 네 매핑이 모두 이 필드를 선언하고, 강제 접근 범위 필터의 `org_team` 경로(`packages/es/src/scoped-query.ts:64`)와 `team:` 질의 필터(`query-builder.ts:183`)가 그것을 읽는다. 그런데 투영의 `repositoryScope()`는 `repository_id`·`repository`·`org_id`·`visibility`만 싣고 `allowed_team_ids`는 싣지 않으며, `repository` 테이블에 그 열 자체가 없다. **통합 시험이 이 사실을 가렸다** — 시험이 문서를 손으로 심으면서 `allowed_team_ids`를 직접 넣기 때문에 초록이 나온다 | WP-008, WP-010, WP-012, WP-013 / ADR-008 AC-6, FR-AUTH-002 AC-6, FR-SRCH-005 | 범위 공백 | **CR-024** | **resolved (설계) / 구현은 WP-068** — 소유권을 정했다: **레지스트리(PostgreSQL `repository`)가 주인이고 투영이 읽어 복사한다.** `EVT-ING-002`에 싣지 않는다 — 팀 권한은 PR 웹훅이 나르는 엔티티 상태가 아니라 저장소의 운영 상태이고, `document_version`은 PR의 버전이지 저장소 권한의 버전이 아니라 이벤트에 실으면 최신 판정이 불가능하다. 팀 변경 시 `update_by_query`로 소급 적용한다(`markRepositoryArchived`와 같은 형태). **지금은 유출이 아니라 누락이다** — 문서에 값이 없으니 `team:` 필터가 아무것도 못 맞히고 `org_team` 경로가 팀으로만 보이는 비공개 저장소를 덜 보여 준다. 안전한 쪽으로 실패하고 있으나 기능이 죽어 있다 |
| DEV-115 | 2026-08-23 | **`merge_sequence.committed_at`이 `NOT NULL`인데 그 값을 낼 수 있는 곳이 없다.** WP-020의 `CommitGraph.firstParentRevList`는 SHA 배열만 주고, API 폴백이 쓰는 `CommitSummary`에는 `sha`·`parents`·`commit.message`만 있어 committer 시각이 없다. 커밋 메타데이터를 채우는 `JOB-MIR-002`는 CR-024가 정의만 했고 WP-067은 `todo`다. 채번이 `insertMergeSequence`를 부르는 순간 `NOT NULL` 위반이다 | WP-021, WP-020 / ENT-SEQ-001, ADR-005 | 범위 공백 | **CR-025** | **resolved (2026-08-23)** — `CommitGraph`에 `firstParentCommits(ref, range)`를 더해 **SHA와 `committedAt`을 한 번의 walk에서 함께** 준다. 미러는 `git rev-list --first-parent --reverse --format=%H %cI`로 얻고(커밋 객체만 읽으므로 blob이 필요 없다 — THR-015를 깨지 않는다), API는 `CommitSummary`에 `commit.committer.date`를 더한다. **두 번 걸어서 합치지 않는다** — 그 사이에 강제 푸시가 나면 서로 다른 히스토리의 SHA와 시각을 섞게 되고, 그것은 아무 오류 없이 틀린 값이 된다. `firstParentRevList`는 그대로 두고 새 메서드가 그것을 대체한다 |
| DEV-116 | 2026-08-23 | **`push` 이벤트가 채번을 트리거하지 않는다.** 잡 카탈로그는 JOB-SEQ-001의 트리거를 "`push` 이벤트 / 백필 완료"로 적고 큐 구조표는 `prs:sequence` 스트림(파티션 키 `repository_id:base_branch`)을 정의한다. 그런데 게이트웨이는 push를 `prs:ingest`에만 싣고, `enrich`의 `extractTarget`이 `PR_EVENT_TYPES`에 없다며 skip·ack한다. **`prs:sequence`에 발행하는 코드가 저장소 전체에 없다.** DEV-061이 "`direct_push`는 WP-021까지 도달 불가"라 적은 것의 실체가 이것이다 | WP-021, WP-004 / JOB-SEQ-001, FR-SEQ-001 | 범위 공백 | **CR-025** | **resolved (2026-08-23)** — **게이트웨이가 push를 보고 `prs:sequence`에 직접 발행한다.** 파티션 키는 `${repository_id}:${base_branch}`이고 `ref`를 파싱해서 만든다 — 레지스트리 조회가 필요 없으므로 수신 응답 예산(NFR-002 p95 300ms)을 건드리지 않는다. `refs/tags/*`와 브랜치 삭제(`deleted: true`)는 싣지 않는다. **어느 브랜치가 채번 대상인지는 채번 워커가 판단한다**(`repository.sequence_branches`) — 레지스트리 조회를 게이트웨이에 두면 그 조회가 수신 경로의 새 실패 지점이 된다 |
| DEV-117 | 2026-08-23 | **백엔드 4.3의 `bus.requeueLater()`가 `EventBus` 포트에 없다.** advisory lock 획득 실패 시 대기하지 않고 재큐하라는 것이 AC-6의 요구인데, 그 동작을 부를 이름이 포트에 정의되어 있지 않다 | WP-021, WP-005 / FR-SEQ-001 AC-6, 백엔드 4.3 | 문서 오류 | **CR-025** | **resolved (2026-08-23)** — **새 포트 메서드를 만들지 않는다.** `HandlerDisposition`에 이미 `deferUntil(until, reason)`이 있고 Redis Streams 어댑터가 그것을 재전달로 처리한다. 락 획득 실패는 **실패가 아니라 "지금은 다른 워커가 쥐고 있음"**이므로 `retry`(재시도 예산을 소모하고 결국 실패 대기열로 간다)가 아니라 `defer`가 맞다. 문서의 이름을 실제 포트에 맞춰 정정했다 |
| DEV-118 | 2026-08-23 | **`merge_sequence.pull_request_number`의 출처가 정의되어 있지 않다.** 스키마는 그 열을 갖고 FR-SEQ-001 AC-3이 "직접 푸시는 null"이라 명시하는데, 백엔드 4.3의 `upsertMergeSequence` 호출은 그 인자를 아예 넘기지 않는다. PR↔머지 커밋 대응은 PostgreSQL에 없다 — `pull_request` 테이블 자체가 없고 ES 문서의 `merge_commit_sha`만 있다 | WP-021 / ENT-SEQ-001, FR-SEQ-001 AC-3 | 범위 공백 | **CR-025** | **resolved (2026-08-23)** — 채번이 `prs-pull-requests`를 `merge_commit_sha`로 조회해 채운다. **경합을 인정하고 설계한다**: push 이벤트가 그 PR의 투영보다 먼저 도착하면 그 순간에는 PR을 모르므로 null이 된다. 그래서 upsert를 `COALESCE(기존, 신규)`로 두어 **null은 나중에 채워지되 이미 아는 값은 덮이지 않게** 한다. 시퀀스 값 자체(AC-4의 멱등 대상)는 이 경로로 절대 바뀌지 않으며, 같은 서수에 **다른 SHA**가 오면 조용히 넘기지 않고 던진다 — 그것은 경합이 아니라 손상이다 |
| DEV-119 | 2026-08-23 | **`sequence_space`는 표시용 문자열인데 데이터 모델 질의 표가 그것으로 범위를 거른다.** API 계약의 모든 예시가 `"acme/payments@main"`이고 `SequencePosition.tsx`가 그 값을 화면에 그대로 출력한다(사람이 읽는 값이다). 그런데 데이터 모델 7장은 시퀀스 범위 조회를 `range(merge_seq) + term(sequence_space)`로, 릴리스 포함 조회를 `term(sequence_space) + range(merge_seq)`로 적는다. **저장소 소유자·이름이 바뀌면** 같은 시퀀스 공간의 문서가 두 문자열로 갈라지고, 범위 조회가 **오류 없이 절반만** 돌려준다 | WP-021, WP-023, WP-024 / ENT-CORE-001~004, FR-SEQ-002, 데이터 모델 7장 | **문서 간 모순** | **CR-025** | **resolved (2026-08-23)** — **`sequence_space`는 표시 전용으로 못박고, 범위 질의는 `repository_id` + `base_branch`로 거른다.** 두 필드는 네 매핑에 이미 있으므로 새로 저장할 것이 없다. 표시 문자열을 필터로 쓰지 않는 이유는 하나다 — 사람이 읽으라고 만든 값은 사람이 읽기 좋게 바뀌고, 바뀌는 값 위에 정확성을 세울 수 없다. 데이터 모델 질의 표를 고쳤고 WP-023·WP-024가 그것을 딛는다 |
| DEV-120 | 2026-08-23 | **`pnpm test:regression`이 없다.** WP-021의 검증 방법이 `pnpm test:regression sequence`이고 릴리스 검증 계획 7장도 "도메인 회귀 `pnpm test:regression` 주 1회 + 릴리스"로 적지만, `package.json`에 그 스크립트가 없다. DoD의 "회귀 픽스처 검증"이 걸려 있는 명령이 존재하지 않는다 | WP-021 / 릴리스 검증 계획 7·8장, ACC-02 | 범위 공백 | **CR-025** | **resolved (2026-08-23)** — WP-020이 세운 실제 git 픽스처 위에 `vitest.regression.config.ts`와 `test:regression` 스크립트를 만든다. **이번 WP가 채우는 것은 ACC-02(시퀀스-git 일치) 하나뿐이고**, 나머지 회귀 항목(ACC-01·03~08)은 각자의 WP가 채운다 — 빈 통을 만들어 놓고 "회귀 시험이 있다"고 적지 않는다 |
| DEV-121 | 2026-08-23 | **EVT-SEQ-001을 어느 스트림이 나르는지 어디에도 없다.** 이벤트 카탈로그는 Producer(`sequence`)와 Consumer(`project, ops`)만 적고 **전송 수단을 적지 않는다.** 큐 구조표는 워커 역할별 스트림만 정의한다. `project`가 읽는 `prs:enriched`에 실으면 투영 핸들러가 모양이 다른 payload를 받고, `prs:sequence`에 실으면 채번이 자기 이벤트를 다시 소비한다 | WP-021 / EVT-SEQ-001, 비동기 문서 2·4장 | 범위 공백 | **CR-025** | **resolved (2026-08-23)** — **`prs:projected`에 싣는다.** EVT-ING-003이 이미 그리로 가고 `ops`가 그 스트림을 본다. 소비자는 `event_name`으로 가른다 — 봉투에 이미 있는 필드이므로 새 규약이 필요 없다. **카탈로그에 전송 스트림 열을 더해** 다음 이벤트가 같은 빈칸을 만나지 않게 했다 |
| DEV-122 | 2026-08-23 | **채번 첫 시도가 실패하면 아무 신호도 남지 않는다 (내 코드 결함).** `markStale`이 `UPDATE`였는데, 첫 채번에서 그래프를 읽지 못하면 `ensureSequenceSpace`를 부른 트랜잭션이 롤백되어 갱신할 행이 없다. 0행이 갱신되고 그 저장소는 **`stale`로 표시되지도 `sequence_space_state` 경보가 울리지도 않은 채** 조용히 아무 시퀀스도 갖지 못한다. `last_error`도 남지 않아 운영자가 볼 수 있는 것이 하나도 없다 | WP-021 / FR-SEQ-001 예외 처리, 관측 문서 RB-10 | **코드 결함 (시험이 발견)** | **CR-025** | **resolved (2026-08-23)** — `markStale`을 `INSERT ... ON CONFLICT DO UPDATE`로 바꿨다. **시험이 먼저 잡았고**, 고친 뒤 `UPDATE`로 되돌려 시험 2건이 실패하는 것을 확인했다 — 시험이 이 결함을 실제로 잡는다는 증거다. 기존 시퀀스 값(`head_seq`·`head_sha`)은 여전히 건드리지 않는다 |
| DEV-123 | 2026-08-23 | **채번의 PR 조회가 필수 접근 범위 필터를 우회할 뻔했다 (내 코드 결함).** `findPullRequestNumber`가 `client.search`를 직접 불렀고, ADR-008을 강제하는 아키텍처 시험이 그것을 잡았다. 허용 목록에 넣으려 했으나 그 목록은 **사용자 대면 예외**(DEV-051)를 위한 것이라, 워커를 넣으면 두 갈래가 섞이고 목록이 워커 수만큼 늘어난다 | WP-021, WP-012 / ADR-008, FR-AUTH-002 | **코드 결함 (아키텍처 시험이 발견)** | **CR-025** | **resolved (2026-08-23)** — **예외를 만들지 않았다.** 이 잡은 자기가 채번하는 **저장소 하나**만 보면 되고 그것은 예외가 아니라 **정확한 접근 범위**다. 저장소 하나짜리 `explicit` 범위로 `applyMandatoryScopeFilter`를 그대로 통과한다 — 불변식에 구멍이 없고, 코드가 "이 잡은 이 저장소만 본다"를 스스로 말한다. 허용 목록에는 `kind`(`user_facing` / `no_requester`)를 더해 두 갈래를 구분해 두었다 |
| DEV-124 | 2026-08-23 | **재채번이 딛고 설 함수 둘이 리포지터리에 없다.** 백엔드 4.3의 `reassign` 의사코드가 `t.getSeqByCommit`·`t.copySequencesUpTo`를 부르지만 `merge-sequence.ts`에는 없다 | WP-022 / ENT-SEQ-001, 백엔드 4.3 | 범위 공백 | **CR-026** | **resolved (2026-08-23)** — `findSeqByCommit`(공간·에폭 안에서 SHA→서수)과 `copySequencesUpTo`(`INSERT ... SELECT`로 이전 에폭 행을 새 에폭으로 복사, `pull_request_number`·`committed_at` 포함)를 추가했다 |
| DEV-125 | 2026-08-23 | **`mergeBase`가 first-parent 체인 밖의 커밋을 줄 수 있는데 의사코드는 성공을 가정한다.** `git merge-base`는 DAG 공통 조상을 주고, 그것이 피처 브랜치 안(체인 밖) 커밋이면 `merge_sequence`에서 서수를 찾을 수 없다 — 의사코드의 `getSeqByCommit`은 그 경우를 다루지 않는다 | WP-022 / FR-SEQ-005 AC-2, 백엔드 4.3 | **문서 공백 (실패 경로 미정의)** | **CR-026** | **resolved (2026-08-23)** — **서수를 못 찾으면 처음부터 전체 재채번한다** (`baseSeq = 0`). first-parent walk가 결정론이라 히스토리가 같은 구간은 같은 서수가 재현되므로 정확성은 같고, copy는 성능·인용 보존 최적화일 뿐이다. 폴백 발동은 로그로 드러낸다 |
| DEV-126 | 2026-08-23 | **`invalidateSafeMarkers`를 실행할 수단이 스키마에 없다.** `safe_marker`에는 무효 표시 열이 없고(`superseded_at`은 "대체"지 "에폭 무효"가 아니다) 리포지터리도 없다. 저장된 검색의 `seq:` 조건 무효화는 `saved_search` 테이블 자체가 없어(REL-004) 도달 불가다 | WP-022 / FR-SEQ-005 AC-4, 백엔드 4.3, 데이터 모델 3.2 | 문서 오류 + 범위 공백 | **CR-026** | **resolved (2026-08-23)** — **저장 시점에 아무것도 쓰지 않는다.** AC-4 후반부가 이미 답을 정의한다: 표식·이분 탐색 세션·인용은 `seq_epoch`를 저장하고 있으므로 조회가 **현재 에폭과 비교해** `epoch_stale`을 계산한다. 백엔드 4.3의 `invalidateSafeMarkers` 호출을 그 규칙으로 정정했다. `saved_search` 쪽 절반은 그 테이블을 만드는 WP-033이 같은 규칙(에폭 저장 + 조회 시 비교)을 따르도록 원장에 남긴다 |
| DEV-127 | 2026-08-23 | **알림 어댑터가 없다 (DEV-026과 같은 사정).** AC-5의 "운영 콘솔 알림"과 EVT-SEQ-002의 소비자 "알림"이 걸릴 곳이 아직 없다 — 알림 소비자는 REL-005 소유다 | WP-022 / FR-SEQ-005 AC-5, EVT-SEQ-002 | 범위 공백 (이월) | **CR-026** | **resolved (2026-08-23)** — **EVT-SEQ-002 발행 + 감사 기록으로 AC-5를 성립시킨다.** 이벤트가 스트림에 남으므로 REL-005의 알림 소비자가 서면 소급 없이 흐른다. 감사 주체는 자동 감지 경로라 사람이 없으므로 `system:sequence`로 남긴다 — 신원을 지어내지 않고 "시스템이 했다"는 사실 자체를 기록한다 |
| DEV-128 | 2026-08-23 | **잡 스키마와 API 계약의 잡 유형 이름이 다르다.** `job_type_chk`는 `sequence_assign`을 허용하는데 API-ADM-007의 202 응답 예시는 `type: sequence_reassign`이다. 수동 재채번이 잡 행을 만드는 순간 CHECK 위반이다 | WP-028 / API-ADM-007, 데이터 모델 3.4 | **문서 간 모순** | **CR-026** | **resolved (2026-08-25, CR-033 / DEV-172).** 마이그레이션 009가 `job_type_chk`에 `sequence_reassign`을 추가했다 — API-ADM-007이 이미 그 이름을 안정 계약으로 쓰므로 계약이 아니라 스키마를 넓혔다. 기존 마이그레이션은 고치지 않았고 down도 함께 있다. 실제 잡 행을 넣는 통합 시험이 CHECK 통과를 고정한다 |
| DEV-129 | 2026-08-23 | **ES에 에폭 전환을 비출 수단이 없다.** 재채번 뒤 저장소 문서 전체의 `seq_epoch`가 새 값이 되어야 하는데(base 이전은 서수가 같아도 에폭은 바뀐다), SHA 목록 기반 `applySequenceToDocuments`로 전체를 넘기면 요청이 저장소 크기에 비례한다 | WP-022 / ENT-CORE-002·003, ADR-004 | 범위 공백 | **CR-026** | **resolved (2026-08-23)** — `applyEpochBump`를 추가했다: `update_by_query`로 해당 `(repository_id, base_branch)`의 `merge_seq` 있는 문서만 에폭·공간 문자열을 갱신한다. `document_version`은 건드리지 않는다. base 이후 서수 변경은 기존 `applySequenceToDocuments`가 그대로 맡는다 |
| DEV-130 | 2026-08-23 | **범위 조회의 정답지를 파생 뷰에서 읽으려 했다.** 데이터 모델 8장 질의 표는 시퀀스 범위를 `prs-pull-requests`의 `range(merge_seq)`로 적었으나, 서수의 정본은 PostgreSQL `merge_sequence`이고 Elasticsearch는 그것만으로 재구축 가능한 파생 뷰다 (ADR-004). WP-021의 채번은 **PostgreSQL을 먼저 커밋하고 뒤에 ES로 비추므로**, 비추기가 실패하면(`sequence_index_failed`) ES에는 서수가 붙지 않은 문서가 남는다. 그 상태에서 `range(merge_seq)`로 읽은 구간은 **아무 오류 없이 항목이 빠진 채** 돌아온다 — 범위 인용이 조용히 틀리는 것은 이 제품이 막으려는 실패 그 자체다 | WP-023 / FR-SEQ-002, ADR-004, ADR-007 | 문서 오류 | **CR-027** | **resolved (2026-08-23)** — 멤버십·순서·건수는 `merge_sequence`(PK 범위 스캔), 표시·요약은 ES `terms(pr_number)` + 집계로 갈랐다. 정본에 있고 색인에 없는 항목은 버리지 않고 `indexed: false` + `items_missing_in_index`로 드러낸다. git 대조 회귀 14건이 `git log --first-parent A..B`와의 일치를 강제한다 |
| DEV-131 | 2026-08-23 | **`index.sort` 조기 종료가 오름차순 범위 조회에는 서지 않는다.** 설정의 `index.sort.order`는 `merge_seq` **내림차순**인데 FR-SEQ-002는 오름차순 결과를 요구한다. 조기 종료는 검색 정렬이 색인 정렬의 접두와 같은 방향일 때만 성립하므로 방향이 어긋나면 조건이 서지 않는다. 데이터 모델 8장·백엔드 10장·WP-023 구현 범위 셋이 모두 이 기법을 근거로 인용하고 있었다 | WP-023 / FR-SEQ-002, ADR-003 | 문서 오류 | **CR-027** | **resolved (2026-08-23)** — 데이터 모델 8장·백엔드 10장에서 `index.sort` 조기 종료를 기본 정렬(내림차순) 전용으로 한정했다. 범위 조회는 ES 범위 스캔 자체를 하지 않으므로(DEV-130) 방향 문제가 성능 경로에서 사라졌다 |
| DEV-132 | 2026-08-23 | **릴리스 태그 앵커를 해석할 근거가 없다** (FR-SEQ-003 AC-1). `prs-releases`는 매핑과 부트스트랩만 있고 **쓰는 경로가 없다**(WP-024). 미러도 대안이 못 된다 — `git clone --mirror`는 태그를 가져오지만 이후 동기화는 `fetch --prune --no-tags`라 태그를 갱신하지 않으므로, 그 위에 세운 태그 해석은 **오래 전에 클론된 저장소에서만 우연히 맞는** 비결정적 기능이 된다 | WP-023 / FR-SEQ-003 AC-1, ADR-005 | 범위 공백 | **CR-027** | **resolved (2026-08-23, WP-024로 이월)** — `release` 앵커는 `ANCHOR_UNRESOLVABLE` + `detail.reason: "release_not_indexed"`를 반환한다. 미러 태그로 구현하지 않은 이유를 API 계약에 남겼다 — `fetch --no-tags`라 오래된 클론에서만 우연히 맞는 비결정 기능이 된다. WP-024 구현 범위에 이월 항목을 명시했다 |
| DEV-133 | 2026-08-23 | **`summary.reverted_pull_request_count`를 지금 세면 언제나 `0`이 나온다.** 투영이 `link_summary.is_reverted`를 `createOnly`로 `false`만 넣고, 그 값을 참으로 바꾸는 되돌림 파생은 WP-030이다. `0`은 "되돌림이 없다"와 구분되지 않으므로 세는 것 자체가 거짓말이 된다 | WP-023 / FR-SEQ-002 AC-2, FR-SEQ-004 AC-2 | 범위 공백 | **CR-027** | **resolved (2026-08-23, WP-030으로 이월)** — 요약에서 키를 뺐다. 계산하지 않은 것은 0이 아니라 부재다. API 계약 필드 근거 표와 WP-030 구현 범위에 명시했다 |
| DEV-134 | 2026-08-23 | **`top_changed_paths`의 값 단위가 정해져 있지 않다.** API 계약 예시는 `src/payment` 같은 디렉터리로 보이나 `changed_paths`가 담는 것은 파일 경로이고, 디렉터리 롤업 깊이를 정한 문서는 하나도 없다. 예시를 따르려면 깊이를 발명해야 한다 | WP-023 / FR-SEQ-002 AC-2 | 문서 오류 | **CR-027** | **resolved (2026-08-23)** — 파일 경로로 확정했다(`changed_paths.raw` `terms` 집계, 단일 샤드 라우팅이라 정확). 디렉터리 롤업 깊이는 정한 문서가 없어 발명하지 않았고 API 예시를 파일 경로로 정정했다 |
| DEV-135 | 2026-08-23 | **요약의 합계가 하한일 수 있는데 그 사실을 말할 자리가 없다.** PR 문서의 `changed_files_count`·`additions`·`deletions`·`changed_paths`는 `files_truncated`가 참이면 "가져온 만큼"이다(WP-007의 절삭). `changed_files_total` 등을 그대로 내면 사용자는 그것을 전수로 읽는다 | WP-023 / FR-SEQ-002 AC-2, FR-ING-004 | 범위 공백 | **CR-027** | **resolved (2026-08-23)** — `summary.files_truncated_pull_request_count`를 추가했다. 양수면 합계 셋이 하한이라는 뜻이다 |
| DEV-136 | 2026-08-23 | **`q`가 요약에도 적용되는지 정해져 있지 않다.** WP-023은 `q`를 "구간 내 추가 필터"라고만 적는다. 목록만 좁히고 요약은 구간 전체를 말하면 화면의 두 영역이 서로 다른 집합을 설명해 고장난 것으로 읽힌다 | WP-023 / FR-SEQ-002 AC-2 | 범위 공백 | **CR-027** | **resolved (2026-08-23)** — `q`는 목록과 요약 양쪽에 적용된다. 부재 계수는 `q`와 무관하게 유지하기 위해 `q`가 있으면 거르지 않은 건수를 한 왕복 더 센다 — 변이 시험(M13)이 이 구분의 필요를 실증했다 |
| DEV-137 | 2026-08-23 | **시퀀스 공간이 없는 저장소·브랜치의 응답이 정해져 있지 않다.** `sequence_space`에 행이 없으면 `state`를 `unknown`으로 200을 내는 길이 있는데, 그러면 빈 결과가 "그 구간에 아무것도 없다"로 읽힌다. 채번된 적이 없는 것과 비어 있는 것은 다르다 | WP-023 / FR-SEQ-002 | 범위 공백 | **CR-027** | **resolved (2026-08-23)** — 저장소 없음·범위 밖·채번된 적 없는 공간 셋 다 404다. 범위 밖을 403으로 가르면 비공개 저장소의 존재가 알려진다 |
| DEV-138 | 2026-08-23 | **`next_cursor`의 값을 낼 수단이 없다.** 커서 페이지네이션은 WP-032다. `/search`와 같은 사정이며 같은 처리(키는 두고 늘 `null`)가 필요하다 | WP-023 / ADR-010 | 범위 공백 | **CR-027** | **resolved (2026-08-23)** — `/search`와 같은 처리: 키는 두고 늘 `null`. WP-032 몫 |
| DEV-139 | 2026-08-23 | **`summary.commit_count`가 무엇을 세는지 정해져 있지 않다.** 구간의 first-parent 커밋 수인지 PR의 원본 커밋까지 포함한 수인지에 따라 값이 한 자릿수 배 차이 난다. API 예시의 `commit_count == pull_request_count == 62`는 전자와만 맞는다 | WP-023 / FR-SEQ-002 AC-2 | 문서 오류 | **CR-027** | **resolved (2026-08-23)** — first-parent 커밋 수(= `merge_sequence` 행 수)로 확정했다. `git log --first-parent A..B`가 세는 것과 같은 것을 센다. API 계약 필드 근거 표에 명시 |
| DEV-140 | 2026-08-23 | **"5만 건 사전 추정"이 실은 정확히 셀 수 있다.** DEV-130의 결정으로 정본이 PostgreSQL이 되면 `count(*)`가 PK 범위 스캔 한 번이라 추정할 이유가 없다. 추정으로 두면 상한 근처에서 통과와 거절이 흔들린다 | WP-023 / FR-SEQ-002 AC-4 | 문서 오류 | **CR-027** | **resolved (2026-08-23)** — `countRange`가 정확한 count를 낸다. 5만+1행 실데이터로 400과 경계(정확히 5만이면 통과)를 실측했다. 응답 필드 이름은 하위 호환으로 `estimated_count`를 유지하되 `exact: true`를 함께 싣는다 |
| DEV-141 | 2026-08-23 | **`multiSearch`가 헤더 전용 파라미터 `routing`을 본문에 실었다** (내 구현 결함, CI 실-ES 계층이 검출). `search` API에서는 클라이언트가 `routing`을 쿼리스트링으로 올려 주지만 `msearch`의 옵션은 해석 없이 NDJSON 본문 줄에 그대로 실린다 — 본문의 `routing`을 Elasticsearch가 400으로 거절해 **범위 조회의 ES 왕복 전부가 실패했다.** 대역 시험 62건은 아무 키나 받아 전부 초록이었고, PR #28 CI의 `range-es.test.ts`(실제 ES) 11건이 처음 잡았다 — 실-ES 계층을 따로 둔 이유가 정확히 이 결함이다. 기존 `multiSearch` 사용처(완화 힌트)는 라우팅을 쓰지 않아 드러나지 않았다 | WP-023 / API-SEQ-001 | 구현 결함 | - (문서가 msearch 전송 형식을 규정하지 않아 계단식 갱신 없음) | **resolved (2026-08-23)** — `multiSearch`가 `routing`을 헤더 줄로 옮긴다. `search.test.ts` 4건이 전송 모양을 단위에서 고정 — 결함을 되돌리면 2건이 실패함을 확인했다. ES 없이도 회귀가 막힌다 |
| DEV-142 | 2026-08-24 | **릴리스 엔티티가 검색 인덱스에만 존재하도록 설계됐다.** 데이터 모델 3장 ENT-REL-001의 저장 위치가 Elasticsearch, 갱신 주체가 projection이다 — ADR-004("어떤 데이터도 검색 인덱스에만 존재해서는 안 된다") 위반이고, 정본을 PostgreSQL로 정한 DEV-130과 정면 충돌한다. 포함 판정·릴리스 앵커가 ES에만 있는 데이터를 딛으면 색인 반영 실패가 오류 없이 항목을 빠뜨리는 실패가 재현된다 | WP-024 / ENT-REL-001, ADR-004, FR-REL-002 | **문서 간 모순** | **CR-028** | **resolved (2026-08-24)** — 마이그레이션 008이 PostgreSQL `release` 표를 신설해 정본으로 삼았다. ENT-REL-001의 저장 위치를 "PostgreSQL (정본) + Elasticsearch (투영)"으로 고치고 DDL을 데이터 모델 3.2에 실었다. 포함 판정(`/containments`)과 릴리스 앵커는 정본만 읽으며, `prs-releases`·`release_tags`는 표시 전용 투영이라 색인 실패는 표시 지연이지 판정 오류가 아니다 |
| DEV-143 | 2026-08-24 | **DEV-132의 기록된 사유가 실측으로 반증됐다.** "미러는 `fetch --no-tags`라 태그를 갱신하지 않는다"고 적었으나, `--mirror` 클론의 refspec `+refs/*:refs/*`는 `--no-tags`와 무관하게 refs/tags/*를 옮긴다 — 새 태그·주석 태그·삭제(prune) 전부 반영됨을 합성 저장소로 실측했다. `for-each-ref refs/tags --format='%(refname:short)|%(creatordate:iso-strict)|…peel'` 한 번으로 태그명·시각·커밋 SHA가 나온다. 이월 결정 자체는 옳았으나(쓰는 경로 부재) 이유가 틀렸고, 틀린 이유가 문서에 남으면 다음 구현자가 미러를 배제한다 | WP-024 / ADR-005, ADR-007, DEV-132 | 기록 오류 (실측 반증) | **CR-028** | **resolved (2026-08-24)** — 합성 저장소 실측을 근거로 API 계약의 DEV-132 문단과 데이터 모델을 정정했다. `listTags`는 `for-each-ref refs/tags --format='%(refname:short)%00%(creatordate:iso-strict)%00…peel'` 하나로 태그명·시각·peel된 커밋을 전량 열거한다(주석 태그는 `%(*objectname)`). 형식이 어긋난 줄은 건너뛰지 않고 던진다 — 조용히 빼면 diff가 그 태그를 삭제로 읽는다 |
| DEV-144 | 2026-08-24 | **릴리스 수집의 잡·이벤트·스트림이 카탈로그에 없다** (DEV-116과 같은 모양). `release`·`create`는 게이트웨이가 받아 `raw_event`에 저장하고 `prs:ingest`에 싣지만 enrich가 "PR 이벤트가 아니다"로 버린다 — 릴리스를 처리하는 소비자가 어디에도 없다. JOB-REL-001~006은 전부 간선 파생(WP-029+)이다 | WP-024 / JOB-REL-*, EVT 카탈로그 2·5장 | 범위 공백 | **CR-028** | **resolved (2026-08-24)** — `prs:release` 스트림(그룹 `release`, 파티션 키 `repository_id`, 전체 기본 4)·JOB-REL-007·EVT-REL-001을 비동기 카탈로그 2·4·5장에 등록하고 그대로 구현했다. 워커 `release` 역할이 신호 소비와 6시간 보정 스윕을 돈다 |
| DEV-145 | 2026-08-24 | **태그 push의 실시간 신호가 버려진다.** `extractPushTarget`은 `refs/tags/*`를 "브랜치 push가 아니다"로 skip한다 — 채번 대상이 아니니 옳은 판정이지만, 릴리스 갱신의 실시간 트리거로는 바로 그 이벤트가 필요하다. `release`(published)·`create`(tag)도 마찬가지로 추출 없이 저장만 된다 | WP-024 / FR-REL-002, EVT-ING-001 | 범위 공백 | **CR-028** | **resolved (2026-08-24)** — `extractReleaseSignal`(packages/domain)이 `push(refs/tags/*)`·`create(tag)`·`delete(tag)`·`release`를 신호로 가른다. 게이트웨이 5d 단계가 발행하며 실패해도 202를 막지 않는다(다음 신호·스윕이 메운다). 채번의 skip 판정은 그대로다 — 두 소비자가 같은 push를 다르게 읽는 것이 맞다 |
| DEV-146 | 2026-08-24 | **`RELEASE_NOT_INDEXED`의 상태 코드가 모순이다.** `error-codes.ts`와 API 계약 6장은 404로 매핑하는데, FR-REL-002 예외 처리는 "빈 배열과 사유 코드 `release_not_indexed`를 **함께** 반환한다" — 조회 자체는 성공(200)이고 사유가 본문에 실린다는 뜻이다. C-020도 `release_not_indexed`를 오류 화면이 아니라 상태로 갖는다 | WP-024 / FR-REL-002, API-REL-002 | 문서 간 모순 | **CR-028** | **resolved (2026-08-24)** — FR-REL-002 예외 처리가 이긴다: `/containments`는 **200 + `reason: "release_not_indexed"`**를 반환하고, 오류 코드 표의 404는 릴리스 자체를 대상으로 하는 조회(릴리스 앵커의 `ANCHOR_UNRESOLVABLE` detail 등)에 남는다. C-020은 ready/unreleased/release_not_indexed/not_sequenced 네 상태를 가른다 — 뭉치면 미수집 저장소의 PR에 "판정했다"는 거짓 배지가 붙는다 |
| DEV-147 | 2026-08-24 | **`released_at`의 뜻이 정해져 있지 않다.** 주석 태그는 taggerdate가 있고 경량 태그는 없으며(커밋 시각뿐), GitHub Release는 제3의 값 published_at을 갖는다. 셋 중 무엇인지에 따라 "시각 오름차순"(AC-3)의 순서가 달라진다 | WP-024 / FR-REL-002 AC-3, ENT-REL-001 | 빈칸 | **CR-028** | **resolved (2026-08-24)** — `released_at` = git `creatordate`(주석 태그 taggerdate, 경량 태그는 커밋 시각)를 기본으로 하고, GHE 자격 증명이 있으면 GitHub Release `published_at`이 덮으며 `source: github_release`로 표시한다(draft는 제외). GHE 조회 실패는 경고 후 creatordate로 계속한다 — 덮어쓰기는 보강이지 의존이 아니다 |
| DEV-148 | 2026-08-24 | **`release_tags` "상위 5개"의 상위가 무엇 기준인지 정해져 있지 않다.** 가장 이른 5개인지, 최신 5개인지에 따라 목록 배지의 뜻이 달라진다 | WP-024 / 데이터 모델 5장 | 빈칸 | **CR-028** | **resolved (2026-08-24)** — **가장 이른 5개**로 정의하고 데이터 모델 5장에 적었다. "어느 배포에 처음 들어갔는가"가 SCN-004의 질문이므로 최신이 아니라 최초가 답이다. 워커가 시각 오름차순으로 보내고 painless가 앞에서부터 5개에서 멈춘다 — 순서가 곧 정의라서 워커 통합 시험이 역순 변이를 잡는다(6.24장 M10) |
| DEV-149 | 2026-08-24 | **에폭 전환 시 릴리스 서수의 무효 처리가 정해져 있지 않다.** 릴리스의 `merge_seq`는 `seq_epoch`에 묶이는데, 재채번(WP-022)이 에폭을 올리면 이전 에폭으로 저장된 릴리스 서수는 다른 커밋을 가리킬 수 있다. FR-SEQ-005 AC-4의 원칙(저장 시점 쓰기가 아니라 현재 에폭과 비교)이 여기에도 적용되어야 한다 | WP-024 / FR-SEQ-005 AC-4, ENT-REL-001 | 빈칸 | **CR-028** | **resolved (2026-08-24)** — 릴리스 서수는 에폭에 묶인 스냅숏이다: 갱신마다 전 태그를 **현재 에폭**으로 재해석하고, 재채번(EVT-SEQ-002) 후 갱신 신호를 발행하며(스윕이 예비), 읽기는 현재 에폭 행만 신뢰한다 — 포함 판정은 에폭 불일치를 `target_not_sequenced`로 답하고, 릴리스 앵커는 표의 서수 대신 `findPointByCommit`을 현재 에폭으로 다시 묻고, 비정규화는 `seq_epoch`까지 걸러 옛 에폭 문서에 새 배지를 달지 않는다 |
| DEV-150 | 2026-08-24 | **QA-W004-10의 "되돌림 관계 보유 PR 수"는 WP-030 전에 데이터가 없다.** DEV-133이 API 요약에서 `reverted_pull_request_count` 키 자체를 빼기로 정했으므로("세면 언제나 0이라 계산하지 않은 것을 계산한 척하지 않는다"), 화면도 그 값을 그릴 수 없다 | WP-025, WP-030 / QA-W004-10, FR-SEQ-004 AC-2 | 문서 간 모순 (DEV-133 연장) | **CR-029** | **resolved (2026-08-24)** — QA-W004-10을 갈랐다: 넷(PR·커밋·작성자·변경 규모)+경로 상위는 지금, 되돌림 수 자리는 `준비 중 — 관계 파생(WP-030)` 표기. `judgeSummary`는 키가 실려 오는 날 화면 수정 없이 값이 서도록 키 존재로 판정한다 |
| DEV-151 | 2026-08-24 | **WP-025 DoD "상태 매트릭스 W-004의 전 상태 렌더링"이 제외 범위의 상태를 포함한다.** 상태 정의에는 안전 구간 표식·이분 탐색의 상태(`bisect_contradiction` 등)가 있는데 그 기능은 WP-041·WP-042다 — 도달 불가 상태는 검증할 수 없으므로 만들지 않는다(DEV-087의 교훈) | WP-025, WP-041, WP-042 / W-004 상태 정의 | 범위 공백 | **CR-029** | **resolved (2026-08-24)** — DoD를 도달 가능 부분집합 13종으로 명시했다(작업 패키지 WP-025). 표식·이분 상태는 WP-041·042와 함께 생긴다 |
| DEV-152 | 2026-08-24 | **C-027 SequenceSpaceSelector의 `repositories`·`branches` 목록을 줄 일반 사용자용 API가 없다.** 저장소 목록은 `/api/v1/admin/repositories`(관리자 게이트)뿐이라 개발자·릴리스 매니저가 W-004에 들어와도 셀렉터를 채울 수 없다. 검색 화면은 자유 질의라 이 공백이 드러나지 않았다 | WP-025 / C-027, FR-SEQ-001, W-004-SPACE | 범위 공백 | **CR-029** | **resolved (2026-08-24)** — `GET /sequence-spaces`(API-SEQ-006) 신설. 세션 인증 + `isRepositoryInScope`(단건 판정과 같은 함수)로 거르고, 채번 이력 없는 브랜치는 숨기지 않고 `unknown`+에폭 null로 싣는다. 범위 밖 저장소는 결과에 없고 그 부재 외에 아무것도 새지 않는다 |
| DEV-153 | 2026-08-24 | **딥링크 경로가 문서 간 모순이다.** 셸 내비게이션(`lib/nav.ts`, WP-015 구현·병합)은 `/ranges`를 소유하는데 IA·와이어프레임·화면 흐름·프론트 아키텍처는 `/range`이고, IA는 파라미터를 `space=` 하나로, 화면 흐름은 `repo`·`branch` 분리로 적는다. 표시 문자열(`space`)을 파라미터로 쓰면 DEV-119와 같은 실패가 재현된다 | WP-025, WP-015 / W-004 진입 경로, IA 4장 | 문서 간 모순 | **CR-029** | **resolved (2026-08-24)** — 구현된 셸 쪽(`/ranges`, `repo`·`branch` 분리)으로 통일하고 IA·와이어프레임·화면 흐름·프론트 아키텍처를 정정했다. `space=` 표시 문자열은 파라미터로 쓰지 않는다(DEV-119). `q`는 WP-032 |
| DEV-154 | 2026-08-24 | **WP-025의 "C-013 ResultTable 재사용"이 계약과 어긋난다.** C-013은 정렬 컨트롤(정렬 변경 시 서버 재조회)을 갖는 W-001 전용 표인데, 범위 결과는 **시퀀스 오름차순 고정**(QA-W004-11)이고 API-SEQ-001에 정렬 파라미터가 없다 — 부분 페이지를 클라이언트에서 재정렬하면 거짓이 된다. 게다가 범위 항목은 `indexed: false`(정본에만 있는 항목, DEV-130) 표기가 필요한데 C-013 행 모양에 그 자리가 없다 | WP-025 / C-013, QA-W004-11, API-SEQ-001 | 문서 간 모순 | **CR-029** | **resolved (2026-08-24)** — 전용 `RangeResultTable`로 그린다: 서수 오름차순 고정(서버 순서 신뢰, 재정렬 없음 — 변이가 검증), `indexed:false` 행은 `색인 대기` 배지와 확정값만. C-013은 W-001 전용으로 남는다 |
| DEV-155 | 2026-08-25 | **C-032 ReleaseTimeline이 읽을 릴리스 목록 API가 없다.** API 카탈로그에 저장소 단위 릴리스 목록이 없고, 프론트 아키텍처는 W-005가 API-SEQ-003만 쓴다고 적는다. `/containments`(API-REL-002)는 **대상을 지목해** 묻는 조회이고 `/release-comparisons`(API-SEQ-003)는 **구간 비교**라, "이 저장소의 릴리스들"을 줄 경로가 어디에도 없다 — C-027의 공간 목록이 없던 DEV-152와 같은 모양이다. 목록의 "직전 릴리스 대비 PR 수"(QA-W005-06)를 낼 함수도 없다: `countRange`는 커밋을 세고 `countPullRequestsAbove`는 한쪽만 센다. "직전"이 시각 기준인지 서수 기준인지도 정해져 있지 않다 | WP-026 / C-032, W-005-LIST, QA-W005-06, FR-SEQ-004 | 범위 공백 | **CR-030** | **resolved (2026-08-25)** — `GET /releases`(API-REL-005)를 세웠다. 저장소 스코프, 현재 에폭 체인에서 `commit_sha`로 서수 재확인(DEV-149), 값은 `(previous.merge_seq, merge_seq]`의 PR 문서 수, "직전"은 서수 기준이며 비교 대상 태그명을 함께 싣는다. 서수 최저 릴리스는 `null`이다. 변이(서수 차로 세기)가 통합 시험에 킬됐다 |
| DEV-156 | 2026-08-25 | **API-SEQ-003의 응답 예시가 실측 요약과 어긋난다.** CR-027(DEV-133)이 API-SEQ-001 요약에서 뺀 `reverted_pull_request_count`가 이 절에는 남아 있고, 반대로 같은 `RangeSummary`가 내는 `commit_count`·`files_truncated_pull_request_count`·`top_changed_paths`와 봉투의 `sequence_state`·`epoch_stale`·`requested_seq_epoch`·`items_missing_in_index`·`unresolved`(WP-022·023)는 예시에 없다. 요청 파라미터(`size`·`seq_epoch`)와 `to=unreleased`일 때 `from`의 기본값도 미정이다 | WP-026 / API-SEQ-003, FR-SEQ-004 AC-2·AC-4·AC-5 | 문서 오류 | **CR-030** | **resolved (2026-08-25)** — 절을 실측 계층에 맞춰 재작성하고 그대로 구현했다. `runRange` 재사용으로 W-004와 W-005가 같은 구간에 같은 숫자를 말한다. `size=0`이 항목 질의를 **정말** 건너뛰는지는 응답만으로 검증되지 않으므로(LIMIT 0도 `items`는 빈 배열이다) 질의를 세는 단위 시험으로 고정했다 |
| DEV-157 | 2026-08-25 | **W-005의 경로가 셸이 소유한 것과 다르다.** 셸 내비게이션(`lib/nav.ts`, WP-015 구현·병합)은 `/releases`를 항목으로 갖는데 와이어프레임·프론트 아키텍처는 `/releases/[owner]/[repo]`이고 WP-026은 `?select=`를 더한다 — **지금 "릴리스"를 누르면 404다.** 렌더링 방식도 "서버"로 적혀 있으나 체크박스 선택과 상세 조회는 클라이언트다 | WP-026, WP-015 / W-005 진입 경로, 프론트 라우트 표 | 문서 간 모순 | **CR-030** | **resolved (2026-08-25)** — 셸이 소유한 `/releases?repo=&branch=`로 통일하고 화면을 그 경로에 세웠다. 렌더링은 서버 셸 + 클라이언트 조회. `select=`는 쓰지 않는다 — 선택은 화면 상태이고 인용은 W-004의 URL이 갖는다. e2e가 **내비게이션 "릴리스" 클릭 → 화면 표시**를 실제 브라우저에서 건다(이 항목은 이 WP 전까지 404였다) |
| DEV-158 | 2026-08-25 | **QA-W005-03(다른 브랜치 릴리스 2건 선택 차단)이 브랜치 고정 목록에서는 도달 불가다.** 딥링크가 `?branch=`로 공간을 고정하면 타임라인에 한 브랜치의 릴리스만 있어 그 상황 자체를 만들 수 없고, 검증할 길이 사라진다. `release` 표는 저장소 단위이며 `base_branch`가 nullable이라(체인 밖 태그) C-032의 `ReleaseRow`에 그 행의 자리도 없다 | WP-026 / QA-W005-03, FR-SEQ-004 AC-3, C-032 | 범위 공백 | **CR-030** | **resolved (2026-08-25)** — 목록을 저장소 스코프로 두고 화면은 `branch`를 **보내지 않는다**(a11y 시험이 요청 URL로 고정). 서수 없는 릴리스는 표시하되 체크박스를 비활성하고 사유를 `aria-describedby`로 말한다. QA-W005-03이 a11y·e2e 양쪽에서 실제로 도달한다 |
| DEV-159 | 2026-08-25 | **`empty_no_release`와 `not_indexed`를 판별할 근거가 없고, `not_indexed`의 복구 경로가 아직 없다.** `repository` 표에 릴리스 동기화 마커가 없어 "태그가 0개인 저장소"와 "아직 한 번도 받지 않은 저장소"가 서버에게 같은 관측(`hasAnyRelease` = false)이다. 상태 매트릭스는 그 둘을 다른 안내로 가르는데, 판별할 수 없는 것을 두 상태로 그리면 **둘 중 하나는 반드시 거짓이 된다**. 복구 경로 W-009(`/repositories`)는 P1(REL-004~005)이라 링크 대상 자체가 없다 | WP-026, W-009 / 상태 매트릭스 W-005, QA-W005-05, FR-SEQ-004 | 범위 공백 | **CR-030** | **resolved (2026-08-25)** — 상태를 `release_not_indexed` 하나로 합치고 두 원인을 한 안내에서 함께 말한다(API도 200 + `reason`). W-009 링크는 걸지 않았고 QA-W005-05는 DoD에 **절반 통과**로 남겼다 — 없는 경로로 보내지 않는다 |
| DEV-160 | 2026-08-25 | **포함 판정이 릴리스의 저장 서수를 읽어, 이미 배포된 PR이 "미배포"로 보인다.** 앵커 해석은 DEV-149대로 현재 에폭 체인에서 커밋을 다시 찾는데, `findContainingReleases`·`findLatestReleaseSeq`는 `release` 표의 `base_branch`·`merge_seq`를 **조건으로** 쓴다. 동기화(JOB-REL-007)가 채번보다 먼저 돌면 그 둘이 `NULL`인 채 커밋만 체인 위에 있고, 그러면 그 릴리스가 포함 목록에서 통째로 빠진다. WP-024의 통합 시험 픽스처가 그 상태(`resynced-later`)를 이미 담고 있었으나 **기대값이 빠진 답을 정답으로 굳혀 두고 있었다** — 초록이 곧 검증은 아니다의 또 한 사례다. WP-026의 미배포 구간(`to=unreleased`)이 타임라인과 **다른 시작점**을 잡으면서 드러났다: 목록은 서수를 다시 찾고 미배포는 저장 열을 읽어, 같은 화면의 두 숫자가 어긋났다 | WP-026, WP-024 / API-REL-002, API-SEQ-003, FR-REL-002 AC-4·AC-5, DEV-149 | 구현 결함 | 불필요 — DEV-149가 이미 정한 규칙("읽기는 현재 에폭 행만 신뢰한다")을 코드가 지키지 못한 것이다 | **resolved (2026-08-25)** — 판정을 하나로 모았다: 릴리스 서수는 언제나 현재 에폭 체인에서 `commit_sha`로 다시 찾는다(`findContainingReleases`는 `merge_sequence` 조인, `findLatestReleaseSeq`는 `findLatestRelease`에 위임). WP-024 통합 시험 5건의 기대를 정정하고, 뜻을 고정하는 회귀 시험을 더했다. 고치고 나니 서수 4까지가 전부 배포된 상태가 되어 **미배포를 검증할 대상이 픽스처에서 사라졌으므로** 체인에 서수 5(PR 44)를 더했다 |
| DEV-161 | 2026-08-25 | **이웃의 단위가 SRS와 API 계약에서 다르다.** FR-REL-001의 요구사항 문장은 "시퀀스 값이 인접한 **PR**"이고 AC-2도 PR 번호를 요구하는데, API-REL-001 응답 예시에는 `kind: "commit"`·`pr_number: null`(직접 푸시)이 섞여 있다. PR만 실으면 목록의 서수가 `1339 → 1341`처럼 건너뛴 채 보이고 사용자는 그것을 **누락으로 읽는다** — "서수는 `git log --first-parent`로 검증 가능해야 한다"(ADR-007)는 불변식이 화면에서 깨진다 | WP-027 / FR-REL-001 AC-2, API-REL-001, C-019 | 문서 간 모순 | **CR-031** | **resolved (2026-08-25)** — SRS v2.4대로 커밋을 포함해 구현했다. 통합·단위·a11y·e2e 네 계층이 **서수 연속성**을 각각 단언하며, 목록에서 직접 푸시를 거르는 변이가 통합 3건에 킬됐다 |
| DEV-162 | 2026-08-25 | **선행·후행을 진입 조회로 만들면 WP-017이 세운 규율이 깨진다.** WP-017은 "진입 시 요청은 PR 문서 하나뿐"을 a11y·e2e 다섯 곳에 걸었고(`expect(calls).toHaveLength(1)`), WP-024는 C-020이 진입 조회를 하다 **CI에서 걸려** 확장 조회로 되돌린 전력이 있다(6.24장). 그런데 와이어프레임은 선행·후행을 진입 레이아웃에 그리고, IA 원칙 4는 지연 조회 대상으로 관계·동시 변경만 적는다 | WP-027, WP-017, WP-024 / QA-W002-17, IA 원칙 4 | 문서 간 모순 | **CR-031** | **resolved (2026-08-25)** — C-020과 같은 컨테이너 구조(접힘 기본 + 펼칠 때 1회). 건수 변경만 재조회한다. 진입 조회로 되돌리는 변이가 a11y 4건·e2e 2건에 킬됐다 — 첫 시도한 토큰 변이는 **등가**였고(접을 때는 이미 `idle`이 아니다) 마운트 조회로 바꾸자 잡혔다 |
| DEV-163 | 2026-08-25 | **W-003의 앵커가 없다.** WP-027 범위는 "W-003 시퀀스 위치 섹션 연결"인데 API-REL-001은 `pr_number`만 받는다 — **직접 푸시 커밋은 PR이 없어** 자기 위치를 물을 수 없다. 프론트 아키텍처의 `/commit/...` 행에는 API-REL-001이 아예 없어 문서끼리도 어긋난다 | WP-027, WP-018 / API-REL-001, W-003-SEQPOS | 범위 공백 | **CR-031** | **resolved (2026-08-25)** — `commit_sha` 앵커를 세우고 W-003이 그것으로 부른다. 앵커가 둘이거나 없으면 400이다. 커밋 앵커를 PR로 바꾸는 변이가 a11y에 킬됐다 |
| DEV-164 | 2026-08-25 | **미머지와 미채번을 API가 가르지 않는다.** 계약은 409 `NO_SEQUENCE` 하나뿐인데, C-014는 `unassigned`(미머지)와 `not_computed`(미채번)를 **절대 같이 그리지 말라**고 못 박는다(CR-019, DEV-077) — 전자는 사실 주장이고 후자는 "아직 모른다"다. 머지됐으나 채번 전인 PR은 어느 쪽으로도 답할 수 없다 | WP-027 / FR-REL-001 예외 처리, C-014, API-REL-001 | 빈칸 | **CR-031** | **resolved (2026-08-25)** — 서버는 `NO_SEQUENCE` 아래 `not_merged`(+`state`)와 `not_sequenced`를 가르고, 화면은 **미머지면 요청 자체를 하지 않는다**. 커밋 화면은 역할로 체인 밖까지 알아 세 문구가 서로 다르다. 사유를 모를 때 미머지로 단정하는 변이가 단위에 킬됐다 |
| DEV-165 | 2026-08-25 | **QA-W002-16(에폭 경고)의 소유자가 없다.** WP-017이 DEV-087로 "도달 불가라 만들지 않는다 — WP-021이 시퀀스를 채울 때 감지 경로와 함께 정한다"며 이월했는데, WP-021·022가 서서 W-002가 실제 서수를 그리는 지금도 어느 WP의 DoD에도 없다. **이월의 조건이 충족됐는데 이월된 사실만 남았다** | WP-027, WP-017, WP-021 / QA-W002-16, FR-SEQ-005 AC-4, DEV-087 | 범위 공백 | **CR-031** | **resolved (2026-08-25)** — W-002 에폭 경고를 세웠다(QA-W002-16). PR 문서의 에폭과 응답의 현재 에폭을 비교하며 **자동 재조회하지 않는다** — 경고 뒤에도 조회가 한 번뿐임을 a11y가 계수로 건다. DEV-087의 이월이 닫혔다 |
| DEV-166 | 2026-08-25 | **이웃 항목에 `indexed`·`url`이 없다.** 범위 결과는 DEV-130대로 정본에는 있고 색인에 없는 항목을 서수·SHA만으로 그리고 "색인 대기"를 밝히는데, 같은 두 소스(PostgreSQL 정본 + Elasticsearch 표시값)를 쓰는 이웃 목록에는 그 자리가 없다 — 색인이 늦은 이웃이 조용히 빠지거나 제목 없는 행이 된다. 직접 푸시 커밋은 보강 전까지 **언제나** 그 상태다 | WP-027 / API-REL-001, C-019, DEV-130 | 빈칸 | **CR-031** | **resolved (2026-08-25)** — 항목에 `indexed`·`url`을 싣고 색인 미반영 행을 "색인 대기"로 그린다. 이웃 선택 자체가 PostgreSQL이라 색인 지연이 목록을 줄이지 못한다 |
| DEV-167 | 2026-08-25 | **"범위로 확장"이 넘길 앵커가 정의되어 있지 않다.** W-002·W-003 와이어프레임 모두 "범위 조사 확장 링크"라고만 적고 `from`·`to`가 무엇인지 없다. 구간은 두 앵커를 요구하는데 화면에는 기준 개체 하나뿐이다 | WP-027 / W-002-NEIGHBORS, W-003-SEQPOS, FLOW-003 | 빈칸 | **CR-031** | **resolved (2026-08-25)** — 첫 항목이 시작(제외)·마지막이 끝(포함)이고 **서수에 `seq:` 접두를 붙인다**. 접두를 떼는 변이가 단위 2건·a11y 1건에 킬됐고, e2e가 W-004의 해석까지 왕복으로 건다 — WP-026에서 이 표현으로 실제 결함을 냈다 |
| DEV-168 | 2026-08-25 | **선행·후행이 어느 시퀀스 공간의 서수인지 서버가 임의로 정했다.** `findNeighbors`가 `findByPullRequest`/`findByCommitSha`로 **저장소 전체**를 훑고 현재 에폭인 **첫 행**에서 멈췄다. `merge_sequence`의 유일 색인은 `(repository_id, base_branch, seq_epoch, commit_sha)`이므로 **한 커밋이 `main`과 `release/*`의 현재 first-parent 체인에 함께 있는 것은 정상**이고, 두 행이 모두 에폭 검사를 통과하면 어느 공간의 서수를 낼지 **PostgreSQL의 반환 순서가 정한다** — 서수는 `(저장소, 대상 브랜치)` 안에서만 의미가 있다는 ADR-007이 응답에서 무너진다. 게다가 화면은 "범위로 확장" 링크를 **문서의 `base_branch`**로 만들고 있어, 서버가 다른 공간을 고르면 목록의 서수와 링크가 서로 다른 공간을 가리킨 채 조용히 어긋난다. 단일 브랜치 픽스처로는 이 상황이 만들어지지 않아 통합 20건과 CI가 전부 초록이었다 | WP-027 / API-REL-001, FR-REL-001, ADR-007, W-002, W-003 | 구현 결함 + 계약 공백 | **CR-032** | **resolved (2026-08-25)** — `base_branch`를 API-REL-001의 **필수 파라미터**로 세웠다. 앵커 해석은 API-SEQ-002가 쓰던 `findPointByPullRequest`/`findPointByCommit`(공간·에폭 한정)을 재사용해 `packages/db`에 새 질의를 만들지 않았다. 응답의 `sequence_space`는 저장 행이 아니라 **요청한 공간**에서 만들어 불변식이 구조가 되게 했다. 두 화면은 이미 갖고 있던 `base_branch`를 보내고, 모르면 조회하지 않는다. **다중 공간 픽스처**(`acme/multi`: 같은 커밋이 `main`에서 서수 2, `release/2026.08`에서 서수 11)를 세워 저장 순서를 뒤집어도 답이 같음까지 단언한다. 결함 재적용이 통합 3건에 킬됐다. 결정론적 정렬은 기각했다 — **결정적으로 같은 오답**일 뿐 사용자가 묻지 않은 브랜치다 |
| DEV-169 | 2026-08-25 | **색인 안 된 PR 이웃이 커밋 시각을 머지 시각으로 표시했다.** `merged_at: source?.merged_at ?? row.committed_at`은 PR 문서가 색인에 아직 없을 때 **병합 커밋의 `committed_at`**을 실었고, C-019는 그것을 "머지 시각" 칸에 그렸다 — Git 커밋 시각과 GitHub의 PR 머지 시각은 다른 값이므로 **확인되지 않은 값을 확정처럼** 보여 준 것이다. 같은 행이 `indexed: false`를 함께 달고 있어 "표시값을 모른다"와 "이 시각은 안다"가 한 행에서 모순됐다. 계약의 응답 예시는 **직접 푸시 커밋 행**에만 커밋 시각을 허용하고 PR 행의 미색인 경우는 정의되어 있지 않았다 | WP-027 / API-REL-001, C-019, DEV-130 | 구현 결함 + 계약 공백 | **CR-032** | **resolved (2026-08-25)** — 행의 종류가 규칙을 정한다: `kind: "commit"`은 `committed_at`, `kind: "pull_request"`는 색인이 아는 값이거나 **`null`**. 계약에 세 갈래를 명시했다. `formatTimestamp(null)`이 이미 `—`를 내므로 화면 표기는 바꾸지 않았다. 세지 않은 것을 0으로 채우지 않는 DEV-133과 같은 규율이다. 결함 재적용이 통합 1건에 킬됐다 |
| DEV-170 | 2026-08-25 | **선행·후행 조회가 실패하면 사용자가 빠져나올 수 없었다.** `outcome.phase`가 `error`가 되면 화면은 "잠시 뒤 다시 시도해 주세요"라고 안내하는데, 접기/펴기는 `phase === 'idle'`일 때만 조회하고(DEV-162) 건수 조절 UI는 `view !== null`일 때만 그려진다 — **error 상태에서는 두 경로가 모두 닫혀 있어** 상세 화면 전체를 다시 여는 것 말고는 복구 수단이 없었다. 화면이 **따를 수 없는 지시**를 한 셈이다 | WP-027 / C-019, W-002, W-003 | 구현 결함 | **CR-032** | **resolved (2026-08-25)** — 명시적 "다시 시도" 버튼을 두고 `load(count)`를 다시 실행한다. 접기/펴기 게이트는 `idle`로 유지해 DEV-162("펼칠 때 1회 조회")를 되돌리지 않았다. 안내 문구에서 따를 수 없는 지시를 뺐다. 결함 재적용이 a11y 1건에 킬됐고, 실 브라우저 왕복(e2e)도 함께 건다 |
| DEV-171 | 2026-08-25 | **정합성 점검 실패가 정본 상태를 오염시킨다.** FR-ADMIN-003의 예외 처리는 "커밋 그래프에 접근할 수 없으면 점검을 중단하고 시퀀스 공간 상태를 `unknown`으로 표시"인데, `unknown`은 이미 **"채번된 적 없는 브랜치"**를 뜻하고 API-SEQ-006·C-027·W-004가 그 뜻으로 표시하고 있다(CR-029). 거기에 "점검 실패"를 얹으면 **한 번의 일시적 그래프 오류가 이미 선 화면들을 거짓말하게 만든다** — 채번된 공간이 "채번된 적 없음"으로 보인다. 더 근본적으로 **점검은 읽기(관찰)다** — 진단 실행의 실패는 진단 결과에 담기지 진단 대상의 정본 상태가 되지 않는다 | WP-028 / FR-ADMIN-003 예외 처리, API-SEQ-006, C-027, W-004 | **문서 간 모순** | **CR-033** | **resolved (2026-08-25)** — 사용자 결정(갈래 A)으로 **SRS를 직접 고쳤다(v2.5)**: 점검을 실패로 종료하고 사유·상관 ID를 보고하되 **기존 상태를 보존**한다. 실패를 `consistent`로 표현하지도 않는다(검사하지 않은 것을 "일치"로 적으면 그 줄이 거짓이다). 새 상태값 `check_failed`는 **만들지 않았다** — 시퀀스 상태와 진단 실행 상태는 다른 개념이고, enum을 늘리면 마이그레이션·C-027·W-004가 그 오염을 물려받는다. 실패는 `sequence_integrity_check_failed_total`로만 보인다. 구현에는 **쓰기 질의가 아예 없고** 단위 시험이 그 사실(쓰기 0건)을 직접 단언한다 — 상태를 바꾸는 변이가 API 통합 1건·단위 1건에 킬됐다 |
| DEV-172 | 2026-08-25 | **`sequence_reassign`이 잡 유형에 없다** (DEV-128의 해소). `job_type_chk`는 `sequence_assign`까지만 허용하는데 API-ADM-007의 202 예시는 `type: "sequence_reassign"`을 낸다 — 수동 재채번이 잡 행을 만드는 순간 CHECK 위반이다 | WP-028 / API-ADM-007, 데이터 모델 3.4 | 문서 간 모순 | **CR-033** | **resolved (2026-08-25)** — API-ADM-007이 이미 그 이름을 안정 계약으로 쓰므로 **계약을 코드에 맞추지 않고 스키마를 넓혔다**: 마이그레이션 009가 `job_type_chk`에 유형을 추가한다. **기존 마이그레이션(004)은 고치지 않았다** — 이미 적용된 환경에서 004를 고쳐도 다시 돌지 않으므로 넓히는 변경은 언제나 새 마이그레이션이어야 한다. down도 함께 썼다. CHECK는 타입이 잡아 주지 않으므로 **실제 행을 넣는 통합 시험**으로 고정했고, 제약에서 유형을 빼는 변이가 통합 2건에 킬됐다 |
| DEV-173 | 2026-08-25 | **`affected_saved_search_count`의 판정 규칙이 없다.** `saved_search`에는 저장소 열이 없고 질의 문자열뿐이라 무엇을 세는지 정의되어 있지 않았다. 문자열에 `seq:`가 들어 있는지로 세면 인용 안의 본문·부정 필터·다른 저장소로 좁힌 검색을 전부 오답으로 만든다 | WP-028 / API-ADM-007 `impact_estimate` | 범위 공백 | **CR-033** | **resolved (2026-08-25)** — 값의 정의를 *"재채번으로 **의미가 바뀔 가능성이 있는** 저장 검색 수"*로 못 박았다(정확히 대상만 가리키는 검색 수가 아니다). 판정은 **`@prs/query` 파서**가 한다: `seq` 술어가 없으면 제외, `repo:`·`base:`가 **없으면 보수적으로 후보**(대상을 포함할 수 있다), 있고 다르면 제외, 명시적 부정이면 제외. 파싱 실패 질의는 세지 않는다 — 이미 실행 불가능한 검색이고 영향 수를 부풀리면 운영자의 판단 근거가 나빠진다. 문자열 검색으로 되돌리는 변이가 단위 2건에 킬됐다 |
| DEV-174 | 2026-08-25 | **JOB-ING-008(PG↔ES 정합성 감시)이 구현 범위에는 있고 DoD에는 없다.** 대응하는 FR도 없다(ADR-004 follow-up). 표본 크기와 불일치 시 조치를 정한 곳이 없었다 | WP-028 / JOB-ING-008, ADR-004 | 범위 공백 | **CR-033** | **resolved (2026-08-25)** — **범위에서 빼지 않았다**: ADR-004("Elasticsearch는 PostgreSQL만으로 재구축 가능")를 실제로 검증하는 잡은 이것뿐이다. 명시적 DoD를 세우고 **개수 대조와 표본 내용 대조 두 층**을 나눴다(뭉치면 "개수는 맞는데 내용이 다른" 상태가 안 보인다). 표본은 FR-ADMIN-003 AC-2와 같은 1000. **ES에만 있는 잉여 문서는 자동 삭제하지 않는다** — 투영 지연과 진짜 잉여를 이 잡이 가릴 수 없고 삭제는 승인된 계약 없이 할 일이 아니다. 되돌릴 수 있는 방향(정본에 있고 색인에 없음)만 재투영을 예약한다(조건부 업서트라 멱등). **구현 중 확인**: 이 스키마에 정규화된 `pull_request` 표가 없어 대조의 정본 쪽은 `raw_event`에서 뽑는다 — ADR-004가 "재생의 진짜 소스는 `raw_event`"라고 정하고 있어 그것이 맞다. 삭제를 넣는 변이가 단위 1건에 킬됐다 |
| DEV-175 | 2026-08-25 | **GHE 클라이언트가 "최근 24시간 갱신 PR"을 낼 수 없다.** `listPullRequestsPage`가 `direction: 'asc'`로 고정돼 있고(백필의 건너뜀 방지 — DEV-098) `/pulls`에는 `since`가 없다. FR-ING-011 AC-2가 요구하는 대조 대상을 만들 수단이 없었다 | WP-028 / FR-ING-011 AC-2, JOB-ING-005 | 범위 공백 | **CR-033** | **resolved (2026-08-25)** — 선택적 `direction` 옵션을 더하고 **기본값을 `asc`로 두었다**. 백필은 호출부가 아무것도 하지 않아도 기존 의미를 그대로 유지하고, `desc`를 고르는 쪽이 "전량을 읽지 않는다"는 것을 알고 고른다. 조정 스캔만 `desc`로 읽어 24시간 컷오프에서 멈춘다 — **없는 `since`를 있는 것처럼 만들지 않는다.** `asc`로 되돌리는 변이가 단위 1건에 킬됐다 |
| DEV-176 | 2026-08-25 | **FLOW-008 7단계 "알림 발송"이 성립하지 않고, FR-ING-011 AC-1·AC-5에 대응하는 DoD가 없다.** 알림 어댑터는 REL-005 소유이며(DEV-026·DEV-127 이월) 지금 만들 수 없다. 한편 주기 설정값(기본 1시간)과 "head 시퀀스가 없으면 채번 예약"은 어느 DoD에도 없었다 — 후자는 원장 §7의 "채번은 push 웹훅이 온 저장소만 따라간다"를 메우는 항목이다 | WP-028 / FLOW-008, FR-ING-011 AC-1·AC-5 | 범위 공백 | **CR-033** | **resolved (2026-08-25)** — **가짜 알림 구현을 만들지 않았다.** WP-028의 DoD를 감사 기록·지표·잡 상태로 좁히고 실제 발송을 REL-005로 이월했음을 제외 항목에 명시했다. FR-ING-011의 빠진 두 항목은 DoD에 더했고, head 채번 예약은 **기존 `sequence_assign` 잡을 큐에 넣을 뿐 서수를 직접 붙이지 않는다**(같은 기능의 두 번째 구현을 만들지 않는다). 되돌리기도 백필의 `projectOne`을 그대로 쓴다 — "간이 색인" 경로를 만들면 문서 버전 규칙(DEV-099)이나 벌크 항목 실패 처리(DEV-106) 중 하나만 갖는 두 번째 경로가 생긴다. 예약을 빼는 변이가 단위 2건에 킬됐다 |
| DEV-177 | 2026-08-25 | **API-ADM-007이 배포된 search-api에 없다.** 라우트는 `deps.integrity`가 있을 때만 등록되는데 운영 `apps/search-api/src/index.ts`의 `buildServer` 호출이 그 의존을 넘기지 않는다. 통합 시험은 목을 직접 꽂아 라우트를 세우므로 **"라우트가 존재한다"는 증명하고 "운영이 그것을 세운다"는 증명하지 않았다** — 그래서 전 계층 초록인 채로 두 경로가 통째로 빠진 배포가 나갔다 | WP-028 / API-ADM-007, FR-ADMIN-003 | 구현 결함 (운영 배선) | **CR-034** | **resolved (2026-08-25)** — 조립을 `apps/search-api/src/runtime.ts`의 `buildServerDeps`로 꺼내 **`index.ts`와 시험이 같은 함수를 부르게** 했다. 미러 볼륨은 만들지 않고 이미 있는 GHE 클라이언트 위에 읽기 전용 `ApiCommitGraph`를 얹는다(ADR-005의 폴백 경로). GHE 자격 증명이 없으면 경로가 서지 않되 **기동 로그의 `capabilities`가 그 사실을 밝힌다** — 조용히 없는 것이 이 결함의 원인이었다. 배선을 지우는 변이가 단위 1 + 통합 1 + 회귀 1에 킬됐다 |
| DEV-178 | 2026-08-25 | **`sequence_reassign` 잡을 집는 러너가 없다.** API-ADM-007 POST가 행을 `queued`로 만들지만 데이터베이스 잡을 claim하는 곳은 백필 러너뿐이다. 행은 영원히 남고, `job_active_uk` 때문에 **같은 공간의 다음 요청이 전부 `JOB_CONFLICT`로 거절된다** — 고치라고 만든 경로가 고칠 수 없게 만드는 자물쇠가 된다 | WP-028 / API-ADM-007, JOB-SEQ-002 | 구현 결함 (범위 공백) | **CR-034** | **resolved (2026-08-25)** — `startSequenceRepairRunner`를 세웠다. **새 큐 틀을 만들지 않고** `jobRepo.claimNextJob`(advisory lock으로 세기·잡기를 한 트랜잭션에 두는 그 함수)을 그대로 쓴다. 시퀀스 역할이 소유하며 공간 충돌은 `trySequenceSpaceLock`이 막는다. `queued → running → completed \| failed`가 실제 행에 남는다 — **영구 `queued`를 허용하지 않는 것**이 이 러너의 존재 이유다. 이미 일치하는 경우도 `completed`다(없는 문제를 실패로 적지 않는다). start를 지우는 변이가 회귀 1에 킬됐다 |
| DEV-179 | 2026-08-25 | **조정 스캔이 어디서도 기동하지 않는다.** `startReconcileSweeper`를 부르는 운영 코드가 없어 JOB-ING-005가 죽은 함수였다 — 최근 누락 PR이 되돌려지지 않고 1시간 주기가 통째로 무동작이었다 | WP-028 / JOB-ING-005, FR-ING-011 | 구현 결함 (운영 배선) | **CR-034** | **resolved (2026-08-25)** — 전용 **`reconcile` 역할**을 두고 거기서 기동한다. `enrich`에 붙이지 않은 이유는 **확장 축이 다르기 때문**이다: 실시간은 이벤트 유량을 따라 늘리고 정비는 저장소 수를 따라 한 번씩 돈다 — 같은 파드에 묶으면 실시간을 늘릴 때마다 주기 스윕이 그 수만큼 중복 실행된다. `batch`라는 이름 하나에 서로 다른 의존 집합을 밀어 넣지도 않았다. SIGTERM에서 `stop()`까지 기다린다. start·stop을 각각 지우는 변이가 회귀 2건에 킬됐다 |
| DEV-180 | 2026-08-25 | **head 복구가 소비자 없는 잡을 만든다.** 조정 스캔이 head 서수 누락을 발견하면 `sequence_assign` 잡 행을 넣었는데 **그 유형을 집는 러너도 없다.** 정상 채번은 버스 이벤트가 몬다. 그래서 행이 영원히 남고, `findActiveJob`이 그것을 보고 **이후의 모든 복구 시도를 막는다** | WP-028 / JOB-ING-005, FR-ING-011 AC-5, JOB-SEQ-001 | 구현 결함 | **CR-034** | **resolved (2026-08-25)** — 두 번째 채번 실행 구조를 만들지 않고 **이미 살아 있는 경로**로 보낸다: `prs:sequence` → `sequence.requested` → JOB-SEQ-001 → `assignSequence`. 게이트웨이가 push 웹훅에서 내는 것과 같은 이벤트·같은 파티션 키(`sequencePartitionKey`)·같은 결정론적 `event_id`다. 소비자는 `head_sha`를 맹신하지 않고 실행 시 그래프 head를 다시 읽는 기존 규칙을 유지한다. 발행을 지우는 변이가 회귀 1건에, 잡 행 생성으로 되돌리는 변이가 단위 1건에 킬됐다 |
| DEV-181 | 2026-08-25 | **내용 대조가 내용을 보지 않는다.** JOB-ING-008이 양쪽에서 `pr_number`만 꺼내 집합을 비교했다. 같은 번호와 개수가 양쪽에 있으면서 제목·상태·브랜치·머지 메타데이터가 낡거나 손상된 상태를 **한 건도 잡지 못했고**, `MismatchKind='content'`는 도달 불가능한 값이었다 — 광고한 층이 없는 층이었다 | WP-028 / JOB-ING-008, ADR-004 | 구현 결함 | **CR-034** | **resolved (2026-08-25)** — 정본과 색인에서 **같은 정규 필드 집합**을 뽑아 결정론적 SHA-256 지문으로 비교한다. 필드는 고정 순서로 늘어놓아 JSON 키 순서에 기대지 않고, 라벨처럼 순서가 의미 없는 모음은 정렬 후 넣는다. **본문(`body`)은 대조에서 뺐다** — 필요하지 않고 보고가 커지면 운영 로그에 PR 본문이 복사된다(NFR-005). 보고·지표에는 식별자와 지문만 남기고 고카디널리티 값을 라벨로 쓰지 않는다. 대조를 되돌리는 변이가 단위 5건에 킬됐다 |
| DEV-182 | 2026-08-25 | **수동 복구가 head 그대로인 중간 손상을 고치지 못한다.** `reassignSequence`는 `mergeBase(storedHead, newHead)`까지를 검증된 구간으로 보고 복사한다. 그 가정은 "head가 움직였다"는 재작성 상황에서만 참인데, **수동 복구가 다루는 상황은 head는 그대로이고 중간이 손상된 경우**다. 그때 `mergeBase(D, D) = D`이고 그 서수가 head 서수이므로 **손상 구간을 통째로 복사하고 다시 계산할 커밋이 0건**이 된다 — 복구가 아무것도 고치지 않고 에폭만 올려 멀쩡한 인용까지 무효로 만든다 | WP-028 / JOB-SEQ-002, FR-SEQ-005, ADR-007 | 구현 결함 | **CR-034** | **resolved (2026-08-25)** — 자동 경로의 merge-base 최적화는 **그대로 두고**, 수동 경로에 `repairSequence`를 세워 "**검증된 prefix + 최초 불일치부터 재계산**" 전략을 쓴다: `1..N-1`은 대조로 검증됐으므로 복사(`pull_request_number` 같은 나중 값을 잃지 않는다), `N..head`는 실제 체인에서 재계산, `N=1`이면 전체 재계산. 체인이 짧아졌으면 새 `head_seq`도 실제 길이에 맞춘다. **실행 시점에 정합성을 다시 읽는다** — 큐에서 기다리는 사이 이미 고쳐졌으면 무동작 완료이며, API 요청 때 본 불일치를 영구 진실처럼 저장해 실행하지 않는다. 실제 git 저장소로 검증했고 **자동 경로가 같은 손상을 고치지 못한다는 사실 자체를 시험이 단언한다**. 전략을 되돌리는 변이가 통합 2건에 킬됐다 |
| DEV-183 | 2026-08-25 | **완료된 워커 역할에 배포 manifest가 없다.** `deploy/k8s`에는 REL-001의 `enrich`·`project`만 있고 `sequence`·`reconcile`이 배포될 경로가 없다. WP-021~028이 만든 채번·재채번·점검·조정이 전부 배포 단위 없이 "완료"로 기록돼 있었다 | WP-028 / 인프라·운영 8장 | 범위 공백 | **CR-034** | **resolved (2026-08-25)** — `pipeline-worker-sequence.yaml`·`pipeline-worker-reconcile.yaml`을 더했다. **둘 다 replica 1이다** — 주기 스윕에 리더 선출이 없어 여러 파드가 같은 주기에 같은 대상을 중복 처리한다(결과가 틀리지는 않지만 GHE 한도를 그만큼 더 쓰고, 한도 소진은 조정 스캔이 미루는 조건이다). 수평 확장이 필요하면 claim 규칙을 먼저 세운다고 명시했다. 시퀀스는 `Recreate` 전략이다 — 공간을 한 번에 하나만 써야 안전하다. **실제 Kubernetes 클러스터가 없어 적용은 NOT RUN이며**, 구조 정적 검증과 역할·replica를 회귀 시험이 고정한다. manifest를 지우는 변이가 회귀 4건에 킬됐다 |
| DEV-184 | 2026-08-25 | **백필·조정 스캔이 PostgreSQL에 재구성 근거를 남기지 않는다.** 두 경로는 GHE에서 직접 읽어 **Elasticsearch에만** 쓴다 — `raw_event` 행이 없다. 그 결과 ① ADR-004("어떤 데이터도 검색 인덱스에만 존재해서는 안 된다")가 그 경로에서 **실제로 깨져 있었고**, ② JOB-ING-008이 `raw_event`를 정본으로 삼아 **정상 백필 문서를 전부 `extra_in_es`로 오판**했다. 감시가 자기 눈금을 잘못 들고 있었고, 동시에 그 눈금이 가리키려던 불변식도 깨져 있었다 | WP-028 / ADR-004, JOB-ING-004, JOB-ING-005, JOB-ING-008 | **아키텍처 불변식 위반** | **CR-034** | **resolved (2026-08-25)** — 마이그레이션 010이 `pull_request_snapshot`을 세웠다. **두 투영 경로가 함께 남긴다** — 실시간(`project.ts`)과 백필·조정(`projectOne`)이 이미 같은 `buildUpsertRequests`를 쓰므로 그 결과를 한 함수에서 저장해 반쪽 불변식이 되지 않게 했다. **색인보다 먼저 쓴다**(정본이 먼저 있어야 색인 실패가 유실이 아니다). `document_version`은 ES 업서트와 같은 값이라 **오래된 백필이 최신 웹훅을 덮어쓰지 않는 규칙(DEV-099)이 이 표에서도 그대로 성립**하고, 같은 PR 재실행은 멱등이다. 합성 웹훅을 `raw_event`에 넣지 않았다 — 원본 레인은 받은 것만 담아야 감사 근거가 된다. ES만 정본으로 승격하지도, 잉여를 자동 삭제하지도 않는다. 정합성 감시의 정본을 이 표로 바꿔 오판이 사라졌다. 스냅숏 기록을 지우는 변이가 회귀 1건에 킬됐다 |
| DEV-185 | 2026-08-25 | **GHE 클라이언트에 "이 저장소에 접근 가능한 팀" 조회가 없다.** 있는 것은 `listOrgTeams(org)`·`isTeamMember(org, slug, user)`·`collaboratorPermission(ref, user)` 셋인데 **전부 사용자 축**이고, `allowed_team_ids`가 필요로 하는 것은 **저장소 축**의 답이다. 조직 전체 팀을 훑어 각각 확인하면 등록 한 번이 팀 수만큼의 요청이 된다 | WP-068 / API-ADM-001, FR-AUTH-002 AC-6 | 범위 공백 | **CR-035** | **resolved (2026-08-25)** — `listRepositoryTeams(ref)`를 더했다. GitHub이 `GET /repos/{owner}/{repo}/teams`로 이 질문에 직접 답하므로 기존 `getAll` 페이징 경로를 그대로 쓴다 |
| DEV-186 | 2026-08-25 | **`team` 표에 조직의 팀이 채워지는 자리가 없다.** `resolveTeamIds`(WP-013)가 slug → ID를 그 표에서 읽고 강제 필터가 그 ID로 문서를 거르는데, 저장소 등록 경로가 표를 채우지 않아 **`team:` 질의가 이름을 ID로 옮기지 못했다** — 값이 있어도 질의가 성립하지 않는 상태였다 | WP-068 / FR-SRCH-005, API-ADM-001 | 범위 공백 | **CR-035** | **resolved (2026-08-25)** — 저장소의 팀을 읽는 김에 그 팀들을 `team` 표에 upsert한다. **조회한 것만 넣으므로 별도 동기화 잡을 만들지 않는다** — 조직 전체 팀을 미리 당겨 오는 것은 이 기능이 필요로 하는 것보다 넓다. 통합 시험이 `resolveTeamIds`로 왕복을 확인한다 |
| DEV-187 | 2026-08-25 | **소급 적용의 방아쇠가 정의되어 있지 않다.** WP-068은 "`team` 웹훅 시 `update_by_query` 소급 적용"을 요구하는데, 웹훅은 게이트웨이가 받고 소급 적용은 색인을 만지는 작업이라 소유 프로세스가 다르다. 그 사이를 잇는 경로가 없었다 | WP-068 / FR-AUTH-002 AC-6, EVT-AUTH-001 | 범위 공백 | **CR-035** | **resolved (2026-08-25)** — 새 이벤트·새 역할을 만들지 않고 **이미 같은 방아쇠로 authz 워커까지 가고 있는 `permission.invalidated`(EVT-AUTH-001)의 소비자에 얹었다.** 권한 캐시 무효화와 색인 소급 적용이 **같은 사건에서 함께** 일어난다 — 캐시만 지우고 문서를 두면 팀에서 빠진 사용자가 과거 문서를 계속 본다. 소급 실패는 무효화를 되돌리지 않는다(다음 팀 변경·등록 갱신이 메우고 캐시 TTL이 안전망이다). **구현 중 확인**: 소급 대상이 `ARCHIVABLE_ALIASES`(둘)가 아니라 **네 색인 전부**여야 한다 — `repository_archived`는 두 곳에만 있지만 `allowed_team_ids`는 네 매핑이 모두 선언한다. 둘만 돌리면 관계·릴리스 문서가 옛 권한을 그대로 들고 남는다. `TEAM_SCOPED_ALIASES`로 분리했고 되돌리는 변이가 회귀 1 + 통합 2에 킬됐다 |
| DEV-188 | 2026-08-25 | **팀 회수가 색인에 반영되지 않는다 — 접근 범위 유출.** 워커의 소급 적용이 `findRepositoriesForTeam`으로 저장소를 찾은 뒤 **그 행의 `allowed_team_ids`를 그대로** 색인에 썼다. 회수 사건에서 그 값은 아직 제거된 팀을 담고 있으므로 **회수가 반영되지 않고 옛 구성원이 문서를 계속 본다.** 추가 사건에서는 저장소가 아직 그 팀을 갖고 있지 않아 역조회로 **대상을 찾지도 못해** 추가가 전파되지 않았다 | WP-068 / FR-AUTH-002 AC-6, EVT-AUTH-001 | **구현 결함 (접근 범위 유출)** | **CR-036** | **resolved (2026-08-25)** — 방아쇠가 무엇이든 **GHE가 지금 답하는 것**을 다시 읽는다. 웹훅의 `repository_id`가 있으면 그 저장소를 보고(추가 사건은 역조회로 찾을 수 없다), 없으면 그 팀을 가진 저장소들을 본다. 판정과 쓰기를 `@prs/authz`의 `syncRepositoryTeamScope`로 옮겨 **등록 경로와 웹훅 경로가 같은 구현**을 쓰게 했다 — 앱은 서로를 가져올 수 없어 각자 구현하면 한쪽만 고쳐지고, 접근 범위에서 그것은 유출이다. 색인 클라이언트는 포트로 받는다(`scope-source.ts`가 `GitHubClient`에 하는 것과 같은 방식). 옛 값을 되쓰는 변이가 단위 3건, `repository_id`를 무시하는 변이가 단위 1건에 킬됐다 |
| DEV-189 | 2026-08-25 | **색인 반영 실패 뒤 재시도 경로가 없다.** `setAllowedTeams`가 정본을 바꾼 뒤 `applyRepositoryTeams`가 실패하면 바깥 catch가 삼키고 넘어갔다. 다음 동기화는 GHE가 같은 답을 주므로 `setAllowedTeams`가 `false`를 반환하고 **색인 반영을 다시 시도하지 않는다** — 회수된 팀이 색인 문서에 영원히 남는다 | WP-068 / FR-AUTH-002 AC-6 | 구현 결함 | **CR-036** | **resolved (2026-08-25)** — 색인 반영이 실패하면 **정본을 이전 값으로 되돌린다.** 그래야 다음 회차가 같은 차이를 다시 보고 재시도한다. 되돌림을 뺀 변이가 단위 2건에 킬됐고, "되돌린 뒤 다음 회차가 반영한다"를 별도 시험이 왕복으로 건다 |
| DEV-190 | 2026-08-25 | **마이그레이션 이전 저장소가 팀 접근 범위를 영영 갖지 못한다.** 011은 기존 행에 빈 배열을 주는데 그것을 채우는 경로가 **명시적 재등록뿐**이고, 팀 웹훅의 역조회(`allowed_team_ids @> ARRAY[team]`)도 빈 배열이라 그 저장소를 찾지 못한다. 수동으로 전부 다시 등록하지 않는 한 팀 전용 비공개 저장소가 `team:`과 큰 `org_team` 범위에서 계속 보이지 않는다 | WP-068 / 마이그레이션 011, JOB-ING-005 | 범위 공백 | **CR-036** | **resolved (2026-08-25)** — **조정 스캔(JOB-ING-005)이 주기적으로 메운다.** 이미 등록된 저장소를 한 바퀴 도는 정기 정비이므로 새 잡·새 역할을 만들지 않았다. 실패해도 조정 스캔을 멈추지 않는다(다음 주기가 다시 시도한다). SQL 백필은 불가능하다 — 팀은 GHE에 물어야 알 수 있다 |
| DEV-201 | 2026-08-26 | **`upsertTeam`이 동시 삽입에서 터진다.** `team`에는 유니크 제약이 둘 있다 — `team_id`(기본 키)와 `(org_id, slug)`. `ON CONFLICT (team_id)`는 앞의 것만 중재자로 삼으므로, 행이 아직 없는 상태에서 같은 팀을 **동시에** 넣으면 뒤의 인덱스에서 충돌이 나 23505로 터진다. 팀을 공유하는 두 저장소가 **처음으로** 함께 동기화될 때 실재하는 경로다 | WP-068 / CR-037 경주 시험 중 발견 | 구현 결함 (동시성) | **CR-037** | **resolved (2026-08-26)** — 한 번 재시도로 막았다. 재시도하면 그 사이 상대가 커밋해 행이 존재하므로 `ON CONFLICT (team_id)`가 정상적으로 갱신 경로를 탄다. 두 유니크 인덱스를 한 문장에서 함께 중재할 방법은 없다. 유일한 운영 호출부가 트랜잭션 밖이라 재시도가 안전하다 |
| DEV-202 | 2026-08-26 | **수동 복구가 남의 `reassigning`을 되돌린다.** 표시를 advisory lock **보다 먼저** 커밋하면, 락 경쟁에서 진 쪽이 이긴 쪽의 표시를 자기 것으로 알고 `ok`로 되돌린다 — 다른 워커가 한창 재구축 중인 공간을 조회가 "정상"으로 읽고 옛 에폭을 안정된 값으로 취급한다. 락을 얻지 못한 쪽이 표시만 남기고 떠나는 반대 방향도 성립한다(아무도 재구축하지 않는 공간이 영원히 `reassigning`) | WP-028 / JOB-SEQ-002, API-SEQ-006 | 구현 결함 (소유권 경계) | **CR-037** | **resolved (2026-08-26)** — 표시를 **락을 잡고 울타리를 통과한 뒤에** 세운다. 그때부터 그 공간의 `reassigning`은 우리 것이고 되돌리는 것도 안전하다. 락을 얻지 못한 갈래는 애초에 아무것도 표시하지 않으므로 되돌릴 것이 없다. 본 트랜잭션은 그 시점에 `sequence_space` 행을 아직 갱신하지 않아 별도 커넥션의 표시와 행 잠금이 겹치지 않는다. 통합 2건 — 남이 락을 쥔 채 `reassigning`이면 그대로 두고, 남이 락만 쥐고 있으면 공간이 `ok` 그대로다. 표시를 락 앞으로 되돌리는 변이가 킬됐다 |
| DEV-203 | 2026-08-26 | **부트스트랩이 반쪽 문서로 완전한 정본을 덮는다.** `enrichForBackfill`은 커밋·파일·리뷰 조회가 실패해도 던지지 않고 `enrichment_pending` 문서를 만든다. 스냅숏 업서트는 **같은 `document_version`을 덮으므로**(`<=`) 이미 완전한 스냅숏이 반쪽으로 되돌아가고, 그 PR이 성공으로 세어져 저장소가 완결로 찍히면 **아무도 다시 채우지 않는다** — Elasticsearch 재구축에서 그 필드들이 조용히 사라진다 | WP-028 / JOB-ING-010, ADR-004 | 구현 결함 (정본 손상) | **CR-037** | **resolved (2026-08-26)** — 부트스트랩 모드에서는 `enrichment_pending` 문서를 **스냅숏에 쓰지 않고 실패 항목으로 센다.** 완전한 스냅숏이 그대로 남고, 실패가 있으면 완결 표시가 찍히지 않아 다음 회차가 같은 PR을 다시 본다. 실시간·백필 경로는 그대로다 — 그쪽은 부분 문서라도 색인에 실어 두는 것이 맞고 보강 재시도 경로가 따로 있다. 통합 1건이 완전한 스냅숏 → 실패 회차 → 스냅숏 불변을 확인한다. 차단을 지우는 변이가 킬됐다 |
| DEV-204 | 2026-08-26 | **`updated` 정렬 페이지네이션이 항목을 건너뛴다.** `listPullRequestsPage`는 `sort=updated&direction=asc`로 넘긴다. 스캔 중 어떤 PR이 갱신되면 그 항목이 목록 끝으로 이동하고 **뒤에 있던 항목이 이미 지나온 페이지 자리로 당겨져 영영 방문되지 않는다.** 백필에서는 조정 스캔이 메우지만, 부트스트랩은 **완결 표시를 찍는 잡**이라 건너뛴 PR이 영구 누락되고 `extra_in_es`로만 보고된다 | WP-028 / JOB-ING-010, ADR-004 | 구현 결함 (열거 정확성) | **CR-037** | **resolved (2026-08-26)** — `listPullRequestsPage`에 `sort` 옵션을 더하고 부트스트랩이 **`created`**를 쓴다. 생성 시각은 바뀌지 않으므로 어떤 항목도 앞으로 당겨지지 않는다 — 스캔 중 새로 만들어진 PR이 끝에 붙을 뿐이고 그것은 우리가 지나갈 자리다. 기본값은 `updated`로 두어 기존 호출부(백필)의 의미를 바꾸지 않았다. **백필도 같은 잠재 결함을 갖지만** 그쪽은 완결 표시를 찍지 않고 조정 스캔이 보정하므로 이 CR에서 건드리지 않는다 — §7에 적었다. 통합 2건이 `runBackfillJob`과 **운영 러너** 양쪽에서 `created`가 실제로 전달되는 것을 확인한다. 러너에서 정렬을 지우는 변이가 킬됐다 |
| DEV-205 | 2026-08-26 | **소비자 그룹이 토픽당 하나뿐이라 두 소비자가 같은 이벤트를 각각 받을 수 없다.** `consumerGroup(topic)`은 `CONSUMER_GROUPS[topic]` 하나를 돌려주고 `prs:projected`의 값은 `link`다. 커밋 보강이 그대로 구독하면 Redis consumer group의 의미상 **broadcast가 아니라 work sharing**이 되어 링크 파생과 커밋 보강이 이벤트를 나눠 갖는다 — 둘 다 절반씩 놓치고, 어느 쪽도 실패로 보이지 않는다 | WP-067 / EVT-ING-003, ADR-002 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 토픽별 논리 소비자 카탈로그(`LOGICAL_CONSUMERS`)를 두고, 두 번째 이후 소비자가 `<기본 그룹>:<소비자>` 형태의 **다른 group**을 얻게 했다. **기본 그룹 이름은 바꾸지 않았다** — 기존 소비자의 group을 바꾸면 Redis에서 읽던 자리를 잃어 그 사이 이벤트를 다시 읽거나 건너뛴다. 카탈로그에 없는 이름은 던진다: 오타가 조용히 새 group을 만들면 그 소비자는 처음부터 다시 읽고 아무도 그 사실을 모른다. 실제 Redis 통합 시험이 두 소비자가 같은 이벤트를 각각 전부 받는 것을 확인하고, 같은 group으로 되돌리는 변이가 킬됐다 |
| DEV-206 | 2026-08-26 | **직접 푸시 커밋은 검색 문서가 아예 만들어지지 않는다.** `buildCommitDocuments`는 `EVT-ING-002`의 `source_commit_shas`와 머지 커밋에서만 문서를 만들고, 시퀀스 투영(`applySequenceToDocuments`)도 `update_by_query`뿐이라 없는 문서를 만들지 않는다. WP-067의 "부분 갱신만 한다"는 규칙은 그 커밋을 **영원히 검색 불가**로 둔다. `EVT-ING-003`만 방아쇠로 삼는 것도 성립하지 않는다 — 그 이벤트는 커밋 문서 투영 **뒤에** 나오므로 애초에 문서가 없는 커밋에 대해서는 발생하지 않는다 | WP-067 / FR-SRCH-002 AC-3, JOB-MIR-002, EVT-ING-003 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 방아쇠를 넷으로 넓혔다. **`sequence.assigned`가 핵심이다**: 그 이벤트의 `from_seq..to_seq`가 새로 채번된 first-parent 구간이고 `merge_sequence`가 그 SHA를 정본으로 갖고 있어, 직접 푸시 커밋이 여기로 들어온다. `EVT-ING-003`만으로는 성립하지 않는다 — 그 이벤트는 커밋 문서 투영 **뒤에** 나오므로 문서가 없는 커밋에는 발생하지 않는다. 색인에 없는 first-parent 커밋은 **문서를 만든다**. 방아쇠와 생성을 각각 지우는 변이가 킬됐다 |
| DEV-207 | 2026-08-26 | **`direct_push` 판정 근거가 정해져 있지 않다.** PR 연결이 그 순간 `null`이라는 이유만으로 역할을 확정하면, push 웹훅과 PR 투영 사이의 경주에서 **정상 머지 커밋이 직접 푸시로 굳는다.** `merge_sequence.pull_request_number`가 나중에 채워질 수 있다는 기존 규칙(DEV-118 계열)과도 어긋난다 | WP-067 / FR-SRCH-002 AC-3, ENT-CORE-003 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 근거를 요구한다: first-parent 체인에 있고, 정본이 아는 PR 매핑이 없을 때만 `direct_push`다. 역할을 **매번 정본에서 다시 계산**하므로 나중에 매핑이 생기면 다음 보강이 `merge_commit`으로 교정한다 — "한 번 `direct_push`면 영원히"라는 규칙을 만들지 않았다. 체인 소속을 모르는 경로(EVT-ING-003)는 역할을 아예 건드리지 않는다 — 원본 커밋의 역할을 뒤집으면 안 되기 때문이다 |
| DEV-208 | 2026-08-26 | **커밋 메타데이터의 PostgreSQL 정본이 없다.** 저장소 어디에도 커밋 엔티티의 정규화 표가 없고, WP-067 계약대로 그래프에서 읽어 색인에만 쓰면 **ADR-004("어떤 데이터도 검색 인덱스에만 존재해서는 안 된다")가 커밋 축에서 깨진다.** CR-034가 PR 축에서 이미 겪은 것과 같은 모양이며, 그때는 마이그레이션 010과 부트스트랩까지 필요했다 | WP-067 / ADR-004, ENT-CORE-003, JOB-MIR-002 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 마이그레이션 013 `commit_snapshot`. 정본을 색인보다 **먼저** 쓴다 — 반대로 하면 색인에만 있고 정본에는 없는 창이 생기고 그 창에서 프로세스가 죽으면 ADR-004가 깨진 상태로 남는다. **소스 코드 본문·patch 본문은 어떤 열에도 담지 않았다**(NFR-005): 변경 경로는 파일 이름이고 `patch_id`는 diff의 해시이지 diff가 아니다. 이메일도 담지 않았다(승인 목록에 없다). 미러가 얻은 `patch_id`를 API 폴백 회차가 `no_mirror`로 덮지 않는다 — 능력이 없는 쪽이 있는 쪽을 지우면 WP-030이 근거를 잃는다. 색인을 지운 뒤 정본만으로 값을 되찾는 통합 시험이 이것을 건다 |
| DEV-209 | 2026-08-26 | **커밋 문서의 `document_version` 갱신 경계가 정의되어 있지 않다.** 지금 값은 **PR 웹훅의 버전**이다 — 엔티티가 다른데 버전을 공유한다. 메타데이터 보강이 그 값을 올리면 이후 정상 웹훅 투영이 밀려나고, 새로 만드는 직접 푸시 문서에 `Date.now()`를 쓰면 **그 뒤 도착하는 정상 투영이 전부 "오래된 이벤트"가 된다** | WP-067 / FR-ING-005 AC-1, ENT-CORE-003 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 메타데이터는 **불변 git 사실**이라 새 것과 옛 것이라는 개념이 없다. 그래서 `document_version`을 올리지 않는다. 기존 조건부 업서트 스크립트는 버전이 더 클 때만 대입하므로 그대로 쓰면 아무것도 안 붙는다 — 버전과 무관하게 대입하되 버전은 쓰지 않는 전용 경로를 뒀고, 값이 같으면 `noop`이라 재실행이 문서를 바꾸지 않는다. 새 직접 푸시 문서의 초기 버전은 **커밋 시각**이다: `now()`를 쓰면 이후 도착하는 정상 웹훅 투영이 전부 "오래된 이벤트"로 밀려나 그 문서가 PR 정보를 영영 받지 못한다. 두 갈래를 각각 깨는 변이가 킬됐다 |
| DEV-210 | 2026-08-26 | **커밋 상세 API가 저장된 메타데이터를 반환하지 않는다.** `message`·`author`·`committer`·`authored_at`·`committed_at`·`parent_shas`·`changed_paths`·`patch_id`가 응답에 연결되어 있지 않아, 값을 채워도 `/commit/...` 화면은 계속 SHA만 보여 준다 — 보강했다는 사실을 사용자가 확인할 길이 없다 | WP-067 / API-SRCH-003, FR-SRCH-004 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 커밋 상세가 `message`·`author`·`committer`·`authored_at`·`committed_at`·`parent_shas`·`changed_paths`·`changed_paths_truncated`·`patch_id`·`patch_id_unavailable`을 실제로 반환한다. 값이 없으면 **키를 넣지 않는다** — 보강 전과 보강 후를 화면이 구분할 수 있어야 한다(DEV-060의 규율). 직접 푸시 커밋의 상세가 200이 되는 것까지 통합 시험이 건다 — 그전에는 404였고, WP-027이 그 행을 노출하면서 **사용자가 볼 수 있는 행이 클릭하면 없는 화면으로 갔다** |
| DEV-211 | 2026-08-26 | **PR 상세의 `source_commits`가 커밋 문서와 join하지 않는다.** `shas.slice(...).map((sha) => ({ commit_sha: sha }))`이므로 메타데이터를 채워도 W-002의 원본 커밋 목록에는 계속 SHA만 나온다. 최대 250개를 하나씩 조회하면 N+1이다 | WP-067 / API-SRCH-003, FR-SRCH-002 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 커밋 문서와 **조회 한 번으로** 조인한다. 제목은 **첫 줄만** 싣는다(목록 행에 여러 줄이 들어가면 화면이 무너지고 전문은 커밋 상세가 준다). 접근 범위는 이 조인에서도 강제된다 — 같은 저장소라는 것을 알고 있어도 우회 경로를 만들지 않는다. 보강되지 않은 커밋은 키가 없는 채로 남는다. **호출 횟수를 직접 세는 단위 시험**이 N+1을 막는다 — 250번 왕복해도 응답 내용은 똑같이 맞기 때문에 결과만 보는 시험으로는 증명되지 않는다. batch를 N+1로 되돌리는 변이가 킬됐다 |
| DEV-212 | 2026-08-26 | **선행·후행의 직접 푸시 행이 PR 문서만 표시 소스로 읽는다.** `toItem`이 `pull_request_number === null`이면 `title`·`author`를 무조건 `null`로 낸다. WP-027이 그 행을 실제로 노출하기 시작했으므로 사용자는 지금 SHA만 보이는 행을 본다 — **이것이 WP-067의 사용자-visible 동기다** | WP-067 / API-REL-001, FR-REL-001 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 직접 푸시 행의 표시값을 커밋 문서에서 batch join한다. **PR 행에는 쓰지 않는다** — PR의 제목과 머지 커밋의 첫 줄은 다른 값이고, 섞으면 목록의 같은 칸이 행마다 다른 것을 뜻하게 된다. `indexed`도 그 행의 표시 소스로 판정한다(PR 문서 유무로 판정하면 보강된 직접 푸시 행이 영원히 `false`다). 기존 시험의 "제목·작성자가 없다"는 단언은 **출처가 달라진 것**이므로 "앵커 PR의 제목이 새어 들어오지 않는다"로 정확히 다시 걸었다 — 그것이 DEV-090이 지키려던 불변식이다 |
| DEV-213 | 2026-08-26 | **새로 만드는 커밋 문서의 접근 통제 material이 정의되어 있지 않다.** 기존 문서는 투영이 `repositoryScope()`로 함께 실었지만, 보강 경로가 문서를 **새로 만들** 때 그 값을 빠뜨리면 강제 접근 범위 필터가 그 문서를 걸러 낼 수 없다. 먼저 만들고 나중에 채우는 순서도 그 사이에 같은 구멍을 만든다 | WP-067 / ADR-008, FR-AUTH-002 AC-6 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 문서 **생성 시점에** `repositoryScope()`와 같은 접근 통제 material을 함께 싣는다. 먼저 만들고 나중에 채우면 그 사이 문서를 강제 필터가 거를 수 없다. 체인 소속을 모르는 커밋에 대해서는 **문서를 아예 만들지 않는다** — 접근 범위를 확신할 수 없는 자리에서 만들지 않는 것이 fail closed다. 범위 밖 직접 푸시 커밋이 상세·해석 어느 경로로도 새지 않는 것을 통합 시험이 건다 |
| DEV-214 | 2026-08-26 | **JOB-MIR-002의 운영 도달성이 계약에 없다.** WP-067의 DoD는 값이 채워지는지만 묻고, 그 잡이 어느 역할에서 기동해 어떤 소비자 그룹으로 무엇을 구독하며 종료에서 어떻게 정리되는지, 배포 manifest가 그 역할을 켜는지가 빠져 있다. CR-034가 정확히 그 공백에서 **전 계층 초록인 채 배포에서 아무것도 실행되지 않는 상태**를 만들었다 | WP-067 / JOB-MIR-002, 배포·운영 | 범위 공백 | **CR-038** | **resolved (2026-08-26)** — 미러 역할이 소유한다(이 잡의 정답지가 미러이고, 새 역할을 만들면 `ReadWriteOnce` 볼륨을 두 곳에 붙여야 한다). **미러 역할에는 배포 manifest 자체가 없어 JOB-MIR-002가 배포에 도달할 수 없었다** — `pipeline-worker-mirror.yaml`을 PVC와 함께 새로 만들었다. 운영 도달성 회귀가 선언 → 소비자 그룹 → 역할 → 기동 → 종료 → manifest를 잇고, 전용 그룹으로 구독하는지와 미러 볼륨이 붙어 있는지도 함께 본다 |
| DEV-191 | 2026-08-26 | **팀 접근 범위 동기화가 저장소 단위로 직렬화되지 않는다 — 회수된 접근이 되살아난다.** `syncRepositoryTeamScope`는 GHE 조회 → `setAllowedTeams`(정본) → `applyRepositoryTeams`(색인)를 **아무 잠금 없이** 수행한다. 같은 저장소에 등록(search-api)·팀 웹훅(pipeline-worker)·조정 스캔이 겹치면 각 호출이 서로 다른 GHE 스냅숏을 읽고 조건 없이 덮어쓴다. 늦게 끝난 옛 호출이 새 회수를 되돌려 **제거된 팀 ID가 색인에 복원**되고, 다음 동기화까지 옛 구성원이 문서를 계속 본다. 권한 스트림은 `team_id`로만 파티션되므로 다른 진입점끼리는 서로를 모른다 | WP-068 / FR-AUTH-002 AC-6, ADR-008, JOB-ING-005 | 구현 결함 (동시성·접근 통제) | **CR-037** | **resolved (2026-08-26)** — GHE 조회부터 색인 반영까지를 **저장소 단위 세션 advisory lock**으로 묶었다. 조회가 락 안에 있는 것이 핵심이다 — 락이 쓰기만 감싸면 두 호출이 여전히 각자 옛 스냅숏을 읽어 놓고 줄만 서서 덮어쓴다. 프로세스 내부 mutex는 복제본이 여럿이라 정확성 경계가 아니고, GHE 왕복 동안 트랜잭션을 열지 않는다. 락을 쥔 커넥션이 정본 쓰기도 한다(두 번째 커넥션을 얻으면 교착). 해제는 finally에 있다. 락을 얻지 못하면 회차를 미루며, 조정 스캔이 매 주기 다시 훑으므로 스스로 메워진다. 직렬화를 지우는 변이가 통합 2건에 킬됐다 — 회수된 팀이 되살아나고 동시 GHE 조회가 3이 된다 |
| DEV-192 | 2026-08-26 | **수동 복구가 움직인 head를 되돌린다.** `repairSequence`는 그래프 walk를 트랜잭션 밖에서 끝낸 뒤 락을 잡고 `seq_epoch`만 비교한다. 정상 채번(`advanceHead`)은 **에폭을 올리지 않으므로** 그 사이 head가 D→E로 전진해도 검사를 통과하고, 옛 head `D`로 `advanceHead`를 불러 **저장된 head를 뒤로 되돌리고 이미 채번된 `E`를 누락**한다. 저장 head와 실제 Git head 어느 쪽도 커밋 직전에 다시 확인하지 않는다 | WP-028 / JOB-SEQ-002, FR-SEQ-005, ADR-007 | 구현 결함 (동시성) | **CR-037** | **resolved (2026-08-26)** — 울타리 셋을 세웠다: (1) 분석 근거(공간 상태·저장분)를 **긴 walk보다 먼저 고정**한다 — walk 뒤에 읽으면 그 사이의 채번이 이미 반영되어 울타리가 비교할 대상을 잃는다. (2) 락 아래에서 **저장 head**를 대조한다. (3) **커밋 직전 실제 Git head**를 다시 읽는다 — Git은 우리 락을 모른다. 어긋나면 아무것도 커밋하지 않고 표시를 되돌린 뒤 다음 회차에 맡긴다. 실제 git 저장소에서 walk 중 head를 전진시키는 시험이 이것을 고정하고, 재시도가 `E`까지 포함해 성공하는 것까지 확인한다. 세 검사를 각각 지우는 변이가 전부 킬됐다 |
| DEV-193 | 2026-08-26 | **정합성 지문이 접근 통제 필드를 보지 않는다.** `CANONICAL_FIELDS`에 `org_id`·`visibility`·`allowed_team_ids`가 없다. 그 셋은 `packages/es/src/scoped-query.ts`의 `org_team` 경로(저장소 500개 초과 사용자)와 `query-builder.ts`의 `team:` 필터가 **실제로 읽는** 필드다. 저장소 이전·공개 범위 변경·색인 손상으로 PostgreSQL과 Elasticsearch가 어긋나도 JOB-ING-008은 `consistent`로 보고한다 — 검색 데이터 drift가 아니라 **authorization material drift**이며, 잘못된 조직에 결과를 노출하거나 감추는 상태를 감시가 통과시킨다 | WP-028 / JOB-ING-008, ADR-004, ADR-008, FR-AUTH-002 | 구현 결함 (접근 통제) | **CR-037** | **resolved (2026-08-26)** — `FINGERPRINT_FIELDS` 하나를 PostgreSQL 쪽과 Elasticsearch 쪽이 **함께 쓴다**(두 목록이 다르면 대조가 언제나 불일치를 내거나 언제나 일치를 낸다). `org_id`·`visibility`·`allowed_team_ids`·`repository_archived`를 넣었고, 기대값의 접근 범위는 **`repository` 표에서 합성**한다 — 스냅숏에 권한을 중복 저장하지 않는다. 스냅숏의 사본은 투영 당시 값이라 팀 회수 뒤에는 색인의 같은 옛 값과 일치해 **유출이 정상으로 보고된다.** `allowed_team_ids`는 정렬 후 비교하고, 보고에는 식별자와 지문만 남긴다(NFR-005). 네 필드를 각각 지우거나 레지스트리 덮어쓰기를 지우는 변이가 전부 킬됐다 |
| DEV-194 | 2026-08-26 | **마이그레이션 010이 기존 운영 데이터를 부트스트랩하지 않는다.** 업그레이드 시 빈 표가 생기고 기존 PR 문서는 Elasticsearch에만 남는다. 투영은 **바뀐 PR만** 스냅숏을 쓰고 조정 스캔은 이미 색인된 것을 건너뛰므로, 손대지 않은 운영 데이터는 스냅숏을 영영 얻지 못한다. ADR-004가 요구하는 "PostgreSQL만으로 재구축 가능"이 그 데이터에 대해 성립하지 않고, JOB-ING-008은 그것을 `extra_in_es`로 오보한다 | WP-028 / 마이그레이션 010, ADR-004, JOB-ING-008 | 범위 공백 | **CR-037** | **resolved (2026-08-26)** — 마이그레이션 012는 **스키마만** 넓힌다(잡 유형 `snapshot_bootstrap` + `repository.snapshot_bootstrapped_at`). 채우기는 **JOB-ING-010**이 하며, 백필의 러너·커서·rate limit 처리·GHE 클라이언트를 **잡 유형만 바꿔 재사용**하고 `projectOne`에 `snapshotOnly`를 준다 — 두 번째 실행 틀도 두 번째 클라이언트도 만들지 않았다. 문서를 만드는 경로가 백필과 같아야 재구축 근거와 색인 내용이 갈라지지 않는다. **기존 마이그레이션 010·011은 고치지 않았다.** 마이그레이션 안에서 GHE·ES를 부르지 않는다. 예약은 조정 스캔에 얹고(DEV-190의 선례) 한 주기 5개로 제한하며, **예약과 러너를 같은 역할에 함께** 세웠다 — 그러지 않으면 DEV-178·DEV-180과 같은 자물쇠가 된다 |
| DEV-195 | 2026-08-26 | **부트스트랩 이전 상태를 색인 손상으로 확정한다.** 스냅숏이 아직 없는 저장소는 개수 대조에서 `count`, 식별자 대조에서 `extra_in_es`로 보고된다. "Elasticsearch가 잘못됐다"와 "PostgreSQL 정본 부트스트랩이 아직 끝나지 않았다"는 **다른 사실이고 조치도 다르다** — 뭉치면 운영자가 멀쩡한 색인을 의심하고, 진짜 잉여 문서가 그 소음에 묻힌다 | WP-028 / JOB-ING-008, ADR-004 | 구현 결함 (보고 의미) | **CR-037** | **resolved (2026-08-26)** — `snapshot_bootstrap_pending`을 신설해 가른다. 부트스트랩이 확인되지 않은 저장소는 그 이름으로 보고하고 **대조를 거기서 멈춘다** — 기대값 자체가 아직 완성되지 않았으므로 그 위의 판정은 전부 무의미하다. 재투영도 예약하지 않는다. `snapshot_bootstrapped_at`은 잡이 **실패 0건으로** 끝났을 때만 찍힌다 — 부분 완료를 완료로 적으면 감시가 그 위에서 거짓을 말한다. 자동 ES 삭제는 여전히 금지다. 구분을 지우는 변이가 단위 2건·통합 1건에 킬됐다 |
| DEV-196 | 2026-08-26 | **취소된 잡을 완료로 덮는다.** `runRepairJob`의 `jobRepo.finishJob` 호출이 무조건 UPDATE라, 운영자가 실행 중인 `sequence_reassign` 잡을 `cancelled`로 바꿔도 러너가 그 전이를 관측하지 못하고 `completed`(또는 `failed`)로 되돌린다. 비가역 복구도 취소와 무관하게 계속 진행된다 — 취소가 **반영되지도 존중되지도** 않는다 | WP-028 / JOB-SEQ-002, FR-ADMIN-002 AC-4 | 구현 결함 (잡 수명주기) | **CR-037** | **resolved (2026-08-26)** — `finishJobIfRunning`으로 전이 조건을 **UPDATE의 WHERE 절**에 넣었다. 읽고 나서 쓰는 방식으로는 못 고친다 — 읽기와 쓰기 사이에 취소가 들어오면 같은 경주가 그대로 남는다. 옮기지 못하면 현재 상태를 확인해 기록만 하고 덮지 않는다. 비가역 복구를 **시작하기 전에도** 한 번 보아, 큐에서 기다리는 사이 취소됐으면 아예 실행하지 않는다(창을 좁히는 예비 검사이며 종료 시점의 조건부 전이가 나머지를 막는다). 두 갈래를 각각 지우는 변이가 전부 킬됐다 |
| DEV-197 | 2026-08-26 | **수동 복구가 `EVT-SEQ-002`를 발행하지 않는다.** 에폭이 올라 이전 에폭의 모든 범위 인용이 무효가 됐는데도, 수동 경로는 지표와 릴리스 재해석 신호만 내고 `sequence.reassigned`를 발행하지 않는다. 자동 경로(`reassignSequence`)와 달리 알림·투영 소비자가 수동 복구를 통째로 놓친다 | WP-028 / EVT-SEQ-002, JOB-SEQ-002, FR-SEQ-005 | 구현 결함 (이벤트 계약) | **CR-037** | **resolved (2026-08-26)** — 발행 절차를 두 경로가 공유하는 **작은 헬퍼**(`publishSequenceReassigned`)로 뽑았다. `event_id`가 결정론적이라 소비자가 멱등하게 처리하고, 발행 실패는 던지지 않는다(재채번은 이미 커밋됐고 PostgreSQL이 정본이다). **알고리즘 전체를 합치지는 않았다** — 자동 재작성과 수동 복구는 시작 조건이 다르고, 하나의 큰 추상화로 묶으면 두 상황의 차이가 조건문 속으로 숨는다. 수동 경로의 발행만 지우는 변이가 킬됐다 |
| DEV-198 | 2026-08-26 | **`reassigning`이 다른 연결에서 관측되지 않는다.** 수동 경로는 `bumpEpoch`가 트랜잭션 안에서 상태를 설정하고 **같은 트랜잭션의** `advanceHead`가 즉시 `ok`로 되돌린다. 커밋 전까지 아무도 중간 상태를 볼 수 없으므로, 긴 재구축이 도는 내내 조회는 옛 에폭을 `ok`로 — 즉 **정상이라고** 낸다. 자동 경로는 `markReassigning`을 본 트랜잭션과 별개로 먼저 커밋한다 | WP-028 / JOB-SEQ-002, API-SEQ-006, FR-SEQ-005 | 구현 결함 (관측 가능성) | **CR-037** | **resolved (2026-08-26)** — 자동 경로처럼 `markReassigning`을 본 트랜잭션과 **별개로 먼저 커밋**한다. 아무것도 하지 않고 끝나는 갈래(락 실패·에폭 이동·head 이동)는 `restoreSequenceState`로 표시를 되돌린다 — 되돌리지 않으면 **아무 일도 하지 않는 공간이 영원히 재채번 중으로 광고된다.** 되돌리기는 `state = reassigning`일 때만 동작해, 그 사이 다른 경로가 세운 `stale`을 덮지 않는다. 다른 커넥션에서 재구축 중 상태를 실제로 읽는 통합 시험이 이것을 고정한다 |
| DEV-199 | 2026-08-26 | **그래프를 읽지 못한 실패가 `stale`로 남지 않는다.** `repairSequence`는 `resolveHead`·walk 실패에서 `{ kind: 'stale' }`을 **반환만** 하고 `markStale`을 부르지 않는다. 러너는 잡을 `failed`로 적을 뿐이라, 잠재적으로 손상된 시퀀스 공간이 계속 `ok`로 광고되고 검색·운영자 어느 쪽도 경고를 받지 못한다. 실패 트랜잭션은 롤백되므로 **롤백 이후 별도 커밋**이어야 한다 | WP-028 / JOB-SEQ-002, FR-SEQ-005, API-SEQ-006 | 구현 결함 (실패 상태) | **CR-037** | **resolved (2026-08-26)** — 롤백 **이후** 별도 커밋으로 `markStale`을 부른다(실패 트랜잭션 안에서는 남지 않는다). 서수 값(`head_seq`·`head_sha`·`seq_epoch`)은 건드리지 않는다 — **읽지 못한 것과 값이 틀린 것은 다르고**, 지우면 그 사이 모든 범위 인용이 죽는다. 실측 실패·트랜잭션 안 walk 실패·예외 세 갈래가 모두 같은 경로를 탄다. 영속을 지우는 변이가 킬됐다 |
| DEV-200 | 2026-08-26 | **딜리버리 문서 둘이 원장과 다른 사실을 말한다.** (1) WP-027 원장 행의 커밋 칸에 `화면 커밋` 플레이스홀더가 남아 실제 화면 커밋(`594fa94`)과 머지 후 정정(CR-032 / PR #34)을 추적할 수 없다. (2) `pr_search_work_packages.md`의 실행 순서표 상태 칸이 원장과 **22행** 어긋난다 — 리뷰가 지적한 WP-028·WP-068뿐 아니라 WP-002~WP-016·WP-024~WP-027이 전부 `todo`로 남아 있다. 후속 에이전트가 작업 패키지 문서를 기준으로 판단하면 이미 끝난 WP를 다시 하거나 의존성을 잘못 읽는다 | WP-027, WP-028, WP-068 / 원장 3장, 작업 패키지 실행 순서표 | 문서 간 모순 | **CR-037** | **resolved (2026-08-26)** — WP-027 행의 커밋 칸을 git에서 확인한 실제 SHA로 채웠다(`29d29d6`·`9aef48e`·`594fa94` / PR #33, `e514bfe`·`394854a` / PR #34). 작업 패키지 실행 순서표는 **22행**이 어긋나 있었다 — 리뷰가 지적한 WP-028·WP-068뿐 아니라 WP-002~016·WP-024~027이 전부 `todo`였다. 원장 기준으로 전량 정정하고 WP-028·WP-068의 DoD 체크박스도 검증 결과대로 채웠다. **WP-067은 미구현이므로 체크하지 않았다** |
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

| DEV-215 | 2026-08-26 | **JOB-REL-001·JOB-REL-005가 직접 푸시 커밋에 도달하지 않는다.** 잡 카탈로그가 적은 방아쇠는 `EVT-ING-003` 하나인데, 그 이벤트는 `project` 워커가 색인한 문서마다 낸다. WP-067이 새로 만드는 직접 푸시 커밋 문서는 그 경로를 지나지 않고 `commit-enrich`가 만든다 — 그 파일에는 `bus.subscribe`가 하나 있고 **`bus.publish`가 하나도 없다.** 그래서 직접 푸시 커밋 메시지의 참조는 영원히 간선이 되지 않는다. **CR-038이 DEV-206에서 잡은 것과 정확히 같은 모양이 한 홉 아래에 남아 있었다** | WP-029 / FR-REL-003, JOB-REL-001, JOB-REL-005 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — `EVT-ING-005 commit.metadata_ready` 신설. 커밋 보강이 **정본·색인이 모두 성공한 뒤에만** 낸다. payload는 bounded 식별자뿐이고 본문을 버스에 다시 싣지 않는다 — 소비자가 `commit_snapshot`에서 읽으므로 늦게 재전달된 이벤트도 현재 정본을 본다. 채번 → 보강 → 정본 → 색인 → 신호 → 파생 전 사슬을 **실제 git·PG·ES·버스**로 잇는 통합 시험이 건다 |
| DEV-216 | 2026-08-26 | **새 ready 신호를 `prs:projected`에 실으면 되먹임이 생긴다.** 그 이벤트를 내는 JOB-MIR-002가 같은 토픽을 `link:commit-enrich` 그룹으로 읽고 있어 자기 이벤트를 자기가 받는다. 방치하면 무한 루프이거나, 조용히 ack되면서 아무도 그 사실을 모른다 | WP-029 / EVT-ING-005, JOB-MIR-002 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — 토픽을 새로 만들지 않고 `event_name`으로 가른다. 보강은 이 이벤트를 받아 이것을 다시 내지 않는다. 실제 버스로 이벤트가 멎는지 보는 통합 시험 + 가드 존재를 거는 회귀. **진짜 루프를 만드는 변이가 킬되는 것**까지 확인했다 |
| DEV-217 | 2026-08-26 | **`link_id`가 가변 `to_id`를 재료로 써서 FR-REL-003 AC-3과 충돌한다.** 규칙은 세 곳에 같은 문장으로 적혀 있다 — 데이터 모델 4.3, `packages/es/src/mappings/links.ts`, `packages/domain/src/entities.ts`. `Refs: abc1234`가 미해결로 저장된 뒤 대상이 색인되면 `to_id`가 축약 SHA에서 40자 SHA로 바뀌고 `link_id`가 함께 바뀐다. 그러면 AC-3이 요구하는 **갱신**이 아니라 새 문서가 되고 미해결 간선이 그대로 남는다 — AC-3·멱등·결정론적 ID 셋이 한 번에 깨진다 | WP-029 / FR-REL-003 AC-3, ENT-REL-002, ADR-009 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — `reference_key` 신설. `references` 간선의 안정 ID는 `link_type` + source + `reference_key`이며 대상이 들어가지 않는다. 해결 전후로 **문서 `_id`가 같은지**를 통합 시험이 직접 본다. 역방향 조회는 커밋당 후보 일곱으로 상한이 있어 전량 스캔하지 않는다 |
| DEV-218 | 2026-08-26 | **커밋 매핑에 `links_pending`이 없다.** FR-REL-003의 예외 처리는 "추출 실패는 색인을 막지 않고 문서에 `links_pending: true`를 표시한다"인데, 요구사항이 PR **또는 커밋**을 대상으로 하면서 커밋 매핑에는 그 필드가 선언되어 있지 않다. 매핑이 `strict`라 표시 자체가 THR-010으로 거부된다 — 커밋에 대해서는 승인된 예외 처리를 표현할 수단이 없다 | WP-029 / FR-REL-003 예외 처리, ENT-CORE-003 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — 커밋 매핑에 `links_pending` 추가. `applyMappings`가 제자리 갱신하므로 재색인이 필요 없다 |
| DEV-219 | 2026-08-26 | **커밋 매핑 `link_summary`에 `reference_count`가 없다.** PR 매핑에는 있다. 커밋 상세(W-003)가 참조 수를 간선 인덱스 조회 없이 그릴 수 없어 ADR-009의 핫패스 비정규화가 커밋 축에서만 성립하지 않는다 | WP-029 / ENT-CORE-003, ADR-009 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — 커밋 매핑 `link_summary`에 `reference_count` 추가 |
| DEV-220 | 2026-08-26 | **본문에서 사라진 참조를 지울 계약이 없다.** WP-029 계약은 "추출하여 간선을 생성한다"까지다. PR 본문이 `Refs: #10`에서 `Refs: #20`으로 바뀌면 `#20`이 생기지만 **`#10`이 그대로 남는다.** 조사 도구에서 없는 참조를 있다고 말하는 것은 있는 참조를 놓치는 것과 같은 등급의 오류다 | WP-029 / FR-REL-003 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — 한 source의 참조를 **완전한 파생 집합**으로 다룬다. 정본에서 다시 만들고 나머지를 제거하되, **추출·쓰기가 실패한 회차는 제거하지 않고** `links_pending`으로 남긴다. V1→V2→V3 픽스처와 실패 회차 보존을 통합 시험이 건다 |
| DEV-221 | 2026-08-26 | **과거 엔티티에 간선을 만들 경로가 없다.** 새 `link` consumer group은 Redis stream을 `0`부터 읽을 수 있으나 stream retention은 정본이 아니고, WP-029 이전의 직접 푸시 커밋에는 애초에 `EVT-ING-003`이 없었다. 배포 뒤 "새 이벤트부터만 관계가 생긴다"가 운영 구멍으로 남는다 — CR-037이 DEV-194에서 PR 스냅숏 축에 대해 이미 겪은 자리다 | WP-029 / JOB-REL-006, ADR-004 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — 이미 카탈로그에 있는 **JOB-REL-006**을 references subset에 대해 실행 가능하게 했다. PostgreSQL 정본에서 재개 가능·경계 있는 열거(`pr_number`·`commit_sha` 오름차순 커서)이며 **같은 파생 핸들러**를 쓴다. 이벤트가 하나도 없는 과거 데이터와 색인을 비운 뒤 정본만으로의 복구를 통합 시험이 건다. `job.type`은 이미 있는 `link_rebuild`라 **마이그레이션을 만들지 않았다** |
| DEV-222 | 2026-08-26 | **`link_summary`의 leaf별 소유자가 없고 부분 갱신 수단도 없다.** 매핑에는 다섯 leaf가 있고 그중 넷이 WP-030 것이다. 그런데 `bulkUpsert`의 조건부 스크립트는 `ctx._source[key] = value`로 **객체를 통째 대입**하므로, WP-029가 `link_summary`를 그대로 쓰면 WP-030이 써 둔 값을 지운다 | WP-029 / ADR-009, ENT-CORE-002, ENT-CORE-003 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — leaf 단위 대입 전용 스크립트. 숫자는 `equals`로 비교하지 않는다 — painless에서 `Integer(3).equals(Long(3))`은 거짓이라 값이 같아도 매번 갱신으로 세어진다. WP-030 값 넷을 미리 심고 살아남는지 통합 시험이 건다 |
| DEV-223 | 2026-08-26 | **`to_repository_id`·`detached`를 누가 채우는지 정의되어 있지 않다.** 매핑에는 선언되어 있다. 소유가 없으면 WP-029가 미래 필드를 선점하거나(예: `detached: false`를 기계적으로 채움) 아무도 채우지 않는다. `strict` 매핑에서 값을 두지 않는 것과 `false`를 두는 것은 다른 주장이다 | WP-029 / ENT-REL-002 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — `to_repository_id`는 WP-029, `detached`는 WP-030. WP-029는 `detached`를 두지 않는다 — 계산하지 않은 것을 `false`로 적으면 "확인했고 아니었다"가 된다 |
| DEV-224 | 2026-08-26 | **저장소를 건너뛰는 참조의 접근 통제 경계가 문서에 없다.** `acme/a`의 PR이 `acme/b#20`을 참조하면 간선은 a의 접근 범위로 저장된다 — 그것이 맞다. 그러나 간선이 `to_repository_id: b`를 들고 있으므로, 관계 조회 API가 대상의 제목·본문을 함께 반환하면 **b를 볼 수 없는 사용자에게 b의 내용이 샌다.** WP-029는 조회 API를 만들지 않아 지금 유출은 없지만, 경계를 적어 두지 않으면 WP-031이 그것을 모른 채 만든다 — CR-036이 WP-068에서 겪은 것과 같은 종류다 | WP-029 / ADR-008, FR-AUTH-002, THR-034~036 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — THR-034·035·036 신설. **간선의 접근 범위는 근거를 소유한 저장소의 것**이며 대상 저장소의 것이 아니다. 대상의 내용을 반환하려면 대상 범위를 다시 교집합해야 한다는 것을 **WP-031의 필수 수용 기준**으로 남겼다. WP-029는 조회 API를 만들지 않으므로 현재 유출 경로가 없다 |
| DEV-225 | 2026-08-26 | **`@prs/domain`의 관계 타입 셋이 실제 매핑과 어긋난다.** `LinkSummary`는 `reverted_by_count`를 선언하는데 매핑에 없고, 매핑의 `is_reverted`·`has_stack`은 타입에 없다. `CommitRole`은 `'merge' | 'original'`인데 실제 값은 `merge_commit`·`source_commit`·`direct_push`다 — **`documents.ts`가 자기 `CommitRole`을 따로 정의해 쓰고 있어** 타입 검사가 드리프트를 잡지 못했다. `Link`에는 접근 통제 필드 넷과 `to_repository_id`·`detached`·`created_at`이 없다 | WP-029 / ENT-REL-002, ENT-CORE-003 | 문서 오류 | **CR-039** | **resolved (2026-08-26)** — `LinkSummary`·`CommitRole`·`Link`를 실제 매핑에 맞췄다. `documents.ts`의 별도 정의를 없애고 `Extract`로 좁혀 **타입 검사가 다음 드리프트를 잡게** 했다. ES 구현 detail을 전부 복사하지는 않았다 |
| DEV-226 | 2026-08-26 | **ADR-009 자신이 구현과 어긋난다.** Decision 블록의 간선 문서 구조에 `direction`이 있으나 매핑에 없고, 접근 통제 필드 넷과 `to_repository_id`·`detached`가 없다. `link_summary` 목록도 `reverted_by_count`를 적는다 | WP-029 / ADR-009 | 문서 오류 | **CR-039** | **resolved (2026-08-26)** — ADR-009 개정. 결정을 뒤집지 않고 적힌 것을 구현에 맞춘다(`direction` 제거, 접근 통제 필드 넷·`to_repository_id`·`detached` 추가, `link_summary` 목록 정정, `reference_key` 추가). **새 ADR을 만들지 않았다** — `reference_key`는 ADR-009가 이미 한 결정을 성립시키는 수단이다 |
| DEV-227 | 2026-08-26 | **`link` 모듈이 API-REL-001~004 전체를 소유한다고 적혀 있으나 사실이 아니다.** API-REL-001(`/sequence-neighbors`)은 WP-027이 `sequence` 경로로, API-REL-002(`/containments`)·API-REL-005(`/releases`)는 WP-024·WP-026이 릴리스 경로로 이미 구현했다. 둘 다 간선 인덱스를 읽지 않는다. 문서가 초기 설계를 사실처럼 말하면 다음 WP가 잘못된 자리에 코드를 넣는다 | WP-029 / API-REL-001, API-REL-002 | 문서 오류 | **CR-039** | **resolved (2026-08-26)** — 모듈 표를 API-REL-003·004로 정정하고 사유를 문단으로 남겼다 |
| DEV-228 | 2026-08-26 | **`retry` 처분에 재시도 예산을 집행하는 주체가 없다.** 잡 카탈로그는 재시도 3회를 적지만 Redis·in-memory 두 어댑터 모두 `retry`를 받으면 백오프만 늘리고 **횟수 상한을 보지 않는다.** 핸들러가 `delivery_count`로 집행해야 하는데 계약에 그 사실이 없다. **그리고 `apps/pipeline-worker/src/release.ts`의 JOB-REL-007이 실제로 그 상태다** — 미러 동기화·태그 열거·트랜잭션이 영구 실패하면 무한 재시도되며 그 파티션의 뒤 이벤트를 영영 막는다. PR #30의 P1 지적이 미해결로 남아 있었고 2026-08-26 재실측으로 확인했다 | WP-029 / JOB-REL-001, JOB-REL-005, **JOB-REL-007**, FR-ING-007 | 범위 공백 | **CR-039** | **resolved (2026-08-26)** — 예산을 핸들러가 `delivery_count`로 집행한다고 계약(§5.1)에 명시하고, link 핸들러와 **`release.ts`를 함께 고쳤다.** 두 파일 각각 예산 안/소진을 **행동으로** 거는 통합 시험 넷을 뒀다 — 텍스트 단언이 아니다. PR #30의 P1 지적이 이로써 닫힌다 |
| DEV-229 | 2026-08-26 | **`pr_search_work_packages.md` 헤더가 `v0.3 / 2026-08-20`에 멈춰 있다.** 내용은 2026-08-26까지 갱신됐다(WP-028·067·068 `done` 반영). 상태표를 근거로 판단하는 후속 에이전트가 문서가 낡았다고 오판한다 | WP-029 / 문서 위생 | 문서 오류 | **CR-039** | **resolved (2026-08-26)** — `pr_search_work_packages.md` v0.4 / 2026-08-26 |
| DEV-230 | 2026-08-26 | **JOB-REL-002(되돌림)의 방아쇠가 `EVT-ING-003`뿐이다.** 그 이벤트는 `project` 워커가 색인한 문서마다 내는데 **직접 푸시 커밋 문서는 `project`가 만들지 않는다** — 커밋 보강(JOB-MIR-002)이 만든다. 되돌림의 근거는 커밋 메시지이고 직접 푸시 커밋도 되돌림 커밋일 수 있으므로, 그대로 두면 **그 커밋의 되돌림은 영원히 간선이 되지 않는다.** CR-038(DEV-206)·CR-039(DEV-215)가 잡은 것과 같은 모양의 세 번째다 | FR-REL-004 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-231 | 2026-08-26 | **JOB-REL-003(체리픽)의 방아쇠도 `EVT-ING-003`뿐이며, 여기에는 이유가 하나 더 있다.** `patch_id`는 커밋 보강이 채우는데 `EVT-ING-003`은 **투영 시점**에 나온다 — 그때는 값이 아직 없다. 그 시점에 판정하면 `derived` 경로가 언제나 "값 없음"으로 끝나 FR-REL-005 AC-2가 실질적으로 죽는다. 정본에 값이 들어간 뒤를 알리는 신호는 `EVT-ING-005`다 | FR-REL-005 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-232 | 2026-08-26 | **JOB-REL-004에 상위 PR 변화가 하위 PR 간선을 바꾸는 경로가 없다.** 계약은 source PR ready만 방아쇠로 적는데, FR-REL-006 AC-3이 요구하는 것은 **상위 PR이 머지되면 간선을 해제 표시**하는 것이다. 간선은 **하위 PR이 소유**(`from`)하므로 하위 PR에는 그때 아무 이벤트도 오지 않는다. 그대로 두면 머지된 상위 PR에 대한 스택 의존이 영원히 `active`로 남는다 | FR-REL-006 AC-3 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-233 | 2026-08-26 | **source 본문이 바뀌었을 때 되돌림·체리픽 간선을 제거하는 계약이 없다.** WP-029가 참조 축에 세운 "완전한 파생 집합"(DEV-220) 규율이 세 계열에는 적혀 있지 않다. 되돌림 표현이 편집으로 사라져도 간선이 남으면 조사 도구가 **없는 사실을 말한다.** 단 계열마다 수명이 달라 하나의 일반 규칙으로 뭉칠 수 없다 — `stacks_on`은 제거가 아니라 `detached`다 | FR-REL-004~006 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-234 | 2026-08-26 | **JOB-REL-006의 구현이 `references`만 재파생한다.** 잡 카탈로그는 이미 이 잡을 FR-REL-003~006으로 적고 3.3장이 "WP-030이 같은 틀에 확장한다"고 적어 두었으나 `runReferenceRebuild`는 참조만 돈다. 확장하지 않으면 **배포 뒤 새 이벤트부터만 관계가 생긴다**가 세 계열에 그대로 남고, PostgreSQL만으로 `prs-links`를 다시 만든다는 ADR-004 증명도 참조 축에서만 성립한다 | FR-REL-003~006 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-235 | 2026-08-26 | **WP-030의 patch-id 실패 설명이 SRS보다 낡았다.** WP는 "patch-id 실패 시 null + 메트릭" 한 줄인데, SRS FR-REL-005 AC-5는 세 사유(`no_mirror`·`blob_fetch_disabled`·`compute_failed`)를 가르고 **시도하지 않은 것은 `patch_id` 필드를 두지 않는다**고 정한다(CR-024, DEV-111). CR-038이 이미 그렇게 구현했다(`patch_id` XOR `patch_id_unavailable` CHECK 제약). WP 문서만 그 전 상태에 멈춰 있다 | FR-REL-005 AC-5 / WP-030 | 문서 오류 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-236 | 2026-08-26 | **QA-W002-11·12를 WP-030의 DoD가 인용하는데 이 WP로는 통과할 수 없다.** 둘은 W-002 화면 동작이다 — "되돌림 관계가 정·역방향 모두 **조회된다**", "체리픽 신뢰도가 구분 **표시된다**". 관계 조회 API와 상세 화면 관계 섹션은 **WP-031 소유**이며 WP-030의 제외 목록에도 그렇게 적혀 있다. 소유를 옮기지 않으면 통과할 수 없는 기준이 DoD에 남거나, 화면을 이 WP로 당겨오게 된다 | FR-REL-004·005 / WP-030·WP-031 | 문서 오류 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-237 | 2026-08-26 | **FR-REL-004의 예외 처리가 WP-030 DoD에 없다.** SRS는 "제목 대조 후보가 2건 이상이면 **모든 후보**를 `heuristic`으로 저장하고 화면에 다중 후보임을 표시한다"고 정하는데 DoD에 그 항목이 없다. 명시하지 않으면 구현이 `LIMIT 1`이나 "가장 최근 하나"로 좁히기 쉽고, 그것은 조사 도구가 **자신 있게 틀린 답**을 내는 모양이다 — ADR-012가 축약 SHA에서 금지한 것과 같다 | FR-REL-004 예외 처리 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-238 | 2026-08-26 | **스택 `detached`가 구현 범위에는 있으나 DoD에 없고, 되돌리는 방향이 정의되어 있지 않다.** FR-REL-006 AC-3은 "해제 상태로 **표시**"를 요구하므로 간선을 지우면 안 된다 — 지우면 *그런 의존이 있었다*는 사실이 사라져 사후 조사가 불가능해진다. 그리고 상위 PR 재오픈·분기 복구로 조건이 다시 성립할 수 있는데 그때의 처리가 어디에도 없다. **한 번도 성립한 적 없는 후보에 `detached: true`를 미리 두는 것**도 금지해야 한다 — 없었던 관계를 주장하게 된다 | FR-REL-006 AC-3 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-239 | 2026-08-26 | **`summary.reverted_pull_request_count` 이월분이 구현 범위에만 있고 DoD에 없다.** CR-027(DEV-133)이 "되돌림 파생 전에는 세면 언제나 0"이라며 키를 뺐고 CR-029(DEV-150)가 화면을 "준비 중"으로 두었다. WP-030이 그 조건을 해소하는 WP인데 완료 기준이 없으면 이월이 또 미뤄진다. **N+1 금지도 함께 적어야 한다** — PR마다 간선 인덱스를 다시 물으면 5만 건 구간에서 요약이 서지 않는다 | FR-SEQ-002 AC-2, FR-SEQ-004 AC-2 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-240 | 2026-08-26 | **정본에 후보 조회용 인덱스가 없다.** `pull_request_snapshot`은 `(repository_id, pr_number)` 하나뿐이고 본문은 `document JSONB`라 제목·분기·상태에 인덱스가 없다. `commit_snapshot`도 `(repository_id, fetched_at)`과 미투영 부분 인덱스뿐이라 `patch_id` 조회 인덱스가 없다(실측). 파생 정본이 PostgreSQL이어야 하는데(ADR-004) 후보 탐색이 저장소 전체 스캔이 되면 방아쇠마다 그것을 돌 수 없다 | FR-REL-004~006 / WP-030 | 기술 제약 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-241 | 2026-08-26 | **`link_summary` boolean leaf의 계산 규칙이 없다.** 간선 하나를 제거하면서 `has_revert = false`를 쓰는 구현이 자연스럽게 나오는데, **같은 종류의 다른 간선이 남아 있을 수 있다.** `false`는 "확인했고 현재 없다"여야 하며 그러려면 조정이 끝난 뒤 **현재 active 간선 집합에서 다시 계산**해야 한다. `has_stack`은 `detached`가 아닌 것만 세야 한다는 것도 정해져 있지 않다 | FR-REL-004~006 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-242 | 2026-08-26 | **후보가 source보다 나중에 나타날 때 관계가 수렴하는 경로가 어느 계열에도 없다 (DEV-232의 일반형).** 셋이 같은 모양이다 — ① `Revert "X"`가 후보 1건으로 해결된 뒤 같은 제목 PR이 하나 더 들어온다 ② `patch_id=P`인 커밋 A만 있다가 나중에 B가 들어온다 ③ 상위 PR이 머지된다. **셋 다 source에는 새 이벤트가 없다.** source-ready만 구독하면 관계 집합이 영원히 그 시점에 멈춘다 | FR-REL-004~006 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-243 | 2026-08-26 | **체리픽 `derived` 간선의 방향과 상위 5건 순서가 정의되어 있지 않다.** FR-REL-005 AC-4는 "상위 5건만 저장"이라고만 적는다. 순서가 비결정론이면 **같은 정본에서 다른 색인이 나와** ADR-004의 재구축 증명("PostgreSQL만으로 같은 `prs-links`를 만든다")이 성립하지 않는다. 방향도 정해지지 않아 같은 쌍이 양방향 두 건으로 저장될 수 있다 | FR-REL-005 AC-4 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-244 | 2026-08-26 | **같은 `head_branch`를 가진 열린 PR이 여럿일 때가 정의되어 있지 않다.** FR-REL-006은 "다른 열린 PR"이라고 단수로 적지만 계약이 유일성을 보장하지 않는다. 구현이 첫 결과 하나를 고르면 실제 의존 하나가 조용히 사라지고, 그 사실은 어디에도 드러나지 않는다 — DEV-237과 같은 모양이다 | FR-REL-006 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-245 | 2026-08-26 | **`references`가 아닌 간선의 ID를 만드는 헬퍼가 없다.** 데이터 모델 4.3장은 재료를 이미 정해 두었으나(`{link_type}:{from_type}:{from_id}:{to_type}:{to_id}`) 코드에는 `referenceLinkId` 하나뿐이고 그 함수는 `'references'`를 하드코딩한다. 없으면 세 계열이 각자 ID를 만들게 되고, 그러면 재파생 멱등이 계열마다 다른 근거 위에 서게 된다 | ENT-REL-002 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-246 | 2026-08-26 | **WP-030의 실패 처분이 정의되어 있지 않아 `links_pending`을 재해석할 위험이 있다.** 그 필드는 FR-REL-003 **참조 추출**의 완결 상태이며 화면이 그 뜻으로 읽는다. WP-030 실패를 거기 실으면 한 필드가 두 뜻을 갖고, "관계 미확정"이 무엇을 가리키는지 아무도 말할 수 없게 된다. 새 pending 필드를 만드는 것도 답이 아니다 — SRS가 요구하지 않는다 | FR-REL-003~006 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-247 | 2026-08-26 | **FR-REL-006 AC-5가 요구하는 순환 지표가 없다.** "순환이 감지되면 간선을 생성하지 않고 **운영 지표로 기록한다**"인데 `metrics.ts`에 그런 지표가 없다(`reconcile_incomplete_cycles`는 조정 스캔 주기 수로 뜻이 다르다). 지표 없이 구현하면 순환이 조용히 무시되어, 스택 관계가 비어 있는 것이 정상인지 순환 때문인지 운영자가 가를 수 없다 | FR-REL-006 AC-5 / WP-030 | 범위 공백 | **CR-041** | resolved (2026-08-26) — CR-041 |
| DEV-248 | 2026-08-26 | **저장된 관계 간선을 사용자에게 줄 API가 하나도 없다.** WP-029·WP-030이 `prs-links`에 references·reverts·cherry_picks·stacks_on을 채웠는데, API 카탈로그에서 그 인덱스를 읽는 조회가 없다 — API-REL-001은 `merge_sequence`, 002·005는 릴리스, 003은 조회 시점 계산, 004는 그래프(WP-043)다. WP-031 구현 범위 첫 줄이 "관계 조회(정방향 `from_id`, 역방향 `to_id`)"인데 그것을 줄 API ID가 없다. CR-030 DEV-155("릴리스 목록을 줄 경로가 없었다" → API-REL-005 신설)와 같은 모양이다 | FR-REL-003~006 / WP-031 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — `GET /relations`(**API-REL-006**)를 신설하고 카탈로그·상세 절을 함께 썼다. 앵커 하나 · `link_type` 하나 · `direction` 하나 · 상한 있는 응답 |
| DEV-249 | 2026-08-26 | **API-REL-003 상세 절이 아예 없다.** `pr_search_api_contracts.md` 4장에 `### API-REL-001`·`002`·`004`·`005`는 있고 003만 없다 — 카탈로그 3장의 한 줄이 전부다. WP-031 구현 범위인 `/co-changes`의 요청·응답·오류·자격 판정이 정의된 곳이 없어, 구현이 FR-REL-007 AC 다섯을 각자 해석하게 된다 | FR-REL-007 / WP-031 | 문서 오류 | **CR-042** | **resolved (2026-08-26)** — 상세 절을 신설했다. 자격 상태 셋·정확 자카드·상위 20 결정론 정렬·겹치는 경로 상위 10 |
| DEV-250 | 2026-08-26 | **역방향 조회가 source 저장소 라우팅에 묶여 있어 저장소를 건너뛰는 참조를 구조적으로 빠뜨린다.** `findLinksTo`는 `routing: repositoryId` + `term: { repository_id }`로 친다. 그런데 **간선은 근거를 소유한 저장소에 산다**(THR-035) — `acme/a`의 PR이 `acme/b#20`을 참조하면 그 간선의 `repository_id`는 `a`다. `b`에서 "나를 가리키는 참조"를 물으면 `a`·`c`의 간선을 **어떤 라우팅으로도 찾을 수 없다.** 되돌림·체리픽·스택은 동일 저장소 관계라 그 경로에서 둘이 같았고(함수 주석이 그 사실을 적는다), 그래서 워커에서는 결함이 아니었다. 조회에 그대로 쓰면 FR-REL-003 AC-3의 역방향이 cross-repo에서 침묵한다 | FR-REL-003 AC-3, FR-REL-004 AC-3 / WP-031 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — 조회 경로는 **라우팅을 쓰지 않고** `to_type`·`to_id`로 친다. 경계는 라우팅이 아니라 **강제 접근 범위 필터**가 만든다. 통합 시험이 A→B·C→B에서 caller가 A만 볼 때 A→B만 나오는 것을 건다 |
| DEV-251 | 2026-08-26 | **워커의 읽기 형태가 화면 계약보다 좁다.** `StoredLink`는 `link_id`·`repository_id`·`link_type`·`from_*`·`to_*`·`detached`·`resolved`뿐이고 `_source`도 그 목록으로 잘린다. C-021은 **방향·신뢰도·근거**를 필수로 요구하고(`confidence`·`evidence`), cross-repo 표시에는 `to_repository_id`가 필요하다. 워커 타입을 HTTP DTO로 쓰면 화면이 요구하는 것을 담을 수 없고, 반대로 워커 타입을 넓히면 조정 경로가 필요 없는 필드를 매 회차 실어 나른다 | FR-REL-003 AC-2 / WP-031, C-021 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — 사용자 대면 **읽기 투영**을 별도로 두었다. 워커의 `StoredLink`는 그대로 둔다 |
| DEV-252 | 2026-08-26 | **워커의 무한 스크롤을 HTTP에 노출하면 응답에 상한이 없다.** `scrollLinks`는 `search_after`로 **끝까지** 읽어 배열에 모은다 — 조정에는 옳다(한 페이지만 읽으면 나머지가 영영 조정되지 않는다, PR #44 리뷰 P2). 그러나 한 대상을 수백·수천 source가 가리킬 수 있고, 그것을 그대로 응답으로 내면 한 요청이 힙과 p95를 동시에 잡아먹는다. 계약에 상한이 없어 구현이 그 함수를 그대로 재사용할 유인이 크다 | NFR-001 / WP-031, ADR-010 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — 한 요청은 **한 유형 · 한 방향**이며 `limit` 기본 50 · 최대 100, 내부에서 `limit + 1`을 읽어 `truncated`를 판정한다. **오프셋을 만들지 않는다**(공통 원칙 7, ADR-010) — 커서를 세울 요구사항이 아직 없으므로 상한과 절삭 표시로 답한다 |
| DEV-253 | 2026-08-26 | **THR-034가 WP-031의 필수 수용 기준이라고 적혀 있는데 DoD 여덟 항목에 없다.** CR-039가 선행 조건 문단(`work_packages.md`)과 위협 표에 적었으나 완료 기준 체크박스에는 넣지 않았다 — **체크되지 않는 수용 기준은 수용 기준이 아니다.** 게다가 교집합의 *방법*을 어디에도 적어 두지 않았다: 대상 문서를 강제 필터로 다시 조회하는가, 간선만 주고 내용은 별도 조회로 미루는가, 범위 밖일 때 무엇을 응답에 남기는가 | FR-AUTH-002, THR-034 / WP-031 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — 간선 조회와 대상 내용 조회를 **두 번의 독립한 강제 필터**로 가르고, 대상이 범위 밖이면 간선·식별자·근거는 남기고 **내용 필드를 두지 않는다**(키 부재). 화면 문구는 사유를 구분하지 않는다 — "권한이 없습니다"는 존재를 밝힌다. DoD에 항목으로 넣고 대적 매트릭스 넷을 시험으로 건다 |
| DEV-254 | 2026-08-26 | **동시 변경의 자격 상태 계약이 없다.** FR-REL-007 AC-2가 "머지 시각 기준 앞뒤 90일"로 창을 정하는데 **미머지 PR에는 `merged_at`이 없다** — 기준점 자체가 없다. 계약이 그 상태를 말하지 않으면 구현이 `created_at`·`updated_at`으로 조용히 대체하게 되고, 그러면 AC-2가 정한 창이 아닌 다른 창을 계산한 뒤 그것을 자카드 상위 20이라고 부른다. AC-4의 200개 기준도 판정 근거가 적혀 있지 않다 — `files_truncated`는 **3000개** 상한(`MAX_CHANGED_FILES`)의 표식이라 다른 계약이며, `files_truncated: false`에서 "그러니 200 이하"를 추론하면 틀린다 | FR-REL-007 AC-2·AC-4 / WP-031 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — 자격 상태 셋을 정본으로 삼는다: `not_merged`·`enrichment_pending`·`too_many_changed_files`. 셋 다 오류가 아니라 **정상 도메인 상태**이며 `available: false` + `reason`으로 답한다. 200 판정은 **`changed_files_count`로만** 한다 |
| DEV-255 | 2026-08-26 | **정확한 자카드를 어떻게 계산하는지 계약이 정하지 않는다.** AC-1이 자카드, AC-3이 상위 20을 요구하지만 후보 집합을 좁히는 방법이 없다. "후보를 100건 뽑아 앱에서 계산해 상위 20" 같은 구현은 **진짜 상위 20이 101번째 밖에 있을 수 있다** — 그리고 그 사실이 응답 어디에도 드러나지 않아 사용자는 완전한 답을 받았다고 믿는다. 조사 도구에서 그것은 조용한 오답이다 | FR-REL-007 AC-1·AC-3 / WP-031 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — 자격 조건과 **경로 교집합 존재**를 Elasticsearch가 먼저 강제하고, 자카드를 `changed_paths.raw` 위에서 정확히 계산해 `_score` 내림차순 · `pr_number` 오름차순으로 상위 20을 뽑는다. **앱단 pre-limit을 두지 않는다.** 실제 Elasticsearch 통합 시험이 상위 20 밖에 놓인 후보를 포함한 픽스처로 이것을 건다 |
| DEV-256 | 2026-08-26 | **겹치는 경로 상위 10의 순서가 정의되어 있지 않다.** AC-5는 "상위 10개가 포함된다"만 말한다. 순서 없이 구현하면 Elasticsearch 반환 순서·집합 순회 순서가 정하게 되어 **같은 정본이 다른 응답**을 낸다 — ADR-004의 "같은 정본에서 같은 결과"가 이 축에서 깨지고, 사용자가 URL로 인용한 조사 결과가 재현되지 않는다 | FR-REL-007 AC-5, ADR-004 / WP-031 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — **사전순 오름차순** 후 앞 10개로 고정했다. "상위"에 순위 개념이 없으므로 결정론을 우선한다 |
| DEV-257 | 2026-08-26 | **C-021 상태 모델이 WP-030이 만든 사실을 표현하지 못한다.** 상태 목록은 `collapsed`·`loading`·`ready`·`links_pending`·`unresolved`뿐이고 **`detached`는 `docs/20_derived_ui_specs/` 전체에 0회** 등장한다. 해제된 스택 의존을 "관계 없음"으로 그리면 FR-REL-006 AC-3이 **지우지 않고 보존한 사실**이 화면에서 사라진다 — 저장 계층이 지키기로 한 것을 표시 계층이 버린다. 대상 내용을 볼 수 없는 항목(THR-034)과 섹션 조회 실패를 표현할 자리도 없다 | FR-REL-006 AC-3, THR-034 / WP-031, C-021 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — 상태를 **섹션 축**(`collapsed`/`loading`/`ready`/`error`)과 **항목 축**(`detached`·`unresolved`·`content_unavailable`·`ambiguous`)으로 갈랐다. 한 enum에 두 축을 넣지 않는다 |
| DEV-258 | 2026-08-26 | **`links_pending`의 뜻이 UI 문서에서 드리프트했다.** CR-041이 "FR-REL-003 **참조 추출**의 완결 상태"로 확정했는데, FLOW-006 예외는 "관계 파생 미완료", 상태 매트릭스 W-002는 "관계 파생 미완료 → 관계 섹션에 분석 중 배지", `PrDetailView.tsx`는 그 값으로 관계 섹션 **전체**를 "관계 파생이 아직 끝나지 않았습니다"로 덮는다. 참조 추출 실패 하나가 **이미 계산된** 되돌림·체리픽·스택을 숨긴다 — 있는 사실을 없다고 그리는 것이다 | FR-REL-003 예외 처리 / WP-031 | 문서 오류 | **CR-042** | **resolved (2026-08-26)** — 문구를 **"참조 분석 중"**으로 정정하고 범위를 참조 그룹으로 좁혔다. 다른 세 계열은 그 상태에서도 그대로 표시한다. 새 pending 필드를 만들지 않는다(DEV-246의 규율) |
| DEV-259 | 2026-08-26 | **FLOW-006 관련 요구사항에 FR-REL-006·FR-REL-007이 없다.** 003·004·005·008뿐이다. 그런데 같은 문서의 W-002-LINKS 섹션 정의는 스택과 동시 변경을 그룹으로 적고 QA-W002-13·14는 동시 변경을 검증 항목으로 둔다 — 흐름 명세만 둘을 모른다. 흐름을 근거로 판단하는 구현이 스택·동시 변경을 범위 밖으로 읽는다 | FR-REL-006, FR-REL-007 / FLOW-006 | 문서 오류 | **CR-042** | **resolved (2026-08-26)** — 관련 요구사항에 FR-REL-006·007을 더했다 |
| DEV-260 | 2026-08-26 | **FLOW-006이 승인되지 않은 제품 판단을 예외 흐름으로 적는다.** "체리픽 후보 없음: **백포트 누락 후보**로 표시한다"인데 FR-REL-005 어디에도 그런 판정이 없다. 게다가 AC-2가 CR-024(DEV-111)로 조건부가 된 뒤 **운영 기본 상태는 `blob_fetch_disabled`**라 후보가 없는 것이 정상이다 — 정상 상태를 "누락 후보"로 부르면 화면이 없는 기능을 지어내고 사용자는 그 추론을 사실로 읽는다 | FR-REL-005 AC-2·AC-5 / FLOW-006 | 문서 오류 | **CR-042** | **resolved (2026-08-26)** — 문장을 삭제하고 "체리픽 관계 없음"과 `patch_id_unavailable` **사유 표시**로 바꿨다. 사유 셋(`no_mirror`·`blob_fetch_disabled`·`compute_failed`)은 FR-REL-005 AC-5가 이미 정한 것이다 |
| DEV-261 | 2026-08-26 | **다중 후보 되돌림을 표시할 계약이 없다.** FR-REL-004 예외 처리는 "제목 대조 후보가 2건 이상이면 모든 후보를 신뢰도 `heuristic`으로 저장하고 **화면에 다중 후보임을 표시한다**"인데, 그 표시가 어느 UI 문서에도 없다. 저장은 WP-030이 이미 한다(`planReverts`가 후보를 좁히지 않는다, DEV-237). 표시 계약이 없으면 구현이 목록의 첫 항목을 확정된 대상처럼 그리게 되고, 그것이 정확히 DEV-237이 저장 계층에서 막은 "자신 있게 틀린 답"이다 | FR-REL-004 예외 처리 / WP-031, C-021 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — 같은 근거(`evidence`)를 공유하는 `heuristic` 되돌림 항목이 둘 이상이면 그 그룹을 **다중 후보**로 표시한다. 응답이 근거를 싣고 있으므로 새 저장 필드를 만들지 않는다 |
| DEV-262 | 2026-08-26 | **W-001이 WP-031 관련 화면에서 빠져 있다.** 와이어프레임 W-001은 "관계 배지 열은 **WP-031이 붙인다** — `C-015`가 그 WP 소관"이라 적고 `ResultTable.tsx` 주석도 같은 말을 하는데, WP-031의 관련 화면은 `W-002, W-003`뿐이고 관련 API도 `API-REL-003`뿐이다. 이월받은 WP가 자기 범위에 그것이 있다는 것을 모른다 — 이 상태로 WP-031을 닫으면 C-015는 **어느 WP의 것도 아닌 채로** 남는다 | FR-SRCH-006, FR-REL-004, FR-REL-005 / WP-031, C-015, W-001 | 문서 오류 | **CR-042** | **resolved (2026-08-26)** — WP-031 관련 화면에 **W-001**을, 관련 API에 **API-REL-006**을 더했다. 범위 확장이 아니라 이월 계약의 누락 정정이다 |
| DEV-263 | 2026-08-26 | **W-003에 관계 섹션의 상태와 QA 항목이 없다.** 상태 매트릭스 W-003에는 관계 관련 상태가 하나도 없고(`enrichment_pending`·`multi_pr`·`no_pr`·`no_sequence`뿐), QA-W003-01~09에도 관계 항목이 없다. 그런데 W-003-LINKS 섹션은 와이어프레임에 정의돼 있고 WP-031 범위다 — 검증할 항목이 없는 화면 기능이 된다 | FR-REL-003~005 / WP-031, W-003 | 범위 공백 | **CR-042** | **resolved (2026-08-26)** — W-003 상태 매트릭스에 관계 섹션 상태를 더하고 QA-W003-10을 신설했다 |
| DEV-264 | 2026-08-26 | **검색 API가 싣는 `link_summary`를 웹이 버린다.** `search/service.ts`가 `link_summary: source.link_summary ?? null`로 항목마다 실어 보내는데 `ResultTable.tsx`의 `ResultRow`에 그 필드가 없어 렌더링 경계에서 사라진다. C-015를 붙일 때 데이터가 없다고 판단해 행마다 관계 조회를 보내는 구현이 나오면 **ADR-009가 비정규화를 둔 이유가 무너진다** — 목록 화면의 배지를 간선 인덱스 조회 없이 그리기 위한 필드다 | FR-SRCH-006, ADR-009 / WP-031, C-015 | 구현 공백 | **CR-042** | **resolved (2026-08-26)** — `ResultRow`에 `link_summary`를 실어 C-015까지 잇는다. 행마다 관계를 조회하지 않는다는 것을 시험으로 건다 |
| DEV-265 | 2026-08-26 | **ADR-008 가드레일의 면제가 파일 단위라 조회 코드를 `links.ts`에 넣으면 워커용 면제를 물려받는다.** `architecture.test.ts`의 `UNSCOPED_ALLOWLIST`는 경로 문자열이고 `packages/es/src/links.ts`가 `no_requester`로 올라 있다 — 그 사유는 "방아쇠가 이벤트와 운영자 잡이라 요청자가 없다"이며 같은 항목이 **"사용자에게 내주는 관계 조회 API는 WP-031이 만들며 거기서 대상 범위를 다시 교집합해야 한다"**고 미리 적어 두었다. 그 파일에 사용자 대면 조회를 더하면 검사기가 아무것도 말하지 않는다. 그리고 세 번째 검사는 `msearch`·`count`·`scroll`·`openPointInTime`만 보므로 **`get`·`mget`은 검사 대상이 아니다** — 대상 내용을 `mget`으로 붙이는 구현이 가드레일을 그대로 통과한다 | ADR-008, THR-034 / WP-031 | 구현 공백 | **CR-042** | **resolved (2026-08-26)** — 조회 계층을 `links.ts` **밖의 새 파일**에 두어 면제를 물려받지 않게 하고, 가드레일에 `get`·`mget`을 더했다 |
| DEV-266 | 2026-08-26 | **`edge_ngram` 분석기를 살아 있는 인덱스에 추가할 수 없다.** WP-032 구현 범위가 `standard` + `edge_ngram` 부분 일치 필드를 요구하는데(CR-040), `edge_ngram` 필터·분석기는 `index.analysis` 아래의 **비동적 설정**이다. 실제 Elasticsearch 8로 확인했다 — 열린 인덱스에 추가하면 `illegal_argument_exception: Can't update non dynamic settings ... for open indices`로 거절된다. `packages/es/src/bootstrap.ts`의 기존 인덱스 경로는 `putMapping`만 부르므로 settings를 갱신하지도 않는다. `close` → `putSettings` → `open`은 그 구간 검색이 중단되어 FR-ING-008·NFR-008이 막는다 | WP-032, WP-035 / FR-SRCH-011, FR-ING-008 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — **WP-032의 선행 WP에 WP-035를 추가한다.** REL-004의 실행 순서를 WP-029 → WP-030 → WP-031 → **WP-035** → WP-032로 정정했다. WP ID는 재번호화하지 않는다 — 순서를 정하는 것은 번호가 아니라 의존이다 |
| DEV-267 | 2026-08-26 | **분석기가 있더라도 새 서브필드는 기존 문서에서 비어 있다.** `putMapping`으로 `title.partial`을 더하는 것은 하위 호환 변경이라 `acknowledged: true`가 나오지만, Elasticsearch는 기존 문서를 다시 색인하지 않는다. 실측: 서브필드 추가 직후 `title.partial` 조회가 **0건**, `_update_by_query` 뒤에 **1건**. 매핑만 올리고 배포하면 전문 검색이 **과거 데이터에 대해 조용히 적게** 답한다 — 이 제품이 가장 경계하는 실패 모양이다 | WP-032, WP-035 / FR-SRCH-011 AC-4 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — 재색인은 활성화의 **일부**다. DEV-266과 독립한 두 번째 벽이며 둘 다 WP-035를 가리킨다. WP-032 계약에 "매핑 버전 상향은 WP-035의 재색인 경로로 적용한다"를 명시했다 |
| DEV-268 | 2026-08-26 | **하위 문서가 SRS보다 넓다 — W-004 패싯.** 와이어프레임 `W-004-FACETS`가 "작성자·팀·라벨·경로 패싯"을 FR-SRCH-006·FR-SRCH-009 근거로 요구하고 WP-032 구현 범위도 "W-004에도 패싯 적용"을 적는데, SRS FR-SRCH-009의 관련 화면은 **W-001뿐**이었다. PRD의 SCN-002 기본 흐름은 이미 그 동작을 서술한다 — 뒤처진 것은 SRS다 | WP-032 / FR-SRCH-009, W-004 | 문서 간 모순 | **CR-043** | **resolved (2026-08-26)** — **기능을 지우지 않고 SRS를 v2.7로 올렸다.** FR-SRCH-009 관련 화면에 W-004를 더하고 AC-1에 화면별 패싯 축을 명시했다 — W-001은 여섯, W-004는 넷(저장소·대상 브랜치는 시퀀스 공간이 고정한다) |
| DEV-269 | 2026-08-26 | **FR-SEQ-002에 페이지네이션 계약이 없다.** AC-1~5는 반개구간·요약·역전·상한·공간 불일치뿐이고, API-SEQ-001의 `next_cursor`는 늘 `null`이다(DEV-138). 구간은 5만 건까지 허용되는데 `size` 상한은 200이라 **끝까지 훑을 방법 자체가 없다** — 그리고 그것이 이 제품의 핵심 사용(구간 조사)이다 | WP-032 / FR-SEQ-002, ADR-010 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — FR-SEQ-002에 **AC-6·7·8**을 더했다. AC-6 커서 순회와 오프셋 부재, AC-7 커서 봉인 재료, AC-8 패싯 계산 대상. 기존 AC-1~5는 한 글자도 바뀌지 않았다 |
| DEV-270 | 2026-08-26 | **범위 조회가 `q` 필터를 정본 페이지를 자른 뒤에 적용한다 — 요약과 목록이 어긋난다.** `runRange`는 `findRangePage`로 구간의 **첫 `size` 행**을 읽고 그 안에서만 `q`를 판정하는데, 요약은 `listPullRequestNumbersInRange`가 준 **구간 전체**를 기준으로 센다. **실제 PostgreSQL·Elasticsearch로 재현했다**: 구간 1~60, `size=10`, 일치가 서수 51 하나뿐인 `q` → `summary.pull_request_count: 1`, `items: []`, `next_cursor: null`. 같은 질의를 `size=60`으로 하면 서수 51이 나온다. 데이터가 아니라 **절삭**이 원인이고, 커서가 없으므로 사용자는 그 항목에 **도달할 수 없다** | WP-023, WP-032 / FR-SEQ-002, API-SEQ-001 | 구현 결함 | **CR-043** | **계약 확정 (2026-08-26), 구현은 WP-032** — 커서가 가리키는 것은 "마지막으로 반환한 항목"이 아니라 **"마지막으로 검사한 서수"**다. 한 페이지를 만들 때 정본 구간을 상한 있는 chunk로 읽어 판정하고 `size`가 차거나 구간 끝까지 스캔한다. 일치가 적다는 이유로 순회가 중간에 끝나지 않는다. 구간 상한 5만이 최악을 유계로 만든다 |
| DEV-271 | 2026-08-26 | **커서에 무결성 보호가 없다.** ADR-010은 "불투명 문자열"이라고만 적고 봉인 방식을 정하지 않았다. API 계약의 예시 커서는 base64 JSON(`{"s":[...],"f":"..."}`)이라 사용자가 정렬 키 값을 고쳐 **정상 커서처럼** 만들 수 있다. 강제 필터는 질의 시점에 다시 걸리므로 접근 통제가 깨지지는 않지만, 서버가 발급하지 않은 위치를 발급한 것처럼 신뢰하게 된다. 저장소에 재사용할 범용 signed-token primitive가 없다 — `ingest-gateway/signature.ts`는 웹훅 HMAC 전용이고 `@prs/authz`는 세션·PKCE·ID 토큰 전용이다 | WP-032 / FR-SRCH-008, ADR-010, THR-018 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — 봉투에 스키마 버전·PIT 식별자·정렬 키 값·지문·만료를 싣고 **HMAC-SHA256** 한 겹으로 무결성을 건다. 전용 서명 키를 쓰고 **새 범용 crypto 추상을 만들지 않는다** — 기존 서명 자리는 각자의 목적에 묶여 있어 재사용하면 한쪽의 키 회전이 다른 쪽을 끊는다. ADR-010 Amendment에 기록했다 |
| DEV-272 | 2026-08-26 | **지문의 입력이 정규화돼 있지 않고 `AccessScope`가 버전을 싣지 않는다.** ADR-010은 지문을 "질의 문자열·정렬·접근 범위의 해시"로 정했으나 정규화 규칙이 없다. 그리고 `AccessScopeResolver.resolve()`가 돌려주는 `AccessScope`에는 `version`이 없다 — `resolveCached()`가 주는 `CachedScope`에만 있다. 지문에 버전을 넣으려면 seam을 지나야 한다 | WP-032 / FR-SRCH-008 AC-3, FR-AUTH-003 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — 지문 = 정규화한 `q` + 정렬 키 + 정렬 방향 + **정렬한 유효 `AccessScope`** + `access_scope_version`. **권한이 회수되면 진행 중 페이징이 죽는 것이 옳다** — 이전 권한 집합 기준의 순서를 회수 뒤에 이어 쓰면 안 된다. auth seam을 작게 확장해 범위와 버전을 **한 번에** 얻는다(같은 요청에서 두 번 산출하지 않는다). **`size`와 패싯 요청 여부는 지문에 넣지 않는다** — 표현이지 결과 집합의 정체성이 아니다. 구현 감사에서 `search_after` 모양 때문에 `size` 변경이 정확성을 깬다는 것이 증명되면 그때 근거와 함께 넣는다 |
| DEV-273 | 2026-08-26 | **`cursor_invalid`와 `cursor_query_mismatch`의 경계가 없다.** SRS는 둘 다 정의하지만(AC-3 / 예외 처리) 어느 실패가 어느 코드인지가 어디에도 없다. 구현이 아무 쪽으로나 매핑해도 계약을 통과한다 | WP-032 / FR-SRCH-008 AC-3, QA-W001-15 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — `CURSOR_QUERY_MISMATCH`는 "커서는 유효한데 현재 `q`·정렬·접근 범위와 지문이 다르다", `CURSOR_INVALID`는 "디코딩·서명·스키마 버전·만료·PIT 부재·형식 오류"다. 둘 다 첫 페이지로 되돌리되 **같은 기술 원인인 척하지 않으며 자동 재시도 루프를 만들지 않는다**. QA-W001-15를 실제 네트워크 흐름으로 검증한다 |
| DEV-274 | 2026-08-26 | **점수 정렬에 Point In Time이 필요한데 계약에 없다.** ADR-010은 `search_after`가 "결과 크기와 무관하게 일정한 성능"을 준다고 적었고 그것은 참이지만 **살아 있는 인덱스 위에서 일관성을 주지는 않는다.** 새 문서가 색인되면 BM25의 term statistics가 바뀌어 같은 문서의 `_score`가 페이지 사이에서 달라지고, 항목이 중복되거나 누락된다. WP-032가 점수를 붙이는 순간 `relevance` 정렬이 그 상태가 된다 | WP-032 / FR-SRCH-008, FR-SRCH-011, ADR-010, THR-014 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — `relevance` 정렬은 첫 페이지에서 PIT을 열어 색인 뷰를 고정한다. keep-alive **5분**, 페이지마다 갱신, 마지막 페이지에서 best-effort close. 만료된 PIT은 `CURSOR_INVALID`이며 화면은 첫 페이지로 돌아간다. 다른 정렬 키는 값이 불변이거나 문서 자신의 필드라 이 문제가 없다. THR-014에 자원 상한을 함께 적었다 |
| DEV-275 | 2026-08-26 | **`buildSort('relevance', order)`가 `order` 인자를 무시한다.** `packages/es/src/sort.ts`가 `relevance`일 때 언제나 `[{ _score: { order: 'desc' } }, TIEBREAK]`를 돌려준다. `SORT_KEYS`에 `relevance`가 있고 라우트는 `order=asc`를 받아 넘긴다. 지금은 모든 문서의 점수가 같아 드러나지 않지만 WP-032가 점수 절을 붙이면 **사용자에게 보인다** | WP-032 / FR-SRCH-007 AC-1 | 구현 결함 | **CR-043** | **계약 확정 (2026-08-26), 구현은 WP-032** — `relevance`도 요청한 `order`를 존중한다. FR-SRCH-007 AC-1이 키와 방향을 함께 승인했고 `relevance`만 방향을 무시할 근거를 SRS가 주지 않는다. 지원하지 않기로 정하려면 그것은 SRS 변경이다 — 편의로 조용히 `desc`로 고정하지 않는다 |
| DEV-276 | 2026-08-26 | **QA-W001-16의 "건수 일치"를 그대로 구현할 수 없다.** `sum(bucket counts) == total`은 세 이유로 틀린 식이다 — ① 각 패싯이 상위 20만 반환하므로 나머지가 생략된다 ② `label`과 `allowed_team_ids`는 다중 값이라 한 문서가 여러 bucket에 들어간다 ③ `total`은 `track_total_hits` 상한(1만) 위에서 근사다. 검증 수단이 정의되지 않으면 시험이 이 AC를 걸 수 없다 | WP-032 / FR-SRCH-009 AC-3, QA-W001-16 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — 검증을 **bucket 단위**로 경화했다: 반환된 각 bucket `(field=value, count=N)`에 대해 목록과 동일한 질의·정렬·접근 범위에 그 bucket 필터만 더한 독립 조회의 건수가 `N`과 같아야 한다. 합계 비교를 쓰지 않는다 |
| DEV-277 | 2026-08-26 | **패싯 실패 상태가 응답 계약에 없다.** 현재 셋(키 없음 / `facets_omitted: true` / `false`)만 있고, FR-SRCH-009 예외 처리가 요구하는 "패싯 영역에 실패 상태를 표시한다"를 그릴 수단이 없다. 그대로 두면 **예산 초과 생략과 계산 실패가 같은 안내로** 그려진다 — 전자는 조건을 좁히면 풀리고 후자는 그렇지 않은데도 | WP-032 / FR-SRCH-009 예외 처리, C-012 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — `facets_status` 신설: `ready` / `budget_omitted` / `failed`. CR-019 DEV-076이 정한 "`facets`와 `facets_omitted`가 함께 나타나거나 함께 빠진다"를 유지하며 상태를 넷으로 늘렸다. C-012와 상태 매트릭스에 반영했다 |
| DEV-278 | 2026-08-26 | **백엔드 아키텍처가 요구사항이 금지하는 구조를 처방한다.** 성능 표의 `패싯 | 목록 요청과 동일 질의에 집계 첨부 | 왕복 1회`는 `hits`와 `aggs`를 한 요청에 넣는 구조인데, 그러면 집계 타임아웃이 응답 전체를 못 쓰게 만들어 "패싯 실패가 목록을 막지 않는다"(FR-SRCH-009 예외 처리)를 지킬 수 없다. 예산도 어긋난다 — 같은 문서의 실패 처리 표는 `집계 타임아웃 (5초)`인데 검색 의존 예산은 3초이고 AC-4는 "전체 응답 예산의 절반"이다 | WP-032 / FR-SRCH-009 AC-4·예외 처리, NFR-001 | 문서 간 모순 | **CR-043** | **resolved (2026-08-26)** — 패싯을 **별도 요청**으로 나누고 상한을 **1.5초**(검색 3초의 절반)로 고정했다. `집계 타임아웃 (5초)`는 통계 API(REL-005)의 시계열 집계이며 검색 패싯의 예산이 아니라는 것을 같은 표에 명시했다. 왕복 하나를 아끼는 것보다 실패 도메인을 가르는 것이 먼저다 |
| DEV-279 | 2026-08-26 | **패싯 self-filter 규칙이 없다.** 상거래 패싯의 관행은 자기 필드 필터만 제외하고 분포를 다시 계산하는 것(disjunctive facet)인데, SRS AC-3은 "목록 조회와 동일한 질의 조건"이다. 규칙이 적혀 있지 않으면 구현이 관행을 따라가 AC-3을 어긴다 | WP-032 / FR-SRCH-009 AC-3 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — **선택된 패싯 값도 계산 조건에 포함한다.** AC-3을 그대로 지킨다. disjunctive facet이 필요해지면 별도 요구사항과 CR을 연다 — 관행을 근거로 승인된 수용 기준을 벗어나지 않는다 |
| DEV-280 | 2026-08-26 | **두 번째 페이지 이후의 패싯 처분이 없다.** 매 페이지마다 같은 집계를 다시 계산하면 이어 보기의 비용이 첫 페이지와 같아지고, 반대로 아무 규칙도 없으면 구현이 임의로 정한다 | WP-032 / FR-SRCH-008, FR-SRCH-009, C-016 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — 첫 페이지만 `facets=true`, `CursorPager`의 이어 보기는 `facets=false`다. 같은 질의가 유지되는 동안 첫 페이지의 패싯 결과를 그대로 쓴다. `q`·필터·정렬이 바뀌면 커서와 패싯 상태를 **함께** 버린다 |
| DEV-281 | 2026-08-26 | **`team` 패싯의 필드와 표시값 해석 경로가 없고 접근 통제 축과 겹친다.** `team:` 질의 키는 `packages/es/src/query-builder.ts`에서 `allowed_team_ids` term 필터로 간다(CR-016, DEV-052). 패싯이 다른 필드를 세면 "패싯을 눌렀는데 건수가 다르다"가 된다. 그런데 `allowed_team_ids`는 **접근 통제 material 자체**이고, 문서는 팀 slug을 갖지 않아 표시값을 레지스트리에서 해석해야 한다 | WP-032 / FR-SRCH-009 AC-1, THR-003, FR-AUTH-002 AC-5 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — 패싯은 `allowed_team_ids`를 센다(질의 키와 같은 필드). 표시값은 레지스트리에서 **일괄 해석**한다(N+1 금지). 불변식 하나를 THR-003에 걸었다: **접근 범위 밖 저장소가 가진 팀은 bucket에도 count에도 나타나지 않는다.** 해석 대상은 이미 필터를 지난 bucket뿐이다 |
| DEV-282 | 2026-08-26 | **강조 구간이 raw HTML을 API 경계 밖으로 낸다.** API 계약의 응답 예시가 `"highlight": { "title": ["feat: <em>결제</em> 재시도 로직"] }`이다. Elasticsearch highlighter는 **원문을 이스케이프하지 않고** 태그만 끼워 넣으므로 PR 제목·본문이 마크업을 담고 있으면 그대로 실려 나간다. 화면이 그 문자열을 HTML로 그리면 THR-018의 완화 근거("PR 본문을 HTML로 렌더링하지 않음")가 무너진다 | WP-032 / FR-SRCH-011 AC-3·AC-5, THR-018, THR-020 | 범위 공백 | **CR-043** | **resolved (2026-08-26)** — 계약을 **평문 조각 + 일치 구간**(`{ text, matches: [{ start, end }] }`)으로 바꿨다. ES 내부에서 `pre_tags`·`post_tags`를 쓰는 것은 무방하되 **응답 밖으로 내보내지 않는다.** 화면은 React 텍스트와 `<mark>`로 조립한다. THR-020이 `evidence`에 대해 세운 것과 같은 규율이다 |
| DEV-283 | 2026-08-26 | **전문 검색 대상이 SRS의 "머지 커밋 메시지"보다 넓다.** `SEARCH_TARGET`은 `['prs-pull-requests', 'prs-commits']`이고(CR-016, DEV-054) 커밋 문서의 `role`은 `merge_commit`·`source_commit`·직접 푸시로 섞여 있다. 자유 텍스트를 `message`에 조건 없이 걸면 **원본 커밋 메시지까지** 검색 대상이 되어 FR-SRCH-011 AC-1이 정한 범위를 넘는다 | WP-032 / FR-SRCH-011 AC-1 | 문서 간 모순 | **CR-043** | **resolved (2026-08-26)** — 점수 절의 커밋 축을 **first-parent 체인의 커밋**(머지 커밋·직접 푸시 커밋)으로 한정한다. 그것이 "이 저장소의 머지 순서에 실제로 나타난 메시지"이며 AC-1의 뜻이다. **구조화 필터의 대상 인덱스는 바뀌지 않는다** — 조용히 넓히지도 좁히지도 않는다 |
| DEV-284 | 2026-08-26 | **`QUERY_TOO_SHORT`가 코드 포인트가 아니라 UTF-16 코드 단위를 센다.** `packages/query/src/parse.ts`가 `text.length < MIN_TEXT_LENGTH`로 판정하는데 JS의 `String.length`는 UTF-16 단위다. 실측: `'가'`는 1로 거절되지만 `'𠮷'`(U+20BB7)과 이모지는 `.length === 2`라 **한 글자인데 통과한다** | WP-032 / FR-SRCH-011 예외 처리 | 구현 결함 | **CR-043** | **계약 확정 (2026-08-26), 구현은 WP-032** — trim 뒤 **코드 포인트** 수로 센다. 구조화 필터만 있고 자유 텍스트가 없으면 이 규칙을 적용하지 않는다(기존 동작 유지) |
| DEV-285 | 2026-08-26 | **`W-001-FACETS`가 SRS보다 넓다 — 반대 방향의 같은 모양.** 와이어프레임이 "저장소·작성자·팀·라벨·대상 브랜치·상태·**기간·시퀀스** 패싯"으로 **여덟**을 적는데 FR-SRCH-009 AC-1은 **여섯**만 정한다. 기간·시퀀스는 연속 값이라 "상위 20개 값과 건수"(AC-2)라는 패싯의 형태 자체가 성립하지 않는다 | WP-032 / FR-SRCH-009 AC-1·AC-2, W-001 | 문서 간 모순 | **CR-043** | **resolved (2026-08-26)** — **이번엔 SRS를 넓히지 않고 하위 문서를 좁혔다.** DEV-268(W-004 패싯)과 판단이 갈린 이유를 적어 둔다: W-004 패싯은 PRD의 SCN-002가 이미 서술했고 그것 없이는 핵심 사용이 성립하지 않았으나, 기간·시퀀스 패싯은 **어느 상위 문서도 요구한 적이 없고** 상위 20 분포라는 형태가 연속 값에 맞지 않는다. 기능이 사라지는 것도 아니다 — 기간·시퀀스는 `merged:`·`seq:` **질의 키로 이미 필터할 수 있다**. 패싯 레일에 없을 뿐이며, 필요해지면 그때 "범위 패싯"이라는 다른 형태를 별도 요구사항으로 연다 |

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

### 6.18 WP-018 검증 실행 기록

DoD 4항 중 3항 통과, 1항 부분. 검증 방법은 `pnpm test web/commit`, `pnpm test:e2e flow-002`, `pnpm test:a11y commit`이다.

| DoD | 결과 | 근거 |
| --- | --- | --- |
| QA-W003-01·02·04~08 | 통과 | 01·02(역할 배지가 머지/원본을 **글자로** 가른다), 04(AC-4의 PR 필드 전량 — 번호·제목·작성자·리뷰어·머지 시각), 05(같은 SHA가 PR 둘에 속하면 **둘 다** 보이고 그 사실을 배지로도 알린다), 06(**체인 밖을 오류가 아니라 사실로** 그리고 머지 커밋 링크를 준다), 07(**실제 브라우저에서 클립보드를 읽어** 40자임을 확인했다 — 표시값은 12자다), 08(파일 내용을 표시하지 않는다 — C-025는 **담을 prop 자체가 없다**) |
| **QA-W003-03은 절반만** (CR-021, DEV-093) | 통과 (절반) | "PR이 없을 때 사유를 표시한다"는 통과. **다만 화면은 그것을 "직접 푸시"라고 부르지 않는다** — 서버의 `reason_code: 'no_pull_request'`는 "투영이 아직 PR 번호를 잇지 못했다"이고, 그것을 직접 푸시라고 쓰면 **PR 리뷰를 거치지 않고 들어간 커밋**이라는 거짓이 된다. `role: 'direct_push'` 갈래는 매핑을 갖추고 합성 입력으로 걸었으나 **WP-021 전까지 서버가 그 값을 내지 않는다**(DEV-061) |
| 상태 매트릭스 W-003의 전 상태가 렌더링된다 | 통과 | `loading_initial`·`ready`·`enrichment_pending`·`multi_pr`·`no_pr`(두 갈래)·`no_sequence`·`not_found`·`no_permission`·`auth_expired`·`offline`. **`no_pr`의 `direct_push` 갈래만 실제 서버로는 도달하지 않는다** |
| FLOW-002 전 경로(SHA 입력 → 커밋 상세 → PR 상세)가 E2E로 통과한다 | 통과 | **실제 브라우저에서 셋이 이어진다.** 40자 SHA 제출 → (자동 이동) 커밋 상세 → 소속 PR 클릭 → PR 상세. 뒤로가기 두 번으로 원래 입력이 살아 돌아온다. **이 항목을 쓰다가 DEV-097을 찾았다** |
| axe 위반 0건 | 통과 | DoD 상태와 `multi_pr`·`off_chain`·경로 목록·보관 배너 각각에 axe(wcag2a/2aa/21a/21aa)를 돌려 **위반 0건**. `checkContrast`는 80쌍 중 실패 0건 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | 종료 코드 0 |
| `pnpm test` (전량) | 종료 코드 0 — **922건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm test:a11y` | 종료 코드 0 — **133건**, axe 위반 0건 |
| `pnpm test:e2e` | 종료 코드 0 — **53건** (실제 Chromium) |
| `pnpm test:contrast` | 종료 코드 0 — 80쌍 중 실패 0건 |
| `pnpm build` | 종료 코드 0 — `/commit/[owner]/[repo]/[sha]` 라우트가 선다 |
| `pnpm test:integration` | **로컬 NOT RUN** (Docker 없음) — **CI에서 통과했다**: 29개 파일 **380건**, 실패 0건. 직전 실행이 378건이었으므로 DEV-091이 더한 2건이 정확히 실행되어 통과한 것이 수치로 확인된다 |

**DoD를 쓰다가 운영 중인 결함을 찾았다 (DEV-097).**

"FLOW-002 전 경로가 E2E로 통과한다"를 쓰려면 첫 단계가 FLOW-001이다. 40자 SHA를 제출하는 시험을 쓰자 **화면이 응답하지 않았다.** 파 보니 **FLOW-001 4단계("후보가 1건이면 해당 상세 화면으로 이동한다")가 구현되어 있지 않았다** — CR-019 DEV-078이 그 이동을 위해 `from_q`까지 정해 두었는데 이동 자체가 없었다. `resolveScreenState`가 후보 2건 이상만 다루고 1건은 통과시키는데, 해석 응답에는 `items`가 없어 `itemCount === null`이 되고 화면이 `loading_initial`로 떨어진다.

**40자 SHA 붙여넣기는 이 제품에서 가장 흔한 입력이고, 흐름 명세가 FLOW-001을 "가장 중요한 흐름"이라고 부른다.** 그것이 화면을 정지시키고 있었다. 추측으로 고치지 않고 먼저 재현했다 — 목 라우터로 `SearchView`를 세워 상태가 `loading_initial`이고 `router.push` 호출이 0건임을 확인한 뒤에 손댔다.

고치는 과정에서 **두 번 더 틀렸고 시험이 두 번 다 잡았다.**

| 시도 | 무엇이 잘못됐나 | 잡은 것 |
| --- | --- | --- |
| 해석 결과에만 이동을 건다 | **뒤로가기가 막힌다.** `/search?q=<SHA>`로 돌아오는 순간 다시 후보 1건이 나와 곧바로 상세로 튕겨 나가고, 사용자가 검색 화면에 영영 닿지 못한다 | e2e (뒤로가기 뒤 검색창을 찾지 못함) |
| 제출 여부를 불리언 `ref`로 매단다 | **같은 질의를 다시 제출하면 아무 일도 안 일어난다.** URL이 그대로라 해석이 다시 돌지 않고 효과의 의존값도 그대로다. Enter를 눌렀는데 화면이 가만히 있는 것은 고장으로 읽힌다 | a11y (제출 뒤에도 `push` 0건) |

최종 형태는 **제출을 세어서** 매단다. 이동은 제출에 대한 응답이고, 뒤로가기·붙여넣은 링크로 같은 URL에 도착한 경우에는 후보 카드를 보이고 사용자가 고르게 한다 — **놀라게 하지 않는다.** 이동 중에도 카드를 남겨 이동이 막히면 손으로 누를 수 있다.

**WP-017이 넘긴 일을 했다 — 세션 관문 통합.**

라우트 셋이 같은 다섯 줄(쿠키 읽기·세션 적재·`redirect`)을 각자 갖고 있었고, WP-017은 묶는 대신 정적 검사로 **빠뜨릴 수 없게** 만들고 네 번째 화면과 함께 묶기로 미뤘다. 그 네 번째가 W-003이다. `GuardedPage` 하나가 관문을 소유하고 라우트 넷이 모두 그것을 지난다. 정적 검사도 함께 바꿨다 — 이제 "다섯 줄이 있는가"가 아니라 **"관문을 지나는가, 세션을 직접 만지지 않는가"**를 본다.

같은 이유로 **상태 판정도 합쳤다.** 상태 매트릭스가 W-002·W-003 양쪽에서 `not_found`/`no_permission`/`auth_expired`/`offline`을 "공통"이라고 적는데, 복제하면 한쪽만 고쳐지고 **그 한쪽이 404를 403처럼 다루는 쪽이면 존재 여부가 샌다.** `lib/screen-state.ts` 하나가 소유한다.

`?from_q=` 부착도 세 군데(결과 행·후보 카드·자동 이동)에 있어 `withFromQuery` 하나로 묶었다 — 한 곳만 인코딩을 빠뜨려도 되살아난 질의가 원본과 달라진다.

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 47가지로 망가뜨렸다 — 판정 15종, 컴포넌트·자동 이동 24종, 라우트·관문 8종.

**첫 통과에서 41가지가 잡혔고 6가지가 살아남았다. 하나는 내가 잘못 만든 변이였고, 나머지 다섯은 진짜 시험 구멍이었다. 다섯을 메운 뒤 다시 돌려 47/47이 잡혔다.**

| 생존 | 판정 | 조치 |
| --- | --- | --- |
| 로딩 중에도 이동한다 | **내 변이가 틀렸다** — 삽입한 줄이 앞선 `loading` 관문 뒤라 도달하지 않는다. 동치가 아니라 **죽은 코드**를 넣은 것이다 | 관문 **앞**으로 옮긴 변이로 다시 걸었고 잡혔다 |
| `aria-live`를 뺀다 | `role="status"`가 암시 `aria-live="polite"`를 갖고 있어 실제 낭독은 같지만, **C-024가 명시적으로 요구하는 속성**이다 | 라이브 리전 계약을 속성으로 건다 |
| 수집 전인데 "파일 0개" / 절삭인데 상위 N건을 숨김 / 총계를 목록 길이로 | `pathCountLabel`이 **컴포넌트 파일에 있어 단위 시험이 닿지 않았다.** 화면 경로로는 그 분기에 이르지 못한다 | **판정 모듈로 옮겼다** — 이것은 그리기가 아니라 주장이다. 다섯 경우를 각각 건다 |
| 제출 횟수를 소비하지 않는다 | 실제 브라우저에서는 곧 언마운트되어 가려지지만 **가려진 결함은 결함이다** — 이동이 막히거나 화면이 남는 순간 되풀이 이동이 된다 | 마운트를 유지한 채 재렌더해 이동이 한 번뿐임을 건다 |
| `from_q`를 화면으로 넘기지 않는다 | 라우트→화면 배선에 시험이 없었다. a11y는 prop을 직접 넘겨 그 구간을 건너뛴다 | 딥링크에 `from_q`를 실어 되돌아가기 링크와 실제 이동까지 e2e로 건다 |

**시험이 확인하지 못한 것.** `QA-W003-03`의 나머지 절반(`role: 'direct_push'`)은 **서버가 그 값을 낼 수 없어** 합성 입력으로만 걸었다 — 통과로 적지 않는다. `W-003-SEQPOS`의 앞뒤 인접 커밋(WP-027), 포함 릴리스(WP-024), 관계(WP-031)는 골격만 세웠다. `pnpm test:integration`은 이 환경에 Docker가 없어 **로컬에서 NOT RUN**이었고, DEV-091이 더한 `merge_commit_sha`의 통합 시험 2건은 **CI가 처음 돌려 통과했다**(378 → 380건).

### 6.19 WP-019 검증 실행 기록

**DoD 6항 중 4항이 통과, 1항이 부분, 1항이 NOT RUN이다.** 판정 근거는 CI run 55(`24c1fdb`) 통합 **32파일 419건 전부 통과**와, AC-6에 한해 이 환경의 네이티브 PostgreSQL 16.13 실측이다.

**CI가 세 번 판정했다. 두 번 실패하고 세 번째에 통과했다** (PR #21, `b0acc8d` → `e5e139e` → `24c1fdb`). 결함 **넷**이 나왔고 그중 **둘이 코드 결함**이다 — 하나는 이 WP의 핵심 수용 기준(AC-6)이 실제로는 전혀 성립하지 않고 있었다는 것이다.

| DoD | 결과 | 근거 |
| --- | --- | --- |
| QA-A003-05, QA-A003-06이 통과한다 | **부분** | **QA-A003-06(재개)은 CI 통과** — 1페이지 처리 중 중단이 걸리면 2페이지를 시작하지 않고 커서가 `page: 2`를 가리키며, 그 커서로 claim하면 3페이지부터 읽는다. **QA-A003-05(우선순위)는 구조로만 세웠다**: 모든 백필 호출이 `priority: 'backfill'`이고 `RequestScheduler`가 실시간을 먼저 비운다. 실제 지연 영향은 운영 규모 부하가 있어야 재므로 **측정하지 않았다** |
| 백필 실행 중 실시간 수집 지연 p95 10초 유지 (AC-3) | **NOT RUN** | 운영 규모 데이터셋도 부하 harness도 이 환경에 없다 (DEV-058과 같은 형태). 예산을 지키는 **구조**만 세웠다 — 우선순위 분리와 워커 풀 분리 |
| 중단 후 재개 시 마지막 커서부터 이어진다 (AC-4) | **통과** (CI) | 커서가 `{page, done}`이고 **페이지를 다 처리한 뒤에만** 전진한다. 망가진 커서는 처음부터 — 중간을 추측하면 그 사이 PR이 영영 색인되지 않는다 |
| 백필 문서가 더 새로운 실시간 문서를 덮어쓰지 않는다 (AC-5) | **통과** (CI) | **분기가 아니라 수의 대소로 성립한다.** 백필의 버전이 엔티티 `updated_at`이고 웹훅 수신은 언제나 그 뒤이므로, 이미 있는 조건부 업서트가 저절로 거절한다. **처음 시험은 이것을 검증하지 못하는 거짓 통과였다** — 아래 참조 |
| 동시 실행 4개 요청 시 3개만 실행된다 (AC-6) | **통과** (CI + 로컬 실측 — `packages/db/integration/job-claim.test.ts` 6건, 실제 PostgreSQL 16.13) | **처음 구현은 이것을 전혀 지키지 못했다** — 상한 3에 다섯이 돌았다(DEV-107). 세기 전에 유형 단위 advisory lock을 잡아야 성립한다. `FOR UPDATE SKIP LOCKED`는 같은 행의 중복 claim만 막는다 |
| API 한도 소진 시 대기하고 회복 시각에 자동 재개 | **통과** (CI) | 잡을 **실패시키지 않고** 기다린다. 상태는 `running`을 유지하고 사유만 `progress.waiting_until`에 남긴다 — `paused`로 바꾸면 자동 재개가 운영자의 중단까지 되살린다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | 종료 코드 0 |
| `pnpm test` (전량) | 종료 코드 0 — **953건 통과 + 1건 건너뜀**(real-GHE smoke). 백필 판정 22건과 재시도 사다리 9건이 그중 새것이다 |
| `pnpm test:integration` (ES 비의존 19파일) | 종료 코드 0 — **181건 통과.** 네이티브 PostgreSQL 16.13 + `redis-server`에 붙였다. `job-claim.test.ts` 6건이 그중 새것이다 |
| `pnpm test:integration` (ES 의존 12파일) | **로컬 NOT RUN** — Elasticsearch만 이 환경에 없다. 백필 잡 시험 14건이 여기 걸려 CI가 판정했다 |
| CI 통합 (run 55, `24c1fdb`) | **32파일 419건 전부 통과.** 최초 판정(run 53)의 31파일 412건과 견주면 정확히 +1파일 +7건이다 — `job-claim` 6건과 백필의 DEV-106 1건이 **실제로 돌았음**이 그 차이로 확인된다 |

**AC-5를 코드가 아니라 산술로 세웠다.**

백필에 "실시간을 덮어쓰지 않기" 분기를 따로 두지 않았다. 백필 문서의 버전을 **엔티티의 `updated_at`**으로 두면, 웹훅 수신 시각은 언제나 그 갱신보다 뒤이므로 같은 사실에 대해 실시간이 **항상** 이긴다 — 이미 있는 조건부 업서트가 낮은 버전을 거절한다. 분기를 두면 그 분기가 틀렸을 때 조용히 덮어쓰고, 덮어쓴 사실은 아무도 눈치채지 못한다.

**정렬을 고정한 것이 이 WP에서 가장 조용한 결정이다 (DEV-098).**

`listPullRequestsPage`는 정렬을 인자로 열어 두지 않고 `updated asc`로 못박는다. GitHub 기본값 `created desc`로 두면 **백필 도중 새 PR이 생길 때마다 목록 앞이 밀려** 아직 읽지 않은 항목이 뒤 페이지로 넘어가고 그대로 건너뛰어진다. `updated asc`에서는 갱신된 PR이 목록 끝으로 가므로 **이미 처리한 것이 다시 걸릴 수는 있어도 아직 처리하지 않은 것이 사라지지 않는다.** 재처리는 버전 비교가 흡수하지만, 건너뛴 PR은 검색에서 영영 빠진 채 아무도 모른다.

**변이 시험은 판정 계층까지만 돌렸다.** 15종 중 14종이 첫 통과에서 잡혔고 1종이 살아남았다.

| 생존 | 판정 | 조치 |
| --- | --- | --- |
| 빈 문자열 검사 제거 | **동치 변이 — 죽은 검사였다.** `Date.parse('')`가 이미 `NaN`을 준다(실측 확인: `''`·`'   '`·`'not-a-date'` 모두 `NaN`). 검사가 결과를 **바꾸지 못한다** | **지웠다.** 결과를 바꾸지 못하는 줄은 읽는 사람에게 "여기에 무언가 있다"고 거짓말을 한다 (WP-016에서 도달 불가능한 지름길을 지운 것과 같은 판단) |

**워커 루프와 API는 변이 시험을 돌리지 못했다.** 그 계층의 시험이 전부 통합 시험이고 로컬에서 실행되지 않기 때문이다 — **변이를 넣어도 잡히는지 알 수 없으므로 돌리지 않았다.** 통과했다고 적을 수 없는 것을 돌린 척하지 않는다.

#### CI가 처음 돌린 결과 (2026-08-22)

통합 시험 411건 중 2건이 실패했다. **셋 다 서로 다른 결함이었고, 그중 하나는 코드 결함이다.**

| 실패 | 실제 원인 | 조치 |
| --- | --- | --- |
| `실시간이 없으면 백필이 색인한다` — `es.get`이 404 | **시험 결함.** `prs-pull-requests`는 6샤드이고 투영은 `repository_id`로 라우팅한다. 라우팅 없이 `_id`로 읽으면 **다른 샤드를 본다.** 저장소의 다른 통합 시험은 전부 `routing`을 넘기고 있었다 — 이 파일만 빠뜨렸다 | 읽기에 `routing`을 넘긴다 |
| `갱신 시각을 읽을 수 없는 PR만 건너뛴다` — `expected 3 to be 2` | **시험 격리 결함.** `delete_by_query`는 검색으로 대상을 찾으므로 **아직 refresh되지 않은 문서를 못 본다.** `refresh: true`는 지운 *뒤에* 새로 고치는 옵션이라 이것을 풀지 않는다. 앞 시험(한도 대기)이 36ms 전에 색인한 PR 하나가 살아남아 집계에 섞였다 | `beforeEach`에서 **지우기 전에** refresh한다 |
| (시험이 잡지 못한 것) | **코드 결함 DEV-106.** `bulkUpsert`의 항목 실패를 백필이 읽지 않아 색인되지 않은 PR을 성공으로 셌다 | 실시간과 같은 재시도 사다리를 쓰고, 끝내 실패한 항목이 있으면 그 PR을 실패로 센다 |
| 2차: `동시에 잡아도 상한을 넘지 않는다` — `expected ... length of 3 but got 5` | **코드 결함 DEV-107.** 동시 실행 상한이 **하나도 강제되지 않고 있었다.** 1차에서는 우연히 통과했다 | 세기 **전에** 유형 단위 advisory lock을 잡는다 |

**AC-5 시험은 통과하고 있었지만 아무것도 검증하지 못하고 있었다.**

가장 무거운 발견이다. `**더 새로운 실시간 문서를 백필이 이기지 못한다**`는 "실시간이 쓴 문서"를 **라우팅 없이** 넣었다. 그러면 그 문서는 `_id` 해시 샤드에 앉고 백필의 업서트는 라우팅 샤드로 가서, 같은 `_id`를 가진 문서 **둘**이 서로 다른 샤드에 생긴다. 조건부 업서트가 무엇을 하든 — 아예 없었어도 — 이 시험은 통과했다. 초록이 곧 검증은 아니라는 것을 이 한 줄이 보여 준다. 씨앗 문서도 투영과 같은 `_routing`으로 넣도록 고쳤다.

**AC-6은 통과한 적이 있을 뿐 성립한 적이 없었다.**

1차 CI에서 `동시에 잡아도 상한을 넘지 않는다`는 **통과했다.** 2차에서 실패했다. 다시 돌려 "flake"로 넘길 자리였지만, 단언이 무너뜨린 것이 이 WP의 수용 기준 자체라 그러지 않았다. **이 환경에 네이티브 PostgreSQL 16.13이 있다**(DEV-006이 WP-002에서 쓴 그것이다). 거기에 붙여 5회 반복하는 프로브를 돌렸다:

```
수정 전: round 0: claimed=4 | round 1..4: claimed=5   (상한 3)
수정 후: round 0..4: claimed=3
```

**상한은 새어 나간 것이 아니라 처음부터 없었다.** DEV-102에 "한 트랜잭션에 넣으면 된다"고 적은 것이 틀렸다 — READ COMMITTED에서 각 문장은 커밋된 것만 보므로, 동시에 시작한 다섯은 모두 `running = 0`을 읽는다. `FOR UPDATE SKIP LOCKED`는 **같은 행**을 둘이 잡는 것만 막지 세기를 직렬화하지 않는다. DEV-102의 문장을 그대로 두지 않고 원장에서 정정했다.

**로컬에서 통합 시험을 못 돌린다고 적은 것이 절반만 맞았다.**

없는 것은 **Elasticsearch뿐**이다. PostgreSQL 16.13과 `redis-server`는 이 환경에 네이티브로 있고, 그 둘만 쓰는 통합 시험 **19파일 181건이 로컬에서 전부 통과한다.** WP-019를 처음 낼 때 이것을 확인하지 않아 AC-6 결함이 CI까지 갔다. 상한은 PostgreSQL만의 성질이므로, 회귀 시험을 **ES를 요구하지 않는** `packages/db/integration/job-claim.test.ts`에 따로 두었다 — 6건 중 2건이 수정 전에 실패하고 수정 후 전부 통과하는 것을 양방향으로 확인했다.

**DEV-106을 잡는 시험은 응답을 조작하지 않는다.** `source_patch`를 벌크에 주입해 **클러스터가 실제로 `strict_dynamic_mapping_exception`을 내게** 한다(WP-008이 THR-010을 시험한 방식과 같다). 응답만 조작하면 문서는 색인된 채로 남아 "세는 방법"만 시험하게 되고, 정작 확인해야 할 것 — 색인되지 않은 PR을 색인했다고 세는가 — 을 못 본다.

**새로 뽑은 재시도 사다리는 변이 시험을 돌렸다.** `index-retry.ts`는 클러스터 없이 판정되므로 이 WP에서 유일하게 변이로 검증할 수 있었던 신규 코드다. 7종 중 4종이 첫 통과에서 잡혔고 3종이 살아남았다 — **둘은 진짜 구멍이었다.**

| 생존 | 판정 | 조치 |
| --- | --- | --- |
| `rejected`도 재시도한다 | **진짜 구멍.** `rejected`만 있는 시험은 지름길이 먼저 돌아가 **재시도 루프에 들어가지도 않는다** — 루프가 무엇을 하든 통과했다 | `rejected`와 `retryable`이 **섞인** 벌크 시험을 더했다. 이제 잡힌다 |
| 재시도 예산 2 → 1 | **진짜 구멍.** 기대값을 `MAX_ITEM_RETRIES`와 견주고 있어 **상수를 바꾸면 기대값도 따라 바뀌었다.** 예산을 0으로 만들어도 통과한다 | 횟수를 리터럴로 적었다(`['a', 'a']`). 예산은 고른 값이지 파생값이 아니다 |
| 성공만 있을 때의 지름길 제거 | **동치 변이.** 지름길이 없어도 `pending`이 빈 배열이라 루프가 곧바로 `break`한다 — 결과는 같고 배열 복사 한 번만 늘어난다 | **남긴다.** 앞의 `Date.parse('')`와 다르다: 그것은 참이 될 수 없는 검사였고, 이것은 **실시간 경로에서 거의 항상 참인** 빠른 경로다. 결과가 아니라 비용을 바꾼다 |

**WP-007의 코드를 하나 건드렸다.** PR 응답 → `EnrichedPullRequest` 매핑을 `enriched-payload.ts`로 뽑아 실시간과 백필이 공유하게 했다. 각자 옮기면 언젠가 어긋나고, 그때 **백필로 들어온 PR만 어떤 필드가 비는** 상태가 된다 — 검색 결과에서 그것은 "그런 PR은 없다"로 읽힌다. WP-007의 시험 73건이 그대로 통과함을 확인했다.

### 6.20 WP-020 검증 실행 기록

**DoD 5항 전부 통과했고, 전부 로컬에서 판정했다.** 이 WP의 시험은 실제 git만 요구하고 Elasticsearch를 요구하지 않는다 — WP-019가 남긴 교훈("착수할 때 ES 비의존 통합 시험부터 돌린다")을 처음 적용한 WP다.

| DoD | 결과 | 근거 |
| --- | --- | --- |
| `firstParentRevList`가 `git rev-list --first-parent --reverse`와 같다 | **통과** | 병합 커밋·직접 푸시가 섞인 실제 픽스처에서 전 구간·부분 구간 모두 일치. **선형 히스토리로만 시험하지 않았다** — 그러면 두 번째 부모를 따라가는 구현도 통과한다 |
| `ApiCommitGraph`가 같은 픽스처에서 같은 체인을 만든다 (ADR-005) | **통과** | 폴백 클라이언트의 답을 **실제 git이 낸 값**으로 채워 비교했다. 조상 판정도 두 경로가 일치한다 |
| blobless 클론에 파일 blob이 없다 (THR-015) | **통과** | 커밋·트리 > 0, **blob = 0**. 그래프 연산 셋을 돌린 뒤에도 0이다 |
| 미러 미사용 저장소에서 `patchId`가 null이고 사유가 표시된다 (FR-REL-005 AC-5) | **통과** | `no_mirror`. 그리고 **미러가 있어도 `blob_fetch_disabled`가 나온다** — 아래 참조 |
| 미러 fetch 실패 시 API 폴백으로 전환된다 | **통과** | `FallbackCommitGraph`. 폴백은 콜백으로 알린다 — 조용히 넘어가면 미러가 죽은 것을 아무도 모른다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | 종료 코드 0 |
| `pnpm test` (전량) | 종료 코드 0 — **989건 통과 + 1건 건너뜀**. 그래프 판정 36건이 새것이다 |
| `pnpm test:integration` (ES 비의존 20파일) | 종료 코드 0 — **205건 통과.** 그래프 24건이 새것이다 |
| `pnpm test:integration` (ES 의존 12파일) | **로컬 NOT RUN** — 이 WP가 건드리지 않은 영역이고 CI가 판정한다 |

**ADR-005의 이점 하나가 실측에서 다른 대가를 요구했다 (DEV-111).**

ADR-005는 "미러면 patch-id 체리픽 탐지가 가능하다"를 Positive로 적는다. 그런데 `git patch-id`는 diff를 요구하고 diff는 blob을 요구하는데, blobless 클론에는 blob이 없다. 실측:

```
blobless 미러:            commit 3, tree 3, blob 0
diff-tree -p 한 번 뒤:     commit 3, tree 3, blob 2   ← promisor 원격에서 지연 인출
GIT_NO_LAZY_FETCH=1:      fatal: could not fetch ... from promisor remote (blob 0 유지)
```

즉 patch-id를 쓰는 순간 **THR-015가 근거로 삼은 "blobless라 파일 내용이 없음"이 성립하지 않는다.** 인프라 5장의 용량 산정(blob 제외 50MB)도 시간이 지나며 어긋난다.

**요구사항을 먼저 지켰다.** THR-015와 용량 산정은 명세이고 patch-id 이점은 ADR의 `Positive` 항목이며, FR-REL-005 AC-5가 이미 `patch_id_unavailable` 경로를 정의한다. 그래서 지연 인출을 **기본으로 막고**(`GIT_NO_LAZY_FETCH=1`) 사유를 붙여 `null`을 돌려준다. 켜는 스위치(`MIRROR_ALLOW_BLOB_FETCH`)는 두되 기본은 꺼짐이고, 켜져 있으면 기동 로그가 경고한다. **어느 쪽을 운영 기본으로 둘지는 사용자 결정으로 남긴다.**

시험이 그 대가를 직접 보여 준다 — 스위치를 켠 별도 미러에서 patch-id가 나오고, 같은 볼륨에 blob이 생긴 것을 함께 단언한다.

**시험이 구현 결함 하나를 잡았다.**

`resolveHead`가 처음에는 0이 아닌 종료 코드를 전부 `null`로 읽었다. 그러면 **미러가 통째로 사라진 저장소가 "아직 브랜치가 없는 저장소"로 읽힌다** — 채번이 조용히 아무 일도 하지 않고, 시퀀스 공간은 `stale`로 표시되지도 않으며(FR-SEQ-001 예외 처리), 폴백도 발동하지 않는다. 실패한 적이 없기 때문이다. git의 종료 코드를 실측해(없는 ref는 1, 없는 저장소는 128) 둘을 갈랐다.

**변이 시험 12종을 돌렸고 전부 잡혔다.**

| 변이 | 결과 |
| --- | --- |
| blob 지연 인출 기본을 허용으로 뒤집기 | 잡힘 |
| 토큰을 base64 없이 평문으로 넣기 | 잡힘 |
| 구간 끝의 SHA 검사 제거 | 잡힘 |
| 브랜치 이름 앞의 `-` 허용 | 잡힘 |
| `is-ancestor`의 예상 밖 코드를 "조상 아님"으로 읽기 | 잡힘 |
| first-parent 대신 마지막 부모 따라가기 | 잡힘 |
| 끊긴 체인에서 조용히 멈추기 | 잡힘 |
| 구간 시작이 체인에 없어도 통과시키기 | 잡힘 |
| `--reverse` 상실 | 잡힘 |
| 디스크 총량 0을 사용률 0으로 답하기 | 잡힘 |
| patch-id 모양 검사 제거 | 잡힘 |
| 터미널 프롬프트 차단 제거 | 잡힘 |

**워커 루프(`mirror-runner.ts`)는 변이를 돌리지 못했다** — 그 계층에 시험을 붙이지 않았다. 미러 동기화 자체(clone·fetch·prune·실패)는 통합 시험이 걸지만, 6시간 스윕 루프와 지표 보고는 걸지 않았다. 돌린 척하지 않는다.

### 6.21 WP-021 검증 실행 기록

**실행 일시**: 2026-08-23 · **커밋**: `60c0aa1` / PR #25

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 1. 채번이 `git rev-list --first-parent --reverse`와 일치 (AC-2) | **통과** | `assign.test.ts` — 정답을 우리 구현이 아니라 origin 저장소의 git이 낸다 |
| 2. 공간별 독립, 루트가 1 (AC-1) | **통과** | 같은 저장소의 두 브랜치가 서로를 막지 않는 것까지 확인 |
| 3. 직접 푸시가 서수를 받고 PR 연결이 null (AC-3) | **통과** | **머지 커밋과 같은 히스토리에서 대조한다** — 아래 참조 |
| 4. 두 번 실행해도 값이 변하지 않는다 (AC-4) | **통과** | 재실행 결과가 전량 동일. 아는 PR 번호가 지워지지 않는 것도 별도 확인 |
| 5. 증분 채번이 저장된 head 이후만 (AC-5) | **통과** | 나눠 채번한 결과가 한 번에 채번한 것과 같다 |
| 6. 공간당 동시 1개 (AC-6) | **통과** | 실제 PostgreSQL에서 동시 5건 — 중복도 구멍도 없다 |
| 7. 그래프 실패 시 `stale`, 기존 값 보존 | **통과** | **첫 시도 실패 포함** (DEV-122가 여기서 나왔다) |
| 8. 회귀 픽스처 검증 | **통과** | `pnpm test:regression` 5건 |

| 시험 계층 | 건수 | 환경 |
| --- | --- | --- |
| 단위 | 전체 **1025**건 (989 → 1025) | 로컬 |
| 통합 (ES 비의존) | **21파일 235건** (19파일 181건 → ) | 로컬 PostgreSQL 16.13 + 실제 git 픽스처 |
| 회귀 | **5**건 | 로컬 (git만 필요) |
| ES 통합 | 10건 | **CI가 처음 판정한다** — 이 환경에 Elasticsearch가 없다 |
| `pnpm typecheck` / `pnpm lint` | 통과 | 로컬 |

**통합 시험이 Elasticsearch를 요구하지 않는다.** 시퀀스는 PostgreSQL이 정본이고 색인은 그것을 비친 것이므로(ADR-004), 정본이 맞는지는 PostgreSQL과 git만으로 판정할 수 있어야 한다. WP-019에서 ES를 요구하는 파일에 PostgreSQL만의 불변식을 넣었다가 로컬에서 못 돌린 채 결함이 CI로 나갔다 — 그 교훈을 이번에 적용했다.

**AC-3이 거짓 통과하기 쉬운 자리였다.** 직접 푸시 커밋만 있는 픽스처로 "`pull_request_number`가 null이다"를 확인하면, **PR 조회를 아예 하지 않는 구현도 통과한다** — PR 문서가 애초에 없으니 무엇을 해도 null이 나온다. 그래서 픽스처가 머지 커밋(PR #42)과 직접 푸시 셋을 **같은 히스토리에** 담고, 대역이 머지 커밋 하나에만 PR 번호를 준다. 둘을 가르는 것이 그 대역의 존재 이유다.

#### 변이 시험 (9종, 생존 0)

| 변이 | 결과 |
| --- | --- |
| 서수 오프셋 `+index+1` → `+index` (루트가 0이 된다) | 잡힘 |
| 커밋 시각으로 재정렬 (git 순서를 버린다) | 잡힘 |
| 브랜치 판정을 정확 일치 → 접두 일치 | 잡힘 |
| push의 `deleted` 플래그 무시 | 잡힘 |
| 40자 0 SHA 검사 제거 (없는 커밋을 채번한다) | 잡힘 |
| 태그 ref를 브랜치로 받는다 | 잡힘 |
| `after`의 SHA 모양 검사 제거 | 잡힘 |
| 시각 없는 줄을 던지지 않고 버린다 (서수가 하나씩 밀린다) | 잡힘 |
| 시각의 오프셋 검사 제거 | 잡힘 |

마지막 항목은 처음에 **생존으로 보였다.** `sed` 이스케이프가 조용히 실패해 변이가 아예 적용되지 않았던 것이고, python으로 제대로 적용하니 시험이 잡았다. **생존자를 등가 변이로 단정하지 않고 적용 여부부터 확인한 것이 그 차이를 만들었다.**

#### 구현 중 스스로 잡은 결함 둘

**DEV-122 — 첫 채번 실패가 아무 신호도 남기지 않았다.** `markStale`이 `UPDATE`라서, 첫 시도에서 그래프를 읽지 못하면 공간을 만든 트랜잭션이 롤백되어 갱신할 행이 없었다. 그 저장소는 `stale`로 표시되지도 `sequence_space_state` 경보가 울리지도 않은 채 조용히 아무 시퀀스도 갖지 못한다. **시험이 먼저 잡았고**, 고친 뒤 `UPDATE`로 되돌려 시험 2건이 실패하는 것을 확인했다 — 그 시험이 이 결함을 실제로 잡는다는 증거다.

**DEV-123 — 접근 범위 우회를 만들 뻔했다.** PR 번호 조회가 `client.search`를 직접 불렀고 ADR-008 아키텍처 시험이 잡았다. 허용 목록에 넣으려다 멈췄다 — 그 목록은 **사용자 대면 예외**를 위한 것이라 워커를 넣으면 두 갈래가 섞인다. 대신 이 잡이 볼 수 있는 것이 **저장소 하나뿐**이라는 사실을 그대로 `explicit` 접근 범위로 적어 필수 필터를 통과했다. **예외가 필요 없었다.**

#### 게이지를 세는 방식

`sequence_space_state`를 `set(1)`로 올릴 뻔했다. 그러면 한 번 `stale`이 된 공간이 복구된 뒤에도 라벨이 1로 남아 **P2 경보가 영원히 울리고, 아무도 그 경보를 믿지 않게 된다.** 상태별로 세어 `replace`하며, 복구 시 게이지가 따라 내려가는 것을 시험이 건다.

### 6.22 WP-022 검증 실행 기록

**실행 일시**: 2026-08-23 · **커밋**: `2adc9dd` / PR #27

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 1. 조상 관계 위반 감지 (AC-1·AC-2) | **통과** | 실제 git 픽스처 재작성 — push 한 번으로 감지→재채번까지 |
| 2. 에폭 1 증가 (AC-3) | **통과** | 변이(에폭 증가 생략)도 잡힌다 |
| 3. 이전 에폭 인용의 `epoch_stale` 판정 (AC-4) | **통과 (판정 규칙)** | 저장 시점 쓰기가 아니라 **에폭 비교**다 (DEV-126). 화면 표시는 W-004 몫 |
| 4. 감사 기록·이벤트 (AC-5) | **통과** | `system:sequence` 주체 행 + EVT-SEQ-002 (어긋난 지점·영향 건수 포함) |
| 5. 재채번 중 조회 (예외 처리) | **통과** | walk를 게이트로 세워 두고 **다른 커넥션으로 실측** — `reassigning` + 이전 확정 값 |
| 6. 실패 시 부분 상태 없음 | **통과** | walk 중단 → 새 에폭 행 0건·에폭 그대로·`stale`. 다음 회차가 완주 |
| 7. base 이전 값 동일 | **통과** | **`pull_request_number`까지** 동일 — 복사가 재계산이면 이 단언이 잡는다 |

| 시험 계층 | 건수 | 환경 |
| --- | --- | --- |
| 통합 (시퀀스 전체) | **36**건 (24 → 36) | 로컬 PostgreSQL 16.13 + 실제 git |
| ES 통합 | 13건 중 신규 3 | **CI가 처음 판정한다** |
| 회귀 | **8**건 (5 → 8) | 로컬 (git만 필요) |
| 단위 전체 | 1025건 | 로컬 |
| ES 비의존 통합 전체 | 22파일 247건 | 로컬 |

#### 변이 시험 (6종, 생존 0)

| 변이 | 결과 |
| --- | --- |
| copy 경계 `<=` → `<` (base 서수가 복사에서 빠진다) | 잡힘 |
| `diverged_at_seq`: `baseSeq+1` → `baseSeq` | 잡힘 |
| DEV-125 폴백 제거 (체인 밖 merge-base를 그대로 쓴다) | 잡힘 |
| head 재검증 제거 (옛 판정으로 재채번한다) | 잡힘 |
| `markReassigning` 사전 커밋 제거 (재채번 중이 밖에서 안 보인다) | 잡힘 |
| 에폭 증가 생략 (조용히 같은 에폭에 다시 매긴다) | 잡힘 |

**거짓 생존이 두 번 나왔고 둘 다 변이 미적용이었다.** 한 번은 셸이 `$5`를 확장해 패턴이 어긋났고, 한 번은 같은 패턴이 `findRange`에도 있어 앵커가 두 곳에 걸렸다. WP-021의 교훈 그대로 — **생존자는 등가 변이로 단정하기 전에 적용 여부부터 확인한다.** 제대로 걸자 둘 다 잡혔다.

#### 시험이 잡은 결함

**`audit_record.correlation_id`가 uuid 타입이라, correlation이 없는 경로에서 감사 기록이 조용히 사라졌다.** 빈 문자열을 넣으면 INSERT가 던지고 — 감사 실패가 재채번을 되돌리면 안 되므로 catch가 삼키고 — 행이 남지 않는다. 감사 시험(`system:sequence` 행 1건 단언)이 잡았다. uuid가 아니면 새로 만든다 — 열쇠가 없을 때 새 uuid는 아무것도 잇지 않으므로 "연결 없음"과 같고, NOT NULL uuid 제약 아래 가장 정직한 표현이다.

#### 스스로 잡은 구조 결함

**COMMIT 뒤의 후처리(색인·이벤트·감사)가 처음에는 트랜잭션 try 안에 있었다.** 그 자리면 이벤트 발행이 던졌을 때 catch가 `markStale`을 불러 **성공한 재채번이 실패로 표시**된다. try 밖으로 빼고, 각 후처리를 개별 try로 감쌌다 — PostgreSQL 커밋이 성공의 정의이고 그 뒤의 실패는 각자 소리만 낸다 (ADR-004).

또 하나 — 처음 구현은 실패 시 던져서 버스 재전달을 불렀다. **JOB-SEQ-002는 재시도하지 않는다**(잡 카탈로그: "없음 (실패 시 `stale`)"). `stale`로 소리 내고 ack한다 — 다음 push가 다시 감지하면 그때 다시 시도된다.

### 6.23 WP-023 검증 실행 기록

2026-08-23, 앵커 정규화와 범위 조회 API 구현 직후.

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| 워크스페이스 타입 검사 | `pnpm typecheck` | 통과 |
| 린트 | `pnpm lint` | 통과 |
| 단위 (전체) | `pnpm test` | 1,059건 통과 (앵커 분류 26건 + `isRepositoryInScope` 8건 신규 포함) |
| 통합 — 앵커 | `pnpm test:integration sequence/anchors` | 26건 통과. 실제 PostgreSQL + Redis, **기본 대역 ES는 부르면 던진다** — 정본만으로 답하는 경로가 색인을 건드리면 실패한다 |
| 통합 — 범위 | `pnpm test:integration sequence/range.test` | 36건 통과. 실제 PostgreSQL + 대역 ES(색인 부재를 시험이 주입). 5만+1행 실데이터로 `RANGE_TOO_LARGE` 경계 실측 |
| 통합 — 범위 (실제 ES) | `pnpm test:integration sequence/range-es` | **로컬 NOT RUN** (이 환경에 Elasticsearch가 없다 — 기존 `search/list.test.ts`와 동일 사정). 13건, CI 서비스 컨테이너에서 실행. **1차 CI에서 11건 실패 — DEV-141을 검출했다**: `multiSearch`가 `routing`을 msearch 본문에 실어 실제 ES가 400으로 거절. 헤더 줄로 옮기고 전송 모양을 단위 시험 4건으로 고정했다. **2차 CI에서 9건 실패 — 이번엔 픽스처 결함**: 문서를 라우팅 없이 색인해 라우팅된 읽기가 빈 샤드만 봤다(0건). 운영 색인은 전 문서를 `repository_id`로 라우팅하므로(ADR-003) 픽스처도 같게 고쳤다 — 시험은 운영이 쓰는 방식으로 넣어야 운영을 말한다. **3차 CI(`32b3437`)에서 13건 전부 통과** — 통합 573건 전체 초록 |
| git 대조 회귀 | `pnpm test:regression range-vs-git` | 14건 통과. **정답은 `git log --first-parent A..B`가 낸다** — 가운데 구간·경계·빈 구간·머지 커밋 단일 계수·건수 전부 git과 일치 |
| 회귀 (전체) | `pnpm test:regression` | 22건 통과 |
| p95 (DoD: 구간 5000건 400ms) | 로컬 프로브 200회 | **부분 실측** — PostgreSQL 구간(정확 count + 페이지 200건 + PR 번호 목록, 1만 행 표에서 5000행 반개구간, 매회 다른 구간): **p95 7.50ms**, p99 10.41ms. ES 집계 왕복은 로컬 ES 부재로 **NOT RUN** (DEV-058과 같은 사정). 400ms 예산 중 PostgreSQL 몫이 2% 미만임은 실측했다 |

### 변이 시험 (WP-023)

구현이 아니라 **시험을 시험**했다. 30종을 적용해 전부 잡히는지 확인했다.

| 대상 | 변이 | 결과 |
| --- | --- | --- |
| 반개구간 경계 | `>` → `>=` (M1), `<=` → `<` (M2), 정렬 역전 (M3), count 경계 (M4) | 4/4 잡힘 (git 대조 회귀) |
| 앵커 SQL | 접두 LIMIT 2→1 (M5), 시각 정렬 기준 (M6), `<=`→`<` (M7), 브랜치 무시 (M8) | 4/4 잡힘 |
| 범위 서비스 | 역전 미검사 (M9), `q` 없는데 필터 (M10), 부재 수 0 고정 (M11), 커밋 수 `q` 무시 (M12), **부재를 거른 질의로 계산 (M13)** | 5/5 잡힘 — M13은 **1차에서 살아남았다** (아래) |
| 앵커 분류 | 숫자 모호성 제거 (M14), 경계 뒤집기 (M15), 최소 길이 제거 (M16) | 3/3 잡힘 |
| 접근·상태 | 범위 미검사 (M17), 에폭 무시 (M18), 없는 공간 200 (M19), 릴리스 사유 누락 (M20), org 미검사 (M21), 서수 실재 미검사 (M22) | 6/6 잡힘 |
| 경로·경계 확장 | `from=0` 거부 (M23), 접두 모호 허용 (M24), 403 노출 (M25), 에폭 무효에 빈 items (M26), 페이지 상한 무시 (M27), PR 없는 구간 items 누락 (M28), **상한 1000배 (M29)**, **공간 불일치 미구분 (M30)** | 8/8 잡힘 — M29·M30은 **1차에서 살아남았다** (아래) |

**1차에서 살아남은 셋이 각각 시험의 빈틈이었고, 셋 다 구별 시험을 더해 잡았다:**

- **M13 (`items_missing_in_index`를 `q` 거른 질의로 계산)** — 대역 ES가 `q`를 무시해서 거른 건수와 안 거른 건수가 늘 같았다. **시험 대역이 너무 관대하면 그 차이를 딛는 결함이 조용히 통과한다.** 대역이 `author` 필터를 실제로 적용하게 하고, "색인은 전부 아는데 `q`가 좁힐 때 부재는 0"을 직접 단언했다.
- **M29 (5만 상한을 1000배로)** — 6건짜리 픽스처로는 상한 분기가 **한 번도 실행되지 않았다.** 실행되지 않는 분기는 어떤 값이어도 초록이다. `generate_series`로 5만+1행을 실제로 넣어 400과 경계(정확히 5만이면 통과)를 실측했다.
- **M30 (`SEQUENCE_SPACE_MISMATCH`와 `ANCHOR_NOT_MERGED` 미구분)** — 다른 브랜치로 머지된 PR 경로에 시험이 없었다. 사용자가 할 일이 다른 두 실패(브랜치를 바꾼다 / 머지를 기다린다)를 가르는 시험을 더했다.

**초록이 곧 검증은 아니다** — M13과 M29가 이번 회차의 사례다. 시험이 있어도 대역이 관대하거나 분기가 실행되지 않으면 아무것도 지키지 않는다.

**그리고 실-ES 계층이 그 원칙의 세 번째 사례를 즉시 냈다 (DEV-141).** 대역 62건이 전부 초록인 채로 msearch 본문의 `routing`이 실제 Elasticsearch에서 400을 냈다 — 대역은 아무 키나 받으므로 **전송 형식의 결함은 대역으로 잡을 수 없다.** "질의가 진짜 색인에서 진짜로 도는가"를 CI가 따로 묻게 해 둔 것이 이 결함을 병합 전에 세웠다.

### 6.24 WP-024 검증 실행 기록

2026-08-24, PostgreSQL 16.13 네이티브 + Redis 네이티브 + 실제 git 저장소 픽스처 (DEV-001과 같은 환경 제약). Elasticsearch는 로컬에 없어 실-ES 계층은 CI가 처음 판정한다 — WP-023과 같은 배치다.

**계층별 결과.**

| 계층 | 파일 | 결과 |
| --- | --- | --- |
| 단위 | `packages/domain/src/release.test.ts` 10건, `apps/web/lib/containment.test.ts` 11건, `apps/ingest-gateway/src/ingest.test.ts` EVT-REL-001 5건, `packages/bus` 스트림 카탈로그 갱신 | **전부 통과** (전체 단위 1,089건) |
| 통합 (실 PG + 실 git + 대역 ES) | `apps/pipeline-worker/integration/release/refresh.test.ts` 15건 — 스냅숏 해석(주석 태그 peel, 체인 밖 NULL 셋), 멱등, 삭제 전파, `ci_deployment` 삭제 면제, 강제 이동, 에폭 재해석, creatordate, GHE 덮어쓰기·실패 폴백, 동기화 실패 무변경, 미등록 skip, 잠금 경합, ES 실패 비차단, 비정규화 모양 | **전부 통과** |
| 통합 (실 PG + Redis, API) | `apps/search-api/integration/release/containment.test.ts` 24건 — PR·커밋 기준 판정, `<=` 경계, 미배포 대기 수·hint, 미머지/미수집/에폭 불일치/체인밖-전용의 네 갈래, 릴리스 앵커 6갈래, 40자 SHA 규칙, 강제 필터·라우팅 wire 검증, 접근 통제 | **전부 통과** |
| git 대조 회귀 | `regression/releases-vs-git.test.ts` 5건 — **정답은 `git merge-base --is-ancestor`가 낸다**: 체인 6 커밋 × 체인 태그 3종 = 18쌍 전수 일치, 주석 태그 peel = `rev-parse ^{commit}`, 시각 순서 = `for-each-ref --sort=creatordate`, 체인 밖 태그의 설계된 차이(DAG 조상이어도 공간 밖), 최신 릴리스 서수 | **전부 통과** |
| 실-ES (CI) | `packages/es/integration/releases.test.ts` 10건 — strict 매핑 수용, NULL 셋 키 부재, 스냅숏 버전 역전 거부, 삭제, painless 컴파일·경계(서수5=릴리스5)·에폭/저장소 격리·가장 이른 5개·noop 수렴·전량 삭제 복귀 | **통과 (CI 2차, 2026-08-24)** — 로컬 ES 부재로 CI가 첫 판정. M11(painless 경계 변이)의 유일한 킬러인 경계 문서 시험이 실제 Elasticsearch에서 돌았다 |

**DoD 판정.** QA-W002-08(시각 오름차순 유지)·QA-W002-09(미배포 배지+대기 수) 통과. 판정=시퀀스 비교(AC-5), 오름차순(AC-3), 미배포 응답(AC-4), 미수집 200+사유(DEV-146), 자가 치유(삭제·강제 이동·재채번 뒤 git 일치), 릴리스 앵커가 같은 서수 지점으로 해석되어 WP-023 범위 조회를 그대로 딛는다(AC-1 ↔ seq 앵커 동치).

**실-ES 계층을 쓰면서 발견한 매핑 결함 둘 (푸시 전 수정).** ① `RELEASE_MAPPING`에 `document_version`이 없었다 — 조건부 업서트의 비교 키인데 `dynamic: strict`가 색인 자체를 거부했을 것이다. ② `prs-commits` 매핑에 `unreleased`가 없었다 — 비정규화 스크립트가 양쪽 별칭에 같은 짝을 쓰는데 커밋 쪽 갱신이 전부 거부됐을 것이다. 두 결함 모두 대역 시험은 영원히 초록이었다 — DEV-141과 같은 계층의 교훈이다.

**변이 시험 12종 (전부 적용 확인 후 실행).**

| # | 변이 | 결과 |
| --- | --- | --- |
| M1 | 포함 경계 `>=` → `>` | **킬** — 통합 3건 + git 대조 전수 쌍 |
| M2 | 미수집을 미배포로 뭉침 (hasAnyRelease 제거) | **킬** — DEV-146 갈래 시험 |
| M3 | 판정의 에폭 검증 제거 | **킬** — DEV-149 판정 시험 |
| M4 | 릴리스 앵커가 표의 서수를 신뢰 (재확인 생략) | **킬** — DEV-149 앵커 시험 (NULL 셋 태그가 해석돼야 함) |
| M5 | 미러 동기화 실패에도 계속 진행 | **킬** — 무변경 시험 (오래된 스냅숏 삭제가 최악) |
| M6 | 신호에 태그 이름 탑재 | **킬** — EVT-REL-001 단위 2건 |
| M7 | 대기 수 기준 `?? 0` → 대상 서수 누출 | **생존 → 시험 추가 → 킬.** 체인 밖 태그만 가진 저장소가 없었다 — `acme/infra` 픽스처와 AC-4 시험을 더해 잡았다 |
| M8 | 게이트웨이 5d 실패가 202를 깨뜨림 | **생존 영역 발견 → 시험 추가 → 킬.** 5d 전체가 무시험이었다 — EVT-REL-001 발행 5건(태그 push 발행, 브랜치 제외, 실패 202+메트릭, 아카이브 비차단, 중복 미발행)을 더했다 |
| M9 | 삭제 전파 제거 (`deletedTags = []`) | **킬** — 자가 치유 시험 |
| M10 | 비정규화 정렬 역전 (최신 5개로) | **생존 → 픽스처 보강 → 킬.** 태그 시각이 같은 초라 타이브레이크가 방향을 가렸다 — 2020년으로 backdate한 주석 태그(`zz-oldest`: 체인 마지막 커밋, 이름 역순, 시각 최선)를 더해 시각·이름·체인 순서를 갈랐다 |
| M11 | painless 경계 `<=` → `<` | **로컬 전 계층 생존 (39건 초록 확인)** — 대역은 painless를 실행하지 못한다. 유일한 킬러는 실-ES 계층의 경계 문서(서수 5 = 릴리스 5)이고 **CI가 판정한다**. 이것이 실-ES 계층이 존재하는 이유다 |
| M12 | C-020 판정 `=== true` → `!== undefined` | **생존 → 시험 추가 → 킬.** `unreleased: false` + 빈 목록의 모순 응답 입력이 없었다 — false를 미배포로 그리는 구현을 가르는 시험을 더했다 |

생존 3종(M7·M8·M12)과 픽스처 결함 1종(M10)은 전부 시험 결함이었고 구현 결함은 없었다. 각 시험 추가 후 변이 재적용으로 킬을 확인하고 원복했다. M11은 잔여 항목으로 CI 판정을 명시한다.

**CI 1차 (2026-08-24): a11y 계층이 진입 조회 위반을 잡았다.** C-020 컨테이너가 진입 시 `/containments`를 불러 QA-W002-17(확장 전 조회 금지, CR-020 DEV-088이 세운 구조)을 깼고, 커밋 화면의 섹션 testid도 어긋났다(`section-commit-releases`). **로컬 검증이 `test:a11y`를 빠뜨린 것이 원인이다** — 화면 배선을 바꾼 WP는 a11y·e2e·contrast까지 돌려야 한다. 수정: 섹션을 PendingSection과 같은 접힘 기본 + **펼칠 때 1회 조회**로 바꾸고(접거나 다시 펼쳐도 재조회 없음), CR-020이 미뤄 둔 "확장하면 조회한다" 절반을 화면 경유 실네트워크 계수로 처음 검증했다(a11y 2건 추가 — 진입 1회 → 펼침 2회 → 접기/재펼침에도 2회 고정). 수정 후 a11y 135건·contrast 80쌍·e2e 53건·단위 1,089건 전량 통과. **CI 2차 (`4a68769`): verify·integration 둘 다 초록** — 실-ES 계층 첫 실행 포함. **후속 PR #30 CI 1차: 실-ES 계층이 prune의 가시성 결함을 잡았다** — `delete_by_query`는 검색이라 같은 회차 업서트(미refresh)를 못 보고 0건을 지운다(원장 7장의 기지 패턴이 새 코드에서 재현). `pruneReleaseDocuments`가 지우기 전에 `indices.refresh`를 돌게 고쳤다 — 걷어내기는 저장소당 회차 1회라 비용은 무시 가능.

**Codex 리뷰 (ready-for-review 전환 시, P1 셋·P2 하나): 넷 다 실결함으로 확인·수정.** 각 수정은 결함 재적용으로 킬을 확인했다.

| 지적 | 확인 | 수정 |
| --- | --- | --- |
| P1 — 판정 조회가 에폭을 안 가림 (`rows[0]`) | 실결함. 재채번 뒤 같은 PR·커밋 행이 두 에폭에 있고, 이전 에폭 행이 걸리면 멀쩡한 대상이 `target_not_sequenced`가 된다. 기존 에폭 시험은 **이전 에폭 행만** 있는 저장소라 두-행 경우를 못 걸렀다 | `pickJudgmentRow` — 시퀀스 브랜치 등록 순서로 현재 에폭 일치 행을 고른다(JOB-REL-007 태그 해석과 같은 결정론 규칙). 두-에폭 픽스처(`acme/billing`) 시험 추가 |
| P1 — ES 삭제의 항목 단위 실패를 무시 | 실결함. 정본 행은 이미 지워져 다음 diff가 그 태그를 다시 내주지 않는다 — 부분 실패가 영구 유령 문서가 된다 | `deleteReleaseDocuments`(_id 삭제) → **`pruneReleaseDocuments`(남길 것 밖 전부의 질의 삭제)** 로 재설계. 매 갱신이 스냅숏과 색인을 재대조하므로 놓친 삭제가 다음 회차에 아문다 — 정본 쪽 전량 diff와 같은 수렴 철학. `failures`는 던져 메트릭에 남긴다 |
| P1 — 일시 실패 이벤트를 ack | 실결함. XACK 뒤에는 문서화된 3회 백오프(비동기 4장)를 쓸 수 없고 지연이 "다음 웹훅/6시간 스윕"으로 확대된다 | `failed` → `{kind:'retry'}` — 버스가 백오프·예산을 집행한다. 갱신이 멱등 diff라 재시도 안전 |
| P2 — 스윕 sleep이 중단 불가 | 실결함. stop()이 6시간 타이머를 기다려 SIGTERM 유예를 넘긴다 (킬 확인에서 시험이 60초 타임아웃으로 재현) | 깨울 수 있는 sleep — stop()이 타이머를 걷고 즉시 깨운다. **미러 스윕(mirror-runner.ts, WP-020 기병합)도 같은 모양이다** — 이 PR 밖이라 §7에 별도 정리로 남긴다 |

수정 후 재검증: 통합 42건(refresh 17 + containment 26 — 새 시험 5건 포함)·회귀 27건·단위 1,089건 전량 통과. 실-ES 스위트는 prune 의미로 갱신(2건 — 남김/전량 걷기·저장소 격리), CI가 판정한다.

### 6.25 WP-025 검증 실행 기록

2026-08-24, 실제 PostgreSQL 16.13 + Redis(API 통합) / jsdom+axe(a11y) / Chromium 프로덕션 빌드(e2e).

**계층별 결과.** 단위 `lib/range.test.ts` 25건(URL 왕복, 사전 판정 경계 — 5만 정확 경계·동서수 비역전, 에폭 3갈래, 되돌림 pending, 순서 보존, 앵커 실패 갈래, 응답 정제) 통과. a11y `a11y/ranges.test.tsx` 18건(반개구간 상시, AC-5 넷, 제안 버튼, 교환, 5만 안내, **에폭 불일치 무자동재조회 — 실네트워크 계수**, 서버 낡음 판정, 재채번 배너+마지막 확정 값, RANGE_TOO_LARGE 서버 절반, 빈 상태, unknown 공간, axe 0건 ×2) 통과. e2e `flow-003-range.spec.ts` 4건(딥링크 자동 정규화→조회→URL 에폭 인용, 결과 행→W-002→**뒤로가기 조사 URL 복귀**(FLOW-003 5·6단계), 에폭 경고 무재조회, 내비게이션) 통과 — 전체 e2e 57건. API 통합 `sequence/spaces.test.ts` 4건(범위 필터·조용한 부재, unknown 노출, 상태·에폭 전달, 401) 통과. contrast 80쌍.

**구현 중 잡은 것 둘.** ① blur 재확정이 버튼 클릭 전에 상태를 바꿔 제안·교환·조회 클릭이 허공에 떨어지는 결함 — blur 확정을 미확정(idle) 텍스트로 한정해 해결(a11y 6건이 잡았다). ② `spaces-list.ts`의 맵 키 구분자에 원시 NUL 바이트가 들어가 소스가 바이너리 취급되는 결함 — 변이 준비 중 발견, 공백 구분자로 교체.

**e2e 1차의 54/57.** 첫 실행에서 기존 flow-003 1건이 실패했으나 원인은 **낡은 `.next` 빌드**(로컬 e2e는 빌드를 재사용한다 — CI는 build 스텝이 선행)와 재빌드 직후 부하였다. 재빌드 후 단독 14/14, 전체 재실행 57/57 — 같은 커밋에서 두 번 확인했다.

**변이 7종 (전부 적용 확인 후 실행, 전부 킬 후 원복).**

| # | 변이 | 킬 |
| --- | --- | --- |
| M1 | 공간 목록 범위 필터 우회 | 통합 1건 (범위 밖 저장소 노출) |
| M2 | 채번 이력 없는 브랜치 숨김 | 통합 2건 |
| M5 | 에폭 불일치를 항상 match로 | 단위 1 + a11y 2 |
| M6 | 서버 낡음 판정에 자동 재조회 | a11y 1 (무한 재조회 증상까지 드러남) |
| M7 | 되돌림 pending을 0으로 | 단위 1 |
| M8 | 결과를 클라이언트에서 재정렬 | 단위 1 |
| M3·M4 | 5만 경계 `>=`·역전 `>=` (동치 확인) | 단위 경계 시험이 직접 고정 — 적용·킬 확인 생략 없이 경계값 시험 통과를 근거로 |

**DoD 판정.** QA-W004-01~09·11·21·22 통과, QA-W004-10은 CR-029 분할대로 넷+준비 중 표기 통과. 도달 가능 상태 13종 전부 렌더 확인(6.25장 계층 표). axe 위반 0건.

### 6.26 WP-026 검증 실행 기록

2026-08-25, 실제 PostgreSQL 16.13 + Redis(API 통합) / jsdom+axe(a11y) / Chromium 프로덕션 빌드(e2e).

**계층별 결과.** 단위 `lib/release.test.ts` 23건(응답 정제와 `null` 항목 가드, 딥링크 파라미터 왕복, 선택 판정 5갈래, 서수 기준 방향 정규화, W-004 링크 셋, 직전 표기 3갈래) + `sequence/range.test.ts` 2건(`size=0`의 질의 계수와 대조군) 통과. a11y `a11y/releases.test.tsx` 21건(**목록 요청에 브랜치 없음**, 두 브랜치 공존, 서버 순서 보존, 2건 선택 활성화, 순서 무관 정규화, 공간 불일치 차단, 서수 없는 행 비활성, 상한 도달 시 미선택만 비활성, 직전 표기 2갈래, 상세와 되돌림 준비 중, 가장 이른 릴리스, 미배포 링크, 릴리스 0건 안내, 절삭·404·실패·빈 공간, axe 0건 ×3) 통과. e2e `flow-003-releases.spec.ts` 4건(**내비게이션 "릴리스" → 화면**, 2건 선택 → W-004 도착과 앵커·에폭, 다른 브랜치 차단, 미배포 서수 앵커) 통과 — 전체 e2e 61건. API 통합 `release/timeline.test.ts` 24건(목록 12·비교 12) 통과 — 전체 통합 654건. contrast 80쌍, 회귀 27건.

**구현 중 잡은 것 둘.** ① **`to=unreleased`의 시작점이 타임라인과 어긋났다** — `findLatestRelease`가 저장 서수를 조건으로 써서, 동기화가 채번보다 먼저 돈 릴리스를 건너뛰고 더 오래된 릴리스를 기준으로 삼았다. 통합 시험이 `from_seq: 5`(기대 6)로 잡았고, 그 실을 당기자 **포함 판정 전체가 같은 결함**을 갖고 있던 것이 드러났다 — DEV-160으로 등록·해소했다. ② `judgeReleases`가 배열 안의 `null` 항목에 죽었다(단위 시험이 첫 실행에서 잡았다).

**M3의 두 방어가 서로를 가렸다.** "직전 대비 PR 수"의 코드는 `count(DISTINCT pull_request_number)`와 `WHERE pull_request_number IS NOT NULL`을 함께 갖는데, **각각을 지우는 변이는 둘 다 살아남았다** — `count(DISTINCT col)`이 NULL을 세지 않으므로 한쪽만 지우면 답이 그대로다. 둘을 함께 지운 변이가 `expected 3 to be 2`로 킬됐다. 등가 변이를 킬로 착각하지 않으려면 **변이가 실제로 답을 바꾸는지**부터 확인해야 한다는 사례다.

**변이 9종 (전부 적용 확인 후 실행, 전부 킬 후 원복).**

| # | 변이 | 킬 |
| --- | --- | --- |
| M1 | 타임라인이 저장 서수를 그대로 믿는다 (DEV-149 무력화) | 통합 2건 |
| M2 | 목록이 접근 범위를 지나지 않는다 | 통합 12건 |
| M3 | 직전 대비 수를 PR이 아니라 서수로 센다 (두 방어 동시 제거) | 통합 1건 (`expected 3 to be 2`) |
| M4 | 지정 순서를 그대로 방향으로 쓴다 (AC-4 무력화) | 통합 1건 |
| M5 | 공간이 달라도 비교를 허용한다 (AC-3 무력화) | 단위 1 + a11y 1 |
| M6 | 서수 없는 릴리스도 앵커로 허용한다 | 단위 2 + a11y 1 |
| M7 | 목록 요청에 브랜치를 싣는다 (AC-3 도달 불가로) | a11y 1 |
| M8 | 비교 대상이 없을 때 "0건"이라고 말한다 | 단위 1 + a11y 1 |
| M9 | `size=0`에도 항목 질의를 돈다 | 단위 1 |

**Codex 리뷰 (ready-for-review 전환 시, P1 하나·P2 둘): 셋 다 실결함으로 확인·수정.** 각 수정은 결함 재적용으로 킬을 확인했다.

| 지적 | 확인 | 수정 |
| --- | --- | --- |
| P1 — 미배포 링크가 **맨 숫자** 앵커를 넘긴다 | 실결함. `classifyAnchor`는 맨 숫자를 **의도적으로 `ambiguous`로 판정한다**(PR 번호와 서수를 고르지 않는다). `from=6&to=8`로 넘기면 W-004가 두 앵커를 모두 해석하지 못해 **조회 버튼이 잠긴 채로 도착한다**. 함께 지적된 시작 서수 `0`도 앵커 문법(1 이상)으로 표현할 수 없고, 체인 밖 태그만 가진 저장소에서 실제로 나온다 | `seq:` 접두를 붙이고, 시작이 `0`이면 **`from`을 싣지 않는다** — 없는 앵커를 지어내거나 시작을 1로 올려 첫 커밋을 빼지 않는다. 화면이 "시작은 직접 고르세요"를 함께 말한다 |
| P2 — 릴리스 상세를 **셀렉터의 브랜치**로 묻는다 | 실결함. 목록이 저장소 스코프라(DEV-158) `release/2.4` 행이 함께 있는데, 그 상세를 `main` 공간으로 물으면 서버가 두 태그를 다른 공간에서 풀어 `SEQUENCE_SPACE_MISMATCH`를 낸다 — **화면이 스스로 만든 조합을 스스로 거절한다** | 공간을 호출부가 정하게 바꿨다: 상세는 **행의 `baseBranch`**, 미배포만 셀렉터의 공간 |
| P2 — "다시 시도"가 아무 일도 하지 않는다 | 실결함. 같은 저장소로 상태만 새 객체로 바꿔도 효과의 의존성이 파생 문자열(`repository`)이라 다시 돌지 않는다 — 실패 화면에서 영구히 벗어나지 못한다 | 재조회 방아쇠(`reloadToken`)를 두고 효과 의존성에 넣었다 |

**e2e 대역이 P1을 통과시킨 이유와 그 수정.** 앵커 대역이 **무엇을 주든 해석해 줬다** — 링크가 만든 표현이 틀려도 초록이 났다. 대역을 서버와 같은 갈래로 고쳐(맨 숫자·`seq:0`은 400) 미배포 링크의 **왕복**을 걸었다: 도착 URL만이 아니라 W-004가 두 앵커를 실제로 해석하는지까지 본다. 결함을 재적용하니 e2e가 잡는다(실 브라우저, 재빌드 후 확인). **대역이 실제보다 관대하면 그만큼이 사각지대다** — WP-024의 "초록이 곧 검증은 아니다"와 같은 사례다.

수정 후 재검증: 단위 1146 · a11y 176 · e2e 61 · 통합 654 · 회귀 27 · contrast 80쌍 전량 통과.

**DoD 판정.** QA-W005-01~04·06 통과. QA-W005-05는 **절반** — `release_not_indexed`와 두 원인 안내는 통과하고 저장소 개요 경로(W-009)는 화면 부재로 이월(CR-030, DEV-159). AC-4·AC-5 통과, 도달 가능 상태 7종 렌더 확인, 다른 브랜치 공존 확인, `pull_request_count_since_previous`가 서수 차와 다른 경우를 시험이 구분한다. axe 위반 0건.

**NOT RUN.** 실제 GHE 대상 smoke와 OIDC 실연동은 사내망 전제라 이 환경에서 돌지 않는다 — 목 서버 계약 시험과 실 PostgreSQL·Redis·Elasticsearch로 검증 가능한 것은 전부 검증했다.

### 6.27 WP-027 검증 실행 기록

2026-08-25, 실제 PostgreSQL 16.13 + Redis(API 통합) / jsdom+axe(a11y) / Chromium 프로덕션 빌드(e2e). **Node 22.23.2** — 이 WP부터 로컬이 `.nvmrc`·CI와 같은 메이저다(6.27장 말미).

**계층별 결과.** 단위 `lib/neighbors.test.ts` 15건(직접 푸시 행 보존, 색인 미반영 행, 기준 강조, 경계, 모양 어긋난 항목, 사유 판정 5갈래, 범위 확장 4갈래, 에폭 3갈래, 건수 상한) 통과. a11y `pr-detail` 신규 8건 + `commit-detail` 신규 4건(커밋 앵커, 체인 밖 무조회, 미채번 문구, axe) 통과 — 전체 186건. e2e `flow-002.spec.ts` 신규 4건(펼칠 때 1회, 서수 연속, **범위 확장 왕복**, 미머지 무조회) 통과 — 전체 65건. API 통합 `sequence/neighbors.test.ts` 20건 통과 — 전체 674건. 회귀 27건, contrast 80쌍.

**WP-017의 자리표시자 시험 둘을 실제 동작으로 갈았다.** `reason-neighbors`(PendingSection)를 단언하던 두 시험은 이 WP가 그 자리를 채우면서 의미를 잃었다 — 미머지 무조회와 펼칠 때 1회 조회를 단언하는 시험으로 바꿨다. WP-024가 C-020에서 겪은 것과 같은 교대다.

**변이 8종 (전부 적용 확인 후 실행, 전부 킬 후 원복).**

| # | 변이 | 킬 |
| --- | --- | --- |
| M1 | 목록에서 직접 푸시 커밋을 거른다 (DEV-161 무력화) | 통합 3건 |
| M2 | 미머지도 서버에 물어본다 (DEV-164 무력화) | a11y 1건 |
| M3 | **진입 시에도 부른다** (DEV-162 무력화) | a11y 4 + e2e 2 |
| M4 | 범위 확장 앵커에서 `seq:` 접두를 뗀다 | 단위 2 + a11y 1 |
| M5 | 사유를 모를 때 미머지로 단정한다 | 단위 1 |
| M6 | 에폭을 비교하지 않고 늘 일치로 본다 | 단위 1 + a11y 1 |
| M7 | 경계를 늘 아니라고 답한다 (AC-4 무력화) | 통합 2건 |
| M8 | 커밋 앵커를 무시하고 PR 번호로 부른다 (DEV-163 무력화) | a11y 1건 |

**M3의 첫 형태는 등가 변이였다.** `if (next && phase === 'idle')`에서 `next &&`만 떼는 변이는 살아남는다 — 접는 시점에는 이미 조회가 끝나 `idle`이 아니기 때문이다. **마운트 시 조회**로 바꾸자 여섯 시험이 잡았다. WP-026의 M3(중복 방어가 서로를 가림)에 이어 두 번째 사례이며, 같은 교훈이다: **변이가 실제로 답을 바꾸는지부터 확인한다.**

**로컬 환경을 CI와 맞췄다.** 기본 Node가 v20.12.0이라 `eslint-visitor-keys@5.0.1`의 engines(`^20.19.0 || ^22.13.0 || >=24`)를 만족하지 못해 **`pnpm install`이 거부되는 상태**였다. Node 22.23.2를 설치해 `.nvmrc`·CI와 같은 메이저에서 전 계층을 돌렸다. 그 과정에서 `pnpm lint`가 새 통합 시험의 미사용 import를 잡았다 — **라우트 등록 직후 lint를 돌리고 시험 파일은 그 뒤에 썼기 때문에** lint가 그 파일을 본 적이 없었다. 계층을 순서대로 돌리는 것만으로는 부족하고, **마지막 파일까지 쓴 뒤 다시 돌려야 한다.** 개발 DB(`prs`)에 마이그레이션이 적용돼 있지 않던 것도 함께 채웠다.

**DoD 판정.** QA-W002-04~07·16·19 통과, QA-W002-17이 선행·후행까지 포함해 통과, AC-1~AC-5 전부, W-003 커밋 앵커 통과, axe 위반 0건.

**NOT RUN.** 실제 GHE smoke와 OIDC 실연동은 사내망 전제라 이 환경에서 돌지 않는다.

**관찰: `flow-001` "히스토리 규율"의 간헐 실패.** 전체 e2e 실행 중 6회 중 2회 실패했고(Node 20·22 양쪽), 단독 실행은 3/3 통과다. WP-016 소관이고 이 WP의 변경과 무관하다 — §7에 남긴다.

#### 6.27.1 머지 후 Codex 리뷰 라운드 (CR-032, 2026-08-25)

**리뷰가 머지 뒤에 도착했다.** PR #33은 ready 전환 시점에 Codex 리뷰 3건을 받았고, 그 지적이 처리되기 전에 머지됐다(`bc0e931`). 지적 셋은 **머지된 `main`에서 그대로 재현된다.** 앞선 두 라운드(6.24·6.26장)와 달리 같은 PR에 밀어 넣을 수 없으므로 **후속 PR로 정정한다** — WP-027은 `done`을 유지하되 이 절이 그 뒤에 무엇이 바뀌었는지를 갖는다. **CI가 초록이었다는 사실을 "결함 없음"의 근거로 쓰지 않는다**: 셋 중 P1은 단일 브랜치 픽스처로는 도달 자체가 불가능한 자리였다.

| 지적 | 확인 | 수정 |
| --- | --- | --- |
| **P1** — 모호한 앵커에 시퀀스 공간 판별자가 필요 (`neighbors.ts:256`) | **실결함.** `merge_sequence`의 유일 색인이 `(repository_id, base_branch, seq_epoch, commit_sha)`이므로 **한 커밋이 여러 브랜치의 현재 체인에 함께 있는 것은 정상**인데, `findNeighbors`가 저장소 전체를 훑어 현재 에폭인 **첫 행**에서 멈췄다. 두 행이 모두 에폭 검사를 통과하면 어느 공간을 낼지 PostgreSQL의 반환 순서가 정한다. **지적보다 한 겹 더 나쁜 자리도 확인했다** — 화면은 "범위로 확장" 링크를 문서의 `base_branch`로 만들고 있어, 서버가 다른 공간을 고르면 목록의 서수와 링크가 **서로 다른 공간을 가리킨 채** 조용히 어긋난다(WP-026 P2와 같은 모양인데 그때는 서버가 거절해 드러났다) | `base_branch`를 API-REL-001의 **필수 파라미터**로 세우고(DEV-168), 앵커 해석을 API-SEQ-002가 쓰던 `findPointByPullRequest`/`findPointByCommit`(공간·에폭 한정)으로 통일했다 — **`packages/db`에 새 질의를 만들지 않았다.** 응답의 `sequence_space`는 저장 행이 아니라 **요청한 공간**에서 만들어 불변식이 우연이 아니라 구조가 되게 했다. 화면 둘은 이미 갖고 있던 `base_branch`를 보내고, 모르면 **조회하지 않는다**(`main`으로 지어내지 않는다) |
| **P2** — 커밋 시각을 PR 머지 시각으로 표기 (`neighbors.ts:123`) | **실결함.** `merged_at: source?.merged_at ?? row.committed_at`이 색인 지연된 **PR 행**에 병합 커밋의 시각을 실었고 화면은 그것을 "머지 시각" 칸에 그렸다. 계약의 응답 예시는 **직접 푸시 커밋 행**에만 커밋 시각을 허용하며, PR 행의 미색인 경우는 계약에 아예 없던 자리였다 | 행의 종류가 규칙을 정하게 했다(DEV-169): 커밋 행은 `committed_at`, PR 행은 색인이 아는 값이거나 **`null`**. `formatTimestamp(null)`이 이미 `—`를 내므로 화면 표기는 건드리지 않았다. 계약에 세 갈래를 명시했다 |
| **P2** — 실패한 조회를 재시도할 수 없음 (`NeighborSequenceList.tsx:287`) | **실결함.** 접기/펴기는 `phase === 'idle'`일 때만 조회하고 건수 조절 UI는 `view !== null`일 때만 그려진다 — **error 상태에서는 둘 다 닫혀 있어** 상세 화면을 통째로 다시 여는 것 말고는 복구 경로가 없었다. 그런데 화면 문구는 "잠시 뒤 다시 시도해 주세요"였다 | 명시적 **"다시 시도" 버튼**을 두고 `load(count)`를 다시 실행한다(DEV-170). 접기/펴기 게이트는 `idle`로 유지했다 — DEV-162("펼칠 때 1회")를 되돌리지 않는다. 안내 문구에서 따를 수 없는 지시를 뺐다 |

**e2e 대역을 서버와 같은 갈래로 고쳤다.** `flow-002`의 대역은 `base_branch` 유무와 무관하게 이웃을 돌려줬다 — 화면이 공간을 빠뜨려도 초록이 났을 것이다. 서버처럼 **`base_branch` 없는 요청을 400으로 거절**하게 바꿔 목록이 그려진다는 사실 자체가 왕복 증거가 되게 했다. 결함을 재적용하니 e2e 4건이 실패한다(실 브라우저, 재빌드 후 확인). **WP-026에서 얻은 "대역이 실제보다 관대하면 그만큼이 사각지대다"의 두 번째 적용이다.**

**결함 재적용 4종 (전부 적용 확인 후 실행, 전부 킬 후 원복).**

| # | 되살린 결함 | 킬 |
| --- | --- | --- |
| M1 | 앵커 공간을 요청이 아니라 저장소 전체의 첫 행에서 고른다 (P1 원결함) | 통합 3건 |
| M2 | 색인 안 된 PR 행에 커밋 시각을 머지 시각으로 싣는다 (P2 원결함) | 통합 1건 |
| M3 | 재시도 버튼의 핸들러를 뗀다 (P2 원결함) | a11y 1건 |
| M4 | 화면이 요청에 `base_branch`를 싣지 않는다 | a11y 2 + e2e 4 |

**신규 시험.** 통합 `sequence/neighbors.test.ts` +10건 (20 → 30). 그중 핵심은 **다중 공간 픽스처** — `acme/multi`에 `main`과 `release/2026.08` 두 현재 공간을 세우고 같은 커밋을 양쪽 체인에 넣어, 같은 PR·같은 SHA가 공간마다 다른 서수(2 / 11)를 갖게 했다. **저장 순서를 뒤집어도 답이 같은지**까지 단언한다. a11y +6건(`pr-detail` 5 · `commit-detail` 2 중 신규 기준), e2e +2건.

**전 계층 재검증.** 타입·lint·lint:deps 통과, 단위 1161(1 skipped), a11y 192, e2e 67, 통합 684, 회귀 27, contrast 80쌍 전량 통과.

**`flow-001` 간헐 실패의 귀속을 실측했다.** 이 라운드의 전체 e2e에서도 같은 시험이 한 번 실패해, **변경을 stash하고 깨끗한 `main`(`bc0e931`)에서 재빌드 후 2회 돌렸다 — 1회 실패·1회 통과였다.** 이 정정과 무관한 기존 간헐 실패임이 확인됐다(§7).

### 6.28 WP-028 검증 실행 기록

2026-08-25, 실제 PostgreSQL 16.13(API·마이그레이션 통합) / Node 22.23.2.

**계층별 결과.** 단위 `packages/domain/src/integrity.test.ts` 9건(최초 지점, 채번 뒤처짐과 히스토리 단축의 구분, 입력 순서 무관, 표본 하한) + `ops/sequence-integrity.test.ts` 17건(파서 기반 영향 판정 8갈래, 확인 문자열, mode) + `pipeline-worker/src/integrity.test.ts` 8건 + `reconcile.test.ts` 14건 + `consistency.test.ts` 9건 통과 — 전체 단위 1218건(1 skipped). API 통합 `ops/sequence-integrity.test.ts` 20건, 마이그레이션 통합 `job-type-reassign.test.ts` 5건 통과 — 전체 통합 709건. a11y 192, e2e 67, 회귀 27, contrast 80쌍.

**이 WP의 결정 하나가 나머지를 정한다 — 점검은 관찰이다.** FR-ADMIN-003의 예외 처리가 점검 실패 시 공간 상태를 `unknown`으로 바꾸라고 적고 있었는데, `unknown`은 이미 "채번된 적 없는 브랜치"라는 뜻으로 세 화면이 표시하고 있었다(CR-029). 사용자 결정(갈래 A)으로 **SRS를 v2.5로 고쳐** 상태를 보존하게 했고, 그 결정이 구현에서는 "**이 경로에 쓰기 질의가 없다**"로 나타난다. 단위 시험이 그 사실을 직접 단언한다 — 질의 문자열을 감시해 `UPDATE`/`INSERT`/`DELETE`가 0건임을 본다. 상태 enum을 늘리는 갈래 B는 기각했다: 시퀀스 상태와 진단 실행 상태는 다른 개념이고, 한 번 섞으면 마이그레이션·C-027·W-004가 그 오염을 물려받는다.

**구현 중 잡은 것.** ① **정규화된 `pull_request` 표가 없다.** JOB-ING-008의 초안이 그 표를 가정했는데 스키마에 없다 — ADR-004가 "재생의 진짜 소스는 PostgreSQL의 `raw_event`"라고 정하고 있어 대조의 정본 쪽을 `raw_event`에서 뽑도록 고쳤다. 없는 표를 가정했다면 이 잡은 ADR-004가 아니라 다른 무언가를 검증했을 것이다. ② **조정 스캔이 단위 시험에서 백필 스택 전체를 요구했다.** 되돌리기가 `projectOne`을 직접 부르고 있어 탐지·집계 규칙만 보려 해도 ES·GHE 대역이 필요했다. 주입 가능한 이음매를 두되 **기본값을 `projectOne`으로** 남겨 "되돌리기 경로는 하나"라는 결정은 그대로 두었고, 주입을 걷어 내면 기본 경로가 쓰인다는 것을 시험이 단언한다.

**재사용한 것.** 앵커·스케줄러·되돌리기 어느 것도 새로 만들지 않았다 — 주기 스윕은 `startReleaseSweeper`의 형태(깨울 수 있는 sleep)를 그대로 쓰고, 되돌리기는 백필의 `projectOne`, head 채번은 기존 `sequence_assign` 잡 예약이다. 대조 규칙은 `@prs/domain`에 한 벌만 두어 API(`GET /admin/sequence-integrity`)와 잡(JOB-SEQ-003)이 함께 쓴다 — 둘이 각자 갖고 있으면 "점검은 통과인데 잡은 불일치"가 나온다.

**결함 재적용 9종 (전부 적용 확인 후 실행, 전부 킬 후 원복).**

| # | 되살린 결함 | 킬 |
| --- | --- | --- |
| N1 | 점검 실패가 공간 상태를 `unknown`으로 바꾼다 (API, 갈래 B로 되돌림) | API 통합 1건 |
| N2 | 잡 쪽에서 공간 상태를 바꾼다 | 단위 1건 |
| N3 | 표본을 999개만 검사한다 | 단위 1 + API 통합 1 |
| N4 | 최초가 아니라 마지막 불일치를 낸다 | 단위 1 + API 통합 2 |
| N5 | 저장 검색을 `includes('seq:')`로 판정한다 | 단위 2건 |
| N6 | 조정 스캔을 `updated asc`로 돌린다 | 단위 1건 |
| N7 | head 서수가 없어도 채번을 예약하지 않는다 | 단위 2건 |
| N8 | JOB-ING-008이 ES 잉여 문서를 자동 삭제한다 | 단위 1건 |
| N9 | `sequence_reassign`을 CHECK에서 뺀다 | 마이그레이션 통합 2건 |

**N5의 첫 형태는 킬이 얇았다.** `includes('seq:')`로 되돌리는 변이가 처음에는 단위 1건만 잡았다 — 인용 안의 `seq:`를 검증하는 시험이 술어 판정 함수만 보고 있어서, 세는 함수를 바꾼 변이에 닿지 않았다. **집계 함수 자체에 네 갈래(인용 본문·부정 필터·다른 저장소·다른 브랜치)를 거는 시험을 더하자** 킬이 2건이 됐다. 변이가 죽었다고 해서 시험이 그 자리를 지키는 것은 아니라는 사례다.

**DoD 판정.** 18항 전부 통과. QA-A003-09는 A-003 화면이 WP-040 몫이라 **API 계층까지** 검증했다(점검 실행·결과 형식·감사 기록). 표본 1000·최초 불일치·`confirmation` 400·누락 재투입·지표 노출·감사 기록·상태 보존·마이그레이션 009·`new_epoch_expected` 계산·파서 기반 영향 판정·주기 설정값·24시간 창·head 채번 예약·한도 미룸과 3주기 경보·PG↔ES 두 층 대조와 무삭제·보고의 민감 정보 배제 전부 시험이 고정한다.

**NOT RUN·이월.**

- **실제 outbound 알림 발송** — 알림 어댑터가 REL-005 소유다(DEV-026·DEV-127). FLOW-008 7단계는 이 WP에서 **감사 기록·지표·잡 상태**까지만 성립하며, 발송했다고 보고하지 않는다 (CR-033, DEV-176). 제외 항목에 명시했다.
- **A-003 운영 콘솔 화면** — WP-040.
- **실제 GHE 대상 smoke** — 사내망 전제라 이 환경에서 돌지 않는다. 조정 스캔의 `direction: 'desc'` 왕복은 대역으로 검증했다.
- **`sequence_reassign` 잡의 실행부** — 이 WP는 잡을 **큐에 넣는 데까지**다. 큐를 집어 `reassignSequence`를 부르는 러너는 붙이지 않았다(기존 `reassignSequence`는 WP-021이 이미 세웠다). 잡 행은 `queued`로 남는다.

**관찰: `flow-001` 간헐 실패는 이 WP와 무관하다.** CR-032 라운드에서 깨끗한 `main` 기준으로 재현을 확인했다(§6.27.1). §7에 남아 있다.

#### 6.28.1 머지 후 Codex 리뷰 라운드 (CR-034, 2026-08-25)

**다섯 지적이 전부 같은 모양이었다 — 함수는 있고 시험은 초록인데 운영이 부르지 않는다.** PR #35는 머지(`4b954d1`) 뒤 1분 만에 리뷰를 받았고, 그 다섯이 모두 "격리된 함수 시험 통과 + 운영 조립 누락"이라는 하나의 패턴이었다. WP-028의 "완료"는 **함수 존재**를 증명했지 **배포 도달성**을 증명하지 않았다. 그 감사에서 셋을 더 찾았다.

| 지적 | 심각도 | 운영 재현 | 근본 원인 | 수정 | 시험 | 변이 | 스레드 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| API-ADM-007 배포 미배선 | P1 | `apps/search-api/src/index.ts`의 `buildServer` 호출에 `integrity` 없음 → 배포된 인스턴스에 GET·POST 둘 다 404 | 조립이 어떤 시험에도 걸리지 않는 자리에 있었다. 통합 시험이 목을 직접 꽂아 가렸다 | `runtime.ts`의 `buildServerDeps` — **운영과 시험이 같은 함수를 부른다.** 미러 없이 `ApiCommitGraph` 재사용 | 단위 9 + 통합 2 + 회귀 | 배선 삭제 → 단위 1·통합 1·회귀 1 킬 | DEV-177 |
| `sequence_reassign` 러너 부재 | P1 | 잡 행이 `queued`로 영구 잔류, 이후 같은 공간 요청은 `JOB_CONFLICT` | claim하는 곳이 백필뿐 | `startSequenceRepairRunner` — `claimNextJob` 재사용, 수명주기를 행에 반영 | 통합 4 + 회귀 | start 삭제 → 회귀 1 킬 | DEV-178 |
| 조정 스캔 미기동 | P1 | `startReconcileSweeper` 호출 0건 → JOB-ING-005 완전 무동작 | 전용 역할이 없었다 | **`reconcile` 역할** 신설 + 기동 + shutdown | 회귀 | start·stop 삭제 → 회귀 2 킬 | DEV-179 |
| head 복구가 죽은 잡 생성 | P1 | `sequence_assign` 행이 영구 잔류하고 `findActiveJob`이 **이후 복구를 전부 막는다** | 집는 러너 없음 | `prs:sequence` → `sequence.requested` 살아 있는 경로로 발행 | 단위 4 + 회귀 | publish 삭제·잡 복원 → 회귀 1·단위 1 킬 | DEV-180 |
| 내용 대조가 내용을 안 봄 | P2 | `pr_number`만 비교 → `content` 종류 도달 불가 | 광고한 층이 없는 층이었다 | 정규 필드 SHA-256 지문 대조 (본문 제외) | 단위 7 | 대조 제거 → 단위 5 킬 | DEV-181 |
| **수동 복구가 중간 손상을 못 고침** | P1(추가) | `mergeBase(D,D)=D` → 손상 prefix 통째 복사, 재계산 0건 → 손상 잔존 + 에폭만 상승 | 자동 재작성 가정을 수동 복구에 그대로 씀 | `repairSequence` — 검증 prefix + 최초 불일치부터 재계산, 실행 시점 재판정 | 통합 9 (**실제 git**) | 전략 되돌림 → 통합 2 킬 | DEV-182 |
| **배포 manifest 부재** | P1(추가) | `sequence`·`reconcile` 역할이 배포될 경로 없음 | REL-001 이후 manifest가 추가되지 않았다 | 두 manifest 신설 (replica 1, `Recreate`) | 회귀 | manifest 삭제 → 회귀 4 킬 | DEV-183 |
| **백필이 정본을 안 남김** | P1(추가) | 백필 PR이 ES에만 존재 → **ADR-004 위반** + JOB-ING-008이 정상 문서를 `extra_in_es`로 오판 | `raw_event`를 남기지 않는 경로 | 마이그레이션 010 `pull_request_snapshot` (두 경로 공통, 색인보다 먼저) | 통합 7 + 회귀 | 기록 삭제 → 회귀 1 킬 | DEV-184 |

##### 운영 도달성 표 (CR-034)

**이 표가 이 CR의 산출물이다.** 선언 → 기동 → 종료 → 배포가 한 줄로 이어지지 않으면 그 기능은 배포에 없다.

| 기능 | 선언 트리거 | 운영 프로세스 | 역할 | Entrypoint 기동 | 의존 출처 | 종료 정리 | 배포 manifest | 통합 증거 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-ADM-007 GET | 운영자 요청 | search-api | - | `buildServer(buildServerDeps(` | `buildIntegrityDeps`(GHE 클라이언트 + `ApiCommitGraph`) | 프로세스 종료 | `search-api.yaml` | 통합 — 운영 조립으로 서버를 세워 404 아님 확인 |
| API-ADM-007 POST | 운영자 요청 | search-api | - | 위와 같음 | 위와 같음 | 프로세스 종료 | `search-api.yaml` | 통합 — `confirmation` 400, 202 잡 생성 |
| JOB-SEQ-002 수동 재채번 | `sequence_reassign` 잡 | pipeline-worker | `sequence` | `repairRunner = startSequenceRepairRunner(` | `sequenceDeps`(채번 소비자와 공유) | `repairRunner?.stop()` | `pipeline-worker-sequence.yaml` | 통합 — 실제 git 손상 → 복구 → `completed` |
| JOB-SEQ-003 정합성 점검 | 일 1회 스케줄 | pipeline-worker | `sequence` | `integritySweeper = startIntegritySweeper(` | `selectCommitGraph` | `integritySweeper?.stop()` | `pipeline-worker-sequence.yaml` | 단위 8 |
| JOB-ING-005 조정 스캔 | 1시간 스케줄 | pipeline-worker | **`reconcile`** | `reconcileSweeper = startReconcileSweeper(` | GHE 클라이언트 + ES + `backfill`(projectOne) + 버스 | `reconcileSweeper?.stop()` | `pipeline-worker-reconcile.yaml` | 단위 14 |
| head 시퀀스 복구 | 조정 스캔 내부 | pipeline-worker | `reconcile` | 위와 같음 (`deps.bus.publish`) | `prs:sequence` → JOB-SEQ-001 | 위와 같음 | 위와 같음 | 단위 — 토픽·파티션 키·페이로드 단언 |
| JOB-ING-008 정합성 감시 | 6시간 스케줄 | pipeline-worker | `project` | `consistencySweeper = startConsistencySweeper(` | ES + `pull_request_snapshot` | `consistencySweeper?.stop()` | `pipeline-worker-project.yaml` | 단위 17 |

##### 회귀 계층을 하나 더 세웠다

`regression/runtime-reachability.test.ts`는 **"선언한 기능이 배포에서 실제로 실행되는가"**만 묻는다. 문자열 검사라 정교하지 않지만, **"start를 지웠는데 아무 시험도 안 죽는 상태"보다는 낫다** — 그 상태가 이 CR의 원인이었다.

**첫 형태는 부족했다.** `toContain('startReconcileSweeper')`로 썼더니 호출을 지워도 `import` 줄이 남아 통과했다 — 변이 셋(M2·M3·M5)이 살아남았다. **호출 형태**(`reconcileSweeper = startReconcileSweeper(`)로 바꾸자 전부 잡혔다. WP-028의 N5와 같은 교훈이 다시 나왔다: **변이가 죽었다고 시험이 그 자리를 지키는 것은 아니고, 살아남았을 때가 시험을 고칠 때다.**

##### 전 계층 재검증

타입·lint·lint:deps 통과, 단위 **1235**(1 skipped), a11y 192, e2e **67**, 통합 **727**, 회귀 **57**, contrast 80쌍 전량 통과.

##### NOT RUN

- **실제 Kubernetes 적용** — 클러스터가 없다. manifest는 구조 정적 검증(YAML 파싱·역할·replica)과 회귀 시험으로만 확인했다. 배포 자체는 검증하지 않았다.
- **실제 GHE 대상 smoke** — 사내망 전제. 조정 스캔의 `direction: 'desc'` 왕복은 대역으로 검증했다.
- **JOB-SEQ-002 잡의 운영 실행** — 러너와 복구 로직은 실제 git·실제 PostgreSQL로 검증했으나, 배포된 워커가 큐를 비우는 것은 클러스터 부재로 미실행이다.

### 6.30 WP-068 검증 실행 기록

2026-08-25, 실제 PostgreSQL 16.13 + **실제 Elasticsearch 8.x** / Node 22.23.2.

**죽어 있던 기능 하나를 살렸다.** 네 색인 매핑이 `allowed_team_ids`를 선언하고 강제 필터의 `org_team` 경로와 `team:` 질의가 모두 그 값을 읽는데 **그것을 만드는 자리가 없었다**(DEV-114, CR-024가 2026-08-22에 등록). 그래서 `team:<slug>` 검색은 한 건도 맞히지 못했고, 접근 범위 500개를 넘어 `org_team`으로 전환된 사용자는 **팀으로만 볼 수 있는 비공개 저장소를 잃었다.** 실패 방향이 과소 허용이라 유출은 아니었지만 FR-AUTH-002 AC-6이 승인한 기능이 죽어 있었다.

**착수 감사가 계약 공백 셋을 찾았다** (CR-035). ① GHE 클라이언트의 조회 셋이 전부 **사용자 축**이라 "이 저장소의 팀"을 물을 수 없었다(DEV-185). ② `team` 표를 채우는 자리가 없어 **값이 있어도 slug가 ID로 옮겨지지 않았다**(DEV-186). ③ 소급 적용의 방아쇠가 정의되어 있지 않았다 — 웹훅은 게이트웨이가 받고 소급은 색인 작업이라 소유 프로세스가 다르다(DEV-187).

**계층별 결과.** 통합 `authz/team-scope.test.ts` 10건(정본 소유·정규화·무변경 판정·팀→저장소 역조회, GHE 동기화와 `team` 표 왕복, 값이 바뀔 때만 색인, GHE 실패가 등록을 되돌리지 않음, 조회 수단 부재 시 기존 값 보존, 팀 회수 소급) + `authz/team-scope-es.test.ts` **9건(실제 Elasticsearch)** 통과. 회귀 4건. 전체 통합 746건, 회귀 61건, 단위 1235건, a11y 192, e2e 67, contrast 80쌍.

**DoD 판정 — 실제 색인 왕복으로 확인했다.** 대역으로는 필드 이름 하나가 어긋나도 초록이 나고, 이 WP가 고치려는 결함이 정확히 그 종류였다(매핑도 질의 빌더도 있는데 값이 없어 아무것도 맞히지 못함).

| DoD | 확인 |
| --- | --- |
| `team:<slug>` 질의가 실제 투영 문서를 맞힌다 | 팀 ID로 문서를 고르고, 다른 팀으로는 맞히지 않는다 |
| 500 초과 `org_team` 경로가 팀으로만 보이는 비공개 저장소를 반환한다 | 팀 소속 사용자는 보고, 다른 팀 사용자는 못 본다 |
| 팀에서 제거된 사용자가 과거 문서를 더 이상 보지 못한다 | 소급 적용 후 그 문서가 결과에서 사라진다. 다시 부여하면 다시 보인다(양방향) |
| 소급 적용 후 `document_version`이 변하지 않는다 | 소급 전후로 문서 버전을 직접 읽어 같음을 확인 |
| 권한 매트릭스가 팀 경로를 포함한다 | explicit 무회귀 + `org_team` 팀 있음/없음/다른 팀 네 갈래 |

**구현 중 잡은 것: 소급 대상이 둘이 아니라 넷이다.** 처음에는 `markRepositoryArchived`가 쓰는 `ARCHIVABLE_ALIASES`를 그대로 재사용했는데 그것은 **두 색인**(`prs-pull-requests`·`prs-commits`)뿐이다 — `repository_archived`가 그 둘에만 있기 때문이다. 그러나 `allowed_team_ids`는 **네 매핑이 모두** 선언하고 강제 필터가 넷 모두에서 읽는다. 둘만 소급하면 **관계·릴리스 문서가 옛 권한을 그대로 들고 남고**, 팀에서 빠진 사용자가 그 문서를 계속 보게 된다 — 유출이다. `TEAM_SCOPED_ALIASES`로 분리했고, 통합 시험이 별칭 수를 직접 센다.

**변이 3종 (전부 적용 확인 후 실행, 전부 킬 후 원복).**

| # | 변이 | 킬 |
| --- | --- | --- |
| T1 | 소급을 두 색인(`ARCHIVABLE_ALIASES`)으로 되돌린다 | 회귀 1 + 통합 2 |
| T2 | `repositoryScope()`에서 팀을 뺀다 | 회귀 1 |
| T3 | 등록에서 `syncRepositoryTeams` 호출을 뺀다 | 회귀 1 |

**NOT RUN.** 실제 GHE 대상 `listRepositoryTeams` 호출은 사내망 전제라 이 환경에서 돌지 않는다 — 목으로 계약을 걸었다. 팀 웹훅의 실제 수신부터 소급까지의 전 구간은 게이트웨이·워커·색인이 함께 떠야 하므로 클러스터 부재로 미실행이며, 각 구간은 따로 검증했다.

#### 6.30.1 머지 후 Codex 리뷰 라운드 (CR-036, 2026-08-25)

**셋 중 하나는 접근 범위 유출이었다.** PR #39 머지 직후 도착한 리뷰 3건(P1 둘·P2 하나)이 전부 실결함이며, 그중 DEV-188은 **팀에서 회수된 구성원이 문서를 계속 볼 수 있는** 상태였다.

| 지적 | 심각도 | 운영 재현 | 근본 원인 | 수정 | 시험 | 변이 |
| --- | --- | --- | --- | --- | --- | --- |
| 소급 전에 저장소-팀 관계를 다시 읽어라 | **P1 (유출)** | 회수 사건에서 정본의 옛 배열을 그대로 색인에 씀 → 회수 미반영. 추가 사건은 역조회로 대상조차 못 찾음 | 방아쇠의 `repository_id`를 쓰지 않고 GHE에도 묻지 않았다 | GHE를 다시 읽고 `repository_id`를 함께 쓴다. 판정·쓰기를 `@prs/authz` 공유 구현으로 이동 | 단위 8 + 회귀 3 | 옛 값 되쓰기 → 단위 3, `repository_id` 무시 → 단위 1 |
| 색인 동기화 실패 뒤 재시도 경로를 남겨라 | P1 | 정본만 바뀐 채 남아 다음 동기화가 "바뀐 것 없음"으로 건너뜀 → 회수된 팀이 색인에 영구 잔류 | 부분 성공을 성공으로 처리 | 색인 실패 시 **정본을 되돌려** 다음 회차가 같은 차이를 다시 보게 한다 | 단위 2 | 되돌림 제거 → 단위 2 |
| 마이그레이션 이전 저장소를 백필하라 | P2 | 기존 행이 빈 배열이고 채우는 경로가 재등록뿐. 웹훅 역조회도 빈 배열이라 못 찾음 | 백필 경로 부재 | 조정 스캔(JOB-ING-005)이 주기적으로 메운다 — 새 잡을 만들지 않는다 | 회귀 1 | — |

**공유 구현으로 옮긴 이유.** 등록 경로(search-api)와 팀 웹훅 경로(pipeline-worker)가 같은 동기화를 하는데 앱은 서로를 가져올 수 없다. 각자 구현하면 **한쪽만 고쳐지는 날**이 오고, 접근 범위에서 그것은 유출이다. `@prs/authz`에 두고 색인 클라이언트는 포트로 받는다 — `scope-source.ts`가 `GitHubClient`에 대해 하는 것과 같은 방식이라 이 패키지가 색인 타입에 묶이지 않는다.

**SQL 백필은 불가능하다.** 팀은 GHE에 물어야 알 수 있으므로 마이그레이션이 채울 수 없다. 이미 저장소를 한 바퀴 도는 정기 정비(JOB-ING-005)에 얹는 것이 새 잡을 만들지 않는 유일한 길이었다.

**전 계층 재검증.** 타입·lint·lint:deps, 단위 **1243**(1 skipped), a11y 192, e2e 67, 통합 746, 회귀 **64**, contrast 80쌍 전량 통과. **변이 3종 전부 킬.**

**NOT RUN.** 실제 GHE `listRepositoryTeams` 호출과 팀 웹훅 수신부터 소급까지의 전 구간은 사내망·클러스터 전제라 이 환경에서 돌지 않는다 — 각 구간은 따로 검증했다.

### 6.32 CR-037 머지 후 정합성·권한 정정 (WP-028 · WP-068)

**머지된 네 PR에 리뷰 지적 10건이 열려 있었고, 전부 실결함이었다.** PR #37 7건 · #40 1건 · #36 1건 · #38 1건. 넷은 P0급이다 — 회수된 팀 접근이 되살아나는 경주, 움직인 head를 되돌리는 수동 복구, 접근 통제 필드를 보지 않는 정합성 지문, 취소를 무시하는 잡 러너.

이 라운드의 성격은 CR-034와 다르다. CR-034는 **"함수는 있는데 운영이 부르지 않는다"**였고, 이번은 **"운영이 부르는데 동시성·권한 경계에서 틀린 답을 낸다"**이다. 전자는 도달성 계층이 잡았고, 후자는 **실제 PostgreSQL·실제 git으로 경주를 재현해야** 잡힌다.

| DEV | 지적 | 심각도 | 운영 재현 | 근본 원인 | 수정 | 시험 | 변이 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 191 | 팀 접근 범위 쓰기를 저장소 단위로 직렬화하라 | **P0 (유출)** | 등록·팀 웹훅·조정 스캔이 겹치면 각자 다른 GHE 스냅숏을 읽고 조건 없이 덮어씀 → 늦게 끝난 옛 호출이 회수를 되돌려 **제거된 팀 ID가 색인에 복원** | 잠금이 아예 없었다. 권한 스트림은 `team_id`로만 파티션되어 다른 진입점에 닿지 않는다 | GHE 조회~색인 반영을 **저장소 단위 세션 advisory lock**으로 묶는다. 조회가 락 안에 있는 것이 핵심 | 통합 3(실 PG) + 단위 3 | 직렬화 제거 → 통합 2 (회수 팀이 되살아나고 동시 조회가 3) |
| 192 | 락 획득 뒤 head를 다시 확인하라 | **P0** | 그래프 walk 중 정상 채번이 head를 D→E로 전진시켜도 `seq_epoch`는 그대로 → 옛 head로 `advanceHead` → **head가 뒤로 가고 E 누락** | 에폭만 검사했다. `advanceHead`는 에폭을 올리지 않는다 | 울타리 셋: 분석 근거를 walk 전에 고정, 락 아래에서 저장 head 대조, **커밋 직전 실제 Git head 재확인** | 통합 3(실 git) | 세 검사를 각각 지우면 전부 킬 |
| 193 | 지문에 접근 통제 필드를 넣어라 | **P0** | 저장소 이전·공개 범위 변경·색인 손상으로 두 쪽이 어긋나도 `consistent`로 보고 | `CANONICAL_FIELDS`에 `org_id`·`visibility`·`allowed_team_ids`가 없었다 | `FINGERPRINT_FIELDS` 하나를 PG·ES가 공유. 기대값의 범위는 **`repository` 표에서 합성** | 단위 7 | 세 필드 제거·레지스트리 덮어쓰기 제거 → 각각 킬 |
| 194 | 기존 문서의 스냅숏을 채워라 | P1 | 업그레이드 시 기존 PR이 색인에만 남고 스냅숏을 영영 못 얻음 → ADR-004 불성립 + `extra_in_es` 오보 | 마이그레이션 010이 빈 표로 시작하고 채우는 경로가 없었다 | JOB-ING-010 — 재개 가능한 부트스트랩. 백필의 러너·커서·클라이언트를 **유형만 바꿔** 재사용, 색인은 건드리지 않는다 | 통합 11(실 PG) | 부트스트랩 실행·예약 상한·부분 완료 기록 → 각각 킬 |
| 195 | 부트스트랩 전 상태를 손상으로 부르지 마라 | P1 | 스냅숏 없는 저장소가 `count`·`extra_in_es`로 보고되어 멀쩡한 색인을 의심하게 함 | 두 사실을 한 이름으로 불렀다 | `snapshot_bootstrap_pending`으로 가른다. 자동 삭제는 여전히 금지 | 단위 5 + 통합 2 | 구분 제거 → 단위 2 + 통합 1 |
| 196 | 실행 중 잡의 취소를 보존하라 | P1 | 운영자가 `cancelled`로 바꿔도 러너가 `completed`로 덮고 비가역 복구도 계속 진행 | `finishJob`이 무조건 UPDATE | `finishJobIfRunning` — 전이 조건을 **UPDATE의 WHERE 절**에 둔다. 시작 전 예비 검사도 추가 | 통합 2 | 조건부 완료 제거·시작 전 검사 제거 → 각각 킬 |
| 197 | 수동 복구 후 `EVT-SEQ-002`를 발행하라 | P2 | 에폭이 올라 이전 인용이 전부 무효인데 알림·투영 소비자가 못 받음 | 자동 경로에만 있었다 | 발행 절차를 **작은 공유 헬퍼**로. 알고리즘은 합치지 않는다 — 두 경로는 시작 조건이 다르다 | 통합 1 | 수동 경로 발행 제거 → 킬 |
| 198 | `reassigning`을 트랜잭션 밖에서 보이게 하라 | P2 | 긴 재구축 내내 조회가 옛 에폭을 **정상이라고** 냄 | `bumpEpoch`가 트랜잭션 안에서 세우고 같은 트랜잭션의 `advanceHead`가 즉시 되돌림 | 자동 경로처럼 `markReassigning`을 먼저 따로 커밋. 중단 갈래는 `restoreSequenceState`로 되돌린다 | 통합 1 | 사전 커밋 제거 → 킬 |
| 199 | 그래프 실패를 `stale`로 남겨라 | P2 | 손상 가능성이 있는 공간이 계속 `ok`로 광고됨 | `stale` outcome을 반환만 하고 `markStale`을 부르지 않았다 | 롤백 **이후** 별도 커밋으로 기록. 서수 값은 보존 | 통합 1 | 영속 제거 → 킬 |
| 200 | 문서 상태를 원장과 맞춰라 | P2 | 후속 에이전트가 작업 패키지를 기준으로 판단하면 끝난 WP를 다시 하거나 의존성을 잘못 읽음 | 원장만 갱신하고 작업 패키지를 두었다 | WP-027 플레이스홀더를 git에서 확인한 실제 SHA로 교체. 실행 순서표 **22행**을 원장 기준으로 정정 | — | — |

#### 이 라운드가 스스로 찾은 것

| DEV | 무엇 | 어떻게 드러났나 |
| --- | --- | --- |
| 200 | **문서 어긋남이 2행이 아니라 22행이었다** | 리뷰는 WP-028만 지적했다. 두 문서의 상태 칸을 기계적으로 대조해 보니 WP-002~016·WP-024~027도 전부 `todo`로 남아 있었다 — 지적된 것만 고쳤으면 같은 결함이 20행 남았다 |
| 201 | `upsertTeam`이 동시 삽입에서 터진다 | 팀 접근 범위 경주 시험을 쓰다가 `team_org_id_slug_key` 위반으로 실패했다. `team`에는 유니크 제약이 **둘**인데 하나만 중재해, 팀을 공유하는 두 저장소가 **처음으로** 함께 동기화되면 23505다 |

#### 왜 프로세스 내부 mutex가 아닌가 (DEV-191)

워커 복제본이 여럿이고 등록 경로는 **아예 다른 프로세스**다. 정확성 경계가 프로세스 안에 있지 않으므로 `Map`·`Promise` 기반 잠금은 이 결함을 고치지 못한다. 타임스탬프 비교만으로도 안 된다 — 비교할 시각을 두 호출이 각자 다른 스냅숏에서 읽기 때문이다.

**세션 락을 쓴 이유**는 GHE 왕복을 감싸야 하기 때문이다. 트랜잭션 범위 락이면 네트워크 왕복 내내 트랜잭션이 열려 있어야 하고, 그것은 커넥션과 스냅숏을 GHE 응답 시간만큼 붙잡는다. 락을 쥔 커넥션이 정본 쓰기도 한다 — 풀에서 두 번째 커넥션을 얻으려 하면 **모든 커넥션이 락을 기다리는 상황에서 교착**이 된다.

#### 왜 마이그레이션이 부트스트랩하지 않는가 (DEV-194)

스냅숏 내용은 GHE만 답할 수 있다. 마이그레이션 안에서 네트워크를 부르면 **되돌릴 수도 재개할 수도 없는 배포 단계**가 된다. 012는 스키마만 넓히고(잡 유형 + `snapshot_bootstrapped_at`), 채우기는 커서로 재개되는 잡이 한다. **기존 마이그레이션 010·011은 고치지 않았다** — 이미 적용된 환경에서 다시 돌지 않으므로 넓히는 변경은 언제나 새 번호다 (DEV-172의 선례).

예약과 러너를 **같은 역할에 함께** 세웠다. 예약만 하고 집는 러너가 없으면 잡 행이 영구 `queued`로 남고 `job_active_uk`가 이후 요청을 전부 막는다 — **DEV-178·DEV-180이 정확히 그 모양의 결함이었다.** 운영 도달성 회귀가 그 연결을 지킨다.

#### 운영 도달성 (CR-034 계층 유지 + JOB-ING-010 추가)

| 기능 | 선언 | 기동 | 종료 | 배포 manifest |
| --- | --- | --- | --- | --- |
| API-ADM-007 GET/POST | `ops/routes.ts` | `runtime.ts` `buildServerDeps` | — | `search-api.yaml` |
| `sequence_reassign` 러너 | `sequence-repair-runner.ts` | `roles.includes('sequence')` | `repairRunner?.stop()` | `pipeline-worker-sequence.yaml` |
| 정합성 점검 스윕 | `integrity.ts` | `roles.includes('sequence')` | `integritySweeper?.stop()` | `pipeline-worker-sequence.yaml` |
| 조정 스캔 | `reconcile.ts` | `roles.includes('reconcile')` | `reconcileSweeper?.stop()` | `pipeline-worker-reconcile.yaml` |
| **정본 스냅숏 부트스트랩 (신규)** | `snapshot-bootstrap.ts` | `roles.includes('reconcile')` | `snapshotBootstrapRunner?.stop()` | `pipeline-worker-reconcile.yaml` |
| PG↔ES 정합성 감시 | `consistency.ts` | `roles.includes('project')` | `consistencySweeper?.stop()` | `pipeline-worker-project.yaml` |

#### PR #41 리뷰 라운드 (DEV-202·203·204)

**이 CR의 PR 자체에도 P1 셋이 도착했고 전부 실결함이었다.** 셋 다 이번 라운드가 새로 만든 코드의 결함이며, 공통점이 하나 있다 — **"실패해도 성공으로 세는 자리"**다.

| 지적 | 무엇이 틀렸나 | 수정 |
| --- | --- | --- |
| 남의 재채번 상태를 되돌리지 마라 | 표시를 락보다 먼저 커밋해 소유권 없이 되돌릴 수 있었다 | 락을 잡고 울타리를 통과한 뒤에 표시한다. 진 쪽은 표시한 적이 없다 |
| 부분 보강 스냅숏을 거절하라 | 반쪽 문서가 같은 버전으로 완전한 스냅숏을 덮고, 그러고도 성공으로 세어졌다 | 부트스트랩 모드에서는 쓰지 않고 실패로 센다 |
| 완결 표시 전에 커버리지를 확인하라 | `updated` 정렬 페이지네이션이 항목을 건너뛴 채 `completed`가 될 수 있었다 | 부트스트랩은 `created` 정렬로 전량 열거한다 |

**교훈은 CR-034와 같은 계열이다.** 그때는 "함수가 있는데 운영이 부르지 않는다"였고, 이번 라운드에서 내가 만든 것은 **"잡이 완료라고 말하는데 실제로는 다 하지 않았다"**였다. 완료를 선언하는 코드는 그 선언의 근거를 함께 갖고 있어야 한다.

**변이 검증에서 두 번 되돌아갔다.** M-202의 첫 형태(락 안 표시만 제거)와 M-204의 첫 형태(러너 옵션 제거)가 **살아남았다** — 시험이 `runBackfillJob`을 직접 부르며 옵션을 넘기고 있어 **러너가 그것을 실제로 전달하는지**를 증명하지 않았기 때문이다. 운영 러너를 그대로 띄우는 시험으로 고쳤다. WP-028의 N5·CR-034가 배운 것이 또 나왔다: **변이가 살아남았을 때가 시험을 고칠 때다.**

**전 계층 재검증.** 타입·lint·lint:deps 통과, 단위 **1258**(1 skipped), a11y **192**, e2e **67**, 통합 **772**, 회귀 **70**, contrast 80쌍, `pnpm build` 통과. **변이 20종 전부 킬.** 문서 validator `--strict`는 기존 플레이스홀더 2건(9+5)으로 변화 없다.

**NOT RUN.** 실제 GHE 대상 부트스트랩·팀 조회, 실제 Kubernetes 적용은 사내망·클러스터 전제라 이 환경에서 돌지 않는다. 배포 manifest는 정적 검증까지다. `flow-001` 간헐 실패는 이번 실행에서 재현되지 않았다(67/67 통과).

### 6.33 WP-067 커밋 메타데이터 보강 검증 기록 (CR-038)

**착수 전 감사에서 다섯을 찾았고, 그것이 이 WP의 성격을 바꿨다.** 원래 계약은 "기존 커밋 문서를 부분 갱신한다"였다. 그대로 구현하면 코드는 늘고 **사용자에게 보이는 것은 하나도 달라지지 않는다** — 조사 품질을 실제로 떨어뜨리는 커밋(직접 푸시)에는 문서 자체가 없고, 채운 값을 읽어 주는 화면 경로도 없기 때문이다.

| DEV | 감사에서 무엇을 확인했나 | 어떻게 풀었나 | 시험 |
| --- | --- | --- | --- |
| 205 | `consumerGroup(topic)`이 토픽당 하나를 돌려주고 `prs:projected`의 값은 `link`다. 커밋 보강이 그대로 구독하면 **broadcast가 아니라 work sharing**이 되어 둘 다 절반씩 놓친다 | 토픽별 논리 소비자 카탈로그. 두 번째 이후 소비자가 `<기본>:<이름>` 그룹을 얻는다. **기본 이름은 바꾸지 않았다** — Redis에서 읽던 자리를 잃는다 | 실제 Redis 통합 2건 + 단위 4건 |
| 206 | `buildCommitDocuments`는 `source_commit_shas`와 머지 커밋만 쓰고, 시퀀스 투영도 `update_by_query`뿐이라 없는 문서를 만들지 않는다. **직접 푸시 커밋은 영원히 검색 불가**였고 `EVT-ING-003`은 문서 투영 **뒤에** 나오므로 방아쇠가 될 수 없다 | 방아쇠를 넷으로 넓히고 `sequence.assigned`의 `from_seq..to_seq`를 쓴다 — 그것이 새로 채번된 first-parent 구간이고 `merge_sequence`가 SHA를 갖는다. 색인에 없는 first-parent 커밋은 **문서를 만든다** | 통합 4건(실 git·PG·ES) |
| 207 | `direct_push` 판정 근거가 없었다. PR 연결이 그 순간 `null`이라는 이유로 확정하면 push/PR 투영 경주에서 **정상 머지 커밋이 직접 푸시로 굳는다** | 근거를 요구한다(first-parent + 알려진 매핑 없음). 역할을 매번 정본에서 다시 계산해 **매핑이 생기면 `merge_commit`으로 교정**된다 | 통합 2건 |
| 208 | 커밋 엔티티의 PostgreSQL 정본이 **없다**. 색인에만 쓰면 ADR-004가 커밋 축에서 깨진다 — CR-034가 PR 축에서 겪은 것과 같은 모양 | 마이그레이션 013 `commit_snapshot`. 정본을 색인보다 먼저 쓴다. 소스 코드·patch 본문은 **어떤 열에도** 담지 않는다 | 통합 1건(색인 삭제 후 재구성 근거 확인 + 열 이름 검사) |
| 209 | 커밋 문서의 `document_version`은 **PR 웹훅의 버전**이다 — 엔티티가 다른데 버전을 공유한다. 갱신 경계가 정의되어 있지 않았다 | 메타데이터는 불변 git 사실이라 버전을 올리지 않는다. 기존 조건부 스크립트로는 버전을 안 올리면 대입도 안 되므로 전용 경로를 뒀다. 새 문서의 초기 버전은 **커밋 시각** | 통합 2건 |
| 210 | 커밋 상세가 저장된 메타데이터를 반환하지 않는다 — 채워도 화면은 SHA만 보인다 | 응답에 연결. 값이 없으면 **키를 넣지 않는다** | 통합 1건 |
| 211 | PR 상세 `source_commits`가 `{ commit_sha }`만 만든다 | 커밋 문서와 **조회 한 번으로** 조인. 제목은 첫 줄만 | 단위 2건(호출 횟수를 직접 센다) + 통합 2건 |
| 212 | 선행·후행의 직접 푸시 행이 PR 문서만 표시 소스로 읽어 **SHA만 보이는 행**이 된다 | 커밋 문서와 batch join. `indexed`도 그 행의 표시 소스로 판정한다 | 통합 3건 |
| 213 | 새로 만드는 문서의 접근 통제 material이 정의되어 있지 않았다 | 생성 시점에 함께 싣는다. 먼저 만들고 나중에 채우지 않는다 (fail closed) | 통합 2건(범위 밖 커밋 비노출 포함) |
| 214 | 운영 도달성이 계약에 없었다. **미러 역할에는 배포 manifest 자체가 없었다** — JOB-MIR-002가 배포에 도달할 수 없다 | 미러 역할이 소유한다(정답지가 미러다). `pipeline-worker-mirror.yaml` 신설(PVC 포함). 회귀가 선언 → 소비자 그룹 → 역할 → 기동 → 종료 → manifest를 잇는다 | 회귀 6건 |

#### 왜 `EVT-ING-003`만으로는 안 되는가 (DEV-206)

이 감사에서 가장 값이 컸던 발견이다. 계약이 그 이벤트를 방아쇠로 적고 있었는데, **그 이벤트는 커밋 문서 투영의 결과로 나온다.** 문서가 없는 커밋에 대해서는 애초에 발생하지 않으므로, 그것만 구독하면 "이미 문서가 있는 커밋만 보강한다"가 되어 정확히 고치려던 문제를 비껴간다. 채번은 다르다 — `merge_sequence`가 **first-parent 체인 전부**를 알고 있고 직접 푸시 커밋도 거기 있다.

#### `patch_id`를 잃지 않는다

미러가 한 번 계산해 준 값을, 나중에 API 폴백으로 돈 회차가 `no_mirror`로 덮지 않는다. 능력이 없는 쪽이 있는 쪽을 지우면 체리픽 파생(WP-030)이 근거를 잃는다.

#### 운영 도달성 (CR-034 계층에 JOB-MIR-002 추가)

| 기능 | 선언 | 소비자 그룹 | 기동 | 종료 | 배포 manifest |
| --- | --- | --- | --- | --- | --- |
| JOB-MIR-002 보강 | `commit-enrich.ts` | `link:commit-enrich` | `roles.includes('mirror')` | `commitEnrichSubscription?.close()` | `pipeline-worker-mirror.yaml` |
| JOB-MIR-002 스윕 | `commit-enrich.ts` | — (주기) | `roles.includes('mirror')` | `commitEnrichSweeper?.stop()` | `pipeline-worker-mirror.yaml` |

**전 계층 검증.** 타입·lint·lint:deps 통과, 단위 **1264**(1 skipped), a11y **192**, e2e **67**, 통합 **804**, 회귀 **82**, contrast 80쌍, `pnpm build` 통과. **변이 9종 전부 킬** — 전용 소비자 그룹·직접 푸시 문서 생성·접근 범위 material·정본 저장·초기 버전·메타데이터의 버전 불변·`sequence.assigned` 방아쇠·`source_commits` batch·이웃 커밋 조인을 각각 지우면 시험이 깨진다.

**NOT RUN.** 실제 GHE 대상 커밋 조회(API 폴백 경로의 실연동)와 실제 Kubernetes 적용. 사내망·클러스터 전제라 이 환경에서 돌지 않으며, API 폴백은 실제 git이 낸 값을 GHE 응답 모양으로 바꾼 대역으로 미러 경로와 대조했다(DoD 1).

### 6.34 WP-029 참조 간선 파생 검증 기록 (CR-039)

**착수 전 감사에서 열다섯을 찾았고 다섯이 같은 뿌리다** — 계약이 **"만든다"만 말하고 "다시 만든다"를 말하지 않는다.** 참조는 본문에서 파생되는데 본문은 수정되고, 대상은 나중에 색인되며, 과거 데이터는 이벤트를 남기지 않았고, 실패한 것은 누군가 다시 해야 한다.

| DEV | 감사에서 무엇을 확인했나 | 어떻게 풀었나 | 시험 |
| --- | --- | --- | --- |
| 215 | JOB-REL-001·005의 방아쇠가 `EVT-ING-003` 하나인데, 직접 푸시 커밋 문서는 `project`가 만들지 않는다. `commit-enrich.ts`에 `bus.subscribe`는 하나 있고 **`bus.publish`가 하나도 없다** — 그 커밋의 참조는 영원히 간선이 되지 않는다 | `EVT-ING-005 commit.metadata_ready` 신설. **정본·색인이 모두 성공한 뒤에만** 낸다. payload는 bounded 식별자뿐이고 본문을 버스에 다시 싣지 않는다 | 통합 1건(실 git·PG·ES·버스로 채번→보강→정본→색인→신호→파생 전 사슬) + 회귀 3건 |
| 216 | 그 신호를 `prs:projected`에 실으면 커밋 보강이 **자기 이벤트를 되받는다** — 같은 토픽을 `link:commit-enrich` 그룹으로 읽고 있다 | 토픽을 새로 만들지 않고 `event_name`으로 가른다. 보강은 이 이벤트를 받아 이것을 다시 내지 않는다 | 통합 1건(실 버스로 이벤트가 멎는지 본다) + 회귀 1건 |
| 217 | `link_id` 재료에 가변 `to_id`가 들어 있다(세 곳에 같은 문장). 축약 SHA 참조가 해결되면 대상이 40자로 바뀌어 **ID가 함께 바뀌고**, 미해결 간선과 해결된 간선이 둘 다 남는다 — AC-3·멱등·결정론적 ID가 한 번에 깨진다 | `references` 간선에 **해결 대상과 독립인 `reference_key`**. 안정 ID는 `link_type` + source + `reference_key`다 | 단위 5건 + 통합 3건(**문서 `_id`가 같은지를 직접 본다**) |
| 218 | 커밋 매핑에 `links_pending`이 없다. 매핑이 `strict`라 FR-REL-003의 예외 처리를 커밋에 대해 **표현할 수단이 없었다** | 매핑에 추가 | 통합 1건(실 ES가 거부하지 않는지) |
| 219 | 커밋 매핑 `link_summary`에 `reference_count`가 없다 — 핫패스 비정규화가 커밋 축에서만 성립하지 않는다 | 매핑에 추가 | 통합 1건 |
| 220 | 본문에서 사라진 참조를 지울 계약이 없다. `Refs: #10` → `Refs: #20`이면 `#20`이 생기지만 **`#10`이 남는다** | 한 source의 참조를 **완전한 파생 집합**으로 다룬다. 정본에서 다시 만들고 나머지를 제거. **추출·쓰기가 실패한 회차는 제거하지 않는다** | 통합 3건(V1→V2→V3, 다른 source 불변, 실패 회차 보존) |
| 221 | 과거 엔티티에 간선을 만들 경로가 없다. Redis stream retention은 정본이 아니고, WP-029 이전 직접 푸시 커밋에는 `EVT-ING-003`이 애초에 없었다 | 이미 있는 **JOB-REL-006**을 references subset에 대해 실행 가능하게. PostgreSQL 정본에서 재개 가능·경계 있는 열거, **같은 파생 핸들러** | 통합 3건(이벤트 0건인 과거 데이터·PG-only 재구축·결정론) + 회귀 1건 |
| 222 | `link_summary`의 leaf 소유가 갈리는데 조건부 스크립트는 **객체를 통째 대입**한다 — WP-029가 참조 수만 고쳐도 WP-030의 네 값이 사라진다 | leaf 단위 대입 전용 스크립트. 숫자는 `equals`로 비교하지 않는다(painless에서 `Integer(3).equals(Long(3))`은 거짓이다) | 통합 1건(WP-030 값 넷을 미리 심고 살아남는지) |
| 223 | `to_repository_id`·`detached`의 소유 WP가 없다 | `to_repository_id`는 WP-029, `detached`는 WP-030. **WP-029는 `detached`를 두지 않는다** — `strict` 매핑에서 값을 두지 않는 것과 `false`를 두는 것은 다른 주장이다 | 통합 1건 |
| 224 | 저장소를 건너뛰는 참조의 접근 통제 경계가 문서에 없다. 간선이 `to_repository_id`를 들고 있으므로 조회가 대상의 내용을 함께 반환하면 **대상 저장소를 볼 수 없는 사용자에게 샌다** | THR-034~036 신설. **간선의 범위는 source의 것**이며, 대상 내용을 반환하려면 대상 범위를 다시 교집합해야 한다 — WP-031의 필수 수용 기준으로 남겼다 | 통합 3건(대상 팀이 새어 들어오지 않는지 포함) |
| 225 | `LinkSummary`·`CommitRole`·`Link` 셋이 실제 매핑과 어긋난다. `documents.ts`가 **자기 `CommitRole`을 따로 정의해** 타입 검사가 드리프트를 잡지 못했다 | 정의를 하나로 모으고 투영은 `Extract`로 좁힌다 | `pnpm typecheck` |
| 226 | ADR-009 자신이 구현과 어긋난다(`direction` 존재, 접근 통제 필드 부재, `reverted_by_count`) | 결정을 뒤집지 않고 **적힌 것을 구현에 맞춘다**. `reference_key`는 이미 한 결정을 성립시키는 수단이므로 새 ADR을 만들지 않았다 | 문서 |
| 227 | `link` 모듈이 API-REL-001~004 전체를 소유한다고 적혀 있으나 001·002는 이미 다른 WP가 구현했다 | 모듈 표를 API-REL-003·004로 정정하고 사유를 남겼다 | 문서 |
| 228 | `retry` 예산을 집행하는 주체가 없다. 두 어댑터 모두 상한을 보지 않는다. **`release.ts`가 실제로 그 상태였다** — PR #30의 P1 지적이 미해결로 남아 있었다 | 예산을 핸들러가 `delivery_count`로 집행한다고 계약에 명시하고, link 핸들러와 `release.ts`를 함께 고쳤다 | 통합 4건(두 파일 각각 예산 안/소진) |
| 229 | `work_packages.md` 헤더가 `v0.3 / 2026-08-20`에 멈춰 있다 | v0.4 / 2026-08-26 | 문서 |

#### 왜 `reference_key`가 필요한가 (DEV-217)

이 감사에서 값이 가장 컸던 발견이다. FR-REL-003 AC-3은 "대상 색인 시 해결 상태로 **갱신**한다"를 요구하는데, 문서에 적힌 `link_id` 재료(`{link_type}:{from_type}:{from_id}:{to_type}:{to_id}`)가 그것을 **불가능하게** 만들고 있었다. `Refs: abc1234`는 미해결일 때 축약 SHA를, 해결 뒤에는 40자 SHA를 대상으로 갖는다 — ID가 함께 바뀌면 갱신이 아니라 새 문서가 되고 미해결 간선이 그대로 남는다.

`reference_key`는 **본문이 말한 것**만으로 정규화한다. 원문 그대로가 아니고(같은 저장소의 `#20`과 `acme/a#20`이 같은 키로 접힌다), 저장소 등록 상태에도 의존하지 않는다(나중에 등록돼도 키가 바뀌지 않는다). 역방향 조회는 커밋 하나당 후보가 **일곱**(전체 하나 + 접두 여섯)으로 상한이 있어 `terms` 하나면 된다 — 미해결 간선 전량을 스캔하지 않는다.

#### 운영 도달성 (CR-034 계층에 JOB-REL-001·006 추가)

| 기능 | 선언 | 소비자 그룹 | 기동 | 종료 | 배포 manifest |
| --- | --- | --- | --- | --- | --- |
| JOB-REL-001·005 파생·해결 | `link.ts` | **`link`**(기본) | `roles.includes('link')` | `linkSubscription?.close()` | `pipeline-worker-link.yaml` |
| JOB-REL-006 전량 재파생 | `link.ts` | — (잡 claim) | `roles.includes('link')` | `referenceRebuildRunner?.stop()` | `pipeline-worker-link.yaml` |

manifest는 `deploy/k8s/README.md`의 **적용 순서 블록**에도 들어 있다 — 파일만 있고 목록에 없으면 운영자가 끝내 만들지 않는다(CR-038 / PR #42 리뷰가 배운 것).

#### 검증 배터리 (main `3e3009b` 대비)

| 계층 | 결과 |
| --- | --- |
| `pnpm typecheck` | 통과 |
| `pnpm lint` · `lint:deps` | 통과 (패키지 13, 위반 0) |
| `pnpm run test` | 단위 **1316** 통과 (1 skipped) [1264 → +52] |
| `pnpm run test:integration` | 통합 **841** 통과 [809 → +32] |
| `pnpm run test:regression` | 회귀 **102** 통과 [83 → +19] |
| `pnpm run test:a11y` | 192 통과 (axe 0건) |
| `pnpm run test:contrast` | 80쌍 통과 |
| `pnpm build` · `pnpm --filter @prs/web run build` | 통과 |
| `pnpm run test:e2e` | **67 통과** — 이번 실행에서는 `flow-001` 간헐 실패가 재현되지 않았다 |
| `validate_srs_prd_env.py --strict` | 오류 2건(9+5) — **기준선과 동일**, 신규 0 |

#### 변이 시험 — 결함 재적용 29종 킬, 등가 2종

| 변이 | 결과 |
| --- | --- |
| `link_id`에 무작위 요소 / `reference_key` 제거 | 킬 (해결 전후 `_id`가 달라진다) |
| stale 제거 삭제 / 실패 회차를 완결로 처리 | 킬 |
| 중복 제거 · derived 우선 · 100건 상한 · 펜스 제외 · 인용 제외 제거 | 킬 (단위) |
| 접두 유일성 검사를 first-match로 | 킬 |
| `link_summary` leaf 대입을 객체 통째 대입으로 | 킬 |
| ready 신호 발행 제거 | 킬 (직접 푸시 간선이 사라진다) |
| 되먹임 가드 제거 **+ metadata_ready를 보강 대상으로** | 킬 (실 버스에서 이벤트가 멎지 않는다) |
| link 역할 기동·종료·역할 분기·manifest·README 적용 순서 제거 | 킬 (회귀 5종) |
| 소비자 그룹을 `commit-enrich`와 공유 | 킬 |
| 재파생에서 파생 핸들러 호출 제거 | 킬 |
| `allowed_team_ids`·`visibility`·`org_id` 제거 | 킬 |
| `created_at`을 `now()`로 | 킬 |
| `markPending`이 참조 수를 덮어씀 / 완결 회차가 `links_pending`을 세움 | 킬 |
| link 핸들러·`release.ts`의 재시도 예산 제거 | 킬 (**행동으로** — 텍스트 단언이 아니다) |

**등가 변이 둘을 킬로 세지 않았다.**

1. **되먹임 가드만 제거** — 그것만으로는 루프가 나지 않는다. `commit.metadata_ready`의 payload에 `entity_kind`가 없어 보강의 다음 갈래가 스스로 ack하기 때문이다. 가드는 그 사실을 **명시**하고 DB 왕복을 아끼는 것이며, 존재 자체는 회귀가 건다. 진짜 루프를 만드는 변이(가드 제거 + 그 이벤트를 보강 대상으로)는 킬됐다.
2. **정본 부재 가드 제거** — 뒤따르는 `extractReferences` 호출이 `TypeError`를 던지고 그것을 같은 함수의 `try/catch`가 잡아 `markPending`으로 수렴한다. 관측 가능한 결과가 같다. 운영에서 스냅숏이 삭제되는 경로가 없으므로 두 상태를 가르는 시나리오 자체가 도달 불가다.

#### 변이 시험이 찾아 준 것 — 내 결함 하나

`markPending`이 `reference_count`에 `-1`을 쓰고 있었다. 완결을 보장할 수 없는 회차가 **세지 못한 수를 어떤 값으로든 적으면 그 값이 거짓말이 된다** — 화면은 그 수를 "이 문서의 참조는 N건"으로 읽는다. 참조 수를 선택 필드로 바꿔 그 회차는 `links_pending`만 세우게 했다. 변이(`referenceCount: 0`을 다시 넣기)가 킬되는 것으로 확인했다.

#### Gate 4 보안 증거 (부분)

| 항목 | 결과 |
| --- | --- |
| 시크릿 스캔 | **전용 도구 없음** — `gitleaks`·`trufflehog`·`detect-secrets` 모두 이 환경에 없다. 추적 파일 전량에 대해 패턴 기반 스캔(GitHub 토큰 접두 6종, PEM 개인 키, AWS 키, Slack 토큰, 자격 증명 키=값)을 돌렸다. 적중 2건은 **가림(redaction)이 동작하는지 확인하는 시험 픽스처**이고, `secret.example.yaml`·`.env.example`은 자리표시자·로컬 개발값뿐이다. **전용 도구 스캔은 NOT RUN** |
| 위협 모델 재검토 | THR-034·035·036 신설 — 대상 저장소 내용 유출, 접근 통제 없는 간선 생성, 승인되지 않은 호스트 URL 오인. 신규 코드에 자격 증명·토큰 취급 경로가 없음을 확인했고, `evidence`는 200자 상한 + `index: false`라 본문 사본이 되지 않는다 (NFR-005) |
| 권한 매트릭스 78셀 | **미완** — 화면 13종 축은 화면이 더 서야 걸 수 있다 |

**Gate 4는 `fail`을 유지한다.** 두 항목을 채웠다고 게이트가 통과하지 않는다 — 화면 축이 남아 있다.

#### 6.34.1 PR #44 리뷰 라운드 — 여섯 전부 실결함

CI가 초록이 된 뒤 Codex 리뷰가 P1 셋·P2 셋을 냈다. **여섯 전부 코드로 재현했다.** 넷이 이 저장소가 이미 두 번 배운 모양이다 — **"실패했는데 아무도 다시 하지 않는다."**

| # | 등급 | 지적 | 재현 근거 | 정정 |
| --- | --- | --- | --- | --- |
| 1 | P1 | **JOB-REL-006을 시작할 방법이 없다** | `routes.ts`의 `POST /admin/jobs`가 `type !== 'backfill'`을 전부 400으로 거절하고 `createJob`의 타입도 `'backfill'`뿐이다. 러너는 있는데 큐에 넣을 경로가 없어 **PostgreSQL 정본에서 색인을 복구하는 유일한 길**이 막혀 있었다 | `OPERATOR_JOB_TYPES`를 열되 **집는 러너가 있는 것만** 받는다. 지적을 확인하다 **내 결함 하나를 더 찾았다** — 러너가 `target`을 `repository_id`로 읽고 있었는데 API가 만드는 형식은 `owner/repo`다. 러너를 저장소 규약에 맞췄다 |
| 2 | P1 | **ready 신호 발행 실패가 영구 유실이다** | 발행을 `markCommitProjected` **뒤**에 두었다. 발행이 실패하면 스냅숏도 있고 `projected_at`도 찍혀 있어 두 스윕이 모두 그 커밋을 건너뛰고, `enrichCommits`는 예외를 잡아 `skipped`로 세며 핸들러는 ack한다 — 직접 푸시 커밋의 **유일한 방아쇠**가 사라진다 | 발행을 **색인 뒤·완결 표식 앞**으로 옮겼다. 실패가 `projected_at`을 `null`로 남겨 `listCommitsMissingProjection` 스윕이 다시 본다. 발행이 한 번 더 나가는 것은 안전하다 — 파생은 멱등이고 `event_id`도 결정론적이다 |
| 3 | P1 | **한 번 해결된 접두 간선이 나중에 모호해져도 되돌아가지 않는다** | `findUnresolvedReferences`가 `resolved: false`로 걸러 낸다. 새 커밋이 같은 접두를 갖는 순간 이미 해결된 간선이 **"자신 있게 틀린 답"**이 되고, source 이벤트는 다시 오지 않으므로 그것을 볼 방법이 없다 | 커밋 대상은 **해결된 것까지** 가져와 접두 유일성을 매번 다시 계산한다. 모호해졌으면 **해결을 되돌리고 대상 필드를 지운다** — 필드를 남기면 화면이 그것을 읽는다. 정확한 키는 모호해질 수 없으므로 재평가하지 않는다 |
| 4 | P2 | **해결의 부분 실패를 성공으로 센다** | `bulk`는 요청 수준에서 성공하면서 개별 항목만 실패할 수 있다. `resolveReferencesTo`가 `result.failures`를 버리고 성공 수만 돌려주어 핸들러가 ack했다 — 실패한 간선을 다시 시도할 방아쇠가 없다 | 항목 실패가 있으면 던진다. 핸들러가 **예산 안에서** 재시도한다 (DEV-228의 계층이 여기서 값을 한다) |
| 5 | P2 | **한 대상을 가리키는 간선이 500건을 넘으면 나머지가 영원히 미해결이다** | 단일 무정렬 `search` 하나로 `size: 500`이었다. 대상 색인은 보통 한 번뿐인 사건이다 | `link_id` 정렬 + `search_after`로 **끝까지 넘긴다.** 페이지 크기는 상한이 아니라 왕복 단위다 |
| 6 | P2 | **산문 끝 문장 부호가 URL 참조를 통째로 없앤다** | `See https://ghe/acme/b/pull/77.`의 마침표가 경로에 딸려 들어가 `URL_TARGET`이 거부한다 | 해석 전에 뒤에서부터 벗긴다. **벗겨도 해석되지 않으면 참조가 아니다** — 관대해지는 것이 아니다 |

**정정 변이 8종 전부 킬됐다.** 각 정정을 되돌리는 변이가 실제 시험을 깨뜨린다: 유형 재차단·`target` 규약 되돌림·발행 순서 되돌림·재평가 제거·되돌림 제거·부분 실패 삼킴·페이지 한 번만·부호 벗기기 제거.

**내 회귀 시험 하나가 틀린 것을 단언하고 있었다.** "완결 표식 **뒤**에 발행한다"를 검사하고 있었는데, 그것이 바로 리뷰가 지적한 순서다. 시험이 옛 계약을 굳히고 있었던 셈이라 새 계약(색인 뒤·표식 앞)으로 다시 걸었다.

#### 재검증 (리뷰 정정 후)

| 계층 | 결과 |
| --- | --- |
| `pnpm typecheck` · `lint` · `lint:deps` | 통과 |
| 단위 | **1320** 통과 (1 skipped) |
| 통합 | **849** 통과 |
| 회귀 | **104** 통과 |
| a11y · contrast · `pnpm build` | 192 (axe 0) · 80쌍 · 통과 |
| e2e | 67 통과 — 아래 참조 |
| `validate_srs_prd_env.py --strict` | 오류 2건(9+5), 신규 0 |

**`flow-001` 간헐 실패를 이번 변경에 귀속하지 않는다.** 절차대로 확인했다: 이 브랜치가 `apps/web`을 **한 파일도 바꾸지 않았고**(`git diff origin/main..HEAD -- apps/web`이 비어 있다), 단독 실행 4/4 통과, 전량 실행 3회 중 1회 실패, 실패 항목은 `flow-001`의 셸 렌더링이며, 앞선 푸시에서 CI `verify`가 통과했다. 원장 §7의 WP-016 제한 그대로다 — **재시도로 가리지 않는다.**

### 6.35 WP-030 되돌림·체리픽·스택 파생 검증 기록 (CR-041)

**착수 전 감사에서 열여덟을 찾았고 열둘이 같은 뿌리다** — 계약이 **source 본문만 보고 후보(candidate)의 변화를 보지 않는다.** WP-029가 참조 축에서 만난 "만든다만 있고 다시 만든다가 없다"의 한 겹 아래 형태다. 참조는 source 본문만 보면 답이 나오지만, **이 세 계열은 다른 엔티티의 현재 상태가 답을 바꾼다.**

| DEV | 감사에서 무엇을 확인했나 | 어떻게 풀었나 | 시험 |
| --- | --- | --- | --- |
| 230 | JOB-REL-002의 방아쇠가 `EVT-ING-003` 하나다. 그 이벤트는 `project`가 색인한 문서마다 나는데 **직접 푸시 커밋 문서는 `project`가 만들지 않는다** — 그 커밋의 되돌림은 영원히 간선이 되지 않는다. CR-038(DEV-206)·CR-039(DEV-215)와 같은 모양의 세 번째 | 방아쇠에 `EVT-ING-005` 추가. WP-029가 이미 세운 신호를 그대로 쓴다 | 통합 1건(**실제 `handleLinkEvent`에 `EVT-ING-005`를 넣어** 사슬로 확인) + 회귀 2건 |
| 231 | JOB-REL-003도 같고, 이유가 하나 더 있다 — `patch_id`는 커밋 보강이 채우므로 **투영 시점에는 아직 없다.** 그때 판정하면 `derived` 경로가 언제나 "값 없음"으로 끝나 AC-2가 실질적으로 죽는다 | 같은 방아쇠. 정본에 값이 들어간 뒤를 알리는 신호가 `EVT-ING-005`다 | 통합 1건(운영 사슬로 `derived` 간선 확인) |
| 232 | JOB-REL-004에 상위 PR 변화가 하위 PR 간선을 바꾸는 경로가 없다. **간선은 하위 PR이 소유(`from`)하는데 해제 조건은 상위 PR이 머지될 때 발생한다** — 하위 PR에는 그때 아무 이벤트도 오지 않는다 | 이벤트마다 **두 방향**을 본다: source 재파생 + 이 엔티티의 변화가 영향을 주는 source 재평가. 마이그레이션 014의 `base_branch` 인덱스가 그 역방향의 경계다 | 통합 2건(**하위 PR에 이벤트를 주지 않고** detached 확인, 재부착) + 회귀 2건 |
| 233 | source 본문이 바뀌었을 때 되돌림·체리픽 간선을 제거할 계약이 없다. WP-029가 세운 완전한 파생 집합 규율(DEV-220)이 세 계열에 적혀 있지 않다 | 계열마다 수명을 나눠 적었다 — `reverts`·`cherry_picks`는 **제거**, `stacks_on`은 **`detached`**. 하나의 일반 추상으로 뭉치지 않는다. **실패 회차는 어느 계열에서도 제거하지 않는다** | 통합 1건 + 회귀 2건(실패 갈래가 제거보다 앞에서 돌아 나가는지) |
| 234 | JOB-REL-006 구현이 `references`만 재파생한다. 잡 카탈로그는 이미 FR-REL-003~006으로 적고 3.3장이 "WP-030이 확장한다"고 적어 두었다 | `handleSourceReady`에 관계 파생을 붙였다 — `runReferenceRebuild`가 그 함수를 부르므로 **재파생이 저절로 네 계열을 덮는다.** 두 번째 재구축 틀을 만들지 않았다 | 통합 1건(**색인을 비우고 정본만으로** 네 계열 복원) + 회귀 1건 |
| 235 | WP-030의 patch-id 실패 설명이 "실패 시 null + 메트릭" 한 줄인데, SRS AC-5는 세 사유를 가르고 **시도하지 않은 것은 필드를 두지 않는다**고 정한다. CR-038이 이미 그렇게 구현했고 WP 문서만 그 전 상태에 멈춰 있었다 | 계약을 SRS와 맞췄다. 트레일러는 `patch_id` 가용성과 **무관하게** 동작하고, `derived`는 값이 실제로 있을 때만 | 통합 2건(`no_mirror`에서 트레일러는 살고 `derived`는 안 도는지) |
| 236 | QA-W002-11·12를 WP-030 DoD가 인용하는데 **이 WP로는 통과할 수 없다.** 둘은 W-002 화면 동작이고 관계 조회 API는 WP-031 소유다 | 소유를 WP-031로 옮겼다. WP-030은 **저장된 간선의 방향·신뢰도·역방향 조회 가능성**까지 증명하고 멈춘다 | 문서 |
| 237 | FR-REL-004의 예외 처리("후보 2건 이상이면 **모든 후보**를 저장")가 DoD에 없다. 명시하지 않으면 구현이 `LIMIT 1`로 좁히기 쉽고, 그것은 조사 도구가 **자신 있게 틀린 답**을 내는 모양이다 | 후보를 전부 저장한다. 상한은 폭주 방지이지 선택이 아니다 | 통합 1건 + 변이 M4 |
| 238 | 스택 `detached`가 구현 범위에만 있고 DoD에 없으며, **되돌리는 방향이 정의되어 있지 않다.** 지우면 *그런 의존이 있었다*는 사실이 사라진다 | 지우지 않고 `detached: true`, 조건이 다시 성립하면 `false`. **한 번도 성립한 적 없는 후보에는 간선을 만들지 않는다** | 통합 2건 + 회귀 1건(`deleteStaleDerivedLinks`에 `stacks_on`이 없는지) |
| 239 | `reverted_pull_request_count` 이월분이 구현 범위에만 있고 DoD에 없다. CR-027(DEV-133)이 뺀 키이고 WP-030이 그 조건을 해소하는 WP다 | 요약 집계 왕복 안의 `filter` 집계로 계산한다 — **간선 인덱스를 PR마다 다시 묻지 않는다.** `files_truncated_pull_request_count`가 같은 형태의 선례 | 통합 4건(구간 밖 PR이 새지 않는지 포함) + 회귀 1건 |
| 240 | 정본에 후보 조회 인덱스가 없다(실측). `pull_request_snapshot`은 `(repository_id, pr_number)` 하나뿐이고 본문이 JSONB다 | **마이그레이션 014 — 인덱스 다섯.** 새 엔티티 표는 만들지 않는다 | 통합 11건(존재·부분 인덱스 술어·질의 결과·**EXPLAIN으로 식 일치**) |
| 241 | `link_summary` boolean leaf의 계산 규칙이 없다. "간선 하나를 지웠으니 `false`"가 자연스럽게 나오는데 **같은 종류의 다른 간선이 남아 있을 수 있다** | 조정이 끝난 뒤 **현재 active 간선 집합에서 재계산한다.** `has_stack`은 `detached`가 아닌 것만 센다 | 통합 2건(하나 남은 상태에서 `true`인지) + 변이 M15 |
| 242 | **후보가 source보다 나중에 나타날 때 수렴 경로가 어느 계열에도 없다** (232의 일반형). 제목 후보 추가·같은 `patch_id` 커밋 도착·상위 PR 머지 — 셋 다 source에는 새 이벤트가 없다 | 후보 변화 재평가를 파생과 **같은 진입점에 묶었다**. 역방향 조회는 전부 인덱스가 잡히는 정확 일치이고 총량은 상한이 있다. 잘리면 로그에 남기고 JOB-REL-006이 보정한다 | 통합 3건(**source 이벤트 없이** 수렴하는지, 계열마다) + 회귀 3건 |
| 243 | 체리픽 `derived`의 방향과 상위 5건 순서가 정의되어 있지 않다. **비결정론이면 같은 정본에서 다른 색인이 나와** ADR-004의 재구축 증명이 성립하지 않는다 | 방향은 **나중 → 이른**, 정렬은 `committed_at` 내림차순 + 동률 시 `commit_sha` 오름차순. 같은 쌍을 양방향 저장하지 않는다 | 통합 3건(방향·재실행 동일 집합) + 변이 M7·M8 |
| 244 | 같은 `head_branch`를 가진 열린 PR이 여럿일 때가 정의되어 있지 않다. 첫 결과를 고르면 실제 의존 하나가 **조용히 사라진다** | 조건을 만족하는 모든 후보를 `pr_number` 순으로 평가한다 | 통합 1건 |
| 245 | `references`가 아닌 간선의 ID 헬퍼가 없다. 데이터 모델 4.3장이 재료를 이미 정했는데 코드에는 `referenceLinkId` 하나뿐이고 `'references'`가 하드코딩돼 있다 | `derivedLinkId(link_type, from, to)` 신설. **`reference_key`를 일반화하지 않는다** — 그것은 대상이 나중에 밝혀지는 참조의 문제를 푸는 수단이고, 이 셋은 대상을 알아낸 뒤에 만들어진다 | 단위 5건 |
| 246 | WP-030의 실패 처분이 정의되어 있지 않아 `links_pending`을 재해석할 위험이 있다. 그 필드는 **참조 추출의 완결 상태**이며 화면이 그 뜻으로 읽는다 | 재해석하지 않고 새 pending 필드도 만들지 않는다. 실패는 `retry` → 예산 소진 시 실패 대기열 + JOB-REL-006 보정 | 회귀 1건 |
| 247 | FR-REL-006 AC-5가 요구하는 순환 지표가 없다(`reconcile_incomplete_cycles`는 조정 스캔 주기 수로 뜻이 다르다) | `link_stack_cycle_total`·`link_relations_total` 신설 | 통합 1건 + 회귀 1건 |

#### 이 감사가 SRS를 읽어 되찾은 것 둘

**DEV-237**(다중 제목 후보 전부 저장)과 **DEV-235**(patch-id 세 사유)는 **SRS에 이미 있는데 WP 계약이 빠뜨린 것**이다. 하위 문서가 상위 문서보다 좁으면 구현은 하위를 따르고, 그러면 **승인된 동작이 조용히 사라진다.** 감사가 네 면(SRS·아키텍처·WP·코드)을 모두 대조해야 하는 이유가 이것이다.

#### 변이 시험 — 18종 중 **하나가 살아남았고 그것이 결함이었다**

| 변이 | 결과 |
| --- | --- |
| M1 직접 푸시 방아쇠 제거 · M2 운영 진입점에서 관계 파생 제거 · M3 후보 변화 재평가 제거 | KILLED |
| M4 되돌림 후보를 1건으로 · M5 되돌림 stale 제거 무력화 | KILLED |
| M6 patch-id 저장소 조건 제거 · M7 상위 5건 상한 제거 · M8 후보 정렬 뒤집기 · M9 트레일러를 patch_id에 종속 | KILLED |
| M10 스택 역방향 재평가 제거 · M11 detached 조정 무력화 · M12 순환 검사 제거 | KILLED |
| M14 `link_summary` 통째 대입 · M15 요약 boolean을 간선 하나 기준으로 · M17 접근 통제 material 제거 | KILLED |
| M18 되돌림 수를 항상 0으로 · M20 커밋 제목 조회의 저장소 조건 제거 | KILLED |
| **M13 깊이 상한 제거** | **SURVIVED → 결함 발견** |

**M13이 찾은 것.** 살아남은 이유를 파고들다 `walkChain`이 사슬 길이가 10을 넘으면 `too_deep`을 돌려주고 **간선을 아예 만들지 않는** 것을 발견했다. FR-REL-006 AC-4가 정하는 것은 "스택 깊이를 최대 10단계까지 **추적한다**"이며, 이 함수가 만드는 간선은 언제나 **바로 위 부모**(깊이 1)다 — 사슬이 12단계라는 이유로 그것을 없애면 **깊은 스택의 PR이 자기 부모와의 의존을 잃는다.** 요구사항이 말하지 않은 손실이다.

상한의 뜻을 "추적 범위"로 고쳤다: 10단계까지 순환을 찾고, 찾지 못하면 간선을 만든다. **알려진 한계를 함께 적었다** — 10단계보다 먼 순환은 감지되지 않으며, 그것이 AC-4가 정한 범위다. 시험 둘을 새로 걸었다(12단계 사슬에서 부모 간선이 남는지, 13단계 고리가 감지 범위 밖인지). 두 시험이 M13을 죽인다.

**등가로 판정해 세지 않은 것은 없다.** 살아남은 하나는 전부 결함이었다.

#### 운영 도달성 (CR-034 계층에 JOB-REL-002·003·004 추가)

| 기능 | 선언 | 소비자 그룹 | 기동 | 배포 manifest |
| --- | --- | --- | --- | --- |
| JOB-REL-002·003·004 | `relations.ts` | **`link`**(기존) | `roles.includes('link')` → `startLinkWorker` → `handleSourceReady` → `handleRelationsReady` | `pipeline-worker-link.yaml`(기존) |

**새 역할·새 소비자 그룹·새 manifest를 만들지 않았다.** 입력이 같은 PostgreSQL 정본이고, 나누면 JOB-REL-006이 두 틀을 각각 돌아야 한다. 회귀가 그 사실을 검사한다(`pipeline-worker-relations.yaml`이 **없는지**까지 본다).

#### 검증 배터리 (main `0a501f3` 대비)

| 계층 | 결과 | 증감 |
| --- | --- | --- |
| `pnpm typecheck` · `pnpm lint` · `pnpm run lint:deps` | 통과 (패키지 13, 위반 0) | - |
| 단위 | **1342** 통과 (1 skipped) | 1320 → **+22** |
| 통합 | **892** 통과 (실 PG·ES) | 849 → **+43** |
| 회귀 | **118** 통과 | 104 → **+14** |
| a11y | 192 통과 (axe 0건) | - |
| contrast | 80쌍 통과 | - |
| `pnpm build` · `pnpm --filter @prs/web run build` | 통과 | - |
| e2e | 66/67 — `flow-001` 간헐 (아래) | - |
| 문서 검증기 `--strict` | ERROR 2건 (9·5) — **`origin/main`과 동일, 신규 0** | - |

**`flow-001` 간헐 실패는 이 변경에 귀속되지 않는다 (실측).** ① `git diff origin/main..HEAD -- apps/web`이 **비어 있다** — 화면 코드를 한 줄도 바꾸지 않았다. ② 그 시험은 `page.route('**/api/**')`로 **모든 API를 가로챈다** — 백엔드 변경이 구조적으로 도달할 수 없다. ③ 단독 실행 **4/4 통과**, 전량 실행 3회 중 1회 실패. 원장 §7의 기존 항목(WP-016 소관)과 같은 모양이다. **재시도 성공으로 가리지 않았다.**

**통합 전량 5회 중 1회 실패했고 그 회차의 실패 시험을 기록하지 못했다.** 출력을 요약 줄만 남기고 버린 내 명령 실수다. 이후 **4회 연속 통과**(892/892)했으나 무엇이 실패했는지 모르므로 **해소했다고 적지 않는다.** 공유 `prs_test`·공유 ES의 파일 간 오염이 유력한 후보다(§7의 알려진 성질). 다음 세션이 같은 것을 보면 그때 귀속한다.

#### NOT RUN

- **실제 Kubernetes 적용** — 클러스터가 없다. manifest는 정적 검증까지이며 이 CR은 manifest를 새로 만들지 않았다
- **실제 GHE 대상 smoke** — 자격 증명이 없다. 다만 이 WP의 파생은 **GHE를 부르지 않는다**(정본이 PostgreSQL이다)
- **운영 규모 인덱스 성능** — 마이그레이션 014의 인덱스가 실제 데이터 규모에서 어떤 계획을 내는지는 재지 않았다. 확인한 것은 **질의 식과 인덱스 식이 일치한다**는 것뿐이다(EXPLAIN, `enable_seqscan=off`)
- **운영 규모 무중단 마이그레이션** — 러너가 마이그레이션을 단일 트랜잭션에서 실행하므로 `CREATE INDEX CONCURRENTLY`를 쓸 수 없다. 베타 미승인·클러스터 미적용 상태의 pre-beta 스키마 기준선에서는 일반 `CREATE INDEX`가 맞다. **대규모 운영 DB에 무중단 적용했다고 보고하지 않는다**

#### 6.35.1 PR #46 리뷰 라운드 — 여섯 전부 실결함 (머지 전)

CI 초록 뒤 Codex 리뷰가 **P1 셋 · P2 셋**을 냈고 전부 실결함이었다. **넷이 같은 뿌리다** — 내가 *"양 끝점"*이 아니라 *"source 한쪽"*만 보고 있었고, *"실패를 성공으로 세는"* 자리를 두 곳에 남겼다.

| 지적 | 무엇이 틀렸나 | 정정 |
| --- | --- | --- |
| **P1** 양 끝점 요약 | `refreshRelationSummary`가 **source만** 갱신했다. `is_reverted`는 **대상의 필드**이므로 A가 B를 되돌려도 B는 아무도 건드리지 않아 영원히 `false`로 남는다 — 그리고 그 위에서 도는 `reverted_pull_request_count`가 **통째로 틀린 수**를 낸다 | 조정 **전에** 기존 간선의 끝점을 기억하고, 새 대상 ∪ 옛 대상 ∪ source 전부를 다시 계산한다 |
| **P1** `links_pending` 보존 | 주석은 *"현재 값을 보존한다"*고 적혀 있었으나 **코드는 그 반대를 하고 있었다** — 필드가 필수라 언제나 `false`로 덮었다. 참조 추출이 실패해 세운 표식을 관계 파생이 지우면 그 문서가 재파생 대상에서 조용히 빠진다 | `LinkSummaryUpdate.linksPending`을 **선택**으로. 스크립트도 값이 없으면 건드리지 않는다. 관계 파생은 넘기지 않는다 — 참조를 추출하지 않았으므로 **그 상태에 대해 할 말이 없다** |
| **P1** 해제 부분 실패 | `setLinkDetached`의 결과를 버리고 `stale.length`를 성공으로 셌다. ES가 bulk를 200으로 돌려주며 항목 하나를 거부하면 **머지된 상위 PR에 대한 의존이 `active`로 남고 아무도 다시 하지 않는다** | 실패가 있으면 던진다. 핸들러가 `delivery_count`로 예산을 집행하고 소진하면 실패 대기열 + JOB-REL-006이 보정 경로다 |
| **P2** 해제의 검색 가시성 | 운영에서 `refresh`가 꺼져 있어 해제 bulk가 검색에 보이지 않는 상태로 요약을 셌다 — **방금 해제한 마지막 스택 간선이 살아 있는 것으로 세어져** `has_stack: true`가 굳는다 | 요약 질의 **앞에** 간선 색인을 한 번 새로 고친다. 시험 하나를 `refresh: false`로 돌려 운영과 같은 조건에서 건다 |
| **P2** 옛 head의 child | 상위 PR이 `head_branch`를 바꾸면 정본은 이미 새 값이라 **분기로 찾는 조회가 옛 child를 보지 못한다** — 그 간선이 조건이 깨졌는데도 `active`로 남는다 | 분기 값 대신 **이미 있는 간선**(`findLinksTo`)에서 찾는다. 간선이 그때의 관계를 기억하므로 분기가 무엇으로 바뀌었든 정확하다 |
| **P2** 체리픽 후보 상한 | 방향 술어를 앱에서 걸어, 같은 patch를 가진 **나중** 커밋이 SQL 상한을 채우면 이전 후보가 한 건도 안 남고 **조정이 멀쩡한 간선을 지운다** | 방향 술어를 질의로 내렸다. `(committed_at, commit_sha)` 전순서로 자르고 상한은 그 뒤에 적용한다 |

**리뷰가 짚지 않은 같은 모양 하나를 함께 고쳤다.** 간선 **쓰기**의 부분 실패도 `complete: false`를 돌려주고 ack했다 — 해제와 똑같이 *"실패했는데 아무도 다시 하지 않는"* 자리다. 둘 다 던지도록 통일했다.

**결함 재적용 7종 전부 킬.** 각 정정마다 결함을 되돌려 시험이 실제로 잡는지 확인했다. R7(쓰기 실패 조용히 ack)은 처음에 **살아남았고**, 그것을 거는 시험이 없다는 뜻이었으므로 시험을 먼저 만들고 다시 걸었다.

**검증 (정정 후)**: 단위 1342 · 통합 **900**(+8) · 회귀 **124**(+6) · a11y 192 · contrast 80쌍 · build 통과. 검증기 신규 issue 0.

### 6.36 WP-031 관계 조회·상세 화면 검증 기록 (CR-042)

**착수 전 감사가 열여덟을 찾았고 아홉이 같은 뿌리다** — 계약이 **파생**의 규칙만 정하고 **조회가 다른 질문**이라는 것을 보지 않았다. 파생에는 요청자가 없어 저장소 안에서 끝나지만, 조회에는 요청자가 있고 **대상 쪽을 본다.** WP-029가 참조 축에서, WP-030이 후보 축에서 만난 것의 세 번째 형태다.

#### 감사 결과 (DEV-248~265)

| 계열 | 건수 | 대표 |
| --- | --- | --- |
| 계약 공백 | 9 | 관계 조회 API 부재(248) · 역방향 라우팅(250) · read shape(251) · 상한(252) · THR-034 교집합(253) · co-change 자격·후보·순서(254·255·256) |
| 문서 오류 | 5 | API-REL-003 상세 부재(249) · `links_pending` 드리프트(258) · FLOW-006 누락(259) · 미승인 제품 판단(260) · W-001 이월 누락(262) |
| 범위 공백 (UI) | 2 | C-021 상태 모델(257) · 다중 후보 표시(261) |
| 구현 공백 | 2 | `ResultTable`이 `link_summary`를 버림(264) · 가드레일 면제가 파일 단위(265) |

**가장 값이 컸던 것은 DEV-250이다.** `findLinksTo`는 `repository_id`로 라우팅한다. 되돌림·체리픽·스택은 동일 저장소 관계라 워커에서는 그것이 옳았고 결함이 드러나지 않았다. 그러나 **참조는 저장소를 건너뛰고, 간선은 근거를 소유한 저장소(source)에 산다** — `acme/b`의 PR을 가리키는 참조를 `b`로 라우팅해 찾으면 `acme/a`가 만든 간선을 **어떤 값으로도 찾을 수 없다.** 워커의 조회 형태를 그대로 HTTP에 재사용했다면 cross-repo 역방향이 조용히 침묵했을 것이다. 조회 경로는 **라우팅을 쓰지 않고** 강제 접근 범위 필터가 경계를 만든다.

**DEV-265는 구현 중에 드러난 것이다.** ADR-008 가드레일의 허용 목록은 **파일 경로**이고 `packages/es/src/links.ts`가 `no_requester`로 올라 있다 — 사용자 대면 조회를 그 파일에 넣으면 워커용으로 쓴 면제를 그대로 물려받고 검사기는 침묵한다. 그래서 조회 계층을 `relations-read.ts`로 **밖에** 두었다. 같은 자리에서 `get`·`mget`이 검사 대상이 아니라는 것도 드러나 가드레일을 넓혔다.

#### 구현

| 경로 | 역할 |
| --- | --- |
| `packages/es/src/relations-read.ts` | 신규. 사용자 대면 간선 조회 — 라우팅 없음, `ScopedQuery` 강제, `limit + 1`로 `truncated` 판정 |
| `apps/search-api/src/relations/service.ts` | 신규. API-REL-006 본체. 앵커 해석 → 간선 조회 → **대상 내용 batch 조회**(종류별 1회) → 다중 후보 판정 |
| `apps/search-api/src/relations/co-changes.ts` | 신규. API-REL-003. 자격 상태 셋 · `script_score` 정확 자카드 · 결정론 정렬 |
| `apps/search-api/src/relations/routes.ts` | 신규. 파라미터 검증과 오류 매핑. 끝점 조합 불가는 400 |
| `apps/search-api/src/server.ts` | `registerRelationRoutes` 등록 — **여기 한 줄이 빠지면 배포에서 사라진다** |
| `apps/search-api/src/resolve/detail.ts` | 커밋 상세가 `links_pending`을 싣는다 (DEV-263) |
| `packages/es/src/architecture.test.ts` | ADR-008 가드레일에 `mget`·`es.get` 추가 (DEV-265) |
| `apps/web/lib/relations.ts` | 신규. 판정 순수 함수 — 없는 것·모르는 것·볼 수 없는 것·해제된 것을 가른다 |
| `apps/web/components/{LinkGroupList,RelationBadgeGroup,RelationSection,CoChangeSection}.tsx` | 신규. C-021 · C-015 · 지연 섹션 둘 |
| `apps/web/components/{ResultTable,PrDetailView,CommitDetailView}.tsx` | 배지 배선, 골격 → 실제 섹션 |

**새 마이그레이션·새 잡·새 소비자 그룹·새 배포 manifest 없음.** 이 WP는 읽기 전용이다.

#### 검증

| 계층 | 결과 |
| --- | --- |
| 타입 검사 · lint · lint:deps | 통과 (패키지 13, 위반 0) |
| 단위 | **1380** (1342 → +38) |
| 통합 | **931** (900 → +31) — 실 Elasticsearch |
| 회귀 | **146** (124 → +22) |
| a11y | **212** (192 → +20), axe 위반 0 |
| contrast | 80쌍 통과 |
| e2e | flow-006 **11건 신설**. 전량 78건 |

#### e2e 간헐 실패 귀속 — 되돌려서 쟀다

이번 WP는 `apps/web`을 실제로 바꿨으므로 이전 세션들이 쓰던 "화면 코드 diff 0" 근거를 **쓸 수 없다.** 그래서 §55의 절차대로 되돌려 비교했다.

| 상태 | 전량 실행 | 결과 |
| --- | --- | --- |
| 코드 변경 **전** (baseline) | 1회 | `flow-001.spec.ts:127` 실패 |
| 변경을 stash해 화면 코드를 `main`과 동일하게 | 3회 | **1회 실패 — 같은 시험·같은 단언·같은 오류** |
| 변경 적용 | 8회 | 4회 실패 (그중 1회는 `flow-003.spec.ts:176`도 함께) |
| `flow-001` **단독** | 4회 | 4/4 통과 |
| `flow-006` (이번 WP) | 7회 | **7/7 통과** |

**판정: 기존 취약성이며 이번 변경이 만든 것이 아니다.** 되돌린 상태에서도 재현되고, 실패한 두 시험은 둘 다 **뒤로가기 복원 상태를 5초 안에 확인하는 형태**이며 관계 코드에 닿지 않는다. 시험이 67 → 78로 늘어 단일 worker의 전체 실행이 길어진 것이 노출 빈도를 올린 것으로 **보이나 그것은 추정이다.** `flow-003`도 같은 계열로 실패한다는 사실은 이번에 새로 얻은 정보이며 §7에 함께 남겼다. 재시도로 가리지 않는다.

#### 변이 시험 — 22종 전부 킬, 하나가 시험 구멍을 찾아 줬다

접근 통제(M1·M2·M3·M4) · 표시 계약(M5~M10) · 상한(M11) · 배선(M20) · 동시 변경(M13~M19) · 화면(M6~M9·M12·M21·M22).

**M5(신뢰도를 언제나 `exact`로 보고)가 1차에서 살아남았다.** 등가인지 묻기 전에 경로를 읽었더니 — 순서와 다중 후보 판정은 **원본 간선의** 신뢰도를 쓰므로 응답에 실리는 값이 틀려도 그 둘은 그대로였다. **응답의 `confidence` 값 자체를 아무도 단언하지 않고 있었다.** 화면의 배지와 QA-W002-12가 그 값에 걸려 있다. 시험 둘을 더하고 다시 걸어 킬했다. `risks.md` 32번이 적어 둔 규율이 또 값을 했다.

**등가로 판정해 세지 않은 변이는 없다.**

#### 6.36.1 PR #47 리뷰 라운드 — P1 하나, 실결함

| 지적 | 실체 | 정정 |
| --- | --- | --- |
| **P1** 부분 관계 검색을 응답 만들기 전에 거절하라 | **실결함.** `searchRelationLinks`가 `assertNoShardFailures`를 부르지 않았다. 샤드가 실패해도 Elasticsearch는 살아남은 것으로 HTTP 200을 주므로, **짧아진 목록이 `truncated: false`와 함께** 나가 화면이 "관계가 이것뿐"이라고 말한다. 라우트는 `PartialSearchError`를 504로 옮길 준비가 돼 있었는데 그 오류가 나지 않았다 | 검사를 `hits`를 쓰기 **전에** 넣었다 |

**이 질의가 특히 위험한 이유가 있다.** 저장소를 건너뛰는 참조를 찾으려고 **라우팅을 쓰지 않아 샤드 전부(12개)를 돈다** — 한 샤드만 흔들려도 부분 결과가 된다. 라우팅을 포기한 결정(DEV-250)이 이 실패 모드의 확률을 **올렸는데** 그 대가를 계산하지 않았다.

**같은 계열을 스스로 훑었다.** 앵커 조회·대상 조회·동시 변경·일반 검색·식별자 해석은 전부 이 검사를 지난다. 빠진 것은 이 한 곳뿐이었다 — 새 파일을 만들면서 선례를 따르지 않은 자리다.

**결함 재적용으로 킬 확인.** 검사를 지우면 단위 3건과 회귀 1건이 실패한다. 회귀는 검사가 `hits` **앞에** 있는지까지 본다 — 뒤에 두면 이미 부분 결과를 쓴 뒤다.

**검증 (정정 후)**: 단위 **1380**(+13) · 통합 931 · 회귀 **146**(+1) · a11y 212 · contrast 80쌍.

#### 도구가 결함·구멍을 찾아 준 자리 셋

- **픽스처 충돌** — 상한 시험용 간선 101건을 A#10에서 냈더니 "A#10의 참조" 질의에 섞여 대상 간선을 밀어냈다. 전용 source로 갈랐다
- **대역이 서버보다 관대했다** — a11y 대역이 모든 유형에 같은 `link_type`을 돌려줘 네 그룹이 전부 `references`로 그려졌고 같은 `data-testid`가 여러 개 생겼다. 요청을 되돌려주는 대역으로 고쳤다 (`risks.md` 3번)
- **회귀가 주석까지 셌다** — "이 필드를 쓰지 않는다"를 파일 전문에 걸었더니 **그 사실을 설명한 주석**에 걸렸다. 문서 검증기가 자기 검색어를 세는 것과 같은 함정이다. 검사 범위를 코드로 좁혔다

#### NOT RUN

실제 GHE smoke · 실제 Kubernetes · 운영 규모 관계 조회 성능 · 운영 규모 동시 변경 성능(`script_score`의 실측 비용). 로컬 PostgreSQL·Redis·Elasticsearch는 **실제** 통합이다.

### 6.37 WP-032 착수 전 계약 감사 (CR-043)

구현하지 않았다. **감사만 하고 계약을 경화했다.** 스물을 찾았다. "착수 전 감사에서 계약 공백이 나왔다"가 이번으로 **열 번 연속**이다 (CR-029·030·031·033·035·038·039·041·042·043).

#### 감사 결과 — 스물

| 계열 | 건수 | DEV |
| --- | --- | --- |
| 배포 불가 (매핑 활성화 경로 부재) | 2 | 266·267 |
| 하위 문서가 SRS보다 넓음 (양방향) | 2 | 268 · 285 |
| 계약 공백 (범위 조사 페이지네이션) | 1 | 269 |
| **구현 결함 (재현함)** | 2 | **270**·275 |
| 커서 계약의 아래층 부재 | 4 | 271·272·273·274 |
| 패싯 계약 (검증 수단·상태·예산·규칙) | 6 | 276·277·278·279·280·281 |
| 전문 검색의 안전 경계와 대상 | 2 | 282·283 |
| 구현 결함 (세는 단위) | 1 | 284 |

#### 이 감사의 뿌리 — "이 매핑을 **어떻게 배포하는가**"를 아무도 묻지 않았다

WP-032는 `edge_ngram` 부분 일치 필드를 요구한다(CR-040이 `nori` 대신 고른 경로다). 계약은 그 필드가 **무엇을 해야 하는지**를 정했고, **그것이 살아 있는 인덱스에 어떻게 들어가는지**는 정하지 않았다. 실측하니 벽이 둘이었고 서로 독립이다.

| # | 벽 | 실측 |
| --- | --- | --- |
| 1 | `edge_ngram` 분석기·필터는 `index.analysis`의 **비동적 설정** | 열린 인덱스에 `PUT _settings` → `illegal_argument_exception: Can't update non dynamic settings ... for open indices`. `bootstrap.ts`는 기존 인덱스에 `putMapping`만 부른다 |
| 2 | `putMapping`으로 더한 **새 서브필드는 기존 문서에서 비어 있다** | `title.partial` 추가(`acknowledged: true`) 직후 조회 **0건** → `_update_by_query` 뒤 **1건** |

close→reopen은 그 구간 검색이 멈추므로 FR-ING-008·NFR-008이 막는다. 그래서 **WP-032의 선행 WP에 WP-035를 넣었다.** REL-004의 실행 순서는 WP-029 → WP-030 → WP-031 → **WP-035** → WP-032다. **WP ID를 재번호화하지 않는다** — 번호는 안정 ID이고 순서를 정하는 것은 의존이다.

두 번째 벽이 더 중요하다. 첫 번째는 배포가 **터지므로** 반드시 발견되지만, 두 번째는 배포가 **성공하고** 전문 검색이 과거 데이터에 대해 조용히 적게 답한다. 이 저장소가 반복해서 만나는 실패 모양이다 (DEV-130 · CR-042 PR #47 P1).

#### 재현한 결함 — 범위 조회가 요약과 목록을 어긋나게 낸다 (DEV-270)

읽어서 의심하고 **실제 PostgreSQL·Elasticsearch로 재현했다.**

| 조건 | 결과 |
| --- | --- |
| 구간 1~60, `size=10`, 일치가 서수 51 하나뿐인 `q` | `summary.pull_request_count: 1` · `items: []` · `next_cursor: null` |
| 같은 질의, `size=60` | 서수 51이 목록에 나온다 |

`runRange`가 `findRangePage`로 **첫 `size` 행을 먼저 자르고** 그 안에서만 `q`를 판정하는데, 요약은 구간 **전체**를 기준으로 센다. 두 수가 한 응답 안에서 어긋나고, 커서가 없으므로 사용자는 그 항목에 **도달할 수 없다.** 조사 도구에서 이것은 조용한 오답이다.

정정 계약: **커서는 "마지막으로 반환한 항목"이 아니라 "마지막으로 검사한 서수"를 가리킨다.** 필터가 선택적일수록 그 둘은 멀어지고, 반환한 항목을 기준으로 삼으면 일치가 하나도 없는 페이지에서 순회가 끝난다. 구현은 WP-032다.

#### W-001과 W-004의 커서를 하나로 묶지 않았다

WP-032 구현 범위가 `search_after`를 적는다는 이유로 W-004의 멤버십까지 Elasticsearch가 소유하게 하면, 이 API가 존재하는 이유(DEV-130 — 색인 반영 실패가 구간을 **오류 없이** 줄인다)가 그대로 돌아온다. 두 화면은 순회하는 정본이 다르다.

| 화면 | 정본 | 커서 |
| --- | --- | --- |
| W-001 | Elasticsearch 검색 결과 | PIT + `search_after` |
| W-004 | PostgreSQL `merge_sequence` | 마지막으로 검사한 서수 |

추적 매트릭스가 W-004의 커서를 **FR-SRCH-008**에 걸고 있던 것도 이 pass에서 고쳤다. 기능은 그대로 남고 소유가 FR-SEQ-002(Must)로 옮겨졌다 — FR-SRCH-008은 Should이므로 오히려 강해졌다.

#### 감사에서 탈락한 후보 (가짜 발견을 남기지 않으려 기록한다)

| 후보 | 왜 아닌가 |
| --- | --- |
| "커서의 재료·동률 처리가 어디에도 없다" | **ADR-010이 이미 정한다** — 정렬 키 값 + 질의 지문(질의·정렬·접근 범위), 문서 ID를 마지막 정렬 키로. 그리고 `sort.ts`의 `TIEBREAK_FIELD = 'doc_id'`로 **이미 구현돼 있다**(`_id` 정렬은 ES 8이 금지하므로 `upsert`가 같은 값을 필드로 함께 넣는다). 실제 공백은 그 아래층이었다 — 봉인 방식·지문 정규화·실패 갈래·PIT |
| "`size` 상한·절삭이 없다" | `clampSize`가 기본 25·최대 200 절삭을 **이미 구현했다** (FR-SRCH-008 AC-2) |
| "`track_total_hits` 상한이 없다" | `TRACK_TOTAL_HITS = 10_000`이 **이미 있다** |
| "`query_too_short`가 없다" | 파서에 **이미 있다**(`MIN_TEXT_LENGTH = 2`). 결함은 존재가 아니라 **세는 단위**였다 (DEV-284) |
| "`text_ko_en` 분석기가 없다" | `settings.ts:18`에 **이미 있다**. CR-040이 약속한 안정 이름이 지켜지고 있었다. 없는 것은 `edge_ngram` 부분 일치 필드뿐이다 |

#### 검증

이 CR은 코드를 바꾸지 않는다. 기준선을 실측으로 남긴다.

| 계층 | 결과 |
| --- | --- |
| 통합 (변경 전 baseline) | **931 통과** / 61 파일 |
| e2e (변경 전 baseline) | **78 통과** — 이번 실행에서는 `flow-001`·`flow-003` 간헐 실패가 나오지 않았다 |
| 문서 검증기 `--strict` | main 대비 **증감 0** |

`flow-001`·`flow-003`의 간헐 실패는 §7의 알려진 제한 그대로다. **이번에 통과했다는 이유로 해소로 적지 않는다** — 간헐 실패는 통과 한 번으로 사라지지 않는다.

#### NOT RUN

`edge_ngram` 매핑의 실제 색인 크기·질의 동작 · 운영 규모 패싯 지연 · PIT 자원 사용량. 셋 다 WP-032·WP-035 구현에서 잰다. **이 CR은 계약만 정했고 어떤 성능 주장도 하지 않는다.**

### 6.31 릴리스 게이트

릴리스별로 갱신한다.

| REL | 게이트 통과일 | 성능 (QA-PERF-01~10) | 권한 매트릭스 (78셀) | 도메인 정확성 (ACC-01~08) | 미해결 항목 |
| --- | --- | --- | --- | --- | --- |
| REL-001 | - | - | - | - | - |
| REL-002 | - | - | - | - | - |
| REL-003 | **미통과 (2026-08-26 판정)** | **NOT RUN** — 1000만 문서 합성 데이터셋도 `test:perf` 스크립트도 이 환경에 없다 (DEV-058). 예산을 지키는 **구조**만 검증됐다 | **부분** — 역할 6종 × API 경로는 통과. 화면 13종 축은 화면이 다 서지 않아 걸 수 없다. 위협 모델 재검토·시크릿 스캔 기록 없음 | **부분** — 시퀀스 정확성(git 대조)은 회귀 계층이 매 실행 판정한다. 나머지 검수는 대상 기능이 REL-004 이후 | **Gate 4·5·6 미통과** (권한 매트릭스·위협 모델·시크릿 스캔 / 성능 7종 / 런북·롤백 실측·대시보드·알림). 실제 GHE·Kubernetes 미실행, `flow-001` 로컬 간헐 실패. 게이트별 판정은 6.31.1장 |
| REL-004 | - | - | - | - | - |
| REL-005 | - | - | - | - | - |
| REL-006 | - | - | - | - | - |

#### 6.31.1 REL-003 마감 판정 (2026-08-26)

**WP는 11/11 닫혔다. 릴리스 게이트는 통과로 적지 않는다.** 둘은 다른 판정이며, 하나가 다른 하나를 대신하지 않는다.

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| WP 완료 | **11/11** | WP-020~028 · WP-067 · WP-068 전부 `done`. 3장 상태표로 확인 |
| 미해결 리뷰 지적 | **0건** | PR #33~#42 열 개를 머지 직전에 전수 재확인 — non-outdated unresolved 0 |
| 타입·lint·lint:deps | 통과 | main `afdf1c2` |
| 단위 / 통합 / 회귀 | **1264** / **809** / **83** 통과 | 실제 PostgreSQL·Elasticsearch·Redis·git |
| a11y / contrast | **192** 통과 / 80쌍 통과 | axe 위반 0 |
| `pnpm build` | 통과 | |
| e2e | **CI 통과, 로컬 간헐 실패** | 아래 참조 |
| 성능 (QA-PERF-01~10) | **NOT RUN** | 합성 데이터셋·스크립트 부재 (DEV-058) |
| 실제 GHE / Kubernetes | **NOT RUN** | 사내망·클러스터 전제 |

**e2e를 "67/67 통과"라고 적지 않는다.** CI의 `verify` 잡이 같은 `pnpm test:e2e`를 돌려 PR #41·#42 모두 통과했지만, **이 로컬 환경에서는 5회 중 4회 `flow-001`의 "필터를 5회 조작한 뒤 뒤로가기 1회" 하나가 실패한다.** 측정한 그대로 적는다.

귀속은 **비교 재현보다 강한 근거**로 했다:

- 이 세션은 `apps/web` 아래 파일을 **한 개도 바꾸지 않았다** (`git log 5e18e00..HEAD -- apps/web`이 비어 있다). 비교 대상이 될 "깨끗한 main"의 화면 코드와 지금 코드가 **동일하다**
- `flow-001`은 `page.route('**/api/**')`로 모든 API 호출을 가로채므로, 이 세션이 고친 `detail.ts`·`neighbors.ts`가 그 시험에 **도달할 수 없다**
- 단독 실행은 4회 중 4회 통과한다 — 전체 실행의 부하에서만 나온다

따라서 WP-016 소관의 기존 타이밍 취약성이며(§7), 이 세션이 만든 것이 아니다. 다만 **로컬 실패율이 이전 기록(2회 중 1회)보다 높아졌으므로** §7의 항목을 그대로 두지 않고 관측값을 갱신한다.


#### REL-003 필수 게이트별 판정 (검증 계획 §4: 게이트 2·3·4·5·6·7)

**여섯 중 통과는 둘이다.** "성능과 실환경 smoke만 남았다"고 적으면 보안·운영·정확성 게이트가 미완인 채로 베타가 승인될 수 있다 — 남은 것을 **전부** 적는다.

| 게이트 | 통과 조건 (검증 계획 §3) | 판정 | 남은 일 |
| --- | --- | --- | --- |
| **Gate 2** 아키텍처/ADR | 새 ADR이 필요한 결정이 기록·승인됨 | **통과** | ADR-001~012로 충분했다. REL-003이 만든 결정은 전부 기존 ADR 안에서 CR로 처리됐다 (CR-029~038) |
| **Gate 3** 구현 테스트 스위트 | 전 WP DoD 통과, CI 전 항목 green | **통과** | WP-020~028·067·068의 DoD 전항 통과. CI `verify`·`integration` 녹색 (PR #41·#42·#43) |
| **Gate 4** 보안·개인정보 | 권한 매트릭스 **78셀** 통과, 위협 모델 미완화 high 0, 시크릿 스캔 통과 | **미통과** | 78셀 중 역할 6종 × **API 경로**만 검증됐다. 화면 13종 축은 화면이 다 서지 않아 걸 수 없다. **위협 모델 재검토와 시크릿 스캔은 실행 기록이 없다** |
| **Gate 5** 성능·접근성 | 성능 목표 **7종** 달성, axe 위반 0, 대비 위반 0 | **미통과** | axe 0·대비 0은 통과(192건·80쌍). **성능 7종은 NOT RUN** — 1000만 문서 합성 데이터셋도 `test:perf` 스크립트도 없다 (DEV-058) |
| **Gate 6** 운영 준비·롤백 리허설 | 런북 실행 확인, **롤백 10분 이내 실측**, 대시보드·알림 구성 완료 | **미통과** | 배포 manifest는 정적 검증까지다. **런북 실행·롤백 실측·대시보드·알림 구성 모두 실행 기록이 없다.** 실제 Kubernetes가 없어 이 환경에서 돌지 않는다 |
| **Gate 7** 도메인 정확성 | 회귀 검수 **7종** 통과 (QA 6장) | **부분** | 시퀀스 정확성(git 대조)은 회귀 계층이 매 실행 판정한다. 나머지 검수 항목은 대상 기능이 REL-004 이후라 아직 걸 수 없다 — **"해당 없음"이 아니라 "아직 판정 못 함"이다** |

**베타 공개는 이 판정으로 승인되지 않는다.** 검증 계획 §배포 단계가 REL-003을 "핵심 저장소 30개로 확대, 베타 공개"로 정하지만, 그 앞에 게이트 4·5·6이 서 있다. 조건부 승인을 하려면 조건과 해소 기한을 `change_control.md`에 기록해야 하며(검증 계획 §전 항목 signoff), **이 판정은 조건부 승인이 아니라 미통과다.**

**REL-004 진입 조건.** WP 기준으로는 열렸다 — 다음 WP를 시작하는 것을 막는 것은 없다. 그러나 **릴리스 게이트 4·5·6이 미통과이므로 REL-003의 베타 공개는 승인되지 않는다.** 둘을 섞지 않는다.


## 7. 알려진 제한 (구현 반영 기준)

착수 시점의 계획상 제한이다. 구현이 진행되면 실제 반영된 내용으로 갱신한다.

| 제한 | 근거 문서 | 현재 상태 | 후속 |
| --- | --- | --- | --- |
| 시퀀스는 REL-003부터 제공 | 로드맵 4장 | **부분 해소** (2026-08-24) — 채번(WP-021)·재채번(WP-022)·앵커/범위 API(WP-023)·릴리스 수집과 포함 관계(WP-024)가 섰다. 화면(WP-025·WP-026)이 남았다 | REL-003 잔여 WP |
| ~~릴리스 태그 앵커가 `ANCHOR_UNRESOLVABLE`을 반환~~ | FR-SEQ-003 AC-1 / CR-027 DEV-132 | **해소** (2026-08-24, WP-024) — PostgreSQL `release` 표를 근거로 해석한다. `ANCHOR_UNRESOLVABLE`은 미수집(`release_not_indexed`)·미존재(`tag_not_found`)에만 남고 사유를 가른다. 미러가 태그를 갱신하지 않는다던 기록 사유는 실측으로 반증됐다(DEV-143) | - |
| ~~범위 요약에 `reverted_pull_request_count` 키가 없음~~ | FR-SEQ-002 AC-2 / CR-027 DEV-133 | **해소 (2026-08-26, CR-041 / WP-030, DEV-239)** — 되돌림 파생이 서면서 `link_summary.is_reverted`가 실제 값을 갖게 됐고, 요약 집계 왕복 안의 `filter` 집계로 계산한다. 그전까지 키를 넣지 않은 이유(세면 언제나 0이고 그 0이 "없다"와 구분되지 않는다)는 이제 성립하지 않는다 | 없음 |
| 범위 조회 p95 실측이 PostgreSQL 구간뿐 | WP-023 DoD / NFR-001 | 부분 실측 — PostgreSQL 3질의 p95 7.50ms(5000건). ES 집계 왕복 포함 전체 p95는 로컬 ES 부재로 NOT RUN (DEV-058과 같은 사정) | 성능 harness가 서는 시점에 전체 경로 실측 |
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
| **문서 검증기 `--strict`의 핸드오프 게이트가 자기 검색어를 센다** | `validate_srs_prd_env.py` / CR-040 (PR #45 리뷰 P1) | **실제 상태 — 도구의 문제다.** `--strict`는 `origin/main`에서도 종료 코드 1이며 ERROR 2건(`change_control.md` 9 · 이 문서 5)을 낸다. 게이트는 네 낱말(영문 약어 둘·한글 표현 둘)을 문서 전문에서 세는데, **9건 중 5건이 `change_control.md` 395행 한 줄** — 이 저장소가 기록해 둔 **미결 표식 검색 명령 그 자체**에서 나온다. 나머지는 과거 상태를 서술하는 산문이고 채워야 할 빈칸이 아니다. **오탐을 설명하는 것만으로 수가 는다**: CR-040 작성 중 그 낱말들을 인용했더니 두 파일이 각각 다섯씩 늘었다(9→14, 5→10) — 검사가 코드 펜스·인용 안을 가리지 않는다. 그래서 CR 통과 판정은 `exit 0`이 아니라 **"이 변경이 새 issue를 만들지 않았는가"**(main 대비 증감 0)로 쓴다 | 별도 작업 — 검사 범위를 코드 펜스·인라인 코드 밖으로 좁히거나 게이트가 무시할 표식을 정한다. **문서를 고쳐 게이트를 통과시키지 않는다** — 서술문을 지우면 이력이 사라진다 |
| `docker compose up`이 이 실행 환경에서 검증되지 않음 | 인프라 8장 / DEV-001 | 실제 제약 (레지스트리 이그레스 차단) | 레지스트리 접근 가능한 환경에서 재검증 |
| 워크스페이스 패키지 5종(`query`·`es`·`db`·`github`·`bus`)이 식별 정보만 내보냄 | WP-001 구현 범위 | 실제 상태 (의도된 골격) | WP-002·WP-003·WP-005·WP-006·WP-025 |
| ~~`web`이 Conductor 디자인 시스템을 아직 쓰지 않음~~ | WP-001 제외 목록 (화면 제외) | 해소 (2026-08-21) — WP-015가 `AppShell`·`TopBar`·`NavList`·`EmptyState`·`Banner` 위에 셸을 세웠다. CSS는 루트 레이아웃에서 1회 import한다 (ADR-006) | 없음 |
| 각 앱 헬스체크가 백킹 서비스 연결을 확인하지 않음 | WP-001 구현 범위 (프로세스 기동만) | `ingest-gateway`는 해소 — `GET /healthz`가 PostgreSQL을 확인하고 실패 시 503 (인프라 3장). **`search-api`는 WP-013에서도 해소하지 못했다** — 검색 경로는 열렸으나 `/healthz`는 여전히 프로세스 기동만 본다. 서버가 ES 핸들만 받고 PostgreSQL 핸들은 받지 않아(`resolveNames` 클로저 안에 있다) ES만 확인하면 PG가 죽어도 `ok`가 나간다 — 반만 확인하는 헬스체크가 없는 것보다 나쁘다 | `search-api`는 서버에 PG 핸들을 넘기는 별도 변경 (WP-013 구현 범위·DoD 밖), `web`·`pipeline-worker`는 기존대로 |
| 통합 테스트가 testcontainers가 아니라 외부 PostgreSQL에 붙음 | WP-002 검증 방법 / DEV-006 | 실제 상태 (환경 변수로 접속 정보 주입) | WP-003에서 ES와 함께 재검토 |
| `saved_search`·`bisect_session`에 리포지터리 계층이 없음 | WP-002 구현 범위 (6종만 명시) | 실제 상태 (스키마는 존재). **`permission_cache`·`app_user`·`team`·`team_member`는 해소** (2026-08-21) — `authRepo`가 세웠다. (후속의 WP-024 표기는 오기였다 — 릴리스 수집과 무관하다) | WP-033·WP-042 |
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
| 화면 대부분이 아직 없다 | 각 화면이 자기 WP 소관 | 실제 상태 (의도) — **`/`·`/search`·`/pr/...`·`/commit/...`이 선다.** `/ranges`·`/releases`·`/stats`·`/ops/*`는 이동은 되지만 404다 | WP-025 이후 각 화면 WP |
| `⌘K`가 셸 슬롯이 아니라 화면 안의 입력을 잡는다 | DEV-070 / WP-016 구현 | 실제 상태 — WP-016은 C-010을 **W-001 화면 안**에 두었다(질의가 URL 단일 진실이라 화면이 소유해야 한다). 셸의 `omniSearch` 슬롯은 비어 있어 `⌘K`가 아무것도 잡지 않는다 — 셸 단축키가 화면의 입력에 닿으려면 슬롯에 넣어야 한다 | 전 화면 공통 옴니 입력을 셸에 올리는 별도 변경 (WP-017 이후 화면이 늘 때 판단) |
| 좁은 화면(≤800px) 동작을 실제 뷰포트에서 확인하지 못함 | jsdom에 뷰포트·CSS가 없음 / DEV-073 | 실제 상태 — 서랍 버튼의 **존재·키보드 도달·여닫기·포커스 복귀**는 a11y 시험이 건다. 그 버튼이 800px 이하에서만 보인다는 것은 Conductor의 `.cdt-topbar__menu-button` 규칙을 읽어 확인했을 뿐 **실행으로 확인하지 않았다** | 뷰포트를 좁히는 e2e를 화면 WP에서 함께 세운다 |
| 세션 만료 후 경로 복귀가 `/` 하나에서만 실증됨 | WP-015 범위 (화면 없음) | 실제 상태 — `return_to` 생성·무해화·왕복·재무해화는 전부 시험이 걸지만, 실제로 그 경로를 만드는 화면이 `/`뿐이다 | **`/search`가 더해져 둘이 됐다.** 화면이 늘수록 넓어진다 |
| W-001의 패싯이 늘 `not_computed` | WP-016 제외 목록 (패싯 데이터는 WP-032) / CR-019 DEV-076 | 실제 상태 (의도) — `/search`가 `facets`·`facets_omitted` 키를 넣지 않으므로 레일이 **사유를 표시하고** 선택 UI를 그리지 않는다. 조용히 비우지 않는다 | WP-032 |
| ~~결과 목록의 시퀀스가 늘 `not_computed`~~ | CR-019 DEV-077 | **해소 (2026-08-23, WP-021)** — 채번이 서수를 붙이고 `applySequenceToDocuments`가 커밋·PR 문서에 싣는다. 미머지(`unassigned`)와 다른 배지로 그리는 구분은 그대로다 | 없음 |
| JOB-MIR-002 스윕이 `repository_id` 순으로 배치 상한을 채운다 | CR-038 / PR #42 리뷰 정정 중 확인 | **실제 상태 — 알고 두었다.** 한 회차가 500건을 `repository_id` 순으로 집으므로 밀린 커밋이 그보다 많으면 낮은 번호의 저장소부터 순서대로 처리된다. 보강이 끝난 커밋은 다음 회차의 대상에서 빠지므로 backlog는 날짜를 두고 빠지지만, **색인 투영이 지속적으로 실패하는 커밋**은 매 회차 같은 자리를 차지한다. 주 전달은 이벤트 세 방아쇠이고 스윕은 보정이라 이 순서가 정확성을 깨지는 않는다 | 별도 CR (공정 배분·영구 실패 격리) |
| 백필(JOB-ING-004)의 전량 열거가 `updated` 정렬이라 항목을 건너뛸 수 있다 | CR-037 DEV-204 (부트스트랩만 정정) | **실제 상태 — 알고 두었다.** 스캔 중 갱신된 PR이 목록 끝으로 이동하면 뒤 항목이 이미 지나온 페이지 자리로 당겨져 방문되지 않는다. 부트스트랩(JOB-ING-010)은 완결 표시를 찍으므로 `created` 정렬로 고쳤지만, 백필은 완결 표시가 없고 **조정 스캔(JOB-ING-005)이 누락을 찾아 재투입**하므로 이 CR에서 건드리지 않았다 — DEV-098이 정한 `direction: asc` 의미와 커서 재개 규칙을 함께 다시 봐야 하는 변경이라 별도 CR이 맞다 | 별도 CR (WP-019 소관) |
| 채번은 push 웹훅이 온 저장소만 따라간다 | WP-021 구현 범위 | 실제 상태 (의도) — 백필로 과거 PR을 채운 저장소는 **첫 push가 올 때까지** 시퀀스가 없다. 잡 카탈로그가 "백필 완료"도 트리거로 적지만 그 연결은 WP-028(조정 스캔)이 맡는다 | WP-028 |
| ~~재작성된 시퀀스 공간이 `stale`로 멈춘다~~ | WP-021 제외 → **WP-022가 해소** | **해소 (2026-08-23)** — 감지가 재채번으로 이어진다: 에폭 증가, base까지 복사, 이후 재채번, EVT-SEQ-002 + 감사 기록. 이전 에폭 행은 보존된다 | 없음 |
| 수동 재채번 경로가 없다 | WP-022 제외 (API-ADM-007 POST는 WP-028) | 실제 상태 (의도) — 자동 감지 경로만 있다. 감지가 놓친 어긋남(정합성 점검이 찾는 종류)은 수동으로 고칠 길이 아직 없다. 잡 유형 이름 불일치(DEV-128)도 그때 푼다 | WP-028 |
| `epoch_stale`이 화면에 보이지 않는다 | 판정 규칙만 섰다 (CR-026, DEV-126) | 실제 상태 — 조회가 에폭 비교로 계산할 규칙은 정해졌고 데이터도 있으나, 그것을 그리는 W-004(에폭 경고 배너)와 표식 조회는 아직 없다 | WP-025, REL-006 |
| 결과 행에 관계 배지 열이 없음 | CR-019 DEV-081 (`C-015`는 WP-031 소관, `link_summary`는 WP-029까지 빈다) | 실제 상태 (의도) — **빈 열을 미리 두지 않는다.** 사용자가 "관계 없음"으로 읽는다 | WP-031 |
| ~~`/search` 결과 행이 가리키는 상세 화면이 없음~~ | W-002·W-003이 WP-017·WP-018 | **해소 (2026-08-22)** — WP-017이 `/pr/...`을, WP-018이 `/commit/...`을 세웠다. 결과 행·해석 후보·W-002 커밋 목록이 가리키는 곳이 모두 실재하고, FLOW-002 전 경로가 실제 브라우저에서 이어진다 | 없음 |
| 최근 검색 목록이 비어 있음 | CR-019 DEV-079 (저장 위치 미정) | 실제 상태 — prop을 선택으로 낮추고 비면 그리지 않는다. **저장 설계를 지어내지 않았다** — 서버에 보내면 조사 이력이 서버 기록이 되는데 요구한 문서가 없다 | 사용자 결정 후 |
| 접근 범위 산출이 등록 저장소마다 GHE를 한 번씩 부름 | FR-AUTH-002 AC-1이 "read 이상 권한을 가진 저장소"를 요구 / **OD-002 확정 (CR-024) — 이 경로가 최종이다** | 실제 상태 — 협업자 권한 API가 조직 기본 권한·팀·직접 협업자를 모두 반영한 실효 권한을 주므로 정확하다. 대신 캐시 미스마다 등록 저장소 수만큼 호출이 나간다(동시 8, 캐시 5분, 사용자별 요청 병합). **저장소 수가 커지면 재검토가 필요하다** | **등록 저장소 1,000개 초과 시 조직 단위 조회 CR** — CR-024가 정한 임계이며, 문서에서 파생한 값이 아니라 그 결정이 고른 값이다 |
| 운영 집계 두 곳이 접근 범위를 거치지 않음 | CR-015 DEV-051 → **CR-024로 계약 확정** | **경계는 정해졌고 코드는 아직 옛 동작이다.** 확정된 계약: 저장소를 식별하지 않는 전역 수치(`enrichment_pending` 포함)는 접근 범위 예외이고, `slowest_repositories`는 범위 안 저장소만 식별하며 걷어 낸 개수를 `slowest_repositories_out_of_scope`로 함께 낸다. **현재 코드는 여전히 저장소 이름을 범위와 무관하게 싣는다** — `operator` 역할 뒤에 있고 운영 콘솔(WP-040)이 아직 없어 실사용자에게 노출되지 않는다 | **WP-040 전까지 반영** (아키텍처 테스트 허용 목록도 두 갈래로 나눈다) |
| 문서에 `allowed_team_ids`가 한 건도 실리지 않음 | CR-024 DEV-114 | 실제 상태 — 매핑 넷이 선언하고 강제 필터·`team:` 필터가 읽지만 투영이 쓰지 않고 `repository` 테이블에 열도 없다. **통합 시험이 문서를 손으로 심으면서 이 필드를 직접 넣어 초록이 나온다.** 유출이 아니라 누락이다 — `team:` 질의가 늘 0건이고 `org_team` 경로가 팀으로만 보이는 비공개 저장소를 빠뜨린다 | WP-068 |
| 커밋 문서에 커밋 자체 메타데이터가 없음 | CR-023 DEV-112 → CR-024가 잡을 정의 | 실제 상태 — `message`·`author`·`parent_shas`·`changed_paths`·`patch_id`가 비어 있다. WP-020은 **읽는** 계층만 세웠다 | WP-067 (`JOB-MIR-002`) |
| 권한 매트릭스가 API 계층까지만 검증됨 | NFR-005는 역할 6종 × 화면 13종 | 실제 상태 — 역할 6종 × 역할 요구 경로는 통과한다. 화면이 없어 13종 축을 걸 수 없다 | WP-015 이후 |
| 세션이 Redis에만 있어 Redis 유실 시 전원 재로그인 | 보안 문서 4장 (의도된 결정) | 실제 상태 — PostgreSQL 백업을 두지 않는다. 세션을 두 곳에 두면 로그아웃이 두 곳 모두에서 성립해야 하고, AC-5를 어길 자리가 하나 더 생긴다 | 없음 (의도된 동작) |
| `search-api`가 GHE 자격 증명 없이는 세션 인증을 세우지 않음 | FR-AUTH-002 AC-1 (접근 범위 산출에 GHE가 필요) | 실제 상태 — 자격 증명이 없으면 모든 조회가 503이 되므로, 인증이 구성되지 않았다고 기동 로그에 남기고 토큰 통제로 돌아간다 | 없음 (의도된 동작) |
| 목록 조회 p95(NFR-001)가 측정되지 않음 | WP-013 DoD / DEV-058 | **NOT RUN** — 1000만 문서 합성 데이터셋도 `pnpm test:perf` 스크립트도 이 환경에 없다. 예산을 지키는 구조(완화 힌트 왕복 1회, `track_total_hits` 상한 1만, ES 마감 3초)만 시험으로 고정했다 | **REL-002 성능 게이트 전 필수** |
| `relevance` 정렬이 실질적으로 문서 ID 순 | CR-016 DEV-056 / 전문 검색이 WP-032 | 실제 상태 (의도된 계약) — 접근 범위 필터도 사용자 필터도 전부 `filter` 문맥이라 모든 문서의 점수가 같다. 키를 400으로 거절하지 않고 받되, 지금 무엇인지 계약에 적었다 | WP-032가 점수 절을 더한다 |
| `/search` 응답에 `facets`가 없고 `next_cursor`가 항상 `null` | WP-013 제외 목록 (패싯·커서는 WP-032) / CR-016 DEV-057 | 실제 상태 (의도된 구분) — `next_cursor`는 키를 두고 `null`을 실어 "다음 페이지 없음"을 말하고, `facets`는 키 자체를 넣지 않아 "세지 않았다"와 "세었는데 없다"를 구분한다 | WP-032 |
| 전문 검색어(`q`의 자유 문자열)가 조회에 쓰이지 않음 | WP-013 제외 목록 (전문 검색은 WP-032) | 실제 상태 — 파서가 `parsed.text`로 응답에 실어 사용자가 무시된 것을 볼 수 있다. 조용히 버리지 않는다 | WP-032 |
| 이미 색인된 문서에 `doc_id`가 없어 정렬 뒤로 밀림 | CR-016 DEV-059 | 실제 상태 — `upsert`가 생성 본문과 스크립트 `params.doc` 양쪽에 넣으므로 **다음 이벤트에서 채워진다.** 그때까지는 `missing: _last`로 뒤에 선다. 이 저장소에는 아직 운영 데이터가 없어 실질 영향이 없다 | 백필(WP-019) 또는 재색인(WP-035)이 지나면 사라진다 |
| 완화 힌트 후보가 8개로 잘림 | CR-016 DEV-055 | 실제 상태 (의도된 상한) — 넘으면 `relaxation_hints_truncated: true`를 실어 조용한 절삭이 "이것이 전부"로 읽히지 않게 한다 | 없음 |
| 직접 푸시 커밋을 조회할 수 없음 (`direct_push` 역할 도달 불가) | CR-017 DEV-061 / FR-SRCH-002 AC-3, QA-W003-03 | **실제 상태 — WP-018도 해소하지 못했다.** 화면은 역할 배지 매핑에 세 값을 모두 두고 합성 입력으로 걸었으나 서버가 그 값을 내지 못한다. **`reason_code: 'no_pull_request'`를 "직접 푸시"로 부르지 않는다**(DEV-093) — 그것은 "아직 못 이었다"이고, 섞으면 PR 리뷰를 거치지 않은 커밋이라는 거짓이 된다. — 커밋 문서가 PR 이벤트에서만 만들어지고 `push`는 ack 후 버려진다(DEV-016). 직접 푸시 커밋은 문서 자체가 없어 조회가 404다. API 계약과 타입은 그 값을 표현할 수 있게 두어, 값이 생겼을 때 계약을 다시 고치지 않게 했다 | **WP-021** (push 이벤트 라우팅) |
| 커밋 상세에 메시지·작성자·부모 SHA·파일 목록이 없음 | CR-017 DEV-060 / WP-008이 남긴 한계 | 실제 상태 — `EVT-ING-002`가 커밋에 대해 SHA만 나른다. 채워지지 않은 필드는 **키를 넣지 않아** "만들지 않았다"와 "만들었는데 비었다"를 구분한다. 커밋의 표시명은 SHA 축약이다 | WP-020 (미러 기반 커밋 보강) |
| PR 상세의 원본 커밋에 제목·작성자·작성 시각이 없음 | CR-017 DEV-062 / FR-SRCH-003 AC-3 | 실제 상태 — PR 문서는 SHA 배열만 갖고 커밋 문서를 조인해도 메시지가 없다. 배열 **모양은 객체**로 두어 WP-020이 키를 더할 때 계약을 고치지 않아도 되게 했다 | WP-020 |
| 250건 초과 원본 커밋의 **진짜 총계를 모름** | CR-017 DEV-063 / FR-SRCH-003 AC-4 | 실제 상태 — 보강 payload가 총계를 나르지 않는다. 250을 총계로 내보내면 거짓이므로 **키를 빼고** `source_commits_truncated: true`만 남긴다 | `EVT-ING-002` 확장 CR |
| 릴리스 태그를 식별자로 판별하지 않음 | CR-017 DEV-065 / 해석 순서 7단계 | 실제 상태 — 다만 **막던 것이 바뀌었다** (2026-08-24): WP-024가 릴리스 데이터를 세웠으므로 이제 패턴 추측이 아니라 **`release` 표 조회(정확 일치)**로 판별할 수 있다. 릴리스 앵커가 이미 그 방식이다. `/resolve` 배선만 남았다 | `/resolve` 소유 WP의 후속 (WP-014 연장) — 표 조회로 구현, 정규식 금지 원칙 유지 |
| 단건 해석 p95(NFR-001)와 ADR-012의 선택도 근거가 측정되지 않음 | WP-014 DoD / DEV-058 | **NOT RUN** — 커밋 1000만 건 데이터셋이 없다. 접두가 겹칠 때 후보가 여럿 나온다는 **동작**만 확인했고, "5000만 커밋에서도 통상 1건"이라는 ADR-012의 **근거**는 확인하지 못했다 | **REL-002 성능 게이트 전 필수** |
| `/resolve`가 자유 텍스트를 전문 검색으로 위임하지 않음 | WP-014 범위 (전문 검색은 WP-032) | 실제 상태 — `detected_kind: 'text'`로 판별만 하고 후보는 빈 배열이다. 화면이 그 신호를 받아 `/search`를 부른다 | WP-016 (화면 결합), WP-032 (전문 검색) |
| 문서당 `EVT-ING-003`이 하나씩 발행됨 (PR 1 + 커밋 N) | 비동기 문서 4장의 payload가 엔티티 단위 | 실제 상태 — 커밋 250건 PR이면 251건이 나간다. `noop`은 내지 않아 재처리 시에는 줄어든다 | 관계 워커(WP-029) 실측 후 필요하면 CR |
| 커밋 상세의 **헤더에 메시지·작성자·시각이 없다** | CR-021 DEV-090 / DEV-060 | 실제 상태 — 커밋 문서가 SHA만 갖는다. **소속 PR에서 빌려오지 않는다**: 한 PR의 원본 커밋 N건이 전부 같은 제목으로 보이면 체리픽·되돌림 조사가 반대 결론에 이른다. 표시명은 축약 SHA이고 화면이 왜 없는지 적는다 | WP-020 (미러 기반 커밋 보강) |
| 커밋 상세의 **변경 경로가 골격뿐** | CR-021 DEV-094 / DEV-060 | 실제 상태 — `changed_paths`·`changed_files_count`가 채워지지 않는다. 섹션은 숨기지 않고 사유를 적으며, 총계를 `0`으로 그리지 않는다(*파일을 하나도 바꾸지 않은 커밋*과 같아진다). **파일 내용 미표시(`QA-W003-08`)는 금지 규칙이라 지금 세웠다** | WP-020 |
| `flow-001` "히스토리 규율" e2e가 **간헐 실패** | WP-016 / 2026-08-25 WP-027 검증 중 관찰 | **관측값 갱신 (2026-08-26).** 이 로컬 환경의 전체 실행에서 **5회 중 4회 실패**한다(이전 기록은 6회 중 2회). 단독 실행은 4/4 통과이고 **CI에서는 통과한다** — PR #41·#42의 `verify` 잡이 같은 `pnpm test:e2e`를 돌려 녹색이었다. 부하가 높을수록 드러나는 타이밍 취약성으로 보인다. **이 세션이 만든 것이 아니다**: `apps/web` 아래 파일을 한 개도 바꾸지 않았고(`git log 5e18e00..HEAD -- apps/web`이 비어 있다) 그 시험은 `page.route('**/api/**')`로 모든 API 호출을 가로채므로 이번에 고친 `detail.ts`·`neighbors.ts`가 도달할 수 없다. "필터 5회 조작 후 뒤로가기 1회"라 단순 잡음이 아니라 히스토리 항목이 가끔 더 쌓이는 결함일 수 있다 — **원인 미확인이며 재시도로 가리지 않는다** | WP-016 소관, 별도 조사 필요. **CR-042(WP-031) 재실측 (2026-08-26)** — 이번 WP는 `apps/web`을 **실제로 바꿨으므로** "화면 코드 diff 0"이라는 기존 귀속 근거를 쓸 수 없다. 그래서 되돌려 재고 비교했다. **변경을 stash해 화면 코드를 `main`과 동일하게 만든 상태에서 전량 3회 중 1회가 같은 시험·같은 단언·같은 오류로 실패했다**(`flow-001.spec.ts:127`, `expect(page).toHaveURL(/author%3Akim/)`, 5초 타임아웃). 변경을 얹은 상태는 전량 8회 중 4회 실패이고 **단독 실행은 4/4 통과**다. 6회차에서 `flow-003.spec.ts:176`("뒤로가기로 커밋 상세를 거쳐 검색으로 돌아온다")도 같이 실패했다 — **두 실패 모두 뒤로가기 복원 상태를 5초 안에 확인하는 형태**이고, 이것이 이 취약성이 히스토리 복원 타이밍에 있다는 첫 두 번째 증거다. 관계 e2e(`flow-006`)는 **7회 전부 통과**했고 실패한 두 시험은 관계 코드에 닿지 않는다. 시험 수가 67 → 78로 늘어 단일 worker의 전체 실행 시간이 길어진 것이 노출 빈도를 올린 것으로 보이나 **그것은 추정이며 원인 규명이 아니다.** 재시도로 가리지 않는다 |
| ~~커밋 상세의 시퀀스 위치가 앞뒤 인접 커밋 없이 상태만~~ | WP-018 제외 목록 (데이터는 WP-027) | **해소** (2026-08-25, WP-027) — 커밋 앵커로 앞뒤 목록과 "범위로 확장"이 섰다. 체인 밖·미채번은 역할로 가려 조회하지 않는다 | - |
| 백필의 실시간 영향(AC-3)이 **측정되지 않음** | WP-019 DoD / DEV-058과 같은 형태 | **NOT RUN** — 운영 규모 데이터셋도 부하 harness도 이 환경에 없다. 예산을 지키는 **구조**만 세웠다: 모든 백필 호출이 `priority: 'backfill'`이고 역할 분리로 워커 풀을 나눌 수 있다 | **REL-002 성능 게이트 전 필수** |
| ~~백필이 릴리스를 채우지 않음~~ | FR-ING-006은 "과거 PR·커밋·**릴리스**"를 요구 / 릴리스 수집이 WP-024 | **해소** (2026-08-24, WP-024) — 릴리스는 항목별 백필이 필요 없다: 동기화가 미러 refs/tags **전량 스냅숏 diff**라 과거 태그까지 한 번에 실린다. 남는 것은 시차뿐 — 신규 등록 저장소는 첫 태그 웹훅 또는 6시간 스윕까지 기다린다(백필 완료가 즉시 갱신을 트리거하지 않는다 — `BackfillDeps`에 버스가 없다, JOB-SEQ-001과 같은 기존 공백) | 백필 완료 → 갱신 신호 배선은 별도 정리 (시퀀스와 같은 자리) |
| 백필 진행률의 `total`이 마지막 페이지 전까지 `null` | WP-019 구현 / GitHub `/pulls`가 총계를 주지 않음 | 실제 상태 (의도) — **`done`을 총계로 쓰지 않는다.** 쓰면 언제나 100%로 보여 운영자가 끝난 줄 안다. 마지막 페이지에 닿아야 총계를 안다 | 없음 (GHE API의 한계) |
| **통합 시험의 `delete_by_query` 정리가 refresh되지 않은 문서를 놓친다** | 이 저장소의 통합 스위트 공통 패턴 (`worker/project.test.ts`·`ops/pipeline-status.test.ts`·`admin/repositories.test.ts`·`jobs/backfill.test.ts`) | 실제 상태 — `delete_by_query`는 검색으로 대상을 찾으므로 인덱스의 `refresh_interval`(1초)보다 짧은 간격으로 이어지는 시험 사이에서는 앞 시험이 남긴 문서를 **보지 못한다.** `refresh: true`는 지운 *뒤에* 새로 고치는 옵션이라 이것을 풀지 않는다. **PR #21에서 실제로 터졌다** — 문서 하나가 살아남아 집계가 3이 됐다. `jobs/backfill.test.ts`는 정리 전에 refresh하도록 고쳤고, **나머지 세 스위트는 이 PR에서 건드리지 않았다**(지금은 초록이고 WP-019 범위 밖이다) | 남은 세 스위트에도 같은 한 줄을 넣는 별도 정리 |
| **미러 스윕의 sleep이 중단 불가** — stop()이 최대 6시간 타이머를 기다린다 | `mirror-runner.ts` (WP-020 기병합) / Codex 리뷰가 릴리스 스윕의 같은 결함을 지적 (PR #29에서 릴리스 쪽만 수정) | 실제 상태 — 릴리스 스윕은 깨울 수 있는 sleep으로 고쳤고(6.24장), 미러 스윕은 같은 5줄 수정이 필요하다. 그때까지 SIGTERM 시 미러 스윕이 종료를 지연시킬 수 있다 | 같은 패턴의 별도 정리 (WP-020 후속) |
| **로컬에서 못 도는 통합 시험은 Elasticsearch 의존분뿐이다** | DEV-006·DEV-008이 "Docker가 없어 통합 시험 NOT RUN"으로 적어 온 것의 정정 | 실제 상태 — 이 환경에 네이티브 **PostgreSQL 16.13**과 **`redis-server`**가 있다. 그 둘만 쓰는 **19파일 181건이 로컬에서 통과한다.** 없는 것은 ES뿐이고 거기 걸린 것이 12파일이다. **이 사실을 WP-019 착수 때 확인하지 않아 AC-6 결함(DEV-107)이 CI까지 갔다** — 상한은 PostgreSQL만의 성질이라 로컬에서 잡을 수 있었다 | ES 의존 시험은 여전히 CI가 처음 판정한다. 앞으로는 착수 시 ES 비의존분을 먼저 돌린다 |
| **기본 설정에서 patch-id가 나오지 않는다** | CR-023 DEV-111 → **CR-024로 확정** / ADR-005 vs THR-015·인프라 5장 | 실제 상태 (의도된 선택) — `git patch-id`가 blob을 요구하고 blobless 미러에는 blob이 없다. 지연 인출을 켜면 소스가 볼륨에 쌓여 THR-015의 완화 근거와 용량 산정이 무너진다. **요구사항(THR-015·용량)을 ADR의 Positive보다 앞세웠고**, FR-REL-005 AC-5가 정의한 `patch_id_unavailable` 경로로 간다. `MIRROR_ALLOW_BLOB_FETCH=true`로 켤 수 있고 켜지면 기동 로그가 경고한다 | **결정 완료 (CR-024)** — 볼륨을 blobless로 유지하는 쪽. FR-REL-005 AC-2를 조건부로 좁혀 SRS에 반영했으므로 **이제 이것은 미구현이 아니라 명세대로의 동작이다** |
| 커밋 메타데이터가 여전히 비어 있다 | CR-023 DEV-112 → **CR-024가 잡을 정의** / DEV-090·DEV-094와 같은 자리 | 실제 상태 — 그래프 접근 계층은 섰지만 그 값을 커밋 문서에 쓰는 코드가 아직 없다. **잡은 이제 정의되어 있다** (`JOB-MIR-002`) | **WP-067** |
| 미러 스윕 루프와 지표 보고에 시험이 없다 | WP-020 구현 (`mirror-runner.ts`) | 실제 상태 — 미러 동기화 자체(clone·fetch·prune·실패·폴백)는 통합 시험이 걸지만 6시간 스윕 루프와 `mirror_disk_usage_ratio` 보고는 걸지 않았다. **변이 시험도 돌리지 못했다** | 스윕에 시험을 붙이는 별도 정리 |
| PR 상세의 **관계**가 골격뿐 (릴리스·선행·후행은 해소) | WP-017 제외 목록 (데이터는 WP-024·WP-027·WP-031) | **부분 해소** (2026-08-25) — 선행·후행 섹션(C-019)은 WP-027로 실데이터가 붙었다(6.27장). 관계만 WP-031에 남는다. 이전 갱신: (2026-08-24) — 포함 릴리스 섹션(C-020)은 WP-024로 실데이터가 붙었고 네 상태(포함/미배포/미수집/미채번)를 사유와 함께 그린다. 선행·후행(WP-027)·관계(WP-031)는 여전히 골격이며 숨기지 않고 사유를 적는다 | WP-027, WP-031 |
| PR 상세 타임라인의 **승인 시각을 모름** | CR-020 DEV-084 / `approved_at`이 ES 매핑에 없음 | 실제 상태 — `approved_by`로 **일어난 것은 알고 시각만 모른다.** `done_at_unknown`으로 그리고 사유를 함께 적는다. `pending`으로 그리면 승인된 PR이 "승인 대기"가 된다 | 매핑에 `approved_at`을 더하는 별도 CR (투영과 `EVT-ING-002` 함께) |
| 리뷰어별 상태가 "승인함 / 아직 아님" 둘뿐 | CR-020 DEV-085 / 투영이 리뷰어별 상태를 저장하지 않음 | 실제 상태 — "변경 요청"을 **지어내지 않는다.** `reviewers`·`approved_by` 두 로그인 목록만으로 파생할 수 있는 것이 이 둘이다 | 투영이 리뷰 상태를 저장하도록 하는 별도 CR |
| `epoch_stale` 화면 상태가 없음 | CR-020 DEV-087 / 시퀀스가 WP-021까지 전부 `null` | 실제 상태 (의도) — **도달할 수 없는 코드를 만들지 않았다.** 에폭 변경을 감지할 경로도 정해져 있지 않다 | **WP-021**이 시퀀스와 함께 감지 경로를 정한다 |
| W-001 결과 표가 `repository_archived`·`files_truncated`를 표시하지 않음 | CR-020 DEV-089 (W-002만 열었다) | 실제 상태 — **W-002는 둘 다 표시한다.** 목록 쪽은 행마다 배지를 더하면 밀도 설계를 다시 해야 하고 그것은 WP-016의 완료된 범위라 이번에 건드리지 않았다 | 목록 표시가 필요하다고 판단되면 별도 CR |
| 관계 조회 API가 없어 간선이 화면에 보이지 않음 | WP-029 제외 목록 / CR-039 | 실제 상태 (의도) — WP-029는 간선을 **만들고** 요약(`link_summary.reference_count`)만 문서에 싣는다. 조회·그래프 탐색은 WP-031이다 | WP-031 |
| 관계 조회가 대상 저장소 접근 범위를 다시 교집합해야 함 | CR-039 DEV-224 / THR-034 | **미구현 요구** — 간선의 범위는 근거를 소유한 저장소의 것이다. WP-029는 조회 API를 만들지 않아 현재 유출 경로가 없으나, **대상의 제목·본문을 반환하는 순간 이 강제가 없으면 유출**이다 | **WP-031의 필수 수용 기준** |
| 축약 SHA 참조는 유일할 때만 해결됨 | CR-039 / ADR-012 | 실제 상태 (의도) — 0건·2건 이상은 미해결로 남는다. 첫 결과를 임의로 고르면 조사 도구가 자신 있게 틀린 답을 낸다. 나중에 모호해진 간선은 **되돌린다** | 없음 |
| 등록되지 않은 저장소·승인되지 않은 호스트를 가리키는 참조는 영구 미해결 | CR-039 / THR-036 | 실제 상태 (의도) — 임의의 외부 GitHub 조회로 확장하지 않는다. 그 저장소가 나중에 등록되면 재파생(JOB-REL-006)이 해결한다 | 없음 |
| ~~화면 라우트 셋이 세션 확인 다섯 줄을 각자 복제~~ | WP-015가 세운 라우트 구조 | **해소 (2026-08-22)** — WP-018이 `GuardedPage` 하나로 묶었고 라우트 넷이 모두 그것을 지난다. 정적 검사도 "다섯 줄이 있는가"에서 **"관문을 지나는가, 세션을 직접 만지지 않는가"**로 바꿨다 | 없음 |

## 8. 다음 작업

현재 이 저장소는 **REL-002를 닫고 REL-003으로 넘어가는 지점**이며(WP-011~019 전부 병합), CR-005로 제품 범위가 확장되어 REL-007~011이 추가되었다.

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
37. ~~CR-021 WP-018 W-003 계약 정정~~ → 완료 (2026-08-22). DEV-090~096 해소. 구현 중 DEV-097을 추가 등록·해소했다. SRS 버전은 v2.2 유지(빈칸 메우기)
38. ~~WP-018 W-003 커밋 상세 화면~~ → 완료 (2026-08-22). 검증 결과는 6.18장. **DoD 4항 중 3항 통과, `QA-W003-03`이 절반**(`direct_push`는 WP-021). **FLOW-002 전 경로가 실제 브라우저에서 이어진다**
39. ~~CR-022 저장소 백필 계약 정정~~ → 완료 (2026-08-22). DEV-098~105 해소. SRS 버전은 v2.2 유지(빈칸 메우기)
40. ~~WP-019 저장소 백필 잡~~ → 완료·병합 (2026-08-22, `07f1cfe` / PR #21). 검증 결과는 6.19장. **DoD 6항 중 4항 통과, 1항 부분, 1항 NOT RUN.** CI가 세 번 판정해 두 번 실패했고 그 과정에서 코드 결함 둘(DEV-106·DEV-107)이 나왔다 — 특히 **동시 실행 상한(AC-6)이 처음에는 전혀 성립하지 않았다**

**REL-002의 조사 경로가 닫혔고 과거 데이터를 채울 길도 생겼다.** 붙여넣기(W-001) → 커밋(W-003) → PR(W-002)이 실제 브라우저에서 이어지고, WP-019가 그 화면들이 볼 과거 PR을 채운다.

~~**다음은 REL-003의 WP-020 커밋 그래프 접근 계층이다**~~ → **완료 (2026-08-22).** 검증 결과는 6.20장.

`CommitGraph` 인터페이스와 미러·API 두 구현, JOB-MIR-001 미러 동기화, 볼륨 사용률 지표가 들어갔다. **WP-021 시퀀스 채번이 딛고 설 바닥이 생겼다** — 이 제품의 핵심 주장인 **머지 순서**가 거기서 처음 실재한다.

그 과정에서 **ADR-005의 Positive 하나가 실측에서 다른 대가를 요구하는 것**이 드러났다(DEV-111). patch-id를 쓰려면 blob을 볼륨에 받아야 하고, 그러면 THR-015의 완화 근거가 성립하지 않는다. 기본을 "받지 않음"으로 두었고, **CR-024가 그것을 운영 기본값으로 확정했다** — OD-001이 미러를 허용한 근거가 바로 그 실측이므로 기본이 그 근거를 지켜야 한다. 체리픽 후보 판정(FR-REL-005 AC-2)은 그래서 **조건부 기능**이 되었다.

41. ~~CR-024 기한 도래분 결정 정리~~ → 완료 (2026-08-22). **OD-001·OD-002·OD-004 resolved**, DEV-051·DEV-112 해소, DEV-111 운영 기본값 확정, **DEV-114 신규 등록**. SRS **v2.3** (수용 기준 3곳을 좁혔고 신규 FR·NFR은 없다). WP-067·WP-068 신설

**결정을 미루는 것도 선택이고, 그 선택에는 값이 있다.** OD-001·OD-002의 기한은 REL-002 착수 전이었는데 REL-002가 이미 닫혔고, OD-004의 기한(REL-003 착수 전)은 WP-020 착수로 지났다. **셋 다 기한을 넘긴 채였다.** 넘긴 동안 WP-020은 "결정 전이라 두 경로 모두 구현"했고, DEV-051은 다섯 WP 동안 허용 목록에 남아 있었다. 지금 닫으면서 그중 **코드를 바꿔야 하는 것은 둘뿐이다** — `patch_id_unavailable` 매핑(이번에 함께 고쳤다)과 `slowest_repositories`의 범위 축약(WP-040 전까지). 나머지는 이미 결정대로 서 있었다.

~~**다음은 WP-021 시퀀스 증분 채번이다.**~~ → **완료 (2026-08-23).** 검증 결과는 6.21장.

42. ~~CR-025 시퀀스 채번 계약 정정~~ → 완료 (2026-08-23). DEV-115~120 해소. 구현 중 DEV-121~123을 추가 등록·해소했다. SRS 버전은 v2.3 유지(빈칸 메우기)
43. ~~WP-021 시퀀스 증분 채번~~ → 완료 (2026-08-23, `60c0aa1` / PR #25). 검증 결과는 6.21장. **DoD 8항 전부 통과.** 단위 1025건·통합 235건·회귀 5건

**이 제품의 핵심 주장이 실재한다.** "번호 순서 = 반영 순서"가 이제 코드로 있고, 그것이 참인지를 `git rev-list --first-parent --reverse`와 대조하는 회귀 계층이 매 실행마다 검사한다. Perforce Changelist가 주던 신뢰의 본질이 그 대조 가능성이었으므로(ADR-007), 이 검사가 도는 한 그 주장은 증명 가능한 상태로 남는다.

**시험이 결함 둘을 잡았고 그것이 이번 WP의 소득이다.** 첫 채번 실패가 아무 신호도 남기지 않던 것(DEV-122)과 접근 범위 우회를 만들 뻔한 것(DEV-123). 둘 다 코드를 읽어서가 아니라 **시험을 돌려서** 드러났다. 특히 DEV-123은 아키텍처 시험이 잡았는데, 그 시험이 없었다면 허용 목록이 워커 수만큼 늘어나는 길로 갔을 것이다.

~~**다음은 WP-022 시퀀스 재채번과 에폭이다.**~~ → **완료 (2026-08-23).** 검증 결과는 6.22장.

44. ~~CR-026 재채번 계약 정정~~ → 완료 (2026-08-23). DEV-124~127·129 해소, DEV-128은 WP-028로 이월. SRS 버전은 v2.3 유지(빈칸 메우기와 문서 오류 정정)
45. ~~WP-022 시퀀스 재채번과 에폭~~ → 완료 (2026-08-23, `2adc9dd` / PR #27). 검증 결과는 6.22장. **DoD 7항 전부 통과**
46. ~~CR-027 WP-023 앵커·범위 계약 정정~~ → 완료 (2026-08-23). DEV-130~140 등록: **범위의 정본을 PostgreSQL로 정정**(DEV-130), `index.sort` 방향 오류(DEV-131), 릴리스 앵커 근거 부재(DEV-132 → WP-024), 되돌림 수(DEV-133 → WP-030), 나머지 일곱은 값 단위·필터 의미·경계의 미정 자리. SRS는 건드리지 않았다
47. ~~WP-023 앵커 정규화와 범위 조회 API~~ → 완료 (2026-08-23, PR #28). 검증 결과는 6.23장. **DoD 8항 중 7항 통과** — p95는 PostgreSQL 구간만 실측(7.50ms/5000건), ES 포함 전체는 NOT RUN. 변이 30종 전부 잡힘 (1차 생존 3종은 시험 결함으로 판명, 구별 시험 추가)
48. ~~CR-028 WP-024 릴리스 계약 정정~~ → 완료 (2026-08-24). DEV-142~149 등록·해소: **릴리스 정본을 PostgreSQL로 정정**(DEV-142, ADR-004), 미러 태그 갱신 실측으로 기록 사유 반증(DEV-143), 잡·이벤트·스트림 등록(DEV-144), 태그 push 신호(DEV-145), 미수집 200+사유(DEV-146), `released_at`=creatordate+GHE 덮어쓰기(DEV-147), 가장 이른 5개(DEV-148), 에폭 재해석(DEV-149). SRS는 건드리지 않았다
49. ~~WP-024 릴리스 수집과 포함 관계~~ → 완료 (2026-08-24). 검증 결과는 6.24장. **DoD 7항 전부 통과.** 변이 12종 — 로컬 킬 11(생존 3종은 시험 결함, 구별 시험 추가 후 킬), 실-ES 전용 킬 1(M11, CI 판정). 실-ES 계층 작성 중 매핑 결함 둘을 푸시 전에 발견·수정
50. ~~CR-029 WP-025 범위 조사 계약 정정~~ → 완료 (2026-08-24). DEV-150~154 등록·해소: 되돌림 수 분할, 상태 매트릭스 부분집합, **API-SEQ-006 신설**, 경로 `/ranges` 통일, C-013 재사용 정정. SRS는 건드리지 않았다
51. ~~WP-025 W-004 범위 조사 화면~~ → 완료 (2026-08-24). 검증 결과는 6.25장. DoD 6항 전부 통과, 변이 7종 전부 킬
52. ~~CR-030 WP-026 W-005 릴리스 화면 계약 정정~~ → 완료 (2026-08-25). DEV-155~159 등록·해소: **API-REL-005 신설**, API-SEQ-003 재작성, 경로 `/releases` 통일, 목록을 저장소 스코프로, 빈 상태 병합. SRS는 건드리지 않았다
53. ~~WP-026 W-005 릴리스 화면과 구간 비교~~ → 완료 (2026-08-25). 검증 결과는 6.26장. **DoD 9항 중 8항 통과, QA-W005-05만 절반**(W-009 부재). 변이 9종 전부 킬. 구현 중 **DEV-160**(포함 판정이 저장 서수를 읽어 배포된 PR이 미배포로 보이던 결함)을 잡아 해소했다
54. ~~CR-031 WP-027 선행·후행 계약 정정~~ → 완료 (2026-08-25). DEV-161~167 등록·해소. **이 CR은 `srs_final.md`를 직접 고쳤다 — v2.4**(FR-REL-001에 직접 푸시 커밋 포함, 예외 사유 분리, 관련 화면에 W-003 추가). 신규 FR·NFR은 없다
55. ~~WP-027 선행·후행 조회와 상세 화면 통합~~ → 완료 (2026-08-25). 검증 결과는 6.27장. **DoD 10항 전부 통과.** 변이 8종 처리(하나는 등가 변이로 판명 후 재작성). DEV-087의 에폭 경고 이월이 닫혔다

**감지와 회복이 이어졌다.** 재작성이 나면 push 한 번으로 감지→에폭 증가→재채번까지 끝나고, 이전 에폭 인용은 조회의 에폭 비교로 `epoch_stale`이 된다. **AC-4의 핵심 결정은 "무효 표시는 쓰기가 아니라 비교"라는 것이다** (DEV-126) — 표식·세션·저장된 검색 어디에도 소급 쓰기가 없고, 각자 저장한 에폭이 곧 판정 근거다. `saved_search`를 만들 WP-033과 표식 화면을 만들 REL-006이 이 규칙 위에 선다.

~~**다음은 WP-023 앵커 정규화와 범위 조회 API다.**~~ → **완료 (2026-08-23).** 검증 결과는 6.23장.

~~**다음은 WP-024 릴리스 수집과 포함 관계다.**~~ → **완료 (2026-08-24).** 검증 결과는 6.24장. 릴리스 앵커(DEV-132 이월분)가 해석으로 바뀌었고, "이 PR이 어느 배포에 들어갔는가"(SCN-004)가 W-002·W-003에서 실데이터로 답한다.

~~**다음은 WP-025 W-004 범위 조사 화면이다.**~~ → **완료 (2026-08-24).** 검증 결과는 6.25장. FLOW-003(딥링크 → 정규화 → 조회 → 상세 → 복귀)이 처음으로 실제 브라우저에서 끝까지 걷혔다.

~~**다음은 WP-026 W-005 릴리스 화면과 구간 비교다**~~ → **완료 (2026-08-25).** 검증 결과는 6.26장.

**SCN-002가 화면으로 닫혔다.** 릴리스 목록에서 2건을 골라 W-004로 넘기는 경로가 실제 브라우저에서 이어지고, 미배포 구간도 같은 화면으로 들어간다. 셸의 "릴리스" 항목은 이 WP 전까지 404였다 — 경로를 문서 쪽(`/releases/[owner]/[repo]`)이 아니라 **구현된 셸 쪽**으로 통일한 것이 DEV-153에 이어 두 번째다.

**이번 WP가 남긴 교훈 둘.** ① **같은 사실을 두 곳에서 계산하면 언젠가 갈라진다** — 타임라인은 서수를 현재 에폭에서 다시 찾고 미배포는 저장 열을 읽고 있었고, 두 숫자가 어긋나면서 DEV-160(포함 판정 전체의 결함)이 드러났다. 판정을 하나로 모으는 것이 고침이었다. ② **등가 변이를 킬로 착각하지 않는다** — 중복 방어가 있는 코드는 한쪽만 지워도 답이 바뀌지 않는다(6.26장 M3).

~~**다음은 WP-027 선행·후행 조회와 상세 화면 통합이다.**~~ → **완료 (2026-08-25).** 검증 결과는 6.27장.

**SCN-003의 앞쪽이 섰다.** 의심 PR 주변을 W-002에서 확인하고 그 창을 그대로 범위 조사로 넘길 수 있다. 뒤쪽 절반(이분 탐색으로 후보 좁히기)은 WP-042다.

**이 WP가 남긴 것 둘.** ① **하위 문서가 상위 문서와 어긋나면 상위를 고쳐야 할 때가 있다** — FR-REL-001의 "인접한 PR"은 API 계약·화면과 모두 어긋났고, 낮은 쪽을 맞추면 서수가 건너뛴 목록이 된다. CR-031이 baseline을 직접 고친 첫 감사다. ② **등가 변이를 두 WP 연속으로 만났다** — WP-026은 중복 방어가 서로를 가렸고, 여기서는 도달하지 않는 분기를 건드렸다. 변이가 답을 바꾸는지부터 확인하는 것이 절차가 되어야 한다.

~~**다음은 WP-028 정합성 점검과 조정 스캔이다.**~~ → **완료 (2026-08-26).** WP-028·WP-068이 CR-034·CR-036·CR-037까지 닫혔다(6.28·6.28.1·6.30·6.30.1·6.32장).

~~**다음은 WP-067 커밋 메타데이터 보강이다 — REL-003의 마지막 WP다.**~~ → **완료 (2026-08-26, CR-038 / 6.33장).** 착수 전 감사가 아래 다섯을 실제로 찾아냈고, 그것이 이 WP의 성격을 바꿨다 — 원래 계약대로 구현하면 코드는 늘고 사용자에게 보이는 것은 하나도 달라지지 않는다.

**REL-003의 WP가 전부 닫혔다** (WP-020~028, WP-067, WP-068). 릴리스 게이트는 6.31·6.31.1장에서 **미통과로 판정했다** — 필수 게이트 여섯(2·3·4·5·6·7) 중 통과는 둘이다. **Gate 4**(권한 매트릭스 78셀·위협 모델·시크릿 스캔), **Gate 5**(성능 목표 7종, DEV-058), **Gate 6**(런북 실행·롤백 10분 실측·대시보드·알림)이 미통과이고 **Gate 7**은 부분이다. WP 완료와 게이트 통과는 다른 판정이며 하나가 다른 하나를 대신하지 않는다 — 게이트별 판정은 `../00_governance/change_control.md` 4장 게이트 로그에도 기록했다.

**다음은 WP-029 착수 전 계약 감사다** (REL-004 관계 간선 인덱스와 참조 추출). REL-003의 다섯 WP가 연속으로 "착수 전 감사에서 계약 공백이 나왔다"를 반복했으므로(CR-029·030·031·033·035·038) 같은 순서를 지킨다 — 감사 → CR → 구현. 구현부터 시작하지 않는다.

감사가 확인한 다섯 (전부 CR-038로 정정): 다만 **현재 계약을 그대로 구현하면 안 된다.** 착수 전 감사가 필요한 것 다섯: (1) `JOB-MIR-002`가 `EVT-ING-003`을 소비할 때 `prs:projected`의 기존 `link` consumer와 **같은 consumer group을 쓰면 안 된다** — 같은 group은 broadcast가 아니라 work sharing이라 둘 중 하나만 받는다. (2) 현재 계약의 "기존 commit document 부분 갱신만"으로는 **직접 푸시 커밋 문서가 아예 없는 문제**가 풀리지 않는다. (3) 시퀀스 투영도 `update_by_query`뿐이라 없는 문서를 만들지 않는다. (4) PR 상세의 `source_commits`가 SHA 객체만 만들고 커밋 문서를 join하지 않아, 메타데이터를 채워도 화면에는 계속 SHA만 나온다. (5) 선행·후행의 직접 푸시 행도 같은 이유로 PR 문서만 표시 소스로 읽는다. **우선순위 근거**: WP-027이 직접 푸시 커밋을 선행·후행에 실제로 노출하기 시작해 이제 사용자에게 보이는 조사 품질이 걸려 있다.

**WP-020이 함께 닫는 것 셋.** 지금 화면들이 "아직 수집 전"이라고 적어 둔 자리가 전부 WP-020의 몫이다 — 커밋 메시지·작성자·시각(DEV-090), 변경 경로(DEV-094), PR 상세의 원본 커밋 제목(DEV-062). 타입을 전부 널 허용으로 열어 두었으므로 **화면을 고치지 않아도 키가 붙는 대로 채워진다.**

**WP-018이 남긴 것 셋.**

1. **`direct_push`는 여전히 도달 불가다**(DEV-061). 화면은 매핑을 갖췄고 합성 입력으로 걸었으나 서버가 그 값을 내지 못한다. **WP-021**이 push 이벤트 라우팅을 세울 때 `QA-W003-03`의 나머지 절반이 닫힌다.
2. **커밋 메타데이터가 없다**(DEV-090·094). 헤더의 이름이 축약 SHA이고 변경 경로가 골격이다. **WP-020**이 미러로 보강하면 화면을 고치지 않아도 키가 붙는 대로 채워진다 — 타입을 널 허용으로 열어 두었다.
3. ~~`merge_commit_sha` 추가의 통합 시험이 NOT RUN이다.~~ → **CI에서 통과했다** (378 → 380건). 로컬 Docker 부재라는 제약은 그대로이므로 앞으로도 통합 시험은 CI가 처음 돌린다.

**착수할 때 ES 비의존 통합 시험부터 돌린다 (WP-019가 남긴 것).**

일곱 WP 동안 "이 환경에 Docker가 없어 통합 시험은 CI가 처음 판정한다"고 적어 왔는데 **절반만 맞았다.** 없는 것은 **Elasticsearch뿐**이고, PostgreSQL 16.13과 `redis-server`는 네이티브로 있다. 그 둘만 쓰는 통합 시험 **19파일 181건이 로컬에서 돈다.**

```bash
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 POSTGRES_DB=prs_test \
POSTGRES_TEST_DB=prs_test POSTGRES_USER=postgres POSTGRES_PASSWORD= \
REDIS_URL=redis://localhost:6379 \
npx vitest run --config vitest.integration.config.ts \
  packages/db/integration packages/authz/integration packages/bus/integration \
  apps/ingest-gateway/integration apps/pipeline-worker/integration/outbox-relay.test.ts \
  apps/search-api/integration/admin/jobs.test.ts apps/search-api/integration/authz
```

이것을 확인하지 않아 WP-019의 **동시 실행 상한 결함(DEV-107)이 CI까지 갔다** — 상한은 PostgreSQL만의 성질이라 로컬에서 잡을 수 있었다. 그리고 **PostgreSQL만으로 판정되는 불변식은 ES를 요구하는 파일에 두지 않는다**: `packages/db/integration/job-claim.test.ts`가 그 예다.

**초록이 곧 검증은 아니다 (WP-019가 남긴 것).**

WP-019에서 CI를 통과하던 시험 하나가 **아무것도 검증하지 못하고 있었다.** AC-5 시험이 씨앗 문서를 `_routing` 없이 넣어 같은 `_id`의 문서 둘이 서로 다른 샤드에 앉았고, 검증 대상인 조건부 업서트가 **아예 없었어도** 통과했을 상태였다. 다른 통합 시험은 전부 `routing`을 넘기고 있었으므로, **저장소의 기존 관례에서 벗어난 자리**가 곧 의심할 자리다. 새 시험을 쓸 때 같은 대상을 읽는 기존 시험이 어떻게 하는지 먼저 본다.

**밀기 전 확인을 저장소의 명령으로 한다.** WP-018에서 `tsc -p apps/search-api`로 확인하고 밀었다가 CI가 타입 오류를 잡았다 — 그 tsconfig는 `src/**`만 보고 `integration/`은 루트의 `tsconfig.tests.json`이 본다. 프로젝트별 `tsc`가 아니라 **`pnpm typecheck`를 그대로** 돌려야 CI와 같은 것을 본다.

**WP-015가 열어 준 것.** 세 가지가 여기서 닫혔다 — WP-012가 남긴 OIDC 브라우저 왕복(로그인·콜백·로그아웃 라우트), `test:e2e`·`test:a11y`·`test:contrast` harness(DEV-032, WP 20곳이 참조하던 이름), 그리고 셸이 소유하는 경로 구조와 역할 필터링. 이제 각 화면 WP는 **자기 화면만** 만들면 된다.

~~**다음 WP: WP-016 W-001 통합 검색 화면** (선행 WP-011·WP-013·WP-015 충족).~~ (완료, 위 34번)

딛고 설 것이 갖춰졌다 — 파서(`@prs/query`), 목록 조회(`GET /search`), 식별자 해석(`GET /resolve`), 셸과 프록시. WP-016이 처음으로 할 일 중 하나는 **C-010 `OmniSearchInput`을 셸의 `omniSearch` 슬롯에 넣는 것**이다(DEV-070). 그러면 `⌘K`가 셸을 고치지 않고 그것을 가리킨다.

화면이 생기면서 함께 넓어지는 것들: NFR-005 권한 매트릭스의 화면 13종 축, QA-COMMON-01(IA 진입 경로표)·09(URL 상태 재현)·14(식별자 고정폭), FLOW-000의 경로 복귀(**W-002가 더해져 셋이 됐다**), 그리고 뷰포트를 좁히는 e2e(DEV-073의 미검증 부분 — **WP-017까지도 세우지 못했다**).

~~**사용자 결정이 필요한 것 — REL-002 진행 전:**~~ **셋 다 2026-08-22 CR-024로 닫혔다.**

1. ~~**OD-002 권한 원천**~~ → **GHE 협업자/팀 API로 확정.** 이미 그 어댑터가 서 있으므로 코드 변경이 없다. `AccessScopeSource` 포트는 유지한다 — 임계(등록 저장소 1,000개)를 넘으면 조직 단위 조회 어댑터로 바꿀 자리다
2. ~~**DEV-051 운영 집계의 접근 범위**~~ → **경계 확정.** 저장소를 식별하지 않는 전역 수치는 예외, 저장소를 식별하는 값은 범위 안으로. **코드는 아직 옛 동작이며 WP-040 전까지 반영한다** — 7장에 그대로 남겨 두었다
3. ~~**`allowed_team_ids` 투영 CR**~~ → **소유권 확정: 레지스트리가 주인, 투영이 읽어 복사.** 이벤트에 싣지 않는다. 구현은 **WP-068**(DEV-114)

~~**남은 오픈 결정은 둘뿐이고 둘 다 기한 전이다.**~~ **OD-005는 2026-08-26 CR-040으로 닫혔다 — 남은 오픈 결정은 OD-008 하나다.** OD-005(`nori` 플러그인)의 기한 "REL-004 착수 전"은 **WP-029가 REL-004의 첫 WP로 완료되며 도래했다.** "결정을 뒷받침할 실측이 없다"던 이유는 **결정 자체가 실측을 재검토 조건으로 요구하는 형태**로 해소했다 — 지금은 `standard` + `edge_ngram` 대체 경로를 쓰고, 한국어 relevance 개선이 실측되면 그때 별도 CR을 연다. OD-008(안전 구간 표식 역할, REL-006 착수 전)은 REL-006이 시작되지 않아 기한 전이다.

CR-008은 문서만 강화했다. GitHub Operations Plane(REL-007~011) 구현 순서는 바뀌지 않는다 — Search/Data Plane을 end-to-end로 닫은 뒤다. `@prs/github`은 Data Plane의 GitHub REST 클라이언트이며 `gh` CLI를 실행하지 않는다 (ADR-013).

**REL-001의 WP는 전부 끝났다.** 웹훅 수신부터 검색 인덱스까지, 실패 격리와 재처리, 저장소 등록과 파이프라인 관측이 모두 선다. 남은 것은 **코드가 아니라 게이트**다 — 실제 GHE 대상 read-only smoke, k8s 매니페스트의 클러스터 적용, 운영 규모 성능 측정(QA-PERF), `docker compose up` 검증(DEV-001). 넷 다 이 실행 환경에 없는 것을 요구하며 7장과 6.12장에 그대로 남아 있다.

~~**WP-014가 다음이다.**~~ (완료, 위 30번) WP-013이 질의→ES 경로를 세웠으므로 식별자 해석 API가 같은 파사드 위에 선다 — SHA→PR과 PR→커밋 모두 `applyMandatoryScopeFilter`를 거친 `search`를 쓴다.

**WP-012가 남긴 것 셋은 WP-013을 막지 않았고, 셋 다 아직 열려 있다.**

1. ~~**DEV-051 (사용자 결정 필요).**~~ **해소 (2026-08-22, CR-024).** 경계가 정해졌다 — 전역 수치는 접근 범위 예외, 저장소 식별자는 범위 안. 아래는 그 전 기록이다: API-ADM-006의 운영 집계 두 곳이 접근 범위를 거치지 않는다. 동작을 바꾸지 않고 아키텍처 테스트의 사유 붙은 허용 목록에 등록했다. 운영 콘솔(WP-040)이 서기 전에는 실사용자에게 노출되지 않으므로 아직 시급하지 않다.
2. **`allowed_team_ids`가 여전히 비어 있다.** 접근 범위 쪽은 세웠으나 **문서에 팀 ID를 쓰는 것은 투영의 일**이고 `EVT-ING-002`가 팀 정보를 나르지 않는다. WP-013이 `team:` 필터를 구현·시험했으므로 이제 **사용자가 쓸 수 있는 필터가 운영 데이터에서 0건을 내는 상태**다 — 다만 미해석 이름과 달리 이것은 "이름은 찾았는데 문서에 값이 없는" 경우라 응답에 표식이 남지 않는다. `explicit` 범위(저장소 500개 이하)는 영향이 없다.
3. ~~**OD-002가 열려 있다**~~ **닫혔다 (2026-08-22, CR-024 — GHE 협업자/팀 API).** 아래는 그 전 기록이다 (권한 판정 소스, 기한 REL-002 착수 전). `resolveAccessScope`를 포트로 두고 GHE 어댑터를 구현했으므로 IdP 그룹으로 결정되어도 어댑터 교체다. 다만 GHE 어댑터는 캐시 미스마다 등록 저장소 수만큼 호출한다 — 저장소가 많은 조직이면 이 결정이 성능에 직접 걸리고, NFR-001 실측(DEV-058)도 이 결정 뒤에 하는 편이 뜻이 있다.

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

### REL-004 진행 (2026-08-26)

**구현 진행률 = 3/8.** REL-004의 WP는 WP-029~WP-036 여덟이며 **WP-029·WP-030·WP-031이 완료**다 (CR-039 PR #44 · CR-041 PR #46 · CR-042 PR #47).

| WP | 상태 |
| --- | --- |
| **WP-029** 관계 간선 인덱스와 참조 추출 | **done** |
| WP-030 되돌림·체리픽·스택 관계 파생 | done |
| WP-031 관계 조회 API와 상세 화면 관계 섹션 | **done** |
| **WP-035** 무중단 재색인 | **next** — CR-043이 순서를 앞으로 옮겼다 |
| WP-032 패싯·커서 페이지네이션·전문 검색 | todo — **WP-035 대기** |
| WP-033 저장된 검색 | todo |
| WP-034 W-009 저장소 개요 화면 | todo |
| WP-036 원본 아카이브 레인(Filebeat) | todo |

**이 표의 순서는 ID 순이 아니라 실행 순이다** (CR-043). WP-035가 WP-032보다 앞에 있는 이유는 DEV-266·267이다 — WP-032의 `edge_ngram` 활성화가 살아 있는 인덱스에 배포될 수 없고(비동적 설정 + 기존 문서 미충전, 둘 다 실측), 그것을 배포하는 기계가 WP-035다. **WP ID를 재번호화하지 않는다.**

**CR-043은 WP를 하나도 완료시키지 않았다.** 감사와 계약 경화이며 진행률은 여전히 **3/8**이다 — 계약을 고친 것과 구현한 것을 같은 수로 세지 않는다.

**이 숫자를 릴리스 게이트와 섞지 않는다.** REL-003의 게이트 4·5·6은 여전히 `fail`이고 **베타 공개는 승인되지 않은 상태 그대로다** — WP 진행률은 구현 범위의 척도이지 공개 준비의 척도가 아니다 (CR-038 마감이 정한 구분).

~~**다음은 WP-030 착수 전 계약 감사다.**~~ **완료 (2026-08-26, CR-041 / PR #46).**
~~**다음은 WP-031 착수 전 계약 감사다.**~~ **완료 (2026-08-26, CR-042 / PR #47).**

~~**다음은 WP-032 착수 전 계약 감사다**~~ **완료 (2026-08-26, CR-043).** 스물을 찾았고 그중 셋이 코드 결함이며 하나는 실제 PostgreSQL·Elasticsearch로 **재현했다**(DEV-270). 기록은 6.37장이다. **다음은 WP-035 무중단 재색인이다** — 감사가 그것을 WP-032의 선행으로 만들었다. 감사가 물었던 넷과 그 답:

1. **OD-005가 정한 대체 경로가 계약에 실제로 반영돼 있는가** — CR-040이 `nori`를 초기 의존성에서 제외하고 `standard` + `edge_ngram`으로 정했다. 매핑·분석기·질의 빌더가 그 결정을 아는지 본다
2. **커서 계약이 실제로 정의돼 있는가** — ADR-010은 "커서 전용"만 정한다. 커서의 재료·불안정성 처분(QA-W001-15의 "질의 변경 후 이전 커서")·정렬 동률 처리가 적혀 있는지 본다. WP-031은 관계 목록에 커서를 세우지 않았고 그 이유를 계약에 남겼다
3. **패싯이 목록과 같은 질의 조건으로 계산되는가**(QA-W001-16)를 검증할 수단이 있는가 — 건수 일치를 무엇으로 확인하는지
4. **이 파생/조회의 답을 바꾸는 것이 무엇이고 그것이 바뀔 때 누가 깨우는가** — WP-030·WP-031이 연속으로 그 자리에서 공백을 찾았다

**답 (2026-08-26, CR-043):** ① 매핑과 분석기는 `text_ko_en`까지 결정을 알고 있었으나 `edge_ngram` 필드가 없고 질의 빌더는 전문 검색을 아예 모른다 — 그리고 그 필드를 **살아 있는 인덱스에 넣을 수 없다**(DEV-266·267). ② ADR-010은 재료·지문·동률을 **이미** 정하고 있었고 동률은 `doc_id`로 구현까지 돼 있었다 — 실제 공백은 그 아래층(봉인·정규화·실패 갈래·PIT)이었다(DEV-271~274). ③ "건수 일치"를 합계로 검증할 수 없다는 것이 드러나 bucket 단위로 경화했다(DEV-276). ④ 이 축의 답은 달랐다 — 검색은 조회 시점 계산이라 "깨우는" 축이 없다. 대신 **같은 자리에 다른 것이 있었다**: 답을 바꾸는 것은 매핑 버전이고, 그것이 인덱스에 도달하는 경로가 없었다.

**REL-004 구현 진행률 = 3/8** (WP-029·WP-030·WP-031 done / WP-032~036 todo). **이 숫자를 릴리스 게이트와 섞지 않는다** — REL-003의 게이트 4·5·6은 여전히 `fail`이고 **베타 공개는 승인되지 않은 상태 그대로다.** WP 진행률은 구현 범위의 척도이지 공개 준비의 척도가 아니다(CR-038 마감이 정한 구분).

**"착수 전 감사에서 계약 공백이 나왔다"가 열 번 연속이다** (CR-029·030·031·033·035·038·039·041·042·**043**). 이번에 나온 것은 **한 겹 아래 형태**였다 — WP-029는 "본문이 바뀐다"를 놓치고 있었고, WP-030은 **"다른 엔티티의 상태가 바뀐다"**를 놓치고 있었다. 다음 WP에서 먼저 물을 것: **이 파생의 답을 바꾸는 것이 source 말고 또 무엇인가, 그것이 바뀔 때 누가 깨우는가.**

~~**다음은 WP-031 착수 전 계약 감사다.**~~ **완료 (2026-08-26, CR-042 / PR #47).** 다음은 **WP-032 착수 전 계약 감사**다. REL-003의 WP가 연속 여섯 번, REL-004의 첫 WP가 또 한 번 "착수 전 감사에서 계약 공백이 나왔다"를 반복했다 — 일곱 번 연속이다. 같은 순서를 지킨다: **감사 → CR → 구현.** WP-030이 딛을 자리는 이미 준비돼 있다: `link_summary`의 네 leaf와 `detached`가 그 소유로 명시됐고(DEV-222·223), `commit_snapshot.patch_id`가 체리픽 판정의 근거로 보존된다(CR-038, DEV-208).

~~**OD-005(nori 플러그인)의 기한이 도래했다.**~~ **해소 (2026-08-26, CR-040).** "REL-004 착수 전"인데 WP-029가 REL-004의 첫 WP였다. CR-039는 전문 검색(WP-032) 소관이라 WP-029·WP-030을 막지 않는다는 이유로 결정하지 않고 넘겼으나, **기한이 지난 결정을 열어 두면 문서가 사실과 다른 상태로 남는다** — 실제로 SRS 14장·PRD 12장·이 문서가 모두 "기한이 아직 오지 않았다"고 적고 있었다. CR-040이 `nori`를 초기 REL-004 의존성에서 제외하고 재검토 조건 셋을 확정했다.

`srs_final.md`가 baseline이므로 그 문서의 변경은 CR을 먼저 등록해야 한다. 구현 중 문서와 현실이 어긋나면 5장에 `DEV-###`를 등록하고 CR로 연결한다. 조용한 범위 변경은 금지다.

착수 후 매 WP 완료 시 이 문서의 3·4·6장을 갱신한다. 갱신 없는 완료 보고는 완료가 아니다.
