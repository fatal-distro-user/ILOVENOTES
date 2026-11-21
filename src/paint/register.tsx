import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Layers, Palette, Brush } from 'lucide-react';
import { registerTabView } from '@/views/registry';
import { registerPanel } from '@/panels/registry';
import { registerCommands } from '@/commands/registry';
import { registerObjectType, type ObjectViewProps } from '@/canvas/objects/registry';
import { registerCanvasPlugin } from '@/canvas/CanvasView';
import { registerCanvasTool } from '@/canvas/CanvasChrome';
import { useCanvasTools } from '@/canvas/tools';
import { normRect } from '@/canvas/camera';
import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import { useTabs, activeTab } from '@/store/tabs';
import { ensureTarget } from '@/layout/actions';
import { toast } from '@/store/status';
import { PaintDocument } from './engine/document';
import { PaintStudioView } from './studio/StudioView';
import { LayersPanel } from './studio/LayersPanel';
import { usePaintStudio } from './studio/store';
import './studio/basicTools';
import './brushes/tools';
import './selection/tools';
import './selection/commands';
import './fill/tools';
import './geometry/guidesUi';
import './filters/FiltersMenu';
import { TimelineBar, selectFrame, useAnim } from './anim/Timeline';
import { animSettings } from './anim/model';
import { registerBottomBar } from '@/layout/bottomBars';
import { BrushStudioPanel } from './brushes/BrushStudio';

export function openPaintStudio(docId: string, title = 'Painting', opts: { newTab?: boolean } = { newTab: true }): void {
  useTabs.getState().open({ kind: 'paint', title, params: { docId } }, opts);
}

registerTabView('paint', PaintStudioView);
registerBottomBar('timeline', TimelineBar);
const isPaint = () => activeTab()?.kind === 'paint' || !!usePaintStudio.getState().doc;
registerPanel({ id: 'brushes', title: 'Brushes', icon: Brush, defaultSide: 'right', component: BrushStudioPanel, when: isPaint, defaultOrder: 6 });
registerPanel({ id: 'layers', title: 'Layers', icon: Layers, defaultSide: 'right', component: LayersPanel, when: isPaint, defaultOrder: 5 });

/** Paint frame placed on the infinite canvas: shows the painting's preview; double-click opens the studio. */
function PaintFrameObject({ obj }: ObjectViewProps) {
  const docId = String(obj.data.docId ?? '');
  const meta = useLiveQuery(() => db.rasterDocs.get(docId), [docId]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!meta?.preview) { setUrl(null); return; }
    const u = URL.createObjectURL(meta.preview);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [meta?.preview]);
  return (
    <div className="relative h-full w-full overflow-hidden rounded-sm border border-line bg-white shadow-md" data-testid="canvas-paint">
      {url && <img src={url} alt={meta?.name ?? 'Painting'} draggable={false} className="pointer-events-none h-full w-full select-none" style={{ objectFit: 'contain' }} />}
      <div className="absolute top-1 left-1 rounded bg-black/55 px-1.5 text-[11px] text-white">{meta?.name ?? 'Painting'} · double-click to paint</div>
    </div>
  );
}
registerObjectType({
  type: 'paint', component: PaintFrameObject, lockAspect: true, minSize: { w: 40, h: 30 },
  onOpen: (o) => { void db.rasterDocs.get(String(o.data.docId)).then((m) => openPaintStudio(String(o.data.docId), m?.name ?? 'Painting')); },
  toText: (o) => String(o.data.name ?? 'Painting'),
});

registerCanvasTool({ tool: 'paint', icon: Palette, label: 'Paint frame', key: 'B' }, 'frame');

