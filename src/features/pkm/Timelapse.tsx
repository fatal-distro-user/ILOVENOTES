import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import clsx from 'clsx';
import { Download, Film, Pause, Play, RotateCcw } from 'lucide-react';
import { db } from '@/db/schema';
import type { Stroke } from '@/db/types';
import { getSetting } from '@/db/repo';
import { outlineFor, outlineToPath, strokeBounds, strokeRenderData } from '@/canvas/ink';
import { encodeGif, type GifFrame } from '@/export/gif';
import { saveFile } from '@/platform/fileio';
import { toast } from '@/store/status';
import { Modal, Button } from '@/ui/Modal';
import { buildTimeline, progressAt, sampleTimes, type Timeline } from './timelapseLogic';

interface TimelapseState { pageId: string | null; open(pageId: string): void; close(): void }
export const useTimelapse = create<TimelapseState>()((set) => ({ pageId: null, open: (pageId) => set({ pageId }), close: () => set({ pageId: null }) }));

export function TimelapseOverlay() {
  const pageId = useTimelapse((s) => s.pageId);
  return pageId ? <TimelapseModal key={pageId} pageId={pageId} /> : null;
}

const SPEEDS = [1, 2, 5, 10] as const;
const W = 960, H = 540;

interface View { x: number; y: number; k: number }

function fitView(strokes: Stroke[], w: number, h: number): View {
  if (!strokes.length) return { x: 0, y: 0, k: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) { const b = strokeBounds(s.points, s.width); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  const pad = 40;
  const k = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0), 4);
  return { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
}

