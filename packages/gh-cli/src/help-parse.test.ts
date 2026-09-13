/**
 * help 파서 (FR-GH-001 AC-1·AC-7, WP-045).
 *
 * 픽스처는 고정 gh 2.97.0의 실제 `--help` 출력이다 (`testing/fixtures/help/`).
 * 바이너리 없이 도는 이 시험이 파서 회귀를 잡는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFlagLine, parseHelp, splitHelpSections } from './help-parse.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../testing/fixtures/help/${name}.txt`, import.meta.url)), 'utf8');

describe('FR-GH-001 AC-1: 루트 help에서 command 목록을 뽑는다', () => {
  const root = parseHelp(fixture('root'));

  it('COMMANDS로 끝나는 절 전부에서 이름·설명·절을 읽는다', () => {
    const names = root.subcommands.map((command) => command.name);
    expect(names).toEqual(expect.arrayContaining(['pr', 'repo', 'run', 'api', 'extension', 'co']));
    expect(root.subcommands.find((command) => command.name === 'pr')?.section).toBe('CORE COMMANDS');
    expect(root.subcommands.find((command) => command.name === 'run')?.section).toBe('GITHUB ACTIONS COMMANDS');
    expect(root.subcommands.find((command) => command.name === 'api')?.section).toBe('ADDITIONAL COMMANDS');
  });

  it('AC-7: 별칭 전용 노드를 command와 구분한다 — `co`는 `pr checkout`의 별칭이다', () => {
    const co = root.subcommands.find((command) => command.name === 'co');
    expect(co?.aliasOf).toEqual(['pr', 'checkout']);
    expect(root.subcommands.find((command) => command.name === 'pr')?.aliasOf).toBeNull();
  });

  it('HELP TOPICS는 command가 아니라 따로 센다', () => {
    expect(root.helpTopics).toEqual(expect.arrayContaining(['environment', 'exit-codes', 'formatting']));
    expect(root.subcommands.map((command) => command.name)).not.toContain('environment');
  });
});

describe('FR-GH-001 AC-1·AC-7: leaf help에서 flag·별칭·JSON 필드를 뽑는다', () => {
  const prList = parseHelp(fixture('pr-list'));

  it('USAGE와 ALIASES를 읽는다', () => {
    expect(prList.usage).toBe('gh pr list [flags]');
    expect(prList.aliases).toEqual(['pr ls']);
    expect(prList.subcommands).toEqual([]);
  });

  it('command 고유 flag와 inherited flag를 구분한다', () => {
    const state = prList.flags.find((flag) => flag.name === 'state');
    expect(state).toMatchObject({ short: 's', valueType: 'string', inherited: false, defaultValue: 'open' });
    const repo = prList.flags.find((flag) => flag.name === 'repo');
    expect(repo).toMatchObject({ short: 'R', valueType: '[HOST/]OWNER/REPO', inherited: true });
    expect(prList.flags.find((flag) => flag.name === 'help')?.inherited).toBe(true);
  });

  it('bool flag는 값 타입이 없고, `strings`는 반복 가능이다', () => {
    expect(prList.flags.find((flag) => flag.name === 'draft')).toMatchObject({ valueType: null, repeatable: false });
    expect(prList.flags.find((flag) => flag.name === 'label')).toMatchObject({ valueType: 'strings', repeatable: true });
    expect(prList.flags.find((flag) => flag.name === 'limit')).toMatchObject({ valueType: 'int', defaultValue: '30' });
  });

  it('JSON FIELDS를 줄바꿈 너머까지 모은다 (AC-9)', () => {
    expect(prList.jsonFields).toContain('number');
    expect(prList.jsonFields).toContain('updatedAt');
    expect(prList.jsonFields).toContain('statusCheckRollup');
    expect(prList.jsonFields).toHaveLength(46);
  });

  it('그룹 help는 하위 command를 갖고 JSON 필드는 없다', () => {
    const pr = parseHelp(fixture('pr'));
    expect(pr.subcommands.map((command) => command.name)).toEqual(expect.arrayContaining(['list', 'merge', 'view']));
    expect(pr.jsonFields).toEqual([]);
  });
});

describe('flag 줄 파싱의 경계', () => {
  it('설명이 없는 줄도 flag다', () => {
    expect(parseFlagLine('      --no-upstream', false)).toMatchObject({ name: 'no-upstream', valueType: null, description: '' });
  });

  it('설명에 공백이 세 칸 미만이면 값 타입으로 오해하지 않는다', () => {
    const flag = parseFlagLine('  -u, --upstream-remote-name string   Upstream remote name when cloning a fork (default "upstream")', false);
    expect(flag).toMatchObject({ name: 'upstream-remote-name', valueType: 'string', defaultValue: 'upstream' });
  });

  it('flag 줄이 아니면 null이다', () => {
    expect(parseFlagLine('  gh pr list [flags]', false)).toBeNull();
    expect(parseFlagLine('FLAGS', false)).toBeNull();
  });

  it('절 이름은 열 0의 대문자 줄이다 — 본문의 대문자 단어에 속지 않는다', () => {
    const { sections } = splitHelpSections('설명 JSON 어쩌고\n\nUSAGE\n  gh x\n\nFLAGS\n  --a   b\n');
    expect(sections.map((section) => section.name)).toEqual(['USAGE', 'FLAGS']);
  });
});
