import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const isDev = !!process.env.ILN_DEV_URL;
let win: BrowserWindow | null = null;
let pendingOpenPath: string | null = null;

interface FileFilter { name: string; extensions: string[] }

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'ILOVENOTES',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  if (isDev) void win.loadURL(process.env.ILN_DEV_URL as string);
  else void win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

ipcMain.handle('iln:openFile', async (_e, opts: { filters?: FileFilter[]; multiple?: boolean }) => {
  if (!win) return [];
  const res = await dialog.showOpenDialog(win, {
    properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: opts.filters,
  });
  if (res.canceled) return [];
  return Promise.all(res.filePaths.map(async (p) => ({ name: path.basename(p), path: p, data: new Uint8Array(await readFile(p)) })));
});

ipcMain.handle('iln:saveFile', async (_e, opts: { suggestedName: string; filters?: FileFilter[]; data: Uint8Array }) => {
  if (!win) return null;
  const res = await dialog.showSaveDialog(win, { defaultPath: opts.suggestedName, filters: opts.filters });
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, Buffer.from(opts.data));
  return res.filePath;
});

ipcMain.handle('iln:writeFile', async (_e, p: string, data: Uint8Array) => { await writeFile(p, Buffer.from(data)); return true; });
ipcMain.handle('iln:readFile', async (_e, p: string) => new Uint8Array(await readFile(p)));
ipcMain.handle('iln:toggleFullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); return win?.isFullScreen() ?? false; });
ipcMain.handle('iln:consumeOpenPath', async () => {
  const p = pendingOpenPath; pendingOpenPath = null;
  if (!p) return null;
  return { name: path.basename(p), path: p, data: new Uint8Array(await readFile(p)) };
});
ipcMain.handle('iln:info', () => ({ platform: process.platform, version: app.getVersion() }));

// Double-click on a .ilovenotes file: argv (win/linux) or open-file (mac).
const argFile = process.argv.find((a) => a.endsWith('.ilovenotes'));
if (argFile) pendingOpenPath = argFile;
app.on('open-file', (e, p) => { e.preventDefault(); pendingOpenPath = p; win?.webContents.send('iln:fileOpened'); });

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const f = argv.find((a) => a.endsWith('.ilovenotes'));
  if (f) { pendingOpenPath = f; win?.webContents.send('iln:fileOpened'); }
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
