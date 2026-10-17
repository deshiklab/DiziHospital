'use client';

import { useMemo, useState } from 'react';
import { Button, Panel, SafetyBanner, Segmented, cx, useToast } from '@dizi/ui';
import Link from 'next/link';
import { Download, Phone } from 'lucide-react';
import { usePortal, usePortalLocale } from '@/components/PortalShell';
import { RESULTS, STR, bnDigits, niceDate, tr, type PortalResult } from '@/lib/portal';
import { todayIso } from '@/lib/appointments';

/* The patient's results.
 *
 * The rule that decides this screen is the one about silence: a result is `pending`, `released` or `withheld`, and
 * the portal shows all three states. A patient who is waiting for a report and finds nothing has no way of telling
 * "not ready" from "the doctor does not want me to see this", and that difference is the whole of the anxiety. So
 * the withheld one says it is ready, says why it is not shown, and gives the number to ask on — which is a hospital
 * choosing to be understood rather than tidy.
 *
 * Downloading is recorded, and the record says so: a share lapses (the contract refuses a lapsed one with
 * `dizi.document-expired`) and the patient is told until when the report stays available.
 */

const STATE_LABEL: Record<PortalResult['state'], { bn: string; en: string }> = {
  released: { bn: 'দেখা যাবে', en: 'Ready to see' },
  pending: { bn: 'এখনো আসেনি', en: 'Still in the laboratory' },
  withheld: { bn: 'ডাক্তার নিজে বলবেন', en: 'Your doctor will explain it' },
};

