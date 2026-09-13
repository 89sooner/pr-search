/**
 * 실행 러너 (JOB-GH-001 / FR-GH-002·FR-GH-006·FR-GH-008·FR-GH-012, ADR-016).
 *
 * 큐에서 실행 ID를 받아 **재검증 → claim → 실체화 → spawn → 기록 → 정리** 순서로
 * 간다. 각 단계가 실패하면 그 자리에서 종료 상태를 남기고 멈춘다.
 *
 * ## 큐에서 꺼낼 때 다시 확인하는 것 (FR-GH-008 예외 처리, 백엔드 12.2)
 *
 * 요청 시점의 판정을 믿지 않는다. 그 사이에 연결이 끊겼거나(철회·만료), 저장소가
 * 해제됐거나, 배포가 바뀌어 manifest가 달라졌을 수 있다. **연결 해제·만료·철회 뒤의
 * 대기 실행은 시작하지 않는다.**
 *
 * ## argv를 다시 만들어 대조한다 (FR-GH-002 AC-4·AC-8)
 *
 * 저장된 구조화 invocation에서 **같은 빌더**로 argv를 다시 만들고, 요청 시점에 남긴
 * `redacted_argv`와 같지 않으면 실행하지 않는다. 미리보기와 실행이 갈릴 수 있는 유일한
 * 자리(코드 버전 차이)가 여기서 드러난다.
 *
 * ## 토큰은 이 함수의 지역 변수로만 존재한다
 *
 * 실체화 → 환경 객체 → spawn. 로그·오류·기록 어디에도 넣지 않는다. 오류 메시지는
 * `redactString`을 지난다.
 */

import { createHash } from 'node:crypto';
import { ghExecutionRepo, ghIdentityRepo, repositoryRepo, type Pool, type GhExecutionRow } from '@prs/db';
import {
  GH_PINNED_VERSION,
  argvEquals,
  buildArgv,
  buildExecutionEnv,
  evaluateInvocation,
  findCapability,
  parsePrListOutput,
  parseRepositorySlug,
  redactArgv,
  redactString,
  type GhCapabilityManifest,
  type GhInvocation,
  type GhSafeText,
} from '@prs/gh-cli';
import { VaultUnsealError, unsealSecret, type VaultKey } from '@prs/gh-cli/node';
import type { ExecutorConfig } from './config.js';
import type { ExecutorMetrics } from './metrics.js';
import { runGhProcess, type GhProcessResult } from './spawn.js';
import { createWorkspace, destroyWorkspace } from './workspace.js';

export interface RunnerLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly execution_id?: number;
  readonly reason?: string;
  readonly correlation_id?: string;
  readonly duration_ms?: number;
  readonly exit_code?: number | null;
  readonly state?: string;
}

export interface RunnerDeps {
  readonly pool: Pool;
  readonly config: ExecutorConfig;
  readonly manifest: GhCapabilityManifest;
  readonly vaultKey: VaultKey;
  readonly metrics: ExecutorMetrics;
  readonly log: (entry: RunnerLogEntry) => void;
  readonly now?: () => Date;
  /**
   * 시험 전용. capability의 시간 상한·설정의 stdout 상한을 덮어쓴다 — 운영 배선은 넘기지
   * 않는다(회귀가 건다). 실제 gh 실행에서 상한이 성립하는지 보려면 값을 줄여야 하고,
   * 그것을 위해 capability 정의를 흔들지 않는다.
   */
  readonly timeoutMsOverride?: number;
  readonly stdoutLimitOverride?: number;
  /** 시험 전용. 재검증과 claim 사이에 끼어드는 일(취소 등)을 재현한다. 운영 배선은 넘기지 않는다. */
  readonly beforeClaim?: () => Promise<void>;
}

export type RunOutcome =
  | 'missing'
  | 'not_queued'
  | 'cancelled_before_start'
  | 'rejected'
  | 'lost_claim'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

const STDOUT_EXCERPT_BYTES = 262_144;
const STDERR_EXCERPT_BYTES = 65_536;

