# PR Search 구현 추적 원장

> 상태: review | 버전: v0.3 | 갱신일: 2026-08-19

## 1. 목적

구현이 시작된 후 문서와 코드의 정합성을 유지하는 살아있는 원장이다. 코딩 에이전트는 WP를 완료할 때마다 이 문서를 갱신한다. 이 문서는 기록용이며 범위를 결정하지 않는다.

**현재 상태: WP-001 구현 완료, DoD 1항 검증 보류.** 워크스페이스 골격이 서 있고 `pnpm typecheck / lint / lint:deps / test / build`와 CI가 통과한다. `docker compose up` 기동 확인만 남았다(DEV-001). 도메인 로직·API·화면은 아직 없다.

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
| WP-002 | PostgreSQL 스키마와 마이그레이션 | REL-001 | todo | - | - | - | - |
| WP-003 | Elasticsearch 매핑과 인덱스 부트스트랩 | REL-001 | todo | - | - | - | - |
| WP-004 | 웹훅 수신 게이트웨이 | REL-001 | todo | - | - | - | - |
| WP-005 | EventBus 포트와 Redis Streams 어댑터 | REL-001 | todo | - | - | - | - |
| WP-006 | GHE 클라이언트와 rate limit 관리 | REL-001 | todo | - | - | - | - |
| WP-007 | 보강 워커 | REL-001 | todo | - | - | - | - |
| WP-008 | 투영 워커와 버전 조건부 업서트 | REL-001 | todo | - | - | - | - |
| WP-009 | 실패 대기열과 재처리 | REL-001 | todo | - | - | - | - |
| WP-010 | 저장소 등록 API와 파이프라인 지표 | REL-001 | todo | - | - | - | - |
| WP-011 | 구조화 질의 파서 | REL-002 | todo | - | - | - | - |
| WP-012 | 인증과 접근 범위 강제 | REL-002 | todo | - | - | - | - |
| WP-013 | 검색 API 목록 조회 | REL-002 | todo | - | - | - | - |
| WP-014 | 식별자 해석 API | REL-002 | todo | - | - | - | - |
| WP-015 | 웹 앱 셸과 Conductor 통합 | REL-002 | todo | - | - | - | - |
| WP-016 | W-001 통합 검색 화면 | REL-002 | todo | - | - | - | - |
| WP-017 | W-002 PR 상세 화면 | REL-002 | todo | - | - | - | - |
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

## 4. 요구사항-코드 매핑

상태: `not_started` / `partial` / `implemented` / `verified`

