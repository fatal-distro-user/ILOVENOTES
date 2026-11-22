/** Ink → text (handwriting OCR via tesseract.js, lazy-loaded) and rough-sketch → clean diagram conversion. */
import type { CanvasObject, Stroke } from '@/db/types';
import type { CanvasDoc } from '@/canvas/doc';
import { strokeBounds, strokeRenderData } from '@/canvas/ink';
import { rectUnion, type Rect } from '@/canvas/camera';
import { recognizeShape } from '@/paint/geometry/quickshape';
import { shapeToObject } from '@/canvas/quickshape';
import { toast } from '@/store/status';

function selectedStrokes(doc: CanvasDoc): Stroke[] {
  return doc.state.strokeSelection.map((id) => doc.state.strokes[id]).filter(Boolean);
}

/** Render strokes black-on-white, scaled so the ink is large enough for OCR. */
export function rasterizeStrokes(strokes: Stroke[]): { canvas: HTMLCanvasElement; bounds: Rect } | null {
  const b = rectUnion(strokes.map((s) => strokeBounds(s.points, s.width)));
  if (!b) return null;
  const pad = 24;
  const scale = Math.max(1, Math.min(4, 900 / Math.max(b.w, b.h)));
  const c = document.createElement('canvas');
  c.width = Math.ceil((b.w + pad * 2) * scale); c.height = Math.ceil((b.h + pad * 2) * scale);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(scale, 0, 0, scale, (pad - b.x) * scale, (pad - b.y) * scale);
  g.fillStyle = '#000';
  for (const s of strokes) g.fill(strokeRenderData(s).path);
  // OCR engines prefer print-like stroke weight: thicken thin pen strokes along their centre-lines.
  g.strokeStyle = '#000';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(3, Math.min(b.h, b.w) * 0.06);
  for (const s of strokes) {
    g.beginPath();
    for (let i = 0; i < s.points.length; i += 4) { if (i) g.lineTo(s.points[i], s.points[i + 1]); else g.moveTo(s.points[i], s.points[i + 1]); }
    g.stroke();
  }
  return { canvas: c, bounds: b };
}

let ocrWorker: Promise<import('tesseract.js').Worker> | null = null;
async function getOcr() {
  if (!ocrWorker) {
    ocrWorker = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng');
    })();
    ocrWorker.catch(() => { ocrWorker = null; });
  }
  return ocrWorker;
}

export async function recognizeInk(canvas: HTMLCanvasElement): Promise<string> {
  const w = await getOcr();
  const res = await w.recognize(canvas);
  return res.data.text.replace(/\n{3,}/g, '\n\n').trim();
}

/** Replace selected ink with a text box containing the recognised text (one undo step). */
export async function inkToText(doc: CanvasDoc): Promise<boolean> {
  const strokes = selectedStrokes(doc);
  if (!strokes.length) { toast('Select handwritten ink first', 'error'); return false; }
  const r = rasterizeStrokes(strokes);
  if (!r) return false;
  toast('Recognising handwriting… (first use downloads the OCR model)');
  let text: string;
  try { text = await recognizeInk(r.canvas); } catch (e) { toast(`Handwriting recognition failed: ${e instanceof Error ? e.message : e}`, 'error'); return false; }
  if (!text) { toast('No text recognised — try writing larger or neater', 'error'); return false; }
  const lines = text.split('\n').length;
  const fontSize = Math.max(12, Math.min(72, (r.bounds.h / lines) * 0.7));
  const obj = doc.newObject('text', { x: r.bounds.x, y: r.bounds.y, w: Math.max(80, r.bounds.w), h: Math.max(fontSize * 1.4, r.bounds.h) }, { text, fontSize, color: strokes[0].color });
  await doc.commit('Ink to text', { objects: { put: [obj] }, strokes: { remove: strokes.map((s) => s.id) } });
  doc.select([obj.id]);
  toast(`Recognised: “${text.slice(0, 60)}${text.length > 60 ? '…' : ''}”`, 'ok');
  return true;
}

/** Convert rough boxes / circles / arrows into clean shapes, attaching arrows to nearby shapes as connectors. */
export async function inkToDiagram(doc: CanvasDoc): Promise<number> {
  const strokes = selectedStrokes(doc);
  if (!strokes.length) { toast('Select rough shapes and arrows drawn in ink first', 'error'); return 0; }
  const shapes: CanvasObject[] = [];
  const lines: { stroke: Stroke; a: { x: number; y: number }; b: { x: number; y: number }; arrow: boolean }[] = [];
  const consumed: string[] = [];
  for (const s of strokes) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < s.points.length; i += 4) pts.push({ x: s.points[i], y: s.points[i + 1] });
    const shape = recognizeShape(pts);
    if (!shape) continue;
    consumed.push(s.id);
    if (shape.type === 'line' || shape.type === 'arrow') lines.push({ stroke: s, a: shape.a, b: shape.b, arrow: shape.type === 'arrow' });
    else shapes.push(shapeToObject(doc, shape, { color: s.color, width: s.width }));
  }
  // Attach lines to the closest shape near each endpoint (existing objects count too).
  const candidates = [...shapes, ...Object.values(doc.state.objects).filter((o) => o.type !== 'connector' && o.type !== 'frame')];
  const near = (p: { x: number; y: number }) => {
    let best: CanvasObject | null = null, bd = 40;
    for (const o of candidates) {
      const dx = Math.max(o.x - p.x, 0, p.x - (o.x + o.w)), dy = Math.max(o.y - p.y, 0, p.y - (o.y + o.h));
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  const connectors: CanvasObject[] = [];
  for (const l of lines) {
    const from = near(l.a), to = near(l.b);
    if (from && to && from !== to) {
      connectors.push(doc.newObject('connector', { x: 0, y: 0, w: 0, h: 0 }, { from: from.id, to: to.id, fromSide: 'auto', toSide: 'auto', route: 'straight', arrowEnd: l.arrow, arrowStart: false, label: '', color: l.stroke.color, width: Math.max(1.5, l.stroke.width / 2) }));
    } else {
      connectors.push(shapeToObject(doc, l.arrow ? { type: 'arrow', a: l.a, b: l.b } : { type: 'line', a: l.a, b: l.b }, { color: l.stroke.color, width: l.stroke.width }));
    }
  }
  const made = [...shapes, ...connectors];
  if (!made.length) { toast('No shapes recognised in the selection', 'error'); return 0; }
  await doc.commit('Ink to diagram', { objects: { put: made }, strokes: { remove: consumed } });
  doc.select(made.map((o) => o.id));
  toast(`Created ${shapes.length} shape(s) and ${connectors.length} connector(s)`, 'ok');
  return made.length;
}
