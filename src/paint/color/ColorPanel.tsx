import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeftRight, Plus, FolderDown, FolderUp, Pencil, Trash2, ImagePlus, RotateCcw, X } from 'lucide-react';
import { db } from '@/db/schema';
import type { Palette } from '@/db/types';
import { Segmented } from '@/ui/Segmented';
import { Slider } from '@/ui/Slider';
import { toast } from '@/store/status';
import { usePaintStudio } from '../studio/store';
import {
  rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb, rgbToCmyk, cmykToRgb, rgbToHex, parseHex, harmony, type HSV, type RGB,
} from './colorMath';
import { Picker } from './Picker';
import { useColor, useColorUi, commitColor, type InputMode } from './store';
import { HARMONY_OPTIONS, reorder, removeAt } from './palette';
import { imagePixels, extractColors } from './extract';
import {
  seedDefaultPalette, createPalette, renamePalette, deletePalette, setPaletteColors, addToActivePalette, importPaletteFile,
  importPaletteDialog, exportPalette, pickImageForExtraction,
} from './paletteActions';

const CHECKER = 'conic-gradient(#bbb 25%, #fff 0 50%, #bbb 0 75%, #fff 0) 0 0 / 10px 10px';
const PICKER_SIZE = 216;

const iconBtn = 'inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-3 hover:text-fg disabled:opacity-40';
const sectionTitle = 'mb-1.5 flex items-center justify-between text-[10.5px] font-semibold tracking-wider text-fg-faint uppercase';

const safeRgb = (hex: string): RGB => parseHex(hex) ?? { r: 0, g: 0, b: 0 };

function Section({ title, actions, children, testId }: { title: string; actions?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="border-t border-line px-3 py-2.5" data-testid={testId}>
      <div className={sectionTitle}><span>{title}</span><span className="flex items-center gap-0.5 normal-case">{actions}</span></div>
      {children}
    </section>
  );
}

function Swatch({ color, className, ...rest }: { color: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} style={{ background: color }} className={clsx('h-5 w-5 rounded-[3px] border border-black/25 transition-transform hover:z-10 hover:scale-110', className)} />;
}

function AlphaBar({ hex, alpha, onChange, onCommit }: { hex: string; alpha: number; onChange(a: number): void; onCommit(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100) / 100);
  };
  const { r, g, b } = safeRgb(hex);
  return (
    <div ref={ref} data-testid="color-alpha" role="slider" aria-label="Alpha" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(alpha * 100)} tabIndex={0}
      className="relative h-4 w-full cursor-ew-resize rounded border border-line touch-none" style={{ background: CHECKER }}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { onChange(Math.max(0, Math.min(1, alpha + (e.key === 'ArrowRight' ? 0.01 : -0.01)))); } }}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={(e) => dragging.current && at(e)}
      onPointerUp={() => { if (dragging.current) { dragging.current = false; onCommit(); } }}>
      <div className="absolute inset-0 rounded" style={{ background: `linear-gradient(90deg, rgba(${r},${g},${b},0), rgb(${r},${g},${b}))` }} />
      <div className="pointer-events-none absolute top-[-2px] h-5 w-2 -translate-x-1/2 rounded-sm border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style={{ left: `${alpha * 100}%` }} />
    </div>
  );
}

function NumField({ label, value, max, onCommit, testId }: { label: string; value: number; max: number; onCommit(v: number): void; testId: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.trim());
    setDraft(null);
    if (draft.trim() === '' || !Number.isFinite(n)) return;
    const v = Math.max(0, Math.min(max, Math.round(n)));
    if (v !== value) onCommit(v);
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-[10px] text-fg-faint">
      <input data-testid={testId} inputMode="numeric" value={draft ?? String(value)} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
        className="h-6 w-full min-w-0 rounded border border-line bg-bg-2 px-1 text-center text-[11.5px] text-fg tabular-nums outline-none focus:border-[var(--iln-accent)]" />
      {label}
    </label>
  );
}

const INPUT_TABS: { value: InputMode; label: string }[] = [
  { value: 'hex', label: 'HEX' }, { value: 'rgb', label: 'RGB' }, { value: 'hsl', label: 'HSL' }, { value: 'hsv', label: 'HSV' }, { value: 'cmyk', label: 'CMYK' },
];

