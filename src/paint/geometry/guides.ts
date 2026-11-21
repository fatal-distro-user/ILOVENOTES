/**
 * Drawing guides: symmetry mirroring, perspective-grid snapping and ruler/protractor/french-curve constraints.
 * Every function maps document-space points; renderers draw the guide overlays from the same parameters.
 */
import type { Pt } from './quickshape';

// ───────────── Symmetry ─────────────

export type SymmetryMode = 'off' | 'vertical' | 'horizontal' | 'quadrant' | 'radial';
export interface SymmetryConfig { mode: SymmetryMode; center: Pt; segments: number; /** radial: also mirror within each segment (kaleidoscope) */ mirror: boolean; rotation: number }

export const DEFAULT_SYMMETRY: SymmetryConfig = { mode: 'off', center: { x: 0, y: 0 }, segments: 6, mirror: true, rotation: 0 };

/** All transforms (as point mappers) that a stroke should be replicated through, identity first. */
export function symmetryTransforms(cfg: SymmetryConfig): ((p: Pt) => Pt)[] {
  const { x: cx, y: cy } = cfg.center;
  const id = (p: Pt) => p;
  const mirrorAxis = (theta: number) => (p: Pt): Pt => {
    // Reflect across a line through the center at angle theta.
    const c = Math.cos(2 * theta), s = Math.sin(2 * theta), dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * c + dy * s, y: cy + dx * s - dy * c };
  };
  const rot = (a: number) => (p: Pt): Pt => {
    const c = Math.cos(a), s = Math.sin(a), dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  };
  const r = cfg.rotation;
  switch (cfg.mode) {
    case 'off': return [id];
    case 'vertical': return [id, mirrorAxis(Math.PI / 2 + r)];
    case 'horizontal': return [id, mirrorAxis(r)];
    case 'quadrant': return [id, mirrorAxis(Math.PI / 2 + r), mirrorAxis(r), rot(Math.PI)];
    case 'radial': {
      const n = Math.max(3, Math.min(16, Math.round(cfg.segments)));
      const out: ((p: Pt) => Pt)[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push(i === 0 ? id : rot(a));
        // Reflection axes of the dihedral group D_n sit at multiples of pi/n.
        if (cfg.mirror) out.push(mirrorAxis(r + (i * Math.PI) / n));
      }
      return out;
    }
  }
}

/** Guide lines (segments) for overlay rendering within a bounding box. */
export function symmetryGuideLines(cfg: SymmetryConfig, extent: number): [Pt, Pt][] {
  const { x: cx, y: cy } = cfg.center;
  const ray = (a: number, both = true): [Pt, Pt] => [
    both ? { x: cx - Math.cos(a) * extent, y: cy - Math.sin(a) * extent } : { x: cx, y: cy },
    { x: cx + Math.cos(a) * extent, y: cy + Math.sin(a) * extent },
  ];
  switch (cfg.mode) {
    case 'off': return [];
    case 'vertical': return [ray(Math.PI / 2 + cfg.rotation)];
    case 'horizontal': return [ray(cfg.rotation)];
    case 'quadrant': return [ray(cfg.rotation), ray(Math.PI / 2 + cfg.rotation)];
    case 'radial': {
      const n = Math.max(3, Math.min(16, Math.round(cfg.segments)));
      return Array.from({ length: n }, (_, i) => ray(cfg.rotation + (i / n) * Math.PI * 2 - Math.PI / 2, false));
    }
  }
}

// ───────────── Perspective ─────────────

export type PerspectiveMode = 'off' | '1pt' | '2pt' | 'isometric';
export interface PerspectiveConfig { mode: PerspectiveMode; vp1: Pt; vp2: Pt; horizonY: number; /** iso grid angle in degrees */ isoAngle: number }

export const DEFAULT_PERSPECTIVE: PerspectiveConfig = { mode: 'off', vp1: { x: 0, y: 0 }, vp2: { x: 1000, y: 0 }, horizonY: 0, isoAngle: 30 };

/** Candidate stroke directions (unit vectors) at a point for the active perspective. */
export function perspectiveDirections(cfg: PerspectiveConfig, at: Pt): Pt[] {
  const toward = (vp: Pt): Pt => { const dx = vp.x - at.x, dy = vp.y - at.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
  switch (cfg.mode) {
    case 'off': return [];
    case '1pt': return [toward(cfg.vp1), { x: 1, y: 0 }, { x: 0, y: 1 }];
    case '2pt': return [toward(cfg.vp1), toward(cfg.vp2), { x: 0, y: 1 }];
    case 'isometric': {
      const a = (cfg.isoAngle * Math.PI) / 180;
      return [{ x: Math.cos(a), y: -Math.sin(a) }, { x: Math.cos(a), y: Math.sin(a) }, { x: 0, y: 1 }];
    }
  }
}

/**
 * Snap a stroke to the perspective direction closest to its initial heading.
 * Returns the projected point for `p` given the stroke origin, or p itself when perspective is off.
 */
export function snapToPerspective(cfg: PerspectiveConfig, origin: Pt, p: Pt, lockedDir?: Pt): { point: Pt; dir: Pt | null } {
  if (cfg.mode === 'off') return { point: p, dir: null };
  const dx = p.x - origin.x, dy = p.y - origin.y;
  if (!lockedDir && Math.hypot(dx, dy) < 6) return { point: p, dir: null };
  let dir = lockedDir;
  if (!dir) {
    let best = -1;
    for (const d of perspectiveDirections(cfg, origin)) {
      const score = Math.abs((dx * d.x + dy * d.y) / (Math.hypot(dx, dy) || 1));
      if (score > best) { best = score; dir = d; }
    }
  }
  if (!dir) return { point: p, dir: null };
  const t = dx * dir.x + dy * dir.y;
  return { point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t }, dir };
}

