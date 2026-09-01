# syntax=docker/dockerfile:1
#
# PR Search 애플리케이션 이미지 (WP-070 / CR-059 / ADR-021).
#
# **하나의 정의가 배포 단위 다섯을 낸다** — `--target`으로 고른다. 워크스페이스
# 빌드가 공통이므로 정의를 앱마다 나누면 그 공통 부분이 갈라진다.
#
#   docker build --target search-api     -t prs/search-api:<version> .
#   docker build --target ingest-gateway -t prs/ingest-gateway:<version> .
#   docker build --target pipeline-worker -t prs/pipeline-worker:<version> .
#   docker build --target web            -t prs/web:<version> .
#   docker build --target migrate        -t prs/db:<version> .
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
COPY --from=deploy-pipeline-worker /out /app
EXPOSE 3003
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
FROM build AS deploy-web
RUN pnpm deploy --legacy --filter @prs/web --prod /out \
 && rm -rf /out/.next/cache /out/e2e /out/a11y /out/test-results

FROM base AS web
COPY --from=deploy-web /out /app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000"]
