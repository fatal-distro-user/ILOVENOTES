import { create } from 'zustand';
import { SquareDashed, CircleDashed, Lasso, Spline, Wand2, Scaling, FlipHorizontal2, FlipVertical2, Check, X } from 'lucide-react';
import { registerPaintTool, registerPaintOverlay, type ToolContext, type PaintPointer } from '../studio/tools';
import { usePaintStudio } from '../studio/store';
import { makeCanvas, ctx2d, type PaintDocument, type RasterEdit } from '../engine/document';
import { regionMask } from '../fill/floodFill';
import { createMask, featherMask, maskBounds } from '../fill/mask';
import { polygonMask, rectPoints, ellipsePoints, applyMode, modeFromModifiers, setSelection, selectionOutline, maskToCanvas, type P, type SelectMode } from './selection';
import { FloatingTransform, type TransformMode, type FreeState } from './transform';
import { toast } from '@/store/status';

interface SelectOptions {
  mode: SelectMode; feather: number; antialias: boolean;
  wandTolerance: number; wandContiguous: boolean; wandSample: 'layer' | 'composite' | 'reference';
  set(p: Partial<Omit<SelectOptions, 'set'>>): void;
}
export const useSelectOptions = create<SelectOptions>()((set) => ({
  mode: 'replace', feather: 0, antialias: true, wandTolerance: 32, wandContiguous: true, wandSample: 'composite',
  set: (p) => set(p),
}));

/** In-progress selection shape preview (doc space). */
let preview: P[] | null = null;
let polyPoints: P[] = [];

function commitShape(doc: PaintDocument, pts: P[], modeOverride: SelectMode | null, label: string): void {
  const o = useSelectOptions.getState();
  let m = polygonMask(doc.width, doc.height, pts, o.antialias);
  if (o.feather > 0) m = featherMask(m, o.feather);
  setSelection(doc, applyMode(doc.selection, m, modeOverride ?? o.mode), label);
}

function effectiveMode(p: PaintPointer): SelectMode | null {
  return p.shift || p.alt ? modeFromModifiers(p.shift, p.alt) : null;
}

