import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import clsx from 'clsx';
import {
  MousePointer2, Hand, Pen, Highlighter, Eraser, Type, Square, Circle, Diamond, Triangle, Minus, MoveUpRight, Frame, ImagePlus,
  ZoomIn, ZoomOut, Maximize, Grid3x3, Lock, Unlock, Group, Ungroup, Copy, Trash2, BringToFront, SendToBack,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Magnet, Pin, Wand, type LucideIcon,
} from 'lucide-react';
import type { CanvasDoc } from './doc';
import { useCanvasTools, PEN_COLORS, type CanvasTool } from './tools';
import { BACKGROUNDS } from './background';
import { align, distribute, type AlignKind } from './snapping';
import { rectUnion, toWorld, viewRect, type Rect } from './camera';
import { strokeBounds } from './ink';
import { Popover } from '@/ui/Popover';
import { Slider } from '@/ui/Slider';
import { openFiles } from '@/platform/fileio';
import { group, ungroup, toggleLock, reorder } from './CanvasView';
import { duplicateSelection } from './clipboard';

interface ToolDef { tool: CanvasTool; icon: LucideIcon; label: string; key: string }
const TOOLS: ToolDef[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { tool: 'hand', icon: Hand, label: 'Hand (pan)', key: 'H' },
  { tool: 'pen', icon: Pen, label: 'Pen', key: 'P' },
  { tool: 'highlighter', icon: Highlighter, label: 'Highlighter', key: 'M' },
  { tool: 'eraser', icon: Eraser, label: 'Stroke eraser', key: 'E' },
  { tool: 'text', icon: Type, label: 'Text', key: 'T' },
  { tool: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' },
  { tool: 'diamond', icon: Diamond, label: 'Diamond', key: 'D' },
  { tool: 'triangle', icon: Triangle, label: 'Triangle', key: '' },
  { tool: 'line', icon: Minus, label: 'Line', key: 'L' },
  { tool: 'arrow', icon: MoveUpRight, label: 'Arrow', key: 'A' },
  { tool: 'frame', icon: Frame, label: 'Frame', key: 'F' },
  { tool: 'laser', icon: Wand, label: 'Laser pointer', key: 'K' },
];

/** Extra tool buttons registered by other modules (sticky notes, connectors, …). */
const extraTools: ToolDef[] = [];
export function registerCanvasTool(def: ToolDef, afterTool?: CanvasTool): void {
  if (extraTools.some((t) => t.tool === def.tool)) return;
  const idx = afterTool ? TOOLS.findIndex((t) => t.tool === afterTool) : -1;
  if (idx >= 0) TOOLS.splice(idx + 1, 0, def); else extraTools.push(def);
}

function ToolBtn({ active, title, onClick, children, testId }: { active?: boolean; title: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode; testId?: string }) {
  return (
    <button data-canvas-ui title={title} data-testid={testId} onClick={onClick}
      className={clsx('flex h-8 w-8 items-center justify-center rounded-md', active ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3 hover:text-fg')}>
      {children}
    </button>
  );
}

function ColorRow({ value, onChange, colors = PEN_COLORS, allowNone }: { value: string; onChange: (c: string) => void; colors?: string[]; allowNone?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {allowNone && <button title="None" onClick={() => onChange('transparent')} className={clsx('h-5 w-5 rounded border border-line bg-[linear-gradient(45deg,transparent_45%,var(--iln-danger)_45%,var(--iln-danger)_55%,transparent_55%)]', value === 'transparent' && 'ring-2 ring-accent')} />}
      {colors.map((c) => <button key={c} title={c} onClick={() => onChange(c)} className={clsx('h-5 w-5 rounded border border-line', value === c && 'ring-2 ring-accent')} style={{ background: c }} />)}
      <input type="color" value={value.startsWith('#') ? value.slice(0, 7) : '#888888'} onChange={(e) => onChange(e.target.value)} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" title="Custom colour" />
    </div>
  );
}

export function CanvasToolbar({ doc, compact, onInsertImages }: { doc: CanvasDoc; compact?: boolean; onInsertImages: (files: Blob[]) => void }) {
  const t = useCanvasTools();
  const settings = useStore(doc.store, (s) => s.settings);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [bgAnchor, setBgAnchor] = useState<HTMLElement | null>(null);
  const insertImage = async () => {
    const files = await openFiles({ multiple: true, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }] });
    onInsertImages(files.map((f) => new Blob([f.data as BlobPart], { type: f.name.endsWith('.svg') ? 'image/svg+xml' : f.name.match(/\.jpe?g$/i) ? 'image/jpeg' : `image/${f.name.split('.').pop()}` })));
  };
  const all = [...TOOLS, ...extraTools];
  const showStyle = ['pen', 'highlighter', 'eraser', 'rect', 'ellipse', 'diamond', 'triangle', 'line', 'arrow'].includes(t.tool);
  return (
    <div data-canvas-ui className={clsx('absolute top-1/2 left-2 z-20 flex -translate-y-1/2 flex-col gap-0.5 rounded-lg border border-line bg-bg-1/95 p-1 shadow-xl backdrop-blur', compact && 'scale-90')} data-testid="canvas-toolbar">
      {all.map((d) => (
        <ToolBtn key={d.tool} active={t.tool === d.tool} title={`${d.label}${d.key ? ` (${d.key})` : ''}`} onClick={() => t.setTool(d.tool)} testId={`tool-${d.tool}`}><d.icon size={16} /></ToolBtn>
      ))}
      <ToolBtn title="Insert image" onClick={() => void insertImage()} testId="tool-image"><ImagePlus size={16} /></ToolBtn>
      <div className="my-0.5 h-px bg-line" />
      <ToolBtn title="Tool lock (stay on tool after creating)" active={t.sticky} onClick={() => t.set({ sticky: !t.sticky })}><Pin size={15} /></ToolBtn>
      {showStyle && (
        <button data-canvas-ui title="Tool style" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-bg-3" data-testid="tool-style">
          <span className="h-4 w-4 rounded-full border border-line" style={{ background: t.tool === 'highlighter' ? t.hlColor : t.tool === 'pen' ? t.penColor : t.strokeColor }} />
        </button>
      )}
      <ToolBtn title="Background & snapping" onClick={(e) => setBgAnchor(bgAnchor ? null : e.currentTarget)} testId="canvas-bg-btn"><Grid3x3 size={15} /></ToolBtn>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} side="bottom">
          <div data-canvas-ui className="flex w-64 flex-col gap-2 p-3">
            {t.tool === 'pen' && <>
              <ColorRow value={t.penColor} onChange={(c) => t.set({ penColor: c })} />
              <Slider label="Width" value={t.penWidth} min={1} max={48} onChange={(v) => t.set({ penWidth: v })} />
              <Slider label="Opacity" value={Math.round(t.penOpacity * 100)} min={10} max={100} onChange={(v) => t.set({ penOpacity: v / 100 })} format={(v) => `${v}%`} />
            </>}
            {t.tool === 'highlighter' && <>
              <ColorRow value={t.hlColor} onChange={(c) => t.set({ hlColor: c })} colors={['#facc15', '#a3e635', '#22d3ee', '#f472b6', '#fb923c', '#c084fc']} />
              <Slider label="Width" value={t.hlWidth} min={6} max={60} onChange={(v) => t.set({ hlWidth: v })} />
            </>}
            {t.tool === 'eraser' && <Slider label="Eraser size" value={t.eraserSize} min={4} max={120} onChange={(v) => t.set({ eraserSize: v })} />}
            {['rect', 'ellipse', 'diamond', 'triangle', 'line', 'arrow'].includes(t.tool) && <>
              <div className="text-[11px] text-fg-faint">Stroke</div>
              <ColorRow value={t.strokeColor} onChange={(c) => t.set({ strokeColor: c })} />
              {!['line', 'arrow'].includes(t.tool) && <><div className="text-[11px] text-fg-faint">Fill</div><ColorRow value={t.fillColor} onChange={(c) => t.set({ fillColor: c })} allowNone /></>}
              <Slider label="Stroke width" value={t.strokeWidth} min={1} max={16} onChange={(v) => t.set({ strokeWidth: v })} />
            </>}
          </div>
        </Popover>
      )}
      {bgAnchor && (
        <Popover anchor={bgAnchor} onClose={() => setBgAnchor(null)}>
          <div data-canvas-ui className="flex w-60 flex-col gap-2 p-3" data-testid="canvas-bg-menu">
            <div className="text-[11px] font-semibold tracking-wide text-fg-faint uppercase">Background</div>
            <div className="grid grid-cols-2 gap-1">
              {BACKGROUNDS.map((b) => (
                <button key={b.id} data-testid={`bg-${b.id}`} onClick={() => void doc.setSettings({ background: b.id })}
                  className={clsx('rounded border px-2 py-1 text-left', settings.background === b.id ? 'border-accent bg-accent/15 text-fg' : 'border-line text-fg-muted hover:bg-bg-3')}>{b.label}</button>
              ))}
            </div>
            <Slider label="Grid size" value={settings.gridSize} min={8} max={96} step={4} onChange={(v) => void doc.setSettings({ gridSize: v })} />
            <label className="flex items-center gap-2"><input type="checkbox" checked={t.snapToGrid} onChange={(e) => t.set({ snapToGrid: e.target.checked })} data-testid="snap-grid" /><Magnet size={13} />Snap to grid</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={t.smartGuides} onChange={(e) => t.set({ smartGuides: e.target.checked })} />Smart alignment guides</label>
            <div className="text-[11px] text-fg-faint">Hold Alt while dragging to disable snapping.</div>
          </div>
        </Popover>
      )}
    </div>
  );
}

