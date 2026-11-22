import { describe, expect, it } from 'vitest';
import type { Stroke } from '@/db/types';
import { buildTimeline, progressAt, sampleTimes, visiblePoints } from './timelapseLogic';

const stroke = (id: string, createdAt: number, ts: number[]): Stroke => ({
  id, pageId: 'p', color: '#000', width: 4, opacity: 1, tool: 'pen', createdAt,
  points: ts.flatMap((t, i) => [i * 10, i * 5, 0.5, t]),
});

describe('buildTimeline', () => {
  it('orders by createdAt, uses point timestamps, and compresses gaps', () => {
    const tl = buildTimeline([stroke('b', 5000, [0, 100, 400]), stroke('a', 1000, [0, 200, 500, 800])]);
    expect(tl.items.map((i) => i.stroke.id)).toEqual(['a', 'b']);
    expect(tl.items[0].dur).toBe(800);
    expect(tl.items[1].start).toBe(800 + 120);
    expect(tl.total).toBe(800 + 120 + 400);
  });
  it('clamps long strokes and synthesises timing when timestamps are missing', () => {
    const tl = buildTimeline([stroke('a', 1, [0, 10_000]), stroke('b', 2, [0, 0, 0, 0])]);
    expect(tl.items[0].dur).toBe(3000);
    expect(tl.items[1].dur).toBe(200 + 4 * 6);
    expect(tl.items[1].times[3]).toBeCloseTo(tl.items[1].dur);
  });
  it('ignores degenerate strokes', () => {
    expect(buildTimeline([{ ...stroke('x', 1, [0]), points: [1, 2] }]).total).toBe(0);
  });
});

describe('visiblePoints / progressAt', () => {
  const tl = buildTimeline([stroke('a', 1, [0, 100, 200, 300]), stroke('b', 2, [0, 100, 200])]);
  it('maps time to visible points', () => {
    const [a] = tl.items;
    expect(visiblePoints(a, -1)).toBe(0);
    expect(visiblePoints(a, 0)).toBe(1);
    expect(visiblePoints(a, 150)).toBe(2);
    expect(visiblePoints(a, 10_000)).toBe(4);
  });
  it('reports finished strokes and the active one', () => {
    expect(progressAt(tl, 0)).toEqual({ done: 0, current: { index: 0, count: 1 } });
    expect(progressAt(tl, 310)).toEqual({ done: 1, current: null });
    expect(progressAt(tl, 540).current).toEqual({ index: 1, count: 2 });
    expect(progressAt(tl, tl.total + 1)).toEqual({ done: 2, current: null });
  });
});

describe('sampleTimes', () => {
  it('samples ~12fps and caps at maxFrames', () => {
    const a = sampleTimes(2000, 12, 300);
    expect(a.times[0]).toBe(0);
    expect(a.times.at(-1)).toBe(2000);
    expect(a.times.length).toBeGreaterThan(20);
    const b = sampleTimes(600_000, 12, 300);
    expect(b.times.length).toBeLessThanOrEqual(300);
    expect(sampleTimes(0).times).toEqual([0]);
  });
});
