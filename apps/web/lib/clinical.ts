/* -----------------------------------------------------------------------------
 * OPD consultation (P2) — the rules of the doctor's screen, in code.
 *
 * Everything here is a *rule* the server will own later (P0-409/P2 specs): the reference ranges that flag a
 * vital sign, the abbreviations that are forbidden on a prescription, the allergy check, and the encounter
 * status flow. The screens render these; they do not invent their own.
 *
 * Two safety positions are deliberate and visible in the UI:
 *  - a prescription is screened for dangerous abbreviations and for allergies *before* it can be signed;
 *  - a signed note is not edited, it takes an addendum — the audit trail is the record.
 */

import { patients, type Patient } from './mock';

export type EncounterStatus = 'Waiting' | 'In consultation' | 'Signed';

export const STATUS_FLOW: Record<EncounterStatus, EncounterStatus[]> = {
  Waiting: ['In consultation'],
  'In consultation': ['Signed'],
  Signed: [], // addendum, not an edit — see addendumFor()
};

/* ------------------------------------------------------------------------------ vitals */

export interface VitalDef {
  key: string;
  label: string;
  labelBn: string;
  unit: string;
  low: number;
  high: number;
  /** Outside these, the reading is critical and must be acted on, not just flagged. */
  criticalLow?: number;
  criticalHigh?: number;
  step?: number;
}

export const VITALS: VitalDef[] = [
  { key: 'systolic', label: 'Systolic BP', labelBn: 'সিস্টোলিক', unit: 'mmHg', low: 90, high: 140, criticalLow: 80, criticalHigh: 180 },
  { key: 'diastolic', label: 'Diastolic BP', labelBn: 'ডায়াস্টোলিক', unit: 'mmHg', low: 60, high: 90, criticalLow: 50, criticalHigh: 110 },
  { key: 'pulse', label: 'Pulse', labelBn: 'নাড়ি', unit: '/min', low: 60, high: 100, criticalLow: 45, criticalHigh: 130 },
  { key: 'temperature', label: 'Temperature', labelBn: 'তাপমাত্রা', unit: '°C', low: 36, high: 37.5, criticalLow: 35, criticalHigh: 39.5, step: 0.1 },
  { key: 'respRate', label: 'Respiratory rate', labelBn: 'শ্বাসের হার', unit: '/min', low: 12, high: 20, criticalLow: 8, criticalHigh: 30 },
  { key: 'spo2', label: 'SpO₂', labelBn: 'অক্সিজেন', unit: '%', low: 95, high: 100, criticalLow: 90 },
  { key: 'glucose', label: 'Random glucose', labelBn: 'গ্লুকোজ', unit: 'mmol/L', low: 4, high: 11, criticalLow: 3, criticalHigh: 20, step: 0.1 },
  { key: 'weight', label: 'Weight', labelBn: 'ওজন', unit: 'kg', low: 3, high: 200, step: 0.1 },
  { key: 'height', label: 'Height', labelBn: 'উচ্চতা', unit: 'cm', low: 40, high: 220 },
  { key: 'pain', label: 'Pain score', labelBn: 'ব্যথার মাত্রা', unit: '/10', low: 0, high: 3, criticalHigh: 8 },
];

export type VitalFlag = 'ok' | 'high' | 'low' | 'critical-high' | 'critical-low';

export function flagVital(def: VitalDef, value: number): VitalFlag {
  if (def.criticalHigh !== undefined && value >= def.criticalHigh) return 'critical-high';
  if (def.criticalLow !== undefined && value <= def.criticalLow) return 'critical-low';
  if (value > def.high) return 'high';
  if (value < def.low) return 'low';
  return 'ok';
}

export const flagTone: Record<VitalFlag, 'neutral' | 'warning' | 'critical'> = {
  ok: 'neutral',
  high: 'warning',
  low: 'warning',
  'critical-high': 'critical',
  'critical-low': 'critical',
};

export function bmi(weightKg?: number, heightCm?: number): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export const bmiBand = (value: number): string =>
  value < 18.5 ? 'Underweight' : value < 23 ? 'Normal (Asian cut-off)' : value < 27.5 ? 'Overweight' : 'Obese';

/* ------------------------------------------------------------------------------ diagnosis */

export interface IcdCode {
  code: string;
  label: string;
  labelBn: string;
  chapter: string;
}

