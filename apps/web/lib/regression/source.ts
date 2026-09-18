/** FR-REG-001 / WP-095: no production MDVP schema or credentials are assumed. */
import fixture from './atlas-fixture.json';
import { candidate, recordObservation, sameScope, sessionKey, startInvestigation, type Integration, type Investigation, type Run, type Scope, type Snapshot, type SourceHealth, type TestType, type Verdict } from './model';

export interface RegressionDataSource {
  readonly kind: 'fixture' | 'unconfigured';
  load(signal?: AbortSignal): Promise<Snapshot>;
}
function testType(value: string): TestType {
  if (value === 'Regression' || value === 'Field' || value === 'MTBF') return value;
  throw new Error('Unsupported fixture test type.');
}
function runStatus(value: string): Run['status'] {
  if (value === 'PASS' || value === 'FAIL' || value === 'INCONCLUSIVE') return value;
  throw new Error('Unsupported fixture verdict.');
}
// Copied as data (not executable HTML) from the user-supplied B Atlas concept.
export const atlasSnapshot: Snapshot = {
  scope: { repository: fixture.repository, branch: fixture.branch, epoch: fixture.epoch },
  capturedAt: fixture.snapshot,
  integrations: fixture.integrations.map(p => ({ seq:p.seq,m:p.m,sha:p.sha,pr:p.pr,title:p.title,area:p.area,author:p.author,
    integratedAt:p.integrated_at,artifact:p.artifact,build:p.build,digest:p.digest,file:p.file,additions:p.additions,deletions:p.deletions })),
  runs: fixture.runs.map(r => ({ id:r.id,title:r.title,type:testType(r.type),status:runStatus(r.status),seq:r.seq,date:r.date,
    completedAt:r.completed_at,scope:{repository:r.repository,branch:r.branch,epoch:r.epoch},deviceHours:r.device_hours,failures:r.failures,
    context:{testcase:r.signature,signature:r.signature,hardware:r.environment.split(' / ')[1] ?? 'unspecified',environment:r.environment,
      configuration:r.config,policy:'synthetic-source-verdict/v1'} })),
};
export const fixtureSource: RegressionDataSource = { kind:'fixture', async load(signal) {
  signal?.throwIfAborted(); return atlasSnapshot;
} };
export const unconfiguredSource: RegressionDataSource = { kind:'unconfigured', async load() { throw new Error('MDVP integration is not configured.'); } };

