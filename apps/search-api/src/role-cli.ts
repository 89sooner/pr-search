/**
 * `node dist/role-cli.js` — 관리자 지정 역할 명령의 진입점 (CR-091 / DEV-695).
 *
 * 운영자는 이 파일을 직접 부르지 않는다. `prsctl role …`이 search-api 이미지로 한 번 실행하고
 * 호스트 사용자 이름을 `--actor`로 넘긴다. 규칙과 근거는 `auth/role-command.ts`에 있다.
 *
 * search-api와 **같은 DB 접속 구성**(`POSTGRES_*`, 애플리케이션 롤)을 쓴다. 이 명령을 위한 별도의
 * 자격을 만들지 않는다.
 */

import { createPool } from '@prs/db';
import { runRoleCommand } from './auth/role-command.js';

const pool = createPool();

try {
  process.exitCode = await runRoleCommand(process.argv.slice(2), {
    pool,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
} catch (error) {
  process.stderr.write(`역할 명령이 실패했다: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
