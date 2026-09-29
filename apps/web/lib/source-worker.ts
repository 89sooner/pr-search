/**
 * Source analysis worker (CR-132): large line diffs and Time-lapse lineage run here so the page stays responsive.
 *
 * Messages: `diff` (two texts), `trace` (a revision range the worker reads itself), `cancel`. Results carry typed arrays
 * whose buffers are transferred, not copied. The worker is created per job and terminated by the page when the job
 * ends or is cancelled.
 */
import { runDiffJob, runTraceJob, type TraceJobInput } from './source-jobs';

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
  if (error instanceof Error && error.name === 'AbortError') scope.postMessage({ id, type: 'cancelled' });
  else scope.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : 'The analysis failed.' });
}

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'cancel') {
    running.get(request.id)?.abort();
    return;
  }
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
    .then((result) => {
      const { lineage } = result;
      const buffers = [lineage.nodeParent, lineage.nodeRevision, lineage.nodeLine, lineage.nodeKind, lineage.nodeDepth, ...lineage.lineNodes].map((array) => array.buffer);
      scope.postMessage({ id: request.id, type: 'result', result }, buffers);
    })
    .catch((error: unknown) => { failure(request.id, error); })
    .finally(() => { running.delete(request.id); });
});
