import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import clsx from 'clsx';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { db } from '@/db/schema';
import { useWorkspace } from '@/store/workspace';
import { Segmented } from '@/ui/Segmented';
import { Button } from '@/ui/Modal';
import { openNode, todayString } from '@/layout/actions';
import { registerTabView, type TabViewProps } from '@/views/registry';
import { addDays, addMonths, bucketByDay, monthGrid, monthTitle, parseDate, sameMonth, weekDays, weekTitle, type DayReason } from './calendarLogic';
import { openDailyFor } from './daily';

type Mode = 'month' | 'week';
const WEEKDAY_FMT: Intl.DateTimeFormatOptions = { weekday: 'short' };
const REASON_DOT: Record<DayReason, string> = { daily: 'bg-accent', created: 'bg-ok', updated: 'bg-warn' };

function CalendarView({ paneId }: TabViewProps) {
  const ws = useWorkspace((s) => s.workspaceId);
  const today = todayString();
  const [mode, setMode] = useState<Mode>('month');
  const [cursor, setCursor] = useState(today);
  const [show, setShow] = useState({ daily: true, created: true, updated: false });

  const nodes = useLiveQuery(
    () => (ws ? db.nodes.where('workspaceId').equals(ws).filter((n) => !n.deletedAt && n.kind === 'page').toArray() : []),
    [ws], [],
  );
  const buckets = useMemo(() => bucketByDay(nodes, show), [nodes, show]);
  const rows = useMemo(() => (mode === 'month' ? monthGrid(cursor) : [weekDays(cursor)]), [mode, cursor]);

  const step = (dir: -1 | 1) => setCursor((c) => (mode === 'month' ? addMonths(c, dir) : addDays(c, dir * 7)));
  const weekdayNames = (rows[0] ?? []).map((d) => parseDate(d).toLocaleDateString(undefined, WEEKDAY_FMT));
  const maxItems = mode === 'month' ? 3 : 40;

  return (
    <div className="flex h-full flex-col bg-bg" data-testid="calendar">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <CalendarDays size={16} className="text-accent" />
        <h2 className="min-w-[190px] text-[15px] font-semibold" data-testid="calendar-title">{mode === 'month' ? monthTitle(cursor) : weekTitle(cursor)}</h2>
        <div className="flex items-center gap-1">
          <Button aria-label="Previous" onClick={() => step(-1)} data-testid="calendar-prev" className="w-7 px-0!"><ChevronLeft size={14} /></Button>
          <Button onClick={() => setCursor(today)} data-testid="calendar-today">Today</Button>
          <Button aria-label="Next" onClick={() => step(1)} data-testid="calendar-next" className="w-7 px-0!"><ChevronRight size={14} /></Button>
        </div>
        <Segmented testId="calendar-mode" value={mode} onChange={setMode} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} />
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-[12px] text-fg-muted">
          {(['daily', 'created', 'updated'] as const).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} data-testid={`calendar-show-${k}`} />
              <span className={clsx('h-2 w-2 rounded-full', REASON_DOT[k])} />{k === 'daily' ? 'Daily notes' : k === 'created' ? 'Created' : 'Edited'}
            </label>
          ))}
        </div>
        <Button variant="primary" onClick={() => void openDailyFor(today, { paneId })} data-testid="calendar-today-note">Today’s note</Button>
      </div>
      <div className="grid shrink-0 grid-cols-7 border-b border-line text-center text-[11px] uppercase tracking-wider text-fg-faint">
        {weekdayNames.map((n) => <div key={n} className="py-1.5">{n}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto" style={{ gridTemplateRows: `repeat(${rows.length}, minmax(${mode === 'week' ? 0 : 96}px, 1fr))` }}>
        {rows.flat().map((date) => {
          const entries = buckets.get(date) ?? [];
          const inMonth = mode === 'week' || sameMonth(date, cursor);
          const isToday = date === today;
          return (
            <div
              key={date} role="button" tabIndex={0} data-testid="calendar-day" data-date={date} data-today={isToday || undefined} data-count={entries.length}
              onClick={() => void openDailyFor(date, { paneId })}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) void openDailyFor(date, { paneId }); }}
              className={clsx('group flex min-h-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-b border-r border-line p-1.5 text-left outline-none hover:bg-bg-1 focus-visible:ring-1 focus-visible:ring-accent', !inMonth && 'bg-bg-1/40 text-fg-faint')}
            >
              <div className="flex items-center justify-between">
                <span className={clsx('flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] tabular-nums', isToday ? 'bg-accent font-semibold text-accent-fg' : inMonth ? 'text-fg' : 'text-fg-faint')}>{parseDate(date).getDate()}</span>
                <span className="text-[10px] text-fg-faint opacity-0 group-hover:opacity-100">{entries.some((e) => e.reasons.includes('daily')) ? 'open' : 'create note'}</span>
              </div>
              {entries.slice(0, maxItems).map(({ node, reasons }) => (
                <button
                  key={node.id} data-testid="calendar-entry" title={node.title}
                  onClick={(e) => { e.stopPropagation(); openNode(node, { paneId, newTab: e.ctrlKey || e.metaKey }); }}
                  className="flex min-w-0 items-center gap-1 rounded bg-bg-2 px-1.5 py-0.5 text-left text-[11.5px] text-fg hover:bg-bg-3"
                >
                  <span className="flex shrink-0 gap-0.5">{reasons.map((r) => <span key={r} className={clsx('h-1.5 w-1.5 rounded-full', REASON_DOT[r])} />)}</span>
                  <span className="shrink-0">{node.icon}</span><span className="truncate">{node.title}</span>
                </button>
              ))}
              {entries.length > maxItems && <span className="px-1 text-[11px] text-fg-faint">+{entries.length - maxItems} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

registerTabView('calendar', CalendarView);
