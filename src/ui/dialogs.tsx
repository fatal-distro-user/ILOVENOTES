import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Modal, Button } from './Modal';

type Request =
  | { id: number; kind: 'confirm'; message: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { id: number; kind: 'prompt'; title: string; initial: string; resolve: (v: string | null) => void };

const useDialogs = create<{ queue: Request[] }>(() => ({ queue: [] }));
let seq = 0;

function push(r: Request) { useDialogs.setState((s) => ({ queue: [...s.queue, r] })); }
function drop(id: number) { useDialogs.setState((s) => ({ queue: s.queue.filter((q) => q.id !== id) })); }

/** Imperative confirm dialog (rendered by <DialogHost/>). Resolves true when confirmed. */
export function confirmDialog(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => push({ id: ++seq, kind: 'confirm', message, confirmLabel: opts.confirmLabel ?? 'Confirm', danger: opts.danger ?? true, resolve }));
}

/** Imperative text prompt. Resolves the entered string, or null if cancelled. */
export function promptDialog(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => push({ id: ++seq, kind: 'prompt', title, initial, resolve }));
}

function ConfirmView({ r }: { r: Extract<Request, { kind: 'confirm' }> }) {
  const done = (v: boolean) => { drop(r.id); r.resolve(v); };
  return (
    <Modal title="Confirm" onClose={() => done(false)} width={380} testId="confirm-dialog"
      footer={<><Button onClick={() => done(false)}>Cancel</Button><Button variant={r.danger ? 'danger' : 'primary'} autoFocus onClick={() => done(true)} data-testid="confirm-ok">{r.confirmLabel}</Button></>}>
      <p className="whitespace-pre-wrap text-[13px] text-fg">{r.message}</p>
    </Modal>
  );
}

function PromptView({ r }: { r: Extract<Request, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(r.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const done = (v: string | null) => { drop(r.id); r.resolve(v); };
  const submit = () => done(value.trim() ? value.trim() : null);
  return (
    <Modal title={r.title} onClose={() => done(null)} width={380} testId="prompt-dialog"
      footer={<><Button onClick={() => done(null)}>Cancel</Button><Button variant="primary" onClick={submit} data-testid="prompt-ok">OK</Button></>}>
      <input
        ref={ref} value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        className="h-8 w-full rounded-md border border-line bg-bg-2 px-2 text-[13px] text-fg outline-none focus:border-accent"
        data-testid="prompt-input"
      />
    </Modal>
  );
}

export function DialogHost() {
  const top = useDialogs((s) => s.queue[0]);
  if (!top) return null;
  return top.kind === 'confirm' ? <ConfirmView key={top.id} r={top} /> : <PromptView key={top.id} r={top} />;
}
