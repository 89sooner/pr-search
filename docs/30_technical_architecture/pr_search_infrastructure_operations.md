# PR Search 인프라 및 운영 아키텍처

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

## 1. 목적

환경, 배포 토폴로지, compute/storage/network, 구성, 스케일, 마이그레이션, 백업, 복구, 롤아웃, 롤백, DR을 정의한다.

## 2. 환경

| Environment | 목적 | 데이터 | 접근 | 배포 방식 |
| --- | --- | --- | --- | --- |
| `local` | 개발 | 합성 픽스처 (실제 GHE 데이터 없음) | 개발자 | docker compose |
| `dev` | 통합 확인 | 개발용 GHE 조직의 소수 저장소 | 개발팀 | main 병합 시 자동 배포 |
| `staging` | 검증·부하 시험 | 운영 저장소의 부분 집합 (실데이터) | 개발팀 + QA | 릴리스 태그 배포 |
| `production` | 운영 | 전체 실데이터 | 운영 정책 | 릴리스 태그 수동 승인 배포 |

환경 간 차이는 의도된 것만 둔다.

| 항목 | local | dev | staging | production |
| --- | --- | --- | --- | --- |
| Elasticsearch 노드 | 1 (단일) | 1 | 3 | 3+ (OD-006) |
| 인덱스 복제본 | 0 | 0 | 1 | 1 |
| PostgreSQL | 컨테이너 | 관리형 (소형) | 관리형 | 관리형 + 대기 복제본 |
| Redis | 컨테이너 | 관리형 (소형) | 관리형 | 관리형 (HA) |
| 미러 볼륨 | 로컬 디렉터리 | PVC 20GB | PVC 200GB | PVC (5장 산정) |
| GHE 연결 | 목(mock) | 개발 조직 | 운영 조직 (읽기) | 운영 조직 |
| OIDC | 목 | 사내 IdP (dev 클라이언트) | 사내 IdP | 사내 IdP |
| 웹훅 | 목 이벤트 주입 | 개발 조직 웹훅 | 운영 웹훅 미러링 | 운영 웹훅 |

`staging`은 운영 웹훅을 **미러링**해서 받는다. 운영 GHE에 웹훅 대상을 하나 더 등록하는 방식이며, staging의 장애가 운영 수집에 영향을 주지 않는다.

## 3. 배포 단위

| Unit | 책임 | Scale 기준 | 최소/최대 | Health Check | Rollback |
| --- | --- | --- | --- | --- | --- |
| `web` | Next.js UI + 프록시 | 동시 사용자, CPU | 2 / 6 | `GET /healthz` | 이전 이미지 재배포 |
| `search-api` | 조회 API | RPS, p95 지연 | 2 / 8 | `GET /healthz` (ES·PG 연결 확인) | 이전 이미지 재배포 |
| `ingest-gateway` | 웹훅 수신 | 수신 RPS | 2 / 10 | `GET /healthz` (PG 연결 확인) | 이전 이미지 재배포 |
| `pipeline-worker:enrich` | 보강 | `prs:ingest` 적체 | 2 / 8 | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:project` | 투영 | `prs:enriched` 적체 | 2 / 8 | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:sequence` | 채번 | `prs:sequence` 적체 | 1 / 4 | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:link` | 관계 파생 | `prs:projected` 적체 | 1 / 4 | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:batch` | 배치 잡 | 고정 | 1 / 3 | 하트비트 | 이전 이미지 재배포 |
| `filebeat` | 원본 아카이브 적재 | DaemonSet | - | Filebeat 자체 | 설정 롤백 |

배포 순서 규칙:

1. **DB 마이그레이션 → 워커 → API → web** 순으로 배포한다.
2. 마이그레이션은 항상 하위 호환이어야 한다 (데이터 모델 7장). 파괴적 변경은 2릴리스에 나눠 한다.
3. `search-api`와 `web`은 API 계약 변경 시 함께 배포한다 (API-ADM-*는 internal 계약).
4. `pipeline-worker:sequence`는 배포 중 일시 중단해도 안전하다. 재시작 후 증분 채번이 밀린 분을 처리한다.

무중단 배포: 모든 서비스가 무상태이므로 rolling update를 쓴다. `ingest-gateway`는 종료 시 진행 중 요청을 마무리할 시간(graceful shutdown 30초)을 준다. 중간에 끊긴 요청은 GHE가 재전송하고 멱등 처리로 흡수된다.

## 4. Backing Services

