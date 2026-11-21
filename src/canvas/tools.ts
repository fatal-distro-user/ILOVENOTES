import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CanvasTool =
  | 'select' | 'hand' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'rect' | 'ellipse' | 'diamond' | 'triangle'
  | 'line' | 'arrow' | 'frame' | 'sticky' | 'connector' | 'laser';

export type BackgroundKind = 'none' | 'grid' | 'dot' | 'isometric' | 'hex' | 'ruled' | 'staff' | 'cornell';

export interface CanvasToolState {
  tool: CanvasTool;
  /** tool to return to after a one-shot creation */
  sticky: boolean;
  penColor: string; penWidth: number; penOpacity: number;
  hlColor: string; hlWidth: number;
  eraserSize: number;
  strokeColor: string; fillColor: string; strokeWidth: number;
  smoothing: number;
  snapToGrid: boolean;
  smartGuides: boolean;
  setTool(t: CanvasTool): void;
  set(p: Partial<Omit<CanvasToolState, 'set' | 'setTool'>>): void;
}

export const useCanvasTools = create<CanvasToolState>()(
  persist(
    (set) => ({
      tool: 'select', sticky: false,
      penColor: '#e6e8ee', penWidth: 4, penOpacity: 1,
      hlColor: '#facc15', hlWidth: 18,
      eraserSize: 16,
      strokeColor: '#7c5cff', fillColor: 'transparent', strokeWidth: 2,
      smoothing: 0.4,
      snapToGrid: false, smartGuides: true,
      setTool: (tool) => set({ tool }),
      set: (p) => set(p),
    }),
    { name: 'iln-canvas-tools' },
  ),
);

export const TOOL_SHORTCUTS: Record<string, CanvasTool> = {
  V: 'select', H: 'hand', P: 'pen', M: 'highlighter', E: 'eraser', T: 'text', R: 'rect', O: 'ellipse',
  D: 'diamond', L: 'line', A: 'arrow', F: 'frame', N: 'sticky', C: 'connector', K: 'laser',
};

export const PEN_COLORS = ['#e6e8ee', '#111827', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#7c5cff', '#ec4899'];
