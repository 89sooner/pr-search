/**
 * typed 입출력 port의 분류 (SRS 9.8 4항, FR-GH-001 AC-12, CR-089).
 *
 * ## 입력 port — 대상 자원을 받는 자리
 *
 * command가 **무엇에 대해** 동작하는가를 받는 자리만 입력 port다: USAGE의 positional 대안(`pr view <number>`)과
 * codespace의 `--codespace`. 필터·매개 값(`--base`·`--assignee`·`--label`)은 typed 컨트롤로 이미 분류됐고
 * (FR-GH-001 AC-3) 바인딩 입력으로 선언하지 않는다. 자리의 **대안 하나로만** 받는다 — PR의 `<url>` 대안은 gh가 URL의
 * 저장소·호스트로 `--repo`를 덮는 입력이고(`pkg/cmd/pr/shared/finder.go:117-120`), `<branch>` 대안은 head 브랜치로 PR을
 * 찾는 조회라 참조가 아니다(`finder.go:171-190`).
 *
 * ## 출력 port — 결과에서 참조를 만드는 방법
 *
 * 둘뿐이다. (1) `--json` 결과의 식별 필드(native_json) — 필드가 선택돼야 값이 있다. (2) gh가 stdout에 찍는 URL 한 줄
 * (resource_url) — gh 스스로 그 URL을 인자로 읽는 문법이 있을 때만(`resource-ref.ts`). 둘 다 행마다 고정 버전 소스의
 * 근거를 적는다. 이름이나 `--json` 존재만으로 port를 만들지 않는다.
 */

import { REPOSITORY_SCOPED_KINDS, refTypeName } from '../resource-ref.js';
import type { GhClassificationBasis, GhInventoryCommand, GhJsonIdentity, GhPort, GhPortCondition, GhPortSlot, GhResourceKind, GhResultSensitivity, GhUrlGrammar } from '../types.js';
import { parseUsagePositionals } from './rules.js';

export const GH_SOURCE = 'gh v2.97.0';

/** 실행기가 구현한 유일한 결과 스키마 (`result.ts`). */
export const PR_LIST_RESULT_SCHEMA = 'pr_list_v2' as const;

/** 정의만 있고 구현하지 않은 JSON 결과 스키마의 이름 — 모양은 그 command의 JSON FIELDS다. */
export function jsonSchemaName(commandKey: string): string {
  return `gh-json/${commandKey.split(' ').join('.')}`;
}

export function urlSchemaName(grammar: GhUrlGrammar): string {
  return `gh-url/${grammar}`;
}

/* ------------------------------------------------------------------ 입력 port */

/** positional 대안 이름 → 자원 종류. 무리(command 첫 조각)마다 다르다 — 같은 `number`라도 pr은 PR, issue는 issue다. */
const POSITIONAL_SUBJECTS: Readonly<Record<string, Readonly<Record<string, GhResourceKind>>>> = {
  pr: { number: 'pull_request' },
  issue: { number: 'issue', numbers: 'issue', 'destination-repo': 'repository' },
  run: { 'run-id': 'workflow_run' },
  release: { tag: 'release' },
  repo: { repository: 'repository', 'destination-repository': 'repository' },
  workflow: { 'workflow-id': 'workflow' },
  discussion: { number: 'discussion' },
  gist: { id: 'gist', gist: 'gist' },
  'agent-task': { 'pr-number': 'pull_request' },
  label: { 'source-repository': 'repository' },
  ruleset: { branch: 'branch' },
  extension: { repository: 'repository' },
  skill: { repository: 'repository' },
};

/** 규칙에는 맞지만 이미 있는 자원을 가리키지 않는 자리. */
const NOT_A_SUBJECT: Readonly<Record<string, string>> = {
  'release create': '`<tag>`는 새로 만들 릴리스의 태그 이름이다 — 이미 있는 릴리스를 가리키지 않는다',
};

/** 대안 이름이 곧 자원을 뜻하는 자리 — port ID는 종류 이름이다. 나머지는 대안 이름을 쓴다(`destination_repo`). */
const TYPE_NAMED_ALTERNATIVES: ReadonlySet<string> = new Set(['number', 'numbers', 'run-id', 'tag', 'repository', 'workflow-id', 'id', 'gist', 'pr-number', 'branch']);

