/** Pure time-lapse timeline: orders strokes, compresses idle gaps and maps replay time to visible points. */
import type { Stroke } from '@/db/types';

export interface TLItem { stroke: Stroke; start: number; dur: number; /** replay-time offset of each point within the stroke */ times: number[]; npts: number }
export interface Timeline { items: TLItem[]; total: number }

export interface TimelineOptions { pause?: number; minDur?: number; maxDur?: number }

export function buildTimeline(strokes: Stroke[], opts: TimelineOptions = {}): Timeline {
  const pause = opts.pause ?? 120, minDur = opts.minDur ?? 160, maxDur = opts.maxDur ?? 3000;
  const sorted = strokes.filter((s) => s.points.length >= 4).slice().sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const items: TLItem[] = [];
  let cursor = 0;
  for (const stroke of sorted) {
    const n = Math.floor(stroke.points.length / 4);
    const raw: number[] = [];
    for (let i = 0; i < n; i++) raw.push(Math.max(0, stroke.points[i * 4 + 3] || 0));
    const first = raw[0];
    const span = raw[n - 1] - first;
    const dur = span > 0 ? Math.min(maxDur, Math.max(minDur, span)) : Math.min(maxDur, Math.max(minDur, 200 + n * 6));
    const monotonic = span > 0 && raw.every((v, i) => i === 0 || v >= raw[i - 1]);
    const times = raw.map((v, i) => (monotonic ? ((v - first) / span) * dur : n > 1 ? (i / (n - 1)) * dur : 0));
    items.push({ stroke, start: cursor, dur, times, npts: n });
    cursor += dur + pause;
  }
  return { items, total: items.length ? cursor - pause : 0 };
}

/** Number of points of `item` visible at replay time `t` (0 before start, npts when finished). */
export function visiblePoints(item: TLItem, t: number): number {
  const local = t - item.start;
  if (local < 0) return 0;
  if (local >= item.dur) return item.npts;
  let lo = 0, hi = item.npts - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (item.times[mid] <= local) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

/** Index of the first stroke not yet completed at `t`, and the count of visible points of that stroke. */
export function progressAt(tl: Timeline, t: number): { done: number; current: { index: number; count: number } | null } {
  let done = 0;
  while (done < tl.items.length && t >= tl.items[done].start + tl.items[done].dur) done++;
  const it = tl.items[done];
  if (!it || t < it.start) return { done, current: null };
  return { done, current: { index: done, count: visiblePoints(it, t) } };
}

/** Frame times for export: ~`fps` frames per second of replay time (scaled by speed), capped at `maxFrames`. */
export function sampleTimes(total: number, fps = 12, maxFrames = 300, speed = 1): { times: number[]; stepMs: number } {
  if (total <= 0) return { times: [0], stepMs: 1000 / fps };
  const natural = (1000 / fps) * speed;
  const stepMs = Math.max(natural, total / (maxFrames - 1));
  const times: number[] = [];
  for (let t = 0; t < total; t += stepMs) times.push(t);
  if (times.length >= maxFrames) times.length = maxFrames - 1;
  times.push(total);
  return { times, stepMs };
}
