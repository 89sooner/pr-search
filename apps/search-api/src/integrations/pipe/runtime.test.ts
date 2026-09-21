/**
 * PIPE 연동 운영 조립 (CR-112 / CR-034의 규율).
 *
 * `index.ts`가 부르는 **바로 그 함수들**(`buildServerDeps` → `buildPipeIntegrationDeps`)을 부른다.
 * 연동 경로의 실행 재료가 공개 서버와 **같은 객체**에서 나오는지 대조한다 — 따로 만들면 두 경로의
 * 커서 서명 키·ES·접근 범위 해석기가 언젠가 갈린다.
 */

import type { KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from '@prs/db';
import type { EventBus } from '@prs/bus';
import type { Client } from '@elastic/elasticsearch';
import type { GitHubClient } from '@prs/github';
import { buildServerDeps, runtimeCapabilities, type RuntimeParts } from '../../runtime.js';
import type { SearchApiConfig } from '../../config.js';
import { TEST_CURSOR_KEY } from '../../../integration/_cursor-fixture.js';
import { resolveExecution } from '../../resolve/routes.js';
import { repositoriesExecution } from '../../repositories/routes.js';
import { searchExecution } from '../../search/routes.js';
import type { PipeIntegrationSetting } from './config.js';
import { buildPipeIntegrationDeps, gheUserDirectory, redisReplayStore } from './runtime.js';

const SETTING: PipeIntegrationSetting = {
  enabled: true,
  host: '127.0.0.1',
  port: 3443,
  tls: { key: Buffer.from('k'), cert: Buffer.from('c'), clientCa: Buffer.from('ca') },
  gheHost: 'ghe.test',
  clients: [
    {
      clientId: 'pipe-dev',
      status: 'active',
      policyVersion: 1,
      issuer: 'urn:test:pipe',
      audience: 'urn:test:prs',
      profile: 'search-read-v1',
      signingKeys: new Map<string, KeyObject>(),
      certificateSha256: new Set(),
      subjectAltNames: new Set(['URI:spiffe://test/pipe-dev']),
      repositoryIds: [1],
    },
  ],
};

const CONFIG = {
  port: 0,
  adminTokens: [],
  metricsQueryUrl: null,
  gheBaseUrl: 'https://ghe.test',
  auth: { enabled: true, cookieSecure: true, loginPath: '/auth/login', groupRoleMap: new Map() },
  searchCursorKey: TEST_CURSOR_KEY,
  mergeNumberEnabled: true,
  pipeIntegration: SETTING,
} as unknown as SearchApiConfig;

const AUTH = { sessions: {}, scopes: { resolveCached: vi.fn() }, forget: vi.fn() } as unknown as RuntimeParts['auth'];
const SEARCH_DEPS = { es: {} as unknown as Client, resolveNames: vi.fn(), timeoutMs: 3000 };

function parts(overrides: Partial<RuntimeParts> = {}): RuntimeParts {
  return {
    config: CONFIG,
    pool: {} as unknown as Pool,
    bus: {} as unknown as EventBus,
    es: SEARCH_DEPS.es,
    log: () => undefined,
    github: { client: {} as unknown as GitHubClient },
    auth: AUTH,
    searchDeps: SEARCH_DEPS,
    ...overrides,
  };
}

const REPLAY = { setIfAbsent: vi.fn() };
const DIRECTORY = { findUserByLogin: vi.fn() };

describe('buildPipeIntegrationDeps', () => {
  it('꺼져 있으면 아무것도 만들지 않는다', () => {
    const serverDeps = buildServerDeps(parts());
    expect(
      buildPipeIntegrationDeps({ config: CONFIG, setting: { enabled: false }, serverDeps, log: () => undefined }),
    ).toBeUndefined();
  });

  it('켰는데 세션 인증이 없으면 던진다 — 인증을 끈 배포가 연동을 허용하지 않는다', () => {
    const serverDeps = buildServerDeps({ ...parts(), auth: undefined });
    expect(() =>
      buildPipeIntegrationDeps({ config: CONFIG, setting: SETTING, serverDeps, replay: REPLAY, directory: DIRECTORY, log: () => undefined }),
    ).toThrow(/세션 인증/);
  });

  it('켰는데 재생 방지 저장소나 GHE 사용자 조회가 없으면 던진다', () => {
    const serverDeps = buildServerDeps(parts());
    expect(() => buildPipeIntegrationDeps({ config: CONFIG, setting: SETTING, serverDeps, directory: DIRECTORY, log: () => undefined })).toThrow(/재생 방지/);
    expect(() => buildPipeIntegrationDeps({ config: CONFIG, setting: SETTING, serverDeps, replay: REPLAY, log: () => undefined })).toThrow(/GHE 사용자 조회/);
  });

  it('**공개 서버가 각 등록 함수에 넘기는 것과 같은 재료**로 실행 함수를 부른다', () => {
    const serverDeps = buildServerDeps(parts());
    const options = buildPipeIntegrationDeps({
      config: CONFIG,
      setting: SETTING,
      serverDeps,
      replay: REPLAY,
      directory: DIRECTORY,
      log: () => undefined,
    });
    if (options === undefined || serverDeps.search === undefined || serverDeps.repositories === undefined) {
      throw new Error('조립되어야 한다');
    }
    const { executions } = options.routes;
    const loginPath = CONFIG.auth.loginPath;

    // server.ts의 registerSearchRoutes 인자
    expect(executions.search).toEqual(searchExecution({ ...serverDeps.search, loginPath, mergeNumberEnabled: true }));
    expect(executions.search.deps.cursorSigner).toBe(serverDeps.search.cursorSigner);
    expect(executions.search.deps.es).toBe(serverDeps.search.es);
    // server.ts의 registerResolveRoutes 인자
    expect(executions.resolve).toEqual(
      resolveExecution({
        es: serverDeps.search.es,
        pool: serverDeps.search.pool,
        timeoutMs: 3000,
        loginPath,
        gheBaseUrl: 'https://ghe.test',
        mergeNumberEnabled: true,
      }),
    );
    // server.ts의 registerRepositoryRoutes 인자
    expect(executions.repositories.cursorSigner).toBe(serverDeps.repositories.cursorSigner);
    const expectedRepositories = repositoriesExecution({ ...serverDeps.repositories, loginPath });
    // `now` 기본값은 호출마다 새 함수라 참조가 다르다 — 나머지를 하나씩 대조한다.
    expect(executions.repositories.deps).toEqual(expectedRepositories.deps);
    expect(executions.repositories.deps.pool).toBe(serverDeps.repositories.pool);
    expect(executions.repositories.deps.es).toBe(serverDeps.repositories.es);
    expect(executions.repositories.loginPath).toBe(expectedRepositories.loginPath);
    expect(typeof executions.repositories.now()).toBe('number');
    // server.ts의 registerSourceRoutes 인자
    expect(executions.source.reader).toBe(serverDeps.source?.reader);
    expect(executions.source.es).toBe(serverDeps.source?.es);
    // server.ts의 registerSequenceRoutes → M 번호 해석
    expect(executions.mergeNumbers).toEqual({
      pool: serverDeps.sequence?.pool,
      es: serverDeps.sequence?.es,
      mergeNumberEnabled: true,
      loginPath,
    });
    // 접근 범위 해석기는 세션 경로와 같은 인스턴스다 — 5분 캐시·버전 울타리를 공유한다.
    expect(options.routes.scopes).toBe(serverDeps.auth?.scopes);
    expect(options.routes.clients).toBe(SETTING.clients);
  });

  it('기능 가용성에 연동 리스너가 보인다', () => {
    expect(runtimeCapabilities(parts())['pipe_search_integration']).toBe(true);
    expect(runtimeCapabilities(parts({ config: { ...CONFIG, pipeIntegration: { enabled: false } } }))['pipe_search_integration']).toBe(false);
  });
});

describe('어댑터', () => {
  it('Redis SET NX EX — OK면 새로 쓴 것이고 null이면 이미 있다', async () => {
    const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const store = redisReplayStore({ set });
    await expect(store.setIfAbsent('k', 30)).resolves.toBe(true);
    await expect(store.setIfAbsent('k', 30)).resolves.toBe(false);
    expect(set).toHaveBeenCalledWith('k', '1', 'EX', 30, 'NX');
  });

  it('GHE 사용자 조회는 설치 조직으로 토큰을 고르고 동시 실행을 제한한다', async () => {
    let running = 0;
    let peak = 0;
    const getUser = vi.fn(async (login: string) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { id: 1, login };
    });
    const directory = gheUserDirectory({ getUser }, 'acme');
    await Promise.all(Array.from({ length: 30 }, (_, i) => directory.findUserByLogin(`u${String(i)}`)));
    expect(getUser).toHaveBeenCalledWith('u0', 'acme');
    expect(peak).toBeLessThanOrEqual(8);
    expect(getUser).toHaveBeenCalledTimes(30);
  });
});