export default function PortalReportsPage() {
  const locale = usePortalLocale();
  const { send, downloaded, markDownloaded } = usePortal();
  const { push } = useToast();
  const t = (text: { bn: string; en: string }) => tr(text, locale);
  const day = todayIso();

  const [results, setResults] = useState<PortalResult[]>(RESULTS);
  const [view, setView] = useState<'released' | 'pending' | 'withheld' | 'all'>('released');

  const rows = useMemo(() => results.filter((r) => (view === 'all' ? true : r.state === view)).sort((a, b) => b.takenOn.localeCompare(a.takenOn)), [results, view]);

  const download = (result: PortalResult) => {
    const wrote = send(`Download ${result.panel}`, `${result.panelBn} নামানো`, {
      id: 'recordResultDownload',
      recordId: result.id,
      fields: { result: result.id, report: result.reportRef ?? '', at: day },
    });
    markDownloaded(result.id);
    push({
      title: wrote.queued ? (locale === 'bn' ? 'রিপোর্টটি আপনার কাছে' : 'The report is on your phone') : locale === 'bn' ? 'নামানো যায়নি' : 'It could not be downloaded',
      description: wrote.queued
        ? locale === 'bn'
          ? `হাসপাতালে একটি নোট থেকে যায় যে আপনি রিপোর্টটি দেখেছেন — জিজ্ঞেস করার দরকার হলে উত্তরটি তৈরি থাকে। রিপোর্টটি ${niceDate(result.downloadExpiresOn ?? day, 'bn')} পর্যন্ত এখানে থাকবে।`
          : `The hospital keeps a note that you opened it, so “did they get it?” has an answer without anybody being asked twice. It stays available here until ${niceDate(result.downloadExpiresOn ?? day, 'en')}.`
        : wrote.because,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t(STR.myReports)}</h1>
        <p className="text-sm text-text-secondary">
          {locale === 'bn'
            ? 'ডাক্তার যে রিপোর্টগুলো ছেড়ে দিয়েছেন সেগুলো এখানে দেখা যায়। ছাড়ার আগে কোনো রিপোর্ট এখানে আসে না — সেটি রোগীর নথি, রোগীর ফোন নয়।'
            : 'You can see the reports your doctor has released. Nothing appears here before that: a report is the patient’s record, but only once the doctor has decided the patient should read it.'}
        </p>
      </header>

      <Segmented
        label={locale === 'bn' ? 'কোন রিপোর্ট' : 'Which reports'}
        name="report-view"
        value={view}
        onChange={(v) => setView(v as typeof view)}
        options={[
          { value: 'all', label: `${t(STR.everything)} (${results.length})` },
          { value: 'released', label: `${t(STR.ready)} (${results.filter((r) => r.state === 'released').length})` },
          { value: 'pending', label: `${t(STR.waitingResult)} (${results.filter((r) => r.state === 'pending').length})` },
          { value: 'withheld', label: `${t(STR.withheld)} (${results.filter((r) => r.state === 'withheld').length})` },
        ]}
      />

      {view === 'withheld' && rows.length > 0 && (
        <SafetyBanner severity="info" title={locale === 'bn' ? 'এটি দুশ্চিন্তার কিছু নয়' : 'This is not a bad sign'}>
          <p>
            {locale === 'bn'
              ? 'কিছু রিপোর্ট ডাক্তার নিজে বুঝিয়ে বলতে চান — লেখা পড়ে ভুল বোঝার সম্ভাবনা থাকে বলে। রিপোর্টটি তৈরি এবং আপনার নথিতে আছে; শুধু ফোনে দেখানো হচ্ছে না। ফোন করলে কেউ সময় নিয়ে বুঝিয়ে বলবে।'
              : 'Some reports are explained by a doctor rather than read on a phone, because a number without a sentence beside it is where people frighten themselves. The report is ready and on your record; it is simply not shown here. Telephone and somebody will talk you through it.'}
          </p>
        </SafetyBanner>
      )}

      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-border-subtle bg-surface-default p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-text-primary">{locale === 'bn' ? r.panelBn : r.panel}</p>
                <p className="text-xs text-text-secondary">
                  {locale === 'bn' ? `নমুনা নেওয়া হয়েছে ${niceDate(r.takenOn, 'bn')}` : `Sample taken ${niceDate(r.takenOn, 'en')}`}
                </p>
              </div>
              <span
                className={cx(
                  'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
                  r.state === 'released' ? 'border-safety-success text-safety-success' : r.state === 'pending' ? 'border-border-subtle text-text-secondary' : 'border-safety-warning text-safety-warning',
                )}
              >
                {t(STATE_LABEL[r.state])}
              </span>
            </div>

            {r.state === 'released' && (
              <>
                <p className="mt-2 text-sm font-medium text-text-primary">{r.headline}</p>
                <p className="mt-1 text-sm text-text-secondary">{r.summary}</p>
                <p className="mt-1 text-xs text-text-tertiary">
                  {locale === 'bn' ? `চিকিৎসক ছেড়ে দিয়েছেন ${niceDate((r.releasedOn ?? r.takenOn).slice(0, 10), 'bn')}` : `Released by the doctor on ${niceDate((r.releasedOn ?? r.takenOn).slice(0, 10), 'en')}`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Link href={`/portal/reports/${r.id}`}>
                    <Button variant="secondary">{locale === 'bn' ? 'পুরো রিপোর্ট দেখুন' : 'Read the whole report'}</Button>
                  </Link>
                  <Button variant="ghost" onClick={() => download(r)}>
                    <Download className="size-4" aria-hidden /> {t(STR.downloadReport)}
                  </Button>
                  <span className="text-xs text-text-tertiary">
                    {locale === 'bn' ? `এখানে থাকবে ${niceDate(r.downloadExpiresOn ?? day, 'bn')} পর্যন্ত` : `Available here until ${niceDate(r.downloadExpiresOn ?? day, 'en')}`}
                  </span>
                </div>
                {downloaded[r.id] && (
                  <p className="mt-1 text-xs text-text-secondary">
                    {t(STR.downloadedOn)} {niceDate(downloaded[r.id], locale)}
                  </p>
                )}
              </>
            )}

            {r.state === 'pending' && (
              <p className="mt-2 text-sm text-text-secondary">
                {locale === 'bn'
                  ? 'ফলাফল সাধারণত দুই কর্মদিবসে আসে। কোনো সমস্যা নেই — রিপোর্টটি ল্যাবে আছে। এখানে নিজে থেকেই দেখা যাবে, জানাতে হবে না।'
                  : 'Results usually come back in two working days. Nothing is wrong — it is simply still in the laboratory. It appears here by itself; nobody has to tell you.'}
              </p>
            )}

            {r.state === 'withheld' && (
              <>
                <div className="mt-2">
                  <Link href={`/portal/reports/${r.id}`}>
                    <Button variant="ghost">{locale === 'bn' ? 'বিস্তারিত' : 'More about this'}</Button>
                  </Link>
                </div>
                <p className="mt-2 text-sm text-text-secondary">{r.withheldReason}</p>
                <p className="mt-1 text-sm text-text-secondary">{r.ask}</p>
                <a href="tel:+88029876540" className="mt-2 inline-block">
                  <Button variant="secondary">
                    <Phone className="size-4" aria-hidden /> {t(STR.callDesk)}
                  </Button>
                </a>
              </>
            )}
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <Panel>
          <p className="text-sm text-text-secondary">
            {locale === 'bn' ? 'এই অংশে এখন কিছু নেই।' : 'There is nothing in this part of the list yet.'}
          </p>
        </Panel>
      )}

      <Panel title={locale === 'bn' ? 'রিপোর্ট নিয়ে যা জানা দরকার' : 'About your reports'}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>
            {locale === 'bn'
              ? 'রিপোর্টটি কে ছেড়ে দিয়েছেন, তার তারিখ প্রতিটির নিচে লেখা থাকে। যে রিপোর্ট দেখানো হচ্ছে না, সেটিতে সাধারণত কারণ লেখা থাকে।'
              : 'Each report says when a doctor released it. Where one is not shown, the reason is written beside it.'}
          </li>
          <li>
            {locale === 'bn'
              ? `রিপোর্ট এখানে সীমিত সময়ের জন্য থাকে — সাধারণত ছয় মাস। এর পরে পুরনো কপি দরকার হলে ডেস্ক থেকে নিতে হয়, কারণ পুরনো রিপোর্ট দেখে নতুন সিদ্ধান্ত নেওয়া যায় না।`
              : 'Reports stay here for a limited time — usually six months. After that the desk can print an older copy, because an old report shown without its date is how somebody treats a number that has since changed.'}
          </li>
          <li>
            {locale === 'bn' ? `এই তালিকায় এখন ${bnDigits(results.length)}টি রিপোর্ট আছে।` : `There are ${results.length} reports in this list.`}
          </li>
        </ul>
      </Panel>
    </div>
  );
}