| 서비스 | 제품 | 용도 | 가용성 구성 |
| --- | --- | --- | --- |
| Database | PostgreSQL 16 | 시스템 오브 레코드 (ADR-004) | Primary + 동기 대기 복제본, 자동 페일오버 |
| Search | Elasticsearch 8.x | 검색·집계 (ADR-003) | 3노드 이상, 복제본 1 |
| Cache/Queue | Redis 7 | `EventBus`, 권한 캐시, 세션 (ADR-002) | HA (센티넬 또는 관리형) |
| Object storage | 사용하지 않음 | - | 시스템 아키텍처 10장 참조 |
| Secret store | Kubernetes Secret (+ 사내 시크릿 관리 연동) | 시크릿 (보안 문서 6장) | 클러스터 기본 |
| Git mirror | PVC (ReadWriteMany 또는 워커별 ReadWriteOnce) | 커밋 그래프 (ADR-005) | 재구성 가능한 캐시. 백업 없음 |
| Metrics | 사내 Prometheus 호환 | 지표 | 사내 표준 |
| Logs | 사내 로그 수집 | 구조화 로그 | 사내 표준 |
| Traces | OpenTelemetry → 사내 수집기 | 분산 추적 | 사내 표준 |

## 5. 용량 산정

NFR-003 설계 수치와 OD-007 가정(저장소 3000개, 5년 누적)에 기반한 초기 산정이다. 실측 후 CR로 조정한다.

| 항목 | 산정 | 근거 |
| --- | --- | --- |
| PR 문서 | 500만 건 × 약 4KB ≈ 20GB (복제본 포함 40GB) | 본문·경로 배열 포함 |
| 커밋 문서 | 5000만 건 × 약 1.5KB ≈ 75GB (복제본 포함 150GB) | 메시지·경로 포함 |
| 관계 간선 | 1억 건 × 약 0.3KB ≈ 30GB (복제본 포함 60GB) | 실제 저장 간선은 5종 (데이터 모델 4.3) |
| 릴리스 문서 | 50만 건 ≈ 0.5GB | - |
| ES 총계 | 약 250GB (복제본 포함) | 샤드당 30~50GB 기준으로 ADR-003의 샤드 수 산출 |
| ES 힙 | 노드당 31GB 이하 | 표준 권고 |
| `raw_event` (PostgreSQL) | 5억 건 × 약 8KB(JSONB 압축 후) ≈ 4TB / 3년 | **가장 큰 항목.** OD-003 보존 기간이 여기에 직접 영향 |
| `merge_sequence` | 5000만 행 × 약 100B ≈ 5GB | - |
| `audit_record` | 연 5000만 행 × 약 300B ≈ 15GB / 년 | - |
| git 미러 (blobless) | 저장소당 평균 50MB × 3000 ≈ 150GB | blob 제외라 전체 클론 대비 크게 작다. 대형 저장소 편차 큼 |

**`raw_event` 4TB가 이 시스템에서 가장 큰 저장 항목이다.** OD-003(보존 기간)이 1년으로 결정되면 약 1.3TB로 줄어든다. 결정 전까지 월별 파티션으로 구성해 두면 나중에 어떤 기간이든 파티션 드롭으로 조정할 수 있다.

## 6. 네트워크

| 방향 | 경로 | 통제 |
| --- | --- | --- |
| 인바운드 | 사내 사용자 → `web` | 사내망 한정, TLS 종료, 인증 필수 |
| 인바운드 | GHE → `ingest-gateway` | GHE IP 대역 인그레스 제한, HMAC 검증 |
| 내부 | `web` → `search-api` | 클러스터 내부, mTLS 또는 네트워크 정책 |
| 내부 | 전 서비스 → PostgreSQL / ES / Redis | 사설 네트워크, 인증, TLS |
| 아웃바운드 | 워커 → GHE REST | 허용 목록 (GHE 호스트만) |
| 아웃바운드 | 워커 → GHE Git (HTTPS) | 허용 목록 |
| 아웃바운드 | `web` → OIDC IdP | 허용 목록 |
| 아웃바운드 | 서비스 → 알림 채널 | 허용 목록 |

인터넷 노출은 없다. 아웃바운드는 허용 목록 방식이며, 목록에 없는 목적지로의 연결을 차단한다.

네트워크 정책:

- `pipeline-worker`는 인바운드 연결을 받지 않는다.
- `ingest-gateway`는 아웃바운드로 PostgreSQL·Redis에만 접근한다. GHE API를 호출하지 않는다.
- Filebeat는 Elasticsearch로만 아웃바운드한다.

## 7. 구성 관리

