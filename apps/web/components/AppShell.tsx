'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button, SyncPill, cx } from '@dizi/ui';
import { useShell, type Density, type Locale, type Role } from '@/lib/shell';
import { roleLabels, t } from '@/lib/i18n';
import { patients } from '@/lib/mock';

/* -----------------------------------------------------------------------------
 * AppShell (plan 02 §5 #1) — role-aware navigation, global search, command palette, notification centre,
 * help drawer, density/language/role switches and the sync indicator.
 *
 * The legacy product used a 30-item flat sidebar, a "Quick Add" dropdown and a modal bed board. Nothing here
 * is a dropdown of 30 links: navigation is grouped, searchable (⌘K) and role-filtered.
 */

const NAV: Array<{ key: string; href: string; roles: Role[] }> = [
  { key: 'nav.dashboard', href: '/', roles: ['receptionist', 'doctor', 'pharmacist', 'billing', 'admin'] },
  { key: 'nav.patients', href: '/patients', roles: ['receptionist', 'doctor', 'pharmacist', 'billing', 'admin'] },
  { key: 'nav.appointments', href: '/appointments', roles: ['receptionist', 'doctor', 'admin'] },
  { key: 'nav.clinical', href: '/clinical', roles: ['doctor', 'admin'] },
  { key: 'nav.diagnostics', href: '/diagnostics', roles: ['doctor', 'admin'] },
  { key: 'nav.pharmacy', href: '/pharmacy', roles: ['pharmacist', 'admin'] },
  { key: 'nav.billing', href: '/billing', roles: ['billing', 'receptionist', 'admin'] },
  { key: 'nav.inventory', href: '/inventory', roles: ['pharmacist', 'admin'] },
  { key: 'nav.reports', href: '/reports', roles: ['admin', 'billing'] },
  { key: 'nav.admin', href: '/admin', roles: ['admin'] },
  { key: 'nav.help', href: '/help', roles: ['receptionist', 'doctor', 'pharmacist', 'billing', 'admin'] },
];

