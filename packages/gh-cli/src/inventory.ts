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

import { spawnSync } from 'node:child_process';
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

    commands.sort((a, b) => a.path.join(' ').localeCompare(b.path.join(' ')));
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
