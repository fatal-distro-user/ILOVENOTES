import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import clsx from 'clsx';
import { Clapperboard, Flag, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { db } from '@/db/schema';
import type { CanvasObject, Snapshot, Stroke } from '@/db/types';
import { useActivePageId } from '@/editor/activeEditor';
import { outlineFor, outlineToSvgPath } from '@/canvas/ink';
import { toast } from '@/store/status';
import { confirmDialog, promptDialog } from '@/ui/dialogs';
import { Button } from '@/ui/Modal';
import { deleteSnapshot, listSnapshots, renameSnapshot, restoreSnapshot, takeSnapshot } from './snapshots';
import { collapseContext, diffStats, formatSize, formatWhen, lineDiff } from './versionLogic';
import { useTimelapse } from './Timelapse';

export async function createCheckpoint(pageId: string): Promise<void> {
  const name = await promptDialog('Name this checkpoint', 'Checkpoint');
  if (!name) return;
  const s = await takeSnapshot(pageId, { name, auto: false });
  toast(s ? `Saved checkpoint “${name}”` : 'Could not save checkpoint', s ? 'ok' : 'error');
}

const TYPE_FILL: Record<string, string> = { sticky: '#fde68a', frame: 'none', shape: 'none', paint: '#ffffff', image: '#cbd5e1', mindnode: '#c4b5fd', text: 'none', code: '#e2e8f0' };

function Thumb({ objects, strokes }: { objects: CanvasObject[]; strokes: Stroke[] }) {
  const model = useMemo(() => {
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const o of objects) if (o.type !== 'connector') boxes.push({ x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h });
    const sample = strokes.length > 2500 ? strokes.filter((_, i) => i % Math.ceil(strokes.length / 2500) === 0) : strokes;
    const paths = sample.map((s) => {
      for (let i = 0; i < s.points.length; i += 4) boxes.push({ x0: s.points[i] - s.width, y0: s.points[i + 1] - s.width, x1: s.points[i] + s.width, y1: s.points[i + 1] + s.width });
      return { id: s.id, d: outlineToSvgPath(outlineFor(s.points, s.tool, s.width)), color: s.color, opacity: s.opacity };
    });
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((b) => b.x0)), y0 = Math.min(...boxes.map((b) => b.y0));
    const x1 = Math.max(...boxes.map((b) => b.x1)), y1 = Math.max(...boxes.map((b) => b.y1));
    const pad = Math.max(x1 - x0, y1 - y0) * 0.04 + 8;
    return { vb: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`, paths };
  }, [objects, strokes]);
  if (!model) return <div className="flex h-24 items-center justify-center rounded border border-line bg-bg-2 text-fg-faint">Empty canvas</div>;
  return (
    <svg viewBox={model.vb} className="h-36 w-full rounded border border-line bg-bg-2" data-testid="version-thumb" preserveAspectRatio="xMidYMid meet">
      {objects.filter((o) => o.type !== 'connector').map((o) => (
        <g key={o.id} transform={`translate(${o.x} ${o.y})`}>
          <rect width={o.w} height={o.h} rx={6} fill={TYPE_FILL[o.type] ?? 'none'} stroke="var(--iln-fg-faint)" strokeWidth={Math.max(1, Math.max(o.w, o.h) / 160)} opacity={0.8} />
          {typeof o.data.text === 'string' && o.data.text && (
            <text x={o.w / 2} y={o.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(o.h * 0.35, 22)} fill="var(--iln-fg-muted)">{(o.data.text as string).slice(0, 24)}</text>
          )}
        </g>
      ))}
      {model.paths.map((p) => <path key={p.id} d={p.d} fill={p.color} opacity={p.opacity} />)}
    </svg>
  );
}

function DocDiff({ snap, currentText }: { snap: Snapshot; currentText: string }) {
  const ops = useMemo(() => lineDiff(snap.payload.doc?.text ?? '', currentText), [snap, currentText]);
  const stats = diffStats(ops);
  const rows = useMemo(() => collapseContext(ops, 2), [ops]);
  return (
    <div data-testid="version-diff">
      <div className="mb-1 text-[11px] text-fg-muted">Compared with the current page: <span className="text-ok">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span> lines <span className="text-fg-faint">(green = in current page only, red = only in this version)</span></div>
      <div className="max-h-48 overflow-auto rounded border border-line bg-bg-2 font-mono text-[11.5px] leading-5">
        {rows.length === 0 && <div className="p-2 text-fg-faint">Empty document</div>}
        {rows.map((r, i) =>
          r.type === 'skip' ? <div key={i} className="px-2 text-center text-fg-faint">⋯ {r.n} unchanged line{r.n === 1 ? '' : 's'} ⋯</div>
          : <div key={i} className={clsx('whitespace-pre-wrap break-words px-2', r.type === 'add' && 'bg-ok/20 text-ok', r.type === 'del' && 'bg-danger/20 text-danger line-through')}>
              {r.type === 'add' ? '+ ' : r.type === 'del' ? '− ' : '  '}{r.text || ' '}
            </div>)}
      </div>
    </div>
  );
}

export function VersionsPanel() {
  const pageId = useActivePageId();
  const snaps = useLiveQuery(() => (pageId ? listSnapshots(pageId) : []), [pageId], [] as Snapshot[]);
  const node = useLiveQuery(() => (pageId ? db.nodes.get(pageId) : undefined), [pageId]);
  const currentDoc = useLiveQuery(() => (pageId ? db.docs.get(pageId) : undefined), [pageId]);
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openTimelapse = useTimelapse((s) => s.open);

  useEffect(() => { setSelId(null); }, [pageId]);
  const list = useMemo(() => [...snaps].reverse(), [snaps]);
  const sel = list.find((s) => s.id === selId) ?? null;
  const selIndex = sel ? snaps.findIndex((s) => s.id === sel.id) : snaps.length - 1;

  if (!pageId) return <div className="p-3 text-fg-faint">Open a page to see its version history.</div>;

  const hasInk = !!node && node.mode !== 'document';
  const restore = async (s: Snapshot) => {
    setBusy(true);
    try { toast((await restoreSnapshot(s.id)) ? `Restored “${s.name || formatWhen(s.createdAt)}”` : 'Could not restore', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Restore failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-2 p-2" data-testid="versions-panel">
      <div className="flex gap-1.5">
        <Button className="flex-1" onClick={() => void createCheckpoint(pageId)} data-testid="versions-checkpoint"><Flag size={12} />Checkpoint</Button>
        {hasInk && <Button onClick={() => openTimelapse(pageId)} data-testid="versions-timelapse" title="Replay the drawing stroke by stroke"><Clapperboard size={12} />Time-lapse</Button>}
      </div>

      {snaps.length > 1 && (
        <input
          type="range" min={0} max={snaps.length - 1} value={Math.max(0, selIndex)} data-testid="versions-timeline" aria-label="Version timeline"
          onChange={(e) => setSelId(snaps[Number(e.target.value)]?.id ?? null)} className="w-full accent-[var(--iln-accent)]"
        />
      )}

      <div className="max-h-52 overflow-y-auto rounded border border-line">
        {list.length === 0 && <div className="p-3 text-center text-fg-faint">No versions yet. Create a checkpoint, or edits are saved automatically every few minutes.</div>}
        {list.map((s) => (
          <button
            key={s.id} data-testid="version-item" data-auto={s.auto} onClick={() => setSelId(s.id === selId ? null : s.id)}
            className={clsx('flex w-full items-center gap-2 border-b border-line px-2 py-1.5 text-left last:border-b-0', s.id === sel?.id ? 'bg-accent/20' : 'hover:bg-bg-2')}
          >
            {s.auto ? <span className="h-2 w-2 shrink-0 rounded-full bg-fg-faint" title="Automatic" /> : <Flag size={11} className="shrink-0 text-accent" />}
            <span className="min-w-0 flex-1 truncate">{s.name || 'Auto-save'}</span>
            <span className="shrink-0 text-[11px] text-fg-faint">{formatWhen(s.createdAt)}</span>
            <span className="w-12 shrink-0 text-right text-[11px] text-fg-faint">{formatSize(s.size)}</span>
          </button>
        ))}
      </div>

      {sel && (
        <div className="space-y-2" data-testid="version-preview">
          <div className="flex items-center gap-1.5">
            <Button variant="primary" disabled={busy} onClick={() => void restore(sel)} data-testid="version-restore"><RotateCcw size={12} />Restore</Button>
            <Button onClick={async () => { const n = await promptDialog('Rename version', sel.name || 'Checkpoint'); if (n) await renameSnapshot(sel.id, n); }} data-testid="version-rename"><Pencil size={12} />Rename</Button>
            <Button onClick={async () => { if (await confirmDialog('Delete this version?', { confirmLabel: 'Delete' })) { await deleteSnapshot(sel.id); setSelId(null); } }} data-testid="version-delete"><Trash2 size={12} />Delete</Button>
          </div>
          {sel.payload.node.mode !== 'canvas' && <DocDiff snap={sel} currentText={currentDoc?.text ?? ''} />}
          {(sel.payload.node.mode !== 'document') && <Thumb objects={sel.payload.objects} strokes={sel.payload.strokes} />}
        </div>
      )}
    </div>
  );
}
