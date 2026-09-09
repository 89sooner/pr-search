import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { collectExport, ExportLimitError, ExportAsyncRequiredError, serializeExport, type ExportPlan } from './export.js';

const plan: ExportPlan = { target: ['prs-pull-requests'], query: { match_all: {} }, repositoryIds: [44], scope: { kind: 'explicit', repositoryIds: [44] }, sort: 'merge_seq', order: 'desc' };
function fake(total: number, extra: Record<string, unknown> = {}) {
  let page = 0;
  const search = vi.fn(async () => {
    const size = Math.min(1000, Math.max(0, total - page * 1000));
    const start = page++ * 1000;
    return { pit_id: `pit-${page}`, timed_out: false, _shards: { total: 1, failed: 0 }, hits: { total: { value: total, relation: 'eq' }, hits: Array.from({ length: size }, (_, i) => ({ _source: { repository_id: 44, pr_number: start+i, title: '제목', body: 'must not leave' }, sort: [start+i] })) }, ...extra };
  });
  const closePointInTime = vi.fn(async () => ({ succeeded: true }));
  return { es: { search, openPointInTime: vi.fn(async () => ({ id: 'pit-0' })), closePointInTime } as unknown as Client, search, closePointInTime };
}
describe('WP-044 FR-SRCH-012 export PIT', () => {
  it.each([0, 1000, 1001, 100000])('exports %i rows without truncation or duplicates', async (total) => {
    const { es, closePointInTime } = fake(total);
    const rows = await collectExport(es, plan);
    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((row) => row['pr_number'])).size).toBe(total);
    expect(rows[0]?.['body']).toBeUndefined();
    expect(closePointInTime).toHaveBeenCalledOnce();
  });
  it('rejects 100001 and closes the current PIT', async () => {
    const { es, closePointInTime } = fake(100001);
    await expect(collectExport(es, plan)).rejects.toBeInstanceOf(ExportLimitError);
    expect(closePointInTime).toHaveBeenCalledWith({ id: 'pit-1' });
  });
  it('switches to async when the PIT grows beyond the synchronous preflight count', async () => {
    const { es, search } = fake(1001);
    await expect(collectExport(es, plan, async () => undefined, true)).rejects.toBeInstanceOf(ExportAsyncRequiredError);
    expect(search).toHaveBeenCalledOnce();
  });
  it.each([{ timed_out: true }, { terminated_early: true }, { _shards: { failed: 1, total: 2 } }])('rejects partial responses %j', async (extra) => {
    const { es, closePointInTime } = fake(2, extra);
    await expect(collectExport(es, plan)).rejects.toThrow();
    expect(closePointInTime).toHaveBeenCalled();
  });
  it('retains org_team scope and the original repository set', async () => {
    const { es, search } = fake(0);
    await collectExport(es, { ...plan, scope: { kind: 'org_team', orgIds: [1], teamIds: [9], visibilities: ['internal'] } });
    const serialized = JSON.stringify(search.mock.calls);
    expect(serialized).toContain('allowed_team_ids');
    expect(serialized).toContain('repository_id');
  });
  it('CSV quotes delimiters/newlines and neutralizes formula cells; JSON retains text', () => {
    const rows = [{ title: '=HYPERLINK("evil")', repository: '한글,\nrepo' }];
    expect(serializeExport(rows, 'csv')).toContain('"\'=HYPERLINK(""evil"")"');
    expect(serializeExport(rows, 'csv')).toContain('"한글,\nrepo"');
    expect(JSON.parse(serializeExport(rows, 'json'))).toEqual(rows);
  });
});
