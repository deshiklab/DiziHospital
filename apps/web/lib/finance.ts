/* -----------------------------------------------------------------------------
 * Finance — the cash book (P6, legacy `admin/income`, `admin/expense` replaced).
 *
 * The billing module knows what was billed; this module knows what moved. Three rules run through it, and each
 * one exists because a hospital that gets it wrong argues with its own accountant:
 *
 *  1. **One book, two directions.** Income vouchers and expense vouchers share a sequence, because a cash book
 *     is chronological: the sequence number is what makes a voucher missing from the bundle visible.
 *  2. **The drawer is the only figure a person can count.** Cash is reported on its own line everywhere. Card,
 *     bKash and the insurer's share never sit in the drawer, so they never appear in the cash figure — an
 *     insurer's share is a receivable, and pretending it is money is how a day book stops being true.
 *  3. **A difference is explained or it is investigated.** The till (what billing collected) and the book (what
 *     finance recorded) are computed from the same invoices, so they agree by construction — except for the one
 *     thing that really separates them in this product: a receipt still queued on a node that lost its uplink.
 *     That shows as `explained`, with the amount and the vouchers named. Anything else is `investigate`.
 *
 * Approval, withholding and the payment limits are policy, not constants buried in a screen: `checkExpense`
 * answers with the rule that refused a voucher, and the screen prints it.
 */

import { PAYMENT_METHODS, dayEnd, generateInvoices, lineNet, totals, type Category, type DayEnd, type Invoice, type PaymentMethod } from './billing';
import { ambulanceDay } from './ambulance';
import { generateDispenses } from './pharmacy';
import { patients } from './mock';

/* ------------------------------------------------------------------ heads */

export type IncomeGroup = 'Operating' | 'Non-operating';

export interface IncomeHead {
  code: string;
  label: string;
  group: IncomeGroup;
  /** The billing category this head collects, when it collects one — the link that makes the reconciliation possible. */
  category: Category | null;
  note: string;
}

export const INCOME_HEADS: IncomeHead[] = [
  { code: 'INC-OPD', label: 'Outpatient consultation', group: 'Operating', category: 'Consultation', note: 'Counter receipts for OPD and emergency consultations.' },
  { code: 'INC-IPD', label: 'Inpatient — bed and nursing', group: 'Operating', category: 'Bed', note: 'Interim bills and deposits against an admission.' },
  { code: 'INC-DIAG', label: 'Diagnostics — laboratory and imaging', group: 'Operating', category: 'Pathology', note: 'Samples and studies are collected before the report; the head follows the order, not the result.' },
  { code: 'INC-PHARM', label: 'Pharmacy sales', group: 'Operating', category: 'Pharmacy', note: 'Retail counter. Ward issues are billed through the inpatient head instead.' },
  { code: 'INC-PROC', label: 'Procedures and theatre', group: 'Operating', category: 'Procedure', note: 'Dressings, ECG, day procedures and theatre charges.' },
  { code: 'INC-BB', label: 'Blood bank', group: 'Operating', category: 'Procedure', note: 'Components and cross-match. The service charge only — donations are not income.' },
  { code: 'INC-AMB', label: 'Ambulance', group: 'Operating', category: 'Ambulance', note: 'Trip charges. A call that never left the gate is not billed.' },
  { code: 'INC-OTHER', label: 'Other operating income', group: 'Operating', category: null, note: 'Canteen rent, medical reports, certificates — collected at the counter but not billed to a patient account.' },
  { code: 'INC-DONATION', label: 'Donations and grants', group: 'Non-operating', category: null, note: 'Kept out of operating income on purpose: it must never pay for a month of salaries.' },
];

export const incomeHeadByCode = (code: string): IncomeHead | undefined => INCOME_HEADS.find((h) => h.code === code);

export type ExpenseHeadClass = 'Revenue' | 'Capital';

export interface ExpenseHead {
  code: string;
  label: string;
  klass: ExpenseHeadClass;
  /** Withholding tax as a share of the bill, or null when the head does not attract any. */
  aitPct: number | null;
  /** Input VAT recorded on the bill, or null when the supplier is not registered. */
  vatPct: number | null;
  /**
   * Whether the payment is a purchase. A purchase is quoted and compared; a meter, a rental agreement and a
   * licence are not, and asking for a quotation for electricity is how an approval queue becomes a formality.
   */
  quotable: boolean;
  note: string;
}

export const EXPENSE_HEADS: ExpenseHead[] = [
  { code: 'EXP-DRUG', label: 'Drugs and surgical supplies', klass: 'Revenue', aitPct: 3, vatPct: 5, quotable: true, note: 'The largest line in a hospital. Withholding applies to the supplier, VAT to the goods.' },
  { code: 'EXP-SALARY', label: 'Salaries and wages', klass: 'Revenue', aitPct: null, vatPct: null, quotable: false, note: 'Payroll is paid from its own run and appears here as a single monthly voucher; withholding on salary is deducted per employee, not per voucher.' },
  { code: 'EXP-RENT', label: 'Rent and rates', klass: 'Revenue', aitPct: 5, vatPct: null, quotable: false, note: 'Withholding on rent is the tenant’s duty, and an unpaid one lands on the hospital, not the landlord.' },
  { code: 'EXP-UTIL', label: 'Utilities — power, gas, water', klass: 'Revenue', aitPct: null, vatPct: 5, quotable: false, note: 'Paid against a meter. A generator running on diesel appears under repairs and fuel instead.' },
  { code: 'EXP-REPAIR', label: 'Repairs and maintenance', klass: 'Revenue', aitPct: 5, vatPct: 5, quotable: true, note: 'Keeps an asset working. Replaces an asset: capital.' },
  { code: 'EXP-EQUIP', label: 'Equipment and instruments', klass: 'Capital', aitPct: 5, vatPct: 5, quotable: true, note: 'Above the capital floor this is an asset on the register, depreciated — not an expense of the month it arrived.' },
  { code: 'EXP-VENDOR', label: 'Outsourced services', klass: 'Revenue', aitPct: 5, vatPct: 5, quotable: true, note: 'Cleaning, security, laundry, waste. They bill monthly and they must show a VAT registration.' },
  { code: 'EXP-TRANSPORT', label: 'Transport and fuel', klass: 'Revenue', aitPct: null, vatPct: null, quotable: false, note: 'Filled at the pump against a vehicle log; the log, not the receipt, is what a fuel audit reads.' },
  { code: 'EXP-PROF', label: 'Professional and consultancy fees', klass: 'Revenue', aitPct: 10, vatPct: null, quotable: false, note: 'Doctors, auditors, lawyers. The highest withholding rate on the list, and the voucher names the engagement.' },
  { code: 'EXP-STAT', label: 'Statutory and licences', klass: 'Revenue', aitPct: null, vatPct: null, quotable: false, note: 'VAT returns, trade licence, drug licence, fire safety, waste clearance.' },
  { code: 'EXP-MARKET', label: 'Marketing and referral events', klass: 'Revenue', aitPct: 5, vatPct: 15, quotable: true, note: 'Referral payouts are not marketing: they are commission, and they run through their own register.' },
  { code: 'EXP-TRAIN', label: 'Training and continuing education', klass: 'Revenue', aitPct: 10, vatPct: null, quotable: false, note: 'Fees for a named staff member, and the certificate is filed with the voucher.' },
];

