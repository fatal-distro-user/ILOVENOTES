/** Slash "/" command menu: an extensible registry of block insertions. */
import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { suggestionRenderer, type SuggestItem } from './suggestStore';

export interface SlashItem extends SuggestItem {
  keywords?: string[];
  run(editor: Editor, range: Range): void | Promise<void>;
}

const registry: SlashItem[] = [];
export function registerSlashItem(item: SlashItem): void {
  const i = registry.findIndex((r) => r.id === item.id);
  if (i >= 0) registry[i] = item; else registry.push(item);
}
export function slashItems(): readonly SlashItem[] { return registry; }

export function filterSlash(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return registry.slice();
  return registry
    .map((it) => {
      const hay = [it.title, ...(it.keywords ?? [])].map((s) => s.toLowerCase());
      const words = q.split(/\s+/);
      const score = hay.some((h) => h.startsWith(q)) ? 3 : hay.some((h) => h.includes(q)) ? 2 : words.every((w) => hay.some((h) => h.includes(w))) ? 1 : 0;
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.it);
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        startOfLine: false,
        allowSpaces: true,
        allow: ({ state, range }) => {
          // Not inside code blocks; only at line start or after whitespace.
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code) return false;
          const before = state.doc.textBetween(Math.max($from.start(), range.from - 1), range.from, '\n', '\n');
          return before === '' || /\s/.test(before);
        },
        // Allow multi-word queries ("heading 2") but stop suggesting once the user is clearly writing prose.
        items: ({ query }) => (query.split(/\s+/).length > 3 ? [] : filterSlash(query)),
        command: ({ editor, range, props }) => { void props.run(editor, range); },
        render: suggestionRenderer<SlashItem>('slash'),
      }),
    ];
  },
});
