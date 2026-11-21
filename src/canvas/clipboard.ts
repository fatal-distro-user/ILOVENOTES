import { nanoid } from 'nanoid';
import type { CanvasObject, Stroke } from '@/db/types';
import type { CanvasDoc } from './doc';
import { offsetPoints } from './ink';

const TAG = 'ILOVENOTES_CANVAS:';
let internal: { objects: CanvasObject[]; strokes: Stroke[] } | null = null;

export async function copySelection(doc: CanvasDoc, cut = false): Promise<number> {
  const s = doc.state;
  const objects = s.selection.map((id) => s.objects[id]).filter(Boolean);
  // Include connectors whose both ends are inside the copied set.
  const ids = new Set(objects.map((o) => o.id));
  for (const o of Object.values(s.objects)) if (o.type === 'connector' && ids.has(String(o.data.from)) && ids.has(String(o.data.to)) && !ids.has(o.id)) objects.push(o);
  const strokes = s.strokeSelection.map((id) => s.strokes[id]).filter(Boolean);
  if (!objects.length && !strokes.length) return 0;
  internal = { objects, strokes };
  try { await navigator.clipboard.writeText(TAG + JSON.stringify(internal)); } catch { /* clipboard permission denied: internal clipboard still works */ }
  if (cut) await doc.deleteSelection();
  return objects.length + strokes.length;
}

async function readClipboard(): Promise<typeof internal> {
  try {
    const text = await navigator.clipboard.readText();
    if (text.startsWith(TAG)) return JSON.parse(text.slice(TAG.length)) as typeof internal;
  } catch { /* fall back to the internal clipboard */ }
  return internal;
}

/** Paste with fresh ids, offset (or centred at `at`), remapping group ids and connector endpoints. */
export async function pasteInto(doc: CanvasDoc, at?: { x: number; y: number }, data?: typeof internal): Promise<boolean> {
  const clip = data ?? (await readClipboard());
  if (!clip || (!clip.objects.length && !clip.strokes.length)) return false;
  const xs = [...clip.objects.map((o) => o.x), ...clip.strokes.flatMap((s) => s.points.filter((_, i) => i % 4 === 0))];
  const ys = [...clip.objects.map((o) => o.y), ...clip.strokes.flatMap((s) => s.points.filter((_, i) => i % 4 === 1))];
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const dx = at ? at.x - minX : 24, dy = at ? at.y - minY : 24;
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const o of clip.objects) idMap.set(o.id, nanoid());
  let z = doc.maxZ();
  const t = Date.now();
  const objects = clip.objects.map((o) => {
    const data = { ...o.data };
    if (o.type === 'connector') { data.from = idMap.get(String(data.from)) ?? null; data.to = idMap.get(String(data.to)) ?? null; }
    let groupId: string | null = null;
    if (o.groupId) { if (!groupMap.has(o.groupId)) groupMap.set(o.groupId, nanoid()); groupId = groupMap.get(o.groupId) ?? null; }
    return { ...o, id: idMap.get(o.id) as string, pageId: doc.pageId, x: o.x + dx, y: o.y + dy, z: ++z, groupId, data, locked: false, createdAt: t, updatedAt: t };
  });
  const strokes = clip.strokes.map((s) => ({ ...s, id: nanoid(), pageId: doc.pageId, points: offsetPoints(s.points, dx, dy), createdAt: t, audioId: undefined, audioOffset: undefined }));
  await doc.commit('Paste', { objects: { put: objects }, strokes: { put: strokes } });
  doc.select(objects.map((o) => o.id), strokes.map((s) => s.id));
  if (!at) internal = { objects, strokes };
  return true;
}

export async function duplicateSelection(doc: CanvasDoc): Promise<void> {
  const s = doc.state;
  const objects = s.selection.map((id) => s.objects[id]).filter(Boolean);
  const strokes = s.strokeSelection.map((id) => s.strokes[id]).filter(Boolean);
  await pasteInto(doc, undefined, { objects, strokes });
}
