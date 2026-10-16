/* ------------------------------------------------------------------- where the screens' rows come from
 *
 * The appointment screens are the first in this app that can be served by the hospital's own API. That is a data
 * source change, not a rewrite — the screens ask a question and render the answer — so the question is stated once,
 * here, as an interface with two implementations:
 *
 *   · **`apiSource`** — `services/api` (P0-401): the five contract operations, the branch's own diary, exclusive
 *     slots decided by a unique index, and refusals that arrive as `dizi.slot-taken` with the alternatives.
 *   · **`previewSource`** — the deterministic generator this screen was designed against, kept for exactly one job:
 *     a checkout, a design review or a corridor demo with no server running. It implements the *same* refusals from
 *     the same numbers (the contract's `x-dizi-scheduling`), so a screen that behaves correctly here behaves
 *     correctly there — which is what makes it a preview of the product rather than a second product.
 *
 * Which one is live is a fact, not a preference: `detectSource()` asks the API whether it is there and reports what
 * it found. The screens put that sentence on the screen, because a desk that cannot tell "this is the branch's diary"
 * from "this is sample data" is a desk that books a patient into a fixture.
 *
 * The booking sheet's patient search is still the preview register (`lib/mock.ts`): the registration screens move to
 * the API in their own slice, and the MRN the sheet sends is checked *by the API* either way, so a number nobody
 * carries is refused by the service rather than trusted by the form.
 */

import {
  DOCTORS,
  SLOT_MINUTES,
  availability,
  doctorById,
  generateAppointments,
  shiftDays,
  todayIso,
  type Appointment,
  type AppointmentStatus,
  type AppointmentType,
  type Priority,
  type Source,
} from './appointments';
import { ApiProblem, SCHEDULING, apiBook, apiCheckIn, apiDay, apiPatch, apiSlots, attemptKey, instantFor, probeApi, type SlotDayView } from './appointments-api';

/** The day, and the two filters the inbox and the board ask with. */
export interface DayQuery {
  day: string;
  doctorId?: string;
  status?: AppointmentStatus;
  source?: Source;
}

/** What a booking is made of, in the branch's own terms: a day and a minute, not an instant. */
export interface BookingInput {
  mrn: string;
  doctorId: string;
  day: string;
  start: number;
  type?: AppointmentType;
  priority?: Priority;
  source?: Source;
  reason?: string;
}

export interface PatchInput {
  status: 'Confirmed' | 'Cancelled' | 'No show';
  /** A move: the new day and minute, when the desk is rescheduling rather than changing a state. */
  day?: string;
  start?: number;
  because: string;
}

export interface DayPage {
  rows: Appointment[];
  asOf?: string;
}

export interface AppointmentsSource {
  readonly kind: 'api' | 'preview';
  /** The chip: one sentence a receptionist can read, saying whose diary this is. */
  readonly label: string;
  readonly because: string;
  day(query: DayQuery): Promise<DayPage>;
  slots(day: string, doctorId: string, excludeAppointmentId?: string): Promise<SlotDayView>;
  book(input: BookingInput): Promise<Appointment>;
  patch(id: string, input: PatchInput): Promise<Appointment>;
  checkIn(id: string): Promise<Appointment>;
}

/* ----------------------------------------------------------------------------------------- the API source */

export const apiSource: AppointmentsSource = {
  kind: 'api',
  label: 'Live — this branch’s diary, served by the hospital server',
  because:
    'Bookings, moves, cancellations and check-ins are written through the contract’s own operations, so a slot a second desk took is refused here with the times that are free.',

  async day(query) {
    return apiDay(query);
  },

  async slots(day, doctorId, excludeAppointmentId) {
    return apiSlots(day, doctorId, excludeAppointmentId);
  },

  async book(input) {
    return apiBook(
      {
        mrn: input.mrn,
        doctorId: input.doctorId,
        start: instantFor(input.day, input.start),
        type: input.type,
        priority: input.priority,
        source: input.source,
        reason: input.reason,
      },
      attemptKey(),
    );
  },

  async patch(id, input) {
    return apiPatch(
      id,
      {
        status: input.status,
        start: input.start !== undefined && input.day !== undefined ? instantFor(input.day, input.start) : undefined,
        because: input.because,
      },
      attemptKey(),
    );
  },

  async checkIn(id) {
    return apiCheckIn(id, attemptKey());
  },
};

