/**
 * Brush dynamics: converts stabilized stroke points into a sequence of dabs (stamps), applying spacing,
 * pressure / tilt / velocity response, jitter, scatter and start/end tapering. Pure & deterministic
 * (seeded RNG) so a stroke can be re-rendered identically (taper-end finalisation, time-lapse replay).
 */
import type { StrokePoint } from '../stabilizer';
import type { BrushParams } from './types';

export interface Dab {
  x: number; y: number;
  /** diameter px */
  size: number;
  /** alpha 0..1 (flow × dynamics) */
  alpha: number;
  /** radians */
  angle: number;
  roundness: number;
  pressure: number;
  /** distance along the stroke (px) */
  dist: number;
  /** stroke direction (radians) */
  dir: number;
  tiltX: number; tiltY: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smooth taper curve (ease-out) */
const taperCurve = (t: number) => Math.sin((clamp01(t) * Math.PI) / 2);

export interface DabOptions {
  seed: number;
  /** total stroke length, when known (enables taper end) */
  totalLength?: number;
  /** device lacks pressure (mouse) — pressure already simulated by the stabilizer */
  zoom?: number;
}

export class DabGenerator {
  private last: StrokePoint | null = null;
  /** distance travelled since the last dab */
  private residual = 0;
  private travelled = 0;
  private rnd: () => number;
  private dir = 0;
  private emittedFirst = false;

  constructor(private readonly brush: BrushParams, private readonly opts: DabOptions) {
    this.rnd = mulberry32(opts.seed);
  }

  get distance(): number { return this.travelled; }

  private dabAt(p: StrokePoint): Dab {
    const b = this.brush;
    const pressure = clamp01(p.pressure);
    const tilt = Math.min(1, Math.hypot(p.tiltX, p.tiltY) / 90);
    let size = b.size * lerp(1, lerp(b.minSize, 1, pressure), b.pressureSize);
    // Velocity response (px/ms): fountain pen thins when fast.
    if (b.velocitySize) size *= Math.max(0.15, 1 - b.velocitySize * Math.min(1, p.velocity / 3));
    size *= 1 + tilt * b.tiltShading * 1.5;
    let alpha = b.flow * lerp(1, pressure, b.pressureOpacity) * (1 - tilt * b.tiltShading * 0.55);
    // Tapers.
    if (b.taperStart > 0) size *= lerp(0.08, 1, taperCurve(this.travelled / b.taperStart));
    if (b.taperEnd > 0 && this.opts.totalLength !== undefined) {
      size *= lerp(0.08, 1, taperCurve((this.opts.totalLength - this.travelled) / b.taperEnd));
    }
    // Jitter.
    if (b.sizeJitter) size *= 1 - b.sizeJitter * this.rnd();
    if (b.opacityJitter) alpha *= 1 - b.opacityJitter * this.rnd();
    let angle = (b.angle * Math.PI) / 180;
    if (b.angleMode === 'direction') angle += this.dir;
    else if (b.angleMode === 'tilt' && (p.tiltX || p.tiltY)) angle += Math.atan2(p.tiltY, p.tiltX);
    if (b.angleJitter) angle += (this.rnd() - 0.5) * 2 * Math.PI * b.angleJitter;
    let x = p.x, y = p.y;
    if (b.scatter) {
      const r = b.scatter * size * this.rnd(), a = this.rnd() * Math.PI * 2;
      x += Math.cos(a) * r; y += Math.sin(a) * r;
    }
    if (b.pixelPerfect || b.tip === 'pixel') {
      size = Math.max(1, Math.round(size));
      // Snap dab centre to the pixel grid: odd sizes centre on pixel centres.
      const off = size % 2 ? 0.5 : 0;
      x = Math.floor(x) + off; y = Math.floor(y) + off;
    }
    return { x, y, size: Math.max(0.3, size), alpha: clamp01(alpha), angle, roundness: b.roundness, pressure, dist: this.travelled, dir: this.dir, tiltX: p.tiltX, tiltY: p.tiltY };
  }

  /** Feed stroke points; returns dabs to stamp. */
  push(points: StrokePoint[]): Dab[] {
    const dabs: Dab[] = [];
    for (const p of points) {
      if (!this.last) {
        this.last = p;
        dabs.push(this.dabAt(p));
        this.emittedFirst = true;
        continue;
      }
      const a = this.last;
      const dx = p.x - a.x, dy = p.y - a.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 1e-6) { this.last = p; continue; }
      const targetDir = Math.atan2(dy, dx);
      // Smooth direction changes for direction-following tips.
      const diff = Math.atan2(Math.sin(targetDir - this.dir), Math.cos(targetDir - this.dir));
      this.dir = this.travelled === 0 ? targetDir : this.dir + diff * 0.5;
      let pos = 0;
      while (true) {
        const t0 = pos / segLen;
        const curSize = Math.max(0.5, this.brush.size * lerp(1, lerp(this.brush.minSize, 1, lerp(a.pressure, p.pressure, t0)), this.brush.pressureSize));
        const step = this.brush.tip === 'pixel' || this.brush.pixelPerfect ? 1 : Math.max(0.5, this.brush.spacing * curSize);
        const need = step - this.residual;
        if (pos + need > segLen) {
          // Carry the leftover distance into the next segment.
          this.residual += segLen - pos;
          this.travelled += segLen - pos;
          break;
        }
        pos += need;
        this.residual = 0;
        const t = pos / segLen;
        this.travelled += need;
        const q: StrokePoint = {
          x: a.x + dx * t, y: a.y + dy * t, pressure: lerp(a.pressure, p.pressure, t), t: lerp(a.t, p.t, t),
          tiltX: lerp(a.tiltX, p.tiltX, t), tiltY: lerp(a.tiltY, p.tiltY, t), velocity: lerp(a.velocity, p.velocity, t),
        };
        dabs.push(this.dabAt(q));
      }
      this.last = p;
    }
    return dabs;
  }

  hasDabs(): boolean { return this.emittedFirst; }
}

/** Total polyline length of stroke points. */
export function strokeLength(points: { x: number; y: number }[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return l;
}

/** Compute every dab for a complete stroke (used for final render with taper end and for replay). */
export function computeDabs(points: StrokePoint[], brush: BrushParams, seed: number): Dab[] {
  const g = new DabGenerator(brush, { seed, totalLength: strokeLength(points) });
  return g.push(points);
}
