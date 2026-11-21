import { Ban } from 'lucide-react';
import clsx from 'clsx';

export const NODE_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#7c5cff', '#ec4899', '#64748b'];

export interface ColorSwatchesProps {
  value: string;
  onChange: (c: string) => void;
  colors?: string[];
  /** Show a "no color" swatch that emits an empty string. */
  allowNone?: boolean;
}

export function ColorSwatches({ value, onChange, colors = NODE_COLORS, allowNone = true }: ColorSwatchesProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2" style={{ maxWidth: 200 }}>
      {allowNone && (
        <button
          title="No color" aria-label="No color" onClick={() => onChange('')}
          className={clsx('flex h-5 w-5 items-center justify-center rounded-full border border-line text-fg-muted', !value && 'ring-2 ring-accent')}
        ><Ban size={12} /></button>
      )}
      {colors.map((c) => (
        <button
          key={c} title={c} aria-label={`Color ${c}`} onClick={() => onChange(c)}
          className={clsx('h-5 w-5 rounded-full border border-black/20', value.toLowerCase() === c && 'ring-2 ring-accent ring-offset-1 ring-offset-bg-1')}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
