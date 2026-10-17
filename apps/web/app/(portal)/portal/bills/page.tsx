'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Panel, cx } from '@dizi/ui';
import { ReceiptText } from 'lucide-react';
import { usePortalLocale } from '@/components/PortalShell';
import { PortalPaySheet } from '@/components/PortalPaySheet';
import { BILLS, STR, billDue, billTotal, bnDigits, moneyIn, niceDate, outstanding, tr, type PortalBill } from '@/lib/portal';

/* The patient's bills.
 *
 * The rule about money on a patient screen is simple: show the arithmetic and never a demand. Each bill is listed
 * with its lines, what has been paid and what is left, in the patient's own language, before they stand at the
 * counter — and the counter is where the queue is.
 *
 * The pay button opens the sheet the receipts screen also uses. That sheet refuses the payment honestly, because
 * there is no gateway connected in this build: a payment screen that claims money nobody can find is the one piece
 * of theatre this product will not do.
 */

const stateLabel = (bill: PortalBill, locale: 'bn' | 'en') =>
  billDue(bill) === 0 ? (locale === 'bn' ? 'পরিশোধিত' : 'Paid') : bill.paid > 0 ? (locale === 'bn' ? 'কিছু দেওয়া হয়েছে' : 'Partly paid') : locale === 'bn' ? 'বাকি' : 'To pay';

export default function PortalBillsPage() {
  const locale = usePortalLocale();
  const t = (text: { bn: string; en: string }) => tr(text, locale);
  const [paying, setPaying] = useState<PortalBill | null>(null);
  const due = outstanding(BILLS);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t(STR.myBills)}</h1>
        <p className="text-sm text-text-secondary">
          {locale === 'bn'
            ? due > 0
              ? `এখন মোট ${moneyIn(due, 'bn')} বাকি। কাউন্টারে যাওয়ার আগেই দেখে নিন কী কী আছে।`
              : 'এখন কিছু বাকি নেই।'
            : due > 0
              ? `${moneyIn(due, 'en')} is outstanding. See what it is made of before you queue at the counter.`
              : 'Nothing is outstanding.'}
        </p>
      </header>

      {BILLS.map((bill) => (
        <Panel
          key={bill.id}
          title={locale === 'bn' ? `${niceDate(bill.on, 'bn')} — ${bill.forVisit}` : `${niceDate(bill.on, 'en')} — ${bill.forVisit}`}
          actions={<span className={cx('rounded-full border px-2 py-0.5 text-xs font-medium', billDue(bill) === 0 ? 'border-safety-success text-safety-success' : 'border-safety-warning text-safety-warning')}>{stateLabel(bill, locale)}</span>}
        >
          <p className="font-numeric text-xs text-text-tertiary">{bill.no}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {bill.lines.map((line) => (
              <li key={line.what} className="flex items-start justify-between gap-3">
                <span className="text-text-primary">
                  {locale === 'bn' ? line.whatBn : line.what}
                  {line.qty > 1 && <span className="text-text-tertiary"> × {locale === 'bn' ? bnDigits(line.qty) : line.qty}</span>}
                </span>
                <span className="font-numeric shrink-0 text-text-primary">{moneyIn(line.qty * line.rate, locale)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 border-t border-border-subtle pt-1">
              <span className="font-medium text-text-primary">{t(STR.total)}</span>
              <span className="font-numeric font-medium text-text-primary">{moneyIn(billTotal(bill), locale)}</span>
            </li>
            {bill.paid > 0 && (
              <li className="flex items-center justify-between gap-3">
                <span className="text-text-secondary">{t(STR.paid)}</span>
                <span className="font-numeric text-text-secondary">{moneyIn(bill.paid, locale)}</span>
              </li>
            )}
            <li className="flex items-center justify-between gap-3">
              <span className="font-medium text-text-primary">{t(STR.due)}</span>
              <span className="font-numeric text-base font-semibold text-text-primary">{moneyIn(billDue(bill), locale)}</span>
            </li>
          </ul>
          {billDue(bill) > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setPaying(bill)}>
                <ReceiptText className="size-4" aria-hidden /> {t(STR.payNow)}
              </Button>
              <a href="tel:+88029876560">
                <Button variant="ghost">{locale === 'bn' ? 'বিল নিয়ে প্রশ্ন' : 'A question about this bill'}</Button>
              </a>
            </div>
          )}
          {bill.ask && <p className="mt-2 text-xs text-text-secondary">{bill.ask}</p>}
        </Panel>
      ))}

      <Panel title={locale === 'bn' ? 'বিল নিয়ে যা জানা দরকার' : 'About your bills'}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>
            {locale === 'bn'
              ? 'প্রতিটি লাইনের দাম কাউন্টারের সাথে একই তালিকা থেকে আসে — তাই দুই জায়গায় দুই দাম হওয়ার সুযোগ নেই।'
              : 'Every line comes from the same price list the counter bills from, so the phone and the counter cannot show two different prices.'}
          </li>
          <li>
            {locale === 'bn'
              ? 'টাকা দেওয়ার আগে হিসাব নিয়ে প্রশ্ন করলে কিছু নষ্ট হয় না — ফোনেই জিজ্ঞেস করা যায়, কাউন্টারে অপেক্ষা করতে হয় না।'
              : 'Asking about the arithmetic before paying does no harm and is much faster than arguing after: telephone 02 9876 560.'}
          </li>
          <li>
            <Link className="text-brand-700 underline" href="/portal/payments">
              {t(STR.myPayments)}
            </Link>{' '}
            — {locale === 'bn' ? 'আগে দেওয়া টাকার রসিদ, চাকরি বা বীমার কাগজে দরকার হলে।' : 'the receipts for what has already been paid, which an employer or an insurer often wants months later.'}
          </li>
        </ul>
      </Panel>

      <PortalPaySheet bill={paying} open={Boolean(paying)} onClose={() => setPaying(null)} />
    </div>
  );
}
