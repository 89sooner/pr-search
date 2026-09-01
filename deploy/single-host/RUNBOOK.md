# PR Search 사내 반입·운영 런북 (Profile A)

> 대상: 단일 Linux 호스트 · Docker Compose · 오프라인 반입
> 근거: `CR-059` / `ADR-021` / `WP-070` · 인프라 문서 3.0장

이 문서는 **번들 안에 함께 들어온다.** 사내에서 저장소 문서를 열 수 없어도 이것만으로 반입과 운영이 성립해야 한다.

---

## 0. 이 배포가 무엇이고 무엇이 아닌가

**이것은 첫 사내 파일럿의 형상이다.** 서버 한 대에 컨테이너로 서며, **호스트 장애가 곧 전체 서비스 장애다.** 그것은 승인된 trade-off이며(`CR-059`), 대신 재기동·영속 볼륨·백업/복구·재구축 가능성을 보장한다.

**고가용 구성이 아니다.** `NFR-004`의 가용성 목표와 RTO 30분은 이 형상에서 보장하지 않는다. 다중 서버가 필요해지면 Profile B(Kubernetes)로 승격하며, 그 산출물은 `deploy/k8s/`에 이미 있다.

**반입 대상은 read-only Search/Investigation Plane이다.** GitHub Operations Plane(`gh-executor`)은 이 형상에 포함하지 않는다.

---

## 1. 사전 요건

| 항목 | 값 |
| --- | --- |
| OS | Linux (x86_64) |
| Docker Engine | 24 이상 · Compose v2 |
| 디스크 | 이미지 약 2GB + 데이터 (저장소 수에 비례) |
| RAM | 최소 8GB (Elasticsearch 힙 2GB 기준) |
| 네트워크 | **인터넷 불필요.** 사내 GHE와 사내 OIDC로만 나간다 |

**컨테이너 레지스트리에 접근하지 않는다.** 필요한 이미지는 전부 번들 안에 있다.

---

## 2. 반입 절차

```bash
# 0) 번들을 호스트에 옮긴 뒤 풀어 놓는다
cd pr-search-<version>-offline/deploy/single-host

# 1) 변조·손상 검증 — 실패하면 여기서 멈춘다
./prsctl verify

# 2) 이미지 적재 (verify를 포함해 실행한다)
./prsctl load

# 3) 구성 작성
cp .env.example .env
chmod 600 .env
$EDITOR .env          # 필수 값을 채운다. 비어 있으면 install이 거부한다

# 4) 설치 — migration → 접속 주체 → ES mapping → 기동 → health
./prsctl install

# 5) 스모크 — health가 아니라 실제 조회 왕복을 건다
./prsctl smoke

# 6) 이 형상의 출처 확인
./prsctl lineage
```

**각 단계는 실패하면 멈춘다.** checksum 불일치·이미지 부재·필수 값 부재·마이그레이션 실패·health 실패를 성공으로 접지 않는다.

### 데이터베이스 접속 주체는 `prsctl install`이 만든다

`.env`의 `POSTGRES_APP_USER`에 **`prs_app`이 아닌 이름**을 준다 (예: `prs_app_login`). `prs_app`은 마이그레이션 005가 만드는 `NOLOGIN` 그룹 롤이라 **그대로는 접속할 수 없다** (`DEV-503`).

`install`이 마이그레이션을 적용한 **뒤에** 그 주체를 만들고 `prs_app` 멤버십을 주며 세션 기본 역할을 `prs_app`으로 둔다 — 접속하면 `current_user = prs_app`이 되어 감사 기록 불변성의 제약이 그대로 걸린다. **순서가 중요하다**: `prs_app`은 마이그레이션이 만들므로 그전에는 멤버십을 줄 수 없다 (`DEV-510`).

`upgrade`도 같은 일을 다시 한다. 비밀번호를 회전했다면 `.env`만 고치고 `upgrade`를 돌리면 맞춰진다.

### 반입 후 데이터를 채운다

기동 직후 시스템은 **비어 있다.** 웹훅은 앞으로 오는 것만 받는다.

1. 운영 콘솔(`A-001`)에서 저장소를 등록한다.
2. GHE에 웹훅을 등록한다 — 대상은 `http://<호스트>:3001/webhooks/github`, 시크릿은 `.env`의 `GHE_WEBHOOK_SECRET`.
3. **백필을 실행한다** — 과거 PR 이력은 백필이 채운다(`JOB-ING-004`). `worker-enrich`가 그 역할을 함께 켜고 있다.
4. 시퀀스 채번과 관계 파생은 미러 동기화 뒤에 따라온다.

