import { Brush, Eraser, Fingerprint, Droplets, Sparkles, Stamp, Bandage, type LucideIcon } from 'lucide-react';
import { registerPaintTool, type ToolContext, type PaintPointer } from '../studio/tools';
import { usePaintStudio } from '../studio/store';
import { BrushStroke } from './engine';
import { useBrushes, presetForTool, allPresets, type BrushToolId } from './store';
import { outlineFor, outlineToSvgPath } from '@/canvas/ink';
import { toast } from '@/store/status';
import type { PaintDocument } from '../engine/document';

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

function brushTool(tool: BrushToolId, icon: LucideIcon, label: string, key: string | undefined, group: 'paint' | 'retouch', order: number) {
  registerPaintTool({
    id: tool, label, icon, key, group, order,
    cursor: () => 'none',
    down(ctx: ToolContext, p0: PaintPointer) {
      const doc = ctx.doc;
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
      const stroke = new BrushStroke({
        doc, edit, brush: preset, color: st.color, opacity: st.opacity, size: tool === 'brush' || tool === 'eraser' ? st.size : Math.max(st.size, 4),
        streamline: b.streamline ?? preset.streamline, lazyMouse: b.lazyMouse, cloneSource: b.cloneSource,
      });
      stroke.add(p0);
      const startSource = b.cloneSource;
      let last = p0;
      return {
        move(p: PaintPointer) { stroke.add(p); last = p; },
        up() {
          const painted = stroke.end();
          if (painted) edit.commit(`${label} (${preset.name})`);
          // Aligned clone: the source point travels with the brush, so the next stroke continues the sample.
          if (startSource && (tool === 'clone' || tool === 'heal')) {
            useBrushes.getState().set({ cloneSource: { x: startSource.x + (last.x - p0.x), y: startSource.y + (last.y - p0.y) } });
          }
          ctx.redrawOverlay();
        },
        cancel() { stroke.cancel(); },
      };
    },
    drawOverlay(ctx, g, hover) {
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
