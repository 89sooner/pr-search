#!/usr/bin/env bash
#
# 반입 번들에 들어갈 **바로 그 이미지**를 실제로 띄워 검사한다 (`CR-078` / `DEV-577`).
#
#   ./smoke-images.sh <version> [app-tar]
#
# `app-tar`를 주면 그 tar에서 이미지를 다시 `docker load`한 뒤 검사한다 —
# 사내가 받는 것은 빌드 트리가 아니라 tar이므로, **저장·적재 경계를 건넌
# 이미지**를 검사해야 검사한 것이 반입되는 것과 같다.
#
# ## 왜 이 게이트가 생겼는가
#
# `0.1.0-pilot.3`은 다음을 전부 통과하고도 사내에서 막혔다.
#
#   단위·통합·회귀 시험 통과
#   `next build` 성공
#   `docker build` 성공
#   컨테이너 healthcheck 통과
#
# 그런데 **사람이 여는 화면은 전부 500이었다.** 위 넷 중 어느 것도 "실제
# 이미지가 실제 SSR 요청을 처리하는가"를 묻지 않았기 때문이다. 이 스크립트가
# 그 질문을 한다.
#
# ## 무엇에 의존하지 않는가
#
# **네트워크를 끊고 돌린다** (`--network none`). GHE·IdP·PostgreSQL·
# Elasticsearch·Redis 중 어느 것도 필요하지 않다 — 필요해지는 순간 이 게이트는
# 빌더의 환경에 따라 답이 달라지고, 그러면 게이트가 아니라 잡음이다.
# `AUTH_ENABLED=false`인 화면은 셸을 세우고 조회만 프록시가 막으므로 백킹
# 서비스 없이도 SSR 경로 전체가 실제로 돈다.

set -Eeuo pipefail

die() { printf '오류: %s\n' "$*" >&2; exit 1; }
step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
pass() { printf '  ✓ %s\n' "$*"; }

VERSION="${1:?사용법: smoke-images.sh <version> [app-tar]}"
APP_TAR="${2:-}"

command -v docker >/dev/null || die "docker가 없다"

WEB_IMAGE="prs/web:${VERSION}"
WORKER_IMAGE="prs/pipeline-worker:${VERSION}"
EXECUTOR_IMAGE="prs/gh-executor:${VERSION}"
SEARCH_API_IMAGE="prs/search-api:${VERSION}"

