import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';

export interface HeadingInfo { level: number; text: string; pos: number }

export function editorHeadings(editor: Editor): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'heading') out.push({ level: n.attrs.level as number, text: n.textContent, pos });
  });
  return out;
}

export function scrollToPos(editor: Editor, pos: number): void {
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement) {
    dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
    dom.classList.add('iln-flash-target');
    setTimeout(() => dom.classList.remove('iln-flash-target'), 1200);
  }
  editor.commands.setTextSelection(pos + 1);
}

export function useEditorHeadings(editor: Editor | null): HeadingInfo[] {
  const [hs, setHs] = useState<HeadingInfo[]>(() => (editor ? editorHeadings(editor) : []));
  useEffect(() => {
    if (!editor) { setHs([]); return; }
    const update = () => setHs(editorHeadings(editor));
    update();
    editor.on('update', update);
    return () => { editor.off('update', update); };
  }, [editor]);
  return hs;
}

function TocView({ editor, selected }: NodeViewProps) {
  const hs = useEditorHeadings(editor);
  const min = Math.min(...hs.map((h) => h.level), 6);
  return (
    <NodeViewWrapper className={`iln-toc${selected ? ' selected' : ''}`} data-testid="toc">
      <div contentEditable={false}>
        <div className="iln-toc-title">Table of contents</div>
        {hs.length === 0 && <div className="text-fg-faint">Add headings to build the outline.</div>}
        {hs.map((h, i) => (
          <button key={i} className="iln-toc-item" style={{ paddingLeft: (h.level - min) * 14 + 4 }} onClick={() => scrollToPos(editor, h.pos)}>{h.text || 'Untitled heading'}</button>
        ))}
      </div>
    </NodeViewWrapper>
  );
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() { return [{ tag: 'nav[data-toc]' }]; },
  renderHTML({ HTMLAttributes }) { return ['nav', mergeAttributes(HTMLAttributes, { 'data-toc': '' })]; },
  addNodeView() { return ReactNodeViewRenderer(TocView); },
});
