/** FR-SEQ-007 / FR-REG-001 / WP-095: the existing API-SEQ-005 wire contract. */
export interface BisectScope { readonly repository: string; readonly baseBranch: string }
export type BisectCommand =
  | { readonly action: 'start'; readonly seq_epoch: number; readonly from_seq: number; readonly to_seq: number }
  | { readonly action: 'mark'; readonly seq_epoch: number; readonly session_id: string; readonly merge_seq: number; readonly verdict: 'good' | 'bad' };
export function readBisect(scope: BisectScope, signal?: AbortSignal): Promise<Response> {
  const query=new URLSearchParams({repository:scope.repository,base_branch:scope.baseBranch});
  return fetch(`/api/bisect-sessions?${query}`,{cache:'no-store',...(signal?{signal}:{})});
}
export function writeBisect(scope: BisectScope, command: BisectCommand): Promise<Response> {
  // Runtime protection also rejects callers outside TypeScript. Fixture-only verdicts never reach the API.
  if(command.action==='mark'&&command.verdict!=='good'&&command.verdict!=='bad')return Promise.reject(new Error('The live bisect API supports good/bad only.'));
  return fetch('/api/bisect-sessions',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},
    body:JSON.stringify({repository:scope.repository,base_branch:scope.baseBranch,...command})});
}
export function resetBisect(scope: BisectScope, sessionId: string): Promise<Response> {
  const query=new URLSearchParams({repository:scope.repository,base_branch:scope.baseBranch,session_id:sessionId});
  return fetch(`/api/bisect-sessions?${query}`,{method:'DELETE',cache:'no-store'});
}
