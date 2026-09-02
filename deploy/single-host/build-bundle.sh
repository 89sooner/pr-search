#!/usr/bin/env bash
#
# 오프라인 반입 번들을 만든다 (WP-070 / CR-059 / ADR-021).
#
# **외부망에서만 실행한다.** 저장소 소스와 컨테이너 레지스트리가 필요하다.
# 사내에서 쓰는 것은 이 스크립트가 아니라 그 산출물이다.
#
#   ./build-bundle.sh <version> [출력 디렉터리]
#
# 산출물 둘 (출력 디렉터리 기본값 deploy/single-host/bundle/):
#   pr-search-<version>-offline/          번들 디렉터리 (검사·확인용)
#   pr-search-<version>-offline.tar.gz    운반 아카이브 — 사내로 가져갈 파일 (CR-062 / WP-071)
#
# 산출물은 사내에서 `git clone`도 `pnpm install`도 레지스트리 접근도 요구하지
# 않는다. **요구하는 순간 그 절차는 사내망에서 실행 불가능하다.**

set -Eeuo pipefail

VERSION="${1:?사용법: build-bundle.sh <version> [출력 디렉터리]}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_ROOT="${2:-${REPO_ROOT}/deploy/single-host/bundle}"
BUNDLE="${OUT_ROOT}/pr-search-${VERSION}-offline"
# **사내로 가져갈 파일은 이것 하나다** (CR-062 / WP-071, DEV-523). 번들 디렉터리의
# **형제** 위치라 아카이브가 자기 자신을 담지 않는다.
ARCHIVE="${BUNDLE}.tar.gz"

die() { printf '오류: %s\n' "$*" >&2; exit 1; }
step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

command -v docker >/dev/null || die "docker가 없다"
command -v git    >/dev/null || die "git이 없다"

cd "$REPO_ROOT"

# ── 계보를 먼저 확정한다 ────────────────────────────────────────
# **더러운 작업 트리로 번들을 만들지 않는다.** 그러면 `upstream_commit`이
# 실제로 담긴 코드를 가리키지 않고, 그 순간 계보 증명이 거짓이 된다.
# **추적되는 변경과 추적되지 않는 파일을 함께 본다** (DEV-512).
#
# `git diff --quiet HEAD`는 **미추적 파일을 보지 못한다.** 그런데 Dockerfile의
# `COPY . .`은 `.dockerignore`에 걸리지 않는 미추적 파일을 그대로 이미지에 넣는다 —
# 그러면 manifest가 `upstream_commit`을 신원으로 주장하는데 **이미지 내용이 그 커밋과
# 다르다.** 계보 증명이 거짓이 되는 자리이므로 둘 다 막는다.
#
# `agent-context/`는 `.dockerignore`가 제외하므로 이미지에 들어가지 않는다.
DIRTY="$(git status --porcelain -- . ':(exclude)agent-context')"
if [ -n "$DIRTY" ]; then
  printf '%s\n' "$DIRTY" >&2
  die "작업 트리가 깨끗하지 않다 (미추적 파일 포함) — 계보를 증명할 수 없다. 커밋하거나 되돌린 뒤 다시 실행하라"
fi

UPSTREAM_REMOTE="$(git remote get-url origin 2>/dev/null || echo 'unknown')"
UPSTREAM_COMMIT="$(git rev-parse HEAD)"
UPSTREAM_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

step "번들 준비 — ${BUNDLE}"
rm -rf "$BUNDLE"
rm -f "$ARCHIVE"   # 이전 실행의 아카이브가 새 디렉터리 옆에 남아 짝이 어긋나지 않게
mkdir -p "$BUNDLE"/{source,images,deploy,manifest,checksums}

