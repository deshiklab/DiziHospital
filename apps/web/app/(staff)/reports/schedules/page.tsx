'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, CheckboxField, Panel, SafetyBanner, Segmented, SelectField, TextField, Tooltip, cx, useToast } from '@dizi/ui';
import { ArrowLeft, CalendarClock, Download, FileCheck2, Info, Pause, Play, Plus, Printer, Send, Trash2, TriangleAlert } from 'lucide-react';
import { todayIso } from '@/lib/appointments';
import { CONSOLIDATED, RANGES, REPORTS, SCOPES, buildReport, reportByTopic, type RangeId, type Scope } from '@/lib/report-suite';
import { useShell } from '@/lib/shell';
import {
  CHANNELS,
  COUNTERS_CLOSE,
  SCHEDULES,
  SCHEDULE_RULES,
  SCHEDULING_SERVER_DUTIES,
  channelById,
  checkSchedule,
  describeRecipients,
  describeRun,
  describeSchedule,
  downloadsOf,
  exportReport,
  loadNodeDownloads,
  saveNodeDownload,
  saveNodeSchedule,
  schedulesForNode,
  wouldSend,
  type ChannelId,
  type DownloadRecord,
  type Recipient,
  type ReportSchedule,
  type SendWhen,
} from '@/lib/report-schedules';

/* Scheduled report exports — the register's “sent to X every morning at 07:30”, made operable.
 *
 * The module's rules live at the top of `lib/report-schedules.ts`. What the screen is for:
 *
 *  1. **A schedule can be read back before it is trusted.** The next four runs are printed as days of the week, so
 *     “every Monday at 07:00” is verifiable rather than plausible, and a run that lands on a gazetted holiday is
 *     visible as the first working day moved.
 *  2. **The file can be built here.** Download runs the report's own generator at this schedule's scope and period
 *     and writes the same CSV the server will send: the definitions and the control total at the top, the figures as
 *     numbers. A schedule is proved by opening the file, not by waiting a month for it.
 *  3. **Only the sending is missing.** `runReportSchedule` is in the contract and the screen names it, with the
 *     relay, the timer and the retention policy the API has to own. Until then nothing goes out on its own and the
 *     history says who took which sheet.
 *  4. **A refusal is a sentence, not a red box.** Nobody to send to, a message channel for a spreadsheet, a period
 *     wider than the data, a monthly run that skips February: each says what would have happened.
 */

