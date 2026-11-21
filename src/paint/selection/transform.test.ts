import { describe, it, expect } from 'vitest';
import { squareToQuad, gridMap, freeCorners } from './transform';

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); };

describe('transform mappings', () => {
  it('homography maps unit square corners to the quad', () => {
    const q = [{ x: 10, y: 10 }, { x: 110, y: 20 }, { x: 90, y: 130 }, { x: 0, y: 100 }] as [any, any, any, any];
    const m = squareToQuad(q);
    near(m(0, 0), q[0]); near(m(1, 0), q[1]); near(m(1, 1), q[2]); near(m(0, 1), q[3]);
  });
  it('affine quads map midpoints linearly', () => {
    const m = squareToQuad([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }]);
    near(m(0.5, 0.5), { x: 50, y: 25 });
  });
  it('grid map interpolates control points', () => {
    const g = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 20 }];
    near(gridMap(g, 1)(1, 1), { x: 10, y: 20 });
    near(gridMap(g, 1)(0.5, 0.5), { x: 5, y: 7.5 });
  });
  it('free corners respect rotation and flips', () => {
    const c = freeCorners({ cx: 0, cy: 0, w: 20, h: 10, rotation: Math.PI / 2, flipX: false, flipY: false });
    near(c[0], { x: 5, y: -10 });
    const f = freeCorners({ cx: 0, cy: 0, w: 20, h: 10, rotation: 0, flipX: true, flipY: false });
    near(f[0], { x: 10, y: -5 });
  });
});
