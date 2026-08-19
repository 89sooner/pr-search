/**
 * 개발용 합성 시드 (WP-002).
 *
 * 규모는 작업 패키지가 정한 저장소 3, PR 200, 커밋 500, 릴리스 10이다.
 * PostgreSQL이 소유하는 것만 넣는다 — PullRequest·Commit·Release **문서**는
 * Elasticsearch 소유라 WP-003·WP-008이 채운다 (ADR-004). 여기서는 그 사건들의
 * 원본 이벤트(`raw_event`)와 시퀀스 채번 결과(`merge_sequence`)를 만든다.
 *
 * 난수를 쓰지 않는다. 같은 입력이면 같은 데이터가 나와야 시드 위에서 만든
 * 테스트가 재현 가능하다.
 */

import type { Pool } from 'pg';
import { PARTITIONED_TABLES, ensureMonthlyPartitions } from './partitions.js';
import * as mergeSequenceRepo from './repositories/merge-sequence.js';
import * as rawEventRepo from './repositories/raw-event.js';
import * as repositoryRepo from './repositories/repository.js';
import * as sequenceSpaceRepo from './repositories/sequence-space.js';

export interface SeedCounts {
  readonly repositories: number;
  readonly pullRequests: number;
  readonly commits: number;
  readonly releases: number;
  readonly rawEvents: number;
}

export const SEED_TARGET = {
  repositories: 3,
  pullRequests: 200,
  commits: 500,
  releases: 10,
} as const;

const REPOSITORIES = [
  { repository_id: 1001, owner: 'platform', name: 'billing-core', org_id: 1, visibility: 'internal' },
  { repository_id: 1002, owner: 'platform', name: 'search-gateway', org_id: 1, visibility: 'internal' },
  { repository_id: 1003, owner: 'growth', name: 'web-console', org_id: 2, visibility: 'private' },
] as const;

const BASE_BRANCH = 'main';

/** 결정론적 40자 hex SHA. 시드 데이터의 SHA가 실행마다 바뀌면 테스트를 못 건다. */
function syntheticSha(seed: number): string {
  let value = BigInt(seed + 1) * 0x9e3779b97f4a7c15n;
  let hex = '';
  while (hex.length < 40) {
    value = (value * 0x2545f4914f6cdd1dn + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    hex += value.toString(16).padStart(16, '0');
  }
  return hex.slice(0, 40);
}

function dayOffset(base: Date, days: number): Date {
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * 합성 데이터를 적재한다. 여러 번 실행해도 같은 상태가 되도록 모든 INSERT는
 * 멱등하다.
 */
export async function seed(pool: Pool, now: Date = new Date()): Promise<SeedCounts> {
  // 파티션이 없는 파티션 테이블은 INSERT를 거부한다. 시드가 만드는 가장 오래된
  // 이벤트까지 덮도록 창을 데이터 범위에서 계산한다 — 고정 개월 수로 두면 시드
  // 규모를 늘릴 때 조용히 범위를 벗어난다.
  const oldestOffsetDays = Math.max(SEED_TARGET.pullRequests, SEED_TARGET.commits - SEED_TARGET.pullRequests);
  const monthsBack = Math.ceil(oldestOffsetDays / 28) + 1;
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  const windowMonths = monthsBack + 3;

  for (const table of PARTITIONED_TABLES) {
    await ensureMonthlyPartitions(pool, table, windowMonths, windowStart);
  }

  for (const repository of REPOSITORIES) {
    await repositoryRepo.upsertRepository(pool, {
      ...repository,
      sequence_branches: [BASE_BRANCH],
    });
    await sequenceSpaceRepo.ensureSequenceSpace(pool, repository.repository_id, BASE_BRANCH);
  }

  // PR 200건을 저장소 3개에 나눠 채번한다. 서수는 공간마다 1부터 증가한다.
  const perSpace = new Map<number, number>(REPOSITORIES.map((r) => [r.repository_id, 0]));
  let commitSeed = 0;

  for (let pr = 1; pr <= SEED_TARGET.pullRequests; pr += 1) {
    const repository = REPOSITORIES[pr % REPOSITORIES.length]!;
    const nextSeq = (perSpace.get(repository.repository_id) ?? 0) + 1;
    perSpace.set(repository.repository_id, nextSeq);

    const mergedAt = dayOffset(now, SEED_TARGET.pullRequests - pr);
    await mergeSequenceRepo.insertMergeSequence(pool, {
      repository_id: repository.repository_id,
      base_branch: BASE_BRANCH,
      seq_epoch: 1,
      merge_seq: nextSeq,
      commit_sha: syntheticSha(commitSeed++),
      pull_request_number: pr,
      committed_at: mergedAt,
    });

    await insertEvent(pool, `seed-pr-${String(pr)}`, 'pull_request', 'closed', repository.repository_id, mergedAt);
  }

  // 직접 푸시 커밋: pull_request_number가 NULL인 채번 (FR-SEQ-001 AC-3).
  const directPushes = SEED_TARGET.commits - SEED_TARGET.pullRequests;
  for (let i = 0; i < directPushes; i += 1) {
    const repository = REPOSITORIES[i % REPOSITORIES.length]!;
    const nextSeq = (perSpace.get(repository.repository_id) ?? 0) + 1;
    perSpace.set(repository.repository_id, nextSeq);

    const pushedAt = dayOffset(now, directPushes - i);
    await mergeSequenceRepo.insertMergeSequence(pool, {
      repository_id: repository.repository_id,
      base_branch: BASE_BRANCH,
      seq_epoch: 1,
      merge_seq: nextSeq,
      commit_sha: syntheticSha(commitSeed++),
      pull_request_number: null,
      committed_at: pushedAt,
    });

    await insertEvent(pool, `seed-push-${String(i)}`, 'push', null, repository.repository_id, pushedAt);
  }

  for (let i = 1; i <= SEED_TARGET.releases; i += 1) {
    const repository = REPOSITORIES[i % REPOSITORIES.length]!;
    await insertEvent(
      pool,
      `seed-release-${String(i)}`,
      'release',
      'published',
      repository.repository_id,
      dayOffset(now, SEED_TARGET.releases - i),
    );
  }

  for (const [repositoryId, headSeq] of perSpace) {
    await sequenceSpaceRepo.advanceHead(pool, repositoryId, BASE_BRANCH, syntheticSha(repositoryId), headSeq);
  }

  return {
    repositories: REPOSITORIES.length,
    pullRequests: SEED_TARGET.pullRequests,
    commits: SEED_TARGET.commits,
    releases: SEED_TARGET.releases,
    rawEvents: await rawEventRepo.countRawEvents(pool),
  };
}

async function insertEvent(
  pool: Pool,
  deliveryId: string,
  eventType: string,
  action: string | null,
  repositoryId: number,
  receivedAt: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO raw_event
       (delivery_id, event_type, action, repository_id, received_at, payload, payload_hash, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (delivery_id, received_at) DO NOTHING`,
    [
      deliveryId,
      eventType,
      action,
      repositoryId,
      receivedAt,
      JSON.stringify({ synthetic: true, delivery_id: deliveryId }),
      `sha256:${deliveryId}`,
      '00000000-0000-4000-8000-000000000000',
    ],
  );
}
