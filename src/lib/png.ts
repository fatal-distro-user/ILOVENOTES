/**
 * Minimal PNG encoder/decoder for RGBA8 images using fflate (zlib). Pure JS: deterministic, works in
 * workers and doesn't depend on the browser's idle-scheduled image encoders.
 */
import { zlibSync, unzlibSync } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array, start = 0, end = buf.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Encode RGBA pixels to PNG bytes. Uses the Paeth/Sub/Up filter with the smallest absolute sum per row. */
export function encodePng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  for (let y = 0; y < height; y++) {
    const row = y * stride, prev = (y - 1) * stride;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = rgba[row + i];
        const a = i >= 4 ? rgba[row + i - 4] : 0;
        const b = y > 0 ? rgba[prev + i] : 0;
        const c = y > 0 && i >= 4 ? rgba[prev + i - 4] : 0;
        let v: number;
        if (f === 0) v = x;
        else if (f === 1) v = x - a;
        else if (f === 2) v = x - b;
        else if (f === 3) v = x - ((a + b) >> 1);
        else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        v &= 0xff;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    // Recompute the chosen filter fully (the loop above may have bailed early).
    const out = cand[best];
    for (let i = 0; i < stride; i++) {
      const x = rgba[row + i];
      const a = i >= 4 ? rgba[row + i - 4] : 0;
      const b = y > 0 ? rgba[prev + i] : 0;
      const c = y > 0 && i >= 4 ? rgba[prev + i - 4] : 0;
      let v: number;
      if (best === 0) v = x; else if (best === 1) v = x - a; else if (best === 2) v = x - b; else if (best === 3) v = x - ((a + b) >> 1);
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[i] = v & 0xff;
    }
    raw[y * (stride + 1)] = best;
    raw.set(out, y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level })), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}

/** Decode an RGBA8 / RGB8 non-interlaced PNG produced by encodePng (or most 8-bit truecolour PNGs). */
export function decodePng(png: Uint8Array): { width: number; height: number; data: Uint8ClampedArray } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8, width = 0, height = 0, colorType = 6, bitDepth = 8, interlace = 0;
  const idat: Uint8Array[] = [];
  while (o < png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { width = dv.getUint32(o + 8); height = dv.getUint32(o + 12); bitDepth = png[o + 16]; colorType = png[o + 17]; interlace = png[o + 20]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace) throw new Error('Unsupported PNG format');
  const bpp = colorType === 6 ? 4 : 3;
  const joined = new Uint8Array(idat.reduce((a, d) => a + d.length, 0));
  let p = 0;
  for (const d of idat) { joined.set(d, p); p += d.length; }
  const raw = unzlibSync(joined);
  const stride = width * bpp;
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4, s = x * bpp;
      out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}
