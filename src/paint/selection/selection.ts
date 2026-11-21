/** Selection masks: rasterising shapes, combining modes, undoable selection changes, marching-ants outline. */
import { createMask, combineMasks, featherMask, dilateMask, erodeMask, invertMask, isMaskEmpty, maskBounds, type Mask } from '../fill/mask';
import type { PaintDocument } from '../engine/document';

export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect';
export interface P { x: number; y: number }

export function modeFromModifiers(shift: boolean, alt: boolean): SelectMode {
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return 'replace';
}

/** Even-odd polygon fill with 4× vertical supersampling for anti-aliased edges. */
export function polygonMask(w: number, h: number, pts: P[], antialias = true): Mask {
  const m = createMask(w, h);
  if (pts.length < 3) return m;
  const ss = antialias ? 4 : 1;
  const cover = new Float32Array(w);
  let y0 = h, y1 = 0;
  for (const p of pts) { y0 = Math.min(y0, Math.floor(p.y)); y1 = Math.max(y1, Math.ceil(p.y)); }
  y0 = Math.max(0, y0); y1 = Math.min(h - 1, y1);
  for (let y = y0; y <= y1; y++) {
    cover.fill(0);
    for (let s = 0; s < ss; s++) {
      const sy = y + (s + 0.5) / ss;
      const xs: number[] = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, xs[k]), xb = Math.min(w, xs[k + 1]);
        if (xb <= xa) continue;
        const ia = Math.floor(xa), ib = Math.floor(xb);
        if (ia === ib) { cover[ia] += (xb - xa) / ss; continue; }
        cover[ia] += (ia + 1 - xa) / ss;
        for (let x = ia + 1; x < ib; x++) cover[x] += 1 / ss;
        if (ib < w) cover[ib] += (xb - ib) / ss;
      }
    }
    const row = y * w;
    for (let x = 0; x < w; x++) m.data[row + x] = Math.min(255, Math.round(cover[x] * 255));
  }
  return m;
}

export function rectPoints(a: P, b: P): P[] {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

export function ellipsePoints(a: P, b: P, n = 96): P[] {
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(a.x - b.x) / 2, ry = Math.abs(a.y - b.y) / 2;
  return Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }; });
}

export function applyMode(current: Mask | null, next: Mask, mode: SelectMode): Mask | null {
  const base = current ?? createMask(next.width, next.height, 0);
  const out = mode === 'replace' ? next : combineMasks(base, next, mode);
  return isMaskEmpty(out) ? null : out;
}

/** Replace the document selection as one undoable step. */
export function setSelection(doc: PaintDocument, next: Mask | null, label: string): void {
  const before = doc.selection;
  if (before === next) return;
  const apply = (m: Mask | null) => { doc.selection = m; outlineCache.delete(doc); doc.invalidate(); };
  apply(next);
  doc.history.push({ label, kind: 'selection', size: (next?.data.length ?? 0) + (before?.data.length ?? 0), redo: () => apply(next), undo: () => apply(before) });
}

export const selectAll = (doc: PaintDocument) => setSelection(doc, createMask(doc.width, doc.height, 255), 'Select all');
export const deselect = (doc: PaintDocument) => { if (doc.selection) setSelection(doc, null, 'Deselect'); };
export const invertSelection = (doc: PaintDocument) => setSelection(doc, doc.selection ? invertMask(doc.selection) : createMask(doc.width, doc.height, 255), 'Invert selection');
export const featherSelection = (doc: PaintDocument, r: number) => doc.selection && setSelection(doc, featherMask(doc.selection, r), `Feather ${r}px`);
export const expandSelection = (doc: PaintDocument, r: number) => doc.selection && setSelection(doc, dilateMask(doc.selection, r), `Expand ${r}px`);
export const contractSelection = (doc: PaintDocument, r: number) => doc.selection && setSelection(doc, erodeMask(doc.selection, r), `Contract ${r}px`);

/** Marching squares boundary segments of mask ≥ 128, as a Path2D in doc space (cached per mask). */
const outlineCache = new WeakMap<PaintDocument, { mask: Mask; path: Path2D }>();
export function selectionOutline(doc: PaintDocument): Path2D | null {
  const m = doc.selection;
  if (!m) return null;
  const c = outlineCache.get(doc);
  if (c && c.mask === m) return c.path;
  const path = new Path2D();
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < m.width && y < m.height && m.data[y * m.width + x] >= 128;
  // Horizontal and vertical pixel-edge segments, merged into runs for speed.
  for (let y = 0; y <= m.height; y++) {
    let runStart = -1;
    for (let x = 0; x <= m.width; x++) {
      const edge = x < m.width && on(x, y) !== on(x, y - 1);
      if (edge && runStart < 0) runStart = x;
      if (!edge && runStart >= 0) { path.moveTo(runStart, y); path.lineTo(x, y); runStart = -1; }
    }
  }
  for (let x = 0; x <= m.width; x++) {
    let runStart = -1;
    for (let y = 0; y <= m.height; y++) {
      const edge = y < m.height && on(x, y) !== on(x - 1, y);
      if (edge && runStart < 0) runStart = y;
      if (!edge && runStart >= 0) { path.moveTo(x, runStart); path.lineTo(x, y); runStart = -1; }
    }
  }
  outlineCache.set(doc, { mask: m, path });
  return path;
}

export function selectionBounds(doc: PaintDocument) { return doc.selection ? maskBounds(doc.selection) : null; }

/** Mask as an alpha canvas (for clipping draws). */
export function maskToCanvas(m: Mask): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = m.width; c.height = m.height;
  const g = c.getContext('2d')!;
  const img = g.createImageData(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = m.data[i]; }
  g.putImageData(img, 0, 0);
  return c;
}
