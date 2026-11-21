import { describe, it, expect } from 'vitest';
import { applyFilter, FILTER_DEFAULTS, curveLut, histogram, maskedMix, type FilterId, type Img } from './kernels';

function img(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}
const px = (i: Img, x: number, y: number) => Array.from(i.data.slice((y * i.width + x) * 4, (y * i.width + x) * 4 + 4));

describe('filters', () => {
  const grad = img(16, 16, (x, y) => [x * 16, y * 16, 128, 255]);
  it('every filter runs with defaults and preserves size', () => {
    for (const id of Object.keys(FILTER_DEFAULTS) as FilterId[]) {
      const out = applyFilter(id, grad, FILTER_DEFAULTS[id] as never);
      expect(out.data.length).toBe(grad.data.length);
    }
  });
  it('does not mutate input', () => {
    const copy = new Uint8ClampedArray(grad.data);
    applyFilter('gaussian-blur', grad, { radius: 3 });
    expect(grad.data).toEqual(copy);
  });
  it('invert and threshold', () => {
    expect(px(applyFilter('invert', grad, {}), 1, 1)).toEqual([239, 239, 127, 255]);
    const t = applyFilter('threshold', grad, { level: 128 });
    expect([0, 255]).toContain(px(t, 5, 5)[0]);
  });
  it('identity curves/levels are no-ops', () => {
    const lut = curveLut([[0, 0], [255, 255]]);
    expect(lut[100]).toBe(100);
    expect(px(applyFilter('levels', grad, FILTER_DEFAULTS.levels), 3, 7)).toEqual(px(grad, 3, 7));
  });
  it('blur smooths a hard edge and keeps flat areas', () => {
    const edge = img(20, 1, (x) => (x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const b = applyFilter('gaussian-blur', edge, { radius: 2 });
    expect(px(b, 9, 0)[0]).toBeGreaterThan(40);
    expect(px(b, 0, 0)[0]).toBe(0);
  });
  it('pixelate averages blocks', () => {
    const p = applyFilter('pixelate', grad, { size: 4 });
    expect(px(p, 0, 0)).toEqual(px(p, 3, 3));
  });
  it('hsl saturation -100 desaturates', () => {
    const red = img(1, 1, () => [255, 0, 0, 255]);
    const g = px(applyFilter('hsl', red, { hue: 0, saturation: -100, lightness: 0 }), 0, 0);
    expect(g[0]).toBe(g[1]);
    const hue = px(applyFilter('hsl', red, { hue: 120, saturation: 0, lightness: 0 }), 0, 0);
    expect(hue[1]).toBe(255);
  });
  it('histogram and masked mix', () => {
    const h = histogram(grad);
    expect(h.b[128]).toBe(256);
    const inv = applyFilter('invert', grad, {});
    const mask = new Uint8ClampedArray(256); mask[0] = 255;
    const mixed = maskedMix(grad, inv, mask);
    expect(px(mixed, 0, 0)).toEqual(px(inv, 0, 0));
    expect(px(mixed, 1, 0)).toEqual(px(grad, 1, 0));
  });
});