function alternativeName(alternative: string): string {
  return alternative
    .replace(/\.\.\.$/, '')
    .replace(/^<(.*)>$/, '$1')
    .replace(/^\[(.*)\]$/, '$1')
    .trim()
    .toLowerCase();
}

export interface SubjectSlot {
  readonly id: string;
  readonly type: GhResourceKind;
  readonly slot: GhPortSlot;
  readonly required: boolean;
  readonly cardinality: 'one' | 'many';
  /** 자리의 대안 전부(원문). 조건 설명에 쓴다. */
  readonly alternatives: readonly string[];
}

/** command의 대상 자원 자리 — 인벤토리(USAGE·flag)에서만 판정한다. 결정적이다. */
export function subjectSlotsOf(command: GhInventoryCommand): readonly SubjectSlot[] {
  const key = command.path.join(' ');
  if (key in NOT_A_SUBJECT) return [];
  const group = command.path[0] ?? '';
  const slots: SubjectSlot[] = [];
  const rules = POSITIONAL_SUBJECTS[group];
  if (rules !== undefined) {
    parseUsagePositionals(command.usage, command.path).forEach((positional, index) => {
      for (const alternative of positional.alternatives) {
        const name = alternativeName(alternative);
        const type = rules[name];
        if (type === undefined) continue;
        const cardinality = name === 'numbers' || positional.variadic ? 'many' : 'one';
        const id = TYPE_NAMED_ALTERNATIVES.has(name) ? (cardinality === 'many' ? `${type}s` : type) : name.replace(/-/g, '_');
        slots.push({ id, type, slot: { kind: 'positional', index, placeholder: positional.placeholder, alternative: name }, required: positional.required, cardinality, alternatives: positional.alternatives });
        break;
      }
    });
  }
  if (group === 'codespace' && command.flags.some((flag) => flag.name === 'codespace')) {
    slots.push({ id: 'codespace', type: 'codespace', slot: { kind: 'flag', flag: '--codespace' }, required: false, cardinality: 'one', alternatives: ['--codespace'] });
  }
  return slots;
}

function basis(rule: string, evidence: string): GhClassificationBasis {
  return { source: 'rule', rule, evidence };
}

/**
 * URL 대안에 대해 고정 버전 소스로 확인한 사실. 무리마다 다르므로 확인한 무리에만 적는다 — PR에서 확인한 사실을
 * issue·gist·discussion의 근거로 빌려 쓰지 않는다.
 */
const URL_ALTERNATIVE_EVIDENCE: Readonly<Record<string, string>> = {
  pr: 'PR URL은 URL의 저장소·호스트로 --repo를 덮는다(pkg/cmd/pr/shared/finder.go:117-120)',
};

const isUrlAlternative = (alternative: string): boolean => /(?:^|-)urls?$/.test(alternativeName(alternative));

export function inputPortOf(command: GhInventoryCommand, subject: SubjectSlot): GhPort {
  const conditions: GhPortCondition[] = [];
  if (subject.slot.kind === 'positional' && subject.alternatives.length > 1) {
    const chosen = subject.slot.alternative;
    const others = subject.alternatives.filter((alternative) => alternativeName(alternative) !== chosen);
    const urls = others.filter(isUrlAlternative);
    const names = others.filter((alternative) => !isUrlAlternative(alternative));
    const urlEvidence = URL_ALTERNATIVE_EVIDENCE[command.path[0] ?? ''];
    const parts = [`\`<${chosen}>\` 대안으로만 받는다.`];
    if (urls.length > 0) parts.push(`${urls.join(' · ')}는 gh가 URL을 직접 해석해 대상을 찾는 입력이라 참조로 채우지 않는다${urlEvidence === undefined ? '' : ` — ${urlEvidence}`}.`);
    if (names.length > 0) parts.push(`${names.join(' · ')}는 ${refTypeName(subject.type)}의 식별자가 아니라 참조로 채우지 않는다.`);
    conditions.push({ code: 'slot_alternative', detail: parts.join(' ') });
  }
  if (REPOSITORY_SCOPED_KINDS.has(subject.type)) {
    conditions.push({ code: 'same_repository', detail: '참조의 저장소가 이 실행의 --repo와 같아야 한다' });
  }
  return {
    id: subject.id,
    direction: 'input',
    type: subject.type,
    cardinality: subject.cardinality,
    required: subject.required,
    nullable: false,
    sensitivity: 'internal',
    conditions,
    source: null,
    slot: subject.slot,
    basis: basis('subject-slot', `${GH_SOURCE} USAGE: ${command.usage}${subject.slot.kind === 'flag' ? ' · --codespace' : ''}`),
  };
}