---

## 3. 일상 운영

| 목적 | 명령 |
| --- | --- |
| 상태 확인 | `./prsctl health` |
| 로그 | `docker compose -p pr-search --env-file .env -f compose.yml logs -f <서비스>` |
| 재기동 | `docker compose -p pr-search --env-file .env -f compose.yml restart <서비스>` |
| 전체 정지 | `docker compose -p pr-search --env-file .env -f compose.yml down` (볼륨은 남는다) |
| 백업 | `./prsctl backup` |
| 복구 | `./prsctl restore <백업 파일>` |

**`down -v`를 쓰지 마라.** 볼륨을 지우며 그것은 정본 손실이다.

### 업그레이드

```bash
# 새 번들에서
# **이전 설치의 .env를 먼저 가져온다** (DEV-513) — 번들은 값이 채워진 .env를
# 담지 않으므로(시크릿이다) `prsctl load`가 그것 없이는 멈춘다.
cp <이전 설치 경로>/deploy/single-host/.env .env
chmod 600 .env
# 또는 복사하지 않고 지정한다:  export PRS_ENV_FILE=<이전 .env 절대경로>

./prsctl verify && ./prsctl load
$EDITOR .env          # PRS_VERSION을 새 값으로
./prsctl upgrade      # migration → 접속 주체 → ES mapping → 컨테이너 교체 → health
```

**마이그레이션이 먼저다.** 하위 호환이므로 옛 코드가 새 스키마 위에서 돈다(데이터 모델 7장). 롤백은 `.env`의 `PRS_VERSION`을 이전 값으로 되돌리고 `./prsctl upgrade`를 다시 실행한다 — **이전 이미지가 로컬에 남아 있어야 하므로 번들을 지우지 마라.**

---

## 4. 백업과 복구

**정본은 PostgreSQL 하나다** (`ADR-004`). 나머지는 전부 재구성 가능하다.

| 대상 | 방식 | 이유 |
| --- | --- | --- |
| PostgreSQL | `pg_dump` 논리 백업 | **유일한 정본.** 실행 중 파일 복사는 일관성이 없다 |
| Elasticsearch | 백업하지 않는다 | PostgreSQL에서 재색인해 복구한다 |
| Redis | 백업하지 않는다 | 큐는 아웃박스(`JOB-ING-007`)가 복구하고 세션은 재로그인이다 |
| git 미러 | 백업하지 않는다 | 재클론 가능한 캐시다 |
| 원본 아카이브 | 백업하지 않는다 | `raw_event`가 보존 보증을 진다 |
| `.env` | **백업에 담지 않는다** | 시크릿이다. 사내 시크릿 관리에서 다시 주입한다 |

**모든 볼륨을 tar로 묶는 구현은 하지 않는다** — 재구성 가능한 캐시를 백업하는 것은 복구 시간을 늘릴 뿐이다.

**복구는 파생 색인을 지우고 다시 만든다** (`DEV-511`·`DEV-519`). 재색인은 **전역 동시 실행 상한이 1**이므로 `restore`가 네 별칭을 **하나씩 끝까지** 돌린다 — 연달아 예약하면 첫 하나만 서고 나머지 셋이 거절되는데, 넷을 모두 지운 뒤라 그 셋이 **빈 채로 서비스된다.** 오래 걸리면 `PRS_REINDEX_TIMEOUT_S`(기본 3600초)를 늘린다. **끝나지 않은 별칭이 있으면 `restore`가 그 이름을 말하고 종료 코드 1을 낸다** — 절반만 선 상태를 완료로 보고하지 않는다. 복원한 정본보다 새로운 문서가 색인에 남아 있으면 검색이 **정본에 없는 것을 답한다** — 되돌린 데이터가 조회로 되살아나는 것이다. `restore`가 엔티티 색인을 삭제하고 매핑을 다시 적용한 뒤 전량 재색인을 예약하므로, **재색인이 끝날 때까지 검색 결과는 부분적이다.** 진행 상태는 운영 콘솔의 재색인 화면에서 본다.

**복구는 마이그레이션도 다시 적용한다** (`DEV-514`). 백업이 현재 릴리스보다 이전이면 복원된 스키마도 그 시점의 것이라 현재 코드가 없는 열을 읽다 죽는다.