function SelectOptionsBar({ wand }: { wand?: boolean }) {
  const o = useSelectOptions();
  return (
    <div className="flex items-center gap-3 whitespace-nowrap text-[12px]">
      <div className="flex overflow-hidden rounded border border-line" title="Selection mode (Shift = add, Alt = subtract, Shift+Alt = intersect)">
        {(['replace', 'add', 'subtract', 'intersect'] as SelectMode[]).map((m) => (
          <button key={m} onClick={() => o.set({ mode: m })} className={o.mode === m ? 'bg-accent px-2 py-0.5 text-accent-fg' : 'px-2 py-0.5 text-fg-muted hover:bg-bg-3'} data-testid={`select-mode-${m}`}>{m}</button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-fg-muted">Feather<input type="number" min={0} max={200} value={o.feather} onChange={(e) => o.set({ feather: Math.max(0, Number(e.target.value)) })} className="w-14 rounded border border-line bg-bg-2 px-1" /></label>
      <label className="flex items-center gap-1 text-fg-muted"><input type="checkbox" checked={o.antialias} onChange={(e) => o.set({ antialias: e.target.checked })} />Anti-alias</label>
      {wand && <>
        <label className="flex items-center gap-1 text-fg-muted">Tolerance<input type="range" min={0} max={255} value={o.wandTolerance} onChange={(e) => o.set({ wandTolerance: Number(e.target.value) })} className="w-24 accent-[var(--iln-accent)]" data-testid="wand-tolerance" /><span className="w-7 tabular-nums">{o.wandTolerance}</span></label>
        <label className="flex items-center gap-1 text-fg-muted"><input type="checkbox" checked={o.wandContiguous} onChange={(e) => o.set({ wandContiguous: e.target.checked })} data-testid="wand-contiguous" />Contiguous</label>
        <select value={o.wandSample} onChange={(e) => o.set({ wandSample: e.target.value as SelectOptions['wandSample'] })} className="rounded border border-line bg-bg-2 px-1">
          <option value="composite">Sample all layers</option><option value="layer">Current layer</option><option value="reference">Reference layer</option>
        </select>
      </>}
    </div>
  );
}

const drawPreview = (ctx: ToolContext, g: CanvasRenderingContext2D, pts: P[] | null, closed = true) => {
  if (!pts || pts.length < 2) return;
  g.lineWidth = 1 / ctx.zoom;
  for (const [color, off] of [['#000', 0], ['#fff', 4]] as const) {
    g.strokeStyle = color;
    g.setLineDash([4 / ctx.zoom, 4 / ctx.zoom]);
    g.lineDashOffset = off / ctx.zoom;
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    if (closed) g.closePath();
    g.stroke();
  }
  g.setLineDash([]);
};

// Marching ants for the current selection (all tools).
registerPaintOverlay((ctx, g) => {
  const path = selectionOutline(ctx.doc);
  if (!path) return;
  const t = (Date.now() / 60) % 8;
  g.lineWidth = 1 / ctx.zoom;
  g.strokeStyle = '#000';
  g.setLineDash([4 / ctx.zoom, 4 / ctx.zoom]);
  g.lineDashOffset = -t / ctx.zoom;
  g.stroke(path);
  g.strokeStyle = '#fff';
  g.lineDashOffset = (-t + 4) / ctx.zoom;
  g.stroke(path);
  g.setLineDash([]);
});

function dragShapeTool(id: string, label: string, icon: typeof SquareDashed, key: string | undefined, order: number, shape: (a: P, b: P, p: PaintPointer) => P[]) {
  registerPaintTool({
    id, label, icon, key, group: 'select', order, cursor: () => 'crosshair',
    down(ctx, p0) {
      const mode = effectiveMode(p0);
      preview = null;
      return {
        move(p) { preview = shape(p0, p, p); ctx.redrawOverlay(); },
        up(p) {
          const pts = preview;
          preview = null;
          if (!pts || Math.hypot(p.x - p0.x, p.y - p0.y) < 2) { if (!mode && ctx.doc.selection) setSelection(ctx.doc, null, 'Deselect'); ctx.redrawOverlay(); return; }
          commitShape(ctx.doc, pts, mode, label);
        },
        cancel() { preview = null; },
      };
    },
    drawOverlay(ctx, g) { drawPreview(ctx, g, preview); },
    Options: () => <SelectOptionsBar />,
  });
}

const constrainSquare = (a: P, b: P, p: PaintPointer): P => {
  if (!p.shift || p.alt) return b;
  const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s };
};
dragShapeTool('select-rect', 'Rectangular marquee', SquareDashed, 'm', 40, (a, b, p) => rectPoints(a, constrainSquare(a, b, p)));
dragShapeTool('select-ellipse', 'Elliptical marquee', CircleDashed, undefined, 41, (a, b, p) => ellipsePoints(a, constrainSquare(a, b, p)));

registerPaintTool({
  id: 'lasso', label: 'Lasso (freehand)', icon: Lasso, key: 'l', group: 'select', order: 42, cursor: () => 'crosshair',
  down(ctx, p0) {
    const mode = effectiveMode(p0);
    preview = [{ x: p0.x, y: p0.y }];
    return {
      move(p) { const last = preview![preview!.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) * ctx.zoom > 1.5) preview!.push({ x: p.x, y: p.y }); ctx.redrawOverlay(); },
      up() { const pts = preview; preview = null; if (pts && pts.length > 2) commitShape(ctx.doc, pts, mode, 'Lasso selection'); ctx.redrawOverlay(); },
      cancel() { preview = null; },
    };
  },
  drawOverlay(ctx, g) { drawPreview(ctx, g, preview, false); },
  Options: () => <SelectOptionsBar />,
});

registerPaintTool({
  id: 'lasso-poly', label: 'Polygonal lasso', icon: Spline, group: 'select', order: 43, cursor: () => 'crosshair',
  down(ctx, p0) {
    const close = polyPoints.length > 2 && Math.hypot(p0.x - polyPoints[0].x, p0.y - polyPoints[0].y) * ctx.zoom < 8;
    if (close) {
      const pts = polyPoints;
      polyPoints = [];
      commitShape(ctx.doc, pts, effectiveMode(p0), 'Polygonal selection');
      return null;
    }
    polyPoints.push({ x: p0.x, y: p0.y });
    ctx.redrawOverlay();
    return null;
  },
  onKey(ctx, e) {
    if (e.key === 'Enter' && polyPoints.length > 2) { const pts = polyPoints; polyPoints = []; commitShape(ctx.doc, pts, null, 'Polygonal selection'); return true; }
    if (e.key === 'Escape' && polyPoints.length) { polyPoints = []; ctx.redrawOverlay(); return true; }
    if (e.key === 'Backspace' && polyPoints.length) { polyPoints.pop(); ctx.redrawOverlay(); return true; }
    return false;
  },
  drawOverlay(ctx, g, hover) {
    if (!polyPoints.length) return;
    drawPreview(ctx, g, hover ? [...polyPoints, { x: hover.x, y: hover.y }] : polyPoints, false);
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    const r = 3.5 / ctx.zoom;
    g.beginPath(); g.arc(polyPoints[0].x, polyPoints[0].y, r, 0, Math.PI * 2); g.fill(); g.stroke();
  },
  Options: () => <div className="flex items-center gap-3"><SelectOptionsBar /><span className="text-fg-faint">Click points · click start or Enter to close · Backspace removes · Esc cancels</span></div>,
});

registerPaintTool({
  id: 'wand', label: 'Magic wand', icon: Wand2, key: 'w', group: 'select', order: 44, cursor: () => 'crosshair',
  down(ctx, p) {
    const o = useSelectOptions.getState();
    const src = ctx.doc.samplingPixels(o.wandSample);
    let m = regionMask({ width: src.width, height: src.height, data: src.data }, p.x, p.y, { tolerance: o.wandTolerance, contiguous: o.wandContiguous, bleed: o.antialias ? 1 : 0 });
    if (o.feather > 0) m = featherMask(m, o.feather);
    setSelection(ctx.doc, applyMode(ctx.doc.selection, m, effectiveMode(p) ?? o.mode), 'Magic wand');
    return null;
  },
  Options: () => <SelectOptionsBar wand />,
});

// ───────────────────────── Free transform ─────────────────────────

interface Floating { ft: FloatingTransform; edit: RasterEdit; base: HTMLCanvasElement; doc: PaintDocument; selectionBefore: ReturnType<typeof createMask> | null }
interface TransformUi { floating: Floating | null; mode: TransformMode; set(p: Partial<Omit<TransformUi, 'set'>>): void }
export const useTransform = create<TransformUi>()((set) => ({ floating: null, mode: 'free', set: (p) => set(p) }));

function redrawFloating(f: Floating): void {
  const c = f.edit.ctx;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, f.doc.width, f.doc.height);
  c.drawImage(f.base, 0, 0);
  f.ft.render(c);
  c.restore();
  f.doc.invalidate();
}

