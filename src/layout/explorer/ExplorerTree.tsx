import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, ExternalLink, FilePlus2, FolderPlus, Layers, MoreHorizontal, Palette, Pencil, Plus, Smile, Star, StarOff, Trash2, PanelRight, BookPlus } from 'lucide-react';
import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import { useChildren, useNotebooks } from '@/db/hooks';
import type { Notebook, TreeNode } from '@/db/types';
import { useWorkspace } from '@/store/workspace';
import { useTabs } from '@/store/tabs';
import { toast } from '@/store/status';
import { useContextMenu, type MenuItem } from '@/ui/ContextMenu';
import { Popover } from '@/ui/Popover';
import { EmojiPicker } from '@/ui/EmojiPicker';
import { ColorSwatches } from '@/ui/ColorSwatches';
import { promptDialog } from '@/ui/dialogs';
import { IconButton } from '@/ui/IconButton';
import { newNode, openNode } from '../actions';

const NODE_MIME = 'application/x-iln-node';
const NB_MIME = 'application/x-iln-notebook';
let dragNodeId: string | null = null;
let dragNotebookId: string | null = null;

type Zone = 'before' | 'after' | 'inside';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Move failed');

function InlineRename({ value, onCommit, onCancel }: { value: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (commit: boolean) => { if (done.current) return; done.current = true; if (commit && v.trim() && v.trim() !== value) onCommit(v.trim()); else onCancel(); };
  return (
    <input
      autoFocus
      value={v}
      data-testid="rename-input"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); }}
      onBlur={() => finish(true)}
      className="h-5 min-w-0 flex-1 rounded border border-accent bg-bg px-1 text-[13px] text-fg outline-none"
    />
  );
}

type PickerKind = 'icon' | 'color' | null;

function PickerPopover({ kind, anchor, icon, color, onIcon, onColor, onClose }: {
  kind: PickerKind; anchor: HTMLElement | null; icon: string; color: string;
  onIcon: (v: string) => void; onColor: (v: string) => void; onClose: () => void;
}) {
  if (!kind || !anchor) return null;
  return (
    <Popover anchor={anchor} onClose={onClose}>
      {kind === 'icon'
        ? <EmojiPicker onPick={(e) => { onIcon(e); onClose(); }} onRemove={icon ? () => { onIcon(''); onClose(); } : undefined} />
        : <ColorSwatches value={color} onChange={(c) => { onColor(c); onClose(); }} />}
    </Popover>
  );
}

async function trashNodeAndCloseTabs(node: TreeNode) {
  try {
    const ids = [node.id, ...(await repo.getDescendantIds(node.id))];
    await repo.trashNode(node.id);
    ids.forEach((id) => useTabs.getState().closePage(id));
    toast(`Moved "${node.title}" to trash`, 'info');
  } catch (e) { toast(errMsg(e), 'error'); }
}

async function performNodeMove(dragId: string, target: TreeNode, zone: Zone) {
  try {
    if (dragId === target.id) return;
    if (zone === 'inside') {
      await repo.moveNode(dragId, { notebookId: target.notebookId, parentId: target.id, beforeId: null });
      useWorkspace.getState().setExpanded(target.id, true);
    } else if (zone === 'before') {
      await repo.moveNode(dragId, { notebookId: target.notebookId, parentId: target.parentId, beforeId: target.id });
    } else {
      const sibs = (await repo.listChildren(target.notebookId, target.parentId)).filter((s) => s.id !== dragId);
      const i = sibs.findIndex((s) => s.id === target.id);
      await repo.moveNode(dragId, { notebookId: target.notebookId, parentId: target.parentId, beforeId: sibs[i + 1]?.id ?? null });
    }
  } catch (e) { toast(errMsg(e), 'error'); }
}

function NodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const expanded = useWorkspace((s) => !!s.expanded[node.id]);
  const active = useTabs((s) => {
    const p = s.panes.find((x) => x.id === s.focusedPaneId);
    return p?.tabs.find((t) => t.id === p.activeTabId)?.pageId === node.id;
  });
  const childCount = useLiveQuery(() => db.nodes.where('[notebookId+parentId]').equals([node.notebookId, node.id]).filter((n) => !n.deletedAt).count(), [node.notebookId, node.id], 0);
  const [renaming, setRenaming] = useState(false);
  const [zone, setZone] = useState<Zone | null>(null);
  const [picker, setPicker] = useState<PickerKind>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const { menu, show } = useContextMenu();
  const isContainer = node.kind !== 'page';
  const hasChildren = childCount > 0;
  const setExpanded = useWorkspace.getState().setExpanded;

  const toggle = () => setExpanded(node.id, !expanded);
  const commitTitle = (title: string) => { void repo.updateNode(node.id, { title }); useTabs.getState().renamePage(node.id, title); setRenaming(false); };

  const menuItems = (): MenuItem[] => [
    { label: 'New Page inside', icon: <FilePlus2 size={13} />, onClick: () => void newNode({ parentId: node.id }) },
    { label: 'New Sub-folder', icon: <FolderPlus size={13} />, onClick: () => void newNode({ parentId: node.id, kind: 'folder' }) },
    { label: 'New Section', icon: <Layers size={13} />, onClick: () => void newNode({ parentId: node.id, kind: 'section' }) },
    { separator: true },
    { label: 'Rename', icon: <Pencil size={13} />, shortcut: 'F2', onClick: () => setRenaming(true) },
    { label: 'Change icon', icon: <Smile size={13} />, onClick: () => setPicker('icon') },
    { label: 'Change color', icon: <Palette size={13} />, onClick: () => setPicker('color') },
    { label: node.starred ? 'Unstar' : 'Star', icon: node.starred ? <StarOff size={13} /> : <Star size={13} />, onClick: () => void repo.toggleStar(node.id) },
    { label: 'Duplicate', icon: <Copy size={13} />, onClick: () => void repo.duplicateNode(node.id).catch((e) => toast(errMsg(e), 'error')) },
    { separator: true },
    { label: 'Open in new tab', icon: <ExternalLink size={13} />, disabled: isContainer, onClick: () => openNode(node, { newTab: true }) },
    { label: 'Open to side', icon: <PanelRight size={13} />, disabled: isContainer, onClick: () => useTabs.getState().openToSide({ kind: 'page', pageId: node.id, title: node.title }) },
    { separator: true },
    { label: 'Move to trash', icon: <Trash2 size={13} />, danger: true, onClick: () => void trashNodeAndCloseTabs(node) },
  ];

  const onDragOver = (e: React.DragEvent) => {
    if (!dragNodeId || !e.dataTransfer.types.includes(NODE_MIME)) return;
    if (dragNodeId === node.id) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    setZone(f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'inside');
  };

  return (
    <div>
      <div
        ref={rowRef}
        role="treeitem"
        aria-expanded={isContainer || hasChildren ? expanded : undefined}
        tabIndex={0}
        draggable={!renaming}
        data-testid="tree-node"
        data-node-title={node.title}
        data-node-id={node.id}
        onDragStart={(e) => { dragNodeId = node.id; e.stopPropagation(); e.dataTransfer.setData(NODE_MIME, JSON.stringify({ id: node.id })); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { dragNodeId = null; setZone(null); }}
        onDragOver={onDragOver}
        onDragLeave={() => setZone(null)}
        onDrop={(e) => {
          const z = zone;
          setZone(null);
          if (!dragNodeId || !z) return;
          e.preventDefault();
          e.stopPropagation();
          const id = dragNodeId;
          dragNodeId = null;
          void performNodeMove(id, node, z);
        }}
        onClick={(e) => { if (isContainer) toggle(); else openNode(node, { newTab: e.ctrlKey || e.metaKey }); }}
        onAuxClick={(e) => { if (e.button === 1 && !isContainer) { e.preventDefault(); openNode(node, { newTab: true }); } }}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => show(e, menuItems())}
        onKeyDown={(e) => {
          if (renaming) return;
          if (e.key === 'F2') { e.preventDefault(); setRenaming(true); }
          else if (e.key === 'Enter') { if (isContainer) toggle(); else openNode(node); }
          else if (e.key === 'ArrowRight' && (isContainer || hasChildren)) setExpanded(node.id, true);
          else if (e.key === 'ArrowLeft') setExpanded(node.id, false);
        }}
        className={clsx(
          'group relative flex h-7 cursor-default select-none items-center gap-1 pr-1 text-[13px] outline-none focus-visible:bg-bg-3',
          active ? 'bg-accent/20 text-fg' : 'text-fg-muted hover:bg-bg-2 hover:text-fg',
          zone === 'inside' && 'bg-accent/25 ring-1 ring-inset ring-accent',
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        {node.color && <span className="absolute inset-y-0.5 left-0 w-[3px] rounded-r" style={{ background: node.color }} data-testid="node-color" />}
        {zone === 'before' && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent" />}
        {zone === 'after' && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
        <button
          tabIndex={-1}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-bg-3', !(isContainer || hasChildren) && 'invisible')}
        >{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
        <span className="w-4 shrink-0 text-center text-[13px] leading-none">{node.icon}</span>
        {renaming
          ? <InlineRename value={node.title} onCommit={commitTitle} onCancel={() => setRenaming(false)} />
          : <span className="min-w-0 flex-1 truncate" data-testid="node-title">{node.title || 'Untitled'}</span>}
        {!renaming && node.starred === 1 && <Star size={11} className="shrink-0 fill-warn text-warn" />}
        {!renaming && (
          <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <IconButton size="sm" title="New page inside" data-testid="node-add" onClick={(e) => { e.stopPropagation(); void newNode({ parentId: node.id }); }}><Plus size={13} /></IconButton>
            <IconButton size="sm" title="More actions" data-testid="node-more" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); show({ clientX: r.left, clientY: r.bottom, preventDefault() {}, stopPropagation() {} }, menuItems()); }}><MoreHorizontal size={13} /></IconButton>
          </span>
        )}
      </div>
      {expanded && <Children notebookId={node.notebookId} parentId={node.id} depth={depth + 1} />}
      {menu}
      <PickerPopover
        kind={picker} anchor={rowRef.current} icon={node.icon} color={node.color}
        onIcon={(v) => void repo.updateNode(node.id, { icon: v || (node.kind === 'page' ? '📄' : node.kind === 'folder' ? '📁' : '🗂️') })}
        onColor={(v) => void repo.updateNode(node.id, { color: v })}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}

function Children({ notebookId, parentId, depth }: { notebookId: string; parentId: string | null; depth: number }) {
  const kids = useChildren(notebookId, parentId);
  if (!kids.length) return <div className="h-6 text-[12px] italic leading-6 text-fg-faint" style={{ paddingLeft: depth * 12 + 28 }}>Empty</div>;
  return <div role="group">{kids.map((k) => <NodeRow key={k.id} node={k} depth={depth} />)}</div>;
}

function NotebookRow({ nb, siblings }: { nb: Notebook; siblings: Notebook[] }) {
  const expanded = useWorkspace((s) => s.expanded[nb.id] ?? true);
  const current = useWorkspace((s) => s.notebookId === nb.id);
  const [renaming, setRenaming] = useState(false);
  const [zone, setZone] = useState<'before' | 'after' | 'root' | null>(null);
  const [picker, setPicker] = useState<PickerKind>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const { menu, show } = useContextMenu();

  const toggle = () => useWorkspace.getState().setExpanded(nb.id, !expanded);
  const select = () => useWorkspace.getState().setNotebook(nb.id);

  const trash = async () => {
    await repo.trashNotebook(nb.id);
    const next = siblings.find((s) => s.id !== nb.id);
    if (current) useWorkspace.getState().setNotebook(next?.id ?? null);
    toast(`Moved notebook "${nb.name}" to trash`, 'info');
  };

  const items = (): MenuItem[] => [
    { label: 'New Page', icon: <FilePlus2 size={13} />, onClick: () => void newNode({ notebookId: nb.id }) },
    { label: 'New Folder', icon: <FolderPlus size={13} />, onClick: () => void newNode({ notebookId: nb.id, kind: 'folder' }) },
    { label: 'New Section', icon: <Layers size={13} />, onClick: () => void newNode({ notebookId: nb.id, kind: 'section' }) },
    { separator: true },
    { label: 'Rename', icon: <Pencil size={13} />, shortcut: 'F2', onClick: () => setRenaming(true) },
    { label: 'Change icon', icon: <Smile size={13} />, onClick: () => setPicker('icon') },
    { label: 'Change color', icon: <Palette size={13} />, onClick: () => setPicker('color') },
    { separator: true },
    { label: 'Move to trash', icon: <Trash2 size={13} />, danger: true, onClick: () => void trash() },
  ];

  const onDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer.types;
    if (dragNodeId && t.includes(NODE_MIME)) { e.preventDefault(); e.stopPropagation(); setZone('root'); }
    else if (dragNotebookId && t.includes(NB_MIME) && dragNotebookId !== nb.id) {
      e.preventDefault();
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      setZone(e.clientY < r.top + r.height / 2 ? 'before' : 'after');
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    const z = zone;
    setZone(null);
    if (!z) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      if (z === 'root' && dragNodeId) {
        const id = dragNodeId;
        dragNodeId = null;
        await repo.moveNode(id, { notebookId: nb.id, parentId: null, beforeId: null });
        useWorkspace.getState().setExpanded(nb.id, true);
      } else if (dragNotebookId) {
        const id = dragNotebookId;
        dragNotebookId = null;
        const list = siblings.filter((s) => s.id !== id);
        const i = list.findIndex((s) => s.id === nb.id);
        await repo.moveNotebook(id, z === 'before' ? nb.id : list[i + 1]?.id ?? null);
      }
    } catch (err) { toast(errMsg(err), 'error'); }
  };

  return (
    <div>
      <div
        ref={rowRef}
        role="treeitem"
        aria-expanded={expanded}
        tabIndex={0}
        draggable={!renaming}
        data-testid="notebook-row"
        data-notebook-name={nb.name}
        onDragStart={(e) => { dragNotebookId = nb.id; e.dataTransfer.setData(NB_MIME, nb.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { dragNotebookId = null; setZone(null); }}
        onDragOver={onDragOver}
        onDragLeave={() => setZone(null)}
        onDrop={(e) => void onDrop(e)}
        onClick={() => { select(); toggle(); }}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => show(e, items())}
        onKeyDown={(e) => { if (renaming) return; if (e.key === 'F2') { e.preventDefault(); setRenaming(true); } else if (e.key === 'Enter') { select(); toggle(); } }}
        className={clsx(
          'group relative flex h-7 cursor-default select-none items-center gap-1 pl-1.5 pr-1 text-[13px] font-medium outline-none focus-visible:bg-bg-3',
          current ? 'text-fg' : 'text-fg-muted', 'hover:bg-bg-2 hover:text-fg',
          zone === 'root' && 'bg-accent/25 ring-1 ring-inset ring-accent',
        )}
      >
        {zone === 'before' && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent" />}
        {zone === 'after' && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-faint">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: nb.color }} />
        <span className="w-4 shrink-0 text-center leading-none">{nb.icon}</span>
        {renaming
          ? <InlineRename value={nb.name} onCommit={(name) => { void repo.updateNotebook(nb.id, { name }); setRenaming(false); }} onCancel={() => setRenaming(false)} />
          : <span className="min-w-0 flex-1 truncate" data-testid="notebook-name">{nb.name}</span>}
        {!renaming && (
          <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <IconButton size="sm" title="New page" data-testid="notebook-add" onClick={(e) => { e.stopPropagation(); void newNode({ notebookId: nb.id }); }}><Plus size={13} /></IconButton>
            <IconButton size="sm" title="More actions" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); show({ clientX: r.left, clientY: r.bottom, preventDefault() {}, stopPropagation() {} }, items()); }}><MoreHorizontal size={13} /></IconButton>
          </span>
        )}
      </div>
      {expanded && <Children notebookId={nb.id} parentId={null} depth={1} />}
      {menu}
      <PickerPopover
        kind={picker} anchor={rowRef.current} icon={nb.icon} color={nb.color}
        onIcon={(v) => void repo.updateNotebook(nb.id, { icon: v || '📒' })}
        onColor={(v) => void repo.updateNotebook(nb.id, { color: v || '#64748b' })}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}

export function NotebookTree() {
  const workspaceId = useWorkspace((s) => s.workspaceId);
  const notebooks = useNotebooks(workspaceId);
  return (
    <div role="tree" data-testid="notebook-tree">
      {notebooks.map((nb) => <NotebookRow key={nb.id} nb={nb} siblings={notebooks} />)}
      {notebooks.length === 0 && <div className="px-3 py-2 text-fg-faint">No notebooks yet.</div>}
      <button
        data-testid="new-notebook"
        onClick={async () => {
          if (!workspaceId) return;
          const name = await promptDialog('New notebook', 'Notebook');
          if (!name) return;
          const nb = await repo.createNotebook(workspaceId, name);
          const ws = useWorkspace.getState();
          ws.setNotebook(nb.id);
          ws.setExpanded(nb.id, true);
        }}
        className="mt-0.5 flex h-7 w-full items-center gap-2 px-2 text-left text-[12px] text-fg-muted hover:bg-bg-2 hover:text-fg"
      ><BookPlus size={14} />New notebook</button>
    </div>
  );
}