# ── 애플리케이션 이미지 ─────────────────────────────────────────
APP_TARGETS=(web search-api ingest-gateway pipeline-worker migrate es-bootstrap)
declare -A IMAGE_NAME=(
  [web]="prs/web"                         [search-api]="prs/search-api"
  [ingest-gateway]="prs/ingest-gateway"   [pipeline-worker]="prs/pipeline-worker"
  [migrate]="prs/db"                      [es-bootstrap]="prs/es"
)

for target in "${APP_TARGETS[@]}"; do
  step "이미지 빌드 — ${IMAGE_NAME[$target]}:${VERSION}"
  docker build --target "$target" -t "${IMAGE_NAME[$target]}:${VERSION}" "$REPO_ROOT"
done

# ── 백킹 이미지 ─────────────────────────────────────────────────
# **번들에 함께 담는다.** 사내에서 Docker Hub·Elastic 레지스트리에 닿지 않는다.
# 태그는 compose가 참조하는 값과 정확히 같아야 한다.
BACKING_IMAGES=(
  "postgres:16-alpine"
  "docker.elastic.co/elasticsearch/elasticsearch:8.19.0"
  "redis:7-alpine"
  "docker.elastic.co/beats/filebeat:8.13.4"
)
for image in "${BACKING_IMAGES[@]}"; do
  step "백킹 이미지 확보 — ${image}"
  docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
done

# ── 이미지 tar ──────────────────────────────────────────────────
step "이미지 저장"
APP_IMAGES=()
for target in "${APP_TARGETS[@]}"; do APP_IMAGES+=("${IMAGE_NAME[$target]}:${VERSION}"); done
docker save "${APP_IMAGES[@]}"    -o "${BUNDLE}/images/pr-search-app.tar"
docker save "${BACKING_IMAGES[@]}" -o "${BUNDLE}/images/backing-services.tar"

# ── 소스 계보 ───────────────────────────────────────────────────
# **git bundle이다.** tarball과 달리 커밋 그래프를 담으므로 사내에서
# `vendor/upstream`으로 fetch할 수 있고, 다음 반입의 merge 기반이 된다.
step "소스 계보 생성"
git bundle create "${BUNDLE}/source/pr-search-${VERSION}.bundle" HEAD >/dev/null

# ── 배포 정의 ───────────────────────────────────────────────────
step "배포 정의 복사"
mkdir -p "${BUNDLE}/deploy/single-host"
for f in compose.yml .env.example prsctl filebeat.yml RUNBOOK.md; do
  [ -e "${REPO_ROOT}/deploy/single-host/${f}" ] && cp "${REPO_ROOT}/deploy/single-host/${f}" "${BUNDLE}/deploy/single-host/"
  # **텍스트는 LF로 맞춘다** (DEV-526). 빌더의 checkout이 `core.autocrlf=true`면 `.gitattributes`가
  # 고정하지 않은 파일이 CRLF로 복사되는데, 사내 운영자가 `cp .env.example .env`를 하는 순간
  # 모든 값 끝에 `\r`이 붙어 `require_env`가 `3600` 같은 멀쩡한 값을 거부한다. 번들의 내용이
  # 빌더의 git 설정에 따라 달라지면 안 된다 — checksum은 이 정규화 뒤에 계산된다.
  [ -f "${BUNDLE}/deploy/single-host/${f}" ] && sed -i 's/\r$//' "${BUNDLE}/deploy/single-host/${f}"
done
chmod +x "${BUNDLE}/deploy/single-host/prsctl" 2>/dev/null || true

# ── manifest ────────────────────────────────────────────────────
step "release-manifest 생성"
sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
# **로컬 빌드에는 `RepoDigests`가 없다** — 레지스트리에 push한 적이 없기 때문이다.
# 그때 이미지 ID(내용 해시)가 신원이며, 개행이 섞이지 않게 마지막 줄만 집는다.
digest_of() {
  local d
  d="$(docker image inspect "$1" --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' 2>/dev/null | tr -d '\r\n')"
  printf '%s' "${d:-unknown}"
}

