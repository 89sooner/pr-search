/**
 * 실행 요청 처리 (API-GH-002·005·010·011 / FR-GH-002·003·006·009·012, 백엔드 12.2).
 *
 * 순서가 계약이다 (백엔드 12.2):
 *
 * ```text
 * 1. 중복 방지 키       → 기존 실행이면 GH_DUPLICATE_REQUEST (기존 ID를 싣는다)
 * 2. capability 해석    → manifest에 없으면 GH_CAPABILITY_UNKNOWN, 열리지 않았으면 GH_CAPABILITY_NOT_EXECUTABLE
 * 3. 버전 대조          → (search-api와 executor는 같은 manifest를 싣는다; 실행기가 다시 대조한다)
 * 4. 제약 검증          → GH_CONSTRAINT_VIOLATION (위반 목록 포함)
 * 5. 신원 확인          → 연결 없음·만료 → GH_IDENTITY_REQUIRED
 * 6. 권한 판정          → 저장소가 접근 범위 밖 → NOT_FOUND (존재를 드러내지 않는다)
 * 7·8·9·10             → R0에는 정책·확인·승인·대상 재조회·잠금이 없다 (이 판은 R0만 연다)
 * 11. 감사 선기록       → gh_execution 행 INSERT. 실패하면 실행하지 않는다
 * 12. 큐 적재           → prs:gh:executions
 * ```
 *
 * **미리보기와 실행이 같은 함수(`prepare`)를 지난다.** 미리보기는 11·12를 하지 않을 뿐이다.
 */

import { randomUUID } from 'node:crypto';
import type { EventBus } from '@prs/bus';
import { TOPICS } from '@prs/bus';
import { ghExecutionRepo, type GhExecutionRow, type Pool } from '@prs/db';
import type { AccessScopeResolver } from '@prs/authz';
import {
  GH_PINNED_VERSION,
  buildArgv,
  buildExecutionEnv,
  describeExecutionEnv,
  evaluateInvocation,
  findCapability,
  redactArgv,
  type GhCapabilityDefinition,
  type GhCapabilityManifest,
  type GhConstraintViolation,
  type GhInvocation,
} from '@prs/gh-cli';
import type { GhOpsConfig } from './config.js';
import { listVisibleRepositories, resolveRepositoryContext, type RepositoryContext } from './context.js';
import { IdentityError, ensureLiveConnection, readStatus, type IdentityDeps } from './identity.js';

export class GhRejected extends Error {
  constructor(
    readonly code:
      | 'INVALID_PARAMETER'
      | 'NOT_FOUND'
      | 'GH_CAPABILITY_UNKNOWN'
      | 'GH_CAPABILITY_NOT_EXECUTABLE'
      | 'GH_CONSTRAINT_VIOLATION'
      | 'GH_IDENTITY_REQUIRED'
      | 'GH_DUPLICATE_REQUEST',
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'GhRejected';
  }
}

export interface ExecutionDeps {
  readonly pool: Pool;
  readonly bus: EventBus;
  readonly config: GhOpsConfig;
  readonly manifest: GhCapabilityManifest;
  readonly identity: IdentityDeps;
  readonly scopes: Pick<AccessScopeResolver, 'resolveCached'>;
  readonly log?: (entry: { readonly level: string; readonly message: string; readonly correlation_id?: string; readonly reason?: string }) => void;
  readonly now?: () => Date;
}

export interface Principal {
  readonly userId: string;
  readonly login: string;
  readonly roles: readonly string[];
}

