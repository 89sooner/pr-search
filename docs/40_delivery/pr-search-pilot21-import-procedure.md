# PR Search 사내 반입 절차서: 0.1.0-pilot.20에서 0.1.0-pilot.21로 올리기

> 작성 2026-09-30 · 대상 판 `0.1.0-pilot.21`(태그 → `4b73b70`) · 정본은 번들 안의 `deploy/single-host/RUNBOOK.md`
>
> 이 문서는 RUNBOOK의 3장·7.K·7.L을 사내에서 실행할 순서대로 이어 붙인 안내서입니다. 명령이나 판단 기준이 RUNBOOK과 다르면 RUNBOOK을 따릅니다. 사내 GHE 주소처럼 사내에만 있는 값은 `<…>`로 비워 두었습니다. pilot.18에서 pilot.20으로 올린 절차는 [pilot.20 절차서](pr-search-pilot20-import-procedure.md)입니다.

---

## 요약

사용자 보고(2026-09-28)로 사내는 `0.1.0-pilot.20`을 운영하고 있습니다. 1단계에서 이 판단을 먼저 확인합니다.

pilot.20과 pilot.21 사이에는 **마이그레이션과 Elasticsearch 매핑의 변경이 없습니다**(037 그대로). 그래서 pilot.20 때 한 스택 가져오기·재색인·PR 연결 정리가 필요 없고, 업그레이드(3장)와 GHE 주소 확인(7.K)으로 끝납니다. 새로 생긴 blame 기능(CR-135)은 **기본 꺼짐**이며, 켜려면 사내 GHES를 확인한 뒤 7단계를 따릅니다(선택).

| 단계 | 할 일 | RUNBOOK | 비고 |
| --- | --- | --- | --- |
| 1 | 지금 판을 확인한다 | - | 약 5분 |
| 2 | 사용자에게 먼저 알린다 | - | 업그레이드 전에 |
| 3 | 번들을 받아 SHA-256을 대조한다 | 2.B 1단계 | 약 1.1GB |
| 3-1 | (사내 빌드만) 소스 계보를 잇고 번들을 만든다 | 2.D·5장·2.A | 선택 |
| 4 | 도는 잡을 확인하고 백업한다 | 7.J 0번 | |
| 5 | 업그레이드하고 GHE 주소 전달을 확인한다 | 3장·7.K 1~3번 | 컨테이너를 교체하는 동안 잠시 멈춘다 |
| 6 | 화면으로 확인한다 | - | |
| 7 | (선택) blame을 켠다 | 7.L | 사내 GHES를 확인한 뒤 |

### 하지 않는 것

- 옛 `compose.yml`을 복사해 새 파일을 덮지 않습니다. 새 판이 search-api에 더한 두 줄(`SOURCE_BLAME_ENABLED`·`GHE_GRAPHQL_URL`)이 사라집니다.
- `prsctl load`가 끝나기 전에 `compose.yml`을 고치지 않습니다. `load`가 checksum을 다시 검사해 거부합니다.
- 재색인과 `links import-stacks`를 다시 돌리지 않습니다. 이 판에는 필요하지 않습니다.
- `docker compose … down -v`를 쓰지 않습니다. 볼륨과 함께 정본이 사라집니다.
- 옛 판의 번들 디렉터리와 이미지를 지우지 않습니다. 롤백에 필요합니다.

### 이 순서를 어디까지 검증했나

- 격리 환경에서 한 번 끝까지 돌렸습니다. pilot.18 상태 스냅숏에서 공식 pilot.20 자산으로 [pilot.20 절차서](pr-search-pilot20-import-procedure.md)의 순서대로 올려 「pilot.20 상태」를 만들고, 그 상태에서 후보 번들 `0.1.0-pilot.21-rc1`로 이 문서의 5단계를 실제 번들의 `prsctl`로 밟았습니다. 새 키가 없는 옛 `.env`로 올라갔고, 업그레이드 전후의 PostgreSQL 정본·Elasticsearch 문서·조회 결과가 같았습니다(원장 머리 절 「0.1.0-pilot.21 발행」). 발행본의 앱 이미지 7종은 그 후보와 ID가 같습니다.
- 사내에서는 돌리지 않았습니다(NOT RUN). 실제 GHE·인증서·프록시에서의 동작, 롤백 경로, 7단계(blame 켜기)는 확인하지 않았습니다.

---

## 표기 약속

모든 명령은 서비스 호스트의 bash에서 실행합니다. 새 셸을 열 때마다 아래 세 줄을 먼저 붙여 넣습니다.

