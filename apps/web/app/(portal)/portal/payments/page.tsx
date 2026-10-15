'use client';

import { useState } from 'react';
import { Button, Panel, cx } from '@dizi/ui';
import { ReceiptText } from 'lucide-react';
import { usePortalLocale } from '@/components/PortalShell';
import { PortalPaySheet } from '@/components/PortalPaySheet';
import { BILLS, PAYMENTS, STR, billDue, moneyIn, niceDate, tr, type PortalBill } from '@/lib/portal';

/* Receipts, and the state of the money.
 *
 * A receipt is what a patient comes back for months later — for an employer, an insurer, a reimbursement — so the
 * list is ordered by date with the number beside every row, and a refusal is shown as a refusal instead of quietly
 * disappearing. The one refused row is from this build's own gateway stub: it says nothing was charged, because a
 * payment that cannot be found is the worst kind of lie a hospital application can tell.
 */

const STATE_TONE: Record<(typeof PAYMENTS)[number]['state'], string> = {
  settled: 'text-safety-success',
  'handed over': 'text-safety-warning',
  refused: 'text-safety-critical',
};

export default function PortalPaymentsPage() {
  const locale = usePortalLocale();
  const t = (text: { bn: string; en: string }) => tr(text, locale);
  const [paying, setPaying] = useState<PortalBill | null>(null);
  const openBills = BILLS.filter((b) => billDue(b) > 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t(STR.myPayments)}</h1>
        <p className="text-sm text-text-secondary">
          {locale === 'bn' ? 'যা দেওয়া হয়েছে তার রসিদ, এবং যা দেওয়া যায়নি তার কারণ।' : 'What has been paid — and where something could not be paid, why not.'}
        </p>
      </header>

      <Panel>
        <ul className="divide-y divide-border-subtle">
          {PAYMENTS.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-numeric text-sm text-text-primary">{p.receipt === '—' ? (locale === 'bn' ? 'রসিদ তৈরি হয়নি' : 'No receipt was written') : p.receipt}</p>
                <p className="text-xs text-text-secondary">
                  {niceDate(p.on, locale)} · {p.how}
                  {p.billNo !== '—' && ` · ${p.billNo}`}
                </p>
                {p.because && <p className="mt-1 text-xs text-text-secondary">{p.because}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-numeric text-sm text-text-primary">{moneyIn(p.amount, locale)}</p>
                <p className={cx('text-xs font-medium', STATE_TONE[p.state])}>
                  {p.state === 'settled' ? (locale === 'bn' ? 'পরিশোধিত' : 'Settled') : p.state === 'handed over' ? (locale === 'bn' ? 'গেটওয়েতে দেওয়া হয়েছে' : 'Handed to the gateway') : locale === 'bn' ? 'কিছু কাটা হয়নি' : 'Nothing charged'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {openBills.length > 0 && (
        <Panel title={locale === 'bn' ? 'যা এখনো বাকি' : 'Still to pay'}>
          <ul className="space-y-2">
            {openBills.map((bill) => (
              <li key={bill.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm text-text-primary">{bill.forVisit}</span>
                  <span className="font-numeric block text-xs text-text-secondary">{bill.no}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-numeric text-sm font-medium text-text-primary">{moneyIn(billDue(bill), locale)}</span>
                  <Button variant="secondary" onClick={() => setPaying(bill)}>
                    {t(STR.payNow)}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={locale === 'bn' ? 'টাকা দেওয়া নিয়ে' : 'About paying'}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <ReceiptText className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
            <span>
              {locale === 'bn'
                ? 'রসিদ কার্ডের স্লিপের কপি নয় — হাসপাতালের হিসাবের বই থেকে আসে, তাই চাকরির কাগজ বা বীমার কাছে দেখানো যায়।'
                : 'A receipt is a row from the hospital’s own books rather than a copy of a card slip, so it stands up when an employer or an insurer asks.'}
            </span>
          </li>
          <li>
            {locale === 'bn'
              ? 'ফোন থেকে টাকা দেওয়া এই সংস্করণে চালু নেই। চেষ্টা করলে কিছুই কাটা হবে না — কারণ লেখা থাকবে।'
              : 'Paying from the phone is not enabled in this build. Trying it charges nothing, and the reason is written on the screen rather than left to be guessed.'}
          </li>
        </ul>
      </Panel>

      <PortalPaySheet bill={paying} open={Boolean(paying)} onClose={() => setPaying(null)} />
    </div>
  );
}
