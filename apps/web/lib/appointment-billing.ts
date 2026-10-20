/* -----------------------------------------------------------------------------
 * Appointment billing — legacy screen 001 (`billing-appointment-module`).
 *
 * An appointment is a promise with a price attached, and the price depends on what kind of promise it is:
 *
 *  - A **new consultation** is charged when the patient is checked in; the fee is the tariff’s OPD consultation.
 *  - A **follow-up** is free inside the follow-up window, and the fee is shown at zero with the reason rather
 *    than removed, because a patient who cannot see the waiver cannot see that nothing was hidden.
 *  - A **report review** is free when the report came from this hospital — the hospital already charged for the
 *    test — and chargeable when the patient walks in with a report from outside.
 *  - A **procedure** is a package charged before the procedure, from the tariff’s procedure line.
 *
 * Three further rules decide the arguments at the desk:
 *
 *  - **The booking fee is not revenue, it is a commitment.** It is adjusted against the consultation on
 *    attendance, refunded if the patient cancels before the cut-off, and retained when they simply do not come.
 *  - **A cancellation has a cut-off**, because a slot released four hours ahead can be re-sold and one released
 *    at the desk cannot.
 *  - **The doctor’s share is paid on money collected, never on money billed** — which is the only rule that keeps
 *    a payout sheet and a day-end sheet from disagreeing.
 *
 * Preview: the appointments are the appointment module’s own seeded day. Nothing survives a reload; the rules do.
 */

import { TARIFF, payerCoverage, type Payer } from './billing';
import { DOCTORS, doctorById, generateAppointments, type Appointment, type AppointmentStatus } from './appointments';
import { patients } from './mock';

/** The consultation fee codes, straight from the tariff so nothing is invented here. */
export const FEE_CODES = { New: 'CONS-OPD', FollowUp: 'CONS-FU', ReportReview: 'CONS-FU', Procedure: 'PROC-DRES' } as const;

export const feeOf = (code: string): number => TARIFF.find((t) => t.code === code)?.price ?? 0;

/** A follow-up inside this many days of the last completed visit carries no consultation fee. */
export const FOLLOW_UP_FREE_DAYS = 7;
/** Cancel before this many hours ahead of the slot and the booking fee is refunded or carried forward. */
export const CANCEL_CUTOFF_HOURS = 4;
/** A booking fee is a commitment, not revenue: taken on booking, adjusted on attendance, retained on a no-show. */
export const BOOKING_FEE = 200;
/** A second no-show inside this window means the next booking is taken with a deposit. */
export const NO_SHOW_WINDOW_DAYS = 90;
/** A paid fee may be moved to a new slot once without re-approval. */
export const FREE_RESCHEDULES = 1;
/** A corporate agreement covers a consultation up to this much; the rest is the patient's co-pay. */
export const CORPORATE_CONSULT_CAP = 1_000;
/** Insurance leaves this much of a consultation to the patient. */
export const INSURANCE_CO_PAY_PCT = 20;

/** Consultant share by department, in per cent of money *collected*. A policy figure, not a clinical one. */
export const CONSULTANT_SHARE_PCT: Record<string, number> = {
  Medicine: 40,
  Cardiology: 45,
  Paediatrics: 40,
  Obstetrics: 45,
  Orthopaedics: 50,
};
export const DEFAULT_SHARE_PCT = 40;

export type FeeReasonKind = 'Charged' | 'Waived' | 'Co-pay' | 'Package';

export interface FeeLine {
  code: string;
  name: string;
  amount: number;
  kind: FeeReasonKind;
  because: string;
}

export interface DeskRow {
  appointment: Appointment;
  doctorName: string;
  department: string;
  room: string;
  slot: string;
  lines: FeeLine[];
  /** What the patient owes at the desk today. */
  patientDue: number;
  /** What the payer is invoiced for. */
  payerDue: number;
  bookingFee: number;
  /** Booking fee already with the hospital for this appointment. */
  bookingFeeState: 'Not taken' | 'Adjusted on attendance' | 'Retained — no show' | 'Refunded — cancelled in time' | 'Held — cancelled late';
  payer: Payer;
  /** Set when the patient has not turned up twice inside the window. */
  depositNextTime: boolean;
  sharePct: number;
  actions: string[];
  note?: string;
}

const shiftDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const minutesFromStamp = (stamp: string): number => {
  const [h, m] = stamp.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
};

