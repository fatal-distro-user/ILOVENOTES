/**
 * Brush stroke renderer.
 * Paint/erase/clone/heal strokes stamp coloured dabs into a per-stroke buffer; the buffer is composited onto a
 * snapshot of the layer with the stroke opacity, so overlapping dabs never exceed the opacity cap and brush
 * blend modes (multiply markers) apply once. Smudge/blur/sharpen modify the layer directly per dab.
 */
import type { RasterEdit, PaintDocument } from '../engine/document';
import { makeCanvas, ctx2d, compositeOp } from '../engine/document';
import { Stabilizer, type StrokePoint } from '../stabilizer';
import { DabGenerator, computeDabs, type Dab } from './dynamics';
import type { BrushParams } from './types';
import { stampFor, bucketFor, grainTexture, ditherThreshold } from './stamp';
import { gaussianBlur, sharpen } from '../filters/kernels';
import { luminance } from '../studio/basicTools';
import type { PaintPointer } from '../studio/tools';

export interface StrokeOptions {
  doc: PaintDocument;
  edit: RasterEdit;
  brush: BrushParams;
  color: string;
  /** stroke opacity cap 0..1 */
  opacity: number;
  /** diameter override (px) */
  size: number;
  streamline: number;
  lazyMouse: boolean;
  cloneSource?: { x: number; y: number } | null;
  seed?: number;
}

interface Rect { x: number; y: number; w: number; h: number }

