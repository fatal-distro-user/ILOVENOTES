import type { BlendMode } from '@/db/types';

export type BrushTip = 'round' | 'chisel' | 'square' | 'pixel' | 'bristle' | 'spray' | 'charcoal' | 'pencil';
export type BrushMode = 'paint' | 'erase' | 'smudge' | 'blur' | 'sharpen' | 'clone' | 'heal';
export type AngleMode = 'fixed' | 'direction' | 'tilt';
export type DitherPattern = 'none' | 'bayer2' | 'bayer4' | 'checker' | 'lines';

export interface BrushParams {
  id: string;
  name: string;
  category: 'ink' | 'sketch' | 'paint' | 'airbrush' | 'pixel' | 'retouch' | 'eraser' | 'custom';
  tip: BrushTip;
  mode: BrushMode;
  /** diameter in px at full pressure */
  size: number;
  /** fraction of size at zero pressure (0..1) */
  minSize: number;
  opacity: number;
  /** per-dab alpha (0..1); opacity caps the stroke total */
  flow: number;
  /** dab spacing as a fraction of the current diameter */
  spacing: number;
  hardness: number;
  angle: number;
  roundness: number;
  angleMode: AngleMode;
  /** random offset perpendicular/along the stroke as a fraction of size */
  scatter: number;
  sizeJitter: number;
  opacityJitter: number;
  angleJitter: number;
  /** taper lengths in px */
  taperStart: number;
  taperEnd: number;
  /** paper grain texture strength (0..1) and scale */
  grain: number;
  grainScale: number;
  /** how much pressure affects size / opacity (0..1) */
  pressureSize: number;
  pressureOpacity: number;
  /** stylus tilt widens the tip and lowers opacity (pencil shading) */
  tiltShading: number;
  /** -1..1: positive = faster strokes get thinner (fountain pen) */
  velocitySize: number;
  blend: BlendMode;
  /** watercolor: how much the dab picks up underlying colour (0..1) */
  wetness: number;
  /** impasto / bristle count for bristle tips */
  bristles: number;
  /** pixel brush */
  pixelPerfect: boolean;
  dither: DitherPattern;
  /** stroke stabilization default for this brush (0..1) */
  streamline: number;
  /** blur/sharpen/smudge strength (0..1) */
  strength: number;
}
