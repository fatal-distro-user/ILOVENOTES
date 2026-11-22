# Development

This page is for contributors. For user-facing behavior see the [documentation index](README.md). The [project README](../README.md) is the source of truth for the exact build commands and the keyboard shortcut tables.

## Setup

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev            # Vite dev server
npm run dev:desktop    # Electron shell against the dev server (port 5173)
```

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` for the app config and the node config |
| `npm test` | Unit tests (vitest, jsdom) |
| `npm run test:watch` | vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end tests (Chromium) |
| `npm run build` / `build:web` | Typecheck, then `vite build` into `dist/` |
| `npm run build:electron` | Bundle Electron main and preload with esbuild into `dist-electron/` |
| `npm run build:desktop` | Linux AppImage and deb into `release/` |
| `npm run build:desktop:win` | Windows NSIS installer |
| `npm run build:desktop:mac` | macOS dmg (intended for a macOS machine or CI) |
| `npm run build:all` | Linux and Windows together |
| `npm run preview` | Serve the production web build |

TypeScript is strict with `noUnusedLocals` and `noUnusedParameters`. The `@/` import alias maps to `src/`.

### Building the Windows installer on Linux

This needs Wine. Stop Wine from prompting for Mono and Gecko:

```bash
WINEDLLOVERRIDES="mscoree,mshtml=" npm run build:desktop:win
```

## Architecture overview

The stack is React 19, TypeScript, Vite, Tailwind v4, Zustand with immer, Dexie (IndexedDB), TipTap v3, `vite-plugin-pwa` and Electron. The Vite config uses a relative `base` so the same bundle works from `file://` in Electron and from a sub-path on the web.

```
src/
  canvas/    Infinite canvas: camera, tools, objects, snapping, ink, QuickShape
  commands/  Command registry (shortcuts, palette entries)
  db/        Dexie schema, repository functions, types
  editor/    TipTap editor, slash items, nodes, code sandbox (JS / Pyodide)
  export/    Markdown, SVG, PNG, ORA, PSD, GIF and workspace import/export
  features/  index.ts (feature registration) and PKM views
  history/   Undo/redo stack and scopes
  layout/    App shell, dock, tab bar, split view, scratchpad, explorer
  lib/       Shared helpers (image, PNG, markup parsers, spaced repetition)
  paint/     Paint studio: engine, brushes, color, fill, filters, geometry, selection, anim
  panels/    Dock panel registry
  pdf/       PDF viewer, annotations, import and export
  platform/  File I/O and the native bridge
  spatial/   Sticky notes, mind maps, connectors, audio notes, OCR and ink conversion
  store/     Zustand stores (tabs, layout, workspace, status)
  views/     Tab views and the tab-view registry
electron/    Main process and preload
e2e/         Playwright specs
```

### Feature registration

Features register themselves as import side effects. `src/features/index.ts` imports each feature module (editor, history, canvas, pdf, paint, color, spatial, export, pkm, plus the layout commands and views). A new feature module is wired in by adding one import there.

### Data model

`src/db/schema.ts` defines the Dexie database `ilovenotes` (one schema version so far). Entities are in `src/db/types.ts`: `Workspace`, `Notebook`, `TreeNode` (folder, section or page, with `mode: 'document' | 'canvas' | 'pdf' | 'hybrid'`), `PageDoc` (TipTap JSON plus derived text, links, tags and headings), `CanvasObject`, `Stroke`, `RasterDoc`, `Layer`, `Tile`, `AnimFrame`, `PdfFile`, `Annotation`, `AudioClip`, `Snapshot`, `BrushPresetRecord`, `Palette`, `SrsReview`, `SavedSearch` and `SettingRow`. Repository functions that create and change entities live in `src/db/repo.ts`. Ids are nanoid strings and timestamps are epoch milliseconds. Trashing sets `deletedAt` instead of deleting.

When you add a table that should be backed up, update `src/export/workspace.ts` (the `Tables` type, `collectWorkspace`, the blob field map and the import lists) and bump the archive version if the format changes incompatibly.

## Registries

All registries are module-level maps populated at import time. Call these from a feature module that is imported by `src/features/index.ts`.

