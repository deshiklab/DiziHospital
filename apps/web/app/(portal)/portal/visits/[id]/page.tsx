'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Panel, SafetyBanner, cx } from '@dizi/ui';
import { AlertTriangle, ArrowLeft, CalendarPlus, ClipboardList, MapPin, Phone, Stethoscope } from 'lucide-react';
import { usePortal, usePortalLocale } from '@/components/PortalShell';
import {
  BILLS,
  BOOKING_FEE,
  FEE_CUTOFF_HOURS,
  STR,
  appointmentById,
  billDue,
  billTotal,
  bookingFeeOutcome,
  branchLabel,
  bnDigits,
  moneyIn,
  niceDate,
  niceTime,
  tr,
  visitNote,
  type PortalAppointment,
} from '@/lib/portal';

/* One visit, in full (P8, portal sub-screen).
 *
 * The list says when to come. This screen answers what the visit is, what happened at it, what it cost, and what to
 * do about it — and it is the only place in the portal where an appointment is more than a row:
 *
 *  1. **Where and when, said the way the desk says it.** Branch before room, because a patient who goes to the
 *     wrong gate never reaches the room; the phone number of the desk is on the page, not one tap away.
 *  2. **What the doctor released.** An attended visit carries the summary the doctor let the patient see — what was
 *     found, what was asked of them, which tests were ordered and what happens next. Not released yet says so.
 *  3. **A visit that did not happen says that too.** Nothing was written because nothing happened, and the page
 *     offers the thing the patient actually needs: a new time.
 *  4. **The money is the desk's arithmetic, not this screen's.** The consultation fee comes from the visit and the
 *     booking fee follows the hospital's own rule — adjusted, refunded or retained — with the rule written out
 *     rather than left to be discovered at the counter.
 */

const STATE: Partial<Record<PortalAppointment['state'], { bn: string; en: string; tone: string }>> = {
  booked: { bn: 'ঠিক আছে', en: 'Booked', tone: 'border-brand-300 text-brand-700' },
  attended: { bn: 'হয়ে গেছে', en: 'Seen', tone: 'border-safety-success text-safety-success' },
  cancelled: { bn: 'বাতিল', en: 'Cancelled', tone: 'border-border-subtle text-text-secondary' },
  missed: { bn: 'আসা হয়নি', en: 'Not attended', tone: 'border-safety-warning text-safety-warning' },
};

