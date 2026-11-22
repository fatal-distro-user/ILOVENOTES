# Import and export

Open the Export dialog with `Mod+Shift+E` (or the Export button in a page header, or "Export..." in the command palette). It shows sections for the current page, the current painting (if one is open) and the whole workspace. Importing is `Mod+Shift+O` ("Import workspace...").

On the desktop app, saving uses native file dialogs. In a browser that supports the File System Access API you get save and open pickers; other browsers fall back to a download and a file chooser.

## Page and notebook exports

| Export | Available for | Output |
| --- | --- | --- |
| Markdown (`.md`) | Every page | One file with YAML front matter (title, created, updated, tags, date). Tables, math, links and so on are converted; sketch frames are embedded as inline images. Canvas and hybrid pages also get the canvas appended as an embedded SVG image |
| SVG (vector) | Canvas and hybrid pages | Shapes, text, ink, connectors, images, paintings and PDF pages, with a white background |
| PNG (2x) | Canvas and hybrid pages | High-resolution raster of the same content |
| Annotated PDF | Pages that have a PDF | PDF with annotations burned in. See [PDF](pdf.md#exporting) for page selection and extraction |
| Notebook as Markdown ZIP | Every page | A ZIP named `<notebook>-markdown.zip` containing one `.md` per page, mirroring your folder tree, with sketches and canvases saved as files in an `assets` folder and linked relatively. Trashed pages are skipped |

The command palette also has "Export page as Markdown".

## Paint exports

Available while a painting is open, from the Export dialog. The header also has a quick **PNG** button.

| Export | Output |
| --- | --- |
| PNG (flattened) | The merged image |
| OpenRaster (`.ora`) | Layers, groups, opacity, visibility and blend modes. Opens in Krita, GIMP and MyPaint. Layer masks are applied into the layer pixels |
| Photoshop (`.psd`) | Layers, groups, masks, clipping and blend modes (via ag-psd) |
| Layer PNGs (`.zip`) | One PNG per layer, a `merged.png`, and a `layers.txt` listing file, blend mode, opacity and visibility |

Animation exports (GIF, sprite sheet, WebM) are on the timeline bar; see [Animation](animation.md#exporting). Time-lapse GIF and WebM are described in [Knowledge tools](knowledge.md#time-lapse).

## Workspace backup

The "Whole workspace" section of the Export dialog writes a complete backup of the **current workspace**: notebooks, pages, documents, canvas objects, ink, paintings with all layers and animation frames, PDFs and annotations, audio recordings, version snapshots, saved searches, flashcard review progress and per-page settings (such as canvas camera and kanban columns).

Three flavors, all with the same content:

| Format | File | Notes |
| --- | --- | --- |
| `.ilovenotes` | ZIP archive | The default. Use this for backups |
| `.zip` | The same ZIP archive with a `.zip` extension | Easy to inspect with any unzip tool |
| `.json` | A single JSON file | Binary data is base64 encoded, so it is larger. Easier to process with scripts |

File names look like `<workspace>-YYYY-MM-DD.<ext>`.

**Not included**: custom brush presets, color palettes and app-wide preferences such as theme and layout. These are stored outside the workspace tables.

### Archive layout

The `.ilovenotes` and `.zip` files are ordinary ZIP files:

```
manifest.json
data/
  workspaces.json   notebooks.json   nodes.json   docs.json
  canvasObjects.json   strokes.json   rasterDocs.json   layers.json
  tiles.json   animFrames.json   pdfs.json   annotations.json
  audio.json   snapshots.json   savedSearches.json   srsReviews.json
  settings.json
assets/
  rasterDocs/<n>    painting preview images
  tiles/<n>         256 x 256 layer pixel tiles (PNG)
  pdfs/<n>          original PDF files
  audio/<n>         audio recordings
```

- `manifest.json` has `format` (`ilovenotes-workspace`), `version` (currently `1`), `exportedAt`, `app`, the workspace name and a `counts` object with the number of rows per table.
- Each `data/<table>.json` is an array of rows. A binary field (preview, tile, PDF data or audio) is replaced by a reference of the form `{ "$blob": "assets/<table>/<n>", "type": "<mime type>" }` pointing at a file in `assets/`.
- Assets are stored uncompressed (they are already compressed formats); the JSON is compressed.
- In the single `.json` variant the layout is `{ "format", "version", "exportedAt", "tables": { ... } }` and binary fields are `{ "$base64": "...", "type": "..." }`.

Row shapes mirror the database types in `src/db/types.ts` (see [Development](development.md)).

## Importing a workspace

Choose "Import workspace..." and pick a `.ilovenotes`, `.zip` or `.json` file. You can also double-click a `.ilovenotes` file with the desktop app installed.

- Import **always creates a new workspace**. Every id is remapped, so importing a backup next to its original never overwrites or merges with anything.
- If a workspace with the same name exists, the imported one is named "<name> (imported)".
- The app switches to the imported workspace and shows how many pages were imported.
- Files that are not ILOVENOTES archives, or that were created by a newer version of the app (a higher archive `version`), are rejected with an error message.

## Moving data between devices

There is no sync. To move a workspace: export `.ilovenotes` on one device, copy the file, and import it on the other. See the [FAQ](faq.md) for where data lives.
