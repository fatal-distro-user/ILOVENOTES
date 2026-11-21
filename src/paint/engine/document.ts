/**
 * PaintDocument: raster painting model.
 * - Each layer owns a full-size canvas (+ optional mask canvas whose alpha is the mask).
 * - Persistence: 256² PNG tiles per layer/channel; only dirty tiles are re-encoded.
 * - Undo: raster edits store before/after ImageData for touched tiles only; layer operations store
 *   metadata (and pixel copies when destructive).
 * - Compositing: all 16 blend modes (Canvas2D), opacity, clipping masks, layer masks, groups,
 *   adjustment layers (non-destructive filters over the stack below).
 */
import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import type { BlendMode, Layer, LayerKind, RasterDoc } from '@/db/types';
import { HistoryStack, type HistoryCommand } from '@/history/stack';
import { encodeCanvas } from '@/lib/encode';
import { encodeTile } from './encoder';
import { decodePng } from '@/lib/png';
import { applyFilter, type FilterId } from '../filters/kernels';
import type { Mask } from '../fill/mask';
import { TILE, tilesForRect, tileRect, parseTileKey, tileKey, isTransparent, allTiles, type IRect } from './tiles';

export interface LayerRT { meta: Layer; canvas: HTMLCanvasElement; mask: HTMLCanvasElement | null }
export type EditChannel = 'color' | 'mask';

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' }, { id: 'multiply', label: 'Multiply' }, { id: 'screen', label: 'Screen' }, { id: 'overlay', label: 'Overlay' },
  { id: 'darken', label: 'Darken' }, { id: 'lighten', label: 'Lighten' }, { id: 'color-dodge', label: 'Color Dodge' }, { id: 'color-burn', label: 'Color Burn' },
  { id: 'hard-light', label: 'Hard Light' }, { id: 'soft-light', label: 'Soft Light' }, { id: 'difference', label: 'Difference' }, { id: 'exclusion', label: 'Exclusion' },
  { id: 'hue', label: 'Hue' }, { id: 'saturation', label: 'Saturation' }, { id: 'color', label: 'Color' }, { id: 'luminosity', label: 'Luminosity' },
];

export const compositeOp = (b: BlendMode): GlobalCompositeOperation => (b === 'normal' ? 'source-over' : b);

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d');
  if (!x) throw new Error('2D canvas unavailable');
  return x;
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}



/** A raster edit in progress: tracks tiles touched, snapshots "before" pixels lazily. */
export class RasterEdit {
  private before = new Map<string, ImageData>();
  readonly ctx: CanvasRenderingContext2D;
  readonly target: HTMLCanvasElement;
  constructor(private readonly doc: PaintDocument, readonly layer: LayerRT, readonly channel: EditChannel) {
    const t = channel === 'mask' ? layer.mask : layer.canvas;
    if (!t) throw new Error('Layer has no mask');
    this.target = t;
    this.ctx = ctx2d(t);
  }
  /** Must be called BEFORE drawing into rect. */
  touch(r: IRect): void {
    for (const k of tilesForRect(r, this.doc.width, this.doc.height)) {
      if (this.before.has(k)) continue;
      const [tx, ty] = parseTileKey(k);
      const tr = tileRect(tx, ty, this.doc.width, this.doc.height);
      this.before.set(k, this.ctx.getImageData(tr.x, tr.y, tr.w, tr.h));
    }
  }
  touchAll(): void { this.touch({ x: 0, y: 0, w: this.doc.width, h: this.doc.height }); }
  get touched(): number { return this.before.size; }
  /** Restore the pre-edit pixels (cancel). */
  revert(): void {
    for (const [k, img] of this.before) { const [tx, ty] = parseTileKey(k); this.ctx.putImageData(img, tx * TILE, ty * TILE); }
    this.before.clear();
    this.doc.invalidate();
  }
  /** Finish: capture after-pixels and push an undoable command. */
  commit(label: string, kind: HistoryCommand['kind'] = 'raster'): void {
    if (!this.before.size) return;
    const after = new Map<string, ImageData>();
    for (const k of this.before.keys()) {
      const [tx, ty] = parseTileKey(k);
      const tr = tileRect(tx, ty, this.doc.width, this.doc.height);
      after.set(k, this.ctx.getImageData(tr.x, tr.y, tr.w, tr.h));
    }
    const before = new Map(this.before);
    const layerId = this.layer.meta.id, channel = this.channel;
    const apply = (m: Map<string, ImageData>) => {
      const l = this.doc.layer(layerId);
      const target = l ? (channel === 'mask' ? l.mask : l.canvas) : null;
      if (!target) return;
      const c = ctx2d(target);
      for (const [k, img] of m) { const [tx, ty] = parseTileKey(k); c.putImageData(img, tx * TILE, ty * TILE); }
      this.doc.markDirty(layerId, channel, Array.from(m.keys()));
      this.doc.invalidate();
    };
    const size = Array.from(before.values()).reduce((a, d) => a + d.data.length * 2, 0);
    this.doc.history.push({ label, kind, size, redo: () => apply(after), undo: () => apply(before) });
    this.doc.markDirty(layerId, channel, Array.from(before.keys()));
    this.before.clear();
    this.doc.invalidate();
    this.doc.scheduleSave();
  }
}

type Listener = () => void;

