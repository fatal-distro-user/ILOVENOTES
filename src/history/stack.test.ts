import { describe, it, expect } from 'vitest';
import { HistoryStack, compound, type HistoryCommand } from './stack';

function counterCmd(state: { v: number }, delta: number, extra: Partial<HistoryCommand> = {}): HistoryCommand {
  return { label: `+${delta}`, redo: () => { state.v += delta; }, undo: () => { state.v -= delta; }, ...extra };
}

describe('HistoryStack', () => {
  it('undoes, redoes and truncates redo branch', async () => {
    const s = { v: 0 };
    const h = new HistoryStack();
    await h.execute(counterCmd(s, 1));
    await h.execute(counterCmd(s, 2));
    expect(s.v).toBe(3);
    await h.undo();
    expect(s.v).toBe(1);
    await h.redo();
    expect(s.v).toBe(3);
    await h.undo();
    await h.execute(counterCmd(s, 10));
    expect(s.v).toBe(11);
    expect(h.canRedo).toBe(false);
    expect(h.list).toHaveLength(2);
  });

  it('supports 100+ steps and goTo', async () => {
    const s = { v: 0 };
    const h = new HistoryStack({ limit: 150 });
    for (let i = 0; i < 120; i++) await h.execute(counterCmd(s, 1));
    expect(h.list).toHaveLength(120);
    await h.goTo(20);
    expect(s.v).toBe(20);
    await h.goTo(120);
    expect(s.v).toBe(120);
  });

  it('trims by limit and memory, disposing discarded entries', async () => {
    const s = { v: 0 };
    let disposed = 0;
    const h = new HistoryStack({ limit: 3, maxBytes: 250 });
    for (let i = 0; i < 5; i++) h.push(counterCmd(s, 1, { size: 100, dispose: () => { disposed++; } }));
    expect(h.list.length).toBeLessThanOrEqual(2);
    expect(disposed).toBe(3);
  });

  it('merges commands with same key in window', () => {
    const s = { v: 0 };
    const h = new HistoryStack({ mergeWindowMs: 1000 });
    const mk = (d: number): HistoryCommand => {
      let total = d;
      const c: HistoryCommand = {
        label: 'type', mergeKey: 'typing',
        redo: () => { s.v += total; }, undo: () => { s.v -= total; },
        merge: (n) => { total += (n as HistoryCommand & { d: number }).d; return true; },
      };
      return Object.assign(c, { d });
    };
    s.v += 1; h.push(mk(1), 0);
    s.v += 2; h.push(mk(2), 500);
    expect(h.list).toHaveLength(1);
    s.v += 3; h.push(mk(3), 5000);
    expect(h.list).toHaveLength(2);
  });

  it('serialises async commands and compounds', async () => {
    const log: string[] = [];
    const slow = (n: string): HistoryCommand => ({
      label: n,
      redo: async () => { await new Promise((r) => setTimeout(r, 5)); log.push('do' + n); },
      undo: async () => { await new Promise((r) => setTimeout(r, 1)); log.push('undo' + n); },
    });
    const h = new HistoryStack();
    await h.execute(compound('both', [slow('a'), slow('b')]));
    void h.undo();
    await h.redo();
    expect(log).toEqual(['doa', 'dob', 'undob', 'undoa', 'doa', 'dob']);
  });
});
