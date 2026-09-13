# PR Search 인프라 및 운영 아키텍처

> 상태: review | 버전: v0.16 | 갱신일: 2026-09-13

CR-079: Profile A sequence는 기존 RW mirror-data에서 freshness를 수행하고 모든 sync 호출은 repo session lock을 공유한다. Profile B sequence에는 mirror volume이 없으므로 명시적 API mode다. 환경 키·schema 선행·boot/stop·additive 앱 rollback과 별도 DB down은 [설계](pr_search_wp074_design.md) 10절이 정본이다. pilot.4 fail-fast·SSR smoke·pg hash 보정·worker git을 보존한다. 후보는 새 버전 미발행이며 --release를 사용하지 않는다.

## 1. 목적

환경, 배포 토폴로지, compute/storage/network, 구성, 스케일, 마이그레이션, 백업, 복구, 롤아웃, 롤백, DR을 정의한다.

## 2. 환경

| Environment | 목적 | 데이터 | 접근 | 배포 방식 |
| --- | --- | --- | --- | --- |
| `local` | 개발 | 합성 픽스처 (실제 GHE 데이터 없음) | 개발자 | docker compose |
| `dev` | 통합 확인 | 개발용 GHE 조직의 소수 저장소 | 개발팀 | main 병합 시 자동 배포 |
| `staging` | 검증·부하 시험 | 운영 저장소의 부분 집합 (실데이터) | 개발팀 + QA | 릴리스 태그 배포 |
| `production` | 운영 | 전체 실데이터 | 운영 정책 | 릴리스 태그 수동 승인 배포 |
| `pilot` | **첫 사내 반입** | 사내 GHE 저장소 소수의 실데이터 | 파일럿 참여자 | **오프라인 번들 반입 + 단일 호스트 Compose** (CR-059 / ADR-021) |

**`pilot`은 `local`도 `production`도 아니다** (DEV-497). 실데이터를 쓰지만 `production`의 HA 구성을 갖지 않고, Compose를 쓰지만 `local`의 합성 픽스처가 아니다. 배포 방식도 다르다 — 나머지 넷은 저장소에서 배포하지만 `pilot`은 **네트워크가 끊긴 상태에서 반입된 번들**로 선다.

환경 간 차이는 의도된 것만 둔다.

| 항목 | local | pilot | dev | staging | production |
| --- | --- | --- | --- | --- | --- |
| 배포 프로파일 | A | **A** | B | B | B |
| Elasticsearch 노드 | 1 (단일) | **1 (single-node)** | 1 | 3 | 3 (전용 클러스터, OD-006 / 4.1장) |
| 인덱스 복제본 | 0 | **0** | 0 | 1 | 1 |
| PostgreSQL | 컨테이너 | **컨테이너 (영속 볼륨)** | 관리형 (소형) | 관리형 | 관리형 + 대기 복제본 |
| Redis | 컨테이너 | **컨테이너 (AOF 영속)** | 관리형 (소형) | 관리형 | 관리형 (HA) |
| 미러 볼륨 | 로컬 디렉터리 | **명명 볼륨** | PVC 20GB | PVC 200GB | PVC (5장 산정) |
| 아카이브 볼륨 | 로컬 디렉터리 | **명명 볼륨** | `emptyDir` 512MiB | `emptyDir` 512MiB | `emptyDir` 512MiB (64MiB × 5 + 여유) |
| GHE 연결 | 목(mock) | **사내 조직 (읽기)** | 개발 조직 | 운영 조직 (읽기) | 운영 조직 |
| OIDC | 목 | **사내 IdP** | 사내 IdP (dev 클라이언트) | 사내 IdP | 사내 IdP |
| 웹훅 | 목 이벤트 주입 | **사내 조직 웹훅** | 개발 조직 웹훅 | 운영 웹훅 미러링 | 운영 웹훅 |
| 역할당 인스턴스 | 1 | **1** | 3장 표의 최소 | 3장 표의 최소 | 3장 표 범위 |

`staging`은 운영 웹훅을 **미러링**해서 받는다. 운영 GHE에 웹훅 대상을 하나 더 등록하는 방식이며, staging의 장애가 운영 수집에 영향을 주지 않는다.

## 3. 배포 단위

### 3.0 배포 프로파일 (CR-059 / ADR-021)

배포 프로파일은 둘이며, **환경마다 어느 것을 쓰는지는 2장 표가 정한다.**

| | Profile A | Profile B |
| --- | --- | --- |
| 오케스트레이션 | 단일 호스트 **Docker Compose** | **Kubernetes** |
| 산출물 | `deploy/single-host/` | `deploy/k8s/` |
| 역할당 인스턴스 | **1** | 아래 표의 최소/최대 |
| Backing service | 같은 호스트의 컨테이너 (영속 볼륨) | 관리형 / 전용 클러스터 |
| Elasticsearch | **single-node, 복제본 0** | 전용 3노드, 복제본 1 (OD-006 / 4.1장) |
| 가용성 | **호스트 장애 = 전체 장애** (파일럿 승인 trade-off) | HA |
| 현재 용도 | **첫 사내 파일럿의 기본** | 다중 서버·HA가 필요해질 때 |

**두 프로파일은 같은 배포 단위 집합을 세운다.** 프로파일이 바꾸는 것은 인스턴스 수와 실행 수단이지 **무엇이 도는가**가 아니다. 역할을 더하는 WP는 **두 산출물 모두**에 그 단위를 더하며, 운영 도달성 회귀가 프로파일마다 그것을 묻는다 (DEV-498).

**서버가 하나라는 이유로 프로세스를 합치지 않는다.** `pipeline-worker`의 역할 분리는 배포 형상이 아니라 "워커 풀을 나눌 수 있어야 한다"는 요구(FR-ING-006 AC-3)에서 나온 것이고, 합치면 Profile B로 돌아갈 수 없다. 반대로 Profile B의 복제본 수를 Compose에 기계적으로 번역하지도 않는다 — **기본은 역할당 하나**이며, 동시 실행 자체가 위험한 `batch`·`reconcile`은 그것이 곧 상한이다.

### 3.1 배포 단위 표

