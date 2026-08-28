#!/usr/bin/env node
/**
 * `@prs/es` CLI (인프라 8장).
 *
 *   prs-es apply-mappings    엔티티 인덱스 4종 생성 + 별칭 부여
 *                            + 아카이브 템플릿·ILM 적용 (WP-036)
 *
 * 아카이브를 별도 명령으로 가르지 않는다. 배포 절차가 하나 늘면 그것을
 * 빠뜨린 클러스터가 생기고, 그때 Filebeat가 만드는 인덱스에는 매핑도 ILM도
 * 없다 — 색인은 성공하고 조회만 조용히 답하지 못한다. `역할에 manifest가
 * 없으면 그 기능은 배포되지 않는다`(CR-034, DEV-183)와 같은 실패다.
 */

import { createEsClient } from './client.js';
import { applyMappings } from './bootstrap.js';
import { bootstrapArchive, ARCHIVE_ALIAS, ARCHIVE_ILM_POLICY_NAME } from './archive.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'apply-mappings';
  const client = createEsClient();

  try {
    if (command !== 'apply-mappings') {
      process.stderr.write(`알 수 없는 명령: ${command}\n`);
      process.exitCode = 1;
      return;
    }

    for (const result of await applyMappings(client)) {
      const index = result.created ? '생성' : '기존';
      const alias = result.aliasAttached ? '별칭 부여' : '별칭 유지';
      process.stdout.write(`${result.alias.padEnd(20)} ${result.index.padEnd(24)} ${index} / ${alias}\n`);
    }

    await bootstrapArchive(client);
    process.stdout.write(
      `${ARCHIVE_ALIAS.padEnd(20)} ${'prs-raw-events-{yyyy.MM}'.padEnd(24)} 템플릿 / ILM ${ARCHIVE_ILM_POLICY_NAME}\n`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
