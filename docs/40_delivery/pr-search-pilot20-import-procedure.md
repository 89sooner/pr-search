# PR Search 사내 반입 절차서: 0.1.0-pilot.20으로 올리기

> 작성 2026-09-28 · 대상 판 `0.1.0-pilot.20`(태그 → `73be84f`) · 정본은 번들 안의 `deploy/single-host/RUNBOOK.md`
>
> 이 문서는 RUNBOOK의 3장·7.G~7.K·8장을 사내에서 실행할 순서대로 이어 붙인 안내서입니다. 명령이나 판단 기준이 RUNBOOK과 다르면 RUNBOOK을 따릅니다. 사내 GHE 주소처럼 사내에만 있는 값은 `<…>`로 비워 두었습니다.

---

## 요약

기록으로 보면 사내는 지금 `0.1.0-pilot.18`을 운영하고 있습니다. 사내 피드백(`agent-context/upstream-feedback.md`)에 「0.1.0-pilot.18 사내 운영(2026-09-23)」 보고가 세 건 있고, pilot.19를 반입한 기록은 없습니다. 1단계에서 이 판단을 먼저 확인합니다.

pilot.18에서 올라온다면 pilot.19를 거치지 않고 바로 pilot.20으로 올립니다. 발행 전 격리 리허설이 바로 이 경로(pilot.18 상태 → pilot.20 후보 번들)였습니다. 업그레이드 뒤에 정리할 일은 네 가지이며, 순서가 결과를 바꾸므로 순서를 지킵니다.

1. 스택 간선 가져오기(`prsctl links import-stacks`)
2. prs-commits 재색인
3. prs-links 재색인
4. PR 연결 확인(`prsctl links plan → apply → status`)

| 단계 | 할 일 | RUNBOOK | 비고 |
| --- | --- | --- | --- |
| 1 | 지금 판을 확인하고 상태를 기록한다 | - | 약 5분 |
| 2 | 사용자에게 먼저 알린다 | 8장 첫 세 행 | 업그레이드 전에 |
| 3 | 번들을 받아 SHA-256을 대조한다 | 2.B 1단계 | 약 1.1GB |
| 3-1 | (사내 빌드만) 소스 계보를 잇고 번들을 만든다 | 2.D·5장·2.A | 선택 |
| 4 | 도는 잡과 별칭을 확인하고 백업한다 | 7.J 0번 | |
| 5 | 업그레이드하고 GHE 주소 전달을 확인한다 | 3장·7.K 1~3번 | 컨테이너를 교체하는 동안 잠시 멈춘다 |
| 6 | 스택 간선을 정본으로 옮긴다 | 7.J 2번(= 7.I 3번) | 5단계 바로 다음 |
| 7 | prs-commits를 재색인한다 | 7.J 3번(= 7.H 5번) | 사내 규모의 소요 시간은 아직 재지 않았다 |
| 8 | prs-links를 재색인한다 | 7.J 4번(= 7.I 4번) | 7단계가 `completed`된 뒤 |
| 9 | PR 연결을 확인한다 | 7.J 5번(= 7.G) | 저장소마다 한 번 |
| 10 | 화면으로 확인한다 | 7.J 6번 | |
| 11 | 옛 인덱스를 정리한다 | 7.H 7번·7.I 6번 | 선택, 확인이 끝난 뒤 |

### 하지 않는 것

- 옛 `compose.yml`을 복사해 새 파일을 덮지 않습니다. 새 판이 더한 줄(`worker-link`·`worker-batch`의 `GHE_BASE_URL`)이 사라집니다.
- `prsctl load`가 끝나기 전에 `compose.yml`을 고치지 않습니다. `load`가 checksum을 다시 검사해 거부합니다.
- 6~9단계의 순서를 바꾸지 않습니다.
- 실패한 재색인 잡을 `completed`로 바꾸거나 별칭을 손으로 옮기지 않습니다. 서비스 인덱스를 직접 고치지 않습니다.
- `docker compose … down -v`를 쓰지 않습니다. 볼륨과 함께 정본이 사라집니다.
- 옛 판의 번들 디렉터리와 이미지를 지우지 않습니다. 롤백에 필요합니다.

### 이 순서를 어디까지 검증했나

- 격리 환경에서 두 번 끝까지 돌렸습니다. 한 번은 pilot.19를 준비할 때 사내 보고와 같은 상태(두 재색인 실패, prs-commits 수동 전환)에서 돌렸고(원장 6.113장), 다른 한 번은 pilot.20 발행 전에 pilot.18 상태 스냅숏에서 후보 번들 `0.1.0-pilot.20-rc1`로 돌렸습니다(원장 머리 절 「0.1.0-pilot.20 발행」). 발행본의 앱 이미지 7종은 그 후보와 ID가 같습니다.
- 사내에서는 돌리지 않았습니다. 사내 규모의 재색인 시간과 실제 GHE·인증서·프록시에서의 동작은 확인하지 않았습니다(NOT RUN).

---

## 표기 약속

모든 명령은 서비스 호스트의 bash에서 실행합니다. 새 셸을 열 때마다 아래 세 줄을 먼저 붙여 넣습니다.

```bash
# 지금 돌고 있는 판의 설치와 새 번들의 deploy/single-host 절대 경로. 사내 경로로 바꾼다
OLD=/opt/pr-search/import/pr-search-0.1.0-pilot.18-offline/deploy/single-host
NEW=/opt/pr-search/import/pr-search-0.1.0-pilot.20-offline/deploy/single-host
# prsctl 안의 compose 호출과 같은 형태다. 현재 디렉터리의 .env와 compose.yml을 쓴다
prsdc() { docker compose --project-name pr-search --env-file .env -f compose.yml "$@"; }
```

