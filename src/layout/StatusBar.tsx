import { useEffect, useState } from 'react';
import { Check, Focus, Palette, Pause, Play, RotateCcw, SkipForward, StickyNote, Timer } from 'lucide-react';
import clsx from 'clsx';
import { useStatus } from '@/store/status';
import { useLayout, THEMES } from '@/store/layout';
import { usePomodoro, pomodoroRemaining, type PomodoroPhase } from '@/store/pomodoro';
import { IconButton } from '@/ui/IconButton';
import { Popover } from '@/ui/Popover';
import { Button } from '@/ui/Modal';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

const PHASE_LABEL: Record<PomodoroPhase, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };

export function ToastText() {
  const message = useStatus((s) => s.message);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(t);
  }, [message]);
  if (!message || !visible) return null;
  return (
    <span
      data-testid="toast"
      className={clsx('truncate rounded px-1.5', message.kind === 'error' ? 'bg-danger/20 text-danger' : message.kind === 'ok' ? 'text-ok' : 'text-fg')}
    >{message.text}</span>
  );
}

/** Mounted once for the app lifetime so phases complete even when the status bar is hidden (zen). */
export function PomodoroTicker() {
  useEffect(() => {
    const id = window.setInterval(() => {
      const before = usePomodoro.getState().phase;
      if (!usePomodoro.getState().tick()) return;
      const text = before === 'focus' ? 'Focus session complete. Time for a break.' : 'Break over. Back to focus.';
      useStatus.getState().toast(text, 'ok');
      beep();
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification('ILOVENOTES', { body: text }); } catch { /* notifications can be blocked at the OS level */ }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  return null;
}

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.3].forEach((at) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.25);
    });
    window.setTimeout(() => void ctx.close(), 900);
  } catch { /* audio may be unavailable before a user gesture */ }
}

function PomodoroWidget() {
  const p = usePomodoro();
  const [, force] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => { const id = window.setInterval(() => force((n) => n + 1), 1000); return () => window.clearInterval(id); }, []);
  const ms = pomodoroRemaining(p);
  const total = Math.ceil(ms / 1000);
  const mmss = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return (
    <div className="flex items-center gap-0.5" data-testid="pomodoro">
      <button
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        title="Pomodoro settings"
        className={clsx('flex h-[18px] items-center gap-1 rounded px-1.5 hover:bg-bg-3', p.running ? 'text-accent' : 'text-fg-muted')}
      >
        <Timer size={12} />
        <span>{PHASE_LABEL[p.phase]}</span>
        <span className="tabular-nums" data-testid="pomodoro-time">{mmss}</span>
      </button>
      <IconButton size="sm" title={p.running ? 'Pause' : 'Start'} onClick={() => (p.running ? p.pause() : p.start())} data-testid="pomodoro-toggle">{p.running ? <Pause size={12} /> : <Play size={12} />}</IconButton>
      <IconButton size="sm" title="Reset" onClick={() => p.reset()}><RotateCcw size={12} /></IconButton>
      <IconButton size="sm" title="Skip to next phase" onClick={() => p.skip()}><SkipForward size={12} /></IconButton>
      {anchor && (
        <Popover anchor={anchor} side="top" align="end" onClose={() => setAnchor(null)} className="w-[230px] p-3">
          <div className="mb-2 text-[12px] font-semibold">Pomodoro durations (minutes)</div>
          {(['focus', 'short', 'long'] as PomodoroPhase[]).map((ph) => (
            <label key={ph} className="mb-1.5 flex items-center justify-between text-[12px] text-fg-muted">
              {PHASE_LABEL[ph]}
              <input
                type="number" min={1} max={180} value={Math.round(p.durations[ph] / 60000)}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 1) p.setDuration(ph, v); }}
                className="h-6 w-16 rounded border border-line bg-bg-2 px-1.5 text-right text-fg outline-none focus:border-accent"
              />
            </label>
          ))}
          <div className="mt-1 text-[11px] text-fg-faint">Completed focus sessions: {p.completedFocus}</div>
          {typeof Notification !== 'undefined' && Notification.permission !== 'granted' && (
            <Button className="mt-2 w-full" onClick={() => void Notification.requestPermission()}>Enable notifications</Button>
          )}
        </Popover>
      )}
    </div>
  );
}

function ThemeSwitch() {
  const theme = useLayout((s) => s.theme);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton size="sm" title="Theme" data-testid="theme-switch" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}><Palette size={12} /></IconButton>
      {anchor && (
        <Popover anchor={anchor} side="top" align="end" onClose={() => setAnchor(null)} className="min-w-[170px] py-1">
          {THEMES.map((t) => (
            <button
              key={t.id}
              data-testid={`theme-option-${t.id}`}
              onClick={() => { useLayout.getState().setTheme(t.id); setAnchor(null); }}
              className="flex h-7 w-full items-center gap-2 px-3 text-left hover:bg-bg-3"
            >
              <span className="w-3.5">{theme === t.id && <Check size={13} />}</span>{t.label}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

export function StatusBar() {
  const s = useStatus();
  const scratch = useLayout((l) => l.scratchpadOpen);
  const zen = useLayout((l) => l.zen);
  const items: string[] = [];
  if (s.words !== null) items.push(`${s.words} words`);
  if (s.chars !== null) items.push(`${s.chars} chars`);
  if (s.strokes !== null) items.push(`${s.strokes} strokes`);
  if (s.layers !== null) items.push(`${s.layers} layers${s.layerMemory !== null ? ` · ${formatBytes(s.layerMemory)}` : ''}`);
  if (s.zoom !== null) items.push(`${Math.round(s.zoom * 100)}%`);
  if (s.cursor) items.push(`${Math.round(s.cursor.x)}, ${Math.round(s.cursor.y)}`);
  return (
    <footer className="flex h-[22px] shrink-0 items-center justify-between gap-3 border-t border-line bg-bg-1 px-2 text-[11.5px] text-fg-muted" data-testid="status-bar">
      <div className="flex min-w-0 items-center gap-3">
        <ToastText />
        {items.map((t) => <span key={t} className="shrink-0 tabular-nums">{t}</span>)}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <PomodoroWidget />
        <IconButton size="sm" title="Scratchpad" shortcut="Mod+Shift+Space" active={scratch} data-testid="scratchpad-toggle" onClick={() => useLayout.getState().toggleScratchpad()}><StickyNote size={12} /></IconButton>
        <IconButton size="sm" title="Zen mode" shortcut="Mod+Shift+F" active={zen} data-testid="zen-toggle" onClick={() => useLayout.getState().toggleZen()}><Focus size={12} /></IconButton>
        <ThemeSwitch />
      </div>
    </footer>
  );
}
