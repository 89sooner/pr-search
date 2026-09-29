/**
 * The two heavy source computations (CR-132), shared by the analysis worker and by the main-thread fallback (tests and
 * browsers without module workers).
 *
 * - `runDiffJob`: the line diff of two texts. Lines are compared with their '\r' kept, so a line-ending change is a
 *   change; the view strips '\r' for display.
 * - `runTraceJob`: the Time-lapse line lineage over a chosen range of revisions. The job reads each revision itself,
 *   window by window, and keeps only the previous revision's lines — it never holds every text of the range at once.
 *   A revision that is not text (binary, LFS pointer, a path that is a submodule) is skipped and reported; a revision
 *   where the path is absent counts as an empty file (the line disappears and may be re-added later).
 */
import { LineageBuilder, diffLineArrays, type Lineage } from './source-compute';
import { loadFileText, type LoadedFile } from './source-client';

/** Lines as compared: split on '\n', drop the empty element after a final '\n', keep '\r'. */
export function rawLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
export function displayLine(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export interface DiffJobResult { readonly rows: Int32Array; readonly approximate: boolean }
export function runDiffJob(before: string, after: string): DiffJobResult {
  const diff = diffLineArrays(rawLines(before), rawLines(after));
  return { rows: diff.rows, approximate: diff.approximate };
}

export interface TraceProgress { readonly done: number; readonly total: number; readonly skipped: number }
export interface TraceSkip { readonly sha: string; readonly reason: string }
export interface TraceJobResult { readonly lineage: Lineage; readonly skipped: readonly TraceSkip[] }
export interface TraceJobInput { readonly repository: string; readonly path: string; readonly revisions: readonly string[] }

/**
 * Memory guard of one analysis: the lineage keeps one 4-byte cell per line per analyzed revision. Past this many
 * cells (about 600 MB) the analysis stops with a message asking for a smaller range — it never returns a silently
 * shortened result. This protects the browser tab; it is not a limit on which revisions can be analyzed.
 */
export const TRACE_MAX_CELLS = 150_000_000;
/** Revisions read ahead while the current pair is compared. */
const READ_AHEAD = 3;

export async function runTraceJob(input: TraceJobInput, options: { readonly signal: AbortSignal; readonly onProgress?: (progress: TraceProgress) => void; readonly maxCells?: number }): Promise<TraceJobResult> {
  const { repository, path, revisions } = input;
  const { signal } = options;
  const builder = new LineageBuilder();
  const skipped: TraceSkip[] = [];
  const pending = new Map<number, Promise<LoadedFile>>();
  const start = (index: number): void => {
    if (index >= revisions.length || pending.has(index)) return;
    const load = loadFileText(repository, path, revisions[index]!, { signal });
    // The rejection is observed when this revision's turn comes; do not let it surface as unhandled before that.
    load.catch(() => undefined);
    pending.set(index, load);
  };
  let cells = 0;
  for (let index = 0; index < revisions.length; index += 1) {
    for (let ahead = index; ahead < index + READ_AHEAD; ahead += 1) start(ahead);
    const file = await pending.get(index)!;
    pending.delete(index);
    signal.throwIfAborted();
    const sha = revisions[index]!;
    if (file.status === 'text' || file.status === 'missing') {
      const lines = rawLines(file.text ?? '');
      cells += lines.length;
      if (cells > (options.maxCells ?? TRACE_MAX_CELLS)) throw new Error('This range is too large to analyze in the browser. Choose fewer revisions.');
      builder.addRevision(sha, lines);
    } else {
      skipped.push({ sha, reason: file.reason ?? `This revision is ${file.status}.` });
    }
    options.onProgress?.({ done: index + 1, total: revisions.length, skipped: skipped.length });
    // Let a cancel message (worker) or rendering (main thread) run between revisions.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { lineage: builder.result(), skipped };
}