- `prsdc`는 현재 디렉터리를 기준으로 동작합니다. 5단계에서 업그레이드하기 전에는 `cd "$OLD"`에서, 업그레이드한 뒤에는 `cd "$NEW"`에서 부릅니다.
- `PRS_PROJECT`로 프로젝트 이름을 바꿔 쓰고 있다면 `pr-search`를 그 값으로 바꿉니다.
- `psql -U prs -d prs`는 RUNBOOK의 표기입니다. `.env`의 `POSTGRES_OWNER_USER`·`POSTGRES_DB`가 다르면 그 값으로 바꿉니다. 값을 얻으려고 `.env`를 `source`로 읽지 않습니다. 개인 키 같은 값이 셸에서 다르게 해석될 수 있습니다.
- 작업 전체를 기록해 두면 마지막 절에서 보고할 자료가 한 번에 모입니다. 먼저 `script -a ~/prs-upgrade-$(date +%Y%m%d).log`를 실행하고, 그것이 연 새 셸 안에서 위 세 줄을 붙여 넣습니다. 기록 중에는 `.env`나 `prsdc config`의 원문을 화면에 출력하지 않습니다. 비밀번호와 개인 키가 기록에 남습니다.

---

## 1단계: 지금 판을 확인하고 상태를 기록한다

`./prsctl lineage`는 그 번들의 manifest를 출력할 뿐 실행 중인 컨테이너를 보지 않으므로 판별에 쓰지 않습니다. 컨테이너의 이미지 태그와 DB의 마이그레이션 수준을 봅니다.

```bash
cd "$OLD"
grep '^PRS_VERSION=' .env
docker ps --filter label=com.docker.compose.project=pr-search --format '{{.Names}}\t{{.Image}}' | sort
prsdc exec -T postgres psql -U prs -d prs -tAc "SELECT max(version) FROM schema_migration"
```

| `max(version)` | 이미지 태그 | 지금 판 | 따라갈 곳 |
| --- | --- | --- | --- |
| `036` | `0.1.0-pilot.18` | pilot.18 | 이 문서의 2~11단계 |
| `037` | `0.1.0-pilot.19` | pilot.19 | 부록 A |
| `037` | `0.1.0-pilot.20` | 이미 올라갔다 | 부록 A의 확인으로 남은 단계를 가린다 |
| `032`~`035` | `0.1.0-pilot.16` 또는 사내 표기(예: `0.1.0-pilot.17`) | pilot.16이나 사내 빌드 | 부록 B(리허설 없음) |

이미지 태그가 사내 표기인데 `036`이면 본문을 따르고, 그 빌드의 소스 커밋(사내 Git의 `vendor/upstream`)을 기록해 둡니다.

이어서 정리하기 전의 상태를 기록합니다. 11단계에서 지울 인덱스를 가리는 근거가 됩니다.

```bash
prsdc exec -T elasticsearch curl -fsS 'http://localhost:9200/_cat/aliases/prs-*?v&h=alias,index'
prsdc exec -T elasticsearch curl -fsS 'http://localhost:9200/_cat/indices/prs-*?v&h=index,docs.count,creation.date.string&s=index'
prsdc exec -T postgres psql -U prs -d prs -c "SELECT job_id, target, state, finished_at, left(error, 200) AS error FROM job WHERE type = 'reindex' ORDER BY job_id DESC LIMIT 6"
```

사내 보고대로라면 `prs-commits` 별칭은 손으로 전환한 인덱스를, `prs-links` 별칭은 v1을 가리키고, 잡 기록에는 두 재색인의 `failed`가 남아 있습니다.

---

## 2단계: 사용자에게 먼저 알린다

pilot.20부터 화면의 시각이 한국 시간으로 바뀝니다(CR-127). 값은 그대로인데 전보다 9시간 늦게 보이므로 업그레이드하기 전에 알립니다. 아래 문안을 그대로 써도 됩니다.

```text
[PR Search 업그레이드 안내: <날짜> <시각>]
- 업그레이드 뒤 화면의 모든 시각이 한국 시간(… KST)으로 표시됩니다. 전보다 9시간 늦게 보이지만 저장된 값은 같습니다.
  시각에 마우스를 올리면 원본 UTC가 보입니다. API와 CSV·JSON 내보내기의 시각은 여전히 UTC입니다.
- 날짜 필터는 한국 날짜 기준으로 바뀝니다. 9월 27일을 고르면 한국 시간 9월 27일 00:00부터 9월 28일 00:00 전까지를 찾습니다.
- 업그레이드 전에 만든 공유 URL과 저장된 검색의 날짜 조건은 전처럼 UTC 하루로 실행되며, 칩에 UTC가 붙습니다.
  한국 날짜로 찾으려면 날짜를 다시 골라 저장해 주세요.
- 통계 대시보드의 기본 기간과 첫날·마지막 날의 수가 달라질 수 있습니다.
- 업그레이드 전에 열어 둔 운영 화면(등록 검토 요청·감사 로그)은 새로 고쳐 주세요.
- 업그레이드 뒤 재색인이 끝날 때까지 커밋의 연결 PR과 관계 화면은 이전 값을 보여 줄 수 있습니다.
```

---

## 3단계: 번들을 받아 대조한다

github.com에 닿는 곳에서 받습니다. 저장소가 공개로 바뀌어 지금은 토큰 없이 받을 수 있습니다(2026-09-28 확인). RUNBOOK 2.B는 비공개 저장소를 전제로 읽기 토큰을 쓰는데, 토큰을 쓰는 방식도 그대로 동작합니다.

