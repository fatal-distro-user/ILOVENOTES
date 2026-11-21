import { useEffect, useRef, useState } from 'react';
import { FileText, ImagePlus, LayoutGrid, PenTool, Shapes, Star, Trash2, Undo2, X } from 'lucide-react';
import clsx from 'clsx';
import { useAncestors, useNode, useNotebooks } from '@/db/hooks';
import * as repo from '@/db/repo';
import type { PageMode } from '@/db/types';
import { useTabs } from '@/store/tabs';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/status';
import { Popover } from '@/ui/Popover';
import { EmojiPicker } from '@/ui/EmojiPicker';
import { Segmented } from '@/ui/Segmented';
import { IconButton } from '@/ui/IconButton';
import { Button } from '@/ui/Modal';
import { registerTabView, getPageBody, type TabViewProps } from './registry';

const COVERS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #232526 0%, #414345 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
];

const MODES: { value: PageMode; label: string; icon: React.ReactNode }[] = [
  { value: 'document', label: 'Document', icon: <FileText size={12} /> },
  { value: 'canvas', label: 'Canvas', icon: <Shapes size={12} /> },
  { value: 'pdf', label: 'PDF', icon: <PenTool size={12} /> },
  { value: 'hybrid', label: 'Hybrid', icon: <LayoutGrid size={12} /> },
];

/** Read an image file, downscale to at most 1600px wide and return a JPEG data URL. */
function imageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = c.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

const coverStyle = (cover: string): React.CSSProperties =>
  cover.startsWith('data:') ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: cover };

function Breadcrumb({ pageId, notebookId, paneId }: { pageId: string; notebookId: string; paneId: string }) {
  const ws = useWorkspace((s) => s.workspaceId);
  const nbs = useNotebooks(ws);
  const nb = nbs.find((n) => n.id === notebookId);
  const ancestors = useAncestors(pageId);
  const node = useNode(pageId);
  const crumb = 'max-w-[160px] truncate rounded px-1 hover:bg-bg-3 hover:text-fg';
  return (
    <nav className="flex min-w-0 items-center gap-0.5 text-[12px] text-fg-muted" aria-label="Breadcrumb" data-testid="breadcrumb">
      {nb && <button className={crumb} onClick={() => { useWorkspace.getState().setNotebook(nb.id); useWorkspace.getState().setExpanded(nb.id, true); }}>{nb.icon} {nb.name}</button>}
      {ancestors.map((a) => (
        <span key={a.id} className="flex items-center gap-0.5">
          <span className="text-fg-faint">›</span>
          {a.kind === 'page'
            ? <button className={crumb} onClick={() => useTabs.getState().openPage(a.id, a.title, { paneId })}>{a.icon} {a.title}</button>
            : <button className={crumb} onClick={() => useWorkspace.getState().setExpanded(a.id, true)}>{a.icon} {a.title}</button>}
        </span>
      ))}
      <span className="text-fg-faint">›</span>
      <span className="max-w-[200px] truncate px-1 text-fg">{node?.title}</span>
    </nav>
  );
}

