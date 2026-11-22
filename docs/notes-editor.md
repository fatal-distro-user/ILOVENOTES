# Notes editor

Document pages use a block editor built on TipTap. This page covers what you can insert and the inline syntax it understands. For the list of shortcuts, see the [project README](../README.md#keyboard-shortcuts).

## Slash menu

Type `/` at the start of a line or after a space to open the menu, then keep typing to filter (for example `/heading 2`). Items are grouped:

| Group | Items |
| --- | --- |
| Basic | Text, Heading 1-3, Bulleted list, Numbered list, Checklist, Toggle, Quote, Divider |
| Callouts | Callout, Tip, Warning, Danger |
| Advanced | Code block, Python cell, Math equation, Inline math, Table |
| Media | Image, Sketch / paint frame |
| Knowledge | Link to page, Embed page, Table of contents, Footnote |
| Study | Flashcard, Cloze deletion |
| Insert | Today's date, Current time |

The slash menu does not open inside code blocks. Every block type is also available from the command palette as a "Document: ..." command (checklist, code block, math block, table, table of contents, callout, footnote).

A formatting toolbar appears with common formatting: bold, italic, underline, strikethrough, inline code, highlight, subscript, superscript, headings, link, "turn into wiki-link" and "turn into inline math".

## Text blocks, lists, tables

- Headings go up to level 4 in the editor (the slash menu offers 1-3). Typography replacements such as smart quotes are on.
- **Checklist** creates task lists, which can be nested.
- **Toggle** is a collapsible section with a title line.
- **Callouts** come in Note, Tip, Warning and Danger flavors.
- **Table** inserts a 3 by 3 table with a header row. Tables are resizable, and a table toolbar appears while the cursor is in one.
- **Table of contents** is a live outline built from the page's headings.
- **Image** lets you pick a file from disk (PNG, JPG, GIF, WebP or SVG). The image is embedded in the page.

## Math

- **Math equation** inserts a display (block) KaTeX equation. Typing `$$` followed by a space at the start of a line also creates one.
- **Inline math**: type `$x^2$`; as soon as you type the closing `$` it converts into an inline equation. You can also select text and use "Turn into inline math" in the toolbar.

Typography substitutions that would break LaTeX (superscript digits, fractions) are disabled.

## Code blocks and runnable cells

**Code block** gives syntax highlighting with a language picker and a Copy button. Blocks whose language is `javascript` (or `js`) or `python` (or `py`) have a **Run** button (`Mod+Enter` while in the block).

- **JavaScript** runs in a throwaway Web Worker with a 5 second timeout. It has no DOM, no network access (`fetch`, `XMLHttpRequest`, `WebSocket` are removed) and cannot read app data. `console.log` output and the final value appear below the block.
- **Python** uses Pyodide (CPython compiled to WebAssembly) in a persistent worker. **The first run downloads Pyodide (about 10 MB) from the jsDelivr CDN**, so it needs a network connection once. The service worker caches it afterwards, so later runs work offline.

The **Python cell** slash item inserts a code block already set to Python.

## Wiki-links and embeds

- Type `[[` to open page completion. Pick a page, or choose "Create ..." to make a new page from what you typed. Typing a complete `[[Page]]` converts it into a link too.
- Syntax: `[[Page]]`, `[[Page|alias]]` (custom label) and `[[Page#Heading]]`. Targets are matched by page title, case-insensitively, within the current workspace.
- A link to a page that does not exist is shown as unresolved, and clicking it creates the page.
- `![[Page]]` **embeds** (transcludes) another page's text inline, with a header you can click to open the source.

Links feed the **Backlinks** panel, the [knowledge graph](knowledge.md#knowledge-graph) and the **Outline** panel.

## Tags

Write `#tag` anywhere in the text (after whitespace or at the start of a line). Tags may contain letters, digits, `-`, `_` and `/` for nesting, must contain at least one non-digit character, and are lowercased. Tags are highlighted in the text; Ctrl/Cmd+click one to open a search for that tag. Tags also appear in the explorer's Tags section and in the graph, kanban and flashcard scopes.

## Footnotes

**Footnote** inserts a numbered marker; click it to edit the note text. Numbers follow document order. In exported Markdown they appear as `[^id]` references.

## Flashcards

Cards are written directly in notes, one per line (list markers are ignored):

| Syntax | Card |
| --- | --- |
| `Question :: Answer` | Basic card |
| `Question ::: Answer` | Reversed card (two cards, one each direction) |
| `Text with {{c1::hidden}} words` | Cloze card, one per cloze number |
| `{{c1::answer::hint}}` | Cloze with a hint shown in place of the blank |

Lines that look like flashcards get a subtle highlight. The slash menu items "Flashcard" and "Cloze deletion" insert the templates. Review them in the [Flashcards view](knowledge.md#flashcards).

## Sketch frames

**Sketch / paint frame** embeds a small paint document in the page. Paint directly in the frame with a brush and eraser, undo and redo, pan, or open it in the full [paint studio](paint-studio.md).

## Undo

The editor has its own undo history (up to 300 steps). `Mod+Z` and `Mod+Shift+Z` act on whichever surface you used last, see [Development](development.md#undo-scopes).
