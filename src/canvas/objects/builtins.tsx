import { useEffect, useRef } from 'react';
import type { CanvasObject } from '@/db/types';
import { registerObjectType, type ObjectViewProps } from './registry';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export type ShapeKind = 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'line' | 'arrow';

/** SVG path data for a shape inside a w×h box (world units). */
export function shapePath(kind: ShapeKind, w: number, h: number, radius = 0, d: Record<string, unknown> = {}): string {
  switch (kind) {
    case 'rect': {
      const r = Math.min(radius, w / 2, h / 2);
      return r > 0
        ? `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`
        : `M0,0 H${w} V${h} H0 Z`;
    }
    case 'ellipse': return `M${w / 2},0 A${w / 2},${h / 2} 0 1 1 ${w / 2},${h} A${w / 2},${h / 2} 0 1 1 ${w / 2},0 Z`;
    case 'diamond': return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`;
    case 'triangle': return `M${w / 2},0 L${w},${h} L0,${h} Z`;
    case 'line': case 'arrow': {
      const x1 = num(d.x1, 0) * w, y1 = num(d.y1, 0) * h, x2 = num(d.x2, 1) * w, y2 = num(d.y2, 1) * h;
      return `M${x1},${y1} L${x2},${y2}`;
    }
  }
}

export function arrowHead(d: Record<string, unknown>, w: number, h: number, size: number): string {
  const x1 = num(d.x1, 0) * w, y1 = num(d.y1, 0) * h, x2 = num(d.x2, 1) * w, y2 = num(d.y2, 1) * h;
  const a = Math.atan2(y2 - y1, x2 - x1), L = size;
  return `M${x2 - L * Math.cos(a - 0.45)},${y2 - L * Math.sin(a - 0.45)} L${x2},${y2} L${x2 - L * Math.cos(a + 0.45)},${y2 - L * Math.sin(a + 0.45)}`;
}

function EditableText({ obj, doc, editing, style, className }: { obj: CanvasObject; doc: ObjectViewProps['doc']; editing: boolean; style?: React.CSSProperties; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const text = str(obj.data.text);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (editing) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges(); sel?.addRange(range);
    }
  }, [editing]);
  useEffect(() => { if (ref.current && !editing && ref.current.innerText !== text) ref.current.innerText = text; }, [text, editing]);
  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = el.innerText.replace(/\n$/, '');
    doc.store.setState({ editingId: null });
    const cur = doc.state.objects[obj.id];
    if (!cur) return;
    const autoH = obj.type === 'text' ? Math.max(cur.h, el.scrollHeight) : cur.h;
    if (next !== str(cur.data.text) || autoH !== cur.h) void doc.updateObjects([{ ...cur, h: autoH, data: { ...cur.data, text: next } }], 'Edit text');
  };
  return (
    <div ref={ref} className={className} style={style} contentEditable={editing} suppressContentEditableWarning spellCheck={editing}
      data-testid="canvas-text"
      onBlur={() => editing && commit()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { (e.target as HTMLElement).blur(); } }}
      onPointerDown={(e) => { if (editing) e.stopPropagation(); }}>
      {text}
    </div>
  );
}

function ShapeView({ obj, doc, editing }: ObjectViewProps) {
  const d = obj.data;
  const kind = str(d.shape, 'rect') as ShapeKind;
  const sw = num(d.strokeWidth, 2);
  const stroke = str(d.stroke, '#7c5cff');
  const fill = str(d.fill, 'transparent');
  const dash = d.dash === 'dashed' ? `${sw * 4} ${sw * 3}` : d.dash === 'dotted' ? `0 ${sw * 2.5}` : undefined;
  const pad = sw;
  const isLine = kind === 'line' || kind === 'arrow';
  return (
    <div className="relative h-full w-full">
      <svg className="absolute overflow-visible" style={{ left: 0, top: 0 }} width={Math.max(1, obj.w)} height={Math.max(1, obj.h)}>
        <path d={shapePath(kind, obj.w, obj.h, num(d.radius, 0), d)} fill={isLine ? 'none' : fill} stroke={stroke} strokeWidth={sw}
          strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {kind === 'arrow' && <path d={arrowHead(d, obj.w, obj.h, 10 + sw * 2)} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      {!isLine && (editing || str(d.text)) && (
        <div className="absolute flex items-center justify-center" style={{ inset: pad + 4 }}>
          <EditableText obj={obj} doc={doc} editing={editing} className="w-full text-center whitespace-pre-wrap outline-none"
            style={{ fontSize: num(d.fontSize, 16), color: str(d.textColor, 'var(--iln-fg)'), lineHeight: 1.3 }} />
        </div>
      )}
    </div>
  );
}

function TextView({ obj, doc, editing }: ObjectViewProps) {
  const d = obj.data;
  return (
    <EditableText obj={obj} doc={doc} editing={editing} className="h-full w-full whitespace-pre-wrap break-words outline-none"
      style={{ fontSize: num(d.fontSize, 20), color: str(d.color, 'var(--iln-fg)'), fontWeight: d.bold ? 700 : 400, textAlign: (str(d.align, 'left') as React.CSSProperties['textAlign']), lineHeight: 1.35, fontFamily: d.font === 'mono' ? 'var(--font-mono)' : d.font === 'serif' ? 'Georgia, serif' : d.font === 'hand' ? '"Comic Sans MS", "Segoe Print", cursive' : undefined }} />
  );
}

function ImageView({ obj }: ObjectViewProps) {
  return <img src={str(obj.data.src)} alt={str(obj.data.alt)} draggable={false} className="pointer-events-none h-full w-full select-none" style={{ objectFit: 'fill', borderRadius: num(obj.data.radius, 0) }} />;
}

function FrameView({ obj, doc, editing }: ObjectViewProps) {
  const color = str(obj.data.color, 'var(--iln-line)');
  return (
    <div className="h-full w-full rounded-md" style={{ border: `1.5px solid ${color}`, background: str(obj.data.fill, 'color-mix(in srgb, var(--iln-bg-2) 55%, transparent)') }}>
      <div className="absolute -top-6 left-0 max-w-full truncate text-[13px] font-medium text-fg-muted">
        <EditableText obj={{ ...obj, data: { ...obj.data, text: str(obj.data.text, 'Frame') } }} doc={doc} editing={editing} className="outline-none" />
      </div>
    </div>
  );
}

registerObjectType({
  type: 'shape', component: ShapeView, editable: true, minSize: { w: 4, h: 4 },
  toText: (o) => str(o.data.text),
  toSvg: (o) => {
    const d = o.data, kind = str(d.shape, 'rect') as ShapeKind, sw = num(d.strokeWidth, 2), stroke = str(d.stroke, '#7c5cff');
    const isLine = kind === 'line' || kind === 'arrow';
    let s = `<path d="${shapePath(kind, o.w, o.h, num(d.radius, 0), d)}" fill="${isLine ? 'none' : esc(str(d.fill, 'none'))}" stroke="${esc(stroke)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (kind === 'arrow') s += `<path d="${arrowHead(d, o.w, o.h, 10 + sw * 2)}" fill="none" stroke="${esc(stroke)}" stroke-width="${sw}" stroke-linecap="round"/>`;
    if (str(d.text)) s += `<text x="${o.w / 2}" y="${o.h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${num(d.fontSize, 16)}" fill="${esc(str(d.textColor, '#888'))}">${esc(str(d.text))}</text>`;
    return s;
  },
});
registerObjectType({
  type: 'text', component: TextView, editable: true, minSize: { w: 20, h: 16 },
  toText: (o) => str(o.data.text),
  toSvg: (o) => str(o.data.text).split('\n').map((l, i) => `<text x="0" y="${(i + 1) * num(o.data.fontSize, 20) * 1.35}" font-size="${num(o.data.fontSize, 20)}" fill="${esc(str(o.data.color, '#888'))}">${esc(l)}</text>`).join(''),
});
registerObjectType({
  type: 'image', component: ImageView, lockAspect: true, minSize: { w: 8, h: 8 },
  toSvg: (o) => `<image href="${esc(str(o.data.src))}" width="${o.w}" height="${o.h}" preserveAspectRatio="none"/>`,
});
registerObjectType({
  type: 'frame', component: FrameView, editable: true, minSize: { w: 40, h: 40 },
  toText: (o) => str(o.data.text, 'Frame'),
  toSvg: (o) => `<rect width="${o.w}" height="${o.h}" rx="6" fill="none" stroke="${esc(str(o.data.color, '#888'))}"/><text y="-8" font-size="13" fill="#888">${esc(str(o.data.text, 'Frame'))}</text>`,
});
