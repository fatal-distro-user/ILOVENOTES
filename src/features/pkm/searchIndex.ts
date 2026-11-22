/** Live-maintained workspace page index (MiniSearch) backing the command palette. */
import { liveQuery, type Subscription } from 'dexie';
import { db } from '@/db/schema';
import { useWorkspace } from '@/store/workspace';
import { PageIndex, type IndexedPage } from './searchLogic';

export const pageIndex = new PageIndex();
export const notebookNames = new Map<string, { name: string; icon: string; color: string }>();
export const pageMeta = new Map<string, { icon: string; notebookId: string; tags: string[]; updatedAt: number }>();
let version = 0;
const listeners = new Set<() => void>();
let sub: Subscription | null = null;
let timer: number | undefined;
let running = false;
let dirty = false;

export function indexVersion(): number { return version; }
export function subscribeIndex(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

async function rebuild(): Promise<void> {
  if (running) { dirty = true; return; }
  running = true;
  try {
    do {
      dirty = false;
      const wsId = useWorkspace.getState().workspaceId;
      if (!wsId) break;
      const [nodes, docs, nbs] = await Promise.all([
        db.nodes.where('workspaceId').equals(wsId).filter((n) => !n.deletedAt && n.kind === 'page').toArray(),
        db.docs.toArray(),
        db.notebooks.where('workspaceId').equals(wsId).toArray(),
      ]);
      notebookNames.clear();
      for (const nb of nbs) if (!nb.deletedAt) notebookNames.set(nb.id, { name: nb.name, icon: nb.icon, color: nb.color });
      const docMap = new Map(docs.map((d) => [d.pageId, d]));
      pageMeta.clear();
      const pages: IndexedPage[] = [];
      for (const n of nodes) {
        if (!notebookNames.has(n.notebookId)) continue;
        const d = docMap.get(n.id);
        pageMeta.set(n.id, { icon: n.icon, notebookId: n.notebookId, tags: n.tags, updatedAt: n.updatedAt });
        pages.push({
          id: n.id, title: n.title, headings: d?.headings ?? [], tags: n.tags, text: d?.text ?? '',
          sig: `${n.title}|${n.updatedAt}|${d?.updatedAt ?? 0}|${n.tags.join(',')}`,
        });
      }
      pageIndex.sync(pages);
      version++;
      listeners.forEach((l) => l());
    } while (dirty);
  } finally { running = false; }
}

/** Start (once) the live subscription; cheap signature query triggers a debounced incremental rebuild. */
export function ensureIndexLive(): void {
  if (sub) return;
  void rebuild();
  sub = liveQuery(async () => {
    const [nc, nm, dc, dm, tc] = await Promise.all([
      db.nodes.count(),
      db.nodes.orderBy('updatedAt').last(),
      db.docs.count(),
      db.docs.orderBy('updatedAt').last(),
      db.nodes.where('deletedAt').above(0).count(),
    ]);
    return `${nc}:${nm?.updatedAt ?? 0}:${dc}:${dm?.updatedAt ?? 0}:${tc}`;
  }).subscribe({
    next: () => { window.clearTimeout(timer); timer = window.setTimeout(() => void rebuild(), 250); },
    error: () => { /* index stays at last good state */ },
  });
}

/** Force an immediate rebuild (used when the palette opens so results are never stale). */
export function refreshIndexNow(): Promise<void> { return rebuild(); }
