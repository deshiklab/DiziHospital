'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@dizi/ui';
import { CalendarDays, CloudOff, FileText, House, MessageSquare, Pill, ReceiptText } from 'lucide-react';
import { capabilityOf } from '@/lib/sync';
import { PATIENT, PORTAL_AUTH, type PortalLocale } from '@/lib/portal';

/* The patient portal's own shell.
 *
 * It is deliberately not the staff shell, and the route groups are what make that possible: a layout cannot be opted
 * out of in the App Router, only nested into, so the portal has its own header, its own navigation and its own main
 * region rather than a staff sidebar with the links hidden.
 *
 * Four decisions are visible here:
 *
 *  - **Bangla first, English by choice.** The switch is in the header where a patient finds it without hunting, the
 *    choice is remembered, and `<html lang>` follows it — a screen reader has to know which language it is reading.
 *  - **The bottom bar is the navigation.** On a phone the things a patient opens are six, they are opened with a
 *    thumb, and they are opened one-handed while waiting. A hamburger drawer in a patient portal is a staff habit.
 *  - **Safe areas are respected.** The bar sits above the home indicator rather than under it, and the content has
 *    room to scroll clear of the bar.
 *  - **The phone remembers what it has shown.** A report the patient opened carries the day they opened it, and that
 *    fact survives going back to the list: it is the patient's own copy of what the hospital recorded.
 *  - **Writes are held on the phone and sent when there is a signal.** A booking made on a moving bus is a booking
 *    the patient believes happened, so the portal records it in its own outbox and says plainly that it has not
 *    reached the hospital yet. The outbox checks each write against the same contract metadata the desk uses — a
 *    payment is never queued, because a queued payment is a promise about money.
 */

interface PendingWrite {
  id: string;
  label: string;
  labelBn: string;
  operationId: string;
  at: string;
}

interface PortalContextValue {
  locale: PortalLocale;
  setLocale: (l: PortalLocale) => void;
  pending: PendingWrite[];
  /** Record a write. Returns what happened, in the same shape the desk's queue returns. */
  send: (label: string, labelBn: string, write: { id: string; recordId: string; fields?: Record<string, string | number | null> }) => { queued: boolean; because?: string };
  flush: () => void;
  /**
   * The reports this phone has opened, by result id, and the day it happened.
   *
   * The record lives on the shell rather than on one screen because a patient opens a report from the list, reads
   * it, and goes back: a note that vanished on the way back would be a lie about what the hospital knows. The write
   * itself goes through the contract like every other write — this is the copy the patient can see.
   */
  downloaded: Record<string, string>;
  markDownloaded: (resultId: string) => void;
}

const PortalContext = createContext<PortalContextValue>({
  locale: 'bn',
  setLocale: () => undefined,
  pending: [],
  send: () => ({ queued: false, because: 'The portal outbox is not mounted.' }),
  flush: () => undefined,
  downloaded: {},
  markDownloaded: () => undefined,
});

