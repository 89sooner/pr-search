/**
 * 스택 간선 가져오기의 범위와 일부 읽기 판정 (WP-107 / CR-126, DEV-773 · WP-104 / CR-121, OD-017).
 *
 * 핵심 주장 둘:
 *
 * - **범위가 있으면 PR 하나의 한쪽 끝만 읽는다** — 이벤트마다 저장소의 스택 간선 전체를 훑지 않는다.
 * - **일부만 읽힌 결과로 옮기지 않는다** — 시간 초과·샤드 실패는 「간선 없음」이 아니라 실패다. 여러 쪽을
 *   읽다가 뒤쪽에서 실패해도 앞쪽만 옮기지 않는다.
 *
 * 저장(`ON CONFLICT DO NOTHING`)과 동시 실행은 실제 PostgreSQL로 통합 시험이 건다
 * (`integration/worker/stack-upgrade-transition.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { Pool, RepositoryRow } from '@prs/db';
import { importServingStacks } from './stack-import.js';

const REPOSITORY_ID = 77;
const REPOSITORY = { repository_id: REPOSITORY_ID, owner: 'acme', name: 'stk' } as unknown as RepositoryRow;

interface Page {
  readonly hits: readonly Record<string, unknown>[];
  readonly timedOut?: boolean;
  readonly failedShards?: number;
}

function edge(child: number, parent: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    from_id: `${String(REPOSITORY_ID)}:${String(child)}`,
    to_id: `${String(REPOSITORY_ID)}:${String(parent)}`,
    repository_id: REPOSITORY_ID,
    to_repository_id: REPOSITORY_ID,
    evidence: `base b${String(parent)} = head of #${String(parent)}`,
    created_at: '2026-07-15T09:30:00.000Z',
    detached: false,
    ...overrides,
  };
}

/** 쪽마다 정해 둔 응답을 차례로 준다. 요청은 모두 기록한다. */
function fakeEs(pages: readonly Page[]): { readonly es: Client; readonly requests: Record<string, unknown>[] } {
  const requests: Record<string, unknown>[] = [];
  const es = {
    search: (request: Record<string, unknown>) => {
      const page = pages[requests.length] ?? { hits: [] };
      const pageNo = requests.length;
      requests.push(request);
      const failed = page.failedShards ?? 0;
      return Promise.resolve({
        timed_out: page.timedOut ?? false,
        _shards: { total: 2, successful: 2 - failed, skipped: 0, failed },
        hits: {
          hits: page.hits.map((source, n) => ({ _id: `p${String(pageNo)}-${String(n)}`, _source: source, sort: [`p${String(pageNo)}-${String(n)}`] })),
        },
      });
    },
  } as unknown as Client;
  return { es, requests };
}

/** `importStacks`의 INSERT만 받는다. 이 대역은 모두 새 행으로 센다. */
function fakePool(): { readonly pool: Pool; readonly inserts: unknown[][] } {
  const inserts: unknown[][] = [];
  const pool = {
    query: (_sql: string, params: unknown[]) => {
      inserts.push(params);
      return Promise.resolve({ rowCount: (params[0] as unknown[]).length, rows: [] });
    },
  } as unknown as Pool;
  return { pool, inserts };
}

function filterOf(request: Record<string, unknown>): unknown[] {
  return (request['query'] as { bool: { filter: unknown[] } }).bool.filter;
}

const REPOSITORY_TERMS = [{ term: { repository_id: REPOSITORY_ID } }, { term: { link_type: 'stacks_on' } }];

