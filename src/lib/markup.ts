/** Inline syntax parsers shared by the editor, indexer, graph and flashcards. */

export interface WikiLink { raw: string; target: string; heading?: string; alias?: string; embed: boolean; index: number }

const WIKI_RE = /(!?)\[\[([^\]\n|#]+)(?:#([^\]\n|]+))?(?:\|([^\]\n]+))?\]\]/g;

export function parseWikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of text.matchAll(WIKI_RE)) {
    out.push({ raw: m[0], embed: m[1] === '!', target: m[2].trim(), heading: m[3]?.trim(), alias: m[4]?.trim(), index: m.index ?? 0 });
  }
  return out;
}

/** #tags: letters, digits, -, _, / (nested tags). Must start after whitespace/start and contain a non-digit. */
const TAG_RE = /(^|[\s([{,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

export function parseTags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) out.add(m[2].replace(/\/+$/, '').toLowerCase());
  return Array.from(out).filter(Boolean);
}

export interface Flashcard {
  /** stable id within a page: hash of the card source */
  key: string;
  kind: 'basic' | 'reversed' | 'cloze';
  front: string;
  back: string;
  /** cloze number for cloze cards */
  cloze?: number;
  source: string;
}

/** Small stable string hash (FNV-1a, base36). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const CLOZE_RE = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g;

/**
 * Flashcard syntax, one card per line:
 *   Question :: Answer        basic card
 *   Question ::: Answer       reversed card (both directions)
 *   Text with {{c1::cloze}} and {{c2::another::hint}}  one card per cloze number
 */
export function parseFlashcards(text: string): Flashcard[] {
  const cards: Flashcard[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*+]\s+|^\d+\.\s+/, '');
    if (!line) continue;
    const clozes = Array.from(line.matchAll(CLOZE_RE));
    if (clozes.length) {
      const nums = Array.from(new Set(clozes.map((m) => +m[1]))).sort((a, b) => a - b);
      for (const n of nums) {
        const front = line.replace(CLOZE_RE, (_all, num: string, ans: string, hint?: string) => (+num === n ? `[${hint ?? '…'}]` : ans));
        const back = line.replace(CLOZE_RE, (_all, num: string, ans: string) => (+num === n ? `**${ans}**` : ans));
        cards.push({ key: hashString(`cloze:${n}:${line}`), kind: 'cloze', front, back, cloze: n, source: line });
      }
      continue;
    }
    const rev = line.split(/\s:::\s/);
    if (rev.length === 2 && rev[0].trim() && rev[1].trim()) {
      cards.push({ key: hashString(`rev:${line}`), kind: 'reversed', front: rev[0].trim(), back: rev[1].trim(), source: line });
      cards.push({ key: hashString(`rev2:${line}`), kind: 'reversed', front: rev[1].trim(), back: rev[0].trim(), source: line });
      continue;
    }
    const basic = line.split(/\s::\s/);
    if (basic.length === 2 && basic[0].trim() && basic[1].trim()) {
      cards.push({ key: hashString(`basic:${line}`), kind: 'basic', front: basic[0].trim(), back: basic[1].trim(), source: line });
    }
  }
  return cards;
}

/** Footnote references [^id] and definitions "[^id]: text". */
export function parseFootnotes(text: string): { refs: string[]; defs: Record<string, string> } {
  const defs: Record<string, string> = {};
  for (const m of text.matchAll(/^\[\^([^\]]+)\]:\s*(.+)$/gm)) defs[m[1]] = m[2];
  const refs = Array.from(text.matchAll(/\[\^([^\]]+)\](?!:)/g)).map((m) => m[1]);
  return { refs, defs };
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}'’-]+/gu);
  return m ? m.length : 0;
}
