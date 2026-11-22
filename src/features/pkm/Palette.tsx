import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import clsx from 'clsx';
import { CornerDownLeft, FilePlus2, Hash, Heading, Paintbrush, Search, Terminal } from 'lucide-react';
import { formatShortcut, useCommands } from '@/commands/registry';
import { useRecent } from '@/db/hooks';
import { useWorkspace } from '@/store/workspace';
import { useTabs } from '@/store/tabs';
import { useActiveEditor } from '@/editor/activeEditor';
import { editorHeadings, scrollToPos } from '@/editor/nodes/Toc';
import { newNode, openNode } from '@/layout/actions';
import { allPresets, useBrushes, type BrushToolId } from '@/paint/brushes/store';
import { usePaintStudio } from '@/paint/studio/store';
import { toast } from '@/store/status';
import { ensureIndexLive, indexVersion, notebookNames, pageIndex, pageMeta, refreshIndexNow, subscribeIndex } from './searchIndex';
import { fuzzyScore, parsePaletteQuery, rankFuzzy, snippetAround, type Snippet } from './searchLogic';

interface PaletteState { open: boolean; initial: string; show(initial?: string): void; hide(): void; toggle(): void }
export const usePalette = create<PaletteState>()((set, get) => ({
  open: false, initial: '',
  show: (initial = '') => set({ open: true, initial }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open, initial: '' }),
}));

type ItemKind = 'note' | 'heading' | 'tag' | 'command' | 'brush' | 'create';
interface Item {
  key: string; kind: ItemKind; label: string; sub?: string; icon?: string; snippet?: Snippet | null; shortcut?: string;
  run(newTab: boolean): void | Promise<void>;
}

/** Open a page and, once its editor is mounted, scroll to the heading with the given text. */
export function jumpToHeading(pageId: string, title: string, heading: string, newTab: boolean): void {
  openNode({ id: pageId, title }, { newTab });
  let tries = 0;
  const attempt = () => {
    const { editor, pageId: pid } = useActiveEditor.getState();
    if (editor && !editor.isDestroyed && pid === pageId) {
      const h = editorHeadings(editor).find((x) => x.text.trim() === heading.trim());
      if (h) { scrollToPos(editor, h.pos); return; }
    }
    if (++tries < 30) window.setTimeout(attempt, 100);
  };
  window.setTimeout(attempt, 60);
}

const KIND_ICON: Record<ItemKind, typeof Search> = { note: Search, heading: Heading, tag: Hash, command: Terminal, brush: Paintbrush, create: FilePlus2 };

function Highlight({ s }: { s: Snippet }) {
  return <>{s.before}<mark className="rounded bg-accent/30 px-0.5 text-fg">{s.match}</mark>{s.after}</>;
}

export function PaletteOverlay() {
  const open = usePalette((s) => s.open);
  return open ? <PaletteModal /> : null;
}