| Unit | 책임 | Scale 기준 | 최소/최대 (B) | **A** | Health Check | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| `web` | Next.js UI + 프록시 | 동시 사용자, CPU | 2 / 6 | **1** | `GET /healthz` | 이전 이미지 재배포 |
| `search-api` | 조회 API | RPS, p95 지연 | 2 / 8 | **1** | `GET /healthz` (ES·PG 연결 확인) | 이전 이미지 재배포 |
| `ingest-gateway` | 웹훅 수신 | 수신 RPS | 2 / 10 | **1** | `GET /healthz` (PG 연결 확인) | 이전 이미지 재배포 |
| `pipeline-worker:enrich` | 보강 | `prs:ingest` 적체 | 2 / 8 | **1** | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:project` | 투영 | `prs:enriched` 적체 | 2 / 8 | **1** | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:sequence` | 채번 | `prs:sequence` 적체 | 1 / 4 | **1** | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:link` | 관계 파생 | `prs:projected` 적체 | 1 / 4 | **1** | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:mirror` | git 미러 동기화·커밋 메타데이터 보강 | 저장소 수 | 1 / 2 | **1** | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:reconcile` | 조정 스캔 | 저장소 수 | 1 / 1 | **1** | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:batch` | 배치 잡 (JOB-ING-006 재색인 · JOB-ING-007 아웃박스 재적재) | 고정 | **1 / 1** | **1** | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:authz` | 권한 캐시 무효화 (JOB-AUTH-001) | `prs:permission` 적체 | **1 / 4** | **1** | 하트비트 | 이전 이미지 재배포 |
| `pipeline-worker:annotate` | PR 제목 M 넘버 표기 (JOB-SEQ-005) — **GHE 쓰기 자격을 가진 유일한 단위** | 고정 | **1 / 1** | **1** | 하트비트 | 이전 이미지 재배포 |
| `filebeat` | 원본 아카이브 적재 | `ingest-gateway` 파드 수를 따른다 (사이드카) | 게이트웨이와 동일 | **1** (사이드카) | Filebeat 자체 | 설정 롤백 |
| `gh-executor` | 사용자 요청 GitHub 작업 실행 (CR-005 · CR-086) | 대기 중 실행 수 | 2 / 8 | **선택 프로파일** `github-operations` — 기본 꺼짐, `.env`의 `GH_OPERATIONS_ENABLED=true`면 `prsctl`이 1개를 세운다 | GET /healthz (gh 버전·manifest 대조 포함. 꺼진 상태는 `execution: disabled`를 밝히고 백킹 서비스를 묻지 않는다) | 이전 이미지 재배포 |

**`batch`의 상한은 3이 아니라 1이다** (CR-046, DEV-311). 이 표가 3을 허용하면 운영자가 문서를 따라 늘릴 수 있는데, JOB-ING-007은 리더 선출이 없는 주기 스윕이라 파드마다 같은 아웃박스 행을 다시 발행하고 JOB-ING-006은 동시 실행 상한이 1이다. `pipeline-worker-batch.yaml`의 주석은 replica 1을 요구하는데 이 표가 3을 승인하고 있었다 — **아키텍처가 배포 계약이 경고하는 형상을 허가하고 있었다.** 조정 수단이 생기면 그때 올린다.

**이 표는 두 프로파일의 배포 산출물과 서로를 검사한다** (CR-045, DEV-293·307 / CR-059, DEV-498). `mirror`(CR-038)·`reconcile`(CR-034)은 manifest가 신설됐는데 이 표에 오르지 않았고, 반대로 `batch`는 이 표에 있는데 **manifest가 없었다** — 그 결과 이미 구현된 JOB-ING-007이 배포되지 않았다(DEV-292). 이제 운영 도달성 회귀가 **코드가 갈래를 만든 역할마다 그것을 세우는 manifest가 있는지** 묻는다. `authz`(JOB-AUTH-001)는 **CR-048이 배포했다**(DEV-306 resolved) — 예외를 지우고 manifest를 만든 뒤 이 표에 올렸다. `release`(JOB-REL-007)·`backfill`(JOB-ING-004) 둘은 **아직 배포되지 않으며** DEV-304·305로 열려 있다 — **배포되지 않는 단위를 이 표에 먼저 적지 않는다.** 그러면 표가 다시 사실과 어긋난다. **`WP-070`이 Profile A에서 그 둘의 실행 경로를 세우면 그때 이 표에 올린다** (CR-059) — 이 CR은 계약만 세우므로 표를 미리 채우지 않는다.

**`annotate`의 상한도 1이다** (CR-084 / WP-075). 미표기 잔여 스윕이 리더 선출 없이 도는 주기 작업이라 파드가 둘이면 같은 PR을 동시에 집어 같은 제목에 요청이 두 번 나간다 — 결과는 멱등이지만 GHE 한도를 두 배로 쓴다. **자격 배선도 다른 단위와 다르다**: 이 단위만 표기 전용 App의 개인 키를 받고, 조회용 Data App의 자격(`GHE_APP_*`)은 받지 않는다. 반대로 다른 단위는 표기 자격을 받지 않는다 (`FR-SEQ-009` AC-5, `ADR-022` 결정 1, `THR-047`). **전역 스위치 `MNUMBER_ANNOTATE_ENABLED`의 기본값이 꺼짐이므로 이 단위를 세우는 것만으로는 아무 PR 제목도 바뀌지 않는다.**

**상한 1은 이제 락이 함께 지킨다** (`CR-085` / `DEV-629` resolved). 값만으로 지키면 사람이 올리는 순간 사라지므로, 같은 정본 DB를 보는 프로세스 중 `annotate:runner` advisory 세션 락을 쥔 하나만 쓴다. 락을 얻지 못한 프로세스는 표기 회차만 건너뛰고 나머지 역할은 그대로 돈다. **보장 범위를 넘겨 읽지 않는다**: 서로 다른 DB를 쓰는 두 배포가 같은 GHE를 고치는 것은 막지 못하고, GHE가 fencing token을 검증하지 않으므로 네트워크 분할에서의 exactly-once도 아니다. 그래서 쓰기 직전마다 **락 커넥션으로** 정본을 다시 묻고, 그 질의가 실패하면 요청을 보내지 않는다.

**켜기 전에 읽기 전용으로 먼저 본다.** `annotate-preview-cli`가 대상 저장소의 확정 M 번호 수, 아직 표기하지 않은 수, 다음 회차가 실제로 집을 행 수, 전역·저장소 정책과 차단 상태, 그리고 **확인하지 못한 것**을 함께 낸다. 워커 이미지 안에서 도는 이유는 전역 스위치와 표기 전용 자격이 그 환경에만 있기 때문이다 — 조회 서비스에서 같은 이름의 변수를 읽으면 「그 값이 워커에도 같다」는 가정이 필요하고, 그 가정이 틀리면 사전 점검이 거짓을 말한다. **출력은 승인 토큰이 아니라 측정 시각의 사진이다**: 실제 쓰기 때 잡은 정본을 다시 읽고 현재 상태로 판정한다.

**`gh-executor`는 Profile A의 기본 형상에 세우지 않되, 선택 프로파일로 담는다** (CR-059 → CR-086). 첫 사내 반입 대상이 read-only Search/Investigation Plane이라는 `CR-059`의 결정은 그대로다 — `GH_OPERATIONS_ENABLED=false`(기본)면 컨테이너가 생기지 않는다. 다만 `REL-007`이 착수되어 이미지는 번들에 담고(`build-bundle.sh`의 `APP_TARGETS`), `prsctl`이 `.env`의 그 값을 읽어 `--profile github-operations`를 붙인다. 켜고 끄는 자리가 `.env` 하나이므로 **search-api만 켜지고 실행기가 없는 형상**(요청이 영원히 `queued`)은 `prsctl`로는 만들어지지 않으며, `prsctl health`가 그 어긋남을 판정한다. `smoke-images.sh` 6절이 실제 이미지로 고정 gh·해시·꺼진 기동·켜짐 거부를 본다.

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
| Search | Elasticsearch 8.x | 검색·집계 (ADR-003) | PR Search 전용 클러스터 3노드, 복제본 1 (OD-006 / 4.1장) |
| Cache/Queue | Redis 7 | `EventBus`, 권한 캐시, 세션 (ADR-002) | HA (센티넬 또는 관리형) |
| Object storage | 사용하지 않음 | - | 시스템 아키텍처 10장 참조 |
| Secret store | Kubernetes Secret (+ 사내 시크릿 관리 연동) | 시크릿 (보안 문서 6장) | 클러스터 기본 |
| Git mirror | PVC (ReadWriteMany 또는 워커별 ReadWriteOnce) | 커밋 그래프 (ADR-005) | 재구성 가능한 캐시. 백업 없음 |
| 원본 아카이브 파일 | `emptyDir` (게이트웨이 파드 내부) | NDJSON 원본, 레인 B (ADR-002) | 크기 상한 × 보관 개수로 스스로를 제한한다 (FR-ING-010 AC-7). 백업 없음 — `raw_event`가 정본이다 |
| Metrics | 사내 Prometheus 호환 | 지표 | 사내 표준 |
| Logs | 사내 로그 수집 | 구조화 로그 | 사내 표준 |
| Traces | OpenTelemetry → 사내 수집기 | 분산 추적 | 사내 표준 |

### 4.1 Elasticsearch 토폴로지 (OD-006 결정, CR-004)

> **좁힘 기록 (CR-059, 2026-09-01).** 아래 3노드 결정은 **`production` 환경의 결정이며 그대로 유효하다** — 당시 범위에서 옳았고 이 CR은 그것을 다시 쓰지 않는다. 다만 **첫 사내 파일럿(`pilot` 환경 / 배포 Profile A)에서는 `CR-059`가 정한 single-node·복제본 0이 우선한다.** 서버가 1대이므로 노드 3개를 세워도 장애 도메인이 하나이고, 아래 표가 이미 경고하는 "컨테이너 3개가 곧 장애 도메인 3개는 아니다"가 그 형상에서 **언제나 참**이기 때문이다 — 마스터 quorum과 복제본 1이 아무것도 지켜 주지 못하면서 메모리만 3배 쓴다. 다중 서버로 승격할 때 이 결정이 다시 정본이 된다 (ADR-021).

| 항목 | 결정값 |
| --- | --- |
| 클러스터 형태 | PR Search 전용 클러스터. 사내 공용 클러스터를 공유하지 않는다 |
| 노드 수 | 3 |
| 실행 형태 | 노드당 Docker 컨테이너 1개 — 총 3개 컨테이너 |
| 인덱스 복제본 | 1 (기존 값 유지) |
| 노드 역할 | 3노드 모두 master/data/ingest 겸임. 코디네이팅 전용 노드 없음 |

전용 클러스터인 이유는 ADR-008의 필수 접근 범위 필터와 `dynamic: strict` 매핑이 모두 클러스터 수준 설정에 걸리는데 공용 클러스터에서는 그 설정을 PR Search 단독으로 통제할 수 없기 때문이다. 부하 격리도 인덱스 수준이 아니라 클러스터 수준에서 얻는다. **분석기 플러그인은 현재 의존성이 아니다** — OD-005는 2026-08-26 CR-040으로 `nori`를 초기 REL-004 의존성에서 제외했고, 지금 구성은 내장 `standard` 토크나이저만 쓴다. 다만 재검토 조건이 충족되어 플러그인을 도입하게 되면 **설치·업그레이드·재기동이 3노드 전체에 걸리므로** 전용 클러스터가 그때 다시 근거가 된다 — 그 절차의 운영 승인이 재검토 조건 ①이다.

**이 결정이 정하지 않은 것.** 아래 항목은 REL-001 프로비저닝에서 정한다. 이 문서는 임의 값을 채우지 않는다.

| 항목 | 여기서 확정하지 않는 이유 |
| --- | --- |
| 노드당 CPU·RAM | 결정 범위 밖이다. ES 힙 상한(노드당 31GB 이하)만 표준 권고로 유지한다 |
| 노드당 디스크 용량 | 5장 용량 산정의 실측 보정 이후에 정한다 |
| Docker host 수와 컨테이너 배치 | 컨테이너 3개를 몇 대 호스트에 나눌지는 결정되지 않았다 |
| 컨테이너 실행·오케스트레이션 방식 | 애플리케이션 서비스는 Kubernetes에 배포하지만(3장) ES는 그와 분리된 백킹 서비스다 |

**컨테이너 3개가 곧 장애 도메인 3개는 아니다.** 3개 컨테이너가 한 호스트에 모여 있으면 호스트 장애 한 번으로 클러스터 전체가 내려가고, 복제본 1은 그 상황에서 아무것도 지켜 주지 못한다. 마스터 quorum도 노드 2개를 동시에 잃으면 깨진다. 따라서 REL-001에서 Docker host 수를 정할 때 **마스터 자격 노드 3개가 서로 다른 호스트에 놓이는지 확인하는 것**이 명시적 산출물이다. 호스트 수를 이 문서에서 정하지 않으므로 이 확인을 생략하면 3노드 구성의 가용성 이득이 사라진다.

## 5. 용량 산정

산정 기준은 NFR-003의 **용량 설계 상한**(저장소 3000개, 5년 누적, PR 500만·커밋 5000만·간선 1억·원본 5억)이다. OD-007이 확정한 **워크로드 기준선**은 1,000 PR/일 = 연 365,000건 = 5년 1,825,000건으로, 설계 상한 대비 약 2.7배 여유가 있다. 용량은 상한으로 잡고 SLO·부하 시험 시나리오는 기준선으로 잡는다 (NFR-003).

| 항목 | 산정 | 근거 |
| --- | --- | --- |
| PR 문서 | 500만 건 × 약 4KB ≈ 20GB (복제본 포함 40GB) | 본문·경로 배열 포함 |
| 커밋 문서 | 5000만 건 × 약 1.5KB ≈ 75GB (복제본 포함 150GB) | 메시지·경로 포함 |
| 관계 간선 | 1억 건 × 약 0.3KB ≈ 30GB (복제본 포함 60GB) | 실제 저장 간선은 5종 (데이터 모델 4.3) |
| 릴리스 문서 | 50만 건 ≈ 0.5GB | - |
| ES 엔티티 인덱스 합계 | 약 250GB (복제본 포함) | 위 4개 엔티티 인덱스의 합. 샤드당 30~50GB 기준으로 ADR-003의 샤드 수 산출 |
| ES 원본 아카이브 `prs-raw-events` | ILM 창 약 97일 × 일 약 46만 건 ≈ 4400만 문서. 건당 크기를 `raw_event`와 동일한 8KB로 두면 약 350GB, 복제본 1 포함 약 700GB | 엔티티와 분리된 시계열 인덱스(ADR-003)이며 **엔티티 합계에 포함되지 않는다.** 건당 크기는 PostgreSQL 산정치를 옮긴 가정이고 ES 실측치는 다를 수 있다 |
| ES 총계 | 약 950GB (복제본 포함) = 엔티티 250GB + 아카이브 700GB | 이전 판의 "ES 총계 약 250GB"는 엔티티 인덱스만 센 값이었다. CR-004에서 아카이브 몫을 분리 표기했다 |
| ES 힙 | 노드당 31GB 이하 | 표준 권고 |
| `raw_event` (PostgreSQL) | 5억 건 × 약 8KB(JSONB 압축 후) ≈ 4TB / 3년 | **가장 큰 항목.** OD-003 결정값(보존 3년)을 반영한 계획 용량이다 |
| `merge_sequence` | 5000만 행 × 약 100B ≈ 5GB | - |
| `audit_record` | 연 5000만 행 × 약 300B ≈ 15GB / 년 | - |
| git 미러 (blobless) | 저장소당 평균 50MB × 3000 ≈ 150GB | blob 제외라 전체 클론 대비 크게 작다. 대형 저장소 편차 큼. **이 산정은 `MIRROR_ALLOW_BLOB_FETCH`가 꺼져 있을 때만 유효하다 (CR-023, DEV-111)** — 켜면 patch-id 계산이 blob을 지연 인출해 볼륨에 쌓으므로 시간이 지나며 전체 클론 쪽으로 수렴한다 |

**`raw_event` 4TB가 이 시스템에서 가장 큰 저장 항목이다.** OD-003이 보존 3년으로 확정되었으므로(CR-004) 4TB가 계획 용량이다. 월별 파티션 구성은 그대로 유지하고, 만료분은 `DELETE`가 아니라 파티션 드롭으로 정리한다 — 5억 행 규모에서 행 단위 삭제는 vacuum 부하와 테이블 팽창을 만든다. 보존 기간을 바꾸려면 CR이 필요하지만, 월별 파티션이라 어떤 기간으로 바꾸더라도 드롭 대상 파티션 목록만 달라진다.

ES 아카이브(약 700GB)와 `raw_event`(4TB)는 같은 payload를 담지만 역할이 다르다. 보존 보증은 PostgreSQL이 지고, ES 아카이브는 ILM 창(약 97일) 안의 조회 편의를 위한 파생 사본이라 백업 대상이 아니며 `raw_event`에서 재구성한다 (FR-ING-010 AC-1, 데이터 모델 8장). ES 아카이브가 커지면 줄일 수 있는 손잡이는 ILM 창이고, 이를 줄여도 보존 보증은 영향받지 않는다.

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
| 아웃바운드 | `web` → Redis | 허용 목록 (OIDC 콜백이 세션을 발급한다, CR-018 DEV-071) |
| 아웃바운드 | 서비스 → 알림 채널 | 허용 목록 |

인터넷 노출은 없다. 아웃바운드는 허용 목록 방식이며, 목록에 없는 목적지로의 연결을 차단한다.

**Profile A의 노출 규칙** (CR-059 / ADR-021). 오케스트레이터의 네트워크 정책이 없으므로 **노출 자체를 줄이는 것이 통제 수단이다.**

- 서비스 사이 통신은 **Compose 사설 네트워크 안에서만** 이루어진다. PostgreSQL·Elasticsearch·Redis는 **호스트 포트를 발행하지 않는다** — 개발용 `docker-compose.yml`이 5432·9200·6379를 여는 것과 반대이며, 그 차이가 두 파일을 합치지 않는 이유 중 하나다.
- 호스트에 발행하는 포트는 **사용자 접점 둘뿐이다**: `web`(사용자)과 `ingest-gateway`(GHE 웹훅). `search-api`는 발행하지 않는다 — 조회는 전부 `web`을 거치므로(ADR-011) 외부에서 직접 닿을 이유가 없다.
- **리버스 프록시를 자동으로 세우지 않는다.** Next.js가 이미 그 자리에 있고, TLS 종료나 단일 엔드포인트 통합이 사내 요구로 실증되기 전에 nginx·Caddy·Traefik 의존을 새로 만들 이유가 없다. 필요해지면 근거와 함께 가장 단순한 선택을 한다.

네트워크 정책:

- `pipeline-worker`는 인바운드 연결을 받지 않는다.
- `ingest-gateway`는 아웃바운드로 PostgreSQL·Redis에만 접근한다. GHE API를 호출하지 않는다.
- Filebeat는 Elasticsearch로만 아웃바운드한다.
- **`filebeat`는 DaemonSet이 아니라 `ingest-gateway`의 사이드카다** (CR-052, DEV-373). 이전 판은 DaemonSet으로 적었고 시스템 아키텍처는 "DaemonSet/사이드카" 둘을 열어 두어 **두 문서가 어긋나 있었다.** 사이드카로 확정하는 이유는 `ingest-gateway`가 replica 2 이상이기 때문이다 — 여러 파드가 하나의 공유 파일에 덧붙이면 평균 8KB인 payload가 `PIPE_BUF`(4KB)를 넘어 `O_APPEND`의 원자성이 보장되지 않고, **섞인 줄은 두 이벤트의 조각을 하나로 읽히게 한다**(DEV-369). 파드마다 자기 파일을 쓰고 자기 사이드카가 읽으면 그 경합이 성립하지 않으며, `hostPath` 권한도 필요 없다.
- **아카이브 볼륨은 `emptyDir`이다.** 컨테이너 재시작에는 살아남으므로 예외 처리가 정한 "적재기가 중단되면 파일은 디스크에 유지되고 재기동 시 마지막 오프셋부터"가 성립한다. 파드 자체가 사라지면 미전송분도 사라지지만, 보존 보증은 `raw_event`가 지고 아카이브 인덱스는 그것으로부터 재구성할 수 있다 (`ADR-003`: 백업 대상 아님).
- `gh-executor`는 구성된 GitHub Enterprise 호스트로만 아웃바운드한다. 그 외 목적지는 네트워크 정책에서 차단한다 (NFR-010).
- `gh-executor`는 PostgreSQL과 Redis에 접속하되 Elasticsearch에는 접속하지 않는다.
- `web`은 OIDC IdP와 Redis로만 아웃바운드한다 (CR-018, DEV-071). PostgreSQL·Elasticsearch에는 접속하지 않는다 — 조회는 전부 `search-api`를 거친다.

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

**Profile A의 저장 수단** (CR-059 / ADR-021). ConfigMap도 Kubernetes Secret도 없으므로 둘 다 **호스트 파일**로 내려온다.

| 구분 | Profile B | Profile A |
| --- | --- | --- |
| 비밀 아닌 설정 | ConfigMap | `deploy/single-host/.env` (저장소에 커밋하지 않는다) |
| 시크릿 | Kubernetes Secret | 호스트의 별도 파일. 소유자만 읽도록 권한을 좁히고 사내 시크릿 관리에서 주입한다 |
| 재배포 없이 반영 | 파드 재시작 | 컨테이너 재시작 (`prsctl` 재적용) |

**시크릿 파일은 어떤 번들에도 들어가지 않는다** (DEV-499). 번들에는 `.env.example`만 담기며, 값이 채워진 파일은 반입 대상이 아니라 사내에서 만드는 것이다 — `NFR-005`의 "시크릿 노출 0건"이 막으려는 것이 정확히 그 경로다.

"재배포 없이 반영"되는 항목을 명시하는 것이 운영성 요구(NFR-008)의 일부다. 운영자가 장애 중에 무엇을 바꿀 수 있는지 알아야 한다.

## 8. 개발/실행 명령

WP-001 시점의 실제 명령이다. 아직 구현되지 않은 명령은 그것을 만드는 WP를 함께 적었다. 실행 브리프가 이 절을 인용한다.

```bash
# 전제: Node 20+, pnpm 10+, Docker

