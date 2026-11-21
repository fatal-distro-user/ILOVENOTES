import { create } from 'zustand';

export interface SuggestItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  group?: string;
}

interface SuggestState {
  open: boolean;
  kind: 'slash' | 'wiki' | null;
  items: SuggestItem[];
  index: number;
  rect: { left: number; top: number; bottom: number } | null;
  select: ((item: SuggestItem) => void) | null;
  show(p: { kind: 'slash' | 'wiki'; items: SuggestItem[]; rect: DOMRect | null; select: (item: SuggestItem) => void }): void;
  update(p: { items: SuggestItem[]; rect: DOMRect | null; select: (item: SuggestItem) => void }): void;
  move(delta: number): void;
  choose(): boolean;
  hide(): void;
}

export const useSuggest = create<SuggestState>()((set, get) => ({
  open: false, kind: null, items: [], index: 0, rect: null, select: null,
  show: ({ kind, items, rect, select }) => set({ open: true, kind, items, index: 0, select, rect: rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null }),
  update: ({ items, rect, select }) => set((s) => ({ items, select, index: Math.min(s.index, Math.max(0, items.length - 1)), rect: rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : s.rect })),
  move: (d) => set((s) => ({ index: s.items.length ? (s.index + d + s.items.length) % s.items.length : 0 })),
  choose: () => {
    const s = get();
    const item = s.items[s.index];
    if (!s.open || !item || !s.select) return false;
    s.select(item);
    return true;
  },
  hide: () => set({ open: false, kind: null, items: [], select: null, rect: null }),
}));

/** Standard render() implementation for @tiptap/suggestion bound to the shared menu. */
export function suggestionRenderer<T extends SuggestItem>(kind: 'slash' | 'wiki') {
  return () => ({
    onStart: (props: { items: T[]; clientRect?: (() => DOMRect | null) | null; command: (item: T) => void }) => {
      useSuggest.getState().show({ kind, items: props.items, rect: props.clientRect?.() ?? null, select: (i) => props.command(i as T) });
    },
    onUpdate: (props: { items: T[]; clientRect?: (() => DOMRect | null) | null; command: (item: T) => void }) => {
      useSuggest.getState().update({ items: props.items, rect: props.clientRect?.() ?? null, select: (i) => props.command(i as T) });
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      const s = useSuggest.getState();
      if (!s.open || !s.items.length) return false;
      if (event.key === 'ArrowDown') { s.move(1); return true; }
      if (event.key === 'ArrowUp') { s.move(-1); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') return s.choose();
      if (event.key === 'Escape') { s.hide(); return true; }
      return false;
    },
    onExit: () => useSuggest.getState().hide(),
  });
}