function PaletteModal() {
  const hide = usePalette((s) => s.hide);
  const initial = usePalette((s) => s.initial);
  const ws = useWorkspace((s) => s.workspaceId);
  const recent = useRecent(ws, 8);
  const commands = useCommands();
  const [query, setQuery] = useState(initial);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ver = useSyncExternalStore(subscribeIndex, indexVersion);

  useEffect(() => { ensureIndexLive(); void refreshIndexNow(); inputRef.current?.focus(); }, []);

  const go = useCallback((fn: () => void | Promise<void>) => { hide(); void fn(); }, [hide]);

  const items = useMemo<Item[]>(() => {
    void ver;
    const { mode, term } = parsePaletteQuery(query);
    const out: Item[] = [];
    const crumb = (id: string) => notebookNames.get(pageMeta.get(id)?.notebookId ?? '')?.name;
    const pageItem = (id: string, snippet: Snippet | null): Item | null => {
      const p = pageIndex.pages.get(id);
      if (!p) return null;
      return {
        key: `note:${id}`, kind: 'note', label: p.title || 'Untitled', icon: pageMeta.get(id)?.icon ?? '📄', sub: crumb(id), snippet,
        run: (nt) => openNode({ id, title: p.title }, { newTab: nt }),
      };
    };

    if (!term && mode === 'all') {
      for (const n of recent) out.push({ key: `note:${n.id}`, kind: 'note', label: n.title, icon: n.icon, sub: notebookNames.get(n.notebookId)?.name ?? 'Recent', run: (nt) => openNode(n, { newTab: nt }) });
      return out;
    }

    if (mode === 'all') {
      for (const h of pageIndex.search(term, 8)) {
        const p = pageIndex.pages.get(h.id);
        const it = pageItem(h.id, p ? snippetAround(p.text, term) : null);
        if (it) out.push(it);
      }
    }

    if (mode === 'all' || mode === 'headings') {
      const heads: { pageId: string; title: string; text: string }[] = [];
      for (const p of pageIndex.pages.values()) for (const h of p.headings) if (h.trim()) heads.push({ pageId: p.id, title: p.title, text: h });
      const ranked = term ? rankFuzzy(heads, term, (h) => h.text, mode === 'headings' ? 40 : 4) : heads.slice(0, 40);
      for (const h of ranked) {
        out.push({
          key: `h:${h.pageId}:${h.text}`, kind: 'heading', label: h.text, sub: h.title, icon: '§',
          run: (nt) => jumpToHeading(h.pageId, h.title, h.text, nt),
        });
      }
    }

    if (mode === 'all' || mode === 'tags') {
      const counts = new Map<string, number>();
      for (const m of pageMeta.values()) for (const t of m.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
      const tags = Array.from(counts.entries()).map(([t, c]) => ({ t, c }));
      const ranked = term ? rankFuzzy(tags, term, (x) => x.t, mode === 'tags' ? 40 : 3) : tags.sort((a, b) => b.c - a.c).slice(0, 40);
      for (const x of ranked) {
        out.push({
          key: `tag:${x.t}`, kind: 'tag', label: `#${x.t}`, sub: `${x.c} page${x.c === 1 ? '' : 's'}`,
          run: () => { useTabs.getState().open({ kind: 'search', title: `#${x.t}`, params: { tags: x.t } }); },
        });
      }
    }

    if (mode === 'all' || mode === 'commands') {
      const avail = commands.filter((c) => c.id !== 'palette.open' && (!c.when || safeWhen(c.when)));
      const scored = avail
        .map((c) => ({ c, s: term ? Math.max(fuzzyScore(c.title, term), fuzzyScore(`${c.category} ${c.title}`, term) * 0.9, ...(c.keywords ?? []).map((k) => fuzzyScore(k, term) * 0.7)) : 1 }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.c.title.localeCompare(b.c.title))
        .slice(0, mode === 'commands' ? 60 : 6);
      for (const { c } of scored) {
        const sc = Array.isArray(c.shortcut) ? c.shortcut[0] : c.shortcut;
        out.push({ key: `cmd:${c.id}`, kind: 'command', label: c.title, sub: c.category, shortcut: sc ? formatShortcut(sc) : undefined, run: () => c.run() });
      }
    }

    if (mode === 'all' && term && usePaintStudio.getState().doc) {
      const brushes = rankFuzzy(allPresets(), term, (b) => b.name, 4);
      for (const b of brushes) {
        out.push({
          key: `brush:${b.id}`, kind: 'brush', label: b.name, sub: `Brush · ${b.category}`,
          run: () => {
            const tool: BrushToolId = b.mode === 'paint' ? 'brush' : b.mode === 'erase' ? 'eraser' : b.mode;
            useBrushes.getState().setPreset(tool, b.id);
            usePaintStudio.getState().setTool(tool);
            toast(`Brush: ${b.name}`, 'ok');
          },
        });
      }
    }

    if (mode === 'all' && term) {
      out.push({ key: 'create', kind: 'create', label: `Create page “${term}”`, sub: 'New page in current notebook', run: async () => { await newNode({ title: term }); } });
    }
    return out;
  }, [query, ver, recent, commands]);

  useEffect(() => { setSel(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[sel];
      if (it) go(() => it.run(e.ctrlKey || e.metaKey));
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
  };

  const { mode } = parsePaletteQuery(query);
  const empty = !parsePaletteQuery(query).term && mode === 'all';

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/50 pt-[12vh]" onPointerDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" data-testid="palette" className="flex max-h-[68vh] w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-line bg-bg-1 text-fg shadow-2xl">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-fg-faint" />
          <input
            ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} autoFocus spellCheck={false}
            placeholder="Search pages, headings, tags and commands…   (> commands  # tags  @ headings)"
            data-testid="palette-input" style={{ outline: 'none' }} className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-faint"
          />
          <kbd className="rounded border border-line bg-bg-2 px-1.5 text-[10.5px] text-fg-faint">Esc</kbd>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox">
          {empty && items.length > 0 && <div className="px-2.5 pb-1 pt-1 text-[10.5px] uppercase tracking-wider text-fg-faint">Recent pages</div>}
          {items.map((it, i) => {
            const Icon = KIND_ICON[it.kind];
            return (
              <button
                key={it.key} data-index={i} data-testid="palette-item" data-kind={it.kind} role="option" aria-selected={i === sel}
                onMouseMove={() => setSel(i)} onClick={(e) => go(() => it.run(e.ctrlKey || e.metaKey))}
                className={clsx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left', i === sel ? 'bg-accent/20 ring-1 ring-inset ring-accent/40' : 'hover:bg-bg-2')}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[15px]">
                  {it.icon ?? <Icon size={15} className="text-fg-muted" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{it.label}</span>
                  {it.snippet && <span className="block truncate text-[11.5px] text-fg-muted"><Highlight s={it.snippet} /></span>}
                </span>
                {it.sub && <span className="max-w-[40%] shrink-0 truncate text-[11px] text-fg-faint">{it.sub}</span>}
                {it.shortcut && <kbd className="shrink-0 rounded border border-line bg-bg-2 px-1.5 text-[10.5px] text-fg-muted">{it.shortcut}</kbd>}
                {i === sel && <CornerDownLeft size={12} className="shrink-0 text-fg-faint" />}
              </button>
            );
          })}
          {items.length === 0 && <div className="p-8 text-center text-fg-faint">{empty ? 'No recent pages yet. Start typing to search.' : 'No matches.'}</div>}
        </div>
        <div className="flex h-8 shrink-0 items-center gap-4 border-t border-line px-4 text-[11px] text-fg-faint">
          <span>↑↓ navigate</span><span>↵ open</span><span>{formatShortcut('Mod+Enter')} new tab</span>
          <span className="ml-auto">{'>'} commands · # tags · @ headings</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function safeWhen(f: () => boolean): boolean { try { return f(); } catch { return false; } }