MIGRATION_LEVEL="$(ls "${REPO_ROOT}/packages/db/migrations"/*.up.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort -n | tail -1)"
# **인덱스 버전이 아니라 매핑의 내용 해시다.** 구체 인덱스 버전(`<alias>-v<n>`)은
# 클러스터가 들고 있는 런타임 값이라 빌드 시점에 알 수 없다. 재색인이 필요한지를
# 정하는 실제 재료는 **매핑 정의가 바뀌었는가**이므로 그것을 해시한다.
ES_MAPPING_SHA="$(cat "${REPO_ROOT}/packages/es/src/mappings"/*.ts "${REPO_ROOT}/packages/es/src/indices.ts" "${REPO_ROOT}/packages/es/src/settings.ts" 2>/dev/null | sha256sum | cut -d' ' -f1)"
NODE_VERSION="$(cat "${REPO_ROOT}/.nvmrc" 2>/dev/null | tr -d '[:space:]')"
PNPM_VERSION="$(node -e "process.stdout.write(require('${REPO_ROOT}/package.json').packageManager||'')" 2>/dev/null)"

{
  printf '{\n'
  printf '  "release_version": "%s",\n' "$VERSION"
  printf '  "upstream": {\n'
  printf '    "repository": "%s",\n' "$UPSTREAM_REMOTE"
  printf '    "commit": "%s",\n'     "$UPSTREAM_COMMIT"
  printf '    "branch": "%s",\n'     "$UPSTREAM_BRANCH"
  printf '    "bundle_sha256": "%s"\n' "$(sha256_of "${BUNDLE}/source/pr-search-${VERSION}.bundle")"
  printf '  },\n'
  printf '  "toolchain": {\n'
  printf '    "node": "%s",\n' "$NODE_VERSION"
  printf '    "package_manager": "%s",\n' "$PNPM_VERSION"
  printf '    "lockfile_sha256": "%s"\n' "$(sha256_of "${REPO_ROOT}/pnpm-lock.yaml")"
  printf '  },\n'
  printf '  "schema": {\n'
  printf '    "migration_level": "%s",\n' "$MIGRATION_LEVEL"
  printf '    "elasticsearch_mapping_sha256": "%s"\n' "$ES_MAPPING_SHA"
  printf '  },\n'
  printf '  "images": {\n'
  printf '    "application": [\n'
  local_first=1
  for target in "${APP_TARGETS[@]}"; do
    [ $local_first -eq 1 ] || printf ',\n'
    local_first=0
    printf '      { "name": "%s", "tag": "%s", "id": "%s" }' \
      "${IMAGE_NAME[$target]}" "$VERSION" "$(digest_of "${IMAGE_NAME[$target]}:${VERSION}")"
  done
  printf '\n    ],\n'
  printf '    "backing": [\n'
  local_first=1
  for image in "${BACKING_IMAGES[@]}"; do
    [ $local_first -eq 1 ] || printf ',\n'
    local_first=0
    printf '      { "reference": "%s", "id": "%s" }' "$image" "$(digest_of "$image")"
  done
  printf '\n    ]\n'
  printf '  },\n'
  printf '  "deployment_profile": "A",\n'
  printf '  "contains_secrets": false\n'
  printf '}\n'
} > "${BUNDLE}/manifest/release-manifest.json"

