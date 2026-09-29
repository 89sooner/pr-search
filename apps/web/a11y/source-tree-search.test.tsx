/**
 * CR-133 / WP-114: the Files & folders search looks through every file path of the pinned revision, not only the root
 * entries.
 *
 * `fetch` is a fake source API: the root tree and `/paths` pages (optionally held open so that a test can see the
 * listing in progress, cancel it and continue).
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourcePathEntry } from '@prs/contracts';

const { SourceTree } = await import('../components/source/SourceTree');

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { 'color-contrast': { enabled: false } } });
  return results.violations;
}
const REPO = 'acme/payments';
const HEAD = 'a'.repeat(40); const OTHER = 'b'.repeat(40); const TREE = 'c'.repeat(40);
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const file = (path: string): SourcePathEntry => ({ path, kind: 'file' });
/** In path order, as the server sends them. */
const PATHS: SourcePathEntry[] = [
  file('README.md'), file('deep/l1/l2/l3/leaf.c'), file('src/a/config.h'), file('src/a/main.c'), file('src/b/config.h'),
  { path: 'src/link', kind: 'symlink' }, file('tests/config.h'), file('tests/run.sh'),
];

interface Api { paths?: SourcePathEntry[]; pageSize?: number; incomplete?: boolean; holdAfterFirst?: boolean; failOnce?: string }
/** Records every URL. Root tree: folders `src`, `tests`, `deep` and `README.md`. `/paths`: `pageSize` paths per page. */
function stubApi(api: Api) {
  const calls: string[] = [];
  const state = { revision: HEAD, held: [] as (() => void)[], aborted: 0, failOnce: api.failOnce };
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    calls.push(input);
    const url = new URL(input, 'http://localhost');
    const op = url.pathname.split('/').at(-1);
    const query = url.searchParams;
    if (op === 'tree') {
      const entries = query.get('path') ? [] : [
        { path: 'deep', name: 'deep', sha: TREE, kind: 'directory', size: null }, { path: 'src', name: 'src', sha: TREE, kind: 'directory', size: null },
        { path: 'tests', name: 'tests', sha: TREE, kind: 'directory', size: null }, { path: 'README.md', name: 'README.md', sha: TREE, kind: 'file', size: 10 },
      ];
      return ok({ repository: REPO, ref: 'main', revision: state.revision, path: query.get('path') ?? '', entries, truncated: false, tree_sha: TREE, offset: 0, next_offset: null, total: entries.length });
    }
    if (op === 'paths') {
      const all = api.paths ?? PATHS;
      const size = api.pageSize ?? 1_000_000;
      const after = query.get('after');
      const start = after === null ? 0 : all.findIndex((entry) => entry.path === after) + 1;
      const page = all.slice(start, start + size);
      const body = { repository: REPO, revision: query.get('revision'), paths: page, next_after: start + size < all.length ? page.at(-1)!.path : null, incomplete: api.incomplete ?? false };
      if (state.failOnce !== undefined && after === state.failOnce) {
        state.failOnce = undefined;
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 'SOURCE_UNAVAILABLE', message: 'Source data could not be loaded from GitHub. Please retry.' } }), { status: 502 }));
      }
      if (api.holdAfterFirst && after !== null) {
        return new Promise<Response>((resolve, reject) => {
          state.held.push(() => { resolve(new Response(JSON.stringify(body), { status: 200 })); });
          init?.signal?.addEventListener('abort', () => { state.aborted += 1; reject(new DOMException('aborted', 'AbortError')); });
        });
      }
      return ok(body);
    }
    return ok({});
  });
  return { calls, state, pathCalls: () => calls.filter((call) => call.includes('/paths?')).map((call) => new URL(call, 'http://localhost').searchParams) };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function view(onSelect: (selection: { path: string; kind: 'file' | 'directory'; revision: string }) => void = () => undefined, selectedPath = '') {
  return render(<SourceTree repository={REPO} branch="main" selectedPath={selectedPath} onSelect={onSelect} />);
}
const searchBox = () => screen.getByPlaceholderText('Search files in this revision…');
const results = () => within(screen.getByRole('list', { name: 'Matching files' })).queryAllByRole('button');

