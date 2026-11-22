/** Pure knowledge-graph construction & filtering. */

export interface GPage { id: string; title: string; notebookId: string; tags: string[] }
export interface GNode { id: string; label: string; kind: 'page' | 'tag'; notebookId: string; tags: string[]; degree: number }
export type EdgeKind = 'link' | 'embed' | 'tag' | 'tagnode';
export interface GEdge { source: string; target: string; kind: EdgeKind }
export interface Graph { nodes: GNode[]; edges: GEdge[] }
export type OrphanMode = 'show' | 'hide' | 'only';
export type ColorMode = 'notebook' | 'tag';

export interface BuildOptions {
  sharedTags: boolean;
  tagNodes: boolean;
  /** extra directed relations (e.g. canvas embed objects): page id -> page id */
  embeds?: { from: string; to: string }[];
  /** doc.links entries that came from embeds (`![[x]]` is indistinguishable in links[], so callers may pass keys) */
}

/** Resolve a stored link ("id:<pageId>" or a lower-cased title) to a page id. */
export function resolveLink(link: string, byId: Set<string>, byTitle: Map<string, string>): string | null {
  if (link.startsWith('id:')) { const id = link.slice(3); return byId.has(id) ? id : null; }
  return byTitle.get(link.trim().toLowerCase()) ?? null;
}

const MAX_CLIQUE = 8;

export function buildGraph(pages: GPage[], links: Map<string, string[]>, opts: BuildOptions): Graph {
  const byId = new Set(pages.map((p) => p.id));
  const byTitle = new Map<string, string>();
  for (const p of pages) { const k = p.title.trim().toLowerCase(); if (k && !byTitle.has(k)) byTitle.set(k, p.id); }
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, kind: EdgeKind) => {
    if (a === b) return;
    const key = `${kind}|${a < b ? a : b}|${a < b ? b : a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source: a, target: b, kind });
  };
  for (const p of pages) {
    for (const l of links.get(p.id) ?? []) {
      const t = resolveLink(l, byId, byTitle);
      if (t) add(p.id, t, 'link');
    }
  }
  for (const e of opts.embeds ?? []) if (byId.has(e.from) && byId.has(e.to)) add(e.from, e.to, 'embed');

  const byTag = new Map<string, string[]>();
  for (const p of pages) for (const t of p.tags) { const l = byTag.get(t) ?? []; l.push(p.id); byTag.set(t, l); }

  const nodes: GNode[] = pages.map((p) => ({ id: p.id, label: p.title || 'Untitled', kind: 'page', notebookId: p.notebookId, tags: p.tags, degree: 0 }));

  if (opts.sharedTags) {
    for (const ids of byTag.values()) {
      if (ids.length < 2) continue;
      if (ids.length <= MAX_CLIQUE) {
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j], 'tag');
      } else {
        for (let i = 0; i < ids.length; i++) add(ids[i], ids[(i + 1) % ids.length], 'tag');
      }
    }
  }
  if (opts.tagNodes) {
    for (const [tag, ids] of byTag) {
      const id = `tag:${tag}`;
      nodes.push({ id, label: `#${tag}`, kind: 'tag', notebookId: '', tags: [tag], degree: 0 });
      for (const pid of ids) add(pid, id, 'tagnode');
    }
  }
  const deg = new Map<string, number>();
  for (const e of edges) { deg.set(e.source, (deg.get(e.source) ?? 0) + 1); deg.set(e.target, (deg.get(e.target) ?? 0) + 1); }
  for (const n of nodes) n.degree = deg.get(n.id) ?? 0;
  return { nodes, edges };
}

/** Orphans are page nodes with no edges at all in the current graph. */
export function filterOrphans(g: Graph, mode: OrphanMode): Graph {
  if (mode === 'show') return g;
  const keep = new Set(g.nodes.filter((n) => (mode === 'hide' ? n.degree > 0 : n.kind === 'page' && n.degree === 0)).map((n) => n.id));
  return { nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}

export function matchesFilter(n: GNode, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  return !f || n.label.toLowerCase().includes(f) || n.tags.some((t) => t.includes(f.replace(/^#/, '')));
}

export function adjacency(g: Graph): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const n of g.nodes) m.set(n.id, new Set());
  for (const e of g.edges) { m.get(e.source)?.add(e.target); m.get(e.target)?.add(e.source); }
  return m;
}

export const GRAPH_PALETTE = ['#7c5cff', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7'];

function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}

export interface ColorInfo { key: string; label: string; color: string }

/** Group key & colour for a node under the given colour mode. */
export function colorOf(n: GNode, mode: ColorMode, notebooks: Map<string, { name: string; color: string }>): ColorInfo {
  if (n.kind === 'tag') return { key: 'tag-node', label: 'Tag', color: '#94a3b8' };
  if (mode === 'notebook') {
    const nb = notebooks.get(n.notebookId);
    const label = nb?.name ?? 'Notebook';
    return { key: `nb:${n.notebookId}`, label, color: nb?.color && /^#/.test(nb.color) ? nb.color : GRAPH_PALETTE[hashIndex(n.notebookId, GRAPH_PALETTE.length)] };
  }
  const t = n.tags[0];
  if (!t) return { key: 'untagged', label: 'Untagged', color: '#64748b' };
  return { key: `t:${t}`, label: `#${t}`, color: GRAPH_PALETTE[hashIndex(t, GRAPH_PALETTE.length)] };
}

export function buildLegend(g: Graph, mode: ColorMode, notebooks: Map<string, { name: string; color: string }>): (ColorInfo & { count: number })[] {
  const m = new Map<string, ColorInfo & { count: number }>();
  for (const n of g.nodes) {
    const c = colorOf(n, mode, notebooks);
    const cur = m.get(c.key);
    if (cur) cur.count++; else m.set(c.key, { ...c, count: 1 });
  }
  return Array.from(m.values()).sort((a, b) => b.count - a.count);
}

export function nodeRadius(n: GNode): number {
  return n.kind === 'tag' ? 4 + Math.sqrt(n.degree) * 1.6 : 5 + Math.sqrt(n.degree) * 2.4;
}

/** Stable signature of structure so the simulation only restarts when topology changes. */
export function graphSignature(g: Graph): string {
  return `${g.nodes.map((n) => `${n.id}:${n.label}`).join('|')}#${g.edges.map((e) => `${e.source}>${e.target}:${e.kind}`).join('|')}`;
}
