import { afterEach, expect, it, vi } from 'vitest';
import { readBisect, resetBisect, writeBisect, type BisectCommand } from './bisect-client';
afterEach(()=>vi.unstubAllGlobals());
it('FR-SEQ-007 / WP-095 keeps API-SEQ-005 scope, epoch and session contract',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetcher);
  const scope={repository:'acme/demo',baseBranch:'release/26A'};
  await readBisect(scope);await writeBisect(scope,{action:'mark',seq_epoch:2,session_id:'42',merge_seq:8,verdict:'good'});await resetBisect(scope,'42');
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/bisect-sessions?repository=acme%2Fdemo&base_branch=release%2F26A');
  expect(JSON.parse(fetcher.mock.calls[1]?.[1].body as string)).toEqual({repository:'acme/demo',base_branch:'release/26A',action:'mark',seq_epoch:2,session_id:'42',merge_seq:8,verdict:'good'});
  expect(fetcher.mock.calls[2]?.[1]).toMatchObject({method:'DELETE',cache:'no-store'});
});
it('FR-REG-001 never sends fixture-only verdicts to the live API',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  for(const verdict of ['skip','inconclusive'])await expect(writeBisect({repository:'a/b',baseBranch:'main'},{action:'mark',verdict} as BisectCommand)).rejects.toThrow('good/bad only');
  expect(fetcher).not.toHaveBeenCalled();
});
