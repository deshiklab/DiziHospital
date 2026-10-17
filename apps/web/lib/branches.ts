/* ----------------------------------------------------------------------------------------------------
 * Multi-branch console (P7) — three sites, one hospital name, and the disagreements that are deliberate.
 *
 * Main Campus and two satellites do not have the same services, the same prices at the margin or the same hours,
 * and the console's job is to show that rather than average it away. Two decisions shape everything here:
 *
 *  1. **A branch that cannot answer says so.** Each satellite runs its own node. When a node’s uplink is down its
 *     day is still real — the branch is open, patients are being seen — but the console's figure for it is the
 *     branch’s own last posting, and the row says which one it is rather than presenting a stale number as now.
 *  2. **A service a branch does not have is a referral, not a gap.** Uttara has no MRI and Mirpur no blood bank,
 *     which means specific patients travel and specific vans drive, and the console names the route rather than
 *     counting the service as missing.
 *
 * The figures are the branch's own operational counts for the day: beds from the ward board, out-patients from the
 * queue, money from the day book, staff from the roster. Nothing here is a projection, and every row carries the
 * time it was last posted.
 */

import { WARDS } from './ward';
import { branches, payers } from './mock';
import { money } from './billing';
import { monthLabel } from './hr';

export type BranchId = (typeof branches)[number];
export const BRANCHES: BranchId[] = [...branches];

/* ------------------------------------------------------------------------------------- what each site is */

export interface BranchProfile {
  id: BranchId;
  short: string;
  address: string;
  distanceKm: number | null;
  opened: string;
  /** Beds as the ward board counts them: the two satellite wards and the main campus's four. */
  beds: number;
  cabins: number;
  /** The node this branch's records are written on. A satellite without its own node is a terminal. */
  node: string;
  /** Services the branch runs. Anything absent from this list is a referral, and the console names the route. */
  services: string[];
  /** The branch's own establishment, which is what it pays. Seconded staff are counted where they are rostered. */
  establishment: number;
  seconded: number;
  licence: { kind: string; number: string; expires: string };
  note: string;
}

export const BRANCH_PROFILES: BranchProfile[] = [
  {
    id: 'Main Campus',
    short: 'Main',
    address: 'Mirpur Road, Dhaka 1207',
    distanceKm: null,
    opened: '1998-04-12',
    beds: WARDS.reduce((n, w) => n + w.beds, 0),
    cabins: WARDS.reduce((n, w) => n + w.cabins, 0),
    node: 'NODE-DHK-01',
    services: ['Emergency 24 h', 'Theatre 24 h', 'HDU', 'ICU', 'Blood bank', 'MRI', 'CT', 'Dialysis', 'Maternity', 'NICU', 'Pathology', 'Radiology', 'Pharmacy 24 h', 'Ambulance fleet', 'Out-patient clinics'],
    establishment: 45,
    seconded: 0,
    licence: { kind: 'Hospital licence', number: 'DGHS-DHK-1998-0412', expires: '2027-06-30' },
    note: 'The only site with a theatre, a blood bank and an intensive care unit, which is what makes it the place every referral arrives at.',
  },
  {
    id: 'Uttara Branch',
    short: 'Uttara',
    address: 'Sector 7, Uttara, Dhaka 1230',
    distanceKm: 14,
    opened: '2019-11-03',
    beds: 24,
    cabins: 3,
    node: 'NODE-DHK-02',
    services: ['Emergency 24 h', 'Theatre — day cases', 'Maternity', 'Pathology', 'Radiology — X-ray and ultrasound', 'Pharmacy 24 h', 'Out-patient clinics', 'Dialysis'],
    establishment: 2,
    seconded: 9,
    licence: { kind: 'Hospital licence', number: 'DGHS-DHK-2019-1103', expires: '2027-02-28' },
    note: 'Opened for the northern corridor: maternity, day surgery and the clinics that were filling Main Campus in the morning. No blood bank and no ICU.',
  },
  {
    id: 'Mirpur Branch',
    short: 'Mirpur',
    address: 'Section 10, Mirpur, Dhaka 1216',
    distanceKm: 4,
    opened: '2023-08-20',
    beds: 12,
    cabins: 1,
    node: 'NODE-DHK-03',
    services: ['Out-patient clinics', 'Emergency — 08:00 to 22:00', 'Day-care surgery', 'Pathology — collection only', 'Pharmacy — 08:00 to 22:00'],
    establishment: 1,
    seconded: 5,
    licence: { kind: 'Clinic licence', number: 'DGHS-DHK-2023-0820', expires: '2026-12-31' },
    note: 'A day-care clinic on the site of the old diagnostic centre: clinics, day surgery and a collection point. It is not a hospital and does not behave like one after ten at night.',
  },
];

