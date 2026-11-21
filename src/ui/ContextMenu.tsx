import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

export type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      onClick?: () => void;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      submenu?: MenuItem[];
    };

const isSep = (i: MenuItem): i is { separator: true } => i.separator === true;

function MenuList({ items, onClose, depth = 0, style }: { items: MenuItem[]; onClose: () => void; depth?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const actionable = items.map((it, i) => (!isSep(it) && !it.disabled ? i : -1)).filter((i) => i >= 0);
  const [active, setActive] = useState<number>(-1);
  const [openSub, setOpenSub] = useState<number>(-1);
  const [flip, setFlip] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (depth > 0) setFlip(el.getBoundingClientRect().right > window.innerWidth - 4);
    if (depth === 0) el.focus();
  }, [depth]);

  const activate = (i: number) => {
    const it = items[i];
    if (!it || isSep(it) || it.disabled) return;
    if (it.submenu) { setOpenSub(i); return; }
    onClose();
    it.onClick?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const pos = actionable.indexOf(active);
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActive(actionable[(pos + 1) % actionable.length] ?? -1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActive(actionable[(pos - 1 + actionable.length) % actionable.length] ?? -1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); activate(active); }
    else if (e.key === 'ArrowRight') {
      const it = items[active];
      if (it && !isSep(it) && it.submenu) { e.preventDefault(); e.stopPropagation(); setOpenSub(active); }
    } else if (e.key === 'ArrowLeft' && depth > 0) { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={style}
      className={clsx('min-w-[180px] max-w-[280px] rounded-md border border-line bg-bg-1 py-1 text-[13px] text-fg shadow-xl shadow-black/40 outline-none', depth > 0 && 'absolute top-[-5px]', depth > 0 && (flip ? 'right-full mr-0.5' : 'left-full ml-0.5'))}
    >
      {items.map((it, i) => {
        if (isSep(it)) return <div key={i} className="my-1 h-px bg-line" />;
        return (
          <div key={i} className="relative" onMouseEnter={() => { setActive(i); setOpenSub(it.submenu && !it.disabled ? i : -1); }}>
            <button
              role="menuitem"
              disabled={it.disabled}
              onClick={() => activate(i)}
              className={clsx(
                'flex h-7 w-full items-center gap-2 px-2.5 text-left',
                active === i && 'bg-bg-3',
                it.danger ? 'text-danger' : 'text-fg',
              )}
            >
              <span className="flex w-4 shrink-0 items-center justify-center text-fg-muted">{it.checked ? <Check size={14} /> : it.icon}</span>
              <span className="flex-1 truncate">{it.label}</span>
              {it.shortcut && <span className="ml-3 text-[11px] text-fg-faint">{it.shortcut}</span>}
              {it.submenu && <ChevronRight size={14} className="text-fg-faint" />}
            </button>
            {it.submenu && openSub === i && <MenuList items={it.submenu} onClose={onClose} depth={depth + 1} />}
          </div>
        );
      })}
    </div>
  );
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={wrap} className="fixed z-[80]" style={pos} onContextMenu={(e) => e.preventDefault()} data-testid="context-menu">
      <MenuList items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

/** Hook: `const { menu, show } = useContextMenu()`; call `show(event, items)` and render `{menu}`. */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const close = useCallback(() => setState(null), []);
  const show = useCallback((e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);
  const menu = state ? <ContextMenu x={state.x} y={state.y} items={state.items} onClose={close} /> : null;
  return { menu, show, close };
}