/**
 * 이력에 남는 발췌. 무해화(`SafeOutputStream`)는 이미 지났고, 여기서 **토큰 모양 편집**(`redactString`)을
 * 한 번 더 지난다 — gh가 표준 오류에 자격을 되울리는 경우를 위한 심층 방어이며 argv·오류 필드와 같은 규칙이다.
 */
function excerpt(text: GhSafeText, maxBytes: number): { readonly text: string | null; readonly truncated: boolean } {
  if (text.binary) return { text: null, truncated: text.truncated };
  const encoded = new TextEncoder().encode(text.text);
  if (encoded.length <= maxBytes) return { text: redactString(text.text), truncated: text.truncated };
  return { text: redactString(new TextDecoder().decode(encoded.subarray(0, maxBytes))), truncated: true };
}

/**
 * 큐에서 집기 전의 재검증. 탈락하면 사유 코드를 돌려주고 호출부가 `failed`로 닫는다.
 *
 * @returns 성립하면 실행에 필요한 것들(토큰 포함), 아니면 사유.
 */
async function revalidate(
  deps: RunnerDeps,
  row: GhExecutionRow,
): Promise<
  | { readonly ok: true; readonly argv: string[]; readonly token: string; readonly timeoutMs: number; readonly jsonFields: readonly string[]; readonly limit: number; readonly repository: { owner: string; name: string } }
  | { readonly ok: false; readonly reason: string }
> {
  const now = (deps.now ?? ((): Date => new Date()))();

  // 1. 배포가 같은 manifest·gh인가 (FR-GH-011 AC-2·AC-3).
  if (row.manifest_hash !== deps.manifest.hash || row.gh_version !== GH_PINNED_VERSION) return { ok: false, reason: 'registry_stale' };

  // 2. capability가 여전히 열려 있는가.
  const capability = findCapability(row.capability_id);
  if (capability === undefined || capability.execution !== 'allowed') return { ok: false, reason: 'capability_not_executable' };

  // 3. 대상 저장소가 여전히 등록·활성인가.
  if (row.repository_id === null) return { ok: false, reason: 'repository_unavailable' };
  const repository = await repositoryRepo.findRepositoryById(deps.pool, row.repository_id);
  if (repository === undefined || repository.status !== 'active') return { ok: false, reason: 'repository_unavailable' };
  if (`${repository.owner}/${repository.name}` !== row.repository) return { ok: false, reason: 'repository_renamed' };

  // 4. 위임 연결이 살아 있는가 (FR-GH-008 예외 처리).
  const connection = await ghIdentityRepo.findConnection(deps.pool, row.user_id);
  if (connection === null || connection.revoked_at !== null) return { ok: false, reason: 'identity_required' };
  if (connection.host !== deps.config.host) return { ok: false, reason: 'identity_host_mismatch' };
  if (connection.expires_at !== null && connection.expires_at.getTime() <= now.getTime() + 5_000) return { ok: false, reason: 'identity_expired' };
  if (connection.github_login !== row.github_actor) return { ok: false, reason: 'identity_changed' };

  // 5. 토큰 실체화 (FR-GH-008 AC-6). 실패는 사유만 남는다.
  const secret = await ghIdentityRepo.loadSecret(deps.pool, connection.token_ref);
  if (secret === null) return { ok: false, reason: 'identity_secret_missing' };
  let token: string;
  try {
    token = unsealSecret(deps.vaultKey, secret.access_sealed, row.user_id);
  } catch (error) {
    return { ok: false, reason: error instanceof VaultUnsealError ? 'identity_unsealable' : 'identity_unsealable' };
  }

  // 6. 같은 빌더로 argv를 다시 만들어 대조한다 (FR-GH-002 AC-4·AC-8).
  const evaluated = evaluateInvocation(capability, row.invocation as unknown as GhInvocation);
  if (!evaluated.ok) return { ok: false, reason: 'invocation_invalid' };
  const slug = parseRepositorySlug(row.repository);
  if (slug === null) return { ok: false, reason: 'repository_unavailable' };
  const argv = buildArgv(capability, evaluated.invocation, { host: row.host, repository: slug });
  if (!argvEquals(redactArgv(argv), row.redacted_argv)) return { ok: false, reason: 'argv_mismatch' };

  const limitOption = evaluated.invocation.options.find((option) => option.flag === '--limit');
  const limit = typeof limitOption?.value === 'number' ? limitOption.value : 30;

  return { ok: true, argv, token, timeoutMs: capability.timeoutMs, jsonFields: evaluated.invocation.jsonFields, limit, repository: slug };
}

