/** Pure flashcard helpers: card extraction, decks, stats, session queue, inline markdown tokens. */
import { parseFlashcards } from '@/lib/markup';
import { isDue, type SrsState } from '@/lib/srs';

export interface PageSource { id: string; title: string; notebookId: string; tags: string[]; text: string }
export interface DeckCard {
  id: string; pageId: string; title: string; notebookId: string; tags: string[];
  kind: 'basic' | 'reversed' | 'cloze'; front: string; back: string;
}
export type Deck = { kind: 'all' } | { kind: 'notebook'; id: string } | { kind: 'tag'; id: string };

export function buildCards(pages: PageSource[]): DeckCard[] {
  const out: DeckCard[] = [];
  for (const p of pages) {
    const seen = new Set<string>();
    for (const c of parseFlashcards(p.text)) {
      const id = `${p.id}:${c.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, pageId: p.id, title: p.title, notebookId: p.notebookId, tags: p.tags, kind: c.kind, front: c.front, back: c.back });
    }
  }
  return out;
}

export function deckKey(d: Deck): string { return d.kind === 'all' ? 'all' : `${d.kind}:${d.id}`; }
export function parseDeck(k: string): Deck {
  if (k.startsWith('notebook:')) return { kind: 'notebook', id: k.slice(9) };
  if (k.startsWith('tag:')) return { kind: 'tag', id: k.slice(4) };
  return { kind: 'all' };
}

export function inDeck(c: DeckCard, d: Deck): boolean {
  if (d.kind === 'all') return true;
  if (d.kind === 'notebook') return c.notebookId === d.id;
  return c.tags.includes(d.id);
}

export interface DeckStats { total: number; due: number; new: number; learned: number; retention: number | null }

/** `due` counts every card reviewable right now, including never-seen (new) cards. */
export function deckStats(cards: DeckCard[], states: Map<string, SrsState>, now = Date.now()): DeckStats {
  let due = 0, fresh = 0, learned = 0, reps = 0, lapses = 0;
  for (const c of cards) {
    const s = states.get(c.id);
    if (!s) { fresh++; due++; continue; }
    if (isDue(s, now)) due++;
    if (s.reps > 0) learned++;
    reps += s.reps; lapses += s.lapses;
  }
  const attempts = reps + lapses;
  return { total: cards.length, due, new: fresh, learned, retention: attempts ? reps / attempts : null };
}

/** Review queue: overdue cards (most overdue first) then new cards in source order. */
export function sessionQueue(cards: DeckCard[], states: Map<string, SrsState>, now = Date.now(), limit = 200): DeckCard[] {
  const due: { c: DeckCard; at: number }[] = [];
  const fresh: DeckCard[] = [];
  for (const c of cards) {
    const s = states.get(c.id);
    if (!s) fresh.push(c);
    else if (isDue(s, now)) due.push({ c, at: s.due });
  }
  due.sort((a, b) => a.at - b.at);
  return [...due.map((d) => d.c), ...fresh].slice(0, limit);
}

export type InlineToken = { t: 'text' | 'bold' | 'italic' | 'code'; s: string };

/** Tokenise bold, italic (asterisk or underscore) and code spans. Output is plain strings; callers render them as text nodes. */
export function inlineTokens(src: string): InlineToken[] {
  const out: InlineToken[] = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(?<![\w])_([^_\n]+)_(?![\w])/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: 'text', s: src.slice(last, i) });
    if (m[1] !== undefined) out.push({ t: 'code', s: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'bold', s: m[2] });
    else out.push({ t: 'italic', s: m[3] ?? m[4] });
    last = i + m[0].length;
  }
  if (last < src.length) out.push({ t: 'text', s: src.slice(last) });
  return out;
}

export function formatDue(s: SrsState | undefined, now = Date.now()): string {
  if (!s) return 'New';
  if (s.due <= now) return 'Due';
  const d = Math.ceil((s.due - now) / 86_400_000);
  return d <= 1 ? 'Tomorrow' : `in ${d}d`;
}
