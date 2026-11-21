import { useSyncExternalStore, type ReactNode } from 'react';

/** Extra buttons that features add to the floating zen-mode toolbar. */
const tools = new Map<string, ReactNode>();
const listeners = new Set<() => void>();
let snapshot: { id: string; node: ReactNode }[] = [];

export function registerZenTool(id: string, node: ReactNode): () => void {
  tools.set(id, node);
  snapshot = Array.from(tools, ([k, v]) => ({ id: k, node: v }));
  listeners.forEach((l) => l());
  return () => { tools.delete(id); snapshot = Array.from(tools, ([k, v]) => ({ id: k, node: v })); listeners.forEach((l) => l()); };
}

export function useZenTools() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
}
