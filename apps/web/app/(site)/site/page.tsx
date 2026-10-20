'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { CalendarPlus, Clock, MapPin, Phone, Stethoscope } from 'lucide-react';
import { SiteText } from '@/components/SiteBlocks';
import { useSiteLocale } from '@/components/SiteShell';
import { SITE_DEPARTMENTS, parseBody, siteFacts, siteSnapshot } from '@/lib/cms';

/* The public front page.
 *
 * The order of this page is the order a stranger needs it in, and it is not the order a hospital usually writes:
 *
 *  1. what this place is and where it is — two lines;
 *  2. the two things that make somebody act, side by side: come in, or telephone;
 *  3. the departments with their outdoor days, because that is the question the desk is asked most;
 *  4. the notices, because the second most-asked question is whether something has changed;
 *  5. the facts — hours, numbers, the address — rendered from the branch record rather than typed here.
 *
 * Everything above the notices is text a patient can read on a phone held in one hand while standing up.
 */

export default function SiteHomePage() {
  const { locale } = useSiteLocale();
  const snapshot = useMemo(() => siteSnapshot(), []);
  const t = (bn: string, en: string) => (locale === 'bn' ? bn : en);
  const home = snapshot.home;
  const blocks = home ? parseBody(locale === 'bn' ? home.bodyBn : home.bodyEn, locale) : [];
  const facts = siteFacts();
  const latest = blocks.filter((b) => b.kind === 'notice').slice(0, 2);

  return (
    <div className="space-y-6">
      {/* The two lines that answer “what is this place”. */}
      <section>
        <h1 className="text-2xl font-semibold text-text-primary">{t('ঢাকার একটি হাসপাতাল, যেখানে ফোন ধরা হয়', 'A hospital in Dhaka that answers the telephone')}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t(
            'জরুরি বিভাগ চব্বিশ ঘণ্টা খোলা, বহির্বিভাগ সপ্তাহে ছয় দিন, সঙ্গে ল্যাব, ফার্মেসি ও ২৩৬টি শয্যা — আর ডেস্কে একজন মানুষ, যে ফোন ধরে।',
            'Emergency care that never closes, an outdoor clinic six days a week, a laboratory, a pharmacy and 236 beds — and a person at the desk who answers the telephone.',
          )}
        </p>
      </section>

      {/* The two actions, side by side, above everything else. */}
      <section className="grid gap-2 sm:grid-cols-2">
        <Link href="/portal/visits" className="flex items-start gap-3 rounded-lg border border-brand-300 bg-brand-50 p-3 hover:border-brand-500">
          <CalendarPlus className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
          <span>
            <span className="block font-medium text-text-primary">{t('অ্যাপয়েন্টমেন্ট নিন', 'Book an appointment')}</span>
            <span className="mt-0.5 block text-sm text-text-secondary">
              {t('অনলাইনে সামনের ৩০ দিন পর্যন্ত। টোকেন এসএমএস-এ আসবে।', 'Online, up to 30 days ahead. The token comes by SMS.')}
            </span>
          </span>
        </Link>
        <a href="tel:+88029876500" className="flex items-start gap-3 rounded-lg border border-safety-critical bg-surface-raised p-3">
          <Phone className="mt-0.5 size-5 shrink-0 text-safety-critical" aria-hidden />
          <span>
            <span className="block font-medium text-text-primary">{t('জরুরি অবস্থায় ফোন করুন', 'In an emergency, telephone')}</span>
            <span className="font-numeric mt-0.5 block text-sm text-text-secondary">02 9876 500 · {t('চব্বিশ ঘণ্টা', '24 hours')}</span>
          </span>
        </a>
      </section>

      {/* The page the CMS holds, drawn by the one renderer. */}
      <section className="rounded-lg border border-border-subtle bg-surface-default p-4">
        <SiteText text={locale === 'bn' ? home.bodyBn : home.bodyEn} locale={locale} />
        <p className="mt-3 text-xs text-text-tertiary">
          {t('লেখা: ', 'Written by ')}
          {home.author}, {home.updatedAt} · {t('সংশোধন', 'revision')} r{home.revision}
        </p>
      </section>

      {/* Departments: the question the desk is asked most. */}
      <section>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
          <Stethoscope className="size-4 text-brand-600" aria-hidden /> {t('বিভাগ ও বহির্বিভাগের দিন', 'Departments and outdoor days')}
        </h2>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {SITE_DEPARTMENTS.map((department) => (
            <li key={department.name} className="rounded-lg border border-border-subtle bg-surface-raised px-3 py-2">
              <p className="text-sm font-medium text-text-primary">{locale === 'bn' ? department.nameBn : department.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-text-secondary">
                <Clock className="size-3.5 shrink-0 text-text-tertiary" aria-hidden /> {locale === 'bn' ? department.outdoorBn : department.outdoor}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-tertiary">
                <MapPin className="size-3.5 shrink-0" aria-hidden /> {department.where}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-secondary">
          {t('বিভাগ, ডাক্তার ও সময় — সবই হাসপাতালের নিজের নথি থেকে।', 'Departments, doctors and times all come from the hospital’s own records.')}{' '}
          <Link className="underline" href="/site/departments">
            {t('বিস্তারিত', 'More detail')}
          </Link>
          {' · '}
          <Link className="underline" href="/site/doctors">
            {t('চিকিৎসক', 'Doctors')}
          </Link>
        </p>
      </section>

      {/* Notices: the second most-asked question is whether something has changed. */}
      {latest.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-primary">{t('নোটিশ', 'Notices')}</h2>
          <div className="mt-2 space-y-2">
            {latest.map((block, index) => (
              <SiteText key={index} text={`> ${locale === 'bn' ? block.bn : block.en}`} locale={locale} />
            ))}
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            <Link className="underline" href="/site/notice">
              {t('সব নোটিশ', 'All notices')}
            </Link>{' '}
            {t('— পুরনো নোটিশও তারিখ সহ রাখা হয়।', '— older notices are kept with their dates, because people arrive holding one.')}
          </p>
        </section>
      )}

      {/* The facts strangers telephone for. */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary">{t('যোগাযোগ ও সময়', 'Contact and hours')}</h2>
        <dl className="mt-2 grid gap-2 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.key} className="rounded-lg border border-border-subtle bg-surface-raised px-3 py-2">
              <dt className="text-xs text-text-tertiary">{locale === 'bn' ? fact.keyBn : fact.key}</dt>
              <dd className="text-sm font-medium text-text-primary">{locale === 'bn' ? fact.valueBn : fact.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-text-tertiary">
          {t(
            'এই তথ্যগুলো পাতা থেকে নয়, শাখার নথি থেকে আসে — তাই ওয়েবসাইট আর ফ্রন্ট ডেস্ক দুই কথা বলতে পারে না।',
            'These come from the branch record rather than from a page, so the website and the front desk cannot disagree about when the door opens.',
          )}
        </p>
      </section>

      {home.updatedAt && (
        <p className="text-xs text-text-tertiary">
          {t('সাইটটি হাসপাতালের ফ্রন্ট সিএমএস থেকে চলে: ', 'The site runs from the hospital’s Front CMS: ')}
          {snapshot.pageCount} {t('পাতা প্রকাশিত, সর্বশেষ পরিবর্তন', 'pages published, last changed')} {snapshot.lastPublished}.
        </p>
      )}
    </div>
  );
}
