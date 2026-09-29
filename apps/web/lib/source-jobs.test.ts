import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatBytes, loadFileText } from './source-client';
import { computeDiff, computeTrace, isAbortError } from './source-compute-client';
import { ROW_CHANGE, lineEvents } from './source-compute';
import { TRACE_MAX_CELLS, displayLine, rawLines, runDiffJob, runTraceJob } from './source-jobs';

/** A fake `/api/source/.../file` that serves each (revision, path) in windows of `window` characters. */
function fileServer(files: Record<string, { text?: string; status?: string; reason?: string; binaryFrom?: number }>, window = 10) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push(input);
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const url = new URL(input, 'http://localhost');
    const key = `${url.searchParams.get('revision')}:${url.searchParams.get('path')}`;
    const file = files[key];
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (file === undefined) return new Response(JSON.stringify({ status: 'missing', text: null, size: null, sha: null, reason: 'This path is not available at this revision.', offset, next_offset: null }), { status: 200 });
    // A NUL past the first window: the server answers that window (and only that one) as binary.
    if (file.binaryFrom !== undefined && offset >= file.binaryFrom) return new Response(JSON.stringify({ status: 'binary', text: null, size: (file.text ?? '').length, sha: 'b'.repeat(40), reason: 'Binary files cannot be displayed as text.', offset, next_offset: null }), { status: 200 });
    if (file.status !== undefined && file.status !== 'text') return new Response(JSON.stringify({ status: file.status, text: null, size: 9, sha: 'b'.repeat(40), reason: file.reason ?? null, offset, next_offset: null }), { status: 200 });
    const text = file.text ?? '';
    const next = offset + window < text.length ? offset + window : null;
    return new Response(JSON.stringify({ status: 'text', text: text.slice(offset, offset + window), size: text.length, sha: 'a'.repeat(40), reason: null, offset, next_offset: next }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return { calls, fetchImpl };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('CR-132 FR-SRC-003 loadFileText — a file is read to its end, window by window', () => {
  it('FR-SRC-003 joins every window in order and reports progress by bytes', async () => {
    const text = 'first line\nsecond line\nthird line\nlast line\n';
    const { calls } = fileServer({ [`r1:a.txt`]: { text } }, 8);
    const progress: number[] = [];
    const file = await loadFileText('acme/payments', 'a.txt', 'r1', { signal: new AbortController().signal, onProgress: (p) => { progress.push(p.loaded); } });
    expect(file).toEqual({ status: 'text', text, size: text.length, sha: 'a'.repeat(40), reason: null });
    expect(calls).toHaveLength(Math.ceil(text.length / 8));
    expect(calls.every((call) => call.includes('offset='))).toBe(true);
    expect(progress.at(-1)).toBe(text.length);
  });
  it('FR-SRC-003 a non-text status (even past the first window) makes the whole file non-text, never a partial text', async () => {
    fileServer({ 'r1:bin': { status: 'binary', reason: 'Binary files cannot be displayed as text.' } });
    expect(await loadFileText('acme/payments', 'bin', 'r1', { signal: new AbortController().signal })).toMatchObject({ status: 'binary', text: null });
    expect((await loadFileText('acme/payments', 'gone', 'r1', { signal: new AbortController().signal })).status).toBe('missing');
    // First window is text, the third is not: the result is binary, not the first two windows passed off as the file.
    fileServer({ 'r1:late.bin': { text: 'aaaaaaaaaabbbbbbbbbbcccccccccc', binaryFrom: 20 } }, 10);
    expect(await loadFileText('acme/payments', 'late.bin', 'r1', { signal: new AbortController().signal })).toMatchObject({ status: 'binary', text: null, reason: 'Binary files cannot be displayed as text.' });
  });
  it('FR-SRC-003 a server that does not move forward is an error, not an endless loop', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'text', text: 'x', size: 10, sha: null, reason: null, offset: 0, next_offset: 0 }), { status: 200 })));
    await expect(loadFileText('acme/payments', 'a', 'r1', { signal: new AbortController().signal })).rejects.toThrow('could not be read to its end');
  });
  it('formats progress sizes', () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual(['512 B', '2.0 KB', '3.0 MB']);
  });
});

