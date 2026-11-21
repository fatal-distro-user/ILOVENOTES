import { useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useRecent, useSavedSearches, useStarred, useTags, useTrash } from '@/db/hooks';
import * as repo from '@/db/repo';
import type { SavedSearch, TreeNode } from '@/db/types';
import { useWorkspace } from '@/store/workspace';
import { IconButton } from '@/ui/IconButton';
import { Modal, Button } from '@/ui/Modal';
import { confirmDialog } from '@/ui/dialogs';
import { openNode, openSearch, openTrash } from '../actions';

function NodeLink({ node, testId }: { node: TreeNode; testId?: string }) {
  return (
    <button
      data-testid={testId}
      onClick={(e) => openNode(node, { newTab: e.ctrlKey || e.metaKey })}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); openNode(node, { newTab: true }); } }}
      className="flex h-7 w-full items-center gap-2 px-3 text-left text-fg-muted hover:bg-bg-2 hover:text-fg"
    >
      <span className="w-4 shrink-0 text-center leading-none">{node.icon}</span>
      <span className="min-w-0 flex-1 truncate">{node.title || 'Untitled'}</span>
    </button>
  );
}

export function StarredList() {
  const ws = useWorkspace((s) => s.workspaceId);
  const rows = useStarred(ws);
  if (!rows.length) return <div className="px-3 py-1 text-[12px] text-fg-faint">Star pages to pin them here.</div>;
  return <>{rows.map((n) => <NodeLink key={n.id} node={n} testId="starred-item" />)}</>;
}

export function RecentList() {
  const ws = useWorkspace((s) => s.workspaceId);
  const rows = useRecent(ws, 10);
  if (!rows.length) return <div className="px-3 py-1 text-[12px] text-fg-faint">Nothing opened yet.</div>;
  return <>{rows.map((n) => <NodeLink key={n.id} node={n} testId="recent-item" />)}</>;
}

export function TagList() {
  const ws = useWorkspace((s) => s.workspaceId);
  const tags = useTags(ws);
  if (!tags.length) return <div className="px-3 py-1 text-[12px] text-fg-faint">Tags used in pages appear here.</div>;
  return (
    <div className="flex flex-wrap gap-1 px-3 py-1">
      {tags.map(([tag, n]) => (
        <button key={tag} onClick={() => openSearch({ tags: tag }, `#${tag}`)} className="inline-flex h-5 items-center gap-1 rounded-full bg-bg-3 px-2 text-[11.5px] text-fg-muted hover:text-fg" data-testid="tag-chip">
          #{tag}<span className="text-fg-faint">{n}</span>
        </button>
      ))}
    </div>
  );
}

function SavedSearchForm({ initial, onClose }: { initial?: SavedSearch; onClose: () => void }) {
  const ws = useWorkspace((s) => s.workspaceId);
  const [name, setName] = useState(initial?.name ?? '');
  const [query, setQuery] = useState(initial?.query ?? '');
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '');
  const parsed = tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  const save = async () => {
    if (!name.trim() || !ws) return;
    if (initial) await repo.updateSavedSearch(initial.id, { name: name.trim(), query, tags: parsed });
    else await repo.createSavedSearch(ws, name.trim(), query, parsed);
    onClose();
  };
  const field = 'h-7 w-full rounded-md border border-line bg-bg-2 px-2 text-[13px] text-fg outline-none focus:border-accent';
  return (
    <Modal title={initial ? 'Edit saved search' : 'New saved search'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={() => void save()} data-testid="saved-search-save">Save</Button></>}>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="block text-[12px] text-fg-muted">Name<input autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} data-testid="saved-search-name" /></label>
        <label className="block text-[12px] text-fg-muted">Query<input className={field} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Text in title or body" /></label>
        <label className="block text-[12px] text-fg-muted">Tags (comma separated)<input className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="project, todo" /></label>
      </form>
    </Modal>
  );
}

export function SavedSearchAddButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton size="sm" title="New saved search" onClick={() => setOpen(true)}><Plus size={13} /></IconButton>
      {open && <SavedSearchForm onClose={() => setOpen(false)} />}
    </>
  );
}

export function SavedSearchList() {
  const ws = useWorkspace((s) => s.workspaceId);
  const rows = useSavedSearches(ws);
  const [editing, setEditing] = useState<SavedSearch | null>(null);
  if (!rows.length) return <div className="px-3 py-1 text-[12px] text-fg-faint">No saved searches.</div>;
  return (
    <>
      {rows.map((s) => (
        <div key={s.id} className="group flex h-7 items-center pr-1 hover:bg-bg-2" data-testid="saved-search">
          <button onClick={() => openSearch({ savedId: s.id }, s.name)} className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left text-fg-muted group-hover:text-fg">
            <Search size={13} className="shrink-0" /><span className="truncate">{s.name}</span>
          </button>
          <span className="flex opacity-0 group-hover:opacity-100">
            <IconButton size="sm" title="Edit saved search" onClick={() => setEditing(s)}><Pencil size={12} /></IconButton>
            <IconButton size="sm" title="Delete saved search" onClick={async () => { if (await confirmDialog(`Delete saved search "${s.name}"?`, { confirmLabel: 'Delete' })) void repo.deleteSavedSearch(s.id); }}><Trash2 size={12} /></IconButton>
          </span>
        </div>
      ))}
      {editing && <SavedSearchForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function TrashEntry() {
  const ws = useWorkspace((s) => s.workspaceId);
  const trash = useTrash(ws);
  const count = trash.nodes.length + trash.notebooks.length;
  return (
    <button data-testid="trash-entry" onClick={openTrash} className="flex h-7 w-full items-center gap-2 px-3 text-left text-fg-muted hover:bg-bg-2 hover:text-fg">
      <Trash2 size={14} /><span className="flex-1">Trash</span>
      {count > 0 && <span className="rounded-full bg-bg-3 px-1.5 text-[11px] text-fg-muted" data-testid="trash-count">{count}</span>}
    </button>
  );
}