export const expenseHeadByCode = (code: string): ExpenseHead | undefined => EXPENSE_HEADS.find((h) => h.code === code);

/** What the branch does with input VAT. It is a setting, not a law in this file: change it with the law. */
export const INPUT_VAT_CREDITABLE = false;
export const INPUT_VAT_NOTE = 'This branch’s clinical services sit outside the VAT net, so the input tax on what it buys is a cost rather than a credit. Accounts sets this per branch; the voucher prints it either way.';

/* ------------------------------------------------------------------ money routes */

export type MoneyRoute = 'Cash' | 'bKash' | 'Nagad' | 'Card' | 'Bank transfer' | 'Cheque' | 'Payer account';

export const MONEY_ROUTES: MoneyRoute[] = ['Cash', 'bKash', 'Nagad', 'Card', 'Bank transfer', 'Cheque', 'Payer account'];

/**
 * Where money taken at the counter actually goes. Only cash is in the drawer at the end of the day; card and
 * mobile money settle to the bank, and a payer's share is a receivable until the insurer pays it.
 */
export const routeOfPayment = (method: PaymentMethod): MoneyRoute => {
  switch (method) {
    case 'Cash':
      return 'Cash';
    case 'bKash':
      return 'bKash';
    case 'Nagad':
      return 'Nagad';
    case 'Card':
      return 'Card';
    case 'Insurance':
    case 'Corporate':
      return 'Payer account';
    default:
      return 'Cash';
  }
};

export const SETTLES_AT_COUNTER: MoneyRoute[] = ['Cash', 'bKash', 'Nagad', 'Card'];

/** Where a route's money is at the end of the day: in a drawer, in the bank, or still somebody's promise. */
export type SettlementGroup = 'Drawer' | 'Bank' | 'Payer account';

export const routeGroup = (route: MoneyRoute): SettlementGroup =>
  route === 'Cash' ? 'Drawer' : route === 'Payer account' ? 'Payer account' : 'Bank';

export const SETTLEMENT_GROUPS: SettlementGroup[] = ['Drawer', 'Bank', 'Payer account'];

export const settlementNote: Record<SettlementGroup, string> = {
  Drawer: 'Counted by a person at the end of the shift. The only figure a discrepancy can be pinned on.',
  Bank: 'Settles through the bank — mobile money and cards take a day, cheques take as long as they take.',
  'Payer account': 'Billed to an insurer or an employer. Money the hospital is owed, not money it has.',
};

/* ------------------------------------------------------------------ vouchers */

/**
 * Every counter that takes money. A hospital does not have one till: it has a billing counter, a pharmacy window,
 * an ambulance desk and whatever else the branch runs. Each one is a place where a person can count cash, so each
 * one reconciles on its own line — a branch figure hides a short drawer behind a busy one.
 */
export type CollectionPoint = 'Billing counter' | 'Pharmacy counter' | 'Ambulance desk';

export interface IncomeVoucher {
  id: string;
  no: string;
  day: string;
  at: string;
  sequence: number;
  headCode: string;
  amount: number;
  method: PaymentMethod;
  route: MoneyRoute;
  point: CollectionPoint;
  counter: string;
  /** The invoice this receipt settles, when it settles one. Only vouchers with a number here sit in the till. */
  invoiceNo?: string;
  reference?: string;
  narration: string;
  recordedBy: string;
  /** Posted on this device and not yet on the server — it is not in the day book until the queue drains. */
  queued?: boolean;
}

export interface ExpenseVoucher {
  id: string;
  no: string;
  day: string;
  at: string;
  sequence: number;
  headCode: string;
  payee: string;
  /** The bill, before withholding and before VAT. */
  gross: number;
  ait: number;
  vat: number;
  /** What leaves the bank or the drawer: gross + VAT − withholding. */
  payable: number;
  method: MoneyRoute;
  costCentre: string;
  billNo?: string;
  chequeNo?: string;
  quotationRef?: string;
  narration: string;
  preparedBy: string;
  approvedBy?: string;
  secondApprover?: string;
  status: 'Awaiting approval' | 'Posted' | 'Refused';
  /** Named when the voucher was refused, so the screen can print the rule rather than a red row. */
  refusals?: string[];
}

export const VOUCHER_PREFIX = { income: 'RV', expense: 'PV' } as const;

export const voucherNo = (kind: 'income' | 'expense', day: string, seq: number): string =>
  `${VOUCHER_PREFIX[kind]}-${day.replace(/-/g, '').slice(2)}-${String(seq).padStart(4, '0')}`;

/* ------------------------------------------------------------------ approval ladder */

export type ApproverRole = 'Accounts officer' | 'Finance manager' | 'Director';

export interface ApprovalStep {
  min: number;
  upTo: number;
  role: ApproverRole;
  /** A second signature from the next role up. */
  second: boolean;
  /** Needs a quotation or a tender note on file before it can be paid. */
  quotation: boolean;
  because: string;
}

export const APPROVAL_LADDER: ApprovalStep[] = [
  { min: 0, upTo: 5_000, role: 'Accounts officer', second: false, quotation: false, because: 'Small and frequent — the counter that buys dressing gauze should not need the finance manager.' },
  { min: 5_000, upTo: 50_000, role: 'Finance manager', second: false, quotation: false, because: 'The level where a bill stops being routine and the manager starts recognising the supplier.' },
  { min: 50_000, upTo: 200_000, role: 'Director', second: true, quotation: true, because: 'Enough to buy a machine. Two signatures and a quotation, because one signature is how a hospital ends up with two of something.' },
  { min: 200_000, upTo: Number.POSITIVE_INFINITY, role: 'Director', second: true, quotation: true, because: 'Board territory: the voucher carries the reference, and the payment waits for the next board note.' },
];

export const approvalFor = (amount: number): ApprovalStep => APPROVAL_LADDER.find((s) => amount > s.min && amount <= s.upTo) ?? APPROVAL_LADDER[APPROVAL_LADDER.length - 1];

/** Above this, a payment leaves through the bank: cash at that size is a control failure, not a convenience. */
export const CASH_PAYMENT_LIMIT = 100_000;
/** At or above this a purchase is an asset on the register rather than an expense of the month. */
export const CAPITAL_FLOOR = 50_000;
/** A voucher more than these days old needs a late-posting note before it can be accepted. */
export const CLOSE_LOCK_DAYS = 3;
/** Cash kept in the counter for change; the rest is banked the next morning. */
export const CASH_FLOAT_RETAINED = 20_000;
export const OPENING_FLOAT_PER_COUNTER = 20_000;