describe('CR-132 FR-SRC-003 diff job — line endings are compared, only displayed without \\r', () => {
  it('FR-SRC-003 a CRLF-only change is a change row, and display strips the \\r', () => {
    const result = runDiffJob('a\r\nb\r\n', 'a\nb\n');
    const kinds = Array.from({ length: result.rows.length / 3 }, (_, row) => result.rows[3 * row]);
    expect(kinds.filter((kind) => kind === ROW_CHANGE).length).toBeGreaterThan(0);
    expect(rawLines('a\r\nb\r\n')).toEqual(['a\r', 'b\r']);
    expect(displayLine('a\r')).toBe('a');
  });
  it('FR-SRC-003 computeDiff falls back to the main thread without Worker and honours cancellation', async () => {
    expect(typeof Worker).toBe('undefined');
    const result = await computeDiff('one\ntwo\n', 'one\nthree\n', new AbortController().signal);
    expect(result.approximate).toBe(false);
    const cancelled = new AbortController(); cancelled.abort();
    const error = await computeDiff('a', 'b', cancelled.signal).catch((caught: unknown) => caught);
    expect(isAbortError(error)).toBe(true);
  });
});

describe('CR-132 FR-SRC-004 trace job — any range, non-text skipped, memory guarded', () => {
  it('FR-SRC-004 analyzes more than 30 revisions, reading each one itself, and skips non-text revisions with their reason', async () => {
    const files: Record<string, { text?: string; status?: string; reason?: string }> = {};
    const revisions = Array.from({ length: 45 }, (_, i) => `r${String(i).padStart(2, '0')}`);
    revisions.forEach((sha, i) => { files[`${sha}:app.c`] = { text: `header\nline ${String(i)}\nfooter\n` }; });
    files['r20:app.c'] = { status: 'binary', reason: 'Binary files cannot be displayed as text.' };
    delete files['r30:app.c']; // path absent at r30 → an empty file, not a skip
    fileServer(files, 7);
    const progress: number[] = [];
    const result = await runTraceJob({ repository: 'acme/payments', path: 'app.c', revisions }, { signal: new AbortController().signal, onProgress: (p) => { progress.push(p.done); } });
    expect(result.lineage.revisions).toHaveLength(44);
    expect(result.skipped).toEqual([{ sha: 'r20', reason: 'Binary files cannot be displayed as text.' }]);
    expect(progress.at(-1)).toBe(45);
    const last = result.lineage.revisions.length - 1;
    // "header" survives from the first revision; r30 removed everything, so it was re-added at r31.
    expect(lineEvents(result.lineage, last, 0).map((event) => [event.sha, event.kind])).toEqual([['r31', 'added']]);
    expect(lineEvents(result.lineage, last, 1).at(-1)).toMatchObject({ sha: 'r44', kind: 'edited', text: 'line 44' });
  });
  it('FR-SRC-004 stops with a message instead of silently shortening when the range would exhaust memory', async () => {
    // The real guard is about 600 MB of lineage cells; a tiny injected guard shows the behaviour without allocating it.
    expect(TRACE_MAX_CELLS).toBe(150_000_000);
    fileServer({ 'r0:a': { text: 'a\nb\nc\n' }, 'r1:a': { text: 'a\nb\nc\nd\n' } });
    const error = await runTraceJob({ repository: 'acme/payments', path: 'a', revisions: ['r0', 'r1'] }, { signal: new AbortController().signal, maxCells: 5 }).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('This range is too large to analyze in the browser. Choose fewer revisions.');
    const fits = await runTraceJob({ repository: 'acme/payments', path: 'a', revisions: ['r0', 'r1'] }, { signal: new AbortController().signal, maxCells: 7 });
    expect(fits.lineage.revisions).toEqual(['r0', 'r1']);
  });
  it('FR-SRC-004 cancellation stops the reads: no further revision is requested', async () => {
    const revisions = Array.from({ length: 20 }, (_, i) => `r${String(i)}`);
    const files = Object.fromEntries(revisions.map((sha) => [`${sha}:a`, { text: 'a\n' }]));
    const { calls } = fileServer(files, 100);
    const controller = new AbortController();
    const running = computeTrace({ repository: 'acme/payments', path: 'a', revisions }, controller.signal, (progress) => { if (progress.done === 5) controller.abort(); });
    const error = await running.catch((caught: unknown) => caught);
    expect(isAbortError(error)).toBe(true);
    const seen = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.length).toBe(seen);
    expect(seen).toBeLessThan(20);
  });
});
