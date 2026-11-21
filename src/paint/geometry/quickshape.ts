/**
 * QuickShape recognizer: turns a rough freehand stroke into a crisp geometric shape.
 * Shapes are expressed with editable control points so the UI can show handles.
 */

export interface Pt { x: number; y: number }

export type QuickShape =
  | { type: 'line'; a: Pt; b: Pt }
  | { type: 'arrow'; a: Pt; b: Pt }
  | { type: 'polyline'; points: Pt[]; closed: boolean }
  | { type: 'circle'; c: Pt; r: number }
  | { type: 'ellipse'; c: Pt; rx: number; ry: number; rotation: number }
  | { type: 'rect'; c: Pt; w: number; h: number; rotation: number }
  | { type: 'triangle'; points: [Pt, Pt, Pt] }
  | { type: 'star'; c: Pt; outer: number; inner: number; spikes: number; rotation: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const L = dist(a, b);
  if (L === 0) return dist(p, a);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
}

/** Ramer–Douglas–Peucker simplification. */
export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

/** Closed-loop RDP: split at the point farthest from the start so a loop doesn't collapse. */
function rdpClosed(pts: Pt[], eps: number): Pt[] {
  let far = 0, fd = 0;
  for (let i = 0; i < pts.length; i++) { const d = dist(pts[0], pts[i]); if (d > fd) { fd = d; far = i; } }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp([...pts.slice(far), pts[0]], eps);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  // Merge near-collinear vertices across the seam.
  return out.filter((p, i) => {
    const prev = out[(i - 1 + out.length) % out.length], next = out[(i + 1) % out.length];
    return perpDist(p, prev, next) > eps * 0.75;
  });
}

function bbox(pts: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, diag: Math.hypot(x1 - x0, y1 - y0) };
}

