import { useState, type RefObject } from 'react';
import { ChevronDown, ChevronRight, EyeOff, LayoutPanelLeft, MoveHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { usePanels, type PanelDef } from '@/panels/registry';
import { useLayout, type DockSide } from '@/store/layout';
import { useTabs } from '@/store/tabs';
import { IconButton } from '@/ui/IconButton';
import { Popover } from '@/ui/Popover';
import { useContextMenu } from '@/ui/ContextMenu';

export const PANEL_MIME = 'application/x-iln-panel';

/** Drag handle on the inner edge of a dock. */
export function DockResizer({ side, dockRef }: { side: DockSide; dockRef: RefObject<HTMLElement | null> }) {
  const onDown = (e: React.PointerEvent) => {
    const el = dockRef.current;
    if (!el) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => useLayout.getState().setWidth(side, side === 'left' ? ev.clientX - rect.left : rect.right - ev.clientX);
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  return (
    <div
      onPointerDown={onDown}
      role="separator"
      aria-orientation="vertical"
      data-testid={`dock-resizer-${side}`}
      className={clsx('absolute top-0 z-20 h-full w-1 cursor-col-resize transition-colors hover:bg-accent/60', side === 'left' ? '-right-0.5' : '-left-0.5')}
    />
  );
}

/** Small "Panels" button listing every registered panel with a visibility checkbox. */
export function PanelsMenuButton() {
  const panels = usePanels();
  const states = useLayout((s) => s.panels);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton title="Panels" data-testid="panels-menu" active={!!anchor} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}><LayoutPanelLeft size={14} /></IconButton>
      {anchor && (
        <Popover anchor={anchor} align="end" onClose={() => setAnchor(null)} className="min-w-[200px] py-1">
          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Panels</div>
          {panels.length === 0 && <div className="px-3 py-1 text-fg-faint">No panels registered</div>}
          {panels.map((p) => {
            const st = states.find((s) => s.id === p.id);
            return (
              <label key={p.id} className="flex h-7 cursor-pointer items-center gap-2 px-3 hover:bg-bg-3">
                <input type="checkbox" checked={!!st && !st.hidden} onChange={(e) => useLayout.getState().setPanelHidden(p.id, !e.target.checked)} className="accent-[var(--iln-accent)]" />
                <p.icon size={14} className="text-fg-muted" />
                <span className="flex-1">{p.title}</span>
                <span className="text-[11px] text-fg-faint">{st?.side}</span>
              </label>
            );
          })}
        </Popover>
      )}
    </>
  );
}

function PanelSection({ def, side, collapsed, height, nextId }: { def: PanelDef; side: DockSide; collapsed: boolean; height?: number; nextId: string | null }) {
  const [drop, setDrop] = useState<'before' | 'after' | null>(null);
  const { menu, show } = useContextMenu();
  const other: DockSide = side === 'left' ? 'right' : 'left';
  const items = () => [
    { label: `Move to ${other} dock`, icon: <MoveHorizontal size={13} />, onClick: () => useLayout.getState().movePanel(def.id, other) },
    { label: 'Hide', icon: <EyeOff size={13} />, onClick: () => useLayout.getState().setPanelHidden(def.id, true) },
  ];
  const Body = def.component;
  return (
    <section
      data-testid={`panel-${def.id}`}
      className={clsx('relative flex min-h-0 flex-col border-t border-line', !collapsed && (height ? 'shrink-0' : 'flex-1 basis-0'))}
      style={!collapsed && height ? { height } : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PANEL_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setDrop(e.clientY < r.top + r.height / 2 ? 'before' : 'after');
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(PANEL_MIME);
        const where = drop;
        setDrop(null);
        if (!id || id === def.id) return;
        e.preventDefault();
        e.stopPropagation();
        useLayout.getState().movePanel(id, side, where === 'before' ? def.id : nextId);
      }}
    >
      {drop && <div className={clsx('pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-accent', drop === 'before' ? 'top-0' : 'bottom-0')} />}
      <div
        draggable
        onDragStart={(e) => { e.dataTransfer.setData(PANEL_MIME, def.id); e.dataTransfer.effectAllowed = 'move'; }}
        onContextMenu={(e) => show(e, items())}
        className="flex h-7 shrink-0 cursor-default select-none items-center gap-1.5 bg-bg-1 pl-1.5 pr-1 text-[12px] font-medium text-fg-muted hover:text-fg"
      >
        <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => useLayout.getState().togglePanelCollapsed(def.id)} aria-expanded={!collapsed} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <def.icon size={14} />
          <span className="truncate">{def.title}</span>
        </button>
        <PanelMenu items={items} />
      </div>
      {!collapsed && <div className="min-h-0 flex-1 overflow-auto bg-bg-1"><Body /></div>}
      {menu}
    </section>
  );
}

function PanelMenu({ items }: { items: () => { label: string; icon: React.ReactNode; onClick: () => void }[] }) {
  const { menu, show } = useContextMenu();
  return (
    <>
      <IconButton title="Panel menu" size="sm" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); show({ clientX: r.left, clientY: r.bottom, preventDefault() {}, stopPropagation() {} }, items()); }}>
        <span className="text-[14px] leading-none">⋯</span>
      </IconButton>
      {menu}
    </>
  );
}

/** Stack of registered panels whose layout state places them in `side`. Also a drop target for panel drags. */
export function PanelStack({ side, className }: { side: DockSide; className?: string }) {
  const defs = usePanels();
  const states = useLayout((s) => s.panels);
  useTabs((s) => s.focusedPaneId + s.panes.map((p) => p.activeTabId).join()); // re-evaluate def.when() on tab changes
  const list = states
    .filter((s) => s.side === side && !s.hidden)
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ s, def: defs.find((d) => d.id === s.id) }))
    .filter((x): x is { s: typeof x.s; def: PanelDef } => !!x.def && (!x.def.when || x.def.when()));
  if (side === 'left' && list.length === 0) return null;
  const anyOpen = list.some((x) => !x.s.collapsed);
  return (
    <div
      className={clsx('flex min-h-0 flex-col', anyOpen ? 'flex-1' : 'shrink-0', className)}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(PANEL_MIME)) e.preventDefault(); }}
      onDrop={(e) => { const id = e.dataTransfer.getData(PANEL_MIME); if (id) { e.preventDefault(); useLayout.getState().movePanel(id, side, null); } }}
      data-testid={`panel-stack-${side}`}
    >
      {list.map(({ s, def }, i) => (
        <PanelSection key={def.id} def={def} side={side} collapsed={s.collapsed} height={s.height} nextId={list[i + 1]?.def.id ?? null} />
      ))}
    </div>
  );
}
