# PR Search 사내 반입·운영 런북 (Profile A)

> 대상: 단일 Linux 호스트 · Docker Compose · 오프라인 번들 · 운반은 GitHub Release
> 근거: `CR-059` / `ADR-021` / `WP-070` · `CR-063` / `WP-072` · `CR-066` · 인프라 문서 3.0장
> 첫 실제 반입: 2026-09-07 — 이 문서의 절차로 성립했고, 그때 드러난 것을 반영했다 (원장 6.70장)

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
2. 운영 콘솔(`A-001`)에서 저장소를 등록한다.
3. GHE에 웹훅을 등록한다 — 대상은 `http://<호스트>:3001/api/v1/webhooks/github`, 시크릿은 `.env`의 `GHE_WEBHOOK_SECRET`.
   **경로에 `/api/v1`이 있다.** 정본은 `apps/ingest-gateway/src/server.ts`의 `WEBHOOK_PATH`이며, 이 문서가 한동안 그것을 빼고 적어 첫 반입에서 웹훅이 전부 404였다 (`DEV-549`).
   **GHE가 이 주소에 닿는지 먼저 확인한다** — 닿지 않으면 4단계로 가기 전에 아래 「GHE가 서버에 닿지 못할 때」를 읽는다.
4. **백필을 실행한다** — 과거 PR 이력은 백필이 채운다(`JOB-ING-004`). `worker-enrich`가 그 역할을 함께 켜고 있다.
5. 시퀀스 채번과 관계 파생은 미러 동기화 뒤에 따라온다.

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
| **직접 푸시의 영구 부재 확정** (`DEV-581`) | **`NOT RUN — 근거 미확보`** — 공식 GHE 읽기 계약에 완결 증서가 없다. production 판정기는 그 상태를 `negative_evidence_unavailable`로 남기며, 그 결과 **첫 미확정 항목 뒤의 PR이 전부 대기할 수 있다.** 격리 시험이 direct 분기를 통과한 것은 이 조건을 닫지 않는다 |
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

---

## 8. 문제 해결

