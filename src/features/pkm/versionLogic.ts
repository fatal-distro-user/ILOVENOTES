/** Pure logic for version history: auto-snapshot pruning/scheduling, line diff, size formatting. */

export interface SnapMeta { id: string; createdAt: number; auto: boolean }

/** Ids of auto snapshots to delete so at most `keep` autos remain (newest kept). Named snapshots are never pruned. */
export function pruneAutoSnapshots(snaps: SnapMeta[], keep = 50): string[] {
  const autos = snaps.filter((s) => s.auto).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  return autos.slice(keep).map((s) => s.id);
}

/**
 * When should the next auto snapshot of a dirty page fire? At least `interval` after the previous one and at least
 * `quiet` after the latest edit (so it captures a settled state).
 */
export function nextAutoSnapshotAt(lastSnapshotAt: number, lastEditAt: number, interval = 5 * 60_000, quiet = 15_000): number {
  return Math.max(lastSnapshotAt + interval, lastEditAt + quiet);
}

export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

/** Line diff (LCS) between `from` (snapshot) and `to` (current). add = only in `to`; del = only in `from`. */
export function lineDiff(from: string, to: string, maxCells = 4_000_000): DiffOp[] {
  const a = from === '' ? [] : from.split('\n');
  const b = to === '' ? [] : to.split('\n');
  // trim common prefix/suffix cheaply
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const ma = ea - s, mb = eb - s;
  const out: DiffOp[] = a.slice(0, s).map((text) => ({ type: 'same', text }));
  if (ma * mb > maxCells) {
    for (let i = s; i < ea; i++) out.push({ type: 'del', text: a[i] });
    for (let j = s; j < eb; j++) out.push({ type: 'add', text: b[j] });
  } else {
    const w = mb + 1;
    const dp = new Uint32Array((ma + 1) * w);
    for (let i = ma - 1; i >= 0; i--) {
      for (let j = mb - 1; j >= 0; j--) {
        dp[i * w + j] = a[s + i] === b[s + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < ma && j < mb) {
      if (a[s + i] === b[s + j]) { out.push({ type: 'same', text: a[s + i] }); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { out.push({ type: 'del', text: a[s + i] }); i++; }
      else { out.push({ type: 'add', text: b[s + j] }); j++; }
    }
    while (i < ma) { out.push({ type: 'del', text: a[s + i] }); i++; }
    while (j < mb) { out.push({ type: 'add', text: b[s + j] }); j++; }
  }
  for (let i = ea; i < a.length; i++) out.push({ type: 'same', text: a[i] });
  return out;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const o of ops) { if (o.type === 'add') added++; else if (o.type === 'del') removed++; }
  return { added, removed };
}

/** Collapse long unchanged runs, keeping `ctx` lines around changes. Collapsed runs become { type: 'skip', n }. */
export function collapseContext(ops: DiffOp[], ctx = 2): (DiffOp | { type: 'skip'; n: number })[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, i) => { if (o.type !== 'same') for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true; });
  if (!ops.some((o) => o.type !== 'same')) return ops.length ? [{ type: 'skip', n: ops.length }] : [];
  const out: (DiffOp | { type: 'skip'; n: number })[] = [];
  let skipped = 0;
  ops.forEach((o, i) => {
    if (keep[i]) { if (skipped) { out.push({ type: 'skip', n: skipped }); skipped = 0; } out.push(o); } else skipped++;
  });
  if (skipped) out.push({ type: 'skip', n: skipped });
  return out;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}
