/**
 * CR-131 / DEV-787: the Repository workspace's filter suggestions for a search with no results.
 *
 * The server counts every candidate as "the same query without one AST node" (FR-SRCH-006 AC-3, CR-128) and sends
 * `{ remove, would_yield }` back, `remove` being that node written in query syntax. The workspace builds its query from
 * several places: the view itself (`kind:`, `repo:`), the My PRs tabs (`author:<login>`, `is:<tab>`), the filter
 * controls, the file tree (`path`), the range editors, and the free-text box. The parser folds values of the same key
 * and operator into one node, so one suggestion can stand for values that came from more than one place.
 *
 * A suggestion therefore becomes a button only when every place that fed its node can be cleared on this screen **and**
 * clearing them rebuilds exactly the original query minus that node. The second condition is checked, not assumed: the
 * plan is applied to a copy of the URL state, the query is rebuilt with the builder the search itself uses, and the
 * rebuilt AST must equal the original AST without that node. Anything else is never offered as a button — the count the
 * button shows must be the count the user gets.
 */

import {
  analyzeMergeNumberBinding,
  analyzePrNumberBinding,
  analyzeSequenceBinding,
  isRangeFilter,
  parseQuery,
  serializeQuery,
  type QueryAst,
  type QueryFilter,
} from '@prs/query';
import { buildRepositoryQuery, isIdentifierSearch, type RepositoryWorkspaceTab } from './repository-search';

export interface RelaxationHint {
  readonly remove: string;
  readonly would_yield: number;
}

export interface WorkspaceHintContext {
  /** The current URL search params, serialized. */
  readonly serialized: string;
  readonly repository: string;
  readonly tab: RepositoryWorkspaceTab;
  readonly login: string;
  /** The merge-order range resolved from two commit SHAs (component state, not URL). */
  readonly seqRange?: { readonly space: string; readonly range: string };
  /** The GHE URL prefix the workspace uses to recognise pasted PR/commit URLs as identifiers. */
  readonly gheBaseUrl?: string;
}

export type WorkspaceHintPlan =
  | {
      readonly kind: 'action';
      readonly hint: RelaxationHint;
      /** e.g. `Remove author: kim` */
      readonly label: string;
      /** URL param changes for `navigate()`; an empty string deletes the param. */
      readonly changes: Readonly<Record<string, string>>;
      /** The node came from the merge-order range, which lives in component state. */
      readonly clearSeqRange: boolean;
    }
  | {
      readonly kind: 'fixed';
      readonly hint: RelaxationHint;
      /** `view`: set by the workspace itself · `tab`: set by the My PRs tab · `unsafe`: clearing would change more than that node · `unmatched`: not in the current query. */
      readonly reason: 'view' | 'tab' | 'unsafe' | 'unmatched';
    };

/** Equality and range controls, and the URL params that hold each one. */
const EQUALITY_CONTROLS: Readonly<Record<string, readonly string[]>> = {
  base: ['base'],
  author: ['author'],
  label: ['label'],
  // The tree selection is `path` + `path_kind` + `source_ref`; the search filter is `path`. Clear the selection too.
  path: ['path', 'path_kind', 'source_ref'],
  is: ['state'],
};
const RANGE_CONTROLS: Readonly<Record<string, readonly string[]>> = {
  // CR-127: `tz` travels with the dates.
  merged: ['from', 'to', 'tz'],
  pr_number: ['pr_from', 'pr_to'],
  mnum: ['mnum_from', 'mnum_to'],
};

const KEY_NAMES: Readonly<Record<string, string>> = {
  author: 'author',
  label: 'label',
  path: 'path',
  base: 'base branch',
  is: 'status',
  merged: 'merged date',
  created: 'created date',
  pr_number: 'PR numbers',
  mnum: 'M numbers',
  seq: 'merge order',
};

function canonical(filter: QueryFilter): string {
  if (isRangeFilter(filter)) {
    const zone = 'timezone' in filter && filter.timezone !== undefined ? filter.timezone : '';
    return [filter.key, filter.op, String(filter.from), String(filter.to), zone].join('\u0001');
  }
  return [filter.key, filter.op, [...filter.values].sort().join('\u0002')].join('\u0001');
}

function signature(filters: readonly QueryFilter[], text: string | null): string {
  return JSON.stringify({ filters: filters.map(canonical).sort(), text: (text ?? '').trim() });
}

function parseOrNull(text: string): QueryAst | null {
  try {
    return parseQuery(text);
  } catch {
    return null;
  }
}

function sameNode(left: QueryFilter, right: QueryFilter): boolean {
  return canonical(left) === canonical(right);
}

function sameKeyAndOp(left: QueryFilter, right: QueryFilter): boolean {
  return left.key === right.key && left.op === right.op;
}