| Registry | Defined in | Signature |
| --- | --- | --- |
| `registerCommands` | `src/commands/registry.ts` | `(cmds: Command[]) => () => void` (also `registerCommand(cmd)`) |
| `registerPanel` | `src/panels/registry.ts` | `(def: PanelDef) => () => void` |
| `registerTabView` | `src/views/registry.ts` | `(kind: TabKind, c: ComponentType<TabViewProps>) => void` |
| `registerPageBody` | `src/views/registry.ts` | `(mode: PageMode, c: ComponentType<PageBodyProps>) => void` |
| `registerObjectType` | `src/canvas/objects/registry.ts` | `(def: ObjectTypeDef) => void` |
| `registerCanvasTool` | `src/canvas/CanvasChrome.tsx` | `(def: ToolDef, afterTool?: CanvasTool) => void` |
| `registerCanvasPlugin` | `src/canvas/CanvasView.tsx` | `(p: CanvasPlugin) => void` |
| `registerPaintTool` | `src/paint/studio/tools.ts` | `(def: PaintToolDef) => void` |
| `registerSlashItem` | `src/editor/slash.ts` | `(item: SlashItem) => void` |
| `registerEditorExtension` | `src/editor/extensions.ts` | `(ext: AnyExtension) => void` |
| `registerGlobalOverlay` | `src/layout/overlays.tsx` | `(id: string, c: ComponentType) => void` |
| `registerBottomBar` | `src/layout/bottomBars.ts` | `(id: string, c: ComponentType) => void` |

### Commands

```ts
interface Command {
  id: string;
  title: string;
  category: string;
  shortcut?: string | string[];   // "Mod+Shift+K"; Mod = Ctrl, or Cmd on macOS
  keywords?: string[];
  when?: () => boolean;           // false hides it from the palette and disables the shortcut
  allowInInput?: boolean;         // fire while focus is in an editor or input
  run: () => void | Promise<void>;
}
```

Every user-facing action should be a command so that it shows up in the `Mod+K` palette. `installShortcutDispatcher` handles keys in two phases: bubble for normal shortcuts, and capture for `allowInInput` commands while focus is in an editable element, so ProseMirror cannot swallow them. Use `when` to scope a command to a context.

### Panels

`PanelDef` is `{ id, title, icon: LucideIcon, defaultSide: 'left' | 'right', component, when?, defaultOrder? }` (`DockSide` is defined in `src/store/layout.ts`). Registering also ensures a row in the persisted layout state, so users can hide, move and collapse the panel. `when` decides whether the panel is shown in the current context.

### Tab views and page bodies

`TabKind` (in `src/store/tabs.ts`) is `'page' | 'graph' | 'kanban' | 'calendar' | 'flashcards' | 'trash' | 'settings' | 'search' | 'templates' | 'paint'`. `registerTabView` maps a kind to the component that renders it (`TabViewProps` is `{ tab, paneId, active }`). Page tabs render the component registered with `registerPageBody` for the page's mode (`PageBodyProps` is `{ node, paneId, active }`).

### Canvas

- `registerObjectType` takes `ObjectTypeDef`: `type` (a `CanvasObjectType`), `component`, and optional `editable`, `lockAspect`, `svgLayer`, `minSize`, `toText`, `onOpen` (double-click) and `toSvg` (vector export). Provide `toText` and `toSvg` so search and export cover your object.
- `registerCanvasTool(def, afterTool?)` adds a toolbar button. `ToolDef` is `{ tool, icon, label, key }`. The tool id must also exist in the `CanvasTool` union in `src/canvas/tools.ts`. Single-key shortcuts come from `TOOL_SHORTCUTS` in the same file.
- `registerCanvasPlugin` extends interaction through optional hooks: `onPointerDown` (returns a drag session), `onKeyDown`, `transformStroke`, `onPenHold`, `onPenSample`, `onDropFiles` and an `Overlay` component. Sticky notes, connectors, QuickShape, audio sync, PDF drop and ink actions all use it.

### Paint

