/**
 * 분류 규칙 (FR-GH-001 AC-3·AC-7·AC-9, NFR-009, WP-045 / CR-088).
 *
 * 규칙은 인벤토리 원문에서만 판정하고 근거를 남긴다. 여기서 거는 것은 **대표 의미 사례**다 —
 * 같은 값 타입이라도 이름이 뜻을 바꾸는 자리(`--web`·`--yes`·`--shell`), help 원문의 자리표시자
 * 특이 사례(`--force --hostname`), USAGE의 자리 해석(대안·반복·통과 인자·구분자), 그리고 결정성.
 * 기대값은 검증 대상 함수로 만들지 않고 손으로 적었다.
 */

import { describe, expect, it } from 'vitest';
import type { GhInventoryCommand, GhInventoryFlag } from '../types.js';
import { classifyCommand } from './classify.js';
import { classifyFlag, classifyPositional, enumValuesOf, parseUsagePositionals } from './rules.js';

const flag = (name: string, overrides: Partial<GhInventoryFlag> = {}): GhInventoryFlag => ({
  name,
  short: null,
  valueType: 'string',
  description: '',
  defaultValue: null,
  repeatable: false,
  inherited: false,
  ...overrides,
});

const command = (path: string[], overrides: Partial<GhInventoryCommand> = {}): GhInventoryCommand => ({
  path,
  aliases: [],
  summary: path.join(' '),
  usage: `gh ${path.join(' ')} [flags]`,
  group: false,
  section: 'CORE COMMANDS',
  flags: [],
  jsonFields: [],
  aliasOf: null,
  helpStatus: 'ok',
  ...overrides,
});

