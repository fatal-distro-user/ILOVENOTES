import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HarmonyKind } from './colorMath';
import { pushHistory } from './palette';
import { usePaintStudio } from '../studio/store';

export type PickerMode = 'wheel' | 'box';
export type InputMode = 'hex' | 'rgb' | 'hsl' | 'hsv' | 'cmyk';

export interface ColorState {
  history: string[];
  activePaletteId: string | null;
  harmony: HarmonyKind;
  source: 'composite' | 'layer';
  returnToPrevious: boolean;
  pickerMode: PickerMode;
  inputMode: InputMode;
  extractCount: number;
  push(hex: string): void;
  removeHistory(hex: string): void;
  set(p: Partial<Omit<ColorState, 'push' | 'removeHistory' | 'set'>>): void;
}

export const useColor = create<ColorState>()(
  persist(
    (set) => ({
      history: [], activePaletteId: null, harmony: 'complementary', source: 'composite', returnToPrevious: true,
      pickerMode: 'wheel', inputMode: 'hex', extractCount: 8,
      push: (hex) => set((s) => ({ history: pushHistory(s.history, hex) })),
      removeHistory: (hex) => set((s) => ({ history: s.history.filter((c) => c !== hex) })),
      set: (p) => set(p),
    }),
    { name: 'iln-color-studio', partialize: (s) => ({ history: s.history, activePaletteId: s.activePaletteId, harmony: s.harmony, source: s.source, returnToPrevious: s.returnToPrevious, pickerMode: s.pickerMode, inputMode: s.inputMode, extractCount: s.extractCount }) },
  ),
);

/** Transient UI requests shared between commands and the panel. */
export const useColorUi = create<{ extractSource: Blob | null; extractName: string; setExtract(b: Blob | null, name?: string): void }>()((set) => ({
  extractSource: null, extractName: '',
  setExtract: (b, name = '') => set({ extractSource: b, extractName: name }),
}));

/** Set the primary (or secondary) colour and record it in history. */
export function commitColor(hex: string, secondary = false): void {
  usePaintStudio.getState().set(secondary ? { secondary: hex } : { color: hex });
  useColor.getState().push(hex);
}

const NON_COLOR_TOOLS = new Set(['eraser', 'smudge', 'blur', 'sharpen', 'dodge', 'burn', 'heal', 'clone', 'eyedropper']);

/**
 * Record the primary colour whenever a paint document's history grows with a raster stroke.
 * Returns an unsubscribe function.
 */
export function trackStrokeColors(): () => void {
  let offHistory: (() => void) | null = null;
  let current: object | null = null;
  let lastId = 0;
  const attach = (doc: ReturnType<typeof usePaintStudio.getState>['doc']) => {
    offHistory?.(); offHistory = null; current = doc;
    if (!doc) return;
    lastId = doc.history.list.at(-1)?.id ?? 0;
    offHistory = doc.history.subscribe(() => {
      const last = doc.history.list.at(-1);
      if (!last || last.id <= lastId) return;
      lastId = last.id;
      const st = usePaintStudio.getState();
      if (last.cmd.kind !== 'raster' || NON_COLOR_TOOLS.has(st.tool)) return;
      useColor.getState().push(st.color);
    });
  };
  attach(usePaintStudio.getState().doc);
  const offStudio = usePaintStudio.subscribe((s) => { if (s.doc !== current) attach(s.doc); });
  return () => { offStudio(); offHistory?.(); };
}
