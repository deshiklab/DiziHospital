/* -----------------------------------------------------------------------------
 * OPD billing.
 *
 * Outpatient billing is where a hospital's reputation is made, because it is the part the patient sees: a queue, a
 * bill, a counter. The legacy product split it across five screens (appointment, OPD module, bill dashboard, bill
 * screen, patient view) that each knew half the rules. This file keeps the rules in one place:
 *
 *  - **A follow-up inside seven days is not charged again.** The patient paid for the assessment; repeating the
 *    fee for the same problem a week later is the single most common complaint at an OPD counter, and it is a rule
 *    the software can hold instead of the cashier having to remember it.
 *  - **A discount is a decision with a name on it.** Up to 15 % the counter may give and record; above that it
 *    needs an approver and a written reason, on the line, where the patient can see it.
 *  - **Nothing is collected before it is paid or the payer has authorised it.** The laboratory and the radiology
 *    room both refuse a sample on an unpaid, unauthorised bill, and the refusal is a rule rather than a habit.
 *  - **A cancelled investigation is refunded to the method it was paid by.** A refund in cash of a card payment
 *    is not a refund, it is a discrepancy in two books.
 *  - **A receipt number is drawn from a branch block**, so a receipt printed while the link is down is still
 *    unique and can be reconciled afterwards — the same mechanism the sync engine uses for MRNs.
 *  - **The payer share is computed on the line, not at the end.** A corporate patient should be able to see which
 *    lines their employer covers and which they are paying themselves, line by line, at the counter.
 *
 * Preview: the bills are synthetic, derived from the same tariff and the same mock patients as the rest of the
 * platform. Nothing survives a reload; the rules do.
 */

import { TARIFF, DISCOUNT_LIMIT_PCT, payerCoverage, money, type Category, type Invoice, type InvoiceLine, type PaymentMethod, type Payer } from './billing';
import { patients } from './mock';
import { generateAppointments, todayIso } from './appointments';
import { DOCTORS } from './appointments';

export const today = todayIso;

/** The window in which a follow-up for the same problem is not charged again. */
export const FOLLOW_UP_FREE_DAYS = 7;

/** The counter's methods: the three that move money and the two that move the responsibility for it. */
export const OPD_PAYMENT_METHODS: Array<{ id: PaymentMethod; label: string; settlement: string }> = [
  { id: 'Cash', label: 'Cash', settlement: 'In the drawer at the end of the shift; counted against the day-end sheet.' },
  { id: 'Card', label: 'Card', settlement: 'Settled by the bank the next working day; the slip number is recorded against the receipt.' },
  { id: 'bKash', label: 'bKash', settlement: 'Mobile wallet: the transaction id is the receipt’s other half.' },
  { id: 'Nagad', label: 'Nagad', settlement: 'Mobile wallet, recorded the same way — a dispute over a mobile payment is a dispute about a reference number.' },
  { id: 'Insurance', label: 'Insurance', settlement: 'The insurer is invoiced; the authorisation number goes on the line, not in a file.' },
  { id: 'Corporate', label: 'Corporate', settlement: 'The employer is invoiced; the patient signs the authorisation and the line says who pays.' },
];

export const OPD_RULES: Array<{ title: string; because: string }> = [
  {
    title: `A follow-up inside ${FOLLOW_UP_FREE_DAYS} days is not charged again`,
    because: 'The patient already paid for the assessment of this problem. Charging the fee again a week later is what people remember about a hospital, and the counter should not have to argue it.',
  },
  {
    title: `Discounts up to ${DISCOUNT_LIMIT_PCT} % are recorded; above that they are approved`,
    because: 'The counter may give a small discount and write it on the line with a reason. Above the limit the approver’s name is on the bill, because a discount nobody signed is money nobody decided to give.',
  },
  {
    title: 'Nothing is collected before it is paid or authorised',
    because: 'The laboratory and the radiology room refuse a sample on an unpaid bill with no payer authorisation. The gate is in the software so the refusal is a rule and not a personality.',
  },
  {
    title: 'A refund goes back the way it came',
    because: 'Cash back for a card payment is not a refund, it is a discrepancy in two sets of books. The refund is issued to the method on the receipt, with the receipt number beside it.',
  },
  {
    title: 'Receipt numbers come from the branch block',
    because: 'A receipt printed during an outage still has to be unique and reconcilable afterwards. The block is reserved per counter, exactly as MRNs are per node.',
  },
  {
    title: 'The payer share is on the line, not the total',
    because: 'A corporate patient should be able to see which lines are covered and which they are paying themselves, at the counter, without an argument at the accounts desk next week.',
  },
];

