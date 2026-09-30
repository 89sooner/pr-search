/**
 * CONTRACT_DIFF D-26 — source blame이 꺼진 배포(기본) — 실제 mTLS + PostgreSQL + Redis + Elasticsearch (CR-135).
 *
 * `SOURCE_BLAME_ENABLED`는 기본이 꺼짐이다. 꺼진 배포의 exchange·`/context`는 CR-135 전과 같아야 한다 — 능력 목록에
 * `source_blame:read`가 없고 조회 목록에 `read.source.blame`이 없다. 이것이 operation을 하나 더하고도 `protocol_version`을
 * PSI-1.0으로 두는 근거다(API 계약 8장 안정성 규칙의 예외, D-26). 그래서 기대값을 코드(`INTEGRATION_OPERATIONS`)에서
 * 도출하지 않고 CR-135 전의 값을 그대로 적는다 — 도출하면 필터가 틀릴 때 기대값도 같이 틀린다.
 *
 * 경로는 늘 등록된다. 부르면 원본 봉투의 404 `NOT_FOUND`(`detail.reason = feature_disabled`)이고 GHE를 부르지 않는다.
 * 게이트는 grant·엄격한 query 검사 뒤, 저장소 형식·접근 범위·파라미터 검사 앞이다. 이 하네스는 M 번호가 켜진 배포다
 * (하네스 기본값). blame이 켜진 배포는 `openapi.test.ts`·`parity.test.ts`가 본다.
 *
 * CR-137(2026-10-01)부터 조회 목록에는 게이트 없는 경로 목록 `read.source.paths`가 늘 있다 — 그래서 조회 목록의
 * 기대값은 「CR-135 전의 10종 + `read.source.paths`」다(API 계약 8장의 두 번째 예외, D-27). 능력 목록은 그대로
 * CR-135 전과 같다.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BILLING, PAYMENTS, SHA, USER_A, startHarness, type Harness, type TlsResponse } from './fixtures.js';

/** CR-135 전 exchange·`/context`의 능력 목록 (M 번호가 켜진 배포). */
const CAPABILITIES_BEFORE_CR135 = ['search:read', 'source:read', 'merge_number:read'];
/** CR-135 전 `/context`의 조회 목록 — 10종, 이 순서다. */
const OPERATIONS_BEFORE_CR135 = [
  'read.repositories',
  'read.search',
  'read.resolve',
  'read.merge_numbers.resolve',
  'read.pull_request',
  'read.commit',
  'read.source.tree',
  'read.source.history',
  'read.source.diff',
  'read.source.file',
];
/** CR-137 뒤 기본 배포(blame 꺼짐)의 `/context` 조회 목록 — CR-135 전의 10종 뒤에 경로 목록이 붙는다(게이트 없음, D-27). */
const OPERATIONS_DEFAULT_AFTER_CR137 = [...OPERATIONS_BEFORE_CR135, 'read.source.paths'];

const BLAME = `/read/source/acme%2Fpayments/blame?path=src%2Fpay%2Fretry.ts&revision=${SHA}`;
const DISABLED = { code: 'NOT_FOUND', message: 'Blame is not enabled on this deployment.', detail: { reason: 'feature_disabled' } };

// 응답 본문을 handoff OpenAPI의 `ReadSourceError`(연동 봉투 | 원본 봉투의 oneOf)로 검증한다 — openapi.test.ts와 같은 방식.
const HANDOFF = new URL('../../../../../handoff/pipe-search-integration/v1/', import.meta.url);
const yaml = createRequire(import.meta.url)('js-yaml') as { load(input: string): unknown };
const openapi = yaml.load(readFileSync(fileURLToPath(new URL('pipe-integration-v1.openapi.yaml', HANDOFF)), 'utf8')) as {
  components: { schemas: Record<string, unknown> };
};
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
addFormats.default(ajv);
ajv.addKeyword('x-psi-errors');
ajv.addKeyword('components');
ajv.addSchema({ $id: 'psi', components: { schemas: openapi.components.schemas } });
const validateReadSourceError = ajv.compile({ $ref: 'psi#/components/schemas/ReadSourceError' });

interface ErrorBody {
  readonly error: Record<string, unknown>;
  readonly correlation_id: string;
}

function expectDisabled(response: TlsResponse): void {
  expect([response.status, response.json<ErrorBody>().error]).toEqual([404, DISABLED]);
  const body = response.json<ErrorBody>();
  validateReadSourceError(body);
  expect(validateReadSourceError.errors ?? [], JSON.stringify(validateReadSourceError.errors?.slice(0, 3))).toEqual([]);
  // 원본 봉투다 — 연동 봉투의 `retryable`이 없다.
  expect('retryable' in body.error).toBe(false);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.headers['x-correlation-id']).toBe(body.correlation_id);
}

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.faults.scopeDown = false;
  h.scopes.set(USER_A.userId, [PAYMENTS, BILLING]);
  await h.resetScopeCache();
});

