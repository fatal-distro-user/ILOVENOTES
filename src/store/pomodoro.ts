import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PomodoroPhase = 'focus' | 'short' | 'long';

export interface PomodoroState {
  phase: PomodoroPhase;
  running: boolean;
  /** epoch ms when the current phase ends (while running) */
  endsAt: number | null;
  /** remaining ms when paused */
  remaining: number;
  completedFocus: number;
  durations: Record<PomodoroPhase, number>;
  longEvery: number;
  start(): void;
  pause(): void;
  reset(): void;
  skip(): void;
  /** Called by a ticker; advances phase when time runs out. Returns true if a phase completed. */
  tick(now?: number): boolean;
  setDuration(phase: PomodoroPhase, minutes: number): void;
}

const MIN = 60_000;

export const usePomodoro = create<PomodoroState>()(
  persist(
    (set, get) => ({
      phase: 'focus', running: false, endsAt: null, remaining: 25 * MIN, completedFocus: 0,
      durations: { focus: 25 * MIN, short: 5 * MIN, long: 15 * MIN }, longEvery: 4,
      start: () => { const s = get(); if (!s.running) set({ running: true, endsAt: Date.now() + s.remaining }); },
      pause: () => { const s = get(); if (s.running && s.endsAt) set({ running: false, remaining: Math.max(0, s.endsAt - Date.now()), endsAt: null }); },
      reset: () => { const s = get(); set({ running: false, endsAt: null, remaining: s.durations[s.phase] }); },
      skip: () => {
        const s = get();
        const next = nextPhase(s.phase, s.completedFocus, s.longEvery);
        set({ phase: next.phase, completedFocus: next.completed, remaining: s.durations[next.phase], endsAt: s.running ? Date.now() + s.durations[next.phase] : null });
      },
      tick: (now = Date.now()) => {
        const s = get();
        if (!s.running || !s.endsAt || now < s.endsAt) return false;
        const next = nextPhase(s.phase, s.completedFocus, s.longEvery);
        set({ phase: next.phase, completedFocus: next.completed, running: false, endsAt: null, remaining: s.durations[next.phase] });
        return true;
      },
      setDuration: (phase, minutes) => set((s) => {
        const durations = { ...s.durations, [phase]: Math.max(1, Math.min(180, minutes)) * MIN };
        return { durations, remaining: !s.running && s.phase === phase ? durations[phase] : s.remaining };
      }),
    }),
    { name: 'iln-pomodoro' },
  ),
);

export function nextPhase(phase: PomodoroPhase, completed: number, longEvery: number): { phase: PomodoroPhase; completed: number } {
  if (phase !== 'focus') return { phase: 'focus', completed };
  const c = completed + 1;
  return { phase: c % longEvery === 0 ? 'long' : 'short', completed: c };
}

export function pomodoroRemaining(s: Pick<PomodoroState, 'running' | 'endsAt' | 'remaining'>, now = Date.now()): number {
  return s.running && s.endsAt ? Math.max(0, s.endsAt - now) : s.remaining;
}
