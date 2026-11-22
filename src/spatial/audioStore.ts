/** Recording + playback state shared by the audio bar, canvas audio pins and synced-ink highlighting. */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import type { AudioClip } from '@/db/types';
import { toast } from '@/store/status';

interface AudioState {
  /** active recording */
  recording: { id: string; pageId: string; startedAt: number; recorder: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null;
  /** current playback */
  playing: { audioId: string; pageId: string } | null;
  time: number;
  paused: boolean;
  set(p: Partial<Omit<AudioState, 'set'>>): void;
}
export const useAudio = create<AudioState>()((set) => ({ recording: null, playing: null, time: 0, paused: true, set: (p) => set(p) }));

let element: HTMLAudioElement | null = null;
let url: string | null = null;
let raf = 0;

export async function startRecording(pageId: string): Promise<boolean> {
  if (useAudio.getState().recording) return false;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast('Audio recording is not supported here', 'error'); return false; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const rec = { id: nanoid(), pageId, startedAt: performance.now(), recorder, chunks: [] as Blob[], stream };
    recorder.ondataavailable = (e) => { if (e.data.size) rec.chunks.push(e.data); };
    recorder.start(250);
    useAudio.getState().set({ recording: rec });
    return true;
  } catch (e) {
    toast(e instanceof Error && e.name === 'NotAllowedError' ? 'Microphone permission was denied' : `Could not start recording: ${e instanceof Error ? e.message : e}`, 'error');
    return false;
  }
}

export async function stopRecording(pin?: { x: number; y: number }): Promise<AudioClip | null> {
  const rec = useAudio.getState().recording;
  if (!rec) return null;
  const done = new Promise<void>((r) => { rec.recorder.onstop = () => r(); });
  rec.recorder.stop();
  await done;
  rec.stream.getTracks().forEach((t) => t.stop());
  useAudio.getState().set({ recording: null });
  const durationMs = performance.now() - rec.startedAt;
  const mime = rec.recorder.mimeType || 'audio/webm';
  const clip: AudioClip = {
    id: rec.id, pageId: rec.pageId, name: `Recording ${new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`,
    blob: new Blob(rec.chunks, { type: mime }), mime, durationMs, createdAt: Date.now(), canvasX: pin?.x, canvasY: pin?.y,
  };
  await db.audio.add(clip);
  toast(`Saved ${Math.round(durationMs / 1000)}s recording`, 'ok');
  return clip;
}

/** ms since the active recording started for `pageId`, or null if not recording that page. */
export function recordingOffset(pageId: string): { audioId: string; offset: number } | null {
  const r = useAudio.getState().recording;
  return r && r.pageId === pageId ? { audioId: r.id, offset: performance.now() - r.startedAt } : null;
}

export async function play(clip: AudioClip, fromMs = 0): Promise<void> {
  stop();
  url = URL.createObjectURL(clip.blob);
  element = new Audio(url);
  element.currentTime = fromMs / 1000;
  useAudio.getState().set({ playing: { audioId: clip.id, pageId: clip.pageId }, time: fromMs, paused: false });
  const tick = () => {
    if (!element) return;
    useAudio.getState().set({ time: element.currentTime * 1000 });
    raf = requestAnimationFrame(tick);
  };
  element.onended = () => { useAudio.getState().set({ paused: true, time: clip.durationMs }); cancelAnimationFrame(raf); };
  try { await element.play(); tick(); } catch (e) { toast(`Playback failed: ${e instanceof Error ? e.message : e}`, 'error'); stop(); }
}

export function togglePause(): void {
  if (!element) return;
  if (element.paused) { void element.play(); useAudio.getState().set({ paused: false }); raf = requestAnimationFrame(function t() { if (element) { useAudio.getState().set({ time: element.currentTime * 1000 }); raf = requestAnimationFrame(t); } }); }
  else { element.pause(); cancelAnimationFrame(raf); useAudio.getState().set({ paused: true }); }
}

export function seek(ms: number): void { if (element) { element.currentTime = ms / 1000; useAudio.getState().set({ time: ms }); } }

export function stop(): void {
  cancelAnimationFrame(raf);
  if (element) { element.pause(); element = null; }
  if (url) { URL.revokeObjectURL(url); url = null; }
  useAudio.getState().set({ playing: null, time: 0, paused: true });
}

export const fmtTime = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
