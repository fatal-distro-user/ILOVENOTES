import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Shuffle } from 'lucide-react';
import { Modal, Button } from '@/ui/Modal';
import { toast } from '@/store/status';
import type { PaintDocument, RasterEdit } from '../engine/document';
import { FILTER_DEFAULTS, FILTER_LABELS, histogram, curveLut, type FilterId, type FilterParams } from './kernels';
import { runFilter } from './runner';

type AnyParams = Record<string, unknown>;

function NumberRow({ label, value, min, max, step = 1, onChange, suffix = '', testId }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; testId?: string }) {
  return (
    <label className="flex flex-col text-[11px] text-fg-muted">
      <span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-fg">{Math.round(value * 100) / 100}{suffix}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--iln-accent)]" data-testid={testId} />
    </label>
  );
}

function Histogram({ data, channel }: { data: ReturnType<typeof histogram>; channel: 'l' | 'r' | 'g' | 'b' }) {
  const bins = data[channel];
  const max = Math.max(1, ...Array.from(bins).slice(1, 255));
  const color = channel === 'r' ? '#ef4444' : channel === 'g' ? '#22c55e' : channel === 'b' ? '#3b82f6' : 'var(--iln-fg-faint)';
  const d = Array.from(bins).map((v, i) => `${i ? 'L' : 'M'}${i},${256 - Math.min(256, (v / max) * 256)}`).join(' ') + ' L255,256 L0,256 Z';
  return <path d={d} fill={color} opacity={0.35} />;
}

function CurvesEditor({ params, onChange, hist }: { params: FilterParams['curves']; onChange: (p: FilterParams['curves']) => void; hist: ReturnType<typeof histogram> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const lut = useMemo(() => curveLut(params.points), [params.points]);
  const toCurve = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(255, Math.round(((e.clientX - r.left) / r.width) * 255))), Math.max(0, Math.min(255, Math.round((1 - (e.clientY - r.top) / r.height) * 255)))];
  };
  const pts = [...params.points].sort((a, b) => a[0] - b[0]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        {(['rgb', 'r', 'g', 'b'] as const).map((c) => <button key={c} onClick={() => onChange({ ...params, channel: c })} className={clsx('rounded px-2 py-0.5 text-[11px] uppercase', params.channel === c ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3')}>{c}</button>)}
        <button className="ml-auto text-[11px] text-accent" onClick={() => onChange({ ...params, points: [[0, 0], [255, 255]] })}>Reset curve</button>
      </div>
      <svg ref={svg} viewBox="0 0 256 256" className="h-64 w-64 cursor-crosshair rounded border border-line bg-bg-2" data-testid="curves-editor"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const [x, y] = toCurve(e);
          const hit = pts.findIndex((p) => Math.abs(p[0] - x) < 8 && Math.abs(p[1] - y) < 8);
          if (hit >= 0) { setDrag(hit); return; }
          const next = [...pts, [x, y] as [number, number]].sort((a, b) => a[0] - b[0]);
          onChange({ ...params, points: next });
          setDrag(next.findIndex((p) => p[0] === x && p[1] === y));
        }}
        onPointerMove={(e) => { if (drag === null) return; const [x, y] = toCurve(e); const next = pts.map((p, i) => (i === drag ? [x, y] as [number, number] : p)); onChange({ ...params, points: next }); }}
        onPointerUp={(e) => {
          if (drag !== null) {
            const r = svg.current!.getBoundingClientRect();
            // Dragging a point out of the box removes it (endpoints stay).
            if ((e.clientY > r.bottom + 12 || e.clientY < r.top - 12) && pts.length > 2 && drag > 0 && drag < pts.length - 1) onChange({ ...params, points: pts.filter((_, i) => i !== drag) });
          }
          setDrag(null);
        }}>
        {[64, 128, 192].map((v) => <g key={v}><line x1={v} x2={v} y1={0} y2={256} stroke="var(--iln-line)" /><line y1={v} y2={v} x1={0} x2={256} stroke="var(--iln-line)" /></g>)}
        <Histogram data={hist} channel={params.channel === 'rgb' ? 'l' : params.channel} />
        <line x1={0} y1={256} x2={256} y2={0} stroke="var(--iln-fg-faint)" strokeDasharray="3 3" />
        <path d={Array.from(lut).map((v, i) => `${i ? 'L' : 'M'}${i},${255 - v}`).join(' ')} fill="none" stroke="var(--iln-accent)" strokeWidth={2} />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={255 - p[1]} r={4} fill="var(--iln-bg-1)" stroke="var(--iln-accent)" strokeWidth={2} />)}
      </svg>
      <div className="text-[10px] text-fg-faint">Click to add points · drag to adjust · drag out vertically to remove</div>
    </div>
  );
}

