import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PaintDocument } from '../engine/document';

/** Studio-wide tool & colour state (persisted) plus the active document (runtime). */
export interface PaintStudioState {
  doc: PaintDocument | null;
  tool: string;
  previousTool: string;
  color: string;
  secondary: string;
  alpha: number;
  size: number;
  opacity: number;
  setDoc(d: PaintDocument | null): void;
  setTool(t: string): void;
  set(p: Partial<Omit<PaintStudioState, 'set' | 'setDoc' | 'setTool' | 'doc'>>): void;
  swapColors(): void;
}

export const usePaintStudio = create<PaintStudioState>()(
  persist(
    (set, get) => ({
      doc: null, tool: 'brush', previousTool: 'brush', color: '#1f2937', secondary: '#ffffff', alpha: 1, size: 12, opacity: 1,
      setDoc: (doc) => set({ doc }),
      setTool: (t) => { if (t !== get().tool) set({ previousTool: get().tool, tool: t }); },
      set: (p) => set(p),
      swapColors: () => set((s) => ({ color: s.secondary, secondary: s.color })),
    }),
    { name: 'iln-paint-studio', partialize: (s) => ({ tool: s.tool, color: s.color, secondary: s.secondary, alpha: s.alpha, size: s.size, opacity: s.opacity }) },
  ),
);
