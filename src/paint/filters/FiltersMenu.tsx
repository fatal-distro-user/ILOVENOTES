import { useState } from 'react';
import { create } from 'zustand';
import { Wand2 } from 'lucide-react';
import { Popover } from '@/ui/Popover';
import { registerCommands } from '@/commands/registry';
import { activeTab } from '@/store/tabs';
import type { PaintDocument } from '../engine/document';
import { FILTER_LABELS, type FilterId } from './kernels';
import { FilterDialog } from './FilterDialog';

export const useFilterDialog = create<{ filter: FilterId | null; open(f: FilterId | null): void }>()((set) => ({ filter: null, open: (filter) => set({ filter }) }));

const GROUPS: { title: string; items: FilterId[] }[] = [
  { title: 'Adjust', items: ['hsl', 'brightness-contrast', 'curves', 'levels', 'color-balance', 'threshold', 'invert'] },
  { title: 'Blur & sharpen', items: ['gaussian-blur', 'motion-blur', 'sharpen'] },
  { title: 'Stylize', items: ['pixelate', 'halftone', 'chromatic-aberration', 'noise'] },
];

export function FiltersMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = useFilterDialog((s) => s.open);
  return (
    <>
      <button className="flex h-7 items-center gap-1 rounded px-2 text-fg-muted hover:bg-bg-3" onClick={(e) => setAnchor(e.currentTarget)} data-testid="filters-menu"><Wand2 size={13} />Filters</button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end">
          <div className="flex w-56 flex-col p-1">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-fg-faint uppercase">{g.title}</div>
                {g.items.map((f) => <button key={f} className="w-full rounded px-2 py-1 text-left hover:bg-bg-3" data-testid={`filter-${f}`} onClick={() => { open(f); setAnchor(null); }}>{FILTER_LABELS[f]}…</button>)}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

export function FilterDialogHost({ doc }: { doc: PaintDocument }) {
  const { filter, open } = useFilterDialog();
  if (!filter) return null;
  return <FilterDialog key={filter} doc={doc} filter={filter} onClose={() => open(null)} />;
}

registerCommands((Object.keys(FILTER_LABELS) as FilterId[]).map((f) => ({
  id: `paint.filter.${f}`, title: `Filter: ${FILTER_LABELS[f]}…`, category: 'Filters', when: () => activeTab()?.kind === 'paint',
  run: () => useFilterDialog.getState().open(f),
})));
