import { describe, it, expect } from 'vitest';
import { parseWikiLinks, parseTags, parseFlashcards, parseFootnotes, slugify, countWords } from './markup';

describe('markup parsers', () => {
  it('parses wiki-links with heading, alias and embeds', () => {
    const l = parseWikiLinks('See [[Page One]] and [[Two#Intro|the intro]] plus ![[Sketch]]');
    expect(l.map((x) => [x.target, x.heading, x.alias, x.embed])).toEqual([
      ['Page One', undefined, undefined, false], ['Two', 'Intro', 'the intro', false], ['Sketch', undefined, undefined, true],
    ]);
  });
  it('parses tags, ignoring numbers, anchors and urls', () => {
    expect(parseTags('#Work and #project/alpha, not#this or #123 but (#ok) https://x.y/#frag')).toEqual(['work', 'project/alpha', 'ok']);
  });
  it('parses flashcards', () => {
    const cards = parseFlashcards('- Capital of France :: Paris\nH2O ::: Water\nThe {{c1::mitochondria}} is the {{c2::powerhouse::role}} of the cell\nplain line');
    expect(cards.map((c) => c.kind)).toEqual(['basic', 'reversed', 'reversed', 'cloze', 'cloze']);
    expect(cards[0]).toMatchObject({ front: 'Capital of France', back: 'Paris' });
    expect(cards[3].front).toBe('The […] is the powerhouse of the cell');
    expect(cards[4].front).toBe('The mitochondria is the [role] of the cell');
    expect(cards[4].back).toContain('**powerhouse**');
    expect(new Set(cards.map((c) => c.key)).size).toBe(5);
  });
  it('parses footnotes, slugs, word counts', () => {
    expect(parseFootnotes('Text[^1] more[^a]\n[^1]: First note')).toEqual({ refs: ['1', 'a'], defs: { '1': 'First note' } });
    expect(slugify('Hello, World! Ünïcode')).toBe('hello-world-ünïcode');
    expect(countWords("It's a well-known fact — 42 times.")).toBe(6);
  });
});

