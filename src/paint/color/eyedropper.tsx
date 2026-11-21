import { Pipette } from 'lucide-react';
import { registerPaintTool, type PaintPointer, type ToolContext } from '../studio/tools';
import { usePaintStudio } from '../studio/store';
import { rgbToHex } from './colorMath';
import { useColor } from './store';
import type { PaintDocument } from '../engine/document';

function pick(doc: PaintDocument, p: PaintPointer): string | null {
  const [r, g, b, a] = doc.sample(p.x, p.y, useColor.getState().source);
  if (a === 0) return null;
  const hex = rgbToHex({ r, g, b });
  usePaintStudio.getState().set(p.alt ? { secondary: hex } : { color: hex });
  return hex;
}

function Options() {
  const source = useColor((s) => s.source);
  const back = useColor((s) => s.returnToPrevious);
  return (
    <div className="flex items-center gap-3 text-[12px] text-fg-muted">
      <label className="flex items-center gap-1.5">Sample
        <select value={source} onChange={(e) => useColor.getState().set({ source: e.target.value as 'composite' | 'layer' })} data-testid="eyedropper-source"
          className="h-6 rounded border border-line bg-bg-2 px-1.5 text-fg">
          <option value="composite">Composite</option>
          <option value="layer">Current layer</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={back} onChange={(e) => useColor.getState().set({ returnToPrevious: e.target.checked })} data-testid="eyedropper-return" className="accent-[var(--iln-accent)]" />
        Return to previous tool after pick
      </label>
      <span className="text-fg-faint">Hold Alt to pick the secondary colour</span>
    </div>
  );
}

registerPaintTool({
  id: 'eyedropper', label: 'Eyedropper', icon: Pipette, key: 'i', group: 'paint', order: 3,
  cursor: () => 'crosshair',
  down(ctx: ToolContext, p0: PaintPointer) {
    const doc = ctx.doc;
    let last = pick(doc, p0);
    return {
      move(p) { last = pick(doc, p) ?? last; ctx.redrawOverlay(); },
      up() {
        if (last) useColor.getState().push(last);
        ctx.redrawOverlay();
        if (useColor.getState().returnToPrevious) {
          const st = usePaintStudio.getState();
          if (st.previousTool && st.previousTool !== 'eyedropper') st.setTool(st.previousTool);
        }
      },
    };
  },
  drawOverlay(ctx, g, hover) {
    if (!hover) return;
    const doc = ctx.doc;
    const src = useColor.getState().source === 'layer' && doc.active ? doc.active.canvas : doc.composite();
    const k = 1 / ctx.zoom;
    const R = 38 * k, cells = 11, half = Math.floor(cells / 2);
    const x = Math.floor(hover.x), y = Math.floor(hover.y);
    const [r, gg, b, a] = doc.sample(hover.x, hover.y, useColor.getState().source);
    g.save();
    g.beginPath(); g.arc(hover.x, hover.y, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#888'; g.fillRect(hover.x - R, hover.y - R, R * 2, R * 2);
    g.imageSmoothingEnabled = false;
    g.drawImage(src, x - half, y - half, cells, cells, hover.x - R, hover.y - R, R * 2, R * 2);
    g.restore();
    const cell = (R * 2) / cells;
    g.lineWidth = 1.5 * k; g.strokeStyle = '#000'; g.strokeRect(hover.x - cell / 2, hover.y - cell / 2, cell, cell);
    g.lineWidth = 0.75 * k; g.strokeStyle = '#fff'; g.strokeRect(hover.x - cell / 2, hover.y - cell / 2, cell, cell);
    g.beginPath(); g.arc(hover.x, hover.y, R, 0, Math.PI * 2);
    g.lineWidth = 7 * k; g.strokeStyle = a === 0 ? 'rgba(128,128,128,0.6)' : rgbToHex({ r, g: gg, b });
    g.stroke();
    g.beginPath(); g.arc(hover.x, hover.y, R + 3.5 * k, 0, Math.PI * 2); g.lineWidth = 1 * k; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.stroke();
    g.beginPath(); g.arc(hover.x, hover.y, R - 3.5 * k, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.stroke();
  },
  Options,
});
