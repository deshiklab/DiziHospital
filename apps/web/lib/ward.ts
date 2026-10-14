/* -----------------------------------------------------------------------------
 * Ward (P5) — the in-patient data layer: beds, admissions, observations, nursing notes, the medication round,
 * handover and discharge.
 *
 * This is the module where a software mistake is a person, so the rules are written down as code and the screen
 * only renders them:
 *
 *  1. **A bed has a state, and every state change has a reason and a name.** A bed cannot go from Occupied to
 *     Free without a discharge recorded against the admission that held it.
 *  2. **Every admission has a consultant and a working diagnosis.** "Under observation" is a note, not a
 *     diagnosis, and it does not belong in the register.
 *  3. **Observations produce an early-warning score, and the score has a required response.** 0–4 is routine
 *     4-hourly, 5–6 needs a doctor's review, 7 or more needs the emergency response — and an escalation that
 *     happened is recorded with who came and what changed.
 *  4. **A dose is not given until it is checked.** The nurse records the patient-and-drug check; a controlled
 *     drug additionally needs a witness by name; a held or refused dose needs a reason; a PRN dose needs an
 *     indication. The five rights are not decoration — each one is a field that can fail validation.
 *  5. **A discharge is a document, not a state.** Type, course, condition, medicines to continue and a follow-up
 *     date, or it does not happen. Discharge with the bill unsettled is allowed — hospitals do it — but it is
 *     recorded and counted, because an unbilled discharge is money the branch never sees.
 *
 * Everything here is deterministic on the day, like the rest of the preview: the rules are real, the patients
 * and the numbers are not.
 */

import { patients, type Patient } from './mock';
import { DRUGS, drugById, type Drug } from './pharmacy';
import { ICD10, type Frequency, type RxLine } from './clinical';
import { DOCTORS } from './appointments';
import { money } from './billing';

/* ------------------------------------------------------------------ helpers */

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minutes past midnight → "HH:MM". Minutes are carried, never appended: 09:70 is not a time. */
export const clock = (minutes: number): string => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const parseClock = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** ISO day arithmetic, local like the rest of the app's generated days. */
export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];

/* ------------------------------------------------------------------ wards and beds */

export type BedClass = 'General' | 'Cabin' | 'HDU' | 'Isolation';
export type BedStatus = 'Free' | 'Occupied' | 'Cleaning' | 'Reserved' | 'Blocked';

export const BED_STATUSES: BedStatus[] = ['Free', 'Occupied', 'Cleaning', 'Reserved', 'Blocked'];

export const bedTone: Record<BedStatus, 'neutral' | 'info' | 'warning' | 'success' | 'critical'> = {
  Free: 'success',
  Occupied: 'info',
  Cleaning: 'warning',
  Reserved: 'warning',
  Blocked: 'critical',
};

/** Which states a bed can move to, and what the move must carry. A bed never jumps straight to Free. */
export const BED_FLOW: Record<BedStatus, Array<{ to: BedStatus; label: string; needs: string[] }>> = {
  Free: [
    { to: 'Reserved', label: 'Reserve for an expected admission', needs: ['reference', 'until'] },
    { to: 'Blocked', label: 'Block the bed', needs: ['reason'] },
  ],
  Occupied: [
    { to: 'Cleaning', label: 'Discharge and send for cleaning', needs: ['dischargeType'] },
    { to: 'Reserved', label: 'Hold for an incoming transfer', needs: ['reference'] },
  ],
  Cleaning: [
    { to: 'Free', label: 'Cleaning finished — bed is free', needs: ['checkedBy'] },
    { to: 'Blocked', label: 'Take the bed out of service', needs: ['reason'] },
  ],
  Reserved: [
    { to: 'Occupied', label: 'Admit the patient into this bed', needs: ['mrn', 'consultantId', 'reason'] },
    { to: 'Free', label: 'Release the reservation', needs: ['reason'] },
  ],
  Blocked: [{ to: 'Cleaning', label: 'Reopen: clean and check', needs: ['reason'] }],
};

/** Housekeeping turn-around, in minutes. A bed in Cleaning longer than this is a bed nobody can admit into. */
export const CLEANING_TARGET_MIN = 90;

export interface Ward {
  id: string;
  name: string;
  nameBn: string;
  prefix: string;
  floor: string;
  /** The mix this ward was built for; the board shows it so a queue for a cabin is visible before it starts. */
  classes: BedClass[];
  beds: number;
  cabins: number;
  inCharge: string;
  nurseRatio: string;
}

export const WARDS: Ward[] = [
  { id: 'med-a', name: 'Medicine Ward A', nameBn: 'মেডিসিন ওয়ার্ড এ', prefix: 'A', floor: '2nd floor', classes: ['General', 'Cabin'], beds: 24, cabins: 4, inCharge: 'S. Rahman (senior staff nurse)', nurseRatio: '1 nurse : 8 beds' },
  { id: 'surg-b', name: 'Surgery Ward B', nameBn: 'সার্জারি ওয়ার্ড বি', prefix: 'B', floor: '3rd floor', classes: ['General', 'Cabin'], beds: 18, cabins: 3, inCharge: 'M. Akter (senior staff nurse)', nurseRatio: '1 nurse : 6 beds' },
  { id: 'mat-c', name: 'Maternity Ward C', nameBn: 'প্রসূতি ওয়ার্ড সি', prefix: 'C', floor: '4th floor', classes: ['General', 'Cabin'], beds: 12, cabins: 2, inCharge: 'R. Begum (senior staff nurse)', nurseRatio: '1 nurse : 6 beds' },
  { id: 'hdu', name: 'High Dependency Unit', nameBn: 'এইচডিইউ', prefix: 'H', floor: '5th floor', classes: ['HDU', 'Isolation'], beds: 6, cabins: 0, inCharge: 'K. Islam (ICU-trained nurse)', nurseRatio: '1 nurse : 2 beds' },
];

export interface Bed {
  id: string;
  wardId: string;
  /** What is written on the wall and on the bed: A-01. */
  label: string;
  class: BedClass;
  status: BedStatus;
  /** Set while the bed is Occupied — the admission that holds it. */
  admissionId?: string;
  /** Why it is not free, wherever the reason lives: cleaning, reserving, blocking. */
  note?: string;
  /** Set when the bed entered Cleaning, so the board can show how long it has been out of service. */
  cleaningSince?: string;
  /** For a Reserved bed: who is coming and when. */
  reservedFor?: string;
}

/** Per-day charge by bed class, in Taka. The ward bill is built from this, not from a nightly guess. */
export const BED_CHARGE: Record<BedClass, number> = { General: 1200, Cabin: 4500, HDU: 7000, Isolation: 3500 };

