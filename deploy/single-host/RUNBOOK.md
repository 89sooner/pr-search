# PR Search 사내 반입·운영 런북 (Profile A)

> 대상: 단일 Linux 호스트 · Docker Compose · 오프라인 번들 · 운반은 GitHub Release
> 근거: `CR-059` / `ADR-021` / `WP-070` · `CR-063` / `WP-072` · `CR-066` · 인프라 문서 3.0장
> 첫 실제 반입: 2026-09-07 — 이 문서의 절차로 성립했고, 그때 드러난 것을 반영했다 (원장 6.70장)

이 문서는 **번들 안에 함께 들어온다.** 사내에서 저장소 문서를 열 수 없어도 이것만으로 반입과 운영이 성립해야 한다.

---

## 0. 이 배포가 무엇이고 무엇이 아닌가

**이것은 첫 사내 파일럿의 형상이다.** 서버 한 대에 컨테이너로 서며, **호스트 장애가 곧 전체 서비스 장애다.** 그것은 승인된 trade-off이며(`CR-059`), 대신 재기동·영속 볼륨·백업/복구·재구축 가능성을 보장한다.

**고가용 구성이 아니다.** `NFR-004`의 가용성 목표와 RTO 30분은 이 형상에서 보장하지 않는다. 다중 서버가 필요해지면 Profile B(Kubernetes)로 승격하며, 그 산출물은 `deploy/k8s/`에 이미 있다.

**반입 대상은 read-only Search/Investigation Plane이다.** GitHub Operations Plane(`gh-executor`)은 번들에 담기되 **기본 형상에서는 꺼져 있다** — 켜는 절차는 7.C다 (`CR-086`).

---

## 1. 사전 요건

| 항목 | 값 |
| --- | --- |
| OS | Linux (x86_64) |
| Docker Engine | 24 이상 · Compose v2 |
| 디스크 | **첫 설치 시점에 6GB 이상** — 운반 아카이브 약 1.1GB + 풀린 번들 약 2.6GB + Docker 이미지 저장소 약 2~3.5GB + 데이터(저장소 수에 비례). 롤백을 위해 번들을 지우지 않으므로(3장) 그 몫은 남는다 (`DEV-529`) |
| RAM | 최소 8GB (Elasticsearch 힙 2GB 기준) |
| 네트워크 | **설치·운영에는 인터넷이 필요 없다.** 서비스는 사내 GHE와 사내 OIDC로만 나간다. **번들을 받는 단계(2.B 1단계)만 github.com에 닿는다** — 호스트가 직접 닿지 못하면 닿는 사내 위치에서 받아 호스트로 옮긴다 (`CR-063`, `DEV-528`) |

**컨테이너 레지스트리에 접근하지 않는다.** 필요한 이미지는 전부 번들 안에 있다. github.com에 닿는 것은 번들 파일을 받기 위해서이지 이미지를 받기 위해서가 아니다.

---

## 2. 반입 절차

**경계가 둘이다.** A는 외부망(저장소가 있는 곳)에서, B~D는 사내망(번들만 있는 곳)에서 실행한다. 사내 운영자는 A를 볼 필요가 없고 **A가 발행한 GitHub Release에서 파일 하나**를 받는다 (`CR-063`).

```text
A. 외부망                 1. 소스 커밋 확인 → 2. build-bundle --release → 3. 릴리스·자산 확인
──────── GitHub Release (github.com · 이 저장소 한정 읽기 토큰) — 닿지 않으면 조직의 반입 채널 ────────
B. 사내망 — 설치          1. download → digest 대조 → extract → 2. verify → 3. .env 작성 → 4. load → 5. install → 6. smoke → 7. lineage
C. 사내망 — 초기 데이터   1. GHE App → 2. 저장소 등록 → 3. 웹훅 → 4. 백필
D. 사내망 — 소스 계보     1. vendor/upstream → 2. company/main
```

### 2.A 외부망 — 번들 생성

**깨끗한 checkout에서 실행한다.** 스크립트가 작업 트리를 검사하며 추적되는 변경이든 미추적 파일이든 하나라도 있으면 거부한다 — 그 상태로 만들면 `release-manifest.json`의 커밋이 실제로 담긴 코드를 가리키지 않아 계보 증명이 거짓이 된다 (`DEV-512`).

```bash
cd <pr-search checkout>
git status                     # 깨끗해야 한다 (미추적 파일 포함)
git rev-parse HEAD             # 이 커밋이 manifest의 upstream.commit이 되고, 릴리스 태그가 가리키는 커밋이 된다

VERSION=<실제 버전>             # 예: 0.1.0-pilot.2 — 예시일 뿐이며 저장소의 릴리스 버전 규칙이 우선한다
./deploy/single-host/build-bundle.sh "$VERSION" --release
```

`docker`·`git`·Node가 필요하고 컨테이너 레지스트리에 닿아야 한다 (백킹 이미지를 pull한다). `--release`에는 인증된 `gh`가 더 필요하다 (`gh auth status`). **`pnpm release:bundle` 같은 별도 스크립트는 없다** — 정본은 이 스크립트 하나다 (`DEV-523`).

**`--release`가 운반을 맡는다** (`CR-063` / `WP-072`). 번들과 운반 아카이브를 만들고 아카이브를 다시 읽은 **뒤** GitHub Release `<version>`을 발행한다 — 태그가 곧 버전이고 위 커밋을 가리키며, 자산은 운반 아카이브 하나, 본문은 번들의 릴리스 노트에 아카이브의 파일명·크기·SHA-256을 덧붙인 것이다. **대조는 발행 앞에 있다** (`DEV-544`) — 자산이 붙은 초안을 API로 다시 읽어 이름·크기·digest·업로드 상태를 로컬과 대조하고, 어긋나거나 조회에 실패하면 초안과 이 실행이 만든 태그를 지우고 종료 코드 1로 끝낸다. 발행은 그 대조를 통과한 뒤에만 한다 — 잠긴 저장소에서는 발행 뒤에 되돌리면 같은 버전 이름을 다시 쓸 수 없기 때문이다. 발행 뒤의 확인은 공개 상태만 묻고, **어긋나도 되돌리지 않고** 사실을 보고한다. **릴리스는 불변이다** — 같은 버전의 릴리스가 이미 있거나 태그가 다른 커밋을 가리키면 이미지를 빌드하기 전에 멈춘다. 다시 만들려면 새 버전이다. `--release` 없이 실행하면 발행 없이 번들과 아카이브만 만든다 — github.com에 닿지 않는 환경으로 옮길 때 쓴다.

**사내 운영자에게 전달할 것은 셋이다** — 릴리스 버전(= 태그), 이 저장소 한정 읽기 토큰(아래 「경계」), 그리고 **자산 SHA-256**. SHA-256은 **릴리스와 별개의 채널**(반입 요청서 등)로 전달한다 — 릴리스는 저절로 불변이 아니어서 저장소 쓰기 권한자가 발행 뒤에도 자산을 바꾸거나 태그를 옮길 수 있고, 그러면 사내가 같은 릴리스의 현재 digest와만 대조해서는 바뀐 것을 알 수 없다 (`DEV-530`). 스크립트의 성공 출력이 세 값 중 버전과 SHA-256을 그대로 보여 준다.

**결과는 둘이고, 사내로 가져가는 것은 둘째다.** 출력 디렉터리 기본값은 `<checkout>/deploy/single-host/bundle/`이며 두 번째 인자로 바꿀 수 있다 (`./deploy/single-host/build-bundle.sh "$VERSION" /some/output --release`). 어느 쪽이든 그 위치에 아래 둘이 함께 만들어지고, `--release`가 둘째를 자산으로 올린다.

```text
<checkout>/deploy/single-host/bundle/
├─ pr-search-<version>-offline/          번들 디렉터리 (검사·확인용. 옮기지 않는다)
└─ pr-search-<version>-offline.tar.gz    운반 아카이브 — 사내로 가져갈 파일
```

스크립트의 마지막 출력이 두 경로와 **사내 반입 파일**의 이름을 그대로 보여 준다. `.gitignore`가 `deploy/single-host/bundle/`을 무시하므로 산출물이 저장소에 들어가지 않는다.

#### Docker 컨테이너 외부 네트워크 차단 환경에서의 빌드 (CR-094)

완성된 Release 번들을 내려받는 설치에는 npm·Alpine 접근이 필요 없다. 소스를 변경해 `--release` 없이 사내에서 다시 빌드하는 경우에는 **빌드 컨테이너**도 의존성 저장소에 닿아야 한다. 호스트에서 접속되더라도 컨테이너에서 `ECONNRESET`·TLS timeout이 나면 다음 순서로 준비한다.

1. 호스트 또는 사내 빌드망에 Verdaccio 등 npm 프록시를 준비하고, 정확히 고정된 lockfile 의존성을 캐시한다. 프록시는 빌드 호스트에서만 접근하도록 바인딩·방화벽을 설정한다.
2. Docker 빌더의 프록시·DNS·사내 CA를 구성한다. Linux에서 호스트 프록시를 쓰려면 빌드 컨테이너에서 닿는 게이트웨이 주소를 사용한다. `localhost`는 컨테이너 자신이며 `172.17.0.1`은 환경마다 다르므로 고정하지 않는다. npm 프록시는 Alpine 패키지를 제공하지 않으므로 `apk`용 사내 미러도 따로 준비한다.
3. 루트 `Dockerfile`의 고정 Node·pnpm 버전과 lockfile을 유지해 빌드한다. 프록시 설정이 필요한 경우 사내 Dockerfile의 의존성 설치 단계에 registry 설정을 적용한다. 인증 토큰을 이미지 ENV나 소스에 저장하지 않는다. 호스트 전용 프록시가 필요하면 조직 정책이 허용하는 빌더 네트워크 설정을 사용한다.
4. 변경한 사내 소스를 커밋하고 `./deploy/single-host/build-bundle.sh <새-사내-버전>`을 실행한다. `--release`를 생략하면 외부 GitHub에 발행하지 않는다. 캐시를 모두 준비하기 전에는 오프라인 빌드라고 간주하지 않는다.

피드백의 기존 이미지 재태깅·Docker 래퍼는 긴급 우회 기록이다. 서로 다른 소스의 이미지를 한 커밋의 산출물로 표시할 수 있으므로 정식 번들은 각 타깃을 해당 커밋에서 빌드한다. 이전 이미지에서 `git` 실행 파일만 복사하는 방법도 Alpine 공유 라이브러리 호환성을 보장하지 않는다. 빌드 뒤에는 번들 스크립트의 이미지·계보·checksum 검사를 그대로 통과해야 한다.

### 번들 안에 무엇이 있는가

운반 아카이브를 풀면 아래 디렉터리 하나가 나온다. **이 트리와 다르게 도착했다면 그 번들을 쓰지 않는다.**

```text
pr-search-<version>-offline/
├─ images/
│  ├─ pr-search-app.tar             애플리케이션 이미지 6종 — docker load 대상
│  └─ backing-services.tar          백킹 이미지 4종 — docker load 대상
├─ source/
│  └─ pr-search-<version>.bundle    소스 계보 (git bundle) — git fetch 대상
├─ deploy/
│  └─ single-host/
│     ├─ compose.yml
│     ├─ .env.example
│     ├─ prsctl
│     ├─ filebeat.yml
│     └─ RUNBOOK.md                 이 문서
├─ manifest/
│  └─ release-manifest.json         이 형상의 출처 (upstream 커밋 · 이미지 id · 스키마 수준)
├─ checksums/
│  └─ SHA256SUMS                    모든 파일의 checksum — prsctl verify가 검증한다
└─ RELEASE_NOTES.md
```

### 아카이브가 셋이다 — 다루는 명령이 다르다

| 무엇 | 파일 | 목적 | 다루는 명령 |
| --- | --- | --- | --- |
| **운반 아카이브** | `pr-search-<version>-offline.tar.gz` | 외부망 → 사내망으로 번들 전체를 **한 파일로** 운반 | `tar -xzf <파일>` |
| **Docker 이미지 아카이브** | `images/pr-search-app.tar` · `images/backing-services.tar` | Docker 이미지 저장소로 오프라인 적재 | **`prsctl load`** — 그 안에서 `docker load`가 읽는다. **`tar`로 직접 풀지 않는다.** 풀어 봐야 레이어 파일 더미가 나올 뿐이고 Docker는 그것을 쓰지 못한다 |
| **git bundle** | `source/pr-search-<version>.bundle` | 외부 Git 이력·계보를 사내 Git으로 반입 | `git fetch <파일> HEAD:vendor/upstream` (2.D) |

`.bundle`은 Docker 이미지도 일반 tar도 아니다. **`.tar`가 보인다고 전부 `tar`로 푸는 것이 아니다** — 이 번들에서 운영자가 `tar`로 푸는 것은 운반 아카이브 하나뿐이다.

### 발행이 중간에 멈췄다면 (DEV-544)

**스크립트는 되돌릴 수 있는 자리에서만 되돌린다.** 발행 전에는 초안과 이 실행이 만든 태그를 지우고 끝내며, **발행 뒤에는 아무것도 지우지 않고 사실만 말한다.** immutable releases가 켜진 저장소에서 발행된 릴리스를 지우면 태그는 지울 수 있으나 **같은 버전 이름을 다시 쓸 수 없기** 때문이다(아래 「경계」). 그 판단은 사람이 한다.

| 스크립트가 말한 것 | 무슨 상태인가 | 무엇을 하는가 |
| --- | --- | --- |
| `… — 발행하지 않았다. 릴리스와 태그를 되돌렸다` | 발행 전에 멈췄고 자기 산출물을 스스로 치웠다 | 원인을 고치고 **같은 버전으로 다시 실행한다** |
| `… 릴리스는 지웠으나 태그 <version>를 지우지 못했다 (옮겨졌거나 삭제가 거부됐다)` | 삭제 실패 뒤 소유가 불명확하다 | **태그를 보존하고 새 버전으로 실행한다** — 아래 「남은 태그를 지우기 전에」 |
| `… 태그 <version>(<sha>)는 이 실행이 만든 것이 아니므로 지우지 않았다` | **다른 주체가 같은 버전을 발행하고 있다** | **그 태그를 지우지 않는다.** 누가 발행 중인지 확인한 뒤 **새 버전으로** 다시 실행한다 (`DEV-541`) |
| `릴리스를 되돌리지 못했다` | 초안이 남았다 | GitHub에서 그 초안을 지운 뒤 다시 실행한다 — 남은 초안은 같은 버전의 재실행을 전제 검사에서 막는다 |
| `발행 요청은 실패했으나 서버에는 적용됐다` | **릴리스가 공개돼 있다** (응답만 잃었다) | 아래 「공개된 릴리스를 확인한다」 |
| `발행 뒤 확인 조회가 실패했다` | 발행은 됐고 확인만 못 했다 | 아래 「공개된 릴리스를 확인한다」 |
| `발행했는데 여전히 초안이다` | 발행이 반영되지 않았다 | 아래 「공개된 릴리스를 확인한다」 |
| `초안을 발행하지 못했고 실제 상태도 확인하지 못했다` | 알 수 없다 | 아래 「공개된 릴리스를 확인한다」 |

#### 남은 태그를 지우기 전에

**삭제 실패 뒤에는 태그를 보존하고 새 버전으로 실행한다** (`DEV-559`). 커밋 일치는 소유를 증명하지 않는다. 다른 주체가 태그를 A → B → A로 옮기면 원래 커밋을 기대값으로 건 lease도 그 태그를 삭제한다. 현재 대상 조회는 진단 자료일 뿐 삭제 권한의 근거가 아니다.

```bash
# 1) 대상을 먼저 본다 (역참조까지)
git ls-remote --tags origin "refs/tags/<version>" "refs/tags/<version>^{}"
```

독립적인 발행 기록과 담당자 확인으로 소유를 확정하기 전에는 수동 삭제도 하지 않는다. 새 버전 발행은 남은 태그의 정리를 전제로 하지 않는다.

#### 공개된 릴리스를 확인한다

스크립트가 되돌리지 않고 사람에게 넘긴 자리다. **읽기만 하는 명령이므로 먼저 상태를 확인하고, 지울지 말지는 그 뒤에 정한다.**

```bash
# 1) 릴리스의 상태와 자산을 읽는다
gh api repos/<owner>/<repo>/releases/tags/<version> \
  --jq '{draft, immutable, assets: [.assets[] | {name, size, digest}]}'

# 2) 로컬 아카이브와 대조한다
ls -l    <출력 디렉터리>/pr-search-<version>-offline.tar.gz   # 크기
sha256sum <출력 디렉터리>/pr-search-<version>-offline.tar.gz   # 지문

# 3) **태그가 실제로 무엇을 가리키는지 직접 묻는다.** 아래 「target_commitish를 믿지 마라」
git ls-remote --tags origin "refs/tags/<version>" "refs/tags/<version>^{}"

# 4) 번들 manifest의 커밋과 대조한다 — 2.D의 계보가 이 값 위에 선다
grep '"commit"' <출력 디렉터리>/pr-search-<version>-offline/manifest/release-manifest.json
```

**`target_commitish`를 믿지 마라.** 릴리스 객체의 그 필드는 발행 시점에 기록된 값이며 GitHub 문서가 **"태그가 이미 존재하면 사용되지 않는다"**고 정한다. 이 스크립트는 태그를 먼저 원자적으로 만든 뒤 발행하므로(`DEV-541`) 그 필드는 애초에 **무시된 값**이고, 태그가 그 뒤에 옮겨져도 따라가지 않는다. 계보의 근거는 3단계의 역참조 결과 하나뿐이다.

**`draft`가 `false`이고, 이름·크기·digest가 로컬과 같고, 3단계의 태그 대상이 4단계의 manifest 커밋과 같으면 그 릴리스는 온전하다.** 스크립트가 멈춘 것은 확인 조회의 문제였을 뿐이므로 **지우지 않고 그대로 쓴다.** 다만 성공 출력이 나오지 않았으니, 사내 운영자에게 전달할 셋 중 **버전과 자산 SHA-256은 위 두 명령의 결과에서 읽는다**(2.A 「사내 운영자에게 전달할 것은 셋이다」).

**하나라도 어긋나면 — 자산이든 태그 대상이든 — 새 버전으로 다시 발행한다.** 태그가 manifest의 커밋을 가리키지 않으면 그 릴리스는 자산이 맞더라도 **버전과 소스의 계보가 거짓**이며, 사내에 내보내면 2.D의 `vendor/upstream` 확인이 어긋난다. 잠긴 저장소에서는 그 릴리스를 지워도 같은 이름을 회수하지 못한다. 지우기 전에 위 두 명령의 출력을 기록해 둔다 — 무엇이 어긋났는지는 그것으로만 확인할 수 있다.

**`draft`가 `true`로 남아 있으면** 발행이 반영되지 않은 것이다. 그 초안은 잠기지 않았으므로 지우고 같은 버전으로 다시 실행해도 된다.

### 경계 — 번들은 GitHub Release에서 받는다 (CR-063)

**사내 어느 위치에서든 github.com에 닿는다** (결정자 확인, 2026-09-02 — 사내에서의 실측은 7장에 적는다). 그래서 운반 아카이브는 물리 매체가 아니라 GitHub Release의 자산으로 건너간다. 저장소가 비공개이므로 **이 저장소 한정 읽기 토큰**이 필요하다.

| 무엇 | 값 |
| --- | --- |
| 토큰 종류 | GitHub fine-grained personal access token. 대상 저장소는 이 저장소 하나, 권한은 **Contents: Read-only** 하나 |
| 누가 | 반입 담당자(사람). 서비스 계정이 아니다 |
| 어디에 두는가 | 담당자의 자격 저장소. `gh release download`를 실행하는 순간에만 환경 변수 `GH_TOKEN`으로 준다 |
| 어디에 두지 않는가 | **`.env`·번들·저장소·호스트의 시크릿 파일.** 서비스는 이 토큰을 읽지 않으며 `.env.example`에 그 키가 없다 (보안 문서 6장) |
| 회전 | 90일. 담당자가 바뀌면 즉시 폐기 |

