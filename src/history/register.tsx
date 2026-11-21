import { useEffect, useReducer } from 'react';
import { History, Undo2, Redo2, Brush, Shapes, Type, Layers, Wand2, SquareDashed, Circle } from 'lucide-react';
import { undoDepth, redoDepth } from '@tiptap/pm/history';
import clsx from 'clsx';
import { registerCommands } from '@/commands/registry';
import { registerPanel } from '@/panels/registry';
import { useActiveEditor } from '@/editor/activeEditor';
import { toast } from '@/store/status';
import { activeScope, useUndoScopes, type UndoScope } from './scopes';
import type { HistoryCommand } from './stack';

/** Bridge: the focused document editor (ProseMirror history) acts as an undo scope. */
function editorScope(): UndoScope | null {
  const { editor, pageId } = useActiveEditor.getState();
  if (!editor || editor.isDestroyed) return null;
  return {
    id: `doc:${pageId ?? ''}`, label: 'Document',
    undo: () => { editor.chain().focus().undo().run(); },
    redo: () => { editor.chain().focus().redo().run(); },
    canUndo: () => undoDepth(editor.state) > 0,
    canRedo: () => redoDepth(editor.state) > 0,
    depth: () => ({ undo: undoDepth(editor.state), redo: redoDepth(editor.state) }),
    subscribe: (cb) => { editor.on('transaction', cb); return () => { editor.off('transaction', cb); }; },
  };
}

/** The scope global undo targets: the active registered scope, else the focused document editor. */
export function currentScope(): UndoScope | null {
  const s = activeScope();
  const ed = useActiveEditor.getState().editor;
  // If the user's last interaction was typing in a document, prefer it.
  if (ed && !ed.isDestroyed && ed.isFocused) return editorScope();
  return s ?? editorScope();
}

registerCommands([
  { id: 'edit.undo', title: 'Undo', category: 'Edit', shortcut: 'Mod+Z', run: async () => { const s = currentScope(); if (s?.canUndo()) await s.undo(); else toast('Nothing to undo'); } },
  { id: 'edit.redo', title: 'Redo', category: 'Edit', shortcut: ['Mod+Shift+Z', 'Mod+Y'], run: async () => { const s = currentScope(); if (s?.canRedo()) await s.redo(); else toast('Nothing to redo'); } },
]);

const KIND_ICON: Record<NonNullable<HistoryCommand['kind']>, typeof Brush> = {
  raster: Brush, vector: Circle, object: Shapes, text: Type, layer: Layers, filter: Wand2, selection: SquareDashed, other: History,
};

function useScopeVersion(scope: UndoScope | null): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => scope?.subscribe(bump), [scope]);
}

function HistoryPanel() {
  const activeId = useUndoScopes((s) => s.activeId);
  const scopes = useUndoScopes((s) => s.scopes);
  const edState = useActiveEditor();
  const scope = (activeId ? scopes[activeId] : null) ?? (edState.editor ? editorScope() : null);
  useScopeVersion(scope);
  if (!scope) return <div className="p-3 text-fg-faint">Edit a page, canvas or painting to build history.</div>;
  const stack = scope.stack;
  return (
    <div className="flex flex-col" data-testid="history-panel">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        <span className="flex-1 truncate text-[11px] text-fg-faint">{scope.label}</span>
        <button className="rounded p-1 hover:bg-bg-3 disabled:opacity-40" disabled={!scope.canUndo()} onClick={() => void scope.undo()} title="Undo (Mod+Z)" data-testid="history-undo"><Undo2 size={13} /></button>
        <button className="rounded p-1 hover:bg-bg-3 disabled:opacity-40" disabled={!scope.canRedo()} onClick={() => void scope.redo()} title="Redo (Mod+Shift+Z)" data-testid="history-redo"><Redo2 size={13} /></button>
      </div>
      {!stack && scope.depth && (
        <div className="p-3 text-fg-muted">{scope.depth().undo} undo step(s) · {scope.depth().redo} redo step(s)<div className="mt-1 text-[11px] text-fg-faint">Text edits are grouped by typing bursts.</div></div>
      )}
      {stack && (
        <div className="max-h-[360px] overflow-y-auto py-0.5">
          <button className={clsx('flex w-full items-center gap-2 px-2.5 py-1 text-left', stack.position === 0 ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-3')} onClick={() => void stack.goTo(0)}>
            <History size={12} /><span>Original</span>
          </button>
          {stack.list.map((e, i) => {
            const Icon = KIND_ICON[e.cmd.kind ?? 'other'];
            const applied = i < stack.position;
            const current = i === stack.position - 1;
            return (
              <button key={e.id} data-testid="history-entry" onClick={() => void stack.goTo(i + 1)}
                className={clsx('flex w-full items-center gap-2 px-2.5 py-1 text-left', current ? 'bg-accent text-accent-fg' : applied ? 'text-fg hover:bg-bg-3' : 'text-fg-faint line-through decoration-fg-faint/40 hover:bg-bg-3')}>
                <Icon size={12} className="shrink-0" />
                <span className="flex-1 truncate">{e.cmd.label}</span>
                <span className="text-[10px] opacity-60">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </button>
            );
          })}
          <div className="px-2.5 py-1 text-[10px] text-fg-faint">{stack.list.length} / {stack.limit} steps</div>
        </div>
      )}
    </div>
  );
}

registerPanel({ id: 'history', title: 'History', icon: History, defaultSide: 'right', component: HistoryPanel, defaultOrder: 80 });