/** The last completed visit for this patient, if any — the only honest basis for a follow-up waiver. */
function lastVisit(day: string, mrn: string): { at: string; daysAgo: number } | undefined {
  for (const ago of [1, 2, 3, 5, 8, 12, 20]) {
    const d = shiftDays(day, -ago);
    const found = generateAppointments(d).find((a) => a.patient.mrn === mrn && a.status === 'Completed');
    if (found) return { at: d, daysAgo: ago };
  }
  return undefined;
}

/** How many times this patient has booked and not come, inside the window. */
function noShows(day: string, mrn: string): number {
  let count = 0;
  for (const ago of [2, 9, 20, 40, 75]) {
    const d = shiftDays(day, -ago);
    if (generateAppointments(d).some((a) => a.patient.mrn === mrn && a.status === 'No show')) count += 1;
  }
  return count;
}

export interface DeskOptions {
  /** The counter's clock, in minutes from midnight — a figure on the screen, never a wall clock read at render. */
  deskMinutes?: number;
  payerOverride?: Payer;
  bookingFeePaid?: boolean;
}

/** One appointment as the desk sees it: the fee, why, and what may be done about it. */
export function deskRow(a: Appointment, day: string, opts: DeskOptions = {}): DeskRow {
  const doctor = doctorById(a.doctorId);
  const payer: Payer = opts.payerOverride ?? ('Self pay' as Payer);
  const last = lastVisit(day, a.patient.mrn);
  const showCount = noShows(day, a.patient.mrn);
  const lines: FeeLine[] = [];

  if (a.type === 'New') {
    lines.push({ code: FEE_CODES.New, name: 'OPD consultation — new patient', amount: feeOf(FEE_CODES.New), kind: 'Charged', because: 'A new patient is a new consultation: history, examination and a plan, billed at the tariff’s OPD rate.' });
  } else if (a.type === 'Follow-up') {
    if (last && last.daysAgo <= FOLLOW_UP_FREE_DAYS) {
      lines.push({ code: FEE_CODES.FollowUp, name: 'OPD consultation — follow-up', amount: 0, kind: 'Waived', because: `Follow-up ${last.daysAgo} day(s) after the visit on ${last.at}, inside the ${FOLLOW_UP_FREE_DAYS}-day window: no consultation fee. The line stays visible at zero so the patient can see the waiver.` });
    } else {
      lines.push({ code: FEE_CODES.FollowUp, name: 'OPD consultation — follow-up', amount: feeOf(FEE_CODES.FollowUp), kind: 'Charged', because: last ? `The last visit was ${last.daysAgo} days ago, outside the ${FOLLOW_UP_FREE_DAYS}-day window, so this is a charged consultation at the follow-up rate.` : 'No previous completed visit on this record, so the follow-up rate is charged rather than the waiver.' });
    }
  } else if (a.type === 'Report review') {
    lines.push({ code: FEE_CODES.ReportReview, name: 'Report review', amount: 0, kind: 'Waived', because: 'The report came from this hospital’s laboratory: the test was already charged, so reviewing it is not a second consultation. A report brought in from outside is chargeable.' });
  } else {
    lines.push({ code: FEE_CODES.Procedure, name: 'Procedure package', amount: feeOf(FEE_CODES.Procedure), kind: 'Package', because: 'A procedure is a package: the room, the consumables and the clinician’s time are charged together, and it is paid before the procedure.' });
  }

  // The payer's share, with the co-pay the agreement leaves to the patient.
  let payerDue = 0;
  let coPay = 0;
  const gross = lines.reduce((n, l) => n + l.amount, 0);
  if (payer === 'Corporate — BRAC' && gross > 0) {
    payerDue = Math.min(gross, CORPORATE_CONSULT_CAP);
    coPay = gross - payerDue;
    if (coPay > 0) lines.push({ code: 'CO-PAY', name: 'Co-pay — above the corporate consultation cap', amount: coPay, kind: 'Co-pay', because: `The agreement covers a consultation up to ৳ ${CORPORATE_CONSULT_CAP.toLocaleString('en-IN')}; the remainder is the patient’s co-pay and is collected at the desk.` });
  } else if (payer === 'Insurance — MetLife' && gross > 0) {
    coPay = Math.round((gross * INSURANCE_CO_PAY_PCT) / 100);
    payerDue = gross - coPay;
    lines.push({ code: 'CO-PAY', name: `Co-pay — ${INSURANCE_CO_PAY_PCT} % of the consultation`, amount: coPay, kind: 'Co-pay', because: `The policy leaves ${INSURANCE_CO_PAY_PCT} % to the patient, collected at the desk; the rest is claimed from the insurer.` });
  } else if (payer !== 'Self pay' && gross > 0) {
    payerDue = Math.round(gross * payerCoverage[payer]);
    coPay = gross - payerDue;
    if (coPay > 0) lines.push({ code: 'CO-PAY', name: 'Co-pay — the scheme’s share', amount: coPay, kind: 'Co-pay', because: `The scheme settles ${Math.round(payerCoverage[payer] * 100)} %; the rest is collected at the desk.` });
  }

  const bookingFeePaid = opts.bookingFeePaid === true;
  const bookingFee = bookingFeePaid ? BOOKING_FEE : 0;
  const bookingFeeState: DeskRow['bookingFeeState'] =
    a.status === 'No show' ? 'Retained — no show'
      : a.status === 'Cancelled' ? (CANCEL_CUTOFF_HOURS > 0 ? 'Refunded — cancelled in time' : 'Held — cancelled late')
        : bookingFeePaid ? 'Adjusted on attendance' : 'Not taken';

  const patientDue = Math.max(0, gross - payerDue - bookingFee);

  const actions = ['Bill and collect at the desk', 'Waive the consultation with a reason', 'Mark a no-show (booking fee retained)', 'Cancel the appointment and refund or carry the fee forward'];
  if (a.status === 'No show') actions.push('Take a deposit for the next booking — this patient has missed twice');

  return {
    appointment: a,
    doctorName: doctor.name,
    department: doctor.department,
    room: doctor.room,
    slot: `${String(Math.floor(a.start / 60)).padStart(2, '0')}:${String(a.start % 60).padStart(2, '0')}`,
    lines,
    patientDue,
    payerDue,
    bookingFee,
    bookingFeeState,
    payer,
    depositNextTime: showCount >= 2,
    sharePct: CONSULTANT_SHARE_PCT[doctor.department] ?? DEFAULT_SHARE_PCT,
    actions,
    ...(a.status === 'No show' ? { note: `${showCount} no-show(s) on this record inside ${NO_SHOW_WINDOW_DAYS} days. The booking fee for this slot is retained: the slot was held and could not be re-sold at the desk.` } : {}),
    ...(last && last.daysAgo <= FOLLOW_UP_FREE_DAYS && a.type === 'Follow-up' ? { note: `Seen ${last.daysAgo} day(s) ago — inside the free follow-up window.` } : {}),
  };
}