받는 명령은 2.B 1단계에 있다. `gh`가 없는 위치에서는 API로 받는다 — `Accept` 헤더가 없으면 파일 대신 JSON이 온다. 응답 JSON에는 `id`가 릴리스·작성자·자산·업로더에 각각 있으므로 `grep`으로는 자산 id를 가려낼 수 없다 — `python3`(또는 `jq`)로 `assets[]`의 항목을 읽는다 (`DEV-532`).

```bash
# 자산 id · 이름 · digest를 읽는다 (python3가 없으면 jq: jq -r '.assets[] | "\(.id) \(.name) \(.digest)"')
curl -fsS -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/<owner>/<repo>/releases/tags/<version> \
  | python3 -c 'import json,sys; [print(a["id"], a["name"], a["digest"]) for a in json.load(sys.stdin)["assets"]]'
# 자산을 받는다 — 위 줄이 출력한 id를 쓴다
curl -fL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/octet-stream" \
  -o pr-search-<version>-offline.tar.gz \
  https://api.github.com/repos/<owner>/<repo>/releases/assets/<asset id>
```

**받은 파일은 담당자가 전달한 SHA-256과 같아야 하고, 자산 digest와도 같아야 한다.** GitHub는 자산마다 SHA-256 digest를 계산해 API로 주고, 릴리스 본문에도 발행 시점의 같은 값이 적혀 있다. 그러나 **릴리스는 저절로 불변이 아니다** (`DEV-530`) — 저장소의 immutable releases 설정이 꺼져 있으면 쓰기 권한자가 발행 뒤에도 자산을 바꾸거나 지우고 태그를 옮길 수 있고, 켜져 있어도 제목과 본문은 편집할 수 있다. 그래서 정본은 **담당자가 릴리스와 별개의 채널로 전달한 SHA-256**이며, 본문의 값은 참고일 뿐이다. `sha256sum`이 전달받은 값과 다르거나 자산 digest가 전달받은 값과 다르면 그 파일을 쓰지 않는다 — 손상이든 변조든 발행 뒤 변경이든 같은 결론이다. 프록시 환경이면 `gh`와 curl은 `HTTPS_PROXY`를 읽는다.

**immutable releases는 2026-09-04에 켰다** (`gh api repos/<owner>/<repo>/immutable-releases` → `enabled: true`). 켜면 발행된 릴리스의 자산을 바꾸거나 지울 수 없고 태그가 그 커밋에 잠기며, `build-bundle.sh --release`가 발행할 때 그 상태를 출력한다.

**그러나 소급되지 않는다.** 켜기 전에 발행된 릴리스는 그대로 남는다 — `0.1.0-pilot.2`는 설정을 켠 뒤에도 `immutable: false`다(실측). 잠기는 것은 **켠 뒤에 발행하는 릴리스부터**이며, 그전에 발행한 것은 여전히 쓰기 권한자가 자산을 바꾸거나 태그를 옮길 수 있다. **전달받은 SHA-256과의 대조는 어느 쪽이든 그대로 한다** (`DEV-530`).

**github.com에 닿지 않는 환경이면** 담당자가 외부망에서 같은 파일(`--release`가 올린 것과 같은 아카이브)을 조직의 반입 채널로 옮긴다. 그 뒤의 검증과 절차는 같다 — 1단계의 대조는 담당자가 전달한 SHA-256으로 한다.

### 2.B 사내망 — 설치

**순서가 절차다.** 각 단계는 실패하면 멈추며, checksum 불일치·필수 값 부재·이미지 부재·마이그레이션 실패·health 실패를 성공으로 접지 않는다.

```bash
# 1) 운반 아카이브를 받고, digest와 대조한 뒤 푼다 — /opt/pr-search/import 는 권장 예시이며 제품이 강제하지 않는다
mkdir -p /opt/pr-search/import
cd /opt/pr-search/import
GH_TOKEN=<읽기 토큰> gh release download <version> -R <owner>/<repo> -p '*.tar.gz'
GH_TOKEN=<읽기 토큰> gh api repos/<owner>/<repo>/releases/tags/<version> --jq '.assets[].digest'   # sha256:… — 자산 digest. 릴리스가 발행 뒤 바뀌었으면 여기서 드러난다
sha256sum pr-search-<version>-offline.tar.gz      # 담당자가 별도 채널로 전달한 SHA-256, 그리고 위 digest — 셋이 같아야 한다. 하나라도 다르면 쓰지 않는다 (DEV-530)
tar -xzf pr-search-<version>-offline.tar.gz
cd pr-search-<version>-offline/deploy/single-host

# 2) 변조·손상 검증 — 실패하면 여기서 멈춘다. 그 번들은 쓰지 않는다
./prsctl verify

# 3) 구성 작성 — load보다 먼저다 (아래 「.env는 어디에 있는가」)
cp .env.example .env
chmod 600 .env
$EDITOR .env          # 필수 값과 GHE App 자격을 채운다 (아래 「.env는 어디에 있는가」). 필수 값이 비면 load가 거부한다

# 4) 이미지 적재 — verify를 다시 포함해 실행하고, 적재 뒤 PRS_VERSION의 이미지가 실제로 있는지 검증한다
./prsctl load

# 5) 설치 — migration → 접속 주체 → ES mapping → 기동 → health
./prsctl install

# 6) 스모크 — health가 아니라 실제 조회 왕복을 건다
./prsctl smoke

# 7) 이 형상의 출처 확인 — manifest의 upstream.commit이 2.D의 vendor/upstream이 된다
./prsctl lineage
```

**`.env`가 `load`보다 먼저인 이유.** `load`는 적재 뒤 `.env`의 `PRS_VERSION`으로 이미지가 실제로 있는지 검증하므로 그 값을 먼저 알아야 하고, 필수 구성의 부재는 **이미지 저장소를 바꾸기 전에** 말해야 한다 (`DEV-524`). `.env` 없이 `load`를 실행하면 **아무것도 적재하지 않고** 멈춘다.

### `.env`는 어디에 있는가

| 어디 | 파일 | 있는가 |
| --- | --- | --- |
| 번들 | `deploy/single-host/.env.example` | **있음** — 구성 표면 전수이며 값은 비어 있다 |
| 사내 운영자가 생성 | `deploy/single-host/.env` | **있음** — 2.B 3단계에서 만든다. `chmod 600`, 소유자만 읽는다 |
| 외부 Git | `.env` | **없음** — `.gitignore`가 `deploy/single-host/.env`·`bundle/`·`backups/`를 무시한다 |
| 오프라인 번들 | 값이 채워진 `.env` | **없음** — 시크릿이라 어떤 번들에도 담지 않는다. `build-bundle.sh`가 `.env`·`*.pem`·`*.key`를 찾으면 번들을 만들지 않는다 |

**`prsctl`이 요구하는 필수 값** — 정본은 `prsctl`의 `require_env`이며 아래는 그것을 옮겨 적은 것이다. 비어 있으면 `load`·`install`·`upgrade`·`smoke`·`backup`·`restore` 전부 멈춘다.

```text
PRS_VERSION                  번들의 manifest/release-manifest.json이 적은 release_version 그대로
POSTGRES_DB
POSTGRES_OWNER_USER          마이그레이션을 실행하는 소유자
POSTGRES_OWNER_PASSWORD
POSTGRES_APP_USER            prs_app이 아닌 로그인 주체 (예: prs_app_login) — 아래 「데이터베이스 접속 주체」
POSTGRES_APP_PASSWORD
GHE_BASE_URL
GHE_WEBHOOK_SECRET
SEARCH_CURSOR_HMAC_KEY       32자 이상
ADMIN_DATABASE_URL           postgresql://<롤>:<비밀번호>@postgres:5432/<POSTGRES_DB> — 아래 「파티션 수명 주체」
```

`PRS_REINDEX_TIMEOUT_S`는 선택이며 두면 1~2592000(30일)의 정수여야 한다. 나머지 값의 뜻은 `.env.example`의 주석이 설명한다.

**`install` 전에 함께 채워야 하는 값 — GHE App 자격 셋** (`DEV-527`). `GHE_APP_ID`·`GHE_APP_PRIVATE_KEY`·`GHE_INSTALLATIONS`는 `require_env`의 필수 목록에 없지만, **없으면 `worker-enrich`·`worker-reconcile`이 기동을 거부한다** (의도된 거부다 — 자격 없이 돌면 모든 이벤트가 실패 대기열에 쌓인다). Compose는 컨테이너를 만들 때 `.env`의 값을 굳히므로 `install` 뒤에 `.env`만 고쳐서는 도는 컨테이너에 반영되지 않고, 그 상태로는 5단계 `install`의 health와 6단계 `smoke`의 워커 검사가 실패한다. 사내 GHE에 App을 먼저 등록하고 그 자격을 **이 3단계에서** 넣는다. 나중에 넣거나 바꿨다면 `./prsctl upgrade`를 실행한다 — 같은 `PRS_VERSION`이면 마이그레이션은 no-op이고 값이 바뀐 컨테이너만 다시 만든다. **`restart`는 `.env`를 다시 읽지 않는다.**

**`.env`는 LF 개행이어야 한다.** `prsctl`은 값을 줄 단위로 읽으므로 CRLF면 모든 값 끝에 `\r`이 붙어 `3600` 같은 멀쩡한 값이 거부된다 (`DEV-526`). 번들의 `.env.example`은 LF이며(빌드가 보장한다) 그것을 `cp`해 리눅스 편집기로 고치면 LF가 유지된다. Windows에서 편집해 옮겼다면 `sed -i 's/\r$//' .env`로 되돌린다.

### 파티션 수명 주체도 `prsctl install`이 만든다

**이 값은 선택이 아니다** (`DEV-556`). `raw_event`는 파티션 테이블이고 **마이그레이션은 파티션을 만들지 않는다.** 그것을 만드는 것은 `JOB-AUD-001` 하나뿐이며, 그 잡은 `ADMIN_DATABASE_URL`이 있어야 선다. 비워 두면 잡이 서지 않고 **다가올 파티션이 소진되는 순간 모든 웹훅이 저장에서 거부된다** — 수신은 되는데 저장이 안 되는 모양이라 방화벽·서명 문제로 오진하기 쉽다. 첫 사내 반입에서 실제로 그렇게 됐다(`DEV-553`).

그래서 `require_env`가 이 값을 요구하고, `install`·`upgrade`·`restore`가 **그 URL이 가리키는 롤을 직접 만든다.** 접속 주체와 같은 자리이며 같은 방식이다.

```text
ADMIN_DATABASE_URL=postgresql://prs_retention:<비밀번호>@postgres:5432/prs
```

- 롤 이름은 **`prs_admin`이 아니어야 한다** — 그것은 `NOLOGIN` 그룹 롤이다. `prs_retention`처럼 다른 이름을 주면 이 명령이 만들고 `prs_admin` 멤버십까지 준다.
- 호스트는 compose 네트워크 안의 `postgres`이고 DB는 `POSTGRES_DB`와 같아야 한다.
- **비밀번호를 퍼센트 인코딩하지 않는다.** 인코딩된 문자열로 롤을 만들면 앱은 디코딩한 값으로 접속해 `password authentication failed`가 난다. `prsctl`이 `%`를 발견하면 멈춘다.
- 복구·재구축 뒤에도 손으로 만들 필요가 없다 — `restore`가 마이그레이션 뒤에 다시 만든다.

### 데이터베이스 접속 주체는 `prsctl install`이 만든다

`.env`의 `POSTGRES_APP_USER`에 **`prs_app`이 아닌 이름**을 준다 (예: `prs_app_login`). `prs_app`은 마이그레이션 005가 만드는 `NOLOGIN` 그룹 롤이라 **그대로는 접속할 수 없다** (`DEV-503`).

`install`이 마이그레이션을 적용한 **뒤에** 그 주체를 만들고 `prs_app` 멤버십을 주며 세션 기본 역할을 `prs_app`으로 둔다 — 접속하면 `current_user = prs_app`이 되어 감사 기록 불변성의 제약이 그대로 걸린다. **순서가 중요하다**: `prs_app`은 마이그레이션이 만들므로 그전에는 멤버십을 줄 수 없다 (`DEV-510`).

`upgrade`도 같은 일을 다시 한다. 비밀번호를 회전했다면 `.env`만 고치고 `upgrade`를 돌리면 맞춰진다.

### 2.C 사내망 — 초기 데이터

기동 직후 시스템은 **비어 있다.** 웹훅은 앞으로 오는 것만 받는다.

1. GHE App 자격(`GHE_APP_ID`·`GHE_APP_PRIVATE_KEY`·`GHE_INSTALLATIONS`)은 **2.B 3단계에서 이미 넣었다** (`DEV-527`) — 여기서 처음 넣는 것이 아니다. 나중에 바꿨다면 `./prsctl upgrade`로 컨테이너를 다시 만든다.
2. 운영 콘솔의 저장소 화면(`A-002`, `/ops/repositories`)에서 저장소를 등록한다. **시퀀스 대상 브랜치는 저장소마다 적는다** — 제품에 기본값이 없고 이름 규칙으로 정해 주지도 않는다. 아래 「시퀀스 대상 브랜치 정하기·바꾸기」.
3. GHE에 웹훅을 등록한다 — 대상은 `http://<호스트>:3001/api/v1/webhooks/github`, 시크릿은 `.env`의 `GHE_WEBHOOK_SECRET`.
   **경로에 `/api/v1`이 있다.** 정본은 `apps/ingest-gateway/src/server.ts`의 `WEBHOOK_PATH`이며, 이 문서가 한동안 그것을 빼고 적어 첫 반입에서 웹훅이 전부 404였다 (`DEV-549`).
   **GHE가 이 주소에 닿는지 먼저 확인한다** — 닿지 않으면 4단계로 가기 전에 아래 「GHE가 서버에 닿지 못할 때」를 읽는다.
4. **백필을 실행한다** — 과거 PR 이력은 백필이 채운다(`JOB-ING-004`). `worker-enrich`가 그 역할을 함께 켜고 있다.
5. 시퀀스 채번과 관계 파생은 미러 동기화 뒤에 따라온다.

#### 수집용 GHE App에 줄 권한 (`CR-092`)

`GHE_APP_ID`의 App(설치 토큰)은 수집만이 아니라 **로그인한 사용자의 접근 범위**도 읽는다. 권한이 모자라면 기동은 정상이고 로그인도 되는데 조회가 503 `permission_unavailable`이 된다 — 사내 `0.1.0-pilot.7`이 그 모양이었다(`DEV-698`). 권한 이름은 GitHub REST 문서의 엔드포인트별 권한 표를 따른다.

| 권한 | 수준 | 없으면 |
| --- | --- | --- |
| Repository permissions › Metadata | Read-only | 저장소 등록이 `FORBIDDEN_ROLE`로 거절되고(등록은 `GET /repos/{owner}/{repo}`로 저장소를 확인한다), 사용자의 저장소 권한을 읽지 못해 **모든 조회가 503**이다 |
| Repository permissions › Contents | Read-only | 미러의 `git` 동기화와 커밋 수집이 실패한다. 등록 거절 응답의 `required_permissions`가 이 셋을 함께 적는다 |
| Repository permissions › Pull requests | Read-only | PR을 수집하지 못한다(백필·증분) |
| Organization permissions › Members | Read-only | **볼 수 있는 저장소가 500개를 넘는 사용자**의 조회가 503이다(그 크기부터 조직·팀 조건으로 거른다). 작성자 팀 집계(`group_by=team`)가 「모름」이고, `team` 웹훅의 팀 구성원 갱신이 실패한다 |

- **저장소가 500개 이하인 배포는 `Members` 없이도 조회가 선다.** `0.1.0-pilot.7`까지는 쓰이지 않는 조직·팀 조회까지 불러 그 권한이 없으면 전부 503이었다. 작성자 팀 집계를 쓸 계획이면 그래도 준다.
- App 권한을 바꾸면 GHE가 **설치마다 승인을 다시 요구한다.** 조직 관리자가 승인해야 새 권한이 설치 토큰에 실린다.
- 조회가 503이면 추정하지 말고 로그를 본다. `docker logs <search-api 컨테이너>`의 「접근 범위를 조회하지 못했다」 줄이 **실패한 단계(`stage`)·상태 코드(`status`)·그 단계가 요구하는 권한(`required_permission`)**을 적는다. GHE 응답 본문은 싣지 않는다.
- **`permission_cache`에 손으로 행을 넣지 않는다.** 5분 뒤 만료되어 다시 GHE를 부르므로 증상이 5분 뒤에 되돌아오고(`FR-AUTH-003`), 미래 시각을 넣어 붙잡아 두면 권한 회수가 반영되지 않는다.

#### 시퀀스 대상 브랜치 정하기·바꾸기 (`CR-092`)

시퀀스(M 번호, 범위 조사)는 **저장소마다 적은 브랜치**에만 매긴다(`FR-ING-009` AC-1, 저장소당 최대 10개). 제품은 기본 브랜치를 추측하지 않고 이름 규칙(`smp*`면 `dev` 같은)을 적용하지도 않는다 — 운영자가 저장소마다 적는다.

- **등록할 때** 저장소 화면의 등록 폼에서 브랜치를 한 줄에 하나씩 적는다. 사내 규칙상 `smp`로 시작하는 저장소는 `dev`를 적는다.
- **이미 다른 브랜치로 등록했다면** 저장소 화면에서 그 저장소를 편집해 목록을 고친다(`PATCH /api/v1/admin/repositories/{id}`). 새로 더한 브랜치는 **채번을 자동으로 요청하며**(`AC-12`) 변경은 감사 기록 `repository.update`로 남는다.
- **목록에서 뺀 브랜치의 기존 시퀀스는 지워지지 않는다.** 뺐다는 사실만 반영되고 새 머지에는 번호가 붙지 않는다. `main`을 `dev`로 바꾸면 `main`의 이미 붙은 번호는 그대로 남고 `dev`에 새로 매긴다.
- 사용자가 인용하는 범위는 `(저장소, 브랜치)` 공간마다 따로다. 브랜치를 바꾼 뒤에는 새 공간의 번호로 인용한다.

#### GHE가 서버에 닿지 못할 때 — 방향이 반대다

**백필이 되는데 웹훅이 오지 않는 상황은 설정 오류가 아니라 방향의 문제다** (`DEV-550`).

| | 방향 | 연결을 시작하는 쪽 | 첫 반입(2026-09-07)에서 |
| --- | --- | --- | --- |
| 백필 | 서버 → GHE | 우리 서버 | **가능** — 아웃바운드가 열려 있다 |
| 웹훅 | GHE → 서버 | GHE | **불가** — 그 포트로의 인바운드가 없다 |

같은 IP 대역에 있어도 닿지 않을 수 있다. 통제가 **대역이 아니라 목적지와 포트의 허용 목록**으로 걸리기 때문이며, 첫 반입에서 이웃 호스트의 443은 이미 목록에 있고 이 서버의 수신 포트는 등록된 적이 없었다. 그래서 웹훅 주소만 바꾸는 것으로는 풀리지 않는다 — 목적지가 이 서버이면 무엇을 적어도 같은 시간 초과가 난다.

**진단은 여기서 시작한다.**

| 보이는 것 | 뜻 |
| --- | --- |
| GHE의 배달 기록이 **시간 초과** | 인바운드가 막혔다. 아래 둘 중 하나를 고른다 |
| **404** | 주소는 닿았고 경로가 틀렸다 — 3단계의 `/api/v1/webhooks/github`인가 |
| **401** | 경로는 맞고 서명이 다르다 — `GHE_WEBHOOK_SECRET`이 GHE 쪽과 같은가 |
| **500 `store_failed`** | 수신은 됐고 저장이 막혔다 — 8장의 `raw_event` 파티션 항목을 본다 |

**선택지는 둘이다.**

1. **수신 포트를 허용 목록에 올린다.** 보안 조직에 목적지와 포트를 등록한다. 경로가 하나뿐이라 운영이 단순하다.
2. **닿는 호스트를 경유한다.** GHE가 이미 닿는 사내 호스트에 **포워딩 전용 경로**를 만들고 그것을 웹훅 주소로 준다. 첫 반입이 택한 길이다.

경유를 택한다면 지켜야 할 것이 셋이다.

