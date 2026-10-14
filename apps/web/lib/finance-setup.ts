/* -------------------------------------------------------------------------------------------------
 * The rules behind the two finance setup screens — Setup › Referral and Setup › Finance.
 *
 * A setup screen is where a hospital writes down a decision it will live with for a year, so the interesting
 * question is not "may I edit this row" but **what does this edit do to money that has already moved**. Both
 * halves of this module are that question:
 *
 *  - **A referral agreement is a commercial contract**, and the register pays against it. So the editor enforces
 *    what makes it enforceable: a taxpayer number before it may be Active, a registration number for somebody who
 *    is paid for a clinical decision, an end date (a perpetual rate is a rate nobody revisits), a ceiling above
 *    which the board has to be on the file, a hold that is at least as long as a patient's refund window, and
 *    withholding that is never below the law. A rate change makes a new dated version — it does not overwrite the
 *    rate the register has been paying against.
 *
 *  - **A head is what every rupee is filed under**, and two fields on it are load-bearing: the billing category an
 *    income head collects (the reconciliation reads this mapping and calls any gap "missing documents"), and the
 *    withholding and VAT rates on an expense head (a legal obligation with a date from which it applies). So the
 *    mapping is checked against the billing tariff itself and the gaps are named, and a rate change is dated rather
 *    than retroactive: re-pricing last month's expenses by editing a rate is how a tax return stops matching the
 *    vouchers behind it.
 *
 * The module holds no state. The screens hold the seeded records and hand a draft to `checkAgreement` /
 * `checkHead`, which is why the same verdict can be asserted in a harness without rendering anything.
 */

import { money, type Category, type Payer } from './billing';
import { CHARGE_CATEGORIES } from './masters';
import {
  APPROVAL_LADDER,
  CASH_PAYMENT_LIMIT,
  COMMISSION_BLOCKED_HEADS,
  COMMISSION_HOLD_DAYS,
  COMMISSION_TDS_PCT,
  EXPENSE_HEADS,
  INCOME_HEADS,
  REFERRERS,
  agreementLife,
  headCollects,
  incomeHeadByCode,
} from './finance';
import type { ExpenseHead, IncomeHead, Referrer, ReferrerKind } from './finance-tables';

/* ================================================================================== Setup › Referral
 *
 * The commission agreement. One record per referrer, with the paper behind it: who they are, what they may be paid
 * on, at what rate, from when to when, under which signed document, and who approved it.
 */

/** Above this rate the board has to be on the file. It is the same ceiling as the corporate discount, on purpose:
 * money given away at the front desk and money paid at the back both come out of the same margin. */
export const RATE_CEILING_PCT = 15;
/** An agreement may not run longer than this. A rate with no end date is a rate nobody revisits. */
export const AGREEMENT_MAX_YEARS = 3;
/** Below this a payout costs more to make than it pays — and a referrer who gets nothing asks why. */
export const MIN_PAYOUT_FLOOR = 500;

export type PayoutMethod = 'Bank transfer' | 'Cheque' | 'Cash';

export interface AgreementVersion {
  /** The day the change took effect. A rate is dated: the register paid against the old one until this day. */
  from: string;
  ratePct: number;
  heads: string[];
  by: string;
  what: string;
}

export interface ReferrerAgreement {
  id: string;
  /** The code every voucher, statement and register line carries. */
  code: string;
  name: string;
  kind: ReferrerKind;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  /** Taxpayer identification number. Required before the agreement may be Active. */
  tin: string | null;
  /** Business identification number, for a clinic or a company. */
  bin: string | null;
  /** A professional registration: a BMDC number for a doctor, a trade licence for an agency. */
  registration: string | null;
  agreementNo: string;
  signedOn: string;
  expiresOn: string;
  documentRef: string;
  /** The heads this agreement commissions. An empty list earns nothing, whatever the rate says. */
  heads: string[];
  ratePct: number;
  /** A rate for one head that differs from the agreement rate. */
  headRates: Record<string, number>;
  /** The most one patient may earn, whatever the bill was. */
  capPerPatient: number;
  /** The most a month may earn. A percentage with no ceiling is an unbounded liability. */
  capPerMonth: number;
  payoutMethod: PayoutMethod;
  payoutAccount: string | null;
  tdsPct: number;
  holdDays: number;
  minPayout: number;
  preparedBy: string;
  approvedBy: string;
  /** The board resolution, when the rate or the term needed one. */
  boardRef: string | null;
  suspendedBecause: string | null;
  versions: AgreementVersion[];
}

