import { registerCommands } from '@/commands/registry';
import { activeTab } from '@/store/tabs';
import { toast } from '@/store/status';
import { promptDialog } from '@/ui/dialogs';
import { encodeCanvas } from '@/lib/encode';
import { usePaintStudio } from '../studio/store';
import { makeCanvas, ctx2d, type PaintDocument } from '../engine/document';
import { maskBounds } from '../fill/mask';
import { selectAll, deselect, invertSelection, featherSelection, expandSelection, contractSelection, maskToCanvas, setSelection } from './selection';
import { startTransform, useTransform } from './tools';

const doc = (): PaintDocument | null => (activeTab()?.kind === 'paint' ? usePaintStudio.getState().doc : null);
const when = () => !!doc();

/** Internal clipboard: last copied pixels + their document position. */
let clip: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;

function selectedPixels(d: PaintDocument, merged: boolean): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  const src = merged ? d.composite() : d.active?.canvas;
  if (!src) return null;
  const sel = d.selection;
  const b = sel ? maskBounds(sel) : { x: 0, y: 0, w: d.width, h: d.height };
  if (!b) return null;
  const c = makeCanvas(b.w, b.h);
  const g = ctx2d(c);
  g.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  if (sel) { g.globalCompositeOperation = 'destination-in'; g.drawImage(maskToCanvas(sel), b.x, b.y, b.w, b.h, 0, 0, b.w, b.h); }
  return { canvas: c, x: b.x, y: b.y };
}

async function copy(merged = false, cut = false): Promise<void> {
  const d = doc();
  if (!d) return;
  const px = selectedPixels(d, merged);
  if (!px) { toast('Nothing to copy', 'error'); return; }
  clip = px;
  try {
    const blob = await encodeCanvas(px.canvas);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch { /* system clipboard unavailable: internal clipboard still works */ }
  if (cut && d.activeLayerId) clearSelected(d, 'Cut');
  toast(cut ? 'Cut to clipboard' : merged ? 'Copied merged' : 'Copied', 'ok');
}

function clearSelected(d: PaintDocument, label = 'Clear'): void {
  const id = d.activeLayerId;
  if (!id) return;
  d.pixelOp(label, id, (c) => {
    if (d.selection) { c.globalCompositeOperation = 'destination-out'; c.drawImage(maskToCanvas(d.selection), 0, 0); c.globalCompositeOperation = 'source-over'; }
    else c.clearRect(0, 0, d.width, d.height);
  }, 'raster', d.editChannel);
}

function fillSelected(d: PaintDocument): void {
  const id = d.activeLayerId;
  if (!id) return;
  const color = usePaintStudio.getState().color;
  d.pixelOp('Fill', id, (c) => {
    const t = makeCanvas(d.width, d.height);
    const tc = ctx2d(t);
    tc.fillStyle = d.editChannel === 'mask' ? '#ffffff' : color;
    tc.fillRect(0, 0, d.width, d.height);
    if (d.selection) { tc.globalCompositeOperation = 'destination-in'; tc.drawImage(maskToCanvas(d.selection), 0, 0); }
    c.globalCompositeOperation = d.active?.meta.alphaLock ? 'source-atop' : 'source-over';
    c.drawImage(t, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }, 'raster', d.editChannel);
}

async function paste(): Promise<void> {
  const d = doc();
  if (!d) return;
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const bmp = await createImageBitmap(await it.getType(type));
      // Same image as our internal clip → keep its original position.
      const x = clip && clip.canvas.width === bmp.width && clip.canvas.height === bmp.height ? clip.x : Math.round((d.width - bmp.width) / 2);
      const y = clip && clip.canvas.width === bmp.width && clip.canvas.height === bmp.height ? clip.y : Math.round((d.height - bmp.height) / 2);
      d.addLayerFromCanvas(bmp, 'Pasted layer', x, y);
      bmp.close();
      return;
    }
  } catch { /* fall back to the internal clipboard */ }
  if (!clip) { toast('Clipboard is empty', 'error'); return; }
  d.addLayerFromCanvas(clip.canvas, 'Pasted layer', clip.x, clip.y);
}

