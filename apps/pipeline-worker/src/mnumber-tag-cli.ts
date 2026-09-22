/**
 * `node dist/mnumber-tag-cli.js` — M 번호 태그 운영 명령의 진입점 (CR-115 / WP-100).
 *
 * 운영자는 이 파일을 직접 부르지 않는다. `prsctl mnumber tags …`가 pipeline-worker 이미지로
 * (`worker-annotate` 서비스 — 태그 전용 App 자격이 그 컨테이너에만 있다) 한 번 실행하고 호스트
 * 사용자 이름을 `--actor`로 넘긴다. 규칙과 근거는 `mnumber-tag-command.ts`에 있다.
 */

import { createPool } from '@prs/db';
import { TagClient, hasTagCredentials, resolveTagConfig } from '@prs/github-tag';
import { runMnumberTagCommand } from './mnumber-tag-command.js';

const pool = createPool();
const config = resolveTagConfig();
const client = hasTagCredentials(config) ? new TagClient({ config }) : null;

try {
  process.exitCode = await runMnumberTagCommand(process.argv.slice(2), {
    pool,
    client,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
} catch (error) {
  process.stderr.write(`태그 명령이 실패했다: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