describe('flag 규칙 — 이름이 값 타입보다 먼저다', () => {
  it('`--web`은 bool이지만 웹 등가다', () => {
    const outcome = classifyFlag(flag('web', { valueType: null, description: 'Open in the browser' }));
    expect(outcome).toMatchObject({ control: 'mapped_to_web_equivalent', valueKind: 'bool' });
    expect(outcome.basis).toMatchObject({ source: 'rule', rule: 'web-flag' });
    expect(outcome.basis.evidence).toContain('--web');
  });

  it('`--yes`·`--force`·`--admin`·`--delete-branch`는 승인이 필요한 컨트롤이다', () => {
    for (const name of ['yes', 'force', 'admin', 'delete-branch', 'clobber']) {
      expect(classifyFlag(flag(name, { valueType: null })).control, name).toBe('requires_admin_approval');
    }
  });

  it('`--shell`·`--with-token`·`--show-token`은 정책 차단이고 `--editor`·`--clipboard`는 터미널 전용이다', () => {
    expect(classifyFlag(flag('shell', { valueType: null })).control).toBe('policy_blocked');
    expect(classifyFlag(flag('with-token', { valueType: null })).control).toBe('policy_blocked');
    expect(classifyFlag(flag('editor', { valueType: null })).control).toBe('terminal_only');
    expect(classifyFlag(flag('clipboard', { valueType: null })).control).toBe('terminal_only');
  });

  it('설명의 `{a|b|c}`는 열거 컨트롤이다 — 값 타입이 string이어도', () => {
    const outcome = classifyFlag(flag('state', { description: 'Filter by state: {open|closed|merged|all} (default "open")' }));
    expect(outcome).toMatchObject({ control: 'mapped_to_typed_control', valueKind: 'enum', enumValues: ['open', 'closed', 'merged', 'all'] });
    expect(enumValuesOf('no braces here')).toBeNull();
    expect(enumValuesOf('{single}')).toBeNull();
  });

  it('자원 선택자 이름과 값 타입은 typed, 자유 문자열·식·키=값은 generic이다', () => {
    expect(classifyFlag(flag('repo', { valueType: '[HOST/]OWNER/REPO', inherited: true }))).toMatchObject({ control: 'mapped_to_typed_control', valueKind: 'selector' });
    expect(classifyFlag(flag('assignee', { valueType: 'login' })).control).toBe('mapped_to_typed_control');
    expect(classifyFlag(flag('limit', { valueType: 'int' }))).toMatchObject({ control: 'mapped_to_typed_control', valueKind: 'int' });
    expect(classifyFlag(flag('created', { valueType: 'date' })).valueKind).toBe('date');
    expect(classifyFlag(flag('json', { valueType: 'fields' })).valueKind).toBe('fields');
    expect(classifyFlag(flag('jq', { valueType: 'expression' }))).toMatchObject({ control: 'mapped_to_generic_control', valueKind: 'expression' });
    expect(classifyFlag(flag('title'))).toMatchObject({ control: 'mapped_to_generic_control', valueKind: 'string' });
    expect(classifyFlag(flag('field', { valueType: 'key=value', repeatable: true }))).toMatchObject({ control: 'mapped_to_generic_control', valueKind: 'key_value' });
    expect(classifyFlag(flag('label', { valueType: 'strings', repeatable: true })).control).toBe('mapped_to_typed_control');
    expect(classifyFlag(flag('exclude', { valueType: 'patterns' }))).toMatchObject({ control: 'mapped_to_generic_control', valueKind: 'strings' });
  });

  it('파일을 읽거나 쓰는 flag는 그 역할을 남긴다', () => {
    expect(classifyFlag(flag('body-file', { valueType: 'file' }))).toMatchObject({ valueKind: 'file', fileRole: 'input' });
    expect(classifyFlag(flag('dir', { valueType: 'directory' }))).toMatchObject({ valueKind: 'file', fileRole: 'output' });
    expect(classifyFlag(flag('output', { valueType: 'path' })).fileRole).toBe('output');
  });

  it('gh 2.97.0의 help가 값 자리에 다른 flag 이름을 적은 bool은 bool로 읽고 그 사실을 남긴다', () => {
    const outcome = classifyFlag(flag('force', { valueType: '--hostname', description: 'Force setup even if the host is not known. Must be used in conjunction with --hostname' }));
    // `--force`는 이름 규칙(승인 필요)이 먼저다 — 값 타입 규칙에 닿지 않는다.
    expect(outcome.control).toBe('requires_admin_approval');
    const artifact = classifyFlag(flag('succeed-on-no-caches', { valueType: '--all', description: 'Return exit code 0 if no caches found. Must be used in conjunction with --all' }));
    expect(artifact).toMatchObject({ control: 'mapped_to_typed_control', valueKind: 'bool' });
    expect(artifact.basis.rule).toBe('help-placeholder-artifact');
  });

  it('이름 규칙이 틀리는 자리는 command별 판정이 먼저다 (독립 검토 가)', () => {
    // `repo sync --source`는 원격 저장소(generic)지만 `repo create --source`는 로컬 경로(terminal_only)다.
    expect(classifyFlag(flag('source'), ['repo', 'sync']).control).toBe('mapped_to_generic_control');
    expect(classifyFlag(flag('source'), ['repo', 'create'])).toMatchObject({ control: 'terminal_only', valueKind: 'file' });
    // help가 "(zip or tar.gz)"로 적은 열거 — 파일 출력이 아니라 typed enum이다.
    expect(classifyFlag(flag('archive', { valueType: 'format' }), ['release', 'download'])).toMatchObject({ control: 'mapped_to_typed_control', valueKind: 'enum', enumValues: ['zip', 'tar.gz'], fileRole: null });
    // 같은 `--dir`이라도 skill list는 스캔 입력, skill install은 출력이다.
    expect(classifyFlag(flag('dir', { valueType: 'directory' }), ['skill', 'list']).fileRole).toBe('input');
    expect(classifyFlag(flag('dir', { valueType: 'directory' }), ['skill', 'install']).fileRole).toBe('output');
    // 비밀 값 flag는 표지가 붙는다.
    expect(classifyFlag(flag('body'), ['secret', 'set'])).toMatchObject({ secretInput: true });
    expect(classifyFlag(flag('body'), ['issue', 'create']).secretInput).toBe(false);
    // 한 번에 여럿을 지우는 flag는 command별로만 승인 대상이다 — `run list --all`은 무해하다.
    expect(classifyFlag(flag('all', { valueType: null }), ['cache', 'delete']).control).toBe('requires_admin_approval');
    expect(classifyFlag(flag('all', { valueType: null }), ['run', 'list']).control).toBe('mapped_to_typed_control');
    expect(classifyFlag(flag('days', { valueType: 'N' }), ['codespace', 'delete']).control).toBe('requires_admin_approval');
    // 로컬 작업 트리가 필요한 flag와 부수 삭제 flag.
    expect(classifyFlag(flag('clone', { valueType: null }), ['repo', 'fork']).control).toBe('terminal_only');
    expect(classifyFlag(flag('checkout', { valueType: null }), ['issue', 'develop']).control).toBe('terminal_only');
    expect(classifyFlag(flag('cleanup-tag', { valueType: null }), ['release', 'delete']).control).toBe('requires_admin_approval');
    expect(classifyFlag(flag('recover'), ['pr', 'create'])).toMatchObject({ valueKind: 'file', fileRole: 'input' });
    // inherited flag에는 command별 판정을 적용하지 않는다.
    expect(classifyFlag(flag('all', { valueType: null, inherited: true }), ['cache', 'delete']).control).toBe('mapped_to_typed_control');
  });

  it('모르는 값 타입은 unknown이다 — generic으로 뭉개지 않는다', () => {
    const outcome = classifyFlag(flag('mystery', { valueType: 'quux' }));
    expect(outcome).toMatchObject({ control: 'unknown', valueKind: 'unknown' });
    expect(outcome.basis.rule).toBe('no-rule');
  });
});

