import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import { ensureTarget, openNode, todayString } from '@/layout/actions';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/status';
import { parseDate } from './calendarLogic';

/** Open the daily note for `date` (YYYY-MM-DD), creating it in the current notebook when missing. */
export async function openDailyFor(date: string, opts: { newTab?: boolean; paneId?: string } = {}): Promise<void> {
  try {
    if (Number.isNaN(parseDate(date).getTime())) throw new Error('Invalid date');
    const target = await ensureTarget();
    let node = await db.nodes.where('workspaceId').equals(target.workspaceId).filter((n) => n.dailyDate === date && !n.deletedAt && n.kind === 'page').first();
    if (!node) {
      node = await repo.createNode({
        workspaceId: target.workspaceId, notebookId: target.notebookId, parentId: null, kind: 'page',
        title: date, icon: '📅', dailyDate: date,
      });
      useWorkspace.getState().setExpanded(target.notebookId, true);
    }
    openNode(node, opts);
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Could not open daily note', 'error');
  }
}

export { todayString };
