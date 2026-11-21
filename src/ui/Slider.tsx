import clsx from 'clsx';

export interface SliderProps {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
  label?: string;
  format?: (v: number) => string;
  className?: string;
}

export function Slider({ value, min, max, step = 1, onChange, label, format, className }: SliderProps) {
  return (
    <label className={clsx('flex items-center gap-2 text-[12px] text-fg-muted', className)}>
      {label && <span className="w-20 shrink-0">{label}</span>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="h-1 flex-1 cursor-pointer accent-[var(--iln-accent)]"
      />
      <span className="w-10 shrink-0 text-right tabular-nums text-fg">{format ? format(value) : value}</span>
    </label>
  );
}
