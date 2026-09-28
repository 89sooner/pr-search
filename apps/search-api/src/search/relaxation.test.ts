/**
 * 완화 후보의 조립과 짝짓기 (CR-128 / FR-SRCH-006 AC-3, DEV-783·DEV-785).
 *
 * 건수가 맞는지는 실제 Elasticsearch를 거치는 통합 시험(`integration/search/relaxation-kind.test.ts`)이
 * 본다. 여기서는 **무엇을 보내는가**와 **받은 것을 어떻게 읽는가**를 본다 — 후보마다 대상을 다시
 * 해석하는지, `kind:`를 걷어 낸 질의인지, 남은 유형이 없는 후보를 보내지 않는지, 왕복에 상한과
 * 재시도 없음을 거는지, 응답을 보낸 후보와 짝짓는지, 세지 못한 갈래를 정확한 건수로 보이지 않는지.
 */

import { describe, expect, it, vi } from 'vitest';
import { errors, type Client } from '@elastic/elasticsearch';
import { EMPTY_RESOLUTION, SequenceEpochRequiredError } from '@prs/es';
import { parseQuery } from '@prs/query';
import {
  RELAXATION_BRANCH_BUDGET_MS,
  RELAXATION_REQUEST_TIMEOUT_MS,
  computeRelaxationHints,
  type RelaxationDeps,
} from './relaxation.js';

const SCOPE = {
  kind: 'explicit',
  repositoryIds: [4021],
  orgIds: [1],
  teamIds: [10],
  visibilities: ['internal'],
} as const;

function counted(value: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    hits: { total: { value, relation: 'eq' }, hits: [] },
    ...extra,
  };
}

interface Sent {
  readonly headers: unknown[];
  readonly bodies: Record<string, unknown>[];
  readonly transport: unknown;
}

/** `msearch`가 받은 것을 모은다. 응답은 갈래 수를 받아 만든다. */
function capturing(respond: (branches: number) => unknown[]): { client: Client; sent: Sent[] } {
  const sent: Sent[] = [];
  const msearch = vi.fn((params: { searches: Record<string, unknown>[] }, transport?: unknown) => {
    const headers = params.searches.filter((_, at) => at % 2 === 0);
    const bodies = params.searches.filter((_, at) => at % 2 === 1);
    sent.push({ headers, bodies, transport });
    return Promise.resolve({ took: 1, responses: respond(bodies.length) });
  });
  return { client: { msearch } as unknown as Client, sent };
}

function deps(client: Client, overrides: Partial<RelaxationDeps> = {}): RelaxationDeps {
  return {
    es: client,
    baseTarget: ['prs-pull-requests', 'prs-commits'],
    scope: SCOPE,
    resolution: EMPTY_RESOLUTION,
    sequenceEpoch: null,
    mergeNumberEpoch: null,
    mergeNumberBaseBranch: null,
    ...overrides,
  };
}

describe('후보마다 검색 대상을 다시 해석한다 (DEV-783)', () => {
  it('**`kind:`를 뺀 후보는 원래 대상에, 남은 후보는 좁힌 대상에 보내고, 어느 본문에도 `kind`가 없다**', async () => {
    const { client, sent } = capturing((branches) => Array.from({ length: branches }, () => counted(1)));
    const result = await computeRelaxationHints(parseQuery('kind:pull_request author:kim'), deps(client));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers).toEqual([
      // `kind:pull_request`를 뺀 후보 — 요청 경로가 허용한 원래 대상 둘
      { index: ['prs-pull-requests', 'prs-commits'] },
      // `author:kim`을 뺀 후보 — 남은 `kind:`가 PR로 좁힌다
      { index: ['prs-pull-requests'] },
    ]);
    // 남기면 `buildQuery`의 가드가 던진다. 걷어 낸 AST로 조립했다는 증거다.
    expect(JSON.stringify(sent[0]?.bodies)).not.toContain('kind');
    expect(result).toEqual({
      hints: [
        { remove: 'kind:pull_request', would_yield: 1 },
        { remove: 'author:kim', would_yield: 1 },
      ],
      truncated: false,
      incomplete: false,
    });
  });

  it('원래 대상이 하나면 그 밖으로 넓히지 않는다', async () => {
    const { client, sent } = capturing((branches) => Array.from({ length: branches }, () => counted(1)));
    await computeRelaxationHints(
      parseQuery('kind:pull_request author:kim'),
      deps(client, { baseTarget: ['prs-pull-requests'] }),
    );
    expect(sent[0]?.headers).toEqual([{ index: ['prs-pull-requests'] }, { index: ['prs-pull-requests'] }]);
  });

  it('**남은 유형이 없는 후보는 보내지 않고, 응답은 보낸 후보와 짝짓는다**', async () => {
    // 후보 셋 중 `author:`를 뺀 후보는 `kind:pull_request -kind:pull_request`만 남아 대상이 없다.
    const { client, sent } = capturing(() => [counted(2), counted(5)]);
    const result = await computeRelaxationHints(
      parseQuery('kind:pull_request -kind:pull_request author:kim'),
      deps(client),
    );

    expect(sent[0]?.headers).toEqual([{ index: ['prs-commits'] }, { index: ['prs-pull-requests'] }]);
    expect(result.hints).toEqual([
      { remove: '-kind:pull_request', would_yield: 5 },
      { remove: 'kind:pull_request', would_yield: 2 },
    ]);
    expect(result.incomplete).toBe(false);
  });

  it('후보마다 강제 접근 범위를 결합한다 (ADR-008)', async () => {
    const { client, sent } = capturing((branches) => Array.from({ length: branches }, () => counted(0)));
    await computeRelaxationHints(parseQuery('kind:commit author:kim label:x'), deps(client));
    for (const body of sent[0]?.bodies ?? []) {
      expect(JSON.stringify(body['query'])).toContain('"repository_id":[4021]');
    }
  });
});

