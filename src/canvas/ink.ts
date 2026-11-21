/** Vector ink: perfect-freehand outlines cached as Path2D, bounding boxes and hit testing. */
import { getStroke } from 'perfect-freehand';
import type { Stroke } from '@/db/types';
import type { Rect, Vec } from './camera';

export interface InkStyle { size: number; thinning: number; smoothing: number; streamline: number; taper: number; simulatePressure: boolean }

export function inkStyleFor(tool: string, width: number): InkStyle {
  if (tool === 'highlighter') return { size: width, thinning: 0, smoothing: 0.5, streamline: 0.5, taper: 0, simulatePressure: false };
  if (tool === 'pencil') return { size: width, thinning: 0.3, smoothing: 0.4, streamline: 0.4, taper: 0, simulatePressure: true };
  return { size: width, thinning: 0.6, smoothing: 0.55, streamline: 0.45, taper: width * 2, simulatePressure: true };
}

export function strokeInputPoints(points: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 3 < points.length + 1; i += 4) out.push([points[i], points[i + 1], points[i + 2] || 0.5]);
  return out;
}

export function outlineFor(points: number[], tool: string, width: number, complete = true): number[][] {
  const st = inkStyleFor(tool, width);
  const input = strokeInputPoints(points);
  const hasPressure = input.some((p) => p[2] !== 0.5 && p[2] > 0);
  return getStroke(input, {
    size: st.size, thinning: st.thinning, smoothing: st.smoothing, streamline: st.streamline,
    simulatePressure: st.simulatePressure && !hasPressure, last: complete,
    start: { taper: st.taper, cap: true }, end: { taper: st.taper, cap: true },
  });
}

export function outlineToPath(outline: number[][]): Path2D {
  const p = new Path2D();
  if (!outline.length) return p;
  p.moveTo(outline[0][0], outline[0][1]);
  // Quadratic smoothing through midpoints.
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1], [x1, y1] = outline[i];
    p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  p.closePath();
  return p;
}

export function outlineToSvgPath(outline: number[][]): string {
  if (!outline.length) return '';
  const d = [`M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)}`];
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1], [x1, y1] = outline[i];
    d.push(`Q ${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`);
  }
  d.push('Z');
  return d.join(' ');
}

export function strokeBounds(points: number[], width: number): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < points.length; i += 4) {
    x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]);
    y0 = Math.min(y0, points[i + 1]); y1 = Math.max(y1, points[i + 1]);
  }
  const pad = width;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/** Does a circle (eraser) touch the stroke's centre-line (within its half-width)? */
export function strokeHitsCircle(points: number[], width: number, c: Vec, r: number): boolean {
  const rr = r + width / 2;
  for (let i = 0; i < points.length; i += 4) {
    const ax = points[i], ay = points[i + 1];
    if (i + 4 >= points.length) return Math.hypot(ax - c.x, ay - c.y) <= rr || false;
    const bx = points[i + 4], by = points[i + 5];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(ax + dx * t - c.x, ay + dy * t - c.y) <= rr) return true;
  }
  return false;
}

/** Path2D cache keyed by stroke identity (strokes are immutable once committed). */
const cache = new WeakMap<Stroke, { path: Path2D; bounds: Rect }>();
export function strokeRenderData(s: Stroke): { path: Path2D; bounds: Rect } {
  let c = cache.get(s);
  if (!c) { c = { path: outlineToPath(outlineFor(s.points, s.tool, s.width)), bounds: strokeBounds(s.points, s.width) }; cache.set(s, c); }
  return c;
}

/** Translate a stroke's points. */
export function offsetPoints(points: number[], dx: number, dy: number): number[] {
  const out = points.slice();
  for (let i = 0; i < out.length; i += 4) { out[i] += dx; out[i + 1] += dy; }
  return out;
}
