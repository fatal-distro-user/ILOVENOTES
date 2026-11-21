import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

function load(id: string, def: boolean): boolean {
  try { const v = localStorage.getItem(`iln-section-${id}`); return v === null ? def : v === '1'; } catch { return def; }
}

/** Collapsible explorer section; open/closed state persists in localStorage. */
export function Section({ id, title, actions, children, defaultOpen = true, badge }: { id: string; title: string; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(() => load(id, defaultOpen));
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(`iln-section-${id}`, o ? '0' : '1'); } catch { /* storage unavailable */ }
      return !o;
    });
  };
  return (
    <section data-testid={`section-${id}`} className="border-b border-line">
      <div className="group flex h-7 items-center pr-1 hover:bg-bg-2">
        <button onClick={toggle} aria-expanded={open} className="flex h-full min-w-0 flex-1 items-center gap-1 pl-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="truncate">{title}</span>
          {badge}
        </button>
        {actions && <div className="flex items-center">{actions}</div>}
      </div>
      {open && <div className="pb-1">{children}</div>}
    </section>
  );
}
