import { nanoid } from 'nanoid';
import { db } from './schema';
import { orderBetween, needsRebalance, rebalanced } from './order';
import type { ID, Notebook, NodeKind, PageMode, TreeNode, Workspace, SavedSearch, PageDoc } from './types';

const now = () => Date.now();

// ───────────────────────── Workspaces ─────────────────────────

export async function createWorkspace(name: string): Promise<Workspace> {
  const ws: Workspace = { id: nanoid(), name, createdAt: now(), updatedAt: now() };
  await db.workspaces.add(ws);
  return ws;
}

export async function renameWorkspace(id: ID, name: string): Promise<void> {
  await db.workspaces.update(id, { name, updatedAt: now() });
}

export async function deleteWorkspace(id: ID): Promise<void> {
  const nbs = await db.notebooks.where('workspaceId').equals(id).toArray();
  for (const nb of nbs) await purgeNotebook(nb.id);
  await db.savedSearches.where('workspaceId').equals(id).delete();
  await db.workspaces.delete(id);
}

/** Returns the first workspace, creating a starter workspace + notebook + welcome page on first launch. */
export async function ensureDefaultWorkspace(): Promise<{ workspace: Workspace; created: boolean }> {
  const existing = await db.workspaces.toCollection().first();
  if (existing) return { workspace: existing, created: false };
  const workspace = await createWorkspace('My Workspace');
  const nb = await createNotebook(workspace.id, 'Personal', { icon: '📓', color: '#7c5cff' });
  await createNode({ workspaceId: workspace.id, notebookId: nb.id, parentId: null, kind: 'page', title: 'Welcome to ILOVENOTES', icon: '👋', mode: 'document' });
  return { workspace, created: true };
}

// ───────────────────────── Notebooks ─────────────────────────

export async function createNotebook(workspaceId: ID, name: string, opts: { icon?: string; color?: string } = {}): Promise<Notebook> {
  const last = await db.notebooks.where('workspaceId').equals(workspaceId).sortBy('order');
  const nb: Notebook = {
    id: nanoid(), workspaceId, name, icon: opts.icon ?? '📒', color: opts.color ?? '#64748b',
    order: orderBetween(last.at(-1)?.order, undefined), createdAt: now(), updatedAt: now(), deletedAt: 0,
  };
  await db.notebooks.add(nb);
  return nb;
}

export async function updateNotebook(id: ID, patch: Partial<Pick<Notebook, 'name' | 'icon' | 'color'>>): Promise<void> {
  await db.notebooks.update(id, { ...patch, updatedAt: now() });
}

export async function listNotebooks(workspaceId: ID, includeTrashed = false): Promise<Notebook[]> {
  const all = await db.notebooks.where('workspaceId').equals(workspaceId).sortBy('order');
  return includeTrashed ? all : all.filter((n) => !n.deletedAt);
}

export async function moveNotebook(id: ID, beforeId: ID | null): Promise<void> {
  const nb = await db.notebooks.get(id);
  if (!nb) return;
  const siblings = (await listNotebooks(nb.workspaceId)).filter((n) => n.id !== id);
  const idx = beforeId ? siblings.findIndex((s) => s.id === beforeId) : siblings.length;
  const at = idx < 0 ? siblings.length : idx;
  await db.notebooks.update(id, { order: orderBetween(siblings[at - 1]?.order, siblings[at]?.order) });
}

export async function trashNotebook(id: ID): Promise<void> {
  const t = now();
  await db.transaction('rw', db.notebooks, db.nodes, async () => {
    await db.notebooks.update(id, { deletedAt: t });
    await db.nodes.where('notebookId').equals(id).filter((n) => !n.deletedAt).modify({ deletedAt: t });
  });
}

