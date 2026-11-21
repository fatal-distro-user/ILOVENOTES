import type { BrushParams } from './types';

const base: Omit<BrushParams, 'id' | 'name' | 'category'> = {
  tip: 'round', mode: 'paint', size: 12, minSize: 0.15, opacity: 1, flow: 1, spacing: 0.08, hardness: 0.95,
  angle: 0, roundness: 1, angleMode: 'fixed', scatter: 0, sizeJitter: 0, opacityJitter: 0, angleJitter: 0,
  taperStart: 0, taperEnd: 0, grain: 0, grainScale: 1, pressureSize: 1, pressureOpacity: 0, tiltShading: 0,
  velocitySize: 0, blend: 'normal', wetness: 0, bristles: 0, pixelPerfect: false, dither: 'none', streamline: 0.35, strength: 0.5,
};

const b = (p: Partial<BrushParams> & Pick<BrushParams, 'id' | 'name' | 'category'>): BrushParams => ({ ...base, ...p });

export const BUILTIN_BRUSHES: BrushParams[] = [
  b({ id: 'fineliner', name: 'Fineliner / Technical Pen', category: 'ink', size: 4, minSize: 0.85, hardness: 1, spacing: 0.05, streamline: 0.45 }),
  b({ id: 'fountain', name: 'Fountain Pen', category: 'ink', size: 9, minSize: 0.2, hardness: 1, spacing: 0.04, velocitySize: 0.75, taperStart: 14, taperEnd: 22, angle: 35, roundness: 0.45, streamline: 0.5 }),
  b({ id: 'pencil', name: 'Pencil / Graphite', category: 'sketch', tip: 'pencil', size: 5, minSize: 0.5, flow: 0.55, hardness: 0.6, spacing: 0.12, grain: 0.75, grainScale: 1, pressureOpacity: 0.9, tiltShading: 0.9, angleMode: 'tilt', streamline: 0.2 }),
  b({ id: 'charcoal', name: 'Charcoal / Pastel', category: 'sketch', tip: 'charcoal', size: 22, minSize: 0.4, flow: 0.5, hardness: 0.35, spacing: 0.1, grain: 0.9, grainScale: 1.6, scatter: 0.12, sizeJitter: 0.25, angleJitter: 0.3, pressureOpacity: 0.7, tiltShading: 0.6, streamline: 0.15 }),
  b({ id: 'marker', name: 'Felt Marker', category: 'ink', tip: 'chisel', size: 18, minSize: 0.8, flow: 0.35, opacity: 0.85, hardness: 0.9, spacing: 0.05, angle: 45, roundness: 0.3, blend: 'multiply', pressureSize: 0.3, streamline: 0.3 }),
  b({ id: 'highlighter', name: 'Highlighter', category: 'ink', tip: 'chisel', size: 26, minSize: 1, flow: 1, opacity: 0.4, hardness: 1, spacing: 0.04, angle: 90, roundness: 0.28, blend: 'multiply', pressureSize: 0, streamline: 0.6 }),
  b({ id: 'watercolor', name: 'Watercolor / Wet Brush', category: 'paint', size: 40, minSize: 0.3, flow: 0.08, opacity: 1, hardness: 0.15, spacing: 0.08, wetness: 0.7, grain: 0.35, grainScale: 2.5, sizeJitter: 0.1, pressureOpacity: 0.5, streamline: 0.25 }),
  b({ id: 'oil', name: 'Oil / Impasto Bristle', category: 'paint', tip: 'bristle', size: 34, minSize: 0.5, flow: 0.9, hardness: 0.8, spacing: 0.05, bristles: 28, wetness: 0.35, angleMode: 'direction', roundness: 0.55, streamline: 0.2 }),
  b({ id: 'airbrush', name: 'Airbrush / Soft Spray', category: 'airbrush', tip: 'spray', size: 80, minSize: 0.6, flow: 0.04, hardness: 0, spacing: 0.06, pressureOpacity: 1, pressureSize: 0.4, streamline: 0.1 }),
  b({ id: 'pixel', name: 'Pixel Art Brush', category: 'pixel', tip: 'pixel', size: 1, minSize: 1, hardness: 1, spacing: 1, pressureSize: 0, pixelPerfect: true, streamline: 0 }),
  b({ id: 'pixel-dither', name: 'Pixel Dither', category: 'pixel', tip: 'pixel', size: 4, minSize: 1, hardness: 1, spacing: 1, pressureSize: 0, pixelPerfect: true, dither: 'bayer4', streamline: 0 }),
  b({ id: 'smudge', name: 'Smudge', category: 'retouch', mode: 'smudge', size: 36, hardness: 0.4, spacing: 0.06, strength: 0.65, streamline: 0.2 }),
  b({ id: 'blur', name: 'Blur', category: 'retouch', mode: 'blur', size: 40, hardness: 0.3, spacing: 0.15, strength: 0.5, streamline: 0.1 }),
  b({ id: 'sharpen', name: 'Sharpen', category: 'retouch', mode: 'sharpen', size: 40, hardness: 0.3, spacing: 0.2, strength: 0.4, streamline: 0.1 }),
  b({ id: 'clone', name: 'Clone Stamp', category: 'retouch', mode: 'clone', size: 40, hardness: 0.6, spacing: 0.08, pressureSize: 0.3, streamline: 0.1 }),
  b({ id: 'heal', name: 'Healing Brush', category: 'retouch', mode: 'heal', size: 30, hardness: 0.5, spacing: 0.1, pressureSize: 0.2, streamline: 0.1 }),
  b({ id: 'eraser-soft', name: 'Eraser (Soft)', category: 'eraser', mode: 'erase', size: 50, hardness: 0.1, flow: 0.25, spacing: 0.08, pressureOpacity: 0.6, streamline: 0.1 }),
  b({ id: 'eraser-hard', name: 'Eraser (Hard)', category: 'eraser', mode: 'erase', size: 24, hardness: 1, flow: 1, spacing: 0.05, pressureSize: 0.4, streamline: 0.1 }),
];

export function brushById(id: string): BrushParams {
  const found = BUILTIN_BRUSHES.find((x) => x.id === id);
  if (!found) throw new Error(`Unknown brush ${id}`);
  return { ...found };
}
