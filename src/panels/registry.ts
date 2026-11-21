/**
 * Dock panel registry. Feature modules register panels (Outline, Backlinks, Layers, Color, Brushes,
 * History, ...). The dock renders registered panels according to useLayout().panels state.
 */
import type { ComponentType } from 'react';
import { useSyncExternalStore } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useLayout, type DockSide } from '@/store/layout';

export interface PanelDef {
  id: string;
  title: string;
  icon: LucideIcon;
  defaultSide: DockSide;
  component: ComponentType;
  /** Show only when relevant (e.g. Layers only for paint frames). Panels hidden by context remain in layout state. */
  when?: () => boolean;
  /** Sort hint for first-time placement */
  defaultOrder?: number;
}

const panels = new Map<string, PanelDef>();
const listeners = new Set<() => void>();
let snapshot: PanelDef[] = [];

export function registerPanel(def: PanelDef): () => void {
  panels.set(def.id, def);
  snapshot = Array.from(panels.values()).sort((a, b) => (a.defaultOrder ?? 50) - (b.defaultOrder ?? 50));
  useLayout.getState().ensurePanel(def.id, def.defaultSide, def.defaultOrder);
  listeners.forEach((l) => l());
  return () => {
    panels.delete(def.id);
    snapshot = Array.from(panels.values());
    listeners.forEach((l) => l());
  };
}

export function getPanel(id: string): PanelDef | undefined { return panels.get(id); }

export function usePanels(): PanelDef[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
}
