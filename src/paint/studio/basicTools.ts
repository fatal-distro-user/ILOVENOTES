/** Core studio tools: hand, move-layer, and the engine-level round brush/eraser (replaced by the dab engine). */
import { Hand, Move, Brush, Eraser } from 'lucide-react';
import { registerPaintTool, type PaintPointer } from './tools';
import { usePaintStudio } from './store';
import { makeCanvas, ctx2d, type RasterEdit } from '../engine/document';
import { toast } from '@/store/status';

registerPaintTool({ id: 'hand', label: 'Hand (pan)', icon: Hand, key: 'h', group: 'view', order: 99, cursor: () => 'grab', down: () => null });

/** Luminance of a hex colour (0..1): decides reveal vs hide when painting on a layer mask. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0;
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
}

/** Configure the edit context's compositing for paint/erase on colour or mask channels. */
export function prepareComposite(edit: RasterEdit, erase: boolean, color: string): { fill: string } {
  const c = edit.ctx;
  if (edit.channel === 'mask') {
    const reveal = !erase && luminance(color) >= 0.5;
    c.globalCompositeOperation = reveal ? 'source-over' : 'destination-out';
    return { fill: '#ffffff' };
  }
  if (erase) { c.globalCompositeOperation = 'destination-out'; return { fill: '#000000' }; }
  c.globalCompositeOperation = edit.layer.meta.alphaLock ? 'source-atop' : 'source-over';
  return { fill: color };
}

function roundStroke(erase: boolean) {
  return (ctx: Parameters<Parameters<typeof registerPaintTool>[0]['down']>[0], p0: PaintPointer) => {
    const doc = ctx.doc;
    const edit = doc.beginEdit();
    if (!edit) { toast(doc.active?.meta.locked ? 'Layer is locked' : 'Select a raster layer to paint', 'error'); return null; }
    const st = usePaintStudio.getState();
    const { fill } = prepareComposite(edit, erase, st.color);
    edit.ctx.fillStyle = fill;
    edit.ctx.globalAlpha = st.opacity * (erase ? 1 : st.alpha);
    let last = p0;
    const stamp = (p: PaintPointer) => {
      const r = Math.max(0.5, (st.size / 2) * (p.pointerType === 'pen' ? Math.max(0.1, p.pressure) : 1));
      edit.touch({ x: p.x - r - 1, y: p.y - r - 1, w: r * 2 + 2, h: r * 2 + 2 });
      edit.ctx.beginPath();
      edit.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      edit.ctx.fill();
    };
    stamp(p0);
    doc.invalidate();
    return {
      move(p: PaintPointer) {
        const d = Math.hypot(p.x - last.x, p.y - last.y), step = Math.max(0.5, st.size * 0.08);
        for (let s = step; s <= d; s += step) stamp({ ...p, x: last.x + ((p.x - last.x) * s) / d, y: last.y + ((p.y - last.y) * s) / d });
        last = p;
        doc.invalidate();
      },
      up() { edit.ctx.globalAlpha = 1; edit.ctx.globalCompositeOperation = 'source-over'; edit.commit(erase ? 'Erase' : 'Brush stroke'); },
      cancel() { edit.revert(); },
    };
  };
}

registerPaintTool({ id: 'brush', label: 'Brush', icon: Brush, key: 'b', group: 'paint', order: 1, down: roundStroke(false) });
registerPaintTool({ id: 'eraser', label: 'Eraser', icon: Eraser, key: 'e', group: 'paint', order: 2, down: roundStroke(true) });

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