- **원문을 그대로 보낸다.** 서명은 본문 바이트에 대해 계산되므로, 중간에서 다시 만들면 401이 된다. 몸통과 `X-Hub-Signature-256`·`X-GitHub-Event`·`X-GitHub-Delivery` 헤더를 손대지 않고 넘긴다.
- **기존 웹훅을 고쳐 쓰지 않는다.** 경유 호스트가 이미 쓰는 웹훅의 주소를 바꾸면 그쪽 서비스가 끊긴다. **별도 웹훅과 별도 경로**를 만들어 공존시킨다.
- **그 경유 코드는 이 저장소 밖에 산다.** 다음 반입이 그것을 다시 만들어 주지 않으므로, 어느 서비스의 어느 경로인지를 5장의 다운스트림 형상에 **B등급(사내 배선)** 으로 적어 둔다.

**경유는 단일 경로다.** 그 호스트가 멈추면 증분 수집도 멈춘다. 백필은 반대 방향이라 그때도 살아 있으므로, 복구 뒤에는 끊긴 구간을 백필로 메운다.


### 2.D 사내망 — 소스 계보

**반입은 코드로도 이루어진다.** 이미지만 세우면 다음 반입에서 무엇을 합쳐야 하는지 알 수 없다. 번들의 git bundle을 사내 Git에 들여와 baseline을 만든다 — 5장의 형상 정책(`vendor/upstream` / `company/main`, merge 우선)이 그 위에 선다.

```bash
# 사내 Git 저장소를 만든다 (이미 있으면 그 안에서 fetch만 한다)
git init pr-search
cd pr-search

# 번들의 소스 계보를 vendor/upstream으로 들여온다 — 경로는 2.B에서 푼 위치 기준이다
git fetch \
  /opt/pr-search/import/pr-search-<version>-offline/source/pr-search-<version>.bundle \
  HEAD:vendor/upstream

# 운영 형상 브랜치를 그 위에 세운다
git branch company/main vendor/upstream
git checkout company/main

# 확인 — 아래 둘이 같아야 한다
git rev-parse vendor/upstream
grep '"commit"' /opt/pr-search/import/pr-search-<version>-offline/manifest/release-manifest.json
```

**불변식**: `vendor/upstream`은 외부에서 반입한 baseline이며 **내부 수정을 넣지 않는다.** `company/main`은 실제 사내 수정이 누적되는 다운스트림이다. 다음 반입의 절차와 내부 변경의 분류는 5장이다.

---

## 3. 일상 운영

| 목적 | 명령 |
| --- | --- |
| 상태 확인 | `./prsctl health` |
| 로그 | `docker compose -p pr-search --env-file .env -f compose.yml logs -f <서비스>` |
| 재기동 | `docker compose -p pr-search --env-file .env -f compose.yml restart <서비스>` — **`.env`를 다시 읽지 않는다** |
| 구성(`.env`) 변경 반영 | `./prsctl upgrade` — 같은 `PRS_VERSION`이면 값이 바뀐 컨테이너만 다시 만든다 (`DEV-527`) |
| 전체 정지 | `docker compose -p pr-search --env-file .env -f compose.yml down` (볼륨은 남는다) |
| 백업 | `./prsctl backup` |
| 복구 | `./prsctl restore <백업 파일>` |

**`down -v`를 쓰지 마라.** 볼륨을 지우며 그것은 정본 손실이다.

### 업그레이드

```bash
# 새 릴리스를 2.B 1단계와 같은 방법으로 받아 푼 번들에서
# **이전 설치의 .env를 먼저 가져온다** (DEV-513) — 번들은 값이 채워진 .env를
# 담지 않으므로(시크릿이다) `prsctl load`가 그것 없이는 멈춘다.
cp <이전 설치 경로>/deploy/single-host/.env .env
chmod 600 .env
# 또는 복사하지 않고 지정한다:  export PRS_ENV_FILE=<이전 .env 절대경로>

$EDITOR .env          # PRS_VERSION을 새 값으로 — **load보다 먼저다** (DEV-524).
                      # load가 적재 뒤 이 값의 이미지가 있는지 검증하므로, 이전 값이면 옛 이미지를 보고 통과해 버린다
./prsctl verify && ./prsctl load
# compose.yml을 새 번들이 덮어쓰므로 사내 환경 수정을 여기서 재적용한다.
# prsctl load가 내부에서 verify를 재실행하므로 load 전에 compose.yml을 수정하면
# checksum 불일치로 거부된다. 순서: load 완료 → compose.yml 수정 → upgrade.
./prsctl upgrade      # migration → 접속 주체 → ES mapping → 컨테이너 교체 → health
```

**마이그레이션이 먼저다.** 하위 호환이므로 옛 코드가 새 스키마 위에서 돈다(데이터 모델 7장). 롤백은 `.env`의 `PRS_VERSION`을 이전 값으로 되돌리고 `./prsctl upgrade`를 다시 실행한다 — **이전 이미지가 로컬에 남아 있어야 하므로 번들을 지우지 마라.**

**세션 인증과 관리 토큰 (`CR-091`).** `./prsctl load`·`install`·`upgrade`·`health`는 시작하기 전에 `AUTH_ENABLED=true`와 `ADMIN_API_TOKENS`가 함께 있는지 본다. 함께 있으면 **컨테이너를 바꾸기 전에** 멈춘다 — `search-api`가 그 조합으로는 기동하지 않기 때문이다(`DEV-048`). 파일럿을 `AUTH_ENABLED=false`에서 `true`로 옮기는 업그레이드라면 이전 `.env`의 토큰을 비우고, 운영자에게 `./prsctl role grant`로 `operator`를 준다(6장).

**병합 상태 정정 (`CR-101`, 마이그레이션 032).** 032는 이미 저장된 PR 스냅숏에서 병합된 PR의 `state`를 `closed`에서 `merged`로 바로잡는다. Elasticsearch는 그 문서를 그대로 색인하므로 **`upgrade`가 끝난 뒤 운영 콘솔(`/ops`)에서 `prs-pull-requests`를 한 번 재색인한다.** 그 전까지는 Status=Merged·My merged PRs·PR 상세의 Merged 배지·M 번호 조회가 옛 문서를 보고 병합 PR을 놓친다. 재색인 뒤 들어오는 웹훅·백필 문서는 투영이 스스로 파생한다.

**GitHub 작업을 켠 배포 (`CR-090`).** 마이그레이션 030을 받은 뒤에는 **관리자의 최초 운영 승인이 있어야** GitHub 작업이 실행된다 — 업그레이드 직후의 실행 요청은 「관리자 운영 승인이 필요합니다」로 거절되며, 이전 판의 실행 허용을 승계하지 않는다. 7.C 4단계를 한다. 030은 GitHub 작업 경로에 한해 옛 코드와 호환되지 않는다(의도) — 옛 앱의 실행 요청과 실행권 확정은 가드가 거절한다. 검색·수집·M 번호 경로는 영향을 받지 않는다. 롤백 전에는 7.C 「롤백할 때」를 본다.

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

**복구는 파생 색인을 지우고 다시 만든다** (`DEV-511`·`DEV-519`). 재색인은 **전역 동시 실행 상한이 1**이므로 `restore`가 네 별칭을 **하나씩 끝까지** 돌린다 — 연달아 예약하면 첫 하나만 서고 나머지 셋이 거절되는데, 넷을 모두 지운 뒤라 그 셋이 **빈 채로 서비스된다.** 오래 걸리면 **`.env`의 `PRS_REINDEX_TIMEOUT_S`**(기본 3600초)를 늘린다 — 셸에 같은 이름을 `export`하면 그 값이 우선한다 (`DEV-520`). **끝나지 않은 별칭이 있으면 `restore`가 그 이름을 말하고 종료 코드 1을 낸다** — 절반만 선 상태를 완료로 보고하지 않는다. 복원한 정본보다 새로운 문서가 색인에 남아 있으면 검색이 **정본에 없는 것을 답한다** — 되돌린 데이터가 조회로 되살아나는 것이다. `restore`가 엔티티 색인을 삭제하고 매핑을 다시 적용한 뒤 전량 재색인을 예약하므로, **재색인이 끝날 때까지 검색 결과는 부분적이다.** 진행 상태는 운영 콘솔의 재색인 화면에서 본다.

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

**2.D가 정본이다** — 반입 절차의 일부이지 별개 작업이 아니다. `vendor/upstream`을 만들고 `company/main`을 그 위에 세우며, `git rev-parse vendor/upstream`이 manifest의 `upstream.commit`과 같은지 확인한다. 여기서는 그 다음 반입만 다룬다.

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

### 첫 반입(2026-09-07)이 만든 것 — 다음 반입이 다시 만들어 주지 않는다

**번들을 새로 풀면 전부 초기화된다.** 아래를 `company/main`에 얹어 두지 않으면 다음 반입이 같은 진단을 처음부터 반복한다. 시크릿 실값은 여기 적지 않는다 — 무엇을 채워야 하는지만 적는다.

| 무엇 | 등급 | 번들이 덮는가 | 비고 |
| --- | --- | --- | --- |
| `.env` | A | **아니다** — 애초에 번들에 없다 | 값 목록은 2.B. `WEB_PORT`·`AUTH_ENABLED`·`SESSION_COOKIE_SECURE`·`GHE_API_URL`·`NODE_EXTRA_CA_CERTS`·`ADMIN_DATABASE_URL`이 기본값과 달랐다 |
| `compose.yml`의 CA 마운트 | A | **덮는다** — 추적되는 파일이다 | 일곱 자리(anchor + 서비스 6). 6장 「anchor는 얕게 합쳐진다」. `prsctl load` 완료 후 `upgrade` 전에 재적용한다 — `load`가 내부에서 `verify`를 재실행하므로 그 전 수정은 checksum 불일치로 거부된다 (`DEV-571`) |
| `prs_retention` 롤 | — | 해당 없음(DB 상태) | **더 이상 형상이 아니다** (`DEV-556`). `install`·`upgrade`·`restore`가 `ADMIN_DATABASE_URL`을 읽어 만든다 — 그 값만 `.env`에 있으면 된다 |
| 웹훅 경유 경로 | B | 해당 없음(다른 저장소) | 어느 서비스의 어느 경로인지 적어 둔다. 2.C 「GHE가 서버에 닿지 못할 때」 |
| GHE 조직 웹훅 등록 | — | 해당 없음(GHE에 영속) | 서버를 다시 세워도 남는다. 주소가 바뀌면 그때 고친다 |

**C등급은 하나도 만들지 않았다.** 첫 반입에서 드러난 코드 결함 셋(`DEV-548`·`DEV-551`·`DEV-549`)은 사내에서 손대지 않고 upstream에서 고쳤다 — 그것이 이 표를 짧게 유지하는 방법이다. 사내에서 손으로 넘긴 임시 조치(웹 컨테이너 안의 스텁 모듈)는 `upgrade` 한 번에 사라지므로 **형상이 아니라 결함이다.**

---

## 6. 사내 환경 연동

### 사내 GHE 계정으로 로그인하기 (`AUTH_PROVIDER=github`, `CR-083`)

**별도 OIDC IdP가 없어도 로그인을 세울 수 있다.** 사내 GHE는 OIDC 디스커버리
엔드포인트를 제공하지 않으므로 표준 OIDC 경로로는 붙지 않는데, GHE가 직접
제공하는 OAuth2 흐름을 두 번째 공급자로 쓴다. Dex 같은 미들웨어를 따로 세우지
않아도 된다.

**기존 OIDC 배포는 아무것도 바꾸지 않아도 된다.** `AUTH_PROVIDER`를 주지 않으면
`oidc`이고 동작이 그대로다.

1. **GHE에 OAuth App을 새로 등록한다.** Settings → Developer settings → OAuth Apps.
   - Authorization callback URL: `<서비스 주소>/auth/callback`
   - **수집용 GitHub App(`GHE_APP_ID`)과 자격을 공유하지 않는다.** 하나가
     유출됐을 때 피해 범위가 달라진다 (`ADR-022`의 근거와 같다).
2. `.env`를 채운다.

   ```
   AUTH_PROVIDER=github
   GHE_OAUTH_CLIENT_ID=<Client ID>
   GHE_OAUTH_CLIENT_SECRET=<Client Secret>
   GHE_OAUTH_REDIRECT_URI=<서비스 주소>/auth/callback
   ```

   `GHE_BASE_URL`은 수집 경로가 쓰는 값을 그대로 쓴다. 새로 적지 않는다.
3. `./prsctl upgrade`로 컨테이너를 다시 만든다. `.env`만 고치면 반영되지 않는다.

#### 역할을 팀으로 부여하기

`GHE_TEAM_ROLE_MAP`에 `<org>/<team>:<역할>` 쌍을 쉼표로 잇는다.

```
GHE_TEAM_ROLE_MAP=cpswdev-team/pipe-admins:manager,cpswdev-team/pipe-users:qa
```

**부여할 수 있는 역할은 `manager`와 `qa` 둘뿐이다** (`CR-015`, `DEV-049`).
`release_manager`·`operator`·`security_officer`는 관리자가 `./prsctl role`로
직접 지정하며(아래), 여기 적으면 `web`이 기동하지 않는다. GHE 팀을 만들 수 있는
사람이 운영 권한을 발급하게 두지 않는다는 계약이고, 그것은 IdP 그룹에 세운
제약과 같다.

매핑을 비워 두면 로그인한 사용자는 전부 `developer`를 받는다. **그것으로 조회는
성립한다** — 무엇이 보이는지는 역할이 아니라 GHE 저장소 권한이 정한다
(`FR-AUTH-002`).

#### 운영 역할 지정하기 (`prsctl role`, `CR-091`)

저장소 등록·백필·재색인 같은 운영 콘솔(`/ops/*`)과 GitHub 작업의 운영 승인은
`operator`가 한다. **세션 인증을 켠 배포에서 그 역할을 얻는 방법은 이것 하나다** —
팀 매핑으로는 줄 수 없고, 관리 토큰(`ADMIN_API_TOKENS`)은 인증을 켜면 쓸 수 없다(`DEV-048`).

1. 역할을 받을 사람이 **먼저 한 번 로그인한다.** 로그인해야 PR Search가 그 사람의
   GHE 숫자 id를 알고 정본에 행이 생긴다. 이 명령은 **스택이 가동 중일 때** 돌린다 —
   search-api 이미지로 한 번 실행하되 PostgreSQL을 따로 세우지 않는다.
2. 서버에서 지정한다.

   ```bash
   ./prsctl role grant <GHE 로그인> operator     # 지정 (user_id도 된다: github:12345)
   ./prsctl role list                             # 지정 역할을 가진 사람
   ./prsctl role revoke <GHE 로그인> operator    # 회수
   ```

3. 그 사람이 화면을 **새로 고친다.** 다시 로그인할 필요가 없다 — 역할은 요청마다
   정본에서 다시 읽는다. 회수도 다음 요청부터 반영된다.

지정할 수 있는 역할은 `operator`·`release_manager`·`security_officer` 셋이다.
`manager`·`qa`는 위의 팀 매핑으로 준다. 지정·회수는 감사 기록(A-004)에
`user_role.grant`·`user_role.revoke`로 남고, 행위 주체는 `prsctl`을 실행한
**호스트 사용자**(`prsctl:<사용자>`, `sudo`로 돌렸으면 sudo를 부른 사람)다. 이미
가진 역할을 다시 지정하면 아무것도 바뀌지 않고 기록도 남지 않는다.

`<GHE 로그인>`은 표시 이름이 아니라 GHE 로그인 이름이다. 대소문자는 달라도
찾지만, 대소문자만 다른 사용자가 둘 이상이면(개명 흔적) **고르지 않고** 후보의
`user_id`와 마지막 접속을 보여 주며 멈춘다. 지금 쓰는 신원의 `user_id`로 다시 실행한다.

#### 스코프

비워 두면 `read:user read:org`다. 그것이 최소 권한이며 `/user`와 `/user/teams`를
읽는 데 필요한 전부다. **저장소 내용을 읽는 스코프는 요구하지 않는다** — 수집은
별도 App 자격으로 하고 이 토큰은 신원 확인에만 쓰인다.

#### 운영에는 TLS가 필요하다 — TLS 없는 파일럿은 명시 플래그로만 (`CR-091`)

세션 쿠키 계약(`FR-AUTH-001` AC-2)은 공급자와 무관하다. **운영 배포는 TLS를 앞에
세우고 `SESSION_COOKIE_SECURE=true`(기본값)로 둔다.** 평문 HTTP에서는 세션 쿠키를
같은 망의 누구든 가로챌 수 있다.

TLS를 아직 세우지 못한 **파일럿에서 로그인까지 시험해야 한다면** `.env`에 두 값을
**함께** 적는다. 하나만 적으면 `web`이 기동하지 않는다.

```
AUTH_ENABLED=true
SESSION_COOKIE_SECURE=false
ALLOW_INSECURE_COOKIES=true
GHE_OAUTH_REDIRECT_URI=http://<서비스 주소>/auth/callback
```

- 그 형상의 `web`은 기동할 때마다 로그에 경고를 남기고, `./prsctl health`도 「평문
  HTTP 세션 허용」 경고 줄을 낸다. 실패가 아니라 받아들인 위험을 알리는 줄이다.
- 브라우저에 가는 쿠키 이름이 `prs_session`·`prs_oidc`로 바뀐다. `Secure`가 없는
  `__Host-` 쿠키는 브라우저가 저장하지 않기 때문이다. TLS로 옮기면 원래 이름으로
  돌아가므로 사용자는 한 번 다시 로그인한다.
- GHE에 등록한 OAuth App의 callback URL도 `http://`로 맞춘다. 문자 그대로 같아야 한다.
- **TLS를 붙이는 날** `SESSION_COOKIE_SECURE=true`로 되돌리고 `ALLOW_INSECURE_COOKIES`를
  지운 뒤 `./prsctl upgrade`를 돌린다.

로그인 없이 화면만 띄워 보려면 지금처럼 `AUTH_ENABLED=false`로 둔다. 그 형상에서
조회는 전부 401이다 (7장).

#### 역방향 프록시(nginx) 뒤에서 — 외부 주소를 따로 적지 않는다 (`CR-092`)

로그인·GitHub 계정 연결이 끝난 뒤 돌아가는 주소는 **경로만** 보낸다(`Location: /search?…`).
브라우저가 자기가 연 주소를 기준으로 풀기 때문에 서비스는 자기 외부 이름을 몰라도 된다.
`WEB_EXTERNAL_URL` 같은 값은 없고 필요하지 않다.

- `0.1.0-pilot.7`까지는 절대 주소를 만들었고, `next start`가 그 주소를 **자기가 들은
  `localhost:3000`**으로 조립해 GHE 로그인 뒤 `https://localhost:3000/…`으로 떨어졌다(`DEV-699`).
  nginx에서 `Host`를 넘겨도 바뀌지 않았다 — 고친 버전은 프록시 설정을 요구하지 않는다.
- `Host`·`X-Forwarded-Host`를 믿어 주소를 만들지 않는다. 그 헤더를 고른 누구든 리다이렉트
  목적지를 고르게 되기 때문이다.
- GHE OAuth App의 callback URL(`GHE_OAUTH_REDIRECT_URI`)은 여전히 **브라우저가 여는 외부 주소**로 적는다.

#### 로그아웃 (`CR-092`)

화면 오른쪽 위의 **로그인 이름을 누르면** 사용자 메뉴가 열리고 그 안에 「로그아웃」이 있다.
누르면 PR Search 세션이 서버에서 끝나고 「로그아웃했습니다」 화면(`/auth/signed-out`)이 나온다.

- **GHE(또는 IdP) 로그인은 끝나지 않는다.** 「다시 로그인」을 누르면 GHE가 묻지 않고 곧바로
  돌려보낼 수 있다. 공용 PC라면 GHE에서도 로그아웃한다.
- 주소창에 `/auth/logout`을 치면 405다 — 로그아웃은 `POST`만 받는다(다른 사이트가 링크 하나로
  사용자를 로그아웃시키지 못하게). 스크립트에서 `POST /auth/logout`을 부르면 지금처럼 JSON `{"ok":true}`다.

### 사설 CA

**코드 변경이 필요 없다.** Node 런타임이 `NODE_EXTRA_CA_CERTS`를 직접 읽는다.

