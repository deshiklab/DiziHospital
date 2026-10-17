'use client';

import { useId } from 'react';
import { cx } from './cx';

/* ---------------------------------------------------------------- primitives
 * Form kit v0 (plan 02 §5 #4). Rules being established here, which every later field must follow:
 *  - visible label, always (the legacy screens shipped unlabelled controls)
 *  - help text next to the field, not in a tooltip you cannot reach with a keyboard
 *  - error text is associated with the input and announced, not coloured-red-only
 *  - required fields are marked for screen readers, not just visually
 *  - height comes from the density tokens, so compact mode is a token change, not a CSS override
 */

const controlBase =
  'w-full rounded-md border bg-surface-default px-3 text-base text-text-primary placeholder:text-text-tertiary ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-500 disabled:bg-surface-sunken disabled:text-text-disabled';
const controlNormal = 'border-border-default';
const controlError = 'border-safety-critical';

/** Field height follows the user's density preference (see apps/web/app/globals.css). */
const fieldHeight = 'h-[var(--dizi-density-field-height)]';

interface FieldShell {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

function Shell({ label, name, hint, error, required, className, children }: FieldShell & { children: (ids: { id: string; describedBy?: string }) => React.ReactNode }) {
  const id = `${name}-${useId()}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text-secondary">
        {label}
        {required && <span className="text-safety-critical"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children({ id, describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-text-tertiary">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-safety-critical">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name'> {
  label: string;
  name: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, name, hint, error, required, className, ...rest }: TextFieldProps) {
  return (
    <Shell label={label} name={name} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy }) => (
        <input
          {...rest}
          id={id}
          name={name}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(controlBase, fieldHeight, error ? controlError : controlNormal)}
        />
      )}
    </Shell>
  );
}

export interface SelectFieldProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'name'> {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export function SelectField({ label, name, hint, error, options, placeholder, required, className, ...rest }: SelectFieldProps) {
  return (
    <Shell label={label} name={name} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy }) => (
        <select
          {...rest}
          id={id}
          name={name}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(controlBase, fieldHeight, error ? controlError : controlNormal)}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Shell>
  );
}

export interface TextAreaFieldProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'name'> {
  label: string;
  name: string;
  hint?: string;
  error?: string;
}

export function TextAreaField({ label, name, hint, error, required, className, rows = 3, ...rest }: TextAreaFieldProps) {
  return (
    <Shell label={label} name={name} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy }) => (
        <textarea
          {...rest}
          id={id}
          name={name}
          rows={rows}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(controlBase, 'py-2', error ? controlError : controlNormal)}
        />
      )}
    </Shell>
  );
}

export interface CheckboxFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'type'> {
  label: string;
  name: string;
  hint?: string;
}

export function CheckboxField({ label, name, hint, className, ...rest }: CheckboxFieldProps) {
  const id = `${name}-${useId()}`;
  return (
    <div className={cx('flex items-start gap-2', className)}>
      <input {...rest} id={id} name={name} type="checkbox" className="mt-0.5 size-4 rounded-sm border-border-default text-brand-500 focus:ring-brand-300" />
      <div className="flex flex-col">
        <label htmlFor={id} className="text-base text-text-primary">
          {label}
        </label>
        {hint && <p className="text-xs text-text-tertiary">{hint}</p>}
      </div>
    </div>
  );
}

/** Groups fields into titled sections — the legacy 19-field modal becomes five scannable sections. */
export function FieldSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-border-subtle bg-surface-default p-4">
      <legend className="px-1 text-sm font-semibold text-text-primary">{title}</legend>
      {description && <p className="mb-3 text-xs text-text-tertiary">{description}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </fieldset>
  );
}
