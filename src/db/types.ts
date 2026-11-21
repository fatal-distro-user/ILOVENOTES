/** Persistent entity types. All ids are nanoid strings; timestamps are epoch ms. */

export type ID = string;
export type PageMode = 'document' | 'canvas' | 'pdf' | 'hybrid';
export type NodeKind = 'folder' | 'section' | 'page';

export interface Workspace { id: ID; name: string; createdAt: number; updatedAt: number }

export interface Notebook {
  id: ID; workspaceId: ID; name: string; icon: string; color: string; order: number;
  createdAt: number; updatedAt: number; deletedAt: number;
}

/** Folder / section / page / sub-page tree inside a notebook. Pages may parent sub-pages. */
export interface TreeNode {
  id: ID; workspaceId: ID; notebookId: ID; parentId: ID | null; kind: NodeKind;
  title: string; icon: string; color: string; cover: string; order: number;
  /** 1/0 so it can be indexed */
  starred: 0 | 1;
  mode: PageMode; tags: string[];
  createdAt: number; updatedAt: number; openedAt: number;
  /** 0 when not trashed; otherwise the trash timestamp (shared by a cascaded trash batch) */
  deletedAt: number;
  /** YYYY-MM-DD for daily notes */
  dailyDate?: string;
  /** Kanban column assignment */
  status?: string;
  templateId?: string;
}

/** Block document (TipTap/ProseMirror JSON) plus derived index data. */
export interface PageDoc {
  pageId: ID;
  content: unknown;
  text: string;
  links: string[];
  tags: string[];
  headings: string[];
  updatedAt: number;
}

export type CanvasObjectType =
  | 'sticky' | 'text' | 'shape' | 'image' | 'code' | 'math' | 'connector' | 'group'
  | 'paint' | 'pdfpage' | 'audio' | 'frame' | 'embed' | 'mindnode';

export interface CanvasObject {
  id: ID; pageId: ID; type: CanvasObjectType;
  x: number; y: number; w: number; h: number; rotation: number; z: number;
  locked: boolean; groupId: ID | null;
  data: Record<string, unknown>;
  createdAt: number; updatedAt: number;
}

/** Vector ink stroke. points = flat [x, y, pressure, tMs, ...]. */
export interface Stroke {
  id: ID; pageId: ID; points: number[]; color: string; width: number; opacity: number;
  tool: string; createdAt: number;
  /** audio-synced ink: recording id + offset (ms) from recording start */
  audioId?: ID; audioOffset?: number;
  /** when attached to a PDF page */
  pdfId?: ID; pdfPage?: number;
}

export interface RasterDoc {
  id: ID; pageId: ID; ownerId: ID; width: number; height: number; background: string;
  activeLayerId: ID | null; fps: number; createdAt: number; updatedAt: number;
  name?: string;
  /** flattened PNG preview used by canvas/document thumbnails */
  preview?: Blob;
  /** animation settings */
  anim?: { enabled: boolean; mode: 'loop' | 'pingpong' | 'once'; onionPrev: number; onionNext: number; onionOpacity: number; prevTint: string; nextTint: string };
}

export type LayerKind = 'raster' | 'vector' | 'text' | 'adjustment' | 'group';
export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface Layer {
  id: ID; docId: ID; name: string; kind: LayerKind; order: number; opacity: number; blend: BlendMode;
  visible: boolean; locked: boolean; alphaLock: boolean; clip: boolean; isReference: boolean;
  hasMask: boolean; maskEnabled: boolean; parentId: ID | null;
  data: Record<string, unknown>;
}

/** 256x256 raster tile of a layer channel, stored as PNG blob. */
export interface Tile { id: string; layerId: ID; docId: ID; tx: number; ty: number; channel: 'color' | 'mask'; blob: Blob }

export interface AnimFrame { id: ID; docId: ID; order: number; layerIds: ID[]; hold: number }

export interface PdfFile { id: ID; pageId: ID; name: string; data: Blob; pageCount: number; createdAt: number }

export type AnnotationType = 'highlight' | 'ink' | 'sticky' | 'underline' | 'strike';
export interface Annotation {
  id: ID; pdfId: ID; pageIndex: number; type: AnnotationType; color: string;
  /** highlight rects in PDF page units [x, y, w, h][] */
  rects?: number[][];
  /** ink points in PDF page units, flat [x, y, p, ...] */
  points?: number[]; width?: number;
  x?: number; y?: number; text?: string; createdAt: number;
}

export interface AudioClip {
  id: ID; pageId: ID; name: string; blob: Blob; mime: string; durationMs: number; createdAt: number;
  canvasX?: number; canvasY?: number;
}

export interface SnapshotPayload {
  node: TreeNode; doc: PageDoc | null; objects: CanvasObject[]; strokes: Stroke[];
}
export interface Snapshot { id: ID; pageId: ID; createdAt: number; name: string; auto: boolean; payload: SnapshotPayload; size: number }

export interface BrushPresetRecord { id: ID; name: string; builtin: boolean; params: Record<string, unknown>; order: number }
export interface Palette { id: ID; name: string; colors: string[]; createdAt: number }

export interface SrsReview { id: string; pageId: ID; ease: number; interval: number; reps: number; lapses: number; due: number; last: number }

export interface SavedSearch { id: ID; workspaceId: ID; name: string; query: string; tags: string[]; createdAt: number }

export interface SettingRow { key: string; value: unknown }