describe('positional 규칙 — USAGE 줄에서 자리를 읽는다', () => {
  it('대안·선택·필수·반복·통과 인자를 구분한다', () => {
    expect(parseUsagePositionals('gh pr list [flags]', ['pr', 'list'])).toEqual([]);
    expect(parseUsagePositionals('gh pr merge [<number> | <url> | <branch>] [flags]', ['pr', 'merge'])).toEqual([
      { placeholder: '<number> | <url> | <branch>', required: false, variadic: false, alternatives: ['<number>', '<url>', '<branch>'] },
    ]);
    expect(parseUsagePositionals('gh issue close {<number> | <url>} [flags]', ['issue', 'close'])[0]).toMatchObject({ required: true, alternatives: ['<number>', '<url>'] });
    expect(parseUsagePositionals('gh gist create [<filename>... | -] [flags]', ['gist', 'create'])[0]).toMatchObject({ required: false, variadic: true, alternatives: ['<filename>...', '-'] });
    expect(parseUsagePositionals('gh repo clone <repository> [<directory>] [-- <gitflags>...]', ['repo', 'clone']).map((one) => one.placeholder)).toEqual(['<repository>', '<directory>', '-- <gitflags>...']);
    expect(parseUsagePositionals('gh completion -s <shell>', ['completion']).map((one) => one.placeholder)).toEqual(['<shell>']);
    expect(parseUsagePositionals('gh codespace cp [-e] [-r] [-- [<scp flags>...]] <sources>... <dest>', ['codespace', 'cp']).map((one) => one.placeholder)).toEqual(['-- [<scp flags>...]', '<sources>', '<dest>']);
  });

  it('구분자로 이어진 묶음은 한 자리다', () => {
    const forward = parseUsagePositionals('gh codespace ports forward <remote-port>:<local-port>... [flags]', ['codespace', 'ports', 'forward']);
    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatchObject({ placeholder: '<remote-port>:<local-port>', variadic: true });
    expect(classifyPositional(forward[0]!).control).toBe('mapped_to_typed_control');
    const visibility = parseUsagePositionals('gh codespace ports visibility <port>:{public|private|org}... [flags]', ['codespace', 'ports', 'visibility']);
    expect(visibility).toHaveLength(1);
    expect(classifyPositional(visibility[0]!).control).toBe('mapped_to_typed_control');
  });

  it('자리의 분류는 대안 중 가장 약한 것이다', () => {
    const selector = classifyPositional({ placeholder: '<number> | <url>', required: true, variadic: false, alternatives: ['<number>', '<url>'] });
    expect(selector).toMatchObject({ control: 'mapped_to_typed_control', binding: 'value' });
    const file = classifyPositional({ placeholder: '<filename>... | -', required: false, variadic: true, alternatives: ['<filename>...', '-'] });
    expect(file).toMatchObject({ control: 'mapped_to_generic_control', binding: 'file' });
    const passthrough = classifyPositional({ placeholder: '-- <gitflags>...', required: false, variadic: true, alternatives: ['-- <gitflags>...'] });
    expect(passthrough).toMatchObject({ control: 'terminal_only', binding: 'passthrough' });
    expect(classifyPositional({ placeholder: '<expansion>', required: true, variadic: false, alternatives: ['<expansion>'] }).control).toBe('policy_blocked');
    expect(classifyPositional({ placeholder: '<comment-url>', required: true, variadic: false, alternatives: ['<comment-url>'] }).basis.rule).toBe('selector-suffix');
    expect(classifyPositional({ placeholder: '<zorblax>', required: true, variadic: false, alternatives: ['<zorblax>'] }).control).toBe('unknown');
  });
});

