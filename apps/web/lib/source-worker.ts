/**
 * Source analysis worker (CR-132): large line diffs and Time-lapse lineage run here so the page stays responsive.
 *
 * Messages: `diff` (two texts), `trace` (a revision range the worker reads itself), `cancel`. The worker answers
 * `started` when it takes a job, then `progress`, and one of `result`, `error` or `cancelled`. Results carry typed arrays
 * whose buffers are transferred, not copied. A trace that stops (cancelled, or a read that still fails) sends back what it
 * analyzed so far (CR-138), so the page can continue it. The worker is created per job and terminated by the page when
 * the job ends or is cancelled.
 */
import { TraceStoppedError, lineageBuffers, runDiffJob, runTraceJob, type TraceJobInput, type TracePartial } from './source-jobs';

type Request =
  | { readonly id: number; readonly type: 'diff'; readonly before: string; readonly after: string }
  | { readonly id: number; readonly type: 'trace'; readonly input: TraceJobInput }
  | { readonly id: number; readonly type: 'cancel' };

/** The part of the dedicated-worker scope this file uses (the web tsconfig carries DOM types, not WebWorker ones). */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Request>) => void): void;
}
const scope = globalThis as unknown as WorkerScope;
const running = new Map<number, AbortController>();

function failure(id: number, error: unknown): void {
  const partial: TracePartial | null = error instanceof TraceStoppedError ? error.partial : null;
  const transfer = partial ? lineageBuffers(partial.lineage) : [];
  if (error instanceof Error && error.name === 'AbortError') scope.postMessage({ id, type: 'cancelled', partial }, transfer);
  else scope.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : 'The analysis failed.', partial }, transfer);
}

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'cancel') {
    running.get(request.id)?.abort();
    return;
  }
  scope.postMessage({ id: request.id, type: 'started' });
  if (request.type === 'diff') {
    try {
      const result = runDiffJob(request.before, request.after);
      scope.postMessage({ id: request.id, type: 'result', result }, [result.rows.buffer]);
    } catch (error) {
      failure(request.id, error);
    }
    return;
  }
  const controller = new AbortController();
  running.set(request.id, controller);
  runTraceJob(request.input, { signal: controller.signal, onProgress: (progress) => { scope.postMessage({ id: request.id, type: 'progress', progress }); } })
    .then((result) => { scope.postMessage({ id: request.id, type: 'result', result }, lineageBuffers(result.lineage)); })
    .catch((error: unknown) => { failure(request.id, error); })
    .finally(() => { running.delete(request.id); });
});