/** 입력 port가 없는 이유. 자리가 있는데 참조가 아닌 경우와 자리가 없는 경우를 가른다. */
export function inputPortsNoteOf(command: GhInventoryCommand): string {
  const key = command.path.join(' ');
  const notSubject = NOT_A_SUBJECT[key];
  if (notSubject !== undefined) return notSubject;
  const positionals = parseUsagePositionals(command.usage, command.path);
  if ((command.path[0] ?? '') === 'project' && positionals.some((positional) => positional.alternatives.some((one) => alternativeName(one) === 'number'))) {
    return 'project 번호는 소유자(--owner)와 함께여야 식별되는데 GhResourceRef에 소유자 자리가 없다 (SRS 9.8 3항) — 입력 port로 선언하지 않는다';
  }
  if (key === 'browse') return '`<number>`가 issue와 PR을 가리지 않고 경로·커밋 SHA도 받는다 — 한 타입의 입력으로 선언할 수 없다';
  if (positionals.length === 0) return '대상 자원을 받는 자리가 없다 — positional이 없고 저장소·호스트는 실행 컨텍스트가 정한다';
  return `자리 ${positionals.map((positional) => positional.placeholder).join(' ; ')}는 이 판이 정의한 자원 참조가 아니다 — 이름·자유 문자열·파일·새로 만들 값이다`;
}

/* ------------------------------------------------------------------ 출력 port */

interface JsonPortRow {
  readonly id: string;
  readonly type: GhResourceKind;
  readonly cardinality: 'one' | 'many';
  readonly nullable?: boolean;
  readonly pointer: string;
  readonly identity: GhJsonIdentity;
  readonly flagsAbsent?: readonly string[];
  readonly workspace?: boolean;
  readonly evidence: string;
}

const number = (field = 'number'): GhJsonIdentity => ({ slot: 'number', field, repositoryPath: null });

/**
 * `--json` 결과의 식별 필드. 키는 command path(공백 결합). 모든 필드는 인벤토리 JSON FIELDS에 있어야 한다(검증기).
 * exporter는 선택한 필드만 쓴다(`pkg/cmdutil/json_flags.go:225-257`, 실측 `--json title` → `[{"title":…}]`).
 */
