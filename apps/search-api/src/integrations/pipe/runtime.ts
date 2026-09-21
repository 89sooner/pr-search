/**
 * PIPE 연동 운영 조립 (CR-112 / ADR-025, CR-034의 규율).
 *
 * ## 공개 서버와 같은 의존을 쓴다
 *
 * 연동 경로의 실행 재료는 `buildServerDeps`가 공개 서버에 넘기는 **바로 그 객체들**(ES·PostgreSQL·커서
 * 서명자·팀 해석·source reader·접근 범위 해석기)로 만든다. 따로 만들면 두 경로의 설정이 언젠가 갈린다 —
 * 커서 서명 키 하나만 달라도 연동 커서가 공개 커서와 다른 규칙을 갖는다.
 *
 * ## 켜져 있으면 전부 있어야 한다
 *
 * 기능이 켜졌는데 세션 인증(접근 범위 해석기)·검색·source·재생 방지 저장소·GHE 사용자 조회 중 하나라도
 * 없으면 **던진다** (기동 거부). `buildGhDeps`처럼 경고하고 넘어가지 않는다 — 지시서 5절이 인증을 끈
 * 개발 설정으로 연동이 자동 허용되는 모양을 금지한다.
 */

import type { UserSummary } from '@prs/github';
import type { SearchApiConfig } from '../../config.js';
import type { ServerDeps } from '../../server.js';
import { resolveExecution } from '../../resolve/routes.js';
import { repositoriesExecution } from '../../repositories/routes.js';
import { searchExecution } from '../../search/routes.js';
import type { PipeIntegrationSetting } from './config.js';
import { boundedDirectory, type GheUserDirectory } from './identity-binding.js';
import type { ReplayRedis } from './replay-store.js';
import type { IntegrationServerOptions } from './server.js';

/**
 * GHE 사용자 조회 어댑터. `org`는 설치 토큰을 고를 조직일 뿐이다 — `/users/{login}`은 조직과 무관하다.
 * 동시 실행 상한을 씌운다 (`boundedDirectory`).
 */
export function gheUserDirectory(
  client: { getUser(login: string, org: string): Promise<UserSummary | null> },
  org: string,
): GheUserDirectory {
  return boundedDirectory({ findUserByLogin: (login) => client.getUser(login, org) });
}

/** ioredis의 `SET key 1 EX s NX` — 새로 쓰면 `'OK'`, 이미 있으면 `null`이다. */
export function redisReplayStore(client: {
  set(key: string, value: string, mode: 'EX', seconds: number, flag: 'NX'): Promise<'OK' | null>;
}): ReplayRedis {
  return {
    setIfAbsent: async (key, seconds) => (await client.set(key, '1', 'EX', seconds, 'NX')) === 'OK',
  };
}

export interface PipeRuntimeParts {
  readonly config: SearchApiConfig;
  readonly setting: PipeIntegrationSetting;
  /** `buildServerDeps`의 결과 — 공개 서버와 같은 의존이다. */
  readonly serverDeps: ServerDeps;
  readonly replay?: ReplayRedis | undefined;
  readonly directory?: GheUserDirectory | undefined;
  readonly log: (entry: Record<string, unknown>) => void;
  readonly now?: () => number;
}

/**
 * @returns 꺼져 있으면 `undefined`. 켜져 있으면 private 리스너 인자.
 * @throws 켜져 있는데 의존이 하나라도 없으면.
 */
export function buildPipeIntegrationDeps(parts: PipeRuntimeParts): IntegrationServerOptions | undefined {
  const setting = parts.setting;
  if (!setting.enabled) return undefined;

  const deps = parts.serverDeps;
  const missing = [
    deps.auth === undefined ? '세션 인증(AUTH·GHE 자격)' : null,
    deps.search === undefined ? '검색(Elasticsearch)' : null,
    deps.repositories === undefined ? '저장소 진단' : null,
    deps.sequence === undefined ? 'M 번호 해석(PostgreSQL)' : null,
    deps.source === undefined ? 'source(GHE)' : null,
    parts.replay === undefined ? '재생 방지 저장소(Redis)' : null,
    parts.directory === undefined ? 'GHE 사용자 조회' : null,
  ].filter((one): one is string => one !== null);
  if (
    missing.length > 0 ||
    deps.auth === undefined ||
    deps.search === undefined ||
    deps.repositories === undefined ||
    deps.sequence === undefined ||
    deps.source === undefined ||
    parts.replay === undefined ||
    parts.directory === undefined
  ) {
    throw new Error(
      `PIPE_SEARCH_INTEGRATION_ENABLED=true인데 연동에 필요한 의존이 없다: ${missing.join(', ')} (CR-112). ` +
        '인증을 끈 배포나 GHE 자격이 없는 배포에서는 연동을 켤 수 없다',
    );
  }

  const loginPath = parts.config.auth.loginPath;
  const mergeNumberEnabled = parts.config.mergeNumberEnabled === true;
  const search = deps.search;

  // 아래 넷은 `buildServer`가 각 등록 함수에 넘기는 인자와 한 글자씩 같다 (server.ts). 시험이 대조한다.
  const executions = {
    search: searchExecution({ ...search, loginPath, mergeNumberEnabled }),
    resolve: resolveExecution({
      es: search.es,
      pool: search.pool,
      ...(search.timeoutMs === undefined ? {} : { timeoutMs: search.timeoutMs }),
      loginPath,
      gheBaseUrl: parts.config.gheBaseUrl,
      mergeNumberEnabled,
    }),
    repositories: repositoriesExecution({ ...deps.repositories, loginPath }),
    source: { ...deps.source, loginPath },
    mergeNumbers: { pool: deps.sequence.pool, es: deps.sequence.es, mergeNumberEnabled, loginPath },
  };

  return {
    tls: setting.tls,
    routes: {
      clients: setting.clients,
      gheHost: setting.gheHost,
      pool: search.pool,
      replay: parts.replay,
      directory: parts.directory,
      scopes: deps.auth.scopes,
      executions,
      ...(parts.now === undefined ? {} : { now: parts.now }),
      log: (entry) => {
        parts.log({ ...entry });
      },
    },
  };
}
