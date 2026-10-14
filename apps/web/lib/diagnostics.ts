/* -----------------------------------------------------------------------------
 * Diagnostics (P4) — the laboratory and imaging worklist, in code.
 *
 * The rules a laboratory is judged by, written where the screens can be held to them:
 *  - **one specimen, one identifier**: collection, results and the report all carry the same specimen id, so a
 *    result can never be attached to the wrong tube;
 *  - **a reference range is per analyte, not per test**: urea and creatinine in the same panel can disagree, and
 *    the flag has to follow the number that is out;
 *  - **a critical value is not a colour** — it needs a call-back to the clinician, recorded with a name, a time
 *    and a read-back, before the result is released;
 *  - **results are verified by a second person** before they are dispatched;
 *  - **a rejected sample is a real outcome** — the reason and the person are recorded, and it is recollected.
 *
 * Turnaround targets are per test; the worklist shows the deadline, not just the elapsed time, because "how long
 * ago" is not the question a lab manager asks.
 */

import { patients } from './mock';
import { ORDERS, generateEncounters } from './clinical';

export interface Analyte {
  key: string;
  label: string;
  unit: string;
  low: number;
  high: number;
  criticalLow?: number;
  criticalHigh?: number;
  decimals?: number;
}

export interface LabTest {
  code: string;
  name: string;
  nameBn?: string;
  kind: 'lab' | 'imaging';
  sample?: string;
  container?: string;
  method?: string;
  /** Hours allowed from collection to a verified result; the worklist shows the deadline. */
  tatHours: number;
  price: number;
  analytes: Analyte[];
  /** Imaging has no analytes: it has a report signed by a radiologist. */
  modality?: string;
}

