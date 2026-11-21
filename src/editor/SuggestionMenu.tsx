import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useSuggest } from './suggestStore';

/** Floating list for slash commands and [[wiki-link]] completion. One instance is mounted app-wide. */
export function SuggestionMenu() {
  const { open, items, index, rect, kind } = useSuggest();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !rect || !ref.current) return;
    const h = ref.current.offsetHeight, w = ref.current.offsetWidth;
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    setPos({ left: Math.min(rect.left, window.innerWidth - w - 8), top });
  }, [open, rect, items.length]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  // An empty slash list hides itself so typing prose after "/" isn't obstructed.
  if (!open || (kind === 'slash' && items.length === 0)) return null;
  let lastGroup: string | undefined;
  return createPortal(
    <div ref={ref} data-testid={`suggest-${kind}`} className="fixed z-[80] max-h-80 w-72 overflow-y-auto rounded-md border border-line bg-bg-1 py-1 shadow-2xl" style={pos}
      onMouseDown={(e) => e.preventDefault()}>
      {items.length === 0 && <div className="px-3 py-2 text-fg-faint">{kind === 'wiki' ? 'Type a page name…' : 'No matching blocks'}</div>}
      {items.map((it, i) => {
        const header = it.group && it.group !== lastGroup ? it.group : null;
        lastGroup = it.group;
        return (
          <div key={it.id}>
            {header && <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-fg-faint uppercase">{header}</div>}
            <button data-index={i} className={clsx('flex w-full items-center gap-2 px-2.5 py-1.5 text-left', i === index ? 'bg-accent text-accent-fg' : 'hover:bg-bg-3')}
              onMouseEnter={() => useSuggest.setState({ index: i })} onClick={() => { useSuggest.setState({ index: i }); useSuggest.getState().choose(); }}>
              {it.icon && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-bg-2 text-[12px]">{it.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{it.title}</span>
                {it.subtitle && <span className={clsx('block truncate text-[11px]', i === index ? 'opacity-80' : 'text-fg-faint')}>{it.subtitle}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
