/**
 * 위임 신원 — Operations App 인가 왕복과 토큰 수명주기 (FR-GH-008, ADR-014, WP-046 일부).
 *
 * ## 흐름 (공식 「Generating a user access token for a GitHub App」 web application flow)
 *
 * 1. `start`: `state`·PKCE(`S256`)를 만들고 Redis에 10분 보관 → 인가 URL
 *    `https://<GHE>/login/oauth/authorize?client_id&redirect_uri&state&code_challenge…`
 * 2. 브라우저가 GHE에서 인가 → `<web>/gh/identity/callback?code&state`
 * 3. `complete`: `state` 대조(상수 시간) → `POST /login/oauth/access_token` (`code_verifier`)
 *    → `/user`로 신원 확인 → 봉인 → 연결 upsert. **응답의 토큰은 이 함수의 지역 변수로만 산다.**
 * 4. 실행 전 만료가 가까우면 `refresh_token`으로 갱신 (`grant_type=refresh_token`). 공식 문서:
 *    「Once you use a refresh token, that refresh token and the old user access token will no
 *    longer work」 — 그래서 갱신은 봉인 교체와 같은 트랜잭션이다.
 * 5. `disconnect`: 봉인 삭제 + 연결 철회. GitHub 쪽 인가는 사용자가 GHE 설정에서 철회한다
 *    (공식 revoke 엔드포인트 `DELETE /applications/{client_id}/token`은 best-effort로 부른다).
 *
 * ## 유효 권한은 교집합이다 (AC-3·AC-4)
 *
 * 공식 문서: 「A user access token only has permissions that both the user and the app have.」
 * 이 모듈은 그것을 **믿고 쓰는 쪽**이다 — 설치 토큰으로 대체하는 경로가 없다. 수집용
 * Data App의 자격은 이 파일에 등장하지 않는다.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction, ghIdentityRepo, type Pool, type IdentityConnectionRow } from '@prs/db';
import { createAuthorizationRequest, statesMatch, sanitizeReturnPath } from '@prs/authz';
import { sealSecret, unsealSecret, type VaultKey } from '@prs/gh-cli/node';
import type { GhOpsConfig } from './config.js';

/** Redis에 두는 인가 왕복 상태. 키는 `prs:gh:identity:<state>`. */
export interface AuthorizationRoundTrip {
  readonly userId: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly correlationId: string;
}

export interface IdentityRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

export const IDENTITY_STATE_PREFIX = 'prs:gh:identity:';

export type HttpJson = (
  url: string,
  init: { readonly method: 'GET' | 'POST' | 'DELETE'; readonly headers: Readonly<Record<string, string>>; readonly body?: string },
) => Promise<{ readonly status: number; readonly body: unknown }>;

export interface IdentityDeps {
  readonly pool: Pool;
  readonly redis: IdentityRedis;
  readonly config: GhOpsConfig;
  readonly vaultKey: VaultKey;
  readonly http: HttpJson;
  readonly now?: () => Date;
}