describe('command 분류 — 표와 규칙이 합쳐진다', () => {
  const prList = command(['pr', 'list'], {
    usage: 'gh pr list [flags]',
    flags: [
      flag('state', { short: 's', description: 'Filter by state: {open|closed|merged|all} (default "open")' }),
      flag('limit', { short: 'L', valueType: 'int', description: 'Maximum number of items to fetch (default 30)' }),
      flag('json', { valueType: 'fields', description: 'Output JSON with the specified fields' }),
      flag('web', { short: 'w', valueType: null, description: 'List pull requests in the web browser' }),
      flag('repo', { short: 'R', valueType: '[HOST/]OWNER/REPO', inherited: true, description: 'Select another repository' }),
    ],
    jsonFields: ['number', 'title'],
  });

  it('pr list: 표가 지원·읽기·R0·resource_list를, 규칙이 flag 컨트롤과 입출력을 정한다', () => {
    const classification = classifyCommand(prList);
    expect(classification).not.toBeNull();
    expect(classification).toMatchObject({
      support: 'supported',
      interaction: 'web_native',
      risk: 'R0',
      sideEffect: 'read',
      auth: 'token',
      // CR-089: `--json` 결과가 PR을 식별하므로 주 종류는 resource_list다(결과 계약의 kind와 같다).
      resultKind: 'resource_list',
      sensitivity: 'internal',
      hostSupport: 'unverified',
    });
    expect(classification?.io).toMatchObject({ stdin: 'none', paginated: true, contexts: ['repository'] });
    expect(classification?.io.outputFormats).toEqual(['text', 'json', 'web']);
    expect(classification?.flags.map((one) => one.control)).toEqual([
      'mapped_to_typed_control',
      'mapped_to_typed_control',
      'mapped_to_typed_control',
      'mapped_to_web_equivalent',
      'mapped_to_typed_control',
    ]);
    expect(classification?.notes.join(' ')).toContain('--web');
    expect(classification?.basis).toMatchObject({ source: 'override', rule: 'commands-table' });
    // 결과 계약도 같은 함수가 만든다 — JSON 모드의 number가 인벤토리에 있어야 출력 port가 생긴다.
    expect(classification?.result).toMatchObject({ kind: 'resource_list', composability: 'partially_bindable', resourceKind: 'pull_request' });
    expect(classification?.result?.outputs.map((output) => output.mode)).toEqual(['text', 'json', 'web']);
  });

  it('JSON FIELDS가 없는 `--json`(workflow run의 입력 flag)은 출력 모드가 아니고, JSON 출력이 없는 `--template`도 출력 모드가 아니다', () => {
    const workflowRun = classifyCommand(
      command(['workflow', 'run'], { usage: 'gh workflow run [<workflow-id> | <workflow-name>] [flags]', flags: [flag('json', { valueType: null, description: 'Read workflow inputs as JSON via STDIN' })] }),
    );
    expect(workflowRun?.io.outputFormats).toEqual(['text']);
    const prCreate = classifyCommand(command(['pr', 'create'], { flags: [flag('template', { short: 'T', valueType: 'file', description: 'Template file to use as starting body text' })] }));
    expect(prCreate?.io.outputFormats).toEqual(['text']);
  });

  it('표에 없는 leaf는 unknown으로 남고 flag·positional 규칙만 적용된다', () => {
    const classification = classifyCommand(command(['pr', 'frobnicate'], { usage: 'gh pr frobnicate <number> [flags]', flags: [flag('web', { valueType: null })] }));
    expect(classification).toMatchObject({ support: 'unknown', interaction: 'unknown', risk: null, sideEffect: 'unknown', resultKind: 'unknown', sensitivity: 'unknown' });
    expect(classification?.flags[0]?.control).toBe('mapped_to_web_equivalent');
    expect(classification?.positionals[0]?.control).toBe('mapped_to_typed_control');
    expect(classification?.basis.evidence).toContain('행이 없다');
  });

  it('그룹과 별칭 전용 노드는 분류하지 않는다', () => {
    expect(classifyCommand(command(['pr'], { group: true }))).toBeNull();
    expect(classifyCommand(command(['co'], { aliasOf: ['pr', 'checkout'] }))).toBeNull();
  });

  it('결정적이다 — 같은 입력은 같은 JSON이다', () => {
    const first = JSON.stringify(classifyCommand(prList));
    const second = JSON.stringify(classifyCommand({ ...prList, flags: [...prList.flags] }));
    expect(first).toBe(second);
  });

  it('auth_required였던 command는 그 사실을 note로 남긴다', () => {
    const classification = classifyCommand(command(['extension', 'exec'], { usage: '', helpStatus: 'auth_required' }));
    expect(classification?.support).toBe('requires_extension');
    expect(classification?.notes.join(' ')).toContain('DEV-653');
  });
});