| 구성 | 저장 | 재배포 없이 반영 |
| --- | --- | --- |
| 큐 소비자 동시성 | ConfigMap | 예 (워커가 주기적으로 재읽기) |
| 백필 동시 실행 상한 | ConfigMap | 예 |
| 조정 스캔 주기 | ConfigMap | 예 |
| GHE rate limit 임계 (10%) | ConfigMap | 예 |
| 원본 보존 기간 | ConfigMap | 예 (다음 만료 잡부터) |
| 검색·집계 타임아웃 | ConfigMap | 예 |
| 구간·버킷·내보내기 상한 | ConfigMap | 예 |
| 권한 캐시 TTL | ConfigMap | 예 |
| ES 인덱스 매핑 | 코드 (`@prs/es`) | 아니오 (재색인 필요) |
| API 경로·DTO | 코드 | 아니오 |
| 시크릿 | Secret | 예 (파드 재시작 필요) |
| 로그 레벨 | ConfigMap | 예 |

"재배포 없이 반영"되는 항목을 명시하는 것이 운영성 요구(NFR-008)의 일부다. 운영자가 장애 중에 무엇을 바꿀 수 있는지 알아야 한다.

## 8. 개발/실행 명령

코드 저장소가 생기면 실제 명령으로 갱신한다. 실행 브리프가 이 절을 인용한다.

```bash
# 전제: Node 20+, pnpm 10+, Docker
pnpm install                      # 의존성 설치
pnpm dev                          # 전 앱 개발 서버 (docker compose로 PG/ES/Redis 기동 포함)
pnpm dev:web                      # 웹만
pnpm dev:api                      # search-api만
pnpm dev:worker                   # pipeline-worker만
pnpm typecheck                    # tsc --noEmit (전 패키지)
pnpm lint                         # ESLint
pnpm lint:deps                    # 패키지 의존 방향 검사 (역방향 참조 시 실패)
pnpm test                         # 단위 + 계약 테스트
pnpm test:integration             # testcontainers (PostgreSQL + Elasticsearch)
pnpm test:e2e                     # Playwright
pnpm test:a11y                    # axe 검사
pnpm build                        # 전 앱 빌드
pnpm db:migrate                   # 마이그레이션 적용
pnpm db:seed                      # 개발용 합성 시드
pnpm es:apply-mappings            # 매핑 적용 (신규 인덱스 생성)
pnpm es:reindex --alias <별칭>    # 재색인 + 별칭 전환
```

로컬 개발은 GHE 없이도 가능해야 한다. `pnpm dev`가 목 웹훅 이벤트 주입기와 합성 시드를 함께 띄운다.

## 9. 운영 절차

### 9.1 배포

1. 릴리스 태그 생성 → CI가 이미지 빌드·스캔
2. staging 자동 배포 → E2E + 성능 스모크
3. 운영 배포 승인 (수동)
4. 마이그레이션 → 워커 → API → web 순서로 rolling update
5. 배포 후 5분간 오류율·지연 감시. 임계 초과 시 자동 롤백

### 9.2 마이그레이션

- PostgreSQL: `pnpm db:migrate`. 하위 호환만. 파괴적 변경은 2릴리스 분할 (데이터 모델 7장)
- Elasticsearch: 매핑 변경 시 재색인 잡(`JOB-ING-006`). 별칭 전환 전까지 기존 인덱스가 서비스 (FR-ING-008)

### 9.3 롤백 (NFR-008: 10분 이내)

| 상황 | 절차 | 소요 |
| --- | --- | --- |
| 애플리케이션 결함 | 이전 이미지로 rolling update | 5분 |
| 마이그레이션 결함 (하위 호환) | 애플리케이션만 롤백. 스키마는 유지 | 5분 |
| 마이그레이션 결함 (down 필요) | down 스크립트 실행 후 애플리케이션 롤백 | 10분 |
| 재색인 결함 | 별칭을 전환하지 않았으므로 잡만 취소 | 1분 |
| 별칭 전환 후 결함 | 이전 인덱스로 별칭 재전환 (7일 보관) | 1분 |
| 재채번 오류 | **롤백 불가.** 재채번을 다시 수행해 올바른 상태로 수렴 | 저장소 크기에 비례 |

재채번만 롤백이 불가능하다. 그래서 2단계 확인과 영향 범위 산출을 요구한다 (FLOW-008).

### 9.4 백업/복구

| 대상 | 방식 | 주기 | 복구 검증 |
| --- | --- | --- | --- |
| PostgreSQL | 전체 백업 + WAL 연속 아카이브 | 일 1회 전체, WAL 연속 | 분기 1회 복구 훈련 |
| Elasticsearch | 스냅샷 저장소 | 일 1회 | 분기 1회 복구 훈련 |
| git 미러 | 백업하지 않음 | - | 재클론으로 복구 |
| ConfigMap/Secret | GitOps 저장소 (시크릿은 봉인 형태) | 커밋 시 | - |

