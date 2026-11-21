import { describe, it, expect } from 'vitest';
import { pushHistory, dedupeColors, addColors, removeAt, reorder, detectPaletteFormat, parsePaletteFile, normHex, HISTORY_MAX, DEFAULT_PALETTE } from './palette';
import { harmony, rgbToHsv, parseHex, hsvToRgb, rgbToHex, toGpl, toHexPalette } from './colorMath';

describe('history', () => {
  it('puts newest first and de-duplicates', () => {
    expect(pushHistory(['#111111', '#222222'], '#222222')).toEqual(['#222222', '#111111']);
    expect(pushHistory(['#111111'], '#ABCDEF')).toEqual(['#abcdef', '#111111']);
  });
  it('caps at max and ignores invalid', () => {
    let l: string[] = [];
    for (let i = 0; i < 40; i++) l = pushHistory(l, '#' + (i * 1000 + 100000).toString(16).padStart(6, '0'));
    expect(l).toHaveLength(HISTORY_MAX);
    expect(pushHistory(l, 'nope')).toEqual(l);
  });
  it('normalises alpha hex', () => { expect(normHex('#f00')).toBe('#ff0000'); expect(normHex('#ff000080')).toBe('#ff0000'); expect(normHex('zz')).toBeNull(); });
});

describe('palette ops', () => {
  it('dedupes and adds', () => {
    expect(dedupeColors(['#FFF', '#ffffff', '#000'])).toEqual(['#ffffff', '#000000']);
    expect(addColors(['#ffffff'], ['#ffffff', '#123456'])).toEqual(['#ffffff', '#123456']);
  });
  it('removes and reorders', () => {
    expect(removeAt([1, 2, 3], 1)).toEqual([1, 3]);
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorder(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(reorder(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(reorder(['a', 'b'], 0, 99)).toEqual(['b', 'a']);
  });
  it('default palette is 16 unique colours', () => { expect(dedupeColors(DEFAULT_PALETTE)).toHaveLength(16); });
});

describe('palette files', () => {
  it('detects formats', () => {
    expect(detectPaletteFormat('a.txt', 'GIMP Palette\nName: x\n255 0 0 red')).toBe('gpl');
    expect(detectPaletteFormat('a.txt', 'ff0000\n00ff00\n')).toBe('hex');
    expect(detectPaletteFormat('a.txt', 'hello world')).toBe('unknown');
  });
  it('round-trips gpl and hex exports', () => {
    const cols = ['#ff0000', '#00ff00', '#0000ff'];
    expect(parsePaletteFile('mine.gpl', toGpl('Mine', cols))).toEqual({ name: 'Mine', colors: cols });
    expect(parsePaletteFile('px.hex', toHexPalette(cols))).toEqual({ name: 'px', colors: cols });
    expect(parsePaletteFile('x.txt', 'junk')).toBeNull();
  });
});

describe('harmony usage', () => {
  it('complementary of red is cyan', () => {
    const base = rgbToHsv(parseHex('#ff0000')!);
    const hs = harmony(base, 'complementary').map((h) => rgbToHex(hsvToRgb(h)));
    expect(hs).toEqual(['#ff0000', '#00ffff']);
  });
});