export const JSON_OUTPUT_PORTS: Readonly<Record<string, readonly JsonPortRow[]>> = {
  'pr list': [{ id: 'pull_requests', type: 'pull_request', cardinality: 'many', pointer: '', identity: number(), evidence: 'pkg/cmd/pr/list/list.go:213 PR 배열을 쓴다 · 빈 결과도 `[]`(:203) · `number`는 GraphQL Int!' }],
  'pr view': [{ id: 'pull_request', type: 'pull_request', cardinality: 'one', pointer: '', identity: number(), evidence: 'pkg/cmd/pr/view/view.go:126 PR 객체 하나' }],
  'pr status': [
    { id: 'created_by', type: 'pull_request', cardinality: 'many', pointer: '/createdBy', identity: number(), evidence: 'pkg/cmd/pr/status/status.go:168-176 `{currentBranch, createdBy, needsReview}`' },
    { id: 'needs_review', type: 'pull_request', cardinality: 'many', pointer: '/needsReview', identity: number(), evidence: 'pkg/cmd/pr/status/status.go:168-176' },
    { id: 'current_branch', type: 'pull_request', cardinality: 'one', nullable: true, pointer: '/currentBranch', identity: number(), workspace: true, evidence: 'pkg/cmd/pr/status/status.go:169·174 — --repo로 실행하면 현재 브랜치가 없어 null이다(:98)' },
  ],
  'search prs': [{ id: 'pull_requests', type: 'pull_request', cardinality: 'many', pointer: '', identity: { slot: 'number', field: 'number', repositoryPath: ['repository', 'nameWithOwner'] }, evidence: 'pkg/search/result.go:431-437 `repository.nameWithOwner`는 RepositoryURL의 마지막 두 조각이다' }],
  'issue list': [{ id: 'issues', type: 'issue', cardinality: 'many', pointer: '', identity: number(), evidence: 'pkg/cmd/issue/list — GraphQL issues 연결의 Issue 배열 · `number`' }],
  'issue view': [{ id: 'issue', type: 'issue', cardinality: 'one', pointer: '', identity: number(), evidence: 'pkg/cmd/issue/view/view.go:182 issue 객체 하나' }],
  'issue status': [
    { id: 'created_by', type: 'issue', cardinality: 'many', pointer: '/createdBy', identity: number(), evidence: 'pkg/cmd/issue/status/status.go:99-104 `{createdBy, assigned, mentioned}`' },
    { id: 'assigned', type: 'issue', cardinality: 'many', pointer: '/assigned', identity: number(), evidence: 'pkg/cmd/issue/status/status.go:99-104' },
    { id: 'mentioned', type: 'issue', cardinality: 'many', pointer: '/mentioned', identity: number(), evidence: 'pkg/cmd/issue/status/status.go:99-104' },
  ],
  'search issues': [{ id: 'issues', type: 'issue', cardinality: 'many', pointer: '', identity: { slot: 'number', field: 'number', repositoryPath: ['repository', 'nameWithOwner'] }, flagsAbsent: ['include-prs'], evidence: 'pkg/search/result.go:431-437 · `--include-prs`면 PR이 섞인다(pkg/cmd/search/issues/issues.go:86)' }],
  'run list': [{ id: 'workflow_runs', type: 'workflow_run', cardinality: 'many', pointer: '', identity: { slot: 'id', field: 'databaseId', repositoryPath: null }, evidence: 'pkg/cmd/run/shared/shared.go:175-176 `databaseId`=run ID · run rerun이 받는 값(rerun.go:44·72, help :56-58)' }],
  'run view': [{ id: 'workflow_run', type: 'workflow_run', cardinality: 'one', pointer: '', identity: { slot: 'id', field: 'databaseId', repositoryPath: null }, evidence: 'pkg/cmd/run/view/view.go:286 run 객체 하나 · shared.go:175-176' }],
  'release list': [{ id: 'releases', type: 'release', cardinality: 'many', pointer: '', identity: { slot: 'ref', field: 'tagName', repositoryPath: null }, evidence: 'pkg/cmd/release/shared/fetch.go:25-38 `tagName` · release view [<tag>]가 받는 값' }],
  'release view': [{ id: 'release', type: 'release', cardinality: 'one', pointer: '', identity: { slot: 'ref', field: 'tagName', repositoryPath: null }, evidence: 'pkg/cmd/release/view/view.go:115 release 객체 하나' }],
  'repo list': [{ id: 'repositories', type: 'repository', cardinality: 'many', pointer: '', identity: { slot: 'repository', field: 'nameWithOwner', repositoryPath: null }, evidence: 'api/query_builder.go:476 `nameWithOwner`' }],
  'repo view': [{ id: 'repository', type: 'repository', cardinality: 'one', pointer: '', identity: { slot: 'repository', field: 'nameWithOwner', repositoryPath: null }, evidence: 'pkg/cmd/repo/view/view.go:148 저장소 객체 하나 · `nameWithOwner`' }],
  'search repos': [{ id: 'repositories', type: 'repository', cardinality: 'many', pointer: '', identity: { slot: 'repository', field: 'fullName', repositoryPath: null }, evidence: 'pkg/search/result.go:38-43 RepositoryFields `fullName`' }],
  'extension search': [{ id: 'repositories', type: 'repository', cardinality: 'many', pointer: '', identity: { slot: 'repository', field: 'fullName', repositoryPath: null }, evidence: 'pkg/cmd/extension/command.go:250 search.RepositoryFields · `fullName`' }],
  'workflow list': [{ id: 'workflows', type: 'workflow', cardinality: 'many', pointer: '', identity: { slot: 'id', field: 'id', repositoryPath: null }, evidence: 'pkg/cmd/workflow/list/list.go:28-33 `id`(shared.go:36 ID int64) · workflow view가 숫자 ID로 찾는다(shared.go:130-136)' }],
  'codespace list': [{ id: 'codespaces', type: 'codespace', cardinality: 'many', pointer: '', identity: { slot: 'id', field: 'name', repositoryPath: null }, evidence: 'internal/codespaces/api/api.go:284-296 `name` · codespace 명령의 --codespace가 받는 값' }],
  'codespace view': [{ id: 'codespace', type: 'codespace', cardinality: 'one', pointer: '', identity: { slot: 'id', field: 'name', repositoryPath: null }, evidence: 'internal/codespaces/api/api.go:298-300 `name`' }],
  'discussion list': [{ id: 'discussions', type: 'discussion', cardinality: 'many', pointer: '', identity: number(), evidence: 'pkg/cmd/discussion/list/list.go:38-40 `number`' }],
  'discussion view': [{ id: 'discussion', type: 'discussion', cardinality: 'one', pointer: '', identity: number(), evidence: 'pkg/cmd/discussion/view/view.go:317 discussion 객체 하나' }],
  'search commits': [{ id: 'commits', type: 'commit', cardinality: 'many', pointer: '', identity: { slot: 'ref', field: 'sha', repositoryPath: ['repository', 'fullName'] }, evidence: 'pkg/search/result.go:27-31·340-350 `sha`·`repository.fullName`' }],
};

