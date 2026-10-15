'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Sheet, TextField, SelectField, cx, useToast } from '@dizi/ui';
import { AlertTriangle, CalendarRange, Clock4 } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { HR_NODES, REGISTER_CODES, attendanceRegister, payrollAttendance, registerDigest, seedLeaveSpans, type RegisterCode, type RegisterRow } from '@/lib/attendance';
import { addMonths, LATE_MARKS_PER_HALF_DAY, dayName, monthLabel, monthOf, staffDirectory, taxFor } from '@/lib/hr';
import { money } from '@/lib/billing';

/* Staff attendance register — the month as a matrix (P7 sub-screen).
 *
 * Thirty-two columns is the whole point of this screen: the legacy product printed a monthly sheet somebody
 * filled in on Thursday for the week before. Here every day carries a code from the reader, the exceptions are
 * named, and the figures the payroll uses are printed beside them.
 *
 * The one promise this screen has to keep is that its numbers are the payroll's numbers: both walk the same
 * generator, so a row that says three absent days is a line that deducts three days. If they were computed twice
 * they would eventually disagree, and the disagreement would be somebody's pay.
 */

const TONE_CELL: Record<RegisterCode, string> = {
  P: 'bg-safety-success/15 text-safety-success',
  L: 'bg-safety-warning/20 text-safety-warning',
  HD: 'bg-safety-warning/10 text-safety-warning',
  A: 'bg-safety-critical/20 text-safety-critical',
  LV: 'bg-safety-info/15 text-safety-info',
  LWP: 'bg-safety-warning/10 text-safety-warning',
  WO: 'bg-surface-sunken text-text-tertiary',
  PH: 'bg-brand-50 text-brand-700',
  T: 'bg-safety-info/10 text-safety-info',
};

const CODES: RegisterCode[] = ['P', 'L', 'HD', 'A', 'LV', 'LWP', 'WO', 'PH', 'T'];

export default function StaffAttendanceRegisterPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const directory = useMemo(() => staffDirectory(day), [day]);
  const [month, setMonth] = useState(monthOf(day));
  const spans = useMemo(() => seedLeaveSpans(month, directory), [month, directory]);
  const register = useMemo(() => attendanceRegister(month, directory, spans), [month, directory, spans]);
  const digest = useMemo(() => registerDigest(register), [register]);
  const pay = useMemo(() => payrollAttendance(register), [register]);

  const [spotlight, setSpotlight] = useState<RegisterCode | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [department, setDepartment] = useState('every');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [correctTo, setCorrectTo] = useState('P');
  const [correctReason, setCorrectReason] = useState('');

  const rows = useMemo(
    () => register.rows.filter((r) => department === 'every' || r.departmentId === department),
    [register.rows, department],
  );
  const staff = openCode ? register.rows.find((r) => r.staffCode === openCode) ?? null : null;
  const totals = useMemo(() => {
    const all = rows.flatMap((r) => r.days);
    return {
      present: all.filter((d) => d.code === 'P').length,
      late: all.filter((d) => d.code === 'L').length,
      half: all.filter((d) => d.code === 'HD').length,
      absent: all.filter((d) => d.code === 'A').length,
      leave: all.filter((d) => d.code === 'LV' || d.code === 'LWP').length,
      off: all.filter((d) => d.code === 'WO' || d.code === 'PH').length,
      ot: Math.round((all.reduce((n, d) => n + d.otMinutes, 0) / 60) * 10) / 10,
    };
  }, [rows]);

  /* What this month does to one payslip, shown before the payroll is run rather than after. */
  const impact = staff ? (() => {
    const attendance = pay[staff.staffCode];
    const lateHalf = Math.floor((attendance?.lateMarks ?? 0) / LATE_MARKS_PER_HALF_DAY);
    return {
      absent: attendance?.absentDays ?? 0,
      half: attendance?.halfDays ?? 0,
      lateMarks: attendance?.lateMarks ?? 0,
      lateHalf,
      unpaid: attendance?.unpaidLeaveDays ?? 0,
      ot: attendance?.overtimeHours ?? 0,
    };
  })() : null;

  const correct = (row: RegisterRow) => {
    if (!selectedDay) {
      push({ title: 'Pick the day first.', description: 'A correction is about one day, and the register keeps the day it corrects.', tone: 'critical' });
      return;
    }
    if (!correctReason.trim()) {
      push({ title: 'A correction needs a reason and a name.', description: 'It is the sentence the person whose pay depends on this day reads when they ask about it.', tone: 'critical' });
      return;
    }
    const outcome = queueWrite(`Attendance corrected: ${row.name} ${selectedDay} → ${correctTo}`, {
      id: 'recordAttendanceAdjustment',
      recordId: `${row.staffCode}:${selectedDay}`,
      fields: { staffCode: row.staffCode, day: selectedDay, state: correctTo === 'A' ? 'Out' : 'In', reason: correctReason.trim(), verifiedBy: 'Shift manager', at: `${selectedDay} 23:30` },
    });
    push({
      title: outcome.queued ? 'Correction queued' : 'Correction recorded',
      description: outcome.queued
        ? 'It is a second record naming the supervisor and the reason — the punch it corrects is still there, which is what makes it checkable.'
        : `The contract does not queue this write ${outcome.because}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
    setCorrectReason('');
    setSelectedDay(null);
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="staff-attendance-register"
        subtitle={`${monthLabel(month)} for ${HR_NODES[0]}: every person, every day, from the readers at the doors.`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹ {monthLabel(addMonths(month, -1)).split(' ')[0]}</Button>
            <Button variant="ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">{monthLabel(addMonths(month, 1)).split(' ')[0]} ›</Button>
            <Link href="/admin/attendance">
              <Button variant="ghost">Today</Button>
            </Link>
          </>
        }
        waiting={syncEngine.summary.pending > 0 ? `${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync — corrections queue at this node.` : undefined}
      />

      <AdminSiblings screenId="staff-attendance-register" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="People" value={String(rows.length)} definition="Everyone on the register for this branch, whether or not they were rostered today." asOf={monthLabel(month)} footnote={department === 'every' ? undefined : department} />
        <KpiTile label="Present days" value={String(totals.present + totals.late + totals.half)} definition="Days the readers saw the person in the building for at least four hours, including the days they were late." asOf={monthLabel(month)} footnote={`${totals.late} late · ${totals.half} half`} />
        <KpiTile label="Absent days" value={String(totals.absent)} definition="No punch, no leave, no training. Every one of them is a deduction on a payslip and therefore a conversation, which is why the register names them before the run does." asOf={monthLabel(month)} />
        <KpiTile label="Leave days" value={String(totals.leave)} definition="Approved leave, paid and unpaid. The paid days come out of the entitlement; the unpaid ones come out of the gross." asOf={monthLabel(month)} />
        <KpiTile label="Rest days" value={String(totals.off)} definition="Weekly offs and gazetted holidays. Recorded rather than counted as absence — a ward works through a holiday, and the register keeps the fact so a compensatory day can be given." asOf={monthLabel(month)} />
        <KpiTile label="Overtime hours" value={String(totals.ot)} definition={`Hours past the shift, counted in half hours and paid at 1.5× once approved. The month is capped at 60 hours, because a rota that needs more than that is a staffing decision rather than an overtime one.`} asOf={monthLabel(month)} />
      </div>

      {digest.some((d) => d.count > 0 || d.tone === 'critical') && (
        <Panel title="What this month needs a person for">
          <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {digest.map((item) => (
              <li key={item.label} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-text-primary">{item.label}</span>
                  <span className={cx('font-numeric font-medium', item.tone === 'critical' ? 'text-safety-critical' : item.tone === 'warning' ? 'text-safety-warning' : 'text-brand-600')}>{item.count}</span>
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">{item.because}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="The month"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              label=""
              name="register-department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              options={[{ value: 'every', label: 'Every department' }, ...[...new Set(register.rows.map((r) => r.departmentId))].map((id) => ({ value: id, label: id }))]}
              className="w-44"
            />
            <span className="text-xs text-text-secondary">{rows.length} rows · {register.days.length} days</span>
          </div>
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Highlight a code">
          {CODES.map((code) => {
            const count = rows.flatMap((r) => r.days).filter((d) => d.code === code).length;
            const on = spotlight === code;
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                onClick={() => setSpotlight(on ? null : code)}
                title={REGISTER_CODES[code].because}
                className={cx('rounded-full border px-2 py-0.5 text-xs', on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border-subtle text-text-secondary hover:bg-surface-sunken')}
              >
                <span className="font-numeric font-medium">{code}</span> {REGISTER_CODES[code].label} <span className="font-numeric">{count}</span>
              </button>
            );
          })}
          {spotlight && <span className="text-xs text-text-tertiary">{REGISTER_CODES[spotlight].because}</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">
              Attendance register for {monthLabel(month)}: one row per member of staff, one column per day of the month.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-surface-default px-2 py-1 text-left font-medium text-text-secondary">Member of staff</th>
                {register.days.map((d) => (
                  <th scope="col" key={d} className="px-0.5 py-1 text-center font-normal text-text-tertiary" title={`${d} · ${dayName(d)}`}>
                    <span className="font-numeric">{Number(d.slice(8, 10))}</span>
                  </th>
                ))}
                <th scope="col" className="px-2 py-1 text-right font-medium text-text-secondary">Days</th>
                <th scope="col" className="px-2 py-1 text-right font-medium text-text-secondary">OT</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.staffCode} className="border-t border-border-subtle">
                  <th scope="row" className="sticky left-0 z-10 max-w-56 bg-surface-default px-2 py-1 text-left font-normal">
                    <button type="button" onClick={() => { setOpenCode(row.staffCode); setSelectedDay(null); }} className="text-left hover:underline">
                      <span className="block font-medium text-text-primary">{row.name}</span>
                      <span className="block text-text-tertiary">{row.designation} · <span className="font-numeric">{row.staffCode}</span></span>
                    </button>
                  </th>
                  {row.days.map((d) => (
                    <td key={d.day} className="p-0.5 text-center">
                      <button
                        type="button"
                        onClick={() => { setOpenCode(row.staffCode); setSelectedDay(d.day); }}
                        title={`${d.day} · ${REGISTER_CODES[d.code].label}${d.note ? ` — ${d.note}` : ''}`}
                        aria-label={`${row.name}, ${d.day}: ${REGISTER_CODES[d.code].label}`}
                        className={cx(
                          'size-6 rounded-sm font-numeric font-medium',
                          TONE_CELL[d.code],
                          spotlight && d.code === spotlight ? 'ring-2 ring-brand-500' : '',
                          spotlight && d.code !== spotlight ? 'opacity-30' : '',
                        )}
                      >
                        {d.code}
                      </button>
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right font-numeric">{row.summary.workedDays + row.summary.leave + row.summary.unpaid}</td>
                  <td className="px-2 py-1 text-right font-numeric">{row.summary.otHours || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-xs text-text-tertiary">
          Press a day to correct it. The correction is a second record naming the supervisor and the reason —
          the punch it corrects stays where it is, because the person whose pay depends on the day is entitled to
          see what changed and who changed it.
        </p>
      </Panel>

      <Panel title="Exceptions, in the order a shift manager deals with them">
        {register.exceptions.length === 0 ? (
          <p className="text-sm text-text-secondary">Nothing to correct this month: every day has a punch, a leave day or a rest day against it.</p>
        ) : (
          <ul className="space-y-2">
            {register.exceptions.slice(0, 12).map((e) => (
              <li key={`${e.staffCode}-${e.day}-${e.kind}`} className="flex items-start gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm">
                <AlertTriangle className={cx('mt-0.5 size-3.5 shrink-0', e.kind === 'no-punch' || e.kind === 'unpaired' ? 'text-safety-critical' : 'text-safety-warning')} aria-hidden />
                <span className="text-text-secondary">{e.text}</span>
              </li>
            ))}
          </ul>
        )}
        {register.exceptions.length > 12 && (
          <p className="mt-2 text-xs text-text-tertiary">… and {register.exceptions.length - 12} more this month, all of them the same three kinds.</p>
        )}
      </Panel>

      <Sheet
        open={Boolean(staff)}
        onClose={() => { setOpenCode(null); setSelectedDay(null); }}
        title={staff ? `${staff.name} — ${monthLabel(month)}` : 'Register'}
        description={staff ? `${staff.designation} · ${staff.staffCode} · ${HR_NODES[0]}` : undefined}
        width="xl"
        footer={
          staff && (
            <div className="flex flex-wrap justify-end gap-2">
              <Link href="/admin/payroll">
                <Button variant="ghost">Open payroll</Button>
              </Link>
            </div>
          )
        }
      >
        {staff && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ['Present', staff.summary.present],
                ['Late', staff.summary.late],
                ['Half days', staff.summary.half],
                ['Absent', staff.summary.absent],
                ['Leave', `${staff.summary.leave} paid · ${staff.summary.unpaid} unpaid`],
                ['Overtime', `${staff.summary.otHours} h`],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md border border-border-subtle px-3 py-2">
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-center gap-1.5 font-medium text-text-primary"><CalendarRange className="size-3.5" aria-hidden /> What this month does to the payslip</p>
              <ul className="mt-1 space-y-1 text-text-secondary">
                <li>{impact?.absent} absent day(s) and {impact?.half} half day(s) — the day rate comes out of the gross for each.</li>
                <li>{impact?.lateMarks} late mark(s) → {impact?.lateHalf} half day(s), because {LATE_MARKS_PER_HALF_DAY} late arrivals make one.</li>
                <li>{impact?.unpaid} unpaid leave day(s) — off the gross rather than off the entitlement.</li>
                <li>{impact?.ot} overtime hour(s), paid at 1.5× once approved.</li>
              </ul>
              <p className="mt-1 text-xs text-text-tertiary">
                The payroll walks this same register rather than a second copy of it, so this list and the payslip are one
                calculation. {staff.wardId ? 'Overtime on the ward is approved by the nursing superintendent.' : 'Office overtime is not paid — the hours are recorded and the staffing is a separate conversation.'}
              </p>
            </div>

            <div>
              <p className="flex items-center gap-1.5 text-xs text-text-secondary"><Clock4 className="size-3.5" aria-hidden /> The month, day by day</p>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                {staff.days.map((d) => (
                  <li key={d.day} className="flex items-start justify-between gap-2 rounded-md border border-border-subtle px-3 py-1.5">
                    <span>
                      <span className="font-numeric text-text-secondary">{d.day}</span> <span className="text-xs text-text-tertiary">{dayName(d.day)}</span>
                      {d.note && <span className="block text-xs text-text-secondary">{d.note}</span>}
                    </span>
                    <button type="button" onClick={() => setSelectedDay(d.day)} className={cx('rounded-sm px-1.5 py-0.5 font-numeric text-xs font-medium', TONE_CELL[d.code], selectedDay === d.day ? 'ring-2 ring-brand-500' : '')}>
                      {d.code}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">Correct a day</p>
              <p className="text-xs text-text-secondary">Pick the day in the list above, then say what it should read and why. The reader’s punch stays on the record.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <SelectField label="Should read" name="correct-code" value={correctTo} onChange={(e) => setCorrectTo(e.target.value)} options={CODES.map((c) => ({ value: c, label: `${c} — ${REGISTER_CODES[c].label}` }))} />
                <TextField label="Why" name="correct-reason" value={correctReason} onChange={(e) => setCorrectReason(e.target.value)} placeholder="Reader was down; the badge was in the laundry" className="sm:col-span-2" />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-text-tertiary">{selectedDay ? `Correcting ${selectedDay}` : 'No day picked yet'}</span>
                <Button variant="secondary" onClick={() => correct(staff)}>Queue the correction</Button>
              </div>
            </div>

            <SafetyBanner severity="info" title="Paid from this register">
              {staff.staffCode} works {staff.employment.toLowerCase()}. The month’s {staff.summary.workedDays} worked
              day(s) plus {staff.summary.leave} paid leave day(s) are what the payroll pays; the two figures the
              legacy system kept separately — the sheet in the ward office and the timesheet at HR — are one figure
              here, which is the only reason a payslip argument can be settled by reading.
              {pay[staff.staffCode] && ` The run reads ${pay[staff.staffCode].daysInMonth} days for this month.`}
            </SafetyBanner>
          </div>
        )}
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Money elsewhere on this screen is the payslip’s, not this screen’s: a branch’s register is also one of the
        inputs to the payroll, and the tax table is the branch’s own — {money(taxFor(1_200_000).afterRebate)} on
        ৳12,00,000 taxable in this table, which the Setup › Human Resource screen shows in full.
      </p>
    </div>
  );
}
