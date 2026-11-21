import { useEffect, useRef, useState } from 'react';
import { Copy, FilePlus2, StickyNote, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { useLayout } from '@/store/layout';
import { getSetting, saveDoc, setSetting } from '@/db/repo';
import { toast } from '@/store/status';
import { confirmDialog } from '@/ui/dialogs';
import { IconButton } from '@/ui/IconButton';
import { newNode, todayString } from './actions';

const KEY = 'scratchpad';

export function Scratchpad() {
  const open = useLayout((s) => s.scratchpadOpen);
  const zen = useLayout((s) => s.zen);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<string | null>(null);

  useEffect(() => { void getSetting<string>(KEY, '').then((t) => { setText(t); setLoaded(true); }); }, []);

  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current !== null) { void setSetting(KEY, pending.current); pending.current = null; }
  };
  const change = (v: string) => {
    setText(v);
    pending.current = v;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  };
  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('beforeunload', flush); flush(); };
  }, []);
  useEffect(() => { if (open && loaded) area.current?.focus(); if (!open) flush(); }, [open, loaded]);

  const close = () => useLayout.getState().toggleScratchpad(false);

  const sendToPage = async () => {
    if (!text.trim()) { toast('Scratchpad is empty', 'info'); return; }
    const node = await newNode({ title: `Scratchpad ${todayString()}` });
    if (!node) return;
    const paragraphs = text.split(/\r?\n/).map((line) => (line.length ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }));
    await saveDoc({ pageId: node.id, content: { type: 'doc', content: paragraphs }, text, links: [], tags: [], headings: [] });
    toast('Scratchpad sent to a new page', 'ok');
    close();
  };

  return (
    <aside
      aria-hidden={!open}
      inert={!open}
      data-testid="scratchpad"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}
      className={clsx(
        'fixed right-0 top-0 z-50 flex w-[420px] max-w-full flex-col border-l border-line bg-bg-1 shadow-2xl shadow-black/40 transition-transform duration-200',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
      style={{ bottom: zen ? 0 : 22 }}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
        <StickyNote size={14} className="text-accent" />
        <span className="flex-1 text-[12px] font-medium">Scratchpad</span>
        <IconButton title="Copy" onClick={() => { void navigator.clipboard.writeText(text).then(() => toast('Copied scratchpad', 'ok'), () => toast('Copy failed', 'error')); }}><Copy size={14} /></IconButton>
        <IconButton title="Send to new page" onClick={() => void sendToPage()} data-testid="scratchpad-send"><FilePlus2 size={14} /></IconButton>
        <IconButton title="Clear" onClick={async () => { if (text && await confirmDialog('Clear the scratchpad? This cannot be undone.', { confirmLabel: 'Clear' })) change(''); }}><Trash2 size={14} /></IconButton>
        <IconButton title="Close (Esc)" onClick={close}><X size={14} /></IconButton>
      </div>
      <textarea
        ref={area}
        value={text}
        disabled={!loaded}
        onChange={(e) => change(e.target.value)}
        spellCheck={false}
        placeholder="Jot anything down. Markdown welcome. Autosaved."
        data-testid="scratchpad-text"
        className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[12.5px] leading-relaxed text-fg outline-none placeholder:text-fg-faint"
      />
    </aside>
  );
}