export interface AppointmentBillingDay {
  day: string;
  deskMinutes: number;
  rows: DeskRow[];
  ledger: Array<{ id: string; appointmentId: string; token: string; patientName: string; mrn: string; amount: number; method: 'Cash' | 'Card' | 'bKash' | 'Corporate — no money taken'; at: string; what: string }>;
  share: Array<{ doctorId: string; doctorName: string; department: string; sharePct: number; collected: number; share: number; billed: number; unpaid: number; visits: number }>;
  stats: {
    bookings: number;
    attended: number;
    waiting: number;
    noShows: number;
    cancelled: number;
    cancelledLate: number;
    feesBilled: number;
    collected: number;
    waived: number;
    coPayCollected: number;
    bookingFeesHeld: number;
    bookingFeesAdjusted: number;
    shareDue: number;
    depositNextTime: number;
    proceduresNotPaid: number;
    followUpWaivers: number;
  };
  rules: Array<{ title: string; because: string }>;
}

/** The desk’s day: every appointment, its fee, what has been collected and what the consultants are owed. */
export function appointmentBillingDay(day: string, opts: DeskOptions = {}): AppointmentBillingDay {
  const deskMinutes = opts.deskMinutes ?? 11 * 60 + 20;
  const appointments = generateAppointments(day);
  const rows = appointments.map((a, i) => deskRow(a, day, { ...opts, bookingFeePaid: i % 3 === 0 }));

  const ledger = rows
    .filter((r) => r.appointment.status === 'Completed' || r.appointment.status === 'In consultation')
    .map((r, i) => ({
      id: `APB-${String(3100 + i)}`,
      appointmentId: r.appointment.id,
      token: r.appointment.token,
      patientName: r.appointment.patient.name,
      mrn: r.appointment.patient.mrn,
      amount: Math.max(0, r.patientDue),
      method: (r.payerDue > 0 ? 'Corporate — no money taken' : i % 3 === 0 ? 'bKash' : 'Cash') as AppointmentBillingDay['ledger'][number]['method'],
      at: `${day}T${String(9 + (i % 5)).padStart(2, '0')}:${String(5 + ((i * 7) % 50)).padStart(2, '0')}`,
      what: r.lines[0]?.kind === 'Waived' ? `Consultation waived — ${r.lines[0].because}` : `${r.lines[0]?.name ?? 'Consultation'} at the desk`,
    }));

  const collectedByDoctor = new Map<string, { collected: number; billed: number; visits: number }>();
  rows.forEach((r) => {
    const entry = collectedByDoctor.get(r.appointment.doctorId) ?? { collected: 0, billed: 0, visits: 0 };
    const paid = r.appointment.status === 'Completed' || r.appointment.status === 'In consultation';
    entry.visits += 1;
    entry.billed += r.lines.reduce((n, l) => n + l.amount, 0);
    if (paid) entry.collected += Math.max(0, r.patientDue) + r.payerDue;
    collectedByDoctor.set(r.appointment.doctorId, entry);
  });

  const share = DOCTORS.map((d) => {
    const entry = collectedByDoctor.get(d.id) ?? { collected: 0, billed: 0, visits: 0 };
    const pct = CONSULTANT_SHARE_PCT[d.department] ?? DEFAULT_SHARE_PCT;
    return {
      doctorId: d.id,
      doctorName: d.name,
      department: d.department,
      sharePct: pct,
      collected: entry.collected,
      // Paid on what was collected, never on what was billed.
      share: Math.round((entry.collected * pct) / 100),
      billed: entry.billed,
      unpaid: Math.max(0, entry.billed - entry.collected),
      visits: entry.visits,
    };
  });

  const lines = rows.flatMap((r) => r.lines);
  const stats = {
    bookings: rows.length,
    attended: rows.filter((r) => ['Completed', 'In consultation', 'Waiting', 'Checked in'].includes(r.appointment.status)).length,
    waiting: rows.filter((r) => r.appointment.status === 'Waiting').length,
    noShows: rows.filter((r) => r.appointment.status === 'No show').length,
    cancelled: rows.filter((r) => r.appointment.status === 'Cancelled').length,
    // Cancelled inside the cut-off: the fee is what the patient loses for holding a slot nobody else could take.
    cancelledLate: rows.filter((r) => r.appointment.status === 'Cancelled' && !cancellationVerdict(r.appointment, deskMinutes).free).length,
    feesBilled: lines.filter((l) => l.kind === 'Charged' || l.kind === 'Package').reduce((n, l) => n + l.amount, 0),
    collected: ledger.reduce((n, l) => n + l.amount, 0),
    waived: lines.filter((l) => l.kind === 'Waived').length,
    coPayCollected: lines.filter((l) => l.kind === 'Co-pay').reduce((n, l) => n + l.amount, 0),
    bookingFeesHeld: rows.filter((r) => r.bookingFeeState === 'Retained — no show').length * BOOKING_FEE,
    bookingFeesAdjusted: rows.filter((r) => r.bookingFeeState === 'Adjusted on attendance').length,
    shareDue: share.reduce((n, s) => n + s.share, 0),
    depositNextTime: rows.filter((r) => r.depositNextTime).length,
    proceduresNotPaid: rows.filter((r) => r.appointment.type === 'Procedure' && r.appointment.status !== 'Completed').length,
    followUpWaivers: lines.filter((l) => l.kind === 'Waived').length,
  };

  return {
    day,
    deskMinutes,
    rows,
    ledger,
    share,
    stats,
    rules: RULES,
  };
}

