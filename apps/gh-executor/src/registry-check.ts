/**
 * capability 레지스트리 검사 — JOB-GH-003 (FR-GH-011 AC-2·AC-3, NFR-009 GATE-GH-02, WP-078 / CR-088).
 *
 * 비동기 문서 9.1의 계약은 「일 1회 + 배포 시, 동시 1, 재시도 3회」다. 이 프로세스가 그 자리다 —
 * gh 바이너리와 DB를 둘 다 가진 것이 실행기뿐이기 때문이다. 검사 하나는 두 부분이다:
 *
 *   1. **manifest 검증** — 적재한 manifest를 규칙·표로 다시 만들어 대조하고 차원별 커버리지를 센다
 *      (`validateManifest`). 바이너리를 부르지 않는다.
 *   2. **드리프트** — 실제 바이너리의 해시·버전·인벤토리를 manifest와 대조한다 (`checkDrift`).
 *      `gh <path> --help`를 command마다 부르므로 20~30초가 든다. 요청 경로에서는 절대 부르지 않는다.
 *
 * 결과는 `gh_capability_snapshot`(manifest 해시마다 한 행)과 `gh_capability_verification`(회차마다 한 행,
 * append-only)에 남는다. **기록은 실행 허용을 바꾸지 않는다.** 다만 드리프트·구조 실패가 나면 이 프로세스의
 * `stale` 플래그가 서고, 러너의 재검증이 그 뒤의 실행을 `registry_stale`로 거절한다 — 조용히 진행하지
 * 않는다는 FR-GH-011 AC-3의 `execution_disabled`가 그것이다. 다음 검사가 통과하면 플래그가 내린다.
 * 일시 오류(`error`)는 플래그를 바꾸지 않는다 — 시간 초과 하나가 실행을 멈추게 하지 않는다.
 */

import { hostname } from 'node:os';
import { ghRegistryRepo, type Pool } from '@prs/db';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION, RULES_VERSION, VALIDATOR_VERSION, reportHash, validateManifest, type GhCapabilityManifest, type GhRegistryReport } from '@prs/gh-cli';
import { checkDrift, type DriftCheck } from '@prs/gh-cli/node';
import type { ExecutorConfig } from './config.js';
import type { ExecutorMetrics } from './metrics.js';
import type { RunnerLogEntry } from './runner.js';

export type RegistryStatus = 'unchecked' | 'passed' | 'incomplete' | 'drift' | 'failed' | 'error';
export type RegistryTrigger = 'startup' | 'periodic' | 'manual';

export interface RegistryState {
  readonly status: RegistryStatus;
  readonly checkedAt: Date | null;
  readonly verificationId: number | null;
  /** 참이면 러너가 실행을 `registry_stale`로 거절한다. */
  readonly stale: boolean;
  readonly detail: string | null;
}

export interface RegistryCheckDeps {
  readonly pool: Pool;
  readonly config: ExecutorConfig;
  readonly manifest: GhCapabilityManifest;
  readonly metrics: ExecutorMetrics;
  readonly log: (entry: RunnerLogEntry | Record<string, unknown>) => void;
  readonly now?: () => Date;
  /** 시험용. 재시도 간격을 줄인다. 기본 5s·15s·45s (JOB-GH-003 재시도 3회). */
  readonly retryDelaysMs?: readonly number[];
  /** 시험용. 드리프트 검사를 바꿔 끼운다 — 실제 바이너리 없이 드리프트·오류 경로를 재현한다. */
  readonly drift?: (manifest: GhCapabilityManifest) => DriftCheck;
}

export interface RegistryCheckResult {
  readonly status: Exclude<RegistryStatus, 'unchecked'>;
  readonly stale: boolean;
  readonly report: GhRegistryReport;
  readonly drift: DriftCheck;
  readonly snapshotId: number | null;
  readonly verificationId: number | null;
  readonly attempts: number;
  readonly detail: string | null;
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 45_000];

