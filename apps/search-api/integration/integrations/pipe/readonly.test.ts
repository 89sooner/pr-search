/**
 * PSI-D 인가·읽기 전용 경계 — 실제 mTLS + PostgreSQL + Redis + Elasticsearch (CR-112).
 *
 * `pipe-dev`의 허용 목록은 세 저장소 전부, `pipe-other`는 `acme/payments` 하나다. 교집합 시험은
 * `pipe-other` 인증서와 그 issuer의 binding으로 한다.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authRepo } from '@prs/db';
import {
  BILLING,
  HIDDEN,
  OPERATOR,
  OTHER_ISSUER,
  PAYMENTS,
  SHA,
  USER_A,
  USER_B,
  bind,
  startHarness,
  type Harness,
  type UserFixture,
} from './fixtures.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
  await bind(h.pool, USER_A, OTHER_ISSUER);
  await bind(h.pool, USER_B, OTHER_ISSUER);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.faults.scopeDown = false;
  h.clockOffsetMs = 0;
  h.scopes.set(USER_A.userId, [PAYMENTS, BILLING]);
  h.scopes.set(USER_B.userId, [BILLING]);
  h.scopes.set(OPERATOR.userId, [PAYMENTS, BILLING, HIDDEN]);
  h.orgScopes.clear();
  await h.resetScopeCache();
});

interface SearchBody {
  readonly total: { value: number };
  readonly items: { repository: string | null }[];
  readonly facets?: Record<string, { value: string }[]>;
}

interface ErrorBody {
  readonly error: { readonly code: string };
}

async function otherGrant(user: UserFixture, suffix: string): Promise<string> {
  const response = await h.exchange(await h.signAssertion({ user, client: 'other', contextId: `ctx-d-other-${suffix}-0001` }), { identity: h.tls.pipeOther });
  if (response.status !== 200) throw new Error(`발급 실패 ${String(response.status)} ${response.body}`);
  return response.json<{ access_token: string }>().access_token;
}

const readOther = (path: string, grant: string) => h.get(path, grant, { identity: h.tls.pipeOther });
const repositoriesOf = (body: SearchBody): string[] => [...new Set(body.items.map((item) => item.repository ?? ''))].sort();

describe('PSI-D01 사용자 A/B 접근 저장소 차이', () => {
  it('각 사용자 권한에 맞는 결과다 — client 공용 권한으로 조회하지 않는다', async () => {
    const a = await h.get('/read/search?q=&size=50', await h.grantFor(USER_A, { contextId: 'ctx-d01-a-000000001' }));
    const b = await h.get('/read/search?q=&size=50', await h.grantFor(USER_B, { contextId: 'ctx-d01-b-000000001' }));
    expect(repositoriesOf(a.json<SearchBody>())).toEqual(['acme/billing', 'acme/payments']);
    expect(repositoriesOf(b.json<SearchBody>())).toEqual(['acme/billing']);
  });
});

describe('PSI-D02 operator 사용자의 Integration grant', () => {
  it.each([
    ['GET', '/admin/dead-letters'],
    ['GET', '/admin/jobs'],
    ['GET', '/read/audit-records'],
    ['GET', '/read/bisect-sessions'],
    ['POST', '/read/bisect-sessions'],
    ['GET', '/read/sequence-ranges?repository=acme/payments&base_branch=main&from=0&to=1'],
    ['GET', '/read/gh/executions'],
    ['GET', '/read/exports'],
    ['POST', '/read/repository-registration-requests'],
    ['GET', '/read/../admin/jobs'],
  ])('%s %s 는 없다 (404) — 역할과 무관하게 조회 allowlist만 열린다', async (method, path) => {
    const grant = await h.grantFor(OPERATOR, { contextId: 'ctx-d02-operator-0001' });
    const response = method === 'GET' ? await h.get(path, grant) : await h.post(path, '{}', { headers: { authorization: `Bearer ${grant}` } });
    expect(response.status).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('operator grant의 검색도 그 사용자 범위 ∩ 허용 목록이다 — 관리자 우회가 없다', async () => {
    const grant = await otherGrantFor(OPERATOR);
    const body = (await readOther('/read/search?q=&size=50', grant)).json<SearchBody>();
    expect(repositoriesOf(body)).toEqual(['acme/payments']);
  });

  async function otherGrantFor(user: UserFixture): Promise<string> {
    await bind(h.pool, user, OTHER_ISSUER).catch(() => undefined);
    return otherGrant(user, 'operator');
  }
});

describe('PSI-D03 명시되지 않은 method·경로', () => {
  it.each([
    ['HEAD', '/read/search?q=x'],
    ['OPTIONS', '/read/search'],
    ['POST', '/read/search'],
    ['PUT', '/read/search'],
    ['DELETE', '/context'],
    ['GET', '/auth/exchange'],
    ['GET', '/read'],
    ['GET', '/read/'],
    ['GET', '/read/search/extra'],
    ['GET', '/read/source/acme%2Fpayments/blame'],
  ])('%s %s 는 404 — prefix proxy·HEAD fallback이 없다', async (method, path) => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-d03-methods-0001' });
    const response = await h.get(path, grant, { method });
    expect(response.status).toBe(404);
  });
});

describe('PSI-D04 client 허용 목록과 사용자 권한의 교집합', () => {
  it('explicit 표현: 사용자가 볼 수 있어도 허용 목록 밖은 조회 전에 빠진다', async () => {
    const grant = await otherGrant(USER_A, 'explicit');
    const body = (await readOther('/read/search?q=&size=50', grant)).json<SearchBody>();
    expect(repositoriesOf(body)).toEqual(['acme/payments']);
    // 질의로 넓히지 못한다. 이 질의 언어의 OR는 둘이다 — 같은 키의 반복(값끼리 OR)과 여러 단어 텍스트(단어끼리 OR).
    for (const q of [
      'repo:"acme/billing"',
      'billing',
      '청구서',
      'label:billing',
      'repo:"acme/billing" repo:"acme/payments"',
      'billing payments',
    ]) {
      const narrowed = (await readOther(`/read/search?q=${encodeURIComponent(q)}&size=50`, grant)).json<SearchBody>();
      expect(narrowed.items.filter((item) => item.repository !== 'acme/payments')).toEqual([]);
    }
  });

  it('org_team 표현(500개 초과): 조직 조건 밖 저장소는 허용 목록에 있어도 보이지 않는다', async () => {
    // 사용자 범위: 등록 저장소 셋 + 가짜 498개 → org_team 표현. 조직 1만 구성원이라 other/secret(조직 2)은 일반 경로에서도 안 보인다.
    h.scopes.set(OPERATOR.userId, [PAYMENTS, BILLING, HIDDEN, ...Array.from({ length: 498 }, (_, i) => 20_000 + i)]);
    h.orgScopes.set(OPERATOR.userId, { orgIds: [1], visibilities: ['public', 'internal'] });
    const publicBody = (await h.publicGet('/api/v1/search?q=&size=50', OPERATOR)).json<SearchBody>();
    expect(repositoriesOf(publicBody)).toEqual(['acme/billing', 'acme/payments']);
    const grant = await h.grantFor(OPERATOR, { contextId: 'ctx-d04-orgteam-00001' });
    const body = (await h.get('/read/search?q=&size=50', grant)).json<SearchBody>();
    // pipe-dev 허용 목록에 other/secret이 있어도 일반 경로보다 넓어지지 않는다.
    expect(repositoriesOf(body)).toEqual(['acme/billing', 'acme/payments']);
  });
});

describe('PSI-D05 count·facet·resolver의 비공개 누출', () => {
  it('허용 범위 밖 자료가 total·facets·candidates에 나타나지 않는다', async () => {
    const grant = await otherGrant(USER_A, 'facets');
    const body = (await readOther('/read/search?q=&size=50&facets=true', grant)).json<SearchBody>();
    // acme/payments의 PR 둘과 커밋 하나다. billing·secret 문서는 total에도 들어가지 않는다.
    expect(body.total.value).toBe(3);
    expect(repositoriesOf(body)).toEqual(['acme/payments']);
    const facetValues = JSON.stringify(body.facets ?? {});
    expect(facetValues).not.toContain('billing');
    expect(facetValues).not.toContain('secret');

    const byPr = (await readOther('/read/resolve?q=' + encodeURIComponent('acme/billing#3'), grant)).json<{ candidates: unknown[] }>();
    expect(byPr.candidates).toEqual([]);
    const bySha = (await readOther(`/read/resolve?q=${SHA.slice(0, 7)}`, grant)).json<{ candidates: { repository: string }[] }>();
    expect(bySha.candidates.every((candidate) => candidate.repository === 'acme/payments')).toBe(true);
    const detail = await readOther('/read/pull-requests/acme%2Fbilling/3', grant);
    expect(detail.status).toBe(404);
  });
});

describe('PSI-D06 source는 범위 확인 전에 GHE를 부르지 않는다', () => {
  it.each(['tree', 'history', 'file?path=README.md&revision=' + SHA, 'diff?pr=3'])('범위 밖 %s → 404, source reader 호출 0회', async (operation) => {
    const grant = await otherGrant(USER_A, `source-${operation.slice(0, 4)}`);
    const before = h.sourceCalls.length;
    const response = await readOther(`/read/source/acme%2Fbilling/${operation}`, grant);
    expect(response.status).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
    expect(h.sourceCalls.length).toBe(before);
  });

  it('범위 안이면 source reader가 불린다 (대조군)', async () => {
    const grant = await otherGrant(USER_A, 'source-in');
    const before = h.sourceCalls.length;
    expect((await readOther('/read/source/acme%2Fpayments/tree', grant)).status).toBe(200);
    expect(h.sourceCalls.length).toBeGreaterThan(before);
  });
});

describe('PSI-D07 M resolver 권한·코드·에폭 검사 순서', () => {
  it('권한 밖 저장소는 코드를 비교하기 전에 404다 — 400(코드 판정)이 존재를 알리지 않는다', async () => {
    const grant = await otherGrant(USER_A, 'mnum');
    // 형식은 맞는 M 번호다 (코드는 저장소 이름의 숫자 — 두 저장소 이름에는 숫자가 없다).
    const outside = await readOther('/read/merge-numbers/resolve?repository=acme/billing&base_branch=main&merge_number=M-7-1&seq_epoch=1', grant);
    expect([outside.status, outside.json<ErrorBody>().error.code]).toEqual([404, 'NOT_FOUND']);
    const inside = await readOther('/read/merge-numbers/resolve?repository=acme/payments&base_branch=main&merge_number=M-7-1&seq_epoch=1', grant);
    expect(inside.status).toBe(400);
    expect(inside.json<{ error: { detail: { reason: string } } }>().error.detail.reason).toBe('repository_code_unavailable');
  });

  it('형식이 틀린 M 번호는 저장소와 무관하게 400이다 (구조 검사가 먼저다)', async () => {
    const grant = await otherGrant(USER_A, 'mnum-format');
    const response = await readOther('/read/merge-numbers/resolve?repository=acme/billing&base_branch=main&merge_number=M-ZZZ-1&seq_epoch=1', grant);
    expect(response.status).toBe(400);
  });
});

describe('PSI-D08 fresh 권한 캐시의 정상 사용', () => {
  it('매 요청 인가하되 5분 캐시 안에서는 GHE를 다시 부르지 않는다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-d08-cache-000001' });
    const before = h.scopeFetches.filter((id) => id === USER_A.userId).length;
    for (let i = 0; i < 3; i += 1) expect((await h.get('/read/search?q=&size=5', grant)).status).toBe(200);
    expect(h.scopeFetches.filter((id) => id === USER_A.userId).length).toBe(before);
  });
});

describe('PSI-D09 만료 scope 캐시 + GHE 실패', () => {
  it('503 PERMISSION_UNAVAILABLE이다 — 옛 범위도 빈 결과도 내지 않는다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-d09-scope-down-01' });
    await h.resetScopeCache();
    h.faults.scopeDown = true;
    for (const path of ['/read/search?q=', '/read/repositories', '/read/resolve?q=aaaaaaa', '/read/source/acme%2Fpayments/tree', '/read/merge-numbers/resolve?repository=acme/payments&base_branch=main&pr_number=1']) {
      const response = await h.get(path, grant);
      expect([path, response.status, response.json<ErrorBody>().error.code]).toEqual([path, 503, 'PERMISSION_UNAVAILABLE']);
    }
    const exchange = await h.exchange(await h.signAssertion({ contextId: 'ctx-d09-scope-down-02' }));
    expect([exchange.status, exchange.json<ErrorBody>().error.code]).toEqual([503, 'PERMISSION_UNAVAILABLE']);
  });
});

describe('PSI-D10 권한 무효화와 반영 지연', () => {
  it('무효화(버전 울타리 + Redis 삭제) 뒤 판정되는 요청은 회수된 저장소를 보지 않는다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-d10-invalidate-01' });
    expect(repositoriesOf((await h.get('/read/search?q=&size=50', grant)).json<SearchBody>())).toContain('acme/billing');
    // GHE에서 billing 권한이 회수됐고, 웹훅 경로가 정본을 무효화한다 (기존 invalidateUsers + Redis forget).
    h.scopes.set(USER_A.userId, [PAYMENTS]);
    await authRepo.invalidateUsers(h.pool, [USER_A.userId]);
    await h.resetScopeCache();
    expect(repositoriesOf((await h.get('/read/search?q=&size=50', grant)).json<SearchBody>())).toEqual(['acme/payments']);
  });

  it('무효화가 없으면 캐시 TTL(5분) 동안 옛 범위가 남는다 — 의도된 bounded freshness다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-d10-ttl-00000001' });
    expect(repositoriesOf((await h.get('/read/search?q=&size=50', grant)).json<SearchBody>())).toContain('acme/billing');
    h.scopes.set(USER_A.userId, [PAYMENTS]);
    // 캐시가 살아 있는 동안은 기존 계약대로 옛 범위다 (일반 경로도 같다).
    expect(repositoriesOf((await h.get('/read/search?q=&size=50', grant)).json<SearchBody>())).toContain('acme/billing');
    expect(repositoriesOf((await h.publicGet('/api/v1/search?q=&size=50', USER_A)).json<SearchBody>())).toContain('acme/billing');
  });
});
