import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, CheckSquare, Plus, Trash2 } from 'lucide-react';
import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/status';
import { confirmDialog, promptDialog } from '@/ui/dialogs';
import { Button } from '@/ui/Modal';
import { ensureTarget, openNode } from '@/layout/actions';
import { indexDoc } from '@/editor/indexing';
import { registerTabView, type TabViewProps } from '@/views/registry';
import type { TreeNode } from '@/db/types';
import {
  DEFAULT_COLUMNS, addColumn, checklistProgress, deleteColumn, groupCards, moveColumn, moveInOrder, parseScope, renameColumn, scopeKey, type Scope,
} from './kanbanLogic';

function scopeFromParams(p: Record<string, string> | undefined): Scope | null {
  if (p?.folderId) return { kind: 'folder', id: p.folderId };
  if (p?.tag) return { kind: 'tag', id: p.tag };
  if (p?.notebookId) return { kind: 'notebook', id: p.notebookId };
  return null;
}

async function loadScopeNodes(ws: string, s: Scope): Promise<TreeNode[]> {
  if (s.kind === 'notebook') return db.nodes.where('notebookId').equals(s.id).filter((n) => !n.deletedAt && n.kind === 'page').toArray();
  if (s.kind === 'tag') return repo.pagesWithTags(ws, [s.id]).then((l) => l.filter((n) => n.kind === 'page'));
  const ids = new Set([s.id, ...(await repo.getDescendantIds(s.id))]);
  return db.nodes.where('id').anyOf(Array.from(ids)).filter((n) => !n.deletedAt && n.kind === 'page').toArray();
}

