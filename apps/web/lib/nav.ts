import type { Locale, Role } from './shell';

/* -----------------------------------------------------------------------------
 * Navigation model. One source of truth for the sidebar, breadcrumbs and the command palette, so a route can
 * never exist in the sidebar but be missing from search (the legacy menu and its search disagreed constantly).
 */
export interface NavItem {
  key: string;
  href: string;
  icon: string;
  roles: Role[];
  /** Modules still owned by the legacy system show a "legacy" chip so staff know where records are created. */
  owner?: 'legacy' | 'new';
  phase?: string;
  /**
   * Sub-screens of this module: routes that belong to the module rather than being a module of their own.
   * They appear under the module while it is open, in the command palette as searchable routes, and in the
   * breadcrumb — which is the whole reason they are declared here instead of being hand-typed into the shell.
   */
  children?: Array<{ key: string; href: string }>;
}

export const NAV: NavItem[] = [
  { key: 'nav.dashboard', href: '/', icon: 'dashboard', roles: ['receptionist', 'doctor', 'pharmacist', 'billing', 'admin'], owner: 'new', phase: 'P0' },
  { key: 'nav.patients', href: '/patients', icon: 'users', roles: ['receptionist', 'doctor', 'pharmacist', 'billing', 'admin'], owner: 'new', phase: 'P1', children: [
    { key: 'nav.patients.new', href: '/patients/new' },
    { key: 'nav.patients.import', href: '/patients/import' },
    { key: 'nav.patients.discharged', href: '/patients/discharged' },
  ] },
  { key: 'nav.appointments', href: '/appointments', icon: 'calendar', roles: ['receptionist', 'doctor', 'admin'], owner: 'legacy', phase: 'P1', children: [
    { key: 'nav.appointments.queue', href: '/appointments/queue' },
  ] },
  { key: 'nav.clinical', href: '/clinical', icon: 'stethoscope', roles: ['doctor', 'admin'], owner: 'legacy', phase: 'P2' },
  { key: 'nav.diagnostics', href: '/diagnostics', icon: 'flask', roles: ['doctor', 'admin'], owner: 'new', phase: 'P4', children: [
    { key: 'nav.diagnostics.search', href: '/diagnostics/search' },
  ] },
  { key: 'nav.ward', href: '/ward', icon: 'bed', roles: ['doctor', 'admin'], owner: 'legacy', phase: 'P5' },
  { key: 'nav.round', href: '/round', icon: 'round', roles: ['doctor', 'admin'], owner: 'new', phase: 'P5' },
  { key: 'nav.duty', href: '/duty', icon: 'duty', roles: ['doctor', 'admin'], owner: 'legacy', phase: 'P5' },
  { key: 'nav.ot', href: '/ot', icon: 'theatre', roles: ['doctor', 'admin'], owner: 'legacy', phase: 'P5' },
  { key: 'nav.bloodbank', href: '/bloodbank', icon: 'blood', roles: ['doctor', 'admin'], owner: 'legacy', phase: 'P4' },
  { key: 'nav.pharmacy', href: '/pharmacy', icon: 'pill', roles: ['pharmacist', 'admin'], owner: 'legacy', phase: 'P3', children: [
    { key: 'nav.pharmacy.search', href: '/pharmacy/search' },
    { key: 'nav.pharmacy.returns', href: '/pharmacy/returns' },
  ] },
  { key: 'nav.billing', href: '/billing', icon: 'receipt', roles: ['billing', 'receptionist', 'admin'], owner: 'legacy', phase: 'P2', children: [
    { key: 'nav.billing.opd', href: '/billing/opd' },
    { key: 'nav.billing.patient', href: '/billing/opd-patient' },
    { key: 'nav.billing.appointments', href: '/billing/appointments' },
    { key: 'nav.billing.modules', href: '/billing/modules' },
  ] },
  { key: 'nav.inventory', href: '/inventory', icon: 'package', roles: ['pharmacist', 'admin'], owner: 'legacy', phase: 'P3' },
  { key: 'nav.ambulance', href: '/ambulance', icon: 'ambulance', roles: ['receptionist', 'admin'], owner: 'legacy', phase: 'P4' },
  { key: 'nav.finance', href: '/finance', icon: 'banknote', roles: ['billing', 'admin'], owner: 'new', phase: 'P6', children: [
    { key: 'nav.finance.income', href: '/finance/income' },
    { key: 'nav.finance.expenses', href: '/finance/expenses' },
    { key: 'nav.finance.tpa', href: '/finance/tpa' },
    { key: 'nav.finance.referral', href: '/finance/referral' },
  ] },
  { key: 'nav.setup', href: '/setup', icon: 'setup', roles: ['admin'], owner: 'new', phase: 'P2' },
  { key: 'nav.reports', href: '/reports', icon: 'chart', roles: ['admin', 'billing'], owner: 'legacy', phase: 'P6' },
  { key: 'nav.sync', href: '/sync', icon: 'sync', roles: ['admin'], owner: 'new', phase: 'P0' },
  { key: 'nav.admin', href: '/admin', icon: 'shield', roles: ['admin'], owner: 'legacy', phase: 'P7' },
  { key: 'nav.help', href: '/help', icon: 'help', roles: ['receptionist', 'doctor', 'pharmacist', 'billing', 'admin'], owner: 'new', phase: 'P0' },
];

