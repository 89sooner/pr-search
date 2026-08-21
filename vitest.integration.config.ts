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
      '@prs/domain': resolvePackage('domain'),
      '@prs/metrics': resolvePackage('metrics'),
      '@prs/contracts': resolvePackage('contracts'),
      '@prs/query': resolvePackage('query'),
      '@prs/es': resolvePackage('es'),
      '@prs/db': resolvePackage('db'),
      '@prs/github': resolvePackage('github'),
      '@prs/bus': resolvePackage('bus'),
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
