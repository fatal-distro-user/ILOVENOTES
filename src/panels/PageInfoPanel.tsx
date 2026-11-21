import { Info, Star } from 'lucide-react';
import { useNode } from '@/db/hooks';
import { toggleStar } from '@/db/repo';
import { registerPanel } from './registry';
import { useStatus } from '@/store/status';
import { useTabs, activeTab } from '@/store/tabs';

const fmt = (t: number) => (t ? new Date(t).toLocaleString() : '—');

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-fg">{children}</dd>
    </div>
  );
}

function PageInfoPanel() {
  const pageId = useTabs((s) => {
    const p = s.panes.find((x) => x.id === s.focusedPaneId);
    const t = p?.tabs.find((x) => x.id === p.activeTabId);
    return t?.kind === 'page' ? t.pageId : undefined;
  });
  const node = useNode(pageId);
  const words = useStatus((s) => s.words);
  const chars = useStatus((s) => s.chars);
  if (!pageId || !node) return <div className="p-3 text-fg-faint" data-testid="page-info-empty">Open a page to see its details.</div>;
  return (
    <dl className="p-3 text-[12px]" data-testid="page-info">
      <Row label="Title"><span className="break-words">{node.icon} {node.title}</span></Row>
      <Row label="Mode"><span className="capitalize">{node.mode}</span></Row>
      <Row label="Created">{fmt(node.createdAt)}</Row>
      <Row label="Updated">{fmt(node.updatedAt)}</Row>
      <Row label="Words">{words ?? '—'}</Row>
      <Row label="Characters">{chars ?? '—'}</Row>
      <Row label="Tags">
        {node.tags.length ? <span className="flex flex-wrap justify-end gap-1">{node.tags.map((t) => <span key={t} className="rounded bg-bg-3 px-1.5 text-[11px] text-fg-muted">#{t}</span>)}</span> : <span className="text-fg-faint">None</span>}
      </Row>
      <Row label="Starred">
        <button
          onClick={() => void toggleStar(node.id)}
          className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
          title={node.starred ? 'Unstar' : 'Star'}
          data-testid="page-info-star"
        >
          <Star size={14} className={node.starred ? 'fill-warn text-warn' : ''} />{node.starred ? 'Starred' : 'Star'}
        </button>
      </Row>
    </dl>
  );
}

registerPanel({ id: 'page-info', title: 'Page Info', icon: Info, defaultSide: 'right', component: PageInfoPanel, defaultOrder: 90, when: () => activeTab()?.kind === 'page' });
