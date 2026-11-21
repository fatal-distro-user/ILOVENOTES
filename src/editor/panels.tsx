import { useLiveQuery } from 'dexie-react-hooks';
import { ListTree, Link2, Unlink } from 'lucide-react';
import { db } from '@/db/schema';
import { registerPanel } from '@/panels/registry';
import { useTabs } from '@/store/tabs';
import { useActiveEditor, useActivePageId } from './activeEditor';
import { useEditorHeadings, scrollToPos } from './nodes/Toc';
import { backlinksFor } from './links';

function OutlinePanel() {
  const pageId = useActivePageId();
  const { editor, pageId: edPage } = useActiveEditor();
  const ed = editor && edPage === pageId && !editor.isDestroyed ? editor : null;
  const headings = useEditorHeadings(ed);
  if (!ed) return <div className="p-3 text-fg-faint">Open a document page to see its outline.</div>;
  if (!headings.length) return <div className="p-3 text-fg-faint">No headings yet. Type <code>#</code> + space or use /Heading.</div>;
  const min = Math.min(...headings.map((h) => h.level));
  return (
    <div className="py-1" data-testid="outline-panel">
      {headings.map((h, i) => (
        <button key={i} onClick={() => scrollToPos(ed, h.pos)} className="block w-full truncate py-0.5 pr-2 text-left text-fg-muted hover:bg-bg-3 hover:text-fg"
          style={{ paddingLeft: 10 + (h.level - min) * 12, fontWeight: h.level === min ? 600 : 400 }}>
          {h.text || <em className="text-fg-faint">Untitled</em>}
        </button>
      ))}
    </div>
  );
}

function BacklinksPanel() {
  const pageId = useActivePageId();
  const node = useLiveQuery(() => (pageId ? db.nodes.get(pageId) : undefined), [pageId]);
  const links = useLiveQuery(() => (node ? backlinksFor(node) : []), [node?.id, node?.title, node?.updatedAt], []);
  const unlinked = useLiveQuery(async () => {
    if (!node || node.title.trim().length < 3) return [];
    const needle = node.title.trim().toLowerCase();
    const linkedIds = new Set(links.map((l) => l.page.id));
    const docs = await db.docs.filter((d) => d.pageId !== node.id && !linkedIds.has(d.pageId) && d.text.toLowerCase().includes(needle)).limit(20).toArray();
    const pages = await db.nodes.bulkGet(docs.map((d) => d.pageId));
    return pages.filter((p): p is NonNullable<typeof p> => !!p && !p.deletedAt && p.workspaceId === node.workspaceId);
  }, [node?.id, node?.title, links.length], []);
  const open = (id: string, title: string, e: React.MouseEvent) => useTabs.getState().openPage(id, title, { newTab: e.ctrlKey || e.metaKey });
  if (!node) return <div className="p-3 text-fg-faint">Open a page to see what links to it.</div>;
  return (
    <div className="py-1" data-testid="backlinks-panel">
      <div className="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-fg-faint uppercase">Linked ({links.length})</div>
      {links.length === 0 && <div className="px-3 pb-2 text-fg-faint">No backlinks yet.</div>}
      {links.map(({ page, snippet }) => (
        <button key={page.id} onClick={(e) => open(page.id, page.title, e)} className="block w-full px-2.5 py-1.5 text-left hover:bg-bg-3" data-testid="backlink">
          <div className="flex items-center gap-1.5 truncate font-medium"><span>{page.icon}</span>{page.title}</div>
          {snippet && <div className="line-clamp-2 text-[11px] text-fg-faint">{snippet}</div>}
        </button>
      ))}
      <div className="mt-1 flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-fg-faint uppercase"><Unlink size={11} />Unlinked mentions ({unlinked.length})</div>
      {unlinked.map((p) => (
        <button key={p.id} onClick={(e) => open(p.id, p.title, e)} className="block w-full truncate px-2.5 py-1 text-left text-fg-muted hover:bg-bg-3">{p.icon} {p.title}</button>
      ))}
    </div>
  );
}

registerPanel({ id: 'outline', title: 'Outline', icon: ListTree, defaultSide: 'right', component: OutlinePanel, defaultOrder: 10 });
registerPanel({ id: 'backlinks', title: 'Backlinks', icon: Link2, defaultSide: 'right', component: BacklinksPanel, defaultOrder: 20 });