1. CA 인증서를 호스트에 둔다.
2. `compose.yml`의 해당 서비스에 그 파일을 읽기 전용으로 마운트한다.
3. `.env`의 `NODE_EXTRA_CA_CERTS`에 **컨테이너 안 경로**를 적는다.
4. `.env`의 `GIT_SSL_CAINFO`에 **같은 경로**를 적는다.

**`git` 서브프로세스는 `NODE_EXTRA_CA_CERTS`를 보지 않는다** (`DEV-561`).
미러 초기화(`JOB-MIR-001`)와 미러 fetch는 `git`을 직접 부르므로 CA 경로를
`GIT_SSL_CAINFO`로 따로 받아야 한다. 4단계를 빠뜨리면 **Node로 나가는 호출은
전부 성립하는데 미러만 `SSL certificate problem`으로 실패한다** — 다른 서비스가
정상이라 원인이 CA로 보이지 않는 것이 이 결함의 대가였다. 두 변수에 다른 값을
주지 않는다.

#### 2단계의 함정 — anchor는 얕게 합쳐진다

**`x-worker-base`에만 마운트하면 워커 셋이 빠진다** (`DEV-552`). YAML의 병합 키는
같은 이름의 키를 **통째로 덮어쓴다.** `worker-sequence`·`worker-mirror`·`worker-release`는
자기 `volumes`로 미러 볼륨을 마운트하므로, anchor의 `volumes`가 그 셋에는 닿지 않는다.
나머지 워커 여섯은 자기 `volumes`가 없어 anchor의 것을 그대로 받는다.

그래서 CA를 거는 자리는 **일곱 곳**이다. GHE로 나가는 여섯 자리와, 전역
`NODE_EXTRA_CA_CERTS`가 가리키는 파일 부재 경고를 없애기 위한 `ingest-gateway` 한 자리다.

| 자리 | 왜 |
| --- | --- |
| `x-worker-base` | `worker-enrich`·`project`·`link`·`reconcile`·`batch`·`authz` 여섯이 이것을 받는다 |
| `worker-sequence` · `worker-mirror` · `worker-release` | 자기 `volumes`가 anchor의 것을 덮는다 — **개별로 더한다** |
| `web` · `search-api` | 워커가 아니라 anchor를 받지 않는다 |
| `ingest-gateway` | GHE로 나가지 않아 TLS는 필요 없지만, `NODE_EXTRA_CA_CERTS`가 전역이라 **없는 파일을 가리키면 기동 로그에 경고가 남는다.** 경고를 없애려면 함께 건다 |
| `gh-executor` (7.C로 켰을 때만) | GHE로 나가는 것은 Node가 아니라 **gh(Go)**다. gh는 `NODE_EXTRA_CA_CERTS`를 읽지 않으므로 compose가 같은 값을 `GH_EXECUTOR_CA_FILE`로 배선해 실행 환경의 `SSL_CERT_FILE`로 넘긴다 — 마운트만 같은 경로로 더하면 된다. 꺼진 형상에는 컨테이너가 없다 |

**건 뒤에 실제로 있는지 확인한다.** 마운트를 빠뜨려도 컨테이너는 뜨고, 그 역할이
GHE로 나가는 첫 순간에야 인증서 오류로 드러난다.

```bash
for s in web search-api ingest-gateway \
         worker-enrich worker-project worker-link worker-reconcile worker-batch worker-authz \
         worker-sequence worker-mirror worker-release; do
  printf '%-18s ' "$s"
  docker compose exec -T "$s" sh -lc 'test -r "$NODE_EXTRA_CA_CERTS" && echo ok || echo MISSING' 2>/dev/null \
    || echo '(기동하지 않음)'
done
```

**이 수정은 `compose.yml`을 고치는 것이고 그 파일은 번들에 들어 있다.** 다음 반입이
새 번들로 덮으면 사라지므로, 5장의 다운스트림 형상(`company/main`)에 **A등급(설정)** 으로
남긴다.

### HTTP(S) 프록시 — 아직 지원하지 않는다

**비대칭이 있다.** `git`은 `http_proxy`/`https_proxy` 환경 변수를 받지만, **Node 22의 `fetch`(undici)는 그것을 보지 않는다.** GHE REST 호출과 OIDC 호출이 프록시를 거치지 않는다.

사내망이 프록시를 강제한다면 그 사실을 먼저 확인한 뒤 `GitHubTransport`의 `fetchImpl` 주입 지점으로 최소 수정한다. **추측으로 설정 표면을 만들어 두지 않았다** (`DEV-494`).

### github.com 접근 — 번들을 받는 단계만

**서비스는 github.com에 나가지 않는다.** 나가는 것은 2.B 1단계의 `gh`·curl뿐이며, 둘은 `HTTPS_PROXY`를 읽고 호스트의 시스템 CA 저장소를 쓴다 — 사설 CA를 끼우는 프록시라면 그 CA를 시스템 CA 저장소에 등록한다(`NODE_EXTRA_CA_CERTS`는 서비스용이며 여기에 쓰이지 않는다). 받는 위치가 호스트가 아니어도 된다 — 닿는 사내 위치에서 받아 호스트로 옮기고, 1단계의 digest 대조는 호스트에서 한다.

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
| 운반 아카이브 생성 → 별도 디렉터리에 풀기 → 그 사본에서 `verify` (WP-071) | `VERIFIED (external)` |
| `.env` 없이 `load` → **이미지 저장소를 바꾸기 전에** 멈춤 · `.env` 뒤 `load` 통과 (WP-071) | `VERIFIED (external)` |
| 풀린 번들의 git bundle → `vendor/upstream`이 manifest의 `upstream.commit`과 일치 (WP-071) | `VERIFIED (external)` |
| `--release` 발행(초안 → 자산 → **발행 전 대조** → 발행 → 발행 확인) · 초안 자산의 이름·크기·digest·`state`를 로컬과 대조하고 어긋나면 **발행하지 않는다** · 같은 버전·초안 잔재는 빌드 전에 거부 (WP-072 / DEV-544) | `VERIFIED (external)` — 시험 릴리스 둘, 검증 뒤 삭제. 발행 전 대조와 발행 후 불가역은 `regression/release-tag-ownership.test.ts`(C7~C11)가 실제 스크립트를 돌려 검증한다 |
| 토큰만 있는 환경에서 `gh release download` → `sha256sum` == 자산 digest == 전달받은 SHA-256 → 별도 디렉터리에 풀어 `verify`·`load`·`lineage`·`git fetch` (WP-072) | `VERIFIED (external)` — 시험 릴리스 둘 |
| `0.1.0-pilot.3` 사내 서버 업그레이드 | `VERIFIED (internal)` (2026-09-09) — `load` 뒤 CA 마운트 일곱 자리를 재적용해야 함을 확인했다 (`DEV-571`) |
| 사내 위치에서 github.com 도달 | **`FAILED — 서버에서는 닿지 않는다`** (2026-09-07). 결정자의 2026-09-02 확인은 **담당자 위치** 기준이었고 운영 서버는 아웃바운드가 막혀 있었다. 담당자 위치에서 받아 서버로 옮기는 2.A의 반입 채널 경로로 성립시켰으며, 대조는 옮긴 뒤 서버에서 다시 했다 |
| 실제 사내 GHE App·웹훅·저장소 권한 | **`VERIFIED (internal)`** (2026-09-07) — 저장소 셋 등록·백필 완료, 웹훅 수신과 증분 색인까지 성립. **웹훅은 경유 경로다** (2.C 「GHE가 서버에 닿지 못할 때」). 그 과정에서 `DEV-549`·`DEV-550`·`DEV-553`이 드러났다 |
| 실제 사내 OIDC와 그룹 클레임 | `NOT RUN — internal environment required` — 첫 반입은 `AUTH_ENABLED=false`에 관리 토큰만으로 섰다. 그 형상에서 **`/search`는 비활성이다**(세션 인증 뒤에 있다). 둘은 함께 구성할 수 없다(`DEV-048`) |
| 사내 CA·프록시·DNS·레지스트리·보안 스캔 | **CA는 `VERIFIED (internal)`** (2026-09-07) — compose 여섯 자리에 걸어 GHE TLS가 섰다(`DEV-552`). **프록시는 여전히 미지원**이며(`DEV-494`) 호스트에 강제된 프록시가 진단용 `curl`까지 경유시킨다. DNS·레지스트리·보안 스캔은 `NOT RUN` |
| 실서버 성능·실데이터 규모·실제 롤백 소요 | **실데이터 규모는 잡혔다** (2026-09-07) — 저장소 셋의 PR 2,831건과 커밋을 색인했다. **성능 목표(`NFR-001` 등)와 롤백 10분은 여전히 `NOT RUN`** — 재지 않았다 |
| `ACC-06` 관계 정확도 표본 검수 | `NOT RUN` — **합성 데이터로 만들어 내지 않는다.** `W-007`은 계속 비활성이다 |
| M 번호 채번 (WP-074) — squash 이력에서 PR당 번호 하나, git first-parent 대조, 늦은 정보 도착 뒤 새 push 없는 재개, 에폭 재채번 | `VERIFIED (external)` — 실제 git 픽스처와 실제 PostgreSQL |
| 채번 전 미러 fetch (`DEV-576`) — 수정 전 "옛 head를 읽고 새 커밋 없음" 재현과 수정 후 | `VERIFIED (external)` |
| **직접 푸시의 영구 부재 확정** (`DEV-581`) → 운영자 확인서 (`CR-100`, 7.D) | **`VERIFIED (external)`** — 확인서로 지나가는 경로·유예·범위·철회·확정 근거 보존을 격리 DB 통합 시험 11건과 변이 2건으로 확인했다(원장 6.94장). 사내 실데이터 적용은 `NOT RUN — internal environment required` — 7.D 절차로 사내에서 실행한다. 이전 기록: **`NOT RUN — 근거 미확보`** — 공식 GHE 읽기 계약에 완결 증서가 없다. production 판정기는 그 상태를 `negative_evidence_unavailable`로 남기며, 그 결과 **첫 미확정 항목 뒤의 PR이 전부 대기할 수 있다.** 격리 시험이 direct 분기를 통과한 것은 이 조건을 닫지 않는다 |
| 실제 사내 GHE에서의 M 채번·지연 (`measure:sequence-latency`) | `NOT RUN — internal environment required` — 아래 7.A 절차로 사내에서 잰다 |

**외부에서 증명할 수 없는 것을 통과로 적지 않는다.** 사내 반입 뒤 이 표의 아래쪽을 실제로 실행하고 그 결과를 기록한다.

**첫 반입(2026-09-07)이 이 표의 아래쪽을 실제로 실행했다.** 실행 기록의 정본은 원장 6.70장이며, 그때 드러난 결함 여섯(`DEV-548`~`DEV-553`)은 5장 DEV 표에 있다. **여기 남은 `NOT RUN`은 그날 실행하지 못한 것들이다** — 하지 않은 것을 했다고 적지 않는다.

### 7.A M 번호 지연 측정 (WP-074 / FR-SEQ-008 AC-14)

**읽기 전용 도구다.** 운영 DB에 쓰지 않고 PR을 만들거나 머지하지도 않는다. 모든
트랜잭션이 `READ ONLY`이며 DSN·세션·헤더·원본 payload를 출력하지 않는다.

1. **버전을 확인한다.** `./prsctl status`의 `PRS_VERSION`과 마이그레이션 번호를 본다.
   025 이전(=pilot.4 이하)에서는 `baseline`만 가능하며 "M 표가 없다"는 출력이 정상이다.

2. **읽기 전용 DB 계정을 준비한다.** 기존 절차로 만들고 아래 권한만 준다.

   ```sql
   GRANT SELECT ON merge_sequence, sequence_space, sequence_latency_sample TO <계정>;
   ```

3. **도구를 실행한다.** 워커 이미지 안에서 pnpm 없이 돈다.

   ```bash
   docker compose run --rm --no-deps \
     -e MEASURE_DATABASE_URL='postgresql://<계정>:<비밀번호>@postgres:5432/prs' \
     worker-sequence node dist/measure-cli.js baseline --window 7d --format json
   ```

   종료 코드는 `0` 정상 · `1` 조회·권한 실패 · `2` 잘못된 인자 · `3` 자료 부족·부분·
   시계 이상이다. **`3`이 서비스 실패를 뜻하지 않는다** — `notes`와 `capability`를 읽는다.

4. **한 PR을 관측한다** (`MNUMBER_ENABLED=true`인 형상에서). 이미 승인된 소규모 시험
   저장소에서 **평소 절차로** squash PR 하나를 머지한 뒤:

   ```bash
   docker compose run --rm --no-deps \
     -e MEASURE_DATABASE_URL=... -e MEASURE_API_BASE_URL=http://search-api:3002 \
     -e MEASURE_SESSION_FILE=/run/secrets/prs-measure-session \
     worker-sequence node dist/measure-cli.js watch \
       --repository <owner/name> --base-branch main --pr-number <n> --timeout 120s --format json
   ```

   세션 파일은 **정상 로그인으로 얻은 읽기 세션**의 cookie 헤더 한 줄이며 `chmod 600`이다.
   이 도구는 새 로그인이나 쓰기 토큰을 발급하지 않는다.

5. **M이 보이지 않으면** 순서대로 확인한다: 원본 수신(`raw_event`) → refresh 의도
   (`sequence_work` kind=refresh) → fetch 결과 → `merge_seq` → 근거·blocker
   (`mnumber_evidence`, `sequence_space.mnumber_blocked_reason`) → `merge_number` →
   materialize work → 검색 가시성 → API·화면. `SEQUENCE_GRAPH_MODE=api`인 형상에서
   미러 구간이 `unavailable`인 것은 오류가 아니다.

6. **보고는 비식별로 한다.** 릴리스·커밋·스키마·코호트·창·건수·백분위수·대기 사유만
   전달한다. 기본 출력이 이미 저장소 이름과 PR 번호를 빼고 라벨로 치환한다.

**`6시간 스윕`은 코드의 보정 주기이지 운영 지연 상한이 아니다.** 다음 push가 없거나
후속 단계가 멈췄으면 그보다 길 수 있다. 보고서에 "최대 6시간 보장"을 쓰지 않는다.

### 7.B PR 제목에 M 넘버를 표기하기 (WP-075 / FR-SEQ-009)

**이 기능만 GHE를 고친다.** 켜면 채번이 끝난 PR의 제목이 `[M-1900-1] <원래 제목>`이
된다. 원래 제목은 한 글자도 바뀌지 않고 접두만 앞에 붙는다. 다른 M 넘버 접두가 이미
있으면 **덮어쓰지 않고** 불일치로 기록한다.

**켜기 전에 알린다.** 제목 변경은 GHE의 PR 목록·알림·빌드 로그에 그대로 나가며, 이미
다른 문서에 인용된 제목이 있으면 그 인용과 달라진다. 되돌리는 자동 경로는 없다
(`ADR-022` Follow-up).

0. **먼저 무엇이 바뀌는지 읽기 전용으로 본다.** 아무것도 쓰지 않는 명령이다.

   ```bash
   docker compose run --rm --no-deps worker-annotate \
     node dist/annotate-preview-cli.js --repository <org>/<저장소>
   ```

   「다음 회차 대상」이 **켰을 때 제목이 바뀔 수 있는 건수**다. 그 수가 예상보다 크면
   멈추고 이유를 먼저 찾는다. 「확인하지 못한 것」 목록도 함께 읽는다 — 쓰기 권한은
   실제로 써 보기 전까지 확인할 수 없으므로 **이 출력은 「준비 완료」를 뜻하지 않는다.**
   확정된 M 번호가 0이면 채번(`FR-SEQ-008`)이 먼저 성립해야 한다.

1. **표기 전용 GitHub App을 새로 등록한다.** 수집용 App(`GHE_APP_ID`)과 **자격을
   공유하지 않는다.** 권한은 **`Pull requests: write` 하나**이며 공식 문서가 제목 갱신
   엔드포인트에 요구하는 권한이 그것뿐이다. 표기할 저장소에만 설치한다.

   설치 후 설치 ID를 확인한다 — 수집용 App의 설치 ID와 **다른 값이다.**

2. **`.env`에 값을 채운다.**

   ```
   MNUMBER_ANNOTATE_ENABLED=true
   GHE_ANNOTATE_APP_ID=<표기 전용 App ID>
   GHE_ANNOTATE_PRIVATE_KEY=<PEM, 개행은 \n으로 이스케이프>
   GHE_ANNOTATE_INSTALLATIONS=<org>:<설치 ID>
   ```

   **켜 놓고 자격이 비어 있으면 `worker-annotate`가 기동하지 않는다.** 의도된 거부이며
   `docker logs` 한 줄에 어느 키가 없는지 남는다.

3. **`./prsctl upgrade`를 돌린다.** `.env`만 고치면 컨테이너에 반영되지 않는다.

4. **먼저 한 저장소에서만 켠다.** 표기 대상은 저장소별로 끌 수 있다. 운영 콘솔의 저장소
   설정에서 `annotate_enabled`를 끄면 그 저장소는 **채번은 계속하고 표기만 멈춘다.**
   넓게 열기 전에 한 저장소에서 제목이 기대대로 바뀌는지 확인한다.

5. **확인한다.**

   ```bash
   docker compose logs --tail 100 worker-annotate
   ```

   `표기를 시작한다`가 보이면 배선이 끝난 것이고, 표기가 일어나면 `GHE 표기 요청`이
   메서드·저장소·PR 번호·상태 코드와 함께 남는다. 지표는 `mnumber_annotate_total{result}`와
   `mnumber_annotate_mismatch_total`이다.

**무엇이 언제 일어나는가.** 채번이 끝나면 곧바로(이벤트) 표기하고, 놓친 것은 **일 1회**
잔여 스윕이 메운다. 그래서 이벤트가 유실되거나 쓰기 직후 프로세스가 죽어도 표기가 영영
빠지지는 않되, 그 복구는 최대 하루가 걸린다. 급하면
`MNUMBER_ANNOTATE_SWEEP_MS`를 줄인다.

**권한 오류를 만나면 그 저장소의 표기를 스스로 멈춘다.** 권한이 없는데 반복하면 GHE
한도만 태우기 때문이다. 이 차단은 **운영자가 적어 낸 `annotate_enabled`를 바꾸지
않는다** — 둘은 다른 사실이고 `repository` 표의 다른 열이다. 권한을 고친 뒤에는
쿨다운(기본 하루, `MNUMBER_ANNOTATE_BLOCK_COOLDOWN_MS`)이 지나면 스윕이 자동으로
다시 시도한다.

**다시 시도하는 것과 차단이 풀리는 것은 다르다** (`CR-085`). 차단은 **실제 쓰기가
성공할 때** 풀린다 — 제목을 읽는 데 성공한 것만으로는 풀지 않는다. 공식 API가 읽기와
쓰기를 다른 권한으로 나누므로 조회 200은 제목을 고칠 수 있다는 증거가 아니고, 그것으로
풀면 다음 회차가 다시 막는 순환이 생긴다. 기다리지 않고 바로 열려면 운영 API로
재개한다.

```bash
curl -X PATCH .../api/v1/admin/repositories/<id> -d '{"annotate_resume": true}'
```

응답의 `annotate_resumed`가 무엇이 열렸는지 말한다(`block_cleared`, `targets_reopened`).
**이미 붙은 제목을 되돌리지 않는다** — 여는 것은 다음 시도의 자격뿐이다.

**차단이 권한 때문이 아닐 수도 있다.** 공식 문서가 한도로 인한 `403`과 권한 거부
`403`을 가르는 방법을 보장하지 않아(`DEV-616`), 대기 신호가 없는 `403`은 권한으로
다룬다. GHE의 부 한도가 그 신호 없이 오면 멀쩡한 저장소가 쿨다운만큼 멈춘다.
그럴 때 최악 지연은 쿨다운 값과 같으므로, 표기를 처음 켜는 동안에는
`MNUMBER_ANNOTATE_BLOCK_COOLDOWN_MS`를 짧게(예: `3600000`, 한 시간) 두었다가
안정되면 기본값으로 돌리는 편이 낫다. `repository.annotate_blocked_reason`에 남은
GHE 응답 문구가 두 경우를 가르는 실마리다.

