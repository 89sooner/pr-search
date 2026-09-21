/**
 * `node dist/sequence-reproject-cli.js` — 시퀀스 재투영 명령의 진입점 (CR-113 / WP-098).
 *
 * 운영자는 이 파일을 직접 부르지 않는다. `prsctl sequence …`가 pipeline-worker 이미지로 한 번
 * 실행하고 호스트 사용자 이름을 `--actor`로 넘긴다. 규칙과 근거는 `sequence-reproject-command.ts`에
 * 있다. 워커와 **같은 DB·Elasticsearch 접속 구성**을 쓴다 — 이 명령을 위한 별도 자격은 없다.
 */

import { createPool } from '@prs/db';
import { createEsClient } from '@prs/es';
import { runSequenceReprojectCommand } from './sequence-reproject-command.js';

const pool = createPool();
const es = createEsClient();

try {
  process.exitCode = await runSequenceReprojectCommand(process.argv.slice(2), {
    pool,
    es,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
} catch (error) {
  process.stderr.write(`재투영 명령이 실패했다: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await es.close();
  await pool.end();
}
