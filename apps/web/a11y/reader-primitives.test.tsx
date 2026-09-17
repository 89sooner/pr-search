import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DatePicker } from '../components/reader/primitives';

afterEach(cleanup);

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
