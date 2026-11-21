/** Tile grid math for 256×256 raster tiles. */
export const TILE = 256;

export interface IRect { x: number; y: number; w: number; h: number }

export const tileKey = (tx: number, ty: number) => `${tx},${ty}`;
export const parseTileKey = (k: string): [number, number] => { const [a, b] = k.split(','); return [Number(a), Number(b)]; };

/** Tiles (keys) touched by a rect, clipped to the document. */
export function tilesForRect(r: IRect, docW: number, docH: number): string[] {
  const x0 = Math.max(0, Math.floor(r.x / TILE)), y0 = Math.max(0, Math.floor(r.y / TILE));
  const x1 = Math.min(Math.ceil(docW / TILE) - 1, Math.floor((r.x + r.w - 1e-9) / TILE));
  const y1 = Math.min(Math.ceil(docH / TILE) - 1, Math.floor((r.y + r.h - 1e-9) / TILE));
  const out: string[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push(tileKey(tx, ty));
  return out;
}

/** Pixel rect of a tile, clipped to the document edge. */
export function tileRect(tx: number, ty: number, docW: number, docH: number): IRect {
  const x = tx * TILE, y = ty * TILE;
  return { x, y, w: Math.min(TILE, docW - x), h: Math.min(TILE, docH - y) };
}

export function allTiles(docW: number, docH: number): string[] { return tilesForRect({ x: 0, y: 0, w: docW, h: docH }, docW, docH); }

export function isTransparent(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
  return true;
}
