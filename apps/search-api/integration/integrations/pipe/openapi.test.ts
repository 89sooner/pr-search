/**
 * PSI-F01 계약 연결 — 실제 mTLS로 받은 응답이 handoff OpenAPI 스키마에 맞는가 (CR-112).
 *
 * 단위 계약 시험(`src/integrations/pipe/contract.test.ts`)은 문서와 코드 상수를 대조한다. 이 시험은 그 문서가
 * **실제 응답**과도 맞는지 본다 — 127.0.0.1의 실제 TLS 핸드셰이크, PostgreSQL·Redis·Elasticsearch를 거친 본문을
 * OpenAPI의 해당 operation·상태 스키마로 검증하고, `captured: true` 예시는 같은 요청을 다시 보내 상태·봉투 모양·
 * 오류 코드가 같은지 대조한다. 사내 CA·운영 HAProxy·실제 GHE를 거친 검증이 아니다(TEST_RESULTS의 NOT_RUN).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INTEGRATION_OPERATIONS, INTEGRATION_PREFIX } from '../../../src/integrations/pipe/operations.js';
import { BILLING, OPERATOR, PAYMENTS, SHA, STRANGER, USER_A, USER_B, startHarness, type Harness, type TlsResponse } from './fixtures.js';

const HANDOFF = new URL('../../../../../handoff/pipe-search-integration/v1/', import.meta.url);
const readText = (name: string): string => readFileSync(fileURLToPath(new URL(name, HANDOFF)), 'utf8').replace(/\r\n/g, '\n');
const yaml = createRequire(import.meta.url)('js-yaml') as { load(input: string): unknown };

interface OpenApiResponse {
  readonly $ref?: string;
  readonly content?: Record<string, { readonly schema?: { readonly $ref?: string } }>;
}
interface OpenApiDocument {
  readonly paths: Record<string, Record<string, { readonly responses: Record<string, OpenApiResponse> }>>;
  readonly components: { readonly responses: Record<string, OpenApiResponse>; readonly schemas: Record<string, unknown> };
}
interface Example {
  readonly operation: string;
  readonly captured: boolean;
  readonly request: { readonly path: string };
  readonly response: { readonly status: number; readonly body: Record<string, unknown> };
}
interface OperationMap {
  readonly operations: readonly { readonly id: string; readonly integration_error_codes: readonly string[] }[];
}

const openapi = yaml.load(readText('pipe-integration-v1.openapi.yaml')) as OpenApiDocument;
const operationMap = JSON.parse(readText('operation-map.json')) as OperationMap;

const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
addFormats.default(ajv);
ajv.addKeyword('x-psi-errors');
ajv.addKeyword('components');
ajv.addSchema({ $id: 'psi', components: { schemas: openapi.components.schemas } });
const validators = new Map<string, ValidateFunction>();

function schemaNameFor(operationId: string, status: number): string {
  const operation = INTEGRATION_OPERATIONS.find((candidate) => candidate.id === operationId);
  if (operation === undefined) throw new Error(`알 수 없는 operation: ${operationId}`);
  const path = `${INTEGRATION_PREFIX}${operation.path.replace(/:([a-z_]+)/g, '{$1}')}`;
  const responses = openapi.paths[path]?.[operation.method.toLowerCase()]?.responses;
  const entry = responses?.[String(status)] ?? responses?.['default'];
  if (entry === undefined) throw new Error(`${operationId} ${String(status)} 응답 정의가 없다`);
  const response = entry.$ref === undefined ? entry : openapi.components.responses[entry.$ref.split('/').pop() ?? ''];
  const ref = response?.content?.['application/json']?.schema?.$ref;
  if (ref === undefined) throw new Error(`${operationId} ${String(status)} 스키마가 없다`);
  return ref.split('/').pop() ?? '';
}

/** 실제 응답 한 건을 그 operation·상태의 스키마로 검증한다. 어긋나면 무엇이 어긋났는지 보인다. */
function expectConforms(operationId: string, response: TlsResponse): Record<string, unknown> {
  const name = schemaNameFor(operationId, response.status);
  let validate = validators.get(name);
  if (validate === undefined) {
    validate = ajv.compile({ $ref: `psi#/components/schemas/${name}` });
    validators.set(name, validate);
  }
  const body = response.json<Record<string, unknown>>();
  validate(body);
  expect(validate.errors ?? [], `${operationId} ${String(response.status)} → ${name}: ${JSON.stringify(validate.errors?.slice(0, 3))}\n${response.body.slice(0, 500)}`).toEqual([]);
  expect(response.headers['cache-control']).toBe('private, no-store');
  return body;
}

