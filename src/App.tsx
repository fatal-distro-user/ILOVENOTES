import { NotebookPen } from 'lucide-react';
import { platformKind } from './platform/fileio';

export function App() {
  return (
    <div className="flex h-full items-center justify-center bg-bg text-fg">
      <div className="flex items-center gap-3">
        <NotebookPen className="text-accent" size={28} />
        <div>
          <div className="text-lg font-semibold">ILOVENOTES</div>
          <div className="text-fg-muted text-xs">Runtime: {platformKind()}</div>
        </div>
      </div>
    </div>
  );
}
