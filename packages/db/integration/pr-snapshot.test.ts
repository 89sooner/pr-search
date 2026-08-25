/**
 * PR 정본 스냅숏 (마이그레이션 010 / CR-034, DEV-184 · ADR-004).
 *
 * ## 이 표가 없으면 깨지는 것
 *
 * 백필·조정 스캔은 GHE에서 직접 읽어 **Elasticsearch에만** 쓴다 — `raw_event`
 * 행을 남기지 않는다. 그 PR들은 색인에만 존재했고, "어떤 데이터도 검색
 * 인덱스에만 존재해서는 안 된다"(ADR-004)가 그 경로에서 실제로 깨져 있었다.
 *
 * 실행: `pnpm test:integration pr-snapshot`
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as prSnapshotRepo from '../src/repositories/pr-snapshot.js';
import { loadMigrations } from '../src/migrate.js';
import { migratedPool, truncate } from './helpers.js';

const REPOSITORY_ID = 7501;

describe('pull_request_snapshot (CR-034, DEV-184)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncate(pool, 'pull_request_snapshot');
  });

  it('up/down 쌍이 존재한다', () => {
    const migration = loadMigrations().find((entry) => entry.version === '010');
    expect(migration).toBeDefined();
    expect(migration?.downPath).toContain('010_pr_snapshot.down.sql');
  });

  it('투영 문서를 정본으로 남긴다', async () => {
    const written = await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 42,
      documentVersion: 100,
      source: 'backfill',
      document: { pr_number: 42, title: 'A', document_version: 100 },
    });
    expect(written).toBe(true);

    const rows = await prSnapshotRepo.listSnapshots(pool, REPOSITORY_ID, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pr_number).toBe(42);
    expect(rows[0]?.document['title']).toBe('A');
    expect(rows[0]?.source).toBe('backfill');
  });

  it('**같은 PR 재실행은 멱등이다** — 행이 늘지 않는다', async () => {
    for (let index = 0; index < 3; index += 1) {
      await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
        repositoryId: REPOSITORY_ID,
        prNumber: 42,
        documentVersion: 100,
        source: 'backfill',
        document: { pr_number: 42, document_version: 100 },
      });
    }
    expect(await prSnapshotRepo.countSnapshots(pool, REPOSITORY_ID)).toBe(1);
  });

  it('**오래된 백필이 최신 웹훅을 덮어쓰지 않는다** (DEV-099와 같은 규칙)', async () => {
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 42,
      documentVersion: 200,
      source: 'webhook',
      document: { pr_number: 42, title: '최신', document_version: 200 },
    });
    const applied = await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 42,
      documentVersion: 100,
      source: 'backfill',
      document: { pr_number: 42, title: '옛것', document_version: 100 },
    });
    expect(applied).toBe(false);

    const rows = await prSnapshotRepo.listSnapshots(pool, REPOSITORY_ID, 10);
    expect(rows[0]?.document['title']).toBe('최신');
    expect(rows[0]?.source).toBe('webhook');
  });

  it('더 새 버전은 이긴다', async () => {
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 42,
      documentVersion: 100,
      source: 'backfill',
      document: { pr_number: 42, title: '옛것', document_version: 100 },
    });
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 42,
      documentVersion: 300,
      source: 'webhook',
      document: { pr_number: 42, title: '새것', document_version: 300 },
    });
    const rows = await prSnapshotRepo.listSnapshots(pool, REPOSITORY_ID, 10);
    expect(rows[0]?.document['title']).toBe('새것');
  });

  it('모르는 출처는 거절한다 — 어디서 왔는지가 조사에 필요하다', async () => {
    await expect(
      pool.query(
        `INSERT INTO pull_request_snapshot (repository_id, pr_number, document_version, source, document)
         VALUES ($1, 1, 1, 'guess', '{}'::jsonb)`,
        [REPOSITORY_ID],
      ),
    ).rejects.toThrow(/pull_request_snapshot_source_chk/);
  });

  it('PR 번호 내림차순으로 표본을 준다', async () => {
    for (const prNumber of [1, 5, 3]) {
      await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
        repositoryId: REPOSITORY_ID,
        prNumber,
        documentVersion: 1,
        source: 'webhook',
        document: { pr_number: prNumber, document_version: 1 },
      });
    }
    const rows = await prSnapshotRepo.listSnapshots(pool, REPOSITORY_ID, 2);
    expect(rows.map((row) => row.pr_number)).toEqual([5, 3]);
  });
});