function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function KanbanView({ tab, paneId }: TabViewProps) {
  const ws = useWorkspace((s) => s.workspaceId);
  const notebooks = useLiveQuery(() => (ws ? repo.listNotebooks(ws) : []), [ws], []);
  const tags = useLiveQuery(() => (ws ? repo.allTags(ws).then((m) => Array.from(m.keys()).sort()) : []), [ws], []);
  const folders = useLiveQuery(() => (ws ? db.nodes.where('workspaceId').equals(ws).filter((n) => n.kind === 'folder' && !n.deletedAt).toArray() : []), [ws], []);
  const lastScope = useLiveQuery(() => repo.getSetting<string>('kanban-last-scope', ''), [], '');
  const [picked, setPicked] = useState<Scope | null>(() => scopeFromParams(tab.params));
  const scope: Scope | null = picked ?? parseScope(lastScope) ?? (notebooks[0] ? { kind: 'notebook', id: notebooks[0].id } : null);
  const key = scope ? scopeKey(scope) : '';

  const columns = useLiveQuery(() => (key ? repo.getSetting<string[]>(`kanban-columns:${key}`, DEFAULT_COLUMNS) : DEFAULT_COLUMNS), [key], DEFAULT_COLUMNS);
  const order = useLiveQuery(() => (key ? repo.getSetting<string[]>(`kanban-order:${key}`, []) : []), [key], []);
  const nodes = useLiveQuery(() => (ws && scope ? loadScopeNodes(ws, scope) : []), [ws, key], []);
  const progress = useLiveQuery(async () => {
    const docs = await db.docs.bulkGet(nodes.map((n) => n.id));
    const m: Record<string, { done: number; total: number }> = {};
    docs.forEach((d, i) => { if (d) { const p = checklistProgress(d.content); if (p.total) m[nodes[i].id] = p; } });
    return m;
  }, [nodes], {} as Record<string, { done: number; total: number }>);

  const groups = useMemo(() => groupCards(nodes, columns, order), [nodes, columns, order]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: string; before: string | null } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const addingRef = useRef<string | null>(null);

  const pickScope = (s: Scope) => { setPicked(s); void repo.setSetting('kanban-last-scope', scopeKey(s)); };
  const saveColumns = (cols: string[]) => repo.setSetting(`kanban-columns:${key}`, cols);

  const dropCard = async (col: string, before: string | null) => {
    const id = dragId;
    setDragId(null); setOver(null);
    if (!id) return;
    const colIds = groups[col].map((c) => c.id);
    await repo.setSetting(`kanban-order:${key}`, moveInOrder(order, colIds, id, before));
    const node = nodes.find((n) => n.id === id);
    if (node && node.status !== col) await repo.updateNode(id, { status: col });
  };

  const addCard = async (col: string) => {
    if (addingRef.current !== col) return;
    addingRef.current = null;
    const title = draft.trim();
    setAdding(null); setDraft('');
    if (!title || !scope || !ws) return;
    try {
      let notebookId: string;
      let parentId: string | null = null;
      if (scope.kind === 'notebook') notebookId = scope.id;
      else if (scope.kind === 'folder') {
        const f = await db.nodes.get(scope.id);
        if (!f) return;
        notebookId = f.notebookId; parentId = f.id;
      } else notebookId = (await ensureTarget()).notebookId;
      const node = await repo.createNode({ workspaceId: ws, notebookId, parentId, kind: 'page', title, status: col, tags: scope.kind === 'tag' ? [scope.id] : [] });
      if (scope.kind === 'tag') {
        const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `#${scope.id}` }] }] };
        const idx = indexDoc(doc);
        await repo.saveDoc({ pageId: node.id, content: doc, ...idx });
      }
      await repo.setSetting(`kanban-order:${key}`, [...order.filter((x) => x !== node.id), node.id]);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not add card', 'error'); }
  };

  const rename = async (col: string) => {
    const name = await promptDialog('Rename column', col);
    if (!name) return;
    const next = renameColumn(columns, col, name);
    if (!next) { toast('Column name is empty or already used', 'error'); return; }
    await db.nodes.where('id').anyOf(nodes.filter((n) => n.status === col).map((n) => n.id)).modify({ status: name.trim() });
    await saveColumns(next);
  };
  const remove = async (col: string) => {
    const next = deleteColumn(columns, col);
    if (!next) { toast('A board needs at least one column', 'error'); return; }
    if (!(await confirmDialog(`Delete column “${col}”? Its cards move to “${next[0]}”.`, { confirmLabel: 'Delete' }))) return;
    await db.nodes.where('id').anyOf(nodes.filter((n) => n.status === col).map((n) => n.id)).modify({ status: next[0] });
    await saveColumns(next);
  };
  const addCol = async () => {
    const name = await promptDialog('New column name', '');
    if (!name) return;
    const next = addColumn(columns, name);
    if (!next) { toast('Column name is empty or already used', 'error'); return; }
    await saveColumns(next);
  };

  const value = key;
  const onSelect = (v: string) => { const s = parseScope(v); if (s) pickScope(s); };

  return (
    <div className="flex h-full flex-col bg-bg" data-testid="kanban">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
        <h2 className="text-[14px] font-semibold">Board</h2>
        <select
          value={value} onChange={(e) => onSelect(e.target.value)} data-testid="kanban-scope" aria-label="Board scope"
          className="h-7 max-w-[280px] rounded-md border border-line bg-bg-2 px-2 text-[12.5px] text-fg outline-none focus:border-accent"
        >
          {!value && <option value="">Select a scope…</option>}
          <optgroup label="Notebooks">{notebooks.map((n) => <option key={n.id} value={`notebook:${n.id}`}>{n.icon} {n.name}</option>)}</optgroup>
          {folders.length > 0 && <optgroup label="Folders">{folders.map((f) => <option key={f.id} value={`folder:${f.id}`}>{f.icon} {f.title}</option>)}</optgroup>}
          {tags.length > 0 && <optgroup label="Tags">{tags.map((t) => <option key={t} value={`tag:${t}`}>#{t}</option>)}</optgroup>}
        </select>
        <span className="text-[12px] text-fg-faint">{nodes.length} card{nodes.length === 1 ? '' : 's'}</span>
        <div className="flex-1" />
        <Button onClick={() => void addCol()} data-testid="kanban-add-column"><Plus size={13} />Column</Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {columns.map((col, ci) => (
          <section
            key={col} data-testid="kanban-column" data-column={col}
            onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over?.col !== col || e.target === e.currentTarget) setOver({ col, before: over?.col === col ? over.before : null }); }}
            onDrop={(e) => { e.preventDefault(); void dropCard(col, over?.col === col ? over.before : null); }}
            className={clsx('group/col flex w-[280px] shrink-0 flex-col rounded-xl border bg-bg-1', over?.col === col && dragId ? 'border-accent' : 'border-line')}
          >
            <header className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-3">
              <button className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold" onDoubleClick={() => void rename(col)} title="Double-click to rename">{col}</button>
              <span className="rounded-full bg-bg-3 px-1.5 text-[11px] text-fg-muted">{groups[col].length}</span>
              <span className="flex opacity-0 transition-opacity group-hover/col:opacity-100 focus-within:opacity-100">
                <button aria-label="Move column left" disabled={ci === 0} onClick={() => void saveColumns(moveColumn(columns, col, -1))} className="rounded p-1 text-fg-muted hover:bg-bg-3 disabled:opacity-30"><ArrowLeft size={12} /></button>
                <button aria-label="Move column right" disabled={ci === columns.length - 1} onClick={() => void saveColumns(moveColumn(columns, col, 1))} className="rounded p-1 text-fg-muted hover:bg-bg-3 disabled:opacity-30"><ArrowRight size={12} /></button>
                <button aria-label="Delete column" onClick={() => void remove(col)} className="rounded p-1 text-fg-muted hover:bg-bg-3 hover:text-danger"><Trash2 size={12} /></button>
              </span>
            </header>
            <div className="min-h-[60px] flex-1 space-y-2 overflow-y-auto p-2">
              {groups[col].map((n) => {
                const p = progress[n.id];
                return (
                  <article
                    key={n.id} draggable data-testid="kanban-card" data-id={n.id} data-title={n.title}
                    onDragStart={(e) => { setDragId(n.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id); }}
                    onDragEnd={() => { setDragId(null); setOver(null); }}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault(); e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      const list = groups[col];
                      const idx = list.findIndex((c) => c.id === n.id);
                      const before = e.clientY < r.top + r.height / 2 ? n.id : list[idx + 1]?.id ?? null;
                      if (over?.col !== col || over.before !== before) setOver({ col, before });
                    }}
                    onClick={(e) => openNode(n, { paneId, newTab: e.ctrlKey || e.metaKey })}
                    className={clsx('cursor-pointer rounded-lg border bg-bg-2 p-2.5 text-[13px] shadow-sm transition-colors hover:border-accent/60', dragId === n.id ? 'opacity-40' : '', over?.col === col && over.before === n.id && dragId && dragId !== n.id ? 'border-t-2 border-t-accent border-line' : 'border-line')}
                  >
                    <div className="flex items-start gap-2"><span className="text-[15px] leading-5">{n.icon}</span><span className="min-w-0 flex-1 break-words font-medium leading-5">{n.title}</span></div>
                    {n.tags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{n.tags.slice(0, 4).map((t) => <span key={t} className="rounded bg-bg-3 px-1.5 text-[11px] text-fg-muted">#{t}</span>)}</div>}
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-fg-faint">
                      <span>{fmtDate(n.updatedAt)}</span>
                      {p && (
                        <span className="ml-auto flex items-center gap-1.5" data-testid="kanban-progress">
                          <CheckSquare size={11} />{p.done}/{p.total}
                          <span className="h-1 w-12 overflow-hidden rounded-full bg-bg-3"><span className="block h-full bg-ok" style={{ width: `${(p.done / p.total) * 100}%` }} /></span>
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
              {over?.col === col && over.before === null && dragId && <div className="h-0.5 rounded bg-accent" />}
            </div>
            <footer className="shrink-0 border-t border-line p-2">
              {adding === col ? (
                <input
                  autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Card title, Enter to add" data-testid="kanban-add-input"
                  onKeyDown={(e) => { if (e.key === 'Enter') void addCard(col); else if (e.key === 'Escape') { addingRef.current = null; setAdding(null); setDraft(''); } }}
                  onBlur={() => { if (draft.trim()) void addCard(col); else { addingRef.current = null; setAdding(null); } }}
                  className="h-8 w-full rounded-md border border-accent bg-bg-2 px-2 text-[13px] text-fg outline-none"
                />
              ) : (
                <button onClick={() => { addingRef.current = col; setAdding(col); setDraft(''); }} data-testid="kanban-add-card" className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[12.5px] text-fg-muted hover:bg-bg-2 hover:text-fg"><Plus size={13} />Add card</button>
              )}
            </footer>
          </section>
        ))}
      </div>
    </div>
  );
}

registerTabView('kanban', KanbanView);
