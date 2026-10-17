'use client';

import { useMemo, useState } from 'react';
import { Button, CheckboxField, FieldSection, Panel, SafetyBanner, SelectField, Sheet, TextAreaField, cx, useToast } from '@dizi/ui';
import { MessageSquare, Phone } from 'lucide-react';
import { usePortal, usePortalLocale } from '@/components/PortalShell';
import { FEEDBACK, FEEDBACK_PROMISE, FEEDBACK_SUBJECTS, STR, checkFeedback, niceDate, tr, type PortalFeedback } from '@/lib/portal';
import { todayIso } from '@/lib/appointments';

/* Feedback — and the point at which a form stops being the right answer.
 *
 * This is the one screen in the portal where the hospital has to be willing to refuse. A description that reads like
 * an emergency is not an email: it becomes a sentence telling the patient to come in or telephone, because a form
 * read in office hours is the wrong channel for a patient who is bleeding. A clinical question is refused for the
 * same reason the report screen withholds a result — the portal will not answer a question about treatment, and it
 * will not pretend to.
 *
 * Everything else is answered: three working days, in writing, in the portal, with the name of the person who wrote
 * it. The two answers below are real in the sense that matters — one of them says what the hospital changed.
 */

export default function PortalFeedbackPage() {
  const locale = usePortalLocale();
  const { send } = usePortal();
  const { push } = useToast();
  const t = (text: { bn: string; en: string }) => tr(text, locale);
  const day = todayIso();

  const [feedback, setFeedback] = useState<PortalFeedback[]>(FEEDBACK);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ subject: FEEDBACK_SUBJECTS[0], about: '', whatINoticed: '', mayTelephone: true });

  const verdict = useMemo(
    () => checkFeedback(draft, { today: day, nowMinute: 10 * 60, appointments: [], bills: [], gatewayConnected: false }),
    [draft, day],
  );

  const submit = () => {
    if (!verdict.ok) {
      push({ title: locale === 'bn' ? 'পাঠানো গেল না' : 'It was not sent', description: verdict.reasons[0].message, tone: 'critical' });
      return;
    }
    const reference = `FB-2026-${String(340 + feedback.length + 1).padStart(4, '0')}`;
    const row: PortalFeedback = { id: `fb-new-${feedback.length + 1}`, reference, sentAt: day, subject: draft.subject, about: draft.about || (locale === 'bn' ? 'হাসপাতাল' : 'The hospital'), whatINoticed: draft.whatINoticed, state: 'received' };
    setFeedback((list) => [row, ...list]);
    const wrote = send(`Feedback — ${row.subject}`, `মতামত — ${row.subject}`, {
      id: 'submitPortalFeedback',
      recordId: row.id,
      fields: { reference, subject: row.subject, mayTelephone: String(draft.mayTelephone) },
    });
    setOpen(false);
    setDraft({ subject: FEEDBACK_SUBJECTS[0], about: '', whatINoticed: '', mayTelephone: true });
    push({
      title: locale === 'bn' ? `পাঠানো হয়েছে — রেফারেন্স ${reference}` : `Sent — reference ${reference}`,
      description: wrote.queued
        ? locale === 'bn'
          ? `${FEEDBACK_PROMISE} এই নম্বরটি ধরে রাখুন; ফোনে জিজ্ঞেস করলে এটিই দরকার হবে। ${
              verdict.warnings.length ? verdict.warnings.map((w) => w.message).join(' ') : ''
            }`
          : `${FEEDBACK_PROMISE} Keep the reference: it is what the desk will ask for. ${verdict.warnings.length ? verdict.warnings.map((w) => w.message).join(' ') : ''}`
        : wrote.because,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t(STR.sendFeedback)}</h1>
        <p className="text-sm text-text-secondary">
          {locale === 'bn'
            ? 'কিছু ভালো লেগেছে, বা খারাপ লেগেছে — দুটোই জানাতে পারেন। উত্তর এখানেই আসে।'
            : 'Something that went well, or something that did not: both are worth telling us. The answer comes back here.'}
        </p>
      </header>

      <Button variant="primary" onClick={() => setOpen(true)}>
        <MessageSquare className="size-4" aria-hidden /> {locale === 'bn' ? 'নতুন মতামত লিখুন' : 'Write about something'}
      </Button>

      <Panel title={t(STR.sendFeedback)}>
        <p className="text-sm text-text-secondary">{locale === 'bn' ? 'প্রতিশ্রুতি: তিন কর্মদিবসে উত্তর, লেখা আকারে, কে লিখেছে তার নাম সহ।' : FEEDBACK_PROMISE}</p>
      </Panel>

      <ul className="space-y-3">
        {feedback.map((f) => (
          <li key={f.id} className="rounded-lg border border-border-subtle bg-surface-default p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-medium text-text-primary">{f.subject}</p>
                <p className="text-xs text-text-secondary">
                  {locale === 'bn' ? `${niceDate(f.sentAt, 'bn')} · ${f.about}` : `${niceDate(f.sentAt, 'en')} · ${f.about}`}
                </p>
              </div>
              <span
                className={cx(
                  'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
                  f.state === 'closed' ? 'border-safety-success text-safety-success' : f.state === 'acknowledged' ? 'border-brand-300 text-brand-700' : 'border-border-subtle text-text-secondary',
                )}
              >
                {t(f.state === 'closed' ? STR.answered : f.state === 'acknowledged' ? { bn: 'উত্তর দেওয়া হচ্ছে', en: 'Being answered' } : STR.waitingAnswer)}
              </span>
            </div>
            <p className="mt-2 text-sm text-text-primary">{f.whatINoticed}</p>
            <p className="font-numeric mt-1 text-xs text-text-tertiary">
              {t(STR.reference)} {f.reference}
            </p>
            {f.answer && (
              <div className="mt-2 rounded-md bg-surface-sunken p-2">
                <p className="text-xs font-medium text-text-primary">
                  {t(STR.ourAnswer)} — {f.answeredBy}, {f.answeredOn ? niceDate(f.answeredOn, locale) : ''}
                </p>
                <p className="mt-1 text-sm text-text-secondary">{f.answer}</p>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Panel title={locale === 'bn' ? 'এই ফর্মটি কী জন্য নয়' : 'What this form is not for'}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <Phone className="mt-0.5 size-4 shrink-0 text-safety-critical" aria-hidden />
            <span>
              {locale === 'bn'
                ? 'জরুরি কিছু হলে এই ফর্ম নয় — জরুরি বিভাগে আসুন, অথবা ০২ ৯৮৭৬ ৫০০ নম্বরে ফোন করুন (চব্বিশ ঘণ্টা)।'
                : 'Something urgent is not feedback: come to the emergency department, or telephone 02 9876 500, which is answered 24 hours.'}
            </span>
          </li>
          <li>
            {locale === 'bn'
              ? 'রিপোর্ট বা চিকিৎসা নিয়ে প্রশ্নের উত্তর পোর্টাল দেয় না — ডাক্তার বা ডেস্ক দেয়। কারণ ভুল উত্তর দেওয়ার চেয়ে না দেওয়া ভালো।'
              : 'The portal does not answer questions about results or treatment. Your doctor does, and so does the desk. A wrong answer is worse than no answer, and a form is where a wrong answer would be given.'}
          </li>
          <li>
            {locale === 'bn'
              ? 'টাকা বা বিল নিয়ে হলে “দ্য বিল” বেছে নিন — হিসাবের প্রশ্ন সরাসরি বিলিং ডেস্কে যায়, দ্রুত উত্তর আসে।'
              : 'For a bill, choose “The bill”: an arithmetic question goes straight to the billing desk, which is where it can be answered.'}
          </li>
        </ul>
      </Panel>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={locale === 'bn' ? 'আমাদের জানান' : 'Tell us'}
        description={locale === 'bn' ? 'যা হয়েছে, নিজের ভাষায়।' : 'What happened, in your own words.'}
        width="md"
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">{verdict.ok ? (locale === 'bn' ? 'পাঠানোর জন্য তৈরি।' : 'Ready to send.') : locale === 'bn' ? 'কিছু ঠিক করতে হবে।' : 'Something needs fixing first.'}</span>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {locale === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </Button>
            <Button variant="primary" onClick={submit} disabled={!verdict.ok}>
              {t(STR.send)}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!verdict.ok && (
            <SafetyBanner severity={verdict.reasons[0].code === 'emergency' ? 'critical' : 'warning'} title={locale === 'bn' ? 'এই লেখাটি ফর্মে পাঠানো যাবে না' : 'This cannot be sent as a form'}>
              <p>{verdict.reasons[0].message}</p>
              <p lang={locale === 'bn' ? 'bn' : 'en'} className="mt-1 text-xs">
                {verdict.reasons[0].messageBn}
              </p>
              {verdict.reasons[0].code === 'emergency' && (
                <a href="tel:+88029876500" className="mt-2 inline-block">
                  <Button variant="primary">
                    <Phone className="size-4" aria-hidden /> 02 9876 500
                  </Button>
                </a>
              )}
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

          <FieldSection title={locale === 'bn' ? 'কিসের ব্যাপারে' : 'What it is about'}>
            <SelectField
              label={t(STR.whatAbout)}
              name="fb-subject"
              value={draft.subject}
              onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              options={FEEDBACK_SUBJECTS.map((s) => ({ value: s, label: s }))}
              required
            />
            <TextAreaField
              label={locale === 'bn' ? 'কোথায়, কবে' : 'Where, and when'}
              name="fb-about"
              value={draft.about}
              onChange={(e) => setDraft((d) => ({ ...d, about: e.target.value }))}
              rows={2}
              hint={locale === 'bn' ? 'যেমন: বহির্বিভাগ, ১২ অক্টোবর সকাল।' : 'For example: the outdoor clinic, 12 October in the morning.'}
            />
            <div className="md:col-span-2">
              <TextAreaField
                label={t(STR.tellUs)}
                name="fb-body"
                value={draft.whatINoticed}
                onChange={(e) => setDraft((d) => ({ ...d, whatINoticed: e.target.value }))}
                rows={5}
                hint={locale === 'bn' ? 'যা দেখেছেন বা যা হয়েছে, সোজা কথায়। কেউ বিচার করবে না।' : 'What you saw or what happened, plainly. Nobody is going to argue with you about it.'}
                required
              />
            </div>
            <CheckboxField
              label={t(STR.mayTelephone)}
              name="fb-call"
              checked={draft.mayTelephone}
              onChange={(e) => setDraft((d) => ({ ...d, mayTelephone: e.target.checked }))}
              hint={locale === 'bn' ? 'টিক না দিলে উত্তর শুধু লিখিতভাবে আসবে, এবং সেটি আপনার অধিকার।' : 'If you leave this unticked, the answer comes in writing only — which is your right, and it is not held against you.'}
            />
          </FieldSection>

          <div className="rounded-md border border-border-subtle p-3 text-xs text-text-secondary">
            <p className="font-medium text-text-primary">{locale === 'bn' ? 'পাঠানোর পরে কী হয়' : 'What happens after you send it'}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>{locale === 'bn' ? 'একটি রেফারেন্স নম্বর তৈরি হয় — সেটি ধরে রাখুন।' : 'A reference number is created. Keep it: it is what the desk asks for.'}</li>
              <li>{locale === 'bn' ? 'ফ্রন্ট অফিস তিন কর্মদিবসে উত্তর লেখে, এবং উত্তরটি এখানেই দেখা যায়।' : 'The front office writes an answer within three working days, and the answer appears here.'}</li>
              <li>{locale === 'bn' ? 'কোনো কর্মীর নাম লিখলে অভিযোগটি সংশ্লিষ্ট বিভাগের প্রধান পড়েন, এবং নামটি যাঁর তিনি উত্তর দেওয়ার সুযোগ পান।' : 'If you name a member of staff, the head of that department reads it and the person named is given the chance to answer.'}</li>
              <li>{locale === 'bn' ? 'লেখাটি মুছে ফেলা যায় না — তবে চাইলে আপনার নাম না লেখার অনুরোধ করা যায়।' : 'What you wrote is not deleted afterwards, but you can ask for it not to carry your name.'}</li>
            </ul>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
