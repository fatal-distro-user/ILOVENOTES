import { describe, it, expect } from 'vitest';
import { regionMask, applyFill, type Pixels } from './floodFill';
import { dilateMask, erodeMask, featherMask, invertMask, maskBounds, createMask } from './mask';

function canvas(w: number, h: number): Pixels { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
function setPx(p: Pixels, x: number, y: number, c: [number, number, number, number]) { p.data.set(c, (y * p.width + x) * 4); }
const count = (m: { data: Uint8ClampedArray }) => m.data.reduce((a, v) => a + (v ? 1 : 0), 0);

/** 40x40 transparent canvas with a black square outline from 10..29, with a 2px gap on the top edge. */
function outlined(gap: boolean): Pixels {
  const p = canvas(40, 40);
  for (let i = 10; i < 30; i++) {
    if (!(gap && (i === 19 || i === 20))) setPx(p, i, 10, [0, 0, 0, 255]);
    setPx(p, i, 29, [0, 0, 0, 255]); setPx(p, 10, i, [0, 0, 0, 255]); setPx(p, 29, i, [0, 0, 0, 255]);
  }
  return p;
}

describe('flood fill', () => {
  it('fills an enclosed region only', () => {
    const m = regionMask(outlined(false), 20, 20, { tolerance: 0, contiguous: true });
    expect(count(m)).toBe(18 * 18);
  });
  it('leaks through a gap without gap closing, and is contained with it', () => {
    const leak = regionMask(outlined(true), 20, 20, { tolerance: 0, contiguous: true });
    expect(count(leak)).toBeGreaterThan(1000);
    const closed = regionMask(outlined(true), 20, 20, { tolerance: 0, contiguous: true, gapClose: 2 });
    expect(count(closed)).toBeLessThan(18 * 18 + 10);
    expect(count(closed)).toBeGreaterThan(18 * 18 - 40);
  });
  it('global (non-contiguous) select matches all same-colour pixels', () => {
    const p = canvas(10, 10);
    setPx(p, 1, 1, [255, 0, 0, 255]); setPx(p, 8, 8, [255, 0, 0, 255]);
    expect(count(regionMask(p, 1, 1, { tolerance: 10, contiguous: false }))).toBe(2);
  });
  it('applies fill with alpha lock', () => {
    const p = canvas(2, 1);
    setPx(p, 0, 0, [0, 0, 0, 255]);
    const m = createMask(2, 1, 255);
    applyFill(p, m, [255, 0, 0, 255], true);
    expect(Array.from(p.data)).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
    applyFill(p, m, [0, 255, 0, 255]);
    expect(p.data[7]).toBe(255);
  });
});

describe('masks', () => {
  it('dilates, erodes, inverts, feathers and bounds', () => {
    const m = createMask(9, 9);
    m.data[4 * 9 + 4] = 255;
    const d = dilateMask(m, 1);
    expect(count(d)).toBe(9);
    expect(count(erodeMask(d, 1))).toBe(1);
    expect(count(invertMask(m))).toBe(80);
    expect(maskBounds(d)).toEqual({ x: 3, y: 3, w: 3, h: 3 });
    const f = featherMask(d, 2);
    expect(f.data[4 * 9 + 4]).toBeLessThan(255);
    expect(f.data[4 * 9 + 4]).toBeGreaterThan(0);
  });
});
