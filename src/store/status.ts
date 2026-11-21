import { create } from 'zustand';

/** Live readouts views push into the status bar. */
export interface StatusState {
  words: number | null;
  chars: number | null;
  strokes: number | null;
  layers: number | null;
  /** approximate raster memory in bytes */
  layerMemory: number | null;
  zoom: number | null;
  cursor: { x: number; y: number } | null;
  message: { text: string; kind: 'info' | 'ok' | 'error'; at: number } | null;
  set(p: Partial<Omit<StatusState, 'set' | 'toast' | 'clearView'>>): void;
  toast(text: string, kind?: 'info' | 'ok' | 'error'): void;
  /** Reset all view-specific readouts (on tab switch). */
  clearView(): void;
}

export const useStatus = create<StatusState>()((set) => ({
  words: null, chars: null, strokes: null, layers: null, layerMemory: null, zoom: null, cursor: null, message: null,
  set: (p) => set(p),
  toast: (text, kind = 'info') => set({ message: { text, kind, at: Date.now() } }),
  clearView: () => set({ words: null, chars: null, strokes: null, layers: null, layerMemory: null, zoom: null, cursor: null }),
}));

export const toast = (text: string, kind: 'info' | 'ok' | 'error' = 'info') => useStatus.getState().toast(text, kind);
