/* -------------------------------------------------------------------------------------------------
 * The ledger's standing tables: the income and expense heads every rupee is filed under, what each payer has
 * agreed to, and who may be paid a referral commission.
 *
 * They live here rather than in `finance.ts` for one reason: `masters.ts` serves both lists on Setup, and
 * `module-billing.ts` serves the bills the claim register is built from. Keeping the lists in a leaf module means
 * the setup catalogue, the ledger and the claim register all read the same tables without an import cycle —
 * two copies of a head list would drift within a month, and the reconciliation would drift with them.
 * ------------------------------------------------------------------------------------------------- */

import { type Category, type Payer } from './billing';

/* ------------------------------------------------------------------ heads */

export type IncomeGroup = 'Operating' | 'Non-operating';

export interface IncomeHead {
  code: string;
  label: string;
  group: IncomeGroup;
  /**
   * The billing categories this head collects — the link that makes the reconciliation possible. A list rather
   * than one category because the tariff splits what a head does not: laboratory and imaging are two categories
   * on a bill and one line of business, and a head that could collect only one of them would push the other into
   * “other operating income” for ever. An empty list is counter income no bill knows about.
   */
  categories: Category[];
  note: string;
}

/** Whether this head collects a billing category. The reconciliation asks this, one line at a time.
 *  Takes anything carrying a category list, so a setup screen can ask the same question of an unsaved draft. */
export const headCollects = (head: { categories: Category[] }, category: Category): boolean => head.categories.includes(category);

