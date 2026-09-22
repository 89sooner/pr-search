import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolvePackage = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * 도메인 회귀 시험 (CR-025 DEV-120 / 릴리스 검증 계획 7·8장, Gate 7).
 *
 * **이 계층이 따로 있는 이유.** 단위·통합 시험은 "코드가 설계대로 도는가"를
 * 묻는다. 회귀 시험은 **"우리가 낸 답이 진짜와 같은가"**를 묻는다 — 시퀀스가
 * `git rev-list --first-parent`와 같은지, 범위 조회가 `git log A..B`와 같은지.
 * 이 제품은 그 대조 가능성이 존재 이유이므로(ADR-007), 그것을 검사하는 시험이
 * 다른 시험에 섞여 조용히 건너뛰어지면 안 된다.
 *
 * 릴리스 검증 계획 8장의 정확성 항목(ACC-01~08)이 여기로 모인다.
 * **지금 채워진 것은 ACC-02(시퀀스-git 일치)뿐이다** — 나머지는 그 기능을
 * 내는 WP가 채운다. 빈 통을 만들어 놓고 "회귀 시험이 있다"고 적지 않는다.
 *
 * 실행: `pnpm test:regression`
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
      '@prs/db/migrate': fileURLToPath(new URL('./packages/db/src/migrate.ts', import.meta.url)),
      '@prs/db': resolvePackage('db'),
      // 접두가 겹친다 — `@prs/github`가 앞서면 `@prs/github-annotate`·`@prs/github-tag`가 그것으로 잡힌다.
      '@prs/github-annotate': resolvePackage('github-annotate'),
      '@prs/github-tag': resolvePackage('github-tag'),
      // 서브패스가 먼저다 — `@prs/gh-cli`가 앞서면 `/node`가 진입점으로 잡힌다.
      '@prs/gh-cli/node': fileURLToPath(new URL('./packages/gh-cli/src/node.ts', import.meta.url)),
      '@prs/gh-cli': resolvePackage('gh-cli'),
      '@prs/github': resolvePackage('github'),
      '@prs/bus': resolvePackage('bus'),
      '@prs/authz': resolvePackage('authz'),
    },
  },
  test: {
    include: ['regression/**/*.test.ts'],
    environment: 'node',
    // 합성 저장소를 만들고 지우므로 서로 밟지 않게 직렬로 돈다.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