# --- WP-001에서 동작하는 명령 ---
pnpm install                      # 의존성 설치
pnpm dev                          # docker compose up -d 후 전 앱 개발 서버
pnpm dev:web                      # 웹만
pnpm dev:api                      # search-api만
pnpm dev:worker                   # pipeline-worker만
pnpm typecheck                    # tsc --build (전 패키지) + web의 tsc --noEmit
pnpm lint                         # ESLint
pnpm lint:deps                    # 패키지 의존 방향 검사 (역방향 참조 시 종료 코드 1)
pnpm test                         # 단위 + 계약 테스트 (Vitest)
pnpm build                        # 전 패키지·앱 빌드
pnpm clean                        # 빌드 산출물 제거

# --- WP-002에서 동작하는 명령 (PostgreSQL 필요) ---
pnpm db:migrate                   # 미적용 마이그레이션 전부 적용
pnpm db:migrate --down            # 적용분 전부 회수 (up의 역연산)
pnpm db:migrate --down --step 1   # 최신 1개만 회수
pnpm db:partitions                # 월별 파티션 생성 (기본 3개월치)
pnpm db:seed                      # 개발용 합성 시드 (저장소 3, PR 200, 커밋 500, 릴리스 10)
pnpm test:integration             # 실제 PostgreSQL·Elasticsearch 대상 통합 테스트