`PaintToolDef` has `id`, `label`, `icon`, optional `key`, `group` (`paint`, `select`, `fill`, `transform`, `retouch`, `view` or `guide`), `order`, `cursor`, a `down(ctx, pointer)` that returns a `ToolSession` (`move`, `up`, optional `cancel`) or `null`, plus optional `drawOverlay`, an `Options` component for the options bar, and `onKey`. `src/paint/studio/tools.ts` also exports `registerPaintOverlay` and `registerPointerConstraint` for guides and rulers.

### Editor

`SlashItem` extends `SuggestItem` (`id`, `title`, `subtitle?`, `icon?`, `group?`) with `keywords?` and `run(editor, range)`. Registering an item with an existing id replaces it. `registerEditorExtension` adds a TipTap extension that `buildExtensions` includes (the inline sketch frame uses both). Commands that act on the focused editor read it from `useActiveEditor`.

## Undo scopes

Each editing surface owns an undo scope (`src/history/scopes.ts`):

```ts
interface UndoScope {
  id: string; label: string;
  undo(): void | Promise<void>; redo(): void | Promise<void>;
  canUndo(): boolean; canRedo(): boolean;
  stack?: HistoryStack;                         // command-pattern scopes
  depth?(): { undo: number; redo: number };     // non-stack scopes (ProseMirror)
  subscribe(cb: () => void): () => void;
}
```

- Command-pattern surfaces wrap a `HistoryStack` with `stackScope(id, label, stack)` and register it: canvas pages (`canvas:<pageId>`), paintings (`paint:<docId>`) and PDF annotations (`pdf:<pdfId>`). A `HistoryCommand` has a `label`, optional `kind`, `undo`, `redo`, optional `size` (memory accounting), `dispose`, and `mergeKey` / `merge` for coalescing rapid edits. Push a command after applying its effect; `redo` is not called on push.
- The document editor is bridged from ProseMirror history by `editorScope()` in `src/history/register.tsx`.
- The "active" scope is the most recently activated one. Global Undo and Redo (`edit.undo`, `edit.redo`) call `currentScope()`, which prefers the focused document editor, otherwise the active scope. The History panel lists the active stack's entries.
- A `HistoryStack` serialises async commands, defaults to 200 entries, a 512 MB size cap and a 600 ms merge window.

## Testing

- Unit tests are `*.test.ts(x)` files next to the code and run under vitest with jsdom (`vitest.config.ts`). `fake-indexeddb` supports database tests. Keep logic in pure helper modules (as the PKM `*Logic.ts` files do) so it is easy to test.
- End-to-end specs are in `e2e/` and run in Chromium. `playwright.config.ts` starts `npx vite preview --port 4173`, so build the web app first (`npm run build:web`). Tests run serially with a 60 second timeout. Specs find elements by `data-testid`; add one when you add UI that a spec needs.
- CI runs typecheck, vitest and the web build. It does not run the e2e suite.

## Releases

Releases are produced by `.github/workflows/release.yml`.

1. `verify` job: `npm ci`, typecheck, `npx vitest run`, `npm run build:web`, upload `dist`.
2. `desktop` job (Linux, Windows, macOS matrix): build web and Electron bundles, then `electron-builder --publish never` with signing discovery disabled, so all desktop builds are unsigned.
3. `release` job (tags only): zips the web build as `ILOVENOTES-web.zip` and publishes a GitHub Release with generated notes, the desktop artifacts and the zip.

To cut a release, update the version in `package.json` if needed, then push a `v*` tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Artifact names come from electron-builder defaults and `electron-builder.yml` (`appId` `app.ilovenotes.desktop`, product name `ILOVENOTES`). The Linux targets are AppImage and deb, Windows is NSIS (not one-click, per-user, with a choosable install directory), and macOS is dmg with signing identity disabled. The `.ilovenotes` file association is declared in `electron-builder.yml`.

## Electron notes

`electron/main.ts` creates a sandboxed window (`contextIsolation` on, `nodeIntegration` off) with no application menu, and exposes file open and save, fullscreen and open-file handling through the preload bridge (`window.ilnNative`). `src/platform/fileio.ts` picks the right file I/O path: the native bridge on desktop, the File System Access API where available, or an input and download fallback. Set `ILN_DEV_URL` to load the dev server (the `dev:desktop` script does this). A single-instance lock forwards `.ilovenotes` files from a second launch to the running window.