CONTAINERS=()
cleanup() { for c in "${CONTAINERS[@]:-}"; do [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT

# ── 저장·적재 경계 ──────────────────────────────────────────────
# **빌드 직후의 이미지가 아니라 tar에서 나온 이미지를 검사한다.**
if [ -n "$APP_TAR" ]; then
  step "이미지 tar 재적재 — $(basename "$APP_TAR")"
  [ -f "$APP_TAR" ] || die "이미지 tar이 없다: $APP_TAR"
  BEFORE_WEB="$(docker image inspect "$WEB_IMAGE" --format '{{.Id}}' 2>/dev/null || echo '')"
  docker load -i "$APP_TAR" >/dev/null || die "이미지 tar을 적재하지 못한다: $APP_TAR"
  AFTER_WEB="$(docker image inspect "$WEB_IMAGE" --format '{{.Id}}' 2>/dev/null || echo '')"
  [ -n "$AFTER_WEB" ] || die "tar을 적재했는데 ${WEB_IMAGE}가 없다"
  if [ -n "$BEFORE_WEB" ] && [ "$BEFORE_WEB" != "$AFTER_WEB" ]; then
    die "tar의 web 이미지가 방금 빌드한 것과 다르다 (${BEFORE_WEB} → ${AFTER_WEB})"
  fi
  pass "tar에서 적재한 ${WEB_IMAGE} = ${AFTER_WEB}"
fi

docker image inspect "$WEB_IMAGE"    >/dev/null 2>&1 || die "이미지가 없다: $WEB_IMAGE"
docker image inspect "$WORKER_IMAGE" >/dev/null 2>&1 || die "이미지가 없다: $WORKER_IMAGE"
docker image inspect "$EXECUTOR_IMAGE" >/dev/null 2>&1 || die "이미지가 없다: $EXECUTOR_IMAGE"
docker image inspect "$SEARCH_API_IMAGE" >/dev/null 2>&1 || die "이미지가 없다: $SEARCH_API_IMAGE"

# ── 1. web이 실제 SSR 요청을 처리한다 ───────────────────────────
step "web 런타임 — 정상 구성으로 기동하고 화면을 낸다"
NAME="prs-smoke-web-$$-${RANDOM}"; CONTAINERS+=("$NAME")
docker run -d --name "$NAME" --network none \
  -e NODE_ENV=production \
  -e WEB_PORT=3000 \
  -e SEARCH_API_URL=http://127.0.0.1:9 \
  -e AUTH_ENABLED=false \
  -e SESSION_COOKIE_SECURE=true \
  "$WEB_IMAGE" >/dev/null || die "web 컨테이너를 만들지 못한다"

READY=0
for _ in $(seq 1 60); do
  if ! docker ps -q -f "name=^${NAME}$" | grep -q .; then
    docker logs "$NAME" 2>&1 | tail -30 >&2
    die "web 컨테이너가 기동 중에 죽었다 — 정상 구성인데 서지 못한다"
  fi
  if docker exec "$NAME" node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 1
done
[ "$READY" -eq 1 ] || { docker logs "$NAME" 2>&1 | tail -30 >&2; die "web이 60초 안에 /healthz 200을 내지 못한다"; }
pass "기동과 /healthz 200"

# **사람이 여는 화면을 실제로 요청한다.** `/healthz`만 보는 것이 이 결함을
# 놓친 이유이므로, 대표 화면을 라우트 종류별로 고른다: 진입(`/`), 검색 화면,
# 목록 화면, 상세 화면, API 프록시.
SSR_PATHS='/ /search /releases /repositories /ranges /analytics /saved-searches /ops/pipeline /pr/acme/web/1 /commit/acme/web/abcdef1234567'
FAILED=""
for path in $SSR_PATHS; do
  code="$(docker exec "$NAME" node -e "
    fetch('http://127.0.0.1:3000${path}')
      .then(r => { console.log(r.status); process.exit(0); })
      .catch(e => { console.log('ERR ' + e.message); process.exit(0); })" 2>&1 | tail -1)"
  [ "$code" = "200" ] || FAILED="${FAILED}\n    ${path} → ${code}"
done
if [ -n "$FAILED" ]; then
  docker logs "$NAME" 2>&1 | tail -40 >&2
  die "$(printf 'SSR 화면이 200이 아니다:%b' "$FAILED")"
fi
pass "대표 SSR 화면 $(printf '%s' "$SSR_PATHS" | wc -w)종이 모두 200"

# API 프록시는 인증이 없으므로 401이 옳다. **500이면 안 된다** — 그 구분이
# "구성 때문에 죽는 것"과 "설계대로 막는 것"을 가른다.
proxy="$(docker exec "$NAME" node -e "
  fetch('http://127.0.0.1:3000/api/health').then(r=>{console.log(r.status);process.exit(0)}).catch(()=>{console.log('ERR');process.exit(0)})" 2>&1 | tail -1)"
[ "$proxy" != "500" ] || die "API 프록시가 500이다"
pass "API 프록시가 ${proxy} (500이 아니다)"

# ── 2. 런타임 모듈 해석이 실제로 끝난다 ─────────────────────────
# **`DEV-551`의 불변식을 산출물에서 잰다.** Turbopack이 해시 이름으로 외부화한
# 모듈을 `next start`가 런타임에 불러온다. 배포 트리에 그 이름이 없으면 모든
# SSR이 500이 된다. 이름을 박지 않고 `.next`의 파일 추적 기록에서 읽어,
# **컨테이너 안의 Node가 실제로 해석할 수 있는지**를 확인한다 — 디렉터리가
# 있는지가 아니라 해석되는지를 본다.
step "web 런타임 — 외부 모듈이 실제로 해석된다"
docker exec "$NAME" node -e '
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join } = require("node:path");
const EXTERNAL = /(?:^|\/)node_modules\/([a-z0-9@._-]+-[0-9a-f]{16})$/;
function* walk(dir) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else if (e.name.endsWith(".nft.json")) yield p;
  }
}
const names = new Set();
for (const trace of walk("/app/.next")) {
  let files; try { files = JSON.parse(readFileSync(trace, "utf8")).files ?? []; } catch { continue; }
  for (const f of files) { const m = EXTERNAL.exec(f); if (m) names.add(m[1]); }
}
if (names.size === 0) {
  console.error("해시 이름의 외부 모듈을 하나도 찾지 못했다 — 추적 형식이 바뀌었거나 결함이 사라졌다. 사람이 봐야 한다 (DEV-551).");
  process.exit(1);
}
const broken = [];
for (const name of [...names].sort()) {
  try { require.resolve(name, { paths: ["/app"] }); } catch (e) { broken.push(`${name}: ${e.code ?? e.message}`); }
}
if (broken.length > 0) {
  console.error("배포 트리에서 해석되지 않는 외부 모듈:\n  " + broken.join("\n  "));
  process.exit(1);
}
console.log(`  ✓ 해시 외부 모듈 ${names.size}종이 모두 해석된다: ${[...names].sort().join(", ")}`);
' || die "런타임 모듈 해석에 실패했다 (DEV-551 재발)"

