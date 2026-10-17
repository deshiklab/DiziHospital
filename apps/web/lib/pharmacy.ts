/* -----------------------------------------------------------------------------
 * Pharmacy (P3) — formulary, stock batches and the dispensing rules, in code.
 *
 * Three rules are the whole point of this module, and each one is visible on the screen it drives:
 *  1. **FEFO** — first expiry, first out. Expired stock cannot be selected at all.
 *  2. **Allergy and high-alert checks run at the counter, not only in the consultation room**, because a
 *     prescription written yesterday is dispensed today by somebody else.
 *  3. **A substitution keeps both names** — the patient pays for what they get, and the prescriber sees what
 *     was actually given.
 *
 * The stock numbers are synthetic and deterministic so a demo can be repeated; the ledger shows the movement
 * rather than a single balance, because a balance you cannot explain is a balance nobody trusts.
 */

import { generateEncounters, type RxLine } from './clinical';
import type { DrugRef } from './clinical';

export interface Drug extends DrugRef {
  /** Price per unit in Taka, as the retail price, not the purchase price. */
  price: number;
  controlled: boolean;
  highAlert: boolean;
  /** The class shown on the label, e.g. "Antidiabetic — biguanide". */
  klass: string;
  bengaliName: string;
}

/** A short formulary, deliberately: every entry has the allergy group it belongs to. */
export const DRUGS: Drug[] = [
  { id: 'metformin', brand: 'Glucophage', generic: 'Metformin', strength: '500 mg', form: 'Tablet', allergenTags: [], price: 3, controlled: false, highAlert: false, klass: 'Antidiabetic — biguanide', bengaliName: 'মেটফরমিন' },
  { id: 'amlodipine', brand: 'Norvasc', generic: 'Amlodipine', strength: '5 mg', form: 'Tablet', allergenTags: [], price: 5, controlled: false, highAlert: false, klass: 'Antihypertensive — calcium channel blocker', bengaliName: 'অ্যামলোডিপিন' },
  { id: 'hydrochlorothiazide', brand: 'Esidrex', generic: 'Hydrochlorothiazide', strength: '25 mg', form: 'Tablet', allergenTags: ['Sulfa drugs'], price: 2, controlled: false, highAlert: false, klass: 'Diuretic — thiazide', bengaliName: 'হাইড্রোক্লোরোথায়াজাইড' },
  { id: 'paracetamol', brand: 'Napa', generic: 'Paracetamol', strength: '500 mg', form: 'Tablet', allergenTags: [], price: 1, controlled: false, highAlert: false, klass: 'Analgesic — antipyretic', bengaliName: 'প্যারাসিটামল' },
  { id: 'cetirizine', brand: 'Zyrtec', generic: 'Cetirizine', strength: '10 mg', form: 'Tablet', allergenTags: [], price: 4, controlled: false, highAlert: false, klass: 'Antihistamine — second generation', bengaliName: 'সেটিরিজিন' },
  { id: 'amoxicillin', brand: 'Moxacil', generic: 'Amoxicillin', strength: '500 mg', form: 'Capsule', allergenTags: ['Penicillin'], price: 8, controlled: false, highAlert: false, klass: 'Antibiotic — penicillin', bengaliName: 'অ্যামোক্সিসিলিন' },
  { id: 'cotrimoxazole', brand: 'Bactrim', generic: 'Cotrimoxazole', strength: '960 mg', form: 'Tablet', allergenTags: ['Sulfa drugs'], price: 6, controlled: false, highAlert: false, klass: 'Antibiotic — sulfonamide', bengaliName: 'কোট্রিমক্সাজল' },
  { id: 'ibuprofen', brand: 'Brufen', generic: 'Ibuprofen', strength: '400 mg', form: 'Tablet', allergenTags: ['NSAIDs'], price: 3, controlled: false, highAlert: false, klass: 'NSAID — propionic acid', bengaliName: 'আইবুপ্রোফেন' },
  { id: 'diclofenac', brand: 'Voveran', generic: 'Diclofenac sodium', strength: '50 mg', form: 'Tablet', allergenTags: ['NSAIDs'], price: 4, controlled: false, highAlert: false, klass: 'NSAID — acetic acid', bengaliName: 'ডাইক্লোফেনাক' },
  { id: 'aspirin', brand: 'Ecosprin', generic: 'Aspirin', strength: '75 mg', form: 'Tablet', allergenTags: ['NSAIDs'], price: 2, controlled: false, highAlert: false, klass: 'Antiplatelet', bengaliName: 'অ্যাসপিরিন' },
  { id: 'omeprazole', brand: 'Sergel', generic: 'Omeprazole', strength: '20 mg', form: 'Capsule', allergenTags: [], price: 6, controlled: false, highAlert: false, klass: 'Proton pump inhibitor', bengaliName: 'ওমিপ্রাজল' },
  { id: 'ors', brand: 'Orsaline-N', generic: 'Oral rehydration salt', strength: '1 sachet', form: 'Sachet', allergenTags: [], price: 6, controlled: false, highAlert: false, klass: 'Rehydration', bengaliName: 'ওরস্যালাইন' },
  { id: 'zinc', brand: 'Zinc-B', generic: 'Zinc sulfate', strength: '20 mg', form: 'Dispersible tablet', allergenTags: [], price: 2, controlled: false, highAlert: false, klass: 'Supplement', bengaliName: 'জিংক' },
  { id: 'salbutamol', brand: 'Ventolin', generic: 'Salbutamol', strength: '100 mcg/dose', form: 'Inhaler', allergenTags: [], price: 320, controlled: false, highAlert: false, klass: 'Bronchodilator — short acting', bengaliName: 'সালবিউটামল' },
  { id: 'prednisolone', brand: 'Cortan', generic: 'Prednisolone', strength: '5 mg', form: 'Tablet', allergenTags: [], price: 3, controlled: false, highAlert: false, klass: 'Corticosteroid', bengaliName: 'প্রেডনিসোলন' },
  { id: 'insulin-soluble', brand: 'Humulin R', generic: 'Insulin (soluble human)', strength: '100 IU/ml', form: 'Vial', allergenTags: [], price: 620, controlled: false, highAlert: true, klass: 'Antidiabetic — insulin', bengaliName: 'ইনসুলিন' },
  { id: 'heparin', brand: 'Heparin', generic: 'Heparin sodium', strength: '5000 IU/ml', form: 'Vial', allergenTags: [], price: 480, controlled: false, highAlert: true, klass: 'Anticoagulant', bengaliName: 'হেপারিন' },
  { id: 'morphine', brand: 'Morphine sulfate', generic: 'Morphine sulfate', strength: '10 mg/ml', form: 'Ampoule', allergenTags: [], price: 260, controlled: true, highAlert: true, klass: 'Opioid analgesic (controlled)', bengaliName: 'মরফিন' },
  { id: 'pethidine', brand: 'Pethidine', generic: 'Pethidine hydrochloride', strength: '50 mg/ml', form: 'Ampoule', allergenTags: [], price: 240, controlled: true, highAlert: true, klass: 'Opioid analgesic (controlled)', bengaliName: 'পেথিডিন' },
  { id: 'furosemide', brand: 'Lasix', generic: 'Furosemide', strength: '40 mg', form: 'Tablet', allergenTags: ['Sulfa drugs'], price: 3, controlled: false, highAlert: false, klass: 'Diuretic — loop', bengaliName: 'ফুরোসেমাইড' },
];

