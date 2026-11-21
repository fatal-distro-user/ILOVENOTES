import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { resolvePage, searchPages, openWikiTarget } from '../links';
import { suggestionRenderer, type SuggestItem } from '../suggestStore';
import type { TreeNode } from '@/db/types';

interface LinkItem extends SuggestItem { target: string; pageId: string | null }

/** Live-resolved target page (by id, then title). */
function useTarget(target: string, pageId: string | null): TreeNode | null | undefined {
  return useLiveQuery(async () => (await resolvePage(target, pageId)) ?? null, [target, pageId]);
}

function HoverPreview({ page, anchor, onEnter, onLeave }: { page: TreeNode; anchor: DOMRect; onEnter: () => void; onLeave: () => void }) {
  const doc = useLiveQuery(() => db.docs.get(page.id), [page.id]);
  const top = anchor.bottom + 6 + 260 > window.innerHeight ? anchor.top - 266 : anchor.bottom + 6;
  return createPortal(
    <div className="fixed z-[90] w-80 overflow-hidden rounded-lg border border-line bg-bg-1 shadow-2xl" style={{ left: Math.min(anchor.left, window.innerWidth - 330), top, maxHeight: 260 }}
      onMouseEnter={onEnter} onMouseLeave={onLeave} data-testid="wiki-preview">
      {page.cover && <div className="h-10" style={page.cover.startsWith('data:') ? { backgroundImage: `url(${page.cover})`, backgroundSize: 'cover' } : { background: page.cover }} />}
      <div className="p-3">
        <div className="mb-1 flex items-center gap-1.5 font-semibold"><span>{page.icon}</span><span className="truncate">{page.title}</span></div>
        <div className="line-clamp-[9] text-[12px] whitespace-pre-wrap text-fg-muted">{doc?.text?.slice(0, 700) || <span className="text-fg-faint italic">Empty page</span>}</div>
        {page.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{page.tags.map((t) => <span key={t} className="rounded bg-bg-3 px-1.5 text-[11px] text-fg-muted">#{t}</span>)}</div>}
      </div>
    </div>,
    document.body,
  );
}

function WikiLinkView({ node, selected }: NodeViewProps) {
  const target = node.attrs.target as string;
  const pageId = (node.attrs.pageId as string | null) ?? null;
  const page = useTarget(target, pageId);
  const ref = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const enter = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHover(ref.current?.getBoundingClientRect() ?? null), 350); };
  const leave = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHover(null), 200); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const label = (node.attrs.alias as string) || target + (node.attrs.heading ? ` › ${node.attrs.heading as string}` : '');
  return (
    <NodeViewWrapper as="span" className="iln-wikilink-wrap">
      <span ref={ref} contentEditable={false} data-testid="wikilink" data-target={target}
        className={`iln-wikilink${page === null ? ' unresolved' : ''}${selected ? ' selected' : ''}`}
        onMouseEnter={enter} onMouseLeave={leave}
        onClick={(e) => { e.preventDefault(); setHover(null); void openWikiTarget(target, page?.id ?? pageId, { newTab: e.ctrlKey || e.metaKey || e.button === 1, side: e.shiftKey }); }}
        title={page === null ? `Create “${target}”` : undefined}>
        {label}
      </span>
      {hover && page && <HoverPreview page={page} anchor={hover} onEnter={() => window.clearTimeout(timer.current)} onLeave={leave} />}
    </NodeViewWrapper>
  );
}

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { target: { default: '' }, pageId: { default: null }, alias: { default: '' }, heading: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'a[data-wikilink]', getAttrs: (el) => { const e = el as HTMLElement; return { target: e.dataset.target ?? e.textContent, pageId: e.dataset.pageId ?? null, alias: e.dataset.alias ?? '' }; } }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-wikilink': '', 'data-target': node.attrs.target, 'data-page-id': node.attrs.pageId ?? '', 'data-alias': node.attrs.alias, class: 'iln-wikilink' }), node.attrs.alias || node.attrs.target];
  },
  renderText({ node }) { return `[[${node.attrs.target}${node.attrs.alias ? '|' + node.attrs.alias : ''}]]`; },
  addNodeView() { return ReactNodeViewRenderer(WikiLinkView); },
  addInputRules() {
    // Typed/pasted "[[Target|alias]]" (closing brackets) becomes a link node.
    return [new InputRule({
      find: /\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]$/,
      handler: ({ state, range, match }) => {
        state.tr.replaceWith(range.from, range.to, this.type.create({ target: match[1].trim(), heading: match[2]?.trim() ?? '', alias: match[3]?.trim() ?? '' }));
      },
    })];
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<LinkItem, LinkItem>({
        editor: this.editor,
        pluginKey: new PluginKey('wikiLinkSuggest'),
        char: '[[',
        allowSpaces: true,
        items: async ({ query }) => {
          const pages = await searchPages(query.replace(/\]+$/, ''));
          const items: LinkItem[] = pages.map((p) => ({ id: p.id, title: p.title, subtitle: p.tags.map((t) => '#' + t).join(' ') || undefined, icon: p.icon, target: p.title, pageId: p.id }));
          const q = query.trim();
          if (q && !pages.some((p) => p.title.toLowerCase() === q.toLowerCase())) {
            items.push({ id: `new:${q}`, title: `Create “${q}”`, subtitle: 'New page', icon: '＋', target: q, pageId: null });
          }
          return items;
        },
        command: ({ editor, range, props }) => {
          // Swallow a trailing "]]" the user may have typed.
          const after = editor.state.doc.textBetween(range.to, Math.min(editor.state.doc.content.size, range.to + 2));
          const to = after === ']]' ? range.to + 2 : range.to;
          const bang = range.from > 1 && editor.state.doc.textBetween(range.from - 1, range.from) === '!';
          if (bang) {
            // "![[" → block transclusion
            editor.chain().focus().deleteRange({ from: range.from - 1, to })
              .insertContent({ type: 'wikiEmbed', attrs: { target: props.target, pageId: props.pageId } }).run();
            return;
          }
          editor.chain().focus().insertContentAt({ from: range.from, to }, [
            { type: 'wikiLink', attrs: { target: props.target, pageId: props.pageId } }, { type: 'text', text: ' ' },
          ]).run();
        },
        render: suggestionRenderer<LinkItem>('wiki'),
      }),
    ];
  },
});

