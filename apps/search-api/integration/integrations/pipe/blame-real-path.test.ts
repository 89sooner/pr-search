/**
 * CR-135 / FR-SRC-005·FR-INT-001 — PIPE가 blame을 **실제 경로로** 받는다.
 *
 * 127.0.0.1의 실제 mTLS 리스너 → grant 판정 → 접근 범위(사용자 ∩ client 허용 목록) → search-api의 blame 조회 →
 * **실제 `GitHubTransport`**(설치 토큰 발급 → GraphQL POST) → GHE 대역의 `POST /api/graphql`. PostgreSQL·Redis·
 * Elasticsearch도 실제다. 다른 PIPE 시험 파일은 source 리더를 대역(Proxy)으로 두므로, GraphQL 주소 배선과
 * 「범위 밖이면 GHE를 부르지 않는다」·실패의 구분(501·503·429·502)은 이 파일이 GraphQL 호출 수와 함께 건다.
 */

import { GitHubSourceReader, GitHubTransport, InstallationTokenProvider, RequestScheduler, TokenPool } from '@prs/github';
import type { SourceBlame } from '@prs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTestKeyPair, startMockGhe, type MockGhe, type MockGraphqlOptions } from '../../../../../packages/github/testing/mock-ghe.js';
import { buildMockSource, mockBlame } from '../../../../../packages/github/testing/mock-source.js';
import { BILLING, PAYMENTS, USER_A, USER_B, startHarness, type Harness } from './fixtures.js';

const keys = generateTestKeyPair();
const PATH = 'src/pay/retry.ts';
/** 하네스의 등록 저장소 `acme/payments`와 같은 이름의 대역 이력. 두 번째 커밋의 작성자는 GHE 계정이 없다. */
const SOURCE = buildMockSource({
  owner: 'acme',
  repo: 'payments',
  commits: [
    { message: 'init: 결제 재시도\n\n본문은 제목에 싣지 않는다', author: 'alice', changes: { [PATH]: 'a\nb\nc\n' } },
    { message: 'fix: b를 고친다', author: 'bob', login: null, changes: { [PATH]: 'a\nB\nc\n' } },
  ],
});
const HEAD = SOURCE.commitShas[1] ?? '';
const blamePath = (query: Record<string, string>) => `/read/source/acme%2Fpayments/blame?${new URLSearchParams(query)}`;

/** 대역이 계산한 blame을 응답 모양으로 — 대역의 계산과 서비스·PIPE의 옮김이 한 글자씩 같은지 본다. */
function expected(revision: string): SourceBlame {
  const result = mockBlame(SOURCE, revision, PATH);
  if (result.kind !== 'ok') throw new Error(`대역 blame이 계산되지 않았다: ${result.kind}`);
  return {
    repository: 'acme/payments', revision: result.oid, path: PATH, provider: 'github_graphql',
    ranges: result.ranges.map((range) => ({
      start_line: range.startingLine, end_line: range.endingLine, age: range.age,
      commit: { sha: range.commit.sha, message_headline: range.commit.message.split('\n')[0] ?? '', author_name: range.commit.author, author_login: range.commit.login, authored_at: range.commit.date, committed_at: range.commit.date },
    })),
  };
}

/** 실제 전송 — 운영(`index.ts`)과 같이 REST 루트와 GHES 모양의 GraphQL 끝점을 함께 준다. */
function readerOf(mock: MockGhe): GitHubSourceReader {
  const provider = new InstallationTokenProvider({ apiUrl: mock.apiUrl, appId: '13599', privateKey: keys.privateKey, refreshLeadMs: 60_000, requestTimeoutMs: 5_000 });
  const tokens = new TokenPool(provider, { installations: [{ org: 'acme', installationId: 13_599 }], quarantineThreshold: 0.1 });
  return new GitHubSourceReader(new GitHubTransport({ apiUrl: mock.apiUrl, graphqlUrl: mock.graphqlUrl, requestTimeoutMs: 5_000, pool: tokens, scheduler: new RequestScheduler({ maxConcurrent: 8 }) }));
}

let h: Harness;
let ghe: MockGhe;
/** 하네스가 요청마다 부르는 리더. 실패 흉내는 GHE 대역을 따로 세워 이 값만 바꾼다. */
let reader: GitHubSourceReader;
const mocks: MockGhe[] = [];

