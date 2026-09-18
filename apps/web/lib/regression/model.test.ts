import { describe, expect, it } from 'vitest';
import { candidate, canonicalWindow, compatiblePass, filterChanges, mappedRevision, observedVerdict, recordObservation, sameScope, startInvestigation, type Snapshot } from './model';
import { atlasSnapshot as data, FIXTURE_STORAGE_KEY, FixtureSessions, manifest, unconfiguredSource } from './source';
import { regressionQuery, regressionUrl } from './query';

const failure=data.runs.find(r=>r.id==='MDVP-78421')!;
const start=()=>startInvestigation(data,failure,'session-1');
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};}
describe('FR-REG-001 / WP-095 canonical investigation',()=>{
  it('sample is 60 changes, 59 PR and a direct push, across result dates',()=>{
    const s=start(),points=canonicalWindow(data,s.scope,s.good,s.bad);
    expect([s.good,s.bad]).toEqual([24001,24061]);expect(points).toHaveLength(60);
    expect(points.filter(p=>p.pr!==null)).toHaveLength(59);expect(points.filter(p=>p.pr===null)).toHaveLength(1);
    expect(points.some(p=>p.integratedAt.slice(0,10)<failure.date)).toBe(true);
  });
  it('finds the comparable PASS from the previous day, not the latest unrelated PASS',()=>{
    expect(compatiblePass(data,failure)?.id).toBe('MDVP-78142');
    for(const key of ['testcase','signature','hardware','environment','configuration','policy'] as const){
      expect(compatiblePass(data,{...failure,context:{...failure.context,[key]:'different'}}),key).toBeNull();
    }
  });
  it('mapping and baseline refuse different repo, branch and epoch',()=>{
    for(const scope of [{...failure.scope,repository:'other/repo'},{...failure.scope,branch:'release/26A'},{...failure.scope,epoch:2}]){
      expect(mappedRevision(data,{...failure,scope})).toBeNull();expect(compatiblePass(data,{...failure,scope})).toBeNull();
      expect(canonicalWindow(data,scope,24001,24061)).toEqual([]);
    }
  });
  it('display filters, query and pagination never enter midpoint calculation',()=>{
    const s=start(),before=candidate(data,s);const points=canonicalWindow(data,s.scope,s.good,s.bad);
    expect(filterChanges(points,'nonexistent','RF','asc')).toHaveLength(0);
    expect(filterChanges(points,'','direct','desc')).toHaveLength(1);
    expect(candidate(data,s)).toEqual(before);expect(before.next?.seq).toBe(24031);
  });
  it('searches M, PR, S, full SHA and exact manifest digest',()=>{
    const p=data.integrations.find(p=>p.seq===24031)!;
    for(const q of [`M-${p.m}`,`#${p.pr}`,`S-${p.seq}`,p.sha,p.digest,p.build])expect(filterChanges(data.integrations,q,'all','desc')).toContainEqual(p);
  });
  it('PASS advances only good; FAIL shrinks only bad; never mutates past observations',()=>{
    const initial=start(),pass=recordObservation(data,initial,'PASS','','ready','time');
    expect(pass.good).toBe(24031);expect(pass.bad).toBe(initial.bad);expect(initial.history).toHaveLength(0);
    const fail=recordObservation(data,pass,'FAIL','','ready','later');expect(fail.good).toBe(pass.good);expect(fail.bad).toBeLessThan(pass.bad);expect(pass.history).toHaveLength(1);
  });
  it('SKIP changes the test suggestion but keeps the full culprit interval',()=>{
    const s=start(),before=candidate(data,s);const skipped=recordObservation(data,s,'SKIP','equipment unavailable','ready','time');
    expect([skipped.good,skipped.bad]).toEqual([s.good,s.bad]);expect(candidate(data,skipped).remaining).toBe(before.remaining);
    expect(candidate(data,skipped).next?.seq).not.toBe(before.next?.seq);expect(canonicalWindow(data,s.scope,s.good,s.bad)).toContainEqual(before.next);
  });
  it('INCONCLUSIVE preserves candidate and boundaries and requires a reason',()=>{
    const s=start();expect(()=>recordObservation(data,s,'INCONCLUSIVE','','ready','time')).toThrow('reason');
    const result=recordObservation(data,s,'INCONCLUSIVE','more exposure','ready','time');
    expect([result.good,result.bad]).toEqual([s.good,s.bad]);expect(candidate(data,result).next).toEqual(candidate(data,s).next);expect(candidate(data,result).state).toBe('awaiting_evidence');
  });
  it('missing artifacts stay in the interval; all untestable is unresolved',()=>{
    const missing:Snapshot={...data,integrations:data.integrations.map(p=>({...p,artifact:false}))};
    expect(candidate(missing,start())).toMatchObject({state:'unresolved',remaining:60,next:null});
    const direct=data.integrations.find(p=>p.pr===null&&p.seq>24001)!;
    const directOnly={...missing,integrations:missing.integrations.map(p=>({...p,artifact:p.seq===direct.seq}))};
    expect(candidate(directOnly,start()).next?.seq).toBe(direct.seq);
  });
  it('all skipped interior commits do not become a single confirmed culprit',()=>{
    const s=start();const skipped={...s,skipped:canonicalWindow(data,s.scope,s.good,s.bad).map(p=>p.seq)};
    expect(candidate(data,skipped)).toMatchObject({state:'unresolved',remaining:60,next:null});
    expect(candidate(data,{...s,good:24060})).toMatchObject({state:'boundary',remaining:1,next:null});
  });
  it('stale/offline/epoch changes block mutation and do not alter saved state',()=>{
    for(const health of ['stale','offline','epoch_stale'] as const)expect(()=>recordObservation(data,start(),'PASS','',health,'time')).toThrow('read-only');
    expect(candidate({...data,scope:{...data.scope,epoch:2}},start()).state).toBe('epoch_stale');
  });
  it('unmapped and MTBF inconclusive runs cannot start a bisect',()=>{
    for(const id of ['MDVP-78436','MDVP-78376'])expect(()=>startInvestigation(data,data.runs.find(r=>r.id===id)!,'x')).toThrow();
  });
  it('does not propagate selected FAIL to untested PRs',()=>{
    const unrelated=data.integrations.find(p=>p.seq===24030)!;
    expect(observedVerdict(unrelated,failure,compatiblePass(data,failure),null)).toBe('UNTESTED');
  });
});
describe('FR-REG-001 local fixture preservation and version checks',()=>{
  it('restores and rejects stale concurrent versions without overwriting observations',()=>{
    const disk=storage(),first=new FixtureSessions(disk),second=new FixtureSessions(disk);
    const s=first.start(data,failure,'one');const changed=first.mark(data,s,'PASS','','ready');
    expect(second.get(failure.scope,failure.id)).toEqual(changed);
    expect(()=>second.mark(data,s,'FAIL','','ready')).toThrow('changed');expect(first.get(failure.scope,failure.id)?.history).toHaveLength(1);
  });
  it('reset archives observations and a late old session cannot mutate the new one',()=>{
    const store=new FixtureSessions(storage());const first=store.mark(data,store.start(data,failure,'old'),'SKIP','cannot test','ready');
    store.close(first);expect(store.get(failure.scope,failure.id)).toBeNull();expect(store.archive(failure.scope,failure.id)[0]?.history).toHaveLength(1);
    store.start(data,failure,'new');expect(()=>store.mark(data,first,'PASS','','ready')).toThrow('changed');
  });
  it('storage failure does not pretend to have recorded a verdict',()=>{
    const disk=storage(),store=new FixtureSessions(disk);const s=store.start(data,failure,'x');
    const broken=new FixtureSessions({...disk,setItem:()=>{throw new Error('quota');}});
    expect(()=>broken.mark(data,s,'PASS','','ready')).toThrow('quota');expect(store.get(failure.scope,failure.id)?.version).toBe(0);
  });
  it('malformed saved data is surfaced rather than erased',()=>{
    const disk=storage();disk.setItem(FIXTURE_STORAGE_KEY,'{"format":1,"sessions":{"bad":{}},"archived":[],"requests":[]}');
    expect(()=>new FixtureSessions(disk).get(failure.scope,failure.id)).toThrow('unreadable');expect(disk.getItem(FIXTURE_STORAGE_KEY)).toContain('bad');
  });
  it('queue requires matching context and exact manifest digest; no network',()=>{
    const store=new FixtureSessions(storage()),s=store.start(data,failure,'x');
    store.enqueue(data,s,failure,'ready');expect(store.requests()[0]).toMatchObject({scope:failure.scope,context:failure.context,seq:24031});
    expect(store.requests()[0]?.digest).toHaveLength(64);
    expect(()=>store.enqueue(data,s,{...failure,id:'other'},'ready')).toThrow('another');
    const p=data.integrations.find(p=>p.seq===24031)!;expect(manifest(data.scope,p)).toMatchObject({commit_sha:p.sha,artifact_sha256:p.digest,data_classification:'SYNTHETIC_FIXTURE_ONLY'});
  });
  it('unconfigured production source does not fabricate MDVP data',async()=>{await expect(unconfiguredSource.load()).rejects.toThrow('not configured');});
  it('URL keeps canonical scope and selection across views',()=>{
    const q=regressionQuery(new URLSearchParams('view=pulse&repo=other%2Frepo&branch=release%2Fx&epoch=2&date=2026-09-17&run=R1&type=MTBF'),{scope:data.scope,date:failure.date,run:failure.id});
    expect(q.view).toBe('pulse');expect(sameScope(q.scope,data.scope)).toBe(false);
    expect(regressionQuery(new URLSearchParams(regressionUrl(q).split('?')[1]),{scope:data.scope,date:'',run:''})).toEqual(q);
  });
});
