import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import clsx from 'clsx';
import type { CanvasObject, Stroke } from '@/db/types';
import { nanoid } from 'nanoid';
import { useStatus, toast } from '@/store/status';
import { useUndoScopes, stackScope } from '@/history/scopes';
import { imageBlobToDataUrl } from '@/lib/image';
import { acquireCanvasDoc, releaseCanvasDoc, type CanvasDoc } from './doc';
import { panBy, zoomAt, toWorld, toScreen, normRect, rectsIntersect, pointInRotatedRect, fitRect, viewRect, type Vec, type Rect, clampZoom } from './camera';
import { drawBackground } from './background';
import { outlineFor, outlineToPath, strokeRenderData, strokeHitsCircle, strokeBounds, offsetPoints } from './ink';
import { useCanvasTools, TOOL_SHORTCUTS, type CanvasTool } from './tools';
import { objectType } from './objects/registry';
import { smartSnap, snapToGrid, type Guide } from './snapping';
import { HANDLES, HANDLE_CURSOR, handlePos, resizeRect, resizeRotated, mapRect, mapStroke, rotateObjectAround, rotateStrokeAround, snapAngle, type Handle } from './transform';
import { copySelection, pasteInto, duplicateSelection } from './clipboard';
import { CanvasToolbar, ZoomControls, Minimap, SelectionBar } from './CanvasChrome';
import './objects/builtins';

/** Hooks other modules use to extend canvas interaction (sticky notes, connectors, quickshape, audio sync). */
export interface CanvasPlugin {
  /** Handle pointer down for a custom tool. Return a drag session or null to fall through. */
  onPointerDown?(ctx: PluginContext, e: React.PointerEvent, world: Vec): DragSession | null;
  /** Keyboard handler; return true when handled. */
  onKeyDown?(ctx: PluginContext, e: React.KeyboardEvent): boolean;
  /** Called with every committed pen stroke before it's saved; may transform/replace it (return null to cancel). */
  transformStroke?(ctx: PluginContext, stroke: Stroke): Stroke | null;
  /** Live pen sample hook (QuickShape hold detection). Return true to finish the stroke immediately. */
  onPenSample?(ctx: PluginContext, points: number[], now: number): boolean | void;
  /** Files dropped on the canvas that aren't images (PDFs, audio). Return true when handled. */
  onDropFiles?(ctx: PluginContext, files: File[], world: Vec): boolean;
  /** Extra overlay rendered in screen space. */
  Overlay?: React.ComponentType<{ ctx: PluginContext }>;
}
export interface PluginContext { doc: CanvasDoc; camera: () => { x: number; y: number; zoom: number }; container: () => HTMLDivElement | null; setPreview(el: React.ReactNode): void }
export interface DragSession { move(world: Vec, e: PointerEvent): void; up(world: Vec, e: PointerEvent): void | Promise<void>; cancel?(): void }

const plugins: CanvasPlugin[] = [];
export function registerCanvasPlugin(p: CanvasPlugin): void { plugins.push(p); }

type Mode =
  | { kind: 'none' }
  | { kind: 'pan'; last: Vec }
  | { kind: 'marquee'; start: Vec; cur: Vec; additive: boolean }
  | { kind: 'move'; start: Vec; objs: CanvasObject[]; strokes: Stroke[]; bounds: Rect; moved: boolean }
  | { kind: 'resize'; handle: Handle; objs: CanvasObject[]; strokes: Stroke[]; bounds: Rect }
  | { kind: 'rotate'; center: Vec; startAngle: number; objs: CanvasObject[]; strokes: Stroke[] }
  | { kind: 'draw'; points: number[]; tool: 'pen' | 'highlighter' }
  | { kind: 'erase'; hit: Set<string> }
  | { kind: 'create'; tool: CanvasTool; start: Vec; cur: Vec }
  | { kind: 'laser' }
  | { kind: 'plugin'; session: DragSession };

function readThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    minor: cs.getPropertyValue('--iln-grid').trim() || 'rgba(127,127,127,.12)',
    major: cs.getPropertyValue('--iln-grid-strong').trim() || 'rgba(127,127,127,.24)',
    accent: 'rgba(239, 68, 68, 0.45)',
    canvas: cs.getPropertyValue('--iln-canvas').trim() || '#111',
    accentUi: cs.getPropertyValue('--iln-accent').trim() || '#7c5cff',
  };
}

export function CanvasView({ pageId, active, compact }: { pageId: string; active: boolean; compact?: boolean }) {
  const doc = useMemo(() => acquireCanvasDoc(pageId), [pageId]);
  useEffect(() => () => releaseCanvasDoc(pageId), [pageId]);
  const ready = useStore(doc.store, (s) => s.ready);
  if (!ready) return <div className="flex h-full items-center justify-center text-fg-faint">Loading canvas…</div>;
  return <CanvasSurface doc={doc} active={active} compact={compact} />;
}