export class IdentityError extends Error {
  constructor(
    readonly code: 'state_mismatch' | 'exchange_failed' | 'user_lookup_failed' | 'not_connected' | 'refresh_failed' | 'misconfigured',
    message: string,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

function required(config: GhOpsConfig): { baseUrl: string; apiUrl: string; host: string; clientId: string; clientSecret: string; redirectUri: string } {
  if (config.baseUrl === null || config.apiUrl === null || config.host === null || config.clientId === null || config.clientSecret === null || config.redirectUri === null) {
    throw new IdentityError('misconfigured', 'Operations App 자격이 구성되지 않았다');
  }
  return { baseUrl: config.baseUrl, apiUrl: config.apiUrl, host: config.host, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri };
}

/** 기반 주소에 경로를 붙인다. `github-oauth.ts`의 `joinUrl`과 같은 판단이다 — 문자열 이어 붙이기가 아니다. */
function join(base: string, path: string): string {
  const url = new URL(base.endsWith('/') ? base : `${base}/`);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return url.toString();
}

export interface StartOutcome {
  readonly authorizeUrl: string;
  readonly state: string;
}

/** 1단계. 인가 URL을 만든다. 상태는 Redis에만 산다 — URL·쿠키에 verifier를 싣지 않는다. */
export async function startAuthorization(deps: IdentityDeps, userId: string, returnTo: string | undefined, correlationId: string): Promise<StartOutcome> {
  const config = required(deps.config);
  const request = createAuthorizationRequest(sanitizeReturnPath(returnTo, '/gh'));
  const roundTrip: AuthorizationRoundTrip = { userId, codeVerifier: request.codeVerifier, returnTo: request.returnTo, correlationId };
  await deps.redis.set(`${IDENTITY_STATE_PREFIX}${request.state}`, JSON.stringify(roundTrip), 'EX', deps.config.authorizationStateTtlSeconds);

  const url = new URL(join(config.baseUrl, 'login/oauth/authorize'));
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', request.state);
  url.searchParams.set('code_challenge', request.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('allow_signup', 'false');
  return { authorizeUrl: url.toString(), state: request.state };
}

interface TokenResponse {
  readonly access_token: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly refresh_token_expires_in?: number;
  readonly scope?: string;
}

function readTokenResponse(response: { readonly status: number; readonly body: unknown }): TokenResponse {
  const errorCode = (): string => {
    const body = response.body as { error?: unknown } | null;
    return typeof body?.error === 'string' ? body.error : 'unknown';
  };
  if (response.status < 200 || response.status >= 300) {
    throw new IdentityError('exchange_failed', `토큰 엔드포인트가 ${String(response.status)}를 반환했다 (error=${errorCode()})`);
  }
  const body = response.body as Record<string, unknown> | null;
  if (body === null || typeof body !== 'object') throw new IdentityError('exchange_failed', '토큰 응답이 객체가 아니다');
  // 200인데 오류인 경우 — GHE의 통상 실패 모양이다 (CR-083이 배운 것).
  if ('error' in body) throw new IdentityError('exchange_failed', `토큰 교환이 거절됐다 (error=${errorCode()})`);
  const token = body['access_token'];
  if (typeof token !== 'string' || token === '') throw new IdentityError('exchange_failed', '토큰 응답에 access_token이 없다');
  const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
  const expiresIn = number(body['expires_in']);
  const refreshExpiresIn = number(body['refresh_token_expires_in']);
  const refreshToken = typeof body['refresh_token'] === 'string' && body['refresh_token'] !== '' ? body['refresh_token'] : undefined;
  const scope = typeof body['scope'] === 'string' ? body['scope'] : undefined;
  const out: { -readonly [K in keyof TokenResponse]: TokenResponse[K] } = { access_token: token };
  if (expiresIn !== undefined) out.expires_in = expiresIn;
  if (refreshExpiresIn !== undefined) out.refresh_token_expires_in = refreshExpiresIn;
  if (refreshToken !== undefined) out.refresh_token = refreshToken;
  if (scope !== undefined) out.scope = scope;
  return out;
}

async function exchange(deps: IdentityDeps, params: URLSearchParams): Promise<TokenResponse> {
  const config = required(deps.config);
  params.set('client_id', config.clientId);
  params.set('client_secret', config.clientSecret);
  let response: { readonly status: number; readonly body: unknown };
  try {
    response = await deps.http(join(config.baseUrl, 'login/oauth/access_token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: params.toString(),
    });
  } catch (error) {
    throw new IdentityError('exchange_failed', `토큰 엔드포인트 요청 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
  return readTokenResponse(response);
}

async function lookupUser(deps: IdentityDeps, accessToken: string): Promise<{ id: number; login: string }> {
  const config = required(deps.config);
  let response: { readonly status: number; readonly body: unknown };
  try {
    response = await deps.http(join(config.apiUrl, 'user'), {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
  } catch (error) {
    throw new IdentityError('user_lookup_failed', `사용자 조회 요청 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status < 200 || response.status >= 300) throw new IdentityError('user_lookup_failed', `사용자 조회가 ${String(response.status)}를 반환했다`);
  const body = response.body as { id?: unknown; login?: unknown } | null;
  if (body === null || typeof body.id !== 'number' || !Number.isSafeInteger(body.id) || body.id <= 0 || typeof body.login !== 'string' || body.login === '') {
    throw new IdentityError('user_lookup_failed', '사용자 응답의 id·login이 형식에 맞지 않는다');
  }
  return { id: body.id, login: body.login };
}

export interface CompleteOutcome {
  readonly connection: IdentityConnectionRow;
  readonly returnTo: string;
}

/**
 * 3단계. 콜백의 `code`·`state`로 토큰을 받아 봉인하고 연결을 만든다.
 *
 * 상태는 **읽자마자 지운다** — 같은 `state`로 두 번 시도할 수 없다.
 */
export async function completeAuthorization(deps: IdentityDeps, userId: string, code: string, state: string): Promise<CompleteOutcome> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) throw new IdentityError('state_mismatch', 'state 형식이 틀리다');
  const key = `${IDENTITY_STATE_PREFIX}${state}`;
  const raw = await deps.redis.get(key);
  await deps.redis.del(key);
  if (raw === null) throw new IdentityError('state_mismatch', '인가 상태가 없거나 만료됐다');
  const roundTrip = JSON.parse(raw) as AuthorizationRoundTrip;
  if (!statesMatch(roundTrip.userId, userId)) throw new IdentityError('state_mismatch', '인가를 시작한 사용자가 아니다');

  const params = new URLSearchParams({ code, redirect_uri: required(deps.config).redirectUri, code_verifier: roundTrip.codeVerifier });
  const token = await exchange(deps, params);
  const user = await lookupUser(deps, token.access_token);

  const now = (deps.now ?? ((): Date => new Date()))();
  const expiresAt = token.expires_in === undefined ? null : new Date(now.getTime() + token.expires_in * 1000);
  const refreshExpiresAt = token.refresh_token_expires_in === undefined ? null : new Date(now.getTime() + token.refresh_token_expires_in * 1000);

  const connection = await withTransaction(deps.pool, (client) =>
    ghIdentityRepo.connectIdentity(client, {
      userId,
      githubLogin: user.login,
      githubUserId: user.id,
      host: required(deps.config).host,
      scopes: (token.scope ?? '').split(/[,\s]+/).filter((scope) => scope !== ''),
      expiresAt,
      refreshExpiresAt,
      keyId: deps.vaultKey.keyId,
      accessSealed: sealSecret(deps.vaultKey, token.access_token, userId),
      refreshSealed: token.refresh_token === undefined ? null : sealSecret(deps.vaultKey, token.refresh_token, userId),
    }),
  );
  return { connection, returnTo: roundTrip.returnTo };
}

export type ConnectionStatus = 'connected' | 'not_connected' | 'expired' | 'revoked' | 'host_changed';

export interface IdentityStatus {
  readonly status: ConnectionStatus;
  readonly connection: IdentityConnectionRow | null;
}

export function statusOf(connection: IdentityConnectionRow | null, host: string | null, now: Date): IdentityStatus {
  if (connection === null) return { status: 'not_connected', connection: null };
  if (connection.revoked_at !== null) return { status: 'revoked', connection };
  if (host !== null && connection.host !== host) return { status: 'host_changed', connection };
  const accessExpired = connection.expires_at !== null && connection.expires_at.getTime() <= now.getTime();
  const refreshExpired = connection.refresh_expires_at !== null && connection.refresh_expires_at.getTime() <= now.getTime();
  if (accessExpired && refreshExpired) return { status: 'expired', connection };
  return { status: 'connected', connection };
}

export async function readStatus(deps: IdentityDeps, userId: string): Promise<IdentityStatus> {
  const connection = await ghIdentityRepo.findConnection(deps.pool, userId);
  return statusOf(connection, deps.config.host, (deps.now ?? ((): Date => new Date()))());
}

/**
 * 실행 전에 연결이 살아 있게 한다. 만료가 가까우면 갱신한다 (JOB-GH-004의 요청 시점 판).
 *
 * @throws {IdentityError} 연결이 없거나 갱신에 실패하면 — 호출부는 `GH_IDENTITY_REQUIRED`로 답한다.
 * @returns 살아 있는 연결.
 */
export async function ensureLiveConnection(deps: IdentityDeps, userId: string): Promise<IdentityConnectionRow> {
  const now = (deps.now ?? ((): Date => new Date()))();
  const status = await readStatus(deps, userId);
  if (status.status !== 'connected' || status.connection === null) throw new IdentityError('not_connected', `위임 연결이 없다 (${status.status})`);
  const connection = status.connection;

  const expiresSoon = connection.expires_at !== null && connection.expires_at.getTime() - now.getTime() <= deps.config.refreshLeadMs;
  if (!expiresSoon) return connection;

  const secret = await ghIdentityRepo.loadSecret(deps.pool, connection.token_ref);
  if (secret === null || secret.refresh_sealed === null) throw new IdentityError('refresh_failed', '갱신 토큰이 없다 — 다시 연결해야 한다');
  const refreshToken = unsealSecret(deps.vaultKey, secret.refresh_sealed, userId);
  let token: TokenResponse;
  try {
    token = await exchange(deps, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }));
  } catch (error) {
    throw new IdentityError('refresh_failed', error instanceof Error ? error.message : String(error));
  }
  const expiresAt = token.expires_in === undefined ? null : new Date(now.getTime() + token.expires_in * 1000);
  const refreshExpiresAt = token.refresh_token_expires_in === undefined ? null : new Date(now.getTime() + token.refresh_token_expires_in * 1000);
  await withTransaction(deps.pool, (client) =>
    ghIdentityRepo.rotateSecret(client, connection.token_ref, {
      keyId: deps.vaultKey.keyId,
      accessSealed: sealSecret(deps.vaultKey, token.access_token, userId),
      refreshSealed: token.refresh_token === undefined ? null : sealSecret(deps.vaultKey, token.refresh_token, userId),
      expiresAt,
      refreshExpiresAt,
    }),
  );
  const refreshed = await ghIdentityRepo.findConnection(deps.pool, userId);
  if (refreshed === null) throw new IdentityError('not_connected', '갱신 뒤 연결이 사라졌다');
  return refreshed;
}