function LevelsEditor({ params, onChange, hist }: { params: FilterParams['levels']; onChange: (p: FilterParams['levels']) => void; hist: ReturnType<typeof histogram> }) {
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox="0 0 256 256" preserveAspectRatio="none" className="h-24 w-full rounded border border-line bg-bg-2"><Histogram data={hist} channel="l" />
        <line x1={params.inBlack} x2={params.inBlack} y1={0} y2={256} stroke="#000" strokeWidth={2} /><line x1={params.inWhite} x2={params.inWhite} y1={0} y2={256} stroke="#fff" strokeWidth={2} />
      </svg>
      <NumberRow label="Input black" value={params.inBlack} min={0} max={params.inWhite - 1} onChange={(v) => onChange({ ...params, inBlack: v })} testId="levels-inBlack" />
      <NumberRow label="Gamma" value={params.gamma} min={0.1} max={5} step={0.01} onChange={(v) => onChange({ ...params, gamma: v })} />
      <NumberRow label="Input white" value={params.inWhite} min={params.inBlack + 1} max={255} onChange={(v) => onChange({ ...params, inWhite: v })} />
      <NumberRow label="Output black" value={params.outBlack} min={0} max={255} onChange={(v) => onChange({ ...params, outBlack: v })} />
      <NumberRow label="Output white" value={params.outWhite} min={0} max={255} onChange={(v) => onChange({ ...params, outWhite: v })} />
    </div>
  );
}

function ColorBalanceEditor({ params, onChange }: { params: FilterParams['color-balance']; onChange: (p: FilterParams['color-balance']) => void }) {
  const [tone, setTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const v = params[tone];
  const set = (i: 0 | 1 | 2, n: number) => { const next = [...v] as [number, number, number]; next[i] = n; onChange({ ...params, [tone]: next }); };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">{(['shadows', 'midtones', 'highlights'] as const).map((t) => <button key={t} onClick={() => setTone(t)} className={clsx('rounded px-2 py-0.5 text-[11px] capitalize', tone === t ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3')}>{t}</button>)}</div>
      <NumberRow label="Cyan ↔ Red" value={v[0]} min={-100} max={100} onChange={(n) => set(0, n)} />
      <NumberRow label="Magenta ↔ Green" value={v[1]} min={-100} max={100} onChange={(n) => set(1, n)} />
      <NumberRow label="Yellow ↔ Blue" value={v[2]} min={-100} max={100} onChange={(n) => set(2, n)} />
    </div>
  );
}

/** Generic editor for the scalar-parameter filters. */
const RANGES: Record<string, [number, number, number?, string?]> = {
  hue: [-180, 180, 1, '°'], saturation: [-100, 100], lightness: [-100, 100], brightness: [-100, 100], contrast: [-100, 100],
  radius: [0, 80, 0.5, 'px'], distance: [1, 120, 1, 'px'], angle: [-180, 180, 1, '°'], size: [2, 128, 1, 'px'], amount: [0, 200, 1, '%'],
  cellSize: [2, 64, 1, 'px'], offset: [0, 40, 0.5, 'px'], level: [0, 255], seed: [1, 9999],
};