export const strings: Record<string, { en: string; bn: string }> = {
  'nav.dashboard': { en: 'Dashboard', bn: 'ড্যাশবোর্ড' },
  'nav.patients': { en: 'Patients', bn: 'রোগী' },
  'nav.appointments': { en: 'Appointments', bn: 'অ্যাপয়েন্টমেন্ট' },
  'nav.clinical': { en: 'Clinical', bn: 'ক্লিনিক্যাল' },
  'nav.diagnostics': { en: 'Diagnostics', bn: 'ডায়াগনস্টিক' },
  'nav.ward': { en: 'Ward', bn: 'ওয়ার্ড' },
  'nav.round': { en: 'Round', bn: 'রাউন্ড' },
  'nav.duty': { en: 'Duty roster', bn: 'ডিউটি রোস্টার' },
  'nav.ot': { en: 'Theatre', bn: 'অপারেশন থিয়েটার' },
  'nav.bloodbank': { en: 'Blood bank', bn: 'ব্লাড ব্যাংক' },
  'nav.ambulance': { en: 'Ambulance', bn: 'অ্যাম্বুলেন্স' },
  'nav.finance': { en: 'Finance', bn: 'আর্থিক' },
  'nav.finance.income': { en: 'Income vouchers', bn: 'আয় ভাউচার' },
  'nav.finance.expenses': { en: 'Expense vouchers', bn: 'ব্যয় ভাউচার' },
  'nav.finance.tpa': { en: 'TPA and insurance claims', bn: 'টিপিএ ও বীমা দাবি' },
  'nav.finance.referral': { en: 'Referral commission', bn: 'রেফারেল কমিশন' },
  'nav.setup': { en: 'Setup', bn: 'সেটআপ' },
  'nav.pharmacy': { en: 'Pharmacy', bn: 'ফার্মেসি' },
  'nav.billing': { en: 'Billing', bn: 'বিলিং' },
  'nav.inventory': { en: 'Inventory', bn: 'ইনভেন্টরি' },
  'nav.reports': { en: 'Reports', bn: 'রিপোর্ট' },
  'nav.sync': { en: 'Sync console', bn: 'সিঙ্ক কনসোল' },
  'nav.admin': { en: 'Admin', bn: 'অ্যাডমিন' },
  'nav.help': { en: 'Help', bn: 'সহায়তা' },

  'nav.patients.new': { en: 'Register a patient', bn: 'রোগী নিবন্ধন' },
  'nav.patients.import': { en: 'Import a spreadsheet', bn: 'স্প্রেডশিট ইমপোর্ট' },
  'nav.patients.discharged': { en: 'Discharged patients', bn: 'ডিসচার্জড রোগী' },
  'nav.appointments.queue': { en: 'Today’s queue', bn: 'আজকের সিরিয়াল' },
  'nav.diagnostics.search': { en: 'Result search', bn: 'ফলাফল অনুসন্ধান' },
  'nav.pharmacy.search': { en: 'Medicine search', bn: 'ঔষধ অনুসন্ধান' },
  'nav.pharmacy.returns': { en: 'Sale returns', bn: 'বিক্রয় ফেরত' },
  'nav.billing.opd': { en: 'OPD counter', bn: 'ওপিডি কাউন্টার' },
  'nav.billing.patient': { en: 'OPD patient account', bn: 'ওপিডি রোগীর হিসাব' },
  'nav.billing.appointments': { en: 'Appointment billing', bn: 'অ্যাপয়েন্টমেন্ট বিলিং' },
  'nav.billing.modules': { en: 'Single-module billing', bn: 'একক মডিউল বিলিং' },

  'shell.search': { en: 'Search patients, MRN, phone', bn: 'রোগী, এমআরএন, ফোন খুঁজুন' },
  'shell.palette': { en: 'Command palette', bn: 'কমান্ড প্যালেট' },
  'shell.notifications': { en: 'Notifications', bn: 'বিজ্ঞপ্তি' },
  'shell.help': { en: 'Help & wiki', bn: 'সহায়তা ও উইকি' },
  'shell.language': { en: 'Language', bn: 'ভাষা' },
  'shell.density': { en: 'Density', bn: 'ঘনত্ব' },
  'shell.comfortable': { en: 'Comfortable', bn: 'আরামদায়ক' },
  'shell.compact': { en: 'Compact', bn: 'কমপ্যাক্ট' },
  'shell.role': { en: 'Role', bn: 'ভূমিকা' },
  'shell.hospital': { en: 'Shaheed Suhrawardy General Hospital', bn: 'শহীদ সোহরাওয়ার্দী জেনারেল হাসপাতাল' },
  'shell.zoom': { en: 'Zoom', bn: 'জুম' },
  'shell.textSize': { en: 'Text size', bn: 'লেখার আকার' },
  'shell.fullscreen': { en: 'Full screen', bn: 'ফুল স্ক্রিন' },
  'shell.sidebar': { en: 'Sidebar', bn: 'সাইডবার' },
  'shell.hotkeys': { en: 'Keyboard shortcuts', bn: 'কীবোর্ড শর্টকাট' },
  'shell.menu': { en: 'Menu', bn: 'মেনু' },
  'bar.primary': { en: 'Primary navigation', bn: 'প্রধান নেভিগেশন' },
  'bar.home': { en: 'Home', bn: 'হোম' },
  'bar.find': { en: 'Search', bn: 'খুঁজুন' },
  'shell.closeMenu': { en: 'Close menu', bn: 'মেনু বন্ধ' },
  'shell.signOut': { en: 'Sign out', bn: 'লগ আউট' },
  'shell.version': { en: 'Version', bn: 'সংস্করণ' },
  'shell.credits': { en: 'Credits', bn: 'কৃতিত্ব' },
  'shell.mode': { en: 'Site mode', bn: 'সাইট মোড' },
  'shell.mode.edge': { en: 'Edge authoritative (normal)', bn: 'এজ প্রধান (স্বাভাবিক)' },
  'shell.workingArea': { en: 'Wide workspace', bn: 'প্রশস্ত কর্মক্ষেত্র' },

  'sync.simulate': { en: 'Simulate connection', bn: 'সংযোগ অনুকরণ' },
  'sync.queue': { en: 'Waiting to sync', bn: 'সিঙ্কের অপেক্ষায়' },
  'sync.savedHere': { en: 'Saved on this device', bn: 'এই ডিভাইসে সংরক্ষিত' },
  'sync.savedHereNote': { en: 'It will sync automatically when the connection returns.', bn: 'সংযোগ ফিরলে স্বয়ংক্রিয়ভাবে সিঙ্ক হবে।' },
  'sync.savedServer': { en: 'Saved', bn: 'সংরক্ষিত' },
  'sync.drain': { en: 'Sync now', bn: 'এখনই সিঙ্ক করুন' },
  'sync.pending': { en: 'Pending writes', bn: 'অপেক্ষমাণ এন্ট্রি' },
  'sync.nothingPending': { en: 'Nothing waiting to sync.', bn: 'সিঙ্কের অপেক্ষায় কিছু নেই।' },
};

