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

import { PAYMENT_METHODS, dayEnd, generateInvoices, lineNet, payerCoverage, totals, type Category, type DayEnd, type Invoice, type Payer, type PaymentMethod } from './billing';
import { ambulanceDay } from './ambulance';
import { generateDispenses } from './pharmacy';
import { BED_CHARGE, generateInpatient } from './ward';
import { openBills } from './module-billing';
import {
  EXPENSE_HEADS,
  INCOME_HEADS,
  PAYER_AGREEMENTS,
  REFERRERS,
  commissionable,
  expenseHeadByCode,
  headCollects,
  incomeHeadByCode,
  payerAgreement,
  referrerByCode,
  type ExpenseHead,
  type ExpenseHeadClass,
  type IncomeGroup,
  type IncomeHead,
  type PayerAgreement,
  type Referrer,
  type ReferrerKind,
} from './finance-tables';

/* The standing tables — the heads, what each payer agreed, who may be paid a commission and how long that lasts —
 * live in their own leaf module (`finance-tables.ts`). They are re-exported here so every caller that reaches for
 * `INCOME_HEADS` or `REFERRERS` from the ledger keeps working, and so a screen has one import for the terms. */
export {
  AGREEMENT_WARN_DAYS,
  EXPENSE_HEADS,
  INCOME_HEADS,
  PAYER_AGREEMENTS,
  REFERRERS,
  agreementLife,
  commissionable,
  expenseHeadByCode,
  headCollects,
  incomeHeadByCode,
  payerAgreement,
  referrerByCode,
} from './finance-tables';
export type { AgreementLife, AgreementState, PayerAgreement, PayerKind, Referrer, ReferrerKind } from './finance-tables';
export type { ExpenseHead, ExpenseHeadClass, IncomeGroup, IncomeHead } from './finance-tables';


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
const financeMoney = money;