| 요구사항 ID | 담당 WP | 구현 위치(모듈/경로) | 테스트 | 상태 |
| --- | --- | --- | --- | --- |
| FR-SRCH-001 | WP-014 | - | - | not_started |
| FR-SRCH-002 | WP-014, WP-018 | - | - | not_started |
| FR-SRCH-003 | WP-014, WP-017 | - | - | not_started |
| FR-SRCH-004 | WP-014, WP-016 | - | - | not_started |
| FR-SRCH-005 | WP-011, WP-016 | - | - | not_started |
| FR-SRCH-006 | WP-013, WP-016 | - | - | not_started |
| FR-SRCH-007 | WP-013, WP-016 | - | - | not_started |
| FR-SRCH-008 | WP-032 | - | - | not_started |
| FR-SRCH-009 | WP-032 | - | - | not_started |
| FR-SRCH-010 | WP-033 | - | - | not_started |
| FR-SRCH-011 | WP-032 | - | - | not_started |
| FR-SRCH-012 | WP-044 | - | - | not_started |
| FR-SEQ-001 | WP-020, WP-021 | - | - | not_started |
| FR-SEQ-002 | WP-023, WP-025 | - | - | not_started |
| FR-SEQ-003 | WP-023, WP-025 | - | - | not_started |
| FR-SEQ-004 | WP-024, WP-026 | - | - | not_started |
| FR-SEQ-005 | WP-022 | - | - | not_started |
| FR-SEQ-006 | WP-041 | - | - | not_started |
| FR-SEQ-007 | WP-042 | - | - | not_started |
| FR-REL-001 | WP-027 | - | - | not_started |
| FR-REL-002 | WP-024 | - | - | not_started |
| FR-REL-003 | WP-029, WP-031 | - | - | not_started |
| FR-REL-004 | WP-030, WP-031 | - | - | not_started |
| FR-REL-005 | WP-030, WP-031 | - | - | not_started |
| FR-REL-006 | WP-030, WP-031 | - | - | not_started |
| FR-REL-007 | WP-031 | - | - | not_started |
| FR-REL-008 | WP-043 | - | - | not_started |
| FR-ING-001 | WP-004 | - | - | not_started |
| FR-ING-002 | WP-004, WP-008 | - | - | not_started |
| FR-ING-003 | WP-002, WP-004 | - | - | not_started |
| FR-ING-004 | WP-006, WP-007 | - | - | not_started |
| FR-ING-005 | WP-008 | - | - | not_started |
| FR-ING-006 | WP-019 | - | - | not_started |
| FR-ING-007 | WP-009 | - | - | not_started |
| FR-ING-008 | WP-035 | - | - | not_started |
| FR-ING-009 | WP-010, WP-040 | - | - | not_started |
| FR-ING-010 | WP-036 | - | - | not_started |
| FR-ING-011 | WP-028 | - | - | not_started |
| FR-STAT-001 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-002 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-003 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-004 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-005 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-006 | WP-037, WP-038 | - | - | not_started |
| FR-AUTH-001 | WP-012, WP-015 | - | - | not_started |
| FR-AUTH-002 | WP-012 | - | - | not_started |
| FR-AUTH-003 | WP-012 | - | - | not_started |
| FR-AUTH-004 | WP-039 | - | - | not_started |
| FR-ADMIN-001 | WP-010, WP-040 | - | - | not_started |
| FR-ADMIN-002 | WP-019, WP-040 | - | - | not_started |
| FR-ADMIN-003 | WP-028, WP-040 | - | - | not_started |
| NFR-001 | WP-013, WP-014, WP-023, WP-037 | - | - | not_started |
| NFR-002 | WP-004, WP-008 | - | - | not_started |
| NFR-003 | WP-002, WP-003 | - | - | not_started |
| NFR-004 | WP-010 (인프라) | - | - | not_started |
| NFR-005 | WP-004, WP-012 | - | - | not_started |
| NFR-006 | WP-039 | - | - | not_started |
| NFR-007 | WP-015 ~ WP-018, WP-025, WP-038 | - | - | not_started |
| NFR-008 | WP-001, WP-035, WP-040 | `package.json` 스크립트, `scripts/lint-deps.mjs`, `.github/workflows/ci.yml`, `docker-compose.yml`, 각 앱 `src/server.ts`의 `GET /healthz` | `scripts/lint-deps.test.ts`, `apps/*/src/server.test.ts` | partial (WP-001분: 재현 가능한 검증 파이프라인과 헬스 엔드포인트. 롤백 절차·재색인 소요는 WP-035·WP-040) |

## 5. 편차 로그 (DEV)

문서와 코드가 어긋났을 때 등록한다. 유형: `문서 오류` / `범위 공백` / `기술 제약`.

