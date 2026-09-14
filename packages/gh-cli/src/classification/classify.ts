/**
 * 인벤토리 command 하나 → 분류 (FR-GH-001 AC-2·AC-3·AC-8·AC-9, WP-045 / CR-088).
 *
 * **순수 함수이고 결정적이다.** 같은 인벤토리 command는 언제나 같은 분류를 낸다 — 검증기가
 * 저장된 manifest의 분류를 여기서 다시 만들어 대조한다(생성기 드리프트·손 편집 검출).
 * 시각·경로·환경을 읽지 않는다.
 *
 * command 수준(지원·interaction·위험·부작용·결과)은 사람이 적은 표(`commands.ts`)가, flag·
 * positional 수준은 규칙(`rules.ts`)이 정한다. 표에 행이 없는 leaf는 **`unknown`으로 남는다** —
 * 그 수가 곧 미분류 수다.
 */

import type {
  GhCommandClassification,
  GhFlagClassification,
  GhInventoryCommand,
  GhOutputFormat,
  GhPositionalClassification,
} from '../types.js';
import { COMMAND_ROWS, type CommandRow } from './commands.js';
import { classifyResult } from './results.js';
import { classifyFlag, classifyPositional, parseUsagePositionals, type FlagClassificationOutcome } from './rules.js';

const COMMAND_TABLE_RULE = 'commands-table';

function flagsOf(command: GhInventoryCommand): { readonly flags: GhFlagClassification[]; readonly outcomes: FlagClassificationOutcome[] } {
  const outcomes = command.flags.map((flag) => classifyFlag(flag, command.path));
  const flags = command.flags.map((flag, index) => {
    const outcome = outcomes[index]!;
    return {
      name: flag.name,
      inherited: flag.inherited,
      control: outcome.control,
      valueKind: outcome.valueKind,
      enumValues: outcome.enumValues,
      secretInput: outcome.secretInput,
      basis: outcome.basis,
    };
  });
  return { flags, outcomes };
}

function positionalsOf(command: GhInventoryCommand): GhPositionalClassification[] {
  return parseUsagePositionals(command.usage, command.path).map((positional) => {
    const outcome = classifyPositional(positional);
    return {
      placeholder: positional.placeholder,
      required: positional.required,
      variadic: positional.variadic,
      control: outcome.control,
      binding: outcome.binding,
      basis: outcome.basis,
    };
  });
}

/**
 * 출력 모드. **JSON 출력은 JSON FIELDS 절(`--json <fields>`) 또는 `--format {json}`이 있을 때만이다** — `workflow run --json`은
 * 「Read workflow inputs as JSON via STDIN」인 입력 flag라 출력 모드가 아니다(CR-089 정정, SRS의 `--json` 41 vs 40의 출처).
 * 파일로 쓰는 flag가 있으면 `file`, `--watch`가 있으면 `stream` 모드가 더해진다.
 */
function outputFormatsOf(command: GhInventoryCommand, row: CommandRow | undefined, fileOutputFlags: readonly string[]): GhOutputFormat[] {
  const names = new Set(command.flags.map((flag) => flag.name));
  const formats: GhOutputFormat[] = [];
  const push = (format: GhOutputFormat): void => {
    if (!formats.includes(format)) formats.push(format);
  };
  const jsonFields = command.jsonFields.length > 0;
  const formatJson = command.flags.some((flag) => !flag.inherited && flag.name === 'format' && /\{[^{}]*\bjson\b[^{}]*\}/.test(flag.description));
  if (row?.result === 'stream') push('stream');
  else if (row?.result === 'artifact') push('file');
  else if (row?.result === 'json' && !jsonFields && !formatJson) push('json');
  else push('text');
  if (jsonFields || formatJson) push('json');
  if (names.has('jq')) push('jq');
  /*
   * 출력 템플릿은 JSON 출력이 있을 때만이다 — gh는 `--template`을 `--json`·`--format json`과 함께만 붙인다
   * (pkg/cmdutil/json_flags.go:45-50·148-150). `pr create`·`issue create`의 `--template`은 본문 틀을, `repo create`의 것은
   * 틀 저장소를 고르는 **입력**이다 (CR-089 정정).
   */
  if (names.has('template') && (jsonFields || formatJson || row?.result === 'json')) push('template');
  if (names.has('web')) push('web');
  if (names.has('watch') && row?.result !== 'stream') push('stream');
  if (fileOutputFlags.length > 0) push('file');
  return formats;
}

