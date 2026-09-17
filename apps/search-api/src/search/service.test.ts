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
import { createCursorSigner } from '../cursor/envelope.js';

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
  /*
   * PIT은 **모든 커서 순회에** 필요하다 (WP-032 / ADR-010 Amendment).
   *
   * 첫 페이지를 만들 때는 사용자가 이어 볼지 알 수 없으므로 그때 뷰를 고정해
   * 두지 않으면 커서를 발급할 자격이 없다. 대역도 그 자리를 가져야 한다 —
   * 없애면 시험이 통과하면서 운영은 열지 않는 상태가 만들어진다.
   */
  const openPointInTime = vi.fn().mockResolvedValue({ id: 'pit-test' });
  const closePointInTime = vi.fn().mockResolvedValue({ succeeded: true });
  return {
    client: { search, msearch, openPointInTime, closePointInTime } as unknown as Client,
    search,
  };
}

const DEPS = {
  resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
  cursorSigner: createCursorSigner('service-unit-test-key-0123456789abcdef'),
};

function request(query: string) {
  return {
    ast: parseQuery(query),
    scope: SCOPE,
    scopeVersion: 1,
    sortKey: 'merge_seq',
    order: 'desc',
    size: 25,
    cursor: null,
    facets: false,
    // `seq:`가 없는 질의다 (CR-051).
    sequenceEpoch: null,
    // `mnum:`도 없는 질의다 (CR-106).
    mergeNumberEpoch: null,
  } as const;
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

    /*
     * **한 건 더 읽는다** (WP-032). `size`만 읽으면 "다음이 있는가"를 알 수 없어
     * 결과가 정확히 `size`의 배수일 때 빈 페이지를 한 번 더 내주게 된다 —
     * AC-1이 "마지막 페이지에서 `next_cursor`가 null"을 요구한다. 그 한 건은
     * 목록에 실리지 않는다.
     */
    expect(search.mock.calls[0]?.[0]?.size).toBe(MAX_SIZE + 1);
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

describe('PIT을 응답이 준 값으로 잇는다 (PR #57 리뷰 P1)', () => {
  /*
   * Elasticsearch는 검색 응답에 `pit_id`를 실어 주며 **그것이 바뀔 수 있다** —
   * 계약이 "다음 요청에는 응답의 값을 쓰라"고 정한다. 처음 받은 값을 계속 쓰면
   * 성공한 페이지 뒤에 이어 보기가 실패할 수 있고, 마지막 페이지의 정리도
   * 이미 지나간 식별자를 닫는다.
   *
   * **실 Elasticsearch 8.19에서는 두 값이 같았다** — 실측했다. 그래서 통합
   * 계층으로는 이 규율을 관측할 수 없고(변이가 등가로 살아남는다), 여기서
   * 대역이 값을 바꿔 준다. 우연에 기대는 코드는 판올림 한 번에 조용히 깨진다.
   */
  const ROTATED = 'pit-after-rotation';

  function rotatingClient(hits: number): { client: Client; closed: string[] } {
    const closed: string[] = [];
    const search = vi.fn().mockResolvedValue({
      _shards: { failed: 0, total: 1, successful: 1, skipped: 0 },
      pit_id: ROTATED,
      hits: {
        total: { value: hits, relation: 'eq' },
        hits: Array.from({ length: hits }, (_, i) => ({
          _index: 'prs-pull-requests-v2',
          _id: `p${String(i)}`,
          _source: { repository: 'acme/payments', pr_number: i },
          sort: [i, `p${String(i)}`],
        })),
      },
    });
    return {
      client: {
        search,
        msearch: vi.fn().mockResolvedValue({ responses: [] }),
        openPointInTime: vi.fn().mockResolvedValue({ id: 'pit-original' }),
        closePointInTime: vi.fn().mockImplementation(({ id }: { id: string }) => {
          closed.push(id);
          return Promise.resolve({ succeeded: true });
        }),
      } as unknown as Client,
      closed,
    };
  }

  it('발급하는 커서가 **갱신된** PIT을 싣는다', async () => {
    // `size + 1`을 돌려주면 다음 페이지가 있다고 판정된다.
    const { client } = rotatingClient(3);
    const result = await runSearch({ ...request('repo:acme/payments'), size: 2 }, { es: client, ...DEPS });

    expect(result.nextCursor).not.toBeNull();
    const body = (result.nextCursor as string).split('.')[0] as string;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { p: string };
    expect(payload.p).toBe(ROTATED);
  });

  it('마지막 페이지에서 닫는 것도 갱신된 PIT이다 — 지나간 식별자를 닫지 않는다', async () => {
    const { client, closed } = rotatingClient(1);
    const result = await runSearch({ ...request('repo:acme/payments'), size: 2 }, { es: client, ...DEPS });

    expect(result.nextCursor).toBeNull();
    expect(closed).toEqual([ROTATED]);
  });
});