**제목이 기대와 다르게 저장되면 그 PR의 표기가 멈춘다** (`CR-085` / `AC-9`). GHE가
저장한 제목이 보낸 값과 다르면(뒤 공백을 다듬은 것 외의 차이) 그 행은 `body_changed`로
남고 **자동으로 다시 쓰지 않는다** — 다시 쓰면 이미 바뀐 원래 제목을 한 번 더 덮는다.
로그에 `title_body_changed`와 보낸 길이·저장된 길이가 남으므로 그것으로 무슨 일이
있었는지 본다. 확인한 뒤 다시 하려면 위의 `annotate_resume`을 쓴다.

**응답을 받지 못한 요청은 「실패」가 아니라 「모른다」로 남는다**(`unknown`, `AC-10`).
공식 API가 멱등성 키나 요청 조회를 주지 않아 서버가 처리했는지 확정할 수 없기
때문이다. 다음 회차가 제목을 다시 읽어 확인하며, 이미 붙어 있으면 요청 없이 끝난다.

**표기 워커는 하나만 뜬다** (`DEV-629`). `replica`를 올려도 같은 데이터베이스를 보는
프로세스 중 하나만 쓰기를 하고 나머지는 표기 회차를 건너뛴다. 이것은 성능 조정이 아니라
정확성 조건이며, 값을 올려도 처리량이 늘지 않는다.

**끄는 방법은 둘이다.** 전체를 멈추려면 `.env`의 `MNUMBER_ANNOTATE_ENABLED=false`로
되돌리고 `./prsctl upgrade`를, 한 저장소만 멈추려면 그 저장소의 `annotate_enabled`를
끈다. 어느 쪽도 이미 붙은 접두를 지우지 않는다 — 지우려면 사람이 PR 제목을 직접 고친다.


### 7.C GitHub 작업(Operations App)을 켜기 (WP-077 / FR-GH-008 · FR-GH-012, `CR-086` · 운영 승인 WP-080 / FR-GH-011, `CR-090`)

**기본은 꺼짐이다.** 반입한 형상은 GitHub 작업 화면을 열지 않는다 — `/gh`에 들어가면 「이 배포에서는 GitHub 작업이 열리지 않았습니다」가 보이고 검색·조사 화면은 그대로다. 켜면 사용자가 자신의 GitHub 계정을 **위임**해 `gh pr list`를 격리된 실행기에서 돌리고 결과와 자기 이력을 본다. 이 판이 여는 명령은 그것 하나이며 **읽기 전용**이다 — 7.B와 달리 GHE를 고치지 않는다.

**자격은 넷째다.** 수집용 Data App(2장) · 로그인용 OAuth App(6장) · 표기용 App(7.B) · **Operations App**(여기). 서로 공유하지 않는다. 실행 권한은 이 App의 권한과 사용자 GitHub 권한의 **교집합**이며, 사용자가 화면에서 직접 인가해야 실행이 시작된다 — 설치 권한으로 대신하지 않는다.

1. **Operations App을 GHE에 GitHub App으로 등록한다.** 권한은 `Pull requests: Read` 하나. **Callback URL**은 `https://<서비스 주소>/gh/identity/callback`. 「Expire user authorization tokens」를 **켠다**(액세스 토큰이 8시간 뒤 만료되고 실행 요청 시점에 갱신된다). Webhook은 끈다. Client ID와 Client secret을 받아 둔다.
2. **`.env`에 값을 채운다.**

   ```
   GH_OPERATIONS_ENABLED=true
   GHE_OPS_CLIENT_ID=<App의 Client ID>
   GHE_OPS_CLIENT_SECRET=<Client secret>
   GHE_OPS_REDIRECT_URI=https://<서비스 주소>/gh/identity/callback
   GH_IDENTITY_VAULT_KEY=<openssl rand -hex 32 의 출력>
   GH_EXECUTOR_MAX_CONCURRENT=2
   ```

   봉인 키는 한 번 만들면 바꾸지 않는다 — 바꾸면 기존 봉인을 풀 수 없어 모든 사용자가 다시 연결해야 한다. `GHE_OPS_REDIRECT_URI`는 App에 등록한 값과 **문자 그대로** 같아야 한다. 사설 CA를 쓰면 6장의 CA 파일을 `gh-executor`에도 같은 경로로 마운트한다(6장 표).
3. **`./prsctl upgrade`를 돌린다.** `prsctl`이 `.env`의 `GH_OPERATIONS_ENABLED=true`를 읽어 `gh-executor` 프로파일(`github-operations`)을 함께 세운다. `prsctl`은 `.env`를 따로 해석하지 않고 compose가 렌더한 search-api의 값을 그대로 읽으므로, compose가 받아들이는 형태(따옴표·주석·`export`·공백)면 무엇이든 같은 답이다. `TRUE`·`yes`는 두 서비스가 거부하므로 `prsctl`도 거부한다(`DEV-664`). 켠 직후 `worker-batch`가 기동 첫 회차에서 `gh_execution`의 월 파티션을 만든다 — `./prsctl health`가 초록이 된 뒤에 4단계를 한다(`DEV-668`). `./prsctl health`가 `gh-executor /healthz … "execution":"enabled"`를 내야 한다. search-api만 켜지고 실행기가 없으면 요청이 영원히 `대기 중`이다 — `health`가 그 어긋남을 빨갛게 낸다.
4. **운영자가 현재 배포 정의를 운영 승인한다 (`CR-090`).** 마이그레이션 030부터 **`GH_OPERATIONS_ENABLED=true`만으로는 실행되지 않는다** — 운영자가 이 배포의 gh capability 정의를 승인하기 전의 실행 요청은 「관리자 운영 승인이 필요합니다」로 거절되고, 이전 판에서 열려 있던 실행도 승계하지 않는다.
   1. `./prsctl health`에서 `gh-executor /healthz`의 `registry.status`가 `passed`이고 `registry.lastPassedAt`이 방금 시각인지 본다 — 실행기 기동 검사가 끝나야 승인 근거가 생긴다. 처음 켤 때 한 번은 DB에서 `select has_schema_privilege('prs_app', 'public', 'CREATE')`가 `f`인지도 본다 — 운영 정책 함수가 기대는 권한 경계다(보안 10.6). PostgreSQL 15보다 오래된 판에서 만든 DB를 올렸거나 그런 덤프를 복원했다면 `t`일 수 있으며, 그때는 승인하기 전에 DB 관리자와 `public` 스키마의 `PUBLIC` CREATE 권한을 정리한다.
   2. `operator` 역할로 로그인해 좌측 「운영 › gh 레지스트리」(A-006)의 **운영 승인** 패널을 연다(역할은 6장 「운영 역할 지정하기」의 `./prsctl role grant`로 준다). 「현재 적재된 정의와 운영 승인된 정의」에서 gh 버전·manifest 판·해시를, 「최근 실행기 검사」에서 기록 번호·시각·상태 `passed`·보고서 판·근거 유효 기한을 확인한다. 「승인 자격」에 사유가 있으면 그것부터 해소한다(아래 증상 표).
   3. 「승인 미리보기」를 열어 적용 대상(이 배포 범위)·승인할 정의·근거 기록·게이트 결과·**실제로 열리는 기능(`gh pr list` 한 개)**·아직 허용되지 않는 기능·운영 영향을 읽고 사유를 적어 승인한다. 상태가 「현재 정의 운영 승인됨」이 되고 변경 이력에 revision이 남는다(감사 로그에는 `gh_registry.approve`).
   4. 운영 승인은 **이 배포 범위의 현재 R0 정의에 대한 DB 결정**이다 — 무엇을 설치하지 않고, 196개 명령을 열지 않으며, 사내 GHES 지원 확인을 대신하지 않는다. `security_officer`만 가진 사용자는 조회만 한다.
5. **한 사용자로 확인한다.** 로그인 → 좌측 「GitHub 작업」 → 「GitHub 계정 연결」 → GHE 인가 화면 → 돌아오면 「연결됨 @<login>」 → 저장소 선택 → 미리보기에 `gh pr list --repo <host>/<owner>/<repo> --state open --limit 30 --json …`이 보이면 「실행」 → 결과 표 → 「실행 이력」에 행이 남는다. 「같은 구성으로 다시 실행」은 새 미리보기를 만들 뿐 실행하지 않는다. 운영 승인 전이면 저장소를 고른 뒤 미리보기에 「관리자 운영 승인이 필요합니다」가 보이고 실행 버튼이 꺼진다.
6. **외부에서 못 본 것을 확인한다 (원장 6.83장·6.87장).** (a) 실제 GHE 인가 왕복이 성립하는가 (b) `gh pr list`가 GHES에 붙는가 — 실패하면 실행 패널의 「표준 오류」를 편다 (c) 사설 CA가 gh에 닿는가 (d) GHES의 user-to-server 토큰 만료 설정.

**끄는 방법.** `.env`의 `GH_OPERATIONS_ENABLED=false` → `./prsctl upgrade`. search-api가 `/gh/*`를 닫고(화면은 「열리지 않았다」로 돌아간다) 실행기 컨테이너가 사라진다. 마이그레이션 028은 되돌리지 않는다 — 실행 이력과 연결(봉인)은 남는다. 연결까지 지우려면 사용자가 화면에서 「연결 해제」를 하거나 운영자가 `github_identity_connection`·`gh_identity_secret`을 정리한다.

**차단·재개 (A-005, `CR-090`).** 장애 대응 등으로 `gh pr list` 실행을 멈추려면 `operator`가 「운영 › gh 실행 정책」(A-005)에서 사유와 함께 **차단**한다. 차단이 커밋된 뒤의 새 요청과 아직 실행권을 받지 않은 대기 요청은 실행되지 않는다(사용자에게는 「관리자가 이 명령의 실행을 차단했습니다」). **이미 실행 중인 작업은 취소되지 않는다** — 필요하면 실행 이력에서 취소한다. **재개**는 같은 화면에서 명시적으로만 하며, 차단 중에 닫힌 요청은 다시 실행되지 않는다(사용자가 새로 요청한다). 차단은 기능 스위치(`GH_OPERATIONS_ENABLED`)와 달리 화면과 실행기를 그대로 두고 그 명령의 새 실행권만 막는다. 시험할 때는 한 사용자·한 저장소로 차단 → 실행 요청 거절 확인 → 재개 → 새 요청 실행 순서로 본다.

**배포 정의가 바뀌면 다시 승인한다 (`CR-090`).** 새 번들로 업그레이드해 manifest나 gh가 바뀌면 이전 승인은 새 정의로 옮겨 가지 않는다 — A-006 상태가 「승인된 정의가 현재 정의와 다름 — 재승인 필요」가 되고 실행은 「관리자 운영 승인이 필요합니다」로 거절된다. 4단계를 새 정의로 다시 한다. 이전 스냅숏으로 자동으로 돌아가지도 않는다.

**운영 승인 철회와 장애 대응 (`CR-090`).** 「운영 승인」 패널의 **철회**는 새 요청과 대기 요청의 실행을 멈춘다. 이미 수행한 GHE 조회를 되돌리지 않는다. 정책 상태를 읽지 못하면(마이그레이션 030 미적용·DB 장애) 새 실행은 `GH_POLICY_UNAVAILABLE`로 거절되고 대기 요청은 닫히지 않고 남는다 — 복구 뒤 실행기의 잔여 스윕이 현재 정책으로 다시 판정한다. 검색·수집·M 번호는 영향을 받지 않는다. 승인을 우회하려고 DB를 직접 고치지 않는다(관측성 문서 `RB-25`·`RB-26`).

**롤백할 때 (`CR-090`).** 앱 이미지를 이전 판으로 되돌려도 030의 가드가 남아 옛 search-api의 실행 요청과 옛 실행기의 실행권 확정이 거절된다 — 실행이 조용히 다시 열리지 않는 대신 그 동안 GitHub 작업은 오류가 된다. 되돌리기 전에 `GH_OPERATIONS_ENABLED=false`로 끄는 것이 깨끗하다. **마이그레이션 030 자체를 내려야 한다면 반드시 먼저 끈다** — 030을 내리면 가드와 정책이 사라져 옛 앱의 실행이 다시 열린다. 내려도 스냅숏의 최초 승인 시각과 감사 행은 남고, 다시 올려도 승인은 되살아나지 않는다.

**증상과 확인.**

| 증상 | 확인 |
| --- | --- |
| `/gh`가 「열리지 않았다」를 낸다 | `.env`의 `GH_OPERATIONS_ENABLED`가 `true`인가, 그 뒤 `./prsctl upgrade`를 돌렸는가 |
| 실행이 `대기 중`에 머문다 | `./prsctl health` — 실행기가 서지 않았거나(`GH_OPERATIONS_ENABLED`가 한쪽만 켜짐), 실행기 로그의 `identity_unsealable`(두 서비스의 `GH_IDENTITY_VAULT_KEY`가 다르다) |
| 실행이 「관리자 운영 승인이 필요합니다」로 거절된다 (`GH_ADMIN_ACTION_REQUIRED`) | 업그레이드·첫 켜기·배포 정의 변경 뒤의 정상 동작이다 — 4단계. A-006 「운영 승인」 상태가 승인 없음·철회·「승인된 정의가 현재 정의와 다름」 중 무엇인지 본다 (`CR-090`) |
| 승인 버튼이 없거나 승인이 403이다 | 운영자(`operator`) 역할이 필요하다 — `security_officer`만으로는 조회만 한다 |
| 「승인 자격」에 사유가 나온다 | 사유 목록대로 본다. 실행기 검증 기록이 없거나 오래됐으면 실행기가 서 있는지와 `/healthz`의 `registry.lastPassedAt`을 본다. 「최근 검사가 통과가 아님」·「다른 manifest」·「재현되지 않음」이면 search-api와 gh-executor의 이미지 버전(`PRS_VERSION`)이 같은지 확인하고 실행기를 다시 기동한다 |
| 실행이 `GH_POLICY_UNAVAILABLE`(503)로 거절되고 A-005·A-006이 「읽지 못했다」를 낸다 | 마이그레이션 030 적용 여부(`prsctl migrate` 상태)와 DB 연결을 확인한다. 검색은 계속 동작한다 (`CR-090`) |
| A-005·A-006의 차단·재개·승인·철회가 「운영 정책 상태를 읽지 못했습니다」로 끝나는데 화면의 정책 조회는 된다 | 다른 정책 변경이 정책 잠금을 10초 넘게 쥔 경우다(응답의 `detail.reason`이 `policy_lock_timeout`). 롤백돼 적용된 것이 없고 감사도 남지 않는다 — 화면을 새로 고쳐 revision을 확인한 뒤 다시 제출한다. 반복되면 DB에 오래 열린 트랜잭션이 있는지 본다 (관측성 `RB-26`, `CR-090`) |
| 차단·승인이 「응답을 받지 못했습니다」로 끝나고 「다시 보내기」도 같다 | search-api는 이 오류를 로그로 남기지 않으므로 PostgreSQL 컨테이너 로그를 본다. `audit_record`에 맞는 파티션이 없다는 오류면 감사를 남기지 못해 변경도 커밋되지 않은 것이다(적용 감사는 변경과 같은 트랜잭션이다) — `select relname from pg_class where relname like 'audit_record_%'`로 이번 달 파티션을 확인하고, 없으면 파티션을 만드는 잡이 돌지 않은 것이므로 `worker-batch` 로그를 본다(아래 `store_failed` 항목과 같은 원인이다). 한 번 응답만 잃은 경우라면 「다시 보내기」가 같은 요청으로 결과를 확인한다 — 두 번 적용되지 않는다 (`CR-090`) |
| 실행이 「관리자가 이 명령의 실행을 차단했습니다」로 거절된다 | 「운영 › gh 실행 정책」(A-005)에서 차단 사유·변경자·revision을 보고, 필요하면 운영자가 재개한다 (`CR-090`) |
| 연결 직후 「GitHub 계정 연결에 실패했습니다」 | Callback URL이 App 등록값과 같은가, `GHE_OPS_REDIRECT_URI`가 그 값인가. 사유 코드는 search-api 로그(`Operations App 인가 콜백 실패`, `reason`)에만 있다 — 화면은 이유를 말하지 않는다 |
| 실행이 `gh_auth_required`로 실패한다 | 위임 토큰이 GHE에서 거부됐다 — App 권한(`Pull requests: Read`)과 사용자의 저장소 권한을 확인한다. 연결을 해제하고 다시 인가한다 |
| 실행이 `registry_stale`로 실패한다 | 둘 중 하나다. (1) search-api와 gh-executor의 이미지 버전이 다르다(manifest 해시·gh 버전 불일치) — 같은 `PRS_VERSION`으로 다시 세운다. (2) 실행기의 레지스트리 검사(JOB-GH-003, `CR-088`)가 드리프트·구조 실패를 확인해 실행을 거절하고 있다 — 웹의 「운영 › gh 레지스트리」(A-006)에서 실행기 마지막 검사의 결과와 diff를 보고, 실행기 로그의 `레지스트리 검사 실패`와 `/healthz`의 `registry.stale`을 확인한다. 검사는 기동 시와 하루에 한 번(`GH_EXECUTOR_REGISTRY_CHECK_MS`) 돈다 |
| A-006이 「검증 기록이 없습니다」를 낸다 | 실행기가 아직 기동 검사를 기록하지 않았거나(기동 뒤 10초 안팎), 실행기 없이 search-api만 켜져 있거나, **마이그레이션 029(`CR-090`부터는 030도)가 적용되지 않아 기록이 실패**하고 있다(실행기 로그 `기동 레지스트리 검사를 기록하지 못했다`, 지표 `gh_registry_check_total{result="record_failed"}`). 기록이 실패해도 드리프트 판정은 유지되어 실행이 거절될 수 있다. `./prsctl health`와 `prsctl migrate` 상태를 확인한다. 기록은 `gh_capability_verification`(append-only)에 남는다 |
| 드리프트 뒤 다시 검사하고 싶다 | 검사는 기동 시와 주기(`GH_EXECUTOR_REGISTRY_CHECK_MS`, 기본 1일)로만 돈다 — 손으로 부르는 API는 없다. 원인을 고친 뒤 실행기를 재기동하면 기동 검사가 다시 돈다(`./prsctl upgrade` 또는 `docker compose restart gh-executor`) |

**레지스트리 검사를 손으로 돌리기 (`CR-088`).** 반입 전이나 조사 중에 같은 검사를 CLI로 돌릴 수 있다 — 저장소에서 `pnpm --filter @prs/gh-cli build` 뒤 `pnpm gh:validate-capabilities`(커밋된 manifest의 구조·분류·커버리지·실행 범위; 미분류가 남으면 종료 1, `--diagnostic`이면 0), `GH_PINNED_BIN=<gh 2.97.0 경로> pnpm gh:diff-capabilities`(설치된 gh와 manifest의 차이), `pnpm gh:inventory`(인벤토리 JSON). `--report <파일>`로 기계 판독 보고서를 남긴다. CLI는 DB에 기록하지 않는다 — 기록은 실행기만 남긴다.

---

### 7.D M 번호 운영자 확인서 (WP-088 / FR-SEQ-008 AC-15, `CR-100`)

`MNUMBER_ENABLED=true`인 형상에서 `worker-sequence` 로그의 「M 채번 회차 완료」가
`blocked_reason: negative_evidence_unavailable`(PR 근거가 끝내 없는 커밋 — 직접 푸시
초기 커밋 등)이나 `unsupported_merge_profile`(부모가 둘 이상인 머지 커밋)에서 멈추면
**그것은 결함이 아니라 설계다.** 공식 GHE 읽기 계약에는 「이 커밋은 PR 머지가 아니다」를
확정하는 증서가 없어(`DEV-581`) 제품은 부재를 추정하지 않는다. 그 판단은 운영자가
**확인서**로 내린다 — 확인서는 행위자·사유·범위·유예와 함께 남고 감사 기록(A-004)에
`mnumber_attestation.create`·`revoke`로 기록된다.

1. 저장소 ID·브랜치·현재 에폭을 확인한다. 로그의 `repository_id`·`base_branch`·`seq_epoch`가
   그 값이다(운영 화면 저장소 상세에서도 본다).