export async function restoreNotebook(id: ID): Promise<void> {
  const nb = await db.notebooks.get(id);
  if (!nb?.deletedAt) return;
  const t = nb.deletedAt;
  await db.transaction('rw', db.notebooks, db.nodes, async () => {
    await db.notebooks.update(id, { deletedAt: 0 });
    await db.nodes.where('notebookId').equals(id).filter((n) => n.deletedAt === t).modify({ deletedAt: 0 });
  });
}

export async function purgeNotebook(id: ID): Promise<void> {
  const nodes = await db.nodes.where('notebookId').equals(id).primaryKeys();
  await purgeContent(nodes);
  await db.nodes.bulkDelete(nodes);
  await db.notebooks.delete(id);
}

// ───────────────────────── Tree nodes ─────────────────────────

export interface CreateNodeInput {
  workspaceId: ID; notebookId: ID; parentId: ID | null; kind: NodeKind; title?: string;
  icon?: string; color?: string; mode?: PageMode; tags?: string[]; beforeId?: ID | null;
  dailyDate?: string; status?: string; templateId?: string;
}

export async function listChildren(notebookId: ID, parentId: ID | null, includeTrashed = false): Promise<TreeNode[]> {
  // Dexie can't index null, so root children are filtered in memory.
  const rows = parentId === null
    ? await db.nodes.where('notebookId').equals(notebookId).filter((n) => n.parentId === null).toArray()
    : await db.nodes.where('[notebookId+parentId]').equals([notebookId, parentId]).toArray();
  return rows.filter((n) => includeTrashed || !n.deletedAt).sort((a, b) => a.order - b.order);
}

async function orderForInsert(notebookId: ID, parentId: ID | null, beforeId: ID | null | undefined, excludeId?: ID): Promise<number> {
  let siblings = (await listChildren(notebookId, parentId)).filter((s) => s.id !== excludeId);
  let idx = beforeId ? siblings.findIndex((s) => s.id === beforeId) : siblings.length;
  if (idx < 0) idx = siblings.length;
  if (needsRebalance(siblings[idx - 1]?.order, siblings[idx]?.order)) {
    const orders = rebalanced(siblings.length);
    await db.transaction('rw', db.nodes, async () => {
      for (let i = 0; i < siblings.length; i++) await db.nodes.update(siblings[i].id, { order: orders[i] });
    });
    siblings = siblings.map((s, i) => ({ ...s, order: orders[i] }));
  }
  return orderBetween(siblings[idx - 1]?.order, siblings[idx]?.order);
}

export async function createNode(input: CreateNodeInput): Promise<TreeNode> {
  if (input.parentId) {
    const parent = await db.nodes.get(input.parentId);
    if (!parent) throw new Error('Parent node not found');
    if (parent.notebookId !== input.notebookId) throw new Error('Parent belongs to another notebook');
  }
  const t = now();
  const node: TreeNode = {
    id: nanoid(), workspaceId: input.workspaceId, notebookId: input.notebookId, parentId: input.parentId,
    kind: input.kind, title: input.title ?? (input.kind === 'page' ? 'Untitled' : input.kind === 'folder' ? 'New Folder' : 'New Section'),
    icon: input.icon ?? (input.kind === 'page' ? '📄' : input.kind === 'folder' ? '📁' : '🗂️'),
    color: input.color ?? '', cover: '', starred: 0, mode: input.mode ?? 'document', tags: input.tags ?? [],
    order: await orderForInsert(input.notebookId, input.parentId, input.beforeId),
    createdAt: t, updatedAt: t, openedAt: 0, deletedAt: 0,
    dailyDate: input.dailyDate, status: input.status, templateId: input.templateId,
  };
  await db.nodes.add(node);
  return node;
}

export type NodePatch = Partial<Pick<TreeNode, 'title' | 'icon' | 'color' | 'cover' | 'mode' | 'tags' | 'status' | 'dailyDate'>>;

export async function updateNode(id: ID, patch: NodePatch): Promise<void> {
  await db.nodes.update(id, { ...patch, updatedAt: now() });
}

