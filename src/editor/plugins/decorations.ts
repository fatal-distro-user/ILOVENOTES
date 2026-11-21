/** Inline decorations: clickable #tags and flashcard (Q :: A / cloze) highlighting. */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

const TAG_RE = /(^|[\s([{,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
const CLOZE_RE = /\{\{c\d+::.+?\}\}/g;

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.isTextblock) {
      if (node.type.spec.code) return false;
      const text = node.textContent;
      if (/\s:::?\s/.test(text) || CLOZE_RE.test(text)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'iln-flashcard-line' }));
      CLOZE_RE.lastIndex = 0;
      return true;
    }
    if (!node.isText || !node.text || parent?.type.spec.code) return false;
    if (node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return false;
    for (const m of node.text.matchAll(TAG_RE)) {
      const from = pos + (m.index ?? 0) + m[1].length;
      decos.push(Decoration.inline(from, from + m[2].length + 1, { class: 'iln-tag', 'data-tag': m[2].toLowerCase(), title: 'Ctrl/Cmd+click to see all pages with this tag' }));
    }
    for (const m of node.text.matchAll(CLOZE_RE)) {
      const from = pos + (m.index ?? 0);
      decos.push(Decoration.inline(from, from + m[0].length, { class: 'iln-cloze' }));
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export interface InlineDecorationOptions { onTagClick: (tag: string) => void }

export const InlineDecorations = Extension.create<InlineDecorationOptions>({
  name: 'inlineDecorations',
  addOptions() { return { onTagClick: () => undefined }; },
  addProseMirrorPlugins() {
    const onTagClick = this.options.onTagClick;
    return [new Plugin({
      key: new PluginKey('inlineDecorations'),
      state: { init: (_c, s) => build(s.doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old.map(tr.mapping, tr.doc)) },
      props: {
        decorations(state) { return this.getState(state); },
        handleClick(view, _pos, event) {
          const el = (event.target as HTMLElement | null)?.closest?.('.iln-tag') as HTMLElement | null;
          if (!el?.dataset.tag) return false;
          // Mod+click (or any click in a read-only view) opens the tag search; plain clicks place the caret.
          if (!(event.ctrlKey || event.metaKey) && view.editable) return false;
          onTagClick(el.dataset.tag);
          return true;
        },
      },
    })];
  },
});