/** 봉투 모양 — 최상위 키, 오류 객체의 키, 오류 코드. 값(상관 ID·시각·토큰)은 비교하지 않는다. */
function shapeOf(body: Record<string, unknown>): { keys: string[]; errorKeys: string[] | null; code: unknown } {
  const error = body['error'] as Record<string, unknown> | undefined;
  return {
    keys: Object.keys(body).sort(),
    errorKeys: error === undefined ? null : Object.keys(error).sort(),
    code: error?.['code'],
  };
}

let h: Harness;
let grant: string;

beforeAll(async () => {
  h = await startHarness();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.clockOffsetMs = 0;
  h.faults.scopeDown = false;
  h.scopes.set(USER_A.userId, [PAYMENTS, BILLING]);
  h.scopes.set(USER_B.userId, [BILLING]);
  h.scopes.set(OPERATOR.userId, [PAYMENTS]);
  await h.resetScopeCache();
  grant = await h.grantFor(USER_A, { contextId: `ctx-openapi-${String(Date.now())}` });
});

describe('PSI-F01 실제 응답이 OpenAPI 스키마에 맞는다', () => {
  it.each([
    ['read.repositories', '/read/repositories?limit=2'],
    ['read.repositories', '/read/repositories?limit=500'],
    ['read.search', '/read/search?q=&size=2&facets=true'],
    ['read.search', '/read/search?q=&sort=merged_at&order=asc&size=1'],
    ['read.search', '/read/search?q=nokey%3Avalue'],
    ['read.search', '/read/search?q=&cursor=not-a-cursor'],
    ['read.search', `/read/search?q=${encodeURIComponent('repo:"acme/payments" base:main seq:1..2')}&seq_epoch=2`],
    ['read.resolve', `/read/resolve?q=${SHA.slice(0, 7)}`],
    ['read.resolve', `/read/resolve?q=${encodeURIComponent('acme/payments#1')}`],
    ['read.resolve', '/read/resolve?q=abc12'],
    ['read.merge_numbers.resolve', '/read/merge-numbers/resolve?repository=acme/payments&base_branch=main&pr_number=1'],
    ['read.merge_numbers.resolve', '/read/merge-numbers/resolve?repository=acme/payments&base_branch=main'],
    ['read.pull_request', '/read/pull-requests/acme%2Fpayments/1'],
    ['read.pull_request', '/read/pull-requests/acme%2Fpayments/999'],
    ['read.commit', `/read/commits/acme%2Fpayments/${SHA}`],
    ['read.source.tree', '/read/source/acme%2Fpayments/tree'],
    ['read.source.tree', '/read/source/other%2Fsecret/tree'],
    ['read.source.history', '/read/source/acme%2Fpayments/history?path=README.md'],
    ['read.source.diff', `/read/source/acme%2Fpayments/diff?commit=${SHA}`],
    ['read.source.file', `/read/source/acme%2Fpayments/file?path=src%2Fpay%2Fretry.ts&revision=${SHA}`],
    ['read.source.file', `/read/source/acme%2Fpayments/file?path=..%2Fsecret&revision=${SHA}`],
    ['read.search', '/read/search?q=a&q=b'],
    ['read.search', '/read/search?q=&unknown=1'],
    ['read.pull_request', '/read/pull-requests/acme%252Fpayments/1'],
    ['context', '/context'],
  ] as const)('%s %s', async (operationId, path) => {
    expectConforms(operationId, await h.get(path, grant));
  });

  it('발급·회수·문맥 회수와 연동 고유 거절도 맞는다', async () => {
    expectConforms('auth.exchange', await h.exchange(await h.signAssertion({ user: USER_A, contextId: 'ctx-openapi-auth-0001' })));
    expectConforms('auth.exchange', await h.exchange(await h.signAssertion({ user: STRANGER, contextId: 'ctx-openapi-auth-0002' })));
    expectConforms('auth.exchange', await h.exchange('not-a-jws'));
    expectConforms('auth.revoke', await h.post('/auth/revoke', undefined, { headers: { authorization: `Bearer ${grant}` } }));
    expectConforms('auth.revoke', await h.post('/auth/revoke', undefined, { headers: { authorization: 'Bearer garbage' } }));
    expectConforms('read.search', await h.get('/read/search?q=', grant)); // 회수된 grant → 401 GRANT_REVOKED
    const assertion = await h.signAssertion({ user: USER_A, contextId: 'ctx-openapi-auth-0003', purpose: 'revoke_context' });
    expectConforms('auth.revoke_context', await h.post('/auth/revoke-context', JSON.stringify({ assertion })));
    expectConforms('context', await h.get('/context', null));
  });
});