```bash
# 지금 돌고 있는 판의 설치와 새 번들의 deploy/single-host 절대 경로. 사내 경로로 바꾼다
OLD=/opt/pr-search/import/pr-search-0.1.0-pilot.20-offline/deploy/single-host
NEW=/opt/pr-search/import/pr-search-0.1.0-pilot.21-offline/deploy/single-host
# prsctl 안의 compose 호출과 같은 형태다. 현재 디렉터리의 .env와 compose.yml을 쓴다
prsdc() { docker compose --project-name pr-search --env-file .env -f compose.yml "$@"; }
```

- `prsdc`는 현재 디렉터리를 기준으로 동작합니다. 5단계에서 업그레이드하기 전에는 `cd "$OLD"`에서, 업그레이드한 뒤에는 `cd "$NEW"`에서 부릅니다.
- `PRS_PROJECT`로 프로젝트 이름을 바꿔 쓰고 있다면 `pr-search`를 그 값으로 바꿉니다.
- `psql -U prs -d prs`는 RUNBOOK의 표기입니다. `.env`의 `POSTGRES_OWNER_USER`·`POSTGRES_DB`가 다르면 그 값으로 바꿉니다. 값을 얻으려고 `.env`를 `source`로 읽지 않습니다.
- 작업 전체를 기록하려면 먼저 `script -a ~/prs-upgrade-$(date +%Y%m%d).log`를 실행하고, 그것이 연 새 셸 안에서 위 세 줄을 붙여 넣습니다. 기록 중에는 `.env`나 `prsdc config`의 원문을 화면에 출력하지 않습니다.

---

## 1단계: 지금 판을 확인한다

```bash
cd "$OLD"
grep '^PRS_VERSION=' .env
docker ps --filter label=com.docker.compose.project=pr-search --format '{{.Names}}\t{{.Image}}' | sort
prsdc exec -T postgres psql -U prs -d prs -tAc "SELECT max(version) FROM schema_migration"
```

| `max(version)` | 이미지 태그 | 지금 판 | 따라갈 곳 |
| --- | --- | --- | --- |
| `037` | `0.1.0-pilot.20` | pilot.20 | 이 문서의 2~7단계 |
| `037` | `0.1.0-pilot.19` | pilot.19 | [pilot.20 절차서](pr-search-pilot20-import-procedure.md)의 부록 A로 pilot.20까지 올린 뒤 이 문서 |
| `036` | `0.1.0-pilot.18` | pilot.18 | [pilot.20 절차서](pr-search-pilot20-import-procedure.md) 본문으로 pilot.20까지 올린 뒤 이 문서 |

pilot.18·19에서 pilot.21로 바로 올리는 경로는 리허설하지 않았습니다. pilot.20 절차서의 정리 단계(스택 가져오기·재색인·PR 연결 확인)를 먼저 마칩니다.

---

## 2단계: 사용자에게 먼저 알린다

화면의 동작이 몇 가지 바뀝니다. 아래 문안을 그대로 써도 됩니다.

```text
[PR Search 업그레이드 안내: <날짜> <시각>]
- 검색·조회가 예상하지 못한 오류로 실패하면 안내 문구와 문의용 ID(correlation_id)가 보입니다. 문의할 때 그 ID를 함께 알려 주세요.
- 결과가 0건이면 작업 공간 화면에 「Remove <조건> · N results」 추천 버튼이 보입니다. 누르면 그 조건만 지우고 다시 검색합니다.
- 구간 조회(merge sequence 범위)에서 kind: 조건을 쓰면 오류 대신 「구간 조회에서 지원하지 않는 조건」 안내가 나옵니다.
- Files & folders의 검색이 열지 않은 폴더 안의 파일까지 찾습니다(같은 이름의 파일도 경로마다 따로 보입니다).
- Diff·Time-lapse에서 큰 파일, 큰 디렉터리, 3,000개가 넘는 변경, 오래된 이력을 끝까지 볼 수 있습니다(나눠 읽기, 「Load older revisions」).
- 업그레이드하는 동안 잠시 접속되지 않습니다.
```

---

## 3단계: 번들을 받아 대조한다

github.com에 닿는 곳에서 받습니다.

```bash
mkdir -p /opt/pr-search/import && cd /opt/pr-search/import
curl -fL -o pr-search-0.1.0-pilot.21-offline.tar.gz \
  https://github.com/89sooner/pr-search/releases/download/0.1.0-pilot.21/pr-search-0.1.0-pilot.21-offline.tar.gz
# gh로 받으려면 인증이 필요하다:
#   GH_TOKEN=<읽기 토큰> gh release download 0.1.0-pilot.21 -R 89sooner/pr-search -p '*.tar.gz'

curl -fsS https://api.github.com/repos/89sooner/pr-search/releases/tags/0.1.0-pilot.21 | grep '"digest"'
ls -l pr-search-0.1.0-pilot.21-offline.tar.gz
sha256sum pr-search-0.1.0-pilot.21-offline.tar.gz
```

