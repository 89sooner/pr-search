#!/usr/bin/env node
/**
 * `@prs/es` CLI (인프라 8장).
 *
 *   prs-es apply-mappings    엔티티 인덱스 4종 생성 + 별칭 부여
 */

import { createEsClient } from './client.js';
import { applyMappings } from './bootstrap.js';

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
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
