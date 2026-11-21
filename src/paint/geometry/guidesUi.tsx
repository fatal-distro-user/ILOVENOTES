import { useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import clsx from 'clsx';
import { Compass, FlipHorizontal2, Ruler } from 'lucide-react';
import { registerPaintTool, registerPaintOverlay, registerPointerConstraint, type ToolContext } from '../studio/tools';
import type { PaintDocument } from '../engine/document';
import { Popover } from '@/ui/Popover';
import {
  DEFAULT_SYMMETRY, DEFAULT_PERSPECTIVE, DEFAULT_RULER, symmetryGuideLines, snapToPerspective, constrainToGuide, frenchCurveLocal, protractorAngle,
  type SymmetryConfig, type PerspectiveConfig, type RulerGuide, type SymmetryMode, type PerspectiveMode, type RulerKind,
} from './guides';
import type { Pt } from './quickshape';

interface GuideState {
  symmetry: SymmetryConfig;
  perspective: PerspectiveConfig;
  perspectiveSnap: boolean;
  ruler: RulerGuide;
  quickShape: boolean;
  set(p: Partial<Omit<GuideState, 'set'>>): void;
}

export const useGuides = create<GuideState>()(
  persist(
    (set) => ({ symmetry: DEFAULT_SYMMETRY, perspective: DEFAULT_PERSPECTIVE, perspectiveSnap: true, ruler: DEFAULT_RULER, quickShape: true, set: (p) => set(p) }),
    { name: 'iln-guides' },
  ),
);

/** Centre guides on the document when first enabled. */
function ensurePlaced(doc: PaintDocument): void {
  const g = useGuides.getState();
  const inside = (p: Pt) => p.x > 0 && p.y > 0 && p.x < doc.width && p.y < doc.height;
  if (g.symmetry.mode !== 'off' && !inside(g.symmetry.center)) g.set({ symmetry: { ...g.symmetry, center: { x: doc.width / 2, y: doc.height / 2 } } });
  if (g.perspective.mode !== 'off' && g.perspective.horizonY === 0) {
    g.set({ perspective: { ...g.perspective, horizonY: doc.height * 0.4, vp1: { x: doc.width * (g.perspective.mode === '1pt' ? 0.5 : 0.1), y: doc.height * 0.4 }, vp2: { x: doc.width * 0.9, y: doc.height * 0.4 } } });
  }
  if (g.ruler.visible && !inside({ x: g.ruler.x, y: g.ruler.y })) g.set({ ruler: { ...g.ruler, x: doc.width / 2, y: doc.height / 2, length: Math.min(doc.width, doc.height) * 0.7 } });
}

/** Mirror transforms for the brush engine (identity only when symmetry is off). */
export { symmetryTransforms } from './guides';

// ───────── overlays ─────────
registerPaintOverlay((ctx, g) => {
  const st = useGuides.getState();
  const doc = ctx.doc;
  const extent = Math.hypot(doc.width, doc.height);
  g.lineWidth = 1 / ctx.zoom;
  if (st.symmetry.mode !== 'off') {
    g.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    g.setLineDash([6 / ctx.zoom, 4 / ctx.zoom]);
    for (const [a, b] of symmetryGuideLines(st.symmetry, extent)) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = 'rgba(56, 189, 248, 1)';
    g.beginPath(); g.arc(st.symmetry.center.x, st.symmetry.center.y, 4 / ctx.zoom, 0, Math.PI * 2); g.fill();
  }
  const p = st.perspective;
  if (p.mode !== 'off') {
    g.strokeStyle = 'rgba(244, 114, 182, 0.45)';
    const rays = (vp: Pt, n = 24) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; g.beginPath(); g.moveTo(vp.x, vp.y); g.lineTo(vp.x + Math.cos(a) * extent, vp.y + Math.sin(a) * extent); g.stroke(); } };
    if (p.mode === '1pt') rays(p.vp1);
    if (p.mode === '2pt') { rays(p.vp1, 18); rays(p.vp2, 18); }
    if (p.mode === 'isometric') {
      const a = (p.isoAngle * Math.PI) / 180, step = Math.max(24, Math.min(doc.width, doc.height) / 16);
      for (let k = -40; k <= 80; k++) {
        const c = k * step;
        g.beginPath(); g.moveTo(0, c); g.lineTo(doc.width, c - doc.width * Math.tan(a)); g.stroke();
        g.beginPath(); g.moveTo(0, c - doc.width * Math.tan(a)); g.lineTo(doc.width, c); g.stroke();
      }
      for (let x = 0; x <= doc.width; x += step * Math.cos(a) * 2) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, doc.height); g.stroke(); }
    }
    if (p.mode !== 'isometric') {
      g.strokeStyle = 'rgba(244, 114, 182, 0.9)';
      g.beginPath(); g.moveTo(-extent, p.horizonY); g.lineTo(doc.width + extent, p.horizonY); g.stroke();
      g.fillStyle = '#f472b6';
      for (const vp of p.mode === '2pt' ? [p.vp1, p.vp2] : [p.vp1]) { g.beginPath(); g.arc(vp.x, vp.y, 5 / ctx.zoom, 0, Math.PI * 2); g.fill(); }
    }
  }
  const r = st.ruler;
  if (r.visible) {
    g.save();
    g.translate(r.x, r.y);
    g.rotate(r.rotation);
    g.fillStyle = 'rgba(250, 250, 250, 0.35)';
    g.strokeStyle = 'rgba(30, 41, 59, 0.85)';
    if (r.kind === 'ruler') {
      g.fillRect(-r.length / 2, -24, r.length, 48);
      g.strokeRect(-r.length / 2, -24, r.length, 48);
      g.beginPath();
      for (let t = -r.length / 2; t <= r.length / 2; t += 10) { const big = Math.round(t) % 50 === 0; g.moveTo(t, -24); g.lineTo(t, -24 + (big ? 12 : 6)); g.moveTo(t, 24); g.lineTo(t, 24 - (big ? 12 : 6)); }
      g.stroke();
    } else if (r.kind === 'protractor') {
      const R = r.length / 2;
      g.beginPath(); g.moveTo(-R, 0); g.arc(0, 0, R, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
      g.beginPath();
      for (let d = 0; d <= 180; d += 5) { const a = Math.PI + (d * Math.PI) / 180, L = d % 30 === 0 ? 16 : d % 10 === 0 ? 10 : 6; g.moveTo(Math.cos(a) * R, Math.sin(a) * R); g.lineTo(Math.cos(a) * (R - L), Math.sin(a) * (R - L)); }
      g.stroke();
    } else {
      const pts = frenchCurveLocal(r.length);
      g.lineWidth = 3 / ctx.zoom;
      g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke();
    }
    g.restore();
    // Handles: centre (move) and end (rotate/scale).
    const end = { x: r.x + Math.cos(r.rotation) * r.length / 2, y: r.y + Math.sin(r.rotation) * r.length / 2 };
    g.fillStyle = '#0ea5e9';
    for (const q of [{ x: r.x, y: r.y }, end]) { g.beginPath(); g.arc(q.x, q.y, 5 / ctx.zoom, 0, Math.PI * 2); g.fill(); }
  }
});