function notesOf(command: GhInventoryCommand, outcomes: readonly FlagClassificationOutcome[]): string[] {
  const notes: string[] = [];
  const names = command.flags.map((flag) => flag.name);
  if (names.includes('web')) notes.push('`--web`은 브라우저를 연다 — 실행기에서는 열 수 없고 웹 등가(URL)로만 표현한다 (ADR-019)');
  const approval = command.flags.filter((_, index) => outcomes[index]?.control === 'requires_admin_approval').map((flag) => `--${flag.name}`);
  if (approval.length > 0) notes.push(`${approval.join('·')}은(는) 확인을 건너뛰거나 보호를 넘는다 — 관리자 승인 경로가 있어야 연다 (FR-GH-009)`);
  const blocked = command.flags.filter((_, index) => outcomes[index]?.control === 'policy_blocked').map((flag) => `--${flag.name}`);
  if (blocked.length > 0) notes.push(`${blocked.join('·')}은(는) 자격·셸을 다룬다 — 이 제품은 열지 않는다`);
  const artifacts = command.flags.filter((_, index) => outcomes[index]?.basis.rule === 'help-placeholder-artifact').map((flag) => `--${flag.name}`);
  if (artifacts.length > 0) notes.push(`${artifacts.join('·')}의 값 자리에 help가 다른 flag 이름을 적었다 — bool로 읽었다 (gh 2.97.0 원문)`);
  const secrets = command.flags.filter((_, index) => outcomes[index]?.secretInput === true).map((flag) => `--${flag.name}`);
  if (secrets.length > 0) notes.push(`${secrets.join('·')}의 값은 비밀 그 자체다 — argv 미리보기·로그·이력에 실으면 안 된다 (FR-GH-008 AC-7의 규율)`);
  const terminalFlags = command.flags.filter((_, index) => outcomes[index]?.control === 'terminal_only').map((flag) => `--${flag.name}`);
  if (terminalFlags.length > 0) notes.push(`${terminalFlags.join('·')}은(는) 로컬 작업 트리·편집기·클립보드가 필요하다 — 실행기에서는 열 수 없다`);
  if (command.helpStatus === 'auth_required') notes.push('`--help`가 인증을 요구해(종료 4) flag·positional을 뽑지 못했다 (DEV-653)');
  return notes;
}

/**
 * leaf command의 분류. 그룹과 별칭 전용 노드는 `null`이다 — 실행 대상이 아니다.
 */
export function classifyCommand(command: GhInventoryCommand): GhCommandClassification | null {
  if (command.group || command.aliasOf !== null) return null;
  const key = command.path.join(' ');
  const row = COMMAND_ROWS[key];
  const { flags, outcomes } = flagsOf(command);
  const positionals = positionalsOf(command);
  const stdinFromUsage = positionals.some((positional) => positional.binding === 'stdin');
  const fileOutputFlags = command.flags.filter((_, index) => outcomes[index]?.fileRole === 'output').map((flag) => `--${flag.name}`);
  const io = {
    stdin: row?.stdin ?? (stdinFromUsage ? ('optional' as const) : ('none' as const)),
    fileInputFlags: command.flags.filter((_, index) => outcomes[index]?.fileRole === 'input').map((flag) => `--${flag.name}`),
    fileOutputFlags,
    outputFormats: outputFormatsOf(command, row, fileOutputFlags),
    contexts: row?.contexts ?? [],
    paginated: command.flags.some((flag) => flag.name === 'limit' || flag.name === 'paginate'),
  };

  if (row === undefined) {
    return {
      support: 'unknown',
      interaction: 'unknown',
      risk: null,
      sideEffect: 'unknown',
      auth: 'unknown',
      io,
      resultKind: 'unknown',
      sensitivity: 'unknown',
      hostSupport: 'unverified',
      positionals,
      flags,
      basis: { source: 'override', rule: COMMAND_TABLE_RULE, evidence: `분류 표에 행이 없다: ${key}` },
      notes: notesOf(command, outcomes),
      result: null,
    };
  }

  return {
    support: row.support,
    interaction: row.interaction,
    risk: row.risk,
    sideEffect: row.sideEffect,
    auth: row.auth,
    io,
    resultKind: row.result,
    sensitivity: row.sensitivity,
    hostSupport: 'unverified',
    positionals,
    flags,
    basis: { source: 'override', rule: COMMAND_TABLE_RULE, evidence: row.note },
    notes: notesOf(command, outcomes),
    result: classifyResult(command, row, io.outputFormats),
  };
}