| 증상 | 확인 |
| --- | --- |
| `load`가 `.env`가 없다고 멈춘다 (최초 설치) | **정상이다.** `.env`가 `load`보다 먼저다 (2.B 3단계, DEV-524). 아무것도 적재되지 않았으니 `.env`를 만들고 다시 실행한다 |
| `load`·`install`이 필수 값 부재로 멈춘다 | `.env`에 값이 실제로 채워졌는가. `KEY=`만 있으면 비어 있는 것이다. 필수 키 목록은 2.B 「`.env`는 어디에 있는가」 |
| `images/*.tar`를 `tar`로 풀었더니 파일 더미가 나온다 | 그것은 Docker 이미지 아카이브다. 풀지 말고 `./prsctl load`를 쓴다 (2.A 「아카이브가 셋이다」). 풀어 놓은 더미는 지워도 된다 |
| `git fetch`가 `.bundle`을 읽지 못한다 | 경로가 2.B에서 푼 위치를 가리키는가. `.bundle`은 `tar`나 `docker load`의 대상이 아니다 |
| `load`가 `PRS_REINDEX_TIMEOUT_S … 정수여야 한다: 3600`처럼 **멀쩡해 보이는 값을 거부한다** | `.env`가 CRLF다 — Windows 편집기로 고쳤거나 그렇게 저장된 파일을 복사했다. `prsctl`은 값을 줄 단위로 읽어 끝의 `\r`이 값에 붙는다. `sed -i 's/\r$//' .env`로 LF로 만든다 (DEV-526) |
| compose가 이미지를 pull하려 한다 | `./prsctl load`를 실행했는가. `PRS_VERSION`이 적재한 태그와 같은가 |
| `enrich`·`reconcile`이 기동을 거부한다 (`install`의 health가 그 둘에서 실패) | `GHE_APP_ID`·`GHE_APP_PRIVATE_KEY`·`GHE_INSTALLATIONS`가 있는가. **의도된 거부다** — 자격 없이 돌면 모든 이벤트가 실패 대기열에 쌓인다. `install` 뒤에 넣었다면 `.env`만으로는 반영되지 않는다 — `./prsctl upgrade`로 컨테이너를 다시 만든다 (DEV-527) |
| `worker-sequence`가 `SEQUENCE_GRAPH_MODE=mirror인데 미러 볼륨이 없다`로 기동하지 않는다 | **의도된 거부다** (WP-074). `mirror-data` 볼륨이 그 서비스에 붙어 있는가. 미러 없이 돌려야 하면 `.env`에 `SEQUENCE_GRAPH_MODE=api`를 **명시**한다 — 조용히 API로 바꾸지 않는 것이 이 검사의 목적이다 |
| M 번호가 영영 "대기"다 | `MNUMBER_ENABLED`가 `search-api`·`worker-sequence`·`worker-batch` **셋 다** `true`인가. 하나라도 다르면 그 역할만 꺼진 상태다 — API만 켜면 번호가 생기지 않고, 워커만 켜면 번호는 붙되 응답에 실리지 않으며, `worker-batch`가 빠지면 **재색인 뒤 새 색인의 M이 영영 빈다**(DEV-606). **`web`에는 이 값이 없다** (DEV-589): 화면은 응답에 M 키가 있는지로만 판단한다. 그다음 `sequence_space.mnumber_blocked_reason`을 본다 — `negative_evidence_unavailable`이면 직접 푸시 커밋의 부재를 확정할 근거가 없어 그 앞에서 멈춘 것이며(`DEV-581`), 이것은 알려진 제한이다 |
| 웹훅이 전부 401 | `GHE_WEBHOOK_SECRET`이 GHE 쪽 설정과 같은가. 경유 호스트를 두었다면 **본문을 다시 만들고 있지 않은가** — 서명은 원문 바이트에 대해 계산된다 (2.C 「GHE가 서버에 닿지 못할 때」) |
| 웹훅이 전부 404 | 경로에 **`/api/v1`이 있는가** (2.C 3단계). 정본은 `apps/ingest-gateway/src/server.ts`의 `WEBHOOK_PATH`다 (`DEV-549`) |
| 웹훅 배달이 **시간 초과** | 서명도 경로도 아니다. GHE에서 이 서버로의 **인바운드가 없는 것**이며, 주소만 바꿔서는 풀리지 않는다 (2.C 「GHE가 서버에 닿지 못할 때」, `DEV-550`) |
| 웹훅은 받는데 **`store_failed`** | `raw_event`에 다가올 파티션이 남아 있는가. `select relname from pg_class where relname like 'raw_event_%'`로 확인한다. `ADMIN_DATABASE_URL`은 이제 필수 값이라 비면 `load`부터 멈추므로(`DEV-556`), 이 증상이 나면 값은 있고 **잡이 돌지 않은 것**이다 — `worker-batch` 로그를 본다 |
| `password authentication failed` (`prs_retention`) | **비밀번호를 퍼센트 인코딩했는가** — 앱은 디코딩한 값으로 접속한다. 롤 자체는 `install`·`upgrade`·`restore`가 `ADMIN_DATABASE_URL`을 읽어 만들므로(`DEV-556`), 값을 고친 뒤 `./prsctl upgrade`를 돌리면 비밀번호가 맞춰진다 |
| 웹 화면이 전부 500, 로그에 `Failed to load external module` | 이미지가 `DEV-551` 이전 빌드다. 그 결함은 **배포 트리에서만** 나타나며 이미지 빌드가 고친다 — 컨테이너 안에서 손으로 스텁을 만들면 `upgrade`·`restart`마다 사라진다. 고친 버전으로 다시 받는다 |
| `docker compose ps`는 전부 정상인데 **웹 화면만 500** | 이미지가 `DEV-577` 이전 빌드다. 그 빌드는 잘못된 구성으로도 기동하고 `/healthz`에 200을 내므로 컨테이너가 `healthy`로 보이는데, 사람이 여는 화면만 500이 됐다 — 사내 반입 `0.1.0-pilot.3`이 막힌 자리다. **컨테이너 안에서 `npm install`을 실행하지 않는다**: 배포 트리의 `package.json`은 워크스페이스 참조를 담고 있어 npm이 `EUNSUPPORTEDPROTOCOL`로 거부하고, 설령 되더라도 `upgrade` 한 번에 사라진다. 고친 버전으로 다시 받는다 |
| `web`이 재기동을 반복한다 · 로그에 `web 구성이 성립하지 않아 기동할 수 없다` | **의도된 거부다** (`DEV-577`). 로그의 다음 줄이 어느 계약을 어겼는지 적는다. 가장 잦은 것은 운영에서 `SESSION_COOKIE_SECURE=false`이며, 값을 `true`로 되돌리고 `./prsctl upgrade`를 다시 돌린다 (2.B). 이 거부가 없던 시절에는 같은 구성이 초록으로 서서 화면만 500이었다 |
| 인증을 켠 뒤 모든 화면이 로그인으로 갔다가 500 | `OIDC_REDIRECT_URI`를 채웠는가 (`DEV-579`). 값은 `<서비스 주소>/auth/callback`이며 IdP에 등록한 것과 문자 그대로 같아야 한다. 고친 버전에서는 이 값이 비면 `web`이 아예 기동하지 않으므로 이 증상은 `DEV-579` 이전 빌드에서만 난다 |
| GHE 호출이 인증서 오류 · 기동 로그에 CA 경고 | CA를 **여섯 자리 전부**에 걸었는가. anchor는 얕게 합쳐져 `worker-sequence`·`worker-mirror`·`worker-release`에 닿지 않는다 (6장 「anchor는 얕게 합쳐진다」, `DEV-552`) |
| `JOB-MIR-001`이 SSL 오류로 실패하고 **미러 볼륨이 비어 있다** (다른 서비스는 정상) | `git`이 사내 CA를 신뢰하지 않는다. `NODE_EXTRA_CA_CERTS`는 Node 런타임만 읽으므로 `git` 서브프로세스에는 닿지 않는다 (`DEV-561`). `.env`의 `GIT_SSL_CAINFO`에 `NODE_EXTRA_CA_CERTS`와 **같은 경로**를 적고 `./prsctl upgrade`를 돌린다. 값만 넣고 컨테이너를 다시 만들지 않으면 반영되지 않는다 (6장 「사설 CA」) |
| 서버 안에서 `curl`이 `HTTP/0.9` 오류 | 호스트에 프록시가 강제돼 컨테이너 IP로 가는 요청까지 경유한다. 진단할 때만 `--noproxy '*'`로 우회한다 — 서비스 쪽 프록시 지원은 별개다 (`DEV-494`) |
| 검색 결과가 비어 있다 | 백필을 실행했는가. `worker-project` 로그에 색인 기록이 있는가 |
| `group_by=team`이 빈 결과 | `authz` 역할에 GHE 자격이 있는가 — 없으면 작성자 팀이 언제나 모름이다 |
| 로그인 후 다시 로그인 화면 | 평문 HTTP로 서비스하고 있는가. `Secure` 쿠키는 브라우저가 HTTP로 되돌려 보내지 않으므로 세션이 매 요청마다 사라진다. **`SESSION_COOKIE_SECURE=false`로 내리는 것은 답이 아니다** — 운영에서 그 값은 `web`의 기동을 막는다 (`DEV-577`). TLS를 앞에 세우거나, 아직 세울 수 없다면 `AUTH_ENABLED=false`로 둔다. 그 형상에서도 화면은 서고 조회만 프록시가 401로 막는다 |
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
