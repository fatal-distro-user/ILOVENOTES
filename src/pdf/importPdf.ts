import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import type { CanvasObject, PdfFile } from '@/db/types';
import { loadPdfBytes, extractText } from './pdfjs';
import * as repo from '@/db/repo';

/** Store a PDF for a page. Validates it with pdf.js and indexes its text into the page document if empty. */
export async function importPdf(pageId: string, name: string, bytes: Uint8Array): Promise<PdfFile> {
  const doc = await loadPdfBytes(bytes);
  const rec: PdfFile = { id: nanoid(), pageId, name, data: new Blob([bytes as BlobPart], { type: 'application/pdf' }), pageCount: doc.numPages, createdAt: Date.now() };
  await db.pdfs.add(rec);
  try {
    const text = await extractText(doc, 200);
    const existing = await db.docs.get(pageId);
    if (!existing || !existing.text.trim()) {
      // Index the PDF text so search and the command palette can find it.
      await repo.saveDoc({ pageId, content: existing?.content ?? { type: 'doc', content: [{ type: 'paragraph' }] }, text: `${name}\n${text}`.slice(0, 200_000), links: existing?.links ?? [], tags: existing?.tags ?? [], headings: existing?.headings ?? [] });
    }
  } finally {
    await doc.loadingTask.destroy();
  }
  return rec;
}

/** Place every page of a stored PDF on a canvas page as a vertical stack of 'pdfpage' objects. */
export async function pdfToCanvasObjects(canvasPageId: string, pdf: PdfFile, origin: { x: number; y: number }, zStart: number): Promise<CanvasObject[]> {
  const doc = await loadPdfBytes(new Uint8Array(await pdf.data.arrayBuffer()));
  const out: CanvasObject[] = [];
  let y = origin.y;
  const t = Date.now();
  for (let i = 0; i < doc.numPages; i++) {
    const vp = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
    out.push({ id: nanoid(), pageId: canvasPageId, type: 'pdfpage', x: origin.x, y, w: vp.width, h: vp.height, rotation: 0, z: zStart + i + 1, locked: false, groupId: null, data: { pdfId: pdf.id, pageIndex: i, name: pdf.name }, createdAt: t, updatedAt: t });
    y += vp.height + 24;
  }
  await doc.loadingTask.destroy();
  return out;
}
