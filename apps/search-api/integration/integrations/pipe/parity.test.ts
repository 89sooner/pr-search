/**
 * PSI-F 원본 조회와의 parity·경로 인코딩·커서 — 실제 mTLS + PostgreSQL + Redis + Elasticsearch (CR-112).
 *
 * 같은 사용자·같은 질의를 공개 경로(세션 쿠키)와 연동 경로(mTLS + grant)로 보내 본문을 대조한다.
 * 다른 것은 `correlation_id`와 커서 값뿐이어야 한다 — 커서는 서명·결속이 달라 값이 다르고, 있는지 없는지는 같다.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authRepo } from '@prs/db';
import { BILLING, HIDDEN, OPERATOR, OTHER_ISSUER, PAYMENTS, SHA, USER_A, USER_B, bind, startHarness, type Harness } from './fixtures.js';

let h: Harness;
let grantA: string;

beforeAll(async () => {
  h = await startHarness();
  await bind(h.pool, USER_B, OTHER_ISSUER);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.clockOffsetMs = 0;
  h.scopes.set(USER_A.userId, [PAYMENTS, BILLING]);
  h.scopes.set(USER_B.userId, [BILLING]);
  h.scopes.set(OPERATOR.userId, [PAYMENTS, BILLING, HIDDEN]);
  await h.resetScopeCache();
  grantA = await h.grantFor(USER_A, { contextId: `ctx-parity-${String(Date.now())}-a` });
});

function comparable(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  const rest: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  const cursor = rest['next_cursor'];
  delete rest['correlation_id'];
  delete rest['next_cursor'];
  return { ...rest, has_next_cursor: cursor === undefined ? 'absent' : cursor !== null };
}

async function parity(publicUrl: string, readPath: string): Promise<{ status: number; body: unknown }> {
  const publicResponse = await h.publicGet(publicUrl, USER_A);
  const integration = await h.get(readPath, grantA);
  expect(integration.headers['cache-control']).toBe('private, no-store');
  expect(integration.headers['set-cookie']).toBeUndefined();
  const left = { status: publicResponse.status, body: comparable(JSON.parse(publicResponse.body)) };
  const right = { status: integration.status, body: comparable(JSON.parse(integration.body)) };
  expect(right).toEqual(left);
  return right;
}

describe('PSI-F01 10개 조회 operation parity (허용 목록 ⊇ 사용자 범위)', () => {
  it.each([
    ['repositories', '/api/v1/repositories?limit=50', '/read/repositories?limit=50', 200],
    ['search', '/api/v1/search?q=&size=50&facets=true', '/read/search?q=&size=50&facets=true', 200],
    ['search 정렬', '/api/v1/search?q=&sort=merged_at&order=asc&size=2', '/read/search?q=&sort=merged_at&order=asc&size=2', 200],
    ['search 문법 오류', '/api/v1/search?q=nokey%3Avalue', '/read/search?q=nokey%3Avalue', 400],
    ['search 정렬 키 오류', '/api/v1/search?q=&sort=bogus', '/read/search?q=&sort=bogus', 400],
    ['resolve SHA 접두', `/api/v1/resolve?q=${SHA.slice(0, 7)}`, `/read/resolve?q=${SHA.slice(0, 7)}`, 200],
    ['resolve PR', `/api/v1/resolve?q=${encodeURIComponent('acme/payments#1')}`, `/read/resolve?q=${encodeURIComponent('acme/payments#1')}`, 200],
    // query 값의 뜻은 원본 그대로다 — 형식이 틀린 저장소 힌트는 두 경로 모두 조용히 버리고 범위 안에서 해석한다.
    // 경로 파라미터 `{repository}`와 달리 연동 계층이 400으로 바꾸지 않는다 (CONTRACT_DIFF D-03).
    ['resolve 형식이 틀린 저장소 힌트', `/api/v1/resolve?q=${SHA.slice(0, 7)}&repository=x/..`, `/read/resolve?q=${SHA.slice(0, 7)}&repository=x/..`, 200],
    ['resolve 이중 인코딩된 저장소 힌트', `/api/v1/resolve?q=${SHA.slice(0, 7)}&repository=acme%252Fpayments`, `/read/resolve?q=${SHA.slice(0, 7)}&repository=acme%252Fpayments`, 200],
    ['resolve 너무 짧은 hex', '/api/v1/resolve?q=abc12', '/read/resolve?q=abc12', 400],
    ['M 번호 해석', '/api/v1/merge-numbers/resolve?repository=acme/payments&base_branch=main&pr_number=1', '/read/merge-numbers/resolve?repository=acme/payments&base_branch=main&pr_number=1', undefined],
    ['M 번호 입력 오류', '/api/v1/merge-numbers/resolve?repository=acme/payments&base_branch=main', '/read/merge-numbers/resolve?repository=acme/payments&base_branch=main', 400],
    ['PR 상세', '/api/v1/pull-requests/acme%2Fpayments/1', '/read/pull-requests/acme%2Fpayments/1', 200],
    ['PR 상세 없음', '/api/v1/pull-requests/acme%2Fpayments/999', '/read/pull-requests/acme%2Fpayments/999', 404],
    ['범위 밖 PR 상세', '/api/v1/pull-requests/other%2Fsecret/9', '/read/pull-requests/other%2Fsecret/9', 404],
    ['커밋 상세', `/api/v1/commits/acme%2Fpayments/${SHA}`, `/read/commits/acme%2Fpayments/${SHA}`, 200],
    ['source tree', '/api/v1/source/acme%2Fpayments/tree', '/read/source/acme%2Fpayments/tree', 200],
    ['source history', '/api/v1/source/acme%2Fpayments/history?path=README.md', '/read/source/acme%2Fpayments/history?path=README.md', 200],
    ['source file', `/api/v1/source/acme%2Fpayments/file?path=src%2Fpay%2Fretry.ts&revision=${SHA}`, `/read/source/acme%2Fpayments/file?path=src%2Fpay%2Fretry.ts&revision=${SHA}`, 200],
    ['source diff', `/api/v1/source/acme%2Fpayments/diff?commit=${SHA}`, `/read/source/acme%2Fpayments/diff?commit=${SHA}`, 200],
    ['source 입력 오류', '/api/v1/source/acme%2Fpayments/file?path=..%2Fsecret&revision=' + SHA, '/read/source/acme%2Fpayments/file?path=..%2Fsecret&revision=' + SHA, 400],
    ['범위 밖 source', '/api/v1/source/other%2Fsecret/tree', '/read/source/other%2Fsecret/tree', 404],
  ] as const)('%s', async (_label, publicUrl, readPath, status) => {
    const result = await parity(publicUrl, readPath);
    if (status !== undefined) expect(result.status).toBe(status);
  });
});

describe('PSI-F06 커서: 사용자·client 결속과 범위 변경', () => {
  it('두 경로가 같은 순서를 잇고, 서로의 커서·다른 사용자의 커서를 받지 않는다', async () => {
    const firstPublic = (await h.publicGet('/api/v1/search?q=&size=1', USER_A)).json<{ items: unknown[]; next_cursor: string }>();
    const first = (await h.get('/read/search?q=&size=1', grantA)).json<{ items: unknown[]; next_cursor: string }>();
    expect(first.items).toEqual(firstPublic.items);
    const secondPublic = (await h.publicGet(`/api/v1/search?q=&size=1&cursor=${encodeURIComponent(firstPublic.next_cursor)}`, USER_A)).json<{ items: unknown[] }>();
    const second = (await h.get(`/read/search?q=&size=1&cursor=${encodeURIComponent(first.next_cursor)}`, grantA)).json<{ items: unknown[] }>();
    expect(second.items).toEqual(secondPublic.items);

    // 공개 커서를 연동 경로에서 — 결속이 달라 거절된다.
    const crossed = await h.get(`/read/search?q=&size=1&cursor=${encodeURIComponent(firstPublic.next_cursor)}`, grantA);
    expect([crossed.status, crossed.json<{ error: { code: string } }>().error.code]).toEqual([400, 'CURSOR_QUERY_MISMATCH']);
    // 다른 사용자가 같은 범위를 갖게 해도 A의 커서를 받지 않는다.
    await bind(h.pool, OPERATOR).catch(() => undefined);
    h.scopes.set(OPERATOR.userId, [PAYMENTS, BILLING]);
    const grantOperator = await h.grantFor(OPERATOR, { contextId: `ctx-parity-${String(Date.now())}-op` });
    const stolen = await h.get(`/read/search?q=&size=1&cursor=${encodeURIComponent(first.next_cursor)}`, grantOperator);
    expect(stolen.json<{ error: { code: string } }>().error.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('권한이 회수된 뒤 옛 커서는 더 넓은 자료를 읽지 못한다 — 자동으로 첫 페이지를 합치지 않는다', async () => {
    const first = (await h.get('/read/search?q=&size=1', grantA)).json<{ next_cursor: string }>();
    h.scopes.set(USER_A.userId, [PAYMENTS]);
    await authRepo.invalidateUsers(h.pool, [USER_A.userId]);
    await h.resetScopeCache();
    const next = await h.get(`/read/search?q=&size=1&cursor=${encodeURIComponent(first.next_cursor)}`, grantA);
    expect([next.status, next.json<{ error: { code: string } }>().error.code]).toEqual([400, 'CURSOR_QUERY_MISMATCH']);
  });
});

describe('PSI-F08 에폭 낡음·부분 상태는 원본 의미 그대로다', () => {
  it('seq_epoch이 낡으면 두 경로 모두 200 epoch_stale이고 결과 키를 만들지 않는다', async () => {
    const q = encodeURIComponent('repo:"acme/payments" base:main seq:1..2');
    const result = await parity(`/api/v1/search?q=${q}&seq_epoch=2`, `/read/search?q=${q}&seq_epoch=2`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ epoch_stale: true });
    expect(result.body).not.toHaveProperty('items');
  });

  it('History의 PR 연결 상태·source 결과 필드를 그대로 싣는다', async () => {
    const result = await parity('/api/v1/source/acme%2Fpayments/history', '/read/source/acme%2Fpayments/history');
    expect(result.body).toHaveProperty('commits');
  });
});

describe('0개 저장소(교집합이 빈) 사용자 — 원본의 기본 거부 의미 그대로 (CONTRACT_DIFF D-01)', () => {
  it('pipe-other(허용: payments)로 billing 사용자가 부르면 경로마다 원본과 같은 답이다', async () => {
    const other = await h.exchange(await h.signAssertion({ user: USER_B, client: 'other', contextId: 'ctx-parity-empty-0001' }), { identity: h.tls.pipeOther });
    expect(other.status).toBe(200);
    const grant = other.json<{ access_token: string }>().access_token;
    const read = (path: string) => h.get(path, grant, { identity: h.tls.pipeOther });

    // 같은 의미를 일반 경로에서 만든다: 볼 수 있는 저장소가 하나도 없는 사용자.
    h.scopes.set(USER_A.userId, []);
    await h.resetScopeCache();
    const cases: readonly [string, string, number, string | null][] = [
      ['/read/search?q=', '/api/v1/search?q=', 503, 'PERMISSION_UNAVAILABLE'],
      ['/read/resolve?q=' + SHA.slice(0, 7), '/api/v1/resolve?q=' + SHA.slice(0, 7), 503, 'PERMISSION_UNAVAILABLE'],
      ['/read/pull-requests/acme%2Fpayments/1', '/api/v1/pull-requests/acme%2Fpayments/1', 503, 'PERMISSION_UNAVAILABLE'],
      [`/read/commits/acme%2Fpayments/${SHA}`, `/api/v1/commits/acme%2Fpayments/${SHA}`, 503, 'PERMISSION_UNAVAILABLE'],
      ['/read/repositories', '/api/v1/repositories', 200, null],
      ['/read/source/acme%2Fpayments/tree', '/api/v1/source/acme%2Fpayments/tree', 404, 'NOT_FOUND'],
      ['/read/merge-numbers/resolve?repository=acme/payments&base_branch=main&pr_number=1', '/api/v1/merge-numbers/resolve?repository=acme/payments&base_branch=main&pr_number=1', 404, 'NOT_FOUND'],
    ];
    for (const [readPath, publicUrl, status, errorCode] of cases) {
      const integration = await read(readPath);
      const publicResponse = await h.publicGet(publicUrl, USER_A);
      expect([readPath, integration.status]).toEqual([readPath, status]);
      expect([publicUrl, publicResponse.status]).toEqual([publicUrl, status]);
      if (errorCode === null) {
        expect(integration.json<{ items: unknown[] }>().items).toEqual([]);
      } else {
        expect(integration.json<{ error: { code: string } }>().error.code).toBe(errorCode);
      }
    }
  });
});

describe('PSI-F03~F05 경로·query 인코딩', () => {
  it('owner/repo는 %2F 하나로, 파일 경로의 slash는 그대로 받는다', async () => {
    expect((await h.get(`/read/source/acme%2Fpayments/file?path=src%2Fpay%2Fretry.ts&revision=${SHA}`, grantA)).status).toBe(200);
    expect((await h.get('/read/source/acme%2Fpayments/tree?ref=release%2F1.2', grantA)).status).toBe(200);
  });

  it.each([
    ['이중 인코딩', '/read/pull-requests/acme%252Fpayments/1'],
    ['dot segment', '/read/pull-requests/acme%2F..%2Fpayments/1'],
    ['상위 조각', '/read/source/..%2Fpayments/tree'],
    ['인코딩된 점', '/read/source/acme%2F%2e%2e/tree'],
    ['역슬래시', '/read/commits/acme%5Cpayments/' + SHA],
    ['경로 CRLF', '/read/pull-requests/acme%2Fpay%0D%0Aments/1'],
    ['PR 번호의 %', '/read/pull-requests/acme%2Fpayments/1%2531'],
  ])('%s 는 400 INVALID_REQUEST다 (PSI-F04)', async (_label, path) => {
    const response = await h.get(path, grantA);
    expect(response.status).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('INVALID_REQUEST');
  });

  it.each([
    ['중복 q', '/read/search?q=billing&q=payments'],
    ['중복 size', '/read/search?q=&size=1&size=200'],
    ['모르는 key', '/read/search?q=&upstream=https%3A%2F%2Fevil'],
    ['query CRLF', '/read/search?q=a%0D%0ASet-Cookie%3Ax'],
    ['깨진 escape', '/read/search?q=%E0%A4%A'],
    ['source의 불필요한 key', '/read/source/acme%2Fpayments/tree?page=2'],
    ['상세 경로의 query', '/read/pull-requests/acme%2Fpayments/1?include=secret'],
  ])('%s 는 400 INVALID_REQUEST다 (PSI-F04·F05)', async (_label, path) => {
    const response = await h.get(path, grantA);
    expect(response.status).toBe(400);
  });

  it('원본 경로의 현 동작 기록 — 이중 인코딩·중복 key를 받는다 (DEV-730·DEV-731, 연동은 거절)', async () => {
    // 고치면 이 단언을 바꾼다. 지금은 원본을 바꾸지 않는 작업이라 사실만 남긴다.
    expect((await h.publicGet('/api/v1/pull-requests/acme%252Fpayments/1', USER_A)).status).toBe(200);
    const duplicated = await h.publicGet('/api/v1/search?q=billing&q=payments&size=50', USER_A);
    expect(duplicated.status).toBe(200);
    expect(duplicated.json<{ query: string }>().query).toBe('');
  });
});
