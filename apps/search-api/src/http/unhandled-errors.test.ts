import { errors as esErrors } from '@elastic/elasticsearch';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { GitHubApiError } from '@prs/github';
import {
  classifyError,
  frameworkClientError,
  stackFrames,
  unhandledErrorLog,
  upstreamCorrelationId,
  writeSafely,
  type UnhandledErrorLog,
} from './unhandled-errors.js';

/** 원인 문구·질의에 섞여 들어갔다고 가정하는 값. 진단 기록 어디에도 나오면 안 된다. */
const SECRET = 'ghp_s3cr3t-token';
const QUERY_TEXT = 'payments-outage-kim';

function esResponseError(status: number, type: unknown): InstanceType<typeof esErrors.ResponseError> {
  return new esErrors.ResponseError({
    statusCode: status,
    body: { error: { type, reason: `failed to parse [${QUERY_TEXT}] with ${SECRET}` } },
    headers: {},
    warnings: null,
    meta: {} as never,
  } as never);
}

function fakeRequest(overrides: Partial<Record<string, unknown>> = {}): FastifyRequest {
  return {
    method: 'GET',
    url: `/api/v1/search?q=${QUERY_TEXT}`,
    headers: {},
    routeOptions: { url: '/api/v1/search' },
    ...overrides,
  } as unknown as FastifyRequest;
}

describe('frameworkClientError — Fastify가 요청을 읽다 낸 오류만 클라이언트 오류다 (CR-129)', () => {
  it('FST_ 코드와 4xx 상태를 함께 가진 오류만 고른다', () => {
    expect(frameworkClientError({ code: 'FST_ERR_CTP_BODY_TOO_LARGE', statusCode: 413 })).toEqual({ code: 'FST_ERR_CTP_BODY_TOO_LARGE', status: 413 });
    expect(frameworkClientError({ code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE', statusCode: 415 })).toEqual({ code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE', status: 415 });
    expect(frameworkClientError({ code: 'FST_ERR_CTP_INVALID_JSON_BODY', statusCode: 400 })).toEqual({ code: 'FST_ERR_CTP_INVALID_JSON_BODY', status: 400 });
  });

  it('Elasticsearch ResponseError는 statusCode 게터가 400이어도 클라이언트 오류가 아니다', () => {
    const error = esResponseError(400, 'search_phase_execution_exception');
    expect(error.statusCode).toBe(400);
    expect(frameworkClientError(error)).toBeNull();
  });

  it('FST_ 코드가 없는 4xx 상태 속성, FST_ 코드의 5xx는 클라이언트 오류가 아니다', () => {
    expect(frameworkClientError({ statusCode: 400 })).toBeNull();
    expect(frameworkClientError(Object.assign(new Error('x'), { statusCode: 404 }))).toBeNull();
    expect(frameworkClientError({ code: 'FST_ERR_SOMETHING', statusCode: 500 })).toBeNull();
    expect(frameworkClientError(null)).toBeNull();
    expect(frameworkClientError('FST_ERR_CTP_BODY_TOO_LARGE')).toBeNull();
  });
});

describe('classifyError — 오류 종류와 허용 목록을 지난 코드', () => {
  it('Elasticsearch 응답 오류는 상태와 오류 유형만 코드로 싣는다', () => {
    expect(classifyError(esResponseError(400, 'search_phase_execution_exception'))).toEqual({
      name: 'ResponseError',
      kind: 'elasticsearch',
      code: '400:search_phase_execution_exception',
    });
  });

  it('Elasticsearch 오류 유형이 허용 형식이 아니면 상태만 싣는다', () => {
    expect(classifyError(esResponseError(500, `${QUERY_TEXT} with spaces`))).toEqual({ name: 'ResponseError', kind: 'elasticsearch', code: '500' });
  });

  it('Elasticsearch 연결·시간 초과 오류는 코드 없이 종류만', () => {
    expect(classifyError(new esErrors.ConnectionError('connect ECONNREFUSED 10.0.0.9:9200'))).toEqual({ name: 'ConnectionError', kind: 'elasticsearch' });
    expect(classifyError(new esErrors.TimeoutError('Request timed out'))).toEqual({ name: 'TimeoutError', kind: 'elasticsearch' });
  });

  it('PostgreSQL 서버 오류는 SQLSTATE만', () => {
    const error = Object.assign(new Error(`relation "secret_${SECRET}" does not exist`), { name: 'error', severity: 'ERROR', code: '42P01' });
    expect(classifyError(error)).toEqual({ name: 'error', kind: 'postgres', code: '42P01' });
  });

  it('Node 시스템 오류는 errno 코드만', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED', syscall: 'connect' });
    expect(classifyError(error)).toEqual({ name: 'Error', kind: 'network', code: 'ECONNREFUSED' });
  });

  it('Redis 응답 오류는 종류만', () => {
    const error = Object.assign(new Error(`WRONGTYPE ${SECRET}`), { name: 'ReplyError' });
    expect(classifyError(error)).toEqual({ name: 'ReplyError', kind: 'redis' });
  });

  it('GHE 오류는 분류와 상태만', () => {
    expect(classifyError(new GitHubApiError('server', `upstream said ${SECRET}`, { status: 502 }))).toEqual({
      name: 'GitHubApiError',
      kind: 'github',
      code: 'server:502',
    });
  });

  it('그 밖의 예외는 application이고 코드가 없다', () => {
    expect(classifyError(new TypeError(`cannot read ${SECRET}`))).toEqual({ name: 'TypeError', kind: 'application' });
    expect(classifyError('boom')).toEqual({ name: 'string', kind: 'application' });
    expect(classifyError(undefined)).toEqual({ name: 'undefined', kind: 'application' });
  });

  it('이상한 이름은 싣지 않는다', () => {
    const error = new Error('x');
    error.name = `${QUERY_TEXT} injected name`;
    expect(classifyError(error).name).toBe('Error');
  });
});

