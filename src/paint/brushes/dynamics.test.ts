import { describe, it, expect } from 'vitest';
import { computeDabs, DabGenerator, strokeLength } from './dynamics';
import { BUILTIN_BRUSHES, brushById } from './presets';
import type { StrokePoint } from '../stabilizer';

const line = (len: number, pressure = 1): StrokePoint[] =>
  Array.from({ length: len + 1 }, (_, i) => ({ x: i, y: 0, pressure, t: i, tiltX: 0, tiltY: 0, velocity: 0.2 }));

describe('brush dynamics', () => {
  const pen = { ...brushById('fineliner'), size: 10, spacing: 0.1, sizeJitter: 0, scatter: 0, taperStart: 0, taperEnd: 0 };
  it('spaces dabs by spacing × size', () => {
    const dabs = computeDabs(line(100), pen, 1);
    expect(dabs.length).toBeGreaterThanOrEqual(100);
    expect(dabs.length).toBeLessThanOrEqual(102);
    const gaps = dabs.slice(1).map((d, i) => d.x - dabs[i].x);
    for (const g of gaps) expect(g).toBeCloseTo(1, 5);
  });
  it('is incremental-consistent with batch computation (no taper end)', () => {
    const pts = line(60);
    const g = new DabGenerator(pen, { seed: 3 });
    const inc = [...g.push(pts.slice(0, 20)), ...g.push(pts.slice(20))];
    const batch = new DabGenerator(pen, { seed: 3 }).push(pts);
    expect(inc.map((d) => d.x.toFixed(3))).toEqual(batch.map((d) => d.x.toFixed(3)));
    expect(g.distance).toBeCloseTo(60);
  });
  it('pressure scales size', () => {
    const soft = computeDabs(line(20, 0.1), { ...pen, pressureSize: 1, minSize: 0.2 }, 1);
    const hard = computeDabs(line(20, 1), { ...pen, pressureSize: 1, minSize: 0.2 }, 1);
    expect(soft[5].size).toBeLessThan(hard[5].size * 0.5);
  });
  it('tapers both ends', () => {
    const dabs = computeDabs(line(200), { ...pen, taperStart: 40, taperEnd: 40 }, 1);
    const mid = dabs[Math.floor(dabs.length / 2)].size;
    expect(dabs[0].size).toBeLessThan(mid * 0.2);
    expect(dabs.at(-1)!.size).toBeLessThan(mid * 0.35);
  });
  it('pixel brush snaps to the grid with 1px spacing', () => {
    const dabs = computeDabs(line(10), { ...brushById('pixel'), size: 1 }, 1);
    expect(dabs.every((d) => d.x % 1 === 0.5 && d.size === 1)).toBe(true);
  });
  it('deterministic jitter per seed', () => {
    const b = { ...brushById('charcoal') };
    expect(computeDabs(line(50), b, 7).map((d) => d.x)).toEqual(computeDabs(line(50), b, 7).map((d) => d.x));
    expect(computeDabs(line(50), b, 7).map((d) => d.x)).not.toEqual(computeDabs(line(50), b, 8).map((d) => d.x));
  });
  it('has all built-in presets with unique ids', () => {
    const ids = BUILTIN_BRUSHES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const want of ['fineliner', 'fountain', 'pencil', 'charcoal', 'marker', 'highlighter', 'watercolor', 'oil', 'airbrush', 'pixel', 'smudge', 'blur', 'sharpen', 'clone', 'heal', 'eraser-soft', 'eraser-hard']) expect(ids).toContain(want);
    expect(strokeLength([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5);
  });
});
