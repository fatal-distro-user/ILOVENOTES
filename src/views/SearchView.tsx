import { useEffect, useState } from 'react';
import { BookmarkPlus, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSavedSearches, useTags } from '@/db/hooks';
import * as repo from '@/db/repo';
import { useWorkspace } from '@/store/workspace';
import { toast } from '@/store/status';
import { useTabs } from '@/store/tabs';
import { promptDialog } from '@/ui/dialogs';
import { Button } from '@/ui/Modal';
import { openNode } from '@/layout/actions';
import { registerTabView, type TabViewProps } from './registry';

function SearchView({ tab, paneId }: TabViewProps) {
  const ws = useWorkspace((s) => s.workspaceId);
  const saved = useSavedSearches(ws);
  const allTags = useTags(ws);
  const savedId = tab.params?.savedId;
  const [query, setQuery] = useState(tab.params?.q ?? '');
  const [tags, setTags] = useState<string[]>(tab.params?.tags ? tab.params.tags.split(',').filter(Boolean) : []);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Load a saved search into the form once it is available.
  useEffect(() => {
    if (!savedId || loadedFor === savedId) return;
    const s = saved.find((x) => x.id === savedId);
    if (s) { setQuery(s.query); setTags(s.tags); setLoadedFor(savedId); }
  }, [savedId, saved, loadedFor]);

  const results = useLiveQuery(() => (ws ? repo.runSavedSearch(ws, query, tags) : []), [ws, query, tags.join('\u0000')], []);
  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const visibleTags = Array.from(new Set([...allTags.map(([t]) => t), ...tags]));

  const save = async () => {
    if (!ws) return;
    const name = await promptDialog('Save this search as', query.trim() || tags.map((t) => `#${t}`).join(' ') || 'My search');
    if (!name) return;
    const s = await repo.createSavedSearch(ws, name, query, tags);
    useTabs.getState().open({ kind: 'search', title: s.name, params: { savedId: s.id } }, { paneId });
    toast(`Saved search "${name}"`, 'ok');
  };

  return (
    <div className="flex h-full flex-col" data-testid="search-view">
      <div className="shrink-0 space-y-2 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-line bg-bg-2 px-2 focus-within:border-accent">
            <Search size={14} className="text-fg-faint" />
            <input
              autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles and page text…"
              data-testid="search-input" className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
            />
            {query && <button aria-label="Clear query" onClick={() => setQuery('')} className="text-fg-faint hover:text-fg"><X size={13} /></button>}
          </div>
          <Button onClick={() => void save()} data-testid="save-search"><BookmarkPlus size={14} />Save this search</Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {visibleTags.length === 0 && <span className="text-[12px] text-fg-faint">No tags in this workspace yet.</span>}
          {visibleTags.map((t) => (
            <button key={t} onClick={() => toggleTag(t)} aria-pressed={tags.includes(t)} className={clsx('h-5 rounded-full px-2 text-[11.5px]', tags.includes(t) ? 'bg-accent text-accent-fg' : 'bg-bg-3 text-fg-muted hover:text-fg')}>#{t}</button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-fg-faint" data-testid="search-count">{results.length} result{results.length === 1 ? '' : 's'}</div>
        {results.map((n) => (
          <button key={n.id} onClick={(e) => openNode(n, { paneId, newTab: e.ctrlKey || e.metaKey })} data-testid="search-result" className="flex h-8 w-full items-center gap-2 rounded px-2 text-left hover:bg-bg-2">
            <span className="w-5 text-center">{n.icon}</span>
            <span className="min-w-0 flex-1 truncate">{n.title}</span>
            {n.tags.slice(0, 4).map((t) => <span key={t} className="rounded bg-bg-3 px-1.5 text-[11px] text-fg-muted">#{t}</span>)}
          </button>
        ))}
        {results.length === 0 && <div className="p-6 text-center text-fg-faint">No matching pages.</div>}
      </div>
    </div>
  );
}

registerTabView('search', SearchView);
