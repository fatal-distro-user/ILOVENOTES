/**
 * Raster adjustment & filter kernels operating on RGBA ImageData-like buffers.
 * Pure functions (no DOM) so they run in a Worker and are unit-testable.
 * Each filter returns a NEW buffer; the input is never mutated.
 */

export interface Img { width: number; height: number; data: Uint8ClampedArray }

export type FilterId =
  | 'hsl' | 'brightness-contrast' | 'curves' | 'levels' | 'color-balance' | 'gaussian-blur' | 'motion-blur'
  | 'pixelate' | 'sharpen' | 'halftone' | 'chromatic-aberration' | 'noise' | 'threshold' | 'invert';

export interface FilterParams {
  hsl: { hue: number; saturation: number; lightness: number };               // hue -180..180, sat/light -100..100
  'brightness-contrast': { brightness: number; contrast: number };            // -100..100
  curves: { points: [number, number][]; channel: 'rgb' | 'r' | 'g' | 'b' };  // 0..255 control points
  levels: { inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number };
  'color-balance': { shadows: [number, number, number]; midtones: [number, number, number]; highlights: [number, number, number] }; // -100..100 cyan-red, magenta-green, yellow-blue
  'gaussian-blur': { radius: number };
  'motion-blur': { distance: number; angle: number };
  pixelate: { size: number };
  sharpen: { amount: number; radius: number };
  halftone: { cellSize: number; angle: number; mono: boolean };
  'chromatic-aberration': { offset: number; angle: number };
  noise: { amount: number; mono: boolean; seed: number };
  threshold: { level: number };
  invert: Record<string, never>;
}

export const FILTER_DEFAULTS: { [K in FilterId]: FilterParams[K] } = {
  hsl: { hue: 0, saturation: 0, lightness: 0 },
  'brightness-contrast': { brightness: 0, contrast: 0 },
  curves: { points: [[0, 0], [64, 64], [192, 192], [255, 255]], channel: 'rgb' },
  levels: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
  'color-balance': { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] },
  'gaussian-blur': { radius: 4 },
  'motion-blur': { distance: 12, angle: 0 },
  pixelate: { size: 8 },
  sharpen: { amount: 60, radius: 1 },
  halftone: { cellSize: 8, angle: 45, mono: true },
  'chromatic-aberration': { offset: 4, angle: 0 },
  noise: { amount: 20, mono: true, seed: 1 },
  threshold: { level: 128 },
  invert: {},
};

export const FILTER_LABELS: Record<FilterId, string> = {
  hsl: 'Hue / Saturation / Lightness', 'brightness-contrast': 'Brightness / Contrast', curves: 'Curves', levels: 'Levels',
  'color-balance': 'Color Balance', 'gaussian-blur': 'Gaussian Blur', 'motion-blur': 'Motion Blur', pixelate: 'Pixelate / Mosaic',
  sharpen: 'Sharpen', halftone: 'Halftone', 'chromatic-aberration': 'Chromatic Aberration', noise: 'Noise / Grain',
  threshold: 'Threshold', invert: 'Invert',
};

const clone = (img: Img): Img => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function mapRGB(img: Img, fn: (r: number, g: number, b: number, out: number[]) => void): Img {
  const o = clone(img);
  const d = o.data;
  const tmp = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    fn(d[i], d[i + 1], d[i + 2], tmp);
    d[i] = tmp[0]; d[i + 1] = tmp[1]; d[i + 2] = tmp[2];
  }
  return o;
}

function lutApply(img: Img, lr: Uint8Array, lg = lr, lb = lr): Img {
  return mapRGB(img, (r, g, b, out) => { out[0] = lr[r]; out[1] = lg[g]; out[2] = lb[b]; });
}

// ───────── colour helpers ─────────
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}
function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h: number, s: number, l: number, out: number[]) {
  if (s === 0) { out[0] = out[1] = out[2] = l * 255; return; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  out[0] = hue2rgb(p, q, h + 1 / 3) * 255; out[1] = hue2rgb(p, q, h) * 255; out[2] = hue2rgb(p, q, h - 1 / 3) * 255;
}

// ───────── adjustments ─────────
export function hueSatLight(img: Img, p: FilterParams['hsl']): Img {
  const dh = p.hue / 360, ds = p.saturation / 100, dl = p.lightness / 100;
  return mapRGB(img, (r, g, b, out) => {
    let [h, s, l] = rgb2hsl(r, g, b);
    h = (h + dh + 1) % 1;
    s = ds >= 0 ? s + (1 - s) * ds : s * (1 + ds);
    l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl);
    hsl2rgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)), out);
  });
}

