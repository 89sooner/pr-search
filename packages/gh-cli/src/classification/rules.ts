/**
 * flag·positional 분류 규칙 (FR-GH-001 AC-3·AC-7·AC-9, NFR-009, WP-045).
 *
 * **규칙은 근거가 있어야 적용된다.** 각 규칙은 인벤토리에 실제로 있는 값(값 타입 자리표시자,
 * 설명 안의 `{a|b}` 열거, 반복 가능 타입, flag 이름)에서만 판정하고, 판정마다 어느 규칙이
 * 어떤 원문을 보고 정했는지(`basis`)를 남긴다. 규칙이 하나도 맞지 않으면 `unknown`이다 —
 * 모르는 것을 generic으로 뭉개지 않는다 (NFR-009 「목록에서 사라지는 것은 분류가 아니다」).
 *
 * 규칙을 바꾸면 `RULES_VERSION`을 올린다 — 검증 기록(`gh_capability_verification`)이 그 값을
 * 남겨 「어느 규칙으로 확인했는가」에 답한다.
 *
 * ## 이름 규칙이 값 타입 규칙보다 먼저다
 *
 * `--web`은 값 타입이 bool이지만 뜻은 「브라우저를 연다」이고, `--yes`는 bool이지만 뜻은
 * 「확인을 건너뛴다」다. 값 타입만 보면 둘 다 typed bool이 되어 위험이 사라진다. 그래서
 * 이름 규칙(웹 등가·승인 필요·정책 차단·터미널 전용)을 먼저 보고, 그 다음에 값 타입을 본다.
 */

import type { GhClassificationBasis, GhControlClass, GhFlagValueKind, GhInventoryFlag } from '../types.js';

/**
 * `.2` → `.3` (CR-089): 결과 계약·port 규칙(`results.ts`·`ports.ts`)이 분류에 들어갔고, 출력 모드 판정이 바뀌었다 —
 * JSON 출력은 JSON FIELDS·`--format {json}`일 때만(`workflow run --json`은 입력), 파일 출력 flag는 `file`, `--watch`는 `stream`.
 */
export const RULES_VERSION = 'rules-2026-09-14.3' as const;

/** 브라우저를 여는 flag — 실행기는 브라우저가 없다. 웹 등가는 URL을 링크로 주는 것이다 (ADR-019). */
const WEB_FLAGS: ReadonlySet<string> = new Set(['web']);

/**
 * 확인을 건너뛰거나 보호를 넘는 flag — 실행하려면 관리자 승인 경로가 필요하다 (FR-GH-009).
 * 이름의 뜻이 그것이다: `--yes`·`--confirm`은 대화형 확인을 생략하고, `--force`·`--admin`은
 * 보호 규칙을 넘고, `--delete-branch`는 부수 삭제를 더하며, `--clobber`는 기존 자산을 덮는다.
 */
const ADMIN_APPROVAL_FLAGS: ReadonlySet<string> = new Set([
  'yes',
  'confirm',
  'force',
  'admin',
  'delete-branch',
  'cleanup-tag',
  'clobber',
  'accept-visibility-change-consequences',
]);

/** 자격을 다루거나 셸 확장을 여는 flag — 이 제품은 열지 않는다. */
const POLICY_BLOCKED_FLAGS: ReadonlySet<string> = new Set(['shell', 'with-token', 'show-token', 'insecure-storage']);

/**
 * 로컬 편집기·클립보드·git 작업 트리처럼 실행기에 없는 것을 요구하는 flag.
 * `--clone`(repo create·repo fork)·`--push`(repo create)·`--checkout`(issue develop)은 로컬 저장소에 쓴다.
 */
const TERMINAL_ONLY_FLAGS: ReadonlySet<string> = new Set(['editor', 'clipboard', 'insiders', 'clone', 'push', 'checkout']);