export async function getNode(id: ID): Promise<TreeNode | undefined> { return db.nodes.get(id); }

export async function getAncestors(id: ID): Promise<TreeNode[]> {
  const out: TreeNode[] = [];
  let cur = await db.nodes.get(id);
  const seen = new Set<ID>();
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    cur = await db.nodes.get(cur.parentId);
    if (cur) out.unshift(cur);
  }
  return out;
}

export async function getDescendantIds(id: ID): Promise<ID[]> {
  const out: ID[] = [];
  const queue: ID[] = [id];
  while (queue.length) {
    const pid = queue.shift() as ID;
    const kids = await db.nodes.where('parentId').equals(pid).primaryKeys();
    for (const k of kids) { out.push(k); queue.push(k); }
  }
  return out;
}

/**
 * Move a node under a new parent (or root) before a sibling. Rejects moves into its own subtree.
 * Moving across notebooks carries the entire subtree.
 */
export async function moveNode(id: ID, target: { notebookId: ID; parentId: ID | null; beforeId?: ID | null }): Promise<void> {
  const node = await db.nodes.get(id);
  if (!node) throw new Error('Node not found');
  if (target.parentId === id) throw new Error('Cannot move a node into itself');
  const descendants = await getDescendantIds(id);
  if (target.parentId && descendants.includes(target.parentId)) throw new Error('Cannot move a node into its own descendant');
  const order = await orderForInsert(target.notebookId, target.parentId, target.beforeId, id);
  await db.transaction('rw', db.nodes, async () => {
    await db.nodes.update(id, { parentId: target.parentId, notebookId: target.notebookId, order, updatedAt: now() });
    if (target.notebookId !== node.notebookId) {
      await db.nodes.where('id').anyOf(descendants).modify({ notebookId: target.notebookId });
    }
  });
}

export async function duplicateNode(id: ID): Promise<TreeNode> {
  const src = await db.nodes.get(id);
  if (!src) throw new Error('Node not found');
  const siblings = await listChildren(src.notebookId, src.parentId);
  const next = siblings[siblings.findIndex((s) => s.id === id) + 1];
  const copy = await createNode({ ...src, title: `${src.title} (copy)`, beforeId: next?.id ?? null });
  await db.nodes.update(copy.id, { cover: src.cover });
  const doc = await db.docs.get(id);
  if (doc) await db.docs.put({ ...doc, pageId: copy.id, updatedAt: now() });
  const objs = await db.canvasObjects.where('pageId').equals(id).toArray();
  const idMap = new Map<ID, ID>(objs.map((o) => [o.id, nanoid()]));
  await db.canvasObjects.bulkAdd(objs.map((o) => ({ ...o, id: idMap.get(o.id) as ID, pageId: copy.id, groupId: o.groupId ? idMap.get(o.groupId) ?? null : null })));
  const strokes = await db.strokes.where('pageId').equals(id).toArray();
  await db.strokes.bulkAdd(strokes.map((s) => ({ ...s, id: nanoid(), pageId: copy.id })));
  return copy;
}

export async function toggleStar(id: ID): Promise<boolean> {
  const n = await db.nodes.get(id);
  if (!n) return false;
  const starred: 0 | 1 = n.starred ? 0 : 1;
  await db.nodes.update(id, { starred });
  return starred === 1;
}

export async function touchOpened(id: ID): Promise<void> { await db.nodes.update(id, { openedAt: now() }); }