2. 확인서를 만든다. **스택이 가동 중일 때** 돌린다 — pipeline-worker 이미지로 한 번 실행하고
   행위 주체는 `prsctl role`과 같이 호스트 사용자(`prsctl:<사용자>`)다.

   ```bash
   ./prsctl mnumber attest --repository-id 399 --base-branch main --seq-epoch 1 \
     --reason "squash-only 저장소. PR 없는 커밋은 직접 푸시다 (2026-09-17 운영 확인)"
   # 과거 이력만 덮으려면 --through-seq <서수>. 유예(기본 24시간)는 --grace-hours로 바꾼다 (0 = 즉시, 상한 720).
   ./prsctl mnumber list                                            # 활성 확인서 (--all: 철회된 것까지)
   ./prsctl mnumber revoke --id 1 --reason "범위를 다시 정한다"      # 철회 — 이미 지나간 항목과 번호는 그대로다
   ```

3. 채번 회차는 자동으로 요청된다. 로그에서 `attested`·`assigned`가 오르고 `blocked_reason`이
   사라지는지 본다. 유예가 남은 항목에서 멈추면 `attestation_grace_pending`으로 미뤄 두었다가
   유예가 끝나는 시각에 스스로 다시 돈다.

규칙:

- 확인서는 (저장소, 브랜치, 에폭)마다 하나다. 에폭이 오르면(force-push) 효력이 없고 새 확인서가
  필요하다. 범위나 유예를 바꾸려면 철회하고 다시 만든다 — 이력이 남는다.
- 확인서는 `negative_evidence_unavailable`·`unsupported_merge_profile`만 덮는다. `fetch_failed`·
  `partial_lookup`·`pr_evidence_pending`·`mapping_conflict`·`canonical_mismatch`는 덮지 않는다 —
  그것은 「없다」가 아니라 「모른다」거나 「어긋난다」이므로 원인을 본다.
- 유예는 항목이 브랜치에 오른 시각(`committed_at`)부터 센다. 과거 이력은 첫 회차에 한 번에
  지나가고, 방금 올라온 커밋은 유예가 지난 뒤 다시 본다. 그 사이에 PR 정보가 오면 PR로
  확정된다 — 유예는 늦게 도착하는 PR 정보가 먼저 확정될 기회다.
- 확인서로 지나간 항목에 나중에 PR이 확인되어도 번호는 옮기지 않는다(AC-3). 그 PR은 이
  에폭에서 M 번호를 받지 않으며(`DEV-717`), 바로잡아야 하면 에폭 재채번이다.
- `mnumber_evidence`에 SQL로 근거를 넣는 임시 조치는 더 이상 필요 없고, 하지 않는다. 이미
  손으로 넣은 `direct_confirmed` 행은 그대로 유효하며 워커가 덮지 않는다(`DEV-715`).

### 7.E 머지 시퀀스 색인 재투영 (WP-098 / FR-SEQ-001 AC-7·AC-8, `CR-113`, RB-27)

검색 화면의 「M number」 정렬은 Elasticsearch 문서의 `merge_seq` 정렬이다. PostgreSQL에 서수가
확정돼 있어도 문서에 그 값이 없으면(늦게 도착한 PR 문서, 나중에 채워진 `merge_commit_sha`,
채번 뒤에 만들어진 직접 푸시 커밋 문서, 색인 쓰기 실패, 재색인 직후) 그 문서는 목록 뒤로 밀리고
`seq:` 범위에서 빠진다 — `0.1.0-pilot.17` 사내 보고의 모양이다. `CR-113`부터는 다음이 자동으로
돈다: 채번·재채번·복구 트랜잭션이 남긴 durable 투영 작업(`sequence_work` `project`)이 새 push
없이 정본을 문서에 다시 비추고, 늦은 PR 스냅숏·커밋 문서 생성이 문서 단위 작업을 남기며, 재색인이
PR·커밋 재구축 뒤 replay와 전환 전 검증을 거친다. `MNUMBER_ENABLED`와 무관하다. 아래는 **자동으로
수렴하지 않는 것처럼 보일 때** 운영자가 밟는 순서다.

**재투영은 재채번이 아니다.** 아래 어떤 단계도 `merge_seq`·M 번호·`seq_epoch`·head를 바꾸지
않는다. 색인 값이나 `M-…` 표시 문자열에서 번호를 추정하지 않으며, 옛 `update_by_query` 임시
조치(사내 보고의 「수동 복구」)는 더 이상 쓰지 않는다 — 문서별 판정 없이 덮어쓰기 때문이다.

1. **어느 형상이 떠 있는가.** `./prsctl lineage`로 배포 SHA를 읽고 이 절이 있는 판(`CR-113`
   이후)인지 확인한다. 이전 판이면 아래 명령이 없다 — 업그레이드가 먼저다. 별칭·인덱스는
   운영 화면 `/ops/jobs`의 Index status 또는 `GET /api/v1/admin/reindex`로 본다(`smoke`가
   같은 경로를 친다).
2. **공간 상태를 읽는다.** 저장소·브랜치의 현재 에폭·head와 이 에폭의 `project` 작업 상태를
   본다. `retry`·`parked`가 남아 있으면 `last_reason`이 이유다.

   ```bash
   ./prsctl sequence status --repository acme/payments --base-branch main
   ```

3. **dry-run으로 무엇을 쓰게 될지 센다.** PostgreSQL·Elasticsearch·작업 큐·감사 기록 어디에도
   쓰지 않는다. `would_update`가 곧 복구 대상 수이고, `document_missing`은 투영기가 만들 수
   없는 문서(투영·보강 경로를 먼저 본다 — RB-12·RB-14), `guard_rejected`는 문서의 저장소·SHA·
   브랜치가 정본과 다른 경우다. `skip_no_target`(직접 푸시·미수집·연결 미확정)·`skip_awaiting_
   creation`(커밋 문서 생성 대기)·`skip_other_space`(다른 시퀀스 브랜치가 가진 커밋 문서)·
   `skip_mapping_conflict`(같은 SHA를 가리키는 PR 스냅숏 둘)는 쓰지 않는 것이 옳다.

   ```bash
   ./prsctl sequence reproject --repository acme/payments --base-branch main --expected-epoch 1 --dry-run
   # 별칭을 좁히려면 --alias prs-pull-requests 또는 --alias prs-commits (둘 다 줄 수 있다)
   ```

4. **제한 범위로 재투영한다.** 같은 명령에서 `--dry-run`을 뺀다. 저장소·브랜치·예상 에폭·별칭이
   범위이며, `--expected-epoch`가 현재 에폭과 다르면 아무것도 예약하지 않고 거절한다(force-push
   직후 모르는 에폭에 손대지 않는다). 명령은 `sequence_reproject` 잡을 만들고(운영 화면 Jobs에
   `queued → running → completed | failed`로 보인다, 감사 `job.run`), `worker-sequence`의
   러너가 durable 작업을 예약해 끝날 때까지 진행(`projection`·`cursor_seq`·`pending_docs`)을
   찍는다. 같은 것을 운영 화면 실행 폼 `Sequence reprojection (index repair)`(저장소·브랜치·
   예상 에폭)이나 `POST /api/v1/admin/jobs`(`type: sequence_reproject`, `expected_epoch`)로도
   요청할 수 있다. 반복 실행은 멱등이며(두 번째는 `noop`만 센다), 중단·재시작 뒤에도 작업은
   커서에서 이어진다. **완료의 뜻**: 존재하는 문서마다 서수가 실렸다는 것이지 정본의 모든 서수에
   문서가 있다는 것이 아니다 — 아직 만들어지지 않은 커밋 문서(3번의 `skip_awaiting_creation`)는
   보강이 만들 때 채워진다.

   ```bash
   ./prsctl sequence reproject --repository acme/payments --base-branch main --expected-epoch 1
   ```

5. **원시 필드로 대조한다.** 화면이 아니라 색인 문서 자체를 본다 — API는 M 번호를 DB에서
   보강하므로 화면만으로는 색인이 고쳐졌는지 알 수 없다.

   ```bash
   # prsctl의 smoke·restore와 같은 자리 — elasticsearch 컨테이너의 curl로 별칭을 통해 읽는다 (문서 ID = <repository_id>:<PR 번호>, routing = repository_id)
   docker compose -p pr-search --env-file deploy/single-host/.env -f deploy/single-host/compose.yml exec -T elasticsearch \
     curl -fsS 'http://localhost:9200/prs-pull-requests/_doc/399:1450?routing=399&_source=merge_seq,seq_epoch,sequence_space,base_branch,merge_commit_sha'
   docker compose -p pr-search --env-file deploy/single-host/.env -f deploy/single-host/compose.yml exec -T postgres \
     psql -U prs -d prs -c "SELECT merge_seq, seq_epoch, commit_sha FROM merge_sequence WHERE repository_id = 399 AND base_branch = 'main' AND commit_sha = '<위 merge_commit_sha>'"
   # 기대: 두 값이 같다(merge_seq·seq_epoch). 다르면 3번의 dry-run 판정을 다시 본다
   ```

6. **새 검색 요청으로 확인한다.** 「M number」 정렬이 같은 저장소·브랜치·현재 에폭의 서수
   순서와 같은지, `seq:from..to`가 그 구간을 서수 순으로 돌려주는지, cursor로 끝까지 순회되는지
   본다. 판정 기준은 서수 순서다 — Merged at 정렬과 같아야 한다는 기준은 쓰지 않는다. 복구
   전에 연 cursor/PIT는 이전 스냅숏을 유지하므로 새 요청으로 확인한다.

7. **예외.** `epoch_mismatch`는 2번의 현재 에폭을 다시 지정한다. 잡이 `failed:
   projection_partial`이면 sweep은 끝났으나 끝내 만들어지지 않은 문서(`parked`)가 있다 —
   3번의 `document_missing`과 같은 자리이며 투영·보강을 고친 뒤 새 스냅숏·보강이 작업을 스스로
   깨운다. `failed: projection_incomplete`는 상한(30분) 안에 끝나지 않은 것이며 작업은 계속 돈다
   (`status`로 본다). 정합성 복구(A-003 재채번)가 `consistent`로 끝났을 때도 잡 `progress`의
   `db`와 `projection`을 따로 읽는다 — `projection: in_progress`는 색인 복구가 아직 도는
   중이라는 뜻이지 실패가 아니다. 재채번(RB-11)으로 색인 누락을 풀지 않는다.

### 7.F M 번호를 원격 lightweight 태그로 굳히기 (WP-100 / FR-SEQ-012, `CR-115`, RB-28)

켜면 확정된 M 번호마다 원격 GHE 저장소에 `refs/tags/M-<코드>-<번호>`(lightweight — tagger·메시지·
서명 없음)가 그 번호의 squash 머지 커밋에 생긴다. 그 뒤로는 PR Search 없이도 `git fetch --tags` 한
클론에서 `git rev-parse M-1900-1450`, `git show M-1900-1450`, `git log M-1900-2010..M-1900-2130`,
`git diff M-1900-2010..M-1900-2130`, `git checkout M-1900-2010`, `git describe --tags`가 된다.
**이 기능은 7.B의 제목 표기에 이어 이 제품이 사람의 지시 없이 GHE를 고치는 두 번째 경로다**
(`ADR-026`). 규율은 7.B와 같다 — 전용 App, 저장소별 해제, 감사, 기본 꺼짐. 다른 것은 되돌릴
수 없는 정도다: 제목은 사람이 고칠 수 있지만 태그는 한 번 퍼지면 옮겨도 이미 받은 클론이 따라오지
않는다. 그래서 **이 제품은 태그를 만들기만 하고 옮기거나 지우지 않는다** — 같은 이름의 태그가
다른 커밋이나 annotated 태그를 가리키면 `conflict`로 남기고 운영자에게 보고할 뿐이다.

**켜기 전에 알린다.** 대상 저장소를 클론한 사람 모두에게 `M-*` 태그가 생긴다는 것을 먼저 알린다 —
`git fetch --tags`·`git pull`이 태그를 받아 오고, `git describe`의 출력이 바뀐다.

0. **먼저 무엇이 바뀌는지 읽기 전용으로 본다.** 자격만 채우고 전역 스위치는 끈 채로 대조를 dry-run
   한다 — 원격 태그 목록을 읽어 정본과 대조한 요약만 내고 PostgreSQL·작업 큐·감사·GHE에 아무것도
   쓰지 않는다. `missing`이 곧 켜면 만들어질 태그 수이고, `conflict`는 이미 누군가 같은 이름으로
   다른 커밋을 가리켜 둔 태그(켜도 이 제품은 손대지 않는다), `unexpected`는 정본에 없는 번호의
   `M-*` 태그다.

   ```bash
   ./prsctl mnumber tags reconcile --repository acme/smp1900 --base-branch main --dry-run
   ```

1. **태그 전용 GitHub App을 새로 등록한다.** 권한은 `Contents: write` 하나다(공식 문서가 ref
   생성에 요구하는 권한). 7.B의 표기 App(`Pull requests: write`)과 **다른 App**으로 두기를 권한다 —
   ref 생성 권한이 제목 갱신보다 넓어 한 키의 유출이 두 반경을 함께 열지 않게 하기 위해서다.
   같은 App을 두 곳에 넣는 것은 운영자의 선택이다. 태그를 만들 저장소에만 설치한다.

2. **GHE 저장소 ruleset으로 `M-*` 태그를 보호한다.** `refs/tags/M-*`의 갱신·삭제를 막고 생성은
   태그 전용 App에 허용한다. 이 제품은 그 규칙을 만들지도 검사하지도 않는다 — 규칙이 없으면
   누구든 태그를 옮길 수 있고, 이 제품은 되돌리지 않는다(`FR-SEQ-012` AC-8).

3. **`.env`에 값을 채운다.**

   ```bash
   MNUMBER_TAG_ENABLED=true
   GHE_TAG_APP_ID=<태그 전용 App ID>
   GHE_TAG_PRIVATE_KEY=<PEM을 한 줄로, 개행은 \n>
   GHE_TAG_INSTALLATIONS=<org>:<installationId>   # 표기용 GHE_ANNOTATE_INSTALLATIONS와 다른 값
   ```

   **켜 놓고 세 자격 중 하나라도 비면 `worker-annotate`가 기동을 거부한다** — 표기와 같은 규율이다.
   나머지(`MNUMBER_TAG_SWEEP_MS`·`MNUMBER_TAG_SWEEP_LIMIT`·`MNUMBER_TAG_BLOCK_COOLDOWN_MS`·
   `GHE_TAG_REQUEST_TIMEOUT_MS`·`MNUMBER_TAG_WRITE_SPACING_MS`)는 기본값으로 시작한다.

4. **`./prsctl upgrade`를 돌린다.** 마이그레이션 035가 `merge_sequence`의 태그 결과 열,
   `repository.tag_enabled`(기본 켜짐)·`tag_blocked_*`, `sequence_work`의 `tag` kind, 잡
   `mnumber_tag_reconcile`을 더한다. 이미 채번된 번호에는 이 시점에 `tag` work가 없다 — 아래 6번이
   그것을 만든다.

5. **먼저 한 저장소에서만 켠다.** 나머지 저장소는 운영 화면 A-002 또는
   `PATCH /api/v1/admin/repositories/{id}`의 `tag_enabled: false`로 끈다(끈 저장소는 채번·표기는
   그대로 하고 태그만 만들지 않는다). 시퀀스 브랜치를 둘 이상 추적하는 저장소는 켜도 만들지 않는다
   (`disabled(multiple_sequence_branches)`, `OD-015`) — 태그 이름에 브랜치가 없어 두 공간의 같은
   번호가 한 이름을 다투기 때문이다.

6. **과거 채번분을 채운다.** 켠 뒤 새로 채번되는 번호는 즉시(같은 트랜잭션의 durable work) 태그가
   된다. **이미 채번된 번호는 대조로 한 번에 넣는다** — dry-run으로 `missing` 건수를 본 뒤 dry-run
   없이 실행하면 `missing` 전부가 회차 상한 없이 durable work로 들어간다(500건씩 배치로 요청하지만
   상한은 없다). 잔여 스윕(기본 하루 한 번, 회차당 `MNUMBER_TAG_SWEEP_LIMIT`=500건)만으로도 결국
   채워지지만 1,500건이면 사흘이 걸린다 — 스윕은 그 뒤의 안전망(유실·실패 복구)이다. 실제 생성
   속도는 쓰기 간격(기본 1초, 하한 1초)에 묶여 약 1건/초라 1,500건이면 25분 남짓이다.

   ```bash
   ./prsctl mnumber tags reconcile --repository acme/smp1900 --base-branch main --dry-run   # missing 건수를 본다
   ./prsctl mnumber tags reconcile --repository acme/smp1900 --base-branch main             # 잡을 만든다 — 감사 job.run
   ```

   같은 것을 운영 화면 A-003 실행 폼 `M-number tag reconcile (GHE tags)`(저장소·브랜치)나
   `POST /api/v1/admin/jobs`(`type: mnumber_tag_reconcile`)로도 요청할 수 있다. 잡은
   `queued → running → completed`로 보이고 `progress`에 `ok`·`missing`·`enqueued`·`conflict`·
   `unexpected`가 남는다. **`conflict`가 있어도 잡은 `completed`다** — 충돌은 실패가 아니라 보고다.

7. **확인한다.** 태그 상태 집계에서 `done`이 늘고 `untried`가 줄어야 한다. 감사 `merge_number.tag`
   (A-004 또는 `GET /api/v1/admin/audit`)의 건수가 실제로 만든 태그 수다 — 이미 있어 호출하지 않은
   회차는 감사를 남기지 않는다. 로컬 클론에서 태그를 받아 확인한다.

   ```bash
   ./prsctl mnumber tags status --repository acme/smp1900 --base-branch main
   git fetch --tags && git rev-parse M-1900-1450 && git show --no-patch --oneline M-1900-1450
   git log --oneline M-1900-1440..M-1900-1450
   ```

**무엇이 언제 일어나는가.** 새 채번은 즉시 — 채번 트랜잭션이 남긴 `tag` work를 `worker-annotate`의
`tag` 역할이 1초마다 집어 회차당 8건씩 직렬로 처리한다(쓰기 간격 1초). 잔여 스윕은 기동 30초 뒤 한 번,
그 뒤 `MNUMBER_TAG_SWEEP_MS`(기본 하루)마다 `tag_state`가 없거나 `failed`·`unknown`인 행을 회차
상한만큼 되살린다. 대조는 운영자가 실행할 때만 돈다.

**상태 사전.** `./prsctl mnumber tags status`가 세는 `tag_state`와 사유다.

| `tag_state` | 뜻 | 사유(`tag_result_reason`) | 다음에 일어나는 일 |
| --- | --- | --- | --- |
| (없음, `untried`) | 아직 시도하지 않았다 | - | work가 있으면 곧 처리되고, 없으면 스윕·대조가 만든다 |
| `done` | 원격에 같은 SHA의 lightweight 태그가 있음을 확인했다 | `created`(이 제품이 만들었다) · `already_present`(이미 있었다) · `observed_after_unknown`(결과를 모르던 요청 뒤 관측) · `reconciled`(대조가 확인) | 끝 |
| `conflict` | 같은 이름의 태그가 **다른 것**을 가리켜 손대지 않았다 | `different_sha` · `annotated_tag` (`tag_found_sha`가 원격이 가리키던 SHA) | 스윕이 다시 두드리지 않는다. 사람이 판단한다(아래) |
| `failed` | 만들지 못했다 | `permission_blocked`(403·404 — 저장소 차단) · `sha_not_in_remote`(머지 커밋이 원격에 없다) · `code_unavailable`(저장소 이름에서 코드를 정할 수 없다, OD-009) · 기타 오류 종류 | `permission_blocked`는 쿨다운 뒤 스윕 또는 대조가 다시 본다. `sha_not_in_remote`·`code_unavailable`은 원인을 고쳐야 한다 |
| `disabled` | 만들지 않기로 했다 | `repository_tag_disabled`(운영자가 껐다) · `multiple_sequence_branches`(OD-015) | 저장소를 켜거나 브랜치를 하나로 줄인 뒤 대조가 연다 |
| `unknown` | 생성 요청의 결과를 모른다 | `outcome_unknown_*`·`aborted_after_send` | 다음 시도가 원격을 읽어 확정한다 — 이미 있으면 호출 없이 `done` |

