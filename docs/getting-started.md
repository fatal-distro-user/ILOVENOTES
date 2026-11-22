# Getting started

## First launch

On first run ILOVENOTES creates a workspace called **My Workspace** containing a notebook named **Personal** and a page called "Welcome to ILOVENOTES". The start screen offers **New page**, **New canvas page**, **Open Daily Note** and a list of recent pages.

## How content is organized

```
Workspace
  Notebook
    Folder / Section / Page
      Sub-pages
```

- **Workspace**: the top-level container. You can have several; switch, create, rename and delete them from the explorer header. The only workspace cannot be deleted. Workspaces are also the unit of [backup and import](import-export.md#workspace-backup).
- **Notebook**: a collection inside a workspace, with its own icon and color. Create one from the Notebooks section of the explorer.
- **Folder, section, page**: nodes in the notebook tree. Folders and sections group things; pages hold content. A page may itself have sub-pages.

### The explorer

The left sidebar (`Mod+\` toggles it) has these sections: Notebooks, Starred, Recent, Tags and Saved Searches. Right-click a page or notebook for its context menu:

- Page: New Page inside, New Sub-folder, New Section, Rename (`F2`), Change icon, Change color, Star, Duplicate, Open in new tab, Open to side, Move to trash.
- Notebook: New Page, New Folder, New Section, Rename (`F2`), Change icon, Change color, Move to trash.

Pages can be reordered and moved by drag and drop. Deleted items go to the **Trash** (command palette: "Open Trash"), where you can restore them or delete them forever.

The **Search** view (command palette: "Open Search") searches titles and page text, and you can save a search so it appears under Saved Searches. For quick jumping, use the [command palette](#command-palette).

## Page modes

Every page has a mode, chosen with the mode switch in the page header. You can change it at any time; the content for each mode is stored separately, so switching does not delete anything.

| Mode | What you get |
| --- | --- |
| Document | The block editor. See [Notes editor](notes-editor.md) |
| Canvas | An infinite canvas for ink, shapes, sticky notes and more. See [Canvas](canvas.md) |
| PDF | A PDF viewer with annotations. See [PDF](pdf.md) |
| Hybrid | Document and canvas side by side on the same page, with a draggable divider |

Paintings are canvas pages that hold a paint frame, and they open in the [paint studio](paint-studio.md) in their own tab kind.

Each page also has an icon, an optional cover image, tags and a star. The header has an Export button (`Mod+Shift+E`).

## Tabs and panes

- Opening a page from the explorer normally **replaces the active tab** unless that tab is pinned. Use "Open in new tab" in the context menu, or Ctrl/Cmd+click on links and results, to open a new tab instead.
- Tabs can be pinned and dragged between panes.
- `Mod+W` closes a tab. `Ctrl+Tab` / `Ctrl+Shift+Tab` (or `Mod+Alt+Right` / `Mod+Alt+Left`) cycle tabs.

Besides pages, tabs can show app views: Graph, Kanban, Calendar, Flashcards, Templates, Trash, Settings and Search.

## Split view

Split the workspace into two panes to look at two things at once:

| Action | Shortcut |
| --- | --- |
| Split pane right | `Mod+Alt+V` |
| Split pane down | `Mod+Alt+H` |
| Merge split panes | `Mod+Alt+U` |

"Open to side" in the explorer context menu opens a page in the other pane, creating a split if needed. Tab layout is remembered between sessions.

## Docks, Zen mode and the scratchpad

- The right dock holds panels such as Outline, Backlinks, Annotations, Page Info, History and Version history (plus Layers, Brushes and Color when a painting is open). `Mod+Alt+\` toggles the dock. Use the Panels menu button in the explorer header to show or hide panels, and a panel's menu to move it to the other dock or hide it.
- **Zen / focus mode** (`Mod+Shift+F`) hides the surrounding chrome. `F11` toggles Zen and fullscreen together.
- The **scratchpad** (`Mod+Shift+Space`) is a quick-notes overlay. You can copy it, clear it, or send it to a new page.
- **Settings** (`Mod+,`) lets you pick a theme (Dark Studio, Light Paper, Midnight OLED, Sepia, High Contrast), an accent color, the UI scale and custom CSS, reset the layout, and view storage usage and request persistent storage.

## Command palette

Press `Mod+K`. Start typing to search pages by title and text. Prefixes narrow the search:

| Prefix | Searches |
| --- | --- |
| `>` | Commands (every registered action, including those with no shortcut) |
| `#` | Tags |
| `@` | Headings |

Many features have no dedicated shortcut and are reached from the palette: kanban, calendar, flashcards, template library, time-lapse, filters, snap to grid, import PDF onto canvas, and so on.

## Where next

- Write notes: [Notes editor](notes-editor.md)
- Draw and diagram: [Canvas](canvas.md)
- Link and review: [Knowledge tools](knowledge.md)
