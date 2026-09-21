/**
 * PSI-C grant·로그인 문맥·회수 — 실제 mTLS + PostgreSQL + Redis, 복제본 둘 (CR-112).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME, SESSION_KEY_PREFIX } from '@prs/authz';
import { runPipeIntegrationCommand } from '../../../src/integrations/pipe/command.js';
import { CLIENT_DEV, GHE_HOST, USER_A, USER_B, startHarness, type Harness } from './fixtures.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ replicas: 2 });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.clockOffsetMs = 0;
  await h.pool.query('DELETE FROM pipe_integration_credential_revocation');
  await h.resetScopeCache();
});

interface ErrorBody {
  readonly error: { readonly code: string; readonly retryable: boolean };
}

const code = (response: { json<T>(): T }): string => response.json<ErrorBody>().error.code;

async function sessionKeys(): Promise<number> {
  let cursor = '0';
  let total = 0;
  do {
    const [next, keys] = await h.redis.scan(cursor, 'MATCH', `${SESSION_KEY_PREFIX}*`, 'COUNT', 500);
    cursor = next;
    total += keys.length;
  } while (cursor !== '0');
  return total;
}

async function cli(argv: readonly string[]): Promise<number> {
  return runPipeIntegrationCommand(argv, { pool: h.pool, gheBaseUrl: `https://${GHE_HOST}`, out: () => undefined, err: () => undefined });
}

describe('PSI-C01 grant 저장 위치', () => {
  it('서버에는 해시만 있고, 일반 세션 이름공간에 아무것도 쓰지 않는다', async () => {
    const before = await sessionKeys();
    const response = await h.exchange(await h.signAssertion({ user: USER_A, contextId: 'ctx-c01-storage-0001' }));
    const token = response.json<{ access_token: string }>().access_token;
    expect(await sessionKeys()).toBe(before);
    const { rows } = await h.pool.query<Record<string, unknown>>('SELECT * FROM pipe_integration_grant');
    expect(JSON.stringify(rows)).not.toContain(token);
    const events = await h.pool.query<Record<string, unknown>>('SELECT * FROM pipe_integration_event');
    expect(JSON.stringify(events.rows)).not.toContain(token);
  });
});

describe('PSI-C02 수명 상한', () => {
  it('원 로그인 자격 만료가 300초보다 이르면 그때까지만 산다', async () => {
    const nowS = Math.floor(h.now() / 1000);
    const response = await h.exchange(
      await h.signAssertion({ contextId: 'ctx-c02-short-auth-01', overrides: { auth_expires_at: nowS + 30 } }),
    );
    const body = response.json<{ expires_in: number; expires_at: string }>();
    expect(body.expires_in).toBeLessThanOrEqual(30);
    expect(Date.parse(body.expires_at)).toBeLessThanOrEqual((nowS + 30) * 1000);
  });

  it('요청마다 늘지 않는다 — 300초 뒤 GRANT_EXPIRED, 진단 창(120초) 뒤 GRANT_INVALID', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-c02-lifetime-001' });
    const first = await h.get('/context', grant);
    h.clockOffsetMs = 150_000;
    const second = await h.get('/context', grant);
    expect(first.json<{ expires_at: string }>().expires_at).toBe(second.json<{ expires_at: string }>().expires_at);

    h.clockOffsetMs = 301_000;
    const expired = await h.get('/context', grant);
    expect([expired.status, code(expired)]).toEqual([401, 'GRANT_EXPIRED']);
    expect(expired.json<ErrorBody>().error.retryable).toBe(true);

    h.clockOffsetMs = 421_000;
    const gone = await h.get('/context', grant);
    expect([gone.status, code(gone)]).toEqual([401, 'GRANT_INVALID']);
  });
});

describe('PSI-C03 다른 mTLS 인증서로 유효 grant 사용', () => {
  it('같은 client의 교체 인증서라도 발급 인증서가 아니면 GRANT_BINDING_MISMATCH다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-c03-rotation-001' });
    const other = await h.get('/context', grant, { identity: h.tls.pipeDevRotated });
    expect([other.status, code(other)]).toEqual([401, 'GRANT_BINDING_MISMATCH']);
    // 새 인증서로는 새로 발급받는다.
    const rotated = await h.exchange(await h.signAssertion({ contextId: 'ctx-c03-rotation-001' }), { identity: h.tls.pipeDevRotated });
    expect(rotated.status).toBe(200);
    expect((await h.get('/context', rotated.json<{ access_token: string }>().access_token, { identity: h.tls.pipeDevRotated })).status).toBe(200);
  });
});

describe('PSI-C04 grant를 일반 cookie·Bearer로 사용', () => {
  it.each(['/api/v1/search?q=x', '/api/v1/me', '/api/v1/repositories', '/api/v1/admin/dead-letters'])(
    '%s 는 grant를 받지 않는다',
    async (url) => {
      const grant = await h.grantFor(USER_A, { contextId: `ctx-c04-${String(url.length)}-000001` });
      const asBearer = await h.publicGet(url, null, { authorization: `Bearer ${grant}` });
      const asCookie = await h.publicGet(url, null, { cookie: `${SESSION_COOKIE_NAME}=${grant}` });
      // 관리 경로는 이 하네스에 등록되지 않아 404일 수 있다 — 어느 쪽이든 인증되지 않는다.
      expect([401, 404]).toContain(asBearer.status);
      expect([401, 404]).toContain(asCookie.status);
      if (url !== '/api/v1/admin/dead-letters') {
        expect(asBearer.status).toBe(401);
        expect(asCookie.status).toBe(401);
      }
    },
  );
});

describe('PSI-C05 ordinary browser cookie로 Integration 접근', () => {
  it('쿠키는 grant·mTLS를 대신하지 못하고, 유효 grant와 함께 와도 거절된다', async () => {
    const session = await h.publicGet('/api/v1/me', USER_A);
    expect(session.status).toBe(200);
    const cookieOnly = await h.get('/context', null, { headers: { cookie: `${SESSION_COOKIE_NAME}=whatever` } });
    expect([cookieOnly.status, code(cookieOnly)]).toEqual([400, 'INVALID_REQUEST']);
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-c05-cookie-00001' });
    const both = await h.get('/context', grant, { headers: { cookie: `${SESSION_COOKIE_NAME}=whatever` } });
    expect([both.status, code(both)]).toEqual([400, 'INVALID_REQUEST']);
    const neither = await h.get('/context', null);
    expect([neither.status, code(neither)]).toEqual([401, 'GRANT_INVALID']);
  });
});

describe('PSI-C06 서명키·client·인증서 긴급 회수', () => {
  it.each([
    ['signing_key', 'k-dev-1'],
    ['client', CLIENT_DEV],
  ] as const)('%s를 회수하면 기발급 grant도 다음 요청에서 거절되고 새 발급도 막힌다', async (kind, id) => {
    const grant = await h.grantFor(USER_A, { contextId: `ctx-c06-${kind}-0000001` });
    expect((await h.get('/context', grant)).status).toBe(200);
    expect(await cli(['credentials', 'revoke', '--client-id', CLIENT_DEV, '--kind', kind, '--id', id, '--reason', '유출 대응', '--actor', 'tester', '--apply'])).toBe(0);
    const after = await h.get('/context', grant, { replica: 1 });
    expect([after.status, code(after)]).toEqual([403, 'CLIENT_DISABLED']);
    const fresh = await h.exchange(await h.signAssertion({ contextId: `ctx-c06-${kind}-0000002` }));
    expect([fresh.status, code(fresh)]).toEqual([403, 'CLIENT_DISABLED']);
  });

  it('인증서를 회수하면 그 인증서의 grant만 죽고 교체 인증서로는 계속 쓴다', async () => {
    const old = await h.grantFor(USER_A, { contextId: 'ctx-c06-cert-000001' });
    const rotated = await h.exchange(await h.signAssertion({ contextId: 'ctx-c06-cert-000002' }), { identity: h.tls.pipeDevRotated });
    const rotatedGrant = rotated.json<{ access_token: string }>().access_token;
    expect(await cli(['credentials', 'revoke', '--client-id', CLIENT_DEV, '--kind', 'certificate', '--id', h.tls.pipeDev.sha256, '--reason', '교체', '--actor', 'tester', '--apply'])).toBe(0);
    const dead = await h.get('/context', old);
    expect([dead.status, code(dead)]).toEqual([403, 'CLIENT_DISABLED']);
    expect((await h.get('/context', rotatedGrant, { identity: h.tls.pipeDevRotated })).status).toBe(200);
  });

  it('dry-run은 아무것도 바꾸지 않는다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-c06-dryrun-00001' });
    expect(await cli(['credentials', 'revoke', '--client-id', CLIENT_DEV, '--kind', 'client', '--reason', '연습', '--actor', 'tester'])).toBe(0);
    expect((await h.get('/context', grant)).status).toBe(200);
  });
});

describe('PSI-C07 개별 revoke 반복', () => {
  it('해당 grant만 끝나고, 반복·미존재·남의 grant에 같은 응답을 준다', async () => {
    const target = await h.grantFor(USER_A, { contextId: 'ctx-c07-revoke-00001' });
    const sibling = await h.grantFor(USER_A, { contextId: 'ctx-c07-revoke-00001' });
    const otherContext = await h.grantFor(USER_A, { contextId: 'ctx-c07-revoke-00002' });

    const first = await h.post('/auth/revoke', undefined, { headers: { authorization: `Bearer ${target}` } });
    const again = await h.post('/auth/revoke', undefined, { headers: { authorization: `Bearer ${target}` } });
    const unknown = await h.post('/auth/revoke', undefined, { headers: { authorization: `Bearer psig1_${'A'.repeat(43)}` } });
    const malformed = await h.post('/auth/revoke', undefined, { headers: { authorization: 'Bearer nope' } });
    const shapes = [first, again, unknown, malformed].map((response) => {
      const body = response.json<Record<string, unknown>>();
      return [response.status, body['protocol_version'], body['revoked'], Object.keys(body).sort().join(',')];
    });
    expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(1);
    expect(shapes[0]).toEqual([200, 'PSI-1.0', true, 'correlation_id,protocol_version,revoked']);

    expect(code(await h.get('/context', target))).toBe('GRANT_REVOKED');
    expect((await h.get('/context', sibling)).status).toBe(200);
    expect((await h.get('/context', otherContext)).status).toBe(200);
  });

  it('다른 client는 남의 grant를 회수하지 못한다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-c07-foreign-0001' });
    const response = await h.post('/auth/revoke', undefined, { identity: h.tls.pipeOther, headers: { authorization: `Bearer ${grant}` } });
    expect(response.status).toBe(200);
    expect((await h.get('/context', grant)).status).toBe(200);
  });
});

describe('PSI-C08 context revoke 대 exchange 경합 (복제본 둘)', () => {
  it('회수가 끝난 뒤 그 문맥에 살아 있는 grant가 남지 않는다', async () => {
    for (let round = 0; round < 12; round += 1) {
      const contextId = `ctx-c08-race-${String(round).padStart(3, '0')}-00`;
      const exchangeAssertion = await h.signAssertion({ user: USER_B, contextId });
      const revokeAssertion = await h.signAssertion({ user: USER_B, contextId, purpose: 'revoke_context' });
      const [issued, revoked] = await Promise.all([
        h.exchange(exchangeAssertion, { replica: round % 2 }),
        h.post('/auth/revoke-context', JSON.stringify({ assertion: revokeAssertion }), { replica: (round + 1) % 2 }),
      ]);
      expect(revoked.status).toBe(200);
      if (issued.status === 200) {
        // 발급이 먼저 끝났어도 회수가 그 grant까지 죽였다.
        const grant = issued.json<{ access_token: string }>().access_token;
        expect(code(await h.get('/context', grant, { replica: round % 2 }))).toBe('CONTEXT_REVOKED');
      } else {
        expect(code(issued)).toBe('CONTEXT_REVOKED');
      }
      const { rows } = await h.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pipe_integration_grant WHERE auth_context_id = $1 AND revoked_at IS NULL`,
        [contextId],
      );
      expect(rows[0]?.n).toBe(0);
    }
  });
});

describe('PSI-C09 logout 뒤 같은 옛 PIPE 로그인 문맥', () => {
  it('회수 표식이 같은 문맥의 재연결을 막는다 (새 jti여도)', async () => {
    const contextId = 'ctx-c09-logout-000001';
    const grant = await h.grantFor(USER_A, { contextId });
    const revoke = await h.post('/auth/revoke-context', JSON.stringify({ assertion: await h.signAssertion({ contextId, purpose: 'revoke_context' }) }));
    expect(revoke.json<{ revoked: boolean; auth_context_id: string }>()).toMatchObject({ revoked: true, auth_context_id: contextId });
    expect(code(await h.get('/context', grant))).toBe('CONTEXT_REVOKED');
    const again = await h.exchange(await h.signAssertion({ contextId }));
    expect([again.status, code(again)]).toEqual([403, 'CONTEXT_REVOKED']);
    // 회수 assertion의 재사용은 재생으로 막힌다.
    const replayAssertion = await h.signAssertion({ contextId, purpose: 'revoke_context' });
    expect((await h.post('/auth/revoke-context', JSON.stringify({ assertion: replayAssertion }))).status).toBe(200);
    expect(code(await h.post('/auth/revoke-context', JSON.stringify({ assertion: replayAssertion })))).toBe('ASSERTION_REPLAYED');
  });

  it('회수 목적은 지난 auth_expires_at도 받는다 (만료된 로그인 문맥 정리)', async () => {
    const nowS = Math.floor(h.now() / 1000);
    const response = await h.post('/auth/revoke-context', JSON.stringify({
      assertion: await h.signAssertion({ contextId: 'ctx-c09-expired-00001', purpose: 'revoke_context', overrides: { auth_expires_at: nowS - 3600 } }),
    }));
    expect(response.status).toBe(200);
  });
});

describe('PSI-C10 다른 기기 로그인·refresh', () => {
  it('한 문맥의 회수가 다른 문맥을 건드리지 않고, 새 문맥은 옛 grant를 승계하지 않는다', async () => {
    const laptop = await h.grantFor(USER_A, { contextId: 'ctx-c10-laptop-00001' });
    const phone = await h.grantFor(USER_A, { contextId: 'ctx-c10-phone-000001' });
    await h.post('/auth/revoke-context', JSON.stringify({ assertion: await h.signAssertion({ contextId: 'ctx-c10-laptop-00001', purpose: 'revoke_context' }) }));
    expect(code(await h.get('/context', laptop))).toBe('CONTEXT_REVOKED');
    expect((await h.get('/context', phone)).status).toBe(200);
    // family 없는 refresh = 새 문맥이다. 새 grant가 따로 나오고 옛 grant ID와 다르다.
    const refreshed = await h.exchange(await h.signAssertion({ contextId: 'ctx-c10-refreshed-01' }));
    const phoneContext = await h.get('/context', phone);
    expect(refreshed.json<{ grant_id: string }>().grant_id).not.toBe(phoneContext.json<{ grant_id: string }>().grant_id);
  });
});
