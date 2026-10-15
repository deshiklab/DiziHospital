'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@dizi/ui';
import { Ambulance, CalendarPlus, Menu as MenuIcon, Phone, X } from 'lucide-react';
import { siteSnapshot } from '@/lib/cms';

/* The public website's shell.
 *
 * It is not the staff shell with the sidebar hidden, and it is not the patient portal either. The differences are
 * deliberate and each one is a decision about who is reading:
 *
 *  - **Nobody is signed in, and nothing is remembered about them.** There is no session, no toast host for actions,
 *    and no personalisation: a hospital website that remembers a visitor is a hospital website that has to explain
 *    why. The only stored preference is the language, and it lives in this component's own state.
 *  - **Bangla first, English by choice**, for the same reason as the portal: the reader is in Dhaka, looking for the
 *    outdoor clinic times, on a phone.
 *  - **The two things a stranger needs are always on screen** — the emergency number and how to book — because a
 *    hospital website's job is to get somebody to a person, not to describe itself.
 *  - **The navigation is the sections the CMS holds.** If a section has no published page it is not in the menu,
 *    which is how a website stops advertising a page that was never written.
 */

const LocaleContext = createContext<{ locale: 'en' | 'bn'; setLocale: (l: 'en' | 'bn') => void }>({ locale: 'bn', setLocale: () => undefined });
export const useSiteLocale = () => useContext(LocaleContext);