/** 클라이언트가 보낸 본문. 모양만 맞추고 값은 검증기가 본다. */
export function parseInvocationBody(body: unknown): GhInvocation {
  if (typeof body !== 'object' || body === null) throw new GhRejected('INVALID_PARAMETER', '본문이 객체가 아니다');
  const record = body as Record<string, unknown>;
  const capabilityId = record['capability_id'];
  if (typeof capabilityId !== 'string' || capabilityId === '') throw new GhRejected('INVALID_PARAMETER', 'capability_id가 없다', { field: 'capability_id' });
  const context = record['context'];
  const repository = typeof context === 'object' && context !== null ? (context as Record<string, unknown>)['repository'] : undefined;
  if (typeof repository !== 'string') throw new GhRejected('INVALID_PARAMETER', 'context.repository가 없다', { field: 'context.repository' });
  const flags = record['flags'] ?? {};
  if (typeof flags !== 'object' || flags === null || Array.isArray(flags)) throw new GhRejected('INVALID_PARAMETER', 'flags는 객체여야 한다', { field: 'flags' });
  const output = record['output'] ?? {};
  if (typeof output !== 'object' || output === null) throw new GhRejected('INVALID_PARAMETER', 'output은 객체여야 한다', { field: 'output' });
  const jsonFields = (output as Record<string, unknown>)['json_fields'] ?? [];
  if (!Array.isArray(jsonFields)) throw new GhRejected('INVALID_PARAMETER', 'output.json_fields는 배열이어야 한다', { field: 'output.json_fields' });
  // 검증기가 거절하는 키(positional·stdin·files…)는 그대로 넘긴다 — 거절의 주체가 하나여야 한다.
  const passthrough: Record<string, unknown> = {};
  for (const key of ['positional', 'stdin', 'files', 'argv', 'command']) if (key in record) passthrough[key] = record[key];
  return {
    capability_id: capabilityId,
    context: { repository },
    flags: flags as GhInvocation['flags'],
    output: { json_fields: jsonFields as string[] },
    ...passthrough,
  } as GhInvocation;
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function parseIdempotencyKey(raw: unknown): string {
  if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(raw)) {
    throw new GhRejected('INVALID_PARAMETER', 'Idempotency-Key는 8~128자의 [A-Za-z0-9_-]여야 한다', { field: 'idempotency_key' });
  }
  return raw;
}

export interface Prepared {
  readonly capability: GhCapabilityDefinition;
  readonly repository: RepositoryContext;
  readonly argv: readonly string[];
  readonly redactedArgv: readonly string[];
  readonly envKeys: readonly { readonly key: string; readonly value: string }[];
  readonly invocation: GhInvocation;
  readonly identity: Awaited<ReturnType<typeof readStatus>>;
  readonly host: string;
}

function violationsDetail(violations: readonly GhConstraintViolation[]): Record<string, unknown> {
  return { violations: violations.map((violation) => ({ code: violation.code, flag: violation.flag, message: violation.message })) };
}

/**
 * 미리보기와 실행이 공유하는 준비 단계 (2·4·6). 신원은 상태만 읽는다 — 미리보기는
 * 연결이 없어도 argv를 보여 줄 수 있어야 「연결이 필요하다」를 함께 안내할 수 있다.
 */
export async function prepare(deps: ExecutionDeps, principal: Principal, invocation: GhInvocation): Promise<Prepared> {
  const host = deps.config.host;
  if (host === null) throw new GhRejected('GH_CAPABILITY_NOT_EXECUTABLE', 'GHE 호스트가 구성되지 않았다', { reason: 'misconfigured' });

  const command = deps.manifest.commands.find((entry) => entry.id === invocation.capability_id);
  if (command === undefined) throw new GhRejected('GH_CAPABILITY_UNKNOWN', `manifest에 없는 capability: ${invocation.capability_id}`);
  const capability = findCapability(invocation.capability_id);
  if (capability === undefined || command.execution !== 'allowed') {
    throw new GhRejected('GH_CAPABILITY_NOT_EXECUTABLE', `이 배포가 실행을 열지 않은 capability: ${invocation.capability_id}`, {
      reason: command.execution,
      explanation: command.executionReason,
    });
  }

  const evaluated = evaluateInvocation(capability, invocation);
  if (!evaluated.ok) throw new GhRejected('GH_CONSTRAINT_VIOLATION', 'argument·flag 제약 위반', violationsDetail(evaluated.violations));

  const scope = await deps.scopes.resolveCached(principal.userId);
  const repository = await resolveRepositoryContext(deps.pool, scope, evaluated.invocation.repository);
  if (repository === null) throw new GhRejected('NOT_FOUND', '저장소를 찾을 수 없다');

  const argv = buildArgv(capability, evaluated.invocation, { host, repository: { owner: repository.owner, name: repository.name } });
  const envKeys = describeExecutionEnv(
    buildExecutionEnv({ host, token: '<redacted>', workspace: { home: '<workspace>/home', configDir: '<workspace>/config', tmp: '<workspace>/tmp' }, caFile: null }),
  );
  const identity = await readStatus(deps.identity, principal.userId);

  return { capability, repository, argv, redactedArgv: redactArgv(argv), envKeys, invocation, identity, host };
}