export class PaintDocument {
  meta: RasterDoc;
  layers: LayerRT[] = [];
  readonly history = new HistoryStack({ limit: 150, maxBytes: 768 * 1024 * 1024 });
  editChannel: EditChannel = 'color';
  /** active selection (0..255 per px) or null = everything */
  selection: Mask | null = null;
  private listeners = new Set<Listener>();
  private dirty = new Map<string, Set<string>>();
  private metaDirty = new Set<string>();
  private removedLayers = new Set<string>();
  private saveTimer: number | undefined;
  private saving: Promise<void> = Promise.resolve();
  version = 0;
  private compositeCache: HTMLCanvasElement | null = null;
  private compositeValid = false;

  private constructor(meta: RasterDoc) { this.meta = meta; }

  get id(): string { return this.meta.id; }
  get width(): number { return this.meta.width; }
  get height(): number { return this.meta.height; }
  get activeLayerId(): string | null { return this.meta.activeLayerId; }
  get active(): LayerRT | null { return this.meta.activeLayerId ? this.layer(this.meta.activeLayerId) : null; }

  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  /** Pixels or structure changed → recomposite + notify. */
  invalidate(): void { this.compositeValid = false; this.version++; this.listeners.forEach((l) => l()); }

  layer(id: string): LayerRT | null { return this.layers.find((l) => l.meta.id === id) ?? null; }

  // ───────────────────────── loading / creating ─────────────────────────

  static async create(opts: { pageId: string; ownerId: string; width: number; height: number; background?: string; name?: string }): Promise<PaintDocument> {
    const t = Date.now();
    const meta: RasterDoc = {
      id: nanoid(), pageId: opts.pageId, ownerId: opts.ownerId, width: Math.round(opts.width), height: Math.round(opts.height),
      background: opts.background ?? '#ffffff', activeLayerId: null, fps: 12, createdAt: t, updatedAt: t, name: opts.name ?? 'Painting',
    };
    const doc = new PaintDocument(meta);
    const bg = doc.newLayerMeta('raster', 'Background', 1);
    const l1 = doc.newLayerMeta('raster', 'Layer 1', 2);
    doc.layers = [{ meta: bg, canvas: makeCanvas(meta.width, meta.height), mask: null }, { meta: l1, canvas: makeCanvas(meta.width, meta.height), mask: null }];
    if (meta.background && meta.background !== 'transparent') {
      const c = ctx2d(doc.layers[0].canvas);
      c.fillStyle = meta.background;
      c.fillRect(0, 0, meta.width, meta.height);
      doc.markDirty(bg.id, 'color', allTiles(meta.width, meta.height));
    }
    meta.activeLayerId = l1.id;
    await db.rasterDocs.add(meta);
    await db.layers.bulkAdd([bg, l1]);
    await doc.save();
    return doc;
  }

