import { describe, it, expect } from 'vitest';
import { polygonMask, rectPoints, ellipsePoints, applyMode, modeFromModifiers } from './selection';

const count = (m: { data: Uint8ClampedArray }) => m.data.reduce((a, v) => a + v / 255, 0);

describe('selection masks', () => {
  it('rasterises rectangles exactly and ellipses approximately', () => {
    const r = polygonMask(100, 100, rectPoints({ x: 10, y: 10 }, { x: 30, y: 40 }));
    expect(Math.round(count(r))).toBe(600);
    const e = polygonMask(200, 200, ellipsePoints({ x: 0, y: 0 }, { x: 100, y: 100 }, 256));
    expect(count(e)).toBeGreaterThan(Math.PI * 50 * 50 * 0.98);
    expect(count(e)).toBeLessThan(Math.PI * 50 * 50 * 1.01);
  });
  it('combines with add/subtract/intersect', () => {
    const a = polygonMask(50, 50, rectPoints({ x: 0, y: 0 }, { x: 20, y: 20 }));
    const b = polygonMask(50, 50, rectPoints({ x: 10, y: 0 }, { x: 30, y: 20 }));
    expect(Math.round(count(applyMode(a, b, 'add')!))).toBe(600);
    expect(Math.round(count(applyMode(a, b, 'subtract')!))).toBe(200);
    expect(Math.round(count(applyMode(a, b, 'intersect')!))).toBe(200);
    expect(applyMode(a, a, 'subtract')).toBeNull();
    expect(modeFromModifiers(true, true)).toBe('intersect');
  });
});