/** Extraction preview shown after choosing/dropping an image. */
function ExtractPanel({ source, name, onClose }: { source: Blob; name: string; onClose(): void }) {
  const count = useColor((s) => s.extractCount);
  const [pixels, setPixels] = useState<Uint8ClampedArray | null>(null);
  useEffect(() => {
    let live = true;
    imagePixels(source).then((d) => live && setPixels(d), () => { toast('Could not decode that image', 'error'); onClose(); });
    return () => { live = false; };
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps
  const colors = useMemo(() => (pixels ? extractColors(pixels, count) : []), [pixels, count]);
  return (
    <div className="mt-2 rounded-md border border-line bg-bg-2 p-2" data-testid="extract-panel">
      <div className="mb-1 flex items-center justify-between text-[11px] text-fg-muted"><span className="truncate">From {name || 'image'}</span><button className={iconBtn} onClick={onClose} title="Close" data-testid="extract-close"><X size={13} /></button></div>
      <Slider label="Colours" min={4} max={16} value={count} onChange={(v) => useColor.getState().set({ extractCount: v })} className="text-[11px]" />
      <div className="my-1.5 flex min-h-5 flex-wrap gap-1" data-testid="extract-preview">
        {pixels ? colors.map((c) => <Swatch key={c} color={c} title={c} data-testid="extract-swatch" onClick={() => commitColor(c)} />) : <span className="text-[11px] text-fg-faint">Analysing…</span>}
      </div>
      <button disabled={!colors.length} data-testid="extract-save" onClick={async () => { const p = await createPalette(colors, name.replace(/\.[^.]+$/, '') || 'Extracted'); if (p) { toast(`Saved "${p.name}"`, 'ok'); onClose(); } }}
        className="h-6 rounded bg-accent px-2 text-[11.5px] text-accent-fg disabled:opacity-40">Save as palette</button>
    </div>
  );
}

export function ColorPanel() {
  const color = usePaintStudio((s) => s.color);
  const secondary = usePaintStudio((s) => s.secondary);
  const alpha = usePaintStudio((s) => s.alpha);
  const { history, harmony: hKind, pickerMode, inputMode, activePaletteId } = useColor();
  const extractSource = useColorUi((s) => s.extractSource);
  const extractName = useColorUi((s) => s.extractName);
  const [target, setTarget] = useState<'primary' | 'secondary'>('primary');
  const hex = target === 'primary' ? color : secondary;
  const rgb = safeRgb(hex);

  const [hsv, setHsvState] = useState<HSV>(() => rgbToHsv(rgb));
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  useEffect(() => {
    if (rgbToHex(hsvToRgb(hsvRef.current)) !== hex) setHsvState(rgbToHsv(safeRgb(hex)));
  }, [hex]);

  const write = useCallback((h: string) => usePaintStudio.getState().set(target === 'primary' ? { color: h } : { secondary: h }), [target]);
  const onPick = useCallback((n: HSV) => { setHsvState(n); write(rgbToHex(hsvToRgb(n))); }, [write]);
  const onPickCommit = useCallback(() => useColor.getState().push(rgbToHex(hsvToRgb(hsvRef.current))), []);
  /** Apply an RGB edit from a numeric field: keeps hue when the colour is achromatic. */
  const applyRgb = (n: RGB, hue?: number) => {
    const next = rgbToHsv(n);
    if ((next.s === 0 || next.v === 0)) next.h = hue ?? hsvRef.current.h;
    setHsvState(next);
    const h = rgbToHex(n);
    write(h);
    useColor.getState().push(h);
  };
  const useHex = (h: string, e?: { shiftKey: boolean; altKey: boolean }) => {
    const sec = !!e && (e.shiftKey || e.altKey);
    if (sec) commitColor(h, true); else { if (target === 'secondary') usePaintStudio.getState().set({ secondary: h }); else usePaintStudio.getState().set({ color: h }); useColor.getState().push(h); }
  };

  // ── hex field
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const hexShown = target === 'primary' && alpha < 1 ? hex + Math.round(alpha * 255).toString(16).padStart(2, '0') : hex;
  const commitHex = () => {
    if (hexDraft === null) return;
    const raw = hexDraft.trim().replace(/^#/, '');
    setHexDraft(null);
    const p = parseHex(raw);
    if (!p) return;
    const h = rgbToHex(p);
    if (raw.length === 4 || raw.length === 8) { if (target === 'primary') usePaintStudio.getState().set({ alpha: Math.round(p.a * 100) / 100 }); }
    else if (h === hex) return;
    applyRgb(p);
  };

  const fields = useMemo(() => {
    const hsl = { ...rgbToHsl(rgb), h: hsv.h };
    const cmyk = rgbToCmyk(rgb);
    switch (inputMode) {
      case 'rgb': return [{ k: 'r', label: 'R', max: 255, v: rgb.r }, { k: 'g', label: 'G', max: 255, v: rgb.g }, { k: 'b', label: 'B', max: 255, v: rgb.b }];
      case 'hsl': return [{ k: 'h', label: 'H°', max: 360, v: Math.round(hsl.h) % 361 }, { k: 's', label: 'S%', max: 100, v: Math.round(hsl.s * 100) }, { k: 'l', label: 'L%', max: 100, v: Math.round(hsl.l * 100) }];
      case 'hsv': return [{ k: 'h', label: 'H°', max: 360, v: Math.round(hsv.h) % 361 }, { k: 's', label: 'S%', max: 100, v: Math.round(hsv.s * 100) }, { k: 'v', label: 'V%', max: 100, v: Math.round(hsv.v * 100) }];
      case 'cmyk': return [{ k: 'c', label: 'C%', max: 100, v: Math.round(cmyk.c * 100) }, { k: 'm', label: 'M%', max: 100, v: Math.round(cmyk.m * 100) }, { k: 'y', label: 'Y%', max: 100, v: Math.round(cmyk.y * 100) }, { k: 'k', label: 'K%', max: 100, v: Math.round(cmyk.k * 100) }];
      default: return [];
    }
  }, [inputMode, rgb.r, rgb.g, rgb.b, hsv.h, hsv.s, hsv.v]); // eslint-disable-line react-hooks/exhaustive-deps

  const editField = (k: string, v: number) => {
    switch (inputMode) {
      case 'rgb': applyRgb({ ...rgb, [k]: v }); break;
      case 'hsl': { const hsl = { ...rgbToHsl(rgb), h: hsv.h, [k]: k === 'h' ? v : v / 100 }; applyRgb(hslToRgb(hsl), hsl.h); break; }
      case 'hsv': { const n = { ...hsv, [k]: k === 'h' ? v : v / 100 }; applyRgb(hsvToRgb(n), n.h); break; }
      case 'cmyk': applyRgb(cmykToRgb({ ...rgbToCmyk(rgb), [k]: v / 100 })); break;
    }
  };

  // ── palettes
  const palettes = useLiveQuery(() => db.palettes.orderBy('createdAt').toArray(), []);
  useEffect(() => { void seedDefaultPalette(); }, []);
  const palette: Palette | undefined = palettes?.find((p) => p.id === activePaletteId) ?? palettes?.[0];
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [extractLocal, setExtractLocal] = useState<{ blob: Blob; name: string } | null>(null);
  const exSrc = extractSource ? { blob: extractSource, name: extractName } : extractLocal;
  const closeExtract = () => { useColorUi.getState().setExtract(null); setExtractLocal(null); };

  const onDropFiles = async (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      if (f.type.startsWith('image/')) { setExtractLocal({ blob: f, name: f.name }); continue; }
      const ok = await importPaletteFile({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
      if (!ok) toast(`"${f.name}" is not a recognised palette or image file`, 'error');
    }
  };

  const harmonyColors = useMemo(() => harmony(hsv, hKind).map((h) => rgbToHex(hsvToRgb(h))), [hsv, hKind]);
  const mode = pickerMode;

  return (
    <div className="flex flex-col text-[12px] text-fg" data-testid="color-panel">
      {/* swatches */}
      <div className="flex items-center gap-3 px-3 pt-2.5 pb-2">
        <div className="relative h-11 w-14 shrink-0">
          <button title="Secondary colour (click to edit)" data-testid="color-swatch-secondary" onClick={() => setTarget('secondary')}
            className={clsx('absolute right-0 bottom-0 h-7 w-9 rounded border', target === 'secondary' ? 'border-[var(--iln-accent)] ring-1 ring-[var(--iln-accent)]' : 'border-line')} style={{ background: secondary }} />
          <button title="Primary colour (click to edit)" data-testid="color-swatch-primary" onClick={() => setTarget('primary')}
            className={clsx('absolute top-0 left-0 h-8 w-10 overflow-hidden rounded border-2 shadow', target === 'primary' ? 'border-[var(--iln-accent)]' : 'border-bg-1')} style={{ background: CHECKER }}>
            <span className="absolute inset-0" data-testid="color-swatch-primary-fill" style={{ background: color, opacity: alpha }} />
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <button className={iconBtn} title="Swap colours (X)" data-testid="color-swap" onClick={() => usePaintStudio.getState().swapColors()}><ArrowLeftRight size={14} /></button>
            <button className={iconBtn} title="Reset to black / white" data-testid="color-reset" onClick={() => usePaintStudio.getState().set({ color: '#000000', secondary: '#ffffff' })}><RotateCcw size={13} /></button>
          </div>
          <span className="text-[10.5px] text-fg-faint">Editing {target}</span>
        </div>
        <Segmented className="ml-auto" testId="color-picker-mode" value={mode} onChange={(v) => useColor.getState().set({ pickerMode: v })} options={[{ value: 'wheel', label: 'Wheel' }, { value: 'box', label: 'Box' }]} />
      </div>

      <div className="flex justify-center px-3 pb-2"><Picker mode={mode} hsv={hsv} size={PICKER_SIZE} onChange={onPick} onCommit={onPickCommit} /></div>

      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="w-9 text-[10.5px] text-fg-faint uppercase">Alpha</span>
        <AlphaBar hex={hex} alpha={alpha} onChange={(a) => usePaintStudio.getState().set({ alpha: a })} onCommit={() => undefined} />
        <span className="w-9 text-right text-[11px] text-fg-muted tabular-nums" data-testid="color-alpha-value">{Math.round(alpha * 100)}%</span>
      </div>

      <div className="px-3 pb-2.5">
        <div className="mb-1.5 flex gap-0.5 rounded-md border border-line bg-bg-2 p-0.5" role="tablist" data-testid="color-input-tabs">
          {INPUT_TABS.map((t) => (
            <button key={t.value} role="tab" aria-selected={inputMode === t.value} data-testid={`color-tab-${t.value}`} onClick={() => useColor.getState().set({ inputMode: t.value })}
              className={clsx('h-5 flex-1 rounded text-[10.5px] font-medium', inputMode === t.value ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg')}>{t.label}</button>
          ))}
        </div>
        {inputMode === 'hex' ? (
          <input data-testid="color-hex" aria-label="Hex colour" spellCheck={false} value={hexDraft ?? hexShown} onChange={(e) => setHexDraft(e.target.value)} onBlur={commitHex}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setHexDraft(null); e.currentTarget.blur(); } }}
            className="h-7 w-full rounded border border-line bg-bg-2 px-2 font-mono text-[12px] text-fg outline-none focus:border-[var(--iln-accent)]" />
        ) : (
          <div className="flex gap-1.5">{fields.map((f) => <NumField key={f.k} testId={`color-field-${f.k}`} label={f.label} value={f.v} max={f.max} onCommit={(v) => editField(f.k, v)} />)}</div>
        )}
      </div>

      <Section title="Recent" testId="color-history">
        {history.length === 0 ? <div className="text-[11px] text-fg-faint">Colours you use appear here.</div> : (
          <div className="flex flex-wrap gap-1">
            {history.map((c) => (
              <Swatch key={c} color={c} title={`${c} — click to use, Shift-click for secondary, right-click to remove`} data-testid="color-history-item"
                onClick={(e) => useHex(c, e)} onContextMenu={(e) => { e.preventDefault(); useColor.getState().removeHistory(c); }} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Harmony" testId="color-harmony" actions={
        <button className="h-5 rounded px-1.5 text-[10.5px] font-medium text-fg-muted hover:bg-bg-3 hover:text-fg" data-testid="harmony-add-all" onClick={() => void addToActivePalette(harmonyColors)}>Add all to palette</button>}>
        <select value={hKind} onChange={(e) => useColor.getState().set({ harmony: e.target.value as typeof hKind })} data-testid="harmony-kind" aria-label="Harmony type"
          className="mb-1.5 h-6 w-full rounded border border-line bg-bg-2 px-1.5 text-[11.5px] text-fg">
          {HARMONY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex h-7 overflow-hidden rounded border border-black/25">
          {harmonyColors.map((c, i) => <button key={c + i} title={c} data-testid="harmony-swatch" onClick={(e) => useHex(c, e)} style={{ background: c }} className="flex-1 hover:brightness-110" />)}
        </div>
      </Section>

      <Section title="Palettes" testId="color-palettes"
        actions={<>
          <button className={iconBtn} title="New palette" data-testid="palette-new" onClick={() => void createPalette()}><Plus size={14} /></button>
          <button className={iconBtn} title="Import palette (.gpl, .hex, .txt)" data-testid="palette-import" onClick={() => void importPaletteDialog()}><FolderDown size={14} /></button>
          <button className={iconBtn} title="Extract palette from image" data-testid="palette-extract" onClick={() => void pickImageForExtraction()}><ImagePlus size={14} /></button>
        </>}>
        <div data-testid="palette-drop" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={(e) => void onDropFiles(e)}>
          <div className="mb-1.5 flex items-center gap-1">
            <select value={palette?.id ?? ''} onChange={(e) => useColor.getState().set({ activePaletteId: e.target.value })} data-testid="palette-select" aria-label="Active palette"
              className="h-6 min-w-0 flex-1 rounded border border-line bg-bg-2 px-1.5 text-[11.5px] text-fg">
              {palettes?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.colors.length})</option>)}
            </select>
            <button className={iconBtn} title="Rename palette" disabled={!palette} data-testid="palette-rename" onClick={() => palette && void renamePalette(palette)}><Pencil size={13} /></button>
            <button className={iconBtn} title="Delete palette" disabled={!palette} data-testid="palette-delete" onClick={() => palette && void deletePalette(palette)}><Trash2 size={13} /></button>
            <button className={iconBtn} title="Export as .gpl" disabled={!palette} data-testid="palette-export-gpl" onClick={() => palette && void exportPalette(palette, 'gpl')}><FolderUp size={14} /></button>
            <button className="h-6 rounded px-1 text-[10px] font-medium text-fg-muted hover:bg-bg-3 hover:text-fg disabled:opacity-40" title="Export as .hex" disabled={!palette} data-testid="palette-export-hex" onClick={() => palette && void exportPalette(palette, 'hex')}>.hex</button>
          </div>
          {palette ? (
            <div className="flex flex-wrap gap-1" data-testid="palette-grid">
              {palette.colors.map((c, i) => (
                <Swatch key={c + i} color={c} draggable title={`${c} — click: primary, Shift/Alt-click: secondary, right-click: remove, drag to reorder`} data-testid="palette-swatch"
                  className={clsx(dragOver === i && 'ring-2 ring-[var(--iln-accent)]')}
                  onClick={(e) => useHex(c, e)}
                  onContextMenu={(e) => { e.preventDefault(); void setPaletteColors(palette.id, removeAt(palette.colors, i)); }}
                  onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c); }}
                  onDragOver={(e) => { if (dragFrom.current !== null) { e.preventDefault(); setDragOver(i); } }}
                  onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
                  onDrop={(e) => { const from = dragFrom.current; if (from === null) return; e.preventDefault(); e.stopPropagation(); dragFrom.current = null; setDragOver(null); if (from !== i) void setPaletteColors(palette.id, reorder(palette.colors, from, i)); }} />
              ))}
              <button title="Add current colour" data-testid="palette-add" onClick={() => void addToActivePalette([hex])}
                className="flex h-5 w-5 items-center justify-center rounded-[3px] border border-dashed border-line text-fg-muted hover:border-[var(--iln-accent)] hover:text-fg"><Plus size={12} /></button>
            </div>
          ) : <div className="text-[11px] text-fg-faint">Loading palettes…</div>}
          <div className="mt-1.5 text-[10.5px] text-fg-faint">Drop a .gpl / .hex file or an image here.</div>
        </div>
        {exSrc && <ExtractPanel source={exSrc.blob} name={exSrc.name} onClose={closeExtract} />}
      </Section>
    </div>
  );
}
