/// <reference lib="webworker" />
import { encodePng } from '@/lib/png';

self.onmessage = (e: MessageEvent<{ id: number; width: number; height: number; data: Uint8ClampedArray; level: number }>) => {
  const { id, width, height, data, level } = e.data;
  try {
    const png = encodePng(data, width, height, Math.max(0, Math.min(9, level)) as 0);
    (self as unknown as Worker).postMessage({ id, png }, [png.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
