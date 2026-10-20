/* -----------------------------------------------------------------------------
 * Single-module billing — legacy screens 010 (bill dashboard), 03, 04, 05 and 06 (pathology, radiology, blood
 * issue and blood component billing).
 *
 * The legacy product billed a case through whichever screen the counter happened to open, and each of those
 * screens had its own idea of when money is due. This module says it once: **every service line has a moment at
 * which it becomes chargeable, a party that owes it, and an exception that lets it happen first and be billed
 * after.** Get that wrong and the hospital either bills a patient who never got the test, or gives away the
 * test and finds out at the month end.
 *
 * The four rules that decide almost every argument at a billing counter:
 *
 *  - **The moment of charge.** Pathology and radiology are charged before the sample or the study for an
 *    out-patient; blood is charged at issue, not at transfusion; a bed-day accrues at midnight. A bill that is
 *    raised at the wrong moment cannot be reconciled later, only argued about.
 *  - **Who owes it.** A self-paying out-patient owes it; an in-patient's test is owed by the case, not by the
 *    person lying in the bed; a corporate case is owed by the company up to its credit limit.
 *  - **The emergency override.** If the alternative is a patient not getting a test, the test happens and the
 *    bill follows — with the name of the clinician who authorised it on the line. That is not a loophole, it is
 *    the only workable rule, and it is why the override is a button and not a conversation.
 *  - **Authorisation before the invoice.** Insurance above the threshold needs a pre-authorisation number before
 *    the module may bill it, and the company's credit limit is checked before the invoice is issued rather than
 *    after the money has been spent.
 *
 * Preview: every item here comes from the module that owns it — the pathology worklist, the blood bank's issue
 * log, the ward's bed-days, the theatre's procedures — so this screen cannot invent a chargeable item that does
 * not exist. Nothing survives a reload; the rules do.
 */

import { money, payerCoverage, type Payer } from './billing';
import { BED_CHARGE, generateInpatient, wardName, type BedClass } from './ward';
import { TESTS, generateDiagnosticOrders, type DiagnosticOrder } from './diagnostics';
import { FARE_TABLE, ambulanceDay } from './ambulance';
import { bloodBankDay, COMPONENT_LABEL, type Component as BloodComponent } from './bloodbank';
import { generateDispenses } from './pharmacy';
import { CATALOGUES } from './masters';

/* ------------------------------------------------------------------ the lines of business */

export type BillModule = 'OPD' | 'Pathology' | 'Radiology' | 'Blood issue' | 'Blood components' | 'Pharmacy' | 'IPD' | 'Ambulance';

export const BILL_MODULES: BillModule[] = ['OPD', 'Pathology', 'Radiology', 'Blood issue', 'Blood components', 'Pharmacy', 'IPD', 'Ambulance'];

export interface ModuleRule {
  module: BillModule;
  /** Which legacy screen this line replaces, so the mapping stays auditable. */
  legacy: string;
  chargedWhen: string;
  owedBy: string;
  exceptions: string[];
}