/** A working shortlist. The full ICD-10 set loads from the terminology service in P2 — this covers what OPD
 *  actually records day to day, which is what the pilot needs, and it is honest about being a subset. */
export const ICD10: IcdCode[] = [
  { code: 'E11.9', label: 'Type 2 diabetes mellitus without complications', labelBn: 'টাইপ ২ ডায়াবেটিস', chapter: 'Endocrine' },
  { code: 'I10', label: 'Essential (primary) hypertension', labelBn: 'উচ্চ রক্তচাপ', chapter: 'Circulatory' },
  { code: 'J06.9', label: 'Acute upper respiratory infection', labelBn: 'তীব্র সর্দি-কাশি', chapter: 'Respiratory' },
  { code: 'J18.9', label: 'Pneumonia, unspecified organism', labelBn: 'নিউমোনিয়া', chapter: 'Respiratory' },
  { code: 'J45.9', label: 'Asthma, unspecified', labelBn: 'হাঁপানি', chapter: 'Respiratory' },
  { code: 'A09', label: 'Infectious gastroenteritis and colitis', labelBn: 'সংক্রামক ডায়রিয়া', chapter: 'Digestive' },
  { code: 'K30', label: 'Functional dyspepsia', labelBn: 'বদহজম', chapter: 'Digestive' },
  { code: 'K21.9', label: 'Gastro-oesophageal reflux disease', labelBn: 'অ্যাসিড রিফ্লাক্স', chapter: 'Digestive' },
  { code: 'N39.0', label: 'Urinary tract infection, site not specified', labelBn: 'মূত্রনালির সংক্রমণ', chapter: 'Genitourinary' },
  { code: 'N20.0', label: 'Calculus of kidney', labelBn: 'কিডনিতে পাথর', chapter: 'Genitourinary' },
  { code: 'D50.9', label: 'Iron deficiency anaemia, unspecified', labelBn: 'রক্তস্বল্পতা', chapter: 'Blood' },
  { code: 'B54', label: 'Unspecified malaria', labelBn: 'ম্যালেরিয়া', chapter: 'Infectious' },
  { code: 'A15.0', label: 'Tuberculosis of lung', labelBn: 'যক্ষ্মা (ফুসফুস)', chapter: 'Infectious' },
  { code: 'M17.9', label: 'Osteoarthritis of knee, unspecified', labelBn: 'হাঁটুর ব্যথা', chapter: 'Musculoskeletal' },
  { code: 'M54.5', label: 'Low back pain', labelBn: 'কোমরের ব্যথা', chapter: 'Musculoskeletal' },
  { code: 'G43.9', label: 'Migraine, unspecified', labelBn: 'মাইগ্রেন', chapter: 'Nervous' },
  { code: 'R51', label: 'Headache', labelBn: 'মাথাব্যথা', chapter: 'Symptoms' },
  { code: 'F41.9', label: 'Anxiety disorder, unspecified', labelBn: 'দুশ্চিন্তা রোগ', chapter: 'Mental' },
  { code: 'L30.9', label: 'Dermatitis, unspecified', labelBn: 'চর্মরোগ', chapter: 'Skin' },
  { code: 'H10.9', label: 'Conjunctivitis, unspecified', labelBn: 'চোখ ওঠা', chapter: 'Eye' },
  { code: 'O26.9', label: 'Pregnancy-related condition, unspecified', labelBn: 'গর্ভাবস্থা সংক্রান্ত', chapter: 'Pregnancy' },
  { code: 'Z00.0', label: 'General medical examination', labelBn: 'সাধারণ স্বাস্থ্য পরীক্ষা', chapter: 'Factors' },
  { code: 'E66.9', label: 'Obesity, unspecified', labelBn: 'স্থূলতা', chapter: 'Endocrine' },
  { code: 'E78.5', label: 'Hyperlipidaemia, unspecified', labelBn: 'কোলেস্টেরল বেশি', chapter: 'Endocrine' },
];

export const searchIcd = (q: string): IcdCode[] => {
  const needle = q.trim().toLowerCase();
  if (!needle) return ICD10.slice(0, 8);
  return ICD10.filter(
    (c) => c.code.toLowerCase().includes(needle) || c.label.toLowerCase().includes(needle) || c.labelBn.includes(needle),
  ).slice(0, 8);
};

