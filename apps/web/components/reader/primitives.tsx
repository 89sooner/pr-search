'use client';

import { useEffect, useId, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }): ReactNode {
  return <button {...props} type={type} className={`reader-button reader-button--${variant} reader-button--${size} ${className}`} />;
}
export function Skeleton({ label }: { label: string }): ReactNode {
  return <div className="reader-skeleton" role={label ? 'status' : undefined} aria-label={label || undefined} />;
}
function DataTable({ scrollContainerProps, ...props }: ComponentProps<'table'> & { scrollContainerProps?: ComponentProps<'div'> }): ReactNode {
  return <div {...scrollContainerProps} className="reader-table-scroll" role="region" aria-label={props['aria-label']}><table {...props} /></div>;
}
export const Table = Object.assign(DataTable, {
  Head: (props: ComponentProps<'thead'>) => <thead {...props} />,
  Body: (props: ComponentProps<'tbody'>) => <tbody {...props} />,
  Row: (props: ComponentProps<'tr'>) => <tr {...props} />,
  HeaderCell: (props: ComponentProps<'th'>) => <th {...props} />,
  Cell: (props: ComponentProps<'td'>) => <td {...props} />,
});

export function FieldSelect({ label, value, onChange, options, disabled = false, className = '' }: { label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string; disabled?: boolean }[]; disabled?: boolean; className?: string }): ReactNode {
  const id = useId();
  return <div className={`repo-field ${className}`.trim()}><label id={id}>{label}</label>
    <Select.Root value={value || '__all__'} onValueChange={next => { onChange(next === '__all__' ? '' : next); }} disabled={disabled}>
      <Select.Trigger className="reader-select" aria-labelledby={id}><Select.Value /><Select.Icon><ChevronDown size={14} /></Select.Icon></Select.Trigger>
      <Select.Portal><Select.Content position="popper" sideOffset={6} className="reader-ui reader-select-menu"><Select.Viewport>
        {options.map(option => <Select.Item key={option.value} value={option.value || '__all__'} {...(option.disabled !== undefined ? { disabled: option.disabled } : {})} className="reader-select-item"><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={14} /></Select.ItemIndicator></Select.Item>)}
      </Select.Viewport></Select.Content></Select.Portal>
    </Select.Root>
  </div>;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
}
function isoDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function DatePicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): ReactNode {
  const id = useId(); const selected = parseDate(value); const today = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date((selected ?? today).getFullYear(), (selected ?? today).getMonth(), 1));
  useEffect(() => { const next = parseDate(value); if (next) setMonth(new Date(next.getFullYear(), next.getMonth(), 1)); }, [value]);
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const days = Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  return <div className="repo-field reader-date-field"><label id={id}>{label}</label><Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger className="reader-date-trigger" data-empty={!value || undefined} aria-labelledby={id}><span>{value || 'YYYY-MM-DD'}</span><CalendarDays size={15} /></Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={7} className="reader-ui reader-calendar" aria-label={`${label} calendar`}>
      <header><button type="button" aria-label="Previous month" onClick={() => { setMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1)); }}><ChevronLeft size={15} /></button><strong>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong><button type="button" aria-label="Next month" onClick={() => { setMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1)); }}><ChevronRight size={15} /></button></header>
      <div className="reader-calendar-grid">{WEEKDAYS.map(day => <span key={day} aria-hidden="true">{day}</span>)}{days.map(day => { const iso = isoDate(day); return <button type="button" key={iso} data-outside={day.getMonth() !== month.getMonth() || undefined} aria-pressed={value === iso} aria-current={iso === isoDate(today) ? 'date' : undefined} aria-label={day.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} onClick={() => { onChange(iso); setOpen(false); }}>{day.getDate()}</button>; })}</div>
      <footer><button type="button" onClick={() => { onChange(''); setOpen(false); }}>Clear</button><button type="button" onClick={() => { const iso = isoDate(today); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); onChange(iso); setOpen(false); }}>Today</button></footer>
      <Popover.Arrow className="reader-calendar-arrow" />
    </Popover.Content></Popover.Portal>
  </Popover.Root></div>;
}
