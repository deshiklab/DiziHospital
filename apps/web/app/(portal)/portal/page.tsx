'use client';

import Link from 'next/link';
import { Button, Panel } from '@dizi/ui';
import { CalendarDays, FileText, Pill, ReceiptText, TriangleAlert } from 'lucide-react';
import { usePortal, usePortalLocale } from '@/components/PortalShell';
import {
  APPOINTMENTS,
  BILLS,
  FEEDBACK,
  PATIENT,
  PORTAL_AUTH,
  PORTAL_WAITING,
  PRESCRIPTIONS,
  RESULTS,
  STR,
  billDue,
  bnDigits,
  moneyIn,
  niceDate,
  niceTime,
  portalDigest,
  tr,
} from '@/lib/portal';
import { todayIso } from '@/lib/appointments';

/* The patient's home screen.
 *
 * It answers four questions in the order patients ask them: when is my next visit, is my report ready, do I owe
 * money, and do I have to go to the pharmacy. Everything else — the history, the receipts, the feedback — is one tap
 * away in the bar at the bottom, and nothing here is a table: a phone is not a desk.
 */

export default function PortalHomePage() {
  const locale = usePortalLocale();
  const { pending } = usePortal();
  const t = (text: { bn: string; en: string }) => tr(text, locale);
  const day = todayIso();
  const digest = portalDigest({ today: day, appointments: APPOINTMENTS, results: RESULTS, bills: BILLS, feedback: FEEDBACK });

  const next = digest.nextAppointment;
  const toCollect = PRESCRIPTIONS.flatMap((p) => p.items).filter((i) => i.collected === 'waiting').length;
  const ready = RESULTS.filter((r) => r.state === 'released').length;

  return (
    <div className="space-y-4">
      <section aria-labelledby="hello">
        <h1 id="hello" className="text-lg font-semibold text-text-primary">
          {locale === 'bn' ? `স্বাগতম, ${PATIENT.nameBn.split(' ')[0]}` : `Welcome, ${PATIENT.name.split(' ')[0]}`}
        </h1>
        <p className="text-sm text-text-secondary">
          {locale === 'bn'
            ? `${PATIENT.mrn} · ${bnDigits(PATIENT.age)} বছর · রক্তের গ্রুপ ${PATIENT.bloodGroup}`
            : `${PATIENT.mrn} · ${PATIENT.age} years · blood group ${PATIENT.bloodGroup}`}
        </p>
      </section>

      {/* The one thing the patient opened the app for. */}
      <section aria-labelledby="next-visit" className="rounded-lg border border-brand-300 bg-brand-50 p-4">
        <h2 id="next-visit" className="text-sm font-semibold text-brand-900">
          {t(STR.nextVisit)}
        </h2>
        {next ? (
          <>
            <p className="mt-1 text-2xl font-semibold text-text-primary">{niceDate(next.on, locale)}</p>
            <p className="text-xl text-text-primary">{niceTime(next.time, locale)}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div>
                <dt className="text-text-tertiary">{t(STR.clinic)}</dt>
                <dd className="text-text-primary">{locale === 'bn' ? next.departmentBn : next.department}</dd>
              </div>
              <div>
                <dt className="text-text-tertiary">{locale === 'bn' ? 'ডাক্তার' : 'Doctor'}</dt>
                <dd className="text-text-primary">{next.doctor}</dd>
              </div>
              <div>
                <dt className="text-text-tertiary">{t(STR.room)}</dt>
                <dd className="text-text-primary">{next.room}</dd>
              </div>
              <div>
                <dt className="text-text-tertiary">{t(STR.token)}</dt>
                <dd className="text-text-primary">{locale === 'bn' ? bnDigits(next.token) : next.token}</dd>
              </div>
            </dl>
            {next.bring && (
              <p className="mt-3 rounded-md bg-surface-raised p-2 text-sm text-text-secondary">
                <span className="font-medium text-text-primary">{t(STR.whatToBring)}: </span>
                {next.bring}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/portal/visits">
                <Button variant="secondary">{t(STR.myVisits)}</Button>
              </Link>
              <Link href="/portal/visits">
                <Button variant="ghost">{t(STR.cancelVisit)}</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-text-secondary">{t(STR.nothingBooked)}</p>
            <Link href="/portal/visits">
              <Button variant="primary" className="mt-3">
                {t(STR.bookVisit)}
              </Button>
            </Link>
          </>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/portal/reports" className="rounded-lg border border-border-subtle bg-surface-default p-3 hover:border-brand-300">
          <FileText className="size-5 text-brand-600" aria-hidden />
          <p className="mt-1 text-2xl font-semibold text-text-primary">{locale === 'bn' ? bnDigits(ready) : ready}</p>
          <p className="text-sm text-text-secondary">{t(STR.ready)}</p>
        </Link>
        <Link href="/portal/bills" className="rounded-lg border border-border-subtle bg-surface-default p-3 hover:border-brand-300">
          <ReceiptText className="size-5 text-brand-600" aria-hidden />
          <p className="mt-1 text-2xl font-semibold text-text-primary">{digest.due > 0 ? moneyIn(digest.due, locale) : locale === 'bn' ? 'কিছু নেই' : 'Nothing'}</p>
          <p className="text-sm text-text-secondary">{t(STR.due)}</p>
        </Link>
        <Link href="/portal/prescriptions" className="rounded-lg border border-border-subtle bg-surface-default p-3 hover:border-brand-300">
          <Pill className="size-5 text-brand-600" aria-hidden />
          <p className="mt-1 text-2xl font-semibold text-text-primary">{locale === 'bn' ? bnDigits(toCollect) : toCollect}</p>
          <p className="text-sm text-text-secondary">{t(STR.medicines)}</p>
        </Link>
        <Link href="/portal/visits" className="rounded-lg border border-border-subtle bg-surface-default p-3 hover:border-brand-300">
          <CalendarDays className="size-5 text-brand-600" aria-hidden />
          <p className="mt-1 text-2xl font-semibold text-text-primary">{locale === 'bn' ? bnDigits(digest.openAppointments) : digest.openAppointments}</p>
          <p className="text-sm text-text-secondary">{t(STR.upcoming)}</p>
        </Link>
      </div>

      {digest.withheld > 0 && (
        <Panel>
          <p className="flex items-start gap-2 text-sm text-text-secondary">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-safety-warning" aria-hidden />
            <span>
              {locale === 'bn'
                ? 'একটি রিপোর্ট তৈরি, কিন্তু ডাক্তার সেটি নিজে বুঝিয়ে বলতে চান — তাই এখানে লেখা নেই। ফোন করুন ০২ ৯৮৭৬ ৫৪০, অ্যাপয়েন্টমেন্ট লাগবে না।'
                : 'One report is ready, but your doctor wants to explain it rather than have you read it on a phone. Telephone 02 9876 540 — you do not need an appointment to ask.'}
            </span>
          </p>
        </Panel>
      )}

      <Panel>
        <h2 className="text-sm font-semibold text-text-primary">{locale === 'bn' ? 'এই অ্যাপে যা করতে পারেন' : 'What you can do here'}</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-text-secondary">
          <li>
            <Link className="text-brand-700 underline" href="/portal/visits">
              {t(STR.bookVisit)}
            </Link>{' '}
            — {locale === 'bn' ? 'সামনের ৩০ দিনের মধ্যে যেকোনো ক্লিনিকে।' : 'any clinic, up to 30 days ahead.'}
          </li>
          <li>
            <Link className="text-brand-700 underline" href="/portal/reports">
              {t(STR.myReports)}
            </Link>{' '}
            — {locale === 'bn' ? 'যেগুলো ডাক্তার ছেড়ে দিয়েছেন, সেগুলো এখানেই।' : 'the ones your doctor has released, and nothing before that.'}
          </li>
          <li>
            <Link className="text-brand-700 underline" href="/portal/bills">
              {t(STR.myBills)}
            </Link>{' '}
            — {locale === 'bn' ? 'কাউন্টারে যাওয়ার আগেই দেখে নিন কত দিতে হবে।' : 'see what is due before you stand at the counter.'}
          </li>
          <li>
            <Link className="text-brand-700 underline" href="/portal/feedback">
              {t(STR.sendFeedback)}
            </Link>{' '}
            — {locale === 'bn' ? 'ভালো লাগলে, খারাপ লাগলেও। তিন কর্মদিবসে উত্তর আসে।' : 'good or bad, answered within three working days.'}
          </li>
        </ul>
      </Panel>

      <Panel title={locale === 'bn' ? 'জরুরি অবস্থায়' : 'In an emergency'}>
        <p className="text-sm text-text-secondary">
          {locale === 'bn'
            ? 'শ্বাস নিতে কষ্ট, বুকে ব্যথা, বেশি রক্তক্ষরণ, জ্ঞান হারানো, বা গর্ভাবস্থায় ব্যথা বা পানি ভাঙার মতো কিছু হলে এই অ্যাপে সময় নষ্ট করবেন না — সরাসরি জরুরি বিভাগে আসুন, অথবা ০২ ৯৮৭৬ ৫০০ নম্বরে ফোন করুন। ফোনটি চব্বিশ ঘণ্টা ধরা হয়।'
            : 'Difficulty breathing, chest pain, heavy bleeding, fainting, or pain or waters breaking in pregnancy: do not spend time in this app. Come to the emergency department, or telephone 02 9876 500. That telephone is answered 24 hours.'}
        </p>
      </Panel>

      {pending.length > 0 && (
        <Panel title={locale === 'bn' ? 'এখনো পাঠানো হয়নি' : 'Not sent yet'}>
          <ul className="space-y-1 text-sm text-text-secondary">
            {pending.map((p) => (
              <li key={p.id}>
                {locale === 'bn' ? p.labelBn : p.label} — {t(STR.heldOnPhone)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-text-tertiary">
            {locale === 'bn'
              ? 'সিগন্যাল ফিরলে আপনি নিজেই “পাঠান” চেপে জমা দিতে পারেন, অথবা হাসপাতালে পৌঁছে গেলে নিজেই যাবে।'
              : 'When you have a signal, press Send in the strip at the top, or it goes by itself once the phone has one. Nothing is lost either way.'}
          </p>
        </Panel>
      )}

      <Panel title={locale === 'bn' ? 'এই সংস্করণে যেটি এখনো নেই' : 'What is not in this version yet'}>
        <p className="text-sm text-text-secondary">{locale === 'bn' ? PORTAL_AUTH.whatBn : PORTAL_AUTH.what}</p>
        <ul className="mt-2 space-y-1 text-xs text-text-tertiary">
          {PORTAL_WAITING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
