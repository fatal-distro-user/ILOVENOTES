import { useEffect, useRef } from 'react';
import { NotebookPen, PanelLeft, PanelRight, Search, Settings } from 'lucide-react';
import { useLayout } from '@/store/layout';
import { useTabs } from '@/store/tabs';
import { useStatus } from '@/store/status';
import { IconButton } from '@/ui/IconButton';
import { DialogHost } from '@/ui/dialogs';
import { GlobalOverlays } from './overlays';
import { usePanels } from '@/panels/registry';
import { DockResizer, PanelStack, PanelsMenuButton } from './Dock';
import { Explorer } from './explorer/Explorer';
import { SplitView, PaneContent } from './SplitView';
import { StatusBar, PomodoroTicker } from './StatusBar';
import { Scratchpad } from './Scratchpad';
import { ZenPill } from './ZenPill';
import { getBottomBar } from './bottomBars';
import { openSearch, openSettings } from './actions';

function TitleBar() {
  const leftOpen = useLayout((s) => s.leftOpen);
  const rightOpen = useLayout((s) => s.rightOpen);
  return (
    <header className="flex h-8 shrink-0 items-center justify-between border-b border-line bg-bg-1 px-1.5" data-testid="title-bar">
      <div className="flex items-center gap-1.5">
        <IconButton title="Toggle explorer" shortcut="Mod+\" active={leftOpen} onClick={() => useLayout.getState().toggleLeft()} data-testid="toggle-left"><PanelLeft size={15} /></IconButton>
        <div className="flex items-center gap-1.5 pl-1 text-[12px] font-semibold tracking-wide text-fg">
          <NotebookPen size={14} className="text-accent" />ILOVENOTES
        </div>
      </div>
      <div className="flex items-center gap-1">
        <IconButton title="Search" onClick={() => openSearch()} data-testid="open-search"><Search size={15} /></IconButton>
        <IconButton title="Settings" shortcut="Mod+," onClick={openSettings} data-testid="open-settings"><Settings size={15} /></IconButton>
        <IconButton title="Toggle right dock" shortcut="Mod+Alt+\" active={rightOpen} onClick={() => useLayout.getState().toggleRight()} data-testid="toggle-right"><PanelRight size={15} /></IconButton>
      </div>
    </header>
  );
}

function ZenContent() {
  const pane = useTabs((s) => s.panes.find((p) => p.id === s.focusedPaneId) ?? s.panes[0]);
  return <div className="min-h-0 min-w-0 flex-1 bg-bg" data-testid="zen-content"><PaneContent pane={pane} focused /></div>;
}

export function AppShell() {
  const zen = useLayout((s) => s.zen);
  const leftOpen = useLayout((s) => s.leftOpen);
  const rightOpen = useLayout((s) => s.rightOpen);
  const leftWidth = useLayout((s) => s.leftWidth);
  const rightWidth = useLayout((s) => s.rightWidth);
  const bottom = useLayout((s) => s.bottomBar);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);
  const defs = usePanels();
  const panelRows = useLayout((s) => s.panels.length);
  // Re-create layout rows for registered panels after a layout reset.
  useEffect(() => { for (const d of defs) useLayout.getState().ensurePanel(d.id, d.defaultSide); }, [defs, panelRows]);
  const BottomBar = bottom === 'none' ? undefined : getBottomBar(bottom);

  const activeKey = useTabs((s) => `${s.focusedPaneId}:${s.panes.find((p) => p.id === s.focusedPaneId)?.activeTabId}`);
  useEffect(() => { useStatus.getState().clearView(); }, [activeKey]);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      {!zen && <TitleBar />}
      <div className="flex min-h-0 flex-1">
        {!zen && leftOpen && (
          <aside ref={leftRef} className="relative flex shrink-0 flex-col border-r border-line bg-bg-1" style={{ width: leftWidth }} data-testid="left-dock">
            <Explorer />
            <DockResizer side="left" dockRef={leftRef} />
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">{zen ? <ZenContent /> : <SplitView />}</div>
          {!zen && BottomBar && <div className="shrink-0 border-t border-line bg-bg-1" data-testid="bottom-bar"><BottomBar /></div>}
        </main>
        {!zen && rightOpen && (
          <aside ref={rightRef} className="relative flex shrink-0 flex-col border-l border-line bg-bg-1" style={{ width: rightWidth }} data-testid="right-dock">
            <div className="flex h-8 shrink-0 items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
              Panels<PanelsMenuButton />
            </div>
            <PanelStack side="right" className="flex-1" />
            <DockResizer side="right" dockRef={rightRef} />
          </aside>
        )}
      </div>
      {!zen && <StatusBar />}
      {zen && <ZenPill />}
      <Scratchpad />
      <DialogHost />
      <GlobalOverlays />
      <PomodoroTicker />
    </div>
  );
}
