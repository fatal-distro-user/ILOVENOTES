import { extractPalette } from './colorMath';

/** Decode an image blob into downscaled (≤256px) RGBA pixel data. */
export async function imagePixels(blob: Blob, maxSide = 256): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(blob);
  try {
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('Canvas unavailable');
    g.drawImage(bmp, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  } finally { bmp.close(); }
}

export const extractColors = (data: Uint8ClampedArray, n: number): string[] => extractPalette(data, n);
