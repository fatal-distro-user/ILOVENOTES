import { useEffect, useReducer, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Eye, EyeOff, Lock, Unlock, Plus, Trash2, Copy, ChevronDown, ChevronRight, Folder, Type, Shapes, SlidersHorizontal, Image as ImageIcon,
  Layers3, ArrowDownToLine, Combine, Square, CornerDownRight, Grid2x2Check, Target, MoreHorizontal,
} from 'lucide-react';
import type { BlendMode } from '@/db/types';
import { BLEND_MODES, type LayerRT, type PaintDocument } from '../engine/document';
import { FILTER_DEFAULTS, FILTER_LABELS, type FilterId } from '../filters/kernels';
import { usePaintStudio } from './store';
import { Popover } from '@/ui/Popover';
import { promptDialog } from '@/ui/dialogs';

export function useDocVersion(doc: PaintDocument | null): number {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => doc?.subscribe(bump), [doc]);
  return doc?.version ?? 0;
}

function Thumb({ layer, doc, mask }: { layer: LayerRT; doc: PaintDocument; mask?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = doc.version;
  useEffect(() => {
    const c = ref.current;
    const src = mask ? layer.mask : layer.canvas;
    if (!c || !src) return;
    const id = window.setTimeout(() => {
      const g = c.getContext('2d');
      if (!g) return;
      const k = Math.min(c.width / doc.width, c.height / doc.height);
      g.clearRect(0, 0, c.width, c.height);
      if (mask) { g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(src, (c.width - doc.width * k) / 2, (c.height - doc.height * k) / 2, doc.width * k, doc.height * k);
    }, 120);
    return () => window.clearTimeout(id);
  }, [version, layer, doc, mask]);
  return <canvas ref={ref} width={40} height={30} className="h-[30px] w-10 shrink-0 rounded-sm border border-line bg-[conic-gradient(#ccc_25%,#fff_0_50%,#ccc_0_75%,#fff_0)] bg-[length:8px_8px]" />;
}

const KIND_ICON = { raster: ImageIcon, vector: Shapes, text: Type, adjustment: SlidersHorizontal, group: Folder } as const;

export function LayersPanel() {
  const doc = usePaintStudio((s) => s.doc);
  useDocVersion(doc);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null; pos: 'above' | 'below' | 'into' } | null>(null);
  if (!doc) return <div className="p-3 text-fg-faint">Open a painting to edit its layers.</div>;
  const list = doc.displayList();
  const active = doc.active;

  const drop = () => {
    if (!drag?.over || drag.over === drag.id) { setDrag(null); return; }
    const target = doc.layer(drag.over);
    if (!target) { setDrag(null); return; }
    if (drag.pos === 'into' && target.meta.kind === 'group') doc.moveLayer(drag.id, target.meta.id, doc.children(target.meta.id).length);
    else {
      const siblings = doc.children(target.meta.parentId).filter((s) => s.meta.id !== drag.id);
      const idx = siblings.findIndex((s) => s.meta.id === target.meta.id);
      // Display is top→bottom; "above" in the list means higher order.
      doc.moveLayer(drag.id, target.meta.parentId, drag.pos === 'above' ? idx + 1 : idx);
    }
    setDrag(null);
  };

  return (
    <div className="flex flex-col" data-testid="layers-panel">
      {active && (
        <div className="flex flex-col gap-1 border-b border-line px-2 py-1.5">
          <div className="flex items-center gap-1">
            <select value={active.meta.blend} onChange={(e) => doc.setLayerProps(active.meta.id, { blend: e.target.value as BlendMode }, 'Blend mode')}
              className="min-w-0 flex-1 rounded border border-line bg-bg-2 px-1 py-0.5 text-[12px]" data-testid="layer-blend" title="Blend mode">
              {BLEND_MODES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
            <input type="range" min={0} max={100} value={Math.round(active.meta.opacity * 100)} title="Opacity" data-testid="layer-opacity"
              onChange={(e) => doc.setLayerProps(active.meta.id, { opacity: Number(e.target.value) / 100 }, 'Opacity')} className="w-20 accent-[var(--iln-accent)]" />
            <span className="w-8 text-right text-[11px] tabular-nums text-fg-muted">{Math.round(active.meta.opacity * 100)}%</span>
          </div>
          <div className="flex items-center gap-0.5">
            <Toggle on={active.meta.alphaLock} title="Alpha lock (paint only on existing pixels)" onClick={() => doc.setLayerProps(active.meta.id, { alphaLock: !active.meta.alphaLock }, 'Alpha lock')} testId="layer-alphalock"><Grid2x2Check size={13} /></Toggle>
            <Toggle on={active.meta.clip} title="Clipping mask (clip to layer below)" onClick={() => doc.setLayerProps(active.meta.id, { clip: !active.meta.clip }, 'Clipping mask')} testId="layer-clip"><CornerDownRight size={13} /></Toggle>
            <Toggle on={active.meta.isReference} title="Reference layer (fill & wand sample this layer)" onClick={() => doc.setLayerProps(active.meta.id, { isReference: !active.meta.isReference }, 'Reference layer')} testId="layer-reference"><Target size={13} /></Toggle>
            <Toggle on={active.meta.hasMask} title={active.meta.hasMask ? 'Delete layer mask' : 'Add layer mask (from selection if any)'} onClick={() => (active.meta.hasMask ? doc.removeMask(active.meta.id) : doc.addMask(active.meta.id, !!doc.selection))} testId="layer-mask"><Square size={13} /></Toggle>
            <div className="flex-1" />
            {active.meta.kind === 'adjustment' && <AdjustmentEditor doc={doc} layer={active} />}
          </div>
        </div>
      )}
      <div className="max-h-[420px] min-h-[80px] overflow-y-auto py-0.5" onDragOver={(e) => e.preventDefault()} onDrop={drop}>
        {list.map(({ layer, depth }) => {
          const m = layer.meta;
          const Icon = KIND_ICON[m.kind];
          const isActive = active?.meta.id === m.id;
          const dropHere = drag?.over === m.id;
          return (
            <div key={m.id} draggable data-testid="layer-row" data-layer-id={m.id}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ id: m.id, over: null, pos: 'above' }); }}
              onDragOver={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const f = (e.clientY - r.top) / r.height;
                setDrag((d) => d && { ...d, over: m.id, pos: m.kind === 'group' && f > 0.3 && f < 0.7 ? 'into' : f < 0.5 ? 'above' : 'below' });
              }}
              onDragEnd={() => setDrag(null)}
              onClick={() => { if (m.kind !== 'group') doc.setActive(m.id); else doc.setLayerProps(m.id, { data: { ...m.data, collapsed: !m.data.collapsed } }, m.data.collapsed ? 'Expand group' : 'Collapse group'); }}
              onDoubleClick={async () => { const n = await promptDialog('Layer name', m.name); if (n?.trim()) doc.setLayerProps(m.id, { name: n.trim() }, 'Rename layer'); }}
              className={clsx('group relative flex cursor-default items-center gap-1.5 py-1 pr-1.5', isActive ? 'bg-accent/20' : 'hover:bg-bg-3',
                dropHere && drag?.pos === 'above' && 'shadow-[inset_0_2px_0_var(--iln-accent)]', dropHere && drag?.pos === 'below' && 'shadow-[inset_0_-2px_0_var(--iln-accent)]',
                dropHere && drag?.pos === 'into' && 'ring-1 ring-accent ring-inset')}
              style={{ paddingLeft: 6 + depth * 14 }}>
              <button className="text-fg-muted hover:text-fg" title={m.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); doc.setLayerProps(m.id, { visible: !m.visible }, m.visible ? 'Hide layer' : 'Show layer'); }} data-testid="layer-visibility">
                {m.visible ? <Eye size={13} /> : <EyeOff size={13} className="text-fg-faint" />}
              </button>
              {m.clip && <CornerDownRight size={11} className="text-fg-faint" />}
              {m.kind === 'group'
                ? <span className="text-fg-muted">{m.data.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</span>
                : m.kind === 'raster' ? <Thumb layer={layer} doc={doc} /> : <span className="flex h-[30px] w-10 items-center justify-center rounded-sm border border-line bg-bg-2"><Icon size={14} className="text-fg-muted" /></span>}
              {layer.mask && (
                <button title="Edit mask (click) / layer (click thumbnail)" onClick={(e) => { e.stopPropagation(); doc.setActive(m.id); doc.editChannel = 'mask'; doc.invalidate(); }}
                  className={clsx('rounded-sm', isActive && doc.editChannel === 'mask' && 'ring-2 ring-accent', !m.maskEnabled && 'opacity-40')}>
                  <Thumb layer={layer} doc={doc} mask />
                </button>
              )}
              <span className={clsx('min-w-0 flex-1 truncate', !m.visible && 'text-fg-faint')} title={m.name}>{m.name}</span>
              <span className="text-[10px] text-fg-faint">{m.blend !== 'normal' ? BLEND_MODES.find((b) => b.id === m.blend)?.label : ''}{m.opacity < 1 ? ` ${Math.round(m.opacity * 100)}%` : ''}</span>
              {m.alphaLock && <Grid2x2Check size={11} className="text-fg-faint" />}
              {m.isReference && <Target size={11} className="text-fg-faint" />}
              <button className={clsx('text-fg-faint hover:text-fg', !m.locked && 'opacity-0 group-hover:opacity-100')} title={m.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); doc.setLayerProps(m.id, { locked: !m.locked }, m.locked ? 'Unlock layer' : 'Lock layer'); }} data-testid="layer-lock">
                {m.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-0.5 border-t border-line px-1.5 py-1">
        <button className="flex h-7 items-center gap-1 rounded px-1.5 hover:bg-bg-3" onClick={(e) => setAddAnchor(e.currentTarget)} title="Add layer" data-testid="layer-add"><Plus size={14} />Add</button>
        <button className="flex h-7 w-7 items-center justify-center rounded hover:bg-bg-3" title="Duplicate layer" disabled={!active} onClick={() => active && doc.duplicateLayer(active.meta.id)} data-testid="layer-duplicate"><Copy size={13} /></button>
        <button className="flex h-7 w-7 items-center justify-center rounded hover:bg-bg-3" title="Merge down" disabled={!active} onClick={() => active && doc.mergeDown(active.meta.id)} data-testid="layer-merge-down"><ArrowDownToLine size={13} /></button>
        <button className="flex h-7 w-7 items-center justify-center rounded hover:bg-bg-3 hover:text-danger" title="Delete layer" disabled={!active} onClick={() => active && doc.deleteLayer(active.meta.id)} data-testid="layer-delete"><Trash2 size={13} /></button>
        <div className="flex-1" />
        <button className="flex h-7 w-7 items-center justify-center rounded hover:bg-bg-3" title="More" onClick={(e) => setMoreAnchor(e.currentTarget)} data-testid="layer-more"><MoreHorizontal size={14} /></button>
      </div>
      {addAnchor && (
        <Popover anchor={addAnchor} onClose={() => setAddAnchor(null)} side="top">
          <div className="flex w-52 flex-col p-1">
            {([['raster', 'Raster layer', ImageIcon], ['vector', 'Vector layer', Shapes], ['text', 'Text layer', Type], ['group', 'Group', Folder]] as const).map(([k, label, I]) => (
              <button key={k} className="flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-bg-3" data-testid={`layer-add-${k}`} onClick={() => { doc.addLayer(k); setAddAnchor(null); }}><I size={13} />{label}</button>
            ))}
            <div className="my-1 h-px bg-line" />
            <div className="px-2 pb-0.5 text-[10px] font-semibold text-fg-faint uppercase">Adjustment layer</div>
            {(['hsl', 'brightness-contrast', 'curves', 'levels', 'color-balance', 'threshold', 'invert', 'gaussian-blur'] as FilterId[]).map((f) => (
              <button key={f} className="flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-bg-3" data-testid={`layer-add-adj-${f}`}
                onClick={() => { doc.addLayer('adjustment', { name: FILTER_LABELS[f], data: { filter: f, params: structuredClone(FILTER_DEFAULTS[f]) } }); setAddAnchor(null); }}>
                <SlidersHorizontal size={13} />{FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {moreAnchor && (
        <Popover anchor={moreAnchor} onClose={() => setMoreAnchor(null)} side="top" align="end">
          <div className="flex w-48 flex-col p-1">
            <MenuBtn onClick={() => { doc.mergeVisible(); setMoreAnchor(null); }} icon={<Combine size={13} />} testId="layer-merge-visible">Merge visible</MenuBtn>
            <MenuBtn onClick={() => { doc.flatten(); setMoreAnchor(null); }} icon={<Layers3 size={13} />} testId="layer-flatten">Flatten image</MenuBtn>
            {active?.mask && <MenuBtn onClick={() => { doc.removeMask(active.meta.id, true); setMoreAnchor(null); }} icon={<Square size={13} />}>Apply layer mask</MenuBtn>}
            {active?.mask && <MenuBtn onClick={() => { doc.setLayerProps(active.meta.id, { maskEnabled: !active.meta.maskEnabled }, 'Toggle mask'); setMoreAnchor(null); }} icon={<Square size={13} />}>{active.meta.maskEnabled ? 'Disable' : 'Enable'} mask</MenuBtn>}
            {active?.mask && <MenuBtn onClick={() => { doc.editChannel = doc.editChannel === 'mask' ? 'color' : 'mask'; doc.invalidate(); setMoreAnchor(null); }} icon={<Square size={13} />}>Paint on {doc.editChannel === 'mask' ? 'layer pixels' : 'mask'}</MenuBtn>}
          </div>
        </Popover>
      )}
    </div>
  );
}

function Toggle({ on, title, onClick, children, testId }: { on: boolean; title: string; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return <button title={title} onClick={onClick} data-testid={testId} className={clsx('flex h-6 w-6 items-center justify-center rounded', on ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3')}>{children}</button>;
}
function MenuBtn({ onClick, icon, children, testId }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return <button className="flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-bg-3" onClick={onClick} data-testid={testId}>{icon}{children}</button>;
}

/** Simple numeric editor for adjustment layer parameters (sliders for scalar params). */
function AdjustmentEditor({ doc, layer }: { doc: PaintDocument; layer: LayerRT }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const params = (layer.meta.data.params ?? {}) as Record<string, unknown>;
  const RANGES: Record<string, [number, number, number?]> = {
    hue: [-180, 180], saturation: [-100, 100], lightness: [-100, 100], brightness: [-100, 100], contrast: [-100, 100],
    inBlack: [0, 254], inWhite: [1, 255], gamma: [0.1, 5, 0.05], outBlack: [0, 255], outWhite: [0, 255], level: [0, 255], radius: [0, 60, 0.5],
  };
  return (
    <>
      <button className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-fg-muted hover:bg-bg-3" onClick={(e) => setAnchor(e.currentTarget)} data-testid="adjust-edit"><SlidersHorizontal size={12} />Adjust</button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="flex w-60 flex-col gap-1.5 p-3">
            {Object.entries(params).filter(([, v]) => typeof v === 'number').map(([k, v]) => {
              const [min, max, step] = RANGES[k] ?? [-100, 100];
              return (
                <label key={k} className="flex flex-col text-[11px] text-fg-muted">
                  <span className="flex justify-between"><span className="capitalize">{k}</span><span className="tabular-nums">{Number(v).toFixed(step && step < 1 ? 2 : 0)}</span></span>
                  <input type="range" min={min} max={max} step={step ?? 1} value={Number(v)} className="accent-[var(--iln-accent)]"
                    onChange={(e) => doc.setLayerProps(layer.meta.id, { data: { ...layer.meta.data, params: { ...params, [k]: Number(e.target.value) } } }, `Adjust ${k}`)} />
                </label>
              );
            })}
            {Object.values(params).every((v) => typeof v !== 'number') && <div className="text-fg-faint">This adjustment has no numeric parameters.</div>}
          </div>
        </Popover>
      )}
    </>
  );
}