/** What the register needs to know about an agreement today, including why it pays nothing when it does not. */
export function agreementStatus(a: ReferrerAgreement, day: string): ReturnType<typeof agreementLife> & { pays: boolean; why: string } {
  if (a.suspendedBecause) {
    return {
      state: 'Expired',
      daysToExpiry: 0,
      pays: false,
      because: `Suspended: ${a.suspendedBecause}. A suspension stops the money without ending the agreement, which is what a suspension is for.`,
      why: `Suspended — ${a.suspendedBecause}`,
    };
  }
  const life = agreementLife(a.expiresOn, day);
  if (life.state === 'Expired') return { ...life, pays: false, why: `The agreement ran out on ${a.expiresOn}: nothing accrues until it is renewed.` };
  if (a.heads.length === 0) return { ...life, pays: false, why: 'No heads are named, so there is nothing for a rate to apply to.' };
  if (a.ratePct === 0) {
    return {
      ...life,
      pays: false,
      why:
        a.kind === 'In-house consultant'
          ? 'An in-house consultant earns the consultant share of what they bill, not a referral commission: the record exists so the register can refuse the double dip by name.'
          : 'The rate is zero, so nothing accrues. That is either a deliberate stop or a number nobody filled in.',
    };
  }
  return { ...life, pays: true, why: `Paying ${a.ratePct} % on ${a.heads.length} head(s) until ${a.expiresOn}.` };
}

export interface AgreementCheck {
  ok: boolean;
  refusals: Array<{ code: string; field: string; message: string }>;
  warnings: string[];
}

const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
/** Bangladeshi mobile (01XXX-XXX-XXX) or landline (0X-XXXXXXXX). A number with no shape is a number nobody will ring. */
const isPhone = (value: string): boolean => /^(01\d{3}-?\d{3}-?\d{3}|0[2-9]-?\d{3,4}-?\d{4})$/.test(value.replace(/\s+/g, ''));
const dayValue = (iso: string): number => new Date(`${iso}T00:00:00`).getTime();
const yearsBetween = (from: string, to: string): number => (dayValue(to) - dayValue(from)) / (365.25 * 86_400_000);

/**
 * Whether an agreement may be saved as Active, and what a person should know about it. Every refusal names the
 * field it belongs to, so the editor can put the sentence next to the input rather than in a banner at the top.
 */
