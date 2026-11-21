import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useLiveQuery } from 'dexie-react-hooks';
import clsx from 'clsx';
import {
  Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2, Subscript, Superscript, Heading1, Heading2, Brackets,
  ArrowUpWideNarrow, ArrowDownWideNarrow, Rows3, Columns3, Trash2, TableProperties, Sigma,
} from 'lucide-react';
import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import type { PMNode } from '@/export/markdown';
import { countWords } from '@/lib/markup';
import { imageBlobToDataUrl } from '@/lib/image';
import { useStatus, toast } from '@/store/status';
import { openSearch } from '@/layout/actions';
import { promptDialog } from '@/ui/dialogs';
import { buildExtensions } from './extensions';
import { indexDoc, EMPTY_DOC } from './indexing';
import { useActiveEditor } from './activeEditor';
import { sortTable, tableAtSelection } from './tableTools';
import { collectFootnotes } from './nodes/Footnote';
import './slashItems';

export interface DocumentEditorProps {
  pageId: string;
  active: boolean;
  /** compact styling (hybrid / scratch usage) */
  compact?: boolean;
  readOnly?: boolean;
}

const SAVE_DELAY = 400;

function pushStats(editor: Editor) {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' ');
  useStatus.getState().set({ words: countWords(text), chars: text.length });
}

async function handleImageFiles(editor: Editor, files: File[], pos?: number): Promise<boolean> {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return false;
  for (const f of images) {
    try {
      const { src } = await imageBlobToDataUrl(f);
      const node = { type: 'image', attrs: { src, alt: f.name } };
      if (pos !== undefined) editor.chain().focus().insertContentAt(pos, node).run();
      else editor.chain().focus().insertContent(node).run();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not insert image', 'error'); }
  }
  return true;
}

function TB({ on, onClick, title, children, testId }: { on?: boolean; onClick: () => void; title: string; children: React.ReactNode; testId?: string }) {
  return (
    <button type="button" title={title} data-testid={testId} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={clsx('flex h-7 w-7 items-center justify-center rounded', on ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3 hover:text-fg')}>
      {children}
    </button>
  );
}

function FormatBubble({ editor }: { editor: Editor }) {
  const setLink = async () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = await promptDialog('Link URL (empty to remove)', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  const toWiki = () => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!text) return;
    editor.chain().focus().insertContentAt({ from, to }, { type: 'wikiLink', attrs: { target: text } }).run();
  };
  const toMath = () => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, ' ');
    editor.chain().focus().insertContentAt({ from, to }, { type: 'mathInline', attrs: { latex: text } }).run();
  };
  return (
    <BubbleMenu editor={editor} options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: e, from, to }) => from !== to && !e.isActive('codeBlock') && !e.isActive('image') && e.isEditable}
      className="flex items-center gap-0.5 rounded-lg border border-line bg-bg-1 p-1 shadow-2xl" data-testid="format-bubble">
      <TB title="Bold (Mod+B)" on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} testId="fmt-bold"><Bold size={14} /></TB>
      <TB title="Italic (Mod+I)" on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></TB>
      <TB title="Underline (Mod+U)" on={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={14} /></TB>
      <TB title="Strikethrough" on={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={14} /></TB>
      <TB title="Inline code (Mod+E)" on={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={14} /></TB>
      <TB title="Highlight" on={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter size={14} /></TB>
      <TB title="Subscript" on={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}><Subscript size={14} /></TB>
      <TB title="Superscript" on={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}><Superscript size={14} /></TB>
      <div className="mx-0.5 h-5 w-px bg-line" />
      <TB title="Heading 1" on={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={14} /></TB>
      <TB title="Heading 2" on={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={14} /></TB>
      <div className="mx-0.5 h-5 w-px bg-line" />
      <TB title="Link" on={editor.isActive('link')} onClick={() => void setLink()}><Link2 size={14} /></TB>
      <TB title="Turn into [[wiki-link]]" onClick={toWiki} testId="fmt-wiki"><Brackets size={14} /></TB>
      <TB title="Turn into inline math" onClick={toMath}><Sigma size={14} /></TB>
    </BubbleMenu>
  );
}

function TableBar({ editor }: { editor: Editor }) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); editor.on('selectionUpdate', f); editor.on('update', f); return () => { editor.off('selectionUpdate', f); editor.off('update', f); }; }, [editor]);
  if (!editor.isEditable || !tableAtSelection(editor)) return null;
  const c = () => editor.chain().focus();
  return (
    <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-bg-1/95 p-1 shadow backdrop-blur" data-testid="table-bar">
      <span className="px-1.5 text-[11px] text-fg-faint"><TableProperties size={12} className="mr-1 inline" />Table</span>
      <TB title="Sort column ascending" onClick={() => sortTable(editor, 'asc')} testId="table-sort-asc"><ArrowUpWideNarrow size={14} /></TB>
      <TB title="Sort column descending" onClick={() => sortTable(editor, 'desc')}><ArrowDownWideNarrow size={14} /></TB>
      <div className="mx-0.5 h-5 w-px bg-line" />
      <button className="rounded px-1.5 py-1 text-[11px] hover:bg-bg-3" onMouseDown={(e) => e.preventDefault()} onClick={() => c().addRowBefore().run()}>+ Row above</button>
      <button className="rounded px-1.5 py-1 text-[11px] hover:bg-bg-3" onMouseDown={(e) => e.preventDefault()} onClick={() => c().addRowAfter().run()}>+ Row below</button>
      <button className="rounded px-1.5 py-1 text-[11px] hover:bg-bg-3" onMouseDown={(e) => e.preventDefault()} onClick={() => c().addColumnBefore().run()}>+ Col left</button>
      <button className="rounded px-1.5 py-1 text-[11px] hover:bg-bg-3" onMouseDown={(e) => e.preventDefault()} onClick={() => c().addColumnAfter().run()}>+ Col right</button>
      <div className="mx-0.5 h-5 w-px bg-line" />
      <TB title="Delete row" onClick={() => c().deleteRow().run()}><Rows3 size={14} /></TB>
      <TB title="Delete column" onClick={() => c().deleteColumn().run()}><Columns3 size={14} /></TB>
      <button className="rounded px-1.5 py-1 text-[11px] hover:bg-bg-3" onMouseDown={(e) => e.preventDefault()} onClick={() => c().toggleHeaderRow().run()}>Header row</button>
      <button className="rounded px-1.5 py-1 text-[11px] hover:bg-bg-3" onMouseDown={(e) => e.preventDefault()} onClick={() => c().mergeOrSplit().run()}>Merge/split</button>
      <TB title="Delete table" onClick={() => c().deleteTable().run()}><Trash2 size={14} /></TB>
    </div>
  );
}

