import { describe, it, expect } from 'vitest';
import { tilesForRect, tileRect, allTiles, isTransparent } from './tiles';

describe('tiles', () => {
  it('finds touched tiles and clips to the doc', () => {
    expect(tilesForRect({ x: 250, y: 10, w: 20, h: 10 }, 1000, 600)).toEqual(['0,0', '1,0']);
    expect(tilesForRect({ x: -50, y: -50, w: 60, h: 60 }, 1000, 600)).toEqual(['0,0']);
    expect(tilesForRect({ x: 990, y: 590, w: 100, h: 100 }, 1000, 600)).toEqual(['3,2']);
    expect(allTiles(512, 300)).toEqual(['0,0', '1,0', '0,1', '1,1']);
    expect(tileRect(3, 2, 1000, 600)).toEqual({ x: 768, y: 512, w: 232, h: 88 });
    expect(isTransparent(new Uint8ClampedArray(8))).toBe(true);
  });
});
