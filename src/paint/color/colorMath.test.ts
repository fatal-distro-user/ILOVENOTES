import { describe, it, expect } from 'vitest';
import * as C from './colorMath';

describe('colour math', () => {
  it('round-trips HSV/HSL/CMYK/HEX', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#123456', '#fedcba', '#808080', '#000000', '#ffffff']) {
      const rgb = C.parseHex(hex)!;
      expect(C.rgbToHex(C.hsvToRgb(C.rgbToHsv(rgb)))).toBe(hex);
      expect(C.rgbToHex(C.hslToRgb(C.rgbToHsl(rgb)))).toBe(hex);
      expect(C.rgbToHex(C.cmykToRgb(C.rgbToCmyk(rgb)))).toBe(hex);
    }
  });
  it('parses hex and rgb strings', () => {
    expect(C.parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(C.parseHex('zzz')).toBeNull();
    expect(C.parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(C.rgbaToHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080');
  });
  it('builds harmonies', () => {
    const base = { h: 10, s: 1, v: 1 };
    expect(C.harmony(base, 'complementary')[1].h).toBe(190);
    expect(C.harmony(base, 'triadic').map((x) => x.h)).toEqual([10, 130, 250]);
    expect(C.harmony(base, 'tetradic')).toHaveLength(4);
    expect(C.harmony(base, 'analogous')[0].h).toBe(340);
  });
  it('round-trips gpl and hex palettes', () => {
    const cols = ['#ff0000', '#00ff00', '#123abc'];
    const gpl = C.parseGpl(C.toGpl('Test', cols));
    expect(gpl).toEqual({ name: 'Test', colors: cols });
    expect(C.parseHexPalette(C.toHexPalette(cols))).toEqual(cols);
  });
  it('extracts dominant colours', () => {
    const data = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) data.set(i < 70 ? [250, 0, 0, 255] : [0, 0, 250, 255], i * 4);
    const pal = C.extractPalette(data, 2);
    expect(pal).toEqual(['#fa0000', '#0000fa']);
  });
});
