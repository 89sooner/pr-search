/**
 * PSI-A 서비스 인증·assertion — 실제 mTLS 리스너 + PostgreSQL + Redis (CR-112).
 *
 * 여기서 "mTLS"는 이 시험이 `openssl`로 만든 CA·인증서로 127.0.0.1에서 실제 핸드셰이크를 한 결과다.
 * 사내 CA·운영 HAProxy를 거친 검증이 아니다 (TEST_RESULTS의 NOT_RUN 항목).
 */

import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INTEGRATION_PREFIX } from '../../../src/integrations/pipe/operations.js';
import { OPERATOR, OTHER_ISSUER, USER_A, bind, startHarness, type Harness } from './fixtures.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ replicas: 2 });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.faults.replayDown = false;
  h.faults.directoryDown = false;
  h.faults.scopeDown = false;
  h.clockOffsetMs = 0;
  await h.resetScopeCache();
});

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean };
  readonly correlation_id: string;
}

async function grantCount(): Promise<number> {
  const { rows } = await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM pipe_integration_grant');
  return rows[0]?.n ?? 0;
}

describe('PSI-A01 유효한 mTLS·서명·claim', () => {
  it('승인된 client와 active binding에만 300초 이하 grant를 발급하고, 서버에는 해시만 남긴다', async () => {
    const response = await h.exchange(await h.signAssertion({ user: USER_A }));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['set-cookie']).toBeUndefined();

    const body = response.json<{
      protocol_version: string; token_type: string; access_token: string; grant_id: string;
      expires_in: number; expires_at: string; binding_version: number; identity: { ghe_login: string };
      capabilities: string[]; auth_context_id: string; correlation_id: string;
    }>();
    expect(body).toMatchObject({
      protocol_version: 'PSI-1.0',
      token_type: 'Bearer',
      binding_version: 1,
      identity: { ghe_login: USER_A.login },
      capabilities: ['search:read', 'source:read', 'merge_number:read'],
      auth_context_id: `ctx-${USER_A.subject}-0001`,
    });
    expect(body.access_token).toMatch(/^psig1_[A-Za-z0-9_-]{43}$/);
    expect(body.expires_in).toBeGreaterThanOrEqual(299);
    expect(body.expires_in).toBeLessThanOrEqual(300);
    expect(Date.parse(body.expires_at) - h.now()).toBeLessThanOrEqual(300_000);
    expect(response.headers['x-correlation-id']).toBe(body.correlation_id);

    const { rows } = await h.pool.query<Record<string, unknown>>('SELECT * FROM pipe_integration_grant WHERE grant_id = $1', [body.grant_id]);
    expect(rows[0]?.['token_sha256']).toBe(createHash('sha256').update(body.access_token).digest('hex'));
    expect(rows[0]?.['certificate_sha256']).toBe(h.tls.pipeDev.sha256);
    expect(rows[0]?.['prs_user_id']).toBe(USER_A.userId);
    // 원문 토큰은 어느 열에도 없다 (PSI-C01).
    expect(JSON.stringify(rows)).not.toContain(body.access_token);
  });
});

describe('PSI-A02 client 인증서 없음', () => {
  it('TLS 단계에서 끊긴다 — 유효한 assertion만으로 통과하지 못하고 앱에 닿지 않는다', async () => {
    const assertion = await h.signAssertion({ user: USER_A, contextId: 'ctx-a02-no-cert-0001' });
    await expect(h.exchange(assertion, { identity: null })).rejects.toThrow();
    // 앱에 닿지 않았으므로 jti가 소비되지 않았다 — 같은 assertion이 정상 client로는 통과한다.
    expect((await h.exchange(assertion)).status).toBe(200);
  });
});

describe('PSI-A03 신뢰하지 않는 CA·다른 client 인증서', () => {
  it('신뢰하지 않는 CA가 발급한 같은 SAN의 인증서는 TLS에서 끊긴다 (검증 끄기 fallback 없음)', async () => {
    await expect(h.exchange(await h.signAssertion({}), { identity: h.tls.rogue })).rejects.toThrow();
  });

  it('신뢰 CA가 발급했어도 등록되지 않은 인증서는 401 CLIENT_AUTH_FAILED다', async () => {
    const response = await h.exchange(await h.signAssertion({}), { identity: h.tls.unregistered });
    expect(response.status).toBe(401);
    expect(response.json<ErrorBody>().error).toEqual({ code: 'CLIENT_AUTH_FAILED', message: 'Client authentication failed.', retryable: false });
  });

  it('다른 등록 client(pipe-other)의 인증서로 pipe-dev assertion을 내면 client 불일치로 거절한다', async () => {
    const response = await h.exchange(await h.signAssertion({}), { identity: h.tls.pipeOther });
    expect(response.status).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('ASSERTION_INVALID');
  });
});