export const drugById = (id: string): Drug | undefined => DRUGS.find((d) => d.id === id);
/** Same generic first, then the same class — which is what a pharmacist actually reaches for. */
export const substitutesFor = (drug: Drug): Drug[] =>
  DRUGS.filter((d) => d.id !== drug.id && (d.generic === drug.generic || d.klass.split('—')[0].trim() === drug.klass.split('—')[0].trim()));

export const searchDrugs = (q: string): Drug[] => {
  const needle = q.trim().toLowerCase();
  if (!needle) return DRUGS.slice(0, 8);
  return DRUGS.filter(
    (d) => d.brand.toLowerCase().includes(needle) || d.generic.toLowerCase().includes(needle) || d.bengaliName.includes(needle),
  ).slice(0, 8);
};

/* ------------------------------------------------------------------------------ stock */

export interface Batch {
  id: string;
  drugId: string;
  batchNo: string;
  expiry: string; // ISO date
  qty: number;
  location: string;
  supplier: string;
}

/** Days from today (ISO) until an expiry date. */
export function daysToExpiry(expiry: string, dayIso: string): number {
  return Math.round((new Date(`${expiry}T00:00:00`).getTime() - new Date(`${dayIso}T00:00:00`).getTime()) / 86_400_000);
}

export const EXPIRY_WARN_DAYS = 90;

