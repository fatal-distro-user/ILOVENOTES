/** Pure Kanban helpers: scope keys, grouping, ordering, column edits, checklist progress. */

export const DEFAULT_COLUMNS = ['Backlog', 'To do', 'Doing', 'Done'];

export type Scope = { kind: 'notebook'; id: string } | { kind: 'tag'; id: string } | { kind: 'folder'; id: string };

export function scopeKey(s: Scope): string { return `${s.kind}:${s.id}`; }
export function parseScope(key: string | undefined | null): Scope | null {
  if (!key) return null;
  const i = key.indexOf(':');
  if (i < 0) return null;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  if ((kind === 'notebook' || kind === 'tag' || kind === 'folder') && id) return { kind, id };
  return null;
}

export interface Card { id: string; status?: string; createdAt: number }

/** Column a card lives in: its status when it names an existing column, otherwise the first column. */
export function columnOf(status: string | undefined, columns: string[]): string {
  return status && columns.includes(status) ? status : columns[0];
}

/** Group cards into columns, ordered by the stored `order` list (unknown ids sort after, by createdAt). */
export function groupCards<T extends Card>(cards: T[], columns: string[], order: string[]): Record<string, T[]> {
  const rank = new Map(order.map((id, i) => [id, i]));
  const out: Record<string, T[]> = Object.fromEntries(columns.map((c) => [c, [] as T[]]));
  for (const c of cards) out[columnOf(c.status, columns)]?.push(c);
  for (const col of columns) {
    out[col].sort((a, b) => {
      const ra = rank.get(a.id), rb = rank.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.createdAt - b.createdAt;
    });
  }
  return out;
}

/** New global order after dropping `id` before `beforeId` (or at the end of the given column list). */
export function moveInOrder(order: string[], columnIds: string[], id: string, beforeId: string | null): string[] {
  // Normalise: any ids present in the column but not in order are appended in column order first.
  const base = [...order.filter((x) => x !== id)];
  for (const cid of columnIds) if (cid !== id && !base.includes(cid)) base.push(cid);
  if (beforeId && beforeId !== id) {
    const at = base.indexOf(beforeId);
    if (at >= 0) { base.splice(at, 0, id); return base; }
  }
  // No target: place after the last card of the destination column.
  let last = -1;
  for (const cid of columnIds) if (cid !== id) last = Math.max(last, base.indexOf(cid));
  base.splice(last + 1, 0, id);
  return base;
}

export function renameColumn(columns: string[], from: string, to: string): string[] | null {
  const name = to.trim();
  if (!name || (name !== from && columns.includes(name))) return null;
  return columns.map((c) => (c === from ? name : c));
}
export function addColumn(columns: string[], name: string): string[] | null {
  const n = name.trim();
  if (!n || columns.includes(n)) return null;
  return [...columns, n];
}
export function deleteColumn(columns: string[], name: string): string[] | null {
  if (columns.length <= 1 || !columns.includes(name)) return null;
  return columns.filter((c) => c !== name);
}
export function moveColumn(columns: string[], name: string, delta: number): string[] {
  const i = columns.indexOf(name);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= columns.length) return columns;
  const next = [...columns];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

interface PMLike { type?: string; attrs?: Record<string, unknown>; content?: PMLike[] }

/** Count task items in a TipTap JSON document. */
export function checklistProgress(content: unknown): { done: number; total: number } {
  let done = 0, total = 0;
  const walk = (n: PMLike | undefined) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'taskItem') { total++; if (n.attrs?.checked) done++; }
    n.content?.forEach(walk);
  };
  walk(content as PMLike);
  return { done, total };
}
