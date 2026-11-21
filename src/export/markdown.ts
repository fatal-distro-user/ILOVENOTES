/**
 * ProseMirror/TipTap JSON → Markdown serializer for the ILOVENOTES block schema.
 * Node names match src/editor/schema (paragraph, heading, callout, toggle, mathBlock, wikiLink, sketch, ...).
 */

export interface PMMark { type: string; attrs?: Record<string, unknown> }
export interface PMNode { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: PMMark[] }

export interface MarkdownOptions {
  /** Resolve a sketch/paint frame id to an image path or data URL for export. */
  sketchSrc?: (id: string) => string | undefined;
}

/** Footnotes encountered during the current serialisation, in order. */
let footnoteCtx = new Map<string, { n: number; note: string }>();

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));

function escapeText(t: string): string {
  return t.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/gm, '$1\\$2$3');
}

function inline(nodes: PMNode[] | undefined): string {
  if (!nodes) return '';
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') {
      let t = n.text ?? '';
      const marks = n.marks ?? [];
      const isCode = marks.some((m) => m.type === 'code');
      t = isCode ? '`' + t.replace(/`/g, '\u200b`') + '`' : escapeText(t);
      for (const m of marks) {
        switch (m.type) {
          case 'bold': t = `**${t}**`; break;
          case 'italic': t = `*${t}*`; break;
          case 'strike': t = `~~${t}~~`; break;
          case 'underline': t = `<u>${t}</u>`; break;
          case 'highlight': t = `==${t}==`; break;
          case 'subscript': t = `<sub>${t}</sub>`; break;
          case 'superscript': t = `<sup>${t}</sup>`; break;
          case 'link': t = `[${t}](${str(m.attrs?.href)})`; break;
        }
      }
      out += t;
    } else if (n.type === 'hardBreak') out += '  \n';
    else if (n.type === 'wikiLink') {
      const target = str(n.attrs?.target), alias = str(n.attrs?.alias), heading = str(n.attrs?.heading);
      out += `[[${target}${heading ? '#' + heading : ''}${alias ? '|' + alias : ''}]]`;
    } else if (n.type === 'mathInline') out += `$${str(n.attrs?.latex)}$`;
    else if (n.type === 'tag') out += `#${str(n.attrs?.name)}`;
    else if (n.type === 'footnoteRef') {
      const id = str(n.attrs?.id);
      if (!footnoteCtx.has(id)) footnoteCtx.set(id, { n: footnoteCtx.size + 1, note: str(n.attrs?.note) });
      out += `[^${footnoteCtx.get(id)!.n}]`;
    }
    else if (n.type === 'wikiEmbed') out += `![[${str(n.attrs?.target)}]]`;
    else if (n.type === 'image') out += `![${str(n.attrs?.alt)}](${str(n.attrs?.src)})`;
    else if (n.content) out += inline(n.content);
  }
  return out;
}

function indent(text: string, prefix: string, first = prefix): string {
  return text.split('\n').map((l, i) => (i === 0 ? first : l ? prefix : '') + l).join('\n');
}

