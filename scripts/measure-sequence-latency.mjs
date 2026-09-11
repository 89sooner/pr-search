#!/usr/bin/env node
/**
 * `pnpm run measure:sequence-latency` 래퍼 (WP-074 / FR-SEQ-008 AC-14).
 *
 * 실제 구현은 `apps/pipeline-worker/src/measure-cli.ts`이고, 이 파일은 빌드된
 * 진입점을 부르기만 한다. **오프라인 번들의 워커 이미지에서는 이 래퍼가 필요 없다** —
 * 그쪽은 `node dist/measure-cli.js`를 직접 부른다 (측정 가이드 1절).
 */

import { existsSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const entry = new URL('../apps/pipeline-worker/dist/measure-cli.js', import.meta.url);

if (!existsSync(fileURLToPath(entry))) {
  process.stderr.write(
    '측정 도구가 아직 빌드되지 않았다. 먼저 `pnpm build`(또는 `pnpm --filter @prs/pipeline-worker run build`)를 실행한다.\n',
  );
  process.exit(2);
}

await import(entry.href);