```bash
mkdir -p /opt/pr-search/import && cd /opt/pr-search/import
curl -fL -o pr-search-0.1.0-pilot.20-offline.tar.gz \
  https://github.com/89sooner/pr-search/releases/download/0.1.0-pilot.20/pr-search-0.1.0-pilot.20-offline.tar.gz
# gh로 받으려면 인증이 필요하다:
#   GH_TOKEN=<읽기 토큰> gh release download 0.1.0-pilot.20 -R 89sooner/pr-search -p '*.tar.gz'

curl -fsS https://api.github.com/repos/89sooner/pr-search/releases/tags/0.1.0-pilot.20 | grep '"digest"'
ls -l pr-search-0.1.0-pilot.20-offline.tar.gz
sha256sum pr-search-0.1.0-pilot.20-offline.tar.gz
```

아래 세 값이 모두 맞아야 합니다. 하나라도 다르면 그 파일을 쓰지 않습니다.

| 무엇 | 기대값 |
| --- | --- |
| 크기 | `1167710031` 바이트 |
| `sha256sum` | `6fdc2e783f8b6beafe8e433ae678fd4df2b4fd527ed7b988835ebd8d9829789c` |
| API의 `digest` | `sha256:6fdc2e783f8b6beafe8e433ae678fd4df2b4fd527ed7b988835ebd8d9829789c` |

RUNBOOK은 SHA-256을 릴리스와 별개의 채널로 받으라고 합니다. 위 값은 발행 직후 원장에 기록한 값이므로 이 문서를 그 채널로 씁니다. 프록시 환경이면 `curl`과 `gh`가 `HTTPS_PROXY`를 읽습니다. 자산 주소가 `release-assets.githubusercontent.com`으로 리디렉션되므로 그 호스트도 열려 있어야 합니다.

풀고 검증합니다.

```bash
tar -xzf pr-search-0.1.0-pilot.20-offline.tar.gz
cd "$NEW"
./prsctl verify      # 10개 파일이 모두 일치해야 한다. 실패하면 이 번들을 쓰지 않는다
./prsctl lineage | grep -E '"commit"|release_version|migration_level'
# 기대: commit 73be84ffd45d753873c6973edadbb1fe0472de45 · release_version 0.1.0-pilot.20 · migration_level 037
```

---

## 3-1단계: (사내에서 다시 빌드하는 경우만) 소스 계보를 잇고 번들을 만든다

사내 Git의 `company/main`에 코드 수정(RUNBOOK 5장의 C등급)이나 사내 전용 Dockerfile 설정이 있을 때만 이 단계를 합니다. 사내 수정이 `.env`와 `compose.yml`(A등급)뿐이면 공식 번들을 그대로 쓰고 이 단계를 건너뜁니다. 발행 전 리허설은 공식 번들의 이미지로만 했다는 점도 판단에 넣습니다.

```bash
cd <사내 pr-search Git 저장소>
git checkout vendor/upstream
git fetch /opt/pr-search/import/pr-search-0.1.0-pilot.20-offline/source/pr-search-0.1.0-pilot.20.bundle HEAD
git merge --ff-only FETCH_HEAD
git rev-parse HEAD          # 73be84ffd45d753873c6973edadbb1fe0472de45 이어야 한다
git checkout company/main
git merge vendor/upstream   # 충돌은 여기서 푼다. rebase하지 않는다(RUNBOOK 5장)
git status                  # 미추적 파일까지 깨끗해야 번들 스크립트가 받아들인다
./deploy/single-host/build-bundle.sh <사내 버전>    # 예: 0.1.0-pilot.20-c1. --release는 주지 않는다
```

- pilot.16·18·19의 커밋은 모두 `73be84f`의 조상이므로 `--ff-only`가 성립합니다. 성립하지 않으면 멈추고 `vendor/upstream`이 무엇을 가리키는지 봅니다. 그 브랜치에는 사내 수정을 넣지 않습니다.
- 빌드 컨테이너는 npm·Alpine 저장소나 사내 미러에 닿아야 합니다. RUNBOOK 2.A 「Docker 컨테이너 외부 네트워크 차단 환경에서의 빌드 (CR-094)」를 따릅니다.
- 산출물은 `deploy/single-host/bundle/pr-search-<사내 버전>-offline/`와 같은 이름의 `.tar.gz`입니다. 4단계부터는 그 번들의 `deploy/single-host`를 `NEW`로 두고, `PRS_VERSION`에는 `<사내 버전>`을 씁니다. 그 뒤의 절차는 공식 번들과 같습니다.

---

## 4단계: 도는 잡과 별칭을 확인하고 백업한다 (7.J 0번)

```bash
cd "$OLD"
prsdc exec -T postgres psql -U prs -d prs -c "SELECT job_id, type, target, state FROM job WHERE state IN ('queued','running','paused')"
# 기대: (0 rows). 행이 있으면 끝날 때까지 기다린다. 컨테이너 교체가 그 잡을 끊는다
prsdc exec -T elasticsearch curl -fsS 'http://localhost:9200/_cat/aliases/prs-*?v&h=alias,index'
# 기대: 별칭마다 인덱스가 한 줄
./prsctl backup
# 기대: backups/prs-<날짜-시각>.dump 와 같은 이름의 .sha256
```

백업 파일의 경로를 적어 둡니다. Elasticsearch는 PostgreSQL에서 다시 만들 수 있으므로 백업하지 않습니다.

---

## 5단계: 업그레이드하고 GHE 주소 전달을 확인한다 (3장 · 7.K 1~3번)

### 5-1. `.env`를 가져오고 이미지를 적재한다

```bash
cd "$NEW"
cp "$OLD/.env" .env
chmod 600 .env
sed -i 's/^PRS_VERSION=.*/PRS_VERSION=0.1.0-pilot.20/' .env    # 사내 빌드면 <사내 버전>
grep '^PRS_VERSION=' .env
./prsctl verify && ./prsctl load
```