/* ------------------------------------------------------------------ staff */

export interface WardStaff {
  id: string;
  name: string;
  role: 'Consultant' | 'Registrar' | 'Intern' | 'Senior staff nurse' | 'Staff nurse' | 'Aya';
  wardIds: string[];
  shift?: Shift;
}

export type Shift = 'Morning' | 'Evening' | 'Night';

export const SHIFTS: Shift[] = ['Morning', 'Evening', 'Night'];

/** Shift boundaries: handover is at 07:00 and 14:00 and 21:00, and the board says which one is on. */
export const SHIFT_START: Record<Shift, string> = { Morning: '07:00', Evening: '14:00', Night: '21:00' };

export const shiftAt = (hhmm: string): Shift => {
  const m = parseClock(hhmm);
  if (m >= parseClock('07:00') && m < parseClock('14:00')) return 'Morning';
  if (m >= parseClock('14:00') && m < parseClock('21:00')) return 'Evening';
  return 'Night';
};

export const STAFF: WardStaff[] = [
  { id: 'n-sultana', name: 'S. Sultana', role: 'Senior staff nurse', wardIds: ['med-a'] },
  { id: 'n-haque', name: 'N. Haque', role: 'Staff nurse', wardIds: ['med-a'] },
  { id: 'n-akter', name: 'M. Akter', role: 'Senior staff nurse', wardIds: ['surg-b'] },
  { id: 'n-begum', name: 'R. Begum', role: 'Senior staff nurse', wardIds: ['mat-c'] },
  { id: 'n-islam', name: 'K. Islam', role: 'Staff nurse', wardIds: ['hdu'] },
  { id: 'n-das', name: 'P. Das', role: 'Staff nurse', wardIds: ['hdu', 'surg-b'] },
  { id: 'r-kabir', name: 'Dr. F. Kabir', role: 'Registrar', wardIds: ['med-a', 'hdu'] },
  { id: 'r-noor', name: 'Dr. S. Noor', role: 'Registrar', wardIds: ['surg-b', 'mat-c'] },
  { id: 'i-hasan', name: 'Dr. T. Hasan', role: 'Intern', wardIds: ['med-a', 'mat-c'] },
];

export const staffById = (id: string): WardStaff | undefined => STAFF.find((s) => s.id === id);
export const wardById = (id: string): Ward | undefined => WARDS.find((w) => w.id === id);
export const wardName = (id: string): string => wardById(id)?.name ?? id;

/* ------------------------------------------------------------------ early warning score */

export type EwsBand = 'Routine' | 'Watch' | 'Escalate' | 'Emergency';

export const EWS_RESPONSE: Record<EwsBand, { obs: string; response: string; tone: 'neutral' | 'info' | 'warning' | 'critical' }> = {
  Routine: { obs: '4-hourly observations', response: 'Ward routine. Continue the plan.', tone: 'neutral' },
  Watch: { obs: 'Hourly observations', response: 'Tell the nurse in charge; repeat in one hour.', tone: 'info' },
  Escalate: { obs: 'Continuous observation', response: 'Doctor reviews within 30 minutes and documents the plan.', tone: 'warning' },
  Emergency: { obs: 'Continuous observation, nurse at the bedside', response: 'Emergency response: doctor now, resuscitation trolley to the bed.', tone: 'critical' },
};

const bandOf = (score: number): EwsBand => (score >= 7 ? 'Emergency' : score >= 5 ? 'Escalate' : score >= 1 ? 'Watch' : 'Routine');

export interface EwsParam {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  points: number;
  /** The plain-language reason for the points, so the score can be argued with rather than obeyed blindly. */
  reason: string;
}

/** ACVPU, the consciousness scale: the one parameter a nurse cannot measure with a device. */
export const CONSCIOUSNESS: Array<{ key: string; label: string; points: number }> = [
  { key: 'A', label: 'Alert', points: 0 },
  { key: 'C', label: 'New confusion', points: 3 },
  { key: 'V', label: 'Responds to voice', points: 3 },
  { key: 'P', label: 'Responds to pain', points: 3 },
  { key: 'U', label: 'Unresponsive', points: 3 },
];

const bands = (value: number, table: Array<[number, number, number]>): { points: number; reason: string } => {
  for (const [low, high, points] of table) {
    if (value >= low && value <= high) {
      if (points === 0) return { points: 0, reason: 'within the normal range' };
      return { points, reason: points >= 3 ? 'well outside the normal range' : 'outside the normal range' };
    }
  }
  return { points: 3, reason: 'outside every band on the chart' };
};

/**
 * NEWS-style aggregate. The point of a score is the *response* it triggers, so the band comes with a required
 * action instead of a colour; a number with no action attached is a number that gets ignored at handover.
 */
export function earlyWarningScore(values: Partial<Record<string, number>>, consciousness = 'A'): { score: number; band: EwsBand; params: EwsParam[] } {
  const params: EwsParam[] = [];
  const add = (key: string, label: string, unit: string, raw: number | undefined, table: Array<[number, number, number]>) => {
    if (raw === undefined) return;
    const { points, reason } = bands(raw, table);
    params.push({ key, label, value: raw, unit, points, reason });
  };

  add('respRate', 'Respiratory rate', '/min', values.respRate, [
    [0, 8, 3], [9, 11, 1], [12, 20, 0], [21, 24, 2], [25, 60, 3],
  ]);
  add('spo2', 'SpO₂', '%', values.spo2, [
    [0, 91, 3], [92, 93, 2], [94, 95, 1], [96, 100, 0],
  ]);
  add('temperature', 'Temperature', '°C', values.temperature, [
    [0, 35, 3], [35.1, 36, 1], [36.1, 38, 0], [38.1, 39, 1], [39.1, 45, 2],
  ]);
  add('systolic', 'Systolic BP', 'mmHg', values.systolic, [
    [0, 90, 3], [91, 100, 2], [101, 110, 1], [111, 219, 0], [220, 300, 3],
  ]);
  add('pulse', 'Pulse', '/min', values.pulse, [
    [0, 40, 3], [41, 50, 1], [51, 90, 0], [91, 110, 1], [111, 130, 2], [131, 260, 3],
  ]);

  const level = CONSCIOUSNESS.find((c) => c.key === consciousness) ?? CONSCIOUSNESS[0];
  params.push({ key: 'consciousness', label: 'Consciousness (ACVPU)', value: level.key, unit: '', points: level.points, reason: level.label });

  const score = params.reduce((sum, p) => sum + p.points, 0);
  return { score, band: bandOf(score), params };
}

