import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';

/** Kinds of things a tab can show. Page tabs carry a pageId; others are app views. */
export type TabKind = 'page' | 'graph' | 'kanban' | 'calendar' | 'flashcards' | 'trash' | 'settings' | 'search' | 'templates' | 'paint';

export interface Tab { id: string; kind: TabKind; pageId?: string; title: string; pinned?: boolean; params?: Record<string, string> }
export interface Pane { id: string; tabs: Tab[]; activeTabId: string | null; history: string[] }
export type SplitDir = 'none' | 'horizontal' | 'vertical';

export interface TabsState {
  panes: Pane[];
  split: SplitDir;
  /** fraction (0..1) of space given to the first pane */
  splitRatio: number;
  focusedPaneId: string;
  open(tab: Omit<Tab, 'id'>, opts?: { newTab?: boolean; paneId?: string }): string;
  openPage(pageId: string, title: string, opts?: { newTab?: boolean; paneId?: string }): string;
  activate(paneId: string, tabId: string): void;
  close(paneId: string, tabId: string): void;
  closeOthers(paneId: string, tabId: string): void;
  closePage(pageId: string): void;
  renamePage(pageId: string, title: string): void;
  togglePin(paneId: string, tabId: string): void;
  moveTab(fromPane: string, tabId: string, toPane: string, beforeTabId?: string | null): void;
  focusPane(paneId: string): void;
  setSplit(dir: SplitDir): void;
  setSplitRatio(r: number): void;
  /** Opens the tab in the other split pane, creating a split if needed. */
  openToSide(tab: Omit<Tab, 'id'>): void;
  cycleTab(delta: number): void;
}

const newPane = (): Pane => ({ id: nanoid(8), tabs: [], activeTabId: null, history: [] });
const first = newPane();

function findTabMatch(p: Pane, t: Omit<Tab, 'id'>): Tab | undefined {
  return p.tabs.find((x) => x.kind === t.kind && (t.kind !== 'page' || x.pageId === t.pageId) && JSON.stringify(x.params ?? {}) === JSON.stringify(t.params ?? {}));
}

