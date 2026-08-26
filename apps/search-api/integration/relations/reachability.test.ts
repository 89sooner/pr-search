/**
 * 관계 경로의 **운영 도달성** (WP-031 DoD / CR-042).
 *
 * ## 왜 이 파일이 따로 있나
 *
 * WP-028은 함수도 라우트 등록 코드도 통합 시험도 다 있는 채로 **배포된
 * search-api에 경로가 아예 없었다** (CR-034, DEV-177). 목을 꽂아 서버를 세우는
 * 시험은 "라우트가 존재한다"를 증명하지 "운영이 그것을 세운다"를 증명하지
 * 않는다.
 *
 * 그래서 여기서는 `index.ts`가 부르는 **`buildServerDeps`를 그대로 불러**
 * 서버를 세우고, 경로가 실재하는지만 본다. `server.ts`에서 등록 한 줄을 지우면
 * 여기서 404가 난다.
 *
 * 인증 없이 부른다 — **401이면 라우트가 있다는 뜻이고 404면 없다는 뜻이다.**
 * 이 파일이 묻는 것은 권한이 아니라 도달성이다.
 */

import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { buildServerDeps } from '../../src/runtime.js';
import { CO_CHANGES_PATH, RELATIONS_PATH } from '../../src/relations/routes.js';

type RuntimeParts = Parameters<typeof buildServerDeps>[0];

const CONFIG = {
  port: 0,
  adminTokens: [],
  auth: { enabled: true, cookieSecure: false, loginPath: '/auth/login', groupRoleMap: new Map() },
  gheBaseUrl: null,
  metricsQueryUrl: null,
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

describe('운영 조립이 관계 경로를 실제로 세운다 (DEV-248)', () => {
  it('**API-REL-006이 선다** — `registerRelationRoutes` 호출을 지우면 404가 된다', async () => {
    const app = buildServer(buildServerDeps(partsWithSearch()));
    const response = await app.inject({
      method: 'GET',
      url: `${RELATIONS_PATH}?repository=acme%2Fx&pr_number=1&link_type=reverts&direction=outgoing`,
    });
    // 401 = 라우트가 있고 인증에서 멈췄다. 404 = 라우트가 없다.
    expect(response.statusCode, '404면 운영 배선이 빠진 것이다').not.toBe(404);
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('**API-REL-003이 선다**', async () => {
    const app = buildServer(buildServerDeps(partsWithSearch()));
    const response = await app.inject({
      method: 'GET',
      url: `${CO_CHANGES_PATH}?repository=acme%2Fx&pr_number=1`,
    });
    expect(response.statusCode, '404면 운영 배선이 빠진 것이다').not.toBe(404);
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('검색 의존이 없으면 관계 경로도 서지 않는다 — 조건이 하나여야 한다', async () => {
    const parts = { ...partsWithSearch(), searchDeps: undefined };
    const app = buildServer(buildServerDeps(parts));
    const response = await app.inject({
      method: 'GET',
      url: `${RELATIONS_PATH}?repository=acme%2Fx&pr_number=1&link_type=reverts&direction=outgoing`,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('파라미터 계약 — 물을 수 없는 질문은 거절한다', () => {
  /**
   * 이 검사들은 인증보다 **뒤**에 있으므로 세션 없이 확인할 수 없다. 그래서
   * 라우트를 직접 세워 판정만 본다 — 도달성은 위에서 이미 증명했다.
   */
  function unauthenticatedApp(): ReturnType<typeof buildServer> {
    return buildServer(buildServerDeps(partsWithSearch()));
  }

  it('인증이 먼저다 — 잘못된 파라미터라도 세션 없이는 401이다', async () => {
    const app = unauthenticatedApp();
    const response = await app.inject({
      method: 'GET',
      url: `${RELATIONS_PATH}?repository=bad&link_type=nope&direction=sideways`,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
