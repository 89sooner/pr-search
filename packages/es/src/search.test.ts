/**
 * `multiSearch`의 전송 모양 (WP-023, DEV-141).
 *
 * `_msearch`는 NDJSON이다: 홀수 줄은 헤더(대상·라우팅), 짝수 줄은 검색 본문.
 * **본문에 `routing`이 실리면 Elasticsearch가 요청 전체를 400으로 거절한다** —
 * `search` API에서는 클라이언트가 그것을 쿼리스트링으로 올려 주므로 같은 옵션
 * 모양이 한쪽에서만 터진다. 대역 시험은 이 차이를 못 보고(대역은 아무 키나
 * 받는다), CI의 실-ES 계층이 처음 잡았다. 이 파일이 그 모양을 단위에서 고정해
 * ES 없이도 회귀를 막는다.
 */

import type { Client } from '@elastic/elasticsearch';
import { describe, expect, it } from 'vitest';
import { applyMandatoryScopeFilter } from './scoped-query.js';
import { multiSearch } from './search.js';

function capturingClient(): { client: Client; captured: { searches?: unknown[] } } {
  const captured: { searches?: unknown[] } = {};
  const client = {
    msearch: (request: { searches: unknown[] }) => {
      captured.searches = request.searches;
      return Promise.resolve({ responses: [] });
    },
  } as unknown as Client;
  return { client, captured };
}

const SCOPED = applyMandatoryScopeFilter({ match_all: {} }, { kind: 'explicit', repositoryIds: [1] });

describe('multiSearch 전송 모양 (DEV-141)', () => {
  it('**`routing`은 본문이 아니라 헤더 줄에 실린다**', async () => {
    const { client, captured } = capturingClient();
    await multiSearch(client, [
      {
        target: 'prs-pull-requests',
        query: SCOPED,
        options: { size: 5, routing: '101', track_total_hits: true },
      },
    ]);

    const [header, body] = captured.searches ?? [];
    expect(header).toEqual({ index: 'prs-pull-requests', routing: '101' });
    // 본문에 남으면 실제 Elasticsearch가 400으로 거절한다.
    expect(body).not.toHaveProperty('routing');
    expect(body).toMatchObject({ size: 5, track_total_hits: true });
  });

  it('`routing`이 없으면 헤더에 키 자체를 넣지 않는다', async () => {
    const { client, captured } = capturingClient();
    await multiSearch(client, [{ target: 'prs-commits', query: SCOPED, options: { size: 1 } }]);

    const [header] = captured.searches ?? [];
    expect(header).toEqual({ index: 'prs-commits' });
  });

  it('갈래마다 각자의 라우팅을 갖는다', async () => {
    const { client, captured } = capturingClient();
    await multiSearch(client, [
      { target: 'prs-pull-requests', query: SCOPED, options: { routing: '1' } },
      { target: 'prs-pull-requests', query: SCOPED, options: { routing: '2' } },
    ]);

    const headers = (captured.searches ?? []).filter((_, index) => index % 2 === 0);
    expect(headers).toEqual([
      { index: 'prs-pull-requests', routing: '1' },
      { index: 'prs-pull-requests', routing: '2' },
    ]);
  });

  it('본문 유효 필드(aggs·_source·timeout)는 본문에 남는다', async () => {
    const { client, captured } = capturingClient();
    await multiSearch(client, [
      {
        target: 'prs-pull-requests',
        query: SCOPED,
        options: {
          routing: '101',
          aggs: { authors: { cardinality: { field: 'author' } } },
          _source: ['pr_number'],
          timeout: '3000ms',
        },
      },
    ]);

    const [, body] = captured.searches ?? [];
    expect(body).toMatchObject({
      aggs: { authors: { cardinality: { field: 'author' } } },
      _source: ['pr_number'],
      timeout: '3000ms',
    });
  });
});