export interface OpdLine extends InvoiceLine {
  /** Where the line came from, so a follow-up line can be recognised and zeroed. */
  origin: 'Consultation' | 'Investigation' | 'Procedure' | 'Medicine' | 'Dressing' | 'Certificate';
}

export interface OpdEncounter {
  id: string;
  mrn: string;
  patientName: string;
  day: string;
  department: string;
  doctorId: string;
  doctorName: string;
  room: string;
  type: 'New' | 'Follow-up';
  /** True when the tariff was applied, false when the follow-up rule zeroed the consultation fee. */
  consultationCharged: boolean;
  /** The encounter this one follows, when it is a follow-up inside the window. */
  follows?: string;
  lines: OpdLine[];
  payments: Array<{ id: string; at: string; method: PaymentMethod; amount: number; reference?: string; receivedBy: string }>;
  status: 'Draft' | 'Issued' | 'Paid' | 'Partially paid' | 'Cancelled';
  receipt?: string;
  refunds: Array<{ id: string; at: string; method: PaymentMethod; amount: number; because: string; approvedBy: string }>;
}

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

const tar = (code: string) => TARIFF.find((t) => t.code === code)!;

const line = (code: string, qty: number, origin: OpdLine['origin'], chargedTo: 'Patient' | 'Payer', discountPct = 0, discountReason?: string): OpdLine => {
  const item = tar(code);
  return {
    id: `${code}-${qty}-${Math.round(discountPct * 10)}`,
    code: item.code,
    name: item.name,
    category: item.category,
    qty,
    unitPrice: item.price,
    discountPct,
    ...(discountReason ? { discountReason } : {}),
    chargedTo,
    origin,
  };
};

/** The tariff lines the OPD counters actually use, for the picker. */
export const OPD_CATALOGUE = TARIFF.filter((t) =>
  ['Consultation', 'Procedure', 'Pathology', 'Radiology'].includes(t.category) &&
  !['CONS-EMR', 'CONS-ONL'].includes(t.code),
);

/** The day's OPD encounters: the bills behind the queue. */
export function generateOpdEncounters(dayIso: string, count = 9): OpdEncounter[] {
  const rand = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 4242) * 9973);
  const appointments = generateAppointments(dayIso).filter((a) => a.status !== 'Requested');
  const encounters: OpdEncounter[] = [];

  for (let i = 0; i < Math.min(count, appointments.length); i += 1) {
    const appointment = appointments[i];
    const patient = patients.find((p) => p.mrn === appointment.patient.mrn) ?? patients[i];
    const doctor = DOCTORS.find((d) => d.id === appointment.doctorId) ?? DOCTORS[0];
    const isFollowUp = appointment.source === 'Follow-up' || appointment.type === 'Follow-up' || rand() < 0.3;
    const payer = patient.payer as Payer;
    const chargedTo: 'Patient' | 'Payer' = payerCoverage[payer] > 0 && rand() < 0.7 ? 'Payer' : 'Patient';

    const lines: OpdLine[] = [];
    if (isFollowUp) {
      // The rule: the fee is on the bill, at zero, with the reason. A patient should see why they are not paying.
      lines.push({ ...line('CONS-FU', 1, 'Consultation', 'Patient'), unitPrice: tar('CONS-FU').price, discountPct: 100, discountReason: `Follow-up inside ${FOLLOW_UP_FREE_DAYS} days — the assessment was already paid for` });
    } else {
      lines.push(line('CONS-OPD', 1, 'Consultation', chargedTo));
    }

    if (rand() < 0.85) lines.push(line('LAB-CBC', 1, 'Investigation', chargedTo));
    if (rand() < 0.5) lines.push(line('LAB-FBS', 1, 'Investigation', chargedTo));
    if (rand() < 0.4) lines.push(line('IMG-CXR', 1, 'Investigation', chargedTo));
    if (rand() < 0.3) lines.push(line('PROC-DRES', 1, 'Dressing', 'Patient', rand() < 0.5 ? 10 : 0, rand() < 0.5 ? 'Dressing at the counter after a review' : undefined));

    const paidFull = rand() < 0.7;
    const net = lines.reduce((s, l) => s + Math.round(l.qty * l.unitPrice * (1 - l.discountPct / 100)), 0);
    const method: PaymentMethod = (['Cash', 'Cash', 'bKash', 'Card', 'Insurance'] as PaymentMethod[])[Math.floor(rand() * 5)];
    const pays: OpdEncounter['payments'] = paidFull
      ? [{ id: `pay-${i}-1`, at: `${dayIso}T${String(9 + i).padStart(2, '0')}:35`, method, amount: net - (chargedTo === 'Payer' ? Math.round(net * payerCoverage[payer]) : 0), ...(method === 'bKash' ? { reference: `TX${700000 + i * 137}` } : {}), receivedBy: 'Cashier — counter 2' }]
      : [{ id: `pay-${i}-1`, at: `${dayIso}T${String(9 + i).padStart(2, '0')}:35`, method: 'Cash' as PaymentMethod, amount: Math.round(net / 2), receivedBy: 'Cashier — counter 2' }];

    encounters.push({
      id: `OPD-${dayIso.replace(/-/g, '').slice(2)}-${String(410 + i)}`,
      mrn: patient.mrn,
      patientName: patient.name,
      day: dayIso,
      department: doctor.department,
      doctorId: doctor.id,
      doctorName: doctor.name,
      room: doctor.room,
      type: isFollowUp ? 'Follow-up' : 'New',
      consultationCharged: !isFollowUp,
      ...(isFollowUp ? { follows: `OPD-${dayIso.replace(/-/g, '').slice(2)}-${String(400 + i)}` } : {}),
      lines,
      payments: pays,
      status: paidFull ? 'Paid' : 'Partially paid',
      receipt: `R-${dayIso.slice(2, 4)}${dayIso.slice(5, 7)}-${String(7300 + i)}`,
      refunds: [],
    });
  }
  return encounters;
}

