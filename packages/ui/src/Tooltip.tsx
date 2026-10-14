'use client';

import { cloneElement, useId, useState } from 'react';
import { cx } from './cx';
import { useIsPointerFine } from './hooks';

/* -------------------------------------------------------------------------- Tooltip
 * Advanced tooltip: a short title, optional description and an optional keyboard shortcut chip.
 *
 * Two deliberate constraints:
 *  1. **Disabled on touch devices.** On a phone or tablet there is no hover, so a tooltip either never appears
 *     (useless) or appears as a stray bubble after a tap (worse). On those devices the same information is
 *     reachable through the control's own label or the row/cell content.
 *  2. **Never the only source of meaning.** Everything a tooltip explains is also present in the accessible
 *     name, so keyboard and screen-reader users lose nothing.
 */
export interface TooltipProps {
  content: React.ReactNode;
  title?: string;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'right' | 'left';
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
  className?: string;
}

export function Tooltip({ content, title, shortcut, side = 'top', children, className }: TooltipProps) {
  const fine = useIsPointerFine();
  const [open, setOpen] = useState(false);
  const id = `tip-${useId()}`;

  // Touch-only: render the child untouched, with no tooltip behaviour at all.
  if (!fine) return children;

  const position =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : side === 'bottom'
        ? 'top-full left-1/2 -translate-x-1/2 mt-2'
        : side === 'right'
          ? 'left-full top-1/2 -translate-y-1/2 ml-2'
          : 'right-full top-1/2 -translate-y-1/2 mr-2';

  return (
    <span
      className={cx('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {cloneElement(children, open ? { 'aria-describedby': id } : {})}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cx(
            'pointer-events-none absolute z-50 w-max max-w-72 rounded-md border border-border-subtle bg-surface-inverse px-3 py-2 text-left shadow-lg',
            position,
          )}
        >
          {title && <span className="block text-xs font-semibold text-text-inverse">{title}</span>}
          <span className="block text-xs leading-relaxed text-text-inverse opacity-80">{content}</span>
          {shortcut && (
            <span className="mt-1 inline-flex gap-1">
              {shortcut.split('+').map((k) => (
                <kbd
                  key={k}
                  className="rounded-sm border border-white/30 bg-white/10 px-1.5 py-0.5 font-numeric text-[10px] text-text-inverse"
                >
                  {k}
                </kbd>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
