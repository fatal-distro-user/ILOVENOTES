import { describe, expect, it } from 'vitest';
import { PageIndex, fuzzyScore, parsePaletteQuery, rankFuzzy, snippetAround } from './searchLogic';

describe('parsePaletteQuery', () => {
  it('detects prefixes', () => {
    expect(parsePaletteQuery('>new page')).toEqual({ mode: 'commands', term: 'new page' });
    expect(parsePaletteQuery('  #todo')).toEqual({ mode: 'tags', term: 'todo' });
    expect(parsePaletteQuery('@intro')).toEqual({ mode: 'headings', term: 'intro' });
    expect(parsePaletteQuery('plain')).toEqual({ mode: 'all', term: 'plain' });
  });
});

describe('fuzzyScore', () => {
  it('ranks prefix > word start > subsequence > none', () => {
    const prefix = fuzzyScore('Open Settings', 'open');
    const word = fuzzyScore('Toggle Open', 'open');
    const sub = fuzzyScore('Open Settings', 'ops');
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(0);
    expect(fuzzyScore('abc', 'xyz')).toBe(0);
  });
  it('rankFuzzy orders and filters', () => {
    const out = rankFuzzy(['Daily Note', 'New Page', 'Delete'], 'dn', (s) => s);
    expect(out[0]).toBe('Daily Note');
    expect(out).not.toContain('New Page');
  });
});

describe('snippetAround', () => {
  it('returns context with the match', () => {
    const s = snippetAround('The quick brown fox jumps over the lazy dog', 'fox', 8);
    expect(s?.match).toBe('fox');
    expect(s?.before.startsWith('…')).toBe(true);
    expect(snippetAround('hello', 'zzz')).toBeNull();
  });
});

describe('PageIndex', () => {
  const mk = (id: string, title: string, text = '', tags: string[] = []) => ({ id, title, headings: [], tags, text, sig: `${id}:${title}:${text}` });
  it('finds fuzzy and prefix matches, boosts titles', () => {
    const ix = new PageIndex();
    ix.sync([mk('a', 'Quantum mechanics'), mk('b', 'Cooking', 'quantum of flavour')]);
    const hits = ix.search('quantm');
    expect(hits.map((h) => h.id)[0]).toBe('a');
    expect(ix.search('cook').map((h) => h.id)).toContain('b');
  });
  it('syncs incrementally', () => {
    const ix = new PageIndex();
    ix.sync([mk('a', 'Alpha'), mk('b', 'Beta')]);
    expect(ix.sync([mk('a', 'Alpha'), mk('b', 'Beta')])).toEqual({ added: 0, removed: 0 });
    expect(ix.sync([mk('a', 'Alpha 2')])).toEqual({ added: 1, removed: 1 });
    expect(ix.search('beta')).toHaveLength(0);
    expect(ix.search('alpha')).toHaveLength(1);
    expect(ix.size).toBe(1);
  });
});
