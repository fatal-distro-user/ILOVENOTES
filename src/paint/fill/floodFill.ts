/**
 * Flood fill / magic wand region detection on RGBA pixel buffers.
 * - tolerance: max per-channel difference (0..255) from the seed colour
 * - contiguous=false selects every matching pixel (global colour select)
 * - gapClose: treats gaps narrower than ~2*gapClose px in line art as closed. The barrier (non-matching
 *   pixels) is dilated, the fill runs inside the shrunk region, then grows back into matching pixels.
 * - the sampling source can be a reference layer or the composite instead of the target layer.
 */
import { createMask, dilateMask, type Mask } from './mask';

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
export interface RegionOptions { tolerance: number; contiguous: boolean; gapClose?: number; /** grow result into AA edge pixels */ bleed?: number }

function matcher(src: Pixels, sx: number, sy: number, tol: number): (i: number) => boolean {
  const d = src.data;
  const o = (sy * src.width + sx) * 4;
  const r = d[o], g = d[o + 1], b = d[o + 2], a = d[o + 3];
  return (i: number) => {
    const p = i * 4;
    // Fully transparent pixels match regardless of their (meaningless) RGB.
    if (a === 0 && d[p + 3] <= tol) return true;
    return Math.abs(d[p] - r) <= tol && Math.abs(d[p + 1] - g) <= tol && Math.abs(d[p + 2] - b) <= tol && Math.abs(d[p + 3] - a) <= tol;
  };
}

/** Scanline flood fill over an "allowed" predicate. */
function scanFill(w: number, h: number, sx: number, sy: number, allowed: (i: number) => boolean, out: Uint8ClampedArray): void {
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop() as number;
    let x = stack.pop() as number;
    let i = y * w + x;
    if (out[i] || !allowed(i)) continue;
    while (x > 0 && !out[i - 1] && allowed(i - 1)) { x--; i--; }
    let spanUp = false, spanDown = false;
    while (x < w && !out[i] && allowed(i)) {
      out[i] = 255;
      if (y > 0) {
        const up = i - w;
        if (!out[up] && allowed(up)) { if (!spanUp) { stack.push(x, y - 1); spanUp = true; } } else spanUp = false;
      }
      if (y < h - 1) {
        const dn = i + w;
        if (!out[dn] && allowed(dn)) { if (!spanDown) { stack.push(x, y + 1); spanDown = true; } } else spanDown = false;
      }
      x++; i++;
    }
  }
}

export function regionMask(src: Pixels, x: number, y: number, opts: RegionOptions): Mask {
  const { width: w, height: h } = src;
  const sx = Math.floor(x), sy = Math.floor(y);
  const mask = createMask(w, h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
  const match = matcher(src, sx, sy, opts.tolerance);

  if (!opts.contiguous) {
    for (let i = 0; i < w * h; i++) if (match(i)) mask.data[i] = 255;
    return opts.bleed ? growInto(mask, opts.bleed, () => true) : mask;
  }

  const gap = Math.max(0, Math.round(opts.gapClose ?? 0));
  if (gap === 0) {
    scanFill(w, h, sx, sy, match, mask.data);
  } else {
    const barrier = createMask(w, h);
    for (let i = 0; i < w * h; i++) if (!match(i)) barrier.data[i] = 255;
    const thick = dilateMask(barrier, gap);
    const inside = (i: number) => thick.data[i] === 0;
    // If the seed is inside the dilated barrier (clicked near a line), fall back to plain fill.
    if (!inside(sy * w + sx)) scanFill(w, h, sx, sy, match, mask.data);
    else {
      scanFill(w, h, sx, sy, inside, mask.data);
      // Grow back to reach the real line edges, but never through original barrier pixels.
      const grown = growInto(mask, gap, (i) => match(i));
      mask.data.set(grown.data);
    }
  }
  return opts.bleed ? growInto(mask, opts.bleed, () => true) : mask;
}

/** Dilate a mask by radius, keeping only pixels that satisfy `allow`. */
function growInto(m: Mask, radius: number, allow: (i: number) => boolean): Mask {
  const d = dilateMask(m, radius);
  for (let i = 0; i < d.data.length; i++) if (d.data[i] && !m.data[i] && !allow(i)) d.data[i] = 0;
  return d;
}

export type FillPaint = { kind: 'solid'; rgba: [number, number, number, number] };

/** Paints `rgba` into target where mask is set (mask value scales coverage). Respects an optional alpha-lock. */
export function applyFill(target: Pixels, mask: Mask, rgba: [number, number, number, number], alphaLock = false): void {
  const d = target.data;
  const [r, g, b, a] = rgba;
  for (let i = 0; i < mask.data.length; i++) {
    const m = mask.data[i];
    if (!m) continue;
    const p = i * 4;
    const cov = (m / 255) * (a / 255);
    const da = d[p + 3] / 255;
    if (alphaLock) {
      if (!da) continue;
      d[p] = d[p] + (r - d[p]) * cov; d[p + 1] = d[p + 1] + (g - d[p + 1]) * cov; d[p + 2] = d[p + 2] + (b - d[p + 2]) * cov;
      continue;
    }
    const oa = cov + da * (1 - cov);
    if (oa <= 0) continue;
    d[p] = (r * cov + d[p] * da * (1 - cov)) / oa;
    d[p + 1] = (g * cov + d[p + 1] * da * (1 - cov)) / oa;
    d[p + 2] = (b * cov + d[p + 2] * da * (1 - cov)) / oa;
    d[p + 3] = oa * 255;
  }
}