export function brightnessContrast(img: Img, p: FilterParams['brightness-contrast']): Img {
  const b = p.brightness * 1.5;
  const c = Math.max(-99.9, Math.min(100, p.contrast));
  const f = (259 * (c * 2.55 + 255)) / (255 * (259 - c * 2.55));
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp255(f * (i + b - 128) + 128);
  return lutApply(img, lut);
}

/** Monotone cubic (Fritsch–Carlson) interpolation through curve points → 256-entry LUT. */
export function curveLut(points: [number, number][]): Uint8Array {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const lut = new Uint8Array(256);
  if (pts.length === 0) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  if (pts.length === 1) { lut.fill(clamp255(pts[0][1])); return lut; }
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i] || 1e-6); m.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-6)); }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) { lut[x] = clamp255(ys[0]); continue; }
    if (x >= xs[n - 1]) { lut[x] = clamp255(ys[n - 1]); continue; }
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = dx[i], u = (x - xs[i]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    lut[x] = clamp255(Math.round(h00 * ys[i] + h10 * h * t[i] + h01 * ys[i + 1] + h11 * h * t[i + 1]));
  }
  return lut;
}

export function curves(img: Img, p: FilterParams['curves']): Img {
  const lut = curveLut(p.points);
  const id = new Uint8Array(256).map((_, i) => i);
  if (p.channel === 'rgb') return lutApply(img, lut);
  return lutApply(img, p.channel === 'r' ? lut : id, p.channel === 'g' ? lut : id, p.channel === 'b' ? lut : id);
}

export function levels(img: Img, p: FilterParams['levels']): Img {
  const lut = new Uint8Array(256);
  const range = Math.max(1, p.inWhite - p.inBlack);
  for (let i = 0; i < 256; i++) {
    const n = Math.max(0, Math.min(1, (i - p.inBlack) / range));
    lut[i] = clamp255(p.outBlack + Math.pow(n, 1 / Math.max(0.01, p.gamma)) * (p.outWhite - p.outBlack));
  }
  return lutApply(img, lut);
}

export function colorBalance(img: Img, p: FilterParams['color-balance']): Img {
  return mapRGB(img, (r, g, b, out) => {
    const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
    // Tonal weights (smooth bands like Photoshop).
    const ws = Math.max(0, 1 - l / 0.5) ** 1.5, wh = Math.max(0, (l - 0.5) / 0.5) ** 1.5, wm = 1 - Math.abs(l - 0.5) * 2;
    const ch = (i: 0 | 1 | 2) => (p.shadows[i] * ws + p.midtones[i] * wm * 0.8 + p.highlights[i] * wh) * 1.28;
    out[0] = clamp255(r + ch(0)); out[1] = clamp255(g + ch(1)); out[2] = clamp255(b + ch(2));
  });
}

export function threshold(img: Img, p: FilterParams['threshold']): Img {
  return mapRGB(img, (r, g, b, out) => { const v = 0.299 * r + 0.587 * g + 0.114 * b >= p.level ? 255 : 0; out[0] = out[1] = out[2] = v; });
}

export function invert(img: Img): Img { return mapRGB(img, (r, g, b, out) => { out[0] = 255 - r; out[1] = 255 - g; out[2] = 255 - b; }); }

// ───────── spatial filters ─────────

/** Premultiplied separable box blur pass (horizontal or vertical). */
function boxPass(src: Float32Array, w: number, h: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  for (let line = 0; line < lines; line++) {
    const idx = (k: number) => {
      const kk = k < 0 ? 0 : k >= len ? len - 1 : k;
      return (horizontal ? line * w + kk : kk * w + line) * 4;
    };
    const acc = [0, 0, 0, 0];
    for (let k = -r; k <= r; k++) { const i = idx(k); for (let c = 0; c < 4; c++) acc[c] += src[i + c]; }
    for (let k = 0; k < len; k++) {
      const o = idx(k);
      for (let c = 0; c < 4; c++) out[o + c] = acc[c] / win;
      const add = idx(k + r + 1), sub = idx(k - r);
      for (let c = 0; c < 4; c++) acc[c] += src[add + c] - src[sub + c];
    }
  }
  return out;
}