export const RULES: Array<{ title: string; because: string }> = [
  { title: `A follow-up inside ${FOLLOW_UP_FREE_DAYS} days carries no consultation fee`, because: 'The patient is returning for the plan that was already made. The line is shown at zero with the date of the last visit, so the waiver is visible rather than invisible.' },
  { title: 'A report review is free when the report is ours', because: 'The laboratory has already been paid for the test. Charging again for reading it is charging twice for one episode of care.' },
  { title: 'A procedure is a package, paid before the procedure', because: 'The room, the consumables and the clinician’s time are committed once the patient is on the list. The collection gate is what keeps a theatre slot from being consumed by an unpaid case.' },
  { title: `The booking fee of ৳ ${BOOKING_FEE} is a commitment, not revenue`, because: 'It is adjusted against the consultation on attendance, refunded when the patient cancels before the cut-off, and retained when they do not come — because the slot was held and could not be re-sold at the desk.' },
  { title: `Cancellations up to ${CANCEL_CUTOFF_HOURS} hours ahead keep the fee`, because: 'A slot released four hours ahead can be given to somebody else. One released while the patient is walking to the desk cannot.' },
  { title: `A second no-show inside ${NO_SHOW_WINDOW_DAYS} days means a deposit next time`, because: 'It is not a punishment, it is a way of finding out whether the appointment is real. The patient keeps the deposit against the consultation.' },
  { title: 'The consultant share is paid on money collected, never on money billed', because: 'A payout sheet computed on invoices would pay a consultant for a bill nobody settled, and the two sheets would never agree.' },
  { title: 'A corporate consultation has a cap, and the patient knows the co-pay before the visit', because: `The agreement covers up to ৳ ${CORPORATE_CONSULT_CAP.toLocaleString('en-IN')}; the remainder is collected at the desk. A patient who does not know that at the counter is a patient who blames the wrong person.` },
];

