import { useEffect, useRef, useState } from 'react';
import { Minimize2, Redo2, StickyNote, Undo2 } from 'lucide-react';
import { useLayout } from '@/store/layout';
import { runCommand } from '@/commands/registry';
import { IconButton } from '@/ui/IconButton';
import { useZenTools } from './zenTools';
import { ToastText } from './StatusBar';

/** Floating toolbar shown in zen mode; dims to 30% after 2s of inactivity. */
export function ZenPill() {
  const tools = useZenTools();
  const [idle, setIdle] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const wake = () => { setIdle(false); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setIdle(true), 2000); };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    return () => { window.removeEventListener('pointermove', wake); window.removeEventListener('keydown', wake); window.clearTimeout(timer.current); };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-1">
      <div className="text-[12px]"><ToastText /></div>
      <div
        data-testid="zen-pill"
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-bg-1/95 px-2 py-1 shadow-lg shadow-black/40 backdrop-blur transition-opacity duration-500 hover:!opacity-100"
        style={{ opacity: idle ? 0.3 : 1 }}
      >
        <IconButton title="Exit zen mode" shortcut="Mod+Shift+F" onClick={() => useLayout.getState().toggleZen(false)} data-testid="zen-exit"><Minimize2 size={15} /></IconButton>
        <IconButton title="Scratchpad" shortcut="Mod+Shift+Space" onClick={() => useLayout.getState().toggleScratchpad()}><StickyNote size={15} /></IconButton>
        <span className="mx-0.5 h-4 w-px bg-line" />
        <IconButton title="Undo" shortcut="Mod+Z" onClick={() => void runCommand('edit.undo')}><Undo2 size={15} /></IconButton>
        <IconButton title="Redo" shortcut="Mod+Shift+Z" onClick={() => void runCommand('edit.redo')}><Redo2 size={15} /></IconButton>
        {tools.length > 0 && <span className="mx-0.5 h-4 w-px bg-line" />}
        {tools.map((t) => <span key={t.id} className="flex items-center">{t.node}</span>)}
      </div>
    </div>
  );
}
