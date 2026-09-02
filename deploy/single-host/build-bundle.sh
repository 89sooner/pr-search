#!/usr/bin/env bash
#
# 오프라인 반입 번들을 만든다 (WP-070 / CR-059 / ADR-021).
#
# **외부망에서만 실행한다.** 저장소 소스와 컨테이너 레지스트리가 필요하다.
# 사내에서 쓰는 것은 이 스크립트가 아니라 그 산출물이다.
#
#   ./build-bundle.sh <version> [출력 디렉터리] [--release]
#
# 산출물 둘 (출력 디렉터리 기본값 deploy/single-host/bundle/):
#   pr-search-<version>-offline/          번들 디렉터리 (검사·확인용)
#   pr-search-<version>-offline.tar.gz    운반 아카이브 — 사내로 가져갈 파일 (CR-062 / WP-071)
#
# `--release`를 주면 운반 아카이브를 GitHub Release <version>의 자산으로 발행한다
# (CR-063 / WP-072). 태그 = 버전, target = 이 커밋, 자산은 아카이브 하나. 발행한
# 자산을 API로 다시 읽어 이름·크기·digest를 로컬과 대조하며, 어긋나면 방금 만든
# 릴리스와 태그를 지우고 실패한다. 사내는 이 저장소 한정 읽기 토큰으로 받는다.
#
# 산출물은 사내에서 `git clone`도 `pnpm install`도 레지스트리 접근도 요구하지
# 않는다. **요구하는 순간 그 절차는 사내망에서 실행 불가능하다.** 번들을 받는
# 단계만 github.com에 닿는다 (DEV-528).

set -Eeuo pipefail

die() { printf '오류: %s\n' "$*" >&2; exit 1; }
step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

VERSION="${1:?사용법: build-bundle.sh <version> [출력 디렉터리] [--release]}"
shift
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_ROOT=""
RELEASE=0
for arg in "$@"; do
  case "$arg" in
    --release) RELEASE=1 ;;
    --*) die "알 수 없는 옵션: $arg (사용법: build-bundle.sh <version> [출력 디렉터리] [--release])" ;;
    *) [ -z "$OUT_ROOT" ] || die "출력 디렉터리가 둘이다: $OUT_ROOT · $arg"; OUT_ROOT="$arg" ;;
  esac
done
OUT_ROOT="${OUT_ROOT:-${REPO_ROOT}/deploy/single-host/bundle}"
BUNDLE="${OUT_ROOT}/pr-search-${VERSION}-offline"
# **사내로 가져갈 파일은 이것 하나다** (CR-062 / WP-071, DEV-523). 번들 디렉터리의
# **형제** 위치라 아카이브가 자기 자신을 담지 않는다.
ARCHIVE="${BUNDLE}.tar.gz"

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