/* ------------------------------------------------------------------------------------- the preview source */

/**
 * The preview's own diary, in memory for the session.
 *
 * It exists so that the *refusals* can be demonstrated without a server: a slot that is taken is refused with the
 * same code and the same sentence shape the API uses, because the alternative — a preview that lets a desk double-book
 * — is a preview that teaches the wrong reflex.
 */
const previewStore = new Map<string, Appointment[]>();

function previewDay(day: string): Appointment[] {
  const held = previewStore.get(day);
  if (held !== undefined) return held;

  const seeded = generateAppointments(day);
  previewStore.set(day, seeded);

  return seeded;
}

/** A refusal shaped exactly like the API's, so the screens have one kind of refusal to render. */
function previewRefusal(code: string, title: string, detail: string, extras: Record<string, unknown> = {}): ApiProblem {
  return new ApiProblem(code, title, code === 'dizi.slot-taken' ? 409 : 422, detail, extras);
}

/** The branch's weekday name, from the contract's zone rather than the browser's. */
function weekdayOf(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: SCHEDULING.timezone, weekday: 'long' }).format(new Date(`${day}T12:00:00Z`));
}

function assertClaimable(doctorId: string, day: string, start: number, rows: Appointment[]): void {
  const doctor = doctorById(doctorId);
  const closed = weekdayOf(day);

  if (SCHEDULING.closedOn.includes(closed)) {
    throw previewRefusal('dizi.validation-failed', 'That day cannot be booked', `The clinic is closed on ${closed}s. Choose the next open day — the calendar greys out the rest of the week so the desk can see the reason rather than guess it.`);
  }

  if (start < SCHEDULING.window.from || start + SCHEDULING.slotMinutes > SCHEDULING.window.to) {
    throw previewRefusal('dizi.validation-failed', 'That time is outside the sitting', `${doctor.name} sees patients between ${Math.floor(SCHEDULING.window.from / 60)}:00 and ${Math.floor(SCHEDULING.window.to / 60)}:00 in ${doctor.room}. A booking has to lie inside that window.`);
  }

  if ((start - SCHEDULING.window.from) % SCHEDULING.slotMinutes !== 0) {
    throw previewRefusal('dizi.validation-failed', 'That time is not on the slot grid', `Slots start every ${SCHEDULING.slotMinutes} minutes from ${Math.floor(SCHEDULING.window.from / 60)}:00. Book ${Math.floor((SCHEDULING.window.from + Math.floor((start - SCHEDULING.window.from) / SCHEDULING.slotMinutes) * SCHEDULING.slotMinutes) / 60)}:${String((SCHEDULING.window.from + Math.floor((start - SCHEDULING.window.from) / SCHEDULING.slotMinutes) * SCHEDULING.slotMinutes) % 60).padStart(2, '0')} instead.`);
  }

  if (shiftDays(todayIso(), SCHEDULING.horizonDays) < day) {
    throw previewRefusal('dizi.validation-failed', 'That day is beyond the booking horizon', `Bookings are taken up to ${SCHEDULING.horizonDays} days ahead, and ${day} is further out than that.`);
  }

  /* The claim covers the whole consultation, not its first slot: offering a 09:30 that only fits until 09:45 is
     offering a slot that would be refused a second later. */
  const claim = claimOf(doctorId);
  for (let i = 0; i < claim; i += 1) {
    const holder = rows.find((row) => row.doctorId === doctorId && row.status !== 'Cancelled' && slotsOf(row).includes(start + i * SLOT_MINUTES));
    if (holder !== undefined) {
      const alternatives = nextFree(doctorId, day, start, 3);
      throw previewRefusal(
        'dizi.slot-taken',
        'That slot has just been taken',
        `${doctor.name} at ${clock(start)} on ${day} is held by token ${holder.token}. The desk that took the booking keeps it — take one of the times below.`,
        {
          slot: `${day}T${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}:00+06:00`,
          heldBy: 'This branch',
          requestedBy: 'This branch',
          alternatives: alternatives.map((minute) => ({ start: `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00+06:00`, day, minutes: minute })),
        },
      );
    }
  }
}

