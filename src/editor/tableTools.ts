import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Find the table around the selection, its position, and the column index of the cursor. */
export function tableAtSelection(editor: Editor): { table: PMNode; pos: number; col: number } | null {
  const { $from } = editor.state.selection;
  let col = -1;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') col = $from.index(d - 1);
    if (n.type.name === 'table') return { table: n, pos: $from.before(d), col: Math.max(0, col) };
  }
  return null;
}

function compareCells(a: string, b: string): number {
  const na = parseFloat(a.replace(/[, ]/g, '')), nb = parseFloat(b.replace(/[, ]/g, ''));
  const numeric = /^-?[\d.,\s]+%?$/.test(a.trim()) && /^-?[\d.,\s]+%?$/.test(b.trim());
  if (numeric && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const da = Date.parse(a), db = Date.parse(b);
  if (!Number.isNaN(da) && !Number.isNaN(db) && /\d{4}|\d{1,2}\/\d{1,2}/.test(a + b)) return da - db;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Sort table body rows by the cursor's column. Header rows (made of tableHeader cells) stay on top. */
export function sortTable(editor: Editor, dir: 'asc' | 'desc'): boolean {
  const found = tableAtSelection(editor);
  if (!found) return false;
  const { table, pos, col } = found;
  const rows: PMNode[] = [];
  table.forEach((r) => rows.push(r));
  const isHeader = (r: PMNode) => r.childCount > 0 && Array.from({ length: r.childCount }, (_, i) => r.child(i)).every((c) => c.type.name === 'tableHeader');
  const head = rows.filter(isHeader);
  const body = rows.filter((r) => !isHeader(r));
  const key = (r: PMNode) => (col < r.childCount ? r.child(col).textContent : '');
  const sorted = [...body].sort((a, b) => compareCells(key(a), key(b)) * (dir === 'asc' ? 1 : -1));
  const newTable = table.type.create(table.attrs, [...head, ...sorted]);
  editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + table.nodeSize, newTable));
  return true;
}
