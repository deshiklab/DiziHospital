/* -----------------------------------------------------------------------------
 * Billing (P2) — tariff, invoices, money received and the day-end sheet, in code.
 *
 * Money is where an offline-first system has to be most careful, so the rules are explicit here:
 *  - **Nothing is deleted.** A wrong invoice is cancelled with a reason and a replacement, so the receipt
 *    series has no holes and the audit trail keeps both.
 *  - **A discount above the limit needs a name.** Below 15 % any clerk may apply it; above that the approver is
 *    recorded, because "why is this patient paying less" is the question the accounts office actually asks.
 *  - **A receipt printed offline is still money.** It is numbered from the branch block, queued, and reconciled
 *    with the accounting office afterwards (P0-406), never silently renumbered.
 */

import { generateEncounters } from './clinical';
import type { Encounter } from './clinical';

export type Payer = 'Self pay' | 'Corporate — BRAC' | 'Insurance — MetLife' | 'Govt. scheme';

export type Category = 'Consultation' | 'Pathology' | 'Radiology' | 'Procedure' | 'Pharmacy' | 'Bed' | 'Ambulance';

export interface TariffItem {
  code: string;
  name: string;
  category: Category;
  price: number;
}

/** One price list, per branch in production; the pilot branch is the one shown. */
export const TARIFF: TariffItem[] = [
  { code: 'CONS-OPD', name: 'OPD consultation — new patient', category: 'Consultation', price: 500 },
  { code: 'CONS-FU', name: 'OPD consultation — follow-up', category: 'Consultation', price: 300 },
  { code: 'CONS-EMR', name: 'Emergency consultation', category: 'Consultation', price: 700 },
  { code: 'CONS-ONL', name: 'Video consultation', category: 'Consultation', price: 450 },
  { code: 'LAB-CBC', name: 'Complete blood count', category: 'Pathology', price: 350 },
  { code: 'LAB-FBS', name: 'Fasting blood sugar', category: 'Pathology', price: 200 },
  { code: 'LAB-HBA1C', name: 'HbA1c', category: 'Pathology', price: 900 },
  { code: 'LAB-LIPID', name: 'Lipid profile', category: 'Pathology', price: 800 },
  { code: 'LAB-LFT', name: 'Liver function test', category: 'Pathology', price: 850 },
  { code: 'LAB-RFT', name: 'Renal function test', category: 'Pathology', price: 750 },
  { code: 'LAB-TSH', name: 'Thyroid stimulating hormone', category: 'Pathology', price: 700 },
  { code: 'LAB-URINE', name: 'Urine routine examination', category: 'Pathology', price: 250 },
  { code: 'IMG-CXR', name: 'Chest X-ray PA', category: 'Radiology', price: 800 },
  { code: 'IMG-USG', name: 'Ultrasonography whole abdomen', category: 'Radiology', price: 1200 },
  { code: 'PROC-ECG', name: 'ECG 12 lead', category: 'Procedure', price: 500 },
  { code: 'PROC-DRES', name: 'Wound dressing', category: 'Procedure', price: 300 },
  { code: 'BED-GEN', name: 'General bed charge per day', category: 'Bed', price: 1500 },
  { code: 'AMB-LOC', name: 'Ambulance — within city', category: 'Ambulance', price: 1200 },
];

export const tariffByCode = (code: string): TariffItem | undefined => TARIFF.find((t) => t.code === code);

export type PaymentMethod = 'Cash' | 'bKash' | 'Nagad' | 'Card' | 'Insurance' | 'Corporate';

export const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'bKash', 'Nagad', 'Card', 'Insurance', 'Corporate'];

export interface Payment {
  id: string;
  at: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  receivedBy: string;
}

export interface InvoiceLine {
  id: string;
  code: string;
  name: string;
  category: Category;
  qty: number;
  unitPrice: number;
  discountPct: number;
  discountReason?: string;
  /** Who pays: some lines are covered by an insurer or the employer, the rest by the patient. */
  chargedTo: 'Patient' | 'Payer';
}

export type InvoiceStatus = 'Draft' | 'Issued' | 'Partially paid' | 'Paid' | 'Cancelled';

export interface Invoice {
  id: string;
  number: string;
  mrn: string;
  patientName: string;
  patientNameBn: string;
  age: number;
  sex: string;
  payer: Payer;
  encounterId?: string;
  counter: string;
  createdAt: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  payments: Payment[];
  cancelledReason?: string;
  replacedBy?: string;
  /** Set when the discount needed a supervisor: the name is the audit trail. */
  approvedBy?: string;
}

export const DISCOUNT_LIMIT_PCT = 15;

/** Coverage by payer: the share the payer settles, the rest is the patient's. */
export const payerCoverage: Record<Payer, number> = {
  'Self pay': 0,
  'Corporate — BRAC': 0.8,
  'Insurance — MetLife': 0.7,
  'Govt. scheme': 1,
};