/** Every patient's OPD account: what they were billed, what they paid, what is left, and what was refunded. */
export function opdAccount(mrn: string, dayIso: string) {
  const patient = patients.find((p) => p.mrn === mrn);
  const rand = rng([...mrn].reduce((a, c) => a + c.charCodeAt(0), 31337) * 7919);
  const visits: OpdEncounter[] = [];
  const todayEncounter = generateOpdEncounters(dayIso).find((e) => e.mrn === mrn);

  // Past visits, deterministic per patient, so the account has history to reconcile against.
  for (let i = 1; i <= 4; i += 1) {
    const ago = i * 9 + Math.floor(rand() * 5);
    const visitDay = shiftDays(dayIso, -ago);
    const doctor = DOCTORS[Math.floor(rand() * 3)];
    const lines: OpdLine[] = [line(i % 3 === 0 ? 'CONS-FU' : 'CONS-OPD', 1, 'Consultation', 'Patient')];
    if (rand() < 0.7) lines.push(line('LAB-CBC', 1, 'Investigation', 'Patient'));
    if (rand() < 0.5) lines.push(line('LAB-LIPID', 1, 'Investigation', 'Patient'));
    const net = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const unpaid = rand() < 0.25;
    const cancelled = rand() < 0.15;
    visits.push({
      id: `OPD-${visitDay.replace(/-/g, '').slice(2)}-${String(200 + i * 11)}`,
      mrn,
      patientName: patient?.name ?? mrn,
      day: visitDay,
      department: doctor.department,
      doctorId: doctor.id,
      doctorName: doctor.name,
      room: doctor.room,
      type: i % 3 === 0 ? 'Follow-up' : 'New',
      consultationCharged: i % 3 !== 0,
      lines,
      payments: unpaid ? [] : [{ id: `pay-${i}`, at: `${visitDay}T10:20`, method: i % 2 === 0 ? 'Cash' : 'bKash', amount: net, receivedBy: 'Cashier — counter 1' }],
      status: cancelled ? 'Cancelled' : unpaid ? 'Issued' : 'Paid',
      receipt: `R-${visitDay.slice(2, 4)}${visitDay.slice(5, 7)}-${String(6100 + i * 7)}`,
      refunds: cancelled
        ? [{ id: `ref-${i}`, at: `${visitDay}T11:05`, method: i % 2 === 0 ? 'Cash' : 'bKash', amount: net - tar('CONS-OPD').price, because: 'Investigation cancelled by the doctor after the bill was issued; the consultation stands', approvedBy: 'Billing in-charge' }]
        : [],
    });
  }

  const all = [...visits, ...(todayEncounter ? [todayEncounter] : [])].sort((a, b) => b.day.localeCompare(a.day));
  const net = (e: OpdEncounter) => e.lines.reduce((s, l) => s + l.qty * l.unitPrice - Math.round(l.qty * l.unitPrice * (l.discountPct / 100)), 0);
  const billed = all.filter((e) => e.status !== 'Cancelled').reduce((s, e) => s + net(e), 0);
  const paid = all.reduce((s, e) => s + e.payments.reduce((a, p) => a + p.amount, 0), 0);
  const refunded = all.reduce((s, e) => s + e.refunds.reduce((a, r) => a + r.amount, 0), 0);
  const payer = (patient?.payer ?? 'Self pay') as Payer;

  return {
    patient,
    visits: all,
    billed,
    paid,
    refunded,
    due: Math.max(0, billed - paid),
    payerCoverage: payerCoverage[payer],
    narration: [
      `Billed ${money(billed)} across ${all.length} visit(s); paid ${money(paid)}; refunded ${money(refunded)}.`,
      'The account is a ledger of encounters, payments and refunds — not a single balance that nobody can explain.',
    ],
  };
}