describe('왕복은 한 번이고 상한과 재시도 없음을 건다 (DEV-785)', () => {
  it('msearch 하나에 모든 후보를 싣고, 갈래마다 시간 예산을, 왕복에 상한·재시도 0을 건다', async () => {
    const { client, sent } = capturing((branches) => Array.from({ length: branches }, () => counted(0)));
    await computeRelaxationHints(parseQuery('repo:acme/a author:kim label:x is:open'), deps(client));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.bodies).toHaveLength(4);
    for (const body of sent[0]?.bodies ?? []) {
      expect(body).toMatchObject({ size: 0, track_total_hits: true, timeout: `${String(RELAXATION_BRANCH_BUDGET_MS)}ms` });
    }
    expect(sent[0]?.transport).toEqual({ requestTimeout: RELAXATION_REQUEST_TIMEOUT_MS, maxRetries: 0 });
  });
});

describe('세지 못한 후보를 정확한 건수로 보이지 않는다 (DEV-785)', () => {
  it.each([
    ['갈래 오류', { error: { type: 'search_phase_execution_exception', reason: 'x' }, status: 500 }, 'search_phase_execution_exception'],
    ['샤드 실패', counted(9, { _shards: { total: 2, successful: 1, skipped: 0, failed: 1 } }), 'shard_failures'],
    ['갈래 시간 초과', counted(9, { timed_out: true }), 'timed_out'],
    ['하한 건수', counted(9, { hits: { total: { value: 9, relation: 'gte' }, hits: [] } }), 'total_lower_bound'],
  ] as const)('%s → 그 후보를 싣지 않고 incomplete', async (_label, broken, reason) => {
    const { client } = capturing(() => [broken, counted(3)]);
    const result = await computeRelaxationHints(parseQuery('author:kim label:x'), deps(client));

    expect(result.hints).toEqual([{ remove: 'label:x', would_yield: 3 }]);
    expect(result.incomplete).toBe(true);
    expect(result.failure).toEqual({ stage: 'branch', reason, counted: 2, failed: 1 });
  });

  it('응답이 모자라면 모자란 후보를 세지 못한 것으로 본다', async () => {
    const { client } = capturing(() => [counted(3)]);
    const result = await computeRelaxationHints(parseQuery('author:kim label:x'), deps(client));
    expect(result.hints).toEqual([{ remove: 'author:kim', would_yield: 3 }]);
    expect(result.failure).toEqual({ stage: 'branch', reason: 'missing_response', counted: 2, failed: 1 });
  });

  it.each([
    ['통신 실패', new errors.ConnectionError('down'), 'ConnectionError'],
    ['왕복 상한 초과', new errors.TimeoutError('Request timed out'), 'TimeoutError'],
  ] as const)('왕복 %s는 던지지 않는다 — 빈 목록이지만 「뺄 조건이 없다」가 아니다', async (_label, error, reason) => {
    const msearch = vi.fn().mockRejectedValue(error);
    const result = await computeRelaxationHints(
      parseQuery('author:kim label:x'),
      deps({ msearch } as unknown as Client),
    );
    expect(result).toEqual({
      hints: [],
      truncated: false,
      incomplete: true,
      failure: { stage: 'msearch', reason, counted: 2, failed: 2 },
    });
    expect(msearch).toHaveBeenCalledTimes(1);
  });

  it('후보 조립의 결함은 던진다 — 삼킬지는 호출부가 정한다', async () => {
    const { client } = capturing(() => []);
    // `seq:`가 남은 후보에 에폭이 없다 — 조립 규칙이 틀린 호출이다.
    await expect(
      computeRelaxationHints(parseQuery('repo:acme/a base:main seq:1..2 author:kim'), deps(client)),
    ).rejects.toThrow(SequenceEpochRequiredError);
  });
});