/** 5단계. 봉인을 지우고 연결을 철회한다. GitHub 쪽 철회는 best-effort다. */
export async function disconnect(deps: IdentityDeps, userId: string, reason: string): Promise<IdentityConnectionRow | null> {
  const connection = await ghIdentityRepo.findConnection(deps.pool, userId);
  if (connection === null) return null;
  let accessToken: string | null = null;
  if (connection.revoked_at === null) {
    const secret = await ghIdentityRepo.loadSecret(deps.pool, connection.token_ref);
    if (secret !== null) {
      try {
        accessToken = unsealSecret(deps.vaultKey, secret.access_sealed, userId);
      } catch {
        accessToken = null;
      }
    }
  }
  const revoked = await withTransaction(deps.pool, (client) => ghIdentityRepo.revokeConnection(client, userId, reason));

  if (accessToken !== null) {
    const config = required(deps.config);
    try {
      // 공식: DELETE /applications/{client_id}/token — Basic(client_id:client_secret), 본문 {access_token}.
      await deps.http(join(config.apiUrl, `applications/${encodeURIComponent(config.clientId)}/token`), {
        method: 'DELETE',
        headers: {
          authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ access_token: accessToken }),
      });
    } catch {
      // 로컬 철회는 이미 끝났다. GitHub 쪽 실패는 사용자가 GHE 설정에서 정리할 수 있다.
    }
  }
  return revoked;
}

export function newCorrelationId(): string {
  return randomUUID();
}