function centroid(pts: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

/** Resample to n evenly spaced points along the path (removes sampling-density bias). */
export function resample(pts: Pt[], n: number): Pt[] {
  const total = pathLength(pts);
  if (total === 0 || pts.length < 2) return pts.slice();
  const step = total / (n - 1);
  const out: Pt[] = [pts[0]];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let cur = pts[i];
    let d = dist(prev, cur);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const q = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
    cur = pts[i];
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out;
}

const angleAt = (a: Pt, b: Pt, c: Pt) => {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
};

/** PCA ellipse fit: centre, semi-axes and rotation. Returns normalised radial error. */
function fitEllipse(pts: Pt[]) {
  const c = centroid(pts);
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - c.x, dy = p.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= pts.length; syy /= pts.length; sxy /= pts.length;
  const rotation = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  let rx = 0, ry = 0;
  for (const p of pts) {
    const dx = p.x - c.x, dy = p.y - c.y;
    rx = Math.max(rx, Math.abs(dx * cos + dy * sin));
    ry = Math.max(ry, Math.abs(-dx * sin + dy * cos));
  }
  // Use RMS-based axes (robust to overshoot), scaled: for an ellipse, RMS along axis = a/√2.
  let ax = 0, ay = 0;
  for (const p of pts) {
    const dx = p.x - c.x, dy = p.y - c.y;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    ax += u * u; ay += v * v;
  }
  rx = Math.sqrt((2 * ax) / pts.length) || rx;
  ry = Math.sqrt((2 * ay) / pts.length) || ry;
  let err = 0;
  for (const p of pts) {
    const dx = p.x - c.x, dy = p.y - c.y;
    const u = (dx * cos + dy * sin) / rx, v = (-dx * sin + dy * cos) / ry;
    err += Math.abs(Math.sqrt(u * u + v * v) - 1);
  }
  return { c, rx, ry, rotation, err: err / pts.length };
}

export interface RecognizeOptions { /** closure threshold as fraction of path length */ closeTolerance?: number }

export function recognizeShape(raw: Pt[], opts: RecognizeOptions = {}): QuickShape | null {
  if (raw.length < 2) return null;
  const len = pathLength(raw);
  const bb = bbox(raw);
  if (len < 8 || bb.diag < 6) return null;
  const pts = resample(raw, 96);
  const start = pts[0], end = pts[pts.length - 1];
  const closed = dist(start, end) < Math.max(12, len * (opts.closeTolerance ?? 0.12));
  const eps = Math.max(2, bb.diag * 0.045);

  if (!closed) {
    const simple = rdp(pts, eps);
    if (simple.length === 2 || dist(start, end) / len > 0.95) return { type: 'line', a: start, b: end };
    // Arrow: long shaft followed by a short head stroke that folds back sharply (one-stroke "->" gesture).
    if (simple.length >= 4) {
      const n = simple.length;
      const shaftEnd = simple[n - 3], tip = simple[n - 3];
      const shaftLen = dist(simple[0], shaftEnd);
      const h1 = dist(simple[n - 3], simple[n - 2]), h2 = dist(simple[n - 2], simple[n - 1]);
      const fold = angleAt(simple[n - 4], simple[n - 3], simple[n - 2]);
      if (h1 < shaftLen * 0.45 && h2 < shaftLen * 0.6 && fold < Math.PI * 0.35 && h1 > 0) {
        return { type: 'arrow', a: simple[0], b: tip };
      }
    }
    return { type: 'polyline', points: simple, closed: false };
  }

  const loop = pts.slice(0, -1);
  const corners = rdpClosed(loop, eps);
  const c = centroid(loop);
  const radii = loop.map((p) => dist(p, c));
  const meanR = radii.reduce((a, r) => a + r, 0) / radii.length;
  const radialStd = Math.sqrt(radii.reduce((a, r) => a + (r - meanR) ** 2, 0) / radii.length) / meanR;

  if (corners.length === 3) return { type: 'triangle', points: [corners[0], corners[1], corners[2]] };

  if (corners.length === 4) {
    const angles = corners.map((p, i) => angleAt(corners[(i + 3) % 4], p, corners[(i + 1) % 4]));
    if (angles.every((a) => Math.abs(a - Math.PI / 2) < 0.45)) {
      const e = fitEllipse(loop);
      // Rect orientation from the longest edge.
      let best = 0, bestLen = 0;
      for (let i = 0; i < 4; i++) { const l = dist(corners[i], corners[(i + 1) % 4]); if (l > bestLen) { bestLen = l; best = i; } }
      const a = corners[best], b = corners[(best + 1) % 4];
      let rotation = Math.atan2(b.y - a.y, b.x - a.x);
      // Snap near-axis-aligned rectangles.
      const snapped = Math.round(rotation / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(rotation - snapped) < 0.12) rotation = 0;
      const cos = Math.cos(rotation), sin = Math.sin(rotation);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of corners) {
        const dx = p.x - e.c.x, dy = p.y - e.c.y;
        const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      return { type: 'rect', c: { x: e.c.x + cu * cos - cv * sin, y: e.c.y + cu * sin + cv * cos }, w: u1 - u0, h: v1 - v0, rotation };
    }
  }

  // Star: alternating far/near vertices.
  if (corners.length >= 8 && corners.length <= 16 && corners.length % 2 === 0) {
    const rs = corners.map((p) => dist(p, c));
    const odd = rs.filter((_, i) => i % 2 === 1), even = rs.filter((_, i) => i % 2 === 0);
    const mo = odd.reduce((a, b) => a + b, 0) / odd.length, me = even.reduce((a, b) => a + b, 0) / even.length;
    const outer = Math.max(mo, me), inner = Math.min(mo, me);
    const consistent = rs.every((r, i) => (i % 2 === 0 ? me : mo) * 0.7 < r && r < (i % 2 === 0 ? me : mo) * 1.3);
    if (inner / outer < 0.72 && consistent) {
      const outerPts = corners.filter((_, i) => (i % 2 === 0) === (me > mo));
      const top = outerPts[0];
      return { type: 'star', c, outer, inner, spikes: corners.length / 2, rotation: Math.atan2(top.y - c.y, top.x - c.x) };
    }
  }

  if (radialStd < 0.1) return { type: 'circle', c, r: meanR };
  const e = fitEllipse(loop);
  if (e.err < 0.12) {
    if (Math.abs(e.rx - e.ry) / Math.max(e.rx, e.ry) < 0.08) return { type: 'circle', c: e.c, r: (e.rx + e.ry) / 2 };
    return { type: 'ellipse', c: e.c, rx: e.rx, ry: e.ry, rotation: e.rotation };
  }
  return { type: 'polyline', points: corners, closed: true };
}

/** Flatten a shape into drawable points (for raster brush rendering or vector ink). */
export function shapeToPoints(s: QuickShape, segments = 96): Pt[] {
  switch (s.type) {
    case 'line': return [s.a, s.b];
    case 'arrow': {
      const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
      const L = Math.min(28, dist(s.a, s.b) * 0.3);
      const l = { x: s.b.x - L * Math.cos(ang - 0.45), y: s.b.y - L * Math.sin(ang - 0.45) };
      const r = { x: s.b.x - L * Math.cos(ang + 0.45), y: s.b.y - L * Math.sin(ang + 0.45) };
      return [s.a, s.b, l, s.b, r];
    }
    case 'polyline': return s.closed ? [...s.points, s.points[0]] : s.points;
    case 'triangle': return [...s.points, s.points[0]];
    case 'circle': return Array.from({ length: segments + 1 }, (_, i) => { const t = (i / segments) * Math.PI * 2; return { x: s.c.x + s.r * Math.cos(t), y: s.c.y + s.r * Math.sin(t) }; });
    case 'ellipse': {
      const cos = Math.cos(s.rotation), sin = Math.sin(s.rotation);
      return Array.from({ length: segments + 1 }, (_, i) => {
        const t = (i / segments) * Math.PI * 2; const u = s.rx * Math.cos(t), v = s.ry * Math.sin(t);
        return { x: s.c.x + u * cos - v * sin, y: s.c.y + u * sin + v * cos };
      });
    }
    case 'rect': {
      const cos = Math.cos(s.rotation), sin = Math.sin(s.rotation);
      const hw = s.w / 2, hh = s.h / 2;
      const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
      return corners.map(([u, v]) => ({ x: s.c.x + u * cos - v * sin, y: s.c.y + u * sin + v * cos }));
    }
    case 'star': {
      const out: Pt[] = [];
      for (let i = 0; i <= s.spikes * 2; i++) {
        const r = i % 2 === 0 ? s.outer : s.inner;
        const t = s.rotation + (i / (s.spikes * 2)) * Math.PI * 2;
        out.push({ x: s.c.x + r * Math.cos(t), y: s.c.y + r * Math.sin(t) });
      }
      return out;
    }
  }
}

/** Editable control handles for a recognised shape. */
export function shapeHandles(s: QuickShape): Pt[] {
  switch (s.type) {
    case 'line': case 'arrow': return [s.a, s.b];
    case 'polyline': return s.points;
    case 'triangle': return s.points;
    case 'circle': return [s.c, { x: s.c.x + s.r, y: s.c.y }];
    case 'ellipse': case 'rect': case 'star': return shapeToPoints(s).slice(0, -1).filter((_, i, a) => s.type !== 'ellipse' || i % Math.floor(a.length / 4) === 0).concat([s.c]);
  }
}

/** Detects the "hold still at the end of a stroke" gesture. */
export class HoldDetector {
  private anchor: Pt | null = null;
  private since = 0;
  constructor(private readonly holdMs = 550, private readonly radius = 4) {}
  reset(): void { this.anchor = null; this.since = 0; }
  /** Feed a pointer sample; returns true once the pointer has rested for holdMs. */
  update(p: Pt, t: number): boolean {
    if (!this.anchor || dist(this.anchor, p) > this.radius) { this.anchor = p; this.since = t; return false; }
    return t - this.since >= this.holdMs;
  }
}
