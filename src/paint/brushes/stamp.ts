/** Brush tip stamps (white alpha masks), tinting and paper grain — cached for speed. */
import type { BrushParams, BrushTip } from './types';
import { mulberry32 } from './dynamics';

const SIZE_BUCKETS = [4, 8, 16, 32, 64, 128, 256, 512];
const stampCache = new Map<string, HTMLCanvasElement>();

function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c;
}

/** Pick a stamp resolution ≥ the drawn size (avoids blurry up-scaling) */
export function bucketFor(size: number): number {
  for (const b of SIZE_BUCKETS) if (b >= size) return b;
  return SIZE_BUCKETS[SIZE_BUCKETS.length - 1];
}

/** White-on-transparent tip shape at resolution `res`. Roundness/angle are applied at draw time. */
export function stampFor(tip: BrushTip, hardness: number, res: number, bristles = 0): HTMLCanvasElement {
  const h = Math.round(hardness * 20) / 20;
  const key = `${tip}:${h}:${res}:${bristles}`;
  let c = stampCache.get(key);
  if (c) return c;
  c = mk(res, res);
  const g = c.getContext('2d')!;
  const r = res / 2;
  if (tip === 'round' || tip === 'pencil' || tip === 'charcoal') {
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    const inner = Math.min(0.999, Math.max(0, h));
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(inner, 'rgba(255,255,255,1)');
    // Smooth falloff: more stops → less banding on soft brushes.
    for (let i = 1; i <= 6; i++) {
      const t = inner + ((1 - inner) * i) / 6;
      const a = Math.pow(1 - i / 6, 1.6);
      grad.addColorStop(Math.min(1, t), `rgba(255,255,255,${a.toFixed(3)})`);
    }
    g.fillStyle = grad;
    g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  } else if (tip === 'chisel' || tip === 'square') {
    const blur = (1 - h) * res * 0.12;
    g.filter = blur > 0.5 ? `blur(${blur}px)` : 'none';
    g.fillStyle = '#fff';
    const inset = blur * 1.5;
    g.fillRect(inset, inset, res - inset * 2, res - inset * 2);
    g.filter = 'none';
  } else if (tip === 'spray') {
    const rnd = mulberry32(res * 31 + 7);
    const n = Math.round(res * res * 0.12);
    g.fillStyle = '#fff';
    for (let i = 0; i < n; i++) {
      // Gaussian-ish distribution toward the centre.
      const a = rnd() * Math.PI * 2, d = Math.sqrt(-2 * Math.log(Math.max(1e-6, rnd()))) * r * 0.38;
      if (d > r) continue;
      const s = 0.6 + rnd() * 1.2;
      g.globalAlpha = 0.25 + rnd() * 0.6;
      g.fillRect(r + Math.cos(a) * d, r + Math.sin(a) * d, s, s);
    }
    g.globalAlpha = 1;
  } else if (tip === 'bristle') {
    const rnd = mulberry32(res * 17 + bristles);
    const n = Math.max(6, bristles || 24);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.85;
      const br = Math.max(0.8, r * (0.08 + rnd() * 0.1));
      const x = r + Math.cos(a) * d, y = r + Math.sin(a) * d;
      const grad = g.createRadialGradient(x, y, 0, x, y, br);
      const al = 0.55 + rnd() * 0.45;
      grad.addColorStop(0, `rgba(255,255,255,${al})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, br, 0, Math.PI * 2); g.fill();
    }
  } else if (tip === 'pixel') {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, res, res);
  }
  if (stampCache.size > 160) stampCache.delete(stampCache.keys().next().value as string);
  stampCache.set(key, c);
  return c;
}

/** Tileable paper grain (alpha = how much paint the paper accepts). */
const grainCache = new Map<string, HTMLCanvasElement>();
/** strength 0..1: alpha = (1 - strength) + strength · noise, so 0 = no texture. */
export function grainTexture(scale: number, strength = 1): HTMLCanvasElement {
  const key = `${scale.toFixed(2)}:${(Math.round(strength * 20) / 20).toFixed(2)}`;
  let c = grainCache.get(key);
  if (c) return c;
  const N = 256;
  c = mk(N, N);
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const rnd = mulberry32(1234);
  // Value noise at two octaves, tileable by wrapping lattice coordinates.
  const lattice = (cells: number) => { const v = new Float32Array(cells * cells); for (let i = 0; i < v.length; i++) v[i] = rnd(); return v; };
  const sample = (v: Float32Array, cells: number, x: number, y: number) => {
    const fx = (x / N) * cells, fy = (y / N) * cells;
    const x0 = Math.floor(fx) % cells, y0 = Math.floor(fy) % cells, x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = v[y0 * cells + x0], b = v[y0 * cells + x1], cc = v[y1 * cells + x0], d = v[y1 * cells + x1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (cc * (1 - sx) + d * sx) * sy;
  };
  const cellsA = Math.max(8, Math.round(64 / scale)), cellsB = Math.max(16, Math.round(128 / scale));
  const A = lattice(cellsA), B = lattice(cellsB);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = sample(A, cellsA, x, y) * 0.55 + sample(B, cellsB, x, y) * 0.45 + (rnd() - 0.5) * 0.25;
    const v = Math.max(0, Math.min(1, n));
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(255 * ((1 - strength) + strength * Math.pow(v, 0.8)));
  }
  g.putImageData(img, 0, 0);
  grainCache.set(key, c);
  return c;
}

/** Ordered-dither threshold (0..1) for pixel brushes. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function ditherThreshold(pattern: BrushParams['dither'], x: number, y: number): number {
  const xi = ((x % 4) + 4) % 4, yi = ((y % 4) + 4) % 4;
  switch (pattern) {
    case 'bayer2': return ([0, 2, 3, 1][(yi % 2) * 2 + (xi % 2)] + 0.5) / 4;
    case 'bayer4': return (BAYER4[yi * 4 + xi] + 0.5) / 16;
    case 'checker': return (xi + yi) % 2 ? 0.75 : 0.25;
    case 'lines': return yi % 2 ? 0.75 : 0.25;
    default: return 0;
  }
}
