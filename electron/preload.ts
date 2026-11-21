import { contextBridge, ipcRenderer } from 'electron';

interface FileFilter { name: string; extensions: string[] }

contextBridge.exposeInMainWorld('ilnNative', {
  isDesktop: true,
  openFile: (opts: { filters?: FileFilter[]; multiple?: boolean }) => ipcRenderer.invoke('iln:openFile', opts),
  saveFile: (opts: { suggestedName: string; filters?: FileFilter[]; data: Uint8Array }) => ipcRenderer.invoke('iln:saveFile', opts),
  writeFile: (p: string, data: Uint8Array) => ipcRenderer.invoke('iln:writeFile', p, data),
  readFile: (p: string) => ipcRenderer.invoke('iln:readFile', p),
  toggleFullscreen: () => ipcRenderer.invoke('iln:toggleFullscreen'),
  consumeOpenPath: () => ipcRenderer.invoke('iln:consumeOpenPath'),
  info: () => ipcRenderer.invoke('iln:info'),
  onFileOpened: (cb: () => void) => { ipcRenderer.on('iln:fileOpened', cb); return () => ipcRenderer.removeListener('iln:fileOpened', cb); },
});
