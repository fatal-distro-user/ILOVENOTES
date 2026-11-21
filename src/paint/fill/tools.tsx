import { create } from 'zustand';
import { PaintBucket, Blend } from 'lucide-react';
import { registerPaintTool } from '../studio/tools';
import { usePaintStudio } from '../studio/store';
import { regionMask, applyFill } from './floodFill';
import { combineMasks } from './mask';
import { maskToCanvas } from '../selection/selection';
import { makeCanvas, ctx2d } from '../engine/document';
import { toast } from '@/store/status';

interface FillOptions {
  tolerance: number; gapClose: number; contiguous: boolean; sample: 'auto' | 'layer' | 'composite' | 'reference'; bleed: boolean;
  gradient: 'linear' | 'radial' | 'conic'; gradientTarget: 'secondary' | 'transparent'; reverse: boolean;
  set(p: Partial<Omit<FillOptions, 'set'>>): void;
}
export const useFillOptions = create<FillOptions>()((set) => ({
  tolerance: 24, gapClose: 0, contiguous: true, sample: 'auto', bleed: true,
  gradient: 'linear', gradientTarget: 'secondary', reverse: false,
  set: (p) => set(p),
}));

const hexToRgba = (hex: string, a = 255): [number, number, number, number] => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};

registerPaintTool({
  id: 'fill', label: 'Paint bucket (flood fill)', icon: PaintBucket, key: 'g', group: 'fill', order: 20, cursor: () => 'crosshair',
  down(ctx, p) {
    const doc = ctx.doc;
    const layer = doc.active;
    if (!layer || layer.meta.kind !== 'raster' || layer.meta.locked) { toast('Select an unlocked raster layer to fill', 'error'); return null; }
    if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return null;
    const o = useFillOptions.getState();
    const st = usePaintStudio.getState();
    const hasRef = doc.layers.some((l) => l.meta.isReference && l.meta.visible);
    const sample = o.sample === 'auto' ? (hasRef ? 'reference' : 'composite') : o.sample;
    const src = doc.samplingPixels(sample);
    let mask = regionMask({ width: src.width, height: src.height, data: src.data }, p.x, p.y, { tolerance: o.tolerance, contiguous: o.contiguous, gapClose: o.gapClose, bleed: o.bleed ? 1 : 0 });
    if (doc.selection) mask = combineMasks(mask, doc.selection, 'intersect');
    const color = doc.editChannel === 'mask' ? '#ffffff' : st.color;
    doc.pixelOp('Fill', layer.meta.id, (c) => {
      const img = c.getImageData(0, 0, doc.width, doc.height);
      applyFill(img, mask, hexToRgba(color, Math.round(255 * st.opacity)), layer.meta.alphaLock && doc.editChannel === 'color');
      c.putImageData(img, 0, 0);
    }, 'raster', doc.editChannel);
    return null;
  },
  Options: function FillOpts() {
    const o = useFillOptions();
    return (
      <div className="flex items-center gap-3 whitespace-nowrap text-[12px] text-fg-muted">
        <label className="flex items-center gap-1">Tolerance<input type="range" min={0} max={255} value={o.tolerance} onChange={(e) => o.set({ tolerance: Number(e.target.value) })} className="w-24 accent-[var(--iln-accent)]" data-testid="fill-tolerance" /><span className="w-7 tabular-nums text-fg">{o.tolerance}</span></label>
        <label className="flex items-center gap-1" title="Close gaps in line art narrower than ~2× this many pixels">Gap closing<input type="range" min={0} max={20} value={o.gapClose} onChange={(e) => o.set({ gapClose: Number(e.target.value) })} className="w-20 accent-[var(--iln-accent)]" data-testid="fill-gap" /><span className="w-7 tabular-nums text-fg">{o.gapClose}px</span></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={o.contiguous} onChange={(e) => o.set({ contiguous: e.target.checked })} />Contiguous</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={o.bleed} onChange={(e) => o.set({ bleed: e.target.checked })} />Bleed 1px under lines</label>
        <select value={o.sample} onChange={(e) => o.set({ sample: e.target.value as FillOptions['sample'] })} className="rounded border border-line bg-bg-2 px-1 text-fg" data-testid="fill-sample">
          <option value="auto">Auto (reference layer if set)</option><option value="composite">All layers</option><option value="layer">Current layer</option><option value="reference">Reference layer</option>
        </select>
      </div>
    );
  },
});

