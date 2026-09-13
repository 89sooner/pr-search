/**
 * `gh <path> --help` 출력 파서 (FR-GH-001 AC-1·AC-7, WP-045).
 *
 * **순수 함수다.** 바이너리를 부르는 쪽은 `inventory.ts`(Node 전용)이고, 여기는
 * 텍스트만 받는다 — 그래야 캡처한 help 출력으로 파서를 시험하고, 바이너리 없이
 * 도는 단위 시험이 파서 회귀를 잡는다.
 *
 * ## cobra help의 모양 (gh 2.97.0 실측)
 *
 * ```text
 * <긴 설명 문단>
 *
 * USAGE
 *   gh pr list [flags]
 *
 * ALIASES
 *   gh pr ls
 *
 * FLAGS
 *       --app string        Filter by GitHub App author
 *   -s, --state string      Filter by state: {open|closed|merged|all} (default "open")
 *   -d, --draft             Filter by draft state
 *
 * INHERITED FLAGS
 *   -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format
 *
 * JSON FIELDS
 *   additions, assignees, author, ...
 * ```
 *
 * 절 이름은 열 0의 대문자 줄이다. command 목록은 `  name:  설명` 줄이며 절 이름이
 * `COMMANDS`로 끝난다. `ALIAS COMMANDS` 절은 별칭 전용 노드(`co: Alias for "pr checkout"`)다.
 * 열이 정렬돼 있어 flag 명세와 설명 사이에는 공백이 **세 칸 이상** 있다.
 */

import type { GhInventoryFlag } from './types.js';

export interface ParsedHelpSection {
  readonly name: string;
  readonly lines: readonly string[];
}

export interface ParsedCommandListing {
  readonly name: string;
  readonly summary: string;
  readonly section: string;
  /** `Alias for "pr checkout"` 에서 뽑은 대상. 별칭 전용 노드가 아니면 `null`. */
  readonly aliasOf: readonly string[] | null;
}

export interface ParsedHelp {
  readonly description: string;
  readonly usage: string;
  readonly aliases: readonly string[];
  readonly flags: readonly GhInventoryFlag[];
  readonly jsonFields: readonly string[];
  readonly subcommands: readonly ParsedCommandListing[];
  readonly helpTopics: readonly string[];
  readonly sections: readonly ParsedHelpSection[];
}

const SECTION_HEADER = /^[A-Z][A-Z ]+$/;

/** 절 단위로 자른다. 첫 절 이전의 문단이 설명이다. */
export function splitHelpSections(output: string): { description: string; sections: ParsedHelpSection[] } {
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  const sections: { name: string; lines: string[] }[] = [];
  const description: string[] = [];
  let current: { name: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (SECTION_HEADER.test(line)) {
      current = { name: line.trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current === null) description.push(line);
    else current.lines.push(line);
  }

  return { description: description.join('\n').trim(), sections };
}

const ALIAS_OF = /^Alias for "([^"]+)"$/;

function parseCommandListing(section: ParsedHelpSection): ParsedCommandListing[] {
  const out: ParsedCommandListing[] = [];
  for (const raw of section.lines) {
    const match = /^ {2}([a-z][a-z0-9-]*):\s+(.*)$/.exec(raw);
    if (match === null) continue;
    const name = match[1] ?? '';
    const summary = (match[2] ?? '').trim();
    const alias = ALIAS_OF.exec(summary);
    out.push({
      name,
      summary,
      section: section.name,
      aliasOf: alias?.[1] === undefined ? null : alias[1].split(/\s+/),
    });
  }
  return out;
}

/** 반복 가능 flag의 cobra 값 타입. */
const REPEATABLE_TYPES: ReadonlySet<string> = new Set(['strings', 'stringArray', 'stringSlice', 'stringToString']);

/**
 * flag 줄 하나를 읽는다.
 *
 * 형식은 `  [-x, ]--name [값타입]   설명`이다. 값 타입은 설명 앞 공백 세 칸 이전의
 * 마지막 토큰인데, bool flag는 그 토큰이 없다. 설명이 아예 없는 줄(가장 긴 flag가
 * 설명 없이 끝나는 경우)도 받는다.
 */
export function parseFlagLine(raw: string, inherited: boolean): GhInventoryFlag | null {
  const match = /^ {2,}(?:-([A-Za-z0-9]), )?--([A-Za-z0-9][A-Za-z0-9-]*)(.*)$/.exec(raw);
  if (match === null) return null;
  const short = match[1] ?? null;
  const name = match[2] ?? '';
  const rest = match[3] ?? '';

  // 명세와 설명의 경계는 공백 세 칸 이상이다. 그 앞이 값 타입, 뒤가 설명이다.
  const split = /\s{3,}/.exec(rest);
  const spec = (split === null ? rest : rest.slice(0, split.index)).trim();
  const description = (split === null ? '' : rest.slice(split.index + split[0].length)).trim();

  const valueType = spec === '' ? null : spec;
  const defaultMatch = /\(default (.+?)\)\s*$/.exec(description);
  const defaultValue = defaultMatch?.[1] === undefined ? null : defaultMatch[1].replace(/^"|"$/g, '');

  return {
    name,
    short,
    valueType,
    description,
    defaultValue,
    repeatable: valueType !== null && REPEATABLE_TYPES.has(valueType),
    inherited,
  };
}

function parseFlags(section: ParsedHelpSection | undefined, inherited: boolean): GhInventoryFlag[] {
  if (section === undefined) return [];
  const out: GhInventoryFlag[] = [];
  for (const line of section.lines) {
    const flag = parseFlagLine(line, inherited);
    if (flag !== null) out.push(flag);
  }
  return out;
}

function parseJsonFields(section: ParsedHelpSection | undefined): string[] {
  if (section === undefined) return [];
  const joined = section.lines.map((line) => line.trim()).filter((line) => line !== '').join(' ');
  return joined
    .split(',')
    .map((field) => field.trim())
    .filter((field) => /^[A-Za-z][A-Za-z0-9]*$/.test(field));
}

function parseAliases(section: ParsedHelpSection | undefined): string[] {
  if (section === undefined) return [];
  return section.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('gh '))
    .map((line) => line.slice(3).trim());
}

export function parseHelp(output: string): ParsedHelp {
  const { description, sections } = splitHelpSections(output);
  const byName = new Map(sections.map((section) => [section.name, section]));

  const usage = (byName.get('USAGE')?.lines ?? []).map((line) => line.trim()).find((line) => line !== '') ?? '';

  const subcommands: ParsedCommandListing[] = [];
  for (const section of sections) {
    if (section.name.endsWith('COMMANDS')) subcommands.push(...parseCommandListing(section));
  }

  const helpTopics = parseCommandListing(byName.get('HELP TOPICS') ?? { name: 'HELP TOPICS', lines: [] }).map(
    (topic) => topic.name,
  );

  return {
    description,
    usage,
    aliases: parseAliases(byName.get('ALIASES')),
    flags: [...parseFlags(byName.get('FLAGS'), false), ...parseFlags(byName.get('INHERITED FLAGS'), true)],
    jsonFields: parseJsonFields(byName.get('JSON FIELDS')),
    subcommands,
    helpTopics,
    sections,
  };
}
