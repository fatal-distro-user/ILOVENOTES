/** Paper backgrounds for the infinite canvas, drawn in screen space for the current camera. */
import type { Camera } from './camera';
import type { BackgroundKind } from './tools';

export interface BgColors { minor: string; major: string; accent: string }

function forEachLine(start: number, end: number, step: number, cb: (v: number, i: number) => void) {
  const first = Math.floor(start / step);
  const last = Math.ceil(end / step);
  if (last - first > 4000) return;
  for (let i = first; i <= last; i++) cb(i * step, i);
}

/** Choose a grid step that stays visually readable across zoom levels (powers of 2 subdivision). */
export function adaptiveStep(base: number, zoom: number): number {
  let step = base;
  while (step * zoom < 10) step *= 2;
  while (step * zoom > 160 && step > base / 8) step /= 2;
  return step;
}

export function drawBackground(ctx: CanvasRenderingContext2D, kind: BackgroundKind, cam: Camera, w: number, h: number, grid: number, colors: BgColors): void {
  ctx.clearRect(0, 0, w, h);
  if (kind === 'none') return;
  const x0 = cam.x, y0 = cam.y, x1 = cam.x + w / cam.zoom, y1 = cam.y + h / cam.zoom;
  const sx = (x: number) => (x - cam.x) * cam.zoom;
  const sy = (y: number) => (y - cam.y) * cam.zoom;
  ctx.lineWidth = 1;

  if (kind === 'grid' || kind === 'dot') {
    const step = adaptiveStep(grid, cam.zoom);
    const majorEvery = 5;
    if (kind === 'grid') {
      ctx.beginPath();
      forEachLine(x0, x1, step, (x, i) => { if (i % majorEvery) { const X = Math.round(sx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, h); } });
      forEachLine(y0, y1, step, (y, i) => { if (i % majorEvery) { const Y = Math.round(sy(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(w, Y); } });
      ctx.strokeStyle = colors.minor; ctx.stroke();
      ctx.beginPath();
      forEachLine(x0, x1, step, (x, i) => { if (!(i % majorEvery)) { const X = Math.round(sx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, h); } });
      forEachLine(y0, y1, step, (y, i) => { if (!(i % majorEvery)) { const Y = Math.round(sy(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(w, Y); } });
      ctx.strokeStyle = colors.major; ctx.stroke();
    } else {
      const r = Math.max(0.8, Math.min(1.8, step * cam.zoom * 0.06));
      ctx.fillStyle = colors.major;
      forEachLine(y0, y1, step, (y) => forEachLine(x0, x1, step, (x) => { ctx.fillRect(sx(x) - r / 2, sy(y) - r / 2, r, r); }));
    }
    return;
  }

  if (kind === 'isometric') {
    // Triangular lattice: verticals every step·cos30°, ±30° lines with vertical intercepts every step.
    const step = adaptiveStep(grid, cam.zoom);
    const t = Math.tan(Math.PI / 6);
    ctx.beginPath();
    forEachLine(x0, x1, step * Math.cos(Math.PI / 6), (x) => { const X = Math.round(sx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, h); });
    // y = t·x + c  (c from y0 - t·x1 to y1 - t·x0) and y = -t·x + c (c from y0 + t·x0 to y1 + t·x1)
    forEachLine(y0 - t * x1, y1 - t * x0, step, (c) => { ctx.moveTo(sx(x0), sy(t * x0 + c)); ctx.lineTo(sx(x1), sy(t * x1 + c)); });
    forEachLine(y0 + t * x0, y1 + t * x1, step, (c) => { ctx.moveTo(sx(x0), sy(-t * x0 + c)); ctx.lineTo(sx(x1), sy(-t * x1 + c)); });
    ctx.strokeStyle = colors.minor; ctx.stroke();
    return;
  }

  if (kind === 'hex') {
    const s = adaptiveStep(grid, cam.zoom); // hex side
    const hw = Math.sqrt(3) * s, vh = 1.5 * s;
    ctx.beginPath();
    const rowStart = Math.floor(y0 / vh) - 1, rowEnd = Math.ceil(y1 / vh) + 1;
    if ((rowEnd - rowStart) * ((x1 - x0) / hw) > 20000) return;
    for (let row = rowStart; row <= rowEnd; row++) {
      const off = (row & 1) * hw / 2;
      const colStart = Math.floor((x0 - off) / hw) - 1, colEnd = Math.ceil((x1 - off) / hw) + 1;
      for (let col = colStart; col <= colEnd; col++) {
        const cx = col * hw + off, cy = row * vh;
        for (let k = 0; k < 3; k++) {
          const a0 = Math.PI / 6 + (k * Math.PI) / 3, a1 = a0 + Math.PI / 3;
          ctx.moveTo(sx(cx + s * Math.cos(a0)), sy(cy + s * Math.sin(a0)));
          ctx.lineTo(sx(cx + s * Math.cos(a1)), sy(cy + s * Math.sin(a1)));
        }
      }
    }
    ctx.strokeStyle = colors.minor; ctx.stroke();
    return;
  }

  if (kind === 'ruled' || kind === 'cornell') {
    const step = grid * 1.25;
    ctx.beginPath();
    forEachLine(y0, y1, step, (y) => { const Y = Math.round(sy(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(w, Y); });
    ctx.strokeStyle = colors.major; ctx.stroke();
    // Margin line(s): repeat every page width so the infinite surface reads as paper sheets.
    const page = 816; // 8.5in at 96dpi
    ctx.beginPath();
    forEachLine(x0 - page, x1, page, (px) => {
      const X = Math.round(sx(px + (kind === 'cornell' ? page * 0.3 : 72))) + 0.5;
      ctx.moveTo(X, 0); ctx.lineTo(X, h);
    });
    ctx.strokeStyle = colors.accent; ctx.lineWidth = 1.2; ctx.stroke();
    if (kind === 'cornell') {
      // Summary band every 1056 (11in) — the bottom 2in of each sheet.
      const sheet = 1056;
      ctx.beginPath();
      forEachLine(y0 - sheet, y1, sheet, (py) => { const Y = Math.round(sy(py + sheet - 192)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(w, Y); });
      ctx.stroke();
    }
    return;
  }

  if (kind === 'staff') {
    // Music staff: groups of 5 lines spaced `gap`, groups separated by 4 gaps.
    const gap = grid * 0.5, group = gap * 4 + gap * 5;
    ctx.beginPath();
    forEachLine(y0 - group, y1, group, (gy) => {
      for (let k = 0; k < 5; k++) { const Y = Math.round(sy(gy + k * gap)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(w, Y); }
    });
    ctx.strokeStyle = colors.major; ctx.stroke();
  }
}

export const BACKGROUNDS: { id: BackgroundKind; label: string }[] = [
  { id: 'none', label: 'Blank' }, { id: 'dot', label: 'Dots' }, { id: 'grid', label: 'Grid' }, { id: 'isometric', label: 'Isometric' },
  { id: 'hex', label: 'Hex' }, { id: 'ruled', label: 'Ruled' }, { id: 'staff', label: 'Music staff' }, { id: 'cornell', label: 'Cornell notes' },
];