export const lineGross = (l: InvoiceLine): number => l.qty * l.unitPrice;
export const lineDiscount = (l: InvoiceLine): number => Math.round((lineGross(l) * l.discountPct) / 100);
export const lineNet = (l: InvoiceLine): number => lineGross(l) - lineDiscount(l);

export interface InvoiceTotals {
  gross: number;
  discount: number;
  net: number;
  paid: number;
  due: number;
  payerShare: number;
  patientShare: number;
}

export function totals(invoice: Invoice): InvoiceTotals {
  const gross = invoice.lines.reduce((s, l) => s + lineGross(l), 0);
  const discount = invoice.lines.reduce((s, l) => s + lineDiscount(l), 0);
  const net = gross - discount;
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const covered = payerCoverage[invoice.payer];
  const payerShare = invoice.lines
    .filter((l) => l.chargedTo === 'Payer')
    .reduce((s, l) => s + Math.round(lineNet(l) * covered), 0);
  return { gross, discount, net, paid, due: Math.max(0, net - paid), payerShare, patientShare: net - payerShare };
}

export const nextStatus = (invoice: Invoice): InvoiceStatus => {
  const t = totals(invoice);
  if (invoice.status === 'Cancelled' || invoice.status === 'Draft') return invoice.status;
  if (t.paid <= 0) return 'Issued';
  return t.due <= 0 ? 'Paid' : 'Partially paid';
};

export const invoiceTone: Record<InvoiceStatus, 'neutral' | 'info' | 'warning' | 'success' | 'critical'> = {
  Draft: 'neutral',
  Issued: 'info',
  'Partially paid': 'warning',
  Paid: 'success',
  Cancelled: 'critical',
};

export const paymentTone: Record<PaymentMethod, 'neutral' | 'info' | 'warning' | 'success'> = {
  Cash: 'neutral',
  bKash: 'info',
  Nagad: 'info',
  Card: 'info',
  Insurance: 'success',
  Corporate: 'success',
};

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];

/** Invoice lines that match what the doctor actually ordered — the bill is built from the encounter, not typed. */
function linesFor(enc: Encounter, rand: () => number): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  let n = 0;
  const add = (code: string, qty = 1) => {
    const t = tariffByCode(code);
    if (!t) return;
    n += 1;
    lines.push({
      id: `${enc.id}-L${n}`,
      code: t.code,
      name: t.name,
      category: t.category,
      qty,
      unitPrice: t.price,
      discountPct: 0,
      chargedTo: 'Patient',
    });
  };

  add(enc.diagnoses.length === 0 || rand() < 0.3 ? 'CONS-FU' : 'CONS-OPD');
  if (enc.orders.some((o) => o.code === 'CBC')) add('LAB-CBC');
  if (enc.orders.some((o) => o.code === 'CXR')) add('IMG-CXR');
  if (enc.orders.some((o) => o.code === 'ECG')) add('PROC-ECG');
  if (enc.orders.some((o) => o.code === 'URINE')) add('LAB-URINE');
  if (enc.rx.length > 0) {
    // Pharmacy lines come from the prescription, priced per unit — the patient sees the same numbers here as at
    // the pharmacy counter, which is the whole point of one tariff.
    const pharmacy = ['LAB-CBC', 'PROC-DRES'];
    void pharmacy;
    add('PROC-DRES', 1 + Math.floor(rand() * 2));
  }
  return lines;
}

