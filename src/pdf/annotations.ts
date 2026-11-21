/** Per-PDF annotation model with undo history (highlights, underline/strike, ink, sticky notes). */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import type { Annotation } from '@/db/types';
import { HistoryStack } from '@/history/stack';

export interface AnnState { ready: boolean; items: Record<string, Annotation>; selected: string | null }

export class PdfAnnotations {
  readonly store: StoreApi<AnnState>;
  readonly history = new HistoryStack({ limit: 200 });
  private writes: Promise<void> = Promise.resolve();

  constructor(readonly pdfId: string) {
    this.store = createStore<AnnState>(() => ({ ready: false, items: {}, selected: null }));
  }

  get state(): AnnState { return this.store.getState(); }

  async load(): Promise<void> {
    const rows = await db.annotations.where('pdfId').equals(this.pdfId).toArray();
    this.store.setState({ ready: true, items: Object.fromEntries(rows.map((a) => [a.id, a])) });
  }

  private apply(put: Annotation[], remove: string[]): Promise<void> {
    this.store.setState((s) => {
      const items = { ...s.items };
      for (const id of remove) delete items[id];
      for (const a of put) items[a.id] = a;
      return { items, selected: s.selected && items[s.selected] ? s.selected : null };
    });
    const next = this.writes.then(async () => {
      if (remove.length) await db.annotations.bulkDelete(remove);
      if (put.length) await db.annotations.bulkPut(put);
    });
    this.writes = next.catch((e) => console.error('Annotation persist failed', e));
    return next;
  }

  async commit(label: string, put: Annotation[], remove: string[] = []): Promise<void> {
    const cur = this.state.items;
    const undoPut = [...put.map((a) => cur[a.id]).filter(Boolean), ...remove.map((id) => cur[id]).filter(Boolean)];
    const undoRemove = put.filter((a) => !cur[a.id]).map((a) => a.id);
    const pending = this.apply(put, remove);
    this.history.push({ label, kind: 'vector', redo: () => this.apply(put, remove), undo: () => this.apply(undoPut, undoRemove) });
    await pending;
  }

  create(p: Omit<Annotation, 'id' | 'pdfId' | 'createdAt'>): Annotation {
    return { ...p, id: nanoid(), pdfId: this.pdfId, createdAt: Date.now() };
  }

  forPage(pageIndex: number): Annotation[] {
    return Object.values(this.state.items).filter((a) => a.pageIndex === pageIndex).sort((a, b) => a.createdAt - b.createdAt);
  }
}

const cache = new Map<string, { a: PdfAnnotations; refs: number }>();
export function acquireAnnotations(pdfId: string): PdfAnnotations {
  let e = cache.get(pdfId);
  if (!e) { e = { a: new PdfAnnotations(pdfId), refs: 0 }; cache.set(pdfId, e); void e.a.load(); }
  e.refs++;
  return e.a;
}
export function releaseAnnotations(pdfId: string): void {
  const e = cache.get(pdfId);
  if (e && --e.refs <= 0) cache.delete(pdfId);
}

/** Merge client rects of a text selection into one rect per line (in page units). */
export function mergeLineRects(rects: { x: number; y: number; w: number; h: number }[]): number[][] {
  const sorted = rects.filter((r) => r.w > 0.5 && r.h > 0.5).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const r of sorted) {
    const cy = r.y + r.h / 2;
    const line = lines.find((l) => cy >= l.y0 && cy <= l.y1 && r.x <= l.x1 + 6);
    if (line) { line.x0 = Math.min(line.x0, r.x); line.x1 = Math.max(line.x1, r.x + r.w); line.y0 = Math.min(line.y0, r.y); line.y1 = Math.max(line.y1, r.y + r.h); }
    else lines.push({ x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h });
  }
  return lines.map((l) => [l.x0, l.y0, l.x1 - l.x0, l.y1 - l.y0]);
}

export const ANNOTATION_COLORS = ['#facc15', '#4ade80', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa', '#ef4444', '#111827'];
