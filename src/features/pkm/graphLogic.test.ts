import { describe, expect, it } from 'vitest';
import { adjacency, buildGraph, buildLegend, colorOf, filterOrphans, matchesFilter, resolveLink, type GPage } from './graphLogic';

const pages: GPage[] = [
  { id: 'a', title: 'Alpha', notebookId: 'n1', tags: ['x', 'y'] },
  { id: 'b', title: 'Beta', notebookId: 'n1', tags: ['x'] },
  { id: 'c', title: 'Gamma', notebookId: 'n2', tags: [] },
  { id: 'd', title: 'Delta', notebookId: 'n2', tags: ['x'] },
];
const links = new Map([['a', ['id:b', 'beta', 'gamma', 'missing']], ['b', ['id:a']]]);

describe('buildGraph', () => {
  it('resolves id and title links, dedupes, drops unresolved', () => {
    const g = buildGraph(pages, links, { sharedTags: false, tagNodes: false });
    const keys = g.edges.map((e) => `${e.source}>${e.target}`).sort();
    expect(keys).toEqual(['a>b', 'a>c']);
    expect(g.nodes.find((n) => n.id === 'a')?.degree).toBe(2);
    expect(g.nodes.find((n) => n.id === 'd')?.degree).toBe(0);
  });
  it('adds shared-tag edges and tag nodes', () => {
    const g = buildGraph(pages, links, { sharedTags: true, tagNodes: false });
    expect(g.edges.filter((e) => e.kind === 'tag')).toHaveLength(3);
    const g2 = buildGraph(pages, links, { sharedTags: false, tagNodes: true });
    expect(g2.nodes.filter((n) => n.kind === 'tag').map((n) => n.id).sort()).toEqual(['tag:x', 'tag:y']);
    expect(g2.edges.filter((e) => e.kind === 'tagnode')).toHaveLength(4);
  });
  it('rings large tag groups instead of cliques', () => {
    const many: GPage[] = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, notebookId: 'n', tags: ['t'] }));
    const g = buildGraph(many, new Map(), { sharedTags: true, tagNodes: false });
    expect(g.edges).toHaveLength(12);
  });
  it('accepts embed edges', () => {
    const g = buildGraph(pages, new Map(), { sharedTags: false, tagNodes: false, embeds: [{ from: 'c', to: 'd' }, { from: 'c', to: 'zzz' }] });
    expect(g.edges).toEqual([{ source: 'c', target: 'd', kind: 'embed' }]);
  });
});

describe('filters', () => {
  const g = buildGraph(pages, links, { sharedTags: false, tagNodes: false });
  it('orphan modes', () => {
    expect(filterOrphans(g, 'show').nodes).toHaveLength(4);
    expect(filterOrphans(g, 'hide').nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(filterOrphans(g, 'only').nodes.map((n) => n.id)).toEqual(['d']);
    expect(filterOrphans(g, 'only').edges).toHaveLength(0);
  });
  it('text filter matches titles and tags', () => {
    expect(matchesFilter(g.nodes[0], 'alp')).toBe(true);
    expect(matchesFilter(g.nodes[0], '#y')).toBe(true);
    expect(matchesFilter(g.nodes[2], 'alp')).toBe(false);
    expect(matchesFilter(g.nodes[2], '')).toBe(true);
  });
  it('adjacency is symmetric', () => {
    const adj = adjacency(g);
    expect(adj.get('c')?.has('a')).toBe(true);
    expect(adj.get('a')?.has('c')).toBe(true);
  });
  it('resolveLink', () => {
    const ids = new Set(['a']);
    expect(resolveLink('id:a', ids, new Map())).toBe('a');
    expect(resolveLink('id:zz', ids, new Map())).toBeNull();
    expect(resolveLink('Alpha ', ids, new Map([['alpha', 'a']]))).toBe('a');
  });
});

describe('colours', () => {
  const nbs = new Map([['n1', { name: 'Work', color: '#112233' }]]);
  it('by notebook & tag', () => {
    const g = buildGraph(pages, links, { sharedTags: false, tagNodes: false });
    expect(colorOf(g.nodes[0], 'notebook', nbs)).toMatchObject({ key: 'nb:n1', color: '#112233', label: 'Work' });
    expect(colorOf(g.nodes[2], 'tag', nbs).key).toBe('untagged');
    const legend = buildLegend(g, 'tag', nbs);
    expect(legend.reduce((s, l) => s + l.count, 0)).toBe(4);
    expect(legend[0].count).toBe(3);
  });
});