# ── 3. 손으로 고칠 필요가 없다 ──────────────────────────────────
# 사내가 `npm install`을 실행해야 하는 상태로 반입되지 않는다. 그 조치는
# `upgrade` 한 번에 사라지므로 형상이 아니라 결함이다.
step "web 런타임 — 손 조치 없이 완결된다"
docker exec "$NAME" sh -c '[ ! -e /app/package-lock.json ] && [ ! -e /app/node_modules/.package-lock.json ]' \
  || die "배포 트리에 npm 잠금 파일이 있다 — 이미지가 손으로 고쳐진 상태다"
pass "npm 잠금 파일 없음 (손 조치 흔적 없음)"

# ── 4. 잘못된 구성으로는 서지 않는다 ────────────────────────────
# **이 검사가 이번 결함의 정본이다.** `0.1.0-pilot.3`은 이 구성으로 기동해서
# `/healthz`에 200을 냈고 화면만 500이었다. 이제는 기동 자체가 실패해야 한다.
step "web 런타임 — 운영 계약을 어긴 구성은 기동을 거부한다"
#
# **시간 제한을 둔다.** 고치기 전의 이미지는 이 구성으로 **죽지 않는다** —
# 계속 서서 모든 요청에 500을 낸다. 시간 제한이 없으면 검사가 실패하는 대신
# 멈춰 버리고, 멈춘 게이트는 사람이 죽여서 넘기게 되므로 게이트가 아니다.
#
# **거부의 근거까지 본다.** 종료 코드만 보면 무관한 기동 크래시도 통과한다.
# 기동 검증이 낸 머리말을 확인해 「구성 때문에 거부했다」와 「어쩌다 죽었다」를
# 가른다.
REJECT_MARK='web 구성이 성립하지 않아 기동할 수 없다'
expect_rejected() { # 라벨 그리고 환경 변수들
  local label="$1"; shift
  local name="prs-smoke-reject-$$-${RANDOM}"; CONTAINERS+=("$name")
  local out rc
  set +e
  out="$(timeout "${SMOKE_REJECT_TIMEOUT_S:-45}" docker run --name "$name" --network none \
    -e NODE_ENV=production -e WEB_PORT=3000 -e SEARCH_API_URL=http://127.0.0.1:9 \
    "$@" "$WEB_IMAGE" 2>&1)"
  rc=$?
  set -e
  case "$rc" in
    124)
      printf '%s\n' "$out" | tail -20 >&2
      die "${label} 구성으로 띄웠는데 **죽지 않는다** — 잘못된 배포가 다시 초록으로 서고 화면만 500이 된다 (DEV-577)"
      ;;
    0) die "${label} 구성으로 기동한 뒤 정상 종료했다 — 계약이 이행되지 않았다 (DEV-577)" ;;
  esac
  printf '%s' "$out" | grep -qF "$REJECT_MARK" \
    || { printf '%s\n' "$out" | tail -20 >&2; die "${label}: 죽기는 했으나 기동 검증이 거부한 것이 아니다 — 다른 이유로 크래시했다"; }
  pass "${label} → 종료 코드 ${rc}로 거부하고 이유를 로그에 남긴다"
}

