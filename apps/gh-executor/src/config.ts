/**
 * gh-executor 설정 (ADR-016, 인프라 12장, NFR-010·NFR-011).
 *
 * 값은 환경 변수에서만 읽는다. **켜 놓고 필수 값이 없으면 기동을 거부한다** (CR-078의
 * 규율 — 조용히 꺼진 채 돌면 운영자가 켰다고 믿는 기능이 없는 상태가 된다).
 *
 * | 변수 | 기본 | 뜻 |
 * | --- | --- | --- |
 * | `GH_OPERATIONS_ENABLED` | `false` | 전역 스위치. `search-api`와 같은 값이어야 한다 |
 * | `GHE_BASE_URL` | (필수) | 대상 GHE. host 부분이 `GH_HOST`·`--repo`의 호스트가 된다 |
 * | `GH_IDENTITY_VAULT_KEY` | (필수) | 봉인 키. `search-api`와 같은 값이어야 토큰을 실체화한다 |
 * | `GH_EXECUTOR_BIN` | `/usr/local/bin/gh` | 고정 바이너리 경로 |
 * | `GH_EXECUTOR_WORKSPACE_ROOT` | `/var/lib/prs/gh-workspaces` | 실행별 임시 workspace의 부모. 유일한 쓰기 경로 |
 * | `GH_EXECUTOR_MAX_CONCURRENT` | `2` | 동시 실행 상한 (1..파티션 수) |
 * | `GH_EXECUTOR_STDOUT_LIMIT_BYTES` | `1048576` | stdout 보관 상한 |
 * | `GH_EXECUTOR_STDERR_LIMIT_BYTES` | `65536` | stderr 보관 상한 |
 * | `GH_EXECUTOR_CA_FILE` | `NODE_EXTRA_CA_CERTS` 값 | gh(Go)에 줄 CA. Go는 Node 변수를 읽지 않는다 |
 * | `GH_EXECUTOR_PORT` | `3004` | 헬스체크·지표 포트 |
 */

import { PARTITION_COUNTS, TOPICS } from '@prs/bus';
import { parseVaultKey, type VaultKey } from '@prs/gh-cli/node';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

export interface ExecutorEnv {
  readonly [key: string]: string | undefined;
}

export interface ExecutorConfig {
  readonly enabled: boolean;
  readonly port: number;
  /** `ghe.example.com` 또는 `127.0.0.1:48443`. 없으면 `null` — 켜져 있으면 실패다. */
  readonly host: string | null;
  readonly vaultKey: VaultKey | null;
  readonly binaryPath: string;
  readonly workspaceRoot: string;
  readonly maxConcurrent: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
  readonly caFile: string | null;
  readonly heartbeatMs: number;
  readonly orphanAfterMs: number;
  readonly queuedStaleMs: number;
  readonly sweepIntervalMs: number;
  /** 이 프로세스의 식별자. claim에 남아 「누가 집었나」에 답한다. */
  readonly executorId: string;
}

export function resolveOperationsEnabled(env: ExecutorEnv = process.env): boolean {
  const raw = (env['GH_OPERATIONS_ENABLED'] ?? 'false').trim();
  if (raw === 'true') return true;
  if (raw === 'false' || raw === '') return false;
  throw new Error(`GH_OPERATIONS_ENABLED는 true 또는 false여야 한다: ${raw}`);
}

function integer(env: ExecutorEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = (env[key] ?? '').trim();
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key}는 ${String(min)}..${String(max)}의 정수여야 한다: ${raw}`);
  }
  return value;
}

/** `GHE_BASE_URL` → host (포트 포함). 절대 URL이 아니면 던진다. */
export function hostOfBaseUrl(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`GHE_BASE_URL이 절대 URL이 아니다: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`GHE_BASE_URL의 스킴이 http(s)가 아니다: ${value}`);
  return url.host;
}

export function resolveExecutorConfig(env: ExecutorEnv = process.env): ExecutorConfig {
  const enabled = resolveOperationsEnabled(env);
  const vaultRaw = (env['GH_IDENTITY_VAULT_KEY'] ?? '').trim();
  const maxPartitions = PARTITION_COUNTS[TOPICS.ghExecutions];
  const caFile = (env['GH_EXECUTOR_CA_FILE'] ?? env['NODE_EXTRA_CA_CERTS'] ?? '').trim();
  return {
    enabled,
    port: integer(env, 'GH_EXECUTOR_PORT', 3004, 1, 65_535),
    host: hostOfBaseUrl(env['GHE_BASE_URL']),
    vaultKey: vaultRaw === '' ? null : parseVaultKey(vaultRaw),
    binaryPath: (env['GH_EXECUTOR_BIN'] ?? '/usr/local/bin/gh').trim(),
    workspaceRoot: (env['GH_EXECUTOR_WORKSPACE_ROOT'] ?? '/var/lib/prs/gh-workspaces').trim(),
    maxConcurrent: integer(env, 'GH_EXECUTOR_MAX_CONCURRENT', 2, 1, maxPartitions),
    stdoutLimitBytes: integer(env, 'GH_EXECUTOR_STDOUT_LIMIT_BYTES', 1_048_576, 4_096, 8_388_608),
    stderrLimitBytes: integer(env, 'GH_EXECUTOR_STDERR_LIMIT_BYTES', 65_536, 1_024, 1_048_576),
    caFile: caFile === '' ? null : caFile,
    heartbeatMs: integer(env, 'GH_EXECUTOR_HEARTBEAT_MS', 5_000, 500, 60_000),
    orphanAfterMs: integer(env, 'GH_EXECUTOR_ORPHAN_AFTER_MS', 60_000, 5_000, 3_600_000),
    queuedStaleMs: integer(env, 'GH_EXECUTOR_QUEUED_STALE_MS', 30_000, 1_000, 3_600_000),
    sweepIntervalMs: integer(env, 'GH_EXECUTOR_SWEEP_MS', 15_000, 1_000, 600_000),
    executorId: `${hostname()}:${String(process.pid)}:${randomUUID().slice(0, 8)}`,
  };
}

/** 켜져 있는데 성립하지 않는 이유. 성립하면 `null`. */
export function executorConfigFailure(config: ExecutorConfig): string | null {
  if (!config.enabled) return null;
  const missing: string[] = [];
  if (config.host === null) missing.push('GHE_BASE_URL');
  if (config.vaultKey === null) missing.push('GH_IDENTITY_VAULT_KEY');
  if (missing.length > 0) return `GH_OPERATIONS_ENABLED=true인데 필수 값이 없다: ${missing.join(', ')}`;
  return null;
}