/** What a follow-up would cost today, and why: the question the counter is asked most often. */
export function followUpQuote(mrn: string, dayIso: string, department: string): { free: boolean; because: string; on?: string } {
  const account = opdAccount(mrn, dayIso);
  const sameDepartment = account.visits.filter((v) => v.department === department && v.type === 'New' && v.status !== 'Cancelled');
  const last = sameDepartment.sort((a, b) => b.day.localeCompare(a.day))[0];
  if (!last) return { free: false, because: `No earlier visit in ${department} for this patient, so this is a new consultation and the fee applies.` };
  const days = Math.round((new Date(`${dayIso}T00:00:00Z`).getTime() - new Date(`${last.day}T00:00:00Z`).getTime()) / 86_400_000);
  if (days <= FOLLOW_UP_FREE_DAYS) {
    return { free: true, on: last.day, because: `Seen in ${department} on ${last.day}, ${days} day(s) ago — inside the ${FOLLOW_UP_FREE_DAYS}-day window, so the consultation is not charged again.` };
  }
  return { free: false, on: last.day, because: `Last seen in ${department} on ${last.day}, ${days} days ago — outside the ${FOLLOW_UP_FREE_DAYS}-day window, so this is a paid follow-up.` };
}

export interface DiscountCheck {
  ok: boolean;
  needsApproval: boolean;
  message: string;
}

/** The discount rule, as a function so the counter sees the answer before the patient does. */
export function discountCheck(pct: number, reason: string | undefined, approver: string | undefined): DiscountCheck {
  if (pct <= 0) return { ok: true, needsApproval: false, message: 'No discount on this line.' };
  if (!reason?.trim()) {
    return { ok: false, needsApproval: false, message: 'A discount needs a reason on the line. “Management” is not a reason; “hardship, authorised by the medical director” is.' };
  }
  if (pct <= DISCOUNT_LIMIT_PCT) {
    return { ok: true, needsApproval: false, message: `${pct} % is inside the counter's ${DISCOUNT_LIMIT_PCT} % limit and is recorded with your name.` };
  }
  if (!approver?.trim()) {
    return { ok: false, needsApproval: true, message: `${pct} % is above the ${DISCOUNT_LIMIT_PCT} % limit: an approver's name is required on the line before the bill can be issued.` };
  }
  return { ok: true, needsApproval: false, message: `${pct} % approved by ${approver}, recorded on the line where the patient can see it.` };
}

/** The gate the collection desk uses: a sample is not taken on an unpaid, unauthorised bill. */
export function collectionGate(encounter: OpdEncounter): { ok: boolean; message: string } {
  const net = encounter.lines.reduce((s, l) => s + l.qty * l.unitPrice - Math.round(l.qty * l.unitPrice * (l.discountPct / 100)), 0);
  const payer = payerCoverage[patientPayerOf(encounter)];
  const payerLines = encounter.lines.filter((l) => l.chargedTo === 'Payer');
  const authorised = payer > 0 && payerLines.length === encounter.lines.length;
  if (encounter.payments.reduce((a, p) => a + p.amount, 0) >= net) return { ok: true, message: 'Paid in full: the sample may be taken.' };
  if (authorised) return { ok: true, message: `Every line is on ${patientPayerOf(encounter)}: the payer is invoiced and the sample may be taken.` };
  return {
    ok: false,
    message: `Refused: ${money(net)} is outstanding and at least one line is the patient's. The laboratory and the radiology room both refuse a sample on an unpaid, unauthorised bill — the gate is here, not at the door of the collection room.`,
  };
}

