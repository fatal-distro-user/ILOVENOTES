import { describe, it, expect } from 'vitest';
import { playbackOrder } from './model';

describe('animation playback order', () => {
  it('loops, ping-pongs and handles tiny counts', () => {
    expect(playbackOrder(4, 'loop')).toEqual([0, 1, 2, 3]);
    expect(playbackOrder(4, 'pingpong')).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playbackOrder(2, 'pingpong')).toEqual([0, 1]);
    expect(playbackOrder(3, 'once')).toEqual([0, 1, 2]);
  });
});
