/**
 * 조회 서비스 (WP-013 / API-SRCH-004, FR-SRCH-007).
 *
 * 여기서 확인하는 것은 **호출 자리**다. `assertNoShardFailures`가 옳게 동작하는지는
 * `@prs/es`의 단위 시험이 본다 — 그러나 그 함수를 서비스가 **부르지 않아도**
 * 통합 시험은 통과한다(시험 인덱스에서는 샤드가 실패하지 않기 때문이다).
 * 적대적 변이 시험에서 실제로 살아남은 구멍이라 여기서 막는다.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { PartialSearchError } from '@prs/es';
import { parseQuery } from '@prs/query';
import { DEFAULT_SIZE, MAX_SIZE, clampSize, parseOrder, runSearch } from './service.js';

const SCOPE = {
  kind: 'explicit',
  repositoryIds: [4021],
  orgIds: [1],
  teamIds: [10],
  visibilities: ['internal'],
} as const;

/** 샤드 상태만 바꿔 가며 쓰는 최소 응답. */
function response(failed: number, total = 18): unknown {
  return {
    _shards: { failed, total, successful: total - failed, skipped: 0 },
    hits: { total: { value: 0, relation: 'eq' }, hits: [] },
  };
}

function clientWith(failed: number): { client: Client; search: ReturnType<typeof vi.fn> } {
  const search = vi.fn().mockResolvedValue(response(failed));
  // 완화 후보 계산이 부르는 자리. 0건이라 실제로 불린다.
  const msearch = vi.fn().mockResolvedValue({ responses: [] });
  return { client: { search, msearch } as unknown as Client, search };
}

const DEPS = {
  resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
};

function request(query: string) {
  return { ast: parseQuery(query), scope: SCOPE, sortKey: 'merge_seq', order: 'desc', size: 25 } as const;
}

describe('DEV-054: 샤드 부분 실패를 서비스가 실제로 검사한다', () => {
  it('샤드가 하나라도 실패하면 던진다 — 부분 결과를 내보내지 않는다', async () => {
    const { client } = clientWith(12);

    await expect(runSearch(request('repo:acme/payments'), { es: client, ...DEPS })).rejects.toThrow(
      PartialSearchError,
    );
  });

  it('실패가 없으면 결과를 준다', async () => {
    const { client } = clientWith(0);

    const result = await runSearch(request('repo:acme/payments'), { es: client, ...DEPS });
    expect(result.total.value).toBe(0);
  });
});

describe('size 절삭 (API 계약)', () => {
  it('없거나 비면 기본값이다', () => {
    expect(clampSize(undefined)).toBe(DEFAULT_SIZE);
    expect(clampSize('')).toBe(DEFAULT_SIZE);
    expect(clampSize('   ')).toBe(DEFAULT_SIZE);
  });

  it('상한을 넘으면 오류가 아니라 절삭이다', () => {
    expect(clampSize('1000')).toBe(MAX_SIZE);
    expect(clampSize(String(MAX_SIZE + 1))).toBe(MAX_SIZE);
    // 상한 자체는 그대로 통과한다.
    expect(clampSize(String(MAX_SIZE))).toBe(MAX_SIZE);
  });

  it('정수가 아니거나 1보다 작으면 기본값이다 — 400을 내지 않는다', () => {
    for (const raw of ['0', '-5', '2.5', 'abc', 'NaN']) {
      expect(clampSize(raw), raw).toBe(DEFAULT_SIZE);
    }
  });

  it('상한 안의 값은 그대로 쓴다', () => {
    expect(clampSize('1')).toBe(1);
    expect(clampSize('50')).toBe(50);
  });

  it('절삭한 크기가 실제 조회에 실린다', async () => {
    const { client, search } = clientWith(0);

    await runSearch({ ...request('repo:acme/payments'), size: clampSize('1000') }, { es: client, ...DEPS });

    expect(search.mock.calls[0]?.[0]?.size).toBe(MAX_SIZE);
  });
});

describe('order', () => {
  it('`asc`만 오름차순이고 나머지는 내림차순이다', () => {
    expect(parseOrder('asc')).toBe('asc');
    expect(parseOrder('desc')).toBe('desc');
    expect(parseOrder(undefined)).toBe('desc');
    expect(parseOrder('ASC')).toBe('desc');
  });
});
