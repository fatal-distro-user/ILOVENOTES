import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import type { PaintDocument } from '../engine/document';
import { useStatus } from '@/store/status';
import { useUndoScopes, stackScope } from '@/history/scopes';
import { usePaintStudio } from './store';
import { paintTool, paintTools, subscribePaintTools, paintOverlays, pointerConstraints, type PaintPointer, type ToolContext, type ToolSession } from './tools';

interface Cam { x: number; y: number; zoom: number }
const MIN = 0.05, MAX = 32;

function checker(): CanvasPattern | null {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  if (!x) return null;
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#d4d4d8'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  return x.createPattern(c, 'repeat');
}

export function usePaintToolsList() {
  return useSyncExternalStore(subscribePaintTools, paintTools);
}

/** The interactive raster painting viewport. `compact` = inline document sketch frame. */
export function PaintSurface({ doc, active, compact, onCameraFit }: { doc: PaintDocument; active: boolean; compact?: boolean; onCameraFit?: (fit: () => void) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const cam = useRef<Cam>({ x: 0, y: 0, zoom: 1 });
  const [camV, setCamV] = useState<Cam>(cam.current);
  const studio = usePaintStudio();
  const session = useRef<ToolSession | null>(null);
  const strokeStart = useRef<{ start: PaintPointer; lock: unknown } | null>(null);
  const hover = useRef<PaintPointer | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const pattern = useMemo(() => checker(), []);
  const raf = useRef(0);
  const scopeId = `paint:${doc.id}`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  usePaintToolsList();

  useEffect(() => useUndoScopes.getState().register(stackScope(scopeId, doc.meta.name ?? 'Painting', doc.history)), [doc, scopeId]);
  useEffect(() => {
    if (!active) return;
    useUndoScopes.getState().activate(scopeId);
    usePaintStudio.getState().setDoc(doc);
  }, [active, doc, scopeId]);

  const fit = useCallback(() => {
    const pad = compact ? 8 : 40;
    const z = Math.max(MIN, Math.min(MAX, Math.min((size.w - pad * 2) / doc.width, (size.h - pad * 2) / doc.height)));
    cam.current = { zoom: z, x: doc.width / 2 - size.w / 2 / z, y: doc.height / 2 - size.h / 2 / z };
    setCamV(cam.current);
  }, [size, doc, compact]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  // Keep the painting fitted to the viewport until the user pans/zooms themselves.
  const userMoved = useRef(false);
  useEffect(() => { if (!userMoved.current && size.w > 50 && size.h > 50) fit(); }, [size, fit]);
  useEffect(() => { onCameraFit?.(fit); }, [fit, onCameraFit]);

  const toolCtx = useMemo<ToolContext>(() => ({
    doc,
    get zoom() { return cam.current.zoom; },
    redrawOverlay: () => schedule(),
    screenToDoc: (px: number) => px / cam.current.zoom,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [doc]);

  const draw = useCallback(() => {
    const v = view.current, o = overlay.current;
    if (!v || !o) return;
    for (const c of [v, o]) {
      const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    }
    const g = v.getContext('2d');
    if (!g) return;
    const { x, y, zoom } = cam.current;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, -x * zoom * dpr, -y * zoom * dpr);
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 12 / zoom;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, doc.width, doc.height);
    g.shadowBlur = 0;
    if (pattern) {
      g.save();
      g.setTransform(dpr, 0, 0, dpr, -x * zoom * dpr, -y * zoom * dpr);
      g.fillStyle = pattern;
      g.fillRect(0, 0, doc.width * zoom, doc.height * zoom);
      g.restore();
    }
    g.imageSmoothingEnabled = zoom < 2;
    g.imageSmoothingQuality = 'high';
    g.drawImage(doc.composite(), 0, 0);
    // Overlay (doc space): tool previews, guides, selection.
    const og = o.getContext('2d');
    if (!og) return;
    og.setTransform(dpr, 0, 0, dpr, 0, 0);
    og.clearRect(0, 0, size.w, size.h);
    og.setTransform(dpr * zoom, 0, 0, dpr * zoom, -x * zoom * dpr, -y * zoom * dpr);
    for (const p of paintOverlays()) { og.save(); p(toolCtx, og); og.restore(); }
    const t = paintTool(usePaintStudio.getState().tool);
    if (t?.drawOverlay) { og.save(); t.drawOverlay(toolCtx, og, hover.current); og.restore(); }
  }, [size, dpr, doc, pattern, toolCtx]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => doc.subscribe(schedule), [doc, schedule]);
  useEffect(() => { schedule(); }, [schedule, camV, studio.tool, studio.size, studio.color]);

  useEffect(() => {
    if (!active) return;
    const layers = doc.layers.filter((l) => l.meta.kind !== 'group').length;
    useStatus.getState().set({ zoom: camV.zoom, layers, layerMemory: doc.memoryBytes(), words: null, chars: null, strokes: null });
  }, [active, camV, doc, doc.version]);

  const toDoc = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    const { x, y, zoom } = cam.current;
    return { x: (e.clientX - r.left) / zoom + x, y: (e.clientY - r.top) / zoom + y };
  };
  const pointer = (e: PointerEvent | React.PointerEvent): PaintPointer => {
    const p = toDoc(e);
    const pen = e.pointerType === 'pen';
    return { x: p.x, y: p.y, pressure: pen ? e.pressure : e.pointerType === 'touch' ? 0.5 : 0, tiltX: e.tiltX ?? 0, tiltY: e.tiltY ?? 0, t: e.timeStamp, pointerType: e.pointerType, shift: e.shiftKey, alt: e.altKey, mod: e.ctrlKey || e.metaKey, button: e.button };
  };
  const constrain = (p: PaintPointer) => {
    let q = p;
    if (strokeStart.current) for (const c of pointerConstraints()) q = c(doc, q, strokeStart.current);
    return q;
  };

  const setCam = (c: Cam) => { userMoved.current = true; cam.current = c; setCamV(c); };
  const zoomAt = (z: number, sx: number, sy: number) => {
    const c = cam.current;
    const nz = Math.max(MIN, Math.min(MAX, z));
    const wx = sx / c.zoom + c.x, wy = sy / c.zoom + c.y;
    setCam({ zoom: nz, x: wx - sx / nz, y: wy - sy / nz });
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number } | null>(null);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-paint-ui]')) return;
    box.current?.focus({ preventScroll: true });
    useUndoScopes.getState().activate(scopeId);
    usePaintStudio.getState().setDoc(doc);
    const r = box.current!.getBoundingClientRect();
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (pointers.current.size === 2) {
      session.current?.cancel?.();
      session.current = null;
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    box.current!.setPointerCapture(e.pointerId);
    const tool = usePaintStudio.getState().tool;
    if (e.button === 1 || space || tool === 'hand') { pan.current = { x: e.clientX, y: e.clientY }; return; }
    if (e.button === 2) return;
    const def = paintTool(tool);
    if (!def) return;
    const p = pointer(e);
    strokeStart.current = { start: p, lock: null };
    session.current = def.down(toolCtx, constrain(p));
    schedule();
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = box.current!.getBoundingClientRect();
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      zoomAt(cam.current.zoom * (d / (pinch.current.d || d)), mx, my);
      const c = cam.current;
      setCam({ ...c, x: c.x - (mx - pinch.current.mx) / c.zoom, y: c.y - (my - pinch.current.my) / c.zoom });
      pinch.current = { d, mx, my };
      return;
    }
    if (pan.current) {
      const c = cam.current;
      setCam({ ...c, x: c.x - (e.clientX - pan.current.x) / c.zoom, y: c.y - (e.clientY - pan.current.y) / c.zoom });
      pan.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const p = pointer(e);
    hover.current = p;
    if (active) useStatus.getState().set({ cursor: { x: p.x, y: p.y } });
    if (session.current) {
      const evs = (e.nativeEvent.getCoalescedEvents?.() ?? []) as PointerEvent[];
      for (const ev of evs.length ? evs : [e.nativeEvent]) session.current.move(constrain(pointer(ev)));
    }
    schedule();
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pan.current) { pan.current = null; return; }
    if (session.current) {
      const s = session.current;
      session.current = null;
      s.up(constrain(pointer(e)));
      strokeStart.current = null;
      schedule();
    }
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (compact && !(e.ctrlKey || e.metaKey)) return; // let documents scroll past inline sketches
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(cam.current.zoom * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
      else { const c = cam.current; setCam({ ...c, x: c.x + (e.shiftKey ? e.deltaY : e.deltaX) / c.zoom, y: c.y + (e.shiftKey ? 0 : e.deltaY) / c.zoom }); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
    const def = paintTool(usePaintStudio.getState().tool);
    if (def?.onKey?.(toolCtx, e.nativeEvent)) { e.preventDefault(); e.stopPropagation(); return; }
    const mod = e.ctrlKey || e.metaKey;
    const st = usePaintStudio.getState();
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === ' ') { setSpace(true); done(); return; }
    if (mod && e.key === '0') { fit(); done(); return; }
    if (mod && e.key === '1') { zoomAt(1, size.w / 2, size.h / 2); done(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { zoomAt(cam.current.zoom * 1.25, size.w / 2, size.h / 2); done(); return; }
    if (mod && e.key === '-') { zoomAt(cam.current.zoom / 1.25, size.w / 2, size.h / 2); done(); return; }
    if (mod) return;
    if (e.key === '[') { st.set({ size: Math.max(1, Math.round(st.size / 1.15)) }); done(); return; }
    if (e.key === ']') { st.set({ size: Math.min(1000, Math.round(st.size * 1.15 + 1)) }); done(); return; }
    if (e.key.toLowerCase() === 'x' && !e.shiftKey) { st.swapColors(); done(); return; }
    const byKey = paintTools().find((t) => t.key && t.key.toLowerCase() === e.key.toLowerCase());
    if (byKey) { st.setTool(byKey.id); done(); }
  };

  const tool = paintTool(studio.tool);
  const cursor = space || studio.tool === 'hand' ? (pan.current ? 'grabbing' : 'grab') : tool?.cursor?.(toolCtx) ?? 'crosshair';

  return (
    <div ref={box} tabIndex={0} data-testid="paint-surface" className={clsx('relative h-full w-full overflow-hidden outline-none', compact ? 'bg-bg-2' : 'bg-bg-3')}
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onPointerLeave={() => { hover.current = null; schedule(); }}
      onKeyDown={onKey} onKeyUp={(e) => { if (e.key === ' ') setSpace(false); }} onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={view} className="pointer-events-none absolute inset-0 h-full w-full" />
      <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" />
      {!compact && (
        <div data-paint-ui className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md border border-line bg-bg-1/90 px-1.5 py-0.5 text-[11px] text-fg-muted backdrop-blur">
          <button className="px-1 hover:text-fg" onClick={() => zoomAt(cam.current.zoom / 1.25, size.w / 2, size.h / 2)}>−</button>
          <button className="w-12 tabular-nums hover:text-fg" onClick={fit} title="Fit (Mod+0)" data-testid="paint-zoom">{Math.round(camV.zoom * 100)}%</button>
          <button className="px-1 hover:text-fg" onClick={() => zoomAt(cam.current.zoom * 1.25, size.w / 2, size.h / 2)}>+</button>
          <span className="ml-1 text-fg-faint">{doc.width}×{doc.height}</span>
        </div>
      )}
    </div>
  );
}
