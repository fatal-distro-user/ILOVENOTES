/** Off-main-thread PNG tile encoding (falls back to synchronous encoding if workers are unavailable). */
import { encodePng } from '@/lib/png';

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (failed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./encodeWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; png?: Uint8Array; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.png) p.resolve(new Uint8Array(e.data.png)); else p.reject(new Error(e.data.error ?? 'encode failed'));
    };
    worker.onerror = () => { failed = true; worker = null; for (const p of pending.values()) p.reject(new Error('encoder worker crashed')); pending.clear(); };
    return worker;
  } catch { failed = true; return null; }
}

export function encodeTile(img: ImageData, level = 3): Promise<Uint8Array> {
  const w = getWorker();
  if (!w) return Promise.resolve(encodePng(img.data, img.width, img.height, level as 3));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject: (e) => { try { resolve(encodePng(img.data, img.width, img.height, level as 3)); } catch { reject(e); } } });
    // Copy so the caller's ImageData stays usable; transfer the copy.
    const data = new Uint8ClampedArray(img.data);
    w.postMessage({ id, width: img.width, height: img.height, data, level }, [data.buffer]);
  });
}
