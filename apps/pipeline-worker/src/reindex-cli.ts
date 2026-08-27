#!/usr/bin/env node
/**
 * `pnpm es:reindex --alias <별칭>` (WP-035 / CR-045, DEV-302).
 *
 * ## 여기서 Elasticsearch를 직접 재색인하지 않는다
 *
 * 이 CLI는 **잡을 만들 뿐**이고 실제 실행은 `batch` 역할의 JOB-ING-006 러너가
 * 한다. 직접 실행하면 울타리 밖에서 도는 두 번째 재색인 경로가 생기고, 그 경로는
 * 이중 쓰기도 전환 전 검증도 지나지 않는다.
 *
 * ## API와 같은 seam을 부른다
 *
 * `reindexRepo.enqueueReindex` 하나를 API-ADM-004와 이 CLI가 함께 쓴다. 두
 * 진입점이 각자 알고리즘을 만들면 한쪽만 동시 실행 상한을 보거나 한쪽만
 * "아직 쓰이지 않은 다음 번호"를 다르게 고른다 — 그 차이는 두 경로를 모두 써 본
 * 사람만 발견한다.
 */

import { createPool, installTypeParsers, reindexRepo } from '@prs/db';
import { createEsClient, reindexIndexPort } from '@prs/es';

/** 잡을 만든 주체. 감사와 `job.requested_by`에 남는다. */
const REQUESTED_BY = 'cli:es:reindex';

function parseAlias(argv: readonly string[]): string | undefined {
  const flag = argv.indexOf('--alias');
  if (flag >= 0) return argv[flag + 1];
  const inline = argv.find((one) => one.startsWith('--alias='));
  return inline?.slice('--alias='.length);
}

async function main(): Promise<void> {
  const alias = parseAlias(process.argv.slice(2));
  if (alias === undefined || alias === '') {
    process.stderr.write('사용법: pnpm es:reindex --alias <prs-pull-requests|prs-commits|prs-links|prs-releases>\n');
    process.exitCode = 1;
    return;
  }

  installTypeParsers();
  const pool = createPool();
  const es = createEsClient();

  try {
    const outcome = await reindexRepo.enqueueReindex(pool, reindexIndexPort(es), alias, REQUESTED_BY);

    switch (outcome.kind) {
      case 'invalid_alias':
        process.stderr.write(`알 수 없는 별칭이다: ${outcome.value}\n`);
        process.stderr.write('구체 인덱스 이름은 받지 않는다 — 대상 버전은 서버가 정한다.\n');
        process.exitCode = 1;
        return;
      case 'conflict':
        process.stderr.write(`같은 별칭에 활성 재색인이 이미 있다: ${outcome.alias}\n`);
        process.exitCode = 1;
        return;
      case 'busy':
        process.stderr.write(`다른 별칭이 재색인 중이다: ${outcome.alias} (동시 실행 상한 1)\n`);
        process.exitCode = 1;
        return;
      case 'queued':
        process.stdout.write(
          `${JSON.stringify({
            job_id: outcome.jobId,
            type: 'reindex',
            state: 'queued',
            alias,
            source_index: outcome.sourceIndex,
            target_index: outcome.targetIndex,
          })}\n`,
        );
        return;
    }
  } finally {
    await es.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