# **허용해야 하는 구성이 실제로 서는가.**
#
# 거부 검사만 있으면 게이트가 한 방향으로만 정직하다. 계약이 넓어졌을 때 옛
# 기대가 남아 있으면 거부 검사는 조용히 통과하는데(막고 있으니까) **서야 할
# 배포가 서지 못한다.** 두 방향을 함께 걸어야 게이트가 계약을 따라온다.
expect_accepted() { # 라벨 그리고 환경 변수들
  local label="$1"; shift
  local name="prs-smoke-accept-$$-${RANDOM}"; CONTAINERS+=("$name")

  docker run -d --name "$name" --network none \
    -e NODE_ENV=production -e WEB_PORT=3000 -e SEARCH_API_URL=http://127.0.0.1:9 \
    "$@" "$WEB_IMAGE" >/dev/null || die "${label}: 컨테이너를 만들지 못한다"

  local ready=0
  for _ in $(seq 1 60); do
    if ! docker ps -q -f "name=^${name}$" | grep -q .; then
      docker logs "$name" 2>&1 | tail -20 >&2
      die "${label} 구성으로 기동하지 못한다 — 허용해야 할 형상을 막고 있다 (CR-083)"
    fi
    if docker exec "$name" node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      ready=1; break
    fi
    sleep 1
  done
  [ "$ready" -eq 1 ] || { docker logs "$name" 2>&1 | tail -20 >&2; die "${label}: 60초 안에 /healthz 200을 내지 못한다"; }
  pass "${label} → 기동하고 /healthz 200"
}

# **기동해야 하는 구성도 실제로 기동하는지 본다** (`CR-083`, `DEV-615`).
#
# 거부만 검사하면 계약이 넓어졌을 때 이 게이트가 **반대 방향으로 거짓말한다** —
# 허용해야 할 형상을 막고 있어도 아무것도 죽지 않는다. `CR-083`이 실제로 그렇게
# 어긋났고, 그때 번들이 통째로 반입 불가 판정을 받았다.
expect_accepted "AUTH_ENABLED=false 명시 + insecure 쿠키 (파일럿 형상)" \
  -e AUTH_ENABLED=false -e SESSION_COOKIE_SECURE=false

