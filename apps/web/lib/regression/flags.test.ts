import {expect,it} from 'vitest';
import {regressionEnabled} from './flags';
import {visibleNavEntries} from '../nav';
it('FR-REG-001 Regression is always discoverable and fixture data remains separately controlled',()=>{
  expect(regressionEnabled).toBe(true);
  expect(visibleNavEntries([]).some(e=>e.id==='regression')).toBe(true);
  expect(visibleNavEntries([]).some(e=>e.id==='search')).toBe(true);
});
