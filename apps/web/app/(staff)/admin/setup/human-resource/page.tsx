'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, Panel, SelectField, Sheet, TextField, cx, useToast } from '@dizi/ui';
import { Calculator, Percent, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { SettingScreenView } from '@/components/SettingScreenView';
import { useShell } from '@/lib/shell';
import { settingByKey } from '@/lib/admin';
import { money } from '@/lib/billing';
import { WARDS } from '@/lib/ward';
import {
  ALLOWANCE_RATES,
  ADVANCE_CAP_PCT,
  GROUP_INSURANCE,
  INVESTMENT_REBATE_CAP_PCT,
  INVESTMENT_REBATE_RATE,
  LATE_MARKS_PER_HALF_DAY,
  LEAVE_COVER,
  LEAVE_RULES,
  LEAVE_TYPES,
  MINIMUM_TAX_ANNUAL,
  OT_HOURS_PER_MONTH,
  OT_MONTHLY_CAP_HOURS,
  OT_MULTIPLIER,
  PAYROLL_CUT_OFF_DAY,
  PF_CAP_BASIC,
  PF_RATE,
  TAX_SLABS,
  TAX_TABLE_NOTE,
  taxFor,
  type LeaveType,
} from '@/lib/hr';

/* Setup › Human Resource (P7) — what the register grants and what the payroll pays by.
 *
 * Two tables decide almost every question HR is asked. The leave types decide what a person may take and what it
 * costs the month; the tax table decides what is left after that. Both are the branch's own, both are printed on
 * the payslip, and neither is invented by the software — the screen shows the table it applies, next to the table
 * it loaded, which is the only way an accountant can check a month.
 *
 * The illustration is worked from the live slabs, so an administrator changing the table sees the monthly
 * consequence on a real figure before they save it.
 */

export default function SetupHumanResourcePage() {
  const setting = settingByKey('hr.leave-types');
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [edit, setEdit] = useState<LeaveType | null>(null);
  const [showTax, setShowTax] = useState(false);
  const [draft, setDraft] = useState({ days: 0, paid: true, certificateAfter: 0, maxConsecutive: 0, noticeDays: 0, note: '' });

  const illustration = useMemo(() => {
    const basic = 73_500; // S. Rahman's basic, the figure the payroll screens show
    // basic + house rent 50% + medical 10% + conveyance + dearness 5% + tiffin, which is the gross the payroll screens show
    const monthlyTaxable = basic + Math.round(basic * 0.5) + Math.round(basic * 0.1) + 2_200 + Math.round(basic * 0.05) + 1_500;
    const annual = monthlyTaxable * 12;
    const withRebate = taxFor(annual, 0);
    return { basic, monthlyTaxable, annual, tax: withRebate };
  }, []);

  const save = () => {
    if (!edit) return;
    if (draft.days <= 0) {
      push({ title: 'A leave type needs days against it', description: 'An entitlement of zero is a type that exists in the dropdown and grants nothing, which is how a person is refused at the desk and shown a rule.', tone: 'critical' });
      return;
    }
    const outcome = queueWrite(`Leave type ${edit.code}: ${draft.days} day(s), ${draft.paid ? 'paid' : 'unpaid'}, ${draft.noticeDays} day(s) notice, ${draft.maxConsecutive} at a time`, {
      id: 'savePlatformSetting',
      recordId: 'hr.leave-types',
      fields: { key: 'hr.leave-types', scope: 'hospital-wide', code: edit.code, days: draft.days, paid: draft.paid ? 'yes' : 'no', noticeDays: draft.noticeDays, maxConsecutive: draft.maxConsecutive, certificateAfter: draft.certificateAfter },
    });
    setEdit(null);
    push({
      title: outcome.queued ? `${edit.label} updated` : `${edit.label} not saved on this device`,
      description: outcome.queued
        ? 'The leave register, the roster and the payslip all read this table. It is queued and every one of them sees it when the queue drains.'
        : `An entitlement is hospital-wide${outcome.because ? ` and this write is online-only: ${outcome.because}` : ''}.`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="setup-human-resource"
        subtitle="The leave the register grants, what each type costs the payroll, and the tax table the branch pays by."
        actions={
          <>
            <Link href="/admin/staff/attendance">
              <Button variant="ghost">Attendance register</Button>
            </Link>
            <Link href="/admin/payroll">
              <Button variant="ghost">Payroll</Button>
            </Link>
            <Button variant="primary" onClick={() => setShowTax(true)}>
              <Calculator className="size-4" aria-hidden /> Show the tax table
            </Button>
          </>
        }
      />

      <AdminSiblings screenId="setup-human-resource" />

      <Panel title="Leave types" actions={<span className="text-xs text-text-secondary">{LEAVE_TYPES.length} types · entitlement is granted here, not negotiated at the desk</span>}>
        <ListView
          id="leave-types"
          caption="Leave types and what they grant"
          rows={LEAVE_TYPES}
          rowId={(t) => t.code}
          onRowClick={(t) => { setEdit(t); setDraft({ days: t.days, paid: t.paid, certificateAfter: t.certificateAfter ?? 0, maxConsecutive: t.maxConsecutive, noticeDays: t.noticeDays, note: t.note }); }}
          emptyLabel="No leave types are configured."
          columns={[
            { key: 'code', header: 'Code', width: '8rem', render: (t) => <span className="font-numeric">{t.code}</span> },
            { key: 'label', header: 'Type', render: (t) => <span className="font-medium">{t.label}</span> },
            { key: 'days', header: 'Days a year', width: '9rem', align: 'right', numeric: true },
            { key: 'paid', header: 'Paid', width: '7rem', render: (t) => <span className={cx(t.paid ? 'text-safety-success' : 'text-safety-warning')}>{t.paid ? 'paid' : 'unpaid'}</span> },
            { key: 'noticeDays', header: 'Notice', width: '8rem', hideBelow: 'md', render: (t) => (t.noticeDays > 0 ? `${t.noticeDays} day(s)` : 'same day') },
            { key: 'maxConsecutive', header: 'At a time', width: '8rem', hideBelow: 'lg', render: (t) => `${t.maxConsecutive} day(s)` },
            { key: 'certificateAfter', header: 'Certificate after', width: '11rem', hideBelow: 'lg', render: (t) => (t.certificateAfter === null ? 'always' : t.certificateAfter > 0 ? `${t.certificateAfter} day(s)` : 'not needed') },
            { key: 'appliesTo', header: 'Who may apply', width: '9rem', hideBelow: 'lg' },
            { key: 'note', header: 'Why it exists', hideBelow: 'lg', render: (t) => <span className="text-text-secondary">{t.note}</span> },
          ]}
        />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="What the payroll pays by" actions={<span className="text-xs text-text-secondary">the branch’s own table</span>}>
          <ul className="space-y-1 text-sm">
            {ALLOWANCE_RATES.map((a) => (
              <li key={a.code} className="flex items-baseline justify-between gap-2 border-b border-border-subtle/60 py-1">
                <span>
                  <span className="font-medium text-text-primary">{a.label}</span>
                  <span className="block text-xs text-text-tertiary">{a.note}</span>
                </span>
                <span className="font-numeric whitespace-nowrap">{a.kind === 'pct' ? `${a.value}% of basic` : money(a.value)}</span>
              </li>
            ))}
            {[
              ['Provident fund', `${PF_RATE * 100}% of basic, capped at ${money(PF_CAP_BASIC)}, matched by the hospital`],
              ['Group insurance', `${money(GROUP_INSURANCE)} a month, paid by the hospital on every permanent member of staff`],
              ['Overtime', `${OT_MULTIPLIER}× the hourly rate, ${OT_HOURS_PER_MONTH} hours a month is the divisor, capped at ${OT_MONTHLY_CAP_HOURS} hours`],
              ['Late marks', `${LATE_MARKS_PER_HALF_DAY} marks make a half day; the register counts the minutes and the payroll counts the marks`],
              ['Salary advance', `up to ${ADVANCE_CAP_PCT}% of basic, recovered in the following runs`],
              ['Cut-off', `the day-${PAYROLL_CUT_OFF_DAY} of the month; the run covers a full month’s attendance`],
            ].map(([label, because]) => (
              <li key={label} className="flex items-baseline justify-between gap-2 border-b border-border-subtle/60 py-1">
                <span className="font-medium text-text-primary">{label}</span>
                <span className="text-xs text-text-secondary">{because}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="The tax table, applied to a real figure" actions={<Percent className="size-4 text-text-tertiary" aria-hidden />}>
          <p className="text-sm text-text-secondary">
            {TAX_TABLE_NOTE} Worked on a <span className="font-numeric">{money(illustration.basic)}</span> basic — the consultant line the payroll screens show:
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            {[
              ['Basic, monthly', money(illustration.basic)],
              ['Gross, monthly', money(illustration.monthlyTaxable)],
              ['Taxable, annual', money(illustration.annual)],
              ['Tax for the year', money(illustration.tax.tax)],
              ['Investment rebate', `${money(illustration.tax.rebate)} at ${INVESTMENT_REBATE_RATE * 100}%, capped at ${INVESTMENT_REBATE_CAP_PCT}% of taxable income`],
              ['Tax after rebate', money(illustration.tax.afterRebate)],
              ['Withheld each month', money(illustration.tax.monthly)],
              ['Marginal rate', `${illustration.tax.marginal}%`],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-xs text-text-secondary">{label}</dt>
                <dd className="font-numeric font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-text-tertiary">
            The annual floor is {money(MINIMUM_TAX_ANNUAL)}: below the slabs a branch still owes its minimum tax, and a payslip that shows zero for a taxable salary is one the accountant will be asked about.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Cover: how many people may be away at once" actions={<span className="text-xs text-text-secondary">{WARDS.length} wards</span>}>
          <ul className="space-y-2 text-sm">
            {WARDS.map((ward) => (
              <li key={ward.id} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">{ward.name}</p>
                <p className="text-text-secondary">
                  {LEAVE_COVER.limitForWard(ward.id)} of the ward may be away at once, against a ratio of {ward.nurseRatio} over {ward.beds} beds.
                  {ward.id === 'hdu' ? ' One: two nurses out of a six-bed high-dependency unit is a unit that cannot take a deteriorating patient.' : ''}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-tertiary">
            The limit is derived from the ward rather than typed here. A number typed into a settings field is a number that drifts from the ward it describes.
          </p>
        </Panel>

        <Panel title="What the leave register refuses" actions={<span className="text-xs text-text-secondary">{LEAVE_RULES.length} rules</span>}>
          <ul className="space-y-2 text-sm">
            {LEAVE_RULES.map((rule) => (
              <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="flex items-start gap-1.5 font-medium text-text-primary">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}
                </p>
                <p className="text-text-secondary">{rule.because}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {setting && <SettingScreenView screen={setting} />}

      <Sheet
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={edit ? `Leave type — ${edit.label}` : 'Leave type'}
        description={edit ? `${edit.code} · what the register grants and what the payroll owes for it.` : undefined}
        width="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={draft.days <= 0}>Save the entitlement</Button>
          </div>
        }
      >
        {edit && (
          <div className="space-y-3">
            <FieldSection title="The entitlement" description="Applies to every branch, because a person carries their leave with them.">
              <TextField label="Days a year" name="leave-days" type="number" value={String(draft.days)} onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })} hint={`${edit.label} as the branch grants it. The balance on each person’s record is computed from this number.`} />
              <SelectField label="Paid" name="leave-paid" value={draft.paid ? 'yes' : 'no'} onChange={(e) => setDraft({ ...draft, paid: e.target.value === 'yes' })} options={[{ value: 'yes', label: 'Paid at the full month’s salary' }, { value: 'no', label: 'Unpaid — the day is deducted' }]} hint="Unpaid leave is what the register calls LWP, and the payroll deducts the day rate for each one." />
              <TextField label="Notice in days" name="leave-notice" type="number" value={String(draft.noticeDays)} onChange={(e) => setDraft({ ...draft, noticeDays: Number(e.target.value) })} hint="How far ahead the application must be made. Sick leave is the exception: nobody plans a fever, so it is applied for on the day." />
              <TextField label="Longest at a time" name="leave-max" type="number" value={String(draft.maxConsecutive)} onChange={(e) => setDraft({ ...draft, maxConsecutive: Number(e.target.value) })} hint="A cap on one absence. It is also the length of the notice the roster gets, which is why the two numbers are kept beside each other." />
              <TextField label="Certificate after (days)" name="leave-cert" type="number" value={String(draft.certificateAfter)} onChange={(e) => setDraft({ ...draft, certificateAfter: Number(e.target.value) })} hint="Zero means never needed. Over two days, sick leave needs a certificate: not because anybody is doubted, but because the payroll file cannot pay an uncertified absence." />
              <TextField label="Note" name="leave-note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} hint="Why the type exists, and what it must not become." />
            </FieldSection>
            <Panel title="What changing this does">
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>· Every person’s balance is recomputed from this number, and a balance that goes down is a balance somebody has already spent.</li>
                <li>· Applications already approved are not recalculated: they were approved against the entitlement in force that day.</li>
                <li>· {draft.paid ? 'Paid leave is what the payroll’s attendance column treats the same as a worked day.' : 'Unpaid leave is deducted at the day rate and shown as a line on the payslip rather than as a smaller basic.'}</li>
                <li>· Applications already applied for keep the notice they were made under: the register does not retro-fit a rule to a request somebody has already sent.</li>
                <li>· {draft.paid ? 'The balance is computed from the entitlement on each person’s record and shown on the payslip so it can be checked.' : 'Unpaid days are taken out of the gross rather than out of the entitlement, which is why the payroll counts them separately.'}</li>
                <li>· Cover rules are not changed here: each ward has its own limit, and the leave register refuses against it.</li>
              </ul>
            </Panel>
          </div>
        )}
      </Sheet>

      <Sheet open={showTax} onClose={() => setShowTax(false)} title="The tax table as the payroll applies it" description="Loaded into Setup › Human Resource, printed on every payslip, and applied in this order." width="md">
        <div className="space-y-3 text-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                <th className="py-1">Taxable income a year</th>
                <th className="py-1 text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {TAX_SLABS.map((slab, i) => (
                <tr key={i} className="border-b border-border-subtle/60">
                  <td className="py-1 font-numeric">{slab.upTo === Infinity ? 'above the last band' : `up to ${money(slab.upTo)}`}</td>
                  <td className="py-1 text-right font-numeric">{slab.rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-1 text-text-secondary">
            <li>· The investment rebate is {INVESTMENT_REBATE_RATE * 100}% of what the person actually invested, capped at {INVESTMENT_REBATE_CAP_PCT}% of taxable income.</li>
            <li>· The annual floor is {money(MINIMUM_TAX_ANNUAL)}: the payroll applies it after the rebate, never before.</li>
            <li>· Withholding is monthly and even: a person who leaves in June is settled at the year-end rate rather than at the rate their last month happened to fall in.</li>
            <li>· The slabs are the branch’s table and not the software’s opinion. A finance act that changes them is a row changed here, printed on the next payslip.</li>
          </ul>
        </div>
      </Sheet>
    </div>
  );
}
