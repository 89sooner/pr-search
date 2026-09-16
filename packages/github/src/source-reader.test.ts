import { describe, expect, it, vi } from 'vitest';
import { GitHubSourceReader } from './source-reader.js';
import type { GitHubTransport } from './transport.js';

describe('read-only source adapter wire contract', () => {
  it('uses pooled realtime REST reads and encodes path segments, never a download URL', async () => {
    const get = vi.fn().mockResolvedValue({}); const getPage = vi.fn().mockResolvedValue({ body: [], nextPage: null });
    const reader = new GitHubSourceReader({ get, getPage } as unknown as GitHubTransport);
    const ref = { owner: 'acme', repo: 'app' }; const sha = 'a'.repeat(40);
    await reader.content(ref, sha, 'src/a b.ts');
    expect(get).toHaveBeenLastCalledWith({ org: 'acme', path: '/repos/acme/app/contents/src/a%20b.ts', priority: 'realtime', query: { ref: sha } });
    await reader.branch(ref, 'release/1');
    expect(get).toHaveBeenLastCalledWith({ org: 'acme', path: '/repos/acme/app/branches/release%2F1', priority: 'realtime' });
    await reader.history(ref, sha, 'src', 2);
    expect(getPage).toHaveBeenLastCalledWith({ org: 'acme', path: '/repos/acme/app/commits', priority: 'realtime', query: { sha, path: 'src', page: 2, per_page: 50 } });
    await reader.changes(ref, { pr: 7 }, 3);
    expect(getPage).toHaveBeenLastCalledWith({ org: 'acme', path: '/repos/acme/app/pulls/7/files', priority: 'realtime', query: { page: 3, per_page: 100 } });
  });
  it('requests non-recursive trees and minimal git commit objects', async () => {
    const get = vi.fn().mockResolvedValue({}); const reader = new GitHubSourceReader({ get } as unknown as GitHubTransport);
    const sha = 'b'.repeat(40); await reader.tree({ owner: 'acme', repo: 'app' }, sha); await reader.commit({ owner: 'acme', repo: 'app' }, sha);
    expect(get.mock.calls[0]?.[0]).toEqual({ org: 'acme', path: `/repos/acme/app/git/trees/${sha}`, priority: 'realtime' });
    expect(get.mock.calls[1]?.[0]).toEqual({ org: 'acme', path: `/repos/acme/app/git/commits/${sha}`, priority: 'realtime' });
  });
});
