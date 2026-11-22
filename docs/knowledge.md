# Knowledge tools

These views build on what you write: links, tags, page status, dates and flashcard lines. Most of them are opened from the [command palette](getting-started.md#command-palette) (`Mod+K`) by name.

| View | Command | Shortcut |
| --- | --- | --- |
| Knowledge graph | Open Knowledge Graph | `Mod+Shift+G` |
| Kanban board | Open Kanban Board | none |
| Calendar | Open Calendar | none |
| Flashcards | Open Flashcards | none |
| Template library | Open Template Library | none |
| Daily note | Open Daily Note | `Mod+Shift+D` |
| Version checkpoint | Create Version Checkpoint | `Mod+Alt+S` |
| Time-lapse | Replay Drawing as Time-lapse | none |

Each view opens as a tab.

## Knowledge graph

A force-directed graph of the pages in your workspace. Pages are nodes; links are edges. Edges come from `[[wiki-links]]`, `![[embeds]]` and optionally shared tags.

- Click a node to open the page (Ctrl/Cmd+click for a new tab). Click a tag node to open a search for that tag.
- Zoom and pan the graph, and use the fit button to frame everything.
- The settings button opens controls:
  - **Highlight** field: type a page name or `#tag` to dim everything else.
  - **Orphans**: show, hide, or show only pages with no links.
  - **Color by** notebook or first tag, with a legend.
  - **Link pages sharing tags** and **Show tag nodes**.
  - Force sliders: repulsion, link distance, gravity and collision.

The graph reads the same link data as the Backlinks panel in a page's right dock.

## Kanban

A board of columns whose cards are **pages**. Choose a scope in the Board selector: a notebook, a folder, or a tag. The default columns are Backlog, To do, Doing and Done.

- Drag cards between columns or reorder them within a column. A card's column is stored as its page status.
- **Add card** creates a new page in that column; click a card to open the page.
- **Column** adds a column. Double-click a column title to rename it, and use the arrows to move it or the trash button to delete it.
- Column setups are remembered per scope.

The Kanban Board [template](#templates) creates a folder of pages and opens a board scoped to it.

## Calendar and daily notes

The calendar shows pages by date, in **Month** or **Week** view, with Previous, Next and Today buttons. Three checkboxes control what appears: **Daily notes**, **Created** and **Edited**, each with a colored dot.

- Click a day (or press Enter on it) to open that day's daily note. If it does not exist yet, it is created.
- **Today's note** opens today's daily note.
- Click an entry in a day to open that page (Ctrl/Cmd+click for a new tab).

**Daily notes** are ordinary pages titled with the date (`YYYY-MM-DD`) and a calendar icon, created in the current notebook the first time you open them. `Mod+Shift+D` opens today's.

## Flashcards

Cards are collected from your notes automatically; there is nothing to import. Write them with the [flashcard syntax](notes-editor.md#flashcards) (`Q :: A`, `Q ::: A` for reversed, and `{{c1::cloze}}`).

- Choose a **deck**: all cards, one notebook, or one tag.
- **Review** mode shows each due or new card. Reveal the answer with `Space` or `Enter`, then grade it: **Again** (`1`), **Hard** (`2`), **Good** (`3`) or **Easy** (`4`). `Esc` ends the session. The grade buttons show the next interval.
- **Browse** mode lists every card in the deck.
- Stats show Due now, New, Learned and Retention.
- Scheduling follows an SM-2 style algorithm: "Again" brings a card back in 10 minutes, and other grades lengthen the interval based on the card's ease.

Review progress is saved in your workspace and included in backups. Editing a card's text creates a new card; cards are identified by their content.

## Templates

The **Template library** creates ready-made pages in the current notebook and opens them:

| Template | Kind |
| --- | --- |
| Cornell Notes | Document |
| Kanban Board | Board (a folder of pages plus a board view) |
| Storyboard | Canvas |
| Mind Map | Canvas |
| Pixel / Sprite Sheet Grid | Canvas |
| Architecture Diagram | Canvas |
| Weekly Planner | Document |
| Meeting Notes | Document |

## Version history

Open the **Version history** panel in the right dock while a page is open.

- **Checkpoint** (`Mod+Alt+S`) saves a named snapshot of the page: its document, canvas objects and ink strokes.
- **Automatic snapshots** are taken while you work: at most one every 5 minutes of activity, and only after about 15 seconds without edits. At most 50 automatic snapshots are kept per page and older ones are pruned. Snapshots you name or rename are never pruned.
- Select a snapshot to see its details. Document pages show a line-by-line diff against the current text.
- **Restore** brings the page back to that snapshot. Before restoring, ILOVENOTES takes a "Before restore" snapshot so you can undo the restore.
- Snapshots can be renamed and deleted.

Snapshots are stored in your local database and are included in workspace backups.

## Time-lapse

"Replay Drawing as Time-lapse" replays the **ink strokes** of the current page stroke by stroke (the Version history panel also has a Time-lapse button on canvas, PDF and hybrid pages). It applies to the pen strokes on canvas pages, not to raster paint layers.

- Controls: Play / Pause, Restart, a scrubber, and a speed selector (1x, 2x, 5x, 10x).
- Idle gaps between strokes are compressed so the replay stays short.
- Export as **GIF** or **WebM**. WebM needs `MediaRecorder` and canvas `captureStream` support in the browser or runtime.

If the page has no ink strokes you get a notice instead.