- pilot.18과 pilot.20 사이에 `.env`에 새로 생긴 키는 없습니다(`.env.example` 비교). `PRS_VERSION`만 바꿉니다.
- `PRS_VERSION`은 `load`보다 먼저 바꿉니다. `load`는 적재한 뒤 이 값의 이미지가 있는지 검사하므로, 옛 값이 남아 있으면 옛 이미지를 보고 통과해 버립니다.

### 5-2. 사내 수정을 새 `compose.yml`에 다시 얹는다

`load`가 끝난 뒤에만 고칩니다. pilot.20의 `compose.yml`은 pilot.18과 비교해 주석을 빼면 아래 두 줄만 다릅니다. 사내 수정을 얹은 뒤에도 이 두 줄이 남아 있어야 합니다.

```yaml
  worker-link:
    environment:
      GHE_BASE_URL: ${GHE_BASE_URL:?}      # CR-124에서 더해졌다
  worker-batch:
    environment:
      GHE_BASE_URL: ${GHE_BASE_URL:?}      # CR-124에서 더해졌다
```

사내 수정만 패치로 뽑아 새 파일에 얹으면 옮기다 빠뜨리는 일을 줄일 수 있습니다.

```bash
# 1) 사내 수정만 뽑는다: pilot.18 원본과 지금 쓰는 파일의 차이
tar -xzf /opt/pr-search/import/pr-search-0.1.0-pilot.18-offline.tar.gz -O \
  pr-search-0.1.0-pilot.18-offline/deploy/single-host/compose.yml > /tmp/compose.pilot18.orig.yml
#    옛 아카이브가 없으면 사내 Git에서 꺼낸다:
#    git -C <사내 Git> show 6132dc914903412159261715956e21a7c352ff34:deploy/single-host/compose.yml > /tmp/compose.pilot18.orig.yml
diff -u /tmp/compose.pilot18.orig.yml "$OLD/compose.yml" > /tmp/company-compose.patch
cat /tmp/company-compose.patch     # 사내 수정(CA 마운트 등)만 보여야 한다

# 2) 새 파일에 얹고, 사내 수정만 더해졌는지 본다
cp compose.yml compose.yml.upstream
patch compose.yml < /tmp/company-compose.patch
diff -u compose.yml.upstream compose.yml
```

`patch`가 거부한 조각(`.rej`)이 생기면 그 부분만 손으로 옮깁니다. 이 뒤로는 `./prsctl verify`를 다시 돌리지 않습니다. 고친 `compose.yml`이 번들의 checksum과 달라 실패하는 것이 정상입니다.

### 5-3. 두 역할이 GHE 주소를 받는지 본다 (7.K 1·2번, `upgrade` 전)

```bash
grep '^GHE_BASE_URL=' .env
prsdc config | awk '/^  [a-z][a-z0-9-]*:$/ { s = ($1 == "worker-link:" || $1 == "worker-batch:") ? $1 : "" }
  s != "" && /^ +GHE_/ { if ($1 == "GHE_BASE_URL:") print s, $1, $2; else print s, $1, "(값 생략)" }'
# 기대: 두 줄
#   worker-batch: GHE_BASE_URL: <사내 GHE 주소>
#   worker-link: GHE_BASE_URL: <사내 GHE 주소>
```

줄이 없으면 사내 수정을 얹으면서 그 줄을 지운 것입니다. `GHE_APP_PRIVATE_KEY` 같은 다른 키가 보이면 두 역할에 `*ghe-env` 앵커를 넣은 것이므로 되돌립니다. `prsdc config`의 원문은 출력하지 않습니다.

### 5-4. 업그레이드한다

```bash
./prsctl upgrade       # 마이그레이션 → 접속 주체 → ES 매핑 → 컨테이너 교체 → health
docker ps --filter label=com.docker.compose.project=pr-search --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | sort
# 기대: prs/* 이미지가 모두 :0.1.0-pilot.20(사내 빌드면 <사내 버전>)이고 Up(healthy)
prsdc exec -T postgres psql -U prs -d prs -tAc "SELECT max(version) FROM schema_migration"    # 기대: 037
./prsctl health
./prsctl smoke         # 읽기 전용 조회 확인
```

- pilot.18에서 올라오면 마이그레이션 037 하나가 적용됩니다. 037은 스택 정본(`pull_request_stack`)과 재색인 미처리 표(`reindex_link_pending`)를 만듭니다.
- 모든 워커가 새 판이어야 6단계 이후가 의미가 있습니다. 옛 이미지로 뜬 워커가 남아 있으면 옛 규칙으로 PR 연결을 다시 씁니다.

### 5-5. 컨테이너 안의 값과 기동 로그를 본다 (7.K 3번, `upgrade` 뒤)

```bash
for s in worker-link worker-batch; do printf '%s ' "$s"; prsdc exec -T "$s" printenv GHE_BASE_URL; done
prsdc logs worker-link worker-batch | grep 'URL 참조'
# 기대: 역할마다 "message":"URL 참조 승인 호스트","reference_host":"<사내 GHE 호스트>" 한 줄
```

로그에 `GHE_BASE_URL이 없다 — URL 참조를 추출하지 않는다`가 보이면 5-3으로 돌아갑니다. 값을 고쳤으면 `restart`가 아니라 `./prsctl upgrade`로 컨테이너를 다시 만듭니다. `restart`는 `.env`를 다시 읽지 않습니다.

### 5-6. GitHub 작업을 켠 배포만: 운영 승인을 다시 한다 (7.C 4단계)

`.env`에 `GH_OPERATIONS_ENABLED=true`를 두었다면 A-006(「운영 › gh 레지스트리」)의 운영 승인 상태를 봅니다. 새 번들로 manifest가 바뀌면 이전 승인이 옮겨 오지 않으므로, 상태가 「승인된 정의가 현재 정의와 다름 — 재승인 필요」이면 `operator`로 다시 승인합니다. 기본 형상(꺼짐)이면 건너뜁니다.

