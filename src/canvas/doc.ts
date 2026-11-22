/**
 * CanvasDoc: in-memory model of one canvas page (objects + vector strokes + selection + camera),
 * persisted write-through to IndexedDB, with every committed mutation recorded on a HistoryStack.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import type { CanvasObject, Stroke } from '@/db/types';
import { HistoryStack, type HistoryCommand } from '@/history/stack';
import { getSetting, setSetting } from '@/db/repo';
import type { Camera, Rect } from './camera';
import { rectUnion, rotatedBounds } from './camera';
import { strokeBounds } from './ink';
import type { BackgroundKind } from './tools';

export interface CanvasSettings { background: BackgroundKind; gridSize: number; bgColor: string | null }
export const DEFAULT_SETTINGS: CanvasSettings = { background: 'dot', gridSize: 24, bgColor: null };

export interface CanvasState {
  ready: boolean;
  objects: Record<string, CanvasObject>;
  strokes: Record<string, Stroke>;
  selection: string[];
  /** selected stroke ids (vector ink can be selected/moved/deleted too) */
  strokeSelection: string[];
  camera: Camera;
  settings: CanvasSettings;
  /** id of object whose text is being edited */
  editingId: string | null;
}

type Patch<T> = { put?: T[]; remove?: string[] };

export class CanvasDoc {
  readonly store: StoreApi<CanvasState>;
  readonly history = new HistoryStack({ limit: 200 });
  private camTimer: number | undefined;

  constructor(readonly pageId: string) {
    this.store = createStore<CanvasState>(() => ({
      ready: false, objects: {}, strokes: {}, selection: [], strokeSelection: [],
      camera: { x: -200, y: -120, zoom: 1 }, settings: DEFAULT_SETTINGS, editingId: null,
    }));
  }

  get state(): CanvasState { return this.store.getState(); }

  async load(): Promise<void> {
    const [objs, strokes, cam, settings] = await Promise.all([
      db.canvasObjects.where('pageId').equals(this.pageId).toArray(),
      db.strokes.where('pageId').equals(this.pageId).filter((s) => !s.pdfId).toArray(),
      getSetting<Camera | null>(`canvas-cam:${this.pageId}`, null),
      getSetting<CanvasSettings>(`canvas-settings:${this.pageId}`, DEFAULT_SETTINGS),
    ]);
    this.store.setState({
      ready: true,
      objects: Object.fromEntries(objs.map((o) => [o.id, o])),
      strokes: Object.fromEntries(strokes.map((s) => [s.id, s])),
      camera: cam ?? this.state.camera,
      settings: { ...DEFAULT_SETTINGS, ...settings },
    });
  }

  /** Re-read from the database (after version restore / import), keeping camera and clearing history. */
  async reload(): Promise<void> {
    const cam = this.state.camera;
    await this.load();
    this.store.setState({ camera: cam, selection: [], strokeSelection: [] });
    this.history.clear();
  }

  setCamera(camera: Camera): void {
    this.store.setState({ camera });
    window.clearTimeout(this.camTimer);
    this.camTimer = window.setTimeout(() => void setSetting(`canvas-cam:${this.pageId}`, camera), 400);
  }

  async setSettings(p: Partial<CanvasSettings>): Promise<void> {
    const settings = { ...this.state.settings, ...p };
    this.store.setState({ settings });
    await setSetting(`canvas-settings:${this.pageId}`, settings);
  }

  // ───────────── low-level apply (state + DB), no history ─────────────
  /** Updates state synchronously; returns the pending DB write. */
  private applyObjects(p: Patch<CanvasObject>): Promise<void> {
    this.store.setState((s) => {
      const objects = { ...s.objects };
      for (const id of p.remove ?? []) delete objects[id];
      for (const o of p.put ?? []) objects[o.id] = o;
      const alive = (id: string) => !!objects[id];
      return { objects, selection: s.selection.filter(alive), editingId: s.editingId && alive(s.editingId) ? s.editingId : null };
    });
    return this.persist(async () => {
      if (p.remove?.length) await db.canvasObjects.bulkDelete(p.remove);
      if (p.put?.length) await db.canvasObjects.bulkPut(p.put);
    });
  }

