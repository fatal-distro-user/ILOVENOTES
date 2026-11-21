import { useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useStore } from 'zustand';
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import clsx from 'clsx';
import {
  MousePointer2, Highlighter, Underline, Strikethrough, Pen, StickyNote, Eraser, ZoomIn, ZoomOut, FileDown, Scissors,
  FilePlus2, Trash2, Shapes, Maximize2, Copy, X,
} from 'lucide-react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { db } from '@/db/schema';
import type { Annotation, PdfFile } from '@/db/types';
import { pdfjs, getPdfDoc, renderPageToCanvas, forgetPdf } from './pdfjs';
import { acquireAnnotations, releaseAnnotations, mergeLineRects, ANNOTATION_COLORS, type PdfAnnotations } from './annotations';
import { exportAnnotatedPdf } from './export';
import { importPdf, pdfToCanvasObjects } from './importPdf';
import { outlineFor, outlineToSvgPath } from '@/canvas/ink';
import { openFiles, saveFile } from '@/platform/fileio';
import { useUndoScopes, stackScope } from '@/history/scopes';
import { toast, useStatus } from '@/store/status';
import { confirmDialog } from '@/ui/dialogs';
import { Modal, Button } from '@/ui/Modal';
import { Popover } from '@/ui/Popover';
import { Slider } from '@/ui/Slider';
import * as repo from '@/db/repo';
import { useTabs } from '@/store/tabs';
import { ensureTarget } from '@/layout/actions';
import './pdf.css';

export type PdfTool = 'select' | 'highlight' | 'underline' | 'strike' | 'ink' | 'sticky' | 'eraser';

interface PdfToolState { tool: PdfTool; color: string; inkWidth: number; set(p: Partial<Omit<PdfToolState, 'set'>>): void }
export const usePdfTools = create<PdfToolState>()((set) => ({ tool: 'select', color: '#facc15', inkWidth: 2.5, set: (p) => set(p) }));

/** The PDF currently shown in the focused view, for the Annotations panel. */
interface ActivePdf { pdfId: string | null; ann: PdfAnnotations | null; scrollTo: ((page: number, y?: number) => void) | null; set(p: Partial<Omit<ActivePdf, 'set'>>): void }
export const useActivePdf = create<ActivePdf>()((set) => ({ pdfId: null, ann: null, scrollTo: null, set: (p) => set(p) }));

const PDF_FILTER = [{ name: 'PDF documents', extensions: ['pdf'] }];

export async function pickAndImportPdf(pageId: string): Promise<PdfFile | null> {
  const files = await openFiles({ filters: PDF_FILTER, multiple: true });
  let last: PdfFile | null = null;
  for (const f of files) {
    try { last = await importPdf(pageId, f.name, f.data); toast(`Imported ${f.name} (${last.pageCount} pages)`, 'ok'); }
    catch (e) { toast(`Could not open ${f.name}: ${e instanceof Error ? e.message : e}`, 'error'); }
  }
  return last;
}

export function PdfView({ pageId, active }: { pageId: string; active: boolean }) {
  const pdfs = useLiveQuery(() => db.pdfs.where('pageId').equals(pageId).sortBy('createdAt'), [pageId]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const current = pdfs?.find((p) => p.id === currentId) ?? pdfs?.[0] ?? null;
  const [dragOver, setDragOver] = useState(false);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    for (const f of Array.from(e.dataTransfer.files).filter((x) => x.type === 'application/pdf' || x.name.toLowerCase().endsWith('.pdf'))) {
      try { const rec = await importPdf(pageId, f.name, new Uint8Array(await f.arrayBuffer())); setCurrentId(rec.id); toast(`Imported ${f.name}`, 'ok'); }
      catch (err) { toast(`Could not open ${f.name}: ${err instanceof Error ? err.message : err}`, 'error'); }
    }
  };

  if (pdfs === undefined) return <div className="p-8 text-fg-faint">Loading…</div>;
  return (
    <div className={clsx('flex h-full flex-col', dragOver && 'ring-2 ring-accent ring-inset')} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => void onDrop(e)} data-testid="pdf-view">
      {pdfs.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-bg-1 px-2 py-1">
          {pdfs.map((p) => (
            <button key={p.id} onClick={() => setCurrentId(p.id)} className={clsx('rounded px-2 py-0.5 whitespace-nowrap', p.id === current?.id ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3')}>{p.name}</button>
          ))}
        </div>
      )}
      {current ? <PdfDocumentView key={current.id} pdf={current} active={active} onAdd={async () => { const r = await pickAndImportPdf(pageId); if (r) setCurrentId(r.id); }} />
        : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-fg-muted">
            <FilePlus2 size={36} className="text-fg-faint" />
            <div>Drop a PDF here or import one to annotate it.</div>
            <Button variant="primary" data-testid="pdf-import" onClick={() => void pickAndImportPdf(pageId).then((r) => r && setCurrentId(r.id))}>Import PDF…</Button>
          </div>
        )}
    </div>
  );
}

