import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

export interface ModalProps { title: string; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode; testId?: string }

export function Modal({ title, onClose, children, width = 420, footer, testId }: ModalProps) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 pt-[14vh]" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} data-testid={testId} style={{ width }} className="max-w-[92vw] rounded-lg border border-line bg-bg-1 text-fg shadow-2xl">
        <div className="flex h-9 items-center justify-between border-b border-line pl-3 pr-1.5">
          <div className="text-[13px] font-semibold">{title}</div>
          <IconButton title="Close" onClick={onClose}><X size={14} /></IconButton>
        </div>
        <div className="p-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line p-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Button({ variant = 'default', className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const base = 'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] transition-colors';
  const v = variant === 'primary' ? 'bg-accent text-accent-fg hover:opacity-90'
    : variant === 'danger' ? 'bg-danger text-white hover:opacity-90'
    : 'border border-line bg-bg-2 text-fg hover:bg-bg-3';
  return <button type="button" className={`${base} ${v} ${className}`} {...rest} />;
}
