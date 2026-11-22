/** Inline paint frame embedded in a document: paint directly inside the page, or open it in the studio. */
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Brush, Eraser, Undo2, Redo2, Maximize2, Hand } from 'lucide-react';
import { acquirePaintDoc, releasePaintDoc, PaintDocument } from '@/paint/engine/document';
import { PaintSurface } from '@/paint/studio/PaintSurface';
import { usePaintStudio } from '@/paint/studio/store';
import { useUndoScopes } from '@/history/scopes';
import { openPaintStudio } from '@/paint/register';
import { registerEditorExtension } from '@/editor/extensions';
import { registerSlashItem } from '@/editor/slash';
import { useActiveEditor } from '@/editor/activeEditor';
import { toast } from '@/store/status';

declare module '@tiptap/core' {
  interface Commands<ReturnType> { sketch: { insertSketch: (attrs: { docId: string; height?: number }) => ReturnType } }
}

function SketchView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const docId = node.attrs.docId as string;
  const [doc, setDoc] = useState<PaintDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const studio = usePaintStudio();
  const [active, setActive] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    acquirePaintDoc(docId).then((d) => alive && setDoc(d)).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; releasePaintDoc(docId); };
  }, [docId]);
  // Becomes the active paint doc while the pointer is inside.
  const activate = () => { if (doc) { usePaintStudio.getState().setDoc(doc); setActive(true); } };
  const height = Number(node.attrs.height ?? 320);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = height;
    const mv = (ev: PointerEvent) => updateAttributes({ height: Math.max(140, Math.min(1200, Math.round(h0 + ev.clientY - y0))) });
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const tool = (id: string, Icon: typeof Brush, title: string) => (
    <button title={title} onClick={() => { activate(); studio.setTool(id); }} className={clsx('flex h-6 w-6 items-center justify-center rounded', studio.tool === id && active ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3')}><Icon size={13} /></button>
  );
  return (
    <NodeViewWrapper className={clsx('iln-sketch my-3 overflow-hidden rounded-lg border', selected ? 'border-accent' : 'border-line')} data-testid="doc-sketch" contentEditable={false}>
      <div className="flex items-center gap-1 border-b border-line bg-bg-1 px-1.5 py-1 text-[11px]" onPointerDown={(e) => e.stopPropagation()}>
        {tool('brush', Brush, 'Brush')}{tool('eraser', Eraser, 'Eraser')}{tool('hand', Hand, 'Pan')}
        <input type="color" value={studio.color.slice(0, 7)} onChange={(e) => studio.set({ color: e.target.value })} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" title="Colour" />
        <input type="range" min={1} max={80} value={Math.min(80, studio.size)} onChange={(e) => studio.set({ size: Number(e.target.value) })} className="w-20 accent-[var(--iln-accent)]" title="Size" />
        <button title="Undo" className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-3" onClick={() => void doc?.history.undo()}><Undo2 size={13} /></button>
        <button title="Redo" className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-3" onClick={() => void doc?.history.redo()}><Redo2 size={13} /></button>
        <div className="flex-1" />
        <span className="text-fg-faint">{doc ? `${doc.width}×${doc.height}` : ''}</span>
        <button className="flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-3" onClick={() => doc && openPaintStudio(doc.id, doc.meta.name ?? 'Sketch')} data-testid="sketch-open-studio"><Maximize2 size={12} />Open in studio</button>
      </div>
      <div ref={box} style={{ height }} onPointerDown={() => { activate(); if (doc) useUndoScopes.getState().activate(`paint:${doc.id}`); }} onPointerEnter={activate}>
        {error ? <div className="p-4 text-danger">Sketch unavailable: {error}</div>
          : doc ? <PaintSurface doc={doc} active={active && editor.isEditable} compact />
          : <div className="p-4 text-fg-faint">Loading sketch…</div>}
      </div>
      <div className="h-2 cursor-ns-resize bg-bg-2 hover:bg-accent/40" onPointerDown={startResize} title="Drag to resize" />
    </NodeViewWrapper>
  );
}

export const SketchNode = Node.create({
  name: 'sketch',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() { return { docId: { default: '' }, height: { default: 320 } }; },
  parseHTML() { return [{ tag: 'div[data-sketch]', getAttrs: (el) => ({ docId: (el as HTMLElement).dataset.sketch }) }]; },
  renderHTML({ HTMLAttributes, node }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-sketch': node.attrs.docId })]; },
  addNodeView() { return ReactNodeViewRenderer(SketchView); },
  addCommands() { return { insertSketch: (attrs) => ({ commands }) => commands.insertContent({ type: this.name, attrs }) }; },
});

registerEditorExtension(SketchNode);
registerSlashItem({
  id: 'sketch', title: 'Sketch / paint frame', subtitle: 'Paint inline with layers & brushes', icon: '🎨', group: 'Media', keywords: ['draw', 'paint', 'canvas', 'ink'],
  run: async (editor, range) => {
    editor.chain().focus().deleteRange(range).run();
    const pageId = useActiveEditor.getState().pageId;
    if (!pageId) { toast('Open a page first', 'error'); return; }
    try {
      const pd = await PaintDocument.create({ pageId, ownerId: crypto.randomUUID(), width: 1600, height: 700, background: '#ffffff', name: 'Sketch' });
      editor.chain().focus().insertSketch({ docId: pd.id, height: 320 }).run();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not create sketch', 'error'); }
  },
});
