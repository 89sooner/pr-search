import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolvePackage = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * 통합 테스트: 실제 PostgreSQL·Elasticsearch에 붙는다.
 *
 * 접속 정보는 `DATABASE_URL` 또는 `POSTGRES_*` 환경 변수에서 읽는다
 * (`@prs/db`의 `resolvePoolConfig`). 로컬에서는 `docker compose up -d`가,
 * CI에서는 서비스 컨테이너가 제공한다.
 *
 * 단위 테스트(`vitest.config.ts`)와 분리한 이유는 백킹 서비스 없이도 `pnpm test`가
 * 항상 돌아야 하기 때문이다.
 */
export default defineConfig({
  resolve: {
    alias: {
      // 서브패스가 먼저다 — 진입점 별칭이 앞서면 `/audit`이 그것으로 잡힌다.
      '@prs/domain/audit': fileURLToPath(new URL('./packages/domain/src/audit.ts', import.meta.url)),
      '@prs/domain': resolvePackage('domain'),
      '@prs/metrics': resolvePackage('metrics'),
      '@prs/contracts': resolvePackage('contracts'),
      '@prs/query': resolvePackage('query'),
      '@prs/es': resolvePackage('es'),
      // 서브패스가 먼저다 — `@prs/db`가 앞서면 `/migrate`가 진입점으로 잡힌다.
      '@prs/db/migrate': fileURLToPath(new URL('./packages/db/src/migrate.ts', import.meta.url)),
      '@prs/db': resolvePackage('db'),
      // 접두가 겹친다 — `@prs/github`가 앞서면 `@prs/github-annotate`가 그것으로 잡힌다.
      '@prs/github-annotate': resolvePackage('github-annotate'),
      // 서브패스가 먼저다 — `@prs/gh-cli`가 앞서면 `/node`가 진입점으로 잡힌다.
      '@prs/gh-cli/node': fileURLToPath(new URL('./packages/gh-cli/src/node.ts', import.meta.url)),
      '@prs/gh-cli': resolvePackage('gh-cli'),
      '@prs/github': resolvePackage('github'),
      '@prs/bus': resolvePackage('bus'),
      '@prs/authz': resolvePackage('authz'),
    },
  },
  test: {
    include: ['packages/*/integration/**/*.test.ts', 'apps/*/integration/**/*.test.ts'],
    environment: 'node',
    // 스키마를 만들고 지우는 테스트라 병렬 실행하면 서로 밟는다.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
