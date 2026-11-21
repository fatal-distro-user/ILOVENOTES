import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export type ThemeId = 'dark-studio' | 'light-paper' | 'midnight-oled' | 'sepia' | 'high-contrast';
export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'dark-studio', label: 'Dark Studio' },
  { id: 'light-paper', label: 'Light Paper' },
  { id: 'midnight-oled', label: 'Midnight OLED' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'high-contrast', label: 'High Contrast' },
];
export const ACCENTS = ['#7c5cff', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7'];

export type DockSide = 'left' | 'right';
export interface DockPanelState { id: string; side: DockSide; collapsed: boolean; hidden: boolean; order: number; height?: number }

export interface LayoutState {
  theme: ThemeId;
  /** null = theme default accent */
  accent: string | null;
  customCss: string;
  customCssEnabled: boolean;
  uiScale: number;
  leftOpen: boolean; rightOpen: boolean;
  leftWidth: number; rightWidth: number;
  zen: boolean;
  scratchpadOpen: boolean;
  bottomBar: 'none' | 'timeline' | 'audio';
  panels: DockPanelState[];
  setTheme(t: ThemeId): void;
  setAccent(a: string | null): void;
  setCustomCss(css: string): void;
  setCustomCssEnabled(v: boolean): void;
  setUiScale(s: number): void;
  toggleLeft(force?: boolean): void;
  toggleRight(force?: boolean): void;
  setWidth(side: DockSide, w: number): void;
  toggleZen(force?: boolean): void;
  toggleScratchpad(force?: boolean): void;
  setBottomBar(b: LayoutState['bottomBar']): void;
  /** Ensure a registered panel has a state row (called by the panel registry). */
  ensurePanel(id: string, side: DockSide): void;
  togglePanelCollapsed(id: string): void;
  setPanelHidden(id: string, hidden: boolean): void;
  /** Move a panel to a dock, before another panel (or to the end). */
  movePanel(id: string, side: DockSide, beforeId?: string | null): void;
  setPanelHeight(id: string, h: number | undefined): void;
  resetLayout(): void;
}

const clampW = (w: number) => Math.max(180, Math.min(640, Math.round(w)));

export const useLayout = create<LayoutState>()(
  persist(
    immer((set) => ({
      theme: 'dark-studio', accent: null, customCss: '', customCssEnabled: true, uiScale: 1,
      leftOpen: true, rightOpen: true, leftWidth: 264, rightWidth: 300,
      zen: false, scratchpadOpen: false, bottomBar: 'none', panels: [],
      setTheme: (t) => set((s) => { s.theme = t; }),
      setAccent: (a) => set((s) => { s.accent = a; }),
      setCustomCss: (css) => set((s) => { s.customCss = css; }),
      setCustomCssEnabled: (v) => set((s) => { s.customCssEnabled = v; }),
      setUiScale: (v) => set((s) => { s.uiScale = Math.max(0.75, Math.min(1.5, v)); }),
      toggleLeft: (f) => set((s) => { s.leftOpen = f ?? !s.leftOpen; }),
      toggleRight: (f) => set((s) => { s.rightOpen = f ?? !s.rightOpen; }),
      setWidth: (side, w) => set((s) => { if (side === 'left') s.leftWidth = clampW(w); else s.rightWidth = clampW(w); }),
      toggleZen: (f) => set((s) => { s.zen = f ?? !s.zen; }),
      toggleScratchpad: (f) => set((s) => { s.scratchpadOpen = f ?? !s.scratchpadOpen; }),
      setBottomBar: (b) => set((s) => { s.bottomBar = b; }),
      ensurePanel: (id, side) => set((s) => {
        if (s.panels.some((p) => p.id === id)) return;
        const order = Math.max(0, ...s.panels.filter((p) => p.side === side).map((p) => p.order)) + 1;
        s.panels.push({ id, side, collapsed: false, hidden: false, order });
      }),
      togglePanelCollapsed: (id) => set((s) => { const p = s.panels.find((x) => x.id === id); if (p) p.collapsed = !p.collapsed; }),
      setPanelHidden: (id, hidden) => set((s) => { const p = s.panels.find((x) => x.id === id); if (p) p.hidden = hidden; }),
      movePanel: (id, side, beforeId) => set((s) => {
        const p = s.panels.find((x) => x.id === id);
        if (!p) return;
        const others = s.panels.filter((x) => x.side === side && x.id !== id).sort((a, b) => a.order - b.order);
        const idx = beforeId ? others.findIndex((o) => o.id === beforeId) : -1;
        const seq = [...others];
        seq.splice(idx < 0 ? seq.length : idx, 0, p);
        p.side = side;
        p.hidden = false;
        seq.forEach((x, i) => { x.order = i + 1; });
      }),
      setPanelHeight: (id, h) => set((s) => { const p = s.panels.find((x) => x.id === id); if (p) p.height = h; }),
      resetLayout: () => set((s) => { s.panels = []; s.leftOpen = true; s.rightOpen = true; s.leftWidth = 264; s.rightWidth = 300; s.zen = false; }),
    })),
    { name: 'iln-layout', version: 1 },
  ),
);

/** Applies theme, accent, ui scale and custom CSS snippet to the document. */
export function applyAppearance(state: Pick<LayoutState, 'theme' | 'accent' | 'customCss' | 'customCssEnabled' | 'uiScale'>): void {
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  if (state.accent) {
    root.style.setProperty('--iln-accent', state.accent);
    root.style.setProperty('--iln-accent-fg', readableOn(state.accent));
  } else {
    root.style.removeProperty('--iln-accent');
    root.style.removeProperty('--iln-accent-fg');
  }
  root.style.fontSize = `${13 * state.uiScale}px`;
  let el = document.getElementById('iln-custom-css') as HTMLStyleElement | null;
  if (!el) { el = document.createElement('style'); el.id = 'iln-custom-css'; document.head.appendChild(el); }
  el.textContent = state.customCssEnabled ? state.customCss : '';
}

/** Black or white text, whichever contrasts better with the given hex colour. */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const v = parseInt(m[1], 16);
  const lin = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  return L > 0.4 ? '#000000' : '#ffffff';
}
