/**
 * 고정 `gh` 바이너리에서 인벤토리를 뽑는다 (FR-GH-001 AC-1, WP-045 `gh:inventory`).
 *
 * `gh --help`부터 시작해 `COMMANDS` 절의 항목마다 `gh <path> --help`를 실행하고,
 * 그룹이면 내려간다. **Node 전용이다** — 파서(`help-parse.ts`)는 순수하고 여기는
 * 프로세스를 띄운다.
 *
 * 실행 환경은 실행기의 것과 같은 규율로 잠근다: 프롬프트·갱신 알림·색상 끄기,
 * 임시 `HOME`·`GH_CONFIG_DIR`. `--help`는 네트워크를 쓰지 않지만 토큰도 주지 않는다.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHelp, type ParsedCommandListing } from './help-parse.js';
import { parseGhVersionOutput } from './pin.js';
import type { GhInventory, GhInventoryCommand } from './types.js';

export interface InventoryOptions {
  readonly binaryPath: string;
  /** 시험이 특정 서브트리만 뽑을 때. 생략하면 전체다. */
  readonly onlyPaths?: readonly (readonly string[])[];
  readonly timeoutMs?: number;
}

function helpEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    GH_CONFIG_DIR: join(home, 'config'),
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
    CLICOLOR: '0',
    TERM: 'dumb',
    GH_PAGER: '',
  };
}

/** 공식 exit code: 4는 「인증이 필요하다」다 (`gh help exit-codes`). */
const EXIT_AUTH_REQUIRED = 4;

type HelpOutcome = { readonly status: 'ok'; readonly output: string } | { readonly status: 'auth_required' };

function runHelp(binaryPath: string, path: readonly string[], home: string, timeoutMs: number): HelpOutcome {
  const result = spawnSync(binaryPath, [...path, '--help'], {
    env: helpEnv(home),
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error !== undefined) throw new Error(`gh ${path.join(' ')} --help 실행 실패: ${result.error.message}`);
  // `gh extension exec --help`는 토큰 없이 4를 낸다 (2.97.0 실측). 그 사실을 인벤토리에 남긴다.
  if (result.status === EXIT_AUTH_REQUIRED) return { status: 'auth_required' };
  // cobra는 help를 stdout에 낸다. 그 밖의 비정상 종료는 모르는 상황이므로 멈춘다.
  if (result.status !== 0) {
    throw new Error(`gh ${path.join(' ')} --help가 종료 코드 ${String(result.status)}를 냈다: ${result.stderr.slice(0, 200)}`);
  }
  return { status: 'ok', output: result.stdout };
}

function requireHelp(binaryPath: string, path: readonly string[], home: string, timeoutMs: number): string {
  const outcome = runHelp(binaryPath, path, home, timeoutMs);
  if (outcome.status !== 'ok') throw new Error(`gh ${path.join(' ')} --help가 인증을 요구한다`);
  return outcome.output;
}

/**
 * `runHelp`의 비동기 판 — 이벤트 루프를 막지 않는다 (독립 검토 나, major).
 *
 * 실행기의 주기 검사(JOB-GH-003)는 실행 중인 gh와 같은 프로세스에서 돈다. `spawnSync`를 229번
 * 연달아 부르면 20~30초 동안 하트비트·취소 폴링·stdout 소비·`/healthz`가 멈추고, 큰 출력의 실행은
 * 파이프가 차서 `timed_out`될 수 있다. 그래서 실행기는 이쪽을 쓴다. 판정 규칙은 동기 판과 같다.
 */
function runHelpAsync(binaryPath: string, path: readonly string[], home: string, timeoutMs: number): Promise<HelpOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, [...path, '--help'], { env: helpEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`gh ${path.join(' ')} --help 실행 실패: ${String(timeoutMs)}ms 시간 초과`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`gh ${path.join(' ')} --help 실행 실패: ${error.message}`));
    });
    child.on('close', (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (status === EXIT_AUTH_REQUIRED) {
        resolve({ status: 'auth_required' });
        return;
      }
      if (status !== 0) {
        reject(new Error(`gh ${path.join(' ')} --help가 종료 코드 ${String(status)}를 냈다: ${Buffer.concat(stderr).toString('utf8').slice(0, 200)}`));
        return;
      }
      resolve({ status: 'ok', output: Buffer.concat(stdout).toString('utf8') });
    });
  });
}