function claimOf(doctorId: string): number {
  return Math.max(1, doctorById(doctorId).capacity);
}

function slotsOf(appointment: Appointment): number[] {
  const count = Math.max(1, Math.ceil(appointment.durationMin / SLOT_MINUTES));

  return Array.from({ length: count }, (_, i) => appointment.start + i * SLOT_MINUTES);
}

/** The starts a refused booking can take instead: same day, after the one that was taken. */
function nextFree(doctorId: string, day: string, fromMinute: number, take: number): number[] {
  const rows = previewDay(day);
  const found: number[] = [];

  for (let minute = SCHEDULING.window.from; minute + SCHEDULING.slotMinutes <= SCHEDULING.window.to; minute += SLOT_MINUTES) {
    if (minute <= fromMinute) continue;
    if (found.length >= take) break;

    const free = Array.from({ length: claimOf(doctorId) }, (_, i) => minute + i * SLOT_MINUTES)
      .every((slot) => rows.every((row) => row.doctorId !== doctorId || row.status === 'Cancelled' || !slotsOf(row).includes(slot)));

    if (free) found.push(minute);
  }

  return found;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The preview grid for one doctor, drawn the way the API draws it. */
function previewSlots(day: string, doctorId: string, excludeAppointmentId?: string): SlotDayView {
  const doctor = doctorById(doctorId);
  const rows = previewDay(day).filter(
    (row) => row.doctorId === doctorId && row.status !== 'Cancelled' && row.id !== excludeAppointmentId,
  );
  const closed = weekdayOf(day);
  const open = !SCHEDULING.closedOn.includes(closed);
  const slots: SlotDayView['slots'] = [];

  if (open) {
    for (let minute = SCHEDULING.window.from; minute + SCHEDULING.slotMinutes <= SCHEDULING.window.to; minute += SLOT_MINUTES) {
      const holder = rows.find((row) => slotsOf(row).includes(minute));
      slots.push(
        holder === undefined
          ? { start: `${day}T${clock(minute)}:00+06:00`, minutes: minute, state: 'free' }
          : { start: `${day}T${clock(minute)}:00+06:00`, minutes: minute, state: 'booked', appointmentId: holder.id, token: holder.token, durationMin: holder.durationMin },
      );
    }
  }

  return {
    day,
    doctorId,
    room: doctor.room,
    slotMinutes: SCHEDULING.slotMinutes,
    open,
    closedBecause: open ? null : `The clinic is closed on ${closed}s. Choose the next open day.`,
    window: SCHEDULING.window,
    slots,
  };
}

export const previewSource: AppointmentsSource = {
  kind: 'preview',
  label: 'Preview data — sample appointments generated on this device',
  because:
    'No hospital server is configured for this build, so these rows are the deterministic sample this screen was designed against. The rules are the contract’s own numbers, so a slot that is refused here is refused there — but nothing on this screen has been written to a database, and nothing survives a reload.',

  async day(query) {
    let rows = previewDay(query.day);

    if (query.doctorId !== undefined && query.doctorId !== '') rows = rows.filter((row) => row.doctorId === query.doctorId);
    if (query.status !== undefined) rows = rows.filter((row) => row.status === query.status);
    if (query.source !== undefined) rows = rows.filter((row) => row.source === query.source);

    return { rows, asOf: new Date().toISOString() };
  },

  async slots(day, doctorId, excludeAppointmentId) {
    return previewSlots(day, doctorId, excludeAppointmentId);
  },

  async book(input) {
    const rows = previewDay(input.day);
    assertClaimable(input.doctorId, input.day, input.start, rows);

    const doctor = doctorById(input.doctorId);
    const steps = claimOf(input.doctorId);
    const token = `A-${String(rows.filter((row) => row.doctorId === input.doctorId).length + 1).padStart(3, '0')}`;
    const appointment: Appointment = {
      id: `APT-${input.day.replace(/-/g, '')}-${String(rows.length + 1).padStart(3, '0')}`,
      token,
      doctorId: input.doctorId,
      start: input.start,
      day: input.day,
      room: doctor.room,
      durationMin: steps * SLOT_MINUTES,
      steps,
      patient: { mrn: input.mrn, name: 'See the register', nameBn: '', age: null, sex: 'Other', phone: '', allergies: null },
      type: input.type ?? 'New',
      status: 'Confirmed',
      priority: input.priority ?? 'Routine',
      source: input.source ?? 'Walk-in',
      reason: input.reason ?? '',
      liveConsultation: false,
      createdAt: new Date().toISOString(),
      queued: false,
    };

    previewStore.set(input.day, [...rows, appointment]);

    return appointment;
  },

  async patch(id, input) {
    const day = input.day ?? todayIso();
    const rows = previewDay(day);
    const found = rows.find((row) => row.id === id);

    if (found === undefined) {
      throw new ApiProblem('dizi.not-found', 'Not found here', 404, `This preview has no appointment ${id} on ${day}.`);
    }

    if (found.status === 'Cancelled') {
      throw previewRefusal('dizi.validation-failed', 'That appointment is already cancelled', `Token ${found.token} was cancelled. Its slot is free again and the calendar shows it that way.`);
    }

    if (input.start !== undefined && input.day !== undefined && input.status !== 'Cancelled') {
      const others = rows.filter((row) => row.id !== id);
      assertClaimable(found.doctorId, input.day, input.start, others);
      const moved: Appointment = { ...found, start: input.start, day: input.day, room: doctorById(found.doctorId).room, durationMin: claimOf(found.doctorId) * SLOT_MINUTES };
      previewStore.set(input.day, [...others.filter((row) => row.day !== input.day || row.id !== id), moved]);

      return moved;
    }

    const updated: Appointment =
      input.status === 'Cancelled'
        ? { ...found, status: 'Cancelled' }
        : { ...found, status: input.status === 'No show' ? 'No show' : input.status === 'Confirmed' ? 'Confirmed' : found.status };

    previewStore.set(day, rows.map((row) => (row.id === id ? updated : row)));

    return updated;
  },

  async checkIn(id) {
    const day = todayIso();
    const rows = previewDay(day);
    const found = rows.find((row) => row.id === id);

    if (found === undefined) throw new ApiProblem('dizi.not-found', 'Not found here', 404, `This preview has no appointment ${id} today.`);
    if (found.status === 'Checked in' || found.status === 'Waiting' || found.status === 'In consultation') {
      throw new ApiProblem('dizi.duplicate-operation', 'This patient is already checked in', 409, `Token ${found.token} was checked in and is ${found.status.toLowerCase()}. Check-in happens once per visit.`, { token: found.token });
    }
    if (found.status === 'Cancelled' || found.status === 'No show') {
      throw previewRefusal('dizi.validation-failed', 'That appointment is not coming', `Token ${found.token} is ${found.status.toLowerCase()}, so there is nothing to check in.`);
    }

    const updated: Appointment = { ...found, status: 'Checked in' };
    previewStore.set(day, rows.map((row) => (row.id === id ? updated : row)));

    return updated;
  },
};

/* --------------------------------------------------------------------------------------- which one is live */

export interface SourceState {
  source: AppointmentsSource;
  /** What the screen says about it, in one sentence. */
  note: string;
}

let detected: Promise<SourceState> | null = null;

/**
 * Ask the API whether it is there. Once per session: the answer changes only when somebody starts or stops the
 * service, and probing on every screen would put a request in front of every render.
 */
export function detectSource(): Promise<SourceState> {
  if (detected !== null) return detected;

  detected = probeApi().then(({ reachable, because }) => {
    if (reachable) return { source: apiSource, note: apiSource.because };

    return {
      source: previewSource,
      note: `${because} Showing preview data: sample appointments generated on this device, with the contract’s own booking rules — nothing here is written to the hospital’s records.`,
    };
  });

  return detected;
}

/** Forget the probe. Used by the screens' “try again” and by the test harness, which drives both sources. */
export function resetSourceProbe(): void {
  detected = null;
}
