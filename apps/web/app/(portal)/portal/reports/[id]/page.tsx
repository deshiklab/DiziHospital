'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Panel, SafetyBanner, cx } from '@dizi/ui';
import { ArrowLeft, Download, Phone, Printer } from 'lucide-react';
import { usePortal, usePortalLocale } from '@/components/PortalShell';
import {
  STR,
  bnDigits,
  niceDate,
  outsideRange,
  reportLinesFor,
  resultById,
  tr,
  valueFlag,
  type LabValue,
  type ReportLine,
} from '@/lib/portal';
import { todayIso } from '@/lib/appointments';

/* One report, in full (P8, portal sub-screen).
 *
 * The list answers “is it ready?”. This screen answers the question the patient actually rang the hospital to ask:
 * *what did it say?* Four decisions follow, and they are the reason this is a page rather than an expanded row:
 *
 *  1. **The numbers are shown, with their ranges.** A report hidden behind a headline is a hospital asking to be
 *     trusted rather than believed. Every value carries its unit and its usual range, and where the range is not the
 *     ordinary one — the haemoglobin range in pregnancy, for instance — the reason is written beside it.
 *  2. **A value outside its range carries a sentence.** `outsideRange` finds them; the register refuses a flagged
 *     value with no sentence behind it, because a number a hospital cannot explain is a number it should not post.
 *  3. **A withheld report shows nothing but why.** Not the values, not the summary — the reason and the number to
 *     ring, which is the difference between being told to wait and being left in the dark.
 *  4. **Opening it is recorded, and the patient can see the record.** The download goes through the contract, and
 *     the day it happened is shown here and on the list it came from.
 */

const STATE_LABEL: Record<string, { bn: string; en: string }> = {
  released: { bn: 'দেখা যাবে', en: 'Ready to see' },
  pending: { bn: 'এখনো আসেনি', en: 'Still in the laboratory' },
  withheld: { bn: 'ডাক্তার নিজে বলবেন', en: 'Your doctor will explain it' },
};

/** A value's flag as colour and word — the patient sees *low* or *high*, never a bare red number. */
const FLAG_TONE: Record<'normal' | 'low' | 'high', string> = {
  normal: 'text-text-primary',
  low: 'text-safety-warning-text',
  high: 'text-safety-warning-text',
};
const FLAG_WORD: Record<'normal' | 'low' | 'high', { bn: string; en: string }> = {
  normal: { bn: 'ঠিক আছে', en: 'In range' },
  low: { bn: 'কম', en: 'Low' },
  high: { bn: 'বেশি', en: 'High' },
};

