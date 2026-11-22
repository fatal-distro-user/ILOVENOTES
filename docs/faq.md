# FAQ

## Where is my data stored?

On your device only. ILOVENOTES keeps everything in the browser's IndexedDB, in a database named `ilovenotes`. In the desktop app the same storage lives inside the Electron app's own profile folder in your OS user-data location. Interface state such as open tabs, theme and layout is kept in local storage alongside it.

Consequences:

- Data belongs to one browser profile (or one desktop install). Another browser, another profile or another URL starts empty.
- The PWA stores data per site origin. If you host the web build on a different address, it will not see data saved under the old one.
- There is no account, no server and no sync.

**Settings** shows how much storage is used and lets you request **persistent storage**, which asks the browser not to evict your data under storage pressure. It is worth doing for the web version.

## How do I back up my notes?

Use **Export** (`Mod+Shift+E`), then a workspace option: `.ilovenotes` is the usual choice. Importing a backup creates a new workspace, so a backup never overwrites existing data. Details and the archive layout are in [Import and export](import-export.md#workspace-backup).

Back up before you clear browser data, reinstall, or change browsers. A workspace backup does not include custom brush presets, color palettes or app-wide preferences like theme.

Per-page **version history** is a safety net for edits, but it is stored in the same database, so it is not a substitute for backups.

## How do I move to another computer?

Export a `.ilovenotes` file, copy it across, then import it ("Import workspace..." or `Mod+Shift+O`). On the desktop app you can also double-click the file.

## What happens if I clear site data?

Your notes are deleted. In browsers this happens if you clear "cookies and site data" for the site. Keep backups.

## Does it work offline?

Yes. The PWA caches the app, and the desktop app ships everything it needs. Two features download extra resources the first time you use them and then work from cache:

- **Python cells** load Pyodide from the jsDelivr CDN (about 10 MB).
- **Ink to text (OCR)** loads tesseract.js and its English language data.

Both need a network connection once. The PWA's service worker caches these downloads so they keep working offline afterwards.

## What is sent over the network?

The app does not send your notes anywhere. The only network requests the app code makes on its own are the first-use downloads above. Links you click open in your browser. JavaScript code cells run in a worker with `fetch`, `XMLHttpRequest` and `WebSocket` disabled.

## What are the known limitations?

- **OCR is weak on handwriting.** Ink to text uses tesseract.js with the English model; it works best on neat, print-style writing and needs correcting on cursive or messy handwriting.
- **Ink to diagram is heuristic.** It can misread rough sketches. Review the result and fix shapes by hand.
- **Builds are unsigned.** Windows SmartScreen, macOS Gatekeeper and some Linux setups warn on first launch. See [Installation](installation.md). The desktop app has no built-in updater, so download new releases manually.
- **No sync between devices.** Use workspace export and import.
- **Time-lapse WebM export** and animation WebM export need `MediaRecorder` and canvas `captureStream` support. Time-lapse GIF and WebM export are not covered by automated end-to-end tests.
- **Python and OCR need network access on first use.**
- **Linux AppImage** may need `--no-sandbox` on some distributions.

## How do I reset the layout?

Open **Settings** (`Mod+,`) and use **Reset layout**. It restores dock widths, panel placement and visibility.

## Where do I report problems or contribute?

Open an issue or pull request on the [GitHub repository](https://github.com/fatal-distro-user/ILOVENOTES). See [Development](development.md) for how to build and test.

## License

ILOVENOTES is open source under the [MIT License](../LICENSE).