# --- WP-003에서 동작하는 명령 (Elasticsearch 필요) ---
pnpm es:apply-mappings            # 엔티티 인덱스 4종 생성 + 별칭 부여

# --- 후속 WP가 추가하는 명령 ---
pnpm test:e2e                     # Playwright                                   — WP-020
pnpm test:a11y                    # axe 검사                                     — WP-020
pnpm es:reindex --alias <별칭>    # 재색인 + 별칭 전환                           — WP-035

# --- 단일 호스트 프로파일 (CR-059 / ADR-021) — WP-070 · WP-071 ---
./deploy/single-host/build-bundle.sh <version> [출력 디렉터리]
#                                 # 이미지 빌드 + 오프라인 번들 + 운반 아카이브 (외부망에서) — WP-070·WP-071
#                                 # `pnpm release:bundle`이라는 스크립트는 없다 (DEV-523). 정본은 이 스크립트 하나다
./deploy/single-host/build-bundle.sh <version> --release
#                                 # 위에 더해 운반 아카이브를 GitHub Release <version>의 자산으로 발행하고 다시 읽어 digest 대조 (외부망) — WP-072 (CR-063)
GH_TOKEN=<읽기 토큰> gh release download <version> -R <owner>/<repo> -p '*.tar.gz'
#                                 # 사내에서 받는다 — 이 저장소 한정 읽기 토큰. sha256sum을 자산 digest와 대조한 뒤 tar -xzf — WP-072
deploy/single-host/prsctl verify  # 번들 checksum 검증 (사내)                        — WP-070
deploy/single-host/prsctl load    # 번들의 이미지 tar를 로컬 daemon에 적재 (사내). .env가 먼저다 (DEV-524) — WP-070
deploy/single-host/prsctl install # migration → mapping → up → health              — WP-070
deploy/single-host/prsctl health  # 전 서비스 health 판정                          — WP-070
deploy/single-host/prsctl smoke   # read-only 검색 스모크                          — WP-070
deploy/single-host/prsctl backup  # PostgreSQL 논리 백업 (9.4장)                   — WP-070
deploy/single-host/prsctl restore # 백업 복원 + 재색인                             — WP-070
```

DB 접속 정보는 환경 변수에서만 읽는다 (`@prs/db`의 `resolvePoolConfig`). 우선순위는 `DATABASE_URL` → 개별 `POSTGRES_*` → 로컬 기본값이다. 통합 테스트는 `POSTGRES_TEST_DB`(기본 `prs_test`)를 써서 개발용 DB와 분리한다.

Elasticsearch 접속도 같은 원칙이다 (`@prs/es`의 `resolveClientOptions`). `ELASTICSEARCH_NODE`가 없으면 `http://localhost:9200`을 쓰고, `ELASTICSEARCH_API_KEY`가 있으면 인증에 사용한다.

