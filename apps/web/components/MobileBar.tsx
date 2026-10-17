'use client';

import Link from 'next/link';
import { cx } from '@dizi/ui';
import { Home, Menu as MenuIcon, Search, Users, X } from 'lucide-react';
import { t } from '@/lib/nav';
import type { Locale } from '@/lib/shell';

/* ---------------------------------------------------------------------------- MobileBar
 * The thumb bar.
 *
 * On a phone the header is at the top of the screen and the footer sits at the bottom of a long page, so the one
 * control a nurse at a bedside or a clerk at a counter actually reaches for is the menu — and it needs to be
 * under the thumb, not eight screens down. This bar is fixed to the bottom edge: dashboard, patient register,
 * search, and the navigation drawer.
 *
 * Stacking, because it is the whole point of the thing:
 *   Tooltip 90 · Sheet 72–80 · shell popovers 68 · **this bar 65** · drawer and palette backdrop 60 · header 40
 * The bar sits ABOVE the drawer's backdrop and the panel stops above it, so the menu button stays visible and
 * live while the drawer is open — press it again and the drawer closes, which is what a button like this has to
 * do. It sits BELOW modals: a sheet or a tooltip covers it.
 *
 * Four columns, each a full-height target well past the 24 px minimum, icon plus label, no hover-only meaning,
 * `no-print`, and `lg:hidden` — at desk width the header already carries these controls.
 */

const ITEM = 'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[11px] font-medium';
const IDLE = 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary';
const CURRENT = 'bg-brand-50 text-brand-700';

export function MobileBar({
  locale,
  pathname,
  menuOpen,
  onMenuToggle,
  onSearch,
  triggerId,
}: {
  locale: Locale;
  pathname: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onSearch: () => void;
  /** id of the drawer trigger, so the drawer can point `aria-controls` at itself and restore focus here. */
  triggerId: string;
}) {
  const onHome = pathname === '/';
  const onPatients = pathname === '/patients' || pathname.startsWith('/patients/');

  return (
    <nav
      aria-label={t('bar.primary', locale)}
      className="dizi-bar no-print fixed inset-x-0 bottom-0 z-[65] flex items-stretch gap-1 border-t border-border-subtle bg-surface-raised px-1 lg:hidden"
      style={{
        height: 'calc(var(--dizi-mobile-bar) + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <Link href="/" aria-current={onHome ? 'page' : undefined} className={cx(ITEM, onHome ? CURRENT : IDLE)}>
        <Home className="size-5" aria-hidden />
        <span>{t('bar.home', locale)}</span>
      </Link>
      <Link
        href="/patients"
        aria-current={onPatients ? 'page' : undefined}
        className={cx(ITEM, onPatients ? CURRENT : IDLE)}
      >
        <Users className="size-5" aria-hidden />
        <span>{t('nav.patients', locale)}</span>
      </Link>
      <button type="button" onClick={onSearch} className={cx(ITEM, IDLE)}>
        <Search className="size-5" aria-hidden />
        <span>{t('bar.find', locale)}</span>
      </button>
      <button
        type="button"
        id={triggerId}
        onClick={onMenuToggle}
        aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
        title={menuOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={menuOpen}
        aria-controls="mobile-nav-panel"
        className={cx(ITEM, menuOpen ? CURRENT : IDLE)}
      >
        {menuOpen ? <X className="size-5" aria-hidden /> : <MenuIcon className="size-5" aria-hidden />}
        <span>{menuOpen ? t('shell.closeMenu', locale) : t('shell.menu', locale)}</span>
      </button>
    </nav>
  );
}
