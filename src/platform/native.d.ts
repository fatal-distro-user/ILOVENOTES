export interface NativeFileFilter { name: string; extensions: string[] }
export interface NativeFile { name: string; path: string; data: Uint8Array }

export interface IlnNative {
  isDesktop: true;
  openFile(opts: { filters?: NativeFileFilter[]; multiple?: boolean }): Promise<NativeFile[]>;
  saveFile(opts: { suggestedName: string; filters?: NativeFileFilter[]; data: Uint8Array }): Promise<string | null>;
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array>;
  toggleFullscreen(): Promise<boolean>;
  consumeOpenPath(): Promise<NativeFile | null>;
  info(): Promise<{ platform: string; version: string }>;
  onFileOpened(cb: () => void): () => void;
}

declare global {
  interface Window { ilnNative?: IlnNative }
}