---

## 6단계: 스택 간선을 정본으로 옮긴다 (7.J 2번 = 7.I 3번)

업그레이드 바로 다음에 합니다. pilot.18까지는 스택 간선(특히 이미 해제된 것)이 서비스 인덱스에만 있어서, 옮기지 않고 8단계를 돌리면 전환 전 검증이 막습니다. 이 명령은 서비스 인덱스를 바꾸지 않고 PostgreSQL에만 씁니다.

```bash
cd "$NEW"
mapfile -t REPOS < <(prsdc exec -T postgres psql -U prs -d prs -tAc "SELECT owner||'/'||name FROM repository ORDER BY 1")
echo "저장소 ${#REPOS[@]}개"; printf '  %s\n' "${REPOS[@]}"
# 보관(archived) 저장소까지 전부 나와야 한다. 운영 화면의 목록이 아니라 정본에서 읽는다

for repo in "${REPOS[@]}"; do echo "== $repo"; ./prsctl links import-stacks --repository "$repo" --dry-run; done
for repo in "${REPOS[@]}"; do echo "== $repo"; ./prsctl links import-stacks --repository "$repo" || break; done
```

- 출력은 읽은 서비스 `stacks_on` 간선 수, 넣은 행, 이미 있는 행, 형식 오류로 둔 간선 수입니다. 두 번 돌려도 결과가 같습니다.
- 저장소 목록은 `for` 루프로 돕니다. `prsctl links`는 `docker compose run`으로 컨테이너를 띄우는데, 이 명령은 표준 입력을 열 수 있어 `while read` 루프에 넣으면 남은 목록을 삼킬 수 있습니다.
- `형식 오류`가 0이 아니면 그 간선 때문에 8단계의 검증이 막힙니다. 그 간선 문서를 조회해 기록하고 보고합니다. 서비스 인덱스를 손으로 고치지 않습니다.
- 서비스 인덱스 조회가 일부만 읽히면(시간 초과·샤드 실패) 아무것도 옮기지 않고 실패로 끝납니다. 클러스터 상태를 확인하고 다시 돌립니다.
- 업그레이드와 이 단계 사이에 이벤트를 받은 PR은 링크 워커가 스스로 옮깁니다(CR-126). 옮긴 건수는 `prsdc logs worker-link | grep '전환기 보완'`으로 봅니다.

---

## 7단계: prs-commits를 재색인한다 (7.J 3번 = 7.H 5번)

이 재색인이 원본 커밋의 메시지·작성자, 재색인 실패부터 수동 전환 사이에 빠진 커밋, 커밋의 PR 연결과 체인 커밋의 역할, 커밋의 M 번호 투영을 정본에서 다시 세웁니다.

```bash
cd "$NEW"
prsdc --profile setup run --rm reindex node dist/reindex-cli.js --alias prs-commits
```

이 명령은 잡을 만들고 바로 끝나며, 실제 실행은 `worker-batch`가 합니다. 끝날 때까지 봅니다.

```bash
while :; do
  printf '%s  ' "$(date +%T)"
  prsdc exec -T postgres psql -U prs -d prs -tAc \
    "SELECT 'job '||job_id||'  '||target||'  '||state||'  '||coalesce(progress->>'phase','') FROM job WHERE type = 'reindex' ORDER BY job_id DESC LIMIT 1"
  sleep 60
done
# completed나 failed가 보이면 Ctrl-C로 멈춘다
```

끝나면 결과를 기록합니다.

```bash
prsdc exec -T postgres psql -U prs -d prs -c "SELECT job_id, target, state, finished_at, progress->>'source_index' AS source_index, progress->>'target_index' AS target_index, left(error, 500) AS error FROM job WHERE type = 'reindex' ORDER BY job_id DESC LIMIT 1"
prsdc exec -T elasticsearch curl -fsS 'http://localhost:9200/_cat/aliases/prs-commits?v&h=alias,index'
prsdc logs -t worker-batch | grep -E '정본 재구축 완료|전환 전 검증'
```

- `completed`면 별칭이 새 인덱스로 옮겨졌습니다. 로그 두 줄의 시각을 적어 둡니다. 사내 규모의 소요 시간은 아직 누구도 재지 않았습니다.
- `failed`면 별칭은 그대로입니다. 사유는 잡의 `error`에 있고 500자에서 잘립니다.
  - `커밋 문서 누락 N건`·`커밋 메타데이터 불일치 N건`: 모든 워커가 새 판인지(5-4의 `docker ps`)부터 확인하고, 사유를 기록해 보고합니다.
  - `대상 인덱스가 바뀌었다`: 도중에 대상 인덱스가 지워진 것입니다. 같은 명령을 다시 실행합니다.
- 재색인은 한 번에 하나만 돕니다. 이 잡이 끝나기 전에 8단계를 시작하면 거절됩니다.

---

## 8단계: prs-links를 재색인한다 (7.J 4번 = 7.I 4번)

7단계가 `completed`된 뒤에 합니다. 참조가 해결됐는지를 서비스 prs-commits에 대상이 색인돼 있는지로 판정하므로, 순서를 바꾸면 수동 전환 사이에 빠진 커밋을 가리키는 참조가 미해결로 굳습니다. 이 재색인이 과거 PR 본문의 사내 GHE URL 참조도 만듭니다(7.K 5번을 겸한다).

```bash
cd "$NEW"
prsdc --profile setup run --rm reindex node dist/reindex-cli.js --alias prs-links
```

7단계와 같은 루프로 끝날 때까지 보고, 결과를 기록합니다.