export const MODULE_RULES: ModuleRule[] = [
  {
    module: 'OPD',
    legacy: 'OPD Patient (001, 002, 008, 020)',
    chargedWhen: 'At the counter, when the patient is checked in. The consultation is billed before it happens for a new patient and after it for a follow-up, where there is nothing to pay.',
    owedBy: 'The patient, unless the payer is a company or an insurer with a pre-authorisation on file.',
    exceptions: [
      'A follow-up inside the free window has no consultation fee; the line is still shown at zero with the reason, never removed.',
      'An emergency walk-in is seen first and billed after; the emergency flag on the visit is what allows it.',
      'A medico-legal case is billed to the hospital’s own account until the police case names a payer.',
    ],
  },
  {
    module: 'Pathology',
    legacy: 'Pathology Billing (003)',
    chargedWhen: 'Before the sample is taken for a self-paying out-patient. The collection list will not hand over a tube until the line is cleared or the visit says otherwise.',
    owedBy: 'The patient for an out-patient visit; the running case account for an admitted patient, always — collecting a test fee from a patient lying in a bed is how a bill becomes a dispute.',
    exceptions: [
      'Emergency and ICU orders are billed to the case, not to the counter, whatever the payer.',
      'A repeat sample because the laboratory rejected the first one is not charged twice, and the rejection reason is on the record.',
      'An out-sourced test carries the partner laboratory’s cost as a separate pass-through line, with its own turnaround.',
    ],
  },
  {
    module: 'Radiology',
    legacy: 'Radiology Billing (004)',
    chargedWhen: 'Before the study, except in an emergency where the study happens first and the bill follows, authorised by name.',
    owedBy: 'The patient for an out-patient, the case account for an in-patient.',
    exceptions: [
      'Contrast is charged as a separate line, because it is a separate cost and it is the line patients query.',
      'A study repeated because the images were not diagnostic is not charged twice; the reason is recorded by the radiographer.',
      'A portable study carries the portable surcharge, and the ward knows it before ordering.',
    ],
  },
  {
    module: 'Blood issue',
    legacy: 'Blood Issue Billing (005)',
    chargedWhen: 'At issue from the bank — the moment the unit leaves the fridge, not the moment it is transfused. A unit that is issued and then not used is still billed as issued, and the reason sits on the issue note.',
    owedBy: 'The patient or the case, plus the cross-match fee for the request itself.',
    exceptions: [
      'A replacement donor credit reduces the charge; the credit is applied at the issue and the donor is recorded.',
      'A unit discarded because the bank’s own cold chain failed is not charged to anybody.',
      'Uncrossmatched emergency release is charged as issued, with the medical officer who authorised it named on the line.',
    ],
  },
  {
    module: 'Blood components',
    legacy: 'Blood Components Issue Billing (006)',
    chargedWhen: 'At issue, per component, from the component charges in Setup › Blood Bank — so a price change is a dated master change and not a code edit.',
    owedBy: 'The patient or the case account.',
    exceptions: [
      'A component returned unused to the bank is credited back, at the component’s own charge, from the issue note.',
      'Platelets carry a shorter shelf life and a higher charge; a wasted unit inside its shelf life is a bank failure and is absorbed, not billed.',
    ],
  },
  {
    module: 'Pharmacy',
    legacy: 'Pharmacy (P3) — the in-patient side',
    chargedWhen: 'When the ward or theatre store issues the medicine to the case, not when a prescription is written.',
    owedBy: 'The case account for an in-patient; the counter for an out-patient walk-in.',
    exceptions: [
      'A take-home pack on discharge is added to the discharge bill so the patient does not queue twice.',
      'A controlled medicine needs a second signature before the issue posts, which is a clinical control that happens to sit on a billing screen.',
      'A return to the pharmacy credits the case, at the batch’s own price, never at today’s price.',
    ],
  },
  {
    module: 'IPD',
    legacy: 'IPD - In Patient (P5, 038)',
    chargedWhen: 'The bed-day accrues at midnight in the class the patient is actually in, and an upgrade mid-stay is charged from the day of the move. Procedures are charged when performed; nursing care is charged daily at the class rate.',
    owedBy: 'The case account, funded by the deposit, the payer or both.',
    exceptions: [
      'An interim bill is raised every three days on a stay longer than three days, so the final number is never a surprise.',
      'A discharge is not completed without a financial clearance — except for a leave against medical advice, a medico-legal case, or a death, where the bill follows the family and the body does not wait for it.',
      'A cancelled or postponed theatre case is charged only for what was used: consumables opened, and the theatre slot if it was held.',
    ],
  },
  {
    module: 'Ambulance',
    legacy: 'Ambulance (P4) — the trip charge',
    chargedWhen: 'At the end of the trip, from the odometer and the fare table, not from an estimate taken on the phone.',
    owedBy: 'The patient or the case; a mortuary trip is billed to the family or the case as the case may be.',
    exceptions: [
      'An emergency call for a patient who then declines transport is charged the response, not the trip.',
      'Decontamination time is not billable, because billing the hospital’s own safety work is how a vehicle gets dispatched dirty.',
    ],
  },
];

