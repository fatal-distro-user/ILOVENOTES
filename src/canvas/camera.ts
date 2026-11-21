/** Infinite-canvas camera math. World → screen: s = (w - cam.xy) * zoom. */

export interface Camera { x: number; y: number; zoom: number }
export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const toScreen = (c: Camera, p: Vec): Vec => ({ x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom });
export const toWorld = (c: Camera, p: Vec): Vec => ({ x: p.x / c.zoom + c.x, y: p.y / c.zoom + c.y });

/** Zoom keeping the world point under `anchor` (screen coords) fixed. */
export function zoomAt(c: Camera, nextZoom: number, anchor: Vec): Camera {
  const z = clampZoom(nextZoom);
  const w = toWorld(c, anchor);
  return { zoom: z, x: w.x - anchor.x / z, y: w.y - anchor.y / z };
}

export function panBy(c: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...c, x: c.x - dxScreen / c.zoom, y: c.y - dyScreen / c.zoom };
}

/** Visible world rect for a viewport of the given screen size. */
export function viewRect(c: Camera, w: number, h: number): Rect {
  return { x: c.x, y: c.y, w: w / c.zoom, h: h / c.zoom };
}

/** Camera that fits `r` into the viewport with padding. */
export function fitRect(r: Rect, vw: number, vh: number, pad = 48, maxZoom = 2): Camera {
  if (r.w <= 0 || r.h <= 0) return { x: r.x - vw / 2, y: r.y - vh / 2, zoom: 1 };
  const zoom = clampZoom(Math.min((vw - pad * 2) / r.w, (vh - pad * 2) / r.h, maxZoom));
  return { zoom, x: r.x + r.w / 2 - vw / 2 / zoom, y: r.y + r.h / 2 - vh / 2 / zoom };
}

export function rectUnion(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function normRect(a: Vec, b: Vec): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const rectContains = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Axis-aligned bounds of a rect rotated about its centre. */
export function rotatedBounds(r: Rect, rotation: number): Rect {
  if (!rotation) return r;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation));
  const w = r.w * c + r.h * s, h = r.w * s + r.h * c;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function rotatePoint(p: Vec, center: Vec, a: number): Vec {
  const c = Math.cos(a), s = Math.sin(a), dx = p.x - center.x, dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

/** Point inside a rotated rect? */
export function pointInRotatedRect(p: Vec, r: Rect, rotation: number): boolean {
  const q = rotation ? rotatePoint(p, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, -rotation) : p;
  return q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h;
}