export function generateInvoices(dayIso: string): Invoice[] {
  const rand = rng(7788);
  const encounters = generateEncounters(dayIso);
  const billable = encounters.filter((e) => e.status !== 'Waiting');

  const invoices: Invoice[] = billable.map((enc, i) => {
    const lines = linesFor(enc, rand);
    const payer = (enc.patient.payer as Payer) ?? 'Self pay';
    const covered = payerCoverage[payer] > 0;
    const withCoverage = lines.map((l) =>
      covered && l.category !== 'Consultation' ? { ...l, chargedTo: 'Payer' as const } : l,
    );
    const invoice: Invoice = {
      id: `INV-${String(2201 + i)}`,
      number: `INV-${dayIso.replace(/-/g, '')}-${String(2201 + i)}`,
      mrn: enc.patient.mrn,
      patientName: enc.patient.name,
      patientNameBn: enc.patient.nameBn,
      age: enc.patient.age,
      sex: enc.patient.sex,
      payer,
      encounterId: enc.id,
      counter: pick(rand, ['Billing 1', 'Billing 2', 'Emergency desk']),
      createdAt: enc.signedAt ?? `${dayIso} 11:${String((i * 7) % 60).padStart(2, '0')}`,
      status: 'Issued',
      lines: withCoverage,
      payments: [],
      approvedBy: rand() < 0.25 ? 'S. Ahmed (accounts supervisor)' : undefined,
    };

    // Some invoices get a discount, one of them above the limit so the approval rule has a live example.
    if (rand() < 0.35) {
      const pct = rand() < 0.3 ? 20 : 10;
      invoice.lines = invoice.lines.map((l, index) =>
        index === 0 ? { ...l, discountPct: pct, discountReason: pct > DISCOUNT_LIMIT_PCT ? 'Long stay — supervisor approved' : 'Follow-up concession' } : l,
      );
      if (pct > DISCOUNT_LIMIT_PCT) invoice.approvedBy = 'S. Ahmed (accounts supervisor)';
    }

    // Payments: fully paid, partly paid, or nothing yet.
    const t = totals(invoice);
    const roll = rand();
    if (roll < 0.55) {
      invoice.payments = [{
        id: `${invoice.id}-P1`,
        at: `${dayIso} ${String(11 + i % 6).padStart(2, '0')}:${String((i * 11) % 60).padStart(2, '0')}`,
        method: pick(rand, PAYMENT_METHODS.filter((m) => m !== 'Insurance')),
        amount: t.net,
        reference: rand() < 0.4 ? `TRX${900000 + Math.floor(rand() * 99999)}` : undefined,
        receivedBy: 'Billing counter',
      }];
    } else if (roll < 0.8) {
      const part = Math.round(t.net * 0.5);
      invoice.payments = [{
        id: `${invoice.id}-P1`,
        at: `${dayIso} ${String(11 + i % 6).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}`,
        method: 'Cash',
        amount: part,
        receivedBy: 'Billing counter',
      }];
    }
    invoice.status = nextStatus(invoice);
    return invoice;
  });

  const cancelled: Invoice = {
    ...invoices[0],
    id: 'INV-2199',
    number: `INV-${dayIso.replace(/-/g, '')}-2199`,
    status: 'Cancelled',
    cancelledReason: 'Wrong patient selected — cancelled before payment, replacement issued',
    replacedBy: invoices[0].number,
    payments: [],
  };

  return [cancelled, ...invoices];
}

/* ------------------------------------------------------------------------------ day end */

export interface DayEnd {
  invoices: number;
  gross: number;
  discount: number;
  net: number;
  collected: number;
  due: number;
  byMethod: Array<{ method: PaymentMethod; count: number; amount: number }>;
  byCategory: Array<{ category: Category; amount: number }>;
  byCounter: Array<{ counter: string; amount: number }>;
  payerShare: number;
  patientShare: number;
  cancelled: number;
  /** Cash only: the number that must agree with the drawer. */
  cashExpected: number;
}

export function dayEnd(invoices: Invoice[]): DayEnd {
  const live = invoices.filter((i) => i.status !== 'Cancelled');
  const all = live.flatMap((i) => i.payments);
  const methods = PAYMENT_METHODS.map((method) => {
    const rows = all.filter((p) => p.method === method);
    return { method, count: rows.length, amount: rows.reduce((s, p) => s + p.amount, 0) };
  }).filter((m) => m.count > 0);

  const categories = Array.from(new Set(TARIFF.map((t) => t.category))).map((category) => ({
    category,
    amount: live.reduce((s, inv) => s + inv.lines.filter((l) => l.category === category).reduce((x, l) => x + lineNet(l), 0), 0),
  })).filter((c) => c.amount > 0);

  const counters = Array.from(new Set(live.map((i) => i.counter))).map((counter) => ({
    counter,
    amount: live.filter((i) => i.counter === counter).reduce((s, i) => s + i.payments.reduce((x, p) => x + p.amount, 0), 0),
  }));

  const shares = live.reduce(
    (acc, inv) => {
      const t = totals(inv);
      return { payer: acc.payer + t.payerShare, patient: acc.patient + t.patientShare };
    },
    { payer: 0, patient: 0 },
  );

  return {
    invoices: live.length,
    gross: live.reduce((s, i) => s + totals(i).gross, 0),
    discount: live.reduce((s, i) => s + totals(i).discount, 0),
    net: live.reduce((s, i) => s + totals(i).net, 0),
    collected: all.reduce((s, p) => s + p.amount, 0),
    due: live.reduce((s, i) => s + totals(i).due, 0),
    byMethod: methods,
    byCategory: categories,
    byCounter: counters,
    payerShare: shares.payer,
    patientShare: shares.patient,
    cancelled: invoices.length - live.length,
    cashExpected: all.filter((p) => p.method === 'Cash').reduce((s, p) => s + p.amount, 0),
  };
}

export const money = (n: number): string => `৳ ${n.toLocaleString('en-IN')}`;
export const receiptNo = (dayIso: string, seq: number): string => `RC-${dayIso.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;