`pnpm test`(단위)와 `pnpm test:integration`(백킹 서비스 필요)을 분리해 둔 이유는, 백킹 서비스가 없는 환경에서도 단위 검증이 항상 돌아야 하기 때문이다. CI는 두 잡으로 나뉘며 통합 잡이 PostgreSQL 서비스 컨테이너를 띄운다.

로컬 백킹 서비스는 저장소 루트의 `docker-compose.yml`이 띄운다. local 환경은 2장 표에 따라 Elasticsearch 노드 1개·복제본 0이며, 운영의 전용 3노드 구성(OD-006, 4.1장)을 재현하지 않는다.

| 서비스 | 이미지 | 포트 |
| --- | --- | --- |
| PostgreSQL | `postgres:16-alpine` | 5432 |
| Elasticsearch | `docker.elastic.co/elasticsearch/elasticsearch:8.19.0` | 9200 |
| Redis | `redis:7-alpine` | 6379 |

각 앱은 3장이 정의한 `GET /healthz`를 노출한다.

| 앱 | 포트 | 비고 |
| --- | --- | --- |
| `web` | 3000 | Next.js 라우트 핸들러 |
| `ingest-gateway` | 3001 | Fastify |
| `search-api` | 3002 | Fastify |
| `pipeline-worker` | 3003 | 순수 Node `node:http`. 3장의 하트비트를 HTTP로 노출한 것이며 요청 처리 서비스가 아니다 (DEV-002) |