/* ------------------------------------------------------------------ admissions */

export interface Admission {
  id: string;
  mrn: string;
  patient: Pick<Patient, 'mrn' | 'name' | 'nameBn' | 'age' | 'sex' | 'phone' | 'allergies' | 'payer'>;
  wardId: string;
  bedId: string;
  admittedAt: string;
  admittedBy: string;
  consultantId: string;
  consultantName: string;
  registrarId?: string;
  /** Why this patient is in a bed. Free text, because the register is read by humans. */
  reason: string;
  diagnosis?: { code: string; label: string };
  /** The label attached to the bed, e.g. contact precautions. */
  isolation?: string;
  class: BedClass;
  severity: 'Stable' | 'Guarded' | 'Critical';
  /** Documented decisions about ceilings of care; absent means "not discussed yet", which the round flags. */
  codeStatus?: 'For full care' | 'Limited intervention' | 'Not for resuscitation (documented)';
  expectedStayDays: number;
  /** Came from another branch: the transfer is the record that the patient exists twice, once per site. */
  transferredFrom?: string;
  plannedDischargeToday: boolean;
  /** Nil by mouth and similar bed-level instructions the nurse has to see before the drug round. */
  instructions?: string[];
}

export const ADMIT_REASONS = [
  'Shortness of breath, not settling in the emergency room',
  'Fever with low blood pressure, for intravenous antibiotics',
  'Uncontrolled diabetes, for insulin titration',
  'Chest pain, for observation and serial troponin',
  'Post-operative care after appendicectomy',
  'Road traffic injury, for observation of the head',
  'Severe anaemia, for transfusion work-up',
  'Antenatal admission for raised blood pressure',
  'Gastroenteritis with dehydration, for fluids',
  'Stroke, for thrombolysis assessment',
];

export const SEVERITY_TONE: Record<Admission['severity'], 'success' | 'warning' | 'critical'> = {
  Stable: 'success',
  Guarded: 'warning',
  Critical: 'critical',
};

/* ------------------------------------------------------------------ observations and notes */

export interface VitalSet {
  id: string;
  admissionId: string;
  at: string;
  by: string;
  values: Partial<Record<string, number>>;
  consciousness: string;
  score: number;
  band: EwsBand;
  params: EwsParam[];
  /** Recorded when the band demanded a review: who came, when, and what changed. */
  escalated?: { at: string; to: string; response: string };
}

export type NoteKind = 'Note' | 'Observation' | 'Intake/output' | 'Wound care' | 'Escalation' | 'Family update' | 'Procedure';

export const NOTE_KINDS: NoteKind[] = ['Note', 'Observation', 'Intake/output', 'Wound care', 'Escalation', 'Family update', 'Procedure'];

export interface NursingNote {
  id: string;
  admissionId: string;
  at: string;
  by: string;
  shift: Shift;
  kind: NoteKind;
  text: string;
}

/* ------------------------------------------------------------------ the medication round */

export type DoseStatus = 'Due' | 'Given' | 'Held' | 'Refused' | 'Not given';

export const DOSE_TONE: Record<DoseStatus, 'neutral' | 'info' | 'warning' | 'success' | 'critical'> = {
  Due: 'warning',
  Given: 'success',
  Held: 'warning',
  Refused: 'critical',
  'Not given': 'critical',
};

export interface MarDose {
  id: string;
  admissionId: string;
  wardId: string;
  drugId: string;
  brand: string;
  generic: string;
  strength: string;
  dose: string;
  route: string;
  frequency: Frequency;
  prn: boolean;
  controlled: boolean;
  highAlert: boolean;
  scheduledAt: string;
  status: DoseStatus;
  givenAt?: string;
  givenBy?: string;
  /** Recorded before the dose: right patient, right drug, read off the pack. */
  checked: boolean;
  /** Required for a controlled drug. A signature without a witness is not an administration record. */
  witness?: string;
  /** Required for Held and Refused. */
  reason?: string;
  /** Required for a PRN dose: why it was given, not just that it was. */
  indication?: string;
}

/** When a frequency is taken, in minutes past midnight. As-needed medicines have no schedule — they have a reason. */
export const FREQUENCY_TIMES: Record<Frequency, number[]> = {
  'Once daily': [480],
  'Twice daily': [480, 1200],
  'Three times a day': [420, 840, 1260],
  'Four times a day': [360, 720, 1080, 1320],
  'Every 6 hours': [360, 720, 1080, 1320],
  'At bedtime': [1320],
  'As needed (PRN)': [],
};

/** A dose more than two hours past its slot is late, and the round says so instead of rounding it away. */
export const LATE_MINUTES = 120;
export const isLate = (dose: MarDose, nowMinutes: number): boolean =>
  dose.status === 'Due' && nowMinutes - parseClock(dose.scheduledAt) > LATE_MINUTES;

/**
 * The five rights, each one a field that can be missing. The screen calls this before it lets a nurse sign, so
 * the rule lives here rather than in a validation message that a future screen forgets to copy.
 */
export function doseBlockers(dose: MarDose): string[] {
  const blockers: string[] = [];
  const administered = dose.status === 'Given';
  // The check is performed at the bedside, at the moment of administration — so it is only a *missing* field on
  // a dose that was actually given. A dose still due is not in error; it is work.
  if (administered && !dose.checked) blockers.push('Given without the patient-and-drug check recorded');
  if (administered && dose.controlled && !dose.witness) blockers.push('A controlled drug needs a witness by name');
  if ((dose.status === 'Held' || dose.status === 'Refused' || dose.status === 'Not given') && !dose.reason) {
    blockers.push('A dose that was not given needs a reason');
  }
  if (administered && dose.prn && !dose.indication) blockers.push('A PRN dose needs the indication it was given for');
  return blockers;
}

export function marStats(mar: MarDose[], nowMinutes: number) {
  const scheduled = mar.filter((d) => !d.prn);
  const given = scheduled.filter((d) => d.status === 'Given');
  const due = scheduled.filter((d) => d.status === 'Due');
  const late = due.filter((d) => isLate(d, nowMinutes));
  const held = scheduled.filter((d) => d.status === 'Held' || d.status === 'Refused');
  const onTime = given.filter((d) => d.givenAt && parseClock(d.givenAt) - parseClock(d.scheduledAt) <= LATE_MINUTES);
  // Controlled and PRN doses are counted over the WHOLE round, not just the scheduled one: an as-needed opioid
  // that was given is still a controlled administration and still needs its witness.
  const controlledGiven = mar.filter((d) => d.controlled && d.status === 'Given');
  const controlledUnwitnessed = controlledGiven.filter((d) => !d.witness);
  return {
    scheduled: scheduled.length,
    given: given.length,
    due: due.length,
    late: late.length,
    held: held.length,
    onTime: onTime.length,
    /** Percentage of doses that were given inside the two-hour window; the number the ward is judged on. */
    compliancePct: given.length ? Math.round((onTime.length / given.length) * 100) : 100,
    controlledGiven: controlledGiven.length,
    controlledUnwitnessed: controlledUnwitnessed.length,
  };
}

