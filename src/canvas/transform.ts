/** Geometry for moving / resizing / rotating selections of objects and strokes. */
import type { CanvasObject, Stroke } from '@/db/types';
import { rotatePoint, type Rect, type Vec } from './camera';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handlePos(r: Rect, h: Handle): Vec {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return {
    x: h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : cx,
    y: h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : cy,
  };
}

/** New rect when dragging `h` of `start` to world point `p` (unrotated frame). */
export function resizeRect(start: Rect, h: Handle, p: Vec, keepAspect: boolean, min = 4): Rect {
  let x0 = start.x, y0 = start.y, x1 = start.x + start.w, y1 = start.y + start.h;
  if (h.includes('w')) x0 = p.x;
  if (h.includes('e')) x1 = p.x;
  if (h.includes('n')) y0 = p.y;
  if (h.includes('s')) y1 = p.y;
  let r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  if (keepAspect && start.w > 0 && start.h > 0) {
    const ar = start.w / start.h;
    const corner = h.length === 2;
    let w = r.w, hh = r.h;
    if (corner) { if (w / hh > ar) hh = w / ar; else w = hh * ar; }
    else if (h === 'e' || h === 'w') hh = w / ar; else w = hh * ar;
    // Anchor at the opposite side/corner.
    const ax = h.includes('w') ? start.x + start.w : h.includes('e') ? start.x : start.x + start.w / 2;
    const ay = h.includes('n') ? start.y + start.h : h.includes('s') ? start.y : start.y + start.h / 2;
    const left = h.includes('w') ? ax - w : h.includes('e') ? ax : ax - w / 2;
    const top = h.includes('n') ? ay - hh : h.includes('s') ? ay : ay - hh / 2;
    r = { x: left, y: top, w, h: hh };
  }
  r.w = Math.max(min, r.w); r.h = Math.max(min, r.h);
  return r;
}

/** Resize a single rotated object by a handle: work in its local (unrotated) frame. */
export function resizeRotated(o: CanvasObject, h: Handle, pWorld: Vec, keepAspect: boolean, min: { w: number; h: number }): Rect {
  const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  const local = rotatePoint(pWorld, c, -o.rotation);
  const r = resizeRect({ x: o.x, y: o.y, w: o.w, h: o.h }, h, local, keepAspect, Math.min(min.w, min.h));
  r.w = Math.max(min.w, r.w); r.h = Math.max(min.h, r.h);
  // The new local centre must be rotated back into world space around the old centre.
  const nc = rotatePoint({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, c, o.rotation);
  return { x: nc.x - r.w / 2, y: nc.y - r.h / 2, w: r.w, h: r.h };
}

/** Map a rect from one frame (bounds) to another (scale about frames). */
export function mapRect(r: Rect, from: Rect, to: Rect): Rect {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  return { x: to.x + (r.x - from.x) * sx, y: to.y + (r.y - from.y) * sy, w: r.w * sx, h: r.h * sy };
}

export function mapStroke(s: Stroke, from: Rect, to: Rect): Stroke {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  const pts = s.points.slice();
  for (let i = 0; i < pts.length; i += 4) { pts[i] = to.x + (pts[i] - from.x) * sx; pts[i + 1] = to.y + (pts[i + 1] - from.y) * sy; }
  return { ...s, points: pts, width: s.width * Math.sqrt(Math.abs(sx * sy)) };
}

export function rotateObjectAround(o: CanvasObject, center: Vec, a: number): CanvasObject {
  const c = rotatePoint({ x: o.x + o.w / 2, y: o.y + o.h / 2 }, center, a);
  return { ...o, x: c.x - o.w / 2, y: c.y - o.h / 2, rotation: normAngle(o.rotation + a) };
}

export function rotateStrokeAround(s: Stroke, center: Vec, a: number): Stroke {
  const pts = s.points.slice();
  for (let i = 0; i < pts.length; i += 4) { const q = rotatePoint({ x: pts[i], y: pts[i + 1] }, center, a); pts[i] = q.x; pts[i + 1] = q.y; }
  return { ...s, points: pts };
}

export function normAngle(a: number): number {
  const t = a % (Math.PI * 2);
  return t > Math.PI ? t - Math.PI * 2 : t < -Math.PI ? t + Math.PI * 2 : t;
}

export function snapAngle(a: number, stepDeg = 15): number {
  const s = (stepDeg * Math.PI) / 180;
  return Math.round(a / s) * s;
}

export const HANDLE_CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