function PageTabView({ tab, paneId, active }: TabViewProps) {
  const pageId = tab.pageId ?? null;
  const liveNode = useNode(pageId);
  // useLiveQuery keeps returning the previous result while a new pageId loads; never act on a stale node.
  const node = liveNode && liveNode.id === pageId ? liveNode : undefined;
  const [title, setTitle] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const [coverAnchor, setCoverAnchor] = useState<HTMLElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (pageId) void repo.touchOpened(pageId); }, [pageId]);
  useEffect(() => {
    if (node && document.activeElement !== titleRef.current) setTitle(node.title);
  }, [node?.id, node?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (node && node.title !== tab.title && document.activeElement !== titleRef.current) useTabs.getState().renamePage(node.id, node.title); }, [node?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  if (node === undefined && pageId) {
    // Either still loading or missing; useLiveQuery yields undefined for both, so confirm with a direct lookup.
    return <MissingPage pageId={pageId} />;
  }
  if (!node) return null;
  if (node.deletedAt) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-muted" data-testid="page-trashed">
        <Trash2 size={28} className="text-fg-faint" />
        <div>This page was moved to trash.</div>
        <Button variant="primary" data-testid="page-restore" onClick={() => void repo.restoreNode(node.id)}><Undo2 size={14} />Restore</Button>
      </div>
    );
  }

  const Body = getPageBody(node.mode);
  const commitTitle = (v: string) => {
    setTitle(v);
    const t = v.trim() || 'Untitled';
    void repo.updateNode(node.id, { title: t });
    useTabs.getState().renamePage(node.id, t);
  };
  const setCover = (cover: string) => { void repo.updateNode(node.id, { cover }); setCoverAnchor(null); };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-view" data-page-id={node.id}>
      {node.cover && (
        <div className="group relative h-28 shrink-0" style={coverStyle(node.cover)} data-testid="page-cover">
          <div className="absolute bottom-1.5 right-2 flex gap-1 opacity-0 group-hover:opacity-100">
            <Button className="h-6 bg-bg-1/90 text-[12px]" onClick={(e) => setCoverAnchor(e.currentTarget)}>Change cover</Button>
            <Button className="h-6 bg-bg-1/90 text-[12px]" onClick={() => setCover('')} data-testid="cover-remove">Remove cover</Button>
          </div>
        </div>
      )}
      <div className="shrink-0 border-b border-line bg-bg px-4 pb-2 pt-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <Breadcrumb pageId={node.id} notebookId={node.notebookId} paneId={paneId} />
          <div className="flex shrink-0 items-center gap-1">
            {!node.cover && <Button className="h-6 px-2 text-[12px]" onClick={(e) => setCoverAnchor(e.currentTarget)} data-testid="cover-add"><ImagePlus size={13} />Add cover</Button>}
            <IconButton title={node.starred ? 'Unstar' : 'Star'} active={!!node.starred} onClick={() => void repo.toggleStar(node.id)} data-testid="page-star"><Star size={14} className={node.starred ? 'fill-warn text-warn' : ''} /></IconButton>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            title="Change icon"
            data-testid="page-icon"
            onClick={(e) => setIconAnchor(e.currentTarget)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[28px] leading-none hover:bg-bg-2"
          >{node.icon || <span className="text-[13px] text-fg-faint">Icon</span>}</button>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => commitTitle(e.target.value)}
            onBlur={(e) => { if (!e.currentTarget.value.trim()) commitTitle('Untitled'); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            placeholder="Untitled"
            aria-label="Page title"
            data-testid="page-title"
            className="min-w-0 flex-1 bg-transparent text-[22px] font-semibold text-fg outline-none placeholder:text-fg-faint"
          />
          <Segmented value={node.mode} options={MODES} onChange={(m) => void repo.updateNode(node.id, { mode: m })} testId="mode-switch" />
        </div>
        {node.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 pl-12" data-testid="page-tags">
            {node.tags.map((t) => <span key={t} className="rounded-full bg-bg-3 px-2 text-[11.5px] text-fg-muted">#{t}</span>)}
          </div>
        )}
      </div>
      <div className={clsx('relative min-h-0 flex-1 overflow-hidden')} data-testid="page-body">
        {Body
          ? <Body key={node.mode} node={node} paneId={paneId} active={active} />
          : <div className="flex h-full items-center justify-center p-6 text-center text-fg-muted">The {node.mode} editor module isn’t loaded.</div>}
      </div>
      {iconAnchor && (
        <Popover anchor={iconAnchor} onClose={() => setIconAnchor(null)}>
          <EmojiPicker onPick={(e) => { void repo.updateNode(node.id, { icon: e }); setIconAnchor(null); }} onRemove={() => { void repo.updateNode(node.id, { icon: '' }); setIconAnchor(null); }} />
        </Popover>
      )}
      {coverAnchor && (
        <Popover anchor={coverAnchor} align="end" onClose={() => setCoverAnchor(null)} className="w-[260px] p-2">
          <div className="grid grid-cols-4 gap-1.5" data-testid="cover-presets">
            {COVERS.map((c, i) => <button key={c} aria-label={`Cover preset ${i + 1}`} onClick={() => setCover(c)} className="h-8 rounded border border-line" style={{ background: c }} />)}
          </div>
          <Button className="mt-2 w-full" onClick={() => fileRef.current?.click()}><ImagePlus size={14} />Upload image…</Button>
          {node.cover && <Button className="mt-1.5 w-full" onClick={() => setCover('')}><X size={14} />Remove cover</Button>}
        </Popover>
      )}
      <input
        ref={fileRef} type="file" accept="image/*" hidden data-testid="cover-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { setCover(await imageToDataUrl(f)); } catch (err) { toast(err instanceof Error ? err.message : 'Could not load image', 'error'); }
        }}
      />
    </div>
  );
}

function MissingPage({ pageId }: { pageId: string }) {
  const [state, setState] = useState<'checking' | 'missing'>('checking');
  useEffect(() => {
    let live = true;
    void repo.getNode(pageId).then((n) => { if (live && !n) setState('missing'); });
    return () => { live = false; };
  }, [pageId]);
  if (state === 'checking') return null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-muted" data-testid="page-missing">
      <Trash2 size={28} className="text-fg-faint" />
      <div>This page was moved to trash or no longer exists.</div>
    </div>
  );
}

registerTabView('page', PageTabView);
