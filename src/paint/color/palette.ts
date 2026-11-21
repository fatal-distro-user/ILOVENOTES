/** Pure palette / history helpers (no DB, no React). */
import { parseGpl, parseHexPalette, parseHex, rgbToHex } from './colorMath';

export const HISTORY_MAX = 24;

/** Normalise any accepted colour string to lower-case #rrggbb (alpha dropped). Returns null when invalid. */
export function normHex(s: string): string | null {
  const p = parseHex(s);
  return p ? rgbToHex(p) : null;
}

/** Push to a most-recent-first, de-duplicated, capped history list. */
export function pushHistory(list: readonly string[], hex: string, max = HISTORY_MAX): string[] {
  const n = normHex(hex);
  if (!n) return list.slice(0, max);
  return [n, ...list.filter((c) => c !== n)].slice(0, max);
}

export function dedupeColors(colors: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of colors) {
    const n = normHex(c);
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

/** Add colours to the end of a palette, skipping ones already present. */
export function addColors(colors: readonly string[], add: readonly string[]): string[] {
  return dedupeColors([...colors, ...add]);
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** Move the item at `from` so it ends up at index `to` (in the resulting list). */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list.slice();
  const t = Math.max(0, Math.min(list.length - 1, to));
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(t, 0, item);
  return out;
}

export type PaletteFormat = 'gpl' | 'hex' | 'unknown';

/** Detect a palette text format from its content (falling back to the extension). */
export function detectPaletteFormat(fileName: string, text: string): PaletteFormat {
  const head = text.trimStart();
  if (/^GIMP Palette/i.test(head)) return 'gpl';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines.every((l) => /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(l))) return 'hex';
  if (/\.gpl$/i.test(fileName) && /^\s*\d+\s+\d+\s+\d+/m.test(text)) return 'gpl';
  return 'unknown';
}

/** Parse a .gpl/.hex/.txt palette file into a named colour list. */
export function parsePaletteFile(fileName: string, text: string): { name: string; colors: string[] } | null {
  const base = fileName.replace(/\.[^.]+$/, '') || 'Imported';
  const fmt = detectPaletteFormat(fileName, text);
  if (fmt === 'gpl') {
    const g = parseGpl(text);
    const colors = dedupeColors(g.colors);
    return colors.length ? { name: g.name === 'Imported Palette' ? base : g.name, colors } : null;
  }
  if (fmt === 'hex') {
    const colors = dedupeColors(parseHexPalette(text));
    return colors.length ? { name: base, colors } : null;
  }
  return null;
}

export const DEFAULT_PALETTE: string[] = [
  '#000000', '#3f3f46', '#a1a1aa', '#ffffff',
  '#ef4444', '#f97316', '#f59e0b', '#facc15',
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

export const HARMONY_OPTIONS = [
  { value: 'complementary', label: 'Complementary' },
  { value: 'analogous', label: 'Analogous' },
  { value: 'triadic', label: 'Triadic' },
  { value: 'split-complementary', label: 'Split-Complementary' },
  { value: 'tetradic', label: 'Tetradic' },
  { value: 'monochromatic', label: 'Monochromatic' },
] as const;
