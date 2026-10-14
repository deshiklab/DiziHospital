/* ------------------------------------------------------------------------------------------------
 * The report suite (P6) — one framework, seventeen reports.
 *
 * The legacy product had seventeen Reports › … screens, each of which ran its own query and printed its own table.
 * Two of them would disagree about the same day, nobody could tell which was right, and neither said what its
 * columns meant. This module is the one place those seventeen become definitions rather than screens, and it holds
 * them to three rules:
 *
 *  1. **Per branch and consolidated are the same query added up.** A branch's rows are the records that branch
 *     wrote; the consolidated table is those rows summed, by the column's own rule. Nothing is queried twice, so
 *     the consolidated figure cannot disagree with the branches it is made of. Where a branch cannot answer at all
 *     — a satellite with no in-patient beds, a branch with no ledger of its own — the report says so in a sentence
 *     instead of printing a row of zeros, because a zero reads as “none” and that is a different fact.
 *  2. **Every column carries its definition and its arithmetic.** A column says whether it adds up (`sum`), is an
 *     oldest-of (`max`), a ratio recomputed from two other columns (`percentOf`), or an average pooled over its
 *     own total and count (`avgOf`). Summing a maximum is how a report ends up claiming a 339-day-old claim that
 *     is two claims of 170; summing two averages is how a branch with eleven patients looks slower than it is.
 *  3. **Every report says which days it actually read.** The range a reader picks is a request; the data behind
 *     these generators holds a few days. The report names the days it read and says when that is fewer than the
 *     range asked for, rather than implying a month it never looked at.
 *
 * The rows come from the same deterministic generators the operational screens use (`generateAppointments`,
 * `generateDispenses`, `bloodBankDay`, …), so a figure here and the record behind it cannot drift apart. The data
 * is synthetic and this file says so wherever the honesty of a figure depends on it — a preview that invents a
 * birth register to fill a screen would be worse than one that says the register does not exist yet.
 */

import { branches, patients, type Patient } from './mock';
import { DOCTORS, doctorById, generateAppointments, type Appointment } from './appointments';
import { generateEncounters, type Encounter } from './clinical';
import { generateInvoices, money, totals, type Payer } from './billing';
import { PAYER_AGREEMENTS, payerAgreement } from './finance-tables';
import { CASH_FLOAT_RETAINED, claimsSnapshot, dayBook, financeWindow, generateClaims, type Claim } from './finance';
import { generateInpatient, occupancy, type Bed } from './ward';
import { daysToExpiry, drugById, EXPIRY_WARN_DAYS, generateBatches, generateDispenses } from './pharmacy';
import { generateDiagnosticOrders, generateQc, needsCallback } from './diagnostics';
import { bloodBankDay, COMPONENT_LABEL, shortGroups } from './bloodbank';
import { ambulanceDay, OXYGEN_FLOOR_PCT, responseMinutes, responseVerdict } from './ambulance';
import {
  expiringBatches,
  generateInventory,
  inventoryItems,
  quarantinedQty,
  reorderSuggestions,
  STOCK_VARIANCE_PCT,
  STOCK_VARIANCE_UNITS,
  stockValue,
  storeMovements,
  STORES,
} from './inventory';
import { dutyDay, MAX_CONSECUTIVE_NIGHTS, MIN_REST_HOURS } from './duty';
import { theatreDay, TURNAROUND_FLOOR_MIN } from './theatre';
import { birthDeathDay } from './birthdeath';
import { ENTITY_POLICY } from './sync';
/* The contract's own operation list, so the audit report describes the trail the API will actually write rather
   than a second list kept beside it — the same reason `lib/sync.ts` reads the contract instead of a table. */
import { operations as contractOperations } from '@dizi/contracts/client';

/* ================================================================================== branches and scope */

export { branches };
export type BranchId = (typeof branches)[number];

/** The scope the screens offer: one branch, or every branch added up. */
export const CONSOLIDATED = 'All branches';
export type Scope = BranchId | typeof CONSOLIDATED;

export const SCOPES: Scope[] = [CONSOLIDATED, ...branches];

/** What each branch actually does, so a report can refuse to print a zero for a service nobody there provides. */
export type Service = 'Out-patient' | 'In-patient' | 'Theatre' | 'Diagnostics' | 'Pharmacy' | 'Blood bank' | 'Ambulance';

export const BRANCH_SERVICES: Record<BranchId, Service[]> = {
  'Main Campus': ['Out-patient', 'In-patient', 'Theatre', 'Diagnostics', 'Pharmacy', 'Blood bank', 'Ambulance'],
  'Uttara Branch': ['Out-patient', 'Diagnostics', 'Pharmacy', 'Blood bank', 'Ambulance'],
  'Mirpur Branch': ['Out-patient', 'Pharmacy'],
};

export const BRANCH_NOTE: Record<BranchId, string> = {
  'Main Campus': 'The pilot branch: out-patient, in-patient, theatre, diagnostics, pharmacy, blood bank and the ambulance fleet, with its own ledger.',
  'Uttara Branch': 'A satellite: out-patient, diagnostics, pharmacy, blood bank and an ambulance, with no in-patient beds.',
  'Mirpur Branch': 'An edge clinic: out-patient and pharmacy. It runs on its own node and queues when the link is down.',
};

export const branchHas = (branch: BranchId, service: Service): boolean => BRANCH_SERVICES[branch].includes(service);

/**
 * Which branches' books the preview's ledger actually is.
 *
 * A node's book is its own: the contract's `/ledger/*` operations are per node, numbered from that node's block, and
 * a satellite's takings reach the consolidated report through its own drain rather than through Main Campus's till.
 * In the preview one branch has a book, and the others say so instead of being handed a share of it.
 */
export const LEDGER_NODES: BranchId[] = ['Main Campus'];

/**
 * A register that in this preview is one site's: one fridge, one theatre suite, one store ledger, one roster, one
 * fleet. A satellite runs its own, and a share of another site's register is a figure nobody could act on — so the
 * report names what is missing instead of dividing the main campus's day three ways.
 */
const SITE_BOUND = (what: string, branch: BranchId): string | null =>
  LEDGER_NODES.includes(branch)
    ? null
    : `This preview’s ${what} is Main Campus’s: one set of records, written by one site’s staff. ${branch} runs its own, and a share of somebody else’s ${what} would be a figure the branch could not act on even if it believed it.`;

/** Which branch wrote a record: the patient's own branch where the record names a patient. */
export function branchOfMrn(mrn: string): BranchId {
  const patient = patients.find((p) => p.mrn === mrn);
  return (patient?.branch ?? 'Main Campus') as BranchId;
}

/* ================================================================================================= ranges */

export type RangeId = 'today' | 'week' | 'month';

export const RANGES: Array<{ id: RangeId; label: string; days: number; note: string }> = [
  { id: 'today', label: 'Today', days: 1, note: 'the shift in progress' },
  { id: 'week', label: 'Last 7 days', days: 7, note: 'the usual management view' },
  { id: 'month', label: 'Last 30 days', days: 30, note: 'for trends, not for today’s decisions' },
];

export const rangeOf = (id: RangeId): (typeof RANGES)[number] => RANGES.find((r) => r.id === id) ?? RANGES[1];