export interface PreviewView {
  readonly capability_id: string;
  readonly risk: string;
  readonly argv: readonly string[];
  readonly env: readonly { readonly key: string; readonly value: string }[];
  readonly context: {
    readonly host: string;
    readonly repository: string;
    readonly github_actor: string | null;
    readonly identity_status: string;
    readonly gh_version: string;
    readonly manifest_version: string;
    readonly manifest_hash: string;
    readonly required_permissions: readonly string[];
    /** 사용자 권한은 GitHub이 교집합으로 강제한다. 여기서는 판정 방식만 적는다 (FR-GH-009 AC-7). */
    readonly permission_check: 'delegated_token_intersection';
    readonly policy: 'r0_immediate';
    readonly timeout_ms: number;
  };
  readonly executable: boolean;
  readonly blockers: readonly string[];
}

export function toPreview(deps: ExecutionDeps, prepared: Prepared): PreviewView {
  const blockers: string[] = [];
  if (prepared.identity.status !== 'connected') blockers.push(`identity_${prepared.identity.status}`);
  return {
    capability_id: prepared.capability.id,
    risk: prepared.capability.risk,
    argv: prepared.redactedArgv,
    env: prepared.envKeys,
    context: {
      host: prepared.host,
      repository: prepared.repository.slug,
      github_actor: prepared.identity.connection?.github_login ?? null,
      identity_status: prepared.identity.status,
      gh_version: GH_PINNED_VERSION,
      manifest_version: deps.manifest.manifestVersion,
      manifest_hash: deps.manifest.hash,
      required_permissions: prepared.capability.requiredPermissions,
      permission_check: 'delegated_token_intersection',
      policy: 'r0_immediate',
      timeout_ms: prepared.capability.timeoutMs,
    },
    executable: blockers.length === 0,
    blockers,
  };
}

