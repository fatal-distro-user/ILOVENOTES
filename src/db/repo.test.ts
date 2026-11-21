import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { switchDatabase, db } from './schema';
import * as repo from './repo';
import { orderBetween, needsRebalance } from './order';

let n = 0;
beforeEach(() => { switchDatabase(`test-${++n}`); });

async function setup() {
  const ws = await repo.createWorkspace('WS');
  const nb = await repo.createNotebook(ws.id, 'NB');
  const mk = (parentId: string | null, title: string, kind: 'page' | 'folder' | 'section' = 'page', beforeId?: string) =>
    repo.createNode({ workspaceId: ws.id, notebookId: nb.id, parentId, kind, title, beforeId });
  return { ws, nb, mk };
}

describe('order helpers', () => {
  it('computes midpoints and edges', () => {
    expect(orderBetween(undefined, undefined)).toBe(1024);
    expect(orderBetween(1024, undefined)).toBe(2048);
    expect(orderBetween(undefined, 1024)).toBe(0);
    expect(orderBetween(1024, 2048)).toBe(1536);
    expect(needsRebalance(1, 1 + 1e-9)).toBe(true);
  });
});

describe('hierarchy', () => {
  it('creates default workspace once', async () => {
    const a = await repo.ensureDefaultWorkspace();
    const b = await repo.ensureDefaultWorkspace();
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.workspace.id).toBe(a.workspace.id);
    expect(await db.nodes.count()).toBe(1);
  });

  it('orders siblings and inserts before', async () => {
    const { nb, mk } = await setup();
    const a = await mk(null, 'A');
    const c = await mk(null, 'C');
    await mk(null, 'B', 'page', c.id);
    expect((await repo.listChildren(nb.id, null)).map((x) => x.title)).toEqual(['A', 'B', 'C']);
    expect(a.order).toBeLessThan(c.order);
  });

  it('nests sub-pages infinitely and moves with cycle protection', async () => {
    const { nb, mk } = await setup();
    const f = await mk(null, 'Folder', 'folder');
    const p = await mk(f.id, 'Page');
    const sp = await mk(p.id, 'Sub');
    const ssp = await mk(sp.id, 'SubSub');
    expect((await repo.getAncestors(ssp.id)).map((x) => x.title)).toEqual(['Folder', 'Page', 'Sub']);
    await expect(repo.moveNode(f.id, { notebookId: nb.id, parentId: ssp.id })).rejects.toThrow(/descendant/);
    await repo.moveNode(ssp.id, { notebookId: nb.id, parentId: null });
    expect((await repo.listChildren(nb.id, null)).map((x) => x.title)).toEqual(['Folder', 'SubSub']);
  });

  it('moves subtree across notebooks', async () => {
    const { ws, mk } = await setup();
    const nb2 = await repo.createNotebook(ws.id, 'Other');
    const p = await mk(null, 'P');
    const c = await mk(p.id, 'C');
    await repo.moveNode(p.id, { notebookId: nb2.id, parentId: null });
    expect((await repo.getNode(c.id))?.notebookId).toBe(nb2.id);
  });

  it('trashes and restores whole subtree, keeps separately-trashed children trashed', async () => {
    const { ws, nb, mk } = await setup();
    const p = await mk(null, 'P');
    const c1 = await mk(p.id, 'C1');
    const c2 = await mk(p.id, 'C2');
    await repo.trashNode(c2.id);
    await new Promise((r) => setTimeout(r, 2));
    await repo.trashNode(p.id);
    expect(await repo.listChildren(nb.id, null)).toHaveLength(0);
    const trash = await repo.listTrash(ws.id);
    expect(trash.nodes.map((x) => x.title).sort()).toEqual(['C2', 'P']);
    await repo.restoreNode(p.id);
    expect((await repo.getNode(c1.id))?.deletedAt).toBe(0);
    expect((await repo.getNode(c2.id))?.deletedAt).toBeGreaterThan(0);
    await repo.restoreNode(c2.id);
    expect((await repo.listChildren(nb.id, p.id)).map((x) => x.title)).toEqual(['C1', 'C2']);
  });

  it('restoring a child resurrects trashed ancestors', async () => {
    const { mk } = await setup();
    const p = await mk(null, 'P');
    const c = await mk(p.id, 'C');
    await repo.trashNode(p.id);
    await repo.restoreNode(c.id);
    expect((await repo.getNode(p.id))?.deletedAt).toBe(0);
  });

  it('empties trash and purges content', async () => {
    const { ws, mk } = await setup();
    const p = await mk(null, 'P');
    await repo.saveDoc({ pageId: p.id, content: {}, text: 'hello', links: [], tags: ['x'], headings: [] });
    await db.strokes.add({ id: 's1', pageId: p.id, points: [0, 0, 0.5, 0], color: '#000', width: 2, opacity: 1, tool: 'pen', createdAt: 0 });
    await repo.trashNode(p.id);
    expect(await repo.emptyTrash(ws.id)).toBe(1);
    expect(await db.docs.count()).toBe(0);
    expect(await db.strokes.count()).toBe(0);
  });

  it('stars, recents, duplicates', async () => {
    const { ws, mk } = await setup();
    const a = await mk(null, 'A');
    const b = await mk(null, 'B');
    expect(await repo.toggleStar(a.id)).toBe(true);
    expect((await repo.listStarred(ws.id)).map((x) => x.title)).toEqual(['A']);
    await repo.touchOpened(a.id);
    await new Promise((r) => setTimeout(r, 2));
    await repo.touchOpened(b.id);
    expect((await repo.listRecent(ws.id)).map((x) => x.title)).toEqual(['B', 'A']);
    await repo.saveDoc({ pageId: a.id, content: { t: 1 }, text: 'body', links: [], tags: [], headings: [] });
    const copy = await repo.duplicateNode(a.id);
    expect(copy.title).toBe('A (copy)');
    expect((await repo.getDoc(copy.id))?.text).toBe('body');
  });

  it('tags and saved searches', async () => {
    const { ws, mk } = await setup();
    const a = await mk(null, 'Alpha');
    const b = await mk(null, 'Beta');
    await repo.saveDoc({ pageId: a.id, content: {}, text: 'quantum physics', links: [], tags: ['science', 'todo'], headings: [] });
    await repo.saveDoc({ pageId: b.id, content: {}, text: 'grocery list', links: [], tags: ['todo'], headings: [] });
    expect((await repo.allTags(ws.id)).get('todo')).toBe(2);
    expect((await repo.pagesWithTags(ws.id, ['todo', 'science'])).map((x) => x.title)).toEqual(['Alpha']);
    const s = await repo.createSavedSearch(ws.id, 'Todos', 'list', ['todo']);
    expect((await repo.runSavedSearch(ws.id, s.query, s.tags)).map((x) => x.title)).toEqual(['Beta']);
    expect(await repo.listSavedSearches(ws.id)).toHaveLength(1);
  });
});