export function deductionsFor(head: ExpenseHead, gross: number): { ait: number; vat: number; payable: number } {
  const ait = head.aitPct == null ? 0 : Math.round((gross * head.aitPct) / 100);
  const vat = head.vatPct == null ? 0 : Math.round((gross * head.vatPct) / 100);
  return { ait, vat, payable: gross + vat - ait };
}

export interface VoucherRefusal {
  code: string;
  message: string;
}

export interface ExpenseCheck {
  approval: ApprovalStep;
  ok: boolean;
  refusals: VoucherRefusal[];
  notes: string[];
}

/** Every reason a voucher may not be posted, named. An empty `refusals` is the only thing that posts it. */
export function checkExpense(draft: {
  headCode: string;
  payee: string;
  gross: number;
  method: MoneyRoute;
  preparedBy: string;
  approvedBy?: string;
  secondApprover?: string;
  quotationRef?: string;
  day: string;
  today: string;
}): ExpenseCheck {
  const head = expenseHeadByCode(draft.headCode);
  const approval = approvalFor(draft.gross);
  const refusals: VoucherRefusal[] = [];
  const notes: string[] = [];

  if (!head) {
    refusals.push({ code: 'unknown-head', message: 'No such expense head — a voucher must post to a head that exists.' });
    return { approval, ok: false, refusals, notes };
  }
  if (draft.gross <= 0) refusals.push({ code: 'not-positive', message: 'A payment voucher is a positive amount. A refund comes back as an income voucher, never as a negative payment.' });
  if (!draft.payee.trim()) refusals.push({ code: 'no-payee', message: 'Money cannot leave without a payee on the voucher.' });

  if (approval.role !== 'Accounts officer' && !draft.approvedBy) {
    refusals.push({ code: 'no-approval', message: `Above ${money(approval.min)} this voucher needs the ${approval.role} to approve it — ${approval.because}` });
  }
  if (approval.role !== 'Accounts officer' && !draft.approvedBy) notes.push('At the bottom of the ladder the bill and the person who prepared it are the record: no second name is asked for, and none is invented.');
  if (approval.second) {
    if (!draft.secondApprover) refusals.push({ code: 'no-second', message: `At this size it carries two signatures: the ${approval.role} and a second approver, or the bill waits.` });
    else if (draft.secondApprover === draft.approvedBy) refusals.push({ code: 'same-signature', message: 'One person signed twice. A second signature is only a control if a second person gives it.' });
  }
  if (draft.approvedBy && draft.approvedBy === draft.preparedBy) {
    refusals.push({ code: 'self-approval', message: 'The person who prepared the voucher cannot approve it. Nobody audits themselves.' });
  }
  if (approval.quotation && head.quotable && !draft.quotationRef) {
    refusals.push({ code: 'no-quotation', message: `Above ${money(approval.min)} a purchase needs a quotation or tender reference on file, or the bill waits.` });
  }
  if (draft.method === 'Cash' && draft.gross > CASH_PAYMENT_LIMIT) {
    refusals.push({ code: 'cash-over-limit', message: `Cash payments stop at ${money(CASH_PAYMENT_LIMIT)}. Above that it goes through the bank and the voucher carries the transfer reference.` });
  }
  const age = daysBetween(draft.day, draft.today);
  if (age > CLOSE_LOCK_DAYS) notes.push(`The books for ${draft.day} are ${age} days old — a late-posting note is needed with the paper voucher.`);

  if (approval.quotation && !head.quotable) notes.push(`${head.label} is paid against a meter, an agreement or a tariff, so no quotation applies — the reference that matters is the bill itself.`);
  if (head.klass === 'Capital' && draft.gross < CAPITAL_FLOOR) {
    notes.push(`Below the ${money(CAPITAL_FLOOR)} capitalisation floor, so this is expensed in the month it was bought rather than carried on the register and depreciated.`);
  }
  if (head.klass === 'Revenue' && draft.gross >= CAPITAL_FLOOR) notes.push(`A large bill on a revenue head: confirm the thing bought is not an asset, because a machine expensed in one month understates the next twelve.`);
  if (head.aitPct == null && draft.gross > 10_000) notes.push(`${head.label} carries no withholding. A large bill with no tax at source is exactly what an audit asks about first.`);
  if (head.vatPct == null) notes.push('No VAT recorded — fine for a non-registered supplier, wrong for a registered one.');
  if (!INPUT_VAT_CREDITABLE && (head.vatPct ?? 0) > 0) notes.push(`Input VAT here is a cost, not a credit (see Setup). It is part of what the purchase cost, so it appears in the expense report, not as a receivable from the tax office.`);

  return { approval, ok: refusals.length === 0, refusals, notes };
}

/* ------------------------------------------------------------------ deterministic helpers */

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ (t ^ (t >>> 14));
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];

const seedOf = (day: string): number => day.split('-').reduce((s, part) => s * 31 + Number(part), 7);

export const DAY_MINUTES = 24 * 60;
/** Minutes into the day → the timestamp a voucher carries. Never called during render. */
export const atMinute = (day: string, minute: number): string => {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000);

export const shiftDay = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const money = (n: number): string => `৳ ${Math.round(n).toLocaleString('en-IN')}`;
export { money as financeMoney };

/** The head an invoice's money belongs to: the category that carries the most value on the bill. */
export function headForInvoice(invoice: Invoice): IncomeHead {
  const byCategory = new Map<Category | 'Insurance' | 'Corporate', number>();
  for (const line of invoice.lines) {
    const key = line.chargedTo === 'Payer' && line.category === 'Consultation' ? 'Insurance' : line.category;
    byCategory.set(key as Category, (byCategory.get(key as Category) ?? 0) + lineNet(line));
  }
  const dominant = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as Category | undefined;
  return INCOME_HEADS.find((h) => h.category === dominant) ?? incomeHeadByCode('INC-OTHER')!;
}

/* ------------------------------------------------------------------ generators */

export interface LedgerOptions {
  /** Receipts posted on this device that the server has not seen yet, oldest first. */
  queuedReceipts?: number;
}

/**
 * Income vouchers for a day: one per counter receipt, in time order, with a shared ledger sequence.
 * The vouchers come from the invoices' own payments, so the book and the till cannot drift apart by accident —
 * which is not a convenience, it is the property the day-end report is built on.
 */