---

## 5. 영구 다운스트림 형상 관리

**이것이 이 반입의 전제다.** 사내망에 들어온 코드는 외부로 반출할 수 없다. 따라서 형상 정책은 **양방향 동기화가 아니다.**

```text
External repository = upstream release producer
              │
              │  one-way import only
              ▼
Internal repository = permanent downstream product line
```

### 브랜치 두 개

| 브랜치 | 뜻 | 규칙 |
| --- | --- | --- |
| `vendor/upstream` | 외부에서 반입한 upstream baseline | **내부 기능 수정 금지.** 반입한 것만 올린다 |
| `company/main` | 실제 사내 운영 형상 | 내부 통합·핫픽스·제품 패치가 누적된다 |

*(이름은 예시다. 사내 Git 정책에 더 맞는 이름이 있으면 그것을 쓰되 두 역할의 구분은 유지한다.)*

### 첫 반입

```bash
git init pr-search && cd pr-search
git fetch ../pr-search-<version>-offline/source/pr-search-<version>.bundle HEAD:vendor/upstream
git branch company/main vendor/upstream
git checkout company/main
```

### 다음 반입

```bash
# 1) upstream baseline을 갱신한다 — 이 브랜치에는 내부 수정이 없다
git checkout vendor/upstream
git fetch ../pr-search-<new>-offline/source/pr-search-<new>.bundle HEAD
git merge --ff-only FETCH_HEAD

# 2) 운영 형상으로 통합한다
git checkout company/main
git merge vendor/upstream        # 충돌은 여기서 푼다
```

**merge를 쓰고 rebase를 쓰지 않는다.** 다운스트림에서 감사 대상은 "우리가 무엇을 바꿨는가"이고, 매번 내부 이력을 upstream 위로 재작성하면 그 이력이 반복해서 새로 만들어져 추적성을 잃는다.

**내부 수정을 외부로 되돌리는 절차는 없다.** 그것이 성립하지 않는 것이 이 반입의 전제이며, 성립하는 척하는 절차를 만드는 것이 더 나쁘다.

### 내부 변경을 셋으로 나눈다

우선순위는 **위에서 아래로**다. 아래로 갈수록 다음 반입의 충돌 비용이 커진다.

| 등급 | 무엇 | 예 |
| --- | --- | --- |
| **A. Configuration** | 코드를 고치지 않고 `.env`·compose로 흡수 | GHE URL, OIDC, CA, 호스트명, 포트, 볼륨 경로 |
| **B. Internal integration** | 사내 전용 배선을 **격리된 자리**에 더한다 | 사내 감시 연동, 사내 배포 스크립트 |
| **C. Product patch** | upstream 코드 자체를 고친다 | 기능 수정, 버그 픽스 |

**A로 해결할 수 있으면 A로 해결한다.** C가 쌓일수록 다음 반입이 비싸진다. 다만 **아직 필요하지 않은 격리 계층을 미리 만들지 않는다** — 실제 사내 요구가 생겼을 때 그 자리를 연다.

---

## 6. 사내 환경 연동

### 사설 CA

**코드 변경이 필요 없다.** Node 런타임이 `NODE_EXTRA_CA_CERTS`를 직접 읽는다.

1. CA 인증서를 호스트에 둔다.
2. `compose.yml`의 해당 서비스에 그 파일을 읽기 전용으로 마운트한다.
3. `.env`의 `NODE_EXTRA_CA_CERTS`에 **컨테이너 안 경로**를 적는다.

`git` 서브프로세스는 별도로 `GIT_SSL_CAINFO`를 받는다.

### HTTP(S) 프록시 — 아직 지원하지 않는다

**비대칭이 있다.** `git`은 `http_proxy`/`https_proxy` 환경 변수를 받지만, **Node 22의 `fetch`(undici)는 그것을 보지 않는다.** GHE REST 호출과 OIDC 호출이 프록시를 거치지 않는다.

사내망이 프록시를 강제한다면 그 사실을 먼저 확인한 뒤 `GitHubTransport`의 `fetchImpl` 주입 지점으로 최소 수정한다. **추측으로 설정 표면을 만들어 두지 않았다** (`DEV-494`).

---

## 7. 무엇이 외부에서 검증됐고 무엇이 사내에서만 검증 가능한가

