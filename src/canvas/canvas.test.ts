import { describe, it, expect } from 'vitest';
import { toScreen, toWorld, zoomAt, fitRect, rotatedBounds, pointInRotatedRect, clampZoom } from './camera';
import { smartSnap, align, distribute, snapToGrid } from './snapping';

describe('camera', () => {
  it('round-trips world/screen and zooms around an anchor', () => {
    const c = { x: 100, y: 50, zoom: 2 };
    const w = { x: 130, y: 70 };
    expect(toWorld(c, toScreen(c, w))).toEqual(w);
    const z = zoomAt(c, 4, { x: 60, y: 40 });
    expect(toWorld(z, { x: 60, y: 40 })).toEqual(toWorld(c, { x: 60, y: 40 }));
    expect(clampZoom(100)).toBe(8);
    expect(clampZoom(0.01)).toBe(0.1);
  });
  it('fits a rect', () => {
    const c = fitRect({ x: 0, y: 0, w: 1000, h: 500 }, 600, 400, 50, 4);
    expect(c.zoom).toBeCloseTo(0.5);
    expect(toScreen(c, { x: 500, y: 250 })).toEqual({ x: 300, y: 200 });
  });
  it('rotated bounds and hit test', () => {
    const b = rotatedBounds({ x: 0, y: 0, w: 100, h: 0.0001 }, Math.PI / 2);
    expect(b.h).toBeCloseTo(100);
    expect(pointInRotatedRect({ x: 50, y: 50 }, { x: 0, y: 40, w: 100, h: 20 }, Math.PI / 2)).toBe(true);
    expect(pointInRotatedRect({ x: 5, y: 50 }, { x: 0, y: 40, w: 100, h: 20 }, Math.PI / 2)).toBe(false);
  });
});

describe('snapping & alignment', () => {
  it('snaps edges to nearby objects and returns guides', () => {
    const r = smartSnap({ x: 103, y: 300, w: 50, h: 50 }, [{ x: 100, y: 0, w: 80, h: 40 }], 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides[0]).toMatchObject({ axis: 'x', pos: 100 });
    expect(snapToGrid(37, 20)).toBe(40);
  });
  it('aligns and distributes', () => {
    const rs = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 20, w: 20, h: 10 }, { x: 200, y: 5, w: 10, h: 10 }];
    expect(align(rs, 'right').map((p) => p.x)).toEqual([200, 190, 200]);
    expect(align(rs, 'top').map((p) => p.y)).toEqual([0, 0, 0]);
    const d = distribute(rs, 'x');
    expect(d[1].x).toBeCloseTo(95);
  });
});

import { resizeRect, resizeRotated, mapRect, rotateObjectAround, snapAngle } from './transform';
import type { CanvasObject } from '@/db/types';

describe('transforms', () => {
  const obj = (p: Partial<CanvasObject>): CanvasObject => ({ id: 'a', pageId: 'p', type: 'shape', x: 0, y: 0, w: 100, h: 50, rotation: 0, z: 1, locked: false, groupId: null, data: {}, createdAt: 0, updatedAt: 0, ...p });
  it('resizes from corners and edges, with aspect lock', () => {
    expect(resizeRect({ x: 0, y: 0, w: 100, h: 50 }, 'se', { x: 150, y: 80 }, false)).toEqual({ x: 0, y: 0, w: 150, h: 80 });
    expect(resizeRect({ x: 0, y: 0, w: 100, h: 50 }, 'nw', { x: -50, y: -50 }, false)).toEqual({ x: -50, y: -50, w: 150, h: 100 });
    const k = resizeRect({ x: 0, y: 0, w: 100, h: 50 }, 'se', { x: 200, y: 60 }, true);
    expect(k.w / k.h).toBeCloseTo(2);
    expect(resizeRect({ x: 0, y: 0, w: 100, h: 50 }, 'e', { x: -10, y: 0 }, false).w).toBe(10);
  });
  it('resizing an unrotated object via the rotated path matches plain resize', () => {
    expect(resizeRotated(obj({}), 'se', { x: 120, y: 70 }, false, { w: 4, h: 4 })).toEqual({ x: 0, y: 0, w: 120, h: 70 });
  });
  it('keeps the opposite corner fixed for rotated objects', () => {
    const o = obj({ rotation: Math.PI / 2 });
    const r = resizeRotated(o, 'e', { x: 50, y: 100 }, false, { w: 4, h: 4 });
    expect(r.w).toBeCloseTo(125);
  });
  it('maps rects between frames and rotates around a centre', () => {
    expect(mapRect({ x: 10, y: 10, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 200, h: 50 })).toEqual({ x: 20, y: 5, w: 20, h: 5 });
    const r = rotateObjectAround(obj({ x: 100, y: 0, w: 10, h: 10 }), { x: 5, y: 5 }, Math.PI);
    expect(r.x).toBeCloseTo(-100);
    expect(snapAngle(0.27)).toBeCloseTo(Math.PI / 12);
  });
});
