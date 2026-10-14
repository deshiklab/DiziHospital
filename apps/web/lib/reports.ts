/* -----------------------------------------------------------------------------
 * Reports and dashboards (P6) — the numbers, and where each one came from.
 *
 * A management report is only as good as its least honest line, so three rules run through this module:
 *
 *  1. **Every figure carries its definition and an as-of stamp.** A number on a dashboard with no definition is
 *     an argument waiting to happen, and one with no timestamp is worse: it invites a decision on yesterday's
 *     data without saying so.
 *  2. **Gross, discount and net are never conflated**, and cash is reported separately from everything else —
 *     cash is the only figure that has to agree with a drawer at the end of the day.
 *  3. **The data-quality tab is part of the report, not an apology for it.** Counts of duplicates, signed notes
 *     without a diagnosis and invoices left unpaid are the report's own credibility statement.
 *
 * Stock is a point-in-time figure and says so; everything else is aggregated over the selected range by running
 * the same deterministic generators the operational screens use, so a figure on this page and the record it came
 * from cannot drift apart.
 */

import { doctorById, generateAppointments, shiftDays, type Appointment } from './appointments';
import { generateEncounters } from './clinical';
import { generateDiagnosticOrders, generateQc, needsCallback, testByCode, tatStatus } from './diagnostics';
import { controlledRegister, generateBatches, generateDispenses, generateLedger, type Dispense } from './pharmacy';
import { dayEnd, generateInvoices, totals, type Invoice } from './billing';
import { expiringBatches, generateInventory, stockValue, usableQty } from './inventory';
import { patients } from './mock';

export type RangeId = 'today' | 'week' | 'month';

export const RANGES: Array<{ id: RangeId; label: string; days: number; note: string }> = [
  { id: 'today', label: 'Today', days: 1, note: 'the shift in progress' },
  { id: 'week', label: 'Last 7 days', days: 7, note: 'the usual management view' },
  { id: 'month', label: 'Last 30 days', days: 30, note: 'for trends, not for today’s decisions' },
];

/** A labelled number for the rank lists and the bar charts. */
export interface Named {
  label: string;
  value: number;
  /** Optional second number shown after the first, e.g. a percentage. */
  extra?: string;
}

export interface Metric {
  label: string;
  value: string;
  /** What the number means, in one sentence — shown under the tile, not in a tooltip nobody opens. */
  definition: string;
  asOf: string;
  footnote?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'critical';
}