/* ------------------------------------------------------------------ handover, transfer, discharge */

export interface HandoverTask {
  text: string;
  owner: string;
  done: boolean;
}

export interface Handover {
  id: string;
  wardId: string;
  shift: Shift;
  at: string;
  by: string;
  to: string;
  sbar: { situation: string; background: string; assessment: string; recommendation: string };
  /** The jobs the next shift is asked to finish. Handover without a task list is a conversation nobody wrote down. */
  tasks: HandoverTask[];
}

export interface BedTransfer {
  id: string;
  admissionId: string;
  mrn: string;
  at: string;
  by: string;
  fromBed: string;
  fromWardId: string;
  toBed?: string;
  toWardId?: string;
  /** Set when the patient left the building — a branch transfer is a different kind of event. */
  toBranch?: string;
  reason: string;
  acceptedBy?: string;
}

export const DISCHARGE_TYPES = [
  'Recovered',
  'Improved, follow-up in OPD',
  'Referred to a higher centre',
  'Discharged on request',
  'Left against medical advice',
  'Transferred to another branch',
  'Died',
] as const;

export type DischargeType = (typeof DISCHARGE_TYPES)[number];

export interface DischargeRecord {
  id: string;
  admissionId: string;
  mrn: string;
  name: string;
  nameBn: string;
  age: number;
  sex: Patient['sex'];
  wardId: string;
  bedId: string;
  admittedAt: string;
  dischargedAt: string;
  stayedDays: number;
  type: DischargeType;
  diagnosis: { code: string; label: string };
  consultantName: string;
  summary: {
    course: string;
    findings: string;
    treatment: string;
    condition: string;
    adviceBn: string;
  };
  /** What the patient takes home. The last chance to catch a duplicate or a stopped medicine. */
  medications: RxLine[];
  followUpDays?: number;
  followUpWith?: string;
  procedures?: string[];
  /** Not settled on the way out happens; it is recorded and named rather than quietly forgotten. */
  bill: { settled: boolean; due: number; invoiceId?: string };
  preparedBy: string;
  countersignedBy?: string;
}

export function dischargeDues(list: DischargeRecord[]): { count: number; amount: number } {
  const unpaid = list.filter((d) => !d.bill.settled);
  return { count: unpaid.length, amount: unpaid.reduce((sum, d) => sum + d.bill.due, 0) };
}

/* ------------------------------------------------------------------ the generated day */

export interface InpatientDay {
  day: string;
  /** The clock the board is a picture of: 15:20, mid-afternoon, after the drug round and before handover. */
  now: string;
  nowMinutes: number;
  shift: Shift;
  wards: Ward[];
  beds: Bed[];
  admissions: Admission[];
  vitals: VitalSet[];
  notes: NursingNote[];
  mar: MarDose[];
  handovers: Handover[];
  transfers: BedTransfer[];
  discharges: DischargeRecord[];
}

const WARD_DRUGS = ['paracetamol', 'omeprazole', 'amoxicillin', 'amlodipine', 'metformin', 'furosemide', 'insulin-soluble', 'salbutamol', 'morphine', 'pethidine', 'ors', 'cetirizine'];

const NOTE_LINES: Record<NoteKind, string[]> = {
  Note: ['Slept between observations. Took oral fluids. No complaint of pain.', 'Chest clear on auscultation. Abdomen soft, dressing dry.', 'Mild nausea after the morning dose, settled without treatment.'],
  Observation: ['Afebrile since the morning. Oral intake adequate.', 'Urine output 40 ml last hour, colour improving.', 'Wound edge inspected: no discharge, no redness beyond the suture line.'],
  'Intake/output': ['Intake 1 850 ml, output 1 400 ml, balance +450 ml over the shift.', 'One episode of loose stool; intake 1 200 ml, output 1 600 ml.'],
  'Wound care': ['Dressing changed with aseptic technique; wound clean, sutures intact.', 'Vacuum dressing checked, no leak, 40 ml serosanguinous in the canister.'],
  Escalation: ['Called the registrar for a rising respiratory rate; oxygen started at 2 litres, plan documented.', 'Blood pressure fell on standing; patient laid flat, fluids given, registrar informed.'],
  'Family update': ['Daughter informed of today’s plan and the expected stay; she asked about the diet.', 'Family counselled on the discharge medicines and the follow-up date.'],
  Procedure: ['Nasogastric tube re-sited, position confirmed before the feed.', 'Urinary catheter changed, specimen sent for culture.'],
};

const DISCHARGE_COURSES = [
  'Admitted with fever and hypotension, given intravenous fluids and antibiotics; fever settled on day three and oral intake was established.',
  'Chest pain settled with treatment; serial troponin remained flat and the electrocardiogram showed no new change.',
  'Blood glucose stabilised on a new regimen; the patient and the family were taught the injection technique twice before discharge.',
  'Post-operative recovery uncomplicated: mobile on day one, drains removed on day two, wound dry at discharge.',
  'Antenatal blood pressure controlled; mother and baby observed for 24 hours after delivery and both stable at discharge.',
];

const DISCHARGE_FINDINGS = [
  'Afebrile for 48 hours. Pulse 78/min, blood pressure 118/76 mmHg, chest clear, abdomen soft.',
  'Electrocardiogram: sinus rhythm, no acute ischaemic change. Troponin 0.01 and 0.01 ng/ml.',
  'Capillary glucose 6.2–8.4 mmol/L over the last 24 hours. Feet examined: no ulcer, sensation intact.',
  'Wound healthy, sutures in place, no discharge. Haemoglobin stable at 11.4 g/dl.',
  'Blood pressure 126/82 mmHg, urine protein negative, fetal heart rate reassuring before discharge.',
];

const DISCHARGE_CONDITIONS = ['Improved and stable', 'Recovered, no complaints', 'Stable, discharged on request', 'Improved, referred onward for a specialist opinion'];

/**
 * One deterministic ward day. Two patients deteriorate over the day so the escalation path has something real
 * to show, the drug round carries a held dose and an unwitnessed controlled entry, and one discharge walks out
 * with the bill unsettled — the three things a ward board is actually used to catch.
 */
