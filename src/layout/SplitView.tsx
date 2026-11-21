import { useRef } from 'react';
import clsx from 'clsx';
import { useTabs, type Pane } from '@/store/tabs';
import { getTabView } from '@/views/registry';
import { StartScreen } from '@/views/StartScreen';
import { TabBar, TAB_MIME } from './TabBar';

export function PaneContent({ pane, focused }: { pane: Pane; focused: boolean }) {
  const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
  if (!tab) return <StartScreen paneId={pane.id} />;
  const View = getTabView(tab.kind);
  if (!View) return <div className="flex h-full items-center justify-center text-fg-muted">No view for {tab.kind}</div>;
  return <View key={tab.id} tab={tab} paneId={pane.id} active={focused} />;
}

function PaneView({ pane, showBar }: { pane: Pane; showBar: boolean }) {
  const focused = useTabs((s) => s.focusedPaneId === pane.id);
  const multi = useTabs((s) => s.panes.length > 1);
  return (
    <div
      className={clsx('flex min-h-0 min-w-0 flex-1 flex-col border-t-2', multi && focused ? 'border-accent' : 'border-transparent')}
      data-testid="pane"
      data-focused={focused}
      onPointerDownCapture={() => { if (!focused) useTabs.getState().focusPane(pane.id); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_MIME)) e.preventDefault(); }}
      onDrop={(e) => {
        try {
          const d = JSON.parse(e.dataTransfer.getData(TAB_MIME));
          e.preventDefault();
          useTabs.getState().moveTab(d.paneId, d.tabId, pane.id, null);
        } catch { /* not a tab drag */ }
      }}
    >
      {showBar && <TabBar pane={pane} focused={focused} />}
      <div className="min-h-0 flex-1 overflow-hidden bg-bg">
        <PaneContent pane={pane} focused={focused} />
      </div>
    </div>
  );
}

export function SplitView() {
  const panes = useTabs((s) => s.panes);
  const split = useTabs((s) => s.split);
  const ratio = useTabs((s) => s.splitRatio);
  const ref = useRef<HTMLDivElement>(null);

  if (split === 'none' || panes.length < 2) return <div className="flex min-h-0 min-w-0 flex-1" data-testid="split-view"><PaneView pane={panes[0]} showBar /></div>;

  const vertical = split === 'vertical';
  const startDrag = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const r = vertical ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      useTabs.getState().setSplitRatio(r);
    };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className={clsx('flex min-h-0 min-w-0 flex-1', vertical ? 'flex-row' : 'flex-col')} data-testid="split-view" data-split={split}>
      <div className="flex min-h-0 min-w-0" style={{ flex: `${ratio} 1 0%` }}><PaneView pane={panes[0]} showBar /></div>
      <div
        onPointerDown={startDrag}
        role="separator"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        className={clsx('z-10 shrink-0 bg-line transition-colors hover:bg-accent', vertical ? 'w-[3px] cursor-col-resize' : 'h-[3px] cursor-row-resize')}
      />
      <div className="flex min-h-0 min-w-0" style={{ flex: `${1 - ratio} 1 0%` }}><PaneView pane={panes[1]} showBar /></div>
    </div>
  );
}