아래 세 값이 모두 맞아야 합니다. 하나라도 다르면 그 파일을 쓰지 않습니다.

| 무엇 | 기대값 |
| --- | --- |
| 크기 | `1169436369` 바이트 |
| `sha256sum` | `a4fffeacfab5321a080530483caecc7158d9afe4f9cba398e81280d0e2877e78` |
| API의 `digest` | `sha256:a4fffeacfab5321a080530483caecc7158d9afe4f9cba398e81280d0e2877e78` |

RUNBOOK은 SHA-256을 릴리스와 별개의 채널로 받으라고 합니다. 위 값은 발행 직후 원장에 기록한 값과 같지만, 이 문서도 릴리스와 같은 저장소에 있으므로 반입 요청서처럼 저장소 밖의 경로로 전달받은 값과도 대조합니다. 자산 주소가 `release-assets.githubusercontent.com`으로 리디렉션되므로 프록시 환경이면 그 호스트도 열려 있어야 합니다.

풀고 검증합니다.

```bash
tar -xzf pr-search-0.1.0-pilot.21-offline.tar.gz
cd "$NEW"
./prsctl verify      # 10개 파일이 모두 일치해야 한다. 실패하면 이 번들을 쓰지 않는다
./prsctl lineage | grep -E '"commit"|release_version|migration_level'
# 기대: commit 4b73b703b2469f1eb24466845200dd4f41053e0c · release_version 0.1.0-pilot.21 · migration_level 037
```

---

## 3-1단계: (사내에서 다시 빌드하는 경우만) 소스 계보를 잇고 번들을 만든다

사내 Git의 `company/main`에 코드 수정이나 사내 전용 Dockerfile 설정이 있을 때만 이 단계를 합니다. 사내 수정이 `.env`와 `compose.yml`뿐이면 공식 번들을 그대로 쓰고 이 단계를 건너뜁니다. 발행 전 리허설은 공식 번들의 이미지로만 했습니다.

```bash
cd <사내 pr-search Git 저장소>
git checkout vendor/upstream
git fetch /opt/pr-search/import/pr-search-0.1.0-pilot.21-offline/source/pr-search-0.1.0-pilot.21.bundle HEAD
git merge --ff-only FETCH_HEAD
git rev-parse HEAD          # 4b73b703b2469f1eb24466845200dd4f41053e0c 이어야 한다
git checkout company/main
git merge vendor/upstream   # 충돌은 여기서 푼다. rebase하지 않는다(RUNBOOK 5장)
git status                  # 미추적 파일까지 깨끗해야 번들 스크립트가 받아들인다
./deploy/single-host/build-bundle.sh <사내 버전>    # 예: 0.1.0-pilot.21-c1. --release는 주지 않는다
```

pilot.20의 커밋 `73be84f`는 `4b73b70`의 조상이므로 `--ff-only`가 성립합니다. 그 뒤의 절차는 공식 번들과 같고, `PRS_VERSION`에는 `<사내 버전>`을 씁니다.

---

## 4단계: 도는 잡을 확인하고 백업한다 (7.J 0번)

```bash
cd "$OLD"
prsdc exec -T postgres psql -U prs -d prs -c "SELECT job_id, type, target, state FROM job WHERE state IN ('queued','running','paused')"
# 기대: (0 rows). 행이 있으면 끝날 때까지 기다린다. 컨테이너 교체가 그 잡을 끊는다
./prsctl backup
# 기대: backups/prs-<날짜-시각>.dump 와 같은 이름의 .sha256
```

백업 파일의 경로를 적어 둡니다.

---

## 5단계: 업그레이드하고 GHE 주소 전달을 확인한다 (3장 · 7.K 1~3번)

### 5-1. `.env`를 가져오고 이미지를 적재한다

```bash
cd "$NEW"
cp "$OLD/.env" .env
chmod 600 .env
sed -i 's/^PRS_VERSION=.*/PRS_VERSION=0.1.0-pilot.21/' .env    # 사내 빌드면 <사내 버전>
grep '^PRS_VERSION=' .env
./prsctl verify && ./prsctl load
```