  static async load(id: string): Promise<PaintDocument> {
    const meta = await db.rasterDocs.get(id);
    if (!meta) throw new Error('Painting not found');
    const doc = new PaintDocument(meta);
    const metas = (await db.layers.where('docId').equals(id).toArray()).sort((a, b) => a.order - b.order);
    const tiles = await db.tiles.where('docId').equals(id).toArray();
    doc.layers = metas.map((m) => ({ meta: m, canvas: makeCanvas(meta.width, meta.height), mask: m.hasMask ? makeCanvas(meta.width, meta.height) : null }));
    await Promise.all(tiles.map(async (t) => {
      const l = doc.layer(t.layerId);
      const target = l ? (t.channel === 'mask' ? l.mask : l.canvas) : null;
      if (!target) return;
      const px = decodePng(new Uint8Array(await t.blob.arrayBuffer()));
      ctx2d(target).putImageData(new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.width, px.height), t.tx * TILE, t.ty * TILE);
    }));
    for (const l of doc.layers) if (l.meta.kind === 'vector' || l.meta.kind === 'text') doc.rasterizeLive(l);
    if (!doc.meta.activeLayerId || !doc.layer(doc.meta.activeLayerId)) doc.meta.activeLayerId = doc.layers.filter((l) => l.meta.kind !== 'group').at(-1)?.meta.id ?? null;
    return doc;
  }

  private newLayerMeta(kind: LayerKind, name: string, order: number, parentId: string | null = null): Layer {
    return {
      id: nanoid(), docId: this.meta.id, name, kind, order, opacity: 1, blend: 'normal', visible: true, locked: false,
      alphaLock: false, clip: false, isReference: false, hasMask: false, maskEnabled: true, parentId, data: {},
    };
  }

  // ───────────────────────── persistence ─────────────────────────

  markDirty(layerId: string, channel: EditChannel, tiles: string[]): void {
    const key = `${layerId}|${channel}`;
    let s = this.dirty.get(key);
    if (!s) { s = new Set(); this.dirty.set(key, s); }
    tiles.forEach((t) => s!.add(t));
  }
  private markMeta(id: string): void { this.metaDirty.add(id); this.scheduleSave(); }

  scheduleSave(delay = 700): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { void this.save(); }, delay);
  }

  /** Flush dirty tiles + metadata to IndexedDB (serialised). */
  save(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    const run = this.saving.then(() => this.doSave());
    this.saving = run.catch((e) => console.error('Paint save failed', e));
    return run;
  }

  private async doSave(): Promise<void> {
    const dirty = this.dirty;
    this.dirty = new Map();
    const metaIds = Array.from(this.metaDirty);
    this.metaDirty.clear();
    const removed = Array.from(this.removedLayers);
    this.removedLayers.clear();
    const jobs: Promise<{ id: string; layerId: string; docId: string; tx: number; ty: number; channel: EditChannel; blob: Blob }>[] = [];
    const dels: string[] = [];
    for (const [key, tiles] of dirty) {
      const [layerId, channel] = key.split('|') as [string, EditChannel];
      const l = this.layer(layerId);
      const src = l ? (channel === 'mask' ? l.mask : l.canvas) : null;
      if (!src) continue;
      const sctx = ctx2d(src);
      for (const k of tiles) {
        const [tx, ty] = parseTileKey(k);
        const r = tileRect(tx, ty, this.width, this.height);
        const id = `${layerId}:${channel}:${k}`;
        const img = sctx.getImageData(r.x, r.y, r.w, r.h);
        if (isTransparent(img.data)) { dels.push(id); continue; }
        jobs.push(encodeTile(img).then((png) => ({ id, layerId, docId: this.id, tx, ty, channel, blob: new Blob([png as BlobPart], { type: 'image/png' }) })));
      }
    }
    const puts = await Promise.all(jobs);
    this.meta.updatedAt = Date.now();
    this.meta.preview = await this.makePreview(512);
    await db.transaction('rw', db.tiles, db.layers, db.rasterDocs, async () => {
      if (removed.length) { await db.layers.bulkDelete(removed); await db.tiles.where('layerId').anyOf(removed).delete(); }
      if (dels.length) await db.tiles.bulkDelete(dels);
      if (puts.length) await db.tiles.bulkPut(puts);
      const metas = metaIds.map((id) => this.layer(id)?.meta).filter((m): m is Layer => !!m);
      if (metas.length) await db.layers.bulkPut(metas);
      await db.rasterDocs.put(this.meta);
    });
  }

  async makePreview(maxSide: number): Promise<Blob> {
    const k = Math.min(1, maxSide / Math.max(this.width, this.height));
    const c = makeCanvas(Math.max(1, Math.round(this.width * k)), Math.max(1, Math.round(this.height * k)));
    const x = ctx2d(c);
    x.imageSmoothingQuality = 'high';
    x.drawImage(this.composite(), 0, 0, c.width, c.height);
    return encodeCanvas(c);
  }

  // ───────────────────────── tree helpers ─────────────────────────

  /** Children of a parent (null = root), bottom → top. */
  children(parentId: string | null): LayerRT[] {
    return this.layers.filter((l) => l.meta.parentId === parentId).sort((a, b) => a.meta.order - b.meta.order);
  }

  /** Flattened display order (top → bottom) with depth, for the Layers panel. */
  displayList(): { layer: LayerRT; depth: number }[] {
    const out: { layer: LayerRT; depth: number }[] = [];
    const walk = (pid: string | null, depth: number) => {
      for (const l of [...this.children(pid)].reverse()) {
        out.push({ layer: l, depth });
        if (l.meta.kind === 'group' && !l.meta.data.collapsed) walk(l.meta.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  private renumber(parentId: string | null): Layer[] {
    const kids = this.children(parentId);
    const changed: Layer[] = [];
    kids.forEach((l, i) => { if (l.meta.order !== i + 1) { l.meta.order = i + 1; changed.push(l.meta); } });
    changed.forEach((m) => this.metaDirty.add(m.id));
    return changed;
  }

  memoryBytes(): number {
    return this.layers.reduce((a, l) => a + (l.meta.kind === 'group' ? 0 : this.width * this.height * 4) + (l.mask ? this.width * this.height * 4 : 0), 0);
  }

  // ───────────────────────── compositing ─────────────────────────

  private tmpPool: HTMLCanvasElement[] = [];
  private takeTmp(): HTMLCanvasElement {
    const c = this.tmpPool.pop() ?? makeCanvas(this.width, this.height);
    const x = ctx2d(c);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, c.width, c.height);
    return c;
  }
  private giveTmp(c: HTMLCanvasElement): void { this.tmpPool.push(c); }

  /** Layer pixels with its mask applied (returns a temp canvas the caller must return, or the layer canvas itself). */
  private layerPixels(l: LayerRT, hide: Set<string>, opts: { onlyLayerIds?: Set<string> }): { canvas: HTMLCanvasElement; temp: boolean } {
    let src: HTMLCanvasElement;
    let temp = false;
    if (l.meta.kind === 'group') {
      src = this.takeTmp();
      temp = true;
      this.compositeChildren(l.meta.id, ctx2d(src), hide, opts);
    } else src = l.canvas;
    if (l.mask && l.meta.hasMask && l.meta.maskEnabled) {
      const m = temp ? src : this.takeTmp();
      const mc = ctx2d(m);
      if (!temp) mc.drawImage(src, 0, 0);
      mc.globalCompositeOperation = 'destination-in';
      mc.drawImage(l.mask, 0, 0);
      mc.globalCompositeOperation = 'source-over';
      return { canvas: m, temp: true };
    }
    return { canvas: src, temp };
  }

  /** Composite the children of `parentId` into ctx (handles clipping groups and adjustment layers). */
  private compositeChildren(parentId: string | null, ctx: CanvasRenderingContext2D, hide: Set<string>, opts: { onlyLayerIds?: Set<string> }): void {
    const kids = this.children(parentId);
    const visible = (l: LayerRT) => l.meta.visible && !hide.has(l.meta.id) && (!opts.onlyLayerIds || opts.onlyLayerIds.has(l.meta.id) || l.meta.kind === 'group');
    let i = 0;
    while (i < kids.length) {
      const base = kids[i];
      // Collect clipping layers stacked directly above this base.
      const clipped: LayerRT[] = [];
      let j = i + 1;
      while (j < kids.length && kids[j].meta.clip && base.meta.kind !== 'adjustment') { clipped.push(kids[j]); j++; }
      i = j;
      if (!visible(base)) continue;

      if (base.meta.kind === 'adjustment') { this.applyAdjustment(base, ctx); continue; }

      const px = this.layerPixels(base, hide, opts);
      if (!clipped.some(visible)) {
        ctx.globalAlpha = base.meta.opacity;
        ctx.globalCompositeOperation = compositeOp(base.meta.blend);
        ctx.drawImage(px.canvas, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (px.temp) this.giveTmp(px.canvas);
        continue;
      }
      // Clipping group: build base, then blend each clipped layer restricted to base alpha.
      const grp = this.takeTmp();
      const g = ctx2d(grp);
      g.drawImage(px.canvas, 0, 0);
      if (px.temp) this.giveTmp(px.canvas);
      for (const cl of clipped) {
        if (!visible(cl)) continue;
        const cp = this.layerPixels(cl, hide, opts);
        const t = this.takeTmp();
        const tc = ctx2d(t);
        tc.drawImage(cp.canvas, 0, 0);
        if (cp.temp) this.giveTmp(cp.canvas);
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(grp, 0, 0);
        tc.globalCompositeOperation = 'source-over';
        g.globalAlpha = cl.meta.opacity;
        g.globalCompositeOperation = cl.meta.blend === 'normal' ? 'source-atop' : compositeOp(cl.meta.blend);
        g.drawImage(t, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        this.giveTmp(t);
      }
      ctx.globalAlpha = base.meta.opacity;
      ctx.globalCompositeOperation = compositeOp(base.meta.blend);
      ctx.drawImage(grp, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      this.giveTmp(grp);
    }
  }

  /** Non-destructive adjustment over everything already composited in ctx (same group). */
  private applyAdjustment(l: LayerRT, ctx: CanvasRenderingContext2D): void {
    const filter = l.meta.data.filter as FilterId | undefined;
    if (!filter) return;
    const w = this.width, h = this.height;
    const below = ctx.getImageData(0, 0, w, h);
    const out = applyFilter(filter, { width: w, height: h, data: below.data }, l.meta.data.params as never);
    const t = this.takeTmp();
    const tc = ctx2d(t);
    tc.putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    if (l.mask && l.meta.hasMask && l.meta.maskEnabled) {
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(l.mask, 0, 0);
      tc.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = l.meta.opacity;
    ctx.globalCompositeOperation = compositeOp(l.meta.blend);
    ctx.drawImage(t, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.giveTmp(t);
  }

  /** Full composite (cached until invalidated). Transparent background unless the doc defines one. */
  composite(): HTMLCanvasElement {
    if (!this.compositeCache) this.compositeCache = makeCanvas(this.width, this.height);
    if (!this.compositeValid) {
      const c = ctx2d(this.compositeCache);
      c.clearRect(0, 0, this.width, this.height);
      this.compositeChildren(null, c, new Set(), {});
      this.compositeValid = true;
    }
    return this.compositeCache;
  }

  /** Composite into a new canvas, optionally hiding layers or restricting to a set (onion skins, export). */
  renderTo(opts: { hide?: string[]; only?: string[] } = {}): HTMLCanvasElement {
    const c = makeCanvas(this.width, this.height);
    this.compositeChildren(null, ctx2d(c), new Set(opts.hide ?? []), { onlyLayerIds: opts.only ? new Set(opts.only) : undefined });
    return c;
  }

  // ───────────────────────── vector / text live layers ─────────────────────────

  /** Re-rasterise a vector or text layer from its data. */
  rasterizeLive(l: LayerRT): void {
    const c = ctx2d(l.canvas);
    c.clearRect(0, 0, this.width, this.height);
    if (l.meta.kind === 'text') {
      const d = l.meta.data as { text?: string; x?: number; y?: number; size?: number; font?: string; color?: string; weight?: number; align?: CanvasTextAlign; lineHeight?: number };
      c.fillStyle = d.color ?? '#000000';
      c.font = `${d.weight ?? 400} ${d.size ?? 48}px ${d.font ?? 'Inter, system-ui, sans-serif'}`;
      c.textAlign = d.align ?? 'left';
      c.textBaseline = 'top';
      (d.text ?? '').split('\n').forEach((line, i) => c.fillText(line, d.x ?? 40, (d.y ?? 40) + i * (d.size ?? 48) * (d.lineHeight ?? 1.25)));
    } else if (l.meta.kind === 'vector') {
      const shapes = (l.meta.data.shapes as { path: string; fill?: string; stroke?: string; width?: number }[] | undefined) ?? [];
      for (const s of shapes) {
        const p = new Path2D(s.path);
        if (s.fill && s.fill !== 'none') { c.fillStyle = s.fill; c.fill(p); }
        if (s.stroke && s.stroke !== 'none') { c.strokeStyle = s.stroke; c.lineWidth = s.width ?? 2; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(p); }
      }
    }
    this.markDirty(l.meta.id, 'color', allTiles(this.width, this.height));
  }

  // ───────────────────────── raster editing ─────────────────────────

  beginEdit(layerId?: string, channel: EditChannel = this.editChannel): RasterEdit | null {
    const l = this.layer(layerId ?? this.meta.activeLayerId ?? '');
    if (!l || l.meta.locked || l.meta.kind === 'group' || l.meta.kind === 'adjustment') return null;
    if (l.meta.kind !== 'raster' && channel === 'color') return null;
    if (channel === 'mask' && !l.mask) return null;
    return new RasterEdit(this, l, channel);
  }

  // ───────────────────────── layer operations (all undoable) ─────────────────────────

  private snapshotMeta(): Layer[] { return this.layers.map((l) => ({ ...l.meta, data: { ...l.meta.data } })); }

  /** Generic structural command: snapshot metas (+ given pixel canvases) before/after and push. */
  private structural(label: string, mutate: () => void, kind: HistoryCommand['kind'] = 'layer'): void {
    const beforeMetas = this.snapshotMeta();
    const beforeLayers = new Map(this.layers.map((l) => [l.meta.id, l]));
    const beforeActive = this.meta.activeLayerId;
    mutate();
    const afterMetas = this.snapshotMeta();
    const afterLayers = new Map(this.layers.map((l) => [l.meta.id, l]));
    const afterActive = this.meta.activeLayerId;
    const restore = (metas: Layer[], rts: Map<string, LayerRT>, active: string | null) => {
      const present = new Set(this.layers.map((l) => l.meta.id));
      const next = metas.map((m) => { const rt = rts.get(m.id)!; rt.meta = { ...m, data: { ...m.data } }; return rt; });
      for (const id of present) if (!metas.some((m) => m.id === id)) this.removedLayers.add(id);
      for (const m of metas) { this.removedLayers.delete(m.id); this.metaDirty.add(m.id); }
      this.layers = next;
      // Re-persist pixel content of layers that came back.
      for (const rt of next) if (!present.has(rt.meta.id)) {
        this.markDirty(rt.meta.id, 'color', allTiles(this.width, this.height));
        if (rt.mask) this.markDirty(rt.meta.id, 'mask', allTiles(this.width, this.height));
      }
      this.meta.activeLayerId = active;
      this.invalidate();
      this.scheduleSave();
    };
    const size = Array.from(afterLayers.values()).filter((l) => !beforeLayers.has(l.meta.id)).length * this.width * this.height * 4;
    this.history.push({ label, kind, size, redo: () => restore(afterMetas, afterLayers, afterActive), undo: () => restore(beforeMetas, beforeLayers, beforeActive) });
    for (const m of afterMetas) this.metaDirty.add(m.id);
    this.invalidate();
    this.scheduleSave();
  }

  setActive(id: string): void { if (this.layer(id)) { this.meta.activeLayerId = id; this.editChannel = 'color'; this.scheduleSave(); this.invalidate(); } }

  addLayer(kind: LayerKind = 'raster', opts: { name?: string; above?: string | null; data?: Record<string, unknown> } = {}): LayerRT {
    let created: LayerRT | null = null;
    this.structural(`Add ${kind} layer`, () => {
      // New layers go directly above the reference layer (default: the active layer), in its group.
      const ref = this.layer(opts.above ?? this.meta.activeLayerId ?? '');
      const parentId = ref ? ref.meta.parentId : null;
      const siblings = this.children(parentId);
      const at = ref ? siblings.findIndex((s) => s.meta.id === ref.meta.id) + 1 : siblings.length;
      const n = this.layers.filter((l) => l.meta.kind === kind).length + 1;
      const name = opts.name ?? (kind === 'raster' ? `Layer ${this.layers.length}` : kind === 'group' ? `Group ${n}` : kind === 'adjustment' ? 'Adjustment' : kind === 'text' ? 'Text' : `Vector ${n}`);
      const meta = this.newLayerMeta(kind, name, 0, parentId);
      meta.data = opts.data ?? (kind === 'text' ? { text: 'Text', x: 40, y: 40, size: 64, color: '#111111', font: 'Inter, system-ui, sans-serif', weight: 600 } : kind === 'group' ? { open: true } : {});
      const rt: LayerRT = { meta, canvas: makeCanvas(kind === 'group' || kind === 'adjustment' ? 1 : this.width, kind === 'group' || kind === 'adjustment' ? 1 : this.height), mask: null };
      // Insert into ordering.
      const ordered = [...siblings];
      ordered.splice(at, 0, rt);
      this.layers.push(rt);
      ordered.forEach((l, i) => { l.meta.order = i + 1; });
      if (kind === 'text' || kind === 'vector') this.rasterizeLive(rt);
      if (kind !== 'group') this.meta.activeLayerId = meta.id;
      created = rt;
    });
    return created as unknown as LayerRT;
  }

  /** Add a raster layer from an image/canvas (paste, import). */
  addLayerFromCanvas(src: CanvasImageSource, name: string, x = 0, y = 0): LayerRT {
    const rt = this.addLayer('raster', { name });
    const c = ctx2d(rt.canvas);
    c.drawImage(src, x, y);
    this.markDirty(rt.meta.id, 'color', allTiles(this.width, this.height));
    // Fold the pixel content into the add command so undo/redo keep it.
    this.invalidate();
    this.scheduleSave();
    return rt;
  }

  deleteLayer(id: string): void {
    const l = this.layer(id);
    if (!l) return;
    if (this.layers.filter((x) => x.meta.kind !== 'group').length <= 1 && l.meta.kind !== 'group') return;
    this.structural(`Delete “${l.meta.name}”`, () => {
      const drop = new Set([id, ...this.descendants(id)]);
      this.layers = this.layers.filter((x) => !drop.has(x.meta.id));
      drop.forEach((d) => this.removedLayers.add(d));
      this.renumber(l.meta.parentId);
      if (drop.has(this.meta.activeLayerId ?? '')) this.meta.activeLayerId = this.layers.filter((x) => x.meta.kind !== 'group').at(-1)?.meta.id ?? null;
    });
  }

  descendants(id: string): string[] {
    const out: string[] = [];
    const walk = (pid: string) => { for (const l of this.layers.filter((x) => x.meta.parentId === pid)) { out.push(l.meta.id); walk(l.meta.id); } };
    walk(id);
    return out;
  }

  duplicateLayer(id: string): void {
    const l = this.layer(id);
    if (!l) return;
    this.structural(`Duplicate “${l.meta.name}”`, () => {
      const copyTree = (src: LayerRT, parentId: string | null): LayerRT => {
        const meta: Layer = { ...src.meta, id: nanoid(), name: src.meta.parentId === parentId && src === l ? `${src.meta.name} copy` : src.meta.name, parentId, data: { ...src.meta.data } };
        const rt: LayerRT = { meta, canvas: cloneCanvas(src.canvas), mask: src.mask ? cloneCanvas(src.mask) : null };
        this.layers.push(rt);
        this.markDirty(meta.id, 'color', allTiles(this.width, this.height));
        if (rt.mask) this.markDirty(meta.id, 'mask', allTiles(this.width, this.height));
        for (const child of this.children(src.meta.id)) copyTree(child, meta.id);
        return rt;
      };
      const rt = copyTree(l, l.meta.parentId);
      rt.meta.order = l.meta.order + 0.5;
      this.renumber(l.meta.parentId);
      if (rt.meta.kind !== 'group') this.meta.activeLayerId = rt.meta.id;
    });
  }

  setLayerProps(id: string, patch: Partial<Pick<Layer, 'name' | 'opacity' | 'blend' | 'visible' | 'locked' | 'alphaLock' | 'clip' | 'isReference' | 'maskEnabled' | 'data'>>, label?: string): void {
    const l = this.layer(id);
    if (!l) return;
    const before = { ...l.meta, data: { ...l.meta.data } };
    const after = { ...l.meta, ...patch, data: patch.data ? { ...patch.data } : { ...l.meta.data } };
    const apply = (m: Layer) => {
      const rt = this.layer(id);
      if (!rt) return;
      rt.meta = { ...m, data: { ...m.data } };
      if ((rt.meta.kind === 'text' || rt.meta.kind === 'vector')) this.rasterizeLive(rt);
      this.markMeta(id);
      this.invalidate();
    };
    apply(after);
    const keys = Object.keys(patch).join(', ');
    // Consecutive slider drags (opacity) merge into one undo step.
    const cmd: HistoryCommand & { __after: Layer } = {
      label: label ?? `Layer ${keys}`, kind: 'layer', mergeKey: patch.opacity !== undefined ? `opacity:${id}` : undefined,
      __after: after,
      redo: () => apply(after), undo: () => apply(before),
      merge(next) { Object.assign(after, (next as HistoryCommand & { __after: Layer }).__after); return true; },
    };
    this.history.push(cmd);
  }

  /** Move a layer to a new parent/position (index among the parent's children, bottom = 0). */
  moveLayer(id: string, parentId: string | null, index: number): void {
    const l = this.layer(id);
    if (!l) return;
    if (parentId && (parentId === id || this.descendants(id).includes(parentId))) return;
    this.structural(`Move “${l.meta.name}”`, () => {
      const oldParent = l.meta.parentId;
      const siblings = this.children(parentId).filter((s) => s.meta.id !== id);
      siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, l);
      l.meta.parentId = parentId;
      siblings.forEach((s, i) => { s.meta.order = i + 1; });
      this.renumber(oldParent);
    });
  }

  addMask(id: string, fromSelection = false): void {
    const l = this.layer(id);
    if (!l || l.mask) { if (l && !l.meta.hasMask) this.setLayerProps(id, { maskEnabled: true }); return; }
    this.structural('Add layer mask', () => {
      const m = makeCanvas(this.width, this.height);
      const c = ctx2d(m);
      if (fromSelection && this.selection) {
        const img = c.createImageData(this.width, this.height);
        for (let i = 0; i < this.selection.data.length; i++) { img.data[i * 4 + 3] = this.selection.data[i]; }
        c.putImageData(img, 0, 0);
      } else { c.fillStyle = '#ffffff'; c.fillRect(0, 0, this.width, this.height); }
      l.mask = m;
      l.meta.hasMask = true;
      l.meta.maskEnabled = true;
      this.markDirty(id, 'mask', allTiles(this.width, this.height));
      this.editChannel = 'mask';
    });
  }

  removeMask(id: string, apply = false): void {
    const l = this.layer(id);
    if (!l?.mask) return;
    const maskCopy = l.mask;
    const pixelsBefore = apply ? cloneCanvas(l.canvas) : null;
    this.structural(apply ? 'Apply layer mask' : 'Delete layer mask', () => {
      if (apply && pixelsBefore) {
        const c = ctx2d(l.canvas);
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(maskCopy, 0, 0);
        c.globalCompositeOperation = 'source-over';
        this.markDirty(id, 'color', allTiles(this.width, this.height));
      }
      l.mask = null;
      l.meta.hasMask = false;
      this.editChannel = 'color';
      void db.tiles.where('layerId').equals(id).filter((t) => t.channel === 'mask').delete();
    });
    if (apply && pixelsBefore) {
      // Pixel change must be undoable too: wrap the structural entry with pixel restore.
      const entry = this.history.list.at(-1);
      if (entry) {
        const after = cloneCanvas(l.canvas);
        const inner = entry.cmd;
        const put = (src: HTMLCanvasElement) => { const rt = this.layer(id); if (!rt) return; const c = ctx2d(rt.canvas); c.clearRect(0, 0, this.width, this.height); c.drawImage(src, 0, 0); this.markDirty(id, 'color', allTiles(this.width, this.height)); this.invalidate(); };
        entry.cmd = { ...inner, redo: async () => { await inner.redo(); put(after); }, undo: async () => { await inner.undo(); const rt = this.layer(id); if (rt) rt.mask = maskCopy; put(pixelsBefore); } };
      }
    } else {
      const entry = this.history.list.at(-1);
      if (entry) { const inner = entry.cmd; entry.cmd = { ...inner, undo: async () => { await inner.undo(); const rt = this.layer(id); if (rt) { rt.mask = maskCopy; this.markDirty(id, 'mask', allTiles(this.width, this.height)); } } }; }
    }
  }

  /** Merge a layer into the one below (same parent). The result keeps the lower layer's identity. */
  mergeDown(id: string): void {
    const l = this.layer(id);
    if (!l) return;
    const siblings = this.children(l.meta.parentId);
    const idx = siblings.findIndex((s) => s.meta.id === id);
    const below = siblings[idx - 1];
    if (!below || below.meta.kind !== 'raster' || l.meta.kind === 'adjustment') return;
    this.mergeInto(below, [l], `Merge “${l.meta.name}” down`);
  }

  /** Merge all visible layers into one raster layer at the position of the lowest visible layer. */
  mergeVisible(): void {
    const vis = this.layers.filter((l) => l.meta.visible && l.meta.parentId === null && l.meta.kind !== 'adjustment');
    if (vis.length < 2) return;
    const target = vis.sort((a, b) => a.meta.order - b.meta.order)[0];
    if (target.meta.kind !== 'raster') return;
    this.mergeInto(target, vis.filter((v) => v !== target), 'Merge visible', true);
  }

  /** Flatten the whole document into a single layer. */
  flatten(): void {
    const all = this.layers.filter((l) => l.meta.parentId === null);
    if (all.length < 2) return;
    const target = this.children(null)[0];
    if (target.meta.kind !== 'raster') return;
    this.mergeInto(target, all.filter((x) => x !== target), 'Flatten image', true, true);
  }

  private mergeInto(target: LayerRT, sources: LayerRT[], label: string, fullComposite = false, includeHidden = false): void {
    const before = cloneCanvas(target.canvas);
    let after: HTMLCanvasElement;
    if (fullComposite) {
      const ids = new Set([target, ...sources].flatMap((s) => [s.meta.id, ...this.descendants(s.meta.id)]));
      const hide = this.layers.filter((l) => !ids.has(l.meta.id)).map((l) => l.meta.id);
      if (includeHidden) for (const s of [target, ...sources]) s.meta.visible = true;
      after = this.renderTo({ hide });
    } else {
      after = cloneCanvas(this.layerPixels(target, new Set(), {}).canvas);
      const c = ctx2d(after);
      c.globalCompositeOperation = 'source-over';
      for (const s of sources) {
        const px = this.layerPixels(s, new Set(), {});
        c.globalAlpha = s.meta.opacity;
        if (s.meta.clip) {
          const t = cloneCanvas(px.canvas);
          const tc = ctx2d(t);
          tc.globalCompositeOperation = 'destination-in';
          tc.drawImage(after, 0, 0);
          c.globalCompositeOperation = s.meta.blend === 'normal' ? 'source-atop' : compositeOp(s.meta.blend);
          c.drawImage(t, 0, 0);
        } else {
          c.globalCompositeOperation = compositeOp(s.meta.blend);
          c.drawImage(px.canvas, 0, 0);
        }
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
      }
    }
    const targetMaskBefore = target.mask;
    const targetMetaBefore = { ...target.meta };
    const removedIds = new Set(sources.flatMap((s) => [s.meta.id, ...this.descendants(s.meta.id)]));
    this.structural(label, () => {
      this.layers = this.layers.filter((l) => !removedIds.has(l.meta.id));
      removedIds.forEach((id) => this.removedLayers.add(id));
      target.mask = null;
      target.meta.hasMask = false;
      if (fullComposite) { target.meta.opacity = 1; target.meta.blend = 'normal'; target.meta.visible = true; }
      this.renumber(target.meta.parentId);
      this.meta.activeLayerId = target.meta.id;
    });
    const put = (src: HTMLCanvasElement) => {
      const c = ctx2d(target.canvas);
      c.clearRect(0, 0, this.width, this.height);
      c.drawImage(src, 0, 0);
      this.markDirty(target.meta.id, 'color', allTiles(this.width, this.height));
      this.invalidate();
    };
    put(after);
    const entry = this.history.list.at(-1);
    if (entry) {
      const inner = entry.cmd;
      entry.cmd = {
        ...inner, size: (inner.size ?? 0) + this.width * this.height * 8,
        redo: async () => { await inner.redo(); target.mask = null; put(after); },
        undo: async () => { await inner.undo(); target.mask = targetMaskBefore; target.meta = { ...target.meta, ...targetMetaBefore }; put(before); if (targetMaskBefore) this.markDirty(target.meta.id, 'mask', allTiles(this.width, this.height)); },
      };
    }
  }

  /** Whole-layer pixel operation (filters, transforms, fills) as one undoable step. */
  pixelOp(label: string, layerId: string, fn: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void, kind: HistoryCommand['kind'] = 'raster', channel: EditChannel = 'color', rect?: IRect): boolean {
    const edit = this.beginEdit(layerId, channel);
    if (!edit) return false;
    if (rect) edit.touch(rect); else edit.touchAll();
    fn(edit.ctx, edit.target);
    edit.commit(label, kind);
    return true;
  }

  /** Resize the canvas (crop/extend) keeping content anchored at (ox, oy). */
  resizeCanvas(w: number, h: number, ox = 0, oy = 0): void {
    const oldW = this.width, oldH = this.height;
    const snap = this.layers.map((l) => ({ id: l.meta.id, canvas: l.canvas, mask: l.mask }));
    const doResize = (W: number, H: number, dx: number, dy: number, src: typeof snap) => {
      this.meta.width = W; this.meta.height = H;
      for (const s of src) {
        const l = this.layer(s.id);
        if (!l) continue;
        const nc = makeCanvas(l.meta.kind === 'group' || l.meta.kind === 'adjustment' ? 1 : W, l.meta.kind === 'group' || l.meta.kind === 'adjustment' ? 1 : H);
        ctx2d(nc).drawImage(s.canvas, dx, dy);
        l.canvas = nc;
        if (s.mask) { const nm = makeCanvas(W, H); const mc = ctx2d(nm); mc.fillStyle = '#fff'; mc.fillRect(0, 0, W, H); mc.clearRect(dx, dy, s.mask.width, s.mask.height); mc.drawImage(s.mask, dx, dy); l.mask = nm; }
        this.markDirty(l.meta.id, 'color', allTiles(W, H));
        if (l.mask) this.markDirty(l.meta.id, 'mask', allTiles(W, H));
      }
      this.compositeCache = null;
      this.tmpPool = [];
      this.selection = null;
      void db.tiles.where('docId').equals(this.id).delete().then(() => this.save());
      this.invalidate();
    };
    doResize(w, h, ox, oy, snap);
    const after = this.layers.map((l) => ({ id: l.meta.id, canvas: l.canvas, mask: l.mask }));
    this.history.push({
      label: `Canvas size ${w}×${h}`, kind: 'layer', size: w * h * 4 * this.layers.length,
      redo: () => { this.meta.width = w; this.meta.height = h; for (const a of after) { const l = this.layer(a.id); if (l) { l.canvas = a.canvas; l.mask = a.mask; } } this.compositeCache = null; this.tmpPool = []; for (const l of this.layers) { this.markDirty(l.meta.id, 'color', allTiles(w, h)); } void db.tiles.where('docId').equals(this.id).delete().then(() => this.save()); this.invalidate(); },
      undo: () => { this.meta.width = oldW; this.meta.height = oldH; for (const a of snap) { const l = this.layer(a.id); if (l) { l.canvas = a.canvas; l.mask = a.mask; } } this.compositeCache = null; this.tmpPool = []; for (const l of this.layers) { this.markDirty(l.meta.id, 'color', allTiles(oldW, oldH)); } void db.tiles.where('docId').equals(this.id).delete().then(() => this.save()); this.invalidate(); },
    });
  }

  /** Read composite or single-layer pixels at a point (eyedropper). */
  sample(x: number, y: number, source: 'composite' | 'layer'): [number, number, number, number] {
    const src = source === 'layer' && this.active ? this.active.canvas : this.composite();
    const d = ctx2d(src).getImageData(Math.max(0, Math.min(this.width - 1, Math.floor(x))), Math.max(0, Math.min(this.height - 1, Math.floor(y))), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }

  /** Pixels a fill/wand should sample: reference layer if one exists, else composite (or current layer). */
  samplingPixels(mode: 'composite' | 'layer' | 'reference'): ImageData {
    let src: HTMLCanvasElement;
    if (mode === 'reference') {
      const ref = this.layers.find((l) => l.meta.isReference && l.meta.visible);
      src = ref ? ref.canvas : this.composite();
    } else if (mode === 'layer' && this.active) src = this.active.canvas;
    else src = this.composite();
    return ctx2d(src).getImageData(0, 0, this.width, this.height);
  }

  async setName(name: string): Promise<void> { this.meta.name = name; await db.rasterDocs.update(this.id, { name }); this.invalidate(); }

  static tileKey = tileKey;
}

/** Shared open documents (studio tab + canvas thumbnail + inline sketch share one instance). */
const open = new Map<string, { doc: Promise<PaintDocument>; refs: number }>();
export function acquirePaintDoc(id: string): Promise<PaintDocument> {
  let e = open.get(id);
  if (!e) { e = { doc: PaintDocument.load(id), refs: 0 }; open.set(id, e); e.doc.catch(() => open.delete(id)); }
  e.refs++;
  return e.doc;
}
export function releasePaintDoc(id: string): void {
  const e = open.get(id);
  if (!e) return;
  if (--e.refs <= 0) { open.delete(id); void e.doc.then((d) => d.save()); }
}
export function peekPaintDoc(id: string): Promise<PaintDocument> | undefined { return open.get(id)?.doc; }