interface LocalRequest { id: string; runId: string; scope: Scope; seq: number; sha: string; digest: string; context: Run['context']; at: string }
interface LocalStore { format: 1; sessions: Record<string, Investigation>; archived: Investigation[]; requests: LocalRequest[] }
export const FIXTURE_STORAGE_KEY = 'prs.regression.atlas.fixture.v1';
const emptyStore = (): LocalStore => ({ format:1,sessions:{},archived:[],requests:[] });
function validSession(value: unknown): value is Investigation {
  if(!value||typeof value!=='object')return false;const s=value as Investigation;
  return typeof s.id==='string'&&typeof s.runId==='string'&&Boolean(s.scope)&&typeof s.scope.repository==='string'&&typeof s.scope.branch==='string'
    &&Number.isSafeInteger(s.scope.epoch)&&s.scope.epoch>0&&Number.isSafeInteger(s.good)&&Number.isSafeInteger(s.bad)&&s.good<s.bad
    &&Number.isSafeInteger(s.originalGood)&&Number.isSafeInteger(s.originalBad)&&s.originalGood<=s.good&&s.originalBad>=s.bad
    &&Number.isSafeInteger(s.version)&&s.version>=0&&Array.isArray(s.skipped)&&s.skipped.every(Number.isSafeInteger)
    &&(s.waiting===null||Number.isSafeInteger(s.waiting))&&Array.isArray(s.history)&&s.history.every(o=>o&&Number.isSafeInteger(o.seq)
      &&typeof o.sha==='string'&&/^[a-f0-9]{40}$/.test(o.sha)&&['PASS','FAIL','SKIP','INCONCLUSIVE'].includes(o.verdict)&&typeof o.reason==='string'&&typeof o.at==='string');
}
export class FixtureSessions {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}
  private read(): LocalStore {
    const text = this.storage.getItem(FIXTURE_STORAGE_KEY);
    if (!text) return emptyStore();
    const value = JSON.parse(text) as LocalStore;
    if (!value || value.format !== 1 || !value.sessions || typeof value.sessions!=='object' || Array.isArray(value.sessions) || !Array.isArray(value.archived) || !Array.isArray(value.requests)
      || !Object.values(value.sessions).every(validSession)||!value.archived.every(validSession)
      ||!value.requests.every(r=>r&&typeof r.id==='string'&&typeof r.runId==='string'&&typeof r.digest==='string'&&Number.isSafeInteger(r.seq))) throw new Error('Saved demo data is unreadable. Export or repair browser storage before recording new observations.');
    return value;
  }
  private save(value: LocalStore): void { this.storage.setItem(FIXTURE_STORAGE_KEY, JSON.stringify(value)); }
  get(scope: Scope, runId: string): Investigation | null {
    const session=this.read().sessions[sessionKey(scope,runId)]??null;
    if(session&&(!sameScope(session.scope,scope)||session.runId!==runId))throw new Error('Saved session does not match this investigation.');return session;
  }
  archive(scope: Scope, runId: string): readonly Investigation[] { return this.read().archived.filter(s => sessionKey(s.scope,s.runId) === sessionKey(scope,runId)); }
  requests(): readonly LocalRequest[] { return this.read().requests; }
  start(data: Snapshot, run: Run, id: string): Investigation {
    const store = this.read(); const key=sessionKey(run.scope,run.id);
    if (store.sessions[key]) return store.sessions[key];
    const next=startInvestigation(data,run,id); store.sessions[key]=next; this.save(store); return next;
  }
  private current(store: LocalStore, expected: Investigation): Investigation {
    const stored=store.sessions[sessionKey(expected.scope,expected.runId)];
    if (!stored || stored.id!==expected.id || stored.version!==expected.version) throw new Error('This session changed in another view. Refresh the saved session before continuing.');
    return stored;
  }
  mark(data: Snapshot, expected: Investigation, verdict: Verdict, reason: string, health: SourceHealth): Investigation {
    const store=this.read(); const current=this.current(store,expected);
    const next=recordObservation(data,current,verdict,reason,health,new Date().toISOString());
    store.sessions[sessionKey(next.scope,next.runId)]=next; this.save(store); return next;
  }
  close(expected: Investigation): void {
    const store=this.read();const current=this.current(store,expected);
    store.archived.push(current);delete store.sessions[sessionKey(current.scope,current.runId)];this.save(store);
  }
  enqueue(data: Snapshot, expected: Investigation, run: Run, health: SourceHealth): void {
    if (health!=='ready') throw new Error('The source is read-only.');
    if(expected.runId!==run.id||!sameScope(expected.scope,run.scope))throw new Error('The request belongs to another investigation.');
    const store=this.read();const current=this.current(store,expected);const next=candidate(data,current).next;
    if (!next?.artifact || !/^[a-f0-9]{64}$/.test(next.digest)) throw new Error('An exact available artifact is required.');
    store.requests.push({id:`LOCAL-${crypto.randomUUID()}`,runId:run.id,scope:{...run.scope},seq:next.seq,sha:next.sha,digest:next.digest,context:{...run.context},at:new Date().toISOString()});
    this.save(store);
  }
}
export function manifest(scope: Scope, point: Integration): object {
  return {data_classification:'SYNTHETIC_FIXTURE_ONLY',repository:scope.repository,base_branch:scope.branch,seq_epoch:scope.epoch,
    merge_seq:point.seq,commit_sha:point.sha,merge_number:point.m,pull_request_number:point.pr,
    build_id:point.build,artifact_available:point.artifact,artifact_sha256:point.artifact?point.digest:null};
}
