/** Renders a brush preview stroke (S-curve) into a canvas — used by the Brush Studio list and editor. */
import type { BrushParams } from './types';
import { computeDabs } from './dynamics';
import { stampFor, bucketFor, grainTexture } from './stamp';
import type { StrokePoint } from '../stabilizer';

export function renderBrushPreview(canvas: HTMLCanvasElement, brush: BrushParams, color: string): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const size = Math.min(H * 0.45, Math.max(2, brush.size));
  const b: BrushParams = { ...brush, size, taperStart: brush.taperStart ? Math.min(brush.taperStart, W * 0.15) : 0, taperEnd: brush.taperEnd ? Math.min(brush.taperEnd, W * 0.2) : 0, sizeJitter: brush.sizeJitter, scatter: brush.scatter };
  const pts: StrokePoint[] = [];
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = W * 0.08 + t * W * 0.84, y = H / 2 + Math.sin(t * Math.PI * 2) * H * 0.22;
    // Pressure ramps up then down to show dynamics.
    pts.push({ x, y, pressure: Math.sin(t * Math.PI) * 0.85 + 0.15, t: i * 16, tiltX: 0, tiltY: 0, velocity: 0.6 });
  }
  const dabs = computeDabs(pts, b, 42);
  const res = bucketFor(size);
  const tint = document.createElement('canvas');
  const isRetouch = !['paint', 'erase'].includes(brush.mode);
  const fill = brush.mode === 'erase' ? '#ef4444' : isRetouch ? '#94a3b8' : color;
  for (const d of dabs) {
    const s = Math.ceil(d.size) + 2;
    tint.width = s; tint.height = s;
    const t = tint.getContext('2d')!;
    t.translate(s / 2, s / 2);
    t.rotate(d.angle);
    t.scale(1, Math.max(0.05, d.roundness));
    if (brush.tip === 'pixel') { t.fillStyle = fill; t.fillRect(-d.size / 2, -d.size / 2, d.size, d.size); }
    else t.drawImage(stampFor(brush.tip, brush.hardness, res, brush.bristles), -d.size / 2, -d.size / 2, d.size, d.size);
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = fill;
    t.fillRect(0, 0, s, s);
    if (brush.grain > 0) {
      const pat = t.createPattern(grainTexture(brush.grainScale, brush.grain), 'repeat');
      if (pat) { t.globalCompositeOperation = 'destination-in'; t.fillStyle = pat; t.fillRect(0, 0, s, s); }
    }
    g.globalAlpha = d.alpha * brush.opacity * (isRetouch ? 0.35 : 1);
    g.globalCompositeOperation = brush.blend === 'multiply' ? 'multiply' : 'source-over';
    g.drawImage(tint, Math.round(d.x - s / 2), Math.round(d.y - s / 2));
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}
