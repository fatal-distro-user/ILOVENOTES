import { describe, it, expect } from 'vitest';
import { recognizeShape, shapeToPoints, HoldDetector, type Pt } from './quickshape';

const noise = (s: number) => () => ((Math.sin(s++ * 12.9898) * 43758.5453) % 1) * 2;
function wobble(pts: Pt[], amp = 1.5): Pt[] { const n = noise(7); return pts.map((p) => ({ x: p.x + n() * amp, y: p.y + n() * amp })); }
function lineTo(a: Pt, b: Pt, n = 30): Pt[] { return Array.from({ length: n }, (_, i) => ({ x: a.x + (b.x - a.x) * (i / (n - 1)), y: a.y + (b.y - a.y) * (i / (n - 1)) })); }
function poly(vs: Pt[]): Pt[] { const out: Pt[] = []; for (let i = 0; i < vs.length; i++) out.push(...lineTo(vs[i], vs[(i + 1) % vs.length]).slice(0, -1)); out.push(vs[0]); return out; }

describe('quickshape', () => {
  it('line', () => { expect(recognizeShape(wobble(lineTo({ x: 0, y: 0 }, { x: 200, y: 50 })))?.type).toBe('line'); });
  it('circle', () => {
    const pts = Array.from({ length: 80 }, (_, i) => ({ x: 100 + 60 * Math.cos((i / 79) * Math.PI * 2), y: 100 + 60 * Math.sin((i / 79) * Math.PI * 2) }));
    const s = recognizeShape(wobble(pts));
    expect(s?.type).toBe('circle');
    if (s?.type === 'circle') expect(s.r).toBeGreaterThan(54);
  });
  it('ellipse', () => {
    const pts = Array.from({ length: 80 }, (_, i) => ({ x: 100 + 120 * Math.cos((i / 79) * Math.PI * 2), y: 100 + 50 * Math.sin((i / 79) * Math.PI * 2) }));
    expect(recognizeShape(wobble(pts))?.type).toBe('ellipse');
  });
  it('rectangle (axis-aligned snaps rotation to 0)', () => {
    const s = recognizeShape(wobble(poly([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }])));
    expect(s?.type).toBe('rect');
    if (s?.type === 'rect') { expect(s.rotation).toBe(0); expect(Math.round(s.w)).toBeGreaterThan(190); }
  });
  it('triangle', () => { expect(recognizeShape(wobble(poly([{ x: 0, y: 100 }, { x: 60, y: 0 }, { x: 120, y: 100 }])))?.type).toBe('triangle'); });
  it('star', () => {
    const vs: Pt[] = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 40 : 100; const t = -Math.PI / 2 + (i / 10) * Math.PI * 2; return { x: 150 + r * Math.cos(t), y: 150 + r * Math.sin(t) }; });
    const s = recognizeShape(poly(vs));
    expect(s?.type).toBe('star');
    if (s?.type === 'star') expect(s.spikes).toBe(5);
  });
  it('arrow', () => {
    const shaft = lineTo({ x: 0, y: 0 }, { x: 200, y: 0 }, 40);
    const head = [...lineTo({ x: 200, y: 0 }, { x: 175, y: -20 }, 10), ...lineTo({ x: 175, y: -20 }, { x: 178, y: 22 }, 10)];
    expect(recognizeShape([...shaft, ...head])?.type).toBe('arrow');
  });
  it('polyline fallback and flattening', () => {
    const s = recognizeShape(lineTo({ x: 0, y: 0 }, { x: 100, y: 0 }).concat(lineTo({ x: 100, y: 0 }, { x: 100, y: 100 })));
    expect(s?.type).toBe('polyline');
    expect(shapeToPoints({ type: 'circle', c: { x: 0, y: 0 }, r: 1 }, 4)).toHaveLength(5);
  });
  it('hold detector', () => {
    const h = new HoldDetector(500, 3);
    expect(h.update({ x: 0, y: 0 }, 0)).toBe(false);
    expect(h.update({ x: 1, y: 1 }, 300)).toBe(false);
    expect(h.update({ x: 1, y: 0 }, 520)).toBe(true);
    expect(h.update({ x: 20, y: 0 }, 600)).toBe(false);
  });
});