export function checkAgreement(
  draft: ReferrerAgreement,
  existing: ReferrerAgreement[],
  day: string,
): AgreementCheck {
  const refusals: Array<{ code: string; field: string; message: string }> = [];
  const warnings: string[] = [];
  const refuse = (code: string, field: string, message: string) => refusals.push({ code, field, message });
  const others = existing.filter((a) => a.code !== draft.code);

  /* ------------------------------------------------------------- who they are */
  if (!/^REF-[A-Z0-9]{3,10}$/.test(draft.code)) {
    refuse('code-shape', 'code', 'A referrer code is REF- followed by 3 to 10 capital letters or digits. The code is what every voucher, statement and register line carries, so it is not free text.');
  }
  if (others.some((a) => a.code === draft.code)) {
    refuse('code-taken', 'code', `${draft.code} already belongs to another referrer. A code is an identity: two referrers behind one code means a payout that cannot be traced to a person.`);
  }
  if (!draft.name.trim()) refuse('no-name', 'name', 'A payment to an unnamed referrer cannot be queried, and a commission nobody can query is a commission nobody can stop.');
  if (!draft.contactPerson.trim()) refuse('no-contact', 'contactPerson', 'Name the person the register deals with. A clinic is a building; somebody has to answer for what it refers.');
  if (!isPhone(draft.phone)) refuse('phone-shape', 'phone', 'A Bangladeshi number, e.g. 01711-334-455. A commission desk without a number to ring ends up paying on trust.');
  if (draft.email && !isEmail(draft.email)) refuse('email-shape', 'email', 'That is not an email address. Leave it empty rather than wrong — a statement sent nowhere is worse than no statement.');

  /* ------------------------------------------------------------- the paper */
  if (!/^[A-Z]{2,6}-\d{2,4}\/\d{4}$/.test(draft.agreementNo) && !/^AGR-\d{4}-\d{3}$/.test(draft.agreementNo)) {
    refuse('agreement-no', 'agreementNo', 'An agreement number in the register’s own shape, e.g. AGR-2026-004 or REF/MET/2026. It is how the paper is found when a payout is questioned.');
  }
  if (!draft.signedOn) refuse('no-signed', 'signedOn', 'The day the agreement was signed. A rate the hospital cannot date is a rate somebody invented.');
  if (!draft.expiresOn) {
    refuse('no-expiry', 'expiresOn', 'An agreement with no end date is a rate nobody revisits. Every commission agreement runs out.');
  } else if (draft.signedOn && dayValue(draft.expiresOn) <= dayValue(draft.signedOn)) {
    refuse('expiry-before-signing', 'expiresOn', 'The agreement cannot end before it was signed.');
  } else if (draft.signedOn && yearsBetween(draft.signedOn, draft.expiresOn) > AGREEMENT_MAX_YEARS) {
    refuse('term-too-long', 'expiresOn', `Commission agreements run for at most ${AGREEMENT_MAX_YEARS} years. A longer term locks in both the rate and the referral stream, and neither survives a market change well.`);
  }
  if (!draft.documentRef.trim()) refuse('no-document', 'documentRef', 'Where the signed copy is filed. The register will be asked for it, usually by an auditor and usually a year later.');

  /* ------------------------------------------------------------- the tax and registration numbers */
  if (!draft.tin) {
    // Warning rather than refusal at draft stage: the paper exists, the number is being chased. It becomes a
    // refusal the moment anybody tries to pay — which is what `payoutRun` enforces.
    warnings.push('No TIN on file yet. The agreement can be written, but no payout may be made until the number is in: a commission paid without one attracts the higher deduction, and the register refuses it.');
  }
  if (draft.kind === 'External doctor' && !draft.registration) {
    refuse('no-registration', 'registration', 'An external doctor is paid for a clinical decision, so the register needs their BMDC registration number. Paying a clinician the hospital cannot identify is a payment an auditor will not accept.');
  }
  if (draft.kind === 'Corporate partner' && !draft.bin) {
    warnings.push('A corporate partner should have a BIN on file. Without it the hospital cannot satisfy itself that the company exists as a payer of tax.');
  }

  /* ------------------------------------------------------------- the money */
  if (draft.ratePct < 0 || draft.ratePct > 100) {
    refuse('rate-range', 'ratePct', 'A commission rate is a percentage of collected money, between 0 and 100.');
  }
  if (draft.kind === 'In-house consultant' && draft.ratePct > 0) {
    refuse('in-house-rate', 'ratePct', 'An in-house consultant earns the consultant share of what they bill, not a referral commission. Two payouts for one consultation is the double dip this register exists to refuse.');
  }
  if (draft.heads.length === 0) {
    refuse('no-heads', 'heads', 'A rate with no heads earns nothing, which is not what a signed agreement means. Name the heads it commissions.');
  }
  const blocked = draft.heads.filter((h) => COMMISSION_BLOCKED_HEADS.includes(h));
  if (blocked.length > 0) {
    refuse('blocked-head', 'heads', `${blocked.map((c) => incomeHeadByCode(c)?.label ?? c).join(', ')} may never be commissioned, whoever the agreement names: paying a share of drug sales pays a prescriber to prescribe, and a donation is not the patient’s spending to share.`);
  }
  if (draft.ratePct > RATE_CEILING_PCT && !draft.boardRef) {
    refuse('above-ceiling', 'boardRef', `Above ${RATE_CEILING_PCT} % the board has to be on the file, not the finance manager alone. Put the resolution reference here.`);
  }
  if (draft.ratePct > RATE_CEILING_PCT && draft.boardRef) {
    warnings.push(`A rate of ${draft.ratePct} % is above the ${RATE_CEILING_PCT} % ceiling and is carried on resolution ${draft.boardRef}. The screen prints the reference beside the rate for as long as the rate stands.`);
  }
  const perHead = Object.entries(draft.headRates).filter(([code, pct]) => pct > 0 && draft.heads.includes(code));
  const aboveCeiling = perHead.filter(([, pct]) => pct > draft.ratePct && draft.ratePct > 0);
  if (aboveCeiling.length > 0) {
    warnings.push(`${aboveCeiling.map(([code, pct]) => `${incomeHeadByCode(code)?.label ?? code} at ${pct} %`).join(', ')} is above the agreement rate. Fine if the paper says so — the register reads the head rate first.`);
  }
  if (draft.kind !== 'In-house consultant' && draft.ratePct > 10 && draft.capPerMonth <= 0) {
    refuse('no-monthly-cap', 'capPerMonth', `A rate above 10 % with no monthly ceiling is an unbounded liability: one long admission can earn more than the referrer’s whole year. Name a cap.`);
  }
  if (draft.capPerPatient < 0 || draft.capPerMonth < 0) refuse('cap-negative', 'capPerMonth', 'A cap is a limit, so it cannot be negative.');
  if (draft.capPerPatient > 0 && draft.capPerMonth > 0 && draft.capPerPatient > draft.capPerMonth) {
    warnings.push(`The per-patient cap (${money(draft.capPerPatient)}) is above the monthly cap (${money(draft.capPerMonth)}), so the monthly cap is the one that will bite. Nothing wrong with that; it is worth saying out loud.`);
  }

  /* ------------------------------------------------------------- the payout terms */
  if (draft.tdsPct < COMMISSION_TDS_PCT) {
    refuse('tds-low', 'tdsPct', `Withholding on a commission is at least ${COMMISSION_TDS_PCT} %. An agreement may hold back more, never less: the deduction on a professional payment is the law’s, not the contract’s.`);
  }
  if (draft.holdDays < COMMISSION_HOLD_DAYS) {
    refuse('hold-short', 'holdDays', `The hold is at least ${COMMISSION_HOLD_DAYS} days — long enough for a treated patient’s refund to net off before the commission leaves. A shorter hold pays a share of money the hospital later gives back.`);
  }
  if (draft.payoutMethod === 'Bank transfer' && !draft.payoutAccount) {
    refuse('no-account', 'payoutAccount', 'A bank transfer needs an account to transfer to. Paying to whatever number a referrer sends by message is how a commission ends up in the wrong hands.');
  }
  if (draft.payoutMethod === 'Cash' && draft.capPerMonth > CASH_PAYMENT_LIMIT) {
    refuse('cash-over-limit', 'payoutMethod', `A cash payout may not exceed the counter limit of ${money(CASH_PAYMENT_LIMIT)} in a month, so a commission with a ceiling above that cannot be paid in cash. Bank transfer or cheque.`);
  }
  if (draft.minPayout < 0) refuse('min-negative', 'minPayout', 'A minimum payout is a floor, so it cannot be negative.');
  if (draft.minPayout > 0 && draft.minPayout < MIN_PAYOUT_FLOOR) {
    warnings.push(`A minimum of ${money(draft.minPayout)} is below the ${money(MIN_PAYOUT_FLOOR)} floor at which a payout costs more to make than it pays. Amounts below it accumulate instead.`);
  }
  if (draft.minPayout > 0 && draft.capPerMonth > 0 && draft.minPayout > draft.capPerMonth) {
    refuse('min-above-cap', 'minPayout', 'The minimum payout is above the monthly ceiling, so no payout could ever be made. One of the two numbers is wrong.');
  }

  /* ------------------------------------------------------------- the two names */
  if (!draft.preparedBy.trim()) refuse('no-preparer', 'preparedBy', 'Name who wrote this agreement.');
  if (!draft.approvedBy.trim()) refuse('no-approver', 'approvedBy', 'Name who approved it. Every rate on this register is approved by a person, not by the screen.');
  if (draft.preparedBy && draft.approvedBy && draft.preparedBy.trim() === draft.approvedBy.trim()) {
    refuse('self-approval', 'approvedBy', 'The same person cannot prepare and approve an agreement. One name on both sides is the finding an auditor writes down first.');
  }
  const approver = APPROVAL_LADDER.find((r) => draft.approvedBy.includes(r.role));
  if (draft.ratePct > 10 && approver && approver.role === 'Accounts officer') {
    refuse('approver-too-junior', 'approvedBy', 'A commission rate above 10 % is not an accounts officer’s decision.');
  }

  /* ------------------------------------------------------------- the overlap */
  // Two different referrers both sending diagnostics is the business, not a conflict. What matters — and it is the
  // one thing a register must not let through quietly — is one referrer holding two live agreements on one head,
  // because the register would pay both.
  const sameReferrer = (a: ReferrerAgreement) =>
    a.code === draft.code || a.name.trim().toLowerCase() === draft.name.trim().toLowerCase() || (Boolean(a.tin) && a.tin === draft.tin);
  const overlapping = others.filter(
    (a) =>
      sameReferrer(a) &&
      dayValue(a.signedOn) <= dayValue(draft.expiresOn || draft.signedOn) &&
      dayValue(a.expiresOn) >= dayValue(draft.signedOn || draft.expiresOn) &&
      a.heads.some((h) => draft.heads.includes(h)),
  );
  if (overlapping.length > 0) {
    warnings.push(`This referrer already holds ${overlapping.map((a) => a.code).join(', ')} over the same dates on ${overlapping[0].heads.filter((h) => draft.heads.includes(h)).map((h) => incomeHeadByCode(h)?.label ?? h).join(' and ')}. The register pays both, so this is either a renewal that should have replaced the old record or two agreements that should not both be live.`);
  }
  if (dayValue(draft.expiresOn || day) < dayValue(day)) {
    warnings.push(`The agreement expired on ${draft.expiresOn}. It may be saved — history has to be kept — but nothing accrues to it until it is renewed.`);
  }

  return { ok: refusals.length === 0, refusals, warnings };
}