export async function listStarred(workspaceId: ID): Promise<TreeNode[]> {
  const rows = await db.nodes.where('starred').equals(1).filter((n) => n.workspaceId === workspaceId && !n.deletedAt).toArray();
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

export async function listRecent(workspaceId: ID, limit = 20): Promise<TreeNode[]> {
  return db.nodes.orderBy('openedAt').reverse()
    .filter((n) => n.workspaceId === workspaceId && n.openedAt > 0 && !n.deletedAt && n.kind === 'page')
    .limit(limit).toArray();
}

// ───────────────────────── Trash ─────────────────────────

/** Soft-delete a node and its whole subtree, sharing one deletedAt so restore brings back the same batch. */
export async function trashNode(id: ID): Promise<void> {
  const t = now();
  const ids = [id, ...(await getDescendantIds(id))];
  await db.nodes.where('id').anyOf(ids).filter((n) => !n.deletedAt).modify({ deletedAt: t });
}

/** Restore a trashed node, its batch-trashed descendants, and any trashed ancestors (so it is reachable). */
export async function restoreNode(id: ID): Promise<void> {
  const node = await db.nodes.get(id);
  if (!node?.deletedAt) return;
  const t = node.deletedAt;
  const desc = await getDescendantIds(id);
  const ancestors = await getAncestors(id);
  await db.transaction('rw', db.nodes, db.notebooks, async () => {
    await db.nodes.update(id, { deletedAt: 0 });
    await db.nodes.where('id').anyOf(desc).filter((n) => n.deletedAt === t).modify({ deletedAt: 0 });
    for (const a of ancestors) if (a.deletedAt) await db.nodes.update(a.id, { deletedAt: 0 });
    const nb = await db.notebooks.get(node.notebookId);
    if (nb?.deletedAt) await db.notebooks.update(nb.id, { deletedAt: 0 });
  });
}

/** Trash listing shows only batch roots (a trashed node whose parent is not part of the same batch). */
export async function listTrash(workspaceId: ID): Promise<{ nodes: TreeNode[]; notebooks: Notebook[] }> {
  const trashed = await db.nodes.where('deletedAt').above(0).filter((n) => n.workspaceId === workspaceId).toArray();
  const byId = new Map(trashed.map((n) => [n.id, n]));
  const nbs = (await db.notebooks.where('workspaceId').equals(workspaceId).toArray()).filter((n) => n.deletedAt);
  const trashedNb = new Map(nbs.map((n) => [n.id, n.deletedAt]));
  const roots = trashed.filter((n) => {
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    if (p && p.deletedAt === n.deletedAt) return false;
    if (!n.parentId && trashedNb.get(n.notebookId) === n.deletedAt) return false;
    return true;
  });
  return { nodes: roots.sort((a, b) => b.deletedAt - a.deletedAt), notebooks: nbs.sort((a, b) => b.deletedAt - a.deletedAt) };
}

/** Delete all page-owned content for the given page ids. */
async function purgeContent(pageIds: ID[]): Promise<void> {
  if (!pageIds.length) return;
  await db.transaction('rw', [db.docs, db.canvasObjects, db.strokes, db.rasterDocs, db.layers, db.tiles, db.animFrames, db.pdfs, db.annotations, db.audio, db.snapshots, db.srsReviews], async () => {
    await db.docs.bulkDelete(pageIds);
    await db.canvasObjects.where('pageId').anyOf(pageIds).delete();
    await db.strokes.where('pageId').anyOf(pageIds).delete();
    const rds = await db.rasterDocs.where('pageId').anyOf(pageIds).primaryKeys();
    if (rds.length) {
      await db.layers.where('docId').anyOf(rds).delete();
      await db.tiles.where('docId').anyOf(rds).delete();
      await db.animFrames.where('docId').anyOf(rds).delete();
      await db.rasterDocs.bulkDelete(rds);
    }
    const pdfIds = await db.pdfs.where('pageId').anyOf(pageIds).primaryKeys();
    if (pdfIds.length) await db.annotations.where('pdfId').anyOf(pdfIds).delete();
    await db.pdfs.bulkDelete(pdfIds);
    await db.audio.where('pageId').anyOf(pageIds).delete();
    await db.snapshots.where('pageId').anyOf(pageIds).delete();
    await db.srsReviews.where('pageId').anyOf(pageIds).delete();
  });
}

/** Permanently delete a node + subtree + all content. */
export async function purgeNode(id: ID): Promise<void> {
  const ids = [id, ...(await getDescendantIds(id))];
  await purgeContent(ids);
  await db.nodes.bulkDelete(ids);
}

export async function emptyTrash(workspaceId: ID): Promise<number> {
  const nodes = await db.nodes.where('deletedAt').above(0).filter((n) => n.workspaceId === workspaceId).primaryKeys();
  await purgeContent(nodes);
  await db.nodes.bulkDelete(nodes);
  const nbs = (await db.notebooks.where('workspaceId').equals(workspaceId).toArray()).filter((n) => n.deletedAt);
  for (const nb of nbs) await purgeNotebook(nb.id);
  return nodes.length + nbs.length;
}

// ───────────────────────── Docs & tags ─────────────────────────

export async function saveDoc(doc: Omit<PageDoc, 'updatedAt'>): Promise<void> {
  await db.transaction('rw', db.docs, db.nodes, async () => {
    await db.docs.put({ ...doc, updatedAt: now() });
    const node = await db.nodes.get(doc.pageId);
    if (node) {
      const tags = Array.from(new Set([...doc.tags])).sort();
      await db.nodes.update(doc.pageId, { tags, updatedAt: now() });
    }
  });
}

export async function getDoc(pageId: ID): Promise<PageDoc | undefined> { return db.docs.get(pageId); }

export async function allTags(workspaceId: ID): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await db.nodes.where('workspaceId').equals(workspaceId).each((n) => {
    if (n.deletedAt) return;
    for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  });
  return counts;
}

