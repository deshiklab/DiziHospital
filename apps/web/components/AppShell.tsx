'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarDays,
  ChartColumn,
  Check,
  CircleHelp,
  Command,
  FlaskConical,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Maximize,
  Menu as MenuIcon,
  Minimize,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pill,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Stethoscope,
  Type,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  Button,
  Menu,
  SyncPill,
  Tooltip,
  cx,
  useHotkeys,
  useToast,
  useMediaQuery,
} from '@dizi/ui';
import { APP_PHASE, APP_VERSION, TEXT_STEPS, ZOOM_STEPS, useShell, type Density, type Locale, type Role, type SidebarMode } from '@/lib/shell';
import { HOTKEYS, NAV, breadcrumbsFor, roleLabels, t } from '@/lib/nav';
import { MobileBar } from '@/components/MobileBar';
import { MobileNav } from '@/components/MobileNav';
import { patients } from '@/lib/mock';

/* One shape for every header icon button: identical hit area, identical centring, no drift between them.
 *
 * The display utility is NOT part of the shape on purpose. A class list may carry only one *base* display
 * utility, because the winner is decided by the order of the rules in the stylesheet and not by the order in
 * the attribute — and in this build `.hidden` is emitted after `.grid`/`.flex` but BEFORE `.inline`,
 * `.inline-flex` and `.inline-grid`. So `cx(ICON_BTN, 'hidden lg:inline-grid')` with `inline-grid` inside
 * ICON_BTN stayed visible at every width: that is exactly how the sidebar toggle ended up sitting in the
 * mobile header, toggling a rail that does not exist there, and doing nothing at all. Keep the display
 * utility in the same string as `hidden`; never mix two of them.
 */
const ICON_BTN_SHAPE =
  'size-9 shrink-0 place-items-center rounded-md text-text-secondary hover:bg-surface-sunken hover:text-text-primary';
/** Visible at every width. */
const ICON_BTN = `${ICON_BTN_SHAPE} inline-grid`;
/** Desktop only — the sidebar it toggles does not exist below `lg`. */
const ICON_BTN_LG = `${ICON_BTN_SHAPE} hidden lg:inline-grid`;
/** Hidden on the narrowest phones so the header never wraps. */
const ICON_BTN_SM = `${ICON_BTN_SHAPE} hidden sm:inline-grid`;

const ICONS: Record<string, React.ReactNode> = {
  dashboard: <LayoutDashboard className="size-4" aria-hidden />,
  users: <Users className="size-4" aria-hidden />,
  calendar: <CalendarDays className="size-4" aria-hidden />,
  stethoscope: <Stethoscope className="size-4" aria-hidden />,
  flask: <FlaskConical className="size-4" aria-hidden />,
  pill: <Pill className="size-4" aria-hidden />,
  receipt: <Receipt className="size-4" aria-hidden />,
  package: <Package className="size-4" aria-hidden />,
  chart: <ChartColumn className="size-4" aria-hidden />,
  shield: <ShieldCheck className="size-4" aria-hidden />,
  help: <CircleHelp className="size-4" aria-hidden />,
};

/** Sidebar sections: the legacy product had one flat list of 30 items; grouping is the cheapest usability win. */
const SECTIONS: Array<{ id: string; label: { en: string; bn: string }; keys: string[] }> = [
  { id: 'care', label: { en: 'Care', bn: 'সেবা' }, keys: ['nav.dashboard', 'nav.patients', 'nav.appointments', 'nav.clinical', 'nav.diagnostics'] },
  { id: 'ops', label: { en: 'Operations', bn: 'পরিচালনা' }, keys: ['nav.pharmacy', 'nav.billing', 'nav.inventory'] },
  { id: 'system', label: { en: 'Insight & system', bn: 'বিশ্লেষণ ও সিস্টেম' }, keys: ['nav.reports', 'nav.admin', 'nav.help'] },
];

