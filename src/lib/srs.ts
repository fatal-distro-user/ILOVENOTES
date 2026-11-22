/** SM-2 spaced repetition scheduling (SuperMemo 2 with Anki-style "again/hard/good/easy" grades). */

export type Grade = 'again' | 'hard' | 'good' | 'easy';
export interface SrsState { ease: number; interval: number; reps: number; lapses: number; due: number; last: number }

const DAY = 86_400_000;
export const NEW_CARD: SrsState = { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, last: 0 };

const Q: Record<Grade, number> = { again: 1, hard: 3, good: 4, easy: 5 };

export function review(state: SrsState, grade: Grade, now = Date.now()): SrsState {
  const q = Q[grade];
  let { ease, interval, reps, lapses } = state;
  if (q < 3) {
    reps = 0;
    lapses += 1;
    interval = 0; // relearn: due again in 10 minutes
    ease = Math.max(1.3, ease - 0.2);
    return { ease, interval, reps, lapses, due: now + 10 * 60_000, last: now };
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  reps += 1;
  if (reps === 1) interval = grade === 'easy' ? 4 : 1;
  else if (reps === 2) interval = grade === 'hard' ? 3 : 6;
  else interval = Math.round(interval * (grade === 'hard' ? 1.2 : grade === 'easy' ? ease * 1.3 : ease));
  interval = Math.max(1, interval);
  return { ease, interval, reps, lapses, due: now + interval * DAY, last: now };
}

/** Human label for the next interval if `grade` were chosen ("10m", "1d", "2mo"). */
export function previewInterval(state: SrsState, grade: Grade, now = Date.now()): string {
  const next = review(state, grade, now);
  const ms = next.due - now;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const d = ms / DAY;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

export function isDue(state: SrsState | undefined, now = Date.now()): boolean { return !state || state.due <= now; }
