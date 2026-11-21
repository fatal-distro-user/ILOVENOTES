/**
 * StreamLine stabilizer: weighted moving average + pull-string (lazy mouse) + Catmull-Rom densification.
 * Also derives velocity and a simulated pressure for devices without pressure (mouse / trackpad).
 */

export interface InputPoint { x: number; y: number; pressure: number; t: number; tiltX?: number; tiltY?: number; pointerType?: string }
export interface StrokePoint { x: number; y: number; pressure: number; t: number; tiltX: number; tiltY: number; velocity: number }

export interface StabilizerOptions {
  /** 0..1 — 0 = raw input, 1 = heavy smoothing */
  smoothing: number;
  mode: 'average' | 'pull' | 'both';
  /** max pull-string radius in px at smoothing=1 */
  pullRadius?: number;
  /** simulate pressure from velocity when device reports none (mouse) */
  simulatePressure?: boolean;
  /** Catmull-Rom output spacing in px */
  step?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class Stabilizer {
  private raw: StrokePoint[] = [];
  private filtered: StrokePoint[] = [];
  private emittedSegments = 0;
  private lazy: StrokePoint | null = null;
  private lastVel = 0;
  readonly opts: Required<StabilizerOptions>;

  constructor(opts: StabilizerOptions) {
    this.opts = { pullRadius: 40, simulatePressure: true, step: 1.5, ...opts, smoothing: Math.max(0, Math.min(1, opts.smoothing)) };
  }

  private toStroke(p: InputPoint): StrokePoint {
    const prev = this.raw.at(-1);
    let velocity = 0;
    if (prev) {
      const dt = Math.max(1, p.t - prev.t);
      velocity = Math.hypot(p.x - prev.x, p.y - prev.y) / dt; // px per ms
    }
    // Low-pass the velocity so tapering is smooth.
    this.lastVel = prev ? lerp(this.lastVel, velocity, 0.35) : 0;
    const noPressure = p.pointerType === 'mouse' || p.pressure === 0 || p.pressure === 0.5 && p.pointerType !== 'pen';
    let pressure = p.pressure;
    if (noPressure) pressure = this.opts.simulatePressure ? simulatedPressure(this.lastVel) : 0.5;
    return { x: p.x, y: p.y, pressure, t: p.t, tiltX: p.tiltX ?? 0, tiltY: p.tiltY ?? 0, velocity: this.lastVel };
  }

  /** Feed one input sample; returns newly finalised output points. */
  push(input: InputPoint): StrokePoint[] {
    const sp = this.toStroke(input);
    this.raw.push(sp);
    let f: StrokePoint | null = sp;
    const s = this.opts.smoothing;
    if (this.opts.mode !== 'average' && s > 0) f = this.pull(sp);
    if (f && this.opts.mode !== 'pull' && s > 0) f = this.average(f);
    if (!f) return [];
    this.filtered.push(f);
    return this.drain(false);
  }

  /** Flush remaining output (the pen lifted): the stroke catches up to the last real input point. */
  finish(): StrokePoint[] {
    const last = this.raw.at(-1);
    if (last && this.filtered.length) {
      const end = this.filtered.at(-1) as StrokePoint;
      if (Math.hypot(end.x - last.x, end.y - last.y) > 0.5) this.filtered.push({ ...last, pressure: end.pressure });
    } else if (last) this.filtered.push(last);
    return this.drain(true);
  }

  private pull(p: StrokePoint): StrokePoint | null {
    const radius = this.opts.pullRadius * this.opts.smoothing;
    if (!this.lazy) { this.lazy = { ...p }; return { ...p }; }
    const dx = p.x - this.lazy.x, dy = p.y - this.lazy.y;
    const d = Math.hypot(dx, dy);
    if (d <= radius) return null;
    const k = (d - radius) / d;
    this.lazy = { ...p, x: this.lazy.x + dx * k, y: this.lazy.y + dy * k };
    return { ...this.lazy };
  }

  private averageWindow: StrokePoint[] = [];
  private average(p: StrokePoint): StrokePoint {
    const size = 1 + Math.round(this.opts.smoothing * 24);
    this.averageWindow.push(p);
    if (this.averageWindow.length > size) this.averageWindow.shift();
    let wx = 0, wy = 0, wp = 0, wsum = 0;
    const n = this.averageWindow.length;
    for (let i = 0; i < n; i++) {
      const w = (i + 1) * (i + 1); // newer samples weigh more
      const q = this.averageWindow[i];
      wx += q.x * w; wy += q.y * w; wp += q.pressure * w; wsum += w;
    }
    return { ...p, x: wx / wsum, y: wy / wsum, pressure: wp / wsum };
  }

  /** Emit Catmull-Rom interpolated points for every complete segment. */
  private drain(final: boolean): StrokePoint[] {
    const f = this.filtered;
    const out: StrokePoint[] = [];
    if (f.length === 1 && final && this.emittedSegments === 0) { this.emittedSegments = 1; return [f[0]]; }
    // Segment i spans f[i] -> f[i+1]; it needs f[i+2] as the lookahead unless final.
    const lastSeg = final ? f.length - 1 : f.length - 2;
    for (let i = this.emittedSegments; i < lastSeg; i++) {
      const p0 = f[Math.max(0, i - 1)], p1 = f[i], p2 = f[i + 1], p3 = f[Math.min(f.length - 1, i + 2)];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const steps = Math.max(1, Math.ceil(dist / this.opts.step));
      if (i === 0) out.push(p1);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        out.push({
          x: catmullRom(p0.x, p1.x, p2.x, p3.x, t), y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
          pressure: lerp(p1.pressure, p2.pressure, t), t: lerp(p1.t, p2.t, t),
          tiltX: lerp(p1.tiltX, p2.tiltX, t), tiltY: lerp(p1.tiltY, p2.tiltY, t), velocity: lerp(p1.velocity, p2.velocity, t),
        });
      }
      this.emittedSegments = i + 1;
    }
    return out;
  }
}

/** Faster strokes → thinner (like a real pen): maps velocity (px/ms) to pressure 0.2..1. */
export function simulatedPressure(velocity: number): number {
  const v = Math.min(velocity, 4);
  return Math.max(0.2, 1 - v / 4.5);
}

/** Stabilize an entire recorded stroke at once (used for replay / vector smoothing). */
export function stabilizeAll(points: InputPoint[], opts: StabilizerOptions): StrokePoint[] {
  const s = new Stabilizer(opts);
  const out: StrokePoint[] = [];
  for (const p of points) out.push(...s.push(p));
  out.push(...s.finish());
  return out;
}
