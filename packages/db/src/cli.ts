#!/usr/bin/env node
/**
 * `@prs/db` CLI (인프라 8장).
 *
 *   prs-db migrate              미적용 마이그레이션 전부 적용
 *   prs-db migrate --down       적용된 마이그레이션 전부 회수 (up의 역연산)
 *   prs-db migrate --down --step 1   최신 1개만 회수
 *   prs-db partitions           월별 파티션 생성 (기본 3개월치)
 *   prs-db seed                 개발용 합성 시드 적재
 */

import { createPool } from './pool.js';
import { migrateDown, migrateUp } from './migrate.js';
import { ensureAllPartitions } from './partitions.js';
import { seed } from './seed.js';

function readStep(argv: readonly string[]): number | undefined {
  const index = argv.indexOf('--step');
  if (index === -1) return undefined;

  const raw = argv[index + 1];
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 1) {
    throw new Error('--step은 1 이상의 정수여야 한다');
  }
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'migrate';
  const pool = createPool();

  try {
    switch (command) {
      case 'migrate': {
        if (argv.includes('--down')) {
          const reverted = await migrateDown(pool, readStep(argv));
          process.stdout.write(
            reverted.length === 0 ? '회수할 마이그레이션이 없다\n' : `회수: ${reverted.join(', ')}\n`,
          );
          break;
        }

        const applied = await migrateUp(pool);
        process.stdout.write(
          applied.length === 0 ? '적용할 마이그레이션이 없다\n' : `적용: ${applied.join(', ')}\n`,
        );
        break;
      }

      case 'partitions': {
        const created = await ensureAllPartitions(pool);
        process.stdout.write(
          created.length === 0 ? '생성할 파티션이 없다\n' : `생성: ${created.join(', ')}\n`,
        );
        break;
      }

      case 'seed': {
        const counts = await seed(pool);
        process.stdout.write(
          `시드 완료 — 저장소 ${String(counts.repositories)}, PR ${String(counts.pullRequests)}, ` +
            `커밋 ${String(counts.commits)}, 릴리스 ${String(counts.releases)}, ` +
            `원본 이벤트 ${String(counts.rawEvents)}\n`,
        );
        break;
      }

      default:
        process.stderr.write(`알 수 없는 명령: ${command}\n`);
        process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
