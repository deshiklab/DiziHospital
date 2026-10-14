import type { Locale, Role } from './shell';

/* -----------------------------------------------------------------------------
 * Interface strings for the shell (en / bn-BD).
 *
 * Scope for v0: navigation, shell affordances and the sync vocabulary. Clinical terminology gets its own
 * reviewed glossary (plan 02 §9) before the first pilot — machine-translated clinical text is a safety issue,
 * not a convenience.
 */

type Dict = Record<string, { en: string; bn: string }>;

export const strings: Dict = {
  'nav.dashboard': { en: 'Dashboard', bn: 'ড্যাশবোর্ড' },
  'nav.patients': { en: 'Patients', bn: 'রোগী' },
  'nav.appointments': { en: 'Appointments', bn: 'অ্যাপয়েন্টমেন্ট' },
  'nav.clinical': { en: 'Clinical', bn: 'ক্লিনিক্যাল' },
  'nav.diagnostics': { en: 'Diagnostics', bn: 'ডায়াগনস্টিক' },
  'nav.pharmacy': { en: 'Pharmacy', bn: 'ফার্মেসি' },
  'nav.billing': { en: 'Billing', bn: 'বিলিং' },
  'nav.inventory': { en: 'Inventory', bn: 'ইনভেন্টরি' },
  'nav.reports': { en: 'Reports', bn: 'রিপোর্ট' },
  'nav.admin': { en: 'Admin', bn: 'অ্যাডমিন' },
  'nav.help': { en: 'Help', bn: 'সহায়তা' },

  'shell.search': { en: 'Search patient, MRN, phone…', bn: 'রোগী, এমআরএন, ফোন খুঁজুন…' },
  'shell.palette': { en: 'Command palette', bn: 'কমান্ড প্যালেট' },
  'shell.notifications': { en: 'Notifications', bn: 'বিজ্ঞপ্তি' },
  'shell.help': { en: 'Help', bn: 'সহায়তা' },
  'shell.language': { en: 'Language', bn: 'ভাষা' },
  'shell.density': { en: 'Density', bn: 'ঘনত্ব' },
  'shell.comfortable': { en: 'Comfortable', bn: 'আরামদায়ক' },
  'shell.compact': { en: 'Compact', bn: 'কমপ্যাক্ট' },
  'shell.role': { en: 'Role', bn: 'ভূমিকা' },
  'shell.hospital': { en: 'Shaheed Suhrawardy General Hospital', bn: 'শহীদ সোহরাওয়ার্দী জেনারেল হাসপাতাল' },
  'shell.branch': { en: 'Branch', bn: 'শাখা' },
  'shell.mode': { en: 'Site mode', bn: 'সাইট মোড' },
  'shell.mode.edge': { en: 'Edge authoritative (normal)', bn: 'এজ প্রধান (স্বাভাবিক)' },

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