export const t = (key: string, locale: Locale): string => strings[key]?.[locale] ?? key;

export const roleLabels: Record<Role, { en: string; bn: string }> = {
  receptionist: { en: 'Receptionist', bn: 'রিসেপশনিস্ট' },
  doctor: { en: 'Doctor', bn: 'ডাক্তার' },
  pharmacist: { en: 'Pharmacist', bn: 'ফার্মাসিস্ট' },
  billing: { en: 'Billing officer', bn: 'বিলিং কর্মকর্তা' },
  admin: { en: 'Hospital admin', bn: 'হাসপাতাল অ্যাডমিন' },
};

/** Breadcrumbs: route → trail. A pasted URL always lands on a page that says where it is. */
export function breadcrumbsFor(pathname: string, locale: Locale): Array<{ label: string; href: string }> {
  const trail: Array<{ label: string; href: string }> = [{ label: t('nav.dashboard', locale), href: '/' }];
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return trail;

  const match = NAV.find((n) => n.href === `/${segments[0]}`);
  const sectionLabel = match ? t(match.key, locale) : segments[0];
  trail.push({ label: sectionLabel, href: `/${segments[0]}` });

  const rest = segments.slice(1);
  if (rest.length > 0) {
    // A declared sub-screen is a named place: the trail reads like somewhere you are, not like a path.
    const child = match?.children?.find((c) => c.href === pathname);
    if (child) {
      trail.push({ label: t(child.key, locale), href: pathname });
      return trail;
    }
    // A word or two for the screens that have their own page, so the trail reads like a place and not a path.
    const named: Record<string, { en: string; bn: string }> = {
      new: { en: 'New', bn: 'নতুন' },
      import: { en: 'Import', bn: 'ইমপোর্ট' },
    };
    if (rest.length === 1 && named[rest[0]]) trail.push({ label: named[rest[0]][locale], href: pathname });
    else trail.push({ label: rest.join(' / '), href: pathname });
  }
  return trail;
}

