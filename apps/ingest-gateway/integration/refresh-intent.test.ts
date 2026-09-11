/**
 * WP-074 FR-SEQ-008 AC-11 — T03c: push의 refresh 의도는 원본과 같은 트랜잭션이다.
 *
 * `createRawEventStore`가 `raw_event`를 넣는 트랜잭션 안에서 `sequence_work(kind=refresh)`를
 * 함께 넣는다. 발행이 실패해도 202이던 구멍(DEV-576)을 닫는 자리다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/ingest-gateway/integration/refresh-intent`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rawEventRepo, repositoryRepo, sequenceWorkRepo, type Pool, type RawEventInsert } from '@prs/db';
import { truncate } from '../../../packages/db/integration/helpers.js';
import { createRawEventStore } from '../src/store.js';
import { migratedPool } from './helpers.js';

const REPO = 7451;
const OTHER = 7452;
let pool: Pool;

function pushEvent(deliveryId: string, branch: string, after: string, repositoryId = REPO): RawEventInsert {
  return {
    delivery_id: deliveryId,
    event_type: 'push',
    action: null,
    repository_id: repositoryId,
    received_at: new Date(),
    payload: { ref: `refs/heads/${branch}`, after, deleted: false, repository: { id: repositoryId } },
    payload_hash: `hash-${deliveryId}`,
    correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
    queued_at: new Date(),
  };
}

beforeAll(async () => {
  pool = await migratedPool();
}, 120_000);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool, 'sequence_work', 'raw_event', 'repository');
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPO,
    owner: 'acme',
    name: 'smp1900',
    org_id: 1,
    visibility: 'internal',
    sequence_branches: ['main'],
    mirror_enabled: true,
    status: 'active',
  });
});

describe('WP-074 FR-SEQ-008 AC-11 (T03c): refresh 의도의 원자성', () => {
  it('**채번 대상 브랜치의 push는 원본과 함께 refresh 의도를 남긴다**', async () => {
    const store = createRawEventStore(pool);
    const sha = 'a'.repeat(40);
    expect(await store(pushEvent('d-1', 'main', sha))).toEqual({ duplicate: false });
    const work = await sequenceWorkRepo.findWork(pool, 'push:d-1');
    expect(work).toMatchObject({ kind: 'refresh', repository_id: REPO, base_branch: 'main', state: 'ready' });
    expect(work?.payload).toMatchObject({ delivery_id: 'd-1', head_sha: sha, correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8' });
    expect(await rawEventRepo.findRawEventByDeliveryId(pool, 'd-1')).toBeDefined();
  });

  it('중복 전달은 의도를 두 번 만들지 않는다 (work는 1건)', async () => {
    const store = createRawEventStore(pool);
    await store(pushEvent('d-2', 'main', 'b'.repeat(40)));
    expect(await store(pushEvent('d-2', 'main', 'b'.repeat(40)))).toEqual({ duplicate: true });
    expect(await sequenceWorkRepo.listWorkForSpace(pool, REPO, 'main', ['refresh'])).toHaveLength(1);
  });

  it('비대상 브랜치·미등록 저장소·브랜치 삭제 push는 의도를 만들지 않는다 — 표가 push 수에 비례하지 않는다', async () => {
    const store = createRawEventStore(pool);
    await store(pushEvent('d-feature', 'feature/x', 'c'.repeat(40)));
    await store(pushEvent('d-other', 'main', 'd'.repeat(40), OTHER));
    await store({ ...pushEvent('d-delete', 'main', '0'.repeat(40)), payload: { ref: 'refs/heads/main', after: '0'.repeat(40), deleted: true, repository: { id: REPO } } });
    const all = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM sequence_work');
    expect(Number(all.rows[0]?.count)).toBe(0);
    // 원본은 셋 다 저장됐다 — 의도를 만들지 않는 것이 저장을 막지는 않는다.
    expect(await rawEventRepo.countRawEvents(pool)).toBe(3);
  });

  it('**의도 저장이 실패하면 원본 저장도 롤백된다** — 반쪽 커밋을 남기지 않는다', async () => {
    const store = createRawEventStore(pool);
    // payload 크기 CHECK(64KiB)를 넘기는 correlation_id로 work INSERT를 실패시킨다.
    const huge = { ...pushEvent('d-huge', 'main', 'e'.repeat(40)), correlation_id: 'x'.repeat(70_000) };
    await expect(store(huge)).rejects.toThrow();
    expect(await rawEventRepo.findRawEventByDeliveryId(pool, 'd-huge')).toBeUndefined();
    expect(await sequenceWorkRepo.findWork(pool, 'push:d-huge')).toBeUndefined();
  });
});
