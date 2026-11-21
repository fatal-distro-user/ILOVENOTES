/** Core studio tools: hand (pan) and move-layer. Brushes live in src/paint/brushes. */
import { Hand, Move } from 'lucide-react';
import { registerPaintTool } from './tools';
import { makeCanvas, ctx2d } from '../engine/document';
import { toast } from '@/store/status';

registerPaintTool({ id: 'hand', label: 'Hand (pan)', icon: Hand, key: 'h', group: 'view', order: 99, cursor: () => 'grab', down: () => null });

/** Luminance of a hex colour (0..1): decides reveal vs hide when painting on a layer mask. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0;
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
}

registerPaintTool({
  id: 'move', label: 'Move layer', icon: Move, key: 'v', group: 'transform', order: 30, cursor: () => 'move',
  down(ctx, p0) {
    const doc = ctx.doc;
    const edit = doc.beginEdit(undefined, 'color');
    if (!edit) { toast('Select an unlocked raster layer to move', 'error'); return null; }
    edit.touchAll();
    const snapshot = makeCanvas(doc.width, doc.height);
    ctx2d(snapshot).drawImage(edit.target, 0, 0);
    let dx = 0, dy = 0;
    const redraw = () => {
      edit.ctx.clearRect(0, 0, doc.width, doc.height);
      edit.ctx.drawImage(snapshot, Math.round(dx), Math.round(dy));
      doc.invalidate();
    };
    return {
      move(p) { dx = p.x - p0.x; dy = p.y - p0.y; if (p.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } redraw(); },
      up() { if (Math.round(dx) || Math.round(dy)) edit.commit('Move layer'); else edit.revert(); },
      cancel() { edit.revert(); },
    };
  },
  onKey(ctx, e) {
    if (!e.key.startsWith('Arrow')) return false;
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const id = ctx.doc.activeLayerId;
    if (!id) return false;
    ctx.doc.pixelOp('Nudge layer', id, (c, canvas) => {
      const copy = makeCanvas(canvas.width, canvas.height);
      ctx2d(copy).drawImage(canvas, 0, 0);
      c.clearRect(0, 0, canvas.width, canvas.height);
      c.drawImage(copy, dx, dy);
    });
    return true;
  },
});
