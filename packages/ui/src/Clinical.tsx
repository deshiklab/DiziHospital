'use client';

import { cx } from './cx';

/* --------------------------------------------------------------- clinical UI
 * PatientBanner, SafetyBanner and StatusPill carry clinical meaning (plan 02 §5 #2/#9).
 * Rules: colour is never the only signal (icon + text always), and a safety banner that needs
 * acknowledgement cannot be dismissed by accident.
 */

export interface PatientBannerProps {
  mrn: string;
  name: string;
  age?: number;
  sex?: string;
  bed?: string;
  payer?: string;
  allergies?: string[];
  alerts?: string[];
  extra?: Array<{ label: string; value: string }>;
}

export function PatientBanner({ mrn, name, age, sex, bed, payer, allergies = [], alerts = [], extra = [] }: PatientBannerProps) {
  return (
    <section aria-label="Patient summary" className="rounded-lg border border-border-subtle bg-surface-raised p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-xl font-semibold text-text-primary">{name}</h2>
        <span className="font-numeric text-sm text-text-secondary">{mrn}</span>
        {(age || sex) && (
          <span className="text-sm text-text-secondary">
            {age ? `${age} y` : ''} {sex ?? ''}
          </span>
        )}
        {bed && <span className="text-sm text-text-secondary">Bed {bed}</span>}
        {payer && <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-text-secondary">{payer}</span>}
        {extra.map((e) => (
          <span key={e.label} className="text-sm text-text-secondary">
            <span className="text-text-tertiary">{e.label}: </span>
            {e.value}
          </span>
        ))}
      </div>

      {(allergies.length > 0 || alerts.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {allergies.map((a) => (
            <span
              key={a}
              className="inline-flex items-center gap-1 rounded-full border border-safety-critical px-2 py-0.5 text-xs font-semibold text-safety-critical"
            >
              <span aria-hidden>⚠</span> Allergy: {a}
            </span>
          ))}
          {alerts.map((a) => (
            <span key={a} className="inline-flex items-center gap-1 rounded-full border border-safety-warning px-2 py-0.5 text-xs font-semibold text-safety-warning">
              <span aria-hidden>!</span> {a}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export type Severity = 'critical' | 'warning' | 'info' | 'success';

const severityStyles: Record<Severity, string> = {
  critical: 'border-safety-critical text-safety-critical bg-[color-mix(in_srgb,var(--dizi-color-safety-critical)_8%,white)]',
  warning: 'border-safety-warning text-safety-warning bg-[color-mix(in_srgb,var(--dizi-color-safety-warning)_8%,white)]',
  info: 'border-safety-info text-safety-info bg-[color-mix(in_srgb,var(--dizi-color-safety-info)_8%,white)]',
  success: 'border-safety-success text-safety-success bg-[color-mix(in_srgb,var(--dizi-color-safety-success)_8%,white)]',
};

const severityIcon: Record<Severity, string> = { critical: '⚠', warning: '!', info: 'i', success: '✓' };

export interface SafetyBannerProps {
  severity: Severity;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  /** When true the banner requires an explicit acknowledgement instead of a dismiss button. */
  requiresAcknowledgement?: boolean;
  onAcknowledge?: () => void;
}

export function SafetyBanner({ severity, title, children, action, requiresAcknowledgement, onAcknowledge }: SafetyBannerProps) {
  return (
    <div role={severity === 'critical' ? 'alert' : 'status'} className={cx('flex items-start gap-3 rounded-lg border p-3', severityStyles[severity])}>
      <span aria-hidden className="mt-0.5 font-bold">
        {severityIcon[severity]}
      </span>
      <div className="flex-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-sm text-text-secondary">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {requiresAcknowledgement && (
        <button
          type="button"
          onClick={onAcknowledge}
          className="rounded-md border border-current px-3 py-1 text-sm font-medium"
        >
          Acknowledge
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- sync state
 * Connectivity and sync states are first-class UI (plan 02 §11). The pill never says "synced" for a record
 * that only exists on the device, and every state pairs colour with an icon and a word.
 */
export type SyncState = 'live' | 'lanOnly' | 'queued' | 'syncing' | 'conflict' | 'stale';

const syncStyle: Record<SyncState, { cls: string; icon: string; label: string; title: string }> = {
  live: { cls: 'text-safety-success border-safety-success', icon: '☁✓', label: 'Synced', title: 'All records are stored on the hospital server' },
  lanOnly: { cls: 'text-text-secondary border-border-default', icon: '⌂', label: 'Local', title: 'Working on the hospital network; the internet link is down and nothing is blocked' },
  queued: { cls: 'text-safety-warning border-safety-warning', icon: '⟳', label: 'Waiting to sync', title: 'Records saved on this device will sync when the connection returns' },
  syncing: { cls: 'text-safety-info border-safety-info', icon: '↻', label: 'Syncing', title: 'Sending queued records to the server' },
  conflict: { cls: 'text-safety-critical border-safety-critical', icon: '⚠', label: 'Needs review', title: 'Another user changed the same field; this needs a human decision' },
  stale: { cls: 'text-text-secondary border-border-default', icon: '◷', label: 'As of', title: 'Showing cached data' },
};

export function SyncPill({ state, count, asOf, className }: { state: SyncState; count?: number; asOf?: string; className?: string }) {
  const s = syncStyle[state];
  const label = state === 'stale' && asOf ? `${s.label} ${asOf}` : count && state === 'queued' ? `${s.label} (${count})` : s.label;
  return (
    <span
      title={s.title}
      role="status"
      className={cx('inline-flex items-center gap-1.5 rounded-full border bg-surface-raised px-2.5 py-1 text-xs font-medium', s.cls, className)}
    >
      <span aria-hidden>{s.icon}</span>
      {label}
    </span>
  );
}

export function KpiTile({
  label,
  value,
  delta,
  definition,
  asOf,
  footnote,
}: {
  label: string;
  value: string;
  delta?: { value: string; direction: 'up' | 'down' };
  /** Every number must be explainable — the legacy dashboards show 56 % and 30 % for the same thing. */
  definition: string;
  asOf: string;
  footnote?: string;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-default p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">{label}</span>
        <span className="group relative">
          <button type="button" aria-label={`Definition of ${label}`} className="text-text-tertiary hover:text-text-primary">
            ⓘ
          </button>
          <span className="pointer-events-none absolute right-0 z-10 mt-1 hidden w-64 rounded-md border border-border-subtle bg-surface-raised p-2 text-xs text-text-secondary shadow-lg group-focus-within:block group-hover:block">
            {definition}
          </span>
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-numeric text-3xl font-semibold text-text-primary">{value}</span>
        {delta && (
          <span className={cx('text-sm font-medium', delta.direction === 'up' ? 'text-safety-success' : 'text-safety-critical')}>
            {delta.direction === 'up' ? '▲' : '▼'} {delta.value}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-text-tertiary">
        as of {asOf}
        {footnote ? ` · ${footnote}` : ''}
      </p>
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-border-subtle bg-surface-default', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
          {title && <h2 className="text-sm font-semibold text-text-primary">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="font-medium text-text-primary">{title}</p>
      <p className="max-w-md text-sm text-text-secondary">{description}</p>
      {action}
    </div>
  );
}

export function SubNav({ items, className }: { items: Array<{ id: string; label: string; count?: number }>; className?: string }) {
  return (
    <nav aria-label="Sections" className={cx('flex flex-wrap gap-1 border-b border-border-subtle', className)}>
      {items.map((i) => (
        <a
          key={i.id}
          href={`#${i.id}`}
          className="rounded-t-md px-3 py-2 text-sm text-text-secondary hover:bg-surface-sunken hover:text-text-primary aria-[current]:border-b-2 aria-[current]:border-brand-500 aria-[current]:text-brand-600"
        >
          {i.label}
          {typeof i.count === 'number' && <span className="ml-1 font-numeric text-xs text-text-tertiary">{i.count}</span>}
        </a>
      ))}
    </nav>
  );
}