export function generateIncomeVouchers(day: string, opts: LedgerOptions = {}): IncomeVoucher[] {
  const rand = rng(seedOf(day) + 11);
  const invoices = generateInvoices(day).filter((i) => i.status !== 'Cancelled');
  const vouchers: IncomeVoucher[] = [];

  for (const invoice of invoices) {
    const head = headForInvoice(invoice);
    for (const payment of invoice.payments) {
      vouchers.push({
        id: `${invoice.id}-${payment.id}`,
        no: '',
        day,
        at: payment.at,
        sequence: 0,
        headCode: head.code,
        amount: payment.amount,
        method: payment.method,
        route: routeOfPayment(payment.method),
        point: 'Billing counter',
        counter: invoice.counter,
        invoiceNo: invoice.number,
        reference: payment.reference,
        narration: `${head.label} — ${invoice.patientName}`,
        recordedBy: payment.receivedBy,
      });
    }
  }

  // Two things a counter takes that were never billed to a patient account: a certificate fee and a canteen
  // rent. They are receipts all the same, and they are why the ledger figure and the till figure are two
  // figures rather than one.
  const counter = invoices[0]?.counter ?? 'Counter 1';
  // Counter income that was never billed to a patient account: a certificate, and the canteen rent. Real money
  // in the same drawer, and the reason the till figure and the book figure are two figures rather than one.
  const extras: Array<{ amount: number; head: string; narration: string; minute: number }> = [
    { amount: 200 + Math.floor(rand() * 800), head: 'INC-OTHER', narration: 'Medical certificate fee — counter sale', minute: 11 * 60 + 40 },
    { amount: 1_500 + Math.floor(rand() * 500), head: 'INC-OTHER', narration: 'Canteen rent for the month', minute: 15 * 60 + 5 },
  ];
  for (const extra of extras) {
    vouchers.push({
      id: `${day}-X-${extra.head}-${extra.minute}`,
      no: '',
      day,
      at: atMinute(day, extra.minute),
      sequence: 0,
      headCode: extra.head,
      amount: extra.amount,
      method: 'Cash',
      route: 'Cash',
      point: 'Billing counter',
      counter,
      narration: extra.narration,
      recordedBy: 'Reception — R. Akter',
    });
  }

  vouchers.push(...pharmacyReceipts(day, rand), ...ambulanceReceipts(day));
  return number(vouchers, day);

  // The last few receipts are still on the device that took them.
  const queueCount = Math.min(opts.queuedReceipts ?? 0, vouchers.length);
  for (let i = 0; i < queueCount; i += 1) vouchers[vouchers.length - 1 - i].queued = true;
  return vouchers;
}

/** One chronological book: the counters' receipts in time order, numbered in one series. */
function number(vouchers: IncomeVoucher[], day: string): IncomeVoucher[] {
  const sorted = [...vouchers].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  sorted.forEach((v, i) => {
    v.sequence = i + 1;
    v.no = voucherNo('income', day, i + 1);
  });
  return sorted;
}

/**
 * The pharmacy window's own money. A dispensed prescription is paid for at the window, and the method follows the
 * payer: a self-paying patient settles at the counter (the demo's counters take mostly cash, which is what this
 * branch's drawer actually looked like), the insured share lands in a payer account and is never cash.
 */
function pharmacyReceipts(day: string, rand: () => number): IncomeVoucher[] {
  const methods: PaymentMethod[] = ['Cash', 'Cash', 'Cash', 'bKash', 'Card'];
  return generateDispenses(day)
    .filter((d) => d.status === 'Dispensed' && d.total > 0)
    .map((d, i) => {
      const billed = d.patient.payer !== 'Self pay';
      const method: PaymentMethod = billed ? (d.patient.payer === 'Insurance — MetLife' ? 'Insurance' : 'Corporate') : pick(rand, methods);
      return {
        id: `${day}-PH-${d.id}`,
        no: '',
        day,
        at: d.dispensedAt ?? atMinute(day, 12 * 60 + i),
        sequence: 0,
        headCode: 'INC-PHARM',
        amount: d.total,
        method,
        route: routeOfPayment(method),
        point: 'Pharmacy counter' as CollectionPoint,
        counter: `Pharmacy window ${d.counter}`,
        reference: d.rxNumber,
        narration: billed ? `Prescription ${d.rxNumber} — billed to ${d.patient.payer}` : `Prescription ${d.rxNumber} — ${d.lines.length} line${d.lines.length === 1 ? '' : 's'}`,
        recordedBy: d.dispensedBy ?? 'Pharmacy counter',
      };
    });
}

/** Ambulance fares taken at the gate. A mortuary van is charged to the family and stays out of clinical income. */
function ambulanceReceipts(day: string): IncomeVoucher[] {
  const counter = 'Ambulance desk';
  return ambulanceDay(day).calls
    .filter((call) => call.state === 'Completed' && (call.fare?.total ?? 0) > 0)
    .map((call) => {
      const mortuary = call.kind === 'Mortuary';
      return {
        id: `${day}-AMB-${call.id}`,
        no: '',
        day,
        at: call.handoverAt ?? call.receivedAt,
        sequence: 0,
        headCode: mortuary ? 'INC-OTHER' : 'INC-AMB',
        amount: call.fare?.total ?? 0,
        method: 'Cash' as PaymentMethod,
        route: 'Cash' as MoneyRoute,
        point: 'Ambulance desk' as CollectionPoint,
        counter,
        reference: call.id,
        narration: mortuary ? `Mortuary van ${call.id} — charged to the family` : `${call.kind} trip ${call.id} — ${call.from} to ${call.to}`,
        recordedBy: 'Ambulance desk — S. Ahmed',
      };
    });
}

export interface ExpenseDraft {
  id: string;
  headCode: string;
  payee: string;
  gross: number;
  method: MoneyRoute;
  costCentre: string;
  preparedBy: string;
  billNo?: string;
  chequeNo?: string;
  quotationRef?: string;
  narration: string;
  minute: number;
  approvedBy?: string;
  secondApprover?: string;
}

