/** Connector geometry: object side ports, auto side choice, and straight / orthogonal / curved routes. */
import { rotatePoint, type Rect, type Vec } from '@/canvas/camera';
import type { CanvasObject } from '@/db/types';

export type Side = 'n' | 'e' | 's' | 'w';
export type Route = 'straight' | 'orthogonal' | 'curved';
export const NORMAL: Record<Side, Vec> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };

export function portPoint(o: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>, side: Side): Vec {
  const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  const p = side === 'n' ? { x: c.x, y: o.y } : side === 's' ? { x: c.x, y: o.y + o.h } : side === 'e' ? { x: o.x + o.w, y: c.y } : { x: o.x, y: c.y };
  return o.rotation ? rotatePoint(p, c, o.rotation) : p;
}

/** Side of `o` that best faces point `p`. */
export function facingSide(o: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h'>, p: Vec): Side {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  const dx = (p.x - cx) / Math.max(1, o.w), dy = (p.y - cy) / Math.max(1, o.h);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
}

export function nearestPort(o: CanvasObject, p: Vec): { side: Side; point: Vec; dist: number } {
  let best = { side: 'n' as Side, point: portPoint(o, 'n'), dist: Infinity };
  for (const side of ['n', 'e', 's', 'w'] as Side[]) {
    const q = portPoint(o, side), d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.dist) best = { side, point: q, dist: d };
  }
  return best;
}

export interface Endpoint { point: Vec; side: Side | null }

/** Path data + label anchor for a route between two endpoints. */
export function routePath(route: Route, a: Endpoint, b: Endpoint): { d: string; mid: Vec; points: Vec[]; endDir: Vec; startDir: Vec } {
  const A = a.point, B = b.point;
  if (route === 'straight') {
    const dir = { x: B.x - A.x, y: B.y - A.y };
    return { d: `M${A.x},${A.y} L${B.x},${B.y}`, mid: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, points: [A, B], endDir: dir, startDir: { x: -dir.x, y: -dir.y } };
  }
  const na = a.side ? NORMAL[a.side] : unit({ x: B.x - A.x, y: B.y - A.y });
  const nb = b.side ? NORMAL[b.side] : unit({ x: A.x - B.x, y: A.y - B.y });
  if (route === 'curved') {
    const k = Math.max(40, Math.hypot(B.x - A.x, B.y - A.y) * 0.4);
    const c1 = { x: A.x + na.x * k, y: A.y + na.y * k }, c2 = { x: B.x + nb.x * k, y: B.y + nb.y * k };
    const mid = cubic(A, c1, c2, B, 0.5);
    const pts = Array.from({ length: 25 }, (_, i) => cubic(A, c1, c2, B, i / 24));
    return { d: `M${A.x},${A.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${B.x},${B.y}`, mid, points: pts, endDir: { x: B.x - c2.x, y: B.y - c2.y }, startDir: { x: A.x - c1.x, y: A.y - c1.y } };
  }
  // Orthogonal: leave each port along its normal, then connect with an elbow.
  const stub = 24;
  const a1 = { x: A.x + na.x * stub, y: A.y + na.y * stub }, b1 = { x: B.x + nb.x * stub, y: B.y + nb.y * stub };
  const horizontalFirst = Math.abs(na.x) > 0.5;
  const mids: Vec[] = horizontalFirst
    ? [{ x: (a1.x + b1.x) / 2, y: a1.y }, { x: (a1.x + b1.x) / 2, y: b1.y }]
    : [{ x: a1.x, y: (a1.y + b1.y) / 2 }, { x: b1.x, y: (a1.y + b1.y) / 2 }];
  const pts = [A, a1, ...mids, b1, B];
  return { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '), mid: { x: (mids[0].x + mids[1].x) / 2, y: (mids[0].y + mids[1].y) / 2 }, points: pts, endDir: { x: B.x - b1.x, y: B.y - b1.y }, startDir: { x: A.x - a1.x, y: A.y - a1.y } };
}

function unit(v: Vec): Vec { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }
function cubic(a: Vec, b: Vec, c: Vec, d: Vec, t: number): Vec {
  const u = 1 - t;
  return { x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y };
}

export function arrowHeadPath(tip: Vec, dir: Vec, size: number): string {
  const a = Math.atan2(dir.y, dir.x);
  const l = { x: tip.x - size * Math.cos(a - 0.45), y: tip.y - size * Math.sin(a - 0.45) };
  const r = { x: tip.x - size * Math.cos(a + 0.45), y: tip.y - size * Math.sin(a + 0.45) };
  return `M${l.x},${l.y} L${tip.x},${tip.y} L${r.x},${r.y}`;
}

/** Distance from p to a polyline (hit testing connectors). */
export function polylineDistance(pts: Vec[], p: Vec): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}

export function boundsOf(pts: Vec[]): Rect {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
}