async function withMock(graphql: MockGraphqlOptions, run: (mock: MockGhe) => Promise<void>): Promise<void> {
  const mock = await startMockGhe({ source: { repositories: [SOURCE] }, graphql });
  mocks.push(mock);
  const previous = reader;
  reader = readerOf(mock);
  try {
    await run(mock);
  } finally {
    reader = previous;
  }
}

beforeAll(async () => {
  ghe = await startMockGhe({ source: { repositories: [SOURCE] } });
  mocks.push(ghe);
  reader = readerOf(ghe);
  h = await startHarness({ blameEnabled: true, sourceReader: () => reader });
  h.scopes.set(USER_A.userId, [PAYMENTS, BILLING]);
  h.scopes.set(USER_B.userId, [BILLING]);
  await h.resetScopeCache();
}, 180_000);

afterAll(async () => {
  await h?.close();
  for (const mock of mocks) await mock.close();
});

describe('CR-135 PIPE read.source.blame — 실제 mTLS → 실제 전송 → GHE 대역 /api/graphql', () => {
  it('CR-135 FR-SRC-005 FR-INT-001 grant를 가진 PIPE 요청이 고정 revision의 blame을 받는다 — 대역의 계산과 같고, 서버 소유 고정 query 한 번뿐이다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-blame-real-0001' });
    const before = ghe.graphqlRequests.length;
    const response = await h.get(blamePath({ path: PATH, revision: HEAD }), grant);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const body = response.json<SourceBlame>();
    expect(body).toEqual(expected(HEAD));
    // 계정 없는 작성자의 login은 지어내지 않는다.
    expect(body.ranges.find((range) => range.commit.author_name === 'bob')?.commit.author_login).toBeNull();
    expect(ghe.graphqlRequests.slice(before)).toEqual([{ fixedQuery: true, variables: { owner: 'acme', name: 'payments', revision: HEAD, path: PATH } }]);
  });

  it('CR-135 FR-INT-001 사용자 범위 밖 저장소는 등록되지 않은 저장소와 같은 404이고 GraphQL을 부르지 않는다', async () => {
    const grant = await h.grantFor(USER_B, { contextId: 'ctx-blame-real-0002' });
    const before = ghe.graphqlRequests.length;
    const response = await h.get(blamePath({ path: PATH, revision: HEAD }), grant);
    expect(response.status).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
    expect(ghe.graphqlRequests.length).toBe(before);
  });

  it('CR-135 FR-SRC-005 blame이 없는 GHES는 501 SOURCE_BLAME_UNSUPPORTED, 한도는 429와 Retry-After다 — 추정 결과를 blame처럼 주지 않는다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-blame-real-0003' });
    await withMock({ blame: 'unsupported' }, async (mock) => {
      const response = await h.get(blamePath({ path: PATH, revision: HEAD }), grant);
      expect(response.status).toBe(501);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('SOURCE_BLAME_UNSUPPORTED');
      expect(mock.graphqlRequests).toHaveLength(1);
    });
    await withMock({ failure: 'secondary_429' }, async () => {
      const response = await h.get(blamePath({ path: PATH, revision: HEAD }), grant);
      expect(response.status).toBe(429);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('SOURCE_RATE_LIMITED');
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  it('CR-135 FR-SRC-005 권한 부족은 503 SOURCE_PERMISSION_REQUIRED, 일부 결과는 502 SOURCE_UNAVAILABLE이다 — 사내 미지원·권한 부족·일시 장애를 가른다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-blame-real-0004' });
    await withMock({ failure: 'forbidden' }, async () => {
      const response = await h.get(blamePath({ path: PATH, revision: HEAD }), grant);
      expect(response.status).toBe(503);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('SOURCE_PERMISSION_REQUIRED');
    });
    // errors와 data가 함께 온 응답 — 일부 구간을 blame으로 내지 않는다.
    await withMock({ failure: 'partial' }, async () => {
      const response = await h.get(blamePath({ path: PATH, revision: HEAD }), grant);
      expect(response.status).toBe(502);
      const body = response.json<{ error: { code: string }; ranges?: unknown }>();
      expect(body.error.code).toBe('SOURCE_UNAVAILABLE');
      expect(body.ranges).toBeUndefined();
    });
  });
});
