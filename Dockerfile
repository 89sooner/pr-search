# syntax=docker/dockerfile:1
#
# PR Search 애플리케이션 이미지 (WP-070 / CR-059 / ADR-021).
#
# **하나의 정의가 배포 단위 여섯을 낸다** — `--target`으로 고른다. 워크스페이스
# 빌드가 공통이므로 정의를 앱마다 나누면 그 공통 부분이 갈라진다.
#
#   docker build --target search-api     -t prs/search-api:<version> .
#   docker build --target ingest-gateway -t prs/ingest-gateway:<version> .
#   docker build --target pipeline-worker -t prs/pipeline-worker:<version> .
#   docker build --target web            -t prs/web:<version> .
#   docker build --target migrate        -t prs/db:<version> .
#   docker build --target gh-executor    -t prs/gh-executor:<version> .
#
# **런타임 이미지는 외부 네트워크를 요구하지 않는다.** 의존성은 빌드 시점에
# 실체화되고, 기동은 PostgreSQL·Elasticsearch·Redis·GHE로만 나간다.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV CI=1

# 워크스페이스 전체를 한 번에 빌드한다. 패키지가 서로를 참조하고
# `tsc --build`가 프로젝트 참조 그래프를 한 번에 푸는 것이 이 저장소의 정본이다.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# --- Node 서비스 ---
#
# `pnpm deploy --legacy --prod`가 워크스페이스 의존성을 **실체화**한다.
# `--legacy`가 필요한 것은 pnpm 10이 기본으로 injected workspace를 요구하기
# 때문이며, `.npmrc`에 `inject-workspace-packages`를 켜는 대신 이 플래그를 쓴다 —
# 그 설정은 개발·CI의 설치 방식까지 바꾼다.

FROM build AS deploy-search-api
RUN pnpm deploy --legacy --filter @prs/search-api --prod /out

FROM base AS search-api
COPY --from=deploy-search-api /out /app
EXPOSE 3002
CMD ["node", "dist/index.js"]

FROM build AS deploy-ingest-gateway
RUN pnpm deploy --legacy --filter @prs/ingest-gateway --prod /out

FROM base AS ingest-gateway
COPY --from=deploy-ingest-gateway /out /app
EXPOSE 3001
CMD ["node", "dist/index.js"]

FROM build AS deploy-pipeline-worker
RUN pnpm deploy --legacy --filter @prs/pipeline-worker --prod /out

FROM base AS pipeline-worker
RUN apk add --no-cache git
COPY --from=deploy-pipeline-worker /out /app
EXPOSE 3003
CMD ["node", "dist/index.js"]

# --- gh 실행기 (REL-007 R0 / WP-077, ADR-016, FR-GH-011) ---
#
# **고정 gh 바이너리를 빌드 시점에 내려받아 해시로 대조한다.** 버전과 두 해시(자산·
# 바이너리)의 정본은 `packages/gh-cli/src/pin.ts`이며, 셸이 그 모듈을 읽을 수 없어 여기
# 리터럴로 적는다 — 회귀가 두 곳이 같은지 건다. `latest`로 올리지 않는다.
#
# 런타임 이미지는 **비루트**(`node`, uid 1000)이고 compose가 루트 파일시스템을 읽기
# 전용으로 걸며, 쓰기는 실행별 workspace가 있는 tmpfs 한 곳뿐이다 (NFR-010).
# 실행기는 `git`을 부르지 않는다 — 이 판의 capability에 로컬 workspace가 없다.
FROM build AS deploy-gh-executor
RUN pnpm deploy --legacy --filter @prs/gh-executor --prod /out

FROM base AS gh-executor
ARG GH_VERSION=2.97.0
ARG GH_ASSET_SHA256=a2c9b8497e1f85b1ad0dfcb78b5a622e098801b8e461e459e88e1ee12f018112
ARG GH_BINARY_SHA256=141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409
RUN wget -qO /tmp/gh.tgz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
 && echo "${GH_ASSET_SHA256}  /tmp/gh.tgz" | sha256sum -c - \
 && tar -xzf /tmp/gh.tgz -C /tmp \
 && echo "${GH_BINARY_SHA256}  /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" | sha256sum -c - \
 && install -m 0755 "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
 && rm -rf /tmp/gh.tgz "/tmp/gh_${GH_VERSION}_linux_amd64" \
 && /usr/local/bin/gh --version | head -1 | grep -q "gh version ${GH_VERSION} "
COPY --from=deploy-gh-executor /out /app
RUN mkdir -p /var/lib/prs/gh-workspaces && chown node:node /var/lib/prs/gh-workspaces
USER node
EXPOSE 3004
CMD ["node", "dist/index.js"]

# --- 마이그레이션 실행기 ---
#
# 별도 이미지인 이유는 **실행 주체가 다르기 때문이다.** 마이그레이션은 스키마
# 소유자로 접속하고 애플리케이션은 `prs_app`으로 접속한다 (마이그레이션 005).
# 한 이미지에 담으면 그 구분이 배포에서 사라진다.
FROM build AS deploy-migrate
RUN pnpm deploy --legacy --filter @prs/db --prod /out

FROM base AS migrate
COPY --from=deploy-migrate /out /app
CMD ["node", "dist/cli.js", "migrate"]

# --- Elasticsearch 매핑 부트스트랩 ---
FROM build AS deploy-es-bootstrap
RUN pnpm deploy --legacy --filter @prs/es --prod /out

FROM base AS es-bootstrap
COPY --from=deploy-es-bootstrap /out /app
CMD ["node", "dist/cli.js", "apply-mappings"]

# --- Next.js ---
#
# **`output: 'standalone'`을 쓰지 않는다.** 시도했고 기동에 실패했다 —
# standalone의 파일 추적이 pnpm의 심볼릭 링크 구조를 따라가지 못해
# `@swc/helpers`부터 `MODULE_NOT_FOUND`가 난다. `serverExternalPackages`로
# 지정한 `@prs/*` 넷도 추적되지 않았다. `pnpm deploy` + `next start`가
# 이 워크스페이스에서 실제로 서는 조합이다.
#
# `.next/cache`는 빌드 캐시라 런타임에 필요 없다. `.next/dev`는 `next dev`가
# 만드는 것이라 이 클린 빌드에는 아예 없다.
#
# **`pnpm deploy --prod`는 선택 의존성을 담지 않는다** (`DEV-551`). Turbopack이
# `pg`의 Cloudflare 전용 선택 의존성을 해시 이름의 외부 모듈로 승격시켜 두므로,
# 그 이름이 배포 트리에 없으면 **모든 SSR 요청이 500이 된다.** 개발 트리에서는
# 재현되지 않아 사내 반입(2026-09-07)에 가서야 드러났다. 마지막 줄이 그 이름을
# `.next`의 파일 추적 기록에서 읽어 실체화한다 — 이름을 추측하지 않으며, 하나도
# 찾지 못하면 이미지 빌드가 실패한다. 근거는 그 스크립트의 주석에 있다.
FROM build AS deploy-web
RUN pnpm deploy --legacy --filter @prs/web --prod /out \
 && rm -rf /out/.next/cache /out/e2e /out/a11y /out/test-results \
 && node scripts/materialize-turbopack-externals.mjs /out

FROM base AS web
COPY --from=deploy-web /out /app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000"]
