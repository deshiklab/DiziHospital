'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';

/* ------------------------------------------------------------------------------ Sheet
 * Side drawer (right on desktop, bottom sheet on small screens) used for booking, record detail and filters.
 * A drawer rather than a modal because the work behind it stays visible: a clerk booking an appointment needs
 * to see the calendar while choosing a slot.
 *
 * Behaviour: portal so nothing clips it, Escape closes, focus moves in on open and returns to the trigger on
 * close, background scroll is locked, and the label is always announced.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'md' | 'lg' | 'xl';
  /** Prevent closing while a multi-step flow is mid-save. */
  busy?: boolean;
}

export function Sheet({ open, onClose, title, description, children, footer, width = 'lg', busy }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    window.setTimeout(() => focusables()[0]?.focus(), 30);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, busy]);

  if (typeof document === 'undefined' || !open) return null;

  const widthClass = width === 'md' ? 'sm:max-w-md' : width === 'xl' ? 'sm:max-w-3xl' : 'sm:max-w-xl';

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-surface-overlay" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-xl border border-border-subtle bg-surface-raised shadow-2xl',
          'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:rounded-none sm:rounded-l-xl',
          widthClass,
        )}
      >
        <header className="flex items-start gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            {description && <p className="text-sm text-text-secondary">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="inline-grid size-9 shrink-0 place-items-center rounded-md text-text-secondary hover:bg-surface-sunken disabled:opacity-40"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        {footer && <footer className="border-t border-border-subtle bg-surface-raised px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