로컬 개발은 GHE 없이도 가능해야 한다. 목 웹훅 이벤트 주입기와 합성 시드는 WP-002·WP-004가 `pnpm dev` 경로에 더한다.

## 9. 운영 절차

### 9.1 배포

**Profile A — 첫 사내 반입** (CR-059 / ADR-021). 외부망에서 만든 **운반 아카이브 하나**(`pr-search-<version>-offline.tar.gz`, CR-062 / WP-071)가 **GitHub Release 자산**으로 발행되고 사내에서 받는다 (CR-063 / WP-072).

```text
[외부망]  main의 특정 커밋
            → 이미지 빌드 (versioned tag + digest)
            → 오프라인 번들 생성 (이미지 tar · 소스 계보 · compose · manifest · checksum)
            → 운반 아카이브 pr-search-<version>-offline.tar.gz  (사내로 가져갈 파일 하나)
            → GitHub Release <version> 발행 (태그 = 버전 · target = manifest의 커밋 · 자산 = 아카이브)
            → 발행한 자산을 다시 읽어 이름·크기·digest 대조
──────────  github.com (HTTPS · 이 저장소 한정 읽기 토큰) — 닿지 않는 환경이면 조직의 반입 채널  ──────────
[사내망]  gh release download → sha256sum == 자산 digest → 아카이브 extract → checksum 검증 → .env 작성
            → 이미지 load → migration → ES mapping → compose up → health → smoke → lineage
```

**번들을 받는 단계만 github.com에 닿는다** (CR-063, DEV-528). 설치·운영은 여전히 인터넷 없이 성립한다. 사내가 github.com에 닿는다고 해서 사내에서 직접 `docker pull`·`git clone`하는 방식으로 바꾸지 않는다 — 번들 경로는 검증됐고, 직접 pull은 설치와 롤백을 외부 가용성에 묶으며, Docker 데몬의 프록시·CA 경로는 미검증이다(`ADR-021` 정정 절). 받는 데 쓰는 읽기 토큰은 `.env`·번들·저장소 어디에도 두지 않는다(보안 문서 6장).

**`.env`가 `load`보다 먼저다** (CR-062, DEV-524). `load`는 적재 뒤 `PRS_VERSION`의 이미지가 실제로 있는지 검증하므로 그 값을 먼저 알아야 하고, 필수 구성의 부재는 **이미지 저장소를 바꾸기 전에** 말해야 한다. 번들 안의 아카이브는 세 종류이며 다루는 명령이 다르다 — 운반 아카이브는 `tar -xzf`, 이미지 tar(`images/*.tar`)는 `prsctl load`가 `docker load`로 읽으며 **직접 풀지 않는다**, 소스 계보(`source/*.bundle`)는 `git fetch`다. 절차의 정본은 번들 안에 함께 들어가는 `deploy/single-host/RUNBOOK.md`다.

**사내에서 `git clone`·`pnpm install`·레지스트리 접근을 요구하지 않는다.** 요구하는 순간 그 절차는 사내망에서 실행 불가능하다. 반입된 형상이 어느 외부 커밋에서 나왔는지는 `release-manifest.json`이 답한다 — **그 질문에 답하지 못하면 다음 반입에서 무엇을 합쳐야 하는지도 알 수 없다.**

**Profile B — 다중 호스트**

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

**Profile A(단일 호스트)의 백업 경로는 다르다** (CR-059 / ADR-021). 관리형 서비스도 스냅샷 저장소도 없으므로 **정본별로 다른 수단을 쓰며, 모든 볼륨을 tar로 묶는 방식은 택하지 않는다** — 재구성 가능한 캐시를 백업하는 것은 복구 시간을 늘릴 뿐이고, 실행 중인 데이터 디렉터리의 파일 복사는 일관성을 보장하지 않는다.

| 대상 | Profile A 방식 | 근거 |
| --- | --- | --- |
| PostgreSQL | `pg_dump`(논리 백업)를 컨테이너 안에서 실행해 호스트로 내린다 | **유일한 정본이다** (ADR-004). 실행 중 파일 복사는 일관성이 없다 |
| Elasticsearch | **백업하지 않는다.** PostgreSQL에서 재색인해 복구한다 | ADR-004가 전량 재구성 가능을 보장한다. RTO 30분 목표는 Profile A에 적용되지 않으므로(NFR-004) 스냅샷 저장소를 세울 이유가 없다 |
| Redis | **백업하지 않는다.** 재기동 후 `JOB-ING-007` 아웃박스 재적재가 미처리 이벤트를 되살린다 | 큐 내용은 유실되어도 데이터 유실이 아니다 (11장). 세션은 재로그인으로 복구된다 |
| git 미러 | **백업하지 않는다.** 재클론으로 복구한다 | 재구성 가능한 캐시다 (4장) |
| 원본 아카이브 볼륨 | **백업하지 않는다.** `raw_event`가 보존 보증을 진다 | ADR-003: 백업 대상 아님 |
| 구성(`.env`)·시크릿 | **백업 대상이 아니다.** 사내 시크릿 관리에서 다시 주입한다 | 6장 규칙. 백업에 시크릿을 담으면 그것이 새 노출 경로가 된다 |

