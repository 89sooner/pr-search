import { diffWordsWithSpace } from 'diff';

export function lines(text: string): string[] { if (!text) return []; const result = text.split('\n'); if (result.at(-1) === '') result.pop(); return result.map(line => line.replace(/\r$/, '')); }
/** Word highlighting of one changed row. Past its small budget the whole line is shown, marked changed — the text itself is never dropped. */
export function wordChanges(before: string, after: string, side: 'before' | 'after'): { text: string; changed: boolean }[] {
  if (before.length + after.length > 4000) return [{ text: side === 'before' ? before : after, changed: true }];
  const chunks = diffWordsWithSpace(before, after, { timeout: 8, maxEditLength: 200 });
  if (!chunks) return [{ text: side === 'before' ? before : after, changed: true }];
  return chunks.filter(chunk => side === 'before' ? !chunk.added : !chunk.removed).map(chunk => ({ text: chunk.value, changed: Boolean(chunk.added || chunk.removed) }));
}
