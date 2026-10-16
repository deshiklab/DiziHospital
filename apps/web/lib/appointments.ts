/* -----------------------------------------------------------------------------
 * Appointment data + scheduling rules (synthetic, deterministic).
 *
 * This module is the specification of the booking rules in code form: slot steps, shift windows, per-doctor
 * capacity, the status flow and the source of a booking. When the real API lands (P1), these rules move to the
 * server — the screens keep importing the same shapes, so only the implementation of `book()` changes.
 */

import { patients, type Patient } from './mock';

export const SLOT_MINUTES = 15;
export const DAY_START = 9 * 60;
export const DAY_END = 14 * 60;

export type AppointmentStatus =
  | 'Requested'
  | 'Confirmed'
  | 'Checked in'
  | 'Waiting'
  | 'In consultation'
  | 'Completed'
  | 'No show'
  | 'Cancelled';

export type Priority = 'Routine' | 'Urgent' | 'Emergency';
export type AppointmentType = 'New' | 'Follow-up' | 'Report review' | 'Procedure';
export type Source = 'Walk-in' | 'Phone' | 'Online portal' | 'Follow-up';

export interface Doctor {
  id: string;
  name: string;
  department: string;
  room: string;
  /** Slot capacity per appointment; a consultation blocks the following slots as needed. */
  capacity: number;
}

export interface Appointment {
  id: string;
  token: string;
  doctorId: string;
  /** Minutes from midnight — the slot start, in the branch's own clock. */
  start: number;
  durationMin: number;
  patient: Pick<Patient, 'mrn' | 'name' | 'nameBn' | 'sex' | 'phone'> & {
    /* A patient whose age or allergy has never been recorded is not a patient aged nothing with no allergies: the
       API sends null and the screens print "—" rather than a number nobody typed. */
    age?: number | null;
    allergies?: string | null;
  };
  type: AppointmentType;
  status: AppointmentStatus;
  priority: Priority;
  source: Source;
  reason: string;
  /** The branch's day, when the row came from the API rather than from a generator that was handed one. */
  day?: string;
  /** The room the desk sends the patient to, as the branch's roster had it at booking time. */
  room?: string;
  /** How many slot steps the consultation claims. The grid blocks the whole claim, not its first slot. */
  steps?: number;
  liveConsultation: boolean;
  /** When the booking was taken. The API keeps it in the ledger rather than on the row, so a row read back from the
      server has none — and the detail sheet says where to look instead of showing a plausible time. */
  createdAt?: string;
  /** Still in the local outbox: the screen says so rather than implying the branch holds the slot. */
  queued?: boolean;
}

export const DOCTORS: Doctor[] = [
  { id: 'dr-rahman', name: 'Dr. A. Rahman', department: 'Medicine', room: 'OPD-1', capacity: 3 },
  { id: 'dr-chowdhury', name: 'Dr. S. Chowdhury', department: 'Medicine', room: 'OPD-3', capacity: 3 },
  { id: 'dr-islam', name: 'Dr. N. Islam', department: 'Cardiology', room: 'OPD-5', capacity: 4 },
  { id: 'dr-hossain', name: 'Dr. T. Hossain', department: 'Paediatrics', room: 'OPD-7', capacity: 2 },
  { id: 'dr-akter', name: 'Dr. R. Akter', department: 'Obstetrics', room: 'OPD-9', capacity: 2 },
  { id: 'dr-khan', name: 'Dr. M. Khan', department: 'Orthopaedics', room: 'OPD-11', capacity: 4 },
];

export const doctorById = (id: string): Doctor => DOCTORS.find((d) => d.id === id) ?? DOCTORS[0];

export const timeLabel = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const timeValue = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Every bookable slot of a day, in order. */
export function daySlots(): number[] {
  const slots: number[] = [];
  for (let t = DAY_START; t < DAY_END; t += SLOT_MINUTES) slots.push(t);
  return slots;
}