// ───────────── Ruler / protractor / french curve ─────────────

export type RulerKind = 'ruler' | 'protractor' | 'french-curve';
export interface RulerGuide {
  kind: RulerKind; x: number; y: number; rotation: number; length: number;
  /** pixels within which strokes attach to the guide edge */
  magnet: number;
  visible: boolean;
}

export const DEFAULT_RULER: RulerGuide = { kind: 'ruler', x: 200, y: 200, rotation: 0, length: 600, magnet: 28, visible: false };

/** French curve edge: a smooth Euler-spiral-like curve sampled in guide-local coordinates. */
export function frenchCurveLocal(length: number, samples = 160): Pt[] {
  const out: Pt[] = [];
  let x = 0, y = 0, theta = 0;
  const ds = length / samples;
  for (let i = 0; i <= samples; i++) {
    out.push({ x, y });
    const s = i / samples;
    // Curvature varies smoothly from gentle to tight (classic french curve profile).
    const k = (0.4 + 5.5 * s * s) / length;
    theta += k * ds;
    x += Math.cos(theta) * ds; y += Math.sin(theta) * ds;
  }
  const cx = out.reduce((a, p) => a + p.x, 0) / out.length, cy = out.reduce((a, p) => a + p.y, 0) / out.length;
  return out.map((p) => ({ x: p.x - cx, y: p.y - cy }));
}

function toLocal(g: RulerGuide, p: Pt): Pt {
  const c = Math.cos(-g.rotation), s = Math.sin(-g.rotation), dx = p.x - g.x, dy = p.y - g.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
function toWorld(g: RulerGuide, p: Pt): Pt {
  const c = Math.cos(g.rotation), s = Math.sin(g.rotation);
  return { x: g.x + p.x * c - p.y * s, y: g.y + p.x * s + p.y * c };
}

function closestOnPolyline(pts: Pt[], p: Pt): { point: Pt; dist: number } {
  let best = { point: pts[0], dist: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], abx = b.x - a.x, aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
    const q = { x: a.x + abx * t, y: a.y + aby * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.dist) best = { point: q, dist: d };
  }
  return best;
}

/**
 * Constrain a point to the nearest guide edge if within the magnet radius.
 * Ruler: both long edges (y = ±halfWidth) of a straight edge. Protractor: the arc (radius = length/2)
 * plus its diameter. French curve: the sampled curve.
 */
export function constrainToGuide(g: RulerGuide, p: Pt, halfWidth = 24): { point: Pt; attached: boolean } {
  if (!g.visible) return { point: p, attached: false };
  const l = toLocal(g, p);
  let candidate: { point: Pt; dist: number } | null = null;
  if (g.kind === 'ruler') {
    const hx = g.length / 2;
    if (Math.abs(l.x) <= hx) {
      const edgeY = l.y < 0 ? -halfWidth : halfWidth;
      candidate = { point: { x: l.x, y: edgeY }, dist: Math.abs(l.y - edgeY) };
    }
  } else if (g.kind === 'protractor') {
    const r = g.length / 2;
    const arcDist = Math.abs(Math.hypot(l.x, l.y) - r);
    if (l.y <= 0 && arcDist < Math.abs(l.y)) {
      const a = Math.atan2(l.y, l.x), k = r;
      candidate = { point: { x: Math.cos(a) * k, y: Math.sin(a) * k }, dist: arcDist };
    } else if (Math.abs(l.x) <= r) candidate = { point: { x: l.x, y: 0 }, dist: Math.abs(l.y) };
  } else {
    candidate = closestOnPolyline(frenchCurveLocal(g.length), l);
  }
  if (!candidate || candidate.dist > g.magnet) return { point: p, attached: false };
  return { point: toWorld(g, candidate.point), attached: true };
}

/** Protractor angle readout (degrees, 0..180) of a point relative to the guide centre. */
export function protractorAngle(g: RulerGuide, p: Pt): number {
  const l = toLocal(g, p);
  return ((Math.atan2(-l.y, l.x) * 180) / Math.PI + 360) % 360;
}