let gradientLine: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;

registerPaintTool({
  id: 'gradient', label: 'Gradient fill', icon: Blend, group: 'fill', order: 21, cursor: () => 'crosshair',
  down(ctx, a) {
    const doc = ctx.doc;
    const edit = doc.beginEdit();
    if (!edit) { toast('Select an unlocked raster layer (or mask)', 'error'); return null; }
    edit.touchAll();
    const base = makeCanvas(doc.width, doc.height);
    ctx2d(base).drawImage(edit.target, 0, 0);
    const selC = doc.selection ? maskToCanvas(doc.selection) : null;
    const render = (b: { x: number; y: number }) => {
      const o = useFillOptions.getState();
      const st = usePaintStudio.getState();
      const mask = edit.channel === 'mask';
      let c0 = mask ? '#ffffff' : st.color, c1 = mask ? 'rgba(255,255,255,0)' : o.gradientTarget === 'secondary' ? st.secondary : `${st.color}00`;
      if (o.reverse) [c0, c1] = [c1, c0];
      const g = edit.ctx;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, doc.width, doc.height);
      g.drawImage(base, 0, 0);
      const t = makeCanvas(doc.width, doc.height);
      const tc = ctx2d(t);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const grad = o.gradient === 'linear' ? tc.createLinearGradient(a.x, a.y, b.x, b.y)
        : o.gradient === 'radial' ? tc.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, dist))
        : tc.createConicGradient(Math.atan2(b.y - a.y, b.x - a.x), a.x, a.y);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, c1);
      tc.fillStyle = grad;
      tc.fillRect(0, 0, doc.width, doc.height);
      if (selC) { tc.globalCompositeOperation = 'destination-in'; tc.drawImage(selC, 0, 0); }
      g.globalAlpha = st.opacity;
      g.globalCompositeOperation = edit.layer.meta.alphaLock && !mask ? 'source-atop' : 'source-over';
      g.drawImage(t, 0, 0);
      g.restore();
      doc.invalidate();
    };
    gradientLine = { a, b: a };
    return {
      move(p) {
        let b = { x: p.x, y: p.y };
        if (p.shift) { const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(b.x - a.x, b.y - a.y); b = { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L }; }
        gradientLine = { a, b };
        render(b);
        ctx.redrawOverlay();
      },
      up() {
        const line = gradientLine;
        gradientLine = null;
        if (!line || Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) < 2) { edit.revert(); return; }
        edit.commit(`${useFillOptions.getState().gradient[0].toUpperCase()}${useFillOptions.getState().gradient.slice(1)} gradient`);
      },
      cancel() { gradientLine = null; edit.revert(); },
    };
  },
  drawOverlay(ctx, g) {
    if (!gradientLine) return;
    g.lineWidth = 1.5 / ctx.zoom;
    g.strokeStyle = '#fff';
    g.beginPath(); g.moveTo(gradientLine.a.x, gradientLine.a.y); g.lineTo(gradientLine.b.x, gradientLine.b.y); g.stroke();
    g.fillStyle = '#2563eb';
    for (const p of [gradientLine.a, gradientLine.b]) { g.beginPath(); g.arc(p.x, p.y, 4 / ctx.zoom, 0, Math.PI * 2); g.fill(); }
  },
  Options: function GradientOpts() {
    const o = useFillOptions();
    return (
      <div className="flex items-center gap-3 whitespace-nowrap text-[12px] text-fg-muted">
        <div className="flex overflow-hidden rounded border border-line">
          {(['linear', 'radial', 'conic'] as const).map((k) => <button key={k} onClick={() => o.set({ gradient: k })} className={o.gradient === k ? 'bg-accent px-2 py-0.5 text-accent-fg' : 'px-2 py-0.5 hover:bg-bg-3'} data-testid={`gradient-${k}`}>{k}</button>)}
        </div>
        <select value={o.gradientTarget} onChange={(e) => o.set({ gradientTarget: e.target.value as FillOptions['gradientTarget'] })} className="rounded border border-line bg-bg-2 px-1 text-fg">
          <option value="secondary">Primary → secondary</option><option value="transparent">Primary → transparent</option>
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" checked={o.reverse} onChange={(e) => o.set({ reverse: e.target.checked })} />Reverse</label>
        <span className="text-fg-faint">Drag to set direction · Shift snaps to 45°</span>
      </div>
    );
  },
});