function classifyExit(result: GhProcessResult): string {
  if (result.exitCode === 0) return 'ok';
  // 공식 exit code: 1 실패, 2 취소, 4 인증 필요.
  if (result.exitCode === 4) return 'gh_auth_required';
  if (result.exitCode === 2) return 'gh_cancelled';
  return `gh_exit_${String(result.exitCode ?? 'signal')}`;
}

/**
 * 실행 하나를 끝까지 처리한다. **던지지 않는다** — 예외도 `failed`로 기록된다.
 */
export async function runExecution(deps: RunnerDeps, executionId: number): Promise<RunOutcome> {
  const row = await ghExecutionRepo.findById(deps.pool, executionId);
  if (row === null) return 'missing';
  if (row.state !== 'queued') return 'not_queued';

  if (row.cancel_requested_at !== null) {
    await ghExecutionRepo.cancelQueued(deps.pool, executionId);
    deps.metrics.executions.inc({ result: 'cancelled' });
    deps.log({ level: 'info', message: '시작 전에 취소됐다', execution_id: executionId, correlation_id: row.correlation_id });
    return 'cancelled_before_start';
  }

  const validation = await revalidate(deps, row);
  if (!validation.ok) {
    await ghExecutionRepo.failQueued(deps.pool, executionId, validation.reason);
    deps.metrics.executions.inc({ result: 'rejected' });
    deps.log({ level: 'warn', message: '큐에서 꺼낸 실행이 재검증에서 탈락했다', execution_id: executionId, reason: validation.reason, correlation_id: row.correlation_id });
    return 'rejected';
  }

  if (deps.beforeClaim !== undefined) await deps.beforeClaim();
  const claimed = await ghExecutionRepo.claimExecution(deps.pool, executionId, deps.config.executorId);
  if (claimed === null) {
    /*
     * claim이 0행이면 둘 중 하나다 — 다른 실행기가 먼저 집었거나, 재검증과 claim 사이에 **취소가
     * 들어왔다**(claim은 `cancel_requested_at IS NULL`을 요구한다). 후자를 잔여 큐 스윕(최대
     * `queuedStaleMs`)까지 기다리게 두지 않고 지금 닫는다 — 사용자는 취소를 눌렀고 아무것도
     * 실행되지 않았다 (`DEV-665`).
     */
    const current = await ghExecutionRepo.findById(deps.pool, executionId);
    if (current !== null && current.state === 'queued' && current.cancel_requested_at !== null) {
      await ghExecutionRepo.cancelQueued(deps.pool, executionId);
      deps.metrics.executions.inc({ result: 'cancelled' });
      deps.log({ level: 'info', message: '집기 직전에 취소됐다', execution_id: executionId, correlation_id: row.correlation_id });
      return 'cancelled_before_start';
    }
    deps.metrics.executions.inc({ result: 'lost_claim' });
    return 'lost_claim';
  }

  const workspace = createWorkspace(deps.config.workspaceRoot);
  deps.metrics.activeDelta(1);
  let result: GhProcessResult;
  try {
    const env = buildExecutionEnv({
      host: deps.config.host ?? row.host,
      token: validation.token,
      workspace: { home: workspace.home, configDir: workspace.configDir, tmp: workspace.tmp },
      caFile: deps.config.caFile,
    });
    result = await runGhProcess({
      binaryPath: deps.config.binaryPath,
      argv: validation.argv,
      env,
      cwd: workspace.root,
      timeoutMs: deps.timeoutMsOverride ?? validation.timeoutMs,
      stdoutLimitBytes: deps.stdoutLimitOverride ?? deps.config.stdoutLimitBytes,
      stderrLimitBytes: deps.config.stderrLimitBytes,
      shouldCancel: () => ghExecutionRepo.isCancelRequested(deps.pool, executionId),
      onHeartbeat: async () => {
        await ghExecutionRepo.heartbeat(deps.pool, executionId, deps.config.executorId);
      },
      heartbeatMs: deps.config.heartbeatMs,
    });
  } finally {
    deps.metrics.activeDelta(-1);
    destroyWorkspace(workspace);
  }

  const stdoutExcerpt = excerpt(result.stdout, STDOUT_EXCERPT_BYTES);
  const stderrExcerpt = excerpt(result.stderr, STDERR_EXCERPT_BYTES);
  const envKeys = Object.keys(
    buildExecutionEnv({ host: 'x', token: 'x', workspace: { home: 'x', configDir: 'x', tmp: 'x' }, caFile: deps.config.caFile }),
  );

  let state: 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  let error: string | null = null;
  let structured: Record<string, unknown> | null = null;

  if (result.outcome === 'cancelled') {
    state = 'cancelled';
    error = 'cancelled';
  } else if (result.outcome === 'timed_out') {
    state = 'timed_out';
    error = `timed_out_after_${String(deps.timeoutMsOverride ?? validation.timeoutMs)}ms`;
  } else if (result.outcome === 'spawn_failed') {
    state = 'failed';
    error = `spawn_failed: ${redactString(result.spawnError ?? 'unknown')}`;
  } else if (result.exitCode !== 0) {
    state = 'failed';
    error = classifyExit(result);
  } else if (result.stdout.binary) {
    state = 'failed';
    error = 'stdout_binary';
  } else {
    const parsed = parsePrListOutput(result.stdout.text, validation.jsonFields, validation.limit);
    if (parsed.ok) {
      state = 'succeeded';
      structured = {
        kind: 'json',
        schema: parsed.result.schema,
        sensitivity: 'internal',
        fields: parsed.result.fields,
        rows: parsed.result.rows,
        row_count: parsed.result.rows.length,
        possibly_more: parsed.result.possiblyMore,
        stdout_truncated: result.stdout.truncated,
      };
    } else {
      state = 'failed';
      error = `result_parse_failed: ${parsed.reason}${result.stdout.truncated ? ' (stdout truncated)' : ''}`;
    }
  }

  const finished = await ghExecutionRepo.finishExecution(deps.pool, executionId, deps.config.executorId, {
    state,
    exitCode: result.exitCode,
    outputHash: result.stdoutSha256,
    error,
    result: structured,
    stdoutExcerpt: stdoutExcerpt.text,
    stderrExcerpt: stderrExcerpt.text,
    stdoutTruncated: stdoutExcerpt.truncated,
    stderrTruncated: stderrExcerpt.truncated,
    outputBinary: result.stdout.binary || result.stderr.binary,
    envKeys,
  });
  if (finished === null) {
    /*
     * 회수 판정을 덮지 않는다(`gh-execution.ts`의 규율) — 다만 조용히 버리지도 않는다. 하트비트가 끊겨
     * 고아로 회수된 뒤 돌아온 결과이며, 운영자가 「왜 실패로 보이는가」를 로그에서 찾을 수 있어야 한다 (`DEV-666`).
     */
    deps.log({
      level: 'warn',
      message: '실행 결과를 기록하지 못했다 — 이미 고아로 회수된 실행이다(executor_lost). 결과는 버려진다',
      execution_id: executionId,
      correlation_id: row.correlation_id,
      state,
    });
  }

  deps.metrics.executions.inc({ result: state });
  deps.metrics.duration.observe(result.durationMs / 1000);
  deps.log({
    level: state === 'succeeded' ? 'info' : 'warn',
    message: 'gh 실행 종료',
    execution_id: executionId,
    correlation_id: row.correlation_id,
    state,
    exit_code: result.exitCode,
    duration_ms: result.durationMs,
    ...(error === null ? {} : { reason: error }),
  });
  return state;
}

/** 시험·진단용: 원본 stdout의 해시가 기록과 같은지 볼 때 쓴다. */
export function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
