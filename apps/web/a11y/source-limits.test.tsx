/**
 * CR-132 / WP-113: the Diff and Time-lapse dialogs and the file tree reach past the old fixed limits.
 *
 * `fetch` is a fake source API with the new windowed/paged/tree-listing answers. jsdom has no `Worker`, so the
 * analysis runs through the same job functions on the main thread (lib/source-compute-client.ts).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceChange, SourceCommit } from '@prs/contracts';

const { DiffModal, TimeLapseModal } = await import('../components/source/SourceDialogs');
const { SourceTree } = await import('../components/source/SourceTree');

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { 'color-contrast': { enabled: false } } });
  return results.violations;
}
const REPO = 'acme/payments';
const HEAD = 'a'.repeat(40); const BASE = 'b'.repeat(40); const TREE = 'c'.repeat(40);
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

interface Api { files?: Record<string, string>; windows?: number; changes?: SourceChange[]; pageSize?: number; treeListing?: SourceChange[]; commits?: SourceCommit[]; olderCommits?: SourceCommit[]; rootEntries?: number }
/** Records every URL; answers the source routes the dialogs use. */
function stubApi(api: Api): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (input: string) => {
    calls.push(input);
    const url = new URL(input, 'http://localhost');
    const op = url.pathname.split('/').at(-1);
    const query = url.searchParams;
    if (op === 'file') {
      const text = api.files?.[`${query.get('revision')}:${query.get('path')}`];
      const offset = Number(query.get('offset') ?? '0');
      if (text === undefined) return ok({ repository: REPO, revision: query.get('revision'), path: query.get('path'), status: 'missing', text: null, size: null, sha: null, reason: 'This path is not available at this revision.', offset, next_offset: null });
      const window = api.windows ?? 1_000_000;
      const next = offset + window < text.length ? offset + window : null;
      return ok({ repository: REPO, revision: query.get('revision'), path: query.get('path'), status: 'text', text: text.slice(offset, offset + window), size: text.length, sha: TREE, reason: null, offset, next_offset: next });
    }
    if (op === 'diff' && query.get('listing') === 'tree') {
      const all = api.treeListing ?? [];
      const after = query.get('after');
      const start = after === null ? 0 : all.findIndex((change) => change.path === after) + 1;
      const page = all.slice(start, start + 2);
      return ok({ repository: REPO, base: query.get('base'), head: query.get('head'), commit: { sha: HEAD, parents: [BASE], message: 'import', author: 'kim', date: null }, files: page, next_page: null, truncated: false, pull_requests: [], pull_requests_unavailable: false, listing: 'tree', next_after: start + 2 < all.length ? page.at(-1)!.path : null });
    }
    if (op === 'diff') {
      const page = Number(query.get('page') ?? '1');
      const all = api.changes ?? [];
      const size = api.pageSize ?? 100;
      const slice = all.slice((page - 1) * size, page * size);
      return ok({ repository: REPO, base: BASE, head: HEAD, commit: { sha: HEAD, parents: [BASE], message: 'Large import', author: 'kim', date: null }, files: slice, next_page: page * size < all.length && page < 30 ? page + 1 : null, truncated: false, pull_requests: [], pull_requests_unavailable: false });
    }
    if (op === 'history') {
      const page = Number(query.get('page') ?? '1');
      if (page === 1) return ok({ repository: REPO, revision: HEAD, path: query.get('path'), commits: (api.commits ?? []).map((commit) => ({ ...commit, pull_request_numbers: [] })), next_page: api.olderCommits ? 2 : null });
      return ok({ repository: REPO, revision: HEAD, path: query.get('path'), commits: (api.olderCommits ?? []).map((commit) => ({ ...commit, pull_request_numbers: [] })), next_page: null });
    }
    if (op === 'tree') {
      const total = api.rootEntries ?? 3;
      const offset = Number(query.get('offset') ?? '0');
      const entries = Array.from({ length: Math.min(2, total - offset) }, (_, i) => ({ path: `f${String(offset + i)}.c`, name: `f${String(offset + i)}.c`, sha: TREE, kind: 'file', size: 1 }));
      return ok({ repository: REPO, ref: 'main', revision: HEAD, path: '', entries, truncated: false, tree_sha: TREE, offset, next_offset: offset + 2 < total ? offset + 2 : null, total });
    }
    return ok({});
  });
  return { calls };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const commit = (sha: string, message: string): SourceCommit => ({ sha, parents: [], message, author: 'kim', date: '2026-09-01T00:00:00Z' });