| 항목 | 상태 |
| --- | --- |
| 이미지 빌드·오프라인 번들·checksum·이미지 적재 | `VERIFIED (external)` |
| 마이그레이션 → 접속 주체 → ES 매핑 → 기동 → health | `VERIFIED (external)` |
| 스모크의 **조회 왕복**(PostgreSQL·Elasticsearch, 관리 토큰) | `VERIFIED (external)` |
| 스모크의 **`/search`** | `NOT RUN — internal environment required` — 세션 인증이 사내 OIDC를 요구한다 |
| 재기동 후 데이터 잔존 · pull 없이 기동 | `VERIFIED (external)` |
| 백업 → 파괴적 복구 | `VERIFIED (external)` |
| 실제 사내 GHE App·웹훅·저장소 권한 | `NOT RUN — internal environment required` |
| 실제 사내 OIDC와 그룹 클레임 | `NOT RUN — internal environment required` |
| 사내 CA·프록시·DNS·레지스트리·보안 스캔 | `NOT RUN — internal environment required` |
| 실서버 성능·실데이터 규모·실제 롤백 소요 | `NOT RUN — internal environment required` |
| `ACC-06` 관계 정확도 표본 검수 | `NOT RUN` — **합성 데이터로 만들어 내지 않는다.** `W-007`은 계속 비활성이다 |

**외부에서 증명할 수 없는 것을 통과로 적지 않는다.** 사내 반입 뒤 이 표의 아래쪽을 실제로 실행하고 그 결과를 기록한다.

---

## 8. 문제 해결

| 증상 | 확인 |
| --- | --- |
| `install`이 필수 값 부재로 멈춘다 | `.env`에 값이 실제로 채워졌는가. `KEY=`만 있으면 비어 있는 것이다 |
| compose가 이미지를 pull하려 한다 | `./prsctl load`를 실행했는가. `PRS_VERSION`이 적재한 태그와 같은가 |
| `enrich`·`reconcile`이 기동을 거부한다 | `GHE_APP_ID`·`GHE_APP_PRIVATE_KEY`·`GHE_INSTALLATIONS`가 있는가. **의도된 거부다** — 자격 없이 돌면 모든 이벤트가 실패 대기열에 쌓인다 |
| 웹훅이 전부 401 | `GHE_WEBHOOK_SECRET`이 GHE 쪽 설정과 같은가 |
| 검색 결과가 비어 있다 | 백필을 실행했는가. `worker-project` 로그에 색인 기록이 있는가 |
| `group_by=team`이 빈 결과 | `authz` 역할에 GHE 자격이 있는가 — 없으면 작성자 팀이 언제나 모름이다 |
| 로그인 후 다시 로그인 화면 | TLS 없이 HTTP로 서비스하면서 `SESSION_COOKIE_SECURE=true`인가 |
| `install`이 접속 주체 프로비저닝에서 멈춘다 | `POSTGRES_APP_USER`가 `prs_app`인가 — 그것은 그룹 롤이라 접속할 수 없다. 다른 이름을 준다 (DEV-503) |
| 업그레이드에서 `load`가 `.env`가 없다고 멈춘다 | 이전 설치의 `.env`를 복사했는가. 번들은 시크릿을 담지 않는다 (DEV-513) |
| 복구 뒤 검색 결과가 비어 있거나 부분적 | **정상이다.** 재색인이 도는 중이며 진행은 운영 콘솔에서 본다 (DEV-511) |
| 재색인이 `permission denied`로 실패 | 마이그레이션 022가 적용됐는가 (DEV-517). 005 이후 만들어진 표에 애플리케이션 롤 권한이 없었다 |
| 저장소 등록 요청이 `permission denied for sequence` | 마이그레이션 023이 적용됐는가 (DEV-518). `BIGSERIAL` 시퀀스에 권한이 없었다 |
| `restore`가 재색인 시간 초과로 끝난다 | `PRS_REINDEX_TIMEOUT_S`를 늘려 다시 실행하거나 운영 콘솔에서 남은 별칭을 실행한다 (DEV-519) |
| `ingest-gateway`가 503 | **DB 접속 주체가 `prs_app`인가** (DEV-503). 그것은 `NOLOGIN` 그룹 롤이라 접속이 거부된다. 로그인 주체를 만들었는지 확인하라 — 이 엔드포인트만 실제로 PostgreSQL을 확인하므로 **여기서 먼저 드러난다** |
