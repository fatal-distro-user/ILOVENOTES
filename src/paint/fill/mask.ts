/** 8-bit single-channel masks (0..255) used by selections, fills and layer masks. */

export interface Mask { width: number; height: number; data: Uint8ClampedArray }

export function createMask(width: number, height: number, fill = 0): Mask {
  const data = new Uint8ClampedArray(width * height);
  if (fill) data.fill(fill);
  return { width, height, data };
}

/** Separable square-kernel dilation via running max (O(n) per pass with sliding window). */
export function dilateMask(m: Mask, radius: number): Mask {
  if (radius <= 0) return { ...m, data: m.data.slice() };
  return morph(m, Math.round(radius), true);
}

export function erodeMask(m: Mask, radius: number): Mask {
  if (radius <= 0) return { ...m, data: m.data.slice() };
  return morph(m, Math.round(radius), false);
}

function morph(m: Mask, r: number, max: boolean): Mask {
  const { width: w, height: h } = m;
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  // Square structuring element as two separable passes. For erosion, pixels outside the image count as
  // unselected so selections shrink away from the canvas border too.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x - r, x1 = x + r;
      if (!max && (x0 < 0 || x1 > w - 1)) { tmp[row + x] = 0; continue; }
      let v = max ? 0 : 255;
      for (let k = Math.max(0, x0); k <= Math.min(w - 1, x1); k++) {
        const s = m.data[row + k];
        v = max ? (s > v ? s : v) : (s < v ? s : v);
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const y0 = y - r, y1 = y + r;
      if (!max && (y0 < 0 || y1 > h - 1)) { out[y * w + x] = 0; continue; }
      let v = max ? 0 : 255;
      for (let k = Math.max(0, y0); k <= Math.min(h - 1, y1); k++) {
        const s = tmp[k * w + x];
        v = max ? (s > v ? s : v) : (s < v ? s : v);
      }
      out[y * w + x] = v;
    }
  }
  return { width: w, height: h, data: out };
}

/** Feather (soften) a mask: three box-blur passes approximate a Gaussian of the given radius. */
export function featherMask(m: Mask, radius: number): Mask {
  if (radius <= 0) return { ...m, data: m.data.slice() };
  let cur: Uint8ClampedArray = m.data.slice();
  const r = Math.max(1, Math.round(radius / 1.7));
  for (let pass = 0; pass < 3; pass++) cur = boxBlur1(cur, m.width, m.height, r);
  return { width: m.width, height: m.height, data: cur };
}

function boxBlur1(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray<ArrayBuffer> {
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

export function invertMask(m: Mask): Mask {
  const d = new Uint8ClampedArray(m.data.length);
  for (let i = 0; i < d.length; i++) d[i] = 255 - m.data[i];
  return { width: m.width, height: m.height, data: d };
}

export function combineMasks(a: Mask, b: Mask, op: 'replace' | 'add' | 'subtract' | 'intersect'): Mask {
  const d = new Uint8ClampedArray(a.data.length);
  for (let i = 0; i < d.length; i++) {
    const x = a.data[i], y = b.data[i];
    d[i] = op === 'replace' ? y : op === 'add' ? Math.max(x, y) : op === 'subtract' ? Math.min(x, 255 - y) : Math.min(x, y);
  }
  return { width: a.width, height: a.height, data: d };
}

/** Bounding box of non-zero pixels, or null if empty. */
export function maskBounds(m: Mask): { x: number; y: number; w: number; h: number } | null {
  let x0 = m.width, y0 = m.height, x1 = -1, y1 = -1;
  for (let y = 0; y < m.height; y++) {
    const row = y * m.width;
    for (let x = 0; x < m.width; x++) {
      if (m.data[row + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function isMaskEmpty(m: Mask): boolean { for (let i = 0; i < m.data.length; i++) if (m.data[i]) return false; return true; }
