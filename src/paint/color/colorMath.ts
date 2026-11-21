/** Colour space conversions, harmonies, palette file formats and palette extraction. */

export interface RGB { r: number; g: number; b: number }          // 0..255
export interface RGBA extends RGB { a: number }                      // a 0..1
export interface HSV { h: number; s: number; v: number }            // h 0..360, s/v 0..1
export interface HSL { h: number; s: number; l: number }            // h 0..360, s/l 0..1
export interface CMYK { c: number; m: number; y: number; k: number } // 0..1

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrapHue = (h: number) => ((h % 360) + 360) % 360;

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return { h: wrapHue(h), s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s, hh = wrapHue(h) / 60, x = c * (1 - Math.abs((hh % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6; else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
  return { h: wrapHue(h * 60), s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  // HSL -> HSV: v = l + s*min(l, 1-l); sv = v ? 2(1 - l/v) : 0
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb({ h, s: v === 0 ? 0 : 2 * (1 - l / v), v });
}

export function rgbToCmyk({ r, g, b }: RGB): CMYK {
  const R = r / 255, G = g / 255, B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  return { c: (1 - R - k) / (1 - k), m: (1 - G - k) / (1 - k), y: (1 - B - k) / (1 - k), k };
}

export function cmykToRgb({ c, m, y, k }: CMYK): RGB {
  return { r: Math.round(255 * (1 - c) * (1 - k)), g: Math.round(255 * (1 - m) * (1 - k)), b: Math.round(255 * (1 - y) * (1 - k)) };
}

export function rgbToHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function rgbaToHex(c: RGBA): string {
  const base = rgbToHex(c);
  return c.a >= 1 ? base : base + Math.round(clamp(c.a, 0, 1) * 255).toString(16).padStart(2, '0');
}

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa (with or without #). */
export function parseHex(hex: string): RGBA | null {
  let h = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const v = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) / 255 : 1 };
}

/** Parse any CSS-ish colour the app produces: hex, rgb()/rgba(). */
export function parseColor(s: string): RGBA | null {
  const hex = parseHex(s);
  if (hex) return hex;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s.trim());
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a };
}

export function toCss(c: RGBA): string { return c.a >= 1 ? rgbToHex(c) : `rgba(${c.r}, ${c.g}, ${c.b}, ${+c.a.toFixed(3)})`; }

export type HarmonyKind = 'complementary' | 'analogous' | 'triadic' | 'split-complementary' | 'tetradic' | 'monochromatic';

export function harmony(base: HSV, kind: HarmonyKind): HSV[] {
  const at = (d: number): HSV => ({ ...base, h: wrapHue(base.h + d) });
  switch (kind) {
    case 'complementary': return [base, at(180)];
    case 'analogous': return [at(-30), base, at(30)];
    case 'triadic': return [base, at(120), at(240)];
    case 'split-complementary': return [base, at(150), at(210)];
    case 'tetradic': return [base, at(90), at(180), at(270)];
    case 'monochromatic': return [0.3, 0.55, 0.8, 1].map((v) => ({ ...base, v: clamp(base.v * v + (1 - v) * 0.15, 0, 1) }));
  }
}

// ───────────── Palette file formats ─────────────

/** GIMP palette (.gpl). */
export function toGpl(name: string, colors: string[]): string {
  const lines = ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#'];
  for (const c of colors) {
    const p = parseHex(c);
    if (!p) continue;
    lines.push(`${String(p.r).padStart(3)} ${String(p.g).padStart(3)} ${String(p.b).padStart(3)}\t${c.toLowerCase()}`);
  }
  return lines.join('\n') + '\n';
}

export function parseGpl(text: string): { name: string; colors: string[] } {
  let name = 'Imported Palette';
  const colors: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line === 'GIMP Palette' || /^Columns:/i.test(line)) continue;
    const nm = /^Name:\s*(.+)$/i.exec(line);
    if (nm) { name = nm[1].trim(); continue; }
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(line);
    if (m) colors.push(rgbToHex({ r: +m[1], g: +m[2], b: +m[3] }));
  }
  return { name, colors };
}

/** Lospec-style .hex palette: one RRGGBB per line. */
export function toHexPalette(colors: string[]): string {
  return colors.map((c) => c.replace('#', '').slice(0, 6).toLowerCase()).join('\n') + '\n';
}

export function parseHexPalette(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => parseHex(l)).filter((c): c is RGBA => !!c).map((c) => rgbToHex(c));
}

// ───────────── Palette extraction (median cut) ─────────────

/** Extract up to `count` dominant colours from RGBA pixel data using median cut. */
export function extractPalette(data: Uint8ClampedArray, count = 8, maxSamples = 40_000): string[] {
  const total = data.length / 4;
  const stride = Math.max(1, Math.floor(total / maxSamples));
  const px: number[][] = [];
  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    px.push([data[o], data[o + 1], data[o + 2]]);
  }
  if (!px.length) return [];
  let boxes: number[][][] = [px];
  while (boxes.length < count) {
    // Split the box with the largest channel range (weighted by population).
    let bi = -1, bestScore = -1, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of box) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
        const score = (hi - lo) * Math.sqrt(box.length);
        if (score > bestScore) { bestScore = score; bi = i; bestCh = ch; }
      }
    });
    if (bi < 0 || bestScore <= 0) break;
    const box = boxes[bi].sort((a, b) => a[bestCh] - b[bestCh]);
    // Split at the channel mean (keeps tight clusters intact better than the population median).
    const mean = box.reduce((a, p) => a + p[bestCh], 0) / box.length;
    let mid = box.findIndex((p) => p[bestCh] > mean);
    if (mid <= 0 || mid >= box.length) mid = box.length >> 1;
    boxes = [...boxes.slice(0, bi), box.slice(0, mid), box.slice(mid), ...boxes.slice(bi + 1)];
  }
  return boxes
    .filter((b) => b.length)
    .sort((a, b) => b.length - a.length)
    .map((box) => {
      const s = box.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      return rgbToHex({ r: s[0] / box.length, g: s[1] / box.length, b: s[2] / box.length });
    });
}
