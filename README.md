# ILOVENOTES

ILOVENOTES is a local-first hybrid app that combines structured notes, an infinite canvas, PDF annotation, a layered paint studio and a 2D flipbook animator in a single workspace. Everything lives in your browser's IndexedDB (or the same storage inside the Electron desktop shell), so there is no account and no server. It runs as an installable PWA and as a desktop app for Linux, Windows and macOS.

Stack: React 19, TypeScript (strict), Vite, Tailwind v4, Zustand + immer, Dexie (IndexedDB), TipTap v3, `vite-plugin-pwa`, and Electron with electron-builder.

## Documentation

User and developer documentation lives in [`docs/`](docs/README.md): installation, getting started, the notes editor, canvas, PDF, paint studio, animation, knowledge tools, import and export, development and an FAQ.

## Feature matrix

| Area | Feature | Notes |
| --- | --- | --- |
| Workspace | Workspace / notebook / page hierarchy | Dexie IndexedDB schema; explorer tree with rename (`F2`), trash view, search view |
| Layout | Dockable panels, multi-tab bar, split view | Split right/down, merge; tabs can be pinned |
| Layout | Scratchpad, Zen / focus mode | Zen can also toggle fullscreen |
| Layout | Themes | Dark Studio, Light Paper, Midnight OLED, Sepia, High Contrast; `--iln-*` CSS variables can be overridden in Settings |
| Editor | Block rich-text editor (TipTap) | Slash menu, tables, task lists, toggles, callouts, footnotes, table of contents |
| Editor | KaTeX math | Block and inline equations |
| Editor | Code blocks with syntax highlighting | Runnable JavaScript and Python (Pyodide) cells |
| Editor | Wiki-links and embeds | `[[page]]` links, `![[page]]` transclusion |
| Editor | Inline sketch frames | Paint frame embedded in a page (1600 x 700 document, 320 px tall frame) |
| Editor | Flashcard syntax | `Question :: Answer` and `{{c1::cloze}}` |
| Canvas | Infinite pan/zoom canvas | Grids, minimap, snap-to-grid toggle, object transforms |
| Canvas | Tools | Select, hand, pen, highlighter, stroke eraser, text, rectangle, ellipse, diamond, triangle, line, arrow, frame, laser pointer |
| Canvas | Sticky notes, mind-map nodes, connectors | Mind-map nodes: `Tab` adds a child, `Enter` adds a sibling |
| Canvas | Paint frames | Paint a raster frame directly on the canvas |
| Canvas | Audio notes | Record audio notes and place them on the canvas; audio-synced ink |
| Canvas | Ink to text (OCR) and ink to diagram | tesseract.js (English) for text; shape-to-diagram is heuristic |
| Canvas | QuickShape | Auto-snap of drawn strokes to shapes, with editable handles |
| PDF | Multi-page PDF viewer | pdf.js; import PDF pages onto a canvas |
| PDF | Annotations | Highlighter, ink pen, sticky note, select; annotations panel |
| PDF | Annotated PDF export | Annotations flattened into the PDF with pdf-lib |
| Paint | Layers | Raster/vector layers, 16 blend modes, opacity, alpha lock, clipping masks, layer masks, groups, merge down, duplicate, flatten |
| Paint | Brush engine | Pressure, velocity, tilt, spacing, jitter, grain, bristles, wetness; StreamLine stabilizer; presets and Brush Studio panel |
| Paint | Retouch tools | Smudge, blur, sharpen, clone stamp, healing brush |
| Paint | Selection | Lasso, polygonal lasso, magic wand, select all / invert / feather, copy / cut / paste as new layer, free transform / distort / warp |
| Paint | Fill | Flood fill (paint bucket) and gradient fill, fill selection |
| Paint | Guides | Symmetry, perspective guides, ruler |
| Paint | Color | HSV color wheel, eyedropper, custom palettes (import/export `.gpl`, `.hex`), palette extraction from images, harmonies |
| Paint | Filters | HSL, brightness/contrast, curves, levels, color balance, Gaussian blur, motion blur, pixelate, sharpen, halftone, chromatic aberration, noise, threshold, invert (run in a worker) |
| Animation | 2D flipbook timeline | Frames, onion skinning, playback, previous/next frame |
| Knowledge | Command palette | `Mod+K` quick open and command search |
| Knowledge | Knowledge graph | Force-directed graph of links and backlinks (d3-force) |
| Knowledge | Kanban board, calendar, daily notes | Calendar view and a daily note command |
| Knowledge | Flashcards | Spaced-repetition review of flashcards and cloze cards found in notes |
| Knowledge | Template library | New pages from templates |
| History | Undo/redo | Command-pattern engine with undo scopes and a History panel |
| History | Version history | Manual checkpoints and a Version history panel |
| History | Time-lapse | Replay drawing as a time-lapse; export GIF or WebM |
| Export | Page / canvas | Markdown (`.md`), SVG, PNG (2x), annotated PDF, notebook as Markdown ZIP |
| Export | Paint | Flattened PNG, OpenRaster (`.ora`), Photoshop (`.psd`), layer PNGs (`.zip`) |
| Export | Workspace | `.ilovenotes`, `.zip` or `.json` backup; import creates a new workspace |
| Platform | PWA and desktop | Installable PWA; Electron shell for Linux, Windows, macOS |

