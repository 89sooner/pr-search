/**
 * gh 프로세스 제어 (FR-GH-002 AC-1, FR-GH-006 AC-3·AC-4·AC-5, NFR-010·NFR-011, ADR-016).
 *
 * **이 파일이 이 저장소에서 `gh`를 띄우는 유일한 자리다.** `spawn(고정 경로, argv,
 * { shell: false })`이며 문자열 명령은 없다. 회귀가 `spawn(` 호출이 하나뿐이고
 * `shell: true`·`exec(`·`sh -c`가 0건임을 코드 검사로 건다.
 *
 * ## 프로세스 그룹
 *
 * `detached: true`로 띄워 자식이 **자기 프로세스 그룹의 리더**가 되게 하고, 종료는
 * `process.kill(-pid)`로 그룹 전체에 보낸다. gh가 `git`이나 페이저를 띄웠더라도
 * 함께 죽는다 — 타임아웃 화면만 띄우고 자식은 계속 도는 상태를 만들지 않는다.
 *
 * ## 출력
 *
 * stdout·stderr는 각각 `SafeOutputStream`을 지나며 상한을 넘긴 바이트는 세기만 한다.
 * 원본 바이트의 해시는 따로 계산한다 — 이력에 남는 것은 해시와 무해화된 발췌뿐이다.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { SafeOutputStream, type GhSafeText } from '@prs/gh-cli';

export interface GhProcessRequest {
  readonly binaryPath: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
  /** 취소 요청이 있는가. 주기적으로 묻는다. */
  readonly shouldCancel?: () => Promise<boolean>;
  readonly cancelPollMs?: number;
  /** 살아 있음을 알린다. 주기적으로 부른다. */
  readonly onHeartbeat?: () => Promise<void>;
  readonly heartbeatMs?: number;
  /** SIGTERM 뒤 SIGKILL까지의 유예. 기본 1초 — NFR-011의 「3초 안에 프로세스 그룹 종료」 안이다. */
  readonly killGraceMs?: number;
  /** 시험용. 실제 `spawn` 대신 쓴다. */
  readonly spawnImpl?: typeof spawn;
}

export type GhProcessOutcome = 'exited' | 'timed_out' | 'cancelled' | 'spawn_failed';

export interface GhProcessResult {
  readonly outcome: GhProcessOutcome;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: GhSafeText;
  readonly stderr: GhSafeText;
  /** 무해화 전 stdout 원본의 SHA-256. */
  readonly stdoutSha256: string;
  readonly durationMs: number;
  /** spawn 자체가 실패했을 때의 사유. */
  readonly spawnError: string | null;
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // 이미 죽었다 (ESRCH). 그것이 목표였다.
  }
}

/**
 * 프로세스를 실행하고 끝까지 본다. **절대 던지지 않는다** — spawn 실패도 결과다.
 */
export async function runGhProcess(request: GhProcessRequest): Promise<GhProcessResult> {
  const started = Date.now();
  const stdout = new SafeOutputStream({ maxBytes: request.stdoutLimitBytes });
  const stderr = new SafeOutputStream({ maxBytes: request.stderrLimitBytes });
  const hash = createHash('sha256');
  const spawnImpl = request.spawnImpl ?? spawn;

  let child: ChildProcess;
  try {
    child = spawnImpl(request.binaryPath, [...request.argv], {
      cwd: request.cwd,
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      shell: false,
    });
  } catch (error) {
    return {
      outcome: 'spawn_failed',
      exitCode: null,
      signal: null,
      stdout: stdout.finish(),
      stderr: stderr.finish(),
      stdoutSha256: hash.digest('hex'),
      durationMs: Date.now() - started,
      spawnError: error instanceof Error ? error.message : String(error),
    };
  }

  return new Promise<GhProcessResult>((resolve) => {
    let outcome: GhProcessOutcome = 'exited';
    let spawnError: string | null = null;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];

    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearInterval(timer);
      resolve({
        outcome,
        exitCode,
        signal,
        stdout: stdout.finish(),
        stderr: stderr.finish(),
        stdoutSha256: hash.digest('hex'),
        durationMs: Date.now() - started,
        spawnError,
      });
    };

    const terminate = (reason: GhProcessOutcome): void => {
      if (settled || outcome !== 'exited') return;
      outcome = reason;
      killGroup(child, 'SIGTERM');
      const grace = setTimeout(() => {
        killGroup(child, 'SIGKILL');
        // SIGKILL 뒤에도 파이프를 쥔 손자가 있으면 close가 늦는다. 상한을 둔다.
        const hard = setTimeout(() => finish(null, 'SIGKILL'), 2_000);
        hard.unref();
      }, request.killGraceMs ?? 1_000);
      grace.unref();
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      stdout.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    });

    child.on('error', (error) => {
      // spawn 뒤의 오류 (ENOENT는 여기로 온다). 결과로 적고 닫는다.
      spawnError = error.message;
      if (outcome === 'exited') outcome = 'spawn_failed';
      finish(null, null);
    });

    child.on('close', (code, signal) => {
      finish(code, signal);
    });

    const timeout = setTimeout(() => terminate('timed_out'), request.timeoutMs);
    timeout.unref();
    timers.push(timeout as unknown as NodeJS.Timeout);

    if (request.shouldCancel !== undefined) {
      const poll = setInterval(() => {
        void request.shouldCancel?.().then((cancel) => {
          if (cancel) terminate('cancelled');
        }).catch(() => undefined);
      }, request.cancelPollMs ?? 500);
      poll.unref();
      timers.push(poll);
    }

    if (request.onHeartbeat !== undefined) {
      const beat = setInterval(() => {
        void request.onHeartbeat?.().catch(() => undefined);
      }, request.heartbeatMs ?? 5_000);
      beat.unref();
      timers.push(beat);
    }
  });
}