interface UrlPortRow {
  readonly id: string;
  readonly type: GhResourceKind;
  readonly cardinality: 'one' | 'many';
  readonly grammar: GhUrlGrammar;
  readonly repository: 'execution_context' | 'url';
  readonly flagsAbsent?: readonly string[];
  readonly evidence: string;
}

/** 비TTY stdout이 URL(줄마다 하나)인 command. 문법은 `resource-ref.ts`의 gh 파서 근거를 따른다. */
export const URL_OUTPUT_PORTS: Readonly<Record<string, UrlPortRow>> = {
  'pr create': { id: 'pull_request', type: 'pull_request', cardinality: 'one', grammar: 'pull_request', repository: 'execution_context', flagsAbsent: ['web', 'dry-run'], evidence: 'pkg/cmd/pr/create/create.go:1069 `fmt.Fprintln(opts.IO.Out, pr.URL)` · --dry-run은 요약 텍스트(:1111-1149)' },
  'pr edit': { id: 'pull_request', type: 'pull_request', cardinality: 'one', grammar: 'pull_request', repository: 'execution_context', evidence: 'pkg/cmd/pr/edit/edit.go:363 `fmt.Fprintln(opts.IO.Out, pr.URL)`' },
  'pr revert': { id: 'pull_request', type: 'pull_request', cardinality: 'one', grammar: 'pull_request', repository: 'execution_context', evidence: 'pkg/cmd/pr/revert/revert.go:129 되돌리기 PR의 URL' },
  'issue create': { id: 'issue', type: 'issue', cardinality: 'one', grammar: 'issue', repository: 'execution_context', flagsAbsent: ['web'], evidence: 'pkg/cmd/issue/create/create.go:424 `fmt.Fprintln(opts.IO.Out, newIssue.URL)`' },
  'issue edit': { id: 'issues', type: 'issue', cardinality: 'many', grammar: 'issue', repository: 'execution_context', evidence: 'pkg/cmd/issue/edit/edit.go:436-440 고친 issue URL을 정렬해 줄마다 하나' },
  'issue transfer': { id: 'issue', type: 'issue', cardinality: 'one', grammar: 'issue', repository: 'url', evidence: 'pkg/cmd/issue/transfer/transfer.go:98·132 이관된 issue의 URL — 목적 저장소에 있다' },
  'repo create': { id: 'repository', type: 'repository', cardinality: 'one', grammar: 'repository', repository: 'url', flagsAbsent: ['source'], evidence: 'pkg/cmd/repo/create/create.go:408 비TTY `fmt.Fprintln(opts.IO.Out, repo.URL)` · --source는 다른 흐름(:541)' },
  'repo fork': { id: 'repository', type: 'repository', cardinality: 'one', grammar: 'repository', repository: 'url', evidence: 'pkg/cmd/repo/fork/fork.go:239 비TTY 포크 저장소 URL' },
  'discussion create': { id: 'discussion', type: 'discussion', cardinality: 'one', grammar: 'discussion', repository: 'execution_context', evidence: 'pkg/cmd/discussion/create/create.go:196 `fmt.Fprintln(opts.IO.Out, discussion.URL)`' },
  'discussion edit': { id: 'discussion', type: 'discussion', cardinality: 'one', grammar: 'discussion', repository: 'execution_context', evidence: 'pkg/cmd/discussion/edit/edit.go:218 `fmt.Fprintln(opts.IO.Out, updated.URL)`' },
};