/** Pages carrying ALL given tags. */
export async function pagesWithTags(workspaceId: ID, tags: string[]): Promise<TreeNode[]> {
  if (!tags.length) return [];
  const first = await db.nodes.where('tags').equals(tags[0]).toArray();
  return first.filter((n) => n.workspaceId === workspaceId && !n.deletedAt && tags.every((t) => n.tags.includes(t)));
}

// ───────────────────────── Saved searches ─────────────────────────

export async function createSavedSearch(workspaceId: ID, name: string, query: string, tags: string[] = []): Promise<SavedSearch> {
  const s: SavedSearch = { id: nanoid(), workspaceId, name, query, tags, createdAt: now() };
  await db.savedSearches.add(s);
  return s;
}
export async function listSavedSearches(workspaceId: ID): Promise<SavedSearch[]> {
  return (await db.savedSearches.where('workspaceId').equals(workspaceId).toArray()).sort((a, b) => a.createdAt - b.createdAt);
}
export async function updateSavedSearch(id: ID, patch: Partial<Pick<SavedSearch, 'name' | 'query' | 'tags'>>): Promise<void> {
  await db.savedSearches.update(id, patch);
}
export async function deleteSavedSearch(id: ID): Promise<void> { await db.savedSearches.delete(id); }

/**
 * Runs a saved search: case-insensitive substring match on title + document text, AND tag filter.
 * (The command palette uses the fuzzy MiniSearch index; saved searches are deterministic filters.)
 */
export async function runSavedSearch(workspaceId: ID, query: string, tags: string[]): Promise<TreeNode[]> {
  const q = query.trim().toLowerCase();
  const nodes = await db.nodes.where('workspaceId').equals(workspaceId).filter((n) => !n.deletedAt && n.kind === 'page').toArray();
  const docs = q ? new Map((await db.docs.bulkGet(nodes.map((n) => n.id))).filter(Boolean).map((d) => [d!.pageId, d!.text.toLowerCase()])) : new Map<string, string>();
  return nodes.filter((n) => {
    if (tags.length && !tags.every((t) => n.tags.includes(t))) return false;
    if (!q) return true;
    return n.title.toLowerCase().includes(q) || (docs.get(n.id) ?? '').includes(q);
  });
}

// ───────────────────────── Settings ─────────────────────────

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}
export async function setSetting(key: string, value: unknown): Promise<void> { await db.settings.put({ key, value }); }
