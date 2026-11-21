/**
 * Paint tool registry. Each tool receives doc-space pointer samples and manages its own RasterEdit.
 * Brushes, fill, selection, transform, eyedropper and retouch tools register here from their modules.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PaintDocument } from '../engine/document';

export interface PaintPointer {
  x: number; y: number; pressure: number; tiltX: number; tiltY: number; t: number;
  pointerType: string; shift: boolean; alt: boolean; mod: boolean; button: number;
}

export interface ToolContext {
  doc: PaintDocument;
  zoom: number;
  /** request an overlay redraw (cursor previews, marching ants, transform handles) */
  redrawOverlay(): void;
  /** convert screen px → doc px (for hit radii) */
  screenToDoc(px: number): number;
}

export interface ToolSession {
  move(p: PaintPointer): void;
  up(p: PaintPointer): void;
  cancel?(): void;
}

export interface PaintToolDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** single-key shortcut */
  key?: string;
  group: 'paint' | 'select' | 'fill' | 'transform' | 'retouch' | 'view' | 'guide';
  order?: number;
  cursor?: (ctx: ToolContext) => string;
  down(ctx: ToolContext, p: PaintPointer): ToolSession | null;
  /** draw tool-specific overlay (screen space ctx already transformed to doc space) */
  drawOverlay?(ctx: ToolContext, g: CanvasRenderingContext2D, hover: PaintPointer | null): void;
  /** options bar shown above the surface while the tool is active */
  Options?: ComponentType<{ doc: PaintDocument }>;
  onKey?(ctx: ToolContext, e: KeyboardEvent): boolean;
}

const tools = new Map<string, PaintToolDef>();
const listeners = new Set<() => void>();
let snapshot: PaintToolDef[] = [];

export function registerPaintTool(def: PaintToolDef): void {
  tools.set(def.id, def);
  snapshot = Array.from(tools.values()).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  listeners.forEach((l) => l());
}
export function paintTool(id: string): PaintToolDef | undefined { return tools.get(id); }
export function paintTools(): PaintToolDef[] { return snapshot; }
export function subscribePaintTools(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }

/** Overlay painters contributed by guide modules (symmetry, perspective, rulers, selections). */
export type OverlayPainter = (ctx: ToolContext, g: CanvasRenderingContext2D) => void;
const overlays: OverlayPainter[] = [];
export function registerPaintOverlay(p: OverlayPainter): void { overlays.push(p); }
export function paintOverlays(): readonly OverlayPainter[] { return overlays; }

/** Pointer filters (stabilizer-independent constraints like rulers & perspective) applied before tools see samples. */
export type PointerConstraint = (doc: PaintDocument, p: PaintPointer, stroke: { start: PaintPointer; lock: unknown }) => PaintPointer;
const constraints: PointerConstraint[] = [];
export function registerPointerConstraint(c: PointerConstraint): void { constraints.push(c); }
export function pointerConstraints(): readonly PointerConstraint[] { return constraints; }