export const TESTS: LabTest[] = [
  {
    code: 'CBC',
    name: 'Complete blood count',
    nameBn: 'রক্তের সাধারণ পরীক্ষা',
    kind: 'lab',
    sample: 'Whole blood',
    container: 'EDTA tube',
    method: 'Automated 5-part differential',
    tatHours: 3,
    price: 350,
    analytes: [
      { key: 'hb', label: 'Haemoglobin', unit: 'g/dL', low: 12, high: 16, criticalLow: 7, decimals: 1 },
      { key: 'wbc', label: 'Total WBC', unit: '×10⁹/L', low: 4, high: 11, criticalHigh: 30, decimals: 1 },
      { key: 'platelets', label: 'Platelets', unit: '×10⁹/L', low: 150, high: 450, criticalLow: 50 },
      { key: 'neutrophil', label: 'Neutrophils', unit: '%', low: 40, high: 75 },
    ],
  },
  {
    code: 'FBS',
    name: 'Fasting blood sugar',
    nameBn: 'খালি পেটে সুগার',
    kind: 'lab',
    sample: 'Plasma',
    container: 'Fluoride tube',
    method: 'Hexokinase',
    tatHours: 3,
    price: 200,
    analytes: [
      { key: 'fbs', label: 'Fasting glucose', unit: 'mmol/L', low: 3.9, high: 5.6, criticalLow: 2.5, criticalHigh: 15, decimals: 1 },
    ],
  },
  {
    code: 'HBA1C',
    name: 'HbA1c',
    kind: 'lab',
    sample: 'Whole blood',
    container: 'EDTA tube',
    method: 'HPLC',
    tatHours: 24,
    price: 900,
    analytes: [{ key: 'hba1c', label: 'HbA1c', unit: '%', low: 4, high: 5.7, criticalHigh: 10, decimals: 1 }],
  },
  {
    code: 'LIPID',
    name: 'Lipid profile',
    kind: 'lab',
    sample: 'Serum',
    container: 'Plain tube',
    method: 'Enzymatic',
    tatHours: 6,
    price: 800,
    analytes: [
      { key: 'tc', label: 'Total cholesterol', unit: 'mg/dL', low: 100, high: 200 },
      { key: 'tg', label: 'Triglycerides', unit: 'mg/dL', low: 50, high: 150, criticalHigh: 500 },
      { key: 'hdl', label: 'HDL cholesterol', unit: 'mg/dL', low: 40, high: 90 },
      { key: 'ldl', label: 'LDL cholesterol', unit: 'mg/dL', low: 50, high: 100, criticalHigh: 220 },
    ],
  },
  {
    code: 'LFT',
    name: 'Liver function test',
    kind: 'lab',
    sample: 'Serum',
    container: 'Plain tube',
    method: 'Photometric',
    tatHours: 6,
    price: 850,
    analytes: [
      { key: 'alt', label: 'ALT (SGPT)', unit: 'U/L', low: 7, high: 45, criticalHigh: 300 },
      { key: 'ast', label: 'AST (SGOT)', unit: 'U/L', low: 8, high: 40, criticalHigh: 300 },
      { key: 'bilirubin', label: 'Total bilirubin', unit: 'mg/dL', low: 0.2, high: 1.2, criticalHigh: 5, decimals: 1 },
      { key: 'alp', label: 'Alkaline phosphatase', unit: 'U/L', low: 40, high: 130 },
    ],
  },
  {
    code: 'RFT',
    name: 'Renal function test',
    kind: 'lab',
    sample: 'Serum',
    container: 'Plain tube',
    method: 'Photometric',
    tatHours: 6,
    price: 750,
    analytes: [
      { key: 'urea', label: 'Urea', unit: 'mg/dL', low: 15, high: 45, criticalHigh: 150 },
      { key: 'creatinine', label: 'Creatinine', unit: 'mg/dL', low: 0.6, high: 1.3, criticalHigh: 4, decimals: 2 },
      { key: 'sodium', label: 'Sodium', unit: 'mmol/L', low: 135, high: 145, criticalLow: 120, criticalHigh: 160 },
      { key: 'potassium', label: 'Potassium', unit: 'mmol/L', low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5, decimals: 1 },
    ],
  },
  {
    code: 'TSH',
    name: 'Thyroid stimulating hormone',
    kind: 'lab',
    sample: 'Serum',
    container: 'Plain tube',
    method: 'CLIA',
    tatHours: 24,
    price: 700,
    analytes: [{ key: 'tsh', label: 'TSH', unit: 'mIU/L', low: 0.4, high: 4, criticalHigh: 50, decimals: 2 }],
  },
  {
    code: 'URINE',
    name: 'Urine routine examination',
    kind: 'lab',
    sample: 'Urine',
    container: 'Urine pot',
    method: 'Dipstick + microscopy',
    tatHours: 3,
    price: 250,
    analytes: [
      { key: 'albumin', label: 'Albumin', unit: 'mg/dL', low: 0, high: 15 },
      { key: 'pusCells', label: 'Pus cells', unit: '/hpf', low: 0, high: 5 },
      { key: 'rbc', label: 'Red cells', unit: '/hpf', low: 0, high: 2 },
    ],
  },
  {
    code: 'MP',
    name: 'Malaria parasite (ICT + film)',
    kind: 'lab',
    sample: 'Whole blood',
    container: 'EDTA tube',
    method: 'Rapid antigen + thick film',
    tatHours: 2,
    price: 400,
    analytes: [],
  },
  { code: 'CXR', name: 'Chest X-ray PA', nameBn: 'বুকের এক্স-রে', kind: 'imaging', modality: 'X-ray', tatHours: 4, price: 800, analytes: [] },
  { code: 'USG', name: 'Ultrasonography whole abdomen', nameBn: 'আল্ট্রাসনোগ্রাফি', kind: 'imaging', modality: 'Ultrasound', tatHours: 6, price: 1200, analytes: [] },
  { code: 'ECG', name: 'ECG 12 lead', kind: 'imaging', modality: 'ECG', tatHours: 1, price: 500, analytes: [] },
];

export const testByCode = (code: string): LabTest | undefined => TESTS.find((t) => t.code === code);

/* ------------------------------------------------------------------------------ flags */

export type ResultFlag = 'ok' | 'low' | 'high' | 'critical-low' | 'critical-high' | 'text';

export function flagValue(analyte: Analyte, value: number): ResultFlag {
  if (analyte.criticalHigh !== undefined && value >= analyte.criticalHigh) return 'critical-high';
  if (analyte.criticalLow !== undefined && value <= analyte.criticalLow) return 'critical-low';
  if (value > analyte.high) return 'high';
  if (value < analyte.low) return 'low';
  return 'ok';
}

export const flagLabel: Record<ResultFlag, string> = {
  ok: 'Normal',
  low: 'Low',
  high: 'High',
  'critical-low': 'Critical low',
  'critical-high': 'Critical high',
  text: 'Entered',
};

export const isCritical = (flag: ResultFlag): boolean => flag === 'critical-low' || flag === 'critical-high';

export const flagTone: Record<ResultFlag, 'neutral' | 'warning' | 'critical'> = {
  ok: 'neutral',
  low: 'warning',
  high: 'warning',
  'critical-low': 'critical',
  'critical-high': 'critical',
  text: 'neutral',
};

