/**
 * Platform-adaptive file I/O.
 * - Desktop (Electron): native OS dialogs through the preload bridge (window.ilnNative).
 * - Browser with File System Access API: showOpenFilePicker / showSaveFilePicker.
 * - Other browsers: hidden <input type=file> and anchor-download fallback.
 */
import type { NativeFileFilter } from './native';

export interface FileFilter { name: string; extensions: string[]; mime?: string }
export interface OpenedFile { name: string; data: Uint8Array; path?: string }
export type PlatformKind = 'desktop' | 'fs-access' | 'fallback';

interface FsPickerAccept { description: string; accept: Record<string, string[]> }
interface FsFileHandle { getFile(): Promise<File>; createWritable(): Promise<{ write(d: BufferSource | Blob): Promise<void>; close(): Promise<void> }> }
interface FsAccessWindow {
  showOpenFilePicker?: (o: { multiple?: boolean; types?: FsPickerAccept[] }) => Promise<FsFileHandle[]>;
  showSaveFilePicker?: (o: { suggestedName?: string; types?: FsPickerAccept[] }) => Promise<FsFileHandle>;
}

export function platformKind(): PlatformKind {
  if (typeof window !== 'undefined' && window.ilnNative?.isDesktop) return 'desktop';
  const w = (typeof window !== 'undefined' ? window : {}) as FsAccessWindow;
  if (typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function') return 'fs-access';
  return 'fallback';
}

export function isDesktop(): boolean { return platformKind() === 'desktop'; }

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', json: 'application/json', md: 'text/markdown', txt: 'text/plain', zip: 'application/zip',
  ilovenotes: 'application/x-ilovenotes', ora: 'image/openraster', psd: 'image/vnd.adobe.photoshop', webm: 'video/webm',
  gpl: 'text/plain', hex: 'text/plain', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
};

export function mimeFor(ext: string): string { return MIME[ext.toLowerCase().replace(/^\./, '')] ?? 'application/octet-stream'; }

function toFsTypes(filters?: FileFilter[]): FsPickerAccept[] | undefined {
  if (!filters?.length) return undefined;
  return filters.map((f) => {
    const accept: Record<string, string[]> = {};
    for (const ext of f.extensions) {
      const m = f.mime ?? mimeFor(ext);
      (accept[m] ??= []).push('.' + ext.replace(/^\./, ''));
    }
    return { description: f.name, accept };
  });
}

function toNativeFilters(filters?: FileFilter[]): NativeFileFilter[] | undefined {
  return filters?.map((f) => ({ name: f.name, extensions: f.extensions.map((e) => e.replace(/^\./, '')) }));
}

function isAbort(e: unknown): boolean { return e instanceof DOMException && e.name === 'AbortError'; }

export async function openFiles(opts: { filters?: FileFilter[]; multiple?: boolean } = {}): Promise<OpenedFile[]> {
  const kind = platformKind();
  if (kind === 'desktop') {
    const res = await window.ilnNative!.openFile({ filters: toNativeFilters(opts.filters), multiple: opts.multiple });
    return res.map((f) => ({ name: f.name, path: f.path, data: new Uint8Array(f.data) }));
  }
  if (kind === 'fs-access') {
    try {
      const handles = await (window as unknown as FsAccessWindow).showOpenFilePicker!({ multiple: opts.multiple, types: toFsTypes(opts.filters) });
      return Promise.all(handles.map(async (h) => { const f = await h.getFile(); return { name: f.name, data: new Uint8Array(await f.arrayBuffer()) }; }));
    } catch (e) { if (isAbort(e)) return []; throw e; }
  }
  return openViaInput(opts);
}

export async function openFile(opts: { filters?: FileFilter[] } = {}): Promise<OpenedFile | null> {
  const files = await openFiles({ ...opts, multiple: false });
  return files[0] ?? null;
}

function openViaInput(opts: { filters?: FileFilter[]; multiple?: boolean }): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!opts.multiple;
    if (opts.filters) input.accept = opts.filters.flatMap((f) => f.extensions.map((e) => '.' + e.replace(/^\./, ''))).join(',');
    input.style.display = 'none';
    let settled = false;
    input.onchange = async () => {
      settled = true;
      const list = Array.from(input.files ?? []);
      input.remove();
      resolve(await Promise.all(list.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
    };
    input.addEventListener('cancel', () => { if (!settled) { input.remove(); resolve([]); } });
    document.body.appendChild(input);
    input.click();
  });
}

export async function toBytes(data: Blob | Uint8Array | string): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
}

/** Save data with a native/browser save dialog. Returns the saved name/path, or null if cancelled. */
export async function saveFile(data: Blob | Uint8Array | string, suggestedName: string, filters?: FileFilter[]): Promise<string | null> {
  const kind = platformKind();
  const ext = suggestedName.split('.').pop() ?? '';
  if (kind === 'desktop') {
    return window.ilnNative!.saveFile({ suggestedName, filters: toNativeFilters(filters), data: await toBytes(data) });
  }
  if (kind === 'fs-access') {
    try {
      const handle = await (window as unknown as FsAccessWindow).showSaveFilePicker!({ suggestedName, types: toFsTypes(filters) });
      const w = await handle.createWritable();
      const bytes = await toBytes(data);
      await w.write(new Blob([bytes as BlobPart], { type: mimeFor(ext) }));
      await w.close();
      return suggestedName;
    } catch (e) { if (isAbort(e)) return null; throw e; }
  }
  const bytes = await toBytes(data);
  downloadBlob(new Blob([bytes as BlobPart], { type: mimeFor(ext) }), suggestedName);
  return suggestedName;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function toggleFullscreen(): Promise<boolean> {
  if (isDesktop()) return window.ilnNative!.toggleFullscreen();
  if (document.fullscreenElement) { await document.exitFullscreen(); return false; }
  await document.documentElement.requestFullscreen();
  return true;
}
