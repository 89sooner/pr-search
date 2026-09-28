/**
 * 처리되지 않은 오류의 공통 처리 — 실제 공개 서버와 127.0.0.1의 실제 mTLS PIPE 리스너, PostgreSQL·Redis·
 * Elasticsearch (CR-129 / DEV-786).
 *
 * 조회 경로가 쓰는 Elasticsearch 클라이언트의 `search`·`msearch`만 고장 내고(하네스 `faults`), 나머지는 실제로
 * 흐른다. 보는 것은 셋이다.
 *
 * 1. 처리되지 않은 예외는 공개 경로에서 500 `INTERNAL_ERROR` 봉투와 `correlation_id`로 답하고, 같은 ID로 진단
 *    기록(경로 패턴·단계·오류 이름·종류·코드)을 남긴다. 응답과 기록 어디에도 검색어와 원인 문구가 없다.
 * 2. 경로가 이미 처리하던 응답(문법 400·인증 401·범위 확인 실패 503·추천 계산 실패의 200)은 그대로다.
 * 3. PIPE 연동도 같은 분류를 쓴다 — Elasticsearch 응답 오류의 `statusCode` 게터를 클라이언트 오류로 읽지 않는다.
 */

import { errors as esErrors } from '@elastic/elasticsearch';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BILLING, PAYMENTS, USER_A, startHarness, type Harness } from '../integrations/pipe/fixtures.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 검색어와 원인 문구에 들어가는 표지. 응답·로그 어디에도 나오면 안 된다. */
const QUERY_TEXT = 'cr129-outage-token';

let h: Harness;
let grantA: string;

beforeAll(async () => {
  h = await startHarness();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.faults.searchError = null;
  h.faults.msearchError = null;
  h.faults.scopeDown = false;
  h.clockOffsetMs = 0;
  h.scopes.set(USER_A.userId, [PAYMENTS, BILLING]);
  await h.resetScopeCache();
  h.publicLogs.length = 0;
  h.logs.length = 0;
  grantA = await h.grantFor(USER_A, { contextId: `ctx-cr129-${String(Date.now())}` });
});

/** Elasticsearch가 질의를 거절한 모양 — 서버가 잘못 조립한 질의다. `statusCode` 게터가 400을 돌려준다. */
function esQueryRejected(): Error {
  return new esErrors.ResponseError({
    statusCode: 400,
    body: { error: { type: 'search_phase_execution_exception', reason: `failed to create query: [${QUERY_TEXT}]` } },
    headers: {},
    warnings: null,
    meta: {},
  } as never);
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly retryable?: boolean };
  readonly correlation_id: string;
}

function unhandledLogs(): Record<string, unknown>[] {
  return h.publicLogs.filter((entry) => entry['event'] === 'http.unhandled_error');
}

