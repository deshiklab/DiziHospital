'use client';

import { useMemo, useState } from 'react';
import { Button, FieldSection, SafetyBanner, SelectField, Sheet, TextField, useToast } from '@dizi/ui';
import { usePortal, usePortalLocale } from '@/components/PortalShell';
import { STR, billDue, billTotal, checkPayment, moneyIn, tr, type PortalBill } from '@/lib/portal';
import { todayIso } from '@/lib/appointments';

/* Paying a bill from the phone — and what the screen does when it cannot.
 *
 * Two things are true at once, and the screen has to hold both:
 *
 *  - the hospital is not going to invent a payment. A gateway integration (bKash, Nagad, card acquiring) is a
 *    commercial arrangement, and there is none in this build, so the operation is `online-only` in the contract and
 *    the sheet refuses the payment outright — “nothing has been charged” is a sentence that has to be true;
 *  - the patient still needs the amount, the bill lines and the alternatives, in their own language, without being
 *    sent round the houses. So the sheet shows the arithmetic, says plainly that the phone cannot take the money,
 *    and gives the counter, the desk and the number.
 *
 * The same sheet is used by the bills screen and the receipts screen, because “what do I owe and how do I pay it”
 * is one question asked from two places.
 */

const METHODS = [
  { value: 'bkash', bn: 'বিকাশ', en: 'bKash' },
  { value: 'nagad', bn: 'নগদ', en: 'Nagad' },
  { value: 'counter', bn: 'কাউন্টারে নগদ', en: 'Cash at the counter' },
  { value: 'card', bn: 'ডেস্কে কার্ড', en: 'Card at the desk' },
];

