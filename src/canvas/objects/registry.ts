import type { ComponentType } from 'react';
import type { CanvasObject, CanvasObjectType } from '@/db/types';
import type { CanvasDoc } from '../doc';

export interface ObjectViewProps {
  obj: CanvasObject;
  doc: CanvasDoc;
  editing: boolean;
  selected: boolean;
  zoom: number;
}

export interface ObjectTypeDef {
  type: CanvasObjectType;
  component: ComponentType<ObjectViewProps>;
  /** Objects whose content is editable text start editing on double-click. */
  editable?: boolean;
  /** Keep aspect ratio while resizing (images). */
  lockAspect?: boolean;
  /** Render in the SVG overlay layer instead of a positioned box (connectors). */
  svgLayer?: boolean;
  /** Minimum size in world units. */
  minSize?: { w: number; h: number };
  /** Plain-text representation (search, export, OCR). */
  toText?: (obj: CanvasObject) => string;
  /** Double-click action for non-text objects (e.g. open a paint frame in the studio). */
  onOpen?: (obj: CanvasObject, doc: CanvasDoc) => void;
  /** SVG markup for vector export (in world coords). */
  toSvg?: (obj: CanvasObject) => string;
}

const types = new Map<CanvasObjectType, ObjectTypeDef>();
export function registerObjectType(def: ObjectTypeDef): void { types.set(def.type, def); }
export function objectType(t: CanvasObjectType): ObjectTypeDef | undefined { return types.get(t); }