function statusOf(report: GhRegistryReport, drift: DriftCheck): { readonly status: Exclude<RegistryStatus, 'unchecked'>; readonly stale: boolean | null; readonly detail: string | null } {
  if (drift.status === 'error') return { status: 'error', stale: null, detail: drift.error };
  if (report.status === 'failed') return { status: 'failed', stale: true, detail: `manifest 구조 오류 ${String(report.findings.filter((finding) => finding.severity === 'error').length)}건` };
  if (drift.status === 'version_mismatch' || drift.status === 'binary_mismatch') {
    return { status: 'failed', stale: true, detail: `${drift.status}: gh ${String(drift.ghVersionObserved)} / sha256 ${String(drift.binarySha256Observed).slice(0, 12)}` };
  }
  if (drift.status === 'drift') {
    const diff = drift.diff;
    return {
      status: 'drift',
      stale: true,
      detail: diff === null ? '인벤토리 해시 불일치' : `added ${String(diff.addedCommands.length)} · removed ${String(diff.removedCommands.length)} · changed ${String(diff.changedCommands.length)}`,
    };
  }
  if (report.status === 'incomplete') {
    const failing = report.gates.filter((gate) => !gate.pass).map((gate) => gate.id);
    return { status: 'incomplete', stale: false, detail: `게이트 미달: ${failing.join(', ')}` };
  }
  return { status: 'passed', stale: false, detail: null };
}

function environmentOf(deps: RegistryCheckDeps): Record<string, unknown> {
  return {
    executor_id: deps.config.executorId,
    hostname: hostname(),
    binary_path: deps.config.binaryPath,
    node_version: process.version,
    pid: process.pid,
  };
}

async function record(deps: RegistryCheckDeps, trigger: RegistryTrigger, report: GhRegistryReport, drift: DriftCheck, status: Exclude<RegistryStatus, 'unchecked'>): Promise<{ readonly snapshotId: number; readonly verificationId: number }> {
  const manifest = deps.manifest;
  const dimension = (id: string): { readonly total: number; readonly unclassified: number } => {
    const found = report.dimensions.find((one) => one.id === id);
    return found === undefined ? { total: 0, unclassified: 0 } : { total: found.total, unclassified: found.unclassified };
  };
  const { row } = await ghRegistryRepo.recordSnapshot(deps.pool, {
    ghVersion: manifest.ghVersion,
    manifestVersion: manifest.manifestVersion,
    manifestHash: manifest.hash,
    inventoryHash: report.inventoryHash,
    commandCount: manifest.commands.length,
    leafCommandCount: manifest.coverage.leafCommands,
    groupCommandCount: manifest.coverage.groupCommands,
    aliasOnlyCommandCount: manifest.coverage.aliasOnlyCommands,
    aliasCount: dimension('command_alias').total,
    positionalCount: dimension('positional').total,
    flagCount: manifest.coverage.commandFlags,
    inheritedFlagCount: manifest.coverage.inheritedFlagOccurrences,
    jsonFieldCount: manifest.coverage.jsonFields,
    unclassifiedCount: manifest.coverage.unclassifiedLeafCommands,
    interactionUnclassifiedCount: dimension('interaction').unclassified,
    flagUnclassifiedCount: dimension('command_flag').unclassified + dimension('inherited_flag').unclassified,
    positionalUnclassifiedCount: dimension('positional').unclassified,
    extensionCommandCount: dimension('extension_split').total,
    executableCount: manifest.coverage.executableCommands,
    coverage: manifest.coverage,
  });
  const verification = await ghRegistryRepo.insertVerification(deps.pool, {
    snapshotId: row.snapshot_id,
    checkedBy: 'gh-executor',
    trigger,
    environment: environmentOf(deps),
    ghVersionExpected: GH_PINNED_VERSION,
    ghVersionObserved: drift.ghVersionObserved,
    binarySha256Expected: GH_PINNED_LINUX_AMD64.binarySha256,
    binarySha256Observed: drift.binarySha256Observed,
    manifestHashExpected: manifest.hash,
    manifestHashObserved: report.hashVerified ? manifest.hash : null,
    inventoryHashExpected: drift.inventoryHashExpected,
    inventoryHashObserved: drift.inventoryHashObserved,
    validatorVersion: VALIDATOR_VERSION,
    rulesVersion: RULES_VERSION,
    status,
    drift: drift.diff,
    report,
    reportHash: reportHash(report),
    error: drift.error,
  });
  return { snapshotId: row.snapshot_id, verificationId: verification.verification_id };
}