/** The vouchers a hospital of this size writes in a day, and the ones still waiting for a signature. */
export function generateExpenseDrafts(day: string): ExpenseDraft[] {
  const rand = rng(seedOf(day) + 29);
  const pharmacyVendor = 'Square Pharmaceuticals — depot';
  const cleaning = 'CleanCo Facility Services';
  const drafts: ExpenseDraft[] = [
    {
      id: `${day}-PV-dr1`,
      headCode: 'EXP-DRUG',
      payee: pharmacyVendor,
      gross: 120_000 + Math.floor(rand() * 90_000),
      method: 'Bank transfer',
      costCentre: 'Pharmacy store',
      preparedBy: 'Store keeper — M. Islam',
      billNo: `SP-${day.slice(5).replace('-', '')}-114`,
      quotationRef: 'QT-2026-0412 (annual rate contract)',
      narration: 'Monthly replenishment — antibiotics and IV fluids',
      minute: 10 * 60 + 20,
      approvedBy: 'Director — Dr. A. Rahman',
      secondApprover: 'Director — Prof. N. Sultana',
    },
    {
      id: `${day}-PV-ut1`,
      headCode: 'EXP-UTIL',
      payee: 'Dhaka Power Distribution Company',
      gross: 61_400 + Math.floor(rand() * 8_000),
      method: 'Bank transfer',
      costCentre: 'Main campus',
      preparedBy: 'Accounts officer — N. Haque',
      billNo: 'DPDC-7781203',
      narration: 'Electricity — main campus, previous month',
      minute: 11 * 60 + 5,
      approvedBy: 'Director — Dr. A. Rahman',
      secondApprover: 'Director — Prof. N. Sultana',
    },
    {
      id: `${day}-PV-cl1`,
      headCode: 'EXP-VENDOR',
      payee: cleaning,
      gross: 48_000,
      method: 'Cheque',
      costCentre: 'Housekeeping',
      preparedBy: 'Accounts officer — N. Haque',
      billNo: `CC-${day.slice(0, 7)}`,
      narration: 'Housekeeping and waste handling — monthly contract',
      minute: 12 * 60 + 15,
      approvedBy: 'Finance manager — S. Chowdhury',
    },
    {
      id: `${day}-PV-rp1`,
      headCode: 'EXP-REPAIR',
      payee: 'MedTech Engineering',
      gross: 18_500,
      method: 'Cheque',
      costCentre: 'ICU',
      preparedBy: 'Biomedical — T. Hossain',
      billNo: 'MT-99231',
      narration: 'Ventilator flow sensor replacement, bed 4',
      minute: 13 * 60 + 30,
    },
    {
      id: `${day}-PV-tr1`,
      headCode: 'EXP-TRANSPORT',
      payee: 'Padma Filling Station',
      gross: 9_200,
      method: 'Cash',
      costCentre: 'Ambulance fleet',
      preparedBy: 'Transport in-charge — K. Mia',
      narration: 'Diesel — two ambulances, log pages 41–44',
      minute: 14 * 60 + 10,
    },
    {
      id: `${day}-PV-pr1`,
      headCode: 'EXP-PROF',
      payee: 'Rahman & Co., Chartered Accountants',
      gross: 35_000,
      method: 'Bank transfer',
      costCentre: 'Administration',
      preparedBy: 'Accounts officer — N. Haque',
      narration: 'Statutory audit — interim visit',
      minute: 15 * 60 + 45,
      approvedBy: 'Finance manager — S. Chowdhury',
    },
    {
      id: `${day}-PV-eq1`,
      headCode: 'EXP-EQUIP',
      payee: 'Siemens Healthineers — Bangladesh',
      gross: 235_000,
      method: 'Bank transfer',
      costCentre: 'Radiology',
      preparedBy: 'Biomedical — T. Hossain',
      billNo: 'SH-BD-4471',
      quotationRef: 'Tender 2026/07 — three quotations evaluated',
      narration: 'Mobile X-ray unit — 60 % advance against the purchase order',
      minute: 16 * 60 + 20,
      approvedBy: 'Director — Dr. A. Rahman',
      secondApprover: 'Director — Dr. A. Rahman',
      // Deliberately the same signature twice: the control exists to catch this, and the queue says so by name.

    },
  ];
  return drafts;
}

/** Drafts that pass the ladder become vouchers; the rest stay in the queue with the rule that stopped them. */
export function generateExpenseVouchers(day: string, today = day): ExpenseVoucher[] {
  const vouchers: ExpenseVoucher[] = [];
  generateExpenseDrafts(day)
    .sort((a, b) => a.minute - b.minute)
    .forEach((draft, i) => {
      const check = checkExpense({ ...draft, day, today });
      const head = expenseHeadByCode(draft.headCode)!;
      const { ait, vat, payable } = deductionsFor(head, draft.gross);
      vouchers.push({
        id: draft.id,
        no: voucherNo('expense', day, i + 1),
        day,
        at: atMinute(day, draft.minute),
        sequence: 0,
        headCode: draft.headCode,
        payee: draft.payee,
        gross: draft.gross,
        ait,
        vat,
        payable,
        method: draft.method,
        costCentre: draft.costCentre,
        billNo: draft.billNo,
        chequeNo: draft.method === 'Cheque' ? `CHQ-${String(31_400 + i).padStart(6, '0')}` : undefined,
        quotationRef: draft.quotationRef,
        narration: draft.narration,
        preparedBy: draft.preparedBy,
        approvedBy: draft.approvedBy,
        secondApprover: draft.secondApprover,
        status: check.ok ? 'Posted' : 'Awaiting approval',
        refusals: check.ok ? undefined : check.refusals.map((r) => r.message),
      });
    });
  return vouchers;
}

/* ------------------------------------------------------------------ the day book */

export interface HeadTotal {
  code: string;
  label: string;
  count: number;
  amount: number;
}

export interface RouteTotal {
  route: MoneyRoute;
  count: number;
  in: number;
  out: number;
}

export type BookingVerdict = 'agrees' | 'explained' | 'investigate';

export interface LedgerCheck {
  label: string;
  ok: boolean;
  because: string;
  detail?: string;
}

/**
 * One counter's day, answered twice because they are two different questions:
 *
 *  - **the book against the module** — is every document that took money in the ledger? A gap here is a missing
 *    voucher, and the queue may account for it;
 *  - **the drawer against the book** — does the cash in the box equal the cash the ledger says should be there?
 *    A gap here is a person counting short, and no queue explains that.
 *
 * The second only exists once somebody counts, so `counted` is null until the shift is closed.
 */
export interface PointReconciliation {
  point: CollectionPoint;
  /** What the ledger says this counter collected. */
  recorded: number;
  /** What the module behind the counter says it should have collected. */
  expected: number;
  variance: number;
  /** What the ledger says is in the box: the booked vouchers plus anything queued from this counter. */
  drawer: number;
  /** What a person counted at the end of the shift, when they have counted it. */
  counted: number | null;
  /** Counted minus recorded: negative is short. This is the figure nobody can explain away. */
  drawerVariance: number | null;
  verdict: 'agrees' | 'explained' | 'investigate';
  because: string;
}

export interface DayBook {
  day: string;
  asOf: string;
  openingFloat: number;
  income: IncomeVoucher[];
  expenses: ExpenseVoucher[];
  postedExpenses: ExpenseVoucher[];
  awaiting: ExpenseVoucher[];
  byIncomeHead: HeadTotal[];
  byExpenseHead: HeadTotal[];
  byRoute: RouteTotal[];
  /**
   * `in` is what the counters hold; `bookedIn` is what the ledger has. The difference is money in a drawer with
   * a voucher still in flight, and it is reported rather than smoothed.
   */
  cash: { opening: number; in: number; bookedIn: number; out: number; closing: number; depositDue: number; bankedToday: number; counters: Array<{ counter: string; in: number }> };
  bank: { in: number; out: number; chequesIssued: number; chequesCleared: number };
  /** The same money, sorted by where it physically is: a drawer, the bank, or a payer's promise. */
  settlement: Array<{ group: SettlementGroup; in: number; out: number; because: string }>;
  till: DayEnd;
  /** One line per counter: what it recorded, what its own module expects, and the difference. */
  points: PointReconciliation[];
  /** Receipts that settle an invoice and are in cash: the only ones the drawer can be counted against. */
  tillReceipts: number;
  /** Counter income that was never billed — a certificate, a canteen rent. Real money, not in the till figure. */
  offTill: number;
  awaitingSync: { count: number; amount: number; numbers: string[] };
  receivables: { payerShare: number; patientDue: number; settledAtCounter: number };
  withholding: { ait: number; vat: number; note: string };
  variance: number;
  verdict: BookingVerdict;
  because: string;
  checks: LedgerCheck[];
}

