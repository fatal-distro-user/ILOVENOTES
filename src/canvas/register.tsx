import { useRef, useState } from 'react';
import { registerPageBody, type PageBodyProps } from '@/views/registry';
import { registerCommands } from '@/commands/registry';
import { DocumentEditor } from '@/editor/DocumentEditor';
import { CanvasView } from './CanvasView';
import { useCanvasTools } from './tools';
import { activeScope } from '@/history/scopes';

function CanvasBody({ node, active }: PageBodyProps) {
  return <CanvasView pageId={node.id} active={active} />;
}

/** Hybrid page: document column + infinite canvas side by side, sharing the same page. */
function HybridBody({ node, active }: PageBodyProps) {
  const key = `iln-hybrid-ratio:${node.id}`;
  const [ratio, setRatio] = useState(() => Number(localStorage.getItem(key)) || 0.42);
  const box = useRef<HTMLDivElement>(null);
  const startDrag = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const v = Math.min(0.8, Math.max(0.2, (ev.clientX - r.left) / r.width));
      setRatio(v);
      localStorage.setItem(key, String(v));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div ref={box} className="flex h-full w-full" data-testid="hybrid">
      <div className="h-full overflow-y-auto border-r border-line" style={{ width: `${ratio * 100}%` }}>
        <DocumentEditor pageId={node.id} active={active} compact />
      </div>
      <div className="w-1 shrink-0 cursor-col-resize bg-line/40 hover:bg-accent" onPointerDown={startDrag} title="Drag to resize" />
      <div className="h-full min-w-0 flex-1"><CanvasView pageId={node.id} active={active} compact /></div>
    </div>
  );
}

registerPageBody('canvas', CanvasBody);
registerPageBody('hybrid', HybridBody);

const isCanvasActive = () => !!activeScope()?.id.startsWith('canvas:');
const tool = (t: Parameters<ReturnType<typeof useCanvasTools.getState>['setTool']>[0]) => () => useCanvasTools.getState().setTool(t);
registerCommands([
  { id: 'canvas.tool.select', title: 'Canvas: Select tool', category: 'Canvas', when: isCanvasActive, run: tool('select') },
  { id: 'canvas.tool.pen', title: 'Canvas: Pen', category: 'Canvas', when: isCanvasActive, run: tool('pen') },
  { id: 'canvas.tool.highlighter', title: 'Canvas: Highlighter', category: 'Canvas', when: isCanvasActive, run: tool('highlighter') },
  { id: 'canvas.tool.eraser', title: 'Canvas: Eraser', category: 'Canvas', when: isCanvasActive, run: tool('eraser') },
  { id: 'canvas.tool.text', title: 'Canvas: Text', category: 'Canvas', when: isCanvasActive, run: tool('text') },
  { id: 'canvas.tool.rect', title: 'Canvas: Rectangle', category: 'Canvas', when: isCanvasActive, run: tool('rect') },
  { id: 'canvas.tool.ellipse', title: 'Canvas: Ellipse', category: 'Canvas', when: isCanvasActive, run: tool('ellipse') },
  { id: 'canvas.tool.arrow', title: 'Canvas: Arrow', category: 'Canvas', when: isCanvasActive, run: tool('arrow') },
  { id: 'canvas.tool.frame', title: 'Canvas: Frame', category: 'Canvas', when: isCanvasActive, run: tool('frame') },
  { id: 'canvas.tool.laser', title: 'Canvas: Laser pointer', category: 'Canvas', when: isCanvasActive, run: tool('laser') },
  { id: 'canvas.snap', title: 'Canvas: Toggle snap to grid', category: 'Canvas', run: () => { const t = useCanvasTools.getState(); t.set({ snapToGrid: !t.snapToGrid }); } },
]);
