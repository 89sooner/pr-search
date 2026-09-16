import { diffLines, diffWordsWithSpace } from 'diff';

export interface DiffLine { number: number; text: string }
export interface DiffRow { kind: 'equal' | 'change'; before: DiffLine | null; after: DiffLine | null }
export function lines(text: string): string[] { if (!text) return []; const result = text.split('\n'); if (result.at(-1) === '') result.pop(); return result.map(line => line.replace(/\r$/, '')); }
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
export function wordChanges(before: string, after: string, side: 'before' | 'after'): { text: string; changed: boolean }[] {
  if (before.length + after.length > 4000) return [{ text: side === 'before' ? before : after, changed: true }];
  const chunks = diffWordsWithSpace(before, after, { timeout: 8, maxEditLength: 200 });
  if (!chunks) return [{ text: side === 'before' ? before : after, changed: true }];
  return chunks.filter(chunk => side === 'before' ? !chunk.added : !chunk.removed).map(chunk => ({ text: chunk.value, changed: Boolean(chunk.added || chunk.removed) }));
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