function CanvasSurface({ doc, active, compact }: { doc: CanvasDoc; active: boolean; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const objects = useStore(doc.store, (s) => s.objects);
  const strokes = useStore(doc.store, (s) => s.strokes);
  const selection = useStore(doc.store, (s) => s.selection);
  const strokeSel = useStore(doc.store, (s) => s.strokeSelection);
  const camera = useStore(doc.store, (s) => s.camera);
  const settings = useStore(doc.store, (s) => s.settings);
  const editingId = useStore(doc.store, (s) => s.editingId);
  const tools = useCanvasTools();
  const mode = useRef<Mode>({ kind: 'none' });
  const [modeView, setModeView] = useState<Mode>({ kind: 'none' });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hiddenStrokes, setHiddenStrokes] = useState<Set<string>>(new Set());
  const [spaceDown, setSpaceDown] = useState(false);
  const [pluginPreview, setPluginPreview] = useState<React.ReactNode>(null);
  const pointers = useRef(new Map<number, Vec>());
  const pinch = useRef<{ dist: number; mid: Vec } | null>(null);
  const laser = useRef<{ x: number; y: number; t: number }[]>([]);
  const lastPointer = useRef<Vec>({ x: 0, y: 0 });
  const colorsRef = useRef(readThemeColors());
  const scopeId = `canvas:${doc.pageId}`;

  const pluginCtx = useMemo<PluginContext>(() => ({
    doc, camera: () => doc.state.camera, container: () => containerRef.current, setPreview: setPluginPreview,
  }), [doc]);

  const setMode = (m: Mode) => { mode.current = m; setModeView(m); };

  // ───────── undo scope ─────────
  useEffect(() => useUndoScopes.getState().register(stackScope(scopeId, 'Canvas', doc.history)), [doc, scopeId]);
  useEffect(() => { if (active) useUndoScopes.getState().activate(scopeId); }, [active, scopeId]);

  // ───────── size ─────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Theme changes → refresh colours.
  useEffect(() => {
    const mo = new MutationObserver(() => { colorsRef.current = readThemeColors(); drawBg(); drawInk(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => mo.disconnect();
  });

  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;

  const prepCanvas = (c: HTMLCanvasElement | null) => {
    if (!c) return null;
    const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };

  const drawBg = useCallback(() => {
    const ctx = prepCanvas(bgRef.current);
    if (!ctx) return;
    drawBackground(ctx, settings.background, camera, size.w, size.h, settings.gridSize, colorsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.background, settings.gridSize, camera, size, dpr]);

  const drawInk = useCallback(() => {
    const ctx = prepCanvas(inkRef.current);
    if (!ctx) return;
    ctx.clearRect(0, 0, size.w, size.h);
    const view = viewRect(camera, size.w, size.h);
    ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, -camera.x * camera.zoom * dpr, -camera.y * camera.zoom * dpr);
    const list = Object.values(strokes).sort((a, b) => a.createdAt - b.createdAt);
    for (const s of list) {
      if (hiddenStrokes.has(s.id)) continue;
      const { path, bounds } = strokeRenderData(s);
      if (!rectsIntersect(bounds, view)) continue;
      ctx.globalAlpha = s.opacity;
      ctx.globalCompositeOperation = s.tool === 'highlighter' ? 'multiply' : 'source-over';
      ctx.fillStyle = s.color;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Selected strokes get an outline of their bounds.
    if (strokeSel.length) {
      ctx.strokeStyle = colorsRef.current.accentUi;
      ctx.lineWidth = 1 / camera.zoom;
      ctx.setLineDash([4 / camera.zoom, 3 / camera.zoom]);
      for (const id of strokeSel) { const s = strokes[id]; if (s) { const b = strokeBounds(s.points, s.width); ctx.strokeRect(b.x, b.y, b.w, b.h); } }
      ctx.setLineDash([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, camera, size, hiddenStrokes, strokeSel, dpr]);

  useEffect(() => { drawBg(); }, [drawBg]);
  useEffect(() => { drawInk(); }, [drawInk]);

  // Status readouts.
  useEffect(() => {
    if (!active) return;
    useStatus.getState().set({ zoom: camera.zoom, strokes: Object.keys(strokes).length, words: null, chars: null });
  }, [active, camera.zoom, strokes]);

  // ───────── coordinate helpers ─────────
  const screenPt = (e: { clientX: number; clientY: number }): Vec => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const worldPt = (e: { clientX: number; clientY: number }): Vec => toWorld(doc.state.camera, screenPt(e));

  const hitObject = (w: Vec): CanvasObject | null => {
    const list = Object.values(doc.state.objects).sort((a, b) => b.z - a.z);
    for (const o of list) {
      const def = objectType(o.type);
      if (def?.svgLayer) continue;
      if (o.type === 'frame') {
        // Frames are only grabbed by their border/title so you can work inside them.
        const inside = pointInRotatedRect(w, { x: o.x, y: o.y, w: o.w, h: o.h }, o.rotation);
        const inner = pointInRotatedRect(w, { x: o.x + 10, y: o.y + 10, w: o.w - 20, h: o.h - 20 }, o.rotation);
        const title = w.x >= o.x && w.x <= o.x + Math.min(o.w, 220) && w.y >= o.y - 26 && w.y <= o.y;
        if ((inside && !inner) || title) return o;
        continue;
      }
      const pad = (o.type === 'shape' && (o.data.shape === 'line' || o.data.shape === 'arrow')) ? 6 / doc.state.camera.zoom : 0;
      if (pointInRotatedRect(w, { x: o.x - pad, y: o.y - pad, w: o.w + pad * 2, h: o.h + pad * 2 }, o.rotation)) return o;
    }
    return null;
  };

  const hitStroke = (w: Vec): Stroke | null => {
    const r = 4 / doc.state.camera.zoom;
    const list = Object.values(doc.state.strokes).sort((a, b) => b.createdAt - a.createdAt);
    for (const s of list) if (strokeHitsCircle(s.points, s.width, w, r)) return s;
    return null;
  };

  const snapshotSelection = () => {
    const s = doc.state;
    return {
      objs: s.selection.map((id) => s.objects[id]).filter(Boolean),
      strokes: s.strokeSelection.map((id) => s.strokes[id]).filter(Boolean),
    };
  };

  // ───────── live ink rendering ─────────
  const renderLive = () => {
    const ctx = prepCanvas(liveRef.current);
    if (!ctx) return;
    ctx.clearRect(0, 0, size.w, size.h);
    const cam = doc.state.camera;
    const m = mode.current;
    if (m.kind === 'draw' && m.points.length >= 4) {
      ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
      const isHl = m.tool === 'highlighter';
      const t = useCanvasTools.getState();
      ctx.globalAlpha = isHl ? 0.45 : t.penOpacity;
      ctx.fillStyle = isHl ? t.hlColor : t.penColor;
      ctx.fill(outlineToPath(outlineFor(m.points, m.tool, isHl ? t.hlWidth : t.penWidth, false)));
      ctx.globalAlpha = 1;
    }
    if (laser.current.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now();
      laser.current = laser.current.filter((p) => now - p.t < 700);
      for (let i = 1; i < laser.current.length; i++) {
        const a = laser.current[i - 1], b = laser.current[i];
        const life = 1 - (now - b.t) / 700;
        const A = toScreen(cam, a), B = toScreen(cam, b);
        ctx.strokeStyle = `rgba(255, 60, 60, ${life})`;
        ctx.lineWidth = 2 + 4 * life;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
      if (laser.current.length) requestAnimationFrame(renderLive);
    }
  };

  // ───────── pointer handlers ─────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-canvas-ui]')) return;
    const el = containerRef.current!;
    el.focus({ preventScroll: true });
    useUndoScopes.getState().activate(scopeId);
    pointers.current.set(e.pointerId, screenPt(e));
    if (pointers.current.size === 2) {
      // Two-finger pinch/pan replaces whatever single-pointer gesture began.
      mode.current.kind === 'plugin' && mode.current.session.cancel?.();
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      setMode({ kind: 'none' });
      renderLive();
      return;
    }
    el.setPointerCapture(e.pointerId);
    const w = worldPt(e);
    const tool = useCanvasTools.getState().tool;
    const { editingId: ed } = doc.state;
    if (ed) doc.store.setState({ editingId: null });

    if (e.button === 1 || tool === 'hand' || spaceDown) { setMode({ kind: 'pan', last: screenPt(e) }); return; }
    if (e.button === 2) return;

    for (const p of plugins) {
      const session = p.onPointerDown?.(pluginCtx, e, w);
      if (session) { setMode({ kind: 'plugin', session }); return; }
    }

    if (tool === 'pen' || tool === 'highlighter') {
      const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
      setMode({ kind: 'draw', points: [w.x, w.y, pressure, 0], tool });
      (mode.current as { t0?: number }).t0 = performance.now();
      return;
    }
    if (tool === 'eraser') {
      setMode({ kind: 'erase', hit: new Set() });
      eraseAt(w);
      return;
    }
    if (tool === 'laser') { laser.current.push({ ...w, t: performance.now() }); setMode({ kind: 'laser' }); renderLive(); return; }
    if (tool === 'text') {
      const o = doc.newObject('text', { x: w.x, y: w.y - 14, w: 260, h: 34 }, { text: '', fontSize: 20, color: useCanvasTools.getState().penColor });
      void doc.addObjects([o], 'Add text').then(() => doc.store.setState({ editingId: o.id }));
      if (!useCanvasTools.getState().sticky) useCanvasTools.getState().setTool('select');
      return;
    }
    if (['rect', 'ellipse', 'diamond', 'triangle', 'line', 'arrow', 'frame'].includes(tool)) {
      setMode({ kind: 'create', tool, start: w, cur: w });
      return;
    }

    // Select tool.
    const hit = hitObject(w);
    if (hit) {
      const sel = doc.state.selection;
      if (e.shiftKey) {
        if (sel.includes(hit.id)) doc.store.setState({ selection: sel.filter((id) => id !== hit.id) });
        else doc.select([hit.id], [], true);
        return;
      }
      if (!sel.includes(hit.id)) doc.select([hit.id]);
      startMove(w);
      return;
    }
    const sHit = hitStroke(w);
    if (sHit) {
      if (e.shiftKey) doc.select([], [sHit.id], true);
      else if (!doc.state.strokeSelection.includes(sHit.id)) doc.select([], [sHit.id]);
      startMove(w);
      return;
    }
    if (!e.shiftKey) doc.clearSelection();
    setMode({ kind: 'marquee', start: w, cur: w, additive: e.shiftKey });
  };

  const startMove = (w: Vec) => {
    const snap = snapshotSelection();
    // Moving a frame carries everything inside it.
    const frames = snap.objs.filter((o) => o.type === 'frame');
    if (frames.length) {
      const ids = new Set(snap.objs.map((o) => o.id));
      const sids = new Set(snap.strokes.map((s) => s.id));
      for (const f of frames) {
        const fr = { x: f.x, y: f.y, w: f.w, h: f.h };
        for (const o of Object.values(doc.state.objects)) if (!ids.has(o.id) && o.id !== f.id && rectsIntersect(fr, doc.objectBounds(o)) && o.x >= f.x && o.y >= f.y && o.x + o.w <= f.x + f.w && o.y + o.h <= f.y + f.h) { snap.objs.push(o); ids.add(o.id); }
        for (const s of Object.values(doc.state.strokes)) { const b = strokeBounds(s.points, 0); if (!sids.has(s.id) && b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h) { snap.strokes.push(s); sids.add(s.id); } }
      }
    }
    const movable = snap.objs.filter((o) => !o.locked);
    const bounds = doc.selectionBounds() ?? { x: w.x, y: w.y, w: 0, h: 0 };
    setMode({ kind: 'move', start: w, objs: movable, strokes: snap.strokes, bounds, moved: false });
  };

  const eraseAt = (w: Vec) => {
    const m = mode.current;
    if (m.kind !== 'erase') return;
    const r = useCanvasTools.getState().eraserSize / 2 / doc.state.camera.zoom;
    let changed = false;
    for (const s of Object.values(doc.state.strokes)) {
      if (m.hit.has(s.id)) continue;
      const b = strokeBounds(s.points, s.width);
      if (w.x < b.x - r || w.x > b.x + b.w + r || w.y < b.y - r || w.y > b.y + b.h + r) continue;
      if (strokeHitsCircle(s.points, s.width, w, r)) { m.hit.add(s.id); changed = true; }
    }
    if (changed) setHiddenStrokes(new Set(m.hit));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sp = screenPt(e);
    lastPointer.current = sp;
    const cam = doc.state.camera;
    const w = toWorld(cam, sp);
    if (active) useStatus.getState().set({ cursor: w });
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, sp);

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let c = zoomAt(cam, cam.zoom * (dist / (pinch.current.dist || dist)), mid);
      c = panBy(c, mid.x - pinch.current.mid.x, mid.y - pinch.current.mid.y);
      doc.setCamera(c);
      pinch.current = { dist, mid };
      return;
    }

    const m = mode.current;
    switch (m.kind) {
      case 'pan': doc.setCamera(panBy(cam, sp.x - m.last.x, sp.y - m.last.y)); m.last = sp; return;
      case 'marquee': m.cur = w; setModeView({ ...m }); return;
      case 'draw': {
        const evs = (e.nativeEvent.getCoalescedEvents?.() ?? []) as PointerEvent[];
        const samples = evs.length ? evs : [e.nativeEvent];
        const t0 = (m as { t0?: number }).t0 ?? 0;
        for (const ev of samples) {
          const q = toWorld(cam, screenPt(ev));
          const pr = ev.pointerType === 'pen' ? ev.pressure : 0.5;
          m.points.push(q.x, q.y, pr, performance.now() - t0);
        }
        let finish = false;
        for (const p of plugins) if (p.onPenSample?.(pluginCtx, m.points, performance.now())) finish = true;
        renderLive();
        if (finish) void endDraw();
        return;
      }
      case 'erase': eraseAt(w); return;
      case 'laser': laser.current.push({ ...w, t: performance.now() }); renderLive(); return;
      case 'create': m.cur = w; setModeView({ ...m }); return;
      case 'plugin': m.session.move(w, e.nativeEvent); return;
      case 'move': {
        let dx = w.x - m.start.x, dy = w.y - m.start.y;
        if (!m.moved && Math.hypot(dx, dy) * cam.zoom < 3) return;
        m.moved = true;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        let moved = { ...m.bounds, x: m.bounds.x + dx, y: m.bounds.y + dy };
        const t = useCanvasTools.getState();
        let g: Guide[] = [];
        if (t.snapToGrid && !e.altKey) {
          const gs = doc.state.settings.gridSize;
          dx += snapToGrid(moved.x, gs) - moved.x; dy += snapToGrid(moved.y, gs) - moved.y;
        } else if (t.smartGuides && !e.altKey) {
          const movingIds = new Set(m.objs.map((o) => o.id));
          const view = viewRect(cam, size.w, size.h);
          const others = Object.values(doc.state.objects).filter((o) => !movingIds.has(o.id) && objectType(o.type)?.svgLayer !== true).map((o) => doc.objectBounds(o)).filter((r) => rectsIntersect(r, view));
          const r = smartSnap(moved, others, 6 / cam.zoom);
          dx += r.dx; dy += r.dy; g = r.guides;
        }
        moved = { ...m.bounds, x: m.bounds.x + dx, y: m.bounds.y + dy };
        setGuides(g);
        doc.preview(m.objs.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })), m.strokes.map((s) => ({ ...s, points: offsetPoints(s.points, dx, dy) })));
        return;
      }
      case 'resize': {
        const t = useCanvasTools.getState();
        if (m.objs.length === 1 && !m.strokes.length) {
          const o = m.objs[0];
          const def = objectType(o.type);
          let p = w;
          if (t.snapToGrid && !e.altKey) { const gs = doc.state.settings.gridSize; p = { x: snapToGrid(w.x, gs), y: snapToGrid(w.y, gs) }; }
          const r = resizeRotated(o, m.handle, p, e.shiftKey || !!def?.lockAspect, def?.minSize ?? { w: 4, h: 4 });
          doc.preview([{ ...o, ...r }]);
        } else {
          const r = resizeRect(m.bounds, m.handle, w, e.shiftKey, 4);
          doc.preview(m.objs.map((o) => ({ ...o, ...mapRect(o, m.bounds, r) })), m.strokes.map((s) => mapStroke(s, m.bounds, r)));
        }
        return;
      }
      case 'rotate': {
        let a = Math.atan2(w.y - m.center.y, w.x - m.center.x) - m.startAngle;
        if (e.shiftKey) a = snapAngle(a);
        doc.preview(m.objs.map((o) => rotateObjectAround(o, m.center, a)), m.strokes.map((s) => rotateStrokeAround(s, m.center, a)));
        return;
      }
    }
  };

  const endDraw = async () => {
    const m = mode.current;
    if (m.kind !== 'draw') return;
    setMode({ kind: 'none' });
    const t = useCanvasTools.getState();
    const isHl = m.tool === 'highlighter';
    let stroke: Stroke | null = {
      id: nanoid(), pageId: doc.pageId, points: m.points, color: isHl ? t.hlColor : t.penColor,
      width: isHl ? t.hlWidth : t.penWidth, opacity: isHl ? 0.45 : t.penOpacity, tool: m.tool, createdAt: Date.now(),
    };
    for (const p of plugins) { if (!stroke) break; if (p.transformStroke) stroke = p.transformStroke(pluginCtx, stroke); }
    renderLive();
    if (stroke) await doc.commit(isHl ? 'Highlight' : 'Pen stroke', { strokes: { put: [stroke] } }, 'vector');
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const w = worldPt(e);
    const m = mode.current;
    setGuides([]);
    switch (m.kind) {
      case 'draw': await endDraw(); return;
      case 'erase':
        setMode({ kind: 'none' });
        if (m.hit.size) await doc.commit(`Erase ${m.hit.size} stroke(s)`, { strokes: { remove: Array.from(m.hit) } }, 'vector');
        setHiddenStrokes(new Set());
        return;
      case 'marquee': {
        setMode({ kind: 'none' });
        const r = normRect(m.start, m.cur);
        if (r.w * doc.state.camera.zoom < 3 && r.h * doc.state.camera.zoom < 3) return;
        const objs = Object.values(doc.state.objects).filter((o) => rectsIntersect(r, doc.objectBounds(o)) && !(o.type === 'frame' && !(o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x + r.w && o.y + o.h <= r.y + r.h))).map((o) => o.id);
        const sts = Object.values(doc.state.strokes).filter((s) => rectsIntersect(r, strokeBounds(s.points, 0))).map((s) => s.id);
        doc.select(objs, sts, m.additive);
        return;
      }
      case 'move': {
        setMode({ kind: 'none' });
        if (!m.moved) {
          // Click without drag on a grouped/selected object keeps selection.
          return;
        }
        const cur = doc.state;
        const objs = m.objs.map((o) => cur.objects[o.id]).filter(Boolean);
        const strokesNow = m.strokes.map((s) => cur.strokes[s.id]).filter(Boolean);
        await doc.commit(`Move ${objs.length + strokesNow.length} item(s)`, { objects: { put: objs.map((o) => ({ ...o, updatedAt: Date.now() })) }, strokes: { put: strokesNow } }, 'object', { objects: m.objs, strokes: m.strokes });
        return;
      }
      case 'resize': case 'rotate': {
        setMode({ kind: 'none' });
        const cur = doc.state;
        const objs = m.objs.map((o) => cur.objects[o.id]).filter(Boolean);
        const strokesNow = m.strokes.map((s) => cur.strokes[s.id]).filter(Boolean);
        await doc.commit(m.kind === 'resize' ? 'Resize' : 'Rotate', { objects: { put: objs }, strokes: { put: strokesNow } }, 'object', { objects: m.objs, strokes: m.strokes });
        return;
      }
      case 'create': {
        setMode({ kind: 'none' });
        const t = useCanvasTools.getState();
        let r = normRect(m.start, m.cur);
        const click = r.w * doc.state.camera.zoom < 4 && r.h * doc.state.camera.zoom < 4;
        if (e.shiftKey && !['line', 'arrow'].includes(m.tool)) { const s = Math.max(r.w, r.h); r = { x: m.cur.x < m.start.x ? m.start.x - s : m.start.x, y: m.cur.y < m.start.y ? m.start.y - s : m.start.y, w: s, h: s }; }
        if (click) r = m.tool === 'frame' ? { x: m.start.x, y: m.start.y, w: 640, h: 420 } : ['line', 'arrow'].includes(m.tool) ? { x: m.start.x, y: m.start.y, w: 160, h: 0 } : { x: m.start.x - 80, y: m.start.y - 50, w: 160, h: 100 };
        if (t.snapToGrid) { const gs = doc.state.settings.gridSize; r = { x: snapToGrid(r.x, gs), y: snapToGrid(r.y, gs), w: Math.max(gs, snapToGrid(r.w, gs)), h: ['line', 'arrow'].includes(m.tool) ? snapToGrid(r.h, gs) : Math.max(gs, snapToGrid(r.h, gs)) }; }
        let o: CanvasObject;
        if (m.tool === 'frame') {
          o = doc.newObject('frame', r, { text: 'Frame', color: 'var(--iln-line)' });
          o.z = Math.min(0, ...Object.values(doc.state.objects).map((x) => x.z)) - 1;
        } else if (m.tool === 'line' || m.tool === 'arrow') {
          const end = click ? { x: m.start.x + 160, y: m.start.y } : (e.shiftKey ? (() => { const a = snapAngle(Math.atan2(m.cur.y - m.start.y, m.cur.x - m.start.x), 45); const L = Math.hypot(m.cur.x - m.start.x, m.cur.y - m.start.y); return { x: m.start.x + Math.cos(a) * L, y: m.start.y + Math.sin(a) * L }; })() : m.cur);
          const box = normRect(m.start, end);
          const bw = Math.max(1, box.w), bh = Math.max(1, box.h);
          o = doc.newObject('shape', { x: box.x, y: box.y, w: bw, h: bh }, {
            shape: m.tool, stroke: t.strokeColor, strokeWidth: t.strokeWidth,
            x1: (m.start.x - box.x) / bw, y1: (m.start.y - box.y) / bh, x2: (end.x - box.x) / bw, y2: (end.y - box.y) / bh,
          });
        } else {
          o = doc.newObject('shape', r, { shape: m.tool, stroke: t.strokeColor, fill: t.fillColor, strokeWidth: t.strokeWidth, text: '', fontSize: 16 });
        }
        await doc.addObjects([o], `Add ${m.tool}`);
        if (!t.sticky) t.setTool('select');
        return;
      }
      case 'plugin': setMode({ kind: 'none' }); await m.session.up(w, e.nativeEvent); return;
      case 'laser': setMode({ kind: 'none' }); return;
      case 'pan': setMode({ kind: 'none' }); return;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-canvas-ui]')) return;
    const w = worldPt(e);
    const hit = hitObject(w);
    if (hit && objectType(hit.type)?.onOpen) { objectType(hit.type)!.onOpen!(hit, doc); return; }
    if (hit && objectType(hit.type)?.editable && !hit.locked) { doc.select([hit.id]); doc.store.setState({ editingId: hit.id }); return; }
    if (!hit && useCanvasTools.getState().tool === 'select') {
      // Double-click on empty canvas: create a text box.
      const o = doc.newObject('text', { x: w.x, y: w.y - 14, w: 260, h: 34 }, { text: '', fontSize: 20 });
      void doc.addObjects([o], 'Add text').then(() => doc.store.setState({ editingId: o.id }));
    }
  };

  // Wheel: pan, or zoom with Ctrl/⌘ / trackpad pinch.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-canvas-ui]') || (e.target as HTMLElement).closest('[contenteditable="true"]')) return;
      e.preventDefault();
      const cam = doc.state.camera;
      const r = el.getBoundingClientRect();
      const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        doc.setCamera(zoomAt(cam, cam.zoom * factor, anchor));
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        doc.setCamera(panBy(cam, -(e.shiftKey ? e.deltaY : e.deltaX) * k, -(e.shiftKey ? 0 : e.deltaY) * k));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [doc]);

  // Paste images / canvas clipboard.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onPaste = (e: ClipboardEvent) => {
      if (doc.state.editingId) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      e.preventDefault();
      const at = toWorld(doc.state.camera, lastPointer.current);
      if (files.length) { void insertImages(files, at); return; }
      void pasteInto(doc, at);
    };
    el.addEventListener('paste', onPaste);
    return () => el.removeEventListener('paste', onPaste);
  });

  const insertImages = async (files: File[] | Blob[], at: Vec) => {
    const objs: CanvasObject[] = [];
    let x = at.x;
    for (const f of files) {
      try {
        const { src, width, height } = await imageBlobToDataUrl(f, 2400);
        const scale = Math.min(1, 600 / Math.max(width, height));
        objs.push(doc.newObject('image', { x, y: at.y, w: width * scale, h: height * scale }, { src, alt: (f as File).name ?? 'image' }));
        x += width * scale + 16;
      } catch (err) { toast(err instanceof Error ? err.message : 'Could not insert image', 'error'); }
    }
    if (objs.length) await doc.addObjects(objs, objs.length > 1 ? `Add ${objs.length} images` : 'Add image');
  };

  const onDrop = (e: React.DragEvent) => {
    const all = Array.from(e.dataTransfer.files);
    if (!all.length) return;
    e.preventDefault();
    const w = worldPt(e);
    const images = all.filter((f) => f.type.startsWith('image/'));
    const others = all.filter((f) => !f.type.startsWith('image/'));
    if (images.length) void insertImages(images, w);
    if (others.length) for (const p of plugins) if (p.onDropFiles?.(pluginCtx, others, w)) break;
  };

  // ───────── keyboard ─────────
  const fitAll = () => {
    const b = doc.contentBounds();
    doc.setCamera(b ? fitRect(b, size.w, size.h) : { x: -size.w / 2, y: -size.h / 2, zoom: 1 });
  };
  const zoomBy = (f: number) => doc.setCamera(zoomAt(doc.state.camera, doc.state.camera.zoom * f, { x: size.w / 2, y: size.h / 2 }));
  const setZoom = (z: number) => doc.setCamera(zoomAt(doc.state.camera, clampZoom(z), { x: size.w / 2, y: size.h / 2 }));

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (doc.state.editingId || (e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
    for (const p of plugins) if (p.onKeyDown?.(pluginCtx, e)) { e.preventDefault(); return; }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === ' ' && !spaceDown) { setSpaceDown(true); handled(); return; }
    if (k === 'Delete' || k === 'Backspace') { void doc.deleteSelection(); handled(); return; }
    if (k === 'Escape') { doc.clearSelection(); useCanvasTools.getState().setTool('select'); handled(); return; }
    if (mod && k.toLowerCase() === 'a') { doc.select(Object.keys(doc.state.objects), Object.keys(doc.state.strokes)); handled(); return; }
    if (mod && k.toLowerCase() === 'c') { void copySelection(doc).then((n) => n && toast(`Copied ${n} item(s)`)); handled(); return; }
    if (mod && k.toLowerCase() === 'x') { void copySelection(doc, true); handled(); return; }
    if (mod && k.toLowerCase() === 'd') { void duplicateSelection(doc); handled(); return; }
    if (mod && k.toLowerCase() === 'g') { void (e.shiftKey ? ungroup(doc) : group(doc)); handled(); return; }
    if (mod && e.shiftKey && k.toLowerCase() === 'l') { void toggleLock(doc); handled(); return; }
    if (mod && (k === '=' || k === '+')) { zoomBy(1.25); handled(); return; }
    if (mod && k === '-') { zoomBy(0.8); handled(); return; }
    if (mod && k === '0') { setZoom(1); handled(); return; }
    if (e.shiftKey && k === '!') { fitAll(); handled(); return; }
    if (e.shiftKey && (e.code === 'Digit1')) { fitAll(); handled(); return; }
    if (e.shiftKey && (e.code === 'Digit2')) { const b = doc.selectionBounds(); if (b) doc.setCamera(fitRect(b, size.w, size.h)); handled(); return; }
    if (k === ']' || k === '[') { void reorder(doc, k === ']' ? (mod ? 'front' : 'forward') : (mod ? 'back' : 'backward')); handled(); return; }
    if (k.startsWith('Arrow') && (doc.state.selection.length || doc.state.strokeSelection.length)) {
      const step = e.shiftKey ? 10 : 1;
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      void nudge(doc, dx, dy);
      handled(); return;
    }
    if (k === 'Enter' && doc.state.selection.length === 1) {
      const o = doc.state.objects[doc.state.selection[0]];
      if (o && objectType(o.type)?.editable) { doc.store.setState({ editingId: o.id }); handled(); }
      return;
    }
    if (!mod && !e.altKey && k.length === 1) {
      const tool = TOOL_SHORTCUTS[k.toUpperCase()];
      if (tool) { useCanvasTools.getState().setTool(tool); handled(); }
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => { if (e.key === ' ') setSpaceDown(false); };

  // ───────── selection overlay ─────────
  const selBounds = useMemo(() => doc.selectionBounds(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, strokeSel, objects, strokes]);
  const single = selection.length === 1 && !strokeSel.length ? objects[selection[0]] : null;
  const anyLocked = selection.some((id) => objects[id]?.locked);
  const isLine = single?.type === 'shape' && (single.data.shape === 'line' || single.data.shape === 'arrow');

  const startResize = (h: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    containerRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, screenPt(e));
    const snap = snapshotSelection();
    setMode({ kind: 'resize', handle: h, objs: snap.objs.filter((o) => !o.locked), strokes: snap.strokes, bounds: doc.selectionBounds()! });
  };
  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    containerRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, screenPt(e));
    const b = doc.selectionBounds()!;
    const center = single ? { x: single.x + single.w / 2, y: single.y + single.h / 2 } : { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const w = worldPt(e);
    const snap = snapshotSelection();
    setMode({ kind: 'rotate', center, startAngle: Math.atan2(w.y - center.y, w.x - center.x), objs: snap.objs.filter((o) => !o.locked), strokes: snap.strokes });
  };

  /** Line/arrow endpoint editing. */
  const startEndpoint = (which: 1 | 2) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!single) return;
    containerRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, screenPt(e));
    const o0 = single;
    const other = which === 1 ? { x: o0.x + Number(o0.data.x2 ?? 1) * o0.w, y: o0.y + Number(o0.data.y2 ?? 1) * o0.h } : { x: o0.x + Number(o0.data.x1 ?? 0) * o0.w, y: o0.y + Number(o0.data.y1 ?? 0) * o0.h };
    let last = o0;
    setMode({
      kind: 'plugin', session: {
        move: (w, ev) => {
          let p = w;
          if (ev.shiftKey) { const a = snapAngle(Math.atan2(w.y - other.y, w.x - other.x), 45), L = Math.hypot(w.x - other.x, w.y - other.y); p = { x: other.x + Math.cos(a) * L, y: other.y + Math.sin(a) * L }; }
          const a = which === 1 ? p : other, b = which === 1 ? other : p;
          const box = normRect(a, b), bw = Math.max(1, box.w), bh = Math.max(1, box.h);
          last = { ...o0, x: box.x, y: box.y, w: bw, h: bh, data: { ...o0.data, x1: (a.x - box.x) / bw, y1: (a.y - box.y) / bh, x2: (b.x - box.x) / bw, y2: (b.y - box.y) / bh } };
          doc.preview([last]);
        },
        up: () => doc.updateObjects([last], 'Edit line', [o0]),
      },
    });
  };

  const worldTransform = `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`;
  const sortedObjects = useMemo(() => Object.values(objects).sort((a, b) => a.z - b.z), [objects]);
  const view = viewRect(camera, size.w, size.h);
  const cursor = spaceDown || tools.tool === 'hand' || modeView.kind === 'pan' ? (modeView.kind === 'pan' ? 'grabbing' : 'grab')
    : ['pen', 'highlighter'].includes(tools.tool) ? 'crosshair' : tools.tool === 'eraser' ? 'cell' : tools.tool === 'text' ? 'text'
    : ['rect', 'ellipse', 'diamond', 'triangle', 'line', 'arrow', 'frame', 'sticky', 'connector'].includes(tools.tool) ? 'crosshair' : tools.tool === 'laser' ? 'none' : 'default';

  const sb = selBounds ? { a: toScreen(camera, selBounds), b: toScreen(camera, { x: selBounds.x + selBounds.w, y: selBounds.y + selBounds.h }) } : null;

  return (
    <div ref={containerRef} tabIndex={0} data-testid="canvas" className={clsx('relative h-full w-full overflow-hidden outline-none select-none', compact && 'rounded')}
      style={{ background: settings.bgColor ?? 'var(--iln-canvas)', cursor, touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => void onPointerUp(e)} onPointerCancel={(e) => void onPointerUp(e)}
      onDoubleClick={onDoubleClick} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => { if (Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) e.preventDefault(); }} onDrop={onDrop}>
      <canvas ref={bgRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute top-0 left-0 origin-top-left" style={{ transform: worldTransform }} data-testid="canvas-world">
        {sortedObjects.map((o) => {
          const def = objectType(o.type);
          if (!def || def.svgLayer) return null;
          if (!rectsIntersect(doc.objectBounds(o), { x: view.x - 200, y: view.y - 200, w: view.w + 400, h: view.h + 400 }) && editingId !== o.id) return null;
          const C = def.component;
          const editing = editingId === o.id;
          return (
            <div key={o.id} data-object-id={o.id} data-object-type={o.type} className={clsx('absolute', editing && 'pointer-events-auto')}
              style={{ left: o.x, top: o.y, width: o.w, height: o.h, transform: o.rotation ? `rotate(${o.rotation}rad)` : undefined, zIndex: o.z }}>
              <C obj={o} doc={doc} editing={editing} selected={selection.includes(o.id)} zoom={camera.zoom} />
            </div>
          );
        })}
      </div>
      {/* SVG-layer object types (connectors) render in world space too. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <g transform={`translate(${-camera.x * camera.zoom} ${-camera.y * camera.zoom}) scale(${camera.zoom})`}>
          {sortedObjects.filter((o) => objectType(o.type)?.svgLayer).map((o) => { const C = objectType(o.type)!.component; return <C key={o.id} obj={o} doc={doc} editing={editingId === o.id} selected={selection.includes(o.id)} zoom={camera.zoom} />; })}
        </g>
      </svg>
      <canvas ref={inkRef} className="pointer-events-none absolute inset-0 h-full w-full" data-testid="canvas-ink" />
      <canvas ref={liveRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Screen-space overlay: marquee, guides, selection handles, create preview. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {modeView.kind === 'marquee' && (() => { const r = normRect(toScreen(camera, modeView.start), toScreen(camera, modeView.cur)); return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="color-mix(in srgb, var(--iln-accent) 12%, transparent)" stroke="var(--iln-accent)" strokeDasharray="4 3" data-testid="marquee" />; })()}
        {modeView.kind === 'create' && (() => {
          const a = toScreen(camera, modeView.start), b = toScreen(camera, modeView.cur), r = normRect(a, b);
          if (modeView.tool === 'line' || modeView.tool === 'arrow') return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--iln-accent)" strokeWidth={2} strokeDasharray="5 4" />;
          if (modeView.tool === 'ellipse') return <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} fill="none" stroke="var(--iln-accent)" strokeDasharray="5 4" />;
          return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="var(--iln-accent)" strokeDasharray="5 4" />;
        })()}
        {guides.map((g, i) => {
          if (g.axis === 'x') { const a = toScreen(camera, { x: g.pos, y: g.from }), b = toScreen(camera, { x: g.pos, y: g.to }); return <line key={i} x1={a.x} y1={a.y - 8} x2={b.x} y2={b.y + 8} stroke="#ff3d81" strokeWidth={1} />; }
          const a = toScreen(camera, { x: g.from, y: g.pos }), b = toScreen(camera, { x: g.to, y: g.pos });
          return <line key={i} x1={a.x - 8} y1={a.y} x2={b.x + 8} y2={b.y} stroke="#ff3d81" strokeWidth={1} />;
        })}
        {tools.tool === 'eraser' && (() => { const r = tools.eraserSize / 2; return <circle cx={lastPointer.current.x} cy={lastPointer.current.y} r={r} fill="none" stroke="var(--iln-fg-muted)" strokeDasharray="2 2" />; })()}
      </svg>

      {sb && modeView.kind !== 'move' && modeView.kind !== 'create' && !editingId && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" data-testid="selection-overlay">
          {single && single.rotation ? (() => {
            const c = toScreen(camera, { x: single.x + single.w / 2, y: single.y + single.h / 2 });
            const w = single.w * camera.zoom, h = single.h * camera.zoom;
            return (
              <g transform={`translate(${c.x} ${c.y}) rotate(${(single.rotation * 180) / Math.PI})`}>
                <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke="var(--iln-accent)" strokeWidth={1.5} />
                {!anyLocked && HANDLES.map((hd) => { const p = handlePos({ x: -w / 2, y: -h / 2, w, h }, hd); return <rect key={hd} data-canvas-handle x={p.x - 4.5} y={p.y - 4.5} width={9} height={9} rx={2} fill="var(--iln-bg-1)" stroke="var(--iln-accent)" strokeWidth={1.5} className="pointer-events-auto" style={{ cursor: HANDLE_CURSOR[hd] }} onPointerDown={startResize(hd)} />; })}
                {!anyLocked && <circle data-canvas-handle cx={0} cy={-h / 2 - 22} r={5.5} fill="var(--iln-bg-1)" stroke="var(--iln-accent)" strokeWidth={1.5} className="pointer-events-auto" style={{ cursor: 'grab' }} onPointerDown={startRotate} />}
              </g>
            );
          })() : isLine && single ? (() => {
            const p1 = toScreen(camera, { x: single.x + Number(single.data.x1 ?? 0) * single.w, y: single.y + Number(single.data.y1 ?? 0) * single.h });
            const p2 = toScreen(camera, { x: single.x + Number(single.data.x2 ?? 1) * single.w, y: single.y + Number(single.data.y2 ?? 1) * single.h });
            return (
              <g>
                {[p1, p2].map((p, i) => <circle key={i} data-canvas-handle cx={p.x} cy={p.y} r={6} fill="var(--iln-bg-1)" stroke="var(--iln-accent)" strokeWidth={2} className="pointer-events-auto" style={{ cursor: 'move' }} onPointerDown={startEndpoint((i + 1) as 1 | 2)} data-testid={`line-end-${i + 1}`} />)}
              </g>
            );
          })() : (
            <g>
              <rect x={sb.a.x} y={sb.a.y} width={sb.b.x - sb.a.x} height={sb.b.y - sb.a.y} fill="none" stroke="var(--iln-accent)" strokeWidth={1.5} strokeDasharray={anyLocked ? '4 3' : undefined} />
              {!anyLocked && HANDLES.map((hd) => { const p = handlePos({ x: sb.a.x, y: sb.a.y, w: sb.b.x - sb.a.x, h: sb.b.y - sb.a.y }, hd); return <rect key={hd} data-canvas-handle data-testid={`handle-${hd}`} x={p.x - 4.5} y={p.y - 4.5} width={9} height={9} rx={2} fill="var(--iln-bg-1)" stroke="var(--iln-accent)" strokeWidth={1.5} className="pointer-events-auto" style={{ cursor: HANDLE_CURSOR[hd] }} onPointerDown={startResize(hd)} />; })}
              {!anyLocked && <circle data-canvas-handle data-testid="handle-rotate" cx={(sb.a.x + sb.b.x) / 2} cy={sb.a.y - 22} r={5.5} fill="var(--iln-bg-1)" stroke="var(--iln-accent)" strokeWidth={1.5} className="pointer-events-auto" style={{ cursor: 'grab' }} onPointerDown={startRotate} />}
            </g>
          )}
        </svg>
      )}

      {pluginPreview}
      {plugins.map((p, i) => p.Overlay ? <p.Overlay key={i} ctx={pluginCtx} /> : null)}

      <CanvasToolbar doc={doc} compact={compact} onInsertImages={(files) => void insertImages(files, toWorld(camera, { x: size.w / 2 - 150, y: size.h / 2 - 100 }))} />
      <ZoomControls zoom={camera.zoom} onZoom={zoomBy} onSet={setZoom} onFit={fitAll} doc={doc} />
      {!compact && <Minimap doc={doc} size={size} />}
      {(selection.length > 0 || strokeSel.length > 0) && sb && !editingId && modeView.kind === 'none' && (
        <SelectionBar doc={doc} anchor={{ x: (sb.a.x + sb.b.x) / 2, y: sb.a.y }} containerH={size.h} />
      )}
    </div>
  );
}

// ───────── selection operations (also used by SelectionBar) ─────────
export async function group(doc: CanvasDoc): Promise<void> {
  const ids = doc.state.selection;
  if (ids.length < 2) return;
  const gid = nanoid();
  await doc.patchObjects(ids, () => ({ groupId: gid }), 'Group');
}
export async function ungroup(doc: CanvasDoc): Promise<void> {
  const ids = doc.state.selection.filter((id) => doc.state.objects[id]?.groupId);
  if (ids.length) await doc.patchObjects(ids, () => ({ groupId: null }), 'Ungroup');
}
export async function toggleLock(doc: CanvasDoc): Promise<void> {
  const ids = doc.state.selection;
  const lock = ids.some((id) => !doc.state.objects[id]?.locked);
  await doc.patchObjects(ids, () => ({ locked: lock }), lock ? 'Lock' : 'Unlock');
}
export async function nudge(doc: CanvasDoc, dx: number, dy: number): Promise<void> {
  const s = doc.state;
  const objs = s.selection.map((id) => s.objects[id]).filter((o) => o && !o.locked);
  const strokes = s.strokeSelection.map((id) => s.strokes[id]).filter(Boolean);
  await doc.commit('Nudge', { objects: { put: objs.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })) }, strokes: { put: strokes.map((st) => ({ ...st, points: offsetPoints(st.points, dx, dy) })) } });
}
export async function reorder(doc: CanvasDoc, where: 'front' | 'back' | 'forward' | 'backward'): Promise<void> {
  const s = doc.state;
  const sel = new Set(s.selection);
  if (!sel.size) return;
  const all = Object.values(s.objects).sort((a, b) => a.z - b.z);
  let order = all.map((o) => o.id);
  if (where === 'front') order = [...order.filter((id) => !sel.has(id)), ...order.filter((id) => sel.has(id))];
  else if (where === 'back') order = [...order.filter((id) => sel.has(id)), ...order.filter((id) => !sel.has(id))];
  else if (where === 'forward') { for (let i = order.length - 2; i >= 0; i--) if (sel.has(order[i]) && !sel.has(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]]; }
  else for (let i = 1; i < order.length; i++) if (sel.has(order[i]) && !sel.has(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
  const changed = order.map((id, i) => ({ ...s.objects[id], z: i + 1 })).filter((o) => s.objects[o.id].z !== o.z);
  if (changed.length) await doc.updateObjects(changed, where === 'front' ? 'Bring to front' : where === 'back' ? 'Send to back' : where === 'forward' ? 'Bring forward' : 'Send backward');
}
