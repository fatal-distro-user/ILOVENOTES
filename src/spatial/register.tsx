import { useState } from 'react';
import { useStore } from 'zustand';
import { Type, Workflow, Mic } from 'lucide-react';
import { registerCanvasPlugin, type PluginContext } from '@/canvas/CanvasView';
import { registerCanvasTool } from '@/canvas/CanvasChrome';
import { useCanvasTools } from '@/canvas/tools';
import { peekCanvasDoc } from '@/canvas/doc';
import { toScreen } from '@/canvas/camera';
import { registerBottomBar } from '@/layout/bottomBars';
import { registerCommands } from '@/commands/registry';
import { useLayout } from '@/store/layout';
import { activeScope } from '@/history/scopes';
import { useActiveEditor } from '@/editor/activeEditor';
import { activeTab } from '@/store/tabs';
import { AudioBar, pinClip } from './AudioBar';
import { useAudio, startRecording, stopRecording } from './audioStore';
import { inkToText, inkToDiagram } from './inkConvert';
import './canvasObjects';
import './SketchNode';

registerBottomBar('audio', AudioBar);

function InkActions({ ctx }: { ctx: PluginContext }) {
  const strokeSel = useStore(ctx.doc.store, (s) => s.strokeSelection);
  const objSel = useStore(ctx.doc.store, (s) => s.selection);
  const cam = useStore(ctx.doc.store, (s) => s.camera);
  const [busy, setBusy] = useState(false);
  if (!strokeSel.length || objSel.length) return null;
  const b = ctx.doc.selectionBounds();
  if (!b) return null;
  const p = toScreen(cam, { x: b.x + b.w / 2, y: b.y + b.h });
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return (
    <div data-canvas-ui className="absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-bg-1/95 p-1 text-[12px] shadow-xl" style={{ left: p.x, top: p.y + 14 }} data-testid="ink-actions">
      <button disabled={busy} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-bg-3" onClick={() => void run(() => inkToText(ctx.doc))} data-testid="ink-to-text"><Type size={13} />{busy ? 'Working…' : 'Ink → Text'}</button>
      <button disabled={busy} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-bg-3" onClick={() => void run(() => inkToDiagram(ctx.doc))} data-testid="ink-to-diagram"><Workflow size={13} />Ink → Diagram</button>
    </div>
  );
}

registerCanvasTool({ tool: 'audio', icon: Mic, label: 'Record audio note (click to place)', key: '' }, 'laser');

registerCanvasPlugin({
  onPointerDown(ctx, _e, w) {
    if (useCanvasTools.getState().tool !== 'audio') return null;
    return {
      move() {},
      async up() {
        const st = useAudio.getState();
        if (st.recording) {
          const clip = await stopRecording();
          if (clip) await pinClip(clip, { x: w.x, y: w.y });
          useCanvasTools.getState().setTool('select');
        } else if (await startRecording(ctx.doc.pageId)) {
          useLayout.getState().setBottomBar('audio');
          // Keep the tool so the next click stops & pins; switch to the pen so ink is synced.
          (window as unknown as { __ilnPin?: { x: number; y: number } }).__ilnPin = w;
          useCanvasTools.getState().setTool('pen');
        }
      },
    };
  },
  Overlay: InkActions,
});

const canvasPage = () => { const id = activeScope()?.id; return id?.startsWith('canvas:') ? id.slice(7) : null; };
const currentPage = (): string | null => {
  const t = activeTab();
  if (t?.kind === 'page' && t.pageId) return t.pageId;
  return useActiveEditor.getState().pageId;
};

registerCommands([
  { id: 'audio.bar', title: 'Audio notes panel', category: 'Audio', shortcut: 'Mod+Shift+R', allowInInput: true, run: () => { const l = useLayout.getState(); l.setBottomBar(l.bottomBar === 'audio' ? 'none' : 'audio'); } },
  {
    id: 'audio.toggleRecord', title: 'Start / stop recording audio note', category: 'Audio', shortcut: 'Mod+Alt+R', allowInInput: true,
    run: async () => {
      if (useAudio.getState().recording) {
        const pin = (window as unknown as { __ilnPin?: { x: number; y: number } }).__ilnPin;
        const clip = await stopRecording();
        if (clip && peekCanvasDoc(clip.pageId)) await pinClip(clip, pin);
        (window as unknown as { __ilnPin?: unknown }).__ilnPin = undefined;
        return;
      }
      const page = currentPage();
      if (page && await startRecording(page)) useLayout.getState().setBottomBar('audio');
    },
  },
  { id: 'canvas.inkToText', title: 'Canvas: Convert selected ink to text (OCR)', category: 'Canvas', when: () => !!canvasPage(), run: async () => { const d = peekCanvasDoc(canvasPage()!); if (d) await inkToText(d); } },
  { id: 'canvas.inkToDiagram', title: 'Canvas: Convert selected ink to diagram', category: 'Canvas', when: () => !!canvasPage(), run: async () => { const d = peekCanvasDoc(canvasPage()!); if (d) await inkToDiagram(d); } },
]);