/** A one-line summary a register line can carry: what it pays, on what, until when. */
export function agreementSummary(a: ReferrerAgreement, day: string): string {
  const status = agreementStatus(a, day);
  const headLabels = a.heads.map((c) => incomeHeadByCode(c)?.label ?? c);
  return `${a.ratePct} % on ${headLabels.length} head${headLabels.length === 1 ? '' : 's'} (${headLabels.join(', ')}) · ${status.state.toLowerCase()} to ${a.expiresOn} · hold ${a.holdDays} days · withholding ${a.tdsPct} %`;
}

/** Renewing is a new dated version, not an edit: last year's rate stays readable on the record. */
export function renewAgreement(a: ReferrerAgreement, opts: { to: string; ratePct?: number; by: string; at: string }): ReferrerAgreement {
  return {
    ...a,
    expiresOn: opts.to,
    ratePct: opts.ratePct ?? a.ratePct,
    approvedBy: opts.by,
    versions: [
      ...a.versions,
      {
        from: opts.at.slice(0, 10),
        ratePct: opts.ratePct ?? a.ratePct,
        heads: [...a.heads],
        by: opts.by,
        what: `Renewed to ${opts.to}${opts.ratePct != null && opts.ratePct !== a.ratePct ? ` at ${opts.ratePct} % (was ${a.ratePct} %)` : ` at the same ${a.ratePct} %`}`,
      },
    ],
  };
}

