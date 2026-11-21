import { useState } from 'react';
import { BookOpen, Calendar, Columns2, FileText, GraduationCap, LayoutTemplate, Network, Columns3, PanelTop, Pin, Rows2, Search, Settings, Trash2, X, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useTabs, type Pane, type Tab, type TabKind } from '@/store/tabs';
import { useNode } from '@/db/hooks';
import { useContextMenu } from '@/ui/ContextMenu';
import { IconButton } from '@/ui/IconButton';

export const TAB_MIME = 'application/x-iln-tab';

const KIND_ICONS: Record<TabKind, LucideIcon> = {
  page: FileText, graph: Network, kanban: Columns3, calendar: Calendar, flashcards: GraduationCap,
  trash: Trash2, settings: Settings, search: Search, templates: LayoutTemplate,
};

function TabIcon({ tab }: { tab: Tab }) {
  const node = useNode(tab.kind === 'page' ? tab.pageId : null);
  if (tab.kind === 'page' && node?.icon) return <span className="text-[13px] leading-none">{node.icon}</span>;
  const Icon = KIND_ICONS[tab.kind] ?? BookOpen;
  return <Icon size={14} className="text-fg-muted" />;
}

export function TabBar({ pane, focused }: { pane: Pane; focused: boolean }) {
  const { activate, close, closeOthers, togglePin, moveTab, setSplit, openToSide } = useTabs.getState();
  const split = useTabs((s) => s.split);
  const { menu, show } = useContextMenu();
  const [drop, setDrop] = useState<{ tabId: string; side: 'left' | 'right' } | null>(null);

  const readDrag = (e: React.DragEvent): { paneId: string; tabId: string } | null => {
    try { return JSON.parse(e.dataTransfer.getData(TAB_MIME)); } catch { return null; }
  };

  const onTabDrop = (e: React.DragEvent, tab: Tab, idx: number) => {
    const d = readDrag(e);
    const side = drop?.side ?? 'left';
    setDrop(null);
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const before = side === 'left' ? tab.id : pane.tabs[idx + 1]?.id ?? null;
    if (before === d.tabId || (side === 'right' && d.tabId === tab.id)) return;
    moveTab(d.paneId, d.tabId, pane.id, before);
  };

  return (
    <div
      className="flex h-8 shrink-0 items-stretch border-b border-line bg-bg-1"
      data-testid="tab-bar"
      onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_MIME)) e.preventDefault(); }}
      onDrop={(e) => { const d = readDrag(e); if (d) { e.preventDefault(); moveTab(d.paneId, d.tabId, pane.id, null); } }}
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
        {pane.tabs.map((tab, idx) => {
          const active = tab.id === pane.activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              data-testid="tab"
              data-tab-title={tab.title}
              draggable
              title={tab.title}
              onDragStart={(e) => { e.dataTransfer.setData(TAB_MIME, JSON.stringify({ paneId: pane.id, tabId: tab.id })); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TAB_MIME)) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDrop({ tabId: tab.id, side: e.clientX < r.left + r.width / 2 ? 'left' : 'right' });
              }}
              onDragLeave={() => setDrop((d) => (d?.tabId === tab.id ? null : d))}
              onDragEnd={() => setDrop(null)}
              onDrop={(e) => onTabDrop(e, tab, idx)}
              onClick={() => activate(pane.id, tab.id)}
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              onAuxClick={(e) => { if (e.button === 1 && !tab.pinned) { e.preventDefault(); close(pane.id, tab.id); } }}
              onContextMenu={(e) => show(e, [
                { label: 'Close', disabled: !!tab.pinned, shortcut: 'Ctrl+W', onClick: () => close(pane.id, tab.id) },
                { label: 'Close Others', disabled: pane.tabs.length < 2, onClick: () => closeOthers(pane.id, tab.id) },
                { separator: true },
                { label: tab.pinned ? 'Unpin' : 'Pin', icon: <Pin size={13} />, onClick: () => togglePin(pane.id, tab.id) },
                { separator: true },
                { label: 'Open to Side', onClick: () => { const { id: _id, ...rest } = tab; void _id; openToSide(rest); } },
                { label: 'Split Right', icon: <Columns2 size={13} />, onClick: () => setSplit('vertical') },
                { label: 'Split Down', icon: <Rows2 size={13} />, onClick: () => setSplit('horizontal') },
              ])}
              className={clsx(
                'group relative flex shrink-0 cursor-default select-none items-center gap-1.5 border-r border-line pl-2.5 text-[12.5px]',
                tab.pinned ? 'w-9 justify-center pl-0 pr-0' : 'max-w-[200px] min-w-[96px] pr-1',
                active ? 'bg-bg text-fg' : 'bg-bg-1 text-fg-muted hover:bg-bg-2 hover:text-fg',
              )}
            >
              {active && <span className={clsx('absolute inset-x-0 bottom-0 h-[2px]', focused ? 'bg-accent' : 'bg-fg-faint')} />}
              {drop?.tabId === tab.id && <span className={clsx('absolute top-1 bottom-1 w-0.5 bg-accent', drop.side === 'left' ? 'left-0' : 'right-0')} />}
              <TabIcon tab={tab} />
              {!tab.pinned && (
                <>
                  <span className="min-w-0 flex-1 truncate" data-testid="tab-title">{tab.title || 'Untitled'}</span>
                  <button
                    aria-label={`Close ${tab.title}`}
                    title="Close"
                    data-testid="tab-close"
                    onClick={(e) => { e.stopPropagation(); close(pane.id, tab.id); }}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-faint opacity-0 hover:bg-bg-3 hover:text-fg group-hover:opacity-100 group-aria-selected:opacity-100"
                  ><X size={12} /></button>
                </>
              )}
            </div>
          );
        })}
        <div className="min-w-4 flex-1" />
      </div>
      {focused && (
        <div className="flex shrink-0 items-center gap-0.5 border-l border-line px-1">
          <IconButton title="Split vertically (side by side)" shortcut="Mod+Alt+V" active={split === 'vertical'} onClick={() => setSplit('vertical')} data-testid="split-vertical"><Columns2 size={14} /></IconButton>
          <IconButton title="Split horizontally (stacked)" shortcut="Mod+Alt+H" active={split === 'horizontal'} onClick={() => setSplit('horizontal')} data-testid="split-horizontal"><Rows2 size={14} /></IconButton>
          {split !== 'none' && <IconButton title="Unsplit" shortcut="Mod+Alt+U" onClick={() => setSplit('none')} data-testid="unsplit"><PanelTop size={14} /></IconButton>}
        </div>
      )}
      {menu}
    </div>
  );
}