export default function ReportSchedulesPage() {
  const day = todayIso();
  const { push } = useToast();
  const { queueWrite } = useShell();

  const [schedules, setSchedules] = useState<ReportSchedule[]>(SCHEDULES);
  const [selected, setSelected] = useState(SCHEDULES[0].id);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [stamp, setStamp] = useState<string | null>(null);

  /* This node's own copy, and the delivery history: both from storage, which does not exist while the page is
     being rendered on the server. The clock is read here for the same reason — a stamp drawn during render is one
     value in the server's HTML and another in the browser. */
  useEffect(() => {
    setSchedules(schedulesForNode());
    setDownloads(loadNodeDownloads());
    setStamp(new Date().toLocaleString());
  }, []);

  const schedule = schedules.find((s) => s.id === selected) ?? schedules[0];
  const def = reportByTopic(schedule.topic);
  const check = useMemo(() => checkSchedule(schedule, day, { others: schedules }), [schedule, schedules, day]);
  const today = useMemo(() => (def ? buildReport(schedule.topic, { day, range: schedule.range, scope: schedule.scope }) : null), [def, schedule.topic, schedule.range, schedule.scope, day]);
  const verdict = today ? wouldSend(schedule, today) : { send: false, because: 'No report to build.' };
  const history = downloadsOf(schedule.id, downloads);
  const refused = schedules.filter((s) => !checkSchedule(s, day, { others: schedules }).ok);

  const commit = (patch: Partial<ReportSchedule>) => {
    setSchedules((list) => list.map((s) => (s.id === schedule.id ? { ...s, ...patch } : s)));
  };

  const save = () => {
    if (!check.ok) {
      push({ title: 'This schedule cannot be saved as it stands', description: check.reasons[0].message, tone: 'critical' });
      return;
    }
    const next: ReportSchedule = { ...schedule, savedAt: `${day} ${stamp ?? ''}`.trim(), savedBy: 'S. Nahar, system administrator' };
    setSchedules((list) => list.map((s) => (s.id === next.id ? next : s)));
    saveNodeSchedule(next);
    const wrote = queueWrite(`Save the ${def?.title ?? schedule.topic} schedule`, {
      id: 'saveReportSchedule',
      recordId: next.id,
      fields: { schedule: next.id, topic: next.topic, cadence: describeSchedule(next), nextRun: check.next[0] ?? '', recipients: next.recipients.length, by: 'S. Nahar, system administrator' },
    });
    push({
      title: `Saved on this node, queued for the cloud`,
      description: wrote.queued
        ? `${define(next)}. The list is on this branch’s node now and queued as ${wrote.operation.op} against ${wrote.operation.entity}, sequenced ${wrote.operation.id}.`
        : `It could not be queued: ${wrote.because}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  const define = (s: ReportSchedule) => `${reportByTopic(s.topic)?.title ?? s.topic} — ${describeSchedule(s)}, to ${describeRecipients(s)}`;

  const buildAndDownload = () => {
    const built = exportReport(schedule, day);
    let saved = false;
    try {
      const url = URL.createObjectURL(new Blob([built.text], { type: built.mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = built.name;
      a.click();
      URL.revokeObjectURL(url);
      saved = true;
    } catch {
      /* A browser or a preview that will not hand over a file dialog is not a reason to lose the record: the file
         was built and its contents are known, which is what the history is for. */
      saved = false;
    }
    const record: DownloadRecord = {
      scheduleId: schedule.id,
      day,
      at: stamp ?? `${day} (built)`,
      who: 'S. Nahar, system administrator',
      rows: built.rows,
      bytes: built.bytes,
      name: built.name,
      wentTo: saved ? 'Downloaded on the desk that asked for it' : 'Built here; the browser refused the save',
      skipped: verdict.send ? undefined : verdict.because,
    };
    saveNodeDownload(record);
    setDownloads((list) => [...list.filter((r) => !(r.scheduleId === record.scheduleId && r.at === record.at)), record]);
    push({
      title: saved ? `${built.name} is in your downloads` : 'The file was built and the browser refused the save',
      description: `${built.rows} row(s), ${built.bytes.toLocaleString('en-US')} bytes, ${built.preamble.length} lines of preamble above the table — the definitions and the control total, so the file still says what it is when somebody forwards it. Nothing has left the building: this is the same file the server will send.`,
      tone: saved ? 'success' : 'warning',
    });
  };

  const addRecipient = () => {
    commit({ recipients: [...schedule.recipients, { name: '', role: '', channel: 'hospital-mail', address: '' }] });
  };

  const patchRecipient = (index: number, patch: Partial<Recipient>) => {
    commit({ recipients: schedule.recipients.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  };

  const status = (s: ReportSchedule): { tone: 'success' | 'warning' | 'critical' | 'neutral'; label: string } => {
    if (!s.enabled) return { tone: 'neutral', label: 'Paused' };
    const c = checkSchedule(s, day, { others: schedules });
    if (!c.ok) return { tone: 'critical', label: `${c.reasons.length} to fix` };
    if (c.warnings.length > 0) return { tone: 'warning', label: `${c.warnings.length} to look at` };
    return { tone: 'success', label: 'Runs' };
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-text-primary">
            <CalendarClock className="size-5 text-brand-600" aria-hidden />
            Scheduled exports
          </h1>
          <p className="text-sm text-text-secondary">
            {schedules.length} schedule(s) over {REPORTS.length} reports · {schedules.filter((s) => s.enabled).length} running ·{' '}
            {refused.length === 0 ? 'every one of them can go out as it stands' : `${refused.length} refused as written`}
            {stamp && <span className="font-numeric"> · this desk read the clock at {stamp}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/reports">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="size-4" aria-hidden /> All reports
            </Button>
          </Link>
          <Tooltip content="Build today’s file here and hand it to the person who sends it">
            <Button variant="secondary" size="sm" onClick={buildAndDownload}>
              <Download className="size-4" aria-hidden /> Download today’s sheet
            </Button>
          </Tooltip>
          <Button variant="primary" size="sm" onClick={save}>
            <Send className="size-4" aria-hidden /> Save this schedule
          </Button>
        </div>
      </header>

      <SafetyBanner severity="info" title="The file is built here; the sending is the server’s">
        <p>
          A run — render the file, send it, record a receipt per recipient — is <span className="font-numeric">POST /reports/schedules/{`{id}`}/runs</span>{' '}
          in the contract, and online-only: a node cannot send mail, and a queued send would tell a manager the morning’s sheet is on its way while it sat in an outbox on a disconnected
          machine. Until the API service exists, Download builds the same CSV on this desk, the history below records who took it, and nothing goes out on its own.
        </p>
      </SafetyBanner>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
        {/* ------------------------------------------------------------------ the register */}
        <div className="flex flex-col gap-3">
          <Panel title="The register — one schedule per report the register says is sent">
            <ul className="flex flex-col divide-y divide-border-subtle">
              {schedules.map((s) => {
                const state = status(s);
                const c = checkSchedule(s, day, { others: schedules });
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(s.id)}
                      aria-pressed={s.id === schedule.id}
                      aria-label={`${reportByTopic(s.topic)?.title ?? s.topic}, ${describeSchedule(s)}, next ${c.next[0] ? describeRun(c.next[0]) : 'never'}`}
                      className={cx('flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left', s.id === schedule.id ? 'bg-brand-50' : 'hover:bg-surface-sunken')}
                    >
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-text-primary">
                          {reportByTopic(s.topic)?.title ?? s.topic}
                          {s.savedAt && <span className="ml-2 text-[11px] font-normal text-text-tertiary">saved {s.savedAt}</span>}
                        </span>
                        <span
                          className={cx(
                            'rounded-full px-2 py-0.5 text-[11px]',
                            state.tone === 'success' && 'bg-safety-success/10 text-safety-success',
                            state.tone === 'warning' && 'bg-safety-warning/10 text-safety-warning',
                            state.tone === 'critical' && 'bg-safety-critical/10 text-safety-critical',
                            state.tone === 'neutral' && 'bg-surface-sunken text-text-secondary',
                          )}
                        >
                          {state.label}
                        </span>
                      </span>
                      <span className="text-xs text-text-secondary">{describeSchedule(s)}</span>
                      <span className="text-xs text-text-tertiary">
                        {describeRecipients(s)} · {s.scope} · {RANGES.find((r) => r.id === s.range)?.label} ·{' '}
                        {c.next[0] ? `next ${describeRun(c.next[0])}` : 'no next run'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="The next four runs of this one">
            {check.next.length === 0 ? (
              <p className="text-sm text-text-secondary">This schedule has no next run: {check.reasons[0]?.message ?? 'nothing is set.'}</p>
            ) : (
              <ol className="flex flex-col gap-1 text-sm">
                {check.next.map((run) => (
                  <li key={run} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{describeRun(run)}</span>
                    <span className="text-xs text-text-tertiary">
                      {isWeekendNote(run) ? isWeekendNote(run) : 'a working day'}
                      {run.slice(0, 10) === day ? ' · today' : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-xs text-text-tertiary">
              A monthly run that names the first working day is recomputed against the branch’s own calendar, so a gazetted holiday moves the reading rather than producing a
              file nobody is at the desk to read. The counters close at {COUNTERS_CLOSE}; a money report scheduled before that is flagged rather than silently moved.
            </p>
          </Panel>

          <Panel title="Deliveries this desk has taken">
            {history.length === 0 ? (
              <p className="text-sm text-text-secondary">
                Nothing has been built here yet. The history is what makes “we sent it” checkable on a node with no server: who took the file, when, how many rows it held, and whether
                the schedule wanted it sent at all that day.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {history.map((r) => (
                  <li key={r.at} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border-subtle pt-1.5 first:border-0 first:pt-0">
                    <span className="font-numeric text-text-primary">{r.name}</span>
                    <span className="text-xs text-text-secondary">
                      {r.at} · {r.who} · {r.rows} row(s) · {r.bytes.toLocaleString('en-US')} bytes
                    </span>
                    <span className="basis-full text-xs text-text-tertiary">
                      {r.wentTo}
                      {r.skipped ? ` — the schedule would have skipped this day: ${r.skipped}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-text-tertiary">
              A downloaded file is not a delivery. The receipt — the relay’s own id, or the counter and the name against the print-out — is only written by{' '}
              <span className="font-numeric">runReportSchedule</span>, which is why this list is headed “taken” rather than “sent”.
            </p>
          </Panel>
        </div>

        {/* ------------------------------------------------------------------ the editor */}
        <div className="flex flex-col gap-3">
          <Panel
            title={def?.title ?? schedule.topic}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  commit({ enabled: !schedule.enabled });
                }}
              >
                {schedule.enabled ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                {schedule.enabled ? 'Pause' : 'Resume'}
              </Button>
            }
          >
            <div className="flex flex-col gap-2">
              <SelectField
                label="Report"
                name="schedule-topic"
                value={schedule.topic}
                onChange={(e) => commit({ topic: e.target.value })}
                options={REPORTS.map((r) => ({ value: r.topic, label: `${r.title} — ${r.group}` }))}
                hint="One schedule per report: the register itself refuses a report that is read live rather than sent."
              />
              <SelectField
                label="Scope"
                name="schedule-scope"
                value={schedule.scope}
                onChange={(e) => commit({ scope: e.target.value as Scope })}
                options={SCOPES.map((b) => ({ value: b, label: b === CONSOLIDATED ? 'Every branch, added up' : b }))}
                hint="A branch reads its own records; the consolidated figure adds the branches up and says which could not answer."
              />
              <Segmented
                label="Period"
                name="schedule-range"
                value={schedule.range}
                onChange={(v) => commit({ range: v as RangeId })}
                options={RANGES.map((r) => ({ value: r.id, label: r.label }))}
              />
              <p className="-mt-1 text-xs text-text-tertiary">
                {def ? `${def.title} reads ${def.maxDays} day(s) of data; a wider period is refused rather than printed under a heading it does not cover.` : ''}
              </p>
              <Segmented
                label="How often"
                name="schedule-cadence"
                value={schedule.cadence.id}
                onChange={(v) => commit({ cadence: { ...schedule.cadence, id: v as ReportSchedule['cadence']['id'], ...(v === 'weekly' && !schedule.cadence.weekdays ? { weekdays: [1] } : {}), ...(v === 'monthly' && !schedule.cadence.day && !schedule.cadence.firstWorkingDay ? { day: 1 } : {}) } })}
                options={[
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                ]}
              />
              {schedule.cadence.id === 'weekly' && (
                <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
                  <legend className="text-xs font-medium text-text-secondary">Which days</legend>
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((name, index) => (
                    <CheckboxField
                      key={name}
                      label={name.slice(0, 3)}
                      name={`weekday-${index}`}
                      checked={(schedule.cadence.weekdays ?? []).includes(index)}
                      onChange={(e) =>
                        commit({
                          cadence: {
                            ...schedule.cadence,
                            weekdays: e.target.checked ? [...(schedule.cadence.weekdays ?? []), index].sort((a, b) => a - b) : (schedule.cadence.weekdays ?? []).filter((d) => d !== index),
                          },
                        })
                      }
                    />
                  ))}
                </fieldset>
              )}
              {schedule.cadence.id === 'monthly' && (
                <div className="flex flex-wrap items-end gap-2">
                  <TextField
                    label="Day of the month"
                    name="schedule-day"
                    inputMode="numeric"
                    value={schedule.cadence.firstWorkingDay ? '' : String(schedule.cadence.day ?? 1)}
                    disabled={Boolean(schedule.cadence.firstWorkingDay)}
                    onChange={(e) => {
                      const n = Math.min(28, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1));
                      commit({ cadence: { ...schedule.cadence, day: n, firstWorkingDay: false } });
                    }}
                    hint="Up to the 28th, so February is never skipped"
                  />
                  <CheckboxField
                    label="First working day"
                    name="schedule-first-working"
                    checked={Boolean(schedule.cadence.firstWorkingDay)}
                    onChange={(e) => commit({ cadence: { ...schedule.cadence, firstWorkingDay: e.target.checked } })}
                  />
                </div>
              )}
              <TextField
                label="At (24-hour)"
                name="schedule-times"
                value={schedule.cadence.times.join(', ')}
                onChange={(e) => commit({ cadence: { ...schedule.cadence, times: e.target.value.split(',').map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t)) } })}
                hint="Two times a day is written as 07:00, 19:00 — the register asks for two on the ward sheet and the blood bank count"
              />
              <TextField
                label="Why that hour"
                name="schedule-because"
                value={schedule.cadence.because}
                onChange={(e) => commit({ cadence: { ...schedule.cadence, because: e.target.value } })}
                hint="Printed beside the schedule. A time with no reason is a time nobody dares change."
              />
              <Segmented
                label="Send it"
                name="schedule-send-when"
                value={schedule.sendWhen}
                onChange={(v) => commit({ sendWhen: v as SendWhen })}
                options={[
                  { value: 'always', label: 'Always' },
                  { value: 'when-there-is-a-row', label: 'Only with something to report' },
                ]}
              />
              <Segmented
                label="Format"
                name="schedule-format"
                value={schedule.format}
                onChange={(v) => commit({ format: v as ReportSchedule['format'] })}
                options={[
                  { value: 'csv', label: 'Spreadsheet (CSV)' },
                  { value: 'print', label: 'Printed' },
                ]}
              />
              <TextField
                label="What the receiver does with it"
                name="schedule-action"
                value={schedule.action}
                onChange={(e) => commit({ action: e.target.value })}
                hint="A report nobody acts on is a report nobody reads."
              />
            </div>
          </Panel>

          <Panel
            title="Who receives it"
            actions={
              <Button variant="ghost" size="sm" onClick={addRecipient}>
                <Plus className="size-4" aria-hidden /> Add
              </Button>
            }
          >
            <ul className="flex flex-col gap-2">
              {schedule.recipients.map((r, i) => (
                <li key={i} className="rounded-md border border-border-subtle p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-text-secondary">Recipient {i + 1}</span>
                    <Button variant="ghost" size="sm" onClick={() => commit({ recipients: schedule.recipients.filter((_, x) => x !== i) })}>
                      <Trash2 className="size-3.5" aria-hidden /> Remove
                    </Button>
                  </div>
                  <div className="mt-1 flex flex-col gap-2">
                    <TextField label="Name" name={`r-name-${i}`} value={r.name} onChange={(e) => patchRecipient(i, { name: e.target.value })} />
                    <TextField label="Their role" name={`r-role-${i}`} value={r.role} onChange={(e) => patchRecipient(i, { role: e.target.value })} />
                    <SelectField
                      label="How it reaches them"
                      name={`r-channel-${i}`}
                      value={r.channel}
                      onChange={(e) => patchRecipient(i, { channel: e.target.value as ChannelId })}
                      options={CHANNELS.map((c) => ({ value: c.id, label: c.label }))}
                      hint={channelById(r.channel).note}
                    />
                    <TextField
                      label="Address, where the channel needs one"
                      name={`r-address-${i}`}
                      value={r.address}
                      onChange={(e) => patchRecipient(i, { address: e.target.value })}
                      hint="Empty for a counter that picks the sheet up and signs for it."
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-tertiary">{describeRecipients(schedule)}</p>
          </Panel>

          <Panel title={check.ok ? 'Ready to run' : `${check.reasons.length} refusal(s)`}>
            {check.ok ? (
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>{describeSchedule(schedule)}</li>
                <li>
                  {today
                    ? verdict.send
                      ? `Today it would be sent. ${verdict.because}`
                      : `Today it would be skipped. ${verdict.because}`
                    : 'No report to build for this topic.'}
                </li>
              </ul>
            ) : (
              <ul className="space-y-1 text-sm text-text-secondary">
                {check.reasons.map((r, i) => (
                  <li key={i}>
                    <span className="font-medium text-safety-critical">{r.title}</span>
                    {r.field ? ` (${r.field})` : ''}: {r.message}
                  </li>
                ))}
              </ul>
            )}
            {check.warnings.length > 0 && (
              <div className="mt-3 border-t border-border-subtle pt-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                  <TriangleAlert className="size-3.5 text-safety-warning" aria-hidden /> Worth settling
                </p>
                <ul className="mt-1 space-y-1 text-xs text-text-secondary">
                  {check.warnings.map((w, i) => (
                    <li key={i}>
                      <span className="font-medium text-safety-warning-text">{w.title}</span>
                      {w.field ? ` (${w.field})` : ''}: {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel title="What the server has to do">
            <ul className="flex flex-col gap-2 text-xs">
              {SCHEDULING_SERVER_DUTIES.map((d) => (
                <li key={d.title}>
                  <span className="font-medium text-text-primary">{d.title}</span>
                  <span className="font-numeric block text-text-tertiary">{d.endpoint}</span>
                  <span className="block text-text-secondary">{d.because}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-start gap-2 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              The contract carries all three: <span className="font-numeric">listReportSchedules</span> (cached at the node, because a branch with the uplink down still has to know who
              gets the morning sheet), <span className="font-numeric">saveReportSchedule</span> (queued, idempotent, audited) and <span className="font-numeric">runReportSchedule</span>{' '}
              (online-only, because a run is a delivery and a queued one is a promise nobody kept).
            </p>
          </Panel>
        </div>
      </div>

      <Panel title="The rules these schedules obey">
        <ul className="space-y-1 text-sm text-text-secondary">
          {SCHEDULE_RULES.map((r) => (
            <li key={r.title}>
              <span className="font-medium text-text-primary">{r.title}.</span> {r.because}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="How to work">
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>
            <FileCheck2 className="mr-1 inline size-3.5" aria-hidden />
            Pick a schedule, change what it says, then Download today’s sheet: the file that opens is the file the server will send, with its definitions, its period and its control
            total at the top.
          </li>
          <li>
            <Printer className="mr-1 inline size-3.5" aria-hidden />
            Print is a format, not a promise: a printed run needs a printer the server can reach with paper in it, so the download writes the CSV until the API exists and says so.
          </li>
          <li>
            <Send className="mr-1 inline size-3.5" aria-hidden />
            Save keeps the schedule on this node and queues it for the cloud. The other branches read the version that was queued, not this screen.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

/** The weekend note for a run that falls on one — a schedule is allowed to, and the reader should see it. */
function isWeekendNote(run: string): string | null {
  const index = new Date(`${run.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return index === 5 || index === 6 ? `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]} — the branch’s weekend` : null;
}

/** The next runs are printed a weekday at a time — “Monday 19 October 2026 at 08:00” — because the day of the week
 *  is the thing a person is agreeing to, and `describeRun` in `lib/report-schedules.ts` is the only place that
 *  formatting lives. */
