import { useCallback, useEffect, useRef } from 'react';
import { hsvToRgb, rgbToHex, type HSV } from './colorMath';

interface PickerProps {
  mode: 'wheel' | 'box';
  hsv: HSV;
  size: number;
  onChange(hsv: HSV): void;
  onCommit(): void;
}

const RING = 18;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

interface Geometry {
  /** square (SV) area */
  sx: number; sy: number; sw: number; sh: number;
  /** wheel */
  cx: number; cy: number; rOut: number; rIn: number;
  /** box hue strip */
  hx: number; hw: number;
}

function geometry(mode: 'wheel' | 'box', size: number): Geometry {
  if (mode === 'wheel') {
    const rOut = size / 2 - 2, rIn = rOut - RING;
    const half = (rIn - 6) / Math.SQRT2;
    return { sx: size / 2 - half, sy: size / 2 - half, sw: half * 2, sh: half * 2, cx: size / 2, cy: size / 2, rOut, rIn, hx: 0, hw: 0 };
  }
  const hw = 18, gap = 10;
  return { sx: 2, sy: 2, sw: size - hw - gap - 4, sh: size - 4, cx: 0, cy: 0, rOut: 0, rIn: 0, hx: size - hw - 2, hw };
}

/** HSV colour picker drawn on a canvas: hue ring + SV square, or classic SV box + hue strip. */
export function Picker({ mode, hsv, size, onChange, onCommit }: PickerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<'hue' | 'sv' | null>(null);
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const geo = geometry(mode, size);

  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== size * dpr) { c.width = size * dpr; c.height = size * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const hueCss = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
    const markerAt = (x: number, y: number, fill: string) => {
      g.beginPath(); g.arc(x, y, 6.5, 0, Math.PI * 2);
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
      g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
    };
    const cur = rgbToHex(hsvToRgb(hsv));

    // SV square
    g.save();
    g.beginPath(); g.roundRect(geo.sx, geo.sy, geo.sw, geo.sh, 4); g.clip();
    g.fillStyle = hueCss; g.fillRect(geo.sx, geo.sy, geo.sw, geo.sh);
    const wg = g.createLinearGradient(geo.sx, 0, geo.sx + geo.sw, 0);
    wg.addColorStop(0, '#fff'); wg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = wg; g.fillRect(geo.sx, geo.sy, geo.sw, geo.sh);
    const bg = g.createLinearGradient(0, geo.sy, 0, geo.sy + geo.sh);
    bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, '#000');
    g.fillStyle = bg; g.fillRect(geo.sx, geo.sy, geo.sw, geo.sh);
    g.restore();
    g.lineWidth = 1; g.strokeStyle = 'rgba(128,128,128,0.45)';
    g.beginPath(); g.roundRect(geo.sx - 0.5, geo.sy - 0.5, geo.sw + 1, geo.sh + 1, 4); g.stroke();

    if (mode === 'wheel') {
      const mid = (geo.rOut + geo.rIn) / 2;
      if (typeof g.createConicGradient === 'function') {
        const cg = g.createConicGradient(-Math.PI / 2, geo.cx, geo.cy);
        for (let i = 0; i <= 12; i++) cg.addColorStop(i / 12, `hsl(${(i / 12) * 360} 100% 50%)`);
        g.strokeStyle = cg;
      } else g.strokeStyle = hueCss;
      g.lineWidth = RING;
      g.beginPath(); g.arc(geo.cx, geo.cy, mid, 0, Math.PI * 2); g.stroke();
      const a = (hsv.h / 360) * Math.PI * 2 - Math.PI / 2;
      markerAt(geo.cx + Math.cos(a) * mid, geo.cy + Math.sin(a) * mid, rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 })));
    } else {
      const hg = g.createLinearGradient(0, geo.sy, 0, geo.sy + geo.sh);
      for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, `hsl(${(i / 6) * 360} 100% 50%)`);
      g.fillStyle = hg;
      g.beginPath(); g.roundRect(geo.hx, geo.sy, geo.hw, geo.sh, 4); g.fill();
      markerAt(geo.hx + geo.hw / 2, geo.sy + (hsv.h / 360) * geo.sh, rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 })));
    }
    markerAt(geo.sx + hsv.s * geo.sw, geo.sy + (1 - hsv.v) * geo.sh, cur);
  }, [hsv, mode, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback((e: React.PointerEvent, kind: 'hue' | 'sv') => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const cur = hsvRef.current;
    if (kind === 'sv') {
      onChange({ h: cur.h, s: clamp01((x - geo.sx) / geo.sw), v: 1 - clamp01((y - geo.sy) / geo.sh) });
    } else if (mode === 'wheel') {
      let h = (Math.atan2(y - geo.cy, x - geo.cx) * 180) / Math.PI + 90;
      h = ((h % 360) + 360) % 360;
      onChange({ ...cur, h });
    } else {
      onChange({ ...cur, h: clamp01((y - geo.sy) / geo.sh) * 360 });
    }
  }, [geo.sx, geo.sy, geo.sw, geo.sh, geo.cx, geo.cy, mode, onChange]);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let kind: 'hue' | 'sv' | null = null;
    if (mode === 'wheel') {
      const d = Math.hypot(x - geo.cx, y - geo.cy);
      if (d >= geo.rIn - 2 && d <= geo.rOut + 2) kind = 'hue';
      else if (x >= geo.sx - 4 && x <= geo.sx + geo.sw + 4 && y >= geo.sy - 4 && y <= geo.sy + geo.sh + 4) kind = 'sv';
    } else if (x >= geo.hx - 4) kind = 'hue';
    else kind = 'sv';
    if (!kind) return;
    drag.current = kind;
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(e, kind);
  };
  const move = (e: React.PointerEvent) => { if (drag.current) apply(e, drag.current); };
  const up = () => { if (drag.current) { drag.current = null; onCommit(); } };

  return (
    <canvas ref={ref} data-testid="color-picker" data-mode={mode} style={{ width: size, height: size, touchAction: 'none' }}
      className="block cursor-crosshair select-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
  );
}

export { geometry as pickerGeometry };