**복구는 `pg_dump` 산출물 하나에서 시작한다** — PostgreSQL 복원 → **마이그레이션 재적용** → 접속 주체 프로비저닝 → **파생 색인 삭제** → ES 매핑 적용 → **전량 재색인(별칭마다 순차 완료)**. 재색인은 클러스터를 통째로 쓰므로 전역 동시 실행 상한이 1이며, 넷을 연달아 예약하면 셋이 거절되어 **지워진 색인이 빈 채로 서비스된다** (CR-061, DEV-519). 이 경로가 실제로 도는지는 `WP-070`이 destructive restore로 검증했다.

**마이그레이션을 다시 적용하는 이유** (CR-060, DEV-514): 백업이 현재 릴리스보다 이전이면 복원된 스키마도 그 시점의 것이라 현재 코드가 없는 열을 읽다 죽는다. 설치·업그레이드가 이미 하는 일이며 복구만 빠뜨리고 있었다.

**파생 색인을 지우는 이유** (CR-060, DEV-511): 복원한 정본보다 **새로운 문서가 색인에 남아 있으면 검색이 정본에 없는 것을 답한다** — 되돌린 데이터가 조회로 되살아난다. 매핑만 다시 적용하는 것으로는 기존 인덱스가 그대로 남는다. **비어 있는 색인이 틀린 색인보다 낫다**: 전자는 "아직 없다"이고 후자는 거짓이다 (ADR-004).

**Profile A의 실효 RPO는 `RPO 0`이 아니다** (CR-060, DEV-504). 위 표의 주기 논리 백업만으로는 **호스트나 볼륨을 잃는 순간 마지막 백업 이후 수신분이 사라진다** — `NFR-004`의 `RPO 0`은 "원본 저장 후 202 응답" 규칙에 기대는데 그 규칙은 **프로세스 실패**만 덮는다. `RPO 0`을 실제로 지키려면 **연속 WAL 아카이빙을 독립된 저장소(다른 호스트·다른 볼륨)로** 보내야 하며, 그 구성은 파일럿 승인 조건에서 결정한다. 그전까지 실효 RPO는 **마지막 백업 이후 경과 시간**이고 백업 주기가 그 값을 정한다.

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

**Profile A의 재해 복구는 하나로 수렴한다** (CR-059). 대기 복제본도 스냅샷 저장소도 없으므로 **호스트가 살아 있으면 컨테이너 재기동, 호스트를 잃으면 `pg_dump` 복원 + 전량 재색인**이다. Elasticsearch·Redis·미러·아카이브 볼륨은 전부 재구성 가능하므로 복구 경로에 PostgreSQL 하나만 남는다 — 그것이 9.4장이 정본별로 수단을 가른 이유다. 소요는 저장소 규모에 비례하며 **RTO 30분을 약속하지 않는다.** **호스트를 잃는 경우의 RPO도 0이 아니다** — 마지막 백업 이후 경과 시간이며, 연속 WAL 아카이빙을 독립 저장소로 보내야 그것이 0이 된다 (9.4장, DEV-504).

**RPO 0의 근거**: 웹훅 수신 시 `raw_event` durable 저장 후에만 202를 반환한다. 저장 실패 시 500을 반환해 GHE가 재전송한다. 따라서 GHE가 성공으로 간주한 이벤트는 반드시 PostgreSQL에 있다.

### 9.6 정기 정리

| 작업 | 주기 | 잡 |
| --- | --- | --- |
| **다가올 월 파티션 생성 (기본 3개월치)** | 일 1회 | JOB-AUD-001 (CR-054, DEV-417) |
| 원본 이벤트 보존 만료 파티션 드롭 | 일 1회 | JOB-AUD-001 |
| 감사 기록 보존 만료 파티션 드롭 | 일 1회 | JOB-AUD-001 |
| 완료 잡·해소된 DLQ 정리 (90일) | **미승인** | **없음** (CR-054, DEV-407) |
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
| 집계 부하 | 검색 지연 동반 상승 | 집계 상한 강화, 검색 스레드풀 상한·서킷 브레이커 조정. 코디네이팅 노드 분리는 확정된 3노드를 넘는 증설이라 별도 CR |
| 저장소 수 증가 | 미러 디스크·백필 시간 증가 | PVC 확장, 백필 동시성 상향 |
| 문서 수가 설계치 70% 도달 | ES 샤드당 크기 증가 | 샤드 수 재산정 후 재색인 |

**GHE rate limit이 보강 처리량의 근본 상한이다.** 워커를 늘려도 API 한도를 넘을 수 없다. 그래서 미러 우선 조회(ADR-005)가 처리량 확보의 핵심 수단이다.

## 11. 알려진 인프라 제한

