import { describe, expect, it } from 'vitest';
import { NEW_CARD, review } from '@/lib/srs';
import { buildCards, deckKey, deckStats, formatDue, inDeck, inlineTokens, parseDeck, sessionQueue } from './flashLogic';

const pages = [
  { id: 'p1', title: 'Geo', notebookId: 'n1', tags: ['geo'], text: 'Capital of France :: Paris\nThe {{c1::Nile}} is long\nplain line' },
  { id: 'p2', title: 'Lang', notebookId: 'n2', tags: [], text: 'hola ::: hello\nCapital of France :: Paris' },
];

describe('buildCards', () => {
  const cards = buildCards(pages);
  it('extracts cards with page-scoped ids', () => {
    expect(cards).toHaveLength(5); // 1 basic + 1 cloze + 2 reversed + 1 basic
    expect(new Set(cards.map((c) => c.id)).size).toBe(5);
    expect(cards.filter((c) => c.pageId === 'p1').map((c) => c.kind)).toEqual(['basic', 'cloze']);
  });
  it('decks filter', () => {
    expect(cards.filter((c) => inDeck(c, { kind: 'notebook', id: 'n2' }))).toHaveLength(3);
    expect(cards.filter((c) => inDeck(c, { kind: 'tag', id: 'geo' }))).toHaveLength(2);
    expect(parseDeck(deckKey({ kind: 'tag', id: 'a:b' }))).toEqual({ kind: 'tag', id: 'a:b' });
    expect(parseDeck('all')).toEqual({ kind: 'all' });
  });
});

describe('stats & queue', () => {
  const cards = buildCards(pages);
  const now = 1_000_000_000_000;
  it('counts new, due, learned, retention', () => {
    const good = review(NEW_CARD, 'good', now);
    const lapsed = review(review(NEW_CARD, 'good', now), 'again', now);
    const states = new Map([[cards[0].id, good], [cards[1].id, lapsed]]);
    const s = deckStats(cards, states, now);
    expect(s.total).toBe(5);
    expect(s.new).toBe(3);
    expect(s.learned).toBe(1);
    expect(s.due).toBe(3); // 3 new; the lapsed card is due again only in 10 minutes
    expect(deckStats(cards, states, now + 11 * 60_000).due).toBe(4);
    expect(s.retention).toBeCloseTo(1 / 2);
    expect(deckStats(cards, new Map(), now).retention).toBeNull();
  });
  it('queues overdue first then new', () => {
    const old = { ...NEW_CARD, reps: 2, interval: 1, due: now - 5000 };
    const older = { ...NEW_CARD, reps: 2, interval: 1, due: now - 9000 };
    const q = sessionQueue(cards, new Map([[cards[2].id, old], [cards[3].id, older], [cards[4].id, { ...old, due: now + 99999 }]]), now);
    expect(q.slice(0, 2).map((c) => c.id)).toEqual([cards[3].id, cards[2].id]);
    expect(q).toHaveLength(4);
    expect(q.map((c) => c.id)).not.toContain(cards[4].id);
    expect(sessionQueue(cards, new Map(), now, 2)).toHaveLength(2);
  });
  it('formatDue', () => {
    expect(formatDue(undefined)).toBe('New');
    expect(formatDue({ ...NEW_CARD, due: 5 }, 10)).toBe('Due');
    expect(formatDue({ ...NEW_CARD, due: 10 + 3 * 86_400_000 }, 10)).toBe('in 3d');
  });
});

describe('inlineTokens', () => {
  it('tokenises bold, code, italic without html', () => {
    expect(inlineTokens('a **b** `c` *d* e')).toEqual([
      { t: 'text', s: 'a ' }, { t: 'bold', s: 'b' }, { t: 'text', s: ' ' }, { t: 'code', s: 'c' }, { t: 'text', s: ' ' }, { t: 'italic', s: 'd' }, { t: 'text', s: ' e' },
    ]);
    expect(inlineTokens('<img src=x onerror=alert(1)>')).toEqual([{ t: 'text', s: '<img src=x onerror=alert(1)>' }]);
  });
});