/* ------------------------------------------------------------------------------ orders */

export interface OrderItem {
  code: string;
  name: string;
  kind: 'lab' | 'imaging' | 'procedure';
  sample?: string;
  turnaroundH: number;
  price: number;
}

export const ORDERS: OrderItem[] = [
  { code: 'CBC', name: 'Complete blood count', kind: 'lab', sample: 'EDTA tube', turnaroundH: 3, price: 350 },
  { code: 'FBS', name: 'Fasting blood sugar', kind: 'lab', sample: 'Fluoride tube', turnaroundH: 3, price: 200 },
  { code: 'HBA1C', name: 'HbA1c', kind: 'lab', sample: 'EDTA tube', turnaroundH: 24, price: 900 },
  { code: 'LIPID', name: 'Lipid profile', kind: 'lab', sample: 'Serum', turnaroundH: 6, price: 800 },
  { code: 'RFT', name: 'Renal function test', kind: 'lab', sample: 'Serum', turnaroundH: 6, price: 750 },
  { code: 'LFT', name: 'Liver function test', kind: 'lab', sample: 'Serum', turnaroundH: 6, price: 850 },
  { code: 'TSH', name: 'Thyroid stimulating hormone', kind: 'lab', sample: 'Serum', turnaroundH: 24, price: 700 },
  { code: 'URINE', name: 'Urine routine examination', kind: 'lab', sample: 'Urine pot', turnaroundH: 3, price: 250 },
  { code: 'MP', name: 'Malaria parasite (ICT + film)', kind: 'lab', sample: 'EDTA tube', turnaroundH: 2, price: 400 },
  { code: 'CXR', name: 'Chest X-ray PA', kind: 'imaging', turnaroundH: 4, price: 800 },
  { code: 'USG', name: 'Ultrasonography whole abdomen', kind: 'imaging', turnaroundH: 6, price: 1200 },
  { code: 'ECG', name: 'ECG 12 lead', kind: 'procedure', turnaroundH: 1, price: 500 },
  { code: 'DRESS', name: 'Wound dressing', kind: 'procedure', turnaroundH: 1, price: 300 },
];

export type OrderPriority = 'Routine' | 'Urgent' | 'STAT';

export interface OrderLine {
  id: string;
  code: string;
  name: string;
  kind: OrderItem['kind'];
  priority: OrderPriority;
  status: 'Draft' | 'Ordered' | 'Collected' | 'Reported';
  specimenId?: string;
}

/* ------------------------------------------------------------------------------ prescribing */

export interface DrugRef {
  id: string;
  brand: string;
  generic: string;
  strength: string;
  form: string;
  /** Allergen groups this drug belongs to, for the allergy check (e.g. Penicillin). */
  allergenTags: string[];
  /** Set by the formulary; the prescribing screen reads it to raise the second-check prompt. */
  highAlert?: boolean;
  controlled?: boolean;
}

export type Frequency = 'Once daily' | 'Twice daily' | 'Three times a day' | 'Four times a day' | 'Every 6 hours' | 'At bedtime' | 'As needed (PRN)';

export const FREQUENCIES: Frequency[] = ['Once daily', 'Twice daily', 'Three times a day', 'Four times a day', 'Every 6 hours', 'At bedtime', 'As needed (PRN)'];

export const ROUTES = ['Oral', 'IM', 'IV', 'SC', 'Topical', 'Inhalation', 'Rectal', 'Eye drops'];

export interface RxLine {
  id: string;
  drugId: string;
  brand: string;
  generic: string;
  strength: string;
  form: string;
  dose: string;
  route: string;
  frequency: Frequency;
  durationDays: number;
  quantity: number;
  instructions: string;
  prn: boolean;
  /** Set when a pharmacist or the system substituted; the reason is printed for the patient. */
  substitutedFor?: string;
}

