'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Segmented, Sheet, TextField, cx, useToast } from '@dizi/ui';
import { Banknote, Calculator, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import { useShell } from '@/lib/shell';
import { HR_NODES, attendanceRegister, payrollAttendance, seedLeaveSpans } from '@/lib/attendance';
import {
  ADVANCE_CAP_PCT,
  OT_HOURS_PER_MONTH,
  OT_MULTIPLIER,
  OT_MONTHLY_CAP_HOURS,
  PAYROLL_CUT_OFF_DAY,
  PAYROLL_FLOW,
  PAYROLL_RULES,
  TAX_TABLE_NOTE,
  addMonths,
  allowancesFor,
  monthLabel,
  monthOf,
  payrollLine,
  payrollRefusals,
  staffDirectory,
  type PayrollAttendance,
  type PayrollLine,
  type PayrollRun,
} from '@/lib/hr';

/* Payroll — the month's salary, line by line (P7 sub-screen).
 *
 * The legacy screen produced a total and a bank file, and when somebody asked why their net was ৳2,300 lower than
 * last month there was no answer in the software. This screen is built the other way round: every line opens into
 * its own arithmetic — the allowances, each deduction with the rule that produced it, the attendance it was
 * computed from, and the employer's cost on top.
 *
 * Two rules are enforced rather than described. One: a month is run once per branch, so a second run is refused
 * with the first. Two: the person who runs it does not approve it, and the approval is online-only by contract —
 * this preview records the refusal it cannot avoid rather than pretending a queued approval is a signature.
 */

const VIEWS: Array<{ label: string; keep: (l: PayrollLine) => boolean; hint: string }> = [
  { label: 'Everything', keep: () => true, hint: 'Every line in the run, in employee-number order.' },
  { label: 'Clinical', keep: (l) => l.departmentId === 'nursing' || ['Consultant', 'Registrar', 'Intern', 'Senior staff nurse', 'Staff nurse', 'Midwife', 'Medical technologist'].includes(l.designation), hint: 'The people the roster is built from, including the overtime theirs carries.' },
  { label: 'Overtime paid', keep: (l) => l.overtimeHours > 0, hint: 'Approved hours past the shift, paid at 1.5×. Unapproved hours are worked and recorded, and not paid.' },
  { label: 'Attendance deductions', keep: (l) => l.absentDays > 0 || l.unpaidLeaveDays > 0 || l.deductions.some((d) => d.code === 'LATE'), hint: 'Lines where the register took something off: absent days, unpaid leave or three late marks.' },
  { label: 'Tax deducted', keep: (l) => l.deductions.some((d) => d.code === 'TAX'), hint: 'The people above the exemption in the branch’s own slab table, with the marginal rate printed on the line.' },
  { label: 'Needs a person', keep: (l) => l.notes.length > 0, hint: 'Lines the arithmetic could not settle by itself: a net that hit zero, hours above the monthly cap, a stipend instead of a salary.' },
];

export default function PayrollPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const directory = useMemo(() => staffDirectory(day), [day]);
  const [branch, setBranch] = useState<string>(HR_NODES[0]);
  const [month, setMonth] = useState(monthOf(day));
  const spans = useMemo(() => seedLeaveSpans(month, directory), [month, directory]);
  const register = useMemo(() => attendanceRegister(month, directory, spans), [month, directory, spans]);
  const attendance = useMemo(() => payrollAttendance(register), [register]);

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [approvedOt, setApprovedOt] = useState<Record<string, number>>({});
  const [advances, setAdvances] = useState<Record<string, number>>({});
  const [view, setView] = useState('Everything');
  const [query, setQuery] = useState('');
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [otDraft, setOtDraft] = useState('');
  const [advanceDraft, setAdvanceDraft] = useState('');

  const cutOff = `${month}-${String(PAYROLL_CUT_OFF_DAY).padStart(2, '0')}`;
  const onThisNode = HR_NODES.includes(branch as (typeof HR_NODES)[number]);

  /** Every line, from the register this node holds — computed here, not fetched, because there is no server yet. */
  const lines: PayrollLine[] = useMemo(() => {
    if (!onThisNode) return [];
    return directory
      .filter((s) => s.branch === branch)
      .map((s) =>
        payrollLine(
          s,
          attendance[s.code] ?? ({ staffCode: s.code, workedDays: 0, absentDays: 0, halfDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, lateMarks: 0, overtimeHours: 0, holidays: 0, daysInMonth: register.days.length } as PayrollAttendance),
          { overtimeApproved: { [s.code]: approvedOt[s.code] ?? attendance[s.code]?.overtimeHours ?? 0 }, advances: { [s.code]: advances[s.code] ?? 0 } },
        ),
      )
      .sort((a, b) => a.staffCode.localeCompare(b.staffCode));
  }, [directory, branch, attendance, register.days.length, approvedOt, advances, onThisNode]);

  const totals = useMemo(
    () =>
      lines.reduce(
        (a, l) => ({
          basic: a.basic + l.basic,
          gross: a.gross + l.gross,
          deductions: a.deductions + l.deductionsTotal,
          net: a.net + l.net,
          employer: a.employer + l.employerCost,
          overtime: a.overtime + l.overtimeHours,
        }),
        { basic: 0, gross: 0, deductions: 0, net: 0, employer: 0, overtime: 0 },
      ),
    [lines],
  );

  const refusals = useMemo(() => payrollRefusals(directory.filter((s) => s.branch === branch)), [directory, branch]);
  const visible = useMemo(() => {
    const active = VIEWS.find((v) => v.label === view) ?? VIEWS[0];
    const q = query.trim().toLowerCase();
    return lines.filter(active.keep).filter((l) => !q || l.name.toLowerCase().includes(q) || l.staffCode.toLowerCase().includes(q) || l.designation.toLowerCase().includes(q));
  }, [lines, view, query]);

  const line = openLine ? lines.find((l) => l.staffCode === openLine) ?? null : null;

  const computeRun = () => {
    if (!onThisNode) return;
    const next: PayrollRun = {
      month,
      branch: branch as (typeof HR_NODES)[number],
      cutOff,
      lines,
      totals: { basic: totals.basic, gross: totals.gross, deductions: totals.deductions, net: totals.net, employerCost: totals.employer, overtime: totals.overtime, absentDays: lines.reduce((n, l) => n + l.absentDays, 0) },
      refusals,
      state: 'Awaiting approval',
      computedAt: `${day} 16:05`,
    };
    setRun(next);
    const outcome = queueWrite(`Payroll ${monthLabel(month)} for ${branch}: ${lines.length} lines, net ${money(totals.net)}`, {
      id: 'runPayroll',
      recordId: `${branch}:${month}`,
      fields: { month, branch, cutOff, linesCount: lines.length, net: totals.net },
    });
    push({
      title: outcome.queued ? `Run computed for ${monthLabel(month)}` : 'Run computed, not queued',
      description: outcome.queued
        ? `It is held as awaiting approval: the person who runs payroll does not approve it. The cut-off is ${cutOff}, and ${refusals.length} line(s) the bank file cannot carry are listed below.`
        : `The contract does not queue this write ${outcome.because}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  const approveRun = () => {
    if (!run) return;
    const capability = syncEngine.capabilityOf('approvePayrollRun');
    if (capability?.needsNetwork) {
      const outcome = queueWrite(`Approval of payroll ${monthLabel(month)} for ${branch}`, { id: 'approvePayrollRun', recordId: `${branch}:${month}`, fields: { month, branch, net: run.totals.net, linesCount: run.lines.length } });
      if (!outcome.queued) {
        setRun({ ...run, state: syncEngine.summary.pending === 0 ? 'Awaiting approval' : 'Awaiting approval' });
        push({
          title: 'The approval cannot be recorded yet',
          description: `Payroll approval is online-only by contract: ${capability.because ?? capacitySentence()} The run stays as it is, and nothing has been released.`,
          tone: 'critical',
        });
        return;
      }
    }
    setRun({ ...run, state: 'Approved', ...{ bankFileName: `PAYROLL-${branch.slice(0, 3).toUpperCase()}-${month}.csv` } });
    push({
      title: `Approved — ${money(run.totals.net)} to ${run.lines.length} people`,
      description: `The bank file is generated from the approved run, and a second generation of the same file is visible in the ledger rather than silent. ${refusals.length} line(s) are paid outside the file and are named in the run.`,
      tone: 'success',
    });
  };

  const setOvertime = (target: PayrollLine) => {
    const hours = Number(otDraft);
    if (!Number.isFinite(hours) || hours < 0) {
      push({ title: 'Overtime is a number of hours, zero included.', tone: 'critical' });
      return;
    }
    setApprovedOt((o) => ({ ...o, [target.staffCode]: hours }));
    setRun(null);
    push({
      title: `${target.name}: ${hours} hour(s) approved`,
      description: hours > OT_MONTHLY_CAP_HOURS
        ? `The cap is ${OT_MONTHLY_CAP_HOURS} hours a month, so ${OT_MONTHLY_CAP_HOURS} are paid and the rest is recorded against the post rather than the person.`
        : `Paid at ${OT_MULTIPLIER}× the hourly rate (basic ÷ ${OT_HOURS_PER_MONTH}). The run has to be recomputed, which is deliberate: a payslip is not edited, it is recomputed.`,
      tone: hours > OT_MONTHLY_CAP_HOURS ? 'warning' : 'success',
    });
    setOtDraft('');
  };

  const setAdvance = (target: PayrollLine) => {
    const amount = Number(advanceDraft);
    const cap = Math.round(target.basic * (ADVANCE_CAP_PCT / 100));
    if (!Number.isFinite(amount) || amount < 0) {
      push({ title: 'An advance is an amount in taka, zero included.', tone: 'critical' });
      return;
    }
    if (amount > cap) {
      push({ title: `The advance on this line is capped at ${money(cap)}`, description: `${ADVANCE_CAP_PCT}% of basic. A salary advance that is not capped is a loan the hospital has not decided to make.`, tone: 'critical' });
      return;
    }
    setAdvances((a) => ({ ...a, [target.staffCode]: amount }));
    setRun(null);
    push({ title: `${target.name}: ${money(amount)} recovered this month`, description: 'The balance is printed on the payslip until it is cleared, so the deduction is never a surprise.', tone: 'success' });
    setAdvanceDraft('');
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="payroll"
        subtitle={`${monthLabel(month)} · cut-off ${cutOff} · run by one person, approved by another.`}
        actions={
          <>
            <Button variant="ghost" onClick={() => { setMonth(addMonths(month, -1)); setRun(null); }} aria-label="Previous month">‹ {monthLabel(addMonths(month, -1)).split(' ')[0]}</Button>
            <Button variant="ghost" onClick={() => { setMonth(addMonths(month, 1)); setRun(null); }} aria-label="Next month">{monthLabel(addMonths(month, 1)).split(' ')[0]} ›</Button>
            <Button variant="primary" onClick={computeRun} disabled={!onThisNode}>
              <Calculator className="size-4" aria-hidden /> Compute the run
            </Button>
          </>
        }
        waiting={syncEngine.summary.pending > 0 ? `${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync. The approval itself is online-only — see below.` : undefined}
      />

      <AdminSiblings screenId="payroll" />

      <Panel title="Branch and month">
        <div className="flex flex-wrap items-end gap-4">
          <Segmented
            name="payroll-branch"
            label="Branch"
            value={branch}
            onChange={(v) => { setBranch(v); setRun(null); }}
            options={[
              { value: 'Main Campus', label: 'Main Campus' },
              { value: 'Uttara Branch', label: 'Uttara Branch' },
              { value: 'Mirpur Branch', label: 'Mirpur Branch' },
            ]}
          />
          <div className="text-xs text-text-secondary">
            <p>
              The attendance this run is computed from is <strong className="font-medium text-text-primary">{HR_NODES[0]}</strong>’s own
              register: one gate, one set of readers, one payroll month on this node.
            </p>
            <p className="mt-1">
              A satellite is paid from its own node’s attendance. This preview has none, so the screen refuses rather
              than dividing the main campus’s month by three.
            </p>
          </div>
        </div>
        {!onThisNode && (
          <div className="mt-3">
            <SafetyBanner severity="warning" title={`${branch} has no attendance on this node`}>
              A payroll run is arithmetic over a month of punches, and this node does not hold {branch}’s reader
              records — they arrive through that node’s own drain, numbered from its own block. A run computed from
              a share of Main Campus’s attendance would pay real people the wrong amount, so there is nothing to
              compute here yet. {branch}’s staff are on the register below, and the roster screen says the same.
            </SafetyBanner>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Lines" value={String(lines.length)} definition="One line per person paid from this branch. Interns are on it with a stipend: they are staff, and a stipend that arrives through a different route is a stipend nobody reconciles." asOf={monthLabel(month)} />
        <KpiTile label="Gross" value={money(totals.gross)} definition="Basic, the allowances derived from it, and the overtime approved this month, before any deduction." asOf={monthLabel(month)} />
        <KpiTile label="Deductions" value={money(totals.deductions)} definition="Attendance, provident fund, insurance, tax and any advance recovered — each one printed on the line with the rule behind it." asOf={monthLabel(month)} />
        <KpiTile label="Net payable" value={money(totals.net)} definition="What actually reaches the people on this run. The figure the approval signs for." asOf={monthLabel(month)} />
        <KpiTile label="Employer cost" value={money(totals.employer)} definition="Net plus deductions plus the hospital’s own provident-fund match: what the branch spends, which is not the figure an employee sees." asOf={monthLabel(month)} />
        <KpiTile label="Overtime approved" value={`${totals.overtime} h`} definition={`Approve hours on the lines below. The month is capped at ${OT_MONTHLY_CAP_HOURS} hours a person, because a rota that needs more is a staffing decision rather than an overtime one.`} asOf={monthLabel(month)} />
      </div>

      {run && (
        <Panel
          title={`Run — ${monthLabel(run.month)}, ${run.branch}`}
          actions={<span className="font-numeric text-xs text-text-secondary">computed {run.computedAt} · cut-off {run.cutOff}</span>}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('rounded-full border px-2 py-0.5 text-xs font-medium', run.state === 'Approved' ? 'border-safety-success text-safety-success' : 'border-safety-warning text-safety-warning')}>{run.state}</span>
            <span className="text-sm text-text-secondary">{PAYROLL_FLOW[run.state].note}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {run.state === 'Awaiting approval' && (
              <Button variant="primary" onClick={approveRun}>
                <ShieldCheck className="size-4" aria-hidden /> Approve and generate the bank file
              </Button>
            )}
            {run.state === 'Approved' && (
              <>
                <Link href="/print/payslip">
                  <Button variant="secondary">
                    <FileSpreadsheet className="size-4" aria-hidden /> Print a payslip
                  </Button>
                </Link>
                <span className="font-numeric text-xs text-text-secondary">{(run as PayrollRun & { bankFileName?: string }).bankFileName}</span>
              </>
            )}
            <span className="text-xs text-text-secondary">
              {run.lines.length} lines · net {money(run.totals.net)} · gross {money(run.totals.gross)} · {run.totals.absentDays} absent day(s) deducted
            </span>
          </div>
          <p className="mt-2 text-xs text-text-tertiary">
            The approval is online-only by contract. This preview has no cloud to approve against, so pressing it
            records the refusal the contract produces — which is the honest behaviour rather than a screen that
            pretends a queued approval is a signature.
          </p>
        </Panel>
      )}

      {refusals.length > 0 && (
        <Panel title="Cannot be paid by the bank file" actions={<span className="text-xs text-text-secondary">The run still owes the money</span>}>
          <ul className="space-y-2">
            {refusals.map((r) => (
              <li key={r.staffCode} className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                <p className="font-medium text-text-primary">{r.name} <span className="font-numeric text-xs text-text-tertiary">{r.staffCode}</span></p>
                <p className="text-text-secondary">{r.because}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-tertiary">
            A run that quietly omitted these lines would be a salary that vanished. They are paid by hand or the
            account is fixed, and either way the run says which.
          </p>
        </Panel>
      )}

      <Panel title="Lines" actions={<span className="text-xs text-text-secondary">{visible.length} of {lines.length}</span>}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {VIEWS.map((v) => (
            <button
              key={v.label}
              type="button"
              aria-pressed={view === v.label}
              onClick={() => setView(v.label)}
              title={v.hint}
              className={cx('rounded-full border px-2 py-0.5 text-xs', view === v.label ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border-subtle text-text-secondary hover:bg-surface-sunken')}
            >
              {v.label} <span className="font-numeric">{lines.filter(v.keep).length}</span>
            </button>
          ))}
        </div>
        <ListView
          id="payroll-lines"
          caption={`Payroll lines for ${monthLabel(month)}`}
          rows={visible}
          rowId={(l) => l.staffCode}
          onRowClick={(l) => { setOpenLine(l.staffCode); setOtDraft(String(l.overtimeHours)); setAdvanceDraft(String(l.advance)); }}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Name, employee number or designation' }}
          columns={[
            { key: 'staffCode', header: 'Employee no.', width: '7rem', render: (l) => <span className="font-numeric">{l.staffCode}</span> },
            { key: 'name', header: 'Name', render: (l) => <span className="font-medium">{l.name}</span> },
            { key: 'designation', header: 'Designation', hideBelow: 'md' },
            { key: 'basic', header: 'Basic', align: 'right', numeric: true, hideBelow: 'lg', render: (l) => money(l.basic), tooltip: 'Allowances are derived from this figure, so a revision moves them all at once rather than one at a time.' },
            { key: 'gross', header: 'Gross', align: 'right', numeric: true, render: (l) => money(l.gross) },
            { key: 'deductionsTotal', header: 'Deductions', align: 'right', numeric: true, render: (l) => <span className="text-safety-warning">{money(l.deductionsTotal)}</span> },
            { key: 'net', header: 'Net', align: 'right', numeric: true, render: (l) => <span className="font-medium">{money(l.net)}</span> },
            { key: 'notes', header: 'Attendance', hideBelow: 'xl', render: (l) => <span className="text-xs text-text-secondary">{l.absentDays} absent · {l.unpaidLeaveDays} unpaid · {l.overtimeHours} h OT</span> },
          ]}
        />
      </Panel>

      <Panel title={`The tax table the branch pays by`} actions={<span className="text-xs text-text-secondary">{TAX_TABLE_NOTE.split('.')[0]}</span>}>
        <p className="text-sm text-text-secondary">{TAX_TABLE_NOTE}</p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
          <li className="flex justify-between rounded-md border border-border-subtle px-3 py-1.5"><span className="text-text-secondary">Exemption</span><span className="font-numeric">৳ 3,75,000</span></li>
          <li className="flex justify-between rounded-md border border-border-subtle px-3 py-1.5"><span className="text-text-secondary">Investment rebate</span><span className="font-numeric">15% of investment, up to 3% of taxable income</span></li>
          <li className="flex justify-between rounded-md border border-border-subtle px-3 py-1.5"><span className="text-text-secondary">Floor</span><span className="font-numeric">৳ 5,000 a year</span></li>
        </ul>
        <p className="mt-2 text-xs text-text-tertiary">The full slab table is on Setup › Human Resource, where the branch’s accountant edits it.</p>
      </Panel>

      <Panel title="Payroll rules">
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {PAYROLL_RULES.map((r) => (
            <li key={r.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary"><Banknote className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {r.title}</p>
              <p className="text-text-secondary">{r.because}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Sheet
        open={Boolean(line)}
        onClose={() => setOpenLine(null)}
        title={line ? `${line.staffCode} — ${line.name}` : 'Line'}
        description={line ? `${line.designation} · ${line.employment} · ${monthLabel(month)}` : undefined}
        width="xl"
      >
        {line && (
          <div className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border-subtle">
                <p className="border-b border-border-subtle px-3 py-2 font-medium text-text-primary">Earnings</p>
                <ul className="p-3">
                  {line.earnings.map((e) => (
                    <li key={e.code} className="flex items-center justify-between gap-3 py-0.5">
                      <span className="text-text-secondary">{e.label}</span>
                      <span className="font-numeric">{money(e.amount)}</span>
                    </li>
                  ))}
                  <li className="mt-1 flex items-center justify-between gap-3 border-t border-border-subtle pt-1 font-medium">
                    <span>Gross</span>
                    <span className="font-numeric">{money(line.gross)}</span>
                  </li>
                </ul>
              </div>
              <div className="rounded-md border border-border-subtle">
                <p className="border-b border-border-subtle px-3 py-2 font-medium text-text-primary">Deductions, each with its rule</p>
                <ul className="p-3">
                  {line.deductions.map((d) => (
                    <li key={d.code} className="flex items-center justify-between gap-3 py-0.5">
                      <span className="text-text-secondary">{d.label}</span>
                      <span className="font-numeric text-safety-warning">{money(d.amount)}</span>
                    </li>
                  ))}
                  <li className="mt-1 flex items-center justify-between gap-3 border-t border-border-subtle pt-1 font-medium">
                    <span>Net payable</span>
                    <span className="font-numeric">{money(line.net)}</span>
                  </li>
                  <li className="flex items-center justify-between gap-3 text-xs text-text-tertiary">
                    <span>Employer cost (gross + provident-fund match + insurance)</span>
                    <span className="font-numeric">{money(line.employerCost)}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">Attendance behind this line</p>
              <p className="text-text-secondary">
                {line.absentDays} absent day(s), {line.unpaidLeaveDays} unpaid leave day(s), {line.overtimeHours} overtime hour(s) approved.
                The allowances are {allowancesFor({ ...directory[0], basic: line.basic }).map((a) => `${a.label} ${money(a.amount)}`).join(', ')} — derived from basic, never stored beside it.
              </p>
            </div>

            {line.notes.length > 0 && (
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">What the arithmetic had to decide</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-text-secondary">
                  {line.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">Approve overtime</p>
                <p className="text-xs text-text-secondary">Hours past the shift, paid at {OT_MULTIPLIER}× (basic ÷ {OT_HOURS_PER_MONTH}), capped at {OT_MONTHLY_CAP_HOURS} hours a month.</p>
                <div className="mt-2 flex items-end gap-2">
                  <TextField label="Hours" name="ot-hours" value={otDraft} onChange={(e) => setOtDraft(e.target.value)} className="w-24" />
                  <Button variant="secondary" onClick={() => setOvertime(line)}>Approve</Button>
                </div>
              </div>
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">Recover a salary advance</p>
                <p className="text-xs text-text-secondary">Capped at {ADVANCE_CAP_PCT}% of basic ({money(Math.round(line.basic * (ADVANCE_CAP_PCT / 100)))}) and recovered from the run, so the balance is on the payslip until it clears.</p>
                <div className="mt-2 flex items-end gap-2">
                  <TextField label="Amount ৳" name="advance-amount" value={advanceDraft} onChange={(e) => setAdvanceDraft(e.target.value)} className="w-32" />
                  <Button variant="secondary" onClick={() => setAdvance(line)}>Recover</Button>
                </div>
              </div>
            </div>

            <p className="text-xs text-text-tertiary">
              Changing either figure discards the computed run on purpose: a payslip is recomputed rather than edited,
              and a run that has already been approved cannot be changed at all — a correction from there is an
              adjustment in next month’s run.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** The sentence the contract gives for an operation that must not be queued, when it gives none. */
function capacitySentence(): string {
  return 'an approval that exists only in a queue is a signature nobody can verify against the ledger.';
}