  /** DB writes are serialised so a later write can never land before an earlier one. */
  private writes: Promise<void> = Promise.resolve();
  private persist(fn: () => Promise<void>): Promise<void> {
    const next = this.writes.then(fn);
    this.writes = next.catch((e) => { console.error('Canvas persist failed', e); });
    return next;
  }

  private applyStrokes(p: Patch<Stroke>): Promise<void> {
    this.store.setState((s) => {
      const strokes = { ...s.strokes };
      for (const id of p.remove ?? []) delete strokes[id];
      for (const st of p.put ?? []) strokes[st.id] = st;
      return { strokes, strokeSelection: s.strokeSelection.filter((id) => !!strokes[id]) };
    });
    return this.persist(async () => {
      if (p.remove?.length) await db.strokes.bulkDelete(p.remove);
      if (p.put?.length) await db.strokes.bulkPut(p.put);
    });
  }

  /**
   * Commit a change as one undoable step. `after` objects/strokes are written; `removed` ids deleted.
   * The inverse is computed from the current state.
   */
  async commit(label: string, change: { objects?: Patch<CanvasObject>; strokes?: Patch<Stroke> }, kind: HistoryCommand['kind'] = 'object', before?: { objects?: CanvasObject[]; strokes?: Stroke[] }): Promise<void> {
    const s = this.state;
    const inv = (p: Patch<{ id: string }> | undefined, current: Record<string, { id: string }>, explicitBefore?: { id: string }[]) => {
      if (!p) return undefined;
      const beforeMap = new Map((explicitBefore ?? []).map((o) => [o.id, o]));
      const put: { id: string }[] = [];
      const remove: string[] = [];
      for (const o of p.put ?? []) {
        const prev = beforeMap.get(o.id) ?? current[o.id];
        if (prev) put.push(prev); else remove.push(o.id);
      }
      for (const id of p.remove ?? []) { const prev = beforeMap.get(id) ?? current[id]; if (prev) put.push(prev); }
      return { put, remove };
    };
    const undoObjects = inv(change.objects, s.objects, before?.objects) as Patch<CanvasObject> | undefined;
    const undoStrokes = inv(change.strokes, s.strokes, before?.strokes) as Patch<Stroke> | undefined;
    // State changes apply synchronously so the history entry exists before any later input is handled.
    const doIt = () => Promise.all([change.objects && this.applyObjects(change.objects), change.strokes && this.applyStrokes(change.strokes)]).then(() => undefined);
    const undoIt = () => Promise.all([undoObjects && this.applyObjects(undoObjects), undoStrokes && this.applyStrokes(undoStrokes)]).then(() => undefined);
    const pending = doIt();
    this.history.push({ label, kind, redo: doIt, undo: undoIt });
    await pending;
  }

  /** Transient (drag preview) update: state only, no DB, no history. */
  preview(objects: CanvasObject[], strokes: Stroke[] = []): void {
    this.store.setState((s) => {
      const o = { ...s.objects };
      for (const x of objects) o[x.id] = x;
      const st = strokes.length ? { ...s.strokes } : s.strokes;
      for (const x of strokes) st[x.id] = x;
      return { objects: o, strokes: st };
    });
  }

  // ───────────── helpers ─────────────
  maxZ(): number { return Math.max(0, ...Object.values(this.state.objects).map((o) => o.z)); }

  newObject(type: CanvasObject['type'], r: Rect, data: Record<string, unknown> = {}): CanvasObject {
    const t = Date.now();
    return { id: nanoid(), pageId: this.pageId, type, x: r.x, y: r.y, w: r.w, h: r.h, rotation: 0, z: this.maxZ() + 1, locked: false, groupId: null, data, createdAt: t, updatedAt: t };
  }

  async addObjects(objs: CanvasObject[], label = 'Add object', select = true): Promise<void> {
    await this.commit(label, { objects: { put: objs } });
    if (select) this.select(objs.map((o) => o.id));
  }