export function generateInpatient(dayIso: string): InpatientDay {
  const rand = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 3) * 8641);
  const nowMinutes = 15 * 60 + 20;
  const now = clock(nowMinutes);

  /* beds */
  const beds: Bed[] = WARDS.flatMap((w) =>
    Array.from({ length: w.beds }, (_, i) => {
      const cabin = i < w.cabins;
      const klass: BedClass = w.id === 'hdu' ? (i === w.beds - 1 ? 'Isolation' : 'HDU') : cabin ? 'Cabin' : 'General';
      return { id: `${w.id}-${String(i + 1).padStart(2, '0')}`, wardId: w.id, label: `${w.prefix}-${String(i + 1).padStart(2, '0')}`, class: klass, status: 'Free' as BedStatus };
    }),
  );

  /* which beds hold a patient, plus the states that are not occupancy */
  const occupied: Bed[] = [];
  for (const w of WARDS) {
    const wardBeds = beds.filter((b) => b.wardId === w.id);
    const target = w.id === 'hdu' ? wardBeds.length : Math.round(wardBeds.length * (0.55 + rand() * 0.2));
    for (const b of wardBeds.slice(0, target)) occupied.push(b);
    // one bed out for cleaning, one reserved for an incoming transfer, one blocked for repair, where the ward is big enough
    const rest = wardBeds.slice(target);
    if (rest[0]) {
      rest[0].status = 'Cleaning';
      rest[0].note = 'Discharged at 14:25 — terminal clean in progress';
      rest[0].cleaningSince = clock(14 * 60 + 25);
    }
    if (rest[1]) {
      rest[1].status = 'Reserved';
      rest[1].note = `Reserved for a transfer from Uttara Branch, expected ${clock(16 * 60 + 30)}`;
      rest[1].reservedFor = 'Transfer in — Uttara Branch';
    }
    if (rest[2] && w.id !== 'hdu') {
      rest[2].status = 'Blocked';
      rest[2].note = 'Oxygen wall outlet awaiting maintenance (work order WM-2291)';
    }
  }

  /* admissions */
  const pool = patients.filter((p) => p.status === 'Admitted');
  const doctors = DOCTORS.map((d) => ({ id: d.id, name: d.name, department: d.department }));
  const allAdmissions: Admission[] = occupied.map((bed, i) => {
    const ward = wardById(bed.wardId)!;
    const patient = pool[(i * 37) % pool.length];
    const consultant = doctors[i % doctors.length];
    const registrar = STAFF.filter((s) => s.role === 'Registrar')[i % 2];
    const diag = ICD10[(i * 5) % ICD10.length];
    const losDays = 1 + Math.floor(rand() * 9);
    const admittedAt = `${shiftIso(dayIso, -losDays)} ${clock(6 * 60 + Math.floor(rand() * 960))}`;
    const severe = i % 11 === 0 ? 'Critical' : i % 4 === 0 ? 'Guarded' : 'Stable';
    return {
      id: `ADM-${dayIso.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`,
      mrn: patient.mrn,
      patient: {
        mrn: patient.mrn,
        name: patient.name,
        nameBn: patient.nameBn,
        age: patient.age,
        sex: patient.sex,
        phone: patient.phone,
        allergies: patient.allergies,
        payer: patient.payer,
      },
      wardId: ward.id,
      bedId: bed.id,
      admittedAt,
      admittedBy: registrar?.name ?? 'Dr. F. Kabir',
      consultantId: consultant.id,
      consultantName: consultant.name,
      registrarId: registrar?.id,
      reason: ADMIT_REASONS[i % ADMIT_REASONS.length],
      diagnosis: { code: diag.code, label: diag.label },
      isolation: bed.class === 'Isolation' ? 'Contact precautions — carbapenem-resistant screen positive, single room' : undefined,
      class: bed.class,
      severity: severe,
      codeStatus: i % 7 === 0 ? 'Limited intervention' : i % 13 === 0 ? 'Not for resuscitation (documented)' : i % 3 === 0 ? 'For full care' : undefined,
      expectedStayDays: 2 + Math.floor(rand() * 7),
      transferredFrom: i === 4 ? 'Mirpur Branch' : undefined,
      // Nobody whose day ends in an emergency response goes home in the same afternoon.
      plannedDischargeToday: i % 6 === 3 && i !== 2 && i !== 9,
      // Not every bed carries an instruction, and the ones that carry none are exactly what the round is for.
      instructions: [
        ...(i % 5 === 0 ? ['Nil by mouth from midnight for endoscopy'] : i % 4 === 1 ? ['Strict input/output charting'] : i % 3 === 2 ? ['Mobilise with assistance'] : []),
        ...(bed.class === 'HDU' ? ['Continuous cardiac monitoring'] : []),
        ...(patient.allergies ? [`Allergy: ${patient.allergies} — check every new order`] : []),
      ],
    };
  });
  for (const adm of allAdmissions) {
    const bed = beds.find((b) => b.id === adm.bedId)!;
    bed.status = 'Occupied';
    bed.admissionId = adm.id;
  }

  /* observations: three sets per patient, with two patients deteriorating across the day */
  const deteriorating = new Set([allAdmissions[2]?.id, allAdmissions[Math.min(9, allAdmissions.length - 1)]?.id]);
  const vitals: VitalSet[] = [];
  const obsTimes = [6 * 60, 10 * 60, 14 * 60];
  allAdmissions.forEach((adm, ai) => {
    const nurse = STAFF.filter((s) => s.role.includes('nurse') && (s.wardIds.includes(adm.wardId) || s.id === 'n-das'))[ai % 4] ?? STAFF[0];
    obsTimes.forEach((base, oi) => {
      const bad = deteriorating.has(adm.id) && oi > 0;
      const values: Partial<Record<string, number>> = {
        respRate: Math.round(bad ? 20 + oi * 3 + rand() : 14 + rand() * 6),
        spo2: Math.round(bad ? 94 - oi * 2 - (rand() < 0.4 ? 1 : 0) : 95 + rand() * 5),
        temperature: Number(((bad ? 38.2 + oi * 0.3 : 36.4 + rand() * 1.2)).toFixed(1)),
        systolic: Math.round(bad ? 108 - oi * 8 - rand() * 4 : 104 + rand() * 34),
        diastolic: Math.round(66 + rand() * 18),
        pulse: Math.round(bad ? 96 + oi * 6 : 66 + rand() * 28),
      };
      const consciousness = bad && oi === 2 ? 'A' : 'A';
      const ews = earlyWarningScore(values, consciousness);
      const at = clock(base + Math.floor(rand() * 25));
      const set: VitalSet = {
        id: `OBS-${adm.id}-${oi + 1}`,
        admissionId: adm.id,
        at,
        by: nurse.name,
        values,
        consciousness,
        score: ews.score,
        band: ews.band,
        params: ews.params,
      };
      if (ews.band === 'Escalate' || ews.band === 'Emergency') {
        set.escalated = {
          at: clock(parseClock(at) + 12),
          to: adm.registrarId ? (staffById(adm.registrarId)?.name ?? 'Registrar') : 'Registrar',
          response:
            ews.band === 'Emergency'
              ? 'Came to the bedside at once, started oxygen, took blood cultures and adjusted the antibiotic; plan written in the notes.'
              : 'Reviewed at the bedside, increased the observation frequency to hourly and asked for a repeat haemoglobin in the morning.',
        };
      }
      vitals.push(set);
    });
  });

  /* nursing notes */
  const notes: NursingNote[] = [];
  allAdmissions.forEach((adm, ai) => {
    const wardNurses = STAFF.filter((s) => s.role.includes('nurse') && (s.wardIds.includes(adm.wardId) || s.id === 'n-das'));
    [7 * 60 + 20, 11 * 60 + 40, 14 * 60 + 10].forEach((base, ni) => {
      const kind: NoteKind = ni === 0 ? 'Observation' : ni === 1 ? 'Note' : ai % 4 === 0 ? 'Escalation' : ai % 5 === 0 ? 'Wound care' : ai % 3 === 0 ? 'Intake/output' : 'Note';
      const by = wardNurses[(ai + ni) % Math.max(1, wardNurses.length)]?.name ?? 'S. Sultana';
      notes.push({
        id: `NN-${adm.id}-${ni + 1}`,
        admissionId: adm.id,
        at: clock(base + Math.floor(rand() * 20)),
        by,
        shift: shiftAt(clock(base)),
        kind,
        text: NOTE_LINES[kind][Math.floor(rand() * NOTE_LINES[kind].length)],
      });
    });
  });

  /* the drug round */
  const mar: MarDose[] = [];
  allAdmissions.forEach((adm, ai) => {
    const count = 3 + Math.floor(rand() * 3);
    const chosen = Array.from({ length: count }, (_, n) => DRUGS.find((d) => d.id === WARD_DRUGS[(ai * 3 + n * 2) % WARD_DRUGS.length])!).filter(Boolean) as Drug[];
    chosen.forEach((drug, di) => {
      const frequency: Frequency = drug.id === 'morphine' || drug.id === 'pethidine' ? 'As needed (PRN)' : di === 0 ? 'Twice daily' : di === 1 ? 'Three times a day' : di % 2 === 0 ? 'Once daily' : 'Four times a day';
      const times = FREQUENCY_TIMES[frequency];
      const scheduled = times.length ? times[(ai + di) % times.length] : 13 * 60 + 30;
      const scheduledAt = clock(scheduled);
      const past = scheduled <= nowMinutes - 30;
      const nurse = STAFF.filter((s) => s.role.includes('nurse') && (s.wardIds.includes(adm.wardId) || s.id === 'n-das'))[di % 3] ?? STAFF[0];
      const dose: MarDose = {
        id: `MAR-${adm.id}-${di + 1}`,
        admissionId: adm.id,
        wardId: adm.wardId,
        drugId: drug.id,
        brand: drug.brand,
        generic: drug.generic,
        strength: drug.strength,
        dose: drug.form === 'Inhaler' ? '2 puffs' : drug.form === 'Vial' ? 'Per sliding scale' : '1',
        route: drug.form === 'Vial' || drug.form === 'Ampoule' ? 'SC' : drug.form === 'Inhaler' ? 'Inhalation' : 'Oral',
        frequency,
        prn: frequency === 'As needed (PRN)',
        controlled: Boolean(drug.controlled),
        highAlert: Boolean(drug.highAlert),
        scheduledAt,
        status: past ? 'Given' : 'Due',
        checked: past,
      };
      if (past) {
        dose.givenAt = clock(scheduled + Math.floor(rand() * 40) - 5);
        dose.givenBy = nurse.name;
        dose.witness = dose.controlled ? STAFF[(di + 1) % 4].name : undefined;
        if (dose.prn) dose.indication = 'Pain score 7/10, no relief from paracetamol';
      }
      // three deliberate exceptions, so the screen has something to catch rather than only something to show
      if (ai === 1 && di === 1) {
        dose.status = 'Held';
        dose.reason = 'Vomiting — dose held and the registrar informed, to be given after the antiemetic';
        dose.givenAt = undefined;
        dose.givenBy = undefined;
        dose.checked = true;
      }
      if (ai === 3 && di === 0) {
        dose.status = 'Refused';
        dose.reason = 'Patient refused the morning dose, explained the reason for it; doctor informed';
        dose.givenAt = undefined;
        dose.givenBy = undefined;
        dose.checked = true;
      }

      if (past && dose.status === 'Given' && ai === 5 && di === 2) {
        dose.status = 'Due';
        dose.givenAt = undefined;
        dose.givenBy = undefined;
        dose.checked = false;
        dose.scheduledAt = clock(parseClock('11:00'));
      }
      mar.push(dose);
    });
  });

  // One controlled administration recorded without a witness, on purpose: the round reads this as a hard error
  // rather than a warning, and a screen that can never show the error is a screen nobody trusts to catch it.
  const unwitnessed = mar.find((d) => d.controlled && d.status === 'Given');
  if (unwitnessed) unwitnessed.witness = undefined;

  /* handover for the shift that is on, plus the one that just ended */
  const handovers: Handover[] = WARDS.flatMap((w) =>
    (['Morning', 'Evening'] as Shift[]).map((shift, si) => {
      const wardAdm = allAdmissions.filter((a) => a.wardId === w.id);
      const deterioratingHere = wardAdm.find((a) => deteriorating.has(a.id));
      const nurses = STAFF.filter((s) => s.role.includes('nurse') && s.wardIds.includes(w.id));
      const from = nurses[si % Math.max(1, nurses.length)]?.name ?? w.inCharge;
      const to = nurses[(si + 1) % Math.max(1, nurses.length)]?.name ?? 'N. Haque';
      return {
        id: `HO-${w.id}-${shift}`,
        wardId: w.id,
        shift,
        at: shift === 'Morning' ? '07:00' : '14:00',
        by: from,
        to,
        sbar: {
          situation: `${wardAdm.length} patients in ${w.name}; ${wardAdm.filter((a) => a.severity !== 'Stable').length} who need a review, ${wardAdm.filter((a) => a.plannedDischargeToday).length} planned for discharge.`,
          background: deterioratingHere
            ? `${deterioratingHere.patient.name} (${deterioratingHere.patient.mrn}, bed ${beds.find((b) => b.id === deterioratingHere.bedId)?.label}) has been trending up on the early-warning score since midday.`
            : 'No patient is currently trending on the early-warning score.',
          assessment: deterioratingHere
            ? 'The trend looks like sepsis rather than a single bad reading: rising respiratory rate with falling saturation, and the registrar has been to the bedside.'
            : 'Stable across the ward. Observations are up to date and the drug round is nearly complete.',
          recommendation: deterioratingHere
            ? 'Hourly observations overnight, repeat the bloods at 06:00, and call the registrar immediately if the systolic falls below 100.'
            : 'Keep four-hourly observations; chase the outstanding reports in the morning.',
        },
        tasks: [
          { text: 'Repeat haemoglobin for bed ' + (beds.find((b) => b.admissionId === wardAdm[0]?.id)?.label ?? 'A-01'), owner: to, done: si === 1 },
          { text: 'Chase the culture report from the laboratory', owner: to, done: si === 1 },
          { text: 'Family asked to bring the previous discharge papers', owner: to, done: false },
        ],
      };
    }),
  );

  /* transfers: one inside the ward, one between wards, one between branches */
  const transfers: BedTransfer[] = [];
  if (allAdmissions[1]) {
    transfers.push({
      id: 'TR-1',
      admissionId: allAdmissions[1].id,
      mrn: allAdmissions[1].mrn,
      at: clock(9 * 60 + 15),
      by: 'S. Sultana',
      fromBed: beds.find((b) => b.id === 'med-a-22')?.label ?? 'A-22',
      fromWardId: 'med-a',
      toBed: beds.find((b) => b.id === allAdmissions[1].bedId)?.label ?? 'A-15',
      toWardId: allAdmissions[1].wardId,
      reason: 'Moved nearer the nurses’ station for closer observation',
      acceptedBy: 'S. Sultana',
    });
  }
  if (allAdmissions[5]) {
    transfers.push({
      id: 'TR-2',
      admissionId: allAdmissions[5].id,
      mrn: allAdmissions[5].mrn,
      at: clock(11 * 60 + 5),
      by: 'P. Das',
      fromBed: 'B-18',
      fromWardId: 'surg-b',
      toBed: beds.find((b) => b.id === allAdmissions[5].bedId)?.label ?? 'H-02',
      toWardId: allAdmissions[5].wardId,
      reason: 'Post-operative hypotension — stepped up to the high dependency unit',
      acceptedBy: 'K. Islam',
    });
  }
  if (allAdmissions[8]) {
    transfers.push({
      id: 'TR-3',
      admissionId: allAdmissions[8].id,
      mrn: allAdmissions[8].mrn,
      at: clock(8 * 60 + 40),
      by: 'Dr. S. Noor',
      fromBed: 'Uttara Branch (referral)',
      fromWardId: 'referral',
      toBed: beds.find((b) => b.id === allAdmissions[8].bedId)?.label ?? 'A-08',
      toWardId: allAdmissions[8].wardId,
      reason: 'Transferred in from Uttara Branch for a cardiology opinion; records and the transfer sheet checked on arrival',
      acceptedBy: 'M. Akter',
    });
  }

  /* discharges */
  const discharges: DischargeRecord[] = allAdmissions
    .filter((a) => a.plannedDischargeToday)
    .map((adm, i) => {
      const bed = beds.find((b) => b.id === adm.bedId)!;
      const type: DischargeType = i === 2 ? 'Discharged on request' : i === 1 ? 'Improved, follow-up in OPD' : 'Recovered';
      const dischargeClock = clock(13 * 60 + 30 + i * 20);
      const stayedDays = Math.max(1, Math.round((parseClock(now) - 0) / 1440) + 1);
      void stayedDays;
      const template = ['metformin', 'amlodipine', 'omeprazole', 'paracetamol'];
      const medications: RxLine[] = template.slice(0, 2 + (i % 2)).map((id, n) => {
        const drug = drugById(id)!;
        return {
          id: `${adm.id}-DC${n + 1}`,
          drugId: drug.id,
          brand: drug.brand,
          generic: drug.generic,
          strength: drug.strength,
          form: drug.form,
          dose: '1',
          route: 'Oral',
          frequency: (n === 0 ? 'Twice daily' : 'Once daily') as Frequency,
          durationDays: 15,
          quantity: n === 0 ? 30 : 15,
          instructions: n === 0 ? 'After breakfast and dinner' : 'In the morning',
          prn: false,
        };
      });
      const due = i === 2 ? 4_850 : i === 1 ? 0 : 0;
      return {
        id: `DSC-${adm.id}`,
        admissionId: adm.id,
        mrn: adm.mrn,
        name: adm.patient.name,
        nameBn: adm.patient.nameBn,
        age: adm.patient.age,
        sex: adm.patient.sex,
        wardId: adm.wardId,
        bedId: adm.bedId,
        admittedAt: adm.admittedAt,
        dischargedAt: `${dayIso} ${dischargeClock}`,
        stayedDays,
        type,
        diagnosis: adm.diagnosis ?? { code: 'R69', label: 'Illness, unspecified' },
        consultantName: adm.consultantName,
        summary: {
          course: DISCHARGE_COURSES[i % DISCHARGE_COURSES.length],
          findings: DISCHARGE_FINDINGS[i % DISCHARGE_FINDINGS.length],
          treatment: 'Intravenous antibiotics, fluids and symptom control, with the observations monitored four-hourly.',
          condition: DISCHARGE_CONDITIONS[i % DISCHARGE_CONDITIONS.length],
          adviceBn: 'নিয়মিত ওষুধ সেবন করুন, পর্যাপ্ত পানি পান করুন, জ্বর বা শ্বাসকষ্ট হলে দ্রুত হাসপাতালে আসুন।',
        },
        medications,
        followUpDays: 7 + i * 3,
        followUpWith: adm.consultantName,
        procedures: i % 2 === 0 ? ['Peripheral line inserted', 'Urinary catheter removed before discharge'] : undefined,
        bill: {
          settled: due === 0,
          due,
          invoiceId: due === 0 ? `INV-${dayIso.replace(/-/g, '')}-${String(20 + i).padStart(3, '0')}` : undefined,
        },
        preparedBy: i % 2 === 0 ? 'Dr. F. Kabir' : 'Dr. S. Noor',
        countersignedBy: 'Dr. A. Rahman',
      };
    });

  // The beds of discharged patients go back to the board as Cleaning, not as Free: somebody has to clean them.
  // The admission itself leaves the active list — a discharged patient is a record and a bed that is being
  // cleaned, not a patient in a bed — and everything generated for them (observations, notes, doses) stays.
  for (const d of discharges) {
    const bed = beds.find((b) => b.id === d.bedId);
    if (!bed) continue;
    bed.status = 'Cleaning';
    bed.admissionId = undefined;
    bed.note = `Discharged at ${d.dischargedAt.slice(11)} — terminal clean in progress`;
    bed.cleaningSince = d.dischargedAt.slice(11);
  }
  const dischargedIds = new Set(discharges.map((d) => d.admissionId));
  const active = allAdmissions.filter((a) => !dischargedIds.has(a.id));

  return {
    day: dayIso,
    now,
    nowMinutes,
    shift: shiftAt(now),
    wards: WARDS,
    beds,
    admissions: active,
    vitals,
    notes,
    mar,
    handovers,
    transfers,
    discharges,
  };
}

