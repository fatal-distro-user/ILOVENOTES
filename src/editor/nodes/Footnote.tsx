import { Node, mergeAttributes, Extension } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { nanoid } from 'nanoid';
import { useRef, useState } from 'react';
import { Popover } from '@/ui/Popover';

declare module '@tiptap/core' {
  interface Commands<ReturnType> { footnote: { insertFootnote: (note?: string) => ReturnType } }
}

/** Ordered list of footnotes in a document. */
export function collectFootnotes(doc: PMNode): { id: string; note: string; pos: number; n: number }[] {
  const out: { id: string; note: string; pos: number; n: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnoteRef') out.push({ id: node.attrs.id as string, note: node.attrs.note as string, pos, n: out.length + 1 });
  });
  return out;
}

function FootnoteView({ node, updateAttributes, decorations, editor }: NodeViewProps) {
  const n = (decorations.find((d) => (d.spec as { footnoteN?: number }).footnoteN)?.spec as { footnoteN?: number } | undefined)?.footnoteN ?? '?';
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(!(node.attrs.note as string) && editor.isEditable);
  return (
    <NodeViewWrapper as="span">
      <sup ref={ref} id={`fnref-${node.attrs.id as string}`} contentEditable={false} className="iln-footnote-ref" onClick={() => setOpen(true)} title={node.attrs.note as string}>
        [{n}]
      </sup>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)}>
          <div className="w-72 p-2">
            <div className="mb-1 text-[11px] text-fg-faint">Footnote {n}</div>
            <textarea autoFocus defaultValue={node.attrs.note as string} readOnly={!editor.isEditable} rows={3}
              className="w-full resize-none rounded border border-line bg-bg-2 p-1.5 outline-none focus:border-accent"
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setOpen(false); } if (e.key === 'Escape') setOpen(false); }}
              onChange={(e) => updateAttributes({ note: e.target.value })} />
          </div>
        </Popover>
      )}
    </NodeViewWrapper>
  );
}

export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { id: { default: null }, note: { default: '' } }; },
  parseHTML() { return [{ tag: 'sup[data-footnote]', getAttrs: (el) => ({ id: (el as HTMLElement).dataset.footnote, note: (el as HTMLElement).title }) }]; },
  renderHTML({ HTMLAttributes, node }) { return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote': node.attrs.id, title: node.attrs.note }), '*']; },
  renderText({ node }) { return `[^${node.attrs.id as string}]`; },
  addNodeView() { return ReactNodeViewRenderer(FootnoteView); },
  addCommands() {
    return { insertFootnote: (note = '') => ({ commands }) => commands.insertContent({ type: this.name, attrs: { id: nanoid(6), note } }) };
  },
});

/** Numbers footnotes in document order via node decorations (read by the node view). */
export const FootnoteNumbering = Extension.create({
  name: 'footnoteNumbering',
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => DecorationSet.create(doc, collectFootnotes(doc).map((f) =>
      Decoration.node(f.pos, f.pos + 1, { 'data-n': String(f.n) }, { footnoteN: f.n })));
    return [new Plugin({
      key: new PluginKey('footnoteNumbering'),
      state: { init: (_c, s) => build(s.doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});
