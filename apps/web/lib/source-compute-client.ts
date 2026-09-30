/**
 * Runs the source analysis jobs off the main thread (CR-132).
 *
 * Each job gets its own module worker, terminated when the job ends, fails or is cancelled — cancelling stops the
 * computation and the worker's remaining source reads at once. Without `Worker` (tests, very old browsers) or when the
 * worker cannot start, the same job functions run on the main thread; the result is identical, only responsiveness
 * differs.
 *
 * CR-138: a cancelled or failed trace comes back as a `TraceStoppedError` carrying what was analyzed so far (the page
 * offers to continue it). A worker that dies after it took the job (for example out of memory) fails the job — it is
 * not retried on the main thread, where it would take the page down with it.
 */
import { TraceStoppedError, runDiffJob, runTraceJob, type DiffJobResult, type TraceJobInput, type TraceJobResult, type TracePartial, type TraceProgress } from './source-jobs';

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
function abortError(partial: TracePartial | null = null): Error {
  const reason = new Error('The analysis was cancelled.');
  reason.name = 'AbortError';
  return new TraceStoppedError(reason, partial);
}

/** How long a cancelled worker may take to send back its partial result before it is terminated anyway. */
const CANCEL_GRACE_MS = 1500;

type WorkerMessage =
  | { readonly id: number; readonly type: 'started' }
  | { readonly id: number; readonly type: 'result'; readonly result: unknown }
  | { readonly id: number; readonly type: 'progress'; readonly progress: TraceProgress }
  | { readonly id: number; readonly type: 'error'; readonly message: string; readonly partial?: TracePartial | null }
  | { readonly id: number; readonly type: 'cancelled'; readonly partial?: TracePartial | null };

let nextId = 1;

/** Runs `job` in a fresh worker. Resolves `undefined` when the worker itself could not start (the caller falls back). */
function inWorker<T>(job: { readonly type: 'diff' | 'trace' } & Record<string, unknown>, signal: AbortSignal, onProgress?: (progress: TraceProgress) => void): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./source-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(undefined);
      return;
    }
    const id = nextId++;
    let settled = false;
    let started = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => { settled = true; clearTimeout(grace); signal.removeEventListener('abort', onAbort); worker.terminate(); };
    const onAbort = (): void => {
      if (settled) return;
      // A diff runs synchronously in the worker and cannot answer a cancel message: end it at once. A trace sends back its partial result.
      if (!started || job.type === 'diff') { finish(); reject(abortError()); return; }
      // Ask the job to stop and hand back its partial result; do not wait for it forever.
      worker.postMessage({ id, type: 'cancel' });
      grace = setTimeout(() => { if (!settled) { finish(); reject(abortError()); } }, CANCEL_GRACE_MS);
    };
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== id || settled) return;
      if (message.type === 'started') { started = true; return; }
      if (message.type === 'progress') { if (!signal.aborted) onProgress?.(message.progress); return; }
      finish();
      if (message.type === 'result') resolve(message.result as T);
      else if (message.type === 'cancelled') reject(abortError(message.partial ?? null));
      else reject(new TraceStoppedError(new Error(message.message), message.partial ?? null));
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      if (settled) return;
      finish();
      // Before the job was taken, the script failed to load: let the caller run the job on the main thread. After it,
      // the worker itself failed (typically out of memory) — running the same job on the page would fail the page too.
      if (started) reject(new Error('The analysis stopped because the browser ran out of resources. Analyze a shorter range.'));
      else resolve(undefined);
    });
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort);
    worker.postMessage({ id, ...job });
  });
}

async function onMainThread<T>(run: () => Promise<T> | T, signal: AbortSignal): Promise<T> {
  // Yield once so a "Comparing…" state can render before a synchronous diff blocks the thread.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (signal.aborted) throw abortError();
  const result = await run();
  if (signal.aborted) throw abortError();
  return result;
}

const workerAvailable = (): boolean => typeof window !== 'undefined' && typeof Worker !== 'undefined';

export async function computeDiff(before: string, after: string, signal: AbortSignal): Promise<DiffJobResult> {
  if (workerAvailable()) {
    const result = await inWorker<DiffJobResult>({ type: 'diff', before, after }, signal);
    if (result !== undefined) return result;
  }
  return onMainThread(() => runDiffJob(before, after), signal);
}

export async function computeTrace(input: TraceJobInput, signal: AbortSignal, onProgress?: (progress: TraceProgress) => void): Promise<TraceJobResult> {
  if (workerAvailable()) {
    const result = await inWorker<TraceJobResult>({ type: 'trace', input }, signal, onProgress);
    if (result !== undefined) return result;
  }
  return onMainThread(() => runTraceJob(input, { signal, ...(onProgress ? { onProgress } : {}) }), signal);
}

