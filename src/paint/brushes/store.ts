import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import type { BrushParams } from './types';
import { BUILTIN_BRUSHES } from './presets';

export type BrushToolId = 'brush' | 'eraser' | 'smudge' | 'blur' | 'sharpen' | 'clone' | 'heal';

const DEFAULT_PRESET: Record<BrushToolId, string> = { brush: 'fineliner', eraser: 'eraser-soft', smudge: 'smudge', blur: 'blur', sharpen: 'sharpen', clone: 'clone', heal: 'heal' };

interface BrushState {
  presetByTool: Record<BrushToolId, string>;
  /** unsaved parameter edits per preset id */
  edits: Record<string, Partial<BrushParams>>;
  custom: BrushParams[];
  /** global StreamLine 0..1 (null = use the preset's default) */
  streamline: number | null;
  lazyMouse: boolean;
  cloneSource: { x: number; y: number } | null;
  loadCustom(): Promise<void>;
  setPreset(tool: BrushToolId, id: string): void;
  edit(id: string, patch: Partial<BrushParams>): void;
  resetEdits(id: string): void;
  saveAsNew(id: string, name: string): Promise<string>;
  saveOver(id: string): Promise<void>;
  deleteCustom(id: string): Promise<void>;
  set(p: Partial<Pick<BrushState, 'streamline' | 'lazyMouse' | 'cloneSource'>>): void;
}

export const useBrushes = create<BrushState>()(
  persist(
    (set, get) => ({
      presetByTool: DEFAULT_PRESET, edits: {}, custom: [], streamline: null, lazyMouse: false, cloneSource: null,
      loadCustom: async () => {
        const rows = (await db.brushes.toArray()).sort((a, b) => a.order - b.order);
        set({ custom: rows.map((r) => ({ ...(r.params as unknown as BrushParams), id: r.id, name: r.name, category: 'custom' })) });
      },
      setPreset: (tool, id) => set((s) => ({ presetByTool: { ...s.presetByTool, [tool]: id } })),
      edit: (id, patch) => set((s) => ({ edits: { ...s.edits, [id]: { ...s.edits[id], ...patch } } })),
      resetEdits: (id) => set((s) => { const e = { ...s.edits }; delete e[id]; return { edits: e }; }),
      saveAsNew: async (id, name) => {
        const p = resolvePreset(id);
        const nid = nanoid();
        const params: BrushParams = { ...p, id: nid, name, category: 'custom' };
        await db.brushes.put({ id: nid, name, builtin: false, params: params as unknown as Record<string, unknown>, order: Date.now() });
        await get().loadCustom();
        get().resetEdits(id);
        return nid;
      },
      saveOver: async (id) => {
        const p = resolvePreset(id);
        await db.brushes.put({ id, name: p.name, builtin: false, params: p as unknown as Record<string, unknown>, order: Date.now() });
        await get().loadCustom();
        get().resetEdits(id);
      },
      deleteCustom: async (id) => {
        await db.brushes.delete(id);
        await get().loadCustom();
        set((s) => ({ presetByTool: Object.fromEntries(Object.entries(s.presetByTool).map(([k, v]) => [k, v === id ? DEFAULT_PRESET[k as BrushToolId] : v])) as Record<BrushToolId, string> }));
      },
      set: (p) => set(p),
    }),
    { name: 'iln-brushes', partialize: (s) => ({ presetByTool: s.presetByTool, edits: s.edits, streamline: s.streamline, lazyMouse: s.lazyMouse }) },
  ),
);

export function allPresets(): BrushParams[] { return [...BUILTIN_BRUSHES, ...useBrushes.getState().custom]; }

/** Preset params with unsaved edits applied. */
export function resolvePreset(id: string): BrushParams {
  const base = allPresets().find((b) => b.id === id) ?? BUILTIN_BRUSHES[0];
  return { ...base, ...useBrushes.getState().edits[id] };
}

export function presetForTool(tool: BrushToolId): BrushParams { return resolvePreset(useBrushes.getState().presetByTool[tool]); }
