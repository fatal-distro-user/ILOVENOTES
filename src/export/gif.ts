/** Animated GIF encoding (gifenc): per-frame quantisation, optional 1-bit transparency, loop control. */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export interface GifFrame { data: Uint8ClampedArray; width: number; height: number; delayMs: number }
export interface GifOptions { loop?: boolean; transparent?: boolean; maxColors?: number; onProgress?: (done: number, total: number) => void }

export async function encodeGif(frames: GifFrame[], opts: GifOptions = {}): Promise<Uint8Array> {
  if (!frames.length) throw new Error('No frames to encode');
  const gif = GIFEncoder();
  const format = opts.transparent ? 'rgba4444' : 'rgb565';
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const palette = quantize(f.data, opts.maxColors ?? 256, { format, oneBitAlpha: opts.transparent ? 127 : false, clearAlpha: !!opts.transparent });
    const index = applyPalette(f.data, palette, format);
    const tIndex = opts.transparent ? palette.findIndex((c) => c.length > 3 && c[3] === 0) : -1;
    gif.writeFrame(index, f.width, f.height, { palette, delay: Math.max(20, f.delayMs), repeat: opts.loop === false ? -1 : 0, transparent: tIndex >= 0, transparentIndex: Math.max(0, tIndex), dispose: opts.transparent ? 2 : -1 });
    opts.onProgress?.(i + 1, frames.length);
    // Yield so long encodes don't freeze the UI.
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return gif.bytes();
}

/** Lay frames out on a grid; returns the sheet pixels and per-frame cell size. */
export function spriteSheet(frames: GifFrame[], columns?: number): { data: Uint8ClampedArray; width: number; height: number; columns: number; rows: number } {
  const n = frames.length;
  const cols = Math.max(1, columns ?? Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const fw = frames[0].width, fh = frames[0].height;
  const W = cols * fw, H = rows * fh;
  const out = new Uint8ClampedArray(W * H * 4);
  frames.forEach((f, i) => {
    const ox = (i % cols) * fw, oy = Math.floor(i / cols) * fh;
    for (let y = 0; y < fh; y++) out.set(f.data.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * W + ox) * 4);
  });
  return { data: out, width: W, height: H, columns: cols, rows };
}
