import { describe, it, expect } from 'vitest';
import { encodeGif, spriteSheet } from './gif';

const frame = (c: number, w = 8, h = 8) => ({ width: w, height: h, delayMs: 100, data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : c)) });

describe('gif & sprite sheets', () => {
  it('encodes a looping animated GIF', async () => {
    const bytes = await encodeGif([frame(0), frame(128), frame(255)]);
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.at(-1)).toBe(0x3b);
    // NETSCAPE loop extension present.
    expect(new TextDecoder().decode(bytes).includes('NETSCAPE2.0')).toBe(true);
  });
  it('builds sprite sheets in a grid', () => {
    const s = spriteSheet([frame(10, 2, 2), frame(20, 2, 2), frame(30, 2, 2)]);
    expect([s.width, s.height, s.columns, s.rows]).toEqual([4, 4, 2, 2]);
    expect(s.data[0]).toBe(10);
    expect(s.data[(0 * 4 + 2) * 4]).toBe(20);
    expect(s.data[(2 * 4 + 0) * 4]).toBe(30);
  });
});