### Editor slash menu

Type `/` in a page to open the menu. Items by group:

| Group | Items |
| --- | --- |
| Basic | Text, Heading 1-3, Bulleted list, Numbered list, Checklist, Toggle, Quote, Divider |
| Callouts | Callout, Tip, Warning, Danger |
| Advanced | Code block, Python cell, Math equation, Inline math, Table |
| Media | Image, Sketch / paint frame |
| Knowledge | Link to page, Embed page, Table of contents, Footnote |
| Study | Flashcard, Cloze deletion |
| Insert | Today's date, Current time |

## Keyboard shortcuts

`Mod` is Ctrl on Windows and Linux, and Cmd on macOS. All shortcuts below come from the command registry and tool definitions in the source. Paint shortcuts apply only while a painting tab is active.

### General

| Shortcut | Action |
| --- | --- |
| `Mod+K` | Open command palette |
| `Mod+,` | Open Settings |
| `Mod+\` | Toggle explorer sidebar |
| `Mod+Alt+\` | Toggle right dock |
| `Mod+Shift+F` | Toggle Zen / focus mode |
| `F11` | Toggle Zen mode and fullscreen |
| `Mod+Shift+Space` | Toggle scratchpad |
| `Mod+Alt+V` | Split pane right |
| `Mod+Alt+H` | Split pane down |
| `Mod+Alt+U` | Merge split panes |
| `Mod+W` | Close tab |
| `Ctrl+Tab` or `Mod+Alt+Right` | Next tab |
| `Ctrl+Shift+Tab` or `Mod+Alt+Left` | Previous tab |
| `Mod+Z` | Undo |
| `Mod+Shift+Z` or `Mod+Y` | Redo |
| `F2` | Rename (explorer item context menu) |

### File

| Shortcut | Action |
| --- | --- |
| `Mod+N` | New page |
| `Mod+Shift+N` | New canvas page (outside a painting; inside a painting it adds a layer) |
| `Mod+Shift+D` | Open daily note |
| `Mod+Alt+N` | New painting |
| `Mod+Shift+E` | Export dialog |
| `Mod+Shift+O` | Import workspace |

### Editor

The editor has no dedicated command shortcuts beyond the general ones; use the `/` slash menu or the command palette ("Document: ..." commands such as heading, checklist, code block, math, table, table of contents, callout, footnote). Standard TipTap formatting shortcuts are provided by its extensions and are not listed here.

### Canvas

Single-key tool shortcuts, active on a canvas page:

| Key | Tool |
| --- | --- |
| `V` | Select |
| `H` | Hand (pan) |
| `P` | Pen |
| `M` | Highlighter |
| `E` | Stroke eraser |
| `T` | Text |
| `R` | Rectangle |
| `O` | Ellipse |
| `D` | Diamond |
| `L` | Line |
| `A` | Arrow |
| `F` | Frame |
| `K` | Laser pointer |
| `N` | Sticky note |
| `C` | Connector |
| `B` | Paint frame |

Triangle, mind-map node and audio note tools have no key. On a selected mind-map node, `Tab` adds a child and `Enter` adds a sibling. In a sticky-note editor, `Esc` or `Mod+Enter` finishes editing.

### Paint

| Shortcut | Action |
| --- | --- |
| `B` | Brush |
| `E` | Eraser |
| `U` | Smudge |
| `C` | Clone stamp |
| `J` | Healing brush |
| `I` | Eyedropper |
| `G` | Paint bucket (flood fill) |
| `L` | Lasso |
| `W` | Magic wand |
| `V` | Move layer |
| `T` | Free transform |
| `H` | Hand (pan) |
| `Mod+Shift+N` | New layer |
| `Mod+E` | Merge layer down |
| `Mod+J` | Duplicate layer |
| `Mod+A` | Select all |
| `Mod+D` | Deselect |
| `Mod+Shift+I` | Invert selection |
| `Mod+Alt+F` | Feather selection |
| `Mod+C` / `Mod+Shift+C` | Copy / copy merged |
| `Mod+X` | Cut |
| `Mod+V` | Paste as new layer |
| `Delete` or `Backspace` | Clear selection pixels |
| `Alt+Backspace` | Fill selection with colour |
| `,` / `.` | Previous / next animation frame (animation enabled) |
| `Alt+Space` | Play / pause animation (animation enabled) |

Blur, sharpen, polygonal lasso and the guides tool have no key.

### Knowledge (PKM) and audio

| Shortcut | Action |
| --- | --- |
| `Mod+Shift+G` | Open knowledge graph |
| `Mod+Alt+S` | Create version checkpoint |
| `Mod+Shift+R` | Toggle audio notes panel |
| `Mod+Alt+R` | Start / stop recording an audio note |

Kanban, calendar, flashcards, template library, time-lapse and filters are reachable through the command palette (`Mod+K`) and have no dedicated shortcut.

## Getting started

### Download

Prebuilt apps are on the [GitHub Releases page](https://github.com/fatal-distro-user/ILOVENOTES/releases). Pick the file for your system:

| OS | File |
| --- | --- |
| Linux | `ILOVENOTES-<ver>.AppImage` (portable) or `ilovenotes_<ver>_amd64.deb` (Debian / Ubuntu) |
| Windows | `ILOVENOTES Setup <ver>.exe` |
| macOS | the `.dmg` for your CPU (Intel or Apple silicon) |
| Any browser | `ILOVENOTES-web.zip` (static PWA build to host yourself) |

Desktop builds are unsigned, so expect a first-launch warning. See [docs/installation.md](docs/installation.md) for the steps per OS.

### Build from source

Requirements: Node.js 22 or newer (CI uses Node 22).

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite dev server. To run the Electron shell against the dev server:

```bash
npm run dev:desktop
```

Other useful scripts:

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` for the app and node configs |
| `npm run preview` | Serve the production web build |
| `npm run build:electron` | Bundle the Electron main/preload (`scripts/build-electron.mjs`) |

