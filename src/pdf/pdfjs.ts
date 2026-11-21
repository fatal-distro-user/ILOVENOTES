/** pdf.js loading (worker bundled locally → works offline), document cache and page bitmap rendering. */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { db } from '@/db/schema';
import { encodeCanvas } from '@/lib/encode';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };

const docs = new Map<string, Promise<PDFDocumentProxy>>();

export async function loadPdfBytes(data: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker, so always hand it a copy.
  return pdfjs.getDocument({ data: data.slice() }).promise;
}

/** Cached pdf.js document for a stored PdfFile. */
export function getPdfDoc(pdfId: string): Promise<PDFDocumentProxy> {
  let p = docs.get(pdfId);
  if (!p) {
    p = (async () => {
      const rec = await db.pdfs.get(pdfId);
      if (!rec) throw new Error('PDF not found');
      return loadPdfBytes(new Uint8Array(await rec.data.arrayBuffer()));
    })();
    p.catch(() => docs.delete(pdfId));
    docs.set(pdfId, p);
  }
  return p;
}

export function forgetPdf(pdfId: string): void {
  const p = docs.get(pdfId);
  docs.delete(pdfId);
  void p?.then((d) => d.loadingTask.destroy()).catch(() => undefined);
}

/** Page size in CSS px at scale 1 (respects /Rotate). */
export async function pageSize(page: PDFPageProxy): Promise<{ w: number; h: number }> {
  const v = page.getViewport({ scale: 1 });
  return { w: v.width, h: v.height };
}

export async function renderPageToCanvas(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number): Promise<void> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
}

/** Bitmap cache for page images used on the canvas and in exports (LRU-ish, keyed by id/page/scale bucket). */
const bitmaps = new Map<string, Promise<string>>();
export function pageImageUrl(pdfId: string, pageIndex: number, scale: number): Promise<string> {
  const bucket = Math.max(0.5, Math.min(4, Math.round(scale * 2) / 2));
  const key = `${pdfId}:${pageIndex}:${bucket}`;
  let p = bitmaps.get(key);
  if (!p) {
    p = (async () => {
      const doc = await getPdfDoc(pdfId);
      const page = await doc.getPage(pageIndex + 1);
      const c = document.createElement('canvas');
      await renderPageToCanvas(page, c, bucket);
      const blob = await encodeCanvas(c);
      return URL.createObjectURL(blob);
    })();
    bitmaps.set(key, p);
    if (bitmaps.size > 80) {
      const first = bitmaps.keys().next().value as string;
      void bitmaps.get(first)?.then((u) => URL.revokeObjectURL(u));
      bitmaps.delete(first);
    }
  }
  return p;
}

/** Extract all text from a PDF (for search indexing). */
export async function extractText(doc: PDFDocumentProxy, maxPages = 400): Promise<string> {
  const parts: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    parts.push(tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join(''));
  }
  return parts.join('\n\n');
}
