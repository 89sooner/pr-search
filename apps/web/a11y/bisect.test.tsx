import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { BisectPanel } from '../components/BisectPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('C-029 announces candidate count and passes axe in progress', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ session: {
    session_id: '1', seq_epoch: 1, good_seq: 1, bad_seq: 9, epoch_stale: false, remaining: 4, estimated_steps: 2,
    next: { merge_seq: 5, commit_sha: 'a'.repeat(40), pull_request_number: 42 }, result: null, converged: false,
  } }))));
  const { container } = render(<BisectPanel repository="acme/payments" baseBranch="main" range={null} />);
  expect(await screen.findByText("Remaining candidates: 4 · Estimated remaining checks: 2")).toHaveAttribute('aria-live', 'polite');
  const results = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations).toEqual([]);
});

it('epoch conflict on mark immediately invalidates the displayed next point', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ session: {
      session_id: '1', seq_epoch: 1, good_seq: 1, bad_seq: 9, epoch_stale: false, remaining: 4, estimated_steps: 2,
      next: { merge_seq: 5, commit_sha: 'a'.repeat(40), pull_request_number: 42 }, result: null, converged: false,
    } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SEQUENCE_EPOCH_STALE', message: '탐색을 초기화하세요.' } }), { status: 409 })));
  render(<BisectPanel repository="acme/payments" baseBranch="main" range={null} />);
  const good = await screen.findByRole('button', { name: /^Good$/ });
  await userEvent.setup().click(good);
  expect(await screen.findByText("Invalid bisect state")).toBeVisible();
  expect(screen.queryByTestId('bisect-next')).toBeNull();
  expect(screen.getByRole('button', { name: "Reset bisect" })).toBeEnabled();
});
