/**
 * Runs the source analysis jobs off the main thread (CR-132).
 *
 * Each job gets its own module worker, terminated when the job ends, fails or is cancelled — cancelling stops the
 * computation and the worker's remaining source reads at once. Without `Worker` (tests, very old browsers) or when the
 * worker cannot start, the same job functions run on the main thread; the result is identical, only responsiveness
 * differs.
 */
import { runDiffJob, runTraceJob, type DiffJobResult, type TraceJobInput, type TraceJobResult, type TraceProgress } from './source-jobs';

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
function abortError(): Error {
  const error = new Error('The analysis was cancelled.');
  error.name = 'AbortError';
  return error;
}

type WorkerMessage =
  | { readonly id: number; readonly type: 'result'; readonly result: unknown }
  | { readonly id: number; readonly type: 'progress'; readonly progress: TraceProgress }
  | { readonly id: number; readonly type: 'error'; readonly message: string }
  | { readonly id: number; readonly type: 'cancelled' };

let nextId = 1;

/** Runs `job` in a fresh worker. Resolves `undefined` when the worker itself could not start (the caller falls back). */
function inWorker<T>(job: Record<string, unknown>, signal: AbortSignal, onProgress?: (progress: TraceProgress) => void): Promise<T | undefined> {
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
    const finish = (): void => { settled = true; signal.removeEventListener('abort', onAbort); worker.terminate(); };
    const onAbort = (): void => {
      if (settled) return;
      worker.postMessage({ id, type: 'cancel' });
      finish();
      reject(abortError());
    };
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== id || settled) return;
      if (message.type === 'progress') { onProgress?.(message.progress); return; }
      finish();
      if (message.type === 'result') resolve(message.result as T);
      else if (message.type === 'cancelled') reject(abortError());
      else reject(new Error(message.message));
    });
    worker.addEventListener('error', (event) => {
      // The script failed to load or threw outside a job: let the caller run the job on the main thread.
      event.preventDefault();
      if (settled) return;
      finish();
      resolve(undefined);
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