function premultiply(img: Img): Float32Array {
  const d = img.data, f = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3]; }
  return f;
}
function unpremultiply(f: Float32Array, w: number, h: number): Img {
  const d = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3];
    d[i + 3] = a;
    if (a > 0) { const k = 255 / a; d[i] = f[i] * k; d[i + 1] = f[i + 1] * k; d[i + 2] = f[i + 2] * k; }
  }
  return { width: w, height: h, data: d };
}

/** Gaussian blur approximated by 3 box blurs (box sizes per Kovesi's method). */
export function gaussianBlur(img: Img, p: FilterParams['gaussian-blur']): Img {
  const sigma = Math.max(0, p.radius);
  if (sigma < 0.5) return clone(img);
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  let f = premultiply(img);
  for (let i = 0; i < n; i++) {
    const r = ((i < m ? wl : wu) - 1) / 2;
    f = boxPass(f, img.width, img.height, r, true);
    f = boxPass(f, img.width, img.height, r, false);
  }
  return unpremultiply(f, img.width, img.height);
}

function sampleBilinear(f: Float32Array, w: number, h: number, x: number, y: number, out: number[]): void {
  x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  for (let c = 0; c < 4; c++) {
    const a = f[(y0 * w + x0) * 4 + c], b = f[(y0 * w + x1) * 4 + c], cc = f[(y1 * w + x0) * 4 + c], d = f[(y1 * w + x1) * 4 + c];
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
  }
}

export function motionBlur(img: Img, p: FilterParams['motion-blur']): Img {
  const { width: w, height: h } = img;
  const dist = Math.max(1, Math.round(p.distance));
  const steps = Math.min(64, dist * 2 + 1);
  const ang = (p.angle * Math.PI) / 180, dx = Math.cos(ang), dy = Math.sin(ang);
  const f = premultiply(img), out = new Float32Array(f.length), s = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0, 0];
    for (let k = 0; k < steps; k++) {
      const t = (k / (steps - 1) - 0.5) * dist;
      sampleBilinear(f, w, h, x + dx * t, y + dy * t, s);
      for (let c = 0; c < 4; c++) acc[c] += s[c];
    }
    const o = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) out[o + c] = acc[c] / steps;
  }
  return unpremultiply(out, w, h);
}

export function pixelate(img: Img, p: FilterParams['pixelate']): Img {
  const { width: w, height: h } = img;
  const size = Math.max(1, Math.round(p.size));
  const o = clone(img), d = img.data, od = o.data;
  for (let by = 0; by < h; by += size) for (let bx = 0; bx < w; bx += size) {
    const acc = [0, 0, 0, 0]; let n = 0;
    const ex = Math.min(w, bx + size), ey = Math.min(h, by + size);
    for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
      const i = (y * w + x) * 4, a = d[i + 3];
      acc[0] += d[i] * a; acc[1] += d[i + 1] * a; acc[2] += d[i + 2] * a; acc[3] += a; n++;
    }
    const a = acc[3] / n;
    const col = acc[3] ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]] : [0, 0, 0];
    for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
      const i = (y * w + x) * 4;
      od[i] = col[0]; od[i + 1] = col[1]; od[i + 2] = col[2]; od[i + 3] = a;
    }
  }
  return o;
}

/** Unsharp mask. */
export function sharpen(img: Img, p: FilterParams['sharpen']): Img {
  const blurred = gaussianBlur(img, { radius: Math.max(0.6, p.radius) });
  const o = clone(img), d = o.data, b = blurred.data, k = p.amount / 100 * 1.5;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + (d[i + c] - b[i + c]) * k);
  return o;
}

