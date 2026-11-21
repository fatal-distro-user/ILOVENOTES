import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import type { NodeKind, PageMode, TreeNode } from '@/db/types';
import { useTabs } from '@/store/tabs';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/status';

export function todayString(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Current workspace id + notebook id, creating a notebook when the workspace has none. */
export async function ensureTarget(): Promise<{ workspaceId: string; notebookId: string }> {
  const ws = useWorkspace.getState();
  if (!ws.workspaceId) throw new Error('Workspace is not ready');
  let notebookId = ws.notebookId;
  const nb = notebookId ? await db.notebooks.get(notebookId) : undefined;
  if (!nb || nb.deletedAt || nb.workspaceId !== ws.workspaceId) {
    const first = (await repo.listNotebooks(ws.workspaceId))[0] ?? await repo.createNotebook(ws.workspaceId, 'Notebook');
    notebookId = first.id;
    ws.setNotebook(first.id);
  }
  return { workspaceId: ws.workspaceId, notebookId: notebookId as string };
}

export function openNode(node: Pick<TreeNode, 'id' | 'title'>, opts?: { newTab?: boolean; paneId?: string }): void {
  useTabs.getState().openPage(node.id, node.title, opts);
}

export interface NewNodeOpts { parentId?: string | null; notebookId?: string; kind?: NodeKind; mode?: PageMode; title?: string; open?: boolean }

/** Create a page/folder/section (default: page in the current notebook) and open it when it is a page. */
export async function newNode(opts: NewNodeOpts = {}): Promise<TreeNode | null> {
  try {
    const target = await ensureTarget();
    let notebookId = opts.notebookId ?? target.notebookId;
    if (opts.parentId) {
      const parent = await db.nodes.get(opts.parentId);
      if (parent) notebookId = parent.notebookId;
    }
    const kind = opts.kind ?? 'page';
    const node = await repo.createNode({
      workspaceId: target.workspaceId, notebookId, parentId: opts.parentId ?? null, kind,
      mode: opts.mode, title: opts.title,
    });
    const ws = useWorkspace.getState();
    if (opts.parentId) ws.setExpanded(opts.parentId, true);
    ws.setExpanded(notebookId, true);
    if (kind === 'page' && opts.open !== false) openNode(node, { newTab: true });
    return node;
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Could not create item', 'error');
    return null;
  }
}

export async function openDaily(): Promise<void> {
  try {
    const target = await ensureTarget();
    const date = todayString();
    let node = await db.nodes.where('workspaceId').equals(target.workspaceId).filter((n) => n.dailyDate === date && !n.deletedAt && n.kind === 'page').first();
    if (!node) {
      node = await repo.createNode({
        workspaceId: target.workspaceId, notebookId: target.notebookId, parentId: null, kind: 'page',
        title: date, icon: '📅', dailyDate: date,
      });
      useWorkspace.getState().setExpanded(target.notebookId, true);
    }
    openNode(node);
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Could not open daily note', 'error');
  }
}

export function openSettings(): void { useTabs.getState().open({ kind: 'settings', title: 'Settings' }); }
export function openTrash(): void { useTabs.getState().open({ kind: 'trash', title: 'Trash' }); }
export function openSearch(params: Record<string, string> = {}, title = 'Search'): void {
  useTabs.getState().open({ kind: 'search', title, params });
}
