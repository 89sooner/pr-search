/**
 * Test oracle only (CR-138): the bounded Myers line diff and lineage that the source dialogs used before CR-132. It gives up
 * (`null`) past 150 ms or 5,000 edits, so it no longer runs in the product — source-compute.ts replaced it everywhere with
 * a diff that falls back to an approximate alignment and keeps every line. Tests compare the new functions with it on
 * inputs small enough for it to finish.
 */
import { diffLines } from 'diff';
import { lines } from './source-analysis';
import { EXACT_BUDGET, ROW_EQUAL, diffLineArrays } from './source-compute';

export interface DiffLine { number: number; text: string }
export interface DiffRow { kind: 'equal' | 'change'; before: DiffLine | null; after: DiffLine | null }
/** Bounded Myers diff. Timeout is an explicit unsupported state, never an empty diff. */
export function compareLines(before: string, after: string): DiffRow[] | null {
  const changes = diffLines(before, after, { timeout: 150, maxEditLength: 5000 });
  if (!changes) return null;
  let left = 1; let right = 1; const result: DiffRow[] = [];
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]!; const chunk = lines(change.value);
    if (!change.added && !change.removed) { for (const text of chunk) result.push({ kind: 'equal', before: { number: left++, text }, after: { number: right++, text } }); continue; }
    const removed = change.removed ? chunk : [];
    let added = change.added ? chunk : [];
    if (change.removed && changes[i + 1]?.added) { added = lines(changes[++i]!.value); }
    for (let j = 0; j < Math.max(removed.length, added.length); j++) result.push({ kind: 'change', before: j < removed.length ? { number: left++, text: removed[j]! } : null, after: j < added.length ? { number: right++, text: added[j]! } : null });
  }
  return result;
}
export interface LineEvent { sha: string; line: number; text: string; kind: 'baseline' | 'added' | 'edited' }
export interface TracedLine { text: string; events: LineEvent[] }
/** Adjacent replacement rows are aligned candidates, not authoritative Git blame. */
export function traceLines(versions: readonly { sha: string; text: string }[]): Map<string, TracedLine[]> | null {
  const result = new Map<string, TracedLine[]>(); let previous: TracedLine[] = []; let previousText = '';
  for (let index = 0; index < versions.length; index++) {
    const version = versions[index]!;
    if (index === 0) previous = lines(version.text).map((text, line) => ({ text, events: [{ sha: version.sha, line: line + 1, text, kind: 'baseline' }] }));
    else {
      const rows = compareLines(previousText, version.text); if (!rows) return null;
      previous = rows.flatMap(row => {
        if (!row.after) return [];
        const earlier = row.before ? previous[row.before.number - 1] : undefined;
        if (row.kind === 'equal' && earlier) return [{ text: row.after.text, events: earlier.events }];
        return [{ text: row.after.text, events: [...(earlier?.events ?? []), { sha: version.sha, line: row.after.number, text: row.after.text, kind: earlier ? 'edited' as const : 'added' as const }] }];
      });
    }
    previousText = version.text; result.set(version.sha, previous);
  }
  return result;
}

// ------------------------------------------------------------------------------------------------------------------
// The lineage builder as it was before CR-138: one node array per analyzed revision (lines × revisions cells). The compact
// builder in source-compute.ts must give the same nodes for every line of every revision; tests compare the two.

export interface NaiveLineage {
  readonly revisions: readonly string[];
  readonly lineNodes: readonly Int32Array[];
  readonly nodeParent: readonly number[];
  readonly nodeRevision: readonly number[];
  readonly nodeLine: readonly number[];
  readonly nodeKind: readonly number[];
  readonly nodeDepth: readonly number[];
  readonly nodeText: readonly string[];
}

export function naiveLineage(versions: readonly { sha: string; lines: readonly string[] }[]): NaiveLineage {
  const revisions: string[] = []; const lineNodes: Int32Array[] = [];
  const parent: number[] = []; const revision: number[] = []; const line: number[] = []; const kind: number[] = []; const depth: number[] = []; const text: string[] = [];
  const add = (from: number, at: number, index: number, type: number, value: string): number => {
    parent.push(from); revision.push(at); line.push(index + 1); kind.push(type); depth.push(from < 0 ? 1 : depth[from]! + 1); text.push(value);
    return parent.length - 1;
  };
  let previous: readonly string[] = [];
  versions.forEach((version, at) => {
    const nodes = new Int32Array(version.lines.length);
    if (at === 0) version.lines.forEach((value, index) => { nodes[index] = add(-1, 0, index, 0, value); });
    else {
      const rows = diffLineArrays(previous, version.lines, EXACT_BUDGET).rows;
      const before = lineNodes[at - 1]!;
      for (let r = 0; r < rows.length; r += 3) {
        const after = rows[r + 2]!; if (after < 0) continue;
        const from = rows[r + 1]!;
        if (rows[r] === ROW_EQUAL) nodes[after] = before[from]!;
        else nodes[after] = from >= 0 ? add(before[from]!, at, after, 2, version.lines[after]!) : add(-1, at, after, 1, version.lines[after]!);
      }
    }
    revisions.push(version.sha); lineNodes.push(nodes); previous = version.lines;
  });
  return { revisions, lineNodes, nodeParent: parent, nodeRevision: revision, nodeLine: line, nodeKind: kind, nodeDepth: depth, nodeText: text };
}