**Elasticsearch 스냅샷은 RTO를 위한 것이다.** 데이터 자체는 PostgreSQL에서 재구성 가능하지만(ADR-004) 재색인이 4시간 걸리므로, RTO 30분(NFR-004)을 지키려면 스냅샷 복원이 필요하다. 재색인은 스냅샷도 손상된 경우의 최종 수단이다.

### 9.5 재해 복구

| 시나리오 | RPO | RTO | 절차 |
| --- | --- | --- | --- |
| `search-api`/`web` 전체 장애 | 0 | 5분 | 재배포. 수집은 계속됨 |
| Elasticsearch 클러스터 손실 | 0 (PG 보존) | 30분 (스냅샷) / 4시간 (재색인) | 스냅샷 복원 → 실패 시 PostgreSQL에서 전량 재색인 |
| PostgreSQL Primary 손실 | 0 | 10분 | 대기 복제본 승격 |
| PostgreSQL 전체 손실 | 백업 시점 + WAL | 2시간 | 백업 + WAL 복구. 이후 ES 재색인 |
| Redis 손실 | 0 (아웃박스 보존) | 5분 | 재기동 후 `JOB-ING-007`이 미처리 이벤트 재적재 |
| 미러 볼륨 손실 | 0 | 저장소 수에 비례 | 재클론. 그동안 API 폴백 경로로 동작 |
| GHE 장애 | - | GHE 복구에 종속 | 수집 중단, 검색은 정상. 복구 후 조정 스캔으로 누락 보정 |

**RPO 0의 근거**: 웹훅 수신 시 `raw_event` durable 저장 후에만 202를 반환한다. 저장 실패 시 500을 반환해 GHE가 재전송한다. 따라서 GHE가 성공으로 간주한 이벤트는 반드시 PostgreSQL에 있다.

### 9.6 정기 정리

| 작업 | 주기 | 잡 |
| --- | --- | --- |
| 원본 이벤트 보존 만료 파티션 드롭 | 일 1회 | JOB-AUD-001 |
| 감사 기록 보존 만료 파티션 드롭 | 일 1회 | JOB-AUD-001 |
| 완료 잡·해소된 DLQ 정리 (90일) | 일 1회 | JOB-AUD-001 |
| 이전 인덱스 삭제 (전환 후 7일) | 재색인 시 | JOB-ING-006 |
| ES 아카이브 인덱스 ILM | 자동 | ILM 정책 |
| 미러 gc | 월 1회 | JOB-MIR-001 |

## 10. 스케일 전략

| 부하 | 증상 | 대응 |
| --- | --- | --- |
| 웹훅 수신 급증 | `ingest-gateway` p95 상승 | 게이트웨이 파드 증설. 무상태라 즉시 확장 |
| 보강 적체 | `prs:ingest` 적체, `enrich_pending_total` 증가 | enrich 워커 증설. 단, GHE rate limit이 상한이므로 무한 확장 무의미 |
| 색인 적체 | `prs:enriched` 적체 | project 워커 증설 + ES 색인 노드 확인 |
| 검색 지연 | `search-api` p95 상승 | search-api 파드 증설 → 개선 없으면 ES 노드 증설 |
| 집계 부하 | 검색 지연 동반 상승 | 집계 상한 강화, 코디네이팅 노드 분리 (OD-006 (a)) |
| 저장소 수 증가 | 미러 디스크·백필 시간 증가 | PVC 확장, 백필 동시성 상향 |
| 문서 수가 설계치 70% 도달 | ES 샤드당 크기 증가 | 샤드 수 재산정 후 재색인 |

**GHE rate limit이 보강 처리량의 근본 상한이다.** 워커를 늘려도 API 한도를 넘을 수 없다. 그래서 미러 우선 조회(ADR-005)가 처리량 확보의 핵심 수단이다.

## 11. 알려진 인프라 제한

| 제한 | 영향 | 대응 |
| --- | --- | --- |
| `raw_event` 4TB (3년 보존 가정) | 스토리지 비용 | OD-003 결정 후 재산정. 월별 파티션이라 조정 용이 |
| 미러 볼륨 150GB 추정의 편차가 큼 | 대형 저장소 몇 개가 대부분을 차지할 수 있음 | 저장소별 미러 크기 지표화, 상위 저장소는 API 폴백 전환 검토 |
| Redis 유실 시 큐 내용 손실 | 처리 지연 | 아웃박스 재적재로 복구 (데이터 유실 아님) |
| 단일 리전 배포 | 리전 장애 시 전체 중단 | 사내 시스템이며 GHE도 같은 리전이다. 별도 DR 리전을 두지 않는다 |
| staging이 운영 웹훅을 미러링 | GHE 웹훅 대상이 2개 | GHE 측 부하 미미. staging 장애가 운영에 영향 없음 |
