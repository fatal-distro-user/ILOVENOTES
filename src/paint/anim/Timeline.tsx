import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import clsx from 'clsx';
import { Play, Pause, SkipBack, SkipForward, Plus, Copy, Trash2, Pin, PinOff, Download, Film, Grid3x3, X, Minus } from 'lucide-react';
import { usePaintStudio } from '../studio/store';
import { useDocVersion } from '../studio/LayersPanel';
import { registerPaintOverlay } from '../studio/tools';
import { makeCanvas, ctx2d, type PaintDocument } from '../engine/document';
import { animSettings, frames, holdOf, showFrame, renderFrame, onionCanvas, playbackOrder, DEFAULT_ANIM, type AnimSettings } from './model';
import { encodeGif, spriteSheet } from '@/export/gif';
import { encodePng } from '@/lib/png';
import { saveFile } from '@/platform/fileio';
import { toast } from '@/store/status';
import { useLayout } from '@/store/layout';

interface AnimUi { current: number; playing: boolean; exporting: string | null; set(p: Partial<Omit<AnimUi, 'set'>>): void }
export const useAnim = create<AnimUi>()((set) => ({ current: 0, playing: false, exporting: null, set: (p) => set(p) }));

export function updateAnim(doc: PaintDocument, patch: Partial<AnimSettings>): void {
  doc.meta.anim = { ...animSettings(doc), ...patch };
  if (patch.enabled !== undefined) showFrame(doc, patch.enabled ? useAnim.getState().current : null);
  doc.scheduleSave();
  doc.invalidate();
}

export function toggleAnimation(doc: PaintDocument): void {
  const on = !animSettings(doc).enabled;
  if (on && frames(doc).length === 0) doc.addLayer('raster', { name: 'Frame 1' });
  updateAnim(doc, { enabled: on });
  useLayout.getState().setBottomBar(on ? 'timeline' : 'none');
  if (on) selectFrame(doc, Math.min(useAnim.getState().current, frames(doc).length - 1));
}

export function selectFrame(doc: PaintDocument, i: number): void {
  const fs = frames(doc);
  if (!fs.length) return;
  const idx = Math.max(0, Math.min(fs.length - 1, i));
  useAnim.getState().set({ current: idx });
  showFrame(doc, idx);
  const f = fs[idx];
  // Paint target: the frame layer itself, or the first raster child of a group frame.
  const target = f.meta.kind === 'group' ? doc.children(f.meta.id).filter((c) => c.meta.kind === 'raster').at(-1) : f;
  if (target) doc.setActive(target.meta.id);
}

// Onion skins (only while editing, not during playback).
registerPaintOverlay((ctx, g) => {
  const doc = ctx.doc;
  const s = animSettings(doc);
  const ui = useAnim.getState();
  if (!s.enabled || ui.playing) return;
  const n = frames(doc).length;
  const draw = (idx: number, tint: string, k: number) => {
    if (idx < 0 || idx >= n) return;
    const c = onionCanvas(doc, idx, tint);
    if (!c) return;
    g.globalAlpha = s.onionOpacity * k;
    g.drawImage(c, 0, 0);
  };
  for (let d = s.onionPrev; d >= 1; d--) draw(ui.current - d, s.prevTint, 1 - (d - 1) / Math.max(1, s.onionPrev));
  for (let d = s.onionNext; d >= 1; d--) draw(ui.current + d, s.nextTint, 1 - (d - 1) / Math.max(1, s.onionNext));
  g.globalAlpha = 1;
});