/* ------------------------------------------------------------------------------ worklist */

export type DiagnosticStatus = 'Ordered' | 'Collected' | 'In lab' | 'Resulted' | 'Verified' | 'Dispatched' | 'Rejected';

export const STATUS_FLOW: Record<DiagnosticStatus, DiagnosticStatus[]> = {
  Ordered: ['Collected', 'Rejected'],
  Collected: ['In lab', 'Rejected'],
  'In lab': ['Resulted', 'Rejected'],
  Resulted: ['Verified'],
  Verified: ['Dispatched'],
  Dispatched: [],
  Rejected: ['Collected'],
};

export const statusTone: Record<DiagnosticStatus, 'neutral' | 'info' | 'warning' | 'success' | 'critical'> = {
  Ordered: 'info',
  Collected: 'info',
  'In lab': 'warning',
  Resulted: 'warning',
  Verified: 'success',
  Dispatched: 'success',
  Rejected: 'critical',
};

/** Stages that carry a result. A helper rather than an inline array, so the comparison stays type-checkable. */
const RESULT_STAGES: DiagnosticStatus[] = ['Resulted', 'Verified', 'Dispatched'];
export const hasResults = (status: DiagnosticStatus): boolean => RESULT_STAGES.includes(status);

export interface Callback {
  at: string;
  by: string;
  toWhom: string;
  readBack: boolean;
  note?: string;
}

export interface DiagnosticOrder {
  id: string;
  specimenId: string;
  encounterId?: string;
  patient: { mrn: string; name: string; nameBn: string; age: number; sex: string; phone: string; payer: string };
  testCode: string;
  testName: string;
  kind: 'lab' | 'imaging';
  sample?: string;
  container?: string;
  modality?: string;
  priority: 'Routine' | 'Urgent' | 'STAT';
  orderedAt: string;
  collectedAt?: string;
  collectedBy?: string;
  /** Deadline for a verified result, computed from collection + the test's turnaround. */
  dueAt: string;
  status: DiagnosticStatus;
  results: Record<string, number | string>;
  /** Free text for the report body: imaging findings, or a note on a result. */
  report?: string;
  resultedAt?: string;
  resultedBy?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  dispatchedAt?: string;
  dispatchTo?: 'Print' | 'Patient portal' | 'Ward printer' | 'Referring doctor';
  rejection?: { reason: string; by: string; at: string };
  callback?: Callback;
}

