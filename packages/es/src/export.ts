/** WP-044 / FR-SRCH-012: bounded, scoped PIT export. */
import type { Client, estypes } from '@elastic/elasticsearch';
import { applyMandatoryScopeFilter, type AccessScope } from './scoped-query.js';
import { closePointInTime, openPointInTime, searchWithPit } from './search.js';
import { assertNoShardFailures, buildSort, type SortKey, type SortOrder } from './sort.js';
import type { EntityAlias } from './indices.js';

export const EXPORT_LIMIT = 100_000;
export const EXPORT_FIELDS = ['repository_id', 'repository', 'pr_number', 'commit_sha', 'title', 'author', 'state', 'merge_seq', 'seq_epoch', 'sequence_space', 'merged_at', 'committed_at', 'changed_files_count', 'additions', 'deletions', 'labels'] as const;
export type ExportFormat = 'csv' | 'json';
export type ExportRow = Record<string, unknown>;
export interface ExportPlan {
  readonly target: readonly EntityAlias[] | null;
  readonly query: estypes.QueryDslQueryContainer;
  readonly repositoryIds: readonly number[];
  readonly scope: AccessScope;
  readonly sort: SortKey;
  readonly order: SortOrder;
}
export class ExportLimitError extends Error {
  constructor() { super('export_limit_exceeded'); }
}
export class ExportAsyncRequiredError extends Error {}

export async function collectExport(es: Client, plan: ExportPlan, check: () => Promise<void> = async () => undefined, synchronous = false): Promise<ExportRow[]> {
  if (plan.target === null) return [];
  const query = applyMandatoryScopeFilter({ bool: { must: [plan.query], filter: [{ terms: { repository_id: [...plan.repositoryIds] } }] } }, plan.scope);
  let pit = await openPointInTime(es, plan.target);
  const rows: ExportRow[] = [];
  let after: estypes.SortResults | undefined;
  try {
    for (;;) {
      await check();
      const response = await searchWithPit<ExportRow>(es, pit, query, {
        size: 1000, sort: buildSort(plan.sort, plan.order), track_total_hits: EXPORT_LIMIT + 1,
        _source: [...EXPORT_FIELDS, 'message'], ...(after === undefined ? {} : { search_after: after }),
      });
      pit = response.pit_id ?? pit;
      assertNoShardFailures(response);
      if (response.timed_out || response.terminated_early) throw new Error('export_partial');
      const total = response.hits.total;
      if ((typeof total === 'number' ? total : total?.value ?? 0) > EXPORT_LIMIT) throw new ExportLimitError();
      if (synchronous && (typeof total === 'number' ? total : total?.value ?? 0) > 1000) throw new ExportAsyncRequiredError();
      for (const hit of response.hits.hits) {
        const source = hit._source ?? {};
        const row: ExportRow = { kind: source['pr_number'] === undefined ? 'commit' : 'pull_request' };
        for (const field of EXPORT_FIELDS) row[field] = source[field] ?? null;
        row['title'] = source['title'] ?? (typeof source['message'] === 'string' ? source['message'].split('\n', 1)[0] : null);
        rows.push(row);
      }
      if (rows.length > EXPORT_LIMIT) throw new ExportLimitError();
      if (response.hits.hits.length < 1000) break;
      after = response.hits.hits.at(-1)?.sort;
      if (after === undefined) throw new Error('export_cursor_missing');
    }
    await check();
    return rows;
  } finally { await closePointInTime(es, pit); }
}

/** Quote every CSV cell and neutralize spreadsheet formula prefixes. */
export function serializeExport(rows: readonly ExportRow[], format: ExportFormat): string {
  if (format === 'json') return JSON.stringify(rows);
  const columns = ['kind', ...EXPORT_FIELDS];
  const cell = (value: unknown): string => {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [columns.map(cell).join(','), ...rows.map((row) => columns.map((key) => cell(row[key])).join(','))].join('\r\n') + '\r\n';
}