/** The classic orders the OPD repeats all day, so the common case is two clicks and no typing. */
export const RX_TEMPLATES: Array<{ id: string; name: string; note: string; lines: Array<Omit<RxLine, 'id'>> }> = [
  {
    id: 't2dm',
    name: 'Type 2 diabetes, stable',
    note: 'Metformin + review in 4 weeks with fasting glucose',
    lines: [
      { drugId: 'metformin', brand: 'Glucophage', generic: 'Metformin', strength: '500 mg', form: 'Tablet', dose: '1', route: 'Oral', frequency: 'Twice daily', durationDays: 30, quantity: 60, instructions: 'After breakfast and dinner', prn: false },
      { drugId: 'amlodipine', brand: 'Norvasc', generic: 'Amlodipine', strength: '5 mg', form: 'Tablet', dose: '1', route: 'Oral', frequency: 'Once daily', durationDays: 30, quantity: 30, instructions: 'Morning, same time every day', prn: false },
    ],
  },
  {
    id: 'uri',
    name: 'Upper respiratory infection, adult',
    note: 'Symptomatic treatment; no antibiotic unless it worsens after 5 days',
    lines: [
      { drugId: 'paracetamol', brand: 'Napa', generic: 'Paracetamol', strength: '500 mg', form: 'Tablet', dose: '1', route: 'Oral', frequency: 'Every 6 hours', durationDays: 5, quantity: 20, instructions: 'Only if fever or pain, maximum 4 in a day', prn: true },
      { drugId: 'cetirizine', brand: 'Zyrtec', generic: 'Cetirizine', strength: '10 mg', form: 'Tablet', dose: '1', route: 'Oral', frequency: 'At bedtime', durationDays: 5, quantity: 5, instructions: 'May cause drowsiness', prn: false },
    ],
  },
  {
    id: 'htn',
    name: 'Hypertension, first visit',
    note: 'Start low, review BP in 2 weeks, salt restriction advice',
    lines: [
      { drugId: 'amlodipine', brand: 'Norvasc', generic: 'Amlodipine', strength: '5 mg', form: 'Tablet', dose: '1', route: 'Oral', frequency: 'Once daily', durationDays: 14, quantity: 14, instructions: 'Morning', prn: false },
      { drugId: 'hydrochlorothiazide', brand: 'Esidrex', generic: 'Hydrochlorothiazide', strength: '25 mg', form: 'Tablet', dose: '1', route: 'Oral', frequency: 'Once daily', durationDays: 14, quantity: 14, instructions: 'Morning, may increase urination', prn: false },
    ],
  },
  {
    id: 'gastro',
    name: 'Acute gastroenteritis',
    note: 'ORS is the treatment; antibiotic only if bloody stools or high fever',
    lines: [
      { drugId: 'ors', brand: 'Orsaline-N', generic: 'Oral rehydration salt', strength: '1 sachet', form: 'Sachet', dose: '1 sachet in 500 ml water', route: 'Oral', frequency: 'As needed (PRN)', durationDays: 3, quantity: 6, instructions: 'Small sips after every stool', prn: true },
      { drugId: 'zinc', brand: 'Zinc-B', generic: 'Zinc sulfate', strength: '20 mg', form: 'Dispersible tablet', dose: '1', route: 'Oral', frequency: 'Once daily', durationDays: 14, quantity: 14, instructions: 'Children: dissolve in water', prn: false },
    ],
  },
];

/* ------------------------------------------------------------- prescription safety screen */

export interface ScreenHit {
  severity: 'critical' | 'warning';
  kind: 'abbreviation' | 'allergy' | 'high-alert';
  message: string;
  fix: string;
}

/** Abbreviations that must never appear on a prescription (ISMP list, trimmed to what this formulary uses). */
export const FORBIDDEN_ABBREVIATIONS: Array<{ abbr: string; pattern: RegExp; why: string; fix: string }> = [
  { abbr: 'U', pattern: /\bU\b(?!\w)/, why: '“U” is read as 0 or 4, which has caused ten-fold overdoses', fix: 'Write “units” in full' },
  { abbr: 'IU', pattern: /\bIU\b/, why: 'Read as IV or 10', fix: 'Write “international units”' },
  { abbr: 'MS / MSO4', pattern: /\bMS(O4)?\b/, why: 'Read as morphine or magnesium sulfate', fix: 'Write the full drug name' },
  { abbr: 'MgSO4', pattern: /\bMgSO4\b/, why: 'Confused with morphine sulfate', fix: 'Write “magnesium sulfate”' },
  { abbr: 'µg', pattern: /µg|\bug\b/, why: 'Read as mg', fix: 'Write “microgram”' },
  { abbr: 'D/C', pattern: /\bD\/C\b/, why: 'Means both “discharge” and “discontinue”', fix: 'Write which one you mean' },
  { abbr: 'qd / q.d.', pattern: /\bq\.?d\b/i, why: 'Misread as qid', fix: 'Write “once daily”' },
  { abbr: 'QOD', pattern: /\bQOD\b/i, why: 'Misread as qd or qid', fix: 'Write “every other day”' },
  { abbr: 'hs', pattern: /\bhs\b/, why: 'Misread as half strength', fix: 'Write “at bedtime”' },
  { abbr: 'SC / SQ', pattern: /\bS[QC]\b/, why: 'One is read as SL', fix: 'Write “subcutaneous”' },
];