function flip(axis: 'x' | 'y'): void {
  const d = doc();
  if (!d?.activeLayerId) return;
  if (d.selection) {
    const f = startTransform(d);
    if (f) { f.ft.flip(axis); usePaintStudio.getState().setTool('transform'); f.doc.invalidate(); }
    return;
  }
  d.pixelOp(axis === 'x' ? 'Flip horizontal' : 'Flip vertical', d.activeLayerId, (c, canvas) => {
    const copyC = makeCanvas(canvas.width, canvas.height);
    ctx2d(copyC).drawImage(canvas, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save();
    if (axis === 'x') { c.translate(canvas.width, 0); c.scale(-1, 1); } else { c.translate(0, canvas.height); c.scale(1, -1); }
    c.drawImage(copyC, 0, 0);
    c.restore();
  });
}

async function askRadius(title: string): Promise<number | null> {
  const v = await promptDialog(`${title} (px)`, '4');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(500, n) : null;
}

/** Select the opaque pixels of the active layer ("load layer transparency"). */
function selectLayerAlpha(d: PaintDocument): void {
  const c = d.active?.canvas;
  if (!c) return;
  const data = ctx2d(c).getImageData(0, 0, d.width, d.height).data;
  const m = { width: d.width, height: d.height, data: new Uint8ClampedArray(d.width * d.height) };
  for (let i = 0; i < m.data.length; i++) m.data[i] = data[i * 4 + 3];
  setSelection(d, m, 'Select layer pixels');
}

registerCommands([
  { id: 'paint.selectAll', title: 'Paint: Select all', category: 'Selection', shortcut: 'Mod+A', when, run: () => { const d = doc(); if (d) selectAll(d); } },
  { id: 'paint.deselect', title: 'Paint: Deselect', category: 'Selection', shortcut: 'Mod+D', when, run: () => { const d = doc(); if (d) deselect(d); } },
  { id: 'paint.invertSelection', title: 'Paint: Invert selection', category: 'Selection', shortcut: 'Mod+Shift+I', when, run: () => { const d = doc(); if (d) invertSelection(d); } },
  { id: 'paint.selectLayer', title: 'Paint: Select layer pixels', category: 'Selection', when, run: () => { const d = doc(); if (d) selectLayerAlpha(d); } },
  { id: 'paint.feather', title: 'Paint: Feather selection…', category: 'Selection', shortcut: 'Mod+Alt+F', when, run: async () => { const d = doc(); const r = await askRadius('Feather radius'); if (d && r) featherSelection(d, r); } },
  { id: 'paint.expand', title: 'Paint: Expand selection…', category: 'Selection', when, run: async () => { const d = doc(); const r = await askRadius('Expand by'); if (d && r) expandSelection(d, r); } },
  { id: 'paint.contract', title: 'Paint: Contract selection…', category: 'Selection', when, run: async () => { const d = doc(); const r = await askRadius('Contract by'); if (d && r) contractSelection(d, r); } },
  { id: 'paint.copy', title: 'Paint: Copy', category: 'Selection', shortcut: 'Mod+C', when, run: () => copy(false) },
  { id: 'paint.copyMerged', title: 'Paint: Copy merged', category: 'Selection', shortcut: 'Mod+Shift+C', when, run: () => copy(true) },
  { id: 'paint.cut', title: 'Paint: Cut', category: 'Selection', shortcut: 'Mod+X', when, run: () => copy(false, true) },
  { id: 'paint.paste', title: 'Paint: Paste as new layer', category: 'Selection', shortcut: 'Mod+V', when, run: () => paste() },
  { id: 'paint.clear', title: 'Paint: Clear selection pixels', category: 'Selection', shortcut: ['Delete', 'Backspace'], when, run: () => { const d = doc(); if (d) clearSelected(d); } },
  { id: 'paint.fillSelection', title: 'Paint: Fill selection with colour', category: 'Selection', shortcut: 'Alt+Backspace', when, run: () => { const d = doc(); if (d) fillSelected(d); } },
  { id: 'paint.flipH', title: 'Paint: Flip horizontal', category: 'Transform', when, run: () => flip('x') },
  { id: 'paint.flipV', title: 'Paint: Flip vertical', category: 'Transform', when, run: () => flip('y') },
  { id: 'paint.transform', title: 'Paint: Free transform', category: 'Transform', shortcut: 'Mod+T', when, run: () => { const d = doc(); if (d && startTransform(d)) usePaintStudio.getState().setTool('transform'); } },
  { id: 'paint.transformApply', title: 'Paint: Apply transform', category: 'Transform', when: () => !!useTransform.getState().floating, run: () => { useTransform.getState().floating && usePaintStudio.getState().setTool(usePaintStudio.getState().previousTool); } },
]);
