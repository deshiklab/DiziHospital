'use client';

import { useState } from 'react';
import { Button, Panel, copyText, cx, useToast } from '@dizi/ui';
import { Check, Copy, Pill, Store } from 'lucide-react';
import { usePortalLocale } from '@/components/PortalShell';
import { PRESCRIPTIONS, STR, bnDigits, niceDate, tr } from '@/lib/portal';

/* The patient's medicines.
 *
 * What this screen is for is the moment somebody stands at a pharmacy counter with a bag of tablets and cannot
 * remember which is for what. So every item carries three things the prescription sheet already had and the app
 * usually throws away: how to take it, for how long, and what it is for — written by the doctor in words a patient
 * reads, not transcribed from a Latin abbreviation.
 *
 * Two honest limits are stated rather than hidden: this is the prescription as it was written and not a repeat
 * prescription, and a medicine that is not collected from this pharmacy is shown as waiting rather than assumed to
 * have been bought somewhere else.
 */

export default function PortalPrescriptionsPage() {
  const locale = usePortalLocale();
  const { push } = useToast();
  const t = (text: { bn: string; en: string }) => tr(text, locale);
  const [copied, setCopied] = useState<string | null>(null);

  const listText = (index: number) => {
    const p = PRESCRIPTIONS[index];
    const lines = [
      locale === 'bn' ? `ঔষধের তালিকা — ${p.doctor}, ${niceDate(p.issuedAt, 'bn')}` : `Medicine list — ${p.doctor}, ${niceDate(p.issuedAt, 'en')}`,
      ...p.items.map((i) => `• ${i.name} ${i.strength} — ${i.how} (${i.forHowLong})`),
      locale === 'bn' ? `ডাক্তারের নোট: ${p.note}` : `Doctor's note: ${p.note}`,
    ];
    return lines.join('\n');
  };

  const copyList = async (index: number) => {
    const ok = await copyText(listText(index));
    setCopied(ok ? PRESCRIPTIONS[index].id : null);
    push({
      title: ok ? (locale === 'bn' ? 'তালিকাটি কপি হয়েছে' : 'The list is copied') : locale === 'bn' ? 'কপি করা যায়নি' : 'It could not be copied',
      description: ok
        ? locale === 'bn'
          ? 'ফার্মেসিতে দেখাতে পারেন, বা পরিবারের কাউকে পাঠাতে পারেন।'
          : 'You can show it at the pharmacy counter or send it to somebody in your family.'
        : locale === 'bn'
          ? 'ব্রাউজার কপি করতে দেয়নি। হাতে লিখে নিন বা স্ক্রিনশট নিন।'
          : 'The browser would not allow the copy. Take a screenshot or write it down instead.',
      tone: ok ? 'success' : 'warning',
    });
  };

  const waiting = PRESCRIPTIONS.flatMap((p) => p.items).filter((i) => i.collected === 'waiting').length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t(STR.medicines)}</h1>
        <p className="text-sm text-text-secondary">
          {locale === 'bn'
            ? waiting
              ? `${bnDigits(waiting)}টি ঔষধ ফার্মেসি থেকে নিতে হবে।`
              : 'সব ঔষধ ফার্মেসি থেকে নেওয়া হয়েছে।'
            : waiting
              ? `${waiting} medicine(s) are still to be collected from the pharmacy.`
              : 'Everything prescribed has been collected from the pharmacy.'}
        </p>
      </header>

      {PRESCRIPTIONS.map((p, index) => (
        <Panel
          key={p.id}
          title={locale === 'bn' ? `${niceDate(p.issuedAt, 'bn')} — ${p.doctor}` : `${niceDate(p.issuedAt, 'en')} — ${p.doctor}`}
          actions={
            <Button variant="ghost" onClick={() => copyList(index)}>
              {copied === p.id ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {t(STR.copyList)}
            </Button>
          }
        >
          <p className="text-xs text-text-secondary">
            {locale === 'bn' ? `নথিতে লেখা কারণ: ${p.diagnosisShown}` : `On the record: ${p.diagnosisShown}`}
          </p>

          <ul className="mt-2 space-y-2">
            {p.items.map((item) => (
              <li key={`${p.id}-${item.name}`} className="rounded-md border border-border-subtle p-2">
                <div className="flex items-start gap-2">
                  <Pill className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">
                      {item.name} <span className="font-normal text-text-secondary">{item.strength !== '—' ? item.strength : ''}</span>
                    </p>
                    <p className="text-sm text-text-primary">
                      <span className="text-text-tertiary">{t(STR.howToTake)}: </span>
                      {item.how}
                    </p>
                    <p className="text-sm text-text-primary">
                      <span className="text-text-tertiary">{locale === 'bn' ? 'কত দিন' : 'For how long'}: </span>
                      {item.forHowLong}
                    </p>
                    <p className="mt-1 text-sm text-text-secondary">
                      <span className="text-text-tertiary">{t(STR.whatItIsFor)}: </span>
                      {item.whatFor}
                    </p>
                    <p className={cx('mt-1 flex items-center gap-1 text-xs', item.collected === 'collected' ? 'text-safety-success' : item.collected === 'waiting' ? 'text-safety-warning' : 'text-text-tertiary')}>
                      <Store className="size-3.5" aria-hidden />
                      {t(item.collected === 'collected' ? STR.collected : item.collected === 'waiting' ? STR.notCollected : { bn: 'ফার্মেসি থেকে নেওয়ার দরকার নেই', en: 'Does not need collecting' })}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-2 rounded-md bg-surface-sunken p-2 text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{locale === 'bn' ? 'ডাক্তারের নোট: ' : 'Doctor’s note: '}</span>
            {p.note}
          </p>
        </Panel>
      ))}

      <Panel title={locale === 'bn' ? 'যা মনে রাখবেন' : 'Worth remembering'}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>
            {locale === 'bn'
              ? 'এটি ডাক্তার যা লিখেছেন, তেমনই। নতুন মাত্রায় ঔষধ বা পুরনো প্রেসক্রিপশনের রিপিট এখান থেকে নেওয়া যায় না — সেটি ডাক্তারের দেখানো দরকার।'
              : 'This is the prescription exactly as it was written. It is not a repeat prescription: a repeat needs the doctor to see you, because a dose that was right in August is not automatically right in October.'}
          </li>
          <li>
            {locale === 'bn'
              ? 'ঔষধ বন্ধ করার আগে ডেস্কে জিজ্ঞেস করুন — কোর্স শেষ না করে বন্ধ করলে সংক্রমণ ফিরে আসে।'
              : 'Before stopping anything, ask at the desk. A course stopped half-way is the usual reason an infection comes back.'}
          </li>
          <li>
            {locale === 'bn'
              ? 'ঔষধের দাম বা পাওয়া নিয়ে সমস্যা হলে ফার্মেসিতে বলুন, বা ডেস্কে ফোন করুন ০২ ৯৮৭৬ ৫৪০।'
              : 'If a medicine is unavailable or the cost is a problem, say so at the pharmacy or telephone the desk on 02 9876 540. There is usually an alternative, and the hospital would rather find it than have the course stop.'}
          </li>
        </ul>
      </Panel>
    </div>
  );
}
