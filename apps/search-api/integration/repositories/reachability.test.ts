/**
 * 저장소 진단 경로의 **운영 도달성** (WP-034 DoD / CR-050).
 *
 * ## 왜 이 파일이 따로 있나
 *
 * WP-028은 함수도 라우트 등록 코드도 통합 시험도 다 있는 채로 **배포된
 * search-api에 경로가 아예 없었다** (CR-034, DEV-177). 목을 꽂아 서버를 세우는
 * 시험은 "라우트가 존재한다"를 증명하지 "운영이 그것을 세운다"를 증명하지 않는다.
 *
 * 그래서 여기서는 `index.ts`가 부르는 **`buildServerDeps`를 그대로 불러** 서버를
 * 세우고, 경로가 실재하는지만 본다. `runtime.ts`에서 의존을 빼거나 `server.ts`에서
 * 등록 한 줄을 지우면 여기서 404가 난다.
 *
 * 인증 없이 부른다 — **401이면 라우트가 있다는 뜻이고 404면 없다는 뜻이다.**
 * 이 파일이 묻는 것은 권한이 아니라 도달성이다.
 *
 * 실행: `pnpm test:integration repositories/reachability`
 */

import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { buildServerDeps, runtimeCapabilities } from '../../src/runtime.js';
import { REGISTRATION_REQUESTS_PATH, REPOSITORIES_PATH } from '../../src/repositories/routes.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

type RuntimeParts = Parameters<typeof buildServerDeps>[0];

const CONFIG = {
  port: 0,
  adminTokens: [],
  auth: { enabled: true, cookieSecure: false, loginPath: '/auth/login', groupRoleMap: new Map() },
  gheBaseUrl: null,
  metricsQueryUrl: null,
  searchCursorKey: TEST_CURSOR_KEY,
} as unknown as RuntimeParts['config'];

function partsWithSearch(): RuntimeParts {
  return {
    config: CONFIG,
    pool: {} as unknown as RuntimeParts['pool'],
    bus: {} as unknown as RuntimeParts['bus'],
    es: {} as unknown as RuntimeParts['es'],
    log: () => undefined,
    auth: {
      sessions: { read: () => Promise.resolve(null) },
      scopes: {},
      forget: () => Promise.resolve(),
    } as unknown as RuntimeParts['auth'],
    searchDeps: {
      es: {} as unknown as RuntimeParts['es'],
      resolveNames: () => Promise.resolve({ orgIds: new Map(), teamIds: new Map() }),
    },
  };
}

/** 세션 없이 세운 운영 조립 — `auth`가 빠지면 이 경로가 서지 않아야 한다. */
function partsWithoutAuth(): RuntimeParts {
  const parts = partsWithSearch();
  return { ...parts, auth: undefined, searchDeps: undefined } as RuntimeParts;
}

describe('운영 조립이 저장소 진단 경로를 실제로 세운다 (DEV-350)', () => {
  it('**API-ING-002가 선다** — `registerRepositoryRoutes` 호출을 지우면 404가 된다', async () => {
    const app = buildServer(buildServerDeps(partsWithSearch()));
    const response = await app.inject({ method: 'GET', url: REPOSITORIES_PATH });
    expect(response.statusCode, '404면 운영 배선이 빠진 것이다').not.toBe(404);
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('**API-ING-003이 선다**', async () => {
    const app = buildServer(buildServerDeps(partsWithSearch()));
    const response = await app.inject({
      method: 'POST',
      url: REGISTRATION_REQUESTS_PATH,
      headers: { 'content-type': 'application/json' },
      payload: { repository: 'acme/x' },
    });
    expect(response.statusCode, '404면 운영 배선이 빠진 것이다').not.toBe(404);
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('**`runtime.ts`가 의존을 실제로 넘긴다** — 조립에서 빠지면 여기서 드러난다', () => {
    const deps = buildServerDeps(partsWithSearch());
    expect(deps.repositories).toBeDefined();
    // 서명자가 빠지면 커서가 조용히 사라지고 그 실패는 "결과가 이게 전부"로 보인다.
    expect(deps.repositories?.cursorSigner).toBeDefined();
    // 문서 수 집계에 필요하다.
    expect(deps.repositories?.es).toBeDefined();
  });

  it('**세션이 없으면 이 경로를 세우지 않는다** — 관리자 토큰 대체 경로가 없다', () => {
    const deps = buildServerDeps(partsWithoutAuth());
    expect(deps.repositories).toBeUndefined();
  });

  it('세션 없는 조립으로 세운 서버에서는 404다 — 조용히 열려 있지 않다', async () => {
    const app = buildServer(buildServerDeps(partsWithoutAuth()));
    const response = await app.inject({ method: 'GET', url: REPOSITORIES_PATH });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('**가용성이 사실을 말한다** — 없는 것을 있다고 하지 않는다', () => {
    expect(runtimeCapabilities(partsWithSearch())['repository_overview']).toBe(true);
    expect(runtimeCapabilities(partsWithoutAuth())['repository_overview']).toBe(false);
  });

  it('**`/admin` 아래가 아니다** — 관리 경로의 권한과 섞이지 않는다 (DEV-350)', () => {
    expect(REPOSITORIES_PATH).not.toContain('/admin');
    expect(REGISTRATION_REQUESTS_PATH).not.toContain('/admin');
  });
});
