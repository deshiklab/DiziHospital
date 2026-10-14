'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@dizi/ui';
import { X } from 'lucide-react';

/* ---------------------------------------------------------------------------- MobileNav
 * The off-canvas navigation for phones and tablets.
 *
 * It used to be an inline element that only ever opened: pressing the button a second time did nothing, Escape
 * did nothing, focus stayed on the button behind the panel and the page beneath it kept scrolling. All four are
 * fixed here, and the panel is rendered in a portal so no ancestor's overflow or stacking context can clip it or
 * swallow its taps.
 *
 * The panel deliberately stops above the mobile action bar (z-65, which paints over this overlay's backdrop), so
 * the button that opened the drawer is still visible and still live while it is open.
 *
 * Behaviours, matching the Sheet: Escape closes, focus moves in on open and returns to the trigger on close,
 * Tab is trapped inside, the background does not scroll, and the panel is labelled.
 */

export function MobileNav({
  open,
  onClose,
  triggerId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** id of the button that opens it, for aria-controls and focus restore. */
  triggerId: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.getElementById(triggerId) as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    const timer = window.setTimeout(() => focusables()[0]?.focus(), 30);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, triggerId]);

  if (typeof document === 'undefined' || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] lg:hidden">
      <div className="absolute inset-0 bg-surface-overlay" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        id="mobile-nav-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute left-0 top-0 bottom-[calc(var(--dizi-mobile-bar)+env(safe-area-inset-bottom))] flex w-[min(18rem,88vw)] flex-col border-r border-border-subtle bg-surface-raised shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
          <span className="flex items-center gap-2">
            <span aria-hidden className="grid size-7 place-items-center rounded-md bg-brand-500 text-xs font-bold text-text-inverse">
              D
            </span>
            <span className="text-sm font-semibold">DiziHospital</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className={cx('inline-grid size-9 place-items-center rounded-md text-text-secondary hover:bg-surface-sunken')}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
