/** PKM views: command palette, graph, kanban, calendar, flashcards, templates, version history & time-lapse. */
import { Clock } from 'lucide-react';
import { registerCommands } from '@/commands/registry';
import { registerPanel } from '@/panels/registry';
import { registerGlobalOverlay } from '@/layout/overlays';
import { activeTab, useTabs } from '@/store/tabs';
import { db } from '@/db/schema';
import { toast } from '@/store/status';
import { PaletteOverlay, usePalette } from './Palette';
import { TimelapseOverlay, useTimelapse } from './Timelapse';
import { VersionsPanel, createCheckpoint } from './VersionsPanel';
import { startAutoSnapshots } from './snapshots';
import './GraphView';
import './KanbanView';
import './CalendarView';
import './FlashcardsView';
import './TemplatesView';

registerGlobalOverlay('pkm-palette', PaletteOverlay);
registerGlobalOverlay('pkm-timelapse', TimelapseOverlay);

const activePageId = (): string | null => { const t = activeTab(); return t?.kind === 'page' ? t.pageId ?? null : null; };
const openView = (kind: 'graph' | 'kanban' | 'calendar' | 'flashcards' | 'templates', title: string) => () => { useTabs.getState().open({ kind, title }); };

registerCommands([
  { id: 'palette.open', title: 'Open Command Palette', category: 'App', shortcut: 'Mod+K', allowInInput: true, keywords: ['search', 'quick open', 'go to'], run: () => usePalette.getState().toggle() },
  { id: 'view.graph', title: 'Open Knowledge Graph', category: 'View', shortcut: 'Mod+Shift+G', allowInInput: true, keywords: ['links', 'network', 'backlinks'], run: openView('graph', 'Graph') },
  { id: 'view.kanban', title: 'Open Kanban Board', category: 'View', keywords: ['board', 'tasks', 'status'], run: openView('kanban', 'Kanban') },
  { id: 'view.calendar', title: 'Open Calendar', category: 'View', keywords: ['daily notes', 'month', 'week'], run: openView('calendar', 'Calendar') },
  { id: 'view.flashcards', title: 'Open Flashcards', category: 'View', keywords: ['review', 'spaced repetition', 'srs', 'study'], run: openView('flashcards', 'Flashcards') },
  { id: 'templates.open', title: 'Open Template Library', category: 'File', keywords: ['new from template'], run: openView('templates', 'Templates') },
  {
    id: 'history.checkpoint', title: 'Create Version Checkpoint', category: 'History', shortcut: 'Mod+Alt+S', allowInInput: true, keywords: ['snapshot', 'save version'],
    when: () => !!activePageId(),
    run: async () => { const id = activePageId(); if (id) await createCheckpoint(id); },
  },
  {
    id: 'history.timelapse', title: 'Replay Drawing as Time-lapse', category: 'History', keywords: ['stroke replay', 'gif', 'webm'],
    when: () => !!activePageId(),
    run: async () => {
      const id = activePageId();
      if (!id) return;
      const n = await db.strokes.where('pageId').equals(id).filter((s) => !s.pdfId).count();
      if (!n) { toast('This page has no ink strokes to replay', 'info'); return; }
      useTimelapse.getState().open(id);
    },
  },
]);

registerPanel({ id: 'versions', title: 'Version history', icon: Clock, defaultSide: 'right', component: VersionsPanel, when: () => !!activePageId(), defaultOrder: 85 });

startAutoSnapshots();
