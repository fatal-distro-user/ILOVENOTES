import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ensureDefaultWorkspace } from '@/db/repo';
import { db } from '@/db/schema';

interface WorkspaceState {
  workspaceId: string | null;
  /** Notebook currently selected in the explorer (target for "new page"). */
  notebookId: string | null;
  ready: boolean;
  /** Expanded tree node ids in the explorer. */
  expanded: Record<string, boolean>;
  boot(): Promise<void>;
  setWorkspace(id: string): Promise<void>;
  setNotebook(id: string | null): void;
  setExpanded(id: string, v: boolean): void;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaceId: null, notebookId: null, ready: false, expanded: {},
      boot: async () => {
        const { workspace } = await ensureDefaultWorkspace();
        let wsId = get().workspaceId;
        if (!wsId || !(await db.workspaces.get(wsId))) wsId = workspace.id;
        let nbId = get().notebookId;
        const nb = nbId ? await db.notebooks.get(nbId) : undefined;
        if (!nb || nb.workspaceId !== wsId || nb.deletedAt) {
          nbId = (await db.notebooks.where('workspaceId').equals(wsId).filter((n) => !n.deletedAt).sortBy('order'))[0]?.id ?? null;
        }
        set({ workspaceId: wsId, notebookId: nbId, ready: true });
      },
      setWorkspace: async (id) => {
        const nbs = await db.notebooks.where('workspaceId').equals(id).filter((n) => !n.deletedAt).sortBy('order');
        set({ workspaceId: id, notebookId: nbs[0]?.id ?? null });
      },
      setNotebook: (id) => set({ notebookId: id }),
      setExpanded: (id, v) => set((s) => ({ expanded: { ...s.expanded, [id]: v } })),
    }),
    { name: 'iln-workspace', partialize: (s) => ({ workspaceId: s.workspaceId, notebookId: s.notebookId, expanded: s.expanded }) },
  ),
);
