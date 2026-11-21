import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Save, RotateCcw, Trash2, CopyPlus, Download, Upload } from 'lucide-react';
import type { BrushParams } from './types';
import { useBrushes, allPresets, resolvePreset, type BrushToolId } from './store';
import { renderBrushPreview } from './preview';
import { usePaintStudio } from '../studio/store';
import { promptDialog, confirmDialog } from '@/ui/dialogs';
import { saveFile, openFile } from '@/platform/fileio';
import { toast } from '@/store/status';
import { db } from '@/db/schema';
import { nanoid } from 'nanoid';

const toolForMode = (m: BrushParams['mode']): BrushToolId => (m === 'paint' ? 'brush' : m === 'erase' ? 'eraser' : m);

function Preview({ brush, color, w = 220, h = 44 }: { brush: BrushParams; color: string; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(brush) + color;
  useEffect(() => { if (ref.current) renderBrushPreview(ref.current, brush, color); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} width={w * 2} height={h * 2} style={{ width: w, height: h }} className="rounded bg-white" />;
}

const SLIDERS: { key: keyof BrushParams; label: string; min: number; max: number; step?: number; pct?: boolean }[] = [
  { key: 'size', label: 'Size', min: 1, max: 500 },
  { key: 'minSize', label: 'Min size (pressure)', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'opacity', label: 'Opacity', min: 0.01, max: 1, step: 0.01, pct: true },
  { key: 'flow', label: 'Flow', min: 0.01, max: 1, step: 0.01, pct: true },
  { key: 'spacing', label: 'Spacing', min: 0.01, max: 2, step: 0.01, pct: true },
  { key: 'hardness', label: 'Hardness', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'angle', label: 'Angle', min: -180, max: 180 },
  { key: 'roundness', label: 'Roundness', min: 0.05, max: 1, step: 0.01, pct: true },
  { key: 'scatter', label: 'Scatter', min: 0, max: 2, step: 0.01, pct: true },
  { key: 'sizeJitter', label: 'Size jitter', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'opacityJitter', label: 'Opacity jitter', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'angleJitter', label: 'Angle jitter', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'taperStart', label: 'Taper start (px)', min: 0, max: 300 },
  { key: 'taperEnd', label: 'Taper end (px)', min: 0, max: 300 },
  { key: 'grain', label: 'Texture grain', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'grainScale', label: 'Grain scale', min: 0.3, max: 4, step: 0.05 },
  { key: 'pressureSize', label: 'Pressure → size', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'pressureOpacity', label: 'Pressure → opacity', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'tiltShading', label: 'Tilt shading', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'velocitySize', label: 'Velocity thinning', min: -1, max: 1, step: 0.01, pct: true },
  { key: 'wetness', label: 'Wetness (colour mixing)', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'bristles', label: 'Bristles', min: 0, max: 64 },
  { key: 'streamline', label: 'Default StreamLine', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'strength', label: 'Retouch strength', min: 0, max: 1, step: 0.01, pct: true },
];

export function BrushStudioPanel() {
  const b = useBrushes();
  const studio = usePaintStudio();
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { void b.loadCustom(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const presets = allPresets();
  const tool = (['brush', 'eraser', 'smudge', 'blur', 'sharpen', 'clone', 'heal'] as BrushToolId[]).includes(studio.tool as BrushToolId) ? (studio.tool as BrushToolId) : 'brush';
  const selectedId = editing ?? b.presetByTool[tool];
  const selected = resolvePreset(selectedId);
  const isCustom = b.custom.some((c) => c.id === selectedId);
  const dirty = !!b.edits[selectedId] && Object.keys(b.edits[selectedId]).length > 0;
  const cats = Array.from(new Set(presets.map((p) => p.category)));

  const pick = (p: BrushParams) => {
    const t = toolForMode(p.mode);
    b.setPreset(t, p.id);
    studio.setTool(t);
    if (t === 'brush' || t === 'eraser') studio.set({ size: p.size });
    setEditing(p.id);
  };

  const exportPreset = async () => {
    const data = JSON.stringify({ format: 'ilovenotes-brush', version: 1, brush: selected }, null, 2);
    await saveFile(data, `${selected.name.replace(/[^\w-]+/g, '_')}.brush.json`, [{ name: 'Brush preset', extensions: ['json'] }]);
  };
  const importPreset = async () => {
    const f = await openFile({ filters: [{ name: 'Brush preset', extensions: ['json'] }] });
    if (!f) return;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(f.data)) as { format?: string; brush?: BrushParams };
      if (parsed.format !== 'ilovenotes-brush' || !parsed.brush) throw new Error('Not an ILOVENOTES brush file');
      const id = nanoid();
      await db.brushes.put({ id, name: parsed.brush.name, builtin: false, params: { ...parsed.brush, id, category: 'custom' } as unknown as Record<string, unknown>, order: Date.now() });
      await b.loadCustom();
      toast(`Imported brush “${parsed.brush.name}”`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'Import failed', 'error'); }
  };

  return (
    <div className="flex flex-col" data-testid="brush-studio">
      <div className="max-h-[300px] overflow-y-auto py-1">
        {cats.map((cat) => (
          <div key={cat}>
            <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-fg-faint uppercase">{cat}</div>
            {presets.filter((p) => p.category === cat).map((p) => (
              <button key={p.id} onClick={() => pick(p)} data-testid="brush-preset" data-preset={p.id}
                className={clsx('flex w-full flex-col items-start gap-0.5 px-2.5 py-1 text-left', selectedId === p.id ? 'bg-accent/20' : 'hover:bg-bg-3')}>
                <span className="text-[12px]">{p.name}{b.edits[p.id] ? ' •' : ''}</span>
                <Preview brush={resolvePreset(p.id)} color={studio.color} />
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-2">
        <div className="mb-1 flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate font-semibold">{selected.name}</span>
          <button title="Save as new preset" className="rounded p-1 hover:bg-bg-3" data-testid="brush-save-new" onClick={async () => { const n = await promptDialog('Preset name', `${selected.name} copy`); if (n?.trim()) { const id = await b.saveAsNew(selectedId, n.trim()); b.setPreset(toolForMode(selected.mode), id); setEditing(id); toast('Preset saved', 'ok'); } }}><CopyPlus size={13} /></button>
          {isCustom && <button title="Save changes" disabled={!dirty} className="rounded p-1 hover:bg-bg-3" onClick={() => void b.saveOver(selectedId)}><Save size={13} /></button>}
          <button title="Reset changes" disabled={!dirty} className="rounded p-1 hover:bg-bg-3" onClick={() => b.resetEdits(selectedId)}><RotateCcw size={13} /></button>
          <button title="Export preset" className="rounded p-1 hover:bg-bg-3" onClick={() => void exportPreset()}><Download size={13} /></button>
          <button title="Import preset" className="rounded p-1 hover:bg-bg-3" onClick={() => void importPreset()}><Upload size={13} /></button>
          {isCustom && <button title="Delete preset" className="rounded p-1 hover:bg-bg-3 hover:text-danger" onClick={async () => { if (await confirmDialog(`Delete brush “${selected.name}”?`, { danger: true })) { await b.deleteCustom(selectedId); setEditing(null); } }}><Trash2 size={13} /></button>}
        </div>
        <Preview brush={selected} color={studio.color} w={248} h={60} />
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
          <label className="flex flex-col text-fg-muted">Tip
            <select value={selected.tip} onChange={(e) => b.edit(selectedId, { tip: e.target.value as BrushParams['tip'] })} className="rounded border border-line bg-bg-2 px-1 py-0.5 text-fg">
              {['round', 'chisel', 'square', 'pencil', 'charcoal', 'bristle', 'spray', 'pixel'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-fg-muted">Angle follows
            <select value={selected.angleMode} onChange={(e) => b.edit(selectedId, { angleMode: e.target.value as BrushParams['angleMode'] })} className="rounded border border-line bg-bg-2 px-1 py-0.5 text-fg">
              <option value="fixed">fixed</option><option value="direction">stroke direction</option><option value="tilt">pen tilt</option>
            </select>
          </label>
          <label className="flex flex-col text-fg-muted">Blend
            <select value={selected.blend} onChange={(e) => b.edit(selectedId, { blend: e.target.value as BrushParams['blend'] })} className="rounded border border-line bg-bg-2 px-1 py-0.5 text-fg">
              {['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'soft-light', 'hard-light'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-fg-muted">Dither
            <select value={selected.dither} onChange={(e) => b.edit(selectedId, { dither: e.target.value as BrushParams['dither'] })} className="rounded border border-line bg-bg-2 px-1 py-0.5 text-fg">
              {['none', 'bayer2', 'bayer4', 'checker', 'lines'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-muted"><input type="checkbox" checked={selected.pixelPerfect} onChange={(e) => b.edit(selectedId, { pixelPerfect: e.target.checked })} />Pixel-perfect (grid-snapped, no anti-aliasing)</label>
        <div className="mt-2 flex flex-col gap-1">
          {SLIDERS.map((s) => {
            const v = Number(selected[s.key] ?? 0);
            return (
              <label key={s.key} className="flex flex-col text-[11px] text-fg-muted">
                <span className="flex justify-between"><span>{s.label}</span><span className="tabular-nums text-fg">{s.pct ? `${Math.round(v * 100)}%` : Math.round(v * 10) / 10}</span></span>
                <input type="range" min={s.min} max={s.max} step={s.step ?? 1} value={v} data-testid={`brush-param-${s.key}`}
                  onChange={(e) => b.edit(selectedId, { [s.key]: Number(e.target.value) } as Partial<BrushParams>)} className="accent-[var(--iln-accent)]" />
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