/** Drag on the canvas with the paint-frame tool to create a raster painting of that size (2× resolution). */
registerCanvasPlugin({
  onPointerDown(ctx, _e, start) {
    if (useCanvasTools.getState().tool !== 'paint') return null;
    let cur = start;
    const render = () => {
      const cam = ctx.camera();
      const r = normRect(start, cur);
      ctx.setPreview(<div className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/10" style={{ left: (r.x - cam.x) * cam.zoom, top: (r.y - cam.y) * cam.zoom, width: r.w * cam.zoom, height: r.h * cam.zoom }} />);
    };
    return {
      move(w) { cur = w; render(); },
      async up() {
        ctx.setPreview(null);
        let r = normRect(start, cur);
        if (r.w * ctx.camera().zoom < 8 || r.h * ctx.camera().zoom < 8) r = { x: start.x, y: start.y, w: 480, h: 320 };
        const scale = Math.min(2, 4096 / Math.max(r.w, r.h));
        try {
          const objId = crypto.randomUUID();
          const pd = await PaintDocument.create({ pageId: ctx.doc.pageId, ownerId: objId, width: Math.max(16, Math.round(r.w * scale)), height: Math.max(16, Math.round(r.h * scale)), name: 'Painting' });
          const o = { ...ctx.doc.newObject('paint', r, { docId: pd.id, name: 'Painting' }), id: objId };
          await ctx.doc.addObjects([o], 'Add paint frame');
          if (!useCanvasTools.getState().sticky) useCanvasTools.getState().setTool('select');
          openPaintStudio(pd.id, 'Painting');
        } catch (err) { toast(err instanceof Error ? err.message : 'Could not create painting', 'error'); }
      },
      cancel() { ctx.setPreview(null); },
    };
  },
});

export async function newPainting(width = 1920, height = 1080, name = 'Painting'): Promise<void> {
  const t = await ensureTarget();
  const node = await repo.createNode({ workspaceId: t.workspaceId, notebookId: t.notebookId, parentId: null, kind: 'page', title: name, mode: 'canvas', icon: '🎨' });
  const objId = crypto.randomUUID();
  const pd = await PaintDocument.create({ pageId: node.id, ownerId: objId, width, height, name });
  const k = Math.min(1, 960 / width);
  const now = Date.now();
  await db.canvasObjects.add({ id: objId, pageId: node.id, type: 'paint', x: 0, y: 0, w: width * k, h: height * k, rotation: 0, z: 1, locked: false, groupId: null, data: { docId: pd.id, name }, createdAt: now, updatedAt: now });
  openPaintStudio(pd.id, name);
}

registerCommands([
  { id: 'paint.new', title: 'New painting', category: 'Paint', shortcut: 'Mod+Alt+N', run: () => newPainting() },
  { id: 'paint.newSquare', title: 'New painting (2048 × 2048)', category: 'Paint', run: () => newPainting(2048, 2048) },
  { id: 'paint.newPixel', title: 'New pixel-art canvas (64 × 64)', category: 'Paint', run: () => newPainting(64, 64, 'Pixel art') },
  { id: 'paint.layer.add', title: 'Paint: New layer', category: 'Paint', shortcut: 'Mod+Shift+N', when: () => !!usePaintStudio.getState().doc && activeTab()?.kind === 'paint', run: () => { usePaintStudio.getState().doc?.addLayer('raster'); } },
  { id: 'paint.layer.mergeDown', title: 'Paint: Merge layer down', category: 'Paint', shortcut: 'Mod+E', when: () => activeTab()?.kind === 'paint', run: () => { const d = usePaintStudio.getState().doc; if (d?.activeLayerId) d.mergeDown(d.activeLayerId); } },
  { id: 'paint.layer.duplicate', title: 'Paint: Duplicate layer', category: 'Paint', shortcut: 'Mod+J', when: () => activeTab()?.kind === 'paint', run: () => { const d = usePaintStudio.getState().doc; if (d?.activeLayerId) d.duplicateLayer(d.activeLayerId); } },
  { id: 'paint.anim.prev', title: 'Animation: Previous frame', category: 'Animation', shortcut: ',', when: () => { const d = usePaintStudio.getState().doc; return activeTab()?.kind === 'paint' && !!d && animSettings(d).enabled; }, run: () => { const d = usePaintStudio.getState().doc; if (d) selectFrame(d, useAnim.getState().current - 1); } },
  { id: 'paint.anim.next', title: 'Animation: Next frame', category: 'Animation', shortcut: '.', when: () => { const d = usePaintStudio.getState().doc; return activeTab()?.kind === 'paint' && !!d && animSettings(d).enabled; }, run: () => { const d = usePaintStudio.getState().doc; if (d) selectFrame(d, useAnim.getState().current + 1); } },
  { id: 'paint.anim.play', title: 'Animation: Play / pause', category: 'Animation', shortcut: 'Alt+Space', when: () => { const d = usePaintStudio.getState().doc; return activeTab()?.kind === 'paint' && !!d && animSettings(d).enabled; }, run: () => useAnim.getState().set({ playing: !useAnim.getState().playing }) },
  { id: 'paint.flatten', title: 'Paint: Flatten image', category: 'Paint', when: () => activeTab()?.kind === 'paint', run: () => { usePaintStudio.getState().doc?.flatten(); } },
]);
