'use client';

import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { canonicalTimeZone, todayIn } from '@prs/query';
import { DISPLAY_TIME_ZONE } from '../../lib/format';

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
/*
 * 달력 격자는 **UTC 자정 값**으로 계산하고 UTC로 이름을 읽는다 (CR-127). 지역 시각
 * `Date`로 계산하면 브라우저 시간대가 격자와 날짜 이름을 흔든다 — 같은 URL이 서울과
 * 로스앤젤레스에서 다른 달력을 그리면 안 된다. 「오늘」만 시간대가 필요하고, 그것은
 * `timeZone`(기본 Asia/Seoul)의 날짜다.
 */
function utcDay(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month, day);
  return date;
}
function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = utcDay(year, month, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
}
function isoDate(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
const MONTH_NAME = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const DAY_NAME = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
/** 그 시간대의 오늘. 모르는 시간대면 표시 시간대(KST)의 오늘이다. */
function todayOf(timeZone: string): string {
  return todayIn(canonicalTimeZone(timeZone) ?? DISPLAY_TIME_ZONE, Date.now());
}
export function DatePicker({ label, value, onChange, timeZone = DISPLAY_TIME_ZONE }: { label: string; value: string; onChange: (value: string) => void; timeZone?: string }): ReactNode {
  const id = useId(); const selected = parseDate(value); const today = todayOf(timeZone);
  const todayDate = parseDate(today) ?? utcDay(1970, 0, 1);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => utcDay((selected ?? todayDate).getUTCFullYear(), (selected ?? todayDate).getUTCMonth(), 1));
  useEffect(() => { const next = parseDate(value); if (next) setMonth(utcDay(next.getUTCFullYear(), next.getUTCMonth(), 1)); }, [value]);
  const start = utcDay(month.getUTCFullYear(), month.getUTCMonth(), 1 - month.getUTCDay());
  const days = Array.from({ length: 42 }, (_, index) => utcDay(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index));
  return <div className="repo-field reader-date-field"><label id={id}>{label}</label><Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger className="reader-date-trigger" data-empty={!value || undefined} aria-labelledby={id}><span>{value || 'YYYY-MM-DD'}</span><CalendarDays size={15} /></Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={7} className="reader-ui reader-calendar" aria-label={`${label} calendar`}>
      <header><button type="button" aria-label="Previous month" onClick={() => { setMonth(current => utcDay(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)); }}><ChevronLeft size={15} /></button><strong>{MONTH_NAME.format(month)}</strong><button type="button" aria-label="Next month" onClick={() => { setMonth(current => utcDay(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)); }}><ChevronRight size={15} /></button></header>
      <div className="reader-calendar-grid">{WEEKDAYS.map(day => <span key={day} aria-hidden="true">{day}</span>)}{days.map(day => { const iso = isoDate(day); return <button type="button" key={iso} data-outside={day.getUTCMonth() !== month.getUTCMonth() || undefined} aria-pressed={value === iso} aria-current={iso === today ? 'date' : undefined} aria-label={DAY_NAME.format(day)} onClick={() => { onChange(iso); setOpen(false); }}>{day.getUTCDate()}</button>; })}</div>
      <footer><button type="button" onClick={() => { onChange(''); setOpen(false); }}>Clear</button><button type="button" onClick={() => { setMonth(utcDay(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1)); onChange(today); setOpen(false); }}>Today</button></footer>
      <Popover.Arrow className="reader-calendar-arrow" />
    </Popover.Content></Popover.Portal>
  </Popover.Root></div>;
}