const bufferPool = new Map<string, HTMLCanvasElement>();
function takeBuffer(w: number, h: number): HTMLCanvasElement {
  const key = `${w}x${h}`;
  const c = bufferPool.get(key) ?? makeCanvas(w, h);
  bufferPool.delete(key);
  ctx2d(c).clearRect(0, 0, w, h);
  return c;
}
function giveBuffer(c: HTMLCanvasElement): void { bufferPool.set(`${c.width}x${c.height}`, c); }

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const union = (a: Rect | null, b: Rect): Rect => {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export class BrushStroke {
  private stab: Stabilizer;
  private gen: DabGenerator;
  private points: StrokePoint[] = [];
  private buffer: HTMLCanvasElement | null = null;
  private bctx: CanvasRenderingContext2D | null = null;
  private base: HTMLCanvasElement | null = null;
  private dirty: Rect | null = null;
  private scratch = makeCanvas(8, 8);
  private selCanvas: HTMLCanvasElement | null = null;
  private smudgeCarry: ImageData | null = null;
  private cloneOffset: { x: number; y: number } | null = null;
  private wetColor: [number, number, number];
  private brush: BrushParams;
  private readonly seed: number;
  readonly usesBuffer: boolean;

  constructor(private readonly o: StrokeOptions) {
    this.seed = o.seed ?? Math.floor(Math.random() * 1e9);
    // Size/opacity from the studio override the preset's values.
    this.brush = { ...o.brush, size: o.size };
    const mouse = true;
    this.stab = new Stabilizer({ smoothing: o.streamline, mode: o.lazyMouse ? 'both' : 'average', pullRadius: 30, simulatePressure: mouse, step: Math.max(0.5, Math.min(2, o.size * 0.05)) });
    this.gen = new DabGenerator(this.brush, { seed: this.seed });
    this.usesBuffer = ['paint', 'erase', 'clone', 'heal'].includes(this.brush.mode);
    this.wetColor = parseHex(o.color);
    if (this.usesBuffer) {
      const t = o.edit.target;
      this.base = makeCanvas(t.width, t.height);
      ctx2d(this.base).drawImage(t, 0, 0);
      this.buffer = takeBuffer(t.width, t.height);
      this.bctx = ctx2d(this.buffer);
    }
    if (o.doc.selection) {
      const sel = o.doc.selection;
      this.selCanvas = makeCanvas(sel.width, sel.height);
      const sc = ctx2d(this.selCanvas);
      const img = sc.createImageData(sel.width, sel.height);
      for (let i = 0; i < sel.data.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = sel.data[i]; }
      sc.putImageData(img, 0, 0);
    }
    if (o.cloneSource && (this.brush.mode === 'clone' || this.brush.mode === 'heal')) this.cloneOffset = null;
  }

  /** Feed a pointer sample (doc space). */
  add(p: PaintPointer): void {
    const input = { x: p.x, y: p.y, pressure: p.pointerType === 'pen' ? p.pressure : 0, t: p.t, tiltX: p.tiltX, tiltY: p.tiltY, pointerType: p.pointerType };
    const pts = this.stab.push(input);
    this.points.push(...pts);
    this.renderDabs(this.gen.push(pts));
  }

  /** Finish: flush stabilizer, re-render with taper-end if configured. Returns false if nothing was painted. */
  end(): boolean {
    const tail = this.stab.finish();
    this.points.push(...tail);
    if (this.brush.taperEnd > 0 && this.usesBuffer && this.points.length > 1) {
      // Taper end needs the total length: re-render the whole stroke from scratch.
      this.bctx!.clearRect(0, 0, this.buffer!.width, this.buffer!.height);
      this.dirty = null;
      this.wetColor = parseHex(this.o.color);
      this.cloneOffset = null;
      this.renderDabs(computeDabs(this.points, this.brush, this.seed), true);
    } else this.renderDabs(this.gen.push(tail));
    if (this.buffer) giveBuffer(this.buffer);
    this.buffer = null;
    return this.o.edit.touched > 0;
  }

  cancel(): void {
    if (this.buffer) giveBuffer(this.buffer);
    this.buffer = null;
    this.o.edit.revert();
  }

  private renderDabs(dabs: Dab[], full = false): void {
    if (!dabs.length) return;
    const b = this.brush;
    for (const d of dabs) {
      if (b.mode === 'smudge') this.smudgeDab(d);
      else if (b.mode === 'blur' || b.mode === 'sharpen') this.filterDab(d);
      else this.bufferDab(d);
    }
    if (this.usesBuffer && this.dirty) this.compositeDirty(full);
    this.o.doc.invalidate();
  }

  private dabRect(d: Dab, pad = 2): Rect {
    const r = d.size / 2 + pad;
    return { x: Math.floor(d.x - r), y: Math.floor(d.y - r), w: Math.ceil(r * 2) + 1, h: Math.ceil(r * 2) + 1 };
  }

  /** Stamp one dab into the stroke buffer. */
  private bufferDab(d: Dab): void {
    const b = this.brush;
    const g = this.bctx!;
    const rect = this.dabRect(d);
    this.o.edit.touch(rect);
    this.dirty = union(this.dirty, rect);
    let color = this.o.color;
    if (this.o.edit.channel === 'mask') color = '#ffffff';
    else if (b.wetness > 0 && b.mode === 'paint') {
      // Watercolor/oil: pick up the colour under the dab and mix it into the brush load.
      const under = ctx2d(this.base!).getImageData(Math.max(0, Math.floor(d.x)), Math.max(0, Math.floor(d.y)), 1, 1).data;
      if (under[3] > 10) {
        const k = b.wetness * 0.35;
        this.wetColor = [this.wetColor[0] * (1 - k) + under[0] * k, this.wetColor[1] * (1 - k) + under[1] * k, this.wetColor[2] * (1 - k) + under[2] * k];
      }
      // Paint load recovers toward the brush colour over time.
      const src = parseHex(this.o.color);
      this.wetColor = [this.wetColor[0] * 0.97 + src[0] * 0.03, this.wetColor[1] * 0.97 + src[1] * 0.03, this.wetColor[2] * 0.97 + src[2] * 0.03];
      color = toHex(...this.wetColor);
    }

    if (b.tip === 'pixel' || b.pixelPerfect) {
      const s = Math.max(1, Math.round(d.size));
      const x0 = Math.round(d.x - s / 2), y0 = Math.round(d.y - s / 2);
      g.fillStyle = color;
      g.globalAlpha = 1;
      for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) {
        // Dither brushes: density follows pressure (full pressure = 50% ordered pattern).
        if (b.dither !== 'none' && ditherThreshold(b.dither, x, y) >= d.alpha * 0.5) continue;
        g.fillRect(x, y, 1, 1);
      }
      return;
    }

    if (b.mode === 'clone' || b.mode === 'heal') { this.cloneDab(d, rect); return; }

    const res = bucketFor(d.size);
    const stamp = stampFor(b.tip, b.hardness, res, b.bristles);
    // Tint the stamp in a scratch canvas sized to the dab's bounding box.
    const sw = rect.w, sh = rect.h;
    if (this.scratch.width < sw || this.scratch.height < sh) { this.scratch.width = Math.max(sw, this.scratch.width); this.scratch.height = Math.max(sh, this.scratch.height); }
    const s = ctx2d(this.scratch);
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.globalAlpha = 1;
    s.clearRect(0, 0, sw, sh);
    s.translate(d.x - rect.x, d.y - rect.y);
    s.rotate(d.angle);
    s.scale(1, Math.max(0.05, d.roundness));
    s.drawImage(stamp, -d.size / 2, -d.size / 2, d.size, d.size);
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-in';
    s.fillStyle = color;
    s.fillRect(0, 0, sw, sh);
    if (b.grain > 0) {
      // Paper texture is anchored to the document (not the dab): keep paint only where the paper "accepts" it.
      const tex = grainTexture(b.grainScale, b.grain);
      const pat = s.createPattern(tex, 'repeat');
      if (pat) {
        pat.setTransform(new DOMMatrix().translateSelf(-(rect.x % tex.width), -(rect.y % tex.height)));
        s.globalCompositeOperation = 'destination-in';
        s.fillStyle = pat;
        s.fillRect(0, 0, sw, sh);
      }
    }
    s.globalCompositeOperation = 'source-over';
    g.globalAlpha = d.alpha;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.scratch, 0, 0, sw, sh, rect.x, rect.y, sw, sh);
    g.globalAlpha = 1;
  }

  /** Clone/heal: copy pixels from the source offset (sampled from the pre-stroke snapshot). */
  private cloneDab(d: Dab, rect: Rect): void {
    if (!this.o.cloneSource) return;
    if (!this.cloneOffset) this.cloneOffset = { x: this.o.cloneSource.x - d.x, y: this.o.cloneSource.y - d.y };
    const off = this.cloneOffset;
    const sw = rect.w, sh = rect.h;
    if (this.scratch.width < sw || this.scratch.height < sh) { this.scratch.width = Math.max(sw, this.scratch.width); this.scratch.height = Math.max(sh, this.scratch.height); }
    const s = ctx2d(this.scratch);
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.globalAlpha = 1;
    s.clearRect(0, 0, this.scratch.width, this.scratch.height);
    s.drawImage(this.base!, rect.x + off.x, rect.y + off.y, sw, sh, 0, 0, sw, sh);
    if (this.brush.mode === 'heal') {
      // Healing: keep the source texture but shift its mean colour to match the destination area.
      const src = s.getImageData(0, 0, sw, sh);
      const dst = ctx2d(this.base!).getImageData(rect.x, rect.y, sw, sh);
      const mean = (img: ImageData) => { let r = 0, g = 0, bb = 0, n = 0; for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 0) { r += img.data[i]; g += img.data[i + 1]; bb += img.data[i + 2]; n++; } return n ? [r / n, g / n, bb / n] : [0, 0, 0]; };
      const ms = mean(src), md = mean(dst);
      for (let i = 0; i < src.data.length; i += 4) { src.data[i] += md[0] - ms[0]; src.data[i + 1] += md[1] - ms[1]; src.data[i + 2] += md[2] - ms[2]; }
      s.putImageData(src, 0, 0);
    }
    // Shape by the tip.
    const stamp = stampFor('round', this.brush.hardness, bucketFor(d.size));
    s.globalCompositeOperation = 'destination-in';
    s.translate(d.x - rect.x, d.y - rect.y);
    s.drawImage(stamp, -d.size / 2, -d.size / 2, d.size, d.size);
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    const g = this.bctx!;
    g.globalAlpha = d.alpha;
    g.drawImage(this.scratch, 0, 0, sw, sh, rect.x, rect.y, sw, sh);
    g.globalAlpha = 1;
  }

  /** Redraw the dirty region: base snapshot + buffer composited with the stroke opacity & mode. */
  private compositeDirty(full: boolean): void {
    const t = this.o.edit.ctx;
    const r = full ? { x: 0, y: 0, w: this.base!.width, h: this.base!.height } : this.dirty!;
    const x = Math.max(0, r.x), y = Math.max(0, r.y), w = Math.min(this.base!.width - x, r.w), h = Math.min(this.base!.height - y, r.h);
    if (w <= 0 || h <= 0) return;
    let src: HTMLCanvasElement = this.buffer!;
    if (this.selCanvas) {
      // Restrict the stroke to the selection.
      const tmp = makeCanvas(w, h);
      const tc = ctx2d(tmp);
      tc.drawImage(this.buffer!, x, y, w, h, 0, 0, w, h);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(this.selCanvas, x, y, w, h, 0, 0, w, h);
      src = tmp;
    }
    const sx = src === this.buffer ? x : 0, sy = src === this.buffer ? y : 0;
    t.save();
    t.globalAlpha = 1;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(x, y, w, h);
    t.drawImage(this.base!, x, y, w, h, x, y, w, h);
    const b = this.brush;
    const erase = b.mode === 'erase';
    if (this.o.edit.channel === 'mask') {
      const reveal = !erase && luminance(this.o.color) >= 0.5;
      t.globalCompositeOperation = reveal ? 'source-over' : 'destination-out';
    } else if (erase) t.globalCompositeOperation = 'destination-out';
    else if (this.o.edit.layer.meta.alphaLock) t.globalCompositeOperation = 'source-atop';
    else t.globalCompositeOperation = compositeOp(b.blend);
    t.globalAlpha = Math.max(0, Math.min(1, this.o.opacity * b.opacity));
    t.drawImage(src, sx, sy, w, h, x, y, w, h);
    t.restore();
    if (!full) this.dirty = null;
  }

  /** Smudge: drag carried paint along the stroke. */
  private smudgeDab(d: Dab): void {
    const size = Math.max(2, Math.round(this.brush.size));
    const rect = { x: Math.round(d.x - size / 2), y: Math.round(d.y - size / 2), w: size, h: size };
    this.o.edit.touch(rect);
    const c = this.o.edit.ctx;
    const under = c.getImageData(rect.x, rect.y, rect.w, rect.h);
    if (!this.smudgeCarry) { this.smudgeCarry = under; return; }
    const carry = this.smudgeCarry;
    const weights = this.weights(rect, d, this.brush.strength * d.alpha);
    const out = new ImageData(new Uint8ClampedArray(under.data), rect.w, rect.h);
    for (let i = 0, p = 0; p < weights.length; p++, i += 4) {
      const k = weights[p];
      if (!k) continue;
      // Premultiplied mix so transparent pixels don't drag in black.
      const ca = carry.data[i + 3] / 255, ua = under.data[i + 3] / 255;
      const a = ua + (ca - ua) * k;
      out.data[i + 3] = a * 255;
      for (let ch = 0; ch < 3; ch++) {
        const v = (under.data[i + ch] * ua + (carry.data[i + ch] * ca - under.data[i + ch] * ua) * k) / (a || 1);
        out.data[i + ch] = v;
      }
    }
    c.putImageData(out, rect.x, rect.y);
    // The brush picks up some of the new surface.
    const keep = 0.65 + this.brush.strength * 0.3;
    for (let i = 0; i < carry.data.length; i++) carry.data[i] = carry.data[i] * keep + out.data[i] * (1 - keep);
  }

  private filterDab(d: Dab): void {
    const r = Math.ceil(d.size / 2) + 4;
    const rect = { x: Math.floor(d.x - r), y: Math.floor(d.y - r), w: r * 2, h: r * 2 };
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y), w = Math.min(this.o.doc.width - x, rect.w - (x - rect.x)), h = Math.min(this.o.doc.height - y, rect.h - (y - rect.y));
    if (w <= 0 || h <= 0) return;
    const R = { x, y, w, h };
    this.o.edit.touch(R);
    const c = this.o.edit.ctx;
    const orig = c.getImageData(x, y, w, h);
    const img = { width: w, height: h, data: orig.data };
    const filtered = this.brush.mode === 'blur' ? gaussianBlur(img, { radius: Math.max(1, d.size * 0.08) }) : sharpen(img, { amount: 70, radius: 1 });
    const weights = this.weights(R, d, this.brush.strength * d.alpha);
    for (let i = 0, p = 0; p < weights.length; p++, i += 4) {
      const k = weights[p];
      if (!k) continue;
      for (let ch = 0; ch < 4; ch++) orig.data[i + ch] = orig.data[i + ch] + (filtered.data[i + ch] - orig.data[i + ch]) * k;
    }
    c.putImageData(orig, x, y);
  }

  /** Per-pixel weight = tip falloff × strength × selection. */
  private weights(rect: Rect, d: Dab, strength: number): Float32Array {
    const w = new Float32Array(rect.w * rect.h);
    const rad = d.size / 2, hard = this.brush.hardness;
    const sel = this.o.doc.selection;
    for (let yy = 0; yy < rect.h; yy++) for (let xx = 0; xx < rect.w; xx++) {
      const dx = rect.x + xx + 0.5 - d.x, dy = rect.y + yy + 0.5 - d.y;
      const dist = Math.hypot(dx, dy) / Math.max(0.5, rad);
      if (dist >= 1) continue;
      const fall = dist <= hard ? 1 : 1 - (dist - hard) / Math.max(1e-3, 1 - hard);
      let k = fall * strength;
      if (sel) {
        const sx = rect.x + xx, sy = rect.y + yy;
        k *= sx >= 0 && sy >= 0 && sx < sel.width && sy < sel.height ? sel.data[sy * sel.width + sx] / 255 : 0;
      }
      w[yy * rect.w + xx] = Math.max(0, Math.min(1, k));
    }
    return w;
  }
}
