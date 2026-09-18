'use client';
import { useState, type ReactNode } from 'react';
import { BisectPanel } from '../BisectPanel';

/** FR-REG-001 AC-5: an explicit real scope; fixture revisions never enter this path. */
export function ExistingBisectSession():ReactNode {
  const [repository,setRepository]=useState(''),[branch,setBranch]=useState('main');
  const [scope,setScope]=useState<{repository:string;branch:string}|null>(null);
  return <section className="rg-panel rg-live-session" aria-label="Existing server bisect">
    <h2>Continue an existing server bisect</h2><p>The existing authenticated API restores your saved boundaries and supports Good / Bad only. It does not provide MDVP runs or an observation archive.</p>
    <form onSubmit={e=>{e.preventDefault();if(repository.trim()&&branch.trim())setScope({repository:repository.trim(),branch:branch.trim()});}} className="rg-scope-bar">
      <label>Real repository<input required aria-label="Real repository" value={repository} onChange={e=>setRepository(e.target.value)} placeholder="owner/repository"/></label>
      <label>Base branch<input required aria-label="Real base branch" value={branch} onChange={e=>setBranch(e.target.value)}/></label>
      <button type="submit" className="rg-button">Load saved session</button>
    </form>
    {scope?<BisectPanel key={JSON.stringify(scope)} repository={scope.repository} baseBranch={scope.branch} range={null}/>:null}
  </section>;
}
