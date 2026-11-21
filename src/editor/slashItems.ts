import type { Editor, Range } from '@tiptap/core';
import { registerSlashItem } from './slash';
import { openFile } from '@/platform/fileio';
import { imageBlobToDataUrl } from '@/lib/image';
import { todayString } from '@/layout/actions';
import { toast } from '@/store/status';

const chainAt = (e: Editor, r: Range) => e.chain().focus().deleteRange(r);

async function insertImage(editor: Editor, range: Range) {
  chainAt(editor, range).run();
  const f = await openFile({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }] });
  if (!f) return;
  try {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? 'png';
    const type = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const { src } = await imageBlobToDataUrl(new Blob([f.data as BlobPart], { type }));
    editor.chain().focus().setImage({ src, alt: f.name }).run();
  } catch (e) { toast(e instanceof Error ? e.message : 'Could not insert image', 'error'); }
}

const items: Parameters<typeof registerSlashItem>[0][] = [
  { id: 'text', title: 'Text', subtitle: 'Plain paragraph', icon: '¶', group: 'Basic', keywords: ['paragraph'], run: (e, r) => { chainAt(e, r).setParagraph().run(); } },
  { id: 'h1', title: 'Heading 1', subtitle: 'Big section heading', icon: 'H1', group: 'Basic', keywords: ['title', '#'], run: (e, r) => { chainAt(e, r).setHeading({ level: 1 }).run(); } },
  { id: 'h2', title: 'Heading 2', subtitle: 'Medium heading', icon: 'H2', group: 'Basic', keywords: ['subtitle', '##'], run: (e, r) => { chainAt(e, r).setHeading({ level: 2 }).run(); } },
  { id: 'h3', title: 'Heading 3', subtitle: 'Small heading', icon: 'H3', group: 'Basic', keywords: ['###'], run: (e, r) => { chainAt(e, r).setHeading({ level: 3 }).run(); } },
  { id: 'bullet', title: 'Bulleted list', icon: '•', group: 'Basic', keywords: ['ul', 'unordered'], run: (e, r) => { chainAt(e, r).toggleBulletList().run(); } },
  { id: 'numbered', title: 'Numbered list', icon: '1.', group: 'Basic', keywords: ['ol', 'ordered'], run: (e, r) => { chainAt(e, r).toggleOrderedList().run(); } },
  { id: 'todo', title: 'Checklist', subtitle: 'Track tasks', icon: '☑', group: 'Basic', keywords: ['todo', 'task', 'checkbox'], run: (e, r) => { chainAt(e, r).toggleTaskList().run(); } },
  { id: 'toggle', title: 'Toggle', subtitle: 'Collapsible section', icon: '▸', group: 'Basic', keywords: ['collapse', 'details', 'accordion'], run: (e, r) => { chainAt(e, r).insertToggle().run(); } },
  { id: 'quote', title: 'Quote', icon: '❝', group: 'Basic', keywords: ['blockquote'], run: (e, r) => { chainAt(e, r).toggleBlockquote().run(); } },
  { id: 'divider', title: 'Divider', icon: '—', group: 'Basic', keywords: ['hr', 'rule', 'line'], run: (e, r) => { chainAt(e, r).setHorizontalRule().run(); } },
  { id: 'callout-note', title: 'Callout', subtitle: 'Highlighted note box', icon: '📝', group: 'Callouts', keywords: ['note', 'admonition'], run: (e, r) => { chainAt(e, r).setCallout('note').run(); } },
  { id: 'callout-tip', title: 'Tip callout', icon: '💡', group: 'Callouts', keywords: ['hint'], run: (e, r) => { chainAt(e, r).setCallout('tip').run(); } },
  { id: 'callout-warning', title: 'Warning callout', icon: '⚠️', group: 'Callouts', keywords: ['caution'], run: (e, r) => { chainAt(e, r).setCallout('warning').run(); } },
  { id: 'callout-danger', title: 'Danger callout', icon: '🛑', group: 'Callouts', keywords: ['error'], run: (e, r) => { chainAt(e, r).setCallout('danger').run(); } },
  { id: 'code', title: 'Code block', subtitle: 'Syntax highlighting, runnable JS/Python', icon: '</>', group: 'Advanced', keywords: ['snippet', 'pre'], run: (e, r) => { chainAt(e, r).setCodeBlock({ language: 'javascript' }).run(); } },
  { id: 'python', title: 'Python cell', subtitle: 'Runnable Python (Pyodide)', icon: 'py', group: 'Advanced', keywords: ['py', 'notebook'], run: (e, r) => { chainAt(e, r).setCodeBlock({ language: 'python' }).run(); } },
  { id: 'math', title: 'Math equation', subtitle: 'KaTeX display block', icon: '∑', group: 'Advanced', keywords: ['latex', 'katex', 'formula', '$$'], run: (e, r) => { chainAt(e, r).insertMathBlock('').run(); } },
  { id: 'math-inline', title: 'Inline math', subtitle: 'KaTeX inline', icon: '𝑥', group: 'Advanced', keywords: ['latex', '$'], run: (e, r) => { chainAt(e, r).insertMathInline('').run(); } },
  { id: 'table', title: 'Table', subtitle: 'Sortable 3×3 table', icon: '▦', group: 'Advanced', keywords: ['grid'], run: (e, r) => { chainAt(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
  { id: 'image', title: 'Image', subtitle: 'Upload from disk', icon: '🖼', group: 'Media', keywords: ['picture', 'photo'], run: (e, r) => insertImage(e, r) },
  { id: 'link-page', title: 'Link to page', subtitle: 'Insert [[wiki-link]]', icon: '[[', group: 'Knowledge', keywords: ['wiki', 'reference'], run: (e, r) => { chainAt(e, r).insertContent('[[').run(); } },
  { id: 'embed-page', title: 'Embed page', subtitle: 'Transclude ![[page]]', icon: '⧉', group: 'Knowledge', keywords: ['transclusion', 'embed'], run: (e, r) => { chainAt(e, r).insertContent('![[').run(); } },
  { id: 'toc', title: 'Table of contents', subtitle: 'Live outline of headings', icon: '☰', group: 'Knowledge', keywords: ['outline', 'toc'], run: (e, r) => { chainAt(e, r).insertContent({ type: 'tableOfContents' }).run(); } },
  { id: 'footnote', title: 'Footnote', icon: '¹', group: 'Knowledge', keywords: ['reference', 'citation'], run: (e, r) => { chainAt(e, r).insertFootnote('').run(); } },
  { id: 'flashcard', title: 'Flashcard', subtitle: 'Question :: Answer', icon: '🃏', group: 'Study', keywords: ['srs', 'anki', 'card'], run: (e, r) => { chainAt(e, r).insertContent('Question :: Answer').run(); } },
  { id: 'cloze', title: 'Cloze deletion', subtitle: '{{c1::hidden}} text', icon: '⬚', group: 'Study', keywords: ['srs', 'anki'], run: (e, r) => { chainAt(e, r).insertContent('{{c1::answer}}').run(); } },
  { id: 'date', title: 'Today’s date', icon: '📅', group: 'Insert', keywords: ['now', 'today'], run: (e, r) => { chainAt(e, r).insertContent(todayString()).run(); } },
  { id: 'time', title: 'Current time', icon: '🕒', group: 'Insert', keywords: ['now', 'clock'], run: (e, r) => { chainAt(e, r).insertContent(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })).run(); } },
];
items.forEach(registerSlashItem);