export default function PortalVisitDetailPage() {
  const params = useParams<{ id: string }>();
  const locale = usePortalLocale();
  const t = (text: { bn: string; en: string }) => tr(text, locale);

  const visit = appointmentById(params.id);
  const note = visit ? visitNote(visit.id) : undefined;
  const billsHere = visit ? BILLS.filter((b) => b.on === visit.on) : [];

  if (!visit) {
    return (
      <div className="space-y-4">
        <BackLink label={t(STR.back)} />
        <Panel title={t(STR.notFoundVisit)}>
          <p className="text-sm text-text-secondary">{t(STR.notFoundVisitWhy)}</p>
          <Link href="/portal/visits" className="mt-3 inline-block">
            <Button variant="secondary">{t(STR.myVisits)}</Button>
          </Link>
        </Panel>
      </div>
    );
  }

  const state = STATE[visit.state] ?? STATE.booked!;
  const outcome = bookingFeeOutcome(visit);
  const feeWords: Record<typeof outcome, { bn: string; en: string }> = {
    adjusted: STR.feeAdjusted,
    refunded: STR.feeRefunded,
    retained: STR.feeRetained,
    held: STR.feeHeld,
  };

  return (
    <div className="space-y-4">
      <BackLink label={t(STR.back)} />

      <header className="rounded-lg border border-border-subtle bg-surface-default p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text-primary">
              {niceDate(visit.on, locale)} · {niceTime(visit.time, locale)}
            </h1>
            <p className="mt-0.5 text-sm text-text-secondary">
              {locale === 'bn' ? visit.departmentBn : visit.department} — {visit.doctor}
            </p>
          </div>
          <span className={cx('shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium', state.tone)}>{t(state)}</span>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-text-tertiary">{t(STR.branch)}</dt>
            <dd className="font-medium text-text-primary">{branchLabel(visit.branch, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-tertiary">{t(STR.room)}</dt>
            <dd className="font-medium text-text-primary">{visit.room}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-tertiary">{t(STR.token)}</dt>
            <dd className="font-medium text-text-primary">{locale === 'bn' ? bnDigits(visit.token) : visit.token}</dd>
          </div>
        </dl>

        <p className="mt-3 flex items-start gap-1.5 text-xs text-text-secondary">
          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {locale === 'bn'
            ? `${branchLabel(visit.branch, 'bn')}, ${visit.room} — রিসেপশনে নাম ও এমআরএন বললেই দেখিয়ে দেবেন।`
            : `${visit.branch}, ${visit.room}. Give your name and MRN at the reception desk and they will point you to it.`}
        </p>
      </header>

      {visit.state === 'booked' && (
        <>
          {visit.bring && (
            <Panel title={t(STR.whatToBring)}>
              <p className="text-sm text-text-secondary">{visit.bring}</p>
              <p className="mt-2 text-xs text-text-tertiary">{t(STR.comeEarly)}</p>
            </Panel>
          )}
          <Panel title={locale === 'bn' ? 'বাতিল বা বদল করতে' : 'Changing this visit'}>
            <p className="text-sm text-text-secondary">
              {locale === 'bn'
                ? `ভিজিটের ${bnDigits(String(FEE_CUTOFF_HOURS))} ঘণ্টার বেশি আগে বাতিল করলে অগ্রিম ফেরত দেওয়া হয়; সময়টা অপেক্ষমাণ রোগীদের দেওয়া হয়।`
                : `Cancelling more than ${FEE_CUTOFF_HOURS} hours before the slot refunds the booking fee, and the time goes to somebody waiting.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/portal/visits">
                <Button variant="secondary">{t(STR.cancelVisit)}</Button>
              </Link>
              <a href="tel:+88029876540">
                <Button variant="ghost">
                  <Phone className="size-4" aria-hidden /> {t(STR.callDesk)}
                </Button>
              </a>
            </div>
          </Panel>
        </>
      )}

      {visit.state === 'cancelled' && (
        <Panel title={t(STR.cancelled)}>
          <p className="text-sm text-text-secondary">
            {locale === 'bn'
              ? `এই ভিজিটটি বাতিল করা হয়েছে${visit.cancelledReason ? ` — কারণ: ${visit.cancelledReason}` : ''}। সময়টি অপেক্ষমাণ রোগীদের দেওয়া হয়েছে।`
              : `This visit was cancelled${visit.cancelledReason ? ` — reason: ${visit.cancelledReason}` : ''}. The time went to somebody on the waiting list.`}
          </p>
        </Panel>
      )}

      {visit.state === 'missed' && (
        <SafetyBanner severity="warning" title={t(STR.didNotAttend)}>
          <p>{t(STR.didNotAttendWhy)}</p>
        </SafetyBanner>
      )}

      {/* ---------------------------------------------------------------- what the visit left behind */}
      {(visit.state === 'attended' || visit.state === 'missed') && (
        <Panel
          title={t(STR.whatHappened)}
          actions={<Stethoscope className="size-4 text-text-tertiary" aria-hidden />}
        >
          {note?.releasedOn ? (
            <div className="space-y-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t(STR.whatTheDoctorWrote)}</h3>
                <p className="mt-1 text-sm text-text-primary">{locale === 'bn' ? note.whatWasFoundBn : note.whatWasFound}</p>
                <p className="mt-1 text-xs text-text-tertiary">
                  {locale === 'bn'
                    ? `${note.seenBy} · লেখা হয়েছে ${niceDate(note.writtenOn, 'bn')}`
                    : `${note.seenBy} · written ${niceDate(note.writtenOn, 'en')}`}
                </p>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t(STR.whatYouWereTold)}</h3>
                <ul className="mt-1 space-y-1">
                  {(locale === 'bn' ? note.adviceBn : note.advice).map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              {(locale === 'bn' ? note.testsOrderedBn : note.testsOrdered).length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t(STR.testsOrdered)}</h3>
                  <ul className="mt-1 space-y-1">
                    {(locale === 'bn' ? note.testsOrderedBn : note.testsOrdered).map((line, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                        <ClipboardList className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-md border border-border-subtle p-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t(STR.whatHappensNext)}</h3>
                <p className="mt-1 text-sm text-text-primary">{locale === 'bn' ? note.nextStepBn : note.nextStep}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t(STR.notReleasedYetWhy)}</p>
          )}
        </Panel>
      )}

      {/* ---------------------------------------------------------------- the money */}
      <Panel title={t(STR.moneyForThisVisit)}>
        <dl className="space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-secondary">{t(STR.consultationFee)}</dt>
            <dd className="font-numeric font-medium text-text-primary">{moneyIn(visit.fee, locale)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-secondary">{t(STR.bookingFee)}</dt>
            <dd className="font-numeric font-medium text-text-primary">
              {moneyIn(BOOKING_FEE, locale)}
              <span className="ml-2 text-xs font-normal text-text-secondary">{t(feeWords[outcome])}</span>
            </dd>
          </div>
        </dl>

        {visit.state === 'booked' && (
          <p className="mt-2 text-xs text-text-secondary">
            {locale === 'bn'
              ? `${moneyIn(visit.fee, 'bn')} — কাউন্টারে দিতে হবে। অগ্রিমটি বিল থেকে কেটে নেওয়া হবে।`
              : `${moneyIn(visit.fee, 'en')} is payable at the counter when you come, and the booking fee comes off that bill.`}
          </p>
        )}
        <p className="mt-2 text-xs text-text-secondary">{t(STR.feeRule)}</p>

        {billsHere.length > 0 && (
          <div className="mt-3 border-t border-border-subtle pt-3">
            {billsHere.map((b) => (
              <div key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-text-secondary">
                  {locale === 'bn' ? 'বিল' : 'Bill'} {b.no}
                </span>
                <span className="font-numeric text-text-primary">
                  {moneyIn(billTotal(b), locale)}
                  {billDue(b) > 0 ? (
                    <span className="ml-2 text-xs text-safety-warning-text">
                      {locale === 'bn' ? `${moneyIn(billDue(b), 'bn')} বাকি` : `${moneyIn(billDue(b), 'en')} to pay`}
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-safety-success">
                      {locale === 'bn' ? 'পরিশোধিত' : 'Paid'}
                    </span>
                  )}
                </span>
              </div>
            ))}
            <Link href="/portal/bills" className="mt-2 inline-block text-sm font-medium text-brand-700">
              {t(STR.myBills)}
            </Link>
          </div>
        )}
      </Panel>

      {(visit.state === 'missed' || visit.state === 'cancelled') && (
        <div className="flex flex-wrap gap-2">
          <Link href="/portal/visits">
            <Button variant="primary">
              <CalendarPlus className="size-4" aria-hidden /> {t(STR.bookAgain)}
            </Button>
          </Link>
          <a href="tel:+88029876540">
            <Button variant="ghost">
              <Phone className="size-4" aria-hidden /> {t(STR.callDesk)}
            </Button>
          </a>
        </div>
      )}

      {visit.state === 'booked' && (
        <p className="flex items-start gap-1.5 text-xs text-text-secondary">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-safety-warning" aria-hidden />
          {locale === 'bn'
            ? 'সময়মতো না এলে টোকেনটি বাতিল হয়ে যায় এবং সময়টি অন্য রোগীকে দেওয়া হয়। দেরি হলে ডেস্কে ফোন করলে জানিয়ে দেওয়া হবে সময় আছে কি না।'
            : 'If you cannot come, the token lapses and the time goes to somebody else. If you are running late, telephoning the desk is answered with whether the slot is still there.'}
        </p>
      )}
    </div>
  );
}

/** Back to the visit list — a place, named, rather than a browser history move. */
function BackLink({ label }: { label: string }) {
  return (
    <Link href="/portal/visits" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700">
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