describe('공개 서버 — 처리되지 않은 예외는 계약의 오류 봉투와 같은 ID의 진단 기록이다', () => {
  it('Elasticsearch 질의 거절(ResponseError 400)은 400이 아니라 500 INTERNAL_ERROR다', async () => {
    h.faults.searchError = esQueryRejected();
    const upstream = '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8';
    const response = await h.publicGet(`/api/v1/search?q=${encodeURIComponent(`author:${QUERY_TEXT}`)}`, USER_A, {
      'x-correlation-id': upstream,
    });

    expect(response.status).toBe(500);
    const body = response.json<ErrorBody>();
    expect(Object.keys(body).sort()).toEqual(['correlation_id', 'error']);
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.correlation_id).toMatch(UUID);
    expect(body.correlation_id).not.toBe(upstream);
    for (const leaked of [QUERY_TEXT, 'search_phase_execution_exception', 'ResponseError', 'statusCode', ' at ']) {
      expect(response.body).not.toContain(leaked);
    }

    const logged = unhandledLogs();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'error',
      correlation_id: body.correlation_id,
      upstream_correlation_id: upstream,
      method: 'GET',
      route: '/api/v1/search',
      stage: 'handler',
      status: 500,
      error_name: 'ResponseError',
      error_kind: 'elasticsearch',
      error_code: '400:search_phase_execution_exception',
    });
    expect(Array.isArray(logged[0]?.['frames'])).toBe(true);
    expect(JSON.stringify(h.publicLogs)).not.toContain(QUERY_TEXT);
  });

  it('Elasticsearch 연결 실패도 500 INTERNAL_ERROR이고 종류가 elasticsearch다', async () => {
    h.faults.searchError = new esErrors.ConnectionError(`connect ECONNREFUSED 10.0.0.9:9200 (${QUERY_TEXT})`);
    const response = await h.publicGet(`/api/v1/search?q=${encodeURIComponent(`author:${QUERY_TEXT}`)}`, USER_A);
    expect(response.status).toBe(500);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body).not.toContain('10.0.0.9');
    expect(unhandledLogs()).toEqual([
      expect.objectContaining({ correlation_id: body.correlation_id, error_name: 'ConnectionError', error_kind: 'elasticsearch' }),
    ]);
    expect(JSON.stringify(h.publicLogs)).not.toContain('10.0.0.9');
  });

  it('응용 코드의 일반 예외(TypeError)는 종류가 application이다', async () => {
    h.faults.searchError = new TypeError(`Cannot read properties of undefined (reading '${QUERY_TEXT}')`);
    const response = await h.publicGet(`/api/v1/search?q=${encodeURIComponent(`author:${QUERY_TEXT}`)}`, USER_A);
    expect(response.status).toBe(500);
    const body = response.json<ErrorBody>();
    expect(unhandledLogs()).toEqual([
      expect.objectContaining({ correlation_id: body.correlation_id, error_name: 'TypeError', error_kind: 'application' }),
    ]);
    expect(response.body).not.toContain(QUERY_TEXT);
    expect(JSON.stringify(h.publicLogs)).not.toContain(QUERY_TEXT);
  });

  it('0건 검색의 추천 계산 실패(msearch)는 CR-128대로 200과 relaxation_hints_incomplete다', async () => {
    h.faults.msearchError = new esErrors.ConnectionError('msearch down');
    const response = await h.publicGet(`/api/v1/search?q=${encodeURIComponent(`kind:pull_request author:${QUERY_TEXT}`)}`, USER_A);
    expect(response.status).toBe(200);
    const body = response.json<{ items: unknown[]; relaxation_hints_incomplete?: boolean }>();
    expect(body.items).toEqual([]);
    expect(body.relaxation_hints_incomplete).toBe(true);
    expect(unhandledLogs()).toHaveLength(0);
  });

  it('이미 처리하던 응답은 그대로다 — 문법 400, 세션 없음 401, 범위 확인 실패 503', async () => {
    const syntax = await h.publicGet(`/api/v1/search?q=${encodeURIComponent('nokey:value')}`, USER_A);
    expect(syntax.status).toBe(400);
    expect(syntax.json<ErrorBody>().error.code).toBe('QUERY_SYNTAX_ERROR');

    const anonymous = await h.publicGet('/api/v1/search?q=', null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.json<ErrorBody>().error.code).toBe('UNAUTHENTICATED');

    h.faults.scopeDown = true;
    await h.resetScopeCache();
    const scope = await h.publicGet('/api/v1/search?q=', USER_A);
    expect(scope.status).toBe(503);
    expect(scope.json<ErrorBody>().error.code).toBe('PERMISSION_UNAVAILABLE');

    expect(unhandledLogs()).toHaveLength(0);
  });

  it('없는 경로는 404 NOT_FOUND 봉투다', async () => {
    const response = await h.publicGet('/api/v1/no-such-route', USER_A);
    expect(response.status).toBe(404);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.correlation_id).toMatch(UUID);
  });

  it('본문을 읽지 못한 POST는 그 상태의 계약 봉투다 — 400·415·413', async () => {
    const cases: [string, string, number, string][] = [
      ['application/json', '{"anchors":', 400, 'INVALID_PARAMETER'],
      ['application/xml', '<anchors/>', 415, 'UNSUPPORTED_MEDIA_TYPE'],
      ['application/json', JSON.stringify({ blob: 'x'.repeat(1_100_000) }), 413, 'PAYLOAD_TOO_LARGE'],
    ];
    for (const [contentType, payload, status, code] of cases) {
      const response = await h.publicApp.inject({
        method: 'POST',
        url: '/api/v1/sequence-anchors/resolve',
        headers: { 'content-type': contentType },
        payload,
      });
      expect(response.statusCode).toBe(status);
      const body = response.json<ErrorBody>();
      expect(body.error.code).toBe(code);
      expect(body.correlation_id).toMatch(UUID);
    }
    expect(h.publicLogs.filter((entry) => entry['event'] === 'http.client_error').map((entry) => entry['status'])).toEqual([400, 415, 413]);
  });
});

describe('PIPE 연동 — 같은 분류를 쓴다', () => {
  it('Elasticsearch 질의 거절은 INVALID_REQUEST(400)가 아니라 INTERNAL_ERROR(500)이고 기록된다', async () => {
    h.faults.searchError = esQueryRejected();
    const response = await h.get(`/read/search?q=${encodeURIComponent(`author:${QUERY_TEXT}`)}`, grantA);
    expect(response.status).toBe(500);
    const body = JSON.parse(response.body) as ErrorBody;
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal error.', retryable: false });
    expect(response.body).not.toContain(QUERY_TEXT);
    const logged = h.logs.filter((entry) => entry['level'] === 'error' && String(entry['message']).includes('ResponseError'));
    expect(logged).toEqual([expect.objectContaining({ correlation_id: body.correlation_id })]);
    expect(JSON.stringify(h.logs)).not.toContain(QUERY_TEXT);
  });

  it('입력 오류는 여전히 원본의 400 본문 그대로다', async () => {
    const response = await h.get(`/read/search?q=${encodeURIComponent('nokey:value')}`, grantA);
    expect(response.status).toBe(400);
    expect((JSON.parse(response.body) as ErrorBody).error.code).toBe('QUERY_SYNTAX_ERROR');
  });
});