/**
 * command 하나의 flag에만 적용하는 판정 — 이름 규칙으로는 틀리게 되는 자리 (독립 검토 가).
 * 키는 `<path> --<flag>`. 이름 규칙보다 먼저 본다.
 */
const COMMAND_FLAG_OVERRIDES: Readonly<Record<string, Omit<FlagClassificationOutcome, 'basis' | 'secretInput'> & { readonly rule: string; readonly secretInput?: boolean }>> = {
  // 로컬 경로 — 같은 이름의 `repo sync --source`는 원격 저장소라 이름 규칙으로 못 가른다.
  'repo create --source': { control: 'terminal_only', valueKind: 'file', enumValues: null, fileRole: null, rule: 'local-path-flag' },
  // help가 `{zip|tar.gz}`가 아니라 "(zip or tar.gz)"로 적은 열거. 파일을 쓰는 것은 `--dir`이지 이 flag가 아니다.
  'release download --archive': { control: 'mapped_to_typed_control', valueKind: 'enum', enumValues: ['zip', 'tar.gz'], fileRole: null, rule: 'enum-from-help-prose' },
  // 스캔 대상 디렉터리(입력). 같은 이름의 `skill install --dir`·`run download --dir`은 출력이다.
  'skill list --dir': { control: 'mapped_to_generic_control', valueKind: 'file', enumValues: null, fileRole: 'input', rule: 'scan-directory-flag' },
  'skill update --dir': { control: 'mapped_to_generic_control', valueKind: 'file', enumValues: null, fileRole: 'input', rule: 'scan-directory-flag' },
  // `@<path>`·`@-`로 파일·stdin을 읽는다 — 값 채널이 셋이다.
  'api --field': { control: 'mapped_to_generic_control', valueKind: 'key_value', enumValues: null, fileRole: 'input', rule: 'value-or-file-flag' },
  'api --raw-field': { control: 'mapped_to_generic_control', valueKind: 'key_value', enumValues: null, fileRole: 'input', rule: 'value-or-file-flag' },
  // 비밀 값 그 자체 — argv 미리보기·로그·이력에 실으면 안 된다.
  'secret set --body': { control: 'mapped_to_generic_control', valueKind: 'string', enumValues: null, fileRole: null, rule: 'secret-value-flag', secretInput: true },
  'secret set --env-file': { control: 'mapped_to_generic_control', valueKind: 'file', enumValues: null, fileRole: 'input', rule: 'secret-value-flag', secretInput: true },
  // 한 번에 여럿을 지우는 flag — `run list --all`처럼 무해한 동명 flag가 있어 command별로 건다.
  'cache delete --all': { control: 'requires_admin_approval', valueKind: 'bool', enumValues: null, fileRole: null, rule: 'bulk-delete-flag' },
  'codespace delete --all': { control: 'requires_admin_approval', valueKind: 'bool', enumValues: null, fileRole: null, rule: 'bulk-delete-flag' },
  'codespace delete --days': { control: 'requires_admin_approval', valueKind: 'int', enumValues: null, fileRole: null, rule: 'bulk-delete-flag' },
  'alias delete --all': { control: 'requires_admin_approval', valueKind: 'bool', enumValues: null, fileRole: null, rule: 'bulk-delete-flag' },
};

/**
 * 이름만으로 자원 선택자임을 아는 flag. 값 타입이 `string`이어도 뜻은 「GitHub 자원 하나」다 —
 * 폼에서는 typed 선택 컨트롤이 된다.
 */
