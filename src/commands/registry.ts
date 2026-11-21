/**
 * Global command registry. Every user-facing action (menus, shortcuts, command palette) is a Command.
 * Shortcuts use a normalised form: "Mod+Shift+K" where Mod = Ctrl on Win/Linux, Cmd on macOS.
 */
import { useSyncExternalStore } from 'react';

export interface Command {
  id: string;
  title: string;
  category: string;
  /** one or more shortcut strings */
  shortcut?: string | string[];
  keywords?: string[];
  /** return false to hide from the palette / disable shortcut in current context */
  when?: () => boolean;
  /** allow the shortcut to fire while focus is in a text input/editor */
  allowInInput?: boolean;
  run: () => void | Promise<void>;
}

const commands = new Map<string, Command>();
const listeners = new Set<() => void>();
let version = 0;
let snapshot: Command[] = [];

function emit() { version++; snapshot = Array.from(commands.values()); listeners.forEach((l) => l()); }

export function registerCommand(cmd: Command): () => void {
  commands.set(cmd.id, cmd);
  emit();
  return () => { if (commands.get(cmd.id) === cmd) { commands.delete(cmd.id); emit(); } };
}

export function registerCommands(cmds: Command[]): () => void {
  const offs = cmds.map(registerCommand);
  return () => offs.forEach((o) => o());
}

export function getCommand(id: string): Command | undefined { return commands.get(id); }
export function listCommands(): Command[] { return snapshot; }
export function commandsVersion(): number { return version; }

export async function runCommand(id: string): Promise<boolean> {
  const c = commands.get(id);
  if (!c || (c.when && !c.when())) return false;
  await c.run();
  return true;
}

export function useCommands(): Command[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEY_ALIASES: Record<string, string> = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', '+': 'Plus' };

/** Normalise a KeyboardEvent to "Mod+Alt+Shift+Key". */
export function eventToShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const parts: string[] = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('Mod');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  // Use the physical code for letters/digits so Shift/Alt layouts don't change the key name.
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (e.code === 'Backslash') key = '\\';
  else if (e.code === 'BracketLeft') key = '[';
  else if (e.code === 'BracketRight') key = ']';
  else if (e.code === 'Slash') key = '/';
  else if (e.code === 'Comma') key = ',';
  else if (e.code === 'Period') key = '.';
  else if (e.code === 'Equal') key = '=';
  else if (e.code === 'Minus') key = '-';
  key = KEY_ALIASES[key] ?? key;
  if (key.length === 1) key = key.toUpperCase();
  if (!['Control', 'Meta', 'Alt', 'Shift'].includes(key)) parts.push(key);
  return parts.join('+');
}

export function normaliseShortcut(s: string): string {
  const parts = s.split('+').map((p) => p.trim());
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => (p === 'Cmd' || p === 'Ctrl' && !isMac ? 'Mod' : p)));
  const order = ['Mod', 'Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m));
  return [...order, key.length === 1 ? key.toUpperCase() : key].join('+');
}

export function formatShortcut(s: string): string {
  const n = normaliseShortcut(s);
  if (!isMac) return n.replace('Mod', 'Ctrl');
  return n.replace('Mod', '⌘').replace('Ctrl', '⌃').replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, '');
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/** Install the global keydown dispatcher. Returns an uninstaller. */
export function installShortcutDispatcher(target: Window = window): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const combo = eventToShortcut(e);
    const inInput = isEditable(e.target);
    for (const c of commands.values()) {
      if (!c.shortcut) continue;
      const list = Array.isArray(c.shortcut) ? c.shortcut : [c.shortcut];
      if (!list.some((s) => normaliseShortcut(s) === combo)) continue;
      if (inInput && !c.allowInInput) continue;
      if (c.when && !c.when()) continue;
      e.preventDefault();
      e.stopPropagation();
      void c.run();
      return;
    }
  };
  target.addEventListener('keydown', handler);
  return () => target.removeEventListener('keydown', handler);
}