/** Lift the selected pixels (or the whole layer) of the active layer into a floating transform. */
export function startTransform(doc: PaintDocument): Floating | null {
  const existing = useTransform.getState().floating;
  if (existing && existing.doc === doc) return existing;
  const edit = doc.beginEdit(undefined, 'color');
  if (!edit) { toast('Select an unlocked raster layer to transform', 'error'); return null; }
  edit.touchAll();
  const sel = doc.selection;
  const b = sel ? maskBounds(sel) : null;
  const layer = edit.target;
  // Bounds of the content to lift.
  let rect = b ?? contentBounds(layer);
  if (!rect) { toast('Nothing to transform on this layer', 'error'); edit.revert(); return null; }
  rect = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: Math.min(doc.width - Math.max(0, rect.x), rect.w), h: Math.min(doc.height - Math.max(0, rect.y), rect.h) };
  const src = makeCanvas(rect.w, rect.h);
  const sc = ctx2d(src);
  sc.drawImage(layer, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const base = makeCanvas(doc.width, doc.height);
  const bc = ctx2d(base);
  bc.drawImage(layer, 0, 0);
  if (sel) {
    const selC = maskToCanvas(sel);
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(selC, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    bc.globalCompositeOperation = 'destination-out';
    bc.drawImage(selC, 0, 0);
  } else bc.clearRect(0, 0, doc.width, doc.height);
  const f: Floating = { ft: new FloatingTransform(src, rect), edit, base, doc, selectionBefore: sel };
  useTransform.getState().set({ floating: f, mode: 'free' });
  redrawFloating(f);
  return f;
}

function contentBounds(c: HTMLCanvasElement) {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  const m = createMask(c.width, c.height);
  for (let i = 0; i < m.data.length; i++) m.data[i] = d[i * 4 + 3];
  return maskBounds(m);
}

export function applyTransform(): void {
  const f = useTransform.getState().floating;
  if (!f) return;
  useTransform.getState().set({ floating: null });
  redrawFloating(f);
  f.edit.commit('Transform');
  // The selection follows the transformed pixels.
  if (f.selectionBefore) {
    const tmp = makeCanvas(f.doc.width, f.doc.height);
    f.ft.render(ctx2d(tmp));
    const d = ctx2d(tmp).getImageData(0, 0, tmp.width, tmp.height).data;
    const m = createMask(tmp.width, tmp.height);
    for (let i = 0; i < m.data.length; i++) m.data[i] = d[i * 4 + 3] ? 255 : 0;
    setSelection(f.doc, m, 'Transform selection');
  }
}

export function cancelTransform(): void {
  const f = useTransform.getState().floating;
  if (!f) return;
  useTransform.getState().set({ floating: null });
  f.edit.revert();
}

// Switching away from the transform tool applies a pending transform.
usePaintStudio.subscribe((s, prev) => { if (prev.tool === 'transform' && s.tool !== 'transform') applyTransform(); });

registerPaintTool({
  id: 'transform', label: 'Free transform / distort / warp', icon: Scaling, key: 't', group: 'transform', order: 31, cursor: () => 'default',
  down(ctx, p0) {
    const f = startTransform(ctx.doc);
    if (!f) return null;
    const handles = f.ft.handles();
    const tol = 8 / ctx.zoom;
    const hit = handles.find((h) => Math.hypot(h.p.x - p0.x, h.p.y - p0.y) <= tol);
    const start: FreeState = { ...f.ft.free };
    if (hit) {
      return {
        move(p) { f.ft.dragHandle(hit.id, p, start, { keepAspect: p.shift, snapAngle: p.shift }); redrawFloating(f); ctx.redrawOverlay(); },
        up() { ctx.redrawOverlay(); },
      };
    }
    if (f.ft.contains(p0) || f.ft.mode !== 'free') {
      let last = p0;
      return {
        move(p) { f.ft.translate(p.x - last.x, p.y - last.y); last = p; redrawFloating(f); ctx.redrawOverlay(); },
        up() { ctx.redrawOverlay(); },
      };
    }
    // Clicking outside in free mode rotates around the centre (like Photoshop).
    const a0 = Math.atan2(p0.y - start.cy, p0.x - start.cx);
    return {
      move(p) { let a = start.rotation + Math.atan2(p.y - start.cy, p.x - start.cx) - a0; if (p.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); f.ft.free.rotation = a; redrawFloating(f); ctx.redrawOverlay(); },
      up() { ctx.redrawOverlay(); },
    };
  },
  onKey(_ctx, e) {
    if (!useTransform.getState().floating) return false;
    if (e.key === 'Enter') { applyTransform(); return true; }
    if (e.key === 'Escape') { cancelTransform(); return true; }
    return false;
  },
  drawOverlay(ctx, g) {
    const f = useTransform.getState().floating;
    if (!f || f.doc !== ctx.doc) return;
    const outline = f.ft.outline();
    g.lineWidth = 1 / ctx.zoom;
    g.strokeStyle = '#2563eb';
    g.beginPath(); outline.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke();
    if (f.ft.mode === 'warp') {
      const n = f.ft.gridN + 1;
      g.strokeStyle = 'rgba(37,99,235,.6)';
      for (let j = 0; j < n; j++) { g.beginPath(); for (let i = 0; i < n; i++) { const p = f.ft.grid[j * n + i]; if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); } g.stroke(); }
      for (let i = 0; i < n; i++) { g.beginPath(); for (let j = 0; j < n; j++) { const p = f.ft.grid[j * n + i]; if (j) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); } g.stroke(); }
    }
    const r = 4.5 / ctx.zoom;
    for (const h of f.ft.handles()) {
      g.fillStyle = '#fff';
      g.strokeStyle = '#2563eb';
      g.beginPath();
      if (h.id === 'rot') g.arc(h.p.x, h.p.y, r, 0, Math.PI * 2); else g.rect(h.p.x - r, h.p.y - r, r * 2, r * 2);
      g.fill(); g.stroke();
    }
  },
  Options: function TransformOptions() {
    const t = useTransform();
    const doc = usePaintStudio((s) => s.doc);
    const setMode = (m: TransformMode) => { const f = t.floating ?? (doc ? startTransform(doc) : null); if (!f) return; f.ft.setMode(m); useTransform.getState().set({ mode: m }); redrawFloating(f); };
    const flip = (axis: 'x' | 'y') => { const f = t.floating ?? (doc ? startTransform(doc) : null); if (!f) return; f.ft.flip(axis); redrawFloating(f); };
    return (
      <div className="flex items-center gap-2 whitespace-nowrap text-[12px]">
        <div className="flex overflow-hidden rounded border border-line">
          {(['free', 'distort', 'warp'] as TransformMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={t.mode === m ? 'bg-accent px-2 py-0.5 text-accent-fg' : 'px-2 py-0.5 text-fg-muted hover:bg-bg-3'} data-testid={`transform-mode-${m}`}>{m === 'distort' ? 'perspective / distort' : m}</button>
          ))}
        </div>
        <button className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-3" onClick={() => flip('x')} data-testid="transform-flip-h"><FlipHorizontal2 size={13} />Flip H</button>
        <button className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-bg-3" onClick={() => flip('y')} data-testid="transform-flip-v"><FlipVertical2 size={13} />Flip V</button>
        {t.floating && <>
          <button className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-accent-fg" onClick={applyTransform} data-testid="transform-apply"><Check size={13} />Apply (Enter)</button>
          <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-bg-3" onClick={cancelTransform} data-testid="transform-cancel"><X size={13} />Cancel (Esc)</button>
        </>}
        {!t.floating && <span className="text-fg-faint">Drag on the canvas to start transforming the selection (or the whole layer)</span>}
      </div>
    );
  },
});