export default function PortalReportDetailPage() {
  const params = useParams<{ id: string }>();
  const locale = usePortalLocale();
  const { send, downloaded, markDownloaded } = usePortal();
  const t = (text: { bn: string; en: string }) => tr(text, locale);
  const day = todayIso();

  const report = resultById(params.id);
  const lines = report && report.state === 'released' ? reportLinesFor(report.id) : [];
  const flagged = outsideRange(lines);

  if (!report) {
    return (
      <div className="space-y-4">
        <BackLink label={t(STR.back)} />
        <Panel title={t(STR.notFoundReport)}>
          <p className="text-sm text-text-secondary">{t(STR.notFoundReportWhy)}</p>
          <Link href="/portal/reports" className="mt-3 inline-block">
            <Button variant="secondary">{t(STR.myReports)}</Button>
          </Link>
        </Panel>
      </div>
    );
  }

  /* Opening the report is a write like any other: it goes through the contract's own operation, and the day it
   * happened is kept on the shell, where the list and this page both read it. */
  const download = () => {
    send(`Download ${report.panel}`, `${report.panelBn} নামানো`, {
      id: 'recordResultDownload',
      recordId: report.id,
      fields: { result: report.id, report: report.reportRef ?? '', at: day },
    });
    markDownloaded(report.id);
  };

  return (
    <div className="space-y-4">
      <BackLink label={t(STR.back)} />

      <header className="rounded-lg border border-border-subtle bg-surface-default p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text-primary">{locale === 'bn' ? report.panelBn : report.panel}</h1>
            <p className="mt-0.5 text-sm text-text-secondary">
              {locale === 'bn' ? `নমুনা নেওয়া হয়েছে ${niceDate(report.takenOn, 'bn')}` : `Sample taken ${niceDate(report.takenOn, 'en')}`}
              {report.releasedOn && (
                <>
                  <span className="mx-1.5">·</span>
                  {locale === 'bn'
                    ? `চিকিৎসক ছেড়ে দিয়েছেন ${niceDate(report.releasedOn.slice(0, 10), 'bn')}`
                    : `Released by the doctor on ${niceDate(report.releasedOn.slice(0, 10), 'en')}`}
                </>
              )}
            </p>
          </div>
          <span
            className={cx(
              'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium',
              report.state === 'released'
                ? 'border-safety-success text-safety-success'
                : report.state === 'pending'
                  ? 'border-border-subtle text-text-secondary'
                  : 'border-safety-warning text-safety-warning',
            )}
          >
            {t(STATE_LABEL[report.state])}
          </span>
        </div>
      </header>

      {/* ---------------------------------------------------------------- released: the whole report */}
      {report.state === 'released' && (
        <>
          <Panel title={locale === 'bn' ? 'সারসংক্ষেপ' : 'In short'}>
            <p className="text-base font-medium text-text-primary">{report.headline}</p>
            <p className="mt-1 text-sm text-text-secondary">{report.summary}</p>
          </Panel>

          {lines.length > 0 && (
            <Panel
              title={t(STR.valuesInThisReport)}
              actions={
                <span className="text-xs text-text-secondary">
                  {flagged.length === 0
                    ? t(STR.everythingInRange)
                    : flagged.length === 1
                      ? t(STR.outsideRangeOne)
                      : t(STR.outsideRangeMany)}
                </span>
              }
            >
              <ul className="divide-y divide-border-subtle">
                {lines.map((line) => (
                  <li key={line.key} className="py-2 first:pt-0 last:pb-0">
                    {line.kind === 'number' ? <NumberLine line={line} locale={locale} /> : <TextLine line={line} locale={locale} />}
                  </li>
                ))}
              </ul>

              {flagged.length > 0 && (
                <p className="mt-3 rounded-md border border-border-subtle p-2 text-xs text-text-secondary">{t(STR.outsideRangeWhy)}</p>
              )}
            </Panel>
          )}

          <Panel title={t(STR.askAboutThisReport)}>
            <p className="text-sm text-text-secondary">{report.ask}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href="tel:+88029876540">
                <Button variant="secondary">
                  <Phone className="size-4" aria-hidden /> {t(STR.callDesk)}
                </Button>
              </a>
              <Button variant="ghost" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden /> {t(STR.printOrSave)}
              </Button>
            </div>
          </Panel>

          <Panel title={locale === 'bn' ? 'আপনার কপি' : 'Your copy'}>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={download}>
                <Download className="size-4" aria-hidden /> {t(STR.downloadReport)}
              </Button>
              <span className="text-xs text-text-secondary">
                {t(STR.reportStaysUntil)} {niceDate(report.downloadExpiresOn ?? day, locale)}
              </span>
            </div>
            {downloaded[report.id] && (
              <p className="mt-2 text-xs text-text-secondary">
                {t(STR.downloadedOn)} {niceDate(downloaded[report.id], locale)}
                <span className="mx-1.5">·</span>
                {locale === 'bn'
                  ? 'হাসপাতালে একটি নোট থেকে যায় যে আপনি রিপোর্টটি দেখেছেন।'
                  : 'The hospital keeps a note that you opened it, so “did they get it?” has an answer.'}
              </p>
            )}
          </Panel>
        </>
      )}

      {/* ---------------------------------------------------------------- still in the laboratory */}
      {report.state === 'pending' && (
        <Panel title={locale === 'bn' ? 'ডাক্তার যা লিখেছেন' : 'What the doctor wrote'}>
          <p className="text-sm text-text-secondary">
            {locale === 'bn'
              ? 'রিপোর্টটি ল্যাবে আছে। ফলাফল সাধারণত দুই কর্মদিবসে আসে। কোনো সমস্যা নেই — এখানে নিজে থেকেই দেখা যাবে, জানানোর দরকার নেই।'
              : 'The report is still in the laboratory. Results usually come back in two working days. Nothing is wrong, and you will not have to ask: it appears here by itself.'}
          </p>
          <p className="mt-2 text-xs text-text-secondary">{t(STR.numberOnlyAfterRelease)}</p>
        </Panel>
      )}

      {/* ---------------------------------------------------------------- withheld: nothing but why */}
      {report.state === 'withheld' && (
        <>
          <SafetyBanner severity="info" title={locale === 'bn' ? 'এটি দুশ্চিন্তার কিছু নয়' : 'This is not a bad sign'}>
            <p>
              {locale === 'bn'
                ? 'রিপোর্টটি তৈরি এবং আপনার নথিতে আছে — শুধু ফোনে দেখানো হচ্ছে না। চিকিৎসক নিজে বুঝিয়ে বলতে চান, কারণ লেখা পড়ে ভুল বোঝার সম্ভাবনা থাকে।'
                : 'The report is ready and on your record; it is simply not shown on a phone. Your doctor wants to explain it, because a number without a sentence beside it is where people frighten themselves.'}
            </p>
          </SafetyBanner>
          <Panel title={locale === 'bn' ? 'কারণ' : 'Why'}>
            <p className="text-sm text-text-secondary">{report.withheldReason}</p>
            <p className="mt-2 text-sm text-text-secondary">{report.ask}</p>
            <a href="tel:+88029876540" className="mt-3 inline-block">
              <Button variant="secondary">
                <Phone className="size-4" aria-hidden /> {t(STR.callDesk)}
              </Button>
            </a>
          </Panel>
          <p className="text-xs text-text-secondary">{t(STR.numberOnlyAfterRelease)}</p>
        </>
      )}
    </div>
  );
}