const REJECTION_REASONS = [
  'Haemolysed sample',
  'Tube not labelled at the bedside',
  'Insufficient quantity (short draw)',
  'Clotted specimen',
  'Wrong container for the test',
];

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const addHours = (stamp: string, hours: number): string => {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp)) {
    throw new Error(`Expected a YYYY-MM-DD HH:MM stamp, got "${stamp}"`);
  }
  const d = new Date(`${stamp.replace(' ', 'T')}:00`);
  d.setMinutes(d.getMinutes() + hours * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.toISOString().slice(0, 10)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A plausible value for an analyte: mostly inside the range, sometimes outside, occasionally critical. */
function sampleValue(analyte: Analyte, rand: () => number): number {
  const span = analyte.high - analyte.low;
  const roll = rand();
  const raw =
    roll < 0.62
      ? analyte.low + span * (0.25 + rand() * 0.5)
      : roll < 0.82
        ? analyte.high + span * (0.05 + rand() * 0.25)
        : roll < 0.94
          ? analyte.low - span * (0.05 + rand() * 0.2)
          : (analyte.criticalHigh ?? analyte.high * 2) + span * 0.1;
  const decimals = analyte.decimals ?? 0;
  return Number(raw.toFixed(decimals));
}

/** Today's specimens: the orders the doctors actually placed, plus a few walk-ins from the emergency desk. */
export function generateDiagnosticOrders(dayIso: string): DiagnosticOrder[] {
  const rand = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 13) * 4409);
  const encounters = generateEncounters(dayIso);
  const orders: DiagnosticOrder[] = [];
  let counter = 0;

  const fromEncounter = encounters.flatMap((enc) =>
    enc.orders.map((o) => ({ enc, order: o })),
  );

  for (const { enc, order } of fromEncounter) {
    const test = testByCode(order.code) ?? TESTS[0];
    counter += 1;
    const specimenId = order.specimenId ?? `SP-${String(4100 + counter)}`;
    const orderedAt = enc.signedAt ?? enc.arrivedAt;
    const collected = enc.status === 'Signed' && test.kind === 'lab';
    const status: DiagnosticStatus = collected ? (rand() < 0.35 ? 'Resulted' : rand() < 0.6 ? 'In lab' : 'Collected') : test.kind === 'imaging' ? 'Ordered' : 'Ordered';
    const results: Record<string, number | string> = {};
    if (hasResults(status)) {
      for (const a of test.analytes) results[a.key] = sampleValue(a, rand);
    }
    orders.push({
      id: `ORD-${dayIso.replace(/-/g, '')}-${String(counter).padStart(3, '0')}`,
      specimenId,
      encounterId: enc.id,
      patient: {
        mrn: enc.patient.mrn,
        name: enc.patient.name,
        nameBn: enc.patient.nameBn,
        age: enc.patient.age,
        sex: enc.patient.sex,
        phone: enc.patient.phone,
        payer: enc.patient.payer,
      },
      testCode: test.code,
      testName: test.name,
      kind: test.kind,
      sample: test.sample,
      container: test.container,
      modality: test.modality,
      priority: order.priority === 'STAT' ? 'STAT' : order.priority === 'Urgent' ? 'Urgent' : 'Routine',
      orderedAt,
      collectedAt: collected ? addHours(orderedAt, rand() < 0.5 ? 0 : 1) : undefined,
      collectedBy: collected ? 'S. Mia (phlebotomy)' : undefined,
      dueAt: addHours(collected ? addHours(orderedAt, 1) : orderedAt, test.tatHours),
      status,
      results,
      report: test.kind === 'imaging' && status !== 'Ordered' && status !== 'Collected' && status !== 'In lab' ? 'No active lung lesion. Cardiothoracic ratio within normal limits.' : undefined,
      resultedAt: status === 'Resulted' ? addHours(orderedAt, test.tatHours) : undefined,
      resultedBy: status === 'Resulted' ? 'A. Kabir (technologist)' : undefined,
    });
  }

  // Walk-ins with no encounter (emergency desk, antenatal clinic screening).
  const extras: Array<{ code: string; status: DiagnosticStatus }> = [
    { code: 'CBC', status: 'Verified' },
    { code: 'FBS', status: 'Dispatched' },
    { code: 'URINE', status: 'Rejected' },
    { code: 'MP', status: 'Collected' },
    { code: 'RFT', status: 'Resulted' },
  ];
  for (const extra of extras) {
    const test = testByCode(extra.code)!;
    const patient = patients[Math.floor(rand() * patients.length)];
    counter += 1;
    const orderedAt = `${dayIso} ${String(8 + Math.floor(rand() * 4)).padStart(2, '0')}:${String(Math.floor(rand() * 59)).padStart(2, '0')}`;
    const results: Record<string, number | string> = {};
    if (hasResults(extra.status)) {
      for (const a of test.analytes) results[a.key] = sampleValue(a, rand);
    }
    const rejected = extra.status === 'Rejected';
    orders.push({
      id: `ORD-${dayIso.replace(/-/g, '')}-${String(counter).padStart(3, '0')}`,
      specimenId: `SP-${String(4300 + counter)}`,
      patient: {
        mrn: patient.mrn,
        name: patient.name,
        nameBn: patient.nameBn,
        age: patient.age,
        sex: patient.sex,
        phone: patient.phone,
        payer: patient.payer,
      },
      testCode: test.code,
      testName: test.name,
      kind: test.kind,
      sample: test.sample,
      container: test.container,
      priority: rand() < 0.2 ? 'Urgent' : 'Routine',
      orderedAt,
      collectedAt: rejected ? addHours(orderedAt, 0) : addHours(orderedAt, 1),
      collectedBy: rejected ? 'S. Mia (phlebotomy)' : undefined,
      dueAt: addHours(orderedAt, 1 + test.tatHours),
      status: extra.status,
      results,
      rejection: rejected
        ? { reason: REJECTION_REASONS[Math.floor(rand() * REJECTION_REASONS.length)], by: 'F. Rahman (lab)', at: addHours(orderedAt, 2) }
        : undefined,
      resultedAt: hasResults(extra.status) ? addHours(orderedAt, test.tatHours) : undefined,
      resultedBy: hasResults(extra.status) ? 'A. Kabir (technologist)' : undefined,
      verifiedBy: ['Verified', 'Dispatched'].includes(extra.status) ? 'Dr. N. Islam (pathologist)' : undefined,
      verifiedAt: ['Verified', 'Dispatched'].includes(extra.status) ? addHours(orderedAt, test.tatHours + 1) : undefined,
      dispatchedAt: extra.status === 'Dispatched' ? addHours(orderedAt, test.tatHours + 2) : undefined,
      dispatchTo: extra.status === 'Dispatched' ? 'Print' : undefined,
    });
  }

  return orders.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
}

