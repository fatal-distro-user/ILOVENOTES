/** Snapshot service: capture, restore, auto-snapshot scheduler. */
import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import type { Snapshot, SnapshotPayload } from '@/db/types';
import { peekCanvasDoc } from '@/canvas/doc';
import { useTabs } from '@/store/tabs';
import { nextAutoSnapshotAt, pruneAutoSnapshots } from './versionLogic';

export const MAX_AUTO_SNAPSHOTS = 50;
const AUTO_INTERVAL = 5 * 60_000;
const QUIET = 15_000;

export async function capturePayload(pageId: string): Promise<SnapshotPayload | null> {
  const node = await db.nodes.get(pageId);
  if (!node) return null;
  const [doc, objects, strokes] = await Promise.all([
    db.docs.get(pageId),
    db.canvasObjects.where('pageId').equals(pageId).toArray(),
    db.strokes.where('pageId').equals(pageId).toArray(),
  ]);
  return { node, doc: doc ?? null, objects, strokes };
}

export async function takeSnapshot(pageId: string, opts: { name?: string; auto: boolean }): Promise<Snapshot | null> {
  const payload = await capturePayload(pageId);
  if (!payload || payload.node.deletedAt) return null;
  const snap: Snapshot = {
    id: nanoid(), pageId, createdAt: Date.now(), name: opts.name ?? '', auto: opts.auto, payload,
    size: JSON.stringify(payload).length,
  };
  await db.snapshots.add(snap);
  if (opts.auto) await pruneAutos(pageId);
  return snap;
}

export async function pruneAutos(pageId: string, keep = MAX_AUTO_SNAPSHOTS): Promise<number> {
  const all = await db.snapshots.where('pageId').equals(pageId).toArray();
  const del = pruneAutoSnapshots(all.map((s) => ({ id: s.id, createdAt: s.createdAt, auto: s.auto })), keep);
  if (del.length) await db.snapshots.bulkDelete(del);
  return del.length;
}

/** Restore a snapshot onto its page. A safety snapshot of the current state is taken first. */
export async function restoreSnapshot(snapId: string): Promise<boolean> {
  const snap = await db.snapshots.get(snapId);
  if (!snap) return false;
  const pageId = snap.pageId;
  if (!(await db.nodes.get(pageId))) return false;
  await takeSnapshot(pageId, { name: 'Before restore', auto: true });
  const { node, doc, objects, strokes } = snap.payload;
  await db.transaction('rw', db.nodes, db.docs, db.canvasObjects, db.strokes, async () => {
    await db.nodes.update(pageId, { title: node.title, icon: node.icon, color: node.color, cover: node.cover, mode: node.mode, tags: node.tags, status: node.status, updatedAt: Date.now() });
    if (doc) await repo.saveDoc({ pageId, content: doc.content, text: doc.text, links: doc.links, tags: doc.tags, headings: doc.headings });
    else await db.docs.delete(pageId);
    await db.canvasObjects.where('pageId').equals(pageId).delete();
    await db.strokes.where('pageId').equals(pageId).delete();
    if (objects.length) await db.canvasObjects.bulkAdd(objects);
    if (strokes.length) await db.strokes.bulkAdd(strokes);
  });
  useTabs.getState().renamePage(pageId, node.title);
  await peekCanvasDoc(pageId)?.reload();
  return true;
}

export const renameSnapshot = (id: string, name: string) => db.snapshots.update(id, { name, auto: false });
export const deleteSnapshot = (id: string) => db.snapshots.delete(id);
export const listSnapshots = (pageId: string) => db.snapshots.where('pageId').equals(pageId).sortBy('createdAt');

// ───────────── auto snapshots ─────────────
interface PageWatch { dirty: boolean; lastEdit: number; lastSnap: number; timer: number | undefined }
const watches = new Map<string, PageWatch>();
let started = false;

async function flush(pageId: string): Promise<void> {
  const w = watches.get(pageId);
  if (!w) return;
  window.clearTimeout(w.timer);
  w.timer = undefined;
  if (!w.dirty) return;
  w.dirty = false;
  w.lastSnap = Date.now();
  try { await takeSnapshot(pageId, { auto: true }); } catch { /* page may have been purged */ }
}

function markDirty(pageId: string | undefined): void {
  if (!pageId) return;
  let w = watches.get(pageId);
  if (!w) { w = { dirty: false, lastEdit: 0, lastSnap: 0, timer: undefined }; watches.set(pageId, w); }
  w.dirty = true;
  w.lastEdit = Date.now();
  window.clearTimeout(w.timer);
  const at = nextAutoSnapshotAt(w.lastSnap, w.lastEdit, AUTO_INTERVAL, QUIET);
  w.timer = window.setTimeout(() => void flush(pageId), Math.max(0, at - Date.now()));
}

/** Watch docs/objects/strokes for edits and snapshot pages: at most every 5 minutes of activity, and on tab close. */
export function startAutoSnapshots(): void {
  if (started) return;
  started = true;
  // Hooks run inside the write transaction: only record, never write.
  db.docs.hook('creating', (_k, obj) => { setTimeout(() => markDirty(obj.pageId), 0); });
  db.docs.hook('updating', (_m, _k, obj) => { setTimeout(() => markDirty(obj.pageId), 0); });
  db.canvasObjects.hook('creating', (_k, obj) => { setTimeout(() => markDirty(obj.pageId), 0); });
  db.canvasObjects.hook('updating', (_m, _k, obj) => { setTimeout(() => markDirty(obj.pageId), 0); });
  db.canvasObjects.hook('deleting', (_k, obj) => { setTimeout(() => markDirty(obj.pageId), 0); });
  db.strokes.hook('creating', (_k, obj) => { setTimeout(() => markDirty(obj.pageId), 0); });
  db.strokes.hook('deleting', (_k, obj) => { setTimeout(() => markDirty(obj.pageId), 0); });

  const openPages = () => {
    const s = new Set<string>();
    for (const p of useTabs.getState().panes) for (const t of p.tabs) if (t.kind === 'page' && t.pageId) s.add(t.pageId);
    return s;
  };
  let prev = openPages();
  useTabs.subscribe(() => {
    const cur = openPages();
    for (const id of prev) if (!cur.has(id)) void flush(id);
    prev = cur;
  });
}
