'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Segmented, Sheet, TextField, SelectField, CheckboxField, cx, useToast } from '@dizi/ui';
import { BadgeCheck, IdCard, UserPlus } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import { useShell } from '@/lib/shell';
import {
  DEPARTMENTS,
  EMPLOYMENTS,
  GRADES,
  NOTICE_DAYS,
  PROBATION_MONTHS,
  STAFF_STATUSES,
  departmentName,
  entitlement,
  gradeByCode,
  hrStats,
  leaveBalance,
  leaveTypeByCode,
  licenceDaysLeft,
  onProbation,
  probationEnds,
  staffDirectory,
  type Employment,
  type HrStaff,
  type StaffStatus,
} from '@/lib/hr';
import { HR_NODES } from '@/lib/attendance';

/* Human Resource — the staff register (P7).
 *
 * The legacy screen was a list with an edit button and no rule about what a staff record contains, which is how
 * the ward roster, the attendance reader and the payroll file ended up disagreeing by a name every month. The new
 * screen is seven fields — the seven the roster, the gate and the bank file all resolve back to — and one rule:
 * an employee number is an identity, so a correction changes a field and never the number.
 *
 * The directory is derived from the ward roster the rest of the product already reads, so the people on this
 * screen are the people on the duty board. Everything the record cannot yet do — a licence that is about to
 * lapse, a bank account nobody has verified — is on the row rather than in a report somebody reads quarterly.
 */

const VIEWS: Array<{ label: string; keep: (s: HrStaff) => boolean; hint: string }> = [
  { label: 'Everything', keep: () => true, hint: 'Every member of staff on the register, clinical and office, in employee-number order.' },
  { label: 'Clinical', keep: (s) => Boolean(s.wardId) || s.departmentId === 'nursing', hint: 'The people the roster and the ward board are built from — the ones a duty cannot be left unfilled for.' },
  { label: 'On probation', keep: (s) => onProbation(s, '2026-10-14'), hint: `Joined within the last ${PROBATION_MONTHS} months: no earned leave yet, and the confirmation letter is still to be written.` },
  { label: 'Licence expiring', keep: (s) => { const left = licenceDaysLeft(s, '2026-10-14'); return left !== null && left <= 120; }, hint: 'A clinical registration ending within four months. The reader refuses the duty punch the day it lapses, so this list is the roster’s warning.' },
  { label: 'Bank unverified', keep: (s) => Boolean(s.bank && !s.bank.verified), hint: 'The payroll file cannot carry these lines, so the run names them and the money is paid by hand until the account is checked against a document.' },
  { label: 'On leave now', keep: (s) => Boolean(s.onLeave), hint: 'Where the roster has them today. The leave register is where the days came from.' },
];

const STATUS_TONE: Record<StaffStatus, string> = {
  Active: 'text-safety-success',
  'On leave': 'text-safety-info',
  Suspended: 'text-safety-critical',
  Resigned: 'text-text-tertiary',
  Retired: 'text-text-tertiary',
};