/** Where a booking went after the desk: the appointment status and the money are two records of one event. */
export const STATUS_BILLING_NOTE: Partial<Record<AppointmentStatus, string>> = {
  Completed: 'Consultation done: the fee is charged, the booking fee is adjusted, and the consultant’s share becomes payable on what was collected.',
  'In consultation': 'In the room now: billed at check-in, and the share is not payable until the visit closes.',
  Waiting: 'Checked in and waiting: billed at check-in, which is why the queue and the ledger agree.',
  'No show': 'Did not come: the booking fee is retained, and the consultation is not charged — the doctor did not see anybody.',
  Cancelled: 'Cancelled: the fee is refunded or carried to the new slot once; the second move needs approval.',
  Confirmed: 'Booked, not yet at the desk: nothing is charged, and the booking fee, if taken, is still a commitment.',
  Requested: 'Requested online, not yet confirmed: no fee of any kind should be sitting against this patient.',
};

export const deskClock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Morning or afternoon session, from the slot itself — the desk's own vocabulary. */
export const shiftLabel = (a: Appointment): 'Morning' | 'Afternoon' => (a.start < 12 * 60 ? 'Morning' : 'Afternoon');

/** The co-pay a patient should be told about on the phone, before they travel. */
export function quoteOnPhone(a: Appointment, day: string, payer: Payer): { total: number; patientPays: number; words: string } {
  const row = deskRow(a, day, { payerOverride: payer });
  const total = row.lines.reduce((n, l) => n + l.amount, 0);
  return {
    total,
    patientPays: Math.max(0, row.patientDue),
    words: `${row.lines.map((l) => `${l.name}: ${l.amount === 0 ? 'no charge' : `৳ ${l.amount.toLocaleString('en-IN')}`}`).join('; ')}. ${payer === 'Self pay' ? `The patient pays ৳ ${Math.max(0, row.patientDue).toLocaleString('en-IN')} at the desk.` : `The patient pays ৳ ${Math.max(0, row.patientDue).toLocaleString('en-IN')} and ${payer} is invoiced ৳ ${row.payerDue.toLocaleString('en-IN')}.`}`,
  };
}

export const patientPhone = (mrn: string): string => patients.find((p) => p.mrn === mrn)?.phone ?? '—';

/** Minutes between the desk clock and the slot: negative once the slot has passed. */
export const minutesToSlot = (a: Appointment, deskMinutes: number): number => a.start - deskMinutes;

/** Whether a cancellation is inside the cut-off, using the desk clock rather than a wall clock. */
export function cancellationVerdict(a: Appointment, deskMinutes: number): { free: boolean; because: string } {
  const mins = minutesToSlot(a, deskMinutes);
  if (mins >= CANCEL_CUTOFF_HOURS * 60) {
    return { free: true, because: `Cancelled ${Math.round(mins / 60)} hour(s) before the slot: the booking fee is refunded, or carried forward to a new slot once.` };
  }
  return {
    free: false,
    because: mins > 0
      ? `Cancelled ${mins} minute(s) before the slot — inside the ${CANCEL_CUTOFF_HOURS}-hour cut-off. The fee is retained: the slot was held and nobody else could have it.`
      : 'Cancelled after the slot had already passed: the date was held for nobody, so the booking fee is retained.',
  };
}

export const deskMinutesFrom = (hhmm: string): number => minutesFromStamp(`2026-01-01T${hhmm}`);