- pilot.21의 `.env.example`에는 선택 키 둘(`SOURCE_BLAME_ENABLED`·`GHE_GRAPHQL_URL`)이 더해졌습니다. 옛 `.env`에 없으면 기본값(blame 꺼짐, GraphQL 주소는 `GHE_API_URL`에서 도출)이 쓰이므로 **이번 업그레이드에서는 더하지 않습니다.** `PRS_VERSION`만 바꿉니다.
- `PRS_VERSION`은 `load`보다 먼저 바꿉니다. `load`는 적재한 뒤 이 값의 이미지가 있는지 검사합니다.

### 5-2. 사내 수정을 새 `compose.yml`에 다시 얹는다

`load`가 끝난 뒤에만 고칩니다. pilot.21의 `compose.yml`은 pilot.20과 비교해 search-api의 두 줄만 다릅니다. 사내 수정을 얹은 뒤에도 이 두 줄이 남아 있어야 합니다.

```yaml
  search-api:
    environment:
      SOURCE_BLAME_ENABLED: ${SOURCE_BLAME_ENABLED:-false}   # CR-135에서 더해졌다
      GHE_GRAPHQL_URL: ${GHE_GRAPHQL_URL:-}                  # CR-135에서 더해졌다
```

```bash
# 1) 사내 수정만 뽑는다: pilot.20 원본과 지금 쓰는 파일의 차이
tar -xzf /opt/pr-search/import/pr-search-0.1.0-pilot.20-offline.tar.gz -O \
  pr-search-0.1.0-pilot.20-offline/deploy/single-host/compose.yml > /tmp/compose.pilot20.orig.yml
#    옛 아카이브가 없으면 사내 Git에서 꺼낸다:
#    git -C <사내 Git> show 73be84ffd45d753873c6973edadbb1fe0472de45:deploy/single-host/compose.yml > /tmp/compose.pilot20.orig.yml
diff -u /tmp/compose.pilot20.orig.yml "$OLD/compose.yml" > /tmp/company-compose.patch
cat /tmp/company-compose.patch     # 사내 수정(CA 마운트 등)만 보여야 한다

# 2) 새 파일에 얹고, 사내 수정만 더해졌는지 본다
cp compose.yml compose.yml.upstream
patch compose.yml < /tmp/company-compose.patch
diff -u compose.yml.upstream compose.yml
```

`patch`가 거부한 조각(`.rej`)이 생기면 그 부분만 손으로 옮깁니다. 이 뒤로는 `./prsctl verify`를 다시 돌리지 않습니다. 고친 `compose.yml`이 번들의 checksum과 달라 실패하는 것이 정상입니다.

### 5-3. 넘어가는 값을 본다 (7.K 1·2번, `upgrade` 전)

```bash
grep '^GHE_BASE_URL=' .env
prsdc config | awk '/^  [a-z][a-z0-9-]*:$/ { s = $1 }
  /^ +GHE_BASE_URL:/ && (s == "worker-link:" || s == "worker-batch:") { print s, $1, $2 }
  /^ +SOURCE_BLAME_ENABLED:/ && s == "search-api:" { print s, $1, $2 }'
# 기대: 세 줄
#   worker-batch: GHE_BASE_URL: <사내 GHE 주소>
#   worker-link: GHE_BASE_URL: <사내 GHE 주소>
#   search-api: SOURCE_BLAME_ENABLED: "false"
```

`prsdc config`의 원문은 출력하지 않습니다.

### 5-4. 업그레이드한다

```bash
./prsctl upgrade       # 마이그레이션 → 접속 주체 → ES 매핑 → 컨테이너 교체 → health
docker ps --filter label=com.docker.compose.project=pr-search --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | sort
# 기대: prs/* 이미지가 모두 :0.1.0-pilot.21(사내 빌드면 <사내 버전>)이고 Up(healthy)
prsdc exec -T postgres psql -U prs -d prs -tAc "SELECT max(version) FROM schema_migration"    # 기대: 037(바뀌지 않는다)
./prsctl health
./prsctl smoke         # 읽기 전용 조회 확인
```

### 5-5. 컨테이너 안의 값과 기동 로그를 본다 (7.K 3번, `upgrade` 뒤)

```bash
for s in worker-link worker-batch; do printf '%s ' "$s"; prsdc exec -T "$s" printenv GHE_BASE_URL; done
prsdc logs worker-link worker-batch | grep 'URL 참조'
# 기대: 역할마다 "message":"URL 참조 승인 호스트","reference_host":"<사내 GHE 호스트>" 한 줄
prsdc exec -T search-api printenv SOURCE_BLAME_ENABLED    # 기대: false
```

값을 고쳤으면 `restart`가 아니라 `./prsctl upgrade`로 컨테이너를 다시 만듭니다. `restart`는 `.env`를 다시 읽지 않습니다.

