import { afterEach, describe, expect, it, vi } from 'vitest';
import { PartialReadError, SourceRequestError, fetchSourceRetrying, formatBytes, loadFileText, type PartialFile } from './source-client';
import { computeDiff, computeTrace, isAbortError } from './source-compute-client';
import { ROW_CHANGE, lineEvents, nodesAt } from './source-compute';
import { TRACE_MEMORY_BUDGET_BYTES, TraceStoppedError, displayLine, rawLines, runDiffJob, runTraceJob, traceKey, type TracePartial } from './source-jobs';

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
  it('CR-138 FR-SRC-004 no revision or cell cap: only the memory the lineage really keeps is guarded, and past it the analysis says so instead of shortening', async () => {
    // The real guard is 1.5 GiB of stored line versions; a tiny injected budget shows the behaviour without allocating it.
    expect(TRACE_MEMORY_BUDGET_BYTES).toBe(1.5 * 1024 ** 3);
    fileServer({ 'r0:a': { text: 'a\nb\nc\n' }, 'r1:a': { text: 'a\nb\nc\nd\n' } });
    const error = await runTraceJob({ repository: 'acme/payments', path: 'a', revisions: ['r0', 'r1'] }, { signal: new AbortController().signal, memoryBudgetBytes: 10 }).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(TraceStoppedError);
    expect((error as TraceStoppedError).message).toMatch(/^These revisions changed too many lines to analyze in the browser \(about \d+ MB of line versions by revision 1\)\. Analyze a shorter range\.$/);
    // Continuing would hit the same wall, so there is nothing to continue.
    expect((error as TraceStoppedError).partial).toBeNull();
    const fits = await runTraceJob({ repository: 'acme/payments', path: 'a', revisions: ['r0', 'r1'] }, { signal: new AbortController().signal });
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

describe('CR-138 FR-SRC-003/004 reads wait out transient failures and a stopped analysis continues where it stopped', () => {
  /** A file server whose first answers for chosen requests are failures (status, optional retry-after, optional code). */
  function flakyServer(files: Record<string, string>, failures: Record<string, { status: number; retryAfter?: string; code?: string; times?: number }>, window = 4) {
    const calls: string[] = []; const left = new Map(Object.entries(failures).map(([key, value]) => [key, value.times ?? 1]));
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push(input);
      if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const url = new URL(input, 'http://localhost');
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const key = `${url.searchParams.get('revision')}:${String(offset)}`;
      const failure = failures[key];
      if (failure !== undefined && (left.get(key) ?? 0) > 0) {
        left.set(key, (left.get(key) ?? 0) - 1);
        return new Response(JSON.stringify({ error: { code: failure.code ?? 'SOURCE_UNAVAILABLE', message: 'try later' } }), { status: failure.status, headers: failure.retryAfter === undefined ? {} : { 'retry-after': failure.retryAfter } });
      }
      const text = files[url.searchParams.get('revision') ?? ''] ?? '';
      const next = offset + window < text.length ? offset + window : null;
      return new Response(JSON.stringify({ status: 'text', text: text.slice(offset, offset + window), size: text.length, sha: 'a'.repeat(40), reason: null, offset, next_offset: next }), { status: 200 });
    }));
    return { calls };
  }

  it('CR-138 FR-SRC-003 a 502 and a 429 (Retry-After) are asked again at the same offset; a missing App permission is not', async () => {
    const { calls } = flakyServer({ r1: 'abcdefghij' }, { 'r1:4': { status: 502 }, 'r1:8': { status: 429, retryAfter: '0' } });
    const waits: number[] = [];
    const file = await loadFileText('acme/payments', 'a', 'r1', { signal: new AbortController().signal, retry: { onWait: (ms) => { waits.push(ms); } } });
    expect(file.text).toBe('abcdefghij');
    expect(calls.map((call) => new URL(call, 'http://localhost').searchParams.get('offset'))).toEqual(['0', '4', '4', '8', '8']);
    expect(waits).toEqual([1000, 0]);
    flakyServer({ r1: 'abcdefghij' }, { 'r1:0': { status: 503, code: 'SOURCE_PERMISSION_REQUIRED' } });
    const denied = await fetchSourceRetrying('/api/source/acme%2Fpayments/file?path=a&revision=r1&offset=0', new AbortController().signal).then(() => null, (caught: unknown) => caught);
    expect(denied).toBeInstanceOf(SourceRequestError);
    expect((denied as SourceRequestError).status).toBe(503);
  }, 20_000);

  it('CR-138 FR-SRC-003 a window without next_offset (a server older than CR-138) ends the file — one request, never a loop', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => { calls.push(input); return new Response(JSON.stringify({ status: 'text', text: 'whole\n', size: 6, sha: 'a'.repeat(40), reason: null }), { status: 200 }); }));
    const file = await loadFileText('acme/payments', 'a', 'r1', { signal: new AbortController().signal });
    expect(file).toMatchObject({ status: 'text', text: 'whole\n' });
    expect(calls).toHaveLength(1);
  });

  it('CR-138 FR-SRC-003 a read that keeps failing hands back what it read, and continuing asks for the failed window only', async () => {
    const { calls } = flakyServer({ r1: 'abcdefghij' }, { 'r1:8': { status: 429, retryAfter: '3600' } });
    const failed = await loadFileText('acme/payments', 'a', 'r1', { signal: new AbortController().signal }).then(() => null, (caught: unknown) => caught);
    expect(failed).toBeInstanceOf(PartialReadError);
    const partial: PartialFile = (failed as PartialReadError).partial;
    expect(partial).toMatchObject({ offset: 8, parts: ['abcd', 'efgh'], size: 10 });
    calls.length = 0;
    flakyServer({ r1: 'abcdefghij' }, {});
    const file = await loadFileText('acme/payments', 'a', 'r1', { signal: new AbortController().signal, resume: partial });
    expect(file.text).toBe('abcdefghij');
  });

  it('CR-138 FR-SRC-004 an analysis that fails part way keeps its lineage; continuing reads only the rest and ends with the same lineage as an uninterrupted run', async () => {
    const revisions = Array.from({ length: 12 }, (_, i) => `r${String(i)}`);
    const files = Object.fromEntries(revisions.map((sha, i) => [sha, `stable\nline ${String(i)}\n${i % 3 === 0 ? 'third\n' : ''}`]));
    flakyServer(files, {}, 1000);
    const whole = await runTraceJob({ repository: 'acme/payments', path: 'a', revisions }, { signal: new AbortController().signal });
    // r7 answers 502 more times than one read retries.
    flakyServer(files, { 'r7:0': { status: 502, times: 4 } }, 1000);
    const stopped = await runTraceJob({ repository: 'acme/payments', path: 'a', revisions }, { signal: new AbortController().signal }).then(() => null, (caught: unknown) => caught);
    expect(stopped).toBeInstanceOf(TraceStoppedError);
    const partial = (stopped as TraceStoppedError).partial!;
    expect(partial.next).toBe(7);
    expect(partial.lineage.revisions).toEqual(revisions.slice(0, 7));
    expect(partial.key).toBe(traceKey(revisions));
    const { calls } = flakyServer(files, {}, 1000);
    const resumed = await runTraceJob({ repository: 'acme/payments', path: 'a', revisions, resume: partial }, { signal: new AbortController().signal });
    // The last analyzed revision is read again (its text continues the comparison), then r7 onwards — nothing earlier.
    expect(calls.map((call) => new URL(call, 'http://localhost').searchParams.get('revision'))).toEqual(['r6', 'r7', 'r8', 'r9', 'r10', 'r11']);
    expect(resumed.lineage.revisions).toEqual(whole.lineage.revisions);
    for (let revision = 0; revision < revisions.length; revision++) expect(Array.from(nodesAt(resumed.lineage, revision)!)).toEqual(Array.from(nodesAt(whole.lineage, revision)!));
    expect(Array.from(resumed.lineage.nodeParent)).toEqual(Array.from(whole.lineage.nodeParent));
    expect(resumed.lineage.nodeText).toEqual(whole.lineage.nodeText);
  }, 30_000);

  it('CR-138 FR-SRC-004 a cancelled analysis also hands back its lineage, and a partial result only continues its own revision list', async () => {
    const revisions = Array.from({ length: 10 }, (_, i) => `r${String(i)}`);
    const files = Object.fromEntries(revisions.map((sha, i) => [sha, `a\n${String(i)}\n`]));
    flakyServer(files, {}, 1000);
    const controller = new AbortController();
    const stopped = await runTraceJob({ repository: 'acme/payments', path: 'a', revisions }, { signal: controller.signal, onProgress: (progress) => { if (progress.done === 4) controller.abort(); } }).then(() => null, (caught: unknown) => caught);
    expect(isAbortError(stopped)).toBe(true);
    const partial: TracePartial = (stopped as TraceStoppedError).partial!;
    expect(partial.next).toBeGreaterThanOrEqual(4);
    expect(partial.lineage.revisions).toEqual(revisions.slice(0, partial.next));
    const other = [...revisions, 'r10'];
    await expect(runTraceJob({ repository: 'acme/payments', path: 'a', revisions: other, resume: partial }, { signal: new AbortController().signal })).rejects.toThrow('The revision list changed.');
    const done = await runTraceJob({ repository: 'acme/payments', path: 'a', revisions, resume: partial }, { signal: new AbortController().signal });
    expect(done.lineage.revisions).toEqual(revisions);
  });
});