/**
 * One number: label, the value with its unit, the range it is measured against, and — only when it falls outside —
 * the sentence that says what that meant. A flagged value with no sentence behind it is shown as in range by
 * `outsideRange`'s own arithmetic but is never left unlabelled: the register is checked by `npm run test:p8`.
 */
function NumberLine({ line, locale }: { line: LabValue; locale: 'bn' | 'en' }) {
  const flag = valueFlag(line);
  const number = locale === 'bn' ? bnDigits(String(line.value)) : String(line.value);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="min-w-0 flex-1 text-sm text-text-secondary">{locale === 'bn' ? line.labelBn : line.label}</span>
        <span className={cx('font-numeric text-base font-semibold', FLAG_TONE[flag])}>
          {number} <span className="text-xs font-normal">{locale === 'bn' ? line.unit : line.unit}</span>
        </span>
        <span
          className={cx(
            'shrink-0 rounded-full border px-2 py-0.5 text-xs',
            flag === 'normal' ? 'border-border-subtle text-text-tertiary' : 'border-safety-warning text-safety-warning',
          )}
        >
          {flag === 'normal' ? tr(FLAG_WORD.normal, locale) : tr(FLAG_WORD[flag], locale)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-text-tertiary">
        {locale === 'bn'
          ? `সাধারণ সীমা ${bnDigits(String(line.low))}–${bnDigits(String(line.high))} ${line.unit}`
          : `Usual range ${line.low}–${line.high} ${line.unit}`}
        {line.rangeBecause && <span className="mx-1.5">·</span>}
        {line.rangeBecause && (locale === 'bn' ? line.rangeBecauseBn : line.rangeBecause)}
      </p>
      {flag !== 'normal' && (line.meaning || line.meaningBn) && (
        <p className="mt-1 text-sm text-text-primary">{locale === 'bn' ? line.meaningBn : line.meaning}</p>
      )}
    </div>
  );
}

/** A finding that is a word: a blood group, a screen that is negative. Always carries its sentence. */
function TextLine({ line, locale }: { line: Extract<ReportLine, { kind: 'text' }>; locale: 'bn' | 'en' }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="min-w-0 flex-1 text-sm text-text-secondary">{locale === 'bn' ? line.labelBn : line.label}</span>
        <span className="text-base font-semibold text-text-primary">{locale === 'bn' ? (line.valueBn ?? line.value) : line.value}</span>
      </div>
      <p className="mt-1 text-sm text-text-primary">{locale === 'bn' ? line.meaningBn : line.meaning}</p>
    </div>
  );
}

/** Back to the list this report came from — a place, named, rather than a browser history move. */
function BackLink({ label }: { label: string }) {
  return (
    <Link href="/portal/reports" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700">
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