export function SiteShell({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<'en' | 'bn'>('bn');
  const [menuOpen, setMenuOpen] = useState(false);

  /* This shell announces itself on <html> from an effect, and clears the staff shell's navigation mode: the two
   * are one click apart when a link is followed from the staff app, and a stale `rail` on <html> would let the
   * staff stylesheet reach into a public page. See the same block in AppShell and PortalShell. */
  useEffect(() => {
    document.documentElement.dataset.shell = 'site';
    document.documentElement.lang = 'bn';
    delete document.documentElement.dataset.nav;
  }, []);
  const path = usePathname();
  const snapshot = useMemo(() => siteSnapshot(), []);
  const t = (bn: string, en: string) => (locale === 'bn' ? bn : en);

  const setLocale = (l: 'en' | 'bn') => {
    setLocaleState(l);
    if (typeof document !== 'undefined') document.documentElement.lang = l;
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <div lang={locale} className="min-h-dvh bg-surface-canvas">
        <a href="#site-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-surface-raised focus:px-3 focus:py-2">
          {t('মূল অংশে যান', 'Skip to content')}
        </a>

        {/* The emergency strip is above everything, including the name: it is the one thing a stranger may need. */}
        <div className="bg-safety-critical px-4 py-1.5 text-center text-xs font-medium text-white">
          {t('জরুরি অবস্থায় ২৪ ঘণ্টা: ', 'Emergency, 24 hours: ')}
          <a href="tel:+88029876500" className="underline">
            02 9876 500
          </a>
          <span className="mx-2 opacity-60">·</span>
          {t('অ্যাম্বুলেন্স: ', 'Ambulance: ')}
          <a href="tel:+88029876555" className="underline">
            02 9876 555
          </a>
        </div>

        <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface-raised/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <Link href="/site" className="min-w-0">
              <span className="block text-base font-semibold text-text-primary">
                <span lang="bn">ডিজি হসপিটাল</span> <span className="text-text-tertiary">·</span> Dizi Hospital
              </span>
              <span className="block text-xs text-text-secondary">{t('প্রধান ক্যাম্পাস, ২২ গ্রিন রোড, ঢাকা', 'Main Campus, 22 Green Road, Dhaka')}</span>
            </Link>

            <div className="ml-auto flex items-center gap-1">
              <Link href="/portal/visits" className="hidden items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white sm:flex">
                <CalendarPlus className="size-4" aria-hidden /> {t('অ্যাপয়েন্টমেন্ট নিন', 'Book an appointment')}
              </Link>
              <a href="tel:+88029876540" className="hidden items-center gap-1.5 rounded-md border border-border-subtle px-3 py-2 text-sm text-text-secondary md:flex">
                <Phone className="size-4" aria-hidden /> 02 9876 540
              </a>
              <div className="flex items-center gap-1" role="group" aria-label={t('ভাষা', 'Language')}>
                {(['bn', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLocale(l)}
                    aria-pressed={locale === l}
                    className={cx('rounded-md px-2 py-1.5 text-sm font-medium', locale === l ? 'bg-brand-600 text-white' : 'text-text-secondary hover:bg-surface-sunken')}
                  >
                    {l === 'bn' ? 'বাংলা' : 'English'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                className="rounded-md border border-border-subtle p-2 text-text-secondary lg:hidden"
              >
                {menuOpen ? <X className="size-4" aria-hidden /> : <MenuIcon className="size-4" aria-hidden />}
                <span className="sr-only">{t('মেনু', 'Menu')}</span>
              </button>
            </div>
          </div>

          <nav aria-label={t('বিভাগসমূহ', 'Sections')} className={cx('mx-auto max-w-5xl gap-1 px-3 pb-2 lg:flex', menuOpen ? 'grid grid-cols-2 gap-1 lg:grid-cols-none' : 'hidden')}>
            {snapshot.menu
              .filter((item) => item.pages.length > 0)
              .map((item) => {
                const active = path === item.href || path.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.section}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cx('rounded-md px-3 py-2 text-sm', active ? 'bg-brand-50 text-brand-700' : 'text-text-secondary hover:bg-surface-sunken')}
                  >
                    {locale === 'bn' ? item.labelBn : item.label}
                  </Link>
                );
              })}
          </nav>
        </header>

        <main id="site-content" className="mx-auto max-w-5xl px-4 py-5">
          {children}
        </main>

        <footer className="mt-8 border-t border-border-subtle bg-surface-raised">
          <div className="mx-auto grid max-w-5xl gap-4 px-4 py-6 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-sm font-semibold text-text-primary">{t('যোগাযোগ', 'Contact')}</p>
              <ul className="mt-1 space-y-0.5 text-sm text-text-secondary">
                <li>
                  {t('ডেস্ক: ', 'Desk: ')}
                  <a className="font-numeric underline" href="tel:+88029876540">
                    02 9876 540
                  </a>
                </li>
                <li>
                  {t('জরুরি: ', 'Emergency: ')}
                  <a className="font-numeric underline" href="tel:+88029876500">
                    02 9876 500
                  </a>
                </li>
                <li>
                  {t('অ্যাম্বুলেন্স: ', 'Ambulance: ')}
                  <a className="font-numeric underline" href="tel:+88029876555">
                    02 9876 555
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{t('খোলার সময়', 'Opening hours')}</p>
              <ul className="mt-1 space-y-0.5 text-sm text-text-secondary">
                <li>{t('বহির্বিভাগ: সকাল ৮টা–রাত ৮টা, শনি–বৃহস্পতি', 'Outdoor: 08:00–20:00, Saturday to Thursday')}</li>
                <li>{t('জরুরি বিভাগ: চব্বিশ ঘণ্টা, প্রতি দিন', 'Emergency: 24 hours, every day')}</li>
                <li>{t('ল্যাব নমুনা: সকাল ৭টা–রাত ৯টা', 'Laboratory samples: 07:00–21:00')}</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{t('এই পাতাগুলো কারা লেখেন', 'Who writes these pages')}</p>
              <p className="mt-1 text-sm text-text-secondary">
                {t(
                  'হাসপাতালের নিজের কর্মীরা, হাসপাতালের নথি থেকে। খোলার সময় ও টেলিফোন নম্বর পাতা থেকে নয়, শাখার নথি থেকে আসে — তাই ওয়েবসাইট আর ফ্রন্ট ডেস্ক দুই কথা বলতে পারে না।',
                  'The hospital’s own staff, from the hospital’s own records. The hours and telephone numbers are rendered from the branch record rather than typed into a page, so the website and the front desk cannot disagree.',
                )}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-text-tertiary">
                <Ambulance className="size-3.5" aria-hidden /> {t('অ্যাম্বুলেন্স ডাকতে: ০২ ৯৮৭৬ ৫৫৫', 'To call an ambulance: 02 9876 555')}
              </p>
            </div>
          </div>
          <p className="mx-auto max-w-5xl px-4 pb-6 text-xs text-text-tertiary">
            {t(`প্রদর্শনীর জন্য এই সাইটটি হাসপাতালের অ্যাপ থেকে পরিবেশন করা হচ্ছে — একই নথি থেকে।`, 'This site is served from the hospital’s own application for the preview: the same records, the same blocks, the same pages.')}
            {' '}
            {snapshot.pageCount} {t('পাতা প্রকাশিত', 'pages published')} · {t('শেষ পরিবর্তন', 'last edit')} {snapshot.lastPublished ?? '—'}
          </p>
        </footer>
      </div>
    </LocaleContext.Provider>
  );
}
