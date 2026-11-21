/// <reference lib="webworker" />
import { applyFilter, maskedMix, type FilterId } from './kernels';

self.onmessage = (e: MessageEvent<{ id: number; filter: FilterId; params: unknown; width: number; height: number; data: Uint8ClampedArray; mask: Uint8ClampedArray | null }>) => {
  const { id, filter, params, width, height, data, mask } = e.data;
  try {
    const img = { width, height, data };
    const out = maskedMix(img, applyFilter(filter, img, params as never), mask);
    (self as unknown as Worker).postMessage({ id, data: out.data }, [out.data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