# **두 번째 면제 — 인증을 켠 평문 HTTP 파일럿** (`CR-091`). `ALLOW_INSECURE_COOKIES=true`를 함께 적으면 서야 하고,
# **기동 로그에 그 위험을 남겨야 한다.** 서기만 하고 말하지 않으면 파일럿 형상이 조용히 운영이 된다.
PILOT_GHE=(-e AUTH_ENABLED=true -e SESSION_COOKIE_SECURE=false -e AUTH_PROVIDER=github
  -e GHE_BASE_URL=http://ghe.invalid -e GHE_OAUTH_CLIENT_ID=c -e GHE_OAUTH_CLIENT_SECRET=s
  -e GHE_OAUTH_REDIRECT_URI=http://prs.invalid/auth/callback)
expect_accepted "ALLOW_INSECURE_COOKIES=true + insecure 쿠키 + 인증 켬 (평문 HTTP 파일럿, CR-091)" \
  "${PILOT_GHE[@]}" -e ALLOW_INSECURE_COOKIES=true
PILOT_LOG="$(docker logs "${CONTAINERS[${#CONTAINERS[@]}-1]}" 2>&1)"
printf '%s' "$PILOT_LOG" | grep -qF '경고: ALLOW_INSECURE_COOKIES=true' \
  || { printf '%s\n' "$PILOT_LOG" | tail -20 >&2; die "평문 HTTP 파일럿으로 섰는데 기동 로그에 경고가 없다 (CR-091)"; }
pass "평문 HTTP 파일럿 → 기동 로그에 받아들인 위험을 경고한다"

# 플래그만으로는 서지 않는다는 쪽과, 모르는 값은 거부한다는 쪽 (`CR-091`).
expect_rejected "인증을 켠 insecure 쿠키에 플래그 없음 (GHE)" "${PILOT_GHE[@]}"
expect_rejected "ALLOW_INSECURE_COOKIES=yes (모르는 값)" "${PILOT_GHE[@]}" -e ALLOW_INSECURE_COOKIES=yes

# 이번 사내 반입을 막은 구성.
#
# **의도를 적지 않은 배포는 면제되지 않는다** (`CR-083`). `AUTH_ENABLED`를 주지
# 않으면 자격 증명을 나중에 채우는 순간 인증이 켜지므로, 그 배포는 서지 못한다.
expect_rejected "SESSION_COOKIE_SECURE=false (의도 미선언)" -e SESSION_COOKIE_SECURE=false

# **그 값을 남긴 채 인증만 켜면 다시 막는다** (`CR-083`).
#
# `CR-078`이 이 계약을 세울 때 적은 우려가 이것이다 — 「지금은 안 쓰니까」로 열어
# 두면 **열린 채로 켜진다.** OIDC 값을 채워 두어 쿠키 말고 다른 이유로 거부되는
# 일이 없게 한다.
expect_rejected "insecure 쿠키를 남긴 채 인증을 켠다" \
  -e AUTH_ENABLED=true -e SESSION_COOKIE_SECURE=false \
  -e OIDC_ISSUER=https://idp.invalid -e OIDC_CLIENT_ID=c -e OIDC_CLIENT_SECRET=s \
  -e OIDC_REDIRECT_URI=https://prs.invalid/auth/callback

# **같은 유형의 구성 하나 더** (`DEV-579`). 인증을 켰는데 OIDC 값이 없으면 화면이
# 전부 로그인으로 가고 그 라우트가 500을 낸다 — 컨테이너는 초록인데 아무도
# 로그인할 수 없다. `OIDC_REDIRECT_URI`가 배포 정의에서 빠져 있던 자리다.
expect_rejected "AUTH_ENABLED=true·OIDC 없음" -e AUTH_ENABLED=true -e SESSION_COOKIE_SECURE=true

# **GHE 공급자도 같은 계약을 받는다** (`CR-083`). 공급자를 바꾸면 자격의 이름이
# 바뀌지만 「켰으면 자격이 있어야 한다」는 규칙은 그대로다.
expect_rejected "AUTH_PROVIDER=github·GHE OAuth 자격 없음" \
  -e AUTH_ENABLED=true -e SESSION_COOKIE_SECURE=true -e AUTH_PROVIDER=github

# ── 5. pipeline-worker의 git ────────────────────────────────────
# **미러와 커밋 그래프가 `git`을 spawn한다** (`DEV-572`). 없으면 `ENOENT`로
# 죽는데 그것도 기동 시점에는 드러나지 않는다.
step "pipeline-worker 런타임 — git이 실제로 실행된다"
GIT_VERSION="$(docker run --rm --network none --entrypoint git "$WORKER_IMAGE" --version 2>&1)" \
  || die "pipeline-worker 이미지에서 git이 실행되지 않는다 (DEV-572 재발)"
pass "${GIT_VERSION}"

# ── 6. gh-executor — 고정 gh, 꺼진 채 기동, 켜면 자격 요구 ─────
# REL-007 R0 (WP-077 / CR-086). **번들 기본 형상은 이 서비스를 세우지 않는다**(선택
# 프로파일). 그래도 이미지가 번들에 들어가므로 세 가지를 실제 이미지로 본다:
#   (a) 고정 gh가 들어 있고 바이너리 SHA-256이 `packages/gh-cli/src/pin.ts`의 값과 같다
#       (FR-GH-011). 회귀가 아래 두 리터럴이 pin.ts와 같은지 건다.
#   (b) 꺼진 상태(`GH_OPERATIONS_ENABLED=false`)로 비루트·읽기 전용 루트·네트워크 없음에서
#       기동하고 `/healthz`가 200과 `execution: disabled`를 낸다 — 꺼진 실행기는 백킹
#       서비스를 묻지 않는다.
#   (c) 켰는데 봉인 키가 없으면 기동을 거부한다 (`CR-078`의 규율).
step "gh-executor 런타임 — 고정 gh와 해시"
GH_VERSION_OUT="$(docker run --rm --network none --entrypoint gh "$EXECUTOR_IMAGE" --version 2>&1 | head -1)" \
  || die "gh-executor 이미지에서 gh가 실행되지 않는다"
printf '%s' "$GH_VERSION_OUT" | grep -qF 'gh version 2.97.0 ' || die "고정 버전이 아니다: ${GH_VERSION_OUT}"
GH_BIN_HASH="$(docker run --rm --network none --entrypoint sha256sum "$EXECUTOR_IMAGE" /usr/local/bin/gh | cut -d' ' -f1)"
[ "$GH_BIN_HASH" = "141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409" ] \
  || die "gh 바이너리 SHA-256이 고정 값과 다르다: ${GH_BIN_HASH}"
pass "${GH_VERSION_OUT} · SHA-256 ${GH_BIN_HASH:0:12}…"

step "gh-executor 런타임 — 꺼진 상태로 비루트·읽기 전용에서 기동한다"
GHX="prs-smoke-ghx-$$"; CONTAINERS+=("$GHX")
docker run -d --name "$GHX" --network none --read-only \
  --tmpfs /tmp:size=64m --tmpfs /var/lib/prs/gh-workspaces:size=64m,mode=0700,uid=1000,gid=1000 \
  -e NODE_ENV=production -e GH_OPERATIONS_ENABLED=false -e GHE_BASE_URL=https://ghe.invalid \
  -e DATABASE_URL=postgres://smoke:smoke@127.0.0.1:9/smoke -e REDIS_URL=redis://127.0.0.1:9 \
  "$EXECUTOR_IMAGE" >/dev/null || die "gh-executor 컨테이너를 만들지 못한다"
GHX_READY=0; GHX_BODY=""
for _ in $(seq 1 30); do
  if ! docker ps -q -f "name=^${GHX}$" | grep -q .; then
    docker logs "$GHX" 2>&1 | tail -20 >&2; die "gh-executor가 꺼진 상태로도 기동하지 못한다"
  fi
  if GHX_BODY="$(docker exec "$GHX" wget -qO- http://127.0.0.1:3004/healthz 2>/dev/null)"; then GHX_READY=1; break; fi
  sleep 1
done
[ "$GHX_READY" -eq 1 ] || { docker logs "$GHX" 2>&1 | tail -20 >&2; die "gh-executor가 30초 안에 /healthz 200을 내지 못한다"; }
case "$GHX_BODY" in
  *'"status":"ok"'*'"execution":"disabled"'*) ;;
  *) die "gh-executor /healthz가 꺼짐을 정직하게 말하지 않는다: ${GHX_BODY}" ;;
esac
[ "$(docker exec "$GHX" id -u)" = 1000 ] || die "gh-executor가 비루트로 돌지 않는다"
pass "기동 · /healthz 200 · execution: disabled · uid 1000 · 읽기 전용 루트"

step "gh-executor 런타임 — 켰는데 봉인 키가 없으면 거부한다"
set +e
GHX_OUT="$(timeout "${SMOKE_REJECT_TIMEOUT_S:-45}" docker run --rm --network none \
  -e NODE_ENV=production -e GH_OPERATIONS_ENABLED=true -e GHE_BASE_URL=https://ghe.invalid \
  -e DATABASE_URL=postgres://smoke:smoke@127.0.0.1:9/smoke -e REDIS_URL=redis://127.0.0.1:9 \
  "$EXECUTOR_IMAGE" 2>&1)"
GHX_RC=$?
set -e
case "$GHX_RC" in
  124) die "GH_OPERATIONS_ENABLED=true·봉인 키 없음으로 띄웠는데 **죽지 않는다** — 켜 놓고 빈 배포가 초록으로 선다" ;;
  0)   die "GH_OPERATIONS_ENABLED=true·봉인 키 없음으로 기동한 뒤 정상 종료했다 — 계약이 이행되지 않았다" ;;