# ── 발행 전제 검사 (--release) ──────────────────────────────────
# **이미지를 빌드하기 전에 묻는다.** 릴리스는 불변이라 같은 버전을 다시 발행하지 않고,
# 태그가 다른 커밋을 가리키면 그 릴리스의 계보 증명이 거짓이 된다. 두 검사가 몇 분짜리
# 빌드 뒤에 있으면 fail-fast가 아니다 — 검사의 위치다 (DEV-524가 가르친 것).
REPO_SLUG=""
TAG_EXISTED=0
if [ "$RELEASE" -eq 1 ]; then
  command -v gh >/dev/null || die "gh가 없다 — --release는 GitHub CLI가 필요하다"
  gh auth status >/dev/null 2>&1 || die "gh가 인증되지 않았다 (gh auth status)"
  REPO_SLUG="$(printf '%s' "$UPSTREAM_REMOTE" | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##')"
  case "$REPO_SLUG" in
    */*) ;;
    *) die "origin이 github.com 저장소가 아니다: $UPSTREAM_REMOTE" ;;
  esac
  if gh release view "$VERSION" -R "$REPO_SLUG" >/dev/null 2>&1; then
    die "릴리스 ${VERSION}이 이미 있다 — 릴리스는 불변이다. 새 버전으로 만든다"
  fi
  # 같은 태그를 예약한 초안(draft)이 남아 있으면 그것도 막는다 — 실패한 실행의 잔재다.
  LEFTOVER_DRAFT="$(gh api "repos/${REPO_SLUG}/releases?per_page=100" --jq ".[] | select(.draft and .tag_name == \"${VERSION}\") | .id" 2>/dev/null | head -1 || true)"
  [ -z "$LEFTOVER_DRAFT" ] || die "태그 ${VERSION}을 예약한 초안 릴리스(id ${LEFTOVER_DRAFT})가 남아 있다 — 지우고 다시 실행한다"
  TAG_TARGET="$(git ls-remote --tags origin "refs/tags/${VERSION}" "refs/tags/${VERSION}^{}" | tail -1 | cut -f1)"
  if [ -n "$TAG_TARGET" ]; then
    TAG_EXISTED=1
    [ "$TAG_TARGET" = "$UPSTREAM_COMMIT" ] || die "태그 ${VERSION}이 다른 커밋(${TAG_TARGET})을 가리킨다 — 이 커밋(${UPSTREAM_COMMIT})의 릴리스가 될 수 없다"
  fi
  # **릴리스는 저절로 불변이 아니다** (DEV-530). immutable releases가 켜진 저장소에서만 발행 뒤
  # 자산이 잠기고 태그가 고정된다 — 꺼져 있으면 쓰기 권한자가 발행 뒤에도 자산을 바꾸거나 태그를
  # 옮길 수 있고, 사내가 같은 릴리스의 현재 digest와만 대조해서는 그것을 알 수 없다. 그래서
  # 자산 SHA-256은 릴리스와 **별도 채널**로 사내에 전달한다(런북 2.A). 설정 상태는 출력에 적는다.
  IMMUTABLE="$(gh api "repos/${REPO_SLUG}/immutable-releases" --jq '.enabled' 2>/dev/null || echo unknown)"
fi

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
  printf -- '- `source/*.bundle`은 `git fetch`로 사내 Git에 들여온다. 절차는 런북 2장이다\n'
  printf -- '- `--release`로 발행되면 이 아카이브가 GitHub Release `%s`의 자산이 된다 (CR-063 / WP-072). 사내에서는 이 저장소 한정 읽기 토큰으로 받아 자산 digest와 대조한다 — 런북 2.B 1단계\n\n' "$VERSION"
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

# ── GitHub Release 발행 (--release) ─────────────────────────────
# **운반 경로다** (CR-063 / WP-072, DEV-528). 태그 = 버전, target = manifest의
# upstream.commit, 자산 = 운반 아카이브 하나. 아카이브를 다시 읽은 **뒤**에만 발행한다 —
# 읽지 못하는 것을 발행하지 않는다. 릴리스 본문은 번들의 RELEASE_NOTES.md에 아카이브의
# 파일명·크기·SHA-256을 덧붙인 것이다: 번들 안의 파일은 자기 아카이브의 해시를 담을 수
# 없으므로 그 값은 여기에만 있고, 같은 실행이 같은 값으로 만든다.
ARCHIVE_SHA256=""
if [ "$RELEASE" -eq 1 ]; then
  step "GitHub Release 발행 — ${REPO_SLUG} ${VERSION}"
  ARCHIVE_SHA256="$(sha256_of "$ARCHIVE")"
  ARCHIVE_BYTES="$(stat -c %s "$ARCHIVE")"
  NOTES="$(mktemp)"
  {
    cat "${BUNDLE}/RELEASE_NOTES.md"
    printf '\n## 운반 아카이브 — 이 릴리스의 자산\n\n'
    printf -- '- 파일: `%s` · %s 바이트\n' "$(basename "$ARCHIVE")" "$ARCHIVE_BYTES"
    printf -- '- SHA-256: `%s` — 받은 파일의 `sha256sum`과 같아야 하고, GitHub API가 주는 자산 `digest`와도 같다\n' "$ARCHIVE_SHA256"
    printf -- '- 사내 취득: `GH_TOKEN=<읽기 토큰> gh release download %s -R %s -p '"'"'*.tar.gz'"'"'` — 절차는 번들 안 `deploy/single-host/RUNBOOK.md` 2.B 1단계\n' "$VERSION" "$REPO_SLUG"
  } > "$NOTES"
  # 실패하면 방금 만든 것을 되돌린다 — 반쯤 발행된 릴리스를 남기지 않는다.
  RELEASE_ID=""
  undo_release() {
    printf '되돌린다: 릴리스 %s 삭제\n' "$VERSION" >&2
    [ -n "$RELEASE_ID" ] && { gh api -X DELETE "repos/${REPO_SLUG}/releases/${RELEASE_ID}" >/dev/null 2>&1 || printf '경고: 릴리스 삭제 실패 — 직접 지워야 한다\n' >&2; }
    if [ "$TAG_EXISTED" -eq 0 ]; then
      git push origin ":refs/tags/${VERSION}" >/dev/null 2>&1 || true   # 발행 전에 실패했으면 태그는 아직 없다
    fi
  }
  # **초안 → 자산 → 발행 순서다.** immutable releases가 켜진 저장소에서는 발행 뒤 자산을 붙일 수
  # 없으므로(GitHub가 권하는 순서), 자산이 전부 붙은 초안을 발행한다. 태그는 발행 시점에 만들어진다.
  gh release create "$VERSION" -R "$REPO_SLUG" --draft --target "$UPSTREAM_COMMIT" \
    --title "PR Search ${VERSION}" --notes-file "$NOTES" "$ARCHIVE" >/dev/null \
    || { rm -f "$NOTES"; die "릴리스 초안 생성에 실패했다"; }
  rm -f "$NOTES"
  RELEASE_ID="$(gh api "repos/${REPO_SLUG}/releases?per_page=100" --jq ".[] | select(.draft and .tag_name == \"${VERSION}\") | .id" | head -1)"
  [ -n "$RELEASE_ID" ] || die "만든 초안을 찾지 못했다 — GitHub에서 초안을 확인하라"
  gh api -X PATCH "repos/${REPO_SLUG}/releases/${RELEASE_ID}" -F draft=false >/dev/null \
    || { undo_release; die "초안을 발행하지 못했다"; }

  # **발행한 것을 다시 읽어 본다** (DEV-519의 규율). 이름·크기·digest가 로컬과 다르면
  # 되돌리고 실패한다. digest는 GitHub가 자산마다 계산해 API로 주는 값이다.
  step "발행한 자산 대조"
  ASSET_LINE="$(gh api "repos/${REPO_SLUG}/releases/tags/${VERSION}" \
    --jq '.assets[] | select(.name | endswith(".tar.gz")) | "\(.name) \(.size) \(.digest // "none")"' 2>/dev/null || true)"
  REMOTE_NAME="${ASSET_LINE%% *}"; REST="${ASSET_LINE#* }"; REMOTE_SIZE="${REST%% *}"; REMOTE_DIGEST="${REST#* }"
  if [ "$REMOTE_NAME" != "$(basename "$ARCHIVE")" ]; then undo_release; die "발행된 자산 이름이 다르다: ${REMOTE_NAME:-없음}"; fi
  if [ "$REMOTE_SIZE" != "$ARCHIVE_BYTES" ]; then undo_release; die "발행된 자산 크기가 다르다: 원격 ${REMOTE_SIZE} · 로컬 ${ARCHIVE_BYTES}"; fi
  if [ "$REMOTE_DIGEST" != "sha256:${ARCHIVE_SHA256}" ]; then undo_release; die "발행된 자산 digest가 다르다: 원격 ${REMOTE_DIGEST} · 로컬 sha256:${ARCHIVE_SHA256}"; fi
fi

printf '\n번들 완료\n'
printf '  번들 디렉터리 : %s  (%s)\n' "$BUNDLE"  "$(du -sh "$BUNDLE"  | cut -f1)"
printf '  운반 아카이브 : %s  (%s)\n' "$ARCHIVE" "$(du -sh "$ARCHIVE" | cut -f1)"
printf '\n사내 반입 파일 : %s\n' "$(basename "$ARCHIVE")"
printf '반입 절차      : 아카이브 안의 deploy/single-host/RUNBOOK.md\n'
if [ "$RELEASE" -eq 1 ]; then
  printf '\nGitHub Release : https://github.com/%s/releases/tag/%s  (태그 %s → %s)\n' "$REPO_SLUG" "$VERSION" "$VERSION" "$UPSTREAM_COMMIT"
  printf '자산 SHA-256   : %s\n' "$ARCHIVE_SHA256"
  case "$IMMUTABLE" in
    true)  printf 'immutable releases : 켜짐 — 발행 뒤 자산·태그가 잠긴다\n' ;;
    false) printf 'immutable releases : 꺼짐 — 쓰기 권한자가 발행 뒤에도 자산·태그를 바꿀 수 있다. 켜는 것을 권한다 (런북 2장 「경계」)\n' ;;
    *)     printf 'immutable releases : 알 수 없음 (API 응답 없음)\n' ;;
  esac
  printf '\n사내 운영자에게 릴리스와 별도 채널로 전달할 것 셋: 버전 %s · 읽기 토큰 · 자산 SHA-256 (위 값) — DEV-530\n' "$VERSION"
  printf '\n사내에서 받는 명령 (런북 2.B 1단계):\n'
  printf '  GH_TOKEN=<읽기 토큰> gh release download %s -R %s -p '"'"'*.tar.gz'"'"'\n' "$VERSION" "$REPO_SLUG"
  printf '  sha256sum %s   # 위 SHA-256과 같아야 한다\n' "$(basename "$ARCHIVE")"
  printf '  tar -xzf %s\n' "$(basename "$ARCHIVE")"
else
  printf '\n발행하지 않았다 (--release 없음). github.com에 닿는 사내라면 --release로 발행해 받게 한다.\n'
fi
