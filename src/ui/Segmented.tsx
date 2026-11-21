import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  testId?: string;
}

export function Segmented<T extends string>({ value, options, onChange, className, testId }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" data-testid={testId} className={clsx('inline-flex rounded-md border border-line bg-bg-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex h-6 items-center gap-1 rounded px-2 text-[12px] transition-colors',
            value === o.value ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
