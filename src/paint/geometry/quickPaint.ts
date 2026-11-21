/**
 * QuickShape for raster strokes: hold still at the end of a stroke → the stroke is replaced by a clean
 * geometric shape; afterwards its control handles can be dragged to reshape it (re-rendered as a new
 * stroke in place of the old one) until another action happens.
 */
import { recognizeShape, shapeToPoints, type QuickShape, type Pt } from './quickshape';
import type { StrokePoint } from '../stabilizer';
import type { PaintDocument } from '../engine/document';

export const HOLD_MS = 550;

/** Densify a polyline so dab spacing stays even along long straight edges. */
export function densify(pts: Pt[], step = 2): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

export function shapeStrokePoints(shape: QuickShape, pressure: number): StrokePoint[] {
  return densify(shapeToPoints(shape, 160)).map((p, i) => ({ x: p.x, y: p.y, pressure, t: i, tiltX: 0, tiltY: 0, velocity: 0.3 }));
}

export function recognize(points: readonly StrokePoint[]): QuickShape | null {
  if (points.length < 4) return null;
  return recognizeShape(points.map((p) => ({ x: p.x, y: p.y })));
}

/** Editable handle list for a shape + a function applying a handle drag. */
export function editableHandles(s: QuickShape): Pt[] {
  switch (s.type) {
    case 'line': case 'arrow': return [s.a, s.b];
    case 'polyline': return s.points;
    case 'triangle': return s.points;
    case 'circle': return [s.c, { x: s.c.x + s.r, y: s.c.y }];
    case 'ellipse': return [s.c, { x: s.c.x + Math.cos(s.rotation) * s.rx, y: s.c.y + Math.sin(s.rotation) * s.rx }, { x: s.c.x - Math.sin(s.rotation) * s.ry, y: s.c.y + Math.cos(s.rotation) * s.ry }];
    case 'rect': return shapeToPoints(s).slice(0, 4);
    case 'star': return [s.c, { x: s.c.x + Math.cos(s.rotation) * s.outer, y: s.c.y + Math.sin(s.rotation) * s.outer }];
  }
}

export function moveHandle(s: QuickShape, i: number, p: Pt): QuickShape {
  switch (s.type) {
    case 'line': case 'arrow': return i === 0 ? { ...s, a: p } : { ...s, b: p };
    case 'polyline': return { ...s, points: s.points.map((q, k) => (k === i ? p : q)) };
    case 'triangle': return { ...s, points: s.points.map((q, k) => (k === i ? p : q)) as [Pt, Pt, Pt] };
    case 'circle': return i === 0 ? { ...s, c: p } : { ...s, r: Math.max(2, Math.hypot(p.x - s.c.x, p.y - s.c.y)) };
    case 'ellipse':
      if (i === 0) return { ...s, c: p };
      if (i === 1) return { ...s, rx: Math.max(2, Math.hypot(p.x - s.c.x, p.y - s.c.y)), rotation: Math.atan2(p.y - s.c.y, p.x - s.c.x) };
      return { ...s, ry: Math.max(2, Math.hypot(p.x - s.c.x, p.y - s.c.y)) };
    case 'rect': {
      // Dragging a corner turns the rectangle into a free quadrilateral.
      const pts = shapeToPoints(s).slice(0, 4).map((q, k) => (k === i ? p : q));
      return { type: 'polyline', points: pts, closed: true };
    }
    case 'star':
      if (i === 0) return { ...s, c: p };
      { const outer = Math.max(4, Math.hypot(p.x - s.c.x, p.y - s.c.y)); return { ...s, outer, inner: s.inner * (outer / s.outer), rotation: Math.atan2(p.y - s.c.y, p.x - s.c.x) }; }
  }
}

/** Last snapped shape, editable until the history changes for another reason. */
export interface LastQuickShape {
  doc: PaintDocument; shape: QuickShape; historyLen: number; layerId: string;
  /** re-render callback: undo the previous stroke and paint the new shape */
  repaint(shape: QuickShape): Promise<void>;
}
let last: LastQuickShape | null = null;
export const quickShapeState = {
  get(): LastQuickShape | null {
    if (last && (last.doc.history.list.length !== last.historyLen || last.doc.history.position !== last.historyLen)) last = null;
    return last;
  },
  set(v: LastQuickShape | null) { last = v; },
};
