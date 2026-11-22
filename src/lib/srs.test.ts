import { describe, it, expect } from 'vitest';
import { review, NEW_CARD, previewInterval, isDue } from './srs';

describe('srs', () => {
  it('schedules SM-2 intervals and lapses', () => {
    const t = 0;
    let s = review(NEW_CARD, 'good', t);
    expect(s.interval).toBe(1);
    s = review(s, 'good', t);
    expect(s.interval).toBe(6);
    s = review(s, 'good', t);
    expect(s.interval).toBe(15);
    const lapsed = review(s, 'again', t);
    expect(lapsed.reps).toBe(0);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.ease).toBeLessThan(s.ease);
    expect(previewInterval(NEW_CARD, 'again', t)).toBe('10m');
    expect(previewInterval(NEW_CARD, 'easy', t)).toBe('4d');
    expect(isDue(undefined)).toBe(true);
  });
});
