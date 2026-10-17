'use client';

import { cx } from './cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks interaction; the label stays visible so the intent is never lost. */
  busy?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-1 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-500 text-text-inverse hover:bg-brand-600 active:bg-brand-700',
  secondary: 'bg-surface-raised text-text-primary border border-border-default hover:bg-surface-sunken',
  ghost: 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
  danger: 'bg-safety-critical text-text-inverse hover:opacity-90',
};

const sizes: Record<Size, string> = {
  // Target sizes come from the plan's touch/motor rule (44 px min for touch, 32 px for compact pointer work).
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-base',
};

export function Button({ variant = 'secondary', size = 'md', busy, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      aria-busy={busy || undefined}
      disabled={rest.disabled || busy}
      className={cx(base, variants[variant], sizes[size], className)}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
    />
  );
}