| DEV ID | 발견일 | 발견 내용 | 관련 FR/WP | 유형 | 연결 CR | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| DEV-001 | 2026-08-19 | `docker compose up -d`를 WP-001 환경에서 실행 검증하지 못했다. 컨테이너 레지스트리 블롭 호스트(`production.cloudfront.docker.com`)와 `docker.elastic.co`가 실행 환경의 이그레스 정책에서 403으로 차단된다. `docker compose config`는 통과하고 compose 정의 자체는 인프라 4장·8장과 일치한다. 우회하지 않았고 이미지 태그도 바꾸지 않았다 | WP-001 | 기술 제약 | 불필요 (설계 변경 없음) | open — 레지스트리 접근이 되는 환경에서 재검증 필요 |
| DEV-002 | 2026-08-19 | 인프라 3장은 `pipeline-worker`의 health check를 "하트비트"로 적었으나 WP-001 DoD는 "각 앱 헬스체크가 200을 반환한다"를 요구한다. 워커에 `node:http` 기반 `GET /healthz`를 두어 둘을 모두 만족시켰다. ADR-001의 "워커는 순수 Node 프로세스" 결정을 지키려고 Fastify를 넣지 않았다 | WP-001 | 문서 오류 | 불필요 (인프라 8장에 표기 반영) | resolved |
| DEV-003 | 2026-08-19 | `../00_governance/change_control.md` 4장 아키텍처 게이트 기록이 "오류 코드 30종"으로 적혀 있으나 API 계약 6장의 실제 코드는 29종이다. `@prs/contracts`는 문서 표를 파싱해 29종과 대조하는 테스트를 둔다 | WP-001 | 문서 오류 | 미등록 — 게이트 기록 정정은 별도 CR | open |

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

### 6.2 릴리스 게이트

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
| `web`이 Conductor 디자인 시스템을 아직 쓰지 않음 | WP-001 제외 목록 (화면 제외) | 실제 상태 | WP-019 (셸과 Conductor 연동) |
| 각 앱 헬스체크가 백킹 서비스 연결을 확인하지 않음 | WP-001 구현 범위 (프로세스 기동만) | 실제 상태 | 연결을 여는 WP-002·WP-003·WP-005가 각각 추가 |

## 8. 다음 작업

현재 이 저장소는 **REL-001 구현 단계**다. Gate 1(핸드오프 게이트) 통과, WP-001 완료.

완료:

1. ~~`srs_final.md`를 사용자 승인으로 `baseline` 전환~~ → 완료 (2026-08-19, v1.0, CR-003)
2. ~~`validate_srs_prd_env.py --strict` 통과 확인~~ → 완료 (오류 0, 경고 0)
3. ~~OD-003(원본 보존 기간), OD-006(ES 클러스터 형태), OD-007(PR 규모 기준선) 결정~~ → 완료 (2026-08-19, CR-004). 보존 3년·`raw_event` 4TB, ES 전용 클러스터 3노드(컨테이너 3개, 복제본 1), 워크로드 기준선 1,000 PR/일. ADR-003 샤드 수는 변경 없음
4. WP-001 워크스페이스와 공유 패키지 골격 → 구현 완료 (2026-08-19), DoD 4항 중 3항 검증 완료. `docker compose up` 기동 확인만 남았다 (DEV-001). 검증 결과는 6.1장

남은 착수 조건 (WP와 병행 가능):

5. GitHub App 발급(읽기 전용), 웹훅 엔드포인트 등록, OIDC 클라이언트 등록 — WP-004·WP-006·WP-012 전에 필요
6. ES 컨테이너 3개의 Docker host 배치 확정 — 마스터 자격 노드 3개가 서로 다른 호스트에 놓이는지 확인 (인프라 4.1장). CPU·RAM·디스크 사양과 호스트 수는 CR-004에서 결정하지 않았다
7. 컨테이너 레지스트리 접근이 되는 환경에서 `docker compose up -d` 재검증 (DEV-001)

다음 WP:

8. **WP-002 PostgreSQL 스키마와 마이그레이션** (선행 WP-001 충족). 이후 WP-003·WP-005·WP-006은 WP-001만 선행이므로 병렬 착수 가능하다

`srs_final.md`가 baseline이므로 이제 그 문서의 변경은 `../00_governance/change_control.md`에 CR을 먼저 등록해야 한다. 구현 중 문서와 현실이 어긋나면 위 5장에 `DEV-###`를 등록하고 CR로 연결한다. 조용한 범위 변경은 금지다.

착수 후 매 WP 완료 시 이 문서의 3·4·6장을 갱신한다. 갱신 없는 완료 보고는 완료가 아니다.