function PdfDocumentView({ pdf, active, onAdd }: { pdf: PdfFile; active: boolean; onAdd: () => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const ann = useMemo(() => acquireAnnotations(pdf.id), [pdf.id]);
  useEffect(() => () => releaseAnnotations(pdf.id), [pdf.id]);
  const tools = usePdfTools();
  const [exportOpen, setExportOpen] = useState<'export' | 'extract' | null>(null);
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const scopeId = `pdf:${pdf.id}`;

  useEffect(() => {
    let cancelled = false;
    getPdfDoc(pdf.id).then(async (d) => {
      const out: { w: number; h: number }[] = [];
      for (let i = 1; i <= d.numPages; i++) { const v = (await d.getPage(i)).getViewport({ scale: 1 }); out.push({ w: v.width, h: v.height }); }
      if (!cancelled) { setDoc(d); setSizes(out); }
    }).catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
  }, [pdf.id]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => useUndoScopes.getState().register(stackScope(scopeId, 'PDF annotations', ann.history)), [ann, scopeId]);

  const maxW = Math.max(1, ...sizes.map((s) => s.w));
  const scale = fitWidth ? Math.max(0.25, (width - 48) / maxW) : zoom;

  const scrollTo = (page: number, y = 0) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 12 + y * scale, behavior: 'smooth' });
  };
  useEffect(() => {
    if (active) useActivePdf.getState().set({ pdfId: pdf.id, ann, scrollTo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pdf.id, ann, scale]);
  useEffect(() => {
    if (!active) return;
    useUndoScopes.getState().activate(scopeId);
    useStatus.getState().set({ words: null, chars: null, strokes: null, zoom: null, cursor: null });
  }, [active, scopeId]);

  const setScale = (z: number) => { setFitWidth(false); setZoom(Math.max(0.25, Math.min(5, z))); };

  const sendToCanvas = async () => {
    try {
      const t = await ensureTarget();
      const node = await repo.createNode({ workspaceId: t.workspaceId, notebookId: t.notebookId, parentId: null, kind: 'page', title: `${pdf.name.replace(/\.pdf$/i, '')} (canvas)`, mode: 'canvas', icon: '📑' });
      const copy = { ...pdf, id: nanoid(), pageId: node.id };
      await db.pdfs.add(copy);
      const anns = await db.annotations.where('pdfId').equals(pdf.id).toArray();
      await db.annotations.bulkAdd(anns.map((a) => ({ ...a, id: nanoid(), pdfId: copy.id })));
      const objs = await pdfToCanvasObjects(node.id, copy, { x: 0, y: 0 }, 0);
      await db.canvasObjects.bulkAdd(objs);
      useTabs.getState().openPage(node.id, node.title, { newTab: true });
      toast(`Placed ${objs.length} page(s) on a new canvas`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not send to canvas', 'error'); }
  };

  const removePdf = async () => {
    if (!(await confirmDialog(`Remove “${pdf.name}” and its annotations from this page?`, { danger: true, confirmLabel: 'Remove' }))) return;
    await db.annotations.where('pdfId').equals(pdf.id).delete();
    await db.pdfs.delete(pdf.id);
    forgetPdf(pdf.id);
  };

  const TOOLS: { id: PdfTool; icon: typeof Pen; label: string }[] = [
    { id: 'select', icon: MousePointer2, label: 'Select text / annotations' },
    { id: 'highlight', icon: Highlighter, label: 'Highlight text' },
    { id: 'underline', icon: Underline, label: 'Underline text' },
    { id: 'strike', icon: Strikethrough, label: 'Strike through text' },
    { id: 'ink', icon: Pen, label: 'Ink pen' },
    { id: 'sticky', icon: StickyNote, label: 'Sticky note' },
    { id: 'eraser', icon: Eraser, label: 'Erase annotation (click)' },
  ];

  if (error) return <div className="p-8 text-danger">Could not open PDF: {error}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col" onPointerDown={() => useUndoScopes.getState().activate(scopeId)}>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line bg-bg-1 px-2 py-1" data-testid="pdf-toolbar">
        {TOOLS.map((t) => (
          <button key={t.id} title={t.label} data-testid={`pdf-tool-${t.id}`} onClick={() => tools.set({ tool: t.id })}
            className={clsx('flex h-7 w-7 items-center justify-center rounded', tools.tool === t.id ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3')}><t.icon size={15} /></button>
        ))}
        <button title="Annotation colour" onClick={(e) => setColorAnchor(e.currentTarget)} className="ml-1 flex h-7 w-7 items-center justify-center rounded hover:bg-bg-3">
          <span className="h-4 w-4 rounded-full border border-line" style={{ background: tools.color }} />
        </button>
        <div className="mx-1 h-5 w-px bg-line" />
        <button title="Zoom out" className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-3" onClick={() => setScale(scale / 1.2)}><ZoomOut size={15} /></button>
        <span className="w-12 text-center tabular-nums text-fg-muted">{Math.round(scale * 100)}%</span>
        <button title="Zoom in" className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-3" onClick={() => setScale(scale * 1.2)}><ZoomIn size={15} /></button>
        <button title="Fit width" className={clsx('flex h-7 w-7 items-center justify-center rounded hover:bg-bg-3', fitWidth ? 'text-accent' : 'text-fg-muted')} onClick={() => setFitWidth(true)}><Maximize2 size={14} /></button>
        <div className="flex-1" />
        <span className="mr-2 truncate text-fg-faint">{pdf.name} · {pdf.pageCount} pages</span>
        <Button className="h-7 text-[12px]" onClick={() => setExportOpen('export')} data-testid="pdf-export"><FileDown size={13} />Export annotated</Button>
        <Button className="h-7 text-[12px]" onClick={() => setExportOpen('extract')} data-testid="pdf-extract"><Scissors size={13} />Extract pages</Button>
        <button title="Place pages on a new canvas" className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-3" onClick={() => void sendToCanvas()}><Shapes size={14} /></button>
        <button title="Add another PDF" className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-3" onClick={onAdd}><FilePlus2 size={14} /></button>
        <button title="Remove this PDF" className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-3 hover:text-danger" onClick={() => void removePdf()}><Trash2 size={14} /></button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-bg-2" data-testid="pdf-scroller">
        {!doc ? <div className="p-8 text-fg-faint">Opening PDF…</div> : (
          <div className="flex flex-col items-center gap-4 py-4">
            {sizes.map((s, i) => <PdfPageView key={i} doc={doc} index={i} size={s} scale={scale} ann={ann} root={scroller} />)}
          </div>
        )}
      </div>
      {colorAnchor && (
        <Popover anchor={colorAnchor} onClose={() => setColorAnchor(null)}>
          <div className="flex w-56 flex-col gap-2 p-3">
            <div className="flex flex-wrap gap-1">{ANNOTATION_COLORS.map((c) => <button key={c} onClick={() => tools.set({ color: c })} className={clsx('h-6 w-6 rounded border border-line', tools.color === c && 'ring-2 ring-accent')} style={{ background: c }} />)}</div>
            <Slider label="Ink width" value={tools.inkWidth} min={0.5} max={12} step={0.5} onChange={(v) => tools.set({ inkWidth: v })} />
          </div>
        </Popover>
      )}
      {exportOpen && doc && <ExportDialog pdf={pdf} mode={exportOpen} pageCount={doc.numPages} ann={ann} onClose={() => setExportOpen(null)} />}
    </div>
  );
}

function ExportDialog({ pdf, mode, pageCount, ann, onClose }: { pdf: PdfFile; mode: 'export' | 'extract'; pageCount: number; ann: PdfAnnotations; onClose: () => void }) {
  const items = useStore(ann.store, (s) => s.items);
  const annotated = useMemo(() => new Set(Object.values(items).map((a) => a.pageIndex)), [items]);
  const [sel, setSel] = useState<Set<number>>(() => new Set(mode === 'extract' ? Array.from(annotated) : Array.from({ length: pageCount }, (_, i) => i)));
  const [flatten, setFlatten] = useState(true);
  const [busy, setBusy] = useState(false);
  const base = pdf.name.replace(/\.pdf$/i, '');
  const run = async () => {
    setBusy(true);
    try {
      const pages = Array.from(sel).sort((a, b) => a - b);
      if (!pages.length) { toast('Select at least one page', 'error'); return; }
      const all = pages.length === pageCount;
      const bytes = await exportAnnotatedPdf(pdf.id, { pages: all && mode === 'export' ? undefined : pages, flatten });
      const name = mode === 'export' ? `${base}-annotated.pdf` : `${base}-pages-${pages.map((p) => p + 1).join('_').slice(0, 40)}.pdf`;
      const saved = await saveFile(bytes, name, [{ name: 'PDF', extensions: ['pdf'] }]);
      if (saved) { toast(`Saved ${saved}`, 'ok'); onClose(); }
    } catch (e) { toast(e instanceof Error ? e.message : 'Export failed', 'error'); }
    finally { setBusy(false); }
  };
  const toggle = (i: number) => setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <Modal title={mode === 'export' ? 'Export annotated PDF' : 'Extract pages'} onClose={onClose} width={460} testId="pdf-export-dialog"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void run()} data-testid="pdf-export-run">{busy ? 'Working…' : mode === 'export' ? 'Export PDF' : `Extract ${sel.size} page(s)`}</Button></>}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2"><input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />Burn annotations into the pages (flatten)</label>
        <div className="flex gap-2 text-[12px]">
          <button className="text-accent" onClick={() => setSel(new Set(Array.from({ length: pageCount }, (_, i) => i)))}>All</button>
          <button className="text-accent" onClick={() => setSel(new Set(annotated))}>Annotated only ({annotated.size})</button>
          <button className="text-accent" onClick={() => setSel(new Set())}>None</button>
        </div>
        <div className="grid max-h-60 grid-cols-6 gap-1 overflow-y-auto">
          {Array.from({ length: pageCount }, (_, i) => (
            <button key={i} onClick={() => toggle(i)} className={clsx('relative rounded border py-1.5 text-center', sel.has(i) ? 'border-accent bg-accent/15' : 'border-line hover:bg-bg-3')}>
              {i + 1}{annotated.has(i) && <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-warn" />}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function PdfPageView({ doc, index, size, scale, ann, root }: { doc: PDFDocumentProxy; index: number; size: { w: number; h: number }; scale: number; ann: PdfAnnotations; root: React.RefObject<HTMLDivElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const items = useStore(ann.store, (s) => s.items);
  const selectedId = useStore(ann.store, (s) => s.selected);
  const anns = useMemo(() => Object.values(items).filter((a) => a.pageIndex === index).sort((a, b) => a.createdAt - b.createdAt), [items, index]);
  const tools = usePdfTools();
  const [live, setLive] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const W = size.w * scale, H = size.h * scale;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setVisible(es.some((e) => e.isIntersecting)), { root: root.current, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => { if (visible && !page) void doc.getPage(index + 1).then(setPage); }, [visible, page, doc, index]);

  // Render canvas + text layer when visible / scale changes.
  useEffect(() => {
    if (!visible || !page || !canvasRef.current || !textRef.current) return;
    let cancelled = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = canvasRef.current;
    void renderPageToCanvas(page, c, scale * dpr).then(async () => {
      if (cancelled || !textRef.current) return;
      const vp = page.getViewport({ scale });
      textRef.current.replaceChildren();
      textRef.current.style.setProperty('--total-scale-factor', String(scale));
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport: vp });
      await tl.render();
    }).catch((e) => console.error('PDF render failed', e));
    return () => { cancelled = true; };
  }, [visible, page, scale]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onMouseUp = () => {
    const t = usePdfTools.getState();
    if (!['highlight', 'underline', 'strike'].includes(t.tool)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !textRef.current) return;
    const range = sel.getRangeAt(0);
    if (!textRef.current.contains(range.commonAncestorContainer)) return;
    const r = box.current!.getBoundingClientRect();
    const rects = mergeLineRects(Array.from(range.getClientRects()).map((cr) => ({ x: (cr.left - r.left) / scale, y: (cr.top - r.top) / scale, w: cr.width / scale, h: cr.height / scale })));
    const text = sel.toString();
    sel.removeAllRanges();
    if (!rects.length) return;
    const a = ann.create({ pageIndex: index, type: t.tool as Annotation['type'], color: t.color, rects, text });
    void ann.commit(t.tool === 'highlight' ? 'Highlight' : t.tool === 'underline' ? 'Underline' : 'Strikethrough', [a]);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const t = usePdfTools.getState();
    const p = local(e);
    if (t.tool === 'ink') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setLive([p.x, p.y, e.pointerType === 'pen' ? e.pressure : 0.5]);
      return;
    }
    if (t.tool === 'sticky') {
      e.preventDefault();
      const a = ann.create({ pageIndex: index, type: 'sticky', color: t.color, x: p.x, y: p.y, text: '' });
      void ann.commit('Sticky note', [a]).then(() => {
        const el = box.current?.querySelector<HTMLElement>(`[data-ann="${a.id}"]`);
        if (el) setEditing({ id: a.id, anchor: el });
      });
      return;
    }
    if (t.tool === 'eraser') {
      const hit = hitTest(p);
      if (hit) void ann.commit('Erase annotation', [], [hit.id]);
      return;
    }
    if (t.tool === 'select') {
      const hit = hitTest(p);
      ann.store.setState({ selected: hit?.id ?? null });
    }
  };

  const hitTest = (p: { x: number; y: number }): Annotation | null => {
    for (let i = anns.length - 1; i >= 0; i--) {
      const a = anns[i];
      if (a.rects?.some((r) => p.x >= r[0] && p.x <= r[0] + r[2] && p.y >= r[1] - 2 && p.y <= r[1] + r[3] + 2)) return a;
      if (a.type === 'sticky' && a.x !== undefined && a.y !== undefined && Math.abs(p.x - a.x - 9) < 12 && Math.abs(p.y - a.y - 9) < 12) return a;
      if (a.type === 'ink' && a.points) {
        const tol = Math.max(4, (a.width ?? 2) * 1.5);
        for (let k = 0; k < a.points.length; k += 3) if (Math.hypot(a.points[k] - p.x, a.points[k + 1] - p.y) < tol) return a;
      }
    }
    return null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!live) return;
    const evs = (e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) as PointerEvent[];
    const next = live.slice();
    for (const ev of evs) { const p = local(ev); next.push(p.x, p.y, ev.pointerType === 'pen' ? ev.pressure : 0.5); }
    setLive(next);
  };
  const onPointerUp = () => {
    if (!live) return;
    const pts = live;
    setLive(null);
    if (pts.length < 6) return;
    const t = usePdfTools.getState();
    void ann.commit('Ink', [ann.create({ pageIndex: index, type: 'ink', color: t.color, points: pts, width: t.inkWidth })]);
  };

  const inkPath = (pts: number[], width: number) => {
    // perfect-freehand expects [x,y,p,t] quads in our ink helper; adapt from triples.
    const quads: number[] = [];
    for (let i = 0; i < pts.length; i += 3) quads.push(pts[i], pts[i + 1], pts[i + 2], 0);
    return outlineToSvgPath(outlineFor(quads, 'pen', width));
  };

  const interactive = ['ink', 'sticky', 'eraser'].includes(tools.tool);
  const editingAnn = editing ? items[editing.id] : null;
  const selectedAnn = selectedId ? anns.find((a) => a.id === selectedId) : null;

  return (
    <div ref={box} data-pdf-page={index} className={clsx('relative shrink-0 bg-white shadow-lg', `pdf-tool-${tools.tool}`)} style={{ width: W, height: H }}
      onMouseUp={onMouseUp} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} data-testid="pdf-page">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* Highlights sit under the text layer so text stays selectable. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${size.w} ${size.h}`} style={{ mixBlendMode: 'multiply' }}>
        {anns.filter((a) => a.type === 'highlight').map((a) => a.rects?.map((r, k) => (
          <rect key={`${a.id}-${k}`} x={r[0]} y={r[1]} width={r[2]} height={r[3]} fill={a.color} opacity={0.45} rx={1} data-testid="pdf-highlight"
            stroke={a.id === selectedId ? '#2563eb' : 'none'} strokeWidth={a.id === selectedId ? 1 : 0} />
        )))}
      </svg>
      <div ref={textRef} className={clsx('textLayer', interactive && 'pointer-events-none')} />
      <svg className={clsx('absolute inset-0 h-full w-full', !interactive && 'pointer-events-none')} viewBox={`0 0 ${size.w} ${size.h}`}>
        {anns.filter((a) => a.type === 'underline' || a.type === 'strike').map((a) => a.rects?.map((r, k) => {
          const y = a.type === 'underline' ? r[1] + r[3] - 0.5 : r[1] + r[3] * 0.55;
          return <line key={`${a.id}-${k}`} x1={r[0]} x2={r[0] + r[2]} y1={y} y2={y} stroke={a.color} strokeWidth={Math.max(0.8, r[3] * 0.08)} data-testid={`pdf-${a.type}`} />;
        }))}
        {anns.filter((a) => a.type === 'ink' && a.points).map((a) => <path key={a.id} d={inkPath(a.points as number[], a.width ?? 2)} fill={a.color} data-testid="pdf-ink" opacity={a.id === selectedId ? 0.7 : 1} />)}
        {live && <path d={inkPath(live, tools.inkWidth)} fill={tools.color} />}
      </svg>
      {anns.filter((a) => a.type === 'sticky').map((a) => (
        <button key={a.id} data-ann={a.id} data-testid="pdf-sticky" title={a.text || 'Empty note'} className="absolute flex items-center justify-center rounded-sm shadow"
          style={{ left: (a.x ?? 0) * scale, top: (a.y ?? 0) * scale, width: 18, height: 18, background: a.color, border: '1px solid rgba(0,0,0,.35)' }}
          onPointerDown={(e) => { if (usePdfTools.getState().tool !== 'eraser') { e.stopPropagation(); setEditing({ id: a.id, anchor: e.currentTarget }); } }}>
          <StickyNote size={11} color="#111" />
        </button>
      ))}
      {editing && editingAnn && (
        <Popover anchor={editing.anchor} onClose={() => setEditing(null)}>
          <div className="flex w-64 flex-col gap-2 p-2">
            <textarea autoFocus rows={4} defaultValue={editingAnn.text ?? ''} placeholder="Note…" data-testid="pdf-sticky-text"
              className="w-full resize-none rounded border border-line bg-bg-2 p-1.5 outline-none focus:border-accent"
              onBlur={(e) => { if (e.target.value !== (editingAnn.text ?? '')) void ann.commit('Edit note', [{ ...editingAnn, text: e.target.value }]); }} />
            <div className="flex justify-between">
              <button className="flex items-center gap-1 text-danger" onClick={() => { void ann.commit('Delete note', [], [editingAnn.id]); setEditing(null); }}><Trash2 size={13} />Delete</button>
              <button className="text-fg-muted" onClick={() => setEditing(null)}><X size={14} /></button>
            </div>
          </div>
        </Popover>
      )}
      {selectedAnn && selectedAnn.type !== 'sticky' && tools.tool === 'select' && (() => {
        const r = selectedAnn.rects?.[0] ?? (selectedAnn.points ? [selectedAnn.points[0], selectedAnn.points[1], 0, 0] : [0, 0, 0, 0]);
        return (
          <div className="absolute z-10 flex items-center gap-1 rounded-md border border-line bg-bg-1 p-1 shadow-xl" style={{ left: r[0] * scale, top: Math.max(0, r[1] * scale - 36) }} onPointerDown={(e) => e.stopPropagation()} data-testid="pdf-ann-bar">
            {ANNOTATION_COLORS.slice(0, 6).map((c) => <button key={c} className="h-5 w-5 rounded-full border border-line" style={{ background: c }} onClick={() => void ann.commit('Recolor annotation', [{ ...selectedAnn, color: c }])} />)}
            {selectedAnn.text && <button title="Copy text" className="rounded p-1 text-fg-muted hover:bg-bg-3" onClick={() => void navigator.clipboard.writeText(selectedAnn.text ?? '').then(() => toast('Copied', 'ok'))}><Copy size={13} /></button>}
            <button title="Delete" className="rounded p-1 text-fg-muted hover:bg-bg-3 hover:text-danger" onClick={() => void ann.commit('Delete annotation', [], [selectedAnn.id])} data-testid="pdf-ann-delete"><Trash2 size={13} /></button>
          </div>
        );
      })()}
      <div className="pointer-events-none absolute -bottom-5 left-0 text-[10px] text-fg-faint">{index + 1}</div>
    </div>
  );
}