/** The day list a range means, ending at `day` and walking backwards — one place, so two reports cannot disagree. */
const backDays = (day: string, days: number): string[] => {
  const end = Date.parse(`${day}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
};

/* ======================================================================== columns, rows and definitions */

export interface ReportColumn {
  key: string;
  header: string;
  align?: 'right';
  width?: string;
  kind?: 'money' | 'count' | 'text' | 'percent';
  /**
   * How the figure adds up across branches and across rows. A count and a shilling add up; the age of the oldest
   * claim and a percentage do not, and adding them is how a report ends up with a 339-day-old claim that is two
   * claims of 170. Percentages and averages are recomputed from the two columns that made them.
   */
  aggregate?: 'sum' | 'max';
  percentOf?: { part: string; whole: string };
  /**
   * An average: a total over a count. Summing two branches' averages is the commonest wrong number in a
   * management report — the consolidated figure is the pooled total over the pooled count, which is what a
   * weighted mean actually is.
   */
  avgOf?: { total: string; count: string; suffix: string; round?: number };
}

/** The figures that add up: everything except a maximum and a ratio. */
const additive = (column: ReportColumn): boolean => (column.kind === 'text' ? false : !column.percentOf && (column.aggregate ?? 'sum') === 'sum');

export interface ReportFilter {
  /** What the legacy screen asked for, and what this report takes instead. */
  key: string;
  label: string;
  value: string;
  hint: string;
}

export interface ReportView {
  label: string;
  hint: string;
  /** What the view keeps. Written against the row's own cells, so it moves with the report's arithmetic. */
  keep: (row: ReportRow) => boolean;
}

export interface ReportRow {
  id: string;
  label: string;
  cells: Record<string, number | string>;
  /** Set on a consolidated row: the branch each figure came from. */
  from?: Partial<Record<BranchId, number>>;
}

export interface ReportTable {
  def: ReportDef;
  scope: Scope;
  range: RangeId;
  asOf: string;
  /** The days the report actually read. A range wider than the data is named, not hidden. */
  daysRead: string[];
  rangeNote: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, number>;
  /** Branches that cannot answer this report at all, and why. Printed instead of a row of zeros. */
  unavailable: Array<{ branch: BranchId; because: string }>;
  reconciliation: string;
  closing: string;
}

export interface BuildContext {
  day: string;
  range: RangeId;
  scope: Scope;
  /**
   * The days the report actually read — `min(range, what the data holds)`. Filled in by `buildReport` rather than by
   * the caller, so a screen cannot ask for a closing line about a period narrower than the table above it.
   */
  days?: string[];
}

interface RowContext {
  day: string;
  range: RangeId;
  days: string[];
  branch: BranchId;
}

export interface ReportDef {
  /** The route segment: `/reports/<topic>`. */
  topic: string;
  title: string;
  /** The legacy screen this replaces, so a reader arriving from the old product can find it. */
  legacy: string;
  group: ReportGroup;
  /** The question the report answers, in the reader's words. */
  question: string;
  /** The service a branch must have for this report to mean anything there. */
  requires?: Service;
  /**
   * A reason of the report's own, where the missing thing is not a service but a store — a ledger, say.
   */
  cannotReport?: (branch: BranchId) => string | null;
  /**
   * Something the reader has to know before believing the table — a source that is only half there, a register the
   * product does not keep yet. A report that is honest about a gap is useful; one that hides it is dangerous.
   */
  caveat?: string;
  /**
   * True where the rows are the same in every branch, because the report describes the product rather than a
   * branch's day — the audit trail's shape, for instance. Adding three branches would count the same rule three
   * times and present the product's own policy as though three sites had done something, so the report is read
   * once and its reconciliation says why there is nothing to add up.
   */
  sameEverywhere?: string;
  filters: ReportFilter[];
  /**
   * The views a reader opens the report for, each a filter over its own rows. A management report is read the same
   * way every morning — the same queue, the same exceptions — so the morning's question is a chip rather than a
   * search somebody has to remember how to type. Every view here keeps at least one row on the day the preview
   * shows, because a chip that leads to an empty table reads as a broken report.
   */
  views?: ReportView[];
  columns: ReportColumn[];
  /** When the report goes out, to whom, and why then. A report nobody is sent is a report nobody reads. */
  schedule: string;
  owner: string;
  /**
   * How many days the data behind the report holds. A range wider than this is narrowed and said so — the
   * alternative is a 30-day figure computed from three days of data.
   */
  maxDays: number;
  /** One branch's rows. Every branch returns the same dimension keys, which is what makes the sum honest. */
  rows: (ctx: RowContext) => ReportRow[];
  /** The control total the reader can check the table against, and what makes it that. */
  closing: (ctx: Required<BuildContext>, table: { rows: ReportRow[]; totals: Record<string, number> }) => string;
}

export type ReportGroup = 'Money' | 'Patient flow' | 'Clinical' | 'Support services' | 'Workforce' | 'Governance';

export const REPORT_GROUPS: ReportGroup[] = ['Money', 'Patient flow', 'Clinical', 'Support services', 'Workforce', 'Governance'];

const numeric = (value: number | string | undefined): number => (typeof value === 'number' ? value : 0);

/** A stamped moment (`YYYY-MM-DD HH:MM`, the format the modules write) as minutes since the epoch. */
const stamp = (value: string | undefined): number | null => {
  if (!value) return null;
  const at = Date.parse(`${value.replace(' ', 'T')}:00Z`);
  return Number.isNaN(at) ? null : Math.round(at / 60_000);
};

/** Whole minutes between two stamped moments, or null where one is missing. */
const minutesBetweenStamps = (from: string | undefined, to: string | undefined): number | null => {
  const a = stamp(from);
  const b = stamp(to);
  return a === null || b === null ? null : Math.max(0, b - a);
};

/**
 * The moment the day's own board is a picture of (`2026-10-14 15:20`). Every screen that measures a wait uses the
 * ward board's clock, so a wait in this report and the wait the queue screen shows are the same number.
 */
const boardClock = (day: string): string => `${day} ${generateInpatient(day).now}`;

/** How long something has been waiting, measured to the board's own clock. */
const elapsedTo = (record: { orderedAt: string }, day: string): number =>
  minutesBetweenStamps(record.orderedAt, boardClock(day)) ?? 0;

/**
 * The pooled figure for an average column: the rows' totals added up over the rows' counts added up. Two branches
 * seeing twenty patients in ten minutes each is forty patients in twenty minutes — twenty minutes a patient is
 * arithmetic, ten is a number nobody can act on.
 */
function pooled(cells: Array<Record<string, string | number>>, column: ReportColumn): number | null {
  const spec = column.avgOf;
  if (!spec) return null;
  const total = cells.reduce((n, c) => n + numeric(c[spec.total]), 0);
  const count = cells.reduce((n, c) => n + numeric(c[spec.count]), 0);
  const factor = 10 ** (spec.round ?? 0);
  return count === 0 ? null : Math.round((total / count) * factor) / factor;
}

const columnSum = (rows: ReportRow[], key: string): number => rows.reduce((n, r) => n + numeric(r.cells[key]), 0);

/** The column a report's money or headline figure lives in — used for the reconciliation and the branch columns. */
const amountKeyOf = (def: ReportDef): string =>
  def.columns.find((c) => c.kind === 'money')?.key ?? def.columns.find((c) => c.kind === 'count')?.key ?? def.columns[0].key;

const branchColumns = (def: ReportDef): ReportColumn[] => {
  const headline = amountKeyOf(def);
  const column = def.columns.find((c) => c.key === headline);
  if (!column || !additive(column)) return def.columns;
  return [...def.columns, ...branches.map((b) => ({ key: `branch:${b}`, header: b, align: 'right' as const, kind: (column.kind ?? 'count') as 'money' | 'count' }))];
};

export function reportByTopic(topic: string): ReportDef | undefined {
  return REPORTS.find((r) => r.topic === topic);
}

export const reportsInGroup = (group: ReportGroup): ReportDef[] => REPORTS.filter((r) => r.group === group);

/**
 * One report, read per branch and then added up.
 *
 * The per-branch pass is not an optimisation: it is what makes the consolidated figure checkable. Each branch's
 * cells are summed by their own column's rule, the branch totals are kept on the row, and the sentence underneath
 * says which branches were added and in what order — so a reader who doubts the total can add it up themselves and
 * get the same number.
 */
export function buildReport(topic: string, ctx: BuildContext): ReportTable {
  const def = reportByTopic(topic);
  if (!def) throw new Error(`no report named ${topic}`);
  const range = rangeOf(ctx.range);
  const days = backDays(ctx.day, Math.min(range.days, def.maxDays));
  const capped = days.length < range.days;

  const perBranch = new Map<BranchId, ReportRow[]>();
  const unavailable: ReportTable['unavailable'] = [];

  /* A report that reads the same in every branch is read once. Its rows are the product's own rules, so a branch
     column would be a lie about three sites rather than a fact about one. */
  if (def.sameEverywhere) {
    const shared = def.rows({ day: ctx.day, range: ctx.range, days, branch: LEDGER_NODES[0] });
    for (const branch of branches) perBranch.set(branch, branch === LEDGER_NODES[0] ? shared : []);
  }

  for (const branch of branches) {
    if (def.sameEverywhere) continue;
    const refused =
      def.cannotReport?.(branch) ??
      (def.requires && !branchHas(branch, def.requires)
        ? `${branch} has no ${def.requires.toLowerCase()} service, so this report has nothing to say about it. A row of zeros would read as “none”, which is a different fact — and the one somebody would report upward.`
        : null);
    if (refused) {
      perBranch.set(branch, []);
      unavailable.push({ branch, because: refused });
      continue;
    }
    perBranch.set(branch, def.rows({ day: ctx.day, range: ctx.range, days, branch }));
  }

  /* The dimension is the union of what every branch reports: a branch that reports nothing adds nothing, and the
     row is still there for the branches that do. */
  const ids: string[] = [];
  for (const branch of branches) {
    for (const row of perBranch.get(branch) ?? []) {
      if (!ids.includes(row.id)) ids.push(row.id);
    }
  }

  const rows: ReportRow[] = ids.map((id) => {
    const found = branches.map((b) => (perBranch.get(b) ?? []).find((r) => r.id === id));
    const template = found.find(Boolean) as ReportRow;
    const cells: Record<string, number | string> = {};
    /* A column like `average turnaround` is printed from two figures (`tatMin` over `resulted`) that are not
       columns themselves. They have to be carried into the consolidated row as well, or the total of the ratio
       would be computed from nothing and read as zero while every row above it was right. */
    const carried = new Set<string>(def.columns.map((c) => c.key));
    for (const c of def.columns) {
      if (c.percentOf) carried.add(c.percentOf.part), carried.add(c.percentOf.whole);
      if (c.avgOf) carried.add(c.avgOf.total), carried.add(c.avgOf.count);
    }
    for (const key of carried) {
      if (def.columns.some((c) => c.key === key)) continue;
      cells[key] = found.reduce((n, r) => n + numeric(r?.cells[key] as number | string | undefined), 0);
    }
    for (const column of def.columns) {
      const values = found.map((r) => numeric(r?.cells[column.key] as number | string | undefined));
      if (column.kind === 'text') {
        cells[column.key] = (template.cells[column.key] ?? '') as string;
      } else if (column.percentOf) {
        const part = found.reduce((n, r) => n + numeric(r?.cells[column.percentOf!.part] as number | string | undefined), 0);
        const whole = found.reduce((n, r) => n + numeric(r?.cells[column.percentOf!.whole] as number | string | undefined), 0);
        cells[column.key] = Math.round((part / Math.max(1, whole)) * 100);
      } else if (column.avgOf) {
        cells[column.key] = pooled(found.map((r) => r?.cells ?? {}), column) ?? 0;
      } else if ((column.aggregate ?? 'sum') === 'max') {
        cells[column.key] = values.reduce((n, v) => Math.max(n, v), 0);
      } else {
        cells[column.key] = values.reduce((n, v) => n + v, 0);
      }
    }
    const from: Partial<Record<BranchId, number>> = {};
    for (const b of branches) from[b] = numeric((perBranch.get(b) ?? []).find((r) => r.id === id)?.cells[amountKeyOf(def)]);
    return { id, label: template.label, cells, from };
  });

  /* A contract-wide report reads the same in every scope, because a branch scope is not a subset of it: there is
     no such thing as Mirpur's copy of a policy. */
  const scoped: ReportRow[] =
    ctx.scope === CONSOLIDATED || def.sameEverywhere ? rows : (perBranch.get(ctx.scope as BranchId) ?? []).map((r) => ({ ...r }));

  const totals: Record<string, number> = {};
  for (const column of def.columns) {
    if (column.kind === 'text') continue;
    if (column.percentOf) {
      const part = columnSum(scoped, column.percentOf.part);
      const whole = columnSum(scoped, column.percentOf.whole);
      totals[column.key] = Math.round((part / Math.max(1, whole)) * 100);
    } else if (column.avgOf) {
      totals[column.key] = pooled(scoped.map((r) => r.cells), column) ?? 0;
    } else if ((column.aggregate ?? 'sum') === 'max') {
      totals[column.key] = scoped.reduce((n, r) => Math.max(n, numeric(r.cells[column.key])), 0);
    } else {
      totals[column.key] = columnSum(scoped, column.key);
    }
  }

  const headline = amountKeyOf(def);
  const headlineColumn = def.columns.find((c) => c.key === headline) as ReportColumn;
  const figure = (value: number): string =>
    headlineColumn.percentOf || (headlineColumn.kind ?? 'count') !== 'money'
      ? `${Math.round(value).toLocaleString('en-US')}${headlineColumn.percentOf ? ' %' : ''}`
      : money(value);
  const headlineWord = headlineColumn.header.toLowerCase();

  const reconciliation =
    def.sameEverywhere
      ? `${def.sameEverywhere} The figures above are the same in every branch for that reason, and the consolidated column is deliberately not three branches added up.`
      : ctx.scope === CONSOLIDATED
      ? `Consolidated — ${headlineWord}: ${branches.map((b) => `${b} ${figure(columnSum(perBranch.get(b) ?? [], headline))}`).join(' + ')} = ${figure(totals[headline] ?? 0)}. The branches are added up by this report rather than queried again, which is why the total is the sum of the rows above and cannot disagree with them.`
      : `${ctx.scope} alone, read from its own records — ${headlineWord}: ${figure(totals[headline] ?? 0)} of the ${figure(columnSum(rows, headline))} consolidated. A branch is not a share of the whole: it is the records the branch itself wrote.`;

  const dayCount = days.length;
  const rangeNote = `Read: ${days[0]} to ${days[dayCount - 1]} (${dayCount} day${dayCount === 1 ? '' : 's'}) — ${range.note}${
    capped
      ? `. The range asked for ${range.days}${capped && def.maxDays < range.days ? `, and the data behind this report holds ${def.maxDays}` : ''}; the days above are the days actually read, named rather than implied.`
      : '.'
  }`;

  return {
    def,
    scope: ctx.scope,
    range: ctx.range,
    asOf: ctx.day,
    daysRead: days,
    rangeNote,
    columns: ctx.scope === CONSOLIDATED && !def.sameEverywhere ? branchColumns(def) : def.columns,
    rows: scoped,
    totals,
    unavailable,
    reconciliation,
    closing: def.closing({ ...ctx, days }, { rows: scoped, totals }),
  };
}

/* ================================================================================================== Money */

/**
 * Income and expense by head, with the day book's control total.
 *
 * An expense voucher is recorded positive, the way the form that recorded it does; the report puts the sign on
 * once, in the row, so “income less expense” is a subtraction the reader can check rather than a convention they
 * have to remember. The reconciliation line beneath then names the same figure the day book does.
 */
const financeReport: ReportDef = {
  topic: 'finance',
  title: 'Income and expense by head',
  legacy: '/admin/report/finance',
  group: 'Money',
  question: 'What did the branch take and spend over the range, head by head, and does the day book behind it close?',
  cannotReport: (branch) =>
    LEDGER_NODES.includes(branch)
      ? null
      : `The ledger in this preview is ${LEDGER_NODES[0]}’s book. A branch’s money is not a share of another branch’s till: it arrives from its own node through the drain, numbered from that node’s own block, so until a node reports there is nothing here to print — and a figure apportioned from ${LEDGER_NODES[0]} would be worse than no figure at all.`,
  maxDays: 3,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'A branch reads its own node’s book. The consolidated column is the branches added up, not a second query.' },
    { key: 'range', label: 'Period', value: 'Today, with three days behind it', hint: 'The cash book keeps three days in this preview; the days read are named above rather than implied.' },
    { key: 'heads', label: 'Heads', value: 'Every income and expense head', hint: 'Income heads and expense heads are two lists on purpose: one code on both sides makes every reconciliation ambiguous.' },
    { key: 'sign', label: 'Sign', value: 'Income positive, expense negative', hint: 'The day book keeps expense vouchers positive, the way the form recorded them; the minus is put on once, here.' },
    { key: 'cash', label: 'Cash', value: 'Reported separately from everything else', hint: 'Cash is the only figure that has to agree with a drawer at the end of the day, so it is never netted into a total.' },
  ],
  schedule: 'Sent to the finance manager and the accountant every evening at 21:00; the day-book control total goes to the medical superintendent with it.',
  owner: 'Finance manager',
  views: [
    { label: 'Expense heads', hint: 'What the branch spent, head by head — the half of the day book the purchase desk reads.', keep: (r) => r.cells.kind === 'Expense' },
    { label: 'Income heads', hint: 'What it took, head by head, including the counter income no invoice knows about.', keep: (r) => r.cells.kind === 'Income' },
  ],
  columns: [
    { key: 'head', header: 'Head', kind: 'text' },
    { key: 'kind', header: 'Book', kind: 'text', width: '6rem' },
    { key: 'count', header: 'Vouchers', align: 'right', kind: 'count', width: '7rem' },
    { key: 'amount', header: 'Amount', align: 'right', kind: 'money', width: '9rem' },
  ],
  rows: ({ day, days, branch }) => {
    if (!LEDGER_NODES.includes(branch)) return [];
    const window = financeWindow(day, Math.min(days.length, 3));
    const rows: ReportRow[] = [];
    for (const inc of window.income) {
      rows.push({
        id: `income:${inc.code}`,
        label: inc.label,
        cells: { head: `${inc.code} — ${inc.label}`, kind: 'Income', count: inc.count, amount: inc.amount },
      });
    }
    const book = dayBook(day);
    for (const exp of book.byExpenseHead) {
      rows.push({
        id: `expense:${exp.code}`,
        label: exp.label,
        cells: { head: `${exp.code} — ${exp.label}`, kind: 'Expense', count: exp.count, amount: -exp.amount },
      });
    }
    return rows;
  },
  closing: ({ day, days }) => {
    const daysRead = Math.min(days.length, 3);
    const window = financeWindow(day, daysRead);
    const book = dayBook(day);
    const inFlight = Math.max(0, book.cash.in - book.cash.bookedIn);
    const income = window.income.reduce((n, h) => n + h.amount, 0);
    const expense = window.expense.reduce((n, h) => n + h.amount, 0);
    const billed = backDays(day, daysRead).reduce(
      (n, d) => n + generateInvoices(d).filter((i) => i.status !== 'Cancelled').reduce((m, i) => m + totals(i).net, 0),
      0,
    );
    return (
      `Over the ${daysRead} day${daysRead === 1 ? '' : 's'} read the counters posted ${money(income)} and the branch spent ${money(expense)}, against ${money(billed)} billed to patients over the same days. ` +
      `The two sides are not a profit and loss: a head report over a few days is lumpy because drugs and utilities are bought monthly, while every consultation is billed the day it happens. ` +
      `Drawer control for ${day}: opening float ${money(book.cash.opening)} + cash taken ${money(book.cash.in)} − cash paid out ${money(book.cash.out)} = ${money(book.cash.closing)} in the drawers, of which ${money(book.cash.depositDue)} is due at the bank and ${money(CASH_FLOAT_RETAINED)} stays as float. ` +
      (inFlight > 0
        ? `${money(inFlight)} of the takings is on a counter’s device and not yet on the ledger — the difference between a book that agrees and one the queue explains. `
        : 'Every counter’s takings are on the ledger. ') +
      `Withholding collected to pay over: ${money(window.withholding.ait)} income tax and ${money(window.withholding.vat)} VAT.`
    );
  },
};

/**
 * Payer claims by payer. The columns are the pipeline's four states of money — claimed, settled, short-paid,
 * outstanding — because a single “claims” figure hides whether the delay is the payer's or the hospital's.
 */
const tpaReport: ReportDef = {
  topic: 'tpa',
  title: 'Payer claims by payer',
  legacy: '/admin/report/tpa',
  group: 'Money',
  question: 'What is claimed from each payer, what has come back, what came back short and what is still with them — and for how long.',
  maxDays: 7,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'Claims belong to the branch that raised the bill.' },
    { key: 'range', label: 'Period', value: 'The last 7 days', hint: 'Aging is measured from the day a claim was filed, so the period read and the age of a claim are different clocks and both are named.' },
    { key: 'payer', label: 'Payer', value: 'Every payer with an agreement', hint: 'A payer with no agreement on file cannot be claimed against at all, which is the first thing a TPA desk checks.' },
    { key: 'settle', label: 'Settlement period', value: 'The agreement’s own days', hint: 'Thirty days for an insurer, thirty for a corporate, ninety for a government scheme — ninety is normal there, not a delay to chase.' },
    { key: 'short', label: 'Short payment', value: 'Always with a code', hint: 'A claim that came back short came back short for a reason; the code is what turns an argument into a correction.' },
  ],
  schedule: 'Sent to the TPA desk and the finance manager every Monday and Thursday at 08:00, with anything past its settlement period listed first.',
  owner: 'TPA desk',
  views: [
    { label: 'Past the promise', hint: 'A payer that has held a claim past the period it promised, which is the only ageing a desk can act on.', keep: (r) => numeric(r.cells.oldest) > 0 },
    { label: 'Still open', hint: 'Money claimed and not yet settled, whether that is the payer’s delay or a query on the hospital’s side.', keep: (r) => numeric(r.cells.outstanding) > 0 },
    { label: 'Came back short', hint: 'Claims that were allowed in part, with a code on each: a short payment with no code is re-submitted the same way.', keep: (r) => numeric(r.cells.shortPaid) > 0 },
  ],
  columns: [
    { key: 'payer', header: 'Payer', kind: 'text' },
    { key: 'claims', header: 'Claims', align: 'right', kind: 'count', width: '6rem' },
    { key: 'claimed', header: 'Claimed', align: 'right', kind: 'money', width: '9rem' },
    { key: 'settled', header: 'Settled', align: 'right', kind: 'money', width: '9rem' },
    { key: 'shortPaid', header: 'Short-paid', align: 'right', kind: 'money', width: '9rem' },
    { key: 'outstanding', header: 'Outstanding', align: 'right', kind: 'money', width: '9rem' },
    { key: 'oldest', header: 'Oldest overdue (days)', align: 'right', kind: 'count', aggregate: 'max', width: '8rem' },
  ],
  rows: ({ day, days, branch }) => {
    const claims = generateClaims(days[0], days[days.length - 1]).filter((c) => branchOfMrn(c.mrn) === branch);
    const byPayer = new Map<Payer, Claim[]>();
    for (const claim of claims) {
      const list = byPayer.get(claim.payer) ?? [];
      list.push(claim);
      byPayer.set(claim.payer, list);
    }
    return [...byPayer.entries()]
      .map(([payer, list]) => {
        const settled = list.reduce((n, c) => n + c.settledAmount, 0);
        const claimed = list.reduce((n, c) => n + c.claimed, 0);
        const agreement = payerAgreement(payer);
        const overdue = list.map((c) => (c.settledAt === null ? Math.max(0, c.ageDays - (agreement?.settlementDays ?? 30)) : 0));
        return {
          row: {
            id: payer,
            label: payer,
            cells: {
              payer: agreement?.tpa ? `${payer} (${agreement.tpa})` : payer,
              claims: list.length,
              claimed,
              settled,
              shortPaid: list.reduce((n, c) => n + c.disallowed, 0),
              outstanding: claimed - settled,
              /* The oldest overdue claim is a maximum: two branches with a 170-day claim each do not have a 340-day
                 one, and the desk chasing it needs to know which single claim is worst. */
              oldest: overdue.reduce((n, d) => Math.max(n, d), 0),
            },
          },
          payer,
        };
      })
      .sort((a, b) => numeric(b.row.cells.claimed) - numeric(a.row.cells.claimed))
      .map((x) => x.row);
  },
  closing: ({ day, days }) => {
    const claims = generateClaims(days[0], days[days.length - 1]);
    const snapshot = claimsSnapshot(claims).totals;
    const outstanding = claims.filter((c) => c.settledAt === null).reduce((n, c) => n + (c.claimed - c.settledAmount), 0);
    const shortPaid = claims.reduce((n, c) => n + c.disallowed, 0);
    const settled = claims.reduce((n, c) => n + c.settledAmount, 0);
    const withPayer = claims.filter((c) => c.settledAt === null).reduce((n, c) => n + c.claimed, 0);
    const oldest = claims
      .filter((c) => c.settledAt === null)
      .reduce<Claim | null>((worst, c) => (worst === null || c.overdueDays > worst.overdueDays ? c : worst), null);
    const noAgreement = [...new Set(claims.map((c) => c.payer))].filter((p) => !payerAgreement(p));
    return (
      `Claimed ${money(snapshot.claimed)} − settled ${money(settled)} = ${money(snapshot.claimed - settled)}, of which ${money(withPayer)} is still with a payer and ${money(shortPaid)} came back short. ` +
      `Every short payment carries a code — ${[...new Set(claims.map((c) => c.shortPayCode).filter(Boolean))].join(', ') || 'none today'} — because a claim that came back short for a reason nobody recorded will be re-submitted the same way. ` +
      (oldest
        ? `The oldest claim still open is ${oldest.claimNo} for ${oldest.patientName}, ${money(oldest.claimed)} to ${oldest.payer}, overdue by ${oldest.overdueDays} day${oldest.overdueDays === 1 ? '' : 's'} against a promise of ${payerAgreement(oldest.payer)?.settlementDays ?? 30}. `
        : 'No claim is open past its settlement period. ') +
      (noAgreement.length > 0 ? `${noAgreement.join(', ')} has no agreement on file, so nothing can be claimed against it at all. ` : '') +
      `Rolled up for ${day}.`
    );
  },
};

/* ============================================================================================ Patient flow */

/** The register, by age band and sex, dated by the last visit the register holds rather than by an arrival scan. */
const patientReport: ReportDef = {
  topic: 'patient',
  title: 'Patients by age and sex',
  legacy: '/admin/report/patient',
  group: 'Patient flow',
  question: 'Who is on the register, in bands a clinic actually uses, and how much of the record a clinician can trust.',
  maxDays: 30,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'A patient belongs to the branch that registered them; the register is the branch’s own list.' },
    { key: 'range', label: 'Period', value: 'The last 30 days', hint: 'The band counts patients whose last visit falls inside the days read, which is a flow of the register rather than of the door.' },
    { key: 'bands', label: 'Age bands', value: '0–4, 5–14, 15–29, 30–44, 45–59, 60+', hint: 'The bands are the ones a Bangladeshi clinic plans against: under-five and over-sixty are the two it staffs for.' },
    { key: 'sex', label: 'Sex', value: 'As recorded, including “Other”', hint: '“Other” is kept as its own count and never folded into a column that does not contain it.' },
    { key: 'allergies', label: 'Allergies', value: 'A count of records with an allergy on file', hint: 'A blank allergy field and a negative allergy field are different things, and this report counts the blanks as blanks.' },
  ],
  schedule: 'Sent to the medical superintendent and the marketing office on the first of every month at 08:00.',
  owner: 'Medical superintendent',
  views: [
    { label: 'Allergies on file', hint: 'The bands whose records carry an allergy — the figure the prescribing screens depend on.', keep: (r) => numeric(r.cells.allergies) > 0 },
    { label: 'With a payer', hint: 'Patients with an insurer, a corporate or the government scheme behind them rather than cash at the counter.', keep: (r) => numeric(r.cells.insured) > 0 },
  ],
  columns: [
    { key: 'band', header: 'Age band', kind: 'text' },
    { key: 'patients', header: 'Patients', align: 'right', kind: 'count', width: '7rem' },
    { key: 'female', header: 'Female', align: 'right', kind: 'count', width: '7rem' },
    { key: 'male', header: 'Male', align: 'right', kind: 'count', width: '7rem' },
    { key: 'insured', header: 'With a payer', align: 'right', kind: 'count', width: '8rem' },
    { key: 'allergies', header: 'Allergies on file', align: 'right', kind: 'count', width: '9rem' },
  ],
  rows: ({ days, branch }) => {
    const onRegister = patients.filter((p) => p.branch === branch && days.includes(p.lastVisit));
    const bands: Array<{ label: string; test: (age: number) => boolean }> = [
      { label: '0–4', test: (a) => a <= 4 },
      { label: '5–14', test: (a) => a >= 5 && a <= 14 },
      { label: '15–29', test: (a) => a >= 15 && a <= 29 },
      { label: '30–44', test: (a) => a >= 30 && a <= 44 },
      { label: '45–59', test: (a) => a >= 45 && a <= 59 },
      { label: '60+', test: (a) => a >= 60 },
    ];
    return bands.map((band) => {
      const list: Patient[] = onRegister.filter((p) => band.test(p.age));
      return {
        id: band.label,
        label: band.label,
        cells: {
          band: band.label,
          patients: list.length,
          female: list.filter((p) => p.sex === 'Female').length,
          male: list.filter((p) => p.sex === 'Male').length,
          insured: list.filter((p) => p.payer !== 'Self pay').length,
          allergies: list.filter((p) => p.allergies.length > 0).length,
        },
      };
    });
  },
  closing: ({ scope }) => {
    const list: Patient[] = scope === CONSOLIDATED ? patients : patients.filter((p) => p.branch === scope);
    const withAllergy = list.filter((p) => p.allergies.length > 0).length;
    const share = list.length === 0 ? '0' : ((withAllergy / list.length) * 100).toFixed(1);
    return (
      `The register holds ${list.length.toLocaleString('en-US')} patients with ${withAllergy.toLocaleString('en-US')} allergies on file (${share} %). ` +
      `An allergy recorded once is read by every prescribing screen; one recorded twice is read once and trusted once, which is why the count is here rather than in the clinical report. ` +
      `A blank allergy field is counted as blank and not as “no allergies known” — the two are different facts, and only the second one is safe to prescribe against.`
    );
  },
};

/** Appointments by consultant and source, with the no-show rate the clinic manages against. */
const appointmentReport: ReportDef = {
  topic: 'appointment',
  title: 'Appointments by consultant and source',
  legacy: '/admin/report/appointment',
  group: 'Patient flow',
  question: 'Who was booked, who came, who did not, and where the booking came from — because a full book and a full waiting room are different problems.',
  maxDays: 7,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'The patient’s own branch, which is where the appointment was booked in the pilot.' },
    { key: 'range', label: 'Period', value: 'The last 7 days', hint: 'A week is one turn of every consultant’s roster, so no consultant is compared against another’s week off.' },
    { key: 'doctor', label: 'Consultant', value: 'Every consultant with a chamber', hint: 'A no-show is a consultant’s empty chair, so the rate is reported per consultant and never only in total.' },
    { key: 'source', label: 'Source', value: 'Counter, phone, portal and follow-up', hint: 'A portal booking that no-shows is a reminder problem; a counter booking that no-shows is a travel problem.' },
    { key: 'noshow', label: 'No-show', value: 'Booked and not attended', hint: 'The rate is over the appointments that were due to be seen, so the ones still in the queue do not flatter it.' },
  ],
  schedule: 'Sent to every consultant and to the OPD manager every morning at 07:00 with that consultant’s own list.',
  owner: 'OPD manager',
  views: [
    { label: 'No-shows', hint: 'A consultant’s empty chair. Read with the source column: a portal booking that does not come is a reminder problem, a counter booking is a travel one.', keep: (r) => numeric(r.cells.noShow) > 0 },
    { label: 'Booked online', hint: 'What the portal and the phone brought in, against the counter — how a clinic grows without a second receptionist.', keep: (r) => numeric(r.cells.portal) > 0 },
  ],
  columns: [
    { key: 'doctor', header: 'Consultant', kind: 'text' },
    { key: 'booked', header: 'Booked', align: 'right', kind: 'count', width: '6rem' },
    { key: 'attended', header: 'Attended', align: 'right', kind: 'count', width: '7rem' },
    { key: 'noShow', header: 'No-show', align: 'right', kind: 'count', width: '7rem' },
    { key: 'cancelled', header: 'Cancelled', align: 'right', kind: 'count', width: '7rem' },
    { key: 'portal', header: 'Booked online', align: 'right', kind: 'count', width: '8rem' },
  ],
  rows: ({ days, branch }) => {
    const onRegister = patients;
    return DOCTORS.map((doctor) => {
      const list: Appointment[] = days
        .flatMap((d) => generateAppointments(d))
        .filter((a) => a.doctorId === doctor.id && branchOfMrn(a.patient.mrn) === branch && onRegister.some((p) => p.mrn === a.patient.mrn));
      return {
        id: doctor.id,
        label: doctor.name,
        cells: {
          doctor: `${doctor.name} — ${doctor.department}`,
          booked: list.length,
          attended: list.filter((a) => a.status === 'Completed' || a.status === 'In consultation').length,
          noShow: list.filter((a) => a.status === 'No show').length,
          cancelled: list.filter((a) => a.status === 'Cancelled').length,
          portal: list.filter((a) => a.source === 'Online portal').length,
        },
      };
    });
  },
  closing: ({ day, days }) => {
    const list = days.flatMap((d) => generateAppointments(d));
    const due = list.filter((a) => a.status !== 'Requested' && a.status !== 'Confirmed');
    const noShow = list.filter((a) => a.status === 'No show').length;
    const rate = due.length === 0 ? '0' : ((noShow / due.length) * 100).toFixed(1);
    const attended = list.filter((a) => a.status === 'Completed' || a.status === 'In consultation').length;
    const waiting = list.filter((a) => a.status === 'Requested' || a.status === 'Confirmed').length;
    const dayList = generateAppointments(day);
    return (
      `Booked ${dayList.length} = attended ${dayList.filter((a) => a.status === 'Completed' || a.status === 'In consultation').length} + no-show ${dayList.filter((a) => a.status === 'No show').length} + cancelled ${dayList.filter((a) => a.status === 'Cancelled').length} + still in the queue ${dayList.filter((a) => a.status === 'Requested' || a.status === 'Confirmed').length}. ` +
      `The no-show rate is ${rate} % of the ${due.length} appointments that were due to be seen, which excludes the ones still in the queue — a rate over every booking falls on the day the queue is longest. ` +
      `Over the ${days.length} day${days.length === 1 ? '' : 's'} read: ${attended} attended of ${list.length} booked, ${waiting} still waiting. ` +
      `A no-show is not one fact: a patient who never confirmed is a reminder problem and one who confirmed and did not travel is a different one, so the source column is read with this figure rather than after it.`
    );
  },
};

/* ============================================================================================== Clinical */

/** Out-patients: what was started, what was signed, and the notes carrying a diagnosis or not. */
const opdReport: ReportDef = {
  topic: 'opd',
  title: 'Out-patient consultations by department',
  legacy: '/admin/report/opd',
  group: 'Clinical',
  question: 'What was consulted, what is still open, and how much of it is documented — a signed note is a record, an unsigned one is a conversation.',
  maxDays: 7,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'Every branch runs out-patients; the records decide which branch a consultation belongs to.' },
    { key: 'range', label: 'Period', value: 'The last 7 days', hint: 'A clinical week smooths the Sunday rush without hiding a department that is always behind.' },
    { key: 'department', label: 'Department', value: 'Every department with a chamber', hint: 'Departments are read rather than consultants, because a chair can be covered and a department cannot.' },
    { key: 'signed', label: 'Signed notes', value: 'Signed by the clinician who wrote them', hint: 'A signed note takes addenda and never edits, which is why the signed count is the one that can be relied on.' },
    { key: 'coded', label: 'Diagnosis', value: 'ICD-10 code present', hint: 'A signed note without a code is clinically fine and epidemiologically useless, so it is counted here and not hidden in the clinical module.' },
  ],
  schedule: 'Sent to the medical superintendent and each department head every morning at 07:30, with the unsigned notes listed first.',
  owner: 'Medical superintendent',
  views: [
    { label: 'Notes still open', hint: 'A consultation that has started and not been signed: work in progress, and the list the clinical lead chases.', keep: (r) => numeric(r.cells.waiting) > 0 },
    { label: 'Medicine prescribed', hint: 'Departments whose consultations ended in a prescription, which is what the pharmacy fills.', keep: (r) => numeric(r.cells.prescriptions) > 0 },
  ],
  columns: [
    { key: 'department', header: 'Department', kind: 'text' },
    { key: 'consultations', header: 'Consultations', align: 'right', kind: 'count', width: '8rem' },
    { key: 'signed', header: 'Signed', align: 'right', kind: 'count', width: '6rem' },
    { key: 'waiting', header: 'Still open', align: 'right', kind: 'count', width: '7rem' },
    { key: 'prescriptions', header: 'Prescriptions', align: 'right', kind: 'count', width: '8rem' },
    { key: 'rxLines', header: 'Medicine lines', align: 'right', kind: 'count', width: '8rem' },
    { key: 'diagnosed', header: 'Coded diagnosis', align: 'right', kind: 'count', width: '9rem' },
  ],
  rows: ({ days, branch }) => {
    const byDept = new Map<string, Encounter[]>();
    for (const enc of days.flatMap((d) => generateEncounters(d)).filter((e) => branchOfMrn(e.patient.mrn) === branch)) {
      const department = doctorById(enc.doctorId)?.department ?? 'Unassigned';
      const list = byDept.get(department) ?? [];
      list.push(enc);
      byDept.set(department, list);
    }
    return [...byDept.entries()].map(([department, list]) => ({
      id: department,
      label: department,
      cells: {
        department,
        consultations: list.length,
        signed: list.filter((e) => e.status === 'Signed').length,
        waiting: list.filter((e) => e.status !== 'Signed').length,
        prescriptions: list.filter((e) => e.rx.length > 0).length,
        rxLines: list.reduce((n, e) => n + e.rx.length, 0),
        diagnosed: list.filter((e) => e.signedAt && e.diagnoses.length > 0).length,
      },
    }));
  },
  closing: ({ day }) => {
    const list = generateEncounters(day);
    const signed = list.filter((e) => e.status === 'Signed');
    const noDiagnosis = signed.filter((e) => e.diagnoses.length === 0);
    const vitals = list.filter((e) => Object.keys(e.vitals).length > 0).length;
    const prescriptions = list.filter((e) => e.rx.length > 0);
    return (
      `${list.length} encounters today, ${signed.length} signed and ${list.length - signed.length} still open. ` +
      `${noDiagnosis.length} signed note(s) carry no diagnosis — the clinical lead reads those first. ` +
      `A consultation is billed on the note, not on the room: an open note is work in progress and not work missing, which is why it is separated from the signed count rather than netted out. ` +
      `${vitals} encounter(s) have a full set of vitals recorded. ` +
      `${prescriptions.length} produced a prescription and ${prescriptions.reduce((n, e) => n + e.rx.length, 0)} medicine lines went to the pharmacy — the pharmacy’s own report reads those same lines from the other side, so a line missing there and present here is a queue, not a loss.`
    );
  },
};

/** In-patients: the board, per ward, counted against the beds a nurse can actually put a patient in. */
const ipdReport: ReportDef = {
  topic: 'ipd',
  title: 'In-patient occupancy by ward',
  legacy: '/admin/report/ipd',
  group: 'Clinical',
  question: 'How full each ward is, how many patients came and went, and whether the board a nurse reads agrees with the beds the ward has.',
  requires: 'In-patient',
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'In-patient beds exist at the main campus only, and the other branches say so rather than reporting zero.' },
    { key: 'range', label: 'Period', value: 'Today, with the week behind it', hint: 'Occupancy is a picture of a moment and admissions are a flow; the column headers say which is which.' },
    { key: 'ward', label: 'Ward', value: 'Every ward with beds', hint: 'A ward is the unit a nurse is accountable for, so the report never adds two wards into one figure.' },
    { key: 'service', label: 'Beds in service', value: 'Blocked beds excluded from occupancy', hint: 'A blocked bed is not a bed anybody can use, and counting it as one makes a full ward look half empty.' },
    { key: 'cleaning', label: 'Being cleaned', value: 'Counted as unavailable', hint: 'A nurse cannot put a patient in a bed that is still being cleaned, so it is not free space.' },
  ],
  schedule: 'Sent to the nursing superintendent, the duty medical officer and the admission desk every morning at 07:00 and every evening at 19:00.',
  owner: 'Nursing superintendent',
  maxDays: 7,
  views: [
    { label: 'Blocked beds', hint: 'A blocked bed is not a bed: the ward’s capacity and its occupancy are both counted without it.', keep: (r) => numeric(r.cells.blocked) > 0 },
    { label: 'Beds still free', hint: 'Where the admission desk can put a patient right now.', keep: (r) => numeric(r.cells.free) > 0 },
  ],
  columns: [
    { key: 'ward', header: 'Ward', kind: 'text' },
    { key: 'beds', header: 'Beds in service', align: 'right', kind: 'count', width: '8rem' },
    { key: 'blocked', header: 'Blocked', align: 'right', kind: 'count', width: '6rem' },
    { key: 'occupied', header: 'Occupied', align: 'right', kind: 'count', width: '7rem' },
    { key: 'free', header: 'Free', align: 'right', kind: 'count', width: '5rem' },
    { key: 'admissions', header: 'Admissions (days read)', align: 'right', kind: 'count', width: '10rem' },
    { key: 'discharges', header: 'Discharges', align: 'right', kind: 'count' },
    { key: 'occupancyPct', header: 'Occupancy %', align: 'right', kind: 'percent', percentOf: { part: 'occupied', whole: 'beds' }, width: '7rem' },
  ],
  rows: ({ day, days, branch }) => {
    if (branch !== 'Main Campus') return [];
    const board = generateInpatient(day);
    return board.wards.map((ward) => {
      const all = board.beds.filter((b) => b.wardId === ward.id);
      const blocked = all.filter((b) => b.status === 'Blocked').length;
      const beds = all.length - blocked;
      const occupied = all.filter((b) => b.status === 'Occupied').length;
      return {
        id: ward.id,
        label: ward.name,
        cells: {
          ward: ward.name,
          beds,
          blocked,
          occupied,
          free: all.filter((b) => b.status === 'Free').length,
          admissions: days.reduce((n, d) => n + generateInpatient(d).admissions.filter((a) => a.wardId === ward.id).length, 0),
          discharges: days.reduce((n, d) => n + generateInpatient(d).discharges.filter((x) => x.wardId === ward.id).length, 0),
          occupancyPct: Math.round((occupied / Math.max(1, beds)) * 100),
        },
      };
    });
  },
  closing: ({ day }) => {
    const board = generateInpatient(day);
    const counts = occupancy(board.beds);
    const beds = board.beds as Bed[];
    const blocked = beds.filter((b) => b.status === 'Blocked').length;
    return (
      `The board at ${board.now}: ${beds.length} beds, ${blocked} blocked and ${beds.length - blocked} in service. In service: ` +
      `${beds.filter((b) => b.status === 'Occupied').length} occupied + ${beds.filter((b) => b.status === 'Free').length} free + ` +
      `${beds.filter((b) => b.status === 'Cleaning').length} being cleaned + ${beds.filter((b) => b.status === 'Reserved').length} reserved. ` +
      `Occupancy of ${counts.percent} % is counted against the beds in service, because a blocked bed is not a bed a patient can be moved into — and a bed being cleaned is counted as unavailable, since a nurse cannot put a patient in that one either.`
    );
  },
};

/* ============================================================================================ Support services */

/** Pharmacy: what left the shelf, at what margin, and what is about to expire. */
const pharmacyReport: ReportDef = {
  topic: 'pharmacy',
  title: 'Pharmacy sales and stock',
  legacy: '/admin/report/pharmacy',
  group: 'Support services',
  question: 'What was dispensed, at what margin, and which batches went out — read from the dispensary rather than from a till roll.',
  maxDays: 30,
  requires: 'Pharmacy',
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'A dispense follows the patient’s own pharmacy: a prescription written at Mirpur is dispensed at Mirpur.' },
    { key: 'range', label: 'Period', value: 'The last 7 days', hint: 'Dispensing is steady enough that a week is the shortest period a margin is worth reading.' },
    { key: 'class', label: 'Medicine class', value: 'Every class', hint: 'A class is how the store buys and how the drug office reads consumption.' },
    { key: 'margin', label: 'Margin', value: 'Charged less cost, per line', hint: 'Cost is the store’s last purchase price for the same item, so a price list change shows up here first.' },
    { key: 'expiry', label: 'Expiry window', value: `${EXPIRY_WARN_DAYS} days`, hint: 'Batches inside the window are counted, not written off: the store decides whether they can be used first.' },
  ],
  schedule: 'Sent to the chief pharmacist and the finance manager every morning at 08:00; the expiry column also goes out on Mondays, when the store plans its fortnight.',
  owner: 'Chief pharmacist',
  views: [
    { label: 'Expiring in the window', hint: 'Batches inside the warning window, counted rather than written off: the store has a fortnight to use them.', keep: (r) => numeric(r.cells.expiring) > 0 },
  ],
  columns: [
    { key: 'klass', header: 'Medicine class', kind: 'text' },
    { key: 'dispenses', header: 'Dispenses touching this class', align: 'right', kind: 'count', width: '11rem' },
    { key: 'lines', header: 'Lines', align: 'right', kind: 'count', width: '6rem' },
    { key: 'qty', header: 'Quantity', align: 'right', kind: 'count', width: '7rem' },
    { key: 'charged', header: 'Charged', align: 'right', kind: 'money', width: '9rem' },
    { key: 'cost', header: 'Cost', align: 'right', kind: 'money', width: '9rem' },
    { key: 'margin', header: 'Margin', align: 'right', kind: 'money', width: '9rem' },
    { key: 'controlled', header: 'Controlled lines', align: 'right', kind: 'count', width: '9rem' },
    { key: 'expiring', header: `Batches in the ${EXPIRY_WARN_DAYS}-day window`, align: 'right', kind: 'count', width: '10rem' },
  ],
  rows: ({ day, days, branch }) => {
    const items = inventoryItems(day);
    const lastCost = (drugId: string) => items.find((i) => i.id === drugId)?.lastCost ?? 0;
    const tally = new Map<string, { klass: string; dispenses: number; lines: number; qty: number; charged: number; cost: number; controlled: number; expiring: number }>();
    const of = (klass: string) => {
      const row = tally.get(klass) ?? { klass, dispenses: 0, lines: 0, qty: 0, charged: 0, cost: 0, controlled: 0, expiring: 0 };
      tally.set(klass, row);
      return row;
    };

    const dispenses = days.flatMap((d) => generateDispenses(d, generateBatches(d))).filter((x) => branchOfMrn(x.patient.mrn) === branch);
    for (const dispense of dispenses) {
      const touched = new Set<string>();
      for (const line of dispense.lines) {
        const row = of(line.drug.klass);
        row.lines += 1;
        row.qty += line.qty;
        row.charged += line.drug.price * line.qty;
        row.cost += lastCost(line.drug.id) * line.qty;
        if (line.drug.controlled) row.controlled += 1;
        touched.add(line.drug.klass);
      }
      for (const klass of touched) of(klass).dispenses += 1;
    }

    for (const batch of generateBatches(day)) {
      if (daysToExpiry(batch.expiry, day) > EXPIRY_WARN_DAYS) continue;
      const klass = drugById(batch.drugId)?.klass;
      if (klass && tally.has(klass)) of(klass).expiring += 1;
    }

    return [...tally.values()]
      .sort((a, b) => b.charged - a.charged)
      .map((row) => ({
        id: row.klass,
        label: row.klass,
        cells: {
          klass: row.klass,
          dispenses: row.dispenses,
          lines: row.lines,
          qty: row.qty,
          charged: row.charged,
          cost: row.cost,
          margin: row.charged - row.cost,
          controlled: row.controlled,
          expiring: row.expiring,
        },
      }));
  },
  closing: ({ day, days }) => {
    const dispenses = days.flatMap((d) => generateDispenses(d, generateBatches(d)));
    const lines = dispenses.flatMap((d) => d.lines);
    const charged = lines.reduce((n, l) => n + l.drug.price * l.qty, 0);
    const items = inventoryItems(day);
    const cost = lines.reduce((n, l) => n + (items.find((i) => i.id === l.drug.id)?.lastCost ?? 0) * l.qty, 0);
    const batches = generateInventory(day).batches;
    const onHand = stockValue(batches);
    const expiring = expiringBatches(batches, day);
    const expiringValue = expiring.reduce((n, b) => n + b.qty * b.unitCost, 0);
    const controlled = lines.filter((l) => l.drug.controlled).length;
    const payerLines = dispenses.filter((d) => d.patient.payer !== 'Self pay').flatMap((d) => d.lines).length;
    const touchedPerRow = [...new Set(dispenses.flatMap((d) => d.lines.map((l) => l.drug.klass)))].length;
    return (
      `${dispenses.length} dispensing event${dispenses.length === 1 ? '' : 's'} over ${days.length} day${days.length === 1 ? '' : 's'}, ${lines.length} lines charged ${money(charged)} against ${money(cost)} of stock — a margin of ${money(charged - cost)}, and it is a shelf margin rather than a cash one: ${payerLines} of those lines went out on a payer account and are money receivable, not money taken. ` +
      `A dispense that touched more than one class appears under each of them, which is why the class column adds to more than the number of events — ${touchedPerRow} classes were touched in all. ` +
      `Stock on hand ${money(onHand)}, of which ${money(expiringValue)} sits in ${expiring.length} batch${expiring.length === 1 ? '' : 'es'} inside the ${EXPIRY_WARN_DAYS}-day window and ${money(batches.filter((b) => b.store !== 'Main store').reduce((n, b) => n + b.qty * b.unitCost, 0))} is already issued out to a ward or theatre store, where the money has been spent and the use has not yet been recorded. ` +
      `${controlled} controlled line${controlled === 1 ? '' : 's'} need a second signature — the drug office reads that register, not this table.`
    );
  },
};

/** Pathology: ordered, collected, resulted, rejected — and the turnaround against the promise. */
const pathologyReport: ReportDef = {
  topic: 'pathology',
  title: 'Pathology workload',
  legacy: '/admin/report/pathology',
  group: 'Clinical',
  question: 'Ordered, collected, resulted, rejected and called back, with the turnaround against the lab’s own promise.',
  requires: 'Diagnostics',
  maxDays: 7,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'The order belongs to the branch that took the sample.' },
    { key: 'range', label: 'Period', value: 'The last 7 days', hint: 'A test ordered on Friday and resulted on Monday belongs to both; the period read is named above.' },
    { key: 'test', label: 'Test', value: 'Every test in the catalogue', hint: 'One row per test, because a lab manages its analysers and its staff by test.' },
    { key: 'turnaround', label: 'Turnaround', value: 'Ordered to resulted, in minutes', hint: 'The clock starts when the clinician ordered it, not when the specimen reached the bench — a porter’s delay is a laboratory result arriving late.' },
    { key: 'callbacks', label: 'Critical results', value: 'Every result the clinician must be told about', hint: 'A critical value is rung through and recorded; a callback in this column that has no corresponding note is the finding.' },
  ],
  schedule: 'Sent to the consultant pathologist and the laboratory manager every morning at 07:30, with the critical-value callbacks listed first.',
  owner: 'Consultant pathologist',
  views: [
    { label: 'Awaiting a result', hint: 'Ordered, sample taken, nothing back yet — the worklist the laboratory manager starts the day from.', keep: (r) => numeric(r.cells.awaiting) > 0 },
    { label: 'Critical callbacks', hint: 'A value the clinician must be told about. The call is recorded against the person who made it.', keep: (r) => numeric(r.cells.callbacks) > 0 },
    { label: 'Rejected samples', hint: 'A rejected sample is a second needle for the patient, so it is counted rather than quietly re-ordered.', keep: (r) => numeric(r.cells.rejected) > 0 },
  ],
  columns: [
    { key: 'test', header: 'Test', kind: 'text' },
    { key: 'ordered', header: 'Ordered', align: 'right', kind: 'count', width: '6rem' },
    { key: 'collected', header: 'Collected', align: 'right', kind: 'count', width: '7rem' },
    { key: 'resulted', header: 'Resulted', align: 'right', kind: 'count', width: '7rem' },
    { key: 'rejected', header: 'Rejected', align: 'right', kind: 'count', width: '7rem' },
    { key: 'callbacks', header: 'Critical', align: 'right', kind: 'count', width: '6rem' },
    { key: 'awaiting', header: 'Awaiting', align: 'right', kind: 'count', width: '6rem' },
    { key: 'oldestMin', header: 'Oldest waiting (min)', align: 'right', kind: 'count', aggregate: 'max', width: '9rem' },
    {
      key: 'avgTat',
      header: 'Turnaround',
      align: 'right',
      kind: 'count',
      width: '8rem',
      /* An average of averages is the commonest wrong number on a laboratory report: the consolidated figure is the
         pooled minutes over the pooled tests, not the mean of two branches' means. */
      avgOf: { total: 'tatMin', count: 'resulted', suffix: ' min' },
    },
    { key: 'onTime', header: 'Within the promise', align: 'right', kind: 'count', width: '9rem' },
  ],
  rows: ({ days, branch }) => {
    const orders = days
      .flatMap((d) => generateDiagnosticOrders(d))
      .filter((o) => o.kind === 'lab' && branchOfMrn(o.patient.mrn) === branch);

    const byTest = new Map<string, { name: string; ordered: number; collected: number; resulted: number; rejected: number; callbacks: number; tatMin: number; onTime: number; awaiting: number; oldestMin: number }>();
    for (const order of orders) {
      const row = byTest.get(order.testCode) ?? { name: order.testName, ordered: 0, collected: 0, resulted: 0, rejected: 0, callbacks: 0, tatMin: 0, onTime: 0, awaiting: 0, oldestMin: 0 };
      byTest.set(order.testCode, row);
      row.ordered += 1;
      if (order.collectedAt) row.collected += 1;
      if (order.status === 'Rejected') row.rejected += 1;
      if (order.resultedAt) {
        row.resulted += 1;
        row.tatMin += minutesBetweenStamps(order.orderedAt, order.resultedAt) ?? 0;
        if ((stamp(order.resultedAt) ?? 0) <= (stamp(order.dueAt) ?? 0)) row.onTime += 1;
      } else {
        row.awaiting += 1;
        row.oldestMin = Math.max(row.oldestMin, elapsedTo(order, days[days.length - 1]));
      }
      if (needsCallback(order)) row.callbacks += 1;
    }

    return [...byTest.entries()]
      .sort((a, b) => b[1].ordered - a[1].ordered)
      .map(([code, row]) => ({
        id: code,
        label: row.name,
        cells: {
          test: `${code} — ${row.name}`,
          ordered: row.ordered,
          collected: row.collected,
          resulted: row.resulted,
          rejected: row.rejected,
          callbacks: row.callbacks,
          awaiting: row.awaiting,
          oldestMin: row.oldestMin,
          tatMin: row.tatMin,
          avgTat: row.resulted === 0 ? 0 : Math.round(row.tatMin / row.resulted),
          onTime: row.onTime,
        },
      }));
  },
  closing: ({ day, days }) => {
    const orders = days.flatMap((d) => generateDiagnosticOrders(d)).filter((o) => o.kind === 'lab');
    const resulted = orders.filter((o) => o.resultedAt);
    const late = resulted.filter((o) => (stamp(o.resultedAt) ?? 0) > (stamp(o.dueAt) ?? 0));
    const rejected = orders.filter((o) => o.status === 'Rejected');
    const qc = generateQc(day);
    const failed = qc.filter((r) => !r.passed);
    const callbacks = orders.filter((o) => needsCallback(o));
    return (
      `${orders.length} laboratory orders over the ${days.length} day${days.length === 1 ? '' : 's'} read: ${resulted.length} resulted and ${Math.max(0, orders.length - resulted.length - rejected.length)} still on the worklist. ` +
      `${late.length} went out after their promised time, which is the number the ward feels even when the test itself was done quickly. ` +
      `${rejected.length} sample${rejected.length === 1 ? '' : 's'} were rejected — a rejected sample is a second needle for the patient, so it is counted rather than quietly re-ordered. ` +
      `Quality control for ${day}: ${qc.length} run${qc.length === 1 ? '' : 's'}, ${failed.length} outside its limit${failed.length === 0 ? ' — the analysers are in control' : ` (${failed.map((f) => f.analyte).join(', ')})`}. ` +
      `${callbacks.length} result${callbacks.length === 1 ? '' : 's'} carry a value the clinician must be told about: the callback is the half of the report a patient’s safety depends on, and it is recorded against the person who made the call.`
    );
  },
};

/** Radiology: the same shape as pathology, measured against the report rather than the result. */
const radiologyReport: ReportDef = {
  topic: 'radiology',
  title: 'Radiology workload',
  legacy: '/admin/report/radiology',
  group: 'Clinical',
  question: 'Studies by modality, the reporting turnaround, and the studies nobody has reported yet.',
  requires: 'Diagnostics',
  caveat:
    'In this preview no imaging study ever carries a report: the generator that raises the orders marks a study collected only when it has a specimen, and an X-ray has none, so every study sits at “Ordered” and the awaiting column is the whole table. That is a gap in the preview’s data rather than in this report — the same list is on the diagnostics worklist — and a report that pretended otherwise would be the one screen in the product that disagreed with the worklist behind it.',
  maxDays: 7,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'An X-ray is taken where the patient is; the report may be written at another branch.' },
    { key: 'range', label: 'Period', value: 'The last 7 days', hint: 'The period read is named above; a study ordered today is not yet late.' },
    { key: 'modality', label: 'Modality', value: 'X-ray, Ultrasound and ECG', hint: 'Each modality has its own machine, its own reporter and its own turnaround.' },
    { key: 'unreported', label: 'Awaiting report', value: 'Every study not yet reported', hint: 'The column the radiology manager works from: a film in the archive with no report is an image nobody has read.' },
    { key: 'turnaround', label: 'Turnaround', value: 'Ordered to resulted, in minutes', hint: 'Measured from the order, so a delay before the patient reached the room is inside the figure rather than outside it.' },
  ],
  schedule: 'Sent to the radiologist and the OPD manager every morning at 07:30, and again at 16:00 with the studies still awaiting a report.',
  owner: 'Consultant radiologist',
  views: [
    { label: 'Awaiting a report', hint: 'A film nobody has read. It sits in the same list as the reported ones, which is why the report prints it rather than hiding it.', keep: (r) => numeric(r.cells.awaiting) > 0 },
  ],
  columns: [
    { key: 'modality', header: 'Modality', kind: 'text' },
    { key: 'ordered', header: 'Ordered', align: 'right', kind: 'count', width: '6rem' },
    { key: 'reported', header: 'Reported', align: 'right', kind: 'count', width: '7rem' },
    { key: 'awaiting', header: 'Awaiting report', align: 'right', kind: 'count', width: '9rem' },
    { key: 'oldestMin', header: 'Oldest waiting (min)', align: 'right', kind: 'count', aggregate: 'max', width: '9rem' },
    { key: 'rejected', header: 'Rejected', align: 'right', kind: 'count', width: '7rem' },
    { key: 'avgReport', header: 'Order to report', align: 'right', kind: 'count', width: '9rem', avgOf: { total: 'minutes', count: 'reported', suffix: ' min' } },
    { key: 'onTime', header: 'Within the promise', align: 'right', kind: 'count', width: '9rem' },
  ],
  rows: ({ days, branch }) => {
    const studies = days
      .flatMap((d) => generateDiagnosticOrders(d))
      .filter((o) => o.kind === 'imaging' && branchOfMrn(o.patient.mrn) === branch);

    const byModality = new Map<string, { ordered: number; reported: number; awaiting: number; rejected: number; minutes: number; onTime: number; oldestMin: number }>();
    for (const study of studies) {
      const modality = study.modality ?? 'Unassigned';
      const row = byModality.get(modality) ?? { ordered: 0, reported: 0, awaiting: 0, rejected: 0, minutes: 0, onTime: 0, oldestMin: 0 };
      byModality.set(modality, row);
      row.ordered += 1;
      if (study.resultedAt) {
        row.reported += 1;
        row.minutes += minutesBetweenStamps(study.orderedAt, study.resultedAt) ?? 0;
        if ((stamp(study.resultedAt) ?? 0) <= (stamp(study.dueAt) ?? 0)) row.onTime += 1;
      } else {
        row.awaiting += 1;
        row.oldestMin = Math.max(row.oldestMin, elapsedTo(study, days[days.length - 1]));
      }
      if (study.status === 'Rejected') row.rejected += 1;
    }

    return [...byModality.entries()].map(([modality, row]) => ({
      id: modality,
      label: modality,
      cells: {
        modality,
        ordered: row.ordered,
        reported: row.reported,
        awaiting: row.awaiting,
        oldestMin: row.oldestMin,
        rejected: row.rejected,
        minutes: row.minutes,
        avgReport: row.reported === 0 ? 0 : Math.round(row.minutes / row.reported),
        onTime: row.onTime,
      },
    }));
  },
  closing: ({ day, days }) => {
    const studies = days.flatMap((d) => generateDiagnosticOrders(d)).filter((o) => o.kind === 'imaging');
    const awaiting = studies.filter((s) => !s.resultedAt);
    const oldest = awaiting
      .map((s) => ({ s, minutes: elapsedTo(s, days[days.length - 1]) }))
      .sort((a, b) => b.minutes - a.minutes)[0];
    return (
      `${studies.length} imaging studies over the ${days.length} day${days.length === 1 ? '' : 's'} read. ` +
      (studies.length === 0
        ? 'None were ordered at all in these days, which is a fact about the period rather than a missing report.'
        : `${studies.length - awaiting.length} carry a report and ${awaiting.length} do not${
            oldest ? ` — the oldest has been waiting since ${oldest.s.orderedAt}, about ${Math.round(oldest.minutes / 60)} hour${Math.round(oldest.minutes / 60) === 1 ? '' : 's'}` : ''
          }. An unreported study is not a delay in a queue: it is a film nobody has read, and it sits in the same list as the reported ones. `) +
      `The turnaround is measured order to report, so the porter’s wait and the patient’s wait are inside the figure. EQAS and machine quality control belong to the laboratory’s report: an X-ray has no sample to control, and inventing one here would be worse than the blank.`
    );
  },
};

/** Blood bank — one fridge, one register, one set of cross-matches. */
const bloodBankReport: ReportDef = {
  topic: 'blood_bank',
  title: 'Blood bank',
  legacy: '/admin/report/blood_bank',
  group: 'Support services',
  question: 'Units by group and component, what was issued, what was discarded, and why.',
  requires: 'Blood bank',
  cannotReport: (branch) => SITE_BOUND('blood bank', branch),
  maxDays: 1,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'The bank is one site’s register; a satellite’s own bank is its own set of records.' },
    { key: 'range', label: 'Period', value: 'Today, with the shelf as it stands', hint: 'A bank is read as a stock on a day: units on the shelf are a picture, issued and discarded units are a flow.' },
    { key: 'component', label: 'Component', value: 'Whole blood, PRBC, FFP, platelets, cryo', hint: 'Components have different shelf lives, different floors and different prices, so they are never totalled together.' },
    { key: 'group', label: 'Group', value: 'Every group in the register', hint: 'O negative is kept for the patient nobody has grouped yet, which is why it runs low.' },
    { key: 'floor', label: 'Low-stock floor', value: 'Per component, from the bank’s own rules', hint: 'A group below its floor is a call to the donor list, not a rounding error.' },
  ],
  schedule: 'Sent to the blood bank in-charge and the duty medical officer at 07:00, and again at 18:00; a group below its floor raises a message as soon as the count is taken.',
  owner: 'Blood bank in-charge',
  views: [
    { label: 'Below the floor', hint: 'A group and component under its own minimum: a call to the donor list rather than a rounding error.', keep: (r) => String(r.cells.rule).startsWith('Below') },
  ],
  columns: [
    { key: 'unit', header: 'Group and component', kind: 'text' },
    { key: 'units', header: 'On the shelf', align: 'right', kind: 'count', width: '8rem' },
    { key: 'reserved', header: 'Held for a patient', align: 'right', kind: 'count', width: '9rem' },
    { key: 'issued', header: 'Issued', align: 'right', kind: 'count', width: '7rem' },
    { key: 'transfused', header: 'Transfused', align: 'right', kind: 'count', width: '8rem' },
    { key: 'discarded', header: 'Discarded', align: 'right', kind: 'count', width: '7rem' },
    { key: 'expiring', header: `Expiring in ${EXPIRY_WARN_DAYS} days`, align: 'right', kind: 'count', width: '9rem' },
    { key: 'rule', header: 'Against the floor', kind: 'text', width: '13rem' },
  ],
  rows: ({ day, branch }) => {
    if (!LEDGER_NODES.includes(branch)) return [];
    const bank = bloodBankDay(day);
    const count = (state: string, group: string, component: string) =>
      bank.units.filter((u) => u.state === state && u.group === group && u.component === component).length;

    return bank.stock.map((line) => ({
      id: `${line.group}-${line.component}`,
      label: `${line.group} ${COMPONENT_LABEL[line.component]}`,
      cells: {
        unit: `${line.group} ${COMPONENT_LABEL[line.component]}`,
        units: line.units,
        reserved: count('Reserved', line.group, line.component),
        issued: count('Issued', line.group, line.component),
        transfused: bank.transfused.filter((u) => u.group === line.group && u.component === line.component).length,
        discarded: bank.discarded.filter((u) => u.group === line.group && u.component === line.component).length,
        expiring: line.expiring,
        rule: line.low ? 'Below the floor — call the donor list' : 'Above the floor',
      },
    }));
  },
  closing: ({ day }) => {
    const bank = bloodBankDay(day);
    const short = shortGroups(bank, 'PRBC');
    const oldest = [...bank.units].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
    const reason = bank.discarded[0]?.note ?? '';
    return (
      `The shelf at ${day}: ${bank.stats.unitsOnShelf} units, ${bank.stats.available} available and ${bank.stats.reserved} cross-matched and held for a named patient. ` +
      `Today the bank took ${bank.stats.donationsToday} donation${bank.stats.donationsToday === 1 ? '' : 's'} from ${bank.stats.donorsToday} donor${bank.stats.donorsToday === 1 ? '' : 's'} who attended, issued ${bank.stats.unitsIssuedToday} and transfused ${bank.stats.unitsTransfusedToday}. ` +
      `Cross-match to issue took about ${bank.stats.crossmatchToIssueMinutes} minutes. ` +
      `Discard rate ${bank.stats.discardRate} % — a unit is discarded for a reason that is written down${reason ? `, and today’s was: ${reason}` : ''}, because a bank that discards quietly stops ordering enough. ` +
      (short.length > 0 ? `PRBC is below its floor for ${short.join(', ')}. ` : '') +
      (oldest ? `The next unit to expire is ${oldest.bag} on ${oldest.expiresOn}. ` : '') +
      (bank.stats.reactions > 0
        ? `${bank.stats.reactions} transfusion reaction(s) recorded today — each one suspends the unit’s group from issue until the reference laboratory reports.`
        : 'No transfusion reaction was recorded today.')
    );
  },
};

/** Ambulance fleet — one fleet, one duty roster of drivers. */
const ambulanceReport: ReportDef = {
  topic: 'ambulance',
  title: 'Ambulance fleet',
  legacy: '/admin/report/ambulance',
  group: 'Support services',
  question: 'Calls by vehicle and priority, response minutes against the target, and the fares a trip earns.',
  requires: 'Ambulance',
  cannotReport: (branch) => SITE_BOUND('ambulance fleet', branch),
  maxDays: 1,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'One fleet, one set of vehicles: a satellite’s vans are its own register.' },
    { key: 'range', label: 'Period', value: 'Today', hint: 'Response times are read a shift at a time; a week flattens the night the van was out of service.' },
    { key: 'priority', label: 'Priority', value: 'P1, P2 and booked runs', hint: 'A booked discharge run is measured against the promised time, not against an emergency target.' },
    { key: 'target', label: 'Response target', value: 'P1 in 8 minutes, P2 in 20', hint: 'The clock starts when the call is received and stops when the vehicle is on scene, so the traffic is inside the figure.' },
    { key: 'fare', label: 'Fare', value: 'The tariff for the vehicle and the distance', hint: 'A mortuary run is charged to the family and never counted as an emergency response.' },
  ],
  schedule: 'Sent to the transport officer every morning at 08:00; a response past its target is messaged to the duty manager when the shift is handed over.',
  owner: 'Transport officer',
  views: [
    { label: 'Missed the target', hint: 'A response past the time the priority promised, with the reason recorded rather than an excuse offered.', keep: (r) => numeric(r.cells.missed) > 0 },
    { label: 'Below the oxygen floor', hint: 'A van that can still transfer a stable patient and cannot take a breathless one — why the state is reported rather than the count.', keep: (r) => String(r.cells.oxygen).includes('below') },
    { label: 'Not yet assigned', hint: 'A call waiting for a vehicle: the one row that would otherwise be missing from the day’s total.', keep: (r) => String(r.cells.vehicle).startsWith('Not yet assigned') },
  ],
  columns: [
    { key: 'vehicle', header: 'Vehicle', kind: 'text' },
    { key: 'calls', header: 'Calls', align: 'right', kind: 'count', width: '6rem' },
    { key: 'emergencies', header: 'Emergency', align: 'right', kind: 'count', width: '7rem' },
    { key: 'completed', header: 'Completed', align: 'right', kind: 'count', width: '7rem' },
    { key: 'moving', header: 'Out now', align: 'right', kind: 'count', width: '6rem' },
    { key: 'avgResponse', header: 'Response', align: 'right', kind: 'count', width: '7rem', avgOf: { total: 'minutes', count: 'responded', suffix: ' min', round: 1 } },
    { key: 'missed', header: 'Missed the target', align: 'right', kind: 'count', width: '9rem' },
    { key: 'km', header: 'Kilometres', align: 'right', kind: 'count', width: '7rem' },
    { key: 'fare', header: 'Fares raised', align: 'right', kind: 'money', width: '9rem' },
    { key: 'oxygen', header: 'Oxygen', kind: 'text', width: '9rem' },
  ],
  rows: ({ day, branch }) => {
    if (!LEDGER_NODES.includes(branch)) return [];
    const fleet = ambulanceDay(day);
    const rowFor = (id: string, vehicle: string, calls: typeof fleet.calls) => {
      /* Averaged over completed runs, which is the population the fleet screen averages too: a call still on its way
         has no response time yet, and including a partial one would make this report and that screen disagree about
         the same shift. */
      const measured = calls.filter((c) => c.state === 'Completed').map((c) => responseMinutes(c)).filter((m): m is number => m !== null);
      const minutes = measured.reduce((n, m) => n + m, 0);
      return {
        id,
        label: vehicle,
        cells: {
          vehicle,
          calls: calls.length,
          emergencies: calls.filter((c) => c.kind === 'Emergency').length,
          completed: calls.filter((c) => c.state === 'Completed').length,
          moving: calls.filter((c) => c.state === 'Dispatched' || c.state === 'On scene' || c.state === 'Conveying').length,
          minutes,
          responded: measured.length,
          avgResponse: measured.length === 0 ? 0 : Math.round((minutes / measured.length) * 10) / 10,
          missed: calls.filter((c) => responseVerdict(c).verdict === 'missed').length,
          km: calls.reduce((n, c) => n + (c.fare?.km ?? 0), 0),
          fare: calls.reduce((n, c) => n + (c.fare?.total ?? 0), 0),
          oxygen: '',
        },
      };
    };

    const rows = fleet.vehicles.map((vehicle) => {
      const row = rowFor(vehicle.id, `${vehicle.plate} — ${vehicle.kind}`, fleet.calls.filter((c) => c.vehicleId === vehicle.id));
      row.cells.oxygen = `${vehicle.oxygenPct} %${vehicle.oxygenPct <= OXYGEN_FLOOR_PCT ? ' — below the floor' : ''}`;
      return row;
    });

    /* A call waiting for a vehicle has no vehicle on it yet. Without this row the day's calls would not add up to
       the vehicles' calls, and the report would quietly drop the one call nobody had answered. */
    const unassigned = fleet.calls.filter((c) => !c.vehicleId || !fleet.vehicles.some((v) => v.id === c.vehicleId));
    if (unassigned.length > 0) {
      const row = rowFor('unassigned', 'Not yet assigned to a vehicle', unassigned);
      row.cells.oxygen = 'n/a';
      rows.push(row);
    }
    return rows;
  },
  closing: ({ day }) => {
    const fleet = ambulanceDay(day);
    const state = fleet.stats;
    return (
      `${state.callsToday} call${state.callsToday === 1 ? '' : 's'} today: ${state.emergencies} emergency, ${state.running} still running, ${state.waiting} waiting for a vehicle and ${state.completed} completed. ` +
      (state.averageResponse === null
        ? 'Nothing was measured, because no vehicle has reached its scene yet. '
        : `Over the ${fleet.calls.filter((c) => c.state === 'Completed').length} completed run(s) the average response was ${state.averageResponse} minutes with the worst at ${state.worstResponse}; ${state.targetsMet} emergency call(s) met the target and ${state.targetsMissed} did not. A call still on its way is not in that average — it has no response time yet — and it is shown in the “out now” column until it has one. `) +
      `${state.freeVehicles} vehicle${state.freeVehicles === 1 ? '' : 's'} free, ${state.outOfService} out of service and ${state.lowOxygen} below the oxygen floor — a van under the floor can still transfer a stable patient and cannot take a breathless one, which is why the state is reported rather than the count. ` +
      `${money(state.fareToday)} of fares were raised today and ${state.unbilled} trip(s) went unbilled. ` +
      (state.missedReasons.length > 0
        ? `Every miss carries its reason, and they read as operations rather than excuses: ${state.missedReasons.map((r) => r.text).join(' ')}`
        : 'No call missed its target.')
    );
  },
};

/** Inventory — the store ledger, which is a different book from the dispensary. */
const inventoryReport: ReportDef = {
  topic: 'inventory',
  title: 'Inventory and consumption',
  legacy: '/admin/report/inventory',
  group: 'Support services',
  question: 'What was bought, what was consumed and what expired on the shelf, against the store ledger.',
  cannotReport: (branch) => SITE_BOUND('store ledger', branch),
  maxDays: 1,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'The store ledger is one site’s: a branch keeps its own stores and its own counts.' },
    { key: 'range', label: 'Period', value: 'As the shelf stands, with today’s movements', hint: 'Stock is a picture; the movements behind it are the flow, and the two are shown together so a closed store cannot hide a shortage.' },
    { key: 'store', label: 'Store', value: 'Main, OPD, theatre, ward and laboratory stores', hint: 'A ward store is where an item is spent; the main store is where it is bought, and the difference is a transfer rather than a purchase.' },
    { key: 'value', label: 'Value', value: 'Quantity × the batch’s own purchase price', hint: 'A batch is valued at what it cost, never at what it would cost to replace: a replacement price makes a shortage look like a windfall.' },
    { key: 'variance', label: 'Count tolerance', value: `${STOCK_VARIANCE_PCT} % or ${STOCK_VARIANCE_UNITS} units, whichever is larger`, hint: 'A variance inside the tolerance is recorded and not chased; outside it, somebody signs for the difference.' },
  ],
  schedule: 'Sent to the store keeper, the finance manager and the medical superintendent every Monday at 08:00, with the expiring batches attached.',
  owner: 'Store keeper',
  views: [
    { label: 'Below the reorder level', hint: 'Where a purchase order is raised from, with the lead time already allowed for.', keep: (r) => numeric(r.cells.reorder) > 0 },
    { label: 'Expiring stock', hint: 'Stock inside the expiry window, valued at what it cost — use it or lose it, and the store keeps the list.', keep: (r) => numeric(r.cells.expiring) > 0 },
    { label: 'Count differences', hint: 'Stores where the hand count did not match the system. Beyond the tolerance, somebody signs for the difference.', keep: (r) => numeric(r.cells.variance) > 0 },
  ],
  columns: [
    { key: 'store', header: 'Store', kind: 'text' },
    { key: 'items', header: 'Items', align: 'right', kind: 'count', width: '6rem' },
    { key: 'batches', header: 'Batches', align: 'right', kind: 'count', width: '6rem' },
    { key: 'value', header: 'Value on hand', align: 'right', kind: 'money', width: '9rem' },
    { key: 'expiring', header: 'Expiring batches', align: 'right', kind: 'count', width: '9rem' },
    { key: 'expiringValue', header: 'Value expiring', align: 'right', kind: 'money', width: '9rem' },
    { key: 'quarantined', header: 'Expired, not yet destroyed', align: 'right', kind: 'count', width: '10rem' },
    { key: 'reorder', header: 'Below the reorder level', align: 'right', kind: 'count', width: '10rem' },
    { key: 'variance', header: 'Count difference (units)', align: 'right', kind: 'count', width: '10rem' },
  ],
  rows: ({ day, branch }) => {
    if (!LEDGER_NODES.includes(branch)) return [];
    const store = generateInventory(day);
    const variance = new Map<string, number>();
    for (const count of store.stockTake) {
      const item = store.items.find((i) => i.id === count.itemId);
      if (!item) continue;
      variance.set(item.store, (variance.get(item.store) ?? 0) + Math.abs((count.countedQty ?? count.systemQty) - count.systemQty));
    }

    return STORES.map((name) => {
      const items = store.items.filter((i) => i.store === name);
      const batches = store.batches.filter((b) => b.store === name);
      const expiring = expiringBatches(batches, day);
      return {
        id: name,
        label: name,
        cells: {
          store: name,
          items: items.length,
          batches: batches.length,
          value: stockValue(batches),
          expiring: expiring.length,
          expiringValue: expiring.reduce((n, b) => n + b.qty * b.unitCost, 0),
          quarantined: items.reduce((n, i) => n + quarantinedQty(batches, i.id, day), 0),
          reorder: reorderSuggestions(items, batches, storeMovements(day, items, batches), [], day).length,
          variance: variance.get(name) ?? 0,
        },
      };
    });
  },
  closing: ({ day }) => {
    const store = generateInventory(day);
    const expiring = expiringBatches(store.batches, day);
    const expiringValue = expiring.reduce((n, b) => n + b.qty * b.unitCost, 0);
    const counted = store.stockTake.length;
    const off = store.stockTake.filter((c) => {
      const item = store.items.find((i) => i.id === c.itemId);
      if (!item) return false;
      const tolerance = Math.max((item.reorderLevel * STOCK_VARIANCE_PCT) / 100, STOCK_VARIANCE_UNITS);
      return Math.abs((c.countedQty ?? c.systemQty) - c.systemQty) > tolerance;
    });
    const biggest = [...store.stockTake].map((c) => ({ c, delta: Math.abs((c.countedQty ?? c.systemQty) - c.systemQty) })).sort((a, b) => b.delta - a.delta)[0];
    return (
      `Stock on hand ${money(stockValue(store.batches))} across ${store.items.length} items in ${STORES.length} stores. ` +
      `${money(expiringValue)} of it sits in ${expiring.length} batch${expiring.length === 1 ? '' : 'es'} inside the expiry window — expiring stock is not a write-off yet: it is a fortnight in which somebody has to use it or lose it, and the store keeps the list. ` +
      `${counted} line${counted === 1 ? '' : 's'} were counted by hand today and ${off.length} came out beyond the ${STOCK_VARIANCE_PCT} % tolerance, so ${off.length === 0 ? 'nobody has to sign for a difference' : 'somebody signs for the difference before it is written off'}. ` +
      (biggest && biggest.delta > 0 ? `The largest difference was ${biggest.delta} units on ${store.items.find((i) => i.id === biggest.c.itemId)?.name ?? biggest.c.itemId}, counted by ${biggest.c.storer}. ` : '') +
      `${reorderSuggestions(store.items, store.batches, storeMovements(day, store.items, store.batches), [], day).length} item(s) are below their reorder level with the lead time allowed for; the purchase orders on this day are raised from that list rather than from memory.`
    );
  },
};

/** Theatre: cases per theatre, list utilisation, cancellations with their reasons. */
/** The session a theatre is staffed and paid for: six hours, the divisor the theatre screen uses per theatre. */
const SESSION_MINUTES = 6 * 60;
/** The turnover allowance the theatre screen adds per theatre when it computes its own utilisation figure. */
const TURNOVER_ALLOWANCE = 20;

const otReport: ReportDef = {
  topic: 'ot',
  title: 'Theatre utilisation',
  legacy: '/admin/report/ot',
  group: 'Clinical',
  question: 'Cases per theatre and surgeon, list utilisation, cancellations with their reasons, and the turnaround between cases.',
  requires: 'Theatre',
  maxDays: 1,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'A theatre suite exists where it exists: a branch without one says so rather than reporting an empty list.' },
    { key: 'range', label: 'Period', value: 'Today', hint: 'A list is a day’s work; utilisation read over a week hides the day a theatre sat idle waiting for blood.' },
    { key: 'theatre', label: 'Theatre', value: 'Every theatre in the suite', hint: 'Each theatre has its own team and its own equipment, so a suite figure hides which one is under-used.' },
    { key: 'utilisation', label: 'Utilisation', value: `Planned list minutes over the theatre’s ${SESSION_MINUTES / 60}-hour session`, hint: 'Planned minutes of the cases listed, plus the turnover allowance the theatre screen gives each theatre, over a six-hour session — the same arithmetic the theatre screen prints, so the two never disagree about the same day.' },
    { key: 'turnaround', label: 'Turnaround floor', value: `${TURNAROUND_FLOOR_MIN} minutes`, hint: 'Below the floor the room has not been cleaned and the next patient is not safely positioned, so a shorter turnaround is a finding rather than a triumph.' },
  ],
  schedule: 'Sent to the theatre manager and the surgeons’ coordinator every evening at 20:00, with tomorrow’s list attached.',
  owner: 'Theatre manager',
  views: [
    { label: 'Cancelled or bumped', hint: 'A patient who was prepared and did not go to theatre, with the reason the theatre screen recorded.', keep: (r) => numeric(r.cells.cancelled) + numeric(r.cells.bumped) > 0 },
    { label: 'Cases listed', hint: 'The theatres with a list today — the ones a coordinator has to keep moving.', keep: (r) => numeric(r.cells.listed) > 0 },
  ],
  columns: [
    { key: 'theatre', header: 'Theatre', kind: 'text' },
    { key: 'listed', header: 'Listed', align: 'right', kind: 'count', width: '6rem' },
    { key: 'completed', header: 'Completed', align: 'right', kind: 'count', width: '7rem' },
    { key: 'cancelled', header: 'Cancelled', align: 'right', kind: 'count', width: '7rem' },
    { key: 'bumped', header: 'Bumped', align: 'right', kind: 'count', width: '6rem' },
    { key: 'utilisation', header: 'Session planned %', align: 'right', kind: 'percent', percentOf: { part: 'plannedMin', whole: 'sessionMin' }, width: '9rem' },
    { key: 'turnover', header: 'Turnaround', align: 'right', kind: 'count', width: '8rem', avgOf: { total: 'idleMin', count: 'idleCount', suffix: ' min' } },
    { key: 'onTime', header: 'Started on time', align: 'right', kind: 'count', width: '9rem' },
  ],
  rows: ({ day, branch }) => {
    if (branch !== 'Main Campus') return [];
    const theatre = theatreDay(day);
    return theatre.theatres.map((room) => {
      const cases = theatre.cases.filter((c) => c.theatreId === room.id);
      const done = cases.filter((c) => c.state !== 'Cancelled' && c.state !== 'Bumped');
      const minutes = (c: (typeof cases)[number]) => minutesBetweenStamps(c.actualStart, c.actualEnd) ?? c.expectedMin;
      const caseMin = done.reduce((n, c) => n + minutes(c), 0);
      /* Planned, not operated: the list as it was written, which is what a session is planned against. The operated
         minutes are in the closing line, because a theatre that planned a full session and operated half of it is
         the finding the manager is looking for. */
      const plannedMin = cases.reduce((n, c) => n + c.expectedMin, 0) + TURNOVER_ALLOWANCE;
      const starts = done.map((c) => stamp(c.actualStart ?? c.scheduledStart)).filter((s): s is number => s !== null);
      const ends = done.map((c) => stamp(c.actualEnd ?? c.scheduledStart)).filter((s): s is number => s !== null);
      const span = starts.length === 0 ? 0 : Math.max(...ends) - Math.min(...starts);
      const listMin = Math.max(span, caseMin);
      const onTime = done.filter((c) => {
        const scheduled = stamp(c.scheduledStart);
        const actual = stamp(c.actualStart);
        return scheduled !== null && actual !== null && actual <= scheduled + 15;
      }).length;
      return {
        id: room.id,
        label: `${room.code} — ${room.name}`,
        cells: {
          theatre: `${room.code} — ${room.name}`,
          listed: cases.length,
          completed: cases.filter((c) => c.state === 'Completed').length,
          cancelled: cases.filter((c) => c.state === 'Cancelled').length,
          bumped: cases.filter((c) => c.state === 'Bumped').length,
          caseMin,
          listMin,
          plannedMin,
          sessionMin: SESSION_MINUTES,
          utilisation: Math.round((plannedMin / SESSION_MINUTES) * 100),
          idleMin: listMin - caseMin,
          idleCount: Math.max(0, done.length - 1),
          turnover: done.length < 2 ? 0 : Math.round((listMin - caseMin) / (done.length - 1)),
          onTime,
        },
      };
    });
  },
  closing: ({ day }, table) => {
    const theatre = theatreDay(day);
    const state = theatre.stats;
    const reasons = state.cancellationsReasons;
    /* Quoted from the table above rather than recomputed: a closing line that disagrees with its own table is the
       first thing a reader checks and the last thing they trust. */
    const planned = table.totals.utilisation ?? state.utilisationPct;
    const operated = theatre.cases
      .filter((c) => c.state !== 'Cancelled' && c.state !== 'Bumped')
      .reduce((n, c) => n + (minutesBetweenStamps(c.actualStart, c.actualEnd) ?? 0), 0);
    const inRoom = theatre.cases
      .filter((c) => c.state === 'In theatre' || c.state === 'In recovery')
      .map((c) => `${c.patientName ?? c.patientMrn} in ${theatre.theatres.find((t) => t.id === c.theatreId)?.code ?? 'the theatre'}`)
      .join('; ');
    return (
      `${state.listed} case${state.listed === 1 ? '' : 's'} listed: ${state.completed} completed, ${state.inTheatre} in theatre, ${state.inRecovery} in recovery, ${state.cancelled} cancelled and ${state.bumped} bumped. ` +
      `The lists plan ${planned} % of the four theatres’ six-hour sessions — planned minutes including the turnover allowance, which is the figure the theatre screen prints — and ${operated} minute(s) have actually been operated so far, so the gap between the two is a list that did not fill the day. The average turnaround between cases is ${state.averageTurnaroundMin} minutes against a floor of ${TURNAROUND_FLOOR_MIN}: a turnaround under the floor means the room was turned around faster than it can be cleaned and checked, which is a finding rather than a saving. ` +
      `${state.onTimeStarts} case${state.onTimeStarts === 1 ? '' : 's'} started within a quarter of an hour of the listed time and ${state.lateStarts} did not. ` +
      (reasons.length > 0 ? `A cancellation is recorded with its reason, and today’s: ${reasons.map((r) => r.reason).join(' ')}` : 'No case was cancelled today.') +
      (inRoom ? ` Right now: ${inRoom}.` : '') +
      (state.listOverrunMin > 0 ? ` The list ran ${state.listOverrunMin} minutes past its planned finish, ending at ${state.lastCaseEndsAt?.slice(11) ?? '—'}.` : '')
    );
  },
};

/** Human resource: the roster's coverage, read as a rule rather than as a headcount. */
const dutyReport: ReportDef = {
  topic: 'human_resource',
  title: 'Human resource and rostering',
  legacy: '/admin/report/human_resource',
  group: 'Workforce',
  question: 'Roster coverage per ward and shift, the gaps, and the rest violations before they become a sick note.',
  cannotReport: (branch) => SITE_BOUND('duty roster', branch),
  maxDays: 30,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'A roster belongs to the site that runs it: one set of staff, one set of wards.' },
    { key: 'range', label: 'Period', value: 'The last 7 days', hint: 'Rest violations appear over consecutive days, which a single shift cannot show.' },
    { key: 'ward', label: 'Ward', value: 'Every ward in the roster', hint: 'Coverage is a rule per ward, taken from that ward’s nursing ratio, not from a hospital-wide target.' },
    { key: 'skills', label: 'Skills', value: 'Scarce skills by ward and shift', hint: 'A fourth nurse without the skill the ward needs does not close the gap, which is why the shortage is counted separately.' },
    { key: 'rest', label: 'Rest rule', value: `${MIN_REST_HOURS} hours between shifts, ${MAX_CONSECUTIVE_NIGHTS} nights in a row`, hint: 'Both rules exist because the alternative is a tired nurse holding a syringe at four in the morning.' },
  ],
  schedule: 'Sent to the nursing superintendent and the HR manager every Monday at 07:00, with the rest violations listed first.',
  owner: 'Nursing superintendent',
  views: [
    { label: 'Short of a skill', hint: 'A shift whose gap is a skill and not a headcount: a fourth nurse without the skill does not close it.', keep: (r) => numeric(r.cells.skillSlots) > 0 },
    { label: 'Short-staffed shifts', hint: 'Every ward-shift where the present count came in under what the ward’s own ratio requires.', keep: (r) => numeric(r.cells.gap) > 0 },
  ],
  columns: [
    { key: 'ward', header: 'Ward', kind: 'text' },
    { key: 'slots', header: 'Shift slots', align: 'right', kind: 'count', width: '7rem' },
    { key: 'required', header: 'Required', align: 'right', kind: 'count', width: '7rem' },
    { key: 'present', header: 'Present', align: 'right', kind: 'count', width: '7rem' },
    { key: 'gap', header: 'Short by', align: 'right', kind: 'count', width: '7rem' },
    { key: 'skillSlots', header: 'Slots short of a skill', align: 'right', kind: 'count', width: '10rem' },
    { key: 'seniorSlots', header: 'Slots with a senior', align: 'right', kind: 'count', width: '10rem' },
    { key: 'doctorSlots', header: 'Slots with a doctor', align: 'right', kind: 'count', width: '10rem' },
  ],
  rows: ({ days, branch }) => {
    if (branch !== 'Main Campus') return [];
    const perWard = new Map<string, { name: string; slots: number; required: number; present: number; gap: number; skillSlots: number; seniorSlots: number; doctorSlots: number }>();
    for (const day of days) {
      for (const line of dutyDay(day).coverage) {
        const row = perWard.get(line.ward.id) ?? { name: line.ward.name, slots: 0, required: 0, present: 0, gap: 0, skillSlots: 0, seniorSlots: 0, doctorSlots: 0 };
        perWard.set(line.ward.id, row);
        row.slots += 1;
        row.required += line.required;
        row.present += line.present;
        row.gap += line.gap;
        if (line.missingSkills.length > 0) row.skillSlots += 1;
        if (line.seniorPresent) row.seniorSlots += 1;
        if (line.doctorPresent) row.doctorSlots += 1;
      }
    }
    return [...perWard.entries()].map(([id, row]) => ({
      id,
      label: row.name,
      cells: {
        ward: row.name,
        slots: row.slots,
        required: row.required,
        present: row.present,
        gap: row.gap,
        skillSlots: row.skillSlots,
        seniorSlots: row.seniorSlots,
        doctorSlots: row.doctorSlots,
      },
    }));
  },
  closing: ({ day }) => {
    const duty = dutyDay(day);
    const state = duty.stats;
    const conflicts = duty.conflicts.length;
    return (
      `At ${day}: ${state.onDuty} staff on duty, ${state.nursesOnDuty} of them nurses, with ${state.gaps} gap${state.gaps === 1 ? '' : 's'} across the wards and ${state.missingSkills} shift${state.missingSkills === 1 ? '' : 's'} short of a skill the ward is required to have. ` +
      `${state.handoversTaken} shift handover${state.handoversTaken === 1 ? '' : 's'} were taken and ${state.handoversPending} are still pending — a handover not taken is the handover where the sick patient is mentioned last. ` +
      `${state.restBlocks} assignment${state.restBlocks === 1 ? '' : 's'} were blocked because they broke the ${MIN_REST_HOURS}-hour rest rule, ${state.overtimeHours} hour(s) of overtime were worked, ${state.onLeave} staff are on leave and ${state.floatCovering} are covering a ward that is not theirs. ` +
      (conflicts > 0
        ? `${conflicts} assignment${conflicts === 1 ? '' : 's'} in this roster would be refused by the rules — every one of them is on the builder’s screen for tomorrow, with the reason.`
        : 'The roster breaks none of its own rules today.')
    );
  },
};

/** Live consultations: the one report that is a picture rather than a period. */
const liveReport: ReportDef = {
  topic: 'live_consultation',
  title: 'Live consultations',
  legacy: '/admin/report/live_consultation',
  group: 'Patient flow',
  question: 'Who is in a room now, who is waiting, and how long each of them has been there — the one report that is a picture rather than a period.',
  maxDays: 1,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'Every branch runs out-patients; the board at each site is its own.' },
    { key: 'range', label: 'Period', value: 'Today only', hint: 'A picture cannot be drawn for last Tuesday: the people are no longer in the rooms, so the report reads one day and says so.' },
    { key: 'clock', label: 'Clock', value: 'The ward board’s own time', hint: 'The same clock the ward and the queue read, so a wait measured here matches the wait the patient has lived.' },
    { key: 'waiting', label: 'Waiting', value: 'Arrived, not yet signed', hint: 'A waiting patient is one whose consultation has started and whose note is not written, which is the state the room is actually in.' },
    { key: 'room', label: 'Room', value: 'Every consulting room in use', hint: 'Rooms are grouped rather than doctors, because a room standing empty is what the OPD manager can fix.' },
  ],
  schedule: 'Read live on the OPD board, refreshed every minute; nobody is sent it, because a picture e-mailed at 09:00 is a historical document by 09:02.',
  owner: 'OPD manager',
  views: [
    { label: 'Waiting over an hour', hint: 'A patient whose consultation started and has not been signed in an hour — the room where a second person should be asked to help.', keep: (r) => numeric(r.cells.oldest) >= 60 },
  ],
  columns: [
    { key: 'room', header: 'Room', kind: 'text' },
    { key: 'consultations', header: 'Consultations', align: 'right', kind: 'count', width: '8rem' },
    { key: 'signed', header: 'Signed', align: 'right', kind: 'count', width: '6rem' },
    { key: 'waiting', header: 'Waiting now', align: 'right', kind: 'count', width: '7rem' },
    { key: 'oldest', header: 'Longest wait (min)', align: 'right', kind: 'count', aggregate: 'max', width: '9rem' },
    { key: 'avgWait', header: 'Average wait', align: 'right', kind: 'count', width: '8rem', avgOf: { total: 'waited', count: 'waitedFor', suffix: ' min' } },
  ],
  rows: ({ day, branch }) => {
    const encounters = generateEncounters(day).filter((e) => branchOfMrn(e.patient.mrn) === branch);
    const clock = stamp(boardClock(day)) ?? 0;
    const perRoom = new Map<string, { waiting: number; signed: number; total: number; waited: number; count: number; oldest: number }>();
    for (const enc of encounters) {
      const row = perRoom.get(enc.room) ?? { waiting: 0, signed: 0, total: 0, waited: 0, count: 0, oldest: 0 };
      perRoom.set(enc.room, row);
      row.total += 1;
      const arrived = stamp(enc.arrivedAt) ?? clock;
      const waited = Math.max(0, clock - arrived);
      if (enc.status === 'Signed') row.signed += 1;
      else {
        row.waiting += 1;
        row.waited += waited;
        row.count += 1;
        row.oldest = Math.max(row.oldest, waited);
      }
    }
    return [...perRoom.entries()].map(([room, row]) => ({
      id: room,
      label: room,
      cells: {
        room,
        consultations: row.total,
        signed: row.signed,
        waiting: row.waiting,
        waited: row.waited,
        waitedFor: row.count,
        avgWait: row.count === 0 ? 0 : Math.round(row.waited / row.count),
        oldest: row.oldest,
      },
    }));
  },
  closing: ({ day }) => {
    const encounters = generateEncounters(day);
    const clock = stamp(boardClock(day)) ?? 0;
    const waiting = encounters.filter((e) => e.status !== 'Signed');
    const oldest = waiting.map((e) => ({ e, waited: Math.max(0, clock - (stamp(e.arrivedAt) ?? clock)) })).sort((a, b) => b.waited - a.waited)[0];
    const at = new Date(clock * 60_000).toISOString().slice(11, 16);
    return (
      `The board at ${at}: ${encounters.length} consultations open or finished today, ${waiting.length} still waiting and ${encounters.length - waiting.length} signed. ` +
      (oldest
        ? `The longest wait is ${oldest.e.patient.name}, in ${oldest.e.room}, at ${Math.round(oldest.waited)} minutes. `
        : 'Nobody is waiting. ') +
      `This is a picture and not a period: it describes ${day} at ${at}, and it cannot be re-drawn for a past afternoon because the people are no longer in those rooms. ` +
      `How long waits usually are is a different question, and the out-patient report answers it by reading the same records over a week.`
    );
  },
};

/** The audit log: the shape of the trail, and the policy every write on it is held to. */
const logReport: ReportDef = {
  topic: 'log',
  title: 'Audit log',
  legacy: '/admin/report/log',
  group: 'Governance',
  question: 'Who changed what, when, and on which device — read from the append-only ledger rather than from a table of last edits.',
  sameEverywhere:
    'The audit trail is a property of the product and not of a branch: every node writes the same shape of entry, under the same contract, and holds its writes to the same three record policies.',
  caveat:
    'No audit table is read here. This preview writes its trail into the device’s own append-only queue, which holds what this device has written since it loaded — nothing, until something is written — so the report can describe the trail and the rules every write on it is held to, and cannot yet list who changed a record yesterday. The server end of the same ledger (the Audit module in P0-301) is where those entries land when the drain runs, and the columns below are the contract’s own answer to what it will hold.',
  maxDays: 1,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'Every node writes its own trail; the consolidated view is the policies the writes are held to, which are the same everywhere.' },
    { key: 'range', label: 'Period', value: 'The whole trail in this preview', hint: 'A trail is read from the beginning: a period would imply entries can be left out.' },
    { key: 'module', label: 'Module', value: 'Every module in the contract', hint: 'The rows are the modules the operations belong to, which are the same names as the API’s own tags and the database schemas.' },
    { key: 'audited', label: 'Audited', value: 'Every write the trail must hold', hint: 'A read is not an entry: the trail records what changed a record, not who looked at one.' },
    { key: 'offline', label: 'While the link is down', value: 'Queued, or refused with a reason', hint: 'An operation that cannot be queued is refused before anybody taps it, so nobody believes a write reached the cloud when it did not.' },
  ],
  schedule: 'Read on demand by the medical superintendent and the auditor; a monthly extract is sent to the audit committee, and the extract is the trail itself rather than a summary of it.',
  owner: 'Medical superintendent',
  views: [
    { label: 'Writes only', hint: 'The operations that change a record: a trail records what changed one, not who looked at one.', keep: (r) => numeric(r.cells.write) > 0 },
    { label: 'Needs the link', hint: 'Operations the contract refuses when the uplink is down, each with the sentence the desk is shown.', keep: (r) => numeric(r.cells.onlineOnly) > 0 },
  ],
  columns: [
    { key: 'module', header: 'Module', kind: 'text' },
    { key: 'operations', header: 'Operations', align: 'right', kind: 'count', width: '7rem' },
    { key: 'write', header: 'Writes', align: 'right', kind: 'count', width: '6rem' },
    { key: 'audited', header: 'Audited', align: 'right', kind: 'count', width: '6rem' },
    { key: 'queued', header: 'Queued offline', align: 'right', kind: 'count', width: '8rem' },
    { key: 'onlineOnly', header: 'Needs the link', align: 'right', kind: 'count', width: '8rem' },
    { key: 'needsKey', header: 'With an idempotency key', align: 'right', kind: 'count', width: '10rem' },
  ],
  rows: () => {
    const perModule = new Map<string, { operations: number; audited: number; queued: number; onlineOnly: number; needsKey: number; write: number }>();
    for (const op of Object.values(contractOperations)) {
      const name = op.tag ?? 'platform';
      const row = perModule.get(name) ?? { operations: 0, audited: 0, queued: 0, onlineOnly: 0, needsKey: 0, write: 0 };
      perModule.set(name, row);
      row.operations += 1;
      if (op.audit) row.audited += 1;
      if (op.mayQueue) row.queued += 1;
      if (op.needsNetwork) row.onlineOnly += 1;
      if (op.requiresIdempotencyKey) row.needsKey += 1;
      if (op.method !== 'get') row.write += 1;
    }
    return [...perModule.entries()].map(([name, row]) => ({
      id: name,
      label: name,
      cells: {
        module: name,
        operations: row.operations,
        write: row.write,
        audited: row.audited,
        queued: row.queued,
        onlineOnly: row.onlineOnly,
        needsKey: row.needsKey,
      },
    }));
  },
  closing: ({ day }) => {
    const operations = Object.values(contractOperations);
    const audited = operations.filter((o) => o.audit);
    const queued = operations.filter((o) => o.mayQueue);
    const refused = operations.filter((o) => o.needsNetwork);
    const entities = Object.keys(ENTITY_POLICY);
    return (
      `The contract holds ${operations.length} operations across ${entities.length} record types: ${audited.length} of them are audited — a read is never an entry, because a trail that records who looked at a record buries the person who changed one. ` +
      `${queued.length} may be queued while the link is down and replayed from the node’s own block of numbers, and ${refused.length} are refused with a sentence rather than a spinner, because an operation that cannot be queued must not look as though it was. ` +
      `Every entry is written in the same transaction as the record it describes, carries the actor and the device, and is never updated or deleted — the product has no route that could, and the database refuses one. ` +
      `The record types are held to three policies: append-only (an event that happened cannot be corrected, only added to), exclusive (one desk holds it — a bed, a dose, an appointment slot), and field-level (two desks may correct different fields of the same record, and the same field needs a person to choose). ` +
      `Rolled up for ${day}, this is the trail’s shape: what it will hold, and what it will never let anybody edit.`
    );
  },
};

/* ========================================================================================= Governance */

/**
 * Births and deaths, by ward.
 *
 * The register's own day is the row set: a ward with no births and no deaths is still a row, because a ward that
 * reports nothing is a fact the mortality meeting reads, while a ward that is missing from the table is a question
 * nobody asks. The emergency row is where a patient brought in dead belongs — there is no bed, no ward round and no
 * admission, and putting those patients in a ward's row would credit a ward with a death it never saw.
 */
const birthDeathReport: ReportDef = {
  topic: 'birth_death',
  title: 'Births and deaths',
  legacy: '/admin/report/birth_death',
  group: 'Governance',
  question: 'Who was born and who died, in which ward, with which certificate and which registration — the two events nobody decides, read the way a registrar, a family and a mortality meeting each read them.',
  requires: 'In-patient',
  maxDays: 1,
  filters: [
    { key: 'scope', label: 'Branch', value: 'All branches', hint: 'The register is the hospital’s own: one series of numbers, one mortuary, one office that files with the registrar.' },
    { key: 'range', label: 'Period', value: 'Today, with the register as it stands', hint: 'A birth and a death are events, not averages: the report reads the day it was taken, and the review deadlines are counted from the event.' },
    { key: 'ward', label: 'Ward', value: 'Every ward, plus the emergency room', hint: 'A patient brought in dead belongs to no ward, and the register says so rather than crediting one with a death it never saw.' },
    { key: 'certificate', label: 'Certificate', value: 'A cause in three parts before a number', hint: 'What stopped the patient, what led to it, what started it — and where the manner is unnatural, a police referral instead, because the certificate is then written from the post-mortem.' },
    { key: 'registration', label: 'Registration', value: 'The hospital register, then the registrar’s', hint: 'The hospital’s number is not the civil one: the birth registration and the death registration are filed with the city corporation, and this report shows which are still open.' },
  ],
  schedule: 'Sent to the medical superintendent, the nursing superintendent and the medical records officer every morning at 07:00, and to the mortality review committee on Mondays with the previous week’s deaths and the reviews they opened.',
  owner: 'Medical records officer',
  views: [
    { label: 'Reviews to open', hint: 'A death within 24 hours of admission, a death in a woman of childbearing age, or a stillbirth: each one opens a review by the register’s own rules, and this is the list the committee reads.', keep: (r) => numeric(r.cells.within24h) + numeric(r.cells.maternal) + numeric(r.cells.stillbirths) > 0 },
    { label: 'Medico-legal', hint: 'An unnatural or unknown death, where the body goes to the police and the certificate waits for the post-mortem.', keep: (r) => numeric(r.cells.medicoLegal) > 0 },
    { label: 'Registration open', hint: 'Births and deaths whose civil registration has not produced a number yet — the paperwork a family carries away from the hospital.', keep: (r) => numeric(r.cells.registrationOpen) > 0 },
    { label: 'Births', hint: 'The maternity rows only, which is how the obstetrician reads the same report.', keep: (r) => numeric(r.cells.births) > 0 },
  ],
  columns: [
    { key: 'ward', header: 'Ward', kind: 'text' },
    { key: 'births', header: 'Births', align: 'right', kind: 'count', width: '6rem' },
    { key: 'caesareans', header: 'Caesarean', align: 'right', kind: 'count', width: '7rem' },
    { key: 'stillbirths', header: 'Stillbirth', align: 'right', kind: 'count', width: '7rem' },
    { key: 'lowBirthWeight', header: 'Under 2 500 g', align: 'right', kind: 'count', width: '8rem' },
    { key: 'deaths', header: 'Deaths', align: 'right', kind: 'count', width: '6rem' },
    { key: 'broughtInDead', header: 'Brought in dead', align: 'right', kind: 'count', width: '9rem' },
    { key: 'within24h', header: 'Within 24 h of admission', align: 'right', kind: 'count', width: '10rem' },
    { key: 'maternal', header: 'Women of childbearing age', align: 'right', kind: 'count', width: '10rem' },
    { key: 'medicoLegal', header: 'Medico-legal', align: 'right', kind: 'count', width: '8rem' },
    { key: 'certificates', header: 'Certificates issued', align: 'right', kind: 'count', width: '9rem' },
    { key: 'registrationOpen', header: 'Registration open', align: 'right', kind: 'count', width: '9rem' },
  ],
  rows: ({ day, branch }) => {
    if (branch !== 'Main Campus') return [];
    const register = birthDeathDay(day);
    const wardOf = (id: string | null) => (id === null ? 'emergency' : id);

    const blank = () => ({ births: 0, caesareans: 0, stillbirths: 0, lowBirthWeight: 0, deaths: 0, broughtInDead: 0, within24h: 0, maternal: 0, medicoLegal: 0, certificates: 0, registrationOpen: 0 });
    const tally = new Map<string, ReturnType<typeof blank>>();
    const of = (id: string) => {
      const row = tally.get(id) ?? blank();
      tally.set(id, row);
      return row;
    };

    for (const birth of register.births) {
      const row = of(wardOf(birth.wardId));
      row.births += 1;
      if (birth.type === 'Caesarean') row.caesareans += 1;
      if (birth.outcome === 'Stillbirth') row.stillbirths += 1;
      if (birth.outcome === 'Live birth' && birth.weightGrams < 2500) row.lowBirthWeight += 1;
      if (birth.civil.state === 'Started online' || birth.civil.state === 'Filed, number awaited' || birth.civil.state === 'Not yet filed') row.registrationOpen += 1;
    }

    for (const death of register.deaths) {
      const row = of(wardOf(death.wardId));
      row.deaths += 1;
      if (death.kind === 'Brought in dead') row.broughtInDead += 1;
      if (death.kind === 'In-patient' && death.admittedAt && death.at.slice(0, 10) === death.admittedAt.slice(0, 10)) row.within24h += 1;
      if (death.patient?.sex === 'Female' && (death.patient?.age ?? 0) >= 15 && (death.patient?.age ?? 0) <= 49) row.maternal += 1;
      if (death.police) row.medicoLegal += 1;
      if (death.certificateNo) row.certificates += 1;
      if (death.civil.state === 'Not yet filed' || death.civil.state === 'Filed, number awaited' || death.civil.state === 'Started online') row.registrationOpen += 1;
    }

    const board = generateInpatient(day);
    const order = [...board.wards.map((w) => w.id), 'emergency'];
    const labelOf = (id: string) => (id === 'emergency' ? 'Emergency — brought in dead' : board.wards.find((w) => w.id === id)?.name ?? id);

    return order
      .filter((id) => tally.has(id) || id !== 'emergency')
      .map((id) => {
        const row = tally.get(id) ?? blank();
        return {
          id,
          label: labelOf(id),
          cells: { ward: labelOf(id), ...row },
        };
      });
  },
  closing: ({ day }) => {
    const register = birthDeathDay(day);
    const state = register.stats;
    const live = register.births.filter((b) => b.outcome === 'Live birth');
    const section = register.births.find((b) => b.type === 'Caesarean');
    const small = live.filter((b) => b.weightGrams < 2500);
    const held = register.deaths.filter((d) => d.releasedAt === null);
    const open = [...register.births.map((b) => ({ who: b.registerNo, state: b.civil.state })), ...register.deaths.map((d) => ({ who: d.registerNo, state: d.civil.state }))]
      .filter((x) => x.state === 'Started online' || x.state === 'Filed, number awaited' || x.state === 'Not yet filed');
    return (
      `The register at ${register.now}: ${state.births} birth${state.births === 1 ? '' : 's'} — ${state.liveBirths} live and ${state.stillbirths} stillborn — and ${state.deaths} death${state.deaths === 1 ? '' : 's'}, ${state.inPatient} of them in a bed and ${state.broughtInDead} brought in dead. ` +
      (small.length > 0 ? `${small.length} live-born baby is under 2 500 g and has a feeding plan and a follow-up date rather than a routine discharge. ` : '') +
      (section ? `The caesarean today was for ${section.complications[0].split(' — ')[0].toLowerCase()}, and the indication is on the record because the next pregnancy is planned around it. ` : '') +
      `${state.certified} certificate${state.certified === 1 ? '' : 's'} issued and ${state.medicoLegal} death referred to the police and the post-mortem, where the certificate waits for the report rather than for the ward round. ` +
      (state.certificatesOutstanding > 0
        ? `${state.certificatesOutstanding} death has neither a certificate nor a referral, which is the one state this register may not leave alone. `
        : 'Every death that can be certified has been, and every body leaving the mortuary has either a certificate or a police referral behind it. ') +
      (held.length > 0 ? `${held.length} ${held.length === 1 ? 'body is' : 'bodies are'} still in the mortuary${held.some((d) => d.police) ? ', one of them until the post-mortem' : ''}. ` : '') +
      `${state.civilFiled} civil registration number${state.civilFiled === 1 ? '' : 's'} came back and ${open.length} ${open.length === 1 ? 'is' : 'are'} still open — ${open.map((x) => x.who).join(', ')} — because a birth or a death that is never filed with the registrar is one the district cannot plan a clinic around. ` +
      (register.reviews.length > 0
        ? `${register.reviews.length} review${register.reviews.length === 1 ? '' : 's'} opened by the register itself: ${register.reviews.map((r) => r.kind.toLowerCase()).join(', ')}.`
        : 'No death or birth today opened a review.')
    );
  },
};

/* ================================================================================== the suite itself */

export const REPORTS: ReportDef[] = [
  /* Money */
  financeReport,
  tpaReport,
  /* Patient flow */
  patientReport,
  appointmentReport,
  liveReport,
  /* Clinical */
  opdReport,
  ipdReport,
  pathologyReport,
  radiologyReport,
  otReport,
  /* Support services */
  pharmacyReport,
  inventoryReport,
  bloodBankReport,
  ambulanceReport,
  /* Workforce and governance */
  dutyReport,
  logReport,
  birthDeathReport,
];

export const REPORT_TOPICS: string[] = REPORTS.map((r) => r.topic);

/** Seventeen screens is what the legacy product had, and the phase is measured against that number. */
export const REPORT_SUITE_TOTAL = 17;

/**
 * The rest of the suite: the legacy report screens the phase still owes, with the legacy path each one replaces,
 * the group it will sit in, and what it has to answer. Keeping them here rather than in a plan document means the
 * hub, the harness and the phase's own count (`REPORTS.length + PLANNED_REPORTS.length`) all read one list — a plan
 * that drifts from the product is how a phase ends up “complete” with three screens missing.
 */
export interface PlannedReport {
  name: string;
  legacy: string;
  group: ReportGroup;
  question: string;
  /** What it is waiting for, where the store it needs does not exist yet. */
  blockedBy?: string;
}

/**
 * Nothing is left to plan: the phase's seventeen screens are built, and this list stays here empty rather than
 * deleted, because the harness and the hub both read it and the next report the product owes will start life in
 * it. Births and deaths used to sit here, blocked on a register nothing wrote; it is built now, on
 * `lib/birthdeath.ts`, which is where the ward's own admissions and the ambulance fleet's obstetric call are read.
 */
export const PLANNED_REPORTS: PlannedReport[] = [];
export const REPORT_SUITE_NOTE =
  'Seventeen Reports › … screens, one framework: per branch and consolidated are the same query added up, every column carries its definition, and a branch that has no such service says so instead of printing a zero.';