describe('PSI-A04 TLS 종료 metadata 위조', () => {
  const SPOOF = {
    'x-ssl-client-verify': 'SUCCESS',
    'x-ssl-client-s-dn': 'CN=pipe-dev',
    'x-client-cert': 'MIIB-fake',
    'x-forwarded-client-cert': 'By=spiffe://test/pipe-dev;URI=spiffe://test/pipe-dev',
  };

  it('등록되지 않은 인증서에 성공 헤더를 붙여도 401이다 — 헤더를 읽지 않는다', async () => {
    const response = await h.exchange(await h.signAssertion({}), { identity: h.tls.unregistered, headers: SPOOF });
    expect(response.status).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('CLIENT_AUTH_FAILED');
  });

  it('TLS가 아닌 경로(app.inject)는 위조 헤더가 무엇이든 CLIENT_AUTH_FAILED다', async () => {
    const replica = h.replicas[0];
    if (replica === undefined) throw new Error('복제본이 없다');
    const response = await replica.app.inject({
      method: 'POST',
      url: `${INTEGRATION_PREFIX}/auth/exchange`,
      headers: { ...SPOOF, 'content-type': 'application/json' },
      payload: { assertion: await h.signAssertion({}) },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('CLIENT_AUTH_FAILED');
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('공개 리스너에는 연동 경로가 없다 — 인증값을 알아도 404다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-a04-public-0001' });
    const response = await h.publicApp.inject({
      method: 'GET',
      url: `${INTEGRATION_PREFIX}/read/search?q=x`,
      headers: { authorization: `Bearer ${grant}`, ...SPOOF },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('PSI-A05~A09 대표 사례는 HTTP까지 같은 코드로 떨어진다', () => {
  it('서명 불량은 401 ASSERTION_INVALID이고 원인을 응답에 싣지 않는다', async () => {
    const [header, payload] = (await h.signAssertion({})).split('.');
    const response = await h.exchange(`${header ?? ''}.${payload ?? ''}.${Buffer.from('forged').toString('base64url')}`);
    expect(response.status).toBe(401);
    expect(response.json<ErrorBody>()).toMatchObject({ error: { code: 'ASSERTION_INVALID', message: 'The user assertion is not valid.', retryable: false } });
    expect(response.body).not.toMatch(/signature|kid|claim/i);
  });

  it('revoke_context 목적의 assertion으로는 발급하지 않는다', async () => {
    const response = await h.exchange(await h.signAssertion({ purpose: 'revoke_context' }));
    expect(response.json<ErrorBody>().error.code).toBe('ASSERTION_INVALID');
  });

  it('권한 주장 claim(roles)을 실으면 operator라도 거절한다', async () => {
    const response = await h.exchange(await h.signAssertion({ user: OPERATOR, overrides: { roles: ['operator'] } }));
    expect(response.json<ErrorBody>().error.code).toBe('ASSERTION_INVALID');
  });

  it('서버 시계 기준으로 만료된 assertion을 거절한다', async () => {
    const assertion = await h.signAssertion({});
    h.clockOffsetMs = 70_000;
    expect((await h.exchange(assertion)).json<ErrorBody>().error.code).toBe('ASSERTION_INVALID');
  });
});

describe('PSI-A08 입력 크기·모양은 저장소를 부르기 전에 막는다', () => {
  it('본문 16KiB 초과는 413 PAYLOAD_TOO_LARGE다', async () => {
    const before = await grantCount();
    const response = await h.post('/auth/exchange', JSON.stringify({ assertion: 'x'.repeat(20_000) }));
    expect(response.status).toBe(413);
    expect(response.json<ErrorBody>().error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await grantCount()).toBe(before);
  });

  it('모르는 필드가 있는 본문은 400 INVALID_REQUEST다', async () => {
    const response = await h.post('/auth/exchange', JSON.stringify({ assertion: await h.signAssertion({}), user_id: 'admin' }));
    expect(response.status).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('INVALID_REQUEST');
  });

  it('JSON이 아니면 415 UNSUPPORTED_MEDIA_TYPE이다', async () => {
    const response = await h.post('/auth/exchange', undefined, { headers: { 'content-type': 'text/plain' } });
    expect([400, 415]).toContain(response.status);
    const text = await h.post('/auth/exchange', 'assertion=x', { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(text.status).toBe(415);
    expect(text.json<ErrorBody>().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('발급 요청에 사용자 Authorization·Cookie를 실으면 거절한다 (계약 6.1)', async () => {
    const withAuth = await h.exchange(await h.signAssertion({}), { headers: { authorization: 'Bearer pipe-login-jwt' } });
    expect(withAuth.status).toBe(400);
    const withCookie = await h.exchange(await h.signAssertion({}), { headers: { cookie: '__Host-prs_session=abc' } });
    expect(withCookie.status).toBe(400);
    expect(withCookie.json<ErrorBody>().error.code).toBe('INVALID_REQUEST');
  });
});

describe('PSI-A10 jti 동시 재사용: 두 복제본', () => {
  it('같은 assertion을 두 복제본에 동시에 내면 한 요청만 발급된다', async () => {
    for (let round = 0; round < 6; round += 1) {
      const assertion = await h.signAssertion({ contextId: `ctx-a10-race-${String(round)}-0001` });
      const [first, second] = await Promise.all([
        h.exchange(assertion, { replica: 0 }),
        h.exchange(assertion, { replica: 1 }),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 401]);
      const loser = first.status === 401 ? first : second;
      expect(loser.json<ErrorBody>().error.code).toBe('ASSERTION_REPLAYED');
    }
  });

  it('순차 재사용도 ASSERTION_REPLAYED다', async () => {
    const assertion = await h.signAssertion({ contextId: 'ctx-a10-sequential-01' });
    expect((await h.exchange(assertion, { replica: 1 })).status).toBe(200);
    expect((await h.exchange(assertion, { replica: 0 })).json<ErrorBody>().error.code).toBe('ASSERTION_REPLAYED');
  });
});

describe('PSI-A11 재생 방지 저장소 장애', () => {
  it('503 AUTH_STORE_UNAVAILABLE이고 grant를 만들지 않는다 (fail closed)', async () => {
    h.faults.replayDown = true;
    const before = await grantCount();
    const response = await h.exchange(await h.signAssertion({ contextId: 'ctx-a11-replay-down-1' }));
    expect(response.status).toBe(503);
    expect(response.json<ErrorBody>().error).toMatchObject({ code: 'AUTH_STORE_UNAVAILABLE', retryable: true });
    expect(await grantCount()).toBe(before);
  });
});

describe('PSI-A12 다른 client·다른 환경의 key·cert·token', () => {
  it('pipe-other의 키로 pipe-dev를 주장하면 등록되지 않은 kid로 거절한다', async () => {
    const response = await h.exchange(await h.signAssertion({ kid: 'k-other-1', client: 'other', overrides: { iss: 'urn:test:pipe:dev', aud: 'urn:test:pr-search:pipe-integration:dev', client_id: 'pipe-dev' } }));
    expect(response.json<ErrorBody>().error.code).toBe('ASSERTION_INVALID');
  });

  it('binding이 없는 issuer의 사용자는 연결 필요로 거절한다 — 가짜 사용자를 만들지 않는다', async () => {
    const response = await h.exchange(await h.signAssertion({ client: 'other', user: OPERATOR }), { identity: h.tls.pipeOther });
    expect(response.status).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('IDENTITY_BINDING_REQUIRED');
  });

  it('pipe-other가 발급받은 grant를 pipe-dev 인증서로 쓰면 GRANT_BINDING_MISMATCH다', async () => {
    await bind(h.pool, USER_A, OTHER_ISSUER);
    const issued = await h.exchange(await h.signAssertion({ client: 'other', user: USER_A }), { identity: h.tls.pipeOther });
    expect(issued.status).toBe(200);
    const grant = issued.json<{ access_token: string }>().access_token;
    expect((await h.get('/context', grant, { identity: h.tls.pipeOther })).status).toBe(200);
    const crossed = await h.get('/context', grant, { identity: h.tls.pipeDev });
    expect(crossed.status).toBe(401);
    expect(crossed.json<ErrorBody>().error.code).toBe('GRANT_BINDING_MISMATCH');
  });
});
