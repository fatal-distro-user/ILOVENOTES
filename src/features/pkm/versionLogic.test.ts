import { describe, expect, it } from 'vitest';
import { collapseContext, diffStats, formatSize, lineDiff, nextAutoSnapshotAt, pruneAutoSnapshots } from './versionLogic';

describe('pruneAutoSnapshots', () => {
  const mk = (n: number, auto: boolean) => Array.from({ length: n }, (_, i) => ({ id: `${auto ? 'a' : 'n'}${i}`, createdAt: i + 1, auto }));
  it('keeps the newest N autos and every named snapshot', () => {
    const snaps = [...mk(60, true), ...mk(5, false)];
    const del = pruneAutoSnapshots(snaps, 50);
    expect(del).toHaveLength(10);
    expect(del.every((id) => id.startsWith('a'))).toBe(true);
    expect(del).toContain('a0');
    expect(del).not.toContain('a59');
  });
  it('does nothing under the limit', () => { expect(pruneAutoSnapshots(mk(3, true), 50)).toEqual([]); });
});

describe('nextAutoSnapshotAt', () => {
  it('waits for interval and quiet period', () => {
    expect(nextAutoSnapshotAt(0, 1000, 300_000, 15_000)).toBe(300_000);
    expect(nextAutoSnapshotAt(0, 400_000, 300_000, 15_000)).toBe(415_000);
  });
});

describe('lineDiff', () => {
  it('detects additions and removals', () => {
    const ops = lineDiff('a\nb\nc', 'a\nc\nd');
    expect(ops).toEqual([
      { type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'same', text: 'c' }, { type: 'add', text: 'd' },
    ]);
    expect(diffStats(ops)).toEqual({ added: 1, removed: 1 });
  });
  it('handles empty sides and identical text', () => {
    expect(lineDiff('', 'x')).toEqual([{ type: 'add', text: 'x' }]);
    expect(lineDiff('x', '')).toEqual([{ type: 'del', text: 'x' }]);
    expect(diffStats(lineDiff('same\nlines', 'same\nlines'))).toEqual({ added: 0, removed: 0 });
  });
  it('falls back for huge inputs', () => {
    const ops = lineDiff('a\nb\nc', 'x\ny\nz', 1);
    expect(diffStats(ops)).toEqual({ added: 3, removed: 3 });
  });
  it('collapses unchanged context', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const ops = lineDiff(lines.join('\n'), [...lines.slice(0, 10), 'CHANGED', ...lines.slice(11)].join('\n'));
    const c = collapseContext(ops, 2);
    expect(c.filter((o) => o.type === 'skip')).toHaveLength(2);
    expect(c.some((o) => o.type === 'add')).toBe(true);
    expect(collapseContext([{ type: 'same', text: 'a' }])).toEqual([{ type: 'skip', n: 1 }]);
  });
});

describe('formatSize', () => {
  it('formats units', () => {
    expect(formatSize(12)).toBe('12 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