const WIKI_TOPICS = [
  { title: 'Registering a patient', source: 'docs/help-library/patient' },
  { title: 'Booking and rescheduling appointments', source: 'docs/help-library/appointment' },
  { title: 'Dispensing medicines safely', source: 'docs/help-library/pharmacy' },
  { title: 'Raising an invoice and taking payment', source: 'docs/help-library/billing' },
  { title: 'Admitting a patient and the ward board', source: 'docs/help-library/ipd' },
  { title: 'Handling an internet outage (LAN mode)', source: 'docs/plan/02-DESIGN-SYSTEM-UX.md' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    locale, setLocale, density, setDensity, role, setRole,
    sync, setSync, queued, flushQueue,
    sidebarMode, setSidebarMode, toggleSidebar, mobileNavOpen, setMobileNavOpen,
    zoom, setZoom, textScale, setTextScale, fullscreen, toggleFullscreen, version, buildStamp, siteMode,
  } = useShell();
  const { push } = useToast();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const crumbTrail = breadcrumbsFor(pathname, locale);
  const isHalf = sidebarMode === 'half';
  const showSidebar = sidebarMode !== 'hidden';

  const MOBILE_NAV_TRIGGER_ID = 'mobile-nav-trigger';
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [setMobileNavOpen]);
  const toggleMobileNav = useCallback(() => setMobileNavOpen(!mobileNavOpen), [mobileNavOpen, setMobileNavOpen]);
  // Crossing into the desktop layout hides the drawer: leaving it open would leave an invisible panel capturing
  // the keyboard (and the next Escape would go to a drawer nobody can see).
  const desktopLayout = useMediaQuery('(min-width: 1024px)');
  useEffect(() => {
    if (desktopLayout) setMobileNavOpen(false);
  }, [desktopLayout, setMobileNavOpen]);

  /* ------------------------------------------------------------------ shortcuts */
  const hotkeys = useMemo(
    () => [
      { combo: 'mod+k', handler: () => setPaletteOpen((o) => !o) },
      // Ctrl+B collapses the desktop rail; on a phone there is no rail, so it opens the navigation drawer.
      { combo: 'mod+b', handler: () => (window.innerWidth < 1024 ? setMobileNavOpen(!mobileNavOpen) : toggleSidebar()) },
      { combo: '/', handler: () => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 30); } },
      { combo: 'alt+f', handler: () => toggleFullscreen() },
      { combo: 'alt+z', handler: () => setZoom(Math.min(1.5, ZOOM_STEPS[Math.min(ZOOM_STEPS.indexOf(zoom as never) + 1, ZOOM_STEPS.length - 1)])) },
      { combo: 'alt+shift+z', handler: () => setZoom(Math.max(0.8, ZOOM_STEPS[Math.max(ZOOM_STEPS.indexOf(zoom as never) - 1, 0)])) },
      { combo: 'alt+t', handler: () => setTextScale(TEXT_STEPS[(TEXT_STEPS.indexOf(textScale as never) + 1) % TEXT_STEPS.length]) },
      { combo: 'shift+?', handler: () => setHotkeysOpen(true) },
      { combo: 'escape', handler: () => { setPaletteOpen(false); setHelpOpen(false); setHotkeysOpen(false); setNotifOpen(false); setDisplayOpen(false); setSearchOpen(false); setMobileNavOpen(false); } },
    ],
    [toggleSidebar, toggleFullscreen, zoom, setZoom, textScale, setTextScale, mobileNavOpen, setMobileNavOpen],
  );
  useHotkeys(hotkeys);

  // On mobile the drawer must close whenever the route changes, or the user lands "inside" a closed menu.
  useEffect(() => {
    closeMobileNav();
    setNotifOpen(false);
    setDisplayOpen(false);
    setSyncOpen(false);
  }, [pathname, setMobileNavOpen]);

  const results = query.length >= 2
    ? patients
        .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.mrn.toLowerCase().includes(query.toLowerCase()) || p.phone.includes(query))
        .slice(0, 6)
    : [];

  const cycleZoom = (dir: 1 | -1) => {
    const index = ZOOM_STEPS.indexOf(zoom as never);
    const next = Math.min(Math.max(index + dir, 0), ZOOM_STEPS.length - 1);
    setZoom(ZOOM_STEPS[next]);
    push({ title: `Zoom ${Math.round(ZOOM_STEPS[next] * 100)}%`, tone: 'info' });
  };

  const quickActions = [
    { label: 'Register a patient', href: '/patients/new', keys: 'Alt+1' },
    { label: 'Book an appointment', href: '/appointments', keys: 'Alt+2' },
    { label: 'Raise an invoice', href: '/billing', keys: 'Alt+3' },
    { label: 'Search patients', href: '/patients', keys: 'Alt+4' },
  ];

  const sidebarBody = (mode: SidebarMode) => (
    <nav className="flex-1 overflow-y-auto p-2" aria-label="Main navigation">
      {SECTIONS.map((section, sectionIndex) => {
        const items = NAV.filter((n) => section.keys.includes(n.key) && n.roles.includes(role));
        if (items.length === 0) return null;
        return (
          <div
            key={section.id}
            className={cx(
              'mb-2',
              // In the rail the section headings are gone, so a divider keeps the grouping readable.
              mode === 'half' && sectionIndex > 0 && 'mt-2 border-t border-border-subtle pt-2',
            )}
          >
            {mode === 'full' && (
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                {section.label[locale]}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                const link = (
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'rounded-md text-base',
                      // The rail uses a fixed 40 px grid cell so every icon sits on the same centre line,
                      // rather than relying on padding that shifts with label length.
                      mode === 'full' ? 'flex items-center gap-3 px-3 py-2' : 'grid size-10 place-items-center',
                      active ? 'bg-brand-50 font-medium text-brand-700' : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
                    )}
                  >
                    <span className="shrink-0">{ICONS[item.icon]}</span>
                    {mode === 'full' && <span className="min-w-0 flex-1 truncate">{t(item.key, locale)}</span>}
                    {mode === 'full' && item.owner === 'legacy' && (
                      <span className="shrink-0 rounded-full border border-border-subtle px-1.5 text-[10px] text-text-tertiary">legacy</span>
                    )}
                  </Link>
                );
                return (
                  <li key={item.key} className={cx(mode === 'half' && 'flex justify-center')}>
                    {mode === 'half' ? (
                      <Tooltip
                        side="right"
                        flip={false}
                        title={t(item.key, locale)}
                        content={
                          item.owner === 'legacy'
                            ? `Still in the legacy system until ${item.phase}`
                            : 'Owned by the new platform'
                        }
                      >
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  /* --------------------------------------------------------------------- render */
  return (
    <div className="flex min-h-screen flex-col bg-surface-canvas">
      {/* ================================================================== header */}
      <header className="no-print sticky top-0 z-40 border-b border-border-subtle bg-surface-raised">
        <div className="flex items-center gap-2 px-2 py-2 sm:px-3">
          {/* sidebar controls: collapse to a rail on desktop, open a drawer on mobile */}
          {/* The single collapse/expand control for desktop. The sidebar itself no longer carries one,
              which is what made two buttons appear to do the same job. */}
          <Tooltip
            title={showSidebar ? (isHalf ? 'Expand sidebar' : 'Collapse sidebar to icons') : 'Show sidebar'}
            content={
              showSidebar
                ? 'Collapses the sidebar to an icon rail (labels appear on hover) and expands it again.'
                : 'The sidebar is hidden; this brings it back as an icon rail.'
            }
            shortcut="Ctrl+B"
          >
            <button
              type="button"
              onClick={() => {
                // Desktop: collapse to the rail and back. A narrow viewport has no rail, so — should this button
                // ever be visible there again — it opens the navigation drawer instead of doing nothing.
                if (window.innerWidth < 1024) {
                  toggleMobileNav();
                  return;
                }
                if (showSidebar) toggleSidebar();
                else setSidebarMode('half');
              }}
              aria-label={showSidebar ? (isHalf ? 'Expand sidebar' : 'Collapse sidebar to icons') : 'Show sidebar'}
              aria-pressed={showSidebar}
              className={ICON_BTN_LG}
            >
              {showSidebar && !isHalf ? <PanelLeftClose className="size-4" aria-hidden /> : <PanelLeftOpen className="size-4" aria-hidden />}
            </button>
          </Tooltip>
          {/* No panel icon here on phones and tablets: the header's left edge is the one place a
              panel-shaped icon reads as "expand the sidebar", and there is no sidebar to expand on a phone.
              Navigation is opened from the Menu button in the footer instead. */}

          <Link href="/" className="hidden items-center gap-2 sm:flex">
            <span aria-hidden className="grid size-8 place-items-center rounded-md bg-brand-500 text-sm font-bold text-text-inverse">D</span>
            <span className="hidden leading-tight xl:block">
              <span className="block text-sm font-semibold">DiziHospital</span>
              <span className="block text-xs text-text-tertiary">{t('shell.hospital', locale)}</span>
            </span>
          </Link>

          {/* global search: collapses to an icon on small screens so the header never wraps */}
          <div className={cx('relative', searchOpen ? 'flex-1 md:flex-none' : 'ml-auto')}>
            {!searchOpen && (
              <button
                type="button"
                onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 30); }}
                className="flex h-9 items-center gap-2 rounded-md border border-border-default bg-surface-default px-2.5 text-sm text-text-tertiary hover:bg-surface-sunken md:w-72 xl:w-96"
              >
                <Search className="size-4" aria-hidden />
                <span className="hidden truncate md:inline">{t('shell.search', locale)}</span>
                <kbd className="ml-auto hidden font-numeric text-[10px] md:inline">/</kbd>
              </button>
            )}
            {searchOpen && (
              <>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => { if (!query) setSearchOpen(false); }}
                  placeholder={t('shell.search', locale)}
                  aria-label={t('shell.search', locale)}
                  className="h-9 w-full rounded-md border border-brand-300 bg-surface-default pl-8 pr-8 text-base md:w-80 xl:w-96"
                />
                <button
                  type="button"
                  aria-label="Close search"
                  onClick={() => { setSearchOpen(false); setQuery(''); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </>
            )}
            {searchOpen && results.length > 0 && (
              <ul className="absolute z-[68] mt-1 w-full min-w-80 rounded-md border border-border-subtle bg-surface-raised shadow-lg">
                {results.map((p) => (
                  <li key={p.mrn}>
                    <Link href={`/patients/${p.mrn}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-surface-sunken">
                      <span>
                        {p.name}
                        {locale === 'bn' && <span className="ml-2 text-text-tertiary">{p.nameBn}</span>}
                      </span>
                      <span className="font-numeric text-xs text-text-tertiary">{p.mrn} · {p.phone}</span>
                    </Link>
                  </li>
                ))}
                <li className="border-t border-border-subtle px-3 py-1.5 text-xs text-text-tertiary">
                  ⌘K opens actions: “new appointment”, “dispense”, “raise invoice”
                </li>
              </ul>
            )}
          </div>

          {/* sync state — same words the staff use */}
          <div className="relative">
            <Tooltip title="Connection" content="Every screen shows whether your work is on the hospital server or still on this device.">
              <button type="button" onClick={() => setSyncOpen((o) => !o)} aria-expanded={syncOpen} aria-label={`Connection: ${sync}`}>
                <SyncPill state={sync} count={queued.length} />
              </button>
            </Tooltip>
            {syncOpen && (
              <div className="absolute right-0 z-[68] mt-1 w-80 rounded-md border border-border-subtle bg-surface-raised p-3 shadow-lg">
                <p className="mb-2 text-xs font-semibold text-text-secondary">{t('sync.simulate', locale)}</p>
                <div className="flex flex-wrap gap-1">
                  {(['live', 'lanOnly', 'queued', 'syncing', 'conflict'] as const).map((s) => (
                    <Button key={s} size="sm" variant={sync === s ? 'primary' : 'secondary'} onClick={() => setSync(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
                <div className="mt-2 text-xs text-text-tertiary">
                  <p>
                    {t('sync.pending', locale)}: {queued.length}
                    {queued.length === 0 && ` — ${t('sync.nothingPending', locale)}`}
                  </p>
                  {queued.length > 0 && (
                    <>
                      <ul className="mt-1 space-y-0.5">
                        {queued.map((q) => (
                          <li key={q.id} className="font-numeric">{q.at} · {q.label}</li>
                        ))}
                      </ul>
                      <button type="button" className="text-brand-600 underline" onClick={flushQueue}>
                        {t('sync.drain', locale)}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* hot actions */}
          <Menu
            label="Quick actions"
            align="right"
            trigger={({ toggle, ref, open }) => (
              <Tooltip title="Quick actions" content="The tasks that start most of the work in the hospital." shortcut="Alt+1…4">
                <button
                  ref={ref}
                  type="button"
                  onClick={toggle}
                  aria-expanded={open}
                  aria-haspopup="menu"
                  className="inline-grid size-9 shrink-0 place-items-center rounded-md bg-brand-500 text-text-inverse hover:bg-brand-600"
                  aria-label="Quick actions"
                >
                  <Plus className="size-4" aria-hidden />
                </button>
              </Tooltip>
            )}
            items={quickActions.map((a) => ({ label: a.label, shortcut: a.keys, onSelect: () => { window.location.href = a.href; } }))}
          />

          {/* command palette */}
          <Tooltip title="Command palette" content="Jump anywhere or run an action by name." shortcut="Ctrl+K">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label={t('shell.palette', locale)}
              className={ICON_BTN_SM}
            >
              <Command className="size-4" aria-hidden />
            </button>
          </Tooltip>

          {/* notifications */}
          <div className="relative">
            <Tooltip title="Notifications" content="Alerts that need an action, newest first.">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                aria-expanded={notifOpen}
                aria-label={`${t('shell.notifications', locale)}, 3 unread`}
                className={cx(ICON_BTN, 'relative')}
              >
                <Bell className="size-4" aria-hidden />
                <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-safety-critical" aria-hidden />
              </button>
            </Tooltip>
            {notifOpen && (
              <div className="absolute right-0 z-[68] mt-1 w-80 rounded-md border border-border-subtle bg-surface-raised p-2 shadow-lg">
                {[
                  ['Critical potassium result — Bed 12', 'Acknowledge', 'critical'],
                  ['Appointment approved — Nasrin Akter', 'View', 'info'],
                  ['Stock low: Amoxicillin 500 mg', 'Raise indent', 'warning'],
                ].map(([text, action, severity]) => (
                  <div key={text} className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-sunken">
                    <span className="text-sm">
                      <span aria-hidden className={cx('mr-1', severity === 'critical' ? 'text-safety-critical' : severity === 'warning' ? 'text-safety-warning' : 'text-safety-info')}>●</span>
                      {text}
                    </span>
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-600"
                      onClick={() => push({ title: action, description: text, tone: severity === 'critical' ? 'critical' : 'info' })}
                    >
                      {action}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* display controls: zoom / text size / full screen / density */}
          <div className="relative">
            <Tooltip title="Display" content="Zoom, text size, full screen and row density. Preferences are remembered on this device.">
              <button
                type="button"
                onClick={() => setDisplayOpen((o) => !o)}
                aria-expanded={displayOpen}
                aria-label="Display settings"
                className={ICON_BTN}
              >
                <Type className="size-4" aria-hidden />
              </button>
            </Tooltip>
            {displayOpen && (
              <div className="absolute right-0 z-[68] mt-1 w-72 space-y-3 rounded-md border border-border-subtle bg-surface-raised p-3 shadow-lg">
                <div>
                  <p className="mb-1 text-xs font-semibold text-text-secondary">{t('shell.zoom', locale)}</p>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="Zoom out" onClick={() => cycleZoom(-1)} className="grid size-8 place-items-center rounded-md border border-border-default hover:bg-surface-sunken">
                      <ZoomOut className="size-4" aria-hidden />
                    </button>
                    <span className="font-numeric w-14 text-center text-sm">{Math.round(zoom * 100)}%</span>
                    <button type="button" aria-label="Zoom in" onClick={() => cycleZoom(1)} className="grid size-8 place-items-center rounded-md border border-border-default hover:bg-surface-sunken">
                      <ZoomIn className="size-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => setZoom(1)} className="ml-auto text-xs text-brand-600 hover:underline">Reset</button>
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-xs font-semibold text-text-secondary">{t('shell.textSize', locale)}</p>
                  <div className="flex gap-1">
                    {TEXT_STEPS.map((s) => (
                      <Button key={s} size="sm" variant={textScale === s ? 'primary' : 'secondary'} onClick={() => setTextScale(s)}>
                        {s === 0.875 ? 'A−' : s === 1 ? 'A' : s === 1.125 ? 'A+' : 'A++'}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-xs font-semibold text-text-secondary">{t('shell.density', locale)}</p>
                  <div className="flex gap-1">
                    {(['comfortable', 'compact'] as Density[]).map((d) => (
                      <Button key={d} size="sm" variant={density === d ? 'primary' : 'secondary'} onClick={() => setDensity(d)}>
                        {t(d === 'comfortable' ? 'shell.comfortable' : 'shell.compact', locale)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border-subtle pt-2">
                  <span className="text-xs text-text-secondary">{t('shell.fullscreen', locale)}</span>
                  <Button size="sm" onClick={toggleFullscreen} className="gap-1.5">
                    {fullscreen ? <Minimize className="size-3.5" aria-hidden /> : <Maximize className="size-3.5" aria-hidden />}
                    {fullscreen ? 'Exit' : 'Enter'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* language */}
          <Tooltip title="Language" content="Interface language. Clinical terminology follows the reviewed glossary.">
            <button
              type="button"
              onClick={() => setLocale((locale === 'en' ? 'bn' : 'en') as Locale)}
              className="h-9 rounded-md border border-border-default bg-surface-default px-2 text-sm hover:bg-surface-sunken"
              aria-label={t('shell.language', locale)}
            >
              {locale === 'en' ? 'বাংলা' : 'EN'}
            </button>
          </Tooltip>

          {/* wiki & help */}
          <Tooltip title="Help & wiki" content="Guides for the screen you are on, plus the full help library." shortcut="Shift+?">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label={t('shell.help', locale)}
              className={ICON_BTN}
            >
              <CircleHelp className="size-4" aria-hidden />
            </button>
          </Tooltip>

          {/* user + version */}
          <Menu
            label="Account"
            align="right"
            trigger={({ toggle, ref, open }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-haspopup="menu"
                className="flex h-9 items-center gap-2 rounded-md border border-border-default bg-surface-default px-2 text-sm hover:bg-surface-sunken"
              >
                <span aria-hidden className="grid size-6 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                  {roleLabels[role].en.slice(0, 1)}
                </span>
                <span className="hidden lg:inline">{roleLabels[role][locale]}</span>
              </button>
            )}
            items={[
              { label: 'Signed in as', hint: roleLabels[role].en, disabled: true },
              { label: `Version ${version}`, hint: `${APP_VERSION === version ? 'Phase 0 shell' : ''} · build ${buildStamp}`, disabled: true, separated: true },
              { label: 'Switch role', onSelect: () => setRole(nextRole(role)), shortcut: 'demo' },
              { label: t('shell.hotkeys', locale), onSelect: () => setHotkeysOpen(true), shortcut: '?' },
              { label: t('shell.signOut', locale), onSelect: () => push({ title: 'Sign out is wired to Keycloak in P0-205', tone: 'info' }), danger: true, separated: true },
            ]}
          />
        </div>
      </header>

      {/* ============================================================ body + sidebar */}
      <div className="flex min-h-0 flex-1">
        <aside
          className={cx(
            'no-print sticky top-[3.25rem] hidden h-[calc(100vh-3.25rem-2.25rem)] shrink-0 flex-col border-r border-border-subtle bg-surface-raised lg:flex',
            isHalf ? 'w-16' : 'w-60',
          )}
        >
          {/* No collapse/expand button here: that control lives in the header only. This row carries the
              site label and the one action the header cannot express — hiding the sidebar completely. */}
          <div className={cx('flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-2', isHalf && 'justify-center')}>
            {isHalf ? (
              <Tooltip side="right" title="DiziHospital" content="Main Campus · edge node">
                <span aria-hidden className="inline-grid size-8 place-items-center rounded-md bg-brand-500 text-xs font-bold text-text-inverse">
                  D
                </span>
              </Tooltip>
            ) : (
              <>
                <span className="truncate text-xs text-text-tertiary">Main Campus · edge</span>
                <Tooltip side="left" title="Hide sidebar" content="Gives the whole width to the table. Bring it back from the header.">
                  <button
                    type="button"
                    onClick={() => setSidebarMode('hidden')}
                    aria-label="Hide sidebar"
                    className="ml-auto inline-grid size-8 shrink-0 place-items-center rounded-md text-text-tertiary hover:bg-surface-sunken hover:text-text-primary"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </Tooltip>
              </>
            )}
          </div>
          {sidebarBody(isHalf ? 'half' : 'full')}
          {!isHalf && (
            <div className="border-t border-border-subtle p-3">
              <p className="text-[11px] text-text-tertiary">
                {t('shell.version', locale)} {version} · build {buildStamp}
              </p>
            </div>
          )}
        </aside>

        <MobileNav open={mobileNavOpen} onClose={closeMobileNav} triggerId={MOBILE_NAV_TRIGGER_ID}>
          {sidebarBody('full')}
        </MobileNav>

        {/* working area: broad and fluid — no max width, the grid decides how wide it needs to be */}
        <main className="min-w-0 flex-1">
          {sidebarMode === 'hidden' && (
            <div className="no-print hidden items-center gap-2 border-b border-border-subtle bg-surface-raised px-3 py-1.5 lg:flex">
              <Button size="sm" onClick={() => setSidebarMode('half')} className="gap-1.5">
                <PanelLeftOpen className="size-3.5" aria-hidden />
                Show sidebar
              </Button>
              <span className="text-xs text-text-tertiary">{t('shell.workingArea', locale)} — the table uses the full width</span>
            </div>
          )}
          <div
            id="content"
            className="p-3 sm:p-4"
            style={{ zoom } as React.CSSProperties}
          >
            {children}
          </div>
        </main>
      </div>

      {/* =================================================================== footer */}
      <footer className="no-print sticky bottom-[calc(var(--dizi-mobile-bar)+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle bg-surface-raised px-3 py-1.5 text-[11px] text-text-tertiary lg:bottom-0">
        {/* The breadcrumb trail lives down here, not in the header: the header is for actions, and the trail is
            orientation — it does not need to be at the top, but it does need to be visible on every screen size. */}
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-xs text-text-secondary">
          {crumbTrail.map((c, i) => (
            <span key={c.href + i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span aria-hidden className="text-text-tertiary">/</span>}
              {i === crumbTrail.length - 1 ? (
                <span aria-current="page" className="truncate font-medium text-text-primary">{c.label}</span>
              ) : (
                <Link href={c.href} className="truncate hover:text-brand-600">{c.label}</Link>
              )}
            </span>
          ))}
        </nav>
        <span className="font-numeric">
          DiziHospital <strong className="font-semibold text-text-secondary">{version}</strong> · {APP_PHASE} · build {buildStamp}
        </span>
        <span className="hidden sm:inline">Credits: clinical workflow captured from the legacy system · design tokens from the plan</span>
        <span className="flex items-center gap-3 lg:ml-auto">
          <span className="font-numeric">{t('shell.mode', locale)}: {siteMode}</span>
          <button type="button" onClick={() => setHotkeysOpen(true)} className="inline-flex items-center gap-1 hover:text-text-primary">
            <Keyboard className="size-3" aria-hidden />
            {t('shell.hotkeys', locale)}
          </button>
          <span className="hidden md:inline">All data shown is synthetic</span>
        </span>
      </footer>

      {/* The phone's action bar: dashboard, the patient register, search and the navigation drawer — at the
          bottom edge, under the thumb, instead of at the far end of a long page. `lg:hidden`. */}
      <MobileBar
        locale={locale}
        pathname={pathname}
        menuOpen={mobileNavOpen}
        onMenuToggle={toggleMobileNav}
        onSearch={() => {
          setSearchOpen(true);
          setTimeout(() => searchRef.current?.focus(), 30);
        }}
        triggerId={MOBILE_NAV_TRIGGER_ID}
      />

      {/* ============================================================== overlays */}
      {paletteOpen && (
        <div className="fixed inset-0 z-[72] flex items-start justify-center bg-surface-overlay p-4 pb-24 pt-24 lg:pb-4" role="dialog" aria-modal="true" aria-label={t('shell.palette', locale)}>
          <div className="w-full max-w-xl rounded-lg border border-border-subtle bg-surface-raised shadow-xl">
            <input
              autoFocus
              placeholder='Try “patients”, “dispense”, “raise invoice”'
              className="w-full rounded-t-lg border-b border-border-subtle bg-transparent px-4 py-3 text-md outline-none"
            />
            <ul className="max-h-80 overflow-y-auto p-2">
              {NAV.filter((n) => n.roles.includes(role)).map((n) => (
                <li key={n.key}>
                  <Link href={n.href} onClick={() => setPaletteOpen(false)} className="flex items-center gap-2 rounded-sm px-3 py-2 text-base hover:bg-surface-sunken">
                    {ICONS[n.icon]}
                    {t(n.key, locale)}
                    {n.owner === 'legacy' && <span className="ml-auto rounded-full border border-border-subtle px-1.5 text-[10px] text-text-tertiary">legacy · {n.phase}</span>}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="border-t border-border-subtle px-4 py-2 text-xs text-text-tertiary">Esc closes · ⌘K toggles · every route is a plain link you can copy</p>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="fixed inset-y-0 right-0 z-[60] flex w-[min(28rem,100vw)] flex-col border-l border-border-subtle bg-surface-raised shadow-xl" role="dialog" aria-modal="true" aria-label={t('shell.help', locale)}>
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <p className="font-semibold">{t('shell.help', locale)}</p>
            <button type="button" onClick={() => setHelpOpen(false)} aria-label="Close help" className="grid size-8 place-items-center rounded-md hover:bg-surface-sunken">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <p className="mb-2 text-sm text-text-secondary">
              Contextual guides, mirrored from the vendor help library and reviewed by the team. Help is versioned
              with the app, so it can never describe a screen that no longer exists.
            </p>
            <ul className="flex flex-col gap-1">
              {WIKI_TOPICS.map((h) => (
                <li key={h.title}>
                  <button
                    type="button"
                    onClick={() => push({ title: h.title, description: 'Opens the wiki page in the help library (P0)', tone: 'info' })}
                    className="w-full rounded-md border border-border-subtle px-3 py-2 text-left hover:bg-surface-sunken"
                  >
                    <span className="block text-base">{h.title}</span>
                    <span className="font-numeric block text-xs text-text-tertiary">docs/help-library → {h.source}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Button className="mt-3 w-full" onClick={() => setHotkeysOpen(true)}>
              <Keyboard className="size-4" aria-hidden />
              Keyboard shortcuts
            </Button>
          </div>
        </div>
      )}

      {hotkeysOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-surface-overlay p-4 pt-20" role="dialog" aria-modal="true" aria-label={t('shell.hotkeys', locale)}>
          <div className="w-full max-w-lg rounded-lg border border-border-subtle bg-surface-raised shadow-xl">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <p className="font-semibold">{t('shell.hotkeys', locale)}</p>
              <button type="button" onClick={() => setHotkeysOpen(false)} aria-label="Close shortcuts" className="grid size-8 place-items-center rounded-md hover:bg-surface-sunken">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <ul className="max-h-[60vh] overflow-y-auto p-3">
              {HOTKEYS.map((h) => (
                <li key={h.keys} className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 hover:bg-surface-sunken">
                  <span className="text-sm">{h.label}</span>
                  <span className="flex shrink-0 gap-1">
                    {h.keys.split(/\+|·|…/).map((k, i) => (
                      <kbd key={`${h.keys}-${i}`} className="rounded-sm border border-border-default bg-surface-sunken px-1.5 py-0.5 font-numeric text-[10px] text-text-secondary">
                        {k.trim()}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function nextRole(role: Role): Role {
  const order: Role[] = ['receptionist', 'doctor', 'pharmacist', 'billing', 'admin'];
  return order[(order.indexOf(role) + 1) % order.length];
}