```bash
prsdc exec -T postgres psql -U prs -d prs -c "SELECT job_id, target, state, finished_at, progress->>'source_index' AS source_index, progress->>'target_index' AS target_index, left(error, 500) AS error FROM job WHERE type = 'reindex' ORDER BY job_id DESC LIMIT 1"
prsdc exec -T elasticsearch curl -fsS 'http://localhost:9200/_cat/aliases/prs-links?v&h=alias,index'
prsdc logs -t worker-batch | grep -E '정본 재구축 완료|간선 미처리 회수|전환 전 간선 검증|전환 직전에 간선 미처리'
```

- `간선 미처리 회수`의 `rederived`가 0이 아닌 것은 정상입니다. 사내 보고의 실패가 바로 이 경로였고, 이제는 회수한 뒤 다시 검증합니다.
- `failed`면 별칭은 그대로입니다. 사유별 조치는 아래와 같습니다.

| 잡 `error`의 사유 | 할 일 |
| --- | --- |
| `스택 정본에 없는 서비스 stacks_on 간선 N건` | 6단계를 빠뜨린 저장소가 있습니다. 6단계를 다시 돌리고 이 단계를 다시 실행합니다 |
| `회수되지 않은 간선 미처리`·`link_pending_at_cutover` | 검증 중에 새 부분 갱신이 들어왔습니다. 쓰기가 드문 시간에 다시 실행합니다 |
| `link_pending_unrecovered` | 사유의 표본(source 종류·ID·사유)을 기록하고 보고합니다 |
| `간선 누락`·`간선 불일치`·`정본에 없는 간선`·`소유 source가 없는 간선` | 한 번 다시 실행합니다. 되풀이되면 7단계가 `completed`였는지, 모든 워커가 새 판인지 확인하고 표본을 보고합니다 |
| `shadow_write_failed` | 클러스터 상태를 확인하고 다시 실행합니다 |

---

## 9단계: PR 연결을 확인한다 (7.J 5번 = 7.G)

7단계의 재구축이 PR 연결과 체인 커밋의 역할을 정본으로 다시 만들었으므로 `plan`은 보통 0건입니다. 그래도 `apply`는 확인과 기록(잡·감사)을 위해 저장소마다 한 번 돌립니다.

```bash
cd "$NEW"
for repo in "${REPOS[@]}"; do
  echo "== $repo plan";   ./prsctl links plan   --repository "$repo"
  echo "== $repo apply";  ./prsctl links apply  --repository "$repo"
  echo "== $repo status"; ./prsctl links status --repository "$repo"
done
```

- `REPOS`는 6단계에서 만든 배열입니다. 새 셸이라면 6단계의 `mapfile` 줄을 다시 실행합니다.
- `status`의 밀린 투영이 비고 `parked`가 늘지 않으면 끝난 것입니다.
- `apply`는 `--pr` 없이 돌립니다. `--pr`로 좁힌 실행은 체인 커밋의 역할 대조를 하지 않습니다.
- `plan`의 `근거 없어 보류`가 크면 `근거가 필요한 PR:` 줄의 번호로 근거를 먼저 모읍니다. 이 명령은 GHE를 PR마다 세 번 읽고 PostgreSQL을 갱신하므로 dry-run이 아닙니다.

  ```bash
  ./prsctl links refetch --repository <owner/name> --pr <번호> --pr <번호>
  ```

  그 뒤 `plan → apply → status`를 다시 돌립니다. `여전히 불완전`이나 `조회 실패`로 남은 PR의 연결은 지우지 않고 그대로 둡니다.

---

## 10단계: 화면으로 확인한다 (7.J 6번)

사내 보고에 나온 항목부터 봅니다.

