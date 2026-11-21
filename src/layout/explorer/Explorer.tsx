import { useState } from 'react';
import { Check, ChevronsUpDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useWorkspaces } from '@/db/hooks';
import * as repo from '@/db/repo';
import { useWorkspace } from '@/store/workspace';
import { useTabs } from '@/store/tabs';
import { toast } from '@/store/status';
import { Popover } from '@/ui/Popover';
import { IconButton } from '@/ui/IconButton';
import { confirmDialog, promptDialog } from '@/ui/dialogs';
import { PanelStack, PanelsMenuButton } from '../Dock';
import { newNode } from '../actions';
import { Section } from './Section';
import { NotebookTree } from './ExplorerTree';
import { RecentList, SavedSearchAddButton, SavedSearchList, StarredList, TagList, TrashEntry } from './ExplorerLists';

function WorkspaceSwitcher() {
  const workspaces = useWorkspaces();
  const currentId = useWorkspace((s) => s.workspaceId);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = workspaces.find((w) => w.id === currentId);
  const close = () => setAnchor(null);

  const switchTo = async (id: string) => {
    close();
    await useWorkspace.getState().setWorkspace(id);
  };
  const create = async () => {
    close();
    const name = await promptDialog('New workspace', 'Workspace');
    if (!name) return;
    const ws = await repo.createWorkspace(name);
    await repo.createNotebook(ws.id, 'Notebook');
    await useWorkspace.getState().setWorkspace(ws.id);
  };
  const rename = async (id: string, old: string) => {
    close();
    const name = await promptDialog('Rename workspace', old);
    if (name) await repo.renameWorkspace(id, name);
  };
  const remove = async (id: string, name: string) => {
    close();
    if (workspaces.length < 2) { toast('Cannot delete the only workspace', 'error'); return; }
    if (!(await confirmDialog(`Delete workspace "${name}" and everything in it permanently?`, { confirmLabel: 'Delete workspace' }))) return;
    const other = workspaces.find((w) => w.id !== id);
    if (id === currentId && other) await useWorkspace.getState().setWorkspace(other.id);
    await repo.deleteWorkspace(id);
    toast(`Deleted workspace "${name}"`, 'info');
  };

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-1.5">
      <button
        data-testid="workspace-switcher"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 text-left font-medium text-fg hover:bg-bg-2"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded bg-accent text-[10px] font-bold text-accent-fg">{(current?.name ?? 'W').slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate">{current?.name ?? 'Workspace'}</span>
        <ChevronsUpDown size={12} className="text-fg-faint" />
      </button>
      <IconButton title="New page" data-testid="explorer-new-page" onClick={() => void newNode()}><Plus size={14} /></IconButton>
      <PanelsMenuButton />
      {anchor && (
        <Popover anchor={anchor} onClose={close} className="min-w-[230px] py-1">
          {workspaces.map((w) => (
            <div key={w.id} className="group flex h-7 items-center pr-1 hover:bg-bg-3" data-testid="workspace-item">
              <button onClick={() => void switchTo(w.id)} className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left">
                <span className="w-3.5 shrink-0">{w.id === currentId && <Check size={13} />}</span><span className="truncate">{w.name}</span>
              </button>
              <IconButton size="sm" title="Rename workspace" onClick={() => void rename(w.id, w.name)}><Pencil size={12} /></IconButton>
              <IconButton size="sm" title="Delete workspace" onClick={() => void remove(w.id, w.name)}><Trash2 size={12} /></IconButton>
            </div>
          ))}
          <div className="my-1 h-px bg-line" />
          <button onClick={() => void create()} className="flex h-7 w-full items-center gap-2 px-3 text-left hover:bg-bg-3" data-testid="workspace-new"><Plus size={13} />New workspace…</button>
        </Popover>
      )}
    </div>
  );
}

export function Explorer() {
  // Re-render the explorer scroll area when the focused pane's tab changes so the active row highlight stays current.
  useTabs((s) => s.focusedPaneId);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="explorer">
      <WorkspaceSwitcher />
      <div className="min-h-0 flex-[3] overflow-y-auto">
        <Section id="notebooks" title="Notebooks"><NotebookTree /></Section>
        <Section id="starred" title="Starred"><StarredList /></Section>
        <Section id="recent" title="Recent" defaultOpen={false}><RecentList /></Section>
        <Section id="tags" title="Tags" defaultOpen={false}><TagList /></Section>
        <Section id="saved" title="Saved Searches" defaultOpen={false} actions={<SavedSearchAddButton />}><SavedSearchList /></Section>
        <TrashEntry />
      </div>
      <PanelStack side="left" />
    </div>
  );
}
