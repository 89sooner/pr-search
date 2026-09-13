import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * 접근성 시험 (WP-015 DoD / NFR-007, CR-018 DEV-069).
 *
 * 단위 시험(`vitest.config.ts`)과 분리한 이유는 **환경이 다르기 때문**이다 —
 * axe는 실제 DOM을 훑으므로 `jsdom`이 필요하고, 순수 함수 시험에까지 그
 * 비용을 물릴 이유가 없다.
 *
 * 이것이 DEV-032(`test:a11y` 스크립트 부재)를 닫는다.
 */

const resolvePackage = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  /*
   * `tsconfig.json`의 `jsx: preserve`는 Next.js가 직접 변환하기 위한 것이다.
   * vite는 그 설정을 읽어 JSX를 그대로 두므로 파싱이 깨진다 — 플러그인이
   * 변환을 맡아 그 문제를 없앤다.
   */
  plugins: [react()],
  resolve: {
    alias: {
      // 서브패스가 먼저다 — `@prs/authz`가 앞서면 `/roles`가 진입점으로 잡힌다.
      '@prs/authz/roles': fileURLToPath(new URL('../../packages/authz/src/roles.ts', import.meta.url)),
      '@prs/domain/audit': fileURLToPath(new URL('../../packages/domain/src/audit.ts', import.meta.url)),
      '@prs/contracts': resolvePackage('contracts'),
      '@prs/gh-cli': resolvePackage('gh-cli'),
      '@prs/query': resolvePackage('query'),
    },
  },
  test: {
    include: ['a11y/**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./a11y/setup.ts'],
  },
});
