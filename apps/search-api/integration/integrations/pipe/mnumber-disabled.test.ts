/**
 * CONTRACT_DIFF D-07 — M 번호 기능이 꺼진 배포 — 실제 mTLS + PostgreSQL + Redis + Elasticsearch (CR-112).
 *
 * 능력 목록(`capabilities`)과 `/context`의 조회 목록(`operations`)에서 M 번호 해석이 함께 빠지고, 경로를 불러도
 * 원본처럼 404 `NOT_FOUND`(`detail.reason = feature_disabled`, 원본 봉투)다. 나머지 조회는 그대로다.
 * 다른 시험 파일의 하네스는 M 번호가 켜진 배포다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_OPERATIONS } from '../../../src/integrations/pipe/operations.js';
import { BILLING, PAYMENTS, USER_A, startHarness, type Harness } from './fixtures.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ mergeNumberEnabled: false });
  h.scopes.set(USER_A.userId, [PAYMENTS, BILLING]);
  await h.resetScopeCache();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe('D-07 M 번호가 꺼진 배포', () => {
  it('발급과 /context의 능력·조회 목록에서 M 번호 해석이 함께 빠진다', async () => {
    const exchange = await h.exchange(await h.signAssertion({ user: USER_A, contextId: 'ctx-mnum-off-000001' }));
    expect(exchange.status).toBe(200);
    const issued = exchange.json<{ access_token: string; capabilities: string[] }>();
    expect(issued.capabilities).toEqual(['search:read', 'source:read']);

    const context = (await h.get('/context', issued.access_token)).json<{ capabilities: string[]; operations: string[] }>();
    expect(context.capabilities).toEqual(['search:read', 'source:read']);
    expect(context.operations).toEqual(
      INTEGRATION_OPERATIONS.filter(
        (operation) => operation.id.startsWith('read.') && operation.id !== 'read.merge_numbers.resolve',
      ).map((operation) => operation.id),
    );
  });

  it('M 번호 해석을 불러도 원본처럼 404 feature_disabled이고, 다른 조회는 그대로다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-mnum-off-000002' });
    const response = await h.get('/read/merge-numbers/resolve?repository=acme/payments&base_branch=main&pr_number=1', grant);
    expect(response.status).toBe(404);
    const error = response.json<{ error: Record<string, unknown> }>().error;
    expect(error['code']).toBe('NOT_FOUND');
    expect(error['detail']).toEqual({ reason: 'feature_disabled' });
    // 원본 봉투다 — 연동 봉투의 `retryable`이 없다.
    expect('retryable' in error).toBe(false);

    const search = await h.get('/read/search?q=&size=1', grant);
    expect(search.status).toBe(200);
  });
});
