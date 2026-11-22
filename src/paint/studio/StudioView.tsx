import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Download, Maximize2, Ruler } from 'lucide-react';
import type { TabViewProps } from '@/views/registry';
import { useTabs } from '@/store/tabs';
import { runCommand } from '@/commands/registry';
import { toast } from '@/store/status';
import { saveFile } from '@/platform/fileio';
import { encodeCanvas } from '@/lib/encode';
import { Modal, Button } from '@/ui/Modal';
import { acquirePaintDoc, releasePaintDoc, type PaintDocument } from '../engine/document';
import { PaintSurface, usePaintToolsList } from './PaintSurface';
import { usePaintStudio } from './store';
import { paintTool } from './tools';
import { useDocVersion } from './LayersPanel';
import { GuidesMenu } from '../geometry/guidesUi';
import { FiltersMenu, FilterDialogHost } from '../filters/FiltersMenu';
import { toggleAnimation, selectFrame, useAnim } from '../anim/Timeline';
import { animSettings } from '../anim/model';
import { useLayout } from '@/store/layout';
import { Film } from 'lucide-react';

export function PaintStudioView({ tab, active }: TabViewProps) {
  const docId = tab.params?.docId ?? '';
  const [doc, setDoc] = useState<PaintDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    acquirePaintDoc(docId).then((d) => { if (alive) setDoc(d); }).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; releasePaintDoc(docId); };
  }, [docId]);
  useEffect(() => { if (active && doc) usePaintStudio.getState().setDoc(doc); }, [active, doc]);
  useEffect(() => () => { if (doc && usePaintStudio.getState().doc === doc) usePaintStudio.getState().setDoc(null); }, [doc]);
  if (error) return <div className="p-8 text-danger">Could not open painting: {error}</div>;
  if (!doc) return <div className="p-8 text-fg-faint">Loading painting…</div>;
  return <Studio doc={doc} active={active} tabId={tab.id} />;
}