**목록이 잘렸다고 나오면.** 요약에 「목록 상한에서 잘림 — 부분 집계」가 붙으면 현재 에폭의 `M-*` 태그가
`MNUMBER_TAG_LIST_MAX_PAGES`(기본 200페이지, 2만 건)를 넘은 것이다. 그 실행은 `missing`·`unexpected`를
부분 집계로만 보고하고 재생성·재개를 하지 않는다 — 「없음」을 확인한 것이 아니기 때문이다. `.env`의 값을
올리고 `./prsctl upgrade` 뒤 다시 돌린다.

**충돌을 만나면 — 옮기지 않는다.** dry-run 대조로 정본 SHA와 원격 SHA·객체 유형을 나란히 본다.
사람이 만든 태그라면 그대로 둔다 — 그 번호는 태그 없이 남고 정본·검색·제목 표기는 그대로다. 이
제품이 잘못 만든 태그라는 것이 확인되면(정본의 번호가 바뀌었거나 다른 저장소의 커밋을 가리킨다)
정정은 **사람의 절차**다: ① ruleset의 삭제 제한을 일시 해제한다 ② GHE에서 그 태그를 지운다(이
제품에는 지우는 명령이 없다) ③ dry-run 없이 대조를 실행한다 — 대조가 원격에 없음을 확인한 `conflict`
행을 다시 열고(`reopened`) durable work로 재생성한다 ④ ruleset을 복구한다. 자동은 없다.

**권한 차단을 만나면.** 변경 요청에 403·404가 오면 그 저장소의 태그를 멈추고(`tag_blocked_at`,
`permission_blocked`) 쿨다운(`MNUMBER_TAG_BLOCK_COOLDOWN_MS`, 기본 하루) 뒤 스윕이 한 번 다시
본다. 표기와 같이 **조회 성공으로는 풀리지 않는다** — App 설치·`Contents: write` 권한·ruleset(생성이
App에 허용되는가)을 고친 뒤 대조를 dry-run 없이 실행하면 즉시 풀린다(운영자의 명시적 재개). 권한이
여전히 없으면 첫 생성이 다시 차단한다.

**에폭이 오른 뒤.** 재채번은 번호를 바꾸지만 기존 태그는 그대로다(`ADR-007`). 새 에폭의 번호가
옛 태그와 다른 커밋을 만나면 `conflict`로 보고된다 — 재채번(7.E·RB-11) 뒤에는 대조를 한 번 돌려
목록을 본다. 옛 태그를 어떻게 할지는 사람이 정한다.

**끄는 방법은 둘이다.** 전역 `MNUMBER_TAG_ENABLED=false`로 재기동하면 `tag` 역할이 아무것도 쓰지
않고 채번 트랜잭션이 남기는 `tag` work는 `ready`로 쌓인다(다시 켜면 처리된다). 저장소별
`tag_enabled: false`는 그 저장소만 `disabled`로 남기며 다시 켠 뒤 대조가 연다. 어느 쪽도 이미 만든
태그를 지우지 않는다.

### 7.G 커밋에 남은 과거 PR 번호 정리 (WP-101 / FR-SRCH-002 AC-6, `CR-116`, RB-29)

커밋 상세와 History의 「Linked PRs」는 Elasticsearch 커밋 문서의 `pull_request_numbers`다. `CR-116`
이전에는 그 필드가 **합집합**이라 한 번 더해진 PR 번호를 빼는 경로가 없었다 — PR이 rebase되어 원본
커밋 목록에서 빠진 커밋에도 번호가 그대로 남았고, `0.1.0-pilot.17` 사내 보고가 그것이다(PR 279개,
커밋 3,481건). `CR-116`부터는 관계의 정본이 PostgreSQL에 있고 커밋별 전용 투영기가 **그 커밋을
소유하는 PR 전부**를 다시 세어 대입한다. 새 이벤트는 자동으로 수렴한다. 아래는 **이미 굳은 오염**을
정리하는 순서이며, 배포 뒤 한 번은 밟아야 한다.

**관계 대입은 관계 재발견이 아니다.** 아래 어떤 단계도 `merge_seq`·M 번호·`seq_epoch`·head·원격
`M-*` 태그·권한 정보를 읽지도 바꾸지도 않는다. 색인의 값을 정답으로 삼지 않는다 — 색인은 **검증
대상**이고 정본은 PostgreSQL이다.

**먼저: 모든 워커가 새 빌드여야 한다.** 구버전 `pipeline-worker`는 여전히 합집합으로 쓴다. 관계
전용 세대는 그 쓰기를 **막지 못한다** — 옛 스크립트에는 세대가 없기 때문이다. 롤링 업데이트가 끝나기
전에 `apply`를 돌리면 정리한 번호가 곧바로 다시 들어온다. 단일 호스트에서는 `./prsctl upgrade`가
컨테이너를 교체하므로 겹침이 짧지만, 교체가 끝난 것을 확인한 뒤에 시작한다.

1. **어느 형상이 떠 있는가.** `./prsctl lineage`로 배포 SHA를 읽고 이 절이 있는 판(`CR-116` 이후)인지
   확인한다. 이전 판이면 아래 명령이 없다 — 업그레이드가 먼저다.

2. **상태를 읽는다.** 관계 수와 밀린 투영을 본다. `parked`가 쌓여 있으면 `commit_link_state`의
   `last_reason`이 이유이고, `generation_conflict`는 우리가 쓰지 않은 쓰기가 있었다는 뜻이다(구버전
   워커가 아직 돌거나 사람이 직접 고쳤다).

   ```bash
   ./prsctl links status --repository acme/payments
   ```

3. **근거를 먼저 모은다.** 완전성 근거가 없는 PR만 GHE에서 다시 읽는다. **이 단계는 읽기 전용
   GHE 조회를 쓰고 PostgreSQL의 관계·관측을 갱신한다** — dry-run이 아니다. 그래서 계획과 섞지
   않는다. `--limit`으로 한 회차의 조회 수를 묶을 수 있고, 중단했다가 다시 실행해도 남은 것부터
   이어 간다.

   ```bash
   ./prsctl links refetch --repository acme/payments --limit 200
   # 4단계의 계획이 알려 준 번호로 좁히면 훨씬 적게 읽는다
   ./prsctl links refetch --repository acme/payments --pr 2355 --pr 983 --pr 1528
   ```

   **좁히지 않으면 거의 모든 PR을 읽는다.** 마이그레이션 036 직후에는 모든 관측이
   `unverified`이므로 이 명령의 대상은 그 저장소의 확정되지 않은 PR 전부이고, PR당 세 번의
   GHE 호출이 든다(상세 → 커밋 목록 → 상세 재확인). 4단계의 `plan`이 `근거가 필요한 PR:`
   줄로 실제 필요한 번호를 찍어 주므로, **그 번호들만** `--pr`로 주는 것이 정상 순서다.
   전량이 필요하면 `--limit`으로 회차를 나눈다 — 중단했다가 다시 실행해도 남은 것부터 이어 간다.

   `여전히 불완전`과 `조회 실패`는 **삭제의 근거가 아니다.** 그 PR들의 관계는 그대로 두고 사유가
   `pull_request_link_observation`에 남는다. 권한 차단(403)·삭제된 PR(404)·rate limit이 여기 온다.

4. **dry-run으로 무엇이 바뀔지 센다.** PostgreSQL·Elasticsearch·작업 큐 어디에도 쓰지 않는다.
   `바뀔 커밋`은 고유 커밋 수이고 `더할 간선`·`지울 간선`은 관계 수다 — **둘은 다른 값이다**(커밋
   하나에서 두 PR이 빠지면 커밋 1, 간선 2). `근거 없어 보류`는 지워야 할 것 같지만 근거가 없어
   남겨 둔 수이며, 3단계를 다시 돌려야 줄어든다.

   ```bash
   ./prsctl links plan --repository acme/payments
   # PR을 좁히려면 --pr 2355 (여러 번 줄 수 있다)
   ```

5. **적용한다.** 같은 명령의 `plan`을 `apply`로 바꾼다. **계획을 다시 계산한다** — 계획과 실행
   사이에 새 웹훅이 들어왔으면 그 계획은 이미 낡았고, 낡은 계획을 실행하는 것이 이 `CR`이 고치려던
   것과 같은 종류의 잘못이다. 이 명령은 색인에 직접 쓰지 않고 **투영 의도만** 만들며, 실제 쓰기는
   `worker-project`의 관계 투영 러너가 한다. 반복 실행은 멱등이다.

   ```bash
   ./prsctl links apply --repository acme/payments
   ```

6. **수렴을 확인한다.** `밀린 투영`이 비고 `parked`가 늘지 않으면 끝났다. 화면에서 문제의 커밋
   하나를 열어 「Linked PRs」가 기대한 목록인지 본다.

   ```bash
   ./prsctl links status --repository acme/payments
   ```

**충돌(`generation_conflict`)이 남으면.** 그 커밋은 우리가 쓴 값이 아닌 것을 색인에 갖고 있다.
덮어쓰지 않는 것이 의도다 — 증거를 지우면 무슨 일이 있었는지 아무도 모른다. 구버전 워커가 모두
교체된 것을 확인한 뒤 4~5단계를 다시 돌리면 세대가 올라 풀린다. 지표
`commit_link_conflict_total`이 계속 오르면 아직 옛 워커가 돌고 있다는 뜻이다.

**롤백 위험.** 옛 이미지로 되돌리면 합집합 writer가 살아나 오염이 재발한다. 마이그레이션 036의
`down`은 PostgreSQL 표만 지우고 색인의 `pr_links_generation`은 남으므로, `down` 뒤 다시 `up`하면
정본 세대가 1부터 시작하고 색인은 더 높은 값을 쥔 채 갈라진다 — 로그의 `generation_rewound`가 그
신호이며, 그때는 관계 필드를 지운 뒤 4~5단계를 다시 밟아야 한다. **되돌릴 계획이 있으면 `apply`를
먼저 돌리지 않는다.**

**사내 임시 조치였던 `scripts/cleanup-stale-pr-links.mjs`는 이 절차가 대체한다.** 그 스크립트는 이
저장소에도 git 이력 어디에도 없다 — 사내 사본만 있으므로 내용은 확인하지 못했다. 그것이 하던 일
(ES의 PR 문서에서 유효 SHA 집합을 만들고 `update_by_query`로 커밋에서 번호를 빼는 것)은 **삭제의
근거를 색인에서 읽는 방식**이라 `ADR-004`와 어긋나고, 웹훅이 계속 들어오면 합집합이 다시 더한다.
위 절차는 근거를 원격에서 다시 읽어 PostgreSQL에 남기고, 색인은 그 정본의 투영으로만 바꾼다.

#### `git merge dev`로 받아 온 dev 커밋의 PR 번호 (`CR-117`, FR-SRCH-002 AC-7)