function block(n: PMNode, opts: MarkdownOptions, ordinal?: number): string {
  const kids = n.content ?? [];
  switch (n.type) {
    case 'doc': return blocks(kids, opts);
    case 'paragraph': return inline(kids);
    case 'heading': return `${'#'.repeat(Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1))))} ${inline(kids)}`;
    case 'blockquote': return indent(blocks(kids, opts), '> ', '> ');
    case 'horizontalRule': return '---';
    case 'codeBlock': {
      const code = kids.map((k) => k.text ?? '').join('');
      const fence = code.includes('```') ? '~~~~' : '```';
      return `${fence}${str(n.attrs?.language)}\n${code}\n${fence}`;
    }
    case 'mathBlock': return `$$\n${str(n.attrs?.latex)}\n$$`;
    case 'bulletList': return kids.map((li) => block(li, opts)).join('\n');
    case 'orderedList': {
      const start = Number(n.attrs?.start ?? 1);
      return kids.map((li, i) => block(li, opts, start + i)).join('\n');
    }
    case 'listItem': {
      const marker = ordinal !== undefined ? `${ordinal}. ` : '- ';
      return indent(blocks(kids, opts, true), ' '.repeat(marker.length), marker);
    }
    case 'taskList': return kids.map((li) => block(li, opts)).join('\n');
    case 'taskItem': {
      const marker = `- [${n.attrs?.checked ? 'x' : ' '}] `;
      return indent(blocks(kids, opts, true), '      ', marker);
    }
    case 'callout': {
      const kind = str(n.attrs?.kind, 'note').toUpperCase();
      return indent(`[!${kind}]\n${blocks(kids, opts)}`, '> ', '> ');
    }
    case 'toggle': {
      const [summary, ...rest] = kids;
      const title = summary?.type === 'toggleSummary' ? inline(summary.content) : '';
      const body = summary?.type === 'toggleSummary' ? rest : kids;
      return `<details${n.attrs?.open ? ' open' : ''}>\n<summary>${title}</summary>\n\n${blocks(body.flatMap((b) => (b.type === 'toggleContent' ? b.content ?? [] : [b])), opts)}\n\n</details>`;
    }
    case 'table': {
      const rows = kids.map((r) => (r.content ?? []).map((c) => blocks(c.content ?? [], opts, true).replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const cols = Math.max(...rows.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array(cols - r.length).fill('')];
      const [head, ...body] = rows;
      return [`| ${pad(head).join(' | ')} |`, `| ${Array(cols).fill('---').join(' | ')} |`, ...body.map((r) => `| ${pad(r).join(' | ')} |`)].join('\n');
    }
    case 'image': return `![${str(n.attrs?.alt)}](${str(n.attrs?.src)})`;
    case 'sketch': {
      const id = str(n.attrs?.docId);
      const src = opts.sketchSrc?.(id);
      return src ? `![Sketch](${src})` : `<!-- sketch ${id} -->`;
    }
    case 'footnoteDef': return `[^${str(n.attrs?.id)}]: ${blocks(kids, opts, true)}`;
    case 'tableOfContents': return '[TOC]';
    case 'wikiEmbed': return `![[${str(n.attrs?.target)}]]`;
    case 'audioClip': return `<!-- audio ${str(n.attrs?.audioId)} -->`;
    default: return kids.length ? blocks(kids, opts) : inline(n.content);
  }
}

function blocks(nodes: PMNode[], opts: MarkdownOptions, tight = false): string {
  return nodes.map((n) => block(n, opts)).filter((s, i, a) => s !== '' || i < a.length - 1).join(tight ? '\n' : '\n\n');
}

export function docToMarkdown(doc: PMNode, opts: MarkdownOptions = {}, title?: string): string {
  footnoteCtx = new Map();
  const body = block(doc, opts).replace(/\n{3,}/g, '\n\n').trim();
  const notes = Array.from(footnoteCtx.values()).map((f) => `[^${f.n}]: ${f.note}`).join('\n');
  return (title ? `# ${title}\n\n` : '') + body + (notes ? `\n\n${notes}` : '') + '\n';
}

/** Plain text extraction (for search indexing, word counts, flashcards). */
export function docToText(doc: PMNode): string {
  const parts: string[] = [];
  const walk = (n: PMNode) => {
    if (n.type === 'text') { parts.push(n.text ?? ''); return; }
    if (n.type === 'wikiLink') { parts.push(`[[${str(n.attrs?.target)}${n.attrs?.alias ? '|' + str(n.attrs?.alias) : ''}]]`); return; }
    if (n.type === 'mathInline' || n.type === 'mathBlock') { parts.push(str(n.attrs?.latex)); }
    if (n.type === 'tag') { parts.push(`#${str(n.attrs?.name)}`); return; }
    if (n.type === 'hardBreak') { parts.push('\n'); return; }
    n.content?.forEach(walk);
    if (['paragraph', 'heading', 'codeBlock', 'listItem', 'taskItem', 'tableRow', 'mathBlock', 'toggleSummary', 'blockquote', 'callout'].includes(n.type)) parts.push('\n');
    else if (n.type === 'tableCell' || n.type === 'tableHeader') parts.push('\t');
  };
  walk(doc);
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function docHeadings(doc: PMNode): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  const walk = (n: PMNode) => {
    if (n.type === 'heading') out.push({ level: Number(n.attrs?.level ?? 1), text: docToText(n) });
    else n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}