/** Draw replay state at time `t` onto ctx (logical size w×h). */
function renderFrame(ctx: CanvasRenderingContext2D, w: number, h: number, tl: Timeline, t: number, view: View, bg: string, scale = 1): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(view.k * scale, 0, 0, view.k * scale, view.x * scale, view.y * scale);
  const { done, current } = progressAt(tl, t);
  for (let i = 0; i < done; i++) {
    const s = tl.items[i].stroke;
    ctx.globalAlpha = s.opacity;
    ctx.globalCompositeOperation = s.tool === 'highlighter' ? 'multiply' : 'source-over';
    ctx.fillStyle = s.color;
    ctx.fill(strokeRenderData(s).path);
  }
  if (current) {
    const s = tl.items[current.index].stroke;
    ctx.globalAlpha = s.opacity;
    ctx.globalCompositeOperation = s.tool === 'highlighter' ? 'multiply' : 'source-over';
    ctx.fillStyle = s.color;
    ctx.fill(outlineToPath(outlineFor(s.points.slice(0, current.count * 4), s.tool, s.width, current.count >= tl.items[current.index].npts)));
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function TimelapseModal({ pageId }: { pageId: string }) {
  const close = useTimelapse((s) => s.close);
  const [strokes, setStrokes] = useState<Stroke[] | null>(null);
  const [bg, setBg] = useState('#ffffff');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [busy, setBusy] = useState<null | 'gif' | 'webm'>(null);
  const [exportPct, setExportPct] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    let live = true;
    void (async () => {
      const [list, settings] = await Promise.all([
        db.strokes.where('pageId').equals(pageId).filter((s) => !s.pdfId).toArray(),
        getSetting<{ bgColor: string | null }>(`canvas-settings:${pageId}`, { bgColor: null }),
      ]);
      if (!live) return;
      const css = getComputedStyle(document.documentElement).getPropertyValue('--iln-bg').trim();
      setBg(settings.bgColor || css || '#ffffff');
      setStrokes(list);
    })();
    return () => { live = false; };
  }, [pageId]);

  const tl = useMemo(() => buildTimeline(strokes ?? []), [strokes]);
  const view = useMemo(() => fitView(tl.items.map((i) => i.stroke), W, H), [tl]);

  const draw = useCallback((t: number) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) renderFrame(ctx, W, H, tl, t, view, bg);
  }, [tl, view, bg]);

  const seek = useCallback((t: number) => { timeRef.current = t; setTime(t); draw(t); }, [draw]);
  useEffect(() => { seek(Math.min(timeRef.current, tl.total)); }, [seek, tl.total]);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      const t = Math.min(tl.total, timeRef.current + dt * speedRef.current);
      timeRef.current = t;
      setTime(t);
      draw(t);
      if (t >= tl.total) { setPlaying(false); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, tl.total, draw]);

  const togglePlay = () => {
    if (!tl.total) return;
    if (!playing && timeRef.current >= tl.total) seek(0);
    setPlaying((p) => !p);
  };

  const exportGif = async () => {
    if (!tl.total || busy) return;
    setPlaying(false); setBusy('gif'); setExportPct(0);
    try {
      const scale = Math.min(1, 640 / W);
      const ow = Math.round(W * scale), oh = Math.round(H * scale);
      const off = document.createElement('canvas');
      off.width = ow; off.height = oh;
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) throw new Error('Canvas is not available');
      const { times, stepMs } = sampleTimes(tl.total, 12, 300, speed);
      const frames: GifFrame[] = [];
      for (let i = 0; i < times.length; i++) {
        renderFrame(octx, W, H, tl, times[i], view, bg, scale);
        const img = octx.getImageData(0, 0, ow, oh);
        frames.push({ data: img.data, width: ow, height: oh, delayMs: i === times.length - 1 ? 1200 : Math.round(stepMs / speed) });
        if (i % 10 === 9) { setExportPct(Math.round((i / times.length) * 50)); await new Promise((r) => setTimeout(r, 0)); }
      }
      const bytes = await encodeGif(frames, { loop: true, onProgress: (d, n) => setExportPct(50 + Math.round((d / n) * 50)) });
      const saved = await saveFile(bytes, 'timelapse.gif', [{ name: 'GIF image', extensions: ['gif'] }]);
      if (saved) toast(`Saved ${saved}`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'GIF export failed', 'error'); }
    finally { setBusy(null); draw(timeRef.current); }
  };

  const exportWebm = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !tl.total || busy) return;
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) { toast('WebM recording is not supported in this browser', 'error'); return; }
    setPlaying(false); setBusy('webm'); setExportPct(0);
    try {
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) throw new Error('WebM recording is not supported in this browser');
      const stream = canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
      seek(0);
      rec.start(250);
      await new Promise<void>((resolve) => {
        const t0 = performance.now();
        const tick = (now: number) => {
          const t = Math.min(tl.total, (now - t0) * speedRef.current);
          timeRef.current = t; setTime(t); draw(t);
          setExportPct(Math.round((t / tl.total) * 100));
          if (t >= tl.total) resolve(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await new Promise((r) => setTimeout(r, 500));
      rec.stop();
      await stopped;
      stream.getTracks().forEach((tr) => tr.stop());
      const saved = await saveFile(new Blob(chunks, { type: 'video/webm' }), 'timelapse.webm', [{ name: 'WebM video', extensions: ['webm'] }]);
      if (saved) toast(`Saved ${saved}`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'WebM export failed', 'error'); }
    finally { setBusy(null); }
  };

  const empty = strokes !== null && tl.items.length === 0;

  return (
    <Modal title="Time-lapse" onClose={close} width={1000} testId="timelapse">
      <div data-testid="timelapse-state" data-playing={playing} data-time={Math.round(time)} data-total={Math.round(tl.total)} data-strokes={tl.items.length} className="space-y-3">
        <div className="relative overflow-hidden rounded-lg border border-line" style={{ background: bg }}>
          <canvas ref={canvasRef} width={W} height={H} className="mx-auto block" style={{ width: 'min(100%, calc(44vh * 16 / 9))', height: 'auto' }} data-testid="timelapse-canvas" />
          {empty && <div className="absolute inset-0 flex items-center justify-center text-fg-muted">This page has no ink strokes to replay.</div>}
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={togglePlay} disabled={empty || !!busy} data-testid="timelapse-play" aria-label={playing ? 'Pause' : 'Play'} className="w-20">{playing ? <><Pause size={13} />Pause</> : <><Play size={13} />Play</>}</Button>
          <Button onClick={() => { setPlaying(false); seek(0); }} disabled={empty || !!busy} aria-label="Restart" data-testid="timelapse-restart"><RotateCcw size={13} /></Button>
          <input type="range" min={0} max={Math.max(1, Math.round(tl.total))} value={Math.round(time)} onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} disabled={empty || !!busy} aria-label="Scrub" data-testid="timelapse-scrub" className="flex-1 accent-[var(--iln-accent)]" />
          <span className="w-24 text-right text-[12px] tabular-nums text-fg-muted" data-testid="timelapse-time">{fmt(time)} / {fmt(tl.total)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-fg-muted">Speed</span>
          <div role="radiogroup" aria-label="Speed" className="inline-flex rounded-md border border-line bg-bg-2 p-0.5">
            {SPEEDS.map((s) => (
              <button key={s} role="radio" aria-checked={speed === s} data-testid={`timelapse-speed-${s}`} onClick={() => setSpeed(s)}
                className={clsx('h-6 rounded px-2.5 text-[12px]', speed === s ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg')}>{s}×</button>
            ))}
          </div>
          <span className="text-[12px] text-fg-faint">{tl.items.length} stroke{tl.items.length === 1 ? '' : 's'} · fit to content</span>
          <div className="flex-1" />
          {busy && <span className="text-[12px] text-fg-muted" data-testid="timelapse-progress">Exporting {busy.toUpperCase()} {exportPct}%</span>}
          <Button onClick={() => void exportGif()} disabled={empty || !!busy} data-testid="timelapse-export-gif"><Download size={13} />GIF</Button>
          <Button onClick={() => void exportWebm()} disabled={empty || !!busy} data-testid="timelapse-export-webm"><Film size={13} />WebM</Button>
        </div>
      </div>
    </Modal>
  );
}
