'use client';

import { useId } from 'react';
import { cx } from './cx';

/* ------------------------------------------------------------------------- Segmented
 * Small radio group for choices with few, always-visible options (priority, appointment type, queue filter).
 * Implemented as real radios so it works with arrow keys, screen readers and form submission — the legacy
 * product used styled anchors that looked like buttons and were not reachable by keyboard.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  tone?: 'neutral' | 'info' | 'warning' | 'critical' | 'success';
}

export function Segmented<T extends string>({
  name,
  label,
  value,
  onChange,
  options,
  className,
}: {
  name: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentedOption<T>>;
  className?: string;
}) {
  const group = useId();

  const tone: Record<string, string> = {
    neutral: '',
    info: 'aria-[checked=true]:border-safety-info aria-[checked=true]:text-safety-info',
    warning: 'aria-[checked=true]:border-safety-warning aria-[checked=true]:text-safety-warning',
    critical: 'aria-[checked=true]:border-safety-critical aria-[checked=true]:text-safety-critical',
    success: 'aria-[checked=true]:border-safety-success aria-[checked=true]:text-safety-success',
  };

  return (
    <fieldset className={cx('flex min-w-0 flex-col gap-1', className)} style={{ minInlineSize: 0 }}>
      <legend className="text-sm font-medium text-text-secondary">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const id = `${name}-${group}-${o.value}`;
          return (
            <label
              key={o.value}
              htmlFor={id}
              className="cursor-pointer"
              title={o.hint}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                className="peer sr-only"
              />
              <span
                className={cx(
                  'inline-flex h-8 items-center rounded-md border border-border-default bg-surface-raised px-3 text-sm text-text-secondary',
                  'hover:bg-surface-sunken peer-focus-visible:ring-2 peer-focus-visible:ring-brand-300',
                  'peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:font-medium peer-checked:text-brand-700',
                  tone[o.tone ?? 'neutral'],
                )}
              >
                {o.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