export function PortalProviders({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<PortalLocale>('bn');
  const [pending, setPending] = useState<PendingWrite[]>([]);

  /* The shell announces itself on <html>, from an effect.
   *
   * The harness waits for a marker the server's HTML cannot carry, because that is the app's own signal that the
   * tree hydrated and the handlers are attached rather than a guess about how long that takes. All three shells
   * write the same `data-shell` with their own name, and the staff shell's navigation mode is cleared: a stale
   * `rail` left on <html> by a jump between the staff app and a patient's phone would let the staff stylesheet
   * reach into this screen. The document language is Bangla here because the portal is Bangla by default — the
   * switch below moves both the copy and the tag.
   */
  useEffect(() => {
    document.documentElement.dataset.shell = 'portal';
    document.documentElement.lang = 'bn';
    delete document.documentElement.dataset.nav;
  }, []);

  const setLocale = useCallback((l: PortalLocale) => {
    setLocaleState(l);
    if (typeof document !== 'undefined') document.documentElement.lang = l;
  }, []);

  const send = useCallback<PortalContextValue['send']>((label, labelBn, write) => {
    const capability = capabilityOf(write.id);
    if (!capability) {
      return { queued: false, because: `${write.id} is not an operation in the platform API contract, so there is nothing to send.` };
    }
    if (capability.needsNetwork) {
      return {
        queued: false,
        because: capability.because ?? `${write.id} has to reach the server while the patient is on the screen, so it cannot be held on the phone.`,
      };
    }
    const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    setPending((list) => [...list, { id: `${write.id}-${list.length + 1}`, label, labelBn, operationId: write.id, at }]);
    return { queued: true };
  }, []);

  const flush = useCallback(() => setPending([]), []);

  const [downloaded, setDownloaded] = useState<Record<string, string>>({});
  const markDownloaded = useCallback((resultId: string) => {
    const at = new Date().toISOString().slice(0, 10);
    setDownloaded((list) => ({ ...list, [resultId]: at }));
  }, []);

  const value = useMemo(
    () => ({ locale, setLocale, pending, send, flush, downloaded, markDownloaded }),
    [locale, setLocale, pending, send, flush, downloaded, markDownloaded],
  );
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export const usePortal = () => useContext(PortalContext);
/** The locale on its own, for a screen that only reads text. */
export const usePortalLocale = () => useContext(PortalContext).locale;

const TABS: Array<{ href: string; label: { bn: string; en: string }; Icon: typeof House }> = [
  { href: '/portal', label: { bn: 'হোম', en: 'Home' }, Icon: House },
  { href: '/portal/visits', label: { bn: 'ভিজিট', en: 'Visits' }, Icon: CalendarDays },
  { href: '/portal/reports', label: { bn: 'রিপোর্ট', en: 'Reports' }, Icon: FileText },
  { href: '/portal/prescriptions', label: { bn: 'ঔষধ', en: 'Medicines' }, Icon: Pill },
  { href: '/portal/bills', label: { bn: 'বিল', en: 'Bills' }, Icon: ReceiptText },
  { href: '/portal/feedback', label: { bn: 'মতামত', en: 'Feedback' }, Icon: MessageSquare },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const { locale, setLocale, pending, flush } = usePortal();
  const path = usePathname();
  const t = (bn: string, en: string) => (locale === 'bn' ? bn : en);

  return (
    <div lang={locale} className="min-h-dvh bg-surface-canvas pb-24 lg:pb-0">
      <a
        href="#portal-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-surface-raised focus:px-3 focus:py-2"
      >
        {t('মূল অংশে যান', 'Skip to content')}
      </a>

      <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface-raised/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">
              <span lang="bn">ডিজি হাসপাতাল</span> <span className="text-text-tertiary">·</span> Dizi Hospital
            </p>
            <p className="truncate text-xs text-text-secondary">{t(`${PATIENT.nameBn} · ${PATIENT.mrn}`, `${PATIENT.name} · ${PATIENT.mrn}`)}</p>
          </div>
          <div className="ml-auto flex items-center gap-1" role="group" aria-label={t('ভাষা', 'Language')}>
            {(['bn', 'en'] as PortalLocale[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={locale === l}
                className={cx('rounded-md px-2.5 py-1.5 text-sm font-medium', locale === l ? 'bg-brand-600 text-white' : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary')}
              >
                {l === 'bn' ? 'বাংলা' : 'English'}
              </button>
            ))}
          </div>
        </div>

        {/* The sign-in stub, said once where it cannot be missed, and never shown as a badge. */}
        {!PORTAL_AUTH.built && (
          <p className="border-t border-safety-warning bg-surface-sunken px-4 py-1.5 text-center text-xs text-safety-warning">
            {t('প্রদর্শনী লগইন — কোড এসএমএস-এ যায়নি, পর্দায় দেখানো হয়েছে।', 'Demonstration sign-in — the code was shown on the screen, not sent by SMS.')}
          </p>
        )}

        {/* Writes held on this phone, said in the patient's language and never as a technical queue. */}
        {pending.length > 0 && (
          <div className="flex items-center gap-2 border-t border-border-subtle bg-surface-sunken px-4 py-1.5 text-xs text-text-secondary">
            <CloudOff className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {t(`ফোনে রাখা হয়েছে, এখনো পাঠানো হয়নি: ${pending.map((p) => p.labelBn).join(', ')}।`, `Held on this phone, not sent yet: ${pending.map((p) => p.label).join(', ')}.`)}
            </span>
            <button type="button" onClick={flush} className="rounded-md border border-border-subtle px-2 py-1 font-medium text-brand-700">
              {t('সিগন্যাল পেলে পাঠান', 'Send when there is a signal')}
            </button>
          </div>
        )}

        <nav aria-label={t('প্রধান অংশ', 'Main')} className="mx-auto hidden max-w-3xl gap-1 px-3 pb-1 lg:flex">
          {TABS.map(({ href, label, Icon }) => {
            const active = href === '/portal' ? path === '/portal' : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx('flex items-center gap-1.5 rounded-md px-3 py-2 text-sm', active ? 'bg-brand-50 text-brand-700' : 'text-text-secondary hover:bg-surface-sunken')}
              >
                <Icon className="size-4" aria-hidden />
                {t(label.bn, label.en)}
              </Link>
            );
          })}
        </nav>
      </header>

      <main id="portal-content" className="mx-auto max-w-3xl px-4 py-4">
        {children}
      </main>

      {/* The phone's navigation: six things, one thumb, no drawer. */}
      <nav
        aria-label={t('প্রধান অংশ', 'Main')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface-raised/95 pb-[max(env(safe-area-inset-bottom),0.25rem)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-3xl items-stretch">
          {TABS.map(({ href, label, Icon }) => {
            const active = href === '/portal' ? path === '/portal' : path.startsWith(href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx('flex flex-col items-center gap-0.5 px-0.5 py-2 text-[10px]', active ? 'text-brand-700' : 'text-text-secondary')}
                >
                  <Icon className={cx('size-5', active && 'text-brand-600')} aria-hidden />
                  <span className="truncate">{t(label.bn, label.en)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <footer className="mx-auto max-w-3xl px-4 pb-6 pt-2 text-center text-xs text-text-tertiary">
        <p>{t('সাহায্য দরকার? ডেস্কে ফোন করুন ০২ ৯৮৭৬ ৫৪০, সকাল ৮টা থেকে রাত ৮টা।', 'Need help? Telephone the desk on 02 9876 540, 08:00 to 20:00.')}</p>
        <p className="mt-1">{t('জরুরি অবস্থায় ০২ ৯৮৭৬ ৫০০ — ২৪ ঘণ্টা।', 'In an emergency, 02 9876 500 — 24 hours.')}</p>
      </footer>
    </div>
  );
}
