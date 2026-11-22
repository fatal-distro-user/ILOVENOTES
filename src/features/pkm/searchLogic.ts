/** Pure helpers for the command palette: query parsing, fuzzy ranking, snippets. */
import MiniSearch from 'minisearch';

export type PaletteMode = 'all' | 'commands' | 'tags' | 'headings';

export function parsePaletteQuery(raw: string): { mode: PaletteMode; term: string } {
  const s = raw.trimStart();
  if (s.startsWith('>')) return { mode: 'commands', term: s.slice(1).trim() };
  if (s.startsWith('#')) return { mode: 'tags', term: s.slice(1).trim() };
  if (s.startsWith('@')) return { mode: 'headings', term: s.slice(1).trim() };
  return { mode: 'all', term: s.trim() };
}

/**
 * Subsequence fuzzy score: 0 = no match. Higher is better. Rewards prefix matches, word starts and
 * consecutive characters; penalises gaps.
 */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return 1;
  const direct = t.indexOf(q);
  if (direct === 0) return 1000 - t.length * 0.1;
  if (direct > 0) return (/[\s\-_/:.]/.test(t[direct - 1]) ? 800 : 600) - direct * 0.5 - t.length * 0.1;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    const gap = found - ti;
    if (gap === 0) { streak++; score += 8 + streak * 4; } else { streak = 0; score += Math.max(1, 6 - gap); }
    if (found === 0 || /[\s\-_/:.]/.test(t[found - 1])) score += 10;
    ti = found + 1;
  }
  return Math.max(1, score - t.length * 0.05);
}

export function rankFuzzy<T>(items: T[], query: string, text: (item: T) => string, limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((it) => ({ it, s: fuzzyScore(text(it), query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.it);
}

export interface Snippet { before: string; match: string; after: string }

/** Context window around the first occurrence of any query word in text (case-insensitive). */
export function snippetAround(text: string, query: string, radius = 48): Snippet | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = flat.toLowerCase();
  let best = -1;
  let len = 0;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (best < 0 || i < best)) { best = i; len = w.length; }
  }
  if (best < 0) return null;
  const start = Math.max(0, best - radius);
  const end = Math.min(flat.length, best + len + radius);
  return {
    before: (start > 0 ? '…' : '') + flat.slice(start, best),
    match: flat.slice(best, best + len),
    after: flat.slice(best + len, end) + (end < flat.length ? '…' : ''),
  };
}

export interface IndexedPage { id: string; title: string; headings: string[]; tags: string[]; text: string; sig: string }

export interface PageHit { id: string; score: number }

/** Incrementally maintained MiniSearch index. */
export class PageIndex {
  private ms = new MiniSearch<{ id: string; title: string; headings: string; tags: string; text: string }>({
    fields: ['title', 'headings', 'tags', 'text'],
    storeFields: [],
    searchOptions: { boost: { title: 3, headings: 2, tags: 2, text: 1 }, fuzzy: 0.2, prefix: true, combineWith: 'AND' },
  });
  private sigs = new Map<string, string>();
  readonly pages = new Map<string, IndexedPage>();

  get size(): number { return this.sigs.size; }

  /** Apply the full current page set, only touching changed/removed pages. */
  sync(pages: IndexedPage[]): { added: number; removed: number } {
    const seen = new Set<string>();
    let added = 0;
    for (const p of pages) {
      seen.add(p.id);
      if (this.sigs.get(p.id) === p.sig) continue;
      const rec = { id: p.id, title: p.title, headings: p.headings.join('\n'), tags: p.tags.join(' '), text: p.text };
      if (this.sigs.has(p.id)) this.ms.replace(rec); else this.ms.add(rec);
      this.sigs.set(p.id, p.sig);
      this.pages.set(p.id, p);
      added++;
    }
    let removed = 0;
    for (const id of Array.from(this.sigs.keys())) {
      if (seen.has(id)) continue;
      this.ms.discard(id);
      this.sigs.delete(id);
      this.pages.delete(id);
      removed++;
    }
    return { added, removed };
  }

  search(query: string, limit = 30): PageHit[] {
    if (!query.trim()) return [];
    return this.ms.search(query).slice(0, limit).map((r) => ({ id: r.id as string, score: r.score }));
  }
}