/** What the referral register reads, as opposed to what this screen stores: only the terms the money needs. */
export const termsFrom = (a: ReferrerAgreement) => ({
  code: a.code,
  heads: a.heads,
  ratePct: a.ratePct,
  headRates: a.headRates,
  holdDays: a.holdDays,
  tdsPct: a.tdsPct,
  expiresOn: a.expiresOn,
});

/* ================================================================================== Setup › Finance
 *
 * The income and expense heads. The legacy screen was two grids of names; the two fields that matter are the
 * billing category on an income head and the tax rates on an expense head, and both are checked here against the
 * things that read them.
 */

export const HEAD_KINDS = ['Income', 'Expense'] as const;
export type HeadKind = (typeof HEAD_KINDS)[number];

/** The nine fields of the legacy Setup › Finance form, in the order a person fills them in. */
export interface HeadDraft {
  code: string;
  label: string;
  kind: HeadKind;
  /** Operating/Non-operating for income, Revenue/Capital for expense. One field, because it is one question. */
  group: string;
  /** Income only: the billing categories this head collects. Empty means counter income no bill knows about. */
  categories: Category[];
  /** Expense only. */
  aitPct: number | null;
  vatPct: number | null;
  quotable: boolean;
  effectiveFrom: string;
}

export const HEAD_GROUP_BY_KIND: Record<HeadKind, string[]> = {
  Income: ['Operating', 'Non-operating'],
  Expense: ['Revenue', 'Capital'],
};

/** The rates the law allows. A free-text percentage on a tax field is how a wrong return gets filed. */
export const AIT_RATES: Array<number | null> = [null, 3, 5, 10];
export const VAT_RATES: Array<number | null> = [null, 5, 15];

export interface HeadCheck {
  ok: boolean;
  refusals: Array<{ code: string; field: string; message: string }>;
  warnings: string[];
}

/**
 * Whether a head may be saved. The interesting refusals are the ones where the edit is legal but would re-label
 * money that has already moved: a category change, a group change and a rate change all fail that test differently.
 */