/** The head an invoice's money belongs to: the category that carries the most value on the bill. */
export function headForInvoice(invoice: Invoice): IncomeHead {
  const byCategory = new Map<Category | 'Insurance' | 'Corporate', number>();
  for (const line of invoice.lines) {
    const key = line.chargedTo === 'Payer' && line.category === 'Consultation' ? 'Insurance' : line.category;
    byCategory.set(key as Category, (byCategory.get(key as Category) ?? 0) + lineNet(line));
  }
  const dominant = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as Category | undefined;
  return (dominant ? INCOME_HEADS.find((h) => headCollects(h, dominant)) : undefined) ?? incomeHeadByCode('INC-OTHER')!;
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
  /*
   * What the counter took against an invoice, in the routes a counter settles: cash, card and mobile money.
   *
   * The till's own `collected` figure is every payment on the day's invoices, and it has to be, because it is the
   * module's answer to "what was billed and paid". A cheque, a bank transfer and a corporate or insurer share are
   * recorded at the counter and settle somewhere else — so comparing the counter's takings against the till's whole
   * `collected` accuses the counter of a shortage that is a payer's promise. The two sides are counted the same way
   * here, and the drawer keeps its own arithmetic below.
   */
  const counterTakings = sum(
    generateInvoices(day).filter((i) => i.status !== 'Cancelled'),
    (invoice) => sum(invoice.payments.filter((p) => SETTLES_AT_COUNTER.includes(routeOfPayment(p.method))), (p) => p.amount),
  );
  const points: PointReconciliation[] = ([
    { point: 'Billing counter' as CollectionPoint, expected: counterTakings, counted: sum(atPoint('Billing counter').filter((v) => v.invoiceNo), (v) => v.amount), because: `Every payment the billing counter took against an invoice in a route the counter settles — cash, card and mobile money, ${money(counterTakings)} of the till’s ${money(till.collected)}. A cheque, a bank transfer and the payer’s share are recorded at the counter and settle elsewhere, so they are receivables rather than drawer money.` },
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

/* ================================================================================== receivables — TPA claims
 *
 * Billing knows the payer owes; this is where the hospital gets paid. Four rules, each of which is a way
 * hospitals lose money:
 *
 *  1. **Pre-authorisation is bought before the service.** Above the agreed threshold a claim without a
 *     pre-authorisation number is the commonest short payment there is, so it is refused at submission rather
 *     than discovered on the remittance.
 *  2. **The clock is the payer's promise, and a query does not stop it.** Ageing is measured from submission
 *     against the agreed settlement period; a claim sitting with the payer for a hundred days is chased
 *     whatever stage it claims to be at.
 *  3. **A short payment or a rejection is assigned to somebody.** A disallowed amount stays open until it is
 *     absorbed by the hospital, billed to the patient or sent back for rework — an unassigned write-off is how
 *     money disappears a year at a time without a decision.
 *  4. **Nothing is submitted twice.** One claim per invoice per payer, and the payer's answer is recorded
 *     against the claim rather than a second claim being raised.
 */


export type ClaimStatus = 'Draft' | 'Pre-auth requested' | 'Pre-auth approved' | 'Submitted' | 'Query raised' | 'Partially settled' | 'Settled' | 'Rejected';

export const CLAIM_STATUSES: ClaimStatus[] = ['Draft', 'Pre-auth requested', 'Pre-auth approved', 'Submitted', 'Query raised', 'Partially settled', 'Settled', 'Rejected'];

export const CLAIM_OPEN: ClaimStatus[] = ['Draft', 'Pre-auth requested', 'Pre-auth approved', 'Submitted', 'Query raised', 'Partially settled'];

export const claimTone: Record<ClaimStatus, 'neutral' | 'info' | 'warning' | 'success' | 'critical'> = {
  Draft: 'neutral',
  'Pre-auth requested': 'info',
  'Pre-auth approved': 'info',
  Submitted: 'info',
  'Query raised': 'warning',
  'Partially settled': 'warning',
  Settled: 'success',
  Rejected: 'critical',
};

/** The vocabulary a remittance advice uses, and who carries each one. Recording it is what turns a short payment into a lesson. */
export const SHORT_PAY_REASONS: Array<{ code: string; label: string; who: 'Hospital' | 'Patient' | 'Payer rework'; because: string }> = [
  { code: 'no-pre-auth', label: 'No pre-authorisation', who: 'Hospital', because: 'The service was above the threshold and nobody asked first. The hospital carries it.' },
  { code: 'tariff', label: 'Above the agreed tariff', who: 'Hospital', because: 'The hospital billed more than the contract allows for that item. The tariff, not the bill, is the agreement.' },
  { code: 'not-covered', label: 'Not covered by the policy', who: 'Patient', because: 'The policy excludes it — a waiting period, a pre-existing condition, an exclusion clause. It is the patient’s to pay, and the patient has to be told.' },
  { code: 'no-documents', label: 'Documents incomplete', who: 'Payer rework', because: 'A missing discharge summary or report. Resubmit rather than write anything off.' },
  { code: 'co-pay', label: 'Co-payment applied', who: 'Patient', because: 'The agreed share the patient pays. Not a loss — it moves from the payer to the patient.' },
  { code: 'duplicate', label: 'Duplicate item', who: 'Hospital', because: 'The same item was claimed twice on one bill, which is a billing error and gets corrected in the ledger.' },
];

export const REJECTION_REASONS = [
  'Eligibility not found',
  'Policy lapsed on the treatment date',
  'Treatment inside a waiting period',
  'Claim filed after the deadline',
  'Signature missing',
];

export type ClaimBasis = 'Final bill' | 'Interim estimate';

/** The register covers this many days of bills. An older claim would stay in it until it is closed — see the note below. */
export const CLAIM_REGISTER_DAYS = 45;
/** The desk files a claim this many days after the bill is raised. */
export const CLAIM_FILING_DELAY_DAYS = 2;
/** Every seventh claim is filed late, because a document was missing: the delay is the payer's clock, not an excuse. */
export const CLAIM_LATE_FILING_DAYS = 20;
export const CLAIM_LATE_FILING_EVERY = 7;

/**
 * What a ward's stay is expected to cost beyond the bed itself — theatre, the delivery room, intensive monitoring.
 * An inpatient claim is raised on an estimate like this one because the pre-authorisation is decided before the
 * final bill exists; the claim is filed against the discharge bill, and the screen says which basis it is on.
 */
export const WARD_PROCEDURE_ESTIMATE: Record<string, number> = { 'med-a': 8_000, 'surg-b': 45_000, 'mat-c': 35_000, hdu: 25_000 };

export interface Claim {
  id: string;
  claimNo: string;
  invoiceNo: string;
  mrn: string;
  patientName: string;
  payer: Payer;
  tpa: string | null;
  /** Whether this is a claim against a raised bill or an estimate for a patient still in a bed. */
  basis: ClaimBasis;
  /** What the hospital claims: the payer's share of the bill, or of the estimate, after the agreed discount. */
  claimed: number;
  /** What the payer allowed. Zero while the claim is open. */
  allowed: number;
  disallowed: number;
  /** The patient's share of what was not allowed — moved to their account, not lost. */
  toPatient: number;
  /** What the hospital carries, and who signed for it. */
  absorbed: number;
  absorbedBy: string | null;
  status: ClaimStatus;
  shortPayCode: string | null;
  rejectionReason: string | null;
  preAuth: string | null;
  /** When the bill was raised. The claim's clock starts at filing, not here. */
  raisedAt: string;
  submittedAt: string | null;
  respondedAt: string | null;
  settledAmount: number;
  settledAt: string | null;
  documents: string[];
  /** Days since filing, against the payer's promised period. */
  ageDays: number;
  overdueDays: number;
  notes: string[];
}

/** Where a remittance line leaves the money. An unassigned difference keeps the claim open. */
export interface RemittanceLine {
  status: ClaimStatus;
  allowed: number;
  disallowed: number;
  toPatient: number;
  absorbed: number;
  absorbedBy: string | null;
  shortPayCode: string | null;
  rejectionReason: string | null;
  because: string;
}

export interface ClaimCheck {
  ok: boolean;
  refusals: Array<{ code: string; message: string }>;
  warnings: string[];
}

/** Whether a claim may leave the desk. Each refusal is a remittance-advice line waiting to happen. */
export function checkClaim(
  claim: Pick<Claim, 'payer' | 'claimed' | 'preAuth' | 'documents' | 'status' | 'invoiceNo' | 'claimNo' | 'basis'>,
  existing: Claim[] = [],
): ClaimCheck {
  const agreement = payerAgreement(claim.payer);
  const refusals: Array<{ code: string; message: string }> = [];
  const warnings: string[] = [];
  if (!agreement) return { ok: false, refusals: [{ code: 'no-agreement', message: 'This payer has no agreement on file, so there is no tariff to claim against.' }], warnings };

  if (claim.basis === 'Interim estimate') {
    refusals.push({
      code: 'not-discharged',
      message: 'This is an interim estimate for a patient still in a bed. It is what the pre-authorisation is decided on; the claim itself is filed against the discharge bill, because a claim is a bill and an estimate is not.',
    });
  }
  if (claim.claimed > agreement.preAuthAbove && !claim.preAuth) {
    refusals.push({
      code: 'pre-auth',
      message: `Above ${financeMoney(agreement.preAuthAbove)} this payer requires pre-authorisation, and it is bought before the service rather than after. A claim without the number comes back as “no pre-authorisation”, which is the hospital’s loss.`,
    });
  }
  const missing = agreement.documents.filter((doc) => !claim.documents.includes(doc));
  // The documents are gathered for filing. An interim estimate has no discharge summary yet, so demanding one
  // now would give two refusals for one fact; `not-discharged` already says what has to happen.
  if (missing.length > 0 && claim.basis !== 'Interim estimate') {
    refusals.push({
      code: 'documents',
      message: `A ${agreement.kind.toLowerCase()} claim needs ${agreement.documents.length} documents; ${missing.length} ${missing.length === 1 ? 'is' : 'are'} missing: ${missing.join(', ')}. A missing document is not a delay, it is a rejection waiting to happen.`,
    });
  }
  if (claim.status !== 'Draft' && claim.status !== 'Pre-auth approved') {
    refusals.push({ code: 'already-submitted', message: `This claim is already ${claim.status.toLowerCase()}. A second claim against one invoice is a duplicate, and payers find those.` });
  }
  const other = existing.find((c) => c.invoiceNo === claim.invoiceNo && c.payer === claim.payer && c.claimNo !== claim.claimNo);
  if (other) refusals.push({ code: 'duplicate-invoice', message: `${claim.invoiceNo} is already claimed on ${other.claimNo}. One invoice, one claim, per payer.` });

  if (agreement.kind === 'Government scheme') warnings.push('A government scheme pays at its own tariff and in its own time: ninety days is normal, not a delay to chase.');
  if (agreement.coPayPct > 0) warnings.push(`The patient pays ${agreement.coPayPct} % of the allowed amount as co-payment, collected at the counter rather than deducted from the claim.`);
  if (agreement.tpa) warnings.push(`This claim goes to ${agreement.tpa}, who decides; the insurer pays. Both names belong on the file.`);
  return { ok: refusals.length === 0, refusals, warnings };
}

/** Record what the payer answered. Nothing here is ever edited afterwards: the claim carries its own history. */
export function settleClaim(
  claim: Claim,
  opts: { allowed: number; code?: string | null; rejection?: string | null; absorbedBy?: string | null; at: string },
): RemittanceLine {
  const agreement = payerAgreement(claim.payer)!;

  if (opts.rejection) {
    return {
      status: 'Rejected',
      allowed: 0,
      disallowed: claim.claimed,
      toPatient: 0,
      absorbed: opts.absorbedBy ? claim.claimed : 0,
      absorbedBy: opts.absorbedBy ?? null,
      shortPayCode: null,
      rejectionReason: opts.rejection,
      because: `Rejected outright: ${opts.rejection.toLowerCase()}. ${
        opts.absorbedBy
          ? `${financeMoney(claim.claimed)} is written off with ${opts.absorbedBy} named on the write-off.`
          : `${financeMoney(claim.claimed)} is unassigned, so the claim stays open: a rejection is closed by somebody accepting it, never by falling off a list.`
      }`,
    };
  }

  const allowed = Math.max(0, Math.min(opts.allowed, claim.claimed));
  const disallowed = claim.claimed - allowed;
  const code = opts.code ?? (disallowed > 0 ? 'tariff' : 'co-pay');
  const rule = SHORT_PAY_REASONS.find((r) => r.code === code);
  const coPay = Math.round((allowed * agreement.coPayPct) / 100);
  const toPatient = (rule?.who === 'Patient' ? disallowed : 0) + coPay;
  const absorbed = rule?.who === 'Patient' || rule?.who === 'Payer rework' ? 0 : disallowed;
  const settledAmount = allowed - coPay;
  const status: ClaimStatus = absorbed > 0 && !opts.absorbedBy ? 'Partially settled' : allowed === claim.claimed ? (toPatient > 0 ? 'Partially settled' : 'Settled') : 'Partially settled';

  return {
    status,
    allowed,
    disallowed,
    toPatient,
    absorbed,
    absorbedBy: absorbed > 0 ? opts.absorbedBy ?? null : null,
    shortPayCode: code,
    rejectionReason: null,
    because:
      disallowed === 0
        ? coPay > 0
          ? `Allowed in full; ${financeMoney(coPay)} of it is the patient’s co-payment, so the payer settles ${financeMoney(settledAmount)} and the patient account carries the rest.`
          : 'Allowed in full and settled — the payer kept the promise the agreement records.'
        : rule
          ? `${financeMoney(disallowed)} was not allowed: ${rule.label.toLowerCase()}. ${rule.because}${
              absorbed > 0 && !opts.absorbedBy ? ' Nobody has been named as carrying it yet, so the claim stays open.' : ''
            }`
          : `${financeMoney(disallowed)} was not allowed and no reason code was recorded. A short payment with no reason is money that leaves without a lesson.`,
  };
}

/** Ageing buckets. The first one is the payer's own promise, not a round thirty days. */
export const AGEING_BUCKETS = ['Within terms', '1–30 over', '31–60 over', '61–90 over', 'Over 90'] as const;

export function ageingBucket(overdueDays: number): (typeof AGEING_BUCKETS)[number] {
  if (overdueDays <= 0) return 'Within terms';
  if (overdueDays <= 30) return '1–30 over';
  if (overdueDays <= 60) return '31–60 over';
  if (overdueDays <= 90) return '61–90 over';
  return 'Over 90';
}

/**
 * The claim register: every payer bill the hospital's modules raised in the window, aged against the agreement,
 * plus an interim estimate for the inpatients whose pre-authorisation is still being decided.
 *
 * It is built from the bills the other screens already hold — `openBills` for the modules and the day's own payer
 * invoices — so the register cannot invent a claim for a bill that does not exist, and a claim's value is the
 * payer's share of a real document rather than a number typed here.
 */
export function generateClaims(day: string, today = day): Claim[] {
  const rand = rng(day.split('-').reduce((s, part) => s * 41 + Number(part), 3));
  const claims: Claim[] = [];
  let seq = 0;

  /* ---------------------------------------------------------------- claims against raised bills */
  for (let back = CLAIM_REGISTER_DAYS; back >= 0; back -= 1) {
    const theDay = shiftDay(day, -back);
    const bills = [
      ...openBills(theDay)
        // A bill with no patient on it cannot be claimed: there would be nobody to chase and nothing to attach
        // the payer's answer to, so it is left where it is rather than turned into a claim that cannot be worked.
        .filter((b) => b.payer !== 'Self pay' && b.state !== 'Cancelled' && b.mrn.startsWith('SH-'))
        .map((b) => ({ invoiceNo: b.invoiceNo, mrn: b.mrn, patientName: b.patientName, payer: b.payer, payerShare: b.payerShare, at: b.at.slice(0, 10), what: `${b.module} bill` })),
      ...generateInvoices(theDay)
        .filter((i) => i.payer !== 'Self pay' && i.status !== 'Cancelled')
        .map((i) => ({ invoiceNo: i.number, mrn: i.mrn, patientName: i.patientName, payer: i.payer, payerShare: totals(i).payerShare, at: i.createdAt.slice(0, 10), what: 'Out-patient bill' })),
    ];

    bills.forEach((bill, k) => {
      const agreement = payerAgreement(bill.payer);
      if (!agreement || bill.payerShare <= 0) return;
      const index = seq + k;
      const claimed = Math.round(bill.payerShare * (1 - agreement.discountPct / 100));
      const late = index % CLAIM_LATE_FILING_EVERY === 0;
      const filedOn = shiftDay(bill.at, late ? CLAIM_LATE_FILING_DAYS : CLAIM_FILING_DELAY_DAYS);
      const filed = filedOn <= today;
      const ageDays = filed ? daysBetween(filedOn, today) : 0;
      const missingDocs = index % 4 === 1 ? agreement.documents.slice(-1) : [];
      const needsPreAuth = claimed > agreement.preAuthAbove;

      // A claim that has not been filed yet is a draft: the desk still owes the payer a document or a decision.
      let status: ClaimStatus = filed ? 'Submitted' : 'Draft';
      let preAuth: string | null = needsPreAuth ? (index % 3 === 0 ? `PA-${bill.at.slice(2, 4)}${bill.at.slice(5, 7)}-${String(4_100 + index)}` : null) : null;
      if (filed && needsPreAuth && !preAuth) status = 'Pre-auth requested';
      else if (filed && missingDocs.length > 0 && ageDays <= 20) status = 'Query raised';
      else if (filed && ageDays > 20) status = index % 11 === 0 ? 'Rejected' : index % 3 === 0 ? 'Settled' : index % 3 === 1 ? 'Partially settled' : 'Submitted';

      claims.push(buildClaim({
        index, seq: seq + k, claimNo: `CL-${day.replace(/-/g, '').slice(2)}-${String(1_100 + index)}`,
        invoiceNo: bill.invoiceNo, mrn: bill.mrn, patientName: bill.patientName, payer: bill.payer,
        agreement, claimed, status, preAuth, basis: 'Final bill', raisedAt: bill.at, filedOn: filed ? filedOn : null,
        ageDays, documents: agreement.documents.filter((d) => !missingDocs.includes(d)),
        notes: [
          `${bill.what} raised on ${bill.at}${late ? `, filed ${CLAIM_LATE_FILING_DAYS} days later because a document was missing — the payer’s clock started when the paper arrived, not when the service was given.` : ''}`,
          missingDocs.length > 0 ? `Waiting on ${missingDocs.join(', ')} — a query is answered with a document, not a phone call.` : '',
        ].filter(Boolean),
        rand,
      }));
    });
    seq += bills.length;
  }

  /* ---------------------------------------------------------------- interim estimates for inpatients */
  const inpatients = generateInpatient(day).admissions
    .filter((a) => a.patient.payer !== 'Self pay' && payerAgreement(a.patient.payer as Payer))
    .map((a) => {
      const payer = a.patient.payer as Payer;
      const agreement = payerAgreement(payer)!;
      const bedDays = a.expectedStayDays;
      const estimate = bedDays * BED_CHARGE[a.class] + (WARD_PROCEDURE_ESTIMATE[a.wardId] ?? 0);
      const claimed = Math.round(estimate * payerCoverage[payer] * (1 - agreement.discountPct / 100));
      return { admission: a, payer, agreement, estimate, claimed, above: claimed > agreement.preAuthAbove };
    })
    .sort((x, y) => y.claimed - x.claimed);

  // The desk watches the ones that need a decision: everything above its payer's threshold, plus the largest
  // below it, which is the claim that will be filed on discharge without anybody having to look at it twice.
  const watchlist = [...inpatients.filter((r) => r.above).slice(0, 4), ...inpatients.filter((r) => !r.above).slice(0, 1)];

  watchlist.forEach((row, k) => {
    const index = seq + k;
    const above = row.above;
    claims.push(buildClaim({
      index, seq, claimNo: `CL-${day.replace(/-/g, '').slice(2)}-${String(2_300 + k)}`,
      invoiceNo: `EST-${row.admission.bedId.toUpperCase()}-${day.replace(/-/g, '').slice(2)}`,
      mrn: row.admission.mrn, patientName: row.admission.patient.name, payer: row.payer, agreement: row.agreement,
      claimed: row.claimed,
      status: above ? (k % 2 === 0 ? 'Pre-auth requested' : 'Pre-auth approved') : 'Pre-auth approved',
      preAuth: above && k % 2 === 1 ? `PA-${day.slice(2, 4)}${day.slice(5, 7)}-${String(6_100 + k)}` : null,
      basis: 'Interim estimate', raisedAt: row.admission.admittedAt.slice(0, 10), filedOn: null, ageDays: 0,
      documents: row.agreement.documents.filter((d) => d !== 'Discharge summary'),
      notes: [
        `Interim estimate for ${row.admission.patient.name}, ${row.admission.bedId} (${row.admission.class}, ${row.admission.expectedStayDays} bed-days expected, ${row.admission.diagnosis?.label ?? 'diagnosis on the chart'}): ${financeMoney(row.estimate)} of stay value, ${financeMoney(row.claimed)} of it the payer's after the agreed discount.`,
        above
          ? `Above ${financeMoney(row.agreement.preAuthAbove)}, so the pre-authorisation is what is decided now: ${financeMoney(row.claimed)} sits with ${row.agreement.tpa ?? row.payer} until a number comes back, and the claim is filed against the discharge bill.`
          : `Inside ${financeMoney(row.agreement.preAuthAbove)}, so no pre-authorisation is needed; the claim files itself on discharge against the final bill.`,
        'The final claim is filed against the discharge bill. Until then the payer owes nothing, and the ward board, not this register, is what tells you where the patient is.',
      ],
      rand,
    }));
  });

  void rand;
  return claims.sort((a, b) => (a.raisedAt === b.raisedAt ? b.claimNo.localeCompare(a.claimNo) : b.raisedAt.localeCompare(a.raisedAt)));
}

interface BuildArgs {
  index: number;
  seq: number;
  claimNo: string;
  invoiceNo: string;
  mrn: string;
  patientName: string;
  payer: Payer;
  agreement: PayerAgreement;
  claimed: number;
  status: ClaimStatus;
  preAuth: string | null;
  basis: ClaimBasis;
  raisedAt: string;
  filedOn: string | null;
  ageDays: number;
  documents: string[];
  notes: string[];
  rand: () => number;
}

/** One place where a register line is assembled, so a settled claim and an open one cannot drift apart. */
function buildClaim(a: BuildArgs): Claim {
  const answered = a.status === 'Settled' || a.status === 'Partially settled' || a.status === 'Rejected';
  const shortPay = a.status === 'Partially settled';
  const rejected = a.status === 'Rejected';
  const allowed = a.status === 'Settled' ? a.claimed : shortPay ? Math.round(a.claimed * 0.82) : 0;
  const disallowed = answered ? a.claimed - allowed : 0;
  const code = shortPay ? (a.index % 2 === 0 ? 'not-covered' : 'tariff') : a.status === 'Settled' ? 'co-pay' : null;
  const rule = code ? SHORT_PAY_REASONS.find((r) => r.code === code) : undefined;
  const coPay = Math.round((allowed * a.agreement.coPayPct) / 100);
  const toPatient = answered ? (rule?.who === 'Patient' ? disallowed : 0) + coPay : 0;
  const absorbed = rejected ? a.claimed : answered ? (rule && rule.who !== 'Patient' && rule.who !== 'Payer rework' ? disallowed : 0) : 0;
  const absorbedBy = absorbed > 0 && a.index % 2 === 0 ? 'Clinical director — necessity documented' : null;

  return {
    id: `CLM-${5_200 + a.index}`,
    claimNo: a.claimNo,
    invoiceNo: a.invoiceNo,
    mrn: a.mrn,
    patientName: a.patientName,
    payer: a.payer,
    tpa: a.agreement.tpa,
    basis: a.basis,
    claimed: a.claimed,
    allowed,
    disallowed,
    toPatient,
    absorbed,
    absorbedBy,
    status: a.status,
    shortPayCode: rejected ? null : code,
    rejectionReason: rejected ? REJECTION_REASONS[a.index % REJECTION_REASONS.length] : null,
    preAuth: a.preAuth,
    raisedAt: a.raisedAt,
    submittedAt: a.filedOn ? atMinute(a.filedOn, 9 * 60 + (a.index % 8) * 25) : null,
    respondedAt: answered ? atMinute(shiftDay(a.filedOn ?? a.raisedAt, 9 + (a.index % 12)), 15 * 60 + (a.index % 6) * 10) : null,
    settledAmount: answered ? Math.max(0, allowed - coPay) : 0,
    settledAt: a.status === 'Settled' ? atMinute(shiftDay(a.filedOn ?? a.raisedAt, 12 + (a.index % 20)), 16 * 60 + (a.index % 5) * 5) : null,
    documents: a.documents,
    ageDays: a.ageDays,
    overdueDays: a.filedOn ? Math.max(0, a.ageDays - a.agreement.settlementDays) : 0,
    notes: [
      ...a.notes,
      ...(absorbed > 0
        ? [absorbedBy
          ? `${financeMoney(absorbed)} was short-paid and absorbed by the hospital, signed ${absorbedBy}: the treatment was clinically necessary and documented, so it is written off with a name against it.`
          : `${financeMoney(absorbed)} was short-paid and nobody has been named as carrying it, so the claim stays open: a write-off is closed by somebody accepting it, never by falling off a list.`]
        : []),
      ...(rejected ? [`Rejected outright: ${REJECTION_REASONS[a.index % REJECTION_REASONS.length].toLowerCase()}. The hospital carries the whole ${financeMoney(a.claimed)} unless it is reworked and refiled inside the payer's window.`] : []),
    ],
  };
}

export interface ClaimsSnapshot {
  claims: Claim[];
  /** Claims against an estimate rather than a raised bill: the pre-authorisation decisions a desk works. */
  interim: Claim[];
  totals: { claimed: number; allowed: number; settled: number; outstanding: number; shortPaid: number; unassigned: number; patient: number };
  byStatus: Array<{ status: ClaimStatus; count: number; amount: number }>;
  ageing: Array<{ bucket: (typeof AGEING_BUCKETS)[number]; count: number; amount: number; because: string }>;
  overdue: Claim[];
  reasons: Array<{ code: string; label: string; count: number; amount: number; who: string }>;
  missingDocuments: Claim[];
}

export function claimsSnapshot(claims: Claim[]): ClaimsSnapshot {
  const open = claims.filter((c) => CLAIM_OPEN.includes(c.status));
  const claimed = sum(claims, (c) => c.claimed);
  const byStatus = CLAIM_STATUSES.map((status) => {
    const rows = claims.filter((c) => c.status === status);
    return { status, count: rows.length, amount: sum(rows, (c) => c.claimed) };
  }).filter((row) => row.count > 0);

  const ageing = AGEING_BUCKETS.map((bucket) => {
    const rows = claims.filter((c) => ageingBucket(c.overdueDays) === bucket);
    const because =
      bucket === 'Within terms'
        ? 'Inside the payer’s own settlement period. Nothing to chase yet, and chasing early costs goodwill.'
        : bucket === 'Over 90'
          ? 'Past ninety days: escalate in writing to the payer and the TPA, with the claim number and the submission date on the letter.'
          : 'Past the promised period. A call with the claim number moves these; a statement of account moves very little.';
    return { bucket, count: rows.length, amount: sum(rows, (c) => c.claimed), because };
  }).filter((row) => row.count > 0);

  const reasons = SHORT_PAY_REASONS.map((rule) => {
    const rows = claims.filter((c) => c.shortPayCode === rule.code);
    // A reason with no money against it is noise: a settled claim whose only difference is the patient's
    // co-payment is not a short payment, and a list that says it was teaches the desk to ignore the list.
    return { code: rule.code, label: rule.label, count: rows.filter((c) => c.disallowed > 0).length, amount: sum(rows, (c) => c.disallowed), who: rule.who };
  }).filter((row) => row.amount > 0).sort((a, b) => b.amount - a.amount);

  return {
    claims,
    interim: claims.filter((c) => c.basis === 'Interim estimate'),
    totals: {
      claimed,
      allowed: sum(claims, (c) => c.allowed),
      settled: sum(claims, (c) => c.settledAmount),
      outstanding: sum(open, (c) => c.claimed),
      shortPaid: sum(claims, (c) => c.disallowed),
      unassigned: sum(claims.filter((c) => c.disallowed > 0 && c.absorbed > 0 && !c.absorbedBy), (c) => c.absorbed),
      patient: sum(claims, (c) => c.toPatient),
    },
    byStatus,
    ageing,
    overdue: claims.filter((c) => c.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays),
    reasons,
    missingDocuments: claims.filter((c) => c.notes.some((n) => /Waiting on/.test(n))),
  };
}

/** The claim the user is working on, from the register. */
export const claimByNo = (claims: Claim[], claimNo: string): Claim | undefined => claims.find((c) => c.claimNo === claimNo);

/**
 * What the register is and what it is not. The branch's synthetic history is forty-five days deep, so the two
 * oldest ageing buckets are empty here: the screen says which buckets are empty and why rather than inventing a
 * ninety-day-old claim to make a chart look busy.
 */
export const CLAIM_REGISTER_NOTE =
  `Built from the payer bills the modules raised in the last ${CLAIM_REGISTER_DAYS} days and the interim estimates for the inpatients whose pre-authorisation is still open. An older claim would stay in the register until it is closed; the branch has no payer bill older than that, so the two oldest ageing buckets are empty here.`;

export const CLAIM_NEEDS_AGREEMENT = 'A claim with no agreement behind it is a guess at a tariff, and the guess is always the hospital’s. Setup › Finance holds the payer agreements.';

/* ================================================================================== referral commission
 *
 * A referral commission is a payment for a clinical decision, so the register is where it belongs: who may be
 * paid, on which heads, at what rate, under which agreement. Five rules keep it from becoming a bribe with an
 * invoice:
 *
 *  1. **Collected, not billed.** Commission is computed on money the hospital actually has. Billed value is a
 *     promise, and paying a share of a promise is how a commission run loses money.
 *  2. **Not on pharmacy, not on anything the agreement does not name.** A rate that applies to drug sales pays a
 *     doctor to prescribe. The heads are part of the agreement, not a footnote to it.
 *  3. **A hold, so refunds net off.** Commission becomes payable a fortnight after collection, not the same day.
 *  4. **Withholding leaves with the payment**, like every other payment to a professional.
 *  5. **The consultant’s share and the referral commission are never both.** A referrer who is also the treating
 *     consultant gets the share; the commission register refuses the double dip by name.
 */



/** Withholding on commission, like any other professional payment. */
export const COMMISSION_TDS_PCT = 5;
/** Commission becomes payable this many days after collection, so a refund can net off first. */
export const COMMISSION_HOLD_DAYS = 14;
/** Heads a commission may never be paid on, whoever the agreement names. */
export const COMMISSION_BLOCKED_HEADS = ['INC-PHARM', 'INC-OTHER', 'INC-DONATION'];

/**
 * Why a head can never be commissioned, in the register's own words. The same three heads the Setup › Finance
 * screen prints under “Heads no agreement may ever name”, because the register and the screen have to agree on why
 * a line earns nothing — a reason only one of them knows is a reason somebody will argue with.
 */
const blockedBecause = (head: string): string =>
  head === 'INC-PHARM'
    ? 'paying a share of drug sales pays a prescriber to prescribe'
    : head === 'INC-DONATION'
      ? 'a donation is somebody else’s generosity, not the patient’s spending to share'
      : 'sundry counter income is not attributable to a referrer';

/** The head a module's own counter collects against. Module bills carry no per-category lines, so the mapping is
 * by hand — and it is by hand everywhere else in this product too, because a pharmacy receipt is a pharmacy
 * receipt whichever screen raised it. */
export const MODULE_INCOME_HEAD: Record<string, string> = {
  Pathology: 'INC-DIAG',
  Radiology: 'INC-DIAG',
  'Blood issue': 'INC-BB',
  'Blood components': 'INC-BB',
  IPD: 'INC-IPD',
  Ambulance: 'INC-AMB',
  Pharmacy: 'INC-PHARM',
  OPD: 'INC-OPD',
};

export interface Accrual {
  id: string;
  referrerCode: string;
  referrerName: string;
  invoiceNo: string;
  mrn: string;
  patientName: string;
  headCode: string;
  /** What the invoice collected, which is what the commission is a share of. */
  collected: number;
  /** The share of the collected amount this head carries. */
  base: number;
  rate: number;
  commission: number;
  collectedAt: string;
  /** The day it becomes payable: collection + the hold. */
  payableFrom: string;
  status: 'Held' | 'Payable' | 'Excluded' | 'Paid';
  /** Why it is not payable, when it is not. */
  exclusion: string | null;
}

/**
 * The accruals for a window, computed per invoice from money collected and per head, so a rate that must not
 * touch pharmacy simply never accrues on it — rather than accruing and being removed later, which is how a
 * commission run and its register drift apart.
 *
 * The window is wider than the hold on purpose: a run pays what has become payable and shows what is still held,
 * so a referrer whose statement looks short is owed the reason rather than an argument.
 */
export function referralAccruals(day: string, days = 30): Accrual[] {
  const accr: Accrual[] = [];
  for (let back = 0; back < days; back += 1) {
    const theDay = shiftDay(day, -back);

    /* What was collected, per head, from both registers: the counter bills the billing desk raised, and the
     * module bills the pathology, radiology, blood bank, ward, ambulance and pharmacy counters raised. A
     * commission that only saw one of the two would pay a referrer for a radiology study and not for the
     * pharmacy the same patient bought on the way out — and half a register is worse than none, because it
     * looks complete. */
    const collections: Array<{ billNo: string; mrn: string; patientName: string; headCode: string; base: number; at: string }> = [];
    for (const invoice of generateInvoices(theDay)) {
      if (invoice.status === 'Cancelled' || invoice.payments.length === 0) continue;
      const t = totals(invoice);
      for (const head of INCOME_HEADS) {
        const headValue = invoice.lines.filter((l) => headCollects(head, l.category)).reduce((n, l) => n + lineNet(l), 0);
        if (headValue <= 0) continue;
        const share = Math.round((t.paid * headValue) / Math.max(1, t.net));
        if (share <= 0) continue;
        collections.push({ billNo: invoice.number, mrn: invoice.mrn, patientName: invoice.patientName, headCode: head.code, base: share, at: invoice.payments[0]?.at ?? atMinute(theDay, 10 * 60) });
      }
    }
    for (const bill of openBills(theDay)) {
      const headCode = MODULE_INCOME_HEAD[bill.module];
      if (!headCode || bill.state === 'Cancelled' || bill.collected <= 0 || !bill.mrn.startsWith('SH-')) continue;
      collections.push({ billNo: bill.invoiceNo, mrn: bill.mrn, patientName: bill.patientName, headCode, base: bill.collected, at: bill.at });
    }
    // The pharmacy counter's own register: a dispensed prescription to a self-paying patient is money collected,
    // and it is the line that keeps the “never commissioned” rule from being a sentence in a document.
    for (const dispense of generateDispenses(theDay)) {
      if (dispense.status !== 'Dispensed' || dispense.patient.payer !== 'Self pay' || dispense.total <= 0) continue;
      collections.push({
        billNo: dispense.rxNumber,
        mrn: dispense.patient.mrn,
        patientName: dispense.patient.name,
        headCode: 'INC-PHARM',
        base: dispense.total,
        at: dispense.dispensedAt ?? atMinute(theDay, 12 * 60),
      });
    }

    for (const collection of collections) {
      const head = incomeHeadByCode(collection.headCode);
      if (!head || collection.base <= 0) continue;

      // In production the referrer is a field on the registration; here it is assigned from the MRN so the same
      // patient is always referred by the same desk, and the register is stable across a reload.
      const referrer = REFERRERS[Number(collection.mrn.replace(/\D/g, '')) % REFERRERS.length];
      const blocked = COMMISSION_BLOCKED_HEADS.includes(head.code);
      const notAgreed = !referrer.heads.includes(head.code);
      const inHouse = referrer.kind === 'In-house consultant';
      const rate = notAgreed ? 0 : referrer.commissionPct / 100;
      const payableFrom = shiftDay(collection.at.slice(0, 10), COMMISSION_HOLD_DAYS);
      // Order matters, and it is the order of what can be fixed. A head that may never be commissioned outranks a
      // lapsed agreement: renewing the agreement would not pay that line, so telling the desk to renew it would be
      // advice that leads nowhere. Expiry still outranks the head list, because a lapsed agreement pays nothing at
      // all — every line of it is excluded, not only the ones the agreement never named.
      const exclusion = blocked
        ? `${head.label} is never commissioned: ${blockedBecause(head.code)}.`
        : !commissionable(referrer, day)
          ? `The agreement expired on ${referrer.agreementTo}. A rate nobody has renewed is not a rate: Setup › Referral renews it, or the register stops paying on the date it ended.`
          : inHouse
            ? 'An in-house consultant earns the consultant share, not a referral commission — one consultation, one payout.'
            : notAgreed
              ? `${head.label} is not in this agreement, and a rate applies to the heads it names, not to everything the patient spends.`
              : null;

      accr.push({
        id: `${collection.billNo}-${head.code}`,
        referrerCode: referrer.code,
        referrerName: referrer.name,
        invoiceNo: collection.billNo,
        mrn: collection.mrn,
        patientName: collection.patientName,
        headCode: head.code,
        collected: collection.base,
        base: collection.base,
        rate,
        commission: exclusion ? 0 : Math.round(collection.base * rate),
        collectedAt: collection.at,
        payableFrom,
        status: exclusion ? 'Excluded' : payableFrom <= day ? 'Payable' : 'Held',
        exclusion,
      });
    }
  }
  return accr;
}

export interface PayoutLine {
  referrerCode: string;
  referrerName: string;
  kind: ReferrerKind;
  tin: string | null;
  accrued: number;
  held: number;
  payable: number;
  tds: number;
  net: number;
  lines: number;
  statement: string;
}

export interface PayoutRun {
  to: string;
  lines: PayoutLine[];
  totalPayable: number;
  totalTds: number;
  totalNet: number;
  excluded: number;
  because: string;
}

/**
 * What may be paid today. Held accruals are counted and shown rather than hidden: a referrer asking why the
 * statement is short deserves the reason, and the reason is usually that the money has not been collected long
 * enough for a refund to be impossible.
 */
export function payoutRun(accruals: Accrual[], to: string): PayoutRun {
  const rows = REFERRERS.map((referrer) => {
    const mine = accruals.filter((a) => a.referrerCode === referrer.code);
    const accrued = sum(mine.filter((a) => a.status !== 'Excluded'), (a) => a.commission);
    const payable = sum(mine.filter((a) => a.status === 'Payable'), (a) => a.commission);
    const held = accrued - payable;
    const tds = Math.round((payable * COMMISSION_TDS_PCT) / 100);
    return {
      referrerCode: referrer.code,
      referrerName: referrer.name,
      kind: referrer.kind,
      tin: referrer.tin,
      accrued,
      held,
      payable,
      tds,
      net: payable - tds,
      lines: mine.filter((a) => a.status !== 'Excluded').length,
      statement: referrer.tin
        ? `${referrer.commissionPct} % on ${referrer.heads.length} head(s) — ${referrer.heads.join(', ')}`
        : 'No TIN on file: a commission paid without one attracts the higher deduction, so get the number first.',
    };
  }).filter((row) => row.accrued > 0 || row.payable > 0);

  const excluded = sum(accruals.filter((a) => a.status === 'Excluded'), (a) => a.base);
  return {
    to,
    lines: rows,
    totalPayable: sum(rows, (r) => r.payable),
    totalTds: sum(rows, (r) => r.tds),
    totalNet: sum(rows, (r) => r.net),
    excluded,
    because: `Paid on money collected at least ${COMMISSION_HOLD_DAYS} days ago, so a refund can still net off; withholding at ${COMMISSION_TDS_PCT} % leaves with the payment. ${financeMoney(excluded)} of billed value was excluded, and every exclusion names its reason.`,
  };
}

/** The referrer a payout is being prepared for, with their accruals. */
export const accrualsFor = (accruals: Accrual[], code: string): Accrual[] => accruals.filter((a) => a.referrerCode === code);

export const referralRegisterNote =
  'A commission register is not a marketing list: it says who may be paid, on which heads, at what rate, and under which written agreement — and the agreement expires.';
