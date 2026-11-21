/**
 * Image encoding helpers. PNG goes through the pure-JS encoder (src/lib/png.ts) because the browser's
 * async encoders (toBlob/convertToBlob) can stall while the main thread is busy with painting.
 */
import { encodePng } from './png';

export function pngBlobFromImageData(img: ImageData | { width: number; height: number; data: Uint8ClampedArray }, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 4): Blob {
  return new Blob([encodePng(img.data, img.width, img.height, level) as BlobPart], { type: 'image/png' });
}

export async function encodeImageData(img: ImageData, type = 'image/png', quality?: number): Promise<Blob> {
  if (type === 'image/png') return pngBlobFromImageData(img);
  const oc = new OffscreenCanvas(img.width, img.height);
  const c = oc.getContext('2d');
  if (!c) throw new Error('Canvas unavailable');
  c.putImageData(img, 0, 0);
  return oc.convertToBlob({ type, quality });
}

/** Encode any canvas. */
export async function encodeCanvas(src: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  const c = src.getContext('2d');
  if (!c) throw new Error('Canvas unavailable');
  return encodeImageData(c.getImageData(0, 0, Math.max(1, src.width), Math.max(1, src.height)), type, quality);
}
