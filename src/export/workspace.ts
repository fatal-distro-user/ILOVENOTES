/**
 * Workspace archive (.ilovenotes / .zip): JSON tables + binary assets in a zip, and a single-file .json
 * variant with base64 assets. Import always creates a NEW workspace with every id remapped, so importing
 * a backup next to its original never collides.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import type { Workspace } from '@/db/types';

export const ARCHIVE_FORMAT = 'ilovenotes-workspace';
export const ARCHIVE_VERSION = 1;

type Row = Record<string, unknown>;
interface Tables {
  workspaces: Row[]; notebooks: Row[]; nodes: Row[]; docs: Row[]; canvasObjects: Row[]; strokes: Row[];
  rasterDocs: Row[]; layers: Row[]; tiles: Row[]; animFrames: Row[]; pdfs: Row[]; annotations: Row[];
  audio: Row[]; snapshots: Row[]; savedSearches: Row[]; srsReviews: Row[]; settings: Row[];
}

/** Blob fields per table (moved into separate archive files). */
const BLOB_FIELDS: Partial<Record<keyof Tables, string>> = { rasterDocs: 'preview', tiles: 'blob', pdfs: 'data', audio: 'blob' };

export async function collectWorkspace(workspaceId: string): Promise<Tables> {
  const ws = await db.workspaces.get(workspaceId);
  if (!ws) throw new Error('Workspace not found');
  const notebooks = await db.notebooks.where('workspaceId').equals(workspaceId).toArray();
  const nodes = await db.nodes.where('workspaceId').equals(workspaceId).toArray();
  const pageIds = nodes.map((n) => n.id);
  const rasterDocs = pageIds.length ? await db.rasterDocs.where('pageId').anyOf(pageIds).toArray() : [];
  const rdIds = rasterDocs.map((r) => r.id);
  const pdfs = pageIds.length ? await db.pdfs.where('pageId').anyOf(pageIds).toArray() : [];
  const pageScoped = <T>(t: { where(i: string): { anyOf(v: string[]): { toArray(): Promise<T[]> } } }) => (pageIds.length ? t.where('pageId').anyOf(pageIds).toArray() : Promise.resolve([] as T[]));
  // Settings that belong to this workspace's pages (canvas camera/settings, kanban columns …).
  const settings = (await db.settings.toArray()).filter((s) => pageIds.some((id) => s.key.endsWith(`:${id}`)));
  return {
    workspaces: [ws as unknown as Row],
    notebooks: notebooks as unknown as Row[],
    nodes: nodes as unknown as Row[],
    docs: (await db.docs.bulkGet(pageIds)).filter(Boolean) as unknown as Row[],
    canvasObjects: await pageScoped(db.canvasObjects as never),
    strokes: await pageScoped(db.strokes as never),
    rasterDocs: rasterDocs as unknown as Row[],
    layers: rdIds.length ? (await db.layers.where('docId').anyOf(rdIds).toArray()) as unknown as Row[] : [],
    tiles: rdIds.length ? (await db.tiles.where('docId').anyOf(rdIds).toArray()) as unknown as Row[] : [],
    animFrames: rdIds.length ? (await db.animFrames.where('docId').anyOf(rdIds).toArray()) as unknown as Row[] : [],
    pdfs: pdfs as unknown as Row[],
    annotations: pdfs.length ? (await db.annotations.where('pdfId').anyOf(pdfs.map((p) => p.id)).toArray()) as unknown as Row[] : [],
    audio: await pageScoped(db.audio as never),
    snapshots: await pageScoped(db.snapshots as never),
    savedSearches: (await db.savedSearches.where('workspaceId').equals(workspaceId).toArray()) as unknown as Row[],
    srsReviews: await pageScoped(db.srsReviews as never),
    settings: settings as unknown as Row[],
  };
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** Build the zip archive. */
export async function exportWorkspaceArchive(workspaceId: string): Promise<Uint8Array> {
  const t = await collectWorkspace(workspaceId);
  const files: Record<string, Uint8Array> = {};
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(t) as [keyof Tables, Row[]][]) {
    const field = BLOB_FIELDS[name];
    tables[name] = await Promise.all(rows.map(async (r, i) => {
      if (!field || !(r[field] instanceof Blob)) return r;
      const blob = r[field] as Blob;
      const path = `assets/${name}/${i}`;
      files[path] = await bytes(blob);
      return { ...r, [field]: { $blob: path, type: blob.type } };
    }));
  }
  const manifest = { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, exportedAt: new Date().toISOString(), app: 'ILOVENOTES', workspace: (t.workspaces[0] as unknown as Workspace).name, counts: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.length])) };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  for (const [name, rows] of Object.entries(tables)) files[`data/${name}.json`] = strToU8(JSON.stringify(rows));
  // Assets are already compressed (PNG/PDF/audio) → store them; compress JSON.
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: k.startsWith('assets/') ? 0 : 6 }]])) as never);
}

/** Single JSON file with base64 assets. */
export async function exportWorkspaceJson(workspaceId: string): Promise<string> {
  const t = await collectWorkspace(workspaceId);
  const out: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(t) as [keyof Tables, Row[]][]) {
    const field = BLOB_FIELDS[name];
    out[name] = await Promise.all(rows.map(async (r) => {
      if (!field || !(r[field] instanceof Blob)) return r;
      const b = r[field] as Blob;
      return { ...r, [field]: { $base64: btoa(Array.from(await bytes(b), (c) => String.fromCharCode(c)).join('')), type: b.type } };
    }));
  }
  return JSON.stringify({ format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, exportedAt: new Date().toISOString(), tables: out });
}