export interface ExecutionView {
  readonly execution_id: number;
  readonly state: string;
  readonly capability_id: string;
  readonly risk: string;
  readonly repository: string | null;
  readonly host: string;
  readonly github_actor: string;
  readonly user_id: string;
  readonly argv: readonly string[];
  readonly env_keys: readonly string[];
  readonly gh_version: string;
  readonly manifest_version: string;
  readonly manifest_hash: string;
  readonly requested_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly cancel_requested_at: string | null;
  readonly exit_code: number | null;
  readonly error: string | null;
  readonly result: Record<string, unknown> | null;
  readonly stdout: { readonly text: string | null; readonly truncated: boolean } | null;
  readonly stderr: { readonly text: string | null; readonly truncated: boolean } | null;
  readonly output_binary: boolean;
  readonly output_hash: string | null;
  readonly correlation_id: string;
  readonly invocation: Record<string, unknown>;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function toExecutionView(row: GhExecutionRow): ExecutionView {
  return {
    execution_id: row.execution_id,
    state: row.state,
    capability_id: row.capability_id,
    risk: row.risk_level,
    repository: row.repository,
    host: row.host,
    github_actor: row.github_actor,
    user_id: row.user_id,
    argv: row.redacted_argv,
    env_keys: row.env_keys,
    gh_version: row.gh_version,
    manifest_version: row.manifest_version,
    manifest_hash: row.manifest_hash,
    requested_at: row.requested_at.toISOString(),
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    cancel_requested_at: iso(row.cancel_requested_at),
    exit_code: row.exit_code,
    error: row.error,
    result: row.result,
    stdout: row.finished_at === null ? null : { text: row.stdout_excerpt, truncated: row.stdout_truncated },
    stderr: row.finished_at === null ? null : { text: row.stderr_excerpt, truncated: row.stderr_truncated },
    output_binary: row.output_binary,
    output_hash: row.output_hash,
    correlation_id: row.correlation_id,
    invocation: row.invocation,
  };
}

/**
 * 실행을 수락한다 (1 → 11 → 12). 반환은 `queued` 상태의 기록이다.
 *
 * 발행 실패는 요청 실패가 아니다 — 행은 이미 `queued`이고 실행기의 잔여 큐 스윕이 집는다.
 * 그 사실을 로그에 남긴다.
 */
export async function requestExecution(
  deps: ExecutionDeps,
  principal: Principal,
  invocation: GhInvocation,
  idempotencyKey: string,
  correlationId: string,
): Promise<GhExecutionRow> {
  const existing = await ghExecutionRepo.findByIdempotencyKey(deps.pool, principal.userId, idempotencyKey);
  if (existing !== null) {
    throw new GhRejected('GH_DUPLICATE_REQUEST', '같은 중복 방지 키의 실행이 이미 있다', { execution_id: existing.execution_id, state: existing.state });
  }

  const prepared = await prepare(deps, principal, invocation);

  let connection: Awaited<ReturnType<typeof ensureLiveConnection>>;
  try {
    connection = await ensureLiveConnection(deps.identity, principal.userId);
  } catch (error) {
    if (error instanceof IdentityError) {
      throw new GhRejected('GH_IDENTITY_REQUIRED', 'GitHub 계정 연결이 필요하다', { reason: error.code, identity_status: prepared.identity.status });
    }
    throw error;
  }

  let row: GhExecutionRow;
  try {
    row = await ghExecutionRepo.insertExecution(deps.pool, {
      userId: principal.userId,
      githubActor: connection.github_login,
      host: prepared.host,
      repository: prepared.repository.slug,
      repositoryId: prepared.repository.repositoryId,
      capabilityId: prepared.capability.id,
      invocation: {
        capability_id: prepared.invocation.capability_id,
        context: prepared.invocation.context,
        flags: prepared.invocation.flags,
        output: prepared.invocation.output,
      },
      context: {
        host: prepared.host,
        repository: prepared.repository.slug,
        repository_id: prepared.repository.repositoryId,
        github_actor: connection.github_login,
        github_user_id: connection.github_user_id,
        gh_version: GH_PINNED_VERSION,
        manifest_version: deps.manifest.manifestVersion,
        manifest_hash: deps.manifest.hash,
        risk: prepared.capability.risk,
        required_permissions: prepared.capability.requiredPermissions,
        timeout_ms: prepared.capability.timeoutMs,
      },
      redactedArgv: prepared.redactedArgv,
      envKeys: prepared.envKeys.map((entry) => entry.key),
      riskLevel: prepared.capability.risk,
      ghVersion: GH_PINNED_VERSION,
      manifestVersion: deps.manifest.manifestVersion,
      manifestHash: deps.manifest.hash,
      idempotencyKey,
      authorizationResult: 'delegated_token_intersection',
      correlationId,
    });
  } catch (error) {
    if (error instanceof ghExecutionRepo.DuplicateIdempotencyKeyError) {
      throw new GhRejected('GH_DUPLICATE_REQUEST', '같은 중복 방지 키의 실행이 이미 있다', { execution_id: error.executionId });
    }
    throw error;
  }

  try {
    await deps.bus.publish(TOPICS.ghExecutions, `${prepared.host}:${prepared.repository.slug}`, {
      event_id: randomUUID(),
      event_name: 'gh.execution.requested',
      correlation_id: correlationId,
      occurred_at: row.requested_at.toISOString(),
      payload: { execution_id: row.execution_id, capability_id: row.capability_id, risk: row.risk_level, idempotency_key: idempotencyKey },
    });
  } catch (error) {
    deps.log?.({
      level: 'warn',
      message: '실행 이벤트 발행에 실패했다 — 행은 queued이며 실행기의 잔여 큐 스윕이 집는다',
      correlation_id: correlationId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return row;
}

/** 보안 담당자는 전체를, 나머지는 자기 것만 본다 (FR-GH-012 AC-3). */
export function canSeeAll(principal: Principal): boolean {
  return principal.roles.includes('security_officer');
}

export async function findVisibleExecution(deps: ExecutionDeps, principal: Principal, executionId: number): Promise<GhExecutionRow | null> {
  const row = await ghExecutionRepo.findById(deps.pool, executionId);
  if (row === null) return null;
  if (row.user_id !== principal.userId && !canSeeAll(principal)) return null;
  return row;
}

export async function listVisibleExecutions(
  deps: ExecutionDeps,
  principal: Principal,
  options: { readonly all: boolean; readonly limit: number; readonly beforeId?: number },
): Promise<GhExecutionRow[]> {
  const all = options.all && canSeeAll(principal);
  return ghExecutionRepo.listExecutions(deps.pool, {
    ...(all ? {} : { userId: principal.userId }),
    limit: options.limit,
    ...(options.beforeId === undefined ? {} : { beforeId: options.beforeId }),
  });
}

export { listVisibleRepositories };
