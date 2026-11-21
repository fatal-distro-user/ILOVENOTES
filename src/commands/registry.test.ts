import { describe, it, expect, vi } from 'vitest';
import { registerCommand, runCommand, eventToShortcut, normaliseShortcut, installShortcutDispatcher } from './registry';

describe('command registry', () => {
  it('normalises shortcuts', () => {
    expect(normaliseShortcut('Shift+Mod+k')).toBe('Mod+Shift+K');
    expect(normaliseShortcut('Ctrl+K')).toBe('Mod+K');
    expect(eventToShortcut({ key: 'k', code: 'KeyK', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe('Mod+Shift+K');
    expect(eventToShortcut({ key: 'F11', code: 'F11', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe('F11');
  });
  it('runs and respects when()', async () => {
    const run = vi.fn();
    const off = registerCommand({ id: 't.a', title: 'A', category: 'Test', run, when: () => false });
    expect(await runCommand('t.a')).toBe(false);
    off();
    registerCommand({ id: 't.a', title: 'A', category: 'Test', run });
    expect(await runCommand('t.a')).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
  it('dispatches keyboard shortcuts and skips inputs', () => {
    const run = vi.fn();
    registerCommand({ id: 't.b', title: 'B', category: 'Test', shortcut: 'Mod+J', run });
    const off = installShortcutDispatcher();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', ctrlKey: true }));
    expect(run).toHaveBeenCalledOnce();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', ctrlKey: true, bubbles: true }));
    expect(run).toHaveBeenCalledOnce();
    off();
  });
});