/* ------------------------------------------------------------------ derived views */

export function occupancy(beds: Bed[]) {
  const total = beds.length;
  const count = (status: BedStatus) => beds.filter((b) => b.status === status).length;
  const occupied = count('Occupied');
  return {
    total,
    occupied,
    free: count('Free'),
    cleaning: count('Cleaning'),
    reserved: count('Reserved'),
    blocked: count('Blocked'),
    /** Occupancy is against usable beds: a blocked bed is not a bed the desk can admit into. */
    percent: total - count('Blocked') > 0 ? Math.round((occupied / (total - count('Blocked'))) * 100) : 0,
    byClass: (['General', 'Cabin', 'HDU', 'Isolation'] as BedClass[]).map((klass) => {
      const of = beds.filter((b) => b.class === klass);
      return { label: klass, value: of.length ? Math.round((of.filter((b) => b.status === 'Occupied').length / of.length) * 100) : 0, extra: `${of.filter((b) => b.status === 'Occupied').length}/${of.length}` };
    }),
  };
}

/** Beds in Cleaning for longer than the housekeeping target: the first thing a bed manager asks about. */
export const overdueCleaning = (beds: Bed[], nowMinutes: number): Bed[] =>
  beds.filter((b) => b.status === 'Cleaning' && b.cleaningSince && nowMinutes - parseClock(b.cleaningSince) > CLEANING_TARGET_MIN);