const SELECTOR_FLAGS: ReadonlySet<string> = new Set([
  'repo',
  'owner',
  'org',
  'user',
  'codespace',
  'env',
  'base',
  'head',
  'branch',
  'ref',
  'assignee',
  'author',
  'reviewer',
  'milestone',
  'label',
  'project',
  'team',
  'app',
  'target',
  'remote',
  'hostname',
  'host',
  'add-assignee',
  'remove-assignee',
  'add-reviewer',
  'remove-reviewer',
  'add-label',
  'remove-label',
  'add-project',
  'remove-project',
  'machine',
  'workflow',
  'commenter',
  'involves',
  'mentions',
  'review-requested',
  'reviewed-by',
  'source-owner',
  'target-owner',
  'default-branch',
  'repo-owner',
  'parent',
  'duplicate-of',
  'blocked-by',
  'blocking',
  'add-blocked-by',
  'add-blocking',
  'add-sub-issue',
  'remove-blocked-by',
  'remove-blocking',
  'remove-sub-issue',
  'match-head-commit',
  'commit',
  'category',
  'discussion-category',
  'iteration-id',
  'project-id',
  'field-id',
  'single-select-option-id',
  'id',
]);

/** 파일을 **읽는** flag. 파일 바인딩(FR-GH-005)이 있어야 열 수 있다. `--recover`는 실패한 create의 로컬 입력 파일이다. */
const FILE_INPUT_FLAGS: ReadonlySet<string> = new Set([
  'body-file',
  'notes-file',
  'from-file',
  'input',
  'env-file',
  'custom-trusted-root',
  'tuf-root',
  'bundle',
  'precompiled',
  'recover',
]);

/** 파일을 **쓰는** flag. 아티팩트 결과(FR-GH-005)로 다룬다. */
const FILE_OUTPUT_FLAGS: ReadonlySet<string> = new Set(['dir', 'output', 'debug-file']);

/** 값 타입 자리표시자 → 컨트롤 종류. help가 적은 원문 그대로의 키다. */
const VALUE_TYPE_KINDS: Readonly<Record<string, GhFlagValueKind>> = {
  int: 'int',
  uint: 'int',
  N: 'int',
  number: 'int',
  numbers: 'int',
  float: 'float',
  date: 'date',
  duration: 'duration',
  fields: 'fields',
  expression: 'expression',
  file: 'file',
  directory: 'file',
  path: 'file',
  format: 'string',
  event: 'string',
  URL: 'string',
  string: 'string',
  text: 'string',
  title: 'string',
  query: 'string',
  patterns: 'strings',
  strings: 'strings',
  stringArray: 'strings',
  stringSlice: 'strings',
  'key=value': 'key_value',
  'key:value': 'key_value',
  name: 'selector',
  login: 'selector',
  user: 'selector',
  username: 'selector',
  branch: 'selector',
  SHA: 'selector',
  handle: 'selector',
  repository: 'selector',
  repositories: 'selector',
  organization: 'selector',
  environment: 'selector',
  'owner/number': 'selector',
  'OWNER/REPO': 'selector',
  '[HOST/]OWNER/REPO': 'selector',
};

const ENUM_IN_DESCRIPTION = /\{([^{}]+\|[^{}]+)\}/;

function basis(rule: string, evidence: string): GhClassificationBasis {
  return { source: 'rule', rule, evidence };
}

export interface FlagClassificationOutcome {
  readonly control: GhControlClass;
  readonly valueKind: GhFlagValueKind;
  readonly enumValues: readonly string[] | null;
  readonly fileRole: 'input' | 'output' | null;
  /** 값이 비밀 그 자체다 — argv 미리보기·로그·이력에 실으면 안 된다 (`secret set --body`). */
  readonly secretInput: boolean;
  readonly basis: GhClassificationBasis;
}

/** 설명의 `{a|b|c}`에서 열거값을 뽑는다. 없으면 `null`. */
export function enumValuesOf(description: string): readonly string[] | null {
  const match = ENUM_IN_DESCRIPTION.exec(description);
  if (match?.[1] === undefined) return null;
  const values = match[1].split('|').map((value) => value.trim()).filter((value) => value !== '');
  return values.length >= 2 ? values : null;
}