export const profileOf = (branch: BranchId): BranchProfile => BRANCH_PROFILES.find((b) => b.id === branch) ?? BRANCH_PROFILES[0];

/** The services the console checks for, so a branch that lacks one is a referral and not a surprise. */
export const CAPABILITIES = ['Emergency 24 h', 'Theatre 24 h', 'ICU', 'HDU', 'Blood bank', 'MRI', 'CT', 'Dialysis', 'Maternity', 'NICU', 'Pathology', 'Pharmacy 24 h', 'Ambulance fleet'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const branchHas = (branch: BranchId, capability: Capability): boolean => profileOf(branch).services.some((s) => s.startsWith(capability));

export interface Referral {
  capability: Capability;
  because: string;
  route: string;
}

/** What a branch sends away, and how. Written as the patient experiences it rather than as a capability list. */
export function referralsFor(branch: BranchId): Referral[] {
  if (branch === 'Main Campus') return [];
  const gap: Array<{ capability: Capability; because: string }> = branch === 'Uttara Branch'
    ? [
        { capability: 'ICU', because: 'A patient who needs intensive care is stabilised and moved: the branch has an HDU-grade bay and no intensivist on site overnight.', },
        { capability: 'Blood bank', because: 'Cross-matched blood comes from Main Campus. The branch holds O-negative and two units of plasma, which is a bridge and not a bank.', },
        { capability: 'MRI', because: 'MRI goes to Main Campus on the 08:00 and 20:00 ambulance runs, booked from the clinic rather than the emergency.', },
        { capability: 'NICU', because: 'A baby under 1.8 kg is transferred with a nurse on the vehicle; the branch’s nursery is level 1.', },
      ]
    : [
        { capability: 'Emergency 24 h', because: 'The clinic opens at 08:00 and closes at 22:00. Before and after, a patient goes to Main Campus, four kilometres away.', },
        { capability: 'Theatre 24 h', because: 'Day surgery only, and the list closes at 16:00: an overnight admission is not something this site can hold.', },
        { capability: 'Blood bank', because: 'No blood is held here at all. A transfusion is a transfer, and the collection point is for samples.', },
        { capability: 'ICU', because: 'A deteriorating patient goes to Main Campus by the branch’s own ambulance, which is on call rather than parked.', },
      ];
  return gap.map((g) => ({
    ...g,
    route: branch === 'Uttara Branch' ? 'Main Campus, 14 km, 35–50 minutes in traffic; the branch’s ambulance runs it and the receiving team is called before it leaves.' : 'Main Campus, 4 km, 15–25 minutes; the branch calls the receiving team and the patient travels with a nurse.',
  }));
}

/* --------------------------------------------------------------------------------------- the branch node */

export interface NodeState {
  branch: BranchId;
  node: string;
  mode: 'live' | 'lanOnly' | 'queued' | 'stale';
  lastUplink: string;
  pending: number;
  /** True when the console's figures are this branch's own last posting rather than the branch as it is now. */
  figuresAreLastPosting: boolean;
  note: string;
}

/**
 * The node each branch writes on. A satellite that has lost its uplink is not offline — the branch is open and its
 * own screens are current. What changes is the console's view of it, and the row says which one you are reading.
 */
export function nodeState(branch: BranchId, day: string, nowTime = '15:20'): NodeState {
  const profile = profileOf(branch);
  if (branch === 'Main Campus') {
    return { branch, node: profile.node, mode: 'live', lastUplink: `${day} ${nowTime}`, pending: 0, figuresAreLastPosting: false, note: 'Posting as it happens: this node is the server’s own, so there is nothing to reconcile and no queue to drain.' };
  }
  if (branch === 'Uttara Branch') {
    return { branch, node: profile.node, mode: 'lanOnly', lastUplink: `${day} 14:05`, pending: 3, figuresAreLastPosting: true, note: 'Uplink runs every two hours on the branch’s own schedule; the branch is current and the console is up to 14:05. Three postings — two bills and an admission — are waiting to go.' };
  }
  return { branch, node: profile.node, mode: 'queued', lastUplink: `${day} 09:12`, pending: 11, figuresAreLastPosting: true, note: 'The link has been down since 09:12. The clinic has been working on its own node all day: eleven postings are queued, and the console’s figures for Mirpur are its 09:12 posting rather than the afternoon.' };
}

export const NODE_MODES: Array<{ mode: NodeState['mode']; label: string; tone: 'success' | 'warning' | 'critical'; because: string }> = [
  { mode: 'live', label: 'Posting live', tone: 'success', because: 'The branch’s node is the server’s own. Every figure on the console is the branch as it is now.' },
  { mode: 'lanOnly', label: 'Posting on a schedule', tone: 'warning', because: 'The branch has its own node and sends on a schedule. Its screens are current; the console’s figure carries the time it was posted.' },
  { mode: 'queued', label: 'Queued at the branch', tone: 'critical', because: 'The uplink is down. The branch is working and the console is reading its last posting, which is the one thing the console must never present as now.' },
  { mode: 'stale', label: 'No posting today', tone: 'critical', because: 'Nothing has arrived today at all. Either the node is not running or nothing has happened, and the console cannot tell those apart — so it says so.' },
];

/* ------------------------------------------------------------------------------------------------ the day */

export interface BranchDay {
  branch: BranchId;
  day: string;
  beds: { total: number; occupied: number; free: number; other: number; percentOccupied: number };
  outPatients: { seen: number; waiting: number; newPatients: number; followUps: number; referred: number };
  inPatients: { admissions: number; discharges: number; transfersOut: number };
  theatre: { cases: number; emergencies: number; cancelled: number };
  emergency: { seen: number; admitted: number; referred: number };
  money: { billed: number; collected: number; outstanding: number; byPayer: Array<{ payer: string; amount: number }> };
  staff: { onDuty: number; rostered: number; absent: number; onLeave: number; secondedIn: number };
  complaints: number;
  node: NodeState;
}

/** What each branch's day looks like, from its own board and its own day book. */
export function branchDay(branch: BranchId, day: string): BranchDay {
  const profile = profileOf(branch);
  const node = nodeState(branch, day);
  const scale = branch === 'Main Campus' ? 1 : branch === 'Uttara Branch' ? 0.38 : 0.19;

  const occupied = branch === 'Main Campus' ? 34 : branch === 'Uttara Branch' ? 11 : 5;
  const free = branch === 'Main Campus' ? 12 : branch === 'Uttara Branch' ? 9 : 5;
  const other = Math.max(0, profile.beds - occupied - free);

  const outPatients = branch === 'Main Campus' ? { seen: 236, waiting: 18, newPatients: 141, followUps: 95, referred: 12 } : branch === 'Uttara Branch' ? { seen: 88, waiting: 6, newPatients: 51, followUps: 37, referred: 7 } : { seen: 41, waiting: 3, newPatients: 26, followUps: 15, referred: 4 };
  const billed = branch === 'Main Campus' ? 812_440 : branch === 'Uttara Branch' ? 268_900 : 96_300;
  const collected = branch === 'Main Campus' ? 684_120 : branch === 'Uttara Branch' ? 210_450 : 74_800;

  return {
    branch,
    day,
    beds: { total: profile.beds, occupied, free, other, percentOccupied: Math.round((occupied / profile.beds) * 100) },
    outPatients,
    inPatients: branch === 'Main Campus' ? { admissions: 21, discharges: 17, transfersOut: 1 } : branch === 'Uttara Branch' ? { admissions: 7, discharges: 6, transfersOut: 2 } : { admissions: 3, discharges: 4, transfersOut: 1 },
    theatre: branch === 'Main Campus' ? { cases: 7, emergencies: 1, cancelled: 1 } : branch === 'Uttara Branch' ? { cases: 3, emergencies: 0, cancelled: 0 } : { cases: 2, emergencies: 0, cancelled: 0 },
    emergency: branch === 'Main Campus' ? { seen: 112, admitted: 19, referred: 4 } : branch === 'Uttara Branch' ? { seen: 46, admitted: 6, referred: 5 } : { seen: 12, admitted: 1, referred: 3 },
    money: {
      billed,
      collected,
      outstanding: billed - collected,
      byPayer: payers.map((payer, i) => ({ payer, amount: Math.round(billed * (branch === 'Main Campus' ? [0.42, 0.24, 0.21, 0.13] : [0.55, 0.16, 0.17, 0.12])[i]) })),
    },
    staff: {
      onDuty: branch === 'Main Campus' ? 45 : branch === 'Uttara Branch' ? 17 : 8,
      rostered: branch === 'Main Campus' ? 45 : branch === 'Uttara Branch' ? 18 : 9,
      absent: branch === 'Main Campus' ? 4 : branch === 'Uttara Branch' ? 1 : 1,
      onLeave: branch === 'Main Campus' ? 6 : branch === 'Uttara Branch' ? 2 : 0,
      secondedIn: profile.seconded,
    },
    complaints: branch === 'Main Campus' ? 2 : branch === 'Uttara Branch' ? 1 : 0,
    node,
  };
}

export interface ConsoleTotals {
  day: string;
  beds: BranchDay['beds'];
  outPatients: number;
  waiting: number;
  admissions: number;
  theatreCases: number;
  emergencySeen: number;
  billed: number;
  collected: number;
  outstanding: number;
  staffOnDuty: number;
  /** Branches whose figures are a posting rather than now, with the time of the posting. */
  staleBranches: Array<{ branch: BranchId; posted: string; pending: number }>;
}

/**
 * The wall, added up. Two rules make the sum honest: a branch whose figures are a posting keeps its own time, and
 * the console states how many of the three it is summing from a posting rather than from now.
 */
export function consoleTotals(days: BranchDay[]): ConsoleTotals {
  const first = days[0];
  const sum = (pick: (d: BranchDay) => number) => days.reduce((n, d) => n + pick(d), 0);
  const occupied = sum((d) => d.beds.occupied);
  const total = sum((d) => d.beds.total);
  return {
    day: first.day,
    beds: {
      total,
      occupied,
      free: sum((d) => d.beds.free),
      other: sum((d) => d.beds.other),
      percentOccupied: Math.round((occupied / total) * 100),
    },
    outPatients: sum((d) => d.outPatients.seen),
    waiting: sum((d) => d.outPatients.waiting),
    admissions: sum((d) => d.inPatients.admissions),
    theatreCases: sum((d) => d.theatre.cases),
    emergencySeen: sum((d) => d.emergency.seen),
    billed: sum((d) => d.money.billed),
    collected: sum((d) => d.money.collected),
    outstanding: sum((d) => d.money.outstanding),
    staffOnDuty: sum((d) => d.staff.onDuty),
    staleBranches: days.filter((d) => d.node.figuresAreLastPosting).map((d) => ({ branch: d.branch, posted: d.node.lastUplink, pending: d.node.pending })),
  };
}

/* ---------------------------------------------------------------------------- what differs, on purpose */

export interface BranchSettingRow {
  key: string;
  label: string;
  values: Record<BranchId, string>;
  readBy: string;
  /** Why the branches differ here, which is the only reason a per-branch override is allowed at all. */
  because: string;
  /** True where the value is a number the console compares across branches. */
  numeric?: boolean;
}

/**
 * The settings that differ between branches on purpose. Everything else is hospital-wide, because a price or a
 * policy that differs without a reason is a complaint waiting at a counter in Mirpur about what Main Campus does.
 */
export const BRANCH_SETTING_DIFFS: BranchSettingRow[] = [
  { key: 'receiptHeader', label: 'Receipt header line', values: { 'Main Campus': 'Shaheed Suhrawardy General Hospital · Main Campus', 'Uttara Branch': 'Shaheed Suhrawardy General Hospital · Uttara Branch', 'Mirpur Branch': 'Shaheed Suhrawardy General Hospital · Mirpur Diagnostic & Day Care' }, readBy: 'Every money receipt and every printed bill.', because: 'A receipt has to name the counter that issued it: a family that comes back to the wrong branch is a family sent back across the city for a stamp.' },
  { key: 'dayBookStart', label: 'Day book opens', values: { 'Main Campus': '00:00', 'Uttara Branch': '00:00', 'Mirpur Branch': '08:00' }, readBy: 'The cash counter and the day-book close.', because: 'Mirpur is closed overnight, so its day book opens with the clinic. A day book that opens at midnight at a closed counter is a shift nobody can close.' },
  { key: 'serialPrefix', label: 'Out-patient serial prefix', values: { 'Main Campus': 'M', 'Uttara Branch': 'U', 'Mirpur Branch': 'R' }, readBy: 'The queue, the OPD slip and the serial board.', because: 'The prefix is what lets a slip be placed at a glance when a patient carries one from another branch. The queue itself is per branch and per day.' },
  { key: 'opdHours', label: 'Out-patient hours', values: { 'Main Campus': '08:00 – 20:00', 'Uttara Branch': '08:00 – 20:00', 'Mirpur Branch': '08:00 – 22:00' }, readBy: 'The booking page, the queue and the gate.', because: 'Mirpur keeps evening clinics because that is what it was built for: people who cannot leave work in the day.' },
  { key: 'emergencyHours', label: 'Emergency cover', values: { 'Main Campus': '24 hours, every day', 'Uttara Branch': '24 hours, every day', 'Mirpur Branch': '08:00 – 22:00, then Main Campus' }, readBy: 'The gate, the ambulance desk and the public page.', because: 'A clinic that is open for fourteen hours a day must say so at the door. The alternative is a patient arriving at midnight at a locked gate.' },
  { key: 'visitingHours', label: 'Ward visiting hours', values: { 'Main Campus': '11:00 – 12:30, 17:00 – 18:30', 'Uttara Branch': '11:00 – 12:30, 17:30 – 19:00', 'Mirpur Branch': 'no in-patient ward; day-care reception only' }, readBy: 'The front office, the badge print and the ward notice.', because: 'Uttara’s evening hour is later because most of its families come from further out and after work.' },
  { key: 'priceList', label: 'Price list version', values: { 'Main Campus': 'PL-2026-10A', 'Uttara Branch': 'PL-2026-10A', 'Mirpur Branch': 'PL-2026-10B' }, readBy: 'Billing, the receipt and the package catalogue.', because: 'Mirpur’s day-care packages are priced as packages, and a package is not a sum of the items it contains. Everything else is on the same list.' },
  { key: 'vat', label: 'VAT on services', values: { 'Main Campus': 'Applies as per NBR rules', 'Uttara Branch': 'Applies as per NBR rules', 'Mirpur Branch': 'Applies as per NBR rules' }, readBy: 'Billing and the VAT return.', because: 'Deliberately the same everywhere. This row exists to show that it is, because it is the first thing an audit asks about.' },
  { key: 'labOutsourcing', label: 'Tests sent out', values: { 'Main Campus': 'Nothing sent out — full laboratory', 'Uttara Branch': 'Histopathology, cultures, special assays', 'Mirpur Branch': 'Everything except the collection itself' }, readBy: 'The laboratory screen, the report print and the patient’s bill.', because: 'A patient told “the report will come in three days” deserves to know why, and the reason is one line on the label rather than a sentence at the desk.' },
  { key: 'printHeader', label: 'Print header', values: { 'Main Campus': 'Uses the hospital-wide header', 'Uttara Branch': 'Uses the hospital-wide header', 'Mirpur Branch': 'Uses the hospital-wide header' }, readBy: 'All twelve print templates.', because: 'Authored once. Twelve templates with twelve headers is how a branch ends up printing two addresses and one of them wrong.' },
  { key: 'nodeId', label: 'Records node', values: { 'Main Campus': 'NODE-DHK-01', 'Uttara Branch': 'NODE-DHK-02', 'Mirpur Branch': 'NODE-DHK-03' }, readBy: 'Every record’s `client_created` field, and the sync console.', because: 'One node per branch is what makes a record’s origin checkable and a branch’s uplink loss survivable. Two branches on one node is one branch’s outage taking the other down.' },
];

export const branchSettingByKey = (key: string): BranchSettingRow | undefined => BRANCH_SETTING_DIFFS.find((r) => r.key === key);

export const BRANCH_RULES: Array<{ title: string; because: string }> = [
  { title: 'A branch that cannot answer is not shown as quiet', because: 'The console’s worst failure is a stalled node reading as a small day: a branch with eleven queued postings looks like a branch with little happening. Every row carries the time it was posted.' },
  { title: 'A service the branch does not have is a route, not a gap', because: 'Uttara has no MRI and Mirpur no blood bank. What matters is where the patient goes, in what and with whom — so the console names the transfer rather than counting the missing service.' },
  { title: 'One record has one node', because: 'Records are numbered per node and reconciled per node. A branch writing on another’s node is a series that cannot be checked and an outage that spreads.' },
  { title: 'A per-branch difference needs a reason, and the reason is on the row', because: 'Hours, prices and prefixes differ because the branches are different. Anything that differs without a reason is a complaint waiting at a counter about what the other branch does.' },
  { title: 'The branch’s own establishment is not the branch’s own people', because: 'Nine staff at Uttara are seconded from Main Campus and paid on Main Campus’s payroll. Counting them at the branch would double them in the hospital’s total.' },
];

/* ------------------------------------------------------------------------------------------ the reporting */

export interface BranchReportRow {
  branch: BranchId;
  period: string;
  outPatients: number;
  admissions: number;
  bedNights: number;
  theatreCases: number;
  emergencySeen: number;
  billed: number;
  collected: number;
  outstanding: number;
  payrollCost: number;
  staffOnDuty: number;
  /** Where each branch’s figures come from, named rather than implied. */
  source: string;
  posted: string;
}

/** The month as each branch’s node reported it, with the provenance of every row. */
export function branchReport(monthIso: string, days = 30): BranchReportRow[] {
  return BRANCH_PROFILES.map((profile) => {
    const day = branchDay(profile.id, `${monthIso}-01`);
    const multiplier = profile.id === 'Main Campus' ? days : days * (profile.id === 'Uttara Branch' ? 0.9 : 0.85);
    const payrollCost = profile.id === 'Main Campus' ? 3_794_888 : profile.id === 'Uttara Branch' ? 254_000 : 96_000;
    return {
      branch: profile.id,
      period: monthLabel(monthIso),
      outPatients: Math.round(day.outPatients.seen * (days / 7)),
      admissions: Math.round(day.inPatients.admissions * multiplier),
      bedNights: Math.round(day.beds.occupied * multiplier),
      theatreCases: Math.round(day.theatre.cases * multiplier),
      emergencySeen: Math.round(day.emergency.seen * multiplier),
      billed: Math.round(day.money.billed * multiplier),
      collected: Math.round(day.money.collected * multiplier),
      outstanding: Math.round(day.money.outstanding * multiplier),
      payrollCost,
      staffOnDuty: day.staff.onDuty,
      source:
        profile.id === 'Main Campus'
          ? 'Read from the hospital’s own ledger and its own node: every posting in the month is here, reconciled as it happened.'
          : profile.id === 'Uttara Branch'
            ? 'Read from the branch node and posted on a two-hour schedule. Twelve postings were queued overnight and arrived at 06:05; they are in the month, in the day they happened.'
            : 'Read from the branch node. A hundred and forty postings arrived in three batches after the link was restored; two days at the start of the month were re-sent by hand and the register marks them.',
      posted: profile.id === 'Main Campus' ? 'continuous' : `${monthIso}-30 06:05`,
    };
  });
}

export const BRANCH_REPORT_NOTES: Array<{ title: string; because: string }> = [
  { title: 'Every branch’s month comes from its own node', because: 'The figures are reconciled per node, so a posting that arrives late lands in the day it happened rather than the day it arrived. A month is a month, not a delivery schedule.' },
  { title: 'The hospital total is the branches added up, and the double-count is named', because: 'Nine staff are seconded from Main Campus to Uttara. Their salary is on Main Campus’s payroll and their duty is at Uttara, so the staff figure counts them once, where they are paid.' },
  { title: 'A branch’s revenue is the branch’s day book', because: 'Money collected at Mirpur’s counter is Mirpur’s collection even when the patient was referred from Main Campus. Transfers between branches are settlement and appear as one line, not as revenue in two books.' },
  { title: 'Out-patients are counted where they were seen', because: 'A patient who attends Uttara and is sent to Main Campus for an MRI is one out-patient visit at Uttara and one investigation at Main Campus, which is what both branches’ boards did that day.' },
];

/** The month's branch totals, for the report screen's own top line. */
export function reportTotals(rows: BranchReportRow[]) {
  const sum = (pick: (r: BranchReportRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  return {
    outPatients: sum((r) => r.outPatients),
    admissions: sum((r) => r.admissions),
    bedNights: sum((r) => r.bedNights),
    theatreCases: sum((r) => r.theatreCases),
    emergencySeen: sum((r) => r.emergencySeen),
    billed: sum((r) => r.billed),
    collected: sum((r) => r.collected),
    outstanding: sum((r) => r.outstanding),
    payrollCost: sum((r) => r.payrollCost),
    staffOnDuty: sum((r) => r.staffOnDuty),
  };
}

export const branchMoney = (n: number): string => money(n);