export const INCOME_HEADS: IncomeHead[] = [
  { code: 'INC-OPD', label: 'Outpatient consultation', group: 'Operating', categories: ['Consultation'], note: 'Counter receipts for OPD and emergency consultations.' },
  { code: 'INC-IPD', label: 'Inpatient — bed and nursing', group: 'Operating', categories: ['Bed'], note: 'Interim bills and deposits against an admission.' },
  { code: 'INC-DIAG', label: 'Diagnostics — laboratory', group: 'Operating', categories: ['Pathology'], note: 'Samples and studies are collected before the report; the head follows the order, not the result.' },
  { code: 'INC-PHARM', label: 'Pharmacy sales', group: 'Operating', categories: ['Pharmacy'], note: 'Retail counter. Ward issues are billed through the inpatient head instead.' },
  { code: 'INC-PROC', label: 'Procedures and theatre', group: 'Operating', categories: ['Procedure'], note: 'Dressings, ECG, day procedures and theatre charges.' },
  { code: 'INC-BB', label: 'Blood bank', group: 'Operating', categories: ['Procedure'], note: 'Components and cross-match. The service charge only — donations are not income. The tariff files blood under the procedure category, so this head and Procedures and theatre both claim it and the reconciliation credits the first.' },
  { code: 'INC-AMB', label: 'Ambulance', group: 'Operating', categories: ['Ambulance'], note: 'Trip charges. A call that never left the gate is not billed.' },
  { code: 'INC-OTHER', label: 'Other operating income', group: 'Operating', categories: [], note: 'Canteen rent, medical reports, certificates — collected at the counter but not billed to a patient account.' },
  { code: 'INC-DONATION', label: 'Donations and grants', group: 'Non-operating', categories: [], note: 'Kept out of operating income on purpose: it must never pay for a month of salaries.' },
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

/* ------------------------------------------------------------------ what each payer has agreed to */

export type PayerKind = 'Insurer' | 'Corporate' | 'Government scheme';

export interface PayerAgreement {
  payer: Payer;
  kind: PayerKind;
  /** The administrator the claim actually goes to, when the payer uses one. */
  tpa: string | null;
  /** Days the payer promises to settle in — the clock ageing is measured against. */
  settlementDays: number;
  /** The discount the hospital agreed for this payer's tariff, as a share of billed payer value. */
  discountPct: number;
  /** Above this amount the service needs pre-authorisation. */
  preAuthAbove: number;
  coPayPct: number;
  /** What a claim has to carry. A missing document is not a delay, it is a rejection waiting to happen. */
  documents: string[];
  because: string;
}

export const PAYER_AGREEMENTS: PayerAgreement[] = [
  {
    payer: 'Insurance — MetLife',
    kind: 'Insurer',
    tpa: 'MediAssist Bangladesh',
    settlementDays: 30,
    discountPct: 10,
    preAuthAbove: 15_000,
    coPayPct: 20,
    documents: ['Pre-authorisation letter', 'Itemised bill', 'Discharge summary', 'Investigation reports', 'Prescription copies'],
    because: 'A private insurer with a TPA in the middle: the TPA decides and the insurer pays, and the claim is judged on paperwork before it is judged on treatment.',
  },
  {
    payer: 'Corporate — BRAC',
    kind: 'Corporate',
    tpa: null,
    settlementDays: 30,
    discountPct: 15,
    preAuthAbove: 25_000,
    coPayPct: 10,
    documents: ['Employee authorisation', 'Itemised bill', 'Prescription copies'],
    because: 'A corporate account is a credit customer with a contract: the discount is the price of the volume, and the employee’s authorisation is what separates a covered visit from a personal one.',
  },
  {
    payer: 'Govt. scheme',
    kind: 'Government scheme',
    tpa: null,
    settlementDays: 90,
    discountPct: 0,
    preAuthAbove: 5_000,
    coPayPct: 0,
    documents: ['Scheme eligibility card', 'Itemised bill', 'Scheme authorisation', 'Discharge summary'],
    because: 'A government scheme pays in its own time and at its own tariff, so the discount is not the hospital’s to give and the eligibility card is checked before the service, not after.',
  },
];

export const payerAgreement = (payer: Payer): PayerAgreement | undefined => PAYER_AGREEMENTS.find((a) => a.payer === payer);

/* ------------------------------------------------------------------ who may be paid a referral commission */

export type ReferrerKind = 'External doctor' | 'Clinic or agent' | 'In-house consultant' | 'Corporate partner';

export interface Referrer {
  id: string;
  code: string;
  name: string;
  kind: ReferrerKind;
  phone: string;
  /** Taxpayer identification number: a commission with no TIN cannot be paid without a higher deduction. */
  tin: string | null;
  /** The heads this referrer may be paid on. Empty is a mistake, not a wildcard. */
  heads: string[];
  commissionPct: number;
  /** The written agreement behind the rate. No agreement, no payment. */
  agreementTo: string;
  because: string;
}

export const REFERRERS: Referrer[] = [
  {
    id: 'ref-1',
    code: 'REF-DRHAQ',
    name: 'Dr. Nazmul Haque — Uttara Chest Clinic',
    kind: 'External doctor',
    phone: '01711-334-455',
    tin: 'TIN-441-882-003',
    heads: ['INC-OPD', 'INC-DIAG', 'INC-IPD', 'INC-PROC'],
    commissionPct: 10,
    agreementTo: '2027-06-30',
    because: 'An external chest physician who sends patients for spirometry and admission. Consultations and diagnostics are the agreement.',
  },
  {
    id: 'ref-2',
    code: 'REF-NURJAHAN',
    name: 'Nurjahan Diagnostic & Consultation Centre',
    kind: 'Clinic or agent',
    phone: '01812-556-677',
    tin: 'TIN-455-119-774',
    heads: ['INC-DIAG', 'INC-PROC'],
    commissionPct: 12,
    agreementTo: '2026-09-30',
    because: 'A diagnostic centre with no imaging of its own. A flat rate on studies and procedures, and never on pharmacy.',
  },
  {
    id: 'ref-3',
    code: 'REF-PROFS',
    name: 'Dr. A. Rahman — internal medicine (in-house)',
    kind: 'In-house consultant',
    phone: '01913-778-899',
    tin: 'TIN-402-336-118',
    heads: ['INC-OPD', 'INC-IPD'],
    commissionPct: 0,
    agreementTo: '2027-12-31',
    because: 'An in-house consultant earns the consultant share of what they bill, not a referral commission — two payouts for one consultation is the double dip the register refuses.',
  },
  {
    id: 'ref-4',
    code: 'REF-GREENTECH',
    name: 'GreenTech Knitwear — corporate health desk',
    kind: 'Corporate partner',
    phone: '02-5566-7788',
    tin: 'TIN-390-771-559',
    heads: ['INC-OPD', 'INC-DIAG'],
    commissionPct: 5,
    agreementTo: '2027-09-30',
    because: 'A factory with a health desk that arranges pre-employment and periodic checks. Paid on the checks, not on anything a worker is treated for.',
  },
];

export const referrerByCode = (code: string): Referrer | undefined => REFERRERS.find((r) => r.code === code);

/* ------------------------------------------------------------------ the lifecycle of an agreement
 *
 * A commission rate is only a rate while the paper behind it is current. That is a date comparison, so it lives
 * here beside the table rather than in a reminder somebody is supposed to read: the register asks this function
 * whether a referrer may be paid on a given day, and the answer is no the day after the agreement runs out.
 */
export type AgreementState = 'Active' | 'Expiring soon' | 'Expired';

/** How far ahead the register starts saying an agreement is running out — two months to renew it or stop it. */
export const AGREEMENT_WARN_DAYS = 60;

export interface AgreementLife {
  state: AgreementState;
  daysToExpiry: number;
  because: string;
}

export function agreementLife(expiresOn: string, day: string): AgreementLife {
  const daysToExpiry = Math.round((new Date(`${expiresOn}T00:00:00`).getTime() - new Date(`${day}T00:00:00`).getTime()) / 86_400_000);
  if (daysToExpiry < 0) {
    return {
      state: 'Expired',
      daysToExpiry,
      because: `The agreement ran out on ${expiresOn}, ${Math.abs(daysToExpiry)} day${Math.abs(daysToExpiry) === 1 ? '' : 's'} ago. A rate nobody has renewed is not a rate, so nothing accrues from that date until it is signed again.`,
    };
  }
  if (daysToExpiry <= AGREEMENT_WARN_DAYS) {
    return {
      state: 'Expiring soon',
      daysToExpiry,
      because: `The agreement runs out on ${expiresOn} — ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'} left. Renew it or stop paying on the date it ends; the register will not carry a rate past this.`,
    };
  }
  return { state: 'Active', daysToExpiry, because: `Current to ${expiresOn}, ${daysToExpiry} days away.` };
}

/** Whether a referrer may be paid at all on this day. */
export const commissionable = (referrer: Referrer, day: string): boolean => agreementLife(referrer.agreementTo, day).state !== 'Expired';