## Building

All build outputs from electron-builder go to `release/`.

| Target | Command |
| --- | --- |
| Web / PWA (`dist/`) | `npm run build` (alias of `npm run build:web`; typechecks, then `vite build`) |
| Desktop, Linux (AppImage + deb) | `npm run build:desktop` |
| Desktop, Windows (NSIS installer) | `npm run build:desktop:win` |
| Desktop, macOS (dmg) | `npm run build:desktop:mac` (intended to run in CI on macOS) |
| Linux + Windows together | `npm run build:all` |

Building the Windows installer on Linux requires Wine. Set `WINEDLLOVERRIDES` so Wine does not prompt for Mono or Gecko:

```bash
WINEDLLOVERRIDES="mscoree,mshtml=" npm run build:desktop:win
```

macOS dmg builds are produced by the GitHub Actions workflow on a macOS runner. All desktop builds are unsigned.

## Testing

```bash
npm test            # vitest run (unit tests)
npm run test:watch  # vitest in watch mode
npm run test:e2e    # Playwright end-to-end tests
```

Unit tests live next to the code as `*.test.ts` files. End-to-end specs are in `e2e/` and run in Chromium only. `playwright.config.ts` starts `npx vite preview --port 4173` as its web server and tests against `http://localhost:4173`, so build the web app first (`npm run build:web`) before running `npm run test:e2e`. It reuses an already-running server on that port, runs tests serially (not fully parallel), has a 60 second per-test timeout, and keeps traces on failure.

