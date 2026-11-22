import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import { StickyNote, Network, Spline, Play, Pause, Mic } from 'lucide-react';
import type { CanvasObject } from '@/db/types';
import { db } from '@/db/schema';
import { registerObjectType, type ObjectViewProps } from '@/canvas/objects/registry';
import { registerCanvasPlugin, type PluginContext } from '@/canvas/CanvasView';
import { registerCanvasTool } from '@/canvas/CanvasChrome';
import { useCanvasTools } from '@/canvas/tools';
import { CanvasDoc } from '@/canvas/doc';
import { toScreen, type Vec } from '@/canvas/camera';
import { strokeRenderData } from '@/canvas/ink';
import { promptDialog } from '@/ui/dialogs';
import { renderMarkdown } from './markdown';
import { portPoint, facingSide, nearestPort, routePath, arrowHeadPath, polylineDistance, boundsOf, type Side, type Route, type Endpoint } from './connectorGeometry';
import { useAudio, play, togglePause, seek, fmtTime, recordingOffset } from './audioStore';
import './spatial.css';

export const STICKY_COLORS = ['#fde68a', '#fecaca', '#bbf7d0', '#bfdbfe', '#e9d5ff', '#fed7aa', '#f5f5f4'];
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

// ───────────────────────── Sticky notes ─────────────────────────
function StickyView({ obj, doc, editing }: ObjectViewProps) {
  const text = str(obj.data.text);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { ta.current?.focus({ preventScroll: true }); ta.current?.select(); } }, [editing]);
  const commit = (v: string) => {
    doc.store.setState({ editingId: null });
    const cur = doc.state.objects[obj.id];
    if (cur && v !== str(cur.data.text)) void doc.updateObjects([{ ...cur, data: { ...cur.data, text: v } }], 'Edit sticky note');
  };
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div className="iln-sticky h-full w-full" style={{ background: str(obj.data.color, STICKY_COLORS[0]) }} data-testid="sticky">
      {editing
        ? <textarea ref={ta} defaultValue={text} className="h-full w-full resize-none bg-transparent p-3 font-mono text-[13px] text-neutral-900 outline-none" onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) (e.target as HTMLTextAreaElement).blur(); }} data-testid="sticky-editor" />
        : <div className="iln-sticky-md h-full w-full overflow-hidden p-3" dangerouslySetInnerHTML={{ __html: html || '<p class="placeholder">Double-click to write…</p>' }} />}
    </div>
  );
}
registerObjectType({ type: 'sticky', component: StickyView, editable: true, minSize: { w: 60, h: 60 }, toText: (o) => str(o.data.text),
  toSvg: (o) => `<rect width="${o.w}" height="${o.h}" fill="${str(o.data.color, STICKY_COLORS[0])}"/>` + str(o.data.text).split('\n').map((l, i) => `<text x="12" y="${24 + i * 18}" font-size="14" fill="#111">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('') });

// ───────────────────────── Mind-map nodes ─────────────────────────
function MindNodeView({ obj, doc, editing }: ObjectViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const text = str(obj.data.text);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!editing && el.innerText !== text) el.innerText = text;
    if (editing) { el.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
  }, [editing, text]);
  /** Commit synchronously (state updates immediately; persistence continues in the background). */
  const commit = (): CanvasObject | null => {
    const el = ref.current;
    doc.store.setState({ editingId: null });
    const cur = doc.state.objects[obj.id];
    if (!el || !cur) return null;
    const v = el.innerText.trim();
    const w = Math.max(90, Math.min(360, v.length * 8.5 + 32));
    if (v !== str(cur.data.text) || w !== cur.w) { const next = { ...cur, w, data: { ...cur.data, text: v } }; void doc.updateObjects([next], 'Edit node'); return next; }
    return cur;
  };
  const level = Number(obj.data.level ?? 0);
  return (
    <div className="iln-mindnode flex h-full w-full items-center justify-center" data-level={Math.min(level, 3)} style={{ borderColor: str(obj.data.color, 'var(--iln-accent)') }} data-testid="mindnode">
      <div ref={ref} contentEditable={editing} suppressContentEditableWarning className="max-w-full px-3 text-center outline-none" data-testid="mindnode-text"
        onPointerDown={(e) => editing && e.stopPropagation()}
        onBlur={() => { if (editing && doc.state.editingId === obj.id) commit(); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); commit(); }
          if (e.key === 'Tab') { e.preventDefault(); const n = commit(); if (n) void addMindNode(doc, n, 'child'); }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const n = commit(); if (n) void addMindNode(doc, n, 'sibling'); }
        }}>{text}</div>
    </div>
  );
}
registerObjectType({ type: 'mindnode', component: MindNodeView, editable: true, minSize: { w: 60, h: 32 }, toText: (o) => str(o.data.text) });

function mindParent(doc: CanvasDoc, id: string): CanvasObject | null {
  const c = Object.values(doc.state.objects).find((o) => o.type === 'connector' && o.data.mind && o.data.to === id);
  return c ? doc.state.objects[String(c.data.from)] ?? null : null;
}
function mindChildren(doc: CanvasDoc, id: string): CanvasObject[] {
  return Object.values(doc.state.objects).filter((o) => o.type === 'connector' && o.data.mind && o.data.from === id).map((c) => doc.state.objects[String(c.data.to)]).filter(Boolean);
}

/** Tab = child (to the right of the node), Enter = sibling (below, same parent). */
export async function addMindNode(doc: CanvasDoc, node: CanvasObject, kind: 'child' | 'sibling'): Promise<void> {
  const parent = kind === 'child' ? node : mindParent(doc, node.id);
  let pos: Vec;
  if (parent) {
    const kids = mindChildren(doc, parent.id);
    const bottom = kids.length ? Math.max(...kids.map((k) => k.y + k.h)) + 18 : parent.y + parent.h / 2 - 20;
    pos = { x: parent.x + parent.w + 70, y: kind === 'sibling' ? Math.max(bottom, node.y + node.h + 18) : bottom };
  } else pos = { x: node.x, y: node.y + node.h + 24 };
  const level = parent ? Number(parent.data.level ?? 0) + 1 : Number(node.data.level ?? 0);
  const n = doc.newObject('mindnode', { x: pos.x, y: pos.y, w: 110, h: 40 }, { text: '', level, color: str(parent?.data.color ?? node.data.color, '') });
  const objs: CanvasObject[] = [n];
  if (parent) objs.push(doc.newObject('connector', { x: 0, y: 0, w: 0, h: 0 }, { from: parent.id, to: n.id, fromSide: 'e', toSide: 'w', route: 'curved', mind: true, arrowEnd: false, color: str(parent.data.color, '') }));
  const pending = doc.addObjects(objs, kind === 'child' ? 'Add child node' : 'Add sibling node', false);
  doc.select([n.id]);
  doc.store.setState({ editingId: n.id });
  await pending;
}

// ───────────────────────── Connectors ─────────────────────────
export function connectorEnds(doc: CanvasDoc, o: CanvasObject): { a: Endpoint; b: Endpoint } {
  const objs = doc.state.objects;
  const from = o.data.from ? objs[String(o.data.from)] : undefined;
  const to = o.data.to ? objs[String(o.data.to)] : undefined;
  const fp: Vec = { x: Number(o.data.fx ?? 0), y: Number(o.data.fy ?? 0) }, tp: Vec = { x: Number(o.data.tx ?? 0), y: Number(o.data.ty ?? 0) };
  const centre = (x?: CanvasObject, p?: Vec) => (x ? { x: x.x + x.w / 2, y: x.y + x.h / 2 } : p!);
  const end = (x: CanvasObject | undefined, sideKey: string, free: Vec, other: Vec): Endpoint => {
    if (!x) return { point: free, side: null };
    const s = str(o.data[sideKey], 'auto');
    const side = (s === 'auto' ? facingSide(x, other) : s) as Side;
    return { point: portPoint(x, side), side };
  };
  return { a: end(from, 'fromSide', fp, centre(to, tp)), b: end(to, 'toSide', tp, centre(from, fp)) };
}

function ConnectorView({ obj, doc, selected, zoom }: ObjectViewProps) {
  useStore(doc.store, (s) => s.objects); // re-render when endpoints move
  const { a, b } = connectorEnds(doc, obj);
  const r = routePath(str(obj.data.route, 'curved') as Route, a, b);
  const color = str(obj.data.color) || 'var(--iln-fg-muted)';
  const w = Number(obj.data.width ?? 2);
  const label = str(obj.data.label);
  return (
    <g data-testid="connector" data-connector-id={obj.id}>
      {selected && <path d={r.d} fill="none" stroke="var(--iln-accent)" strokeOpacity={0.35} strokeWidth={w + 8 / zoom} />}
      <path d={r.d} fill="none" stroke={color} strokeWidth={w} strokeDasharray={obj.data.dash ? `${w * 4} ${w * 3}` : undefined} strokeLinecap="round" strokeLinejoin="round" />
      {obj.data.arrowEnd !== false && <path d={arrowHeadPath(b.point, r.endDir, 10 + w * 2)} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />}
      {!!obj.data.arrowStart && <path d={arrowHeadPath(a.point, r.startDir, 10 + w * 2)} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />}
      {label && <text x={r.mid.x} y={r.mid.y} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="var(--iln-fg)" stroke="var(--iln-canvas)" strokeWidth={4} paintOrder="stroke" data-testid="connector-label">{label}</text>}
    </g>
  );
}
registerObjectType({ type: 'connector', component: ConnectorView, svgLayer: true, toText: (o) => str(o.data.label) });
CanvasDoc.boundsResolvers.set('connector', (o, doc) => { const { a, b } = connectorEnds(doc, o); return boundsOf(routePath(str(o.data.route, 'curved') as Route, a, b).points); });

// ───────────────────────── Audio pins ─────────────────────────
function AudioPinView({ obj }: ObjectViewProps) {
  const id = str(obj.data.audioId);
  const clip = useLiveQuery(() => db.audio.get(id), [id]);
  const st = useAudio();
  const isMe = st.playing?.audioId === id;
  return (
    <div className="flex h-full w-full items-center gap-2 rounded-full border border-line bg-bg-1 px-2 shadow-md" data-testid="audio-pin">
      <button data-canvas-ui className="pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg" data-testid="audio-pin-play"
        onPointerDown={(e) => e.stopPropagation()} onClick={() => { if (!clip) return; if (isMe) togglePause(); else void play(clip); }}>
        {isMe && !st.paused ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px]">{clip?.name ?? 'Audio'}</div>
        <input data-canvas-ui type="range" min={0} max={clip?.durationMs ?? 1} value={isMe ? st.time : 0} className="pointer-events-auto h-1 w-full accent-[var(--iln-accent)]"
          onPointerDown={(e) => e.stopPropagation()} onChange={(e) => { if (!clip) return; if (isMe) seek(Number(e.target.value)); else void play(clip, Number(e.target.value)); }} />
      </div>
      <span className="text-[10px] tabular-nums text-fg-faint">{fmtTime(isMe ? st.time : 0)}/{fmtTime(clip?.durationMs ?? 0)}</span>
    </div>
  );
}
registerObjectType({ type: 'audio', component: AudioPinView, minSize: { w: 160, h: 40 }, toText: (o) => str(o.data.name, 'Audio note') });

// ───────────────────────── Tools & interactions ─────────────────────────
registerCanvasTool({ tool: 'sticky', icon: StickyNote, label: 'Sticky note', key: 'N' }, 'text');
registerCanvasTool({ tool: 'mindmap', icon: Network, label: 'Mind map node', key: '' }, 'sticky');
registerCanvasTool({ tool: 'connector', icon: Spline, label: 'Connector', key: 'C' }, 'arrow');

function hitConnector(ctx: PluginContext, w: Vec): CanvasObject | null {
  const doc = ctx.doc;
  const tol = 6 / ctx.camera().zoom;
  for (const o of Object.values(doc.state.objects).sort((p, q) => q.z - p.z)) {
    if (o.type !== 'connector') continue;
    const { a, b } = connectorEnds(doc, o);
    if (polylineDistance(routePath(str(o.data.route, 'curved') as Route, a, b).points, w) <= tol) return o;
  }
  return null;
}

function objectAt(doc: CanvasDoc, w: Vec, exclude?: string): CanvasObject | null {
  return Object.values(doc.state.objects).sort((a, b) => b.z - a.z).find((o) => o.id !== exclude && o.type !== 'connector' && o.type !== 'frame' && w.x >= o.x && w.x <= o.x + o.w && w.y >= o.y && w.y <= o.y + o.h) ?? null;
}

/** Drag session that creates a connector from an object/port (or free point) to wherever it's released. */
function connectorDrag(ctx: PluginContext, from: CanvasObject | null, start: Vec, fromSide: Side | 'auto') {
  let cur = start;
  const render = () => {
    const cam = ctx.camera();
    const A = from ? (fromSide === 'auto' ? portPoint(from, facingSide(from, cur)) : portPoint(from, fromSide)) : start;
    const target = objectAt(ctx.doc, cur, from?.id);
    const B = target ? nearestPort(target, cur).point : cur;
    const sa = toScreen(cam, A), sb = toScreen(cam, B);
    ctx.setPreview(
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <line x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} stroke="var(--iln-accent)" strokeWidth={2} strokeDasharray="6 4" />
        {target && (() => { const t = target; const tl = toScreen(cam, { x: t.x, y: t.y }); return <rect x={tl.x - 3} y={tl.y - 3} width={t.w * cam.zoom + 6} height={t.h * cam.zoom + 6} fill="none" stroke="var(--iln-accent)" strokeWidth={2} rx={4} />; })()}
      </svg>,
    );
  };
  render();
  return {
    move(w: Vec) { cur = w; render(); },
    async up(w: Vec) {
      ctx.setPreview(null);
      if (Math.hypot(w.x - start.x, w.y - start.y) * ctx.camera().zoom < 6) return;
      const target = objectAt(ctx.doc, w, from?.id);
      const t = useCanvasTools.getState();
      const data: Record<string, unknown> = { from: from?.id ?? null, to: target?.id ?? null, fromSide, toSide: target ? (() => { const np = nearestPort(target, w); return np.dist * ctx.camera().zoom < 24 ? np.side : 'auto'; })() : 'auto', route: 'curved', label: '', arrowEnd: true, arrowStart: false, color: '', width: Math.max(1.5, t.strokeWidth) };
      if (!from) { data.fx = start.x; data.fy = start.y; }
      if (!target) { data.tx = w.x; data.ty = w.y; }
      const c = ctx.doc.newObject('connector', { x: 0, y: 0, w: 0, h: 0 }, data);
      await ctx.doc.addObjects([c], 'Add connector');
      if (!t.sticky) t.setTool('select');
    },
    cancel() { ctx.setPreview(null); },
  };
}

/** Port dots on the single selected object for quick-connect. */
function PortsOverlay({ ctx }: { ctx: PluginContext }) {
  const sel = useStore(ctx.doc.store, (s) => s.selection);
  const objs = useStore(ctx.doc.store, (s) => s.objects);
  const cam = useStore(ctx.doc.store, (s) => s.camera);
  const editing = useStore(ctx.doc.store, (s) => s.editingId);
  const o = sel.length === 1 ? objs[sel[0]] : null;
  if (!o || editing || o.type === 'connector' || o.type === 'frame' || o.locked) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      {(['n', 'e', 's', 'w'] as Side[]).map((side) => {
        const p = portPoint(o, side), off = { n: [0, -18], e: [18, 0], s: [0, 18], w: [-18, 0] }[side];
        const s = toScreen(cam, p);
        return <circle key={side} data-canvas-ui data-testid={`port-${side}`} cx={s.x + off[0]} cy={s.y + off[1]} r={6} fill="var(--iln-accent)" stroke="var(--iln-bg-1)" strokeWidth={2}
          className="pointer-events-auto cursor-crosshair" onPointerDown={(e) => {
            e.stopPropagation();
            const el = ctx.container();
            if (!el) return;
            el.setPointerCapture(e.pointerId);
            const toW = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); const c = ctx.camera(); return { x: (ev.clientX - r.left) / c.zoom + c.x, y: (ev.clientY - r.top) / c.zoom + c.y }; };
            const sess = connectorDrag(ctx, o, p, side);
            const mv = (ev: PointerEvent) => sess.move(toW(ev));
            const upH = (ev: PointerEvent) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', upH); void sess.up(toW(ev)); };
            el.addEventListener('pointermove', mv);
            el.addEventListener('pointerup', upH);
          }} />;
      })}
    </svg>
  );
}

/** Style bar for a selected connector. */
function ConnectorBar({ ctx }: { ctx: PluginContext }) {
  const sel = useStore(ctx.doc.store, (s) => s.selection);
  const objs = useStore(ctx.doc.store, (s) => s.objects);
  const cam = useStore(ctx.doc.store, (s) => s.camera);
  const o = sel.length === 1 ? objs[sel[0]] : null;
  if (!o || o.type !== 'connector') return null;
  const { a, b } = connectorEnds(ctx.doc, o);
  const mid = toScreen(cam, routePath(str(o.data.route, 'curved') as Route, a, b).mid);
  const patch = (p: Record<string, unknown>, label: string) => void ctx.doc.updateObjects([{ ...o, data: { ...o.data, ...p } }], label);
  const btn = (on: boolean) => `rounded px-2 py-1 text-[11px] ${on ? 'bg-accent text-accent-fg' : 'hover:bg-bg-3'}`;
  return (
    <div data-canvas-ui className="absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-bg-1/95 p-1 shadow-xl" style={{ left: mid.x, top: mid.y - 56 }} data-testid="connector-bar">
      {(['straight', 'orthogonal', 'curved'] as Route[]).map((r) => <button key={r} className={btn(str(o.data.route, 'curved') === r)} onClick={() => patch({ route: r }, 'Connector route')} data-testid={`route-${r}`}>{r}</button>)}
      <div className="mx-0.5 h-5 w-px bg-line" />
      <button className={btn(!!o.data.arrowStart)} onClick={() => patch({ arrowStart: !o.data.arrowStart }, 'Arrow start')}>◀</button>
      <button className={btn(o.data.arrowEnd !== false)} onClick={() => patch({ arrowEnd: o.data.arrowEnd === false }, 'Arrow end')}>▶</button>
      <button className={btn(!!o.data.dash)} onClick={() => patch({ dash: !o.data.dash }, 'Dashed connector')}>┄</button>
      <button className={btn(false)} data-testid="connector-label-btn" onClick={async () => { const l = await promptDialog('Connector label', str(o.data.label)); if (l !== null) patch({ label: l }, 'Connector label'); }}>Label</button>
      {['', '#ef4444', '#22c55e', '#3b82f6', '#f59e0b'].map((c) => <button key={c || 'def'} className="h-5 w-5 rounded-full border border-line" style={{ background: c || 'var(--iln-fg-muted)' }} onClick={() => patch({ color: c }, 'Connector colour')} />)}
    </div>
  );
}

/** Synced-ink playback: while a recording plays, strokes drawn during it light up as their timestamps pass. */
function SyncedInkOverlay({ ctx }: { ctx: PluginContext }) {
  const st = useAudio();
  const strokes = useStore(ctx.doc.store, (s) => s.strokes);
  const cam = useStore(ctx.doc.store, (s) => s.camera);
  const ref = useRef<HTMLCanvasElement>(null);
  const active = st.playing && st.playing.pageId === ctx.doc.pageId;
  useEffect(() => {
    const c = ref.current;
    if (!c || !active) return;
    const el = ctx.container();
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = el.clientWidth * dpr; c.height = el.clientHeight * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
    const linked = Object.values(strokes).filter((s) => s.audioId === st.playing!.audioId);
    for (const s of linked) {
      const t = s.audioOffset ?? 0;
      const { path } = strokeRenderData(s);
      if (t <= st.time) {
        const recent = st.time - t < 1200;
        g.globalAlpha = recent ? 0.9 : 0.35;
        g.fillStyle = recent ? '#f59e0b' : '#38bdf8';
        g.fill(path);
      } else {
        // Not yet spoken: dim it.
        g.globalAlpha = 0.6;
        g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--iln-canvas') || '#111';
        g.fill(path);
      }
    }
  }, [active, st.time, strokes, cam, ctx, st.playing]);
  if (!active) return null;
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" data-testid="synced-ink" />;
}

function CanvasOverlays({ ctx }: { ctx: PluginContext }) {
  return <><PortsOverlay ctx={ctx} /><ConnectorBar ctx={ctx} /><SyncedInkOverlay ctx={ctx} /><RecordingBadge ctx={ctx} /></>;
}

function RecordingBadge({ ctx }: { ctx: PluginContext }) {
  const rec = useAudio((s) => s.recording);
  const [, tick] = useState(0);
  useEffect(() => { if (!rec) return; const i = window.setInterval(() => tick((n) => n + 1), 500); return () => window.clearInterval(i); }, [rec]);
  if (!rec || rec.pageId !== ctx.doc.pageId) return null;
  return <div className="pointer-events-none absolute top-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-danger px-3 py-1 text-[12px] text-white shadow-lg"><Mic size={12} />Recording {fmtTime(performance.now() - rec.startedAt)} · ink is synced</div>;
}

registerCanvasPlugin({
  onPointerDown(ctx, e, w) {
    const tool = useCanvasTools.getState().tool;
    if (tool === 'sticky') {
      const t = useCanvasTools.getState();
      const o = ctx.doc.newObject('sticky', { x: w.x - 100, y: w.y - 100, w: 200, h: 200 }, { text: '', color: STICKY_COLORS[Math.floor(Math.random() * 5)] });
      return { move() {}, async up() { await ctx.doc.addObjects([o], 'Add sticky note'); ctx.doc.store.setState({ editingId: o.id }); if (!t.sticky) t.setTool('select'); } };
    }
    if (tool === 'mindmap') {
      const t = useCanvasTools.getState();
      const o = ctx.doc.newObject('mindnode', { x: w.x - 70, y: w.y - 24, w: 140, h: 48 }, { text: 'Central idea', level: 0, color: '' });
      return { move() {}, async up() { await ctx.doc.addObjects([o], 'Add mind map'); ctx.doc.store.setState({ editingId: o.id }); if (!t.sticky) t.setTool('select'); } };
    }
    if (tool === 'connector') {
      const from = objectAt(ctx.doc, w);
      return connectorDrag(ctx, from, from ? nearestPort(from, w).point : w, from ? 'auto' : 'auto');
    }
    if (tool === 'select' && !e.shiftKey) {
      // Connectors live in the SVG layer, so hit-test them here.
      const obj = objectAt(ctx.doc, w);
      if (obj) return null;
      const c = hitConnector(ctx, w);
      if (c) { ctx.doc.select([c.id]); return { move() {}, up() {} }; }
    }
    return null;
  },
  onKeyDown(ctx, e) {
    const sel = ctx.doc.state.selection;
    if (sel.length !== 1) return false;
    const o = ctx.doc.state.objects[sel[0]];
    if (o?.type !== 'mindnode') return false;
    if (e.key === 'Tab') { void addMindNode(ctx.doc, o, 'child'); return true; }
    if (e.key === 'Enter' && !e.shiftKey) { void addMindNode(ctx.doc, o, 'sibling'); return true; }
    if (e.key === 'F2') { ctx.doc.store.setState({ editingId: o.id }); return true; }
    return false;
  },
  transformStroke(ctx, stroke) {
    const r = recordingOffset(ctx.doc.pageId);
    return r ? { ...stroke, audioId: r.audioId, audioOffset: r.offset } : stroke;
  },
  Overlay: CanvasOverlays,
});