export function ZoomControls({ zoom, onZoom, onSet, onFit }: { zoom: number; onZoom: (f: number) => void; onSet: (z: number) => void; onFit: () => void; doc: CanvasDoc }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div data-canvas-ui className="absolute top-2 right-2 z-20 flex items-center gap-0.5 rounded-lg border border-line bg-bg-1/95 p-0.5 shadow-lg backdrop-blur">
      <ToolBtn title="Zoom out (Mod+-)" onClick={() => onZoom(0.8)}><ZoomOut size={15} /></ToolBtn>
      <button data-canvas-ui className="w-14 rounded px-1 py-1 text-center tabular-nums hover:bg-bg-3" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} data-testid="zoom-label">{Math.round(zoom * 100)}%</button>
      <ToolBtn title="Zoom in (Mod+=)" onClick={() => onZoom(1.25)}><ZoomIn size={15} /></ToolBtn>
      <ToolBtn title="Fit content (Shift+1)" onClick={onFit} testId="zoom-fit"><Maximize size={14} /></ToolBtn>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end">
          <div data-canvas-ui className="flex flex-col p-1">
            {[0.1, 0.25, 0.5, 1, 2, 4, 8].map((z) => <button key={z} className="rounded px-3 py-1 text-left hover:bg-bg-3" onClick={() => { onSet(z); setAnchor(null); }}>{z * 100}%</button>)}
          </div>
        </Popover>
      )}
    </div>
  );
}