export function checkHead(draft: HeadDraft, existing: HeadDraft[], opts: { editing?: boolean; hasMoneyInPeriod?: boolean; periodEnds?: string; hasCapitalisedAssets?: boolean } = {}): HeadCheck {
  const refusals: Array<{ code: string; field: string; message: string }> = [];
  const warnings: string[] = [];
  const refuse = (code: string, field: string, message: string) => refusals.push({ code, field, message });

  const prefix = draft.kind === 'Income' ? 'INC-' : 'EXP-';
  if (!new RegExp(`^${prefix}[A-Z0-9]{2,10}$`).test(draft.code)) {
    refuse('code-shape', 'code', `An ${draft.kind.toLowerCase()} head starts with ${prefix} — that prefix is how the ledger, the day book and every report know which side of the book a rupee is on.`);
  }
  if (existing.some((h) => h.code === draft.code && h.kind !== draft.kind)) {
    const other = existing.find((h) => h.code === draft.code)!;
    refuse('code-across-kinds', 'code', `${draft.code} already exists as an ${other.kind.toLowerCase()} head. One code on both sides of the book makes the day book’s two lists ambiguous, and every reconciliation reads them separately.`);
  }
  if (!draft.label.trim()) refuse('no-label', 'label', 'A head with no label is a code nobody at a counter recognises, and a counter that cannot find the head uses “other”.');
  if (!HEAD_GROUP_BY_KIND[draft.kind].includes(draft.group)) {
    refuse('group-shape', 'group', `An ${draft.kind.toLowerCase()} head is ${HEAD_GROUP_BY_KIND[draft.kind].join(' or ')}.`);
  }

  const previous = opts.editing ? existing.find((h) => h.code === draft.code && h.kind === draft.kind) : undefined;

  if (draft.kind === 'Income') {
    if (draft.aitPct != null || draft.vatPct != null) {
      refuse('tax-on-income', 'aitPct', 'Withholding and VAT belong to what the hospital pays, not to what it takes. An income head that files them will double-count tax in the day book.');
    }
    const unknown = draft.categories.filter((c) => !CHARGE_CATEGORIES.includes(c));
    if (unknown.length > 0) {
      refuse('unknown-category', 'categories', `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a billing category' : 'are not billing categories'} this branch bills under, so no line could ever be filed to this head through the tariff.`);
    }
    // The reconciliation credits one head per category: the first in the list that collects it. A second head on
    // the same category is therefore unreachable from billing, and the screen says which head wins.
    const added = previous ? draft.categories.filter((c) => !previous.categories.includes(c)) : draft.categories;
    for (const category of added) {
      const rival = INCOME_HEADS.find((h) => headCollects(h, category) && h.code !== draft.code);
      if (rival) {
        warnings.push(`${rival.label} (${rival.code}) already collects ${category}. The reconciliation credits the first head that claims it, so this one would only be reached by a manual counter receipt — worth a note on the head, or take the category off the other.`);
      }
    }
    const removed = previous ? previous.categories.filter((c) => !draft.categories.includes(c)) : [];
    if (opts.hasMoneyInPeriod && (added.length > 0 || removed.length > 0)) {
      // A dated change is legal: the ledger holds the head on every line it has already matched, so a change
      // effective after that period re-labels nothing. What is refused is re-labelling money already matched.
      const after = opts.periodEnds && draft.effectiveFrom > opts.periodEnds;
      const because = `${added.length > 0 ? `collecting ${added.join(' and ')}` : ''}${added.length > 0 && removed.length > 0 ? ' and ' : ''}${removed.length > 0 ? `giving up ${removed.join(' and ')}` : ''}`;
      if (after) {
        warnings.push(`Applies from ${draft.effectiveFrom}, after the period that already has money in it. The lines already matched keep the head they were matched to, so ${because} changes where the next period’s bills land and nothing else.`);
      } else {
        refuse('category-moves-history', 'categories', `This head has money in the period ending ${opts.periodEnds ?? 'today'}. Changing what it collects re-labels the money the reconciliation has already matched, so last week’s “missing documents” would silently become this week’s “complete”. Date the change after ${opts.periodEnds ?? 'the period'}: the money already matched keeps the head it was matched to.`);
      }
    }
    const wasNonOperating = previous?.group === 'Non-operating';
    if (wasNonOperating && draft.group === 'Operating') {
      refuse('donations-become-spendable', 'group', 'Moving a non-operating head into operating income makes it look spendable. A donation is not the month’s revenue, and a branch that files it as revenue ends up paying salaries out of a grant without noticing.');
    }
  } else {
    if (draft.categories.length > 0) refuse('category-on-expense', 'categories', 'Only income heads collect a billing category; an expense is filed by what was bought, not by what was billed.');
    if (draft.aitPct != null && !AIT_RATES.includes(draft.aitPct)) {
      refuse('ait-not-a-rate', 'aitPct', `Withholding is one of ${AIT_RATES.filter((r) => r != null).join(', ')} % or none. A rate the law does not have is a rate somebody will have to explain to a tax officer.`);
    }
    if (draft.vatPct != null && !VAT_RATES.includes(draft.vatPct)) {
      refuse('vat-not-a-rate', 'vatPct', `VAT is one of ${VAT_RATES.filter((r) => r != null).join(', ')} % or none.`);
    }
    if (previous && (previous.aitPct !== draft.aitPct || previous.vatPct !== draft.vatPct)) {
      if (!draft.effectiveFrom) {
        refuse('rate-change-undated', 'effectiveFrom', 'A withholding or VAT rate applies from a date. Without one, the vouchers already paid would be re-taxed on paper, and the tax return would stop matching them.');
      } else {
        warnings.push(`The rate applies from ${draft.effectiveFrom}. Vouchers paid before that day keep the rate they were paid under — the ledger holds the rate on the voucher, not the rate on this screen.`);
      }
    }
    if (previous?.group === 'Capital' && draft.group === 'Revenue' && opts.hasCapitalisedAssets) {
      refuse('capital-flip', 'group', 'This head has assets on the register. Moving it from capital to revenue would take them off the asset register and put their whole value into one month’s cost.');
    }
  }

  if (opts.editing && opts.hasMoneyInPeriod && previous && previous.group !== draft.group && draft.kind === 'Income') {
    warnings.push('This head has money in the current period. The group change applies from today; the period it already covers keeps the group it was booked under.');
  }
  if (!draft.effectiveFrom) {
    refuse('no-effective', 'effectiveFrom', 'Every change to this list carries the day it applies from. That date is what lets an old report still read what the list said at the time.');
  }
  return { ok: refusals.length === 0, refusals, warnings };
}