function FrameThumb({ doc, index, active, onClick }: { doc: PaintDocument; index: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = doc.version;
  useEffect(() => {
    const id = window.setTimeout(() => {
      const c = ref.current;
      if (!c) return;
      const src = renderFrame(doc, index, true);
      const g = c.getContext('2d')!;
      const k = Math.min(c.width / doc.width, c.height / doc.height);
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(src, (c.width - doc.width * k) / 2, (c.height - doc.height * k) / 2, doc.width * k, doc.height * k);
    }, 150);
    return () => window.clearTimeout(id);
  }, [doc, index, version]);
  return <canvas ref={ref} width={88} height={60} onClick={onClick} className={clsx('h-[60px] w-[88px] cursor-pointer rounded border-2', active ? 'border-accent' : 'border-line hover:border-fg-faint')} />;
}

async function collectFrames(doc: PaintDocument) {
  const s = animSettings(doc);
  const fs = frames(doc);
  const order = playbackOrder(fs.length, s.mode);
  return order.map((i) => {
    const c = renderFrame(doc, i, true);
    // Flatten onto the document background so GIF/WebM frames are opaque.
    const flat = makeCanvas(doc.width, doc.height);
    const g = ctx2d(flat);
    if (doc.meta.background && doc.meta.background !== 'transparent') { g.fillStyle = doc.meta.background; g.fillRect(0, 0, flat.width, flat.height); }
    g.drawImage(c, 0, 0);
    const img = g.getImageData(0, 0, flat.width, flat.height);
    return { data: img.data, width: img.width, height: img.height, delayMs: (holdOf(fs[i]) * 1000) / Math.max(1, doc.meta.fps), canvas: flat };
  });
}

export async function exportGif(doc: PaintDocument, scale = 1): Promise<void> {
  const ui = useAnim.getState();
  ui.set({ exporting: 'GIF' });
  try {
    let fs = await collectFrames(doc);
    if (scale !== 1) fs = fs.map((f) => { const c = makeCanvas(Math.round(f.width * scale), Math.round(f.height * scale)); const g = ctx2d(c); g.imageSmoothingEnabled = scale > 1 ? false : true; g.drawImage(f.canvas, 0, 0, c.width, c.height); const img = g.getImageData(0, 0, c.width, c.height); return { ...f, data: img.data, width: c.width, height: c.height }; });
    const bytes = await encodeGif(fs, { loop: animSettings(doc).mode !== 'once', onProgress: (d, t) => ui.set({ exporting: `GIF ${d}/${t}` }) });
    const saved = await saveFile(bytes, `${doc.meta.name ?? 'animation'}.gif`, [{ name: 'GIF animation', extensions: ['gif'] }]);
    if (saved) toast(`Saved ${saved}`, 'ok');
  } catch (e) { toast(e instanceof Error ? e.message : 'GIF export failed', 'error'); }
  finally { ui.set({ exporting: null }); }
}

export async function exportSpriteSheet(doc: PaintDocument): Promise<void> {
  const fs = frames(doc).map((_, i) => { const c = renderFrame(doc, i, true); const img = ctx2d(c).getImageData(0, 0, c.width, c.height); return { data: img.data, width: img.width, height: img.height, delayMs: 0 }; });
  if (!fs.length) return;
  const sheet = spriteSheet(fs);
  const png = encodePng(sheet.data, sheet.width, sheet.height);
  const saved = await saveFile(png, `${doc.meta.name ?? 'sprites'}-sheet-${sheet.columns}x${sheet.rows}.png`, [{ name: 'PNG image', extensions: ['png'] }]);
  if (saved) toast(`Saved ${saved} (${sheet.columns}×${sheet.rows} cells of ${doc.width}×${doc.height})`, 'ok');
}

export async function exportWebm(doc: PaintDocument): Promise<void> {
  const ui = useAnim.getState();
  if (typeof MediaRecorder === 'undefined') { toast('Video recording is not supported here', 'error'); return; }
  ui.set({ exporting: 'WebM' });
  try {
    const fs = await collectFrames(doc);
    const c = makeCanvas(doc.width, doc.height);
    const g = ctx2d(c);
    const stream = c.captureStream(Math.max(1, Math.min(60, doc.meta.fps)));
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    g.drawImage(fs[0].canvas, 0, 0);
    rec.start();
    const loops = animSettings(doc).mode === 'once' ? 1 : 2;
    for (let l = 0; l < loops; l++) for (const f of fs) {
      g.drawImage(f.canvas, 0, 0);
      await new Promise((r) => setTimeout(r, f.delayMs));
    }
    rec.stop();
    await done;
    const saved = await saveFile(new Blob(chunks, { type: 'video/webm' }), `${doc.meta.name ?? 'animation'}.webm`, [{ name: 'WebM video', extensions: ['webm'] }]);
    if (saved) toast(`Saved ${saved}`, 'ok');
  } catch (e) { toast(e instanceof Error ? e.message : 'Video export failed', 'error'); }
  finally { ui.set({ exporting: null }); }
}

/** The bottom-bar animation timeline. */
export function TimelineBar() {
  const doc = usePaintStudio((s) => s.doc);
  useDocVersion(doc);
  const ui = useAnim();
  const [drag, setDrag] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // Playback loop.
  useEffect(() => {
    if (!doc || !ui.playing) return;
    const s = animSettings(doc);
    const order = playbackOrder(frames(doc).length, s.mode);
    let k = Math.max(0, order.indexOf(useAnim.getState().current));
    const step = () => {
      const fs = frames(doc);
      if (!fs.length) { useAnim.getState().set({ playing: false }); return; }
      const i = order[k % order.length];
      useAnim.getState().set({ current: i });
      showFrame(doc, i);
      const delay = (holdOf(fs[i]) * 1000) / Math.max(1, doc.meta.fps);
      k++;
      if (s.mode === 'once' && k >= order.length) { timer.current = window.setTimeout(() => useAnim.getState().set({ playing: false }), delay); return; }
      timer.current = window.setTimeout(step, delay);
    };
    step();
    return () => window.clearTimeout(timer.current);
  }, [doc, ui.playing]);

  if (!doc) return <div className="px-3 py-2 text-fg-faint">Open a painting to animate it.</div>;
  const s = animSettings(doc);
  const fs = frames(doc);
  const cur = Math.min(ui.current, Math.max(0, fs.length - 1));

  const addFrame = (duplicate: boolean) => {
    const src = fs[cur];
    if (duplicate && src) { doc.duplicateLayer(src.meta.id); }
    else doc.addLayer('raster', { name: `Frame ${fs.length + 1}`, above: src?.meta.id ?? null });
    selectFrame(doc, cur + 1);
  };
  const del = () => { const f = fs[cur]; if (f && fs.length > 1) { doc.deleteLayer(f.meta.id); selectFrame(doc, Math.max(0, cur - 1)); } };
  const setHold = (d: number) => { const f = fs[cur]; if (f) doc.setLayerProps(f.meta.id, { data: { ...f.meta.data, hold: Math.max(1, Math.min(24, holdOf(f) + d)) } }, 'Frame hold'); };
  const togglePin = () => { const f = fs[cur]; if (f) { doc.setLayerProps(f.meta.id, { data: { ...f.meta.data, animPinned: true } }, 'Pin as background'); selectFrame(doc, Math.min(cur, frames(doc).length - 1)); } };
  const unpinAll = () => { for (const l of doc.children(null)) if (l.meta.data.animPinned) doc.setLayerProps(l.meta.id, { data: { ...l.meta.data, animPinned: false } }, 'Unpin layer'); };

  return (
    <div className="flex h-[112px] flex-col" data-testid="timeline">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-[12px]">
        <Film size={13} className="text-fg-muted" />
        <span className="mr-2 font-semibold">Animation</span>
        <button className="rounded p-1 hover:bg-bg-3" title="Previous frame (,)" onClick={() => selectFrame(doc, cur - 1)}><SkipBack size={13} /></button>
        <button className="rounded p-1 hover:bg-bg-3" title={ui.playing ? 'Pause' : 'Play'} onClick={() => { if (ui.playing) { ui.set({ playing: false }); showFrame(doc, cur); } else ui.set({ playing: true }); }} data-testid="anim-play">{ui.playing ? <Pause size={13} /> : <Play size={13} />}</button>
        <button className="rounded p-1 hover:bg-bg-3" title="Next frame (.)" onClick={() => selectFrame(doc, cur + 1)}><SkipForward size={13} /></button>
        <span className="mx-1 tabular-nums text-fg-muted" data-testid="anim-counter">{fs.length ? cur + 1 : 0} / {fs.length}</span>
        <label className="ml-2 flex items-center gap-1 text-fg-muted">FPS<input type="range" min={1} max={60} value={doc.meta.fps} onChange={(e) => { doc.meta.fps = Number(e.target.value); doc.scheduleSave(); doc.invalidate(); }} className="w-20 accent-[var(--iln-accent)]" data-testid="anim-fps" /><span className="w-5 tabular-nums text-fg">{doc.meta.fps}</span></label>
        <select value={s.mode} onChange={(e) => updateAnim(doc, { mode: e.target.value as AnimSettings['mode'] })} className="rounded border border-line bg-bg-2 px-1" data-testid="anim-mode">
          <option value="loop">Loop</option><option value="pingpong">Ping-pong</option><option value="once">Play once</option>
        </select>
        <div className="mx-1 h-4 w-px bg-line" />
        <span className="text-fg-muted">Onion</span>
        <label className="flex items-center gap-0.5 text-fg-muted" title="Previous frames"><input type="color" value={s.prevTint} onChange={(e) => updateAnim(doc, { prevTint: e.target.value })} className="h-4 w-4 border-0 bg-transparent p-0" /><input type="number" min={0} max={5} value={s.onionPrev} onChange={(e) => updateAnim(doc, { onionPrev: Math.max(0, Math.min(5, Number(e.target.value))) })} className="w-9 rounded border border-line bg-bg-2 px-1" data-testid="onion-prev" /></label>
        <label className="flex items-center gap-0.5 text-fg-muted" title="Next frames"><input type="color" value={s.nextTint} onChange={(e) => updateAnim(doc, { nextTint: e.target.value })} className="h-4 w-4 border-0 bg-transparent p-0" /><input type="number" min={0} max={5} value={s.onionNext} onChange={(e) => updateAnim(doc, { onionNext: Math.max(0, Math.min(5, Number(e.target.value))) })} className="w-9 rounded border border-line bg-bg-2 px-1" /></label>
        <input type="range" min={0.05} max={0.9} step={0.05} value={s.onionOpacity} onChange={(e) => updateAnim(doc, { onionOpacity: Number(e.target.value) })} className="w-16 accent-[var(--iln-accent)]" title="Onion opacity" />
        <div className="flex-1" />
        {ui.exporting && <span className="text-fg-faint">Exporting {ui.exporting}…</span>}
        <div className="relative">
          <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-bg-3" onClick={() => setExportOpen((v) => !v)} data-testid="anim-export"><Download size={13} />Export</button>
          {exportOpen && (
            <div className="absolute right-0 bottom-7 z-30 flex w-48 flex-col rounded-md border border-line bg-bg-1 p-1 shadow-xl">
              <button className="rounded px-2 py-1 text-left hover:bg-bg-3" data-testid="anim-export-gif" onClick={() => { setExportOpen(false); void exportGif(doc); }}>Animated GIF</button>
              <button className="rounded px-2 py-1 text-left hover:bg-bg-3" onClick={() => { setExportOpen(false); void exportGif(doc, 2); }}>Animated GIF (2× pixels)</button>
              <button className="rounded px-2 py-1 text-left hover:bg-bg-3" data-testid="anim-export-sheet" onClick={() => { setExportOpen(false); void exportSpriteSheet(doc); }}><Grid3x3 size={12} className="mr-1 inline" />Sprite sheet PNG</button>
              <button className="rounded px-2 py-1 text-left hover:bg-bg-3" onClick={() => { setExportOpen(false); void exportWebm(doc); }}>WebM video</button>
            </div>
          )}
        </div>
        <button className="rounded p-1 text-fg-muted hover:bg-bg-3" title="Close animation" onClick={() => toggleAnimation(doc)}><X size={13} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-2 overflow-x-auto px-2" onDragOver={(e) => e.preventDefault()}>
        {fs.map((f, i) => (
          <div key={f.meta.id} draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} data-testid="anim-frame"
            onDrop={() => { if (drag !== null && drag !== i) { doc.moveLayer(fs[drag].meta.id, null, doc.children(null).indexOf(f)); selectFrame(doc, i); } setDrag(null); }}
            className="relative flex shrink-0 flex-col items-center">
            <FrameThumb doc={doc} index={i} active={i === cur} onClick={() => selectFrame(doc, i)} />
            <span className="text-[10px] text-fg-faint">{i + 1}{holdOf(f) > 1 ? ` ×${holdOf(f)}` : ''}</span>
          </div>
        ))}
        <div className="flex shrink-0 flex-col gap-0.5">
          <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-bg-3" onClick={() => addFrame(false)} data-testid="anim-add"><Plus size={12} />Frame</button>
          <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-bg-3" onClick={() => addFrame(true)} data-testid="anim-duplicate"><Copy size={12} />Duplicate</button>
          <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-bg-3 hover:text-danger" onClick={del} disabled={fs.length <= 1}><Trash2 size={12} />Delete</button>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5">
          <div className="flex items-center gap-1 text-fg-muted">Hold<button className="rounded p-0.5 hover:bg-bg-3" onClick={() => setHold(-1)}><Minus size={11} /></button><span className="w-4 text-center tabular-nums">{fs[cur] ? holdOf(fs[cur]) : 1}</span><button className="rounded p-0.5 hover:bg-bg-3" onClick={() => setHold(1)}><Plus size={11} /></button></div>
          <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-bg-3" title="Show this layer on every frame" onClick={togglePin}><Pin size={12} />Pin as background</button>
          <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-bg-3" onClick={unpinAll}><PinOff size={12} />Unpin all</button>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_ANIM };