export function Minimap({ doc, size }: { doc: CanvasDoc; size: { w: number; h: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const objects = useStore(doc.store, (s) => s.objects);
  const strokes = useStore(doc.store, (s) => s.strokes);
  const camera = useStore(doc.store, (s) => s.camera);
  const W = 180, H = 120;
  const frame = useRef<{ world: Rect; k: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const view = viewRect(camera, size.w, size.h);
    const items = [
      ...Object.values(objects).map((o) => ({ r: doc.objectBounds(o), kind: o.type })),
      ...Object.values(strokes).map((s) => ({ r: strokeBounds(s.points, s.width), kind: 'stroke' as const })),
    ];
    const world = rectUnion([view, ...items.map((i) => i.r)]) as Rect;
    const pad = 40;
    const wr = { x: world.x - pad, y: world.y - pad, w: world.w + pad * 2, h: world.h + pad * 2 };
    const k = Math.min(W / wr.w, H / wr.h);
    const ox = (W - wr.w * k) / 2 - wr.x * k, oy = (H - wr.h * k) / 2 - wr.y * k;
    frame.current = { world: wr, k, ox, oy };
    c.width = W * 2; c.height = H * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement);
    for (const it of items) {
      ctx.fillStyle = it.kind === 'stroke' ? cs.getPropertyValue('--iln-fg-muted') : it.kind === 'frame' ? 'transparent' : cs.getPropertyValue('--iln-fg-faint');
      ctx.strokeStyle = cs.getPropertyValue('--iln-fg-faint');
      const x = it.r.x * k + ox, y = it.r.y * k + oy, w = Math.max(1, it.r.w * k), h = Math.max(1, it.r.h * k);
      if (it.kind === 'frame') ctx.strokeRect(x, y, w, h); else ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = cs.getPropertyValue('--iln-accent');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(view.x * k + ox, view.y * k + oy, view.w * k, view.h * k);
  }, [objects, strokes, camera, size, doc]);

  const navigate = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const f = frame.current;
    if (!f) return;
    const r = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - r.left - f.ox) / f.k, wy = (e.clientY - r.top - f.oy) / f.k;
    const view = viewRect(camera, size.w, size.h);
    doc.setCamera({ ...camera, x: wx - view.w / 2, y: wy - view.h / 2 });
  };
  return (
    <canvas ref={ref} data-canvas-ui data-testid="minimap" title="Minimap — click or drag to navigate"
      className="absolute right-2 bottom-2 z-20 rounded-md border border-line bg-bg-1/90 shadow-lg backdrop-blur" style={{ width: W, height: H, cursor: 'pointer' }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); navigate(e); }}
      onPointerMove={(e) => { if (e.buttons) navigate(e); }} />
  );
}

