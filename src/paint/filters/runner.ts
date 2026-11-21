/** Runs raster filters in a worker (latest-request-wins), falling back to the main thread. */
import { applyFilter, maskedMix, type FilterId } from './kernels';

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, (r: Uint8ClampedArray | Error) => void>();

function getWorker(): Worker | null {
  if (failed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./filterWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; data?: Uint8ClampedArray; error?: string }>) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data.data ?? new Error(e.data.error ?? 'Filter failed'));
    };
    worker.onerror = () => { failed = true; worker = null; for (const cb of pending.values()) cb(new Error('worker failed')); pending.clear(); };
    return worker;
  } catch { failed = true; return null; }
}

export function runFilter(filter: FilterId, params: unknown, img: ImageData, mask: Uint8ClampedArray | null): Promise<Uint8ClampedArray> {
  const sync = () => maskedMix({ width: img.width, height: img.height, data: img.data }, applyFilter(filter, { width: img.width, height: img.height, data: img.data }, params as never), mask).data;
  const w = getWorker();
  if (!w) return Promise.resolve(sync());
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (r) => { if (r instanceof Error) { try { resolve(sync()); } catch (e) { reject(e); } } else resolve(r); });
    const data = new Uint8ClampedArray(img.data);
    w.postMessage({ id, filter, params, width: img.width, height: img.height, data, mask }, [data.buffer]);
  });
}
