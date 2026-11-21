/** Flattened annotated-PDF export and page extraction with pdf-lib. */
import { PDFDocument, rgb, BlendMode, StandardFonts, LineCapStyle, type PDFPage, type PDFFont } from 'pdf-lib';
import { db } from '@/db/schema';
import type { Annotation } from '@/db/types';
import { getPdfDoc } from './pdfjs';

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0xfacc15;
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

type ToPdf = (x: number, y: number) => [number, number];

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxW && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Strip characters the standard (WinAnsi) font cannot encode. */
const winAnsi = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');

function drawAnnotation(page: PDFPage, a: Annotation, toPdf: ToPdf, font: PDFFont): void {
  const color = hexToRgb(a.color);
  const box = (r: number[]) => {
    const pts = [toPdf(r[0], r[1]), toPdf(r[0] + r[2], r[1]), toPdf(r[0], r[1] + r[3]), toPdf(r[0] + r[2], r[1] + r[3])];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  if (a.type === 'highlight') {
    for (const r of a.rects ?? []) { const b = box(r); page.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color, opacity: 0.38, blendMode: BlendMode.Multiply }); }
  } else if (a.type === 'underline' || a.type === 'strike') {
    for (const r of a.rects ?? []) {
      const yy = a.type === 'underline' ? r[1] + r[3] - 0.5 : r[1] + r[3] * 0.55;
      const s = toPdf(r[0], yy), e = toPdf(r[0] + r[2], yy);
      page.drawLine({ start: { x: s[0], y: s[1] }, end: { x: e[0], y: e[1] }, thickness: Math.max(0.8, r[3] * 0.08), color });
    }
  } else if (a.type === 'ink' && a.points && a.points.length >= 3) {
    const segs: string[] = [];
    for (let i = 0; i < a.points.length; i += 3) {
      const [x, y] = toPdf(a.points[i], a.points[i + 1]);
      segs.push(`${i ? 'L' : 'M'}${x.toFixed(2)} ${(-y).toFixed(2)}`);
    }
    // drawSvgPath flips Y around the origin given, so feed negated Y with origin (0,0).
    page.drawSvgPath(segs.join(' '), { x: 0, y: 0, borderColor: color, borderWidth: a.width ?? 2, borderLineCap: LineCapStyle.Round, opacity: 1 });
  } else if (a.type === 'sticky' && a.x !== undefined && a.y !== undefined) {
    const [x, y] = toPdf(a.x, a.y);
    page.drawRectangle({ x, y: y - 14, width: 14, height: 14, color, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.6 });
    if (a.text?.trim()) {
      const size = 8.5, maxW = 170;
      const lines = wrap(winAnsi(a.text.trim()), font, size, maxW);
      const h = lines.length * (size + 2) + 8;
      const bx = Math.min(x + 18, page.getWidth() - maxW - 12), by = Math.max(4, y - h);
      page.drawRectangle({ x: bx, y: by, width: maxW + 8, height: h, color: rgb(1, 0.98, 0.8), borderColor: color, borderWidth: 0.8, opacity: 0.95 });
      lines.forEach((l, i) => page.drawText(l, { x: bx + 4, y: by + h - 4 - (i + 1) * (size + 2) + 2, size, font, color: rgb(0.1, 0.1, 0.1) }));
    }
  }
}

export interface ExportOptions { pages?: number[]; flatten?: boolean }

/** Build a PDF with annotations burned in. `pages` (0-based) selects/extracts a subset in the given order. */
export async function exportAnnotatedPdf(pdfId: string, opts: ExportOptions = {}): Promise<Uint8Array> {
  const rec = await db.pdfs.get(pdfId);
  if (!rec) throw new Error('PDF not found');
  const bytes = new Uint8Array(await rec.data.arrayBuffer());
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const indices = opts.pages ?? src.getPageIndices();
  const out = opts.pages ? await PDFDocument.create() : src;
  const pages = opts.pages ? await out.copyPages(src, indices) : src.getPages();
  if (opts.pages) pages.forEach((p) => out.addPage(p));
  const font = await out.embedFont(StandardFonts.Helvetica);
  const anns = await db.annotations.where('pdfId').equals(pdfId).toArray();
  const pjs = await getPdfDoc(pdfId);
  if (opts.flatten !== false) {
    for (let k = 0; k < indices.length; k++) {
      const srcIndex = indices[k];
      const list = anns.filter((a) => a.pageIndex === srcIndex);
      if (!list.length) continue;
      const vp = (await pjs.getPage(srcIndex + 1)).getViewport({ scale: 1 });
      const toPdf: ToPdf = (x, y) => vp.convertToPdfPoint(x, y) as [number, number];
      for (const a of list.sort((p, q) => p.createdAt - q.createdAt)) drawAnnotation(pages[k], a, toPdf, font);
    }
  }
  out.setProducer('ILOVENOTES');
  out.setModificationDate(new Date());
  return out.save();
}