/** Which slots a given appointment occupies (its duration may span several slot steps). */
export function slotsOf(a: Pick<Appointment, 'start' | 'durationMin'>): number[] {
  const count = Math.max(1, Math.ceil(a.durationMin / SLOT_MINUTES));
  return Array.from({ length: count }, (_, i) => a.start + i * SLOT_MINUTES);
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
const TYPES: AppointmentType[] = ['New', 'Follow-up', 'Report review', 'Procedure'];
const SOURCES: Source[] = ['Walk-in', 'Phone', 'Online portal', 'Follow-up'];
const PRIORITIES: Priority[] = ['Routine', 'Routine', 'Routine', 'Urgent', 'Emergency'];

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STATUS_FLOW: Record<AppointmentStatus, AppointmentStatus[]> = {
  /* The moves the service accepts, in the contract's own words, and `services/api` is where they are enforced. The
     two terminal states are terminal: a cancelled appointment's slot is already free again and a no-show is a fact
     about the day, so a patient who comes back is a *new* booking rather than this row dragged backwards. */
  Cancelled: [],
  'No show': [],
  Requested: ['Confirmed', 'Cancelled'],
  Confirmed: ['Checked in', 'No show', 'Cancelled'],
  'Checked in': ['Waiting', 'In consultation', 'Cancelled'],
  Waiting: ['In consultation', 'Cancelled'],
  'In consultation': ['Completed'],
  Completed: [],
};

export const statusTone: Record<AppointmentStatus, 'neutral' | 'info' | 'warning' | 'success' | 'critical'> = {
  Requested: 'warning',
  Confirmed: 'info',
  'Checked in': 'info',
  Waiting: 'warning',
  'In consultation': 'success',
  Completed: 'neutral',
  'No show': 'critical',
  Cancelled: 'critical',
};

export const QUEUE_COLUMNS = ['Confirmed', 'Checked in', 'Waiting', 'In consultation', 'Completed'] as const;

/** Deterministic seed data for one day. Booked slots never overlap for the same doctor. */
export function generateAppointments(dayIso: string): Appointment[] {
  const seed = [...dayIso].reduce((acc, ch) => acc + ch.charCodeAt(0), 7) * 7919;
  const rand = rng(seed);
  const list: Appointment[] = [];
  let counter = 0;

  for (const doctor of DOCTORS) {
    const taken = new Set<number>();
    for (const slot of daySlots()) {
      if (taken.has(slot)) continue;
      // Roughly half the slots fill up, with the morning busier than the late session.
      const fillChance = slot < 11 * 60 ? 0.62 : 0.4;
      if (rand() > fillChance) continue;

      const duration = rand() < 0.22 ? SLOT_MINUTES * 2 : SLOT_MINUTES;
      const patient = patients[Math.floor(rand() * patients.length)];
      for (const s of Array.from({ length: Math.ceil(duration / SLOT_MINUTES) }, (_, i) => slot + i * SLOT_MINUTES)) {
        taken.add(s);
      }

      const statusPool: AppointmentStatus[] = slot < 11 * 60
        ? ['Completed', 'Completed', 'In consultation', 'Waiting', 'Checked in']
        : ['Confirmed', 'Checked in', 'Confirmed', 'No show'];
      const status = statusPool[Math.floor(rand() * statusPool.length)];

      counter += 1;
      list.push({
        id: `APT-${dayIso.replace(/-/g, '')}-${String(counter).padStart(3, '0')}`,
        token: `${doctor.room.replace('OPD-', '')}-${String(counter).padStart(3, '0')}`,
        doctorId: doctor.id,
        start: slot,
        durationMin: duration,
        patient: {
          mrn: patient.mrn,
          name: patient.name,
          nameBn: patient.nameBn,
          age: patient.age,
          sex: patient.sex,
          phone: patient.phone,
          allergies: patient.allergies,
        },
        type: TYPES[Math.floor(rand() * TYPES.length)],
        status,
        priority: PRIORITIES[Math.floor(rand() * PRIORITIES.length)],
        source: SOURCES[Math.floor(rand() * SOURCES.length)],
        reason: REASONS[Math.floor(rand() * REASONS.length)],
        liveConsultation: rand() < 0.12,
        createdAt: `${dayIso} 08:${String(Math.floor(rand() * 59)).padStart(2, '0')}`,
      });
    }
  }

  return list.sort((a, b) => a.start - b.start);
}

export interface OnlineRequest {
  id: string;
  requestedAt: string;
  patient: Pick<Patient, 'mrn' | 'name' | 'nameBn' | 'phone' | 'age' | 'sex'>;
  department: string;
  doctorId: string | null;
  preferredDate: string;
  preferredWindow: 'Morning' | 'Afternoon' | 'Evening';
  priority: Priority;
  liveConsultation: boolean;
  note: string;
  status: 'Pending' | 'Approved' | 'Declined' | 'Rescheduled';
}

export function onlineRequests(dayIso: string): OnlineRequest[] {
  const rand = rng(4242);
  const windows: OnlineRequest['preferredWindow'][] = ['Morning', 'Afternoon', 'Evening'];
  return Array.from({ length: 9 }, (_, i) => {
    const patient = patients[Math.floor(rand() * patients.length)];
    const doctor = rand() < 0.7 ? DOCTORS[Math.floor(rand() * DOCTORS.length)] : null;
    return {
      id: `REQ-${String(1041 + i)}`,
      requestedAt: `${dayIso} ${String(6 + Math.floor(rand() * 5)).padStart(2, '0')}:${String(Math.floor(rand() * 59)).padStart(2, '0')}`,
      patient: { mrn: patient.mrn, name: patient.name, nameBn: patient.nameBn, phone: patient.phone, age: patient.age, sex: patient.sex },
      department: doctor?.department ?? 'Any',
      doctorId: doctor?.id ?? null,
      preferredDate: dayIso,
      preferredWindow: windows[Math.floor(rand() * windows.length)],
      priority: PRIORITIES[Math.floor(rand() * PRIORITIES.length)],
      liveConsultation: rand() < 0.25,
      note: rand() < 0.5 ? 'Please give an early slot, coming from Narayanganj.' : '',
      status: 'Pending',
    };
  });
}

/** Slot availability for one doctor on one day, taking existing appointments into account. */
export function availability(doctorId: string, appointments: Appointment[]): Map<number, Appointment | null> {
  const map = new Map<number, Appointment | null>();
  const doctorAppointments = appointments.filter((a) => a.doctorId === doctorId && a.status !== 'Cancelled');
  for (const slot of daySlots()) {
    const hit = doctorAppointments.find((a) => slotsOf(a).includes(slot));
    map.set(slot, hit ?? null);
  }
  return map;
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
