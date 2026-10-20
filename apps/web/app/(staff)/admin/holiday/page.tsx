'use client';

import { useMemo, useState } from 'react';
import { Button, CheckboxField, FieldSection, KpiTile, Panel, SafetyBanner, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { CalendarDays, ChevronLeft, ChevronRight, ShieldAlert, Users } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { MONTHS, isWeekend, type StaffBranch } from '@/lib/hr';
import {
  CALENDAR_RULES,
  HOLIDAYS_2026,
  HOLIDAY_KINDS,
  PAYROLL_CUT_OFF_DAY,
  WARD_PLANS,
  YEAR_END_NOTE,
  addDays,
  calendarMonth,
  calendarStats,
  checkHoliday,
  holidaysFor,
  nextHoliday,
  skeletonLines,
  yearMonths,
  type HolidayRow,
} from '@/lib/calendar';

/* Annual Calendar (P7) — the year as the branch works it.
 *
 * A hospital does not close, so every row here is a roster decision with a payroll consequence rather than a day
 * off. The screen is built around the three things the legacy list could not answer: which branch the day applies
 * to, who is actually on, and what it costs the month. The skeleton is derived from each ward's own beds and
 * ratio rather than typed in, so the plan cannot drift away from the ward it describes.
 *
 * The lunar holidays are provisional until the sighting committee announces them, and the screen prints the word
 * rather than a date the software worked out.
 */

const BRANCHES: StaffBranch[] = ['Main Campus', 'Uttara Branch', 'Mirpur Branch'];

const EMPTY_DRAFT = (todayIsoValue: string): HolidayDraftShape => ({
  id: '',
  name: '',
  nameBn: '',
  date: todayIsoValue,
  observed: '',
  kind: 'Gazetted',
  source: 'Ministry circular',
  branch: 'All branches',
  wardPlan: 'Skeleton staff',
  skeletonWho: '',
  paid: true,
  provisional: false,
  noticeDays: 14,
  approvedBy: '',
  note: '',
});

interface HolidayDraftShape {
  id: string;
  name: string;
  nameBn: string;
  date: string;
  observed: string;
  kind: string;
  source: string;
  branch: StaffBranch | 'All branches';
  wardPlan: string;
  skeletonWho: string;
  paid: boolean;
  provisional: boolean;
  noticeDays: number;
  approvedBy: string;
  note: string;
}

export default function AnnualCalendarPage() {
  const day = todayIso();
  const year = day.slice(0, 4);
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [branch, setBranch] = useState<StaffBranch>('Main Campus');
  const [monthIso, setMonthIso] = useState(day.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<HolidayDraftShape>(() => EMPTY_DRAFT(day));
  const [extra, setExtra] = useState<HolidayRow[]>([]);

  const rows = useMemo(() => holidaysFor(branch, [...extra, ...HOLIDAYS_2026]), [branch, extra]);
  const stats = useMemo(() => calendarStats(year, branch, [...extra, ...HOLIDAYS_2026]), [year, branch, extra]);
  const month = useMemo(() => calendarMonth(monthIso, branch, [...extra, ...HOLIDAYS_2026]), [monthIso, branch, extra]);
  const months = useMemo(() => yearMonths(year).map((m) => calendarMonth(m, branch, [...extra, ...HOLIDAYS_2026])), [year, branch, extra]);
  const record = selected ? rows.find((r) => r.id === selected) ?? null : null;
  const upcoming = useMemo(() => nextHoliday(day, branch, [...extra, ...HOLIDAYS_2026]), [day, branch, extra]);
  const skeleton = useMemo(() => (record ? skeletonLines(record) : []), [record]);

  const check = useMemo(
    () =>
      checkHoliday({
        ...draft,
        todayIso: day,
        rows: [...extra, ...HOLIDAYS_2026],
      }),
    [draft, day, extra],
  );

  const save = () => {
    const fresh = checkHoliday({ ...draft, todayIso: day, rows: [...extra, ...HOLIDAYS_2026] });
    if (!fresh.ok) {
      push({ title: `The calendar refuses this row — ${fresh.reasons[0].code}`, description: fresh.reasons[0].message, tone: 'critical' });
      return;
    }
    const row: HolidayRow = {
      id: `h-new-${extra.length + 1}`,
      name: draft.name.trim(),
      nameBn: draft.nameBn.trim(),
      date: draft.date,
      ...(draft.observed ? { observed: draft.observed } : {}),
      kind: draft.kind as HolidayRow['kind'],
      source: draft.source as HolidayRow['source'],
      branches: draft.branch === 'All branches' ? [] : [draft.branch],
      wardPlan: draft.wardPlan as HolidayRow['wardPlan'],
      skeletonWho: draft.skeletonWho.trim(),
      paid: draft.paid,
      provisional: draft.provisional,
      noticeDays: draft.noticeDays,
      noticeSent: null,
      approvedBy: draft.approvedBy.trim() || null,
      approvedAt: draft.approvedBy.trim() ? `${day} 10:30` : null,
      payrollNote: draft.wardPlan === 'Normal service' ? 'Normal service: no holiday rate is owed.' : 'Holiday rate for the skeleton that works it.',
      note: draft.note.trim(),
    };
    setExtra((list) => [row, ...list]);
    setAdding(false);
    const outcome = queueWrite(`Holiday ${row.date}: ${row.name} (${row.wardPlan})`, {
      id: 'savePlatformSetting',
      recordId: 'calendar.holidays',
      fields: { key: 'calendar.holidays', scope: 'hospital-wide', date: row.date, kind: row.kind, branch: draft.branch, wardPlan: row.wardPlan },
    });
    setDraft(EMPTY_DRAFT(day));
    push({
      title: outcome.queued ? `${row.name} added to ${year}` : `${row.name} not saved on this device`,
      description: outcome.queued
        ? `The row is queued and every screen that reads the calendar — the roster, the leave register and the payroll file — sees it when the queue drains.${fresh.warnings.length ? ` ${fresh.warnings.length} thing(s) the calendar records and passes on.` : ''}`
        : `The holiday table is a setting every device reads${outcome.because ? `, and it is online-only: ${outcome.because}` : ''}.`,
      tone: outcome.queued ? (fresh.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  const shiftMonth = (delta: number) => {
    const index = MONTHS.indexOf(month.label.split(' ')[0]);
    const nextIndex = Math.min(11, Math.max(0, index + delta));
    setMonthIso(yearMonths(year)[nextIndex]);
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="annual-calendar"
        subtitle={`${year} · ${stats.rows} row(s) for ${branch} · ${stats.workedThrough} of them are worked through.`}
        actions={
          <>
            <SelectField name="calendar-branch" label="Branch" value={branch} onChange={(e) => setBranch(e.target.value as StaffBranch)} options={BRANCHES.map((b) => ({ value: b, label: b }))} />
            <Button variant="primary" onClick={() => setAdding(true)}>
              <CalendarDays className="size-4" aria-hidden /> Add a holiday
            </Button>
          </>
        }
        waiting={stats.noticeOutstanding > 0 ? `${stats.noticeOutstanding} row(s) with no notice sent, and ${stats.plansUnapproved} skeleton plan(s) with nobody's name against them.` : undefined}
      />

      <AdminSiblings screenId="annual-calendar" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Rows this year" value={String(stats.rows)} definition="Every day the calendar records for this branch: gazetted, festival, restricted and the branch’s own closures." asOf={day} />
        <KpiTile label="Gazetted" value={String(stats.gazetted)} definition="Days the government closes. The out-patient floor closes here and the wards do not." asOf={day} />
        <KpiTile label="Worked through" value={String(stats.workedThrough)} definition="Days with a plan that keeps the branch open. Each one owes the holiday rate to whoever is rostered on it." asOf={day} />
        <KpiTile label="Provisional" value={String(stats.provisional)} definition="Dates the branch is assuming: the lunar holidays follow the sighting committee, and the row says so until the announcement." asOf={day} footnote={stats.provisional ? 'waiting on the announcement' : undefined} />
        <KpiTile label="Notice outstanding" value={String(stats.noticeOutstanding)} definition="Holidays whose notice has not gone out. The roster is published a week ahead, so the notice is the only thing that makes the plan real." asOf={day} />
        <KpiTile label="Plans unapproved" value={String(stats.plansUnapproved)} definition="A day that is not normal service with no roster officer’s name against it. The ward can only ask whether the roster was changed, and this name is the answer." asOf={day} />
        <KpiTile label="Next holiday" value={upcoming ? upcoming.date.slice(5) : '—'} definition={upcoming ? `${upcoming.name} (${upcoming.kind}) · ${upcoming.wardPlan}. ${upcoming.payrollNote}` : 'Nothing further this year for this branch.'} asOf={day} footnote={upcoming?.provisional ? 'provisional date' : undefined} />
      </div>

      {stats.observedDayOpen > 0 && (
        <SafetyBanner severity="warning" title={`${stats.observedDayOpen} holiday(s) fall on a weekend with no observed day recorded`}>
          A holiday that lands on a Friday is a day off the staff already had. The calendar records the question rather than deciding it:
          somebody has to say whether the day is moved, and the roster and the payroll both read the answer.
        </SafetyBanner>
      )}

      <Panel
        title="The year"
        actions={
          <span className="text-xs text-text-secondary">{months.reduce((sum, m) => sum + m.workingDays, 0)} working days for {branch}</span>
        }
      >
        <div className="mb-3 grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
          {months.map((m) => (
            <button
              key={m.monthIso}
              type="button"
              aria-pressed={m.monthIso === monthIso}
              onClick={() => setMonthIso(m.monthIso)}
              className={cx(
                'rounded-md border px-2 py-1 text-left text-xs',
                m.monthIso === monthIso ? 'border-brand-500 bg-brand-50' : 'border-border-subtle hover:bg-surface-sunken',
              )}
            >
              <span className="block font-medium text-text-primary">{m.label.split(' ')[0]}</span>
              <span className="block text-text-tertiary">
                {m.holidays.length} holiday(s) · <span className="font-numeric">{m.workingDays}</span> working
              </span>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-border-subtle">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <Button variant="ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <p className="text-sm font-semibold text-text-primary">
              {month.label} · <span className="font-numeric">{month.workingDays}</span> working days
            </p>
            <Button variant="ghost" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-px bg-border-subtle p-px">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => (
              <div key={n} className="bg-surface-sunken px-2 py-1 text-center text-xs font-medium text-text-secondary">
                {n}
              </div>
            ))}
            {Array.from({ length: new Date(`${month.monthIso}-01T00:00:00Z`).getUTCDay() }).map((_, i) => (
              <div key={`pad-${i}`} className="bg-surface-default px-1 py-2" />
            ))}
            {month.days.map((d) => (
              <button
                key={d.day}
                type="button"
                onClick={() => d.holiday && setSelected(d.holiday.id)}
                className={cx(
                  'min-h-16 bg-surface-default px-1.5 py-1 text-left align-top',
                  d.holiday ? 'cursor-pointer' : 'cursor-default',
                  d.holiday && d.holiday.provisional && 'bg-safety-warning/10',
                  d.holiday && !d.holiday.provisional && 'bg-brand-50',
                  d.weekend && !d.holiday && 'bg-surface-sunken',
                  d.day === day && 'ring-1 ring-inset ring-brand-500',
                )}
              >
                <span className="font-numeric text-xs text-text-tertiary">{d.dayOfMonth}</span>
                {d.holiday && (
                  <>
                    <span className="mt-0.5 block text-[11px] leading-tight font-medium text-text-primary">{d.holiday.name.split('—')[0].trim()}</span>
                    <span className="block text-[10px] text-text-secondary">{d.holiday.wardPlan}</span>
                    {d.holiday.provisional && <span className="block text-[10px] font-medium text-safety-warning">provisional</span>}
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title={`${month.label} — the days and what they cost`} actions={<span className="text-xs text-text-secondary">{month.holidays.length} holiday(s) in this month</span>}>
        {month.holidays.length === 0 ? (
          <p className="text-sm text-text-secondary">No holidays this month for {branch}. The month is still planned around its weekends: the roster counts working days, and this month has {month.workingDays} of them.</p>
        ) : (
          <ListView
            id="calendar-month"
            caption={`${branch} holidays in ${month.label}`}
            rows={month.holidays}
            rowId={(h) => h.id}
            onRowClick={(h) => setSelected(h.id)}
            emptyLabel="No holidays this month."
            columns={[
              { key: 'date', header: 'Date', width: '7rem', render: (h) => <span className="font-numeric">{h.date}</span> },
              { key: 'dayName', header: 'Day', width: '5rem', render: (h) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${h.date}T00:00:00Z`).getUTCDay()] },
              { key: 'name', header: 'Holiday', render: (h) => (<span><span className="font-medium">{h.name}</span>{h.provisional && <span className="ml-1 text-xs font-medium text-safety-warning">provisional</span>}</span>) },
              { key: 'kind', header: 'Kind', width: '9rem', hideBelow: 'md' },
              { key: 'wardPlan', header: 'Plan', render: (h) => <span className={cx(h.wardPlan === 'Normal service' ? 'text-text-secondary' : 'text-brand-700')}>{h.wardPlan}</span> },
              { key: 'paid', header: 'Rate', width: '6rem', hideBelow: 'md', render: (h) => (h.paid ? 'holiday' : 'normal') },
              { key: 'approvedBy', header: 'Roster approved', hideBelow: 'lg', render: (h) => h.approvedBy ?? <span className="text-safety-warning">not approved</span> },
            ]}
          />
        )}
        <p className="mt-2 text-xs text-text-tertiary">Payroll cut-off is the day-{PAYROLL_CUT_OFF_DAY} of the month, so a holiday after it is paid in the following run. {YEAR_END_NOTE}</p>
      </Panel>

      <Panel title="What this calendar refuses, and why" actions={<span className="text-xs text-text-secondary">{CALENDAR_RULES.length} rules</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {CALENDAR_RULES.map((rule) => (
            <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}
              </p>
              <p className="text-text-secondary">{rule.because}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ----------------------------------------------------------------------------------------- one holiday */}
      <Sheet
        open={Boolean(record)}
        onClose={() => setSelected(null)}
        title={record ? `${record.name}` : 'Holiday'}
        description={record ? `${record.date} · ${record.kind} · ${record.wardPlan} · applies to ${record.branches.length === 0 ? 'all branches' : record.branches.join(', ')}` : undefined}
        width="lg"
      >
        {record && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                ['Bangla name', record.nameBn || '—'],
                ['Date', record.date],
                ['Observed', record.observed ?? (isWeekend(record.date) ? 'open question — falls on a weekend' : record.date)],
                ['Kind and source', `${record.kind} · ${record.source}`],
                ['Roster plan', record.wardPlan],
                ['Who is on', record.skeletonWho || '—'],
                ['Rate', record.paid ? 'holiday rate for everyone rostered' : 'no holiday rate owed'],
                ['Notice', record.noticeSent ? `sent ${record.noticeSent} (${record.noticeDays} days’ rule)` : `not sent · the rule is ${record.noticeDays} days`],
                ['Roster approved', record.approvedBy ? `${record.approvedBy} · ${record.approvedAt}` : 'nobody named yet'],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {record.provisional && (
              <SafetyBanner severity="warning" title="Provisional date">
                The branch plans against this date and edits the row when the sighting committee announces the real one. Notices already
                printed from the old date stay on the record: a holiday that silently moves is one the ward finds out about from the newspaper.
              </SafetyBanner>
            )}

            {!record.approvedBy && record.wardPlan !== 'Normal service' && (
              <SafetyBanner severity="critical" title="No roster officer against the plan">
                The plan exists and nobody has read it. The ward can only ask whether the roster was changed, and the answer this row gives
                is nobody.
              </SafetyBanner>
            )}

            <Panel title="The skeleton, derived from each ward" actions={<span className="text-xs text-text-secondary">{skeleton.length} wards · plan ×{record.wardPlan === 'Emergency and in-patients only' ? '0.7' : record.wardPlan === 'Closed to visitors' ? '0.5' : record.wardPlan === 'Normal service' ? '1' : '0.8'}</span>}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th className="py-1">Ward</th>
                    <th className="py-1">Ratio</th>
                    <th className="py-1 text-right">Needed</th>
                    <th className="py-1 text-right">On the roster</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {skeleton.map((line) => (
                    <tr key={line.wardId} className="border-b border-border-subtle/60">
                      <td className="py-1 font-medium">{line.ward}</td>
                      <td className="py-1 text-text-secondary">{line.ratio}</td>
                      <td className="py-1 text-right font-numeric">{line.nursesNeeded}</td>
                      <td className="py-1 text-right font-numeric">{line.nursesOn}</td>
                      <td className={cx('py-1 text-xs', line.nursesOn >= line.nursesNeeded ? 'text-safety-success' : 'text-safety-warning')}>{line.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">What the payroll owes</p>
              <p className="text-text-secondary">{record.payrollNote}</p>
            </div>
            {record.note && <p className="text-text-secondary">{record.note}</p>}

            <Panel title="If this row were edited today">
              <ul className="space-y-1">
                {checkHoliday({ ...record, id: record.id, observed: record.observed ?? '', source: record.source, branch: record.branches[0] ?? 'All branches', todayIso: day, approvedBy: record.approvedBy ?? '', rows: [...extra, ...HOLIDAYS_2026] }).warnings.map((w, i) => (
                  <li key={i} className="text-safety-warning">{w}</li>
                ))}
                <li className="text-text-tertiary">Refusals are only produced while editing: a row already in the calendar is history, and the calendar does not rewrite history.</li>
              </ul>
            </Panel>
          </div>
        )}
      </Sheet>

      {/* ----------------------------------------------------------------------------------------- add a holiday */}
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a holiday"
        description={`${13} fields. The plan is the roster decision, and the payroll note is what the month owes for it.`}
        width="xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={cx('mr-auto text-xs', check.ok ? 'text-safety-success' : 'text-safety-critical')}>
              {check.ok ? (check.warnings.length ? `${check.warnings.length} thing(s) the calendar records and passes on.` : 'The calendar would accept this row.') : `${check.reasons.length} refusal(s) — the first is below.`}
            </span>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!check.ok}>Add to the calendar</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <SafetyBanner severity={check.ok ? (check.warnings.length ? 'warning' : 'success') : 'critical'} title={check.ok ? (check.warnings.length ? 'Recorded, and passed on' : 'Nothing to refuse') : check.reasons[0].code}>
            {check.ok ? (
              check.warnings.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {check.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : (
                <>The date is placed, the plan names who is on, the notice rule is met and the payroll consequence is written down.</>
              )
            ) : (
              check.reasons[0].message
            )}
          </SafetyBanner>

          <FieldSection title="The day" description="What it is called, when it falls, and where it applies.">
            <TextField label="Name" name="holiday-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} hint="The name the ward notice, the payroll note and the leave calendar all print." />
            <TextField label="Bangla name" name="holiday-nameBn" value={draft.nameBn} onChange={(e) => setDraft({ ...draft, nameBn: e.target.value })} hint="Printed beside the English name, because the ward notice is read in Bangla." />
            <TextField label="Date" name="holiday-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} hint="The date the holiday falls on. A row is one date: a three-day festival is three rows naming the same festival." />
            <TextField label="Observed day" name="holiday-observed" type="date" value={draft.observed} onChange={(e) => setDraft({ ...draft, observed: e.target.value })} hint="Leave empty when the day is not moved. A holiday on a Friday is a day off the staff already had." />
            <SelectField label="Kind" name="holiday-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} options={HOLIDAY_KINDS.map((k) => ({ value: k, label: k }))} hint="Gazetted, festival, restricted — or a branch closure, which is the branch’s own decision and needs more notice." />
            <SelectField label="Source" name="holiday-source" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} options={['Ministry circular', 'Sighting committee', 'Branch decision', 'Gazette'].map((s) => ({ value: s, label: s }))} hint="Where the date came from. A lunar date the branch assumed rather than heard is a provisional row." />
            <SelectField label="Applies to" name="holiday-branch" value={draft.branch} onChange={(e) => setDraft({ ...draft, branch: e.target.value as HolidayRow['branches'][number] | 'All branches' })} options={['All branches', ...BRANCHES].map((b) => ({ value: b, label: b }))} hint="A gazetted day closes the administration floor and changes nothing in a ward. Per branch is the honest answer." />
            <CheckboxField label="Provisional date" name="holiday-provisional" checked={draft.provisional} onChange={(e) => setDraft({ ...draft, provisional: e.target.checked })} hint="The sighting committee has not announced it. Wards plan against the assumption and HR edits the row when it comes." />
            <CheckboxField label="Paid at the holiday rate" name="holiday-paid" checked={draft.paid} onChange={(e) => setDraft({ ...draft, paid: e.target.checked })} hint="A restricted holiday is taken from earned leave or worked as an ordinary day; marking it paid is a branch decision." />
          </FieldSection>

          <FieldSection title="The roster decision" description="A hospital does not close, so this is the part the ward reads.">
            <SelectField label="Ward plan" name="holiday-plan" value={draft.wardPlan} onChange={(e) => setDraft({ ...draft, wardPlan: e.target.value })} options={WARD_PLANS.map((p) => ({ value: p, label: p }))} hint="Normal service, a skeleton, emergency and in-patients only, or closed to visitors. The skeleton count is derived from each ward’s own beds and ratio." />
            <TextField label="Who is on" name="holiday-skeleton" value={draft.skeletonWho} onChange={(e) => setDraft({ ...draft, skeletonWho: e.target.value })} hint="In words the ward notice can print: two nurses per ward, one duty doctor per floor, one pharmacist, one cashier." />
            <TextField label="Notice days" name="holiday-notice" type="number" value={String(draft.noticeDays)} onChange={(e) => setDraft({ ...draft, noticeDays: Number(e.target.value) })} hint="Seven days is the floor for a holiday and twenty-one for a closure. The roster is published a week ahead." />
            <TextField label="Roster approved by" name="holiday-approver" value={draft.approvedBy} onChange={(e) => setDraft({ ...draft, approvedBy: e.target.value })} hint="The roster officer who read the plan. Without a name the ward can only ask whether the roster was changed." />
          </FieldSection>

          <FieldSection title="The note" description="What the branch should remember about the day.">
            <TextAreaField label="Note" name="holiday-note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} hint="The reason, in a sentence. The puja procession near the gate, the theatre on call over Eid, the morning programme that must stay short." rows={3} />
          </FieldSection>

          <Panel title="What this row will do">
            <ul className="space-y-1 text-sm text-text-secondary">
              <li>· It appears on the calendar for {draft.branch === 'All branches' ? 'every branch' : draft.branch} on {draft.date}{draft.observed ? `, observed ${draft.observed}` : ''}.</li>
              <li>· The roster for that day is planned against {draft.wardPlan.toLowerCase()}, and the ward’s plan shows {skeletonLines({ ...HOLIDAYS_2026[0], wardPlan: draft.wardPlan as HolidayRow['wardPlan'], branches: [] } as HolidayRow).reduce((n, l) => n + l.nursesNeeded, 0)} nurses across the four wards.</li>
              <li>· Notice is due {addDays(draft.date, -draft.noticeDays)} under the {draft.noticeDays}-day rule{draft.date > day && addDays(draft.date, -draft.noticeDays) <= day ? ' — which is already inside the window' : ''}.</li>
              <li>· {draft.paid ? 'Anyone rostered on it is paid at the holiday rate, and the night shift that crosses midnight is on it for part of its stint.' : 'No holiday rate is owed: a day worked on this row is an ordinary day on the payroll.'}</li>
            </ul>
          </Panel>

          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Users className="size-3.5" aria-hidden /> The plan and the roster are checked against each other, so a skeleton nobody is rostered for shows as a shortfall rather than as a plan.
          </div>
        </div>
      </Sheet>
    </div>
  );
}