esac
printf '%s' "$GHX_OUT" | grep -qF 'GH_IDENTITY_VAULT_KEY' \
  || { printf '%s\n' "$GHX_OUT" | tail -5 >&2; die "죽기는 했으나 구성 거부가 아니다 — 다른 이유로 크래시했다"; }
pass "종료 코드 ${GHX_RC}로 거부하고 빠진 값을 로그에 남긴다"

# ── search-api의 관리자 지정 역할 명령 ─────────────────────────────
# **`prsctl role`은 이 이미지의 `dist/role-cli.js`를 부른다** (`CR-091`). 세션 인증 배포에서 `operator`를 얻는 유일한
# 경로이므로, 배포 트리에서 모듈이 해석되지 않으면 사내에서 운영 콘솔이 통째로 닫힌다(`DEV-551`과 같은 종류의 실패).
# 인자 없이 부르면 DB에 닿기 전에 사용법을 내고 2로 끝난다 — 네트워크 없이 진입점과 의존 해석을 함께 본다.
step "search-api 이미지 — 관리자 지정 역할 명령이 배포 트리에서 실행된다 (CR-091)"
set +e
ROLE_OUT="$(docker run --rm --network none --entrypoint node "$SEARCH_API_IMAGE" dist/role-cli.js 2>&1)"
ROLE_RC=$?
set -e
[ "$ROLE_RC" -eq 2 ] && printf '%s' "$ROLE_OUT" | grep -qF 'prsctl role grant' \
  || { printf '%s\n' "$ROLE_OUT" | tail -10 >&2; die "search-api 이미지의 role-cli가 사용법을 내지 않는다 (종료 코드 ${ROLE_RC}) — prsctl role이 사내에서 실패한다"; }
pass "node dist/role-cli.js → 종료 코드 2와 사용법 (DB 접속 전)"

printf '\n번들 이미지 런타임 검사 통과 — %s\n' "$VERSION"
