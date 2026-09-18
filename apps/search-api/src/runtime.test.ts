/**
 * 운영 조립 (CR-034, DEV-177).
 *
 * ## 이 파일이 막는 것
 *
 * WP-028은 API-ADM-007의 함수도, 라우트 등록 코드도, 통합 시험도 갖고 있었다.
 * 전부 초록이었고 **배포된 search-api에는 두 경로가 없었다** — 운영 조립이 그
 * 의존을 넘기지 않았기 때문이다. 목을 꽂아 라우트를 세우는 시험은 "라우트가
 * 존재한다"를 증명하지만 **"운영이 그것을 세운다"는 증명하지 않는다.**
 *
 * 그래서 여기서는 `index.ts`가 부르는 **바로 그 함수**를 부른다.
 */

import { describe, expect, it } from 'vitest';
import type { Pool } from '@prs/db';
import type { EventBus } from '@prs/bus';
import type { Client } from '@elastic/elasticsearch';
import type { GitHubClient } from '@prs/github';
import { buildGhDeps, buildIntegrityDeps, buildServerDeps, runtimeCapabilities, type RuntimeParts } from './runtime.js';
import type { SearchApiConfig } from './config.js';
import { resolveGhOpsConfig } from './gh/config.js';

const CONFIG = {
  port: 0,
  adminTokens: [{ name: 'tester', token: 't' }],
  metricsQueryUrl: null,
  gheBaseUrl: null,
  auth: { enabled: false, cookieSecure: false, loginPath: '/auth/login', groupRoleMap: new Map() },
} as unknown as SearchApiConfig;

function parts(overrides: Partial<RuntimeParts> = {}): RuntimeParts {
  return {
    config: CONFIG,
    pool: {} as unknown as Pool,
    bus: {} as unknown as EventBus,
    es: {} as unknown as Client,
    log: () => undefined,
    ...overrides,
  };
}

const GITHUB = { client: {} as unknown as GitHubClient };

describe('buildIntegrityDeps', () => {
  it('**GHE가 있으면 정합성 점검 의존을 만든다**', () => {
    const deps = buildIntegrityDeps({} as unknown as Pool, GITHUB);
    expect(deps).toBeDefined();
    expect(typeof deps?.graphFor).toBe('function');
  });

  it('GHE가 없으면 만들지 않는다 — 그래프 없이 "점검했다"고 답하지 않는다', () => {
    expect(buildIntegrityDeps({} as unknown as Pool, undefined)).toBeUndefined();
  });

  it('미러 볼륨을 요구하지 않는다 — API 그래프만으로 선다', () => {
    // 클라이언트 하나 말고 아무것도 주지 않았는데 만들어진다.
    expect(buildIntegrityDeps({} as unknown as Pool, { client: {} as unknown as GitHubClient })).toBeDefined();
  });
});

describe('buildServerDeps — 운영이 무엇을 넘기는가', () => {
  it('**GHE가 구성되면 integrity를 넘긴다** (DEV-177)', () => {
    const deps = buildServerDeps(parts({ github: GITHUB }));
    expect(deps.integrity).toBeDefined();
  });

  it('**GHE와 세션이 있으면 source에 실제 ES 클라이언트를 함께 넘긴다** (CR-107, FR-SRC-002 AC-1 — History PR 연결 배치 조회에 필요)', () => {
    const es = { search: () => undefined } as unknown as Client;
    const deps = buildServerDeps(parts({ github: GITHUB, auth: {} as unknown as RuntimeParts['auth'], es }));
    expect(deps.source?.es).toBe(es);
  });

  it('GHE가 없으면 넘기지 않는다', () => {
    expect(buildServerDeps(parts()).integrity).toBeUndefined();
  });

  it('**없을 때 조용히 넘어가지 않는다** — 운영자가 404 이유를 로그에서 읽는다', () => {
    const entries: Record<string, unknown>[] = [];
    buildServerDeps(parts({ log: (entry) => entries.push(entry) }));
    const warned = entries.find((entry) => String(entry['message']).includes('정합성 점검'));
    expect(warned).toBeDefined();
    expect(warned?.['level']).toBe('warn');
  });

  it('ops·pipeline은 언제나 넘긴다 — 관리 경로의 관문이다', () => {
    const deps = buildServerDeps(parts());
    expect(deps.ops).toBeDefined();
    expect(deps.pipeline).toBeDefined();
  });
});

describe('buildGhDeps — Operations가 꺼진 배포는 운영 정책을 요구하지 않는다 (CR-090)', () => {
  /*
   * 인증·Redis·Operations App 자격을 모두 준다. 하나라도 빠지면 그 분기(예: 세션 인증 없음)가 `undefined`를 내어,
   * 스위치를 무시하는 변이가 살아남는다(실측). 스위치만 다르게 해야 스위치가 유일한 원인이다.
   */
  const OPS_ENV = {
    GHE_BASE_URL: 'https://ghe.example.com',
    GHE_OPS_CLIENT_ID: 'ops-client-id',
    GHE_OPS_CLIENT_SECRET: 'ops-client-secret',
    GHE_OPS_REDIRECT_URI: 'http://web.test/gh/identity/callback',
    GH_IDENTITY_VAULT_KEY: 'ab'.repeat(32),
  };
  // 조립이 DB를 한 번이라도 읽으면 던진다 — 정책 표(030)는 요청을 받을 때 읽는다.
  const pool = {
    query: () => {
      throw new Error('조립이 DB를 읽었다');
    },
  } as unknown as Pool;
  const opsParts = (enabled: 'true' | 'false'): RuntimeParts =>
    parts({
      config: { ...CONFIG, ghOps: resolveGhOpsConfig({ ...OPS_ENV, GH_OPERATIONS_ENABLED: enabled }) } as unknown as SearchApiConfig,
      pool,
      auth: { scopes: {} } as unknown as RuntimeParts['auth'],
      identityRedis: {} as unknown as RuntimeParts['identityRedis'],
    });

  it('GH_OPERATIONS_ENABLED=false면 gh 의존이 없다 — 같은 자격·인증에서 스위치만 켜면 생긴다. 어느 쪽도 조립 중에 DB를 읽지 않는다', () => {
    expect(buildGhDeps(opsParts('false'))).toBeUndefined();
    expect(buildGhDeps(opsParts('true'))).toBeDefined();
  });
});

describe('runtimeCapabilities — 없는 것을 없다고 말한다', () => {
  it('GHE가 없으면 sequence_integrity가 false다', () => {
    expect(runtimeCapabilities(parts())['sequence_integrity']).toBe(false);
  });

  it('GHE가 있으면 true다', () => {
    expect(runtimeCapabilities(parts({ github: GITHUB }))['sequence_integrity']).toBe(true);
  });
});
