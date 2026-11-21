/**
 * Floating transform of lifted pixels: free (move/scale/rotate/flip), distort/perspective (4 free corners,
 * projective mapping) and warp (4×4 control mesh). Rendering subdivides the source into a triangle mesh and
 * draws each triangle with an affine texture map, so any of the mappings can be drawn with Canvas2D.
 */
export interface Pt { x: number; y: number }
export type TransformMode = 'free' | 'distort' | 'warp';

/** Solve the 3×3 homography mapping unit-square corners (0,0),(1,0),(1,1),(0,1) to quad q. */
export function squareToQuad(q: [Pt, Pt, Pt, Pt]): (u: number, v: number) => Pt {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0;
    h = den ? (dx1 * dy3 - dx3 * dy1) / den : 0;
  }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, c = p0.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

/** Bilinear interpolation over a (n+1)×(n+1) control grid (row-major). */
export function gridMap(grid: Pt[], n: number): (u: number, v: number) => Pt {
  return (u, v) => {
    const fu = Math.min(n - 1e-9, Math.max(0, u * n)), fv = Math.min(n - 1e-9, Math.max(0, v * n));
    const i = Math.floor(fu), j = Math.floor(fv), s = fu - i, t = fv - j;
    const p00 = grid[j * (n + 1) + i], p10 = grid[j * (n + 1) + i + 1], p01 = grid[(j + 1) * (n + 1) + i], p11 = grid[(j + 1) * (n + 1) + i + 1];
    return {
      x: (p00.x * (1 - s) + p10.x * s) * (1 - t) + (p01.x * (1 - s) + p11.x * s) * t,
      y: (p00.y * (1 - s) + p10.y * s) * (1 - t) + (p01.y * (1 - s) + p11.y * s) * t,
    };
  };
}

