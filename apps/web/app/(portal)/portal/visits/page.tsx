'use client';

import { useMemo, useState } from 'react';
import { Button, FieldSection, Panel, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, cx, useToast } from '@dizi/ui';
import { CalendarPlus, Clock, MapPin } from 'lucide-react';
import { usePortal, usePortalLocale } from '@/components/PortalShell';
import {
  APPOINTMENTS,
  CANCEL_CUTOFF_HOURS,
  PORTAL_CLINICS,
  STR,
  TAKEN_SLOTS,
  bnDigits,
  checkBooking,
  checkCancellation,
  moneyIn,
  niceDate,
  niceTime,
  tr,
  type PortalAppointment,
} from '@/lib/portal';
import { todayIso } from '@/lib/appointments';

/* The patient's visits: what is booked, what has been, and what can be changed from a phone.
 *
 * Two rules decide the screen, and both are about not letting a patient believe something that is not true:
 *
 *  - **A time that has gone is refused with the times that have not.** `dizi.slot-taken` is not an error message on
 *    this screen, it is a list of the next three times.
 *  - **The last two hours belong to the desk.** Inside the cut-off the portal refuses the cancellation and gives the
 *    number, because the token can still go to somebody waiting — and that only happens if a person is told.
 *
 * A booking made without a signal is held on the phone and sent when there is one. The patient is told that in the
 * strip at the top, in their own language, rather than being shown a tick for something the hospital has not seen.
 */

const ADD_DAYS = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const STATE_TONE: Record<PortalAppointment['state'], string> = {
  booked: 'bg-brand-50 text-brand-900 border-brand-300',
  attended: 'bg-surface-sunken text-text-secondary border-border-subtle',
  cancelled: 'bg-surface-sunken text-text-tertiary border-border-subtle',
  missed: 'bg-safety-warning/10 text-safety-warning border-safety-warning',
};

const CANCEL_REASONS = [
  { bn: 'আসতে পারছি না', en: 'I cannot come' },
  { bn: 'শরীর খারাপ', en: 'I am unwell' },
  { bn: 'অন্য দিন নিতে চাই', en: 'I want another day' },
  { bn: 'বাইরে আছি', en: 'I am out of the city' },
  { bn: 'অন্য জায়গায় দেখাতে যাব', en: 'I will be seen elsewhere' },
];

