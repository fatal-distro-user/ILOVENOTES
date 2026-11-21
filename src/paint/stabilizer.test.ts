import { describe, it, expect } from 'vitest';
import { stabilizeAll, simulatedPressure, catmullRom, type InputPoint } from './stabilizer';

const jitterLine = (): InputPoint[] => Array.from({ length: 60 }, (_, i) => ({ x: i * 5, y: (i % 2 ? 6 : -6), pressure: 0.6, t: i * 8, pointerType: 'pen' }));
const roughness = (pts: { y: number }[]) => pts.slice(1).reduce((a, p, i) => a + Math.abs(p.y - pts[i].y), 0) / pts.length;

describe('stabilizer', () => {
  it('passes raw input through at 0 smoothing and ends at the last point', () => {
    const out = stabilizeAll(jitterLine(), { smoothing: 0, mode: 'average' });
    expect(out[0].x).toBe(0);
    expect(out.at(-1)!.x).toBeCloseTo(295);
  });
  it('reduces jitter as smoothing rises', () => {
    const raw = roughness(stabilizeAll(jitterLine(), { smoothing: 0, mode: 'average' }));
    const smooth = roughness(stabilizeAll(jitterLine(), { smoothing: 0.8, mode: 'average' }));
    expect(smooth).toBeLessThan(raw * 0.5);
  });
  it('pull-string ignores movement inside the radius', () => {
    const pts: InputPoint[] = [{ x: 0, y: 0, pressure: 0.5, t: 0, pointerType: 'pen' }, { x: 5, y: 0, pressure: 0.5, t: 10, pointerType: 'pen' }, { x: 100, y: 0, pressure: 0.5, t: 20, pointerType: 'pen' }];
    const out = stabilizeAll(pts, { smoothing: 1, mode: 'pull', pullRadius: 20 });
    expect(out.at(-1)!.x).toBeCloseTo(100);
    expect(out.every((p) => p.y === 0)).toBe(true);
  });
  it('simulates pressure from velocity for mice', () => {
    expect(simulatedPressure(0)).toBe(1);
    expect(simulatedPressure(4)).toBeLessThan(0.2 + 1e-9 + 0.2);
    const out = stabilizeAll([{ x: 0, y: 0, pressure: 0, t: 0, pointerType: 'mouse' }, { x: 200, y: 0, pressure: 0, t: 10, pointerType: 'mouse' }], { smoothing: 0, mode: 'average' });
    expect(out.at(-1)!.pressure).toBeLessThan(1);
  });
  it('catmull-rom interpolates endpoints exactly', () => {
    expect(catmullRom(0, 1, 2, 3, 0)).toBe(1);
    expect(catmullRom(0, 1, 2, 3, 1)).toBe(2);
  });
});