// ───────────────────────── import ─────────────────────────

/** Replace every string equal to an old id (or "id:<old>", or containing it as a ':'-separated segment for tile ids). */
export function remapIds<T>(value: T, map: Map<string, string>): T {
  const fix = (s: string): string => {
    const direct = map.get(s);
    if (direct) return direct;
    if (s.startsWith('id:')) { const m = map.get(s.slice(3)); if (m) return `id:${m}`; }
    if (s.includes(':')) {
      const parts = s.split(':');
      if (parts.some((p) => map.has(p))) return parts.map((p) => map.get(p) ?? p).join(':');
    }
    return s;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Blob)) return Object.fromEntries(Object.entries(v as Row).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Ids defined by the archive (primary keys). Tiles/settings/srs keys are derived and remapped by segment. */
function collectIds(tables: Partial<Tables>): Map<string, string> {
  const map = new Map<string, string>();
  for (const name of ['workspaces', 'notebooks', 'nodes', 'canvasObjects', 'strokes', 'rasterDocs', 'layers', 'animFrames', 'pdfs', 'annotations', 'audio', 'snapshots', 'savedSearches'] as (keyof Tables)[]) {
    for (const r of tables[name] ?? []) if (typeof r.id === 'string' && r.id.length >= 6) map.set(r.id, nanoid());
  }
  return map;
}

export interface ImportResult { workspaceId: string; name: string; pages: number }

async function writeTables(tables: Partial<Tables>, resolveBlob: (ref: { $blob?: string; $base64?: string; type?: string }) => Blob): Promise<ImportResult> {
  const map = collectIds(tables);
  const remapped = remapIds(tables, map);
  const restoreBlobs = (name: keyof Tables, rows: Row[]) => {
    const field = BLOB_FIELDS[name];
    if (!field) return rows;
    return rows.map((r) => (r[field] && typeof r[field] === 'object' ? { ...r, [field]: resolveBlob(r[field] as { $blob?: string }) } : r));
  };
  const ws = (remapped.workspaces?.[0] ?? null) as unknown as Workspace | null;
  if (!ws) throw new Error('Archive contains no workspace');
  const existingNames = new Set((await db.workspaces.toArray()).map((w) => w.name));
  const name = existingNames.has(ws.name) ? `${ws.name} (imported)` : ws.name;
  const t = Date.now();
  await db.transaction('rw', [db.workspaces, db.notebooks, db.nodes, db.docs, db.canvasObjects, db.strokes, db.rasterDocs, db.layers, db.tiles, db.animFrames, db.pdfs, db.annotations, db.audio, db.snapshots, db.savedSearches, db.srsReviews, db.settings], async () => {
    await db.workspaces.add({ ...ws, name, updatedAt: t });
    const put = async (name: keyof Tables) => {
      const rows = restoreBlobs(name, (remapped[name] ?? []) as Row[]);
      if (!rows.length) return;
      // Tables are typed per entity; rows were produced by our own exporter so the shapes match.
      await (db[name as keyof typeof db] as unknown as { bulkPut(r: Row[]): Promise<unknown> }).bulkPut(rows);
    };
    for (const n of ['notebooks', 'nodes', 'docs', 'canvasObjects', 'strokes', 'rasterDocs', 'layers', 'tiles', 'animFrames', 'pdfs', 'annotations', 'audio', 'snapshots', 'savedSearches', 'srsReviews', 'settings'] as (keyof Tables)[]) await put(n);
  });
  return { workspaceId: ws.id, name, pages: (remapped.nodes ?? []).filter((n) => n.kind === 'page').length };
}

export async function importWorkspaceArchive(data: Uint8Array): Promise<ImportResult> {
  // JSON variant?
  if (data[0] === 0x7b) return importWorkspaceJson(strFromU8(data));
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(data); } catch { throw new Error('Not a valid .ilovenotes / .zip archive'); }
  const manifest = files['manifest.json'] ? JSON.parse(strFromU8(files['manifest.json'])) as { format?: string; version?: number } : null;
  if (manifest?.format !== ARCHIVE_FORMAT) throw new Error('This archive was not created by ILOVENOTES');
  if ((manifest.version ?? 0) > ARCHIVE_VERSION) throw new Error('Archive was made by a newer version of ILOVENOTES');
  const tables: Partial<Tables> = {};
  for (const [path, content] of Object.entries(files)) {
    const m = /^data\/(\w+)\.json$/.exec(path);
    if (m) tables[m[1] as keyof Tables] = JSON.parse(strFromU8(content)) as Row[];
  }
  return writeTables(tables, (ref) => new Blob([(files[ref.$blob ?? ''] ?? new Uint8Array()) as BlobPart], { type: ref.type ?? '' }));
}

export async function importWorkspaceJson(text: string): Promise<ImportResult> {
  const parsed = JSON.parse(text) as { format?: string; tables?: Partial<Tables> };
  if (parsed.format !== ARCHIVE_FORMAT || !parsed.tables) throw new Error('Not an ILOVENOTES workspace JSON file');
  return writeTables(parsed.tables, (ref) => new Blob([Uint8Array.from(atob(ref.$base64 ?? ''), (c) => c.charCodeAt(0)) as BlobPart], { type: ref.type ?? '' }));
}
