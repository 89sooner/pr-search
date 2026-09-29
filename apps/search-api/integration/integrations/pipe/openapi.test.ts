/**
 * PSI-F01 계약 연결 — 실제 mTLS로 받은 응답이 handoff OpenAPI 스키마에 맞는가 (CR-112).
 *
 * 단위 계약 시험(`src/integrations/pipe/contract.test.ts`)은 문서와 코드 상수를 대조한다. 이 시험은 그 문서가
 * **실제 응답**과도 맞는지 본다 — 127.0.0.1의 실제 TLS 핸드셰이크, PostgreSQL·Redis·Elasticsearch를 거친 본문을
 * OpenAPI의 해당 operation·상태 스키마로 검증하고, `captured: true` 예시는 같은 요청을 다시 보내 상태·봉투 모양·
 * 오류 코드가 같은지 대조한다. 사내 CA·운영 HAProxy·실제 GHE를 거친 검증이 아니다(TEST_RESULTS의 NOT_RUN).
 *
 * 이 하네스는 source blame 기능 게이트가 **켜진** 배포다(CR-135) — 조회 11종을 모두 실제로 부르려는 것이다. 꺼진 배포(기본)는
 * `blame-disabled.test.ts`가 본다.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GitHubApiError, SourceBlameUnsupportedError } from '@prs/github';
import { INTEGRATION_OPERATIONS, INTEGRATION_PREFIX } from '../../../src/integrations/pipe/operations.js';
import {
  BILLING,
  BLAME_RANGES,
  OPERATOR,
  OTHER_ISSUER,
  PAYMENTS,
  SHA,
  STRANGER,
  USER_A,
  USER_B,
  bind,
  startHarness,
  type Harness,
  type TlsResponse,
} from './fixtures.js';

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
  h = await startHarness({ blameEnabled: true });
  // blame의 교집합 사례(CR-135): A가 `pipe-other`(허용 목록: payments)로도 발급받을 수 있게 한다.
  await bind(h.pool, USER_A, OTHER_ISSUER);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.clockOffsetMs = 0;
  h.faults.scopeDown = false;
  h.faults.blameError = null;
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
    // CR-128: `kind:`가 든 0건 — 완화 후보가 붙는 200. 전에는 500 INTERNAL_ERROR였다.
    ['read.search', `/read/search?q=${encodeURIComponent('kind:pull_request author:nobody')}&facets=true`],
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
    // CR-132: 새 파라미터를 보낸 응답도 엄격 스키마에 맞는다(선택 키·null 줄 수), 잘못 섞으면 원본 400 봉투다.
    ['read.source.tree', '/read/source/acme%2Fpayments/tree?offset=0'],
    ['read.source.file', `/read/source/acme%2Fpayments/file?path=src%2Fpay%2Fretry.ts&revision=${SHA}&offset=0`],
    ['read.source.diff', `/read/source/acme%2Fpayments/diff?listing=tree&head=${SHA}`],
    ['read.source.diff', `/read/source/acme%2Fpayments/diff?commit=${SHA}&related=all`],
    ['read.source.diff', `/read/source/acme%2Fpayments/diff?listing=tree&pr=1`],
    ['read.source.history', '/read/source/acme%2Fpayments/history?page=1001'],
    // CR-135: blame — 200(엄격 스키마), 원본 400(revision 없음), 범위 밖 404.
    ['read.source.blame', `/read/source/acme%2Fpayments/blame?path=src%2Fpay%2Fretry.ts&revision=${SHA}`],
    ['read.source.blame', '/read/source/acme%2Fpayments/blame?path=src%2Fpay%2Fretry.ts'],
    ['read.source.blame', `/read/source/other%2Fsecret/blame?path=README.md&revision=${SHA}`],
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
    // CR-135: 이 하네스는 blame이 켜져 있어 게이트를 지나 범위 확인에서 503이다(꺼진 배포는 범위를 보기 전에 404다).
    ['read.source.blame', `/read/source/acme%2Fpayments/blame?path=README.md&revision=${SHA}`],
  ];

  it('조회 11종 전부 — map에 코드가 있으면 연동 봉투(retryable), 없으면 원본 봉투', async () => {
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

describe('CR-135 blame이 켜진 배포 — 인증·범위·입력·GitHub 실패의 실제 응답 (CONTRACT_DIFF D-26)', () => {
  const PATH = `/read/source/acme%2Fpayments/blame?path=src%2Fpay%2Fretry.ts&revision=${SHA}`;

  it('CR-135 FR-INT-001 켜진 배포는 능력 목록에 source_blame:read, /context 조회 목록에 read.source.blame을 싣는다', async () => {
    const exchange = await h.exchange(await h.signAssertion({ user: USER_A, contextId: 'ctx-openapi-blame-001' }));
    expect(exchange.status).toBe(200);
    const issued = exchange.json<{ access_token: string; capabilities: string[] }>();
    expect(issued.capabilities).toEqual(['search:read', 'source:read', 'merge_number:read', 'source_blame:read']);
    const context = (await h.get('/context', issued.access_token)).json<{ capabilities: string[]; operations: string[] }>();
    expect(context.capabilities).toEqual(issued.capabilities);
    expect(context.operations).toEqual(
      INTEGRATION_OPERATIONS.filter((operation) => operation.id.startsWith('read.')).map((operation) => operation.id),
    );
    expect(context.operations).toContain('read.source.blame');
  });

  it('CR-135 FR-SRC-005 mTLS + grant의 200은 엄격 스키마에 맞고 GitHub 순서의 구간·귀속을 그대로 옮긴다 — grant가 없으면 GHE를 부르지 않는다', async () => {
    const before = h.sourceCalls.length;
    const denied = await h.get(PATH, null);
    expect([denied.status, denied.json<{ error: { code: string } }>().error.code]).toEqual([401, 'GRANT_INVALID']);
    expect(h.sourceCalls.length).toBe(before);

    const response = await h.get(PATH, grant);
    expect(response.status).toBe(200);
    expect(expectConforms('read.source.blame', response)).toEqual({
      repository: 'acme/payments',
      revision: SHA,
      path: 'src/pay/retry.ts',
      provider: 'github_graphql',
      ranges: BLAME_RANGES.map((range) => ({
        start_line: range.startLine,
        end_line: range.endLine,
        age: range.age,
        commit: {
          sha: range.commit.sha,
          message_headline: range.commit.messageHeadline,
          author_name: range.commit.authorName,
          author_login: range.commit.authorLogin,
          authored_at: range.commit.authoredAt,
          committed_at: range.commit.committedAt,
        },
      })),
    });
    // GitHub 호출은 blame 하나뿐이다 — 본문(file)을 함께 읽지 않는다.
    expect(h.sourceCalls.slice(before)).toEqual(['blame']);
  });

  it('CR-135 FR-SRC-005 범위 밖 저장소는 GHE를 부르기 전에 404다 — 사용자 범위 밖, client 허용 목록 밖(교집합)', async () => {
    const before = h.sourceCalls.length;
    // 사용자 범위 밖: `pipe-dev`의 허용 목록에는 other/secret이 있지만 A는 볼 수 없다.
    const outside = await h.get(`/read/source/other%2Fsecret/blame?path=README.md&revision=${SHA}`, grant);
    expect([outside.status, expectConforms('read.source.blame', outside)['error']]).toEqual([404, { code: 'NOT_FOUND', message: 'Repository not found.' }]);
    // 허용 목록 밖: A는 billing을 볼 수 있지만 `pipe-other`의 허용 목록은 payments뿐이다.
    const exchange = await h.exchange(
      await h.signAssertion({ user: USER_A, client: 'other', contextId: 'ctx-openapi-blame-002' }),
      { identity: h.tls.pipeOther },
    );
    expect(exchange.status).toBe(200);
    const otherGrant = exchange.json<{ access_token: string }>().access_token;
    const readOther = (path: string): Promise<TlsResponse> => h.get(path, otherGrant, { identity: h.tls.pipeOther });
    const narrowed = await readOther(`/read/source/acme%2Fbilling/blame?path=README.md&revision=${SHA}`);
    expect([narrowed.status, expectConforms('read.source.blame', narrowed)['error']]).toEqual([404, { code: 'NOT_FOUND', message: 'Repository not found.' }]);
    expect(h.sourceCalls.length).toBe(before);
    // 대조군: 교집합 안이면 GHE(대역 reader)를 부른다.
    expect((await readOther(PATH)).status).toBe(200);
    expect(h.sourceCalls.slice(before)).toEqual(['blame']);
  });

  it('CR-135 FR-INT-001 엄격한 query — 목록 밖 key(줄 범위·페이지)·중복 key는 400 INVALID_REQUEST이고 GHE를 부르지 않는다', async () => {
    const before = h.sourceCalls.length;
    for (const path of [`${PATH}&start_line=1`, `${PATH}&first=100`, `${PATH}&revision=${SHA}`]) {
      const response = await h.get(path, grant);
      expect([path, response.status]).toEqual([path, 400]);
      expect(expectConforms('read.source.blame', response)['error']).toEqual({ code: 'INVALID_REQUEST', message: 'The request is not valid.', retryable: false });
    }
    expect(h.sourceCalls.length).toBe(before);
  });

  it.each([
    ['GHES의 GraphQL에 Commit.blame이 없다', 501, 'SOURCE_BLAME_UNSUPPORTED', 'This GitHub Enterprise Server does not provide blame through its API.', () => new SourceBlameUnsupportedError()],
    ['GitHub GraphQL 한도', 429, 'SOURCE_RATE_LIMITED', 'GitHub is rate limited. Try again later.', () => new GitHubApiError('rate_limited', 'graphql rate limited', { retryAt: new Date(Date.now() + 30_000) })],
    ['GitHub App 권한 부족', 503, 'SOURCE_PERMISSION_REQUIRED', 'The configured GitHub App requires repository Contents read permission.', () => new GitHubApiError('auth', 'graphql forbidden', { status: 403 })],
    ['일부 결과·모르는 모양', 502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub. Please retry.', () => new GitHubApiError('server', 'graphql partial result')],
  ] as const)('CR-135 FR-SRC-005 %s → %d %s — 원본 봉투(retryable 없음)이고 스키마에 맞는다', async (_label, status, code, message, failure) => {
    h.faults.blameError = failure();
    const response = await h.get(PATH, grant);
    expect([response.status, expectConforms('read.source.blame', response)['error']]).toEqual([status, { code, message }]);
    if (status === 429) expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });
});
