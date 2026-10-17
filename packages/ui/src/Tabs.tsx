'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from './cx';

/* ----------------------------------------------------------------------------- Tabs
 * Replaces the legacy 441 tab strips: real tabs with roving focus (arrows, Home/End), deep links
 * (`#tab-id` survives a reload and a pasted URL) and a lazily-rendered panel.
 */
export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  /** Uncontrolled initial tab; ignored when `value` is provided. */
  defaultValue?: string;
  value?: string;
  onChange?: (id: string) => void;
  /** Sync the active tab with the URL hash so a link can point at a tab. */
  hashSync?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Tabs({ items, defaultValue, value, onChange, hashSync = true, className, children }: TabsProps) {
  const firstEnabled = items.find((i) => !i.disabled)?.id ?? '';
  const [internal, setInternal] = useState(value ?? defaultValue ?? firstEnabled);
  const active = value ?? internal;
  const listRef = useRef<HTMLDivElement>(null);

  // Deep links: read the hash on mount and on back/forward.
  useEffect(() => {
    if (!hashSync) return;
    const applyHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash && items.some((i) => i.id === hash && !i.disabled)) {
        setInternal(hash);
        onChange?.(hash);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [hashSync, items, onChange]);

  const select = useCallback(
    (id: string) => {
      setInternal(id);
      onChange?.(id);
      if (hashSync) history.replaceState(null, '', `#${id}`);
    },
    [onChange, hashSync],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const enabled = items.filter((i) => !i.disabled);
    const current = enabled.findIndex((i) => i.id === active);
    if (e.key === 'ArrowRight') select(enabled[(current + 1) % enabled.length].id);
    else if (e.key === 'ArrowLeft') select(enabled[(current - 1 + enabled.length) % enabled.length].id);
    else if (e.key === 'Home') select(enabled[0].id);
    else if (e.key === 'End') select(enabled.at(-1)!.id);
    else return;
    e.preventDefault();
    const next = listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    next?.focus();
  };

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label="Sections"
        onKeyDown={onKeyDown}
        className="no-print flex flex-wrap gap-1 border-b border-border-subtle"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`panel-${item.id}`}
              aria-disabled={item.disabled}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              className={cx(
                '-mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-base transition-colors',
                selected
                  ? 'border-brand-500 font-medium text-brand-700'
                  : 'border-transparent text-text-secondary hover:border-border-default hover:text-text-primary',
                item.disabled && 'cursor-not-allowed text-text-disabled',
              )}
            >
              {item.icon}
              {item.label}
              {typeof item.count === 'number' && (
                <span className="rounded-full bg-surface-sunken px-1.5 font-numeric text-xs text-text-secondary">{item.count}</span>
              )}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="pt-3">
        {children}
      </div>
    </div>
  );
}
