/** Pure calendar date math (local time, YYYY-MM-DD keys). */

const p2 = (n: number) => String(n).padStart(2, '0');

export function formatDate(d: Date): string { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }

/** Parse YYYY-MM-DD as a local-time date at noon (DST-safe arithmetic). */
export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], 12);
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

export function addMonths(s: string, n: number): string {
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return formatDate(d);
}

export function dayKey(ts: number): string { return formatDate(new Date(ts)); }

/** First day of the week (weekStart 0 = Sunday, 1 = Monday) containing `s`. */
export function startOfWeek(s: string, weekStart = 1): string {
  const d = parseDate(s);
  const diff = (d.getDay() - weekStart + 7) % 7;
  return addDays(s, -diff);
}

export function weekDays(s: string, weekStart = 1): string[] {
  const start = startOfWeek(s, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Weeks (rows of 7 date keys) covering the month of `s`. Always whole weeks; 4-6 rows. */
export function monthGrid(s: string, weekStart = 1): string[][] {
  const d = parseDate(s);
  const first = formatDate(new Date(d.getFullYear(), d.getMonth(), 1, 12));
  const last = formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  const start = startOfWeek(first, weekStart);
  const rows: string[][] = [];
  let cur = start;
  while (cur <= last || rows.length < 4) {
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
    cur = addDays(cur, 7);
    if (cur > last) break;
  }
  return rows;
}

export function sameMonth(a: string, b: string): boolean { return a.slice(0, 7) === b.slice(0, 7); }

export interface DayNode { id: string; title: string; icon: string; dailyDate?: string; createdAt: number; updatedAt: number }
export type DayReason = 'daily' | 'created' | 'updated';
export interface DayEntry<T extends DayNode = DayNode> { node: T; reasons: DayReason[] }

/** Bucket pages into days. A page can appear on several days (daily date, created, last updated). */
export function bucketByDay<T extends DayNode>(nodes: T[], show: { daily: boolean; created: boolean; updated: boolean }): Map<string, DayEntry<T>[]> {
  const out = new Map<string, Map<string, DayEntry<T>>>();
  const put = (day: string, node: T, reason: DayReason) => {
    let m = out.get(day);
    if (!m) { m = new Map(); out.set(day, m); }
    const e = m.get(node.id);
    if (e) { if (!e.reasons.includes(reason)) e.reasons.push(reason); } else m.set(node.id, { node, reasons: [reason] });
  };
  for (const n of nodes) {
    if (show.daily && n.dailyDate) put(n.dailyDate, n, 'daily');
    if (show.created) put(dayKey(n.createdAt), n, 'created');
    if (show.updated) put(dayKey(n.updatedAt), n, 'updated');
  }
  const res = new Map<string, DayEntry<T>[]>();
  for (const [day, m] of out) {
    res.set(day, Array.from(m.values()).sort((a, b) => (a.reasons.includes('daily') ? 0 : 1) - (b.reasons.includes('daily') ? 0 : 1) || a.node.title.localeCompare(b.node.title)));
  }
  return res;
}

export function monthTitle(s: string, locale?: string): string {
  return parseDate(s).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
export function weekTitle(s: string, locale?: string, weekStart = 1): string {
  const days = weekDays(s, weekStart);
  const f = (d: string, o: Intl.DateTimeFormatOptions) => parseDate(d).toLocaleDateString(locale, o);
  return `${f(days[0], { month: 'short', day: 'numeric' })} – ${f(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
