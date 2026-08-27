/**
 * `runRange`의 `size: 0` 경로 (WP-026 / API-SEQ-003, CR-030 DEV-156).
 *
 * API 계약이 "`size=0`이면 항목 질의를 아예 돌리지 않는다"고 적으므로 그 주장을
 * 여기서 붙잡는다. **응답만 보면 이 주장을 검증할 수 없다** — `LIMIT 0`으로 한
 * 왕복을 돌아도 `items`는 똑같이 비어 있기 때문이다. 그래서 질의 자체를 센다.
 *
 * 대역 pool 하나면 충분하다: 구간에 PR이 하나도 없으면 `runRange`가 Elasticsearch
 * 왕복 전에 돌아오므로(DEV-136과 같은 갈래) 색인 대역이 필요 없다.
 */

import { describe, expect, it } from 'vitest';
import type { Pool } from '@prs/db';
import type { Client } from '@elastic/elasticsearch';
import { runRange } from './range.js';
import { createCursorSigner } from '../cursor/envelope.js';
import type { ResolvedSpace } from './space.js';

const SPACE: ResolvedSpace = {
  repositoryId: 1,
  baseBranch: 'main',
  seqEpoch: 1,
  state: 'ok',
  headSeq: 10,
  sequenceSpace: 'acme/payments@main',
};

const SCOPE = {
  repositoryIds: [1],
  orgIds: [1],
  teamIds: [],
  visibilities: ['internal'],
} as unknown as Parameters<typeof runRange>[0]['scope'];

/** 부르면 던지는 색인 대역 — 이 경로가 색인을 부르지 않는다는 단언이기도 하다. */
const ES = {
  msearch: () => {
    throw new Error('PR이 없는 구간은 색인을 부르지 않는다');
  },
} as unknown as Client;

function stubPool(): { pool: Pool; queries: string[] } {
  const queries: string[] = [];
  const pool = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;
  return { pool, queries };
}

const SIGNER = createCursorSigner('range-unit-test-key-0123456789abcdef');

const request = (size: number): Parameters<typeof runRange>[0] => ({
  space: SPACE,
  scope: SCOPE,
  scopeVersion: 1,
  fromExclusive: 2,
  toInclusive: 5,
  size,
  ast: null,
  rangeTotal: 3,
  cursor: null,
  facets: false,
});

const DEPS = {
  resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
  cursorSigner: SIGNER,
};

describe('runRange size=0 (API-SEQ-003의 요약 전용 호출)', () => {
  it('**항목 질의를 아예 돌리지 않는다** — 안 그릴 목록을 위해 PostgreSQL을 부르지 않는다', async () => {
    const { pool, queries } = stubPool();
    const result = await runRange(request(0), { pool, es: ES, ...DEPS });

    expect(result.items).toEqual([]);
    expect(queries.some((sql) => sql.includes('LIMIT'))).toBe(false);
    // 요약의 근거인 PR 번호 질의는 그대로 돈다 — 요약이 이 호출의 목적이다.
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('pull_request_number');
  });

  it('size가 1 이상이면 항목 질의가 돈다 — 이 시험이 위 단언의 대조군이다', async () => {
    const { pool, queries } = stubPool();
    await runRange(request(50), { pool, es: ES, ...DEPS });

    /*
     * WP-032가 페이지를 만드는 방식을 바꿨다 — 첫 `size` 행을 자르는 것이 아니라
     * **chunk로 훑으며 판정한다** (DEV-270). 대역 pool이 빈 결과를 주므로 첫
     * chunk에서 순회가 끝나고, 질의는 PR 번호 하나 + chunk 하나로 둘이다.
     */
    expect(queries).toHaveLength(2);
    expect(queries.some((sql) => sql.includes('LIMIT'))).toBe(true);
  });
});
