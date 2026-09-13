import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolvePackage = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // 테스트는 빌드 산출물이 아니라 소스를 직접 읽는다. pnpm build 없이도 pnpm test가 돈다.
    alias: {
      // 서브패스가 먼저다 — 진입점 별칭이 앞서면 `/audit`이 그것으로 잡힌다.
      '@prs/domain/audit': fileURLToPath(new URL('./packages/domain/src/audit.ts', import.meta.url)),
      '@prs/domain': resolvePackage('domain'),
      '@prs/metrics': resolvePackage('metrics'),
      '@prs/contracts': resolvePackage('contracts'),
      '@prs/query': resolvePackage('query'),
      '@prs/es': resolvePackage('es'),
      '@prs/db': resolvePackage('db'),
      // 접두가 겹친다 — `@prs/github`가 앞서면 `@prs/github-annotate`가 그것으로 잡힌다.
      '@prs/github-annotate': resolvePackage('github-annotate'),
      // 서브패스가 먼저다 — `@prs/gh-cli`가 앞서면 `/node`가 진입점으로 잡힌다.
      '@prs/gh-cli/node': fileURLToPath(new URL('./packages/gh-cli/src/node.ts', import.meta.url)),
      '@prs/gh-cli': resolvePackage('gh-cli'),
      '@prs/github': resolvePackage('github'),
      '@prs/bus': resolvePackage('bus'),
      // 서브패스가 먼저다 — `@prs/authz`가 앞서면 `/roles`가 진입점으로 잡힌다.
      '@prs/authz/roles': fileURLToPath(new URL('./packages/authz/src/roles.ts', import.meta.url)),
      '@prs/authz': resolvePackage('authz'),
    },
  },
  test: {
    // 통합 테스트는 vitest.integration.config.ts가 따로 돌린다.
    // `testing/`은 목 서버 같은 시험 보조 코드다. 빌드 산출물에는 들어가지 않는다.
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/testing/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      // `web`은 Next.js 관례를 따라 `src/`가 아니라 `app/`·`lib/`를 쓴다.
      'apps/web/lib/**/*.test.ts',
      'apps/web/app/**/*.test.ts',
      // `instrumentation.ts`는 Next.js가 **프로젝트 루트**에 요구하므로 그 시험도
      // 거기 산다 (CR-078). 깊이 1로 좁혀 `e2e/`·`a11y/`가 딸려 오지 않게 한다.
      'apps/web/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    environment: 'node',
    reporters: ['default'],
  },
});
