'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@dizi/ui';
import { ADMIN_GROUPS, adminScreenById, type AdminScreen } from '@/lib/admin';

/* The P7 screens' shared header and section navigation.
 *
 * Eighteen screens is enough for two things to drift: the title a screen shows and the screen the plan says it is.
 * Both read `ADMIN_SCREENS`, so a screen cannot be renamed here and stay the old name in the hub — and the header
 * prints the legacy path it replaces, because a member of staff who used to work in that screen needs to know
 * which one this is.
 *
 * `waiting` is deliberately on the header rather than at the bottom of a long page: what a screen cannot do yet is
 * the first thing somebody auditing the phase needs to see.
 */

export function AdminHeader({
  screenId,
  title,
  subtitle,
  actions,
  waiting,
}: {
  screenId?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  waiting?: string;
}) {
  const screen: AdminScreen | undefined = screenId ? adminScreenById(screenId) : undefined;
  const heading = title ?? screen?.title ?? 'Administration';
  const group = ADMIN_GROUPS.find((g) => g.members.includes(screen?.id ?? ''));

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-text-primary">{heading}</h1>
        <p className="mt-0.5 text-sm text-text-secondary">{subtitle ?? screen?.purpose}</p>
        {screen && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
            <span className="font-numeric">Legacy: {screen.legacy}</span>
            <span>
              Sized {screen.size} · {screen.fields} fields
              {screen.grids > 0 ? ` · ${screen.grids} grid${screen.grids === 1 ? '' : 's'}` : ''}
              {screen.dialogs > 0 ? ` · ${screen.dialogs} dialog${screen.dialogs === 1 ? '' : 's'}` : ''}
            </span>
            {group && <span>{group.title}</span>}
          </p>
        )}
        {waiting && <p className="mt-1 text-xs text-text-tertiary">{waiting}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** The sibling screens of this one, so a section reads as a section rather than a URL. */
export function AdminSiblings({ screenId }: { screenId: string }) {
  const screen = adminScreenById(screenId);
  const group = ADMIN_GROUPS.find((g) => g.members.includes(screenId));
  if (!screen || !group) return null;
  return (
    <nav aria-label="Screens in this section" className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-text-tertiary">{group.title}:</span>
      {group.members.map((id) => {
        const member = adminScreenById(id);
        if (!member) return null;
        const here = member.id === screen.id;
        return (
          <Link
            key={id}
            href={member.route}
            aria-current={here ? 'page' : undefined}
            className={cx(
              'rounded-full border px-2 py-0.5',
              here ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border-subtle text-text-secondary hover:bg-surface-sunken',
            )}
          >
            {member.title.replace(/^.*› /, '')}
          </Link>
        );
      })}
    </nav>
  );
}

/** A row of chips used by the register and the settings screens: label, value, and why it matters. */
export function AdminFact({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-border-subtle px-3 py-2">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="font-medium text-text-primary">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-text-tertiary">{hint}</p>}
    </div>
  );
}