/** 동시에 띄우는 `--help` 프로세스 수. CPU 넷을 다 쓰지 않으면서 27초를 8초쯤으로 줄인다. */
const HELP_CONCURRENCY = 4;

/** 코드 단위 비교 — `localeCompare`는 로케일에 따라 순서가 달라 인벤토리 해시가 환경에 묶인다 (독립 검토 나). */
function byPath(a: GhInventoryCommand, b: GhInventoryCommand): number {
  const left = a.path.join(' ');
  const right = b.path.join(' ');
  return left < right ? -1 : left > right ? 1 : 0;
}

/** `gh --version`으로 실제 버전을 읽는다. */
export function readGhVersion(binaryPath: string, timeoutMs = 10_000): string {
  const home = mkdtempSync(join(tmpdir(), 'prs-gh-inventory-'));
  try {
    const result = spawnSync(binaryPath, ['--version'], {
      env: helpEnv(home),
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error !== undefined) throw new Error(`gh --version 실행 실패: ${result.error.message}`);
    const version = parseGhVersionOutput(result.stdout);
    if (version === null) throw new Error(`gh --version 출력을 읽지 못했다: ${result.stdout.slice(0, 80)}`);
    return version;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * 인벤토리를 뽑는다. 결과는 path 사전순이라 같은 바이너리는 같은 배열을 낸다.
 */
export function extractInventory(options: InventoryOptions): GhInventory {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const home = mkdtempSync(join(tmpdir(), 'prs-gh-inventory-'));
  const commands: GhInventoryCommand[] = [];

  try {
    const ghVersion = readGhVersion(options.binaryPath, timeoutMs);
    const root = parseHelp(requireHelp(options.binaryPath, [], home, timeoutMs));

    const visit = (path: readonly string[], listing: ParsedCommandListing): void => {
      if (options.onlyPaths !== undefined && !options.onlyPaths.some((only) => only.slice(0, path.length).join(' ') === path.join(' ') || path.slice(0, only.length).join(' ') === only.join(' '))) {
        return;
      }
      if (listing.aliasOf !== null) {
        commands.push({
          path,
          aliases: [],
          summary: listing.summary,
          usage: '',
          group: false,
          section: listing.section,
          flags: [],
          jsonFields: [],
          aliasOf: listing.aliasOf,
          helpStatus: 'ok',
        });
        return;
      }
      const outcome = runHelp(options.binaryPath, path, home, timeoutMs);
      if (outcome.status === 'auth_required') {
        commands.push({
          path,
          aliases: [],
          summary: listing.summary,
          usage: '',
          group: false,
          section: listing.section,
          flags: [],
          jsonFields: [],
          aliasOf: null,
          helpStatus: 'auth_required',
        });
        return;
      }
      const help = parseHelp(outcome.output);
      const group = help.subcommands.length > 0;
      commands.push({
        path,
        aliases: help.aliases,
        summary: listing.summary,
        usage: help.usage,
        group,
        section: listing.section,
        flags: help.flags,
        jsonFields: help.jsonFields,
        aliasOf: null,
        helpStatus: 'ok',
      });
      for (const child of help.subcommands) visit([...path, child.name], child);
    };

    for (const child of root.subcommands) visit([child.name], child);

    commands.sort(byPath);
    return { ghVersion, commands, helpTopics: root.helpTopics };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** `readGhVersion`의 비동기 판. */
export async function readGhVersionAsync(binaryPath: string, timeoutMs = 10_000): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), 'prs-gh-inventory-'));
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(binaryPath, ['--version'], { env: helpEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`gh --version 실행 실패: ${String(timeoutMs)}ms 시간 초과`));
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`gh --version 실행 실패: ${error.message}`));
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    const version = parseGhVersionOutput(output);
    if (version === null) throw new Error(`gh --version 출력을 읽지 못했다: ${output.slice(0, 80)}`);
    return version;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * `extractInventory`의 비동기 판 — 같은 결과(같은 정렬·같은 해시)를 내되 이벤트 루프를 막지 않는다.
 * 트리를 동시 `HELP_CONCURRENCY`개로 내려간다. 순서는 끝에서 정렬하므로 방문 순서는 결과에 없다.
 */
