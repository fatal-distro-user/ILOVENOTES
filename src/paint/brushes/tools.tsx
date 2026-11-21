import { Brush, Eraser, Fingerprint, Droplets, Sparkles, Stamp, Bandage, type LucideIcon } from 'lucide-react';
import { registerPaintTool, type ToolContext, type PaintPointer } from '../studio/tools';
import { usePaintStudio } from '../studio/store';
import { BrushStroke } from './engine';
import { useBrushes, presetForTool, allPresets, type BrushToolId } from './store';
import { outlineFor, outlineToSvgPath } from '@/canvas/ink';
import { toast } from '@/store/status';
import type { PaintDocument } from '../engine/document';
import { useGuides } from '../geometry/guidesUi';
import { symmetryTransforms } from '../geometry/guides';
import { HOLD_MS, recognize, shapeStrokePoints, editableHandles, moveHandle, quickShapeState } from '../geometry/quickPaint';
import type { QuickShape } from '../geometry/quickshape';
import type { BrushParams } from './types';

interface StrokeSettings { preset: BrushParams; color: string; opacity: number; size: number; layerId: string; tool: BrushToolId }

function transformsFor(doc: PaintDocument) {
  const g = useGuides.getState();
  if (g.symmetry.mode === 'off') return undefined;
  const c = g.symmetry.center;
  const cfg = c.x > 0 && c.y > 0 && c.x < doc.width && c.y < doc.height ? g.symmetry : { ...g.symmetry, center: { x: doc.width / 2, y: doc.height / 2 } };
  return symmetryTransforms(cfg);
}

/** Paint a recognised shape as a single stroke with the given settings (QuickShape edits). */
function paintShape(doc: PaintDocument, shape: QuickShape, set: StrokeSettings): boolean {
  doc.setActive(set.layerId);
  const edit = doc.beginEdit();
  if (!edit) return false;
  const stroke = new BrushStroke({ doc, edit, brush: set.preset, color: set.color, opacity: set.opacity, size: set.size, streamline: 0, lazyMouse: false, transforms: transformsFor(doc) });
  stroke.replaceWithPoints(shapeStrokePoints(shape, 0.85));
  stroke.end();
  edit.commit(`QuickShape ${shape.type}`);
  return true;
}

function rememberShape(doc: PaintDocument, shape: QuickShape, set: StrokeSettings): void {
  quickShapeState.set({
    doc, shape, layerId: set.layerId, historyLen: doc.history.list.length,
    repaint: async (next) => {
      await doc.history.undo();
      if (paintShape(doc, next, set)) rememberShape(doc, next, set);
    },
  });
}

/** Vector layers: brush strokes become editable vector shapes; the eraser removes whole shapes. */
function vectorStroke(doc: PaintDocument, p0: PaintPointer, erase: boolean) {
  const layer = doc.active!;
  const pts: number[] = [p0.x, p0.y, p0.pointerType === 'pen' ? p0.pressure : 0.5, 0];
  const st = usePaintStudio.getState();
  const hits = new Set<number>();
  const probe = document.createElement('canvas').getContext('2d')!;
  const shapes = (layer.meta.data.shapes as { path: string; fill?: string; stroke?: string; width?: number }[] | undefined) ?? [];
  const eraseAt = (x: number, y: number) => {
    const r = st.size / 2;
    shapes.forEach((s, i) => {
      const path = new Path2D(s.path);
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (probe.isPointInPath(path, x + dx, y + dy)) { hits.add(i); break; }
    });
  };
  if (erase) eraseAt(p0.x, p0.y);
  return {
    move(p: PaintPointer) { if (erase) eraseAt(p.x, p.y); else pts.push(p.x, p.y, p.pointerType === 'pen' ? p.pressure : 0.5, p.t); },
    up() {
      if (erase) {
        if (!hits.size) return;
        doc.setLayerProps(layer.meta.id, { data: { ...layer.meta.data, shapes: shapes.filter((_, i) => !hits.has(i)) } }, `Erase ${hits.size} vector shape(s)`);
        return;
      }
      if (pts.length < 8) return;
      const path = outlineToSvgPath(outlineFor(pts, 'pen', st.size));
      doc.setLayerProps(layer.meta.id, { data: { ...layer.meta.data, shapes: [...shapes, { path, fill: st.color }] } }, 'Vector stroke');
    },
  };
}

let previewShape: QuickShape | null = null;