export function FilterDialog({ doc, filter, onClose }: { doc: PaintDocument; filter: FilterId; onClose: () => void }) {
  const [params, setParams] = useState<AnyParams>(() => structuredClone(FILTER_DEFAULTS[filter]) as AnyParams);
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const edit = useRef<RasterEdit | null>(null);
  const original = useRef<ImageData | null>(null);
  const reqId = useRef(0);
  const layer = doc.active;
  const hist = useMemo(() => {
    const c = layer?.canvas;
    const img = c?.getContext('2d')?.getImageData(0, 0, c.width, c.height);
    return histogram(img ? { width: img.width, height: img.height, data: img.data } : { width: 0, height: 0, data: new Uint8ClampedArray(0) });
  }, [layer]);

  useEffect(() => {
    const e = doc.beginEdit(undefined, 'color');
    if (!e) { toast('Select an unlocked raster layer to filter', 'error'); onClose(); return; }
    e.touchAll();
    edit.current = e;
    original.current = e.ctx.getImageData(0, 0, doc.width, doc.height);
    return () => { if (edit.current) { edit.current.revert(); edit.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const compute = async (p: AnyParams): Promise<Uint8ClampedArray | null> => {
    if (!original.current) return null;
    const mask = doc.selection?.data ?? null;
    return runFilter(filter, p, original.current, mask);
  };

  // Debounced live preview applied to the real layer (reverted on cancel).
  useEffect(() => {
    const e = edit.current;
    if (!e || !original.current) return;
    if (!preview) { e.ctx.putImageData(original.current, 0, 0); doc.invalidate(); return; }
    const id = ++reqId.current;
    const t = window.setTimeout(async () => {
      setBusy(true);
      const out = await compute(params);
      setBusy(false);
      if (!out || id !== reqId.current || !edit.current) return;
      edit.current.ctx.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height), 0, 0);
      doc.invalidate();
    }, 120);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, preview]);

  const apply = async () => {
    const e = edit.current;
    if (!e) return;
    setBusy(true);
    const out = await compute(params);
    setBusy(false);
    if (!out) return;
    e.ctx.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height), 0, 0);
    e.commit(FILTER_LABELS[filter], 'filter');
    edit.current = null;
    onClose();
  };

  const set = (p: AnyParams) => setParams(p);
  let body: React.ReactNode;
  if (filter === 'curves') body = <CurvesEditor params={params as FilterParams['curves']} onChange={set as never} hist={hist} />;
  else if (filter === 'levels') body = <LevelsEditor params={params as FilterParams['levels']} onChange={set as never} hist={hist} />;
  else if (filter === 'color-balance') body = <ColorBalanceEditor params={params as FilterParams['color-balance']} onChange={set as never} />;
  else body = (
    <div className="flex flex-col gap-2">
      {Object.entries(params).map(([k, v]) => {
        if (typeof v === 'boolean') return <label key={k} className="flex items-center gap-2 text-[12px] text-fg-muted"><input type="checkbox" checked={v} onChange={(e) => set({ ...params, [k]: e.target.checked })} />{k === 'mono' ? 'Monochrome' : k}</label>;
        if (typeof v !== 'number') return null;
        const [min, max, step, suffix] = RANGES[k] ?? [-100, 100];
        return <div key={k} className="flex items-end gap-1"><div className="flex-1"><NumberRow label={k[0].toUpperCase() + k.slice(1)} value={v} min={min} max={max} step={step} suffix={suffix} onChange={(n) => set({ ...params, [k]: n })} testId={`filter-${k}`} /></div>
          {k === 'seed' && <button title="New random seed" className="mb-0.5 rounded p-1 hover:bg-bg-3" onClick={() => set({ ...params, seed: Math.floor(Math.random() * 9999) + 1 })}><Shuffle size={13} /></button>}</div>;
      })}
      {filter === 'invert' && <div className="text-fg-muted">Inverts the colours of the layer{doc.selection ? ' inside the selection' : ''}.</div>}
    </div>
  );

  return (
    <Modal title={FILTER_LABELS[filter]} onClose={onClose} width={filter === 'curves' ? 320 : 360} testId="filter-dialog"
      footer={<>
        <label className="mr-auto flex items-center gap-1.5 text-[12px] text-fg-muted"><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />Preview{busy && <span className="text-fg-faint">…</span>}</label>
        <Button onClick={() => setParams(structuredClone(FILTER_DEFAULTS[filter]) as AnyParams)}>Reset</Button>
        <Button onClick={onClose} data-testid="filter-cancel">Cancel</Button>
        <Button variant="primary" onClick={() => void apply()} disabled={busy} data-testid="filter-apply">Apply</Button>
      </>}>
      <div className="flex flex-col gap-2">
        {doc.selection && <div className="rounded bg-accent/15 px-2 py-1 text-[11px] text-fg-muted">Limited to the current selection</div>}
        {body}
      </div>
    </Modal>
  );
}
