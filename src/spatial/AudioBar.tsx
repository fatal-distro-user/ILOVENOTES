import { useLiveQuery } from 'dexie-react-hooks';
import { Mic, Square, Play, Pause, Trash2, MapPin, X, Download } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { db } from '@/db/schema';
import { useActivePageId } from '@/editor/activeEditor';
import { useLayout } from '@/store/layout';
import { peekCanvasDoc } from '@/canvas/doc';
import { saveFile } from '@/platform/fileio';
import { confirmDialog, promptDialog } from '@/ui/dialogs';
import { useAudio, startRecording, stopRecording, play, togglePause, seek, stop, fmtTime } from './audioStore';
import type { AudioClip } from '@/db/types';

/** Place an audio pin object on a canvas page at the view centre (or a point). */
export async function pinClip(clip: AudioClip, at?: { x: number; y: number }): Promise<boolean> {
  const doc = peekCanvasDoc(clip.pageId);
  if (!doc) return false;
  const cam = doc.state.camera;
  const p = at ?? { x: cam.x + 120, y: cam.y + 80 };
  await doc.addObjects([doc.newObject('audio', { x: p.x, y: p.y, w: 260, h: 44 }, { audioId: clip.id, name: clip.name })], 'Pin audio note');
  return true;
}

export function AudioBar() {
  const pageId = useActivePageId();
  const clips = useLiveQuery(() => (pageId ? db.audio.where('pageId').equals(pageId).reverse().sortBy('createdAt') : []), [pageId], []);
  const st = useAudio();
  const [, tick] = useState(0);
  useEffect(() => { if (!st.recording) return; const i = window.setInterval(() => tick((n) => n + 1), 250); return () => window.clearInterval(i); }, [st.recording]);
  const recordingHere = st.recording && st.recording.pageId === pageId;
  const canvasHere = pageId ? !!peekCanvasDoc(pageId) : false;

  return (
    <div className="flex h-[96px] flex-col" data-testid="audio-bar">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2 text-[12px]">
        <Mic size={13} className="text-fg-muted" />
        <span className="font-semibold">Audio notes</span>
        {!pageId && <span className="text-fg-faint">Open a page to record notes attached to it.</span>}
        {pageId && (recordingHere
          ? <button className="flex items-center gap-1 rounded bg-danger px-2 py-0.5 text-white" onClick={async () => { const c = await stopRecording(); if (c && canvasHere) await pinClip(c); }} data-testid="audio-stop"><Square size={11} />Stop {fmtTime(performance.now() - st.recording!.startedAt)}</button>
          : <button className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-accent-fg disabled:opacity-50" disabled={!!st.recording} onClick={() => void startRecording(pageId)} data-testid="audio-record"><Mic size={11} />Record</button>)}
        {recordingHere && canvasHere && <span className="text-fg-faint">Strokes you draw now are synced to this recording.</span>}
        <div className="flex-1" />
        <button className="rounded p-1 text-fg-muted hover:bg-bg-3" title="Close" onClick={() => { stop(); useLayout.getState().setBottomBar('none'); }}><X size={13} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-2 overflow-x-auto px-2">
        {clips.length === 0 && pageId && <span className="text-fg-faint">No recordings on this page yet.</span>}
        {clips.map((c) => {
          const me = st.playing?.audioId === c.id;
          return (
            <div key={c.id} className={clsx('flex w-72 shrink-0 items-center gap-2 rounded-md border px-2 py-1', me ? 'border-accent' : 'border-line')} data-testid="audio-clip">
              <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg" onClick={() => (me ? togglePause() : void play(c))} data-testid="audio-clip-play">{me && !st.paused ? <Pause size={12} /> : <Play size={12} />}</button>
              <div className="min-w-0 flex-1">
                <button className="block w-full truncate text-left text-[12px] hover:underline" onClick={async () => { const n = await promptDialog('Rename recording', c.name); if (n?.trim()) await db.audio.update(c.id, { name: n.trim() }); }}>{c.name}</button>
                <input type="range" min={0} max={c.durationMs} value={me ? st.time : 0} onChange={(e) => (me ? seek(Number(e.target.value)) : void play(c, Number(e.target.value)))} className="h-1 w-full accent-[var(--iln-accent)]" />
              </div>
              <span className="text-[10px] tabular-nums text-fg-faint">{fmtTime(me ? st.time : 0)}/{fmtTime(c.durationMs)}</span>
              {canvasHere && <button className="rounded p-0.5 text-fg-muted hover:bg-bg-3" title="Pin to canvas" onClick={() => void pinClip(c)}><MapPin size={12} /></button>}
              <button className="rounded p-0.5 text-fg-muted hover:bg-bg-3" title="Download" onClick={() => void saveFile(c.blob, `${c.name.replace(/[^\w-]+/g, '_')}.${c.mime.includes('ogg') ? 'ogg' : c.mime.includes('mp4') ? 'm4a' : 'webm'}`)}><Download size={12} /></button>
              <button className="rounded p-0.5 text-fg-muted hover:bg-bg-3 hover:text-danger" title="Delete" onClick={async () => { if (await confirmDialog(`Delete “${c.name}”?`, { danger: true })) { if (me) stop(); await db.audio.delete(c.id); } }}><Trash2 size={12} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
