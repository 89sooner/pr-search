/**
 * Operations Plane 설정 — `search-api` 쪽 (FR-GH-008, ADR-014, 보안 문서 10.1·10.2).
 *
 * | 변수 | 뜻 |
 * | --- | --- |
 * | `GH_OPERATIONS_ENABLED` | 전역 스위치. 기본 `false`. `gh-executor`와 같은 값이어야 한다 |
 * | `GHE_BASE_URL` | 인가·토큰 엔드포인트의 기반 (`/login/oauth/…`). 호스트가 실행 컨텍스트의 host다 |
 * | `GHE_API_URL` | `/user` 조회 기반. 비면 `<base>/api/v3` |
 * | `GHE_OPS_CLIENT_ID`·`GHE_OPS_CLIENT_SECRET` | **Operations App**의 것. 수집용 Data App·로그인용 OAuth App·표기 App과 자격을 공유하지 않는다 |
 * | `GHE_OPS_REDIRECT_URI` | `<web 주소>/gh/identity/callback`. App에 등록한 값과 문자 그대로 같아야 한다 |
 * | `GH_IDENTITY_VAULT_KEY` | 토큰 봉인 키. `gh-executor`와 같은 값이어야 실체화된다 |
 *
 * 켜 놓고 하나라도 비면 **기동을 거부한다** (CR-078의 규율). 조용히 꺼진 채 돌면
 * 운영자가 켰다고 믿는 기능이 없는 상태가 되고 그것을 알 신호가 없다.
 */

import { parseVaultKey, type VaultKey } from '@prs/gh-cli/node';

export interface GhOpsEnv {
  readonly [key: string]: string | undefined;
}

export interface GhOpsConfig {
  readonly enabled: boolean;
  readonly baseUrl: string | null;
  readonly apiUrl: string | null;
  /** `GHE_BASE_URL`의 host. 실행 컨텍스트·`GH_HOST`·`--repo`의 호스트다. */
  readonly host: string | null;
  readonly clientId: string | null;
  readonly clientSecret: string | null;
  readonly redirectUri: string | null;
  readonly vaultKey: VaultKey | null;
  /** 만료가 이보다 가까우면 실행 전에 갱신한다. */
  readonly refreshLeadMs: number;
  /** 인가 왕복 상태의 수명. */
  readonly authorizationStateTtlSeconds: number;
}

export function resolveOperationsEnabled(env: GhOpsEnv = process.env): boolean {
  const raw = (env['GH_OPERATIONS_ENABLED'] ?? 'false').trim();
  if (raw === 'true') return true;
  if (raw === 'false' || raw === '') return false;
  throw new Error(`GH_OPERATIONS_ENABLED는 true 또는 false여야 한다: ${raw}`);
}

function trimmed(env: GhOpsEnv, key: string): string | null {
  const value = (env[key] ?? '').trim();
  return value === '' ? null : value;
}

function baseUrlOf(raw: string | null): { readonly baseUrl: string; readonly host: string } | null {
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`GHE_BASE_URL이 절대 URL이 아니다: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`GHE_BASE_URL의 스킴이 http(s)가 아니다: ${raw}`);
  return { baseUrl: raw.replace(/\/+$/, ''), host: url.host };
}

export function resolveGhOpsConfig(env: GhOpsEnv = process.env): GhOpsConfig {
  const enabled = resolveOperationsEnabled(env);
  const base = baseUrlOf(trimmed(env, 'GHE_BASE_URL'));
  const vaultRaw = trimmed(env, 'GH_IDENTITY_VAULT_KEY');
  const apiUrl = trimmed(env, 'GHE_API_URL') ?? (base === null ? null : `${base.baseUrl}/api/v3`);
  return {
    enabled,
    baseUrl: base?.baseUrl ?? null,
    apiUrl: apiUrl === null ? null : apiUrl.replace(/\/+$/, ''),
    host: base?.host ?? null,
    clientId: trimmed(env, 'GHE_OPS_CLIENT_ID'),
    clientSecret: trimmed(env, 'GHE_OPS_CLIENT_SECRET'),
    redirectUri: trimmed(env, 'GHE_OPS_REDIRECT_URI'),
    vaultKey: vaultRaw === null ? null : parseVaultKey(vaultRaw),
    refreshLeadMs: 15 * 60 * 1000,
    authorizationStateTtlSeconds: 600,
  };
}

/** 켜져 있는데 성립하지 않는 이유. 성립하면 `null`. */
export function ghOpsConfigFailure(config: GhOpsConfig): string | null {
  if (!config.enabled) return null;
  const missing: string[] = [];
  if (config.baseUrl === null) missing.push('GHE_BASE_URL');
  if (config.clientId === null) missing.push('GHE_OPS_CLIENT_ID');
  if (config.clientSecret === null) missing.push('GHE_OPS_CLIENT_SECRET');
  if (config.redirectUri === null) missing.push('GHE_OPS_REDIRECT_URI');
  if (config.vaultKey === null) missing.push('GH_IDENTITY_VAULT_KEY');
  if (missing.length > 0) return `GH_OPERATIONS_ENABLED=true인데 Operations App 자격이 없다: ${missing.join(', ')}`;
  return null;
}
