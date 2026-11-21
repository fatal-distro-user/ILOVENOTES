/**
 * Command-pattern undo/redo engine.
 * Each history scope (a page, a paint document, the scratch scope) owns a HistoryStack.
 * Commands are async-capable; the stack serialises execution so undo/redo never interleave.
 */

export interface HistoryCommand {
  /** Human label for the History panel ("Brush stroke", "Move 3 objects"). */
  label: string;
  /** Category icon hint for the History panel. */
  kind?: 'raster' | 'vector' | 'object' | 'text' | 'layer' | 'filter' | 'selection' | 'other';
  /** Re-apply the change (called on redo; NOT called on push, the change is already applied). */
  redo(): void | Promise<void>;
  undo(): void | Promise<void>;
  /** Approximate retained memory in bytes (raster tile diffs etc.) for memory-based trimming. */
  size?: number;
  /** Called when the command is permanently discarded (trimmed or truncated). */
  dispose?(): void;
  /** Commands with the same non-empty mergeKey pushed within mergeWindowMs merge into one entry. */
  mergeKey?: string;
  merge?(next: HistoryCommand): boolean;
}

export interface HistoryEntry { id: number; cmd: HistoryCommand; at: number }

export interface HistoryOptions { limit?: number; maxBytes?: number; mergeWindowMs?: number }

type Listener = () => void;

export class HistoryStack {
  private entries: HistoryEntry[] = [];
  /** number of applied entries; entries[cursor..] are redoable */
  private cursor = 0;
  private seq = 0;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<Listener>();
  private busy = false;
  readonly limit: number;
  readonly maxBytes: number;
  readonly mergeWindowMs: number;

  constructor(opts: HistoryOptions = {}) {
    this.limit = opts.limit ?? 200;
    this.maxBytes = opts.maxBytes ?? 512 * 1024 * 1024;
    this.mergeWindowMs = opts.mergeWindowMs ?? 600;
  }

  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emit(): void { this.listeners.forEach((l) => l()); }

  get list(): readonly HistoryEntry[] { return this.entries; }
  get position(): number { return this.cursor; }
  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.entries.length; }
  get isBusy(): boolean { return this.busy; }
  get bytes(): number { return this.entries.reduce((a, e) => a + (e.cmd.size ?? 0), 0); }

  /** Record a command whose effect has already been applied. */
  push(cmd: HistoryCommand, now = Date.now()): void {
    // Discard redo branch.
    for (const e of this.entries.splice(this.cursor)) e.cmd.dispose?.();
    const last = this.entries[this.cursor - 1];
    if (last && cmd.mergeKey && last.cmd.mergeKey === cmd.mergeKey && now - last.at <= this.mergeWindowMs && last.cmd.merge?.(cmd)) {
      last.at = now;
      this.emit();
      return;
    }
    this.entries.push({ id: ++this.seq, cmd, at: now });
    this.cursor = this.entries.length;
    this.trim();
    this.emit();
  }

  /** Apply and record a command (runs redo() first). */
  async execute(cmd: HistoryCommand): Promise<void> {
    await this.enqueue(async () => { await cmd.redo(); });
    this.push(cmd);
  }

  private trim(): void {
    while (this.entries.length > this.limit || (this.entries.length > 1 && this.bytes > this.maxBytes)) {
      const e = this.entries.shift();
      e?.cmd.dispose?.();
      this.cursor = Math.max(0, this.cursor - 1);
    }
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => { this.busy = true; try { await fn(); } finally { this.busy = false; } });
    this.queue = run.catch(() => undefined);
    return run;
  }

  undo(): Promise<void> {
    return this.enqueue(async () => {
      if (this.cursor === 0) return;
      const e = this.entries[this.cursor - 1];
      await e.cmd.undo();
      this.cursor--;
      this.emit();
    });
  }

  redo(): Promise<void> {
    return this.enqueue(async () => {
      if (this.cursor >= this.entries.length) return;
      const e = this.entries[this.cursor];
      await e.cmd.redo();
      this.cursor++;
      this.emit();
    });
  }

  /** Jump so that exactly `position` entries are applied (History panel click). */
  goTo(position: number): Promise<void> {
    const target = Math.max(0, Math.min(this.entries.length, position));
    return this.enqueue(async () => {
      while (this.cursor > target) { await this.entries[this.cursor - 1].cmd.undo(); this.cursor--; }
      while (this.cursor < target) { await this.entries[this.cursor].cmd.redo(); this.cursor++; }
      this.emit();
    });
  }

  clear(): void {
    for (const e of this.entries) e.cmd.dispose?.();
    this.entries = [];
    this.cursor = 0;
    this.emit();
  }
}

/** Combine several commands into one history entry (applied in order, undone in reverse). */
export function compound(label: string, cmds: HistoryCommand[], kind?: HistoryCommand['kind']): HistoryCommand {
  return {
    label, kind,
    size: cmds.reduce((a, c) => a + (c.size ?? 0), 0),
    async redo() { for (const c of cmds) await c.redo(); },
    async undo() { for (let i = cmds.length - 1; i >= 0; i--) await cmds[i].undo(); },
    dispose() { cmds.forEach((c) => c.dispose?.()); },
  };
}
