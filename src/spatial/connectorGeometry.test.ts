import { describe, it, expect } from 'vitest';
import { portPoint, facingSide, routePath, polylineDistance } from './connectorGeometry';

const box = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
describe('connector geometry', () => {
  it('ports and facing sides', () => {
    expect(portPoint(box, 'e')).toEqual({ x: 100, y: 25 });
    expect(portPoint(box, 'n')).toEqual({ x: 50, y: 0 });
    expect(facingSide(box, { x: 400, y: 30 })).toBe('e');
    expect(facingSide(box, { x: 50, y: -200 })).toBe('n');
  });
  it('routes', () => {
    const a = { point: { x: 100, y: 25 }, side: 'e' as const }, b = { point: { x: 300, y: 125 }, side: 'w' as const };
    const o = routePath('orthogonal', a, b);
    expect(o.points[0]).toEqual(a.point);
    expect(o.points.at(-1)).toEqual(b.point);
    // every orthogonal segment is axis-aligned
    for (let i = 1; i < o.points.length; i++) expect(o.points[i].x === o.points[i - 1].x || o.points[i].y === o.points[i - 1].y).toBe(true);
    const c = routePath('curved', a, b);
    expect(c.d.startsWith('M100,25 C')).toBe(true);
    expect(polylineDistance(routePath('straight', a, b).points, { x: 200, y: 75 })).toBeLessThan(0.001);
  });
});