export function SelectionBar({ doc, anchor, containerH }: { doc: CanvasDoc; anchor: { x: number; y: number }; containerH: number }) {
  const selection = useStore(doc.store, (s) => s.selection);
  const objects = useStore(doc.store, (s) => s.objects);
  const strokeSel = useStore(doc.store, (s) => s.strokeSelection);
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const objs = selection.map((id) => objects[id]).filter(Boolean);
  const locked = objs.some((o) => o.locked);
  const grouped = objs.some((o) => o.groupId);
  const shapes = objs.filter((o) => o.type === 'shape');
  const texts = objs.filter((o) => o.type === 'text');

  const doAlign = (k: AlignKind) => {
    const pos = align(objs.map((o) => doc.objectBounds(o)), k);
    void doc.updateObjects(objs.map((o, i) => { const b = doc.objectBounds(o); return { ...o, x: o.x + pos[i].x - b.x, y: o.y + pos[i].y - b.y }; }), `Align ${k}`);
  };
  const doDistribute = (axis: 'x' | 'y') => {
    const pos = distribute(objs.map((o) => doc.objectBounds(o)), axis);
    void doc.updateObjects(objs.map((o, i) => { const b = doc.objectBounds(o); return { ...o, x: o.x + pos[i].x - b.x, y: o.y + pos[i].y - b.y }; }), `Distribute ${axis === 'x' ? 'horizontally' : 'vertically'}`);
  };
  const setStroke = (c: string) => {
    if (strokeSel.length) void doc.commit('Recolor ink', { strokes: { put: strokeSel.map((id) => ({ ...doc.state.strokes[id], color: c })) } }, 'vector');
    if (shapes.length) void doc.patchObjects(shapes.map((o) => o.id), (o) => ({ data: { ...o.data, stroke: c } }), 'Stroke colour');
    if (texts.length) void doc.patchObjects(texts.map((o) => o.id), (o) => ({ data: { ...o.data, color: c } }), 'Text colour');
  };
  const setFill = (c: string) => void doc.patchObjects(shapes.map((o) => o.id), (o) => ({ data: { ...o.data, fill: c } }), 'Fill colour');

  const top = anchor.y - 76 < 4 ? Math.min(containerH - 44, anchor.y + 12) : anchor.y - 76;
  return (
    <div data-canvas-ui className="absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-bg-1/95 p-0.5 shadow-xl backdrop-blur" style={{ left: anchor.x, top }} data-testid="selection-bar">
      {(shapes.length > 0 || texts.length > 0 || strokeSel.length > 0) && (
        <button data-canvas-ui title="Colours" onClick={(e) => setColorAnchor(colorAnchor ? null : e.currentTarget)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-bg-3" data-testid="sel-colors">
          <span className="h-4 w-4 rounded-full border-2" style={{ borderColor: String(shapes[0]?.data.stroke ?? texts[0]?.data.color ?? doc.state.strokes[strokeSel[0]]?.color ?? '#888'), background: String(shapes[0]?.data.fill ?? 'transparent') }} />
        </button>
      )}
      {objs.length >= 2 && <>
        <ToolBtn title="Align left" onClick={() => doAlign('left')} testId="align-left"><AlignStartVertical size={15} /></ToolBtn>
        <ToolBtn title="Align centre" onClick={() => doAlign('hcenter')}><AlignCenterVertical size={15} /></ToolBtn>
        <ToolBtn title="Align right" onClick={() => doAlign('right')}><AlignEndVertical size={15} /></ToolBtn>
        <ToolBtn title="Align top" onClick={() => doAlign('top')}><AlignStartHorizontal size={15} /></ToolBtn>
        <ToolBtn title="Align middle" onClick={() => doAlign('vcenter')}><AlignCenterHorizontal size={15} /></ToolBtn>
        <ToolBtn title="Align bottom" onClick={() => doAlign('bottom')}><AlignEndHorizontal size={15} /></ToolBtn>
        {objs.length >= 3 && <>
          <ToolBtn title="Distribute horizontally" onClick={() => doDistribute('x')} testId="distribute-x"><AlignHorizontalSpaceAround size={15} /></ToolBtn>
          <ToolBtn title="Distribute vertically" onClick={() => doDistribute('y')}><AlignVerticalSpaceAround size={15} /></ToolBtn>
        </>}
        <div className="mx-0.5 h-5 w-px bg-line" />
      </>}
      {objs.length > 0 && <>
        <ToolBtn title="Bring to front (Mod+])" onClick={() => void reorder(doc, 'front')}><BringToFront size={15} /></ToolBtn>
        <ToolBtn title="Send to back (Mod+[)" onClick={() => void reorder(doc, 'back')}><SendToBack size={15} /></ToolBtn>
        {objs.length >= 2 && !grouped && <ToolBtn title="Group (Mod+G)" onClick={() => void group(doc)} testId="sel-group"><Group size={15} /></ToolBtn>}
        {grouped && <ToolBtn title="Ungroup (Mod+Shift+G)" onClick={() => void ungroup(doc)} testId="sel-ungroup"><Ungroup size={15} /></ToolBtn>}
        <ToolBtn title={locked ? 'Unlock (Mod+Shift+L)' : 'Lock (Mod+Shift+L)'} active={locked} onClick={() => void toggleLock(doc)} testId="sel-lock">{locked ? <Lock size={15} /> : <Unlock size={15} />}</ToolBtn>
      </>}
      <ToolBtn title="Duplicate (Mod+D)" onClick={() => void duplicateSelection(doc)} testId="sel-duplicate"><Copy size={15} /></ToolBtn>
      <ToolBtn title="Delete (Del)" onClick={() => void doc.deleteSelection()} testId="sel-delete"><Trash2 size={15} /></ToolBtn>
      {colorAnchor && (
        <Popover anchor={colorAnchor} onClose={() => setColorAnchor(null)}>
          <div data-canvas-ui className="flex w-56 flex-col gap-2 p-3">
            <div className="text-[11px] text-fg-faint">{shapes.length ? 'Stroke' : 'Colour'}</div>
            <ColorRow value={String(shapes[0]?.data.stroke ?? texts[0]?.data.color ?? '#888888')} onChange={setStroke} />
            {shapes.length > 0 && <><div className="text-[11px] text-fg-faint">Fill</div><ColorRow value={String(shapes[0]?.data.fill ?? 'transparent')} onChange={setFill} allowNone /></>}
          </div>
        </Popover>
      )}
    </div>
  );
}

/** World point at the centre of a container (used for "insert at centre"). */
export function centreWorld(doc: CanvasDoc, el: HTMLElement): { x: number; y: number } {
  return toWorld(doc.state.camera, { x: el.clientWidth / 2, y: el.clientHeight / 2 });
}