## Releases

`.github/workflows/release.yml` runs on pushes to `main`, pull requests, tags matching `v*`, and manual dispatch:

1. `verify` job (Ubuntu, Node 22): `npm ci`, `npm run typecheck`, `npx vitest run`, `npm run build:web`, and uploads the web build.
2. `desktop` job (matrix: Linux, Windows, macOS): builds the web app and Electron bundle, then packages with electron-builder (Linux AppImage and deb, Windows NSIS `.exe`, macOS `.dmg`) with `--publish never`.
3. `release` job: runs only for `v*` tags, zips the web build as `ILOVENOTES-web.zip`, and publishes a GitHub Release with generated notes and all desktop artifacts.

To cut a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Note that the e2e tests are not run by this workflow.

## Data and privacy

- All notes, canvases, paintings, PDFs and audio are stored locally in IndexedDB (via Dexie). Nothing is sent to a server by the app itself.
- Back up or move a workspace with Export: `.ilovenotes` (a zip archive of JSON tables plus binary assets), `.zip` (same archive, different extension) or a single `.json` file with base64-encoded assets. Importing any of these creates a new workspace.
- Two features download resources from the network the first time they are used, then work from cache:
  - Python cells load Pyodide from the jsDelivr CDN.
  - Ink-to-text OCR loads tesseract.js and its English language data.
- Clearing site data in the browser (or the desktop app's storage) deletes your notes. Keep workspace backups.

## Project structure

```
src/
  canvas/      Infinite canvas: camera, tools, objects, snapping, ink, QuickShape
  commands/    Command registry (shortcuts, palette entries)
  db/          Dexie schema, repository, types
  editor/      TipTap editor, slash items, nodes, code sandbox (JS / Pyodide)
  export/      Markdown, SVG, PNG, ORA, PSD, GIF and workspace import/export
  features/    Feature registration (index.ts) and PKM views (graph, kanban, calendar, flashcards, templates, versions, time-lapse)
  history/     Undo/redo stack and scopes
  layout/      App shell, dock, tab bar, split view, scratchpad, explorer
  lib/         Shared helpers (image, PNG, Markdown, spaced repetition)
  paint/       Paint studio: engine, brushes, color, fill, filters, geometry, selection, anim
  panels/      Dock panel registry
  pdf/         PDF viewer, annotations, import and export
  platform/    File I/O and native bridge
  spatial/     Sticky notes, mind maps, connectors, audio notes, OCR and ink conversion
  store/       Zustand stores
  ui/ views/   Shared UI components and tab views
e2e/           Playwright specs
electron/      Electron main and preload
scripts/       Build scripts
```

## Known limitations

- Handwriting OCR uses tesseract.js (English model) and is weak on cursive or messy handwriting. Expect to correct the output.
- Shape-to-diagram conversion is heuristic and may misread rough sketches.
- macOS builds are unsigned and not notarized, so Gatekeeper will warn on first launch. Windows and Linux builds are also unsigned.
- Time-lapse WebM export requires `MediaRecorder` and canvas `captureStream` support in the runtime. Time-lapse GIF/WebM export is not yet covered by automated end-to-end tests.
- Python cells and OCR need network access on first use.
- Data is local to one browser profile or desktop install; there is no sync between devices other than manual workspace export and import.
- E2E tests are not part of the CI workflow.

## License

ILOVENOTES is open source under the [MIT License](LICENSE).
