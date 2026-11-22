import { useState } from 'react';
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileDown, FileText, Image, FileCode2, Archive, Layers, FileArchive, FileUp, BookOpen, Braces } from 'lucide-react';
import { registerCommands } from '@/commands/registry';
import { registerGlobalOverlay } from '@/layout/overlays';
import { Modal, Button } from '@/ui/Modal';
import { db } from '@/db/schema';
import { useWorkspace } from '@/store/workspace';
import { activeTab } from '@/store/tabs';
import { toast } from '@/store/status';
import { saveFile, openFile, isDesktop } from '@/platform/fileio';
import { usePaintStudio } from '@/paint/studio/store';
import { encodeCanvas } from '@/lib/encode';
import { exportWorkspaceArchive, exportWorkspaceJson, importWorkspaceArchive } from './workspace';
import { pageToMarkdown, notebookToMarkdownZip } from './pageExport';
import { canvasToSvg, canvasToPng } from './canvasExport';
import { exportOra, exportPsd, exportLayersZip } from './paintExport';
import { exportAnnotatedPdf } from '@/pdf/export';

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';

async function run(label: string, fn: () => Promise<string | null>): Promise<void> {
  try {
    toast(`${label}…`);
    const saved = await fn();
    if (saved) toast(`Saved ${saved}`, 'ok');
  } catch (e) { toast(`${label} failed: ${e instanceof Error ? e.message : e}`, 'error'); }
}

export async function exportWorkspace(kind: 'ilovenotes' | 'zip' | 'json' = 'ilovenotes'): Promise<void> {
  const wsId = useWorkspace.getState().workspaceId;
  if (!wsId) return;
  const ws = await db.workspaces.get(wsId);
  await run('Exporting workspace', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'json') return saveFile(await exportWorkspaceJson(wsId), `${safe(ws?.name ?? 'workspace')}-${stamp}.json`, [{ name: 'Workspace JSON', extensions: ['json'] }]);
    return saveFile(await exportWorkspaceArchive(wsId), `${safe(ws?.name ?? 'workspace')}-${stamp}.${kind}`, [{ name: kind === 'zip' ? 'ZIP archive' : 'ILOVENOTES workspace', extensions: [kind] }]);
  });
}

export async function importWorkspaceBytes(data: Uint8Array): Promise<void> {
  try {
    const res = await importWorkspaceArchive(data);
    await useWorkspace.getState().setWorkspace(res.workspaceId);
    toast(`Imported workspace “${res.name}” (${res.pages} pages)`, 'ok');
  } catch (e) { toast(`Import failed: ${e instanceof Error ? e.message : e}`, 'error'); }
}

export async function importWorkspace(): Promise<void> {
  const f = await openFile({ filters: [{ name: 'ILOVENOTES workspace', extensions: ['ilovenotes', 'zip', 'json'] }] });
  if (f) await importWorkspaceBytes(f.data);
}

interface ExportUi { open: boolean; set(v: boolean): void }
export const useExportDialog = create<ExportUi>()((set) => ({ open: false, set: (open) => set({ open }) }));

function Item({ icon, title, desc, onClick, testId }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; testId?: string }) {
  return (
    <button onClick={onClick} data-testid={testId} className="flex items-start gap-2.5 rounded-md border border-line p-2 text-left hover:border-accent hover:bg-bg-2">
      <span className="mt-0.5 text-accent">{icon}</span>
      <span><span className="block font-medium">{title}</span><span className="block text-[11px] text-fg-muted">{desc}</span></span>
    </button>
  );
}

