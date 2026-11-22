/** Tiny, safe Markdown renderer for sticky notes (escapes HTML first; supports the common inline/block syntax). */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="sticky-wiki">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = /^\s*[-*]\s+\[( |x)\]\s+(.*)$/i.exec(line))) { if (list !== 'ul') { close(); out.push('<ul class="tasks">'); list = 'ul'; } out.push(`<li><input type="checkbox" disabled${m[1].toLowerCase() === 'x' ? ' checked' : ''}> ${inline(m[2])}</li>`); continue; }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    close();
    if (/^>\s?/.test(line)) { out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^---+$/.test(line)) { out.push('<hr>'); continue; }
    out.push(line ? `<p>${inline(line)}</p>` : '<p class="blank"></p>');
  }
  close();
  return out.join('');
}