function Footnotes({ editor }: { editor: Editor }) {
  const [notes, setNotes] = useState(() => collectFootnotes(editor.state.doc));
  useEffect(() => { const f = () => setNotes(collectFootnotes(editor.state.doc)); editor.on('update', f); return () => { editor.off('update', f); }; }, [editor]);
  if (!notes.length) return null;
  return (
    <section className="iln-footnotes" data-testid="footnotes">
      <div className="iln-footnotes-title">Footnotes</div>
      <ol>
        {notes.map((n) => (
          <li key={n.id}>
            <button className="text-accent" onClick={() => { editor.view.nodeDOM(n.pos) instanceof HTMLElement && (editor.view.nodeDOM(n.pos) as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' }); }}>↑</button>{' '}
            {n.note || <em className="text-fg-faint">empty footnote — click its marker to edit</em>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The block-based rich text editor bound to a page's document in IndexedDB. */
export function DocumentEditor({ pageId, active, compact, readOnly }: DocumentEditorProps) {
  const initial = useLiveQuery(async () => (await db.docs.get(pageId)) ?? null, [pageId]);
  if (initial === undefined) return <div className="p-8 text-fg-faint">Loading…</div>;
  return <LoadedEditor key={pageId} pageId={pageId} active={active} compact={compact} readOnly={readOnly} initialContent={(initial?.content as PMNode | undefined) ?? EMPTY_DOC} initialUpdatedAt={initial?.updatedAt ?? 0} />;
}

function LoadedEditor({ pageId, active, compact, readOnly, initialContent, initialUpdatedAt }: DocumentEditorProps & { initialContent: PMNode; initialUpdatedAt: number }) {
  const saveTimer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const lastSaved = useRef(initialUpdatedAt);
  const editorRef = useRef<Editor | null>(null);

  const extensions = useMemo(() => buildExtensions({ onTagClick: (tag) => openSearch({ tags: tag }, `#${tag}`) }), []);

  const flush = async () => {
    window.clearTimeout(saveTimer.current);
    const ed = editorRef.current;
    if (!dirty.current || !ed || ed.isDestroyed) return;
    dirty.current = false;
    const json = ed.getJSON() as PMNode;
    const idx = indexDoc(json);
    await repo.saveDoc({ pageId, content: json, ...idx });
    lastSaved.current = (await db.docs.get(pageId))?.updatedAt ?? Date.now();
  };

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: clsx('iln-prose', compact && 'compact'), 'data-testid': 'doc-editor', spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.some((f) => f.type.startsWith('image/')) && editorRef.current) { void handleImageFiles(editorRef.current, files); return true; }
        return false;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.some((f) => f.type.startsWith('image/')) || !editorRef.current) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void handleImageFiles(editorRef.current, files, pos);
        return true;
      },
    },
    onCreate: ({ editor: e }) => { editorRef.current = e as Editor; },
    onUpdate: ({ editor: e }) => {
      dirty.current = true;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
      pushStats(e as Editor);
    },
    onFocus: ({ editor: e }) => { useActiveEditor.getState().set(e as Editor, pageId); pushStats(e as Editor); },
    onBlur: () => { void flush(); },
  }, [pageId]);

  useEffect(() => { editorRef.current = editor; }, [editor]);

  // Become the active editor when our tab is active; push word counts.
  useEffect(() => {
    if (!active || !editor) return;
    useActiveEditor.getState().set(editor, pageId);
    pushStats(editor);
    return () => { if (useActiveEditor.getState().editor === editor) useActiveEditor.getState().set(null, null); };
  }, [active, editor, pageId]);

  // External changes (other pane, import, version restore) → reload when we are not mid-edit.
  const live = useLiveQuery(() => db.docs.get(pageId), [pageId]);
  useEffect(() => {
    if (!editor || !live || live.updatedAt <= lastSaved.current) return;
    if (dirty.current || editor.isFocused) return;
    lastSaved.current = live.updatedAt;
    editor.commands.setContent(live.content as PMNode, { emitUpdate: false });
  }, [live, editor]);

  // Flush on unmount and before the window closes.
  useEffect(() => {
    const onUnload = () => { void flush(); };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); void flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!editor) return null;
  return (
    <div className={clsx('iln-doc', compact && 'compact')}>
      <TableBar editor={editor} />
      <FormatBubble editor={editor} />
      <EditorContent editor={editor} />
      <Footnotes editor={editor} />
    </div>
  );
}