function Studio({ doc, active, tabId }: { doc: PaintDocument; active: boolean; tabId: string }) {
  const tools = usePaintToolsList();
  const studio = usePaintStudio();
  useDocVersion(doc);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [fit, setFit] = useState<(() => void) | null>(null);
  const current = paintTool(studio.tool);
  // Restore animation view (current frame + timeline) when the painting becomes active.
  useEffect(() => {
    if (!active) return;
    if (animSettings(doc).enabled) { selectFrame(doc, useAnim.getState().current); useLayout.getState().setBottomBar('timeline'); }
    else if (useLayout.getState().bottomBar === 'timeline') useLayout.getState().setBottomBar('none');
  }, [active, doc]);
  const Options = current?.Options;

  useEffect(() => {
    const name = doc.meta.name ?? 'Painting';
    for (const p of useTabs.getState().panes) for (const t of p.tabs) if (t.id === tabId && t.title !== name) useTabs.setState((s) => { const tt = s.panes.flatMap((x) => x.tabs).find((x) => x.id === tabId); if (tt) tt.title = name; });
  }, [doc.meta.name, tabId]);

  const exportPng = async () => {
    const c = doc.composite();
    const blob = await encodeCanvas(c);
    const saved = await saveFile(blob, `${doc.meta.name ?? 'painting'}.png`, [{ name: 'PNG image', extensions: ['png'] }]);
    if (saved) toast(`Saved ${saved}`, 'ok');
  };

  const groups = ['paint', 'retouch', 'fill', 'select', 'transform', 'guide', 'view'] as const;
  return (
    <div className="flex h-full flex-col" data-testid="paint-studio">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-bg-1 px-2">
        <input className="w-44 rounded bg-transparent px-1 font-semibold outline-none hover:bg-bg-2 focus:bg-bg-2" defaultValue={doc.meta.name ?? 'Painting'}
          onBlur={(e) => e.target.value.trim() && void doc.setName(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Painting name" />
        <div className="h-5 w-px bg-line" />
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto" data-testid="tool-options">{Options ? <Options doc={doc} /> : <span className="text-fg-faint">{current?.label}</span>}</div>
        {doc.editChannel === 'mask' && <span className="rounded bg-warn/20 px-1.5 text-[11px] text-warn">Editing mask</span>}
        <button className={clsx('flex h-7 items-center gap-1 rounded px-2 hover:bg-bg-3', animSettings(doc).enabled ? 'text-accent' : 'text-fg-muted')} onClick={() => toggleAnimation(doc)} title="Flipbook animation timeline" data-testid="anim-toggle"><Film size={13} />Animate</button>
        <FiltersMenu />
        <GuidesMenu doc={doc} />
        <button className="flex h-7 items-center gap-1 rounded px-2 text-fg-muted hover:bg-bg-3" onClick={() => fit?.()} title="Fit to view (Mod+0)"><Maximize2 size={13} /></button>
        <button className="flex h-7 items-center gap-1 rounded px-2 text-fg-muted hover:bg-bg-3" onClick={() => setResizeOpen(true)} title="Canvas size" data-testid="paint-resize"><Ruler size={13} />{doc.width}×{doc.height}</button>
        <button className="flex h-7 items-center gap-1 rounded px-2 text-fg-muted hover:bg-bg-3" onClick={() => void exportPng()} title="Export PNG" data-testid="paint-export-png"><Download size={13} />PNG</button>
        <button className="flex h-7 items-center gap-1 rounded px-2 text-fg-muted hover:bg-bg-3" onClick={() => void runCommand('export.open')} title="Export ORA / PSD / layers (Mod+Shift+E)" data-testid="paint-export"><Download size={13} />Export…</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line bg-bg-1 py-1" data-testid="paint-toolbar">
          {groups.map((g, gi) => {
            const items = tools.filter((t) => t.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="flex flex-col items-center gap-0.5">
                {gi > 0 && <div className="my-0.5 h-px w-6 bg-line" />}
                {items.map((t) => (
                  <button key={t.id} title={`${t.label}${t.key ? ` (${t.key.toUpperCase()})` : ''}`} data-testid={`paint-tool-${t.id}`} onClick={() => studio.setTool(t.id)}
                    className={clsx('flex h-8 w-8 items-center justify-center rounded-md', studio.tool === t.id ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3 hover:text-fg')}>
                    <t.icon size={16} />
                  </button>
                ))}
              </div>
            );
          })}
          <div className="mt-auto flex flex-col items-center gap-1 pb-1">
            <button className="relative h-9 w-9" title="Primary / secondary colour (X swaps)" onClick={() => studio.swapColors()} data-testid="paint-colors">
              <span className="absolute right-0 bottom-0 h-5 w-5 rounded border border-line" style={{ background: studio.secondary }} />
              <span className="absolute top-0 left-0 h-6 w-6 rounded border-2 border-bg-1 shadow" style={{ background: studio.color }} />
            </button>
          </div>
        </div>
        <div className="min-w-0 flex-1"><PaintSurface doc={doc} active={active} onCameraFit={(f) => setFit(() => f)} /></div>
      </div>
      {resizeOpen && <ResizeDialog doc={doc} onClose={() => setResizeOpen(false)} />}
      {active && <FilterDialogHost doc={doc} />}
    </div>
  );
}

function ResizeDialog({ doc, onClose }: { doc: PaintDocument; onClose: () => void }) {
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  const valid = w >= 1 && h >= 1 && w <= 8192 && h <= 8192;
  return (
    <Modal title="Canvas size" onClose={onClose} width={360}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} data-testid="paint-resize-apply" onClick={() => { doc.resizeCanvas(w, h, Math.round((w - doc.width) * anchor[0]), Math.round((h - doc.height) * anchor[1])); onClose(); }}>Apply</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col text-[11px] text-fg-muted">Width<input type="number" value={w} min={1} max={8192} onChange={(e) => setW(Number(e.target.value))} className="rounded border border-line bg-bg-2 px-2 py-1 text-fg" /></label>
          <label className="flex flex-1 flex-col text-[11px] text-fg-muted">Height<input type="number" value={h} min={1} max={8192} onChange={(e) => setH(Number(e.target.value))} className="rounded border border-line bg-bg-2 px-2 py-1 text-fg" /></label>
        </div>
        <div className="text-[11px] text-fg-muted">Anchor</div>
        <div className="grid w-24 grid-cols-3 gap-1">
          {[0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) => (
            <button key={`${ax}${ay}`} onClick={() => setAnchor([ax, ay])} className={clsx('h-6 rounded border', anchor[0] === ax && anchor[1] === ay ? 'border-accent bg-accent' : 'border-line bg-bg-2')} />
          )))}
        </div>
        {!valid && <div className="text-danger">Size must be between 1 and 8192 px.</div>}
      </div>
    </Modal>
  );
}
