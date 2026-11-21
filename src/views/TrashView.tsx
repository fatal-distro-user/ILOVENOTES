import { Trash2, Undo2 } from 'lucide-react';
import { useTrash } from '@/db/hooks';
import * as repo from '@/db/repo';
import { useWorkspace } from '@/store/workspace';
import { useTabs } from '@/store/tabs';
import { toast } from '@/store/status';
import { confirmDialog } from '@/ui/dialogs';
import { Button } from '@/ui/Modal';
import { registerTabView } from './registry';

const when = (t: number) => new Date(t).toLocaleString();

function Row({ icon, title, kind, deletedAt, onRestore, onPurge }: { icon: string; title: string; kind: string; deletedAt: number; onRestore: () => void; onPurge: () => void }) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-line px-3" data-testid="trash-row">
      <span className="w-5 text-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate" data-testid="trash-row-title">{title}</span>
      <span className="rounded bg-bg-3 px-1.5 text-[11px] text-fg-muted">{kind}</span>
      <span className="w-40 text-right text-[12px] text-fg-faint">{when(deletedAt)}</span>
      <Button onClick={onRestore} data-testid="trash-restore"><Undo2 size={13} />Restore</Button>
      <Button variant="danger" onClick={onPurge} data-testid="trash-purge"><Trash2 size={13} />Delete forever</Button>
    </div>
  );
}

function TrashView() {
  const ws = useWorkspace((s) => s.workspaceId);
  const { nodes, notebooks } = useTrash(ws);
  const empty = nodes.length + notebooks.length === 0;

  const purgeNode = async (id: string, title: string) => {
    if (!(await confirmDialog(`Permanently delete "${title}" and everything inside it? This cannot be undone.`, { confirmLabel: 'Delete forever' }))) return;
    const ids = [id, ...(await repo.getDescendantIds(id))];
    await repo.purgeNode(id);
    ids.forEach((i) => useTabs.getState().closePage(i));
  };
  const purgeNb = async (id: string, name: string) => {
    if (!(await confirmDialog(`Permanently delete notebook "${name}" and all its pages? This cannot be undone.`, { confirmLabel: 'Delete forever' }))) return;
    await repo.purgeNotebook(id);
  };
  const emptyAll = async () => {
    if (!ws || !(await confirmDialog('Permanently delete everything in the trash? This cannot be undone.', { confirmLabel: 'Empty trash' }))) return;
    const n = await repo.emptyTrash(ws);
    toast(`Deleted ${n} item${n === 1 ? '' : 's'} permanently`, 'info');
  };

  return (
    <div className="flex h-full flex-col" data-testid="trash-view">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold"><Trash2 size={16} className="text-fg-muted" />Trash</div>
        <Button variant="danger" disabled={empty} onClick={() => void emptyAll()} data-testid="trash-empty">Empty trash</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty && <div className="p-8 text-center text-fg-faint">Trash is empty.</div>}
        {notebooks.map((nb) => (
          <Row key={nb.id} icon={nb.icon} title={nb.name} kind="Notebook" deletedAt={nb.deletedAt}
            onRestore={() => void repo.restoreNotebook(nb.id)} onPurge={() => void purgeNb(nb.id, nb.name)} />
        ))}
        {nodes.map((n) => (
          <Row key={n.id} icon={n.icon} title={n.title} kind={n.kind === 'page' ? 'Page' : n.kind === 'folder' ? 'Folder' : 'Section'} deletedAt={n.deletedAt}
            onRestore={() => void repo.restoreNode(n.id)} onPurge={() => void purgeNode(n.id, n.title)} />
        ))}
      </div>
    </div>
  );
}

registerTabView('trash', TrashView);
