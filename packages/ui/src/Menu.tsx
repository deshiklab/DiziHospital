'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from './cx';
import { useOnClickOutside } from './hooks';

/* ----------------------------------------------------------------------------- Menu
 * Dropdown used for the 3-dot row actions, column management and the user menu.
 * Keyboard: Enter/Space opens, arrows move, Home/End jump, Enter selects, Esc closes and returns focus.
 */
export interface MenuItem {
  label: string;
  onSelect?: () => void;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a divider above this item. */
  separated?: boolean;
  hint?: string;
}

export interface MenuProps {
  trigger: React.ReactNode | ((props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode);
  items: MenuItem[];
  align?: 'left' | 'right';
  label: string;
  className?: string;
}

export function Menu({ trigger, items, align = 'right', label, className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useOnClickOutside<HTMLDivElement>(() => setOpen(false), open);

  const selectable = items.map((i, index) => ({ i, index })).filter(({ i }) => !i.disabled && !i.label.startsWith('-'));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, selectable.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const item = selectable[active];
        if (item) {
          item.i.onSelect?.();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, active, selectable]);

  const toggle = () => {
    setOpen((o) => !o);
    setActive(0);
  };

  return (
    <div ref={wrapRef} className={cx('relative inline-flex', className)}>
      {typeof trigger === 'function' ? (
        trigger({ open, toggle, ref: buttonRef })
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          onClick={toggle}
          className="inline-flex"
        >
          {trigger}
        </button>
      )}

      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label={label}
          className={cx(
            'absolute top-full z-50 mt-1 min-w-52 overflow-hidden rounded-md border border-border-subtle bg-surface-raised py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) => {
            const isSelectable = !item.disabled && !item.label.startsWith('-');
            const pos = selectable.findIndex((s) => s.index === index);
            return (
              <div key={`${item.label}-${index}`}>
                {item.separated && <div className="my-1 border-t border-border-subtle" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onMouseEnter={() => isSelectable && setActive(pos)}
                  onClick={() => {
                    item.onSelect?.();
                    setOpen(false);
                    buttonRef.current?.focus();
                  }}
                  className={cx(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-base',
                    item.disabled ? 'cursor-not-allowed text-text-disabled' : 'text-text-primary',
                    isSelectable && pos === active && 'bg-surface-sunken',
                    item.danger && !item.disabled && 'text-safety-critical',
                  )}
                >
                  {item.icon && <span className="grid size-4 place-items-center text-text-tertiary">{item.icon}</span>}
                  <span className="flex-1">
                    {item.label}
                    {item.hint && <span className="block text-xs text-text-tertiary">{item.hint}</span>}
                  </span>
                  {item.shortcut && <kbd className="font-numeric text-[10px] text-text-tertiary">{item.shortcut}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The 3-dot trigger used by table rows. */
export function MenuTriggerIcon({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="grid size-7 place-items-center rounded-md text-text-tertiary hover:bg-surface-sunken hover:text-text-primary">
      {icon}
    </span>
  );
}
