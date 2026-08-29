import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolvePackage = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * 성능 시험: 실제 Elasticsearch에 붙어 지연을 잰다 (WP-037 / DEV-058).
 *
 * ## 두 수준을 구분한다
 *
 * **Level A — 여기서 도는 것.** 결정적인 합성 데이터셋 위에서 요청 수와 지연
 * 분포를 재어 **알고리즘 회귀**를 잡는다: N+1, 조회 시점 `script`, 버킷 수에
 * 비례해 늘어나는 왕복. 크기는 `PERF_DATASET_SIZE`로 조절한다.
 *
 * **Level B — Gate 5.** `NFR-001`이 요구하는 릴리스 규모(PR 1,000,000 · 커밋
 * 10,000,000)의 실측이다. **이 환경에서 돌지 않으며, 여기 수치를 그 통과로
 * 적지 않는다** — 작은 픽스처의 200ms는 큰 데이터의 p95에 대해 아무 말도 하지
 * 않는다.
 *
 * 같은 harness가 두 규모를 모두 돈다. 두 구현으로 나누면 Level B를 실제로 돌릴
 * 수 있게 된 날 그것이 한 번도 실행된 적 없는 코드가 된다.
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
      '@prs/github': resolvePackage('github'),
      '@prs/bus': resolvePackage('bus'),
      '@prs/authz': resolvePackage('authz'),
    },
  },
  test: {
    include: ['perf/**/*.perf.test.ts'],
    environment: 'node',
    fileParallelism: false,
    // 데이터셋을 만들고 재는 시험이라 단위 시험보다 넉넉하다.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