export function latestVitals(day: InpatientDay, admissionId: string): VitalSet | undefined {
  return day.vitals.filter((v) => v.admissionId === admissionId).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
}

/** The board's alert list: what a nurse in charge has to look at before anything else on the screen. */
export function wardAlerts(day: InpatientDay): Array<{ id: string; tone: 'critical' | 'warning' | 'info'; text: string; admissionId?: string; bed?: string }> {
  const alerts: Array<{ id: string; tone: 'critical' | 'warning' | 'info'; text: string; admissionId?: string; bed?: string }> = [];
  const bedLabel = (adm: Admission) => day.beds.find((b) => b.id === adm.bedId)?.label ?? adm.bedId;

  for (const adm of day.admissions) {
    const latest = latestVitals(day, adm.id);
    if (!latest) continue;
    if (latest.band === 'Emergency' || latest.band === 'Escalate') {
      alerts.push({
        id: `ews-${adm.id}`,
        tone: latest.band === 'Emergency' ? 'critical' : 'warning',
        text: `${adm.patient.name} (${bedLabel(adm)}) scored ${latest.score} on the early-warning chart at ${latest.at} — ${EWS_RESPONSE[latest.band].response}`,
        admissionId: adm.id,
        bed: bedLabel(adm),
      });
    }
  }

  for (const dose of day.mar) {
    const blockers = doseBlockers(dose);
    const adm = day.admissions.find((a) => a.id === dose.admissionId);
    for (const blocker of blockers) {
      alerts.push({
        id: `${dose.id}-${blocker.slice(0, 12)}`,
        tone: blocker.includes('witness') ? 'critical' : blocker.includes('check') ? 'critical' : 'warning',
        text: `${dose.brand} ${dose.strength} for ${adm?.patient.name ?? dose.admissionId} at ${dose.scheduledAt}: ${blocker.toLowerCase()}`,
        admissionId: dose.admissionId,
        bed: adm ? bedLabel(adm) : undefined,
      });
    }
  }

  for (const bed of overdueCleaning(day.beds, day.nowMinutes)) {
    alerts.push({
      id: `clean-${bed.id}`,
      tone: 'warning',
      text: `Bed ${bed.label} has been out for cleaning since ${bed.cleaningSince} — past the ${CLEANING_TARGET_MIN}-minute target`,
      bed: bed.label,
    });
  }

  const order = { critical: 0, warning: 1, info: 2 } as const;
  return alerts.sort((a, b) => order[a.tone] - order[b.tone]);
}