# ── 릴리스 노트 ─────────────────────────────────────────────────
{
  printf '# PR Search %s — 오프라인 반입 번들\n\n' "$VERSION"
  printf '외부 커밋 `%s` (`%s`)에서 만들었다.\n\n' "$UPSTREAM_COMMIT" "$UPSTREAM_BRANCH"
  printf '반입 절차는 `deploy/single-host/RUNBOOK.md`가 정본이다.\n\n'
  printf '## 담긴 것\n\n'
  printf -- '- 애플리케이션 이미지 %d종 (`images/pr-search-app.tar`)\n' "${#APP_TARGETS[@]}"
  printf -- '- 백킹 이미지 %d종 (`images/backing-services.tar`)\n' "${#BACKING_IMAGES[@]}"
  printf -- '- 소스 계보 (`source/*.bundle`) — `vendor/upstream`의 기반\n'
  printf -- '- 배포 정의와 런북 (`deploy/single-host/`)\n'
  printf -- '- 계보·스키마·이미지 신원 (`manifest/release-manifest.json`)\n\n'
  printf '## 운반\n\n'
  printf -- '- 이 디렉터리는 운반 아카이브 `%s` 하나로 사내에 들어온다 — `tar -xzf`로 풀면 이 디렉터리가 나온다\n' "$(basename "$ARCHIVE")"
  printf -- '- `images/*.tar`는 `prsctl load`가 `docker load`로 읽는다. **직접 풀지 않는다**\n'
  printf -- '- `source/*.bundle`은 `git fetch`로 사내 Git에 들여온다. 절차는 런북 2장이다\n\n'
  printf '## 담기지 않은 것\n\n'
  printf -- '- **시크릿·토큰·개인 키.** 값이 채워진 `.env`는 반입 대상이 아니라 사내에서 만드는 것이다\n'
  printf -- '- 개발 의존성, 시험 픽스처, 문서 전체\n'
} > "${BUNDLE}/RELEASE_NOTES.md"

# ── checksum ────────────────────────────────────────────────────
step "checksum 생성"
( cd "$BUNDLE" && find . -type f ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 sha256sum > checksums/SHA256SUMS )

# ── 시크릿 혼입 검사 ────────────────────────────────────────────
# **번들이 시크릿을 담으면 그것이 새 노출 경로다** (NFR-005, DEV-499).
step "시크릿 혼입 검사"
if find "$BUNDLE" -type f \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' \) | grep -q .; then
  die "번들에 시크릿으로 보이는 파일이 있다"
fi
if grep -rlE 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' "${BUNDLE}/deploy" "${BUNDLE}/manifest" 2>/dev/null | grep -q .; then
  die "번들의 배포 정의에 개인 키가 있다"
fi

# ── 운반 아카이브 ───────────────────────────────────────────────
# 번들 디렉터리는 파일 여럿이라 옮기는 사람마다 다르게 묶었고, 런북은 "풀어
# 놓는다"고 적으면서 무엇을 푸는지 정한 적이 없었다 (DEV-523). 이제 **사내로
# 가져갈 파일은 이 아카이브 하나**다.
#
# checksum과 시크릿 검사가 **끝난 뒤** 만든다 — 검사를 통과한 내용만 담는다.
# 바깥 checksum sidecar는 만들지 않는다: 정본은 번들 안의 `checksums/SHA256SUMS`
# 하나이고 `prsctl verify`가 그것을 검증한다. 아카이브가 손상되면 `tar`가 풀지
# 못하고, 풀리는데 변조됐으면 `verify`가 잡는다.
step "운반 아카이브 생성 — ${ARCHIVE}"
tar -czf "$ARCHIVE" -C "$OUT_ROOT" "$(basename "$BUNDLE")"
# **만든 것을 다시 읽어 본다.** 읽지 못하는 아카이브를 완료로 보고하지 않는다 (DEV-519의 규율).
tar -tzf "$ARCHIVE" >/dev/null || die "운반 아카이브를 다시 읽지 못한다: $ARCHIVE"

printf '\n번들 완료\n'
printf '  번들 디렉터리 : %s  (%s)\n' "$BUNDLE"  "$(du -sh "$BUNDLE"  | cut -f1)"
printf '  운반 아카이브 : %s  (%s)\n' "$ARCHIVE" "$(du -sh "$ARCHIVE" | cut -f1)"
printf '\n사내 반입 파일 : %s\n' "$(basename "$ARCHIVE")"
printf '반입 절차      : 아카이브 안의 deploy/single-host/RUNBOOK.md\n'
