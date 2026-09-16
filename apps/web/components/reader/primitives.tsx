'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

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

export function FieldSelect({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[]; disabled?: boolean }): ReactNode {
  const id = useId();
  return <div className="repo-field"><label id={id}>{label}</label>
    <Select.Root value={value || '__all__'} onValueChange={next => { onChange(next === '__all__' ? '' : next); }} disabled={disabled}>
      <Select.Trigger className="reader-select" aria-labelledby={id}><Select.Value /><Select.Icon><ChevronDown size={14} /></Select.Icon></Select.Trigger>
      <Select.Portal><Select.Content position="popper" sideOffset={6} className="reader-ui reader-select-menu"><Select.Viewport>
        {options.map(option => <Select.Item key={option.value} value={option.value || '__all__'} className="reader-select-item"><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={14} /></Select.ItemIndicator></Select.Item>)}
      </Select.Viewport></Select.Content></Select.Portal>
    </Select.Root>
  </div>;
}