describe('stackFrames — 호출 위치 줄만, 문구는 싣지 않는다', () => {
  it('문구에 줄바꿈과 가짜 호출 위치가 있어도 머리를 통째로 떼어 낸다', () => {
    const error = new Error(`boom\n    at fake (${QUERY_TEXT}:1:1)\n${SECRET}`);
    const frames = stackFrames(error);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThanOrEqual(5);
    for (const frame of frames) expect(frame.startsWith('at ')).toBe(true);
    expect(JSON.stringify(frames)).not.toContain(QUERY_TEXT);
    expect(JSON.stringify(frames)).not.toContain(SECRET);
  });

  it('머리가 스택 앞과 맞지 않으면(생성 뒤 문구가 바뀌면) 아무것도 싣지 않는다', () => {
    const error = new Error('original');
    void error.stack;
    error.message = `changed ${SECRET}`;
    expect(stackFrames(error)).toEqual([]);
  });

  it('Error가 아니면 빈 목록', () => {
    expect(stackFrames({ stack: '    at x (y:1:1)' })).toEqual([]);
  });
});

describe('unhandledErrorLog — 진단 기록 한 줄', () => {
  it('경로 패턴·단계·종류·코드·호출 위치를 싣고, 요청 URL·질의·원인 문구는 싣지 않는다', () => {
    const entry = unhandledErrorLog(fakeRequest(), esResponseError(400, 'search_phase_execution_exception'), {
      correlationId: '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8',
      status: 500,
      client: false,
    });
    expect(entry).toMatchObject({
      level: 'error',
      event: 'http.unhandled_error',
      correlation_id: '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8',
      method: 'GET',
      route: '/api/v1/search',
      stage: 'request',
      status: 500,
      error_name: 'ResponseError',
      error_kind: 'elasticsearch',
      error_code: '400:search_phase_execution_exception',
    });
    expect(entry.frames?.length).toBeGreaterThan(0);
    const text = JSON.stringify(entry);
    expect(text).not.toContain(QUERY_TEXT);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('q=');
  });

  it('클라이언트 오류는 warn이고 호출 위치를 싣지 않는다', () => {
    const entry = unhandledErrorLog(fakeRequest({ method: 'POST' }), { code: 'FST_ERR_CTP_INVALID_JSON_BODY', statusCode: 400 }, {
      correlationId: '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8',
      status: 400,
      client: true,
    });
    expect(entry.level).toBe('warn');
    expect(entry.event).toBe('http.client_error');
    expect(entry.frames).toBeUndefined();
  });

  it('앞단 상관 ID는 UUID일 때만 참고값으로 싣는다', () => {
    const upstream = 'A1B2C3D4-0000-4000-8000-000000000001';
    const withUpstream = unhandledErrorLog(fakeRequest({ headers: { 'x-correlation-id': upstream } }), new Error('x'), {
      correlationId: '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8',
      status: 500,
      client: false,
    });
    expect(withUpstream.upstream_correlation_id).toBe(upstream.toLowerCase());
    const forged = unhandledErrorLog(fakeRequest({ headers: { 'x-correlation-id': `${SECRET}\nlevel=info` } }), new Error('x'), {
      correlationId: '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8',
      status: 500,
      client: false,
    });
    expect(forged.upstream_correlation_id).toBeUndefined();
    expect(upstreamCorrelationId(['a', 'b'])).toBeNull();
  });

  it('경로를 찾지 못한 요청은 route가 null이다', () => {
    const entry = unhandledErrorLog(fakeRequest({ routeOptions: {} }), new Error('x'), {
      correlationId: '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8',
      status: 500,
      client: false,
    });
    expect(entry.route).toBeNull();
  });
});

describe('writeSafely — 기록의 실패가 응답을 막지 않는다', () => {
  it('기록 함수나 한 줄 만들기가 던져도 삼킨다', () => {
    const throwingLog = (): void => {
      throw new Error('stdout closed');
    };
    expect(() => {
      writeSafely(throwingLog, () => ({}) as UnhandledErrorLog);
    }).not.toThrow();
    expect(() => {
      writeSafely(() => undefined, () => {
        throw new Error('classification failed');
      });
    }).not.toThrow();
    expect(() => {
      writeSafely(undefined, () => {
        throw new Error('never built');
      });
    }).not.toThrow();
  });
});
