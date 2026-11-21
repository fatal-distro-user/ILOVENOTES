import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

export interface PopoverProps {
  /** Element (or point) the popover is anchored to. */
  anchor: HTMLElement | { x: number; y: number } | null;
  onClose: () => void;
  children: ReactNode;
  /** Horizontal alignment relative to the anchor element. */
  align?: 'start' | 'end';
  /** Preferred side; flips when there is not enough room. */
  side?: 'bottom' | 'top';
  className?: string;
  testId?: string;
}

/** Floating panel rendered in a portal; closes on outside press and Escape; clamps to the viewport. */
export function Popover({ anchor, onClose, children, align = 'start', side = 'bottom', className, testId }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left: number, top: number;
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect();
      left = align === 'end' ? r.right - w : r.left;
      top = side === 'bottom' ? r.bottom + 4 : r.top - h - 4;
      if (side === 'bottom' && top + h > vh - 4 && r.top - h - 4 > 4) top = r.top - h - 4;
      if (side === 'top' && top < 4) top = r.bottom + 4;
    } else { left = anchor.x; top = anchor.y; }
    left = Math.max(4, Math.min(left, vw - w - 4));
    top = Math.max(4, Math.min(top, vh - h - 4));
    setPos({ left, top });
  }, [anchor, align, side, children]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
    };
  }, [anchor, onClose]);

  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      data-testid={testId}
      className={clsx('fixed z-[70] rounded-md border border-line bg-bg-1 text-fg shadow-xl shadow-black/40', className)}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