// ───────── stroke constraints ─────────
registerPointerConstraint((_doc, p, stroke) => {
  const st = useGuides.getState();
  let q = p;
  if (st.ruler.visible) {
    const c = constrainToGuide(st.ruler, q);
    if (c.attached) q = { ...q, x: c.point.x, y: c.point.y };
  }
  if (st.perspective.mode !== 'off' && st.perspectiveSnap) {
    const r = snapToPerspective(st.perspective, stroke.start, q, (stroke.lock as Pt | null) ?? undefined);
    if (r.dir && !stroke.lock) stroke.lock = r.dir;
    q = { ...q, x: r.point.x, y: r.point.y };
  }
  return q;
});

// ───────── guide editing tool ─────────
registerPaintTool({
  id: 'guides', label: 'Edit guides (symmetry centre, vanishing points, ruler)', icon: Compass, group: 'guide', order: 60, cursor: () => 'move',
  down(ctx: ToolContext, p0) {
    ensurePlaced(ctx.doc);
    const st = useGuides.getState();
    const tol = 10 / ctx.zoom;
    const near = (q: Pt) => Math.hypot(q.x - p0.x, q.y - p0.y) <= tol;
    const r = st.ruler;
    const end = { x: r.x + Math.cos(r.rotation) * r.length / 2, y: r.y + Math.sin(r.rotation) * r.length / 2 };
    const done = { up: () => ctx.redrawOverlay() };
    if (r.visible && near(end)) return { ...done, move: (p) => { const dx = p.x - r.x, dy = p.y - r.y; useGuides.getState().set({ ruler: { ...useGuides.getState().ruler, rotation: p.shift ? Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12) : Math.atan2(dy, dx), length: Math.max(60, Math.hypot(dx, dy) * 2) } }); ctx.redrawOverlay(); } };
    if (r.visible && near({ x: r.x, y: r.y })) return { ...done, move: (p) => { useGuides.getState().set({ ruler: { ...useGuides.getState().ruler, x: p.x, y: p.y } }); ctx.redrawOverlay(); } };
    if (st.symmetry.mode !== 'off' && near(st.symmetry.center)) return { ...done, move: (p) => { useGuides.getState().set({ symmetry: { ...useGuides.getState().symmetry, center: { x: p.x, y: p.y } } }); ctx.redrawOverlay(); } };
    if (st.perspective.mode !== 'off') {
      for (const key of ['vp1', 'vp2'] as const) {
        if (!near(st.perspective[key])) continue;
        return {
          ...done,
          move: (p) => {
            // Vanishing points share the horizon: dragging one moves the horizon (Shift keeps it fixed).
            const cur = useGuides.getState().perspective;
            const y = p.shift ? cur.horizonY : p.y;
            const other = key === 'vp1' ? 'vp2' : 'vp1';
            useGuides.getState().set({ perspective: { ...cur, horizonY: y, [key]: { x: p.x, y }, [other]: { ...cur[other], y } } });
            ctx.redrawOverlay();
          },
        };
      }
    }
    // Drag inside the ruler body moves it.
    if (r.visible && constrainToGuide({ ...r, magnet: 30 }, p0).attached) {
      let last = p0;
      return { ...done, move: (p) => { const cur = useGuides.getState().ruler; useGuides.getState().set({ ruler: { ...cur, x: cur.x + p.x - last.x, y: cur.y + p.y - last.y } }); last = p; ctx.redrawOverlay(); } };
    }
    return null;
  },
  Options: () => <span className="text-fg-faint">Drag the symmetry centre, vanishing points, or the ruler centre/end handle. Shift snaps angles.</span>,
});