describe('D-26 blame이 꺼진 배포(기본) — PSI-1.0 호환', () => {
  it('CR-135 FR-INT-001 발급과 /context의 능력 목록은 CR-135 전과 같고, 조회 목록은 그 10종에 CR-137의 경로 목록만 더해진다 — blame이 둘 다에서 빠진다', async () => {
    const exchange = await h.exchange(await h.signAssertion({ user: USER_A, contextId: 'ctx-blame-off-000001' }));
    expect(exchange.status).toBe(200);
    const issued = exchange.json<{ protocol_version: string; access_token: string; capabilities: string[] }>();
    expect(issued.protocol_version).toBe('PSI-1.0');
    expect(issued.capabilities).toEqual(CAPABILITIES_BEFORE_CR135);

    const context = (await h.get('/context', issued.access_token)).json<{ protocol_version: string; capabilities: string[]; operations: string[] }>();
    expect(context.protocol_version).toBe('PSI-1.0');
    expect(context.capabilities).toEqual(CAPABILITIES_BEFORE_CR135);
    expect(context.operations).toEqual(OPERATIONS_DEFAULT_AFTER_CR137);
    expect(context.operations).not.toContain('read.source.blame');
  });

  it('CR-135 FR-SRC-005 blame을 불러도 원본 봉투의 404 feature_disabled이고 GHE를 부르지 않는다 — 공개 경로와 본문이 같다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-blame-off-000002' });
    const before = h.sourceCalls.length;
    const response = await h.get(BLAME, grant);
    expectDisabled(response);
    expect(h.sourceCalls.length).toBe(before);

    // 공개 경로(API-SRC-006)도 같은 게이트다 — 연동은 같은 실행 함수를 부른다(FR-INT-001 AC-5).
    const publicResponse = await h.publicGet(`/api/v1/source/acme%2Fpayments/blame?path=src%2Fpay%2Fretry.ts&revision=${SHA}`, USER_A);
    expect(publicResponse.status).toBe(404);
    // 다른 것은 요청마다 새로 만드는 상관 ID뿐이다.
    expect({ ...response.json<ErrorBody>(), correlation_id: null }).toEqual({ ...publicResponse.json<ErrorBody>(), correlation_id: null });
    expect(h.sourceCalls.length).toBe(before);
  });

  it('CR-135 FR-SRC-005 게이트는 접근 범위·저장소 확인·파라미터보다 먼저다 — 범위 밖·미등록·파라미터 오류·범위 장애도 같은 404', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-blame-off-000003' });
    const before = h.sourceCalls.length;
    for (const path of [
      `/read/source/other%2Fsecret/blame?path=README.md&revision=${SHA}`, // 사용자 범위 밖
      `/read/source/nobody%2Fnothing/blame?path=README.md&revision=${SHA}`, // 등록되지 않은 저장소
      '/read/source/acme%2Fpayments/blame', // path·revision 없음
      '/read/source/acme%2Fpayments/blame?path=README.md&revision=main', // 40자 SHA가 아님
      `/read/source/acme%2Fpayments/blame?path=..%2Fsecret&revision=${SHA}`, // 경로 규칙 위반
    ]) {
      const response = await h.get(path, grant);
      expect([path, response.status]).toEqual([path, 404]);
      expectDisabled(response);
    }
    // 범위 확인이 실패하는 동안에도 게이트가 먼저 답한다 — 다른 source 조회는 503이다(대조군).
    await h.resetScopeCache();
    h.faults.scopeDown = true;
    expectDisabled(await h.get(BLAME, grant));
    const tree = await h.get('/read/source/acme%2Fpayments/tree', grant);
    expect([tree.status, tree.json<ErrorBody>().error['code']]).toEqual([503, 'PERMISSION_UNAVAILABLE']);
    expect(h.sourceCalls.length).toBe(before);
  });

  it('CR-135 FR-INT-001 엄격한 query 검사는 게이트보다 먼저다 — 목록 밖 key·중복 key는 400 INVALID_REQUEST(연동 봉투)', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-blame-off-000004' });
    const before = h.sourceCalls.length;
    for (const path of [`${BLAME}&start_line=1`, `${BLAME}&path=README.md`]) {
      const response = await h.get(path, grant);
      expect([path, response.status]).toEqual([path, 400]);
      expect(response.json<ErrorBody>().error).toEqual({ code: 'INVALID_REQUEST', message: 'The request is not valid.', retryable: false });
    }
    expect(h.sourceCalls.length).toBe(before);
  });
});
