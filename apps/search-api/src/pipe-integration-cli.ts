/**
 * `node dist/pipe-integration-cli.js` — PIPE 연동 운영 명령의 진입점 (CR-112).
 *
 * search-api와 **같은 DB 접속 구성**(`POSTGRES_*`, 애플리케이션 롤)을 쓴다. 이 명령을 위한 별도 자격을
 * 만들지 않는다 (`role-cli.ts`와 같은 규율). 규칙과 근거는 `integrations/pipe/command.ts`에 있다.
 */

import { createPool } from '@prs/db';
import { runPipeIntegrationCommand } from './integrations/pipe/command.js';

const pool = createPool();

try {
  const gheBaseUrl = (process.env['GHE_BASE_URL'] ?? '').trim().replace(/\/+$/, '');
  process.exitCode = await runPipeIntegrationCommand(process.argv.slice(2), {
    pool,
    gheBaseUrl: gheBaseUrl === '' ? null : gheBaseUrl,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
} catch (error) {
  // 운영자의 터미널로만 간다 (`role-cli.ts`와 같다). 이 명령은 토큰·assertion을 다루지 않는다.
  process.stderr.write(`PIPE 연동 명령이 실패했다: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
