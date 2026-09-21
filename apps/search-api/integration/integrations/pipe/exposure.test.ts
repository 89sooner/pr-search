/**
 * PSI-G 노출·비밀·감사 연결 — 실제 mTLS + PostgreSQL + Redis + Elasticsearch (CR-112).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_PREFIX } from '../../../src/integrations/pipe/operations.js';
import { CLIENT_DEV, USER_A, eventsFor, startHarness, type Harness } from './fixtures.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe('PSI-G01 public listener에서 private 접근', () => {
  it('공개 앱에는 연동 경로가 하나도 없고, 연동 앱에는 공개 경로가 하나도 없다', () => {
    expect(h.publicApp.printRoutes()).not.toContain('internal');
    const replica = h.replicas[0];
    if (replica === undefined) throw new Error('복제본이 없다');
    const routes = replica.app.printRoutes({ commonPrefix: false });
    expect(routes).not.toContain('api/v1');
    expect(routes).not.toContain('healthz');
    expect(routes).toContain('read/search');
  });
});

describe('PSI-G03 로그·응답·이벤트에 비밀이 없다', () => {
  it('assertion·grant 원문이 로그·이벤트·오류 본문 어디에도 없다', async () => {
    const assertion = await h.signAssertion({ user: USER_A, contextId: 'ctx-g03-secrets-00001' });
    const issued = await h.exchange(assertion);
    const grant = issued.json<{ access_token: string }>().access_token;
    const replayed = await h.exchange(assertion);
    const tampered = await h.get('/read/search?q=x', `${grant.slice(0, -2)}AA`);
    const forged = await h.exchange(`${assertion.slice(0, -4)}AAAA`);
    await h.get('/read/search?q=secret-query-text', grant);
    await h.post('/auth/revoke', undefined, { headers: { authorization: `Bearer ${grant}` } });

    for (const body of [replayed.body, tampered.body, forged.body]) {
      expect(body).not.toContain(assertion.slice(0, 40));
      expect(body).not.toContain(grant);
    }
    const logs = JSON.stringify(h.logs);
    expect(logs).not.toContain(grant);
    expect(logs).not.toContain(assertion.slice(20, 80));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { rows } = await h.pool.query<Record<string, unknown>>('SELECT * FROM pipe_integration_event');
    const events = JSON.stringify(rows);
    expect(events).not.toContain(grant);
    expect(events).not.toContain(assertion.slice(20, 80));
    // 검색어 전문은 연동 이벤트에 싣지 않는다 (조회 감사는 기존 기록기가 그대로 남긴다).
    expect(events).not.toContain('secret-query-text');
  });
});

describe('PSI-G04 감사 연결', () => {
  it('조회 감사는 canonical 사용자로, 행위 주체는 같은 correlation ID의 연동 이벤트로 남는다', async () => {
    const upstream = randomUUID();
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-g04-audit-000001' });
    const response = await h.get('/read/search?q=%EA%B2%B0%EC%A0%9C', grant, { headers: { 'x-correlation-id': upstream } });
    expect(response.status).toBe(200);
    const correlationId = response.json<{ correlation_id: string }>().correlation_id;
    expect(response.headers['x-correlation-id']).toBe(correlationId);
    expect(correlationId).not.toBe(upstream);

    const audit = await h.pool.query<{ user_id: string; action: string; query: string }>(
      'SELECT user_id, action, query FROM audit_record WHERE correlation_id = $1',
      [correlationId],
    );
    expect(audit.rows).toEqual([{ user_id: USER_A.userId, action: 'search.execute', query: '결제' }]);

    const [event] = await eventsFor(h.pool, correlationId);
    expect(event).toMatchObject({
      event_type: 'read',
      result_code: 'ok',
      http_status: 200,
      client_id: CLIENT_DEV,
      prs_user_id: USER_A.userId,
      operation: 'read.search',
      upstream_correlation_id: upstream,
      binding_version: 1,
      client_policy_version: 1,
    });
    expect(event?.['grant_id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('UUID가 아닌 X-Correlation-Id는 기록 식별자로 쓰지 않는다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-g04-audit-000002' });
    const response = await h.get('/read/repositories', grant, { headers: { 'x-correlation-id': 'DROP TABLE; <script>' } });
    const [event] = await eventsFor(h.pool, response.json<{ correlation_id: string }>().correlation_id);
    expect(event?.['upstream_correlation_id']).toBeNull();
  });

  it('발급·거절·회수 이벤트는 조회 결과 없이도 추적된다', async () => {
    const issued = await h.exchange(await h.signAssertion({ user: USER_A, contextId: 'ctx-g04-trace-000001' }));
    const issueEvent = (await eventsFor(h.pool, issued.json<{ correlation_id: string }>().correlation_id))[0];
    expect(issueEvent).toMatchObject({ event_type: 'grant.issue', result_code: 'ok', prs_user_id: USER_A.userId, subject: USER_A.subject });

    const rejected = await h.get('/read/search?q=', `psig1_${'Z'.repeat(43)}`);
    const rejectEvent = (await eventsFor(h.pool, rejected.json<{ correlation_id: string }>().correlation_id))[0];
    expect(rejectEvent).toMatchObject({ event_type: 'read.reject', result_code: 'GRANT_INVALID', http_status: 401, operation: 'read.search' });
    expect(rejectEvent?.['detail']).toEqual({ reason: 'unknown_token' });

    const revoked = await h.post('/auth/revoke-context', JSON.stringify({ assertion: await h.signAssertion({ user: USER_A, contextId: 'ctx-g04-trace-000001', purpose: 'revoke_context' }) }));
    const revokeEvent = (await eventsFor(h.pool, revoked.json<{ correlation_id: string }>().correlation_id))[0];
    expect(revokeEvent).toMatchObject({ event_type: 'context.revoke', auth_context_id: 'ctx-g04-trace-000001' });
  });

  it('연동 이벤트 표는 애플리케이션 롤에 추가 전용이다', async () => {
    const privilege = async (action: string): Promise<boolean> => {
      const { rows } = await h.pool.query<{ granted: boolean }>("SELECT has_table_privilege('prs_app', 'pipe_integration_event', $1) AS granted", [action]);
      return rows[0]?.granted === true;
    };
    expect(await privilege('INSERT')).toBe(true);
    expect(await privilege('UPDATE')).toBe(false);
    expect(await privilege('DELETE')).toBe(false);
  });
});

describe('응답 머리글', () => {
  it('모든 연동 응답(오류·404 포함)이 no-store이고 Set-Cookie가 없다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-headers-00000001' });
    for (const response of [
      await h.get('/context', grant),
      await h.get('/read/nowhere', grant),
      await h.get('/read/search?q=a&q=b', grant),
      await h.get('/context', null),
    ]) {
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('연동 경로 prefix 이름만으로 보호하지 않는다 — TLS가 없으면 404가 아니라 401이다', async () => {
    const replica = h.replicas[0];
    if (replica === undefined) throw new Error('복제본이 없다');
    const response = await replica.app.inject({ method: 'GET', url: `${INTEGRATION_PREFIX}/read/nowhere` });
    expect(response.statusCode).toBe(401);
  });
});
