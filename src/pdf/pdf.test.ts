import { describe, it, expect } from 'vitest';
import { mergeLineRects } from './annotations';

describe('pdf annotations', () => {
  it('merges selection rects into line rects', () => {
    const r = mergeLineRects([
      { x: 10, y: 100, w: 40, h: 12 }, { x: 52, y: 101, w: 30, h: 11 },
      { x: 10, y: 120, w: 60, h: 12 }, { x: 0, y: 0, w: 0.2, h: 0.2 },
    ]);
    expect(r).toEqual([[10, 100, 72, 12], [10, 120, 60, 12]]);
  });
});