/** Free-text screen for the instructions field, so the guard runs even on a hand-typed line. */
export function screenText(text: string): ScreenHit[] {
  const hits: ScreenHit[] = [];
  for (const rule of FORBIDDEN_ABBREVIATIONS) {
    if (rule.pattern.test(text)) {
      hits.push({ severity: 'warning', kind: 'abbreviation', message: `“${rule.abbr}”: ${rule.why}`, fix: rule.fix });
    }
  }
  return hits;
}

/** Allergy check: exact allergen-group matching, with the drug that triggered it named. */
export function allergyHits(lines: RxLine[], drugs: DrugRef[], allergies: string): ScreenHit[] {
  const stated = allergies.split(/[,;]/).map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (stated.length === 0) return [];
  const hits: ScreenHit[] = [];
  for (const line of lines) {
    const drug = drugs.find((d) => d.id === line.drugId);
    if (!drug) continue;
    for (const tag of drug.allergenTags) {
      if (stated.some((s) => tag.toLowerCase().includes(s) || s.includes(tag.toLowerCase()))) {
        hits.push({
          severity: 'critical',
          kind: 'allergy',
          message: `${line.brand} (${line.generic}) is in the “${tag}” group — this patient has “${allergies}” on record`,
          fix: 'Remove it or choose another class; if it must be given, record the reason and the supervising doctor',
        });
      }
    }
  }
  return hits;
}

export function highAlertHits(lines: RxLine[], drugs: DrugRef[]): ScreenHit[] {
  return lines
    .map((line) => ({ line, drug: drugs.find((d) => d.id === line.drugId) }))
    .filter((x) => x.drug?.highAlert)
    .map((x) => ({
      severity: 'warning' as const,
      kind: 'high-alert' as const,
      message: `${x.line.brand} is a high-alert medicine`,
      fix: 'Double-check the dose against weight and renal function, and have a second person verify at dispensing',
    }));
}

/* ------------------------------------------------------------------------------ encounters */

export interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface Encounter {
  id: string;
  token: string;
  patient: Pick<Patient, 'mrn' | 'name' | 'nameBn' | 'age' | 'sex' | 'phone' | 'allergies' | 'payer'>;
  doctorId: string;
  room: string;
  arrivedAt: string;
  status: EncounterStatus;
  reason: string;
  vitals: Partial<Record<string, number>>;
  diagnoses: IcdCode[];
  soap: SoapNote;
  orders: OrderLine[];
  rx: RxLine[];
  signedAt?: string;
  signedBy?: string;
  addenda: Array<{ at: string; by: string; text: string }>;
  /** What the patient was told, in Bangla — printed on the prescription so the advice survives the visit. */
  adviceBn: string;
}