/** Draw `src` (sw×sh) mapped through `map` using an N×N triangle mesh. */
export function drawMapped(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, map: (u: number, v: number) => Pt, n: number): void {
  const pts: Pt[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pts.push(map(i / n, j / n));
  const tri = (s0: Pt, s1: Pt, s2: Pt, d0: Pt, d1: Pt, d2: Pt) => {
    // Expand the destination triangle slightly to hide seams between neighbours.
    const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
    const grow = (p: Pt) => { const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1; return { x: p.x + (dx / l) * 0.6, y: p.y + (dy / l) * 0.6 }; };
    const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.closePath(); ctx.clip();
    // Affine transform mapping source triangle → destination triangle.
    const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
    if (Math.abs(den) < 1e-9) { ctx.restore(); return; }
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
    const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
    const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
    const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
    const e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - d * s0.y;
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const s00 = { x: (i / n) * sw, y: (j / n) * sh }, s10 = { x: ((i + 1) / n) * sw, y: (j / n) * sh };
    const s01 = { x: (i / n) * sw, y: ((j + 1) / n) * sh }, s11 = { x: ((i + 1) / n) * sw, y: ((j + 1) / n) * sh };
    const d00 = pts[j * (n + 1) + i], d10 = pts[j * (n + 1) + i + 1], d01 = pts[(j + 1) * (n + 1) + i], d11 = pts[(j + 1) * (n + 1) + i + 1];
    tri(s00, s10, s11, d00, d10, d11);
    tri(s00, s11, s01, d00, d11, d01);
  }
}

export interface FreeState { cx: number; cy: number; w: number; h: number; rotation: number; flipX: boolean; flipY: boolean }

export function freeCorners(s: FreeState): [Pt, Pt, Pt, Pt] {
  const c = Math.cos(s.rotation), sn = Math.sin(s.rotation);
  const hx = (s.w / 2) * (s.flipX ? -1 : 1), hy = (s.h / 2) * (s.flipY ? -1 : 1);
  const P = (u: number, v: number): Pt => ({ x: s.cx + u * c - v * sn, y: s.cy + u * sn + v * c });
  return [P(-hx, -hy), P(hx, -hy), P(hx, hy), P(-hx, hy)];
}

export class FloatingTransform {
  mode: TransformMode = 'free';
  free: FreeState;
  corners: [Pt, Pt, Pt, Pt];
  readonly gridN = 3;
  grid: Pt[];

  constructor(readonly source: HTMLCanvasElement, readonly origin: { x: number; y: number; w: number; h: number }) {
    this.free = { cx: origin.x + origin.w / 2, cy: origin.y + origin.h / 2, w: origin.w, h: origin.h, rotation: 0, flipX: false, flipY: false };
    this.corners = freeCorners(this.free);
    this.grid = this.gridFromCorners();
  }

  private gridFromCorners(): Pt[] {
    const m = squareToQuad(this.corners);
    const out: Pt[] = [];
    for (let j = 0; j <= this.gridN; j++) for (let i = 0; i <= this.gridN; i++) out.push(m(i / this.gridN, j / this.gridN));
    return out;
  }

  setMode(m: TransformMode): void {
    if (m === this.mode) return;
    if (this.mode === 'free') this.corners = freeCorners(this.free);
    if (m === 'warp') this.grid = this.gridFromCorners();
    if (m === 'free' && this.mode !== 'free') {
      // Back to free: approximate with the bounding box of the current corners.
      const xs = this.corners.map((p) => p.x), ys = this.corners.map((p) => p.y);
      this.free = { ...this.free, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rotation: 0 };
    }
    this.mode = m;
  }

  mapping(): { map: (u: number, v: number) => Pt; n: number } {
    if (this.mode === 'free') return { map: squareToQuad(freeCorners(this.free)), n: 1 };
    if (this.mode === 'distort') return { map: squareToQuad(this.corners), n: 16 };
    return { map: gridMap(this.grid, this.gridN), n: 18 };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { map, n } = this.mapping();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawMapped(ctx, this.source, this.source.width, this.source.height, map, n);
  }

  /** Handle positions for the current mode (doc space). */
  handles(): { id: string; p: Pt }[] {
    if (this.mode === 'free') {
      const [a, b, c, d] = freeCorners(this.free);
      const mid = (p: Pt, q: Pt) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const top = mid(a, b);
      const ang = this.free.rotation - Math.PI / 2;
      return [
        { id: 'c0', p: a }, { id: 'c1', p: b }, { id: 'c2', p: c }, { id: 'c3', p: d },
        { id: 'e0', p: top }, { id: 'e1', p: mid(b, c) }, { id: 'e2', p: mid(c, d) }, { id: 'e3', p: mid(d, a) },
        { id: 'rot', p: { x: top.x + Math.cos(ang) * 30, y: top.y + Math.sin(ang) * 30 } },
      ];
    }
    if (this.mode === 'distort') return this.corners.map((p, i) => ({ id: `c${i}`, p }));
    return this.grid.map((p, i) => ({ id: `g${i}`, p }));
  }

  outline(): Pt[] {
    const { map } = this.mapping();
    const out: Pt[] = [];
    const k = this.mode === 'free' ? 1 : 12;
    for (let i = 0; i <= k; i++) out.push(map(i / k, 0));
    for (let i = 0; i <= k; i++) out.push(map(1, i / k));
    for (let i = k; i >= 0; i--) out.push(map(i / k, 1));
    for (let i = k; i >= 0; i--) out.push(map(0, i / k));
    return out;
  }

  /** Is p inside the transformed shape (for move-drag)? */
  contains(p: Pt): boolean {
    const poly = this.outline();
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  translate(dx: number, dy: number): void {
    this.free.cx += dx; this.free.cy += dy;
    this.corners = this.corners.map((p) => ({ x: p.x + dx, y: p.y + dy })) as [Pt, Pt, Pt, Pt];
    this.grid = this.grid.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  flip(axis: 'x' | 'y'): void {
    if (this.mode === 'free') { if (axis === 'x') this.free.flipX = !this.free.flipX; else this.free.flipY = !this.free.flipY; return; }
    const [a, b, c, d] = this.corners;
    this.corners = axis === 'x' ? [b, a, d, c] : [d, c, b, a];
    const n = this.gridN + 1;
    const g = this.grid.slice();
    this.grid = g.map((_, idx) => { const i = idx % n, j = Math.floor(idx / n); return axis === 'x' ? g[j * n + (n - 1 - i)] : g[(n - 1 - j) * n + i]; });
  }

  /** Drag a handle to world point p. `start` = state snapshot at drag start. */
  dragHandle(id: string, p: Pt, start: FreeState, opts: { keepAspect: boolean; snapAngle: boolean }): void {
    if (id === 'rot') {
      let a = Math.atan2(p.y - start.cy, p.x - start.cx) + Math.PI / 2;
      if (opts.snapAngle) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      this.free.rotation = a;
      return;
    }
    if (this.mode === 'free') {
      // Work in the box's local frame; the opposite side stays fixed.
      const c = Math.cos(-start.rotation), s = Math.sin(-start.rotation);
      const lx = (p.x - start.cx) * c - (p.y - start.cy) * s, ly = (p.x - start.cx) * s + (p.y - start.cy) * c;
      let x0 = -start.w / 2, x1 = start.w / 2, y0 = -start.h / 2, y1 = start.h / 2;
      const sxSign = start.flipX ? -1 : 1, sySign = start.flipY ? -1 : 1;
      const corner = { c0: [-1, -1], c1: [1, -1], c2: [1, 1], c3: [-1, 1], e0: [0, -1], e1: [1, 0], e2: [0, 1], e3: [-1, 0] }[id as 'c0'];
      if (!corner) return;
      const hx = corner[0] * sxSign, hy = corner[1] * sySign;
      if (hx < 0) x0 = Math.min(lx, x1 - 1); else if (hx > 0) x1 = Math.max(lx, x0 + 1);
      if (hy < 0) y0 = Math.min(ly, y1 - 1); else if (hy > 0) y1 = Math.max(ly, y0 + 1);
      let w = x1 - x0, h = y1 - y0;
      if (opts.keepAspect && corner[0] && corner[1]) {
        const ar = start.w / start.h;
        if (w / h > ar) h = w / ar; else w = h * ar;
        if (hx < 0) x0 = x1 - w; else x1 = x0 + w;
        if (hy < 0) y0 = y1 - h; else y1 = y0 + h;
      }
      const mcx = (x0 + x1) / 2, mcy = (y0 + y1) / 2;
      const cr = Math.cos(start.rotation), sr = Math.sin(start.rotation);
      this.free = { ...start, w, h, cx: start.cx + mcx * cr - mcy * sr, cy: start.cy + mcx * sr + mcy * cr };
      return;
    }
    if (this.mode === 'distort' && id.startsWith('c')) { const i = Number(id.slice(1)); this.corners[i] = { ...p }; return; }
    if (this.mode === 'warp' && id.startsWith('g')) { const i = Number(id.slice(1)); this.grid[i] = { ...p }; }
  }
}
