/** FR-REG-001 / WP-095: canonical investigation rules, independent of presentation filters. */
export type Verdict = 'PASS' | 'FAIL' | 'SKIP' | 'INCONCLUSIVE';
export type TestType = 'Regression' | 'Field' | 'MTBF';
export type SourceHealth = 'ready' | 'stale' | 'offline' | 'epoch_stale';
export interface Scope { repository: string; branch: string; epoch: number }
export interface Integration {
  seq: number; m: number | null; sha: string; pr: number | null; title: string;
  area: string; author: string; integratedAt: string; artifact: boolean;
  build: string; digest: string; file: string; additions: number; deletions: number;
}
export interface TestContext {
  testcase: string; signature: string; hardware: string; environment: string;
  configuration: string; policy: string;
}
export interface Run {
  id: string; title: string; type: TestType; status: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  scope: Scope; seq: number | null; completedAt: string; date: string;
  context: TestContext; deviceHours: number; failures: number;
}
export interface Snapshot { scope: Scope; capturedAt: string; integrations: readonly Integration[]; runs: readonly Run[] }
export interface Observation { seq: number; sha: string; verdict: Verdict; reason: string; at: string }
export interface Investigation {
  id: string; runId: string; scope: Scope; good: number; bad: number; originalGood: number;
  originalBad: number; version: number; skipped: readonly number[]; waiting: number | null;
  history: readonly Observation[];
}
export const sameScope = (a: Scope, b: Scope): boolean => a.repository === b.repository && a.branch === b.branch && a.epoch === b.epoch;
export const sessionKey = (scope: Scope, runId: string): string => JSON.stringify([scope.repository, scope.branch, scope.epoch, runId]);
export const revisionLabel = (point: Integration): string => point.m === null ? `No M · S-${point.seq}` : `M-${point.m}`;
export function mappedRevision(data: Snapshot, run: Run): Integration | null {
  return sameScope(data.scope, run.scope) ? data.integrations.find(p => p.seq === run.seq) ?? null : null;
}
export function compatiblePass(data: Snapshot, run: Run): Run | null {
  if (!mappedRevision(data, run)) return null;
  return data.runs.filter(r => r.status === 'PASS' && sameScope(run.scope, r.scope)
    && r.type === run.type && mappedRevision(data, r) && r.seq !== null && run.seq !== null && r.seq < run.seq
    && Date.parse(r.completedAt) < Date.parse(run.completedAt)
    && (Object.keys(run.context) as (keyof TestContext)[]).every(k => r.context[k] === run.context[k]))
    .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0] ?? null;
}
export function startInvestigation(data: Snapshot, run: Run, id: string): Investigation {
  const pass = compatiblePass(data, run);
  if (run.status !== 'FAIL' || run.seq === null || pass?.seq === null || pass === null) throw new Error('A mapped FAIL and a comparable PASS are required.');
  return { id, runId: run.id, scope: { ...run.scope }, good: pass.seq, bad: run.seq,
    originalGood: pass.seq, originalBad: run.seq, version: 0, skipped: [], waiting: null, history: [] };
}
export function canonicalWindow(data: Snapshot, scope: Scope, good: number, bad: number): Integration[] {
  if (!sameScope(data.scope, scope)) return [];
  return data.integrations.filter(p => p.seq > good && p.seq <= bad).sort((a,b) => a.seq - b.seq);
}
export function candidate(data: Snapshot, session: Investigation): {
  state: 'in_progress' | 'awaiting_evidence' | 'unresolved' | 'boundary' | 'epoch_stale';
  next: Integration | null; remaining: number; testable: number;
} {
  if (!sameScope(data.scope, session.scope)) return { state: 'epoch_stale', next: null, remaining: 0, testable: 0 };
  const points = canonicalWindow(data, session.scope, session.good, session.bad);
  const eligible = points.filter(p => p.seq < session.bad && p.artifact && !session.skipped.includes(p.seq));
  if (points.length === 1) return { state: 'boundary', next: null, remaining: 1, testable: 0 };
  if (points.length === 0) return { state: 'unresolved', next: null, remaining: 0, testable: 0 };
  const waiting = eligible.find(p => p.seq === session.waiting);
  // Rank among ALL first-parent points determines the midpoint, never M-number or filtered rows.
  const middle = (points.length - 1) / 2;
  const next = waiting ?? [...eligible].sort((a,b) => Math.abs(points.indexOf(a) - middle) - Math.abs(points.indexOf(b) - middle) || a.seq - b.seq)[0] ?? null;
  return { state: waiting ? 'awaiting_evidence' : next ? 'in_progress' : 'unresolved', next, remaining: points.length, testable: eligible.length };
}
export function recordObservation(data: Snapshot, session: Investigation, verdict: Verdict, reason: string, health: SourceHealth, at: string): Investigation {
  if (health !== 'ready') throw new Error('Evidence is read-only until the source and epoch are current.');
  const next = candidate(data, session).next;
  if (!next) throw new Error('No testable candidate. The unresolved range is preserved.');
  if ((verdict === 'SKIP' || verdict === 'INCONCLUSIVE') && !reason.trim()) throw new Error('A reason is required.');
  return { ...session, version: session.version + 1,
    good: verdict === 'PASS' ? next.seq : session.good,
    bad: verdict === 'FAIL' ? next.seq : session.bad,
    skipped: verdict === 'SKIP' ? [...session.skipped, next.seq] : session.skipped,
    waiting: verdict === 'INCONCLUSIVE' ? next.seq : null,
    history: [...session.history, { seq: next.seq, sha: next.sha, verdict, reason: reason.trim(), at }] };
}
export function observedVerdict(point: Integration, run: Run, pass: Run | null, session: Investigation | null): Verdict | 'UNTESTED' {
  const entry = session?.history.findLast(o => o.seq === point.seq);
  if (entry) return entry.verdict;
  if (point.seq === run.seq) return run.status;
  return point.seq === pass?.seq ? 'PASS' : 'UNTESTED';
}
export function filterChanges(points: readonly Integration[], query: string, area: string, order: 'asc' | 'desc'): Integration[] {
  const q = query.trim().toLowerCase();
  return points.filter(p => (area === 'all' || area === 'direct' && p.pr === null || area === 'missing' && !p.artifact || p.area === area)
    && (!q || [revisionLabel(p), `S-${p.seq}`, p.pr === null ? '' : `#${p.pr}`, p.sha, p.digest, p.build, p.title].some(v => v.toLowerCase().includes(q))))
    .sort((a,b) => order === 'asc' ? a.seq - b.seq : b.seq - a.seq);
}
