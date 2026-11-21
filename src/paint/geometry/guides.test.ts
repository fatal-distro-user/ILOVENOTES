import { describe, it, expect } from 'vitest';
import { symmetryTransforms, snapToPerspective, constrainToGuide, DEFAULT_SYMMETRY, DEFAULT_PERSPECTIVE, DEFAULT_RULER, symmetryGuideLines } from './guides';

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 5); expect(a.y).toBeCloseTo(b.y, 5); };

describe('symmetry', () => {
  const c = { x: 100, y: 100 };
  it('vertical mirrors across x=cx', () => {
    const t = symmetryTransforms({ ...DEFAULT_SYMMETRY, mode: 'vertical', center: c });
    expect(t).toHaveLength(2);
    near(t[1]({ x: 120, y: 50 }), { x: 80, y: 50 });
  });
  it('horizontal mirrors across y=cy', () => {
    near(symmetryTransforms({ ...DEFAULT_SYMMETRY, mode: 'horizontal', center: c })[1]({ x: 120, y: 50 }), { x: 120, y: 150 });
  });
  it('quadrant yields 4 copies', () => {
    const pts = symmetryTransforms({ ...DEFAULT_SYMMETRY, mode: 'quadrant', center: c }).map((f) => f({ x: 110, y: 90 }));
    expect(pts).toHaveLength(4);
    near(pts[3], { x: 90, y: 110 });
  });
  it('radial produces n (or 2n mirrored) copies equidistant from centre', () => {
    const t = symmetryTransforms({ ...DEFAULT_SYMMETRY, mode: 'radial', center: c, segments: 8, mirror: false });
    expect(t).toHaveLength(8);
    for (const f of t) { const q = f({ x: 150, y: 100 }); expect(Math.hypot(q.x - 100, q.y - 100)).toBeCloseTo(50); }
    expect(symmetryTransforms({ ...DEFAULT_SYMMETRY, mode: 'radial', center: c, segments: 5, mirror: true })).toHaveLength(10);
    expect(symmetryGuideLines({ ...DEFAULT_SYMMETRY, mode: 'radial', center: c, segments: 5 }, 100)).toHaveLength(5);
  });
});

describe('perspective', () => {
  it('snaps a stroke toward the vanishing point', () => {
    const cfg = { ...DEFAULT_PERSPECTIVE, mode: '1pt' as const, vp1: { x: 1000, y: 0 } };
    const r = snapToPerspective(cfg, { x: 0, y: 0 }, { x: 100, y: 8 });
    expect(r.point.y).toBeCloseTo(0);
    expect(r.point.x).toBeCloseTo(100);
  });
  it('isometric picks the nearest iso axis', () => {
    const r = snapToPerspective({ ...DEFAULT_PERSPECTIVE, mode: 'isometric' }, { x: 0, y: 0 }, { x: 100, y: -55 });
    expect(r.point.y / r.point.x).toBeCloseTo(-Math.tan(Math.PI / 6));
  });
});

describe('ruler guides', () => {
  it('attaches to the ruler edge within the magnet', () => {
    const g = { ...DEFAULT_RULER, visible: true, x: 0, y: 0 };
    const r = constrainToGuide(g, { x: 10, y: 30 }, 24);
    expect(r.attached).toBe(true);
    near(r.point, { x: 10, y: 24 });
    expect(constrainToGuide(g, { x: 10, y: 200 }, 24).attached).toBe(false);
  });
  it('protractor arc', () => {
    const g = { ...DEFAULT_RULER, kind: 'protractor' as const, visible: true, x: 0, y: 0, length: 200 };
    const r = constrainToGuide(g, { x: 0, y: -95 });
    expect(r.attached).toBe(true);
    near(r.point, { x: 0, y: -100 });
  });
  it('french curve attaches somewhere on the curve', () => {
    const g = { ...DEFAULT_RULER, kind: 'french-curve' as const, visible: true, x: 0, y: 0, length: 300, magnet: 1000 };
    expect(constrainToGuide(g, { x: 0, y: 0 }).attached).toBe(true);
  });
});