const HELP_TOPICS = [
  { title: 'Registering a patient', source: 'docs/help-library/patient/registering-a-patient.md' },
  { title: 'Booking an appointment', source: 'docs/help-library/appointment/how-to-book-an-appointment.md' },
  { title: 'Dispensing medicines', source: 'docs/help-library/pharmacy/dispense-medicine.md' },
  { title: 'Raising an invoice', source: 'docs/help-library/billing/create-invoice.md' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { locale, setLocale, density, setDensity, role, setRole, sync, setSync, queued, flushQueue } = useShell();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl-K opens the palette; Escape closes whatever is open. Keyboard-first, as the plan requires.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setHelpOpen(false);
        setNotifOpen(false);
      }
      if (e.key === '/' && e.target === document.body) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visibleNav = NAV.filter((n) => n.roles.includes(role));
  const searchResults = query.length >= 2
    ? patients.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.mrn.toLowerCase().includes(query.toLowerCase()) || p.phone.includes(query)).slice(0, 6)
    : [];

  return (
    <div className="flex min-h-screen">
      {/* --------------------------------------------------------------- sidebar */}
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-border-subtle bg-surface-raised lg:flex">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <span aria-hidden className="grid size-8 place-items-center rounded-md bg-brand-500 text-sm font-bold text-text-inverse">D</span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-text-primary">DiziHospital</p>
            <p className="text-xs text-text-tertiary">Main Campus · edge</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Main navigation">
          <ul className="flex flex-col gap-0.5">
            {visibleNav.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex items-center rounded-md px-3 py-2 text-base',
                      active ? 'bg-brand-50 font-medium text-brand-700' : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
                    )}
                  >
                    {t(item.key, locale)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-border-subtle p-3">
          <p className="text-xs text-text-tertiary">Phase 0 shell · {t('shell.hospital', locale)}</p>
        </div>
      </aside>

      {/* ----------------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-border-subtle bg-surface-raised">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="relative min-w-64 flex-1">
              <label htmlFor="global-search" className="sr-only">
                {t('shell.search', locale)}
              </label>
              <input
                id="global-search"
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`${t('shell.search', locale)}   ( / )`}
                className="h-[var(--dizi-density-field-height)] w-full max-w-xl rounded-md border border-border-default bg-surface-default px-3 text-base"
              />
              {searchResults.length > 0 && (
                <ul className="absolute z-40 mt-1 w-full max-w-xl rounded-md border border-border-subtle bg-surface-raised shadow-lg">
                  {searchResults.map((p) => (
                    <li key={p.mrn}>
                      <Link href="/patients" className="flex items-center justify-between px-3 py-2 text-sm hover:bg-surface-sunken">
                        <span>
                          {p.name} <span className="text-text-tertiary">{locale === 'bn' ? p.nameBn : ''}</span>
                        </span>
                        <span className="font-numeric text-xs text-text-tertiary">
                          {p.mrn} · {p.phone}
                        </span>
                      </Link>
                    </li>
                  ))}
                  <li className="border-t border-border-subtle px-3 py-1.5 text-xs text-text-tertiary">
                    Press ⌘K for actions: “new appointment”, “dispense”, “raise invoice”
                  </li>
                </ul>
              )}
            </div>

            {/* sync state — the same vocabulary the staff see (02 §11) */}
            <button type="button" onClick={() => setSimulateOpen((o) => !o)} aria-expanded={simulateOpen} className="rounded-full">
              <SyncPill state={sync} count={queued.length} />
            </button>
            {simulateOpen && (
              <div className="absolute right-3 top-14 z-40 w-72 rounded-md border border-border-subtle bg-surface-raised p-3 shadow-lg">
                <p className="mb-2 text-xs font-semibold text-text-secondary">{t('sync.simulate', locale)}</p>
                <div className="flex flex-wrap gap-1">
                  {(['live', 'lanOnly', 'queued', 'syncing', 'conflict'] as const).map((s) => (
                    <Button key={s} size="sm" variant={sync === s ? 'primary' : 'secondary'} onClick={() => setSync(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-text-tertiary">
                  {t('sync.pending', locale)}: {queued.length}. {queued.length > 0 && (
                    <button type="button" className="text-brand-600 underline" onClick={flushQueue}>
                      {t('sync.drain', locale)}
                    </button>
                  )}
                </p>
              </div>
            )}

            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setPaletteOpen(true)} title="⌘K">
                ⌘K
              </Button>
              <div className="relative">
                <Button size="sm" variant="ghost" onClick={() => setNotifOpen((o) => !o)} aria-expanded={notifOpen}>
                  🔔<span className="sr-only">{t('shell.notifications', locale)}</span>
                  <span className="ml-1 rounded-full bg-safety-critical px-1.5 text-xs text-text-inverse">3</span>
                </Button>
                {notifOpen && (
                  <div className="absolute right-0 z-40 mt-1 w-80 rounded-md border border-border-subtle bg-surface-raised p-2 shadow-lg">
                    {[
                      ['Critical potassium result — Bed 12', 'Acknowledge', 'critical'],
                      ['Appointment approved — Nasrin Akter', 'View', 'info'],
                      ['Stock low: Amoxicillin 500 mg', 'Raise indent', 'warning'],
                    ].map(([text, action, severity]) => (
                      <div key={text} className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-sunken">
                        <span className="text-sm">
                          <span aria-hidden className={cx('mr-1', severity === 'critical' ? 'text-safety-critical' : severity === 'warning' ? 'text-safety-warning' : 'text-safety-info')}>
                            ●
                          </span>
                          {text}
                        </span>
                        <button type="button" className="text-xs font-medium text-brand-600">
                          {action}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <select
                aria-label={t('shell.role', locale)}
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="h-8 rounded-md border border-border-default bg-surface-default px-2 text-sm"
              >
                {Object.entries(roleLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v[locale]}
                  </option>
                ))}
              </select>

              <select
                aria-label={t('shell.density', locale)}
                value={density}
                onChange={(e) => setDensity(e.target.value as Density)}
                className="h-8 rounded-md border border-border-default bg-surface-default px-2 text-sm"
              >
                <option value="comfortable">{t('shell.comfortable', locale)}</option>
                <option value="compact">{t('shell.compact', locale)}</option>
              </select>

              <button
                type="button"
                onClick={() => setLocale((locale === 'en' ? 'bn' : 'en') as Locale)}
                className="h-8 rounded-md border border-border-default bg-surface-default px-2 text-sm"
                aria-label={t('shell.language', locale)}
              >
                {locale === 'en' ? 'বাংলা' : 'English'}
              </button>

              <Button size="sm" variant="ghost" onClick={() => setHelpOpen(true)}>
                ?
              </Button>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4">{children}</main>
      </div>

      {/* -------------------------------------------------------- command palette */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-surface-overlay p-4 pt-24" role="dialog" aria-modal="true" aria-label={t('shell.palette', locale)}>
          <div className="w-full max-w-xl rounded-lg border border-border-subtle bg-surface-raised shadow-xl">
            <input
              autoFocus
              placeholder='Try “new appointment for Fatema”, “dispense”, “raise invoice”'
              className="w-full rounded-t-lg border-b border-border-subtle bg-transparent px-4 py-3 text-md outline-none"
            />
            <ul className="max-h-80 overflow-y-auto p-2">
              {[
                ['Register a new patient', '/patients/new'],
                ['Book an appointment', '/appointments'],
                ['Start an OPD consultation', '/clinical'],
                ['Dispense medicines', '/pharmacy'],
                ['Raise an invoice', '/billing'],
                ['Search patients', '/patients'],
              ].map(([label, href]) => (
                <li key={label}>
                  <Link href={href} onClick={() => setPaletteOpen(false)} className="block rounded-sm px-3 py-2 text-base hover:bg-surface-sunken">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="border-t border-border-subtle px-4 py-2 text-xs text-text-tertiary">Esc to close · Enter to open</p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- help drawer */}
      {helpOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-96 border-l border-border-subtle bg-surface-raised shadow-xl" role="dialog" aria-modal="true" aria-label={t('shell.help', locale)}>
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <p className="font-semibold">{t('shell.help', locale)}</p>
            <Button size="sm" variant="ghost" onClick={() => setHelpOpen(false)}>
              Close
            </Button>
          </div>
          <div className="p-4">
            <p className="mb-2 text-sm text-text-secondary">Contextual guides (mirrored vendor help library, reviewed):</p>
            <ul className="flex flex-col gap-1">
              {HELP_TOPICS.map((h) => (
                <li key={h.title} className="rounded-md border border-border-subtle px-3 py-2">
                  <p className="text-base">{h.title}</p>
                  <p className="font-numeric text-xs text-text-tertiary">{h.source}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-text-tertiary">
              Help content is versioned with the app so it can never describe a screen that no longer exists.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