function ExportDialog() {
  const { open, set } = useExportDialog();
  const tab = activeTab();
  const pageId = tab?.kind === 'page' ? tab.pageId ?? null : null;
  const node = useLiveQuery(() => (pageId ? db.nodes.get(pageId) : undefined), [pageId]);
  const pdf = useLiveQuery(() => (pageId ? db.pdfs.where('pageId').equals(pageId).first() : undefined), [pageId]);
  const paintDoc = tab?.kind === 'paint' ? usePaintStudio.getState().doc : null;
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const go = (fn: () => Promise<void>) => async () => { setBusy(true); try { await fn(); set(false); } finally { setBusy(false); } };
  const title = safe(node?.title ?? paintDoc?.meta.name ?? 'export');
  return (
    <Modal title="Export" onClose={() => set(false)} width={520} testId="export-dialog" footer={<Button onClick={() => set(false)} disabled={busy}>Close</Button>}>
      <div className="flex flex-col gap-3">
        {node && (
          <section>
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-fg-faint uppercase">This page — {node.title}</div>
            <div className="grid grid-cols-2 gap-1.5">
              <Item icon={<FileText size={15} />} title="Markdown (.md)" desc="Text, tables, math, links; sketches inlined" testId="export-md"
                onClick={go(() => run('Exporting Markdown', async () => saveFile(await pageToMarkdown(node), `${title}.md`, [{ name: 'Markdown', extensions: ['md'] }])))} />
              {(node.mode === 'canvas' || node.mode === 'hybrid') && <>
                <Item icon={<FileCode2 size={15} />} title="SVG (vector)" desc="Shapes, ink, connectors, images" testId="export-svg"
                  onClick={go(() => run('Exporting SVG', async () => saveFile((await canvasToSvg(node.id, { background: '#ffffff' })).svg, `${title}.svg`, [{ name: 'SVG image', extensions: ['svg'] }])))} />
                <Item icon={<Image size={15} />} title="PNG (2×)" desc="High-resolution raster of the canvas" testId="export-png"
                  onClick={go(() => run('Exporting PNG', async () => saveFile(await canvasToPng(node.id, 2), `${title}.png`, [{ name: 'PNG image', extensions: ['png'] }])))} />
              </>}
              {pdf && <Item icon={<FileDown size={15} />} title="Annotated PDF" desc="Highlights, ink & notes flattened" testId="export-pdf"
                onClick={go(() => run('Exporting PDF', async () => saveFile(await exportAnnotatedPdf(pdf.id), `${safe(pdf.name.replace(/\.pdf$/i, ''))}-annotated.pdf`, [{ name: 'PDF', extensions: ['pdf'] }])))} />}
              <Item icon={<BookOpen size={15} />} title="Notebook as Markdown ZIP" desc="Every page of this notebook, folders kept" testId="export-notebook-md"
                onClick={go(() => run('Exporting notebook', async () => { const nb = await db.notebooks.get(node.notebookId); return saveFile(await notebookToMarkdownZip(node.notebookId), `${safe(nb?.name ?? 'notebook')}-markdown.zip`, [{ name: 'ZIP archive', extensions: ['zip'] }]); }))} />
            </div>
          </section>
        )}
        {paintDoc && (
          <section>
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-fg-faint uppercase">Painting — {paintDoc.meta.name}</div>
            <div className="grid grid-cols-2 gap-1.5">
              <Item icon={<Image size={15} />} title="PNG (flattened)" desc="Merged image" testId="export-paint-png"
                onClick={go(() => run('Exporting PNG', async () => saveFile(await encodeCanvas(paintDoc.composite()), `${title}.png`, [{ name: 'PNG image', extensions: ['png'] }])))} />
              <Item icon={<Layers size={15} />} title="OpenRaster (.ora)" desc="Layers, blend modes & opacity (Krita, GIMP, MyPaint)" testId="export-ora"
                onClick={go(() => run('Exporting ORA', async () => saveFile(exportOra(paintDoc), `${title}.ora`, [{ name: 'OpenRaster', extensions: ['ora'] }])))} />
              <Item icon={<Layers size={15} />} title="Photoshop (.psd)" desc="Layers, groups, masks, clipping, blend modes" testId="export-psd"
                onClick={go(() => run('Exporting PSD', async () => saveFile(exportPsd(paintDoc), `${title}.psd`, [{ name: 'Photoshop document', extensions: ['psd'] }])))} />
              <Item icon={<FileArchive size={15} />} title="Layer PNGs (.zip)" desc="One PNG per layer + merged + layer list" testId="export-layers-zip"
                onClick={go(() => run('Exporting layers', async () => saveFile(exportLayersZip(paintDoc), `${title}-layers.zip`, [{ name: 'ZIP archive', extensions: ['zip'] }])))} />
            </div>
          </section>
        )}
        <section>
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-fg-faint uppercase">Whole workspace</div>
          <div className="grid grid-cols-2 gap-1.5">
            <Item icon={<Archive size={15} />} title="Workspace (.ilovenotes)" desc="Complete backup: pages, canvases, paintings, PDFs, audio" testId="export-workspace" onClick={go(() => exportWorkspace('ilovenotes'))} />
            <Item icon={<FileArchive size={15} />} title="Workspace (.zip)" desc="Same archive with a .zip extension" onClick={go(() => exportWorkspace('zip'))} />
            <Item icon={<Braces size={15} />} title="Workspace (.json)" desc="Single JSON file, assets base64-encoded" onClick={go(() => exportWorkspace('json'))} />
            <Item icon={<FileUp size={15} />} title="Import workspace…" desc=".ilovenotes, .zip or .json — imported as a new workspace" testId="import-workspace" onClick={go(importWorkspace)} />
          </div>
        </section>
      </div>
    </Modal>
  );
}
registerGlobalOverlay('export-dialog', ExportDialog);

registerCommands([
  { id: 'export.open', title: 'Export…', category: 'File', shortcut: 'Mod+Shift+E', allowInInput: true, run: () => useExportDialog.getState().set(true) },
  { id: 'export.workspace', title: 'Export workspace (.ilovenotes)', category: 'File', run: () => exportWorkspace('ilovenotes') },
  { id: 'export.workspaceJson', title: 'Export workspace as JSON', category: 'File', run: () => exportWorkspace('json') },
  { id: 'import.workspace', title: 'Import workspace…', category: 'File', shortcut: 'Mod+Shift+O', allowInInput: true, run: () => importWorkspace() },
  {
    id: 'export.pageMarkdown', title: 'Export page as Markdown', category: 'File', when: () => activeTab()?.kind === 'page',
    run: async () => { const id = activeTab()?.pageId; const n = id ? await db.nodes.get(id) : undefined; if (n) await run('Exporting Markdown', async () => saveFile(await pageToMarkdown(n), `${safe(n.title)}.md`, [{ name: 'Markdown', extensions: ['md'] }])); },
  },
]);

/** Desktop: open .ilovenotes files passed on the command line / double-clicked in the OS. */
if (isDesktop()) {
  const consume = async () => {
    const f = await window.ilnNative!.consumeOpenPath();
    if (f) await importWorkspaceBytes(new Uint8Array(f.data));
  };
  window.setTimeout(() => void consume(), 1500);
  window.ilnNative!.onFileOpened(() => void consume());
}


