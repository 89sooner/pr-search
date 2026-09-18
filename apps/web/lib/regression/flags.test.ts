import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
it('FR-REG-001 route/navigation opt-in is explicit, and disabled by default',async()=>{
  for(const value of [undefined,'','0','true','1']){
    vi.stubEnv('NEXT_PUBLIC_REGRESSION_ENABLED',value);vi.resetModules();
    const {regressionEnabled}=await import('./flags');
    const {visibleNavEntries}=await import('../nav');
    expect(regressionEnabled).toBe(value==='1');expect(visibleNavEntries([]).some(e=>e.id==='regression')).toBe(value==='1');
    expect(visibleNavEntries([]).some(e=>e.id==='search')).toBe(true);
  }
});
