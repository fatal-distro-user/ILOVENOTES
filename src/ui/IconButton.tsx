import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { formatShortcut } from '@/commands/registry';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** Tooltip / accessible label. */
  title: string;
  shortcut?: string;
  active?: boolean;
  size?: 'sm' | 'md';
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { title, shortcut, active, size = 'md', className, children, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={shortcut ? `${title} (${formatShortcut(shortcut)})` : title}
      aria-label={title}
      aria-pressed={active}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-3 hover:text-fg',
        size === 'md' ? 'h-6 w-6' : 'h-5 w-5',
        active && 'bg-bg-3 text-accent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