### 5-6. GitHub 작업을 켠 배포만: 운영 승인을 다시 한다 (7.C 4단계)

`.env`에 `GH_OPERATIONS_ENABLED=true`를 두었다면 A-006(「운영 › gh 레지스트리」)의 운영 승인 상태를 봅니다. 상태가 「승인된 정의가 현재 정의와 다름 — 재승인 필요」이면 `operator`로 다시 승인합니다. 기본 형상(꺼짐)이면 건너뜁니다.

---

## 6단계: 화면으로 확인한다

- 평소 쓰던 검색 몇 개가 전과 같은 결과를 내는지 봅니다.
- 작업 공간에서 결과가 0건인 조건(예: 없는 작성자)을 넣어 「Remove <조건> · N results」 추천이 보이는지, 누르면 그 조건만 지워지는지 봅니다(CR-131).
- Files & folders에 열지 않은 폴더 안의 파일 이름을 넣어 찾히는지, 누르면 History·Diff·Time-lapse로 이어지는지 봅니다(CR-133).
- 큰 파일이나 3,000개가 넘는 변경의 Diff, 오래된 이력의 Time-lapse가 끝까지 열리는지 봅니다(CR-132).
- 운영 로그에 새 오류가 쌓이지 않는지 봅니다. 실패한 응답에는 `correlation_id`가 있고, 서버 로그에서 같은 ID로 원인을 찾을 수 있습니다(CR-129).

---

## 7단계: (선택) blame을 켠다 (RUNBOOK 7.L)

PIPE가 쓸 blame(CR-135)은 기본 꺼짐입니다. **사내 GHES에서 확인하지 않았으므로** 켜기 전에 RUNBOOK 7.L을 끝까지 읽습니다.

1. 사내 GHES가 GraphQL `Commit.blame`을 주는지, 조회용 GHE App(`GHE_APP_*`)에 Contents 읽기 권한이 있는지 확인합니다.
2. `$NEW/.env`에 `SOURCE_BLAME_ENABLED=true`를 넣습니다. `GHE_GRAPHQL_URL`은 보통 비워 둡니다(비우면 `…/api/v3`를 `…/api/graphql`로 바꾼 주소를 씁니다).
3. `./prsctl upgrade`로 컨테이너를 다시 만듭니다.
4. 로그인한 브라우저에서 `<서비스 주소>/api/source/<owner>%2F<name>/blame?path=<파일 경로>&revision=<40자 커밋 SHA>`를 열어 결과로 가릅니다: 200이면 동작, 501 `SOURCE_BLAME_UNSUPPORTED`면 사내 GHES가 blame을 주지 않음, 503 `SOURCE_PERMISSION_REQUIRED`면 권한 부족, 429면 한도, 502면 일시 장애입니다.
5. 되돌릴 때는 `SOURCE_BLAME_ENABLED=false`로 두고 `./prsctl upgrade`를 다시 합니다. 꺼지면 두 경로가 404(`feature_disabled`)이고 PIPE에 능력이 알려지지 않습니다.

---

## 롤백

업그레이드 뒤 서비스가 서지 않는 등 되돌려야 할 때만 합니다. **이 롤백 경로는 리허설하지 않았습니다(NOT RUN).** 아래는 RUNBOOK 3장의 일반 절차에 근거합니다.

```bash
cd "$OLD"                  # 옛 .env의 PRS_VERSION은 옛 판 그대로다
grep '^PRS_VERSION=' .env
./prsctl upgrade
```

- 두 판의 마이그레이션 수준이 같으므로(037) 스키마는 그대로입니다. 옛 이미지가 로컬에 남아 있어야 합니다.
- 7단계에서 blame을 켰다면 되돌린 판에는 그 기능이 없습니다(PIPE가 능력을 보고 부르므로 부르지 않습니다).
- `./prsctl restore <백업 파일>`은 정본을 백업 시점으로 되돌리고 모든 색인을 다시 만드는 마지막 수단입니다(4장). 백업 뒤에 들어온 자료가 정본에서 사라집니다.

---

## 기록해 두고 보고할 것

- 1단계 결과: 판, 이미지 태그, 마이그레이션 수준
- 4단계: 백업 파일의 경로와 SHA-256
- 5단계: `upgrade`·`health`·`smoke`의 출력, 7.K 확인 세 줄
- 6단계: 확인한 화면과 달라 보인 것
- 7단계를 했다면: blame 확인 결과(상태 코드)

문제가 생기면 지금처럼 `agent-context/upstream-feedback.md`에 적어 주면 상류에서 고칩니다.
