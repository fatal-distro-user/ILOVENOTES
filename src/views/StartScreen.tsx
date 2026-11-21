import { CalendarDays, FilePlus2, Shapes } from 'lucide-react';
import { useRecent } from '@/db/hooks';
import { useWorkspace } from '@/store/workspace';
import { newNode, openDaily, openNode } from '@/layout/actions';
import { Button } from '@/ui/Modal';

export function StartScreen({ paneId }: { paneId?: string }) {
  const workspaceId = useWorkspace((s) => s.workspaceId);
  const recent = useRecent(workspaceId, 8);
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6" data-testid="start-screen">
      <div className="w-full max-w-md">
        <div className="mb-1 text-[20px] font-semibold text-fg">ILOVENOTES</div>
        <div className="mb-4 text-fg-muted">Open a page from the explorer, or start something new.</div>
        <div className="mb-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void newNode()}><FilePlus2 size={14} />New page</Button>
          <Button onClick={() => void newNode({ mode: 'canvas', title: 'Untitled Canvas' })}><Shapes size={14} />New canvas page</Button>
          <Button onClick={() => void openDaily()}><CalendarDays size={14} />Open Daily Note</Button>
        </div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Recent</div>
        {recent.length === 0 && <div className="text-fg-faint">No recent pages yet.</div>}
        <ul>
          {recent.map((n) => (
            <li key={n.id}>
              <button onClick={() => openNode(n, { paneId })} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left hover:bg-bg-2">
                <span>{n.icon}</span><span className="truncate">{n.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
