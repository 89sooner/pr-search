/**
 * `node dist/link-repair-cli.js` — PR 연결 복구 명령의 진입점 (WP-101 / CR-116).
 *
 * 운영자는 이 파일을 직접 부르지 않는다. `prsctl links …`가 pipeline-worker 이미지로
 * 한 번 실행하고 호스트 사용자 이름을 `--actor`로 넘긴다. 규칙과 근거는
 * `link-repair-command.ts`에 있다. 워커와 **같은 DB·Elasticsearch 접속 구성**을 쓴다 —
 * 이 명령을 위한 별도 자격은 없다.
 *
 * GHE 자격은 `refetch`에만 필요하다. 없으면 클라이언트를 만들지 않고 그 명령만 거절한다 —
 * `plan`·`apply`·`status`는 원격을 읽지 않으므로 자격 없이도 돈다. 기동 자체를 거부하지
 * 않는 이유가 그것이다: 자격이 없는 배포에서도 대조와 복구는 할 수 있어야 한다.
 */

import { createPool } from '@prs/db';
import { createEsClient } from '@prs/es';
import {
  GitHubClient,
  GitHubTransport,
  InstallationTokenProvider,
  RequestScheduler,
  TokenPool,
  hasAppCredentials,
  parseInstallations,
  resolveGitHubConfig,
} from '@prs/github';
import { runLinkRepairCommand } from './link-repair-command.js';

const pool = createPool();
const es = createEsClient();

function buildClient(): GitHubClient | undefined {
  const config = resolveGitHubConfig();
  const installations = parseInstallations();
  if (!hasAppCredentials(config) || installations.length === 0) return undefined;
  const tokenPool = new TokenPool(
    new InstallationTokenProvider({
      apiUrl: config.apiUrl,
      appId: config.appId,
      privateKey: config.privateKey,
      refreshLeadMs: config.tokenRefreshLeadMs,
      requestTimeoutMs: config.requestTimeoutMs,
    }),
    { installations, quarantineThreshold: config.quarantineThreshold },
  );
  return new GitHubClient(
    new GitHubTransport({
      apiUrl: config.apiUrl,
      requestTimeoutMs: config.requestTimeoutMs,
      pool: tokenPool,
      scheduler: new RequestScheduler({ maxConcurrent: config.maxConcurrentRequests }),
    }),
  );
}

try {
  const client = buildClient();
  process.exitCode = await runLinkRepairCommand(process.argv.slice(2), {
    pool,
    es,
    ...(client === undefined ? {} : { client }),
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
} catch (error) {
  process.stderr.write(`관계 복구 명령이 실패했다: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await es.close();
  await pool.end();
}