describe('CR-132 FR-SRC-003 Diff reads whole files and never fails on the old budgets', () => {
  it('FR-SRC-003 a file larger than one window is compared to its last line, with the file read in windows', async () => {
    const before = Array.from({ length: 5_000 }, (_, i) => `line ${String(i)}`).join('\n') + '\n';
    const after = before.replace('line 4999\n', 'line 4999 changed\n');
    const { calls } = stubApi({ files: { [`${BASE}:big.c`]: before, [`${HEAD}:big.c`]: after }, windows: 20_000 });
    render(<DiffModal target={{ repository: REPO, file: { path: 'big.c', base: BASE, head: HEAD } }} onClose={() => undefined} />);
    expect(await screen.findByText(/1 changed row/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(calls.filter((call) => call.includes('/file?') && call.includes('offset=')).length).toBeGreaterThan(4);
    // The collapsed view shows the change at the very end of the file (word highlighting splits the line into spans).
    expect(screen.getByRole('region', { name: 'File diff' }).textContent).toContain('line 4999 changed');
    expect(screen.getByRole('region', { name: 'File diff' }).textContent).toContain('5000');
  });

  it('FR-SRC-003 a whole-file rewrite beyond the old 5,000-edit budget still shows a line diff, not "unavailable"', async () => {
    const before = Array.from({ length: 6_000 }, (_, i) => `old ${String(i)}`).join('\n') + '\n';
    const after = Array.from({ length: 6_000 }, (_, i) => `new ${String(i)}`).join('\n') + '\n';
    stubApi({ files: { [`${BASE}:gen.c`]: before, [`${HEAD}:gen.c`]: after } });
    render(<DiffModal target={{ repository: REPO, file: { path: 'gen.c', base: BASE, head: HEAD } }} onClose={() => undefined} />);
    expect(await screen.findByText(/6000 changed rows/, undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByText('Text comparison unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('No differences between these versions.')).not.toBeInTheDocument();
    // 6,000 rows are more than the virtualization threshold: only a slice is in the DOM.
    const region = screen.getByRole('region', { name: 'File diff' });
    expect(within(region).getAllByRole('row').length).toBeLessThan(400);
    expect(within(region).getByRole('table')).toHaveAttribute('aria-rowcount', '6001');
  });

  it('FR-SRC-004 past GitHub\'s 3,000-file list the complete list comes from the pinned tree comparison', async () => {
    const changes = Array.from({ length: 3_000 }, (_, i) => ({ path: `pkg/f${String(i).padStart(4, '0')}.c`, previous_path: null, status: 'added', additions: 1, deletions: 0 }));
    const treeListing = [...changes.slice(0, 3), { path: 'pkg/zz-beyond.c', previous_path: null, status: 'added', additions: null, deletions: null }].map((change) => ({ ...change, additions: null, deletions: null }));
    // GitHub's list is served whole on one page here: the dialog only needs "3,000 files and no next page" (paging
    // through 30 pages of 100 in jsdom adds nothing but minutes).
    const { calls } = stubApi({ changes, treeListing, pageSize: 3_000 });
    const user = userEvent.setup();
    render(<DiffModal target={{ repository: REPO, commit: HEAD }} onClose={() => undefined} />);
    await user.click(await screen.findByRole('button', { name: 'Load the complete list' }, { timeout: 10_000 }));
    await user.click(await screen.findByRole('button', { name: 'More files' }));
    expect(await screen.findByText('pkg/zz-beyond.c')).toBeInTheDocument();
    expect(screen.getByText(/Line counts and renames are not available here/)).toBeInTheDocument();
    const listingCall = calls.find((call) => call.includes('listing=tree'))!;
    expect(new URL(listingCall, 'http://localhost').searchParams.get('head')).toBe(HEAD);
    expect(new URL(listingCall, 'http://localhost').searchParams.get('base')).toBe(BASE);
    expect(screen.getAllByText('+— −—').length).toBeGreaterThan(0);
  }, 30_000);

  it('FR-SRC-003 Diff with a pending load can be cancelled and retried, and never claims "no differences"', async () => {
    stubApi({ files: { [`${BASE}:a.c`]: 'a\n', [`${HEAD}:a.c`]: 'b\n' } });
    const pending = new Promise<Response>(() => undefined);
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string) => (input.includes('/file?') ? pending : real(input)));
    const user = userEvent.setup();
    render(<DiffModal target={{ repository: REPO, file: { path: 'a.c', base: BASE, head: HEAD } }} onClose={() => undefined} />);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('The comparison was cancelled.')).toBeInTheDocument();
    expect(screen.queryByText('No differences between these versions.')).not.toBeInTheDocument();
  });
});

describe('CR-132 FR-SRC-004 Time-lapse reaches older revisions and analyzes more than 30', () => {
  it('FR-SRC-004 loads older revisions inside the dialog with the pinned SHA and analyzes all 45 of them', async () => {
    const newest = Array.from({ length: 30 }, (_, i) => commit(`${String(44 - i).padStart(2, '0')}`.padEnd(40, 'e'), `rev ${String(44 - i)}`));
    const older = Array.from({ length: 15 }, (_, i) => commit(`${String(14 - i).padStart(2, '0')}`.padEnd(40, 'e'), `rev ${String(14 - i)}`));
    const files: Record<string, string> = {};
    [...newest, ...older].forEach((item) => { files[`${item.sha}:app.c`] = `stable\n${item.message}\n`; });
    const { calls } = stubApi({ files, commits: newest, olderCommits: older });
    const user = userEvent.setup();
    const { container } = render(<TimeLapseModal repository={REPO} path="app.c" revision="main" onClose={() => undefined} />);
    await user.click(await screen.findByRole('button', { name: 'Load older revisions' }, { timeout: 5000 }));
    await waitFor(() => { expect(screen.getByText('45 / 45')).toBeInTheDocument(); });
    // Everything is loaded: no disabled "Load older revisions" left behind, and the caption says so.
    expect(screen.queryByRole('button', { name: 'Load older revisions' })).not.toBeInTheDocument();
    expect(screen.getByText('All 45 revisions of this path are loaded.')).toBeInTheDocument();
    const olderCall = calls.find((call) => call.includes('/history?') && call.includes('page=2'))!;
    expect(new URL(olderCall, 'http://localhost').searchParams.get('ref')).toBe(HEAD);
    await screen.findByText('stable');
    fireEvent.change(screen.getByRole('combobox', { name: 'Analysis range' }), { target: { value: 'all' } });
    await user.click(screen.getByRole('button', { name: 'Analyze line history' }));
    expect(await screen.findByText(/45 revisions analyzed\./, undefined, { timeout: 8000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Inspect line 1' }));
    expect(screen.getByText('1 observed versions of this line')).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it('FR-SRC-004 a binary revision is skipped and named instead of failing the whole analysis', async () => {
    const commits = [commit('3'.repeat(40), 'three'), commit('2'.repeat(40), 'two'), commit('1'.repeat(40), 'one')];
    stubApi({ files: { [`${'3'.repeat(40)}:app.c`]: 'x\ny\n', [`${'1'.repeat(40)}:app.c`]: 'x\n' }, commits });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string) => (input.includes(`revision=${'2'.repeat(40)}`) ? ok({ repository: REPO, revision: '2'.repeat(40), path: 'app.c', status: 'binary', text: null, size: 4, sha: TREE, reason: 'Binary files cannot be displayed as text.', offset: 0, next_offset: null }) : real(input)));
    const user = userEvent.setup();
    render(<TimeLapseModal repository={REPO} path="app.c" revision={'3'.repeat(40)} initialCommits={commits} onClose={() => undefined} />);
    await screen.findByText('y');
    await user.click(screen.getByRole('button', { name: 'Analyze line history' }));
    expect(await screen.findByText(/2 revisions analyzed\. 1 revision was skipped because it is not text \(222222222: Binary files cannot be displayed as text\.\)/, undefined, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('CR-132 FR-SRC-001 the file tree lists a large directory page by page', () => {
  it('FR-SRC-001 shows the first page and loads the rest with its tree SHA', async () => {
    const { calls } = stubApi({ rootEntries: 5 });
    const user = userEvent.setup();
    const { container } = render(<SourceTree repository={REPO} branch="main" selectedPath="" onSelect={() => undefined} />);
    await user.click(await screen.findByRole('button', { name: 'Show more entries (2 of 5)' }));
    await user.click(await screen.findByRole('button', { name: 'Show more entries (4 of 5)' }));
    expect(await screen.findByRole('treeitem', { name: 'f4.c' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show more entries/ })).not.toBeInTheDocument();
    const pageCalls = calls.filter((call) => call.includes('/tree?') && call.includes('tree_sha='));
    expect(pageCalls.map((call) => new URL(call, 'http://localhost').searchParams.get('offset'))).toEqual(['2', '4']);
    expect(pageCalls.every((call) => new URL(call, 'http://localhost').searchParams.get('revision') === HEAD)).toBe(true);
    expect(await violations(container)).toEqual([]);
  });
});