export interface HotkeyRow {
  keys: string;
  label: string;
  scope: 'global' | 'table' | 'form';
}

export const HOTKEYS: HotkeyRow[] = [
  { keys: 'Ctrl+K', label: 'Open the command palette', scope: 'global' },
  { keys: '/', label: 'Focus global search', scope: 'global' },
  { keys: 'Ctrl+B', label: 'Collapse or expand the sidebar', scope: 'global' },
  { keys: 'Alt+F', label: 'Toggle full screen', scope: 'global' },
  { keys: 'Alt+Z', label: 'Zoom in · Alt+Shift+Z zoom out', scope: 'global' },
  { keys: 'Alt+T', label: 'Cycle text size', scope: 'global' },
  { keys: 'Alt+1…3', label: 'Run the three actions of the current screen', scope: 'global' },
  { keys: '?', label: 'Show this shortcut list', scope: 'global' },
  { keys: '↑ ↓', label: 'Move between rows', scope: 'table' },
  { keys: 'Enter', label: 'Open the selected row', scope: 'table' },
  { keys: 'Space', label: 'Select or clear a row', scope: 'table' },
  { keys: 'Ctrl+P', label: 'Print the current table view', scope: 'table' },
  { keys: 'Esc', label: 'Close overlays and cancel an edit', scope: 'form' },
  { keys: 'Ctrl+Enter', label: 'Save the current form', scope: 'form' },
];