/**
 * 검사 한 회차. 일시 오류(`error`)면 최대 3회 다시 시도한 뒤 마지막 결과를 기록한다.
 * 던지지 않는다 — 기록 실패(DB 장애)만 던진다. 호출부가 그것을 로그로 남긴다.
 */
export async function runRegistryCheck(deps: RegistryCheckDeps, trigger: RegistryTrigger): Promise<RegistryCheckResult> {
  const delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const report = validateManifest(deps.manifest);
  let drift: DriftCheck = (deps.drift ?? ((manifest) => checkDrift({ binaryPath: deps.config.binaryPath, manifest })))(deps.manifest);
  let attempts = 1;
  while (drift.status === 'error' && attempts <= delays.length) {
    deps.log({ level: 'warn', message: '레지스트리 드리프트 검사가 오류로 끝나 다시 시도한다', reason: drift.error ?? 'unknown', attempt: attempts });
    await new Promise((resolve) => setTimeout(resolve, delays[attempts - 1] ?? 0));
    drift = (deps.drift ?? ((manifest) => checkDrift({ binaryPath: deps.config.binaryPath, manifest })))(deps.manifest);
    attempts += 1;
  }
  const verdict = statusOf(report, drift);
  const stale = verdict.stale ?? false;
  const recorded = await record(deps, trigger, report, drift, verdict.status);
  deps.metrics.registryChecks.inc({ result: verdict.status });
  return { status: verdict.status, stale, report, drift, snapshotId: recorded.snapshotId, verificationId: recorded.verificationId, attempts, detail: verdict.detail };
}

export interface RegistryChecker {
  /** 지금 상태. 러너가 `stale`을 읽는다. */
  state(): RegistryState;
  /** 한 회차를 지금 돈다. 기동 검사가 이것을 기다린다. */
  runOnce(trigger: RegistryTrigger): Promise<RegistryCheckResult | null>;
  stop(): Promise<void>;
}

/**
 * 주기 검사기. 동시 1 — 앞 회차가 끝나기 전에 다음 회차를 시작하지 않는다(체인). 기동 검사는 호출부가
 * `runOnce('startup')`으로 먼저 돌리고, 그 결과로 실행을 열지 말지 정한다.
 */
export function startRegistryChecker(deps: RegistryCheckDeps, intervalMs = deps.config.registryCheckMs): RegistryChecker {
  let stopped = false;
  let inFlight: Promise<unknown> = Promise.resolve();
  let state: RegistryState = { status: 'unchecked', checkedAt: null, verificationId: null, stale: false, detail: null };
  const now = deps.now ?? ((): Date => new Date());

  const runOnce = async (trigger: RegistryTrigger): Promise<RegistryCheckResult | null> => {
    const run = inFlight.then(async (): Promise<RegistryCheckResult | null> => {
      try {
        const result = await runRegistryCheck(deps, trigger);
        // 일시 오류는 이전 stale 판정을 유지한다 — 시간 초과 하나로 실행을 멈추지 않는다.
        const stale = result.status === 'error' ? state.stale : result.stale;
        state = { status: result.status, checkedAt: now(), verificationId: result.verificationId, stale, detail: result.detail };
        deps.metrics.registryStale.set(stale ? 1 : 0);
        deps.log({
          level: stale ? 'error' : result.status === 'error' ? 'warn' : 'info',
          message: stale ? '레지스트리 검사 실패 — 이후 실행은 registry_stale로 거절한다 (FR-GH-011 AC-3)' : '레지스트리 검사를 기록했다',
          reason: result.status,
          trigger,
          detail: result.detail,
          verification_id: result.verificationId,
          manifest_hash: deps.manifest.hash,
          attempts: result.attempts,
        });
        return result;
      } catch (error) {
        // 기록 실패(DB) — 상태는 바꾸지 않고 로그만 남긴다. 다음 회차가 다시 시도한다.
        deps.log({ level: 'error', message: '레지스트리 검사 기록 실패', reason: error instanceof Error ? error.message : String(error), trigger });
        deps.metrics.registryChecks.inc({ result: 'record_failed' });
        return null;
      }
    });
    inFlight = run.catch(() => undefined);
    return run;
  };

  const timer = setInterval(() => {
    if (stopped) return;
    void runOnce('periodic');
  }, intervalMs);
  timer.unref();

  return {
    state: () => state,
    runOnce,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