/* ------------------------------------------------------------------ credit and authorisation */

/** Insurance bills above this need a pre-authorisation number before the invoice is issued. */
export const PRE_AUTH_THRESHOLD = 15_000;
/** A corporate case may run to this many days of credit before the accounts office is asked. */
export const CORPORATE_CREDIT_DAYS = 30;
/** An in-patient admission asks for this many days of bed charge as a deposit. */
export const DEPOSIT_DAYS = 2;
/** How often a long stay gets an interim bill. */
export const INTERIM_BILL_DAYS = 3;

export interface CreditRules {
  title: string;
  because: string;
}

export const CREDIT_RULES: CreditRules[] = [
  { title: `Insurance above ${money(PRE_AUTH_THRESHOLD)} needs a pre-authorisation number`, because: 'An unauthorised treatment the insurer later declines is a bill the patient did not agree to. The number goes on the line before the invoice is issued, not after the money is spent.' },
  { title: `A corporate case runs on ${CORPORATE_CREDIT_DAYS} days of credit`, because: 'The hospital is lending the company money between the treatment and the settlement; past the limit the accounts office decides, and the decision has a name against it.' },
  { title: `Admission asks for ${DEPOSIT_DAYS} day(s) of bed charge as a deposit`, because: 'A deposit is not a payment, it is a commitment: the family should not discover the daily cost on the third morning.' },
  { title: `An interim bill every ${INTERIM_BILL_DAYS} days on a long stay`, because: 'The final discharge bill is not the place to discover a shortfall of a week’s charges.' },
  { title: 'No discharge without financial clearance, with three documented exceptions', because: 'Leave against medical advice, a medico-legal case and a death are the cases where the clinical duty to release the patient or the body outranks the ledger. Each is recorded with the name of whoever authorised it.' },
  { title: 'The emergency override is a button, and it is named', because: 'If the alternative is a patient not getting a test, the test happens and the bill follows. The clinician who authorised it is on the line, which is what keeps the override from becoming a habit.' },
  { title: 'A cancelled service is refunded, never deleted', because: 'A cancelled line leaves a trace: the service was ordered, then cancelled, by somebody, for a reason. Deleting it makes the day-end sheet wrong and the argument impossible to settle.' },
];

/* ------------------------------------------------------------------ billable items */

export interface BillableItem {
  id: string;
  module: BillModule;
  /** What the counter or the ward sees. */
  description: string;
  code: string;
  patientName: string;
  mrn: string;
  where: string;
  at: string;
  qty: number;
  unitPrice: number;
  /** Where the item came from, so the bill can be traced back to the service. */
  sourceRef: string;
  /** Set when the module’s own rules already decided the payer. */
  billedTo?: 'Patient' | 'Case account';
  /** An exception that applied: rejected sample, repeated study, authorising clinician. */
  note?: string;
  ready: boolean;
  /** Already on an invoice issued today. */
  billed?: string;
}

const chargeOf = (code: string): number => TESTS.find((t) => t.code === code)?.price ?? 0;

/** What Setup › Blood Bank says this component costs — a price change is a dated master change, not a code edit. */
export function componentCharge(component: BloodComponent): number {
  const row = CATALOGUES.find((c) => c.id === 'blood')?.rows.find((r) => r.values.component === COMPONENT_LABEL[component] || r.code === component);
  const charge = row?.values.charge;
  return typeof charge === 'number' ? charge : 0;
}

/** The cross-match fee: the request costs something whether or not a unit is issued. */
export const CROSS_MATCH_FEE = 400;

