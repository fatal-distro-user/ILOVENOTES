import { create } from 'zustand';
import type { Editor } from '@tiptap/core';
import { useTabs } from '@/store/tabs';

/** The most recently focused document editor (for the Outline panel, commands, palette actions). */
interface ActiveEditorState { editor: Editor | null; pageId: string | null; set(editor: Editor | null, pageId: string | null): void }

export const useActiveEditor = create<ActiveEditorState>()((set) => ({
  editor: null, pageId: null,
  set: (editor, pageId) => set({ editor, pageId }),
}));

/** Page id of the active tab in the focused pane (reactive). */
export function useActivePageId(): string | null {
  return useTabs((s) => {
    const p = s.panes.find((x) => x.id === s.focusedPaneId);
    const t = p?.tabs.find((x) => x.id === p.activeTabId);
    return t?.kind === 'page' ? t.pageId ?? null : null;
  });
}