function brushTool(tool: BrushToolId, icon: LucideIcon, label: string, key: string | undefined, group: 'paint' | 'retouch', order: number) {
  registerPaintTool({
    id: tool, label, icon, key, group, order,
    cursor: () => 'none',
    down(ctx: ToolContext, p0: PaintPointer) {
      const doc = ctx.doc;
      // Drag a QuickShape handle of the last snapped shape.
      const qs = (tool === 'brush' || tool === 'eraser') ? quickShapeState.get() : null;
      if (qs && qs.doc === doc) {
        const hs = editableHandles(qs.shape);
        const idx = hs.findIndex((h) => Math.hypot(h.x - p0.x, h.y - p0.y) * ctx.zoom <= 9);
        if (idx >= 0) {
          let next = qs.shape;
          return {
            move(p: PaintPointer) { next = moveHandle(qs.shape, idx, { x: p.x, y: p.y }); previewShape = next; ctx.redrawOverlay(); },
            up() { previewShape = null; void qs.repaint(next).then(() => ctx.redrawOverlay()); },
            cancel() { previewShape = null; },
          };
        }
      }
      quickShapeState.set(null);
      const active = doc.active;
      if (!active) { toast('Select a layer first', 'error'); return null; }
      if (active.meta.locked) { toast('Layer is locked', 'error'); return null; }
      if (active.meta.kind === 'vector' && (tool === 'brush' || tool === 'eraser') && doc.editChannel === 'color') return vectorStroke(doc, p0, tool === 'eraser');
      if ((tool === 'clone' || tool === 'heal') && p0.alt) {
        useBrushes.getState().set({ cloneSource: { x: p0.x, y: p0.y } });
        toast('Clone source set', 'ok');
        ctx.redrawOverlay();
        return null;
      }
      if ((tool === 'clone' || tool === 'heal') && !useBrushes.getState().cloneSource) { toast('Alt-click to set the source point first', 'error'); return null; }
      const edit = doc.beginEdit();
      if (!edit) { toast(active.meta.kind === 'raster' ? 'This layer cannot be painted' : 'Select a raster layer (or a mask) to paint', 'error'); return null; }
      const preset = presetForTool(tool);
      const st = usePaintStudio.getState();
      const b = useBrushes.getState();
      const size = tool === 'brush' || tool === 'eraser' ? st.size : Math.max(st.size, 4);
      const stroke = new BrushStroke({
        doc, edit, brush: preset, color: st.color, opacity: st.opacity, size,
        streamline: b.streamline ?? preset.streamline, lazyMouse: b.lazyMouse, cloneSource: b.cloneSource, transforms: transformsFor(doc),
      });
      stroke.add(p0);
      const startSource = b.cloneSource;
      let last = p0;
      // QuickShape: holding still for HOLD_MS converts the stroke into a clean shape.
      let snapped: QuickShape | null = null;
      let holdTimer: number | undefined;
      const canSnap = (tool === 'brush' || tool === 'eraser') && useGuides.getState().quickShape;
      const armHold = () => {
        if (!canSnap || snapped) return;
        window.clearTimeout(holdTimer);
        holdTimer = window.setTimeout(() => {
          const shape = recognize(stroke.recorded);
          if (!shape) return;
          snapped = shape;
          stroke.replaceWithPoints(shapeStrokePoints(shape, 0.85));
          ctx.redrawOverlay();
        }, HOLD_MS);
      };
      armHold();
      return {
        move(p: PaintPointer) {
          if (Math.hypot(p.x - last.x, p.y - last.y) * ctx.zoom > 2) armHold();
          stroke.add(p);
          last = p;
        },
        up() {
          window.clearTimeout(holdTimer);
          const painted = stroke.end();
          if (painted) edit.commit(snapped ? `QuickShape ${snapped.type}` : `${label} (${preset.name})`);
          if (painted && snapped) rememberShape(doc, snapped, { preset, color: st.color, opacity: st.opacity, size, layerId: edit.layer.meta.id, tool });
          // Aligned clone: the source point travels with the brush, so the next stroke continues the sample.
          if (startSource && (tool === 'clone' || tool === 'heal')) {
            useBrushes.getState().set({ cloneSource: { x: startSource.x + (last.x - p0.x), y: startSource.y + (last.y - p0.y) } });
          }
          ctx.redrawOverlay();
        },
        cancel() { window.clearTimeout(holdTimer); stroke.cancel(); },
      };
    },
    drawOverlay(ctx, g, hover) {
      const qs = quickShapeState.get();
      if ((tool === 'brush' || tool === 'eraser') && qs && qs.doc === ctx.doc) {
        const r = 5 / ctx.zoom;
        if (previewShape) {
          g.strokeStyle = '#2563eb'; g.lineWidth = 1 / ctx.zoom; g.setLineDash([4 / ctx.zoom, 3 / ctx.zoom]);
          const pts = shapeStrokePoints(previewShape, 1);
          g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke(); g.setLineDash([]);
        }
        for (const h of editableHandles(previewShape ?? qs.shape)) { g.fillStyle = '#fff'; g.strokeStyle = '#2563eb'; g.lineWidth = 1.5 / ctx.zoom; g.beginPath(); g.arc(h.x, h.y, r, 0, Math.PI * 2); g.fill(); g.stroke(); }
      }
      if (!hover) return;
      const st = usePaintStudio.getState();
      const r = Math.max(0.5, st.size / 2);
      g.lineWidth = 1 / ctx.zoom;
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.beginPath(); g.arc(hover.x, hover.y, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.beginPath(); g.arc(hover.x, hover.y, r + 1 / ctx.zoom, 0, Math.PI * 2); g.stroke();
      if (r * ctx.zoom < 4) { g.beginPath(); g.moveTo(hover.x - 6 / ctx.zoom, hover.y); g.lineTo(hover.x + 6 / ctx.zoom, hover.y); g.moveTo(hover.x, hover.y - 6 / ctx.zoom); g.lineTo(hover.x, hover.y + 6 / ctx.zoom); g.stroke(); }
      const src = useBrushes.getState().cloneSource;
      if ((tool === 'clone' || tool === 'heal') && src) {
        const s = 8 / ctx.zoom;
        g.strokeStyle = '#ef4444';
        g.beginPath(); g.moveTo(src.x - s, src.y); g.lineTo(src.x + s, src.y); g.moveTo(src.x, src.y - s); g.lineTo(src.x, src.y + s); g.stroke();
        g.beginPath(); g.arc(src.x, src.y, s * 0.6, 0, Math.PI * 2); g.stroke();
      }
    },
    Options: () => <BrushOptions tool={tool} />,
  });
}

function BrushOptions({ tool }: { tool: BrushToolId }) {
  const st = usePaintStudio();
  const b = useBrushes();
  const presets = allPresets().filter((p) => (tool === 'brush' ? p.mode === 'paint' : tool === 'eraser' ? p.mode === 'erase' : p.mode === tool));
  const current = b.presetByTool[tool];
  return (
    <div className="flex items-center gap-3 whitespace-nowrap text-[12px]">
      <select value={current} onChange={(e) => b.setPreset(tool, e.target.value)} className="rounded border border-line bg-bg-2 px-1 py-0.5" data-testid="brush-preset-select" title="Preset">
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <label className="flex items-center gap-1 text-fg-muted">Size
        <input type="range" min={1} max={500} value={Math.min(500, st.size)} onChange={(e) => st.set({ size: Number(e.target.value) })} className="w-24 accent-[var(--iln-accent)]" data-testid="brush-size" />
        <span className="w-9 tabular-nums text-fg">{st.size}px</span>
      </label>
      <label className="flex items-center gap-1 text-fg-muted">Opacity
        <input type="range" min={1} max={100} value={Math.round(st.opacity * 100)} onChange={(e) => st.set({ opacity: Number(e.target.value) / 100 })} className="w-20 accent-[var(--iln-accent)]" data-testid="brush-opacity" />
        <span className="w-8 tabular-nums text-fg">{Math.round(st.opacity * 100)}%</span>
      </label>
      <label className="flex items-center gap-1 text-fg-muted" title="StreamLine stabilizer">StreamLine
        <input type="range" min={0} max={100} value={Math.round((b.streamline ?? presetForTool(tool).streamline) * 100)} onChange={(e) => b.set({ streamline: Number(e.target.value) / 100 })} className="w-20 accent-[var(--iln-accent)]" data-testid="brush-streamline" />
        <span className="w-8 tabular-nums text-fg">{Math.round((b.streamline ?? presetForTool(tool).streamline) * 100)}%</span>
      </label>
      <label className="flex items-center gap-1 text-fg-muted" title="Pull-string lazy mouse"><input type="checkbox" checked={b.lazyMouse} onChange={(e) => b.set({ lazyMouse: e.target.checked })} />Lazy mouse</label>
      {(tool === 'clone' || tool === 'heal') && <span className="text-fg-faint">{b.cloneSource ? 'Alt-click to move source' : 'Alt-click to set source'}</span>}
    </div>
  );
}

brushTool('brush', Brush, 'Brush', 'b', 'paint', 1);
brushTool('eraser', Eraser, 'Eraser', 'e', 'paint', 2);
brushTool('smudge', Fingerprint, 'Smudge', 'u', 'retouch', 10);
brushTool('blur', Droplets, 'Blur', undefined, 'retouch', 11);
brushTool('sharpen', Sparkles, 'Sharpen', undefined, 'retouch', 12);
brushTool('clone', Stamp, 'Clone stamp', 'c', 'retouch', 13);
brushTool('heal', Bandage, 'Healing brush', 'j', 'retouch', 14);