/**
 * flag 하나를 분류한다. 순서가 규칙이다 — 위에서 처음 맞는 규칙이 답이다.
 * `commandPath`를 주면 그 command에만 적용하는 판정(`COMMAND_FLAG_OVERRIDES`)을 먼저 본다.
 */
export function classifyFlag(flag: GhInventoryFlag, commandPath: readonly string[] = []): FlagClassificationOutcome {
  const line = `--${flag.name}${flag.valueType === null ? '' : ` ${flag.valueType}`}  ${flag.description}`.trim();
  const valueType = flag.valueType;
  const enumValues = enumValuesOf(flag.description);

  const override = flag.inherited ? undefined : COMMAND_FLAG_OVERRIDES[`${commandPath.join(' ')} --${flag.name}`];
  if (override !== undefined) {
    const { rule, secretInput, ...outcome } = override;
    return { ...outcome, secretInput: secretInput ?? false, basis: basis(`command-flag-override:${rule}`, line) };
  }
  if (WEB_FLAGS.has(flag.name)) {
    return { control: 'mapped_to_web_equivalent', valueKind: 'bool', enumValues: null, fileRole: null, secretInput: false, basis: basis('web-flag', line) };
  }
  if (POLICY_BLOCKED_FLAGS.has(flag.name)) {
    return { control: 'policy_blocked', valueKind: valueType === null ? 'bool' : 'string', enumValues: null, fileRole: null, secretInput: false, basis: basis('policy-blocked-flag', line) };
  }
  if (TERMINAL_ONLY_FLAGS.has(flag.name)) {
    return { control: 'terminal_only', valueKind: valueType === null ? 'bool' : 'string', enumValues: null, fileRole: null, secretInput: false, basis: basis('terminal-only-flag', line) };
  }
  if (ADMIN_APPROVAL_FLAGS.has(flag.name)) {
    return { control: 'requires_admin_approval', valueKind: 'bool', enumValues: null, fileRole: null, secretInput: false, basis: basis('admin-approval-flag', line) };
  }
  if (FILE_INPUT_FLAGS.has(flag.name)) {
    return { control: 'mapped_to_generic_control', valueKind: 'file', enumValues: null, fileRole: 'input', secretInput: false, basis: basis('file-input-flag', line) };
  }
  if (FILE_OUTPUT_FLAGS.has(flag.name)) {
    return { control: 'mapped_to_generic_control', valueKind: 'file', enumValues: null, fileRole: 'output', secretInput: false, basis: basis('file-output-flag', line) };
  }
  if (enumValues !== null) {
    return { control: 'mapped_to_typed_control', valueKind: 'enum', enumValues, fileRole: null, secretInput: false, basis: basis('enum-from-help', line) };
  }
  if (SELECTOR_FLAGS.has(flag.name)) {
    return { control: 'mapped_to_typed_control', valueKind: 'selector', enumValues: null, fileRole: null, secretInput: false, basis: basis('selector-flag', line) };
  }
  if (valueType === null) {
    return { control: 'mapped_to_typed_control', valueKind: 'bool', enumValues: null, fileRole: null, secretInput: false, basis: basis('bool-flag', line) };
  }
  /*
   * gh 2.97.0의 help는 몇몇 bool flag의 값 자리에 **다른 flag 이름**을 적는다 —
   * `-f, --force --hostname   Force setup even if …`, `--succeed-on-no-caches --all …`,
   * `--value --field …`. 파서 결함이 아니라 원문이 그렇다(실측). 값이 아니라 「함께 써야 하는
   * flag」의 표기이므로 bool로 읽되 그 사실을 남긴다.
   */
  if (valueType.startsWith('--')) {
    return { control: 'mapped_to_typed_control', valueKind: 'bool', enumValues: null, fileRole: null, secretInput: false, basis: basis('help-placeholder-artifact', line) };
  }
  // `string[="last"]` — 값이 선택적인 문자열 (cobra NoOptDefVal). 문자열 컨트롤이다.
  if (/^string\[=/.test(valueType)) {
    return { control: 'mapped_to_generic_control', valueKind: 'string', enumValues: null, fileRole: null, secretInput: false, basis: basis('optional-value-string', line) };
  }
  const kind = VALUE_TYPE_KINDS[valueType];
  if (kind === undefined) {
    return { control: 'unknown', valueKind: 'unknown', enumValues: null, fileRole: null, secretInput: false, basis: basis('no-rule', line) };
  }
  if (kind === 'file') {
    return { control: 'mapped_to_generic_control', valueKind: 'file', enumValues: null, fileRole: 'input', secretInput: false, basis: basis('file-value-type', line) };
  }
  if (kind === 'selector' || kind === 'int' || kind === 'float' || kind === 'date' || kind === 'duration' || kind === 'fields') {
    return { control: 'mapped_to_typed_control', valueKind: kind, enumValues: null, fileRole: null, secretInput: false, basis: basis(`typed-value-type:${valueType}`, line) };
  }
  // string · strings · expression · key_value — 자유 입력. 일반 컨트롤로 표현하고 서버가 값을 검증한다.
  return { control: 'mapped_to_generic_control', valueKind: kind, enumValues: null, fileRole: null, secretInput: false, basis: basis(`generic-value-type:${valueType}`, line) };
}

/* ------------------------------------------------------------- positionals */

export interface UsagePositional {
  /** 괄호 안 원문. `number> | <url> | <branch` 처럼 자르지 않고 `<number> | <url> | <branch>` 그대로다. */
  readonly placeholder: string;
  readonly required: boolean;
  readonly variadic: boolean;
  /** `|`로 나뉜 대안. `--all` 같은 flag 대안도 그대로 둔다. */
  readonly alternatives: readonly string[];
}

/**
 * USAGE 줄에서 positional 자리를 뽑는다.
 *
 * `gh <path>` 뒤의 최상위 괄호 묶음 하나가 자리 하나다: `[...]`는 선택, `{...}`·`<...>`는 필수,
 * 끝의 `...`는 반복이다. `[flags]`는 자리가 아니고, `[-- <gitflags>...]`는 뒤의 프로그램에 넘기는
 * 통과 인자다(자리로 세되 `--`를 앞에 둔다). 괄호 밖의 `-s <shell>` 같은 flag 표기는 자리가 아니다.
 */
export function parseUsagePositionals(usage: string, path: readonly string[]): readonly UsagePositional[] {
  const prefix = `gh ${path.join(' ')}`;
  if (!usage.startsWith(prefix)) return [];
  const rest = usage.slice(prefix.length);
  const out: UsagePositional[] = [];
  let index = 0;
  while (index < rest.length) {
    const char = rest[index] ?? '';
    if (char === ' ') {
      index += 1;
      continue;
    }
    if (char === '[' || char === '{' || char === '<') {
      let depth = 0;
      let end = index;
      for (; end < rest.length; end += 1) {
        const current = rest[end];
        if (current === '[' || current === '{' || current === '<') depth += 1;
        if (current === ']' || current === '}' || current === '>') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      /*
       * `<remote-port>:<local-port>...`처럼 괄호 묶음에 구분자와 다음 묶음이 공백 없이 붙으면
       * 한 자리다 — 공백까지 이어 붙인다.
       */
      let tail = end + 1;
      while (tail < rest.length && rest[tail] !== ' ') {
        const next = rest[tail];
        if (next === '<' || next === '[' || next === '{') {
          let inner = 0;
          for (; tail < rest.length; tail += 1) {
            const current = rest[tail];
            if (current === '[' || current === '{' || current === '<') inner += 1;
            if (current === ']' || current === '}' || current === '>') {
              inner -= 1;
              if (inner === 0) break;
            }
          }
        }
        tail += 1;
      }
      const group = rest.slice(index, tail);
      const inner = char === '<' && tail === end + 1 ? rest.slice(index + 1, end) : rest.slice(index + 1, end);
      const joined = tail > end + 1 ? group : inner;
      index = tail;
      // 끝의 `...`는 이 자리의 반복 표시다.
      const variadic = /\.\.\.$/.test(joined);
      if (inner === 'flags') continue;
      if (/^-{1,2}[A-Za-z]/.test(inner) && !inner.includes('<') && char === '[') continue; // `[-e]`·`[-r]` 같은 flag 표기
      const alternatives = tail > end + 1 ? [joined.replace(/\.\.\.$/, '')] : splitAlternatives(inner);
      out.push({
        placeholder: char === '<' || tail > end + 1 ? group.replace(/\.\.\.$/, '') : inner,
        required: char !== '[',
        variadic: variadic || /\.\.\.$/.test(inner) || alternatives.some((one) => one.endsWith('...')),
        alternatives,
      });
      continue;
    }
    // 괄호 밖 토큰 — `-s`·`<shell>`은 위에서 `<`로 잡히고, 여기 오는 것은 flag 이름 등이다. 다음 공백까지 건너뛴다.
    const next = rest.indexOf(' ', index);
    index = next === -1 ? rest.length : next;
  }
  return out;
}

/** 최상위 `|`로만 나눈다 — `<port>:{public|private|org}`의 안쪽 `|`는 값 열거이지 대안이 아니다. */
function splitAlternatives(inner: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of inner) {
    if (char === '[' || char === '{' || char === '<') depth += 1;
    if (char === ']' || char === '}' || char === '>') depth -= 1;
    if (char === '|' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter((part) => part !== '');
}

/** 자원 하나를 가리키는 자리표시자 — typed 선택 컨트롤이 된다. */
const SELECTOR_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'number',
  'numbers',
  'url',
  'branch',
  'sha',
  'commit-sha',
  'tag',
  'repository',
  'source-repository',
  'destination-repository',
  'owner',
  'repo',
  'login',
  'user',
  'id',
  'run-id',
  'job-id',
  'session-id',
  'workflow-id',
  'workflow',
  'codespace',
  'environment',
  'gist',
  'key-id',
  'alias',
  'name',
  'new-name',
  'secret-name',
  'variable-name',
  'cache-id',
  'cache-key',
  'ruleset-id',
  'release',
  'project',
  'org',
  'organization',
  'team',
  'template',
  'license-key',
  'asset-name',
  'keyprefix',
  'pr-number',
  'pr-url',
  'pr-branch',
  'issue-number',
  'port',
  'remote-port:local-port',
  'skill',
  'skill[@version]',
  'path',
  'urltemplate',
  'version',
  'extension',
  'shell',
]);

/** 자유 문장·식 — 일반 컨트롤로 받고 서버가 값을 검증한다. */
const FREE_TEXT_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'query',
  'title',
  'body',
  'task description',
  'expression',
  'message',
  'text',
  'pattern',
  'prompt type',
  'endpoint',
  'key',
  'value',
  'filter',
  'args',
  'image-uri',
]);

