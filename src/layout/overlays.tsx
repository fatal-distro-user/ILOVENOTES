/** App-wide overlay components (floating menus, modals owned by feature modules). Rendered once by AppShell. */
import { useSyncExternalStore, type ComponentType } from 'react';

const overlays = new Map<string, ComponentType>();
const listeners = new Set<() => void>();
let snapshot: [string, ComponentType][] = [];

export function registerGlobalOverlay(id: string, c: ComponentType): void {
  overlays.set(id, c);
  snapshot = Array.from(overlays.entries());
  listeners.forEach((l) => l());
}

export function GlobalOverlays() {
  const list = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
  return <>{list.map(([id, C]) => <C key={id} />)}</>;
}