/* ------------------------------------------------------------------ the mapping the reconciliation reads */

export interface CategoryCoverage {
  category: Category;
  heads: string[];
  /** The head `headForInvoice` credits — the first that collects the category. */
  winner: string | null;
  state: 'single' | 'shared' | 'unmapped';
  because: string;
}

/** The shape coverage is asked of: the ledger's own table, or the drafts a setup screen is holding. */
export type CoveringHead = { code: string; label: string; categories: Category[] };

/**
 * Which head collects each billing category. This is not a report: it is the mapping the reconciliation uses to
 * decide whether a counter's takings are all in the ledger, so a category with no head means money that lands in
 * “other operating income” and a category with two heads means one of them never sees a bill.
 *
 * Pass a head list in to ask the question of edits that have not been saved yet — the same function answers for
 * the ledger and for the screen that changes it, which is why a setup change can be shown to fix a gap.
 */
export function categoryCoverage(headsIn: CoveringHead[] = INCOME_HEADS): CategoryCoverage[] {
  return CHARGE_CATEGORIES.map((category) => {
    const heads = headsIn.filter((h) => headCollects(h, category));
    return {
      category,
      heads: heads.map((h) => h.code),
      winner: heads[0]?.code ?? null,
      state: heads.length === 0 ? 'unmapped' : heads.length === 1 ? 'single' : 'shared',
      because:
        heads.length === 0
          ? `No income head collects ${category}. Every billed line under it is credited to Other operating income instead, so the head that should carry the branch’s ${category.toLowerCase()} revenue shows nothing — and the reconciliation calls the difference missing documents.`
          : heads.length === 1
            ? `${heads[0].label} collects it, so a ${category.toLowerCase()} line on a bill and a receipt at the counter meet in the ledger.`
            : `${heads.map((h) => h.label).join(' and ')} both collect ${category}. The reconciliation credits the first — ${heads[0].label} — so ${heads[1].label} is only reachable by a manual receipt.`,
    };
  });
}

export const UNMAPPED_CATEGORIES = (heads?: CoveringHead[]): Category[] => categoryCoverage(heads).filter((c) => c.state === 'unmapped').map((c) => c.category);

/** The income heads no agreement may ever name, as rows the setup screen can print beside the head list. */
export const NEVER_COMMISSIONABLE = (): Array<{ head: IncomeHead; because: string }> =>
  COMMISSION_BLOCKED_HEADS.map((code) => incomeHeadByCode(code))
    .filter((h): h is IncomeHead => Boolean(h))
    .map((head) => ({
      head,
      because:
        head.code === 'INC-PHARM'
          ? 'Paying a share of drug sales pays a prescriber to prescribe. The register refuses it on every line, whoever the agreement names.'
          : head.code === 'INC-DONATION'
            ? 'A donation is not the patient’s spending to share. Commissioning it would turn other people’s generosity into a referral fee.'
            : 'Sundry income is not attributable to a referrer, and a share of it cannot be justified to the person who paid.',
    }));

export interface WithheldHead {
  code: string;
  label: string;
  aitPct: number | null;
  vatPct: number | null;
}

/** The heads that withhold anything, most-withheld first. Works on the ledger's table or on unsaved drafts. */
export const withholdingHeads = <T extends WithheldHead>(heads: readonly T[]): T[] =>
  heads.filter((h) => h.aitPct != null || h.vatPct != null).sort((a, b) => (b.aitPct ?? 0) - (a.aitPct ?? 0));

/** The expense heads whose rate a tax office reads directly, in the order of what a voucher withholds most. */
export const WITHHOLDING_HEADS = (): ExpenseHead[] => withholdingHeads(EXPENSE_HEADS);

/** The referrers a payer agreement mention, so a payer screen can link back to the register. */
export const referrersOn = (payer: Payer): Referrer[] => REFERRERS.filter((r) => (payer === 'Corporate — BRAC' ? r.kind === 'Corporate partner' : r.kind !== 'Corporate partner'));

export const SETUP_NOTE =
  'A setup screen is not a list of names. The two fields that carry money here are the billing category an income head collects — the reconciliation reads that mapping — and the withholding and VAT on an expense head, which apply from the date written beside them.';

/* ================================================================================== the seeded records
 *
 * What the branch has on file, as the two screens are opened. They are the same referrers and heads the ledger
 * pays and files against — the setup screen is the other end of the same records, not a copy — with the terms a
 * real file carries: the agreement number, the dates, the caps, the payout account and the versions.
 */