const REASONS = [
  'Fever and cough for 4 days',
  'Follow-up: blood pressure review',
  'Diabetes review, reports attached',
  'Chest discomfort on exertion',
  'Child: feeding difficulty',
  'Antenatal check-up',
  'Knee pain, X-ray attached',
  'Wound dressing review',
  'Persistent headache',
  'Routine health screening',
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

/** Deterministic OPD list for a day: ten patients, a mix of waiting, in-room and already signed. */
export function generateEncounters(dayIso: string): Encounter[] {
  const rand = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 11) * 6151);
  const doctors = [
    { id: 'dr-rahman', room: 'OPD-1' },
    { id: 'dr-chowdhury', room: 'OPD-3' },
    { id: 'dr-islam', room: 'OPD-5' },
    { id: 'dr-hossain', room: 'OPD-7' },
  ];

  return Array.from({ length: 10 }, (_, i) => {
    const doctor = doctors[Math.floor(rand() * doctors.length)];
    const patient = patients[Math.floor(rand() * patients.length)];
    const statusPool: EncounterStatus[] = ['Waiting', 'Waiting', 'In consultation', 'Signed', 'Signed'];
    const status = statusPool[Math.floor(rand() * statusPool.length)];
    /* Arrivals start at 09:00 in half-hour steps with a random offset. The offset has to be carried into the
       hour: minutes 17 to 40 past the half-hour would otherwise read 09:70, which is not a time anyone can print. */
    const arrivalMinutes = (9 + Math.floor(i / 2)) * 60 + (i % 2) * 30 + (rand() < 0.5 ? 10 : 40);
    const hour = Math.floor(arrivalMinutes / 60);
    const minute = arrivalMinutes % 60;
    const id = `ENC-${dayIso.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`;

    const vitalKeys = VITALS.map((v) => v.key);
    const vitals: Partial<Record<string, number>> = {};
    for (const key of vitalKeys) {
      if (rand() < 0.25) continue;
      const def = VITALS.find((v) => v.key === key)!;
      const span = def.high - def.low;
      const jitter = def.step && def.step < 1 ? Number((rand() * 2 - 0.6).toFixed(1)) : Math.round((rand() * 2 - 0.6) * span * 0.35);
      vitals[key] = def.step && def.step < 1 ? Number((def.low + span * 0.4 + jitter).toFixed(1)) : Math.round(def.low + span * 0.4 + jitter);
    }
    if (vitals.weight && vitals.height) vitals.bmi = bmi(vitals.weight, vitals.height) ?? undefined;

    const diagnosis = ICD10[Math.floor(rand() * ICD10.length)];
    const template = RX_TEMPLATES[Math.floor(rand() * RX_TEMPLATES.length)];
    const signed = status === 'Signed';
    const rx: RxLine[] = (signed || status === 'In consultation' ? template.lines : []).map((line, n) => ({
      ...line,
      id: `${id}-RX${n + 1}`,
    }));
    const orderCount = rand() < 0.5 ? 1 : 0;
    const orders: OrderLine[] = Array.from({ length: orderCount }, (_, n) => {
      const item = ORDERS[Math.floor(rand() * ORDERS.length)];
      return {
        id: `${id}-O${n + 1}`,
        code: item.code,
        name: item.name,
        kind: item.kind,
        priority: rand() < 0.15 ? 'Urgent' : 'Routine',
        status: signed ? 'Ordered' : 'Draft',
        specimenId: signed && item.kind === 'lab' ? `SP-${String(4100 + i * 3 + n)}` : undefined,
      };
    });

    return {
      id,
      token: `${doctor.room.replace('OPD-', '')}-${String(101 + i)}`,
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
      doctorId: doctor.id,
      room: doctor.room,
      arrivedAt: `${dayIso} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      status,
      reason: REASONS[Math.floor(rand() * REASONS.length)],
      vitals,
      diagnoses: signed && rand() < 0.8 ? [diagnosis] : status === 'In consultation' ? [diagnosis] : [],
      soap: {
        subjective: signed ? `${REASONS[i % REASONS.length]}. No chest pain, no breathlessness. Appetite fair.` : '',
        objective: signed ? 'Alert, oriented. Chest clear, S1 S2 normal, abdomen soft, no oedema.' : '',
        assessment: signed ? `${diagnosis.label} (${diagnosis.code}).` : '',
        plan: signed ? `${template.note}. Review in ${rand() < 0.5 ? 2 : 4} weeks with reports.` : '',
      },
      orders,
      rx,
      signedAt: signed ? `${dayIso} ${String(hour).padStart(2, '0')}:${String(Math.min(59, minute + 22)).padStart(2, '0')}` : undefined,
      signedBy: signed ? 'Dr. A. Rahman (BMDC 42118)' : undefined,
      addenda: [],
      adviceBn: signed ? 'নিয়মিত ওষুধ সেবন করুন, খাবার নিয়ন্ত্রণ রাখুন, জ্বর বা শ্বাসকষ্ট হলে দ্রুত আসুন।' : '',
    };
  }).sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));
}

export const encounterById = (id: string, dayIso: string): Encounter | undefined =>
  generateEncounters(dayIso).find((e) => e.id === id);