export default function PortalVisitsPage() {
  const locale = usePortalLocale();
  const { send, pending } = usePortal();
  const { push } = useToast();
  const t = (text: { bn: string; en: string }) => tr(text, locale);
  const day = todayIso();

  const [appointments, setAppointments] = useState<PortalAppointment[]>(APPOINTMENTS);
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const [booking, setBooking] = useState(false);
  const [choice, setChoice] = useState({ clinicId: 'anc', on: ADD_DAYS(day, 1), time: '11:00' });
  const [cancelling, setCancelling] = useState<PortalAppointment | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const open = appointments.filter((a) => a.state === 'booked').sort((a, b) => `${a.on}${a.time}`.localeCompare(`${b.on}${b.time}`));
  const past = appointments.filter((a) => a.state !== 'booked').sort((a, b) => `${b.on}${b.time}`.localeCompare(`${a.on}${a.time}`));
  const rows = view === 'upcoming' ? open : past;

  const clinic = PORTAL_CLINICS.find((c) => c.id === choice.clinicId) ?? PORTAL_CLINICS[0];
  const verdict = useMemo(
    () => checkBooking(choice, { today: day, nowMinute: 8 * 60, appointments, bills: [], gatewayConnected: false }),
    [choice, day, appointments],
  );
  const cancelVerdict = useMemo(
    () => (cancelling ? checkCancellation(cancelling, { today: day, nowMinute: 20 * 60, appointments, bills: [], gatewayConnected: false }) : null),
    [cancelling, day, appointments],
  );

  const book = () => {
    if (!verdict.ok) {
      push({
        title: locale === 'bn' ? 'সময়টি নেওয়া হলো না' : 'That time was not booked',
        description: verdict.reasons[0].message,
        tone: 'critical',
      });
      return;
    }
    const id = `ap-new-${appointments.length + 1}`;
    setAppointments((list) => [
      ...list,
      { id, on: choice.on, time: choice.time, department: clinic.department, departmentBn: clinic.departmentBn, doctor: clinic.doctor, room: clinic.room, branch: 'Main Campus', token: '—', state: 'booked', bring: locale === 'bn' ? 'সামনের ভিজিটের সময় কী আনতে হবে, তা এখানে লেখা থাকবে।' : 'Whatever you need to bring will be written here before the visit.', canCancelUntil: `${choice.on} 09:00`, fee: clinic.fee },
    ]);
    const wrote = send(`Booking request — ${clinic.department} on ${choice.on}`, `ভিজিটের আবেদন — ${choice.on} তারিখে ${clinic.departmentBn}`, {
      id: 'bookPortalAppointment',
      recordId: id,
      fields: { on: choice.on, time: choice.time, clinic: clinic.id, fee: clinic.fee },
    });
    setBooking(false);
    push({
      title: wrote.queued ? (locale === 'bn' ? 'আবেদন ফোনে রাখা হয়েছে' : 'The request is held on this phone') : locale === 'bn' ? 'পাঠানো যায়নি' : 'It could not be sent',
      description: wrote.queued
        ? locale === 'bn'
          ? `${niceDate(choice.on, 'bn')}, ${niceTime(choice.time, 'bn')} — সিগন্যাল পেলে হাসপাতালে পৌঁছে যাবে, তারপর টোকেন এসএমএস-এ আসবে। সময়টি শেষ পর্যন্ত নিশ্চিত নয়, কেউ আগে নিয়ে ফেলতে পারে; সে ক্ষেত্রে অন্য সময় জানানো হবে।`
          : `${niceDate(choice.on, 'en')} at ${niceTime(choice.time, 'en')}. It will reach the hospital when the phone has a signal, and the token comes by SMS after that. The time is not confirmed until then — another patient may take it first, and you would be offered another.`
        : wrote.because,
      tone: wrote.queued ? 'success' : 'critical',
    });
  };

  const cancel = () => {
    if (!cancelling || !cancelVerdict) return;
    if (!cancelVerdict.ok) {
      push({ title: locale === 'bn' ? 'বাতিল করা গেল না' : 'It was not cancelled', description: cancelVerdict.reasons[0].message, tone: 'critical' });
      return;
    }
    setAppointments((list) => list.map((a) => (a.id === cancelling.id ? { ...a, state: 'cancelled', cancelledReason: reason, bring: undefined } : a)));
    const wrote = send(`Cancel the visit on ${cancelling.on}`, `${cancelling.on} তারিখের ভিজিট বাতিল`, {
      id: 'cancelPortalAppointment',
      recordId: cancelling.id,
      fields: { appointment: cancelling.id, reason: reason || 'not given' },
    });
    setCancelling(null);
    setReason('');
    setNote('');
    push({
      title: t(STR.cancelled),
      description:
        locale === 'bn'
          ? `${niceDate(cancelling.on, 'bn')} তারিখের ভিজিটটি বাতিল করা হয়েছে। সময়টি অপেক্ষমাণ রোগীদের দেওয়া হবে — তাই জানানোটা জরুরি ছিল। ${
              wrote.queued ? 'বাতিলটি ফোনে রাখা হয়েছে এবং সিগন্যাল পেলে হাসপাতালে যাবে।' : wrote.because
            }`
          : `The visit on ${niceDate(cancelling.on, 'en')} is cancelled. The time goes to the people waiting, which is why telling us mattered. ${wrote.queued ? 'It is held on this phone and will reach the hospital with a signal.' : wrote.because}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t(STR.myVisits)}</h1>
        <p className="text-sm text-text-secondary">
          {locale === 'bn'
            ? open.length
              ? `আপনার ${bnDigits(open.length)}টি ভিজিট আসছে। পরেরটি ${niceDate(open[0].on, 'bn')}, ${niceTime(open[0].time, 'bn')}।`
              : 'এখন কোনো ভিজিট ঠিক নেই। নিচের বোতাম থেকে নিতে পারেন।'
            : open.length
              ? `${open.length} visit(s) coming up. The next is ${niceDate(open[0].on, 'en')} at ${niceTime(open[0].time, 'en')}.`
              : 'No visit is booked. You can book one below.'}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setBooking(true)}>
          <CalendarPlus className="size-4" aria-hidden /> {t(STR.bookVisit)}
        </Button>
        <a href="tel:+88029876540">
          <Button variant="ghost">{t(STR.callDesk)}</Button>
        </a>
      </div>

      {pending.length > 0 && (
        <p className="rounded-md border border-safety-warning bg-surface-sunken p-2 text-xs text-safety-warning">{t(STR.heldOnPhone)}</p>
      )}

      <Segmented
        label={locale === 'bn' ? 'কোন ভিজিট' : 'Which visits'}
        name="visit-view"
        value={view}
        onChange={(v) => setView(v as 'upcoming' | 'past')}
        options={[
          { value: 'upcoming', label: `${t(STR.upcoming)} (${open.length})` },
          { value: 'past', label: `${t(STR.past)} (${past.length})` },
        ]}
      />

      <ul className="space-y-3">
        {rows.map((a) => (
          <li key={a.id} className={cx('rounded-lg border p-3', STATE_TONE[a.state])}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">
                  {niceDate(a.on, locale)} · {niceTime(a.time, locale)}
                </p>
                <p className="text-sm">
                  {locale === 'bn' ? a.departmentBn : a.department} — {a.doctor}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-text-secondary">
                  <MapPin className="size-3.5" aria-hidden /> {a.room}, {a.branch}
                  <span className="mx-1">·</span>
                  <Clock className="size-3.5" aria-hidden />
                  {locale === 'bn' ? `টোকেন ${bnDigits(a.token)}` : `Token ${a.token}`}
                </p>
                {a.bring && <p className="mt-1 text-sm text-text-secondary">{a.bring}</p>}
                {a.cancelledReason && (
                  <p className="mt-1 text-sm text-text-secondary">
                    {locale === 'bn' ? 'কারণ: ' : 'Reason: '}
                    {a.cancelledReason}
                  </p>
                )}
                <p className="mt-1 text-xs text-text-secondary">
                  {locale === 'bn' ? `কাউন্টারে দিতে হবে ${moneyIn(a.fee, 'bn')}` : `${moneyIn(a.fee, 'en')} is payable at the counter`}
                </p>
                {a.state === 'booked' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => { setCancelling(a); setReason(''); setNote(''); }}>
                      {t(STR.cancelVisit)}
                    </Button>
                  </div>
                )}
              </div>
              <span className="rounded-full border border-current px-2 py-0.5 text-xs font-medium">{t(a.state === 'booked' ? STR.confirmed : a.state === 'attended' ? STR.attended : a.state === 'cancelled' ? STR.cancelled : STR.missed)}</span>
            </div>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <Panel>
          <p className="text-sm text-text-secondary">
            {view === 'upcoming'
              ? locale === 'bn'
                ? 'এখন কোনো ভিজিট ঠিক নেই। নতুন ভিজিট নিতে উপরের বোতামটি চাপুন।'
                : 'No visit is booked. Use the button above to book one.'
              : locale === 'bn'
                ? 'এখনো কোনো পুরনো ভিজিট নেই।'
                : 'There are no earlier visits yet.'}
          </p>
        </Panel>
      )}

      <Panel title={locale === 'bn' ? 'ভিজিট বাতিলের নিয়ম' : 'Changing a visit'}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>
            {locale === 'bn'
              ? `ভিজিটের ${bnDigits(CANCEL_CUTOFF_HOURS)} ঘণ্টার বেশি আগে হলে এই অ্যাপ থেকেই বাতিল করা যায়।`
              : `You can cancel here any time up to ${CANCEL_CUTOFF_HOURS} hours before the visit.`}
          </li>
          <li>
            {locale === 'bn'
              ? 'শেষ দুই ঘণ্টায় বাতিলের জন্য ডেস্কে ফোন করতে হয়: টোকেনটি তখন অপেক্ষমাণ রোগীদের দেওয়া যায়।'
              : 'In the last two hours, telephone the desk instead: the token can still go to somebody waiting.'}
          </li>
          <li>
            {locale === 'bn'
              ? 'অনলাইনে সামনের ৩০ দিন পর্যন্ত সময় নেওয়া যায়। এর বেশি দূরের তারিখের জন্য ডেস্কে ফোন করুন।'
              : 'The app books up to 30 days ahead. For a date further away, telephone the desk.'}
          </li>
        </ul>
      </Panel>

      {/* ------------------------------------------------------------- book a visit */}
      <Sheet
        open={booking}
        onClose={() => setBooking(false)}
        title={t(STR.bookVisit)}
        description={locale === 'bn' ? 'ক্লিনিক, দিন ও সময় বেছে নিন। সময়টি তখনই নিশ্চিত হয় যখন হাসপাতাল থেকে টোকেন আসে।' : 'Choose the clinic, the day and the time. It is confirmed when the hospital sends the token.'}
        width="md"
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">{verdict.ok ? (locale === 'bn' ? 'সময়টি খালি আছে।' : 'That time is free.') : (locale === 'bn' ? `${bnDigits(verdict.reasons.length)}টি বিষয় ঠিক করতে হবে।` : `${verdict.reasons.length} thing(s) to fix.`)}</span>
            <Button variant="ghost" onClick={() => setBooking(false)}>
              {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </Button>
            <Button variant="primary" onClick={book} disabled={!verdict.ok}>
              {t(STR.bookThis)}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!verdict.ok && (
            <SafetyBanner severity="warning" title={locale === 'bn' ? 'এই সময়টি এখন নেওয়া যাবে না' : 'This time cannot be booked'}>
              <p>{verdict.reasons[0].message}</p>
              <p lang={locale === 'bn' ? 'bn' : 'en'} className="mt-1 text-xs">
                {verdict.reasons[0].messageBn}
              </p>
            </SafetyBanner>
          )}
          {verdict.ok && verdict.warnings.length > 0 && (
            <SafetyBanner severity="info" title={locale === 'bn' ? 'জেনে রাখুন' : 'Worth knowing'}>
              <ul className="list-disc space-y-1 pl-5">
                {verdict.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}

          <FieldSection title={locale === 'bn' ? 'কোথায় কখন' : 'Where and when'}>
            <SelectField
              label={t(STR.chooseClinic)}
              name="clinic"
              value={choice.clinicId}
              onChange={(e) => {
                const chosen = PORTAL_CLINICS.find((c) => c.id === e.target.value);
                setChoice((c) => ({ ...c, clinicId: e.target.value, time: chosen?.times[0] ?? c.time }));
              }}
              options={PORTAL_CLINICS.map((c) => ({ value: c.id, label: locale === 'bn' ? `${c.departmentBn} — ${c.doctor}` : `${c.department} — ${c.doctor}` }))}
              hint={locale === 'bn' ? `${clinic.days} খোলা · ${clinic.room} · কাউন্টারে ${moneyIn(clinic.fee, 'bn')}` : `Open ${clinic.days} · ${clinic.room} · ${moneyIn(clinic.fee, 'en')} at the counter`}
            />
            <SelectField
              label={t(STR.chooseDay)}
              name="day"
              value={choice.on}
              onChange={(e) => setChoice((c) => ({ ...c, on: e.target.value }))}
              options={Array.from({ length: 30 }, (_, i) => ADD_DAYS(day, i + 1)).map((iso) => ({ value: iso, label: niceDate(iso, locale) }))}
            />
            <SelectField
              label={t(STR.chooseTime)}
              name="time"
              value={choice.time}
              onChange={(e) => setChoice((c) => ({ ...c, time: e.target.value }))}
              options={clinic.times.map((tm) => ({ value: tm, label: `${niceTime(tm, locale)}${TAKEN_SLOTS.includes(`${choice.on} ${tm}`) ? (locale === 'bn' ? ' — নেওয়া হয়ে গেছে' : ' — already taken') : ''}` }))}
              hint={locale === 'bn' ? 'যে সময়গুলো আগেই নেওয়া হয়ে গেছে, সেগুলোও দেখানো হয় — কারণ জানাটা দরকার।' : 'Times that have already gone are shown as taken rather than hidden: knowing why is part of the answer.'}
            />
            <TextAreaField
              label={locale === 'bn' ? 'ডাক্তারকে জানানোর মতো কিছু আছে?' : 'Anything the doctor should know?'}
              name="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              hint={locale === 'bn' ? 'নাম, বয়স ও সমস্যা সংক্ষেপে। এখানে বিস্তারিত ইতিহাস লেখার দরকার নেই।' : 'A few words: since when, and what is happening. You do not have to write the whole history.'}
            />
          </FieldSection>

          <div className="rounded-md border border-border-subtle p-3 text-xs text-text-secondary">
            <p className="font-medium text-text-primary">{locale === 'bn' ? 'টোকেন কীভাবে আসে' : 'How the token reaches you'}</p>
            <p className="mt-1">
              {locale === 'bn'
                ? `আপনার নথিতে থাকা নম্বরে এসএমএস যাবে — ${bnDigits('01711-884 210')}। অন্য কোনো নম্বরে টোকেন যায় না। নম্বর বদলাতে হলে ডেস্কে জানান।`
                : 'An SMS goes to the number on your record — 01711-884 210. Tokens never go to another number. Tell the desk if the number has changed.'}
            </p>
          </div>
        </div>
      </Sheet>

      {/* ------------------------------------------------------------- cancel a visit */}
      <Sheet
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title={t(STR.cancelVisit)}
        description={cancelling ? `${niceDate(cancelling.on, locale)} · ${niceTime(cancelling.time, locale)} — ${cancelling.doctor}` : undefined}
        width="md"
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">{cancelVerdict?.ok ? (locale === 'bn' ? 'সময়টি অপেক্ষমাণ রোগীদের দেওয়া হবে।' : 'The time will be offered to the people waiting.') : locale === 'bn' ? 'এই ভিজিটটি এখান থেকে বাতিল করা যাবে না।' : 'This visit cannot be cancelled from here.'}</span>
            <Button variant="ghost" onClick={() => setCancelling(null)}>
              {locale === 'bn' ? 'রাখুন' : 'Keep it'}
            </Button>
            <Button variant="primary" onClick={cancel} disabled={!cancelVerdict?.ok || !reason}>
              {locale === 'bn' ? 'ভিজিট বাতিল করুন' : 'Cancel the visit'}
            </Button>
          </>
        }
      >
        {cancelVerdict && (
          <div className="space-y-3">
            {!cancelVerdict.ok && (
              <SafetyBanner severity={cancelVerdict.reasons[0].code === 'inside-cutoff' ? 'warning' : 'critical'} title={locale === 'bn' ? 'এখান থেকে বাতিল করা যাবে না' : 'Not cancellable from here'}>
                <p>{cancelVerdict.reasons[0].message}</p>
                <p lang={locale === 'bn' ? 'bn' : 'en'} className="mt-1 text-xs">
                  {cancelVerdict.reasons[0].messageBn}
                </p>
              </SafetyBanner>
            )}
            {cancelVerdict.warnings.length > 0 && (
              <SafetyBanner severity="info" title={locale === 'bn' ? 'জেনে রাখুন' : 'Worth knowing'}>
                <ul className="list-disc space-y-1 pl-5">
                  {cancelVerdict.warnings.map((w) => (
                    <li key={w.code}>{w.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}
            <FieldSection title={locale === 'bn' ? 'কারণ জানালে সুবিধা হয়' : 'Telling us why helps'}>
              <SelectField
                label={locale === 'bn' ? 'কারণ' : 'Reason'}
                name="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                options={[{ value: '', label: locale === 'bn' ? 'বেছে নিন…' : 'Choose…' }, ...CANCEL_REASONS.map((r) => ({ value: r.en, label: locale === 'bn' ? r.bn : r.en }))]}
                required
              />
              <div className="md:col-span-2">
                <TextAreaField
                  label={locale === 'bn' ? 'আর কিছু বলার থাকলে' : 'Anything else'}
                  name="cancel-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  hint={locale === 'bn' ? 'ঐচ্ছিক। কারণটি ডেস্ক দেখতে পায়, তাই সময়টি কাজে লাগানো যায়।' : 'Optional. The desk sees the reason, which is how the time gets used.'}
                />
              </div>
            </FieldSection>
            <p className="text-xs text-text-secondary">
              {locale === 'bn'
                ? 'বাতিল করা মানে মুছে ফেলা নয়: আপনার নথিতে বাতিলের কারণ ও তারিখ থেকে যায়, কারণ হিসাব ও অপেক্ষমাণ তালিকা তার উপরেই চলে।'
                : 'Cancelling is not deleting: the reason and the date stay on your record, because the waiting list and the clinic figures are built on them.'}
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