export const useTabs = create<TabsState>()(
  persist(
    immer((set, get) => ({
      panes: [first], split: 'none', splitRatio: 0.5, focusedPaneId: first.id,
      open: (tab, opts = {}) => {
        let resultId = '';
        set((s) => {
          const pane = s.panes.find((p) => p.id === (opts.paneId ?? s.focusedPaneId)) ?? s.panes[0];
          const existing = findTabMatch(pane, tab);
          if (existing) { resultId = existing.id; }
          else {
            const active = pane.tabs.find((t) => t.id === pane.activeTabId);
            // Replace the active tab unless asked for a new tab or the active one is pinned.
            if (!opts.newTab && active && !active.pinned) {
              const t: Tab = { ...tab, id: nanoid(8) };
              pane.tabs[pane.tabs.indexOf(active)] = t;
              resultId = t.id;
            } else {
              const t: Tab = { ...tab, id: nanoid(8) };
              const idx = active ? pane.tabs.indexOf(active) + 1 : pane.tabs.length;
              pane.tabs.splice(idx, 0, t);
              resultId = t.id;
            }
          }
          pane.activeTabId = resultId;
          pane.history = [...pane.history.filter((h) => h !== resultId), resultId].slice(-50);
          s.focusedPaneId = pane.id;
        });
        return resultId;
      },
      openPage: (pageId, title, opts) => get().open({ kind: 'page', pageId, title }, opts),
      activate: (paneId, tabId) => set((s) => {
        const p = s.panes.find((x) => x.id === paneId);
        if (!p || !p.tabs.some((t) => t.id === tabId)) return;
        p.activeTabId = tabId;
        p.history = [...p.history.filter((h) => h !== tabId), tabId].slice(-50);
        s.focusedPaneId = paneId;
      }),
      close: (paneId, tabId) => set((s) => {
        const p = s.panes.find((x) => x.id === paneId);
        if (!p) return;
        const idx = p.tabs.findIndex((t) => t.id === tabId);
        if (idx < 0) return;
        p.tabs.splice(idx, 1);
        p.history = p.history.filter((h) => h !== tabId);
        if (p.activeTabId === tabId) p.activeTabId = p.history.at(-1) ?? p.tabs[Math.min(idx, p.tabs.length - 1)]?.id ?? null;
        // Collapse an emptied split pane.
        if (!p.tabs.length && s.panes.length > 1) {
          s.panes = s.panes.filter((x) => x.id !== paneId);
          s.split = 'none';
          s.focusedPaneId = s.panes[0].id;
        }
      }),
      closeOthers: (paneId, tabId) => set((s) => {
        const p = s.panes.find((x) => x.id === paneId);
        if (!p) return;
        p.tabs = p.tabs.filter((t) => t.id === tabId || t.pinned);
        p.activeTabId = tabId;
        p.history = [tabId];
      }),
      closePage: (pageId) => {
        for (const p of get().panes) for (const t of p.tabs) if (t.pageId === pageId) get().close(p.id, t.id);
      },
      renamePage: (pageId, title) => set((s) => { for (const p of s.panes) for (const t of p.tabs) if (t.pageId === pageId) t.title = title; }),
      togglePin: (paneId, tabId) => set((s) => {
        const t = s.panes.find((x) => x.id === paneId)?.tabs.find((x) => x.id === tabId);
        if (t) t.pinned = !t.pinned;
      }),
      moveTab: (fromPane, tabId, toPane, beforeTabId) => set((s) => {
        const from = s.panes.find((x) => x.id === fromPane);
        const to = s.panes.find((x) => x.id === toPane);
        if (!from || !to) return;
        const idx = from.tabs.findIndex((t) => t.id === tabId);
        if (idx < 0) return;
        const [tab] = from.tabs.splice(idx, 1);
        from.history = from.history.filter((h) => h !== tabId);
        if (from.activeTabId === tabId) from.activeTabId = from.history.at(-1) ?? from.tabs[0]?.id ?? null;
        const bi = beforeTabId ? to.tabs.findIndex((t) => t.id === beforeTabId) : -1;
        to.tabs.splice(bi < 0 ? to.tabs.length : bi, 0, tab);
        to.activeTabId = tab.id;
        to.history.push(tab.id);
        s.focusedPaneId = to.id;
        if (!from.tabs.length && s.panes.length > 1) {
          s.panes = s.panes.filter((x) => x.id !== from.id);
          s.split = 'none';
        }
      }),
      focusPane: (paneId) => set((s) => { if (s.panes.some((p) => p.id === paneId)) s.focusedPaneId = paneId; }),
      setSplit: (dir) => set((s) => {
        if (dir === 'none') {
          if (s.panes.length > 1) {
            const [a, ...rest] = s.panes;
            for (const r of rest) for (const t of r.tabs) if (!findTabMatch(a, t)) a.tabs.push(t);
            s.panes = [a];
            s.focusedPaneId = a.id;
          }
          s.split = 'none';
          return;
        }
        if (s.panes.length === 1) {
          const a = s.panes[0];
          const b = newPane();
          const active = a.tabs.find((t) => t.id === a.activeTabId);
          if (active) { const copy = { ...active, id: nanoid(8) }; b.tabs.push(copy); b.activeTabId = copy.id; b.history = [copy.id]; }
          s.panes.push(b);
          s.focusedPaneId = b.id;
        }
        s.split = dir;
      }),
      setSplitRatio: (r) => set((s) => { s.splitRatio = Math.max(0.15, Math.min(0.85, r)); }),
      openToSide: (tab) => {
        const st = get();
        if (st.panes.length === 1) st.setSplit('vertical');
        const s2 = get();
        const other = s2.panes.find((p) => p.id !== st.focusedPaneId) ?? s2.panes[1];
        s2.open(tab, { paneId: other.id, newTab: true });
      },
      cycleTab: (delta) => set((s) => {
        const p = s.panes.find((x) => x.id === s.focusedPaneId);
        if (!p || !p.tabs.length) return;
        const idx = p.tabs.findIndex((t) => t.id === p.activeTabId);
        const next = p.tabs[(idx + delta + p.tabs.length) % p.tabs.length];
        p.activeTabId = next.id;
      }),
    })),
    { name: 'iln-tabs', version: 1 },
  ),
);

export function activeTab(): Tab | undefined {
  const s = useTabs.getState();
  const p = s.panes.find((x) => x.id === s.focusedPaneId);
  return p?.tabs.find((t) => t.id === p.activeTabId);
}
