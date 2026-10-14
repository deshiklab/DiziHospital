'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  EmptyState,
  KpiTile,
  Panel,
  Sheet,
  Tabs,
  cx,
  useToast,
} from '@dizi/ui';
import { CalendarClock, Phone, Printer, ShieldCheck, UserX } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { PAYMENT_METHODS, money, type PaymentMethod, type Payer } from '@/lib/billing';
import {
  BOOKING_FEE,
  CANCEL_CUTOFF_HOURS,
  FOLLOW_UP_FREE_DAYS,
  RULES,
  STATUS_BILLING_NOTE,
  appointmentBillingDay,
  cancellationVerdict,
  deskClock,
  minutesToSlot,
  quoteOnPhone,
  shiftLabel,
  type DeskRow,
} from '@/lib/appointment-billing';

/* Appointment billing (legacy screen 001 — `billing-appointment-module` — replaced) — the P2 sub-screen.
 *
 * The desk’s whole job in one place: what this booking costs and why, what the payer covers, what the patient
 * pays now, what happens to the booking fee if they cancel or simply do not come, and what the consultant is owed
 * at the end of the day — on money collected, never on money billed.
 *
 * The follow-up waiver, the report-review rule, the procedure package, the cut-off and the co-pay all come from
 * `lib/appointment-billing.ts`, so the answer on the phone and the answer at the counter are the same answer.
 *
 * Preview: the day is the appointment module’s own seed and the desk clock is a figure on the screen (11:20), not
 * a wall clock read during render — which is also why the queue and this screen agree. Nothing survives a reload.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const KIND_CHIP: Record<string, string> = {
  Charged: 'bg-safety-info/10 text-safety-info',
  Package: 'bg-brand-50 text-brand-700',
  Waived: 'bg-safety-success/10 text-safety-success',
  'Co-pay': 'bg-safety-warning/10 text-safety-warning',
};

const PAYERS: Payer[] = ['Self pay', 'Corporate — BRAC', 'Insurance — MetLife', 'Govt. scheme'];

export default function AppointmentBillingPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();
  const pkg = useMemo(() => appointmentBillingDay(day), [day]);

  const [tab, setTab] = useState('desk');
  const [payer, setPayer] = useState<Payer>('Self pay');
  const [openId, setOpenId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [waiveReason, setWaiveReason] = useState('Seen three days ago for the same complaint; the consultant asked for a weight check only.');
  const [outcome, setOutcome] = useState<Record<string, 'billed' | 'waived' | 'no show' | 'cancelled'>>({});

  // One pass per payer, not per row: the desk picks the payer once and the whole day is re-priced against it.
  const forPayer = useMemo(() => (payer === 'Self pay' ? pkg : appointmentBillingDay(day, { payerOverride: payer })), [pkg, payer, day]);
  const rows = forPayer.rows;

  const open = rows.find((r) => r.appointment.id === openId) ?? null;
  const quote = open ? quoteOnPhone(open.appointment, day, payer) : null;
  const cancel = open ? cancellationVerdict(open.appointment, pkg.deskMinutes) : null;
  const late = rows.filter((r) => r.appointment.status === 'Cancelled' && !cancellationVerdict(r.appointment, pkg.deskMinutes).free).length;

  const record = (r: DeskRow, kind: 'billed' | 'waived' | 'no show' | 'cancelled') => {
    setOutcome((o) => ({ ...o, [r.appointment.id]: kind }));
    if (kind === 'billed') {
      queueWrite(`${r.appointment.token} billed at the desk: ${money(r.patientDue)} from the patient, ${money(r.payerDue)} to ${payer}`);
      push({
        title: `${money(r.patientDue + r.bookingFee)} taken at the desk`,
        description: `${r.lines.map((l) => l.name).join(' · ')}. ${r.bookingFee > 0 ? `The ৳ ${r.bookingFee} booking fee is adjusted against the consultation, not added to it.` : 'No booking fee on this appointment.'} ${payer !== 'Self pay' ? `${payer} is invoiced ${money(r.payerDue)}.` : ''}`,
        tone: 'success',
      });
      return;
    }
    if (kind === 'waived') {
      queueWrite(`${r.appointment.token} consultation waived: ${waiveReason}`);
      push({ title: 'Consultation waived, with the reason on the record', description: waiveReason, tone: 'warning' });
      return;
    }
    if (kind === 'no show') {
      queueWrite(`${r.appointment.token} no show: booking fee of ${money(BOOKING_FEE)} retained`);
      push({
        title: `Marked as a no show — ৳ ${BOOKING_FEE} retained`,
        description: r.depositNextTime
          ? 'This patient has missed twice inside the window, so the next booking is taken with a deposit. It is not a punishment; it is a way of finding out whether the appointment is real.'
          : 'The slot was held and could not be re-sold at the desk. The consultation itself is not charged: the doctor did not see anybody.',
        tone: 'warning',
      });
      return;
    }
    queueWrite(`${r.appointment.token} cancelled: ${cancel?.free ? 'fee refunded or carried forward' : 'fee retained inside the cut-off'}`);
    push({
      title: cancel?.free ? 'Cancelled in time — fee refunded or carried forward once' : 'Cancelled inside the cut-off — fee retained',
      description: cancel?.because,
      tone: cancel?.free ? 'info' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <CalendarClock className="size-5 text-brand-600" aria-hidden />
            Appointment billing
          </h1>
          <p className="text-sm text-text-secondary">
            {day} · desk clock {deskClock(pkg.deskMinutes)} — what each booking costs, what the payer covers, and what
            happens to the fee when the patient does not come.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-text-secondary">
            Payer at the desk
            <select value={payer} onChange={(e) => setPayer(e.target.value as Payer)} className="mt-1 h-9 rounded-md border border-border-default bg-surface-default px-2 text-sm">
              {PAYERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <Link href="/appointments" className="inline-flex"><Button variant="ghost">The appointment book</Button></Link>
          <Link href="/appointments/queue" className="inline-flex"><Button variant="ghost">Today’s queue</Button></Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Bookings today" value={String(pkg.stats.bookings)} definition={`Across ${pkg.share.length} consultants. Morning and afternoon sessions both count as one day.`} asOf={day} footnote={`${pkg.stats.attended} attended or in the building`} />
        <KpiTile label="Fees billed" value={money(pkg.stats.feesBilled)} definition="Consultations and procedure packages at tariff, before waivers and co-pays." asOf={day} />
        <KpiTile label="Collected at the desk" value={money(pkg.stats.collected)} definition="Money actually received from patients at the counter today." asOf={day} footnote={`Co-pay portion ${money(pkg.stats.coPayCollected)}`} />
        <KpiTile label="Consultations waived" value={String(pkg.stats.waived)} definition={`Follow-ups inside ${FOLLOW_UP_FREE_DAYS} days and report reviews of our own results: shown at zero with the reason, never removed.`} asOf={day} />
        <KpiTile label="No shows" value={String(pkg.stats.noShows)} definition={`Booking fee retained on each: ৳ ${BOOKING_FEE} × ${pkg.stats.noShows} = ${money(pkg.stats.bookingFeesHeld)} held. The slot was held for nobody.`} asOf={day} footnote={pkg.stats.depositNextTime > 0 ? `${pkg.stats.depositNextTime} patient(s) need a deposit next time` : undefined} />
        <KpiTile label="Consultant share due" value={money(pkg.stats.shareDue)} definition="Paid on money collected, never on money billed — which is why this and the day-end sheet agree." asOf={day} footnote={`${late} late cancellation(s) retained the fee`} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'desk', label: 'At the desk', count: rows.length },
          { id: 'register', label: 'Today’s desk takings', count: pkg.ledger.length },
          { id: 'share', label: 'Consultant share', count: pkg.share.length },
          { id: 'rules', label: 'What the desk may and may not do' },
        ]}
      />

      {tab === 'desk' && (
        <Panel
          title="Bookings, in slot order"
          actions={<span className="text-xs text-text-secondary">Open a booking to bill it, waive it, or record what happened</span>}
        >
          <ListView
            id="appointment-desk"
            caption="Today’s appointments as the billing desk sees them"
            height="30rem"
            rows={rows}
            rowId={(r) => r.appointment.id}
            onRowClick={(r) => setOpenId(r.appointment.id)}
            columns={[
              { key: 'slot', header: 'Slot', width: '90px', render: (r) => (
                <span className="tabular-nums">
                  {r.slot}
                  <span className="block text-xs text-text-tertiary">{shiftLabel(r.appointment)}</span>
                </span>
              ) },
              { key: 'token', header: 'Token', width: '90px', render: (r) => r.appointment.token },
              { key: 'patient', header: 'Patient', render: (r) => (
                <span>
                  <span className="font-medium text-text-primary">{r.appointment.patient.name}</span>
                  <span className="ml-2 text-xs text-text-tertiary">{r.appointment.patient.mrn} · {r.appointment.patient.age} · {r.appointment.patient.sex}</span>
                  <span className="block text-xs text-text-tertiary">{r.appointment.reason}</span>
                </span>
              ) },
              { key: 'doctor', header: 'Consultant', hideBelow: 'md', render: (r) => `${r.doctorName} · ${r.room}` },
              { key: 'type', header: 'Type', width: '120px', render: (r) => (
                <span className={cx(r.appointment.type === 'Procedure' ? TONE_TEXT.info : TONE_TEXT.neutral)}>{r.appointment.type}</span>
              ) },
              { key: 'status', header: 'Where it is', width: '160px', render: (r) => (
                <span className="text-xs text-text-secondary">{outcome[r.appointment.id] ?? r.appointment.status}</span>
              ) },
              { key: 'fee', header: 'Fee lines', hideBelow: 'lg', width: '230px', render: (r) => (
                <span className="flex flex-wrap gap-1">
                  {r.lines.map((l) => (
                    <span key={l.code} className={cx('rounded-full px-2 py-0.5 text-[10px]', KIND_CHIP[l.kind])}>
                      {l.code} {l.amount === 0 ? 'no charge' : money(l.amount)}
                    </span>
                  ))}
                </span>
              ) },
              { key: 'patientDue', header: 'Patient pays', numeric: true, align: 'right', width: '120px', render: (r) => (
                <span className={cx(r.patientDue > 0 ? TONE_TEXT.neutral : TONE_TEXT.success)}>{r.patientDue > 0 ? money(r.patientDue) : 'nothing'}</span>
              ) },
              { key: 'payerDue', header: 'Payer', numeric: true, align: 'right', width: '110px', render: (r) => (r.payerDue > 0 ? money(r.payerDue) : '—') },
            ]}
          />
        </Panel>
      )}

      {tab === 'register' && (
        <Panel title="Taken at the desk today" actions={<span className="text-xs text-text-secondary">Every collection carries a method and the appointment it belongs to</span>}>
          {pkg.ledger.length === 0 ? (
            <EmptyState title="Nothing collected yet" description="Takings appear here as consultations finish. A booking fee held against a slot that nobody used is not revenue and does not appear here." />
          ) : (
            <ListView
              id="appointment-ledger"
              caption="Billing desk takings"
              height="26rem"
              rows={pkg.ledger}
              rowId={(l) => l.id}
              columns={[
                { key: 'at', header: 'At', width: '90px', render: (l) => l.at.slice(11) },
                { key: 'token', header: 'Token', width: '90px' },
                { key: 'patientName', header: 'Patient', render: (l) => (
                  <span>
                    {l.patientName}
                    <span className="ml-2 text-xs text-text-tertiary">{l.mrn}</span>
                  </span>
                ) },
                { key: 'what', header: 'What was charged', render: (l) => <span className="text-xs text-text-secondary">{l.what}</span> },
                { key: 'method', header: 'Method', width: '190px', render: (l) => <span className="text-xs">{l.method}</span> },
                { key: 'amount', header: 'Amount', numeric: true, align: 'right', width: '120px', render: (l) => money(l.amount) },
              ]}
            />
          )}
        </Panel>
      )}

      {tab === 'share' && (
        <div className="space-y-3">
          <Panel title="Consultant share on today’s consultations" actions={<span className="text-xs text-text-secondary">Computed on money collected; the unpaid column is what the desk still has to take</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <caption className="sr-only">Consultant share</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Consultant</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Department</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Visits</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Billed</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Collected</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Unpaid</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Share %</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {pkg.share.map((s) => (
                    <tr key={s.doctorId} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{s.doctorName}</td>
                      <td className="py-1.5 pr-3 text-text-secondary">{s.department}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{s.visits}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{money(s.billed)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{money(s.collected)}</td>
                      <td className={cx('py-1.5 pr-3 text-right tabular-nums', s.unpaid > 0 ? TONE_TEXT.warning : TONE_TEXT.success)}>{money(s.unpaid)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{s.sharePct} %</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{money(s.share)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border-default font-medium">
                    <td className="py-1.5 pr-3" colSpan={5}>Total payable to consultants</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(pkg.share.reduce((n, s) => n + s.unpaid, 0))}</td>
                    <td className="py-1.5 pr-3" />
                    <td className="py-1.5 text-right tabular-nums">{money(pkg.stats.shareDue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-xs text-text-tertiary">
              The percentage is a policy figure by department, set in the hospital’s contracts — not a clinical fact, and not something this screen
              decides. What the screen does decide is the basis: a consultant is paid a share of what was collected, so an unpaid invoice never pays
              anybody.
            </p>
          </Panel>

          <Panel title="Where the day’s bookings are">
            <ul className="space-y-1 text-sm">
              {Object.entries(STATUS_BILLING_NOTE).map(([status, note]) => {
                const count = rows.filter((r) => r.appointment.status === status).length;
                return (
                  <li key={status} className="flex items-start justify-between gap-3 rounded-md border border-border-subtle px-3 py-2">
                    <span>
                      <span className="font-medium text-text-primary">{status}</span>
                      <span className="ml-2 text-xs text-text-tertiary">{note}</span>
                    </span>
                    <span className="tabular-nums">{count}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="What the desk may and may not do">
            <ul className="space-y-2 text-sm">
              {RULES.map((r) => (
                <li key={r.title}>
                  <span className="font-medium text-text-primary">{r.title}.</span> <span className="text-text-secondary">{r.because}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="When the fee is decided">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { kind: 'New consultation', rule: 'Charged at check-in at the OPD tariff — history, examination and a plan are one consultation whatever the length.' },
                { kind: 'Follow-up', rule: `Free inside ${FOLLOW_UP_FREE_DAYS} days of the last completed visit; the follow-up rate applies outside it.` },
                { kind: 'Report review', rule: 'Free for our own laboratory results (the test was already charged); chargeable for a report brought from outside.' },
                { kind: 'Procedure', rule: 'A package paid before the procedure, so a theatre slot is never consumed by an unpaid case.' },
              ].map((row) => (
                <div key={row.kind} className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">{row.kind}</p>
                  <p className="text-text-secondary">{row.rule}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Related screens">
            <p className="text-sm text-text-secondary">
              The book is on <Link href="/appointments" className="underline">appointments</Link>, the queue and room
              states on <Link href="/appointments/queue" className="underline">the appointment queue</Link>, the
              OPD counter on <Link href="/billing/opd" className="underline">the OPD bill screen</Link>, the ledger
              and day end on <Link href="/billing" className="underline">billing</Link>, and the consultant
              percentages — a policy, not a clinical figure — belong with the rest of the master data on{' '}
              <Link href="/setup" className="underline">Setup</Link> once the contracts module arrives.
            </p>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- booking sheet */}
      <Sheet
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open ? `${open.appointment.token} — ${open.appointment.patient.name}` : 'Booking'}
        description={open ? `${open.slot} · ${open.appointment.type} · ${open.doctorName} · ${open.room} · ${open.appointment.priority.toLowerCase()} priority` : undefined}
        width="xl"
        footer={
          open && (
            <div className="flex flex-wrap items-end justify-end gap-2">
              <label className="text-xs text-text-secondary">
                Method for anything collected
                <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="ml-1 h-9 rounded-md border border-border-default bg-surface-default px-2 text-sm">
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <Button
                onClick={() => {
                  record(open, 'billed');
                  setOpenId(null);
                }}
                disabled={open.patientDue === 0 && open.payerDue === 0}
              >
                Take {money(Math.max(0, open.patientDue))} and close the booking
              </Button>
            </div>
          )
        }
      >
        {open && quote && cancel && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-4">
              <div><dt className="text-xs text-text-secondary">Booked via</dt><dd className="font-medium">{open.appointment.source}</dd></div>
              <div><dt className="text-xs text-text-secondary">Phone</dt><dd className="font-medium tabular-nums">{open.appointment.patient.phone}</dd></div>
              <div><dt className="text-xs text-text-secondary">Allergies</dt><dd className="font-medium">{open.appointment.patient.allergies || 'none recorded'}</dd></div>
              <div><dt className="text-xs text-text-secondary">Slot in</dt><dd className="font-medium tabular-nums">{minutesToSlot(open.appointment, pkg.deskMinutes)} minutes</dd></div>
            </dl>

            <div>
              <p className="font-medium text-text-primary">Fee lines</p>
              <ul className="mt-1 space-y-1">
                {open.lines.map((l) => (
                  <li key={l.code} className="rounded-md border border-border-subtle px-3 py-2">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={cx('rounded-full px-2 py-0.5 text-[10px]', KIND_CHIP[l.kind])}>{l.kind}</span>
                      <span className="font-medium text-text-primary">{l.name}</span>
                      <span className="tabular-nums text-text-secondary">{l.amount === 0 ? 'no charge' : money(l.amount)}</span>
                    </p>
                    <p className="text-xs text-text-secondary">{l.because}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm">
                <span className="font-medium text-text-primary">The patient pays {money(Math.max(0, open.patientDue))} at the desk</span>
                {open.payerDue > 0 && <span className="text-text-secondary"> and {open.payer} is invoiced {money(open.payerDue)}.</span>}
                {open.bookingFee > 0 && <span className="text-text-secondary"> The ৳ {open.bookingFee} booking fee already taken is adjusted against this, not added to it ({open.bookingFeeState}).</span>}
              </p>
            </div>

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-center gap-1.5 font-medium text-text-primary">
                <Phone className="size-4 text-brand-600" aria-hidden /> What to say on the phone
              </p>
              <p className="text-text-secondary">{quote.words}</p>
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => {
                  queueWrite(`Quotation given for ${open.appointment.token}: ${money(quote.patientPays)} at the desk`);
                  push({ title: 'Quotation recorded against the booking', description: 'If the patient is told one number and charged another, the record shows which number they were told.', tone: 'info' });
                }}
              >
                <Printer className="size-4" aria-hidden /> Record the quotation given
              </Button>
            </div>

            {open.note && (
              <p className={cx('rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2 text-xs', TONE_TEXT.warning)}>{open.note}</p>
            )}

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-center gap-1.5 font-medium text-text-primary">
                <UserX className="size-4 text-safety-warning" aria-hidden /> If they do not come
              </p>
              <p className="text-text-secondary">{cancel.because}</p>
            </div>

            <div>
              <p className="flex items-center gap-1.5 font-medium text-text-primary">
                <ShieldCheck className="size-4 text-safety-success" aria-hidden /> Other things the desk may do
              </p>
              <div className="mt-1 space-y-2">
                <label className="block text-xs text-text-secondary">
                  Reason, for a waiver or a cancellation
                  <input value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => { record(open, 'waived'); setOpenId(null); }}>Waive the consultation</Button>
                  <Button variant="ghost" onClick={() => { record(open, 'no show'); setOpenId(null); }}>Record a no show</Button>
                  <Button variant="ghost" onClick={() => { record(open, 'cancelled'); setOpenId(null); }}>
                    {cancel.free ? `Cancel — refund the ${money(BOOKING_FEE)} booking fee` : `Cancel — retain the ${money(BOOKING_FEE)} booking fee`}
                  </Button>
                </div>
              </div>
            </div>

            <p className="text-xs text-text-tertiary">
              The booking is on <Link href="/appointments" className="underline">the appointment book</Link>; the
              patient’s own account on <Link href="/billing/opd-patient" className="underline">the OPD patient view</Link>;
              the receipt prints with the token so the queue and the ledger describe the same visit.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