/** Header button + popover to configure guides. */
export function GuidesMenu({ doc }: { doc: PaintDocument }) {
  const st = useGuides();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = st.symmetry.mode !== 'off' || st.perspective.mode !== 'off' || st.ruler.visible;
  const upd = (p: Partial<GuideState>) => { st.set(p); requestAnimationFrame(() => { ensurePlaced(doc); doc.invalidate(); }); };
  const Seg = <T extends string>({ value, options, onChange, testId }: { value: T; options: [T, string][]; onChange: (v: T) => void; testId: string }) => (
    <div className="flex flex-wrap overflow-hidden rounded border border-line">
      {options.map(([v, l]) => <button key={v} data-testid={`${testId}-${v}`} onClick={() => onChange(v)} className={clsx('px-2 py-0.5 text-[11px]', value === v ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3')}>{l}</button>)}
    </div>
  );
  return (
    <>
      <button className={clsx('flex h-7 items-center gap-1 rounded px-2 hover:bg-bg-3', active ? 'text-accent' : 'text-fg-muted')} onClick={(e) => setAnchor(e.currentTarget)} data-testid="guides-menu"><Ruler size={13} />Guides</button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end">
          <div className="flex w-72 flex-col gap-2.5 p-3 text-[12px]">
            <div className="flex items-center gap-1 font-semibold"><FlipHorizontal2 size={13} />Symmetry</div>
            <Seg value={st.symmetry.mode} testId="sym" onChange={(m) => upd({ symmetry: { ...st.symmetry, mode: m as SymmetryMode } })} options={[['off', 'Off'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['quadrant', 'Quadrant'], ['radial', 'Radial']]} />
            {st.symmetry.mode === 'radial' && (
              <label className="flex items-center gap-2 text-fg-muted">Segments<input type="range" min={3} max={16} value={st.symmetry.segments} onChange={(e) => upd({ symmetry: { ...st.symmetry, segments: Number(e.target.value) } })} className="flex-1 accent-[var(--iln-accent)]" data-testid="sym-segments" /><span className="w-5 tabular-nums text-fg">{st.symmetry.segments}</span></label>
            )}
            {st.symmetry.mode === 'radial' && <label className="flex items-center gap-2 text-fg-muted"><input type="checkbox" checked={st.symmetry.mirror} onChange={(e) => upd({ symmetry: { ...st.symmetry, mirror: e.target.checked } })} />Kaleidoscope (mirror each segment)</label>}
            {st.symmetry.mode !== 'off' && <button className="self-start text-accent" onClick={() => upd({ symmetry: { ...st.symmetry, center: { x: doc.width / 2, y: doc.height / 2 }, rotation: 0 } })}>Reset centre</button>}
            <div className="mt-1 font-semibold">Perspective</div>
            <Seg value={st.perspective.mode} testId="persp" onChange={(m) => upd({ perspective: { ...st.perspective, mode: m as PerspectiveMode, horizonY: 0 } })} options={[['off', 'Off'], ['1pt', '1-Point'], ['2pt', '2-Point'], ['isometric', 'Isometric']]} />
            {st.perspective.mode !== 'off' && <label className="flex items-center gap-2 text-fg-muted"><input type="checkbox" checked={st.perspectiveSnap} onChange={(e) => upd({ perspectiveSnap: e.target.checked })} data-testid="persp-snap" />Snap strokes to perspective</label>}
            <div className="mt-1 font-semibold">Ruler / Protractor / French curve</div>
            <Seg value={st.ruler.visible ? st.ruler.kind : ('off' as RulerKind | 'off')} testId="ruler" onChange={(k) => upd({ ruler: k === 'off' ? { ...st.ruler, visible: false } : { ...st.ruler, kind: k as RulerKind, visible: true } })} options={[['off', 'Hidden'], ['ruler', 'Ruler'], ['protractor', 'Protractor'], ['french-curve', 'French curve']]} />
            {st.ruler.visible && st.ruler.kind === 'protractor' && <div className="text-fg-faint">Angle readout appears while drawing near the arc.</div>}
            <label className="mt-1 flex items-center gap-2 text-fg-muted"><input type="checkbox" checked={st.quickShape} onChange={(e) => upd({ quickShape: e.target.checked })} data-testid="quickshape-toggle" />QuickShape: hold at the end of a stroke to snap to a shape</label>
            <div className="text-fg-faint">Use the Edit guides tool (compass) to move centres, vanishing points and rulers.</div>
          </div>
        </Popover>
      )}
    </>
  );
}

export { protractorAngle };
