import { Node, mergeAttributes, InputRule, nodeInputRule } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';

export function renderKatex(latex: string, displayMode: boolean): { html: string; error: string | null } {
  try {
    return { html: katex.renderToString(latex || '\\square', { displayMode, throwOnError: true, strict: 'ignore', trust: false, output: 'html' }), error: null };
  } catch (e) {
    return { html: katex.renderToString(latex || '', { displayMode, throwOnError: false, output: 'html' }), error: e instanceof Error ? e.message : String(e) };
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: { insertMathInline: (latex?: string) => ReturnType; insertMathBlock: (latex?: string) => ReturnType };
  }
}

function MathView({ node, updateAttributes, selected, editor, getPos, deleteNode }: NodeViewProps) {
  const block = node.type.name === 'mathBlock';
  const latex = node.attrs.latex as string;
  const [editing, setEditing] = useState(!latex && editor.isEditable);
  const [draft, setDraft] = useState(latex);
  const input = useRef<HTMLTextAreaElement>(null);
  const rendered = useMemo(() => renderKatex(editing ? draft : latex, block), [editing, draft, latex, block]);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  useEffect(() => { if (!editing) setDraft(latex); }, [latex, editing]);

  const commit = (moveAfter: boolean) => {
    setEditing(false);
    if (!draft.trim()) { deleteNode(); return; }
    updateAttributes({ latex: draft });
    if (moveAfter && typeof getPos === 'function') {
      const pos = getPos();
      if (typeof pos === 'number') editor.chain().focus().setTextSelection(pos + node.nodeSize).run();
    }
  };

  const Tag = block ? 'div' : 'span';
  return (
    <NodeViewWrapper as={Tag} className={block ? 'iln-math-block' : 'iln-math-inline'} data-selected={selected ? 'true' : undefined}>
      <Tag className={rendered.error ? 'iln-math-error' : undefined} title={rendered.error ?? 'Click to edit'} contentEditable={false}
        onClick={() => editor.isEditable && setEditing(true)} dangerouslySetInnerHTML={{ __html: rendered.html }} />
      {editing && (
        <span className={block ? 'iln-math-editor block' : 'iln-math-editor'} contentEditable={false}>
          <textarea ref={input} value={draft} rows={block ? 3 : 1} spellCheck={false} placeholder={block ? '\\int_0^1 x^2\\,dx' : 'e^{i\\pi}+1=0'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') { setDraft(latex); setEditing(false); if (!latex) deleteNode(); }
              if (e.key === 'Enter' && (!block || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(true); }
            }}
            onBlur={() => commit(false)} />
          {rendered.error && <span className="iln-math-errmsg">{rendered.error}</span>}
        </span>
      )}
    </NodeViewWrapper>
  );
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { latex: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-math-inline]', getAttrs: (el) => ({ latex: (el as HTMLElement).dataset.latex ?? (el as HTMLElement).textContent }) }]; },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '', 'data-latex': node.attrs.latex }), node.attrs.latex];
  },
  renderText({ node }) { return `$${node.attrs.latex}$`; },
  addNodeView() { return ReactNodeViewRenderer(MathView); },
  addCommands() {
    return { insertMathInline: (latex = '') => ({ commands }) => commands.insertContent({ type: this.name, attrs: { latex } }) };
  },
  addInputRules() {
    // $x^2$ followed by any character converts to inline math.
    return [new InputRule({
      find: /(?:^|[^$\\])\$([^$\n]+?)\$$/,
      handler: ({ state, range, match }) => {
        const latex = match[1];
        const start = range.from + (match[0].startsWith('$') ? 0 : 1);
        state.tr.replaceWith(start, range.to, this.type.create({ latex }));
      },
    })];
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() { return { latex: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-math-block]', getAttrs: (el) => ({ latex: (el as HTMLElement).dataset.latex ?? (el as HTMLElement).textContent }) }]; },
  renderHTML({ HTMLAttributes, node }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '', 'data-latex': node.attrs.latex }), node.attrs.latex]; },
  renderText({ node }) { return `$$${node.attrs.latex}$$`; },
  addNodeView() { return ReactNodeViewRenderer(MathView); },
  addCommands() {
    return { insertMathBlock: (latex = '') => ({ commands }) => commands.insertContent({ type: this.name, attrs: { latex } }) };
  },
  addInputRules() { return [nodeInputRule({ find: /^\$\$\s$/, type: this.type })]; },
});
