export type RepositoryWorkspaceTab = 'search' | 'history' | 'open' | 'merged';
const quote = (value: string): string => JSON.stringify(value);

/** CR-111: which range editor the consolidated Range filter selector shows. */
export type RangeType = 'pr' | 'mnum' | 'date' | 'seq';

/**
 * Which range type a freshly loaded page should show, from whichever URL-persisted range already
 * has a value. SHA/merge-order isn't URL-persisted (CR-106: it needs a live re-resolve), so it can't
 * be detected here and isn't part of this derivation -- 'pr' is the fallback when nothing is active.
 */
export function deriveInitialRangeType(serialized: string): RangeType {
  const values = new URLSearchParams(serialized);
  if (values.get('pr_from') || values.get('pr_to')) return 'pr';
  if (values.get('mnum_from') || values.get('mnum_to')) return 'mnum';
  if (values.get('from') || values.get('to')) return 'date';
  return 'pr';
}

export function buildRepositoryQuery(input: { serialized: string; repository: string; tab: RepositoryWorkspaceTab; login: string; seqRange?: { space: string; range: string } }): string {
  const values = new URLSearchParams(input.serialized);
  const filters = [`kind:${input.tab === 'history' ? 'commit' : 'pull_request'}`, `repo:${quote(input.repository)}`];
  for (const key of ['base', 'author', 'label', 'path', 'state']) {
    const value = values.get(key);
    if (!value || (key === 'state' && (input.tab === 'open' || input.tab === 'merged')) || (key === 'author' && (input.tab === 'open' || input.tab === 'merged'))) continue;
    filters.push(key === 'state' ? `is:${value}` : `${key}:${quote(value)}`);
  }
  if (input.tab === 'open' || input.tab === 'merged') filters.push(`author:${quote(input.login)}`, `is:${input.tab}`);
  const from = values.get('from'); const to = values.get('to');
  if (from && to) filters.push(`merged:${from}..${to}`);
  const prFrom = values.get('pr_from'); const prTo = values.get('pr_to');
  if (prFrom && prTo) filters.push(`pr_number:${prFrom}..${prTo}`);
  const mnumFrom = values.get('mnum_from'); const mnumTo = values.get('mnum_to');
  if (mnumFrom && mnumTo) filters.push(`mnum:${mnumFrom}..${mnumTo}`);
  // seqRange is resolved client-side from two commit SHAs (CR-106); it's stale once repo/base no longer match the space it was resolved against.
  if (input.seqRange && input.seqRange.space === `${input.repository}@${values.get('base') ?? ''}`) filters.push(`seq:${input.seqRange.range}`);
  const text = values.get('q')?.trim(); if (text) filters.push(text);
  return filters.join(' ');
}

export function repositorySort(tab: RepositoryWorkspaceTab, supplied: string | null): string {
  return supplied ?? (tab === 'history' ? 'merge_seq' : 'pr_number');
}

export function repositoryLabelOptions(current: string, facets: readonly { value: string }[]): { value: string; label: string }[] {
  const values = [current, ...facets.map(item => item.value)].filter(Boolean);
  return [{ value: '', label: 'All labels' }, ...[...new Set(values)].map(value => ({ value, label: value }))];
}

/** One `/api/resolve` candidate's fields relevant to a merge-order range (CR-106). Structural on purpose so callers can pass a `ResolutionCandidate` without this file importing it. */
export interface SeqRangeCandidate { kind: 'commit' | 'pull_request'; merge_seq: number | null; sequence_space: string | null }

export type ShaRangeOutcome = { kind: 'ok'; space: string; range: string } | { kind: 'error'; message: string };

function singleCommit(candidates: readonly SeqRangeCandidate[]): SeqRangeCandidate | null {
  const commits = candidates.filter(candidate => candidate.kind === 'commit');
  const [only] = commits;
  return commits.length === 1 && only !== undefined ? only : null;
}

// CR-106: two resolved commits -> seq:<min>..<max>. Reversed input is an error, never auto-swapped.
export function buildShaRangeFilter(input: { repository: string; base: string; fromCandidates: readonly SeqRangeCandidate[]; toCandidates: readonly SeqRangeCandidate[] }): ShaRangeOutcome {
  const from = singleCommit(input.fromCandidates); const to = singleCommit(input.toCandidates);
  if (!from || !to) return { kind: 'error', message: !from && !to ? "Both commit SHAs could not be resolved to a single commit." : "One of the commit SHAs could not be resolved to a single commit." };
  if (from.merge_seq === null || to.merge_seq === null) return { kind: 'error', message: "One or both commits do not have a merge sequence number yet." };
  const space = `${input.repository}@${input.base}`;
  if (from.sequence_space !== space || to.sequence_space !== space) return { kind: 'error', message: "Both commits must belong to the selected repository and base branch." };
  if (from.merge_seq > to.merge_seq) return { kind: 'error', message: "The first commit merges after the second. Enter the commits in merge order." };
  return { kind: 'ok', space, range: `${from.merge_seq}..${to.merge_seq}` };
}
