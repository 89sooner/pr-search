/**
 * API-ADM-004의 **운영 도달성** (WP-035 DoD / CR-045).
 *
 * WP-028은 함수도 라우트 등록 코드도 통합 시험도 다 있는 채로 **배포된
 * search-api에 경로가 아예 없었다** (CR-034, DEV-177). 목을 꽂아 서버를 세우는
 * 시험은 "라우트가 존재한다"를 증명하지 "운영이 그것을 세운다"를 증명하지 않는다.
 *
 * 그래서 `index.ts`가 부르는 **`buildServerDeps`를 그대로 불러** 서버를 세운다.
 * `runtime.ts`에서 `reindex: buildReindexDeps(...)` 한 줄을 지우거나 `server.ts`의
 * 전달을 지우면 여기서 404가 난다.
 *
 * 인증 없이 부른다 — **401이면 라우트가 있다는 뜻이고 404면 없다는 뜻이다.**
 */

import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { buildServerDeps } from '../../src/runtime.js';
import { REINDEX_PATH } from '../../src/ops/routes.js';

type RuntimeParts = Parameters<typeof buildServerDeps>[0];

const CONFIG = {
  port: 0,
  adminTokens: [],
  auth: { enabled: true, cookieSecure: false, loginPath: '/auth/login', groupRoleMap: new Map() },
  gheBaseUrl: null,
  metricsQueryUrl: null,
} as unknown as RuntimeParts['config'];

function parts(): RuntimeParts {
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
    /*
     * `searchDeps`가 있어야 `buildServerDeps`가 `auth`를 싣고, `auth`가 있어야
     * `server.ts`가 관리 경로를 등록한다 — 인증 수단 없이 `/admin/*`를 열지
     * 않는다는 규율(CR-012, DEV-025) 때문이다. 여기서 그 조립을 그대로 재현하지
     * 않으면 이 시험은 재색인 라우트가 아니라 **그 규율**에 걸린다.
     */
    searchDeps: {
      es: {} as unknown as RuntimeParts['es'],
      resolveNames: () => Promise.resolve({ orgIds: new Map(), teamIds: new Map() }),
    },
  };
}

describe('운영 조립이 재색인 경로를 실제로 세운다 (WP-035 / API-ADM-004)', () => {
  it('**API-ADM-004가 선다** — 운영 조립에서 `reindex` 의존을 지우면 404가 된다', async () => {
    const app = buildServer(buildServerDeps(parts()));
    const response = await app.inject({
      method: 'POST',
      url: REINDEX_PATH,
      payload: { alias: 'prs-pull-requests' },
    });

    expect(response.statusCode, '404면 운영 배선이 빠진 것이다').not.toBe(404);
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('**GHE 자격 증명 없이도 선다** — 재색인은 색인 이름만 있으면 된다', () => {
    /*
     * API-ADM-007은 커밋 그래프가 있어야 서므로 GHE 자격 증명이 없으면 경로를
     * 달지 않는다. 재색인은 그 축과 무관하다 — 대상 버전을 정하는 데 필요한 것은
     * 별칭이 가리키는 인덱스와 실재하는 버전 목록뿐이다. 둘을 같은 조건으로
     * 묶으면 GHE가 없는 배포에서 재색인까지 함께 사라진다.
     */
    const deps = buildServerDeps(parts());
    expect(deps.integrity, 'GHE 없이 정합성 점검이 섰다').toBeUndefined();
    expect(deps.reindex, 'GHE 자격 증명 부재가 재색인까지 끌고 내려갔다').toBeDefined();
  });
});
