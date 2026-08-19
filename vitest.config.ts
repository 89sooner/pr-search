import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolvePackage = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // 테스트는 빌드 산출물이 아니라 소스를 직접 읽는다. pnpm build 없이도 pnpm test가 돈다.
    alias: {
      '@prs/domain': resolvePackage('domain'),
      '@prs/contracts': resolvePackage('contracts'),
      '@prs/query': resolvePackage('query'),
      '@prs/es': resolvePackage('es'),
      '@prs/db': resolvePackage('db'),
      '@prs/github': resolvePackage('github'),
      '@prs/bus': resolvePackage('bus'),
    },
  },
  test: {
    // 통합 테스트는 vitest.integration.config.ts가 따로 돌린다.
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
