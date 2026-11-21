import { useEffect } from 'react';
import { NotebookPen } from 'lucide-react';
import './features';
import { AppShell } from './layout/AppShell';
import { installShortcutDispatcher } from './commands/registry';
import { applyAppearance, useLayout } from './store/layout';
import { useWorkspace } from './store/workspace';

export function App() {
  const ready = useWorkspace((s) => s.ready);

  useEffect(() => {
    applyAppearance(useLayout.getState());
    const unsub = useLayout.subscribe((s) => applyAppearance(s));
    const uninstall = installShortcutDispatcher();
    void useWorkspace.getState().boot();
    return () => { unsub(); uninstall(); };
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-fg-muted" data-testid="loading">
        <NotebookPen className="mr-2 text-accent" size={20} />Loading ILOVENOTES…
      </div>
    );
  }
  return <AppShell />;
}
