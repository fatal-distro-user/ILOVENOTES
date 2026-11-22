/** Infinite-canvas export: vector SVG (shapes, text, ink, connectors, images, paintings, PDF pages) and PNG. */
import { db } from '@/db/schema';
import type { CanvasObject, Stroke } from '@/db/types';
import { outlineFor, outlineToSvgPath, strokeBounds } from '@/canvas/ink';
import { objectType } from '@/canvas/objects/registry';
import { rectUnion, rotatedBounds, type Rect } from '@/canvas/camera';
import { CanvasDoc, peekCanvasDoc } from '@/canvas/doc';
import { routePath, arrowHeadPath } from '@/spatial/connectorGeometry';
import { connectorEnds } from '@/spatial/canvasObjects';
import { blobToDataUrl } from '@/lib/image';
import { pageImageUrl } from '@/pdf/pdfjs';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function urlToDataUrl(u: string): Promise<string> {
  if (u.startsWith('data:')) return u;
  return blobToDataUrl(await (await fetch(u)).blob());
}

export async function canvasToSvg(pageId: string, opts: { background?: string | null; padding?: number } = {}): Promise<{ svg: string; bounds: Rect }> {
  let doc = peekCanvasDoc(pageId);
  if (!doc) { doc = new CanvasDoc(pageId); await doc.load(); }
  const objects = Object.values(doc.state.objects).sort((a, b) => a.z - b.z);
  const strokes = Object.values(doc.state.strokes).sort((a, b) => a.createdAt - b.createdAt);
  const pad = opts.padding ?? 32;
  const b = rectUnion([...objects.map((o) => doc!.objectBounds(o)), ...strokes.map((s) => strokeBounds(s.points, s.width))]) ?? { x: 0, y: 0, w: 800, h: 600 };
  const vb = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  const parts: string[] = [];
  if (opts.background) parts.push(`<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${esc(opts.background)}"/>`);
  for (const o of objects) parts.push(await objectSvg(doc, o));
  for (const s of strokes) parts.push(strokeSvg(s));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${Math.round(vb.w)}" height="${Math.round(vb.h)}" font-family="Inter, system-ui, sans-serif">${parts.join('')}</svg>`;
  return { svg, bounds: vb };
}

function strokeSvg(s: Stroke): string {
  const d = outlineToSvgPath(outlineFor(s.points, s.tool, s.width));
  return `<path d="${d}" fill="${esc(s.color)}" fill-opacity="${s.opacity}"${s.tool === 'highlighter' ? ' style="mix-blend-mode:multiply"' : ''}/>`;
}

async function objectSvg(doc: CanvasDoc, o: CanvasObject): Promise<string> {
  if (o.type === 'connector') {
    const { a, b } = connectorEnds(doc, o);
    const r = routePath(String(o.data.route ?? 'curved') as 'curved', a, b);
    const c = esc(String(o.data.color || '#6b7280')), w = Number(o.data.width ?? 2);
    let s = `<path d="${r.d}" fill="none" stroke="${c}" stroke-width="${w}"${o.data.dash ? ` stroke-dasharray="${w * 4} ${w * 3}"` : ''}/>`;
    if (o.data.arrowEnd !== false) s += `<path d="${arrowHeadPath(b.point, r.endDir, 10 + w * 2)}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
    if (o.data.arrowStart) s += `<path d="${arrowHeadPath(a.point, r.startDir, 10 + w * 2)}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
    if (o.data.label) s += `<text x="${r.mid.x}" y="${r.mid.y}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="#374151" stroke="#fff" stroke-width="4" paint-order="stroke">${esc(String(o.data.label))}</text>`;
    return s;
  }
  let inner = '';
  if (o.type === 'paint') {
    const meta = await db.rasterDocs.get(String(o.data.docId));
    if (meta?.preview) inner = `<image href="${await blobToDataUrl(meta.preview)}" width="${o.w}" height="${o.h}" preserveAspectRatio="xMidYMid meet"/>`;
  } else if (o.type === 'pdfpage') {
    try { inner = `<rect width="${o.w}" height="${o.h}" fill="#fff"/><image href="${await urlToDataUrl(await pageImageUrl(String(o.data.pdfId), Number(o.data.pageIndex), 2))}" width="${o.w}" height="${o.h}"/>`; } catch { inner = `<rect width="${o.w}" height="${o.h}" fill="#fff" stroke="#ccc"/>`; }
  } else if (o.type === 'mindnode') {
    inner = `<rect width="${o.w}" height="${o.h}" rx="${o.h / 2}" fill="${Number(o.data.level ?? 0) === 0 ? '#7c5cff' : '#fff'}" stroke="#7c5cff" stroke-width="2"/><text x="${o.w / 2}" y="${o.h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="14" fill="${Number(o.data.level ?? 0) === 0 ? '#fff' : '#111'}">${esc(String(o.data.text ?? ''))}</text>`;
  } else if (o.type === 'audio') {
    inner = `<rect width="${o.w}" height="${o.h}" rx="${o.h / 2}" fill="#fff" stroke="#ccc"/><text x="16" y="${o.h / 2}" dominant-baseline="middle" font-size="12" fill="#333">🎙 ${esc(String(o.data.name ?? 'Audio note'))}</text>`;
  } else inner = objectType(o.type)?.toSvg?.(o) ?? '';
  if (!inner) return '';
  const rot = o.rotation ? ` rotate(${(o.rotation * 180) / Math.PI} ${o.w / 2} ${o.h / 2})` : '';
  return `<g transform="translate(${o.x} ${o.y})${rot}">${inner}</g>`;
}

/** Rasterise the SVG export at `scale` (PNG bytes as Blob). */
export async function canvasToPng(pageId: string, scale = 2, background = '#ffffff'): Promise<Blob> {
  const { svg, bounds } = await canvasToSvg(pageId, { background });
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('SVG rasterisation failed')); img.src = url; });
    const max = 8192;
    const k = Math.min(scale, max / bounds.w, max / bounds.h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bounds.w * k)); c.height = Math.max(1, Math.round(bounds.h * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const { encodeCanvas } = await import('@/lib/encode');
    return encodeCanvas(c);
  } finally { URL.revokeObjectURL(url); }
}

export { rotatedBounds };
