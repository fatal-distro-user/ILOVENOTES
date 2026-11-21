import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import type { TreeNode } from '@/db/types';
import { useWorkspace } from '@/store/workspace';
import { useTabs } from '@/store/tabs';
import { ensureTarget } from '@/layout/actions';
import { toast } from '@/store/status';

/** Find a live page by id, else by case-insensitive exact title in the current workspace. */
export async function resolvePage(target: string, pageId?: string | null): Promise<TreeNode | undefined> {
  if (pageId) {
    const byId = await db.nodes.get(pageId);
    if (byId && !byId.deletedAt) return byId;
  }
  const ws = useWorkspace.getState().workspaceId;
  const want = target.trim().toLowerCase();
  if (!ws || !want) return undefined;
  return db.nodes.where('workspaceId').equals(ws).filter((n) => !n.deletedAt && n.kind === 'page' && n.title.trim().toLowerCase() === want).first();
}

/** Page titles for link autocompletion (most recently updated first). */
export async function searchPages(query: string, limit = 12): Promise<TreeNode[]> {
  const ws = useWorkspace.getState().workspaceId;
  if (!ws) return [];
  const q = query.trim().toLowerCase();
  const pages = await db.nodes.where('workspaceId').equals(ws).filter((n) => !n.deletedAt && n.kind === 'page').toArray();
  const scored = pages
    .map((p) => {
      const t = p.title.toLowerCase();
      const score = !q ? 1 : t === q ? 100 : t.startsWith(q) ? 50 : t.includes(q) ? 20 : fuzzy(t, q) ? 5 : 0;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.updatedAt - a.p.updatedAt);
  return scored.slice(0, limit).map((x) => x.p);
}

function fuzzy(text: string, q: string): boolean {
  let i = 0;
  for (const ch of text) if (ch === q[i]) i++;
  return i === q.length;
}

/** Open (creating if needed) the target of a wiki-link. */
export async function openWikiTarget(target: string, pageId?: string | null, opts: { newTab?: boolean; side?: boolean } = {}): Promise<TreeNode | null> {
  let node = await resolvePage(target, pageId);
  if (!node) {
    try {
      const t = await ensureTarget();
      node = await repo.createNode({ workspaceId: t.workspaceId, notebookId: t.notebookId, parentId: null, kind: 'page', title: target.trim() || 'Untitled' });
      toast(`Created page “${node.title}”`, 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open link', 'error');
      return null;
    }
  }
  const tabs = useTabs.getState();
  if (opts.side) tabs.openToSide({ kind: 'page', pageId: node.id, title: node.title });
  else tabs.openPage(node.id, node.title, { newTab: opts.newTab });
  return node;
}

/** Pages linking to `node` (by id or by title). */
export async function backlinksFor(node: Pick<TreeNode, 'id' | 'title' | 'workspaceId'>): Promise<{ page: TreeNode; snippet: string }[]> {
  const keys = [`id:${node.id}`, node.title.trim().toLowerCase()];
  const docs = await db.docs.where('links').anyOf(keys).distinct().toArray();
  const out: { page: TreeNode; snippet: string }[] = [];
  for (const d of docs) {
    if (d.pageId === node.id) continue;
    const page = await db.nodes.get(d.pageId);
    if (!page || page.deletedAt || page.workspaceId !== node.workspaceId) continue;
    const idx = d.text.toLowerCase().indexOf(`[[${node.title.toLowerCase()}`);
    const at = idx >= 0 ? idx : 0;
    out.push({ page, snippet: d.text.slice(Math.max(0, at - 60), at + 120).replace(/\s+/g, ' ') });
  }
  return out.sort((a, b) => b.page.updatedAt - a.page.updatedAt);
}
