import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './schema';
import * as repo from './repo';
import type { ID } from './types';

export const useWorkspaces = () => useLiveQuery(() => db.workspaces.toArray(), [], []);
export const useNotebooks = (workspaceId: ID | null) =>
  useLiveQuery(() => (workspaceId ? repo.listNotebooks(workspaceId) : []), [workspaceId], []);
export const useChildren = (notebookId: ID | null, parentId: ID | null) =>
  useLiveQuery(() => (notebookId ? repo.listChildren(notebookId, parentId) : []), [notebookId, parentId], []);
export const useNode = (id: ID | null | undefined) => useLiveQuery(() => (id ? db.nodes.get(id) : undefined), [id]);
export const useStarred = (workspaceId: ID | null) =>
  useLiveQuery(() => (workspaceId ? repo.listStarred(workspaceId) : []), [workspaceId], []);
export const useRecent = (workspaceId: ID | null, limit = 15) =>
  useLiveQuery(() => (workspaceId ? repo.listRecent(workspaceId, limit) : []), [workspaceId, limit], []);
export const useTrash = (workspaceId: ID | null) =>
  useLiveQuery(() => (workspaceId ? repo.listTrash(workspaceId) : { nodes: [], notebooks: [] }), [workspaceId], { nodes: [], notebooks: [] });
export const useTags = (workspaceId: ID | null) =>
  useLiveQuery(async () => (workspaceId ? Array.from((await repo.allTags(workspaceId)).entries()).sort((a, b) => b[1] - a[1]) : []), [workspaceId], []);
export const useSavedSearches = (workspaceId: ID | null) =>
  useLiveQuery(() => (workspaceId ? repo.listSavedSearches(workspaceId) : []), [workspaceId], []);
export const useAncestors = (id: ID | null | undefined) => useLiveQuery(() => (id ? repo.getAncestors(id) : []), [id], []);
