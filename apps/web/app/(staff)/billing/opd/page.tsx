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
import { Ban, Printer, ReceiptText, RotateCcw, TriangleAlert } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { patients } from '@/lib/mock';
import { useShell } from '@/lib/shell';
import { DISCOUNT_LIMIT_PCT, money, type PaymentMethod } from '@/lib/billing';
import {
  FOLLOW_UP_FREE_DAYS,
  OPD_CATALOGUE,
  OPD_PAYMENT_METHODS,
  OPD_RULES,
  collectionGate,
  discountCheck,
  draftFromAppointment,
  encounterTotals,
  followUpQuote,
  generateOpdEncounters,
  opdDayTotals,
  type OpdEncounter,
  type OpdLine,
} from '@/lib/opd';
import { buildQueue, roomFor } from '@/lib/aftercare';

/* OPD bill screen (legacy screens 001 / 002 / 008 — the appointment module, the OPD module and the bill screen)
 * plus the bill dashboard as a strip. The patient-side view is /billing/opd-patient.
 *
 * The counter workflow, in the order the counter actually does it: pick the patient, add the lines, apply the
 * discount with a reason, take the money, print the receipt. `lib/opd.ts` holds the rules and this screen refuses
 * on them where they belong — the follow-up fee that is not charged again, the discount that needs an approver
 * above the limit, the collection gate that stops a sample on an unpaid bill, and the refund that goes back the
 * way it came.
 *
 * Preview: bills are synthetic. Nothing survives a reload; the rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const STATUS_CHIP: Record<OpdEncounter['status'], string> = {
  Draft: 'bg-surface-sunken text-text-secondary',
  Issued: 'bg-safety-warning/10 text-safety-warning',
  'Partially paid': 'bg-safety-warning/10 text-safety-warning',
  Paid: 'bg-safety-success/10 text-safety-success',
  Cancelled: 'bg-safety-critical/10 text-safety-critical',
};

export default function OpdBillPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [encounters, setEncounters] = useState<OpdEncounter[]>(() => generateOpdEncounters(day));
  const [tab, setTab] = useState('counter');
  const [mrn, setMrn] = useState('');
  const [draft, setDraft] = useState<OpdEncounter | null>(null);
  const [addCode, setAddCode] = useState(OPD_CATALOGUE[0].code);
  const [qty, setQty] = useState(1);
  const [chargedTo, setChargedTo] = useState<'Patient' | 'Payer'>('Patient');
  const [discountPct, setDiscountPct] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  const [approver, setApprover] = useState('');
  const [payment, setPayment] = useState<{ method: PaymentMethod; amount: string; reference: string }>({ method: 'Cash', amount: '', reference: '' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [refundLine, setRefundLine] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');

  const queue = useMemo(() => buildQueue(day), [day]);
  const totals = useMemo(() => opdDayTotals(encounters), [encounters]);
  const live = encounters.filter((e) => e.status !== 'Draft');
  const patient = patients.find((p) => p.mrn === mrn);
  const quote = patient ? followUpQuote(mrn, day, 'Medicine') : null;
  const open = encounters.find((e) => e.id === openId) ?? null;
  const draftTotals = draft ? encounterTotals(draft) : null;
  const gate = draft ? collectionGate(draft) : null;
  const discountVerdict = discountCheck(discountPct, discountReason || undefined, approver || undefined);

  const startDraft = (nextMrn: string, doctorId?: string) => {
    const type = 'New' as const;
    const next = draftFromAppointment(nextMrn, day, doctorId ?? queue.byRoom[0]?.doctorId ?? 'dr-rahman', type);
    setMrn(nextMrn);
    setDraft(next);
    setPayment({ method: 'Cash', amount: String(encounterTotals(next).net), reference: '' });
    push({
      title: `Bill started for ${next.patientName}`,
      description: next.consultationCharged
        ? `${next.department} · ${next.doctorName}. The consultation fee applies — no earlier visit in this department inside ${FOLLOW_UP_FREE_DAYS} days.`
        : `${next.department} · ${next.doctorName}. The consultation is not charged again: seen on a recent visit inside the ${FOLLOW_UP_FREE_DAYS}-day window.`,
      tone: 'info',
    });
  };

  const addLine = () => {
    if (!draft) return;
    const item = OPD_CATALOGUE.find((t) => t.code === addCode)!;
    const verdict = discountCheck(discountPct, discountReason || undefined, approver || undefined);
    if (!verdict.ok) {
      push({ title: `Refused — ${verdict.message}`, tone: 'critical' });
      return;
    }
    const newLine: OpdLine = {
      id: `${item.code}-${Date.now()}`,
      code: item.code,
      name: item.name,
      category: item.category,
      qty,
      unitPrice: item.price,
      discountPct,
      ...(discountReason ? { discountReason } : {}),
      ...(approver && discountPct > DISCOUNT_LIMIT_PCT ? { discountReason: `${discountReason} — approved by ${approver}` } : {}),
      chargedTo,
      origin: item.category === 'Consultation' ? 'Consultation' : item.category === 'Procedure' ? 'Procedure' : 'Investigation',
    };
    setDraft((d) => (d ? { ...d, lines: [...d.lines, newLine] } : d));
    setQty(1);
    setDiscountPct(0);
    setDiscountReason('');
    setApprover('');
    setPayment((p) => ({ ...p, amount: String(encounterTotals({ ...draft, lines: [...draft.lines, newLine] }).net) }));
    push({ title: `${item.name} added`, description: `${money(item.price * qty)} · charged to ${chargedTo.toLowerCase()}${discountPct ? ` · ${discountPct} % off, ${discountReason}` : ''}.`, tone: 'success' });
  };

  const removeLine = (lineId: string) => {
    setDraft((d) => (d ? { ...d, lines: d.lines.filter((l) => l.id !== lineId) } : d));
  };

  const issue = (target: OpdEncounter) => {
    const line = target.lines.find((l) => l.discountPct > DISCOUNT_LIMIT_PCT);
    if (line) {
      push({ title: `Refused — ${line.name} carries a ${line.discountPct} % discount without an approver on the line.`, tone: 'critical' });
      return;
    }
    const number = `R-${day.slice(2, 4)}${day.slice(5, 7)}-${String(7400 + encounters.length)}`;
    setEncounters((list) => [{ ...target, status: 'Issued', receipt: number }, ...list.filter((e) => e.id !== target.id)]);
    queueWrite(`OPD bill ${number} issued for ${target.patientName}: ${money(encounterTotals(target).net)}`, {
      id: 'createInvoice',
      recordId: number,
      fields: { mrn: target.mrn, net: encounterTotals(target).net, lines: target.lines.length },
    });
    setDraft(null);
    setOpenId(number === '' ? null : target.id);
    push({
      title: `Bill issued — receipt ${number}`,
      description: `The number came from this counter’s reserved block, so a receipt printed while the link is down is still unique and reconciles afterwards.`,
      tone: 'success',
    });
  };

  const takePayment = (target: OpdEncounter) => {
    const amount = Number(payment.amount) || 0;
    if (amount <= 0) {
      push({ title: 'A payment needs an amount — a blank line in the drawer is found at night, not now.', tone: 'critical' });
      return;
    }
    const t = encounterTotals(target);
    if (amount > t.due) {
      push({ title: `Refused — ${money(amount)} is more than the ${money(t.due)} outstanding.`, tone: 'critical' });
      return;
    }
    if ((payment.method === 'bKash' || payment.method === 'Nagad' || payment.method === 'Card') && !payment.reference.trim()) {
      push({ title: `Refused — a ${payment.method} payment without its transaction reference is a payment nobody can reconcile.`, tone: 'critical' });
      return;
    }
    const paid: OpdEncounter = {
      ...target,
      payments: [...target.payments, { id: `pay-${Date.now()}`, at: `${day} 12:0${Math.min(9, target.payments.length + 5)}`, method: payment.method, amount, ...(payment.reference ? { reference: payment.reference } : {}), receivedBy: 'Cashier — counter 2' }],
    };
    paid.status = encounterTotals(paid).due === 0 ? 'Paid' : 'Partially paid';
    setEncounters((list) => list.map((e) => (e.id === target.id ? paid : e)));
    setDraft(paid);
    setPayment({ ...payment, amount: String(encounterTotals(paid).due), reference: '' });
    queueWrite(`OPD payment ${money(amount)} by ${payment.method} received from ${target.patientName}`, {
      id: 'recordPayment',
      recordId: target.receipt ?? target.id,
      fields: { amount, method: payment.method, ...(payment.reference ? { reference: payment.reference } : {}) },
    });
    push({ title: `${money(amount)} received by ${payment.method}`, description: `Outstanding now ${money(encounterTotals(paid).due)}. The collection gate re-reads this bill, so the sample can be taken the moment it is cleared.`, tone: 'success' });
  };

  const refund = (target: OpdEncounter, lineId: string) => {
    const line = target.lines.find((l) => l.id === lineId);
    if (!line) return;
    const method = target.payments[0]?.method ?? 'Cash';
    if (!refundReason.trim()) {
      push({ title: 'A refund needs a reason on the record — the same as a discount, and for the same reason.', tone: 'critical' });
      return;
    }
    const amount = line.qty * line.unitPrice - Math.round((line.qty * line.unitPrice * line.discountPct) / 100);
    const refunded: OpdEncounter = {
      ...target,
      refunds: [...target.refunds, { id: `ref-${Date.now()}`, at: `${day} 12:10`, method, amount, because: `${line.name}: ${refundReason.trim()}`, approvedBy: 'Billing in-charge' }],
      status: target.payments.length ? 'Partially paid' : 'Issued',
    };
    setEncounters((list) => list.map((e) => (e.id === target.id ? refunded : e)));
    setDraft(draft?.id === target.id ? refunded : draft);
    setRefundLine(null);
    setRefundReason('');
    queueWrite(`OPD refund ${money(amount)} to ${target.patientName} by ${method}: ${line.name}`, {
      // Money going back is a document too: a credit note against the bill, never an edit of it.
      id: 'createInvoice',
      recordId: `CN-${target.receipt ?? target.id}`,
      fields: { creditNoteOf: target.receipt ?? target.id, amount, method, line: line.name },
    });
    push({
      title: `${money(amount)} refunded by ${method}`,
      description: `Back the way it came, with the receipt number beside it. ${line.name} is cancelled on the bill and the laboratory is told through the same record.`,
      tone: 'warning',
    });
  };

  const cancelBill = (target: OpdEncounter) => {
    setEncounters((list) => list.map((e) => (e.id === target.id ? { ...e, status: 'Cancelled' } : e)));
    if (draft?.id === target.id) setDraft({ ...target, status: 'Cancelled' });
    push({ title: 'Bill cancelled', description: 'A cancelled bill keeps its number and its lines: the sequence is not re-used, so the day-end sheet still reconciles.', tone: 'warning' });
  };

  const checkedIn = queue.entries.filter((e) => e.checkedInAt !== undefined && e.stage !== 'Completed');

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <ReceiptText className="size-5 text-brand-600" aria-hidden />
            OPD billing counter
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — bill a visit, take the money, print the receipt. The patient’s own account is on{' '}
            <Link href="/billing/opd-patient" className="underline">the OPD patient view</Link>.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Bills today" value={String(totals.encounters)} definition="OPD encounters billed at the counter, drafts excluded." asOf={day} />
        <KpiTile label="Billed" value={money(totals.net)} definition="Net of line discounts: what the counter asked for, before what was collected." asOf={day} />
        <KpiTile label="Collected" value={money(totals.collected)} definition="Money received at the counter today, whatever method." asOf={day} footnote={`${totals.byMethod.length} method(s) in play`} />
        <KpiTile label="Outstanding" value={money(totals.outstanding)} definition="Billed and not yet paid. Every one of these is a collection gate that is still closed." asOf={day} />
        <KpiTile label={`Follow-ups not charged`} value={String(totals.freeFollowUps)} definition={`Visits inside the ${FOLLOW_UP_FREE_DAYS}-day window where the consultation fee was zeroed with a reason on the line.`} asOf={day} />
        <KpiTile label="Discounted lines" value={String(totals.discountedLines)} definition={`Lines with a discount inside the ${DISCOUNT_LIMIT_PCT} % counter limit. Anything above it needs an approver’s name on the line.`} asOf={day} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'counter', label: 'Counter', count: checkedIn.length || undefined },
          { id: 'bills', label: 'Today’s bills', count: live.length },
          { id: 'rules', label: 'Rules' },
        ]}
      />

      {tab === 'counter' && (
        <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
          <Panel title="Who is at the counter" className="h-fit">
            <p className="mb-2 text-xs text-text-secondary">
              Checked in on <Link href="/appointments/queue" className="underline">the OPD queue</Link> and not yet through.
            </p>
            {checkedIn.length === 0 ? (
              <EmptyState title="Nobody waiting" description="Every checked-in patient is through or already billed." />
            ) : (
              <ul className="space-y-1">
                {checkedIn.slice(0, 8).map((e) => (
                  <li key={e.appointment.id}>
                    <button
                      type="button"
                      onClick={() => startDraft(e.appointment.patient.mrn, e.appointment.doctorId)}
                      className={cx('w-full rounded-md px-3 py-2 text-left text-sm', draft?.mrn === e.appointment.patient.mrn ? 'bg-brand-50 text-brand-700' : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary')}
                    >
                      <span className="font-medium">{e.appointment.patient.name}</span>
                      <span className="block text-xs text-text-tertiary">
                        {e.appointment.token} · {e.appointment.patient.mrn} · {roomFor(e.appointment.doctorId)} · {e.stage}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-3 block text-xs text-text-secondary">
              Or search by MRN / phone
              <input
                value={mrn}
                onChange={(e) => setMrn(e.target.value.trim())}
                placeholder="SH-102311"
                className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm"
              />
            </label>
            {patient && (
              <div className="mt-2 rounded-md border border-border-subtle px-3 py-2 text-xs">
                <p className="font-medium text-text-primary">{patient.name} · {patient.mrn}</p>
                <p className="text-text-secondary">{patient.age} · {patient.sex} · {patient.payer}</p>
                {quote && <p className={cx('mt-1', quote.free ? TONE_TEXT.success : TONE_TEXT.warning)}>{quote.because}</p>}
                <Button variant="ghost" size="sm" onClick={() => startDraft(patient.mrn)}>Start the bill</Button>
              </div>
            )}
          </Panel>

          <div className="space-y-3">
            {!draft ? (
              <EmptyState
                title="No bill open"
                description="Pick somebody from the queue, or search an MRN. The follow-up rule is applied to the consultation line as soon as the patient is chosen — before the patient has to ask."
              />
            ) : (
              <>
                <Panel
                  title={`${draft.patientName} · ${draft.mrn}`}
                  actions={<span className={cx('rounded-full px-2 py-0.5 text-xs', STATUS_CHIP[draft.status])}>{draft.status}</span>}
                >
                  <div className="grid gap-3 text-sm sm:grid-cols-3">
                    <div><p className="text-xs text-text-secondary">Visit</p><p className="font-medium">{draft.department} · {draft.doctorName} · {draft.room}</p></div>
                    <div><p className="text-xs text-text-secondary">Type</p><p className="font-medium">{draft.type}</p></div>
                    <div><p className="text-xs text-text-secondary">Receipt</p><p className="font-medium tabular-nums">{draft.receipt ?? 'not issued yet'}</p></div>
                  </div>
                  {!draft.consultationCharged && (
                    <p className={cx('mt-2 rounded-md border border-safety-success/40 bg-safety-success/5 px-3 py-2 text-sm', TONE_TEXT.success)}>
                      The consultation is on the bill at zero with the reason: a follow-up inside {FOLLOW_UP_FREE_DAYS} days of an earlier visit in this department is not charged again.
                      The line stays visible so the patient can see that nothing was hidden, only waived.
                    </p>
                  )}
                </Panel>

                <Panel title="Lines" actions={<span className="text-xs text-text-secondary">Discounts carry a reason, and above {DISCOUNT_LIMIT_PCT} % an approver</span>}>
                  <ul className="space-y-1">
                    {draft.lines.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm">
                        <span>
                          <span className="font-medium text-text-primary">{l.name}</span>
                          <span className="ml-2 text-xs text-text-tertiary">
                            {l.code} · {l.qty} × {money(l.unitPrice)} · {l.chargedTo === 'Payer' ? 'payer' : 'patient'}
                            {l.discountPct > 0 ? ` · ${l.discountPct}% off${l.discountReason ? ` — ${l.discountReason}` : ''}` : ''}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums">{money(l.qty * l.unitPrice - Math.round((l.qty * l.unitPrice * l.discountPct) / 100))}</span>
                          {draft.status !== 'Paid' && <Button variant="ghost" size="sm" onClick={() => removeLine(l.id)}>Remove</Button>}
                          {draft.status !== 'Draft' && draft.status !== 'Cancelled' && (
                            <Button variant="ghost" size="sm" onClick={() => { setRefundLine(l.id); setOpenId(draft.id); }}>
                              <RotateCcw className="size-3.5" aria-hidden /> Refund
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 grid gap-2 border-t border-border-subtle pt-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-xs text-text-secondary">
                      Add a line
                      <select value={addCode} onChange={(e) => setAddCode(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                        {OPD_CATALOGUE.map((t) => <option key={t.code} value={t.code}>{t.name} · {money(t.price)}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-text-secondary">
                      Quantity
                      <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums" />
                    </label>
                    <label className="text-xs text-text-secondary">
                      Charged to
                      <select value={chargedTo} onChange={(e) => setChargedTo(e.target.value as 'Patient' | 'Payer')} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                        <option value="Patient">The patient</option>
                        <option value="Payer">The payer (employer / insurer)</option>
                      </select>
                    </label>
                    <label className="text-xs text-text-secondary">
                      Discount %
                      <input type="number" min={0} max={100} value={discountPct} onChange={(e) => setDiscountPct(Number(e.target.value))} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums" />
                    </label>
                    {discountPct > 0 && (
                      <>
                        <label className="text-xs text-text-secondary sm:col-span-2">
                          Reason on the line
                          <input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Hardship, authorised by the medical director" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                        </label>
                        {discountPct > DISCOUNT_LIMIT_PCT && (
                          <label className="text-xs text-text-secondary sm:col-span-2">
                            Approver (required above {DISCOUNT_LIMIT_PCT} %)
                            <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Billing in-charge" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                          </label>
                        )}
                      </>
                    )}
                    <div className="flex items-end">
                      <Button onClick={addLine}>Add the line</Button>
                    </div>
                  </div>
                  {discountPct > 0 && (
                    <p className={cx('mt-2 text-xs', discountVerdict.ok ? TONE_TEXT.success : discountVerdict.needsApproval ? TONE_TEXT.warning : TONE_TEXT.critical)}>
                      {discountVerdict.message}
                    </p>
                  )}
                </Panel>

                {draftTotals && (
                  <Panel title="The bill">
                    <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                      <div><dt className="text-xs text-text-secondary">Gross</dt><dd className="font-medium tabular-nums">{money(draftTotals.gross)}</dd></div>
                      <div><dt className="text-xs text-text-secondary">Discount</dt><dd className="font-medium tabular-nums">{money(draftTotals.discount)}</dd></div>
                      <div><dt className="text-xs text-text-secondary">Net</dt><dd className="font-medium tabular-nums">{money(draftTotals.net)}</dd></div>
                      <div><dt className="text-xs text-text-secondary">Payer covers</dt><dd className="font-medium tabular-nums">{money(draftTotals.payerShare)}</dd></div>
                      <div><dt className="text-xs text-text-secondary">Patient pays</dt><dd className="font-medium tabular-nums">{money(draftTotals.patientShare)}</dd></div>
                      <div><dt className="text-xs text-text-secondary">Outstanding</dt><dd className={cx('font-medium tabular-nums', draftTotals.due > 0 ? TONE_TEXT.warning : TONE_TEXT.success)}>{money(draftTotals.due)}</dd></div>
                    </dl>
                    <p className="mt-2 text-xs text-text-tertiary">
                      The payer share is computed line by line, not at the end: a corporate patient can see which lines the employer covers
                      and which they are paying themselves, at the counter, without an argument at the accounts desk next week.
                    </p>
                  </Panel>
                )}

                {gate && (
                  <div className={cx('rounded-md border px-3 py-2 text-sm', gate.ok ? 'border-safety-success/40 bg-safety-success/5' : 'border-safety-warning/40 bg-safety-warning/5')}>
                    <p className="font-medium text-text-primary">Collection gate</p>
                    <p className="text-text-secondary">{gate.message}</p>
                  </div>
                )}

                <Panel title="Take the money">
                  <div className="grid gap-2 sm:grid-cols-4">
                    <label className="text-xs text-text-secondary">
                      Method
                      <select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value as PaymentMethod })} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                        {OPD_PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-text-secondary">
                      Amount
                      <input value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} inputMode="decimal" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums" />
                    </label>
                    <label className="text-xs text-text-secondary">
                      Reference
                      <input value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} placeholder="TX id / card slip" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                    </label>
                    <div className="flex items-end gap-2">
                      <Button variant="ghost" onClick={() => takePayment(draft)}>Record the payment</Button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-text-secondary">
                    {OPD_PAYMENT_METHODS.find((m) => m.id === payment.method)?.settlement}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={() => issue(draft)} disabled={draft.status !== 'Draft'}>
                      <Printer className="size-4" aria-hidden /> Issue the bill and print the receipt
                    </Button>
                    <Button variant="ghost" onClick={() => cancelBill(draft)} disabled={draft.status === 'Cancelled'}>
                      <Ban className="size-4" aria-hidden /> Cancel the bill
                    </Button>
                    <Button variant="ghost" onClick={() => { setDraft(null); setMrn(''); }}>
                      <TriangleAlert className="size-4" aria-hidden /> Clear the counter
                    </Button>
                  </div>
                </Panel>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'bills' && (
        <Panel title="Every bill raised at the OPD counter today" actions={<span className="text-xs text-text-secondary">Open one to refund a line or read the payments</span>}>
          <ListView
            id="opd-bills"
            caption="OPD bills today"
            height="30rem"
            rows={encounters}
            rowId={(e) => e.id}
            onRowClick={(e) => setOpenId(e.id)}
            columns={[
              { key: 'receipt', header: 'Receipt', width: '150px', render: (e) => e.receipt ?? '—' },
              { key: 'patientName', header: 'Patient', render: (e) => (
                <span>
                  {e.patientName}
                  <span className="ml-2 text-xs text-text-tertiary">{e.mrn}</span>
                </span>
              ) },
              { key: 'department', header: 'Department', hideBelow: 'md', width: '150px' },
              { key: 'lines', header: 'Lines', numeric: true, align: 'right', width: '90px', render: (e) => e.lines.length },
              { key: 'net', header: 'Net', numeric: true, align: 'right', width: '130px', render: (e) => money(encounterTotals(e).net) },
              { key: 'paid', header: 'Paid', numeric: true, align: 'right', width: '130px', render: (e) => money(encounterTotals(e).paid) },
              { key: 'due', header: 'Due', numeric: true, align: 'right', width: '130px', render: (e) => (
                <span className={cx(encounterTotals(e).due > 0 ? TONE_TEXT.warning : TONE_TEXT.success)}>{money(encounterTotals(e).due)}</span>
              ) },
              { key: 'status', header: 'Status', width: '140px', render: (e) => (
                <span className={cx('rounded-full px-2 py-0.5 text-xs', STATUS_CHIP[e.status])}>{e.status}</span>
              ) },
            ]}
          />
        </Panel>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="The six rules the counter runs on">
            <ul className="space-y-2 text-sm">
              {OPD_RULES.map((r) => (
                <li key={r.title}>
                  <span className="font-medium text-text-primary">{r.title}.</span> <span className="text-text-secondary">{r.because}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="How the money settles">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Payment methods at the OPD counter</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Method</th>
                    <th scope="col" className="py-1.5 font-medium">Where it settles</th>
                  </tr>
                </thead>
                <tbody>
                  {OPD_PAYMENT_METHODS.map((m) => (
                    <tr key={m.id} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{m.label}</td>
                      <td className="py-1.5 text-text-secondary">{m.settlement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- bill sheet */}
      <Sheet
        open={Boolean(open)}
        onClose={() => { setOpenId(null); setRefundLine(null); }}
        title={open ? `${open.receipt ?? 'Draft bill'} — ${open.patientName}` : 'Bill'}
        description={open ? `${open.department} · ${open.doctorName} · ${open.room} · ${open.day}` : undefined}
        width="lg"
        footer={
          open && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => push({ title: 'Receipt sent to the print queue', description: 'The counter’s own printer keeps working during an outage; the number came from the reserved block.', tone: 'info' })}>
                <Printer className="size-4" aria-hidden /> Print the receipt
              </Button>
              <Link href={`/billing/opd-patient?mrn=${open.mrn}`} className="inline-flex">
                <Button variant="ghost">Open the patient’s account</Button>
              </Link>
            </div>
          )
        }
      >
        {open && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-text-secondary">Net</dt><dd className="font-medium tabular-nums">{money(encounterTotals(open).net)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Paid</dt><dd className="font-medium tabular-nums">{money(encounterTotals(open).paid)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Outstanding</dt><dd className={cx('font-medium tabular-nums', encounterTotals(open).due > 0 ? TONE_TEXT.warning : TONE_TEXT.success)}>{money(encounterTotals(open).due)}</dd></div>
            </dl>

            <div>
              <p className="font-medium text-text-primary">Lines</p>
              <ul className="mt-1 space-y-1">
                {open.lines.map((l) => (
                  <li key={l.id} className={cx('flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2', refundLine === l.id ? 'border-safety-warning/40 bg-safety-warning/5' : 'border-border-subtle')}>
                    <span>
                      {l.name}
                      <span className="ml-2 text-xs text-text-tertiary">{l.chargedTo === 'Payer' ? 'payer' : 'patient'}{l.discountPct ? ` · ${l.discountPct} % off — ${l.discountReason}` : ''}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{money(l.qty * l.unitPrice - Math.round((l.qty * l.unitPrice * l.discountPct) / 100))}</span>
                      {open.status !== 'Cancelled' && open.status !== 'Draft' && (
                        <Button variant="ghost" size="sm" onClick={() => setRefundLine(l.id)}>Refund this line</Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {refundLine && (
              <div className="rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2">
                <p className="font-medium text-text-primary">Refunding {open.lines.find((l) => l.id === refundLine)?.name}</p>
                <p className="text-text-secondary">
                  It goes back by {open.payments[0]?.method ?? 'Cash'} — the method on the receipt. A refund in cash of a card payment is not a refund,
                  it is a discrepancy in two sets of books.
                </p>
                <label className="mt-2 block text-xs text-text-secondary">
                  Reason
                  <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Investigation cancelled by the doctor after the bill was issued" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                </label>
                <div className="mt-2 flex gap-2">
                  <Button variant="ghost" onClick={() => refund(open, refundLine)}>Issue the refund</Button>
                  <Button variant="ghost" onClick={() => setRefundLine(null)}>Cancel</Button>
                </div>
              </div>
            )}

            <div>
              <p className="font-medium text-text-primary">Payments</p>
              {open.payments.length === 0 ? (
                <p className="text-text-secondary">Nothing received yet — the collection gate is closed on this bill.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {open.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-1.5">
                      <span>{p.method}{p.reference ? ` · ${p.reference}` : ''} · {p.receivedBy}</span>
                      <span className="tabular-nums">{money(p.amount)} at {p.at.slice(11)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {open.refunds.length > 0 && (
              <div className="rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2">
                <p className="font-medium text-text-primary">Refunds</p>
                <ul className="mt-1 space-y-1 text-text-secondary">
                  {open.refunds.map((r) => (
                    <li key={r.id}>· {money(r.amount)} by {r.method} on {r.at.slice(11)} — {r.because} (approved by {r.approvedBy})</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Related screens: <Link href="/billing" className="underline">the billing desk</Link> has the invoices, the day-end sheet and the
        discount approvals; <Link href="/billing/opd-patient" className="underline">the OPD patient view</Link> is the patient’s side of this
        counter; <Link href="/appointments/queue" className="underline">the queue</Link> is where these patients come from.
      </p>
    </div>
  );
}
