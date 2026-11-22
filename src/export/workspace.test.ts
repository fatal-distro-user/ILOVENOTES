import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { switchDatabase, db } from '@/db/schema';
import * as repo from '@/db/repo';
import { unzipSync } from 'fflate';
import { exportWorkspaceArchive, importWorkspaceArchive, exportWorkspaceJson, importWorkspaceJson, remapIds } from './workspace';

let n = 0;
beforeEach(() => { switchDatabase(`ws-${++n}`); });

async function seed() {
  const ws = await repo.createWorkspace('Lab');
  const nb = await repo.createNotebook(ws.id, 'Notes');
  const a = await repo.createNode({ workspaceId: ws.id, notebookId: nb.id, parentId: null, kind: 'page', title: 'A' });
  const b = await repo.createNode({ workspaceId: ws.id, notebookId: nb.id, parentId: a.id, kind: 'page', title: 'B', mode: 'canvas' });
  await repo.saveDoc({ pageId: a.id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'wikiLink', attrs: { target: 'B', pageId: b.id } }] }] }, text: '[[B]]', links: ['b', `id:${b.id}`], tags: [], headings: [] });
  await db.canvasObjects.add({ id: 'obj1-abcdef', pageId: b.id, type: 'sticky', x: 0, y: 0, w: 10, h: 10, rotation: 0, z: 1, locked: false, groupId: null, data: { text: 'hi' }, createdAt: 0, updatedAt: 0 });
  await db.audio.add({ id: 'aud1-abcdef', pageId: b.id, name: 'rec', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), mime: 'audio/webm', durationMs: 1000, createdAt: 0 });
  await repo.setSetting(`canvas-settings:${b.id}`, { background: 'grid' });
  return { ws, a, b };
}

describe('workspace archive', () => {
  it('round-trips through zip into a new workspace with remapped ids', async () => {
    const { ws, a, b } = await seed();
    const zip = await exportWorkspaceArchive(ws.id);
    const res = await importWorkspaceArchive(zip);
    expect(res.workspaceId).not.toBe(ws.id);
    expect(res.name).toBe('Lab (imported)');
    expect(res.pages).toBe(2);
    const nodes = await db.nodes.where('workspaceId').equals(res.workspaceId).toArray();
    const na = nodes.find((x) => x.title === 'A')!, nb = nodes.find((x) => x.title === 'B')!;
    expect(na.id).not.toBe(a.id);
    expect(nb.parentId).toBe(na.id);
    const doc = await db.docs.get(na.id);
    expect(doc?.links).toContain(`id:${nb.id}`);
    expect(JSON.stringify(doc?.content)).toContain(nb.id);
    const objs = await db.canvasObjects.where('pageId').equals(nb.id).toArray();
    expect(objs).toHaveLength(1);
    // Blob asset round-trips are covered by the browser e2e suite (jsdom Blobs don't survive fake-indexeddb).
    expect(await db.audio.where('pageId').equals(nb.id).count()).toBe(1);
    expect(Object.keys(unzipSync(zip))).toContain('data/audio.json');
    expect(await repo.getSetting(`canvas-settings:${nb.id}`, null)).toEqual({ background: 'grid' });
    void b;
  });
  it('round-trips through JSON', async () => {
    const { ws } = await seed();
    const res = await importWorkspaceJson(await exportWorkspaceJson(ws.id));
    expect(res.pages).toBe(2);
  });
  it('rejects foreign archives and remaps id strings', async () => {
    await expect(importWorkspaceArchive(new Uint8Array([80, 75, 3, 4, 0]))).rejects.toThrow();
    const m = new Map([['abc123', 'xyz789']]);
    expect(remapIds({ a: 'abc123', b: 'id:abc123', c: 'k:abc123', d: ['abc123'], e: 'plain' }, m)).toEqual({ a: 'xyz789', b: 'id:xyz789', c: 'k:xyz789', d: ['xyz789'], e: 'plain' });
  });
});
