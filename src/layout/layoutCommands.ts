import { registerCommands } from '@/commands/registry';
import { THEMES, useLayout } from '@/store/layout';
import { useTabs } from '@/store/tabs';
import { toggleFullscreen } from '@/platform/fileio';
import { toast } from '@/store/status';
import { newNode, openDaily, openSearch, openSettings, openTrash } from './actions';

function closeActiveTab() {
  const s = useTabs.getState();
  const pane = s.panes.find((p) => p.id === s.focusedPaneId);
  const tab = pane?.tabs.find((t) => t.id === pane.activeTabId);
  if (pane && tab && !tab.pinned) s.close(pane.id, tab.id);
}

registerCommands([
  { id: 'view.toggleLeft', title: 'Toggle Explorer Sidebar', category: 'View', shortcut: 'Mod+\\', run: () => useLayout.getState().toggleLeft() },
  { id: 'view.toggleRight', title: 'Toggle Right Dock', category: 'View', shortcut: 'Mod+Alt+\\', run: () => useLayout.getState().toggleRight() },
  { id: 'view.zen', title: 'Toggle Zen / Focus Mode', category: 'View', shortcut: 'Mod+Shift+F', allowInInput: true, keywords: ['focus', 'distraction'], run: () => useLayout.getState().toggleZen() },
  {
    id: 'view.zenFullscreen', title: 'Toggle Zen Mode and Fullscreen', category: 'View', shortcut: 'F11', allowInInput: true,
    run: async () => {
      useLayout.getState().toggleZen();
      try { await toggleFullscreen(); } catch (e) { toast(e instanceof Error ? e.message : 'Fullscreen is not available', 'error'); }
    },
  },
  { id: 'view.scratchpad', title: 'Toggle Scratchpad', category: 'View', shortcut: 'Mod+Shift+Space', allowInInput: true, keywords: ['notes', 'quick'], run: () => useLayout.getState().toggleScratchpad() },
  { id: 'pane.splitVertical', title: 'Split Pane Right', category: 'View', shortcut: 'Mod+Alt+V', run: () => useTabs.getState().setSplit('vertical') },
  { id: 'pane.splitHorizontal', title: 'Split Pane Down', category: 'View', shortcut: 'Mod+Alt+H', run: () => useTabs.getState().setSplit('horizontal') },
  { id: 'pane.unsplit', title: 'Merge Split Panes', category: 'View', shortcut: 'Mod+Alt+U', run: () => useTabs.getState().setSplit('none') },
  { id: 'tab.close', title: 'Close Tab', category: 'Tabs', shortcut: 'Mod+W', allowInInput: true, run: closeActiveTab },
  { id: 'tab.next', title: 'Next Tab', category: 'Tabs', shortcut: ['Ctrl+Tab', 'Mod+Alt+Right'], allowInInput: true, run: () => useTabs.getState().cycleTab(1) },
  { id: 'tab.prev', title: 'Previous Tab', category: 'Tabs', shortcut: ['Ctrl+Shift+Tab', 'Mod+Alt+Left'], allowInInput: true, run: () => useTabs.getState().cycleTab(-1) },
  { id: 'page.new', title: 'New Page', category: 'File', shortcut: 'Mod+N', allowInInput: true, run: async () => { await newNode(); } },
  { id: 'page.newCanvas', title: 'New Canvas Page', category: 'File', shortcut: 'Mod+Shift+N', allowInInput: true, run: async () => { await newNode({ mode: 'canvas', title: 'Untitled Canvas' }); } },
  { id: 'daily.open', title: 'Open Daily Note', category: 'File', shortcut: 'Mod+Shift+D', allowInInput: true, run: () => openDaily() },
  { id: 'app.settings', title: 'Open Settings', category: 'App', shortcut: 'Mod+,', run: () => openSettings() },
  { id: 'search.open', title: 'Open Search', category: 'App', run: () => openSearch() },
  {
    id: 'theme.cycle', title: 'Cycle Theme', category: 'View',
    run: () => {
      const l = useLayout.getState();
      const i = THEMES.findIndex((t) => t.id === l.theme);
      l.setTheme(THEMES[(i + 1) % THEMES.length].id);
    },
  },
  { id: 'trash.open', title: 'Open Trash', category: 'App', run: () => openTrash() },
]);
