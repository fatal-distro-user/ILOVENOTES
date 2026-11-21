/** QuickShape on the infinite canvas: hold the pen still at the end of a stroke to convert it into a shape object. */
import { registerCanvasPlugin } from './CanvasView';
import { recognizeShape, shapeToPoints, type QuickShape } from '@/paint/geometry/quickshape';
import { normRect } from './camera';
import type { CanvasObject } from '@/db/types';
import type { CanvasDoc } from './doc';
import { useCanvasTools } from './tools';

/** Build a canvas shape object for a recognised shape (vector, editable). */
export function shapeToObject(doc: CanvasDoc, s: QuickShape, style: { color: string; width: number }): CanvasObject {
  const base = { stroke: style.color, strokeWidth: Math.max(1, Math.round(style.width / 2)), fill: 'transparent', text: '', fontSize: 16 };
  if (s.type === 'line' || s.type === 'arrow') {
    const box = normRect(s.a, s.b), bw = Math.max(1, box.w), bh = Math.max(1, box.h);
    return doc.newObject('shape', { x: box.x, y: box.y, w: bw, h: bh }, { ...base, shape: s.type, x1: (s.a.x - box.x) / bw, y1: (s.a.y - box.y) / bh, x2: (s.b.x - box.x) / bw, y2: (s.b.y - box.y) / bh });
  }
  if (s.type === 'circle') return doc.newObject('shape', { x: s.c.x - s.r, y: s.c.y - s.r, w: s.r * 2, h: s.r * 2 }, { ...base, shape: 'ellipse' });
  if (s.type === 'ellipse') {
    const o = doc.newObject('shape', { x: s.c.x - s.rx, y: s.c.y - s.ry, w: s.rx * 2, h: s.ry * 2 }, { ...base, shape: 'ellipse' });
    o.rotation = s.rotation;
    return o;
  }
  if (s.type === 'rect') {
    const o = doc.newObject('shape', { x: s.c.x - s.w / 2, y: s.c.y - s.h / 2, w: s.w, h: s.h }, { ...base, shape: 'rect' });
    o.rotation = s.rotation;
    return o;
  }
  // Triangle, star, polyline → normalised polygon.
  const raw = s.type === 'polyline' ? (s.closed ? s.points : s.points) : shapeToPoints(s).slice(0, -1);
  const xs = raw.map((p) => p.x), ys = raw.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x0), h = Math.max(1, Math.max(...ys) - y0);
  const closed = s.type !== 'polyline' || s.closed;
  return doc.newObject('shape', { x: x0, y: y0, w, h }, { ...base, shape: closed ? 'polygon' : 'polyline', points: raw.map((p) => [(p.x - x0) / w, (p.y - y0) / h]) });
}

registerCanvasPlugin({
  onPenHold(ctx, points, style) {
    if (style.tool !== 'pen' || !useCanvasTools.getState().quickShape) return false;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < points.length; i += 4) pts.push({ x: points[i], y: points[i + 1] });
    const shape = recognizeShape(pts);
    if (!shape) return false;
    const obj = shapeToObject(ctx.doc, shape, style);
    void ctx.doc.addObjects([obj], `QuickShape ${shape.type}`);
    return true;
  },
});
