import { describe, it, expect } from 'vitest';
import { encodePng, decodePng } from './png';

describe('png codec', () => {
  it('round-trips RGBA pixels and produces a valid signature', () => {
    const w = 37, h = 23;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i * 7 + (i >> 5)) & 255;
    const png = encodePng(px, w, h);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const back = decodePng(png);
    expect(back.width).toBe(w);
    expect(back.height).toBe(h);
    expect(Array.from(back.data)).toEqual(Array.from(px));
  });
  it('compresses flat images well', () => {
    const px = new Uint8ClampedArray(256 * 256 * 4).fill(255);
    expect(encodePng(px, 256, 256).length).toBeLessThan(2000);
  });
});