/** 파일·디렉터리 — 파일 바인딩(FR-GH-005)이 있어야 열 수 있다. */
const FILE_PLACEHOLDERS: ReadonlySet<string> = new Set(['filename', 'file', 'file-path', 'files', 'key-file', 'directory', 'dest', 'sources', 'source']);

function placeholderName(alternative: string): string {
  return alternative
    .replace(/\.\.\.$/, '')
    .replace(/^<(.*)>$/, '$1')
    .replace(/^\[(.*)\]$/, '$1')
    .trim()
    .toLowerCase();
}

export interface PositionalClassificationOutcome {
  readonly control: GhControlClass;
  readonly binding: 'value' | 'file' | 'stdin' | 'passthrough' | null;
  readonly basis: GhClassificationBasis;
}

/**
 * 자리 하나를 분류한다. 대안이 여럿이면 **가장 약한** 것이 자리의 분류다 — 하나라도 파일이면
 * 파일 바인딩이 필요하고, 하나라도 통과 인자면 터미널 전용이다.
 */
export function classifyPositional(positional: UsagePositional): PositionalClassificationOutcome {
  const evidence = positional.placeholder;
  const controls: PositionalClassificationOutcome[] = positional.alternatives.map((alternative) => {
    if (alternative === '-') return { control: 'mapped_to_generic_control', binding: 'stdin', basis: basis('stdin-dash', evidence) };
    if (alternative.startsWith('-- ') || alternative === '--') {
      // `-- <gitflags>...` — 뒤의 프로그램(git·ssh·scp)에 그대로 넘기는 인자. 터미널 전용이다.
      return { control: 'terminal_only', binding: 'passthrough', basis: basis('passthrough-args', evidence) };
    }
    if (alternative.startsWith('--')) {
      // `{<alias> | --all}` — 대안이 flag다. flag 쪽은 flag 규칙이 이미 분류했다.
      return { control: 'mapped_to_typed_control', binding: null, basis: basis('flag-alternative', evidence) };
    }
    if (/^oci:\/\//.test(alternative)) {
      return { control: 'mapped_to_generic_control', binding: 'value', basis: basis('oci-reference', evidence) };
    }
    const name = placeholderName(alternative);
    if (name.includes(':{') || /^<[^>]+>:<[^>]+>$/.test(alternative.replace(/\.\.\.$/, ''))) {
      // `<port>:{public|private|org}`·`<remote-port>:<local-port>` — 구분자로 이어진 typed 자리.
      return { control: 'mapped_to_typed_control', binding: 'value', basis: basis('typed-with-separator', evidence) };
    }
    if (SELECTOR_PLACEHOLDERS.has(name)) return { control: 'mapped_to_typed_control', binding: 'value', basis: basis('selector-placeholder', evidence) };
    if (FILE_PLACEHOLDERS.has(name)) return { control: 'mapped_to_generic_control', binding: 'file', basis: basis('file-placeholder', evidence) };
    if (FREE_TEXT_PLACEHOLDERS.has(name)) return { control: 'mapped_to_generic_control', binding: 'value', basis: basis('free-text-placeholder', evidence) };
    if (name === 'expansion') return { control: 'policy_blocked', binding: 'value', basis: basis('shell-expansion', evidence) };
    if (name === 'command') return { control: 'terminal_only', binding: 'value', basis: basis('remote-command', evidence) };
    if (name.endsWith(' flags') || name.endsWith('-flags') || name === 'flags') {
      return { control: 'terminal_only', binding: 'passthrough', basis: basis('passthrough-args', evidence) };
    }
    // `<discussion-url>`·`<comment-id>`·`<destination-repo>`·`<old-filename>` — 접미사가 자원 식별자임을 말한다.
    if (/(?:^|-)(url|urls|id|ids|number|numbers|name|repo|repository|sha|key|filename|branch|tag)$/.test(name)) {
      return { control: 'mapped_to_typed_control', binding: 'value', basis: basis('selector-suffix', evidence) };
    }
    return { control: 'unknown', binding: null, basis: basis('no-rule', evidence) };
  });
  if (controls.length === 0) return { control: 'unknown', binding: null, basis: basis('no-rule', evidence) };
  const order: readonly GhControlClass[] = [
    'unknown',
    'policy_blocked',
    'terminal_only',
    'unsupported_by_host',
    'requires_admin_approval',
    'mapped_to_web_equivalent',
    'mapped_to_generic_control',
    'mapped_to_typed_control',
  ];
  let weakest = controls[0]!;
  for (const candidate of controls) {
    if (order.indexOf(candidate.control) < order.indexOf(weakest.control)) weakest = candidate;
  }
  return weakest;
}
