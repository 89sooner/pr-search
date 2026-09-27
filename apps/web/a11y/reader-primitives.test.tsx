import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from '../components/reader/primitives';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function CalendarHarness() {
  const [value, setValue] = useState('2026-09-17');
  return <DatePicker label="Merged after" value={value} onChange={setValue} />;
}

describe('repository calendar filter', () => {
  it('opens an accessible calendar and returns YYYY-MM-DD', async () => {
    render(<main><CalendarHarness /></main>);
    const trigger = screen.getByRole('button', { name: 'Merged after' });
    expect(trigger).toHaveTextContent('2026-09-17');
    await userEvent.click(trigger);
    expect(screen.getByLabelText('Merged after calendar')).toBeInTheDocument();
    const results = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'September 8, 2026' }));
    expect(trigger).toHaveTextContent('2026-09-08');
  });
});

function TodayHarness({ timeZone }: { timeZone?: string }) {
  const [value, setValue] = useState('');
  return <DatePicker label="Merged from (KST)" value={value} onChange={setValue} {...(timeZone === undefined ? {} : { timeZone })} />;
}

describe('CR-127: the calendar\'s today is the KST date, not the browser\'s', () => {
  // KST 2026-09-27 01:30 = UTC 2026-09-26 16:30 = LA 2026-09-26 09:30. The suite runs under TZ=UTC·Asia/Seoul·America/Los_Angeles.
  const NOW = new Date('2026-09-26T16:30:00Z');

  it('marks and fills the Korean date as today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    render(<main><TodayHarness /></main>);
    const trigger = screen.getByRole('button', { name: 'Merged from (KST)' });
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'September 27, 2026' })).toHaveAttribute('aria-current', 'date');
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(trigger).toHaveTextContent('2026-09-27');
  });

  it('a screen that names another time zone (analytics) gets that zone\'s today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    render(<main><TodayHarness timeZone="America/Los_Angeles" /></main>);
    await userEvent.click(screen.getByRole('button', { name: 'Merged from (KST)' }));
    expect(screen.getByRole('button', { name: 'September 26, 2026' })).toHaveAttribute('aria-current', 'date');
  });
});