  async updateObjects(objs: CanvasObject[], label: string, before?: CanvasObject[]): Promise<void> {
    const t = Date.now();
    await this.commit(label, { objects: { put: objs.map((o) => ({ ...o, updatedAt: t })) } }, 'object', before ? { objects: before } : undefined);
  }

  async patchObjects(ids: string[], patch: (o: CanvasObject) => Partial<CanvasObject>, label: string): Promise<void> {
    const objs = ids.map((id) => this.state.objects[id]).filter(Boolean);
    if (!objs.length) return;
    await this.updateObjects(objs.map((o) => ({ ...o, ...patch(o) })), label);
  }

  async deleteSelection(): Promise<void> {
    const { selection, strokeSelection, objects } = this.state;
    const ids = selection.filter((id) => !objects[id]?.locked);
    // Deleting an object also deletes connectors attached to it.
    const attached = Object.values(objects).filter((o) => o.type === 'connector' && (ids.includes(String(o.data.from ?? '')) || ids.includes(String(o.data.to ?? '')))).map((o) => o.id);
    const remove = Array.from(new Set([...ids, ...attached]));
    if (!remove.length && !strokeSelection.length) return;
    await this.commit(`Delete ${remove.length + strokeSelection.length} item(s)`, { objects: { remove }, strokes: { remove: strokeSelection } });
    this.store.setState({ selection: [], strokeSelection: [] });
  }

  select(ids: string[], strokes: string[] = [], additive = false): void {
    // Selecting a grouped object selects its whole group.
    const objs = this.state.objects;
    const expanded = new Set<string>(additive ? this.state.selection : []);
    for (const id of ids) {
      const g = objs[id]?.groupId;
      if (g) Object.values(objs).forEach((o) => { if (o.groupId === g) expanded.add(o.id); });
      else expanded.add(id);
    }
    const st = new Set<string>(additive ? this.state.strokeSelection : []);
    strokes.forEach((s) => st.add(s));
    this.store.setState({ selection: Array.from(expanded), strokeSelection: Array.from(st), editingId: null });
  }

  clearSelection(): void { this.store.setState({ selection: [], strokeSelection: [], editingId: null }); }

  /** Types whose bounds derive from other objects (connectors) register a resolver. */
  static boundsResolvers = new Map<string, (o: CanvasObject, doc: CanvasDoc) => Rect>();
  objectBounds(o: CanvasObject): Rect {
    const r = CanvasDoc.boundsResolvers.get(o.type);
    return r ? r(o, this) : rotatedBounds({ x: o.x, y: o.y, w: o.w, h: o.h }, o.rotation);
  }

  selectionBounds(): Rect | null {
    const s = this.state;
    const rs = [
      ...s.selection.map((id) => s.objects[id]).filter(Boolean).map((o) => this.objectBounds(o)),
      ...s.strokeSelection.map((id) => s.strokes[id]).filter(Boolean).map((st) => strokeBounds(st.points, st.width)),
    ];
    return rectUnion(rs);
  }

  contentBounds(): Rect | null {
    const s = this.state;
    return rectUnion([
      ...Object.values(s.objects).map((o) => this.objectBounds(o)),
      ...Object.values(s.strokes).map((st) => strokeBounds(st.points, st.width)),
    ]);
  }
}

/** One CanvasDoc per page, shared by every view of that page (split panes, hybrid). */
const docs = new Map<string, { doc: CanvasDoc; refs: number }>();
export function acquireCanvasDoc(pageId: string): CanvasDoc {
  let e = docs.get(pageId);
  if (!e) { e = { doc: new CanvasDoc(pageId), refs: 0 }; docs.set(pageId, e); void e.doc.load(); }
  e.refs++;
  return e.doc;
}
export function releaseCanvasDoc(pageId: string): void {
  const e = docs.get(pageId);
  if (!e) return;
  if (--e.refs <= 0) docs.delete(pageId);
}
export function peekCanvasDoc(pageId: string): CanvasDoc | undefined { return docs.get(pageId)?.doc; }