/** How the button names the filter. */
export function describeFilter(filter: QueryFilter): string {
  const name = KEY_NAMES[filter.key] ?? filter.key;
  const negated = filter.op === 'not_eq' || filter.op === 'not_range';
  let value: string;
  if (isRangeFilter(filter)) {
    const zone = 'timezone' in filter && filter.timezone !== undefined ? filter.timezone : '';
    const zoneLabel = zone === '' ? '' : zone === 'Asia/Seoul' ? ' KST' : ` ${zone}`;
    value = `${String(filter.from)}–${String(filter.to)}${zoneLabel}`;
  } else {
    value = filter.values.join(', ');
  }
  return `${negated ? 'excluded ' : ''}${name}: ${value}`;
}

function rebuild(context: WorkspaceHintContext, serialized: string, clearSeqRange: boolean): QueryAst | null {
  const query = buildRepositoryQuery({
    serialized,
    repository: context.repository,
    tab: context.tab,
    login: context.login,
    ...(context.seqRange !== undefined && !clearSeqRange ? { seqRange: context.seqRange } : {}),
  });
  return parseOrNull(query);
}

/** Plans one server suggestion. Never throws — a suggestion it cannot map is `fixed`, not an error. */
export function planWorkspaceHint(hint: RelaxationHint, context: WorkspaceHintContext): WorkspaceHintPlan {
  const removed = parseOrNull(hint.remove);
  const node = removed !== null && removed.text === null && removed.filters.length === 1 ? removed.filters[0] : undefined;
  const current = rebuild(context, context.serialized, false);
  if (node === undefined || current === null || !current.filters.some((filter) => sameNode(filter, node))) {
    return { kind: 'fixed', hint, reason: 'unmatched' };
  }

  // Set by the workspace itself: which documents it lists and which repository is open.
  if (node.key === 'kind' || node.key === 'repo') return { kind: 'fixed', hint, reason: 'view' };
  // Set by My open PRs / My merged PRs: they are that tab's definition, not a filter the user added.
  if ((context.tab === 'open' || context.tab === 'merged') && node.op === 'eq' && (node.key === 'author' || node.key === 'is')) {
    return { kind: 'fixed', hint, reason: 'tab' };
  }

  const params = new URLSearchParams(context.serialized);
  const changes: Record<string, string> = {};
  let clearSeqRange = false;

  if (node.op === 'eq') {
    for (const param of EQUALITY_CONTROLS[node.key] ?? []) if (params.get(param)) changes[param] = '';
  }
  if (node.op === 'range') {
    for (const param of RANGE_CONTROLS[node.key] ?? []) if (params.get(param)) changes[param] = '';
    if (node.key === 'seq' && context.seqRange !== undefined) clearSeqRange = true;
  }

  // Filters typed into the free-text box: drop only the nodes with this key and operator, keep everything else.
  const typed = params.get('q');
  if (typed) {
    const typedAst = parseOrNull(typed);
    if (typedAst !== null && typedAst.filters.some((filter) => sameKeyAndOp(filter, node))) {
      changes['q'] = serializeQuery({ filters: typedAst.filters.filter((filter) => !sameKeyAndOp(filter, node)), text: typedAst.text });
    }
  }

  // CR-106 (workspace rule): an M number range needs the base branch here — its fields are disabled without one and a
  // submit drops the range. Removing the base alone would leave that range behind, so it is not offered.
  if (changes['base'] === '' && (params.get('mnum_from') || params.get('mnum_to'))) return { kind: 'fixed', hint, reason: 'unsafe' };

  // The check: apply the changes to a copy of the URL state and rebuild with the search's own builder.
  const next = new URLSearchParams(context.serialized);
  for (const [param, value] of Object.entries(changes)) {
    if (value) next.set(param, value);
    else next.delete(param);
  }
  // A free-text box left with only an identifier (`12345`, `abc1234f`, `M-1900-1450`) is looked up, not searched — the
  // result would not be the suggested count (independent review).
  if (isIdentifierSearch(next.get('q') ?? '', context.gheBaseUrl)) return { kind: 'fixed', hint, reason: 'unsafe' };
  const rebuilt = rebuild(context, next.toString(), clearSeqRange);
  const expected = current.filters.filter((filter) => !sameNode(filter, node));
  if (rebuilt === null || signature(rebuilt.filters, rebuilt.text) !== signature(expected, current.text)) {
    return { kind: 'fixed', hint, reason: 'unsafe' };
  }
  // The server already skips such candidates (CR-051, CR-106); a second line so a button never leads to a 400.
  if (
    analyzeSequenceBinding(rebuilt).kind === 'invalid' ||
    analyzeMergeNumberBinding(rebuilt).kind === 'invalid' ||
    analyzePrNumberBinding(rebuilt).kind === 'invalid'
  ) {
    return { kind: 'fixed', hint, reason: 'unsafe' };
  }
  return { kind: 'action', hint, label: `Remove ${describeFilter(node)}`, changes, clearSeqRange };
}

export function planWorkspaceHints(hints: readonly RelaxationHint[], context: WorkspaceHintContext): readonly WorkspaceHintPlan[] {
  return hints.map((hint) => planWorkspaceHint(hint, context));
}

export function resultCount(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'result' : 'results'}`;
}
