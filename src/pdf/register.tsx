import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { FileText, Highlighter, Pen, StickyNote, Underline, Strikethrough } from 'lucide-react';
import { registerPageBody, type PageBodyProps } from '@/views/registry';
import { registerPanel } from '@/panels/registry';
import { registerObjectType, type ObjectViewProps } from '@/canvas/objects/registry';
import { registerCanvasPlugin } from '@/canvas/CanvasView';
import { registerCommands } from '@/commands/registry';
import { useActivePageId } from '@/editor/activeEditor';
import { activeTab } from '@/store/tabs';
import { toast } from '@/store/status';
import { db } from '@/db/schema';
import { activeScope } from '@/history/scopes';
import { peekCanvasDoc } from '@/canvas/doc';
import { openFiles } from '@/platform/fileio';
import { PdfView, useActivePdf, usePdfTools } from './PdfView';
import { pageImageUrl } from './pdfjs';
import { importPdf, pdfToCanvasObjects } from './importPdf';
import type { Annotation } from '@/db/types';

function PdfBody({ node, active }: PageBodyProps) { return <PdfView pageId={node.id} active={active} />; }
registerPageBody('pdf', PdfBody);

const ICON: Record<Annotation['type'], typeof Pen> = { highlight: Highlighter, ink: Pen, sticky: StickyNote, underline: Underline, strike: Strikethrough };

function AnnotationsPanel() {
  const { ann, scrollTo } = useActivePdf();
  const pageId = useActivePageId();
  const page = useStore(ann?.store ?? EMPTY, (s) => s.items);
  const [pdfPage, setPdfPage] = useState<string | null>(null);
  useEffect(() => { if (ann) void db.pdfs.get(ann.pdfId).then((p) => setPdfPage(p?.pageId ?? null)); }, [ann]);
  if (!ann || pdfPage !== pageId) return <div className="p-3 text-fg-faint">Open a PDF page to list its annotations.</div>;
  const list = Object.values(page).sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt);
  if (!list.length) return <div className="p-3 text-fg-faint">No annotations yet. Select text with the highlighter, draw ink or drop sticky notes.</div>;
  return (
    <div className="py-1" data-testid="annotations-panel">
      {list.map((a) => {
        const Icon = ICON[a.type];
        const y = a.rects?.[0]?.[1] ?? a.y ?? a.points?.[1] ?? 0;
        return (
          <button key={a.id} onClick={() => { scrollTo?.(a.pageIndex, y); ann.store.setState({ selected: a.id }); }} className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-bg-3" data-testid="annotation-item">
            <Icon size={13} className="mt-0.5 shrink-0" style={{ color: a.color }} />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2">{a.text || (a.type === 'ink' ? 'Ink drawing' : a.type === 'sticky' ? 'Empty note' : a.type)}</span>
              <span className="text-[10px] text-fg-faint">Page {a.pageIndex + 1}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
const EMPTY = createStore(() => ({ ready: true, items: {} as Record<string, Annotation>, selected: null as string | null }));

registerPanel({ id: 'pdf-annotations', title: 'Annotations', icon: FileText, defaultSide: 'right', component: AnnotationsPanel, defaultOrder: 30, when: () => activeTab()?.kind === 'page' });

/** A PDF page placed on the infinite canvas, rendered at a resolution matching the zoom. */
function PdfPageObject({ obj, zoom }: ObjectViewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const pdfId = String(obj.data.pdfId);
  const pageIndex = Number(obj.data.pageIndex);
  const scale = Math.min(4, Math.max(0.5, zoom * (obj.w / Math.max(1, Number(obj.data.baseW ?? obj.w))) * (window.devicePixelRatio || 1)));
  useEffect(() => {
    let alive = true;
    pageImageUrl(pdfId, pageIndex, scale).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [pdfId, pageIndex, scale]);
  return (
    <div className="h-full w-full bg-white shadow-md" data-testid="canvas-pdfpage">
      {url ? <img src={url} alt={`Page ${pageIndex + 1}`} draggable={false} className="pointer-events-none h-full w-full select-none" /> : <div className="flex h-full items-center justify-center text-[12px] text-neutral-500">Rendering page {pageIndex + 1}…</div>}
    </div>
  );
}
registerObjectType({ type: 'pdfpage', component: PdfPageObject, lockAspect: true, minSize: { w: 40, h: 40 }, toText: (o) => `${String(o.data.name ?? 'PDF')} p.${Number(o.data.pageIndex) + 1}` });

async function importPdfsToCanvas(canvasPageId: string, files: { name: string; data: Uint8Array }[], at: { x: number; y: number }) {
  const doc = peekCanvasDoc(canvasPageId);
  if (!doc) return;
  let x = at.x;
  for (const f of files) {
    try {
      const rec = await importPdf(canvasPageId, f.name, f.data);
      const objs = await pdfToCanvasObjects(canvasPageId, rec, { x, y: at.y }, doc.maxZ());
      await doc.addObjects(objs, `Import ${f.name}`);
      x += Math.max(...objs.map((o) => o.w)) + 48;
      toast(`Placed ${objs.length} page(s) from ${f.name}`, 'ok');
    } catch (e) { toast(`Could not import ${f.name}: ${e instanceof Error ? e.message : e}`, 'error'); }
  }
}

registerCanvasPlugin({
  onDropFiles: (ctx, files, world) => {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return false;
    void Promise.all(pdfs.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))).then((list) => importPdfsToCanvas(ctx.doc.pageId, list, world));
    return true;
  },
});

registerCommands([
  {
    id: 'canvas.importPdf', title: 'Canvas: Import PDF pages onto canvas', category: 'Canvas',
    when: () => !!activeScope()?.id.startsWith('canvas:'),
    run: async () => {
      const id = activeScope()?.id.slice('canvas:'.length);
      if (!id) return;
      const files = await openFiles({ multiple: true, filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
      const doc = peekCanvasDoc(id);
      const cam = doc?.state.camera;
      await importPdfsToCanvas(id, files, cam ? { x: cam.x + 80, y: cam.y + 80 } : { x: 0, y: 0 });
    },
  },
  { id: 'pdf.tool.highlight', title: 'PDF: Highlighter', category: 'PDF', run: () => usePdfTools.getState().set({ tool: 'highlight' }) },
  { id: 'pdf.tool.ink', title: 'PDF: Ink pen', category: 'PDF', run: () => usePdfTools.getState().set({ tool: 'ink' }) },
  { id: 'pdf.tool.sticky', title: 'PDF: Sticky note', category: 'PDF', run: () => usePdfTools.getState().set({ tool: 'sticky' }) },
  { id: 'pdf.tool.select', title: 'PDF: Select', category: 'PDF', run: () => usePdfTools.getState().set({ tool: 'select' }) },
]);
