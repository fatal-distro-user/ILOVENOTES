import { describe, it, expect } from 'vitest';
import { HistoryStack } from './stack';
import { useUndoScopes, stackScope, activeScope } from './scopes';

describe('undo scopes', () => {
  it('registers, activates and unregisters scopes', async () => {
    const st = { v: 0 };
    const stack = new HistoryStack();
    const off = useUndoScopes.getState().register(stackScope('canvas:1', 'Canvas', stack));
    useUndoScopes.getState().activate('canvas:1');
    await stack.execute({ label: 'inc', redo: () => { st.v++; }, undo: () => { st.v--; } });
    const s = activeScope()!;
    expect(s.canUndo()).toBe(true);
    await s.undo();
    expect(st.v).toBe(0);
    expect(s.canRedo()).toBe(true);
    off();
    expect(activeScope()).toBeNull();
  });
});