describe('서비스 인덱스 스택 간선의 조회 범위 (CR-126)', () => {
  it('범위가 없으면 저장소 하나의 스택 간선 전체를 읽는다 — 운영자 명령(`import-stacks`)이다', async () => {
    const { es, requests } = fakeEs([{ hits: [edge(12, 11)] }]);
    const { pool } = fakePool();

    const result = await importServingStacks({ pool, es }, REPOSITORY, { dryRun: false });

    expect(result).toEqual({ scanned: 1, inserted: 1, existing: 0, invalid: 0 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ routing: String(REPOSITORY_ID) });
    expect(filterOf(requests[0]!)).toEqual(REPOSITORY_TERMS);
  });

  it('하위 PR 범위는 **그 PR에서 나가는 간선만** 읽는다', async () => {
    const { es, requests } = fakeEs([{ hits: [edge(12, 11)] }]);
    const { pool } = fakePool();

    await importServingStacks({ pool, es }, REPOSITORY, { dryRun: false, scope: { childPrNumber: 12 } });

    expect(requests[0]).toMatchObject({ routing: String(REPOSITORY_ID) });
    expect(filterOf(requests[0]!)).toEqual([...REPOSITORY_TERMS, { term: { from_id: `${String(REPOSITORY_ID)}:12` } }]);
  });

  it('상위 PR 범위는 **그 PR로 들어오는 간선만** 읽는다', async () => {
    const { es, requests } = fakeEs([{ hits: [edge(12, 11), edge(13, 11)] }]);
    const { pool } = fakePool();

    const result = await importServingStacks({ pool, es }, REPOSITORY, { dryRun: false, scope: { parentPrNumber: 11 } });

    expect(result.inserted).toBe(2);
    expect(filterOf(requests[0]!)).toEqual([...REPOSITORY_TERMS, { term: { to_id: `${String(REPOSITORY_ID)}:11` } }]);
  });

  it('여러 쪽을 끝까지 읽는다 — 다음 쪽은 앞 쪽의 마지막 정렬 값에서 시작한다', async () => {
    const first = Array.from({ length: 1000 }, (_, n) => edge(1000 + n, 1));
    const { es, requests } = fakeEs([{ hits: first }, { hits: [edge(5000, 1), edge(5001, 1)] }]);
    const { pool } = fakePool();

    const result = await importServingStacks({ pool, es }, REPOSITORY, { dryRun: false, scope: { parentPrNumber: 1 } });

    expect(result.scanned).toBe(1002);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ search_after: ['p0-999'] });
    expect(filterOf(requests[1]!)).toEqual(filterOf(requests[0]!));
  });
});

describe('일부만 읽힌 결과로 옮기지 않는다 (CR-126)', () => {
  it.each([
    ['시간 초과', { timedOut: true }],
    ['샤드 실패', { failedShards: 1 }],
  ] as const)('%s면 던지고 아무것도 옮기지 않는다 — 「간선 없음」이 아니다', async (_label, fault) => {
    const { es } = fakeEs([{ hits: [edge(12, 11)], ...fault }]);
    const { pool, inserts } = fakePool();

    await expect(
      importServingStacks({ pool, es }, REPOSITORY, { dryRun: false, scope: { childPrNumber: 12 } }),
    ).rejects.toThrow(/일부만 읽혔다/);
    expect(inserts).toEqual([]);
  });

  it('둘째 쪽에서 일부만 읽혀도 던진다 — 온전히 읽은 첫 쪽만 옮기지 않는다', async () => {
    const first = Array.from({ length: 1000 }, (_, n) => edge(1000 + n, 1));
    const { es } = fakeEs([{ hits: first }, { hits: [edge(5000, 1)], timedOut: true }]);
    const { pool, inserts } = fakePool();

    await expect(importServingStacks({ pool, es }, REPOSITORY, { dryRun: false })).rejects.toThrow(/일부만 읽혔다/);
    expect(inserts).toEqual([]);
  });
});

describe('범위가 있어도 검증은 같다 (CR-126, OD-017)', () => {
  it('다른 저장소를 가리키거나 해제 여부·근거가 빠진 간선은 세기만 하고 옮기지 않는다', async () => {
    const { es } = fakeEs([
      {
        hits: [
          edge(12, 11),
          edge(12, 21, { to_repository_id: REPOSITORY_ID + 1 }),
          edge(12, 31, { detached: undefined }),
          edge(12, 41, { evidence: 7 }),
        ],
      },
    ]);
    const { pool, inserts } = fakePool();

    const result = await importServingStacks({ pool, es }, REPOSITORY, { dryRun: false, scope: { childPrNumber: 12 } });

    expect(result).toEqual({ scanned: 4, inserted: 1, existing: 0, invalid: 3 });
    expect(inserts).toHaveLength(1);
    // (저장소, 하위, 상위, 근거, 시각, 해제) 배열 — 옮긴 것은 12 → 11 하나다.
    expect(inserts[0]!.slice(0, 3)).toEqual([[REPOSITORY_ID], [12], [11]]);
  });
});
