import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { ChevronRight } from 'lucide-react';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> { toggleBlock: { insertToggle: () => ReturnType } }
}

function ToggleView({ node, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open as boolean;
  return (
    <NodeViewWrapper className="iln-toggle" data-open={open ? 'true' : 'false'}>
      <button contentEditable={false} className="iln-toggle-btn" onClick={() => updateAttributes({ open: !open })} aria-label={open ? 'Collapse' : 'Expand'}>
        <ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      <NodeViewContent className="iln-toggle-inner" />
    </NodeViewWrapper>
  );
}

/** Collapsible toggle block: first child is the always-visible summary, the rest is hidden when closed. */
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,
  addAttributes() { return { open: { default: true } }; },
  parseHTML() { return [{ tag: 'details', getAttrs: (el) => ({ open: (el as HTMLElement).hasAttribute('open') }) }]; },
  renderHTML({ HTMLAttributes, node }) { return ['details', mergeAttributes(HTMLAttributes, node.attrs.open ? { open: '' } : {}), 0]; },
  addNodeView() { return ReactNodeViewRenderer(ToggleView); },
  addCommands() {
    return {
      insertToggle: () => ({ chain, state }) => {
        const pos = state.selection.from;
        return chain().insertContent({
          type: 'toggle', attrs: { open: true },
          content: [{ type: 'toggleSummary' }, { type: 'toggleContent', content: [{ type: 'paragraph' }] }],
        }).command(({ tr }) => {
          // Place the cursor inside the new summary.
          const $p = tr.doc.resolve(Math.min(tr.doc.content.size, pos + 2));
          tr.setSelection(TextSelection.near($p));
          return true;
        }).run();
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Enter in the summary jumps into the body.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name !== 'toggleSummary') return false;
        const toggle = $from.node($from.depth - 1);
        if (!toggle.attrs.open) editor.commands.command(({ tr }) => { tr.setNodeMarkup($from.before($from.depth - 1), undefined, { open: true }); return true; });
        const after = $from.after();
        return editor.commands.setTextSelection(after + 2);
      },
    };
  },
});

export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'summary' }]; },
  renderHTML({ HTMLAttributes }) { return ['summary', mergeAttributes(HTMLAttributes, { class: 'iln-toggle-summary', 'data-placeholder': 'Toggle' }), 0]; },
});

export const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-toggle-content]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle-content': '', class: 'iln-toggle-content' }), 0]; },
});