/**
 * The standing gaps: things that are true of the record rather than events of the shift. They are counted on
 * the round instead of being pushed into the alert feed — an allergy that has been on the chart since admission
 * is not news, and a feed of forty permanent warnings is a feed nobody reads.
 */
export function wardQualityGaps(day: InpatientDay) {
  const noCeiling = day.admissions.filter((a) => !a.codeStatus);
  const noDiet = day.admissions.filter((a) => !a.instructions?.length);
  const unaccounted = day.mar.filter((d) => d.status === 'Given' && doseBlockers(d).length > 0);
  return {
    noCeiling: noCeiling.map((a) => ({ mrn: a.mrn, name: a.patient.name, bed: day.beds.find((b) => b.id === a.bedId)?.label ?? a.bedId })),
    noDiet: noDiet.map((a) => ({ mrn: a.mrn, name: a.patient.name })),
    unaccounted: unaccounted.map((d) => ({ id: d.id, text: `${d.brand} ${d.strength} at ${d.scheduledAt}: ${doseBlockers(d).join('; ')}` })),
  };
}

/** Ready for the discharge desk: the summary written, the medicines listed, the bill settled. */
export function dischargeChecklist(record: DischargeRecord) {
  return [
    { label: 'Discharge type recorded', done: Boolean(record.type) },
    { label: 'Diagnosis on the summary', done: Boolean(record.diagnosis.code) },
    { label: 'Medicines to continue listed', done: record.medications.length > 0 },
    { label: 'Follow-up date given', done: Boolean(record.followUpDays) },
    { label: 'Bill settled', done: record.bill.settled },
  ];
}

export const outstandingOnDischarge = (records: DischargeRecord[]): string => {
  const { count, amount } = dischargeDues(records);
  return count === 0 ? 'Every discharge today was settled before the patient left.' : `${count} discharge(s) left with ${money(amount)} outstanding.`;
};
