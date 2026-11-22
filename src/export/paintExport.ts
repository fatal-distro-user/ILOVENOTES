/** Layered paint exports: OpenRaster (.ora), Photoshop (.psd via ag-psd), and a ZIP of per-layer PNGs. */
import { zipSync, strToU8 } from 'fflate';
import { writePsd, type Psd, type Layer as PsdLayer, type BlendMode as PsdBlend } from 'ag-psd';
import type { PaintDocument, LayerRT } from '@/paint/engine/document';
import { ctx2d, makeCanvas } from '@/paint/engine/document';
import { encodePng } from '@/lib/png';
import type { BlendMode } from '@/db/types';

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const ORA_OP: Record<BlendMode, string> = {
  normal: 'svg:src-over', multiply: 'svg:multiply', screen: 'svg:screen', overlay: 'svg:overlay', darken: 'svg:darken', lighten: 'svg:lighten',
  'color-dodge': 'svg:color-dodge', 'color-burn': 'svg:color-burn', 'hard-light': 'svg:hard-light', 'soft-light': 'svg:soft-light',
  difference: 'svg:difference', exclusion: 'svg:exclusion', hue: 'svg:hue', saturation: 'svg:saturation', color: 'svg:color', luminosity: 'svg:luminosity',
};
const PSD_BLEND: Record<BlendMode, PsdBlend> = {
  normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color dodge',
  'color-burn': 'color burn', 'hard-light': 'hard light', 'soft-light': 'soft light', difference: 'difference', exclusion: 'exclusion',
  hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};

/** Layer pixels with its mask applied (exporters that don't support masks get the visible result). */
function pixels(doc: PaintDocument, l: LayerRT): HTMLCanvasElement {
  if (l.meta.kind === 'group' || l.meta.kind === 'adjustment') return doc.renderTo({ only: [l.meta.id, ...doc.descendants(l.meta.id)] });
  const c = makeCanvas(doc.width, doc.height);
  const g = ctx2d(c);
  g.drawImage(l.canvas, 0, 0);
  if (l.mask && l.meta.hasMask && l.meta.maskEnabled) { g.globalCompositeOperation = 'destination-in'; g.drawImage(l.mask, 0, 0); }
  return c;
}
const png = (c: HTMLCanvasElement) => { const d = ctx2d(c).getImageData(0, 0, c.width, c.height); return encodePng(d.data, d.width, d.height, 4); };

export function exportOra(doc: PaintDocument): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const stack = (parentId: string | null): string => doc.children(parentId).slice().reverse().map((l) => {
    const common = `name="${xmlEsc(l.meta.name)}" opacity="${l.meta.opacity}" visibility="${l.meta.visible ? 'visible' : 'hidden'}" composite-op="${ORA_OP[l.meta.blend]}"`;
    if (l.meta.kind === 'group') return `<stack ${common} isolation="isolate">${stack(l.meta.id)}</stack>`;
    const src = `data/${l.meta.id}.png`;
    files[src] = png(pixels(doc, l));
    return `<layer ${common} src="${src}" x="0" y="0"${l.meta.locked ? ' edit-locked="true"' : ''}${l.meta.alphaLock ? ' alpha-preserve="true"' : ''}/>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${doc.width}" h="${doc.height}" xres="72" yres="72"><stack>${stack(null)}</stack></image>`;
  const merged = doc.composite();
  const thumbC = makeCanvas(Math.max(1, Math.round(doc.width * Math.min(1, 256 / Math.max(doc.width, doc.height)))), Math.max(1, Math.round(doc.height * Math.min(1, 256 / Math.max(doc.width, doc.height)))));
  ctx2d(thumbC).drawImage(merged, 0, 0, thumbC.width, thumbC.height);
  // The spec requires "mimetype" first and stored uncompressed.
  return zipSync({
    mimetype: [strToU8('image/openraster'), { level: 0 }],
    'stack.xml': strToU8(xml),
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }]])),
    'mergedimage.png': [png(merged), { level: 0 }],
    'Thumbnails/thumbnail.png': [png(thumbC), { level: 0 }],
  } as never);
}

export function exportPsd(doc: PaintDocument): Uint8Array {
  const toPsd = (parentId: string | null): PsdLayer[] => doc.children(parentId).map((l): PsdLayer => {
    const base: PsdLayer = { name: l.meta.name, opacity: l.meta.opacity, hidden: !l.meta.visible, blendMode: PSD_BLEND[l.meta.blend], clipping: l.meta.clip };
    if (l.meta.kind === 'group') return { ...base, opened: true, children: toPsd(l.meta.id) };
    const c = l.meta.kind === 'adjustment' ? pixels(doc, l) : l.canvas;
    const layer: PsdLayer = { ...base, left: 0, top: 0, canvas: c as unknown as PsdLayer['canvas'] };
    if (l.mask && l.meta.hasMask) {
      // PSD masks are greyscale: our mask alpha → grey levels.
      const m = makeCanvas(doc.width, doc.height);
      const mg = ctx2d(m);
      mg.fillStyle = '#000'; mg.fillRect(0, 0, m.width, m.height);
      mg.globalCompositeOperation = 'lighter';
      const white = makeCanvas(doc.width, doc.height);
      const wg = ctx2d(white);
      wg.fillStyle = '#fff'; wg.fillRect(0, 0, white.width, white.height);
      wg.globalCompositeOperation = 'destination-in'; wg.drawImage(l.mask, 0, 0);
      mg.drawImage(white, 0, 0);
      layer.mask = { left: 0, top: 0, canvas: m as unknown as PsdLayer['canvas'], disabled: !l.meta.maskEnabled, defaultColor: 0 };
    }
    return layer;
  });
  const psd: Psd = { width: doc.width, height: doc.height, channels: 4, children: toPsd(null), canvas: doc.composite() as unknown as Psd['canvas'] };
  return new Uint8Array(writePsd(psd, { generateThumbnail: true }));
}

export function exportLayersZip(doc: PaintDocument): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  const order: string[] = [];
  doc.displayList().slice().reverse().forEach(({ layer }, i) => {
    if (layer.meta.kind === 'group') return;
    const name = `${String(i + 1).padStart(3, '0')}-${layer.meta.name.replace(/[^\w-]+/g, '_')}.png`;
    files[name] = [png(pixels(doc, layer)), { level: 0 }];
    order.push(`${name}\t${layer.meta.blend}\t${Math.round(layer.meta.opacity * 100)}%\t${layer.meta.visible ? 'visible' : 'hidden'}`);
  });
  files['merged.png'] = [png(doc.composite()), { level: 0 }];
  return zipSync({ ...files, 'layers.txt': strToU8(`file\tblend\topacity\tvisibility\n${order.join('\n')}\n`) } as never);
}