| 제한 | 영향 | 대응 |
| --- | --- | --- |
| `raw_event` 4TB (3년 보존 확정) | 스토리지 비용 | OD-003 결정값(CR-004). 월별 파티션이라 보존 기간을 바꾸면 파티션 드롭 대상만 달라진다 |
| ES 컨테이너 3개의 호스트 배치가 정해지지 않음 | 한 호스트에 몰리면 호스트 장애 1건으로 클러스터 전체 중단, 복제본 1과 마스터 quorum 모두 무의미 | REL-001 프로비저닝에서 마스터 자격 노드 3개의 호스트 분리를 확인한다 (4.1장) |
| ES 아카이브 약 700GB는 건당 크기 가정에 의존 | 실측치가 크면 노드 디스크 산정이 어긋난다 | WP-036 구축 시 실제 인덱스 크기를 측정하고, 필요하면 ILM 창을 줄인다 (보존 보증은 PostgreSQL이 지므로 영향 없음) |
| 미러 볼륨 150GB 추정의 편차가 큼 | 대형 저장소 몇 개가 대부분을 차지할 수 있음 | 저장소별 미러 크기 지표화, 상위 저장소는 API 폴백 전환 검토 |
| Redis 유실 시 큐 내용 손실 | 처리 지연 | 아웃박스 재적재로 복구 (데이터 유실 아님) |
| 단일 리전 배포 | 리전 장애 시 전체 중단 | 사내 시스템이며 GHE도 같은 리전이다. 별도 DR 리전을 두지 않는다 |
| **Profile A는 호스트 장애가 곧 전체 장애다** | `NFR-004`의 가용성 목표와 RTO 30분을 그 형상에서 보장하지 않는다 | **파일럿 단계에서 승인된 trade-off다** (CR-059 / ADR-021). 대신 재기동·영속 볼륨·백업/복구·재구축 가능성을 보장한다. 다중 서버가 필요해지면 Profile B로 승격한다 |
| **Profile A에서 실측할 수 없는 항목이 있다** | 사내 GHE·OIDC·CA·프록시·DNS·실서버 성능·실데이터 규모 | 외부망에서 합성해 통과로 만들지 않는다. 릴리스 검증 계획이 `NOT RUN — internal environment required`로 구분하며, 사내 반입 뒤 실행한다 (CR-059). **2026-09-07 첫 반입이 그중 GHE·CA·실데이터 규모를 채웠다** — 남은 것은 런북 7장이 갱신된 목록을 갖는다 |
| **사내 프록시와 사설 CA를 받을 자리가 코드에 없다** | 사내망이 프록시를 강제하거나 사설 CA를 쓰면 GHE·OIDC 연결이 실패한다 | **CA는 성립했다** (2026-09-07) — `NODE_EXTRA_CA_CERTS`와 compose 마운트로 코드 변경 없이 섰고, `x-worker-base`가 얕게 합쳐져 워커 셋에는 개별 마운트가 필요하다는 것이 드러났다(`DEV-552`, 런북 6장). **프록시는 `DEV-494` open 그대로** — 첫 반입 호스트가 프록시를 강제했고 진단용 `curl`까지 경유시켰으나 서비스의 아웃바운드는 GHE뿐이라 막히지 않았다. 필요가 실증되면 configuration seam으로 연다 — **추측으로 미리 만들지 않는다** |
| **GHE에서 서버로의 인바운드가 없을 수 있다** | 웹훅이 도달하지 못해 증분 수집이 서지 않는다. 백필은 반대 방향이라 영향이 없어 **문제가 부분적으로만 보인다** | **2026-09-07 첫 반입에서 실제로 그랬다**(`DEV-550`). 통제가 대역이 아니라 목적지·포트 허용 목록으로 걸려 이웃 호스트는 닿고 이 서버는 닿지 않았다. 수신 포트를 허용 목록에 올리거나, GHE가 닿는 사내 호스트를 경유한다 — 첫 반입은 경유로 성립시켰고 그것은 **단일 경로**다. 절차와 제약은 런북 2.C |
| staging이 운영 웹훅을 미러링 | GHE 웹훅 대상이 2개 | GHE 측 부하 미미. staging 장애가 운영에 영향 없음 |

## 12. gh 실행기 런타임 (CR-005 신규)

ADR-016이 정의한 격리 요건을 배포 수준에서 구체화한다.

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 실행 사용자 | 비루트 | NFR-010 |
| 루트 파일시스템 | 읽기 전용 | NFR-010 |
| 쓰기 가능 경로 | 실행별 임시 workspace 한 곳 | 실행 간 파일 공유 차단 |
| workspace 수명 | 실행 종료 즉시 폐기, 고아는 JOB-GH-005가 회수 | FR-GH-007 |
| gh 바이너리 | 이미지에 고정 버전으로 포함. 런타임 설치·업데이트 없음 | FR-GH-011 |
| `GH_CONFIG_DIR`, `HOME` | 실행 전용 임시 디렉터리 | 자격 증명 영속 저장 방지 |
| 프롬프트·페이저·색상 | 비활성화 (headless) | 대화형 대기로 인한 행 방지 |
| 자격 증명 | 실행 직전 환경 변수로 주입, 종료와 함께 제거 | ADR-014 |
| 네트워크 | 구성된 GHE 호스트 허용 목록 | NFR-010 |
| workspace 저장 매체 (Profile A) | tmpfs `/var/lib/prs/gh-workspaces` 256m (mode 0700, uid 1000) + `/tmp` 64m. 루트 파일시스템은 `read_only: true` | compose 정의 (CR-086) |
| 동시 실행 상한 | `GH_EXECUTOR_MAX_CONCURRENT` 기본 2 (1..파티션 4). 구독 수 = 동시 실행 수 | ADR-013 |
| 레지스트리 검사 (JOB-GH-003) | `GH_EXECUTOR_REGISTRY_CHECK_MS` 기본 86400000(1일, 최소 60000). 기동 시 한 번 **기다린 뒤** 구독 — 켜진 실행기의 ready까지 20~30초가 더 든다(command마다 `--help`; compose 헬스체크 interval 20s × retries 15 안). 드리프트·구조 실패면 헬스 `registry.stale=true`·지표 `gh_registry_stale=1`이고 실행은 `registry_stale`로 거절된다. 결과는 `gh_capability_verification`(append-only)에 남는다 (CR-088) | FR-GH-011 AC-3 |
| 시간 상한 | R0 `pr.list` 30초 (capability `timeoutMs`), 초과 시 `timed_out` | NFR-011 |
| 출력 상한 | stdout 1MiB · stderr 64KiB (설정), 이력 발췌 256KiB · 64KiB, 원본은 SHA-256만. 잘린 stdout은 결과 파싱 실패로 `failed` | FR-GH-006 AC-5 |
| 취소 | DB의 `cancel_requested_at`을 500ms마다 폴링 → 프로세스 그룹 SIGTERM → 1초 뒤 SIGKILL | NFR-011 (3초) |
| 실행 환경 변수 | 허용 목록 14키(`GH_ENTERPRISE_TOKEN`·`GH_HOST`·격리 `HOME`/`GH_CONFIG_DIR`/`TMPDIR`·headless 값·`SSL_CERT_FILE`), 부모 환경 미상속. `GH_TOKEN`·`GITHUB_TOKEN`은 목록에 없다 | NFR-010 |
| 사설 CA | gh(Go)는 `NODE_EXTRA_CA_CERTS`를 읽지 않는다. `GH_EXECUTOR_CA_FILE`(compose가 같은 값으로 배선)을 `SSL_CERT_FILE`로 넘긴다. 실행기의 Node 런타임은 GHE에 접속하지 않으므로 Node용 CA 변수를 받지 않는다 | 실측 (CR-086) |

**확정하지 않은 것.** 실행기의 CPU·메모리 요청·제한과 Profile B(K8s)의 manifest는 아직 없다 — `CR-086`은 K8s를 주력으로 만들지 않았다. Profile A의 tmpfs 크기·동시 실행 상한·출력·시간 상한은 위 표대로 확정했다.

`gh auth login`을 서버에서 실행해 자격 증명을 gh config에 영속 저장하지 않는다. 매 실행마다 주입하고 폐기하는 것이 유일한 경로다.
