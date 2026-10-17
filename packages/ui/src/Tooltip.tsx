'use client';

import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { useIsPointerFine } from './hooks';

/* -------------------------------------------------------------------------- Tooltip
 * Advanced tooltip: short title, optional description and an optional shortcut chip.
 *
 * Three rules learned the hard way:
 *  1. **It renders in a portal.** Every other approach fails somewhere real: the sidebar scrolls, table headers
 *     are sticky and clipped, and a tooltip inside scrolling content ends up behind the panel it belongs to.
 *     Fixed positioning against the trigger's rect behaves the same everywhere.
 *  2. **Disabled on touch devices.** No hover means a tooltip is either invisible or an accidental stray bubble.
 *  3. **Never the only source of meaning.** Everything here is also in the accessible name.
 */
export type TooltipSide = 'top' | 'bottom' | 'right' | 'left';

export interface TooltipProps {
  content: React.ReactNode;
  title?: string;
  shortcut?: string;
  side?: TooltipSide;
  /** Flip to the opposite side when there is not enough room. Default true. */
  flip?: boolean;
  maxWidth?: number;
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
  className?: string;
}

const GAP = 8;

export function Tooltip({
  content,
  title,
  shortcut,
  side = 'top',
  flip = true,
  maxWidth = 288,
  children,
  className,
}: TooltipProps) {
  const fine = useIsPointerFine();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; transform: string; side: TooltipSide } | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const id = `tip-${useId()}`;

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let chosen: TooltipSide = side;
    if (flip) {
      if (side === 'right' && r.right + GAP + maxWidth > vw) chosen = 'left';
      if (side === 'left' && r.left - GAP - maxWidth < 0) chosen = 'right';
      if (side === 'top' && r.top - GAP < 56) chosen = 'bottom';
      if (side === 'bottom' && r.bottom + GAP + 96 > vh) chosen = 'top';
    }

    let top = 0;
    let left = 0;
    let transform = '';

    switch (chosen) {
      case 'top':
        top = r.top - GAP;
        left = r.left + r.width / 2;
        transform = 'translate(-50%, -100%)';
        break;
      case 'bottom':
        top = r.bottom + GAP;
        left = r.left + r.width / 2;
        transform = 'translate(-50%, 0)';
        break;
      case 'right':
        top = r.top + r.height / 2;
        left = r.right + GAP;
        transform = 'translate(0, -50%)';
        break;
      case 'left':
        top = r.top + r.height / 2;
        left = r.left - GAP;
        transform = 'translate(-100%, -50%)';
        break;
    }

    // Keep it on screen: clamp the horizontal centre for top/bottom, the vertical centre for left/right.
    if (chosen === 'top' || chosen === 'bottom') {
      const half = Math.min(maxWidth, 320) / 2;
      left = Math.min(Math.max(left, half + 8), vw - half - 8);
    } else {
      const half = 80;
      top = Math.min(Math.max(top, half + 8), vh - half - 8);
    }

    setPos({ top, left, transform, side: chosen });
  }, [side, flip, maxWidth]);

  const show = useCallback(
    (immediate = false) => {
      if (!fine) return;
      if (showTimer.current) window.clearTimeout(showTimer.current);
      showTimer.current = window.setTimeout(
        () => {
          place();
          setOpen(true);
        },
        immediate ? 0 : 120,
      );
    },
    [fine, place],
  );

  const hide = useCallback(() => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    setOpen(false);
  }, []);

  // A fixed tooltip would drift away from its trigger: reposition on scroll/resize, close if it leaves the screen.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onResize = () => hide();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, place, hide]);

  useEffect(() => () => { if (showTimer.current) window.clearTimeout(showTimer.current); }, []);

  if (!fine) return children;

  const child = cloneElement(children, open ? { 'aria-describedby': id } : {});

  return (
    <>
      <span
        ref={anchorRef}
        className={cx('inline-flex', className)}
        onMouseEnter={() => show()}
        onMouseLeave={hide}
        onFocusCapture={() => show(true)}
        onBlurCapture={hide}
        onPointerDown={hide}
      >
        {child}
      </span>
      {mounted && open && pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{ position: 'fixed', top: pos.top, left: pos.left, transform: pos.transform, maxWidth }}
            className="pointer-events-none z-[90] w-max rounded-md border border-white/10 bg-surface-inverse px-3 py-2 text-left shadow-xl"
          >
            {title && <span className="block text-xs font-semibold text-text-inverse">{title}</span>}
            <span className="block text-xs leading-relaxed text-text-inverse opacity-80">{content}</span>
            {shortcut && (
              <span className="mt-1 inline-flex gap-1">
                {shortcut.split('+').map((k) => (
                  <kbd key={k} className="rounded-sm border border-white/30 bg-white/10 px-1.5 py-0.5 font-numeric text-[10px] text-text-inverse">
                    {k}
                  </kbd>
                ))}
              </span>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