export function outputPortsOf(command: GhInventoryCommand, sensitivity: GhResultSensitivity): readonly GhPort[] {
  const key = command.path.join(' ');
  const jsonRows = JSON_OUTPUT_PORTS[key] ?? [];
  const ports: GhPort[] = jsonRows.map((row) => {
    const schema = key === 'pr list' ? PR_LIST_RESULT_SCHEMA : jsonSchemaName(key);
    const fields = [row.identity.field, ...(row.identity.repositoryPath === null ? [] : [row.identity.repositoryPath[0] ?? ''])];
    const conditions: GhPortCondition[] = [
      { code: 'output_mode', detail: '`--json`으로 실행한 결과여야 한다 — 기본 출력(표)·--jq·--template에는 port가 없다' },
      { code: 'json_fields_selected', detail: fields.join(',') },
    ];
    for (const flag of row.flagsAbsent ?? []) conditions.push({ code: 'flag_absent', detail: `--${flag}` });
    if (row.identity.repositoryPath !== null) conditions.push({ code: 'repository_from_output', detail: row.identity.repositoryPath.join('.') });
    if (row.identity.slot === 'repository') conditions.push({ code: 'repository_from_output', detail: row.identity.field });
    if (row.workspace === true) conditions.push({ code: 'workspace_required', detail: '현재 브랜치가 있어야 값이 생긴다 — 실행기에는 작업 트리가 없어 null이다' });
    return {
      id: row.id,
      direction: 'output',
      type: row.type,
      cardinality: row.cardinality,
      required: row.nullable !== true,
      nullable: row.nullable === true,
      sensitivity,
      conditions,
      source: { adapter: 'native_json', mode: 'json', schema, pointer: row.pointer, identity: row.identity },
      slot: null,
      basis: basis('json-identity', `${GH_SOURCE} ${row.evidence}`),
    };
  });
  const urlRow = URL_OUTPUT_PORTS[key];
  if (urlRow !== undefined) {
    const conditions: GhPortCondition[] = [
      { code: 'output_mode', detail: '기본 출력(비TTY)이어야 한다 — 줄마다 URL 하나' },
      { code: 'url_matches_context', detail: urlRow.repository === 'execution_context' ? 'URL의 호스트와 저장소가 실행 컨텍스트와 같아야 참조가 된다 — 참조의 저장소는 컨텍스트의 값이다' : 'URL의 호스트가 실행 컨텍스트와 같아야 참조가 된다' },
    ];
    if (urlRow.repository === 'url') conditions.push({ code: 'repository_from_output', detail: '결과가 다른 저장소에 생긴다 — 저장소를 URL에서 읽는다' });
    for (const flag of urlRow.flagsAbsent ?? []) conditions.push({ code: 'flag_absent', detail: `--${flag}` });
    ports.push({
      id: urlRow.id,
      direction: 'output',
      type: urlRow.type,
      cardinality: urlRow.cardinality,
      required: true,
      nullable: false,
      sensitivity,
      conditions,
      source: { adapter: 'resource_url', mode: 'text', grammar: urlRow.grammar, repository: urlRow.repository },
      slot: null,
      basis: basis('url-grammar', `${GH_SOURCE} ${urlRow.evidence}`),
    });
  }
  return ports;
}
