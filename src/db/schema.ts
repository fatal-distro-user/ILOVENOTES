import Dexie, { type EntityTable } from 'dexie';
import type {
  Workspace, Notebook, TreeNode, PageDoc, CanvasObject, Stroke, RasterDoc, Layer, Tile, AnimFrame,
  PdfFile, Annotation, AudioClip, Snapshot, BrushPresetRecord, Palette, SrsReview, SavedSearch, SettingRow,
} from './types';

export class IlnDB extends Dexie {
  workspaces!: EntityTable<Workspace, 'id'>;
  notebooks!: EntityTable<Notebook, 'id'>;
  nodes!: EntityTable<TreeNode, 'id'>;
  docs!: EntityTable<PageDoc, 'pageId'>;
  canvasObjects!: EntityTable<CanvasObject, 'id'>;
  strokes!: EntityTable<Stroke, 'id'>;
  rasterDocs!: EntityTable<RasterDoc, 'id'>;
  layers!: EntityTable<Layer, 'id'>;
  tiles!: EntityTable<Tile, 'id'>;
  animFrames!: EntityTable<AnimFrame, 'id'>;
  pdfs!: EntityTable<PdfFile, 'id'>;
  annotations!: EntityTable<Annotation, 'id'>;
  audio!: EntityTable<AudioClip, 'id'>;
  snapshots!: EntityTable<Snapshot, 'id'>;
  brushes!: EntityTable<BrushPresetRecord, 'id'>;
  palettes!: EntityTable<Palette, 'id'>;
  srsReviews!: EntityTable<SrsReview, 'id'>;
  savedSearches!: EntityTable<SavedSearch, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor(name = 'ilovenotes') {
    super(name);
    this.version(1).stores({
      workspaces: 'id, name',
      notebooks: 'id, workspaceId, order, deletedAt',
      nodes: 'id, workspaceId, notebookId, parentId, [notebookId+parentId], kind, starred, openedAt, updatedAt, deletedAt, dailyDate, status, *tags',
      docs: 'pageId, updatedAt, *links, *tags',
      canvasObjects: 'id, pageId, type, groupId',
      strokes: 'id, pageId, audioId, pdfId, createdAt',
      rasterDocs: 'id, pageId, ownerId',
      layers: 'id, docId, order, parentId',
      tiles: 'id, layerId, docId',
      animFrames: 'id, docId, order',
      pdfs: 'id, pageId',
      annotations: 'id, pdfId, [pdfId+pageIndex]',
      audio: 'id, pageId, createdAt',
      snapshots: 'id, pageId, createdAt',
      brushes: 'id, order',
      palettes: 'id, createdAt',
      srsReviews: 'id, pageId, due',
      savedSearches: 'id, workspaceId',
      settings: 'key',
    });
  }
}

export let db = new IlnDB();

/** Replace the active database (used by tests and workspace import). */
export function switchDatabase(name: string): IlnDB {
  db.close();
  db = new IlnDB(name);
  return db;
}
