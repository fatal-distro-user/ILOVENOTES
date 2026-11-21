/**
 * Snap-to-grid and smart alignment guides (Figma-style): while dragging/resizing, the moving bounds
 * snap their edges/centres to edges/centres of nearby objects; matched lines are returned for drawing.
 */
import type { Rect } from './camera';

export interface Guide { axis: 'x' | 'y'; pos: number; from: number; to: number }
export interface SnapResult { dx: number; dy: number; guides: Guide[] }

export function snapToGrid(v: number, grid: number): number { return Math.round(v / grid) * grid; }

const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];

/** Compute offset to apply to `moving` so it aligns with `others`, within threshold (world units). */
export function smartSnap(moving: Rect, others: Rect[], threshold: number): SnapResult {
  let bestX: { d: number; pos: number } | null = null, bestY: { d: number; pos: number } | null = null;
  const mx = xs(moving), my = ys(moving);
  for (const o of others) {
    for (const ox of xs(o)) for (const m of mx) {
      const d = ox - m;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, pos: ox };
    }
    for (const oy of ys(o)) for (const m of my) {
      const d = oy - m;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, pos: oy };
    }
  }
  const dx = bestX?.d ?? 0, dy = bestY?.d ?? 0;
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: Guide[] = [];
  const eps = 0.5;
  if (bestX) {
    const pos = bestX.pos;
    const hits = others.filter((o) => xs(o).some((v) => Math.abs(v - pos) < eps));
    const all = [snapped, ...hits];
    guides.push({ axis: 'x', pos, from: Math.min(...all.map((r) => r.y)), to: Math.max(...all.map((r) => r.y + r.h)) });
  }
  if (bestY) {
    const pos = bestY.pos;
    const hits = others.filter((o) => ys(o).some((v) => Math.abs(v - pos) < eps));
    const all = [snapped, ...hits];
    guides.push({ axis: 'y', pos, from: Math.min(...all.map((r) => r.x)), to: Math.max(...all.map((r) => r.x + r.w)) });
  }
  return { dx, dy, guides };
}

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** New positions (x,y) for each rect after alignment relative to their union bounds. */
export function align(rects: Rect[], kind: AlignKind): { x: number; y: number }[] {
  const x0 = Math.min(...rects.map((r) => r.x)), x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y0 = Math.min(...rects.map((r) => r.y)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  return rects.map((r) => {
    switch (kind) {
      case 'left': return { x: x0, y: r.y };
      case 'right': return { x: x1 - r.w, y: r.y };
      case 'hcenter': return { x: (x0 + x1) / 2 - r.w / 2, y: r.y };
      case 'top': return { x: r.x, y: y0 };
      case 'bottom': return { x: r.x, y: y1 - r.h };
      case 'vcenter': return { x: r.x, y: (y0 + y1) / 2 - r.h / 2 };
    }
  });
}

/** Distribute with equal gaps along an axis (needs ≥3). Returns positions in the input order. */
export function distribute(rects: Rect[], axis: 'x' | 'y'): { x: number; y: number }[] {
  const out = rects.map((r) => ({ x: r.x, y: r.y }));
  if (rects.length < 3) return out;
  const idx = rects.map((_, i) => i).sort((a, b) => (axis === 'x' ? rects[a].x - rects[b].x : rects[a].y - rects[b].y));
  const first = rects[idx[0]], last = rects[idx[idx.length - 1]];
  const span = axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const total = idx.reduce((a, i) => a + (axis === 'x' ? rects[i].w : rects[i].h), 0);
  const gap = (span - total) / (idx.length - 1);
  let cur = axis === 'x' ? first.x : first.y;
  for (const i of idx) {
    if (axis === 'x') out[i].x = cur; else out[i].y = cur;
    cur += (axis === 'x' ? rects[i].w : rects[i].h) + gap;
  }
  return out;
}
