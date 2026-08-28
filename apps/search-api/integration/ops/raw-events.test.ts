/**
 * 원본 아카이브 조회를 **실 Elasticsearch로** 잰다 (WP-036 DoD / FR-ING-010, CR-052).
 *
 * 접근 범위 필터가 실제로 거르는지, `payload`가 실제로 빠지는지는 대역으로 잴 수
 * 없다 — 대역이 실제보다 관대하면 그만큼이 사각지대다. 여기서 재는 것은 셋이다.
 *
 *   1. 범위 밖 저장소와 **미등록 저장소**의 원본이 나오지 않는다 (AC-6)
 *   2. `payload`는 명시적 요청일 때만 실린다 (THR-044)
 *   3. 인덱스가 없어도 500이 아니라 `index_available: false`다 (AC-3)
 *
 * 픽스처 이름에 파일 전용 접두를 쓴다 — 공유 클러스터에서 다른 파일과 겹치면
 * 서로의 결과를 오염시킨다.
 *
 * 실행: `pnpm test:integration ops/raw-events`
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { bootstrapArchive, createEsClient, resolveClientOptions } from '@prs/es';
import { createCursorSigner } from '../../src/cursor/envelope.js';
import { listRawEvents, parseRawEventFilter } from '../../src/ops/raw-events.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

const INDEX = 'prs-raw-events-2026.08';
const IN_SCOPE = 90_101;
const OUT_OF_SCOPE = 90_102;
const SIGNER = createCursorSigner(TEST_CURSOR_KEY);

let es: Client;

interface SeedRecord {
  readonly delivery_id: string;
  readonly repository: string | null;
  readonly repository_id: number | null;
}

const SEED: readonly SeedRecord[] = [
  { delivery_id: 'rawev-in-1', repository: 'rawev/payments', repository_id: IN_SCOPE },
  { delivery_id: 'rawev-in-2', repository: 'rawev/payments', repository_id: IN_SCOPE },
  { delivery_id: 'rawev-out-1', repository: 'rawev/secrets', repository_id: OUT_OF_SCOPE },
  // 미등록 저장소 — `repository_id`가 없다. 어떤 접근 범위에도 속하지 않는다.
  { delivery_id: 'rawev-unregistered', repository: 'rawev/unknown', repository_id: null },
];

function deps(): Parameters<typeof listRawEvents>[0] {
  return { es, cursorSigner: SIGNER };
}

beforeAll(async () => {
  es = createEsClient(resolveClientOptions());
  await bootstrapArchive(es);
  await es.indices.delete({ index: INDEX }, { ignore: [404] });
  await es.indices.create({ index: INDEX });

  let offset = 0;
  for (const record of SEED) {
    offset += 1;
    await es.index({
      index: INDEX,
      id: record.delivery_id,
      document: {
        delivery_id: record.delivery_id,
        event_type: 'pull_request',
        action: 'closed',
        repository: record.repository,
        ...(record.repository_id === null ? {} : { repository_id: record.repository_id }),
        received_at: new Date(Date.UTC(2026, 7, 28, 10, offset)).toISOString(),
        correlation_id: `corr-${record.delivery_id}`,
        payload: { secret: 'do-not-leak', number: offset },
      },
      refresh: true,
    });
  }
}, 60_000);

afterAll(async () => {
  await es.indices.delete({ index: INDEX }, { ignore: [404] });
  await es.close();
});

describe('AC-6: 조회는 요청자의 접근 범위를 지난다', () => {
  it('범위 안 저장소의 원본만 나온다', async () => {
    const result = await listRawEvents(deps(), parseRawEventFilter({}), [IN_SCOPE]);
    expect(result.index_available).toBe(true);
    expect(result.items.map((item) => item.delivery_id).sort()).toEqual([
      'rawev-in-1',
      'rawev-in-2',
    ]);
  });

  it('범위 밖 저장소를 이름으로 지목해도 나오지 않는다', async () => {
    const filter = parseRawEventFilter({ repository: 'rawev/secrets' });
    const result = await listRawEvents(deps(), filter, [IN_SCOPE]);
    expect(result.items).toHaveLength(0);
  });

  it('**미등록 저장소의 원본은 누구에게도 나오지 않는다** — 존재 신탁을 만들지 않는다', async () => {
    const both = await listRawEvents(deps(), parseRawEventFilter({}), [IN_SCOPE, OUT_OF_SCOPE]);
    expect(both.items.map((item) => item.delivery_id)).not.toContain('rawev-unregistered');
  });

  it('`delivery_id` 정확 일치도 접근 범위를 지난다 (AC-4의 대조 경로)', async () => {
    const filter = parseRawEventFilter({ delivery_id: 'rawev-out-1' });
    const result = await listRawEvents(deps(), filter, [IN_SCOPE]);
    expect(result.items).toHaveLength(0);

    const own = parseRawEventFilter({ delivery_id: 'rawev-in-1' });
    const found = await listRawEvents(deps(), own, [IN_SCOPE]);
    expect(found.items).toHaveLength(1);
    expect(found.items[0]?.repository).toBe('rawev/payments');
  });

  it('접근 가능한 저장소가 없으면 빈 목록이 아니라 명시적 실패다', async () => {
    await expect(listRawEvents(deps(), parseRawEventFilter({}), [])).rejects.toThrow(
      /접근 범위를 확인할 수 없다/,
    );
  });
});

describe('THR-044: payload는 명시적 요청일 때만 실린다', () => {
  it('기본 조회에는 payload가 없다', async () => {
    const result = await listRawEvents(deps(), parseRawEventFilter({}), [IN_SCOPE]);
    for (const item of result.items) {
      expect(item.payload).toBeUndefined();
      expect(JSON.stringify(item)).not.toContain('do-not-leak');
    }
  });

  it('`include_payload=true`면 원본이 실린다', async () => {
    const filter = parseRawEventFilter({ include_payload: 'true' });
    const result = await listRawEvents(deps(), filter, [IN_SCOPE]);
    expect(result.items[0]?.payload).toMatchObject({ secret: 'do-not-leak' });
  });

  it('두 형태의 저장소 값이 함께 나온다 (DEV-366)', async () => {
    const result = await listRawEvents(deps(), parseRawEventFilter({}), [IN_SCOPE]);
    expect(result.items[0]?.repository).toBe('rawev/payments');
    expect(result.items[0]?.repository_id).toBe(IN_SCOPE);
  });
});

describe('커서 순회', () => {
  it('페이지를 이어 돌고 마지막에 커서를 닫는다', async () => {
    const first = await listRawEvents(deps(), parseRawEventFilter({ limit: '1' }), [IN_SCOPE]);
    expect(first.items).toHaveLength(1);
    expect(first.next_cursor).not.toBeNull();

    const second = await listRawEvents(
      deps(),
      parseRawEventFilter({ limit: '1', cursor: first.next_cursor as string }),
      [IN_SCOPE],
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.delivery_id).not.toBe(first.items[0]?.delivery_id);
  });

  it('순회 도중 `include_payload`를 켜면 커서가 거절된다', async () => {
    const first = await listRawEvents(deps(), parseRawEventFilter({ limit: '1' }), [IN_SCOPE]);
    const opened = parseRawEventFilter({
      limit: '1',
      include_payload: 'true',
      cursor: first.next_cursor as string,
    });
    await expect(listRawEvents(deps(), opened, [IN_SCOPE])).rejects.toThrow(
      /조회 조건이 커서와 다르다/,
    );
  });
});

describe('AC-3: 아카이브의 부재가 조회를 깨뜨리지 않는다', () => {
  it('별칭이 없으면 500이 아니라 `index_available: false`다', async () => {
    await es.indices.delete({ index: INDEX }, { ignore: [404] });
    const result = await listRawEvents(deps(), parseRawEventFilter({}), [IN_SCOPE]);
    expect(result.index_available).toBe(false);
    expect(result.items).toHaveLength(0);
    expect(result.next_cursor).toBeNull();
  });
});
