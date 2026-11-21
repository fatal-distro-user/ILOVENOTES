import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useRef, useState } from 'react';
import { Popover } from '@/ui/Popover';

export const CALLOUT_KINDS: Record<string, { emoji: string; label: string; color: string }> = {
  note: { emoji: '📝', label: 'Note', color: '#3b82f6' },
  tip: { emoji: '💡', label: 'Tip', color: '#10b981' },
  info: { emoji: 'ℹ️', label: 'Info', color: '#06b6d4' },
  warning: { emoji: '⚠️', label: 'Warning', color: '#f59e0b' },
  danger: { emoji: '🛑', label: 'Danger', color: '#ef4444' },
  quote: { emoji: '💬', label: 'Quote', color: '#a855f7' },
  success: { emoji: '✅', label: 'Success', color: '#22c55e' },
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: { setCallout: (kind?: string) => ReturnType; toggleCallout: (kind?: string) => ReturnType };
  }
}

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const kind = CALLOUT_KINDS[node.attrs.kind as string] ?? CALLOUT_KINDS.note;
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <NodeViewWrapper className="iln-callout" style={{ '--callout': kind.color } as React.CSSProperties} data-kind={node.attrs.kind}>
      <button ref={btn} contentEditable={false} className="iln-callout-icon" onClick={() => editor.isEditable && setOpen(true)} title="Change callout type">
        {(node.attrs.emoji as string) || kind.emoji}
      </button>
      <NodeViewContent className="iln-callout-body" />
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)}>
          <div className="flex flex-col p-1">
            {Object.entries(CALLOUT_KINDS).map(([k, v]) => (
              <button key={k} className="flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-bg-3" onClick={() => { updateAttributes({ kind: k, emoji: '' }); setOpen(false); }}>
                <span>{v.emoji}</span><span>{v.label}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { kind: { default: 'note' }, emoji: { default: '' } };
  },
  parseHTML() { return [{ tag: 'div[data-callout]', getAttrs: (el) => ({ kind: (el as HTMLElement).dataset.callout }) }]; },
  renderHTML({ HTMLAttributes, node }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': node.attrs.kind, class: 'iln-callout' }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
  addCommands() {
    return {
      setCallout: (kind = 'note') => ({ commands }) => commands.wrapIn(this.name, { kind }),
      toggleCallout: (kind = 'note') => ({ commands }) => commands.toggleWrap(this.name, { kind }),
    };
  },
});