/** Rotated-grid dot-screen halftone. */
export function halftone(img: Img, p: FilterParams['halftone']): Img {
  const { width: w, height: h } = img;
  const cell = Math.max(2, p.cellSize), ang = (p.angle * Math.PI) / 180, cos = Math.cos(ang), sin = Math.sin(ang);
  const src = img.data, o = clone(img), d = o.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Rotate into screen space and find the cell centre.
    const u = x * cos + y * sin, v = -x * sin + y * cos;
    const cu = (Math.floor(u / cell) + 0.5) * cell, cv = (Math.floor(v / cell) + 0.5) * cell;
    const sx = Math.round(cu * cos - cv * sin), sy = Math.round(cu * sin + cv * cos);
    const si = (Math.max(0, Math.min(h - 1, sy)) * w + Math.max(0, Math.min(w - 1, sx))) * 4;
    const i = (y * w + x) * 4;
    const dist = Math.hypot(u - cu, v - cv) / (cell * 0.7071);
    if (p.mono) {
      const lum = (0.299 * src[si] + 0.587 * src[si + 1] + 0.114 * src[si + 2]) / 255;
      const ink = dist < Math.sqrt(1 - lum) ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = ink;
    } else {
      for (let c = 0; c < 3; c++) d[i + c] = dist < Math.sqrt(1 - src[si + c] / 255) ? 0 : 255;
    }
  }
  return o;
}

export function chromaticAberration(img: Img, p: FilterParams['chromatic-aberration']): Img {
  const { width: w, height: h } = img;
  const ang = (p.angle * Math.PI) / 180, ox = Math.cos(ang) * p.offset, oy = Math.sin(ang) * p.offset;
  const f = new Float32Array(img.data), o = clone(img), d = o.data, s = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    sampleBilinear(f, w, h, x + ox, y + oy, s); d[i] = s[0];
    sampleBilinear(f, w, h, x - ox, y - oy, s); d[i + 2] = s[2];
  }
  return o;
}

/** Deterministic noise (mulberry32) so previews and final apply match. */
export function noise(img: Img, p: FilterParams['noise']): Img {
  let seed = p.seed >>> 0 || 1;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const amt = p.amount * 2.55;
  return mapRGB(img, (r, g, b, out) => {
    if (p.mono) { const n = (rnd() - 0.5) * amt; out[0] = clamp255(r + n); out[1] = clamp255(g + n); out[2] = clamp255(b + n); }
    else { out[0] = clamp255(r + (rnd() - 0.5) * amt); out[1] = clamp255(g + (rnd() - 0.5) * amt); out[2] = clamp255(b + (rnd() - 0.5) * amt); }
  });
}

export function applyFilter<K extends FilterId>(id: K, img: Img, params: FilterParams[K]): Img {
  switch (id) {
    case 'hsl': return hueSatLight(img, params as FilterParams['hsl']);
    case 'brightness-contrast': return brightnessContrast(img, params as FilterParams['brightness-contrast']);
    case 'curves': return curves(img, params as FilterParams['curves']);
    case 'levels': return levels(img, params as FilterParams['levels']);
    case 'color-balance': return colorBalance(img, params as FilterParams['color-balance']);
    case 'gaussian-blur': return gaussianBlur(img, params as FilterParams['gaussian-blur']);
    case 'motion-blur': return motionBlur(img, params as FilterParams['motion-blur']);
    case 'pixelate': return pixelate(img, params as FilterParams['pixelate']);
    case 'sharpen': return sharpen(img, params as FilterParams['sharpen']);
    case 'halftone': return halftone(img, params as FilterParams['halftone']);
    case 'chromatic-aberration': return chromaticAberration(img, params as FilterParams['chromatic-aberration']);
    case 'noise': return noise(img, params as FilterParams['noise']);
    case 'threshold': return threshold(img, params as FilterParams['threshold']);
    case 'invert': return invert(img);
  }
  return clone(img);
}

/** Luminance + per-channel histograms (256 bins each). */
export function histogram(img: Img): { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array } {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
    l[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
  }
  return { r, g, b, l };
}

/** Blend a filtered result back through a selection mask (0..255) — for selection-limited filters. */
export function maskedMix(orig: Img, filtered: Img, mask: Uint8ClampedArray | null): Img {
  if (!mask) return filtered;
  const o = clone(orig);
  for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
    const m = mask[p] / 255;
    if (!m) continue;
    for (let c = 0; c < 4; c++) o.data[i + c] = orig.data[i + c] + (filtered.data[i + c] - orig.data[i + c]) * m;
  }
  return o;
}
