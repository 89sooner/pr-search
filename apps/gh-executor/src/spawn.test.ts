/**
 * 프로세스 제어 (FR-GH-006 AC-3·AC-4·AC-5, NFR-011, WP-047 DoD).
 *
 * **실제 자식 프로세스를 띄운다.** `node -e`로 gh를 흉내 낸 스크립트를 돌려 시간 상한·
 * 취소·출력 상한·프로세스 그룹 종료가 실제 OS에서 성립하는지 본다. 실제 gh 바이너리
 * 경로는 통합 시험(`integration/executor.test.ts`)이 본다.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runGhProcess } from './spawn.js';

const NODE = process.execPath;
const cwd = mkdtempSync(join(tmpdir(), 'prs-spawn-test-'));
afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const base = {
  binaryPath: NODE,
  env: { PATH: process.env['PATH'] ?? '' },
  cwd,
  timeoutMs: 10_000,
  stdoutLimitBytes: 4_096,
  stderrLimitBytes: 1_024,
};

/** 자식이 손자를 띄우고 둘 다 SIGTERM을 무시하게 하는 스크립트. 그룹 종료를 시험한다. */
const STUBBORN = `
process.on('SIGTERM', () => {});
const { spawn } = require('node:child_process');
const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{}, 1000)"], { stdio: 'inherit' });
process.stdout.write(String(grandchild.pid) + '\\n');
setInterval(() => {}, 1000);
`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('FR-GH-006 AC-4: 시간 상한', () => {
  it('상한을 넘기면 timed_out이고 프로세스 그룹(손자 포함)이 3초 안에 죽는다', async () => {
    const started = Date.now();
    const result = await runGhProcess({ ...base, argv: ['-e', STUBBORN], timeoutMs: 500, killGraceMs: 300 });
    expect(result.outcome).toBe('timed_out');
    expect(Date.now() - started).toBeLessThan(3_500);
    const grandchildPid = Number(result.stdout.text.trim());
    expect(Number.isSafeInteger(grandchildPid)).toBe(true);
    // SIGKILL 직후 좀비 회수까지 잠깐 걸릴 수 있다.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alive(grandchildPid)).toBe(false);
  }, 10_000);
});

describe('FR-GH-006 AC-3: 취소', () => {
  it('취소 요청이 오면 cancelled이고 그룹이 종료된다', async () => {
    let cancel = false;
    setTimeout(() => {
      cancel = true;
    }, 300);
    const result = await runGhProcess({
      ...base,
      argv: ['-e', STUBBORN],
      shouldCancel: async () => cancel,
      cancelPollMs: 50,
      killGraceMs: 200,
    });
    expect(result.outcome).toBe('cancelled');
    expect(result.exitCode).toBeNull();
  }, 10_000);
});

describe('FR-GH-006 AC-5: 출력 상한', () => {
  it('stdout이 상한을 넘으면 절단 표시와 함께 잘리고 원본 해시는 전체를 잰다', async () => {
    const result = await runGhProcess({
      ...base,
      argv: ['-e', "process.stdout.write('x'.repeat(10000))"],
      stdoutLimitBytes: 100,
    });
    expect(result.outcome).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.truncated).toBe(true);
    expect(result.stdout.text).toHaveLength(100);
    expect(result.stdout.bytesTotal).toBe(10_000);
    // 해시는 무해화·절단 전 원본 전체다.
    const expected = spawnSync('sh', ['-c', "printf 'x%.0s' $(seq 1 10000) | sha256sum | cut -d' ' -f1"], { encoding: 'utf8' }).stdout.trim();
    expect(result.stdoutSha256).toBe(expected);
  });

  it('ANSI·제어 문자가 섞인 stderr가 무해화된다', async () => {
    const result = await runGhProcess({
      ...base,
      argv: ['-e', "process.stderr.write('warn \\u001b[31mred\\u001b[0m\\u0007 done'); process.exit(1)"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.text).toBe('warn red done');
  });
});

describe('NFR-010: shell을 거치지 않는다', () => {
  it('argv의 메타문자가 그대로 인자다 — 파일이 생기지 않고 명령이 해석되지 않는다', async () => {
    const marker = join(cwd, 'pwned');
    const result = await runGhProcess({
      ...base,
      argv: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', `; touch ${marker}; $(id) \`id\` | cat`],
    });
    expect(result.outcome).toBe('exited');
    expect(JSON.parse(result.stdout.text)).toEqual([`; touch ${marker}; $(id) \`id\` | cat`]);
    expect(spawnSync('test', ['-e', marker]).status).not.toBe(0);
  });

  it('없는 바이너리는 spawn_failed로 답하고 던지지 않는다', async () => {
    const result = await runGhProcess({ ...base, binaryPath: join(cwd, 'no-such-gh'), argv: [] });
    expect(result.outcome).toBe('spawn_failed');
    expect(result.spawnError).toMatch(/ENOENT/);
  });

  it('부모 환경을 상속하지 않는다 — 준 env만 보인다', async () => {
    process.env['PRS_LEAK_TEST'] = 'leaked';
    const result = await runGhProcess({
      ...base,
      env: { PATH: process.env['PATH'] ?? '', MARK: '1' },
      argv: ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))'],
    });
    delete process.env['PRS_LEAK_TEST'];
    expect(JSON.parse(result.stdout.text)).toEqual(['MARK', 'PATH']);
  });
});