/** Transclusion: ![[Page]] renders the target page's content read-only. */
function WikiEmbedView({ node, selected }: NodeViewProps) {
  const target = node.attrs.target as string;
  const page = useTarget(target, (node.attrs.pageId as string | null) ?? null);
  const doc = useLiveQuery(() => (page ? db.docs.get(page.id) : undefined), [page?.id]);
  return (
    <NodeViewWrapper className={`iln-embed${selected ? ' selected' : ''}`} data-testid="wiki-embed">
      <div contentEditable={false}>
        <div className="iln-embed-head" onClick={() => void openWikiTarget(target, page?.id)}>
          <span>{page?.icon ?? '📄'}</span><span>{page?.title ?? target}</span>{page === null && <em> (missing — click to create)</em>}
        </div>
        <div className="iln-embed-body">{doc?.text || (page ? 'Empty page' : '')}</div>
      </div>
    </NodeViewWrapper>
  );
}

export const WikiEmbed = Node.create({
  name: 'wikiEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { target: { default: '' }, pageId: { default: null } }; },
  parseHTML() { return [{ tag: 'div[data-wiki-embed]', getAttrs: (el) => ({ target: (el as HTMLElement).dataset.target }) }]; },
  renderHTML({ HTMLAttributes, node }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-wiki-embed': '', 'data-target': node.attrs.target }), `![[${node.attrs.target}]]`]; },
  renderText({ node }) { return `![[${node.attrs.target}]]`; },
  addNodeView() { return ReactNodeViewRenderer(WikiEmbedView); },
  addInputRules() {
    return [new InputRule({
      find: /^!\[\[([^\]\n]+)\]\]$/,
      handler: ({ state, range, match }) => {
        const $from = state.doc.resolve(range.from);
        const start = $from.before(), end = $from.after();
        state.tr.replaceWith(start, end, this.type.create({ target: match[1].trim() }));
      },
    })];
  },
});