/** The worst flag on an order, which is what the worklist row shows. */
export function worstFlag(order: DiagnosticOrder): ResultFlag {
  const test = testByCode(order.testCode);
  if (!test || Object.keys(order.results).length === 0) return 'text';
  const flags = test.analytes
    .filter((a) => typeof order.results[a.key] === 'number')
    .map((a) => flagValue(a, Number(order.results[a.key])));
  if (flags.includes('critical-high') || flags.includes('critical-low')) return flags.find(isCritical)!;
  if (flags.includes('high')) return 'high';
  if (flags.includes('low')) return 'low';
  return 'ok';
}

export const needsCallback = (order: DiagnosticOrder): boolean => isCritical(worstFlag(order));

/** Turnaround position, measured against the clock rather than the elapsed time. */
export function tatStatus(order: DiagnosticOrder, now: string): { label: string; tone: 'neutral' | 'warning' | 'critical' } {
  if (['Verified', 'Dispatched', 'Rejected'].includes(order.status)) {
    return { label: order.status === 'Rejected' ? 'Recollect' : 'Done', tone: order.status === 'Rejected' ? 'critical' : 'neutral' };
  }
  const due = new Date(`${order.dueAt.replace(' ', 'T')}:00`).getTime();
  const at = new Date(`${now.replace(' ', 'T')}:00`).getTime();
  const minutes = Math.round((due - at) / 60000);
  if (minutes < 0) return { label: `${Math.abs(minutes)} min overdue`, tone: 'critical' };
  if (minutes <= 60) return { label: `${minutes} min left`, tone: 'warning' };
  return { label: `${Math.round(minutes / 60)} h left`, tone: 'neutral' };
}

/* ------------------------------------------------------------------------------ quality control */

export interface QcRun {
  id: string;
  at: string;
  analyser: string;
  analyte: string;
  level: 'Normal' | 'Abnormal';
  value: number;
  target: number;
  /** Allowable deviation from the target for that level. */
  sd: number;
  passed: boolean;
  comment?: string;
}

export function generateQc(dayIso: string): QcRun[] {
  const rand = rng(5150);
  const setups: Array<[string, string, number, number]> = [
    ['Haematology — Sysmex XN-550', 'Haemoglobin', 13.2, 0.4],
    ['Haematology — Sysmex XN-550', 'Platelets', 240, 12],
    ['Biochemistry — Mindray BS-240', 'Glucose', 5.4, 0.2],
    ['Biochemistry — Mindray BS-240', 'Creatinine', 1.1, 0.08],
    ['Biochemistry — Mindray BS-240', 'ALT', 32, 3],
  ];
  const runs: QcRun[] = [];
  for (const level of ['Normal', 'Abnormal'] as const) {
    for (const [analyser, analyte, target, sd] of setups) {
      const drift = (rand() * 2 - 1) * sd * (rand() < 0.09 ? 3.2 : 1.1); // one deliberate out-of-range run
      const value = Number((target * (level === 'Normal' ? 1 : 2.4) + drift).toFixed(2));
      const passed = Math.abs(drift) <= sd * 2;
      runs.push({
        id: `QC-${runs.length + 1}`,
        at: `${dayIso} 07:${String(10 + runs.length * 3).padStart(2, '0')}`,
        analyser,
        analyte,
        level,
        value,
        target: Number((target * (level === 'Normal' ? 1 : 2.4)).toFixed(2)),
        sd,
        passed,
        comment: passed ? undefined : 'Out of range — repeated; patient results held until it was cleared',
      });
    }
  }
  return runs;
}

export const DISPATCH_OPTIONS: Array<NonNullable<DiagnosticOrder['dispatchTo']>> = ['Print', 'Patient portal', 'Ward printer', 'Referring doctor'];

/** The order of the worklist tabs is the physical journey of a specimen, not an alphabet. */
export const WORKLIST_STAGES: DiagnosticStatus[] = ['Ordered', 'Collected', 'In lab', 'Resulted', 'Verified', 'Dispatched'];

export const ORDER_CATALOGUE = ORDERS;