export async function extractInventoryAsync(options: InventoryOptions): Promise<GhInventory> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const home = mkdtempSync(join(tmpdir(), 'prs-gh-inventory-'));
  const commands: GhInventoryCommand[] = [];
  let active = 0;
  const waiters: (() => void)[] = [];
  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < HELP_CONCURRENCY) {
        active += 1;
        resolve();
      } else {
        waiters.push(() => {
          active += 1;
          resolve();
        });
      }
    });
  const release = (): void => {
    active -= 1;
    waiters.shift()?.();
  };

  try {
    const ghVersion = await readGhVersionAsync(options.binaryPath, timeoutMs);
    const rootOutcome = await runHelpAsync(options.binaryPath, [], home, timeoutMs);
    if (rootOutcome.status !== 'ok') throw new Error('gh --help가 인증을 요구한다');
    const root = parseHelp(rootOutcome.output);

    const visit = async (path: readonly string[], listing: ParsedCommandListing): Promise<void> => {
      if (options.onlyPaths !== undefined && !options.onlyPaths.some((only) => only.slice(0, path.length).join(' ') === path.join(' ') || path.slice(0, only.length).join(' ') === only.join(' '))) {
        return;
      }
      if (listing.aliasOf !== null) {
        commands.push({ path, aliases: [], summary: listing.summary, usage: '', group: false, section: listing.section, flags: [], jsonFields: [], aliasOf: listing.aliasOf, helpStatus: 'ok' });
        return;
      }
      await acquire();
      let outcome: HelpOutcome;
      try {
        outcome = await runHelpAsync(options.binaryPath, path, home, timeoutMs);
      } finally {
        release();
      }
      if (outcome.status === 'auth_required') {
        commands.push({ path, aliases: [], summary: listing.summary, usage: '', group: false, section: listing.section, flags: [], jsonFields: [], aliasOf: null, helpStatus: 'auth_required' });
        return;
      }
      const help = parseHelp(outcome.output);
      const group = help.subcommands.length > 0;
      commands.push({ path, aliases: help.aliases, summary: listing.summary, usage: help.usage, group, section: listing.section, flags: help.flags, jsonFields: help.jsonFields, aliasOf: null, helpStatus: 'ok' });
      await Promise.all(help.subcommands.map((child) => visit([...path, child.name], child)));
    };

    await Promise.all(root.subcommands.map((child) => visit([child.name], child)));
    commands.sort(byPath);
    return { ghVersion, commands, helpTopics: root.helpTopics };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * 커밋된 인벤토리와 실제 바이너리의 차이 (WP-045 `gh:diff-capabilities`, JOB-GH-003).
 *
 * command path와 flag 이름·JSON 필드 집합을 대조한다. 설명 문구의 차이는 드리프트로
 * 세지 않는다 — 실행 가능성을 바꾸지 않기 때문이다.
 */
export interface InventoryDiff {
  readonly addedCommands: readonly string[];
  readonly removedCommands: readonly string[];
  readonly changedCommands: readonly string[];
}

function signature(command: GhInventoryCommand): string {
  return JSON.stringify({
    group: command.group,
    aliasOf: command.aliasOf,
    helpStatus: command.helpStatus,
    flags: command.flags.map((flag) => [flag.name, flag.short, flag.valueType, flag.inherited, flag.repeatable]).sort(),
    jsonFields: [...command.jsonFields].sort(),
  });
}

export function diffInventory(committed: GhInventory, actual: GhInventory): InventoryDiff {
  const left = new Map(committed.commands.map((command) => [command.path.join(' '), command]));
  const right = new Map(actual.commands.map((command) => [command.path.join(' '), command]));
  const addedCommands = [...right.keys()].filter((key) => !left.has(key)).sort();
  const removedCommands = [...left.keys()].filter((key) => !right.has(key)).sort();
  const changedCommands = [...left.keys()]
    .filter((key) => right.has(key) && signature(left.get(key)!) !== signature(right.get(key)!))
    .sort();
  return { addedCommands, removedCommands, changedCommands };
}