export type ExpiryState = 'expired' | 'expiring' | 'ok';
export const expiryState = (expiry: string, dayIso: string): ExpiryState => {
  const days = daysToExpiry(expiry, dayIso);
  return days < 0 ? 'expired' : days <= EXPIRY_WARN_DAYS ? 'expiring' : 'ok';
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

const shift = (dayIso: string, days: number): string => {
  const d = new Date(`${dayIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Batches for the whole formulary, with a deliberate mix: some already expired, some about to. */
export function generateBatches(dayIso: string): Batch[] {
  const rand = rng(90210);
  return DRUGS.flatMap((drug) => {
    const count = 1 + Math.floor(rand() * 3);
    return Array.from({ length: count }, (_, i) => {
      const expiryOffset = Math.floor(rand() * 500) - 35; // a few past their date, on purpose
      return {
        id: `${drug.id}-B${i + 1}`,
        drugId: drug.id,
        batchNo: `${drug.id.slice(0, 3).toUpperCase()}-${String(2400 + Math.floor(rand() * 800)).padStart(4, '0')}`,
        expiry: shift(dayIso, expiryOffset),
        qty: Math.floor(rand() * (drug.controlled ? 40 : 600)) + (rand() < 0.12 ? 0 : 20),
        location: `${rand() < 0.5 ? 'Rack A' : 'Fridge'}·${1 + Math.floor(rand() * 6)}`,
        supplier: rand() < 0.5 ? 'Eskayef' : 'Square Pharma',
      };
    });
  });
}

/** FEFO: usable batches only, earliest expiry first. */
export function fefo(batches: Batch[], drugId: string, dayIso: string): Batch[] {
  return batches
    .filter((b) => b.drugId === drugId && b.qty > 0 && expiryState(b.expiry, dayIso) !== 'expired')
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}

export const stockOnHand = (batches: Batch[], drugId: string): number =>
  batches.filter((b) => b.drugId === drugId).reduce((sum, b) => sum + b.qty, 0);

/* --------------------------------------------------------------- dispensing and the ledger */

export type DispenseStatus = 'Waiting' | 'In progress' | 'Dispensed' | 'Partially dispensed' | 'Returned';

export interface DispenseLine {
  id: string;
  rxLine: RxLine;
  drug: Drug;
  batchId: string | null;
  qty: number;
  substitution?: { from: string; to: string; reason: string };
}

export interface Dispense {
  id: string;
  encounterId: string;
  rxNumber: string;
  patient: { mrn: string; name: string; nameBn: string; age: number; sex: string; allergies: string; payer: string };
  prescriber: string;
  room: string;
  orderedAt: string;
  status: DispenseStatus;
  lines: DispenseLine[];
  dispensedAt?: string;
  dispensedBy?: string;
  witness?: string;
  total: number;
  /** 1 for the first counter queue, 2 for the pharmacy; the counters are physical, not logical. */
  counter: number;
}

/** Today's pharmacy queue: every signed prescription, plus two hand-written ones from the emergency desk. */
export function generateDispenses(dayIso: string, batchList?: Batch[]): Dispense[] {
  const batches = batchList ?? generateBatches(dayIso);
  const signed = generateEncounters(dayIso).filter((e) => e.status === 'Signed' && e.rx.length > 0);

  return signed.map((enc, index) => {
    const lines: DispenseLine[] = enc.rx.map((rxLine, n) => {
      const drug = drugById(rxLine.drugId) ?? DRUGS[0];
      const pick = fefo(batches, drug.id, dayIso)[0] ?? null;
      return { id: `${enc.id}-D${n + 1}`, rxLine, drug, batchId: pick?.id ?? null, qty: rxLine.quantity };
    });
    const statusPool: DispenseStatus[] = ['Waiting', 'Waiting', 'In progress', 'Dispensed', 'Dispensed', 'Partially dispensed'];
    const status = statusPool[index % statusPool.length];
    const total = lines.reduce((sum, l) => sum + l.qty * l.drug.price, 0);
    return {
      id: `DSP-${String(701 + index)}`,
      encounterId: enc.id,
      rxNumber: `RX-${dayIso.replace(/-/g, '')}-${String(101 + index)}`,
      patient: {
        mrn: enc.patient.mrn,
        name: enc.patient.name,
        nameBn: enc.patient.nameBn,
        age: enc.patient.age,
        sex: enc.patient.sex,
        allergies: enc.patient.allergies,
        payer: enc.patient.payer,
      },
      prescriber: 'Dr. A. Rahman',
      room: enc.room,
      orderedAt: enc.signedAt ?? enc.arrivedAt,
      status,
      lines,
      dispensedAt: status === 'Dispensed' ? `${dayIso} ${String(12 + index % 4).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}` : undefined,
      dispensedBy: status === 'Dispensed' ? 'R. Haque (pharmacist)' : undefined,
      witness: lines.some((l) => l.drug.controlled) && status === 'Dispensed' ? 'N. Sultana (nurse)' : undefined,
      total: Math.round(total),
      counter: 1 + (index % 2),
    };
  });
}

export type MovementKind = 'Receipt' | 'Dispensed' | 'Return' | 'Adjustment' | 'Write-off (expired)';

export interface StockMovement {
  id: string;
  at: string;
  drugId: string;
  batchId: string;
  kind: MovementKind;
  qty: number; // positive in, negative out
  reference: string;
  by: string;
  note?: string;
}

/** The ledger is append-only: this is the shape the API will persist, one row per movement. */
export function generateLedger(dayIso: string, batches: Batch[], dispenses: Dispense[]): StockMovement[] {
  const rand = rng(3060);
  const out: StockMovement[] = [];

  for (const b of batches) {
    out.push({
      id: `MV-${out.length + 1}`,
      at: `${shift(dayIso, -20)} 09:15`,
      drugId: b.drugId,
      batchId: b.id,
      kind: 'Receipt',
      qty: b.qty + Math.floor(rand() * 100),
      reference: `GRN-${4100 + out.length}`,
      by: 'Store keeper',
      note: `Supplier ${b.supplier}`,
    });
    if (expiryState(b.expiry, dayIso) === 'expired') {
      out.push({
        id: `MV-${out.length + 1}`,
        at: `${shift(dayIso, -2)} 16:40`,
        drugId: b.drugId,
        batchId: b.id,
        kind: 'Write-off (expired)',
        qty: -(Math.min(b.qty, 12)),
        reference: 'WO-2026-114',
        by: 'R. Haque (pharmacist)',
        note: 'Expired on the shelf — quarantined, then destroyed with a witness',
      });
    }
  }

  for (const d of dispenses.filter((x) => x.status === 'Dispensed')) {
    for (const line of d.lines) {
      if (!line.batchId) continue;
      out.push({
        id: `MV-${out.length + 1}`,
        at: d.dispensedAt ?? `${dayIso} 00:00`,
        drugId: line.drug.id,
        batchId: line.batchId,
        kind: 'Dispensed',
        qty: -line.qty,
        reference: d.rxNumber,
        by: d.dispensedBy ?? 'Pharmacy',
      });
    }
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export interface ControlledEntry {
  id: string;
  at: string;
  drugId: string;
  qty: number;
  patient: string;
  mrn: string;
  prescriber: string;
  dispensedBy: string;
  witness: string;
  balanceAfter: number;
}

/** Every controlled movement gets both the dispenser and the witness, because that is what the law asks for. */
export function controlledRegister(disps: Dispense[], batches: Batch[], dayIso: string): ControlledEntry[] {
  const rows: ControlledEntry[] = [];
  for (const d of disps) {
    for (const line of d.lines) {
      if (!line.drug.controlled) continue;
      rows.push({
        id: `CD-${rows.length + 1}`,
        at: d.dispensedAt ?? d.orderedAt,
        drugId: line.drug.id,
        qty: line.qty,
        patient: d.patient.name,
        mrn: d.patient.mrn,
        prescriber: d.prescriber,
        dispensedBy: d.dispensedBy ?? '—',
        witness: d.witness ?? '—',
        balanceAfter: stockOnHand(batches, line.drug.id),
      });
    }
  }
  return rows;
}

export const dispenseTone: Record<DispenseStatus, 'neutral' | 'info' | 'warning' | 'success' | 'critical'> = {
  Waiting: 'warning',
  'In progress': 'info',
  Dispensed: 'success',
  'Partially dispensed': 'warning',
  Returned: 'critical',
};

export const QUEUE_COLUMNS = ['Waiting', 'In progress', 'Dispensed', 'Partially dispensed', 'Returned'] as const;