피처 브랜치가 dev를 merge해 오면 GitHub의 PR 커밋 목록에 **이미 dev에 오른 다른 PR의 머지 커밋**이
섞인다(`0.1.0-pilot.18` 보고 — `ebc781d`에 #983·#1855가 붙었다). 그 목록은 완전해도 그 PR의 원본
커밋 목록이 아니므로, `CR-117`부터는 **dev 체인에 오른 커밋은 그 커밋을 올린 PR에만** 속한다. 원시
관측(`pull_request_commit_link`)은 지우지 않고 읽을 때 거른다 — 그래서 **3단계(`refetch`)가 필요 없다.**
근거는 GHE가 아니라 PostgreSQL의 `merge_sequence`다.

- `plan`의 `그중 dev 체인 커밋에서 빠질 간선: N (커밋 M)`이 이 몫이다. 이 번호들은 그 PR의 관측이
  미확정이어도 지운다 — 빼는 근거가 「목록이 전부였다」가 아니라 「이미 다른 PR로 체인에 올랐다」이기
  때문이다. 표본 줄의 `체인=[…]`이 커밋마다 빠질 번호다.
- `plan`의 `역할이 source_commit으로 덮인 체인 커밋: N`은 PR 투영이 dev 체인 머지 커밋의 `role`을
  `source_commit`으로 덮어 둔 수다. `apply`가 체인이 정한 역할(병합 근거나 PR 대응이 있으면
  `merge_commit`, 없으면 `direct_push`)로 **직접** 되돌리며 출력에 `체인 커밋 역할 되돌림: N건`이 찍힌다.
  이것만은 러너가 아니라 `apply`가 색인에 쓴다 — 관계 러너는 `role`을 비추지 않는다. `source_commit`인
  문서만 바꾸는 단방향 쓰기이고 반복 실행은 멱등이다. **`--pr`로 좁힌 실행은 이 대조를 하지 않는다**
  (역할은 커밋 단위라 저장소 전체를 본다) — `--pr` 없이 한 번 돌린다.
- 반입 뒤 순서: `./prsctl upgrade` → 저장소마다 `./prsctl links plan --repository <owner/name>`으로 두
  줄의 건수를 본다 → `./prsctl links apply --repository <owner/name>` → `./prsctl links status`로 수렴
  확인 → 화면에서 문제의 커밋(`ebc781d`)을 열어 「Linked PRs」에 그 커밋을 올린 PR 하나만 남았는지,
  PR #983 상세의 원본 커밋 목록 아래에 「이미 대상 브랜치에 있던 커밋 N개」 안내가 나오는지 본다.
- 이 변경은 **M 번호 채번 경로를 건드리지 않는다.** 머지 시퀀스 채번·재채번 트랜잭션에는 관계 투영
  의도 한 문장만 더해졌다 — 새로 체인에 오르거나 강제 푸시로 체인에서 빠진 커밋의 연결이 저절로 다시
  계산된다.

## 8. 문제 해결

| 증상 | 확인 |
| --- | --- |
| 커밋에 이미 머지된 PR이 아닌 번호가 붙어 있다 | `./prsctl links plan --repository …`로 정본과 색인을 맞대어 본다. `지울 간선`이 있으면 7.G의 순서를 밟는다. `근거 없어 보류`가 크면 `links refetch`가 먼저다 — 목록에 없다는 사실이 소속이 아니라는 뜻이 되려면 그 목록이 원격의 전부여야 한다 |
| 정리했는데 잘못된 번호가 다시 생긴다 | 구버전 워커가 아직 돈다. 지표 `commit_link_conflict_total`과 `./prsctl lineage`로 확인한다. 옛 이미지가 남아 있으면 합집합 writer가 살아 있고, 새 세대 가드는 그것을 막지 못한다 (7.G 머리) |
| `M-…` 태그가 안 생긴다 | `./prsctl mnumber tags status --repository … --base-branch …`로 `tag_state` 집계·차단·`tag` work 상태를 본다. `MNUMBER_TAG_ENABLED`(기본 꺼짐) → 세 자격 → 저장소 `tag_enabled` → ruleset(생성이 App에 허용되는가) → 시퀀스 브랜치 수(둘 이상이면 OD-015) 순으로 확인한다. 과거 채번분은 대조를 dry-run 없이 한 번 실행해야 바로 채워진다 (7.F) |
| 한 저장소의 표기가 계속 실패하고, **다른 저장소의 표기도 함께 늦어진다** | 로그에 `시간 예산이 다해 이번 회차를 멈춘다`가 반복되는지 본다. 이벤트는 순서 보장을 위해 파티션마다 하나씩 전달되므로, 지속 실패하는 저장소의 이벤트가 같은 파티션의 다른 저장소를 막는다(`DEV-647`). **표기가 영영 빠지지는 않는다** — 일일 잔여 스윕이 하루 안에 메운다. 급하면 실패하는 저장소의 `annotate_enabled`를 잠시 꺼서 그 이벤트를 흘려보낸다 |
| 어떤 PR의 표기가 계속 안 된다. 로그에 `title_body_changed`가 있다 | GHE가 제목을 다르게 저장했다. 자동 재시도를 멈춘 상태이며 의도된 정지다. 제목을 확인한 뒤 `PATCH /admin/repositories/{id}`에 `annotate_resume: true`로 다시 연다 (7.B) |
| 권한을 고쳤는데 차단이 안 풀린다 | 차단은 **실제 쓰기 성공**으로만 풀린다. 조회가 되는 것만으로는 풀리지 않는다. 기다리지 않으려면 `annotate_resume`으로 연다 (7.B) |
| 표기 워커를 둘로 늘렸는데 빨라지지 않는다 | 의도된 동작이다. 실행자 락이 하나만 쓰게 하며 나머지는 회차를 건너뛴다 (`DEV-629`) |
| `worker-annotate`가 기동하지 않는다 | `MNUMBER_ANNOTATE_ENABLED=true`인데 표기 전용 App 자격이 비어 있다. `docker logs`가 없는 키 이름을 말한다. 켤 생각이 아니었다면 값을 `false`로 되돌린다 (7.B) |
| PR 제목이 바뀌지 않는다 | 순서대로 본다 — (1) `MNUMBER_ENABLED`가 켜져 번호가 붙었는가, (2) `MNUMBER_ANNOTATE_ENABLED`가 켜졌는가, (3) 그 저장소의 `annotate_enabled`가 켜졌는가, (4) `merge_sequence.annotate_state`가 무엇인가. `mismatch`면 이미 다른 M 접두가 있어 덮지 않은 것이고, `disabled`면 저장소가 꺼진 것이며, `failed`면 다음 스윕이 다시 시도한다 |
| 한 저장소만 표기가 멈췄다 | `repository.annotate_blocked_reason`을 본다. 표기 전용 App이 그 저장소에 설치됐는지, 권한이 `Pull requests: write`인지 확인한다. 고친 뒤에는 쿨다운이 지나면 스윕이 자동으로 다시 시도한다 — 운영자의 `annotate_enabled`는 이 차단으로 바뀌지 않았다 |
| `load`가 `.env`가 없다고 멈춘다 (최초 설치) | **정상이다.** `.env`가 `load`보다 먼저다 (2.B 3단계, DEV-524). 아무것도 적재되지 않았으니 `.env`를 만들고 다시 실행한다 |
| `load`·`install`이 필수 값 부재로 멈춘다 | `.env`에 값이 실제로 채워졌는가. `KEY=`만 있으면 비어 있는 것이다. 필수 키 목록은 2.B 「`.env`는 어디에 있는가」 |
| `images/*.tar`를 `tar`로 풀었더니 파일 더미가 나온다 | 그것은 Docker 이미지 아카이브다. 풀지 말고 `./prsctl load`를 쓴다 (2.A 「아카이브가 셋이다」). 풀어 놓은 더미는 지워도 된다 |
| `git fetch`가 `.bundle`을 읽지 못한다 | 경로가 2.B에서 푼 위치를 가리키는가. `.bundle`은 `tar`나 `docker load`의 대상이 아니다 |
| `load`가 `PRS_REINDEX_TIMEOUT_S … 정수여야 한다: 3600`처럼 **멀쩡해 보이는 값을 거부한다** | `.env`가 CRLF다 — Windows 편집기로 고쳤거나 그렇게 저장된 파일을 복사했다. `prsctl`은 값을 줄 단위로 읽어 끝의 `\r`이 값에 붙는다. `sed -i 's/\r$//' .env`로 LF로 만든다 (DEV-526) |
| compose가 이미지를 pull하려 한다 | `./prsctl load`를 실행했는가. `PRS_VERSION`이 적재한 태그와 같은가 |
| `enrich`·`reconcile`이 기동을 거부한다 (`install`의 health가 그 둘에서 실패) | `GHE_APP_ID`·`GHE_APP_PRIVATE_KEY`·`GHE_INSTALLATIONS`가 있는가. **의도된 거부다** — 자격 없이 돌면 모든 이벤트가 실패 대기열에 쌓인다. `install` 뒤에 넣었다면 `.env`만으로는 반영되지 않는다 — `./prsctl upgrade`로 컨테이너를 다시 만든다 (DEV-527) |
| `worker-sequence`가 `SEQUENCE_GRAPH_MODE=mirror인데 미러 볼륨이 없다`로 기동하지 않는다 | **의도된 거부다** (WP-074). `mirror-data` 볼륨이 그 서비스에 붙어 있는가. 미러 없이 돌려야 하면 `.env`에 `SEQUENCE_GRAPH_MODE=api`를 **명시**한다 — 조용히 API로 바꾸지 않는 것이 이 검사의 목적이다 |
| Status를 Merged로 두면 결과가 없다 · My merged PRs가 빈다 · 병합된 PR이 `closed`로 보인다 | 032 이전에 색인된 문서다 (`CR-101`, `DEV-718`). `upgrade` 뒤 운영 콘솔에서 `prs-pull-requests`를 재색인했는가. 재색인 뒤에도 그렇다면 그 PR의 스냅숏에 `merged_at`이 있는지 본다 — 없으면 GHE가 병합 시각을 주지 않은 것이다 |
| M 번호가 영영 "대기"다 | `MNUMBER_ENABLED`가 `search-api`·`worker-sequence`·`worker-batch` **셋 다** `true`인가. 하나라도 다르면 그 역할만 꺼진 상태다 — API만 켜면 번호가 생기지 않고, 워커만 켜면 번호는 붙되 응답에 실리지 않으며, `worker-batch`가 빠지면 **재색인 뒤 새 색인의 M이 영영 빈다**(DEV-606). **`web`에는 이 값이 없다** (DEV-589): 화면은 응답에 M 키가 있는지로만 판단한다. 그다음 `sequence_space.mnumber_blocked_reason`을 본다 — `negative_evidence_unavailable`이면 직접 푸시 커밋의 부재를 확정할 근거가 없어 그 앞에서 멈춘 것이며(`DEV-581`), 이것은 알려진 제한이다 |
| 웹훅이 전부 401 | `GHE_WEBHOOK_SECRET`이 GHE 쪽 설정과 같은가. 경유 호스트를 두었다면 **본문을 다시 만들고 있지 않은가** — 서명은 원문 바이트에 대해 계산된다 (2.C 「GHE가 서버에 닿지 못할 때」) |
| 웹훅이 전부 404 | 경로에 **`/api/v1`이 있는가** (2.C 3단계). 정본은 `apps/ingest-gateway/src/server.ts`의 `WEBHOOK_PATH`다 (`DEV-549`) |
| 웹훅 배달이 **시간 초과** | 서명도 경로도 아니다. GHE에서 이 서버로의 **인바운드가 없는 것**이며, 주소만 바꿔서는 풀리지 않는다 (2.C 「GHE가 서버에 닿지 못할 때」, `DEV-550`) |
| 웹훅은 받는데 **`store_failed`** | `raw_event`에 다가올 파티션이 남아 있는가. `select relname from pg_class where relname like 'raw_event_%'`로 확인한다. `ADMIN_DATABASE_URL`은 이제 필수 값이라 비면 `load`부터 멈추므로(`DEV-556`), 이 증상이 나면 값은 있고 **잡이 돌지 않은 것**이다 — `worker-batch` 로그를 본다 |
| `password authentication failed` (`prs_retention`) | **비밀번호를 퍼센트 인코딩했는가** — 앱은 디코딩한 값으로 접속한다. 롤 자체는 `install`·`upgrade`·`restore`가 `ADMIN_DATABASE_URL`을 읽어 만들므로(`DEV-556`), 값을 고친 뒤 `./prsctl upgrade`를 돌리면 비밀번호가 맞춰진다 |
| 웹 화면이 전부 500, 로그에 `Failed to load external module` | 이미지가 `DEV-551` 이전 빌드다. 그 결함은 **배포 트리에서만** 나타나며 이미지 빌드가 고친다 — 컨테이너 안에서 손으로 스텁을 만들면 `upgrade`·`restart`마다 사라진다. 고친 버전으로 다시 받는다 |
| `docker compose ps`는 전부 정상인데 **웹 화면만 500** | 이미지가 `DEV-577` 이전 빌드다. 그 빌드는 잘못된 구성으로도 기동하고 `/healthz`에 200을 내므로 컨테이너가 `healthy`로 보이는데, 사람이 여는 화면만 500이 됐다 — 사내 반입 `0.1.0-pilot.3`이 막힌 자리다. **컨테이너 안에서 `npm install`을 실행하지 않는다**: 배포 트리의 `package.json`은 워크스페이스 참조를 담고 있어 npm이 `EUNSUPPORTEDPROTOCOL`로 거부하고, 설령 되더라도 `upgrade` 한 번에 사라진다. 고친 버전으로 다시 받는다 |
| `web`이 재기동을 반복한다 · 로그에 `web 구성이 성립하지 않아 기동할 수 없다` | **의도된 거부다** (`DEV-577`). 로그의 다음 줄이 어느 계약을 어겼는지 적는다. 가장 잦은 것은 운영에서 `SESSION_COOKIE_SECURE=false`이며, 값을 `true`로 되돌리고 `./prsctl upgrade`를 다시 돌린다 (2.B). TLS 없는 파일럿에서 로그인까지 시험하는 중이라면 6장 「운영에는 TLS가 필요하다」의 두 값을 함께 적었는지 본다 — `ALLOW_INSECURE_COOKIES`의 값이 `true`·`false`·빈 값이 아니어도 같은 자리에서 막힌다. 이 거부가 없던 시절에는 같은 구성이 초록으로 서서 화면만 500이었다 |
| `AUTH_PROVIDER=github`인데 `web`이 기동하지 않는다 | 로그의 다음 줄이 어느 키가 비었는지 적는다 (`CR-083`). `GHE_BASE_URL`·`GHE_OAUTH_CLIENT_ID`·`GHE_OAUTH_CLIENT_SECRET`·`GHE_OAUTH_REDIRECT_URI` 넷이 필수다. `AUTH_PROVIDER` 값에 오타가 있어도 같은 자리에서 막힌다 — 오타가 조용히 `oidc`로 떨어지지 않는다 |
| GHE 로그인은 되는데 모두 `developer`다 | `GHE_TEAM_ROLE_MAP`이 비었거나 팀 이름이 다르다. 값은 `<org>/<team>:<역할>`이고 구분자는 **콜론**이다. 팀 슬러그는 GHE의 팀 URL 마지막 구간이며 표시 이름이 아니다. 팀으로 부여할 수 있는 역할은 `manager`와 `qa`뿐이다. `operator`·`release_manager`·`security_officer`는 `./prsctl role grant <login> <역할>`로 준다 (6장 「운영 역할 지정하기」) |
| 운영 메뉴가 없거나 `/ops/*`·A-006 승인이 403이다 (세션 인증 배포) | 그 사람에게 `operator`가 지정됐는가 — `./prsctl role list`. 없으면 그 사람이 한 번 로그인한 뒤 `./prsctl role grant <login> operator`를 돌리고 화면을 새로 고친다. 다시 로그인할 필요는 없다 (`CR-091`). `0.1.0-pilot.6`까지의 빌드는 DB에 지정해도 역할에 반영되지 않았다(`DEV-695`) |
| `./prsctl role grant`가 「로그인한 사용자가 없다」로 멈춘다 | 대상이 아직 로그인하지 않았거나 이름이 다르다. 표시 이름이 아니라 GHE 로그인 이름을 쓴다. 로그인은 되는데도 같으면 `docker logs search-api`에 정본 등록 실패(`DEV-613`)가 있는지 본다 |
| `prsctl`이 「운영에서 `SESSION_COOKIE_SECURE=false`만으로는 web이 기동하지 않는다」로 멈춘다 | **의도된 사전 거부다** (`FR-AUTH-001` AC-2 · `CR-091`). 그대로 올리면 `web`이 기동을 거부하고 재기동을 반복한다 — `0.1.0-pilot.6`까지의 `prsctl`은 이것을 컨테이너 교체 뒤에야 보였다. 메시지의 셋 중 하나를 고른다: TLS를 붙이고 `SESSION_COOKIE_SECURE=true`, 로그인까지 시험하는 평문 HTTP 파일럿이면 `ALLOW_INSECURE_COOKIES=true`를 함께, 로그인이 필요 없으면 `AUTH_ENABLED=false` (6장) |
| `prsctl`이 「`ALLOW_INSECURE_COOKIES`는 true 또는 false여야 한다」로 멈춘다 | 값에 오타가 있다(`TRUE`·`yes`·`1`). `web`은 그 값을 켜짐으로도 꺼짐으로도 읽지 않고 기동을 거부한다. `true`나 `false`로 고치거나 비운다 — 컨테이너는 아직 바뀌지 않았다 |
| `prsctl`이 「`AUTH_ENABLED=true`(세션 인증)와 `ADMIN_API_TOKENS`를 함께 둘 수 없다」로 멈춘다 | **의도된 사전 거부다** (`DEV-048` · `CR-091`). 그대로 올리면 `search-api`가 기동을 거부하고 재기동을 반복한다. 컨테이너는 아직 바뀌지 않았다. `.env`의 `ADMIN_API_TOKENS` 값을 비우고(`ADMIN_API_TOKENS=`) 같은 명령을 다시 돌린다. 토큰으로 하던 운영 작업은 `operator` 역할로 한다 (6장) |
| `search-api`가 재기동을 반복하고 로그에 `OIDC 세션과 ADMIN_API_TOKENS를 함께 구성할 수 없다` | 위와 같은 원인이다. `0.1.0-pilot.6`까지의 `prsctl`은 이것을 미리 막지 않았다. `ADMIN_API_TOKENS`를 비우고 `./prsctl upgrade` |
| `./prsctl health`에 「평문 HTTP 세션 허용」 줄이 있다 | 실패가 아니다. `ALLOW_INSECURE_COOKIES=true`로 TLS 없이 로그인을 여는 파일럿 형상이라는 알림이다 (6장). 운영으로 쓰기 전에 TLS를 붙이고 두 값을 되돌린다 |
| 로그인 직후 화면은 뜨는데 조회가 503 `permission_unavailable` | `DEV-613` 이전 빌드다. 그 빌드는 로그인이 `app_user` 행을 만들지 않아 접근 범위를 산출하지 못했다. 고친 버전은 세션을 읽을 때 정본에 행을 만든다. 그래도 503이면 `docker logs search-api`에 등록 실패 이유가 남아 있는지 본다 — `app_user.login`이 UNIQUE라 GHE에서 개명한 계정이 다른 행과 부딪칠 수 있고, 그때는 사람이 정본을 정리해야 한다 |
| 로그인은 되는데 **저장소 목록이 비고** `/api/v1/me`가 503 `permission_unavailable` | 수집용 GHE App의 권한이다(2.C 「수집용 GHE App에 줄 권한」). `docker logs <search-api 컨테이너>`에서 「접근 범위를 조회하지 못했다」 줄의 `stage`·`status`·`required_permission`을 본다 — `collaborator_permission`이면 `Metadata`, `org_membership`·`org_teams`·`team_membership`이면 조직 `Members`다. `0.1.0-pilot.7`까지는 저장소가 몇 개든 `Members`가 없으면 503이었다(`DEV-698`). **`permission_cache`나 `team_member`에 손으로 행을 넣지 않는다** — 캐시는 5분 뒤 만료되고, `team_member`는 이 증상과 무관하다(아래) |
| `team_member`가 비어 있고 `app_user.access_scope_version`이 0이다 | **정상이다.** 로그인은 팀 동기화를 시작하지 않고 버전을 올리지 않는다 — 버전은 권한 변경 웹훅의 무효화에서만 오른다(`FR-AUTH-003`). 볼 수 있는 저장소가 500개 이하인 사용자의 검색은 저장소 ID로만 거르므로 `team_member`와 `allowed_team_ids`가 가시성에 쓰이지 않는다. 저장소가 안 보이는 원인은 위 행의 503이다 |
| `./prsctl smoke`가 `✗ search-api /healthz → HTTP/1.1`로 실패하는데 `docker exec`로 부르면 `{"status":"ok"…}`다 | **서비스는 정상이다.** `0.1.0-pilot.7`까지의 `prsctl`이 본문과 헤더를 한 파이프로 읽어, 둘의 도착 순서가 바뀌면 상태 코드 자리에서 `HTTP/1.1`을 읽었다(간헐, `DEV-697`). 고친 버전은 상태 코드만 읽는다. 그 전까지는 `./prsctl health`로 판정한다 |
| GHE 로그인(또는 GitHub 계정 연결) 뒤 **`localhost:3000`**으로 간다 | `0.1.0-pilot.7`까지의 빌드다 — 돌아갈 주소를 서버가 들은 호스트로 조립했다(`DEV-699`). 고친 버전은 경로만 보내므로 nginx 설정을 바꿀 필요가 없다(6장 「역방향 프록시 뒤에서」). 그 전까지는 주소창의 `localhost:3000`을 서비스 주소로 바꿔 연다 |
| 로그아웃할 방법이 없다 | 화면 오른쪽 위의 로그인 이름을 누른다(6장 「로그아웃」, `CR-092`). `0.1.0-pilot.7`까지는 메뉴가 없었다 |
| 인증을 켠 뒤 모든 화면이 로그인으로 갔다가 500 | `OIDC_REDIRECT_URI`를 채웠는가 (`DEV-579`). 값은 `<서비스 주소>/auth/callback`이며 IdP에 등록한 것과 문자 그대로 같아야 한다. 고친 버전에서는 이 값이 비면 `web`이 아예 기동하지 않으므로 이 증상은 `DEV-579` 이전 빌드에서만 난다 |
| GHE 호출이 인증서 오류 · 기동 로그에 CA 경고 | CA를 **여섯 자리 전부**에 걸었는가. anchor는 얕게 합쳐져 `worker-sequence`·`worker-mirror`·`worker-release`에 닿지 않는다 (6장 「anchor는 얕게 합쳐진다」, `DEV-552`) |
| `JOB-MIR-001`이 SSL 오류로 실패하고 **미러 볼륨이 비어 있다** (다른 서비스는 정상) | `git`이 사내 CA를 신뢰하지 않는다. `NODE_EXTRA_CA_CERTS`는 Node 런타임만 읽으므로 `git` 서브프로세스에는 닿지 않는다 (`DEV-561`). `.env`의 `GIT_SSL_CAINFO`에 `NODE_EXTRA_CA_CERTS`와 **같은 경로**를 적고 `./prsctl upgrade`를 돌린다. 값만 넣고 컨테이너를 다시 만들지 않으면 반영되지 않는다 (6장 「사설 CA」) |
| 서버 안에서 `curl`이 `HTTP/0.9` 오류 | 호스트에 프록시가 강제돼 컨테이너 IP로 가는 요청까지 경유한다. 진단할 때만 `--noproxy '*'`로 우회한다 — 서비스 쪽 프록시 지원은 별개다 (`DEV-494`) |
| 검색 결과가 비어 있다 | 백필을 실행했는가. `worker-project` 로그에 색인 기록이 있는가 |
| `group_by=team`이 빈 결과 | `authz` 역할에 GHE 자격이 있는가 — 없으면 작성자 팀이 언제나 모름이다 |
| 로그인 후 다시 로그인 화면 · 콜백 로그에 「왕복 쿠키가 없거나 읽을 수 없다」 | 평문 HTTP로 서비스하고 있는가. `Secure` 쿠키는 브라우저가 HTTP로 되돌려 보내지 않으므로 세션이 매 요청마다 사라진다. **`SESSION_COOKIE_SECURE=false` 한 값만 바꾸는 것은 답이 아니다** — 운영에서 그 값은 `web`의 기동을 막는다 (`DEV-577`). TLS를 앞에 세우거나, 파일럿에서 로그인까지 시험해야 한다면 6장의 두 값(`ALLOW_INSECURE_COOKIES=true` 포함)을 함께 적는다. 로그인이 필요 없으면 `AUTH_ENABLED=false`로 둔다 — 그 형상에서도 화면은 서고 조회만 프록시가 401로 막는다. `0.1.0-pilot.6`까지의 빌드에는 이 플래그가 없다 |
| `install`이 접속 주체 프로비저닝에서 멈춘다 | `POSTGRES_APP_USER`가 `prs_app`인가 — 그것은 그룹 롤이라 접속할 수 없다. 다른 이름을 준다 (DEV-503) |
| 업그레이드에서 `load`가 `.env`가 없다고 멈춘다 | 이전 설치의 `.env`를 복사했는가. 번들은 시크릿을 담지 않는다 (DEV-513) |
| 복구 뒤 검색 결과가 비어 있거나 부분적 | **정상이다.** 재색인이 도는 중이며 진행은 운영 콘솔에서 본다 (DEV-511) |
| 재색인이 `permission denied`로 실패 | 마이그레이션 022가 적용됐는가 (DEV-517). 005 이후 만들어진 표에 애플리케이션 롤 권한이 없었다 |
| 저장소 등록 요청이 `permission denied for sequence` | 마이그레이션 023이 적용됐는가 (DEV-518). `BIGSERIAL` 시퀀스에 권한이 없었다 |
| `restore`가 재색인 시간 초과로 끝난다 | `.env`의 `PRS_REINDEX_TIMEOUT_S`를 늘려 다시 실행하거나 운영 콘솔에서 남은 별칭을 실행한다 (DEV-519·520) |
| `ingest-gateway`가 503 | **DB 접속 주체가 `prs_app`인가** (DEV-503). 그것은 `NOLOGIN` 그룹 롤이라 접속이 거부된다. 로그인 주체를 만들었는지 확인하라 — 이 엔드포인트만 실제로 PostgreSQL을 확인하므로 **여기서 먼저 드러난다** |
| `gh release download`가 `release not found`·404 | 토큰에 이 저장소의 Contents 읽기 권한이 있는가, 저장소 이름과 버전(태그)이 스크립트 성공 출력의 명령과 같은가. 비공개 저장소는 토큰 없이 404다 (CR-063) |
| 받은 파일의 `sha256sum`이 자산 digest와 다르다 | **그 파일을 쓰지 않는다.** 다시 받는다. 두 번째도 다르면 담당자에게 알린다 — 발행 시 스크립트가 같은 대조를 통과했으므로 전송 경로의 문제다 |
| 자산 digest가 **담당자가 전달한 SHA-256**과 다르다 | **릴리스가 발행 뒤 바뀐 것이다** (`DEV-530`). 그 릴리스를 쓰지 않고 담당자에게 알린다 — 새 버전으로 다시 발행한다 |
| `gh`가 없다 | 2장 「경계」의 curl 경로로 받는다 |
| `tar -xzf`가 `not in gzip format`으로 실패 | 파일이 JSON이다 — curl에 `Accept: application/octet-stream`이 빠졌거나 토큰 오류 응답을 저장했다. `head -c 200 <파일>`로 확인한다 |
| 업그레이드 중 `load`가 `compose.yml: FAILED — checksum 불일치`로 멈춘다 | `prsctl load`는 내부에서 `verify`를 재실행한다. `compose.yml`을 `load` 전에 수정하면 번들의 `SHA256SUMS`와 어긋난다. `load` 완료 → `compose.yml` 수정 → `upgrade` 순서로 실행한다 (`DEV-571`) |
| `prs-releases`가 0이고 `worker-mirror` 로그에 `spawn git ENOENT`가 보인다 | `pipeline-worker` 이미지에 `git`이 없는 버전이다. `Dockerfile`의 `pipeline-worker` 스테이지가 `git`을 설치하는 upstream 버전으로 이미지를 다시 빌드해 번들을 재생성한다 (`DEV-572`) |
| GitHub 작업 화면이 「열리지 않았다」이거나 실행이 `대기 중`에 머문다 | 7.C의 「증상과 확인」 — `GH_OPERATIONS_ENABLED`는 search-api와 gh-executor가 같이 읽고, `prsctl`이 `.env`로 프로파일을 켠다 (`CR-086`) |
| GitHub 작업 실행이 「관리자 운영 승인이 필요합니다」로 거절된다 | 업그레이드·첫 켜기·배포 정의 변경 뒤의 정상 동작이다 — 7.C 4단계(운영 승인). 승인했는데도 그렇다면 A-006에서 「승인된 정의가 현재 정의와 다름」인지 본다 (`CR-090`) |
| gh-executor 로그에 `identity_unsealable`이 반복된다 | 두 서비스의 `GH_IDENTITY_VAULT_KEY`가 다르다. 같은 값으로 맞춘 뒤 `./prsctl upgrade`. 키를 새로 만들었다면 사용자가 다시 연결해야 한다 (7.C) |
