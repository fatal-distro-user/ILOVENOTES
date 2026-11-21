/** Flipbook animation on top of the layer stack: each top-level layer (or group) is a frame. */
import type { PaintDocument, LayerRT } from '../engine/document';
import { makeCanvas, ctx2d } from '../engine/document';

export interface AnimSettings { enabled: boolean; mode: 'loop' | 'pingpong' | 'once'; onionPrev: number; onionNext: number; onionOpacity: number; prevTint: string; nextTint: string }
export const DEFAULT_ANIM: AnimSettings = { enabled: false, mode: 'loop', onionPrev: 1, onionNext: 1, onionOpacity: 0.35, prevTint: '#ef4444', nextTint: '#22c55e' };

export function animSettings(doc: PaintDocument): AnimSettings { return { ...DEFAULT_ANIM, ...doc.meta.anim }; }

export const isPinned = (l: LayerRT) => !!l.meta.data.animPinned;

/** Frames in playback order (bottom → top). Pinned layers are shown on every frame. */
export function frames(doc: PaintDocument): LayerRT[] { return doc.children(null).filter((l) => !isPinned(l) && l.meta.kind !== 'adjustment'); }
export function pinned(doc: PaintDocument): LayerRT[] { return doc.children(null).filter((l) => isPinned(l) || l.meta.kind === 'adjustment'); }

export const holdOf = (l: LayerRT) => Math.max(1, Math.round(Number(l.meta.data.hold ?? 1)));

/** Hide every frame except `index` in the on-screen composite. */
export function showFrame(doc: PaintDocument, index: number | null): void {
  if (index === null || !animSettings(doc).enabled) { doc.setDisplayHide([]); return; }
  const fs = frames(doc);
  const keep = fs[index];
  doc.setDisplayHide(fs.filter((f) => f !== keep).map((f) => f.meta.id));
}

/** Composite of a single frame (with pinned layers unless excluded). */
export function renderFrame(doc: PaintDocument, index: number, withPinned = true): HTMLCanvasElement {
  const fs = frames(doc);
  const f = fs[index];
  if (!f) return makeCanvas(doc.width, doc.height);
  const ids = [f.meta.id, ...doc.descendants(f.meta.id)];
  if (withPinned) for (const p of pinned(doc)) ids.push(p.meta.id, ...doc.descendants(p.meta.id));
  return doc.renderTo({ only: ids });
}

/** Tinted silhouette of a frame for onion skinning. */
const onionCache = new WeakMap<LayerRT, { version: number; tint: string; canvas: HTMLCanvasElement }>();
export function onionCanvas(doc: PaintDocument, index: number, tint: string): HTMLCanvasElement | null {
  const f = frames(doc)[index];
  if (!f) return null;
  const c = onionCache.get(f);
  if (c && c.version === doc.version && c.tint === tint) return c.canvas;
  const canvas = renderFrame(doc, index, false);
  const g = ctx2d(canvas);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.65;
  g.fillStyle = tint;
  g.fillRect(0, 0, canvas.width, canvas.height);
  onionCache.set(f, { version: doc.version, tint, canvas });
  return canvas;
}

/** Sequence of frame indices for one playback cycle in the given mode. */
export function playbackOrder(count: number, mode: AnimSettings['mode']): number[] {
  const fwd = Array.from({ length: count }, (_, i) => i);
  if (mode === 'pingpong' && count > 2) return [...fwd, ...fwd.slice(1, -1).reverse()];
  return fwd;
}
