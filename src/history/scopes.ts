/**
 * Undo scopes. Each editing surface (document editor, canvas page, paint frame) exposes an UndoScope.
 * The most recently interacted-with scope is "active"; global Undo/Redo and the History panel target it.
 */
import { create } from 'zustand';
import { HistoryStack, type HistoryEntry } from './stack';

export interface UndoScope {
  id: string;
  label: string;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Command-pattern scopes expose their stack so the History panel can list & jump. */
  stack?: HistoryStack;
  /** Non-stack scopes (ProseMirror) report depth only. */
  depth?(): { undo: number; redo: number };
  /** Subscribe to changes (for panel re-render). */
  subscribe(cb: () => void): () => void;
}

interface ScopeState {
  scopes: Record<string, UndoScope>;
  activeId: string | null;
  register(scope: UndoScope): () => void;
  activate(id: string): void;
}

export const useUndoScopes = create<ScopeState>()((set, get) => ({
  scopes: {},
  activeId: null,
  register: (scope) => {
    set((s) => ({ scopes: { ...s.scopes, [scope.id]: scope } }));
    return () => {
      const { [scope.id]: _removed, ...rest } = get().scopes;
      void _removed;
      set((s) => ({ scopes: rest, activeId: s.activeId === scope.id ? null : s.activeId }));
    };
  },
  activate: (id) => { if (get().activeId !== id && get().scopes[id]) set({ activeId: id }); },
}));

export function activeScope(): UndoScope | null {
  const s = useUndoScopes.getState();
  return s.activeId ? s.scopes[s.activeId] ?? null : null;
}

/** Wrap a HistoryStack as a scope. */
export function stackScope(id: string, label: string, stack: HistoryStack): UndoScope {
  return {
    id, label, stack,
    undo: () => stack.undo(), redo: () => stack.redo(),
    canUndo: () => stack.canUndo, canRedo: () => stack.canRedo,
    subscribe: (cb) => stack.subscribe(cb),
  };
}

export type { HistoryEntry };
