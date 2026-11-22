import { describe, expect, it } from 'vitest';
import { addDays, addMonths, bucketByDay, dayKey, formatDate, monthGrid, parseDate, sameMonth, startOfWeek, weekDays } from './calendarLogic';

describe('date math', () => {
  it('round-trips and adds days across boundaries', () => {
    expect(formatDate(parseDate('2026-03-08'))).toBe('2026-03-08');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(Number.isNaN(parseDate('nope').getTime())).toBe(true);
  });
  it('addMonths clamps the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-10');
  });
  it('week helpers honour weekStart', () => {
    expect(startOfWeek('2026-11-22', 1)).toBe('2026-11-16'); // Sunday -> previous Monday
    expect(startOfWeek('2026-11-22', 0)).toBe('2026-11-22');
    expect(weekDays('2026-11-18', 1)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  });
  it('monthGrid covers whole weeks including the month', () => {
    const g = monthGrid('2026-02-10', 1); // Feb 2026 starts on Sunday, 28 days
    expect(g.every((r) => r.length === 7)).toBe(true);
    expect(g[0][0]).toBe('2026-01-26');
    const flat = g.flat();
    expect(flat).toContain('2026-02-01');
    expect(flat).toContain('2026-02-28');
    expect(g.length).toBe(5);
    expect(monthGrid('2026-11-01', 1).length).toBe(6);
    expect(monthGrid('2027-05-10', 0).length).toBe(6);
  });
  it('sameMonth', () => { expect(sameMonth('2026-05-01', '2026-05-31')).toBe(true); expect(sameMonth('2026-05-01', '2026-06-01')).toBe(false); });
});

describe('bucketByDay', () => {
  const t = (s: string) => parseDate(s).getTime();
  const nodes = [
    { id: 'a', title: 'B note', icon: '', createdAt: t('2026-05-01'), updatedAt: t('2026-05-03') },
    { id: 'd', title: '2026-05-02', icon: '', dailyDate: '2026-05-02', createdAt: t('2026-05-02'), updatedAt: t('2026-05-02') },
  ];
  it('buckets by reason and dedupes', () => {
    const all = bucketByDay(nodes, { daily: true, created: true, updated: true });
    expect(all.get('2026-05-01')?.map((e) => e.node.id)).toEqual(['a']);
    expect(all.get('2026-05-02')).toHaveLength(1);
    expect(all.get('2026-05-02')?.[0].reasons).toEqual(['daily', 'created', 'updated']);
    expect(all.get('2026-05-03')?.[0].reasons).toEqual(['updated']);
    const dailyOnly = bucketByDay(nodes, { daily: true, created: false, updated: false });
    expect([...dailyOnly.keys()]).toEqual(['2026-05-02']);
  });
  it('dayKey is local', () => { expect(dayKey(t('2026-05-02'))).toBe('2026-05-02'); });
});