/** One agreement per referrer, with the paper behind it. */
export const SEED_AGREEMENTS: ReferrerAgreement[] = REFERRERS.map((r) => {
  const by = r.kind === 'In-house consultant' ? 'Managing director — A. H. Khan' : 'Finance manager — S. Chowdhury';
  const expired = r.code === 'REF-NURJAHAN';
  return {
    id: `agr-${r.code.toLowerCase()}`,
    code: r.code,
    name: r.name,
    kind: r.kind,
    contactPerson:
      r.kind === 'External doctor' ? r.name.split('—')[0].trim() : r.kind === 'Clinic or agent' ? 'Manager, referral desk' : 'Health desk officer',
    phone: r.phone,
    email: `${r.code.toLowerCase().replace('ref-', '')}@example.com`,
    address:
      r.kind === 'External doctor'
        ? 'Uttara Chest Clinic, Sector 7, Dhaka 1230'
        : r.kind === 'Clinic or agent'
          ? 'House 42, Road 11, Banani, Dhaka 1213'
          : r.kind === 'Corporate partner'
            ? 'GreenTech Knitwear, Plot 19, DEPZ, Savar'
            : 'Dizi Hospital, 2nd floor, OPD block',
    tin: r.tin,
    bin: r.kind === 'Clinic or agent' ? 'BIN-0021-4478' : r.kind === 'Corporate partner' ? 'BIN-0044-1120' : null,
    registration: r.kind === 'External doctor' ? 'BMDC-A-48211' : r.kind === 'In-house consultant' ? 'BMDC-A-31002' : null,
    agreementNo: expired ? 'AGR-2025-011' : r.kind === 'In-house consultant' ? 'AGR-2026-002' : `AGR-2026-${String(4 + (r.name.length % 6)).padStart(3, '0')}`,
    signedOn: expired ? '2025-04-01' : '2026-07-01',
    expiresOn: r.agreementTo,
    documentRef: `Legal › Referral agreements › 2026 › ${r.code}`,
    heads: [...r.heads],
    ratePct: r.commissionPct,
    headRates: (r.code === 'REF-DRHAQ' ? { 'INC-IPD': 8 } : {}) as Record<string, number>,
    capPerPatient: r.kind === 'In-house consultant' ? 0 : 3_000,
    capPerMonth: r.kind === 'In-house consultant' ? 0 : 25_000,
    payoutMethod: 'Bank transfer',
    payoutAccount:
      r.kind === 'Corporate partner'
        ? 'BRAC Bank · DEPZ branch · 15•••8842'
        : r.code === 'REF-DRHAQ'
          ? 'BRAC Bank · Uttara branch · 15•••4471'
          : 'City Bank · Banani branch · 14•••2290',
    tdsPct: COMMISSION_TDS_PCT,
    holdDays: COMMISSION_HOLD_DAYS,
    minPayout: 1_000,
    preparedBy: 'Accounts officer — N. Haque',
    approvedBy: by,
    boardRef: r.commissionPct > RATE_CEILING_PCT - 5 ? 'Board resolution 2026/14' : null,
    suspendedBecause: null,
    versions: [
      ...(expired ? [{ from: '2025-04-01', ratePct: 12, heads: [...r.heads], by, what: 'Signed for one year at 12 %' }] : [{ from: '2026-07-01', ratePct: Math.max(0, r.commissionPct - 2), heads: [...r.heads], by, what: `Signed for one year at ${Math.max(0, r.commissionPct - 2)} %` }]),
      { from: expired ? '2026-04-01' : '2026-07-01', ratePct: r.commissionPct, heads: [...r.heads], by, what: `${r.commissionPct} % from this date` },
    ],
  };
});

/** The two head lists as the Setup › Finance editor sees them. */
export const SEED_HEADS: HeadDraft[] = [
  ...INCOME_HEADS.map((h) => ({
    code: h.code,
    label: h.label,
    kind: 'Income' as HeadKind,
    group: h.group,
    categories: [...h.categories],
    aitPct: null,
    vatPct: null,
    quotable: false,
    effectiveFrom: '2026-07-01',
  })),
  ...EXPENSE_HEADS.map((h) => ({
    code: h.code,
    label: h.label,
    kind: 'Expense' as HeadKind,
    group: h.klass,
    categories: [],
    aitPct: h.aitPct,
    vatPct: h.vatPct,
    quotable: h.quotable,
    effectiveFrom: '2026-07-01',
  })),
];

/** The day a draft takes effect from, when a screen has no opinion: today, in the ledger's own shape. */
export const effectiveToday = (day: string): string => day;
