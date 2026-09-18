import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RegressionWorkbench } from '../components/regression/RegressionWorkbench';
import { ExistingBisectSession } from '../components/regression/ExistingBisectSession';
import { FIXTURE_STORAGE_KEY } from '../lib/regression/source';

vi.mock('next/navigation',()=>({useRouter:()=>({replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
beforeEach(()=>{localStorage.clear();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,run:()=>unknown)=>run()}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('FR-REG-001 / WP-095 Atlas renders the canonical interval and passes axe',async()=>{
  const {container}=render(<RegressionWorkbench fixtureEnabled/>);
  expect(await screen.findByText('59 PR + 1 direct push')).toBeVisible();
  expect(screen.getByTestId('regression-next')).toHaveTextContent('M-10550');
  const result=await axe.run(container,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']},rules:{'color-contrast':{enabled:false}}});
  expect(result.violations).toEqual([]);
});
it('FR-REG-001 explicit baseline confirmation, keyboard modal close, source lock, preserved archive',async()=>{
  const user=userEvent.setup();render(<RegressionWorkbench fixtureEnabled/>);
  await user.click(await screen.findByRole('button',{name:'Start bisect'}));
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Confirm comparable baseline');
  await user.keyboard('{Escape}');expect(screen.getByRole('button',{name:'Start bisect'})).toHaveFocus();
  await user.click(screen.getByRole('button',{name:'Start bisect'}));await user.click(screen.getByRole('button',{name:'Use this PASS and start'}));
  const pass=await screen.findByRole('button',{name:'✓ PASS'});await user.click(pass);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Observation history (1)'})).toBeVisible());
  await user.selectOptions(screen.getByLabelText('Preview source state'),'stale');expect(screen.getByRole('button',{name:'✓ PASS'})).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Preview source state'),'ready');await user.click(screen.getByRole('button',{name:'Archive session'}));
  await screen.findByRole('button',{name:'Start bisect'});await user.click(screen.getByRole('button',{name:'View preserved sessions'}));
  expect(await screen.findByRole('heading',{name:/Archived session/})).toBeVisible();
});
it('FR-REG-001 unconfigured mode has no synthetic results; live bisect uses only an explicit real scope',async()=>{
  const fetcher=vi.fn().mockImplementation(async(_url:string,init?:RequestInit)=>new Response(JSON.stringify({session:{session_id:'42',seq_epoch:3,good_seq:init?.method==='POST'?5:1,bad_seq:9,epoch_stale:false,remaining:init?.method==='POST'?2:4,estimated_steps:2,next:{merge_seq:init?.method==='POST'?8:5,commit_sha:'a'.repeat(40),pull_request_number:12},result:null,converged:false}})));
  vi.stubGlobal('fetch',fetcher);const user=userEvent.setup();render(<RegressionWorkbench/>);
  expect(await screen.findByRole('heading',{name:'MDVP integration is not configured'})).toBeVisible();expect(screen.queryByText('MDVP-78421')).toBeNull();expect(fetcher).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Real repository'),'real/repository');await user.click(screen.getByRole('button',{name:'Load saved session'}));
  await screen.findByRole('button',{name:'Good'});expect(fetcher.mock.calls[0]?.[0]).toContain('repository=real%2Frepository');
  await user.click(screen.getByRole('button',{name:'Good'}));expect(JSON.parse(fetcher.mock.calls[1]?.[1].body as string)).toMatchObject({repository:'real/repository',seq_epoch:3,session_id:'42',merge_seq:5,verdict:'good'});
  expect(await screen.findByTestId('bisect-next')).toHaveTextContent('seq: 8');
});
it('FR-REG-001 unreadable local history is visible and cannot be overwritten',async()=>{
  localStorage.setItem(FIXTURE_STORAGE_KEY,'corrupt');render(<RegressionWorkbench fixtureEnabled/>);
  await screen.findByText('59 PR + 1 direct push');await waitFor(()=>expect(screen.getByRole('button',{name:'Start bisect'})).toBeDisabled());expect(localStorage.getItem(FIXTURE_STORAGE_KEY)).toBe('corrupt');
});
it('FR-SEQ-007 empty real session stays separate from synthetic evidence',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({session:null}))));
  const user=userEvent.setup();render(<ExistingBisectSession/>);await user.type(screen.getByLabelText('Real repository'),'acme/app');await user.click(screen.getByRole('button',{name:'Load saved session'}));
  expect(await screen.findByRole('button',{name:'Start bisect in this range'})).toBeDisabled();
});