export function PortalPaySheet({ bill, open, onClose }: { bill: PortalBill | null; open: boolean; onClose: () => void }) {
  const locale = usePortalLocale();
  const { send } = usePortal();
  const { push } = useToast();
  const t = (text: { bn: string; en: string }) => tr(text, locale);
  const day = todayIso();
  const due = bill ? billDue(bill) : 0;
  const [amount, setAmount] = useState(String(due));
  const [method, setMethod] = useState('bkash');

  const verdict = useMemo(
    () => (bill ? checkPayment(bill, Number(amount) || 0, { today: day, nowMinute: 10 * 60, appointments: [], bills: [bill], gatewayConnected: false }) : null),
    [bill, amount, day],
  );

  const pay = () => {
    if (!bill || !verdict) return;
    if (!verdict.ok) {
      push({ title: locale === 'bn' ? 'টাকা কাটা হয়নি' : 'Nothing has been charged', description: verdict.reasons[0].message, tone: 'critical' });
      return;
    }
    const wrote = send(`Payment for ${bill.no}`, `${bill.no} বিলের টাকা`, { id: 'payPortalBill', recordId: bill.id, fields: { bill: bill.no, amount: Number(amount), method } });
    push({
      title: wrote.queued ? (locale === 'bn' ? 'হাসপাতালে পাঠানো হয়েছে' : 'Sent to the hospital') : locale === 'bn' ? 'টাকা কাটা হয়নি' : 'Nothing has been charged',
      description: wrote.queued
        ? locale === 'bn'
          ? 'গেটওয়ে নিশ্চিত করার পরেই রসিদ তৈরি হয়। ততক্ষণ বিলটি “বাকি” হিসেবেই থাকবে।'
          : 'The receipt is written only when the gateway confirms it. Until then the bill stays marked as due, which is the honest state for money that has not arrived.'
        : wrote.because,
      tone: wrote.queued ? 'success' : 'warning',
    });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(STR.payNow)}
      description={bill ? `${bill.no} · ${bill.forVisit}` : undefined}
      width="md"
      footer={
        <>
          <span className="mr-auto text-xs text-text-tertiary">
            {bill ? (locale === 'bn' ? `বিল ${moneyIn(billTotal(bill), 'bn')} · বাকি ${moneyIn(due, 'bn')}` : `Bill ${moneyIn(billTotal(bill), 'en')} · due ${moneyIn(due, 'en')}`) : ''}
          </span>
          <Button variant="ghost" onClick={onClose}>
            {locale === 'bn' ? 'পরে' : 'Not now'}
          </Button>
          <Button variant="primary" onClick={pay} disabled={!verdict?.ok}>
            {t(STR.pay)}
          </Button>
        </>
      }
    >
      {bill && verdict && (
        <div className="space-y-3">
          <ul className="space-y-1 text-sm">
            {bill.lines.map((line) => (
              <li key={line.what} className="flex items-start justify-between gap-3">
                <span className="text-text-primary">
                  {locline(line.whatBn, line.what, locale)}
                  {line.qty > 1 && <span className="text-text-tertiary"> × {line.qty}</span>}
                </span>
                <span className="shrink-0 font-numeric text-text-primary">{moneyIn(line.qty * line.rate, locale)}</span>
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
              <span className="font-numeric text-lg font-semibold text-text-primary">{moneyIn(due, locale)}</span>
            </li>
          </ul>

          {!verdict.ok && (
            <SafetyBanner severity="warning" title={locale === 'bn' ? 'এই অ্যাপ থেকে টাকা নেওয়া যাচ্ছে না' : 'This app cannot take the money'}>
              <p>{verdict.reasons[0].message}</p>
              <p lang={locale === 'bn' ? 'bn' : 'en'} className="mt-1 text-xs">
                {verdict.reasons[0].messageBn}
              </p>
            </SafetyBanner>
          )}
          {verdict.warnings.length > 0 && (
            <SafetyBanner severity="info" title={locale === 'bn' ? 'জেনে রাখুন' : 'Worth knowing'}>
              <ul className="list-disc space-y-1 pl-5">
                {verdict.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}

          <FieldSection title={locale === 'bn' ? 'টাকার হিসাব' : 'The payment'}>
            <TextField
              label={t(STR.amount)}
              name="pay-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              hint={locale === 'bn' ? `বাকি ${moneyIn(due, 'bn')} টাকা। এর বেশি দিলে বাকিটা কাউন্টারে দিতে হবে।` : `${moneyIn(due, 'en')} is due. More than that cannot be taken here — the rest is settled at the counter.`}
            />
            <SelectField
              label={t(STR.howPay)}
              name="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={METHODS.map((m) => ({ value: m.value, label: locale === 'bn' ? m.bn : m.en }))}
              hint={locale === 'bn' ? 'মোবাইল ওয়ালেট বা কার্ড—দুটোরই জন্য হাসপাতালের চুক্তি দরকার, যা এখনো হয়নি।' : 'A mobile wallet or card needs the hospital’s own commercial agreement, which is not in place in this build.'}
            />
          </FieldSection>

          <div className="rounded-md border border-border-subtle p-3 text-xs text-text-secondary">
            <p className="font-medium text-text-primary">{locale === 'bn' ? 'এই বিলটি এখন কীভাবে শোধ করা যায়' : 'How to pay it today'}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>{locale === 'bn' ? 'কাউন্টারে নগদ — সকাল ৮টা থেকে রাত ৮টা, প্রতিদিন।' : 'Cash at the counter — 08:00 to 20:00, every day.'}</li>
              <li>{locale === 'bn' ? 'ডেস্কে কার্ড — বিকাশ, নগদ ও কার্ড মেশিন ডেস্কে আছে।' : 'Card at the desk — the desk has the card machine, and the wallet numbers are given at the counter.'}</li>
              <li>{locale === 'bn' ? 'বিল নিয়ে প্রশ্ন থাকলে ফোন করুন ০২ ৯৮৭৬ ৫৬০ — টাকা দেওয়ার আগে জিজ্ঞেস করা ভালো।' : 'Anything on the bill that looks wrong: telephone 02 9876 560 before paying rather than after.'}</li>
            </ul>
            {bill.ask && <p className="mt-1">{bill.ask}</p>}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** The line as the patient reads it: Bangla by default, English on the switch. */
function locline(bn: string, en: string, locale: 'bn' | 'en') {
  return locale === 'bn' ? bn : en;
}

export const PAY_METHOD_LABELS = METHODS;
export { STR as PAY_STRINGS };
