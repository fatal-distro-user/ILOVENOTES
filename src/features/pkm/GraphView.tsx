import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { Crosshair, SlidersHorizontal } from 'lucide-react';
import { db } from '@/db/schema';
import { useWorkspace } from '@/store/workspace';
import { useTabs } from '@/store/tabs';
import { Segmented } from '@/ui/Segmented';
import { Slider } from '@/ui/Slider';
import { openNode } from '@/layout/actions';
import { registerTabView, type TabViewProps } from '@/views/registry';
import {
  adjacency, buildGraph, buildLegend, colorOf, filterOrphans, graphSignature, matchesFilter, nodeRadius,
  type ColorMode, type Graph, type GNode, type OrphanMode,
} from './graphLogic';

interface SimNode extends SimulationNodeDatum { g: GNode; r: number; color: string }
type SimLink = SimulationLinkDatum<SimNode> & { kind: string };

interface Physics { repulsion: number; distance: number; gravity: number; collide: number }
const DEFAULT_PHYSICS: Physics = { repulsion: 220, distance: 70, gravity: 0.06, collide: 4 };

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function GraphView({ paneId }: TabViewProps) {
  const ws = useWorkspace((s) => s.workspaceId);
  const data = useLiveQuery(async () => {
    if (!ws) return null;
    const nodes = await db.nodes.where('workspaceId').equals(ws).filter((n) => !n.deletedAt && n.kind === 'page').toArray();
    const docs = await db.docs.toArray();
    const nbs = await db.notebooks.where('workspaceId').equals(ws).toArray();
    const embeds = (await db.canvasObjects.where('type').equals('embed').toArray())
      .filter((o) => typeof o.data.pageId === 'string')
      .map((o) => ({ from: o.pageId, to: String(o.data.pageId) }));
    return {
      pages: nodes.filter((n) => nbs.some((b) => b.id === n.notebookId && !b.deletedAt)).map((n) => ({ id: n.id, title: n.title, notebookId: n.notebookId, tags: n.tags })),
      links: docs.map((d) => [d.pageId, d.links] as const),
      notebooks: nbs.map((b) => [b.id, { name: b.name, color: b.color }] as const),
      embeds,
    };
  }, [ws], null);

  const [sharedTags, setSharedTags] = useState(false);
  const [tagNodes, setTagNodes] = useState(false);
  const [orphans, setOrphans] = useState<OrphanMode>('show');
  const [colorMode, setColorMode] = useState<ColorMode>('notebook');
  const [filter, setFilter] = useState('');
  const [physics, setPhysics] = useState<Physics>(DEFAULT_PHYSICS);
  const [panelOpen, setPanelOpen] = useState(true);

  const notebooks = useMemo(() => new Map(data?.notebooks ?? []), [data]);
  const graph: Graph = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    const full = buildGraph(data.pages, new Map(data.links), { sharedTags, tagNodes, embeds: data.embeds });
    return filterOrphans(full, orphans);
  }, [data, sharedTags, tagNodes, orphans]);
  const legend = useMemo(() => buildLegend(graph, colorMode, notebooks), [graph, colorMode, notebooks]);
  const signature = useMemo(() => graphSignature(graph), [graph]);

  // Mutable rendering state kept out of React.
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const hover = useRef<SimNode | null>(null);
  const adjRef = useRef<Map<string, Set<string>>>(new Map());
  const filterRef = useRef('');
  const dirty = useRef(true);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const fitted = useRef(false);
  const physRef = useRef(physics);
  physRef.current = physics;
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  const markDirty = () => { dirty.current = true; };

  // (Re)build simulation when topology changes, preserving positions.
  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.g.id, n]));
    const nodes: SimNode[] = graph.nodes.map((g, i) => {
      const old = prev.get(g.id);
      const angle = i * 2.399963;
      const rad = 20 * Math.sqrt(i + 1);
      return { g, r: nodeRadius(g), color: '#888', x: old?.x ?? Math.cos(angle) * rad, y: old?.y ?? Math.sin(angle) * rad, vx: old?.vx ?? 0, vy: old?.vy ?? 0 };
    });
    const byId = new Map(nodes.map((n) => [n.g.id, n]));
    const links: SimLink[] = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ source: byId.get(e.source) as SimNode, target: byId.get(e.target) as SimNode, kind: e.kind }));
    nodesRef.current = nodes;
    linksRef.current = links;
    adjRef.current = adjacency(graph);
    sim.current?.stop();
    const p = physRef.current;
    const s = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).distance(p.distance).strength(0.5))
      .force('charge', forceManyBody<SimNode>().strength(-p.repulsion))
      .force('center', forceCenter(0, 0))
      .force('x', forceX<SimNode>(0).strength(p.gravity))
      .force('y', forceY<SimNode>(0).strength(p.gravity))
      .force('collide', forceCollide<SimNode>().radius((n) => n.r + p.collide))
      .alpha(prev.size ? 0.5 : 1)
      .on('tick', markDirty);
    sim.current = s;
    if (!prev.size) fitted.current = false;
    markDirty();
    return () => { s.stop(); };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Physics sliders.
  useEffect(() => {
    const s = sim.current;
    if (!s) return;
    (s.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>).distance(physics.distance);
    (s.force('charge') as ReturnType<typeof forceManyBody<SimNode>>).strength(-physics.repulsion);
    (s.force('x') as ReturnType<typeof forceX<SimNode>>).strength(physics.gravity);
    (s.force('y') as ReturnType<typeof forceY<SimNode>>).strength(physics.gravity);
    (s.force('collide') as ReturnType<typeof forceCollide<SimNode>>).radius((n) => n.r + physics.collide);
    s.alpha(0.6).restart();
  }, [physics]);

  // Colours depend on mode/notebooks.
  useEffect(() => {
    for (const n of nodesRef.current) n.color = colorOf(n.g, colorMode, notebooks).color;
    markDirty();
  }, [colorMode, notebooks, signature]);
  useEffect(() => { filterRef.current = filter; markDirty(); }, [filter]);

  const fit = () => {
    const ns = nodesRef.current;
    const { w, h } = size.current;
    if (!ns.length || !w) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, (n.x ?? 0) - n.r); x1 = Math.max(x1, (n.x ?? 0) + n.r); y0 = Math.min(y0, (n.y ?? 0) - n.r); y1 = Math.max(y1, (n.y ?? 0) + n.r); }
    const k = Math.max(0.15, Math.min(2, Math.min((w - 120) / Math.max(1, x1 - x0), (h - 120) / Math.max(1, y1 - y0))));
    cam.current = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    markDirty();
  };

  // Render loop, resize and pointer handling.
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      if (!fitted.current) cam.current = { x: r.width / 2, y: r.height / 2, k: 1 };
      markDirty();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!fitted.current && (sim.current?.alpha() ?? 1) < 0.35 && nodesRef.current.length) { fitted.current = true; fit(); }
      if (!dirty.current) return;
      dirty.current = false;
      const { w, h, dpr } = size.current;
      const c = cam.current;
      const bg = cssVar('--iln-bg', '#111');
      const fg = cssVar('--iln-fg', '#eee');
      const muted = cssVar('--iln-fg-muted', '#999');
      const line = cssVar('--iln-line', '#444');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.k, c.k);
      const hv = hover.current;
      const nb = hv ? adjRef.current.get(hv.g.id) : undefined;
      const f = filterRef.current.trim();
      const isNear = (n: SimNode) => !hv || n === hv || !!nb?.has(n.g.id);
      const matched = (n: SimNode) => !f || matchesFilter(n.g, f);

      ctx.lineCap = 'round';
      for (const l of linksRef.current) {
        const a = l.source as SimNode, b = l.target as SimNode;
        const active = hv && (a === hv || b === hv);
        const dim = (hv && !active) || (f && !(matched(a) || matched(b)));
        ctx.globalAlpha = dim ? 0.07 : active ? 0.95 : l.kind === 'tag' || l.kind === 'tagnode' ? 0.28 : 0.5;
        ctx.strokeStyle = active ? cssVar('--iln-accent', '#7c5cff') : line;
        ctx.setLineDash(l.kind === 'tag' ? [4 / c.k, 4 / c.k] : l.kind === 'embed' ? [1, 3 / c.k] : []);
        ctx.lineWidth = (active ? 2 : 1.2) / Math.sqrt(c.k);
        ctx.beginPath();
        ctx.moveTo(a.x ?? 0, a.y ?? 0);
        ctx.lineTo(b.x ?? 0, b.y ?? 0);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      for (const n of nodesRef.current) {
        const dim = (hv && !isNear(n)) || (f && !matched(n));
        ctx.globalAlpha = dim ? 0.15 : 1;
        ctx.fillStyle = n.color;
        ctx.beginPath();
        if (n.g.kind === 'tag') {
          const x = n.x ?? 0, y = n.y ?? 0;
          ctx.moveTo(x, y - n.r); ctx.lineTo(x + n.r, y); ctx.lineTo(x, y + n.r); ctx.lineTo(x - n.r, y); ctx.closePath();
        } else ctx.arc(n.x ?? 0, n.y ?? 0, n.r, 0, Math.PI * 2);
        ctx.fill();
        if (n === hv || (f && matched(n))) {
          ctx.lineWidth = 2 / c.k;
          ctx.strokeStyle = fg;
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
      const labelAll = c.k > 0.85;
      const fs = 12 / Math.max(c.k, 0.6);
      ctx.font = `${fs}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const n of nodesRef.current) {
        const show = labelAll || n === hv || (hv && isNear(n)) || (f && matched(n));
        if (!show) continue;
        const dim = (hv && !isNear(n)) || (f && !matched(n));
        ctx.globalAlpha = dim ? 0.2 : n === hv ? 1 : 0.85;
        ctx.fillStyle = n === hv ? fg : muted;
        const text = n.g.label.length > 28 ? `${n.g.label.slice(0, 27)}…` : n.g.label;
        ctx.fillText(text, n.x ?? 0, (n.y ?? 0) + n.r + 3 / c.k);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);

    const toWorld = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      const c = cam.current;
      return { x: (e.clientX - r.left - c.x) / c.k, y: (e.clientY - r.top - c.y) / c.k };
    };
    const hit = (e: { clientX: number; clientY: number }): SimNode | null => {
      const p = toWorld(e);
      let best: SimNode | null = null;
      let bd = Infinity;
      for (const n of nodesRef.current) {
        const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
        if (d <= n.r + 4 / cam.current.k && d < bd) { best = n; bd = d; }
      }
      return best;
    };
    let drag: { node: SimNode | null; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const n = hit(e);
      drag = { node: n, sx: e.clientX, sy: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
      if (n) { n.fx = n.x; n.fy = n.y; sim.current?.alphaTarget(0.3).restart(); }
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.node) { const p = toWorld(e); drag.node.fx = p.x; drag.node.fy = p.y; }
        else { cam.current = { ...cam.current, x: drag.cx + dx, y: drag.cy + dy }; }
        markDirty();
        return;
      }
      const n = hit(e);
      if (n !== hover.current) {
        hover.current = n;
        canvas.style.cursor = n ? 'pointer' : 'grab';
        setHoverLabel(n ? n.g.label : null);
        markDirty();
      }
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      canvas.releasePointerCapture(e.pointerId);
      if (d.node) {
        d.node.fx = null; d.node.fy = null;
        sim.current?.alphaTarget(0);
        if (!d.moved) activate(d.node, e.ctrlKey || e.metaKey);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const c = cam.current;
      const k = Math.max(0.1, Math.min(6, c.k * Math.exp(-e.deltaY * 0.0015)));
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      cam.current = { k, x: mx - ((mx - c.x) / c.k) * k, y: my - ((my - c.y) / c.k) * k };
      fitted.current = true;
      markDirty();
    };
    const leave = () => { if (!drag && hover.current) { hover.current = null; setHoverLabel(null); markDirty(); } };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.style.cursor = 'grab';
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
    };
    function activate(n: SimNode, newTab: boolean) {
      if (n.g.kind === 'tag') useTabs.getState().open({ kind: 'search', title: n.g.label, params: { tags: n.g.tags[0] } }, { paneId, newTab });
      else openNode({ id: n.g.id, title: n.g.label }, { paneId, newTab });
    }
  }, [paneId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageCount = graph.nodes.filter((n) => n.kind === 'page').length;

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg" data-testid="graph-view" data-node-count={graph.nodes.length} data-page-count={pageCount} data-edge-count={graph.edges.length}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="h-full w-full touch-none" data-testid="graph-canvas" aria-label="Knowledge graph" />
      </div>
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 text-[12px] text-fg-muted">
        <span className="rounded-md bg-bg-1/80 px-2 py-1 backdrop-blur">{pageCount} pages · {graph.edges.length} links</span>
        {hoverLabel && <span className="rounded-md bg-bg-1/80 px-2 py-1 text-fg backdrop-blur">{hoverLabel}</span>}
      </div>
      {graph.nodes.length === 0 && data && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-fg-faint">No pages to show. Link pages with [[double brackets]].</div>
      )}
      <div className="absolute right-3 top-3 flex w-[260px] flex-col gap-2">
        <div className="flex justify-end gap-1.5">
          <button onClick={fit} title="Fit to view" className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-bg-1/90 text-fg-muted backdrop-blur hover:text-fg" data-testid="graph-fit"><Crosshair size={14} /></button>
          <button onClick={() => setPanelOpen((v) => !v)} title="Graph settings" aria-pressed={panelOpen} className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-bg-1/90 text-fg-muted backdrop-blur hover:text-fg"><SlidersHorizontal size={14} /></button>
        </div>
        {panelOpen && (
          <div className="max-h-[calc(100vh-190px)] space-y-3 overflow-y-auto rounded-lg border border-line bg-bg-1/90 p-3 text-[12px] backdrop-blur" data-testid="graph-controls">
            <input
              value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Highlight pages or #tags…" data-testid="graph-filter"
              className="h-7 w-full rounded-md border border-line bg-bg-2 px-2 text-[12.5px] text-fg outline-none placeholder:text-fg-faint focus:border-accent"
            />
            <div>
              <div className="mb-1 text-[10.5px] uppercase tracking-wider text-fg-faint">Orphans</div>
              <Segmented testId="graph-orphans" value={orphans} onChange={setOrphans} options={[{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }, { value: 'only', label: 'Only' }]} />
            </div>
            <div>
              <div className="mb-1 text-[10.5px] uppercase tracking-wider text-fg-faint">Color by</div>
              <Segmented value={colorMode} onChange={setColorMode} options={[{ value: 'notebook', label: 'Notebook' }, { value: 'tag', label: 'First tag' }]} />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-fg"><input type="checkbox" checked={sharedTags} onChange={(e) => setSharedTags(e.target.checked)} data-testid="graph-shared-tags" />Link pages sharing tags</label>
              <label className="flex items-center gap-2 text-fg"><input type="checkbox" checked={tagNodes} onChange={(e) => setTagNodes(e.target.checked)} data-testid="graph-tag-nodes" />Show tag nodes</label>
            </div>
            <div className="space-y-1.5">
              <div className="text-[10.5px] uppercase tracking-wider text-fg-faint">Forces</div>
              <Slider label="Repulsion" min={20} max={800} step={10} value={physics.repulsion} onChange={(v) => setPhysics((p) => ({ ...p, repulsion: v }))} />
              <Slider label="Link distance" min={20} max={240} step={5} value={physics.distance} onChange={(v) => setPhysics((p) => ({ ...p, distance: v }))} />
              <Slider label="Gravity" min={0} max={0.3} step={0.01} value={physics.gravity} onChange={(v) => setPhysics((p) => ({ ...p, gravity: v }))} format={(v) => v.toFixed(2)} />
              <Slider label="Collision" min={0} max={30} step={1} value={physics.collide} onChange={(v) => setPhysics((p) => ({ ...p, collide: v }))} />
            </div>
            <div>
              <div className="mb-1 text-[10.5px] uppercase tracking-wider text-fg-faint">Legend</div>
              <div className="space-y-0.5" data-testid="graph-legend">
                {legend.slice(0, 12).map((l) => (
                  <div key={l.key} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} /><span className="min-w-0 flex-1 truncate text-fg">{l.label}</span><span className="text-fg-faint">{l.count}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

registerTabView('graph', GraphView);
