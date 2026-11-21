/** Image helpers shared by the editor, canvas and paint import. */

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('Could not read file'));
    r.readAsDataURL(blob);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

/** Read an image blob as a data URL, downscaling so the longest side is at most maxSide. GIF/SVG pass through. */
export async function imageBlobToDataUrl(blob: Blob, maxSide = 2000): Promise<{ src: string; width: number; height: number }> {
  const raw = await blobToDataUrl(blob);
  const img = await loadImage(raw);
  const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
  if (/image\/(gif|svg)/.test(blob.type) || Math.max(w, h) <= maxSide) return { src: raw, width: w, height: h };
  const k = maxSide / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d');
  if (!ctx) return { src: raw, width: w, height: h };
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const png = blob.type === 'image/png' || blob.type === 'image/webp';
  return { src: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9), width: c.width, height: c.height };
}