export interface DataQualityFinding {
  id: string;
  area: string;
  finding: string;
  count: number;
  impact: string;
  owner: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface ReportsSnapshot {
  range: RangeId;
  rangeLabel: string;
  days: string[];
  asOf: string;
  /** Point-in-time: stock is not aggregated over a range and says so. */
  stockAsOf: string;

  visits: {
    appointments: number;
    attended: number;
    noShow: number;
    cancelled: number;
    bySource: Named[];
    perDay: Named[];
    noShowPct: number;
  };

  clinical: {
    encounters: number;
    signed: number;
    waiting: number;
    withDiagnosis: number;
    prescriptions: number;
    rxLines: number;
    topDiagnoses: Named[];
    byDoctor: Named[];
  };

  diagnostics: {
    ordered: number;
    resulted: number;
    rejected: number;
    rejections: Named[];
    criticals: number;
    callbacksRecorded: number;
    withinTarget: number;
    withResult: number;
    avgTurnaroundHours: number | null;
    qcRuns: number;
    qcPassed: number;
    overdueOpen: number;
    byTest: Named[];
    collectionRate: number;
  };

  pharmacy: {
    dispenses: number;
    dispensed: number;
    partial: number;
    returned: number;
    substitutedLines: number;
    controlledEntries: number;
    stockValue: number;
    byStore: Named[];
    expiringBatches: number;
    expiringValue: number;
    belowReorder: number;
    writeOffs: Named[];
  };

  revenue: {
    invoices: number;
    cancelled: number;
    gross: number;
    discount: number;
    net: number;
    collected: number;
    due: number;
    cashExpected: number;
    byMethod: Named[];
    byPayer: Named[];
    byCategory: Named[];
    /** Day by day: collected, with the cash expected in the drawer beside it. */
    perDay: Named[];
    discountAboveLimit: number;
    approvals: Named[];
    cancellationReasons: Named[];
  };

  dataQuality: DataQualityFinding[];
}

/* ------------------------------------------------------------------ small helpers */

const hoursBetween = (from: string, to: string): number | null => {
  const a = new Date(`${from.replace(' ', 'T')}:00`);
  const b = new Date(`${to.replace(' ', 'T')}:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return (b.getTime() - a.getTime()) / 3_600_000;
};

const rank = (counts: Map<string, number>, limit = 8): Named[] =>
  [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);

const bump = (counts: Map<string, number>, key: string, by = 1) => counts.set(key, (counts.get(key) ?? 0) + by);

const money = (n: number) => `৳${Math.round(n).toLocaleString('en-US')}`;

/* ------------------------------------------------------------------ the snapshot */

export function buildSnapshot(range: RangeId, dayIso: string): ReportsSnapshot {
  const config = RANGES.find((r) => r.id === range) ?? RANGES[2];
  const days = Array.from({ length: config.days }, (_, i) => shiftDays(dayIso, i - (config.days - 1)));

  /* ---- visits */
  const appointmentsByDay: Appointment[][] = days.map((d) => generateAppointments(d));
  const appts: Appointment[] = appointmentsByDay.flat();
  const bySource = new Map<string, number>();
  for (const a of appts) bump(bySource, a.source);
  const attended = appts.filter((a) => ['Checked in', 'Waiting', 'In consultation', 'Completed'].includes(a.status)).length;
  const noShow = appts.filter((a) => a.status === 'No show').length;
  const cancelled = appts.filter((a) => a.status === 'Cancelled').length;
  const perDay = days.map((d, i) => {
    const ofDay = appointmentsByDay[i];
    return {
      label: d.slice(5),
      value: ofDay.filter((a) => ['Checked in', 'Waiting', 'In consultation', 'Completed'].includes(a.status)).length,
      extra: `${ofDay.length} booked`,
    };
  });

  /* ---- clinical */
  const encounters = days.flatMap((d) => generateEncounters(d));
  const signed = encounters.filter((e) => e.status === 'Signed');
  const diagnoses = new Map<string, number>();
  for (const e of signed) for (const dx of e.diagnoses) bump(diagnoses, `${dx.code} · ${dx.label}`);
  const byDoctor = new Map<string, number>();
  for (const e of encounters) bump(byDoctor, doctorById(e.doctorId)?.name ?? e.doctorId);

  /* ---- diagnostics */
  const orders = days.flatMap((d) => generateDiagnosticOrders(d));
  const rejections = new Map<string, number>();
  for (const o of orders) if (o.rejection) bump(rejections, o.rejection.reason);
  const byTest = new Map<string, number>();
  for (const o of orders) bump(byTest, o.testName);
  const criticals = orders.filter((o) => needsCallback(o));
  const callbacksRecorded = criticals.filter((o) => o.callback).length;
  const resulted = orders.filter((o) => o.resultedAt);
  const turnarounds = resulted
    .map((o) => hoursBetween(o.orderedAt, o.resultedAt as string))
    .filter((h): h is number => h !== null);
  const withinTarget = resulted.filter((o) => {
    const hours = hoursBetween(o.orderedAt, o.resultedAt as string);
    const target = testByCode(o.testCode)?.tatHours ?? 24;
    return hours !== null && hours <= target;
  }).length;
  const qc = days.flatMap((d) => generateQc(d));
  const overdueOpen = orders.filter((o) => !o.resultedAt && tatStatus(o, `${dayIso} 23:59`).tone === 'critical').length;
  const collected = orders.filter((o) => o.status !== 'Ordered').length;

  /* ---- pharmacy and stores */
  const dispenses: Dispense[] = days.flatMap((d) => generateDispenses(d));
  const batchesForDay = generateBatches(dayIso);
  const controlled = days.flatMap((d) => controlledRegister(generateDispenses(d), batchesForDay, d)).length;
  const ledger = days.flatMap((d) => generateLedger(d, batchesForDay, generateDispenses(d)));
  const writeOffs = new Map<string, number>();
  for (const m of ledger) if (m.kind.startsWith('Write-off')) bump(writeOffs, m.kind, Math.abs(m.qty));
  const substitutedLines = dispenses.flatMap((d) => d.lines).filter((l) => Boolean(l.substitution)).length;

  /* Stock is a point-in-time figure: one inventory build, stamped with today. */
  const inventory = generateInventory(dayIso);
  const byStore = new Map<string, number>();
  for (const b of inventory.batches) bump(byStore, b.store, b.qty * b.unitCost);
  const expiring = expiringBatches(inventory.batches, dayIso);
  const belowReorder = inventory.items.filter((i) => usableQty(inventory.batches, i.id, dayIso) <= i.reorderLevel).length;

  /* ---- revenue */
  const invoices: Invoice[] = days.flatMap((d) => generateInvoices(d));
  const live = invoices.filter((i) => i.status !== 'Cancelled');
  const dayEnds = days.map((d) => dayEnd(generateInvoices(d)));
  const gross = dayEnds.reduce((s, e) => s + e.gross, 0);
  const discount = dayEnds.reduce((s, e) => s + e.discount, 0);
  const net = dayEnds.reduce((s, e) => s + e.net, 0);
  const collectedTotal = dayEnds.reduce((s, e) => s + e.collected, 0);
  const due = dayEnds.reduce((s, e) => s + e.due, 0);
  const cashExpected = dayEnds.reduce((s, e) => s + e.cashExpected, 0);
  const byMethod = new Map<string, number>();
  const byPayer = new Map<string, number>();
  const byCategory = new Map<string, number>();
  for (const e of dayEnds) {
    for (const m of e.byMethod) bump(byMethod, m.method, m.amount);
    for (const c of e.byCategory) bump(byCategory, c.category, c.amount);
  }
  for (const inv of live) bump(byPayer, inv.payer, totals(inv).net);
  const approvals = new Map<string, number>();
  let discountAboveLimit = 0;
  for (const inv of live) {
    for (const l of inv.lines) {
      if (l.discountPct > 15) {
        discountAboveLimit += 1;
        bump(approvals, inv.approvedBy ?? 'Not recorded');
      }
    }
  }
  const cancellationReasons = new Map<string, number>();
  for (const inv of invoices) if (inv.status === 'Cancelled') bump(cancellationReasons, inv.cancelledReason ?? 'No reason recorded');

  /* ---- data quality, the report's own credibility statement */
  const duplicated = new Map<string, number>();
  for (const p of patients) bump(duplicated, `${p.name}|${p.phone}`);
  const duplicateGroups = [...duplicated.values()].filter((n) => n > 1).length;
  const missingPhone = patients.filter((p) => !p.phone || p.phone.replace(/\D/g, '').length < 6).length;
  const signedWithoutDiagnosis = signed.filter((e) => e.diagnoses.length === 0).length;
  const apptNoPhone = appts.filter((a) => !a.patient.phone).length;
  const unpaid = live.filter((i) => i.status === 'Partially paid' && totals(i).due > 0);

  const dataQuality: DataQualityFinding[] = [
    {
      id: 'dq-duplicates',
      area: 'Registration',
      finding: 'Patients who share a name and a phone number',
      count: duplicateGroups,
      impact: 'Each one is a possible duplicate record: a second MRN means a split history and a repeated test.',
      owner: 'Reception — merge at the desk, with the patient present',
      severity: duplicateGroups > 0 ? 'warning' : 'info',
    },
    {
      id: 'dq-phone',
      area: 'Registration',
      finding: 'Patient records with no usable phone number',
      count: missingPhone,
      impact: 'No phone means no SMS for a report, no reminder for a follow-up, no call-back for a critical value.',
      owner: 'Reception — capture on the next visit',
      severity: missingPhone > 0 ? 'warning' : 'info',
    },
    {
      id: 'dq-appt-phone',
      area: 'Appointments',
      finding: 'Bookings in this range with no contact number',
      count: apptNoPhone,
      impact: 'A no-show that nobody could have reminded is not a patient problem.',
      owner: 'Appointment desk',
      severity: apptNoPhone > 0 ? 'info' : 'info',
    },
    {
      id: 'dq-dx',
      area: 'Clinical',
      finding: 'Signed notes with no coded diagnosis',
      count: signedWithoutDiagnosis,
      impact: 'Uncoded diagnoses make the morbidity report guesswork and break the ICD-based billing rules.',
      owner: 'Clinical lead — raise it at the audit meeting, not by editing signed notes',
      severity: signedWithoutDiagnosis > 0 ? 'warning' : 'info',
    },
    {
      id: 'dq-lab-overdue',
      area: 'Laboratory',
      finding: 'Collected specimens past their turnaround target with no result',
      count: overdueOpen,
      impact: 'The clinician is waiting and does not know it; the ward will telephone the lab to ask.',
      owner: 'Laboratory — work the worklist by deadline, not by arrival',
      severity: overdueOpen > 0 ? 'critical' : 'info',
    },
    {
      id: 'dq-unpaid',
      area: 'Billing',
      finding: 'Invoices part-paid with a balance outstanding',
      count: unpaid.length,
      impact: `Outstanding on these: ${money(unpaid.reduce((s, i) => s + totals(i).due, 0))}. An invoice nobody follows up is a write-off with extra steps.`,
      owner: 'Billing officer — follow up within seven days',
      severity: unpaid.length > 0 ? 'warning' : 'info',
    },
    {
      id: 'dq-stock',
      area: 'Stores',
      finding: 'Items at or below reorder level',
      count: belowReorder,
      impact: 'Stock-outs are why a patient is sent to a shop outside the hospital for a medicine the hospital stocks.',
      owner: 'Store — the replenishment list is on the stores screen',
      severity: belowReorder > 0 ? 'warning' : 'info',
    },
    {
      id: 'dq-stock-expiry',
      area: 'Stores',
      finding: 'Batches expiring within 90 days',
      count: expiring.length,
      impact: `${money(expiring.reduce((s, b) => s + b.qty * b.unitCost, 0))} at risk — use it first, or return it short-dated.`,
      owner: 'Store — FEFO picking and the expiry report',
      severity: expiring.length > 0 ? 'warning' : 'info',
    },
  ];

  return {
    range: config.id,
    rangeLabel: config.label,
    days,
    /* The as-of stamp is the day the data belongs to, and nothing else: a wall clock here would read one time in
       the server-rendered HTML and another in the browser, and React throws the whole tree away on a mismatch.
       The generation time the reader cares about is shown by the screen, once, from an effect. */
    asOf: dayIso,
    stockAsOf: dayIso,
    visits: {
      appointments: appts.length,
      attended,
      noShow,
      cancelled,
      bySource: rank(bySource),
      perDay,
      noShowPct: appts.length > 0 ? Math.round((noShow / appts.length) * 1000) / 10 : 0,
    },
    clinical: {
      encounters: encounters.length,
      signed: signed.length,
      waiting: encounters.length - signed.length,
      withDiagnosis: signed.filter((e) => e.diagnoses.length > 0).length,
      prescriptions: signed.filter((e) => e.rx.length > 0).length,
      rxLines: signed.reduce((s, e) => s + e.rx.length, 0),
      topDiagnoses: rank(diagnoses, 10),
      byDoctor: rank(byDoctor),
    },
    diagnostics: {
      ordered: orders.length,
      resulted: resulted.length,
      rejected: orders.filter((o) => o.status === 'Rejected').length,
      rejections: rank(rejections),
      criticals: criticals.length,
      callbacksRecorded,
      withinTarget,
      withResult: resulted.length,
      avgTurnaroundHours: turnarounds.length ? Math.round((turnarounds.reduce((s, h) => s + h, 0) / turnarounds.length) * 10) / 10 : null,
      qcRuns: qc.length,
      qcPassed: qc.filter((r) => r.passed).length,
      overdueOpen,
      byTest: rank(byTest),
      collectionRate: orders.length > 0 ? Math.round((collected / orders.length) * 100) : 0,
    },
    pharmacy: {
      dispenses: dispenses.length,
      dispensed: dispenses.filter((d) => d.status === 'Dispensed').length,
      partial: dispenses.filter((d) => d.status === 'Partially dispensed').length,
      returned: dispenses.filter((d) => d.status === 'Returned').length,
      substitutedLines,
      controlledEntries: controlled,
      stockValue: stockValue(inventory.batches),
      byStore: rank(byStore),
      expiringBatches: expiring.length,
      expiringValue: expiring.reduce((s, b) => s + b.qty * b.unitCost, 0),
      belowReorder,
      writeOffs: rank(writeOffs),
    },
    revenue: {
      invoices: invoices.length,
      cancelled: invoices.length - live.length,
      gross,
      discount,
      net,
      collected: collectedTotal,
      due,
      cashExpected,
      byMethod: rank(byMethod),
      byPayer: rank(byPayer),
      byCategory: rank(byCategory),
      perDay: days.map((d, i) => ({ label: d.slice(5), value: Math.round(dayEnds[i].collected), extra: `cash ${money(dayEnds[i].cashExpected)}` })),
      discountAboveLimit,
      approvals: rank(approvals),
      cancellationReasons: rank(cancellationReasons),
    },
    dataQuality,
  };
}

/* ------------------------------------------------------------------ the tiles, in one place */

export function overviewMetrics(s: ReportsSnapshot): Metric[] {
  return [
    {
      label: 'Patients seen',
      value: String(s.visits.attended),
      definition: 'Appointments that reached check-in or beyond, over the selected range.',
      asOf: s.asOf,
      footnote: `${s.visits.appointments} booked · ${s.visits.noShow} no-show (${s.visits.noShowPct} %)`,
      tone: s.visits.noShowPct > 12 ? 'warning' : 'neutral',
    },
    {
      label: 'Consultations signed',
      value: String(s.clinical.signed),
      definition: 'Notes signed by the clinician. A signed note takes addenda, never edits.',
      asOf: s.asOf,
      footnote: `${s.clinical.waiting} still waiting or in the room`,
    },
    {
      label: 'Prescriptions',
      value: String(s.clinical.prescriptions),
      definition: 'Signed consultations that carried at least one medicine.',
      asOf: s.asOf,
      footnote: `${s.clinical.rxLines} medicine lines in total`,
    },
    {
      label: 'Collected in cash and digital',
      value: money(s.revenue.collected),
      definition: 'Payments taken against live invoices. Cancelled invoices are excluded, not netted off.',
      asOf: s.asOf,
      footnote: `Cash expected in the drawer: ${money(s.revenue.cashExpected)}`,
      tone: 'success',
    },
    {
      label: 'Outstanding',
      value: money(s.revenue.due),
      definition: 'The patient share of live invoices that has not been paid yet.',
      asOf: s.asOf,
      footnote: `${s.revenue.invoices} invoices · ${s.revenue.cancelled} cancelled`,
      tone: s.revenue.due > 0 ? 'warning' : 'neutral',
    },
    {
      label: 'Lab turnaround compliance',
      value: s.diagnostics.resulted > 0 ? `${Math.round((s.diagnostics.withinTarget / s.diagnostics.resulted) * 100)} %` : '—',
      definition: 'Reports released inside the test’s own turnaround target, measured from order to result.',
      asOf: s.asOf,
      footnote: s.diagnostics.avgTurnaroundHours !== null ? `Average ${s.diagnostics.avgTurnaroundHours} h per reporter` : 'Nothing resulted in this range',
      tone: s.diagnostics.overdueOpen > 0 ? 'critical' : 'success',
    },
    {
      label: 'Critical values called back',
      value: s.diagnostics.criticals > 0 ? `${s.diagnostics.callbacksRecorded}/${s.diagnostics.criticals}` : '—',
      definition: 'Critical results with a recorded call-back to the clinician, including the read-back.',
      asOf: s.asOf,
      footnote: s.diagnostics.criticals === 0 ? 'No critical values in this range' : 'Every one needs a name, a time and a read-back',
      tone: s.diagnostics.criticals > s.diagnostics.callbacksRecorded ? 'critical' : 'success',
    },
    {
      label: 'Stock value',
      value: money(s.pharmacy.stockValue),
      definition: 'Point-in-time value of every batch on the shelves at the last purchase price.',
      asOf: s.stockAsOf,
      footnote: `${s.pharmacy.expiringBatches} batch(es) expiring within 90 days · ${money(s.pharmacy.expiringValue)} at risk`,
    },
  ];
}

/* ------------------------------------------------------------------ scheduled reports */

export interface ScheduledReport {
  id: string;
  name: string;
  cadence: string;
  goesTo: string;
  channel: string;
  /** What the receiver is expected to do with it — a report nobody acts on is a report nobody reads. */
  action: string;
}

export const SCHEDULED_REPORTS: ScheduledReport[] = [
  { id: 'sr-dayend', name: 'Day-end collection and cash reconciliation', cadence: 'Daily, 22:00 (after the counters close)', goesTo: 'Hospital administrator · accounts', channel: 'Print at the billing counter + email', action: 'Counters sign the cash sheet; a difference is explained the same evening, not at month end' },
  { id: 'sr-stock', name: 'Stock valuation and expiry', cadence: 'Weekly, Sunday 08:00', goesTo: 'Store manager · pharmacy manager', channel: 'Print in the store + email', action: 'Short-dated stock goes to the front of the shelf or back to the supplier' },
  { id: 'sr-lab', name: 'Laboratory turnaround and quality control', cadence: 'Weekly, Tuesday 09:00', goesTo: 'Pathologist · laboratory in-charge', channel: 'Email', action: 'The week’s out-of-range controls and overdue specimens are the agenda for the lab meeting' },
  { id: 'sr-clinical', name: 'Clinical activity and case mix', cadence: 'Monthly, first working day', goesTo: 'Medical director · clinical leads', channel: 'Print + email', action: 'Case mix, no-show rate and uncoded diagnoses by doctor' },
  { id: 'sr-revenue', name: 'Revenue by payer and discount approvals', cadence: 'Monthly, first working day', goesTo: 'Accounts · internal audit', channel: 'Email (the auditor gets the same file, not a summary of it)', action: 'Every discount above the limit is checked against its approver' },
];

/** A scheduled report needs the server; the preview lists them rather than pretending to send them. */
export const SCHEDULING_NEEDS_SERVER = 'Scheduling, rendering and delivery run on the hospital server (P6); this list is the specification, not a job runner.';
