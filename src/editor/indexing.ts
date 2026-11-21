/** Derives searchable/indexable data from a TipTap JSON document. */
import { docToText, docHeadings, type PMNode } from '@/export/markdown';
import { parseTags, parseWikiLinks } from '@/lib/markup';

export interface DocIndex { text: string; links: string[]; tags: string[]; headings: string[] }

/** Collect wikiLink targets: both "id:<pageId>" (stable) and the lower-cased title (fallback/unresolved). */
export function collectLinks(doc: PMNode): string[] {
  const out = new Set<string>();
  const walk = (n: PMNode) => {
    if (n.type === 'wikiLink' || n.type === 'wikiEmbed') {
      const target = String(n.attrs?.target ?? '').trim();
      if (target) out.add(target.toLowerCase());
      if (n.attrs?.pageId) out.add(`id:${String(n.attrs.pageId)}`);
    }
    if (n.type === 'text' && n.text) for (const l of parseWikiLinks(n.text)) out.add(l.target.toLowerCase());
    n.content?.forEach(walk);
  };
  walk(doc);
  return Array.from(out);
}

export function indexDoc(doc: PMNode): DocIndex {
  const text = docToText(doc);
  return { text, links: collectLinks(doc), tags: parseTags(text), headings: docHeadings(doc).map((h) => h.text) };
}

export const EMPTY_DOC: PMNode = { type: 'doc', content: [{ type: 'paragraph' }] };