export default function StaffRegisterPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const directory = useMemo(() => staffDirectory(day), [day]);
  const stats = useMemo(() => hrStats(directory, day), [directory, day]);

  const [added, setAdded] = useState<HrStaff[]>([]);
  const [corrected, setCorrected] = useState<Record<string, Partial<HrStaff>>>({});
  const [view, setView] = useState('Everything');
  const [department, setDepartment] = useState('every');
  const [employment, setEmployment] = useState('every');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [draft, setDraft] = useState<{ name: string; designation: string; departmentId: string; employment: Employment; phone: string; joined: string; gradeCode: string }>({
    name: '',
    designation: '',
    departmentId: 'nursing',
    employment: 'Permanent',
    phone: '',
    joined: day,
    gradeCode: 'G-04',
  });

  const rows = useMemo(() => {
    const merged = [...added, ...directory].map((s) => ({ ...s, ...(corrected[s.code] ?? {}) }));
    const active = VIEWS.find((v) => v.label === view) ?? VIEWS[0];
    const q = query.trim().toLowerCase();
    return merged
      .filter(active.keep)
      .filter((s) => department === 'every' || s.departmentId === department)
      .filter((s) => employment === 'every' || s.employment === employment)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.designation.toLowerCase().includes(q) || s.phone.includes(q))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [added, directory, corrected, view, department, employment, query]);

  const staff = selected ? rows.find((s) => s.code === selected) ?? null : null;
  const activeView = VIEWS.find((v) => v.label === view) ?? VIEWS[0];
  const dropped = useMemo(() => {
    const merged = [...added, ...directory].map((s) => ({ ...s, ...(corrected[s.code] ?? {}) }));
    return merged.filter((s) => !activeView.keep(s)).length;
  }, [added, directory, corrected, activeView]);

  const addStaff = () => {
    if (!draft.name.trim() || !draft.designation.trim()) {
      push({ title: 'A staff record needs a name and a designation.', description: 'The designation is what the roster fills a duty with and what the payroll pays against.', tone: 'critical' });
      return;
    }
    if (draft.phone.replace(/\D/g, '').length !== 11) {
      push({ title: 'A mobile number is eleven digits.', description: 'It is the number the roster calls at 05:50 to cover a night shift, so a typo here is a shift nobody fills.', tone: 'critical' });
      return;
    }
    const grade = gradeByCode(draft.gradeCode);
    const nextCode = `EMP-${String(Math.max(...[...directory, ...added].map((s) => Number(s.code.slice(4)))) + 1).padStart(4, '0')}`;
    const record: HrStaff = {
      id: `emp-new-${added.length + 1}`,
      code: nextCode,
      name: draft.name.trim(),
      role: draft.designation.trim(),
      departmentId: draft.departmentId,
      designation: draft.designation.trim(),
      gradeCode: draft.gradeCode,
      branch: 'Main Campus',
      phone: draft.phone.trim(),
      joined: draft.joined,
      employment: draft.employment,
      status: 'Active',
      basic: grade?.basic ?? 24_000,
      bank: { bank: 'Not on the record yet', masked: '—', verified: false },
      competencies: [],
      weekHours: 0,
      nightsInARow: 0,
    };
    setAdded((list) => [record, ...list]);
    setAddOpen(false);
    setDraft({ ...draft, name: '', designation: '', phone: '' });
    const outcome = queueWrite(`Staff record ${record.code}: ${record.name} — ${record.designation}`, {
      id: 'createStaffRecord',
      recordId: record.code,
      fields: { code: record.code, name: record.name, designation: record.designation, department: record.departmentId, employment: record.employment, joined: record.joined },
    });
    push({
      title: outcome.queued ? `${record.code} recorded on this device` : `${record.code} recorded, not queued`,
      description: outcome.queued
        ? `The employee number comes from this node’s own block, so the record is complete now and the cloud gets it when the uplink does.${syncEngine.summary.pending > 0 ? ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} in the queue.` : ''}`
        : `The contract does not queue this write ${outcome.because}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  const correctPhone = (target: HrStaff) => {
    if (!reason.trim()) {
      push({ title: 'A correction needs a reason.', description: 'It goes into the audit entry, and it is the sentence somebody reads when the number turns out to be wrong.', tone: 'critical' });
      return;
    }
    const digits = phoneDraft.replace(/\D/g, '');
    if (digits.length !== 11) {
      push({ title: 'A mobile number is eleven digits.', tone: 'critical' });
      return;
    }
    setCorrected((c) => ({ ...c, [target.code]: { ...(c[target.code] ?? {}), phone: phoneDraft.trim() } }));
    const outcome = queueWrite(`Corrected ${target.code} (${target.name}): mobile number`, {
      id: 'updateStaffRecord',
      recordId: target.code,
      fields: { phone: phoneDraft.trim(), reason: reason.trim(), version: 4 },
    });
    push({
      title: outcome.queued ? 'Correction queued' : 'Correction recorded',
      description: 'The employee number did not change: payslips, the roster and eight years of service records point at it.',
      tone: outcome.queued ? 'success' : 'warning',
    });
    setReason('');
    setPhoneDraft('');
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="human-resource"
        actions={
          <>
            <Link href="/admin/staff/attendance">
              <Button variant="ghost">Attendance register</Button>
            </Link>
            <Link href="/admin/payroll">
              <Button variant="ghost">Payroll</Button>
            </Link>
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <UserPlus className="size-4" aria-hidden /> Add a staff member
            </Button>
          </>
        }
      />

      <AdminSiblings screenId="human-resource" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="On the register" value={String(rows.length)} definition={`${directory.length} records on this node's register${added.length ? ` plus ${added.length} added on this screen` : ''}, after the filters above.`} asOf={day} footnote={dropped > 0 ? `${dropped} hidden by “${activeView.label}”` : undefined} />
        <KpiTile label="Clinical" value={String(stats.clinical)} definition="Doctors, nurses, midwives and technologists — the people a duty roster is built from and a licence is checked for." asOf={day} />
        <KpiTile label="On leave today" value={String(stats.onLeave)} definition="Where the leave register has them, and the same figure the roster's coverage table reads." asOf={day} />
        <KpiTile label="Licences expiring" value={String(stats.licencesExpiring)} definition="Within four months. The attendance reader refuses the duty punch the day a registration lapses, so this is the warning, not the rule." asOf={day} />
        <KpiTile label="Bank unverified" value={String(stats.unverifiedBank)} definition="The payroll file cannot carry a line with an unverified account: one mistyped digit and a month’s salary is in a stranger’s account." asOf={day} />
        <KpiTile label="Monthly basic" value={money(stats.monthlyBasic)} definition="Basic pay across the register, before allowances. Allowances are derived from it, so this is the figure a revision moves." asOf={day} />
      </div>

      <Panel title="Filters">
        <div className="flex flex-wrap items-end gap-3">
          <Segmented name="staff-view" label="View" value={view} onChange={setView} options={VIEWS.map((v) => ({ value: v.label, label: v.label }))} />
          <SelectField label="Department" name="staff-department" value={department} onChange={(e) => setDepartment(e.target.value)} options={[{ value: 'every', label: 'Every department' }, ...DEPARTMENTS.map((d) => ({ value: d.id, label: d.name }))]} className="w-56" />
          <SelectField label="Employment" name="staff-employment" value={employment} onChange={(e) => setEmployment(e.target.value)} options={[{ value: 'every', label: 'Every kind' }, ...EMPLOYMENTS.map((e) => ({ value: e, label: e }))]} className="w-44" />
          <SelectField label="Branch" name="staff-branch" value="Main Campus" onChange={() => undefined} options={HR_NODES.map((b) => ({ value: b, label: b }))} hint="The registers on this node are this branch’s." className="w-44" />
        </div>
        <p className="mt-2 text-xs text-text-secondary">{activeView.hint}</p>
      </Panel>

      <ListView
        id="staff-register"
        caption="Staff register"
        rows={rows}
        rowId={(s) => s.code}
        onRowClick={(s) => { setSelected(s.code); setPhoneDraft(s.phone); }}
        quickSearch={{ value: query, onChange: setQuery, placeholder: 'Name, employee number, designation or phone' }}
        columns={[
          { key: 'code', header: 'Employee no.', width: '7rem', tooltip: 'One series, never reused. Payslips, the roster and the service record all point at it, so a correction never changes it.', render: (s) => <span className="font-numeric">{s.code}</span> },
          { key: 'name', header: 'Name', render: (s) => <span className="font-medium">{s.name}</span> },
          { key: 'designation', header: 'Designation' },
          { key: 'departmentId', header: 'Department', hideBelow: 'md', render: (s) => departmentName(s.departmentId), tooltip: 'Decides the cost centre the payroll posts to and which manager approves the leave.' },
          { key: 'basic', header: 'Grade & basic', align: 'right', numeric: true, hideBelow: 'lg', render: (s) => `${s.gradeCode} · ${money(s.basic)}`, tooltip: 'Basic pay. House rent, medical and dearness are percentages of it, so a revision is one grade table rather than forty records.' },
          { key: 'phone', header: 'Mobile', render: (s) => <span className="font-numeric">{s.phone}</span> },
          { key: 'status', header: 'Status', render: (s) => <span className={cx('font-medium', STATUS_TONE[s.status])}>{s.status}</span> },
        ]}
      />

      <Panel title="Six rules this register keeps" actions={<span className="text-xs text-text-secondary">The legacy screen had none of them</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          <li><span className="font-medium text-text-primary">One employee number, never reused.</span> <span className="text-text-secondary">The payroll file is paid against it, so a correction changes a field and never the identity.</span></li>
          <li><span className="font-medium text-text-primary">Pay is a grade, not a number typed at the desk.</span> <span className="text-text-secondary">Two people with one designation cannot be paid from two different tables by accident.</span></li>
          <li><span className="font-medium text-text-primary">A clinical designation carries a licence and an expiry.</span> <span className="text-text-secondary">The reader refuses the duty punch the day it lapses — the register does not record a duty the branch may not staff.</span></li>
          <li><span className="font-medium text-text-primary">A bank account is verified against a document.</span> <span className="text-text-secondary">Until it is, the payroll names the line and the money is paid by hand rather than into an account nobody has checked.</span></li>
          <li><span className="font-medium text-text-primary">Probation is a date, not a word.</span> <span className="text-text-secondary">{PROBATION_MONTHS} months, computed from the joining date, and it is what gates earned leave.</span></li>
          <li><span className="font-medium text-text-primary">Leaving service needs notice.</span> <span className="text-text-secondary">{NOTICE_DAYS} days, and the final settlement is a voucher of its own rather than a last payroll line.</span></li>
        </ul>
      </Panel>

      {/* ---------------------------------------------------------------------------------------------- add sheet */}
      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a staff member"
        description="Seven fields: the seven the roster, the gate and the payroll file resolve back to."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={addStaff}>Record and queue</Button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <TextField label="Full name" name="staff-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} hint="As it appears on the duty roster and the payslip." required />
          <TextField label="Designation" name="staff-designation" value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} hint="What the person is employed as. The roster fills a duty with a designation, not a name." required />
          <SelectField label="Department" name="staff-department-new" value={draft.departmentId} onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })} options={DEPARTMENTS.map((d) => ({ value: d.id, label: d.name }))} hint="Sets the cost centre and the manager who approves leave." />
          <SelectField label="Grade" name="staff-grade" value={draft.gradeCode} onChange={(e) => setDraft({ ...draft, gradeCode: e.target.value })} options={GRADES.map((g) => ({ value: g.code, label: `${g.code} — ${g.label} · ${money(g.basic)}` }))} hint="Pay comes from the grade table rather than from this form." />
          <SelectField label="Employment" name="staff-employment-new" value={draft.employment} onChange={(e) => setDraft({ ...draft, employment: e.target.value as Employment })} options={EMPLOYMENTS.map((e) => ({ value: e, label: e }))} hint="Interns and part-timers accrue leave at half rate; outsourced staff get the unpaid types only." />
          <TextField label="Mobile" name="staff-phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="01711 223344" hint="Eleven digits. It is the number the roster calls to cover a night shift." required />
          <TextField label="Joined" name="staff-joined" type="date" value={draft.joined} onChange={(e) => setDraft({ ...draft, joined: e.target.value })} hint={`Probation ends ${probationEnds(draft.joined)}; earned leave starts then.`} />
          <div className="md:col-span-2">
            <SafetyBanner severity="info" title="What happens to this record">
              It is written here and queued through the contract as <span className="font-numeric">createStaffRecord</span> with an
              idempotency key, so a drain that runs twice records one person. The bank account stays unverified until HR checks
              it against a document, and the payroll will name the line until then.
            </SafetyBanner>
          </div>
        </div>
      </Sheet>

      {/* ----------------------------------------------------------------------------------------------- record */}
      <Sheet
        open={Boolean(staff)}
        onClose={() => setSelected(null)}
        title={staff ? `${staff.code} — ${staff.name}` : 'Record'}
        description={staff ? `${staff.designation} · ${departmentName(staff.departmentId)} · ${staff.branch}` : undefined}
        width="xl"
        footer={
          staff && (
            <div className="flex flex-wrap justify-end gap-2">
              <Link href="/admin/staff/attendance">
                <Button variant="ghost">Attendance register</Button>
              </Link>
              <Link href="/admin/payroll">
                <Button variant="ghost">Payroll</Button>
              </Link>
            </div>
          )
        }
      >
        {staff && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-text-secondary">Designation & grade</dt>
                <dd className="font-medium">{staff.designation} <span className="font-numeric text-text-tertiary">{staff.gradeCode}</span></dd>
              </div>
              <div>
                <dt className="text-xs text-text-secondary">Employment</dt>
                <dd className="font-medium">{staff.employment} · joined {staff.joined}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-secondary">Probation</dt>
                <dd className={cx('font-medium', onProbation(staff, day) ? 'text-safety-warning' : 'text-text-primary')}>
                  {onProbation(staff, day) ? `Ends ${probationEnds(staff.joined)}` : `Complete since ${probationEnds(staff.joined)}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-secondary">Basic pay</dt>
                <dd className="font-medium">{money(staff.basic)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-secondary">Bank</dt>
                <dd className={cx('font-medium', staff.bank?.verified ? 'text-text-primary' : 'text-safety-warning')}>
                  {staff.bank ? `${staff.bank.bank} ${staff.bank.masked}` : 'Not on the record'}
                  <span className="ml-1 text-xs text-text-tertiary">{staff.bank?.verified ? 'verified' : 'unverified — the bank file will skip this line'}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-secondary">Licence</dt>
                <dd className={cx('font-medium', (licenceDaysLeft(staff, day) ?? 999) <= 120 ? 'text-safety-warning' : 'text-text-primary')}>
                  {staff.licence ? `${staff.licence.kind} · ${staff.licence.no}` : 'Not a licensed designation'}
                  {staff.licence && <span className="ml-1 text-xs text-text-tertiary">expires {staff.licence.expires}</span>}
                </dd>
              </div>
            </dl>

            <div>
              <p className="flex items-center gap-1.5 text-xs text-text-secondary"><IdCard className="size-3.5" aria-hidden /> Leave balances this year</p>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {['CAS', 'SICK', 'EARN', 'MAT', 'LWP'].map((code) => {
                  const type = leaveTypeByCode(code);
                  const balance = leaveBalance(staff, code, [], day.slice(0, 4));
                  if (!type) return null;
                  return (
                    <li key={code} className="flex justify-between rounded-md border border-border-subtle px-3 py-1.5">
                      <span className="text-text-secondary">{type.label}</span>
                      <span className="font-medium tabular-nums">
                        {balance.left} <span className="text-xs text-text-tertiary">of {entitlement(staff, type, day.slice(0, 4))}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-xs text-text-tertiary">
                Entitlement is pro-rated for an intern, a part-timer or an outsourced member of staff — the register states the
                number it will grant rather than leaving a supervisor to guess.
              </p>
            </div>

            {staff.competencies.length > 0 && (
              <div>
                <p className="flex items-center gap-1.5 text-xs text-text-secondary"><BadgeCheck className="size-3.5" aria-hidden /> Competencies the roster checks a shift against</p>
                <p className="mt-1 text-text-primary">{staff.competencies.join(' · ')}</p>
                <p className="text-xs text-text-tertiary">
                  A shift with a controlled-drug cupboard needs somebody who can witness; the HDU needs current ACLS. If nobody on
                  the shift has it, the shift is short a skill rather than a body.
                </p>
              </div>
            )}

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">Correct the mobile number</p>
              <p className="text-xs text-text-secondary">A correction states where it came from. The employee number, the designation and the grade are not editable here — those go through HR’s own confirmation, with the reason.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <TextField label="New mobile" name="staff-phone-fix" value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} />
                <TextField label="Why" name="staff-phone-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The number changed; the person reported it at HR on 12 October" />
              </div>
              <div className="mt-2 flex justify-end">
                <Button variant="secondary" onClick={() => correctPhone(staff)}>Queue the correction</Button>
              </div>
            </div>

            <CheckboxField label="Send the payslip to this number by SMS" name="staff-sms" hint="Off by default: a payslip carries a person’s salary, and a shared phone in a ward office is not private." />
          </div>
        )}
      </Sheet>
    </div>
  );
}