describe('captured 예시가 실제 응답과 같은 모양이다', () => {
  const examples = readdirSync(fileURLToPath(new URL('examples/', HANDOFF)))
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readText(`examples/${name}`)) as Example] as const)
    .filter(([, example]) => example.captured);

  /** 예시마다 같은 조건을 다시 만든다. 조건이 없는 예시는 grant 하나로 경로를 부른다. */
  const scenarios: Record<string, () => Promise<TlsResponse>> = {
    'auth.exchange.200.json': async () => h.exchange(await h.signAssertion({ user: USER_A, contextId: 'ctx-openapi-ex-00001' })),
    'auth.exchange.403.identity-binding-required.json': async () =>
      h.exchange(await h.signAssertion({ user: STRANGER, contextId: 'ctx-openapi-ex-00002' })),
    'auth.revoke.200.json': () => h.post('/auth/revoke', undefined, { headers: { authorization: `Bearer ${grant}` } }),
    'auth.revoke_context.200.json': async () =>
      h.post('/auth/revoke-context', JSON.stringify({ assertion: await h.signAssertion({ user: USER_A, contextId: 'ctx-openapi-ex-00003', purpose: 'revoke_context' }) })),
    'read.repositories.503.permission-unavailable.json': async () => {
      await h.resetScopeCache();
      h.faults.scopeDown = true;
      return h.get('/read/repositories', grant);
    },
    'read.search.503.permission-unavailable.json': async () => {
      await h.resetScopeCache();
      h.faults.scopeDown = true;
      return h.get('/read/search?q=', grant);
    },
    'read.search.401.grant-expired.json': async () => {
      h.clockOffsetMs = 301_000;
      return h.get('/read/search?q=', grant);
    },
    'read.search.401.grant-revoked.json': async () => {
      await h.post('/auth/revoke', undefined, { headers: { authorization: `Bearer ${grant}` } });
      return h.get('/read/search?q=', grant);
    },
    'read.search.403.context-revoked.json': async () => {
      const contextGrant = await h.grantFor(USER_A, { contextId: 'ctx-openapi-ex-00004' });
      await h.post('/auth/revoke-context', JSON.stringify({ assertion: await h.signAssertion({ user: USER_A, contextId: 'ctx-openapi-ex-00004', purpose: 'revoke_context' }) }));
      return h.get('/read/search?q=', contextGrant);
    },
  };

  it('captured 예시가 있다', () => {
    expect(examples.length).toBeGreaterThanOrEqual(15);
  });

  it.each(examples)('%s', async (name, example) => {
    const scenario = scenarios[name] ?? (() => h.get(example.request.path.slice(INTEGRATION_PREFIX.length), grant));
    const live = await scenario();
    expect(live.status).toBe(example.response.status);
    const body = expectConforms(example.operation, live);
    expect(shapeOf(body)).toEqual(shapeOf(example.response.body));
  });
});

describe('PERMISSION_UNAVAILABLE의 봉투가 operation map의 기재와 같다', () => {
  const READS: readonly (readonly [string, string])[] = [
    ['read.repositories', '/read/repositories'],
    ['read.search', '/read/search?q='],
    ['read.resolve', `/read/resolve?q=${SHA.slice(0, 7)}`],
    ['read.merge_numbers.resolve', '/read/merge-numbers/resolve?repository=acme/payments&base_branch=main&pr_number=1'],
    ['read.pull_request', '/read/pull-requests/acme%2Fpayments/1'],
    ['read.commit', `/read/commits/acme%2Fpayments/${SHA}`],
    ['read.source.tree', '/read/source/acme%2Fpayments/tree'],
    ['read.source.history', '/read/source/acme%2Fpayments/history'],
    ['read.source.diff', `/read/source/acme%2Fpayments/diff?commit=${SHA}`],
    ['read.source.file', `/read/source/acme%2Fpayments/file?path=README.md&revision=${SHA}`],
  ];

  it('조회 10종 전부 — map에 코드가 있으면 연동 봉투(retryable), 없으면 원본 봉투', async () => {
    expect(READS.map(([id]) => id)).toEqual(
      INTEGRATION_OPERATIONS.filter((operation) => operation.id.startsWith('read.')).map((operation) => operation.id),
    );
    await h.resetScopeCache();
    h.faults.scopeDown = true;
    for (const [id, path] of READS) {
      const response = await h.get(path, grant);
      const body = expectConforms(id, response);
      const error = body['error'] as Record<string, unknown>;
      expect([id, response.status, error['code']]).toEqual([id, 503, 'PERMISSION_UNAVAILABLE']);
      const documented = operationMap.operations.find((operation) => operation.id === id);
      expect([id, 'retryable' in error]).toEqual([id, documented?.integration_error_codes.includes('PERMISSION_UNAVAILABLE')]);
    }
  });
});