- 커밋 `ebc781d`의 상세에서 「Linked PRs」에 그 커밋을 올린 PR(#1671) 하나만 남았는지 봅니다. PR #983 상세의 원본 커밋 목록 아래에 「이미 대상 브랜치에 있던 커밋 N개」 안내가 나오는지 봅니다(7.G).
- 원본 커밋을 SHA로 검색해 커밋 상세에 메시지·작성자·변경 경로가 보이는지 봅니다(7.H 6번). 표본 커밋은 아래 질의로 고릅니다.

  ```bash
  prsdc exec -T postgres psql -U prs -d prs -c "SELECT s.repository_id, s.commit_sha FROM commit_snapshot s WHERE NOT EXISTS (SELECT 1 FROM merge_sequence m WHERE m.repository_id = s.repository_id AND m.commit_sha = s.commit_sha) AND EXISTS (SELECT 1 FROM pull_request_snapshot p WHERE p.repository_id = s.repository_id AND p.document -> 'source_commit_shas' ? s.commit_sha) ORDER BY s.committed_at DESC LIMIT 5"
  ```

- 6단계 출력에 스택이 있던 저장소에서 하위 PR을 열어 관계 화면(W-002)에 스택과 해제 표시가 그대로 보이는지 봅니다. 참조가 있는 PR에서는 참조 간선과 해결 상태를 봅니다(7.I 5번).
- 사내 GHE 전체 URL을 본문에 적은 PR을 열어 관계 화면의 참조에 그 대상이 보이는지 봅니다(7.K 6번).
- M 번호: `kind:pull_request repo:"<owner/name>" base:"dev"`를 `merge_seq` 오름차순으로 보고, `mnum:A..B`·`seq:A..B` 범위가 서수 순서대로 나오는지 봅니다.
- KST 표시: 시각이 `YYYY-MM-DD HH:mm KST`로 보이고 툴팁이 원본 UTC인지, Merged date에서 하루를 고르면 URL에 `tz=Asia/Seoul`이 붙는지, 옛 저장된 검색의 칩에 `UTC`가 붙는지 봅니다.

**달라 보이는 것 하나.** rebase로 PR에서 빠진 옛 커밋은 7단계 뒤 검색 문서가 없습니다. 정본에는 남아 있습니다. 그 커밋을 전체 SHA로 가리키던 참조는 8단계 뒤 미해결로 보이지만, 과거 기록이 사라진 것은 아닙니다.

---

## 11단계: 옛 인덱스를 정리한다 (선택, 7.H 7번 · 7.I 6번)

10단계까지 확인이 끝난 뒤에 합니다. 디스크를 비우는 일이므로 미뤄도 됩니다.

- 7·8단계 잡의 원본 인덱스(손으로 전환했던 prs-commits 인덱스와 prs-links v1)는 7일 동안 보관된 뒤 정리 스윕이 스스로 지웁니다.
- 스스로 지워지지 않는 것은 둘입니다. 수동 전환 전에 서비스하던 prs-commits 인덱스와, pilot.18에서 실패한 prs-links 재색인의 대상 인덱스입니다. 별칭에 붙어 있지 않은 것을 확인한 뒤에만 손으로 지웁니다.

```bash
prsdc exec -T elasticsearch curl -fsS 'http://localhost:9200/_cat/aliases/prs-*?v&h=alias,index'
prsdc exec -T elasticsearch curl -fsS 'http://localhost:9200/_cat/indices/prs-*?v&h=index,docs.count,creation.date.string&s=index'
# 위 별칭 목록에 없는 인덱스를 1단계의 기록과 맞춰 본 뒤, 하나씩 이름 전체로 지운다(와일드카드 금지)
prsdc exec -T elasticsearch curl -fsS -X DELETE 'http://localhost:9200/<지울 인덱스 이름>'
```

옛 판의 번들 디렉터리와 이미지는 pilot.20이 안정될 때까지 둡니다. 롤백에 필요합니다.

---

## 롤백

업그레이드 뒤 서비스가 서지 않는 등 되돌려야 할 때만 합니다.

```bash
cd "$OLD"                  # 옛 .env의 PRS_VERSION은 옛 판 그대로다
grep '^PRS_VERSION=' .env
./prsctl upgrade
```

- 마이그레이션은 하위 호환이라 옛 코드가 037이 적용된 스키마 위에서 돕니다. 옛 이미지가 로컬에 남아 있어야 합니다.
- pilot.18 워커는 CR-117의 체인 규칙을 모릅니다. 되돌린 동안 들어온 이벤트는 `git merge dev`로 받아 온 PR 번호를 커밋에 다시 붙이고, 스택은 정본 없이 색인에만 씁니다. 다시 pilot.20으로 올릴 때는 6~9단계를 다시 밟습니다.
- 되돌리면 화면 시각도 UTC 표시로 돌아가므로 사용자에게 다시 알립니다.
- GitHub 작업을 켠 배포는 7.C 「롤백할 때」를 먼저 읽습니다.
- `./prsctl restore <백업 파일>`은 정본을 백업 시점으로 되돌리고 모든 색인을 다시 만드는 마지막 수단입니다(4장). 백업 뒤에 들어온 자료가 정본에서 사라집니다.

---

## 기록해 두고 보고할 것

- 1단계 결과: 판, 이미지 태그, 마이그레이션 수준, 별칭과 인덱스 목록, 재색인 잡 기록
- 4단계: 백업 파일의 경로와 SHA-256
- 6단계: 저장소마다 dry-run과 실행의 출력
- 7·8단계: 잡 번호·상태·`error`, 원본·대상 인덱스, 로그의 「정본 재구축 완료」와 「전환 전 검증」 시각. 사내 규모의 재색인 시간은 아직 잰 적이 없으므로 이 값이 다음 판단의 근거가 됩니다.
- 9단계: 저장소마다 `plan`·`apply`·`status`의 출력
- 업그레이드 직후 운영자 화면의 조회가 사유 없이 503이면 시각·사용자·요청 경로를 적습니다. 격리 검증에서 같은 모양을 두 번 봤는데, 한 번은 28초 뒤에, 한 번은 로그인 약 5분 뒤에 200이 됐습니다. 원인은 아직 모릅니다(DEV-779).

문제가 생기면 지금처럼 `agent-context/upstream-feedback.md`에 적어 주면 상류에서 고칩니다.

---

## 부록 A. pilot.19(또는 이미 pilot.20)에서 올라올 때

두 판 사이에는 마이그레이션도 `.env`의 새 키도 없습니다. 2~5단계는 본문과 같고 `OLD`만 pilot.19 설치로 바꿉니다. 5-2의 패치는 pilot.19 원본과 비교해 뽑습니다(`git show 85af93afeb7ecaee0201c03dcd3079a2c36322f3:deploy/single-host/compose.yml`). 이미 pilot.20이면 2~5단계를 건너뜁니다.

pilot.19에서 7.J를 이미 끝냈는지에 따라 남은 단계가 갈립니다.

```bash
# 037이 적용된 시각(= pilot.19로 올린 시각)과, 그 뒤의 재색인·연결 복구 잡
prsdc exec -T postgres psql -U prs -d prs -c "SELECT version, applied_at FROM schema_migration WHERE version = '037'"
prsdc exec -T postgres psql -U prs -d prs -c "SELECT job_id, type, target, state, finished_at FROM job WHERE type IN ('reindex','pr_link_repair') ORDER BY job_id DESC LIMIT 12"
```

- 037 적용 뒤에 저장소마다의 `pr_link_repair` 잡(가져오기·`apply`)과 prs-commits·prs-links 재색인이 모두 `completed`로 있으면 7.J를 끝낸 것입니다. 이때는 6·7·9단계를 건너뛰고 8단계(prs-links 재색인)만 pilot.20에서 한 번 돌립니다. 과거 자료의 사내 GHE URL 참조가 이 재색인으로 생깁니다(7.K 5번). 10단계에서는 URL 참조와 KST 표시를 봅니다.
- 이미 pilot.20이라면, 마지막으로 `completed`된 prs-links 재색인이 pilot.20으로 올린 뒤의 것인지 봅니다. 그 잡의 `finished_at`이 아래 컨테이너 생성 시각보다 뒤면 8단계도 끝난 것이므로 10·11단계만 남습니다.

  ```bash
  docker inspect -f '{{.Created}}' $(docker ps -q --filter label=com.docker.compose.project=pr-search --filter label=com.docker.compose.service=worker-batch)
  ```

- 7.J를 끝내지 않았으면 6~11단계를 본문 그대로 밟습니다.

---

## 부록 B. pilot.16이나 사내 pilot.17에서 올라올 때 (리허설 없음)

**이 경로는 격리 리허설을 하지 않았습니다.** RUNBOOK에도 이 경로의 순서가 한곳에 모여 있지 않아서, 아래는 각 절을 이어 붙인 것입니다. 실행하기 전에 상류에 알려 주면 같은 상태를 격리 환경에서 먼저 돌려 보겠습니다.

본문과 다른 점만 적습니다.

- 5단계의 `upgrade`가 마이그레이션 다섯 개를 적용합니다. 033(PIPE 연동), 034(머지 시퀀스 투영), 035(M 번호 태그), 036(커밋 PR 연결 정본), 037(스택 정본)입니다. 036은 기존 PR 스냅숏으로 연결 정본을 채우되 관측을 모두 `unverified`로 둡니다.
- `.env`에는 `MNUMBER_TAG_*`·`GHE_TAG_*` 키 열 개가 새로 생겼습니다. 태그 기능(`MNUMBER_TAG_ENABLED`)은 기본으로 꺼져 있고 나머지 조정값은 기본값으로 시작하므로(7.F 3번), M 번호 태그를 켤 생각이 없으면 넣지 않아도 됩니다.
- `compose.yml`은 pilot.16과 비교해 `x-tag-env` 앵커와 `worker-annotate`의 `PIPELINE_WORKER_ROLES: annotate,tag`도 다릅니다. 5-2의 패치는 pilot.16 원본(`5f0d7e0e5f2a0f492d56ffb0c39ddd7a618f42a6`)과 비교해 뽑고, 사내 pilot.17이면 그 빌드의 원본 파일과 비교합니다.
- 6~8단계는 본문과 같습니다.
- 9단계에서는 `refetch`가 필요할 가능성이 큽니다. 036 직후에는 모든 관측이 `unverified`이므로 `plan`의 `근거 없어 보류`가 클 수 있습니다. `plan`이 찍는 `근거가 필요한 PR:`의 번호만 `--pr`로 주고, 양이 많으면 `--limit`으로 회차를 나눕니다. 중단했다가 다시 실행하면 남은 것부터 이어 갑니다.
- M 번호 정렬이나 `seq:` 범위가 이상하면 7.E(`prsctl sequence status` → `sequence reproject --dry-run`)를 봅니다.
- pilot.16으로 올릴 때 해야 했던 `prs-pull-requests` 재색인(8장 「Status를 Merged로 두면 결과가 없다」)을 했는지 확인합니다. 병합된 PR이 `closed`로 보이면 운영 콘솔에서 `prs-pull-requests`를 한 번 재색인합니다.
- 롤백하면 pilot.16의 합집합 쓰기가 살아나 정리한 PR 번호가 다시 붙습니다. 되돌릴 계획이 있으면 9단계의 `apply`를 먼저 돌리지 않습니다(7.G 「롤백 위험」).

---

## 부록 C. 판마다 담긴 것 (참고)

| 판 | 발행일 | 태그 커밋 | 마이그레이션 | 담긴 변경 | 자산 SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `0.1.0-pilot.16` | 2026-09-21 | `5f0d7e0` | ~032 | CR-111 | `f683a520a78b458c5c0a27350ce03f12743dbb920417c039ef9aa6ef0f7e9e10` |
| `0.1.0-pilot.18` | 2026-09-23 | `6132dc9` | 033~036 | CR-112~116 | `f8a29f961511b00069744b5f9771fa19eef99ad37d44a71a70c2f3ed09383d2b` |
| `0.1.0-pilot.19` | 2026-09-26 | `85af93a` | 037 | CR-117~123 | `cf0e0e54837c860166ec85cf5a30f87f98893be810de37910362524492e3d00e` |
| `0.1.0-pilot.20` | 2026-09-28 | `73be84f` | 없음 | CR-124~127 | `6fdc2e783f8b6beafe8e433ae678fd4df2b4fd527ed7b988835ebd8d9829789c` |

`0.1.0-pilot.17`은 공식 릴리스가 아닙니다. CR-113~116을 촉발한 사내 자체 빌드의 이름이어서, 공식 판은 pilot.16 다음이 pilot.18입니다.

- **pilot.18**: PIPE 서버 위임 검색 수신부(CR-112), 머지 시퀀스 색인 수렴(CR-113), 검색창의 M 번호 해석(CR-114), M 번호 원격 태그(CR-115, 기본 꺼짐), 커밋 PR 연결 정본과 전용 투영기(CR-116)
- **pilot.19**: `git merge dev`로 붙은 PR 번호 정리(CR-117), prs-commits 재색인 검증과 메타데이터 복원(CR-119), prs-links 재색인과 스택 정본(CR-121), `prsctl links`의 행위 주체 전달 결함(CR-122), 재색인 순서에 따른 참조 해결 결함(CR-123)
- **pilot.20**: 사내 GHE URL 참조(CR-124), 운영 목록 커서(CR-125), 업그레이드 직후 스택 해제 보완(CR-126), KST 표시와 한국 날짜 검색(CR-127)