describe('CR-133 FR-SRC-001 Files & folders searches every path of the pinned revision', () => {
  it('FR-SRC-001 finds deep files and every file with the same name without opening a folder, reading the list once', async () => {
    const { calls, pathCalls } = stubApi({});
    const user = userEvent.setup();
    const { container } = view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'config.h');
    expect(await screen.findByText('3 matches')).toBeInTheDocument();
    expect(results().map((button) => button.textContent)).toEqual(['config.hsrc/a', 'config.hsrc/b', 'config.htests']);
    expect(results().map((button) => button.getAttribute('title'))).toEqual(['src/a/config.h', 'src/b/config.h', 'tests/config.h']);
    // The tree is hidden while searching, and no folder was listed to find these.
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(calls.filter((call) => call.includes('tree_sha='))).toEqual([]);
    await user.clear(searchBox());
    await user.type(searchBox(), 'leaf');
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(results()[0]).toHaveAttribute('title', 'deep/l1/l2/l3/leaf.c');
    await user.type(searchBox(), 'x');
    expect(await screen.findByText('No files in this revision match "leafx".')).toBeInTheDocument();
    // Typing filters the list in memory: one /paths read for the whole session, pinned to the tree's revision.
    expect(pathCalls().map((params) => [params.get('revision'), params.get('after')])).toEqual([[HEAD, null]]);
    expect(await violations(container)).toEqual([]);
  });

  it('FR-SRC-001 a result selects that exact file at the pinned revision, by mouse or keyboard', async () => {
    stubApi({});
    const onSelect = vi.fn();
    const user = userEvent.setup();
    view(onSelect);
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'config');
    await screen.findByText('3 matches');
    await user.click(results()[1]!);
    expect(onSelect).toHaveBeenLastCalledWith({ path: 'src/b/config.h', kind: 'file', revision: HEAD });
    searchBox().focus();
    await user.keyboard('{ArrowDown}');
    expect(results()[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith({ path: 'tests/config.h', kind: 'file', revision: HEAD });
    await user.keyboard('{Home}');
    expect(results()[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(searchBox()).toHaveFocus();
    await user.clear(searchBox());
    await user.type(searchBox(), 'src/link');
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(results()[0]).toHaveTextContent('link');
    await user.click(results()[0]!);
    expect(onSelect).toHaveBeenLastCalledWith({ path: 'src/link', kind: 'file', revision: HEAD });
  });

  it('FR-SRC-001 never says "no files match" before the whole list is read; Cancel stops the reading and Continue picks it up', async () => {
    const { state, pathCalls } = stubApi({ pageSize: 3, holdAfterFirst: true });
    const user = userEvent.setup();
    const { container } = view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'zzz');
    expect(await screen.findByText(/Listing files… 3 paths · 0 matches so far/)).toBeInTheDocument();
    expect(screen.queryByText(/No files in this revision match/)).not.toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/Listing stopped after 3 paths · 0 matches so far, so the results may be incomplete\./)).toBeInTheDocument();
    expect(state.aborted).toBe(1);
    expect(screen.queryByText(/No files in this revision match/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue listing' }));
    // Continue asks for the page after the last path read, not from the start.
    await waitFor(() => { expect(pathCalls().map((params) => params.get('after'))).toEqual([null, 'src/a/config.h', 'src/a/config.h']); });
    expect(screen.queryByText(/No files in this revision match/)).not.toBeInTheDocument();
    for (let round = 0; round < 5 && !screen.queryByText(/No files in this revision match/); round += 1) {
      state.held.splice(0).forEach((release) => { release(); });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await screen.findByText('No files in this revision match "zzz".')).toBeInTheDocument();
    expect(pathCalls().at(-1)?.get('after')).toBe('src/link');
  });

  it('FR-SRC-001 clearing the search brings the tree back; a new revision discards the list and reads it again', async () => {
    const { state, pathCalls } = stubApi({});
    const user = userEvent.setup();
    view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'readme');
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    await user.clear(searchBox());
    expect(await screen.findByRole('tree', { name: 'Files and folders' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Matching files' })).not.toBeInTheDocument();
    await user.type(searchBox(), 'readme');
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(pathCalls()).toHaveLength(1);
    state.revision = OTHER;
    await user.click(screen.getByRole('button', { name: 'Refresh file tree' }));
    await waitFor(() => { expect(pathCalls().map((params) => params.get('revision'))).toEqual([HEAD, OTHER]); });
    expect(await screen.findByText('1 match')).toBeInTheDocument();
  });

  it('FR-SRC-001 draws at most 200 results, says how many there are, and names a partial GitHub listing', async () => {
    stubApi({ paths: Array.from({ length: 250 }, (_, index) => file(`mod/m${String(index).padStart(3, '0')}.ts`)), incomplete: true });
    const user = userEvent.setup();
    view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'mod');
    expect(await screen.findByText('250 matches · showing the first 200, type more to narrow the list')).toBeInTheDocument();
    expect(results()).toHaveLength(200);
    expect(screen.getByText('GitHub returned a partial listing for a directory, so some files may be missing.')).toBeInTheDocument();
  });

  it('FR-SRC-001 an error keeps the paths read so far and Retry continues from there', async () => {
    const { pathCalls } = stubApi({ pageSize: 3, failOnce: 'src/a/config.h' });
    const user = userEvent.setup();
    view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'config');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Source data could not be loaded from GitHub. Please retry.');
    expect(screen.queryByText(/No files in this revision match/)).not.toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('3 matches')).toBeInTheDocument();
    expect(pathCalls().map((params) => params.get('after'))).toEqual([null, 'src/a/config.h', 'src/a/config.h', 'src/link']);
  });
});