export function billableItems(day: string, module: BillModule): BillableItem[] {
  if (module === 'Pathology' || module === 'Radiology') {
    const kind = module === 'Pathology' ? 'lab' : 'imaging';
    return generateDiagnosticOrders(day)
      .filter((o) => o.kind === kind)
      .map((o: DiagnosticOrder) => {
        // An out-patient visit is billed to the person; an admitted patient is billed to the case, always.
        const outPatient = /^OPD/i.test(o.encounterId ?? '') || /^OPD/i.test(o.specimenId);
        return {
          id: `BI-${o.id}`,
          module,
          description: o.testName,
          code: o.testCode,
          patientName: o.patient.name,
          mrn: o.patient.mrn,
          where: outPatient ? 'OPD counter' : 'Ward / case account',
          at: o.orderedAt,
          qty: 1,
          unitPrice: chargeOf(o.testCode),
          sourceRef: o.id,
          billedTo: outPatient ? ('Patient' as const) : ('Case account' as const),
          ...(o.rejection
            ? { note: `Sample rejected (${o.rejection.reason}) on the first attempt: not charged twice — the repeat is carried by the laboratory.` }
            : o.priority === 'STAT'
              ? { note: 'STAT order: charged as ordered, with the priority on the line so the day’s urgent volume is visible.' }
              : {}),
          ready: o.status === 'Verified' || o.status === 'Resulted' || o.status === 'Dispatched',
        };
      });
  }

  if (module === 'Blood issue' || module === 'Blood components') {
    const bank = bloodBankDay(day);
    const units = bank.units.filter((u) => u.state === 'issued' || u.state === 'transfused');
    return units.map((u) => {
      const request = bank.requests.find((r) => r.id === u.requestId);
      const componentRow = CATALOGUES.find((c) => c.id === 'blood')?.rows.find((r) => r.code === u.component);
      const description = module === 'Blood issue'
        ? `Blood issue — ${COMPONENT_LABEL[u.component]} ${u.group}`
        : `Blood component — ${COMPONENT_LABEL[u.component]} ${u.group}`;
      return {
        id: `BI-${u.id}`,
        module,
        description,
        code: u.component,
        patientName: request?.patientName ?? u.forPatient ?? '—',
        mrn: request?.patientMrn ?? '—',
        where: request?.ward ?? 'Ward / case account',
        at: u.issuedAt ?? `${day}T10:00`,
        qty: 1,
        unitPrice: componentCharge(u.component),
        sourceRef: u.bag,
        billedTo: 'Case account' as const,
        note: `Cross-match fee ${money(CROSS_MATCH_FEE)} on the request; ${componentRow?.values.crossMatch === 'required' ? 'cross-matched unit' : 'group-only issue'}${u.state === 'transfused' ? ', transfused' : ', issued and not yet transfused — billed at issue, not at transfusion'}.`,
        ready: true,
      };
    });
  }

  if (module === 'Pharmacy') {
    return generateDispenses(day)
      .filter((d) => d.status === 'Dispensed' || d.status === 'Partially dispensed')
      .flatMap((d) => d.lines.map((l) => ({
        id: `BI-${d.id}-${l.id}`,
        module: 'Pharmacy' as BillModule,
        description: `${l.drug.brand} ${l.drug.strength}`,
        code: l.drug.id,
        patientName: d.patient.name,
        mrn: d.patient.mrn,
        where: `Pharmacy counter ${d.counter}`,
        at: d.dispensedAt ?? d.orderedAt,
        qty: l.qty,
        unitPrice: l.drug.price,
        sourceRef: d.rxNumber,
        billedTo: 'Case account' as const,
        ...(l.drug.controlled ? { note: 'Controlled medicine: the second signature is on the issue record.' } : {}),
        ready: true,
      })));
  }

  if (module === 'IPD') {
    const ward = generateInpatient(day);
    return ward.admissions.map((adm) => {
      const bed = ward.beds.find((b) => b.id === adm.bedId);
      const stayedDays = Math.max(1, Math.round((new Date(`${day}T00:00:00Z`).getTime() - new Date(`${adm.admittedAt.slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000));
      return {
        id: `BI-ADM-${adm.id}`,
        module: 'IPD' as BillModule,
        description: `Bed charge — ${adm.class}${stayedDays > 1 ? `, day ${stayedDays}` : ''}`,
        code: `BED-${adm.class}`,
        patientName: adm.patient.name,
        mrn: adm.patient.mrn,
        where: `${wardName(adm.wardId)} · bed ${bed?.label ?? adm.bedId}`,
        at: `${day}T00:00`,
        qty: 1,
        unitPrice: BED_CHARGE[adm.class as BedClass],
        sourceRef: adm.id,
        billedTo: 'Case account' as const,
        note: `Accrues at midnight in the class the patient is actually in.${stayedDays > INTERIM_BILL_DAYS ? ` Day ${stayedDays} of the stay: an interim bill was due on day ${INTERIM_BILL_DAYS}.` : ''}${adm.transferredFrom ? ` Transferred in from ${adm.transferredFrom}.` : ''} Payer: ${adm.patient.payer}.`,
        ready: true,
      };
    });
  }

  if (module === 'Ambulance') {
    const fleet = ambulanceDay(day);
    return fleet.calls
      .filter((c) => Boolean(c.returnedAt) && (c.state === 'Completed' || c.state === 'Cancelled'))
      .map((c) => {
        // The fare follows the vehicle class that answered the call, not the kind of call it was.
        const vehicle = fleet.vehicles.find((v) => v.id === c.vehicleId);
        const tariff = FARE_TABLE.find((f) => f.kind === vehicle?.kind) ?? FARE_TABLE[1];
        const km = c.fare?.km ?? 6;
        return {
          id: `BI-${c.id}`,
          module: 'Ambulance' as BillModule,
          description: `${c.kind} trip — ${c.id}${c.state === 'Cancelled' ? ' (cancelled after dispatch)' : ''}`,
          code: `AMB-${tariff.kind}`,
          patientName: c.patientName ?? 'Not a patient — equipment run',
          mrn: c.patientMrn ?? '—',
          where: `${c.from} → ${c.to}`,
          at: c.returnedAt as string,
          qty: c.fare?.km ?? 1,
          unitPrice: c.fare ? Math.round(c.fare.total / Math.max(1, c.fare.km)) : tariff.perKm,
          sourceRef: c.id,
          billedTo: 'Patient' as const,
          note: c.state === 'Cancelled'
            ? `Cancelled after dispatch: the response is charged, not the trip. Decontamination time is never billable.`
            : `Fare table ${tariff.kind}: ${money(c.fare?.base ?? tariff.base)} response + ${money(tariff.perKm)}/km over ${km} km, recorded at trip end from the odometer.`,
          ready: true,
        };
      });
  }

  // OPD: the counter's own lines, taken from the day's visits rather than invented here.
  return [];
}

/* ------------------------------------------------------------------ assembling a bill */

export interface DraftLine extends BillableItem {
  id2: string;
  chargedTo: 'Patient' | 'Payer';
  discountPct: number;
  discountReason?: string;
}

export interface ModuleBillTotals {
  gross: number;
  discount: number;
  net: number;
  payerShare: number;
  patientShare: number;
  crossMatch: number;
}

export function moduleBillTotals(lines: DraftLine[], payer: Payer): ModuleBillTotals {
  const gross = lines.reduce((n, l) => n + l.qty * l.unitPrice, 0);
  const discount = lines.reduce((n, l) => n + Math.round((l.qty * l.unitPrice * l.discountPct) / 100), 0);
  const net = gross - discount;
  const payerLines = lines.filter((l) => l.chargedTo === 'Payer').reduce((n, l) => n + (l.qty * l.unitPrice - Math.round((l.qty * l.unitPrice * l.discountPct) / 100)), 0);
  const coverage = payerCoverage[payer];
  const payerShare = Math.min(net, Math.round(payerLines * coverage));
  return {
    gross,
    discount,
    net,
    payerShare,
    patientShare: net - payerShare,
    // The cross-match fee is a separate charge on the request: it is paid for whether or not a unit is issued.
    crossMatch: lines.filter((l) => l.module === 'Blood issue' || l.module === 'Blood components').length * CROSS_MATCH_FEE,
  };
}

export interface BillChecks {
  blockers: string[];
  warnings: string[];
  preAuthRequired: boolean;
  overCreditLimit: boolean;
  depositShortfall: number;
}

/** The checks that decide whether the invoice may be issued, in the order a counter clerk would ask them. */
export function billChecks(lines: DraftLine[], payer: Payer, totals: ModuleBillTotals, opts: { preAuth?: string; creditLimit?: number; depositPaid?: number; authorisedBy?: string; emergency?: boolean }): BillChecks {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const preAuthRequired = (payer === 'Insurance — MetLife' || payer === 'Govt. scheme') && totals.payerShare > PRE_AUTH_THRESHOLD;
  if (preAuthRequired && !opts.preAuth?.trim()) {
    blockers.push(`${payer} is being asked for ${money(totals.payerShare)}, above the ${money(PRE_AUTH_THRESHOLD)} pre-authorisation threshold. The number goes on the line before the invoice is issued, not after the money is spent.`);
  }
  const overCreditLimit = payer === 'Corporate — BRAC' && opts.creditLimit !== undefined && totals.payerShare > opts.creditLimit;
  if (overCreditLimit) {
    warnings.push(`This invoice takes the company past the credit limit the accounts office set (${money(opts.creditLimit ?? 0)} on this case). It can still be issued — with the approval recorded, because the hospital is lending an unsecured company money either way.`);
  }
  const depositShortfall = Math.max(0, Math.round(totals.patientShare - (opts.depositPaid ?? 0)));
  if (opts.depositPaid !== undefined && depositShortfall > 0 && totals.patientShare > 0) {
    warnings.push(`${money(totals.patientShare)} is the patient's share against ${money(opts.depositPaid)} of deposit: ${money(depositShortfall)} to collect or to authorise.`);
  }
  if (lines.some((l) => !l.ready) && !opts.emergency) {
    blockers.push('Some lines are for a service that has not happened yet. An out-patient test is billed before the sample is taken; in an emergency the override records who authorised it and the bill follows.');
  } else if (lines.some((l) => !l.ready) && opts.emergency && !opts.authorisedBy?.trim()) {
    blockers.push('The emergency override needs a name. The clinician who authorised the service goes on the line — that is what keeps the override from becoming a habit.');
  }
  lines.filter((l) => l.discountPct > 0 && !l.discountReason).forEach(() => blockers.push('A discount without a reason cannot be approved, so it cannot be issued.'));
  if (lines.some((l) => l.discountPct > 15)) {
    warnings.push('A discount above 15 % may be given, but it needs an approver who is not the person giving it.');
  }
  return { blockers, warnings, preAuthRequired, overCreditLimit, depositShortfall };
}

/** A predictable invoice number for the preview: real numbering comes from the server, once. */
export const moduleInvoiceNo = (day: string, module: BillModule, seq: number): string =>
  `${module.replace(/[^A-Z]/g, '').slice(0, 3)}-${day.replace(/-/g, '').slice(2)}-${String(4000 + seq)}`;

export interface OpenBill {
  id: string;
  invoiceNo: string;
  module: BillModule;
  mrn: string;
  patientName: string;
  payer: Payer;
  lines: number;
  net: number;
  payerShare: number;
  patientShare: number;
  collected: number;
  at: string;
  raisedBy: string;
  state: 'Draft' | 'Issued' | 'Partially collected' | 'Collected' | 'Cancelled';
  cancelledBecause?: string;
}

/** Today's module bills, seeded from today's bills so the register is not empty at first paint. */
export function openBills(day: string): OpenBill[] {
  const modules: BillModule[] = ['Pathology', 'Radiology', 'Blood issue', 'Blood components', 'IPD', 'Ambulance', 'Pharmacy'];
  return modules.map((module, i) => {
    const items = billableItems(day, module);
    const patient = items[i % Math.max(1, items.length)];
    const gross = items.slice(0, 1 + (i % 3)).reduce((n, l) => n + l.qty * l.unitPrice, 0);
    const payer: Payer = i === 2 ? 'Corporate — BRAC' : i === 4 ? 'Insurance — MetLife' : 'Self pay';
    const payerShare = Math.round(gross * payerCoverage[payer]);
    const patientShare = gross - payerShare;
    const collected = i % 3 === 0 ? patientShare : 0;
    return {
      id: `OB-${day}-${i}`,
      invoiceNo: moduleInvoiceNo(day, module, i),
      module,
      mrn: patient?.mrn ?? '—',
      patientName: patient?.patientName ?? '—',
      payer,
      lines: Math.min(items.length, 1 + (i % 3)) || 0,
      net: gross,
      payerShare,
      patientShare,
      collected,
      at: `${day}T${String(9 + i).padStart(2, '0')}:20`,
      raisedBy: ['Counter 2 — R. Karim', 'Counter 1 — S. Das', 'Accounts desk', 'Laboratory counter', 'Blood bank counter', 'Ward desk', 'Pharmacy counter'][i % 7],
      state: i === 6 ? 'Cancelled' : collected >= patientShare && patientShare > 0 ? 'Collected' : collected > 0 ? 'Partially collected' : 'Issued',
      ...(i === 6 ? { cancelledBecause: 'Study cancelled by the radiologist: the study was not performed, so the line is cancelled and, where money had been taken, refunded — never deleted.' } : {}),
    };
  });
}

export interface ModuleDay {
  module: BillModule;
  items: BillableItem[];
  ready: number;
  notReady: number;
  value: number;
  billed: number;
}

/** The dashboard: what each module has earned today and what is still sitting unbilled. */
export function moduleDay(day: string): ModuleDay[] {
  return BILL_MODULES.map((module) => {
    const items = billableItems(day, module);
    const bills = openBills(day).filter((b) => b.module === module);
    return {
      module,
      items,
      ready: items.filter((i) => i.ready).length,
      notReady: items.filter((i) => !i.ready).length,
      value: items.reduce((n, i) => n + i.qty * i.unitPrice, 0),
      billed: bills.reduce((n, b) => n + b.net, 0),
    };
  });
}

export interface ModuleTotals {
  value: number;
  ready: number;
  notReady: number;
  billed: number;
  collected: number;
  outstanding: number;
  payerShare: number;
  patientShare: number;
  preAuthPending: number;
  cancelled: number;
}

export function moduleTotals(day: string): ModuleTotals {
  const bills = openBills(day);
  const items = BILL_MODULES.flatMap((m) => billableItems(day, m));
  return {
    value: items.reduce((n, i) => n + i.qty * i.unitPrice, 0),
    ready: items.filter((i) => i.ready).length,
    notReady: items.filter((i) => !i.ready).length,
    billed: bills.reduce((n, b) => n + b.net, 0),
    collected: bills.reduce((n, b) => n + b.collected, 0),
    outstanding: bills.reduce((n, b) => n + (b.net - b.collected), 0),
    payerShare: bills.reduce((n, b) => n + b.payerShare, 0),
    patientShare: bills.reduce((n, b) => n + b.patientShare, 0),
    preAuthPending: bills.filter((b) => (b.payer === 'Insurance — MetLife' || b.payer === 'Govt. scheme') && b.payerShare > PRE_AUTH_THRESHOLD).length,
    cancelled: bills.filter((b) => b.state === 'Cancelled').length,
  };
}

/** Where a module's money is not yet on a bill — the number a manager actually asks for. */
export function unbilledByModule(day: string): Array<{ module: BillModule; unbilled: number; items: number }> {
  return moduleDay(day)
    .map((d) => ({ module: d.module, unbilled: Math.max(0, d.value - d.billed), items: d.items.length - d.billed ? d.items.filter((i) => !i.billed).length : 0 }))
    .filter((r) => r.unbilled > 0 || r.items > 0)
    .sort((a, b) => b.unbilled - a.unbilled);
}

export const depositFor = (bedClass: BedClass): number => BED_CHARGE[bedClass] * DEPOSIT_DAYS;