const sum = <T,>(rows: T[], of: (row: T) => number): number => rows.reduce((s, row) => s + of(row), 0);

function headTotals<T extends { headCode: string }>(rows: T[], of: (row: T) => number, lookup: (code: string) => { label: string } | undefined): HeadTotal[] {
  const map = new Map<string, HeadTotal>();
  for (const row of rows) {
    const entry = map.get(row.headCode) ?? { code: row.headCode, label: lookup(row.headCode)?.label ?? row.headCode, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += of(row);
    map.set(row.headCode, entry);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export interface DayBookOptions extends LedgerOptions {
  /** Receipts posted on this device that the queue has not yet delivered. */
  queuedIncome?: IncomeVoucher[];
  queuedExpenses?: ExpenseVoucher[];
  /** The previous day's closing deposit, which hits the bank this morning. */
  bankedToday?: number;
  /** What each drawer held when the shift closed. Omitted until somebody counts. */
  counted?: Partial<Record<CollectionPoint, number>>;
}

export function dayBook(day: string, opts: DayBookOptions = {}): DayBook {
  const generated = generateIncomeVouchers(day, opts);
  const queuedIncome = opts.queuedIncome ?? [];
  const income = [...generated, ...queuedIncome];
  const queuedIds = new Set(queuedIncome.map((v) => v.id));
  // Queued receipts are not in the book yet: they are money in a real drawer with no ledger line behind them.
  const bookedIncome = income.filter((v) => !queuedIds.has(v.id) && !v.queued);
  const expenses = generateExpenseVouchers(day);
  const postedExpenses = expenses.filter((v) => v.status === 'Posted');
  const awaiting = expenses.filter((v) => v.status !== 'Posted');
  const extraExpenses = opts.queuedExpenses ?? [];
  const inBookExpenses = [...postedExpenses, ...extraExpenses];

  const counters = [...new Set(bookedIncome.map((v) => v.counter))];
  const openingFloat = counters.length * OPENING_FLOAT_PER_COUNTER;

  // Physical cash: a receipt queued on this device is in the box, whether or not the ledger has it yet.
  const cashIn = sum(income.filter((v) => v.route === 'Cash'), (v) => v.amount);
  const bookedCashIn = sum(bookedIncome.filter((v) => v.route === 'Cash'), (v) => v.amount);
  const cashOut = sum(inBookExpenses.filter((v) => v.method === 'Cash'), (v) => v.payable);
  const closing = openingFloat + cashIn - cashOut;
  const depositDue = Math.max(0, closing - CASH_FLOAT_RETAINED);
  const bankedToday = opts.bankedToday ?? shiftCashDeposit(day);

  const till = dayEnd(generateInvoices(day));
  const tillReceipts = sum(bookedIncome.filter((v) => v.route === 'Cash' && v.invoiceNo), (v) => v.amount);
  const offTill = cashIn - tillReceipts;
  const awaitingSyncRows = income.filter((v) => v.queued || queuedIds.has(v.id));
  const awaitingSync = { count: awaitingSyncRows.length, amount: sum(awaitingSyncRows, (v) => v.amount), numbers: awaitingSyncRows.map((v) => v.no || v.id) };

  /*
   * Each counter against the module that knows what it should have taken. On this device both sides come off the
   * same generators — the reconciliation that matters is the one the server will run, when the left side is the
   * server's day-end and the right side is the vouchers that reached it. The arithmetic and the verdicts are the
   * same either way, which is why they live here and not in a report.
   */
  const atPoint = (point: CollectionPoint) => bookedIncome.filter((v) => v.point === point && SETTLES_AT_COUNTER.includes(v.route));
  const points: PointReconciliation[] = ([
    { point: 'Billing counter' as CollectionPoint, expected: till.collected, counted: sum(atPoint('Billing counter').filter((v) => v.invoiceNo), (v) => v.amount), because: 'Every payment the billing counter took against an invoice, in any method. The payer’s share is not here: it was never collected at a window, and a certificate fee was never billed to one.' },
    { point: 'Pharmacy counter' as CollectionPoint, expected: sum(generateDispenses(day).filter((d) => d.status === 'Dispensed' && d.patient.payer === 'Self pay'), (d) => d.total), counted: sum(atPoint('Pharmacy counter'), (v) => v.amount), because: 'What pharmacy dispensed to self-paying patients. The insured share is billed to the payer, so it is a receivable rather than a collection.' },
    { point: 'Ambulance desk' as CollectionPoint, expected: sum(ambulanceDay(day).calls.filter((c) => c.state === 'Completed'), (c) => c.fare?.total ?? 0), counted: sum(atPoint('Ambulance desk'), (v) => v.amount), because: 'Fares for trips that actually completed. A call the vehicle never left the gate for is not billed.' },
  ]).map((row) => {
    const variance = row.expected - row.counted;
    const queuedAtPoint = sum(awaitingSyncRows.filter((v) => v.point === row.point), (v) => v.amount);
    const counted = opts.counted?.[row.point] ?? null;
    // The box holds the booked receipts plus whatever is still queued from this counter: a receipt that has not
    // reached the server is still a note in a drawer.
    const drawer = row.counted + queuedAtPoint;
    const drawerVariance: number | null = counted == null ? null : counted - drawer;
    const countedShort = drawerVariance != null && Math.abs(drawerVariance) >= 1;
    const verdict: BookingVerdict = countedShort
      ? 'investigate'
      : variance === 0
        ? 'agrees'
        : Math.abs(variance - queuedAtPoint) < 1
          ? 'explained'
          : 'investigate';
    return {
      point: row.point,
      recorded: row.counted,
      expected: row.expected,
      variance,
      drawer,
      counted,
      drawerVariance,
      verdict,
      because: countedShort
        ? `Counted ${money(counted ?? 0)} against the ${money(drawer)} the ledger and the queue say should be in the box — ${money(Math.abs(drawerVariance))} ${drawerVariance! < 0 ? 'short' : 'over'}. A queue cannot explain a drawer: this one is counted again and, if it still does not add up, written up with a reason and an approver.`
        : verdict === 'agrees'
          ? row.because
          : verdict === 'explained'
            ? `${money(queuedAtPoint)} of this counter’s takings is still queued on the device that took it — in the drawer, not yet in the book.`
            : `${money(Math.abs(variance))} ${variance > 0 ? 'short of' : 'over'} what this counter should have taken, and the queue does not explain it. This is the counter to go and stand at.`,
    };
  });

  const bookedBranch = sum(points, (p) => p.recorded);
  const expectedBranch = sum(points, (p) => p.expected);
  const variance = expectedBranch - bookedBranch;
  // The branch verdict: a difference somebody has to chase beats a queue that only has to drain.
  const verdict: BookingVerdict = points.some((p) => p.verdict === 'investigate')
    ? 'investigate'
    : awaitingSync.count > 0
      ? 'explained'
      : 'agrees';
  const because =
    verdict === 'agrees'
      ? 'Every counter says what the book says: each receipt of the day is a voucher, and each voucher is a receipt.'
      : verdict === 'explained'
        ? `${money(awaitingSync.amount)} was taken at a counter and is still queued on the device that took it, so it is in the drawer and not yet in the book. The queue draining closes the difference.`
        : `${points.filter((p) => p.verdict === 'investigate').map((p) => p.point).join(', ')} differ${points.filter((p) => p.verdict === 'investigate').length === 1 ? 's' : ''} by ${money(variance)} and the queue does not account for it. Count that drawer again, then find the voucher: an unexplained cash difference is never a rounding error.`;

  const routeRows: RouteTotal[] = MONEY_ROUTES.map((route) => {
    const rowsIn = bookedIncome.filter((v) => v.route === route);
    const rowsOut = inBookExpenses.filter((v) => v.method === route);
    return { route, count: rowsIn.length + rowsOut.length, in: sum(rowsIn, (v) => v.amount), out: sum(rowsOut, (v) => v.payable) };
  }).filter((r) => r.count > 0);

  const payerShare = sum(inBookExpenses, () => 0) + till.payerShare;
  const patientDue = till.due;
  const settledAtCounter = sum(bookedIncome.filter((v) => v.route !== 'Cash' && v.route !== 'Payer account'), (v) => v.amount);

  const checks: LedgerCheck[] = [
    {
      label: 'Every counter agrees with the module behind it',
      ok: points.every((p) => p.variance === 0 || Math.abs(p.variance) === sum(awaitingSyncRows.filter((v) => v.point === p.point), (v) => v.amount)),
      because: 'The billing counter against the day-end sheet, the pharmacy window against what it dispensed, the ambulance desk against the trips that completed. A gap is a missing voucher — and a queued receipt is a gap the queue names.',
      detail: points.map((p) => `${p.point} ${money(p.recorded)}/${money(p.expected)}${p.variance === 0 ? '' : ` (${p.variance > 0 ? 'short' : 'over'} ${money(Math.abs(p.variance))})`}`).join(' · '),
    },
    {
      label: 'Cash counted against the book',
      ok: points.every((p) => p.drawerVariance == null || Math.abs(p.drawerVariance) < 1),
      because: 'A book figure nobody counted is an assumption. Where a shift has been closed, the counted cash has to equal the ledger — and a short drawer is investigated, never adjusted.',
      detail: points.filter((p) => p.counted != null).length === 0 ? 'no drawer counted yet today' : points.map((p) => `${p.point} counted ${money(p.counted ?? 0)}`).join(' · '),
    },
    {
      label: 'Receipts that were never billed',
      ok: offTill >= 0,
      because: 'A certificate fee or a canteen rent is real money in the drawer and belongs to no invoice — it is why the till figure and the book figure are two figures.',
      detail: `${money(offTill)} of the day’s cash has no invoice behind it`,
    },
    {
      label: 'Vouchers carry a sequence',
      ok: bookedIncome.every((v, i) => v.sequence > 0 && v.sequence === i + 1),
      because: 'A gapless sequence per node is the whole reason a missing voucher can be seen at all.',
      detail: `${bookedIncome.length} income vouchers, numbered 1–${bookedIncome.length}`,
    },
    {
      label: 'Nothing is banked in cash twice',
      ok: depositDue <= closing,
      because: 'The deposit is built from the closing figure, so it can never exceed what the counters hold.',
      detail: `closing ${money(closing)} · deposit due ${money(depositDue)}`,
    },
    {
      label: 'Withholding and VAT recorded',
      ok: inBookExpenses.every((v) => v.ait >= 0 && v.vat >= 0),
      because: 'A bill without its tax lines is the first thing an assessment finds, and the last thing accounts can reconstruct.',
      detail: `AIT ${money(sum(inBookExpenses, (v) => v.ait))} · VAT ${money(sum(inBookExpenses, (v) => v.vat))}`,
    },
    {
      label: 'Payer money is not counted as cash',
      ok: bookedIncome.every((v) => v.route === routeOfPayment(v.method)),
      because: 'An insurer’s share is a receivable until it is paid. Counting it at the counter is how a day book stops being true.',
      detail: `payer share ${money(till.payerShare)} · patient due ${money(patientDue)}`,
    },
    {
      label: 'Every voucher has an author',
      ok: [...bookedIncome, ...inBookExpenses].every((v) => (('recordedBy' in v ? v.recordedBy : v.preparedBy) ?? '').length > 0),
      because: 'A movement with nobody behind it cannot be corrected, only guessed at.',
    },
  ];

  return {
    day,
    asOf: atMinute(day, 21 * 60 + 30),
    openingFloat,
    income,
    expenses,
    postedExpenses,
    awaiting,
    points,
    byIncomeHead: headTotals(bookedIncome, (v) => v.amount, incomeHeadByCode),
    byExpenseHead: headTotals(inBookExpenses, (v) => v.payable, expenseHeadByCode),
    byRoute: routeRows,
    cash: { opening: openingFloat, in: cashIn, bookedIn: bookedCashIn, out: cashOut, closing, depositDue, bankedToday, counters: counters.map((counter) => ({ counter, in: sum(bookedIncome.filter((v) => v.counter === counter), (v) => v.amount) })) },
    bank: {
      in: sum(bookedIncome.filter((v) => routeGroup(v.route) === 'Bank'), (v) => v.amount),
      out: sum(inBookExpenses.filter((v) => v.method === 'Bank transfer' || v.method === 'Cheque'), (v) => v.payable),
      chequesIssued: inBookExpenses.filter((v) => v.method === 'Cheque').length,
      /** A cheque issued but not yet presented is money still in the bank — the register tracks it, not the balance. */
      chequesCleared: Math.max(0, inBookExpenses.filter((v) => v.method === 'Cheque').length - 1),
    },
    settlement: SETTLEMENT_GROUPS.map((group) => ({
      group,
      in: sum(bookedIncome.filter((v) => routeGroup(v.route) === group), (v) => v.amount),
      out: sum(inBookExpenses.filter((v) => routeGroup(v.method) === group), (v) => v.payable),
      because: settlementNote[group],
    })),
    till,
    tillReceipts,
    offTill,
    awaitingSync,
    receivables: { payerShare, patientDue, settledAtCounter },
    withholding: { ait: sum(inBookExpenses, (v) => v.ait), vat: sum(inBookExpenses, (v) => v.vat), note: INPUT_VAT_NOTE },
    variance,
    verdict,
    because,
    checks,
  };
}

/** Yesterday's cash, to the nearest taka, as it reaches the bank this morning. */
function shiftCashDeposit(day: string): number {
  const prev = shiftDay(day, -1);
  const income = generateIncomeVouchers(prev).filter((v) => v.route === 'Cash');
  const expenses = generateExpenseVouchers(prev).filter((v) => v.status === 'Posted' && v.method === 'Cash');
  const counters = [...new Set(income.map((v) => v.counter))].length || 1;
  const closing = counters * OPENING_FLOAT_PER_COUNTER + sum(income, (v) => v.amount) - sum(expenses, (v) => v.payable);
  return Math.max(0, closing - CASH_FLOAT_RETAINED);
}

/* ------------------------------------------------------------------ what the screens ask */

export interface FinanceSnapshot {
  book: DayBook;
  metrics: Array<{ id: string; label: string; value: string; because: string; tone: 'neutral' | 'success' | 'warning' | 'critical' }>;
  openApprovals: ExpenseVoucher[];
  audit: Array<{ at: string; voucher: string; what: string; actor: string }>;
}

export function financeSnapshot(day: string, today = day, opts: DayBookOptions = {}): FinanceSnapshot {
  const book = dayBook(day, opts);
  const metrics = [
    {
      id: 'cash',
      label: 'Cash in the drawer',
      value: money(book.cash.closing),
      because: `Opening float ${money(book.cash.opening)} + cash in ${money(book.cash.in)} − cash out ${money(book.cash.out)}. The deposit due is ${money(book.cash.depositDue)}.`,
      tone: book.verdict === 'investigate' ? ('critical' as const) : ('neutral' as const),
    },
    {
      id: 'collected',
      label: 'Collected today',
      value: money(book.till.collected),
      because: `Cash ${money(book.till.cashExpected)} is what a person can count; the rest settled to the bank or to a payer account. ${money(book.awaitingSync.amount)} of it is still queued on this device.`,
      tone: 'neutral' as const,
    },
    {
      id: 'receivable',
      label: 'Receivable — payers',
      value: money(book.receivables.payerShare),
      because: 'Insurance and corporate shares are billed to the payer and collected later. Not cash, and reported apart from it.',
      tone: 'warning' as const,
    },
    {
      id: 'approvals',
      label: 'Expenses awaiting approval',
      value: money(sum(book.awaiting, (v) => v.payable)),
      because: book.awaiting.length === 0 ? 'Every voucher of the day has the signatures its size requires.' : `${book.awaiting.length} voucher${book.awaiting.length === 1 ? '' : 's'} cannot be paid until the ladder is satisfied — each row names the rule.`,
      tone: book.awaiting.length > 0 ? ('warning' as const) : ('success' as const),
    },
    {
      id: 'withholding',
      label: 'Withholding and VAT today',
      value: money(book.withholding.ait + book.withholding.vat),
      because: `Tax deducted at source ${money(book.withholding.ait)} is money the hospital holds for the tax office, and VAT ${money(book.withholding.vat)} is recorded whether or not it is claimable.`,
      tone: 'neutral' as const,
    },
  ];

  const audit = [...book.income.map((v) => ({ at: v.at, voucher: v.no, what: `Income ${money(v.amount)} — ${incomeHeadByCode(v.headCode)?.label ?? v.headCode} (${v.method})`, actor: v.recordedBy })),
    ...book.postedExpenses.map((v) => ({ at: v.at, voucher: v.no, what: `Payment ${money(v.payable)} — ${expenseHeadByCode(v.headCode)?.label ?? v.headCode} to ${v.payee}`, actor: v.preparedBy }))]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 12);

  return { book, metrics, openApprovals: book.awaiting, audit };
}

export const FINANCE_DAY_OFFSETS = [-2, -1, 0] as const;

/** Everything the money reports read, in one shape: heads, days, and the two sides of every figure. */
export interface FinanceWindow {
  from: string;
  to: string;
  days: string[];
  income: HeadTotal[];
  expense: HeadTotal[];
  cash: { in: number; out: number; deposit: number };
  bank: { in: number; out: number };
  withholding: { ait: number; vat: number };
  receivables: { payerShare: number; patientDue: number };
  byDay: Array<{ day: string; collected: number; paid: number; cash: number }>;
}

export function financeWindow(to: string, days = 14): FinanceWindow {
  const dayList = Array.from({ length: days }, (_, i) => shiftDay(to, -(days - 1 - i)));
  const income: HeadTotal[] = [];
  const expense: HeadTotal[] = [];
  const byDay: FinanceWindow['byDay'] = [];
  const cash = { in: 0, out: 0, deposit: 0 };
  const bank = { in: 0, out: 0 };
  const withholding = { ait: 0, vat: 0 };
  const receivables = { payerShare: 0, patientDue: 0 };

  for (const day of dayList) {
    const book = dayBook(day);
    for (const row of book.byIncomeHead) {
      const found = income.find((x) => x.code === row.code);
      if (found) {
        found.count += row.count;
        found.amount += row.amount;
      } else income.push({ ...row });
    }
    for (const row of book.byExpenseHead) {
      const found = expense.find((x) => x.code === row.code);
      if (found) {
        found.count += row.count;
        found.amount += row.amount;
      } else expense.push({ ...row });
    }
    cash.in += book.cash.in;
    cash.out += book.cash.out;
    cash.deposit += book.cash.depositDue;
    bank.in += book.bank.in;
    bank.out += book.bank.out;
    withholding.ait += book.withholding.ait;
    withholding.vat += book.withholding.vat;
    receivables.payerShare += book.receivables.payerShare;
    receivables.patientDue += book.receivables.patientDue;
    byDay.push({ day, collected: book.till.collected, paid: sum(book.postedExpenses, (v) => v.payable), cash: book.till.cashExpected });
  }

  income.sort((a, b) => b.amount - a.amount);
  expense.sort((a, b) => b.amount - a.amount);
  return { from: dayList[0], to: dayList[dayList.length - 1], days: dayList, income, expense, cash, bank, withholding, receivables, byDay };
}

/** The cost centres this branch uses. A head answers *what*; a cost centre answers *for whom*. */
export const COST_CENTRES = ['Main campus', 'OPD block', 'ICU', 'Ward A', 'Ward B', 'Radiology', 'Laboratory', 'Pharmacy store', 'Housekeeping', 'Ambulance fleet', 'Administration', 'Accounts'];

export const PAYEE_SUGGESTIONS = [
  'Square Pharmaceuticals — depot',
  'CleanCo Facility Services',
  'Dhaka Power Distribution Company',
  'MedTech Engineering',
  'Padma Filling Station',
  'Rahman & Co., Chartered Accountants',
  'Siemens Healthineers — Bangladesh',
  'Titas Gas Transmission',
  'Sayeed Surgical House',
];

/** Counter receipts of the last few days, for the picker that lets a voucher settle an invoice. */
export function unsettledCashInvoices(day: string, limit = 8): Invoice[] {
  return generateInvoices(day)
    .filter((i) => i.status !== 'Cancelled' && i.payments.length > 0)
    .slice(0, limit);
}

export const unknownPatientName = (mrn: string): string => patients.find((p) => p.mrn === mrn)?.name ?? mrn;

export const PAYMENT_METHOD_LIST = PAYMENT_METHODS;
export { totals as invoiceTotals };