const patientPayerOf = (e: OpdEncounter): Payer => (patients.find((p) => p.mrn === e.mrn)?.payer ?? 'Self pay') as Payer;

/** A new encounter skeleton from an appointment, with the consultation line already priced correctly. */
export function draftFromAppointment(mrn: string, dayIso: string, doctorId: string, type: 'New' | 'Follow-up'): OpdEncounter {
  const patient = patients.find((p) => p.mrn === mrn);
  const doctor = DOCTORS.find((d) => d.id === doctorId) ?? DOCTORS[0];
  const quote = followUpQuote(mrn, dayIso, doctor.department);
  const chargeIt = type === 'New' && !quote.free;
  const consultation = chargeIt
    ? line('CONS-OPD', 1, 'Consultation', 'Patient')
    : { ...line('CONS-FU', 1, 'Consultation', 'Patient'), discountPct: 100, discountReason: quote.free ? quote.because : `Follow-up of the same problem — the assessment was already paid for` };
  return {
    id: `OPD-DRAFT-${mrn.slice(-6)}-${Date.now()}`,
    mrn,
    patientName: patient?.name ?? mrn,
    day: dayIso,
    department: doctor.department,
    doctorId: doctor.id,
    doctorName: doctor.name,
    room: doctor.room,
    type,
    consultationCharged: chargeIt,
    lines: [consultation],
    payments: [],
    status: 'Draft',
    refunds: [],
  };
}

/** The invoice shape the billing module understands, so an OPD bill is the same object everywhere. */
export function toInvoice(encounter: OpdEncounter): Invoice {
  const patient = patients.find((p) => p.mrn === encounter.mrn);
  return {
    id: encounter.id,
    number: encounter.receipt ?? `DRAFT-${encounter.mrn.slice(-6)}`,
    mrn: encounter.mrn,
    patientName: encounter.patientName,
    patientNameBn: patient?.nameBn ?? '',
    age: patient?.age ?? 0,
    sex: patient?.sex ?? '',
    payer: (patient?.payer ?? 'Self pay') as Payer,
    counter: 'OPD counter 2',
    createdAt: `${encounter.day}T11:20`,
    status: encounter.status === 'Draft' ? 'Draft' : encounter.status === 'Paid' ? 'Paid' : encounter.status === 'Partially paid' ? 'Partially paid' : 'Issued',
    lines: encounter.lines,
    payments: encounter.payments.map((p) => ({ ...p, method: p.method })),
  };
}

/** Both totals, kept in one place: the bill's own arithmetic and what the patient actually owes. */
export function encounterTotals(e: OpdEncounter) {
  const gross = e.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const discount = e.lines.reduce((s, l) => s + Math.round((l.qty * l.unitPrice * l.discountPct) / 100), 0);
  const net = gross - discount;
  const paid = e.payments.reduce((s, p) => s + p.amount, 0);
  const payer = payerCoverage[patientPayerOf(e)];
  const payerShare = e.lines.filter((l) => l.chargedTo === 'Payer').reduce((s, l) => s + Math.round((l.qty * l.unitPrice - Math.round((l.qty * l.unitPrice * l.discountPct) / 100)) * payer), 0);
  return { gross, discount, net, paid, due: Math.max(0, net - paid), payerShare, patientShare: net - payerShare };
}

export const categoryOf = (c: Category): string => c;

/** Today's OPD collection, for the counter's own tally before the day-end sheet is produced. */
export function opdDayTotals(encounters: OpdEncounter[]) {
  const byMethod = OPD_PAYMENT_METHODS.map((m) => ({
    ...m,
    amount: encounters.flatMap((e) => e.payments).filter((p) => p.method === m.id).reduce((s, p) => s + p.amount, 0),
  })).filter((m) => m.amount > 0);
  const net = encounters.reduce((s, e) => s + encounterTotals(e).net, 0);
  return {
    encounters: encounters.length,
    net,
    collected: encounters.flatMap((e) => e.payments).reduce((s, p) => s + p.amount, 0),
    outstanding: encounters.reduce((s, e) => s + encounterTotals(e).due, 0),
    freeFollowUps: encounters.filter((e) => !e.consultationCharged).length,
    discountedLines: encounters.flatMap((e) => e.lines).filter((l) => l.discountPct > 0 && l.discountPct < 100).length,
    byMethod,
  };
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
